import type { Ref } from "vue"
import { computed, ref } from "vue"

/**
 * Options accepted by `useProfileNameField`. All fields are optional;
 * sensible defaults match the canonical Profile-name UX (1–32 characters,
 * trimmed, with the standard error messages used across the extension).
 *
 * `duplicateErrorMessage` is the toast/inline-error text shown when
 * `validate({ existingNames })` finds a case-folded NFKC-normalized
 * collision. Callers that don't pass `existingNames` to `validate()`
 * will never see it.
 */
export interface ProfileNameFieldOptions {
	minLength?: number
	maxLength?: number
	emptyErrorMessage?: string
	maxLengthErrorMessage?: string
	duplicateErrorMessage?: string
}

/** Options for a single `validate()` call. */
export interface ValidateOptions {
	/**
	 * If provided, validate rejects the name when it case-folded
	 * NFKC-normalizes to any string in this list. The list is the caller's
	 * responsibility — typically populated via `managers.profile.getProfiles()`
	 * right before submit, behind the existing `isCreating` / `isImporting`
	 * latch so two rapid clicks can't race past the check.
	 */
	existingNames?: string[]
}

/** Public surface of the `useProfileNameField` composable. */
export interface ProfileNameField {
	profileName: Ref<string>
	trimmedName: Readonly<Ref<string>>
	nameError: Ref<string>
	shakeName: Ref<boolean>
	nameInputRef: Ref<{ focus: () => void } | null>
	validate(opts?: ValidateOptions): boolean
	handleInput(): void
	triggerShake(): void
	dispose(): void
}

/**
 * Reactive state + validation for a Profile-name input.
 *
 * Consolidates the byte-identical validation block previously copy-pasted
 * across `onboarding/pages/create.vue`, `onboarding/pages/import.vue`,
 * `popup/pages/profile/new.vue`, and `popup/pages/import.vue`. The block
 * tracks the typed value, a trimmed view, an error string, a shake
 * animation flag, and a ref to the input element for focus restore on
 * validation failure.
 *
 * Validation is **synchronous** by design. When the caller needs to gate
 * on cross-profile name uniqueness, fetch the list (`getProfiles()`) in
 * the parent's submit handler BEFORE invoking `validate({ existingNames })`,
 * inside the same `isCreating` / `isImporting` latch the handler already
 * uses. This keeps the no-race property: two rapid clicks both early-exit
 * on `isCreating`; only one ever reaches the async fetch + sync validate.
 *
 * The composable is C0 (pure utility — no `chrome.*`, no service clients).
 * Parents own the lifetime and MUST call `dispose()` in `onBeforeUnmount`
 * (cleanup-order: after services, before listener teardown) to clear the
 * pending shake timer.
 *
 * Example:
 *
 * ```ts
 * const {
 *   profileName, trimmedName, nameError, shakeName, nameInputRef,
 *   validate: validateName, handleInput: handleNameInput, dispose,
 * } = useProfileNameField()
 *
 * async function handleSubmit() {
 *   if (isCreating.value) return
 *   isCreating.value = true                                  // latch FIRST
 *   try {
 *     const existing = (await managers.profile.getProfiles()).map((p) => p.name)
 *     if (!validateName({ existingNames: existing })) {
 *       isCreating.value = false
 *       return
 *     }
 *     // … proceed with profile creation against `trimmedName.value` …
 *   } catch (err) {
 *     isCreating.value = false
 *     // … existing error handling …
 *   }
 * }
 *
 * onBeforeUnmount(() => {
 *   profileService.disconnect()        // services first
 *   dispose()                           // composable second
 *   document.removeEventListener("keydown", onKeydown)  // listeners last
 * })
 * ```
 */
export function useProfileNameField(opts: ProfileNameFieldOptions = {}): ProfileNameField {
	const min = opts.minLength ?? 1
	const max = opts.maxLength ?? 32
	const emptyMsg = opts.emptyErrorMessage ?? "Profile name is required."
	const maxMsg = opts.maxLengthErrorMessage ?? `Max ${max} characters.`
	const duplicateMsg = opts.duplicateErrorMessage ?? "This name is already in use."

	const profileName = ref("")
	const trimmedName = computed(() => profileName.value.trim())
	const nameError = ref("")
	const shakeName = ref(false)
	const nameInputRef = ref<{ focus: () => void } | null>(null)
	let shakeTimer: ReturnType<typeof setTimeout> | null = null

	function triggerShake(): void {
		// Reset → next frame → set: forces the CSS keyframe animation to
		// re-run even if a previous shake hasn't finished. Without the
		// rAF gap the class change collapses into a single style update
		// and the animation doesn't replay.
		shakeName.value = false
		if (shakeTimer) clearTimeout(shakeTimer)
		requestAnimationFrame(() => {
			shakeName.value = true
			shakeTimer = setTimeout(() => {
				shakeName.value = false
			}, 400)
		})
	}

	function isDuplicate(candidate: string, existingNames: string[]): boolean {
		// NFKC + locale-aware lowercase catches stylistic variants ("ﬂ" vs "fl",
		// "K" vs "K", trailing-period vs no-period). It does NOT catch
		// cross-script homoglyphs (Cyrillic 'А' vs Latin 'A') — flagged as
		// follow-up in plan-v2.md §7.2; out of scope for this PR.
		const normalized = candidate.normalize("NFKC").toLocaleLowerCase()
		return existingNames.some((existing) => existing.normalize("NFKC").toLocaleLowerCase() === normalized)
	}

	function validate(checkOpts: ValidateOptions = {}): boolean {
		const n = trimmedName.value
		if (n.length < min) {
			nameError.value = emptyMsg
			triggerShake()
			nameInputRef.value?.focus()
			return false
		}
		if (n.length > max) {
			nameError.value = maxMsg
			triggerShake()
			return false
		}
		if (checkOpts.existingNames && isDuplicate(n, checkOpts.existingNames)) {
			nameError.value = duplicateMsg
			triggerShake()
			nameInputRef.value?.focus()
			return false
		}
		nameError.value = ""
		return true
	}

	function handleInput(): void {
		if (nameError.value) nameError.value = ""
	}

	function dispose(): void {
		if (shakeTimer) clearTimeout(shakeTimer)
		shakeTimer = null
	}

	return {
		profileName,
		trimmedName,
		nameError,
		shakeName,
		nameInputRef,
		validate,
		handleInput,
		triggerShake,
		dispose,
	}
}
