/**
 * Best-effort "queued" journal-record creation at wallet-sdk message arrival.
 *
 * Extracted from `background.ts` so the cap + pre-auth + parsing logic is
 * unit-testable without spinning up the full BackgroundConnectionHandler.
 *
 * Behaviour:
 *   - Skip queued visibility when:
 *       - no active profile
 *       - no matching dapp session
 *       - no `transaction` capability grant
 *       - per-session cap reached (MAX_QUEUED_PER_SESSION)
 *       - global cap reached (MAX_QUEUED_GLOBAL)
 *   - Skip ONLY for `sendTx` messages — caller is responsible for routing.
 *   - Cap enforcement is atomic via `queuedCreationLock` — without this,
 *     concurrent arrivals all see a stale count and the cap is advisory
 *     rather than protective (codex + opus post-impl F1).
 */
import type { WalletMessage } from "@aztec/wallet-sdk/types"
import type { ActiveSession } from "@aztec/wallet-sdk/extension/handlers"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"
import { Lock, getErrorMessage } from "@nulo/wallet-core/utils"
import type { OperationJournalService } from "@/wallet/services/operation-journal/service"
import type { ProfileService } from "@/wallet/services/profile/service"
import type { DappSessionService } from "@/wallet/services/dapp-session/service"
import type { NetworkService } from "@/wallet/services/network/service"
import type { AccountService } from "@/wallet/services/account/service"
import { resolveAuthorizedSessionAccount } from "@nulo/wallet-bridge"
import { parseCaipAccount, resolveNetworkByChainId } from "@/wallet/utils/caip"
import type { CaipAccount } from "@/wallet/services/dapp-interaction/spec"
import { pickPrimaryMethod } from "@/utils/primary-method"

/** Per-session queued-record cap. Bounds the activity feed under burst flood. */
export const MAX_QUEUED_PER_SESSION = 8
/** Global queued-record cap across all sessions. Coarser DoS backstop. */
export const MAX_QUEUED_GLOBAL = 32

/** Module-level lock around count + create. Closes the burst-bypass race
 *  flagged by codex + opus in the post-impl review. */
export const queuedCreationLock = new Lock("wallet-sdk-bg:queued-creation")

/**
 * Mirror of background.ts's chainInfoToChainId. Inlined to keep this module
 * test-harness-friendly (avoids dragging the full background.ts import
 * graph into unit tests). XORs chainId with rollup version per
 * NetworkService convention.
 */
import type { Fr } from "@aztec/foundation/curves/bn254"
function chainInfoToChainId(obj: { chainInfo: { chainId: Fr | string; version: Fr | string } }): number {
	const raw = obj.chainInfo
	const chainId = typeof raw.chainId === "string" ? Number(BigInt(raw.chainId)) : Number(raw.chainId.toBigInt())
	const version = typeof raw.version === "string" ? Number(BigInt(raw.version)) : Number(raw.version.toBigInt())
	return (chainId ^ version) >>> 0
}

export interface TryCreateQueuedJournalDeps {
	journal: OperationJournalService
	profile: ProfileService
	dappSession: DappSessionService
	networkSvc: NetworkService
	/** Supplies wallet-ordered accounts, so the record is filed under the same
	 *  account the dispatcher will send from. */
	account: AccountService
	logger: ILogger
}

/**
 * The sender a sendTx message names, if it names one.
 *
 * Mirrors the dispatcher's normalization exactly (`handleSendTx`): absent or
 * `NO_FROM` means "let the wallet pick", and anything else is stringified. A
 * stricter rule here would diverge — a non-string `from` the dispatcher coerces
 * and honors would be read as no-from on this side, filing the record under the
 * default account while the send goes out as another.
 */
export function extractSendFrom(message: WalletMessage): string | undefined {
	const opts = (message as { args?: unknown[] }).args?.[1] as Record<string, unknown> | undefined
	const from = opts?.from
	if (from == null || from === "NO_FROM") return undefined
	return String(from)
}

/**
 * Create a journal record at `queued` stage so the activity feed surfaces
 * an incoming sendTx the moment it arrives — BEFORE the per-session FIFO
 * lets the handler open the approval popup.
 *
 * Returns the new record's id, or `undefined` on any failure. Best-effort
 * visibility: a failure here NEVER blocks the actual handler from running
 * (the handler falls back to creating its own in-flight record via
 * `beginDappExecuteJournal`).
 *
 * Cheap pre-auth gates: skip queued visibility when there's no active
 * profile, no dapp session, or no sendTx capability grant. Avoids
 * surfacing requests that the handler will reject anyway.
 *
 * Cap enforcement is atomic: the count-then-create section runs under
 * `queuedCreationLock` so concurrent arrivals can't all see a stale
 * "below cap" count and over-create.
 */
