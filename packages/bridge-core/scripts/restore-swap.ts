/**
 * The "pools seeded ⇒ restore the swap block" pipeline step (the second half of a token cutover
 * that keeps swap-fuel). Builds `testnet-bridge.candidate.json` = the LIVE manifest + a `swap`
 * block, and REFUSES to write it unless the route is provably alive on-chain:
 *   1. the token/WETH pool's slot0 is initialized (StateLibrary via the PoolManager),
 *   2. the ETH/FeeJuice pool's slot0 is initialized (the token-independent leg carries across
 *      token generations),
 *   3. a REAL quoter probe of a dust amount along the exact route (token → WETH → ETH → FJ)
 *      returns a non-zero output — the same call the app's quote path makes.
 *
 * The carried swap fields (poolManager/quoter/weth/feeJuice/ethFj/slippage/minFuelFj) come from an
 * explicit --from <git-ref> read of the PRE-cutover committed manifest — never hand-typed. The new
 * token/WETH pool params come from --pool-fee/--pool-tick-spacing (what SeedTokenPool.s.sol seeded).
 *
 *   bun scripts/restore-swap.ts --from <ref-with-swap> --pool-fee 3000 --pool-tick-spacing 60
 *
 * Promote afterwards with:  live-intent.ts promote <intent> --bridge-only --restore-swap
 * (minFuelFj carries from the old arc — recalibrate via fuel-testnet.ts when convenient.)
 */
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { http, createPublicClient, defineChain, keccak256, encodeAbiParameters, parseAbiParameters } from "viem"
import { parseCandidateManifest } from "../src/candidate-schema"
import { quoteFuelPath } from "../src/quote"
import { buildFuelRoute } from "../src/route"
import { writeCandidateAtomic } from "./deploy-manifest"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const LIVE = join(repoRoot, "apps", "faucet", "public", "testnet-bridge.json")
const CANDIDATE = join(repoRoot, "apps", "faucet", "public", "testnet-bridge.candidate.json")

const argOf = (flag: string): string | undefined => {
	const i = process.argv.indexOf(flag)
	return i !== -1 ? process.argv[i + 1] : undefined
}
const fromRef = argOf("--from")
if (!fromRef) throw new Error("pass --from <git ref whose testnet-bridge.json carries the swap block to restore>")
const poolFee = Number(argOf("--pool-fee") ?? 3000)
const poolTickSpacing = Number(argOf("--pool-tick-spacing") ?? 60)

const sepolia = defineChain({
	id: 11155111,
	name: "sepolia",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SEPOLIA_RPC] } },
})
const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })

/** V4 poolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)). */
function poolId(c0: `0x${string}`, c1: `0x${string}`, fee: number, tickSpacing: number): `0x${string}` {
	return keccak256(
		encodeAbiParameters(parseAbiParameters("address, address, uint24, int24, address"), [
			c0,
			c1,
			fee,
			tickSpacing,
			"0x0000000000000000000000000000000000000000",
		]),
	)
}

const POOL_MANAGER_ABI = [
	{
		type: "function",
		name: "extsload",
		stateMutability: "view",
		inputs: [{ type: "bytes32" }],
		outputs: [{ type: "bytes32" }],
	},
] as const

/** slot0 sqrtPriceX96 via PoolManager.extsload of the pool's state slot (StateLibrary layout). */
async function sqrtPriceOf(poolManager: `0x${string}`, id: `0x${string}`): Promise<bigint> {
	// _getPoolStateSlot: keccak256(abi.encodePacked(poolId, POOLS_SLOT=bytes32(uint(6))))
	const stateSlot = keccak256(`0x${id.slice(2)}${"0".repeat(63)}6` as `0x${string}`)
	const raw = (await pub.readContract({
		address: poolManager,
		abi: POOL_MANAGER_ABI,
		functionName: "extsload",
		args: [stateSlot],
	})) as `0x${string}`
	// slot0 packs sqrtPriceX96 in the lowest 160 bits.
	return BigInt(raw) & ((1n << 160n) - 1n)
}

