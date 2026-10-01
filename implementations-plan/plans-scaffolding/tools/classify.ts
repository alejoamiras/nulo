#!/usr/bin/env bun
/**
 * The closure table: one row per top-level plan dir, derived from git, the frozen gh snapshots beside
 * this tool, and the owner's answers to Asks S1–S17.
 *
 * With no flag it writes `closures.json` for HEAD, or for the commit named. `--snapshot` refreshes
 * `gh-prs.json` and `gh-issues.json`, the tool's only network use. `--check [file] [upto]` fails unless both
 * snapshots hold their full counts, every row equals its derivation at the file's base, names a live dir
 * once and is not ambiguous, and no closed dir's content changed between the base and `upto`; a dir with no
 * row is reported as active, never guessed.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { git, PLANS, rawMeta } from "./common"
import { lib, links, structure } from "./gate"

export type Pr = { number: number; state: "MERGED" | "OPEN" | "CLOSED"; base: string; mergedAt: string | null; mergeCommit: string | null }
type Snapshot<T> = { capturedAt: string; totalCount: number; items: T[] }
export type RowClass = "closed" | "active" | "parked" | "ambiguous"
export type Row = {
	dir: string
	class: RowClass
	status: string
	date: string | null
	prs: number[]
	outcomeFile: string | null
	followUps: string[]
	hook: string
	evidence: string
}
export type Closures = { closuresBase: string; rows: Row[] }

const HERE = `${PLANS}/plans-scaffolding`
export const CLOSURES = `${HERE}/closures.json`
const PRS_FILE = `${HERE}/gh-prs.json`
const ISSUES_FILE = `${HERE}/gh-issues.json`
const IMPORT = "5ee8ec1351cca0088118ec1008a0bfc15ccd9781"
const IMPORT_DATE = "2026-05-19"
export const HISTORICAL = `historical — pre-open-source import (${IMPORT_DATE})`
/** A closed dir whose files all moved out of the plan tree; it has nothing left to archive. */
export const RELOCATED = "relocated"
/** Commits before the base that edited many plans at once without changing any; a dir's date skips them. */
const MECHANICAL_SUBJECTS = [
	/^chore: open-source initial import$/,
	/^docs: point the wallet repo's docs, plans and skills at unleashed \(#692\)$/,
	/^chore\(plans\): untrack plan transcripts/,
]
/** Live plans whose index line is not a closing one: P1 keeps tools-extraction open (follow-ups.md). */
const ACTIVE_DIRS: ReadonlySet<string> = new Set(["plans-scaffolding", "tools-extraction"])

type Answer = { class: RowClass; status: string; followUps?: string[]; ask: string }
const done = (ask: string, followUps: string[] = []): Answer => ({ class: "closed", status: "completed", followUps, ask })

/** § Approval, 2026-09-25: every S Ask as recommended. S2 is a class (legacy imports), so only its exception is here. */
export const ANSWERS: Readonly<Record<string, Answer>> = {
	"harden-quality-arc": done("S1", ["harden-quality-q13"]),
	"v3-followups": done("S1", ["v3-followups-p2"]),
	"any-erc20-bridge": done("S1", ["any-erc20-bridge-p10"]),
	"playwright-migration": { class: "closed", status: "abandoned — Puppeteer retained", ask: "S2" },
	"passkey-e2e": { class: "closed", status: `${RELOCATED} — its one file now lives in apps/extension/tests/e2e/`, ask: "S2" },
	"authwit-lifecycle-and-execution-followups": done("S3"),
	"aztec-5.0-upgrade": done("S3"),
	"execution-decomposition": done("S3"),
	"q3-transport-unification": done("S3"),
	"required-check-mismatch": done("S3"),
	"stable-release-0.26.0": done("S3"),
	"chrome-store-launch": done("S4", ["chrome-store-launch-items"]),
	"dapp-popup-cancel-focus": done("S4", ["dapp-popup-space-switch"]),
	"firefox-first-class-spike": done("S4", ["firefox-checklist"]),
	"aztec-5.0.1-line": done("S5"),
	"key-model-v2": done("S5"),
	"monorepo-restructure": done("S5"),
	"quality-arc-deferred": done("S5"),
	"storage-migration-framework": done("S5"),
	"vitest-vite8-dedupe": done("S5"),
	"proverless-network-stabilization": done("S6", ["proverless-remaining-phases"]),
	"bun-1.4-adoption": done("S7"),
	"composition-test-rollout": done("S7"),
	"dapp-preexisting-fee": done("S7"),
	"execution-pxe-injection-spike": done("S7"),
	"incoming-public-transfers": done("S7"),
	"key-model-v2-hardening": done("S7"),
	"network-e2e-required": done("S7"),
	"nightly-release": done("S7"),
	"profile-fenced-execution": done("S7"),
	"profile-flow-dedup-q2": done("S7"),
	"release-dev-to-main": done("S7"),
	"aztec-5.0.0-stable": { class: "closed", status: "superseded by aztec-5.2.0-js-line", ask: "S8" },
	"harden-findings-remediation": done("S9", ["harden-f11-scope", "harden-surfaced-findings"]),
	"light-theme-fix": done("S10"),
	"token-identity": done("S10"),
	"bridge-permit2-recipient-commitment": done("S11"),
	"private-fuel": done("S11"),
	"swap-fuel": done("S11"),
	"account-switch-isolation": done("S12", ["account-switch-remaining-phases"]),
	"backup-restore-residuals": done("S13", ["backup-restore-fence-epic"]),
	"complexity-budgets": done("S14"),
	"audit-448-remediation": done("S15"),
	"journal-stage-restructure": done("S15"),
	"transport-ready-handshake": { class: "parked", status: "PARKED", ask: "S16" },
}

