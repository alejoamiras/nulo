<script setup lang="ts">
import { BRIDGE_TOKEN_SYMBOL } from "@/contracts/bridge-deployments"
/** Services */
import { Button, Card } from "@nulo/design"
import { computed } from "vue"

/** Composables */
import { useL1Usdc } from "@/composables/useL1Usdc"
import { useL1Wallet } from "@/composables/useL1Wallet"

/** Utils */
import { TESTIDS } from "@/lib/testids"

const l1 = useL1Wallet()
const usdc = useL1Usdc()

const status = computed(() => {
	if (usdc.error.value) return usdc.error.value
	if (usdc.minting.value) return "Minting - confirm in your Ethereum wallet…"
	return null
})
</script>

<template>
	<Card>
		<header>
			<h3>GET TEST {{ BRIDGE_TOKEN_SYMBOL }} ON SEPOLIA (L1)</h3>
			<p class="sub">
				Mints 100 test {{ BRIDGE_TOKEN_SYMBOL }} to your Ethereum account on Sepolia: the asset this bridge
				moves. This is not the Faucet tab - the Faucet drips its own tokens directly on Aztec (L2), and this bridge cannot
				move that one. No real value.
			</p>
		</header>

		<Button
			:loading="usdc.minting.value"
			:disabled="!l1.isConnected.value || usdc.minting.value"
			:data-testid="TESTIDS.mintL1"
			@click="usdc.mint"
		>
			{{ l1.isConnected.value ? `MINT 100 ${BRIDGE_TOKEN_SYMBOL} ON SEPOLIA` : "CONNECT YOUR ETHEREUM WALLET" }}
		</Button>

		<p v-if="status" class="status" :data-testid="TESTIDS.mintL1Status">{{ status }}</p>
	</Card>
</template>

<style scoped>
h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 16px;
	color: var(--txt-primary);
	margin: 0;
}

.sub {
	color: var(--txt-secondary);
	font-size: 13px;
	line-height: 1.55;
	margin: 4px 0 0;
	max-width: 70ch;
}

.status {
	margin: 0;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}
</style>
