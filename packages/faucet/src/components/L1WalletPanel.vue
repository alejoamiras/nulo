<script setup lang="ts">
import { AddressDisplay, AppButton } from "@nulo/design"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { TESTIDS } from "@/lib/testids"

const { address, isConnected, wrongChain, isConnecting, connect, disconnect, switchToSepolia } = useL1Wallet()
</script>

<template>
	<section class="l1-chip" :data-testid="TESTIDS.l1Status" :data-connected="isConnected">
		<div v-if="isConnected && address" class="chip">
			<span class="label">Ethereum</span>
			<AddressDisplay :address="address ?? ''" :data-testid="TESTIDS.l1Account" />
			<span v-if="!wrongChain" class="chain">Sepolia</span>
			<button v-else class="wrong-chain" type="button" :data-testid="TESTIDS.l1SwitchChain" @click="switchToSepolia">
				Switch to Sepolia
			</button>
			<button class="disconnect" type="button" aria-label="Disconnect" :data-testid="TESTIDS.l1Disconnect" @click="disconnect">
				✕
			</button>
		</div>

		<AppButton v-else :loading="isConnecting" :data-testid="TESTIDS.l1Connect" @click="connect">
			Connect Ethereum
		</AppButton>
	</section>
</template>

<style scoped>
.l1-chip {
	display: inline-flex;
}

.chip {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	padding: 8px 12px;
	border: 1px solid var(--nulo-outline);
	border-radius: 0;
}

.chip .label {
	color: var(--txt-secondary);
	font: 500 11px/1 var(--font-mono);
	letter-spacing: 0.12em;
	text-transform: uppercase;
}

.chain {
	color: var(--mint);
	font: 500 10px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	padding: 3px 6px;
	border: 1px solid var(--mint);
	border-radius: 4px;
}

.wrong-chain {
	color: var(--yellow);
	font: 500 10px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	padding: 3px 6px;
	border: 1px solid var(--yellow);
	border-radius: 4px;
	cursor: pointer;
	background: transparent;
}

.disconnect {
	color: var(--txt-secondary);
	font: 600 12px/1 var(--font-mono);
	cursor: pointer;
	background: transparent;
	border: none;
	padding: 2px 4px;
}

.disconnect:hover {
	color: var(--red);
}
</style>
