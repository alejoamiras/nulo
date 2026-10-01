/**
 * Machine-generated lockfile-diff exception list (aztec-update discipline: NO blanket
 * acceptance — every non-Aztec-scope resolution change is enumerated for individual review).
 *
 * Usage: bun scripts/lockfile-exception-diff.ts <old-lock> <new-lock>
 * Output: JSON — { aztecScope: [...], exceptions: [...], removed: [...], added: [...] }.
 * "aztecScope" = moves of the Aztec line's own packages (the retired @aztec scope, @aztec-labs/*,
 * @aztec-foundation/*, @alejoamiras/*), judged by the resolved package, not the lock key, so a
 * third-party package nested under an Aztec one is still an exception. Everything else lands in
 * "exceptions"/"added"/"removed" and must be dispositioned in the bump's lessons file.
 */
const [oldPath, newPath] = process.argv.slice(2)
if (!oldPath || !newPath) throw new Error("usage: bun scripts/lockfile-exception-diff.ts <old-lock> <new-lock>")

type Resolution = { name: string; version: string }
type Resolutions = Map<string, Resolution>

// The 6.x line moved every package of the retired `@aztec` scope but viem to these scopes. Mapping
// old keys onto them pairs a move with its old entry, so nested third-party packages are compared,
// not dropped.
const FOUNDATION = new Set(["bb.js", "l1-artifacts", "noir-acvm_js", "noir-noir_codegen", "noir-noirc_abi", "noir-types"])
const toCurrentScope = (key: string) =>
	key.replace(/@aztec\/(?!viem(?:\/|$))([^/]+)/g, (_, pkg: string) => `${FOUNDATION.has(pkg) ? "@aztec-foundation" : "@aztec-labs"}/${pkg}`)

const parseLock = async (path: string): Promise<Resolutions> => {
	const text = await Bun.file(path).text()
	// bun.lock is JSONC (trailing commas). Strip them, then JSON.parse.
	const json = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"))
	const out: Resolutions = new Map()
	for (const [key, entry] of Object.entries(json.packages ?? {})) {
		// Entry shape: ["name@version", ...] — the first element carries the resolution.
		const spec = Array.isArray(entry) ? String(entry[0]) : String(entry)
		const at = spec.lastIndexOf("@")
		if (at <= 0) continue
		out.set(toCurrentScope(key), { name: toCurrentScope(spec.slice(0, at)), version: spec.slice(at + 1) })
	}
	return out
}

const isAztecScope = ({ name }: Resolution) => /^@(aztec|aztec-labs|aztec-foundation|alejoamiras)\//.test(name)

const oldRes = await parseLock(oldPath)
const newRes = await parseLock(newPath)

const aztecScope: object[] = []
const exceptions: object[] = []
const added: object[] = []
const removed: object[] = []

for (const [key, next] of [...newRes.entries()].sort()) {
	const prev = oldRes.get(key)
	if (prev === undefined) {
		;(isAztecScope(next) ? aztecScope : added).push({ name: key, new: next.version })
	} else if (prev.version !== next.version) {
		;(isAztecScope(next) ? aztecScope : exceptions).push({ name: key, old: prev.version, new: next.version })
	}
}
for (const [key, prev] of [...oldRes.entries()].sort()) {
	if (!newRes.has(key)) (isAztecScope(prev) ? aztecScope : removed).push({ name: key, old: prev.version, gone: true })
}

console.log(JSON.stringify({ aztecScope, exceptions, added, removed }, null, "\t"))
if (exceptions.length + added.length + removed.length > 0) {
	console.error(`\n${exceptions.length} changed + ${added.length} added + ${removed.length} removed NON-Aztec entries — disposition each in lessons.`)
}
