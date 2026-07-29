<script setup lang="ts">
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { computed } from "vue"
import TokenCard from "@/components/TokenCard.vue"
import WalletPanel from "@/components/WalletPanel.vue"
import { useWalletConnection } from "@/composables/useWalletConnection"
import { IS_MAINNET } from "@/lib/network"
import { FAUCET_TOKENS } from "@/constants/tokens"
import { NULO, OLUN } from "@/contracts/deployments"

const { status, wallet, selectedAccount } = useWalletConnection()

const tokenEntries = computed(() =>
	FAUCET_TOKENS.map((token) => ({
		token,
		address: token.symbol === "NULO" ? NULO : OLUN,
	})),
)

const accountAddress = computed(() => (selectedAccount.value ? AztecAddress.fromStringUnsafe(selectedAccount.value) : null))
</script>

<template>
	<Flex direction="column" gap="32">
		<Flex tag="header" direction="column" gap="16" class="hero">
			<h1>DRIP TEST ASSETS</h1>
			<p v-if="IS_MAINNET" class="sub">
				Play tokens on Aztec mainnet. Connect an Aztec wallet and mint fixed NULO or OLUN into a
				public or private balance. No real value — each mint pays a small fee-juice fee from your
				wallet (bridge some fuel first).
			</p>
			<p v-else class="sub">
				Alpha-testnet only. Connect an Aztec wallet and mint fixed NULO or OLUN into a public or
				private balance. Internal faucet. No real value.
			</p>
		</Flex>

		<section class="wallets">
			<WalletPanel />
		</section>

		<!--
		Cards always render so the page never collapses into the header
		alone. Composables only activate when the user is connected; the
		`:key` flips on connection state so the card cleanly re-mounts and
		the composable lifecycle is unambiguous (no half-active polling).
		-->
		<section class="cards">
			<TokenCard
				v-for="entry in tokenEntries"
				:key="`${entry.token.symbol}:${status === 'connected' ? 'on' : 'off'}`"
				:token="entry.token"
				:token-address="entry.address"
				:wallet="status === 'connected' && wallet ? wallet : undefined"
				:account="status === 'connected' && accountAddress ? accountAddress : undefined"
			/>
		</section>
	</Flex>
</template>

<style scoped>
.hero {
	margin-bottom: 8px;
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

.cards {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
	gap: 20px;
}
</style>
