<script setup lang="ts">
/** Services */
import { computed } from "vue"

/** Utils */
import {
	BRIDGE,
	BRIDGE_FUEL,
	BRIDGE_PROXY,
	BRIDGE_TOKEN,
	BRIDGE_TOKEN_DECIMALS,
	BRIDGE_TOKEN_SYMBOL,
	L1_PORTAL,
	L1_USDC,
} from "@/contracts/bridge-deployments"
import { etherscanAddressUrl, explorerAddressUrl } from "@/lib/explorer"
import { IS_MAINNET, NETWORK } from "@/lib/network"

const tagline = `${IS_MAINNET ? "Real funds — keep it small" : "Testnet only"} · 1:1 ${NETWORK.viemChain.name} ↔ Aztec · ${BRIDGE_TOKEN_DECIMALS} decimals · Public or private claims`

const links = computed(() => ({
	l1Token: etherscanAddressUrl(L1_USDC),
	portal: etherscanAddressUrl(L1_PORTAL),
	router: BRIDGE_FUEL ? etherscanAddressUrl(BRIDGE_FUEL.router) : "",
	l2Token: explorerAddressUrl(BRIDGE_TOKEN.toString()),
	bridge: explorerAddressUrl(BRIDGE.toString()),
	proxy: explorerAddressUrl(BRIDGE_PROXY.toString()),
}))
</script>

<template>
	<footer class="footer">
		<p class="contracts">
			<span class="label">{{ NETWORK.viemChain.name }}:</span>
			<a v-if="links.l1Token" :href="links.l1Token" target="_blank" rel="noopener noreferrer">{{ BRIDGE_TOKEN_SYMBOL }}</a>
			<span v-else>{{ BRIDGE_TOKEN_SYMBOL }}</span>
			<span class="sep">·</span>
			<a v-if="links.portal" :href="links.portal" target="_blank" rel="noopener noreferrer">Portal</a>
			<template v-if="links.router">
				·
				<a :href="links.router" target="_blank" rel="noopener noreferrer">Fuel router</a>
			</template>
			<span v-else>Portal</span>
			<span class="gap" />
			<span class="label">Aztec:</span>
			<a v-if="links.l2Token" :href="links.l2Token" target="_blank" rel="noopener noreferrer">{{ BRIDGE_TOKEN_SYMBOL }}</a>
			<span v-else>{{ BRIDGE_TOKEN_SYMBOL }}</span>
			<span class="sep">·</span>
			<a v-if="links.bridge" :href="links.bridge" target="_blank" rel="noopener noreferrer">Bridge</a>
			<span v-else>Bridge</span>
			<span class="sep">·</span>
			<a v-if="links.proxy" :href="links.proxy" target="_blank" rel="noopener noreferrer">Minter</a>
			<span v-else>Minter</span>
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
