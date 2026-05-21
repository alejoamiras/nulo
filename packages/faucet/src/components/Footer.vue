<script setup lang="ts">
import { computed } from "vue"
import { DRIPPER, ETH, USDC } from "@/contracts/deployments"
import { explorerAddressUrl } from "@/lib/explorer"

const links = computed(() => ({
	usdc: explorerAddressUrl(USDC.toString()),
	eth: explorerAddressUrl(ETH.toString()),
	dripper: explorerAddressUrl(DRIPPER.toString()),
}))
</script>

<template>
	<footer class="footer">
		<p class="contracts">
			<span class="label">Contracts:</span>
			<a v-if="links.usdc" :href="links.usdc" target="_blank" rel="noopener noreferrer">USDC</a>
			<span v-else>USDC</span>
			<span class="sep">·</span>
			<a v-if="links.eth" :href="links.eth" target="_blank" rel="noopener noreferrer">ETH</a>
			<span v-else>ETH</span>
			<span class="sep">·</span>
			<a v-if="links.dripper" :href="links.dripper" target="_blank" rel="noopener noreferrer">Dripper</a>
			<span v-else>Dripper</span>
		</p>
		<p class="tagline">
			Alpha-testnet only · Permissionless dripper · Fixed amounts · No rate limit
		</p>
		<p class="external">
			<a href="https://github.com/defi-wonderland/aztec-standards" target="_blank" rel="noopener noreferrer">
				Wonderland aztec-standards
			</a>
			<span class="sep">·</span>
			<a href="https://aztec.network/" target="_blank" rel="noopener noreferrer">Aztec Network</a>
			<span class="sep">·</span>
			<span>Powered by Nulo</span>
		</p>
	</footer>
</template>

<style scoped>
.footer {
	margin-top: 24px;
	padding-top: 24px;
	border-top: 1px solid var(--nulo-outline);
	display: flex;
	flex-direction: column;
	gap: 8px;
	color: var(--txt-secondary);
	font-family: var(--font-mono);
	font-size: 12px;
}

.label {
	color: var(--txt-tertiary);
	margin-right: 4px;
}

.sep {
	margin: 0 6px;
	color: var(--txt-tertiary);
}

a {
	color: var(--nulo-accent);
	text-decoration: underline;
	text-underline-offset: 3px;
}

a:hover {
	color: var(--txt-primary);
}

.tagline {
	color: var(--txt-tertiary);
	letter-spacing: 0.04em;
}
</style>
