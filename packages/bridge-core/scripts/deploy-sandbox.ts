/**
 * Deploy the Nulo bridge L1 layer onto the running local sandbox anvil.
 *
 * Sandbox has no Uniswap V4 + no Permit2, so we: setCode the canonical Permit2
 * (runtime bytecode fetched from Sepolia) at its canonical address, then deploy
 * MintableERC20 + MockSwapTarget + SwapBridgeRouter (the mock stands in for the
 * V4 swap — codex verdict c). feeJuice + feeJuicePortal are read from the node
 * at runtime (sandbox-instance-specific). L2 (TokenPortal + token/bridge) is a
 * follow-up via aztec.js.
 *
 * Run: bun run packages/bridge-core/scripts/deploy-sandbox.ts
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPublicClient, createWalletClient, defineChain, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const SANDBOX_RPC = process.env.SANDBOX_L1_RPC ?? "http://localhost:8545"
const NODE_URL = process.env.SANDBOX_NODE_URL ?? "http://localhost:8080"
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const
// Well-known anvil/hardhat account 0 (funded on the sandbox).
const ACCOUNT0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "..", "..", "bridge-evm", "out")

const sandbox = defineChain({
	id: 31337,
	name: "aztec-sandbox-l1",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SANDBOX_RPC] } },
})

function artifact(name: string): { abi: unknown[]; bytecode: `0x${string}` } {
	const j = JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8"))
	return { abi: j.abi, bytecode: j.bytecode.object as `0x${string}` }
}

async function nodeL1Addresses(): Promise<{ feeJuice: `0x${string}`; feeJuicePortal: `0x${string}` }> {
	const res = await fetch(NODE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "node_getNodeInfo", params: [] }),
	})
	const a = (await res.json()).result.l1ContractAddresses
	const pick = (v: unknown) => (typeof v === "object" && v ? (v as { value: string }).value : (v as string)) as `0x${string}`
	return { feeJuice: pick(a.feeJuiceAddress), feeJuicePortal: pick(a.feeJuicePortalAddress) }
}

async function main() {
	const account = privateKeyToAccount(ACCOUNT0_KEY)
	const wallet = createWalletClient({ account, chain: sandbox, transport: http(SANDBOX_RPC) })
	const pub = createPublicClient({ chain: sandbox, transport: http(SANDBOX_RPC) })

	const { feeJuice, feeJuicePortal } = await nodeL1Addresses()
	console.log("sandbox feeJuice:", feeJuice, "feeJuicePortal:", feeJuicePortal)

	// 1. Put canonical Permit2 on the sandbox anvil (MintableERC20 pre-approves it).
	const sepolia = createPublicClient({ chain: sandbox, transport: http(SEPOLIA_RPC) })
	const permit2Code = await sepolia.getCode({ address: PERMIT2 })
	if (!permit2Code) throw new Error("could not fetch Permit2 bytecode from Sepolia")
	await pub.request({ method: "anvil_setCode" as never, params: [PERMIT2, permit2Code] as never })
	console.log("Permit2 set at", PERMIT2, `(${permit2Code.length} bytes)`)

	// 2. Deploy our L1 contracts.
	const deploy = async (name: string, args: unknown[]): Promise<`0x${string}`> => {
		const art = artifact(name)
		const hash = await wallet.deployContract({ abi: art.abi as never, bytecode: art.bytecode, args: args as never })
		const rcpt = await pub.waitForTransactionReceipt({ hash })
		if (!rcpt.contractAddress) throw new Error(`${name} deploy: no contractAddress`)
		console.log(`${name}:`, rcpt.contractAddress)
		return rcpt.contractAddress
	}

	const usdc = await deploy("MintableERC20", ["Nulo USDC", "USDC", 6, 1000n])
	const mock = await deploy("MockSwapTarget", [feeJuice])
	const router = await deploy("SwapBridgeRouter", [PERMIT2, feeJuicePortal, mock])

	// 3. Verify wiring.
	const routerArt = artifact("SwapBridgeRouter")
	const swapTarget = await pub.readContract({ address: router, abi: routerArt.abi as never, functionName: "swapTarget" })
	if ((swapTarget as string).toLowerCase() !== mock.toLowerCase()) {
		throw new Error(`router.swapTarget ${swapTarget} != mock ${mock}`)
	}
	console.log("\n✅ L1 deploy OK")
	console.log(JSON.stringify({ usdc, mock, router, feeJuice, feeJuicePortal, permit2: PERMIT2 }, null, 2))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
