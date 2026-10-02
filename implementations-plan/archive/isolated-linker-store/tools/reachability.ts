// Production-bundle reachability from the lockfile graph: walk apps/extension's
// `dependencies` (NOT devDependencies) through each lock record's dependency
// edges. A moved package is "bundle-reachable" if it appears in this closure.
// usage: bun reachability.ts <bun.lock> <moved-keys.txt>
import { readFileSync } from "node:fs"

const [lockPath, movedPath] = process.argv.slice(2)
const txt = readFileSync(lockPath as string, "utf8").replace(/,(\s*[}\]])/g, "$1")
const lock = JSON.parse(txt) as {
	workspaces: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>
	packages: Record<string, unknown[]>
}
// Resolve a dependency NAME from the perspective of a lock key: bun's key scheme
// nests conflicts as "<parentkey>/<name>"; the un-nested name is the hoisted record.
function resolveKey(fromKey: string, name: string): string | undefined {
	const parts = fromKey ? fromKey.split("/") : []
	// try the deepest nesting first
	for (let i = parts.length; i >= 0; i--) {
		const cand = [...parts.slice(0, i), name].join("/")
		if (lock.packages[cand]) return cand
	}
	return undefined
}
const ext = lock.workspaces["apps/extension"] ?? {}
const roots = Object.keys(ext.dependencies ?? {})
const seen = new Set<string>()
const queue: string[] = []
for (const r of roots) {
	// workspace deps ("@nulo/x": "workspace:*") — walk into their prod deps too
	if ((ext.dependencies?.[r] ?? "").startsWith("workspace:")) {
		const wsKey = Object.keys(lock.workspaces).find((k) => k && (lock.workspaces[k] as { name?: string } & typeof ext).name === r)
		const ws = wsKey ? lock.workspaces[wsKey] : undefined
		for (const d of Object.keys(ws?.dependencies ?? {})) {
			const k = resolveKey("", d)
			if (k) queue.push(k)
		}
		continue
	}
	const k = resolveKey("", r)
	if (k) queue.push(k)
}
while (queue.length) {
	const k = queue.shift() as string
	if (seen.has(k)) continue
	seen.add(k)
	const rec = lock.packages[k] as [string, string, { dependencies?: Record<string, string> } | undefined]
	for (const d of Object.keys(rec[2]?.dependencies ?? {})) {
		const dk = resolveKey(k, d)
		if (dk && !seen.has(dk)) queue.push(dk)
	}
}
const moved = readFileSync(movedPath as string, "utf8").split("\n").filter(Boolean)
const reachable = moved.filter((m) => seen.has(m))
console.log(`prod-reachable closure from apps/extension: ${seen.size} records`)
console.log(`moved keys: ${moved.length}; BUNDLE-REACHABLE moved: ${reachable.length}`)
for (const r of reachable) console.log(`  ${r}`)
