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
 * re-derives, and each curated entry equals a line whose candidates the driver accepted, whose currency
 * check held and which the verifier supported.
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
export type Verdict = { kind: "verdict"; stage: "reader" | "driver" | "currency" | "verifier"; ref: string; verdict: string; note: string }
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

/** Candidates and verdicts from one reader, or the reasons its quotes and paths were refused. */
export function admit(cwd: string, file: Closures, out: ReaderOutput, recs: readonly Rec[]): { add: Rec[]; problems: string[] } {
	const inventory = recs.filter((r): r is Inventory => r.kind === "inventory")
	const known = new Set(inventory.flatMap((u) => u.files.map((f) => f.path)))
	const ids = new Set(recs.filter((r) => r.kind === "candidate").map((r) => r.id))
	const problems: string[] = []
	const add: Rec[] = []
	for (const c of out.candidates) {
		if (!known.has(c.path)) problems.push(`${c.path}: not a mining source in the inventory`)
		if (!CLUSTERS.includes(c.cluster)) problems.push(`${c.path}: unknown cluster ${c.cluster}`)
		const at = locate(cwd, file.closuresBase, c.path, c.quote)
		if (typeof at === "string") {
			problems.push(`${c.path}: ${at}: ${JSON.stringify(c.quote.slice(0, 60))}`)
			continue
		}
		const id = idOf("c", c.path, c.quote)
		const proposal: Proposal = { target: c.target, gotcha: c.gotcha, owner: c.owner, sourceDate: c.sourceDate }
		add.push({ kind: "candidate", id, ...at, cluster: c.cluster, by: out.reader, proposal })
		add.push({ kind: "verdict", stage: "reader", ref: id, verdict: "proposed", note: scrub(`${c.check} → ${c.result}`) })
	}
	for (const k of out.carried) {
		if (!ids.has(k.id)) problems.push(`${k.id}: no such carried candidate`)
		else
			add.push({
				kind: "verdict",
				stage: "reader",
				ref: k.id,
				verdict: k.verdict,
				note: scrub(`${k.check} → ${k.result}${k.note ? `; ${k.note}` : ""}`),
			})
	}
	const statuses = new Map(out.files.map((f) => [f.path, f]))
	for (const f of out.files) if (!known.has(f.path)) problems.push(`${f.path}: reported but not in the inventory`)
	for (const u of inventory) {
		if (!u.files.some((f) => statuses.has(f.path))) continue
		const files = u.files.map((f) => {
			const s = statuses.get(f.path)
			return s ? { ...f, status: s.status, reason: s.reason ? scrub(s.reason) : undefined, by: out.reader } : f
		})
		add.push({ ...u, files })
	}
	return { add, problems }
}

function merge(recs: readonly Rec[], add: readonly Rec[]): Rec[] {
	const key = (r: Rec) => `${r.kind}\0${keyOf(r)}`
	const next = new Map(recs.map((r) => [key(r), r]))
	for (const r of add) next.set(key(r), r)
	return [...next.values()]
}

function inventoryProblems(cwd: string, file: Closures, recs: readonly Rec[]): string[] {
	const recorded = new Map(recs.filter((r): r is Inventory => r.kind === "inventory").map((r) => [r.plan, r]))
	const problems: string[] = []
	for (const want of inventoryFor(cwd, file)) {
		const got = recorded.get(want.plan)
		if (!got) {
			problems.push(`${want.plan}: no inventory entry`)
			continue
		}
		if (got.host !== want.host) problems.push(`${want.plan}: host ${got.host} is not the Outcome host ${want.host}`)
		const paths = new Set(got.files.map((f) => f.path))
		for (const f of want.files) if (!paths.has(f.path)) problems.push(`${f.path}: missing from ${want.plan}'s inventory`)
		for (const f of got.files) {
			if (!f.status) problems.push(`${f.path}: neither mined nor skipped`)
			else if (f.status === "skipped" && !f.reason?.trim()) problems.push(`${f.path}: skipped without a reason`)
		}
	}
	return problems
}

function candidateProblems(cwd: string, recs: readonly Rec[]): string[] {
	return recs
		.filter((r): r is Candidate => r.kind === "candidate")
		.flatMap((c) => {
			const bytes = blob(cwd, c.commit, c.path)
			if (!bytes) return [`${c.id}: ${c.path} is not at ${c.commit.slice(0, 8)}`]
			const slice = bytes.subarray(c.start, c.end)
			if (sha256(slice) !== c.quoteSha256) return [`${c.id}: the slice at ${c.path}:${c.line} does not hash to quoteSha256`]
			if (scrub(slice.toString("utf8")) !== c.quote) return [`${c.id}: scrubbing the slice does not yield its quote`]
			return lineAt(bytes, c.start) === c.line ? [] : [`${c.id}: the quote is not on line ${c.line}`]
		})
}

