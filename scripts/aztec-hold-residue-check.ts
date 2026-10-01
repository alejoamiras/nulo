/**
 * Single-generation gate for the Aztec line (`@aztec-labs/*`, `@aztec-foundation/*`). Every lock
 * entry in those scopes is on the workspace line unless a held package reaches it through the lock's
 * dependency graph — computed over graph edges, not key prefixes, because bun.lock shortens a nested
 * key to the bare position when only one dependent exists — and no package of the retired `@aztec`
 * scope but `@aztec/viem` is locked at all. Runtime resolution must agree: every consumer, and
 * everything that must share its generation, reaches one physical copy of each Aztec package.
 * A package's exact-pinned Aztec PEER only re-binds to the workspace line when the consuming
 * workspace DECLARES that package; otherwise it silently nests its own copy, which is why every peer
 * is checked from every consumer rather than a sample.
 *
 * One generation in the prover path is load-bearing: upstream's `getVKIndex` discriminates with
 * `instanceof` and silently mis-resolves when two copies of
 * @aztec-labs/noir-protocol-circuits-types coexist in one bundle.
 *
 * Usage: bun scripts/aztec-hold-residue-check.ts   (exits 1 on any violation)
 */
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const WORKSPACE_LINE = "6.0.0-rc.1"
/** Packages allowed to stay on an older Aztec line, with everything they reach. Empty: one generation. */
const HELD_ROOTS: string[] = []
/** Packages whose own Aztec deps and peers must resolve to the workspace line, not a private copy. */
const SINGLE_GENERATION_ROOTS = ["@alejoamiras/presto", "@alejoamiras/private-fee-juice", "@aztec-foundation/aztec-standards"]
const AZTEC_LINE = /^@aztec-(labs|foundation)\//
const RETIRED_SCOPE = /^@aztec\/(?!viem$)/

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
	if (RETIRED_SCOPE.test(nameOf(resolved))) {
		fail(`lock: ${key} resolves ${resolved}, a package of the retired scope`)
	} else if (AZTEC_LINE.test(resolved) && versionOf(resolved) !== WORKSPACE_LINE && !reachable.has(key)) {
		fail(`lock: ${key} resolves ${resolved}, off the workspace line, and no held package reaches it`)
	}
}

// Workspace manifests pin the workspace line, and nothing from the retired scope.
for (const [ws, meta] of Object.entries(lock.workspaces)) {
	for (const [n, rng] of Object.entries({ ...meta.dependencies, ...meta.devDependencies })) {
		if (RETIRED_SCOPE.test(n)) fail(`workspace ${ws || "(root)"}: ${n} is a package of the retired scope`)
		else if (AZTEC_LINE.test(n) && !HELD_ROOTS.includes(n) && rng !== WORKSPACE_LINE) {
			fail(`workspace ${ws || "(root)"}: ${n} pinned ${rng}, not ${WORKSPACE_LINE}`)
		}
	}
}

// --- runtime resolution -----------------------------------------------------
const resolveFrom = (dir: string, spec: string): string => {
	const req = createRequire(join(dir, "noop.js"))
	return realpathSync(req.resolve(`${spec}/package.json`))
}
const versionAt = (p: string): string => {
	const m = p.match(/@aztec-(?:labs|foundation)[+/]([a-z0-9_.-]+)@(\d[^+/]*)/)
	return m ? m[2] : `unparsed:${p}`
}

/** `chain` is the package hops to resolve THROUGH, each from the previous one's directory. */
type Expectation = { consumer: string; chain: string[]; spec: string; want: string }
const checks: Expectation[] = []

const aztecDepsOf = (pkg: string, field: "dependencies" | "peerDependencies"): string[] => {
	const entry = Object.values(lock.packages).find((e) => nameOf(e[0]) === pkg)
	return Object.keys(entry?.[2]?.[field] ?? {}).filter((n) => AZTEC_LINE.test(n))
}

// Consumers and specs are DERIVED, never hard-coded: a new workspace that pulls a held package,
// or a new peer added upstream, must be covered automatically or the gate is fail-open.
for (const [ws, meta] of Object.entries(lock.workspaces)) {
	if (!ws) continue
	const declared = { ...meta.dependencies, ...meta.devDependencies }
	// Probe what this workspace actually declares: under the isolated linker an undeclared
	// package resolves out of the worktree entirely, which is a phantom dep, not a version fact.
	for (const spec of Object.keys(declared).filter((n) => AZTEC_LINE.test(n) && !HELD_ROOTS.includes(n))) {
		checks.push({ consumer: ws, chain: [], spec, want: WORKSPACE_LINE })
	}
	for (const held of HELD_ROOTS) {
		if (!declared[held]) continue
		// A held package's exact-pinned peers only rebind when this workspace declares them.
		for (const spec of aztecDepsOf(held, "peerDependencies")) {
			checks.push({ consumer: ws, chain: [held], spec, want: WORKSPACE_LINE })
		}
	}
	for (const single of SINGLE_GENERATION_ROOTS) {
		if (!declared[single]) continue
		for (const spec of aztecDepsOf(single, "peerDependencies")) {
			checks.push({ consumer: ws, chain: [single], spec, want: WORKSPACE_LINE })
		}
		// Walk the WHOLE Aztec closure, not just direct deps: the module that actually broke
		// (noir-protocol-circuits-types, home of getVKIndex) hangs off bb-prover, one edge in.
		const visited = new Set<string>([single])
		const paths: string[][] = [[single]]
		while (paths.length > 0) {
			const chain = paths.shift() as string[]
			for (const spec of aztecDepsOf(chain[chain.length - 1], "dependencies")) {
				checks.push({ consumer: ws, chain, spec, want: WORKSPACE_LINE })
				if (!visited.has(spec)) {
					visited.add(spec)
					paths.push([...chain, spec])
				}
			}
		}
	}
}

// Same version is NOT the same module: the isolated linker materializes one physical copy per
// peer context, and `instanceof` across two copies fails exactly like the dual-generation case.
const canonical = new Map<string, { path: string; label: string }>()

for (const { consumer, chain, spec, want } of checks) {
	const base = join(ROOT, consumer)
	try {
		let fromDir = base
		for (const hop of chain) fromDir = join(resolveFrom(fromDir, hop), "..")
		const target = resolveFrom(fromDir, spec)
		const got = versionAt(target)
		const label = [consumer, ...chain, spec].join(" → ")
		const seen = canonical.get(spec)
		if (seen && seen.path !== target) {
			fail(`${label} resolves ${target}, but ${seen.label} resolves ${seen.path} — two physical copies of ${spec}`)
		} else if (!seen) {
			canonical.set(spec, { path: target, label })
		}
		if (got === want) console.log(`ok   ${label} = ${got}`)
		else fail(`${label} = ${got}, want ${want} (${target})`)
	} catch (e) {
		fail(`${[consumer, ...chain, spec].join(" → ")}: ${(e as Error).message.split("\n")[0]}`)
	}
}

if (failures > 0) {
	console.error(`RESIDUE CHECK FAILED (${failures})`)
	process.exit(1)
}
console.log("RESIDUE CHECK PASSED")
