<script setup>
/**
 * First-receive friction popup. Fires when the IncomingTransferService
 * encounters a note from a contract whose IncomingTrustState is `unknown`.
 *
 * Trust-state machine (per `(profileId, networkId, contract)`):
 *   unknown → first note → pending (record hidden, this popup opens)
 *   user Allow → trusted (queued hidden records flip visible atomically)
 *   user Reject → blocked (queued records stay hidden permanently)
 *
 * Defense against the `aztec_registerToken` pollution vector flagged by
 * codex / opus: even after a malicious dApp socially-engineers the user
 * into adding a fake-USDC contract, the FIRST incoming note from that
 * contract requires an explicit second confirmation here showing the
 * contract address.
 *
 * Caller (`PopupManager`) sets:
 *   cacheStore.incomingTrust = {
 *     tokenSymbol, tokenDecimals, amountRaw, contract,
 *     allow: () => service.setTrustAllow(profileId, networkId, contract),
 *     reject: () => service.setTrustReject(profileId, networkId, contract),
 *   }
 */

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useCacheStore } from "@/stores/cache.store.ts"
import { usePopupStore } from "@/stores/popup.store"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"
import { trimAddress } from "@/utils/string"

const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const emit = defineEmits(["onClose"])
defineProps({
	show: Boolean,
})

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.incoming_trust?.order
})

const tokenSymbol = computed(() => cacheStore.incomingTrust.tokenSymbol ?? "Token")
const contractSlice = computed(() => {
	const c = cacheStore.incomingTrust.contract
	return c ? trimAddress(c, 6, 4) : ""
})
const formattedAmount = computed(() => {
	const raw = cacheStore.incomingTrust.amountRaw
	if (!raw) return ""
	const decimals = cacheStore.incomingTrust.tokenDecimals ?? 0
	return balanceFormatted(raw, decimals, 8).value
})

async function handleAllow() {
	try {
		await cacheStore.incomingTrust.allow?.()
		openToast({ label: `Now showing receives for ${tokenSymbol.value}`, icon: "check" })
	} catch {
		openToast({ label: "Couldn't update trust state", icon: "warning" })
	}
	emit("onClose")
}

async function handleReject() {
	try {
		await cacheStore.incomingTrust.reject?.()
		openToast({ label: `Hiding receives from ${tokenSymbol.value}`, icon: "info" })
	} catch {
		openToast({ label: "Couldn't update trust state", icon: "warning" })
	}
	emit("onClose")
}

watch(
	() => $props,
	() => {},
)
</script>

<template>
	<Popup :show :displaceIdx="popupStore.popups.incoming_trust?.order" @onClose="emit('onClose')">
		<PopupCard :displaceIdx>
			<Flex direction="column" gap="24" :class="$style.wrapper" wide>
				<Flex direction="column" align="center" gap="12" :class="$style.header">
					<Icon name="download" size="20" color="primary" />
					<span :class="$style.pre_title">First receive</span>
					<h2 :class="$style.title">Allow {{ tokenSymbol }}?</h2>
					<Text size="13" weight="500" color="body" height="150" align="center">
						You received <strong>{{ formattedAmount }} {{ tokenSymbol }}</strong> from a contract you haven't seen before.
					</Text>
				</Flex>

				<Flex direction="column" gap="6" :class="$style.contract_row">
					<span :class="$style.contract_label">CONTRACT</span>
					<span :class="$style.contract_value" data-testid="incoming-trust-contract">{{ contractSlice }}</span>
				</Flex>

				<Text size="11" color="tertiary" height="150" align="center" :class="$style.warning">
					A contract you don't recognize could be a scam token with a familiar-looking symbol. Verify the contract address before allowing.
				</Text>

				<Flex gap="12">
					<Button
						@click="handleReject"
						wide
						variant="primary_outline"
						size="medium"
						data-testid="incoming-trust-reject"
					>
						Block
					</Button>
					<Button
						@click="handleAllow"
						wide
						size="medium"
						data-testid="incoming-trust-allow"
					>
						Allow
					</Button>
				</Flex>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	padding: 0 20px 24px 20px;
}
.header {
	padding-top: 4px;
}
.pre_title {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}
.title {
	font-family: var(--font-headline);
	font-size: 16px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	text-align: center;
	color: var(--txt-primary);
	margin: 0;
	max-width: 280px;
}
.contract_row {
	padding: 12px;
	border: 1px solid var(--nulo-border);
	background: var(--nulo-surface-low);
}
.contract_label {
	font-family: var(--font-mono);
	font-size: 9px;
	font-weight: 600;
	letter-spacing: 0.14em;
	color: var(--txt-tertiary);
}
.contract_value {
	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--txt-primary);
	word-break: break-all;
}
.warning {
	padding: 0 8px;
}
:global([theme="light"]) .pre_title {
	color: var(--txt-secondary);
}
</style>
