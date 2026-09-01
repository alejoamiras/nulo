/**
 * Full-backup restore stages, extracted from useFullBackupImport.ts as module functions
 * (the deposit-flow.ts pattern). No Vue reactivity: the composable passes a RestoreIo of
 * LIVE callbacks — never a captured error-log object (its ref value is replaced at restore
 * start). Stages return typed terminal descriptors rendered by ONE applyOutcome, so every
 * status/stage/error combination is explicit; the copy stays with the branch that earns it.
 * Behavior is pinned by useFullBackupImport.stages.test.ts + the pre-existing 74-test suite;
 * every transform here is a verbatim transcription.
 */

import { asBase64CredentialId, asBase64MasterSecret } from "@nulo/wallet-crypto"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import { isClientDisconnectRejection, RpcDisconnectedError, UserRejectedError } from "@nulo/extension-messaging/errors"
import { awaitLivenessAdvance, readLiveness } from "@/utils/background-liveness"
import { remapByMap, resolveRestoredActiveNetworkId } from "@/utils/full-backup-helpers"
import type { PasskeyRequest } from "@/wallet/services/passkey/spec"
import type { RestoreSecret } from "@/wallet/services/profile/client"
import { IMPORTED_KEYS_SERVICE_NAME } from "@/wallet/services/account/spec"
import { ACCOUNT_STATE_SERVICE_NAME } from "@/wallet/services/account-state/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { TOKEN_SERVICE_NAME } from "@/wallet/services/token/spec"
import { TokenServiceClient } from "@/wallet/services/token/client"
import { AccountStateServiceClient } from "@/wallet/services/account-state/client"
import { runImportChainSync } from "./importChainSync"

export type RestoreStatus = "" | "progress" | "failed" | "finished" | null | undefined

/**
 * Phase marker for the restore leg, exposed to the import pages as
 * `data-restore-stage`. OBSERVABILITY ONLY — no control flow reads it; it
 * exists so a crash mid-restore is attributable to a NAMED phase (the
 * `restoreStatus` field is flat "progress" across the whole leg). The
 * `rolling-back` / `rolled-back` / `rollback-failed` values are the one
 * genuinely new signal: a direct causal marker for the pre-finalize orphan
 * rollback, instead of inferring it from storage side effects.
 */
export type RestoreStage =
	| ""
	| "picked"
	| "restoring:profile"
	| "restoring:networks"
	| "restoring:tokens"
	| "restoring:services"
	| "finalizing"
	| "restoring:account-state"
	| "chain-sync"
	| "finished"
	| "failed"
	| "rolling-back"
	| "rolled-back"
	| "rollback-failed"

/** B-24: how many times to retry the compensating profile delete on rollback. */
const ROLLBACK_MAX_ATTEMPTS = 3

// Ceiling for the crash-rollback liveness gate. Structural, never the success
// mechanism: the SW heartbeat re-writes liveness every 10s and a booting
// worker writes immediately after full wiring, so a healthy respawn resolves
// in seconds; 60s (the transport RPC ceiling) bounds the pathological case,
// after which the rollback fails CLOSED to the cleanup-pending path.
const LIVENESS_CEILING_MS = 60_000

/** Shown when a partial import can't be rolled back — the profile row survives,
 *  so tell the user how to remove it rather than hiding the failure. */
export const CLEANUP_PENDING_MESSAGE =
	"Import didn't finish and the partial profile couldn't be removed automatically. Delete it in Settings, then try again."

/** The composable-owned io a stage reads and writes — live callbacks only. */
export interface RestoreIo {
	fillError: (type: string, title: string, tooltip?: string) => void
	setStatus: (s: RestoreStatus) => void
	setStage: (s: RestoreStage) => void
	/** collectRestoreErrors + append into the live error log (never a captured object). */
	recordRestoreErrors: (serviceName: string, data: unknown) => void
	/** Direct append for pre-collected records (the dropped-balances path). */
	appendErrors: (serviceName: string, records: unknown[]) => void
}

/** A stage's terminal descriptor. "proceed" carries the stage's payload; everything else
 *  ends the restore and is rendered exactly once by applyOutcome. */
