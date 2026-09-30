// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${…}` is how the scanner prints a template literal's substitution, and the snippets are code samples fed to it as plain strings.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { parse as parseSfc } from "@vue/compiler-sfc"
import ts from "typescript"
import { describe, expect, test } from "vitest"

/**
 * Static ban: no em dash joins two clauses in text a person reads; a full stop does, and the
 * empty-value "—" stays. Every string this replaced had passed review, so the rule runs here.
 *
 * Limits: it reads source strings and template text, not what a screen renders, so each reviewed
 * entry is a person's judgement of where that text goes. It cannot see a dash built by
 * concatenation or a computed fragment, text returned by a helper outside its roots, text split
 * across elements, or a runtime substitution. Of `packages/aztec-runtime` it reads only
 * `src/pxe/opfs-store.ts`, whose two errors Add token shows. The log exemption trusts the callee's
 * spelling.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const SCAN_ROOTS = ["apps/extension/src", "packages/design/src", "packages/extension-messaging/src"]
const SCAN_FILES = ["packages/aztec-runtime/src/pxe/opfs-store.ts"]
const SCANNED = /\.(ts|js|vue)$/
const SKIPPED = /\.(test|stories)\.[jt]s$|\.d\.ts$/

/** A dash with text on both sides; the empty-value glyph ("—", "— FJ") has nothing before it. */
const CLAUSE_DASH = /\S\s*—\s*\S/
const HOLE = "${…}"

/** compiler-core's `NodeTypes`, which compiler-sfc does not re-export. */
const TEXT = 2
const INTERPOLATION = 5

type Hit = { file: string; line: number; text: string }
type Located = { loc: { start: { line: number }; source: string } }
type TemplateExpression = Located & { content: string }
type TemplateProp = { value?: TemplateExpression; exp?: unknown }
type TemplateNode = Located & {
	type: number
	content?: unknown
	props?: readonly TemplateProp[]
	children?: readonly (TemplateNode | string | symbol)[]
}
type Reviewed = { file: string; text: string; why: string }

