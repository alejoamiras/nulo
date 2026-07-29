<script setup lang="ts">
import { computed } from "vue"
import { truncateName } from "@/composables/createAztecWalletSession"
import { useWalletConnection } from "@/composables/useWalletConnection"
import { TESTIDS } from "@/lib/testids"
import { AddressDisplay, Button } from "@nulo/design"
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
} = useWalletConnection()

const NULO_INSTALL_URL = import.meta.env.VITE_NULO_INSTALL_URL ?? "https://nulo.sh"

const connectLabel = computed(() => {
	switch (status.value) {
		case "idle":
			return "Connect wallet"
		case "discovering":
			return "Searching for wallets…"
		case "choosing":
			return "Choose a wallet"
		case "verifying":
			return "Verify in wallet"
		case "capability-approval":
			return "Approve permissions in wallet"
		case "choosing-account":
			return "Choose your account"
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
const showSplitConnect = computed(() => status.value === "idle" && preferredWalletName.value !== null && !autoReconnectDisabled.value)
const shortPreferredName = computed(() => (preferredWalletName.value ? truncateName(preferredWalletName.value, 20) : null))

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
		<div v-if="status === 'connected' && selectedAccount" class="chip">
			<span class="label">Aztec</span>
			<AddressDisplay :address="selectedAccount" :data-testid="TESTIDS.account" />
			<button
				class="disconnect"
				type="button"
				aria-label="Disconnect"
				:data-testid="TESTIDS.btnDisconnect"
				@click="disconnect"
			>
				✕
			</button>
		</div>

		<div v-else-if="showSettingUp" class="morph" :data-testid="TESTIDS.settingUp">
			<Button loading disabled>Setting up session…</Button>
		</div>

		<div v-else-if="showCapabilityApproval" class="morph" :data-testid="TESTIDS.capabilityApproval">
			<Button
				v-if="showCapabilityError"
				class="denied"
				:data-testid="TESTIDS.btnCapabilityRetry"
				@click="retryCapabilities"
			>
				Permissions denied — try again
			</Button>
			<Button
				v-else
				class="waiting"
				loading
				:data-testid="TESTIDS.btnCapabilityRetry"
				@click="retryCapabilities"
			>
				Approve in your wallet
			</Button>
		</div>

		<Flex v-else-if="showNoWalletCta" direction="column" gap="12" align="start" class="no-wallet">
			<h3>No Aztec wallet detected on this browser.</h3>
			<p>
				This faucet works with any wallet that speaks the Aztec Wallet SDK. Nulo is the fastest
				way to start - it's an extension, takes 30 seconds.
			</p>
			<Button :data-testid="TESTIDS.btnInstallNulo" @click="openInstall">
				Install Nulo
			</Button>
		</Flex>

		<div v-else class="connect">
			<div v-if="showConnectButton && showSplitConnect" class="split">
				<Button :data-testid="TESTIDS.btnConnect" @click="onClick">
					Connect {{ shortPreferredName }}
				</Button>
				<Button
					class="caret"
					aria-label="Choose a different wallet"
					:data-testid="TESTIDS.btnSwitchWallet"
					@click="switchWallet"
				>
					▾
				</Button>
			</div>
			<Button
				v-else-if="showConnectButton"
				:class="{ denied: status === 'error' }"
				:loading="status === 'discovering'"
				:disabled="status === 'discovering' || status === 'choosing' || status === 'choosing-account'"
				:data-testid="TESTIDS.btnConnect"
				@click="onClick"
			>
				{{ connectLabel }}
			</Button>
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

.no-wallet {
	max-width: 56ch;
}

.no-wallet h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 18px;
	color: var(--txt-primary);
}

.no-wallet p {
	color: var(--txt-secondary);
	font-size: 14px;
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
