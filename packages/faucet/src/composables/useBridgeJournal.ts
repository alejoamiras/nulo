import {
	type BridgeJournalRecord,
	type DepositEnvelopeV2,
	type DepositJournalRecord,
	type KV,
	type WithdrawJournalRecord,
	clearLegacyKeys,
	envelopeMatchesRecord,
	loadJournal,
	openDepositEnvelope,
	patchRecord as journalPatch,
	pruneCompleted,
	recoveryKeyFromSignature,
	recoveryKeyMessage,
	rekeyRecord,
	removeRecord,
	revokeSealTrust,
	upsertRecord,
} from "@nulo/bridge-core"
import { sepolia } from "viem/chains"
import { computed, ref } from "vue"
import { BRIDGE, L1_PORTAL } from "@/contracts/bridge-deployments"

// Verbose tracing while the bridge flows are being hardened - ids, stages, tx hashes ONLY.
// Secrets, envelopes, signatures, and keys must never reach this log.
const log = (...args: unknown[]) => console.log("[bridge:journal]", ...args)

const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** The L1→L2 message isn't consumable until the sequencer folds it into a block AND this wallet's
 *  PXE syncs it; both claim paths revert with one of these wordings until then. After a SUCCESSFUL
 *  claim receipt the same "no message" wording means CONSUMED - that pairing is the tx-identity check. */
export const isMsgNotReady = (msg: string): boolean =>
	/l1_to_l2_msg_exists|nonexistent L1-to-L2|message not in state|No L1 to L2 message found/i.test(msg)

export type Attention = "mismatch" | "tampered" | "unseal-failed" | "stale" | "stale-deployment" | "unknown-outcome" | "error"

/** The live narration of what is happening RIGHT NOW for a record - engine steps plus the flows'
 *  L1/L2 legs. Ephemeral display state only - never persisted, never an input to completion logic. */
export type BridgeStep =
	| "sealing"
	| "approving"
	| "depositing"
	| "exiting"
	| "unsealing"
	| "syncing"
	| "sending"
	| "confirming"
	| "verifying"

export interface RecordRuntime {
	busy?: boolean
	attention?: Attention
	/** Human-readable detail for the attention state. */
	note?: string
	/** Live narration (D1): the current step + a free-text detail (poll counts etc.). */
	step?: BridgeStep
	stepDetail?: string
	/** Set after the post-✓ grace: the card leaves the rendered list; the RECORD stays in storage. */
	hidden?: boolean
	/** Whether the APPROVE leg was skipped (sufficient allowance) or completed - display-only,
	 *  underivable from facts once the flow advances (plan S15). Absent after a reload. */
	approveOutcome?: "skipped" | "done"
	/** Withdraw proving countdown inputs. */
	provenBlock?: number
	targetBlock?: number
	/** Deposit: the record's message is presumed consumable (leafIndex known). */
	claimable?: boolean
	proven?: boolean
}

/**
 * Chain/wallet boundaries injected so the engine is unit-testable with plain fakes. Production
 * wiring lives in the composables that own the real clients (useDepositFlow / useWithdrawFlow /
 * BridgeView) and passes these once at startup via `connectJournalDeps`.
 */
export interface JournalEngineDeps {
	kv: KV
	now: () => number
	/** Sign an EIP-191 message with the CONNECTED L1 account (used to re-derive seal keys). */
	signL1?: (message: string) => Promise<string>
	connectedL1?: () => string | null
	connectedAztec?: () => string | null
	/** Build the claim interaction for a deposit record; returns simulate/send handles. */
	claim?: (
		rec: DepositJournalRecord,
		secretHex: string,
	) => Promise<{
		simulate: () => Promise<unknown>
		send: () => Promise<{ txHash: string }>
	}>
	/** Aztec-node receipt lookup. "unreachable" = transport failure - a dead RPC must read as a
	 *  connectivity problem, never as a slow ("pending") claim. */
	claimReceiptStatus?: (txHash: string) => Promise<"success" | "dropped" | "reverted" | "pending" | "unreachable">
	/** Drive a withdraw record's proven-wait → witness → L1 consume. Returns the consume tx hash.
	 *  onProgress streams { provenBlock, targetBlock } for the countdown. */
	consume?: (
		rec: WithdrawJournalRecord,
		onProgress: (p: { provenBlock?: number; targetBlock?: number }) => void,
	) => Promise<{ consumeTxHash: string }>
	/** Wait for an already-submitted consume tx; true = success. */
	waitConsumeReceipt?: (txHash: string) => Promise<boolean>
	/** Verify a rediscovered consume tx actually consumes THIS record's exit (identity check). */
	verifyConsumeIdentity?: (rec: WithdrawJournalRecord, txHash: string) => Promise<boolean>
	/** Injectable wait (tests pass a no-op; production uses real timers). */
	waitMs?: (ms: number) => Promise<void>
}

