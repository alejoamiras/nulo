<script setup lang="ts">
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { computed } from "vue"
import { useWalletConnection } from "@/composables/useWalletConnection"
import { FAUCET_TOKENS } from "@/constants/tokens"
import { ETH, USDC } from "@/contracts/deployments"
import { TESTIDS } from "@/lib/testids"
import AccountNotDeployedBanner from "./components/AccountNotDeployedBanner.vue"
import AppToastRegion from "./components/AppToastRegion.vue"
import TokenCard from "./components/TokenCard.vue"
import WalletPanel from "./components/WalletPanel.vue"

const { status, accountDeployed, wallet, selectedAccount } = useWalletConnection()

const tokenEntries = computed(() =>
	FAUCET_TOKENS.map((token) => ({
		token,
		address: token.symbol === "USDC" ? USDC : ETH,
	})),
)

const accountAddress = computed(() => (selectedAccount.value ? AztecAddress.fromString(selectedAccount.value) : null))
</script>

<template>
	<main class="page" :data-testid="TESTIDS.app">
		<header class="hero">
			<h1>DRIP TEST ASSETS</h1>
			<p class="sub">
				Alpha-testnet only. Connect an Aztec wallet and mint fixed USDC or ETH into a public or
				private balance. Internal faucet. No real value.
			</p>
		</header>

		<WalletPanel />

		<AccountNotDeployedBanner v-if="status === 'connected' && accountDeployed === false" />

		<section v-if="status === 'connected' && wallet && accountAddress" class="cards">
			<TokenCard
				v-for="entry in tokenEntries"
				:key="entry.token.symbol"
				:token="entry.token"
				:token-address="entry.address"
				:wallet="wallet"
				:account="accountAddress"
			/>
		</section>

		<AppToastRegion />
	</main>
</template>

<style scoped>
.page {
	max-width: 720px;
	margin: 0 auto;
	padding: 64px 24px 96px;
	color: var(--txt-primary);
	display: flex;
	flex-direction: column;
	gap: 24px;
}

.hero h1 {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 38px;
	letter-spacing: -0.02em;
	line-height: 1.05;
	margin: 0 0 12px;
}

.hero .sub {
	color: var(--txt-secondary);
	font-size: 16px;
	max-width: 56ch;
	margin: 0;
}

.cards {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
	gap: 16px;
}
</style>
