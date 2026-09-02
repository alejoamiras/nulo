/**
 * Mainnet swap-fuel discovery (READ-ONLY — eth_call only, no key, no spend). Mainnet does not
 * SEED pools like testnet; it DISCOVERS the canonical Uniswap V4 liquidity the fuel route rides
 * (D23). This script is that discovery step, run before the Phase-8 deploy and re-run by the
 * conductor to fail closed on drift:
 *
 *   1. verifies the doc-pinned V4 addresses answer on-chain (code + a live quote through them),
 *   2. verifies the token identities (Circle USDC, WETH9, the fee asset) and the
 *      portal.UNDERLYING() == fee-asset binding,
 *   3. sweeps the standard fee tiers for BOTH route legs — USDC/WETH and, critically,
 *      NATIVE-ETH/feeAsset: the router's route shape is fixed (token → WETH, unwrap, ETH → FJ),
 *      so a world with only WETH-paired fee-asset liquidity CANNOT serve it. That outcome is
 *      reported explicitly, never papered over.
 *   4. proves each viable route with the app's own quoteFuelPath (dust + 1 + 25 USDC), and
 *      prints the winning manifest `swap` block.
 *
 *   bun scripts/discover-mainnet-fuel.ts            # ETH_RPC_URL overrides the default RPC
 */
import { http, createPublicClient, defineChain, encodeAbiParameters, keccak256, parseAbiParameters } from "viem"
import { quoteFuelPath } from "../src/quote"
import { buildFuelRoute } from "../src/route"

// ── Doc-pinned canonical addresses (docs.uniswap.org/contracts/v4/deployments, 2026-07-27).
// Pins are the starting claim; the on-chain checks below are the authority.
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90" as const
const V4_QUOTER = "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203" as const
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const
const CIRCLE_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const
// The live Aztec pair (same defaults as DeployBridgeMainnet.s.sol; env-overridable there).
const FEE_JUICE_PORTAL = "0xaf73Dd51D1eb8a079BB097f39c832cDD00ac691c" as const
const FEE_JUICE_ASSET = "0xA27EC0006e59f245217Ff08CD52A7E8b169E62D2" as const

const NATIVE = "0x0000000000000000000000000000000000000000" as const
const FEE_TIERS: Array<{ fee: number; tickSpacing: number }> = [
	{ fee: 100, tickSpacing: 1 },
	{ fee: 500, tickSpacing: 10 },
	{ fee: 3000, tickSpacing: 60 },
	{ fee: 10000, tickSpacing: 200 },
]

const RPC = process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com"
const mainnet = defineChain({
	id: 1,
	name: "ethereum",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [RPC] } },
})
const pub = createPublicClient({ chain: mainnet, transport: http(RPC) })

