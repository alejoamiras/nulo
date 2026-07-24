<script setup lang="ts">
import { nextTick, ref } from "vue"
import BridgeJournal from "@/components/BridgeJournal.vue"
import BridgeWalletPanel from "@/components/BridgeWalletPanel.vue"
import FuelForm from "@/components/FuelForm.vue"
import L1WalletPanel from "@/components/L1WalletPanel.vue"
import MintFuelAsset from "@/components/MintFuelAsset.vue"
import { FUEL_ASSET_HANDLER } from "@/contracts/bridge-deployments"
import { TESTIDS } from "@/lib/testids"

// The mint affordance depends on a permissionless FeeAssetHandler — present on testnet, absent on
// mainnet (BYO-$AZTEC). Hide it when the manifest declares no handler.
const canMintFuelAsset = !!FUEL_ASSET_HANDLER

const journalAnchor = ref<HTMLElement | null>(null)

// When a fuel bridge finishes, scroll "Your fuels" into view: the completed bridge lives there, and the
// form otherwise leaves the user on the receipt without ever surfacing the list. nextTick so the list
// has re-rendered the just-completed record before we scroll to it.
async function onFuelCompleted() {
	await nextTick()
	journalAnchor.value?.scrollIntoView?.({ behavior: "smooth", block: "start" })
}
</script>

<template>
	<div class="fuel-view" :data-testid="TESTIDS.fuelView">
		<Flex tag="header" direction="column" gap="16" class="hero">
			<h1>FUEL</h1>
			<p class="sub">
				Bridge your $AZTEC into Aztec Fee Juice, public or private gas, no swap. Testnet only.
				Connect both wallets, choose how the gas arrives, and bridge. In-flight bridges persist in this browser.
			</p>
		</Flex>

		<section class="wallets">
			<L1WalletPanel />
			<BridgeWalletPanel />
		</section>

		<FuelForm @completed="onFuelCompleted" />
		<MintFuelAsset v-if="canMintFuelAsset" />
		<div ref="journalAnchor">
			<BridgeJournal kind="fee-juice" :toasts="false" title="YOUR FUELS" />
		</div>
	</div>
</template>

<style scoped>
.fuel-view {
	display: flex;
	flex-direction: column;
	gap: 28px;
}

.hero {
	margin-bottom: 4px;
}

.hero h1 {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 44px;
	letter-spacing: -0.02em;
	line-height: 1.04;
	margin: 0;
}

.hero .sub {
	color: var(--txt-secondary);
	font-size: 16px;
	max-width: 62ch;
	margin: 0;
	line-height: 1.55;
}

.wallets {
	display: flex;
	flex-direction: row;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px 16px;
	padding: 16px 0;
	border-top: 1px solid var(--nulo-outline);
	border-bottom: 1px solid var(--nulo-outline);
}
</style>