const records = ref<BridgeJournalRecord[]>([])
const runtime = ref<Record<string, RecordRuntime>>({})

// Module state, deliberately non-reactive: secrets and locks never enter Vue reactivity.
const sessionLive = new Set<string>()
const inFlight = new Set<string>()
const secretCache = new Map<string, { secretHex: string; envelope: DepositEnvelopeV2 }>()
// F12: set ONLY when THIS process passed the sync gate and dispatched the claim send - the
// forge-resistant provenance that scopes deposit auto-hide. Deliberately NOT sessionLive.
const localClaimProvenance = new Set<string>()
// F11: per-record generation token - every fresh runner entry and every discard bumps it, so a
// chunked receipt round scheduled before the bump exits silently instead of racing the new owner.
const generations = new Map<string, number>()
// Cumulative exhausted receipt rounds per record (caps the ~30-min soft wait).
const receiptRounds = new Map<string, number>()

function bumpGen(id: string): number {
	const next = (generations.get(id) ?? 0) + 1
	generations.set(id, next)
	return next
}
function genOf(id: string): number {
	return generations.get(id) ?? 0
}
// One promptful action per wallet lane at a time; acquired per INDIVIDUAL prompt, never held
// across the other lane's await (the ABBA rule).
const lanes: Record<"l1" | "aztec", Promise<void>> = { l1: Promise.resolve(), aztec: Promise.resolve() }

let deps: JournalEngineDeps = { kv: typeof localStorage === "undefined" ? memoryKV() : localStorage, now: Date.now }
let initialized = false

function memoryKV(): KV {
	const store = new Map<string, string>()
	return {
		getItem: (k) => store.get(k) ?? null,
		setItem: (k, v) => void store.set(k, v),
		removeItem: (k) => void store.delete(k),
	}
}

export function runOnLane<T>(lane: "l1" | "aztec", fn: () => Promise<T>): Promise<T> {
	const result = lanes[lane].then(fn)
	lanes[lane] = result.then(
		() => undefined,
		() => undefined,
	)
	return result
}

function reload(): void {
	records.value = loadJournal(deps.kv)
}

function setRuntime(id: string, patch: RecordRuntime): void {
	runtime.value = { ...runtime.value, [id]: { ...runtime.value[id], ...patch } }
}

function patchRecord(id: string, patch: Partial<BridgeJournalRecord>): void {
	journalPatch(deps.kv, id, patch)
	reload()
}

/** Wire the real chain deps (and re-wire freely - tests inject fakes). */
export function connectJournalDeps(next: Partial<JournalEngineDeps>): void {
	deps = { ...deps, ...next }
}

export function initJournal(): void {
	if (initialized) return
	initialized = true
	clearLegacyKeys(deps.kv)
	pruneCompleted(deps.kv, PRUNE_AFTER_MS, deps.now())
	reload()
	if (typeof window !== "undefined") {
		// Another tab wrote the journal - rehydrate; per-record merge writes make this loss-free.
		window.addEventListener("storage", (e) => {
			if (e.key === null || e.key.startsWith("nulo-bridge:journal")) reload()
		})
	}
	log("journal initialized", { records: records.value.length })
}

