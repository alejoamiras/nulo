/**
 * Machine-generated lockfile-diff exception list (aztec-update discipline: NO blanket
 * acceptance — every non-Aztec-scope resolution change is enumerated for individual review).
 *
 * Usage: bun scripts/lockfile-exception-diff.ts <old-lock> <new-lock>
 * Output: JSON — { aztecScope: [...], exceptions: [...], removed: [...], added: [...] }.
 * "aztecScope" = @aztec/* and @alejoamiras/* moves (the intended bump). Everything else lands
 * in "exceptions"/"added"/"removed" and must be dispositioned in the bump's lessons file.
 */
const [oldPath, newPath] = process.argv.slice(2)
if (!oldPath || !newPath) throw new Error("usage: bun scripts/lockfile-exception-diff.ts <old-lock> <new-lock>")

type Resolutions = Map<string, string>

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
		out.set(key, spec.slice(at + 1))
	}
	return out
}

const isAztecScope = (name: string) => name.startsWith("@aztec/") || name.startsWith("@alejoamiras/")

const oldRes = await parseLock(oldPath)
const newRes = await parseLock(newPath)

const aztecScope: object[] = []
const exceptions: object[] = []
const added: object[] = []
const removed: object[] = []

for (const [name, newVersion] of [...newRes.entries()].sort()) {
	const oldVersion = oldRes.get(name)
	if (oldVersion === undefined) {
		;(isAztecScope(name) ? aztecScope : added).push({ name, new: newVersion })
	} else if (oldVersion !== newVersion) {
		;(isAztecScope(name) ? aztecScope : exceptions).push({ name, old: oldVersion, new: newVersion })
	}
}
for (const [name, oldVersion] of [...oldRes.entries()].sort()) {
	if (!newRes.has(name)) (isAztecScope(name) ? aztecScope : removed).push({ name, old: oldVersion, gone: true })
}

console.log(JSON.stringify({ aztecScope, exceptions, added, removed }, null, "\t"))
if (exceptions.length + added.length + removed.length > 0) {
	console.error(`\n${exceptions.length} changed + ${added.length} added + ${removed.length} removed NON-Aztec entries — disposition each in lessons.`)
}
