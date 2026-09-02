import { AztecAddress } from "@aztec/aztec.js/addresses"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { Fr } from "@aztec/aztec.js/fields"
import { TxHash } from "@aztec/aztec.js/tx"
import { type DepositJournalRecord, type EncryptionKey, assetKindOf, deriveTokenClaimSecret } from "@nulo/bridge-core"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { classifyClaimReceipt } from "@/lib/claim-receipt"
import { NETWORK } from "@/lib/network"
import { ref, watch } from "vue"
import { SUPPORTS_SALT_V2 } from "@/contracts/bridge-deployments"
import { decideStandaloneFuelRecovery } from "@/lib/fuel-claim-state"
import {
	addRecordVerified,
	connectJournalDeps,
	markSessionLive,
	resumeSessionWork,
	updateRecord,
	useBridgeJournal,
} from "./useBridgeJournal"
import type { Ref } from "vue"
import {
	buildClaimInteraction,
	buildDepositRecord,
	coldAccountPreflight,
	type DepositL1Ctx,
	type FuelPre,
	fuelReceiptStatus,
	handleDepositFailure,
	prepareFuelSlice,
	recoverDepositLeg,
	runFueledDepositLeg,
	runPlainDepositLeg,
	sealPrivateRecord,
	sendStandaloneFjClaim,
} from "./deposit-flow"
import { useBridgeWallet } from "./useBridgeWallet"
import { useL1Wallet } from "./useL1Wallet"
import { withOperation } from "./useOpsInFlight"

// Verbose tracing while the bridge flows are being hardened - ids, stages, tx hashes ONLY.
const log = (...args: unknown[]) => console.log("[bridge:deposit]", ...args)

const NODE_URL = NETWORK.nodeUrl

export { providerFingerprint } from "./deposit-flow"

// The finalized-envelope re-seal key, held in memory only for records this session sealed.
const sealKeys = new Map<string, EncryptionKey>()

/** Same-session retained seal key (pre-finalize window) - lets a backup export skip the signature. */
export function getRetainedSealKey(id: string): EncryptionKey | undefined {
	return sealKeys.get(id)
}

// The user's explicit "Claim without fuel" choices (L14 trigger 3); set by the journal UI.
const fuelOverrides = new Set<string>()
export function overrideFuelClaim(id: string): void {
	fuelOverrides.add(id)
}

/** Probe a claim tx's receipt - record-specific ground truth. "included" covers success AND
 *  app-reverted: both are checkpointed block-status (the app revert lives in executionResult, not
 *  status), and an INCLUDED claim consumes the FJ message regardless of app-phase outcome. */
/** Read a claim tx's fee (the gas it used), base units — for the receipt's "gas used / available"
 *  ledger. Best-effort: a missing fee or unreachable node returns undefined, so the receipt falls back
 *  to showing gas bought without the used/available split. Read post-completion (claim flow untouched). */
export async function readClaimFee(txHash: string): Promise<bigint | undefined> {
	try {
		const receipt = await createAztecNodeClient(NODE_URL).getTxReceipt(TxHash.fromString(txHash))
		const fee = (receipt as { transactionFee?: bigint } | undefined)?.transactionFee
		return fee === undefined || fee === null ? undefined : BigInt(fee as never)
	} catch {
		return undefined
	}
}

/** Reconcile a fueled record's `consumed` flag from chain truth: if the fjwc attempt tx is
 *  INCLUDED (success OR app-reverted - both consumed the FJ message), persist `consumed`. Probing
 *  `fuel.claimTxHash` directly (not the completing claim) covers every path: the happy fjwc
 *  success, an fjwc included-but-reverted before a sponsored retry, and leaves a genuinely DROPPED
 *  fjwc unsettled so the recovery affordance surfaces. Idempotent; the card calls it on completed
 *  fueled records so the happy path suppresses the button without it ever flashing. */
