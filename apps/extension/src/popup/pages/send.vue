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
import PublishStrip from "@/components/composite/send/PublishStrip.vue"
import RecipientField from "@/popup/components/modules/send/RecipientField.vue"
import SelectTokenCard from "@/popup/components/modules/send/SelectTokenCard.vue"
import SendReviewSheet from "@/popup/components/modules/send/SendReviewSheet.vue"
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
import { managers } from "@/utils/core"
import { LEGAL_DISMISSED_KEY } from "@/utils/legal-sheet"
import { isValidHex } from "@/utils/string"
import { FEE_JUICE_BRIDGE_URL, feeLine } from "@/popup/components/modules/send/fee-helpers"
import { validateSendAmount } from "@/popup/pages/send-amount"
import { applyBalanceAdd, applyBalanceUpdate } from "@/popup/pages/send-balance-events"
import { evaluateFiatGate } from "@/popup/pages/send-fiat-gate"
import { submitTransfer } from "@/popup/pages/send-submit"
import { NO_FACTS, payerKindOf, publishFacts } from "@/components/composite/send/publish-facts"

/** Composables */
import { useToast } from "@/composables/toast.js"
import { useFeeEstimation } from "@/composables/useFeeEstimation"
import { useLegalAcceptance } from "@/composables/useLegalAcceptance"
import { usePrices } from "@/composables/usePrices"
import { useSendReview } from "@/composables/useSendReview"
import { useTicker } from "@/composables/ticker"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

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
/** The fee card's reading of the method in effect — `{ type, fpcId, isProtocol }` or null. */
const payer = ref(null)
/** Set by FeeSettingsCard when the selected fee-juice method has zero balance.
 *  When true, the primary CTA becomes "Get fee juice" (C) and the fee card
 *  shows the explainer banner (A). */
const needsFeeJuice = ref(false)
const feeDisplay = ref(null)

/** Open the fee-juice bridge in a new tab. */
const openFeeJuiceBridge = () => {
	window.open(FEE_JUICE_BRIDGE_URL, "_blank", "noopener,noreferrer")
}

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

	openToast({ kind: "success", label: "The last token has just been deleted" })

	leaveSend()
}

const tokens = ref([])
const activeToken = computed(() => tokens.value?.find((t) => t.id === cacheStore.activeTokenIdx))
const isBlockedTransfer = computed(() => !activeToken.value?.hasPrivateTransfers && !activeToken.value?.hasPublicTransfers)

const tokenBalanceService = new TokenBalanceServiceClient()
tokenBalanceService.onTokenBalanceAdded.add(onBalanceAdded)
tokenBalanceService.onTokenBalanceUpdated.add(onBalanceUpdated)
function onBalanceAdded(balance) {
	applyBalanceAdd(tokenBalances.value, appStore.account.address, balance)
}
function onBalanceUpdated(balance) {
	applyBalanceUpdate(tokenBalances.value, balance)
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

/** Nothing is sent without a current Terms acceptance; the background refuses it too. `loading`
 *  shows no banner, so an accepted user never sees one flash. */
const legal = useLegalAcceptance(managers.legal)
const legalBlocked = computed(() => legal.status.value === "missing" || legal.status.value === "stale")
/** Clearing the dismissal is what lets the shell's sheet cover this page again. */
const legalBannerAction = {
	name: "Review",
	testId: "send-legal-review",
	callback: () => chrome.storage.session.remove(LEGAL_DISMISSED_KEY),
}
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
	if (!legal.isCurrent.value) return false
	if (!amountTerm.value) return false
	if (isBlockedTransfer.value) return false
	if (!isValidAddress.value) return false
	if (!feeSettings.value) return false
	if (fiatQuoteBlocked.value) return false
	return amountValidation.value.valid
})

const payerKind = computed(() => payerKindOf(feeSettings.value, payer.value))
// No sendable token → no facts: no strip, no tag, no review, whatever the fee card resolved.
const facts = computed(() =>
	isBlockedTransfer.value ? NO_FACTS : publishFacts(selectedSendType.value, selectedReceiverType.value, payerKind.value),
)

/** The review sheet lives on the popup stack under this key, so it stacks and closes like any other popup. */
const REVIEW_KEY = "send_review"
const reviewOpen = computed(() => popupStore.isOpened(REVIEW_KEY))
const reviewOrder = computed(() => popupStore.popups[REVIEW_KEY]?.order ?? 0)
const reviewDepth = computed(() => popupStore.len - reviewOrder.value)
const { ready: reviewReady, authorises } = useSendReview({
	isGated: () => facts.value.requiresReview,
	isOpen: () => reviewOpen.value,
	isTop: () => reviewOrder.value === popupStore.len - 1,
})
const openReview = () => {
	if (!reviewOpen.value) popupStore.open(REVIEW_KEY)
}
const closeReview = () => popupStore.close(REVIEW_KEY)

