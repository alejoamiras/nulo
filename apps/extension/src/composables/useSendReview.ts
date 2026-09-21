import { onScopeDispose, type Ref, readonly, ref, watch } from "vue"

/** "Review send" and "Send now" occupy the same spot; this is what a double tap cannot cross. */
export const REVIEW_ARM_MS = 800

export type SubmitSource = "primary" | "review"

export interface SendReview {
	/** Closed → false. Open and not gated → true at once. Open and gated → true `REVIEW_ARM_MS` after whichever came last. */
	ready: Readonly<Ref<boolean>>
	/** A gated send is authorised only by the sheet's own action while `ready` — which implies open. */
	authorises(source: SubmitSource): boolean
}

export function useSendReview(opts: { isGated: () => boolean; isOpen: () => boolean }): SendReview {
	const ready = ref(false)
	let timer: ReturnType<typeof setTimeout> | undefined

	const disarm = () => {
		clearTimeout(timer)
		timer = undefined
	}

	// Sync, so no click can land between a send turning gated and `ready` dropping. Two sources rather
	// than one tuple: a recomputed-but-equal reading must not restart the wait.
	watch(
		[opts.isOpen, opts.isGated],
		([open, gated]) => {
			disarm()
			ready.value = open && !gated
			if (!open || !gated) return
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
