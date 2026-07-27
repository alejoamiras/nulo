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
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { type Abi, createPublicClient, createWalletClient, defineChain, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "../src/artifacts"
import { feeJuiceAddress, publicFeeJuicePayment } from "../src/fee-juice"
import { runSwapBridge } from "../src/flows"
import { ensurePermit2Allowance } from "../src/l1"
import { minOutputForSlippage, quoteFuelPath } from "../src/quote"
import { buildFuelRoute } from "../src/route"

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

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "..", "..", "..", "contracts", "bridge", "evm", "out")

const sepolia = defineChain({
	id: 11155111,
	name: "sepolia",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SEPOLIA_RPC] } },
})

const evmAbi = (name: string): Abi => JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8")).abi as Abi

// Amounts are DECIMALS-DRIVEN from the manifest token (an 18-dec assumption against a 6-dec token
// would request 10^19 base units into a 10^9 mint cap — instant revert; codex bug-bash r2).
const TOKEN_DECIMALS = BigInt(CONFIG.l1.token?.decimals ?? 18)
const TOTAL = 10n * 10n ** TOKEN_DECIMALS
const FUEL_SLICE = 25n * 10n ** (TOKEN_DECIMALS - 2n) // 0.25 tokens -> ~Fee Juice for the self-paying claim

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`

	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
	const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
	const azlo = CONFIG.l1.usdc as `0x${string}`
	console.log(`candidate fuel smoke: portal ${CONFIG.l1.portal} (${CONFIG.l1.portalSource ?? "legacy"}), router ${core.router}`)

	await pub.waitForTransactionReceipt({
		hash: await wallet.writeContract({
			address: azlo,
			abi: evmAbi((CONFIG.l1.token?.sourceContract as string | undefined) ?? "MintableERC20") as never,
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
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const secret = Fr.random()
	const { signingKey, secretKey } = await deriveNuloAccountKeys(secret)
	const manager = await ewallet.createSchnorrAccount(secretKey, Fr.random(), signingKey)
	const from = (await manager.getAccount()).getAddress()
	console.log("L2 smoke account", from.toString())

	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	if (!(await node.getContract(from))) {
		console.log(`deploying L2 smoke account (real proof)… (${mins()})`)
		await (await manager.getDeployMethod()).send({
			fee: { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) },
			from: "NO_FROM" as never,
		} as never)
	}

	// Register (NOT deploy) the candidate's L2 contracts, asserting each address recomputes.
	const registerL2 = async (
		label: string,
		art: unknown,
		args: unknown[],
		ctor: string,
		salt: number,
		address: string,
	): Promise<Contract> => {
		const instance = await getContractInstanceFromInstantiationParams(
			art as never,
			{
				constructorArgs: args,
				salt: new Fr(salt),
				publicKeys: PublicKeys.default(),
				deployer: AztecAddress.ZERO,
				constructorArtifact: ctor,
			} as never,
		)
		if (instance.address.toString().toLowerCase() !== address.toLowerCase()) {
			throw new Error(`manifest ${label} mismatch: recomputed ${instance.address.toString()} != recorded ${address}`)
		}
		try {
			await ewallet.registerContract(instance, art as never)
		} catch {}
		return await Contract.at(instance.address, art as never, ewallet as never)
	}
	const proxy = await registerL2(
		"proxy",
		bridgeProxyArtifact,
		[],
		CONFIG.l2.proxy.constructorArtifact,
		CONFIG.l2.proxy.salt,
		CONFIG.l2.proxy.address,
	)
	const [tName, tSymbol, tDec] = CONFIG.l2.token.constructorArgs as [string, string, number, string]
	const token = await registerL2(
		"token",
		TokenContractArtifact,
		// 5.0.1 standards Token: 5th constructor param auth_contract (ZERO).
		[tName, tSymbol, tDec, proxy.address, AztecAddress.ZERO],
		CONFIG.l2.token.constructorArtifact,
		CONFIG.l2.token.salt,
		CONFIG.l2.token.address,
	)
	const bridge = await registerL2(
		"bridge",
		tokenBridgeArtifact,
		[proxy.address, EthAddress.fromString(CONFIG.l1.portal)],
		CONFIG.l2.bridge.constructorArtifact,
		CONFIG.l2.bridge.salt,
		CONFIG.l2.bridge.address,
	)
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

	const tokenAbi = evmAbi((CONFIG.l1.token?.sourceContract as string | undefined) ?? "MintableERC20")
	await ensurePermit2Allowance({
		allowance: async () =>
			(await pub.readContract({
				address: azlo,
				abi: tokenAbi as never,
				functionName: "allowance",
				args: [account.address, core.permit2],
			})) as bigint,
		approveMax: async () =>
			await wallet.writeContract({
				address: azlo,
				abi: tokenAbi as never,
				functionName: "approve",
				args: [core.permit2, (1n << 256n) - 1n] as never,
			}),
		waitReceipt: async (hash) => await pub.waitForTransactionReceipt({ hash }),
		needed: TOTAL,
		onStatus: (st, tx) => console.log(`permit2 approval: ${st}${tx ? ` (${tx})` : ""} (${mins()})`),
	})

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

	const bridgedAmount = TOTAL - FUEL_SLICE
	const fjwcFee = {
		paymentMethod: publicFeeJuicePayment(from, {
			claimAmount: result.fuelReceived,
			claimSecret: Fr.fromHexString(result.fuelSecretHex),
			messageLeafIndex: result.fuelLeafIndex,
		}),
	}
	const fjBefore = await fjBalance()
	let landed = false
	for (let i = 0; i < 300 && !landed; i++) {
		try {
			await bridge.methods
				.claim_public(from, bridgedAmount, Fr.fromHexString(result.tokenSecretHex), new Fr(result.tokenLeafIndex))
				.send({ from, fee: fjwcFee, wait: { waitForStatus: TxStatus.PROPOSED } } as never)
			landed = true
		} catch {
			if (i % 10 === 0) console.log(`claim not ready yet (messages syncing)… (${mins()})`)
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!landed) throw new Error("self-paying claim never landed within budget")

	const tokenBal = await tokenBalance()
	const fjAfter = await fjBalance()
	if (tokenBal < bridgedAmount) throw new Error(`token balance ${tokenBal} < bridged ${bridgedAmount}`)
	if (fjAfter <= fjBefore) throw new Error(`no Fee Juice landed as balance (fee ate everything?)`)
	console.log(`\n✅ CANDIDATE fueled smoke PASSED — deposit+swap→self-paying claim in ${mins()}.`)
	console.log(`   token balance ${tokenBal}, FJ gained ${fjAfter - fjBefore}. Safe to promote.`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
