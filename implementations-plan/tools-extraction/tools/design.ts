/**
 * Writes `packages/design` into the extracted tree from the freeze tree, trimmed to the closure the
 * tools app renders: the components it imports, what they import in turn, and the token, theme and
 * font infrastructure. Every other SFC goes with its test and story, and the barrel, the exports map
 * and the mount-all gate lose their entries. Kept files are copied untouched, so their
 * "Modified from Azguard Wallet" headers travel with them, as does the root NOTICE.
 *
 *   bun design.ts <freeze-dir> <repo>
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"

/** What `apps/tools` imports from the package: named imports, the Flex resolver, `./testing`, `base.css`. */
const ROOTS = [
	"core/Flex.vue",
	"core/Icon.vue",
	"ui/Button.vue",
	"ui/Card.vue",
	"ui/Toast.vue",
	"composite/AddressDisplay.vue",
	"composite/BalanceRow.vue",
	"composite/DisclaimerTag.vue",
	"composite/DripButton.vue",
	"composite/EmojiGrid.vue",
	"testing.ts",
	"tokens.ts",
	"base.css",
]
const COMPONENT_DIRS = ["core", "ui", "composite", "composables"]

const [freeze, repo] = process.argv.slice(2)
if (!freeze || !repo) throw new Error("usage: bun design.ts <freeze-dir> <repo>")
const pkg = join(repo, "packages/design")
const srcDir = join(pkg, "src")
if (existsSync(pkg)) throw new Error(`${pkg} exists; the design step writes a fresh package`)
cpSync(join(freeze, "packages/design"), pkg, { recursive: true })

function relativeImports(file: string): string[] {
	const text = readFileSync(join(srcDir, file), "utf8")
	const found = text.matchAll(/(?:from|import)\s+["'](\.{1,2}\/[^"']+)["']/g)
	return [...found].map((m) => resolveModule(normalize(join(dirname(file), m[1]))))
}

function resolveModule(path: string): string {
	const candidate = [path, `${path}.ts`, `${path}/index.ts`].find((p) => existsSync(join(srcDir, p)))
	if (!candidate) throw new Error(`closure: cannot resolve ${path}`)
	return candidate
}

const closure = new Set<string>()
const queue = [...ROOTS]
while (queue.length > 0) {
	const file = queue.pop() as string
	if (closure.has(file)) continue
	if (!existsSync(join(srcDir, file))) throw new Error(`closure: ${file} does not exist`)
	closure.add(file)
	if (/\.(vue|ts|css)$/.test(file)) queue.push(...relativeImports(file))
}

function keeps(file: string): boolean {
	if (file.endsWith(".stories.ts")) return false
	const subject = file.replace(/\.test\.ts$/, "")
	if (subject === file) return closure.has(file)
	return closure.has(`${subject}.vue`) || closure.has(`${subject}.ts`)
}

const dropped: string[] = []
for (const dir of COMPONENT_DIRS) {
	for (const name of readdirSync(join(srcDir, dir))) {
		if (keeps(`${dir}/${name}`)) continue
		rmSync(join(srcDir, dir, name))
		dropped.push(`${dir}/${name}`)
	}
	if (readdirSync(join(srcDir, dir)).length === 0) rmSync(join(srcDir, dir), { recursive: true })
}
const droppedComponents = new Set(dropped.filter((f) => f.endsWith(".vue")).map((f) => f.replace(/^.*\/|\.vue$/g, "")))

const importedComponent = (line: string) =>
	line.match(/\b(?:default as|import) (\w+)\b.*from "\.\/(?:core|ui|composite)\/\w+\.vue"/)?.[1] ?? ""
const mountCase = (line: string) => line.match(/^\t\["(\w+)", \1\b/)?.[1] ?? ""

/** Removes matching lines and any comment attached directly above one (not a section header after a blank line). */
function dropLines(file: string, drop: (line: string) => boolean, expected: number) {
	const path = join(srcDir, file)
	const kept: string[] = []
	let removed = 0
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!drop(line)) {
			kept.push(line)
			continue
		}
		removed++
		while (kept.length > 1 && /^\s*(\/\/|\/\*\*.*\*\/$)/.test(kept.at(-1) as string) && (kept.at(-2) as string).trim() !== "") {
			kept.pop()
		}
	}
	if (removed !== expected) throw new Error(`${file}: removed ${removed} line(s), expected ${expected}`)
	writeFileSync(path, kept.join("\n"))
}

const droppedIn = (file: string, pick: (line: string) => string) =>
	readFileSync(join(srcDir, file), "utf8").split("\n").filter((l) => droppedComponents.has(pick(l))).length
const indexEntries = droppedIn("index.ts", importedComponent)
const mountEntries = droppedIn("mount-all.test.ts", importedComponent) + droppedIn("mount-all.test.ts", mountCase)
if (indexEntries !== droppedComponents.size) throw new Error(`index.ts exports ${indexEntries} of ${droppedComponents.size} dropped components`)
dropLines("index.ts", (l) => droppedComponents.has(importedComponent(l)), indexEntries)
dropLines("mount-all.test.ts", (l) => droppedComponents.has(importedComponent(l)) || droppedComponents.has(mountCase(l)), mountEntries)

const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"))
for (const dir of COMPONENT_DIRS) {
	if (!existsSync(join(srcDir, dir))) delete manifest.exports[`./${dir}/*`]
}
writeFileSync(join(pkg, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`)

console.log(`design: kept ${[...closure].filter((f) => f.endsWith(".vue")).length} SFC(s), dropped ${dropped.length} file(s)`)
console.log(`  dropped components: ${[...droppedComponents].sort().join(" ")}`)
