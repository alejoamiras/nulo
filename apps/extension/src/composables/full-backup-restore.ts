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
import { capRecords, remapNetworkIdByChain, resolveRestoredActiveNetworkIdByChain } from "@/utils/full-backup-helpers"
import type { PasskeyRequest } from "@/wallet/services/passkey/spec"
import type { RestoreSecret } from "@/wallet/services/profile/client"
import { ACCOUNT_SERVICE_NAME, IMPORTED_KEYS_SERVICE_NAME } from "@/wallet/services/account/spec"
import { AUTH_REGISTRY_SERVICE_NAME } from "@/wallet/services/auth-registry/spec"
import { TOKEN_BALANCE_SERVICE_NAME } from "@/wallet/services/token-balance/spec"
import { ACCOUNT_STATE_SERVICE_NAME } from "@/wallet/services/account-state/spec"
import { TRANSACTION_SERVICE_NAME } from "@/wallet/services/transaction/spec"
import { TOKEN_SERVICE_NAME } from "@/wallet/services/token/spec"
import { TokenServiceClient } from "@/wallet/services/token/client"
import { AccountStateServiceClient } from "@/wallet/services/account-state/client"
import type { NormalizedAccountStateItem } from "@/wallet/services/account-state/normalize"
import { NetworkServiceClient } from "@/wallet/services/network/client"
import { runImportChainSync } from "./importChainSync"
import { errorMessageFromUnknown } from "@nulo/wallet-core/utils"

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
	/** collectRestoreErrors + append into the live error log (never a captured object); returns
	 *  the rows it appended. */
	recordRestoreErrors: (serviceName: string, data: unknown) => unknown[]
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
	seedDefaultsForProfile(profileId: string): Promise<unknown>
	setActiveForProfile(profileId: string, networkId: string): Promise<unknown>
	probeNodeStatus(networkId: string, timeoutMs: number): Promise<unknown>
	disconnect(): void
}
export interface AccountRestoreClient {
	restore(rows: unknown[] | undefined): Promise<unknown>
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
		return { kind: "fail", title: "Couldn't authenticate", message: errorMessageFromUnknown(err) }
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
 * Networks stage: the backup carries no network rows — the built-in networks are seeded for the
 * restored profile and every row that names a chain is bound to the seed of that chain. Rows on
 * a chain no seed serves (a custom network's state) are dropped and reported; nothing in the
 * backup can choose an endpoint.
 */
export async function reseedNetworksStage(
	data: Record<string, unknown>,
	networkService: NetworkRestoreClient,
	profileService: ProfileRestoreClient,
	profileId: string,
	io: RestoreIo,
): Promise<({ kind: "proceed"; seeded: RestoredNetwork[] } & Record<never, never>) | StageFail> {
	let seeded: RestoredNetwork[] = []
	try {
		seeded = ((await networkService.seedDefaultsForProfile(profileId)) as RestoredNetwork[]).filter((n) => !n.restoreError)
	} catch (error) {
		console.warn("[full-backup] seeding the default networks failed:", error)
	}
	if (!seeded.length) {
		return rollbackAndFail(profileService, profileId, {
			title: "Can't import",
			message: "Couldn't seed the default networks for this backup",
		})
	}
	// Ordinal-only records: the dropped rows are backup payload (senders, artifacts, tx bodies)
	// and the error log is user-visible and exportable.
	const dropped = remapNetworkIdByChain(data, seeded, [ACCOUNT_STATE_SERVICE_NAME, TRANSACTION_SERVICE_NAME])
	for (const [slice, ordinals] of Object.entries(dropped)) {
		io.appendErrors(
			slice,
			capRecords(ordinals.map((row) => ({ row, restoreError: "Skipped: its network is not one of the built-in networks" }))),
		)
	}
	return { kind: "proceed", seeded }
}

/**
 * The exported `active-chain-id` is a preference among the seeded networks; anything that does
 * not name a seeded chain leaves the primary seed active. Written for the NEW profile via the
 * profileId-parameterized setter BEFORE `finalizeRestore` (the profile is not active yet).
 */
export async function restoreActiveNetworkPointer(
	activeChainId: unknown,
	seeded: RestoredNetwork[],
	networkService: NetworkRestoreClient,
	profileId: string,
): Promise<void> {
	const restoredActiveId = resolveRestoredActiveNetworkIdByChain(activeChainId, seeded as Array<{ id: string; chainId: number }>)
	if (!restoredActiveId) return
	try {
		await networkService.setActiveForProfile(profileId, restoredActiveId)
	} catch (activeErr) {
		// `requireOwnedRow` rejection or a write hiccup — the primary seed the reseed already
		// pointed at stays active. Never fail the whole import over the active-network pointer.
		console.warn("[full-backup] could not restore active-network selection:", activeErr)
	}
}

/** The migrated backup body the restore stages read and filter in place. */
export type RestoreData = Record<string, unknown> & {
	account?: unknown[]
	network?: unknown[]
	token?: unknown[]
	"token-balance"?: Array<Record<string, unknown>>
	profile?: { id: string; name?: string }
}

/** Bound on dropped-balance records. This path never reaches the collector, so it carries no cap
 *  of its own — and a hostile backup can ship tens of thousands of un-relinkable rows. */
const MAX_DROPPED_BALANCES_RECORDED = 200

// Account and token restores forward absent slices unchanged, and their results stay unvalidated:
// keep the local names, because native errors reach the import failure copy.

/**
 * Restores the account slice, then drops every transaction, authwit and token-balance row whose
 * account this restore did not import successfully. Mutates `data` in place and returns the
 * `${chainId}:${address}` allow-set of imported accounts, which the balance re-link requires for
 * its chain-equality check: thread it, never re-derive it. Client lifecycle, the duplicate-account
 * catch and stage markers stay with the caller; every throw propagates with its identity intact
 * (the caller matches `.message`, the outer catch classifies disconnects).
 */
export async function restoreAccountsAndFilterOwnedSlices(
	data: RestoreData,
	accountService: AccountRestoreClient,
	recordRestoreErrors: (serviceName: string, rows: unknown) => void,
): Promise<Set<string>> {
	const importedChainAddress = new Set<string>()
	const newAccounts = await accountService.restore(data.account)
	recordRestoreErrors(ACCOUNT_SERVICE_NAME, newAccounts)

	// Provenance filter for EVERY account-owned slice (tx, auth-registry,
	// token-balance). Each service writes rows verbatim and reads them by
	// `account`, so a backup row whose `account` is NOT an account
	// SUCCESSFULLY imported by THIS restore could surface in a victim
	// profile (auth-registry corrupts its revocation index; a balance
	// grafts under the victim). "Account exists in storage" is NOT
	// sufficient (a crafted backup could name a pre-existing foreign
	// account); the allow-set is exactly this restore's accounts. Drop
	// BEFORE the restore loop below writes them.
	const importedAddresses = new Set<string>()
	for (const a of newAccounts as Array<{ address?: unknown; chainId?: unknown; restoreError?: unknown }>) {
		if (a.restoreError || typeof a.address !== "string") continue
		importedAddresses.add(a.address)
		if (typeof a.chainId === "number") importedChainAddress.add(`${a.chainId}:${a.address}`)
	}
	// Drop-and-record via console.warn, NOT restoreErrorLog: a filtered row
	// is a security action (foreign/corrupt account, nothing the user did or
	// can fix), so it must not flip a clean import into the "finished with
	// errors" UX. A failed-account row is already surfaced by its account's
	// own restoreError above.
	const filterByAccount = (name: string, keep: (row: Record<string, unknown>) => boolean, label: string) => {
		const slice = (data as Record<string, unknown>)[name]
		if (!Array.isArray(slice)) return
		let dropped = 0
		;(data as Record<string, unknown>)[name] = (slice as Array<Record<string, unknown>>).filter((row) => {
			const ok = keep(row)
			if (!ok) dropped++
			return ok
		})
		if (dropped > 0) {
			console.warn(`[full-backup-import] dropped ${dropped} ${label} referencing an account not imported from this backup`)
		}
	}
	// tx carries its OWN chainId → key by the (chainId, account) tuple so a
	// tx can't reference an imported address on a DIFFERENT chain.
	filterByAccount(
		TRANSACTION_SERVICE_NAME,
		(tx) => typeof tx.account === "string" && typeof tx.chainId === "number" && importedChainAddress.has(`${tx.chainId}:${tx.account}`),
		"transaction(s)",
	)
	// auth-registry rows carry their own chainId → the same (chainId, account) key as txs.
	// token-balance rows carry identity fields too, but those are DERIVED service-side at
	// restore — address membership here is a pre-filter, with token-ownership + chain-equality
	// in the re-link step below.
	filterByAccount(
		AUTH_REGISTRY_SERVICE_NAME,
		(aw) => typeof aw.account === "string" && typeof aw.chainId === "number" && importedChainAddress.has(`${aw.chainId}:${aw.account}`),
		"authwit(s)",
	)
	filterByAccount(
		TOKEN_BALANCE_SERVICE_NAME,
		(tb) => typeof tb.account === "string" && importedAddresses.has(tb.account),
		"token-balance(s)",
	)
	return importedChainAddress
}

/**
 * Re-links restored balance rows to this restore's tokens by result index and drops each one whose
 * account was not imported on its token's chain. Mutates `data["token-balance"]` in place and
 * returns the dropped rows, restoreError-tagged, for the caller to append.
 */
export function relinkRestoredTokenBalances(
	data: RestoreData,
	newTokens: Array<{ id: unknown; chainId: number; contract: string; restoreError?: string }>,
	importedChainAddress: ReadonlySet<string>,
): unknown[] {
	// Pair each restored token to its source by RESULT INDEX
	// (`TokenService.restore` returns one ordered result per input, same as
	// networks). This REPLACES the (chainId,contract) composite key: no
	// cross-chain collapse, no ambiguity heuristic, and one duplicate token
	// FAILING no longer drops a surviving token's balance. The index also
	// gives token-OWNERSHIP for free — a balance's token maps only to a
	// token THIS restore created.
	const oldTokens = data.token as Array<{ id: unknown; chainId: number }>
	// NB (dup-token-id): the index-paired maps below key on `old.id`, so two
	// backup tokens sharing an id would last-wins-collapse. That case is
	// UNREACHABLE here — backup normalization rejects a slice with a duplicate
	// row id up front (backup-migration-registry.ts "duplicate row id"), so a
	// dup-token-id backup fails before restore. No composable guard needed.
	const oldIdToNew = new Map<unknown, unknown>()
	const oldIdToChain = new Map<unknown, number>()
	for (let i = 0; i < newTokens.length; i++) {
		const old = oldTokens[i]
		if (!old || newTokens[i].restoreError) continue
		// Chain authority is the RESTORED token (parsed, persisted) — the old row is raw
		// attacker-controlled blob content, and a failed row must not feed the chain map.
		oldIdToChain.set(old.id, newTokens[i].chainId)
		oldIdToNew.set(old.id, newTokens[i].id)
	}
	const droppedBalances: unknown[] = []
	let droppedTotal = 0
	data["token-balance"] = (data["token-balance"] as Array<Record<string, unknown>>).flatMap(
		(tb: Record<string, unknown>, index: number) => {
			const newId = oldIdToNew.get(tb.token)
			// token/account chain-equality (final pass): the balance's account
			// must be an account imported ON THE TOKEN'S CHAIN. Addresses are
			// chain-distinct, so this rejects a balance pairing an imported
			// account with a token on a chain that account wasn't imported on.
			const tokenChain = oldIdToChain.get(tb.token)
			const chainOk =
				tokenChain !== undefined && typeof tb.account === "string" && importedChainAddress.has(`${tokenChain}:${tb.account}`)
			if (newId === undefined || !chainOk) {
				// This path bypasses `collectRestoreErrors` entirely — these rows are dropped BEFORE any
				// service sees them — so it must do its own allowlisting AND its own bounding.
				//
				// `tb` is raw, unvalidated backup content: it carries `publicBalance`/`privateBalance`,
				// and migration validates only `tb.id`, so `token` can be an arbitrary nested object
				// holding a URL or a secret. Only the POSITION is recorded, which is all that
				// distinguishes one dropped row from another anyway.
				droppedTotal++
				if (droppedBalances.length < MAX_DROPPED_BALANCES_RECORDED) {
					droppedBalances.push({
						row: index,
						restoreError: "Token balance could not be re-linked to a restored token",
					})
				}
				return []
			}
			return [{ ...tb, token: newId }]
		},
	)
	// Say what was dropped rather than letting the cap read as "exactly 200 failures".
	if (droppedTotal > droppedBalances.length) {
		droppedBalances.push({
			restoreError: `${droppedTotal - droppedBalances.length} further dropped balance(s) not recorded`,
		})
	}
	return droppedBalances
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
	},
): Promise<({ kind: "proceed"; importedChainAddress: ReadonlySet<string> } & Record<never, never>) | StageFail> {
	const { accountService, profileService, profileId, io } = deps
	try {
		const importedChainAddress = await restoreAccountsAndFilterOwnedSlices(data, accountService, io.recordRestoreErrors)
		const importedKeySlice = data[IMPORTED_KEYS_SERVICE_NAME]
		if (Array.isArray(importedKeySlice)) {
			io.recordRestoreErrors(IMPORTED_KEYS_SERVICE_NAME, await accountService.restoreImportedKeys(importedKeySlice))
		}
		return { kind: "proceed", importedChainAddress }
	} catch (err) {
		// `AccountService` throws `new Error("Duplicate account")` when an imported row
		// collides with one already in storage. Rows are keyed by `(profileId, chainId,
		// address)`, so importing the same mnemonic into a NEW profile no longer collides —
		// this now fires only for a genuine repeat of the same account. The RPC layer
		// (`extension-messaging/client.ts`) reconstructs that as an `Error` instance on the
		// client — so match on `.message`, not via string-equality on `err` itself.
		const msg = errorMessageFromUnknown(err)
		if (msg === "Duplicate account") {
			// NetworkService.onProfileDeleted cascades — purges this profile's networks
			// automatically. No explicit cleanup needed.
			// `return await` (not a bare return): the finally's disconnect must run AFTER the
			// bounded rollback completes, matching the original catch-then-finally ordering.
			return await rollbackAndFail(profileService, profileId, {
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
): Promise<void> {
	const tokenService = new TokenServiceClient()
	let tokenRestoreResult: unknown
	try {
		tokenRestoreResult = await tokenService.restore(data.token)
	} finally {
		tokenService.disconnect() // P7: disconnect even if restore throws
	}
	const newTokens = tokenRestoreResult as Array<{ id: unknown; chainId: number; contract: string; restoreError?: string }>
	if ((data["token-balance"] as unknown[] | undefined)?.length) {
		const droppedBalances = relinkRestoredTokenBalances(data, newTokens, importedChainAddress)
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
 * import leg that dials the network (the PXE boot fetches L1 addresses from the compiled-in
 * seed endpoint of the chain the item names — never from anything the backup carries); the
 * tail runs on one shared wall-clock budget through the SAME errors screen. Present-but-malformed slices (a hostile
 * `{}`/`null`) MUST still enter the chain-sync: the normalizer converts them into a
 * violation record — gating on Array.isArray here would let a malformed slice auto-route
 * past the Continue gate unrecorded. Resolves with what a Retry replays when a network is left
 * retryable.
 */
export async function restoreAccountStateStage(
	data: Record<string, unknown>,
	createdNetworks: RestoredNetwork[],
	networkService: NetworkRestoreClient,
	io: RestoreIo,
): Promise<AccountStateRetryContext | undefined> {
	const accountStateSlice = data[ACCOUNT_STATE_SERVICE_NAME]
	if (accountStateSlice === undefined) return undefined
	const accountStateService = new AccountStateServiceClient()
	let outcomeRows: unknown[] = []
	try {
		io.setStage("chain-sync")
		const retryable = await runImportChainSync({
			slice: accountStateSlice,
			...chainSyncClients(accountStateService, networkService, createdNetworks),
			record: (records, kind) => {
				const rows = io.recordRestoreErrors(ACCOUNT_STATE_SERVICE_NAME, records)
				if (kind === "outcomes") outcomeRows = rows
			},
		})
		return retryable.length ? { networks: createdNetworks, retryable, outcomeRows } : undefined
	} finally {
		accountStateService.disconnect()
	}
}

/** What a Retry replays. It lives in the page's memory while the errors screen shows and is
 *  never persisted: the items are hostile backup content, bounded by the normalizer. */
export interface AccountStateRetryContext {
	networks: RestoredNetwork[]
	/** The normalized items of the networks the last run left retryable. */
	retryable: NormalizedAccountStateItem[]
	/** The account-state rows the registration outcomes wrote, the only ones a Retry replaces. */
	outcomeRows: unknown[]
}

/** The rows a Retry of `ctx` replaces: the retried networks' outcome rows only. A violation row
 *  records entries the normalizer discarded, which no registration brings back. */
export function retryReplacedRows(ctx: AccountStateRetryContext): unknown[] {
	const retried = new Set<unknown>(ctx.retryable.map((item) => item.networkId))
	return ctx.outcomeRows.filter((row) => retried.has((row as { networkId?: unknown } | null)?.networkId))
}

/**
 * Replays the chain-sync tail for the networks the last run left retryable, on fresh connections
 * closed once it settles. `replaceRestoreErrors` swaps the retried networks' outcome rows for the
 * Retry's own and returns the rows it wrote. Resolves with the next context, or `undefined` when no
 * network is left to retry.
 */
export async function retryAccountStateStage(
	ctx: AccountStateRetryContext,
	replaceRestoreErrors: (serviceName: string, stale: unknown[], data: unknown) => unknown[],
): Promise<AccountStateRetryContext | undefined> {
	const accountStateService = new AccountStateServiceClient()
	const networkService = new NetworkServiceClient()
	let records: unknown[] = []
	try {
		const retryable = await runImportChainSync({
			slice: ctx.retryable,
			...chainSyncClients(accountStateService, networkService, ctx.networks),
			// Items the normalizer already bounded yield no violations: only outcomes arrive.
			record: (outcomes, kind) => {
				if (kind === "outcomes") records = outcomes
			},
		})
		const stale = retryReplacedRows(ctx)
		const fresh = replaceRestoreErrors(ACCOUNT_STATE_SERVICE_NAME, stale, records)
		const outcomeRows = [...ctx.outcomeRows.filter((row) => !stale.includes(row)), ...fresh]
		return retryable.length ? { networks: ctx.networks, retryable, outcomeRows } : undefined
	} finally {
		accountStateService.disconnect()
		networkService.disconnect()
	}
}

function chainSyncClients(
	accountStateService: AccountStateServiceClient,
	networkService: NetworkRestoreClient,
	networks: RestoredNetwork[],
) {
	return {
		createdNetworkIds: networks.map((n) => n.id),
		restore: (items: unknown[], deadlineMs: number) =>
			accountStateService.restore(items as never, networks as never, deadlineMs) as Promise<unknown>,
		probe: (networkId: string, timeoutMs: number) => networkService.probeNodeStatus(networkId, timeoutMs) as never,
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
