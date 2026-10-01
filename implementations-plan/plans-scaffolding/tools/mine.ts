#!/usr/bin/env bun
/**
 * `mining.jsonl`, the record behind `lessons.md` and `follow-ups.md`: an inventory keyed by plan,
 * candidates whose quotes re-derive from the closure table's base, every verdict, and each entry's text.
 *
 * `--inventory` rewrites the inventory for `closures.json`'s rows and nested plans, keeping recorded file
 * statuses and every other record. `--carry` adds a candidate for each entry the curated files held at
 * the base. `--add <file> [--dry-run]` checks a reader's quotes against the base's bytes, then records its
 * candidates, verdicts and file statuses. `--decide <file>` records lines and the driver's, currency and
 * verifier verdicts. `--verify` fails unless every plan and source file is accounted for, every quote
 * re-derives from a mining source at the base, each curated entry equals a line whose candidates the driver
 * accepted and whose current text and evidence a held currency check and a verifier "supported" judged, and
 * the files hold nothing else but a title, the introduction after it, section headings and blank lines.
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { CLOSURES, type Closures } from "./classify"
import { git, PLANS } from "./common"
import { structure } from "./gate"

export const MINING = `${PLANS}/plans-scaffolding/mining.jsonl`
export const CURATED = { "lessons.md": `${PLANS}/lessons.md`, "follow-ups.md": `${PLANS}/follow-ups.md` } as const
export type CuratedFile = keyof typeof CURATED

export const CLUSTERS = ["ci-release", "bun-deps", "e2e", "runtime", "crypto-backup", "aztec", "ui-design"] as const
export type Cluster = (typeof CLUSTERS)[number]

/** First match wins; `runtime` takes the rest. */
const TOPICS: readonly (readonly [Cluster, RegExp])[] = [
	[
		"aztec",
		/^(?:aztec|any-erc20|bridge|faucet|private-fuel|swap-fuel|bundle-fpc|embedded-fpc|presto|bb-wasm|account-artifact|e2e-proverless|pxe-|fix-pxe|execution-pxe|proverless|registry-stealth|incoming-public|dapp-preexisting|self-pay|single-sim|fee-estimation|deprecate-simulate|fast-path)/,
	],
	["bun-deps", /^(?:bun-|dependency|vitest|zod-|isolated-linker|third-party-notices|vue-router)/],
	[
		"e2e",
		/e2e|deflake|flake|playwright|firefox|network-test|journal-stage|composition-test|harness-fixtures|fuzz-runner|network-playground|accelerator-server/,
	],
	[
		"ci-release",
		/^(?:ci-|release|required-check|nightly|stable-release|prerelease|complexity|dedup|typecheck|quality|cognitive|plans-|hygiene|docs-|monorepo|tools-|justified|paths-filter|operator|method-metadata|row-service|primitive-adoption|vue-shell|capture-await|profile-service|profile-flow|harden-quality|chrome-store)/,
	],
	[
		"crypto-backup",
		/backup|restore|reimport|kdf|key-model|passkey|export-integrity|^import-|migration|storage|lock|password|security|harden|audit|data-safety|integrity|mac-identity/,
	],
	[
		"ui-design",
		/ux|design|theme|popup|layout|copy|onboarding|landing|keyboard|contacts|home-|amount|send-|light-|legal|enter-gate|capabilities-popup|approval-card|frontend|holdings|phase-2-followup|phase-2-plus|pre-a11|^A11$/,
	],
]

export const clusterOf = (dir: string): Cluster => TOPICS.find(([, re]) => re.test(dir))?.[0] ?? "runtime"

/** Lessons logs, status and wrap-up notes, ledgers, backlogs and follow-up files, as text. */
const SOURCE_RE = /(?:^|\/)lessons\/.*\.(?:md|txt|log)$|(?:^|\/)(?:STATUS|WRAP-UP)\.md$|(?:ledger|backlog|follow-?ups?)[^/]*\.md$/i
const LOCAL_TOKEN_RE = new RegExp(`(?:${structure.LOCAL_PATH_RE.source})[^\\s"'\`)\\]>]*`, "g")
const MIN_QUOTE = 20
const MAX_QUOTE = 200

