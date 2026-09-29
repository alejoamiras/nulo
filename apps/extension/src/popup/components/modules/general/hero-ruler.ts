/** The width the hero's line gives its figure, in px. */
export function heroRoom(section: Element): number {
	return section.getBoundingClientRect().width
}

/** The width of one of the ruler's forms, in px, drawn at `scale` of the hero's full size. */
export function rulerWidth(form: Element, scale: number): number {
	const style = (form as HTMLElement).style
	style.setProperty("--hero-scale", String(scale))
	const width = form.getBoundingClientRect().width
	style.removeProperty("--hero-scale")
	return width
}
