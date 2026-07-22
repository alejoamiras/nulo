import { computed, ref, type Ref } from "vue"
import { asBase64CredentialId, asBase64MasterSecret, EncryptionKey } from "@nulo/wallet-crypto"
import { sanitizeString } from "@/utils/string"
import { AccountServiceClient } from "@/wallet/services/account/client"
import { ACCOUNT_SERVICE_NAME } from "@/wallet/services/account/spec"
import { AccountStateServiceClient } from "@/wallet/services/account-state/client"
import { ACCOUNT_STATE_SERVICE_NAME } from "@/wallet/services/account-state/spec"
import { AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"
import { AUTH_REGISTRY_SERVICE_NAME } from "@/wallet/services/auth-registry/spec"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { CONFIG_SERVICE_NAME } from "@/wallet/services/config/spec"
import { ContactServiceClient } from "@/wallet/services/contact/client"
import { CONTACT_SERVICE_NAME } from "@/wallet/services/contact/spec"
import { FpcServiceClient } from "@/wallet/services/fpc/client"
import { FPC_SERVICE_NAME } from "@/wallet/services/fpc/spec"
import { NetworkServiceClient } from "@/wallet/services/network/client"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { ProfileServiceClient, type RestoreSecret } from "@/wallet/services/profile/client"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { TOKEN_BALANCE_SERVICE_NAME } from "@/wallet/services/token-balance/spec"
import { TokenServiceClient } from "@/wallet/services/token/client"
import { TOKEN_SERVICE_NAME } from "@/wallet/services/token/spec"
import { TransactionServiceClient } from "@/wallet/services/transaction/client"
import { TRANSACTION_SERVICE_NAME } from "@/wallet/services/transaction/spec"
import { UserRejectedError } from "@nulo/extension-messaging/errors"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import type { PasskeyRequest } from "@/wallet/services/passkey/spec"
import {
	type BackupSelection,
	collectRestoreErrors,
	normalizeAllIds,
	readBackupFile,
	remapByMap,
	resolveRestoredActiveNetworkId,
} from "@/utils/full-backup-helpers"
import { BACKUP_SCHEMA_VERSION_FIELD, COMPAT_EPOCH_FIELD, isSupportedCompatEpoch } from "@/wallet/services/backup/backup-migration-registry"
import { maxBackupSchemaVersion, migrateBackupData } from "@/wallet/services/backup/backup-migrator"

export type RestoreStatus = "" | "progress" | "failed" | "finished" | null | undefined

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
}

