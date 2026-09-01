/**
 * Pre-promotion smoke for a freshly-deployed CANDIDATE manifest. Registers the EXISTING L1/L2
 * contracts from the manifest (NO deploy) and runs a plain public deposit -> claim, asserting the
 * L2 balance. This is the candidate's gate before it is promoted to the live testnet-bridge.json.
 *
 * Unlike deposit-testnet.ts (which deploys a fresh set), this binds to the addresses already recorded
 * in the manifest, so it proves two things at once: the manifest is self-consistent (each L2 address
 * recomputes from its recorded salt + args, exactly as the faucet rebuilds it) AND the deployed set
 * actually bridges. The L2 recipient is a throwaway account; the deposit is funded by PRIVATE_KEY.
 *
 * Real proofs make the claim take minutes. Run:
 *   bun run scripts/smoke-existing-testnet.ts --config <path/to/testnet-bridge.candidate.json>
 * (needs PRIVATE_KEY + SEPOLIA_RPC_URL in packages/bridge-core/.env; AZTEC_NODE_URL defaults to the
 * public testnet RPC).
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Contract } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { privateKeyToAccount } from "viem/accounts"
import { evmAbi } from "./script-artifacts"
import { depositViaRouter, type RouterDepositEnv } from "./script-l1"
import { claimTokensUntilSynced, deployAccountIfAbsent, freshSchnorrAccount, registerManifestTrio, sponsoredFpcFee } from "./script-l2"
import { createL1Clients, createL2Wallet, createNode, loadManifestFromConfigArg, sepoliaChain, stopwatch } from "./script-bootstrap"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-core/.env)")

const CONFIG = loadManifestFromConfigArg(process.argv, {
	mode: "required",
	requiredHint: "apps/tools/public/testnet-bridge.candidate.json",
	// biome-ignore lint/suspicious/noExplicitAny: manifest fields are accessed via dynamic property paths without a formal schema, matching the original untyped JSON.parse.
	parse: (raw) => raw as any,
})
// --private exercises the recipient-committed path (the strand-risk gate): deposit commits to
// H(deriveTokenClaimSecret(salt, recipient)) and claim_private re-derives the secret in-circuit.
// --redirect-proof (implies private) additionally proves the CIRCUIT binding LIVE: a wrong recipient
// can't consume (Phase 7 step 3, fresh-audit H2).
const redirectProof = process.argv.includes("--redirect-proof")
const isPrivate = process.argv.includes("--private") || redirectProof

const sepolia = sepoliaChain(SEPOLIA_RPC)

interface SmokeDeps {
	env: RouterDepositEnv
	mint: (amount: bigint) => Promise<void>
	deposit: (amount: bigint, priv: boolean, claimSalt?: Fr) => Promise<{ claimValue: Fr; leafIndex: bigint }>
	bridge: Contract
	token: Contract
	from: AztecAddress
	sendOpts: unknown
	amount: bigint
	mins: () => string
}

/**
 * Prove the CIRCUIT binding LIVE: deposit A + a sync SENTINEL B (both to R). Once B claims, the
 * network has synced past both, so a wrong-recipient claim on the earlier A reverts for the BINDING
 * reason, not because A isn't synced yet. The evidence is three-fold: B's correct claim lands (sync
 * + private claims work), the wrong-recipient claim on synced A reverts, and B's balance arrives —
 * A itself is deliberately never re-claimed here (see the in-body PXE-wedge note).
 */
async function runRedirectProofLane(d: SmokeDeps): Promise<void> {
	const depositPrivate = async (salt: Fr): Promise<bigint> => {
		await d.mint(d.amount)
		return (await d.deposit(d.amount, true, salt)).leafIndex
	}
	const claimPrivate = async (recipient: AztecAddress, salt: Fr, leaf: bigint): Promise<boolean> => {
		for (let i = 0; i < 300; i++) {
			try {
				await d.bridge.methods.claim_private(recipient, d.amount, salt, new Fr(leaf)).send(d.sendOpts as never)
				return true
			} catch {
				await new Promise((r) => setTimeout(r, 6000))
			}
		}
		return false
	}

	const saltA = Fr.random()
	const leafA = await depositPrivate(saltA)
	const saltB = Fr.random()
	const leafB = await depositPrivate(saltB)
	console.log(`redirect-proof: deposited A(leaf ${leafA}) + sentinel B(leaf ${leafB}) (${d.mins()})`)

	if (!(await claimPrivate(d.from, saltB, leafB))) throw new Error("sentinel B never claimed — L1→L2 not synced within budget")
	console.log(`sentinel B claimed → network synced; A is now claimable (${d.mins()})`)

	// A is synced (B, a LATER leaf, claimed). So a wrong-recipient claim on A that reverts does so for
	// the BINDING reason, not because A isn't synced yet. Single attempt — no retry (we want the revert).
	const wrongRecipient = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000001")
	let wrongReverted = false
	try {
		await d.bridge.methods.claim_private(wrongRecipient, d.amount, saltA, new Fr(leafA)).send(d.sendOpts as never)
	} catch {
		wrongReverted = true
	}
	if (!wrongReverted) {
		throw new Error(
			"SECURITY FAILURE: wrong-recipient claim_private on a SYNCED message did NOT revert — recipient-commitment broken (redirect possible)",
		)
	}
	// A stays claimable: a reverted consume_l1_to_l2_message never nullifies the message (protocol
	// invariant). We deliberately do NOT re-claim A here — re-simulating the same leaf in the same PXE
	// session after a failed consume attempt wedges the local PXE (a harness limitation, not on-chain
	// state); canary 2 already proves a correct private claim settles + mints. B's claim is the balance
	// sanity that private claims work on this candidate.
	const balRP = ((await d.token.methods.balance_of_private(d.from).simulate({ from: d.from })) as { result: bigint }).result
	if (balRP < d.amount) throw new Error(`redirect-proof: sentinel balance ${balRP} < expected ${d.amount} (B)`)
	console.log(
		`\n✅ CANDIDATE REDIRECT-PROOF PASSED — a wrong recipient cannot consume a SYNCED message (binding holds); sentinel balance ${balRP} (${d.mins()})`,
	)
}

