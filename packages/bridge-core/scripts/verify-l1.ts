/**
 * Verifies the bridge's L1 sources on Sepolia Etherscan.
 *
 * Two contracts, two compile roots:
 * - MintableERC20 - our own foundry project (packages/bridge-evm); forge reconstructs the
 *   standard-json from the same foundry.toml that produced the deployed bytecode.
 * - TokenPortal - deployed from @aztec/l1-artifacts' PRECOMPILED bytecode. The npm package
 *   ships the full l1-contracts foundry project EXCEPT the compilation target itself
 *   (test/portals/TokenPortal.sol is pruned), so the source is vendored at
 *   packages/bridge-evm/upstream/TokenPortal.sol and keccak-checked against the artifact
 *   metadata before every run - a hash mismatch means an Aztec bump changed the portal and
 *   the vendored copy must be re-fetched from the matching aztec-packages tag.
 *
 * Requires ETHERSCAN_API_KEY (bun auto-loads packages/bridge-core/.env). Pass --dry-run to
 * build + print source-graph stats without submitting (no key needed).
 */

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem"

const here = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(here, "..", "..", "faucet", "public", "testnet-bridge.json")
const EVM_ROOT = join(here, "..", "..", "bridge-evm")
const L1_ARTIFACTS_ROOT = join(dirname(createRequire(import.meta.url).resolve("@aztec/l1-artifacts/package.json")), "l1-contracts")
const PORTAL_SOURCE_REL = join("test", "portals", "TokenPortal.sol")
const VENDORED_PORTAL = join(EVM_ROOT, "upstream", "TokenPortal.sol")
const CHAIN_ID = "11155111"

const dryRun = process.argv.includes("--dry-run")
const apiKey = process.env.ETHERSCAN_API_KEY
if (!dryRun && !apiKey) {
	console.error("ETHERSCAN_API_KEY is not set - add it to packages/bridge-core/.env (or use --dry-run).")
	process.exit(1)
}

function forgeBin(): string {
	if (process.env.FORGE_BIN) return process.env.FORGE_BIN
	const probe = spawnSync("forge", ["--version"], { stdio: "ignore" })
	if (probe.status === 0) return "forge"
	const aztec = join(homedir(), ".aztec", "current", "bin", "forge")
	if (existsSync(aztec)) return aztec
	console.error("forge not found - install foundry or set FORGE_BIN.")
	process.exit(1)
}

/** The vendored portal source must hash-match what the deployed artifact was compiled from. */
function placePortalSource() {
	const artifact = JSON.parse(readFileSync(join(L1_ARTIFACTS_ROOT, "out", "TokenPortal.sol", "TokenPortal.json"), "utf8"))
	const expected = JSON.parse(artifact.rawMetadata).sources["test/portals/TokenPortal.sol"].keccak256
	const got = keccak256(readFileSync(VENDORED_PORTAL))
	if (got !== expected) {
		console.error(
			`vendored TokenPortal.sol hash mismatch (have ${got}, artifact says ${expected}) - ` +
				"an Aztec bump changed the portal; re-fetch l1-contracts/test/portals/TokenPortal.sol from the matching aztec-packages tag.",
		)
		process.exit(1)
	}
	const dest = join(L1_ARTIFACTS_ROOT, PORTAL_SOURCE_REL)
	mkdirSync(dirname(dest), { recursive: true })
	copyFileSync(VENDORED_PORTAL, dest)
}

function runForge(root: string, label: string, args: string[]): boolean {
	// The shipped artifacts were built with each project's default profile.
	const { FOUNDRY_PROFILE: _omitted, ...env } = process.env
	const res = spawnSync(forgeBin(), args, { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
	const out = `${res.stdout ?? ""}${res.stderr ?? ""}`
	if (dryRun) {
		try {
			const json = JSON.parse(res.stdout)
			const n = Object.keys(json.sources ?? {}).length
			console.log(`✓ ${label}: standard-json builds (${n} sources, solc settings from foundry.toml)`)
			return true
		} catch {
			console.error(`✗ ${label}: could not build standard-json input:\n${out.slice(0, 2000)}`)
			return false
		}
	}
	if (res.status === 0 || /already verified/i.test(out)) {
		console.log(out.trim())
		console.log(`✓ ${label} verified`)
		return true
	}
	console.error(`✗ ${label} verification failed:\n${out.slice(0, 4000)}`)
	return false
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
const token = config.l1.token
if (!token) {
	console.error("testnet-bridge.json has no l1.token constructor record - redeploy or backfill it.")
	process.exit(1)
}
const tokenArgs = encodeAbiParameters(parseAbiParameters("string, string, uint8, uint256"), [
	token.name,
	token.symbol,
	token.decimals,
	BigInt(token.maxWholePerTx),
])

placePortalSource()

const common = dryRun
	? ["--chain-id", CHAIN_ID, "--show-standard-json-input"]
	: ["--chain-id", CHAIN_ID, "--etherscan-api-key", apiKey as string, "--watch"]

const okToken = runForge(EVM_ROOT, `MintableERC20 @ ${config.l1.usdc}`, [
	"verify-contract",
	config.l1.usdc,
	"src/MintableERC20.sol:MintableERC20",
	"--constructor-args",
	tokenArgs,
	...common,
])
const okPortal = runForge(L1_ARTIFACTS_ROOT, `TokenPortal @ ${config.l1.portal}`, [
	"verify-contract",
	config.l1.portal,
	"test/portals/TokenPortal.sol:TokenPortal",
	...common,
])

// The fuel arc's contracts (our own foundry project; args mirror DeployFuelLive.s.sol).
const fuel = config.l1.fuel
let okFuel = true
if (fuel) {
	const swapArgs = encodeAbiParameters(parseAbiParameters("address, address, address"), [fuel.poolManager, fuel.feeJuice, fuel.weth])
	const routerArgs = encodeAbiParameters(parseAbiParameters("address, address, address"), [
		fuel.permit2,
		fuel.feeJuicePortal,
		fuel.swapTarget,
	])
	const okSwap = runForge(EVM_ROOT, `UniswapFuelSwap @ ${fuel.swapTarget}`, [
		"verify-contract",
		fuel.swapTarget,
		"src/UniswapFuelSwap.sol:UniswapFuelSwap",
		"--constructor-args",
		swapArgs,
		...common,
	])
	const okRouter = runForge(EVM_ROOT, `SwapBridgeRouter @ ${fuel.router}`, [
		"verify-contract",
		fuel.router,
		"src/SwapBridgeRouter.sol:SwapBridgeRouter",
		"--constructor-args",
		routerArgs,
		...common,
	])
	okFuel = okSwap && okRouter
}

if (!dryRun && okToken && okPortal && okFuel) {
	console.log(`\nhttps://sepolia.etherscan.io/address/${config.l1.usdc}#code`)
	console.log(`https://sepolia.etherscan.io/address/${config.l1.portal}#code`)
	if (fuel) {
		console.log(`https://sepolia.etherscan.io/address/${fuel.swapTarget}#code`)
		console.log(`https://sepolia.etherscan.io/address/${fuel.router}#code`)
	}
}
process.exit(okToken && okPortal && okFuel ? 0 : 1)
