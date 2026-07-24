/**
 * Verifies the bridge's L1 sources on Sepolia Etherscan.
 *
 * Two contracts, two compile roots:
 * - MintableERC20 - our own foundry project (contracts/bridge/evm); forge reconstructs the
 *   standard-json from the same foundry.toml that produced the deployed bytecode.
 * - the portal - compiled from source in the l1-contracts root (the npm package ships the full
 *   foundry project EXCEPT the target source). A `l1.portalSource: "forked-v1"` config verifies the
 *   F-001 fork NuloTokenPortal, staged + self-pinned by source keccak (see portal-artifact.ts);
 *   otherwise the canonical TokenPortal is verified, keccak-checked against the artifact metadata.
 *   Both sources are vendored under contracts/bridge/evm/upstream/.
 *
 * Requires ETHERSCAN_API_KEY (bun auto-loads packages/bridge-core/.env). Pass --dry-run to build +
 * print source-graph stats without submitting (no key needed). Pass --config <path> to verify a
 * candidate manifest instead of the live testnet-bridge.json.
 */

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem"
import { stageForkSource } from "./portal-artifact"

const here = dirname(fileURLToPath(import.meta.url))
const configArg = process.argv.indexOf("--config")
const CONFIG_PATH =
	configArg !== -1
		? (process.argv[configArg + 1] as string)
		: join(here, "..", "..", "..", "apps", "faucet", "public", "testnet-bridge.json")
const EVM_ROOT = join(here, "..", "..", "..", "contracts", "bridge", "evm")
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

// `forked-v1` (the F-001 security fork) verifies NuloTokenPortal from the l1-root with a self-pinned
// source hash; a legacy/absent marker verifies the canonical TokenPortal against the artifact metadata.
const forkedPortal = config.l1.portalSource === "forked-v1"
if (forkedPortal) stageForkSource(L1_ARTIFACTS_ROOT)
else placePortalSource()

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
const portalTarget = forkedPortal ? "test/portals/NuloTokenPortal.sol:NuloTokenPortal" : "test/portals/TokenPortal.sol:TokenPortal"
const okPortal = runForge(L1_ARTIFACTS_ROOT, `${forkedPortal ? "NuloTokenPortal" : "TokenPortal"} @ ${config.l1.portal}`, [
	"verify-contract",
	config.l1.portal,
	portalTarget,
	...common,
])

// The fuel arc's contracts (our own foundry project; args mirror DeployFuelLive.s.sol).
const fuel = config.l1.fuel
let okFuel = true
if (fuel) {
	const core = fuel.core
	const routerArgs = encodeAbiParameters(parseAbiParameters("address, address, address"), [
		core.permit2,
		core.feeJuicePortal,
		core.swapTarget,
	])
	const okRouter = runForge(EVM_ROOT, `SwapBridgeRouter @ ${core.router}`, [
		"verify-contract",
		core.router,
		"src/SwapBridgeRouter.sol:SwapBridgeRouter",
		"--constructor-args",
		routerArgs,
		...common,
	])
	// UniswapFuelSwap is verified ONLY when the swap stack is present (testnet). A bridge-only mainnet
	// deployment ships an INERT swapTarget stub (its bytecode/revert behaviour is verified in Phase 7/8),
	// not UniswapFuelSwap — so verifying it here would be wrong.
	let okSwap = true
	if (fuel.swap) {
		const swap = fuel.swap
		const swapArgs = encodeAbiParameters(parseAbiParameters("address, address, address"), [swap.poolManager, swap.feeJuice, swap.weth])
		okSwap = runForge(EVM_ROOT, `UniswapFuelSwap @ ${core.swapTarget}`, [
			"verify-contract",
			core.swapTarget,
			"src/UniswapFuelSwap.sol:UniswapFuelSwap",
			"--constructor-args",
			swapArgs,
			...common,
		])
	}
	okFuel = okRouter && okSwap
}

if (!dryRun && okToken && okPortal && okFuel) {
	console.log(`\nhttps://sepolia.etherscan.io/address/${config.l1.usdc}#code`)
	console.log(`https://sepolia.etherscan.io/address/${config.l1.portal}#code`)
	if (fuel) {
		console.log(`https://sepolia.etherscan.io/address/${fuel.core.swapTarget}#code`)
		console.log(`https://sepolia.etherscan.io/address/${fuel.core.router}#code`)
	}
}
process.exit(okToken && okPortal && okFuel ? 0 : 1)
