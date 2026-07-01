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
import { type BackupSelection, collectRestoreErrors, readBackupFile, remapIdInBackupData } from "@/utils/full-backup-helpers"

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
		if (errors) restoreErrorLog.value[serviceName] = errors
	}

	async function restoreBackup() {
		if (!isAllowedToImportBackup.value) return
		opts.clearError()
		restoreStatus.value = "progress"

		const sel = selectedBackup.value as BackupSelection
		const fullBackup = sel.backup as {
			checksum?: string
			"schema-version"?: number
			"master-key"?: string
			data: Record<string, unknown>
		}
		const { checksum, ...backup } = fullBackup
		const data = backup.data as Record<string, unknown> & {
			account?: unknown[]
			network?: unknown[]
			token?: unknown[]
			"token-balance"?: Array<Record<string, unknown>>
			profile?: { id: string; name?: string }
		}

		if (backup["schema-version"] !== 2) {
			restoreStatus.value = "failed"
			opts.fillError(
				"full_backup",
				"Incompatible backup",
				"This backup was created by a pre-release build that used custom account contracts. It cannot be imported into the current version. Re-export a backup from the same release you are importing into.",
			)
			return
		}

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

		// Kept alive for the whole restore so the duplicate-address rollback
		// can call `profileService.deleteProfile()` and so we can call
		// `profileService.finalizeRestore()` at the end. Disconnect in finally.
		const profileService = new ProfileServiceClient()
		const networkService = new NetworkServiceClient()

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

			if (newProfile.id !== profile.id) {
				remapIdInBackupData(data, "profileId", newProfile.id)
			}

			const newNetworks = (await networkService.restore(data.network)) as Array<{
				id: string
				name: string
				rpcUrl: string
				chainId: string
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

			for (const network of newNetworks) {
				const oldNetwork = (data.network as Array<{ id: string; name: string; rpcUrl: string; chainId: string }>).find(
					(n) => n.name === network.name && n.rpcUrl === network.rpcUrl && n.chainId === network.chainId,
				)
				if (oldNetwork && oldNetwork.id !== network.id) {
					remapIdInBackupData(data, "networkId", network.id)
				}
			}
			recordRestoreErrors(NETWORK_SERVICE_NAME, newNetworks)

			const accountService = new AccountServiceClient()
			try {
				const newAccounts = await accountService.restore(data.account)
				recordRestoreErrors(ACCOUNT_SERVICE_NAME, newAccounts)
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
			const newTokens = (await tokenService.restore(data.token)) as Array<{
				id: string
				contract: string
				restoreError?: string
			}>
			tokenService.disconnect()
			if (data["token-balance"]?.length) {
				const oldTokens = data.token as Array<{ id: string; contract: string }>
				const oldIdToContract = new Map(oldTokens.map((t) => [t.id, t.contract]))
				const contractToNewId = new Map(newTokens.filter((t) => !t.restoreError).map((t) => [t.contract, t.id]))
				data["token-balance"] = data["token-balance"].flatMap((tb) => {
					const contract = oldIdToContract.get(tb.token as string)
					const newId = contract ? contractToNewId.get(contract) : undefined
					return newId ? [{ ...tb, token: newId }] : []
				})
			}
			recordRestoreErrors(TOKEN_SERVICE_NAME, newTokens)

			const backupServices: Array<{
				name: string
				client: { restore: (...args: unknown[]) => Promise<unknown>; disconnect: () => void }
			}> = [
				{ name: TRANSACTION_SERVICE_NAME, client: new TransactionServiceClient() as never },
				{ name: TOKEN_BALANCE_SERVICE_NAME, client: new TokenBalanceServiceClient() as never },
				{ name: ACCOUNT_STATE_SERVICE_NAME, client: new AccountStateServiceClient() as never },
				{ name: AUTH_REGISTRY_SERVICE_NAME, client: new AuthRegistryServiceClient() as never },
				{ name: FPC_SERVICE_NAME, client: new FpcServiceClient() as never },
				{ name: CONTACT_SERVICE_NAME, client: new ContactServiceClient() as never },
				{ name: CONFIG_SERVICE_NAME, client: new ConfigServiceClient() as never },
			]
			for (const { name, client } of backupServices) {
				const sliceData = data[name]
				if (Array.isArray(sliceData)) {
					const restoredData =
						name === ACCOUNT_STATE_SERVICE_NAME
							? await client.restore(sliceData, createdNetworks)
							: await client.restore(sliceData)
					client.disconnect()
					recordRestoreErrors(name, restoredData)
				}
			}

			// Late activation: open the session NOW that all backup data is
			// in storage. This emits `onActiveProfileChanged`, which fires
			// `app.vue`'s handler — which calls `getOrInitNetworks` /
			// `ensureDefaultAccount`. Running it now (after the restore) means
			// those see the imported data, not an empty profile that needs
			// default seeding.
			try {
				await profileService.finalizeRestore(newProfile.id, opts.password.value || undefined)
			} catch (err) {
				restoreStatus.value = "failed"
				opts.fillError("full_backup", "Couldn't open the imported profile", err instanceof Error ? err.message : String(err))
				return
			}

			restoreStatus.value = "finished"
			if (!isRestoreHasErrors.value) {
				opts.completeImport(newProfile)
				return
			}
			importedProfile.value = newProfile
		} catch (err) {
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