export type FileEntry = { path: string; bytes: number; status?: "read" | "scanned" | "skipped"; reason?: string; by?: string }
export type Inventory = { kind: "inventory"; plan: string; row: string; host: string | null; group: string; files: FileEntry[] }
export type Proposal = { target: "lessons" | "follow-ups"; gotcha: string; owner: string; sourceDate: string }
export type Candidate = {
	kind: "candidate"
	id: string
	path: string
	commit: string
	line: number
	start: number
	end: number
	quoteSha256: string
	quote: string
	cluster: Cluster
	by: string
	proposal: Proposal
}
/** `subject` is set on a line's currency and verifier verdicts: `subjectOf` the line they judged. */
export type Verdict = {
	kind: "verdict"
	stage: "reader" | "driver" | "currency" | "verifier"
	ref: string
	verdict: string
	note: string
	subject?: string
}
export type Line = { kind: "line"; id: string; file: CuratedFile; text: string; candidates: string[]; followUp?: string }
export type Rec = Inventory | Candidate | Verdict | Line

export type ReaderOutput = {
	reader: string
	files: { path: string; status: "read" | "scanned" | "skipped"; reason?: string }[]
	candidates: (Proposal & { path: string; quote: string; cluster: Cluster; check: string; result: string })[]
	carried: { id: string; verdict: string; check: string; result: string; note?: string }[]
}
export type Decisions = { verdicts: Omit<Verdict, "kind">[]; lines: Omit<Line, "kind">[] }

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex")
export const scrub = (s: string) => s.replace(LOCAL_TOKEN_RE, "<local path>")
/** An entry keeps its identity when the archive move re-points its links. */
const norm = (text: string) => text.replaceAll("](archive/", "](")
/** A line-stage verdict binds to this, so editing the text or swapping its evidence voids it. */
export const subjectOf = (l: Pick<Line, "text" | "candidates">) => sha256([norm(l.text), ...l.candidates].join("\0"))

export function readRecords(cwd: string): Rec[] {
	const path = join(cwd, MINING)
	if (!existsSync(path)) return []
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Rec)
}

const ORDER: Record<Rec["kind"], number> = { inventory: 0, candidate: 1, verdict: 2, line: 3 }
const keyOf = (r: Rec) =>
	r.kind === "inventory" ? r.plan : r.kind === "candidate" ? r.id : r.kind === "verdict" ? `${r.stage}\0${r.ref}` : `${r.file}\0${r.id}`

/** One record per line in a fixed order, so a re-run diffs only what changed. */
export function writeRecords(cwd: string, recs: readonly Rec[]): void {
	const byKey = new Map(recs.map((r) => [`${r.kind}\0${keyOf(r)}`, r]))
	const sorted = [...byKey.values()].sort(
		(a, b) => ORDER[a.kind] - ORDER[b.kind] || (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0),
	)
	writeFileSync(join(cwd, MINING), sorted.map((r) => `${JSON.stringify(r)}\n`).join(""))
}

function readClosures(cwd: string): Closures {
	return JSON.parse(readFileSync(join(cwd, CLOSURES), "utf8")) as Closures
}

function treeAt(cwd: string, commit: string): Map<string, number> {
	const out = git(cwd, "ls-tree", "-r", "-l", "-z", commit, "--", `${PLANS}/`)
	return new Map(
		out
			.split("\0")
			.filter(Boolean)
			.map((l) => {
				const [meta, path] = l.split("\t")
				return [path, Number(meta.split(/\s+/)[3]) || 0] as const
			}),
	)
}

