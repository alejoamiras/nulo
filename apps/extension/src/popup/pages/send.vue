<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */
import AmountCard from "@/components/composite/send/AmountCard.vue"
import FeeSettingsCard from "@/popup/components/modules/send/FeeSettingsCard.vue"
import RecipientField from "@/popup/components/modules/send/RecipientField.vue"
import SelectTokenCard from "@/popup/components/modules/send/SelectTokenCard.vue"
import SendTypesCard from "@/components/composite/send/SendTypesCard.vue"

/** Services */
import { ContactServiceClient } from "@/wallet/services/contact/client"
import { ExecutionServiceClient } from "@/wallet/services/execution/client"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { TokenServiceClient } from "@/wallet/services/token/client"
import { PriceServiceClient } from "@/wallet/services/price/client"
import { proxyTickerFor } from "@/wallet/services/price/price-map"
import { TransferType } from "@/wallet/services/transaction/client"

/** Utils */
import { isValidHex } from "@/utils/string"
import { validateSendAmount } from "@/popup/pages/send-amount"
import { evaluateFiatGate } from "@/popup/pages/send-fiat-gate"
import { classifyCancellableRejection } from "@/popup/utils/cancellable-rejection"

/** Composables */
import { useToast } from "@/composables/toast.js"
import { useFeeEstimation } from "@/composables/useFeeEstimation"
import { usePrices } from "@/composables/usePrices"
import { useTicker } from "@/composables/ticker"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()

const route = useRoute()
const router = useRouter()

/** Post-send / forced-close navigation. Prefers browser history so the user
 *  returns to whichever surface launched Send (token detail, contacts, home);
 *  falls back to /popup/general for cold-open / deep-link. */
function leaveSend() {
	if (window.history.length > 1) {
		router.back()
	} else {
		router.replace("/popup/general")
	}
}

const feeSettings = ref()

const awaitingNewToken = ref(false)

const tokenService = new TokenServiceClient()
tokenService.onTokenAdded.add(onTokenAdded)
tokenService.onTokenDeleted.add(onTokenDeleted)
function onTokenAdded(token) {
	tokens.value.push(token)
}
function onTokenDeleted(token) {
	const idx = tokens.value.findIndex((t) => t.id === token.id)
	if (idx === -1) return

	tokens.value.splice(idx, 1)

	if (activeToken.value?.id !== token.id) return

	if (tokens.value?.length) {
		cacheStore.activeTokenIdx = tokens.value[0].id
		return
	}

	openToast({ label: "The last token has just been deleted" })

	leaveSend()
}

const tokens = ref([])
const activeToken = computed(() => tokens.value?.find((t) => t.id === cacheStore.activeTokenIdx))
const isBlockedTransfer = computed(() => !activeToken.value?.hasPrivateTransfers && !activeToken.value?.hasPublicTransfers)

const tokenBalanceService = new TokenBalanceServiceClient()
tokenBalanceService.onTokenBalanceAdded.add(onBalanceAdded)
tokenBalanceService.onTokenBalanceUpdated.add(onBalanceUpdated)
function onBalanceAdded(balance) {
	if (balance.account !== appStore.account.address) return

	tokenBalance.push(balance)
}
function onBalanceUpdated(balance) {
	const idx = tokenBalances.value.findIndex((tb) => tb.id === balance.id)
	if (idx === -1) return

	tokenBalances.value[idx] = balance
}

const tokenBalances = ref([])
const tokenBalance = computed(() => {
	return tokenBalances.value?.find((b) => b?.token.id === cacheStore.activeTokenIdx)
})
const tokenBalanceByType = computed(() => {
	if (!tokenBalance.value) return 0
	return selectedSendType.value === "private"
		? tokenBalance.value.privateBalance / 10 ** activeToken.value.decimals
		: tokenBalance.value.publicBalance / 10 ** activeToken.value.decimals
})

