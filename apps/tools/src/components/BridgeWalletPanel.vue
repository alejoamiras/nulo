<script setup lang="ts">
import { Button, Icon } from "@nulo/design"
import { computed } from "vue"
import { truncateName } from "@/composables/createAztecWalletSession"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { TESTIDS } from "@/lib/testids"
import AccountSwitcher from "./AccountSwitcher.vue"
import VerificationModal from "./VerificationModal.vue"

const {
	status,
	verificationEmojis,
	selectedAccount,
	error,
	preferredWalletName,
	connect,
	confirmVerification,
	cancelVerification,
	retryCapabilities,
	disconnect,
	switchWallet,
	autoReconnectDisabled,
} = useBridgeWallet()

const connectLabel = computed(() => {
	switch (status.value) {
		case "discovering":
			return "Searching for wallets…"
		case "choosing":
			return "Choose a wallet"
		case "verifying":
			return "Verify in wallet"
		case "capability-approval":
			return "Approve permissions"
		case "choosing-account":
			return "Choose your account"
		case "error":
			return "Retry connection"
		default:
			return "Connect Aztec"
	}
})

const showSplitConnect = computed(() => status.value === "idle" && preferredWalletName.value !== null && !autoReconnectDisabled.value)
const shortPreferredName = computed(() => (preferredWalletName.value ? truncateName(preferredWalletName.value, 20) : null))

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
		<AccountSwitcher
			v-if="status === 'connected' && selectedAccount"
			:address-testid="TESTIDS.bridgeL2Account"
			:disconnect-testid="TESTIDS.bridgeL2Disconnect"
		/>

		<div v-else-if="status === 'setting-up'" class="morph">
			<Button loading disabled>Setting up session…</Button>
		</div>

		<div
			v-else-if="status === 'capability-approval' || (status === 'error' && error?.category === 'capability-rejected')"
			class="morph"
		>
			<Button
				v-if="status === 'error'"
				class="denied"
				@click="retryCapabilities"
			>
				Permissions denied — try again
			</Button>
			<Button v-else class="waiting" loading @click="retryCapabilities">
				Approve in your wallet
			</Button>
		</div>

		<div v-else class="connect">
			<div v-if="showSplitConnect" class="split">
				<Button size="large" :data-testid="TESTIDS.bridgeL2Connect" @click="onClick">
					Connect {{ shortPreferredName }}
				</Button>
				<Button
					class="caret"
					size="large"
					aria-label="Choose a different wallet"
					:data-testid="TESTIDS.bridgeL2SwitchWallet"
					@click="switchWallet"
				>
					<Icon name="chevron" size="16" color="inverse" />
				</Button>
			</div>
			<Button
				v-else
				:class="{ denied: status === 'error' }"
				:loading="status === 'discovering'"
				:disabled="status === 'discovering' || status === 'choosing' || status === 'choosing-account'"
				:data-testid="TESTIDS.bridgeL2Connect"
				@click="onClick"
			>
				{{ connectLabel }}
			</Button>
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


.morph {
	display: inline-flex;
	flex-direction: column;
	gap: 8px;
	align-items: flex-start;
}

.waiting {
	animation: pulse 1.6s ease-in-out infinite;
}

@keyframes pulse {
	0%,
	100% {
		opacity: 1;
	}
	50% {
		opacity: 0.72;
	}
}

@media (prefers-reduced-motion: reduce) {
	.waiting {
		animation: none;
	}
}

.denied {
	background: transparent;
	color: var(--red);
	border: 2px solid var(--red);
}

.denied:hover {
	/* !important: the design Button's module rule `.primary:hover:not(...)`
	 * outranks this scoped selector and would restore the accent fill. */
	background: color-mix(in srgb, var(--red) 10%, transparent) !important;
	color: var(--red) !important;
}

.split {
	display: inline-flex;
}

.split > :first-child {
	border-right: 1px solid color-mix(in srgb, var(--txt-inverse) 25%, transparent);
}

.split .caret {
	min-width: 44px;
	padding: 0 12px;
}
</style>
