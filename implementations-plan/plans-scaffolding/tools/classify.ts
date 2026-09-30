#!/usr/bin/env bun
/**
 * The closure table: one row per top-level plan dir, derived from git, the frozen gh snapshots beside
 * this tool, and the owner's answers to Asks S1–S17.
 *
 * With no flag it writes `closures.json` for HEAD. `--snapshot` refreshes `gh-prs.json` and
 * `gh-issues.json`, the tool's only network use. `--check [file] [upto]` fails unless both snapshots hold
 * their full counts, every row names a live dir once, no row is ambiguous, and no closed dir changed between
 * the file's base and `upto`; a dir with no row is reported as active, never guessed.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { git, PLANS } from "./common"
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
/** Commits that edited many plans at once without changing any; a dir's date skips them. */
const MECHANICAL_SUBJECTS = [
	/^chore: open-source initial import$/,
	/^docs: point the wallet repo's docs, plans and skills at unleashed \(#692\)$/,
	/^chore\(plans\): (?:untrack plan transcripts|relocate plan-dir assets|archive closed plans)/,
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
	"harden-findings-remediation": done("S9", ["harden-f11-scope"]),
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

type Commit = { sha: string; date: string; time: number; subject: string; dirs: Set<string> }
type Evidence = { dir: string; lines: ReturnType<typeof lib.parseIndex>["entries"]; host: string | null; src: string; commits: Commit[] }
export type Options = { cwd: string; prs: ReadonlyMap<number, Pr>; importSha?: string }
type Resolved = Options & { byMergeCommit: ReadonlyMap<string, number> }

/** Every commit in `range` touching the plan tree, newest first, with the top-level dirs it touched. */
function planCommits(cwd: string, range = "HEAD"): Commit[] {
	const out = git(cwd, "log", "--format=%x00%H %cs %cI %s", "--name-only", range, "--", PLANS)
	return out
		.split("\0")
		.filter(Boolean)
		.map((block) => {
			const [head, ...files] = block.trim().split("\n")
			const [sha, date, iso, ...subject] = head.split(" ")
			const dirs = new Set(
				files
					.map((f) => f.split("/"))
					.filter((p) => p.length > 2 && p[0] === PLANS)
					.map((p) => p[1]),
			)
			return { sha, date, time: Date.parse(iso), subject: subject.join(" "), dirs }
		})
}

export function topDirs(cwd: string): string[] {
	return git(cwd, "ls-tree", "-d", "--name-only", "HEAD", `${PLANS}/`)
		.split("\n")
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

function statusOutcome(cwd: string, tracked: ReadonlySet<string>, dir: string): boolean {
	const path = `${PLANS}/${dir}/STATUS.md`
	return tracked.has(path) && links.extract(path, readFileSync(join(cwd, path), "utf8")).h2.includes("Outcome")
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

export function deriveRows(options: Options): Row[] {
	const importSha = options.importSha ?? IMPORT
	const byMergeCommit = new Map([...options.prs.values()].flatMap((p) => (p.mergeCommit ? [[p.mergeCommit, p.number] as const] : [])))
	const opts: Resolved = { ...options, byMergeCommit }
	const tracked = new Set(git(opts.cwd, "ls-files", "-z", "--", PLANS).split("\0").filter(Boolean))
	const commits = planCommits(opts.cwd)
	const { entries } = lib.parseIndex(readFileSync(join(opts.cwd, lib.ACTIVE_INDEX), "utf8"))
	return topDirs(opts.cwd).map((dir) => {
		const lines = entries.filter((e) => e.target.split("/")[0] === dir)
		const host = hostOf(
			tracked,
			dir,
			lines.map((l) => l.target),
		)
		const src = host ? readFileSync(join(opts.cwd, host), "utf8") : ""
		const ev: Evidence = { dir, lines, host, src, commits: commits.filter((c) => c.dirs.has(dir)) }
		const substantive = ev.commits.filter((c) => !isMechanical(c, importSha))
		const legacy = substantive.length === 0 && ev.commits.some((c) => c.sha === importSha)
		const merged = legacy ? [] : prsOf(ev, substantive, opts)
		const verdict = verdictOf(ev, legacy, merged, statusOutcome(opts.cwd, tracked, dir))
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
 * A closed dir that a substantive commit touched after `closuresBase` needs a fresh answer before anything
 * archives it. Commits, not a diff, so this plan's own relocation and archive squashes never count.
 */
function driftProblems(cwd: string, file: Closures, upto: string): string[] {
	const later = planCommits(cwd, `${file.closuresBase}..${upto}`).filter((c) => !isMechanical(c, IMPORT))
	const touched = new Set(later.flatMap((c) => [...c.dirs]))
	return file.rows
		.filter((r) => r.class === "closed" && touched.has(r.dir))
		.map((r) => `${r.dir}: changed since ${file.closuresBase.slice(0, 8)}; re-answer it and regenerate`)
}

/** `upto` is the base being archived onto: HEAD for this arc, the refreshed `dev` for a later one. */
export function checkClosures(cwd: string, file: Closures, upto = "HEAD"): { problems: string[]; rowless: string[] } {
	const live = new Set([
		...topDirs(cwd),
		...(existsSync(join(cwd, lib.ARCHIVE)) ? lib.childDirs(lib.createCtx({ cwd }), lib.ARCHIVE) : []),
	])
	const seen = new Set<string>()
	const problems = snapshotProblems(cwd)
	for (const row of file.rows) {
		if (seen.has(row.dir)) problems.push(`${row.dir}: two rows`)
		seen.add(row.dir)
		if (!live.has(row.dir)) problems.push(`${row.dir}: no such dir`)
		if (row.class === "ambiguous") problems.push(`${row.dir}: ambiguous (${row.status})`)
	}
	problems.push(...driftProblems(cwd, file, upto))
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
		const rows = deriveRows({ cwd, prs: prMap(cwd) })
		const closures: Closures = { closuresBase: git(cwd, "rev-parse", "HEAD").trim(), rows }
		writeFileSync(join(cwd, CLOSURES), `${JSON.stringify(closures, null, "\t")}\n`)
		console.log(`wrote ${CLOSURES}: ${rows.length} rows — ${summary(rows)}`)
	}
}
