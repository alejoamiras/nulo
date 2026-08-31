<script setup lang="ts">
import { AddressDisplay, Button } from "@nulo/design"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { NETWORK } from "@/lib/network"
import { TESTIDS } from "@/lib/testids"

const { address, isConnected, wrongChain, isConnecting, connect, disconnect, switchL1Network } = useL1Wallet()
</script>

<template>
	<section class="l1-chip" :data-testid="TESTIDS.l1Status" :data-connected="isConnected">
		<div v-if="isConnected && address" class="chip">
			<span class="label">Ethereum</span>
			<AddressDisplay :address="address ?? ''" :data-testid="TESTIDS.l1Account" />
			<button v-if="wrongChain" class="wrong-chain" type="button" :data-testid="TESTIDS.l1SwitchChain" @click="switchL1Network">
				Switch to {{ NETWORK.viemChain.name }}
			</button>
			<button class="disconnect" type="button" aria-label="Disconnect" :data-testid="TESTIDS.l1Disconnect" @click="disconnect">
				✕
			</button>
		</div>

		<Button v-else size="large" :loading="isConnecting" :disabled="isConnecting" :data-testid="TESTIDS.l1Connect" @click="connect">
			Connect Ethereum
		</Button>
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
	/* One 48px baseline across every wallet surface — the design system's `large` Button height,
	   which the connect buttons also use. The vertical padding is real so the inner address block
	   is inset from this border rather than pressed against it. */
	min-height: 48px;
	padding: 5px 12px;
	box-sizing: border-box;
	border: 1px solid var(--nulo-outline);
}

.chip .label {
	color: var(--txt-secondary);
	font: 500 11px/1 var(--font-mono);
	letter-spacing: 0.12em;
	text-transform: uppercase;
}

.wrong-chain {
	color: var(--yellow);
	font: 500 10px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	padding: 3px 6px;
	border: 1px solid var(--yellow);
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
