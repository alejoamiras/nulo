/**
 * Verifies the bridge's L1 sources on Etherscan — the chain comes from the manifest's `l1ChainId`
 * (Sepolia for testnet, Ethereum for mainnet; a manifest that omits it falls back to Sepolia).
 *
 * Two compile roots:
 * - MintableERC20 - our own foundry project (contracts/bridge/evm); forge reconstructs the
 *   standard-json from the same foundry.toml that produced the deployed bytecode. A `circle-proxy`
 *   token (reused official USDC) is NOT source-verified here — its identity is pinned at deploy.
 * - the portal - compiled from source in the l1-contracts root (the npm package ships the full
 *   foundry project EXCEPT the target source, which is why the fork is vendored under
 *   contracts/bridge/evm/upstream/ and staged in). Only the F-001 fork NuloTokenPortal is
 *   verifiable: pre-fork manifests, which carried no `l1.portalSource`, verified a vendored copy
 *   of Aztec's canonical TokenPortal that no longer exists here, so their portals can no longer be
 *   re-verified from this repo.
 *
 * Requires ETHERSCAN_API_KEY (bun auto-loads packages/bridge-core/.env). Pass --dry-run to build +
 * print source-graph stats without submitting (no key needed). Pass --config <path> to verify a
 * candidate manifest instead of the live testnet-bridge.json.
 */

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { encodeAbiParameters, parseAbiParameters } from "viem"
import { parseCandidateManifest } from "../src/candidate-schema"
import { assertEffectiveRemapping, generateRemappings } from "./gen-remappings"
import { forgeBin, stageForkSource } from "./portal-artifact"
import { run } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
const configArg = process.argv.indexOf("--config")
const CONFIG_PATH =
	configArg !== -1
		? (process.argv[configArg + 1] as string)
		: join(here, "..", "..", "..", "apps", "tools", "public", "testnet-bridge.json")
const EVM_ROOT = join(here, "..", "..", "..", "contracts", "bridge", "evm")
const L1_ARTIFACTS_ROOT = join(dirname(createRequire(import.meta.url).resolve("@aztec/l1-artifacts/package.json")), "l1-contracts")

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

// The EVM root's @aztec/ remap must point at the installed l1-artifacts sources
// regardless of node_modules layout: regenerate remappings.txt (gitignored,
// overrides foundry.toml) and assert forge actually sees the mapping before
// any build/verify runs against EVM_ROOT.
generateRemappings()
assertEffectiveRemapping(forge())

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
	// Forge short-circuits on a contract Etherscan already holds a verification for, without
	// compiling or submitting the staged source — so that outcome says nothing about whether the
	// source here still matches the deployed bytes. Label it as what it is instead of the same ✓.
	if (/already verified/i.test(out)) {
		console.log(`— ${label}: Etherscan already holds a verification; the staged source was not checked against it`)
		return true
	}
	if (res.exitCode === 0) {
		console.log(out.trim())
		console.log(`✓ ${label} verified`)
		return true
	}
	console.error(`✗ ${label} verification failed:\n${out.slice(0, 4000)}`)
	return false
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
// Every value handed to forge comes from this file, so it must clear the strict schema first — which
// also rejects any manifest whose portalSource is not `forked-v1`, the only portal still verifiable
// from this repo.
try {
	parseCandidateManifest(config)
} catch (e) {
	fail(e instanceof Error ? e.message : String(e))
}
const token = config.l1.token

// The chain comes from the manifest (self-declared identity), not a hardcoded Sepolia — a mainnet
// manifest verifies on Ethereum. The field is optional, so a manifest omitting it falls back.
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

// The F-001 fork is verified from the l1-root, staged there under its self-pinned source hash.
stageForkSource(L1_ARTIFACTS_ROOT)

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
const portalTarget = "test/portals/NuloTokenPortal.sol:NuloTokenPortal"
const okPortal = runForge(L1_ARTIFACTS_ROOT, `NuloTokenPortal @ ${config.l1.portal}`, [
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