/** Every hit no screen shows, one entry per hit, matched by its exact text. */
const REVIEWED: Reviewed[] = [
	{
		file: "apps/extension/src/wallet/services/restore-fence.ts",
		text: "row has no profile id — write rejected",
		why: "invariant failure",
	},
	{
		file: "apps/extension/src/wallet/services/restore-fence.ts",
		text: "profile ${…} is being deleted or was not captured at restore entry — write rejected",
		why: "concurrent deletion",
	},
	{
		file: "apps/extension/src/wallet/services/transaction/service.ts",
		text: "stale execution owner — account no longer exists",
		why: "concurrent deletion",
	},
	{
		file: "apps/extension/src/wallet/services/profile/profile-deletion-state.ts",
		text: "profile ${…} is being deleted — write rejected (epoch ${…} → ${…})",
		why: "concurrent deletion",
	},
	{
		file: "apps/extension/src/wallet/services/profile/service.ts",
		text: "Lock did not persist — the session record could not be cleared; retry",
		why: "storage refused a delete",
	},
	{
		file: "apps/extension/src/wallet/services/profile/service.ts",
		text: "restore-pending marker changed since the deletion was decided — import finalized or restarted",
		why: "concurrent import",
	},
	{
		file: "apps/extension/src/wallet/services/profile/service.ts",
		text: "profile predates the pxe-generation fence — reinstall the extension (pre-production, no migration)",
		why: "stale dev install",
	},
	{
		file: "apps/extension/src/wallet/services/profile/service.ts",
		text: "Profile integrity check failed — this profile cannot produce a trustworthy backup",
		why: "export shows constant copy",
	},
	{
		file: "apps/extension/src/wallet/services/operation-journal/service.ts",
		text: "profile ${…} does not exist — operation not created",
		why: "concurrent deletion",
	},
	{
		file: "apps/extension/src/wallet/services/operation-journal/service.ts",
		text: "profile ${…} was deleted since this operation was prepared — not created",
		why: "concurrent deletion",
	},
	{
		file: "apps/extension/src/wallet/services/operation-journal/service.ts",
		text: "network ${…} is deleted or being deleted — operation not created",
		why: "concurrent deletion",
	},
	{
		file: "apps/extension/src/wallet/services/operation-journal/service.ts",
		text: "transitionOperation: submitting.txHash !== succeeded.txHash (${…} vs ${…}) — hash drift across the prove/submit boundary",
		why: "invariant failure",
	},
	{
		file: "apps/extension/src/wallet/services/execution/fee/fee-strategy.ts",
		text: "(da=${…}, l2=${…}) — this transaction cannot be included.",
		why: "execute window shows constant copy",
	},
	{
		file: "apps/extension/src/wallet/services/backup/row-map-migration.ts",
		text: "row-map data at ${…}[${…}] is a hole or accessor — transforms must be pure data",
		why: "migration authoring error",
	},
	{
		file: "apps/extension/src/wallet/services/backup/row-map-migration.ts",
		text: "row-map data at ${…}.${…} is an accessor — transforms must be pure data",
		why: "migration authoring error",
	},
	{
		file: "apps/extension/src/wallet/services/backup/row-map-migration.ts",
		text: 'addDefault "${…}" is also retyped — a re-run would coerce the default (non-idempotent)',
		why: "migration authoring error",
	},
	{
		file: "apps/extension/src/wallet/services/backup/row-map-migration.ts",
		text: 'addDefault "${…}" is also remapped — a re-run would remap the default (non-idempotent)',
		why: "migration authoring error",
	},
	{
		file: "apps/extension/src/wallet/services/backup/row-map-migration.ts",
		text: 'addDefault "${…}" re-creates a rename source — a re-run would re-trigger the rename (non-idempotent)',
		why: "migration authoring error",
	},
	{
		file: "apps/extension/src/wallet/services/account/service.ts",
		text: "imported keys unavailable — unlock again",
		why: "send shows constant copy",
	},
	{
		file: "apps/extension/src/utils/background-liveness.ts",
		text: "liveness never advanced past ${…} within ${…}ms (last seen: ${…}) — no fully-wired worker appeared",
		why: "liveness diagnostic",
	},
	{
		file: "apps/extension/src/composables/useEntityCrud.ts",
		text: "useEntityCrud: entity has no `id` field — pass an explicit `identity` option",
		why: "invariant failure",
	},
	{
		file: "apps/extension/src/popup/windows/discover/index.vue",
		text: "discover approve() called before init() completed — :disabled gate must include !isReady",
		why: "invariant failure",
	},
	{
		file: "apps/extension/src/popup/windows/capabilities/index.vue",
		text: "capabilities approve() called before init() completed — :disabled gate must include !initComplete",
		why: "invariant failure",
	},
	{
		file: "apps/extension/src/wallet/services/execution/preview-snapshots.ts",
		text: "Authorizations changed since preview — re-open the request",
		why: "journal box only",
	},
	{
		file: "apps/extension/src/wallet/services/execution/preview-snapshots.ts",
		text: "Fee estimate did not complete — retry the estimate",
		why: "journal box only",
	},
	{
		file: "apps/extension/src/wallet/services/execution/preview-snapshots.ts",
		text: "Estimate does not belong to this request — re-open the request",
		why: "journal box only",
	},
	{
		file: "apps/extension/src/wallet/services/operation-journal/reaper.ts",
		text: "SW restart with non-terminal record in ${…} — unrecoverable",
		why: "journal box only",
	},
	{
		file: "apps/extension/src/wallet/services/wallet-sdk/background.ts",
		text: "Session no longer valid — reconnect",
		why: "journal box only",
	},
	{
		file: "apps/extension/src/wallet/services/transaction/service.ts",
		text: "Transaction not confirmed within ${…}s — it may still complete",
		why: "journal box only",
	},
	{
		file: "apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts",
		text: "Session no longer valid — reconnect",
		why: "dApp envelope",
	},
	{
		file: "packages/extension-messaging/src/errors.ts",
		text: "Another first transaction initialized this account — wait for network sync, then retry.",
		why: "dApp envelope",
	},
	{
		file: "apps/extension/src/composables/full-backup-restore.ts",
		text: "Passkey ceremony not wired — restart the popup and try again.",
		why: "unreachable: its caller passes a ceremony",
	},
	{
		file: "apps/extension/src/wallet/services/backup/backup-migrator.ts",
		text: "this wallet version can't upgrade old backups: migration ${…} is not backup-safe — re-export a fresh backup from a current wallet",
		why: "unreachable: no migration is backup-unsafe",
	},
	{
		file: "apps/extension/src/wallet/services/backup/backup-migrator.ts",
		text: 'migration ${…} touches "${…}", which backups cannot represent — re-export a fresh backup from a current wallet',
		why: "unreachable: no migration is backup-unsafe",
	},
	{
		file: "apps/extension/src/wallet/services/account-state/normalize.ts",
		text: "network over the account-state network cap — its registrations were dropped",
		why: "hand-built backup only",
	},
	{
		file: "packages/design/src/internal/render-css.ts",
		text: "/* GENERATED by scripts/gen-tokens.ts from src/token-contract.ts — DO NOT EDIT. Run `bun run gen:tokens`; utilities.drift.test.ts fails CI on divergence. Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0. */",
		why: "generated file header",
	},
	{
		file: "packages/design/src/internal/render-tokens.ts",
		text: "/** * GENERATED by scripts/gen-tokens.ts from src/token-contract.ts — DO NOT EDIT. * Run `bun run gen:tokens` after changing the contract; tokens.drift.test.ts fails CI on * divergence. Members are CSS-variable NAMES; use cssVar() to wrap for inline styles. */",
		why: "generated file header",
	},
	{
		file: "apps/extension/src/wallet/services/wallet-sdk/session-established.ts",
		text: "Session ${…} established on chain ${…} on an abandoned or stale approval — terminating",
		why: "log reason",
	},
	{
		file: "apps/extension/src/wallet/services/wallet-sdk/session-established.ts",
		text: "Session ${…} on chain ${…} has no DappSession — terminating to honor revocation",
		why: "log reason",
	},
	{
		file: "apps/extension/src/wallet/services/wallet-sdk/session-established.ts",
		text: "Session ${…} on chain ${…} runs under profile ${…} but was approved under ${…} — terminating",
		why: "log reason",
	},
]