/** The inventory the base implies: every row, and every dir below one that holds a `plan.md`. */
export function inventoryFor(cwd: string, file: Closures): Inventory[] {
	const tree = treeAt(cwd, file.closuresBase)
	const rows = new Map(file.rows.map((r) => [r.dir, r]))
	const nested = [...tree.keys()]
		.filter((p) => p.endsWith("/plan.md"))
		.map((p) => p.slice(PLANS.length + 1, -"/plan.md".length))
		.filter((d) => d.includes("/") && rows.has(d.split("/")[0]))
	const deepestFirst = [...rows.keys(), ...nested].sort((a, b) => b.length - a.length)
	const sources = new Map<string, FileEntry[]>()
	for (const [path, bytes] of tree) {
		const rel = path.slice(PLANS.length + 1)
		const unit = deepestFirst.find((d) => rel.startsWith(`${d}/`))
		if (unit && SOURCE_RE.test(rel.slice(unit.length + 1))) sources.set(unit, [...(sources.get(unit) ?? []), { path, bytes }])
	}
	const program = new Set(file.rows.filter((r) => r.evidence === "closing index status").map((r) => r.dir))
	const entry = (plan: string, host: string | null): Inventory => {
		const row = plan.split("/")[0]
		const files = [
			...(host ? [{ path: host, bytes: tree.get(host) ?? 0 }] : []),
			...(sources.get(plan) ?? []).filter((f) => f.path !== host),
		]
		return { kind: "inventory", plan, row, host, group: program.has(row) ? "program" : clusterOf(row), files }
	}
	return [...[...rows.values()].map((r) => entry(r.dir, r.outcomeFile)), ...nested.map((n) => entry(n, `${PLANS}/${n}/plan.md`))]
}

/** Each curated entry, as a line starting `- `. */
export function entriesOf(src: string): string[] {
	return src.split("\n").filter((l) => l.startsWith("- "))
}

const blobCache = new Map<string, Buffer | null>()
/** Raw bytes, never decoded, so a quote's hash is the file's own. */
function blob(cwd: string, commit: string, path: string): Buffer | null {
	const key = `${cwd}\0${commit}:${path}`
	if (!blobCache.has(key)) {
		const res = spawnSync("git", ["show", `${commit}:${path}`], {
			cwd,
			maxBuffer: 1 << 30,
			env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
		})
		blobCache.set(key, res.status === 0 ? res.stdout : null)
	}
	return blobCache.get(key) ?? null
}

function lineAt(bytes: Buffer, start: number): number {
	let line = 1
	for (let i = 0; i < start; i++) if (bytes[i] === 0x0a) line++
	return line
}

/** Where `quote` sits at `commit:path`, byte for byte, or why it cannot be a candidate. */
export function locate(
	cwd: string,
	commit: string,
	path: string,
	quote: string,
): Omit<Candidate, "kind" | "id" | "cluster" | "by" | "proposal"> | string {
	const n = [...quote].length
	if (n < MIN_QUOTE || n > MAX_QUOTE) return `quote is ${n} chars; keep it between ${MIN_QUOTE} and ${MAX_QUOTE}`
	if (/[\r\n]/.test(quote)) return "quote spans lines; copy one line's text"
	const bytes = blob(cwd, commit, path)
	if (!bytes) return `${path} is not at ${commit.slice(0, 8)}`
	const needle = Buffer.from(quote, "utf8")
	const start = bytes.indexOf(needle)
	if (start < 0) return "quote not found byte for byte; copy one line's text exactly, without line numbers"
	const end = start + needle.length
	return { path, commit, line: lineAt(bytes, start), start, end, quoteSha256: sha256(bytes.subarray(start, end)), quote: scrub(quote) }
}

const idOf = (prefix: string, ...parts: string[]) => `${prefix}-${sha256(parts.join("\0")).slice(0, 10)}`

