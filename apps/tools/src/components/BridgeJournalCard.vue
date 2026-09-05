<script setup lang="ts">
/** Services */
import { type BridgeJournalRecord, type DepositJournalRecord, type WithdrawJournalRecord, isProvisionalRecordId } from "@nulo/bridge-core"
import { computed, ref, watch } from "vue"

/** Composables */
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { useOpsInFlight } from "@/composables/useOpsInFlight"
import { switchActiveAccount } from "@/composables/useWalletConnection"

/** Utils */
import { ageWords } from "@/lib/activity"
import { assetDecimals, assetSymbol, recordTokenBlock } from "@/lib/asset-label"
import { useNow } from "@/lib/clock"
import { IS_MAINNET } from "@/lib/network"
import { formatStoredAmount } from "@/lib/format"
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
import { accountOf, recordState } from "@/lib/record-policy"
import { TESTIDS } from "@/lib/testids"
import { safeAddressText, safeDisplay, safeSentence } from "@/lib/token-display"
import { claimFuelStandalone, overrideFuelClaim, reconcileFuelConsumed } from "@/composables/fuel-recovery"

/** Components */
import BridgePhaseRail from "./BridgePhaseRail.vue"

const props = defineProps<{ record: BridgeJournalRecord }>()
const emit = defineEmits<{ backup: [record: BridgeJournalRecord] }>()

const journal = useBridgeJournal()
const exportable = computed(() => {
	if (isProvisionalRecordId(props.record.id)) return false
	const r = props.record
	// A private deposit pre-seal has no recovery material - a file now would be a false promise.
	if (r.direction === "deposit" && r.isPrivate && !(r as DepositJournalRecord).sealedEnvelope) return false
	return true
})

const discardArmed = ref(false)
// An armed CONFIRM DISCARD that never fires must disarm - a stale armed state turns a later
// stray click into destroying a private deposit's only sealed secret.
let disarmTimer: ReturnType<typeof setTimeout> | undefined
watch(discardArmed, (armed) => {
	clearTimeout(disarmTimer)
	if (armed)
		disarmTimer = setTimeout(() => {
			discardArmed.value = false
		}, 6000)
})

const rt = computed(() => journal.runtime.value[props.record.id] ?? {})
const bridgeWallet = useBridgeWallet()
const walletView = computed(() => ({
	status: bridgeWallet.status.value,
	selectedAccount: bridgeWallet.selectedAccount.value,
	accounts: bridgeWallet.accounts.value,
}))
// The gates live in the shared policy so the activity dock and this card can never disagree.
const state = computed(() => recordState(props.record, rt.value, walletView.value))

// Deposits persist their Aztec-side account (`recipient`); withdraws carry no account tag by design
// (their FINISH is an L1 action the account guard ignores).
const { busy: opsBusy } = useOpsInFlight()

/** Display copy only: the raw recipient still drives matching. A restore file can carry any string
 *  here, so control and bidi characters are stripped before it can pose as an account. */
function shortAddr(a: string): string {
	const clean = safeAddressText(a)
	return clean.length > 12 ? `${clean.slice(0, 6)}…${clean.slice(-4)}` : clean
}

const acct = computed(() => accountOf(props.record, walletView.value))

/** When the record belongs to ANOTHER granted account, offer the one-click switch instead of bouncing
 *  off the guard's note. A recipient outside the grant keeps the normal action (the engine's mismatch
 *  guard explains why it refuses). */
const offerSwitch = computed(() => state.value.ownedByOther)
const switchLabel = computed(() => {
	const a = acct.value
	return a ? `SWITCH TO ${(a.alias ?? shortAddr(a.addr)).toUpperCase()}` : ""
})
function onSwitchAccount() {
	const canonical = state.value.switchTarget
	if (canonical) switchActiveAccount(canonical)
}

// A DIRECT Fuel record (assetKind "fee-juice") IS Fee Juice — no token leg. Its `fuel` block mirrors the
// amount, so the token-bridge surfaces (the amount line, the "+FJ" add-on, "CLAIM WITHOUT FUEL") would
// double-count or mislabel it. Branch those off this flag; swap-fuel + token records are unaffected.
const isFuel = computed(() => state.value.isFuel)