export type StageFail = { kind: "fail"; title: string; message: string; status?: RestoreStatus }
export type StageOutcome = { kind: "proceed" } | StageFail | { kind: "silent-reset" }

/** Render a terminal outcome; returns true when the flow must stop. */
export function applyOutcome(io: RestoreIo, o: StageOutcome): boolean {
	if (o.kind === "proceed") return false
	if (o.kind === "silent-reset") {
		io.setStatus("")
		return true
	}
	io.setStatus(o.status ?? "failed")
	io.fillError("full_backup", o.title, o.message)
	return true
}

/** Bookkeeping the outer catch must see the moment it exists (deposit's out-param pattern). */
export interface RestoreScratch {
	createdProfileId: string | undefined
	finalizeStarted: boolean
}

/** The service-client surfaces the stages consume — structural, so the composable's
 *  real clients and the suites' fakes both satisfy them. */
/* The client surfaces below use METHOD-SHORTHAND syntax deliberately: TS checks shorthand
 * methods bivariantly, so the real service clients (whose params are narrower branded
 * types) remain assignable while the stages stay honestly typed at the call sites. */
export interface ProfileRestoreClient {
	restore(
		profile: unknown,
		secret: RestoreSecret,
		password: string,
		credentialData: PasskeyCredentialData | undefined,
		allowDuplicate: boolean | undefined,
	): Promise<{ id: string; restoreError?: unknown } | undefined>
	finalizeRestore(profileId: string, password: string | undefined): Promise<unknown>
	deleteProfile(profileId: string): Promise<unknown>
	disconnect(): void
}
export interface NetworkRestoreClient {
	restore(rows: unknown): Promise<unknown>
	setActiveForProfile(profileId: string, networkId: string): Promise<unknown>
	probeNodeStatus(networkId: string, timeoutMs: number): Promise<unknown>
	disconnect(): void
}
export interface AccountRestoreClient {
	restoreImportedKeys(rows: unknown[]): Promise<unknown>
	reconcileImportedAccounts(profileId: string): Promise<unknown[]>
	disconnect(): void
}

/**
 * B-24: roll back a partially-imported profile with a bounded retry, shared
 * by all three failure paths. A single `deleteProfile` that rejected
 * (e.g. its tombstone write failed) used to be swallowed to `console.error`,
 * leaving the profile row as a normal, selectable, never-finalized entry.
 * Returns whether the orphan was actually removed so the caller can surface
 * an actionable "cleanup pending" message instead of a generic failure.
 */
export async function rollbackCreatedProfile(profileService: ProfileRestoreClient, profileId: string): Promise<boolean> {
	for (let attempt = 1; attempt <= ROLLBACK_MAX_ATTEMPTS; attempt++) {
		try {
			await profileService.deleteProfile(profileId)
			return true
		} catch (err) {
			// NOTE: deleteProfile is commit-ambiguous / non-idempotent — a
			// prior partial attempt may reserve the id so a retry sees "Invalid
			// profile id". We deliberately do NOT treat that as success (the
			// reservation can be dropped on a worker restart, re-revealing the
			// orphan), nor is a persistent failure provably durable. Surfacing
			// the actionable cleanup-pending message is the safe conservative
			// choice; a truly authoritative deletion-status check is a
			// ProfileService-level follow-up beyond this rollback helper.
			console.error(`[full-backup] rollback delete attempt ${attempt}/${ROLLBACK_MAX_ATTEMPTS} failed:`, err)
		}
	}
	return false
}

/** Rollback-with-copy shared by the no-networks and duplicate-account paths. Deliberately
 *  does NOT emit rolling-back/rolled-back stage markers (historical: the stage stays at
 *  the last restoring:* value — pinned by the stages suite). */
async function rollbackAndFail(
	profileService: ProfileRestoreClient,
	profileId: string,
	rolledBackCopy: { title: string; message: string },
): Promise<StageFail> {
	const rolledBack = await rollbackCreatedProfile(profileService, profileId)
	if (rolledBack) return { kind: "fail", ...rolledBackCopy }
	return { kind: "fail", title: "Import incomplete", message: CLEANUP_PENDING_MESSAGE }
}

