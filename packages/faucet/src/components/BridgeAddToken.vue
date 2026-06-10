<script setup lang="ts">
import { onBeforeUnmount } from "vue"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { useFaucetAddToken } from "@/composables/useFaucetAddToken"
import { useToast } from "@/composables/useToast"
import { BRIDGE_TOKEN } from "@/contracts/bridge-deployments"
import { TESTIDS } from "@/lib/testids"

// Reuses the generic registerToken composable, pointed at the BRIDGE's USDC - a different deployment
// from the faucet's USDC, so the faucet's own "Add to wallet" registers the wrong token here.
const bridge = useBridgeWallet()
const addToken = useFaucetAddToken()
const { push } = useToast()

// Tracked reset timer (mirrors TokenCard) - rapid clicks must not stack timers that flip the status
// back to idle mid-submission.
let resetTimer: ReturnType<typeof setTimeout> | null = null
function scheduleReset() {
	if (resetTimer !== null) clearTimeout(resetTimer)
	resetTimer = setTimeout(() => {
		resetTimer = null
		addToken.reset()
	}, 3_000)
}

async function handleAdd() {
	const wallet = bridge.wallet.value
	const account = bridge.selectedAccount.value
	if (!wallet || !account) return
	if (resetTimer !== null) {
		clearTimeout(resetTimer)
		resetTimer = null
	}
	await addToken.addToken(wallet, account, BRIDGE_TOKEN)
	const final = addToken.status.value
	if (final.kind === "ok") {
		push({ kind: "ok", text: "Bridged USDC added to your wallet." })
	} else if (final.kind === "error") {
		push({ kind: "error", text: final.error.message })
	} else if (final.kind === "unsupported") {
		push({ kind: "error", text: "Your wallet doesn't support adding tokens. Update Nulo and reload." })
	}
	// `rejected` is silent per the wallet-bridge cancel recipe.
	scheduleReset()
}

onBeforeUnmount(() => {
	if (resetTimer !== null) clearTimeout(resetTimer)
})
</script>

<template>
	<section v-if="bridge.status.value === 'connected'" class="bridge-add-token">
		<p class="label">Bridged USDC on Aztec is a separate token from the faucet's - add it so your wallet shows the balance.</p>
		<button
			type="button"
			class="add-btn"
			:disabled="addToken.status.value.kind === 'submitting'"
			:data-testid="TESTIDS.bridgeAddToken"
			:data-add-status="addToken.status.value.kind"
			aria-label="Add bridged USDC to your wallet"
			@click="handleAdd"
		>
			<template v-if="addToken.status.value.kind === 'submitting'">Adding…</template>
			<template v-else-if="addToken.status.value.kind === 'ok'">Added ✓</template>
			<template v-else>Add bridged USDC to wallet</template>
		</button>
	</section>
</template>

<style scoped>
.bridge-add-token {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.label {
	color: var(--txt-tertiary);
	font: 500 12px/1.4 var(--font-mono);
	margin: 0;
}

.add-btn {
	padding: 8px 12px;
	background: transparent;
	border: 1px dashed var(--nulo-outline);
	color: var(--txt-secondary);
	font: 500 12px/1.3 var(--font-mono);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	cursor: pointer;
	transition: border-color 0.15s ease, color 0.15s ease;
}

.add-btn:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.add-btn:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.add-btn[data-add-status="ok"] {
	border-color: var(--mint);
	color: var(--mint);
}
</style>
