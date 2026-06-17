import { computed, ref, watch } from "vue"
import { UserRejectedError } from "@nulo/extension-messaging/errors"
import { useFullBackupImport } from "@/composables/useFullBackupImport"
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"
import { useProfileNameField } from "@/composables/useProfileNameField"
import { pickFile } from "@/utils"
import { managers } from "@/utils/core"

/**
 * Shared orchestration for the profile-IMPORT flow, consumed by both the
 * popup (`popup/pages/import.vue`) and onboarding (`onboarding/pages/import.vue`)
 * shells. Owns the validation + secret-entry + passkey-ceremony + full-backup
 * wiring + error routing; the two shells inject the parts that genuinely
 * differ.
 *
 * The activation tail is INJECTED, not owned: `completeImport` runs the
 * shell's own "profile is now active" sequence. The popup relies on
 * `popup/app.vue`'s `onActiveProfileChanged` listener (it does NOT bootstrap);
 * onboarding has no such listener and bootstraps explicitly. The same
 * `completeImport` reference is threaded into `useFullBackupImport`, so every
 * import path (seed/key/passkey + full-backup) activates through exactly one
 * callback — which is also why the onboarding shell no longer double-bootstraps.
 *
 * C1 lifecycle: exposes `dispose()` (the parent calls it in its existing
 * `onBeforeUnmount`); never registers its own `onUnmounted`. Secret refs are
 * exposed but NOT zeroed here — zeroing is a per-shell page concern.
 */
export interface UseProfileImportFlowOptions {
	/**
	 * Per-shell activation + routing + success toast. Popup: listener-based, no
	 * bootstrap. Onboarding: `bootstrapActiveProfile` then route. Threaded into
	 * `useFullBackupImport` too.
	 */
	completeImport: (profile: unknown) => Promise<void> | void
	/** Per-shell restore-error surface (popup = data-viewer overlay; onboarding = notification). */
	showErrorLog: (errors: Record<string, unknown[]>) => void
	/** Per-shell passkey-import failure notification (page owns `notificationStore.create`). */
	notifyImportFailed: () => void
	/** Page toast opener, used by the copy-error-to-clipboard affordance. */
	openToast: (content: { label: string; icon?: string }, duration?: number) => void
}

