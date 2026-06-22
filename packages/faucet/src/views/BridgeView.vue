<script setup lang="ts">
import { BRIDGE_TOKEN_SYMBOL } from "@/contracts/bridge-deployments"
import BridgeAddToken from "@/components/BridgeAddToken.vue"
import BridgeForm from "@/components/BridgeForm.vue"
import BridgeJournal from "@/components/BridgeJournal.vue"
import BridgeWalletPanel from "@/components/BridgeWalletPanel.vue"
import L1WalletPanel from "@/components/L1WalletPanel.vue"
import MintTestUsdc from "@/components/MintTestUsdc.vue"
import { TESTIDS } from "@/lib/testids"
</script>

<template>
	<Flex direction="column" gap="28" :data-testid="TESTIDS.bridgeView">
		<Flex tag="header" direction="column" gap="16" class="hero">
			<h1>BRIDGE</h1>
			<p class="sub">
				Move test {{ BRIDGE_TOKEN_SYMBOL }} between Ethereum (Sepolia) and Aztec, 1:1, public or private. Testnet only. Connect
				both wallets, pick a direction, bridge. In-flight transfers persist in this browser.
			</p>
		</Flex>

		<section class="wallets">
			<L1WalletPanel />
			<BridgeWalletPanel />
		</section>

		<BridgeForm />
		<BridgeJournal kind="bridge-token" />
		<MintTestUsdc />
		<BridgeAddToken />
	</Flex>
</template>

<style scoped>
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