export function carried(cwd: string, file: Closures): Candidate[] {
	const sourceDate = git(cwd, "show", "-s", "--format=%cs", file.closuresBase).trim()
	return (Object.keys(CURATED) as CuratedFile[]).flatMap((name) => {
		const bytes = blob(cwd, file.closuresBase, CURATED[name])
		if (!bytes) return []
		return entriesOf(bytes.toString("utf8")).map((entry) => {
			const quote = [...entry].slice(0, MAX_QUOTE).join("")
			const at = locate(cwd, file.closuresBase, CURATED[name], quote)
			if (typeof at === "string") throw new Error(`${name}: ${at}`)
			const dir = entry.match(/\]\(([^/)]+)\//)?.[1] ?? ""
			const target = name === "lessons.md" ? "lessons" : "follow-ups"
			const proposal: Proposal = { target, gotcha: "carried", owner: name, sourceDate }
			return {
				kind: "candidate",
				id: idOf("k", name, entry),
				...at,
				cluster: clusterOf(dir),
				by: "carried",
				proposal,
			} satisfies Candidate
		})
	})
}

type ReaderCandidate = ReaderOutput["candidates"][number]

/** A reader's candidate and its verdict, or why its path, cluster or quote was refused. */
function admitCandidate(
	cwd: string,
	base: string,
	reader: string,
	c: ReaderCandidate,
	known: ReadonlySet<string>,
): { add: Rec[]; problems: string[] } {
	const problems: string[] = []
	if (!known.has(c.path)) problems.push(`${c.path}: not a mining source in the inventory`)
	if (!CLUSTERS.includes(c.cluster)) problems.push(`${c.path}: unknown cluster ${c.cluster}`)
	const at = locate(cwd, base, c.path, c.quote)
	if (typeof at === "string") return { add: [], problems: [...problems, `${c.path}: ${at}: ${JSON.stringify(c.quote.slice(0, 60))}`] }
	const id = idOf("c", c.path, c.quote)
	const proposal: Proposal = { target: c.target, gotcha: c.gotcha, owner: c.owner, sourceDate: c.sourceDate }
	const verdict: Verdict = { kind: "verdict", stage: "reader", ref: id, verdict: "proposed", note: scrub(`${c.check} → ${c.result}`) }
	return { add: [{ kind: "candidate", id, ...at, cluster: c.cluster, by: reader, proposal }, verdict], problems }
}

const carriedVerdict = (k: ReaderOutput["carried"][number]): Verdict => ({
	kind: "verdict",
	stage: "reader",
	ref: k.id,
	verdict: k.verdict,
	note: scrub(`${k.check} → ${k.result}${k.note ? `; ${k.note}` : ""}`),
})

function statusUpdates(inventory: readonly Inventory[], out: ReaderOutput): Inventory[] {
	const statuses = new Map(out.files.map((f) => [f.path, f]))
	const apply = (f: FileEntry): FileEntry => {
		const s = statuses.get(f.path)
		return s ? { ...f, status: s.status, reason: s.reason ? scrub(s.reason) : undefined, by: out.reader } : f
	}
	return inventory.filter((u) => u.files.some((f) => statuses.has(f.path))).map((u) => ({ ...u, files: u.files.map(apply) }))
}

/** Candidates and verdicts from one reader, or the reasons its quotes and paths were refused. */
export function admit(cwd: string, file: Closures, out: ReaderOutput, recs: readonly Rec[]): { add: Rec[]; problems: string[] } {
	const inventory = recs.filter((r): r is Inventory => r.kind === "inventory")
	const known = new Set(inventory.flatMap((u) => u.files.map((f) => f.path)))
	const ids = new Set(recs.filter((r) => r.kind === "candidate").map((r) => r.id))
	const admitted = out.candidates.map((c) => admitCandidate(cwd, file.closuresBase, out.reader, c, known))
	const add: Rec[] = admitted.flatMap((a) => a.add)
	const problems = admitted.flatMap((a) => a.problems)
	for (const k of out.carried) {
		if (ids.has(k.id)) add.push(carriedVerdict(k))
		else problems.push(`${k.id}: no such carried candidate`)
	}
	for (const f of out.files) if (!known.has(f.path)) problems.push(`${f.path}: reported but not in the inventory`)
	add.push(...statusUpdates(inventory, out))
	return { add, problems }
}

