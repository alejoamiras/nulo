/**
 * The committed token sprite, inlined at build time. A `<use href="#id">` cannot report whether its
 * target exists — it renders nothing and says nothing — so the key set is derived from the same
 * source string and every tile checks membership BEFORE choosing the sprite over its monogram.
 */
import spriteSource from "@/assets/token-sprite.svg?raw"

/** `<symbol id="…">` in id order; the source is a build-time constant, so one scan at init is enough. */
function readKeys(source: string): Set<string> {
	const keys = new Set<string>()
	for (const match of source.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)) keys.add(match[1] as string)
	return keys
}

export const SPRITE_SOURCE: string = spriteSource

export const SPRITE_KEYS: ReadonlySet<string> = readKeys(spriteSource)

/** `${chainId}:${address}` with the address lowercased — the shape `SelectableToken.logoKey` carries. */
export function hasSprite(logoKey: string): boolean {
	return SPRITE_KEYS.has(logoKey)
}

/** A stable hue for a token with no committed mark, from its chain-qualified key — never from the
 *  symbol, so two tokens claiming one ticker never look alike. */
export function monogramHue(logoKey: string): number {
	let hash = 0
	for (const char of logoKey) hash = (hash * 31 + char.charCodeAt(0)) % 360
	return hash
}

export function monogramBackground(logoKey: string): string {
	const hue = monogramHue(logoKey)
	return `repeating-linear-gradient(135deg, hsl(${hue} 55% 42%) 0 6px, hsl(${hue} 55% 32%) 6px 12px)`
}

/** Everything a mark is drawn from. Anything else — `script`, `foreignObject`, `use`, `image`, `a` —
 *  is dropped with its whole subtree rather than sanitised. */
const ADOPTABLE = new Set(["symbol", "g", "path", "circle", "rect", "ellipse", "polygon", "polyline", "line", "text", "title"])

/** `on*` is script; `href` in either spelling is a fetch or a navigation the sheet does not need. */
function isUnsafeAttribute(name: string): boolean {
	const lower = name.toLowerCase()
	return lower.startsWith("on") || lower === "href" || lower === "xlink:href"
}

/** Prunes `el` in place. False ⇒ the element itself is not adoptable and the caller must drop it. */
function prune(el: Element): boolean {
	if (!ADOPTABLE.has(el.localName.toLowerCase())) return false
	for (const attr of Array.from(el.attributes)) {
		if (isUnsafeAttribute(attr.name)) el.removeAttribute(attr.name)
	}
	for (const child of Array.from(el.children)) {
		if (!prune(child)) child.remove()
	}
	return true
}

/**
 * The `<symbol>`s of a sheet, parsed and stripped down to the allowlist. Only top-level symbols are
 * returned: a symbol nested under a dropped element is never lifted out of it.
 */
export function adoptableSymbols(source: string): Element[] {
	const parsed = new DOMParser().parseFromString(source, "image/svg+xml")
	return Array.from(parsed.documentElement.children).filter((el) => el.localName.toLowerCase() === "symbol" && prune(el))
}