/** Fuel surface (schema-2 deposits): the received-FJ line + the L14 manual escape. */
const fuel = computed(() => {
	const r = props.record
	return r.direction === "deposit" ? (r as DepositJournalRecord).fuel : undefined
})
const fuelAmount = computed(() => {
	const f = fuel.value
	if (!f) return null
	// Gas naming by surface: private bridges land "Private FJ", public land "FJ".
	const label = props.record.isPrivate ? "Private FJ" : "FJ"
	return f.received ? `+ ${formatStoredAmount(f.received, 18)} ${label}` : `+ ${label} gas`
})
// The explicit, non-destructive escape: claim the tokens with the gas the account already holds; the FJ message (if
// unconsumed) stays claimable later. Offered only when a fueled claim is stuck on an error.
const showClaimWithoutFuel = computed(() => state.value.showClaimWithoutFuel)
function onClaimWithoutFuel() {
	overrideFuelClaim(props.record.id)
	onAction()
}

// Post-completion fuel recovery: the token side finished but the FJ was neither consumed by an
// fjwc claim nor landed standalone - offer to claim it now (it pays its own claim, safe to retry; a
// reverting "already claimed" just clears the affordance). Shared with `claimFuelStandalone`'s own
// guard, so the affordance and the action can never disagree.
const fuelRecovery = computed(() => state.value.fuelRecovery)
const fuelRecoverable = computed(() => state.value.fuelRecoverable)
/** Private bridge whose private-claim metadata is incomplete: its gas state is genuinely unknown and
 *  the public recovery must not be offered — so say so rather than showing nothing. Deliberately
 *  advertises no action: this renders only on COMPLETED records, which re-run no claim, so any
 *  "retry" advice here would be false. */
const privateFuelUnknown = computed(() => fuelRecovery.value === "private-unknown")
const fuelRecovering = ref(false)
const fuelRecoverError = ref<string | null>(null)

// Reconcile the consumed flag from chain truth when a completed fueled record is shown: the happy
// fjwc path latches `consumed` here (inclusion-grade) so `fuelRecoverable` stays false without the
// button flashing. Best-effort - a failure just leaves the (safe, idempotent) recovery offered.
watch(
	() => props.record.completedAt !== undefined && fuel.value?.received !== undefined && fuel.value?.consumed !== true,
	(needsReconcile) => {
		if (needsReconcile) void reconcileFuelConsumed(props.record.id).catch(() => {})
	},
	{ immediate: true },
)
async function onClaimGas() {
	if (fuelRecovering.value) return
	fuelRecovering.value = true
	fuelRecoverError.value = null
	try {
		await claimFuelStandalone(props.record.id)
	} catch (e) {
		fuelRecoverError.value = e instanceof Error ? e.message : "Could not claim your gas - try again."
	} finally {
		fuelRecovering.value = false
	}
}
const busy = computed(() => state.value.busy)
const stage = computed(() => state.value.stage)
const attention = computed(() => state.value.attention)
/** Persisted refusal: a re-read of the chain contradicted this record's own token facts. It never
 *  runs again, and unlike the runtime attention it survives a reload — so the card states the
 *  reason from the moment it renders. The text is persisted, so a restore file can carry anything:
 *  stripped and capped like every other stored string before it is shown. */
const blocked = computed(() => (state.value.blocked === undefined ? undefined : safeSentence(state.value.blocked)))
const actionable = computed(() => state.value.actionable)

/** Guidance for an IDLE card only: while the engine drives (busy) the rail narrates live, and a
 *  done card's stamp says everything - a parallel stage line would just repeat them. */
const stageLabel = computed(() => {
	// A terminal record has no CLAIM/FINISH button, so guidance telling the user to press one would
	// point at something that isn't there.
	if (rt.value.busy || stage.value === "done" || !actionable.value) return null
	const r = props.record
	if (r.direction === "deposit") {
		switch (stage.value) {
			case "depositing":
				// With a recorded tx hash the leg is chain-recoverable (the engine re-derives it from
				// the mined receipt) - offer the action instead of the discard guidance.
				return (r as DepositJournalRecord).depositTxHash
					? "The Ethereum deposit was sent but its confirmation was interrupted. Press CLAIM to check it on-chain and continue."
					: "The deposit never confirmed on Ethereum. Check your wallet activity, then discard if it never landed."
			case "syncing":
			case "claimable":
				return r.isPrivate
					? "Press CLAIM: one Ethereum signature unseals the recovery secret, then your Aztec wallet confirms."
					: "Press CLAIM, then confirm in your Aztec wallet."
			case "claiming":
				return "Claim sent - press CLAIM to keep watching it confirm."
			default:
				return null
		}
	}
	switch (stage.value) {
		case "exiting":
			return "The exit was interrupted. Check your wallet activity, then discard if nothing was sent."
		case "proving":
			return "Press FINISH to resume - proving lands in epoch batches and can take a while."
		case "consumable":
			return "Proven. Press FINISH: one Ethereum signature releases the funds."
		case "consuming":
			return "Finish sent - press FINISH to keep watching it confirm."
		default:
			return null
	}
})