/** TEST-ONLY: reset module state between cases. */
export function __resetJournalForTests(): void {
	initialized = false
	records.value = []
	runtime.value = {}
	sessionLive.clear()
	inFlight.clear()
	secretCache.clear()
	localClaimProvenance.clear()
	generations.clear()
	receiptRounds.clear()
	lastCompleted.value = null
	activeFlowId.value = null
	lanes.l1 = Promise.resolve()
	lanes.aztec = Promise.resolve()
	deps = { kv: memoryKV(), now: Date.now }
}

export function markSessionLive(id: string): void {
	sessionLive.add(id)
}
export function isSessionLive(id: string): boolean {
	return sessionLive.has(id)
}
export function cacheSecret(id: string, secretHex: string, envelope: DepositEnvelopeV2): void {
	secretCache.set(id, { secretHex, envelope })
}

export function addRecord(rec: BridgeJournalRecord): void {
	upsertRecord(deps.kv, rec)
	reload()
}

/** Write-and-verify: a private deposit's record must be durably stored BEFORE the irreversible
 *  L1 tx - a storage failure here aborts the flow instead of proceeding into stranding. */
export function addRecordVerified(rec: BridgeJournalRecord): void {
	upsertRecord(deps.kv, rec)
	const readBack = loadJournal(deps.kv).find((r) => r.id === rec.id)
	if (!readBack) throw new Error("Could not persist the bridge record - aborting before the deposit (storage full?).")
	reload()
}

export function updateRecord(id: string, patch: Partial<BridgeJournalRecord>): void {
	patchRecord(id, patch)
}

/** Provisional-withdraw upgrade: replace the `wd-pending-*` record under its real exitTxHash id.
 *  Foreground ownership follows the rekey, or the stepper would lose its record mid-watch. */
export function rekeyJournalRecord(oldId: string, next: BridgeJournalRecord): void {
	rekeyRecord(deps.kv, oldId, next)
	if (sessionLive.delete(oldId)) sessionLive.add(next.id)
	if (activeFlowId.value === oldId) activeFlowId.value = next.id
	reload()
}

export function discard(id: string): void {
	bumpGen(id) // Any in-flight chunked round dies at its next generation check.
	removeRecord(deps.kv, id)
	secretCache.delete(id)
	sessionLive.delete(id)
	localClaimProvenance.delete(id)
	receiptRounds.delete(id)
	// Drop the runtime entry entirely - a discarded card must not resurrect stale state.
	const { [id]: _gone, ...rest } = runtime.value
	runtime.value = rest
	reload()
	log("discarded", id)
}

export const clearDone = discard

/** Deployment binding: a record from another deployment never resumes (stale-deployment). */
export function deploymentMatches(rec: BridgeJournalRecord): boolean {
	return (
		rec.chainId === sepolia.id &&
		rec.portal?.toLowerCase() === L1_PORTAL.toLowerCase() &&
		rec.bridge?.toLowerCase() === BRIDGE.toString().toLowerCase()
	)
}

function guardDeployment(rec: BridgeJournalRecord): boolean {
	if (deploymentMatches(rec)) return true
	setRuntime(rec.id, { attention: "stale-deployment", note: "This record belongs to a different bridge deployment." })
	return false
}

/**
 * Resolve a private deposit's secret + authoritative metadata. Same-session: served from the
 * in-memory cache, ZERO signatures. Rediscovered: one L1 signature re-derives the per-record key,
 * the v2 envelope is opened (the ONLY accepted shape) and verified against the record's display
 * fields; mismatch rewrites the display from the envelope and stops for an explicit re-click.
 */
