<script setup lang="ts">
/** Services */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { isSealTrusted } from "@nulo/bridge-core"
import { AppButton } from "@nulo/design"
import { sepolia } from "viem/chains"
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue"
import { BRIDGE_TOKEN } from "@/contracts/bridge-deployments"

/** Components */
import BridgeReceipt, { type ReceiptSnapshot } from "./BridgeReceipt.vue"
import BridgeStepper from "./BridgeStepper.vue"

/** Composables */
import { useBridgeBackup } from "@/composables/useBridgeBackup"
import { hideCompleted, useBridgeJournal } from "@/composables/useBridgeJournal"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { providerFingerprint, useDepositFlow } from "@/composables/useDeposit"
import { useL1Usdc } from "@/composables/useL1Usdc"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { type UseTokenBalanceHandle, useTokenBalance } from "@/composables/useTokenBalance"
import { useToast } from "@/composables/useToast"
import { useWithdrawFlow } from "@/composables/useWithdraw"

/** Utils */
import type { DepositJournalRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import { TESTIDS } from "@/lib/testids"

const l1 = useL1Wallet()
const bridge = useBridgeWallet()
const usdc = useL1Usdc()
const journal = useBridgeJournal()
const backup = useBridgeBackup()
const { push: pushToast } = useToast()
const depositFlow = useDepositFlow()
const withdrawFlow = useWithdrawFlow()

const direction = ref<"l1-to-l2" | "l2-to-l1">("l1-to-l2")
const isPrivate = ref(false)
const amount = ref("100")

const bothConnected = computed(() => l1.isConnected.value && bridge.status.value === "connected")

// The takeover machine (plan S2/S7): ALL form gating keys off formStage - never the flows' busy,
// which spans the whole bridge and would make RUN IN BACKGROUND a no-op.
const formStage = ref<"form" | "stepper" | "receipt">("form")
// The ENGINE's foreground ref is the single owner (plan S13) - the form must not keep its own
// copy, or the withdraw provisional→exit rekey (which transfers ownership engine-side) would
// orphan the form's stale id and hide a live record from BOTH surfaces.
const activeId = journal.activeFlowId
const receiptSnapshot = ref<ReceiptSnapshot | null>(null)
// Double-click guard for the submit→onRecord window only (cleared the moment the record exists).
const submitting = ref(false)

const activeRecord = computed(() => (activeId.value ? journal.records.value.find((r) => r.id === activeId.value) : undefined))

// The L2 balance reader lives only while the Aztec wallet is connected; this component owns its
// lifecycle (create on connect, dispose on change/unmount).
// shallowRef: the handle holds its own Refs - deep unwrapping would strip their .value typing.
const l2Handle = shallowRef<UseTokenBalanceHandle | null>(null)
watch(
	() => [bridge.status.value, bridge.selectedAccount.value] as const,
	([status, account]) => {
		l2Handle.value?.dispose()
		l2Handle.value =
			status === "connected" && account && bridge.wallet.value
				? useTokenBalance(bridge.wallet.value, BRIDGE_TOKEN, AztecAddress.fromString(account))
				: null
	},
	{ immediate: true },
)
onBeforeUnmount(() => l2Handle.value?.dispose())

const l2Public = computed(() => l2Handle.value?.publicBalance.value ?? null)
const l2Private = computed(() => l2Handle.value?.privateBalance.value ?? null)
/** The balance the bridge actually moves - selected by the privacy toggle. */
const l2Balance = computed(() => (isPrivate.value ? l2Private.value : l2Public.value))

const fromChain = computed(() => (direction.value === "l1-to-l2" ? "ethereum" : "aztec"))
const toChain = computed(() => (direction.value === "l1-to-l2" ? "aztec" : "ethereum"))
const fromBalance = computed(() => (fromChain.value === "ethereum" ? usdc.balance.value : l2Balance.value))

const amountUnits = computed(() => {
	const n = Number(amount.value || "0")
	if (!Number.isFinite(n) || n <= 0) return 0n
	return BigInt(Math.round(n * 1e6))
})

// Validation surfaces only after the user has engaged with the amount (or tried to submit) -
// a freshly connected wallet must never open on an error it didn't cause.
const amountTouched = ref(false)
const validationError = computed(() => {
	if (!amount.value || amountUnits.value === 0n) return null
	if (fromBalance.value !== null && amountUnits.value > fromBalance.value) {
		return fromChain.value === "ethereum"
			? "Amount exceeds your Sepolia USDC balance."
			: `Amount exceeds your Aztec ${isPrivate.value ? "private" : "public"} balance.`
	}
	return null
})
const amountError = computed(() => (amountTouched.value ? validationError.value : null))
const flowError = computed(() => depositFlow.error.value ?? withdrawFlow.error.value)

const showMintHint = computed(() => fromChain.value === "ethereum" && usdc.balance.value === 0n)

const isFirstSeal = computed(() => {
	const addr = l1.address.value
	if (!addr) return true
	// Recompute when the journal changes: the first private bridge marks trust mid-session, and
	// the note must stop promising "two signatures" for the second one.
	void journal.records.value.length
	return !isSealTrusted(localStorage, sepolia.id, addr, providerFingerprint())
})

// A failing balance reader must be VISIBLE, not an eternal "-": surface a hint + the real cause
// in the console (ids/messages only - the reader never sees secrets).
const l2BalanceError = computed(() => l2Handle.value?.error.value ?? null)
watch(l2BalanceError, (msg) => {
	if (msg) console.warn("[bridge:balances] L2 balance read failed:", msg)
})

function flip() {
	direction.value = direction.value === "l1-to-l2" ? "l2-to-l1" : "l1-to-l2"
}

async function onSubmit() {
	amountTouched.value = true
	if (amountUnits.value === 0n || validationError.value || formStage.value !== "form" || submitting.value) return
	submitting.value = true
	const onRecord = (id: string) => {
		journal.claimForeground(id)
		formStage.value = "stepper"
		submitting.value = false
	}
	const flow = direction.value === "l1-to-l2" ? depositFlow.deposit : withdrawFlow.withdraw
	await flow(amountUnits.value, isPrivate.value, { onRecord })
	submitting.value = false
	// A clean rejection discarded the record (the cleanup matrix): release + back to the form,
	// the flow's error renders inline. Anything else (still running / failed-but-kept / completed)
	// keeps the stepper or already moved to the receipt. (Read through a local: TS keeps the
	// pre-await narrowing on `.value` otherwise.)
	const stageNow: string = formStage.value
	if (stageNow === "stepper" && activeId.value && !journal.records.value.some((r) => r.id === activeId.value)) {
		journal.releaseForeground(activeId.value)
		formStage.value = "form"
	}
	void usdc.refresh()
	void l2Handle.value?.refresh()
}

// The stepper→receipt transition keys off the RECORD's completion (never the flow promise - the
// engine detaches receipt rounds), snapshotting everything the receipt shows (plan S11).
watch(
	() => activeRecord.value?.completedAt,
	(done) => {
		if (!done || formStage.value !== "stepper") return
		const rec = activeRecord.value
		if (!rec) return
		receiptSnapshot.value =
			rec.direction === "deposit"
				? {
						direction: "deposit",
						amount: rec.amount,
						isPrivate: rec.isPrivate,
						l1TxHash: (rec as DepositJournalRecord).depositTxHash,
						l2TxHash: (rec as DepositJournalRecord).claimTxHash,
						startedAt: rec.createdAt,
						completedAt: rec.completedAt,
					}
				: {
						direction: "withdraw",
						amount: rec.amount,
						isPrivate: rec.isPrivate,
						l1TxHash: (rec as WithdrawJournalRecord).consumeTxHash,
						l2TxHash: (rec as WithdrawJournalRecord).exitTxHash,
						startedAt: rec.createdAt,
						completedAt: rec.completedAt,
					}
		formStage.value = "receipt"
	},
)

// Fail-open guard: a stepper pointing at a vanished record (cross-tab discard) resets to the form.
watch(
	() => formStage.value === "stepper" && activeId.value !== null && activeRecord.value === undefined,
	(orphaned) => {
		if (!orphaned) return
		if (activeId.value) journal.releaseForeground(activeId.value)
		formStage.value = "form"
	},
)

function clearFlowErrors() {
	depositFlow.error.value = null
	withdrawFlow.error.value = null
}

const onBackup = backup.exportBridgeWithToast

function onBackground() {
	if (activeId.value) journal.releaseForeground(activeId.value)
	clearFlowErrors()
	formStage.value = "form"
}

function onNewBridge() {
	// The receipt WAS the result - hide the completed card instead of re-surfacing it below.
	if (activeId.value) {
		hideCompleted(activeId.value)
		journal.releaseForeground(activeId.value)
	}
	receiptSnapshot.value = null
	clearFlowErrors()
	formStage.value = "form"
	void usdc.refresh()
	void l2Handle.value?.refresh()
}

function fmt(b: bigint | null): string {
	if (b === null) return "-"
	return (Number(b) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })
}
</script>

