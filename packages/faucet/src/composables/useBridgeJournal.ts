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
import { ref } from "vue"
import { BRIDGE, L1_PORTAL } from "@/contracts/bridge-deployments"

// Verbose tracing while the bridge flows are being hardened — ids, stages, tx hashes ONLY.
// Secrets, envelopes, signatures, and keys must never reach this log.
const log = (...args: unknown[]) => console.log("[bridge:journal]", ...args)

const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** The L1→L2 message isn't consumable until the sequencer folds it into a block AND this wallet's
 *  PXE syncs it; both claim paths revert with one of these wordings until then. After a SUCCESSFUL
 *  claim receipt the same "no message" wording means CONSUMED — that pairing is the tx-identity check. */
export const isMsgNotReady = (msg: string): boolean =>
	/l1_to_l2_msg_exists|nonexistent L1-to-L2|message not in state|No L1 to L2 message found/i.test(msg)

export type Attention = "mismatch" | "tampered" | "unseal-failed" | "stale" | "stale-deployment" | "unknown-outcome" | "error"

export interface RecordRuntime {
	busy?: boolean
	attention?: Attention
	/** Human-readable detail for the attention state. */
	note?: string
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
	/** Aztec-node receipt lookup: "success" | "dropped" | "reverted" | "pending". */
	claimReceiptStatus?: (txHash: string) => Promise<"success" | "dropped" | "reverted" | "pending">
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

/** Wire the real chain deps (and re-wire freely — tests inject fakes). */
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
		// Another tab wrote the journal — rehydrate; per-record merge writes make this loss-free.
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
 *  L1 tx — a storage failure here aborts the flow instead of proceeding into stranding. */
export function addRecordVerified(rec: BridgeJournalRecord): void {
	upsertRecord(deps.kv, rec)
	const readBack = loadJournal(deps.kv).find((r) => r.id === rec.id)
	if (!readBack) throw new Error("Could not persist the bridge record — aborting before the deposit (storage full?).")
	reload()
}

export function updateRecord(id: string, patch: Partial<BridgeJournalRecord>): void {
	patchRecord(id, patch)
}

/** Provisional-withdraw upgrade: replace the `wd-pending-*` record under its real exitTxHash id. */
export function rekeyJournalRecord(oldId: string, next: BridgeJournalRecord): void {
	rekeyRecord(deps.kv, oldId, next)
	if (sessionLive.delete(oldId)) sessionLive.add(next.id)
	reload()
}

export function discard(id: string): void {
	removeRecord(deps.kv, id)
	secretCache.delete(id)
	sessionLive.delete(id)
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
		setRuntime(rec.id, { attention: "stale", note: "This record has no sealed secret — it cannot be claimed." })
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
		// Revoke trust ONLY for the account that claims to have sealed this record — a wrong-account
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
			note: `This record was sealed by ${envelope.sealerL1} — connect that Ethereum account.`,
		})
		return null
	}
	if (!envelopeMatchesRecord(envelope, rec)) {
		// The display lied; the envelope is the authenticated truth. Rewrite + require a re-click.
		patchRecord(rec.id, { recipient: envelope.recipient, amount: envelope.amount, leafIndex: envelope.leafIndex ?? rec.leafIndex })
		setRuntime(rec.id, {
			attention: "tampered",
			note: "Stored details didn't match the sealed copy — showing the sealed values. Review and claim again.",
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
		log("already in flight — skipping duplicate", id)
		return
	}
	inFlight.add(id)
	setRuntime(id, { busy: true })
	try {
		await fn()
	} finally {
		inFlight.delete(id)
		setRuntime(id, { busy: false })
	}
}

const wait = (ms: number): Promise<void> => (deps.waitMs ? deps.waitMs(ms) : new Promise((r) => setTimeout(r, ms)))

/**
 * The deposit claim tail: guards → secret resolution → sync-gate → ONE send → receipt-anchored,
 * identity-checked completion. Explicit-click only for rediscovered records; the deposit flow
 * calls it directly for sessionLive ones.
 */
export async function runDepositClaim(id: string): Promise<void> {
	await withRecordLock(id, async () => {
		const rec = records.value.find((r) => r.id === id && r.direction === "deposit") as DepositJournalRecord | undefined
		if (!rec || rec.completedAt) return
		if (!guardDeployment(rec)) return
		if (!deps.claim || !deps.claimReceiptStatus) throw new Error("Journal deps not connected")

		// Pre-click recipient guard (private): the claim mints a NOTE to rec.recipient — never claim
		// when a different Aztec account is connected.
		const aztec = deps.connectedAztec?.() ?? null
		if (rec.isPrivate && aztec && rec.recipient && aztec.toLowerCase() !== rec.recipient.toLowerCase()) {
			setRuntime(id, { attention: "mismatch", note: `This private deposit claims to ${rec.recipient}. Connect that Aztec account.` })
			return
		}

		// An already-sent claim is finished by waiting on ITS receipt — prompt-free, never a re-send.
		if (rec.claimTxHash) {
			await finishDepositByReceipt(rec)
			return
		}

		// No leafIndex ⇒ the deposit leg hasn't finished. Claiming now would gate-poll on leaf 0 while
		// HOLDING the record lock — and the deposit flow's own claim would then be skipped as a
		// duplicate. Bail; the flow (or an explicit click once leafIndex exists) re-enters.
		if (!rec.leafIndex) {
			log("no leafIndex yet — the deposit leg is still running", id)
			return
		}

		let secretHex: string
		if (rec.isPrivate) {
			const resolved = await resolvePrivateSecret(rec)
			if (!resolved) return
			secretHex = resolved.secretHex
		} else {
			if (!rec.secret) {
				setRuntime(id, { attention: "stale", note: "This record has no claim secret — it cannot be claimed." })
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
			try {
				await interaction.simulate()
				ready = true
				break
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				if (!isMsgNotReady(msg)) throw e
				log(`message not consumable yet (poll ${i + 1}) — waiting 6s`, id)
				await wait(6000)
			}
		}
		if (!ready) throw new Error("the L1→L2 message never became consumable — claim it again from the journal later")
		setRuntime(id, { claimable: true })

		const { txHash } = await runOnLane("aztec", () => interaction.send())
		log("claim sent", { id, txHash })
		patchRecord(id, { claimTxHash: txHash })
		await finishDepositByReceipt(records.value.find((r) => r.id === id) as DepositJournalRecord)
	})
}

/** Receipt-anchored, identity-checked deposit completion (D4). */
async function finishDepositByReceipt(rec: DepositJournalRecord): Promise<void> {
	if (!deps.claimReceiptStatus || !rec.claimTxHash) return
	let droppedStreak = 0
	for (let i = 0; i < 45; i++) {
		const status = await deps.claimReceiptStatus(rec.claimTxHash)
		if (status === "success") {
			// Identity check: after a successful receipt, THIS record's message must be gone. A claim
			// that still simulates clean means the receipt belonged to some other tx ⇒ unknown-outcome.
			const consumed = await recordMessageConsumed(rec)
			if (consumed === false) {
				setRuntime(rec.id, {
					attention: "unknown-outcome",
					note: "A claim receipt succeeded but this record's message is still claimable — not marking it done.",
				})
				return
			}
			patchRecord(rec.id, { completedAt: deps.now() })
			secretCache.delete(rec.id)
			log("deposit complete", rec.id)
			return
		}
		if (status === "reverted") {
			setRuntime(rec.id, { attention: "error", note: "The claim reverted on Aztec. You can retry from this card." })
			return
		}
		if (status === "dropped") {
			// Debounced: a freshly-proposed tx can read dropped/unknown transiently.
			droppedStreak++
			if (droppedStreak >= 3) {
				patchRecord(rec.id, { claimTxHash: undefined })
				setRuntime(rec.id, { attention: "error", note: "The claim was dropped — claim again from this card." })
				return
			}
		} else {
			droppedStreak = 0
		}
		await wait(4000)
	}
	setRuntime(rec.id, {
		attention: "unknown-outcome",
		note: "The claim's outcome couldn't be confirmed yet — Retry checks again (no new signature).",
	})
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
		if (isMsgNotReady(msg)) return true // The message is gone — consumed by the claim we waited on.
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
			const legit = (await deps.verifyConsumeIdentity?.(rec, rec.consumeTxHash)) ?? true
			if (!legit) {
				setRuntime(id, {
					attention: "unknown-outcome",
					note: "The recorded finish transaction doesn't match this withdrawal — not marking it done.",
				})
				return
			}
			log("consume already submitted — waiting on it", { id, consumeTxHash: rec.consumeTxHash })
			if (await deps.waitConsumeReceipt(rec.consumeTxHash)) {
				patchRecord(id, { completedAt: deps.now() })
				return
			}
			patchRecord(id, { consumeTxHash: undefined })
			setRuntime(id, { attention: "error", note: "The prior finish transaction failed — finish again from this card." })
			return
		}

		const { consumeTxHash } = await deps.consume(rec, (p) => setRuntime(id, p))
		patchRecord(id, { consumeTxHash })
		if (await deps.waitConsumeReceipt(consumeTxHash)) {
			patchRecord(id, { completedAt: deps.now() })
			log("withdraw complete", id)
		} else {
			patchRecord(id, { consumeTxHash: undefined })
			setRuntime(id, { attention: "error", note: "The finish transaction failed — finish again from this card." })
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
		// leafIndex is between L1 legs, a withdraw without an exitTxHash is mid-exit-prompt — re-entering
		// them here races the flow (and would tag a live provisional record unknown-outcome).
		if (rec.direction === "deposit" && !(rec as DepositJournalRecord).leafIndex && !(rec as DepositJournalRecord).claimTxHash) continue
		if (rec.direction === "withdraw" && !(rec as WithdrawJournalRecord).exitTxHash) continue
		if (rec.direction === "deposit") void runDepositClaim(rec.id)
		else void runWithdrawConsume(rec.id)
	}
}

export function useBridgeJournal() {
	initJournal()
	return {
		records,
		runtime,
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
