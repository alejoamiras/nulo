<script setup lang="ts">
import { ref } from "vue"
import { TESTIDS } from "@/lib/testids"
import AppToastRegion from "./components/AppToastRegion.vue"
import Footer from "./components/Footer.vue"
import BridgeView from "./views/BridgeView.vue"
import FaucetView from "./views/FaucetView.vue"

type Tab = "faucet" | "bridge"

/** Default to the Bridge tab when served from a bridge.* host; faucet otherwise. */
function defaultTab(): Tab {
	if (typeof window !== "undefined" && window.location.hostname.startsWith("bridge")) return "bridge"
	return "faucet"
}

const tab = ref<Tab>(defaultTab())
</script>

<template>
	<main class="page" :data-testid="TESTIDS.app">
		<nav class="tabs" :data-testid="TESTIDS.tabs">
			<button
				type="button"
				class="tab"
				:class="{ active: tab === 'faucet' }"
				:aria-selected="tab === 'faucet'"
				:data-testid="TESTIDS.tabFaucet"
				@click="tab = 'faucet'"
			>
				Faucet
			</button>
			<button
				type="button"
				class="tab"
				:class="{ active: tab === 'bridge' }"
				:aria-selected="tab === 'bridge'"
				:data-testid="TESTIDS.tabBridge"
				@click="tab = 'bridge'"
			>
				Bridge
			</button>
		</nav>

		<!-- v-show (not v-if): keep both views mounted so each tab owns an independent,
		     persistent wallet session (codex: two sessions, not one shared connection). -->
		<FaucetView v-show="tab === 'faucet'" />
		<BridgeView v-show="tab === 'bridge'" />

		<Footer />
		<AppToastRegion />
	</main>
</template>

<style scoped>
.page {
	max-width: 760px;
	margin: 0 auto;
	padding: 80px 32px 96px;
	color: var(--txt-primary);
	display: flex;
	flex-direction: column;
	gap: 32px;
}

.tabs {
	display: flex;
	gap: 4px;
	padding: 4px;
	background: var(--surface-raised, rgba(255, 255, 255, 0.04));
	border-radius: 12px;
	align-self: flex-start;
}

.tab {
	font-family: var(--font-headline, inherit);
	font-weight: 600;
	font-size: 15px;
	letter-spacing: -0.01em;
	color: var(--txt-secondary);
	background: transparent;
	border: none;
	border-radius: 8px;
	padding: 10px 20px;
	cursor: pointer;
	transition: background 0.15s ease, color 0.15s ease;
}

.tab:hover {
	color: var(--txt-primary);
}

.tab.active {
	color: var(--txt-primary);
	background: var(--surface-active, rgba(255, 255, 255, 0.1));
}
</style>