async function resolvePrivateSecret(rec: DepositJournalRecord): Promise<{ secretHex: string; envelope: DepositEnvelopeV2 } | null> {
	const cached = secretCache.get(rec.id)
	if (cached) return cached
	if (!deps.signL1) {
		setRuntime(rec.id, { attention: "error", note: "Connect your Ethereum wallet to unseal this claim." })
		return null
	}
	if (!rec.sealedEnvelope) {
		setRuntime(rec.id, { attention: "stale", note: "This record has no sealed secret - it cannot be claimed." })
		return null
	}
	const connected = deps.connectedL1?.()?.toLowerCase() ?? null
	if (rec.sealerL1 && connected && connected !== rec.sealerL1.toLowerCase()) {
		setRuntime(rec.id, { attention: "mismatch", note: `Connect the Ethereum account that sealed this record (${rec.sealerL1}).` })
		return null
	}
	const binding = { chainId: rec.chainId, portal: rec.portal, bridge: rec.bridge, secretHashHex: rec.secretHashHex }
	let envelope: DepositEnvelopeV2
	try {
		const key = await recoveryKeyFromSignature(
			await runOnLane("l1", () => deps.signL1?.(recoveryKeyMessage(binding)) as Promise<string>),
		)
		envelope = await openDepositEnvelope(key, rec.sealedEnvelope)
	} catch {
		// Revoke trust ONLY for the account that claims to have sealed this record - a wrong-account
		// attempt must not destroy the connected account's valid verdict.
		if (connected && rec.sealerL1 && connected === rec.sealerL1.toLowerCase()) {
			revokeSealTrust(deps.kv, rec.chainId, connected)
		}
		setRuntime(rec.id, {
			attention: "unseal-failed",
			note: "Your signature didn't open this record. If this address lives in more than one wallet app, retry with the one used at deposit time. Nothing was deleted.",
		})
		return null
	}
	if (envelope.sealerL1 && connected && envelope.sealerL1.toLowerCase() !== connected) {
		setRuntime(rec.id, {
			attention: "mismatch",
			note: `This record was sealed by ${envelope.sealerL1} - connect that Ethereum account.`,
		})
		return null
	}
	if (!envelopeMatchesRecord(envelope, rec)) {
		// The display lied; the envelope is the authenticated truth. Rewrite + require a re-click.
		patchRecord(rec.id, { recipient: envelope.recipient, amount: envelope.amount, leafIndex: envelope.leafIndex ?? rec.leafIndex })
		setRuntime(rec.id, {
			attention: "tampered",
			note: "Stored details didn't match the sealed copy - showing the sealed values. Review and claim again.",
		})
		return null
	}
	const resolved = { secretHex: envelope.secret, envelope }
	secretCache.set(rec.id, resolved)
	return resolved
}

/** Per-record dedup wrapper. */
async function withRecordLock(id: string, fn: () => Promise<void>): Promise<void> {
	if (inFlight.has(id)) {
		log("already in flight - skipping duplicate", id)
		return
	}
	inFlight.add(id)
	setRuntime(id, { busy: true })
	try {
		await fn()
	} finally {
		inFlight.delete(id)
		// Structural step cleanup: narration never outlives the runner, success or throw - but never
		// resurrect a runtime entry for a record that was discarded while we ran.
		if (records.value.some((r) => r.id === id)) {
			setRuntime(id, { busy: false, step: undefined, stepDetail: undefined })
		}
	}
}

const wait = (ms: number): Promise<void> => (deps.waitMs ? deps.waitMs(ms) : new Promise((r) => setTimeout(r, ms)))

const HIDE_GRACE_MS = 8000
const RECEIPT_POLLS_PER_ROUND = 45 // ×4s ≈ one ~3-minute round inside the lock.
const RECEIPT_MAX_ROUNDS = 10 // ≈30 min soft cap; after it the card re-arms RETRY, never a dead-end.
const INTER_ROUND_MS = 100

/** The most recent verified completion - P2's toast hook. */
export const lastCompleted = ref<{
	id: string
	direction: "deposit" | "withdraw"
	amount: string
	isPrivate: boolean
	txHash?: string
} | null>(null)

function setStep(id: string, step?: BridgeStep, stepDetail?: string): void {
	setRuntime(id, { step, stepDetail })
}

/** The flows' narration channel into the per-record runtime (plan S3). */
export function setRecordStep(id: string, step?: BridgeStep, stepDetail?: string): void {
	setStep(id, step, stepDetail)
}

/** Display-only APPROVE outcome (plan S15) - written at the allowance decision. */
export function markApproveOutcome(id: string, outcome: "skipped" | "done"): void {
	setRuntime(id, { approveOutcome: outcome })
}

/** Surface a flow-leg failure on the record (the stepper/card render it; the engine is untouched). */
export function flagRecordError(id: string, note: string): void {
	setRuntime(id, { attention: "error", note })
}

