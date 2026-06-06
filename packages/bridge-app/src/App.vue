<script setup lang="ts">
import { ref } from "vue"

type Tab = "faucet" | "bridge"
type Direction = "l1ToL2" | "l2ToL1"
type Asset = "USDC" | "ETH"

const tab = ref<Tab>("bridge")
const direction = ref<Direction>("l1ToL2")
const asset = ref<Asset>("USDC")
const isPrivate = ref(false)
const amount = ref("")

/** Wiring to bridge-core (progress model + l1/l2 flows) lands once the node
 * layer is unblocked; this is the building shell. */
const cta = (): string => (direction.value === "l1ToL2" ? "Bridge to L2" : "Withdraw to L1")
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
				<input v-model="amount" inputmode="decimal" placeholder="0.0" />
			</label>

			<label :class="$style.checkbox">
				<input v-model="isPrivate" type="checkbox" />
				<span>Private — claim into a private L2 balance</span>
			</label>

			<button :class="$style.cta" type="button" :disabled="!amount">{{ cta() }}</button>
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
</style>
