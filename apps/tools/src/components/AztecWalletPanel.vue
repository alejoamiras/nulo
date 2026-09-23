<script setup lang="ts">
/** Components */
import { Button, Icon } from "@nulo/design"
import AccountSwitcher from "./AccountSwitcher.vue"
import VerificationModal from "./VerificationModal.vue"

/** Composables */
import { truncateName } from "@/composables/createAztecWalletSession"
import { useWalletConnection } from "@/composables/useWalletConnection"

/** Utils */
import { computed } from "vue"
import { TESTIDS } from "@/lib/testids"

/**
 * The Aztec wallet chip: the connect state machine, the account switcher once connected, and the
 * emoji verification modal. Both sections read the ONE session singleton; the `variant` only picks
 * the testid set each smoke drives and whether the no-wallet state offers the install CTA (the
 * faucet is the front door for a visitor with no wallet; the bridge's strip explains instead).
 */
const props = withDefaults(defineProps<{ variant?: "faucet" | "bridge" }>(), { variant: "bridge" })

const IDS = {
	faucet: {
		root: TESTIDS.status,
		account: TESTIDS.account,
		disconnect: TESTIDS.btnDisconnect,
		connect: TESTIDS.btnConnect,
		switchWallet: TESTIDS.btnSwitchWallet,
		settingUp: TESTIDS.settingUp,
		capabilityApproval: TESTIDS.capabilityApproval,
		capabilityRetry: TESTIDS.btnCapabilityRetry,
	},
	bridge: {
		root: TESTIDS.bridgeL2Status,
		account: TESTIDS.bridgeL2Account,
		disconnect: TESTIDS.bridgeL2Disconnect,
		connect: TESTIDS.bridgeL2Connect,
		switchWallet: TESTIDS.bridgeL2SwitchWallet,
		settingUp: undefined,
		capabilityApproval: undefined,
		capabilityRetry: undefined,
	},
} as const
const ids = computed(() => IDS[props.variant])

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

const showConnectButton = computed(() => status.value !== "connected" && status.value !== "setting-up")
const showCapabilityApproval = computed(
	() => status.value === "capability-approval" || (status.value === "error" && error.value?.category === "capability-rejected"),
)
const showCapabilityError = computed(() => status.value === "error" && error.value?.category === "capability-rejected")
const showNoWalletCta = computed(() => props.variant === "faucet" && status.value === "error" && error.value?.category === "no-wallet")
const showSplitConnect = computed(() => status.value === "idle" && preferredWalletName.value !== null && !autoReconnectDisabled.value)
const shortPreferredName = computed(() => (preferredWalletName.value ? truncateName(preferredWalletName.value, 20) : null))

async function onClick() {
	if (status.value === "connected") await disconnect()
	else await connect()
}

function openInstall() {
	window.open(NULO_INSTALL_URL, "_blank", "noopener")
}
</script>

<template>
	<section class="panel" :data-testid="ids.root" :data-status="status">
		<AccountSwitcher v-if="status === 'connected' && selectedAccount" :address-testid="ids.account" :disconnect-testid="ids.disconnect" />

		<div v-else-if="status === 'setting-up'" class="morph" :data-testid="ids.settingUp">
			<Button loading disabled>Setting up session…</Button>
		</div>

		<div v-else-if="showCapabilityApproval" class="morph" :data-testid="ids.capabilityApproval">
			<Button v-if="showCapabilityError" class="denied" :data-testid="ids.capabilityRetry" @click="retryCapabilities">
				Permissions denied — try again
			</Button>
			<Button v-else class="waiting" loading :data-testid="ids.capabilityRetry" @click="retryCapabilities">
				Approve in your wallet
			</Button>
		</div>

		<div v-else-if="showNoWalletCta" class="no-wallet">
			<span class="no-wallet-note">No Aztec wallet detected on this browser.</span>
			<Button size="large" :data-testid="TESTIDS.btnInstallNulo" title="Nulo is an extension; it takes 30 seconds." @click="openInstall">
				Install Nulo
			</Button>
		</div>

		<div v-else class="connect">
			<div v-if="showConnectButton && showSplitConnect" class="split">
				<Button size="large" :data-testid="ids.connect" @click="onClick">Connect {{ shortPreferredName }}</Button>
				<Button class="caret" size="large" aria-label="Choose a different wallet" :data-testid="ids.switchWallet" @click="switchWallet">
					<Icon name="chevron" size="16" color="inverse" />
				</Button>
			</div>
			<Button
				v-else-if="showConnectButton"
				size="large"
				:class="{ denied: status === 'error' }"
				:loading="status === 'discovering'"
				:disabled="status === 'discovering' || status === 'choosing' || status === 'choosing-account'"
				:data-testid="ids.connect"
				@click="onClick"
			>
				{{ connectLabel }}
			</Button>
		</div>

		<VerificationModal :emojis="verificationEmojis" @confirm="confirmVerification" @cancel="cancelVerification" />
	</section>
</template>

<style scoped>
.panel {
	display: inline-flex;
	flex-direction: column;
	gap: 12px;
}

.no-wallet {
	display: inline-flex;
	align-items: center;
	gap: 12px;
}

.no-wallet-note {
	font: 500 11.5px/1.4 var(--font-mono);
	color: var(--txt-secondary);
	max-width: 22ch;
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
	/* !important: the design Button's module rule `.primary:hover:not(...)` outranks this scoped
	 * selector and would restore the accent fill. */
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
