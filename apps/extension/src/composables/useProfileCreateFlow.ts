import { computed, ref } from "vue"
import { UserRejectedError } from "@nulo/extension-messaging/errors"
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"
import { useProfileNameDefault } from "@/composables/useProfileNameDefault"
import { useProfileNameField } from "@/composables/useProfileNameField"
import { managers } from "@/utils/core"
import { createPasskeyProfileWithRetry } from "@/wallet/utils/create-passkey-profile"
import { isNewPasswordValid, newPasswordHint } from "@/utils/password"

/**
 * Shared orchestration for the profile-CREATE flow, consumed by both the popup
 * (`popup/pages/profile/new.vue`) and onboarding (`onboarding/pages/create.vue`)
 * shells. Owns name + password validation, the strength hint, the passkey
 * create-with-retry ceremony, and the submit handler up to activation.
 *
 * The activation tail is INJECTED via `onCreated`: the popup runs its manual
 * post-create sequence (it relies on `popup/app.vue`'s `onActiveProfileChanged`
 * listener for the heavy bootstrap); onboarding calls `bootstrapActiveProfile`
 * itself. `onKeydown` is deliberately NOT owned here — the two shells differ
 * (popup has no `<form>`; onboarding has `<form @submit.prevent>`), so each page
 * wires its own.
 *
 * C1 lifecycle: exposes `dispose()`; never registers its own `onUnmounted`.
 * Secret refs are exposed but NOT zeroed here — zeroing is a per-shell concern.
 */
export interface UseProfileCreateFlowOptions {
	/** Per-shell activation + routing. Popup: manual sequence (listener-based). Onboarding: `bootstrapActiveProfile` then route. */
	onCreated: (profile: unknown) => Promise<void> | void
	/** Per-shell create-failure notification. `isPasskey` selects the description/note copy; the page owns `notificationStore.create`. */
	notifyCreateFailed: (isPasskey: boolean) => void
}

async function listProfileNames(): Promise<string[]> {
	return (await managers.profile.getProfiles()).map((p) => p.name)
}

export function useProfileCreateFlow(opts: UseProfileCreateFlowOptions) {
	const nameField = useProfileNameField()
	const { profileName, nameError, shakeName, nameInputRef, handleInput: handleNameInput, dispose: disposeNameField } = nameField
	const { nameFieldState, resolveName } = useProfileNameDefault(nameField, listProfileNames)

	const { request: ceremonyRequest, runCeremony, onResolve: onCeremonyResolve, onReject: onCeremonyReject } = usePasskeyCeremony()

	const authMethod = ref<"password" | "passkey">("password")
	const password = ref("")
	const repeatedPassword = ref("")
	const isCreating = ref(false)

	const strengthHint = computed(() =>
		authMethod.value === "passkey" ? "" : newPasswordHint(password.value ?? "", repeatedPassword.value ?? ""),
	)

	// Name check is excluded on purpose — name is validated at submit time so an
	// empty name shakes the input instead of silently disabling the button.
	const isAllowedToContinue = computed(
		() => authMethod.value === "passkey" || isNewPasswordValid(password.value ?? "", repeatedPassword.value ?? ""),
	)

	// Runs the passkey-create ceremony in-page, then creates the profile via the
	// SW. Retries ONCE on ProfileIdConflictError via the shared helper.
	function createPasskeyProfileViaModal(name: string) {
		return createPasskeyProfileWithRetry(name, {
			runCeremony,
			generateProfileId: () => managers.profile.generateProfileId(),
			createPasskeyProfile: (n, c) => managers.profile.createPasskeyProfile(n, c),
		})
	}

	const handleCreate = async () => {
		if (isCreating.value) return
		if (!isAllowedToContinue.value) return
		// Latch FIRST, before the async getProfiles() fetch, so two rapid clicks
		// can't both race past the validate check before the lock is set.
		isCreating.value = true

		let profile: unknown
		try {
			const name = await resolveName()
			if (name === null) {
				isCreating.value = false
				return
			}
			profile =
				authMethod.value === "passkey"
					? await createPasskeyProfileViaModal(name)
					: await managers.profile.createProfile(name, password.value)
		} catch (e) {
			// User cancel: silent return (no warning notification).
			if (e instanceof UserRejectedError) {
				isCreating.value = false
				return
			}
			opts.notifyCreateFailed(authMethod.value === "passkey")
			console.error("Failed to create profile:", e)
			isCreating.value = false
			return
		}

		// Activation + routing live in the shell-injected callback. isCreating
		// stays true through it (the button reads "Creating…") and resets after.
		// If onCreated throws (e.g. popup's "Network not set"), the latch is left
		// set, matching the pre-extraction behavior.
		await opts.onCreated(profile)
		isCreating.value = false
	}

	function dispose() {
		disposeNameField()
	}

	return {
		nameFieldState,
		profileName,
		nameError,
		shakeName,
		nameInputRef,
		handleNameInput,
		ceremonyRequest,
		onCeremonyResolve,
		onCeremonyReject,
		authMethod,
		password,
		repeatedPassword,
		isCreating,
		strengthHint,
		isAllowedToContinue,
		handleCreate,
		dispose,
	}
}