export async function reconcileFuelConsumed(id: string): Promise<void> {
	const rec = useBridgeJournal().records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
	const fuel = rec?.fuel
	if (!fuel?.claimTxHash || fuel.consumed === true) return
	if ((await fuelReceiptStatus(fuel.claimTxHash)) === "included") {
		updateRecord(id, { fuel: { ...fuel, consumed: true } })
	}
}

/** The card's "CLAIM YOUR GAS" recovery: claims a stranded fuel message after the token side
 *  already completed. Throws so the caller can surface the failure (never silent). */
export async function claimFuelStandalone(id: string): Promise<void> {
	const bridgeWallet = useBridgeWallet()
	const aztec = bridgeWallet.wallet.value
	if (!aztec) throw new Error("Connect your Aztec wallet first.")
	const rec = useBridgeJournal().records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
	const fuel = rec?.fuel
	if (!rec || !fuel?.received || !fuel.leafIndex) throw new Error("This bridge has no fuel to claim.")
	// Same source as the card's affordance, so the button and this guard can never disagree. The
	// ladder below is public + sponsored, which L11 forbids for private records — and their FJ is
	// bound to the PrivateFPC, so it could not match one anyway.
	if (
		decideStandaloneFuelRecovery({
			isPrivate: rec.isPrivate,
			isFeeJuiceAsset: assetKindOf(rec) === "fee-juice",
			schema: rec.schema,
			completedAt: rec.completedAt,
			fuel,
		}) !== "offer"
	) {
		throw new Error("Private gas is claimed as part of the private bridge; standalone recovery is unavailable.")
	}
	// Post-impl audit HIGH-1/HIGH-2: the claim acts for rec.recipient — refuse under a different
	// (or unknown — fail-closed) active account, and run the wallet send inside a tracked
	// operation span.
	const active = bridgeWallet.selectedAccount.value
	if (!active || active.toLowerCase() !== rec.recipient.toLowerCase()) {
		throw new Error(
			`This gas claim belongs to ${rec.recipient.slice(0, 6)}…${rec.recipient.slice(-4)}. Switch to that account to claim.`,
		)
	}
	await withOperation(() => sendStandaloneFjClaim(aztec, AztecAddress.fromStringUnsafe(rec.recipient), fuel, id))
}

let depsWired = false

/** Wire the journal engine's deposit-side chain deps (idempotent; real clients only). Exported as
 *  ensureDepositJournalDeps so the Fuel flow guarantees wiring WITHOUT useDepositFlow's
 *  resumeSessionWork side-effect (codex Option C, lessons/phase-3.md). */
export function ensureDepositJournalDeps(): void {
	if (depsWired) return
	depsWired = true
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()
	connectJournalDeps({
		kv: localStorage,
		connectedL1: () => l1.address.value,
		connectedAztec: () => bridgeWallet.selectedAccount.value,
		signL1: (message) => {
			const wallet = l1.ensureWalletClient()
			const account = l1.address.value
			if (!wallet || !account) throw new Error("Connect your Ethereum wallet first.")
			return wallet.signMessage({ account, message } as never) as Promise<string>
		},
		recoverDepositLeg: (rec) => recoverDepositLeg(rec, l1.publicClient as never),
		claim: async (rec, secretHex, envelope) => {
			const aztec = bridgeWallet.wallet.value
			if (!aztec) throw new Error("Connect your Aztec wallet first.")
			return buildClaimInteraction(rec, secretHex, envelope, aztec, fuelOverrides.has(rec.id))
		},
		l2BlockNumber: async () => Number(await createAztecNodeClient(NODE_URL).getBlockNumber()),
		messageReadiness: async (messageHash) => {
			const node = createAztecNodeClient(NODE_URL)
			const cp = await node.getL1ToL2MessageCheckpoint(Fr.fromString(messageHash))
			if (cp === undefined || cp === null) return null
			const latest = await node.getBlockData("latest")
			return { checkpoint: Number(cp), anchor: Number(latest?.checkpointNumber ?? 0) }
		},
		claimReceiptStatus: async (txHash) => {
			const node = createAztecNodeClient(NODE_URL)
			try {
				const receipt = await node.getTxReceipt(TxHash.fromString(txHash))
				return classifyClaimReceipt(receipt as { status?: unknown; executionResult?: unknown })
			} catch (e) {
				// A dead RPC must read as connectivity, never as a slow claim (plan D2).
				log("receipt lookup failed:", e instanceof Error ? e.message : String(e))
				return "unreachable"
			}
		},
	})
}

