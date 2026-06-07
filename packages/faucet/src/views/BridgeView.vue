<script setup lang="ts">
import { TESTIDS } from "@/lib/testids"
</script>

<template>
	<div class="bridge-view" :data-testid="TESTIDS.bridgeView">
		<header class="hero">
			<h1>BRIDGE</h1>
			<p class="sub">
				Move assets between Ethereum (L1) and Aztec (L2). Testnet only. Connect your Ethereum
				wallet and your Aztec wallet to deposit, withdraw, or swap-and-fuel in one step.
			</p>
		</header>

		<div class="placeholder">Bridge flows land here next.</div>
	</div>
</template>

<style scoped>
.bridge-view {
	display: flex;
	flex-direction: column;
	gap: 32px;
}

.hero {
	display: flex;
	flex-direction: column;
	gap: 16px;
	margin-bottom: 8px;
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

.placeholder {
	color: var(--txt-secondary);
	font-size: 15px;
	padding: 24px;
	border: 1px dashed var(--border-subtle, rgba(255, 255, 255, 0.12));
	border-radius: 12px;
	text-align: center;
}
</style>
