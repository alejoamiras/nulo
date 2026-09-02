/**
 * Full Nulo bridge deploy onto the running local sandbox: L1 (viem) + L2 (aztec.js).
 *
 * L1: anvil_setCode Permit2 (bytecode from Sepolia), then MintableERC20 +
 *     MockSwapTarget + SwapBridgeRouter + canonical TokenPortal (all via viem).
 * L2: token_minter_proxy, aztec-standards Token (minter = proxy), our token_bridge
 *     (proxy, portal) — via aztec.js, mirroring tools/scripts/deploy.ts plumbing
 *     (EmbeddedWallet + sponsored fee). The mock stands in for V4 (codex verdict c).
 * Wire: portal.initialize(registry, usdc, bridge); proxy.set_token + set_bridge(bridge);
 *     fund the mock with sandbox feeJuice.
 *
 * Run: bun run deploy:sandbox   (from packages/bridge-core)
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createL1Clients, createL1PublicClient, createL2Wallet, createNode } from "./script-bootstrap"
import { GasFees } from "@aztec/stdlib/gas"
import { registerInitialLocalNetworkAccountsInWallet } from "@aztec/wallets/testing"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TokenPortalAbi, TokenPortalBytecode } from "@aztec/l1-artifacts"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { defineChain, getContract } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { runRouterDeposit } from "../src/flows"
import { SWAP_BRIDGE_ROUTER_ABI } from "../src/router-abi"

const SANDBOX_RPC = process.env.SANDBOX_L1_RPC ?? "http://localhost:8545"
const TOKEN_NAME = "Nulo USDC"
const TOKEN_SYMBOL = "USDC"
const TOKEN_DECIMALS = 6

const NODE_URL = process.env.SANDBOX_NODE_URL ?? "http://localhost:8080"
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const
const ACCOUNT0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "..", "..", "..", "contracts", "bridge", "evm", "out")
const AZTEC = join(here, "..", "..", "..", "contracts", "bridge", "aztec")

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

/**
 * Wait until a bridged L1→L2 message is CLAIMABLE. rc.2 mints no empty L2 blocks, so after an L1
 * deposit the node/PXE anchor stalls below the message's checkpoint forever and the claim's
 * membership witness can't be built ("Tried to consume nonexistent L1-to-L2 message") — even though
 * the pre-send SIMULATION passes optimistically. `forceBlock` submits a cheap L2 tx each poll to
 * advance the anchor. Mirrors apps/extension/tests/e2e/fixtures/aztec.ts:waitForL1ToL2Message.
 */