/** L9 runtime interlock + defense-in-depth recipient validity, both BEFORE the
 *  irreversible L1 tx. Salt-v2: a derived-secret deposit against an old bearer-bridge
 *  manifest would strand funds. Validity (codex ultra Low): a nonzero-but-invalid
 *  recipient (not a Grumpkin point) would be committed and then mint an undecryptable,
 *  unrecoverable note — the wallet-connected address is always valid, but fail closed. */
async function assertPrivateDepositAllowed(isPrivate: boolean, recipient: string): Promise<void> {
	if (isPrivate && !SUPPORTS_SALT_V2) {
		throw new Error(
			"This deployment predates recipient-committed private claims (manifest lacks privateClaimMode: salt-v2). Private bridging is unavailable here — use a public bridge or wait for the cutover.",
		)
	}
	if (!(await AztecAddress.fromStringUnsafe(recipient).isValid())) {
		throw new Error("Selected account is not a valid Aztec address — refusing to bridge.")
	}
}

/** The staged sequence between the guards and the cleanup matrix. `scratch.id` is an
 *  out-param: it must be visible to the caller's catch from the moment it exists, so a
 *  mid-flight throw can route the cleanup to the record. */
/** The composable-owned io the staged sequence reads and writes. */
interface DepositIo {
	publicClient: unknown
	error: Ref<string | null>
	records: () => DepositJournalRecord[]
}

/** Cold-gate + fuel pre-flight prologue. `blocked` carries the user-facing copy. */
async function prepareDepositInputs(
	amount: bigint,
	isPrivate: boolean,
	opts: { fuelSlice?: bigint },
	actors: { aztec: unknown; recipient: string },
	io: DepositIo,
): Promise<{ blocked: true } | { blocked: false; fuelSlice?: bigint; fuelPre?: FuelPre }> {
	const fuelSlice = opts.fuelSlice && opts.fuelSlice > 0n ? opts.fuelSlice : undefined
	if (!fuelSlice && (await coldAccountPreflight(actors.aztec, actors.recipient)) === "blocked") {
		io.error.value = 'No gas (Fee Juice) to claim a no-fuel bridge. Turn on "arrive with gas", or fund your Aztec account first.'
		return { blocked: true }
	}
	const fuelPre = fuelSlice
		? await prepareFuelSlice({ publicClient: io.publicClient as never, amount, fuelSlice, isPrivate, recipient: actors.recipient })
		: undefined
	return { blocked: false, fuelSlice, fuelPre }
}

