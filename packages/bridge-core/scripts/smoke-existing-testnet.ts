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
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TokenPortalAbi } from "@aztec/l1-artifacts"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@alejoamiras/aztec-standards/dist/src/artifacts/Token.js"
import { createPublicClient, createWalletClient, defineChain, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { deriveTokenClaimSecret } from "../src/claim-secret"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-core/.env)")

const configArg = process.argv.indexOf("--config")
if (configArg === -1) throw new Error("pass --config <candidate manifest path> (e.g. apps/faucet/public/testnet-bridge.candidate.json)")
const CONFIG = JSON.parse(readFileSync(process.argv[configArg + 1] as string, "utf8"))
// --private exercises the recipient-committed path (the strand-risk gate): deposit commits to
// H(deriveTokenClaimSecret(salt, recipient)) and claim_private re-derives the secret in-circuit.
const isPrivate = process.argv.includes("--private")

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "..", "..", "..", "contracts", "bridge", "evm", "out")
const AZTEC = join(here, "..", "..", "..", "contracts", "bridge", "aztec")

const sepolia = defineChain({
	id: 11155111,
	name: "sepolia",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SEPOLIA_RPC] } },
})

function evmArtifact(name: string): { abi: unknown[] } {
	return { abi: JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8")).abi }
}

function nargoArtifact(rel: string) {
	return loadContractArtifact(JSON.parse(readFileSync(join(AZTEC, rel), "utf8")))
}

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`

	// ─── L1 (Sepolia, viem) ──────────────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	console.log("L1 funder", account.address)
	const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
	const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })

	const usdc = CONFIG.l1.usdc as `0x${string}`
	const portal = CONFIG.l1.portal as `0x${string}`
	const usdcAbi = evmArtifact("MintableERC20").abi
	const decimals = CONFIG.l1.token.decimals as number
	console.log(`candidate: portal ${portal} (${CONFIG.l1.portalSource ?? "legacy"}), usdc ${usdc}`)

	// ─── L2 (testnet aztec.js — REAL proofs) ─────────────────────────
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const secret = Fr.random()
	const manager = await ewallet.createSchnorrAccount(secret, Fr.random(), deriveSigningKey(secret))
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
		[tName, tSymbol, tDec, proxy.address],
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
	// PRIVATE: the stored/claimed value is the claim_salt; the L1-committed secretHash is over the
	// DERIVED secret deriveTokenClaimSecret(salt, recipient), so claim_private re-derives it in-circuit.
	// PUBLIC: claimValue is the raw secret (claim_public binds the recipient in its content hash).
	const claimValue = Fr.random()
	const committedSecret = isPrivate ? deriveTokenClaimSecret(claimValue, l2recipient) : claimValue
	const secretHash = await computeSecretHash(committedSecret)

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
	// PRIVATE deposit omits the recipient (mint_to_private content hash = amount only); the recipient
	// is bound solely via the secretHash. PUBLIC deposit carries the recipient in its content hash.
	const depositFn = isPrivate ? "depositToAztecPrivate" : "depositToAztecPublic"
	const depositArgs = isPrivate ? [amount, secretHash.toString()] : [l2recipient.toString(), amount, secretHash.toString()]
	const sim = await pub.simulateContract({
		address: portal,
		abi: TokenPortalAbi as never,
		functionName: depositFn as never,
		args: depositArgs as never,
		account,
	})
	const leafIndex = BigInt((sim.result as [string, bigint])[1])
	await pub.waitForTransactionReceipt({
		hash: await wallet.writeContract({
			address: portal,
			abi: TokenPortalAbi as never,
			functionName: depositFn as never,
			args: depositArgs as never,
		}),
	})
	console.log(`deposited ${amount} → L2 (${isPrivate ? "private" : "public"}), leafIndex ${leafIndex} (${mins()})`)

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
