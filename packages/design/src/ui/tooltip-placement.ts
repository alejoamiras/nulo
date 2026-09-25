export type TooltipSide = "top" | "bottom" | "left" | "right"
export type TooltipPosition = "start" | "end" | "center"

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number }
type Size = { width: number; height: number }

export type TooltipPlacementInput = {
	trigger: Box
	bubble: Size
	viewport: Size
	side: string
	position: string
}

const TOOLTIP_GAP = 6
const TOOLTIP_INSET = 8

const crossAxis = (position: string, start: number, end: number, triggerSize: number, bubbleSize: number): number => {
	switch (position) {
		case "center":
			return start - (bubbleSize / 2 - triggerSize / 2)
		case "start":
			return start
		case "end":
			return end - bubbleSize
		default:
			// The position validator only warns, so an invalid value reaches here; the clamp moves it to the inset.
			return 0
	}
}

const clamp = (value: number, size: number, extent: number): number =>
	Math.max(TOOLTIP_INSET, Math.min(value, extent - TOOLTIP_INSET - size))

/**
 * Where the bubble's top-left corner goes: `top` and `bottom` flip to the other side when only the
 * other side fits, then both coordinates stay `TOOLTIP_INSET` inside the viewport, and a bubble
 * larger than the viewport takes the start inset.
 */
export function placeTooltip({ trigger, bubble, viewport, side, position }: TooltipPlacementInput): { x: number; y: number } {
	const above = trigger.top - bubble.height - TOOLTIP_GAP
	const below = trigger.bottom + TOOLTIP_GAP
	const fitsAbove = above >= TOOLTIP_INSET
	const fitsBelow = below + bubble.height <= viewport.height - TOOLTIP_INSET
	const x = crossAxis(position, trigger.left, trigger.right, trigger.width, bubble.width)
	const y = crossAxis(position, trigger.top, trigger.bottom, trigger.height, bubble.height)

	let point = { x: 0, y: 0 }
	switch (side) {
		case "top":
			point = { x, y: !fitsAbove && fitsBelow ? below : above }
			break
		case "bottom":
			point = { x, y: !fitsBelow && fitsAbove ? above : below }
			break
		case "left":
			point = { x: trigger.left - bubble.width - TOOLTIP_GAP, y }
			break
		case "right":
			point = { x: trigger.right + TOOLTIP_GAP, y }
			break
	}
	return { x: clamp(point.x, bubble.width, viewport.width), y: clamp(point.y, bubble.height, viewport.height) }
}
