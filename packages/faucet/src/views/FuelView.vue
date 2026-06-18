<script setup lang="ts">
import BridgeWalletPanel from "@/components/BridgeWalletPanel.vue"
import FuelForm from "@/components/FuelForm.vue"
import L1WalletPanel from "@/components/L1WalletPanel.vue"
import { TESTIDS } from "@/lib/testids"
</script>

<template>
	<div class="fuel-view" :data-testid="TESTIDS.fuelView">
		<header class="hero">
			<h1>FUEL</h1>
			<p class="sub">
				Bridge your L1 $AZTEC straight into Aztec Fee Juice — public or private gas, no swap. Testnet only.
				Connect both wallets, choose how the gas arrives, and bridge. In-flight bridges persist in this browser.
			</p>
		</header>

		<section class="wallets">
			<L1WalletPanel />
			<BridgeWalletPanel />
		</section>

		<FuelForm />
	</div>
</template>

<style scoped>
.fuel-view {
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