function merge(recs: readonly Rec[], add: readonly Rec[]): Rec[] {
	const key = (r: Rec) => `${r.kind}\0${keyOf(r)}`
	const next = new Map(recs.map((r) => [key(r), r]))
	for (const r of add) next.set(key(r), r)
	return [...next.values()]
}

const statusProblems = (f: FileEntry): string[] => {
	if (!f.status) return [`${f.path}: neither mined nor skipped`]
	return f.status === "skipped" && !f.reason?.trim() ? [`${f.path}: skipped without a reason`] : []
}

function planProblems(want: Inventory, got: Inventory | undefined): string[] {
	if (!got) return [`${want.plan}: no inventory entry`]
	const paths = new Set(got.files.map((f) => f.path))
	return [
		...(got.host === want.host ? [] : [`${want.plan}: host ${got.host} is not the Outcome host ${want.host}`]),
		...want.files.filter((f) => !paths.has(f.path)).map((f) => `${f.path}: missing from ${want.plan}'s inventory`),
		...got.files.flatMap(statusProblems),
	]
}

function inventoryProblems(want: readonly Inventory[], recs: readonly Rec[]): string[] {
	const recorded = new Map(recs.filter((r): r is Inventory => r.kind === "inventory").map((r) => [r.plan, r]))
	return want.flatMap((w) => planProblems(w, recorded.get(w.plan)))
}

/** A carried candidate is exactly an entry the curated files held at the base; any other cites a source there. */
function provenanceProblems(c: Candidate, file: Closures, sources: ReadonlySet<string>, kept: ReadonlyMap<string, Candidate>): string[] {
	if (c.commit !== file.closuresBase) return [`${c.id}: its quote is not at closuresBase`]
	if (c.by !== "carried") return sources.has(c.path) ? [] : [`${c.id}: ${c.path} is not a mining source`]
	const k = kept.get(c.id)
	return k && k.path === c.path && k.start === c.start && k.end === c.end ? [] : [`${c.id}: not an entry the curated files held`]
}

function sliceProblems(cwd: string, c: Candidate): string[] {
	const bytes = blob(cwd, c.commit, c.path)
	if (!bytes) return [`${c.id}: ${c.path} is not at ${c.commit.slice(0, 8)}`]
	const slice = bytes.subarray(c.start, c.end)
	if (sha256(slice) !== c.quoteSha256) return [`${c.id}: the slice at ${c.path}:${c.line} does not hash to quoteSha256`]
	const original = slice.toString("utf8")
	if (scrub(original) !== c.quote) return [`${c.id}: scrubbing the slice does not yield its quote`]
	if (c.by !== "carried" && c.id !== idOf("c", c.path, original)) return [`${c.id}: its id is not its quote's`]
	const n = [...original].length
	if (n < MIN_QUOTE || n > MAX_QUOTE || /[\r\n]/.test(original))
		return [`${c.id}: the quote is not one line of ${MIN_QUOTE}-${MAX_QUOTE} chars`]
	return lineAt(bytes, c.start) === c.line ? [] : [`${c.id}: the quote is not on line ${c.line}`]
}

function candidateProblems(cwd: string, file: Closures, recs: readonly Rec[], sources: ReadonlySet<string>): string[] {
	const kept = new Map(carried(cwd, file).map((k) => [k.id, k]))
	return recs
		.filter((r): r is Candidate => r.kind === "candidate")
		.flatMap((c) => {
			const provenance = provenanceProblems(c, file, sources, kept)
			return provenance.length > 0 ? provenance : sliceProblems(cwd, c)
		})
}

type VerdictOf = (stage: Verdict["stage"], ref: string) => Verdict | undefined