/**
 * Foreground ownership (plan S13): UI-owned, compare-and-swap. While a record is foreground, the
 * journal list suppresses its card - the stepper/receipt is its only surface. In-memory only:
 * a reload structurally fails open (the card appears). Flow promises never touch this.
 */
export const activeFlowId = ref<string | null>(null)

export function claimForeground(id: string): void {
	activeFlowId.value = id
}

/** CAS release: a stale owner (backgrounded, superseded, settled flow) cannot clear the current one. */
export function releaseForeground(id: string): void {
	if (activeFlowId.value === id) activeFlowId.value = null
}

/** After the ✓ grace, the card leaves the rendered list. The RECORD is untouched - deletion
 *  stays human-only or the 7-day prune (D3: hide, never destroy). */
function scheduleAutoHide(id: string): void {
	void wait(HIDE_GRACE_MS).then(() => {
		const rec = records.value.find((r) => r.id === id)
		if (rec?.completedAt) setRuntime(id, { hidden: true })
	})
}

function completeDeposit(rec: DepositJournalRecord | undefined): void {
	// Cross-tab guard: another tab may have discarded (record gone) or completed this record while
	// we ran - generations are tab-local, so the WRITE must be existence- and idempotency-checked.
	if (!rec) return
	const current = records.value.find((r) => r.id === rec.id)
	if (!current || current.completedAt) return
	patchRecord(rec.id, { completedAt: deps.now() })
	setRuntime(rec.id, { attention: undefined, note: undefined })
	secretCache.delete(rec.id)
	receiptRounds.delete(rec.id)
	lastCompleted.value = { id: rec.id, direction: "deposit", amount: rec.amount, isPrivate: rec.isPrivate, txHash: rec.claimTxHash }
	// F9/F12 scope: only a completion whose gate-pass + send happened in THIS process auto-hides;
	// a rediscovered receipt-wait keeps its ✓ card for a human glance (manual CLEAR).
	if (localClaimProvenance.has(rec.id)) scheduleAutoHide(rec.id)
	localClaimProvenance.delete(rec.id)
	log("deposit complete", rec.id)
}

function completeWithdraw(rec: WithdrawJournalRecord | undefined, consumeTxHash?: string): void {
	if (!rec) return
	const current = records.value.find((r) => r.id === rec.id)
	if (!current || current.completedAt) return
	patchRecord(rec.id, { completedAt: deps.now() })
	setRuntime(rec.id, { attention: undefined, note: undefined })
	receiptRounds.delete(rec.id)
	lastCompleted.value = { id: rec.id, direction: "withdraw", amount: rec.amount, isPrivate: rec.isPrivate, txHash: consumeTxHash }
	// Withdraw completions are witness-decode-verified - always hide-eligible.
	scheduleAutoHide(rec.id)
	log("withdraw complete", rec.id)
}

/**
 * The deposit claim tail: guards → secret resolution → sync-gate → ONE send → receipt-anchored,
 * identity-checked completion. Explicit-click only for rediscovered records; the deposit flow
 * calls it directly for sessionLive ones.
 */
