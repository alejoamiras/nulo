<script setup lang="ts">
/** Services */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { buildFuelRoute, isSealTrusted, minOutputForSlippage, quoteFuelPath } from "@nulo/bridge-core"
import { Button } from "@nulo/design"
import { sepolia } from "viem/chains"
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue"
import { BRIDGE_FUEL, BRIDGE_TOKEN, BRIDGE_TOKEN_DECIMALS, BRIDGE_TOKEN_SYMBOL, L1_USDC } from "@/contracts/bridge-deployments"

/** Components */
import BridgeReceipt, { type ReceiptSnapshot } from "./BridgeReceipt.vue"
import BridgeStepper from "./BridgeStepper.vue"
import FeeJuiceNotice from "./FeeJuiceNotice.vue"

/** Composables */
import { useBridgeBackup } from "@/composables/useBridgeBackup"
import { hideCompleted, useBridgeJournal } from "@/composables/useBridgeJournal"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { providerFingerprint, readClaimFee, useDepositFlow } from "@/composables/useDeposit"
import { useL1Usdc } from "@/composables/useL1Usdc"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { useSettledError } from "@/composables/useSettledError"
import { type UseTokenBalanceHandle, useTokenBalance } from "@/composables/useTokenBalance"
import { useToast } from "@/composables/useToast"
import { useWithdrawFlow } from "@/composables/useWithdraw"

/** Utils */
import type { DepositJournalRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import { formatBigInt, parseAmount } from "@/lib/format"
import { TESTIDS } from "@/lib/testids"

/** Emitted when a bridge completes so the parent view can surface "Your bridges" (scroll the list in). */
const emit = defineEmits<{ completed: [] }>()

const l1 = useL1Wallet()
const bridge = useBridgeWallet()
const usdc = useL1Usdc()
const journal = useBridgeJournal()
const backup = useBridgeBackup()
const { push: pushToast } = useToast()
const depositFlow = useDepositFlow()
const withdrawFlow = useWithdrawFlow()

const direction = ref<"l1-to-l2" | "l2-to-l1">("l1-to-l2")

/** Fuel (arrive-with-gas): exact-input AZLO slice, quoted to FJ live. Renders only when the
 *  deployment configures fuel and the direction is L1→L2. */
const fuelOn = ref(false)
const fuelSlice = ref("0.25")
const fuelQuote = ref<{ state: "idle" | "loading" | "ok" | "error"; fj?: bigint; min?: bigint; message?: string }>({
	state: "idle",
})
let quoteTimer: ReturnType<typeof setTimeout> | null = null
const isPrivate = ref(true)
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
				? useTokenBalance(bridge.wallet.value, BRIDGE_TOKEN, AztecAddress.fromStringUnsafe(account))
				: null
	},
	{ immediate: true },
)
onBeforeUnmount(() => {
	l2Handle.value?.dispose()
	settledAmount.dispose()
})

const l2Public = computed(() => l2Handle.value?.publicBalance.value ?? null)
const l2Private = computed(() => l2Handle.value?.privateBalance.value ?? null)
/** The balance the bridge actually moves - selected by the privacy toggle. */
const l2Balance = computed(() => (isPrivate.value ? l2Private.value : l2Public.value))

const fromChain = computed(() => (direction.value === "l1-to-l2" ? "ethereum" : "aztec"))
const toChain = computed(() => (direction.value === "l1-to-l2" ? "aztec" : "ethereum"))
const fromBalance = computed(() => (fromChain.value === "ethereum" ? usdc.balance.value : l2Balance.value))

const amountUnits = computed(() => parseAmount(amount.value || "0", BRIDGE_TOKEN_DECIMALS))