export interface UseFullBackupImportResult {
	selectedBackup: Ref<BackupSelection | null>
	decryptionPassword: Ref<string>
	restoreStatus: Ref<RestoreStatus>
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

export function useFullBackupImport(opts: UseFullBackupImportOptions): UseFullBackupImportResult {
	const selectedBackup = ref<BackupSelection | null>(null)
	const decryptionPassword = ref("")
	const restoreStatus = ref<RestoreStatus>("")
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

	async function pickBackupFile() {
		if (restoreStatus.value === "progress") return
		try {
			const file = await opts.pickFile()
			if (!file) return
			const { selection, parseError } = await readBackupFile(file)
			selectedBackup.value = selection
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
			// Surface the backup-embedded profile name as soon as it's
			// available so the parent page can prefill the Profile-name
			// input. Plain backups carry the name in the parsed JSON
			// (`backup.data.profile.name`); encrypted backups only expose it
			// after `decryptBackup`, handled in that function below.
			//
			// Sanitize before publishing — a maliciously crafted backup file
			// could embed bidi-override / zero-width / unauthorized chars.
			// `Input.vue` only sanitizes on user input events; the prefill
			// watcher's `v-model` assignment bypasses that path, so we MUST
			// sanitize here.
			if (selection.type === "plain") {
				const parsed = selection.backup as { data?: { profile?: { name?: string } } } | null
				const raw = parsed?.data?.profile?.name
				if (typeof raw === "string" && raw.length > 0) {
					const cleaned = sanitizeString(raw, 32)
					if (cleaned.length > 0) parsedBackupName.value = cleaned
				}
			}
			restoreStatus.value = null
			opts.password.value = ""
			opts.repeatedPassword.value = ""
			decryptionPassword.value = ""
			opts.clearError()
		} catch (err) {
			opts.fillError("full_backup", "Failed to read the backup file")
			console.error("Failed to read backup file:", (err as Error)?.message || err)
		}
	}

	async function decryptBackup() {
		if (!decryptionPassword.value) return
		try {
			const passhash = await EncryptionKey.getPasshash(decryptionPassword.value)
			const key = await EncryptionKey.fromPasshash(passhash)
			const encryptedBytes = new Uint8Array(Buffer.from(selectedBackup.value?.backup as string, "base64"))
			const decryptedBytes = await key.decrypt(encryptedBytes)
			const decodedJson = new TextDecoder().decode(decryptedBytes)
			const backupObject = JSON.parse(decodedJson) as { data?: { profile?: { type?: string; name?: string } } }
			selectedBackup.value = {
				...(selectedBackup.value as BackupSelection),
				backup: backupObject,
				profileType: backupObject?.data?.profile?.type ?? null,
			}
			// Encrypted backups only expose the embedded name AFTER decrypt
			// succeeds. Surface it for the parent's prefill watcher.
			// Same sanitization rationale as in `pickBackupFile` above —
			// the prefill watcher bypasses `Input.vue`'s sanitize path.
			const rawName = backupObject?.data?.profile?.name
			if (typeof rawName === "string" && rawName.length > 0) {
				const cleaned = sanitizeString(rawName, 32)
				if (cleaned.length > 0) parsedBackupName.value = cleaned
			}
			opts.clearError()
		} catch {
			opts.fillError(
				"full_backup",
				"Decryption Failed",
				"The provided password is incorrect or the backup file is corrupted. Please try again with the correct password or select another file.",
			)
		}
	}

	function recordRestoreErrors(serviceName: string, data: unknown) {
		const errors = collectRestoreErrors(serviceName, data)
		// APPEND, not assign: some services already have entries recorded before
		// their restore runs (e.g. token-balance's un-relinkable rows are recorded
		// pre-restore) — a plain assignment would clobber those diagnostics.
		if (errors) restoreErrorLog.value[serviceName] = [...(restoreErrorLog.value[serviceName] ?? []), ...errors]
	}

	async function restoreBackup() {
		// Re-entrancy guard: a second concurrent run (double-click, or the
		// popup's document-level Enter handler firing again mid-flight) would
		// create a second profile and race the un-locked account restore into
		// duplicate/last-writer-wins rows. `AccountService.restore` has no lock,
		// so this guard is the barrier. Mirrors `pickBackupFile`'s guard.
		if (restoreStatus.value === "progress") return
		if (!isAllowedToImportBackup.value) return
		opts.clearError()
		restoreStatus.value = "progress"

		const sel = selectedBackup.value as BackupSelection
		const fullBackup = sel.backup as {
			checksum?: string
			"compat-epoch"?: unknown
			"backup-schema-version"?: unknown
			"master-key"?: string
			"active-network-id"?: string
			data: Record<string, unknown>
		}
		const { checksum, ...backup } = fullBackup

		// Trust-gate order is deliberate: integrity FIRST — re-serialized
		// exactly as the exporter hashed it (the exporter also hashed
		// JSON.stringify of the object, so this IS the exported body) — then
		// the non-migratable compat-epoch, then the migratable schema-version
		// range. The earlier profile name/type reads in pickBackupFile/
		// decryptBackup are sanitized display-only prefill and gate nothing.
		// The checksum is accidental-integrity detection only — a plain
		// backup's checksum is attacker-recomputable, so nothing downstream
		// may treat it as authentication.
		const comparisonChecksum = await EncryptionKey.getHashHex(JSON.stringify(backup))
		if (checksum !== comparisonChecksum) {
			restoreStatus.value = "failed"
			opts.fillError(
				"full_backup",
				"Backup Integrity Check Failed",
				"The backup file appears to be corrupted or has been tampered with. Please ensure you have the correct backup file.",
			)
			return
		}

		// A pre-baseline blob (the legacy conflated `schema-version: 2`, no
		// `compat-epoch`) fails this gate too — intended fail-closed; the fix
		// is re-exporting from a current wallet.
		if (!isSupportedCompatEpoch(backup[COMPAT_EPOCH_FIELD])) {
			restoreStatus.value = "failed"
			opts.fillError(
				"full_backup",
				"Incompatible backup",
				"This backup was created by an incompatible wallet version and cannot be imported. Re-export a backup from a current version of the wallet.",
			)
			return
		}

		const backupSchemaVersion = backup[BACKUP_SCHEMA_VERSION_FIELD]
		if (typeof backupSchemaVersion !== "number" || !Number.isInteger(backupSchemaVersion) || backupSchemaVersion < 1) {
			restoreStatus.value = "failed"
			opts.fillError(
				"full_backup",
				"Incompatible backup",
				"This backup does not carry a valid schema version. Re-export a backup from a current version of the wallet.",
			)
			return
		}
		if (backupSchemaVersion > maxBackupSchemaVersion()) {
			restoreStatus.value = "failed"
			opts.fillError(
				"full_backup",
				"Backup is too new",
				"This backup was created by a newer version of the wallet. Update the wallet, then import it again.",
			)
			return
		}

		// Migrate the verified slices forward BEFORE anything touches live
		// storage: pure and in-memory, so a failure here rejects the import
		// with ZERO live state to roll back. The migrated data replaces the
		// parsed slices; the checksum was already verified over the ORIGINAL
		// bytes and is dropped — migration is a pure function of verified
		// input, so its output is covered transitively (never recompute-and-
		// trust a post-migration checksum). `master-key` is a top-level field,
		// not a slice — it never enters the migrator.
		const migrationResult = await migrateBackupData({ data: backup.data, backupSchemaVersion })
		if (migrationResult.kind === "incompatible") {
			restoreStatus.value = "failed"
			opts.fillError("full_backup", "Incompatible backup", migrationResult.reason)
			return
		}
		if (migrationResult.kind === "failed") {
			restoreStatus.value = "failed"
			opts.fillError(
				"full_backup",
				"Import failed",
				`The backup could not be upgraded to the current format: ${migrationResult.reason}`,
			)
			return
		}
		const data = migrationResult.data as Record<string, unknown> & {
			account?: unknown[]
			network?: unknown[]
			token?: unknown[]
			"token-balance"?: Array<Record<string, unknown>>
			profile?: { id: string; name?: string }
		}

		// Kept alive for the whole restore so the duplicate-address rollback
		// can call `profileService.deleteProfile()` and so we can call
		// `profileService.finalizeRestore()` at the end. Disconnect in finally.
		const profileService = new ProfileServiceClient()
		const networkService = new NetworkServiceClient()

		// Rollback bookkeeping for the outer catch: a restore failure AFTER the
		// profile row landed but BEFORE finalize must delete the orphan; once
		// finalize is in flight the profile is deliberately KEPT (its data is
		// fully in storage — the user can unlock it later).
		let createdProfileId: string | undefined
		let finalizeStarted = false

		try {
			restoreErrorLog.value = {}
			const masterKey = backup["master-key"] as string
			const profile = data.profile as { id: string; name: string; type: "password" | "passkey" }

			// Path A passkey-ceremony handoff. For passkey backups, the
			// backup's `master-key` IS the credentialId (see
			// `ProfileService.exportPlain` passkey return). Run the modal
			// against that credentialId here so the service receives
			// `credentialData` and skips its own SW-window path. Without
			// this the service throws `credentialData is required`.
			let credentialData: PasskeyCredentialData | undefined
			if (profile.type === "passkey") {
				if (!opts.runCeremony) {
					restoreStatus.value = "failed"
					opts.fillError("full_backup", "Can't import", "Passkey ceremony not wired — restart the popup and try again.")
					return
				}
				try {
					credentialData = await opts.runCeremony({ mode: "get", credentialId: masterKey })
				} catch (err) {
					// Silent cancel matches the rest of the wallet (auth.vue,
					// profile/new.vue, import.vue:handleImportPasskey). Reset
					// restoreStatus so the form is usable again — without it,
					// the Import button stays disabled because the page's
					// status guard only re-enables on "" / null / undefined.
					if (err instanceof UserRejectedError) {
						restoreStatus.value = ""
						return
					}
					restoreStatus.value = "failed"
					opts.fillError("full_backup", "Couldn't authenticate", err instanceof Error ? err.message : String(err))
					return
				}
			}

			// Honor the parent-supplied Profile-name override when non-empty
			// after trim. Spread-clone the backup-parsed profile so we never
			// mutate the parsed `data.profile` in place (the data structure
			// may be re-read on retry paths). Service-side auto-suffix at
			// `profile/service.ts:825-840` still resolves collisions against
			// existing profiles.
			const override = opts.profileName?.value.trim()
			const profileForRestore = override ? { ...profile, name: override } : profile
			// Construct the profile-type-discriminated restore secret at the backup
			// boundary: the v2 `master-key` field is a base64 plain master key for
			// password profiles and the credentialId for passkey profiles (unchanged
			// on disk — this only types the transient RPC payload).
			const restoreSecret: RestoreSecret =
				profile.type === "password"
					? { type: "password", masterKey: asBase64MasterSecret(masterKey) }
					: { type: "passkey", credentialId: asBase64CredentialId(masterKey) }
			const newProfile = await profileService.restore(profileForRestore, restoreSecret, opts.password.value, credentialData)

			if (newProfile.restoreError) {
				restoreStatus.value = "failed"
				const errMsg = newProfile.restoreError instanceof Error ? newProfile.restoreError.message : String(newProfile.restoreError)
				opts.fillError("full_backup", "Import failed", errMsg)
				return
			}
			createdProfileId = newProfile.id

			// UNCONDITIONAL all-rows remap, even when the restored root profile id is
			// unchanged. A full backup is exactly ONE profile's data, so every child
			// row must bind to the profile we just created. Guarding this on
			// `newProfile.id !== profile.id` left a graft hole: a crafted backup whose
			// root profile id is unused (so restore keeps it) but whose child rows
			// carry a VICTIM profile id would skip the remap and write those rows under
			// the victim. Rewriting every `profileId` to `newProfile.id` closes it.
			normalizeAllIds(data, "profileId", newProfile.id)

			const newNetworks = (await networkService.restore(data.network)) as Array<{
				id: string
				name: string
				rpcUrl: string
				chainId: number
				restoreError?: string
			}>
			const createdNetworks = newNetworks.filter((n) => !n.restoreError)

			if (!createdNetworks.length) {
				try {
					await profileService.deleteProfile(newProfile.id)
				} catch (err) {
					console.error(err)
				}
				restoreStatus.value = "failed"
				opts.fillError("full_backup", "Can't import", "Couldn't restore any networks from this backup")
				return
			}

			// Pair each restored network to its source by RESULT INDEX, not a
			// field-match: `NetworkService.restore` returns exactly one result
			// per input, in order, and spreads a FAILED input's raw fields back
			// into its result — so a field-match (name/rpcUrl/chainId) is
			// attacker-ambiguous (an invalid net A + a valid net B sharing those
			// fields could pair B with A and graft A's account-state onto B's
			// PXE target). Index-pairing is unforgeable. Only remap for a
			// SUCCESSFUL restore whose id actually changed.
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
			recordRestoreErrors(NETWORK_SERVICE_NAME, newNetworks)

			// Item 1b: restore the user's ACTIVE-network selection. The exported `active-network-id` is
			// a RAW old id resolved through the COMPLETE source→successful-result pairing (identity for
			// unchanged ids — the changed-only `oldToNew` above can't be reused). Write it for the NEW
			// profile via the profileId-parameterized setter BEFORE `finalizeRestore` (the profile isn't
			// active yet). Absent / hostile / unmatched → skip; the bootstrap primary fallback applies.
			const restoredActiveId = resolveRestoredActiveNetworkId(backup["active-network-id"], newNetworks, oldNetworks)
			if (restoredActiveId) {
				try {
					await networkService.setActiveForProfile(newProfile.id, restoredActiveId)
				} catch (activeErr) {
					// `requireOwnedRow` rejection or a write hiccup — leave the pointer unset; the bootstrap
					// picks the primary network. Never fail the whole import over the active-network pointer.
					console.warn("[full-backup] could not restore active-network selection:", activeErr)
				}
			}

			// Hoisted above the account try so the token re-link's chain-equality
			// check (after the try) can see which (chainId, address) pairs were imported.
			const importedChainAddress = new Set<string>()
			const accountService = new AccountServiceClient()
			try {
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
						console.warn(
							`[full-backup-import] dropped ${dropped} ${label} referencing an account not imported from this backup`,
						)
					}
				}
				// tx carries its OWN chainId → key by the (chainId, account) tuple so a
				// tx can't reference an imported address on a DIFFERENT chain (F).
				filterByAccount(
					TRANSACTION_SERVICE_NAME,
					(tx) =>
						typeof tx.account === "string" &&
						typeof tx.chainId === "number" &&
						importedChainAddress.has(`${tx.chainId}:${tx.account}`),
					"transaction(s)",
				)
				// auth-registry + token-balance carry `account` but no independently
				// forgeable chainId (addresses are chain-distinct), so address membership
				// is sufficient. (token-balance ALSO gets token-ownership + chain-equality
				// in the re-link step below.)
				filterByAccount(
					AUTH_REGISTRY_SERVICE_NAME,
					(aw) => typeof aw.account === "string" && importedAddresses.has(aw.account),
					"authwit(s)",
				)
				filterByAccount(
					TOKEN_BALANCE_SERVICE_NAME,
					(tb) => typeof tb.account === "string" && importedAddresses.has(tb.account),
					"token-balance(s)",
				)
			} catch (err) {
				// `AccountService` throws `new Error("Duplicate address")`
				// when an imported account's address collides with one
				// already in storage. The RPC layer
				// (`extension-messaging/client.ts`) reconstructs that as an
				// `Error` instance on the client — so match on `.message`,
				// not via string-equality on `err` itself.
				const msg = err instanceof Error ? err.message : String(err)
				if (msg === "Duplicate address") {
					try {
						await profileService.deleteProfile(newProfile.id)
					} catch (deleteErr) {
						console.error(deleteErr)
					}
					// NetworkService.onProfileDeleted cascades — purges this
					// profile's networks automatically. No explicit cleanup
					// needed.
					opts.fillError("full_backup", "Can't import", "An account from this backup is already in your wallet")
					restoreStatus.value = "failed"
					return
				}
				// Non-duplicate failure: fall through to the outer catch so
				// the orphan profile isn't left in a half-restored state.
				throw err
			} finally {
				accountService.disconnect()
			}

			const tokenService = new TokenServiceClient()
			let tokenRestoreResult: unknown
			try {
				tokenRestoreResult = await tokenService.restore(data.token)
			} finally {
				tokenService.disconnect() // P7: disconnect even if restore throws
			}
			const newTokens = tokenRestoreResult as Array<{
				id: unknown
				chainId: number
				contract: string
				restoreError?: string
			}>
			if (data["token-balance"]?.length) {
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
					if (!old) continue
					oldIdToChain.set(old.id, old.chainId)
					if (!newTokens[i].restoreError) oldIdToNew.set(old.id, newTokens[i].id)
				}
				const droppedBalances: unknown[] = []
				data["token-balance"] = data["token-balance"].flatMap((tb: Record<string, unknown>) => {
					const newId = oldIdToNew.get(tb.token)
					// token/account chain-equality (final pass): the balance's account
					// must be an account imported ON THE TOKEN'S CHAIN. Addresses are
					// chain-distinct, so this rejects a balance pairing an imported
					// account with a token on a chain that account wasn't imported on.
					const tokenChain = oldIdToChain.get(tb.token)
					const chainOk =
						tokenChain !== undefined &&
						typeof tb.account === "string" &&
						importedChainAddress.has(`${tokenChain}:${tb.account}`)
					if (newId === undefined || !chainOk) {
						droppedBalances.push({ ...tb, restoreError: "Token balance could not be re-linked to a restored token" })
						return []
					}
					return [{ ...tb, token: newId }]
				})
				if (droppedBalances.length) {
					restoreErrorLog.value[TOKEN_BALANCE_SERVICE_NAME] = [
						...(restoreErrorLog.value[TOKEN_BALANCE_SERVICE_NAME] ?? []),
						...droppedBalances,
					]
				}
			}
			recordRestoreErrors(TOKEN_SERVICE_NAME, newTokens)

