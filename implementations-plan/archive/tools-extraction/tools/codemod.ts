/**
 * Renames nulo's package specifiers in the extracted tree: the three published packages become
 * `@alejoamiras/nulo-*` dependencies at the given spec, everything else `@unleashed/*`. Specifiers
 * and manifests only; protocol strings (`deriveNuloAccountKeys`, KDF labels, `nulo:` storage keys)
 * are not specifiers and stay byte-for-byte. Plans and audits are history and are not rewritten,
 * and neither is a file derived from Azguard Wallet: it stays byte-identical to nulo's copy.
 *
 *   bun codemod.ts <repo> <name>=<spec> ...
 *
 * <name> is one of the three published names, <spec> what its dependents declare (an exact
 * version, or a `file:` tarball in the rehearsal). Exits 1 if a `@nulo/` specifier survives
 * outside Markdown and derived files; those survivors are listed for the docs pass.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PUBLISHED = ["wallet-crypto", "resolve-asset", "wallet-sdk-schema-patch"] as const
const RENAMED = ["bridge-core", "design", "tools", "txe-server"] as const
const HISTORY = /^(implementations-plan|audit)\//
const DERIVED_MARKER = "Modified from Azguard Wallet"
const TAIL = String.raw`(?![\w-])`

const [repo, ...pairs] = process.argv.slice(2)
if (!repo) throw new Error("usage: bun codemod.ts <repo> <name>=<spec> ...")
const specs = new Map(
	pairs.map((pair) => {
		const [name, spec] = pair.split(/=(.*)/s)
		if (!PUBLISHED.includes(name as (typeof PUBLISHED)[number]) || !spec) throw new Error(`bad pair: ${pair}`)
		return [name, spec]
	}),
)
if (specs.size !== PUBLISHED.length) throw new Error(`give a spec for each of ${PUBLISHED.join(", ")}`)

const RULES: [RegExp, string][] = [
	[new RegExp(`@nulo/(${PUBLISHED.join("|")})${TAIL}`, "g"), "@alejoamiras/nulo-$1"],
	[new RegExp(`@nulo/(${RENAMED.join("|")})${TAIL}`, "g"), "@unleashed/$1"],
	[/@nulo\/\*/g, "@unleashed/*"],
	// A bare scope prefix selects workspaces; the published three no longer match it, which is right.
	[/@nulo\/(?=["'`])/g, "@unleashed/"],
]

function tracked(): string[] {
	const out = Bun.spawnSync(["git", "-C", repo, "ls-files", "-z"], { stderr: "inherit" })
	if (out.exitCode !== 0) throw new Error("git ls-files failed")
	return out.stdout
		.toString()
		.split("\0")
		.filter((p) => p && !HISTORY.test(p))
}

function rewriteDependencySpecs(text: string): string {
	let next = text
	for (const [name, spec] of specs) {
		const declared = new RegExp(`("@alejoamiras/nulo-${name}":\\s*)"workspace:\\*"`, "g")
		next = next.replace(declared, (_, key) => `${key}${JSON.stringify(spec)}`)
	}
	return next
}

let changed = 0
const survivors: { where: string; kind: "BLOCKING" | "docs" | "derived" }[] = []
for (const path of tracked()) {
	const bytes = readFileSync(join(repo, path))
	if (bytes.subarray(0, 8192).includes(0)) continue
	const before = bytes.toString("utf8")
	const derived = before.includes(DERIVED_MARKER)
	let after = derived ? before : RULES.reduce((text, [re, to]) => text.replace(re, to), before)
	if (!derived && (path === "package.json" || path.endsWith("/package.json"))) after = rewriteDependencySpecs(after)
	if (after !== before) {
		writeFileSync(join(repo, path), after)
		changed++
	}
	const kind = derived ? "derived" : path.endsWith(".md") ? "docs" : "BLOCKING"
	after.split("\n").forEach((line, i) => {
		if (line.includes("@nulo/")) survivors.push({ where: `${path}:${i + 1}: ${line.trim()}`, kind })
	})
}

const blocking = survivors.filter((s) => s.kind === "BLOCKING").length
console.log(`codemod: ${changed} file(s) rewritten; ${survivors.length} @nulo/ line(s) left, ${blocking} blocking`)
for (const s of survivors) console.log(`  ${s.kind} ${s.where}`)
process.exit(blocking > 0 ? 1 : 0)