// Validation surfaces only after the user has engaged with the amount (or tried to submit) -
// a freshly connected wallet must never open on an error it didn't cause. Display is settle-
// debounced so typing never flashes a transient error mid-entry.
const validationError = computed(() => {
	if (!amount.value || amountUnits.value === 0n) return null
	if (fromBalance.value !== null && amountUnits.value > fromBalance.value) {
		return fromChain.value === "ethereum"
			? `Amount exceeds your Sepolia ${BRIDGE_TOKEN_SYMBOL} balance.`
			: `Amount exceeds your Aztec ${isPrivate.value ? "private" : "public"} balance.`
	}
	return null
})
const settledAmount = useSettledError(amount, validationError)
const amountError = settledAmount.shown

const fuelAvailable = computed(() => BRIDGE_FUEL !== undefined && direction.value === "l1-to-l2")
const fuelSliceUnits = computed(() => parseAmount(fuelSlice.value || "0", BRIDGE_TOKEN_DECIMALS))
/** Oversize fuel slices crater the (deliberately small) pools - the fork rehearsal measured a
 *  2-AZLO fill moving prices ~25%. Cap at 1 AZLO ≈ ~2,000 FJ. */
const MAX_FUEL_SLICE = 10n ** 18n
const fuelError = computed(() => {
	if (!fuelOn.value || !fuelAvailable.value) return null
	if (fuelSliceUnits.value === 0n) return "Enter a fuel slice."
	if (fuelSliceUnits.value >= amountUnits.value) return "The fuel slice must be smaller than the amount."
	if (fuelSliceUnits.value > MAX_FUEL_SLICE) return "Max fuel is 1 AZLO - bigger slices just move the pool price against you."
	if (fuelQuote.value.state === "error") return fuelQuote.value.message ?? "No fuel route available right now."
	return null
})
const fuelBlocksSubmit = computed(() => fuelOn.value && fuelAvailable.value && (fuelError.value !== null || fuelQuote.value.state !== "ok"))

async function refreshFuelQuote() {
	if (!fuelOn.value || !fuelAvailable.value || !BRIDGE_FUEL) return
	if (fuelSliceUnits.value === 0n || fuelSliceUnits.value > MAX_FUEL_SLICE) return
	fuelQuote.value = { state: "loading" }
	try {
		const route = buildFuelRoute({
			token: L1_USDC,
			weth: BRIDGE_FUEL.weth,
			feeJuice: BRIDGE_FUEL.feeJuice,
			tokenWeth: BRIDGE_FUEL.pools.azloWeth,
			ethFj: BRIDGE_FUEL.pools.ethFj,
		})
		const fj = await quoteFuelPath(l1.publicClient as never, BRIDGE_FUEL.quoter, route, fuelSliceUnits.value)
		if (fj < BRIDGE_FUEL.minFuelFj) {
			fuelQuote.value = { state: "error", message: "That slice buys too little gas to cover its own claim - increase it." }
			return
		}
		fuelQuote.value = { state: "ok", fj, min: minOutputForSlippage(fj, BRIDGE_FUEL.slippageBps) }
	} catch (e) {
		fuelQuote.value = {
			state: "error",
			message:
				e instanceof Error && e.name === "QuoteUnavailableError" ? e.message : "Quote failed - bridging without fuel still works.",
		}
	}
}