<template>
	<section class="bridge-form" :data-testid="TESTIDS.bridgeForm" :data-stage="formStage">
		<BridgeStepper
			v-if="formStage === 'stepper' && activeRecord"
			:record="activeRecord"
			@background="onBackground"
			@backup="onBackup"
		/>
		<BridgeReceipt v-else-if="formStage === 'receipt' && receiptSnapshot" :snapshot="receiptSnapshot" @new-bridge="onNewBridge" />
		<template v-else>
		<header>
			<h3>BRIDGE USDC</h3>
			<p class="sub">Move test USDC between Ethereum (Sepolia) and Aztec, 1:1. Bridges you background land in Pending Bridges below.</p>
		</header>

		<div class="panels">
			<div class="panel" :data-testid="TESTIDS.bridgeFrom" :data-chain="fromChain">
				<span class="role">FROM</span>
				<span class="chip">{{ fromChain === "ethereum" ? "ETHEREUM · SEPOLIA" : "AZTEC" }}</span>
				<template v-if="fromChain === 'ethereum'">
					<span class="balance" :data-testid="TESTIDS.bridgeBalanceL1">Balance: {{ fmt(usdc.balance.value) }} USDC</span>
				</template>
				<template v-else>
					<span
						class="balance"
						:class="{ active: !isPrivate, dim: isPrivate }"
						:data-testid="TESTIDS.bridgeBalanceL2Public"
						:data-active="!isPrivate"
					>Public: {{ fmt(l2Public) }} USDC</span>
					<span
						class="balance"
						:class="{ active: isPrivate, dim: !isPrivate }"
						:data-testid="TESTIDS.bridgeBalanceL2Private"
						:data-active="isPrivate"
					>Private: {{ fmt(l2Private) }} USDC</span>
					<span v-if="l2BalanceError && l2Public === null" class="balance-warn">balances unavailable - retrying</span>
				</template>
			</div>

			<button class="flip" type="button" aria-label="Flip direction" :disabled="submitting" :data-testid="TESTIDS.bridgeFlip" @click="flip">
				⇅
			</button>

			<div class="panel" :data-testid="TESTIDS.bridgeTo" :data-chain="toChain">
				<span class="role">TO</span>
				<span class="chip">{{ toChain === "ethereum" ? "ETHEREUM · SEPOLIA" : "AZTEC" }}</span>
				<template v-if="toChain === 'ethereum'">
					<span class="balance" :data-testid="TESTIDS.bridgeBalanceL1">Balance: {{ fmt(usdc.balance.value) }} USDC</span>
				</template>
				<template v-else>
					<span
						class="balance"
						:class="{ active: !isPrivate, dim: isPrivate }"
						:data-testid="TESTIDS.bridgeBalanceL2Public"
						:data-active="!isPrivate"
					>Public: {{ fmt(l2Public) }} USDC</span>
					<span
						class="balance"
						:class="{ active: isPrivate, dim: !isPrivate }"
						:data-testid="TESTIDS.bridgeBalanceL2Private"
						:data-active="isPrivate"
					>Private: {{ fmt(l2Private) }} USDC</span>
				</template>
			</div>
		</div>

		<div class="amount-row">
			<input
				v-model="amount"
				class="amount"
				type="number"
				aria-label="Amount in USDC"
				min="0"
				step="1"
				:disabled="submitting"
				:data-testid="TESTIDS.bridgeAmount"
				:data-invalid="!!amountError"
				@input="amountTouched = true"
			/>
			<span class="unit">USDC</span>
		</div>
		<p v-if="amountError" class="err-msg" :data-testid="TESTIDS.bridgeFormError">{{ amountError }}</p>
		<p v-if="showMintHint" class="hint">No test USDC on Sepolia yet - mint some below.</p>

		<div class="privacy-row">
			<button
				type="button"
				class="toggle"
				:class="{ on: isPrivate }"
				:disabled="submitting"
				:data-testid="TESTIDS.bridgePrivacyToggle"
				:aria-pressed="isPrivate"
				@click="isPrivate = !isPrivate"
			>
				<span class="knob" />
			</button>
			<span class="toggle-label">PRIVATE BRIDGING</span>
		</div>
		<p v-if="isPrivate" class="privacy-note" :data-testid="TESTIDS.bridgePrivacyNote" :data-first="isFirstSeal ? 'true' : 'false'">
			<template v-if="direction === 'l1-to-l2'">
				Funds arrive in your PRIVATE Aztec balance.
				{{ isFirstSeal ? "Two quick Ethereum signatures (first time only - afterwards just one)" : "One Ethereum signature" }}
				lock{{ isFirstSeal ? "" : "s" }} this transfer's recovery key to your wallet. It lives only in this
				browser - don't clear site data while a bridge is running.
			</template>
			<template v-else>
				Burns from your PRIVATE Aztec balance. The Ethereum recipient is locked into the bridge message -
				nothing extra to back up.
			</template>
		</p>

		<AppButton :loading="submitting" :disabled="!bothConnected || submitting" :data-testid="TESTIDS.bridgeSubmit" @click="onSubmit">
			{{ !bothConnected ? "CONNECT BOTH WALLETS" : direction === "l1-to-l2" ? "BRIDGE TO AZTEC" : "BRIDGE TO ETHEREUM" }}
		</AppButton>

		<p v-if="flowError" class="err-msg" :data-testid="TESTIDS.bridgeFlowError">{{ flowError }}</p>
		</template>
	</section>
