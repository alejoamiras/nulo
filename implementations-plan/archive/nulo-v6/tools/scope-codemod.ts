/**
 * One-shot rename of the Aztec line's npm scopes for the 6.0.0-rc.1 bump: `@aztec/<pkg>` becomes
 * `@aztec-labs/<pkg>`, except the four packages that moved to `@aztec-foundation/`. `@aztec/viem`
 * keeps its name. Every tracked text file outside history is rewritten, Markdown included; history
 * (plans, audits, research notes, the changelog), the lockfile and the vendored account artifact are
 * never touched.
 *
 *   bun implementations-plan/nulo-v6/tools/scope-codemod.ts [--dry-run]
 *
 * A name followed by `@<digit>` is a versioned citation (`@aztec/pxe@5.0.0`) of a package that never
 * existed under the new scope, so it is left alone, and so is the KDF spec's
 * "upstream @aztec/accounts 5.0.1" line, which is the regime digest's preimage. The run ends with a
 * survivors report and exits 1 while any unexpected `@aztec/`, `@aztec+` or `@aztec%2F` form is left
 * outside Markdown: those are the hand-edited sites (scope globs, prefixes, patch names). It is
 * idempotent, so a re-run after the hand edits is the survivors check.
 */
import { readFileSync, writeFileSync } from "node:fs"

const FOUNDATION = ["bb.js", "l1-artifacts", "noir-acvm_js", "noir-noirc_abi"]
const LABS = [
	"accounts",
	"aztec-node",
	"aztec.js",
	"bb-prover",
	"blob-lib",
	"constants",
	"entrypoints",
	"ethereum",
	"foundation",
	"key-store",
	"kv-store",
	"noir-contracts.js",
	"noir-protocol-circuits-types",
	"p2p",
	"protocol-contracts",
	"pxe",
	"simulator",
	"sqlite3mc-wasm",
	"standard-contracts",
	"stdlib",
	"wallet-sdk",
	"wallets",
]
const SKIP =
	/^(implementations-plan|audit|wallets-architecture-research|architecture)\/|^CHANGELOG\.md$|(^|\/)bun\.lock$|^packages\/aztec-runtime\/src\/account\/artifacts\/SchnorrAccount\.json$/
const KEEP_LINES = ["upstream @aztec/accounts 5.0.1"]

const scopeOf = new Map<string, string>([
	...FOUNDATION.map((name): [string, string] => [name, "@aztec-foundation"]),
	...LABS.map((name): [string, string] => [name, "@aztec-labs"]),
])
const names = [...scopeOf.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.]/g, "\\."))
// The name must end there and must not carry a version: `@aztec/pxe@5.0.0` stays history.
const SPECIFIER = new RegExp(`@aztec/(${names.join("|")})(?![\\w-])(?!@\\d)`, "g")
const SURVIVOR = /@aztec(?:\/(?!viem\b)|\+|%2F)/
const HISTORY = /@aztec\/[\w.-]+@\d/

const dryRun = process.argv.includes("--dry-run")

function tracked(): string[] {
	const out = Bun.spawnSync(["git", "ls-files", "-z"], { stderr: "inherit" })
	if (out.exitCode !== 0) throw new Error("git ls-files failed")
	return out.stdout
		.toString()
		.split("\0")
		.filter((path) => path && !SKIP.test(path))
}

function rewrite(text: string): string {
	return text
		.split("\n")
		.map((line) =>
			KEEP_LINES.some((keep) => line.includes(keep))
				? line
				: line.replace(SPECIFIER, (_, name: string) => `${scopeOf.get(name)}/${name}`),
		)
		.join("\n")
}

type Survivor = { where: string; kind: "BLOCKING" | "docs" | "history" }

function survivorsOf(path: string, text: string): Survivor[] {
	const found: Survivor[] = []
	text.split("\n").forEach((line, i) => {
		if (!SURVIVOR.test(line)) return
		const history = KEEP_LINES.some((keep) => line.includes(keep)) || (HISTORY.test(line) && !/@aztec(?:\+|%2F)/.test(line))
		const kind = history ? "history" : path.endsWith(".md") ? "docs" : "BLOCKING"
		found.push({ where: `${path}:${i + 1}: ${line.trim().slice(0, 160)}`, kind })
	})
	return found
}

const touched: string[] = []
const survivors: Survivor[] = []
for (const path of tracked()) {
	const bytes = readFileSync(path)
	if (bytes.subarray(0, 8192).includes(0)) continue
	const before = bytes.toString("utf8")
	const after = rewrite(before)
	if (after !== before) {
		touched.push(path)
		if (!dryRun) writeFileSync(path, after)
	}
	survivors.push(...survivorsOf(path, after))
}

const count = (kind: Survivor["kind"]) => survivors.filter((s) => s.kind === kind).length
console.log(
	`scope-codemod: ${touched.length} file(s) ${dryRun ? "would be " : ""}rewritten; survivors: ` +
		`${count("BLOCKING")} blocking, ${count("docs")} docs, ${count("history")} history`,
)
for (const s of survivors) console.log(`  ${s.kind} ${s.where}`)
console.log(`touched:\n${touched.map((path) => `  ${path}`).join("\n")}`)
process.exit(count("BLOCKING") > 0 ? 1 : 0)