function duplicateIds(lines: readonly Line[]): string[] {
	const seen = new Set<string>()
	return lines.flatMap((l) => {
		const dup = seen.has(l.id)
		seen.add(l.id)
		return dup ? [`${l.id}: two lines share the id, so only one of them can hold its verdicts`] : []
	})
}

function lineVerdictProblems(l: Line, verdictOf: VerdictOf, candidates: ReadonlySet<string>): string[] {
	const problems = l.candidates.length === 0 ? [`${l.id}: no candidate`] : []
	for (const c of l.candidates) {
		if (!candidates.has(c)) problems.push(`${l.id}: no candidate ${c}`)
		else if (verdictOf("driver", c)?.verdict !== "accept") problems.push(`${l.id}: the driver did not accept ${c}`)
	}
	const subject = subjectOf(l)
	const currency = verdictOf("currency", l.id)
	if (!["holds", "dated"].includes(currency?.verdict ?? "")) problems.push(`${l.id}: no currency check that held`)
	else if (currency?.subject !== subject) problems.push(`${l.id}: its currency check judged another text or evidence`)
	const verifier = verdictOf("verifier", l.id)
	if (verifier?.verdict !== "supported") problems.push(`${l.id}: the verifier has not supported it`)
	else if (verifier.subject !== subject) problems.push(`${l.id}: the verifier judged another text or evidence`)
	return problems
}

/** Outside its entries a file holds its title, an introduction as the first line after it, section headings and blank lines. */
function frameProblems(name: CuratedFile, src: string): string[] {
	const lines = src.split("\n")
	const intro = lines.findIndex((l, i) => i > 0 && l !== "")
	return lines.flatMap((l, i) => {
		if (i === 0) return l.startsWith("# ") ? [] : [`${name}:1: not a title`]
		if (l === "" || l.startsWith("- ") || l.startsWith("## ") || i === intro) return []
		return [`${name}:${i + 1}: text outside an entry, a heading or the introduction: ${JSON.stringify(l.slice(0, 60))}`]
	})
}

function curatedProblems(cwd: string, name: CuratedFile, mine: readonly Line[], check: (l: Line) => string[]): string[] {
	const src = readFileSync(join(cwd, CURATED[name]), "utf8")
	const entries = entriesOf(src).map(norm)
	const texts = new Set(mine.map((l) => norm(l.text)))
	return [
		...frameProblems(name, src),
		...entries.filter((e) => !texts.has(e)).map((e) => `${name}: an entry no line records: ${JSON.stringify(e.slice(0, 80))}`),
		...mine.flatMap((l) => [...(entries.includes(norm(l.text)) ? [] : [`${l.id}: its text is not an entry of ${name}`]), ...check(l)]),
	]
}

function lineProblems(cwd: string, file: Closures, recs: readonly Rec[]): string[] {
	const verdicts = new Map(recs.filter((r): r is Verdict => r.kind === "verdict").map((v) => [`${v.stage}\0${v.ref}`, v]))
	const verdictOf: VerdictOf = (stage, ref) => verdicts.get(`${stage}\0${ref}`)
	const candidates = new Set(recs.filter((r) => r.kind === "candidate").map((r) => r.id))
	const lines = recs.filter((r): r is Line => r.kind === "line")
	const check = (l: Line) => lineVerdictProblems(l, verdictOf, candidates)
	const covered = new Set(lines.filter((l) => l.file === "follow-ups.md").map((l) => l.followUp))
	return [
		...duplicateIds(lines),
		...(Object.keys(CURATED) as CuratedFile[]).flatMap((name) =>
			curatedProblems(
				cwd,
				name,
				lines.filter((l) => l.file === name),
				check,
			),
		),
		...[...new Set(file.rows.flatMap((r) => r.followUps))]
			.filter((id) => !covered.has(id))
			.map((id) => `follow-up ${id}: no follow-ups.md entry`),
	]
}

