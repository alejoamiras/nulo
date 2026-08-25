/**
 * Verifies the bridge's L1 sources on Etherscan — the chain comes from the manifest's `l1ChainId`
 * (Sepolia for testnet, Ethereum for mainnet; legacy manifests fall back to Sepolia).
 *
 * Two contracts, two compile roots:
 * - MintableERC20 - our own foundry project (contracts/bridge/evm); forge reconstructs the
 *   standard-json from the same foundry.toml that produced the deployed bytecode. A `circle-proxy`
 *   token (reused official USDC) is NOT source-verified here — its identity is pinned at deploy.
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

import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem"
import { evmAddress, parseCandidateManifest } from "../src/candidate-schema"
import { assertEffectiveRemapping, generateRemappings } from "./gen-remappings"
import { forgeBin, stageForkSource } from "./portal-artifact"
import { run } from "./run"

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

const dryRun = process.argv.includes("--dry-run")
const apiKey = process.env.ETHERSCAN_API_KEY
if (!dryRun && !apiKey) {
	console.error("ETHERSCAN_API_KEY is not set - add it to packages/bridge-core/.env (or use --dry-run).")
	process.exit(1)
}

function fail(message: string): never {
	console.error(message)
	process.exit(1)
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {})

/** A legacy (pre-`forked-v1`) manifest skips the strict schema; only the values forge receives are checked. */
function requireLegacyForgeInputs(raw: unknown): void {
	const l1 = obj(obj(raw).l1)
	const fuel = obj(l1.fuel)
	const core = obj(fuel.core)
	const swap = obj(fuel.swap)
	const addresses: Array<[string, unknown]> = [
		["l1.usdc", l1.usdc],
		["l1.portal", l1.portal],
		...(fuel.core
			? ([
					["l1.fuel.core.router", core.router],
					["l1.fuel.core.permit2", core.permit2],
					["l1.fuel.core.feeJuicePortal", core.feeJuicePortal],
					["l1.fuel.core.swapTarget", core.swapTarget],
				] as Array<[string, unknown]>)
			: []),
		...(fuel.swap
			? ([
					["l1.fuel.swap.poolManager", swap.poolManager],
					["l1.fuel.swap.feeJuice", swap.feeJuice],
					["l1.fuel.swap.weth", swap.weth],
				] as Array<[string, unknown]>)
			: []),
	]
	for (const [path, value] of addresses) {
		if (!evmAddress.safeParse(value).success) fail(`bridge manifest ${path} is not a 20-byte 0x address: ${JSON.stringify(value)}`)
	}
	const contract = obj(l1.token).sourceContract
	if (contract !== undefined && contract !== "MintableERC20" && contract !== "TestUsdc") {
		fail(`bridge manifest l1.token.sourceContract must be MintableERC20 or TestUsdc: ${JSON.stringify(contract)}`)
	}
	const chainId = obj(raw).l1ChainId
	if (chainId !== undefined && !(Number.isInteger(chainId) && (chainId as number) > 0)) {
		fail(`bridge manifest l1ChainId must be a positive integer when present: ${JSON.stringify(chainId)}`)
	}
}

// The EVM root's @aztec/ remap must point at the installed l1-artifacts sources
// regardless of node_modules layout: regenerate remappings.txt (gitignored,
// overrides foundry.toml) and assert forge actually sees the mapping before
// any build/verify runs against EVM_ROOT.
generateRemappings()
assertEffectiveRemapping(forge())

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

function forge(): string {
	try {
		return forgeBin()
	} catch (e) {
		return fail(e instanceof Error ? e.message : String(e))
	}
}