const selectedSendType = ref("private")
const selectedReceiverType = ref("private")
const initSendType = () => {
	if (!activeToken.value) return
	if (cacheStore.preselectedBalanceType && activeToken.value.hasPrivateTransfers && activeToken.value.hasPublicTransfers) {
		selectedSendType.value = cacheStore.preselectedBalanceType
	}

	if (!activeToken.value.hasPrivateTransfers) {
		selectedSendType.value = "public"
	}

	if (!activeToken.value.hasPublicTransfers) {
		selectedSendType.value = "private"
	}
}
const initReceiverType = () => {
	if (!activeToken.value) return
	if (cacheStore.preselectedBalanceType && activeToken.value.hasPrivateBalances && activeToken.value.hasPublicBalances) {
		selectedReceiverType.value = cacheStore.preselectedBalanceType
	}

	if (!activeToken.value.hasPrivateTransfers) {
		selectedReceiverType.value = "public"
	}

	if (!activeToken.value.hasPublicTransfers) {
		selectedReceiverType.value = "private"
	}
}

const contactService = new ContactServiceClient()
contactService.onContactAdded.add(onContactAdded)
contactService.onContactUpdated.add(onContactUpdated)
contactService.onContactDeleted.add(onContactDeleted)
function onContactAdded(contact) {
	contacts.value.push(contact)
}
function onContactUpdated(contact) {
	const idx = contacts.value.findIndex((c) => c.id === contact.id)
	if (idx !== -1) {
		contacts.value[idx] = contact
	} else {
		contacts.value.push(contact)
	}
}
function onContactDeleted(contact) {
	contacts.value = contacts.value.filter((c) => c.id !== contact.id)
}

const contacts = ref([])
const selectedContact = ref()
const searchTerm = ref("")
const recipientCandidates = computed(() => [...contacts.value, ...appStore.accounts])

const amountTerm = ref()

const isValidAddress = computed(() => isValidHex(searchTerm.value))

/** Raw balance (base units) for the currently-selected send type.
 *  Returned as a string straight from `tokenBalance.{public,private}Balance`
 *  so we never round-trip through JS-number math. */
const balanceRaw = computed(() => {
	if (!tokenBalance.value) return undefined
	return selectedSendType.value === "private" ? tokenBalance.value.privateBalance : tokenBalance.value.publicBalance
})

/** Single source of truth for "is the typed amount valid?". Drives
 *  both the Submit gate AND the estimate-watcher (which consumes the
 *  resulting `integerized: bigint` directly). */
const amountValidation = computed(() =>
	validateSendAmount({
		input: typeof amountTerm.value === "string" ? amountTerm.value : amountTerm.value?.toString(),
		tokenDecimals: activeToken.value?.decimals,
		balanceRaw: balanceRaw.value,
	}),
)

/** C3 live pricing. The card freezes a session quote when fiat mode starts;
 *  the SUBMIT GATE lives here (this page owns handleSend) and fails closed. */
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)
const liveQuote = computed(() => prices.quoteFor(activeToken.value?.chainId, activeToken.value?.contract) ?? null)
const proxyTicker = computed(() => (liveQuote.value ? (proxyTickerFor(liveQuote.value.coingeckoId) ?? null) : null))

const fiatMode = ref(false)
const fiatGuard = ref(null)
const amountCardRef = useTemplateRef("amountCardRef")

/** Pure, unit-tested gate (send-fiat-gate.ts) — fail-closed by construction. */
const gateNow = useTicker(30_000)
const fiatGate = computed(() =>
	evaluateFiatGate({
		fiatMode: fiatMode.value,
		guard: fiatGuard.value,
		liveUsd: liveQuote.value?.usd ?? null,
		now: gateNow.value ?? Date.now(),
	}),
)
const fiatQuoteBlocked = computed(() => !fiatGate.value.ok)
/** Distinguishes "needs explicit re-confirmation" from "just converting". */
const fiatNeedsRequote = computed(() => !fiatGate.value.ok && fiatGate.value.requote)
const handleRequote = () => {
	// Re-freezes at the current quote and re-derives the token amount — the
	// user sees the NEW derived amount on the card before confirming.
	amountCardRef.value?.refreezeQuote()
}

const isAllowedToSend = computed(() => {
	if (!amountTerm.value) return false
	if (isBlockedTransfer.value) return false
	if (!isValidAddress.value) return false
	if (!feeSettings.value) return false
	if (fiatQuoteBlocked.value) return false
	return amountValidation.value.valid
})

