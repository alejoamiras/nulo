<script setup lang="ts">
import BridgeWalletPanel from "@/components/BridgeWalletPanel.vue"
import DepositCard from "@/components/DepositCard.vue"
import L1WalletPanel from "@/components/L1WalletPanel.vue"
import WithdrawCard from "@/components/WithdrawCard.vue"
import { TESTIDS } from "@/lib/testids"
</script>

<template>
	<div class="bridge-view" :data-testid="TESTIDS.bridgeView">
		<header class="hero">
			<h1>BRIDGE</h1>
			<p class="sub">
				Move assets between Ethereum (L1) and Aztec (L2). Testnet only. Connect both wallets, then
				deposit USDC — it bridges to your Aztec account 1:1.
			</p>
		</header>

		<section class="wallets">
			<L1WalletPanel />
			<BridgeWalletPanel />
		</section>

		<DepositCard />
		<WithdrawCard />
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
	flex-direction: column;
	gap: 16px;
	padding: 20px 0;
	border-top: 1px solid var(--nulo-outline);
	border-bottom: 1px solid var(--nulo-outline);
}
</style>