export function useProfileImportFlow(opts: UseProfileImportFlowOptions) {
	const {
		profileName,
		trimmedName,
		nameError,
		shakeName,
		nameInputRef,
		validate: validateName,
		handleInput: handleNameInput,
		dispose: disposeNameField,
	} = useProfileNameField()

	const { request: ceremonyRequest, runCeremony, onResolve: onCeremonyResolve, onReject: onCeremonyReject } = usePasskeyCeremony()

	const selectedImportOption = ref<string | null>(null)
	const seedPhrase = ref<string | undefined>(undefined)
	const privateKey = ref<string | undefined>(undefined)
	const publicKey = ref<string | undefined>(undefined)
	const password = ref("")
	const repeatedPassword = ref("")
	const maxPasswordLength = 128
	const isImporting = ref(false)

	const error = ref({ type: "", title: "", tooltip: "" })
	function fillError(type?: string, title?: string, tooltip?: string) {
		if (!title) {
			error.value = { type: "", title: "", tooltip: "" }
			return
		}
		error.value = { type: type ?? "unknown", title, tooltip: tooltip ?? "" }
	}
	function clearError() {
		fillError()
	}

	// Unified catch-all (A1): both shells render title "Import failed" + the
	// message as tooltip. Replaces popup's prior `fillError("unknown", err)`,
	// which put the Error object in the title slot and rendered "[object Object]".
	function fillUnknownImportError(err: unknown) {
		fillError("unknown", "Import failed", err instanceof Error ? err.message : String(err))
	}

	const isCopied = ref(false)
	function handleCopyError() {
		isCopied.value = true
		window.navigator.clipboard.writeText(`${error.value.title}${error.value.tooltip ? `: ${error.value.tooltip}` : ""}`)
		opts.openToast({ label: "Error is copied", icon: "copy" })
		setTimeout(() => {
			isCopied.value = false
		}, 1_500)
	}

	function handlePasswordInput() {
		if (error.value.type === "password") fillError()
	}
	function handleSecretInput() {
		if (error.value.type === "secret") fillError()
	}

	// Name check is excluded on purpose — name is validated at submit time so
	// an empty name shakes the input instead of silently disabling the buttons.
	const isAllowedToContinue = computed(() => {
		if (!password.value || password.value.length < 8) return false
		if (selectedImportOption.value !== "public_key" && (!repeatedPassword.value || password.value !== repeatedPassword.value))
			return false
		return true
	})
	const isAllowedToImportBySeedPhrase = computed(() => {
		if (!isAllowedToContinue.value) return false
		return seedPhrase.value?.split(" ").length === 24 && password.value.length >= 8
	})
	const isAllowedToImportByPrivateKey = computed(() => {
		if (!isAllowedToContinue.value) return false
		return !!privateKey.value
	})
	const isAllowedToImportByPublicKey = computed(() => {
		if (!isAllowedToContinue.value) return false
		return !!publicKey.value
	})

	async function fetchExistingNames(): Promise<string[]> {
		return (await managers.profile.getProfiles()).map((p) => p.name)
	}

	// In-flight latch is set BEFORE the async `getProfiles()` fetch so two rapid
	// clicks can't both pass the pre-check before the lock is set.
	const handleImportSeed = async () => {
		if (!isAllowedToImportBySeedPhrase.value || isImporting.value) return
		isImporting.value = true
		try {
			const existingNames = await fetchExistingNames()
			if (!validateName({ existingNames })) {
				isImporting.value = false
				return
			}
			const profile = await managers.profile.importMnemonic(trimmedName.value, (seedPhrase.value ?? "").split(" "), password.value)
			await opts.completeImport(profile)
		} catch (err) {
			fillUnknownImportError(err)
		} finally {
			isImporting.value = false
		}
	}

	const handleImportPrivateKey = async () => {
		if (!isAllowedToImportByPrivateKey.value || isImporting.value) return
		isImporting.value = true
		try {
			const existingNames = await fetchExistingNames()
			if (!validateName({ existingNames })) {
				isImporting.value = false
				return
			}
			const profile = await managers.profile.importPlain(trimmedName.value, privateKey.value as string, password.value)
			await opts.completeImport(profile)
		} catch (err) {
			// `profile/service.ts` throws `new Error("Invalid secret length")` —
			// arrives as an Error instance across the RPC boundary, so match on
			// `.message`, not string-equality on the value itself.
			if (err instanceof Error && err.message === "Invalid secret length") {
				fillError("secret", "Invalid key length")
			} else {
				fillUnknownImportError(err)
			}
		} finally {
			isImporting.value = false
		}
	}

	const handleImportPublicKey = async () => {
		if (!isAllowedToImportByPublicKey.value || isImporting.value) return
		isImporting.value = true
		try {
			const existingNames = await fetchExistingNames()
			if (!validateName({ existingNames })) {
				isImporting.value = false
				return
			}
			const profile = await managers.profile.importEncrypted(trimmedName.value, publicKey.value as string, password.value)
			await opts.completeImport(profile)
		} catch (err) {
			if (err instanceof Error && err.message === "Invalid password") {
				fillError("password", "Wrong password")
			} else if (err instanceof Error && err.message === "Invalid secret length") {
				fillError("secret", "Invalid encrypted key")
			} else {
				fillUnknownImportError(err)
			}
		} finally {
			isImporting.value = false
		}
	}

	const handleImportPasskey = async () => {
		if (isImporting.value) return
		isImporting.value = true
		try {
			const existingNames = await fetchExistingNames()
			if (!validateName({ existingNames })) {
				isImporting.value = false
				return
			}
			// Discovery `get` — no allowedCredentials; the user picks from their
			// available passkeys.
			const credData = await runCeremony({ mode: "get" })
			const profile = await managers.profile.importPasskey(trimmedName.value, credData)
			await opts.completeImport(profile)
		} catch (err) {
			// User cancel: silent return (no warning notification on Escape /
			// "user closed" / "timed out or not allowed").
			if (err instanceof UserRejectedError) return
			opts.notifyImportFailed()
			console.error("Failed to import profile:", err)
		} finally {
			isImporting.value = false
		}
	}

	const {
		selectedBackup,
		decryptionPassword,
		restoreStatus,
		importedProfile,
		isAllowedToImportBackup,
		isRestoreHasErrors,
		parsedBackupName,
		pickBackupFile,
		decryptBackup,
		restoreBackup,
		showRestoreErrorLog,
		resetBackupState,
	} = useFullBackupImport({
		password,
		repeatedPassword,
		fillError,
		clearError,
		pickFile,
		completeImport: opts.completeImport,
		runCeremony,
		profileName,
		showErrorLog: opts.showErrorLog,
	})

	// Guarded prefill: fill the Profile-name input from a parsed backup, but
	// only when the user hasn't typed anything yet (protects mid-typing from a
	// delayed parse).
	watch(parsedBackupName, (newName) => {
		if (newName && !profileName.value.trim()) profileName.value = newName
	})

	// Keep `profileName` across import-method switches so the user doesn't have
	// to retype it after hitting Back.
	function clearFormState() {
		selectedImportOption.value = null
		privateKey.value = undefined
		publicKey.value = undefined
		seedPhrase.value = undefined
		password.value = ""
		repeatedPassword.value = ""
		resetBackupState()
		clearError()
	}
	const handleBack = () => clearFormState()

	function dispose() {
		disposeNameField()
	}

	return {
		// name field
		profileName,
		trimmedName,
		nameError,
		shakeName,
		nameInputRef,
		handleNameInput,
		// passkey ceremony
		ceremonyRequest,
		onCeremonyResolve,
		onCeremonyReject,
		// import state
		selectedImportOption,
		seedPhrase,
		privateKey,
		publicKey,
		password,
		repeatedPassword,
		maxPasswordLength,
		isImporting,
		error,
		isCopied,
		// per-method gates
		isAllowedToImportBySeedPhrase,
		isAllowedToImportByPrivateKey,
		isAllowedToImportByPublicKey,
		// full backup
		selectedBackup,
		decryptionPassword,
		restoreStatus,
		importedProfile,
		isAllowedToImportBackup,
		isRestoreHasErrors,
		pickBackupFile,
		decryptBackup,
		restoreBackup,
		showRestoreErrorLog,
		// handlers
		handleImportSeed,
		handleImportPrivateKey,
		handleImportPublicKey,
		handleImportPasskey,
		handlePasswordInput,
		handleSecretInput,
		handleCopyError,
		clearError,
		handleBack,
		completeImport: opts.completeImport,
		// lifecycle
		dispose,
	}
}
