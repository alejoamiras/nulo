import { ref } from "vue"

/**
 * Which section the shell shows, and the record the Activity page should draw attention to. One
 * module-level state, like every other cross-component state in this app, so the wizard's
 * background strip can open Activity without a prop chain.
 */
export type Section = "send" | "drip" | "activity"

/** A `bridge.*` host lands on Send; everywhere else the faucet is the front door. */
const section = ref<Section>("send")
const highlightedId = ref<string | null>(null)

export function useShell() {
	function goTo(next: Section): void {
		section.value = next
	}

	function openActivity(recordId?: string): void {
		highlightedId.value = recordId ?? null
		section.value = "activity"
	}

	return { section, highlightedId, goTo, openActivity }
}

/** Test-only: back to the boot state. */
export function __resetShellForTests(): void {
	section.value = "send"
	highlightedId.value = null
}
