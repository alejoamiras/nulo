import { onScopeDispose, type Ref, readonly, ref, watch } from "vue"

/** "Review send" and "Send now" occupy the same spot; this is what a double tap cannot cross. */
export const REVIEW_ARM_MS = 800

export type SubmitSource = "primary" | "review"

export interface SendReview {
	/** Closed or covered → false. Shown and not gated → true at once. Shown and gated → true `REVIEW_ARM_MS` after whichever came last. */
	ready: Readonly<Ref<boolean>>
	/** A gated send is authorised only by the sheet's own action while `ready` — which implies open. */
	authorises(source: SubmitSource): boolean
}

/**
 * `isTop`: the sheet holds the top slot of the popup stack. A popup opened over it takes the pointer,
 * and when that popup's trap releases without closing it, the keyboard falls back to the sheet — so a
 * covered sheet must not be able to send.
 */
export function useSendReview(opts: { isGated: () => boolean; isOpen: () => boolean; isTop: () => boolean }): SendReview {
	const ready = ref(false)
	let timer: ReturnType<typeof setTimeout> | undefined

	const disarm = () => {
		clearTimeout(timer)
		timer = undefined
	}

	// Sync, so no click can land between a send turning gated (or covered) and `ready` dropping. Separate
	// sources rather than one tuple: a recomputed-but-equal reading must not restart the wait.
	watch(
		[opts.isOpen, opts.isTop, opts.isGated],
		([open, top, gated]) => {
			disarm()
			const shown = open && top
			ready.value = shown && !gated
			if (!shown || !gated) return
			timer = setTimeout(() => {
				timer = undefined
				ready.value = true
			}, REVIEW_ARM_MS)
		},
		{ immediate: true, flush: "sync" },
	)

	onScopeDispose(disarm)

	return {
		ready: readonly(ready),
		authorises: (source) => source === "review" && ready.value,
	}
}