const ERC20_META_ABI = [
	{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
	{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const
const PORTAL_ABI = [{ type: "function", name: "UNDERLYING", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const
const EXTSLOAD_ABI = [
	{ type: "function", name: "extsload", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes32" }] },
] as const

function poolId(c0: `0x${string}`, c1: `0x${string}`, fee: number, tickSpacing: number): `0x${string}` {
	return keccak256(
		encodeAbiParameters(parseAbiParameters("address, address, uint24, int24, address"), [c0, c1, fee, tickSpacing, NATIVE]),
	)
}

/** slot0 sqrtPriceX96 via PoolManager.extsload of the pool's state slot (StateLibrary layout). */
async function sqrtPriceOf(id: `0x${string}`): Promise<bigint> {
	const stateSlot = keccak256(`0x${id.slice(2)}${"0".repeat(63)}6` as `0x${string}`)
	const raw = await pub.readContract({ address: POOL_MANAGER, abi: EXTSLOAD_ABI, functionName: "extsload", args: [stateSlot] })
	return BigInt(raw) & ((1n << 160n) - 1n)
}

async function requireCode(name: string, addr: `0x${string}`): Promise<void> {
	const code = await pub.getCode({ address: addr })
	if (!code || code === "0x") throw new Error(`${name} has NO CODE at ${addr} — doc pin wrong or wrong chain; STOP`)
	console.log(`✓ ${name} has code (${addr})`)
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: accepted at 87 lines — one evidence transcript links identity checks, pool discovery, quotations and the winning manifest block
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: accepted at score 32 — the nested fee-tier cross-product and failed-quote reporting are the discovery matrix
async function main(): Promise<void> {
	const chainId = await pub.getChainId()
	if (chainId !== 1) throw new Error(`connected chain id ${chainId} != 1 (Ethereum mainnet); STOP`)

	// 1. Doc pins answer on-chain.
	for (const [name, addr] of [
		["PoolManager", POOL_MANAGER],
		["V4Quoter", V4_QUOTER],
		["WETH9", WETH],
		["Circle USDC", CIRCLE_USDC],
		["FeeJuicePortal", FEE_JUICE_PORTAL],
		["FeeJuiceAsset", FEE_JUICE_ASSET],
	] as const) {
		await requireCode(name, addr)
	}

	// 2. Token identities + the portal binding.
	const [usdcSym, usdcDec, wethSym, fjSym, fjDec, underlying] = await Promise.all([
		pub.readContract({ address: CIRCLE_USDC, abi: ERC20_META_ABI, functionName: "symbol" }),
		pub.readContract({ address: CIRCLE_USDC, abi: ERC20_META_ABI, functionName: "decimals" }),
		pub.readContract({ address: WETH, abi: ERC20_META_ABI, functionName: "symbol" }),
		pub.readContract({ address: FEE_JUICE_ASSET, abi: ERC20_META_ABI, functionName: "symbol" }),
		pub.readContract({ address: FEE_JUICE_ASSET, abi: ERC20_META_ABI, functionName: "decimals" }),
		pub.readContract({ address: FEE_JUICE_PORTAL, abi: PORTAL_ABI, functionName: "UNDERLYING" }),
	])
	if (usdcSym !== "USDC" || usdcDec !== 6) throw new Error(`USDC identity mismatch: ${usdcSym}/${usdcDec}; STOP`)
	if (wethSym !== "WETH") throw new Error(`WETH identity mismatch: ${wethSym}; STOP`)
	if (fjDec !== 18) throw new Error(`fee asset decimals ${fjDec} != 18; STOP`)
	if (underlying.toLowerCase() !== FEE_JUICE_ASSET.toLowerCase())
		throw new Error(`portal UNDERLYING ${underlying} != fee asset ${FEE_JUICE_ASSET}; STOP`)
	console.log(`✓ identities — USDC/6, WETH, fee asset ${fjSym}/18, portal UNDERLYING matches`)

	// 3. Fee-tier sweep on both route legs (plus the WETH-paired diagnostic for the fee asset).
	const legs = [
		{ label: "USDC/WETH", c0: CIRCLE_USDC, c1: WETH },
		{ label: "ETH(native)/feeAsset", c0: NATIVE, c1: FEE_JUICE_ASSET },
		{ label: "WETH/feeAsset (diagnostic only — the fixed route CANNOT use it)", c0: FEE_JUICE_ASSET, c1: WETH },
	] as const
	const initialized: Record<string, Array<{ fee: number; tickSpacing: number; sqrtPriceX96: bigint }>> = {}
	for (const leg of legs) {
		initialized[leg.label] = []
		for (const t of FEE_TIERS) {
			const price = await sqrtPriceOf(poolId(leg.c0, leg.c1, t.fee, t.tickSpacing))
			if (price > 0n) {
				initialized[leg.label].push({ ...t, sqrtPriceX96: price })
				console.log(`  ${leg.label} fee ${t.fee}/${t.tickSpacing}: INITIALIZED (sqrtPriceX96 ${price})`)
			}
		}
		if (initialized[leg.label].length === 0) console.log(`  ${leg.label}: no initialized pool on the standard tiers`)
	}

	const usdcWethTiers = initialized["USDC/WETH"]
	const ethFjTiers = initialized["ETH(native)/feeAsset"]
	if (usdcWethTiers.length === 0) throw new Error("no USDC/WETH V4 pool on the standard fee tiers; STOP")
	if (ethFjTiers.length === 0)
		throw new Error(
			"no NATIVE-ETH/feeAsset V4 pool on the standard fee tiers — the fixed route (unwrap → native hop) cannot run; " +
				"if only WETH-paired fee-asset liquidity exists this needs a swap-target change, not a pin change; STOP",
		)

	// 4. Prove each viable combination with the app's own quote path; initialized ≠ liquid, so a
	//    zero/failed quote here disqualifies the pair (quoter probes are the ground truth).
	const DUST = 10_000n // 0.01 USDC
	const ONE = 1_000_000n
	const TWENTY_FIVE = 25_000_000n
	type Winner = { tokenWeth: { fee: number; tickSpacing: number }; ethFj: { fee: number; tickSpacing: number }; out1: bigint }
	let winner: Winner | null = null
	for (const tw of usdcWethTiers) {
		for (const ef of ethFjTiers) {
			const route = buildFuelRoute({
				token: CIRCLE_USDC,
				weth: WETH,
				feeJuice: FEE_JUICE_ASSET,
				tokenWeth: { fee: tw.fee, tickSpacing: tw.tickSpacing },
				ethFj: { fee: ef.fee, tickSpacing: ef.tickSpacing },
			})
			const label = `USDC/WETH ${tw.fee} → ETH/${fjSym} ${ef.fee}`
			try {
				const outDust = await quoteFuelPath(pub as never, V4_QUOTER, route, DUST)
				const out1 = await quoteFuelPath(pub as never, V4_QUOTER, route, ONE)
				const out25 = await quoteFuelPath(pub as never, V4_QUOTER, route, TWENTY_FIVE)
				const impact25 = (1 - Number(out25) / 25 / Number(out1)) * 100
				console.log(
					`  route ${label}: 1 USDC → ${(Number(out1) / 1e18).toFixed(4)} ${fjSym} | ` +
						`dust ok (${outDust} wei) | 25 USDC impact vs 1: ${impact25.toFixed(2)}%`,
				)
				if (!winner || out1 > winner.out1)
					winner = {
						tokenWeth: { fee: tw.fee, tickSpacing: tw.tickSpacing },
						ethFj: { fee: ef.fee, tickSpacing: ef.tickSpacing },
						out1,
					}
			} catch (e) {
				console.log(`  route ${label}: NOT viable — ${e instanceof Error ? e.message : e}`)
			}
		}
	}
	if (!winner) throw new Error("no viable quoted route across the initialized tiers; STOP")

	console.log("\n── winning manifest swap block (slippage/minFuelFj set at the Phase-8 gate) ──")
	console.log(
		JSON.stringify(
			{
				poolManager: POOL_MANAGER,
				quoter: V4_QUOTER,
				weth: WETH,
				feeJuice: FEE_JUICE_ASSET,
				pools: { tokenWeth: winner.tokenWeth, ethFj: winner.ethFj },
			},
			null,
			2,
		),
	)
	console.log(`\n1 USDC → ${(Number(winner.out1) / 1e18).toFixed(4)} ${fjSym} on the winning route`)
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e)
	process.exit(1)
})
