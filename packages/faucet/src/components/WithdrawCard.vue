<script setup lang="ts">
import { AppButton } from "@nulo/design"
import { computed, ref } from "vue"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { useWithdraw } from "@/composables/useWithdraw"
import { TESTIDS } from "@/lib/testids"

const { stage, error, provenBlock, targetBlock, hasPending, withdraw } = useWithdraw()
const l1 = useL1Wallet()
const bridge = useBridgeWallet()

const amount = ref("40")

const bothConnected = computed(() => l1.isConnected.value && bridge.status.value === "connected")
const busy = computed(() => stage.value !== "idle" && stage.value !== "done" && stage.value !== "error")

const STAGES = ["burning", "exiting", "proving", "consuming", "done"] as const
const progress = computed(() => {
	const i = STAGES.indexOf(stage.value as (typeof STAGES)[number])
	return i < 0 ? 0 : Math.round(((i + 1) / STAGES.length) * 100)
})

const blocksRemaining = computed(() => {
	if (stage.value !== "proving" || provenBlock.value === null || targetBlock.value === null) return null
	return Math.max(0, targetBlock.value - provenBlock.value)
})

const stageLabel = computed(() => {
	switch (stage.value) {
		case "burning":
			return "Authorizing the burn on L2…"
		case "exiting":
			return "Exiting to L1 (L2 transaction)…"
		case "proving":
			return blocksRemaining.value !== null
				? `Waiting for the proven epoch — ${blocksRemaining.value} block${blocksRemaining.value === 1 ? "" : "s"} remaining (testnet proving can be slow)…`
				: "Waiting for the proven epoch (testnet proving can be slow)…"
		case "consuming":
			return "Consuming on L1 (Ethereum transaction)…"
		case "done":
			return "Withdraw complete."
		case "error":
			return error.value ?? "Withdraw failed."
		default:
			return ""
	}
})

async function onWithdraw() {
	const amt = BigInt(Math.round(Number(amount.value || "0") * 1e6))
	if (amt <= 0n) return
	await withdraw(amt)
}
</script>

<template>
	<section class="withdraw-card">
		<header>
			<h3>Withdraw · Aztec → Ethereum</h3>
			<p class="sub">Burn your bridged USDC on L2 and release it back to your Ethereum account.</p>
		</header>

		<div class="amount-row">
			<input
				v-model="amount"
				class="amount"
				type="number"
				min="0"
				step="1"
				:disabled="busy"
				:data-testid="TESTIDS.withdrawAmount"
			/>
			<span class="unit">USDC</span>
		</div>

		<AppButton :loading="busy" :disabled="!bothConnected || busy" :data-testid="TESTIDS.withdrawSubmit" @click="onWithdraw">
			{{ bothConnected ? "Withdraw" : "Connect both wallets above" }}
		</AppButton>

		<p v-if="hasPending && stage === 'idle'" class="pending-hint" :data-testid="TESTIDS.withdrawPending">
			A pending withdraw was found — connect your Ethereum wallet to finish it.
		</p>

		<div v-if="stage !== 'idle'" class="status" :data-testid="TESTIDS.withdrawStage" :data-stage="stage">
			<div class="bar" :class="{ pulsing: busy }">
				<div class="bar-fill" :style="{ width: `${progress}%` }" />
			</div>
			<p class="stage-label" :class="{ ok: stage === 'done', err: stage === 'error' }">{{ stageLabel }}</p>
		</div>

		<p v-if="stage === 'done'" class="success" :data-testid="TESTIDS.withdrawSuccess">✓ Released to Ethereum.</p>
		<p v-if="stage === 'error'" class="err-msg" :data-testid="TESTIDS.withdrawError">{{ error }}</p>
	</section>
</template>

<style scoped>
.withdraw-card {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 24px;
	border: 1px solid var(--nulo-outline);
	border-radius: 12px;
}

.withdraw-card h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 18px;
	color: var(--txt-primary);
	margin: 0;
}

.withdraw-card .sub {
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
	color: var(--yellow);
	font-size: 13px;
	line-height: 1.4;
	margin: 0;
	padding: 10px 12px;
	border: 1px solid var(--yellow);
	border-radius: 8px;
}
</style>