export async function tryCreateQueuedJournal(
	message: WalletMessage,
	session: ActiveSession,
	deps: TryCreateQueuedJournalDeps,
): Promise<string | undefined> {
	const { journal, profile, dappSession, networkSvc, account: accountSvc, logger } = deps
	try {
		const activeProfile = await profile.getActiveProfile()
		if (!activeProfile) return undefined
		// Captured WITH the profile, asserted by the journal at persist time: if
		// this profile is deleted (even deleted-and-reimported under the same id)
		// while we resolve session/account/network below, the create is refused
		// instead of writing stale dApp metadata into the successor incarnation.
		const profileEpoch = profile.getDeletionState().capture(activeProfile.id)

		const chainId = chainInfoToChainId(session)
		const dapp = await dappSession.tryGetDappSessionByOriginAndChain(session.origin, String(chainId))
		if (!dapp?.accounts?.length) return undefined

		// sendTx requires the `transaction` capability (the capability type
		// scoped to send-like operations). Pre-auth-gate skip when missing.
		const hasSendTxGrant = (dapp.capabilityGrants ?? []).some((g) => g.capability.type === "transaction")
		if (!hasSendTxGrant) return undefined

		// The record must name the account this send will actually go out as, so it
		// resolves through the SAME rule the dispatcher uses — session-authorized
		// explicit sender, else the first wallet-ordered session account. Taking
		// `accounts[0]` instead would file a multi-account session's operation
		// under whichever address the session happened to list first.
		const sessionAddresses = new Set(dapp.accounts.map((caip: string) => parseCaipAccount(caip as CaipAccount).address))
		// Visible accounts only — the SAME set the dispatcher resolves against
		// (`resolveNetworkAndAccount`). Including hidden accounts here would let a
		// hidden lower-index account win the default on this side but not on the
		// dispatcher's, which is precisely the divergence this shared rule exists
		// to prevent.
		const walletAccounts = await accountSvc.getAccounts(activeProfile.id, chainId)
		const resolved = resolveAuthorizedSessionAccount({
			walletAccounts,
			sessionAddresses,
			requestedFrom: extractSendFrom(message),
		})
		// An unauthorized or unresolvable sender is left un-journaled: the dispatch
		// itself will refuse it, and a record naming the wrong account is worse
		// than no record.
		if (!resolved.ok) return undefined
		const accountAddress = resolved.account.address

		// `networkId` for activity-feed scoping must be the INTERNAL network row id
		// (RecentActivityView.journalRecordInScope filters on `network.id`), NOT
		// `String(chainId)`. Without this resolution the queued card never renders.
		const network = await resolveNetworkByChainId(networkSvc, chainId)
		if (!network) return undefined

		// Critical section: cap check + record create must be atomic.
		await queuedCreationLock.enter()
		try {
			const sessionQueuedCount = await journal.countOperations({
				sessionId: session.sessionId,
				stage: "queued",
			})
			if (sessionQueuedCount >= MAX_QUEUED_PER_SESSION) {
				logger.log(
					"wallet-sdk-bg",
					LogLevel.Debug,
					`Per-session queued cap reached for ${session.sessionId}; skipping queued visibility`,
				)
				return undefined
			}
			const globalQueuedCount = await journal.countOperations({ stage: "queued" })
			if (globalQueuedCount >= MAX_QUEUED_GLOBAL) {
				logger.log("wallet-sdk-bg", LogLevel.Warn, `Global queued cap reached (${MAX_QUEUED_GLOBAL}); skipping queued visibility`)
				return undefined
			}

			const primaryMethod = extractPrimaryMethodFromSendTx(message)
			// Chip label: prefer the dApp's display name from its stored
			// session metadata (DappSession.dappMetadata.name, set at
			// discover/verify time). Falls back to "Unknown dapp" to match
			// the pre-existing execution path (`dapp-interaction/service.ts:309`)
			// so the queued record's subtitle equals what the live-claim record
			// would have gotten — keeps the chip text identical across queued
			// vs first-tx paths. NOTE: dappMetadata lives on DappSession (our
			// stored session), NOT on ActiveSession (the wallet-sdk transport
			// session) — those are two different types that both happen to be
			// in scope here. Previously this used `session.origin` (the full
			// URL on the transport session), which surfaced raw URLs in the
			// activity-card chip.
			const dappName = dapp.dappMetadata?.name ?? "Unknown dapp"
			const record = await journal.createOperation({
				kind: "dapp_execute",
				origin: "dapp",
				profileId: activeProfile.id,
				profileEpoch,
				sessionId: session.sessionId,
				accountAddress,
				networkId: network.id,
				title: primaryMethod ?? "Transaction",
				subtitle: dappName,
				initialStage: { stage: "queued" },
			})
			return record.id
		} finally {
			queuedCreationLock.leave()
		}
	} catch (error) {
		logger.log("wallet-sdk-bg", LogLevel.Warn, `tryCreateQueuedJournal failed: ${getErrorMessage(error)}`)
		return undefined
	}
}

/**
 * Best-effort primary-method extraction from a sendTx wallet message.
 * Mirrors what `executeAztecSendTx` does to compute the title at journal
 * creation time, so the title is consistent between the queued surface
 * and the post-claim in-flight surface.
 */
export function extractPrimaryMethodFromSendTx(message: WalletMessage): string | undefined {
	if (message.type !== "sendTx") return undefined
	const args = message.args as unknown[] | undefined
	if (!Array.isArray(args)) return undefined
	const exec = args[0] as { calls?: Array<{ name?: string }> } | undefined
	return pickPrimaryMethod(exec?.calls)
}
