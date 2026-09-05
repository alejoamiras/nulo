<script setup lang="ts">
import { TESTIDS } from "@/lib/testids"

/** The section's title line and, on the right, whatever wallet chips the section needs. */
defineProps<{ title: string; subline: string }>()
</script>

<template>
	<header class="head" :data-testid="TESTIDS.sectionHeader">
		<div class="titles">
			<h1>{{ title }}</h1>
			<p class="sub">{{ subline }}</p>
		</div>
		<div class="wallets"><slot name="wallets" /></div>
	</header>
</template>

<style scoped>
.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	min-height: 72px;
	padding: 0 36px;
	border-bottom: 1px solid var(--nulo-outline);
}

.titles {
	min-width: 0;
}

h1 {
	margin: 0;
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 20px;
	letter-spacing: -0.02em;
	line-height: 1;
}

.sub {
	margin: 6px 0 0;
	font: 500 11.5px/1.4 var(--font-mono);
	color: var(--txt-tertiary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.wallets {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: none;
}
</style>