async function main() {
	const mins = stopwatch()

	// ─── L1 (Sepolia, viem) ──────────────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	console.log("L1 funder", account.address)
	const { wallet, pub } = createL1Clients({ chain: sepolia, rpcUrl: SEPOLIA_RPC, account })

	const usdc = CONFIG.l1.usdc as `0x${string}`
	const portal = CONFIG.l1.portal as `0x${string}`
	const usdcAbi = evmAbi((CONFIG.l1.token?.sourceContract as string | undefined) ?? "MintableERC20")
	// The app's ONLY deposit path is the router's witness-bound Permit2 bridge() — the smoke must
	// prove THAT path (approve fallback included), not the portal-direct legacy.
	const core = CONFIG.l1.fuel?.core as { router?: `0x${string}`; permit2?: `0x${string}`; swapTarget?: `0x${string}` } | undefined
	if (!core?.router || !core?.permit2 || !core?.swapTarget) {
		throw new Error("candidate manifest has no l1.fuel.core router/permit2/swapTarget — the app deposit path needs them (C7)")
	}
	const routerCore = core as { router: `0x${string}`; permit2: `0x${string}`; swapTarget: `0x${string}` }
	const decimals = CONFIG.l1.token.decimals as number
	console.log(`candidate: portal ${portal} (${CONFIG.l1.portalSource ?? "legacy"}), usdc ${usdc}`)

	// ─── L2 (testnet aztec.js — REAL proofs) ─────────────────────────
	const node = createNode(NODE_URL)
	const ewallet = await createL2Wallet({ nodeUrl: NODE_URL, proverEnabled: true })
	const { manager, from } = await freshSchnorrAccount(ewallet as never)
	console.log("L2 smoke account", from.toString())

	const { fee } = await sponsoredFpcFee(ewallet)
	const opts = { from, fee }
	const sendOpts = { ...opts, wait: { waitForStatus: TxStatus.PROPOSED } }

	await deployAccountIfAbsent({
		node,
		manager: manager as never,
		from,
		fee,
		log: (stage) => {
			if (stage === "deploying") console.log(`deploying L2 smoke account (real proof, ~minutes)… (${mins()})`)
		},
	})

	// Register (NOT deploy) each L2 contract from the manifest, asserting the recorded address
	// recomputes from its salt + args - the same reconstruction the faucet's bridge-deployments does.
	const { token, bridge } = await registerManifestTrio(ewallet, CONFIG)

	// ─── Deposit → claim (public, or --private recipient-committed) ────────────────────
	const amount = 100n * 10n ** BigInt(decimals)
	const env: RouterDepositEnv = { pub, wallet, account }
	const mint = async (mintAmount: bigint) => {
		await pub.waitForTransactionReceipt({
			hash: await wallet.writeContract({
				address: usdc,
				abi: usdcAbi as never,
				functionName: "mint",
				args: [account.address, mintAmount] as never,
			}),
		})
	}
	const deposit = (depAmount: bigint, priv: boolean, claimSalt?: Fr) =>
		depositViaRouter(env, {
			usdc,
			usdcAbi,
			core: routerCore,
			portal,
			amount: depAmount,
			recipient: from.toString(),
			isPrivate: priv,
			claimSalt,
			chainId: 11155111,
			mins,
		})

	if (redirectProof) {
		await runRedirectProofLane({ env, mint, deposit, bridge, token, from, sendOpts, amount, mins })
		return
	}
	// PRIVATE: the claimed value is the claim_salt (claim_private re-derives the secret in-circuit).
	// PUBLIC: runRouterDeposit generates + returns the raw secret. Both ride the app's router path.
	const claimSalt = isPrivate ? Fr.random() : undefined
	await mint(amount)
	const dep = await deposit(amount, isPrivate, claimSalt)
	console.log(`deposited ${amount} → L2 via router (${isPrivate ? "private" : "public"}), leafIndex ${dep.leafIndex} (${mins()})`)

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
	console.log(
		`\n✅ CANDIDATE ${isPrivate ? "PRIVATE " : ""}smoke PASSED — deposit→claim bridged ${amount} on the recorded set in ${mins()}.`,
	)
	console.log("   Safe to promote testnet-bridge.candidate.json → testnet-bridge.json.")
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
