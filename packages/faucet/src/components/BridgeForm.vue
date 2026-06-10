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
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { providerFingerprint, useDepositFlow } from "@/composables/useDeposit"
import { useL1Usdc } from "@/composables/useL1Usdc"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { type UseTokenBalanceHandle, useTokenBalance } from "@/composables/useTokenBalance"
import { useWithdrawFlow } from "@/composables/useWithdraw"

/** Utils */
import type { DepositJournalRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import { TESTIDS } from "@/lib/testids"

const l1 = useL1Wallet()
const bridge = useBridgeWallet()
const usdc = useL1Usdc()
const journal = useBridgeJournal()
const depositFlow = useDepositFlow()
const withdrawFlow = useWithdrawFlow()

const direction = ref<"l1-to-l2" | "l2-to-l1">("l1-to-l2")
const isPrivate = ref(false)
const amount = ref("100")

const bothConnected = computed(() => l1.isConnected.value && bridge.status.value === "connected")

// The takeover machine (plan S2/S7): ALL form gating keys off formStage — never the flows' busy,
// which spans the whole bridge and would make RUN IN BACKGROUND a no-op.
const formStage = ref<"form" | "stepper" | "receipt">("form")
const activeId = ref<string | null>(null)
const receiptSnapshot = ref<ReceiptSnapshot | null>(null)
// Double-click guard for the submit→onRecord window only (cleared the moment the record exists).
const submitting = ref(false)

const activeRecord = computed(() => (activeId.value ? journal.records.value.find((r) => r.id === activeId.value) : undefined))

// The L2 balance reader lives only while the Aztec wallet is connected; this component owns its
// lifecycle (create on connect, dispose on change/unmount).
// shallowRef: the handle holds its own Refs — deep unwrapping would strip their .value typing.
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
/** The balance the bridge actually moves — selected by the privacy toggle. */
const l2Balance = computed(() => (isPrivate.value ? l2Private.value : l2Public.value))

const fromChain = computed(() => (direction.value === "l1-to-l2" ? "ethereum" : "aztec"))
const toChain = computed(() => (direction.value === "l1-to-l2" ? "aztec" : "ethereum"))
const fromBalance = computed(() => (fromChain.value === "ethereum" ? usdc.balance.value : l2Balance.value))

const amountUnits = computed(() => {
	const n = Number(amount.value || "0")
	if (!Number.isFinite(n) || n <= 0) return 0n
	return BigInt(Math.round(n * 1e6))
})

const validationError = computed(() => {
	if (!amount.value || amountUnits.value === 0n) return null
	if (fromBalance.value !== null && amountUnits.value > fromBalance.value) {
		return fromChain.value === "ethereum"
			? "Amount exceeds your Sepolia USDC balance."
			: `Amount exceeds your Aztec ${isPrivate.value ? "private" : "public"} balance.`
	}
	return null
})
const formError = computed(() => validationError.value ?? depositFlow.error.value ?? withdrawFlow.error.value)

const showMintHint = computed(() => fromChain.value === "ethereum" && usdc.balance.value === 0n)

const sealNoteVisible = computed(() => direction.value === "l1-to-l2" && isPrivate.value && l1.isConnected.value)
const isFirstSeal = computed(() => {
	const addr = l1.address.value
	if (!addr) return true
	return !isSealTrusted(localStorage, sepolia.id, addr, providerFingerprint())
})

function flip() {
	direction.value = direction.value === "l1-to-l2" ? "l2-to-l1" : "l1-to-l2"
}

async function onSubmit() {
	if (amountUnits.value === 0n || validationError.value || formStage.value !== "form" || submitting.value) return
	submitting.value = true
	const onRecord = (id: string) => {
		activeId.value = id
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
		activeId.value = null
		formStage.value = "form"
	}
	void usdc.refresh()
	void l2Handle.value?.refresh()
}

// The stepper→receipt transition keys off the RECORD's completion (never the flow promise — the
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
					}
				: {
						direction: "withdraw",
						amount: rec.amount,
						isPrivate: rec.isPrivate,
						l1TxHash: (rec as WithdrawJournalRecord).consumeTxHash,
						l2TxHash: (rec as WithdrawJournalRecord).exitTxHash,
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
		activeId.value = null
		formStage.value = "form"
	},
)

function onBackground() {
	if (activeId.value) journal.releaseForeground(activeId.value)
	activeId.value = null
	formStage.value = "form"
}

function onNewBridge() {
	if (activeId.value) journal.releaseForeground(activeId.value)
	activeId.value = null
	receiptSnapshot.value = null
	formStage.value = "form"
	void usdc.refresh()
	void l2Handle.value?.refresh()
}

function fmt(b: bigint | null): string {
	if (b === null) return "—"
	return (Number(b) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })
}
</script>

<template>
	<section class="bridge-form" :data-testid="TESTIDS.bridgeForm" :data-stage="formStage">
		<BridgeStepper v-if="formStage === 'stepper' && activeRecord" :record="activeRecord" @background="onBackground" />
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
				min="0"
				step="1"
				:disabled="submitting"
				:data-testid="TESTIDS.bridgeAmount"
			/>
			<span class="unit">USDC</span>
		</div>
		<p v-if="showMintHint" class="hint">No test USDC on Sepolia yet — mint some below.</p>

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
		<p v-if="isPrivate" class="privacy-note" :data-testid="TESTIDS.bridgePrivacyNote">
			<template v-if="direction === 'l1-to-l2'">
				Funds arrive in your PRIVATE Aztec balance. The claim secret is a bearer credential — anyone holding
				it can claim these funds. It is sealed to your Ethereum signature and stored only in this browser.
				Don't clear site data mid-flight.
			</template>
			<template v-else>
				Burns from your PRIVATE Aztec balance. The Ethereum recipient is locked into the bridge message —
				no bearer secret involved.
			</template>
		</p>
		<p v-if="sealNoteVisible" class="seal-note" :data-testid="TESTIDS.bridgeSealNote" :data-first="isFirstSeal ? 'true' : 'false'">
			<template v-if="isFirstSeal">
				First private bridge with this Ethereum account: you'll sign the same message twice — once to seal
				this transfer's recovery secret, once to prove your wallet signs deterministically. One-time check;
				after it, private bridges seal with a single signature.
			</template>
			<template v-else>You'll sign once to seal this transfer's recovery secret. No transaction, no cost.</template>
		</p>

		<AppButton :loading="submitting" :disabled="!bothConnected || submitting" :data-testid="TESTIDS.bridgeSubmit" @click="onSubmit">
			{{ !bothConnected ? "CONNECT BOTH WALLETS" : direction === "l1-to-l2" ? "BRIDGE TO AZTEC" : "BRIDGE TO ETHEREUM" }}
		</AppButton>

		<p v-if="formError" class="err-msg" :data-testid="TESTIDS.bridgeFormError">{{ formError }}</p>
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
	border-radius: 12px;
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
	border-radius: 8px;
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
	border-radius: 8px;
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
	border-radius: 8px;
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
	border-radius: 999px;
	cursor: pointer;
	transition: border-color 0.15s ease;
}

.toggle .knob {
	position: absolute;
	top: 2px;
	left: 2px;
	width: 16px;
	height: 16px;
	border-radius: 999px;
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
	border-radius: 8px;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.seal-note {
	margin: 0;
	padding: 10px 12px;
	border: 1px solid var(--nulo-outline);
	border-radius: 8px;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.err-msg {
	margin: 0;
	color: var(--red);
	font: 500 13px/1.4 var(--font-mono);
}
</style>
