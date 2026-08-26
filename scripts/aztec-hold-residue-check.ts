/**
 * Split-line residue gate: the workspace `@aztec/*` line moves while
 * @alejoamiras/private-fee-juice and @aztec-foundation/aztec-standards stay pinned
 * to an older line. Every remaining `@aztec/*@5.0.1` lock entry must be reachable
 * from one of those packages through the lock's dependency graph — computed over
 * graph edges, not key prefixes, because bun.lock shortens a nested key to the bare
 * position when only one dependent exists. Runtime resolution must agree: every
 * consumer reaches the workspace line, directly and through each held package.
 * A held package's exact-pinned `@aztec` PEER only re-binds to the workspace line when
 * the consuming workspace DECLARES that package; otherwise it silently nests the old
 * version (bridge-core hit exactly this with `@aztec/protocol-contracts`), which is why
 * every peer is checked from every consumer rather than a sample.
 *
 * The accelerator SDK is deliberately NOT held: a single `@aztec` generation in the
 * prover path is load-bearing, because upstream's `getVKIndex` discriminates with
 * `instanceof` and silently mis-resolves when two copies of
 * @aztec/noir-protocol-circuits-types coexist in one bundle.
 *
 * Usage: bun scripts/aztec-hold-residue-check.ts   (exits 1 on any violation)
 */
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const WORKSPACE_LINE = "5.2.0"
const HELD_LINE = "5.0.1"
const HELD_ROOTS = ["@alejoamiras/private-fee-juice", "@aztec-foundation/aztec-standards"]
/** Packages whose own `@aztec` deps must resolve to the workspace line, not a private copy. */
const SINGLE_GENERATION_ROOTS = ["@alejoamiras/aztec-accelerator"]

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
const checks: Expectation[] = []

/** `@aztec/*` names a package declares under the given manifest field, from the lock. */
const aztecDepsOf = (pkg: string, field: "dependencies" | "peerDependencies"): string[] => {
	const entry = Object.values(lock.packages).find((e) => nameOf(e[0]) === pkg)
	return Object.keys(entry?.[2]?.[field] ?? {}).filter((n) => n.startsWith("@aztec/"))
}

// Consumers and specs are DERIVED, never hard-coded: a new workspace that pulls a held package,
// or a new peer added upstream, must be covered automatically or the gate is fail-open.
for (const [ws, meta] of Object.entries(lock.workspaces)) {
	if (!ws) continue
	const declared = { ...meta.dependencies, ...meta.devDependencies }
	// Probe what this workspace actually declares: under the isolated linker an undeclared
	// package resolves out of the worktree entirely, which is a phantom dep, not a version fact.
	for (const spec of Object.keys(declared).filter((n) => n.startsWith("@aztec/") && n !== "@aztec/viem")) {
		checks.push({ consumer: ws, spec, want: WORKSPACE_LINE })
	}
	for (const held of HELD_ROOTS) {
		if (!declared[held]) continue
		// A held package's exact-pinned peers only rebind when this workspace declares them.
		for (const spec of aztecDepsOf(held, "peerDependencies")) {
			checks.push({ consumer: ws, via: held, spec, want: WORKSPACE_LINE })
		}
	}
	for (const single of SINGLE_GENERATION_ROOTS) {
		if (!declared[single]) continue
		// The prover path must be single-generation end to end (see the header note on getVKIndex).
		for (const spec of aztecDepsOf(single, "dependencies")) {
			checks.push({ consumer: ws, via: single, spec, want: WORKSPACE_LINE })
		}
	}
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
