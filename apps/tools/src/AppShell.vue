<script setup lang="ts">
import { computed, ref } from "vue"
import { TESTIDS } from "@/lib/testids"
import AppToastRegion from "./components/AppToastRegion.vue"
import ChooseAccountModal from "./components/ChooseAccountModal.vue"
import WalletPickerModal from "./components/WalletPickerModal.vue"
import BridgeFooter from "./components/BridgeFooter.vue"
import ThemeToggle from "./components/ThemeToggle.vue"
import Footer from "./components/Footer.vue"
import ConnectionErrorStrip from "./components/ConnectionErrorStrip.vue"
import DripView from "./views/DripView.vue"
import SendView from "./views/SendView.vue"

type Tab = "drip" | "send"

/** A `bridge.*` host lands on the send tab; everywhere else the drip tab is the front door. */
function defaultTab(): Tab {
	if (typeof window !== "undefined" && window.location.hostname.startsWith("bridge")) return "send"
	return "drip"
}

const tab = ref<Tab>(defaultTab())

/** States with a dedicated in-panel UI never go to the strip: capability
 *  denial has the red morph everywhere; no-wallet has the install CTA on
 *  the drip tab only (send has no CTA, so it shows here). */
const stripExclude = computed(() => (tab.value === "drip" ? ["no-wallet", "capability-rejected"] : ["capability-rejected"]))
</script>

<template>
	<main class="page" :data-testid="TESTIDS.app">
		<div class="topbar">
		<nav class="tabs" :data-testid="TESTIDS.tabs">
			<button
				type="button"
				class="tab"
				:class="{ active: tab === 'drip' }"
				:aria-selected="tab === 'drip'"
				:data-testid="TESTIDS.tabDrip"
				@click="tab = 'drip'"
			>
				Drip
			</button>
			<button
				type="button"
				class="tab"
				:class="{ active: tab === 'send' }"
				:aria-selected="tab === 'send'"
				:data-testid="TESTIDS.tabSend"
				@click="tab = 'send'"
			>
				Send
			</button>
		</nav>
			<ThemeToggle />
		</div>

		<!-- ONE strip for the shared session, above whichever view is active — the views stay
		     mounted (v-show), so per-view strips would render duplicate alerts/testids with
		     diverging dismissal state. -->
		<ConnectionErrorStrip class="strip-slot" :exclude="stripExclude" />

		<!-- v-show (not v-if): keep the views mounted so the (single, shared) wallet session and
		     each view's local state persist across tab switches. Both tabs read ONE session
		     singleton (useBridgeWallet re-exports useWalletConnection) — one connection, one
		     grant, one active account. -->
		<DripView v-show="tab === 'drip'" />
		<SendView v-show="tab === 'send'" />

		<Footer v-if="tab === 'drip'" />
		<BridgeFooter v-else />
		<AppToastRegion />
		<!-- ONE picker for the shared session — the panels only trigger connect(). -->
		<WalletPickerModal />
		<ChooseAccountModal />
	</main>
</template>

<style scoped>
.strip-slot {
	margin-bottom: 24px;
}

.page {
	max-width: 760px;
	margin: 0 auto;
	padding: 80px 32px 96px;
	color: var(--txt-primary);
	display: flex;
	flex-direction: column;
	gap: 32px;
}

.topbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
}

.tabs {
	display: flex;
	gap: 4px;
	padding: 4px;
	background: color-mix(in srgb, var(--txt-primary) 4%, transparent);
}

.tab {
	font-family: var(--font-headline, inherit);
	font-weight: 600;
	font-size: 15px;
	letter-spacing: -0.01em;
	color: var(--txt-secondary);
	background: transparent;
	border: none;
	padding: 10px 20px;
	cursor: pointer;
	transition: background 0.15s ease, color 0.15s ease;
}

.tab:hover {
	color: var(--txt-primary);
}

.tab.active {
	color: var(--txt-primary);
	background: color-mix(in srgb, var(--txt-primary) 10%, transparent);
}
</style>
