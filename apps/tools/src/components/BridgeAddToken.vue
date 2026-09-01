<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { useAddDripToken } from "@/composables/useAddDripToken"
import { useToast } from "@/composables/useToast"
import { BRIDGE_TOKEN, BRIDGE_TOKEN_DECIMALS, BRIDGE_TOKEN_SYMBOL, L1_USDC } from "@/contracts/bridge-deployments"
import { TESTIDS } from "@/lib/testids"

// Reuses the generic registerToken composable, pointed at the BRIDGE token - a different deployment
// from the Drip tab's drips, so its own "Add to wallet" registers the wrong token here.
const bridge = useBridgeWallet()
const l1 = useL1Wallet()
const addToken = useAddDripToken()
const { push } = useToast()

// EVM wallets expose no is-watched introspection (EIP-747 is fire-and-forget), so this button
// only hides after a successful add THIS session.
const evmAdding = ref(false)
const evmAdded = ref(false)
async function handleAddEvm() {
	const wallet = l1.ensureWalletClient()
	if (!wallet || evmAdding.value) return
	evmAdding.value = true
	try {
		const ok = await wallet.watchAsset({
			type: "ERC20",
			options: { address: L1_USDC, symbol: BRIDGE_TOKEN_SYMBOL, decimals: BRIDGE_TOKEN_DECIMALS },
		})
		if (ok) {
			evmAdded.value = true
			push({ kind: "ok", text: `${BRIDGE_TOKEN_SYMBOL} added to your Ethereum wallet.` })
		}
	} catch (e) {
		push({ kind: "error", text: e instanceof Error ? e.message : "The wallet declined the request." })
	} finally {
		evmAdding.value = false
	}
}

// Hidden once the wallet says the token is registered (the capability-gated probe). Fail-open:
// any failure keeps the button - a broken probe must never remove functionality.
const registered = ref(false)
watch(
	() => [bridge.status.value, bridge.wallet.value] as const,
	async ([status, wallet]) => {
		registered.value = status === "connected" && wallet ? await addToken.isRegistered(wallet, BRIDGE_TOKEN) : false
	},
	{ immediate: true },
)

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
		registered.value = true
		push({ kind: "ok", text: `${BRIDGE_TOKEN_SYMBOL} added to your wallet.` })
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
	<section v-if="bridge.status.value === 'connected' || l1.isConnected.value" class="bridge-add-token">
		<p class="label">{{ BRIDGE_TOKEN_SYMBOL }} exists on BOTH chains - add it to each wallet so balances show.</p>
		<div class="buttons">
			<button
				v-if="bridge.status.value === 'connected'"
				type="button"
				class="add-btn"
				:class="{ checked: registered }"
				:disabled="registered || addToken.status.value.kind === 'submitting'"
				:data-testid="TESTIDS.bridgeAddToken"
				:data-add-status="registered ? 'registered' : addToken.status.value.kind"
				:title="registered ? 'Your Aztec wallet confirmed this token is registered - Ethereum wallets cannot answer that.' : undefined"
				aria-label="Add the bridged token to your Aztec wallet"
				@click="handleAdd"
			>
				<template v-if="registered">{{ BRIDGE_TOKEN_SYMBOL }} in Aztec wallet ✓</template>
				<template v-else-if="addToken.status.value.kind === 'submitting'">Adding…</template>
				<template v-else>Add {{ BRIDGE_TOKEN_SYMBOL }} to Aztec wallet</template>
			</button>
			<button
				v-if="l1.isConnected.value && !evmAdded"
				type="button"
				class="add-btn"
				:disabled="evmAdding"
				:data-testid="TESTIDS.bridgeAddTokenEvm"
				aria-label="Add the bridged token to your Ethereum wallet"
				@click="handleAddEvm"
			>
				{{ evmAdding ? "Adding…" : `Add ${BRIDGE_TOKEN_SYMBOL} to Ethereum wallet` }}
			</button>
		</div>
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

.buttons {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.add-btn.checked {
	border-color: var(--mint);
	color: var(--mint);
	cursor: default;
	opacity: 1;
}
</style>