/** `dirs`: the top-level plan dirs a commit touched; `changed`: those whose content it changed. */
type Commit = { sha: string; date: string; time: number; subject: string; dirs: Set<string>; changed: Set<string> }
type Evidence = { dir: string; lines: ReturnType<typeof lib.parseIndex>["entries"]; host: string | null; src: string; commits: Commit[] }
export type Options = { cwd: string; prs: ReadonlyMap<number, Pr>; importSha?: string; ref?: string }
type Resolved = Options & { byMergeCommit: ReadonlyMap<string, number> }

function dirOf(path: string | undefined): string | null {
	const parts = path?.split("/") ?? []
	return parts.length > 2 && parts[0] === PLANS ? parts[1] : null
}

type Change = { exact: boolean; from: string; to: string }

/** Only a file that left the plan tree byte for byte changed nothing but its destination; a move between dirs counts on both. */
function applyChange(c: Pick<Commit, "dirs" | "changed">, { exact, from, to }: Change): void {
	const [src, dst] = [dirOf(from), dirOf(to)]
	for (const d of [src, dst]) if (d !== null) c.dirs.add(d)
	if (dst !== null) c.changed.add(dst)
	if (src !== null && !(exact && !to.startsWith(`${PLANS}/`))) c.changed.add(src)
}

/** NUL-delimited `--raw --no-abbrev` output, so a path parses as itself however git would quote it; `\x01` opens a log header. */
function walkRaw(out: string, onHeader: (header: string) => void, onChange: (change: Change) => void): void {
	const tokens = out.split("\0")
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i].replace(/^\n/, "")
		const meta = rawMeta(token)
		if (token.startsWith("\x01")) onHeader(token.slice(1))
		else if (meta) {
			const from = tokens[++i]
			const to = meta.status === "R" || meta.status === "C" ? tokens[++i] : from
			onChange({ exact: meta.status === "R" && meta.same, from, to })
		}
	}
}

/**
 * Every commit in `range` touching the plan tree, newest first. The log takes no pathspec: one limited to the
 * plan tree pairs a move out of it with nothing and reads it as a deletion. A merge brings no diff, since a
 * promote merge's first-parent diff would credit its PR to every plan dev touched since the last promote.
 */
function planCommits(cwd: string, range = "HEAD"): Commit[] {
	const commits: Commit[] = []
	walkRaw(
		git(cwd, "log", "-M", "-z", "--raw", "--no-abbrev", "--format=%x01%H %cs %cI %s", range),
		(header) => {
			const [sha, date, iso, ...subject] = header.split(" ")
			commits.push({ sha, date, time: Date.parse(iso), subject: subject.join(" "), dirs: new Set(), changed: new Set() })
		},
		(change) => applyChange(commits[commits.length - 1], change),
	)
	return commits.filter((c) => c.dirs.size > 0)
}

export function topDirs(cwd: string, ref = "HEAD"): string[] {
	return git(cwd, "ls-tree", "-d", "-z", "--name-only", ref, `${PLANS}/`)
		.split("\0")
		.filter(Boolean)
		.map((p) => p.slice(PLANS.length + 1))
		.filter((d) => d !== "archive")
}

