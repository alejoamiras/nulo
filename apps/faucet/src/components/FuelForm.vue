<script setup lang="ts">
/** Services */
import { assetKindOf, type DepositJournalRecord } from "@nulo/bridge-core"
import { Button } from "@nulo/design"
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { FUEL_MIN_FJ } from "@/contracts/bridge-deployments"
import { NETWORK } from "@/lib/network"

/** Components */
import BridgeReceipt, { type ReceiptSnapshot } from "./BridgeReceipt.vue"
import BridgeStepper from "./BridgeStepper.vue"
import FeeJuiceNotice from "./FeeJuiceNotice.vue"

/** Composables */
import { useBridgeBackup } from "@/composables/useBridgeBackup"
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { useFuelFlow } from "@/composables/useFuel"
import { FUEL_ASSET_DECIMALS, useL1FeeAsset } from "@/composables/useL1FeeAsset"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { useSettledError } from "@/composables/useSettledError"

/** Utils */
import { formatBigInt, parseAmount } from "@/lib/format"
import { TESTIDS } from "@/lib/testids"

/** Emitted when a fuel bridge completes so the parent view can surface "Your fuels" (scroll the list in). */
const emit = defineEmits<{ completed: [] }>()

const l1 = useL1Wallet()
const feeAsset = useL1FeeAsset()
const bridge = useBridgeWallet()
const journal = useBridgeJournal()
const backup = useBridgeBackup()
const fuelFlow = useFuelFlow()

const isPrivate = ref(true)
// Default above the ~16 FJ floor (the claim's max_gas_cost) so mint→fuel doesn't dead-end on a too-small amount.
const amount = ref("20")
const submitting = ref(false)
// The takeover machine: the form swaps to the stepper on its OWN submit. activeFlowId is the single
// global owner; this form only ever steppers a fee-juice record it started (so it never collides with
// the Bridge tab's form over the shared activeFlowId).
const formStage = ref<"form" | "stepper" | "receipt">("form")
const receiptSnapshot = ref<ReceiptSnapshot | null>(null)
const activeId = journal.activeFlowId
// The id of the record THIS form started (mirror of BridgeForm's ownedId): the completion/receipt
// path keys off it, not the shared foreground, so the other permanently-mounted form re-pointing
// activeFlowId in the same flush as a completion can never swallow the receipt.
const ownedId = ref<string | null>(null)

const bothConnected = computed(() => l1.isConnected.value && bridge.status.value === "connected")
const activeRecord = computed(() => (activeId.value ? journal.records.value.find((r) => r.id === activeId.value) : undefined))
const ownedRecord = computed(() => (ownedId.value ? journal.records.value.find((r) => r.id === ownedId.value) : undefined))
const fuelActive = computed(() => formStage.value === "stepper" && !!ownedRecord.value && assetKindOf(ownedRecord.value) === "fee-juice")

const amountUnits = computed(() => parseAmount(amount.value || "0", FUEL_ASSET_DECIMALS))
const validationError = computed(() => {
	if (!amount.value || amountUnits.value === 0n) return null
	if (feeAsset.balance.value !== null && amountUnits.value > feeAsset.balance.value)
		return `Amount exceeds your ${NETWORK.viemChain.name} fee-asset balance.`
	if (FUEL_MIN_FJ !== undefined && amountUnits.value < FUEL_MIN_FJ) {
		return `Minimum is ${formatBigInt(FUEL_MIN_FJ, FUEL_ASSET_DECIMALS)}. The gas must cover its own claim.`
	}
	return null
})
// Display-debounced: no minimum-error flash while typing "15" en route to "150"; blur/submit settle instantly.
const settledAmount = useSettledError(amount, validationError)
const amountError = settledAmount.shown
const flowError = computed(() => fuelFlow.error.value)

async function onSubmit() {
	settledAmount.settleNow()
	if (amountUnits.value === 0n || validationError.value || formStage.value !== "form" || submitting.value) return
	submitting.value = true
	const onRecord = (id: string) => {
		ownedId.value = id
		journal.claimForeground(id)
		formStage.value = "stepper"
		submitting.value = false
	}
	await fuelFlow.deposit(amountUnits.value, isPrivate.value, { onRecord })
	submitting.value = false
	void feeAsset.refresh()
}

function onBackground() {
	if (ownedId.value) journal.releaseForeground(ownedId.value)
	ownedId.value = null
	fuelFlow.error.value = null
	formStage.value = "form"
}

// Fail-open guard on the OWNED record (mirror of BridgeForm's, minus rekey re-adoption - fuel
// records never rekey). VANISHED (the rejection path discards a pre-deposit record; cross-tab
// discard): release the dead id + reset. USURPED while NOT completed (the other permanently-mounted
// form took the foreground): stand down WITHOUT releasing the other form's live takeover. A
// COMPLETED own record is not broken - the completion watcher receipts it regardless of order.
watch(
	() => {
		if (formStage.value !== "stepper") return false
		const rec = ownedRecord.value
		if (rec === undefined) return true
		return activeId.value !== ownedId.value && !rec.completedAt
	},
	(broken) => {
		if (!broken) return
		if (ownedRecord.value === undefined && ownedId.value) journal.releaseForeground(ownedId.value)
		ownedId.value = null
		formStage.value = "form"
	},
)

function onNewFuel() {
	// The completed record already lives in "Your fuels" (foreground released at completion) - just
	// clear the receipt and reset the form.
	receiptSnapshot.value = null
	fuelFlow.error.value = null
	formStage.value = "form"
	void feeAsset.refresh()
}