async function waitForL1ToL2Message(
	node: ReturnType<typeof createNode>,
	messageHash: string,
	forceBlock: () => Promise<unknown>,
	timeoutMs = 180_000,
): Promise<void> {
	const hash = Fr.fromString(messageHash)
	const start = Date.now()
	let msgCp: bigint | undefined
	while (Date.now() - start < timeoutMs) {
		const cp = await node.getL1ToL2MessageCheckpoint(hash)
		if (cp !== undefined && cp !== null) {
			msgCp = BigInt(cp)
			console.log(`  message checkpointed at ${msgCp} (${Date.now() - start}ms)`)
			break
		}
		await forceBlock().catch(() => {})
		await new Promise((r) => setTimeout(r, 1500))
	}
	if (msgCp === undefined) throw new Error(`message ${messageHash} not checkpointed within ${timeoutMs}ms`)
	while (Date.now() - start < timeoutMs) {
		const latest = await node.getBlockData("latest")
		if (latest && BigInt(latest.checkpointNumber) >= msgCp) {
			console.log(`  claimable: anchor checkpoint ${latest.checkpointNumber} >= ${msgCp} (${Date.now() - start}ms)`)
			return
		}
		await forceBlock().catch(() => {})
		await new Promise((r) => setTimeout(r, 1500))
	}
	console.warn(`  anchor did not reach checkpoint ${msgCp} within ${timeoutMs}ms — proceeding best-effort`)
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (197 lines) — split when touched, never grow
async function main() {
	// ─── L1 (viem) ───────────────────────────────────────────────────
	const account = privateKeyToAccount(ACCOUNT0_KEY)
	const { wallet, pub } = createL1Clients({ chain: sandbox, rpcUrl: SANDBOX_RPC, account })
	const { registry, feeJuice, feeJuicePortal } = await nodeAddrs()
	console.log("registry", registry, "feeJuice", feeJuice, "feeJuicePortal", feeJuicePortal)

	// Peculiar on purpose: a sandbox-chain-tagged client over the SEPOLIA
	// transport, used only to copy the real Permit2 bytecode down.
	const permit2Code = await createL1PublicClient({ chain: sandbox, rpcUrl: SEPOLIA_RPC }).getCode({ address: PERMIT2 })
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
	const usdc = await deployEvm("MintableERC20", usdcArt.abi, usdcArt.bytecode, [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, 1000n])
	const mockArt = evmArtifact("MockSwapTarget")
	const mock = await deployEvm("MockSwapTarget", mockArt.abi, mockArt.bytecode, [feeJuice])
	const routerArt = evmArtifact("SwapBridgeRouter")
	const router = await deployEvm("SwapBridgeRouter", routerArt.abi, routerArt.bytecode, [PERMIT2, feeJuicePortal, mock])
	const portal = await deployEvm("TokenPortal", TokenPortalAbi, TokenPortalBytecode as `0x${string}`, [])

	// ─── L2 (aztec.js) ───────────────────────────────────────────────
	const node = createNode(NODE_URL)
	// proverEnabled: false is the DELIBERATE sandbox-vs-live delta (local anvil
	// dev loop, no real funds) — stated here because required param, not silent.
	const ewallet = await createL2Wallet({ nodeUrl: NODE_URL, proverEnabled: false })
	// rc.2 --local-network: the funded test accounts are PRE-DEPLOYED at genesis; register them.
	// (The stale getInitialTestAccountsData + createSchnorrAccount path was for the old --sandbox and
	// fails "Failed to get a note" — the account/FPC it derives isn't the genesis-funded one.)
	const accounts = await registerInitialLocalNetworkAccountsInWallet(ewallet as never)
	const from = accounts[0]
	const relayer = accounts[1] // a DIFFERENT funded account for the relayer-claim leg (Phase 4)
	console.log("L2 deployer", from.toString(), "relayer", relayer?.toString())

	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	// rc.2 raised the L2 base fee ~4 orders of magnitude; setup txs need a generous maxFeesPerGas
	// ceiling or they reject with "maxFeesPerGas.feePerL2Gas must be >= gasFees" (see e2e fixtures).
	const E2E_FEE_GAS = { maxFeesPerGas: new GasFees(10n ** 13n, 10n ** 13n) }
	const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address), gasSettings: E2E_FEE_GAS }
	const opts = { from, fee }
	const sendOpts = { ...opts, wait: { waitForStatus: TxStatus.CHECKPOINTED } }

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
		// 5.0: salt + universalDeploy are construction-time DeployInstantiationOptions, NOT send options.
		// Passing them to .send() is silently ignored → the deploy lands at the wallet-as-deployer /
		// default-salt address, DIFFERENT from the deployer=ZERO instance computed above ("not deployed").
		await Contract.deploy(ewallet as never, art as never, args as never, ctor, {
			salt,
			universalDeploy: true,
		} as never).send({
			...opts,
			wait: { waitForStatus: TxStatus.CHECKPOINTED },
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
	const token = await deployL2(
		"Token",
		TokenContractArtifact,
		// 5.0.1 standards Token: 5th constructor param auth_contract (ZERO = none).
		[TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, proxy.address, AztecAddress.ZERO],
		"constructor_with_minter",
	)
	const bridge = await deployL2(
		"TokenBridge",
		nargoArtifact("token_bridge/target/token_bridge_contract-TokenBridge.json"),
		[proxy.address, EthAddress.fromString(portal)],
		"constructor",
	)

	await proxy.methods.set_token(token.address).send(sendOpts)
	await proxy.methods.set_bridge(bridge.address).send(sendOpts)
	console.log("proxy wired (token + sole bridge minter)")

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
		const amount = 100n * 10n ** 6n
		const usdcAbi = usdcArt.abi as never
		const l1ctx = { pub, wallet, account }
		const DEADLINE = 9_999_999_999n
		// Permit2 SignatureTransfer nonces are single-use and the anvil L1 state PERSISTS across reruns
		// (the aztec node is bound to it, so it can't be reset), so use a fresh RANDOM nonce per deposit —
		// a sequential 0,1,2 collides with a prior run and reverts InvalidNonce (0x756688fe).
		const mintUsdc = async () => {
			await pub.waitForTransactionReceipt({
				hash: await wallet.writeContract({
					address: usdc,
					abi: usdcAbi,
					functionName: "mint",
					args: [account.address, amount] as never,
				}),
			})
		}
		const routerDeposit = (isPrivate: boolean, claimSalt?: Fr) =>
			runRouterDeposit(l1ctx as never, {
				router,
				routerAbi: SWAP_BRIDGE_ROUTER_ABI as never,
				permit2: PERMIT2,
				tokenPortal: portal,
				bridgeToken: usdc,
				amount,
				aztecRecipient: from.toString() as `0x${string}`,
				isPrivate,
				claimSalt,
				swapTarget: mock,
				nonce: Fr.random().toBigInt(),
				deadline: DEADLINE,
				chainId: 31337,
			})
		// Claims wait for PROPOSED (in a block proposal), NOT CHECKPOINTED — a checkpoint is a PROVEN
		// state and is far slower with proving disabled (deploys need CHECKPOINTED to be queryable; a
		// claim only needs to land, and the balance simulate reads proposed state). Using CHECKPOINTED
		// here makes every send's wait time out → the loop re-sends forever though the message is
		// consumable (simulation returns revertCode 0).
		const claimOpts = { ...opts, wait: { waitForStatus: TxStatus.PROPOSED } }
		// biome-ignore lint/suspicious/noExplicitAny: aztec.js method typing
		const claimLoop = async (mk: () => any, label: string, send: unknown = claimOpts) => {
			for (let i = 0; i < 60; i++) {
				try {
					await mk().send(send as never)
					return
				} catch (e) {
					if (i % 5 === 0) console.log(`[${label}] attempt ${i} failed:`, (e as Error).message?.slice(0, 300))
					await new Promise((r) => setTimeout(r, 3000))
				}
			}
			throw new Error(`${label} never succeeded (L1→L2 message not synced)`)
		}
		const privBal = async (): Promise<bigint> =>
			((await token.methods.balance_of_private(from).simulate({ from })) as { result: bigint }).result
		// rc.2 mints no empty L2 blocks, so a cheap 0-amount self-transfer advances the anchor past the
		// deposit's L1→L2 message checkpoint (the real claimability condition). Balance-independent.
		const forceBlock = () => token.methods.transfer_public_to_private(from, from, 0n, 0n).send(claimOpts as never)

		// ── (a) PUBLIC bridge via router.bridge() → claim_public ──
		console.log("\n=== deposit-public via router.bridge() ===")
		await mintUsdc()
		const pubRes = await routerDeposit(false)
		console.log("public bridge() deposited, leafIndex:", pubRes.leafIndex.toString())
		await waitForL1ToL2Message(node, pubRes.messageHashHex, forceBlock)
		await claimLoop(
			() => bridge.methods.claim_public(from, amount, Fr.fromString(pubRes.claimValueHex), new Fr(pubRes.leafIndex)),
			"claim_public",
		)
		const balPub = ((await token.methods.balance_of_public(from).simulate({ from })) as { result: bigint }).result
		if (balPub < amount) throw new Error(`public balance ${balPub} < ${amount}`)
		console.log("✅ deposit-public via router PASSED, L2 public balance:", balPub.toString())

		// ── (c) PRIVATE bridge via router.bridge() with a recipient-committed salt → claim_private(salt) ──
		console.log("\n=== deposit-private via router.bridge() (recipient-committed) ===")
		await mintUsdc()
		const salt = Fr.random()
		const privRes = await routerDeposit(true, salt)
		console.log("private bridge() deposited, leafIndex:", privRes.leafIndex.toString())
		await waitForL1ToL2Message(node, privRes.messageHashHex, forceBlock)
		// claimValueHex IS the salt for the private path; claim_private re-derives the secret in-circuit.
		const balPrivBefore = await privBal()
		await claimLoop(
			() => bridge.methods.claim_private(from, amount, Fr.fromString(privRes.claimValueHex), new Fr(privRes.leafIndex)),
			"claim_private (self)",
		)
		if ((await privBal()) - balPrivBefore < amount) throw new Error("private self-claim did not mint")
		console.log("✅ deposit-private self-claim PASSED — the recipient-commitment circuit consumed a real L1→L2 message")

		// ── RELAYER (F-007 closure): account[1] submits claim_private FOR account[0]; wrong recipient must fail first ──
		console.log("\n=== relayer claim + wrong-recipient rejection ===")
		await mintUsdc()
		const salt2 = Fr.random()
		const relRes = await routerDeposit(true, salt2)
		await waitForL1ToL2Message(node, relRes.messageHashHex, forceBlock)
		const relayerSend = { ...opts, from: relayer, wait: { waitForStatus: TxStatus.PROPOSED } }
		// Wrong recipient BEFORE consuming: claim to `relayer` with salt2 derives a different secret → must fail.
		let wrongRejected = false
		try {
			await bridge.methods
				.claim_private(relayer, amount, Fr.fromString(salt2.toString()), new Fr(relRes.leafIndex))
				.send(relayerSend as never)
		} catch {
			wrongRejected = true
		}
		if (!wrongRejected) throw new Error("SECURITY FAILURE: wrong-recipient claim_private SUCCEEDED — recipient-commitment is broken")
		console.log("✅ wrong-recipient claim rejected (the binding holds — a relayer cannot redirect)")
		// Correct: the RELAYER (account[1] ≠ recipient) submits the claim for account[0]; funds land at account[0].
		const balBefore = await privBal()
		await claimLoop(
			() => bridge.methods.claim_private(from, amount, Fr.fromString(salt2.toString()), new Fr(relRes.leafIndex)),
			"relayer claim_private",
			relayerSend,
		)
		if ((await privBal()) - balBefore < amount) throw new Error("relayer claim: recipient balance did not increase")
		console.log("✅ relayer claim PASSED — account[1] finished account[0]'s deposit; funds landed at account[0] (F-007 closed)")
		console.log("\n✅ ALL PHASE-4 SMOKE FLOWS PASSED (router deposits + recipient-committed claims + relayer)")
	}

	const deployment = {
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
		l2Account: from.toString(),
		l1Rpc: SANDBOX_RPC,
		nodeUrl: NODE_URL,
	}
	// Written to a local dir for manual inspection of a sandbox deploy (addresses + RPC ports).
	const outDir = join(here, "..", "sandbox-deploy")
	mkdirSync(outDir, { recursive: true })
	writeFileSync(join(outDir, "sandbox.json"), `${JSON.stringify(deployment, null, 2)}\n`)
	copyFileSync(join(AZTEC, "token_bridge/target/token_bridge_contract-TokenBridge.json"), join(outDir, "token_bridge.json"))
	console.log("\n✅ FULL sandbox deploy OK — wrote sandbox-deploy/{sandbox,token_bridge}.json")
	console.log(JSON.stringify(deployment, null, 2))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