/** Path A passkey-ceremony handoff. For passkey backups, the backup's `master-key` IS the
 *  credentialId (see `ProfileService.exportPlain` passkey return). Run the modal against
 *  that credentialId so the service receives `credentialData` and skips its own SW-window
 *  path. Without this the service throws `credentialData is required`. */
export async function resolvePasskeyCredential(
	profile: { type: "password" | "passkey" },
	masterKey: string,
	runCeremony: ((req: PasskeyRequest) => Promise<PasskeyCredentialData>) | undefined,
): Promise<
	({ kind: "proceed"; credentialData: PasskeyCredentialData | undefined } & Record<never, never>) | StageFail | { kind: "silent-reset" }
> {
	if (profile.type !== "passkey") return { kind: "proceed", credentialData: undefined }
	if (!runCeremony) {
		return { kind: "fail", title: "Can't import", message: "Passkey ceremony not wired — restart the popup and try again." }
	}
	try {
		return { kind: "proceed", credentialData: await runCeremony({ mode: "get", credentialId: masterKey }) }
	} catch (err) {
		// Silent cancel matches the rest of the wallet (auth.vue, profile/new.vue,
		// import.vue:handleImportPasskey). Reset restoreStatus so the form is usable
		// again — without it, the Import button stays disabled because the page's
		// status guard only re-enables on "" / null / undefined.
		if (err instanceof UserRejectedError) return { kind: "silent-reset" }
		return { kind: "fail", title: "Couldn't authenticate", message: err instanceof Error ? err.message : String(err) }
	}
}

/**
 * Construct the profile-type-discriminated restore secret at the backup boundary:
 * `master-key` is a base64 plain master key for password profiles and the credentialId for
 * passkey profiles. Epoch-4 password blobs REQUIRE the `entropy` field (the recovery phrase
 * re-displays from it; the service verifies the words derive the master before sealing);
 * passkey blobs must NOT carry one. The imported-keys DEK carrier is likewise REQUIRED —
 * plaintext beside the plaintext master for password blobs, the sealed row blob for passkey
 * blobs (extras of the OTHER carrier are deliberately ignored — asymmetry preserved).
 */
export function buildRestoreSecret(
	profile: { type: "password" | "passkey" },
	backup: Record<string, unknown>,
	masterKey: string,
): ({ kind: "proceed"; restoreSecret: RestoreSecret } & Record<never, never>) | StageFail {
	const entropyField = backup.entropy
	if (profile.type === "password" && typeof entropyField !== "string") {
		return { kind: "fail", title: "Can't import", message: "This backup is missing its recovery-phrase entropy." }
	}
	if (profile.type === "passkey" && entropyField !== undefined) {
		return { kind: "fail", title: "Can't import", message: "A passkey backup must not carry an entropy field." }
	}
	// Epoch-4 shape: the service uses the carrier only inside the rewrap context (clone
	// divergence: the restored row gets a FRESH dek; the backup's key rows rewrap onto it).
	const dekField = backup["imported-keys-dek"]
	const dekSealedField = backup["imported-keys-dek-sealed"]
	if (profile.type === "password" && typeof dekField !== "string") {
		return { kind: "fail", title: "Can't import", message: "This backup is missing its imported-keys key." }
	}
	if (profile.type === "passkey" && typeof dekSealedField !== "string") {
		return { kind: "fail", title: "Can't import", message: "This backup is missing its imported-keys key." }
	}
	const restoreSecret: RestoreSecret =
		profile.type === "password"
			? {
					type: "password",
					masterKey: asBase64MasterSecret(masterKey),
					entropy: entropyField as string,
					importedKeysDek: dekField as string,
				}
			: { type: "passkey", credentialId: asBase64CredentialId(masterKey), dekSealed: dekSealedField as string }
	return { kind: "proceed", restoreSecret }
}

export interface RestoredNetwork {
	id: string
	name: string
	rpcUrl: string
	chainId: number
	restoreError?: string
}

