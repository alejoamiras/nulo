/**
 * Renders `legal/*.md` into the landing's static pages. Pure: file access lives in build-legal.ts,
 * so the same functions plan the Vite inputs and are unit-tested without touching disk.
 */

import { LEGAL_MANIFEST, type LegalDocument, hasPlaceholders, parseDocumentHeader } from "@nulo/legal"

/** Built into the pinned Bun line; Cloudflare's Bun is pinned by a dashboard variable, not the repo. */
declare const Bun: { markdown?: { html(source: string, options?: { headings?: { ids?: boolean } }): string } } | undefined

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = ["terms", "privacy"]

const TITLES: Record<LegalDocument, string> = { terms: "Terms of Use", privacy: "Privacy Policy" }
const SITE = "https://nulo.sh"

export interface LegalSource {
	readonly doc: LegalDocument
	readonly version: string
	readonly markdown: string
}

export interface LegalPage {
	/** Path relative to the landing root, e.g. `terms.html` or `terms/v1.0/index.html`. */
	readonly path: string
	readonly html: string
}

/** Every page the manifest implies: one canonical page per document, one permalink per version. */
export function legalPagePaths(manifest = LEGAL_MANIFEST): readonly string[] {
	return LEGAL_DOCUMENTS.flatMap((doc) => [`${doc}.html`, ...manifest[doc].map((entry) => `${doc}/v${entry.version}/index.html`)])
}

function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

const ALLOWED_TAGS: Readonly<Record<string, readonly string[]>> = {
	a: ["href"],
	h1: ["id"],
	h2: ["id"],
	h3: ["id"],
	h4: ["id"],
	th: ["align"],
	td: ["align"],
	...Object.fromEntries(
		["p", "ul", "ol", "li", "strong", "em", "code", "pre", "blockquote", "table", "thead", "tbody", "tr", "hr", "br", "del"].map(
			(tag) => [tag, []],
		),
	),
}

const TAG_PATTERN = /^<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z-]+="[^"<>]*")*)\s*\/?>/
const SAFE_HREF = /^(https:\/\/|mailto:|#|\/(?!\/))/

function decodeEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_all, dec: string) => String.fromCodePoint(Number(dec)))
		.replaceAll("&quot;", '"')
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&")
}

function assertAllowedTag(fragment: string, label: string): void {
	const match = TAG_PATTERN.exec(fragment)
	const tag = match?.[2] ?? ""
	const allowed = ALLOWED_TAGS[tag]
	if (!match || !allowed) throw new Error(`${label}: raw HTML is not allowed in legal documents (near "${fragment.slice(0, 40)}")`)
	for (const [, name, value] of (match[3] ?? "").matchAll(/([a-z-]+)="([^"]*)"/g)) {
		if (!allowed.includes(name ?? "")) throw new Error(`${label}: attribute "${name}" is not allowed on <${tag}>`)
		// Decoded first: `&#106;avascript:` is still `javascript:` to a browser.
		if (name === "href" && !SAFE_HREF.test(decodeEntities(value ?? "").trim()))
			throw new Error(`${label}: unsupported link target "${value}"`)
	}
}

/**
 * Markdown passes raw HTML through, and Vite would happily bundle a smuggled inline script into an
 * external one the CSP allows. So the check runs on the RENDERED page: the renderer escapes every
 * literal `<` in text, which makes each remaining `<` the start of a tag — and each must be one of
 * ours, with attributes we expect. Reference links, images, entity-encoded schemes and tags split
 * across lines all end up here, whatever syntax produced them.
 */
function assertOnlyAllowedHtml(html: string, label: string): void {
	for (let at = html.indexOf("<"); at !== -1; at = html.indexOf("<", at + 1)) assertAllowedTag(html.slice(at, at + 400), label)
}