async function main(): Promise<void> {
	const live = parseCandidateManifest(JSON.parse(readFileSync(LIVE, "utf8")))
	if (live.l1.fuel?.swap) throw new Error("live manifest already has a swap block — nothing to restore; STOP")
	if (!live.l1.fuel?.core) throw new Error("live manifest has no fuel.core — wrong starting state; STOP")

	// The carried swap config comes from the COMMITTED pre-cutover manifest — never hand-typed.
	const prior = parseCandidateManifest(
		JSON.parse(execSync(`git show ${fromRef}:apps/faucet/public/testnet-bridge.json`, { cwd: repoRoot, encoding: "utf8" })),
	)
	const priorSwap = prior.l1.fuel?.swap
	if (!priorSwap) throw new Error(`--from ${fromRef} manifest has no swap block; STOP`)
	const ethFj = priorSwap.pools.ethFj
	if (!ethFj) throw new Error("prior swap block has no ethFj pool; STOP")

	const token = live.l1.usdc as `0x${string}`
	const weth = priorSwap.weth as `0x${string}`
	const feeJuice = priorSwap.feeJuice as `0x${string}`
	const poolManager = priorSwap.poolManager as `0x${string}`
	if (!(token.toLowerCase() < weth.toLowerCase())) throw new Error("token must sort below WETH (currency0); STOP")

	// 1+2. Both pool legs must be INITIALIZED on-chain.
	const tokenWethId = poolId(token, weth, poolFee, poolTickSpacing)
	const tokenWethPrice = await sqrtPriceOf(poolManager, tokenWethId)
	if (tokenWethPrice === 0n)
		throw new Error(
			`token/WETH pool (fee ${poolFee}, spacing ${poolTickSpacing}) NOT initialized — seed it first (SeedTokenPool.s.sol); STOP`,
		)
	const ethFjId = poolId("0x0000000000000000000000000000000000000000", feeJuice, ethFj.fee, ethFj.tickSpacing)
	const ethFjPrice = await sqrtPriceOf(poolManager, ethFjId)
	if (ethFjPrice === 0n) throw new Error("ETH/FeeJuice pool NOT initialized — the carried leg is dead; STOP")
	console.log(`✓ pools initialized — token/WETH sqrtPrice ${tokenWethPrice}, ETH/FJ sqrtPrice ${ethFjPrice}`)

	// 3. A REAL dust-quote along the exact app route — the strongest liveness proof.
	const route = buildFuelRoute({
		token,
		weth,
		feeJuice,
		tokenWeth: { fee: poolFee, tickSpacing: poolTickSpacing },
		ethFj: { fee: ethFj.fee, tickSpacing: ethFj.tickSpacing },
	})
	const dust = 10n ** BigInt(Math.max(0, live.l1.token.decimals - 2)) // 0.01 token
	const quoted = await quoteFuelPath(pub as never, priorSwap.quoter as `0x${string}`, route, dust)
	if (quoted <= 0n) throw new Error("quoter returned zero for a dust probe — route not viable; STOP")
	console.log(`✓ route quotes: ${dust} token-units → ${quoted} FJ-wei`)

	const candidate = {
		...live,
		l1: {
			...live.l1,
			fuel: {
				core: live.l1.fuel.core,
				swap: {
					poolManager: priorSwap.poolManager,
					quoter: priorSwap.quoter,
					weth: priorSwap.weth,
					feeJuice: priorSwap.feeJuice,
					pools: {
						tokenWeth: { fee: poolFee, tickSpacing: poolTickSpacing },
						ethFj: { fee: ethFj.fee, tickSpacing: ethFj.tickSpacing },
					},
					slippageBps: priorSwap.slippageBps,
					// Carried from the prior arc; recalibrate via fuel-testnet.ts when convenient.
					minFuelFj: priorSwap.minFuelFj,
				},
			},
		},
	}
	writeCandidateAtomic(CANDIDATE, candidate as never)
	console.log(`✓ candidate written: ${CANDIDATE} (live + restored swap) — smoke it, then promote --bridge-only --restore-swap`)
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e)
	process.exit(1)
})
