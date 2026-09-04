<script setup lang="ts">
/** Components */
import BridgeJournal from "@/components/BridgeJournal.vue"
import BridgeWalletPanel from "@/components/BridgeWalletPanel.vue"
import L1WalletPanel from "@/components/L1WalletPanel.vue"
import SendWizard from "@/components/send/SendWizard.vue"

/** Utils */
import { IS_PLACEHOLDER } from "@/contracts/bridge-generation"
import { TESTIDS } from "@/lib/testids"

/**
 * `IS_PLACEHOLDER` is per-NETWORK, not per-build: a manifest with no bridge block means this network
 * has no generation to send through yet. The wizard is a child component precisely so that state
 * never instantiates its composables — nothing wires the journal engine to a bridge that isn't there.
 */
</script>

<template>
	<div class="send-view" :data-testid="TESTIDS.sendView">
		<Flex tag="header" direction="column" gap="16" class="hero">
			<h1>SEND</h1>
			<p class="sub">
				Move any ERC-20 between Ethereum and Aztec, publicly or privately, and arrive with gas to spend.
				In-flight sends persist in this browser.
			</p>
		</Flex>

		<template v-if="IS_PLACEHOLDER">
			<section class="placeholder" :data-testid="TESTIDS.sendUnavailable">
				<p class="placeholder-title">Bridging is being upgraded</p>
				<p class="sub">Back with the next generation on this network. The faucet keeps working meanwhile.</p>
			</section>
		</template>
		<template v-else>
			<section class="wallets">
				<L1WalletPanel />
				<BridgeWalletPanel />
			</section>

			<SendWizard />
			<BridgeJournal />
		</template>
	</div>
</template>

<style scoped>
.send-view {
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

.sub {
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

.placeholder {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 24px;
	border: 1px dashed var(--nulo-outline);
}

.placeholder-title {
	margin: 0;
	color: var(--txt-primary);
	font: 600 15px/1.4 var(--font-mono);
	letter-spacing: 0.04em;
}
</style>
