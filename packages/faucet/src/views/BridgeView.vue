<script setup lang="ts">
import BridgeAddToken from "@/components/BridgeAddToken.vue"
import BridgeForm from "@/components/BridgeForm.vue"
import BridgeJournal from "@/components/BridgeJournal.vue"
import BridgeWalletPanel from "@/components/BridgeWalletPanel.vue"
import L1WalletPanel from "@/components/L1WalletPanel.vue"
import MintTestUsdc from "@/components/MintTestUsdc.vue"
import { TESTIDS } from "@/lib/testids"
</script>

<template>
	<div class="bridge-view" :data-testid="TESTIDS.bridgeView">
		<header class="hero">
			<h1>BRIDGE</h1>
			<p class="sub">
				Move test USDC between Ethereum (Sepolia) and Aztec, 1:1, public or private. Testnet only. Connect
				both wallets, pick a direction, bridge. In-flight transfers persist in this browser - finish or
				discard them in the journal below.
			</p>
		</header>

		<section class="wallets">
			<L1WalletPanel />
			<BridgeWalletPanel />
		</section>

		<BridgeForm />
		<BridgeJournal />
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
	display: flex;
	flex-direction: column;
	gap: 16px;
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
