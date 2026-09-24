import { type DeepReadonly, type Ref, readonly, ref } from "vue"
import type { ProfileNameField } from "@/composables/useProfileNameField"
import { defaultProfileName } from "@/utils/profile-name"

/** Whether the page renders its Profile-name field. `pending` until the profile list is read. */
export type NameFieldState = "pending" | "hidden" | "shown"

/**
 * The automatic Profile name. A first profile gets no field and is named "Main"; a later one
 * shows the field prefilled "Profile N". A failed read shows the field empty, never a guess.
 *
 * The field is untouched while it holds the last value written here (the default, or a
 * backup's name passed to `offer`); anything else is the user's and is never overwritten.
 * The submitted name is resolved at submit time from a fresh read, so a profile added or
 * deleted elsewhere since the page opened cannot make an automatic name stale or duplicate.
 *
 * C1: receives the flow's name field and its profile-list getter; connects nothing and
 * registers no lifecycle hook.
 */
export function useProfileNameDefault(
	field: Pick<ProfileNameField, "profileName" | "trimmedName" | "validate">,
	listNames: () => Promise<readonly string[]>,
): {
	nameFieldState: DeepReadonly<Ref<NameFieldState>>
	offer: (backupName: string | null) => void
	resolveName: (backupName?: string | null) => Promise<string | null>
} {
	const nameFieldState = ref<NameFieldState>("pending")
	let lastAuto = ""
	let pageDefault = ""
	let offered: string | null = null
	let submitting = false

	function writeAuto(value: string): void {
		if (field.profileName.value !== lastAuto) return
		lastAuto = value
		field.profileName.value = value
	}

	listNames().then(
		(names) => {
			// A read that lands after submit started must not rewrite the field under it.
			if (!submitting) {
				pageDefault = defaultProfileName(names)
				writeAuto(offered ?? pageDefault)
			}
			nameFieldState.value = names.length === 0 ? "hidden" : "shown"
		},
		() => {
			nameFieldState.value = "shown"
		},
	)

	/** A backup's name (`null`: the backup has none) becomes the automatic value. */
	function offer(backupName: string | null): void {
		offered = backupName
		writeAuto(backupName ?? pageDefault)
	}

	/**
	 * The name to submit: the user's own, validated against a fresh list (`null` when it fails
	 * validation), else `backupName`, else a default unique against that list. Rejects when the
	 * list cannot be read. Call it once per submit, inside the flow's latch.
	 */
	async function resolveName(backupName?: string | null): Promise<string | null> {
		submitting = true
		const names = await listNames()
		if (field.profileName.value !== lastAuto) {
			return field.validate({ existingNames: names }) ? field.trimmedName.value : null
		}
		return backupName || defaultProfileName(names)
	}

	return { nameFieldState: readonly(nameFieldState), offer, resolveName }
}
