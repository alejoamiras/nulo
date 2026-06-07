/**
 * Live-testnet bridge DEPOSIT (the goal's live-testnet smoke). Deposit-only — no swap /
 * Permit2 / pools (those are fork-proven in bridge-evm).
 *
 * L1 (Sepolia, real PRIVATE_KEY via viem): MintableERC20 USDC + canonical TokenPortal.
 * L2 (testnet aztec, EmbeddedWallet with REAL proofs + sponsored FPC): a fresh Schnorr
 *     account, token_minter_proxy, aztec-standards Token (minter = proxy), our token_bridge.
 * Wire: portal.initialize(registry, usdc, bridge); proxy.set_token + set_minter(bridge).
 * Flow: mint USDC → approve → depositToAztecPublic → poll claim_public → assert L2 balance.
 *
 * Real proofs make every L2 tx take minutes — expect ~15-30 min end to end.
 * Run: bun run scripts/deposit-testnet.ts   (needs PRIVATE_KEY + SEPOLIA_RPC_URL in
 *      packages/bridge-evm/.env; AZTEC_NODE_URL defaults to the public testnet RPC).
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
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
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { createPublicClient, createWalletClient, defineChain, getContract, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://rpc.testnet.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-evm/.env)")

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "..", "..", "bridge-evm", "out")
const AZTEC = join(here, "..", "..", "bridge-aztec")

const sepolia = defineChain({
	id: 11155111,
	name: "sepolia",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SEPOLIA_RPC] } },
})

function evmArtifact(name: string): { abi: unknown[]; bytecode: `0x${string}` } {
	const j = JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8"))
	return { abi: j.abi, bytecode: j.bytecode.object as `0x${string}` }
}

function nargoArtifact(rel: string) {
	return loadContractArtifact(JSON.parse(readFileSync(join(AZTEC, rel), "utf8")))
}

async function nodeRegistry(): Promise<`0x${string}`> {
	const res = await fetch(NODE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "node_getNodeInfo", params: [] }),
	})
	const a = (await res.json()).result.l1ContractAddresses
	const pick = (v: unknown) => (typeof v === "object" && v ? (v as { value: string }).value : (v as string)) as `0x${string}`
	return pick(a.registryAddress)
}

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`

	// ─── L1 (Sepolia, viem) ──────────────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	console.log("L1 deployer", account.address)
	const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
	const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
	const registry = await nodeRegistry()
	console.log("testnet registry", registry)

	const deployEvm = async (name: string, abi: unknown, bytecode: `0x${string}`, args: unknown[]): Promise<`0x${string}`> => {
		const hash = await wallet.deployContract({ abi: abi as never, bytecode, args: args as never })
		const r = await pub.waitForTransactionReceipt({ hash })
		if (!r.contractAddress) throw new Error(`${name}: no contractAddress`)
		console.log(`${name}:`, r.contractAddress, `(${mins()})`)
		return r.contractAddress
	}

	const usdcArt = evmArtifact("MintableERC20")
	const usdc = await deployEvm("MintableERC20", usdcArt.abi, usdcArt.bytecode, ["Nulo USDC", "USDC", 6, 1000n])
	const portal = await deployEvm("TokenPortal", TokenPortalAbi, TokenPortalBytecode as `0x${string}`, [])

	// ─── L2 (testnet aztec.js — REAL proofs) ─────────────────────────
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const secret = Fr.random()
	const manager = await ewallet.createSchnorrAccount(secret, Fr.random(), deriveSigningKey(secret))
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

	if (!(await node.getContract(from))) {
		console.log(`deploying L2 account (real proof, ~minutes)… (${mins()})`)
		const deployMethod = await manager.getDeployMethod()
		// NO_FROM: first account deploy can't route through its own (not-yet-deployed) entrypoint.
		await deployMethod.send({ fee, from: "NO_FROM" as never } as never)
		console.log(`L2 account deployed (${mins()})`)
	}

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
		console.log(`${label}:`, c.address.toString(), `(${mins()})`)
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
	console.log(`proxy wired (${mins()})`)

	const portalC = getContract({ address: portal, abi: TokenPortalAbi as never, client: wallet as never })
	// biome-ignore lint/suspicious/noExplicitAny: viem contract write typing
	const initHash = await (portalC as any).write.initialize([registry, usdc, bridge.address.toString()])
	await pub.waitForTransactionReceipt({ hash: initHash })
	console.log(`portal initialized (${mins()})`)

	// ─── Deposit (public) → claim ────────────────────────────────────
	const usdcAbi = usdcArt.abi
	const amount = 100n * 10n ** 6n
	const l2recipient = from
	const claimSecret = Fr.random()
	const secretHash = await computeSecretHash(claimSecret)

	await pub.waitForTransactionReceipt({
		hash: await wallet.writeContract({
			address: usdc,
			abi: usdcAbi as never,
			functionName: "mint",
			args: [account.address, amount] as never,
		}),
	})
	await pub.waitForTransactionReceipt({
		hash: await wallet.writeContract({
			address: usdc,
			abi: usdcAbi as never,
			functionName: "approve",
			args: [portal, amount] as never,
		}),
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
	console.log(`deposited 100 USDC → L2, leafIndex ${leafIndex} (${mins()})`)

	let claimed = false
	for (let i = 0; i < 300 && !claimed; i++) {
		try {
			await bridge.methods.claim_public(l2recipient, amount, claimSecret, new Fr(leafIndex)).send(sendOpts)
			claimed = true
		} catch {
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!claimed) throw new Error("claim_public never succeeded (L1→L2 message not synced within budget)")

	const bal = ((await token.methods.balance_of_public(l2recipient).simulate({ from })) as { result: bigint }).result
	console.log(`L2 public USDC balance: ${bal} (${mins()})`)
	if (bal < amount) throw new Error(`balance ${bal} < deposited ${amount}`)
	console.log(`\n✅ LIVE-TESTNET deposit PASSED — 100 USDC bridged Sepolia → testnet L2 in ${mins()}`)
	console.log(
		JSON.stringify(
			{ usdc, portal, proxy: proxy.address.toString(), token: token.address.toString(), bridge: bridge.address.toString() },
			null,
			2,
		),
	)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
