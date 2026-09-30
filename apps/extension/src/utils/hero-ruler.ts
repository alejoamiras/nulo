/** The width the hero's line gives its figure, in px. */
export function heroRoom(section: Element): number {
	return section.getBoundingClientRect().width
}

/** The width an input gives its text, in px: its box less its horizontal padding and border. */
export function inputRoom(input: Element): number {
	const style = getComputedStyle(input)
	const sides = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
	return input.getBoundingClientRect().width - sides.reduce((sum, side) => sum + Number.parseFloat(side), 0)
}

/** The width of one of the ruler's forms, in px, drawn at `scale` of the hero's full size. */
export function rulerWidth(form: Element, scale: number): number {
	const style = (form as HTMLElement).style
	style.setProperty("--hero-scale", String(scale))
	const width = form.getBoundingClientRect().width
	style.removeProperty("--hero-scale")
	return width
}
