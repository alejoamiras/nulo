/**
 * L1-side helpers shared by the operator scripts: the minimal ERC20 ABI, the read-back
 * assertion, the portal/router preflights both deploy conductors run, and the app-exact
 * router deposit (Permit2 approve + witness-bound bridge()) the smoke gates prove.
 */
import { Fr } from "@aztec/aztec.js/fields"
import { type Abi, getContract } from "viem"
import { runRouterDeposit } from "../src/flows"
import { ensurePermit2Allowance } from "../src/l1"
import { SWAP_BRIDGE_ROUTER_ABI } from "../src/router-abi"

/** Minimal ERC20 surface the scripts touch. A superset per consumer is harmless — viem only
 *  encodes the functions actually called. */
export const ERC20_MIN_ABI = [
	{ type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
	{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
	{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
	{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
	{
		type: "function",
		name: "allowance",
		stateMutability: "view",
		inputs: [{ type: "address" }, { type: "address" }],
		outputs: [{ type: "uint256" }],
	},
	{
		type: "function",
		name: "approve",
		stateMutability: "nonpayable",
		inputs: [{ type: "address" }, { type: "uint256" }],
		outputs: [{ type: "bool" }],
	},
] as const

export const lc = (v: unknown) => String(v).toLowerCase()

/** Case-insensitive read-back assert: abort the run on any mismatch, log the ✓ otherwise. */
export function assertSame(actual: unknown, expected: unknown, label: string): void {
	if (lc(actual) !== lc(expected)) throw new Error(`read-back FAILED: ${label} - on-chain ${lc(actual)} != expected ${lc(expected)}`)
	console.log(`  ✓ ${label}`)
}

/** The F-004 witness-shape gate both deploy conductors run: the router must bind swapTarget
 *  into its Permit2 witness (a pre-B2 router would reject the wallet's signature AND leave
 *  F-004/F-006 unshipped) and its bound swapTarget must match the expected one. */
export async function assertRouterWitnessShape(
	pub: unknown,
	router: `0x${string}`,
	expectedSwapTarget: string,
	preB2Hint: string,
): Promise<void> {
	const routerR = getContract({
		address: router,
		abi: [
			{ type: "function", name: "swapTarget", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
			{ type: "function", name: "BRIDGE_WITNESS_TYPE_STRING", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
		] as Abi,
		client: pub as never,
	})
	// biome-ignore lint/suspicious/noExplicitAny: viem typing collapses over an untyped client
	const rr = (routerR as any).read
	assertSame(await rr.swapTarget(), expectedSwapTarget, "router.swapTarget")
	if (!((await rr.BRIDGE_WITNESS_TYPE_STRING()) as string).includes("swapTarget")) {
		throw new Error(preB2Hint)
	}
}

/** Wrong-key preflight both conductors run before portal.initialize: read the pinned
 *  initializer back and compare BEFORE broadcasting. Without it a resume under a different
 *  key discovers the mismatch only as a NotInitializer revert, after gas is spent and
 *  mid-way through a one-shot sequence. */
export async function assertPortalInitializerPinned(
	pub: unknown,
	portal: `0x${string}`,
	portalAbi: Abi,
	broadcaster: string,
): Promise<void> {
	const portalPre = getContract({ address: portal, abi: portalAbi, client: pub as never })
	// biome-ignore lint/suspicious/noExplicitAny: viem typing collapses over an untyped client
	const pinnedInitializer = String(await (portalPre as any).read.initializer())
	if (pinnedInitializer.toLowerCase() !== broadcaster.toLowerCase()) {
		throw new Error(
			`portal initializer is ${pinnedInitializer} but this run broadcasts from ${broadcaster} — ` +
				"resume with the key that deployed the portal; initialize is pinned to it and there is no rescue path.",
		)
	}
}

/** Retry a bridge() whose REVERT is the transient Inbox-subtree-full case (seen live:
 *  back-to-back deposits in one ~36s slot; identical calldata succeeded next block). Waits
 *  one Aztec slot between attempts; a persistent revert still fails the run. */
export async function retryOnRevert<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await fn()
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			if (i >= tries || !/REVERTED/.test(msg)) throw e
			console.log(`bridge() reverted (attempt ${i}/${tries}) — waiting one Aztec slot and retrying: ${msg.slice(0, 120)}`)
			await new Promise((r) => setTimeout(r, 45_000))
		}
	}
}

export interface RouterDepositEnv {
	pub: unknown
	wallet: unknown
	account: { address: `0x${string}` }
}

export interface RouterDepositParams {
	usdc: `0x${string}`
	usdcAbi: unknown
	core: { router: `0x${string}`; permit2: `0x${string}`; swapTarget: `0x${string}` }
	portal: `0x${string}`
	amount: bigint
	recipient: string
	isPrivate: boolean
	claimSalt?: Fr
	chainId: number
	mins: () => string
}

/**
 * The app's ONLY deposit path, end to end: one-time Permit2 max-approve when the token needs
 * it (MintableERC20 short-circuits; TestUsdc/real USDC start at zero), then the witness-bound
 * router bridge(). Returns the claim value (PRIVATE: the salt in = the value out; PUBLIC: the
 * flow's own random secret) + leaf index for the L2 claim.
 */
/** One-time Permit2 max-approve when the token needs it (MintableERC20 short-circuits;
 *  TestUsdc/real USDC start at zero) — the app's exact allowance dance. */
export async function ensureRouterPermit2(
	env: RouterDepositEnv,
	p: { usdc: `0x${string}`; usdcAbi: unknown; permit2: `0x${string}`; needed: bigint; mins: () => string },
): Promise<void> {
	const { pub, wallet, account } = env as { pub: never; wallet: never; account: { address: `0x${string}` } }
	await ensurePermit2Allowance({
		allowance: async () =>
			(await (pub as { readContract: (a: unknown) => Promise<unknown> }).readContract({
				address: p.usdc,
				abi: p.usdcAbi as never,
				functionName: "allowance",
				args: [account.address, p.permit2],
			})) as bigint,
		approveMax: async () =>
			await (wallet as { writeContract: (a: unknown) => Promise<`0x${string}`> }).writeContract({
				address: p.usdc,
				abi: p.usdcAbi as never,
				functionName: "approve",
				args: [p.permit2, (1n << 256n) - 1n] as never,
			}),
		waitReceipt: async (hash) =>
			await (pub as { waitForTransactionReceipt: (a: unknown) => Promise<never> }).waitForTransactionReceipt({ hash }),
		needed: p.needed,
		onStatus: (st, tx) => console.log(`permit2 approval: ${st}${tx ? ` (${tx})` : ""} (${p.mins()})`),
	})
}

export async function depositViaRouter(env: RouterDepositEnv, p: RouterDepositParams): Promise<{ claimValue: Fr; leafIndex: bigint }> {
	const { pub, wallet, account } = env as { pub: never; wallet: never; account: { address: `0x${string}` } }
	await ensureRouterPermit2(env, { usdc: p.usdc, usdcAbi: p.usdcAbi, permit2: p.core.permit2, needed: p.amount, mins: p.mins })
	const r = await retryOnRevert(() =>
		runRouterDeposit(
			{ pub, wallet, account } as never,
			{
				router: p.core.router,
				routerAbi: SWAP_BRIDGE_ROUTER_ABI as never,
				permit2: p.core.permit2,
				tokenPortal: p.portal,
				bridgeToken: p.usdc,
				amount: p.amount,
				aztecRecipient: p.recipient as `0x${string}`,
				isPrivate: p.isPrivate,
				swapTarget: p.core.swapTarget,
				claimSalt: p.claimSalt,
				nonce: BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`),
				deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
				chainId: p.chainId,
			},
			(st) => console.log(`l1: ${st} (${p.mins()})`),
		),
	)
	return { claimValue: Fr.fromHexString(r.claimValueHex), leafIndex: r.leafIndex }
}