// Buttons appear only when PRESSING them does something: never while the engine is driving.
const idle = computed(() => !state.value.busy)
const showClaim = computed(() => state.value.showClaim)
const showFinish = computed(() => state.value.showFinish)

/** Soft notes only (e.g. the 30-min "still confirming"): ANY attention's note renders in the
 *  rail's failed phase - a parallel line here would double it. A blocked record is the exception:
 *  its reason is persisted, so it is stated here even before any run narrates it. */
const note = computed(() => blocked.value ?? (attention.value ? null : rt.value.note))

const txLinks = computed(() => {
	const links: { label: string; href: string }[] = []
	if (props.record.direction === "deposit") {
		const rec = props.record as DepositJournalRecord
		if (rec.depositTxHash) links.push({ label: "deposit tx ↗", href: etherscanTxUrl(rec.depositTxHash) })
		if (rec.claimTxHash) links.push({ label: "claim tx ↗", href: explorerTxUrl(rec.claimTxHash) })
	} else {
		const rec = props.record as WithdrawJournalRecord
		if (rec.exitTxHash && !rec.exitTxHash.startsWith("wd-pending"))
			links.push({ label: "exit tx ↗", href: explorerTxUrl(rec.exitTxHash) })
		if (rec.consumeTxHash) links.push({ label: "finish tx ↗", href: etherscanTxUrl(rec.consumeTxHash) })
	}
	return links.filter((l) => l.href !== "")
})

const amountKind = computed(() => (state.value.isFuel ? "fee-juice" : "bridge-token"))
const tokenBlock = computed(() => recordTokenBlock(props.record))
const amountDisplay = computed(() => formatStoredAmount(props.record.amount, assetDecimals(amountKind.value, tokenBlock.value)))
// The symbol is the record's own persisted text (a restore file can carry anything): same guard as the token list.
const amountSymbol = computed(() => safeDisplay(assetSymbol(amountKind.value, props.record.isPrivate, tokenBlock.value)))

const now = useNow()
const age = computed(() => ageWords(props.record.createdAt, now.value))

function onAction() {
	if (props.record.direction === "deposit") void journal.runDepositClaim(props.record.id)
	else void journal.runWithdrawConsume(props.record.id)
}

function onDiscard() {
	if (!discardArmed.value) {
		discardArmed.value = true
		return
	}
	journal.discard(props.record.id)
}
</script>