export async function runDepositClaim(id: string, opts: { interactive?: boolean } = {}): Promise<void> {
	const interactive = opts.interactive !== false
	let continueRounds = false
	let gen = 0
	await withRecordLock(id, async () => {
		// F11: this runner is now the record's owner - any previously scheduled round dies silently.
		gen = bumpGen(id)
		const rec = records.value.find((r) => r.id === id && r.direction === "deposit") as DepositJournalRecord | undefined
		if (!rec || rec.completedAt) return
		if (!guardDeployment(rec)) return
		if (!deps.claim || !deps.claimReceiptStatus) throw new Error("Journal deps not connected")

		// Pre-click recipient guard (private): the claim mints a NOTE to rec.recipient - never claim
		// when a different Aztec account is connected.
		const aztec = deps.connectedAztec?.() ?? null
		if (rec.isPrivate && aztec && rec.recipient && aztec.toLowerCase() !== rec.recipient.toLowerCase()) {
			setRuntime(id, { attention: "mismatch", note: `This private deposit claims to ${rec.recipient}. Connect that Aztec account.` })
			return
		}

		// An already-sent claim is finished by waiting on ITS receipt, never a re-send. A checkpointed
		// receipt IS confirmation; the message probe (best-effort, needs the secret - an EXPLICIT
		// click on a rediscovered private record unseals it first) can only DELAY completion while
		// the PXE still shows the message as claimable.
		if (rec.claimTxHash) {
			if (rec.isPrivate && interactive && !secretCache.has(id) && rec.sealedEnvelope) {
				const resolved = await resolvePrivateSecret(rec)
				if (!resolved) return
			}
			// A fresh re-entry clears any stale soft note (the 30-min cap) before checking again.
			setRuntime(id, { attention: undefined, note: undefined })
			continueRounds = (await runReceiptRound(rec, gen)) === "continue"
			return
		}

		// No leafIndex ⇒ the deposit leg hasn't finished. Claiming now would gate-poll on leaf 0 while
		// HOLDING the record lock - and the deposit flow's own claim would then be skipped as a
		// duplicate. Bail; the flow (or an explicit click once leafIndex exists) re-enters.
		if (!rec.leafIndex) {
			log("no leafIndex yet - the deposit leg is still running", id)
			return
		}

		let secretHex: string
		if (rec.isPrivate) {
			setStep(id, "unsealing", secretCache.has(id) ? undefined : "one Ethereum signature")
			const resolved = await resolvePrivateSecret(rec)
			if (!resolved) return
			secretHex = resolved.secretHex
		} else {
			if (!rec.secret) {
				setRuntime(id, { attention: "stale", note: "This record has no claim secret - it cannot be claimed." })
				return
			}
			secretHex = rec.secret
		}
		setRuntime(id, { attention: undefined, note: undefined })

		const fresh = records.value.find((r) => r.id === id) as DepositJournalRecord
		const interaction = await deps.claim(fresh, secretHex)

		// Sync-gate: prompt-free simulate until the message is consumable by THIS wallet's PXE.
		let ready = false
		for (let i = 0; i < 300; i++) {
			setStep(id, "syncing", `sync check ${i + 1}`)
			try {
				await interaction.simulate()
				ready = true
				break
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				if (!isMsgNotReady(msg)) throw e
				log(`message not consumable yet (poll ${i + 1}) - waiting 6s`, id)
				await wait(6000)
			}
		}
		if (!ready) throw new Error("the L1→L2 message never became consumable - claim it again from the journal later")
		setRuntime(id, { claimable: true })

		setStep(id, "sending", "confirm in your Aztec wallet")
		const { txHash } = await runOnLane("aztec", () => interaction.send())
		log("claim sent", { id, txHash })
		patchRecord(id, { claimTxHash: txHash })
		receiptRounds.delete(id)
		// F12: the forge-resistant provenance - THIS process watched claimable → sent.
		localClaimProvenance.add(id)
		// Cross-tab guard: the record can vanish remotely between the send and this reread.
		const sent = records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
		if (!sent) return
		continueRounds = (await runReceiptRound(sent, gen)) === "continue"
	})
	// Chunked re-entry happens OUTSIDE the lock so RETRY/DISCARD stay reachable between rounds.
	if (continueRounds && genOf(id) === gen) {
		await wait(INTER_ROUND_MS)
		if (genOf(id) === gen) void runDepositClaim(id, { interactive: false })
	}
}

/** One ~3-minute receipt round (D4 completion, D2 narration). Returns "continue" when the claim
 *  is still pending and another round should be scheduled by the caller (outside the lock). */
