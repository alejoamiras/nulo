/**
 * Sandbox-mode dual-wallet setup for the bridge flows. Lazy-imported ONLY when
 * the app runs against the LOCAL aztec+anvil sandbox — it pulls the @aztec
 * test-account helpers + an in-browser PXE, which must never land in the
 * production bundle. Reads /sandbox.json + /token_bridge.json (written to public/
 * by `bridge-core/scripts/deploy-sandbox.ts`).
 */
import { getInitialTestAccountsData } from "@aztec/accounts/testing"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { TokenPortalAbi } from "@aztec/l1-artifacts"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import {
	DEPOSITS_KEY,
	type DepositFlowStage,
	type DepositRecord,
	depositPrivate,
	depositPublic,
	loadDeposits,
	removeRecord,
	updateRecord,
	upsertRecord,
} from "@nulo/bridge-core"
import { type Abi, createPublicClient, createWalletClient, defineChain, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export interface SandboxConfig {
	usdc: string
	portal: string
	bridge: string
	token: string
	l2Account: string
	/** RPC endpoints the deploy ran against — lets the app target a fresh OR restarted sandbox. */
	l1Rpc?: string
	nodeUrl?: string
}

/** Well-known anvil account 0 — sandbox-only test key, never a real secret. */
const ACCOUNT0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const
const DEFAULT_L1_RPC = "http://localhost:8545"
const DEFAULT_NODE_URL = "http://localhost:8080"

/** Minimal MintableERC20 surface the deposit flow uses (mint + approve). */
const USDC_ABI = [
	{
		type: "function",
		name: "mint",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "to", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [],
	},
	{
		type: "function",
		name: "approve",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "spender", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ type: "bool" }],
	},
] as const satisfies Abi

export interface SandboxBridge {
	config: SandboxConfig
	deposit: (amount: bigint, isPrivate: boolean, onStage?: (s: DepositFlowStage) => void) => Promise<bigint>
	/** Locally-persisted in-flight deposits (survive a refresh) — the recovery surface. */
	pending: () => DepositRecord[]
	/** Re-run the claim for a persisted deposit after a crash (resume-on-boot). */
	resume: (rec: DepositRecord) => Promise<void>
}

let cached: Promise<SandboxBridge> | undefined

/** Cached: the in-browser PXE is built once per session and reused, so repeated
 * deposits don't re-sync from scratch (a fresh PXE lags on a long-lived sandbox). */
export function setupSandbox(): Promise<SandboxBridge> {
	cached ??= buildSandbox()
	return cached
}

async function buildSandbox(): Promise<SandboxBridge> {
	const config: SandboxConfig = await (await fetch("/sandbox.json")).json()
	const l1Rpc = config.l1Rpc ?? DEFAULT_L1_RPC
	const nodeUrl = config.nodeUrl ?? DEFAULT_NODE_URL
	const sandboxChain = defineChain({
		id: 31337,
		name: "aztec-sandbox-l1",
		nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
		rpcUrls: { default: { http: [l1Rpc] } },
	})

	const account = privateKeyToAccount(ACCOUNT0_KEY)
	const wallet = createWalletClient({ account, chain: sandboxChain, transport: http(l1Rpc) })
	const pub = createPublicClient({ chain: sandboxChain, transport: http(l1Rpc) })

	createAztecNodeClient(nodeUrl)
	const ewallet = await EmbeddedWallet.create(nodeUrl, { pxeConfig: { proverEnabled: false } })
	const [acct] = await getInitialTestAccountsData()
	const manager = await ewallet.createSchnorrAccount(acct.secret, acct.salt, acct.signingKey)
	const from = (await manager.getAccount()).getAddress()
	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const sendOpts = {
		from,
		fee: { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) },
		wait: { waitForStatus: TxStatus.PROPOSED },
	}

	const bridgeArtifact = loadContractArtifact(await (await fetch("/token_bridge.json")).json())
	const bridge = await Contract.at(AztecAddress.fromString(config.bridge), bridgeArtifact, ewallet as never)

	const kv = window.localStorage
	const recipient = config.l2Account
	const claimMethod = (fn: string) =>
		(bridge.methods as Record<string, (...a: unknown[]) => { send: (o: unknown) => Promise<unknown> }>)[fn]

	const resume = async (rec: DepositRecord): Promise<void> => {
		if (!rec.messageLeafIndex) throw new Error("pending deposit has no leaf index yet — cannot resume")
		const claim = claimMethod(rec.isPrivate ? "claim_private" : "claim_public")
		await claim(
			AztecAddress.fromString(rec.aztecRecipient),
			BigInt(rec.amount),
			Fr.fromString(rec.encryptedSecret),
			new Fr(BigInt(rec.messageLeafIndex)),
		).send(sendOpts as never)
		removeRecord(kv, DEPOSITS_KEY, rec.id)
	}

	return {
		config,
		deposit: (amount, isPrivate, onStage) => {
			// Persist the secret + context BEFORE the irreversible deposit so a crash/refresh
			// can resume the claim. SANDBOX: stored plaintext (account0 is a public test key);
			// production encrypts via recovery-crypto before storage.
			let id = ""
			const recovery = {
				onSecret: ({ secretHex, secretHashHex }: { secretHex: string; secretHashHex: string }) => {
					id = secretHashHex
					upsertRecord(kv, {
						id,
						direction: "l1ToL2",
						amount: amount.toString(),
						encryptedSecret: secretHex,
						isPrivate,
						createdAt: Date.now(),
						token: config.usdc,
						aztecRecipient: recipient,
						secretHashHex,
						stage: "deposited",
					})
				},
				onDeposited: (leafIndex: bigint) =>
					updateRecord(kv, DEPOSITS_KEY, id, { messageLeafIndex: leafIndex.toString(), stage: "claiming" }),
				onClaimed: () => removeRecord(kv, DEPOSITS_KEY, id),
			}
			return (isPrivate ? depositPrivate : depositPublic)(
				{ pub: pub as never, wallet: wallet as never, account: account as never },
				bridge as never,
				{
					usdc: config.usdc as `0x${string}`,
					portal: config.portal as `0x${string}`,
					usdcAbi: USDC_ABI as Abi,
					portalAbi: TokenPortalAbi as Abi,
					recipient,
					amount,
				},
				sendOpts as never,
				onStage,
				recovery,
			)
		},
		pending: () => loadDeposits(kv),
		resume,
	}
}
