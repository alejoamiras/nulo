/**
 * LIVE-testnet fueled bridge validation (plan P5): drives `runSwapBridge` against the LIVE
 * router/pools, then proves the headline claim on Aztec — a fresh account's claim transaction
 * PAYS FOR ITSELF from the Fee Juice it claims in the same tx (`FeeJuicePaymentMethodWithClaim`),
 * for BOTH the public and private token variants. Also calibrates MIN_FUEL_FJ from the real fee.
 *
 * Uses the EXISTING live deployment (testnet-bridge.json + l1.fuel) — nothing is deployed here
 * except the throwaway L2 account (sponsored FPC pays its deployment; fuel pays its claims).
 *
 * Real proofs: expect ~30-60 min end to end.
 * Run: bun run scripts/fuel-testnet.ts   (PRIVATE_KEY + SEPOLIA_RPC_URL in packages/bridge-core/.env)
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { EthAddress } from "@aztec/foundation/eth-address"
import { FeeJuiceContractArtifact } from "@aztec/noir-contracts.js/FeeJuice"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { type Abi, createPublicClient, createWalletClient, defineChain, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "../src/artifacts"
import { feeJuiceAddress, publicFeeJuicePayment } from "../src/fee-juice"
import { runSwapBridge } from "../src/flows"
import { minOutputForSlippage, quoteFuelPath } from "../src/quote"
import { buildFuelRoute } from "../src/route"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-core/.env)")

const here = dirname(fileURLToPath(import.meta.url))
const configArg = process.argv.indexOf("--config")
const CONFIG_PATH =
	configArg !== -1 ? (process.argv[configArg + 1] as string) : join(here, "..", "..", "faucet", "public", "testnet-bridge.json")
const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
const OUT = join(here, "..", "..", "bridge-evm", "out")
const fuel = CONFIG.l1.fuel
if (!fuel) throw new Error("testnet-bridge.json has no l1.fuel - run the P2 deploy first")

const sepolia = defineChain({
	id: 11155111,
	name: "sepolia",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SEPOLIA_RPC] } },
})

function evmAbi(name: string): Abi {
	return JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8")).abi as Abi
}

const TOTAL = 10n * 10n ** 18n // 10 AZLO per variant
const FUEL_SLICE = 25n * 10n ** 16n // 0.25 AZLO ≈ ~487 FJ at the live rate (the design fill)

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`

	// ─── L1 (live contracts, viem) ───────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
	const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
	const azlo = CONFIG.l1.usdc as `0x${string}`
	const erc20 = evmAbi("MintableERC20")
	console.log("L1 sender", account.address, "| AZLO", azlo, "| router", fuel.router)

	// Mint enough AZLO for both variants (permissionless, Permit2 pre-approved by the token).
	await pub.waitForTransactionReceipt({
		hash: await wallet.writeContract({
			address: azlo,
			abi: erc20 as never,
			functionName: "mint",
			args: [account.address, 2n * TOTAL] as never,
		}),
	})
	console.log(`minted ${(2n * TOTAL) / 10n ** 18n} AZLO (${mins()})`)

	const route = buildFuelRoute({
		token: azlo,
		weth: fuel.weth,
		feeJuice: fuel.feeJuice,
		tokenWeth: fuel.pools.azloWeth,
		ethFj: fuel.pools.ethFj,
	})

	// ─── L2 (fresh account, real proofs; sponsored pays ONLY the account deploy) ──
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const secret = Fr.random()
	const manager = await ewallet.createSchnorrAccount(secret, Fr.random(), deriveSigningKey(secret))
	const l2account = await manager.getAccount()
	const from = l2account.getAddress()
	console.log("L2 recipient", from.toString())

	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
		salt: new Fr(SPONSORED_FPC_SALT),
	})
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

	// Register the LIVE L2 contracts (instances rebuilt from deploy metadata).
	const registerLive = async (
		label: string,
		artifact: unknown,
		meta: { address: string; salt: number; constructorArtifact: string; constructorArgs: unknown[] },
	) => {
		const args = meta.constructorArgs.map((a) =>
			typeof a === "string" && a.startsWith("0x") && a.length === 66 ? AztecAddress.fromString(a) : a,
		)
		const instance = await getContractInstanceFromInstantiationParams(
			artifact as never,
			{
				constructorArgs: args,
				salt: new Fr(meta.salt),
				publicKeys: PublicKeys.default(),
				deployer: AztecAddress.ZERO,
				constructorArtifact: meta.constructorArtifact,
			} as never,
		)
		if (instance.address.toString() !== meta.address) {
			throw new Error(`${label}: rebuilt ${instance.address} != recorded ${meta.address}`)
		}
		try {
			await ewallet.registerContract(instance, artifact as never)
		} catch {}
		return Contract.at(instance.address, artifact as never, ewallet as never)
	}
	const l1PortalArg = EthAddress.fromString(CONFIG.l1.portal)
	const bridgeMeta = { ...CONFIG.l2.bridge, constructorArgs: [CONFIG.l2.bridge.constructorArgs[0], l1PortalArg] }
	const token = await registerLive("token", TokenContractArtifact, CONFIG.l2.token)
	const bridge = await registerLive("bridge", tokenBridgeArtifact, bridgeMeta)
	await registerLive("proxy", bridgeProxyArtifact, CONFIG.l2.proxy)
	const feeJuice = await Contract.at(AztecAddress.fromString(feeJuiceAddress), FeeJuiceContractArtifact, ewallet as never)
	console.log(`live contracts registered (${mins()})`)

	const fjBalance = async (): Promise<bigint> =>
		((await feeJuice.methods.balance_of_public(from).simulate({ from })) as { result?: bigint }).result ??
		((await feeJuice.methods.balance_of_public(from).simulate({ from })) as unknown as bigint)
	const tokenBalance = async (kind: "public" | "private"): Promise<bigint> => {
		const m = kind === "public" ? token.methods.balance_of_public(from) : token.methods.balance_of_private(from)
		const r = (await m.simulate({ from })) as { result?: bigint }
		return r.result ?? (r as unknown as bigint)
	}

	// ─── One variant = L1 swap+bridge → self-paying L2 claim ─────────
	const runVariant = async (isPrivate: boolean, nonce: bigint) => {
		const label = isPrivate ? "PRIVATE" : "PUBLIC"
		console.log(`\n=== ${label} fueled bridge ===`)

		const quote = await quoteFuelPath(pub as never, fuel.quoter, route, FUEL_SLICE)
		const minOut = minOutputForSlippage(quote, fuel.slippageBps)
		console.log(`quote: ${FUEL_SLICE} AZLO-wei → ${quote} FJ-wei (floor ${minOut}) (${mins()})`)

		const result = await runSwapBridge(
			{ pub, wallet, account } as never,
			{
				router: fuel.router,
				routerAbi: evmAbi("SwapBridgeRouter"),
				permit2: fuel.permit2,
				swapTarget: fuel.swapTarget,
				tokenPortal: CONFIG.l1.portal,
				bridgeToken: azlo,
				totalAmount: TOTAL,
				fuelAmount: FUEL_SLICE,
				aztecRecipient: from.toString() as `0x${string}`,
				fuelRecipient: from.toString() as `0x${string}`,
				minFuelOutput: minOut,
				path: route.path,
				zeroForOnes: route.zeroForOnes,
				isPrivate,
				nonce,
				deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
				chainId: 11155111,
			},
			(s) => console.log(`l1: ${s} (${mins()})`),
			{ onSecrets: () => console.log("secrets persisted (in-memory for the smoke)") },
		)
		console.log(
			`bridged: tokenLeaf ${result.tokenLeafIndex}, fuelLeaf ${result.fuelLeafIndex}, fuelReceived ${result.fuelReceived} (${mins()})`,
		)

		// The self-paying claim: ONE tx claims the fuel (fee) AND the tokens.
		const fjwcFee = {
			paymentMethod: publicFeeJuicePayment(from, {
				claimAmount: result.fuelReceived,
				claimSecret: Fr.fromHexString(result.fuelSecretHex),
				messageLeafIndex: result.fuelLeafIndex,
			}),
		}
		const bridgedAmount = TOTAL - FUEL_SLICE
		const tokenSecret = Fr.fromHexString(result.tokenSecretHex)
		const claimMethod = () =>
			isPrivate
				? bridge.methods.claim_private(from, bridgedAmount, tokenSecret, new Fr(result.tokenLeafIndex))
				: bridge.methods.claim_public(from, bridgedAmount, tokenSecret, new Fr(result.tokenLeafIndex))

		const fjBefore = await fjBalance()
		let receipt: { transactionFee?: bigint } | undefined
		for (let i = 0; i < 300 && !receipt; i++) {
			try {
				const sent = (await claimMethod().send({
					from,
					fee: fjwcFee,
					wait: { waitForStatus: TxStatus.PROPOSED },
				} as never)) as { receipt?: { transactionFee?: bigint } }
				receipt = sent.receipt ?? {}
			} catch {
				if (i % 10 === 0) console.log(`claim not ready yet (messages syncing)… (${mins()})`)
				await new Promise((r) => setTimeout(r, 6000))
			}
		}
		if (!receipt) throw new Error(`${label}: self-paying claim never landed within budget`)
		console.log(`claim landed - one tx claimed tokens AND gas (${mins()})`)

		const tokenBal = await tokenBalance(isPrivate ? "private" : "public")
		const fjAfter = await fjBalance()
		const feePaid = receipt.transactionFee ?? result.fuelReceived - (fjAfter - fjBefore)
		console.log(`${label}: token balance ${tokenBal}, FJ gained ${fjAfter - fjBefore}, fee paid ≈ ${feePaid}`)
		if (tokenBal < bridgedAmount) throw new Error(`${label}: token balance ${tokenBal} < ${bridgedAmount}`)
		if (fjAfter <= fjBefore) throw new Error(`${label}: no FJ landed as balance (fee ate everything?)`)
		return feePaid
	}

	const fee1 = await runVariant(false, BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`))
	const fee2 = await runVariant(true, BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`))

	// ─── MIN_FUEL_FJ calibration: 2× the worst observed claim fee ────
	const worst = fee1 > fee2 ? fee1 : fee2
	const minFuelFj = worst * 2n
	console.log(`\n✅ BOTH variants PASSED in ${mins()}`)
	console.log(`observed claim fees: public ${fee1}, private ${fee2}`)
	console.log(`MIN_FUEL_FJ calibration: ${minFuelFj} (2× worst fee) - update testnet-bridge.json l1.fuel.minFuelFj`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