export function verify(cwd: string): string[] {
	const file = readClosures(cwd)
	const recs = readRecords(cwd)
	const want = inventoryFor(cwd, file)
	const sources = new Set(want.flatMap((u) => u.files.map((f) => f.path)))
	return [...inventoryProblems(want, recs), ...candidateProblems(cwd, file, recs, sources), ...lineProblems(cwd, file, recs)]
}

function refreshInventory(cwd: string, file: Closures, recs: readonly Rec[]): Rec[] {
	const old = new Map(recs.filter((r): r is Inventory => r.kind === "inventory").flatMap((u) => u.files.map((f) => [f.path, f] as const)))
	const fresh = inventoryFor(cwd, file).map((u) => ({ ...u, files: u.files.map((f) => ({ ...old.get(f.path), ...f, bytes: f.bytes })) }))
	return [...recs.filter((r) => r.kind !== "inventory"), ...fresh]
}

type Command = (cwd: string, file: Closures, recs: readonly Rec[], argv: readonly string[]) => number

function runVerify(cwd: string, _file: Closures, recs: readonly Rec[]): number {
	const problems = verify(cwd)
	for (const p of problems) console.log(p)
	const counts = (Object.keys(ORDER) as Rec["kind"][]).map((k) => `${recs.filter((r) => r.kind === k).length} ${k}`)
	console.log(`mine --verify: ${counts.join(", ")}; ${problems.length} problem(s)`)
	return problems.length === 0 ? 0 : 1
}

function runAdd(cwd: string, file: Closures, recs: readonly Rec[], argv: readonly string[]): number {
	const { add, problems } = admit(cwd, file, JSON.parse(readFileSync(argv[1], "utf8")) as ReaderOutput, recs)
	for (const p of problems) console.log(`refused: ${p}`)
	const admitted = add.filter((r) => r.kind === "candidate").length
	if (argv.includes("--dry-run") || problems.length > 0) {
		console.log(`${admitted} candidate(s) would be admitted; ${problems.length} refused; nothing written`)
		return problems.length === 0 ? 0 : 1
	}
	writeRecords(cwd, merge(recs, add))
	console.log(`admitted ${admitted} candidate(s)`)
	return 0
}

function runDecide(cwd: string, _file: Closures, recs: readonly Rec[], argv: readonly string[]): number {
	const d = JSON.parse(readFileSync(argv[1], "utf8")) as Decisions
	const add: Rec[] = [
		...d.verdicts.map((v) => ({ kind: "verdict", ...v, note: scrub(v.note) }) satisfies Verdict),
		...d.lines.map((l) => ({ kind: "line", ...l }) satisfies Line),
	]
	writeRecords(cwd, merge(recs, add))
	console.log(`recorded ${d.verdicts.length} verdict(s) and ${d.lines.length} line(s)`)
	return 0
}

const COMMANDS: ReadonlyMap<string, { command: Command; takesFile?: true }> = new Map(
	Object.entries({
		"--verify": { command: runVerify },
		"--inventory": {
			command: (cwd, file, recs) => {
				const next = refreshInventory(cwd, file, recs)
				writeRecords(cwd, next)
				console.log(`inventory: ${next.filter((r) => r.kind === "inventory").length} plans`)
				return 0
			},
		},
		"--carry": {
			command: (cwd, file, recs) => {
				const add = carried(cwd, file)
				writeRecords(cwd, merge(recs, add))
				console.log(`carried: ${add.length} candidates`)
				return 0
			},
		},
		"--add": { command: runAdd, takesFile: true },
		"--decide": { command: runDecide, takesFile: true },
	}),
)

function main(argv: readonly string[]): number {
	const entry = COMMANDS.get(argv[0] ?? "")
	if (!entry || (entry.takesFile && !argv[1])) {
		console.log("usage: mine.ts --inventory | --carry | --add <file> [--dry-run] | --decide <file> | --verify")
		return 2
	}
	const cwd = process.cwd()
	return entry.command(cwd, readClosures(cwd), readRecords(cwd), argv)
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
