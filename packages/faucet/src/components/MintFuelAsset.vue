<script setup lang="ts">
/** Services */
import { Button } from "@nulo/design"
import { computed } from "vue"

/** Composables */
import { useL1FeeAsset } from "@/composables/useL1FeeAsset"
import { useL1Wallet } from "@/composables/useL1Wallet"

/** Utils */
import { TESTIDS } from "@/lib/testids"

const l1 = useL1Wallet()
const feeAsset = useL1FeeAsset()

// Action + label are state-driven so the one button is always actionable (codex: don't copy
// MintTestUsdc's connect-only gate). Mint is gated on connected AND on Sepolia.
const label = computed(() => {
	if (!l1.isConnected.value) return "CONNECT YOUR ETHEREUM WALLET"
	if (l1.wrongChain.value) return "SWITCH TO SEPOLIA"
	return "MINT TEST $AZTEC"
})

const status = computed(() => {
	if (feeAsset.mintError.value) return feeAsset.mintError.value
	if (feeAsset.minting.value) return "Minting, confirm in your Ethereum wallet…"
	return null
})

function onClick() {
	if (!l1.isConnected.value) return void l1.connect()
	if (l1.wrongChain.value) return void l1.switchToSepolia()
	void feeAsset.mint()
}
</script>

<template>
	<section class="mint-card" :data-testid="TESTIDS.fuelMintCard">
		<header>
			<h3>GET $AZTEC ON SEPOLIA</h3>
			<p class="sub">No $AZTEC yet? Mint some test $AZTEC to your Ethereum account, then fuel it into Aztec gas above. Testnet only, no real value.</p>
		</header>

		<Button :loading="feeAsset.minting.value" :disabled="feeAsset.minting.value" :data-testid="TESTIDS.fuelMintBtn" @click="onClick">
			{{ label }}
		</Button>

		<p v-if="status" class="status" :data-testid="TESTIDS.fuelMintStatus">{{ status }}</p>
	</section>
</template>

<style scoped>
.mint-card {
	display: flex;
	flex-direction: column;
	gap: 14px;
	padding: 24px;
	border: 1px solid var(--nulo-outline);
}

.mint-card h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 16px;
	color: var(--txt-primary);
	margin: 0;
}

.mint-card .sub {
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