// stepper → receipt on the fuel record's completion (mirrors BridgeForm S11): snapshot the FJ result so a
// cross-tab discard / auto-hide can't blank the receipt. Only our own fee-juice record ever steppers here.
watch(
	() => ownedRecord.value?.completedAt,
	(done) => {
		if (!done || formStage.value !== "stepper") return
		const rec = ownedRecord.value
		if (!rec || assetKindOf(rec) !== "fee-juice") return
		receiptSnapshot.value = {
			direction: "deposit",
			assetKind: "fee-juice",
			amount: rec.amount,
			isPrivate: rec.isPrivate,
			l1TxHash: (rec as DepositJournalRecord).depositTxHash,
			l2TxHash: (rec as DepositJournalRecord).claimTxHash,
			startedAt: rec.createdAt,
			completedAt: rec.completedAt,
		}
		formStage.value = "receipt"
		// Release the takeover so the finished record surfaces in "Your fuels" (the receipt renders from
		// the snapshot, so it survives the release), then nudge the parent to scroll the list into view.
		journal.releaseForeground(rec.id)
		emit("completed")
	},
)

const onBackup = backup.exportBridgeWithToast

onBeforeUnmount(settledAmount.dispose)

function fmt(b: bigint | null): string {
	return b === null ? "-" : formatBigInt(b, FUEL_ASSET_DECIMALS)
}
</script>

<template>
	<section class="fuel-form" :data-testid="TESTIDS.fuelForm" :data-stage="formStage">
		<BridgeStepper v-if="fuelActive && ownedRecord" :record="ownedRecord" @background="onBackground" @backup="onBackup" />
		<BridgeReceipt
			v-else-if="formStage === 'receipt' && receiptSnapshot"
			:snapshot="receiptSnapshot"
			cta-label="NEW FUEL"
			@new-bridge="onNewFuel"
		/>
		<template v-else>
			<div class="panel">
				<span class="role">FROM</span>
				<span class="chip">ETHEREUM · SEPOLIA</span>
				<span class="balance" :data-testid="TESTIDS.fuelBalanceL1">Balance: {{ fmt(feeAsset.balance.value) }} $AZTEC</span>
			</div>

			<Flex align="center" gap="8">
				<input
					v-model="amount"
					class="amount"
					type="number"
					aria-label="Amount in fee asset"
					min="0"
					step="1"
					:disabled="submitting"
					:data-testid="TESTIDS.fuelAmount"
					:data-invalid="!!amountError"
					@blur="settledAmount.settleNow"
				/>
				<span class="unit">$AZTEC</span>
			</Flex>
			<p v-if="amountError" class="err-msg" :data-testid="TESTIDS.fuelFormError">{{ amountError }}</p>

			<div class="flabel">How it arrives</div>
			<div class="modes">
				<button type="button" class="mode" :class="{ sel: isPrivate }" :disabled="submitting" :data-testid="TESTIDS.fuelPresetPrivate" :aria-pressed="isPrivate" @click="isPrivate = true">
					<span class="mt">PRIVATE <span class="badge2">default</span></span>
					<span class="md">Your gas lands as Private Fee Juice, hidden from everyone.</span>
				</button>
				<button type="button" class="mode" :class="{ sel: !isPrivate }" :disabled="submitting" :data-testid="TESTIDS.fuelPresetPublic" :aria-pressed="!isPrivate" @click="isPrivate = false">
					<span class="mt">PUBLIC</span>
					<span class="md">Gas arrives in your public Fee Juice balance, visible on Aztec.</span>
				</button>
			</div>

			<FeeJuiceNotice />

			<Button :loading="submitting" :disabled="!bothConnected || submitting" :data-testid="TESTIDS.fuelSubmit" @click="onSubmit">
				{{ !bothConnected ? "CONNECT BOTH WALLETS" : isPrivate ? "GET PRIVATE GAS" : "GET GAS" }}
			</Button>

			<p v-if="flowError" class="err-msg" :data-testid="TESTIDS.fuelFlowError">{{ flowError }}</p>
		</template>
	</section>
</template>

<style scoped>
.fuel-form {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 24px;
	border: 1px solid var(--nulo-outline);
}

.fuel-form h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 18px;
	color: var(--txt-primary);
	margin: 0;
}

.fuel-form .sub {
	color: var(--txt-secondary);
	font-size: 14px;
	margin: 4px 0 0;
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

.flabel {
	font: 600 11px/1 var(--font-mono);
	color: var(--txt-secondary);
	letter-spacing: 0.06em;
	margin-top: 2px;
}

.modes {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
}

.mode {
	display: flex;
	flex-direction: column;
	gap: 5px;
	padding: 11px 12px;
	text-align: left;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	cursor: pointer;
	transition: border-color 0.15s ease;
}

.mode.sel {
	border-color: var(--nulo-accent);
}

.mode:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.mode .mt {
	display: flex;
	align-items: center;
	gap: 6px;
	font: 600 13px/1 var(--font-mono);
	letter-spacing: 0.06em;
}

.mode .md {
	font: 500 11px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}

.badge2 {
	font: 600 9px/1 var(--font-mono);
	letter-spacing: 0.08em;
	color: var(--nulo-accent);
	border: 1px solid var(--nulo-accent);
	padding: 2px 4px;
	text-transform: uppercase;
}

.err-msg {
	margin: 0;
	color: var(--red);
	font: 500 13px/1.4 var(--font-mono);
}
</style>
