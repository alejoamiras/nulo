/**
 * A curated file's entries as Bun's CommonMark parser reads them. `render` gives the structure: which
 * top-level blocks are list items, whether an item holds more than one line of text, and where each
 * block starts. Reference definitions resolve against the whole document and render nothing, so a
 * would-be definition that fails to parse is ordinary text. An item owns the links its rendered `<li>`
 * holds, decoded as a reader's browser follows them; `render` itself reports raw destinations.
 */
import { judgeAttribute } from "./html"

export type Block = { kind: "item" | "heading" | "other"; multiline: boolean }
type MdNode = { kind: string; body: string }
type Callbacks = Parameters<typeof Bun.markdown.render>[1]

const TOKEN_RE = /\0(\d+)\0/g
const BLOCK_KINDS: ReadonlySet<string> = new Set(["heading", "paragraph", "blockquote", "code", "table", "hr", "html", "list", "listItem"])
const RENDER_OPTIONS = { autolinks: true }

/** Every construct becomes a node, named by its callback; the parser turns NUL into U+FFFD, so no text forges a token. */
function parse(src: string): { nodes: MdNode[]; top: string } {
	const nodes: MdNode[] = []
	const node = (kind: string) => (children?: string) => {
		nodes.push({ kind, body: children ?? "" })
		return `\0${nodes.length - 1}\0`
	}
	const callbacks = new Proxy(
		{},
		{ get: (_, key) => (key === "text" ? (children?: string) => children ?? "" : node(String(key))) },
	) as Callbacks
	return { nodes, top: Bun.markdown.render(src, callbacks, RENDER_OPTIONS) }
}

function childIds(body: string): number[] {
	return [...body.matchAll(TOKEN_RE)].map((m) => Number(m[1]))
}

function descendants(nodes: readonly MdNode[], id: number): MdNode[] {
	return childIds(nodes[id].body).flatMap((child) => [nodes[child], ...descendants(nodes, child)])
}

function flatten(nodes: readonly MdNode[], body: string): string {
	return body.replace(TOKEN_RE, (_, id: string) => flatten(nodes, nodes[Number(id)].body))
}

/** An entry is one paragraph of inline text on one line. */
function isMultiline(nodes: readonly MdNode[], id: number): boolean {
	const blocks = descendants(nodes, id).filter((n) => BLOCK_KINDS.has(n.kind))
	if (blocks.length > 1 || (blocks.length === 1 && blocks[0].kind !== "paragraph")) return true
	return flatten(nodes, nodes[id].body).trimEnd().includes("\n")
}

/** Top-level blocks in order; each item of a top-level list is a block of its own. */
export function topBlocks(src: string): Block[] {
	const { nodes, top } = parse(src)
	return childIds(top).flatMap((id): Block[] => {
		const { kind, body } = nodes[id]
		if (kind === "list") return childIds(body).map((item) => ({ kind: "item", multiline: isMultiline(nodes, item) }))
		return [{ kind: kind === "heading" ? "heading" : "other", multiline: false }]
	})
}

function hrefsOf(e: HTMLRewriterTypes.Element, tag: string): string[] {
	return [...e.attributes].flatMap(([name, value]) => {
		const verdict = judgeAttribute(tag, name.toLowerCase(), value)
		return verdict && "links" in verdict ? verdict.links.map((l) => l.href) : []
	})
}

/** The decoded hrefs each top-level `<li>` of the rendered document holds, in order. */
export function itemHrefs(src: string): string[][] {
	const items: string[][] = []
	const open: string[] = []
	let owner: string[] | null = null
	new HTMLRewriter()
		.on("*", {
			element(e) {
				const tag = e.tagName.toLowerCase()
				if (tag === "li" && open.length === 1 && (open[0] === "ul" || open[0] === "ol")) {
					owner = []
					items.push(owner)
				}
				owner?.push(...hrefsOf(e, tag))
				if (e.selfClosing || !e.canHaveContent) return
				open.push(tag)
				const depth = open.length
				e.onEndTag(() => {
					open.pop()
					if (tag === "li" && depth === 2) owner = null
				})
			},
		})
		.transform(Bun.markdown.html(src, RENDER_OPTIONS))
	return items
}

/** Each of the first `count` top-level blocks' first line, 1-based: where a growing prefix first parses to them. */
export function blockLines(src: string, count: number): number[] {
	const want = topBlocks(src).map((b) => b.kind)
	const lines = src.split("\n")
	const starts: number[] = []
	for (let i = 0; i < lines.length && starts.length < count; i++) {
		const got = topBlocks(lines.slice(0, i + 1).join("\n")).map((b) => b.kind)
		while (starts.length < Math.min(count, want.length) && want.slice(0, starts.length + 1).every((k, j) => got[j] === k))
			starts.push(i + 1)
	}
	return starts
}