/** `](terms.md#x)` → `](/terms#x)`. Whatever else a link points at is judged after rendering. */
function rewriteLinks(markdown: string): string {
	return markdown.replace(/\]\((terms|privacy)\.md(#[^)]*)?\)/g, (_all, doc: string, hash?: string) => `](/${doc}${hash ?? ""})`)
}

/** Placeholders are marked in text only; a tag's attributes are never rewritten. */
function markPlaceholders(html: string): string {
	return html
		.split(/(<[^>]*>)/)
		.map((part) => (part.startsWith("<") ? part : part.replace(/«FILL:[^»]*»/g, (fill) => `<mark class="legal-fill">${fill}</mark>`)))
		.join("")
}

function renderMarkdown(markdown: string): string {
	const render = typeof Bun === "undefined" ? undefined : Bun.markdown?.html
	if (typeof render !== "function") throw new Error("build-legal needs Bun >= 1.4 (Bun.markdown.html is missing)")
	return render(markdown, { headings: { ids: true } })
}

function banner(kind: "draft" | "superseded", doc: LegalDocument): string {
	if (kind === "draft") {
		return `<p class="legal-banner" data-legal-banner="draft"><b>Draft.</b> This document still contains unfilled placeholders and is not yet in effect.</p>`
	}
	return `<p class="legal-banner" data-legal-banner="superseded"><b>Superseded.</b> This is an earlier version, kept so you can read what you accepted. <a href="/${doc}">Read the current ${TITLES[doc]}</a>.</p>`
}

function versionList(doc: LegalDocument, manifest: typeof LEGAL_MANIFEST): string {
	const items = [...manifest[doc]]
		.reverse()
		.map(
			(entry) =>
				`<li><a href="/${doc}/v${entry.version}/">Version ${escapeHtml(entry.version)}</a> <span>${escapeHtml(entry.effective ?? "not yet effective")}</span></li>`,
		)
	return `<nav class="legal-versions" aria-label="All versions"><h2>All versions</h2><ul>${items.join("")}</ul></nav>`
}

interface RenderOptions {
	readonly permalink: boolean
	readonly manifest?: typeof LEGAL_MANIFEST
}

export function renderLegalPage(source: LegalSource, options: RenderOptions): string {
	const manifest = options.manifest ?? LEGAL_MANIFEST
	const { doc, version, markdown } = source
	const label = `${doc} v${version}`
	const header = parseDocumentHeader(markdown)
	if (header.version !== version) throw new Error(`${label}: the document says version ${header.version}`)

	const head = manifest[doc][manifest[doc].length - 1]
	const superseded = head?.version !== version
	const draft = hasPlaceholders(markdown)
	const rendered = renderMarkdown(rewriteLinks(markdown))
	assertOnlyAllowedHtml(rendered, label)
	const body = markPlaceholders(rendered)
	const banners = [draft ? banner("draft", doc) : "", superseded ? banner("superseded", doc) : ""].join("")
	// Only the canonical, final page is indexable: permalinks duplicate it and drafts are not in effect.
	const robots = draft || options.permalink ? `<meta name="robots" content="noindex" />` : ""
	const title = `${TITLES[doc]} | NULO`

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${title}</title>
		<meta name="description" content="Nulo ${TITLES[doc]}, version ${escapeHtml(version)}." />
		<meta name="theme-color" content="#0A0908" />
		${robots}
		<link rel="canonical" href="${SITE}/${doc}" />
		<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	</head>
	<body class="legal-page">
		<a class="skip-link" href="#main">Skip to content</a>
		<header class="bar">
			<div class="wrap">
				<a class="brand" href="/" aria-label="NULO home"><i aria-hidden="true"></i>NULO</a>
				<nav aria-label="Legal documents">
					<a href="/terms">Terms</a>
					<a href="/privacy">Privacy</a>
				</nav>
			</div>
		</header>
		<main id="main" class="wrap legal" data-legal-doc="${doc}" data-legal-version="${escapeHtml(version)}">
			${banners}
			<article class="legal-body">${body}</article>
			${versionList(doc, manifest)}
		</main>
		<footer>
			<div class="wrap">
				<span>nulo.sh</span>
				<span><a href="/terms">terms</a> · <a href="/privacy">privacy</a> · <a href="https://github.com/alejoamiras/nulo">github</a></span>
			</div>
		</footer>
		<script type="module" src="/src/legal.ts"></script>
	</body>
</html>
`
}

/**
 * `sources` must hold exactly one markdown per manifest version. The head version renders twice:
 * at the canonical path and at its permalink, which is what an installed wallet links to.
 */
export function planLegalPages(sources: readonly LegalSource[], manifest = LEGAL_MANIFEST): readonly LegalPage[] {
	return LEGAL_DOCUMENTS.flatMap((doc) => {
		const versions = manifest[doc]
		const head = versions[versions.length - 1]
		return versions.flatMap((entry) => {
			const source = sources.find((candidate) => candidate.doc === doc && candidate.version === entry.version)
			if (!source) throw new Error(`${doc} v${entry.version}: no markdown source`)
			const permalink = { path: `${doc}/v${entry.version}/index.html`, html: renderLegalPage(source, { permalink: true, manifest }) }
			if (entry !== head) return [permalink]
			return [{ path: `${doc}.html`, html: renderLegalPage(source, { permalink: false, manifest }) }, permalink]
		})
	})
}