const transferType = computed(() => {
	if (selectedSendType.value === "private" && selectedReceiverType.value === "private") return TransferType.Private
	if (selectedSendType.value === "private" && selectedReceiverType.value === "public") return TransferType.PrivateToPublic
	if (selectedSendType.value === "public" && selectedReceiverType.value === "private") return TransferType.PublicToPrivate
	if (selectedSendType.value === "public" && selectedReceiverType.value === "public") return TransferType.Public
	return undefined
})

const executionService = new ExecutionServiceClient()

// Per-mount instance id so the in-app log viewer can pin which Send
// page mount initiated each estimate / submit. Helps diagnose
// "extension wedge" reports — if a simulate fires while no instance
// is active, the call originated outside the popup (SW-side retry,
// dApp re-request, etc).
const sendInstanceId = Math.random().toString(36).slice(2, 8)

const {
	result: feeEstimate,
	isEstimating,
	estimate: scheduleFeeEstimate,
	cancel: cancelFeeEstimate,
} = useFeeEstimation({
	debounceMs: 800,
	estimate: ({ networkId, accountAddress, tokenId, transferType: tt, destination, amount, settings }) => {
		console.log(`[send:${sendInstanceId}] estimateTransferFee firing`)
		return executionService.estimateTransferFee(networkId, accountAddress, tokenId, tt, destination, amount, settings)
	},
	onError: (err) => {
		console.error(`[send:${sendInstanceId}] estimateTransferFee failed:`, err)
		openToast({ label: "Couldn't estimate fee — retry.", icon: "warning", color: "red" }, TOAST_DURATION.LONG)
	},
})
const isSending = ref(false)

/** Set true if the user navigates away manually during the short
 *  "Confirming..." window — prevents a second router.back() from firing. */
let cancelled = false

const handleSend = async () => {
	if (!isAllowedToSend.value || isSending.value) return
	if (!amountValidation.value.valid) return
	// The reactive gate runs on a 30s ticker — re-evaluate at TRUE wall-clock
	// on the actual click so a snapshot cannot slip through expiry/drift by up
	// to one tick.
	const submitGate = evaluateFiatGate({
		fiatMode: fiatMode.value,
		guard: fiatGuard.value,
		liveUsd: liveQuote.value?.usd ?? null,
		now: Date.now(),
	})
	if (!submitGate.ok) return

	isSending.value = true

	const amountToSend = amountValidation.value.integerized

	// Snapshot reactive values — the component may unmount before the promise
	// settles, at which point the reactive refs no longer carry meaningful state.
	const destination = searchTerm.value
	const contract = activeToken.value.contract
	// Pass the cached estimate id when available so the SW can skip the
	// redundant `buildAndEstimateTxRequest` round-trip and reuse the
	// pre-built TxRequest. The SW validates a snapshot (base fee, primary
	// endpoint, inputs) at consume time and rebuilds on any drift.
	const precomputedEstimateId = feeEstimate.value?.estimateId
	const transferArgs = [
		appStore.network.id,
		appStore.account.address,
		activeToken.value.id,
		transferType.value,
		destination,
		amountToSend,
		feeSettings.value,
		precomputedEstimateId,
	]

	// Unique id captured with the placeholder's full scope so the rejection path
	// removes exactly THIS placeholder — not a by-destination/contract search that
	// could remove a same-recipient sibling or another account's row after a switch.
	const awaitingId = crypto.randomUUID()
	appStore.addAwaitingTransaction({
		id: awaitingId,
		account: appStore.account.address,
		destination,
		contract,
	})

	executionService
		.executeTransfer(...transferArgs)
		.then(() => {
			openToast({ label: "Transaction submitted", icon: "check-circle" })
		})
		.catch((err) => {
			appStore.removeAwaitingTransaction(awaitingId)

			// User-initiated cancel: the terminal card in RecentActivityView
			// already says "Cancelled" — a failure toast would be a wrong
			// signal. See `popup/utils/cancellable-rejection.ts` for the
			// shared classifier used by every cancellable popup.
			if (classifyCancellableRejection(err) === "silent") return

			openToast({ label: "Simulation failed, transaction not sent", icon: "warning", color: "red" }, TOAST_DURATION.LONG)
			console.error("[send] executeTransfer failed:", err)
		})
		.finally(() => {
			executionService.disconnect()
		})

	// Navigate away immediately. Progress is visible on the general page
	// via the durable operation journal, which survives popup close/reopen
	// and SW restart. The previous 700ms sleep tried to "hold the button
	// so the click felt received" and to catch fast-reject errors — both
	// jobs are now done by the journal + toast.
	if (cancelled) return
	leaveSend()
}

