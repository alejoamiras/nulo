/**
 * Split-line residue gate: the workspace `@aztec/*` line is bumped while
 * @alejoamiras/aztec-accelerator, @alejoamiras/private-fee-juice, and
 * @aztec-foundation/aztec-standards hold 5.0.1. Every remaining `@aztec/*@5.0.1`
 * lock entry must be reachable from a held package through the lock's dependency
 * graph — computed over graph edges, not key prefixes, because bun.lock shortens a
 * nested key to the bare position when only one dependent exists (e.g. the
 * accelerator's `@aztec/bb-prover@5.0.1` keys as bare "@aztec/bb-prover"). Runtime
 * resolution must agree: consumers reach the accelerator's nested copies at 5.0.1
 * (its `dependencies`), reach private-fee-juice's `@aztec` PEERS at the workspace
 * line (exact-5.0.1 peers re-bind to the provided context), and reach the workspace
 * line directly.
 *
 * Usage: bun scripts/aztec-hold-residue-check.ts   (exits 1 on any violation)
 */
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const WORKSPACE_LINE = "5.2.0"
const HELD_LINE = "5.0.1"
const HELD_ROOTS = [
	"@alejoamiras/aztec-accelerator",
	"@alejoamiras/private-fee-juice",
	"@aztec-foundation/aztec-standards",
]

let failures = 0
const fail = (msg: string) => {
	failures++
	console.error(`FAIL ${msg}`)
}

// --- lockfile graph closure -------------------------------------------------
type LockEntry = [string, string, Record<string, Record<string, string>>?, string?]
const lockText = await Bun.file(join(ROOT, "bun.lock")).text()
const lock = JSON.parse(lockText.replace(/,(\s*[}\]])/g, "$1")) as {
	workspaces: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>
	packages: Record<string, LockEntry>
}

const nameOf = (resolved: string) => resolved.slice(0, resolved.lastIndexOf("@"))
const versionOf = (resolved: string) => resolved.slice(resolved.lastIndexOf("@") + 1)
// A dependency `n` of the entry at `key` resolves to the chained key if present, else bare.
const childKey = (parentKey: string, n: string) => (lock.packages[`${parentKey}/${n}`] ? `${parentKey}/${n}` : n)

const depsOf = (e: LockEntry): string[] => {
	const meta = e[2] ?? {}
	return [
		...Object.keys(meta.dependencies ?? {}),
		...Object.keys(meta.peerDependencies ?? {}),
		...Object.keys(meta.optionalDependencies ?? {}),
	]
}

const reachable = new Set<string>()
const queue: string[] = []
for (const [key, e] of Object.entries(lock.packages)) {
	if (HELD_ROOTS.includes(nameOf(e[0]))) queue.push(key)
}
while (queue.length > 0) {
	const key = queue.pop() as string
	if (reachable.has(key)) continue
	reachable.add(key)
	const e = lock.packages[key]
	if (!e) continue
	for (const n of depsOf(e)) {
		const ck = childKey(key, n)
		if (lock.packages[ck] && !reachable.has(ck)) queue.push(ck)
	}
}

for (const [key, e] of Object.entries(lock.packages)) {
	const resolved = e[0]
	if (!resolved.startsWith("@aztec/")) continue
	if (versionOf(resolved).startsWith(HELD_LINE) && !reachable.has(key)) {
		fail(`lock: ${key} resolves ${resolved} but is not reachable from any held package`)
	}
}

// Workspace manifests must not pin the held line for the moving scope.
for (const [ws, meta] of Object.entries(lock.workspaces)) {
	for (const [n, rng] of Object.entries({ ...meta.dependencies, ...meta.devDependencies })) {
		if (n.startsWith("@aztec/") && n !== "@aztec/viem" && rng.startsWith(HELD_LINE)) {
			fail(`workspace ${ws || "(root)"}: ${n} still pinned ${rng}`)
		}
	}
}

// --- runtime resolution -----------------------------------------------------
const resolveFrom = (dir: string, spec: string): string => {
	const req = createRequire(join(dir, "noop.js"))
	return realpathSync(req.resolve(`${spec}/package.json`))
}
const versionAt = (p: string): string => {
	const m = p.match(/@aztec[+/]([a-z0-9_.-]+)@(\d[^+/]*)/)
	return m ? m[2] : `unparsed:${p}`
}

type Expectation = { consumer: string; via?: string; spec: string; want: string }
const CONSUMERS = ["apps/extension", "packages/aztec-runtime", "packages/bridge-core"]
const checks: Expectation[] = []
for (const c of CONSUMERS) {
	checks.push({ consumer: c, spec: "@aztec/stdlib", want: WORKSPACE_LINE })
	// Exact-5.0.1 PEERS re-bind to the provided (workspace) generation — the verified
	// hazard mode: 5.0.1-compiled wrappers running on workspace-line modules.
	checks.push({ consumer: c, via: "@alejoamiras/private-fee-juice", spec: "@aztec/stdlib", want: WORKSPACE_LINE })
	checks.push({ consumer: c, via: "@alejoamiras/private-fee-juice", spec: "@aztec/aztec.js", want: WORKSPACE_LINE })
}
for (const c of ["apps/extension", "packages/aztec-runtime"]) {
	checks.push({ consumer: c, via: "@alejoamiras/aztec-accelerator", spec: "@aztec/stdlib", want: HELD_LINE })
	checks.push({ consumer: c, via: "@alejoamiras/aztec-accelerator", spec: "@aztec/bb-prover", want: HELD_LINE })
}

for (const { consumer, via, spec, want } of checks) {
	const base = join(ROOT, consumer)
	try {
		const fromDir = via ? join(resolveFrom(base, via), "..") : base
		const target = resolveFrom(fromDir, spec)
		const got = versionAt(target)
		const label = via ? `${consumer} → ${via} → ${spec}` : `${consumer} → ${spec}`
		if (got.startsWith(want)) console.log(`ok   ${label} = ${got}`)
		else fail(`${label} = ${got}, want ${want} (${target})`)
	} catch (e) {
		fail(`${consumer}${via ? ` → ${via}` : ""} → ${spec}: ${(e as Error).message.split("\n")[0]}`)
	}
}

if (failures > 0) {
	console.error(`RESIDUE CHECK FAILED (${failures})`)
	process.exit(1)
}
console.log("RESIDUE CHECK PASSED")
