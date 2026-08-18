import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { normalizeError } from "@nulo/wallet-core/jobs"
import type { ILogger } from "@/wallet/logger"
import { NetworkService, networkInfoFrom } from "@/wallet/services/network/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import type { OperationContext } from "@/wallet/services/operation-journal/spec"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { requireOwnedRow } from "@/wallet/services/require-owned-row"
import { nextNumericId } from "@/wallet/services/id-allocators"
import { restoreRows } from "@/wallet/services/restore-rows"
import { AccountService } from "@/wallet/services/account/service"
import { DEFAULT_SHALLOW_PXE_CLIENT_FACTORY, type ShallowPxeClient, type ShallowPxeClientFactory } from "@/wallet/services/pxe/shallow-port"
import { TaskService, StepContent, type WrappedTask } from "@/wallet/services/task/service"
import { purgeMalformedRows, purgeRows } from "@/wallet/services/purge-rows"
import { ensureRegistered } from "@/wallet/services/execution/contract-resolver"
import { EntityStorage } from "@/wallet/storage"
import { Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { feeJuiceAddress, feeJuiceName, feeJuiceSymbol } from "@/wallet/utils/fee-juice"
import { simulate } from "@/wallet/utils/fn"
import { findSeed } from "./default-tokens"
import { PinMismatchError, TokenSeeder } from "./seeder"
import {
	type Token,
	type TokenInfo,
	type TokenDeleted,
	TOKEN_SERVICE_NAME,
	TOKEN_STORAGE_ROOT,
	TokenSchema,
	type TokenInterface,
	type Methods,
	type Events,
} from "./spec"
import { createViewTokenFn, getDefaultTokenFn, getTokenFnCandidates, TOKEN_FN_DESCRIPTORS } from "./functions"
import { getTokenInfo, isTokenComplete } from "./utils"

export * from "./functions"
export * from "./spec"

export class TokenService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getTokens",
		"getToken",
		"addToken",
		"updateToken",
		"deleteToken",
		"getTokenInterface",
		"parseTokenInterface",
		"previewTokenMetadata",
	)
	public static name = TOKEN_SERVICE_NAME

	public readonly onTokenAdded = new EventHandler<TokenInfo>()
	public readonly onTokenUpdated = new EventHandler<TokenInfo>()
	public readonly onTokenDeleted = new EventHandler<TokenDeleted>()

	private readonly tokens: EntityStorage<Token>
	private readonly lock = new Lock()
	private readonly browserApi: BrowserApi
	private readonly seederOverrides?: { getVersion?: () => string; enabled?: boolean }
	private seeder: TokenSeeder = null!

	private pxeService: ShallowPxeClient = null!
	private profiles: ProfileService = null!
	private networks: NetworkService = null!
	private accounts: AccountService = null!
	private tasks: TaskService = null!
	private journal: OperationJournalService = null!

	public constructor(
		logger: ILogger,
		browserApi: BrowserApi,
		private readonly pxeClientFactory: ShallowPxeClientFactory = DEFAULT_SHALLOW_PXE_CLIENT_FACTORY,
		seederOverrides?: { getVersion?: () => string; enabled?: boolean },
	) {
		super(TOKEN_SERVICE_NAME, logger)
		this.browserApi = browserApi
		this.seederOverrides = seederOverrides
		this.tokens = new EntityStorage<Token>(TOKEN_STORAGE_ROOT, browserApi.storage.local, (raw) => TokenSchema.parse(raw))
	}

	protected async init(services: ServiceCollection) {
		this.pxeService = this.pxeClientFactory(this.logger)
		this.profiles = services.get(ProfileService.name)
		this.networks = services.get(NetworkService.name)
		this.accounts = services.get(AccountService.name)
		this.tasks = services.get(TaskService.name)
		this.journal = services.get(OperationJournalService.name)
		// Profile-delete cleanup is now the coordinator's awaited `purgeForProfile` (D).
		this.networks.registerChainPurgeSubscriber(async (profileId, chainId) => this.clearChainState(profileId, chainId))

		// Default-token seeding: lazy, single-flight, TOFU-pinned (see
		// default-tokens.ts + seeder.ts). Triggered on unlock and on active-
		// network change; both handlers coalesce through `seeder.run()`.
		this.seeder = new TokenSeeder(
			{
				getActiveProfile: () => this.profiles.getActiveProfile(),
				getActiveNetwork: () => this.networks.getActiveNetwork(),
				getAccounts: async (profileId, chainId) => await this.accounts.getAccounts(profileId, chainId),
				preview: async (networkId, accountAddress, contract, expectedClassId) =>
					await this.previewTokenMetadata(networkId, accountAddress, contract, expectedClassId),
				isTokenPresent: async (profileId, chainId, contract) => (await this.findToken(profileId, chainId, contract)) !== undefined,
				persist: async (input) => {
					await this.addSeededToken(input)
				},
			},
			this.browserApi.storage.local,
			this.logger,
			this.seederOverrides?.getVersion,
		)
		if (this.seederOverrides?.enabled !== false) {
			this.profiles.onActiveProfileChanged.add(this.onActiveProfileChangedSeed)
			this.networks.onActiveNetworkChanged.add(this.onActiveNetworkChangedSeed)
		}
	}

	private readonly onActiveProfileChangedSeed = (profile: ProfileInfo | undefined): void => {
		if (!profile) return
		void this.seeder.run()
	}

	private readonly onActiveNetworkChangedSeed = (): void => {
		void this.seeder.run()
	}

	/**
	 * Wipe tokens for `(profileId, chainId)`. Emits `onTokenDeleted` per
	 * token so `TokenBalanceService` (already listening) cascades the
	 * matching token-balance rows. Called by `NetworkService.purgeChain`.
	 */
	public async clearChainState(profileId: string, chainId: number): Promise<void> {
		await this.ensureInitialized()
		// Seeder fence FIRST: it bumps the seeder's purge epoch and waits on
		// the marker lock, so an in-flight seed pass either aborts or fully
		// commits BEFORE the row purge below — a commit landing after the row
		// sweep would resurrect a token on the freshly-purged chain.
		await this.seeder.onChainPurged(profileId, chainId)
		const tokens = (await this.tokens.getValues()).filter((t) => t.profileId === profileId && t.chainId === chainId)
		await purgeRows(
			tokens,
			(token) => this.tokens.delete(`${token.id}`),
			(token) => this.emit("onTokenDeleted", { ...getTokenInfo(token), profileId: token.profileId }),
		)
	}

	public async getTokens(profileId?: string, chainId?: number): Promise<TokenInfo[]> {
		return (await this.tokens.getValues())
			.filter(
				(token) =>
					(profileId === undefined || token.profileId === profileId) && (chainId === undefined || token.chainId === chainId),
			)
			.map(getTokenInfo)
	}

	public async getTokensRaw(profileId?: string, chainId?: number): Promise<Token[]> {
		return (await this.tokens.getValues()).filter(
			(token) => (profileId === undefined || token.profileId === profileId) && (chainId === undefined || token.chainId === chainId),
		)
	}

	public async getToken(id: number): Promise<TokenInfo> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profiles)
		const token = requireOwnedRow(await this.tokens.get(`${id}`), profile.id, "unknown token id")
		return getTokenInfo(token)
	}

	public async getTokenRaw(id: number): Promise<Token> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profiles)
		return requireOwnedRow(await this.tokens.get(`${id}`), profile.id, "unknown token id")
	}

	public async addToken(
		profileId: string,
		networkId: string,
		accountAddress: string,
		tokenInterface: TokenInterface,
		opContext: OperationContext,
	): Promise<TokenInfo> {
		await this.ensureInitialized()

		// Fast idempotency short-circuit (Opus H2 / codex DEFERRED).
		// If the token is already on this profile+chain, return without
		// creating a new journal entry or running fetchTokenMetadata.
		// Without this guard, a malicious or buggy dApp could spam
		// registerToken with the same contract address and force a PXE
		// round-trip + journal write per attempt. The lock still protects
		// the write path against concurrent imports of NEW addresses.
		const existing = await this.findToken(profileId, tokenInterface.chainId, tokenInterface.contract)
		if (existing) {
			return getTokenInfo(existing)
		}

		// Phase 2.5: durable journal entry for the import. Created up-front
		// (title=undefined) so the tokens-view TokenImportRow pops in
		// immediately after approval, carrying the "Requested by <origin>"
		// subtitle. The title gets backfilled with the resolved symbol once
		// fetchTokenMetadata returns (via `setOperationMeta`) — without this
		// backfill the row would show the short contract address as a
		// fallback (TokenImportRow.vue:30-33).
		const journalOp = await this.journal.createOperation({
			kind: "token_import",
			origin: opContext.origin,
			profileId,
			accountAddress,
			networkId,
			contractAddress: tokenInterface.contract,
			title: undefined,
			subtitle: opContext.origin === "dapp" ? `Requested by ${opContext.dappOrigin}` : "Adding token…",
		})

		// The catch stays INSIDE the locked section: the journal's "failed"
		// transition must complete while the token lock is held, so a queued
		// token op can never observe the operation mid-failure (audit D3).
		return await this.lock.withLock(async () => {
			try {
				await this.journal.transitionOperation(journalOp.id, { stage: "simulating" })
				let token = await this.findToken(profileId, tokenInterface.chainId, tokenInterface.contract)
				if (!token) {
					const [name, symbol, decimals] = await this.fetchTokenMetadata(profileId, networkId, accountAddress, tokenInterface)
					// Backfill the title with the resolved symbol so the in-flight
					// TokenImportRow stops falling back to the short contract
					// address. Safe to call even if the row has already vanished
					// (setOperationMeta tolerates terminal records).
					await this.journal.setOperationMeta(journalOp.id, { title: symbol })
					token = {
						id: await nextNumericId(this.tokens),
						profileId,
						chainId: tokenInterface.chainId,
						contract: tokenInterface.contract,
						name: name,
						symbol: symbol,
						decimals: decimals,
						getNameFn: tokenInterface.getNameFn,
						getSymbolFn: tokenInterface.getSymbolFn,
						getDecimalsFn: tokenInterface.getDecimalsFn,
						balanceOfPublicFn: tokenInterface.balanceOfPublicFn,
						balanceOfPrivateFn: tokenInterface.balanceOfPrivateFn,
						transferPublicFn: tokenInterface.transferPublicFn,
						transferPrivateFn: tokenInterface.transferPrivateFn,
						transferPublicToPrivateFn: tokenInterface.transferPublicToPrivateFn,
						transferPrivateToPublicFn: tokenInterface.transferPrivateToPublicFn,
					}
					await this.tokens.set(`${token.id}`, token)
					this.emit("onTokenAdded", getTokenInfo(token))
				}
				const result = getTokenInfo(token)
				// Codex's success-boundary call: succeeded means "token added to
				// watchlist". Balance-load is a separate phase handled by the
				// caller (NewTokenPopup's balanceWait + TokenCard's initial-sync
				// spinner via updatedAt === 0).
				await this.journal.transitionOperation(journalOp.id, { stage: "succeeded" })
				return result
			} catch (error) {
				await this.journal.transitionOperation(
					journalOp.id,
					{ stage: "failed" },
					normalizeError(error, classifyTokenImportError(error)),
				)
				throw error
			}
		})
	}

	/** Test/SW-internal trigger for a seed pass (also driven by the unlock and
	 *  network-change subscriptions wired in `init`). */
	public seedDefaultTokens(): Promise<void> {
		return this.seeder.run()
	}

	/**
	 * Seed-only persist path: writes the EXACT snapshot the seeder validated —
	 * no internal metadata re-fetch, closing the validate-then-refetch TOCTOU a
	 * hostile RPC could exploit (`addToken` re-simulates metadata; this must
	 * not). Same lock, same idempotency, same journal machinery as `addToken`,
	 * with `origin: "seed"` / "Default token" labeling. NOT on the RPC surface.
	 */
	public async addSeededToken(input: {
		profileId: string
		networkId: string
		accountAddress: string
		tokenInterface: TokenInterface
		name: string
		symbol: string
		decimals: number
	}): Promise<TokenInfo> {
		await this.ensureInitialized()
		const { profileId, networkId, accountAddress, tokenInterface, name, symbol, decimals } = input

		const existing = await this.findToken(profileId, tokenInterface.chainId, tokenInterface.contract)
		if (existing) {
			return getTokenInfo(existing)
		}

		const journalOp = await this.journal.createOperation({
			kind: "token_import",
			origin: "seed",
			profileId,
			accountAddress,
			networkId,
			contractAddress: tokenInterface.contract,
			title: symbol,
			subtitle: "Default token",
		})

		// Catch stays INSIDE the locked section — see addToken (audit D3).
		return await this.lock.withLock(async () => {
			try {
				await this.journal.transitionOperation(journalOp.id, { stage: "simulating" })
				let token = await this.findToken(profileId, tokenInterface.chainId, tokenInterface.contract)
				if (!token) {
					token = {
						id: await nextNumericId(this.tokens),
						profileId,
						chainId: tokenInterface.chainId,
						contract: tokenInterface.contract,
						name,
						symbol,
						decimals,
						getNameFn: tokenInterface.getNameFn,
						getSymbolFn: tokenInterface.getSymbolFn,
						getDecimalsFn: tokenInterface.getDecimalsFn,
						balanceOfPublicFn: tokenInterface.balanceOfPublicFn,
						balanceOfPrivateFn: tokenInterface.balanceOfPrivateFn,
						transferPublicFn: tokenInterface.transferPublicFn,
						transferPrivateFn: tokenInterface.transferPrivateFn,
						transferPublicToPrivateFn: tokenInterface.transferPublicToPrivateFn,
						transferPrivateToPublicFn: tokenInterface.transferPrivateToPublicFn,
					}
					await this.tokens.set(`${token.id}`, token)
					this.emit("onTokenAdded", getTokenInfo(token))
				}
				const result = getTokenInfo(token)
				await this.journal.transitionOperation(journalOp.id, { stage: "succeeded" })
				return result
			} catch (error) {
				await this.journal.transitionOperation(
					journalOp.id,
					{ stage: "failed" },
					normalizeError(error, classifyTokenImportError(error)),
				)
				throw error
			}
		})
	}

	public async updateToken(
		profileId: string,
		networkId: string,
		accountAddress: string,
		tokenId: number,
		tokenInterface: TokenInterface,
	): Promise<TokenInfo> {
		await this.ensureInitialized()
		const stepContent = new StepContent("Updating token")
		const task = this.tasks.startNewTask(stepContent)

		// Catch stays INSIDE the locked section: task.fail must be recorded
		// while the token lock is held, so a freed waiter can never run before
		// the task reflects the failure (audit H1 — same class as addToken).
		return await this.lock.withLock(async () => {
			try {
				const _token = await this.tokens.get(`${tokenId}`)
				if (!_token) {
					throw new Error("unknown token id")
				}
				if (
					_token.profileId !== profileId ||
					_token.chainId !== tokenInterface.chainId ||
					_token.contract !== tokenInterface.contract
				) {
					throw new Error("token profile id, chain id and contract cannot change")
				}
				const [name, symbol, decimals] = await this.fetchTokenMetadata(profileId, networkId, accountAddress, tokenInterface)
				const token: Token = {
					id: _token.id,
					profileId: _token.profileId,
					chainId: _token.chainId,
					contract: _token.contract,
					name: name,
					symbol: symbol,
					decimals: decimals,
					getNameFn: tokenInterface.getNameFn,
					getSymbolFn: tokenInterface.getSymbolFn,
					getDecimalsFn: tokenInterface.getDecimalsFn,
					balanceOfPublicFn: tokenInterface.balanceOfPublicFn,
					balanceOfPrivateFn: tokenInterface.balanceOfPrivateFn,
					transferPublicFn: tokenInterface.transferPublicFn,
					transferPrivateFn: tokenInterface.transferPrivateFn,
					transferPublicToPrivateFn: tokenInterface.transferPublicToPrivateFn,
					transferPrivateToPublicFn: tokenInterface.transferPrivateToPublicFn,
				}
				await this.tokens.set(`${token.id}`, token)
				this.emit("onTokenUpdated", getTokenInfo(token))
				const result = getTokenInfo(token)
				task.complete()
				return result
			} catch (error) {
				task.fail(error)
				throw error
			}
		})
	}

	public async deleteToken(id: number): Promise<TokenInfo> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profiles)
		const token = requireOwnedRow(await this.tokens.get(`${id}`), profile.id, "unknown token id")
		// An explicit user delete of a DEFAULT token writes a permanent
		// tombstone: the seeder must never resurrect it — not on the next
		// unlock, and not after a network remove/re-add (tombstones survive
		// chain purges; only the attempt bookkeeping resets there).
		if (findSeed(token.chainId, token.contract)) {
			await this.seeder.markDeletedByUser(profile.id, token.chainId, token.contract)
		}
		return this._deleteTokenById(id)
	}

	/**
	 * Delete a token row by id with NO active-profile ownership guard — the
	 * profile-delete cascade calls this for an explicit, possibly-INACTIVE
	 * profile's tokens (an active-profile guard here would throw and orphan
	 * them). The public `deleteToken` RPC does the ownership check first.
	 */
	private async _deleteTokenById(id: number, emit = true): Promise<TokenInfo> {
		return await this.lock.withLock(async () => {
			const token = await this.tokens.get(`${id}`)
			if (!token) {
				throw new Error("unknown token id")
			}
			await this.tokens.delete(`${id}`)
			if (emit) this.emit("onTokenDeleted", { ...getTokenInfo(token), profileId: token.profileId })
			return getTokenInfo(token)
		})
	}

	public async getTokenInterface(networkId: string, tokenId: number): Promise<TokenInterface> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profiles)
		const token = requireOwnedRow(await this.tokens.get(`${tokenId}`), profile.id, "unknown token id")

		const network = await this.networks.getNetwork(networkId)
		if (!network) {
			throw new Error("unknown network id")
		}

		const pxe = this.pxeService.getPXE(networkInfoFrom(network))

		const instance = await pxe.getContractInstance(AztecAddress.fromStringUnsafe(token.contract))
		if (!instance) {
			throw new Error("contract instance not found")
		}

		const artifact = await pxe.getContractArtifact(instance.currentContractClassId)
		if (!artifact) {
			throw new Error("contract artifact not found")
		}

		await ensureRegistered(pxe, token.contract, instance, artifact)

		const getNameFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.getName, artifact).map((x) => x.getImpl())
		const getNameFn = token.getNameFn

		const getSymbolFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.getSymbol, artifact).map((x) => x.getImpl())
		const getSymbolFn = token.getSymbolFn

		const getDecimalsFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.getDecimals, artifact).map((x) => x.getImpl())
		const getDecimalsFn = token.getDecimalsFn

		const balanceOfPrivateFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.balanceOfPrivate, artifact).map((x) => x.getImpl())
		const balanceOfPrivateFn = token.balanceOfPrivateFn

		const balanceOfPublicFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.balanceOfPublic, artifact).map((x) => x.getImpl())
		const balanceOfPublicFn = token.balanceOfPublicFn

		const transferPublicFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPublic, artifact).map((x) => x.getImpl())
		const transferPublicFn = token.transferPublicFn

		const transferPrivateFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPrivate, artifact).map((x) => x.getImpl())
		const transferPrivateFn = token.transferPrivateFn

		const transferPrivateToPublicFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPrivateToPublic, artifact).map((x) =>
			x.getImpl(),
		)
		const transferPrivateToPublicFn = token.transferPrivateToPublicFn

		const transferPublicToPrivateFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPublicToPrivate, artifact).map((x) =>
			x.getImpl(),
		)
		const transferPublicToPrivateFn = token.transferPublicToPrivateFn

		const ti: TokenInterface = {
			chainId: token.chainId,
			contract: token.contract,
			getNameFn,
			getNameFnCandidates,
			getSymbolFn,
			getSymbolFnCandidates,
			getDecimalsFn,
			getDecimalsFnCandidates,
			balanceOfPublicFn,
			balanceOfPublicFnCandidates,
			balanceOfPrivateFn,
			balanceOfPrivateFnCandidates,
			transferPublicFn,
			transferPublicFnCandidates,
			transferPrivateFn,
			transferPrivateFnCandidates,
			transferPublicToPrivateFn,
			transferPublicToPrivateFnCandidates,
			transferPrivateToPublicFn,
			transferPrivateToPublicFnCandidates,
			isComplete: false,
		}
		ti.isComplete = isTokenComplete(ti)
		return ti
	}

	/**
	 * `expectedClassId` is the seeder's TOFU pin: when provided, the FETCHED
	 * instance must present exactly that `currentContractClassId` (and echo
	 * the requested address) BEFORE the artifact is fetched or anything is
	 * registered in the PXE — a rejected seed leaves no artifact behind, and
	 * the returned interface derives from the SAME fetch that passed the pin
	 * (no refetch window for a hostile RPC to substitute). Mismatch throws
	 * `PinMismatchError`. Callers without a pin are unaffected.
	 */
	public async parseTokenInterface(
		networkId: string,
		contract: string,
		parentTask?: WrappedTask,
		expectedClassId?: string,
	): Promise<TokenInterface> {
		await this.ensureInitialized()
		const stepContent = new StepContent("Parsing token interface")
		const task = parentTask ? parentTask.startSubtask(stepContent) : this.tasks.startNewTask(stepContent)

		try {
			const network = await this.networks.getNetwork(networkId)
			if (!network) {
				throw new Error("unknown network id")
			}

			const pxe = this.pxeService.getPXE(networkInfoFrom(network))

			const instance = await pxe.getContractInstance(AztecAddress.fromStringUnsafe(contract))
			if (!instance) {
				throw new Error("contract instance not found")
			}

			if (expectedClassId !== undefined) {
				if (instance.address.toString().toLowerCase() !== contract.toLowerCase()) {
					throw new PinMismatchError(`instance address ${instance.address.toString()} ≠ requested ${contract}`)
				}
				if (instance.currentContractClassId.toString() !== expectedClassId) {
					throw new PinMismatchError(`class id ${instance.currentContractClassId.toString()} ≠ pinned ${expectedClassId}`)
				}
			}

			const artifact = await pxe.getContractArtifact(instance.currentContractClassId)
			if (!artifact) {
				throw new Error("contract artifact not found")
			}

			await ensureRegistered(pxe, contract, instance, artifact)

			const getNameFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.getName, artifact)
			const getNameFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.getName, getNameFnCandidates)

			const getSymbolFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.getSymbol, artifact)
			const getSymbolFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.getSymbol, getSymbolFnCandidates)

			const getDecimalsFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.getDecimals, artifact)
			const getDecimalsFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.getDecimals, getDecimalsFnCandidates)

			const balanceOfPrivateFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.balanceOfPrivate, artifact)
			const balanceOfPrivateFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.balanceOfPrivate, balanceOfPrivateFnCandidates)

			const balanceOfPublicFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.balanceOfPublic, artifact)
			const balanceOfPublicFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.balanceOfPublic, balanceOfPublicFnCandidates)

			const transferPublicFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPublic, artifact)
			const transferPublicFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.transferPublic, transferPublicFnCandidates)

			const transferPrivateFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPrivate, artifact)
			const transferPrivateFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.transferPrivate, transferPrivateFnCandidates)

			const transferPrivateToPublicFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPrivateToPublic, artifact)
			const transferPrivateToPublicFn = getDefaultTokenFn(
				TOKEN_FN_DESCRIPTORS.transferPrivateToPublic,
				transferPrivateToPublicFnCandidates,
			)

			const transferPublicToPrivateFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPublicToPrivate, artifact)
			const transferPublicToPrivateFn = getDefaultTokenFn(
				TOKEN_FN_DESCRIPTORS.transferPublicToPrivate,
				transferPublicToPrivateFnCandidates,
			)

			const result: TokenInterface = {
				chainId: network.chainId,
				contract,
				getNameFn: getNameFn?.getImpl(),
				getNameFnCandidates: getNameFnCandidates.map((x) => x.getImpl()),
				getSymbolFn: getSymbolFn?.getImpl(),
				getSymbolFnCandidates: getSymbolFnCandidates.map((x) => x.getImpl()),
				getDecimalsFn: getDecimalsFn?.getImpl(),
				getDecimalsFnCandidates: getDecimalsFnCandidates.map((x) => x.getImpl()),
				balanceOfPublicFn: balanceOfPublicFn?.getImpl(),
				balanceOfPublicFnCandidates: balanceOfPublicFnCandidates.map((x) => x.getImpl()),
				balanceOfPrivateFn: balanceOfPrivateFn?.getImpl(),
				balanceOfPrivateFnCandidates: balanceOfPrivateFnCandidates.map((x) => x.getImpl()),
				transferPublicFn: transferPublicFn?.getImpl(),
				transferPublicFnCandidates: transferPublicFnCandidates.map((x) => x.getImpl()),
				transferPrivateFn: transferPrivateFn?.getImpl(),
				transferPrivateFnCandidates: transferPrivateFnCandidates.map((x) => x.getImpl()),
				transferPublicToPrivateFn: transferPublicToPrivateFn?.getImpl(),
				transferPublicToPrivateFnCandidates: transferPublicToPrivateFnCandidates.map((x) => x.getImpl()),
				transferPrivateToPublicFn: transferPrivateToPublicFn?.getImpl(),
				transferPrivateToPublicFnCandidates: transferPrivateToPublicFnCandidates.map((x) => x.getImpl()),
				isComplete: false,
			}
			result.isComplete = isTokenComplete(result)
			task.complete()
			return result
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	/**
	 * Resolve a token's user-facing metadata (name, symbol, decimals) WITHOUT
	 * persisting anything. Wraps `parseTokenInterface` + the private
	 * `fetchTokenMetadata`. Used by the `register_token` popup pre-fetch so the
	 * user sees what they're approving before pressing Allow.
	 *
	 * The returned strings come from the on-chain contract — a malicious contract
	 * can return any name/symbol. UI MUST render the contract address alongside.
	 */
	public async previewTokenMetadata(
		networkId: string,
		accountAddress: string,
		contract: string,
		expectedClassId?: string,
	): Promise<{ name: string; symbol: string; decimals: number; interface: TokenInterface }> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profiles, "Wallet locked")
		const tokenInterface = await this.parseTokenInterface(networkId, contract, undefined, expectedClassId)
		const [name, symbol, decimals] = await this.fetchTokenMetadata(profile.id, networkId, accountAddress, tokenInterface)
		return { name, symbol, decimals, interface: tokenInterface }
	}

	private async fetchTokenMetadata(
		profileId: string,
		networkId: string,
		address: string,
		ti: TokenInterface,
	): Promise<[string, string, number]> {
		const network = await this.networks.getNetwork(networkId)
		if (!network) {
			throw new Error("unknown network id")
		}

		const account = await this.accounts.getAccountContract(profileId, network.chainId, address)

		const node = await this.networks.getNode(network.chainId)
		const pxe = this.pxeService.getPXE(networkInfoFrom(network))

		const getNameFn = ti.getNameFn ? createViewTokenFn(TOKEN_FN_DESCRIPTORS.getName, ti.getNameFn.name, ti.getNameFn.impl) : undefined
		const getSymbolFn = ti.getSymbolFn
			? createViewTokenFn(TOKEN_FN_DESCRIPTORS.getSymbol, ti.getSymbolFn.name, ti.getSymbolFn.impl)
			: undefined
		const getDecimalsFn = ti.getDecimalsFn
			? createViewTokenFn(TOKEN_FN_DESCRIPTORS.getDecimals, ti.getDecimalsFn.name, ti.getDecimalsFn.impl)
			: undefined

		return [
			getNameFn
				? ((await simulate(node, pxe, account, ti.contract, getNameFn, getNameFn.buildArgs())) as string)
				: ti.contract === feeJuiceAddress
					? feeJuiceName
					: "<name>",
			getSymbolFn
				? ((await simulate(node, pxe, account, ti.contract, getSymbolFn, getSymbolFn.buildArgs())) as string)
				: ti.contract === feeJuiceAddress
					? feeJuiceSymbol
					: "<symbol>",
			getDecimalsFn ? ((await simulate(node, pxe, account, ti.contract, getDecimalsFn, getDecimalsFn.buildArgs())) as number) : 0,
		]
	}

	private async findToken(profileId: string, chainId: number, contract: string): Promise<Token | undefined> {
		const tokens = await this.tokens.getValues()
		return tokens.find((token) => token.profileId === profileId && token.chainId === chainId && token.contract === contract)
	}

	/** Awaited profile-scoped token purge, called by the deletion coordinator
	 *  (relocated from the removed fire-and-forget `onProfileDeleted` sub — D).
	 *  Idempotent. `_deleteTokenById` emits `onTokenDeleted` with the authoritative
	 *  profileId (P6), so token-balance/incoming cleanup stays profile-accurate. */
	public async purgeForProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		this.logDebug(`purgeForProfile ${profileId}: remove related tokens`)
		await this.seeder.purgeForProfile(profileId)
		// The coordinator purged journals BEFORE this method runs, but a seed
		// commit landing in between creates a fresh `token_import` journal row
		// that nothing later sweeps. The seeder fence above guarantees no
		// further commits, so an idempotent journal re-purge here catches
		// exactly that window.
		await this.journal.purgeForProfile(profileId)
		for (const token of (await this.tokens.getValues()).filter((x) => x.profileId === profileId)) {
			// SILENT (emit=false): the deletion coordinator awaits token-balance +
			// incoming-transfer purges DIRECTLY, so re-emitting onTokenDeleted here is
			// redundant and its fire-and-forget consumer could clobber a successor
			// that reuses the highest token id (audit H3).
			await this._deleteTokenById(token.id, false)
		}
		// F-B23: raw second pass — a validation-failed row this profile owns is
		// invisible to getValues() and would otherwise survive the purge forever.
		await purgeMalformedRows(
			this.tokens,
			(raw) => raw.profileId === profileId,
			(id) => this.logDebug(`purged malformed token row ${id}`),
		)
	}

	public async backup(): Promise<Token[]> {
		const profile = await requireActiveProfile(this.profiles)

		return await this.getTokensRaw(profile.id)
	}

	public async restore(tokens: Token[]): Promise<Restored<Token>[]> {
		await this.ensureInitialized()

		return await this.lock.withLock(async () => {
			// Shared numeric cursor across the batch: ids are one global sequence,
			// so a single write consumes an id and the next row picks up after it.
			let id = await nextNumericId(this.tokens)
			return await restoreRows(tokens, async (token) => {
				// Validate the persisted shape BEFORE consuming an id/writing: a token
				// with e.g. `chainId: "1:"` would otherwise "succeed", have a balance
				// relinked to it, then be rejected by the read codec — leaving an
				// orphaned balance. Parsing here records it as a restoreError instead.
				const row = TokenSchema.parse({ ...token, id })
				await this.tokens.set(`${id}`, row)
				id++
				return row
			})
		})
	}
}

/**
 * Categorize a token-import error for `JobError.kind`. Categories drive
 * future per-kind UX; today they're purely observational.
 */
function classifyTokenImportError(err: unknown): string {
	if (err instanceof Error) {
		const msg = err.message.toLowerCase()
		if (msg.includes("unknown network")) return "network_unreachable"
		if (msg.includes("necessary methods") || msg.includes("interface")) return "contract_invalid"
		if (msg.includes("simulate") || msg.includes("metadata")) return "metadata_fetch"
	}
	return "unknown"
}
