<script setup lang="ts">
import { AddressDisplay, AppButton, Spinner } from "@nulo/design"
import { computed } from "vue"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { TESTIDS } from "@/lib/testids"
import VerificationModal from "./VerificationModal.vue"

const {
	status,
	verificationEmojis,
	selectedAccount,
	error,
	connect,
	confirmVerification,
	cancelVerification,
	retryCapabilities,
	disconnect,
} = useBridgeWallet()

const connectLabel = computed(() => {
	switch (status.value) {
		case "discovering":
			return "Searching for wallet…"
		case "verifying":
			return "Verify in wallet"
		case "capability-approval":
			return "Approve permissions"
		case "error":
			return "Retry connection"
		default:
			return "Connect Aztec"
	}
})

async function onClick() {
	if (status.value === "connected") {
		await disconnect()
	} else {
		await connect()
	}
}
</script>

<template>
	<section class="l2-panel" :data-testid="TESTIDS.bridgeL2Status" :data-status="status">
		<div v-if="status === 'connected' && selectedAccount" class="chip">
			<span class="label">Aztec</span>
			<AddressDisplay :address="selectedAccount" :data-testid="TESTIDS.bridgeL2Account" />
			<button
				class="disconnect"
				type="button"
				aria-label="Disconnect"
				:data-testid="TESTIDS.bridgeL2Disconnect"
				@click="disconnect"
			>
				✕
			</button>
		</div>

		<div v-else-if="status === 'setting-up'" class="setting-up">
			<Spinner :size="18" />
			<span>Setting up the bridge session…</span>
		</div>

		<div v-else-if="status === 'capability-approval'" class="capability">
			<p>Approve the bridge's permissions in your wallet - claim, exit, and balance reads on the bridge contracts.</p>
			<AppButton @click="retryCapabilities">Approve permissions</AppButton>
		</div>

		<div v-else class="connect">
			<AppButton :loading="status === 'discovering'" :data-testid="TESTIDS.bridgeL2Connect" @click="onClick">
				{{ connectLabel }}
			</AppButton>
			<p v-if="status === 'error' && error" class="error-hint">{{ error.message }}</p>
		</div>

		<VerificationModal :emojis="verificationEmojis" @confirm="confirmVerification" @cancel="cancelVerification" />
	</section>
</template>

<style scoped>
.l2-panel {
	display: inline-flex;
	flex-direction: column;
	gap: 12px;
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

.setting-up {
	display: inline-flex;
	align-items: center;
	gap: 12px;
	color: var(--txt-secondary);
	font: 500 13px/1 var(--font-mono);
	letter-spacing: 0.04em;
}

.capability {
	display: flex;
	flex-direction: column;
	gap: 12px;
	align-items: flex-start;
	max-width: 56ch;
}

.capability p {
	color: var(--txt-secondary);
	font-size: 14px;
}

.error-hint {
	color: var(--red);
	font-size: 13px;
	margin-top: 8px;
}
</style>