const LOG_NAMES = new Set(["log", "logDebug", "logInfo", "logWarn", "logError"])

function nameOf(node: ts.Expression): string | undefined {
	if (ts.isIdentifier(node)) return node.text
	if (ts.isPropertyAccessExpression(node)) return node.name.text
	return undefined
}

/** `console.<method>`, a function or method named like a log call, or a method of an object named `log`. */
function isLogCallee(callee: ts.Expression): boolean {
	if (LOG_NAMES.has(nameOf(callee) ?? "")) return true
	if (!ts.isPropertyAccessExpression(callee)) return false
	const receiver = callee.expression
	return (ts.isIdentifier(receiver) && receiver.text === "console") || nameOf(receiver) === "log"
}

function inLogCall(node: ts.Node): boolean {
	let child = node
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (ts.isCallExpression(parent) && parent.expression !== child && isLogCallee(parent.expression)) return true
		child = parent
	}
	return false
}

function literalText(node: ts.Node): string | undefined {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
	if (!ts.isTemplateExpression(node)) return undefined
	return node.head.text + node.templateSpans.map((span) => HOLE + span.literal.text).join("")
}

function flat(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

function scanScript(file: string, source: string, firstLine: number, out: Hit[]): void {
	const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const visit = (node: ts.Node): void => {
		const text = literalText(node)
		if (text !== undefined && CLAUSE_DASH.test(text) && !inLogCall(node)) {
			out.push({ file, line: firstLine + tree.getLineAndCharacterOfPosition(node.getStart(tree)).line, text: flat(text) })
		}
		ts.forEachChild(node, visit)
	}
	visit(tree)
}

function isExpression(value: unknown): value is TemplateExpression {
	return typeof value === "object" && value !== null && "loc" in value && "content" in value && typeof value.content === "string"
}

/** The line of a text node's first word, not of the whitespace it opens with. */
function textLine(node: Located): number {
	return node.loc.start.line + (node.loc.source.match(/^\s*/)?.[0].match(/\n/g)?.length ?? 0)
}

function scanText(file: string, node: Located, text: string, out: Hit[]): void {
	if (CLAUSE_DASH.test(text)) out.push({ file, line: textLine(node), text: flat(text) })
}

function scanTemplate(file: string, node: TemplateNode, out: Hit[]): void {
	if (node.type === TEXT && typeof node.content === "string") scanText(file, node, node.content, out)
	if (node.type === INTERPOLATION && isExpression(node.content)) scanScript(file, node.content.content, node.content.loc.start.line, out)
	for (const prop of node.props ?? []) {
		if (prop.value) scanText(file, prop.value, prop.value.content, out)
		if (isExpression(prop.exp)) scanScript(file, prop.exp.content, prop.exp.loc.start.line, out)
	}
	for (const child of node.children ?? []) if (typeof child === "object") scanTemplate(file, child, out)
}

/** Every clause-joining dash in `source`'s strings and template text outside a log call's arguments. */
function scan(file: string, source: string): Hit[] {
	const out: Hit[] = []
	if (!file.endsWith(".vue")) {
		scanScript(file, source, 1, out)
		return out
	}
	const { descriptor } = parseSfc(source, { filename: file, sourceMap: false })
	for (const block of [descriptor.script, descriptor.scriptSetup]) if (block) scanScript(file, block.content, block.loc.start.line, out)
	if (descriptor.template?.ast) scanTemplate(file, descriptor.template.ast, out)
	return out
}

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) walk(full, out)
		else if (SCANNED.test(name) && !SKIPPED.test(name)) out.push(full)
	}
	return out
}