async function executeDeposit(
	scratch: { id: string | null },
	amount: bigint,
	isPrivate: boolean,
	opts: { onRecord?: (id: string) => void; fuelSlice?: bigint },
	actors: { wallet: unknown; from: string; aztec: unknown; recipient: string },
	io: DepositIo,
): Promise<string | null> {
	const { wallet, from, recipient } = actors
	const inputs = await prepareDepositInputs(amount, isPrivate, opts, actors, io)
	if (inputs.blocked) return null
	const { fuelSlice, fuelPre } = inputs
	const l1ctx = { publicClient: io.publicClient, wallet, from } as never as DepositL1Ctx

	await assertPrivateDepositAllowed(isPrivate, recipient)
	// `secret` is the value stored + claimed-with: for PRIVATE it's the recipient-committed claim_salt
	// (claim_private re-derives the consumption secret from it + the recipient); for PUBLIC it's the raw
	// secret (claim_public binds the recipient in its content hash). The L1-committed secretHash is over
	// the DERIVED secret for private, so a claim naming a different recipient can't consume the message.
	const secret = Fr.random()
	const committedSecret = isPrivate ? deriveTokenClaimSecret(secret, AztecAddress.fromStringUnsafe(recipient)) : secret
	const secretHash = await computeSecretHash(committedSecret)
	const id = secretHash.toString()
	scratch.id = id
	const tokenAmount = fuelSlice ? amount - fuelSlice : amount
	log("start", { id, amount: amount.toString(), fuelSlice: fuelSlice?.toString(), isPrivate })

	const base = buildDepositRecord({ id, isPrivate, tokenAmount, fuelSlice, fuelPre, recipient, secret, now: Date.now() })

	// The record exists BEFORE any signature: a storage failure aborts before the user signs
	// anything, and the stepper has a record to narrate from the first prompt on. A clean
	// rejection during the legs discards it (the cleanup matrix).
	addRecordVerified(base)
	markSessionLive(id)
	opts.onRecord?.(id)

	if (isPrivate) {
		await sealPrivateRecord({
			id,
			secretStr: secret.toString(),
			recipient,
			tokenAmountStr: tokenAmount.toString(),
			from,
			wallet: l1ctx.wallet,
			sealKeys,
			readBack: () => io.records().find((r) => r.id === id),
		})
	}

	const legCtx = { id, amount, tokenAmount, isPrivate, recipient, secretStr: secret.toString(), l1: l1ctx, sealKeys }
	if (fuelPre && fuelSlice) {
		await runFueledDepositLeg({ ...legCtx, fuelSlice, fuelPre })
		log("fueled deposit flow finished", id)
		return id
	}
	await runPlainDepositLeg(legCtx)
	log("deposit flow finished", id)
	return id
}

/**
 * The deposit flow: approve (allowance-skipped) + deposit on L1, journal-backed from the first
 * irreversible step, then the engine's claim tail. Private deposits seal the bearer secret + its
 * metadata BEFORE the first L1 tx (trust-aware: 1 signature steady-state, 2 on a wallet's first
 * private bridge), and re-seal the finalized envelope (leafIndex) with the retained in-memory
 * key - zero extra signatures.
 */
export function useDepositFlow() {
	ensureDepositJournalDeps()
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()
	const journal = useBridgeJournal()

	const busy = ref(false)
	const error = ref<string | null>(null)

	async function deposit(
		amount: bigint,
		isPrivate = false,
		opts: { onRecord?: (id: string) => void; fuelSlice?: bigint } = {},
	): Promise<string | null> {
		error.value = null
		const wallet = l1.ensureWalletClient()
		const from = l1.address.value
		const aztec = bridgeWallet.wallet.value
		const recipient = bridgeWallet.selectedAccount.value
		if (!wallet || !from) {
			error.value = "Connect your Ethereum wallet first."
			return null
		}
		if (!aztec || !recipient) {
			error.value = "Connect your Aztec wallet first."
			return null
		}
		busy.value = true
		const scratch: { id: string | null } = { id: null }
		try {
			return await executeDeposit(
				scratch,
				amount,
				isPrivate,
				opts,
				{ wallet, from, aztec, recipient },
				{
					publicClient: l1.publicClient,
					error,
					records: () => journal.records.value as DepositJournalRecord[],
				},
			)
		} catch (e) {
			handleDepositFailure(e, scratch.id, error, () => journal.records.value as DepositJournalRecord[])
		} finally {
			busy.value = false
		}
		return scratch.id
	}

	// Receipt-waits resume prompt-free on reconnect; sessionLive records continue. Nothing else moves.
	watch(
		() => bridgeWallet.status.value === "connected",
		(connected) => {
			if (connected) resumeSessionWork()
		},
		{ immediate: true },
	)

	// withOperation: a deposit is an account-sensitive prompt/send span — while it runs, account
	// switching is blocked (useOpsInFlight, plan D-8/D-19).
	return { busy, error, deposit: (...args: Parameters<typeof deposit>) => withOperation(() => deposit(...args)), journal }
}