			// ACCOUNT_STATE is deliberately NOT in this loop — it is restored AFTER
			// finalizeRestore (below), because its `registerContract` needs the PXE
			// store key, which is only provisionable once the session is open.
			const backupServices: Array<{
				name: string
				client: { restore: (...args: unknown[]) => Promise<unknown>; disconnect: () => void }
			}> = [
				{ name: TRANSACTION_SERVICE_NAME, client: new TransactionServiceClient() as never },
				{ name: TOKEN_BALANCE_SERVICE_NAME, client: new TokenBalanceServiceClient() as never },
				{ name: AUTH_REGISTRY_SERVICE_NAME, client: new AuthRegistryServiceClient() as never },
				{ name: FPC_SERVICE_NAME, client: new FpcServiceClient() as never },
				{ name: CONTACT_SERVICE_NAME, client: new ContactServiceClient() as never },
				{ name: CONFIG_SERVICE_NAME, client: new ConfigServiceClient() as never },
			]
			// Whole-loop try/finally: every client is constructed up-front, so a
			// mid-loop throw (or a non-array slice that skips a client's body) must
			// still disconnect ALL of them — a per-iteration finally would only
			// clean the client that threw, leaking the ones after it (P7).
			try {
				for (const { name, client } of backupServices) {
					const sliceData = data[name]
					if (Array.isArray(sliceData)) {
						recordRestoreErrors(name, await client.restore(sliceData))
					}
				}
			} finally {
				for (const { client } of backupServices) client.disconnect()
			}