</template>

<style scoped>
.bridge-form {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 24px;
	border: 1px solid var(--nulo-outline);
}

.bridge-form h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 18px;
	color: var(--txt-primary);
	margin: 0;
}

.bridge-form .sub {
	color: var(--txt-secondary);
	font-size: 14px;
	margin: 4px 0 0;
}

.panels {
	display: grid;
	grid-template-columns: 1fr auto 1fr;
	gap: 8px;
	align-items: stretch;
}

.panel {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 14px;
	border: 1px solid var(--nulo-outline);
}

.panel .role {
	font: 600 11px/1 var(--font-mono);
	color: var(--txt-secondary);
	letter-spacing: 0.08em;
}

.panel .chip {
	font: 600 13px/1.2 var(--font-mono);
	color: var(--txt-primary);
}

.panel .balance {
	font: 500 12px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}

.panel .balance.active {
	color: var(--txt-primary);
	font-weight: 600;
}

.panel .balance.dim {
	opacity: 0.55;
}

.flip {
	align-self: center;
	width: 36px;
	height: 36px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font-size: 16px;
	cursor: pointer;
	transition: border-color 0.15s ease, color 0.15s ease;
}

.flip:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.flip:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.amount-row {
	display: flex;
	align-items: center;
	gap: 8px;
}