function lineProblems(cwd: string, file: Closures, recs: readonly Rec[]): string[] {
	const verdict = new Map(recs.filter((r): r is Verdict => r.kind === "verdict").map((v) => [`${v.stage}\0${v.ref}`, v.verdict]))
	const candidates = new Set(recs.filter((r) => r.kind === "candidate").map((r) => r.id))
	const lines = recs.filter((r): r is Line => r.kind === "line")
	const problems: string[] = []
	const seen = new Set<string>()
	for (const l of lines) {
		if (seen.has(l.id)) problems.push(`${l.id}: two lines share the id, so one's verdicts would pass the other`)
		seen.add(l.id)
	}
	for (const name of Object.keys(CURATED) as CuratedFile[]) {
		const entries = entriesOf(readFileSync(join(cwd, CURATED[name]), "utf8")).map(norm)
		const mine = lines.filter((l) => l.file === name)
		const texts = new Set(mine.map((l) => norm(l.text)))
		for (const e of entries) if (!texts.has(e)) problems.push(`${name}: an entry no line records: ${JSON.stringify(e.slice(0, 80))}`)
		for (const l of mine) {
			if (!entries.includes(norm(l.text))) problems.push(`${l.id}: its text is not an entry of ${name}`)
			if (l.candidates.length === 0) problems.push(`${l.id}: no candidate`)
			for (const c of l.candidates) {
				if (!candidates.has(c)) problems.push(`${l.id}: no candidate ${c}`)
				else if (verdict.get(`driver\0${c}`) !== "accept") problems.push(`${l.id}: the driver did not accept ${c}`)
			}
			if (!["holds", "dated"].includes(verdict.get(`currency\0${l.id}`) ?? "")) problems.push(`${l.id}: no currency check that held`)
			if (verdict.get(`verifier\0${l.id}`) !== "supported") problems.push(`${l.id}: the verifier has not supported it`)
		}
	}
	const covered = new Set(lines.filter((l) => l.file === "follow-ups.md").map((l) => l.followUp))
	for (const id of new Set(file.rows.flatMap((r) => r.followUps)))
		if (!covered.has(id)) problems.push(`follow-up ${id}: no follow-ups.md entry`)
	return problems
}

export function verify(cwd: string): string[] {
	const file = readClosures(cwd)
	const recs = readRecords(cwd)
	return [...inventoryProblems(cwd, file, recs), ...candidateProblems(cwd, recs), ...lineProblems(cwd, file, recs)]
}

function refreshInventory(cwd: string, file: Closures, recs: readonly Rec[]): Rec[] {
	const old = new Map(recs.filter((r): r is Inventory => r.kind === "inventory").flatMap((u) => u.files.map((f) => [f.path, f] as const)))
	const fresh = inventoryFor(cwd, file).map((u) => ({ ...u, files: u.files.map((f) => ({ ...old.get(f.path), ...f, bytes: f.bytes })) }))
	return [...recs.filter((r) => r.kind !== "inventory"), ...fresh]
}

function main(argv: readonly string[]): number {
	const cwd = process.cwd()
	const file = readClosures(cwd)
	const recs = readRecords(cwd)
	const [flag, arg] = argv
	if (flag === "--verify") {
		const problems = verify(cwd)
		for (const p of problems) console.log(p)
		const counts = (Object.keys(ORDER) as Rec["kind"][]).map((k) => `${recs.filter((r) => r.kind === k).length} ${k}`)
		console.log(`mine --verify: ${counts.join(", ")}; ${problems.length} problem(s)`)
		return problems.length === 0 ? 0 : 1
	}
	if (flag === "--inventory") {
		const next = refreshInventory(cwd, file, recs)
		writeRecords(cwd, next)
		console.log(`inventory: ${next.filter((r) => r.kind === "inventory").length} plans`)
		return 0
	}
	if (flag === "--carry") {
		const add = carried(cwd, file)
		writeRecords(cwd, merge(recs, add))
		console.log(`carried: ${add.length} candidates`)
		return 0
	}
	if (flag === "--add" && arg) {
		const { add, problems } = admit(cwd, file, JSON.parse(readFileSync(arg, "utf8")) as ReaderOutput, recs)
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
	if (flag === "--decide" && arg) {
		const d = JSON.parse(readFileSync(arg, "utf8")) as Decisions
		const add: Rec[] = [
			...d.verdicts.map((v) => ({ kind: "verdict", ...v, note: scrub(v.note) }) satisfies Verdict),
			...d.lines.map((l) => ({ kind: "line", ...l }) satisfies Line),
		]
		writeRecords(cwd, merge(recs, add))
		console.log(`recorded ${d.verdicts.length} verdict(s) and ${d.lines.length} line(s)`)
		return 0
	}
	console.log("usage: mine.ts --inventory | --carry | --add <file> [--dry-run] | --decide <file> | --verify")
	return 2
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
