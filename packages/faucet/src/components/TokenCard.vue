<script setup lang="ts">
import type { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { onBeforeUnmount } from "vue"
import { useTokenBalance } from "@/composables/useTokenBalance"
import type { FaucetToken } from "@/constants/tokens"
import { TESTIDS } from "@/lib/testids"
import Card from "./ui/Card.vue"
import BalanceRow from "./composite/BalanceRow.vue"
import DisclaimerTag from "./composite/DisclaimerTag.vue"

const props = defineProps<{
	token: FaucetToken
	tokenAddress: AztecAddress
	wallet: Wallet
	account: AztecAddress
}>()

const balance = useTokenBalance(props.wallet, props.tokenAddress, props.account)

onBeforeUnmount(() => {
	balance.dispose()
})

defineExpose({ refresh: balance.refresh })
</script>

<template>
	<Card :data-testid="TESTIDS.tokenCard" :data-symbol="token.symbol">
		<header class="head">
			<h3 class="symbol">{{ token.symbol }}</h3>
			<p class="sub">Fixed drip: {{ token.displayAmount }} {{ token.symbol }}</p>
		</header>
		<BalanceRow
			:public-balance="balance.publicBalance.value"
			:private-balance="balance.privateBalance.value"
			:decimals="token.decimals"
			:loading="balance.loading.value"
		/>
		<footer class="foot">
			<DisclaimerTag />
		</footer>
	</Card>
</template>

<style scoped>
.head {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.symbol {
	font-family: var(--font-mono);
	font-size: 24px;
	font-weight: 600;
	color: var(--txt-primary);
	letter-spacing: -0.01em;
}

.sub {
	color: var(--txt-secondary);
	font-size: 13px;
	font-family: var(--font-mono);
}

.foot {
	display: flex;
	justify-content: flex-start;
}
</style>
