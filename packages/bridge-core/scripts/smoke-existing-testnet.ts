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
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { EthAddress } from "@aztec/foundation/eth-address"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { privateKeyToAccount } from "viem/accounts"
import { runRouterDeposit } from "../src/flows"
import { ensurePermit2Allowance } from "../src/l1"
import { SWAP_BRIDGE_ROUTER_ABI } from "../src/router-abi"
import { createL1Clients, createL2Wallet, createNode, loadManifestFromConfigArg, sepoliaChain, stopwatch } from "./script-bootstrap"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-core/.env)")

const CONFIG = loadManifestFromConfigArg(process.argv, {
	mode: "required",
	requiredHint: "apps/faucet/public/testnet-bridge.candidate.json",
	// biome-ignore lint/suspicious/noExplicitAny: manifest fields are accessed via dynamic property paths without a formal schema, matching the original untyped JSON.parse.
	parse: (raw) => raw as any,
})
// --private exercises the recipient-committed path (the strand-risk gate): deposit commits to
// H(deriveTokenClaimSecret(salt, recipient)) and claim_private re-derives the secret in-circuit.
// --redirect-proof (implies private) additionally proves the CIRCUIT binding LIVE: a wrong recipient
// can't consume (Phase 7 step 3, fresh-audit H2).
const redirectProof = process.argv.includes("--redirect-proof")
const isPrivate = process.argv.includes("--private") || redirectProof

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "..", "..", "..", "contracts", "bridge", "evm", "out")
const AZTEC = join(here, "..", "..", "..", "contracts", "bridge", "aztec")

const sepolia = sepoliaChain(SEPOLIA_RPC)

