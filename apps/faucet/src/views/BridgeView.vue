<script setup lang="ts">
import { nextTick, ref } from "vue"
import { BRIDGE_TOKEN_SYMBOL } from "@/contracts/bridge-deployments"
import BridgeAddToken from "@/components/BridgeAddToken.vue"
import BridgeForm from "@/components/BridgeForm.vue"
import BridgeJournal from "@/components/BridgeJournal.vue"
import BridgeWalletPanel from "@/components/BridgeWalletPanel.vue"
import ConnectionErrorStrip from "@/components/ConnectionErrorStrip.vue"
import L1WalletPanel from "@/components/L1WalletPanel.vue"
import MintTestUsdc from "@/components/MintTestUsdc.vue"
import { TESTIDS } from "@/lib/testids"

const journalAnchor = ref<HTMLElement | null>(null)

// When a bridge finishes, scroll "Your bridges" into view: the completed bridge lives there, and the
// form otherwise leaves the user on the receipt without ever surfacing the list. nextTick so the list
// has re-rendered the just-completed record before we scroll to it.
async function onBridgeCompleted() {
	await nextTick()
	journalAnchor.value?.scrollIntoView?.({ behavior: "smooth", block: "start" })
}
</script>

<template>
	<div class="bridge-view" :data-testid="TESTIDS.bridgeView">
		<Flex tag="header" direction="column" gap="16" class="hero">
			<h1>BRIDGE</h1>
			<p class="sub">
				Move test {{ BRIDGE_TOKEN_SYMBOL }} between Ethereum (Sepolia) and Aztec, 1:1, public or private. Testnet only. Connect
				both wallets, pick a direction, bridge. In-flight transfers persist in this browser.
			</p>
		</Flex>

		<ConnectionErrorStrip :exclude="['capability-rejected']" />

		<section class="wallets">
			<L1WalletPanel />
			<BridgeWalletPanel />
		</section>

		<BridgeForm @completed="onBridgeCompleted" />
		<div ref="journalAnchor">
			<BridgeJournal kind="bridge-token" />
		</div>
		<MintTestUsdc />
		<BridgeAddToken />
	</div>
</template>

<style scoped>
.bridge-view {
	display: flex;
	flex-direction: column;
	gap: 28px;
}

.hero {
	margin-bottom: 4px;
}

.hero h1 {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 44px;
	letter-spacing: -0.02em;
	line-height: 1.04;
	margin: 0;
}

.hero .sub {
	color: var(--txt-secondary);
	font-size: 16px;
	max-width: 62ch;
	margin: 0;
	line-height: 1.55;
}

.wallets {
	display: flex;
	flex-direction: row;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px 16px;
	padding: 16px 0;
	border-top: 1px solid var(--nulo-outline);
	border-bottom: 1px solid var(--nulo-outline);
}
</style>
