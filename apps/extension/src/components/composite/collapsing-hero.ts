import type { InjectionKey } from "vue"

export interface CollapsingHero {
	/** Brings `el` whole into view below the sticky bar. The landing can be the scroller's end, so
	 *  `el` must be a trailing block that fits between the bar and the scroller's bottom. */
	reveal: (el: Element) => void
}

export const COLLAPSING_HERO: InjectionKey<CollapsingHero> = Symbol("collapsing-hero")

/** Edges in viewport px, read at the scroller's current `scrollTop`. */
export interface RevealGeometry {
	scrollTop: number
	maxScroll: number
	barBottom: number
	viewBottom: number
	titleBottom: number
	blockTop: number
	blockBottom: number
}

/**
 * How to bring a block whole into view: the scroller's end where that end carries the hero's title
 * past the sticky bar, so the title never rests cut by it; otherwise the nearest scroll that shows
 * the block.
 */
export function revealMove(g: RevealGeometry): "none" | "end" | "nearest" {
	if (g.blockTop >= g.barBottom && g.blockBottom <= g.viewBottom) return "none"
	return g.scrollTop + g.titleBottom - g.barBottom <= g.maxScroll ? "end" : "nearest"
}