<template>
	<article
		class="journal-card"
		:data-testid="TESTIDS.journalCard"
		:data-id="record.id"
		:data-direction="record.direction"
		:data-stage="stage"
		:data-privacy="record.isPrivate ? 'private' : 'public'"
		:data-attention="attention"
	>
		<p v-if="stage === 'done'" class="stamp">{{ record.direction === "deposit" ? "BRIDGED ✓" : "RELEASED ✓" }}</p>
		<header class="row">
			<span class="meta">
				<span class="dir">{{ record.direction === "deposit" ? "ETHEREUM → AZTEC" : "AZTEC → ETHEREUM" }}</span>
				<span class="amt">{{ amountDisplay }} {{ amountSymbol }}<span v-if="fuelAmount && !isFuel" class="amt-fuel">{{ fuelAmount }}</span></span>
				<span class="tag" :class="{ private: record.isPrivate }">{{ record.isPrivate ? "PRIVATE" : "PUBLIC" }}</span>
				<span
					v-if="acct"
					class="acct"
					:class="{ other: !acct.active }"
					:title="safeAddressText(acct.addr)"
					:data-testid="TESTIDS.journalAccount"
				>{{ acct.alias ?? shortAddr(acct.addr) }}<span v-if="acct.alias" class="acct-addr">{{ shortAddr(acct.addr) }}</span></span>
			</span>
			<span class="trail">
				<span class="age">{{ age }}</span>
			<button
				v-if="stage === 'done'"
				type="button"
				class="corner"
				aria-label="Clear"
				:data-testid="TESTIDS.journalClear"
				@click="journal.clearDone(record.id)"
			>
				✕
			</button>
			<button
				v-else-if="exportable"
				type="button"
				class="corner"
				aria-label="Download recovery file"
				title="Download this bridge's recovery file - restores it on any browser with your Ethereum wallet."
				:data-testid="TESTIDS.cardBackup"
				@click="emit('backup', record)"
			>
				⤓
			</button>
			</span>
		</header>
		<div v-if="fuelRecoverable" class="fuel-recover">
			<button
				v-if="offerSwitch"
				type="button"
				class="action switch"
				:disabled="opsBusy"
				:title="opsBusy ? 'Finish the current operation to switch.' : `This gas belongs to ${acct?.addr}.`"
				:data-testid="TESTIDS.journalSwitchAccount"
				@click="onSwitchAccount"
			>
				{{ switchLabel }}
			</button>
			<button
				v-else
				type="button"
				class="action"
				:disabled="fuelRecovering"
				:data-testid="TESTIDS.journalClaimGas"
				title="Your tokens arrived but the gas is still unclaimed - this claims it, paying its own claim out of the gas that lands."
				@click="onClaimGas"
			>
				{{ fuelRecovering ? "CLAIMING GAS…" : "CLAIM YOUR GAS" }}
			</button>
			<span v-if="fuelRecoverError" class="fuel-recover-err">{{ fuelRecoverError }}</span>
		</div>

		<p v-if="privateFuelUnknown" class="private-fuel-unknown" :data-testid="TESTIDS.journalPrivateFuelUnknown">
			This private bridge's gas data is incomplete, so its gas state can't be confirmed. Your tokens
			arrived. Public gas recovery doesn't apply to private bridges.
		</p>

		<BridgePhaseRail v-if="stage !== 'done'" :record="record" compact />

		<p v-if="stageLabel" class="stage" :data-testid="TESTIDS.journalStage">{{ stageLabel }}</p>

		<p v-if="note" class="attention" :data-testid="TESTIDS.journalAttention">{{ note }}</p>

		<div v-if="txLinks.length" class="links">
			<a
				v-for="link in txLinks"
				:key="link.href"
				:href="link.href"
				target="_blank"
				rel="noopener noreferrer"
				:data-testid="TESTIDS.journalTxLink"
			>{{ link.label }}</a>
		</div>

		<div class="actions">
			<button
				v-if="showClaim && offerSwitch"
				type="button"
				class="action switch"
				:disabled="opsBusy"
				:title="opsBusy ? 'Finish the current operation to switch.' : `This deposit claims to ${acct?.addr}.`"
				:data-testid="TESTIDS.journalSwitchAccount"
				@click="onSwitchAccount"
			>
				{{ switchLabel }}
			</button>
			<button
				v-if="showClaim && !offerSwitch"
				type="button"
				class="action"
				:data-testid="TESTIDS.journalClaim"
				@click="onAction"
			>
				{{ attention === "unknown-outcome" || attention === "error" ? "RETRY" : "CLAIM" }}
			</button>
			<button
				v-if="showFinish"
				type="button"
				class="action"
				:data-testid="TESTIDS.journalFinish"
				@click="onAction"
			>
				{{ attention === "unknown-outcome" || attention === "error" ? "RETRY" : "FINISH" }}
			</button>
			<button
				v-if="showClaimWithoutFuel && !offerSwitch"
				type="button"
				class="action"
				:data-testid="TESTIDS.journalClaimWithoutFuel"
				title="Claims your tokens with the gas you already hold on Aztec instead. The fuel stays claimable later - nothing is abandoned."
				@click="onClaimWithoutFuel"
			>
				CLAIM WITHOUT FUEL
			</button>
			<button
				v-if="idle && stage !== 'done'"
				type="button"
				class="action danger"
				:data-testid="discardArmed ? TESTIDS.journalDiscardConfirm : TESTIDS.journalDiscard"
				@click="onDiscard"
			>
				{{ discardArmed ? "CONFIRM DISCARD" : "DISCARD" }}
			</button>
		</div>

		<p v-if="discardArmed && stage !== 'done' && record.isPrivate && record.direction === 'deposit'" class="discard-warning">
			Discarding destroys the only copy of this claim's sealed recovery secret - the deposited funds become
			unclaimable{{ IS_MAINNET ? " - these are REAL funds" : "" }}.
		</p>
	</article>