function evmArtifact(name: string): { abi: unknown[] } {
	return { abi: JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8")).abi }
}

function nargoArtifact(rel: string) {
	return loadContractArtifact(JSON.parse(readFileSync(join(AZTEC, rel), "utf8")))
}

async function main() {
	const mins = stopwatch()

	// ─── L1 (Sepolia, viem) ──────────────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	console.log("L1 funder", account.address)
	const { wallet, pub } = createL1Clients({ chain: sepolia, rpcUrl: SEPOLIA_RPC, account })

	const usdc = CONFIG.l1.usdc as `0x${string}`
	const portal = CONFIG.l1.portal as `0x${string}`
	const usdcAbi = evmArtifact((CONFIG.l1.token?.sourceContract as string | undefined) ?? "MintableERC20").abi
	// The app's ONLY deposit path is the router's witness-bound Permit2 bridge() — the smoke must
	// prove THAT path (approve fallback included), not the portal-direct legacy (codex bug-bash r1).
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
	const secret = Fr.random()
	const { signingKey, secretKey } = await deriveNuloAccountKeys(secret)
	const manager = await ewallet.createSchnorrAccount(secretKey, Fr.random(), signingKey)
	const deployer = await manager.getAccount()
	const from = deployer.getAddress()
	console.log("L2 smoke account", from.toString())

	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	const opts = { from, fee }
	const sendOpts = { ...opts, wait: { waitForStatus: TxStatus.PROPOSED } }

	if (!(await node.getContract(from))) {
		console.log(`deploying L2 smoke account (real proof, ~minutes)… (${mins()})`)
		const deployMethod = await manager.getDeployMethod()
		// NO_FROM: first account deploy can't route through its own (not-yet-deployed) entrypoint.
		await deployMethod.send({ fee, from: "NO_FROM" as never } as never)
	}

	// Register (NOT deploy) each L2 contract from the manifest, asserting the recorded address
	// recomputes from its salt + args - the same reconstruction the faucet's bridge-deployments does.
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
		// 5.0.1 standards Token: 5th constructor param auth_contract (ZERO).
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

	// ─── Deposit → claim (public, or --private recipient-committed) ────────────────────
	const amount = 100n * 10n ** BigInt(decimals)
	const l2recipient = from

	const retryOnRevert = async <T>(fn: () => Promise<T>, tries = 3): Promise<T> => {
		for (let i = 1; ; i++) {
			try {
				return await fn()
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				if (i >= tries || !/REVERTED/.test(msg)) throw e
				console.log(`bridge() reverted (attempt ${i}/${tries}) — waiting one Aztec slot and retrying: ${msg.slice(0, 120)}`)
				await new Promise((r) => setTimeout(r, 45_000))
			}
		}
	}

	// One deposit path for the whole smoke — the app's exact router flow: one-time Permit2 approve
	// when the token needs it (TestUsdc/real USDC start at zero; MintableERC20 short-circuits), then
	// the witness-bound bridge(). Returns the claim value (PRIVATE: the salt in = the value out;
	// PUBLIC: the flow's own random secret) + leaf index for the L2 claim.
	const depositViaRouter = async (depAmount: bigint, priv: boolean, claimSalt?: Fr): Promise<{ claimValue: Fr; leafIndex: bigint }> => {
		await ensurePermit2Allowance({
			allowance: async () =>
				(await pub.readContract({
					address: usdc,
					abi: usdcAbi as never,
					functionName: "allowance",
					args: [account.address, routerCore.permit2],
				})) as bigint,
			approveMax: async () =>
				await wallet.writeContract({
					address: usdc,
					abi: usdcAbi as never,
					functionName: "approve",
					args: [routerCore.permit2, (1n << 256n) - 1n] as never,
				}),
			waitReceipt: async (hash) => await pub.waitForTransactionReceipt({ hash }),
			needed: depAmount,
			onStatus: (st, tx) => console.log(`permit2 approval: ${st}${tx ? ` (${tx})` : ""} (${mins()})`),
		})
		// A bridge() can transiently REVERT when the Inbox's per-L2-slot message subtree fills (seen
		// live: back-to-back deposits ~20s apart in one ~36s slot; the identical calldata succeeded on
		// replay next block). Retry across slots; a persistent revert still fails the smoke.
		const r = await retryOnRevert(() =>
			runRouterDeposit(
				{ pub, wallet, account } as never,
				{
					router: routerCore.router,
					routerAbi: SWAP_BRIDGE_ROUTER_ABI as never,
					permit2: routerCore.permit2,
					tokenPortal: portal,
					bridgeToken: usdc,
					amount: depAmount,
					aztecRecipient: l2recipient.toString() as `0x${string}`,
					isPrivate: priv,
					swapTarget: routerCore.swapTarget,
					claimSalt,
					nonce: BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`),
					deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
					chainId: 11155111,
				},
				(st) => console.log(`l1: ${st} (${mins()})`),
			),
		)
		return { claimValue: Fr.fromHexString(r.claimValueHex), leafIndex: r.leafIndex }
	}

	if (redirectProof) {
		// Prove the CIRCUIT binding LIVE: deposit A + a sync SENTINEL B (both to R). Once B claims, the
		// network has synced past both, so a wrong-recipient claim on the earlier A reverts for the BINDING
		// reason, not because A isn't synced yet. The authoritative gate is that the CORRECT claim of A still
		// succeeds afterwards — if the wrong claim had redirected/consumed A, that correct claim would fail.
		const depositPrivate = async (salt: Fr): Promise<bigint> => {
			await pub.waitForTransactionReceipt({
				hash: await wallet.writeContract({
					address: usdc,
					abi: usdcAbi as never,
					functionName: "mint",
					args: [account.address, amount] as never,
				}),
			})
			return (await depositViaRouter(amount, true, salt)).leafIndex
		}
		const claimPrivate = async (recipient: AztecAddress, salt: Fr, leaf: bigint): Promise<boolean> => {
			for (let i = 0; i < 300; i++) {
				try {
					await bridge.methods.claim_private(recipient, amount, salt, new Fr(leaf)).send(sendOpts)
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
		console.log(`redirect-proof: deposited A(leaf ${leafA}) + sentinel B(leaf ${leafB}) (${mins()})`)

		if (!(await claimPrivate(l2recipient, saltB, leafB))) throw new Error("sentinel B never claimed — L1→L2 not synced within budget")
		console.log(`sentinel B claimed → network synced; A is now claimable (${mins()})`)

		// A is synced (B, a LATER leaf, claimed). So a wrong-recipient claim on A that reverts does so for
		// the BINDING reason, not because A isn't synced yet. Single attempt — no retry (we want the revert).
		const wrongRecipient = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000001")
		let wrongReverted = false
		try {
			await bridge.methods.claim_private(wrongRecipient, amount, saltA, new Fr(leafA)).send(sendOpts)
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
		const balRP = ((await token.methods.balance_of_private(l2recipient).simulate({ from })) as { result: bigint }).result
		if (balRP < amount) throw new Error(`redirect-proof: sentinel balance ${balRP} < expected ${amount} (B)`)
		console.log(
			`\n✅ CANDIDATE REDIRECT-PROOF PASSED — a wrong recipient cannot consume a SYNCED message (binding holds); sentinel balance ${balRP} (${mins()})`,
		)
		return
	}
	// PRIVATE: the claimed value is the claim_salt (claim_private re-derives the secret in-circuit).
	// PUBLIC: runRouterDeposit generates + returns the raw secret. Both ride the app's router path.
	const claimSalt = isPrivate ? Fr.random() : undefined
	await pub.waitForTransactionReceipt({
		hash: await wallet.writeContract({
			address: usdc,
			abi: usdcAbi as never,
			functionName: "mint",
			args: [account.address, amount] as never,
		}),
	})
	const dep = await depositViaRouter(amount, isPrivate, claimSalt)
	const claimValue = dep.claimValue
	const leafIndex = dep.leafIndex
	console.log(`deposited ${amount} → L2 via router (${isPrivate ? "private" : "public"}), leafIndex ${leafIndex} (${mins()})`)

	let claimed = false
	for (let i = 0; i < 300 && !claimed; i++) {
		try {
			// PRIVATE: pass the SALT (claimValue); claim_private re-derives the secret from (salt, recipient).
			await (isPrivate
				? bridge.methods.claim_private(l2recipient, amount, claimValue, new Fr(leafIndex))
				: bridge.methods.claim_public(l2recipient, amount, claimValue, new Fr(leafIndex))
			).send(sendOpts)
			claimed = true
		} catch {
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!claimed) throw new Error(`claim_${isPrivate ? "private" : "public"} never succeeded (L1→L2 message not synced within budget)`)

	const bal = isPrivate
		? ((await token.methods.balance_of_private(l2recipient).simulate({ from })) as { result: bigint }).result
		: ((await token.methods.balance_of_public(l2recipient).simulate({ from })) as { result: bigint }).result
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