async function runReceiptRound(rec: DepositJournalRecord, gen: number): Promise<"done" | "stop" | "continue"> {
	if (!deps.claimReceiptStatus || !rec.claimTxHash) return "stop"
	const roundsDone = receiptRounds.get(rec.id) ?? 0
	let droppedStreak = 0
	let unreachableStreak = 0
	for (let i = 0; i < RECEIPT_POLLS_PER_ROUND; i++) {
		if (genOf(rec.id) !== gen) return "stop" // F11: a newer owner took over (RETRY/discard/sweep).
		const checkNo = roundsDone * RECEIPT_POLLS_PER_ROUND + i + 1
		setStep(rec.id, "confirming", `check ${checkNo} - the claim is processing on Aztec`)
		const status = await deps.claimReceiptStatus(rec.claimTxHash)
		log("receipt check", { id: rec.id, checkNo, status })
		if (genOf(rec.id) !== gen) return "stop"
		if (status === "success") {
			// A checkpointed receipt for the recorded claimTxHash IS confirmation (owner decision:
			// the node's word beats the wallet's lagging PXE). The message probe is best-effort:
			// skipped when THIS process drove the send (forge-resistant provenance), and for
			// rediscovered records it can only DELAY completion while the PXE still visibly shows
			// the message as claimable - it can never dead-end a confirmed claim. Residual risk
			// (accepted): a forged-but-checkpointed claimTxHash planted in localStorage completes a
			// record; that attacker already has storage write and could delete the record outright.
			if (localClaimProvenance.has(rec.id)) {
				completeDeposit(records.value.find((r) => r.id === rec.id) as DepositJournalRecord | undefined)
				return "done"
			}
			setStep(rec.id, "verifying", "checking the claim against this record")
			const consumed = await recordMessageConsumed(rec)
			if (genOf(rec.id) !== gen) return "stop"
			if (consumed === false) {
				// The PXE still sees the message - lag right after the checkpoint, or a receipt that
				// wasn't ours. Keep polling instead of completing; the next pass re-probes.
				setStep(rec.id, "verifying", "confirmed on the node - waiting for your wallet to sync")
				await wait(4000)
				continue
			}
			completeDeposit(records.value.find((r) => r.id === rec.id) as DepositJournalRecord | undefined)
			return "done"
		}
		if (status === "reverted") {
			setRuntime(rec.id, {
				attention: "error",
				note: "The claim reverted on Aztec. You can retry from this card - the deposit remains claimable.",
			})
			return "stop"
		}
		if (status === "dropped") {
			// Debounced: a freshly-proposed tx can read dropped/unknown transiently.
			droppedStreak++
			if (droppedStreak >= 3) {
				patchRecord(rec.id, { claimTxHash: undefined })
				setRuntime(rec.id, { attention: "error", note: "The claim was dropped - claim again from this card. Nothing was lost." })
				return "stop"
			}
		} else {
			droppedStreak = 0
		}
		if (status === "unreachable") {
			// A dead RPC is a connectivity problem, never a slow claim (D2).
			unreachableStreak++
			setStep(rec.id, "confirming", `node unreachable - retrying (${unreachableStreak})`)
		} else {
			unreachableStreak = 0
		}
		await wait(4000)
	}
	receiptRounds.set(rec.id, roundsDone + 1)
	if (roundsDone + 1 >= RECEIPT_MAX_ROUNDS) {
		// Soft cap, NOT a dead-end: no attention, the card re-arms RETRY and says so.
		setStep(rec.id, undefined, undefined)
		setRuntime(rec.id, {
			note: "Still confirming after ~30 minutes - slow testnet. Press CLAIM to keep checking; your funds are safe either way.",
		})
		return "stop"
	}
	return "continue"
}

/** True/false when determinable; null when the secret isn't available for the probe (prompt-free rule). */
async function recordMessageConsumed(rec: DepositJournalRecord): Promise<boolean | null> {
	const secretHex = rec.isPrivate ? secretCache.get(rec.id)?.secretHex : rec.secret
	if (!secretHex || !deps.claim) return null
	try {
		const interaction = await deps.claim(rec, secretHex)
		await interaction.simulate()
		return false // Still claimable ⇒ that successful receipt was NOT this record's claim.
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		if (isMsgNotReady(msg)) return true // The message is gone - consumed by the claim we waited on.
		return null
	}
}

/** The withdraw consume tail: rediscovered consumeTxHash waits (with identity check) instead of
 *  re-prompting; otherwise the proven-wait → witness → ONE L1 consume runs on the L1 lane. */
