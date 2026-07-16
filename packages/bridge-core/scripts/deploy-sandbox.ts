/**
 * Full Nulo bridge deploy onto the running local sandbox: L1 (viem) + L2 (aztec.js).
 *
 * L1: anvil_setCode Permit2 (bytecode from Sepolia), then MintableERC20 +
 *     MockSwapTarget + SwapBridgeRouter + canonical TokenPortal (all via viem).
 * L2: token_minter_proxy, aztec-standards Token (minter = proxy), our token_bridge
 *     (proxy, portal) — via aztec.js, mirroring faucet/scripts/deploy.ts plumbing
 *     (EmbeddedWallet + sponsored fee). The mock stands in for V4 (codex verdict c).
 * Wire: portal.initialize(registry, usdc, bridge); proxy.set_token + set_bridge(bridge);
 *     fund the mock with sandbox feeJuice.
 *
 * Run: bun run deploy:sandbox   (from packages/bridge-core)
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getInitialTestAccountsData } from "@aztec/accounts/testing"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization"
import { Contract, getContractInstanceFromInstantiationParams, waitForProven } from "@aztec/aztec.js/contracts"
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
import { createPublicClient, createWalletClient, defineChain, getContract, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const SANDBOX_RPC = process.env.SANDBOX_L1_RPC ?? "http://localhost:8545"
const TOKEN_NAME = "Nulo USDC"
const TOKEN_SYMBOL = "USDC"
const TOKEN_DECIMALS = 6

const NODE_URL = process.env.SANDBOX_NODE_URL ?? "http://localhost:8080"
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const
const ACCOUNT0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const

const here = dirname(fileURLToPath(import.meta.url))
// Artifact dirs default to the repo layout; env overrides let the script run from an isolated
// install (e.g. a clean single-copy @aztec 5.0.1 closure) while reading the real artifacts.
const OUT = process.env.BRIDGE_EVM_OUT ?? join(here, "..", "..", "..", "contracts", "bridge", "evm", "out")
const AZTEC = process.env.BRIDGE_AZTEC_DIR ?? join(here, "..", "..", "..", "contracts", "bridge", "aztec")

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

// AztecProtocol/aztec-standards@v5.0.1 Token — the token the minter proxy mints (see
// token_minter_proxy/Nargo.toml, which resolves the same clone side-by-side with this repo).
// TODO(after 2026-07-23): swap for the npm package once it ages past bunfig's 7-day
// minimumReleaseAge gate (published 2026-07-16):
//   import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
const STANDARDS = process.env.AZTEC_STANDARDS_DIR ?? join(here, "..", "..", "..", "..", "aztec-standards")
const TokenContractArtifact = loadContractArtifact(JSON.parse(readFileSync(join(STANDARDS, "target", "token_contract-Token.json"), "utf8")))

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
	const usdc = await deployEvm("MintableERC20", usdcArt.abi, usdcArt.bytecode, [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, 1000n])
	const mockArt = evmArtifact("MockSwapTarget")
	const mock = await deployEvm("MockSwapTarget", mockArt.abi, mockArt.bytecode, [feeJuice])
	const routerArt = evmArtifact("SwapBridgeRouter")
	const router = await deployEvm("SwapBridgeRouter", routerArt.abi, routerArt.bytecode, [PERMIT2, feeJuicePortal, mock])
	const portal = await deployEvm("TokenPortal", TokenPortalAbi, TokenPortalBytecode as `0x${string}`, [])

	// ─── L2 (aztec.js) ───────────────────────────────────────────────
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: false } })
	const [acct] = await getInitialTestAccountsData()
	// 5.0.1 local-network pre-deploys its funded test accounts as SchnorrInitializerlessAccount.
	// Re-derive with the matching flavor so `from` resolves to the deployed+funded on-chain account
	// (createSchnorrAccount would yield a different, undeployed address → "Failed to get a note").
	const manager = await ewallet.createSchnorrInitializerlessAccount(acct.secret, acct.salt, acct.signingKey)
	const deployer = await manager.getAccount()
	const from = deployer.getAddress()
	console.log("L2 deployer", from.toString())

	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	const opts = { from, fee }
	// Wait for CHECKPOINTED (not just PROPOSED): each step here depends on the previous one's state
	// being committed to world state. A public call on a contract deployed only to PROPOSED reverts
	// with "Contract ... is not deployed" — the public bytecode isn't queryable until checkpointed.
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
		// 5.0.1: salt + universalDeploy are construction-time DeployInstantiationOptions (the 5th arg
		// of Contract.deploy), NOT send options. In 5.0.0 they were passed to .send(); passing them
		// there now is silently ignored, so the deploy lands at a different (default-salt) address than
		// the separately-computed `instance.address`, and later calls hit "Contract ... is not deployed".
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
		// v5.0.1 AztecProtocol/aztec-standards token: constructor_with_minter gained a 5th arg,
		// `auth_contract` (per-transfer authorization contract; ZERO disables it → standard authwit).
		// minter = proxy, auth_contract = ZERO — matches the passing bridge_integration TXE test.
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
		for (let i = 0; i < 200 && !claimed; i++) {
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
		for (let i = 0; i < 200 && !claimedP; i++) {
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

		// ── withdraw-public (flow #4): exit_to_l1 → proven → L1 Outbox consume ──
		console.log("\n=== withdraw-public smoke (L2 burn → L1 Outbox consume) ===")
		const wAmount = 40n * 10n ** 6n
		const wNonce = Fr.random()
		// Authorize the proxy (the direct caller of token.burn_public) to burn the deployer's public tokens.
		const authwit = await SetPublicAuthwitContractInteraction.create(
			ewallet as never,
			from,
			{ caller: proxy.address, action: token.methods.burn_public(from, wAmount, wNonce) } as never,
			true,
		)
		await authwit.send(sendOpts)
		const { receipt: exitReceipt } = await bridge.methods
			.exit_to_l1_public(EthAddress.fromString(account.address), wAmount, EthAddress.ZERO, wNonce)
			.send(sendOpts)
		const exitTxHash = exitReceipt.txHash
		console.log("exit_to_l1 sent, txHash:", exitTxHash.toString())

		await waitForProven(node, exitReceipt)
		const eff = await node.getTxEffect(exitTxHash)
		if (!eff) throw new Error("no tx effect for exit")
		const messageHash = eff.data.l2ToL1Msgs[0]
		if (!messageHash) throw new Error("no L2→L1 message in exit tx")
		// 5.0.1: the node RPC builds the witness (picks the smallest partial-proof Outbox root covering the tx).
		const wit = await node.getL2ToL1MembershipWitness(exitTxHash, messageHash, 0)
		if (!wit) throw new Error("L2→L1 witness not available")
		console.log(
			"withdraw witness: epoch",
			wit.epochNumber,
			"numCheckpoints",
			wit.numCheckpointsInEpoch,
			"leafIndex",
			wit.leafIndex.toString(),
		)

		const path = wit.siblingPath.toBufferArray().map((b: Buffer) => `0x${b.toString("hex")}` as `0x${string}`)
		const balOf = async (): Promise<bigint> =>
			(
				await pub.simulateContract({
					address: usdc,
					abi: usdcAbi,
					functionName: "balanceOf",
					args: [account.address] as never,
					account,
				})
			).result as bigint
		const usdcBefore = await balOf()
		const wReq = await pub.simulateContract({
			address: portal,
			abi: TokenPortalAbi as never,
			functionName: "withdraw",
			// 5.0.1 portal ABI: withdraw() gained _numCheckpointsInEpoch (partial-proof Outbox roots).
			args: [
				account.address,
				wAmount,
				false,
				BigInt(wit.epochNumber),
				BigInt(wit.numCheckpointsInEpoch),
				wit.leafIndex,
				path,
			] as never,
			account,
		})
		await pub.waitForTransactionReceipt({ hash: await wallet.writeContract(wReq.request as never) })
		const withdrawn = (await balOf()) - usdcBefore
		console.log("L1 USDC withdrawn:", withdrawn.toString())
		if (withdrawn < wAmount) throw new Error(`withdrew ${withdrawn} < ${wAmount}`)
		console.log("✅ withdraw-public smoke PASSED")

		// ── withdraw-private (flow #4b): exit_to_l1_private (private burn, private authwit) ──
		console.log("\n=== withdraw-private smoke (private L2 burn → L1 consume) ===")
		const wpAmount = 30n * 10n ** 6n
		const wpNonce = Fr.random()
		const ni = await node.getNodeInfo()
		const chainInfo = { chainId: new Fr(ni.l1ChainId), version: new Fr(ni.rollupVersion) }
		// 5.0.1: createAuthWit takes a CallIntent ({ caller, call: FunctionCall }), not an interaction.
		const burnAuthwit = await deployer.createAuthWit(
			{ caller: proxy.address, call: await token.methods.burn_private(from, wpAmount, wpNonce).getFunctionCall() },
			chainInfo,
		)
		const { receipt: exitPReceipt } = await bridge.methods
			.exit_to_l1_private(EthAddress.fromString(account.address), wpAmount, EthAddress.ZERO, wpNonce)
			.send({ ...sendOpts, authWitnesses: [burnAuthwit] })
		const exitPTxHash = exitPReceipt.txHash
		await waitForProven(node, exitPReceipt)
		const effP = await node.getTxEffect(exitPTxHash)
		if (!effP) throw new Error("no tx effect for private exit")
		const messageHashP = effP.data.l2ToL1Msgs[0]
		if (!messageHashP) throw new Error("no L2→L1 message in private exit")
		const witP = await node.getL2ToL1MembershipWitness(exitPTxHash, messageHashP, 0)
		if (!witP) throw new Error("private withdraw witness not available")
		const pathP = witP.siblingPath.toBufferArray().map((b: Buffer) => `0x${b.toString("hex")}` as `0x${string}`)
		const usdcBeforeP = await balOf()
		const wReqP = await pub.simulateContract({
			address: portal,
			abi: TokenPortalAbi as never,
			functionName: "withdraw",
			args: [
				account.address,
				wpAmount,
				false,
				BigInt(witP.epochNumber),
				BigInt(witP.numCheckpointsInEpoch),
				witP.leafIndex,
				pathP,
			] as never,
			account,
		})
		await pub.waitForTransactionReceipt({ hash: await wallet.writeContract(wReqP.request as never) })
		const withdrawnP = (await balOf()) - usdcBeforeP
		console.log("private: L1 USDC withdrawn:", withdrawnP.toString())
		if (withdrawnP < wpAmount) throw new Error(`private withdrew ${withdrawnP} < ${wpAmount}`)
		console.log("✅ withdraw-private smoke PASSED")
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
