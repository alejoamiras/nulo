/**
 * LIVE-testnet DIRECT Fee-Juice canary: proves the candidate's `l1.feeJuice` lane end-to-end —
 * the one lane `fuel-testnet.ts` does NOT exercise (that one acquires FJ via the swap router).
 * Mirrors the faucet's PUBLIC direct-Fuel flow exactly (useL1FeeAsset + useFuel + fuelClaim):
 *
 *   1. fail-closed coherence: handler.FEE_ASSET() == asset, portal.UNDERLYING() == asset
 *   2. FeeAssetHandler.mint(owner)            — the wallet's mint button
 *   3. approve + FeeJuicePortal.depositToAztecPublic(to, minFj, secretHash)  — deposits EXACTLY
 *      the manifest's minFj, so the floor the manifest promises the wallet is what gets proven
 *   4. fresh L2 account (sponsored-FPC deploy), then FeeJuice.claim_and_end_setup paid by the
 *      Sponsored FPC — the faucet's public claim lane — and the FULL deposit must land as balance.
 *
 * Run: bun scripts/fee-juice-canary-testnet.ts --config <candidate.json>
 *      (PRIVATE_KEY + SEPOLIA_RPC_URL in packages/bridge-core/.env)
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { FeeAssetHandlerAbi } from "@aztec/l1-artifacts"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { FeeJuiceContractArtifact } from "@aztec/noir-contracts.js/FeeJuice"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { createPublicClient, createWalletClient, defineChain, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { parseCandidateManifest } from "../src/candidate-schema"
import { feeJuiceAddress } from "../src/fee-juice"
import { FeeJuicePortalAbi, feeJuiceDepositArgs, parseFeeJuiceDeposit, planPublicFuelDeposit } from "../src/fuel"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-core/.env)")

const here = dirname(fileURLToPath(import.meta.url))
const configArg = process.argv.indexOf("--config")
const CONFIG_PATH =
	configArg !== -1
		? (process.argv[configArg + 1] as string)
		: join(here, "..", "..", "..", "apps", "faucet", "public", "testnet-bridge.json")
const CONFIG = parseCandidateManifest(JSON.parse(readFileSync(CONFIG_PATH, "utf8")))
if (!CONFIG.l1.feeJuice) throw new Error(`${CONFIG_PATH} has no l1.feeJuice block — nothing to canary`)
const direct = CONFIG.l1.feeJuice

const sepolia = defineChain({
	id: 11155111,
	name: "sepolia",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SEPOLIA_RPC] } },
})

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

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
	const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
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
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const { signingKey, secretKey } = await deriveNuloAccountKeys(Fr.random())
	const manager = await ewallet.createSchnorrAccount(secretKey, Fr.random(), signingKey)
	const from = (await manager.getAccount()).getAddress()
	console.log(`L2 recipient ${from.toString()}`)
	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const sponsoredFee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	if (!(await node.getContract(from))) {
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

	// 5. The faucet's PUBLIC claim lane: FeeJuice.claim_and_end_setup paid by the Sponsored FPC.
	//    Retry until the L1→L2 message syncs (same cadence as fuel-testnet's claim loop).
	const feeJuice = await Contract.at(AztecAddress.fromStringUnsafe(feeJuiceAddress), FeeJuiceContractArtifact, ewallet as never)
	const fjBalance = async (): Promise<bigint> => {
		const r = (await feeJuice.methods.balance_of_public(from).simulate({ from })) as { result?: bigint } | bigint
		return typeof r === "bigint" ? r : (r.result ?? 0n)
	}
	const fjBefore = await fjBalance()
	let settled = false
	for (let i = 0; i < 300 && !settled; i++) {
		try {
			await feeJuice.methods.claim_and_end_setup(from, deposit.amount, plan.secret, new Fr(deposit.leafIndex)).send({
				from,
				fee: sponsoredFee,
				wait: { waitForStatus: TxStatus.PROPOSED },
			} as never)
			settled = true
		} catch {
			if (i % 10 === 0) console.log(`claim not ready (message syncing)… (${mins()})`)
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!settled) throw new Error("direct-FJ claim never SETTLED within budget")

	// Sponsored FPC paid the fee, so the FULL deposit must land as public balance.
	const fjAfter = await fjBalance()
	const gained = fjAfter - fjBefore
	if (gained !== deposit.amount) throw new Error(`claimed balance gained ${gained} != deposited ${deposit.amount}`)
	console.log(`\n✅ DIRECT Fee-Juice canary PASSED — mint→deposit(minFj)→claim landed ${gained} FJ-wei in ${mins()}.`)
	console.log("   The l1.feeJuice lane (handler mint + direct portal deposit + public claim) is live.")
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
