/**
 * PERSISTENT testnet bridge deploy for the faucet's Bridge tab (F4, decision A).
 *
 * Deploys the bridge's OWN set — L1: MintableERC20 USDC + canonical TokenPortal (Sepolia);
 * L2: token_minter_proxy + Token(minter=proxy) + token_bridge(proxy, portal) — with FIXED salts
 * (deterministic L2 addresses), wires them, and writes the addresses + L2 instantiation params
 * to `packages/faucet/public/testnet-bridge.json`, which the app rebuilds into registerable
 * instances (mirrors faucet/src/contracts/deployments.ts).
 *
 * Run ONCE (real proofs → ~8 min; L1 addresses are non-deterministic so re-running makes a fresh
 * set). From packages/bridge-core: `bun run scripts/deploy-bridge-testnet.ts`. Needs PRIVATE_KEY +
 * SEPOLIA_RPC_URL in packages/bridge-evm/.env; AZTEC_NODE_URL defaults to the public testnet RPC.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
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

// Fixed salts → deterministic L2 addresses (stable in the written config). Mirrors the faucet's
// small-integer salt convention (deployments.json: 4242 / 1337).
const PROXY_SALT = 0x5b01
const TOKEN_SALT = 0x5b02
const BRIDGE_SALT = 0x5b03

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "..", "..", "bridge-evm", "out")
const AZTEC = join(here, "..", "..", "bridge-aztec")
const CONFIG_PATH = join(here, "..", "..", "faucet", "public", "testnet-bridge.json")

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

	// ─── L1 (Sepolia) ────────────────────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	console.log("L1 deployer", account.address)
	const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
	const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
	const registry = await nodeRegistry()

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

	const deployL2 = async (label: string, art: unknown, args: unknown[], ctor: string, saltNum: number): Promise<Contract> => {
		const salt = new Fr(saltNum)
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
		PROXY_SALT,
	)
	const token = await deployL2(
		"Token",
		TokenContractArtifact,
		["Nulo USDC", "USDC", 6, proxy.address],
		"constructor_with_minter",
		TOKEN_SALT,
	)
	const bridge = await deployL2(
		"TokenBridge",
		nargoArtifact("token_bridge/target/token_bridge_contract-TokenBridge.json"),
		[proxy.address, EthAddress.fromString(portal)],
		"constructor",
		BRIDGE_SALT,
	)

	await proxy.methods.set_token(token.address).send(sendOpts)
	await proxy.methods.set_minter(bridge.address, true).send(sendOpts)
	console.log(`proxy wired (${mins()})`)

	const portalC = getContract({ address: portal, abi: TokenPortalAbi as never, client: wallet as never })
	// biome-ignore lint/suspicious/noExplicitAny: viem contract write typing
	const initHash = await (portalC as any).write.initialize([registry, usdc, bridge.address.toString()])
	await pub.waitForTransactionReceipt({ hash: initHash })
	console.log(`portal initialized (${mins()})`)

	// ─── Persist the config the app rebuilds instances from ──────────
	const config = {
		network: "testnet",
		l1: { usdc, portal },
		l2: {
			proxy: { address: proxy.address.toString(), salt: PROXY_SALT, constructorArtifact: "constructor", constructorArgs: [] },
			token: {
				address: token.address.toString(),
				salt: TOKEN_SALT,
				constructorArtifact: "constructor_with_minter",
				constructorArgs: ["Nulo USDC", "USDC", 6, proxy.address.toString()],
			},
			bridge: {
				address: bridge.address.toString(),
				salt: BRIDGE_SALT,
				constructorArtifact: "constructor",
				constructorArgs: [proxy.address.toString(), portal],
			},
		},
	}
	mkdirSync(dirname(CONFIG_PATH), { recursive: true })
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
	console.log(`\n✅ PERSISTENT testnet bridge deployed in ${mins()} — wrote faucet/public/testnet-bridge.json`)
	console.log(JSON.stringify(config, null, 2))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
