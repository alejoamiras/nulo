import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import vectors from "../../implementations-plan/key-model-v2/reference/vectors.json"
import { PACKAGES, type PublishedPackage } from "./packages"
import { packageNameOf, REPO_ROOT, STAGING_MARKER, stagePackage } from "./stage"

// Nothing that loads @aztec/* runs in this process. Under `bun test` every module sees a bare
// `expect`, and @aztec/foundation calls `expect.addEqualityTesters` at load when it does; Bun's
// `expect` has no such method, and only a transpile cached by an earlier non-test run hides that.
// Such checks run in `bun` or `node` child processes instead (CHECK_SCRIPT, CROSS_SCRIPT).

const scratch = mkdtempSync(join(tmpdir(), "nulo-publish-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** Exactly what each tarball may contain; a stray file under dist/ would ship otherwise. */
const ALLOWED_FILES: Record<string, string[]> = {
	"wallet-crypto": [
		"dist/account-derivation.d.ts",
		"dist/encryption-key.d.ts",
		"dist/public.d.ts",
		"dist/public.js",
		"dist/secret-types.d.ts",
	],
	"resolve-asset": ["dist/index.d.ts", "dist/index.js"],
	"wallet-sdk-schema-patch": ["dist/apply.d.ts", "dist/apply.js", "dist/register.d.ts", "dist/register.js"],
}

/**
 * Every import each bundle keeps. `@aztec/*` and `zod` must stay bare: inlined Aztec code would still
 * pass the vectors while handing consumers a second `Fr` class that no identity check can see.
 */
const BUNDLE_IMPORTS: Record<string, string[]> = {
	"dist/public.js": ["@aztec/accounts/utils", "@aztec/foundation/crypto/sha512"],
	"dist/index.js": ["node:fs", "node:module", "node:path", "node:url"],
	"dist/apply.js": ["@aztec/stdlib/schemas", "zod"],
	"dist/register.js": ["./apply.js", "@aztec/aztec.js/wallet"],
}

/** A few times today's sizes, far below what an inlined `@aztec/*` module would add. */
const MAX_BUNDLE_BYTES: Record<string, number> = {
	"dist/public.js": 8192,
	"dist/index.js": 8192,
	"dist/apply.js": 6144,
	"dist/register.js": 1024,
}

interface Packed {
	pkg: PublishedPackage
	staged: string
	manifest: Record<string, unknown>
	tarball: string
	files: string[]
}

function run(cmd: string[], cwd: string): string {
	const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
	if (result.exitCode !== 0) throw new Error(`${cmd.join(" ")} exited ${result.exitCode}\n${result.stdout}${result.stderr}`)
	return result.stdout.toString()
}

async function stageAndPack(outRoot: string): Promise<Packed[]> {
	const packDir = join(outRoot, "tgz")
	mkdirSync(packDir, { recursive: true })
	const packed: Packed[] = []
	for (const pkg of PACKAGES) {
		const { path, manifest } = await stagePackage(pkg, "0.1.0", outRoot)
		const [info] = JSON.parse(run(["npm", "pack", path, "--pack-destination", packDir, "--json", "--ignore-scripts"], outRoot)) as {
			filename: string
			files: { path: string }[]
		}[]
		if (info === undefined) throw new Error(`npm pack printed nothing for ${pkg.dir}`)
		packed.push({ pkg, staged: path, manifest, tarball: join(packDir, info.filename), files: info.files.map((f) => f.path).sort() })
	}
	return packed
}

const sha256 = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")
const workspaceManifest = (dir: string) =>
	JSON.parse(readFileSync(join(REPO_ROOT, "packages", dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> }
const declaredBy = (manifest: Record<string, unknown>) => ({
	...((manifest.peerDependencies ?? {}) as Record<string, string>),
	...((manifest.dependencies ?? {}) as Record<string, string>),
})

/** What a consumer's install provides: each declared peer and dependency, as the workspace installed it, and nothing else. */
function declaredInstalls(packed: Packed[]): Map<string, string> {
	const links = new Map<string, string>()
	for (const { pkg, manifest } of packed) {
		for (const name of Object.keys(declaredBy(manifest))) {
			const target = realpathSync(join(REPO_ROOT, "packages", pkg.dir, "node_modules", name))
			const seen = links.get(name)
			if (seen !== undefined && seen !== target) throw new Error(`${name}: two installed copies, ${seen} and ${target}`)
			links.set(name, target)
		}
	}
	return links
}

/** A consumer project outside the workspace: the three tarballs unpacked, their peers linked from the installed tree. */
function buildFixture(packed: Packed[]): string {
	const fixture = join(scratch, "consumer")
	mkdirSync(join(fixture, "node_modules"), { recursive: true })
	writeFileSync(join(fixture, "package.json"), '{ "name": "consumer", "private": true, "type": "module" }\n')
	for (const { manifest, tarball } of packed) {
		const unpack = mkdtempSync(join(scratch, "unpack-"))
		run(["tar", "-xzf", tarball, "-C", unpack], scratch)
		const target = join(fixture, "node_modules", String(manifest.name))
		mkdirSync(dirname(target), { recursive: true })
		renameSync(join(unpack, "package"), target)
	}
	for (const [name, installed] of declaredInstalls(packed)) {
		const target = join(fixture, "node_modules", name)
		mkdirSync(dirname(target), { recursive: true })
		symlinkSync(installed, target)
	}
	writeFileSync(join(fixture, "check.mjs"), CHECK_SCRIPT)
	writeFileSync(join(fixture, "cross.mjs"), CROSS_SCRIPT)
	writeFileSync(join(fixture, "consumer.ts"), CONSUMER_TS)
	for (const [name, resolution] of [
		["nodenext", { module: "nodenext", moduleResolution: "nodenext" }],
		["bundler", { module: "esnext", moduleResolution: "bundler" }],
	] as const) {
		const compilerOptions = {
			...resolution,
			target: "es2022",
			lib: ["es2023", "dom"],
			types: [],
			strict: true,
			noEmit: true,
			skipLibCheck: true,
		}
		writeFileSync(join(fixture, `tsconfig.${name}.json`), JSON.stringify({ compilerOptions, files: ["consumer.ts"] }))
	}
	return fixture
}

/** Imports every export by package name and prints what it computed, under whichever runtime runs it. */
const CHECK_SCRIPT = `import { Fr } from "@aztec/foundation/curves/bn254"
import { WalletSchema } from "@aztec/aztec.js/wallet"
import { EncryptionKey, deriveNuloAccountKeys, deriveSigningKeyFromSeed } from "@alejoamiras/nulo-wallet-crypto"
import * as resolveAsset from "@alejoamiras/nulo-resolve-asset"
import { applyNuloSchemaPatch } from "@alejoamiras/nulo-wallet-sdk-schema-patch/apply"
import "@alejoamiras/nulo-wallet-sdk-schema-patch/register"

const out = { chain: [] }
for (const seed of JSON.parse(process.argv[2])) {
	const fr = Fr.fromHexString(seed)
	const { signingKey, secretKey } = await deriveNuloAccountKeys(fr)
	out.chain.push({ seed, signingKey: deriveSigningKeyFromSeed(fr).toString(), chainSigningKey: signingKey.toString(), secretKey: secretKey.toString() })
}
const key = await EncryptionKey.fromPassword("fixture")
out.roundTrip = new TextDecoder().decode(await key.decrypt(await key.encrypt(new TextEncoder().encode("sealed"))))
out.resolveAsset = Object.keys(resolveAsset).sort()
out.zodRoot = resolveAsset.resolvePackageRoot("zod", { from: import.meta.url })
const fresh = {}
applyNuloSchemaPatch(fresh)
out.patchKeys = Object.keys(fresh)
out.patched = out.patchKeys.filter((k) => k in WalletSchema)
applyNuloSchemaPatch(WalletSchema)
console.log(JSON.stringify(out))
process.exit(0)
`

/**
 * The wallet's sources beside the bundle: the methods the schema patch adds, and whether an
 * EncryptionKey ciphertext from either opens with the other to the exact bytes and is refused
 * under another AAD or with a flipped byte. Each check prints "ok" or its assertion message.
 */
const CROSS_SCRIPT = `import assert from "node:assert/strict"
import { EncryptionKey as Bundled } from "@alejoamiras/nulo-wallet-crypto"

const [encryptionKeySource, applySource] = process.argv.slice(2)
const { EncryptionKey: Source } = await import(encryptionKeySource)
const { applyNuloSchemaPatch } = await import(applySource)
const fresh = {}
applyNuloSchemaPatch(fresh)

const text = new TextEncoder()
const payload = text.encode("recovery secret")
const aad = text.encode("nulo:recovery:v1")
const otherAad = text.encode("nulo:other:v1")
const source = await Source.fromPassword("correct horse battery staple")
const bundle = await Bundled.fromPassword("correct horse battery staple")
const bySource = await source.encrypt(payload, aad)
const byBundle = await bundle.encrypt(payload, aad)
const tampered = bySource.slice()
tampered[tampered.length - 1] ^= 1

const checks = {}
const check = async (name, run) => {
	try {
		await run()
		checks[name] = "ok"
	} catch (error) {
		checks[name] = String(error?.message ?? error)
	}
}
await check("sourceToBundle", async () => assert.deepEqual(await bundle.decrypt(bySource, aad), payload))
await check("bundleToSource", async () => assert.deepEqual(await source.decrypt(byBundle, aad), payload))
for (const [who, key] of [["source", source], ["bundle", bundle]]) {
	await check(\`\${who} refuses another AAD\`, () => assert.rejects(key.decrypt(bySource, otherAad)))
	await check(\`\${who} refuses a flipped byte\`, () => assert.rejects(key.decrypt(tampered, aad)))
}
console.log(JSON.stringify({ patchKeys: Object.keys(fresh), checks }))
process.exit(0)
`

/** Every export used at its declared type. `IsAny` catches an export typed `any`; the lib-check run catches an unresolved import in a declaration. */
const CONSUMER_TS = `import type { Fr } from "@aztec/foundation/curves/bn254"
import type { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin"
import { EncryptionKey, deriveNuloAccountKeys, deriveSigningKeyFromSeed, type Passhash } from "@alejoamiras/nulo-wallet-crypto"
import {
	assertPackageIdentity,
	type IdentityReport,
	isUnderNodeModules,
	resolveExportedAsset,
	resolvePackageAsset,
	resolvePackageRoot,
} from "@alejoamiras/nulo-resolve-asset"
import { applyNuloSchemaPatch } from "@alejoamiras/nulo-wallet-sdk-schema-patch/apply"
import "@alejoamiras/nulo-wallet-sdk-schema-patch/register"
// @ts-expect-error internal modules stay behind the exports map
import "@alejoamiras/nulo-wallet-crypto/dist/secret-types.js"

type IsAny<T> = 0 extends 1 & T ? true : false
type NotAny<T extends false> = T
declare const seed: Fr
export const signingKey: GrumpkinScalar = deriveSigningKeyFromSeed(seed)
export const keys: Promise<{ signingKey: GrumpkinScalar; secretKey: Fr }> = deriveNuloAccountKeys(seed)
export const key: Promise<EncryptionKey> = EncryptionKey.fromPassword("pw")
export const passhash: Promise<Passhash> = EncryptionKey.getPasshash("pw")
export const sealed: Promise<Uint8Array<ArrayBuffer>> = key.then((k) => k.encrypt(new Uint8Array(1), new Uint8Array(1)))
export const root: string = resolvePackageRoot("zod", { from: import.meta.url })
export const asset: string = resolvePackageAsset("zod", "package.json", { from: import.meta.url })
export const exported: string = resolveExportedAsset("zod", "package.json", { from: import.meta.url })
export const report: IdentityReport = assertPackageIdentity("zod", { from: import.meta.url, expectVersion: "4.4.3" })
export const inside: boolean = isUnderNodeModules(root)
export const patch: (schema: object) => void = applyNuloSchemaPatch
export type Checks = [
	NotAny<IsAny<Fr>>,
	NotAny<IsAny<GrumpkinScalar>>,
	NotAny<IsAny<typeof deriveNuloAccountKeys>>,
	NotAny<IsAny<EncryptionKey>>,
	NotAny<IsAny<Passhash>>,
	NotAny<IsAny<IdentityReport>>,
	NotAny<IsAny<typeof resolvePackageRoot>>,
	NotAny<IsAny<typeof applyNuloSchemaPatch>>,
]
`

interface CrossCheck {
	patchKeys: string[]
	checks: Record<string, string>
}

let packed: Packed[] = []
let fixture = ""
let cross: CrossCheck

beforeAll(async () => {
	packed = await stageAndPack(join(scratch, "a"))
	fixture = buildFixture(packed)
	const sources = ["packages/wallet-crypto/src/encryption-key.ts", "packages/wallet-sdk-schema-patch/src/apply.ts"]
	const stdout = run([process.execPath, "cross.mjs", ...sources.map((s) => join(REPO_ROOT, s))], fixture)
	cross = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}")
}, 180_000)

const byDir = (dir: string) => {
	const hit = packed.find((p) => p.pkg.dir === dir)
	if (!hit) throw new Error(`not staged: ${dir}`)
	return hit
}

describe("staged packages", () => {
	test("each tarball holds exactly its bundle, declarations, manifest, README, LICENSE and NOTICE", () => {
		for (const { pkg, files } of packed) {
			expect(files).toEqual(["LICENSE", "NOTICE", "README.md", ...(ALLOWED_FILES[pkg.dir] ?? []), "package.json"].sort())
		}
	})

	test("bundles keep exactly their pinned imports, bare, with no node: import in browser code, under a size ceiling", () => {
		const transpiler = new Bun.Transpiler({ loader: "js" })
		for (const { staged, files } of packed) {
			for (const file of files.filter((f) => f.endsWith(".js"))) {
				const code = readFileSync(join(staged, file), "utf8")
				expect({
					file,
					imports: transpiler
						.scanImports(code)
						.map((i) => i.path)
						.sort(),
				}).toEqual({ file, imports: BUNDLE_IMPORTS[file] ?? [] })
				expect(code.length).toBeLessThan(MAX_BUNDLE_BYTES[file] ?? 0)
			}
		}
	})

	test("nothing shipped names a private @nulo/* package or a module outside packages/*/src", () => {
		for (const { staged, files } of packed) {
			for (const file of files) {
				const text = readFileSync(join(staged, file), "utf8")
				expect({ file, leak: text.includes("@nulo/") }).toEqual({ file, leak: false })
				if (!file.endsWith(".js")) continue
				for (const line of text.split("\n").filter((l) => /^\/\/ \S+\.ts$/.test(l))) {
					expect(line).toMatch(/^\/\/ packages\/[a-z0-9-]+\/src\/[\w./-]+\.ts$/)
				}
			}
		}
	})

	test("declarations import each other by an explicit .js path that the tarball holds", () => {
		for (const { staged, files } of packed) {
			for (const file of files.filter((f) => f.endsWith(".d.ts"))) {
				for (const [, spec] of readFileSync(join(staged, file), "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g)) {
					expect({ file, spec }).toEqual({ file, spec: spec?.endsWith(".js") ? spec : `${spec}.js` })
					expect(files).toContain(join(dirname(file), (spec ?? "").replace(/\.js$/, ".d.ts")))
				}
			}
		}
	})

	test("each manifest declares exactly the packages its shipped code and declarations import", () => {
		const transpiler = new Bun.Transpiler({ loader: "js" })
		for (const { pkg, staged, files, manifest } of packed) {
			const imported = new Set<string>()
			for (const file of files.filter((f) => f.startsWith("dist/"))) {
				const text = readFileSync(join(staged, file), "utf8")
				const specs = file.endsWith(".js")
					? transpiler.scanImports(text).map((i) => i.path)
					: [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1] ?? "")
				for (const spec of specs.filter((s) => !s.startsWith(".") && !s.startsWith("node:"))) imported.add(packageNameOf(spec))
			}
			expect({ pkg: pkg.dir, declared: Object.keys(declaredBy(manifest)).sort() }).toEqual({
				pkg: pkg.dir,
				declared: [...imported].sort(),
			})
		}
	})

	test("manifests: public, exact @aztec peers equal to the workspace pins, exports that exist, provenance required", () => {
		for (const { pkg, manifest, files } of packed) {
			expect(manifest).not.toHaveProperty("private")
			expect(manifest).not.toHaveProperty("scripts")
			expect(manifest).not.toHaveProperty("devDependencies")
			expect(manifest.publishConfig).toEqual({ access: "public", provenance: true })
			const pins = workspaceManifest(pkg.dir).dependencies ?? {}
			for (const [name, version] of Object.entries((manifest.peerDependencies ?? {}) as Record<string, string>)) {
				expect({ name, version }).toEqual({ name, version: pins[name] ?? "undeclared" })
				expect(version).toMatch(/^\d+\.\d+\.\d+$/)
			}
			for (const target of Object.values(manifest.exports as Record<string, Record<string, string>>).flatMap(Object.values)) {
				expect(files).toContain(target.replace(/^\.\//, ""))
			}
		}
		expect(byDir("wallet-crypto").manifest.peerDependencies).toEqual({ "@aztec/accounts": "5.2.0", "@aztec/foundation": "5.2.0" })
		expect(byDir("wallet-sdk-schema-patch").manifest.peerDependencies).toEqual({ "@aztec/aztec.js": "5.2.0", "@aztec/stdlib": "5.2.0" })
		expect(byDir("wallet-sdk-schema-patch").manifest.dependencies).toEqual({
			zod: workspaceManifest("wallet-sdk-schema-patch").dependencies?.zod,
		})
		expect(byDir("wallet-sdk-schema-patch").manifest.sideEffects).toEqual(["./dist/register.js"])
		expect(byDir("resolve-asset").manifest).not.toHaveProperty("peerDependencies")
	})

	test("the Azguard modification notice heads the bundle and the declaration derived from encryption-key.ts", () => {
		const notice = readFileSync(join(REPO_ROOT, "packages/wallet-crypto/src/encryption-key.ts"), "utf8").split("\n", 1)[0]
		expect(notice).toStartWith("// Modified from Azguard Wallet (")
		const { staged } = byDir("wallet-crypto")
		for (const file of ["dist/public.js", "dist/encryption-key.d.ts"]) {
			expect(readFileSync(join(staged, file), "utf8").split("\n", 1)[0]).toBe(notice)
		}
	})

	test("the schema-patch README documents every method the patch adds", () => {
		const readme = readFileSync(join(import.meta.dir, "readme/wallet-sdk-schema-patch.md"), "utf8")
		expect(cross.patchKeys.length).toBeGreaterThan(0)
		for (const key of cross.patchKeys) expect({ key, documented: readme.includes(`| \`${key}\` |`) }).toEqual({ key, documented: true })
	})

	test("staging is reproducible: a second run under a stricter umask packs byte-identical tarballs", async () => {
		const umask = process.umask(0o077)
		let again: Packed[]
		try {
			again = await stageAndPack(join(scratch, "b"))
		} finally {
			process.umask(umask)
		}
		expect(again.map((p) => sha256(p.tarball))).toEqual(packed.map((p) => sha256(p.tarball)))
	}, 120_000)

	test("staging replaces only a directory it created, and nothing in the repository outside dist-publish/", async () => {
		const { pkg } = byDir("resolve-asset")
		const victim = join(scratch, "victim", pkg.dir)
		mkdirSync(victim, { recursive: true })
		writeFileSync(join(victim, "sentinel"), "keep")
		await expect(stagePackage(pkg, "0.1.0", dirname(victim))).rejects.toThrow(/did not create it/)
		expect(readFileSync(join(victim, "sentinel"), "utf8")).toBe("keep")

		// Marked as a staging directory, so only the in-repository rule can refuse it, even through a symlink.
		const inRepo = mkdtempSync(join(REPO_ROOT, ".stage-guard-"))
		const link = join(mkdtempSync(join(scratch, "link-")), "link")
		try {
			mkdirSync(join(inRepo, pkg.dir))
			writeFileSync(join(inRepo, pkg.dir, STAGING_MARKER), "")
			writeFileSync(join(inRepo, pkg.dir, "sentinel"), "keep")
			symlinkSync(inRepo, link)
			await expect(stagePackage(pkg, "0.1.0", link)).rejects.toThrow(/only dist-publish/)
			expect(readFileSync(join(inRepo, pkg.dir, "sentinel"), "utf8")).toBe("keep")
		} finally {
			rmSync(inRepo, { recursive: true, force: true })
		}
	})

	test("staging refuses to run outside the repository root", async () => {
		const cwd = process.cwd()
		process.chdir(scratch)
		try {
			await expect(stagePackage(byDir("resolve-asset").pkg, "0.1.0", join(scratch, "c"))).rejects.toThrow(/repository root/)
		} finally {
			process.chdir(cwd)
		}
	})
})

describe("an out-of-workspace consumer of the tarballs", () => {
	const seeds = vectors.signingChain.map((v) => v.seed)
	const expectRuntime = (stdout: string) => {
		const out = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}")
		expect(out.chain).toEqual(
			vectors.signingChain.map((v) => ({
				seed: v.seed,
				signingKey: v.signingKey,
				chainSigningKey: v.signingKey,
				secretKey: v.secretKey,
			})),
		)
		expect(out.roundTrip).toBe("sealed")
		expect(out.resolveAsset).toEqual([
			"assertPackageIdentity",
			"isUnderNodeModules",
			"resolveExportedAsset",
			"resolvePackageAsset",
			"resolvePackageRoot",
		])
		expect(realpathSync(out.zodRoot)).toBe(realpathSync(join(fixture, "node_modules/zod")))
		expect(out.patchKeys).toEqual(cross.patchKeys)
		expect(out.patched).toEqual(cross.patchKeys)
	}

	test("imports every export under Bun and reproduces the key-derivation vectors", () => {
		expectRuntime(run([process.execPath, "check.mjs", JSON.stringify(seeds)], fixture))
	}, 120_000)

	test("imports every export under Node 24 ESM and reproduces the key-derivation vectors", () => {
		const major = Number(run(["node", "--version"], fixture).trim().replace(/^v/, "").split(".")[0])
		expect(major).toBeGreaterThanOrEqual(24)
		expectRuntime(run(["node", "check.mjs", JSON.stringify(seeds)], fixture))
	}, 120_000)

	const tsc = join(REPO_ROOT, "packages/wallet-crypto/node_modules/typescript/bin/tsc")

	test("type-checks against the declarations under NodeNext and Bundler resolution", () => {
		for (const config of ["tsconfig.nodenext.json", "tsconfig.bundler.json"]) {
			run([process.execPath, tsc, "-p", config], fixture)
		}
	}, 120_000)

	// @aztec's own declarations fail a lib check (`Buffer`, an untyped `util`), so the run is red
	// overall; what must hold is that none of its diagnostics sits in a published declaration.
	test("with the lib check on, no diagnostic falls inside the published declarations", () => {
		for (const config of ["tsconfig.nodenext.json", "tsconfig.bundler.json"]) {
			const result = Bun.spawnSync([process.execPath, tsc, "-p", config, "--skipLibCheck", "false", "--pretty", "false"], {
				cwd: fixture,
				stdout: "pipe",
				stderr: "pipe",
			})
			const headers = `${result.stdout}${result.stderr}`.split("\n").filter((l) => l !== "" && !/^\s/.test(l))
			for (const line of headers) expect(line).toMatch(/^\S.*\(\d+,\d+\): error TS\d+: /)
			expect({ config, published: headers.filter((l) => l.includes("node_modules/@alejoamiras/")) }).toEqual({
				config,
				published: [],
			})
		}
	}, 120_000)
})

describe("EncryptionKey: the bundle and the wallet's source read each other's ciphertexts", () => {
	test("sealed by either opens with the other to the exact payload bytes", () => {
		expect({ sourceToBundle: cross.checks.sourceToBundle, bundleToSource: cross.checks.bundleToSource }).toEqual({
			sourceToBundle: "ok",
			bundleToSource: "ok",
		})
	})

	test("both refuse a different AAD and a flipped ciphertext byte", () => {
		const refusals = Object.fromEntries(Object.entries(cross.checks).filter(([name]) => name.includes(" refuses ")))
		expect(refusals).toEqual({
			"source refuses another AAD": "ok",
			"source refuses a flipped byte": "ok",
			"bundle refuses another AAD": "ok",
			"bundle refuses a flipped byte": "ok",
		})
	})
})
