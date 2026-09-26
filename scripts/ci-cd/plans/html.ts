/**
 * What a browser reads as a URL in HTML, and how it decodes one. The gate judges a URL only when it can
 * decode it exactly as a browser would; every other URL-bearing construct is an opaque finding, never
 * skipped. HTML's full named-reference table is not a dependency, so only the names below decode.
 */

/** HTML maps a numeric reference in the C1 range through Windows-1252; 0x81, 0x8D, 0x8F, 0x90 and 0x9D stay. */
const C1: ReadonlyMap<number, number> = new Map([
	[0x80, 0x20ac],
	[0x82, 0x201a],
	[0x83, 0x0192],
	[0x84, 0x201e],
	[0x85, 0x2026],
	[0x86, 0x2020],
	[0x87, 0x2021],
	[0x88, 0x02c6],
	[0x89, 0x2030],
	[0x8a, 0x0160],
	[0x8b, 0x2039],
	[0x8c, 0x0152],
	[0x8e, 0x017d],
	[0x91, 0x2018],
	[0x92, 0x2019],
	[0x93, 0x201c],
	[0x94, 0x201d],
	[0x95, 0x2022],
	[0x96, 0x2013],
	[0x97, 0x2014],
	[0x98, 0x02dc],
	[0x99, 0x2122],
	[0x9a, 0x0161],
	[0x9b, 0x203a],
	[0x9c, 0x0153],
	[0x9e, 0x017e],
	[0x9f, 0x0178],
])

/** The named references the gate decodes, and only with their semicolon; names are case-sensitive. */
const NAMED: ReadonlyMap<string, string> = new Map([
	["amp", "&"],
	["AMP", "&"],
	["lt", "<"],
	["LT", "<"],
	["gt", ">"],
	["GT", ">"],
	["quot", '"'],
	["QUOT", '"'],
	["apos", "'"],
	["nbsp", " "],
])

/** HTML's frozen list of names that also decode without their semicolon (the Latin-1 set). */
const LEGACY: ReadonlySet<string> = new Set(
	[
		"AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT Iacute Icirc",
		"Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml Yacute",
		"aacute acirc acute aelig agrave amp aring atilde auml brvbar ccedil cedil cent copy curren deg divide eacute",
		"ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl igrave iquest iuml laquo lt macr micro",
		"middot nbsp not ntilde oacute ocirc ograve ordf ordm oslash otilde ouml para plusmn pound quot raquo reg",
		"sect shy sup1 sup2 sup3 szlig thorn times uacute ucirc ugrave uml uuml yacute yen yuml",
	]
		.join(" ")
		.split(" "),
)

/** A numeric reference needs no semicolon; a named one decodes here only with it. */
const REFERENCE_RE = /&(?:#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?|([A-Za-z][A-Za-z0-9]*);)/g
/** Named references start with a letter; `&` before anything else is plain text. */
const NAMED_RE = /&([A-Za-z][A-Za-z0-9]*)(;?)/g

function fromCodePoint(code: number): string {
	if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�"
	return String.fromCodePoint(C1.get(code) ?? code)
}

/** Numeric references as HTML decodes them; named ones outside `NAMED` stay as written. */
export function decodeEntities(text: string): string {
	return text.replace(REFERENCE_RE, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
		if (name !== undefined) return NAMED.get(name) ?? whole
		return fromCodePoint(hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? "", 10))
	})
}

function longestLegacyPrefix(name: string): string | undefined {
	for (let end = Math.min(name.length, 6); end > 1; end--) {
		if (LEGACY.has(name.slice(0, end))) return name.slice(0, end)
	}
	return undefined
}

/**
 * The first named reference a browser decodes in an attribute but the gate cannot, or null. HTML
 * matches the longest known name: with its semicolon it may be any of some two thousand names, so only
 * `NAMED` passes; without it only a legacy name can match, and in an attribute not when a letter, digit
 * or `=` follows (`?a=1&family=2` and `&notify` stay text).
 */
export function undecodableReference(value: string): string | null {
	for (const m of value.matchAll(NAMED_RE)) {
		const [ref, name, semicolon] = m
		if (semicolon) {
			if (!NAMED.has(name)) return ref
			continue
		}
		const legacy = longestLegacyPrefix(name)
		const next = value[(m.index ?? 0) + 1 + (legacy?.length ?? 0)]
		if (legacy !== undefined && legacy.length === name.length && next !== "=") return `&${legacy}`
	}
	return null
}

type AttributeKind = "url" | "list" | "srcset" | "opaque"

/**
 * Every attribute HTML or SVG reads as a URL. `href` counts on any element (SVG and MathML use it too),
 * except `base`, whose href re-bases every relative link; `data` is a URL only on `object`.
 */
const ATTRIBUTES: ReadonlyMap<string, AttributeKind> = new Map([
	["href", "url"],
	["xlink:href", "url"],
	["src", "url"],
	["poster", "url"],
	["cite", "url"],
	["action", "url"],
	["formaction", "url"],
	["longdesc", "url"],
	["background", "url"],
	["manifest", "url"],
	["lowsrc", "url"],
	["dynsrc", "url"],
	["usemap", "url"],
	["srcset", "srcset"],
	["imagesrcset", "srcset"],
	["ping", "list"],
	["srcdoc", "opaque"],
	["codebase", "opaque"],
	["classid", "opaque"],
	["archive", "opaque"],
	["profile", "opaque"],
])
/** Elements whose URLs live in plugin parameters the gate cannot read. */
const OPAQUE_ELEMENTS: ReadonlySet<string> = new Set(["applet", "param"])
/** `needle` is the text that locates the URL in its source: the raw value, or each candidate of a list. */
export type AttributeLink = { href: string; needle: string }
export type AttributeVerdict = { links: AttributeLink[] } | { opaque: string } | null