function hostOf(tracked: ReadonlySet<string>, dir: string, targets: readonly string[]): string | null {
	const nonPlan = targets.map((t) => `${PLANS}/${t}`).find((t) => !t.endsWith("/plan.md"))
	const order = [`${PLANS}/${dir}/plan.md`, nonPlan, `${PLANS}/${dir}/README.md`]
	return order.find((p): p is string => p !== undefined && tracked.has(p)) ?? null
}

function refs(text: string): Set<number> {
	return new Set([...text.matchAll(/(?<![\w/&])#(\d{1,5})\b/g)].map((m) => Number(m[1])))
}

/** A stack lands in one merge call, seconds apart, so its lower PRs precede the squash that adds the plan. */
const STACK_SLACK_MS = 120_000
const TRUNKS: ReadonlySet<string> = new Set(["dev", "main"])

const isMechanical = (c: Commit, importSha: string) => c.sha === importSha || MECHANICAL_SUBJECTS.some((re) => re.test(c.subject))

/**
 * A PR delivered a plan when its squash touched the dir, or when the plan's index line (else its host)
 * names it and it landed after the dir's first commit: a PR merged before the plan existed is context. A PR
 * merged into a stack branch reached trunk later, through another squash, so its merge time is no evidence.
 * A legacy plan's `#N` numbered the private repo's PRs, so the caller never asks for one.
 */
function prsOf(ev: Evidence, substantive: readonly Commit[], opts: Resolved): number[] {
	const squashed = substantive.flatMap((c) => {
		const n = opts.byMergeCommit.get(c.sha) ?? Number(c.subject.match(/\(#(\d+)\)$/)?.[1])
		return Number.isInteger(n) ? [n] : []
	})
	const born = ev.commits.at(-1)?.time ?? 0
	const cited = (text: string) =>
		[...refs(text)].filter((n) => {
			const pr = opts.prs.get(n)
			if (pr?.state !== "MERGED") return false
			return !TRUNKS.has(pr.base) || Date.parse(pr.mergedAt ?? "") >= born - STACK_SLACK_MS
		})
	const fromLines = cited(ev.lines.map((l) => `${l.status} ${l.hook}`).join(" "))
	const named = fromLines.length > 0 || squashed.length > 0 ? fromLines : cited(ev.src)
	return [...new Set([...squashed, ...named])].sort((a, b) => a - b)
}

function hookOf(ev: Evidence): string {
	const last = ev.lines.at(-1)
	if (last) return last.hook
	return ev.src.match(/^# (.+)$/m)?.[1].trim() ?? ev.dir
}

function statusOutcome(read: (path: string) => string, tracked: ReadonlySet<string>, dir: string): boolean {
	const path = `${PLANS}/${dir}/STATUS.md`
	return tracked.has(path) && links.extract(path, read(path)).h2.includes("Outcome")
}

type Verdict = Pick<Row, "class" | "status" | "followUps" | "evidence">

function verdictOf(ev: Evidence, legacy: boolean, merged: readonly number[], statusDone: boolean): Verdict {
	const answer = ANSWERS[ev.dir]
	if (answer) return { class: answer.class, status: answer.status, followUps: answer.followUps ?? [], evidence: answer.ask }
	if (ACTIVE_DIRS.has(ev.dir)) return { class: "active", status: "ACTIVE", followUps: [], evidence: "live plan" }
	if (ev.lines.some((l) => l.status === structure.CLOSING_STATUS))
		return { class: "closed", status: "completed", followUps: [], evidence: "closing index status" }
	if (legacy) return { class: "closed", status: HISTORICAL, followUps: [], evidence: "S2: only the import touched it" }
	if (merged.length > 0) return { class: "closed", status: "completed", followUps: [], evidence: `S1: merged #${merged.join(", #")}` }
	if (statusDone) return { class: "closed", status: "completed", followUps: [], evidence: "STATUS.md Outcome" }
	return { class: "ambiguous", status: "AMBIGUOUS — no merged PR, no answer", followUps: [], evidence: "none" }
}

/** The rows `ref` implies, read from its tree and history alone, so a later checkout cannot change them. */
export function deriveRows(options: Options): Row[] {
	const importSha = options.importSha ?? IMPORT
	const ref = options.ref ?? "HEAD"
	const byMergeCommit = new Map([...options.prs.values()].flatMap((p) => (p.mergeCommit ? [[p.mergeCommit, p.number] as const] : [])))
	const opts: Resolved = { ...options, byMergeCommit }
	const read = (path: string) => git(opts.cwd, "show", `${ref}:${path}`)
	const tracked = new Set(git(opts.cwd, "ls-tree", "-r", "-z", "--name-only", ref, "--", `${PLANS}/`).split("\0").filter(Boolean))
	const commits = planCommits(opts.cwd, ref)
	const { entries } = lib.parseIndex(read(lib.ACTIVE_INDEX))
	return topDirs(opts.cwd, ref).map((dir) => {
		const lines = entries.filter((e) => e.target.split("/")[0] === dir)
		const host = hostOf(
			tracked,
			dir,
			lines.map((l) => l.target),
		)
		const src = host ? read(host) : ""
		const ev: Evidence = { dir, lines, host, src, commits: commits.filter((c) => c.dirs.has(dir)) }
		const substantive = ev.commits.filter((c) => c.changed.has(dir) && !isMechanical(c, importSha))
		const legacy = substantive.length === 0 && ev.commits.some((c) => c.sha === importSha)
		const merged = legacy ? [] : prsOf(ev, substantive, opts)
		const verdict = verdictOf(ev, legacy, merged, statusOutcome(read, tracked, dir))
		const date = legacy ? IMPORT_DATE : (substantive[0]?.date ?? null)
		return { dir, ...verdict, date, prs: merged, outcomeFile: host, hook: hookOf(ev) }
	})
}

function readSnapshot<T>(cwd: string, path: string): Snapshot<T> {
	return JSON.parse(readFileSync(join(cwd, path), "utf8")) as Snapshot<T>
}

export function prMap(cwd: string): Map<number, Pr> {
	return new Map(readSnapshot<Pr>(cwd, PRS_FILE).items.map((p) => [p.number, p]))
}

/** One item per line, so a refreshed snapshot diffs by PR. */
function writeSnapshot(cwd: string, path: string, snap: Snapshot<unknown>): void {
	const items = snap.items.map((i) => `\t\t${JSON.stringify(i)}`).join(",\n")
	writeFileSync(
		join(cwd, path),
		`{\n\t"capturedAt": ${JSON.stringify(snap.capturedAt)},\n\t"totalCount": ${snap.totalCount},\n\t"items": [\n${items}\n\t]\n}\n`,
	)
}

function gh(args: readonly string[]): string {
	const res = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 28 })
	if (res.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${res.stderr.trim()}`)
	return res.stdout
}

function snapshot(cwd: string): void {
	const repo = ["--repo", "alejoamiras/nulo", "--state", "all", "--limit", "10000"]
	const totals = JSON.parse(
		gh(["api", "graphql", "-f", 'query={repository(owner:"alejoamiras",name:"nulo"){pullRequests{totalCount} issues{totalCount}}}']),
	).data.repository
	const byNumber = (a: { number: number }, b: { number: number }) => a.number - b.number
	type Listed = Omit<Pr, "base" | "mergeCommit"> & { baseRefName: string; mergeCommit: { oid: string } | null }
	const listed = JSON.parse(gh(["pr", "list", ...repo, "--json", "number,state,baseRefName,mergedAt,mergeCommit"])) as Listed[]
	const prs: Pr[] = listed
		.map(({ baseRefName, mergeCommit, ...p }) => ({ ...p, base: baseRefName, mergeCommit: mergeCommit?.oid ?? null }))
		.sort(byNumber)
	const issues = (JSON.parse(gh(["issue", "list", ...repo, "--json", "number,state"])) as { number: number }[]).sort(byNumber)
	const capturedAt = new Date().toISOString().slice(0, 10)
	writeSnapshot(cwd, PRS_FILE, { capturedAt, totalCount: totals.pullRequests.totalCount, items: prs })
	writeSnapshot(cwd, ISSUES_FILE, { capturedAt, totalCount: totals.issues.totalCount, items: issues })
}

function snapshotProblems(cwd: string): string[] {
	return [PRS_FILE, ISSUES_FILE].flatMap((path) => {
		const snap = readSnapshot<unknown>(cwd, path)
		return snap.items.length === snap.totalCount ? [] : [`${path}: ${snap.items.length} items of ${snap.totalCount}`]
	})
}

/**
 * A closed dir whose content differs between `closuresBase` and `upto` needs a fresh answer before anything
 * archives it. One tree diff, so a merge's own changes count and no subject, which any author controls, can
 * excuse a commit; `-l0` keeps rename pairing exhaustive however large the range.
 */
function driftProblems(cwd: string, file: Closures, upto: string): string[] {
	const seen = { dirs: new Set<string>(), changed: new Set<string>() }
	walkRaw(
		git(cwd, "diff", "-M", "-l0", "-z", "--raw", "--no-abbrev", file.closuresBase, upto),
		() => {},
		(change) => applyChange(seen, change),
	)
	const changed = seen.changed
	return file.rows
		.filter((r) => r.class === "closed" && changed.has(r.dir))
		.map((r) => `${r.dir}: changed since ${file.closuresBase.slice(0, 8)}; re-answer it and regenerate`)
}

/** The archive tools write each closed plan's Outcome into its host, so a byte-identical move out is still a loss. */
function hostProblems(cwd: string, rows: readonly Row[], upto: string): string[] {
	const tracked = new Set(git(cwd, "ls-tree", "-r", "-z", "--name-only", upto, `${PLANS}/`).split("\0"))
	return rows.flatMap(({ dir, class: c, outcomeFile: host }) =>
		c === "closed" && host !== null && !tracked.has(host)
			? [`${dir}: its host ${host} is gone at ${upto}; re-answer it and regenerate`]
			: [],
	)
}

/** Each row must equal its derivation at the table's base: the archive tools trust every field. */
function rowProblems(rows: readonly Row[], derived: readonly Row[]): string[] {
	const want = new Map(derived.map((r) => [r.dir, r]))
	return rows.flatMap((row) => {
		const d = want.get(row.dir)
		if (!d) return [`${row.dir}: no such dir at closuresBase`]
		const keys = [...new Set([...Object.keys(row), ...Object.keys(d)])] as (keyof Row)[]
		return keys
			.filter((k) => JSON.stringify(row[k]) !== JSON.stringify(d[k]))
			.map((k) => `${row.dir}: its ${k} is not what closuresBase derives`)
	})
}

/** `upto` is the base being archived onto: HEAD for this arc, the refreshed `dev` for a later one. */
export function checkClosures(cwd: string, file: Closures, upto = "HEAD", importSha = IMPORT): { problems: string[]; rowless: string[] } {
	const live = new Set([
		...topDirs(cwd),
		...(existsSync(join(cwd, lib.ARCHIVE)) ? lib.childDirs(lib.createCtx({ cwd }), lib.ARCHIVE) : []),
	])
	const seen = new Set<string>()
	const problems = snapshotProblems(cwd)
	problems.push(...rowProblems(file.rows, deriveRows({ cwd, prs: prMap(cwd), importSha, ref: file.closuresBase })))
	for (const row of file.rows) {
		if (seen.has(row.dir)) problems.push(`${row.dir}: two rows`)
		seen.add(row.dir)
		if (!live.has(row.dir) && !row.status.startsWith(RELOCATED)) problems.push(`${row.dir}: no such dir`)
		if (row.class === "ambiguous") problems.push(`${row.dir}: ambiguous (${row.status})`)
	}
	problems.push(...hostProblems(cwd, file.rows, upto), ...driftProblems(cwd, file, upto))
	return { problems, rowless: [...live].filter((d) => !seen.has(d)).sort() }
}

function summary(rows: readonly Row[]): string {
	const counts = new Map<string, number>()
	for (const r of rows) {
		const key = `${r.class}/${r.evidence.split(":")[0]}`
		counts.set(key, (counts.get(key) ?? 0) + 1)
	}
	return [...counts].map(([k, n]) => `${k}=${n}`).join(" ")
}

if (import.meta.main) {
	const cwd = process.cwd()
	const [flag, arg, upto] = process.argv.slice(2)
	if (flag === "--snapshot") {
		snapshot(cwd)
		console.log(`snapshots refreshed: ${PRS_FILE}, ${ISSUES_FILE}`)
	} else if (flag === "--check") {
		const file = JSON.parse(readFileSync(join(cwd, arg ?? CLOSURES), "utf8")) as Closures
		const { problems, rowless } = checkClosures(cwd, file, upto)
		for (const p of problems) console.log(`problem: ${p}`)
		if (rowless.length > 0) console.log(`no row, so active: ${rowless.join(", ")}`)
		console.log(`closures: ${file.rows.length} rows, ${problems.length} problems — ${summary(file.rows)}`)
		process.exit(problems.length === 0 ? 0 : 1)
	} else {
		const ref = flag ?? "HEAD"
		const rows = deriveRows({ cwd, prs: prMap(cwd), ref })
		const closures: Closures = { closuresBase: git(cwd, "rev-parse", ref).trim(), rows }
		writeFileSync(join(cwd, CLOSURES), `${JSON.stringify(closures, null, "\t")}\n`)
		console.log(`wrote ${CLOSURES}: ${rows.length} rows — ${summary(rows)}`)
	}
}
