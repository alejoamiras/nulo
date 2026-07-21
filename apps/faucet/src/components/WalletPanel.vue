<script setup lang="ts">
import { computed } from "vue"
import { useWalletConnection } from "@/composables/useWalletConnection"
import { TESTIDS } from "@/lib/testids"
import { AddressDisplay, Button, Spinner } from "@nulo/design"
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
	forgetPreferredWallet,
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

/** A2: switching never requires a manual disconnect — forget + disconnect in
 *  one action; the next Connect runs a fresh pick. */
async function switchWallet() {
	forgetPreferredWallet()
	if (status.value === "connected") {
		await disconnect()
	}
	await connect()
}
</script>

<template>
	<section class="panel" :data-testid="TESTIDS.status" :data-status="status">
		<div v-if="status === 'connected' && selectedAccount" class="chip">
			<span class="label">Aztec</span>
			<AddressDisplay :address="selectedAccount" :data-testid="TESTIDS.account" />
			<button
				class="switch-link in-chip"
				type="button"
				:data-testid="TESTIDS.btnSwitchWallet"
				@click="switchWallet"
			>
				switch
			</button>
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

		<div v-else-if="showSettingUp" class="setting-up" :data-testid="TESTIDS.settingUp">
			<Spinner :size="18" />
			<span>Setting up your session…</span>
		</div>

		<Flex v-else-if="showCapabilityApproval" direction="column" gap="12" align="start" class="capability" :data-testid="TESTIDS.capabilityApproval">
			<h3>Awaiting permissions</h3>
			<p>
				Approve this faucet's permissions in your wallet. We're asking to read your balances and
				submit drip transactions to the Dripper contract - nothing else.
			</p>
			<p v-if="showCapabilityError" class="hint">You denied the permissions. Click to try again.</p>
			<Button :data-testid="TESTIDS.btnCapabilityRetry" @click="retryCapabilities">
				Approve permissions
			</Button>
		</Flex>

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
			<Button
				v-if="showConnectButton"
				:loading="status === 'discovering'"
				:disabled="status === 'discovering' || status === 'choosing'"
				:data-testid="TESTIDS.btnConnect"
				@click="onClick"
			>
				{{ connectLabel }}
			</Button>
			<p v-if="status === 'idle' && preferredWalletName" class="preferred-hint" :data-testid="TESTIDS.preferredWalletHint">
				Reconnects to {{ preferredWalletName }} ·
				<button type="button" class="switch-link" :data-testid="TESTIDS.btnSwitchWallet" @click="switchWallet">
					use a different wallet
				</button>
			</p>
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

.capability,
.no-wallet {
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

.preferred-hint {
	color: var(--txt-secondary);
	font-size: 11px;
}

.switch-link {
	background: none;
	border: none;
	color: var(--txt-secondary);
	font: 600 11px/1 var(--font-mono);
	cursor: pointer;
	text-decoration: underline;
	text-underline-offset: 3px;
	padding: 2px 0;
}

.switch-link:hover {
	color: var(--txt-primary);
}

.switch-link.in-chip {
	text-decoration: none;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	font-size: 10px;
}

.error-hint {
	color: var(--red);
	font-size: 13px;
	margin-top: 8px;
}
</style>
