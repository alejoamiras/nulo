import { isRef, type Ref, ref, watch } from "vue"

type MaybeEl = Ref<HTMLElement | null | undefined> | HTMLElement | null | undefined
type MaybeTarget = Ref<EventTarget | null | undefined> | EventTarget | null | undefined

/**
 * Invoke `onOutsidePressCallback` when a press lands outside `el`. Ported verbatim from the
 * extension's `composables/outside.js`. Behavior to preserve:
 *  - iPad/iPhone listen on `touchstart`; everything else on `mousedown` (UA sniff).
 *  - the `data-outside` collision guard lets nested outside-aware regions coexist (a press inside a
 *    sibling outside-region with a different id is ignored).
 */
export function useOutside(el: MaybeEl, onOutsidePressCallback: (e: Event) => unknown) {
	const { value: element } = isRef(el) ? el : ref(el)

	const component = element ? element : (el as Ref<HTMLElement | null | undefined>).value

	const handler = (e: Event) => {
		const targetParentId = ((e.target as Node | null)?.parentNode as HTMLElement | null)?.id
		/** resolve collisions */
		const anchor = ((element as HTMLElement).parentNode as Element | null)?.closest("div[data-outside]") as HTMLElement | null
		if (anchor && anchor.id !== targetParentId) return

		return component && !component.contains(e.target as Node) && onOutsidePressCallback(e)
	}

	const ua = navigator.userAgent
	return useEvent(document, ua.match(/iPad/i) || ua.match(/iPhone/) ? "touchstart" : "mousedown", handler, { passive: true })
}

export function useEvent(el: MaybeTarget, name: string, listener: EventListener, options?: AddEventListenerOptions) {
	let remove = () => {}

	if (el) {
		const element = isRef(el) ? el : ref(el)

		const removeEventListener = (e: EventTarget) => e.removeEventListener(name, listener)
		const addEventListener = (e: EventTarget) => {
			e.addEventListener(name, listener, options)
		}

		const removeWatch = watch(
			element,
			(n, _, cleanUp) => {
				if (n) {
					addEventListener(n)
					cleanUp(() => removeEventListener(n))
				}
			},
			{ immediate: true },
		)

		remove = () => {
			// Verbatim: the original calls this unconditionally (throws if the ref cleared first).
			removeEventListener(element.value as EventTarget)
			removeWatch()
		}
	}

	return remove
}
