import { computed, ref, watch } from "vue"
import { DuplicateWalletError, UserRejectedError } from "@nulo/extension-messaging/errors"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
import { useFullBackupImport } from "@/composables/useFullBackupImport"
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"
import { useProfileNameField } from "@/composables/useProfileNameField"
import { FileTooLargeError, pickFile } from "@/utils"
import { copyToClipboard } from "@/utils/clipboard"
import { MAX_BACKUP_FILE_BYTES } from "@/utils/full-backup-helpers"
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (207 lines) — split when touched, never grow
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

	const cacheStore = useCacheStore()
	const popupStore = usePopupStore()
	/** `cacheStore.confirm` is an untyped shared `reactive({})` (every other consumer is an
	 *  unchecked SFC). Narrow it here to the fields ConfirmPopup actually reads. */
	const confirmSlot = cacheStore.confirm as {
		title?: string
		description?: string
		confirm_text?: string
		callback?: () => void
	}
	/** Set once the user confirms the duplicate-recovery-phrase warning; the retry passes it to
	 *  the service. Reset per attempt so a confirm never leaks into a later, unrelated import. */
	const allowDuplicate = ref(false)

	/**
	 * Warn-and-confirm for a duplicate recovery phrase (owner policy: a warned choice, never a
	 * hard block). `run` is re-invoked with `allowDuplicate` set if the user confirms; any other
	 * error propagates untouched. Shared by the seed + passkey + full-backup import paths, so the
	 * copy and the retry semantics can't drift between them.
	 */
	async function withDuplicateConfirm<T>(run: () => Promise<T>): Promise<T | undefined> {
		try {
			return await run()
		} catch (err) {
			if (!(err instanceof DuplicateWalletError)) throw err
			const existing = (err.details as { existingProfileName?: string } | undefined)?.existingProfileName
			const confirmed = await new Promise<boolean>((resolve) => {
				let settled = false
				const settle = (value: boolean) => {
					if (settled) return
					settled = true
					stop()
					resolve(value)
				}
				confirmSlot.title = "You already have this wallet"
				confirmSlot.description = existing
					? `“${existing}” already uses this recovery phrase. Both profiles will hold the same accounts and funds. Add it anyway?`
					: "Another profile already uses this recovery phrase. Both profiles will hold the same accounts and funds. Add it anyway?"
				confirmSlot.confirm_text = "Add anyway"
				// ConfirmPopup invokes `callback` on confirm and just closes on cancel/dismiss —
				// there is no cancel hook — so the close transition IS the cancel signal. Watch it
				// (the watcher starts before `open`, and `settle` is idempotent, so a confirm that
				// also closes can't resolve twice).
				confirmSlot.callback = () => settle(true)
				const stop = watch(
					() => popupStore.isOpened("confirm"),
					(isOpen, wasOpen) => {
						if (wasOpen && !isOpen) settle(false)
					},
				)
				popupStore.open("confirm")
			})
			if (!confirmed) return undefined
			allowDuplicate.value = true
			try {
				return await run()
			} finally {
				allowDuplicate.value = false
			}
		}
	}

	const selectedImportOption = ref<string | null>(null)
	const seedPhrase = ref<string | undefined>(undefined)
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
		void copyToClipboard(`${error.value.title}${error.value.tooltip ? `: ${error.value.tooltip}` : ""}`, opts.openToast, {
			success: { label: "Error is copied" },
			failure: { label: "Couldn't copy", icon: "warning", duration: 3_000 },
		})
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
		if (!repeatedPassword.value || password.value !== repeatedPassword.value) return false
		return true
	})
	const isAllowedToImportBySeedPhrase = computed(() => {
		if (!isAllowedToContinue.value) return false
		return seedPhrase.value?.split(" ").length === 24 && password.value.length >= 8
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
			const profile = await withDuplicateConfirm(() =>
				managers.profile.importMnemonic(
					trimmedName.value,
					(seedPhrase.value ?? "").split(" "),
					password.value,
					allowDuplicate.value,
				),
			)
			// `undefined` = the user declined the duplicate warning; stay on the form.
			if (!profile) return
			await opts.completeImport(profile)
		} catch (err) {
			fillUnknownImportError(err)
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
			// The SAME credentialData is reused on the confirm-retry — no second WebAuthn ceremony.
			const profile = await withDuplicateConfirm(() =>
				managers.profile.importPasskey(trimmedName.value, credData, allowDuplicate.value),
			)
			if (!profile) return
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
		restoreStage,
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
		// Capped pick: the byte gate must run inside pickFile (compressed files
		// inflate in there, before any caller-side .size check could). The cap
		// error maps to the flow's error banner and the flow exits through its
		// existing no-file path.
		pickFile: async () => {
			try {
				return await pickFile(undefined, false, true, MAX_BACKUP_FILE_BYTES)
			} catch (err) {
				if (err instanceof FileTooLargeError) {
					fillError(
						"full_backup",
						"Backup File Too Large",
						"The backup file is too large to import. Please select a correct backup file.",
					)
					return undefined
				}
				throw err
			}
		},
		completeImport: opts.completeImport,
		runCeremony,
		profileName,
		showErrorLog: opts.showErrorLog,
		allowDuplicate,
		confirmDuplicate: withDuplicateConfirm,
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
		password,
		repeatedPassword,
		maxPasswordLength,
		isImporting,
		error,
		isCopied,
		// per-method gates
		isAllowedToImportBySeedPhrase,
		// full backup
		selectedBackup,
		decryptionPassword,
		restoreStatus,
		restoreStage,
		importedProfile,
		isAllowedToImportBackup,
		isRestoreHasErrors,
		pickBackupFile,
		decryptBackup,
		restoreBackup,
		showRestoreErrorLog,
		// handlers
		handleImportSeed,
		handleImportPasskey,
		handlePasswordInput,
		handleSecretInput,
		handleCopyError,
		clearError,
		handleBack,
		// lifecycle
		dispose,
	}
}