watch(
	() => cacheStore.activeTokenIdx,
	() => {
		initSendType()
		initReceiverType()

		amountTerm.value = null
	},
)

watch(
	() => tokens.value,
	() => {
		if (tokens.value?.length && awaitingNewToken.value) {
			awaitingNewToken.value = false
			cacheStore.activeTokenIdx = tokens.value[0].id
		}
	},
	{ deep: true },
)

watch(
	[amountTerm, searchTerm, selectedSendType, selectedReceiverType, () => feeSettings.value],
	() => {
		// NB: transferType can be 0 (TransferType.Private enum) which is falsy — check against undefined explicitly
		// or Private → Private is silently dropped here before estimation.
		if (!isValidAddress.value || transferType.value === undefined || !feeSettings.value) {
			cancelFeeEstimate()
			return
		}
		if (!amountValidation.value.valid) {
			cancelFeeEstimate()
			return
		}

		scheduleFeeEstimate({
			networkId: appStore.network.id,
			accountAddress: appStore.account.address,
			tokenId: activeToken.value.id,
			transferType: transferType.value,
			destination: searchTerm.value,
			amount: amountValidation.value.integerized,
			settings: feeSettings.value,
		})
	},
	{ deep: true },
)

// P11 E1 fix: refetch identity-scoped state (tokens, tokenBalances,
// contacts) whenever the active appStore triple changes. Sequence
// counter guards against stale-resolve races. Post-impl audit High #2:
// the activeTokenIdx is global (cacheStore) — when the new token set
// doesn't contain the old id, reset to tokens[0] so activeToken stays
// resolvable. Re-run the send/receiver init logic so the form state
// matches the new active token.
let identityFetchSeq = 0
async function refetchIdentityScopedState() {
	const mySeq = ++identityFetchSeq
	if (!appStore.profile?.id || !appStore.network?.id || !appStore.account?.address) {
		if (mySeq === identityFetchSeq) {
			tokens.value = []
			tokenBalances.value = []
			contacts.value = []
		}
		return
	}
	const [t, tb, c] = await Promise.all([
		tokenService.getTokens(appStore.profile.id, appStore.network.chainId),
		tokenBalanceService.getTokenBalances(undefined, appStore.account.address),
		contactService.getContacts(),
	])
	if (mySeq !== identityFetchSeq) return
	tokens.value = t
	tokenBalances.value = tb
	contacts.value = c

	// Reset activeTokenIdx if the prior selection isn't in the new token
	// set (e.g. profile switch). Without this, `activeToken` computed
	// returns undefined and downstream send / fee-estimation flows break.
	if (!t.some((tok) => tok.id === cacheStore.activeTokenIdx)) {
		cacheStore.activeTokenIdx = t[0]?.id ?? undefined
	}
	// Re-validate the form state for the (possibly new) active token.
	initSendType()
	initReceiverType()
}

watch(
	() => [appStore.profile?.id, appStore.network?.id, appStore.account?.address],
	() => refetchIdentityScopedState(),
	{ immediate: false },
)

onMounted(async () => {
	console.log(`[send:${sendInstanceId}] mounted`)
	// Route mount fetch through the shared refetch so it inherits the
	// sequence guard AND the null-triple defense AND the
	// activeTokenIdx-rebind logic.
	await refetchIdentityScopedState()

	// Query-param preselect survives the unmount of tokens/[id] (which clears
	// cacheStore.activeTokenIdx on its onBeforeUnmount). Falls through to
	// whatever activeTokenIdx may still be set, then to tokens[0].
	const queryTokenId = route.query.tokenId ? Number(route.query.tokenId) : null
	if (queryTokenId && tokens.value.some((tok) => tok.id === queryTokenId)) {
		cacheStore.activeTokenIdx = queryTokenId
		initSendType()
		initReceiverType()
	}

	if (cacheStore.preselectedContactToSend) {
		selectedContact.value = cacheStore.preselectedContactToSend
		searchTerm.value = cacheStore.preselectedContactToSend.address
	}

	if (!tokens.value.length) {
		awaitingNewToken.value = true
	}
})