const CSS_URL_RE = /url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'()\\]*))\s*\)/gi
const CSS_IMPORT_RE = /@import\s+(?:"([^"\\]*)"|'([^'\\]*)')/gi
/** Loads the gate does not parse: an escape inside a URL, `image-set()` and `src()` candidates. */
const CSS_UNPARSED_RE = /image-set\(|(?<![\w-])src\(/i
const CSS_LOAD_RE = /url\(|image-set\(|(?<![\w-])src\(|@import/i
/** Comments and strings, matched left to right as CSS tokenizes them; a string also ends at a newline. */
const CSS_INERT_RE = /\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?/g
/** Attributes a browser parses as CSS: `style`, and the SVG presentation attributes that take a URL. */
const CSS_ATTRIBUTES: ReadonlySet<string> = new Set([
	"style",
	"fill",
	"stroke",
	"filter",
	"mask",
	"clip-path",
	"marker-start",
	"marker-mid",
	"marker-end",
	"cursor",
	"color-profile",
])

/**
 * The URLs a stylesheet or a style attribute loads, or null when one of them cannot be read exactly.
 * The gate decodes no CSS escape, and one outside a string can spell `url(` or `@import`.
 */
export function cssUrls(input: string): string[] | null {
	// CSS input preprocessing (css-syntax-3 § 3.3): a CR or FF ends a string exactly as LF does.
	const css = input.replace(/\r\n?|\f/g, "\n").replaceAll("\0", "�")
	if (css.replace(CSS_INERT_RE, "").includes("\\")) return null
	const urls = [...css.matchAll(CSS_URL_RE), ...css.matchAll(CSS_IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3] ?? "")
	const opened = css.match(/url\(|@import(?!\s*url\()/gi)?.length ?? 0
	return opened === urls.length && !CSS_UNPARSED_RE.test(css) ? urls : null
}

/**
 * A `<style>` block's URLs. Inside SVG a browser decodes its character references first, so the block
 * is read both as written and decoded, and a reference the gate cannot decode makes it unreadable.
 */
export function styleBlockUrls(css: string): string[] | null {
	if (undecodableReference(css) !== null) return null
	const raw = cssUrls(css)
	const decoded = cssUrls(decodeEntities(css))
	return raw === null || decoded === null ? null : [...new Set([...raw, ...decoded])]
}

/** A CSS attribute is always read; any other counts as CSS once its decoded value loads a URL. */
function cssVerdict(tag: string, name: string, value: string): AttributeVerdict {
	const decoded = decodeEntities(value)
	if (!CSS_ATTRIBUTES.has(name) && !CSS_LOAD_RE.test(decoded)) return null
	const bad = undecodableReference(value)
	if (bad !== null) return { opaque: `${bad} is a character reference the gate cannot decode` }
	const urls = cssUrls(decoded)
	if (urls === null) return { opaque: `${name} on <${tag}> loads a URL through CSS the gate cannot read` }
	return urls.length === 0 ? null : { links: urls.map((href) => ({ href, needle: href })) }
}

/** Each candidate's URL runs to whitespace, and its descriptors to the next comma. */
export function srcsetUrls(value: string): string[] {
	const urls: string[] = []
	let rest = value
	for (;;) {
		rest = rest.replace(/^[\s,]+/, "")
		const url = rest.match(/^\S+/)?.[0]
		if (url === undefined) return urls
		urls.push(url.replace(/,+$/, ""))
		rest = url.endsWith(",") ? rest.slice(url.length) : rest.slice(url.length).replace(/^[^,]*/, "")
	}
}

function kindOf(tag: string, name: string): AttributeKind | undefined {
	if (tag === "base" && name === "href") return "opaque"
	if (tag === "object" && name === "data") return "url"
	return ATTRIBUTES.get(name)
}

/**
 * Why the gate cannot judge an element as a whole, or null: plugin elements, and a meta refresh. The
 * `http-equiv` that makes a refresh is compared decoded, as a browser reads it.
 */
export function judgeElement(tag: string, attribute: (name: string) => string | null): string | null {
	if (OPAQUE_ELEMENTS.has(tag)) return `<${tag}> loads plugin resources the gate cannot check`
	const equiv = tag === "meta" ? attribute("http-equiv") : null
	if (equiv === null) return null
	const bad = undecodableReference(equiv)
	if (bad !== null) return `${bad} is a character reference the gate cannot decode`
	if (decodeEntities(equiv).trim().toLowerCase() === "refresh") return "a meta refresh navigates to a URL the gate cannot check"
	return null
}

/** The URLs one attribute carries, why the gate cannot judge them, or null when it carries none. */
export function judgeAttribute(tag: string, name: string, value: string): AttributeVerdict {
	const kind = kindOf(tag, name)
	if (kind === undefined) return cssVerdict(tag, name, value)
	if (kind === "opaque") return { opaque: `${name} on <${tag}> points somewhere the gate cannot check` }
	const bad = undecodableReference(value)
	if (bad !== null) return { opaque: `${bad} is a character reference the gate cannot decode` }
	const decoded = decodeEntities(value)
	if (kind === "url") return { links: [{ href: decoded, needle: value }] }
	const hrefs = kind === "srcset" ? srcsetUrls(decoded) : decoded.split(/\s+/).filter(Boolean)
	return { links: hrefs.map((href) => ({ href, needle: href })) }
}