const treeFiles = (): string[] => [
	...SCAN_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root))),
	...SCAN_FILES.map((file) => join(REPO_ROOT, file)),
]

let treeHits: Hit[] | undefined

function scanTree(): Hit[] {
	treeHits ??= treeFiles().flatMap((full) => scan(relative(REPO_ROOT, full), readFileSync(full, "utf8")))
	return treeHits
}

const keyOf = ({ file, text }: { file: string; text: string }): string => `${file}\n${text}`

/** Hits no reviewed entry covers, and entries no hit consumed. */
function review(hits: Hit[]): { open: Hit[]; stale: Reviewed[] } {
	const pending = new Map<string, Reviewed[]>()
	for (const entry of REVIEWED) pending.set(keyOf(entry), [...(pending.get(keyOf(entry)) ?? []), entry])
	const open = hits.filter((hit) => pending.get(keyOf(hit))?.pop() === undefined)
	return { open, stale: [...pending.values()].flat() }
}

describe("copy dash ban (static)", () => {
	test("no text a screen shows joins two clauses with an em dash", () => {
		expect(treeFiles().length).toBeGreaterThan(500)
		const open = review(scanTree()).open.map(({ file, line, text }) => `${file}:${line}  ${text}`)
		expect(
			open,
			`Split each at the dash into two sentences, or add a reviewed entry if no screen shows it:\n${open.join("\n")}`,
		).toEqual([])
	})

	test("every reviewed entry still matches a string", () => {
		const stale = review(scanTree()).stale.map(({ file, text }) => `${file}  ${text}`)
		expect(stale, `Reviewed entries that match no string, to delete:\n${stale.join("\n")}`).toEqual([])
	})

	test.each([
		["a template literal with a substitution hits", "x.ts", "const m = `Wrong chain — this network is chain ${id}.`", 1],
		["template text hits", "x.vue", "<template><p>Don't navigate away — press Escape.</p></template>", 1],
		["a static attribute hits", "x.vue", '<template><input placeholder="Search — or paste" /></template>', 1],
		["a bound expression hits", "x.vue", `<template><Banner :text="'Retry — later'" /></template>`, 1],
		["a thrown message hits", "x.ts", "throw new Error('Imported keys unavailable — unlock again')", 1],
		["a console.warn argument is exempt", "x.ts", "console.warn('stale row — dropped', { id })", 0],
		["a this.logWarn argument is exempt", "x.ts", "this.logWarn(`stale row — ${id}`)", 0],
		["a log.warn argument is exempt", "x.ts", "log.warn('stale row — dropped')", 0],
		["a dialog.warn argument hits", "x.ts", "dialog.warn('Stale row — reopen')", 1],
		["the empty-value glyph does not hit", "x.vue", "<template><span>—</span></template>", 0],
		["the glyph with a unit does not hit", "x.ts", "const fee = '— FJ'", 0],
		["a label joiner in its own text node does not hit", "x.vue", "<template><b>{{ title }}</b><Text> — spender </Text></template>", 0],
	])("%s", (_case, file, source, hits) => {
		expect(scan(file, source)).toHaveLength(hits)
	})
})
