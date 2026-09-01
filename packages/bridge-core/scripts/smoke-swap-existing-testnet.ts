/**
 * Pre-promotion FUELED smoke for a candidate manifest: deposit + swap -> self-paying claim.
 *
 * The fueled sibling of smoke-existing-testnet.ts (which does the plain deposit->claim). Registers the
 * candidate's L1/L2 contracts (NO deploy), then runs ONE public fueled bridge: swap a slice of the
 * bridged token -> Fee Juice, bridge the rest, and CLAIM in a single self-paying tx (the claimed Fee
 * Juice pays that tx's own gas). Proves the candidate's swap+fuel path end to end before promotion.
 *
 * This is the lean candidate gate; fuel-testnet.ts is the heavier P5 validator (public + private +
 * MIN_FUEL_FJ calibration). Both compose the same extracted flows (runSwapBridge / publicFeeJuicePayment).
 *
 * Real proofs: expect ~15-40 min. Run:
 *   bun run scripts/smoke-swap-existing-testnet.ts --config <path/to/testnet-bridge.candidate.json>
 * (needs PRIVATE_KEY + SEPOLIA_RPC_URL in packages/bridge-core/.env).
 */
import { readFileSync } from "node:fs"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { FeeJuiceContractArtifact } from "@aztec/noir-contracts.js/FeeJuice"
import { privateKeyToAccount } from "viem/accounts"
import { feeJuiceAddress, publicFeeJuicePayment } from "../src/fee-juice"
import { runSwapBridge } from "../src/flows"
import { minOutputForSlippage, quoteFuelPath } from "../src/quote"
import { buildFuelRoute } from "../src/route"
import { evmAbi } from "./script-artifacts"
import { ensureRouterPermit2 } from "./script-l1"
import { deployAccountIfAbsent, freshSchnorrAccount, registerManifestTrio, sponsoredFpcFee } from "./script-l2"
import { createL1Clients, createL2Wallet, createNode, sepoliaChain, stopwatch } from "./script-bootstrap"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-core/.env)")

const configArg = process.argv.indexOf("--config")
if (configArg === -1) throw new Error("pass --config <candidate manifest path>")
const CONFIG = JSON.parse(readFileSync(process.argv[configArg + 1] as string, "utf8"))
const fuel = CONFIG.l1.fuel
if (!fuel) throw new Error("candidate manifest has no l1.fuel")
const core = fuel.core
const swap = fuel.swap
if (!swap) throw new Error("candidate manifest has no l1.fuel.swap — this swap smoke needs the swap stack")

const sepolia = sepoliaChain(SEPOLIA_RPC)

// Amounts are DECIMALS-DRIVEN from the manifest token (an 18-dec assumption against a 6-dec token
// would request 10^19 base units into a 10^9 mint cap — instant revert; codex bug-bash r2).
const TOKEN_DECIMALS = BigInt(CONFIG.l1.token?.decimals ?? 18)
const TOTAL = 10n * 10n ** TOKEN_DECIMALS
// Env-tunable: the slice must buy ENOUGH FJ for the self-paying claim at the CURRENT pool rate
// (quote >= minFuelFj) — a fresh pool's pricing can put the old default under the floor.
const FUEL_SLICE = BigInt(process.env.FUEL_SLICE_UNITS ?? (10n ** TOKEN_DECIMALS).toString())

