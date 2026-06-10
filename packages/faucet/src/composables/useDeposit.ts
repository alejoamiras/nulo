import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { InboxAbi, TokenPortalAbi } from "@aztec/l1-artifacts"
import { openRecordSecret, sealRecordSecret } from "@nulo/bridge-core"
import { tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { parseEventLogs } from "viem"
import { sepolia } from "viem/chains"
import { ref, watch } from "vue"
import { BRIDGE, BRIDGE_TOKEN, L1_PORTAL, L1_USDC } from "@/contracts/bridge-deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { useBridgeWallet } from "./useBridgeWallet"
import { useL1Wallet } from "./useL1Wallet"
import { readBalance } from "./useTokenBalance"

// Verbose tracing while the bridge flows are being hardened — every step + value to the console.
const log = (...args: unknown[]) => console.log("[bridge:deposit]", ...args)

/** Minimal MintableERC20 surface (standard signatures) — mint test USDC + approve the portal. */
const ERC20_ABI = [
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
] as const

export type DepositStage = "idle" | "minting" | "approving" | "depositing" | "syncing" | "claiming" | "done" | "error"

const PENDING_KEY = "nulo-bridge-pending-deposit"

interface PendingDeposit {
	/** Public deposit: the recipient-bound claim secret (plaintext is acceptable — it's bound to the
	 *  recipient in the L1 message). Private deposits leave this empty and use `sealedSecret`. */
	readonly secret: string
	readonly recipient: string
	readonly amount: string
	/** Recipient's balance before the deposit — claim is confirmed by the balance crossing this + amount. */
	readonly preBalance: string
	readonly leafIndex?: string
	/** Private deposit: the BEARER claim secret sealed at rest (recovery-crypto). `secret` stays empty. */
	readonly sealedSecret?: string
	/** secretHash hex — rebuilds the per-record seal binding when unsealing on claim/resume. */
	readonly secretHashHex?: string
	readonly isPrivate?: boolean
}

function persistPending(p: PendingDeposit): void {
	try {
		localStorage.setItem(PENDING_KEY, JSON.stringify(p))
	} catch {}
}
function loadPending(): PendingDeposit | null {
	try {
		const raw = localStorage.getItem(PENDING_KEY)
		return raw ? (JSON.parse(raw) as PendingDeposit) : null
	} catch {
		return null
	}
}
function clearPending(): void {
	try {
		localStorage.removeItem(PENDING_KEY)
	} catch {}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Safe-parse a persisted bigint string — a pre-fix entry may hold "[object Object]". */
function safeBigInt(s: string): bigint | null {
	try {
		return BigInt(s)
	} catch {
		return null
	}
}

// The L1→L2 message isn't consumable until the sequencer folds it into an L2 block AND this wallet's PXE
// syncs that block — until then the claim simulate reverts, and the wording differs by path: public
// "l1_to_l2_msg_exists"; private "No L1 to L2 message found for message hash …" (the ACTUAL testnet
// wording — codex's "message not in state" guess was wrong). All are transient → poll, never throw.
const isMsgNotReady = (msg: string): boolean =>
	/l1_to_l2_msg_exists|nonexistent L1-to-L2|message not in state|No L1 to L2 message found/i.test(msg)

// Module-level so it holds across composable instances: only one claim in flight at a time.
let claimInFlight = false

/**
 * Drive an L1→L2 deposit through the app, faucet-side: mint test USDC + approve + depositToAztecPublic
 * on L1 (useL1Wallet, canonical viem), then — once the L1→L2 message is consumable — claim_public on L2
 * (useBridgeWallet, the Aztec wallet). The two wallets meet only at primitives (codex).
 *
 * Sync gate (THE thing that makes the single claim prompt land): depositToAztecPublic only QUEUES the
 * L1→L2 message; it isn't consumable until the sequencer folds it into a checkpointed L2 block AND the
 * WALLET's own PXE syncs that block (the PXE lags the node, so a node-side `getL1ToL2MessageCheckpoint`
 * is NOT sufficient — that was the earlier premature-claim bug). We poll `claim_public(...).simulate()`,
 * a prompt-free local PXE dry-run, which reverts with `l1_to_l2_msg_exists` until the message is
 * consumable BY THIS WALLET. Only once it simulates cleanly do we `.send()` — exactly one prompt, and it
 * lands. (Confirmed against the SDK: simulate→pxe.simulateTx, no proof, no approval; send→pxe.proveTx,
 * which is what prompts.)
 *
 * Recovery: secret + leaf index + preBalance persist BEFORE the irreversible L1 deposit and clear only
 * once the L2 balance crosses preBalance + amount. A pending claim auto-resumes when the Aztec wallet
 * reconnects — it just re-enters the simulate-gate, so legacy entries (no message hash) recover too.
 */
export function useDeposit() {
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()

	const stage = ref<DepositStage>("idle")
	const error = ref<string | null>(null)
	const l1TxHash = ref<string | null>(null)
	const hasPending = ref(loadPending() !== null)

	async function readBridgeBalance(wallet: unknown, recipient: AztecAddress, isPrivate = false): Promise<bigint> {
		const token = await Contract.at(BRIDGE_TOKEN, TokenContractArtifact, wallet as never)
		// readBalance unwraps the SimulationResult / utility result to a real bigint — a raw cast yields the
		// wrapper object, which stringifies to "[object Object]" and blows up the later BigInt() coercion.
		// balance_of_private is a utility read (executeUtility); balance_of_public is an on-chain view.
		const fn = isPrivate ? "balance_of_private" : "balance_of_public"
		const bal = await readBalance(wallet as never, token, fn, recipient)
		log(fn, recipient.toString(), "=", bal.toString())
		return bal
	}

	function finish(): void {
		clearPending()
		hasPending.value = false
		stage.value = "done"
	}

	/** Guard against concurrent/duplicate runs — the resume watcher can fire more than once, and a
	 * second run prompts the claim again. */
	async function claimAndConfirm(wallet: unknown, pending: PendingDeposit & { leafIndex: string }): Promise<void> {
		if (claimInFlight) {
			log("a claim is already in flight — skipping duplicate")
			return
		}
		claimInFlight = true
		try {
			await doClaimAndConfirm(wallet, pending)
		} finally {
			claimInFlight = false
		}
	}

	/** Poll the claim SIMULATION until the message is consumable, send once, confirm the credit. */
	async function doClaimAndConfirm(wallet: unknown, pending: PendingDeposit & { leafIndex: string }): Promise<void> {
		const recipientAddr = AztecAddress.fromString(pending.recipient)
		const amount = BigInt(pending.amount)
		// Private: the bearer secret is sealed — re-derive the per-record key from an L1 signature and
		// unseal it (needs the L1 wallet connected). Public: the secret is recipient-bound plaintext.
		let secret: Fr
		if (pending.isPrivate) {
			const l1wallet = l1.walletClient.value
			const l1addr = l1.address.value
			if (!l1wallet || !l1addr) throw new Error("Connect your Ethereum wallet to unseal the private claim secret.")
			if (!pending.sealedSecret || !pending.secretHashHex) throw new Error("Private pending record is missing its sealed secret.")
			const sign = (m: string) => l1wallet.signMessage({ account: l1addr, message: m } as never)
			const binding = { chainId: sepolia.id, portal: L1_PORTAL, bridge: BRIDGE.toString(), secretHashHex: pending.secretHashHex }
			secret = Fr.fromString(await openRecordSecret(sign, binding, pending.sealedSecret))
		} else {
			secret = Fr.fromString(pending.secret)
		}
		const pre = safeBigInt(pending.preBalance)
		const target = pre === null ? null : pre + amount
		const isCredited = async () => target !== null && (await readBridgeBalance(wallet, recipientAddr, pending.isPrivate)) >= target

		if (await isCredited()) {
			log("already credited — nothing to claim")
			finish()
			return
		}

		const fpc = await getSponsoredFpcInstance()
		const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
		const bridge = await Contract.at(BRIDGE, tokenBridgeArtifact, wallet as never)
		const claim = pending.isPrivate
			? () => bridge.methods.claim_private(recipientAddr, amount, secret, new Fr(BigInt(pending.leafIndex)))
			: () => bridge.methods.claim_public(recipientAddr, amount, secret, new Fr(BigInt(pending.leafIndex)))

		// 1. Gate on a clean SIMULATION — prompt-free, and accurate because it runs against the wallet's
		//    own PXE (the thing that actually executes the claim). It reverts until the message is there.
		stage.value = "syncing"
		let ready = false
		for (let i = 0; i < 300; i++) {
			try {
				await claim().simulate({ from: recipientAddr, fee } as never)
				log(`claim simulates cleanly (poll ${i + 1}) — L1→L2 message is consumable`)
				ready = true
				break
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				if (isMsgNotReady(msg)) {
					log(`L1→L2 message not consumable yet (poll ${i + 1}) — waiting 6s`)
					await sleep(6000)
				} else {
					log("claim simulate failed (not a sync issue):", msg)
					throw e
				}
			}
		}
		if (!ready) throw new Error("the L1→L2 message never synced to your wallet — it will resume when you reopen this tab")

		// 2. Send ONCE — the simulation passed, so this lands. The only wallet prompt of the claim.
		stage.value = "claiming"
		log("claiming (confirm in your Aztec wallet)", { leafIndex: pending.leafIndex })
		await claim().send({ from: recipientAddr, fee, wait: { waitForStatus: TxStatus.PROPOSED } } as never)
		log("claim sent — confirming the L2 credit")

		// 3. Confirm the credit (NO prompt) — the reorg-safe clear signal.
		if (target === null) {
			log("no preBalance baseline (legacy entry) — clearing on claim success")
			finish()
			return
		}
		for (let i = 0; i < 30; i++) {
			if (await isCredited()) {
				log("credited — deposit complete ✓")
				finish()
				return
			}
			await sleep(4000)
		}
		log("claim sent; L2 credit not yet observed — will reconcile on reload")
		stage.value = "done"
	}

	async function deposit(amount: bigint, isPrivate = false): Promise<void> {
		error.value = null
		const wallet = l1.walletClient.value
		const from = l1.address.value
		const aztec = bridgeWallet.wallet.value
		const recipient = bridgeWallet.selectedAccount.value
		if (!wallet || !from) {
			error.value = "Connect your Ethereum wallet first."
			return
		}
		if (!aztec || !recipient) {
			error.value = "Connect your Aztec wallet first."
			return
		}

		try {
			// Single-pending storage: a 2nd deposit overwrites the 1st's recovery record — for a PRIVATE
			// deposit that's the only sealed bearer blob + leaf index, leaving the earlier deposit
			// unrecoverable (codex 019eacad CRITICAL). Block until the pending one is claimed or discarded.
			if (loadPending()) {
				error.value = "Finish or discard the pending deposit before starting another."
				return
			}
			log("start", { amount: amount.toString(), recipient, from, usdc: L1_USDC, portal: L1_PORTAL })
			const secret = Fr.random()
			const secretHash = await computeSecretHash(secret)
			const secretHashHex = secretHash.toString()
			const recipientAddr = AztecAddress.fromString(recipient)
			const preBalance = await readBridgeBalance(aztec, recipientAddr, isPrivate)
			// Private: SEAL the bearer secret before any irreversible L1 tx (codex MEDIUM — derive the key,
			// seal, persist the blob; never the plaintext). sealRecordSecret self-tests the round trip and
			// throws HERE on a non-deterministic wallet — aborting before the mint rather than stranding funds.
			let sealedSecret: string | undefined
			if (isPrivate) {
				log("sealing the private claim secret (2 signatures: recovery key + self-test)")
				const sign = (m: string) => wallet.signMessage({ account: from, message: m } as never)
				sealedSecret = await sealRecordSecret(
					sign,
					{ chainId: sepolia.id, portal: L1_PORTAL, bridge: BRIDGE.toString(), secretHashHex },
					secret.toString(),
				)
			}
			const base = {
				secret: isPrivate ? "" : secret.toString(),
				sealedSecret,
				secretHashHex,
				isPrivate,
				recipient,
				amount: amount.toString(),
				preBalance: preBalance.toString(),
			}
			persistPending(base)
			hasPending.value = true

			stage.value = "minting"
			log("step 1/4 — minting", amount.toString(), "USDC to", from, "(confirm in your Ethereum wallet)")
			l1TxHash.value = await wallet.writeContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "mint",
				args: [from, amount],
				chain: sepolia,
				account: from,
			})
			log("mint tx", l1TxHash.value)
			await l1.publicClient.waitForTransactionReceipt({ hash: l1TxHash.value as `0x${string}` })

			stage.value = "approving"
			log("step 2/4 — approving portal", L1_PORTAL, "for", amount.toString(), "(confirm in your Ethereum wallet)")
			const approveHash = await wallet.writeContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "approve",
				args: [L1_PORTAL, amount],
				chain: sepolia,
				account: from,
			})
			log("approve tx", approveHash)
			await l1.publicClient.waitForTransactionReceipt({ hash: approveHash })

			stage.value = "depositing"
			// Private deposits OMIT the recipient — the L2 claim_private chooses it (the bearer-secret reason);
			// the secret is sealed above. The private path is fully wired but still UI-gated until the toggle.
			const depositFn = isPrivate ? "depositToAztecPrivate" : "depositToAztecPublic"
			const depositArgs = isPrivate
				? [amount, secretHash.toString()]
				: [recipient as `0x${string}`, amount, secretHash.toString() as `0x${string}`]
			log(`step 3/4 — ${depositFn} (confirm in your Ethereum wallet)`)
			const depositReceipt = await l1.publicClient.waitForTransactionReceipt({
				hash: await wallet.writeContract({
					address: L1_PORTAL,
					abi: TokenPortalAbi,
					functionName: depositFn,
					args: depositArgs,
					chain: sepolia,
					account: from,
				} as never),
			})
			log("deposit tx", depositReceipt.transactionHash)
			// The real leaf index comes from the mined Inbox MessageSent event — a preflight simulate
			// races with any concurrent deposit and yields an index the L2 message won't match.
			const sent = parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: depositReceipt.logs })
			const event = sent[0] as { args?: { index?: bigint } } | undefined
			if (event?.args?.index === undefined) throw new Error("deposit emitted no Inbox MessageSent event")
			const leafIndex = event.args.index.toString()
			log("L1→L2 message leaf index", leafIndex)
			const full = { ...base, leafIndex }
			persistPending(full)

			log("waiting for the L1→L2 message to become consumable, then claiming")
			await claimAndConfirm(aztec, full)
			log("deposit complete ✓")
		} catch (e) {
			log("FAILED:", e)
			error.value = e instanceof Error ? e.message : "Deposit failed"
			stage.value = "error"
		}
	}

	/** Resume a deposit whose claim never confirmed (tab closed mid-flow, or a legacy entry). */
	async function resumePending(): Promise<void> {
		const pending = loadPending()
		const aztec = bridgeWallet.wallet.value
		if (!pending?.leafIndex || !aztec || stage.value !== "idle") return
		// CRITICAL (codex 019eac7a): a private claim mints a NOTE to pending.recipient, which the L2 deposit
		// message does NOT bind — so never auto-resume to a different connected account than the deposit
		// targeted, or the note lands where the user isn't watching. Surface the mismatch, don't claim.
		if (pending.isPrivate && bridgeWallet.selectedAccount.value !== pending.recipient) {
			log("private claim targets a different account than the one connected — not auto-resuming")
			error.value = `This private deposit was for ${pending.recipient}. Connect that Aztec account to claim it.`
			return
		}
		// Never log the raw pending record — it holds the claim secret (a bearer credential for the
		// private flow). Redact it.
		log("resuming pending claim", { ...pending, secret: "<redacted>" })
		try {
			await claimAndConfirm(aztec, pending as PendingDeposit & { leafIndex: string })
		} catch (e) {
			log("resume FAILED:", e)
			error.value = e instanceof Error ? e.message : "Resume failed"
			stage.value = "error"
		}
	}

	/** Discard a stuck pending claim (escape hatch — testnet only; abandons the unclaimed test deposit). */
	function discardPending(): void {
		log("discarding pending claim")
		clearPending()
		hasPending.value = false
		stage.value = "idle"
		error.value = null
	}

	// Auto-resume a pending claim once the Aztec wallet is fully CONNECTED — capabilities granted +
	// contracts registered. Triggering on wallet.value races: that's set at confirmVerification, BEFORE
	// requestCapabilities, so the resume's first simulate hits "Capability simulation not granted".
	watch(
		() => bridgeWallet.status.value,
		(s) => {
			if (s === "connected" && hasPending.value) void resumePending()
		},
		{ immediate: true },
	)

	return { stage, error, l1TxHash, hasPending, deposit, resumePending, discardPending }
}
