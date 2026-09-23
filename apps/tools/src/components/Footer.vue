<script setup lang="ts">
import { computed } from "vue"
import { DRIPPER, NULO, OLUN } from "@/contracts/deployments"
import { explorerAddressUrl } from "@/lib/explorer"
import { IS_MAINNET } from "@/lib/network"

const tagline = IS_MAINNET
	? "Play tokens on Aztec mainnet · Permissionless dripper · Fixed amounts · No real value"
	: "Alpha-testnet only · Permissionless dripper · Fixed amounts · No rate limit"

const links = computed(() => ({
	nulo: explorerAddressUrl(NULO.toString()),
	olun: explorerAddressUrl(OLUN.toString()),
	dripper: explorerAddressUrl(DRIPPER.toString()),
}))
</script>

<template>
	<footer class="footer">
		<p class="contracts">
			<span class="label">Contracts:</span>
			<a v-if="links.nulo" :href="links.nulo" target="_blank" rel="noopener noreferrer">NULO</a>
			<span v-else>NULO</span>
			<span class="sep">·</span>
			<a v-if="links.olun" :href="links.olun" target="_blank" rel="noopener noreferrer">OLUN</a>
			<span v-else>OLUN</span>
			<span class="sep">·</span>
			<a v-if="links.dripper" :href="links.dripper" target="_blank" rel="noopener noreferrer">Dripper</a>
			<span v-else>Dripper</span>
		</p>
		<p class="tagline">{{ tagline }}</p>
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