function runForge(root: string, label: string, args: string[]): boolean {
	// The shipped artifacts were built with each project's default profile.
	const { FOUNDRY_PROFILE: _omitted, ...env } = process.env
	const res = run(forge(), args, { cwd: root, env, maxBuffer: 64 * 1024 * 1024, check: false })
	const out = `${res.stdout}${res.stderr}`
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
	if (res.exitCode === 0 || /already verified/i.test(out)) {
		console.log(out.trim())
		console.log(`✓ ${label} verified`)
		return true
	}
	console.error(`✗ ${label} verification failed:\n${out.slice(0, 4000)}`)
	return false
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
// Every value handed to forge comes from this file: a `forked-v1` manifest must pass the strict
// schema, an older one is checked on exactly the fields that reach forge.
if (obj(obj(config).l1).portalSource === "forked-v1") {
	try {
		parseCandidateManifest(config)
	} catch (e) {
		fail(e instanceof Error ? e.message : String(e))
	}
} else {
	requireLegacyForgeInputs(config)
}
const token = config.l1.token
if (!token) {
	console.error("bridge manifest has no l1.token constructor record - redeploy or backfill it.")
	process.exit(1)
}

// The chain comes from the manifest (self-declared identity), not a hardcoded Sepolia — a mainnet
// manifest verifies on Ethereum. Legacy manifests without l1ChainId fall back to Sepolia.
const CHAIN_ID = String(config.l1ChainId ?? 11155111)
const EXPLORER_BASE = CHAIN_ID === "1" ? "https://etherscan.io" : "https://sepolia.etherscan.io"

// A `circle-proxy` token is NOT our contract: no maxWholePerTx, no MintableERC20 source to verify
// (Circle's proxy is already Etherscan-verified). Its IDENTITY (address == the canonical Circle USDC
// + code readback) is pinned in the deploy/reuse path, not here. Only OUR permissionless-mint token
// gets source-verified.
const ownToken = token.source !== "circle-proxy"
const tokenArgs = ownToken
	? encodeAbiParameters(parseAbiParameters("string, string, uint8, uint256"), [
			token.name,
			token.symbol,
			token.decimals,
			BigInt(token.maxWholePerTx),
		])
	: null

// `forked-v1` (the F-001 security fork) verifies NuloTokenPortal from the l1-root with a self-pinned
// source hash; a legacy/absent marker verifies the canonical TokenPortal against the artifact metadata.
const forkedPortal = config.l1.portalSource === "forked-v1"
if (forkedPortal) stageForkSource(L1_ARTIFACTS_ROOT)
else placePortalSource()

const common = dryRun
	? ["--chain-id", CHAIN_ID, "--show-standard-json-input"]
	: ["--chain-id", CHAIN_ID, "--etherscan-api-key", apiKey as string, "--watch"]

let okToken = true
if (ownToken && tokenArgs) {
	// Which of OUR mintable contracts this deployment used: the legacy auto-Permit2 MintableERC20
	// (default) or the DP7 TestUsdc (no auto-allowance — the post-cutover testnet token). Both share
	// the same constructor shape, so tokenArgs applies to either.
	const tokenContract = (token.sourceContract as string | undefined) ?? "MintableERC20"
	okToken = runForge(EVM_ROOT, `${tokenContract} @ ${config.l1.usdc}`, [
		"verify-contract",
		config.l1.usdc,
		`src/${tokenContract}.sol:${tokenContract}`,
		"--constructor-args",
		tokenArgs,
		...common,
	])
} else {
	console.log(`— token @ ${config.l1.usdc} is circle-proxy (reused official USDC): source-verify skipped; identity pinned at deploy`)
}
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
	// The swapTarget's SOURCE comes from the RECORDED core.swapTargetContract — swap-absence does NOT
	// imply the inert stub (a token cutover carries the AZLO-era UniswapFuelSwap, whose constructor
	// args live in the DROPPED swap block and cannot be reconstructed here). Recorded InertSwapTarget
	// verifies (no args); a legacy/carried target is an EXPLICIT skip — its source was verified in its
	// original arc, and live-intent's swapTarget-equality readback still binds the address.
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
	} else if (core.swapTargetContract === "InertSwapTarget") {
		okSwap = runForge(EVM_ROOT, `InertSwapTarget @ ${core.swapTarget}`, [
			"verify-contract",
			core.swapTarget,
			"src/InertSwapTarget.sol:InertSwapTarget",
			...common,
		])
	} else {
		console.log(
			`— swapTarget @ ${core.swapTarget} is ${core.swapTargetContract ?? "a legacy carried target"}: source-verify skipped ` +
				"(constructor args live in the dropped swap block; verified in its original arc; equality readback still binds it)",
		)
	}
	okFuel = okRouter && okSwap
}

if (!dryRun && okToken && okPortal && okFuel) {
	console.log(`\n${EXPLORER_BASE}/address/${config.l1.usdc}#code`)
	console.log(`${EXPLORER_BASE}/address/${config.l1.portal}#code`)
	if (fuel) {
		console.log(`${EXPLORER_BASE}/address/${fuel.core.swapTarget}#code`)
		console.log(`${EXPLORER_BASE}/address/${fuel.core.router}#code`)
	}
}
process.exit(okToken && okPortal && okFuel ? 0 : 1)
