/**
 * Writes unleashed's root configuration into <repo> from the freeze tree: verbatim copies plus a
 * few edits. Each edit asserts the exact freeze content it removes, so a freeze tree that has
 * drifted fails here instead of yielding a silently different bootstrap commit.
 *
 *   bun bootstrap/build.ts <freeze-dir> <repo>
 */
import { chmodSync, cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const [freeze, repo] = process.argv.slice(2)
if (!freeze || !repo) throw new Error("usage: bun bootstrap/build.ts <freeze-dir> <repo>")

const VERBATIM = [
	"LICENSE",
	".editorconfig",
	".gitattributes",
	".commitlintrc.json",
	"bunfig.toml",
	"vitest.base.ts",
	"patches",
	".githooks",
	"scripts/complexity-baseline",
	"scripts/check-no-local-paths.sh",
	"scripts/ci-cd/behavior-gating.test.ts",
	"scripts/ci-cd/required-checks.ts",
	"scripts/ci-cd/required-checks.sh",
	"scripts/ci-cd/required-checks.test.ts",
	".github/actions/setup-bun",
]

const DROPPED_SCRIPTS = [
	"dev",
	"dev:playground",
	"dev:landing",
	"build",
	"build:chrome",
	"build:firefox",
	"test",
	"test:e2e",
	"test:e2e:network",
	"test:e2e:all",
	"e2e:agent",
	"e2e:reap",
	"typecheck",
	"test:release",
	"audit:dup",
	"audit:vue",
]

const DROPPED_GITIGNORE = [
	"# Storybook build output (M6 phase 2)",
	"storybook-static/",
	"apps/extension/src/external/*",
	"# E2E test generated config",
	"apps/extension/tests/e2e/.test-config.json",
	"# E2E parallel-agent state (port pack, ownership lockfile, child logs)",
	"apps/extension/.e2e-state/",
]

const DROPPED_BIOME_FILES = [
	"infra/**",
	"scripts/ci-cd/test-soak/**",
	"!**/apps/extension/src/types",
	"!**/packages/aztec-runtime/src/account/artifacts",
]

const WALLET_ONLY_OVERRIDE = /^(apps\/extension\/|packages\/(wallet-core|wallet-crypto|extension-messaging|aztec-runtime|wallet-bridge)\/)/

// The rest of nulo's SECURITY.md is wallet, Renovate and presto policy; unleashed's own lands with its docs.
const SECURITY_SECTIONS = ["## Reporting a vulnerability"]

const src = (path: string) => join(freeze, path)
const dst = (path: string) => join(repo, path)
const read = (path: string) => readFileSync(src(path), "utf8")

function write(path: string, text: string, mode?: number) {
	mkdirSync(dirname(dst(path)), { recursive: true })
	writeFileSync(dst(path), text)
	if (mode !== undefined) chmodSync(dst(path), mode)
}

function mustRemove<T>(list: T[], item: T, what: string): T[] {
	if (!list.includes(item)) throw new Error(`${what}: expected ${JSON.stringify(item)} in the freeze tree`)
	return list.filter((x) => x !== item)
}

function copyVerbatim() {
	for (const path of VERBATIM) {
		mkdirSync(dirname(dst(path)), { recursive: true })
		cpSync(src(path), dst(path), { recursive: true, preserveTimestamps: false })
		if (statSync(src(path)).isFile()) chmodSync(dst(path), statSync(src(path)).mode & 0o777)
	}
	for (const hook of ["pre-commit", "commit-msg"]) chmodSync(dst(`.githooks/${hook}`), 0o755)
	chmodSync(dst("scripts/check-no-local-paths.sh"), 0o755)
	chmodSync(dst("scripts/ci-cd/required-checks.sh"), 0o755)
}

function packageJson() {
	const pkg = JSON.parse(read("package.json"))
	let workspaces: string[] = pkg.workspaces
	workspaces = mustRemove(workspaces, "infra/*", "workspaces")
	for (const name of DROPPED_SCRIPTS) {
		if (!(name in pkg.scripts)) throw new Error(`package.json: expected script ${name} in the freeze tree`)
		delete pkg.scripts[name]
	}
	const out = {
		name: "unleashed",
		private: true,
		workspaces,
		scripts: pkg.scripts,
		devDependencies: pkg.devDependencies,
		packageManager: pkg.packageManager,
		license: pkg.license,
		overrides: pkg.overrides,
		patchedDependencies: pkg.patchedDependencies,
	}
	write("package.json", `${JSON.stringify(out, null, "\t")}\n`)
}

function tsconfig() {
	const ts = JSON.parse(read("tsconfig.json"))
	const refs = ts.references.map((r: { path: string }) => r.path)
	if (JSON.stringify(refs) !== JSON.stringify(["apps/extension", "apps/playground", "apps/landing", "apps/tools"])) {
		throw new Error(`tsconfig.json: unexpected references ${JSON.stringify(refs)}`)
	}
	write("tsconfig.json", `${JSON.stringify({ files: [], references: [{ path: "apps/tools" }] }, null, "\t")}\n`)
}

function gitignore() {
	let lines = read(".gitignore").split("\n")
	for (const line of DROPPED_GITIGNORE) lines = mustRemove(lines, line, ".gitignore")
	write(".gitignore", `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`)
}

function biome() {
	const config = JSON.parse(read("biome.json"))
	for (const glob of DROPPED_BIOME_FILES) config.files.includes = mustRemove(config.files.includes, glob, "biome.json files")
	const before = config.overrides.length
	config.overrides = config.overrides.filter(
		(o: { includes: string[] }) => !o.includes.every((g) => WALLET_ONLY_OVERRIDE.test(g.replace(/^!/, ""))),
	)
	if (before - config.overrides.length !== 9) throw new Error(`biome.json: dropped ${before - config.overrides.length} overrides, expected 9`)
	if (config.vcs.defaultBranch !== "dev") throw new Error("biome.json: expected vcs.defaultBranch dev")
	config.vcs.defaultBranch = "main"
	write("biome.json", `${JSON.stringify(config, null, "\t")}\n`)
}

function notice() {
	const text = read("NOTICE")
	if (!text.startsWith("Nulo\n")) throw new Error("NOTICE: expected the product line 'Nulo'")
	if (!text.includes("derived from Azguard Wallet")) throw new Error("NOTICE: the Azguard attribution is missing")
	write("NOTICE", `unleashed\n${text.slice("Nulo\n".length)}`)
}

function security() {
	const text = read("SECURITY.md")
	const starts = SECURITY_SECTIONS.map((heading) => {
		const at = text.indexOf(`\n${heading}\n`)
		if (at < 0) throw new Error(`SECURITY.md: missing section ${heading}`)
		return at + 1
	})
	const sections = starts.map((start) => {
		const next = text.indexOf("\n## ", start + 3)
		return text.slice(start, next < 0 ? undefined : next + 1).trimEnd()
	})
	write("SECURITY.md", `# Security\n\n${sections.join("\n\n")}\n`)
}

function setupAztec() {
	const path = ".github/actions/setup-aztec/action.yml"
	const text = read(path)
	const count = text.split("apps/extension").length - 1
	if (count !== 4) throw new Error(`${path}: expected 4 apps/extension references, found ${count}`)
	write(path, text.replaceAll("apps/extension", "apps/tools"))
}

copyVerbatim()
packageJson()
tsconfig()
gitignore()
biome()
notice()
security()
setupAztec()