/**
 * Networks stage: restore, index-paired remap, error recording, and the no-networks
 * rollback. Pair each restored network to its source by RESULT INDEX, not a field-match:
 * `NetworkService.restore` returns exactly one result per input, in order, and spreads a
 * FAILED input's raw fields back into its result — so a field-match (name/rpcUrl/chainId)
 * is attacker-ambiguous (an invalid net A + a valid net B sharing those fields could pair
 * B with A and graft A's account-state onto B's PXE target). Index-pairing is unforgeable.
 * Only remap for a SUCCESSFUL restore whose id actually changed.
 */
export async function restoreNetworksStage(
	data: Record<string, unknown>,
	networkService: NetworkRestoreClient,
	profileService: ProfileRestoreClient,
	profileId: string,
	io: RestoreIo,
): Promise<({ kind: "proceed"; newNetworks: RestoredNetwork[]; createdNetworks: RestoredNetwork[] } & Record<never, never>) | StageFail> {
	const newNetworks = (await networkService.restore(data.network)) as RestoredNetwork[]
	const createdNetworks = newNetworks.filter((n) => !n.restoreError)

	if (!createdNetworks.length) {
		return rollbackAndFail(profileService, profileId, {
			title: "Can't import",
			message: "Couldn't restore any networks from this backup",
		})
	}

	const oldNetworks = data.network as Array<{ id: string }>
	// A duplicated source id can't form an unambiguous old→new map, so skip
	// it (its networkId rows stay un-remapped → account-state finds no
	// matching created network and ignores them). Backup normalization already
	// rejects duplicate root ids; this is a defensive backstop.
	const sourceIdCounts = new Map<string, number>()
	for (const n of oldNetworks) sourceIdCounts.set(n.id, (sourceIdCounts.get(n.id) ?? 0) + 1)
	const oldToNew = new Map<string, string>()
	for (let i = 0; i < newNetworks.length; i++) {
		const restored = newNetworks[i]
		const old = oldNetworks[i]
		if (restored.restoreError || !old || old.id === restored.id || (sourceIdCounts.get(old.id) ?? 0) > 1) continue
		oldToNew.set(old.id, restored.id)
	}
	// ONE pass over the COMPLETE map — each row's original networkId is looked
	// up exactly once, so a freshly-random new id colliding with a later source
	// id can't cascade-rewrite already-remapped rows (finding E).
	remapByMap(data, "networkId", oldToNew)
	io.recordRestoreErrors(NETWORK_SERVICE_NAME, newNetworks)
	return { kind: "proceed", newNetworks, createdNetworks }
}

/**
 * Item 1b: restore the user's ACTIVE-network selection. The exported `active-network-id` is
 * a RAW old id resolved through the COMPLETE source→successful-result pairing (identity for
 * unchanged ids — the changed-only remap map above can't be reused). Write it for the NEW
 * profile via the profileId-parameterized setter BEFORE `finalizeRestore` (the profile isn't
 * active yet). Absent / hostile / unmatched → skip; the bootstrap primary fallback applies.
 */
export async function restoreActiveNetworkPointer(
	activeNetworkId: unknown,
	newNetworks: RestoredNetwork[],
	oldNetworks: Array<{ id: string }>,
	networkService: NetworkRestoreClient,
	profileId: string,
): Promise<void> {
	const restoredActiveId = resolveRestoredActiveNetworkId(activeNetworkId, newNetworks, oldNetworks)
	if (!restoredActiveId) return
	try {
		await networkService.setActiveForProfile(profileId, restoredActiveId)
	} catch (activeErr) {
		// `requireOwnedRow` rejection or a write hiccup — leave the pointer unset; the bootstrap
		// picks the primary network. Never fail the whole import over the active-network pointer.
		console.warn("[full-backup] could not restore active-network selection:", activeErr)
	}
}

/**
 * Accounts stage: account rows + imported-account key rows (RIGHT AFTER the account rows and
 * BEFORE reconciliation/finalize — the ciphertext is HKDF-bound to (master, chainId, address),
 * not profileId, so it survives the id remap). The duplicate-account collision rolls back;
 * any other failure rethrows so the orphan profile isn't left half-restored.
 */