export async function runWithdrawConsume(id: string): Promise<void> {
	await withRecordLock(id, async () => {
		const rec = records.value.find((r) => r.id === id && r.direction === "withdraw") as WithdrawJournalRecord | undefined
		if (!rec || rec.completedAt) return
		if (!guardDeployment(rec)) return
		if (!deps.consume || !deps.waitConsumeReceipt) throw new Error("Journal deps not connected")

		if (!rec.exitTxHash) {
			setRuntime(id, {
				attention: "unknown-outcome",
				note: "The exit was started but its transaction was never recorded (tab closed mid-send). Check your wallet activity, then discard.",
			})
			return
		}

		if (rec.consumeTxHash) {
			setStep(id, "verifying", "matching the finish transaction to this withdrawal")
			const legit = (await deps.verifyConsumeIdentity?.(rec, rec.consumeTxHash)) ?? true
			if (!legit) {
				setRuntime(id, {
					attention: "unknown-outcome",
					note: "The recorded finish transaction doesn't match this withdrawal - not marking it done. Your exited funds stay claimable on Ethereum.",
				})
				return
			}
			log("consume already submitted - waiting on it", { id, consumeTxHash: rec.consumeTxHash })
			setStep(id, "confirming", "waiting for the Ethereum confirmation")
			if (await deps.waitConsumeReceipt(rec.consumeTxHash)) {
				completeWithdraw(rec, rec.consumeTxHash)
				return
			}
			patchRecord(id, { consumeTxHash: undefined })
			setRuntime(id, {
				attention: "error",
				note: "The prior finish transaction failed - finish again from this card. Nothing was lost.",
			})
			return
		}

		setStep(id, "confirming", "waiting for the proven epoch, then one Ethereum confirmation")
		const { consumeTxHash } = await deps.consume(rec, (p) => setRuntime(id, p))
		patchRecord(id, { consumeTxHash })
		setStep(id, "confirming", "waiting for the Ethereum confirmation")
		if (await deps.waitConsumeReceipt(consumeTxHash)) {
			completeWithdraw(records.value.find((r) => r.id === id) as WithdrawJournalRecord | undefined, consumeTxHash)
		} else {
			patchRecord(id, { consumeTxHash: undefined })
			setRuntime(id, { attention: "error", note: "The finish transaction failed - finish again from this card. Nothing was lost." })
		}
	})
}

/** Auto-continue ONLY what this page session initiated, plus prompt-free receipt waits. */
export function resumeSessionWork(): void {
	for (const rec of records.value) {
		if (rec.completedAt) continue
		const promptFreeWait =
			(rec.direction === "deposit" && (rec as DepositJournalRecord).claimTxHash) ||
			(rec.direction === "withdraw" && (rec as WithdrawJournalRecord).consumeTxHash)
		if (!sessionLive.has(rec.id) && !promptFreeWait) continue
		// Mid-flight records the flow itself is still driving aren't resumable yet: a deposit without a
		// leafIndex is between L1 legs, a withdraw without an exitTxHash is mid-exit-prompt - re-entering
		// them here races the flow (and would tag a live provisional record unknown-outcome).
		if (rec.direction === "deposit" && !(rec as DepositJournalRecord).leafIndex && !(rec as DepositJournalRecord).claimTxHash) continue
		if (rec.direction === "withdraw" && !(rec as WithdrawJournalRecord).exitTxHash) continue
		if (rec.direction === "deposit") void runDepositClaim(rec.id, { interactive: false })
		else void runWithdrawConsume(rec.id)
	}
}

/** The render list: completed-and-graced cards are hidden (D3), and the FOREGROUND record is
 *  suppressed (its stepper/receipt is the one surface - plan S12/S13). Records stay in storage. */
export const visibleRecords = computed(() => records.value.filter((r) => !runtime.value[r.id]?.hidden && r.id !== activeFlowId.value))

export function useBridgeJournal() {
	initJournal()
	return {
		records,
		visibleRecords,
		runtime,
		lastCompleted,
		activeFlowId,
		claimForeground,
		releaseForeground,
		addRecord,
		addRecordVerified,
		updateRecord,
		discard,
		clearDone,
		markSessionLive,
		isSessionLive,
		cacheSecret,
		runDepositClaim,
		runWithdrawConsume,
		resumeSessionWork,
		deploymentMatches,
	}
}