			// Late activation: open the session NOW that all backup data is
			// in storage. This emits `onActiveProfileChanged`, which fires
			// `app.vue`'s handler — which calls `getOrInitNetworks` /
			// `ensureDefaultAccount`. Running it now (after the restore) means
			// those see the imported data, not an empty profile that needs
			// default seeding.
			finalizeStarted = true
			try {
				await profileService.finalizeRestore(newProfile.id, opts.password.value || undefined)
			} catch (err) {
				restoreStatus.value = "failed"
				opts.fillError("full_backup", "Couldn't open the imported profile", err instanceof Error ? err.message : String(err))
				return
			}

			// Restore account-state (PXE contract registrations + senders) AFTER
			// finalizeRestore — NOT in the loop above. Its `registerContract` needs the
			// per-profile PXE store key, which the client's PXE_STORE_KEY_MISSING
			// retry-once provisions via `getProfileSecret` — and that only yields the
			// master once the session is OPEN (finalizeRestore opens it). Under 5.0.1 the
			// exported account-state includes the account's OWN contract, so running this
			// pre-finalize (as it used to) hit PXE_STORE_KEY_MISSING and stranded the
			// import on "completed with errors". app.vue's activation handler only
			// auto-seeds networks/accounts — never account-state contract registrations —
			// so there is no import-race with running this after the emit. Recorded into
			// restoreErrorLog BEFORE the isRestoreHasErrors gate below so a genuine
			// registration failure still surfaces (and still blocks auto-completion).
			const accountStateSlice = data[ACCOUNT_STATE_SERVICE_NAME]
			if (Array.isArray(accountStateSlice)) {
				const accountStateService = new AccountStateServiceClient()
				try {
					recordRestoreErrors(ACCOUNT_STATE_SERVICE_NAME, await accountStateService.restore(accountStateSlice, createdNetworks))
				} finally {
					accountStateService.disconnect()
				}
			}