export async function restoreAccountsStage(
	data: Record<string, unknown>,
	deps: {
		accountService: AccountRestoreClient
		profileService: ProfileRestoreClient
		profileId: string
		io: RestoreIo
		/** Stays exported from useFullBackupImport.ts — injected to avoid a module cycle. */
		restoreAccountsAndFilterOwnedSlices: (
			data: never,
			accountService: never,
			record: (name: string, rows: unknown) => void,
		) => Promise<ReadonlySet<string>>
	},
): Promise<({ kind: "proceed"; importedChainAddress: ReadonlySet<string> } & Record<never, never>) | StageFail> {
	const { accountService, profileService, profileId, io } = deps
	try {
		const importedChainAddress = await deps.restoreAccountsAndFilterOwnedSlices(
			data as never,
			accountService as never,
			io.recordRestoreErrors,
		)
		const importedKeySlice = data[IMPORTED_KEYS_SERVICE_NAME]
		if (Array.isArray(importedKeySlice)) {
			io.recordRestoreErrors(IMPORTED_KEYS_SERVICE_NAME, await accountService.restoreImportedKeys(importedKeySlice as never))
		}
		return { kind: "proceed", importedChainAddress }
	} catch (err) {
		// `AccountService` throws `new Error("Duplicate account")` when an imported row
		// collides with one already in storage. Rows are keyed by `(profileId, chainId,
		// address)`, so importing the same mnemonic into a NEW profile no longer collides —
		// this now fires only for a genuine repeat of the same account. The RPC layer
		// (`extension-messaging/client.ts`) reconstructs that as an `Error` instance on the
		// client — so match on `.message`, not via string-equality on `err` itself.
		const msg = err instanceof Error ? err.message : String(err)
		if (msg === "Duplicate account") {
			// NetworkService.onProfileDeleted cascades — purges this profile's networks
			// automatically. No explicit cleanup needed.
			return rollbackAndFail(profileService, profileId, {
				title: "Can't import",
				message: "An account from this backup is already in your wallet",
			})
		}
		// Non-duplicate failure: fall through to the outer catch so the orphan profile
		// isn't left in a half-restored state.
		throw err
	} finally {
		accountService.disconnect()
	}
}

/** Tokens stage: restore + balance re-link + error recording (P7: disconnect even on throw). */
export async function restoreTokensStage(
	data: Record<string, unknown>,
	importedChainAddress: ReadonlySet<string>,
	io: RestoreIo,
	relinkRestoredTokenBalances: (data: never, newTokens: never, allow: ReadonlySet<string>) => unknown[],
): Promise<void> {
	const tokenService = new TokenServiceClient()
	let tokenRestoreResult: unknown
	try {
		tokenRestoreResult = await tokenService.restore(data.token as never)
	} finally {
		tokenService.disconnect() // P7: disconnect even if restore throws
	}
	const newTokens = tokenRestoreResult as Array<{ id: unknown; chainId: number; contract: string; restoreError?: string }>
	if ((data["token-balance"] as unknown[] | undefined)?.length) {
		const droppedBalances = relinkRestoredTokenBalances(data as never, newTokens as never, importedChainAddress)
		if (droppedBalances.length) io.appendErrors("token-balance", droppedBalances)
	}
	io.recordRestoreErrors(TOKEN_SERVICE_NAME, newTokens)
}

/** One service's restore surface in the six-client loop. */
export interface SliceRestoreClient {
	restore: (rows: unknown[], profileId: string) => Promise<unknown>
	disconnect: () => void
}

/**
 * The six-service loop. Whole-loop try/finally: every client is constructed up-front, so a
 * mid-loop throw (or a non-array slice that skips a client's body) must still disconnect
 * ALL of them — a per-iteration finally would only clean the client that threw, leaking
 * the ones after it (P7). The created-profile id rides along on every restore: authwits
 * and txs key their deletion fence on it, balances additionally derive their identity
 * fields from it; the rest ignore the extra argument.
 */
export async function restoreServiceSlices(
	data: Record<string, unknown>,
	services: Array<{ name: string; client: SliceRestoreClient }>,
	profileId: string,
	io: RestoreIo,
): Promise<void> {
	try {
		for (const { name, client } of services) {
			const sliceData = data[name]
			if (Array.isArray(sliceData)) {
				io.recordRestoreErrors(name, await client.restore(sliceData, profileId))
			}
		}
	} finally {
		for (const { client } of services) client.disconnect()
	}
}