// No isPrivate→fuel guard: gas follows the token (private fuel ships via the PrivateFPC), so a private
// bridge CAN arrive with private gas. The impossible combo (private tokens + public gas) can't occur —
// fuel privacy is driven solely by isPrivate, never an independent control.
watch([fuelOn, fuelSlice, direction], () => {
	if (quoteTimer) clearTimeout(quoteTimer)
	if (!fuelOn.value || !fuelAvailable.value) return
	fuelQuote.value = { state: "loading" }
	quoteTimer = setTimeout(() => void refreshFuelQuote(), 500)
})
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
	settledAmount.settleNow()
	if (amountUnits.value === 0n || validationError.value || formStage.value !== "form" || submitting.value) return
	if (fuelBlocksSubmit.value) return
	submitting.value = true
	const onRecord = (id: string) => {
		journal.claimForeground(id)
		formStage.value = "stepper"
		submitting.value = false
	}
	if (direction.value === "l1-to-l2") {
		await depositFlow.deposit(amountUnits.value, isPrivate.value, {
			onRecord,
			...(fuelOn.value && fuelAvailable.value ? { fuelSlice: fuelSliceUnits.value } : {}),
		})
	} else {
		await withdrawFlow.withdraw(amountUnits.value, isPrivate.value, { onRecord })
	}
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
						fuelReceived: (rec as DepositJournalRecord).fuel?.received,
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
		// A finished bridge now lives in "Your bridges" below - nudge the parent to scroll it into view so
		// the completion is where the user expects to find it (the receipt stays above, still reachable).
		emit("completed")
		// Fueled deposits: read the claim tx fee (gas used) post-completion + patch the snapshot so the
		// receipt's "gas used / available" ledger fills in. Claim flow untouched; best-effort (a failed
		// read just leaves the used row hidden + available = bought).
		const dep = rec as DepositJournalRecord
		if (dep.direction === "deposit" && dep.fuel?.received && dep.claimTxHash) {
			void readClaimFee(dep.claimTxHash).then((fee) => {
				const snap = receiptSnapshot.value
				if (fee !== undefined && snap && snap.completedAt === rec.completedAt) {
					receiptSnapshot.value = { ...snap, fuelUsed: fee.toString() }
				}
			})
		}
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
	return formatBigInt(b, BRIDGE_TOKEN_DECIMALS)
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
		<div class="panels">
			<div class="panel" :data-testid="TESTIDS.bridgeFrom" :data-chain="fromChain">
				<span class="role">FROM</span>
				<span class="chip">{{ fromChain === "ethereum" ? "ETHEREUM · SEPOLIA" : "AZTEC" }}</span>
				<template v-if="fromChain === 'ethereum'">
					<span class="balance" :data-testid="TESTIDS.bridgeBalanceL1">Balance: {{ fmt(usdc.balance.value) }} {{ BRIDGE_TOKEN_SYMBOL }}</span>
				</template>
				<template v-else>
					<span
						class="balance"
						:class="{ active: !isPrivate, dim: isPrivate }"
						:data-testid="TESTIDS.bridgeBalanceL2Public"
						:data-active="!isPrivate"
					>Public: {{ fmt(l2Public) }} {{ BRIDGE_TOKEN_SYMBOL }}</span>
					<span
						class="balance"
						:class="{ active: isPrivate, dim: !isPrivate }"
						:data-testid="TESTIDS.bridgeBalanceL2Private"
						:data-active="isPrivate"
					>Private: {{ fmt(l2Private) }} {{ BRIDGE_TOKEN_SYMBOL }}</span>
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
					<span class="balance" :data-testid="TESTIDS.bridgeBalanceL1">Balance: {{ fmt(usdc.balance.value) }} {{ BRIDGE_TOKEN_SYMBOL }}</span>
				</template>
				<template v-else>
					<span
						class="balance"
						:class="{ active: !isPrivate, dim: isPrivate }"
						:data-testid="TESTIDS.bridgeBalanceL2Public"
						:data-active="!isPrivate"
					>Public: {{ fmt(l2Public) }} {{ BRIDGE_TOKEN_SYMBOL }}</span>
					<span
						class="balance"
						:class="{ active: isPrivate, dim: !isPrivate }"
						:data-testid="TESTIDS.bridgeBalanceL2Private"
						:data-active="isPrivate"
					>Private: {{ fmt(l2Private) }} {{ BRIDGE_TOKEN_SYMBOL }}</span>
				</template>
			</div>
		</div>

		<Flex align="center" gap="8">
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
				@blur="settledAmount.settleNow"
			/>
			<span class="unit">{{ BRIDGE_TOKEN_SYMBOL }}</span>
		</Flex>
		<p v-if="amountError" class="err-msg" :data-testid="TESTIDS.bridgeFormError">{{ amountError }}</p>
		<p v-if="showMintHint" class="hint">No test {{ BRIDGE_TOKEN_SYMBOL }} on Sepolia yet - mint some below.</p>

		<!-- HOW it arrives: privacy presets (gas-follows-token); PRIVATE is the default. -->
			<div class="flabel">How it arrives</div>
			<div class="modes">
				<button type="button" class="mode" :class="{ sel: isPrivate }" :disabled="submitting" :data-testid="TESTIDS.bridgePresetPrivate" :aria-pressed="isPrivate" @click="isPrivate = true">
					<span class="mt">PRIVATE <span class="badge2">default</span></span>
					<span class="md">Your tokens, and the gas if you add it, land in your private Aztec balance, hidden from everyone.</span>
				</button>
				<button type="button" class="mode" :class="{ sel: !isPrivate }" :disabled="submitting" :data-testid="TESTIDS.bridgePresetPublic" :aria-pressed="!isPrivate" @click="isPrivate = false">
					<span class="mt">PUBLIC</span>
					<span class="md">Tokens and gas arrive visible on Aztec. Anyone can see the amount and recipient.</span>
				</button>
			</div>
		<!-- ADD-ON: fuel (gas on arrival), only on L1->L2. -->
		<Flex v-if="fuelAvailable" align="center" gap="10">
			<button
				type="button"
				class="toggle"
				:class="{ on: fuelOn }"
				:disabled="submitting"
				:data-testid="TESTIDS.bridgeFuelToggle"
				:aria-pressed="fuelOn"
				@click="fuelOn = !fuelOn"
			>
				<span class="knob" />
			</button>
			<span class="toggle-label">ARRIVE WITH GAS</span>
		</Flex>
		<div v-if="fuelOn && fuelAvailable" class="fuel-config">
			<div class="fuel-slice-row">
				<input
					v-model="fuelSlice"
					class="amount fuel-slice"
					type="number"
					aria-label="Fuel slice in AZLO"
					min="0"
					step="0.05"
					:disabled="submitting"
					:data-testid="TESTIDS.bridgeFuelSlice"
					:data-invalid="!!fuelError"
				/>
				<span class="unit">{{ BRIDGE_TOKEN_SYMBOL }}</span>
				<span class="fuel-arrow" aria-hidden="true">&rarr;</span>
				<span class="fuel-out" :data-testid="TESTIDS.bridgeFuelQuote" :data-state="fuelQuote.state">
					<template v-if="fuelQuote.state === 'loading'">quoting&hellip;</template>
					<template v-else-if="fuelQuote.state === 'ok'">&asymp; {{ formatBigInt(fuelQuote.fj ?? 0n, 18) }} FJ gas</template>
					<template v-else-if="fuelQuote.state === 'error'">{{ fuelError ?? fuelQuote.message }}</template>
					<template v-else>Fee Juice</template>
				</span>
			</div>
			<p v-if="fuelError && fuelQuote.state !== 'error'" class="err-msg" :data-testid="TESTIDS.bridgeFuelError">{{ fuelError }}</p>
		</div>

		<FeeJuiceNotice />

		<Button :loading="submitting" :disabled="!bothConnected || submitting" :data-testid="TESTIDS.bridgeSubmit" @click="onSubmit">
			{{ !bothConnected ? "CONNECT BOTH WALLETS" : direction === "l1-to-l2" ? (isPrivate ? "BRIDGE PRIVATELY TO AZTEC" : "BRIDGE TO AZTEC") : "BRIDGE TO ETHEREUM" }}
		</Button>

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

.fuel-config {
	margin: 2px 0 0 2px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.fuel-slice-row {
	display: flex;
	align-items: center;
	gap: 8px;
}

.fuel-slice {
	max-width: 96px;
}

.fuel-arrow {
	color: var(--txt-secondary);
}

.fuel-out {
	font: 600 12px/1 var(--font-mono);
	color: var(--txt-primary);
}

.fuel-out[data-state="error"] {
	color: var(--orange);
	font-weight: 500;
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

.opt-note {
	margin: -4px 0 0 2px;
	color: var(--txt-secondary);
	font: 500 11px/1.5 var(--font-mono);
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
