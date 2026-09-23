<script setup lang="ts">
/** Services */
import { computed } from "vue"

/** Utils */
import { FUEL_PORTAL, GENERATION, HUB } from "@/contracts/bridge-generation"
import { etherscanAddressUrl, explorerAddressUrl } from "@/lib/explorer"
import { IS_MAINNET, NETWORK } from "@/lib/network"

/** The generation's own contracts, so a reader can check what this build actually sends through. */
const tagline = `${IS_MAINNET ? "Real funds — keep it small" : "Testnet only"} · any ERC-20 · ${NETWORK.viemChain.name} ↔ Aztec · Public or private claims`

const links = computed(() => ({
	factory: GENERATION ? etherscanAddressUrl(GENERATION.l1.factory) : "",
	router: GENERATION ? etherscanAddressUrl(GENERATION.l1.router) : "",
	feeJuicePortal: etherscanAddressUrl(FUEL_PORTAL),
	hub: HUB ? explorerAddressUrl(HUB.toString()) : "",
}))
</script>

<template>
	<footer class="footer">
		<p class="contracts">
			<span class="label">{{ NETWORK.viemChain.name }}:</span>
			<a v-if="links.factory" :href="links.factory" target="_blank" rel="noopener noreferrer">Portal factory</a>
			<span v-else>Portal factory</span>
			<span class="sep">·</span>
			<a v-if="links.router" :href="links.router" target="_blank" rel="noopener noreferrer">Router</a>
			<span v-else>Router</span>
			<span class="sep">·</span>
			<a v-if="links.feeJuicePortal" :href="links.feeJuicePortal" target="_blank" rel="noopener noreferrer">Fee Juice portal</a>
			<span v-else>Fee Juice portal</span>
			<span class="gap" />
			<span class="label">Aztec:</span>
			<a v-if="links.hub" :href="links.hub" target="_blank" rel="noopener noreferrer">Bridge hub</a>
			<span v-else>Bridge hub</span>
		</p>
		<p class="tagline">{{ tagline }}</p>
	</footer>
</template>

<style scoped>
.footer {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 24px 0 8px;
	border-top: 1px solid var(--nulo-outline);
}

.contracts {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: baseline;
	margin: 0;
	font: 500 12px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}

.label {
	letter-spacing: 0.08em;
	text-transform: uppercase;
	font-size: 11px;
}

.gap {
	width: 12px;
}

.contracts a {
	color: var(--txt-secondary);
	text-decoration: underline;
	text-underline-offset: 2px;
}

.contracts a:hover {
	color: var(--txt-primary);
}

.tagline {
	margin: 0;
	font: 500 11px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}
</style>
