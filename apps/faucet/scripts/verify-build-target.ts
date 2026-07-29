/**
 * Post-build gate (D20 / codex round-3): prove the built artifact IS the target it claims to be, using
 * the digest EMITTED in the artifact's own build.json (not a recomputed one). Run per target in CI
 * after `build:<target>`; catches a build that shipped the wrong manifest or was built with the wrong
 * config. Offline — no network.
 *
 *   bun run scripts/verify-build-target.ts <testnet|mainnet>
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type FaucetTargetKey, TARGETS } from "../src/lib/network-targets"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, "..")

const key = (process.argv[2] || process.env.FAUCET_TARGET || "testnet") as FaucetTargetKey
const target = TARGETS[key]
if (!target) throw new Error(`verify-build-target: unknown target "${key}" (expected testnet | mainnet)`)

const build = JSON.parse(readFileSync(join(appRoot, "dist", "build.json"), "utf8")) as {
	target?: string
	chainId?: number
	manifestDigest?: string
}
const manifest = readFileSync(join(appRoot, "public", target.manifestFile), "utf8")
const digest = createHash("sha256").update(manifest).digest("hex")

const problems: string[] = []
if (build.target !== key) problems.push(`build.json target=${build.target} != ${key}`)
if (build.chainId !== target.walletChainId) problems.push(`build.json chainId=${build.chainId} != ${target.walletChainId}`)
if (build.manifestDigest !== digest) {
	problems.push(`build.json manifestDigest=${build.manifestDigest} != sha256(${target.manifestFile})=${digest}`)
}

if (problems.length > 0) {
	console.error(`✗ build-target verification FAILED for ${key}:\n  ${problems.join("\n  ")}`)
	process.exit(1)
}
console.log(`✓ build.json matches target ${key} (chainId ${build.chainId}; ${target.manifestFile} digest verified)`)
