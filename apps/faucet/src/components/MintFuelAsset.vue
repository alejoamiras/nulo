<script setup lang="ts">
/** Services */
import { Button, Card } from "@nulo/design"
import { computed } from "vue"

/** Composables */
import { useL1FeeAsset } from "@/composables/useL1FeeAsset"
import { useL1Wallet } from "@/composables/useL1Wallet"

/** Utils */
import { TESTIDS } from "@/lib/testids"

const l1 = useL1Wallet()
const feeAsset = useL1FeeAsset()

// One source of truth for the button's 3-way state so the label and the click can't drift (codex:
// don't copy MintTestUsdc's connect-only gate — mint is gated on connected AND on Sepolia).
const state = computed<"connect" | "switch" | "mint">(() => (!l1.isConnected.value ? "connect" : l1.wrongChain.value ? "switch" : "mint"))

const label = computed(() =>
	state.value === "connect" ? "CONNECT YOUR ETHEREUM WALLET" : state.value === "switch" ? "SWITCH TO SEPOLIA" : "MINT TEST $AZTEC",
)

const status = computed(() => {
	if (feeAsset.mintError.value) return feeAsset.mintError.value
	if (feeAsset.minting.value) return "Minting, confirm in your Ethereum wallet…"
	return null
})

function onClick() {
	if (state.value === "connect") return void l1.connect()
	if (state.value === "switch") return void l1.switchL1Network()
	void feeAsset.mint()
}
</script>

<template>
	<Card :data-testid="TESTIDS.fuelMintCard">
		<header>
			<h3>GET $AZTEC ON SEPOLIA</h3>
			<p class="sub">No $AZTEC yet? Mint some test $AZTEC to your Ethereum account, then fuel it into Aztec gas above. Testnet only, no real value.</p>
		</header>

		<Button :loading="feeAsset.minting.value" :disabled="feeAsset.minting.value" :data-testid="TESTIDS.fuelMintBtn" @click="onClick">
			{{ label }}
		</Button>

		<p v-if="status" class="status" :data-testid="TESTIDS.fuelMintStatus">{{ status }}</p>
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
