/**
 * LIVE-testnet DIRECT Fee-Juice canary: proves the candidate's `l1.feeJuice` lane end-to-end —
 * the one lane `fuel-testnet.ts` does NOT exercise (that one acquires FJ via the swap router).
 * Mirrors the faucet's PUBLIC direct-Fuel flow exactly (useL1FeeAsset + useFuel + fuelClaim):
 *
 *   1. fail-closed coherence: handler.FEE_ASSET() == asset, portal.UNDERLYING() == asset
 *   2. FeeAssetHandler.mint(owner)            — the wallet's mint button
 *   3. approve + FeeJuicePortal.depositToAztecPublic(to, minFj, secretHash)  — deposits EXACTLY
 *      the manifest's minFj, so the floor the manifest promises the wallet is what gets proven
 *   4. fresh L2 account (sponsored-FPC deploy), then a SELF-PAY claim (fuelClaim.ts): a carrier-less
 *      zero-app-call BatchCall([]) + FeeJuicePaymentMethodWithClaim (claim_and_end_setup in setup) — the
 *      mainnet-shaped public claim lane (NO Sponsored FPC). Net balance = deposit − self-paid gas.
 *
 * Run: bun scripts/fee-juice-canary-testnet.ts --config <candidate.json>
 *      (PRIVATE_KEY + SEPOLIA_RPC_URL in packages/bridge-core/.env)
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { BatchCall, Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { Gas } from "@aztec/stdlib/gas"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { FeeAssetHandlerAbi } from "@aztec/l1-artifacts"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { FeeJuiceContractArtifact } from "@aztec/noir-contracts.js/FeeJuice"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { privateKeyToAccount } from "viem/accounts"
import { parseCandidateManifest } from "../src/candidate-schema"
import { feeJuiceAddress, predictedWorstMinFees, publicFeeJuicePayment } from "../src/fee-juice"
import { FeeJuicePortalAbi, feeJuiceDepositArgs, parseFeeJuiceDeposit, planPublicFuelDeposit } from "../src/fuel"
import { createL1Clients, createL2Wallet, createNode, loadManifestFromConfigArg, sepoliaChain, stopwatch } from "./script-bootstrap"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-core/.env)")

const here = dirname(fileURLToPath(import.meta.url))
const configArg = process.argv.indexOf("--config")
// Recomputed (not just derived from loadManifestFromConfigArg) because the error below reports
// the ACTUAL resolved path, matching whichever of --config / the fallback was used.
const CONFIG_PATH =
	configArg !== -1
		? (process.argv[configArg + 1] as string)
		: join(here, "..", "..", "..", "apps", "faucet", "public", "testnet-bridge.json")
const CONFIG = loadManifestFromConfigArg(process.argv, {
	mode: "fallback",
	fallbackPath: CONFIG_PATH,
	parse: parseCandidateManifest,
})
if (!CONFIG.l1.feeJuice) throw new Error(`${CONFIG_PATH} has no l1.feeJuice block — nothing to canary`)
const direct = CONFIG.l1.feeJuice

const sepolia = sepoliaChain(SEPOLIA_RPC)

const ERC20_MIN = [
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (107 lines) — split when touched, never grow
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 30) — refactor when touched, never raise
async function main() {
	const mins = stopwatch()
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	const { wallet, pub } = createL1Clients({ chain: sepolia, rpcUrl: SEPOLIA_RPC, account })
	const asset = direct.asset as `0x${string}`
	const portal = direct.portal as `0x${string}`
	const handler = direct.feeAssetHandler as `0x${string}`
	const minFj = BigInt(direct.minFj)
	console.log(`direct-FJ lane: asset ${asset} | portal ${portal} | handler ${handler} | minFj ${minFj}`)

	// 1. The wallet's fail-closed coherence checks (useL1FeeAsset.verifyPortalAsset/verifyHandlerAsset).
	const underlying = (await pub.readContract({ address: portal, abi: FeeJuicePortalAbi, functionName: "UNDERLYING" })) as string
	if (underlying.toLowerCase() !== asset.toLowerCase()) throw new Error(`portal UNDERLYING ${underlying} != asset ${asset}`)
	const feeAsset = (await pub.readContract({ address: handler, abi: FeeAssetHandlerAbi, functionName: "FEE_ASSET" })) as string
	if (feeAsset.toLowerCase() !== asset.toLowerCase()) throw new Error(`handler FEE_ASSET ${feeAsset} != asset ${asset}`)
	console.log(`coherence OK: UNDERLYING + FEE_ASSET match the manifest asset (${mins()})`)

	// 2. Mint via the handler — the wallet's mint path. The handler's fixed mintAmount must cover the
	//    floor the manifest promises, or the wallet's own mint button couldn't fund a deposit.
	const mintAmount = (await pub.readContract({ address: handler, abi: FeeAssetHandlerAbi, functionName: "mintAmount" })) as bigint
	const balBefore = (await pub.readContract({
		address: asset,
		abi: ERC20_MIN,
		functionName: "balanceOf",
		args: [account.address],
	})) as bigint
	if (balBefore < minFj) {
		const mintTx = await wallet.writeContract({
			address: handler,
			abi: FeeAssetHandlerAbi,
			functionName: "mint",
			args: [account.address],
		})
		const mintReceipt = await pub.waitForTransactionReceipt({ hash: mintTx })
		if (mintReceipt.status !== "success") throw new Error("handler mint reverted on-chain")
		const balAfter = (await pub.readContract({
			address: asset,
			abi: ERC20_MIN,
			functionName: "balanceOf",
			args: [account.address],
		})) as bigint
		console.log(`minted ${balAfter - balBefore} fee asset via handler (mintAmount ${mintAmount}) (${mins()})`)
		if (balAfter < minFj) throw new Error(`post-mint balance ${balAfter} < minFj ${minFj} — one mint can't fund the floor`)
	} else {
		console.log(`existing fee-asset balance ${balBefore} covers minFj — skipping mint (mintAmount ${mintAmount})`)
	}

	// 3. L2 fresh account first (the deposit binds to its address), sponsored-FPC deploy.
	const node = createNode(NODE_URL)
	const ewallet = await createL2Wallet({ nodeUrl: NODE_URL, proverEnabled: true })
	const { signingKey, secretKey } = await deriveNuloAccountKeys(Fr.random())
	const manager = await ewallet.createSchnorrAccount(secretKey, Fr.random(), signingKey)
	const from = (await manager.getAccount()).getAddress()
	console.log(`L2 recipient ${from.toString()}`)
	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const sponsoredFee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	// --fresh-selfpay: SKIP the sponsored account deploy so the self-pay claim is the account's FIRST
	// tx and carries initialization (ctor + instance publication) - the mainnet persona (no sponsor
	// exists there). Measures the gas shape the steady-state calibration excludes (fable audit H1).
	const freshSelfPay = process.argv.includes("--fresh-selfpay")
	if (freshSelfPay) {
		console.log("FRESH-SELFPAY mode: skipping the sponsored account deploy - the claim must carry init")
	} else if (!(await node.getContract(from))) {
		console.log(`deploying L2 account via sponsored FPC (real proof)… (${mins()})`)
		const deployMethod = await manager.getDeployMethod()
		await deployMethod.send({ fee: sponsoredFee, from: "NO_FROM" as never } as never)
		console.log(`L2 account deployed (${mins()})`)
	}

	// 4. Direct deposit of EXACTLY minFj — approve (allowance-skip, like the wallet) then deposit.
	const plan = await planPublicFuelDeposit(from, minFj)
	const allowance = (await pub.readContract({
		address: asset,
		abi: ERC20_MIN,
		functionName: "allowance",
		args: [account.address, portal],
	})) as bigint
	if (allowance < minFj) {
		const approveTx = await wallet.writeContract({ address: asset, abi: ERC20_MIN, functionName: "approve", args: [portal, minFj] })
		const approveReceipt = await pub.waitForTransactionReceipt({ hash: approveTx })
		if (approveReceipt.status !== "success") throw new Error("approve reverted on-chain")
	}
	const depositTx = await wallet.writeContract({
		address: portal,
		abi: FeeJuicePortalAbi,
		functionName: "depositToAztecPublic",
		args: feeJuiceDepositArgs(plan) as never,
	})
	const depositReceipt = await pub.waitForTransactionReceipt({ hash: depositTx })
	if (depositReceipt.status !== "success") throw new Error("depositToAztecPublic reverted on-chain")
	const deposit = parseFeeJuiceDeposit(depositReceipt.logs as never)
	console.log(`deposited: ${deposit.amount} FJ-wei, leaf ${deposit.leafIndex} (${mins()})`)
	if (deposit.amount !== minFj) throw new Error(`deposit event amount ${deposit.amount} != minFj ${minFj}`)

	// 5. The faucet's PUBLIC claim lane — SELF-PAY (fuelClaim.ts, owner call 2026-07-21): claim the bridged
	//    FJ and pay THIS tx's fee FROM it in one carrier-less zero-app-call tx (BatchCall([]) +
	//    FeeJuicePaymentMethodWithClaim → claim_and_end_setup in the SETUP phase). No Sponsored FPC — the
	//    mainnet shape. Setup is the CORRECT home for claim_and_end_setup: the 5.0.0 "149 failed simulates"
	//    bug was that variant in the APP phase under a sponsored fee; as a fee payload it is valid. This
	//    canary is what PROVES the zero-app-call + claim_and_end_setup combination live before we ship it.
	//    Retry until the L1→L2 message syncs (same cadence as fuel-testnet's claim loop).
	const feeJuice = await Contract.at(AztecAddress.fromStringUnsafe(feeJuiceAddress), FeeJuiceContractArtifact, ewallet as never)
	const fjBalance = async (): Promise<bigint> => {
		const r = (await feeJuice.methods.balance_of_public(from).simulate({ from })) as { result?: bigint } | bigint
		return typeof r === "bigint" ? r : (r.result ?? 0n)
	}
	const fjBefore = await fjBalance()
	// predicted-worst maxFeesPerGas (NO padding): a self-pay claim spends the bridged amount as its whole
	// budget, so any padding inflates max_gas_cost past it and claim_and_end_setup reverts "Amount too low".
	const worst = await predictedWorstMinFees(node)
	const selfPayFee = {
		paymentMethod: publicFeeJuicePayment(from, {
			claimAmount: deposit.amount,
			claimSecret: plan.secret,
			messageLeafIndex: BigInt(deposit.leafIndex),
		}),
		gasSettings: {
			// EXPLICIT gasLimits — the empty BatchCall([]) gives the estimator nothing, so it would default to
			// the per-tx MAX and max_gas_cost would blow past the bridged amount. CALIBRATED (1.5M/3k, a ~2.3x
			// margin over a landed claim's 659_123/224) and mirrored in fuelClaim.ts. Deliberately far below
			// the private 4M so the limit-based balance check keeps fee-spike headroom under the floor.
			gasLimits: Gas.from({ daGas: 3_000, l2Gas: 1_500_000 }),
			teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }),
			maxFeesPerGas: { feePerDaGas: worst.feePerDaGas, feePerL2Gas: worst.feePerL2Gas },
		},
	}
	let settled = false
	for (let i = 0; i < 300 && !settled; i++) {
		try {
			await new BatchCall(ewallet as never, []).send({
				from,
				fee: selfPayFee,
				wait: { waitForStatus: TxStatus.PROPOSED },
			} as never)
			settled = true
		} catch (e) {
			// Surface the real error on the retry cadence — a swallowed persistent assert looks identical to a
			// slow message sync from the outside (the claim_and_end_setup bug hid behind this in 5.0.0).
			if (i % 10 === 0) console.log(`self-pay claim retry (${mins()}): ${e instanceof Error ? e.message.slice(0, 200) : e}`)
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!settled) throw new Error("direct-FJ SELF-PAY claim never SETTLED within budget")

	// SELF-PAY: the claim paid this tx's fee FROM the deposit, so the NET gain is deposit − max_gas_cost
	// (NOT the full deposit). Assert a positive balance landed strictly below the deposit — the mainnet shape.
	const fjAfter = await fjBalance()
	const gained = fjAfter - fjBefore
	const feePaid = deposit.amount - gained
	if (gained <= 0n) throw new Error(`self-pay claim gained ${gained} (<=0) — nothing landed`)
	if (gained >= deposit.amount) throw new Error(`self-pay claim gained ${gained} >= deposited ${deposit.amount} — fee not deducted?`)
	console.log(
		`\n✅ DIRECT Fee-Juice SELF-PAY canary PASSED — mint→deposit(minFj)→self-pay-claim landed ${gained} FJ-wei (fee ${feePaid}) in ${mins()}.`,
	)
	console.log("   The l1.feeJuice lane (handler mint + direct portal deposit + zero-app-call self-pay claim) is live.")
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