const amountText = computed(() => (amountTerm.value ? String(amountTerm.value) : undefined))
const feeText = computed(() => feeLine(feeDisplay.value))

const transferType = computed(() => {
	if (selectedSendType.value === "private" && selectedReceiverType.value === "private") return TransferType.Private
	if (selectedSendType.value === "private" && selectedReceiverType.value === "public") return TransferType.PrivateToPublic
	if (selectedSendType.value === "public" && selectedReceiverType.value === "private") return TransferType.PublicToPrivate
	if (selectedSendType.value === "public" && selectedReceiverType.value === "public") return TransferType.Public
	return undefined
})

const executionService = new ExecutionServiceClient()
// B-30: executionService opens a live SW port as soon as fee estimation runs
// (before any submit). Its ONLY disconnect used to live in executeTransfer's
// `.finally`, which never runs unless Send was actually clicked — so the common
// "open Send, pick amount, navigate away" flow leaked the port. Disconnect it in
// onBeforeUnmount too, idempotently (submit + unmount must not double-disconnect).
let executionDisconnected = false
function disconnectExecution() {
	if (executionDisconnected) return
	executionDisconnected = true
	executionService.disconnect()
}
// While a submit is in flight, teardown is OWNED by executeTransfer's `.finally`
// — the page navigates away immediately after submitting, so disconnecting in
// onBeforeUnmount would reject the still-pending executeTransfer RPC and surface
// a false "transaction not sent" for a tx the SW is actually executing.
let submitInFlight = false

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
	handoff: handoffFeeEstimate,
} = useFeeEstimation({
	debounceMs: 800,
	estimate: ({ networkId, accountAddress, tokenId, transferType: tt, destination, amount, settings }, estimateToken) => {
		console.debug(`[send:${sendInstanceId}] estimateTransferFee firing`)
		return executionService.estimateTransferFee(networkId, accountAddress, tokenId, tt, destination, amount, settings, estimateToken)
	},
	cancelRemote: (estimateToken) => {
		executionService.cancelEstimate(estimateToken).catch(() => {})
	},
	onError: (err) => {
		console.error(`[send:${sendInstanceId}] estimateTransferFee failed:`, err)
		openToast({ kind: "error", label: "Couldn't estimate fee — retry." })
	},
})
const isSending = ref(false)

/** Set true if the user navigates away manually during the short
 *  "Confirming..." window — prevents a second router.back() from firing. */
let cancelled = false

const canSubmitNow = () => {
	if (!isAllowedToSend.value || isSending.value) return false
	if (!amountValidation.value.valid) return false
	// The reactive gate runs on a 30s ticker — re-evaluate at TRUE wall-clock
	// on the actual click so a snapshot cannot slip through expiry/drift by up
	// to one tick.
	const submitGate = evaluateFiatGate({
		fiatMode: fiatMode.value,
		guard: fiatGuard.value,
		liveUsd: liveQuote.value?.usd ?? null,
		now: Date.now(),
	})
	return submitGate.ok
}

/**
 * The one path to a transfer. `source` says which control was activated; the sheet's counts only
 * while the sheet is open, the footer's only while it is not. A send that names the account as fee
 * payer goes out only from the sheet, and only once it is ready — the footer opens the sheet instead.
 */
const submit = (source) => {
	if (!canSubmitNow()) return
	if ((source === "review") !== reviewOpen.value) return
	if (facts.value.requiresReview && !authorises(source)) return openReview()

	isSending.value = true
	closeReview()
	submitInFlight = true
	submitTransfer(submitDeps, snapshotTransfer())

	// Leave at once: the durable operation journal shows progress on the general page and survives
	// popup close and SW restart; a fast rejection reaches the user as a toast.
	if (cancelled) return
	leaveSend()
}

/** Reactive values read once: the page unmounts before the transfer settles. */
function snapshotTransfer() {
	// Pass the cached estimate id when available so the SW can skip the
	// redundant `buildAndEstimateTxRequest` round-trip and reuse the
	// pre-built TxRequest. The SW validates a snapshot (base fee, primary
	// endpoint, inputs) at consume time and rebuilds on any drift.
	// Ownership handoff: submitting transfers the estimate to the execution
	// path — unmount cleanup must NOT remote-cancel it, or the eviction
	// would race the fire-and-forget executeTransfer out of its reuse hit.
	// Only when a consumable id exists: handing off a still-in-flight
	// estimate would orphan its eventual stash (nobody consumes, nobody can
	// cancel) for the full TTL.
	const precomputedEstimateId = feeEstimate.value?.estimateId
	if (precomputedEstimateId) handoffFeeEstimate()
	return {
		networkId: appStore.network.id,
		accountAddress: appStore.account.address,
		tokenId: activeToken.value.id,
		transferType: transferType.value,
		destination: searchTerm.value,
		amount: amountValidation.value.integerized,
		feeSettings: feeSettings.value,
		precomputedEstimateId,
		contract: activeToken.value.contract,
		symbol: activeToken.value.symbol,
		decimals: activeToken.value.decimals,
		epoch: appStore.scopeEpoch,
	}
}

