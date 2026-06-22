import type { ILogger } from "@/wallet/logger"
import { toRestoreError } from "@/utils/restore-error"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { getTokenInfo } from "@/wallet/services/token/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { AccountService, type Account } from "@/wallet/services/account/service"
import { NetworkService } from "@/wallet/services/network/service"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
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
import { TOKEN_BALANCE_SERVICE_NAME, type TokenBalanceRaw, type TokenBalanceInfo, type Methods, type Events } from "./spec"

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
		return (await this.repo.getAll())
			.filter((x) => tokenId === undefined || x.token === tokenId)
			.filter((x) => accountAddress === undefined || x.account === accountAddress)
			.map((x) => this.getTokenBalanceInfo(x), this)
	}

	public async refreshTokenBalance(id: number): Promise<void> {
		const balance = await this.repo.get(id)
		if (!balance) {
			throw new Error("unknown token balance id")
		}
		this.queue.enqueue(balance)
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
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		return await this.repo.getAll()
	}

	public async restore(tokenBalances: TokenBalanceRaw[]): Promise<Restored<TokenBalanceRaw>[]> {
		await this.ensureInitialized()
		const result: Restored<TokenBalanceRaw>[] = []
		for (const tb of tokenBalances) {
			try {
				const id = await this.repo.allocateId()
				await this.repo.set({ ...tb, id })
				result.push({ ...tb, id })
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
