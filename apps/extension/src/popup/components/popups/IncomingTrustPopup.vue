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
import { copyToClipboard } from "@/utils/clipboard"
import { trimAddress } from "@/utils/string"
import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"

const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.incoming_trust?.order
})

// F-009 / Phase 6: tokenSymbol comes from the on-chain contract (attacker-
// controlled if they deployed it). Route through sanitizeWireString to strip
// bidi overrides, zero-width chars, and other Unicode tricks that could
// disguise a phishing token as a familiar symbol (e.g. Cyrillic "с" in "USDC").
const tokenSymbol = computed(() => sanitizeWireString(cacheStore.incomingTrust.tokenSymbol ?? "Token", 32))
const contractFull = computed(() => cacheStore.incomingTrust.contract ?? "")
const contractSlice = computed(() => (contractFull.value ? trimAddress(contractFull.value, 6, 4) : ""))
const formattedAmount = computed(() => {
	const raw = cacheStore.incomingTrust.amountRaw
	if (!raw) return ""
	const decimals = cacheStore.incomingTrust.tokenDecimals ?? 0
	return balanceFormatted(raw, decimals, 8).value
})

// Verification surface: keyboard-reachable expand toggle + copy. Without
// these as real <button> elements, a keyboard-only user couldn't get to
// the contract address at all (the previous static <span> was inert).
const expanded = ref(false)
const expandToggleRef = ref(null)

function toggleExpanded() {
	expanded.value = !expanded.value
}

async function handleCopy() {
	const value = contractFull.value
	if (!value) return
	await copyToClipboard(value, openToast, {
		success: { label: "Contract address copied", duration: 1_500 },
		failure: { label: "Couldn't copy address", icon: "warning" },
	})
}

// B-26: a shared submit latch. Without it, double-clicking Allow/Block fires two
// decisions: the first closes this prompt (PopupManager then dequeues the NEXT
// one), and the second's `emit("onClose")` then closes THAT next prompt the user
// never decided on. The latch drops re-entry while a decision is in flight; the
// key guard below is the second line of defense.
const isSubmitting = ref(false)

// The identifying triple of the CURRENTLY-displayed prompt. Captured at handler
// entry and re-checked before `emit("onClose")` so a decision that completes
// after the active identity switched (PopupManager reassigns
// `cacheStore.incomingTrust`) can't close whatever prompt is showing now.
function payloadKey() {
	const t = cacheStore.incomingTrust
	return `${t.profileId ?? ""}|${t.networkId ?? ""}|${t.contract ?? ""}`
}

async function handleAllow() {
	if (isSubmitting.value) return
	isSubmitting.value = true
	// B-28: capture the label + key BEFORE awaiting. The active identity can
	// switch mid-RPC, reassigning `cacheStore.incomingTrust`, which would make
	// `tokenSymbol.value` resolve against the NEXT payload.
	const symbol = tokenSymbol.value
	const key = payloadKey()
	try {
		// setTrustAllow returns true when the trust flip was applied, false
		// when the service refused (stale-popup race — token deleted between
		// Pending emit and click), undefined if the closure wasn't bound.
		// Show the success toast ONLY on explicit true so an IPC boundary
		// that drops the return value (defensive — codex final-audit High)
		// doesn't mislead the user.
		const ok = await cacheStore.incomingTrust.allow?.()
		if (ok === true) {
			openToast({ label: `Now showing receives for ${symbol}`, icon: "check" })
		}
	} catch {
		openToast({ label: "Couldn't update trust state", icon: "warning" })
	} finally {
		isSubmitting.value = false
	}
	if (payloadKey() === key) emit("onClose")
}

async function handleReject() {
	if (isSubmitting.value) return
	isSubmitting.value = true
	const symbol = tokenSymbol.value
	const key = payloadKey()
	try {
		const ok = await cacheStore.incomingTrust.reject?.()
		if (ok === true) {
			openToast({ label: `Hiding receives from ${symbol}`, icon: "info" })
		}
	} catch {
		openToast({ label: "Couldn't update trust state", icon: "warning" })
	} finally {
		isSubmitting.value = false
	}
	if (payloadKey() === key) emit("onClose")
}

// Initial focus on the expand toggle so a keyboard-only user lands on
// the verification surface first — they should be reading the contract
// address before they choose Allow or Block. Reset the expanded state
// each time the popup re-opens so a previous expansion doesn't bleed
// across separate contracts.
watch(
	() => props.show,
	async (show) => {
		if (!show) {
			expanded.value = false
			return
		}
		// Fresh prompt (the component instance is reused across the queue) — clear
		// any latch left set by the previous decision's in-flight submit.
		isSubmitting.value = false
		await nextTick()
		expandToggleRef.value?.focus()
	},
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
					<button
						ref="expandToggleRef"
						type="button"
						:class="$style.contract_button"
						:aria-expanded="expanded"
						:aria-controls="expanded ? 'incoming-trust-contract-full' : undefined"
						data-testid="incoming-trust-contract-expand"
						@click="toggleExpanded"
					>
						<span :class="$style.contract_value" data-testid="incoming-trust-contract">{{ contractSlice }}</span>
						<Icon
							name="chevron"
							size="10"
							color="tertiary"
							:style="{
								transform: `rotate(${expanded ? '180' : '0'}deg)`,
								transition: 'transform 0.2s ease',
							}"
						/>
					</button>
					<div
						v-show="expanded"
						id="incoming-trust-contract-full"
						:class="$style.contract_full_row"
					>
						<span :class="$style.contract_full" data-testid="incoming-trust-contract-full">{{ contractFull }}</span>
						<button
							type="button"
							:class="$style.copy_button"
							aria-label="Copy contract address"
							data-testid="incoming-trust-contract-copy"
							@click="handleCopy"
						>
							<Icon name="copy" size="14" color="primary" />
						</button>
					</div>
				</Flex>

				<Text size="11" color="tertiary" height="150" align="center" :class="$style.warning">
					A contract you don't recognize could be a scam token with a familiar-looking symbol. Verify the contract address before allowing.
				</Text>

				<Flex gap="12">
					<Button
						@click="handleReject"
						:disabled="isSubmitting"
						wide
						variant="primary_outline"
						size="medium"
						data-testid="incoming-trust-reject"
					>
						Block
					</Button>
					<Button
						@click="handleAllow"
						:disabled="isSubmitting"
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
.contract_button {
	all: unset;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	cursor: pointer;
	padding: 2px 0;
	width: 100%;
}
.contract_button:focus-visible {
	outline: 2px solid var(--nulo-accent);
	outline-offset: 2px;
}
.contract_full_row {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	margin-top: 6px;
	padding-top: 6px;
	border-top: 1px solid var(--nulo-border);
}
.contract_full {
	flex: 1;
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--txt-primary);
	word-break: break-all;
	line-height: 1.5;
}
.copy_button {
	all: unset;
	cursor: pointer;
	padding: 4px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}
.copy_button:focus-visible {
	outline: 2px solid var(--nulo-accent);
	outline-offset: 2px;
}
.warning {
	padding: 0 8px;
}
:global([theme="light"]) .pre_title {
	color: var(--txt-secondary);
}
</style>