/**
 * Restore account-state (PXE contract registrations + senders) AFTER finalizeRestore — its
 * `registerContract` needs the per-profile PXE store key, which the client's
 * PXE_STORE_KEY_MISSING retry-once provisions via `getProfileSecret` — and that only yields
 * the master once the session is OPEN (finalizeRestore opens it). BOUNDED: this is the one
 * import leg that dials the network (the PXE boot for a restored network fetches L1
 * addresses from its rpcUrl — a URL the BACKUP controls); the tail runs on one shared
 * wall-clock budget through the SAME errors screen. Present-but-malformed slices (a hostile
 * `{}`/`null`) MUST still enter the chain-sync: the normalizer converts them into a
 * violation record — gating on Array.isArray here would let a malformed slice auto-route
 * past the Continue gate unrecorded.
 */
export async function restoreAccountStateStage(
	data: Record<string, unknown>,
	createdNetworks: RestoredNetwork[],
	networkService: NetworkRestoreClient,
	io: RestoreIo,
): Promise<void> {
	const accountStateSlice = data[ACCOUNT_STATE_SERVICE_NAME]
	if (accountStateSlice === undefined) return
	const accountStateService = new AccountStateServiceClient()
	try {
		io.setStage("chain-sync")
		await runImportChainSync({
			slice: accountStateSlice,
			createdNetworkIds: createdNetworks.map((n) => n.id),
			restore: (items, deadlineMs) => accountStateService.restore(items as never, createdNetworks as never, deadlineMs) as never,
			probe: (networkId, timeoutMs) => networkService.probeNodeStatus(networkId, timeoutMs) as never,
			record: (records) => io.recordRestoreErrors(ACCOUNT_STATE_SERVICE_NAME, records),
		})
	} finally {
		accountStateService.disconnect()
	}
}

/**
 * The outer-catch rollback: pre-finalize failure with a created profile deletes the orphan
 * so a retry starts clean; post-finalize errors keep the profile (its data is fully in
 * storage — the user can unlock it later). A DISCONNECT-classified failure means the
 * service worker died mid-restore (MV3 respawn gap): any delete issued now rejects in
 * milliseconds against doomed ports, before a worker exists to refuse it. Gate the
 * rollback on the worker's own liveness signal advancing (written only after full service
 * wiring, so the deletion coordinator is guaranteed registered); the ceiling fails CLOSED
 * to the same cleanup-pending path, backed by the restore-pending marker's torn-unlock
 * refusal. Non-disconnect failures keep the immediate path — the worker is alive; waiting
 * would only add latency.
 */
export async function runRestoreFailurePath(
	err: unknown,
	scratch: RestoreScratch,
	profileService: ProfileRestoreClient,
	io: RestoreIo,
): Promise<void> {
	if (scratch.createdProfileId !== undefined && !scratch.finalizeStarted) {
		io.setStage("rolling-back")
		let workerReady = true
		if (isClientDisconnectRejection(err) || err instanceof RpcDisconnectedError) {
			// One failure handler spans BOTH the baseline read and the advance wait: a
			// rejected storage read must fail CLOSED to the same cleanup-pending path,
			// never escape this catch with the stage stuck at rolling-back.
			workerReady = await readLiveness()
				.then((baseline) => awaitLivenessAdvance(baseline, LIVENESS_CEILING_MS))
				.then(
					() => true,
					(gateErr) => {
						console.error("[full-backup] rollback liveness gate failed:", gateErr)
						return false
					},
				)
		}
		if (workerReady && (await rollbackCreatedProfile(profileService, scratch.createdProfileId))) {
			io.setStage("rolled-back")
		} else {
			// The orphan couldn't be removed — surface an actionable message instead of the
			// generic failure, and mark the import failed.
			io.setStage("rollback-failed")
			io.setStatus("failed")
			io.fillError("full_backup", "Import incomplete", CLEANUP_PENDING_MESSAGE)
			console.error((err as Error)?.message || err)
			return
		}
	} else {
		io.setStage("failed")
	}
	io.setStatus("")
	io.fillError("full_backup", "Import failed", String((err as Error)?.message ?? err))
	console.error((err as Error)?.message || err)
}
