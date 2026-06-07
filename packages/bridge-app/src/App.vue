<script setup lang="ts">
import type { DepositFlowStage } from "@nulo/bridge-core"
import { computed, ref } from "vue"

type Tab = "faucet" | "bridge"
type Direction = "l1ToL2" | "l2ToL1"
type Asset = "USDC" | "ETH"

const tab = ref<Tab>("bridge")
const direction = ref<Direction>("l1ToL2")
const asset = ref<Asset>("USDC")
const isPrivate = ref(false)
const amount = ref("")
const bridging = ref(false)
const stage = ref<DepositFlowStage | "error" | "">("")
const resultMsg = ref("")

// L1→L2 has no clean block count, so the bar is stepped by stage; status.ts
// drives the real "N blocks remaining" bar for the L2→L1 direction.
const STAGE_FILL: Record<string, number> = { approving: 0.25, depositing: 0.5, syncing: 0.7, claiming: 0.85, done: 1 }
const STAGE_LABEL: Record<string, string> = {
	approving: "Approving USDC…",
	depositing: "Depositing to the portal…",
	syncing: "Waiting for the L1→L2 message…",
	claiming: "Claiming on L2…",
	done: "Done",
	error: "Failed",
}
const fill = computed(() => STAGE_FILL[stage.value] ?? 0)
const stageLabel = computed(() => STAGE_LABEL[stage.value] ?? "")
const busy = computed(() => bridging.value && stage.value !== "done" && stage.value !== "error")

const cta = (): string => (direction.value === "l1ToL2" ? "Bridge to L2" : "Withdraw to L1")

async function submit(): Promise<void> {
	bridging.value = true
	stage.value = ""
	resultMsg.value = ""
	try {
		// Lazy import: the sandbox dual-wallet + in-browser PXE never ship in prod.
		const { setupSandbox } = await import("./lib/sandbox")
		const sb = await setupSandbox()
		const units = BigInt(Math.round(Number(amount.value) * 1e6))
		const leafIndex = await sb.deposit(units, (s) => {
			stage.value = s
		})
		resultMsg.value = `Bridged ${amount.value} USDC to L2 (leaf ${leafIndex}).`
	} catch (e) {
		stage.value = "error"
		resultMsg.value = (e as Error).message
	}
}
</script>

<template>
	<main :class="$style.app">
		<header :class="$style.header">
			<h1 :class="$style.title">NULO BRIDGE</h1>
			<span :class="$style.tag">testnet</span>
		</header>

		<nav :class="$style.tabs">
			<button :class="[$style.tab, tab === 'faucet' && $style.tabActive]" type="button" @click="tab = 'faucet'">Faucet</button>
			<button :class="[$style.tab, tab === 'bridge' && $style.tabActive]" type="button" @click="tab = 'bridge'">Bridge</button>
		</nav>

		<section v-if="tab === 'faucet'" :class="$style.card">
			<p>Drip testnet tokens — the existing faucet flows mount here in the unified app.</p>
		</section>

		<section v-else :class="$style.card">
			<div :class="$style.row">
				<button :class="[$style.seg, direction === 'l1ToL2' && $style.segActive]" type="button" @click="direction = 'l1ToL2'">L1 → L2 (deposit)</button>
				<button :class="[$style.seg, direction === 'l2ToL1' && $style.segActive]" type="button" @click="direction = 'l2ToL1'">L2 → L1 (withdraw)</button>
			</div>

			<label :class="$style.field">
				<span>Asset</span>
				<select v-model="asset"><option value="USDC">USDC</option><option value="ETH">ETH</option></select>
			</label>

			<label :class="$style.field">
				<span>Amount</span>
				<input v-model="amount" inputmode="decimal" placeholder="0.0" data-testid="deposit-amount" />
			</label>

			<label :class="$style.checkbox">
				<input v-model="isPrivate" type="checkbox" data-testid="deposit-private" />
				<span>Private — claim into a private L2 balance</span>
			</label>

			<button :class="$style.cta" type="button" :disabled="!amount || busy" @click="submit" data-testid="deposit-submit">{{ cta() }}</button>

			<div v-if="bridging" :class="$style.progress">
				<div :class="$style.bar"><div :class="$style.fill" :style="{ width: `${Math.round(fill * 100)}%` }" /></div>
				<p :class="$style.progressLabel" data-testid="deposit-status">{{ stageLabel }}</p>
				<p v-if="stage === 'done'" :class="$style.success" data-testid="deposit-success">✅ {{ resultMsg }}</p>
				<p v-else-if="stage === 'error'" :class="$style.error" data-testid="deposit-error">⚠️ {{ resultMsg }}</p>
			</div>
		</section>
	</main>
</template>

<style module>
.app {
	max-width: 520px;
	margin: 2rem auto;
	padding: 0 1rem;
	font-family: var(--font-mono, ui-monospace, monospace);
	color: var(--color-fg, #111);
}
.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	border-bottom: 4px solid var(--color-fg, #111);
	padding-bottom: 0.5rem;
}
.title {
	font-size: 1.5rem;
	letter-spacing: -0.5px;
}
.tag {
	border: 2px solid var(--color-fg, #111);
	padding: 0 0.4rem;
	font-size: 0.75rem;
	text-transform: uppercase;
}
.tabs {
	display: flex;
	gap: 0.5rem;
	margin: 1.25rem 0;
}
.tab,
.seg,
.cta {
	border: 2px solid var(--color-fg, #111);
	background: var(--color-bg, #fff);
	padding: 0.5rem 0.9rem;
	cursor: pointer;
	font: inherit;
}
.tabActive,
.segActive {
	background: var(--color-fg, #111);
	color: var(--color-bg, #fff);
}
.card {
	border: 2px solid var(--color-fg, #111);
	box-shadow: 5px 5px 0 var(--color-fg, #111);
	padding: 1rem 1.25rem;
}
.row {
	display: flex;
	gap: 0.5rem;
	margin-bottom: 1rem;
}
.field {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	margin-bottom: 0.9rem;
}
.field select,
.field input {
	border: 2px solid var(--color-fg, #111);
	padding: 0.5rem;
	font: inherit;
}
.checkbox {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-bottom: 1rem;
	font-size: 0.85rem;
}
.cta {
	width: 100%;
	font-weight: 700;
}
.cta:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
.progress {
	margin-top: 1rem;
}
.bar {
	border: 2px solid var(--color-fg, #111);
	height: 1.25rem;
	background: var(--color-bg, #fff);
}
.fill {
	height: 100%;
	background: var(--color-fg, #111);
	transition: width 0.3s ease;
}
.progressLabel {
	margin-top: 0.4rem;
	font-size: 0.8rem;
}
.success {
	margin-top: 0.5rem;
	font-size: 0.85rem;
	font-weight: 700;
}
.error {
	margin-top: 0.5rem;
	font-size: 0.85rem;
	color: #b00;
}
</style>