			restoreStatus.value = "finished"
			if (!isRestoreHasErrors.value) {
				// AWAIT completeImport in an isolated try/catch (P7). At this point
				// the import genuinely succeeded (data written, session opened via
				// finalizeRestore), so a rejected completion handshake must NOT flip
				// the status back to "failed" or reach the outer catch's rollback —
				// it must only surface, never undo. An un-awaited call also leaves a
				// dangling promise that hangs the "Finishing import…" spinner.
				try {
					await opts.completeImport(newProfile)
				} catch (err) {
					console.error("completeImport failed after a successful restore:", (err as Error)?.message || err)
				}
				return
			}
			importedProfile.value = newProfile
		} catch (err) {
			// Pre-finalize failure with a created profile: the profile row is in
			// storage but the restore never completed — delete the orphan so a
			// retry starts clean. Post-finalize errors keep the profile (see the
			// bookkeeping note above); the finalize call itself has its own catch
			// and never reaches here.
			if (createdProfileId !== undefined && !finalizeStarted) {
				try {
					await profileService.deleteProfile(createdProfileId)
				} catch (deleteErr) {
					console.error(deleteErr)
				}
			}
			restoreStatus.value = ""
			opts.fillError("full_backup", "Import failed", String((err as Error)?.message ?? err))
			console.error((err as Error)?.message || err)
		} finally {
			profileService.disconnect()
			networkService.disconnect()
		}
	}

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
