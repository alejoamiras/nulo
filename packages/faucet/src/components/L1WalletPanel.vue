<script setup lang="ts">
import { AddressDisplay, AppButton } from "@nulo/design"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { TESTIDS } from "@/lib/testids"

const { address, isConnected, wrongChain, isConnecting, connect, disconnect, switchToSepolia } = useL1Wallet()
</script>

<template>
	<section class="l1-panel" :data-testid="TESTIDS.l1Status" :data-connected="isConnected">
		<div v-if="isConnected && address" class="connected">
			<span class="label">Ethereum</span>
			<AddressDisplay :address="address ?? ''" :data-testid="TESTIDS.l1Account" />
			<span v-if="!wrongChain" class="chain">Sepolia</span>
			<button
				v-else
				class="wrong-chain"
				type="button"
				:data-testid="TESTIDS.l1SwitchChain"
				@click="switchToSepolia"
			>
				Switch to Sepolia
			</button>
			<button class="disconnect" type="button" :data-testid="TESTIDS.l1Disconnect" @click="disconnect">
				Disconnect
			</button>
		</div>

		<div v-else class="connect">
			<AppButton :loading="isConnecting" :data-testid="TESTIDS.l1Connect" @click="connect">
				Connect Ethereum wallet
			</AppButton>
		</div>
	</section>
</template>

<style scoped>
.l1-panel {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 24px 0;
	border-bottom: 1px solid var(--nulo-outline);
}

.connected {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
}

.connected .label {
	color: var(--txt-secondary);
	font: 500 11px/1 var(--font-mono);
	letter-spacing: 0.12em;
	text-transform: uppercase;
}

.chain {
	color: var(--mint);
	font: 500 11px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	padding: 4px 8px;
	border: 1px solid var(--mint);
}

.wrong-chain {
	color: var(--yellow);
	font: 500 11px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	padding: 4px 8px;
	border: 1px solid var(--yellow);
	cursor: pointer;
	background: transparent;
}

.disconnect {
	margin-left: auto;
	color: var(--txt-secondary);
	font-size: 13px;
	text-decoration: underline;
	text-underline-offset: 3px;
	cursor: pointer;
	background: transparent;
	border: none;
}

.disconnect:hover {
	color: var(--txt-primary);
}
</style>
