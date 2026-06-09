<script setup lang="ts">
import { AppButton } from "@nulo/design"
import { computed, ref } from "vue"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { useDeposit } from "@/composables/useDeposit"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { TESTIDS } from "@/lib/testids"

const { stage, error, hasPending, deposit, discardPending } = useDeposit()
const l1 = useL1Wallet()
const bridge = useBridgeWallet()

const amount = ref("100")

const bothConnected = computed(() => l1.isConnected.value && bridge.status.value === "connected")
const busy = computed(() => stage.value !== "idle" && stage.value !== "done" && stage.value !== "error")

const STAGES = ["minting", "approving", "depositing", "syncing", "claiming", "done"] as const
const progress = computed(() => {
	const i = STAGES.indexOf(stage.value as (typeof STAGES)[number])
	return i < 0 ? 0 : Math.round(((i + 1) / STAGES.length) * 100)
})

const stageLabel = computed(() => {
	switch (stage.value) {
		case "minting":
			return "Step 1 of 4 · Minting test USDC — confirm in your Ethereum wallet"
		case "approving":
			return "Step 2 of 4 · Approving the portal — confirm in your Ethereum wallet"
		case "depositing":
			return "Step 3 of 4 · Depositing to Aztec — confirm in your Ethereum wallet"
		case "syncing":
			return "Waiting for the L1→L2 message to sync on Aztec — no signature needed (~1–2 min)…"
		case "claiming":
			return "Step 4 of 4 · Claiming on Aztec — confirm in your Aztec wallet"
		case "done":
			return "Deposit complete."
		case "error":
			return error.value ?? "Deposit failed."
		default:
			return ""
	}
})

async function onDeposit() {
	const amt = BigInt(Math.round(Number(amount.value || "0") * 1e6))
	if (amt <= 0n) return
	await deposit(amt)
}
</script>

<template>
	<section class="deposit-card">
		<header>
			<h3>Deposit · Ethereum → Aztec</h3>
			<p class="sub">Mint test USDC on Sepolia and bridge it to your Aztec account, 1:1.</p>
		</header>

		<div class="amount-row">
			<input
				v-model="amount"
				class="amount"
				type="number"
				min="0"
				step="1"
				:disabled="busy"
				:data-testid="TESTIDS.depositAmount"
			/>
			<span class="unit">USDC</span>
		</div>

		<AppButton :loading="busy" :disabled="!bothConnected || busy" :data-testid="TESTIDS.depositSubmit" @click="onDeposit">
			{{ bothConnected ? "Deposit" : "Connect both wallets above" }}
		</AppButton>

		<div v-if="hasPending && stage === 'idle'" class="pending-hint" :data-testid="TESTIDS.depositPending">
			<span>A pending deposit claim was found — connect your Aztec wallet and it resumes automatically.</span>
			<button class="discard" type="button" @click="discardPending">Discard</button>
		</div>

		<div v-if="stage !== 'idle'" class="status" :data-testid="TESTIDS.depositStage" :data-stage="stage">
			<div class="bar" :class="{ pulsing: busy }">
				<div class="bar-fill" :style="{ width: `${progress}%` }" />
			</div>
			<p class="stage-label" :class="{ ok: stage === 'done', err: stage === 'error' }">{{ stageLabel }}</p>
		</div>

		<p v-if="stage === 'done'" class="success" :data-testid="TESTIDS.depositSuccess">✓ Bridged to Aztec.</p>
		<p v-if="stage === 'error'" class="err-msg" :data-testid="TESTIDS.depositError">{{ error }}</p>
	</section>
</template>

<style scoped>
.deposit-card {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 24px;
	border: 1px solid var(--nulo-outline);
	border-radius: 12px;
}

.deposit-card h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 18px;
	color: var(--txt-primary);
	margin: 0;
}

.deposit-card .sub {
	color: var(--txt-secondary);
	font-size: 14px;
	margin: 4px 0 0;
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
	font: 600 18px/1 var(--font-mono);
}

.amount:focus {
	outline: none;
	border-color: var(--mint);
}

.unit {
	color: var(--txt-secondary);
	font: 500 13px/1 var(--font-mono);
	letter-spacing: 0.08em;
}

.status {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.bar {
	height: 6px;
	background: var(--nulo-outline);
	border-radius: 3px;
	overflow: hidden;
}

.bar-fill {
	height: 100%;
	background: var(--mint);
	transition: width 0.4s ease;
}

.bar.pulsing .bar-fill {
	animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
	50% {
		opacity: 0.5;
	}
}

.stage-label {
	color: var(--txt-secondary);
	font-size: 13px;
	margin: 0;
}

.stage-label.ok {
	color: var(--mint);
}

.stage-label.err,
.err-msg {
	color: var(--red);
	font-size: 13px;
}

.success {
	color: var(--mint);
	font: 600 14px/1 var(--font-mono);
}

.pending-hint {
	display: flex;
	align-items: center;
	gap: 10px;
	color: var(--yellow);
	font-size: 13px;
	line-height: 1.4;
	margin: 0;
	padding: 10px 12px;
	border: 1px solid var(--yellow);
	border-radius: 8px;
}

.pending-hint .discard {
	margin-left: auto;
	flex-shrink: 0;
	color: var(--yellow);
	background: transparent;
	border: 1px solid var(--yellow);
	border-radius: 6px;
	padding: 4px 10px;
	font-size: 12px;
	cursor: pointer;
}
</style>