async function main() {
	const mins = stopwatch()

	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	const { wallet, pub } = createL1Clients({ chain: sepolia, rpcUrl: SEPOLIA_RPC, account })
	const azlo = CONFIG.l1.usdc as `0x${string}`
	console.log(`candidate fuel smoke: portal ${CONFIG.l1.portal} (${CONFIG.l1.portalSource ?? "legacy"}), router ${core.router}`)

	const tokenAbi = evmAbi((CONFIG.l1.token?.sourceContract as string | undefined) ?? "MintableERC20")
	await pub.waitForTransactionReceipt({
		hash: await wallet.writeContract({
			address: azlo,
			abi: tokenAbi as never,
			functionName: "mint",
			args: [account.address, TOTAL] as never,
		}),
	})
	const route = buildFuelRoute({
		token: azlo,
		weth: swap.weth,
		feeJuice: swap.feeJuice,
		tokenWeth: swap.pools.tokenWeth ?? swap.pools.azloWeth,
		ethFj: swap.pools.ethFj,
	})

	// ─── L2 (fresh account; sponsored FPC pays ONLY its deploy, fuel pays the claim) ──
	const node = createNode(NODE_URL)
	const ewallet = await createL2Wallet({ nodeUrl: NODE_URL, proverEnabled: true })
	const { manager, from } = await freshSchnorrAccount(ewallet as never)
	console.log("L2 smoke account", from.toString())

	const { fee: sponsoredFee } = await sponsoredFpcFee(ewallet)
	await deployAccountIfAbsent({
		node,
		manager: manager as never,
		from,
		fee: sponsoredFee,
		log: (stage) => {
			if (stage === "deploying") console.log(`deploying L2 smoke account (real proof)… (${mins()})`)
		},
	})

	// Register (NOT deploy) the candidate's L2 contracts, asserting each address recomputes.
	const { token, bridge } = await registerManifestTrio(ewallet, CONFIG)
	const feeJuice = await Contract.at(AztecAddress.fromStringUnsafe(feeJuiceAddress), FeeJuiceContractArtifact, ewallet as never)
	console.log(`candidate contracts registered (${mins()})`)

	const fjBalance = async (): Promise<bigint> => {
		const r = (await feeJuice.methods.balance_of_public(from).simulate({ from })) as { result?: bigint }
		return r.result ?? (r as unknown as bigint)
	}
	const tokenBalance = async (): Promise<bigint> => {
		const r = (await token.methods.balance_of_public(from).simulate({ from })) as { result?: bigint }
		return r.result ?? (r as unknown as bigint)
	}

	// ─── deposit + swap (L1) → self-paying public claim (L2) ─────────
	const quote = await quoteFuelPath(pub as never, swap.quoter, route, FUEL_SLICE)
	const minOut = minOutputForSlippage(quote, swap.slippageBps)
	console.log(`quote: ${FUEL_SLICE} AZLO-wei → ${quote} FJ-wei (floor ${minOut}) (${mins()})`)

	await ensureRouterPermit2({ pub, wallet, account }, { usdc: azlo, usdcAbi: tokenAbi, permit2: core.permit2, needed: TOTAL, mins })

	const result = await runSwapBridge(
		{ pub, wallet, account } as never,
		{
			router: core.router,
			routerAbi: evmAbi("SwapBridgeRouter"),
			permit2: core.permit2,
			swapTarget: core.swapTarget,
			tokenPortal: CONFIG.l1.portal,
			bridgeToken: azlo,
			totalAmount: TOTAL,
			fuelAmount: FUEL_SLICE,
			aztecRecipient: from.toString() as `0x${string}`,
			fuelRecipient: from.toString() as `0x${string}`,
			minFuelOutput: minOut,
			path: route.path,
			zeroForOnes: route.zeroForOnes,
			isPrivate: false,
			nonce: BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`),
			deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
			chainId: 11155111,
		},
		(s) => console.log(`l1: ${s} (${mins()})`),
		{ onSecrets: () => console.log("secrets persisted (in-memory for the smoke)") },
	)
	console.log(
		`bridged: tokenLeaf ${result.tokenLeafIndex}, fuelLeaf ${result.fuelLeafIndex}, fuelReceived ${result.fuelReceived} (${mins()})`,
	)

	await runFueledClaim({
		bridge,
		from,
		bridgedAmount: TOTAL - FUEL_SLICE,
		result,
		fjBalance,
		tokenBalance,
		mins,
	})
}

/** The self-paying claim: ONE tx claims the bridged tokens AND pays its own gas from the
 *  swapped Fee Juice, retried on the sync cadence; then the token/FJ balance asserts. */
async function runFueledClaim(d: {
	bridge: Contract
	from: AztecAddress
	bridgedAmount: bigint
	result: { fuelReceived: bigint; fuelSecretHex: string; fuelLeafIndex: bigint; tokenSecretHex: string; tokenLeafIndex: bigint }
	fjBalance: () => Promise<bigint>
	tokenBalance: () => Promise<bigint>
	mins: () => string
}): Promise<void> {
	const fjwcFee = {
		paymentMethod: publicFeeJuicePayment(d.from, {
			claimAmount: d.result.fuelReceived,
			claimSecret: Fr.fromHexString(d.result.fuelSecretHex),
			messageLeafIndex: d.result.fuelLeafIndex,
		}),
	}
	const fjBefore = await d.fjBalance()
	let landed = false
	for (let i = 0; i < 300 && !landed; i++) {
		try {
			await d.bridge.methods
				.claim_public(d.from, d.bridgedAmount, Fr.fromHexString(d.result.tokenSecretHex), new Fr(d.result.tokenLeafIndex))
				.send({ from: d.from, fee: fjwcFee, wait: { waitForStatus: TxStatus.PROPOSED } } as never)
			landed = true
		} catch {
			if (i % 10 === 0) console.log(`claim not ready yet (messages syncing)… (${d.mins()})`)
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!landed) throw new Error("self-paying claim never landed within budget")

	const tokenBal = await d.tokenBalance()
	const fjAfter = await d.fjBalance()
	if (tokenBal < d.bridgedAmount) throw new Error(`token balance ${tokenBal} < bridged ${d.bridgedAmount}`)
	if (fjAfter <= fjBefore) throw new Error(`no Fee Juice landed as balance (fee ate everything?)`)
	console.log(`\n✅ CANDIDATE fueled smoke PASSED — deposit+swap→self-paying claim in ${d.mins()}.`)
	console.log(`   token balance ${tokenBal}, FJ gained ${fjAfter - fjBefore}. Safe to promote.`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
