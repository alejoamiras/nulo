/** What the migration tools share: the evidence manifest, the promotion and rename tables, git access. */
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, posix } from "node:path"
import { lib } from "./gate"

export const PLANS = lib.PLANS
export const PERMALINK_PREFIX = "https://github.com/alejoamiras/nulo/blob/"
/** The untrack base the plan pins first; a later merge-base with `origin/dev` covers what landed after it. */
export const UNTRACK_BASE = "9f11de70b13933be2d54c3eb79622b1ff2719aba"
export const MANIFEST = `${PLANS}/plans-scaffolding/untrack-manifest.json`
export const BASES_FILE = "scripts/ci-cd/plans/permalink-bases.json"
export const DEV_REF = "refs/remotes/origin/dev"

/** One removed or replaced path, and where its exact bytes stay reachable. */
export type Row = { path: string; sha: string; blob: string }

/**
 * The plan of record in each directory whose plan lives in a revision. `M6` and `e2e-stabilization` are
 * absent on purpose: their `plan.md` is newer than every revision beside it.
 */
export const PROMOTIONS: readonly { dir: string; from: string }[] = [
	{ dir: "M3/0", from: "plan-0.6-phase2.md" },
	{ dir: "M4/10-network-rework", from: "plan-v4.md" },
	{ dir: "M4/2", from: "plan-v2.md" },
	{ dir: "aztec-4.2.0-bump", from: "plan-v2.md" },
	{ dir: "bb-wasm-hardening", from: "plan-v1.md" },
	{ dir: "bundle-fpc-nft", from: "plan-v2.md" },
	{ dir: "capabilities-popup-quality", from: "plan-v2.md" },
	{ dir: "contacts-export-uxr", from: "plan-v2.md" },
	{ dir: "contacts-rename-export-senders", from: "plan-v2.md" },
	{ dir: "deprecate-simulate-views", from: "plan-v2.md" },
	{ dir: "docs-improvement", from: "plan-v2.md" },
	{ dir: "e2e-determinism", from: "plan-final.md" },
	{ dir: "e2e-network-recovery", from: "plan-v2.md" },
	{ dir: "embedded-fpc-firsttx-cosmetic", from: "plan-v2.md" },
	{ dir: "fast-path-internal-views", from: "plan-v2.md" },
	{ dir: "faucet-add-token", from: "plan-v2.md" },
	{ dir: "network-test-triage", from: "plan-reconciled.md" },
	{ dir: "phase-2-plus", from: "plan-v4.md" },
	{ dir: "pre-a11-ux-cleanup", from: "plan-v4.md" },
	{ dir: "profile-name-parity", from: "plan-v2.md" },
	{ dir: "registry-stealth-notes", from: "plan-v3.md" },
	{ dir: "wallet-sdk-implicit-account-grant", from: "plan-v3.md" },
]

/** Revisions of one plan, as opposed to the competing drafts of an audit leg (`plan-codex.md`, …). */
export const REVISION_RE = /^plan-(?:v\d+|final|reconciled|consolidated|0\.6-phase2)\.md$/

/** Curated files the `audit-*` pattern would catch, renamed so they stay tracked. */
export const RENAMES: readonly (readonly [string, string])[] = [
	[`${PLANS}/M3/7/audit-findings.md`, `${PLANS}/M3/7/findings.md`],
	[
		`${PLANS}/incoming-trust-state-machine-refactor/audit-response-round1.md`,
		`${PLANS}/incoming-trust-state-machine-refactor/decision-ledger-round1.md`,
	],
	[
		`${PLANS}/incoming-trust-state-machine-refactor/audit-response-round2.md`,
		`${PLANS}/incoming-trust-state-machine-refactor/decision-ledger-round2.md`,
	],
]

/** Nested ignore files the hygiene step deletes outright; they need a row like any other removed path. */
export const DELETED: readonly string[] = [`${PLANS}/tools-extraction/.gitignore`]

export function planPath(dir: string, file: string): string {
	return posix.join(PLANS, dir, file)
}

export function git(cwd: string, ...args: string[]): string {
	const res = lib.runGit(cwd, args)
	if (!res.ok) throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim()}`)
	return res.stdout
}

export function readManifest(cwd: string): Row[] {
	try {
		return JSON.parse(readFileSync(join(cwd, MANIFEST), "utf8")) as Row[]
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return []
		throw e
	}
}

/** Sorted by path with one row per line block, so an appended row is a small reviewable diff. */
export function writeManifest(cwd: string, rows: readonly Row[]): void {
	const sorted = [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
	mkdirSync(dirname(join(cwd, MANIFEST)), { recursive: true })
	writeFileSync(join(cwd, MANIFEST), `${JSON.stringify(sorted, null, "\t")}\n`)
}

export function rowsByPath(rows: readonly Row[]): Map<string, Row> {
	return new Map(rows.map((r) => [r.path, r]))
}

export function permalink(row: Pick<Row, "path" | "sha">): string {
	return `${PERMALINK_PREFIX}${row.sha}/${row.path}`
}

/** Blob ids for `<rev>:<path>` specs, one `git cat-file --batch-check` for all of them; null where absent. */
export function blobIds(cwd: string, specs: readonly string[]): (string | null)[] {
	if (specs.length === 0) return []
	const res = spawnSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
		cwd,
		input: `${specs.join("\n")}\n`,
		encoding: "utf8",
		maxBuffer: 1024 * 1024 * 1024,
		env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
	})
	if (res.status !== 0) throw new Error(`git cat-file --batch-check failed: ${res.stderr}`)
	const lines = res.stdout.trimEnd().split("\n")
	if (lines.length !== specs.length) throw new Error(`git cat-file --batch-check answered ${lines.length} of ${specs.length}`)
	// A missing spec prints `<spec> missing`, so only a line ending in ` blob` names a blob.
	return lines.map((line) => (line.endsWith(" blob") ? line.slice(0, -5) : null))
}
