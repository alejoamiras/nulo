<script setup lang="ts">
</script>

<template>
	<main class="page" data-testid="fa-app">
		<header class="hero">
			<h1>DRIP TEST ASSETS</h1>
			<p class="sub">Alpha-testnet only. Connect an Aztec wallet and mint fixed USDC or ETH into a public or private balance. Internal faucet. No real value.</p>
		</header>
	</main>
</template>

<style scoped>
.page {
	max-width: 720px;
	margin: 0 auto;
	padding: 64px 24px 96px;
	color: var(--txt-primary);
}
.hero h1 {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 38px;
	letter-spacing: -0.02em;
	line-height: 1.05;
	margin: 0 0 12px;
}
.hero .sub {
	color: var(--txt-secondary);
	font-size: 16px;
	max-width: 56ch;
	margin: 0;
}
</style>
