import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import vectors from "../../implementations-plan/key-model-v2/reference/vectors.json"
import { EncryptionKey as SourceEncryptionKey } from "../../packages/wallet-crypto/src/encryption-key"
import { PACKAGES, type PublishedPackage } from "./packages"
import { REPO_ROOT, stagePackage } from "./stage"

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

/** The workspace each peer and dependency is installed under: the fixture links that installed copy. */
const INSTALLED_FROM: Record<string, string> = {
	"@aztec/accounts": "wallet-crypto",
	"@aztec/foundation": "wallet-crypto",
	"@aztec/aztec.js": "wallet-sdk-schema-patch",
	"@aztec/stdlib": "wallet-sdk-schema-patch",
	zod: "wallet-sdk-schema-patch",
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
	for (const [name, dir] of Object.entries(INSTALLED_FROM)) {
		const target = join(fixture, "node_modules", name)
		mkdirSync(dirname(target), { recursive: true })
		symlinkSync(realpathSync(join(REPO_ROOT, "packages", dir, "node_modules", name)), target)
	}
	writeFileSync(join(fixture, "check.mjs"), CHECK_SCRIPT)
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
out.patched = ["registerToken", "isTokenRegistered", "grantPublicAuthwit", "getWalletFeatures"].filter((k) => k in WalletSchema)
applyNuloSchemaPatch(WalletSchema)
console.log(JSON.stringify(out))
process.exit(0)
`

/** Every export used at its declared type; \`IsAny\` catches a declaration whose import failed to resolve. */
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

let packed: Packed[] = []
let fixture = ""

beforeAll(async () => {
	packed = await stageAndPack(join(scratch, "a"))
	fixture = buildFixture(packed)
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

	// A consumer's own lib check (skipLibCheck: false) reports extensionless relative imports in
	// declarations under NodeNext (TS2834); the fixture cannot run one, since @aztec's declarations fail it.
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

	test("staging is reproducible: a second run packs byte-identical tarballs", async () => {
		const again = await stageAndPack(join(scratch, "b"))
		expect(again.map((p) => sha256(p.tarball))).toEqual(packed.map((p) => sha256(p.tarball)))
	}, 120_000)

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
		expect(out.patched).toEqual(["registerToken", "isTokenRegistered", "grantPublicAuthwit", "getWalletFeatures"])
	}

	test("imports every export under Bun and reproduces the key-derivation vectors", () => {
		expectRuntime(run([process.execPath, "check.mjs", JSON.stringify(seeds)], fixture))
	}, 120_000)

	test("imports every export under Node 24 ESM and reproduces the key-derivation vectors", () => {
		const major = Number(run(["node", "--version"], fixture).trim().replace(/^v/, "").split(".")[0])
		expect(major).toBeGreaterThanOrEqual(24)
		expectRuntime(run(["node", "check.mjs", JSON.stringify(seeds)], fixture))
	}, 120_000)

	test("type-checks against the declarations under NodeNext and Bundler resolution", () => {
		const tsc = join(REPO_ROOT, "packages/wallet-crypto/node_modules/typescript/bin/tsc")
		for (const config of ["tsconfig.nodenext.json", "tsconfig.bundler.json"]) {
			run([process.execPath, tsc, "-p", config], fixture)
		}
	}, 120_000)
})

describe("EncryptionKey: the bundle and the wallet's source read each other's ciphertexts", () => {
	const password = "correct horse battery staple"
	const aad = new TextEncoder().encode("nulo:recovery:v1")
	const payload = new TextEncoder().encode("recovery secret")
	const bundled = async () =>
		(await import(Bun.resolveSync("@alejoamiras/nulo-wallet-crypto", fixture))) as { EncryptionKey: typeof SourceEncryptionKey }

	test("sealed by the source opens with the bundle, and the reverse", async () => {
		const { EncryptionKey: Bundled } = await bundled()
		const source = await SourceEncryptionKey.fromPassword(password)
		const bundle = await Bundled.fromPassword(password)
		expect(await bundle.decrypt(await source.encrypt(payload, aad), aad)).toEqual(payload)
		expect(await source.decrypt(await bundle.encrypt(payload, aad), aad)).toEqual(payload)
	}, 60_000)

	test("both reject a different AAD and a flipped ciphertext byte", async () => {
		const { EncryptionKey: Bundled } = await bundled()
		const source = await SourceEncryptionKey.fromPassword(password)
		const bundle = await Bundled.fromPassword(password)
		const sealed = await source.encrypt(payload, aad)
		const tampered = sealed.slice()
		tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1
		for (const key of [source, bundle]) {
			await expect(key.decrypt(sealed, new TextEncoder().encode("nulo:other:v1"))).rejects.toThrow()
			await expect(key.decrypt(tampered, aad)).rejects.toThrow()
		}
	}, 60_000)
})
