import type { ILogger } from "@/wallet/logger"
import { toRestoreError } from "@/utils/restore-error"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { getTokenInfo } from "@/wallet/services/token/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { AccountService, type Account } from "@/wallet/services/account/service"
import { NetworkService } from "@/wallet/services/network/service"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { TokenService, type Token, type TokenInfo } from "@/wallet/services/token/service"
import { ExecutionService } from "@/wallet/services/execution/service"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { TaskService } from "@/wallet/services/task/service"
import { OriginType, TransactionService, type Tx, TxStatus } from "@/wallet/services/transaction/service"
import { SystemClock } from "@/core/adapters/system-clock"
import { ClockTickerAdapter } from "@/core/adapters/clock-ticker-adapter"
import type { BackgroundTickerPort, BrowserApi } from "@nulo/wallet-core/ports"
import { BalanceJobQueue } from "./balance-job-queue"
import { BalanceProjector } from "./balance-projector"
import { BalanceRepository } from "./balance-repository"
import {
	TOKEN_BALANCE_SERVICE_NAME,
	type TokenBalanceRaw,
	TokenBalanceRawSchema,
	type TokenBalanceInfo,
	type Methods,
	type Events,
} from "./spec"

export * from "./spec"

export class TokenBalanceService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()("getTokenBalance", "getTokenBalances", "refreshTokenBalance")
	public static name = TOKEN_BALANCE_SERVICE_NAME

	/** Declared startup deps (Q9): init() awaits ProfileService.getActiveProfile()
	 *  + TokenService.getTokensRaw(), so topological start guarantees both are
	 *  started first rather than relying on those callees' ensureInitialized
	 *  poll. Was the only init-time peer-awaiter still missing a declaration. */
	public readonly dependencies = [ProfileService.name, TokenService.name] as const

	public readonly onTokenBalanceAdded = new EventHandler<TokenBalanceInfo>()
	public readonly onTokenBalanceUpdated = new EventHandler<TokenBalanceInfo>()
	public readonly onTokenBalanceDeleted = new EventHandler<TokenBalanceInfo>()

	private readonly repo: BalanceRepository
	private readonly tokens = new Map<number, Token>()

	private profileService: ProfileService = null!
	private networkService: NetworkService = null!
	private accountService: AccountService = null!
	private tokenService: TokenService = null!
	private transactionService: TransactionService = null!
	private executionService: ExecutionService = null!
	private taskService: TaskService = null!
	private queue: BalanceJobQueue = null!

	private profile?: ProfileInfo = undefined

	public constructor(
		logger: ILogger,
		browserApi: BrowserApi,
		private readonly ticker: BackgroundTickerPort = new ClockTickerAdapter(new SystemClock(), logger),
	) {
		super(TOKEN_BALANCE_SERVICE_NAME, logger)
		this.repo = new BalanceRepository(browserApi)
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.networkService = services.get(NetworkService.name)
		this.accountService = services.get(AccountService.name)
		this.tokenService = services.get(TokenService.name)
		this.transactionService = services.get(TransactionService.name)
		this.executionService = services.get(ExecutionService.name)
		this.taskService = services.get(TaskService.name)

		const projector = new BalanceProjector(
			this.executionService,
			this.networkService,
			this.tokenService,
			this.profileService,
			this.accountService,
			new PxeServiceClient(this.logger),
			this.logger,
		)
		this.queue = new BalanceJobQueue(
			this.ticker,
			this.repo,
			projector,
			this.taskService,
			{
				onBalanceUpdated: (balance) => {
					this.emit("onTokenBalanceUpdated", this.getTokenBalanceInfo(balance))
				},
			},
			this.logger,
		)

		this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
		this.accountService.onAccountAdded.add(this.onAccountAdded)
		this.tokenService.onTokenAdded.add(this.onTokenAdded)
		this.tokenService.onTokenUpdated.add(this.onTokenUpdated)
		this.tokenService.onTokenDeleted.add(this.onTokenDeleted)
		this.transactionService.onTransactionUpdated.add(this.onTransactionUpdated)

		this.profile = await this.profileService.getActiveProfile()
		if (this.profile) {
			for (const token of await this.tokenService.getTokensRaw(this.profile.id)) {
				this.tokens.set(token.id, token)
			}
		}

		this.queue.start()
	}

	public async getTokenBalance(id: number): Promise<TokenBalanceInfo> {
		await this.ensureInitialized()
		const balance = await this.repo.get(id)
		if (!balance) {
			throw new Error("unknown token balance id")
		}
		return this.getTokenBalanceInfo(balance)
	}

	public async getTokenBalances(tokenId?: number, accountAddress?: string): Promise<TokenBalanceInfo[]> {
		await this.ensureInitialized()
		return (
			(await this.repo.getAll())
				.filter((x) => tokenId === undefined || x.token === tokenId)
				.filter((x) => accountAddress === undefined || x.account === accountAddress)
				// Skip a balance whose token the active profile doesn't own (the map is
				// active-profile-only): a lingering foreign-profile balance (balances carry
				// no profileId) or a codec-hidden token row must not throw and white-screen
				// the whole list — mirrors the balance projector's same-reason skip.
				.filter((x) => this.tokens.has(x.token))
				.map((x) => this.getTokenBalanceInfo(x), this)
		)
	}

	public async refreshTokenBalance(id: number): Promise<void> {
		const balance = await this.repo.get(id)
		if (!balance) {
			throw new Error("unknown token balance id")
		}
		this.queue.enqueue(balance)
	}

	/**
	 * Causal-ack refresh request for the incoming-transfer balance outbox (D4). Enqueues a
	 * re-projection for `(tokenId, accountAddress)` and returns a task id ONLY when it minted a
	 * FRESH task — one created strictly after this call, so its projection is guaranteed to read
	 * chain state including the just-discovered receipt. When a task is already pending/processing
	 * (the queue COALESCES), the value still refreshes but this returns `{ busy: true }` WITHOUT a
	 * task id — reusing the coalesced task's id would false-ack a receipt it may have preceded.
	 * Returns `{ missing: true }` (NOT a throw) when no balance row exists for the pair, so the caller
	 * can delete a positively-stale outbox row while KEEPING it on a transient storage throw.
	 */
	public async requestBalanceRefresh(
		tokenId: number,
		accountAddress: string,
	): Promise<{ taskId: string } | { busy: true } | { missing: true }> {
		// A genuinely-absent (token, account) balance pair is a POSITIVE result (`{missing:true}`), NOT a
		// throw — so the caller (the incoming-transfer outbox drain) can safely delete a stale row on
		// `missing` while KEEPING the row on a real throw (a transient `getAll()`/storage failure), which
		// would otherwise be indistinguishable and discard the sole durable refresh marker (codex R1 High #4).
		const balance = (await this.repo.getAll()).find((x) => x.token === tokenId && x.account === accountAddress)
		if (!balance) {
			return { missing: true }
		}
		const hadPending = this.queue.hasPendingTask(balance.id)
		this.queue.enqueue(balance)
		if (hadPending) return { busy: true }
		const taskId = this.queue.getPendingTaskId(balance.id)
		return taskId ? { taskId } : { busy: true }
	}

	public async refreshAccountBalances(account: string): Promise<void> {
		for (const balance of (await this.repo.getAll()).filter((x) => x.account === account)) {
			this.queue.enqueue(balance)
		}
	}

	private async createTokenBalance(token: Token, account: Account) {
		const tb: TokenBalanceRaw = {
			id: await this.repo.allocateId(),
			token: token.id,
			account: account.address,
			privateBalance: "0",
			publicBalance: "0",
			updatedAt: 0,
		}
		await this.repo.set(tb)
		this.emit("onTokenBalanceAdded", this.getTokenBalanceInfo(tb))
		this.queue.enqueue(tb)
	}

	private getTokenBalanceInfo(tb: TokenBalanceRaw, tokenInfo?: TokenInfo): TokenBalanceInfo {
		if (!tokenInfo) {
			const token = this.tokens.get(tb.token)
			if (!token) {
				throw new Error("unknown token")
			}
			tokenInfo = getTokenInfo(token)
		}
		return {
			id: tb.id,
			token: tokenInfo,
			account: tb.account,
			publicBalance: tb.publicBalance,
			privateBalance: tb.privateBalance,
			updatedAt: tb.updatedAt,
		}
	}

	private readonly onActiveProfileChanged = async (profile?: ProfileInfo) => {
		this.profile = profile
		if (profile) {
			this.tokens.clear()
			for (const token of await this.tokenService.getTokensRaw(profile.id)) {
				this.tokens.set(token.id, token)
			}
		}
	}

	private readonly onAccountAdded = async (account: Account) => {
		for (const token of [...this.tokens.values()].filter((x) => x.chainId === account.chainId)) {
			await this.createTokenBalance(token, account)
		}
	}

	private readonly onTokenAdded = async (token: TokenInfo) => {
		const tokenRaw = await this.tokenService.getTokenRaw(token.id)
		this.tokens.set(token.id, tokenRaw)
		for (const account of await this.accountService.getAccounts(this.profile!.id, token.chainId, true)) {
			await this.createTokenBalance(tokenRaw, account)
		}
	}

	private readonly onTokenUpdated = async (token: TokenInfo) => {
		this.tokens.set(token.id, await this.tokenService.getTokenRaw(token.id))
		for (const tb of (await this.repo.getAll()).filter((x) => x.token === token.id)) {
			this.queue.enqueue(tb)
		}
	}

	private readonly onTokenDeleted = async (token: TokenInfo) => {
		this.tokens.delete(token.id)
		for (const tb of (await this.repo.getAll()).filter((x) => x.token === token.id)) {
			await this.repo.delete(tb.id)
			this.emit("onTokenBalanceDeleted", this.getTokenBalanceInfo(tb, token))
		}
	}

	/** Awaited balance purge for a SET of token ids — called by the deletion
	 *  coordinator with the tombstone's token snapshot (finding D). Idempotent. */
	public async purgeForTokens(tokenIds: readonly number[]): Promise<void> {
		await this.ensureInitialized()
		const set = new Set(tokenIds)
		for (const tb of (await this.repo.getAll()).filter((x) => set.has(x.token))) {
			if (this.tokens.has(tb.token)) this.emit("onTokenBalanceDeleted", this.getTokenBalanceInfo(tb))
			await this.repo.delete(tb.id)
		}
		for (const id of set) this.tokens.delete(id)
	}

	private readonly onTransactionUpdated = async (tx: Tx) => {
		if (tx.status !== TxStatus.Pending) {
			if (tx.origin.type === OriginType.UI) {
				const addresses = new Set<string>()
				const contracts = new Set<string>()
				const tokenIds = new Set<number>()

				for (const c of tx.calls) {
					if (c.contract && c.transfers) {
						contracts.add(c.contract)
					}
					if (c.transfers) {
						for (const t of c.transfers) {
							addresses.add(t.to)
							addresses.add(t.from)
						}
					}
				}

				// If we found specific transfer info, refresh only affected balances.
				// Otherwise (e.g. faucet mints, generic contract calls), refresh all
				// balances for the tx account since we can't narrow the scope.
				if (addresses.size > 0 && contracts.size > 0) {
					for (const t of this.tokens.values()) {
						if (contracts.has(t.contract)) {
							tokenIds.add(t.id)
						}
					}

					const balances = await this.repo.getAll()
					for (const tb of balances) {
						if (addresses.has(tb.account) && tokenIds.has(tb.token)) {
							this.queue.enqueue(tb)
						}
					}
				} else {
					await this.refreshAccountBalances(tx.account)
				}

				return
			}

			await this.refreshAccountBalances(tx.account)
		}
	}

	public async backup(): Promise<TokenBalanceRaw[]> {
		const profile = await requireActiveProfile(this.profileService)
		// Export-scope guard: balances carry no profileId, so scope the export to the
		// active profile via its token ids. Token ids are a single global sequence, so
		// `balance.token ∈ active-profile-token-ids` is an exact partition. Use the
		// AUTHORITATIVE token service (not the in-memory `this.tokens`, which is cleared
		// mid-profile-switch → would export nothing).
		const ownedTokenIds = new Set((await this.tokenService.getTokensRaw(profile.id)).map((t) => t.id))
		return (await this.repo.getAll()).filter((b) => ownedTokenIds.has(b.token))
	}

	public async restore(tokenBalances: TokenBalanceRaw[]): Promise<Restored<TokenBalanceRaw>[]> {
		await this.ensureInitialized()
		const result: Restored<TokenBalanceRaw>[] = []
		for (const tb of tokenBalances) {
			try {
				const id = await this.repo.allocateId()
				// Parse the exact persisted shape: an unvalidated restore row that fails
				// the read-codec is KEPT-but-hidden by EntityStorage.decodeRow (invisible
				// on read AND to a later getValues() cleanup). Parse here so a malformed
				// backup row is recorded as restoreError, never written.
				const row = TokenBalanceRawSchema.parse({ ...tb, id })
				await this.repo.set(row)
				result.push(row)
			} catch (err) {
				result.push({
					...tb,
					restoreError: toRestoreError(err),
				})
			}
		}
		return result
	}
}