.amount {
	flex: 1;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	padding: 12px 14px;
	color: var(--txt-primary);
	font: 500 16px/1 var(--font-mono);
}

.unit {
	color: var(--txt-secondary);
	font: 600 13px/1 var(--font-mono);
}

.hint {
	margin: 0;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.privacy-row {
	display: flex;
	align-items: center;
	gap: 10px;
}

.toggle {
	position: relative;
	width: 40px;
	height: 22px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	cursor: pointer;
	transition: border-color 0.15s ease;
}

.toggle .knob {
	position: absolute;
	top: 2px;
	left: 2px;
	width: 16px;
	height: 16px;
	background: var(--txt-secondary);
	transition: transform 0.15s ease, background 0.15s ease;
}

.toggle.on {
	border-color: var(--nulo-accent);
}

.toggle.on .knob {
	transform: translateX(18px);
	background: var(--nulo-accent);
}

.toggle:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.toggle-label {
	font: 600 12px/1 var(--font-mono);
	color: var(--txt-primary);
	letter-spacing: 0.06em;
}

.privacy-note {
	margin: 0;
	padding: 10px 12px;
	border: 1px dashed var(--yellow);
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.seal-note {
	margin: 0;
	padding: 10px 12px;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.err-msg {
	margin: 0;
	color: var(--red);
	font: 500 13px/1.4 var(--font-mono);
}
</style>
