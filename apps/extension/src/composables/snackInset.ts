/** Vendor */
import { type ObjectDirective, onScopeDispose, type Ref, readonly, ref, watch } from "vue"

/** Composables */
import { useToast } from "@/composables/toast"

/** The drawn gap between the snack and what it sits above: the viewport's bottom edge or a footer. */
export const SNACK_GAP = 12

const footers = new Set<HTMLElement>()
/** In open order, so the last one is the sheet on top. */
const sheets: HTMLElement[] = []
const subscribers = new Set<() => void>()

const changed = () => {
	for (const notify of subscribers) notify()
}

/** A bottom action row: the snack sits `SNACK_GAP` above its top edge while that edge is on screen, or
 *  would be once what scrolls it is scrolled to its end. */
export const vSnackFooter: ObjectDirective<HTMLElement> = {
	mounted(el) {
		footers.add(el)
		changed()
	},
	unmounted(el) {
		footers.delete(el)
		changed()
	},
}

/** An open sheet, which covers the nav: while it is on top, only the footers inside it place the snack. */
export const vSnackSheet: ObjectDirective<HTMLElement> = {
	mounted(el) {
		sheets.push(el)
		changed()
	},
	unmounted(el) {
		const at = sheets.lastIndexOf(el)
		if (at !== -1) sheets.splice(at, 1)
		changed()
	},
}

export interface FooterBox {
	top: number
	bottom: number
	/** How far the footer rises once everything that scrolls it is scrolled to its end. */
	riseToEnd?: number
}

/**
 * The snack's distance from the viewport's bottom edge: `base`, raised to `SNACK_GAP` above the
 * highest point a footer's top edge reaches on screen, where it is now or where it stops once
 * everything that scrolls it is scrolled to its end. A footer with no height places nothing.
 */
export function snackInset(base: number, viewportHeight: number, boxes: readonly FooterBox[]): number {
	let inset = base
	for (const { top, bottom, riseToEnd = 0 } of boxes) {
		if (bottom <= top) continue
		// A scroll can bring the row up and a click land on it in one task, before the next measure.
		for (const at of [top, top - riseToEnd]) {
			if (at > 0 && at < viewportHeight) inset = Math.max(inset, viewportHeight - at + SNACK_GAP)
		}
	}
	return inset
}

/** The overflow values a user can scroll; `hidden` clips without scrolling. */
const SCROLLABLE = new Set(["auto", "scroll", "overlay"])

const leftToScroll = (el: Element) => Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop)

/** How far `el` rises once each container that scrolls it, the page included, is scrolled to its
 *  end. A sticky box keeps its place while the container it sticks to scrolls. */
function riseOf(el: HTMLElement): number {
	let rise = 0
	let sticky = getComputedStyle(el).position === "sticky"
	for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
		const style = getComputedStyle(node)
		if (SCROLLABLE.has(style.overflowY)) {
			if (!sticky) rise += leftToScroll(node)
			sticky = false
		}
		if (style.position === "sticky") sticky = true
	}
	return sticky ? rise : rise + leftToScroll(document.scrollingElement ?? document.documentElement)
}

/**
 * The inset for the host that renders the snack. `base` is the inset with no sheet open (above the
 * nav, or `SNACK_GAP`). It is measured again on the next frame after anything that can move a
 * footer (one arriving or leaving, a footer resizing, the page's content changing, a resize, a
 * scroll, the end of a transition) and at once when a snack opens, so a card never rises at a stale
 * height.
 */
export function useSnackInset(base: () => number): Readonly<Ref<number>> {
	const { toast } = useToast()
	const inset = ref(base())
	let frame: number | undefined

	const measure = () => {
		if (frame !== undefined) cancelAnimationFrame(frame)
		frame = undefined
		const top = sheets.at(-1)
		const placing = [...footers].filter((el) => el.isConnected && (!top || top.contains(el)))
		const boxes = placing.map((el) => {
			const { top: at, bottom } = el.getBoundingClientRect()
			return { top: at, bottom, riseToEnd: riseOf(el) }
		})
		inset.value = snackInset(top ? SNACK_GAP : base(), document.documentElement.clientHeight, boxes)
	}
	const schedule = () => {
		frame ??= requestAnimationFrame(measure)
	}

	// jsdom has no ResizeObserver; there the other triggers still measure.
	const resizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule)
	const onRegistry = () => {
		resizes?.disconnect()
		for (const el of footers) resizes?.observe(el)
		schedule()
	}
	// Content added, removed or restyled above a footer moves it without resizing it.
	const mutations = new MutationObserver(schedule)

	subscribers.add(onRegistry)
	onRegistry()
	mutations.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
	window.addEventListener("resize", schedule)
	document.addEventListener("scroll", schedule, { capture: true, passive: true })
	document.addEventListener("transitionend", schedule, true)
	document.addEventListener("animationend", schedule, true)
	watch(base, schedule)
	watch(() => toast.value?.id, measure)

	onScopeDispose(() => {
		subscribers.delete(onRegistry)
		resizes?.disconnect()
		mutations.disconnect()
		if (frame !== undefined) cancelAnimationFrame(frame)
		window.removeEventListener("resize", schedule)
		document.removeEventListener("scroll", schedule, { capture: true })
		document.removeEventListener("transitionend", schedule, true)
		document.removeEventListener("animationend", schedule, true)
	})

	return readonly(inset)
}
