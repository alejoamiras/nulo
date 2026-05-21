<script setup lang="ts">
import { computed } from "vue"
import { useWalletConnection } from "@/composables/useWalletConnection"
import { TESTIDS } from "@/lib/testids"
import AddressDisplay from "./composite/AddressDisplay.vue"
import AppButton from "./ui/AppButton.vue"
import Spinner from "./ui/Spinner.vue"
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
} = useWalletConnection()

const NULO_INSTALL_URL = import.meta.env.VITE_NULO_INSTALL_URL ?? "https://chromewebstore.google.com/"

const connectLabel = computed(() => {
	switch (status.value) {
		case "idle":
			return "Connect wallet"
		case "discovering":
			return "Searching for wallet…"
		case "verifying":
			return "Verify in wallet"
		case "capability-approval":
			return "Approve permissions in wallet"
		case "error":
			return "Retry connection"
		default:
			return "Connect wallet"
	}
})

const showConnectButton = computed(() => status.value !== "connected" && status.value !== "setting-up")
const showCapabilityApproval = computed(
	() => status.value === "capability-approval" || (status.value === "error" && error.value?.category === "capability-rejected"),
)
const showCapabilityError = computed(() => status.value === "error" && error.value?.category === "capability-rejected")
const showNoWalletCta = computed(() => status.value === "error" && error.value?.category === "no-wallet")
const showSettingUp = computed(() => status.value === "setting-up")

async function onClick() {
	if (status.value === "connected") {
		await disconnect()
	} else {
		await connect()
	}
}

function openInstall() {
	window.open(NULO_INSTALL_URL, "_blank", "noopener")
}
</script>

<template>
	<section class="panel" :data-testid="TESTIDS.status" :data-status="status">
		<div v-if="status === 'connected' && selectedAccount" class="connected">
			<span class="label">Connected</span>
			<AddressDisplay :address="selectedAccount" :data-testid="TESTIDS.account" />
			<span class="chain">alpha-testnet</span>
			<button
				class="disconnect"
				type="button"
				:data-testid="TESTIDS.btnDisconnect"
				@click="disconnect"
			>
				Disconnect
			</button>
		</div>

		<div v-else-if="showSettingUp" class="setting-up" :data-testid="TESTIDS.settingUp">
			<Spinner :size="18" />
			<span>Setting up your session…</span>
		</div>

		<div v-else-if="showCapabilityApproval" class="capability" :data-testid="TESTIDS.capabilityApproval">
			<h3>Awaiting permissions</h3>
			<p>
				Approve this faucet's permissions in your wallet. We're asking to read your balances and
				submit drip transactions to the Dripper contract — nothing else.
			</p>
			<p v-if="showCapabilityError" class="hint">You denied the permissions. Click to try again.</p>
			<AppButton :data-testid="TESTIDS.btnCapabilityRetry" @click="retryCapabilities">
				Approve permissions
			</AppButton>
		</div>

		<div v-else-if="showNoWalletCta" class="no-wallet">
			<h3>No Aztec wallet detected on this browser.</h3>
			<p>
				This faucet works with any wallet that speaks the Aztec Wallet SDK. Nulo is the fastest
				way to start — it's an extension, takes 30 seconds.
			</p>
			<AppButton :data-testid="TESTIDS.btnInstallNulo" @click="openInstall">
				Install Nulo
			</AppButton>
		</div>

		<div v-else class="connect">
			<AppButton
				v-if="showConnectButton"
				:loading="status === 'discovering'"
				:data-testid="TESTIDS.btnConnect"
				@click="onClick"
			>
				{{ connectLabel }}
			</AppButton>
			<p v-if="status === 'error' && error?.category !== 'no-wallet' && error?.category !== 'capability-rejected'" class="error-hint">
				{{ error?.message }}
			</p>
		</div>

		<VerificationModal
			:emojis="verificationEmojis"
			@confirm="confirmVerification"
			@cancel="cancelVerification"
		/>
	</section>
</template>

<style scoped>
.panel {
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

.connected .chain {
	color: var(--mint);
	font: 500 11px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	padding: 4px 8px;
	border: 1px solid var(--mint);
}

.disconnect {
	margin-left: auto;
	color: var(--txt-secondary);
	font-size: 13px;
	text-decoration: underline;
	text-underline-offset: 3px;
}

.disconnect:hover {
	color: var(--txt-primary);
}

.capability,
.no-wallet {
	display: flex;
	flex-direction: column;
	gap: 12px;
	align-items: flex-start;
	max-width: 56ch;
}

.setting-up {
	display: inline-flex;
	align-items: center;
	gap: 12px;
	color: var(--txt-secondary);
	font: 500 13px/1 var(--font-mono);
	letter-spacing: 0.04em;
}

.capability h3,
.no-wallet h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 18px;
	color: var(--txt-primary);
}

.capability p,
.no-wallet p {
	color: var(--txt-secondary);
	font-size: 14px;
}

.capability .hint {
	color: var(--yellow);
}

.error-hint {
	color: var(--red);
	font-size: 13px;
	margin-top: 8px;
}
</style>
