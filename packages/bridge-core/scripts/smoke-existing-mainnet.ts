/**
 * MAINNET candidate smoke — the app's EXACT router deposit path against the group-2/3 deployment,
 * REAL USDC, REAL fees. The mainnet sibling of smoke-existing-testnet.ts with the structural deltas:
 *
 *   - No mint(): the L1 funder holds real Circle USDC (BYO). Amounts are SMALL and env-tunable
 *     (default 3 USDC per lane vs testnet's 100 test-tokens).
 *   - No SponsoredFPC: the L2 smoke account IS the funded mainnet deployer
 *     (resolveDeployerKeys("mainnet")) paying from its claimed public fee juice.
 *   - No redirect-proof lane here: the recipient-binding is circuit-level and was proven live on
 *     testnet with the SAME artifacts; re-proving it would spend two extra USDC deposits.
 *
 *   bun scripts/smoke-existing-mainnet.ts --config apps/faucet/public/mainnet-bridge.candidate.json
 *   [--private]  [SMOKE_USDC_UNITS=3000000]
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { EthAddress } from "@aztec/foundation/eth-address"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { createPublicClient, createWalletClient, defineChain, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { preexistingFeeJuicePayment } from "../src/fee-juice"
import { runRouterDeposit } from "../src/flows"
import { ensurePermit2Allowance, SWAP_BRIDGE_ROUTER_ABI } from "../src/l1"
import { resolveDeployerKeys } from "./deployer-keys"
import { requirePinnedSigner } from "./live-intent"

const ETH_RPC = process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://lb.drpc.live/aztec-mainnet/Ak_eT5HA2kbyqamqGTF702cdsdWqLTIR8YdadmahlY6k"
const PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("MAINNET_PRIVATE_KEY required (packages/bridge-core/.env)")

const configArg = process.argv.indexOf("--config")
if (configArg === -1) throw new Error("pass --config apps/faucet/public/mainnet-bridge.candidate.json")
const isPrivate = process.argv.includes("--private")

const here = dirname(fileURLToPath(import.meta.url))
const AZTEC = join(here, "..", "..", "..", "contracts", "bridge", "aztec")
const CONFIG = JSON.parse(readFileSync(process.argv[configArg + 1], "utf8"))

const ERC20_MIN = [
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
	{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const

const mainnet = defineChain({
	id: 1,
	name: "ethereum",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [ETH_RPC] } },
})

function nargoArtifact(rel: string) {
	return loadContractArtifact(JSON.parse(readFileSync(join(AZTEC, rel), "utf8")))
}

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`

	// ─── L1 (Ethereum mainnet, viem) ─────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	const pinned = requirePinnedSigner("mainnet")
	if (account.address.toLowerCase() !== pinned.toLowerCase()) throw new Error("L1 funder != plan-pinned mainnet signer; STOP")
	console.log("L1 funder", account.address)
	const wallet = createWalletClient({ account, chain: mainnet, transport: http(ETH_RPC) })
	const pub = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) })

	const usdc = CONFIG.l1.usdc as `0x${string}`
	const portal = CONFIG.l1.portal as `0x${string}`
	const core = CONFIG.l1.fuel?.core as { router?: `0x${string}`; permit2?: `0x${string}`; swapTarget?: `0x${string}` } | undefined
	if (!core?.router || !core?.permit2 || !core?.swapTarget) throw new Error("candidate has no l1.fuel.core — the app path needs it (C7)")
	const routerCore = core as { router: `0x${string}`; permit2: `0x${string}`; swapTarget: `0x${string}` }
	const decimals = CONFIG.l1.token.decimals as number
	const amount = BigInt(process.env.SMOKE_USDC_UNITS ?? (3n * 10n ** BigInt(decimals)).toString())
	console.log(`candidate: portal ${portal}, usdc ${usdc}, smoke amount ${amount}`)
	const usdcBal = (await pub.readContract({
		address: usdc,
		abi: ERC20_MIN,
		functionName: "balanceOf",
		args: [account.address],
	})) as bigint
	if (usdcBal < amount) throw new Error(`USDC balance ${usdcBal} < smoke amount ${amount}; STOP`)

	// ─── L2: the FUNDED mainnet deployer pays its own fees ───────────
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const { secret, salt } = resolveDeployerKeys("mainnet")
	const { signingKey, secretKey } = await deriveNuloAccountKeys(secret)
	const manager = await ewallet.createSchnorrAccount(secretKey, salt, signingKey)
	const from = (await manager.getAccount()).getAddress()
	for (let i = 0; i < 100 && !(await node.getContract(from)); i++) {
		if (i === 0) console.log("waiting out the deployer instance proving lag…")
		await new Promise((r) => setTimeout(r, 12_000))
	}
	if (!(await node.getContract(from))) throw new Error(`L2 deployer ${from} never became visible; STOP`)
	console.log("L2 smoke account (the funded deployer)", from.toString())
	const fee = { paymentMethod: preexistingFeeJuicePayment(from) }
	const sendOpts = { from, fee, wait: { waitForStatus: TxStatus.PROPOSED } }

	const registerL2 = async (
		label: string,
		art: unknown,
		args: unknown[],
		ctor: string,
		saltNum: number,
		address: string,
	): Promise<Contract> => {
		const instance = await getContractInstanceFromInstantiationParams(
			art as never,
			{
				constructorArgs: args,
				salt: new Fr(saltNum),
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
		console.log(`registered ${label}: ${address}`)
		return await Contract.at(instance.address, art as never, ewallet as never)
	}

	const proxy = await registerL2(
		"proxy",
		nargoArtifact("token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json"),
		[],
		CONFIG.l2.proxy.constructorArtifact,
		CONFIG.l2.proxy.salt,
		CONFIG.l2.proxy.address,
	)
	const [tName, tSymbol, tDec] = CONFIG.l2.token.constructorArgs as [string, string, number, string]
	const token = await registerL2(
		"token",
		TokenContractArtifact,
		[tName, tSymbol, tDec, proxy.address, AztecAddress.ZERO],
		CONFIG.l2.token.constructorArtifact,
		CONFIG.l2.token.salt,
		CONFIG.l2.token.address,
	)
	const bridge = await registerL2(
		"bridge",
		nargoArtifact("token_bridge/target/token_bridge_contract-TokenBridge.json"),
		[proxy.address, EthAddress.fromString(portal)],
		CONFIG.l2.bridge.constructorArtifact,
		CONFIG.l2.bridge.salt,
		CONFIG.l2.bridge.address,
	)

	// ─── Deposit (the app's router path) → claim ─────────────────────
	const l2recipient = from
	const retryOnRevert = async <T>(fn: () => Promise<T>, tries = 3): Promise<T> => {
		for (let i = 1; ; i++) {
			try {
				return await fn()
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				if (i >= tries || !/REVERTED/.test(msg)) throw e
				console.log(`bridge() reverted (attempt ${i}/${tries}) — waiting one Aztec slot: ${msg.slice(0, 120)}`)
				await new Promise((r) => setTimeout(r, 45_000))
			}
		}
	}

	const claimSalt = isPrivate ? Fr.random() : undefined
	await ensurePermit2Allowance({
		allowance: async () =>
			(await pub.readContract({
				address: usdc,
				abi: ERC20_MIN,
				functionName: "allowance",
				args: [account.address, routerCore.permit2],
			})) as bigint,
		approveMax: async () =>
			await wallet.writeContract({
				address: usdc,
				abi: ERC20_MIN,
				functionName: "approve",
				args: [routerCore.permit2, (1n << 256n) - 1n],
			}),
		waitReceipt: async (hash) => await pub.waitForTransactionReceipt({ hash }),
		needed: amount,
		onStatus: (st, tx) => console.log(`permit2 approval: ${st}${tx ? ` (${tx})` : ""} (${mins()})`),
	})
	const dep = await retryOnRevert(() =>
		runRouterDeposit(
			{ pub, wallet, account } as never,
			{
				router: routerCore.router,
				routerAbi: SWAP_BRIDGE_ROUTER_ABI as never,
				permit2: routerCore.permit2,
				tokenPortal: portal,
				bridgeToken: usdc,
				amount,
				aztecRecipient: l2recipient.toString() as `0x${string}`,
				isPrivate,
				swapTarget: routerCore.swapTarget,
				claimSalt,
				nonce: BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`),
				deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
				chainId: 1,
			},
			(st) => console.log(`l1: ${st} (${mins()})`),
		),
	)
	const claimValue = Fr.fromHexString(dep.claimValueHex)
	const leafIndex = dep.leafIndex
	console.log(`deposited ${amount} USDC-units → L2 via router (${isPrivate ? "private" : "public"}), leaf ${leafIndex} (${mins()})`)

	let claimed = false
	for (let i = 0; i < 300 && !claimed; i++) {
		try {
			await (isPrivate
				? bridge.methods.claim_private(l2recipient, amount, claimValue, new Fr(leafIndex))
				: bridge.methods.claim_public(l2recipient, amount, claimValue, new Fr(leafIndex))
			).send(sendOpts as never)
			claimed = true
		} catch {
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!claimed) throw new Error(`claim_${isPrivate ? "private" : "public"} never succeeded (message not synced within budget)`)

	const bal = isPrivate
		? ((await token.methods.balance_of_private(l2recipient).simulate({ from })) as { result: bigint }).result
		: ((await token.methods.balance_of_public(l2recipient).simulate({ from })) as { result: bigint }).result
	if (bal < amount) throw new Error(`balance ${bal} < deposited ${amount}`)
	console.log(`\n✅ MAINNET ${isPrivate ? "PRIVATE " : ""}smoke PASSED — ${amount} USDC-units bridged + claimed in ${mins()}.`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