const submitDeps = {
	executeTransfer: (...args) => executionService.executeTransfer(...args),
	awaiting: { add: appStore.addAwaitingTransaction, remove: appStore.removeAwaitingTransaction },
	openToast,
	isCurrent: (epoch) => appStore.isLogined && appStore.scopeEpoch === epoch,
	viewTransaction: (hash) => router.push(`/popup/tx/${hash}`),
	onSettled: () => {
		submitInFlight = false
		disconnectExecution()
	},
}

watch(
	() => cacheStore.activeTokenIdx,
	() => {
		closeReview()
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
	[amountTerm, searchTerm, selectedSendType, selectedReceiverType, () => feeSettings.value, () => legal.isCurrent.value],
	() => {
		// An estimate simulates against the node: no work for a send the wall would refuse.
		if (!legal.isCurrent.value) {
			cancelFeeEstimate()
			return
		}
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

// The contact travels in the URL so a row opened in a new tab preselects it too. Applied after each
// contacts load rather than at mount: a cold tab's identity settles after the page is up, and the
// first load finds no contacts. Consumed once it matches; an id that is not one of this profile's
// contacts selects nothing.
let queryContactApplied = false
function applyQueryContact() {
	if (queryContactApplied || selectedContact.value || searchTerm.value) return
	const id = typeof route.query.contact === "string" ? route.query.contact : null
	const preselected = id === null ? undefined : contacts.value.find((c) => String(c.id) === id)
	if (!preselected) return
	queryContactApplied = true
	selectedContact.value = preselected
	searchTerm.value = preselected.address
}

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
	applyQueryContact()

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
	() => {
		closeReview()
		refetchIdentityScopedState()
	},
	{ immediate: false },
)

onMounted(async () => {
	console.debug(`[send:${sendInstanceId}] mounted`)
	void legal.refresh()
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

	if (!tokens.value.length) {
		awaitingNewToken.value = true
	}
})

onBeforeUnmount(() => {
	console.debug(`[send:${sendInstanceId}] unmounting`)
	cancelled = true
	closeReview()

	contactService.disconnect()
	tokenBalanceService.disconnect()
	tokenService.disconnect()
	prices.dispose()
	priceService.disconnect()
	legal.dispose()
	// Only when NO submit is in flight — otherwise executeTransfer's `.finally`
	// owns the disconnect, and tearing down here would abort the pending RPC.
	if (!submitInFlight) disconnectExecution()

	cancelFeeEstimate()

	amountTerm.value = null

	searchTerm.value = ""

	contacts.value = []
	selectedContact.value = null

	awaitingNewToken.value = false

	cacheStore.preselectedBalanceType = "private"
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Send" :backTo="'/popup/general'" />

		<Banner v-if="legalBlocked" variant="warning" wide :action="legalBannerAction" data-testid="send-legal-banner">
			Accept the Terms to send
		</Banner>

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
						:originPrivacy="selectedSendType"
						:destinationPrivacy="selectedReceiverType"
						:payerNoticeShape="facts.noticeShape"
						v-model="feeSettings"
						v-model:needsFeeJuice="needsFeeJuice"
						v-model:payer="payer"
						v-model:feeDisplay="feeDisplay"
					/>
				</div>
			</Flex>

			<Flex direction="column" gap="10" :class="$style.bottom">
				<PublishStrip v-if="!isBlockedTransfer" :facts="facts" @open="openReview" />
				<Button
					v-if="needsFeeJuice"
					@click="openFeeJuiceBridge"
					data-testid="send-get-fee-juice"
					variant="cta"
					wide
				>
					{{ selectedSendType === "private" ? "Get private gas" : "Get Fee Juice" }}
				</Button>
				<Button
					v-else
					@click="submit('primary')"
					data-testid="send-submit"
					:data-action="facts.requiresReview ? 'review' : 'send'"
					variant="cta"
					wide
					:disabled="!isAllowedToSend || isSending"
					:loading="isSending"
				>
					{{ isSending ? "CONFIRMING" : facts.requiresReview ? "Review send" : "Confirm Transaction" }}
				</Button>
			</Flex>
		</Flex>

		<SendReviewSheet
			:show="reviewOpen"
			:order="reviewOrder"
			:depth="reviewDepth"
			:facts="facts"
			:amount="amountText"
			:symbol="activeToken?.symbol"
			:recipientName="selectedContact?.name"
			:recipientAddress="searchTerm"
			:feeText="feeText"
			:payerKind="payerKind"
			:payerType="payer?.type"
			:canSend="isAllowedToSend"
			:sending="isSending"
			:ready="reviewReady"
			@close="closeReview"
			@send="submit('review')"
		/>
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
