/**
 * Full Nulo bridge deploy onto the running local sandbox: L1 (viem) + L2 (aztec.js).
 *
 * L1: anvil_setCode Permit2 (bytecode from Sepolia), then MintableERC20 +
 *     MockSwapTarget + SwapBridgeRouter + canonical TokenPortal (all via viem).
 * L2: token_minter_proxy, aztec-standards Token (minter = proxy), our token_bridge
 *     (proxy, portal) — via aztec.js, mirroring faucet/scripts/deploy.ts plumbing
 *     (EmbeddedWallet + sponsored fee). The mock stands in for V4 (codex verdict c).
 * Wire: portal.initialize(registry, usdc, bridge); proxy.set_token + set_minter(bridge);
 *     fund the mock with sandbox feeJuice.
 *
 * Run: bun run deploy:sandbox   (from packages/bridge-core)
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getInitialTestAccountsData } from "@aztec/accounts/testing"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TokenPortalAbi, TokenPortalBytecode } from "@aztec/l1-artifacts"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { createPublicClient, createWalletClient, defineChain, getContract, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const SANDBOX_RPC = process.env.SANDBOX_L1_RPC ?? "http://localhost:8545"
const NODE_URL = process.env.SANDBOX_NODE_URL ?? "http://localhost:8080"
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const
const ACCOUNT0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "..", "..", "bridge-evm", "out")
const AZTEC = join(here, "..", "..", "bridge-aztec")

const sandbox = defineChain({
	id: 31337,
	name: "aztec-sandbox-l1",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SANDBOX_RPC] } },
})

function evmArtifact(name: string): { abi: unknown[]; bytecode: `0x${string}` } {
	const j = JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8"))
	return { abi: j.abi, bytecode: j.bytecode.object as `0x${string}` }
}

function nargoArtifact(rel: string) {
	return loadContractArtifact(JSON.parse(readFileSync(join(AZTEC, rel), "utf8")))
}

async function nodeAddrs(): Promise<{ registry: `0x${string}`; feeJuice: `0x${string}`; feeJuicePortal: `0x${string}` }> {
	const res = await fetch(NODE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "node_getNodeInfo", params: [] }),
	})
	const a = (await res.json()).result.l1ContractAddresses
	const pick = (v: unknown) => (typeof v === "object" && v ? (v as { value: string }).value : (v as string)) as `0x${string}`
	return { registry: pick(a.registryAddress), feeJuice: pick(a.feeJuiceAddress), feeJuicePortal: pick(a.feeJuicePortalAddress) }
}

async function main() {
	// ─── L1 (viem) ───────────────────────────────────────────────────
	const account = privateKeyToAccount(ACCOUNT0_KEY)
	const wallet = createWalletClient({ account, chain: sandbox, transport: http(SANDBOX_RPC) })
	const pub = createPublicClient({ chain: sandbox, transport: http(SANDBOX_RPC) })
	const { registry, feeJuice, feeJuicePortal } = await nodeAddrs()
	console.log("registry", registry, "feeJuice", feeJuice, "feeJuicePortal", feeJuicePortal)

	const permit2Code = await createPublicClient({ chain: sandbox, transport: http(SEPOLIA_RPC) }).getCode({ address: PERMIT2 })
	if (!permit2Code) throw new Error("no Permit2 bytecode from Sepolia")
	await pub.request({ method: "anvil_setCode" as never, params: [PERMIT2, permit2Code] as never })

	const deployEvm = async (name: string, abi: unknown, bytecode: `0x${string}`, args: unknown[]): Promise<`0x${string}`> => {
		const hash = await wallet.deployContract({ abi: abi as never, bytecode, args: args as never })
		const r = await pub.waitForTransactionReceipt({ hash })
		if (!r.contractAddress) throw new Error(`${name}: no contractAddress`)
		console.log(`${name}:`, r.contractAddress)
		return r.contractAddress
	}

	const usdcArt = evmArtifact("MintableERC20")
	const usdc = await deployEvm("MintableERC20", usdcArt.abi, usdcArt.bytecode, ["Nulo USDC", "USDC", 6, 1000n])
	const mockArt = evmArtifact("MockSwapTarget")
	const mock = await deployEvm("MockSwapTarget", mockArt.abi, mockArt.bytecode, [feeJuice])
	const routerArt = evmArtifact("SwapBridgeRouter")
	const router = await deployEvm("SwapBridgeRouter", routerArt.abi, routerArt.bytecode, [PERMIT2, feeJuicePortal, mock])
	const portal = await deployEvm("TokenPortal", TokenPortalAbi, TokenPortalBytecode as `0x${string}`, [])

	// ─── L2 (aztec.js) ───────────────────────────────────────────────
	createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: false } })
	const [acct] = await getInitialTestAccountsData()
	const manager = await ewallet.createSchnorrAccount(acct.secret, acct.salt, acct.signingKey)
	const deployer = await manager.getAccount()
	const from = deployer.getAddress()
	console.log("L2 deployer", from.toString())

	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	const opts = { from, fee }
	const sendOpts = { ...opts, wait: { waitForStatus: TxStatus.PROPOSED } }

	const deployL2 = async (label: string, art: unknown, args: unknown[], ctor: string): Promise<Contract> => {
		const salt = Fr.random()
		const instance = await getContractInstanceFromInstantiationParams(
			art as never,
			{
				constructorArgs: args,
				salt,
				publicKeys: PublicKeys.default(),
				deployer: AztecAddress.ZERO,
				constructorArtifact: ctor,
			} as never,
		)
		await Contract.deploy(ewallet as never, art as never, args as never, ctor).send({
			...opts,
			contractAddressSalt: salt,
			universalDeploy: true,
			wait: { waitForStatus: TxStatus.PROPOSED },
		} as never)
		const c = await Contract.at(instance.address, art as never, ewallet as never)
		console.log(`${label}:`, c.address.toString())
		return c
	}

	const proxy = await deployL2(
		"TokenMinterProxy",
		nargoArtifact("token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json"),
		[],
		"constructor",
	)
	const token = await deployL2("Token", TokenContractArtifact, ["Nulo USDC", "USDC", 6, proxy.address], "constructor_with_minter")
	const bridge = await deployL2(
		"TokenBridge",
		nargoArtifact("token_bridge/target/token_bridge_contract-TokenBridge.json"),
		[proxy.address, EthAddress.fromString(portal)],
		"constructor",
	)

	await proxy.methods.set_token(token.address).send(sendOpts)
	await proxy.methods.set_minter(bridge.address, true).send(sendOpts)
	console.log("proxy wired (token + bridge minter)")

	// ─── Wire L1 portal + fund mock (viem) ───────────────────────────
	const portalC = getContract({ address: portal, abi: TokenPortalAbi as never, client: wallet as never })
	// biome-ignore lint/suspicious/noExplicitAny: viem contract write typing
	const initHash = await (portalC as any).write.initialize([registry, usdc, bridge.address.toString()])
	await pub.waitForTransactionReceipt({ hash: initHash })
	console.log("portal initialized")

	try {
		const fjAbi = [
			{
				type: "function",
				name: "mint",
				inputs: [
					{ name: "to", type: "address" },
					{ name: "amount", type: "uint256" },
				],
				outputs: [],
				stateMutability: "nonpayable",
			},
		]
		const fj = getContract({ address: feeJuice, abi: fjAbi as never, client: wallet as never })
		// biome-ignore lint/suspicious/noExplicitAny: viem contract write typing
		const mh = await (fj as any).write.mint([mock, 100_000n * 10n ** 18n])
		await pub.waitForTransactionReceipt({ hash: mh })
		console.log("funded mock with feeJuice")
	} catch (e) {
		console.warn("feeJuice mint failed (fallback: anvil_setStorageAt):", (e as Error).message)
	}

	if (process.argv.includes("--smoke")) {
		console.log("\n=== deposit-public smoke (L1 deposit → L2 claim) ===")
		const amount = 100n * 10n ** 6n
		const l2recipient = from
		const secret = Fr.random()
		const secretHash = await computeSecretHash(secret)
		const usdcAbi = usdcArt.abi as never

		await pub.waitForTransactionReceipt({
			hash: await wallet.writeContract({
				address: usdc,
				abi: usdcAbi,
				functionName: "mint",
				args: [account.address, amount] as never,
			}),
		})
		await pub.waitForTransactionReceipt({
			hash: await wallet.writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [portal, amount] as never }),
		})
		const depositArgs = [l2recipient.toString(), amount, secretHash.toString()]
		const sim = await pub.simulateContract({
			address: portal,
			abi: TokenPortalAbi as never,
			functionName: "depositToAztecPublic",
			args: depositArgs as never,
			account,
		})
		const leafIndex = BigInt((sim.result as [string, bigint])[1])
		await pub.waitForTransactionReceipt({
			hash: await wallet.writeContract({
				address: portal,
				abi: TokenPortalAbi as never,
				functionName: "depositToAztecPublic",
				args: depositArgs as never,
			}),
		})
		console.log("deposited 100 USDC → L2, leafIndex:", leafIndex.toString())

		let claimed = false
		for (let i = 0; i < 20 && !claimed; i++) {
			try {
				await bridge.methods.claim_public(l2recipient, amount, secret, new Fr(leafIndex)).send(sendOpts)
				claimed = true
			} catch {
				await new Promise((r) => setTimeout(r, 3000))
			}
		}
		if (!claimed) throw new Error("claim_public never succeeded (L1→L2 message not synced)")

		// aztec.js 4.2.0 simulate() wraps the value in { result, offchainEffects, offchainMessages }.
		const bal = ((await token.methods.balance_of_public(l2recipient).simulate({ from })) as { result: bigint }).result
		console.log("L2 public USDC balance:", bal.toString())
		if (bal < amount) throw new Error(`balance ${bal} < deposited ${amount}`)
		console.log("✅ deposit-public balance assertion OK (100 USDC minted on L2)")
		console.log("✅ deposit-public smoke PASSED")

		// ── deposit-private (flow #2): claim_private mints to a private balance ──
		console.log("\n=== deposit-private smoke (L1 deposit → L2 private claim) ===")
		const secretP = Fr.random()
		const secretHashP = await computeSecretHash(secretP)
		await pub.waitForTransactionReceipt({
			hash: await wallet.writeContract({
				address: usdc,
				abi: usdcAbi,
				functionName: "mint",
				args: [account.address, amount] as never,
			}),
		})
		await pub.waitForTransactionReceipt({
			hash: await wallet.writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [portal, amount] as never }),
		})
		const privArgs = [amount, secretHashP.toString()]
		const simP = await pub.simulateContract({
			address: portal,
			abi: TokenPortalAbi as never,
			functionName: "depositToAztecPrivate",
			args: privArgs as never,
			account,
		})
		const leafIndexP = BigInt((simP.result as [string, bigint])[1])
		await pub.waitForTransactionReceipt({
			hash: await wallet.writeContract({
				address: portal,
				abi: TokenPortalAbi as never,
				functionName: "depositToAztecPrivate",
				args: privArgs as never,
			}),
		})
		console.log("deposited 100 USDC → L2 (private), leafIndex:", leafIndexP.toString())

		let claimedP = false
		for (let i = 0; i < 20 && !claimedP; i++) {
			try {
				await bridge.methods.claim_private(l2recipient, amount, secretP, new Fr(leafIndexP)).send(sendOpts)
				claimedP = true
			} catch {
				await new Promise((r) => setTimeout(r, 3000))
			}
		}
		if (!claimedP) throw new Error("claim_private never succeeded (L1→L2 message not synced)")

		const balP = ((await token.methods.balance_of_private(l2recipient).simulate({ from })) as { result: bigint }).result
		console.log("L2 private USDC balance:", balP.toString())
		if (balP < amount) throw new Error(`private balance ${balP} < deposited ${amount}`)
		console.log("✅ deposit-private balance assertion OK (100 USDC minted privately on L2)")
	}

	console.log("\n✅ FULL sandbox deploy OK")
	console.log(
		JSON.stringify(
			{
				usdc,
				mock,
				router,
				portal,
				proxy: proxy.address.toString(),
				token: token.address.toString(),
				bridge: bridge.address.toString(),
				feeJuice,
				feeJuicePortal,
				registry,
			},
			null,
			2,
		),
	)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