</template>

<style scoped>
.journal-card {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 16px;
	border: 1px solid var(--nulo-outline);
}

.corner {
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font: 600 13px/1 var(--font-mono);
	cursor: pointer;
	padding: 2px 4px;
}

.corner:hover {
	color: var(--txt-primary);
}

.journal-card[data-attention] {
	border-style: dashed;
}

.row {
	display: flex;
	align-items: baseline;
	gap: 10px;
}

/* Only the metadata wraps. Age + the corner control travel as one trailing group pinned right, so a
   header that spills to a second line can't strand the download icon there alone. */
.meta {
	display: flex;
	align-items: baseline;
	gap: 10px;
	flex-wrap: wrap;
	min-width: 0;
	flex: 1;
}

.trail {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-left: auto;
	flex: none;
}

.dir {
	font: 700 13px/1 var(--font-mono);
	color: var(--txt-primary);
	letter-spacing: 0.04em;
}

.amt {
	font: 600 13px/1 var(--font-mono);
	color: var(--txt-primary);
}

.amt-fuel {
	margin-left: 6px;
	color: var(--txt-secondary);
	font-weight: 500;
}

.tag {
	font: 600 10px/1 var(--font-mono);
	color: var(--txt-secondary);
	border: 1px solid var(--nulo-outline);
	padding: 3px 6px;
	letter-spacing: 0.08em;
}

.tag.private {
	color: var(--txt-primary);
	border-color: transparent;
	background: color-mix(in srgb, var(--txt-primary) 10%, transparent);
}

.acct {
	font: 600 10px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--txt-secondary);
	border: 1px solid var(--nulo-border);
	padding: 3px 6px;
	max-width: 24ch;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.acct-addr {
	margin-left: 6px;
	font-weight: 500;
	opacity: 0.8;
}

.acct.other {
	color: var(--sand);
	border-color: var(--sand);
}

.action.switch {
	color: var(--sand);
	border-color: var(--sand);
}

.age {
	font: 500 11px/1 var(--font-mono);
	color: var(--txt-secondary);
}

.private-fuel-unknown {
	margin: 0;
	color: var(--yellow);
	font: 500 11.5px/1.5 var(--font-mono);
}

.stage {
	margin: 0;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.step {
	margin: 0;
	color: var(--txt-primary);
	font: 600 12px/1.5 var(--font-mono);
}

.links {
	display: flex;
	gap: 12px;
}

.links a {
	color: var(--txt-secondary);
	font: 500 11px/1 var(--font-mono);
	text-decoration: underline;
	text-underline-offset: 2px;
}

.links a:hover {
	color: var(--txt-primary);
}

.attention {
	margin: 0;
	padding: 8px 10px;
	border-left: 2px solid var(--yellow);
	background: color-mix(in srgb, var(--yellow) 8%, transparent);
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.actions {
	display: flex;
	gap: 8px;
}

.action {
	padding: 8px 14px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.05em;
	cursor: pointer;
	transition: border-color 0.15s ease, color 0.15s ease;
}

.action:hover:not(:disabled) {
	border-color: var(--txt-primary);
	color: var(--txt-primary);
}

.action.danger:hover:not(:disabled) {
	border-color: var(--red);
	color: var(--red);
}

.action.subtle {
	color: var(--txt-secondary);
}

.action:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.discard-warning {
	margin: 0;
	color: var(--red);
	font: 500 12px/1.5 var(--font-mono);
}

.stamp {
	margin: 0 0 6px;
	font: 700 20px/1 var(--font-mono);
	letter-spacing: 0.12em;
	color: var(--mint);
	animation: stamp-in 0.25s ease-out;
}

.journal-card[data-stage="done"] {
	border-color: var(--mint);
	animation: flash 0.3s ease-out;
}

@keyframes stamp-in {
	0% {
		transform: scale(1.8);
		opacity: 0;
	}
	60% {
		transform: scale(0.94);
		opacity: 1;
	}
	100% {
		transform: scale(1);
		opacity: 1;
	}
}

@keyframes flash {
	0% {
		background: var(--mint);
	}
	100% {
		background: transparent;
	}
}
</style>
