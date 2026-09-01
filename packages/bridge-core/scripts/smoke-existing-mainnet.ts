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
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { privateKeyToAccount } from "viem/accounts"
import { preexistingFeeJuicePayment } from "../src/fee-juice"
import { requirePinnedSigner } from "./live-intent"
import { depositViaRouter, ERC20_MIN_ABI } from "./script-l1"
import { claimTokensUntilSynced, deployerSchnorrAccount, registerManifestTrio } from "./script-l2"
import { createL1Clients, createL2Wallet, createNode, mainnetChain, stopwatch } from "./script-bootstrap"

const ETH_RPC = process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://lb.drpc.live/aztec-mainnet/Ak_eT5HA2kbyqamqGTF702cdsdWqLTIR8YdadmahlY6k"
const PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("MAINNET_PRIVATE_KEY required (packages/bridge-core/.env)")

const configArg = process.argv.indexOf("--config")
if (configArg === -1) throw new Error("pass --config apps/faucet/public/mainnet-bridge.candidate.json")
const isPrivate = process.argv.includes("--private")

const CONFIG = JSON.parse(readFileSync(process.argv[configArg + 1] as string, "utf8"))

const mainnet = mainnetChain(ETH_RPC)

/**
 * Account instances are NOT served by node.getContract (observed live: the FPC deployed AFTER
 * the account became visible while the account never did) — the serveable existence proof is the
 * PUBLIC fee-juice balance (public state reads at checkpoint level; a positive balance proves the
 * account-deploy tx landed, since the claim and the deploy were one tx).
 */
async function assertDeployerLanded(ewallet: unknown, from: AztecAddress): Promise<void> {
	const { FeeJuiceContractArtifact } = await import("@aztec/noir-contracts.js/FeeJuice")
	const { feeJuiceAddress } = await import("../src/fee-juice")
	const fj = await Contract.at(AztecAddress.fromStringUnsafe(feeJuiceAddress), FeeJuiceContractArtifact as never, ewallet as never)
	const r = (await fj.methods.balance_of_public(from).simulate({ from })) as { result?: bigint } | bigint
	const bal = typeof r === "bigint" ? r : (r.result ?? 0n)
	if (bal <= 0n) throw new Error(`L2 deployer ${from} has no public FJ — run the conductor's L2 group first; STOP`)
	console.log(`L2 deployer landed (public FJ ${bal})`)
}

async function main() {
	const mins = stopwatch()

	// ─── L1 (Ethereum mainnet, viem) ─────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	const pinned = requirePinnedSigner("mainnet")
	if (account.address.toLowerCase() !== pinned.toLowerCase()) throw new Error("L1 funder != plan-pinned mainnet signer; STOP")
	console.log("L1 funder", account.address)
	const { wallet, pub } = createL1Clients({ chain: mainnet, rpcUrl: ETH_RPC, account })

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
		abi: ERC20_MIN_ABI,
		functionName: "balanceOf",
		args: [account.address],
	})) as bigint
	if (usdcBal < amount) throw new Error(`USDC balance ${usdcBal} < smoke amount ${amount}; STOP`)

	// ─── L2: the FUNDED mainnet deployer pays its own fees ───────────
	// Kept for parity with the testnet smoke even though nothing reads it here.
	const _node = createNode(NODE_URL)
	const ewallet = await createL2Wallet({ nodeUrl: NODE_URL, proverEnabled: true })
	const { from } = await deployerSchnorrAccount(ewallet as never, "mainnet")
	await assertDeployerLanded(ewallet, from)
	console.log("L2 smoke account (the funded deployer)", from.toString())
	const fee = { paymentMethod: preexistingFeeJuicePayment(from) }
	const sendOpts = { from, fee, wait: { waitForStatus: TxStatus.PROPOSED } }

	const { token, bridge } = await registerManifestTrio(ewallet, CONFIG)

	// ─── Deposit (the app's router path) → claim ─────────────────────
	const dep = await depositViaRouter(
		{ pub, wallet, account },
		{
			usdc,
			usdcAbi: ERC20_MIN_ABI,
			core: routerCore,
			portal,
			amount,
			recipient: from.toString(),
			isPrivate,
			claimSalt: isPrivate ? Fr.random() : undefined,
			chainId: 1,
			mins,
		},
	)
	console.log(`deposited ${amount} USDC-units → L2 via router (${isPrivate ? "private" : "public"}), leaf ${dep.leafIndex} (${mins()})`)

	await claimTokensUntilSynced({
		bridge,
		isPrivate,
		recipient: from,
		amount,
		claimValue: dep.claimValue,
		leafIndex: dep.leafIndex,
		sendOpts,
	})

	const bal = isPrivate
		? ((await token.methods.balance_of_private(from).simulate({ from })) as { result: bigint }).result
		: ((await token.methods.balance_of_public(from).simulate({ from })) as { result: bigint }).result
	if (bal < amount) throw new Error(`balance ${bal} < deposited ${amount}`)
	console.log(`\n✅ MAINNET ${isPrivate ? "PRIVATE " : ""}smoke PASSED — ${amount} USDC-units bridged + claimed in ${mins()}.`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
