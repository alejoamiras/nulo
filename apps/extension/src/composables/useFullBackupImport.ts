import { computed, ref, type Ref } from "vue"
import { EncryptionKey } from "@nulo/wallet-crypto"
import { sanitizeString } from "@/utils/string"
import { AccountServiceClient } from "@/wallet/services/account/client"
import { ACCOUNT_SERVICE_NAME } from "@/wallet/services/account/spec"
import { AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"
import { AUTH_REGISTRY_SERVICE_NAME } from "@/wallet/services/auth-registry/spec"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { CONFIG_SERVICE_NAME } from "@/wallet/services/config/spec"
import { ContactServiceClient } from "@/wallet/services/contact/client"
import { CONTACT_SERVICE_NAME } from "@/wallet/services/contact/spec"
import { FpcServiceClient } from "@/wallet/services/fpc/client"
import { FPC_SERVICE_NAME } from "@/wallet/services/fpc/spec"
import { NetworkServiceClient } from "@/wallet/services/network/client"
import { ProfileServiceClient, type RestoreSecret } from "@/wallet/services/profile/client"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { TOKEN_BALANCE_SERVICE_NAME } from "@/wallet/services/token-balance/spec"
import { TransactionServiceClient } from "@/wallet/services/transaction/client"
import { TRANSACTION_SERVICE_NAME } from "@/wallet/services/transaction/spec"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import type { PasskeyRequest } from "@/wallet/services/passkey/spec"
import { type BackupSelection, collectRestoreErrors, normalizeAllIds, readBackupFile } from "@/utils/full-backup-helpers"
import { BACKUP_SCHEMA_VERSION_FIELD, COMPAT_EPOCH_FIELD, isSupportedCompatEpoch } from "@/wallet/services/backup/backup-migration-registry"
import { maxBackupSchemaVersion, migrateBackupData } from "@/wallet/services/backup/backup-migrator"
import {
	applyOutcome,
	buildRestoreSecret,
	type RestoreIo,
	type RestoreScratch,
	resolvePasskeyCredential,
	restoreAccountStateStage,
	restoreAccountsStage,
	restoreActiveNetworkPointer,
	restoreNetworksStage,
	restoreServiceSlices,
	restoreTokensStage,
	runRestoreFailurePath,
} from "./full-backup-restore"

export type { RestoreStage, RestoreStatus } from "./full-backup-restore"
import type { RestoreStage, RestoreStatus } from "./full-backup-restore"

/** Bound on dropped-balance records. This path never reaches the collector, so it carries no cap
 *  of its own — and a hostile backup can ship tens of thousands of un-relinkable rows. */
const MAX_DROPPED_BALANCES_RECORDED = 200

/** The full-backup envelope: the checksum + the checksum-covered body. */
export type FullBackupEnvelope = {
	checksum?: string
	"compat-epoch"?: unknown
	"backup-schema-version"?: unknown
	"master-key"?: string
	"active-network-id"?: string
	data: Record<string, unknown>
}

/** The checksum-stripped body + the migrated slices that survive stage 1. */
type ValidatedBackup = {
	data: Record<string, unknown> & {
		account?: unknown[]
		network?: unknown[]
		token?: unknown[]
		"token-balance"?: Array<Record<string, unknown>>
		profile?: { id: string; name?: string }
	}
	backup: Omit<FullBackupEnvelope, "checksum">
}

type ValidateAndMigrateResult = ({ kind: "ok" } & ValidatedBackup) | { kind: "rejected"; title: string; message: string }

/**
 * Q-02: stage 1 of the full-backup restore — integrity + compatibility gate,
 * then migrate the verified slices forward, all BEFORE any live state is
 * touched. Deliberately closure-state-free (a pure function of the envelope +
 * the module-level codec/migrator): a `rejected` result carries the exact
 * user-facing title/message the caller surfaces via `fillError`; an `ok` result
 * carries the migrated `data` + the checksum-stripped `backup`. The re-entrancy
 * / permission guard and the `restoreStatus`/`fillError` side effects stay with
 * the caller.
 */
export async function validateAndMigrateBackup(fullBackup: FullBackupEnvelope): Promise<ValidateAndMigrateResult> {
	const { checksum, ...backup } = fullBackup

	// Trust-gate order is deliberate: integrity FIRST — re-serialized exactly as
	// the exporter hashed it (the exporter also hashed JSON.stringify of the
	// object, so this IS the exported body) — then the non-migratable
	// compat-epoch, then the migratable schema-version range. The checksum is
	// accidental-integrity detection only — a plain backup's checksum is
	// attacker-recomputable, so nothing downstream may treat it as authentication.
	const comparisonChecksum = await EncryptionKey.getHashHex(JSON.stringify(backup))
	if (checksum !== comparisonChecksum) {
		return {
			kind: "rejected",
			title: "Backup Integrity Check Failed",
			message: "The backup file appears to be corrupted or has been tampered with. Please ensure you have the correct backup file.",
		}
	}

	// A pre-baseline blob (the legacy conflated `schema-version: 2`, no
	// `compat-epoch`) fails this gate too — intended fail-closed.
	if (!isSupportedCompatEpoch(backup[COMPAT_EPOCH_FIELD])) {
		return {
			kind: "rejected",
			title: "Incompatible backup",
			message:
				"This backup was created by an incompatible wallet version and cannot be imported. Re-export a backup from a current version of the wallet.",
		}
	}

	const backupSchemaVersion = backup[BACKUP_SCHEMA_VERSION_FIELD]
	if (typeof backupSchemaVersion !== "number" || !Number.isInteger(backupSchemaVersion) || backupSchemaVersion < 1) {
		return {
			kind: "rejected",
			title: "Incompatible backup",
			message: "This backup does not carry a valid schema version. Re-export a backup from a current version of the wallet.",
		}
	}
	if (backupSchemaVersion > maxBackupSchemaVersion()) {
		return {
			kind: "rejected",
			title: "Backup is too new",
			message: "This backup was created by a newer version of the wallet. Update the wallet, then import it again.",
		}
	}

	// Migrate the verified slices forward BEFORE anything touches live storage:
	// pure and in-memory, so a failure here rejects the import with ZERO live
	// state to roll back. The migrated data replaces the parsed slices; the
	// checksum was already verified over the ORIGINAL bytes and is dropped —
	// migration is a pure function of verified input, so its output is covered
	// transitively (never recompute-and-trust a post-migration checksum).
	// `master-key` is a top-level field, not a slice — it never enters the migrator.
	const migrationResult = await migrateBackupData({ data: backup.data, backupSchemaVersion })
	if (migrationResult.kind === "incompatible") {
		return { kind: "rejected", title: "Incompatible backup", message: migrationResult.reason }
	}
	if (migrationResult.kind === "failed") {
		return {
			kind: "rejected",
			title: "Import failed",
			message: `The backup could not be upgraded to the current format: ${migrationResult.reason}`,
		}
	}

	return { kind: "ok", data: migrationResult.data as ValidatedBackup["data"], backup }
}

/**
 * Q-02 stage 2a: restore the account slice and drop every account-owned row
 * (transaction, auth-registry, token-balance) whose account was not
 * SUCCESSFULLY imported by THIS restore. Mutates `data` in place. Returns the
 * `${chainId}:${address}` allow-set of imported accounts — the token-balance
 * re-link (stage 2b) REQUIRES it for its chain-equality cross-check, and
 * threading it explicitly is the Q-02 verifier's constraint: the check must
 * never be re-derived or silently dropped. Client lifecycle, the
 * duplicate-account catch, and stage markers stay with the CALLER at their
 * original positions; every throw propagates with its identity intact (the
 * caller matches `.message`; the outer catch classifies disconnect
 * rejections).
 */
export async function restoreAccountsAndFilterOwnedSlices(
	data: ValidatedBackup["data"],
	accountService: AccountServiceClient,
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
	// tx can't reference an imported address on a DIFFERENT chain (F).
	filterByAccount(
		TRANSACTION_SERVICE_NAME,
		(tx) => typeof tx.account === "string" && typeof tx.chainId === "number" && importedChainAddress.has(`${tx.chainId}:${tx.account}`),
		"transaction(s)",
	)
	// auth-registry rows carry `account` only, and addresses are chain-distinct,
	// so address membership is sufficient. token-balance rows now carry identity
	// fields, but those are DERIVED service-side at restore — address membership
	// here is a pre-filter, with token-ownership + chain-equality in the re-link
	// step below.
	filterByAccount(AUTH_REGISTRY_SERVICE_NAME, (aw) => typeof aw.account === "string" && importedAddresses.has(aw.account), "authwit(s)")
	filterByAccount(
		TOKEN_BALANCE_SERVICE_NAME,
		(tb) => typeof tb.account === "string" && importedAddresses.has(tb.account),
		"token-balance(s)",
	)
	return importedChainAddress
}

/**
 * Q-02 stage 2b: re-link restored token-balance rows to THIS restore's tokens
 * by result index and enforce the token/account chain-equality cross-check
 * against the allow-set stage 2a returned. Mutates `data["token-balance"]` in
 * place; returns the dropped rows (restoreError-tagged) — the CALLER owns
 * appending them to the error log, preserving today's append point and
 * insertion order.
 */
export function relinkRestoredTokenBalances(
	data: ValidatedBackup["data"],
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

export interface UseFullBackupImportOptions {
	password: Ref<string>
	repeatedPassword: Ref<string>
	fillError: (type: string, title: string, tooltip?: string) => void
	clearError: () => void
	pickFile: () => Promise<File | null | undefined>
	completeImport: (profile: unknown) => Promise<void> | void
	/**
	 * Page-supplied passkey-ceremony driver. When the backup's profile is
	 * passkey-typed, the composable runs `{ mode: "get", credentialId }`
	 * against the page's `PasskeyCeremonyDialog` BEFORE calling
	 * `profileService.restore`. Required for passkey backups (without it,
	 * the service rejects with `credentialData is required`). Password
	 * profile imports don't touch this.
	 */
	runCeremony?: (req: PasskeyRequest) => Promise<PasskeyCredentialData>
	/**
	 * Shell-specific "show me the import errors" handler. Popup wires this
	 * to its data-viewer overlay (cacheStore + popupStore). Onboarding wires
	 * it to a simpler notification. Defaults to console.error so the
	 * composable stays usable from any shell.
	 */
	showErrorLog?: (errors: Record<string, unknown[]>) => void
	/**
	 * Optional reactive name from the parent's Profile-name input. When the
	 * trimmed value is non-empty, it overrides the backup-embedded name
	 * during `restoreBackup` via a spread-clone (the parsed backup data is
	 * NOT mutated in place). When absent or empty after trim, the
	 * backup-embedded name is used unchanged. The service's existing
	 * duplicate-name auto-suffix at `service.ts:825-840` still applies.
	 */
	profileName?: Ref<string>
	/**
	 * Duplicate-phrase override from the warn-and-confirm dialog. Set by `confirmDuplicate` while
	 * it re-runs the restore; the service then accepts the duplicate (soft guard by owner policy).
	 */
	allowDuplicate?: Ref<boolean>
	/**
	 * Wraps the restore so a `DuplicateWalletError` surfaces the shared warn-and-confirm dialog
	 * and, on confirm, re-runs with `allowDuplicate` set. Supplied by `useProfileImportFlow` so
	 * the copy + retry semantics are identical across the seed / passkey / full-backup paths.
	 * Resolves `undefined` when the user declines. Absent → no dialog (the error propagates).
	 */
	confirmDuplicate?: <T>(run: () => Promise<T>) => Promise<T | undefined>
}

export interface UseFullBackupImportResult {
	selectedBackup: Ref<BackupSelection | null>
	decryptionPassword: Ref<string>
	restoreStatus: Ref<RestoreStatus>
	restoreStage: Ref<RestoreStage>
	restoreErrorLog: Ref<Record<string, unknown[]>>
	importedProfile: Ref<unknown>
	isAllowedToImportBackup: Ref<boolean>
	isRestoreHasErrors: Ref<boolean>
	/**
	 * Backup-embedded profile name, surfaced after a successful parse so the
	 * parent page can prefill its Profile-name input. `null` until a file is
	 * picked + parsed (plain backups) or decrypted (encrypted backups).
	 * Resets to `null` in `resetBackupState`.
	 */
	parsedBackupName: Ref<string | null>
	pickBackupFile: () => Promise<void>
	decryptBackup: () => Promise<void>
	restoreBackup: () => Promise<void>
	showRestoreErrorLog: () => void
	resetBackupState: () => void
}

/** The backup-embedded profile name, sanitized for the parent's prefill watcher — a
 *  maliciously crafted backup can embed bidi-override / zero-width / unauthorized chars,
 *  and the watcher's `v-model` assignment bypasses `Input.vue`'s input-event sanitizer. */
function sanitizedBackupName(raw: unknown): string | null {
	if (typeof raw !== "string" || raw.length === 0) return null
	const cleaned = sanitizeString(raw, 32)
	return cleaned.length > 0 ? cleaned : null
}

/** The KDF + decrypt + parse chain of decryptBackup, stale-fenced between every await:
 *  a re-pick (or the too-large clear) during the KDF awaits must not have its error wiped
 *  or its selection resurrected by a late publication. */
async function openEncryptedBackup(
	sealed: string,
	password: string,
	isStale: () => boolean,
): Promise<{ kind: "stale" } | { kind: "ok"; backupObject: { data?: { profile?: { type?: string; name?: string } } } }> {
	const passhash = await EncryptionKey.getPasshash(password)
	if (isStale()) return { kind: "stale" }
	const key = await EncryptionKey.fromPasshash(passhash)
	if (isStale()) return { kind: "stale" }
	const encryptedBytes = new Uint8Array(Buffer.from(sealed, "base64"))
	const decryptedBytes = await key.decrypt(encryptedBytes)
	if (isStale()) return { kind: "stale" }
	const decodedJson = new TextDecoder().decode(decryptedBytes)
	return { kind: "ok", backupObject: JSON.parse(decodedJson) as { data?: { profile?: { type?: string; name?: string } } } }
}

/** The six post-token slice clients, constructed up-front for the whole-loop finally. */
function buildSliceClients() {
	return [
		{ name: TRANSACTION_SERVICE_NAME, client: new TransactionServiceClient() as never },
		{ name: TOKEN_BALANCE_SERVICE_NAME, client: new TokenBalanceServiceClient() as never },
		{ name: AUTH_REGISTRY_SERVICE_NAME, client: new AuthRegistryServiceClient() as never },
		{ name: FPC_SERVICE_NAME, client: new FpcServiceClient() as never },
		{ name: CONTACT_SERVICE_NAME, client: new ContactServiceClient() as never },
		{ name: CONFIG_SERVICE_NAME, client: new ConfigServiceClient() as never },
	] as Array<{ name: string; client: { restore: (rows: unknown[], profileId: string) => Promise<unknown>; disconnect: () => void } }>
}

/**
 * Profile restore with the duplicate-confirm wiring. Honors the parent-supplied
 * Profile-name override when non-empty after trim (spread-clone: the parsed `data.profile`
 * is never mutated in place — the structure may be re-read on retry paths; the service-side
 * auto-suffix still resolves collisions). The dup guard throws a TYPED error out of restore
 * (deliberately rethrown past restore's restoreError flattening); `confirmDuplicate`
 * surfaces the shared dialog and re-runs with the override. `undefined` = the user declined
 * → abandon cleanly (no profile was created — the guard runs before the row commit).
 */
async function restoreProfileStep(
	profile: { id: string; name: string; type: "password" | "passkey" },
	restoreSecret: RestoreSecret,
	credentialData: PasskeyCredentialData | undefined,
	deps: { profileService: ProfileServiceClient; opts: UseFullBackupImportOptions },
	io: RestoreIo,
): Promise<{ id: string; restoreError?: unknown } | null> {
	const { profileService, opts } = deps
	const override = opts.profileName?.value.trim()
	const profileForRestore = override ? { ...profile, name: override } : profile
	const runRestore = () =>
		profileService.restore(profileForRestore, restoreSecret, opts.password.value, credentialData, opts.allowDuplicate?.value)
	const newProfile = opts.confirmDuplicate ? await opts.confirmDuplicate(runRestore) : await runRestore()
	if (!newProfile) {
		io.setStatus("")
		return null
	}
	if (newProfile.restoreError) {
		const errMsg = newProfile.restoreError instanceof Error ? newProfile.restoreError.message : String(newProfile.restoreError)
		applyOutcome(io, { kind: "fail", title: "Import failed", message: errMsg })
		return null
	}
	return newProfile
}

/**
 * The staged restore sequence between the validate gate and completion — the order-of-restore
 * law lives here (see full-backup-restore.ts for each stage's own invariants). Returns the
 * restored profile, or null when a stage already rendered its terminal outcome. `scratch` is
 * the deposit-style out-param: the caller's catch must see `createdProfileId` and
 * `finalizeStarted` the moment they exist.
 */
async function executeRestore(
	validated: ValidatedBackup,
	scratch: RestoreScratch,
	io: RestoreIo,
	deps: { profileService: ProfileServiceClient; networkService: NetworkServiceClient; opts: UseFullBackupImportOptions },
): Promise<{ id: string; restoreError?: unknown } | null> {
	const { data, backup } = validated
	const { profileService, networkService, opts } = deps
	const masterKey = backup["master-key"] as string
	const profile = data.profile as { id: string; name: string; type: "password" | "passkey" }

	const cred = await resolvePasskeyCredential(profile, masterKey, opts.runCeremony)
	if (cred.kind !== "proceed") {
		applyOutcome(io, cred)
		return null
	}
	const secretOut = buildRestoreSecret(profile, backup as Record<string, unknown>, masterKey)
	if (secretOut.kind !== "proceed") {
		applyOutcome(io, secretOut)
		return null
	}
	const newProfile = await restoreProfileStep(profile, secretOut.restoreSecret, cred.credentialData, deps, io)
	if (!newProfile) return null
	scratch.createdProfileId = newProfile.id

	// UNCONDITIONAL all-rows remap, even when the restored root profile id is unchanged. A
	// full backup is exactly ONE profile's data, so every child row must bind to the profile
	// we just created. Guarding this on `newProfile.id !== profile.id` left a graft hole: a
	// crafted backup whose root profile id is unused (so restore keeps it) but whose child
	// rows carry a VICTIM profile id would skip the remap and write those rows under the
	// victim. Rewriting every `profileId` to `newProfile.id` closes it.
	normalizeAllIds(data, "profileId", newProfile.id)

	io.setStage("restoring:networks")
	const nets = await restoreNetworksStage(data, networkService, profileService, newProfile.id, io)
	if (nets.kind !== "proceed") {
		applyOutcome(io, nets)
		return null
	}
	await restoreActiveNetworkPointer(
		backup["active-network-id"],
		nets.newNetworks,
		data.network as Array<{ id: string }>,
		networkService,
		newProfile.id,
	)

	const accountService = new AccountServiceClient()
	const accounts = await restoreAccountsStage(data, {
		accountService,
		profileService,
		profileId: newProfile.id,
		io,
		restoreAccountsAndFilterOwnedSlices: restoreAccountsAndFilterOwnedSlices as never,
	})
	if (accounts.kind !== "proceed") {
		applyOutcome(io, accounts)
		return null
	}

	io.setStage("restoring:tokens")
	await restoreTokensStage(data, accounts.importedChainAddress, io, relinkRestoredTokenBalances as never)

	const sliceClients = buildSliceClients()
	// The profile restore above always ran first; its id is the fence key every slice
	// restore carries (defensive internal check preserved from the original).
	if (scratch.createdProfileId === undefined) {
		throw new Error("internal: services restore reached without a created profile")
	}
	io.setStage("restoring:services")
	await restoreServiceSlices(data, sliceClients, scratch.createdProfileId, io)

	// Reconcile imported accounts BEFORE activation: an epoch-4 backup carrying a type-1
	// Account row with no matching key row would restore as a zombie that fails at signing —
	// drop it now (both slices have landed). Fail-fast, deliberately uncaught: a
	// reconcile/purge failure escapes to the outer catch, which (pre-finalize) rolls the
	// created profile back — the import must not commit with orphaned balance rows. Inside
	// the call, registered dependents (token balances) are purged BEFORE the Account rows.
	// NOTE the client was disconnected by the accounts stage; the call-level transport
	// reconnects — historical behavior, preserved verbatim.
	const droppedImported = await accountService.reconcileImportedAccounts(newProfile.id)
	if (droppedImported.length > 0) {
		// Scope COUNT only — the tuples carry on-chain account addresses.
		console.warn(`[import] dropped ${droppedImported.length} imported account(s) with no key row`)
	}

	// Late activation: open the session NOW that all backup data is in storage. This emits
	// `onActiveProfileChanged` → app.vue's handler → `getOrInitNetworks`/`ensureDefaultAccount`
	// see the imported data, not an empty profile that needs default seeding.
	scratch.finalizeStarted = true
	io.setStage("finalizing")
	try {
		await profileService.finalizeRestore(newProfile.id, opts.password.value || undefined)
	} catch (err) {
		applyOutcome(io, {
			kind: "fail",
			title: "Couldn't open the imported profile",
			message: err instanceof Error ? err.message : String(err),
		})
		return null
	}

	io.setStage("restoring:account-state")
	await restoreAccountStateStage(data, nets.createdNetworks, networkService, io)
	return newProfile
}

/** The composable's reactive state, bundled for the module-level flow functions. */
interface ImportRefs {
	selectedBackup: Ref<BackupSelection | null>
	decryptionPassword: Ref<string>
	restoreStatus: Ref<RestoreStatus>
	restoreStage: Ref<RestoreStage>
	restoreErrorLog: Ref<Record<string, unknown[]>>
	importedProfile: Ref<unknown>
	parsedBackupName: Ref<string | null>
}

async function runPickBackupFile(state: ImportRefs, opts: UseFullBackupImportOptions) {
	if (state.restoreStatus.value === "progress") return
	try {
		const file = await opts.pickFile()
		// A pick that yields no file (the capped wrapper's too-large path)
		// must also drop any PREVIOUS selection — otherwise the old file's
		// name and enabled import CTA sit under the new error banner, and
		// the user can "import" a file the UI just said failed.
		if (!file) {
			state.selectedBackup.value = null
			return
		}
		const { selection, parseError } = await readBackupFile(file)
		state.selectedBackup.value = selection
		if (parseError) {
			opts.fillError("full_backup", parseError.title, parseError.tooltip)
			return
		}
		if (selection.type === "unknown" || (selection.type === "plain" && !selection.profileType)) {
			opts.fillError(
				"full_backup",
				"Unrecognized Backup File",
				"The selected file is not a valid backup. Please select a correct backup file.",
			)
			return
		}
		// Surface the backup-embedded profile name as soon as it's available so the parent
		// page can prefill the Profile-name input. Plain backups carry it in the parsed
		// JSON; encrypted backups only expose it after `decryptBackup`, handled there.
		if (selection.type === "plain") {
			const parsed = selection.backup as { data?: { profile?: { name?: string } } } | null
			const cleaned = sanitizedBackupName(parsed?.data?.profile?.name)
			if (cleaned) state.parsedBackupName.value = cleaned
		}
		state.restoreStatus.value = null
		opts.password.value = ""
		opts.repeatedPassword.value = ""
		state.decryptionPassword.value = ""
		opts.clearError()
	} catch (err) {
		opts.fillError("full_backup", "Failed to read the backup file")
		console.error("Failed to read backup file:", (err as Error)?.message || err)
	}
}

async function runDecryptBackup(state: ImportRefs, opts: UseFullBackupImportOptions) {
	if (!state.decryptionPassword.value) return
	// Snapshot the selection this decrypt belongs to (the stale fences live in
	// openEncryptedBackup — a late publication must not resurrect a replaced selection).
	const target = state.selectedBackup.value
	if (!target) return
	try {
		const opened = await openEncryptedBackup(
			target.backup as string,
			state.decryptionPassword.value,
			() => state.selectedBackup.value !== target,
		)
		if (opened.kind === "stale") return
		// The helper fences internally, but its resolution yields a microtask before this
		// continuation — a queued re-pick in that window must not be overwritten (same
		// await-boundary class as useProfileBootstrap's network write).
		if (state.selectedBackup.value !== target) return
		const backupObject = opened.backupObject
		state.selectedBackup.value = {
			...target,
			backup: backupObject,
			profileType: backupObject?.data?.profile?.type ?? null,
		}
		// Encrypted backups only expose the embedded name AFTER decrypt succeeds. Surface it
		// for the parent's prefill watcher (same sanitization rationale as pickBackupFile).
		const cleaned = sanitizedBackupName(backupObject?.data?.profile?.name)
		if (cleaned) state.parsedBackupName.value = cleaned
		opts.clearError()
	} catch {
		if (state.selectedBackup.value !== target) return
		opts.fillError(
			"full_backup",
			"Decryption Failed",
			"The provided password is incorrect or the backup file is corrupted. Please try again with the correct password or select another file.",
		)
	}
}

async function runRestoreBackup(
	state: ImportRefs,
	opts: UseFullBackupImportOptions,
	guards: { isAllowed: () => boolean; hasErrors: () => boolean; recordRestoreErrors: (serviceName: string, data: unknown) => void },
) {
	// Re-entrancy guard: a second concurrent run (double-click, or the popup's
	// document-level Enter handler firing again mid-flight) would create a second
	// profile and race the un-locked account restore into duplicate/last-writer-wins
	// rows. `AccountService.restore` has no lock, so this guard is the barrier.
	// Mirrors `pickBackupFile`'s guard.
	if (state.restoreStatus.value === "progress") return
	if (!guards.isAllowed()) return
	opts.clearError()
	state.restoreStatus.value = "progress"
	state.restoreStage.value = "restoring:profile"

	const sel = state.selectedBackup.value as BackupSelection
	// Q-02: integrity + compatibility gate + forward-migration, all before any live state
	// is touched. The earlier profile name/type reads in pickBackupFile/decryptBackup are
	// sanitized display-only prefill and gate nothing.
	const validated = await validateAndMigrateBackup(sel.backup as FullBackupEnvelope)
	if (validated.kind === "rejected") {
		state.restoreStatus.value = "failed"
		opts.fillError("full_backup", validated.title, validated.message)
		return
	}

	// Kept alive for the whole restore so the duplicate-address rollback can call
	// `profileService.deleteProfile()` and so we can call `finalizeRestore()` at the
	// end. Disconnect in finally.
	const profileService = new ProfileServiceClient()
	const networkService = new NetworkServiceClient()
	// Rollback bookkeeping for the failure path: a restore failure AFTER the profile row
	// landed but BEFORE finalize must delete the orphan; once finalize is in flight the
	// profile is deliberately KEPT (its data is fully in storage — the user can unlock it
	// later). Out-param scratch so the catch sees the fields the moment they exist.
	const scratch: RestoreScratch = { createdProfileId: undefined, finalizeStarted: false }
	const io: RestoreIo = {
		fillError: opts.fillError,
		setStatus: (v) => {
			state.restoreStatus.value = v
		},
		setStage: (v) => {
			state.restoreStage.value = v
		},
		recordRestoreErrors: guards.recordRestoreErrors,
		appendErrors: (serviceName, records) => {
			state.restoreErrorLog.value[serviceName] = [...(state.restoreErrorLog.value[serviceName] ?? []), ...records]
		},
	}

	try {
		state.restoreErrorLog.value = {}
		const newProfile = await executeRestore(validated, scratch, io, { profileService, networkService, opts })
		if (!newProfile) return

		state.restoreStatus.value = "finished"
		state.restoreStage.value = "finished"
		if (!guards.hasErrors()) {
			// AWAIT completeImport in an isolated try/catch (P7). At this point the import
			// genuinely succeeded (data written, session opened via finalizeRestore), so a
			// rejected completion handshake must NOT flip the status back to "failed" or
			// reach the failure path's rollback — it must only surface, never undo. An
			// un-awaited call also leaves a dangling promise that hangs the spinner.
			try {
				await opts.completeImport(newProfile)
			} catch (err) {
				console.error("completeImport failed after a successful restore:", (err as Error)?.message || err)
			}
			return
		}
		state.importedProfile.value = newProfile
	} catch (err) {
		await runRestoreFailurePath(err, scratch, profileService, io)
	} finally {
		profileService.disconnect()
		networkService.disconnect()
	}
}

export function useFullBackupImport(opts: UseFullBackupImportOptions): UseFullBackupImportResult {
	const selectedBackup = ref<BackupSelection | null>(null)
	const decryptionPassword = ref("")
	const restoreStatus = ref<RestoreStatus>("")
	const restoreStage = ref<RestoreStage>("")
	const restoreErrorLog = ref<Record<string, unknown[]>>({})
	const importedProfile = ref<unknown>(null)
	const parsedBackupName = ref<string | null>(null)

	const isRestoreHasErrors = computed(() => Object.keys(restoreErrorLog.value).length > 0)

	const isAllowedToImportBackup = computed(() => {
		if (!selectedBackup.value?.profileType || !selectedBackup.value?.backup) return false
		if (selectedBackup.value?.profileType === "password") {
			if (!opts.password.value || opts.password.value !== opts.repeatedPassword.value || opts.password.value.length < 8) {
				return false
			}
		}
		return true
	})

	function recordRestoreErrors(serviceName: string, data: unknown) {
		const errors = collectRestoreErrors(serviceName, data)
		// APPEND, not assign: some services already have entries recorded before
		// their restore runs (e.g. token-balance's un-relinkable rows are recorded
		// pre-restore) — a plain assignment would clobber those diagnostics.
		if (errors) {
			// Names the service that gates the Continue screen. Without it a degraded import is
			// only visible as "some slice failed", with the reasons stranded in the RPC result.
			console.warn(`[full-backup-import] ${serviceName} reported ${errors.length} restore error(s)`, errors)
			restoreErrorLog.value[serviceName] = [...(restoreErrorLog.value[serviceName] ?? []), ...errors]
		}
	}

	const state: ImportRefs = {
		selectedBackup,
		decryptionPassword,
		restoreStatus,
		restoreStage,
		restoreErrorLog,
		importedProfile,
		parsedBackupName,
	}
	const pickBackupFile = () => runPickBackupFile(state, opts)
	const decryptBackup = () => runDecryptBackup(state, opts)
	const restoreBackup = () =>
		runRestoreBackup(state, opts, {
			isAllowed: () => isAllowedToImportBackup.value,
			hasErrors: () => isRestoreHasErrors.value,
			recordRestoreErrors,
		})

	function showRestoreErrorLog() {
		if (!isRestoreHasErrors.value) return
		if (opts.showErrorLog) {
			opts.showErrorLog(restoreErrorLog.value)
		} else {
			console.error("Restore errors:", restoreErrorLog.value)
		}
	}

	function resetBackupState() {
		selectedBackup.value = null
		decryptionPassword.value = ""
		restoreStatus.value = ""
		restoreErrorLog.value = {}
		importedProfile.value = null
		parsedBackupName.value = null
	}

	return {
		selectedBackup,
		decryptionPassword,
		restoreStatus,
		restoreStage,
		restoreErrorLog,
		importedProfile,
		isAllowedToImportBackup,
		isRestoreHasErrors,
		parsedBackupName,
		pickBackupFile,
		decryptBackup,
		restoreBackup,
		showRestoreErrorLog,
		resetBackupState,
	}
}