onBeforeUnmount(() => {
	console.log(`[send:${sendInstanceId}] unmounting`)
	cancelled = true

	contactService.disconnect()
	tokenBalanceService.disconnect()
	tokenService.disconnect()
	prices.dispose()
	priceService.disconnect()

	cancelFeeEstimate()

	amountTerm.value = null

	searchTerm.value = ""

	contacts.value = []
	selectedContact.value = null

	awaitingNewToken.value = false

	cacheStore.preselectedBalanceType = "private"
	cacheStore.preselectedContactToSend = null
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Send" :backTo="'/popup/general'" />

		<Flex wide direction="column" justify="between" :class="$style.body">
			<Flex direction="column" :class="$style.top">
				<!-- Section: Transfer Path + Recipient — flush variant: the input's own bottom border
				     is the visual terminator, so we suppress the section divider to avoid a double line. -->
				<div :class="[$style.section, $style.section_flush]">
					<SendTypesCard
						v-if="!isBlockedTransfer"
						v-model:sendType="selectedSendType"
						v-model:receiverType="selectedReceiverType"
						:token="activeToken"
					/>

					<RecipientField
						v-model:searchTerm="searchTerm"
						v-model:selectedContact="selectedContact"
						:candidates="recipientCandidates"
					/>
				</div>

				<!-- Section: Select Asset -->
				<div :class="$style.section">
					<Flex align="center" justify="between">
						<span :class="$style.section_label">Select Asset</span>
						<span :class="$style.section_meta">Network: {{ getChainName(appStore.network?.chainId) }}</span>
					</Flex>
					<SelectTokenCard :token="activeToken" />
				</div>

				<!-- Section: Transaction Amount -->
				<div :class="$style.section">
					<span :class="$style.section_label">Transaction Amount</span>
					<AmountCard
						ref="amountCardRef"
						v-model="amountTerm"
						v-model:fiatMode="fiatMode"
						v-model:fiatGuard="fiatGuard"
						:token="activeToken"
						:tokenBalanceByType
						:balanceRawByType="balanceRaw ?? null"
						:liveQuote
						:proxyTicker
					/>
					<Flex v-if="fiatNeedsRequote" align="center" gap="6" :class="$style.requote_notice">
						<Icon name="warning" size="12" color="tertiary" />
						<Text size="11" weight="500" color="tertiary">
							{{ liveQuote ? "The price moved since you started typing." : "The price quote went stale." }}
						</Text>
						<span @click="handleRequote" data-testid="send-fiat-requote" :class="$style.requote_action">Refresh quote</span>
					</Flex>
				</div>

				<!-- Section: Fee Summary -->
				<div :class="$style.section_last">
					<FeeSettingsCard
						:profile="appStore.profile"
						:network="appStore.network"
						:account="appStore.account"
						:feeEstimate="feeEstimate"
						:isEstimating="isEstimating"
						v-model="feeSettings"
					/>
				</div>
			</Flex>

			<Flex direction="column" :class="$style.bottom">
				<Button
					@click="handleSend"
					data-testid="send-submit"
					variant="cta"
					wide
					:disabled="!isAllowedToSend || isSending"
					:loading="isSending"
				>
					{{ isSending ? "CONFIRMING" : "Confirm Transaction" }}
				</Button>
			</Flex>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	scrollbar-gutter: stable;
	background: var(--app-bg);
}

.body {
	flex: 1;
}

.top {
	padding: 0 24px;
}

.section {
	display: flex;
	flex-direction: column;
	gap: 8px;

	padding: 14px 0;
	border-bottom: 1px solid rgba(35, 31, 28, 1);
}

.section_flush {
	border-bottom: none;
	padding-bottom: 0;
}

.section_last {
	padding: 14px 0;
}

.section_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nulo-secondary);
}

.section_meta {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
}

.bottom {
	position: sticky;
	bottom: 0;
	z-index: 5;

	padding: 20px 24px;
	background: var(--app-bg);
	border-top: 1px solid var(--nulo-border);
}


.requote_notice {
	padding: 6px 0;
}

.requote_action {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nulo-accent);
	cursor: pointer;

	&:hover {
		text-decoration: underline;
	}
}
</style>
