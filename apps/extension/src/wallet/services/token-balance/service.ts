import type { ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { assertRestoreEpoch, captureRestoreEpochs } from "@/wallet/services/restore-fence"
import { restoreRows } from "@/wallet/services/restore-rows"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { getTokenInfo } from "@/wallet/services/token/utils"
import { EventHandler, Lock, getErrorMessage } from "@nulo/wallet-core/utils"
import { reconcilePlan } from "./reconcile-pairs"
import { isLegacyBalanceRow, rowMatchesToken } from "./balance-identity"
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

	/** init() awaits all three, so topological start must have them running before
	 *  this service starts — otherwise each call falls back to an
	 *  `ensureInitialized` poll. */
	public readonly dependencies = [ProfileService.name, TokenService.name, AccountService.name] as const

	public readonly onTokenBalanceAdded = new EventHandler<TokenBalanceInfo>()
	public readonly onTokenBalanceUpdated = new EventHandler<TokenBalanceInfo>()
	public readonly onTokenBalanceDeleted = new EventHandler<TokenBalanceInfo>()

	private readonly repo: BalanceRepository
	private readonly tokens = new Map<number, Token>()
	/** Serializes every path that ALLOCATES a balance-row id. `allocateUnfencedId`
	 *  reads the key space and computes `max+1`, and event subscribers dispatch
	 *  un-awaited, so two creators can otherwise compute the same id and the later
	 *  `repo.set` silently overwrites the earlier row.
	 *
	 *  `maxHoldMs: null` is required, not incidental: a force-release admits a
	 *  second critical section into a still-running one, which is exactly the
	 *  invariant this lock exists to hold. Holds are bounded by the repair count,
	 *  which has no cap, so queueing is the only correct semantic. Non-reentrant —
	 *  internal callees take `…HoldingLock` forms and only entry points acquire. */
	private readonly lock = new Lock("token-balance", undefined, null)

	private profileService: ProfileService = null!
	private networkService: NetworkService = null!
	private accountService: AccountService = null!
	private tokenService: TokenService = null!
	private transactionService: TransactionService = null!
	private executionService: ExecutionService = null!
	private taskService: TaskService = null!
	private queue: BalanceJobQueue = null!

	private profile?: ProfileInfo = undefined

	/** Bumped on every profile switch. The active-token-map rebuild awaits
	 *  `getTokensRaw`, so two rapid switches can resolve out of order — a late
	 *  rebuild must not repopulate the map for a profile that is no longer active.
	 *  Captured before the await; the commit is dropped if it changed since. */
	private profileGeneration = 0

	/** Deletion fence for the job queue's re-read→write window: ids are added
	 *  BEFORE the awaited `repo.delete` and checked SYNCHRONOUSLY right before
	 *  every queue write, so a delete interleaving between the queue's re-read
	 *  and its `repo.set` cannot resurrect the row. Fenced ids are NEVER
	 *  reallocated within this worker lifetime (`allocateUnfencedId` skips
	 *  past them); a worker restart forgets the fence safely — no old
	 *  projection survives it. */
	private readonly invalidatedBalanceIds = new Set<number>()

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
				isBalanceInvalidated: (id) => this.invalidatedBalanceIds.has(id),
				isRowEmittable: (row) => {
					const token = this.tokens.get(row.token)
					return token !== undefined && rowMatchesToken(row, token)
				},
				getGeneration: () => this.profileGeneration,
			},
			this.logger,
		)

		this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
		this.accountService.onAccountAdded.add(this.onAccountAdded)
		// Registered-awaited cascade: account removal purges this service's rows
		// BEFORE the Account row is deleted. No RPC surface, no event race.
		this.accountService.registerAccountPurgeSubscriber((profileId, scopes) => this.purgeForAccounts(scopes, profileId))
		this.tokenService.onTokenAdded.add(this.onTokenAdded)
		this.tokenService.onTokenUpdated.add(this.onTokenUpdated)
		this.tokenService.onTokenDeleted.add(this.onTokenDeleted)
		this.transactionService.onTransactionUpdated.add(this.onTransactionUpdated)

		// Subscriptions are already live above, so a profile switch can land during
		// these awaits: capture the generation first and commit only if it — and the
		// profile identity — still hold. Without this the late continuation can
		// repopulate the map for a profile the switch already replaced.
		const gen = this.profileGeneration
		// Baseline cleanup, idempotent, all profiles: pre-identity rows are unreadable
		// projections, yet their PHYSICAL keys tax every future id allocation (max+1
		// scans the key space) — reap them; each profile's own reconcile recreates its
		// pairs on activation. The predicate matches only the provably-legacy shape.
		await this.lock.withLock(async () => {
			const swept = await this.repo.purgeMalformed(isLegacyBalanceRow, (id) => this.logDebug(`swept legacy balance row ${id}`))
			if (swept > 0) this.logWarn(`balance legacy sweep: ${swept} pre-identity row(s) purged`)
		})
		const profile = await this.profileService.getActiveProfile()
		if (profile) {
			const raw = await this.tokenService.getTokensRaw(profile.id)
			if (gen === this.profileGeneration) {
				this.profile = profile
				for (const token of raw) this.tokens.set(token.id, token)
				await this.reconcileBalanceRows(profile.id, gen)
			}
		}

		this.queue.start()
	}

	public async getTokenBalance(id: number): Promise<TokenBalanceInfo> {
		await this.ensureInitialized()
		const balance = await this.repo.get(id)
		// Identity-mismatched rows answer exactly like absent ones — a foreign or
		// dead-incarnation row must not be decorated with the id-holder's token.
		const token = balance && this.tokens.get(balance.token)
		if (!balance || !token || !rowMatchesToken(balance, token)) {
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
				// Fail-closed row↔token identity: a foreign-profile balance, a dead
				// incarnation at a reused token id, or a codec-hidden token row must not
				// render (or throw and white-screen the list).
				.filter((x) => {
					const token = this.tokens.get(x.token)
					return token !== undefined && rowMatchesToken(x, token)
				})
				.map((x) => this.getTokenBalanceInfo(x), this)
		)
	}

	public async refreshTokenBalance(id: number): Promise<void> {
		const balance = await this.repo.get(id)
		const token = balance && this.tokens.get(balance.token)
		if (!balance || !token || !rowMatchesToken(balance, token)) {
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
		// Find the identity-MATCHING row for the pair: between a stale incarnation's
		// row and its canonical replacement (coexisting until the next reconcile), a
		// bare pair-find could pick the stale one and false-report `missing`.
		const balance = (await this.repo.getAll()).find((x) => {
			if (x.token !== tokenId || x.account !== accountAddress) return false
			const token = this.tokens.get(x.token)
			return token !== undefined && rowMatchesToken(x, token)
		})
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
			const token = this.tokens.get(balance.token)
			if (!token || !rowMatchesToken(balance, token)) continue
			this.queue.enqueue(balance)
		}
	}

	/** Allocate an id that was never fenced this worker lifetime. Reusing a
	 *  fenced id would either let a deleted row's in-flight projection write
	 *  onto the new incarnation (ABA) or permanently suppress the new row's
	 *  syncs — so fenced ids are treated as OCCUPIED (never released; the
	 *  allocator resolves fence + physical occupancy + safety together, which
	 *  at the hostile boundary can gap-fill downward rather than skip past).
	 *  A worker restart forgets the fence safely: no old projection survives it. */
	private async allocateUnfencedId(): Promise<number> {
		return await this.repo.allocateIdAvoiding(this.invalidatedBalanceIds)
	}

	/** Allocation is `max+1` over the live key space, so it is only safe while
	 *  this service's lock is held — callers MUST already hold it. */
	private async createTokenBalanceHoldingLock(token: Token, account: Account, gen?: number): Promise<boolean> {
		const id = await this.allocateUnfencedId()
		// A profile switch during allocation makes this write belong to a departed
		// context — skip it (the id isn't persisted, so it's reused by the next call).
		if (gen !== undefined && gen !== this.profileGeneration) return false
		// Token ids are `max+1`, so deleting the highest token frees its id for a
		// successor: `tokens.has(id)` would pass for a DIFFERENT token. Compare the
		// stable identity instead, so a creation for a token deleted mid-flight
		// cannot attach to whatever now holds its id.
		if (!this.isSameTokenLive(token)) return false
		const tb: TokenBalanceRaw = {
			id,
			token: token.id,
			account: account.address,
			profileId: token.profileId,
			chainId: token.chainId,
			contract: token.contract,
			privateBalance: "0",
			publicBalance: "0",
			updatedAt: 0,
		}
		await this.repo.set(tb)
		// A switch during the write must not emit a UI event or enqueue a sync under
		// the new profile's context.
		if (gen !== undefined && gen !== this.profileGeneration) return true
		this.emit("onTokenBalanceAdded", this.getTokenBalanceInfo(tb))
		this.queue.enqueue(tb)
		return true
	}

	/**
	 * Creates rows for pairs that do not have one. Serializing allocation alone is
	 * not enough: two creators can hold the lock in turn and each create the SAME
	 * pair under a different id, so the existence check has to happen inside the
	 * same hold as the write. Callers MUST already hold the lock.
	 *
	 * `existing` skips a second full-namespace read for a caller that has one — it
	 * MUST have been read during the current hold, or it can miss a write that
	 * landed before this call and the pair is created twice. (`restore()` writes
	 * directly rather than through here: it carries backup values and its token
	 * ids are absent from the active map by design.)
	 */
	private async ensurePairsHoldingLock(
		pairs: readonly { token: Token; account: Account }[],
		gen: number,
		existing?: readonly TokenBalanceRaw[],
	): Promise<number> {
		if (pairs.length === 0) return 0
		const rows = existing ?? (await this.repo.getAll())
		// Occupancy requires full identity: a dead incarnation's row at a reused
		// token id must NOT hold the slot, or the canonical pair is never created.
		const pairTokens = new Map(pairs.map((p) => [p.token.id, p.token]))
		const have = new Set(
			rows
				.filter((r) => {
					const token = pairTokens.get(r.token)
					return token !== undefined && rowMatchesToken(r, token)
				})
				.map((r) => `${r.token}:${r.account}`),
		)
		let created = 0
		for (const { token, account } of pairs) {
			if (gen !== this.profileGeneration) return created
			const key = `${token.id}:${account.address}`
			if (have.has(key)) continue
			try {
				if (await this.createTokenBalanceHoldingLock(token, account, gen)) {
					have.add(key)
					created++
				}
			} catch (error) {
				// One unwritable row must not abandon the rest of the batch.
				this.logWarn(`balance ensure: ${key} failed`, getErrorMessage(error))
			}
		}
		return created
	}

	/**
	 * Repair the two windows an MV3 worker death can leave inside
	 * `createTokenBalanceHoldingLock`: no row at all (died before `repo.set`), and
	 * a row that was never projected (died before `enqueue`, leaving the card
	 * showing "Loading balance…" with nothing queued to finish it).
	 *
	 * Create-only. An existing row this profile cannot explain may belong to
	 * another profile, may precede its token during a restore, or may be inside a
	 * chain-purge cascade that is still draining — none of those are safe to
	 * delete from a schema that carries neither profile nor chain.
	 */
	private async reconcileBalanceRows(profileId: string, gen: number): Promise<void> {
		const startedAt = Date.now()
		// One profile-wide account read rather than one per chain: every entity
		// enumeration deserializes the whole storage namespace, so read COUNT is
		// the cost. It also has no visibility parameter to get wrong — hidden
		// accounts legitimately hold balance rows. Taken OUTSIDE the hold on
		// purpose: this lock cannot make AccountService mutations atomic, and
		// holding it across a peer read would widen the critical section for
		// nothing — a concurrently-added account is covered by its own handler.
		const accounts = await this.accountService.getAccountsRaw(profileId)
		if (gen !== this.profileGeneration) return

		await this.lock.withLock(async () => {
			if (gen !== this.profileGeneration) return
			const existing = await this.repo.getAll()
			if (gen !== this.profileGeneration) return

			const tokens = [...this.tokens.values()]
			const plan = reconcilePlan({ tokens, accounts, existing })

			// Provably-stale rows (live token at the id, identity mismatch, this
			// profile) are deleted BEFORE repair so the canonical pair can land.
			// They were never renderable, so no delete event is emitted. Fence
			// first: an in-flight projection must not resurrect the id.
			for (const row of plan.staleIdentity) {
				if (gen !== this.profileGeneration) return
				this.invalidatedBalanceIds.add(row.id)
				await this.repo.delete(row.id)
			}

			for (const row of plan.staleTokens) {
				if (gen !== this.profileGeneration) return
				this.queue.enqueue(row)
			}

			const repaired = await this.ensurePairsHoldingLock(plan.missing, gen, existing)

			// Surfaced because a non-zero repair means something upstream left the
			// store inconsistent; the count is the fact, the cause is not inferable
			// here.
			if (repaired > 0 || plan.staleTokens.length > 0 || plan.staleIdentity.length > 0) {
				this.logWarn(
					`balance reconcile: created ${repaired}, re-queued ${plan.staleTokens.length}, deleted ${plan.staleIdentity.length} stale (${Date.now() - startedAt}ms)`,
				)
			} else {
				this.logDebug(`balance reconcile: nothing to repair (${Date.now() - startedAt}ms)`)
			}
		})
	}

	/** Whether the map still holds THIS token rather than a successor that reused
	 *  its id (`token/service.ts` warns about exactly that reuse). */
	private isSameTokenLive(token: Token): boolean {
		const live = this.tokens.get(token.id)
		return (
			live !== undefined && live.profileId === token.profileId && live.chainId === token.chainId && live.contract === token.contract
		)
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
			syncFailure: tb.syncFailure,
		}
	}

	private readonly onActiveProfileChanged = async (profile?: ProfileInfo) => {
		const gen = ++this.profileGeneration
		this.profile = profile
		// Clear synchronously and UNCONDITIONALLY (including profile === undefined) so
		// no reader — getTokenBalances, the queue's isRowEmittable, the token handlers
		// — can ever observe the prior profile's tokens once the switch has begun.
		this.tokens.clear()
		// The prior profile's queued balance work + pending-task pointers reference
		// TaskService records that are about to be wiped; drop them so a new enqueue
		// can't coalesce onto a dead task id (B-04).
		this.queue.reset()
		if (!profile) return
		const raw = await this.tokenService.getTokensRaw(profile.id)
		// Commit the rebuilt map only if this is still the live switch (no newer
		// switch since) AND the active profile is still the one we fetched for.
		if (gen !== this.profileGeneration || this.profile?.id !== profile.id) return
		for (const token of raw) {
			this.tokens.set(token.id, token)
		}
		await this.reconcileBalanceRows(profile.id, gen)
	}

	private readonly onAccountAdded = async (account: Account) => {
		const gen = this.profileGeneration
		const pairs = [...this.tokens.values()].filter((x) => x.chainId === account.chainId).map((token) => ({ token, account }))
		await this.lock.withLock(() => this.ensurePairsHoldingLock(pairs, gen))
	}

	private readonly onTokenAdded = async (token: TokenInfo) => {
		// Capture the generation before any await. profileId alone can't see an
		// A→B→A switch (same id), and it doesn't fence the mutations AFTER the map
		// set (getAccounts + createTokenBalance) — a switch there would persist
		// balances for the departed context. Re-check the generation after every
		// await, before every map/repo mutation.
		const gen = this.profileGeneration
		const tokenRaw = await this.tokenService.getTokenRaw(token.id)
		const profile = this.profile
		if (gen !== this.profileGeneration || !profile || tokenRaw.profileId !== profile.id) return
		this.tokens.set(token.id, tokenRaw)
		// `all: true` — hidden accounts keep balance rows; only the account switcher
		// filters visibility.
		const accounts = await this.accountService.getAccounts(profile.id, token.chainId, true)
		if (gen !== this.profileGeneration) return
		const pairs = accounts.map((account) => ({ token: tokenRaw, account }))
		await this.lock.withLock(() => this.ensurePairsHoldingLock(pairs, gen))
	}

	private readonly onTokenUpdated = async (token: TokenInfo) => {
		const gen = this.profileGeneration
		const tokenRaw = await this.tokenService.getTokenRaw(token.id)
		// Same generation fence as onTokenAdded: a switch mid-await must not let this
		// token repopulate the active-only map or enqueue foreign rows.
		if (gen !== this.profileGeneration || tokenRaw.profileId !== this.profile?.id) return
		this.tokens.set(token.id, tokenRaw)
		const rows = (await this.repo.getAll()).filter((x) => rowMatchesToken(x, tokenRaw))
		if (gen !== this.profileGeneration) return
		for (const tb of rows) {
			this.queue.enqueue(tb)
		}
	}

	private readonly onTokenDeleted = async (token: TokenInfo) => {
		// Synchronous, before any await: a creation that checks token liveness
		// after this point must see the token gone.
		this.tokens.delete(token.id)
		// Under the same lock as the creators — otherwise a creation whose write
		// settles after this snapshot survives the deletion. The emit inside the
		// hold reaches no in-worker subscriber today; `EventHandler.invoke` does
		// not await subscribers, so one added later would queue behind this hold
		// rather than re-enter it.
		await this.lock.withLock(async () => {
			for (const tb of (await this.repo.getAll()).filter((x) => x.token === token.id)) {
				this.invalidatedBalanceIds.add(tb.id)
				await this.repo.delete(tb.id)
				this.emit("onTokenBalanceDeleted", this.getTokenBalanceInfo(tb, token))
			}
		})
	}

	/** Awaited balance purge for a SET of token ids — called by the deletion
	 *  coordinator with the tombstone's token snapshot (finding D). Idempotent. */
	public async purgeForTokens(tokenIds: readonly number[]): Promise<void> {
		await this.ensureInitialized()
		const set = new Set(tokenIds)
		// Typed and raw passes share ONE hold with the creators: unlocked, a
		// creation whose `repo.set` settles after this snapshot survives the purge.
		await this.lock.withLock(async () => {
			for (const tb of (await this.repo.getAll()).filter((x) => set.has(x.token))) {
				if (this.tokens.has(tb.token)) this.emit("onTokenBalanceDeleted", this.getTokenBalanceInfo(tb))
				this.invalidatedBalanceIds.add(tb.id)
				await this.repo.delete(tb.id)
			}
			// F-B23: raw second pass — a validation-failed balance row for a purged
			// token is invisible to getAll() and would otherwise survive forever.
			await this.repo.purgeMalformed(
				(raw) => typeof raw.token === "number" && set.has(raw.token),
				(id) => this.logDebug(`purged malformed balance row ${id}`),
			)
		})
		for (const id of set) this.tokens.delete(id)
	}

	/** Awaited balance purge for account scopes within ONE profile — registered with
	 *  AccountService and invoked BEFORE the Account rows are deleted. Scope is the
	 *  full (profileId, chainId, address) tuple: a bare-address match would destroy a
	 *  sibling profile's rows (shared addresses are a supported state), and an
	 *  address+profile match would destroy this profile's rows on ANOTHER chain.
	 *  Idempotent. */
	public async purgeForAccounts(scopes: ReadonlyArray<{ chainId: number; address: string }>, profileId: string): Promise<void> {
		await this.ensureInitialized()
		if (scopes.length === 0) return
		const keys = new Set(scopes.map((s) => `${s.chainId}:${s.address}`))
		// One hold with the creators, fence before every delete — mirrors purgeForTokens.
		await this.lock.withLock(async () => {
			for (const tb of (await this.repo.getAll()).filter(
				(row) => row.profileId === profileId && keys.has(`${row.chainId}:${row.account}`),
			)) {
				// The scope's profile is typically NOT active here (restore finalize), so
				// the token map cannot decorate the row — emit only when the map holds the
				// row's OWN token (a reused id's successor must not decorate the event).
				const live = this.tokens.get(tb.token)
				if (live && rowMatchesToken(tb, live)) this.emit("onTokenBalanceDeleted", this.getTokenBalanceInfo(tb))
				this.invalidatedBalanceIds.add(tb.id)
				await this.repo.delete(tb.id)
			}
			// Raw second pass: a validation-failed new-shape row in scope must not
			// survive as hidden debris. Old-shape rows carry no profileId/chainId —
			// unattributable — and are DELIBERATELY left to the init legacy sweep.
			await this.repo.purgeMalformed(
				(raw) =>
					raw.profileId === profileId &&
					typeof raw.chainId === "number" &&
					typeof raw.account === "string" &&
					keys.has(`${raw.chainId}:${raw.account}`),
				(id) => this.logDebug(`purged malformed balance row ${id}`),
			)
		})
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
						if (!addresses.has(tb.account) || !tokenIds.has(tb.token)) continue
						const t = this.tokens.get(tb.token)
						if (t && rowMatchesToken(tb, t)) this.queue.enqueue(tb)
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
		// Export-scope guard: full row↔token identity against the AUTHORITATIVE token
		// service (not the in-memory `this.tokens`, which is cleared mid-profile-switch
		// → would export nothing). `row.profileId` alone would export a dead
		// incarnation's debris; the identity join cannot.
		const owned = new Map((await this.tokenService.getTokensRaw(profile.id)).map((t) => [t.id, t]))
		return (await this.repo.getAll()).filter((b) => {
			const token = owned.get(b.token)
			return token !== undefined && rowMatchesToken(b, token)
		})
	}

	public async restore(tokenBalances: TokenBalanceRaw[], profileId: string): Promise<Restored<TokenBalanceRaw>[]> {
		await this.ensureInitialized()
		// Deletion fence keyed on the composable's authoritative created-profile
		// id — balance rows carry NO profileId, so only the threaded id can
		// anchor it. Fail closed: dispatch has no schema validation.
		if (typeof profileId !== "string" || profileId.length === 0) {
			throw new Error("restore requires the created profile id")
		}
		const deletion = this.profileService.getDeletionState()
		const epochs = captureRestoreEpochs(deletion, [profileId])
		// ONE hold for the whole batch — restore allocates from the same key space
		// as the creators. It deliberately does NOT take the ensure path: full-backup
		// slices are written BEFORE the imported profile is activated, so their token
		// ids are absent from the active map and any active-map authorization here
		// would reject every restored balance.
		// Identity authority is the profile's OWN token table (explicit-profileId read —
		// the imported profile is not active yet, so the active map is useless here).
		// Every scoping field is derived below; nothing identity-bearing survives from
		// the wire, and a row pointing at a token the profile doesn't own is rejected.
		const ownedTokens = new Map((await this.tokenService.getTokensRaw(profileId)).map((t) => [t.id, t]))
		const seenPairs = new Set<string>()
		return await this.lock.withLock(async () =>
			restoreRows(tokenBalances, async (tb) => {
				const id = await this.allocateUnfencedId()
				const token = ownedTokens.get(tb.token)
				if (!token) throw new Error("balance row references a token the profile does not own")
				// The backup registry rejects duplicate row IDS only — two blob rows can
				// share one (token, account) pair and would otherwise both restore.
				const pair = `${token.id}:${tb.account}`
				if (seenPairs.has(pair)) throw new Error("duplicate balance pair in backup")
				seenPairs.add(pair)
				// Parse the exact persisted shape (a malformed row records a restoreError,
				// never a KEPT-but-hidden write). Derived identity fields land LAST so the
				// blob can never override them.
				const row = TokenBalanceRawSchema.parse({
					...tb,
					id,
					profileId,
					chainId: token.chainId,
					contract: token.contract,
				})
				assertRestoreEpoch(deletion, epochs, profileId)
				await this.repo.set(row)
				return row
			}),
		)
	}
}
