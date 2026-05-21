<script setup lang="ts">
import { TESTIDS } from "@/lib/testids"
</script>

<template>
	<div class="banner" :data-testid="TESTIDS.bannerAccountNotDeployed" role="alert">
		<span class="dot" aria-hidden="true" />
		<p>
			Your wallet account isn't on-chain yet. Send any transaction from your wallet first to
			initialize it — then come back here.
		</p>
	</div>
</template>

<style scoped>
.banner {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	padding: 16px 20px;
	background: var(--nulo-surface-low);
	border: 1px solid var(--yellow);
	border-left-width: 4px;
	color: var(--txt-primary);
	font-size: 14px;
	line-height: 1.5;
}

.dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	background: var(--yellow);
	border-radius: 50%;
	margin-top: 7px;
	flex-shrink: 0;
}
</style>
