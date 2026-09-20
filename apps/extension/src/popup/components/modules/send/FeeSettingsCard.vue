<script setup>
/** Components */
import FeeMethodRow from "./FeeMethodRow.vue"
import FeeCostReadout from "./FeeCostReadout.vue"
import FeePriorityRow from "./FeePriorityRow.vue"
import FeeMethodSelector from "./FeeMethodSelector.vue"

/** Vendor */
import { getRandomHex } from "@/wallet/utils"
import { getErrorData } from "@nulo/wallet-core/utils"
import { UI_STORAGE_KEYS } from "@/popup/constants/storage-keys"

/** Utils */
import { storageLocalGet, storageLocalSet } from "@/utils/storage"
import { CHAIN_IDS } from "@/utils/chain-ids"

/** Services */
import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"
import { PriceServiceClient } from "@/wallet/services/price/client"

/** Helpers */
import { buildFeeMethods, FEE_JUICE_BRIDGE_URL, formatGasBalance, resolveSavedSelection, settingsForMethod } from "./fee-helpers"
import { applyFpcEdits, feePayerNotice, previewForPick, recordOf, resolveSendSelection } from "./fee-privacy"
import { loadSendSelections, mutateSendSelections, readSendSlots, withSendSlot } from "./fee-send-selection"
import { feeJuicePricingFromUsd, feeToUsd } from "@/utils/fee-estimation"
import { usePrices } from "@/composables/usePrices"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Stores */
import { useCacheStore } from "@/stores/cache.store"
import { EnsureSuperseded, useBalancesStore } from "@/stores/balances.store"
const cacheStore = useCacheStore()
const balancesStore = useBalancesStore()

const props = defineProps({
	profile: { type: Object },
	network: { type: Object },
	account: { type: Object },
	feeEstimate: { type: Object, default: null },
	isEstimating: { type: Boolean, default: false },
	/** When mounted inside another bordered container (e.g. execute window's
	 *  operation card), the outer wrapper's own border + overflow:hidden
	 *  clash with the parent's border. Passing embedded=true strips the root
	 *  border so the parent can own the single border. */
	embedded: { type: Boolean, default: false },
	/** A method the dApp asked for by naming the account itself as payer ("fj" is the one shape):
	 *  the card shows it, its balance and its cost, and offers no other — the user's saved choice
	 *  and the network's default never replace it. */
	lockedMethod: { type: String, default: null },
	/** "private" | "public" — the side the transfer spends from. Non-null only on the Send page, where
	 *  the fee source follows it; null keeps the one-pick-per-account behaviour of the dApp windows. */
	originPrivacy: { type: String, default: null },
	/** "private" | "public" — the side the transfer lands on; only words the fee-payer notice. */
	destinationPrivacy: { type: String, default: null },
})

const FEE_METHOD_LS_KEY = UI_STORAGE_KEYS.FEE_PAYMENT_METHODS
const readSavedFeeMethods = async () => (await storageLocalGet(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}

const settings = defineModel()

/** One-way child→parent flag: the selected fee-juice method has zero balance,
 *  so the account must bridge before it can pay. Drives the Send page's
 *  "get fee juice" CTA takeover. */
const needsFeeJuiceOut = defineModel("needsFeeJuice", { type: Boolean, default: false })

const methodId = getRandomHex(6)

/**
 * `isInitComplete` gates settings derivation. While `runInit()` is in flight
 * (or hasn't yet started), `derivedSettings` returns `undefined` regardless
 * of `selectedMethod` — preventing a watcher fired by the loading-time
 * `selectedMethod` pre-fill from computing settings against a still-zero
 * `gasBalances`. Flips to `true` exactly once per `runInit` invocation,
 * after every fetched ref has its final value.
 */
const isInitComplete = ref(false)

const registeredFpcs = ref([])
/** This card's own FPC events, by id (`null` = deleted), applied over every store snapshot. The
 *  store's FPC list never hears those events and is re-copied on each commit, so a patch to
 *  `registeredFpcs` would not survive. Kept for the life of the card: an account switched away from
 *  and back to is served the store's retained list, and an id only ever names its own row. */
const fpcEdits = reactive(new Map())
const knownFpcs = computed(() => applyFpcEdits(registeredFpcs.value, fpcEdits))
/**
 * `methods` is the dropdown list. We pass `gasBalances` only after init
 * completes, so the loading-state items don't briefly flash "no balance"
 * before the first fetch returns. This honors PR #66's stated intent.
 */
const allowSponsored = computed(() => props.network?.chainId !== CHAIN_IDS.MAINNET)
const methods = computed(() =>
	buildFeeMethods(knownFpcs.value, isInitComplete.value ? gasBalances.value : undefined, {
		allowSponsored: allowSponsored.value,
	}),
)

const isCustomMethod = computed(() => settings.value?.paymentMethod?.kind === "embedded")
const useOwnMethod = ref(false)
/**
 * Tracks whether settings should resolve to `{ kind: "embedded" }` regardless
 * of `selectedMethod`. Initialized from the parent v-model on mount so we
 * don't clobber an initial-embedded value during init. Toggled by
 * `handleUseEmbedded` / `handleMethodPicked`.
 */
const useEmbeddedFee = ref(settings.value?.paymentMethod?.kind === "embedded")

const selectedMethod = ref()
const selectedPriority = ref("normal")
const isMethodsDropdownOpen = ref(false)

/** UNKNOWN until the first successful read for the current identity.
 *  `undefined` must stay distinguishable from a confirmed zero: a failed or
 *  timed-out read commits `undefined`, never a fabricated "0", so method
 *  gating and the bridge nudge can't act on a balance we never saw. */
const gasBalances = ref(undefined)
const isLoading = ref(false)
const error = ref("")

const feeJuiceBalanceFormatted = computed(() =>
	gasBalances.value && gasBalances.value.publicFeeJuice !== null ? formatGasBalance(gasBalances.value.publicFeeJuice) : null,
)
const privateFeeJuiceFormatted = computed(() =>
	gasBalances.value && gasBalances.value.privateFeeJuice !== null ? formatGasBalance(gasBalances.value.privateFeeJuice) : null,
)

/** Fee USD is derived LIVE from the estimate's raw FJ amount × the current
 *  usable AZTEC quote — an estimate-time snapshot would keep displaying a
 *  stale figure after the 3-min refresh moved the rate (or after the quote
 *  expired entirely, where the figure must disappear). */
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)
const estimatedFeeDisplay = computed(() => {
	if (!props.feeEstimate) return null
	const usd = feeToUsd(BigInt(props.feeEstimate.maxFee), feeJuicePricingFromUsd(prices.feeJuiceQuote.value?.usd))
	return { amount: props.feeEstimate.maxFeeFormatted, usd }
})

const showMethodSelector = computed(() => {
	if (!isCustomMethod.value) return true
	return useOwnMethod.value
})

/** Send's picks, `{ [address]: { private?, public? } }` — keyed by address so nothing crosses accounts. */
const sendPicks = reactive({})

/** Structured scope of the committed snapshot — the recovery watch's target. */
const committedScope = ref(null)

const scopeIsLiveIdentity = (scope) =>
	Boolean(scope) &&
	props.profile?.id === scope.profileId &&
	props.network?.id === scope.networkId &&
	props.network?.chainId === scope.chainId &&
	props.account?.address === scope.accountAddress

/**
 * Send's selection is DERIVED, never assigned: a pure function of the live origin, the live
 * account's pick and the committed snapshot. An origin flip cannot be missed and a late init cannot
 * overwrite a pick, because there is no assignment to race. It resolves only while the committed
 * snapshot belongs to the live identity — account A's balances never meet account B's pick.
 */
const sendSelection = computed(() => {
	if (props.originPrivacy === null) return null
	const pick = sendPicks[props.account?.address]?.[props.originPrivacy]
	if (!isInitComplete.value || !scopeIsLiveIdentity(committedScope.value)) {
		return { kind: "pending", preview: previewForPick(pick, methods.value, allowSponsored.value) }
	}
	const know = { fpcs: knownFpcs.value, balances: gasBalances.value, allowSponsored: allowSponsored.value }
	return resolveSendSelection(props.originPrivacy, know, pick)
})

/** The method that pays. A `pending` preview is deliberately not one. */
const effectiveMethod = computed(() => {
	if (props.originPrivacy === null) return selectedMethod.value
	return sendSelection.value.kind === "selected" ? sendSelection.value.method : undefined
})
/** Set exactly when this send would name the account as its fee payer while its origin is private —
 *  derived from the method that actually pays, so a defaulted and a hand-picked Fee Juice read alike. */
const payerNotice = computed(() => feePayerNotice(props.originPrivacy, props.destinationPrivacy, effectiveMethod.value))
const nudgeCopy = computed(() =>
	props.originPrivacy === "private"
		? {
				title: "You have no private gas yet",
				body: "A private send pays its fee from private gas, so the fee contract is the payer instead of you. Bridge some to cover this send.",
				link: "Get private gas",
			}
		: { title: "You have no fee juice yet", body: "Bridge some to cover the network fee.", link: "Get fee juice" },
)

/** What the dropdown trigger shows: the paying method, or the saved pick's row while loading. */
const displayMethod = computed(() => effectiveMethod.value ?? sendSelection.value?.preview)

/** The dApp-locked method's fresh row from `methods` (balance-aware), never a saved record. */
const lockedOption = () => methods.value.find((m) => m.type === props.lockedMethod)

/**
 * Pure derivation of settings from current state. Returns `undefined` while
 * init is in flight so the parent's estimation watcher doesn't fire against
 * a partially-resolved snapshot. The embedded short-circuit comes ahead of
 * `isInitComplete` so embedded ops (which skip `runInit` entirely via the
 * early-return at the top of runInit) still emit valid settings.
 */
const derivedSettings = computed(() => {
	if (useEmbeddedFee.value) return { paymentMethod: { kind: "embedded" } }
	if (!isInitComplete.value) return undefined
	const m = effectiveMethod.value
	if (!m) return undefined
	return settingsForMethod(m, selectedPriority.value, gasBalances.value)
})

/** True when the selected fee-juice method (public or private) can't pay because
 *  its balance is zero — the trigger for the get-fee-juice nudge (banner + CTA). */
const feeJuiceMissing = computed(() => {
	// Send: only confirmed exhaustion — every applicable payer read, none can pay — whatever is selected.
	if (sendSelection.value) return sendSelection.value.kind === "none"
	return selectedMethodHasNoGas()
})
const selectedMethodHasNoGas = () => {
	if (!isInitComplete.value || useEmbeddedFee.value) return false
	// Unknown balances (failed/timed-out read, silent retry pending) never
	// trigger the nudge — only a confirmed zero does.
	const balances = gasBalances.value
	if (!balances) return false
	const m = selectedMethod.value
	if (!m) return false
	if (m.type === "private_fpc") {
		// Only a CONFIRMED zero triggers the bridge nudge. `null` means the PrivateFPC
		// read failed or isn't registered — an unknown state, not a confirmed empty
		// balance — so we don't tell a possibly-funded user to go bridge.
		return balances.privateFeeJuice === "0"
	}
	if (m.type === "fj") return balances.publicFeeJuice === "0"
	return false
}
watch(
	feeJuiceMissing,
	(v) => {
		needsFeeJuiceOut.value = v
	},
	{ immediate: true },
)

// Sync the computed to v-model. No `immediate: true` — we don't want to
// clobber the parent's initial value on mount; only push when derivation
// produces a new result.
watch(derivedSettings, (val) => {
	settings.value = val
})

/**
 * Persist the user's explicit selection. Idempotent: re-saving the same
 * selection is safe. Called only from user-action handlers
 * (`handleMethodPicked`) — never from data-refresh paths like
 * `onBalanceUpdated`.
 */
const persistSelection = async (method) => {
	const fpms = await readSavedFeeMethods()
	fpms[props.account.address] = method
	await storageLocalSet({ [FEE_METHOD_LS_KEY]: fpms })

	if (method.type === "fpc" || method.type === "private_fpc") {
		const idx = cacheStore.feePaymentMethods.findIndex((m) => m.id === methodId)
		const entry = { id: methodId, fpc: method.fpc }
		if (idx === -1) cacheStore.feePaymentMethods.push(entry)
		else cacheStore.feePaymentMethods[idx] = entry
	}
}

/** Address and origin are captured before any await: the pick belongs to the account and side it was made on. */
const pickForSend = (m) => {
	const address = props.account.address
	const origin = props.originPrivacy
	const record = recordOf(m)
	sendPicks[address] = { ...sendPicks[address], [origin]: record }
	mutateSendSelections((raw) => withSendSlot(raw, address, origin, record)).catch((e) =>
		console.error("Failed to save the send fee selection", getErrorData(e)),
	)
}

const handleMethodPicked = (m) => {
	if (props.originPrivacy !== null) return pickForSend(m)
	selectedMethod.value = m
	useEmbeddedFee.value = false
	void persistSelection(m)
}

const handleUseOwnMethod = () => {
	useOwnMethod.value = true
}
const handleUseEmbedded = () => {
	useOwnMethod.value = false
	selectedMethod.value = undefined
	useEmbeddedFee.value = true
}

const onFpcUpdated = (fpc) => {
	if (props.originPrivacy !== null) {
		fpcEdits.set(fpc.id, fpc)
		return
	}
	// Replace the full snapshot so address-edit changes propagate to the
	// dropdown trigger and any persisted-fee-method round-trips below.
	// Object replacement (not deep mutation) keeps the derived computed
	// reactive.
	if (selectedMethod.value?.fpc?.id === fpc.id) {
		selectedMethod.value = { ...selectedMethod.value, fpc }
	}
}
const onFpcDeleted = (fpc) => {
	if (props.originPrivacy !== null) {
		if (effectiveMethod.value?.fpc?.id === fpc.id) openToast({ label: "Selected FPC was deleted" })
		fpcEdits.set(fpc.id, null)
		return
	}
	if (selectedMethod.value?.fpc?.id === fpc.id) {
		selectedMethod.value = undefined
		openToast({ label: "Selected FPC was deleted" })
	}
}

const fpcService = new FpcServiceClient()
fpcService.onFpcDeleted.add(onFpcDeleted)
fpcService.onFpcUpdated.add(onFpcUpdated)

let isMounted = true

// Silent degraded notice: the store owns the capped-backoff retry loop (it
// runs while this card's retry-capable subscription holds the key), so the
// card's job is only to SHOW the degraded state and re-commit on recovery.
// Deliberately no user-facing retry affordance — nothing the user can do
// fixes a failed balance read, and the degraded state keeps the card
// operable meanwhile (sponsored methods stay usable; self-paid methods stay
// fail-closed until a read succeeds — see settingsForMethod).
const FEE_DATA_UNAVAILABLE = "Couldn't load fee data — retrying in the background."
const PRIVATE_GAS_UNCHECKED = "Couldn't check your private gas. Pick a fee source to continue."

/** The info row's text. A hold with a healthy store is a read that came back without a balance —
 *  nothing is retrying, so the row never promises a retry: a private origin says what to do, and a
 *  public origin leaves the trigger's own "select a method" prompt to speak. */
const statusNotice = computed(() => {
	if (error.value) return error.value
	return sendSelection.value?.kind === "hold" && props.originPrivacy === "private" ? PRIVATE_GAS_UNCHECKED : ""
})

/** This card's capabilities: both legs, backoff retry while mounted, no
 *  tx-settle refresh and no peek — exactly its pre-store traffic. */
const CARD_CAPS = { legs: ["gas", "fpc"], retry: true, txRefresh: false, peek: false }

// Identity of the last fully-committed snapshot. Lets a background refresh
// (store retry, same-identity watcher refire) keep serving the committed
// snapshot instead of yanking settings — and the Confirm gate behind them —
// for the length of every in-flight window.
let committedKey = null

let subscription = null
let subscribedKey = null

// Run supersession: deleting the old init-coalescing left overlapping runs
// (watcher refires) racing on CARD-LOCAL state — a superseded run's late
// storage read must not re-apply the saved pre-fill over a newer run's (or
// the user's) selection, and its finally must not clear a newer run's
// loading flag. The store single-flights the RPCs; this serializes the
// card-side effects.
let runSeq = 0
let loadingRun = 0

/** Re-lease on every identity change: the old key must not stay subscribed —
 *  and store-retrying — after the card moves on. Subscribe the NEW key BEFORE
 *  releasing the old: a same-profile switch must not transit zero subscribers,
 *  which would fire the store's last-release fence and abandon the old
 *  identity's still-joinable flights (the A→B→A flap would re-issue its RPC).
 *  The store resets backoff attempts on the new key's 0→1 retry-capable
 *  transition, reproducing today's fresh-identity-fresh-backoff rule. */
const subscribeTo = (scope, reqKey) => {
	if (subscribedKey === reqKey) return
	const previous = subscription
	subscription = balancesStore.subscribe(scope, CARD_CAPS)
	subscribedKey = reqKey
	previous?.release()
}

const releaseSubscription = () => {
	subscription?.release()
	subscription = null
	subscribedKey = null
}

/**
 * The SNAPSHOT COMMIT (synchronous): copies the store entry into local refs —
 * never live-binds — then reconciles the selection and opens the gate. Order
 * matters and is preserved verbatim from the pre-store init: refs commit
 * BEFORE the reconcile (on a first load the still-closed gate means `methods`
 * resolves against undefined balances), and the gate opens after — degraded
 * included (holding it closed on failure was the frozen-Confirm bug).
 */
/** The selection a settled init lands on when the user picked nothing meanwhile: the saved one,
 *  resolved against fresh `methods` by semantic key (never the stored `fpc.name`), else the
 *  network's default. A dangling saved record (a deleted FPC) simply re-resolves to nothing every
 *  time — it is deliberately NOT pruned here, since a whole-map write would race
 *  `persistSelection` / another mounted card and could clobber a newer selection. */
const settledSelection = (savedRecord) => {
	const resolved = resolveSavedSelection(savedRecord, methods.value)
	if (resolved) return resolved
	// Alpha (mainnet) → Private Fee Juice; every other network → Sponsored FPC (its historical default).
	const preferred =
		props.network?.chainId === CHAIN_IDS.MAINNET
			? methods.value.find((m) => m.type === "private_fpc")
			: methods.value.find((m) => m.fpc?.type === FpcType.DefaultSponsoredFpc)
	return preferred ? { ...preferred } : undefined
}

const reconcileSelection = (savedRecord, baseline) => {
	const userPickedDuringInit = selectedMethod.value !== baseline
	if (props.lockedMethod) selectedMethod.value = lockedOption()
	else if (!userPickedDuringInit) selectedMethod.value = settledSelection(savedRecord)
}

const commitFromEntry = (scope, reqKey, saved, baseline) => {
	const entry = balancesStore.entry(scope)
	if (!entry) return

	// UNKNOWN (undefined) on any failed balance read, never a fabricated zero
	// and never a stale last-good figure — self-paid derivation fails closed.
	// `verified` is exactly that: cleared by every failed refresh. The store
	// retains last-good FPC data per key, matching the old lastGoodFpcKey rule.
	gasBalances.value = entry.gas.verified
	registeredFpcs.value = entry.fpc.data ?? []

	// Send derives its selection (`sendSelection`); only the one-pick-per-account cards reconcile here.
	if (props.originPrivacy === null) reconcileSelection(saved[scope.accountAddress], baseline)

	// The gate opens on EVERY settled init — degraded included.
	committedKey = reqKey
	committedScope.value = scope
	isInitComplete.value = true

	const degraded = entry.gas.status === "degraded" || entry.fpc.status === "degraded"
	if (degraded) {
		console.error("Fee init degraded", entry.gas.lastError, entry.fpc.lastError)
		error.value = FEE_DATA_UNAVAILABLE
	} else {
		error.value = ""
	}
}

/** Embedded ops without the "use own method" opt-in render no fee card state. */
const embeddedHidden = () => isCustomMethod.value && !useOwnMethod.value

/** True when a run no longer owns the card: unmounted, the identity props
 *  (profile/network/chain/account) moved off the snapshot this run targeted,
 *  or the card flipped embedded-visible (its watcher released the lease and
 *  a fresh runInit owns the new state). */
const identityDrifted = (scope) =>
	!isMounted ||
	props.profile?.id !== scope.profileId ||
	props.network?.id !== scope.networkId ||
	props.network?.chainId !== scope.chainId ||
	props.account?.address !== scope.accountAddress ||
	embeddedHidden()

/** The store fetches the legs with per-leg isolation, timeout, and raw-promise
 *  reuse; ensure settles when both requested legs settle, ready OR degraded.
 *  False means a superseded ensure — a profile switch fenced the run out and
 *  the new identity's own init covers it: no degraded state, no notice (the
 *  caller's drift guard cannot observe a rejection). Other failures propagate. */
const ensureLegsSettled = async (scope) => {
	try {
		// A dApp locks the method precisely when the balance just moved (a claim made for this
		// account): a snapshot inside the reader's TTL would show the old figure and hold Confirm
		// off, so a locked mount reads fresh.
		// A private send defaults to the account's own Fee Juice only on a private balance read as zero,
		// and a zero from the reader's TTL may predate a receipt. The origin can flip to private without
		// another read, so every Send mount reads fresh, whatever its origin is at the time.
		const forceRefresh = Boolean(props.lockedMethod) || props.originPrivacy !== null
		await balancesStore.ensure(scope, { legs: ["gas", "fpc"], forceRefresh })
		return true
	} catch (e) {
		if (e instanceof EnsureSuperseded) return false
		throw e
	}
}

/** The saved selections this card reconciles against. Send reads its own key into `sendPicks`, for
 *  the address it read for and under any pick already made in this mount (which is newer), and
 *  reconciles nothing — so it hands back an empty legacy map. */
const readSavedSelections = async (address) => {
	if (props.originPrivacy === null) return readSavedFeeMethods()
	const slots = readSendSlots(await loadSendSelections(), address)
	sendPicks[address] = { ...slots, ...sendPicks[address] }
	return {}
}

/** Shows the last-used method while the fetch is in flight. Send previews through `sendSelection` instead. */
const prefillSelection = (saved) => {
	if (props.originPrivacy !== null) return
	if (props.lockedMethod) selectedMethod.value = lockedOption()
	else if (saved[props.account.address]) selectedMethod.value = saved[props.account.address]
}

const runInit = async () => {
	const myRun = ++runSeq
	try {
		if (!props.profile || !props.network || !props.account || embeddedHidden()) {
			// Embedded ops (and identity-less mounts) hold no subscription: the
			// release kills the store's retry loop for this key, preserving the
			// old retry-chain death on this early-return; the useOwnMethod
			// watcher below is where the chain revives.
			releaseSubscription()
			return
		}

		// Snapshot the identity this run targets (profile+network+account). A
		// prop change during the awaits fires a fresh init; this run's commit is
		// discarded by the drift guard below rather than applied to the new
		// identity.
		const reqProfileId = props.profile?.id
		const reqNetworkId = props.network.id
		const reqChainId = props.network.chainId
		const reqAccount = props.account.address
		// chainId is part of the STORE key, so it must be part of this card's
		// identity too — else a chainId change under a stable networkId keeps
		// the old key's lease while ensure populates the new one.
		const reqKey = `${reqProfileId}|${reqNetworkId}|${reqChainId}|${reqAccount}`
		const scope = { profileId: reqProfileId, networkId: reqNetworkId, chainId: reqChainId, accountAddress: reqAccount }

		// Close the derivation gate only when no snapshot is committed for THIS
		// identity: first loads and identity switches must not derive against
		// partially-resolved state, but a same-identity background refresh keeps
		// the committed snapshot live (re-arming unconditionally made Confirm
		// oscillate disabled for the length of every retry's in-flight window).
		if (committedKey !== reqKey) isInitComplete.value = false

		// Pre-fill from local storage BEFORE the slow SW fetch so the
		// dropdown trigger displays the user's last-used method while the
		// fetch is in flight. The `isInitComplete` gate ensures this
		// pre-fill doesn't drive settings derivation against stale state.
		const saved = await readSavedSelections(reqAccount)
		// A newer run owns the card now: a superseded run resuming from its
		// storage read must not re-apply the pre-fill (it would clobber the
		// newer run's reconcile or the user's mid-flight pick).
		if (myRun !== runSeq || !isMounted) return
		prefillSelection(saved)
		// Snapshot the (possibly-prefilled) selection AFTER any pre-fill
		// assignment. If the user picks something during the ensure await,
		// `selectedMethod.value` will be a different reactive proxy reference
		// than `baseline`, and we skip the reconcile path so we don't clobber
		// their choice.
		const baseline = selectedMethod.value

		// Re-validate AFTER the storage await, BEFORE taking the lease: a
		// mid-await embedded flip (its watcher just released) or identity
		// change means a fresh runInit owns the new state — subscribing here
		// would re-lease a key this run no longer represents.
		if (identityDrifted(scope)) return

		loadingRun = myRun
		isLoading.value = true
		subscribeTo(scope, reqKey)
		if (!(await ensureLegsSettled(scope))) return
		// Discard if the profile/network/chain/account switched mid-flight, a
		// newer run took over, or the card flipped embedded-visible during the
		// ensure (its watcher released the lease; committing here would open
		// the gate and let derivedSettings overwrite the dApp's embedded
		// v-model). Everything past this guard is synchronous (no awaits), so
		// the commit is atomic against the checked state.
		if (myRun !== runSeq || identityDrifted(scope)) return

		commitFromEntry(scope, reqKey, saved, baseline)
	} catch (e) {
		// Deliberately does NOT open `isInitComplete`: an exception here may
		// have fired mid-commit, and deriving settings from a half-written
		// snapshot would break the resolved-state invariant the gate exists
		// for. The state is degraded-with-notice, never silently frozen — the
		// identity/useOwnMethod watchers are the re-entry paths.
		console.error("Failed to init", getErrorData(e))
		error.value = FEE_DATA_UNAVAILABLE
	} finally {
		// Only the run that owns the loading flag may clear it — a superseded
		// run's finally must not blank a newer run's in-flight spinner.
		if (loadingRun === myRun) isLoading.value = false
	}
}

/** Recovery from degraded commits: re-commit when a store retry lands. The
 *  source observes retryVersion ONLY (never gas.version — tx-settle commits
 *  must not re-enter this card; D4 structural), and only for the committed
 *  key. A non-degraded slice's retryVersion cannot bump while committed, so
 *  the pair-signal is exactly "a slice this card committed degraded
 *  recovered". */
watch(
	() => {
		const scope = committedScope.value
		if (!scope) return null
		const entry = balancesStore.entry(scope)
		return entry ? `${entry.gas.retryVersion}|${entry.fpc.retryVersion}` : null
	},
	(next, prev) => {
		if (next === null || prev === null || next === prev) return
		recommit().catch((e) => console.error("Fee recovery recommit failed", getErrorData(e)))
	},
)

const recommit = async () => {
	const scope = committedScope.value
	if (!scope || !isMounted) return
	// The recovery targets the committed identity; if props moved on (or the
	// card is embedded-visible), the identity/useOwnMethod watchers own it.
	if (!recommitStillValid(scope)) return
	// Baseline BEFORE the await (same rule as runInit): a user pick landing
	// while the storage read is pending makes the selection differ from this
	// baseline, so the reconcile is skipped instead of re-applying a stale
	// storage snapshot over the pick.
	const baseline = selectedMethod.value
	const saved = await readSavedFeeMethods()
	// Re-validate AFTER the await: an identity switch during the storage read
	// must not let this late commit re-open the gate with the OLD identity's
	// data (the switch closed it; only the new identity's init may commit).
	if (!isMounted || committedScope.value !== scope || !recommitStillValid(scope)) return
	commitFromEntry(scope, `${scope.profileId}|${scope.networkId}|${scope.chainId}|${scope.accountAddress}`, saved, baseline)
}

const recommitStillValid = (scope) => {
	if (!props.network || !props.account || (isCustomMethod.value && !useOwnMethod.value)) return false
	return (
		props.profile?.id === scope.profileId &&
		props.network?.id === scope.networkId &&
		props.network?.chainId === scope.chainId &&
		props.account?.address === scope.accountAddress
	)
}

watch(
	() => selectedPriority.value,
	() => {
		// Priority change is just another input to derivedSettings — the
		// computed re-derives automatically. No imperative work needed.
	},
)
watch(
	() => [props.profile, props.network, props.account],
	async () => {
		// Close the gate NOW on a real identity change: if a same-identity
		// refresh is in flight, its commit is drift-guarded away — the old
		// identity's snapshot must not keep serving settings for the new one
		// in the meantime. (Fresh identity → fresh backoff is the store's
		// 0→1 retry-capable transition inside subscribeTo's resubscribe.)
		const liveKey = `${props.profile?.id}|${props.network?.id}|${props.network?.chainId}|${props.account?.address}`
		if (liveKey !== committedKey) isInitComplete.value = false
		await runInit()
	},
)
watch([isCustomMethod, useOwnMethod], ([custom, own]) => {
	// Entering the embedded-visible state (a dApp op's v-model flip lands
	// here without any runInit call) releases the subscription, killing the
	// store's retry loop for this key — today's retry-chain death when a
	// retry tick hit the embedded early-return. Bumping runSeq supersedes
	// any in-flight run at its next checkpoint. The useOwnMethod watcher
	// below is the revival path.
	if (custom && !own) {
		runSeq += 1
		releaseSubscription()
	}
})
watch(useOwnMethod, async (val) => {
	// Switching from embedded → "use my own" needs to load balances/fpcs
	// for the dropdown. Pre-#fix this was broken: clicking "Override with
	// my method" on an embedded op never triggered the fetch pipeline.
	// Also re-init on a DEGRADED snapshot (`error` set): while embedded the
	// card holds no subscription (runInit's early-return released it), so the
	// store's retry loop is dead — this is where the chain revives, so a
	// degraded state can't become permanently stuck.
	if (val && (error.value || !isInitComplete.value)) {
		await runInit()
	}
})

onBeforeMount(async () => {
	console.debug(`[fee:${methodId}] mounting`)
	fpcService.connect()
	await runInit()
})
onBeforeUnmount(() => {
	console.debug(`[fee:${methodId}] unmounting`)
	// Release before tearing down the clients: the store's retry loop for
	// this key must die with the card's subscription (today's unmount
	// retry-chain death).
	isMounted = false
	releaseSubscription()
	fpcService.disconnect()
	prices.dispose()
	priceService.disconnect()
	cacheStore.feePaymentMethods = cacheStore.feePaymentMethods.filter((m) => m.id !== methodId)
})
</script>

<template>
	<Flex direction="column" :class="[$style.wrapper, embedded && $style.embedded]" data-testid="fee-settings-card" :data-origin="originPrivacy">
		<!-- Embedded fee override banner -->
		<template v-if="isCustomMethod && !useOwnMethod">
			<Flex align="center" justify="between" :class="$style.card">
				<Text size="13" weight="600" color="primary">Pay fee with</Text>
				<Text size="13" weight="600" color="primary">Embedded payload</Text>
			</Flex>
			<Flex direction="column" gap="8" :class="$style.detail_row">
				<Text size="12" weight="600" color="secondary">
					The app includes fee payment in the transaction.
				</Text>
				<Flex @click="handleUseOwnMethod" align="center" gap="4" :class="$style.link" data-testid="send-fee-override">
					<Text size="12" weight="600" color="primary">Override with my method</Text>
					<Icon name="arrow-right" size="10" color="primary" />
				</Flex>
			</Flex>
		</template>

		<!-- Method selector -->
		<template v-if="showMethodSelector">
			<!-- A method the dApp asked for: shown, never a choice. -->
			<Flex v-if="lockedMethod" align="center" justify="between" :class="$style.card" data-testid="send-fee-locked">
				<Text size="13" weight="600" color="primary">Pay fee with</Text>
				<Text size="13" weight="600" color="primary">Fee Juice · set by the app</Text>
			</Flex>
			<FeeMethodSelector
				v-else
				:modelValue="displayMethod"
				@update:modelValue="handleMethodPicked"
				:methods="methods"
				@open="isMethodsDropdownOpen = true"
				@close="isMethodsDropdownOpen = false"
			/>

			<!-- Back to embedded link -->
			<Flex
				v-if="isCustomMethod && useOwnMethod"
				align="center"
				justify="end"
				:class="$style.detail_row"
				:style="{ padding: '6px 12px' }"
			>
				<Flex @click="handleUseEmbedded" align="center" gap="4" :class="$style.link" data-testid="send-fee-back-embedded">
					<Icon name="arrow-right" size="10" color="primary" style="transform: rotate(180deg)" />
					<Text size="12" weight="600" color="primary">Use app's payment</Text>
				</Flex>
			</Flex>

			<!-- Degraded fee data (silent retry pending) -->
			<Flex v-if="statusNotice" align="start" gap="6" wide :class="$style.detail_row" data-testid="fee-init-degraded">
				<Icon name="info" size="14" color="primary" />
				<Text size="12" weight="600" color="secondary" :style="{ paddingTop: '1px' }">
					{{ statusNotice }}
				</Text>
			</Flex>

			<FeeMethodRow
				v-else
				:method="effectiveMethod"
				:isLoading="isLoading"
				:feeJuiceBalanceFormatted="feeJuiceBalanceFormatted"
				:privateFeeJuiceFormatted="privateFeeJuiceFormatted"
			/>

			<!-- The fee payer is public: on a private-origin send, the account's own Fee Juice names the sender. -->
			<Flex
				v-if="payerNotice"
				align="start"
				gap="8"
				:class="$style.detail_row"
				data-testid="send-fee-privacy-notice"
				:data-notice-shape="payerNotice.shape"
			>
				<Icon name="warning" size="14" :class="$style.payer_notice_icon" />
				<Flex direction="column" gap="4" :style="{ flex: 1, minWidth: 0 }">
					<Text size="12" weight="700" color="primary">{{ payerNotice.title }}</Text>
					<Text size="11" weight="500" color="tertiary" height="140">{{ payerNotice.body }}</Text>
					<a
						:href="FEE_JUICE_BRIDGE_URL"
						target="_blank"
						rel="noopener noreferrer"
						:class="[$style.get_fee_juice, $style.payer_notice_remedy]"
						data-testid="send-fee-privacy-remedy"
					>Get private gas</a>
				</Flex>
			</Flex>

			<!-- Get-fee-juice nudge: the selected method has no fee juice to pay with. -->
			<Flex v-if="feeJuiceMissing" align="center" gap="8" :class="$style.detail_row" data-testid="send-fee-nudge">
				<Icon name="warning" size="14" color="secondary" />
				<Flex direction="column" gap="2" :style="{ flex: 1, minWidth: 0 }">
					<Text size="12" weight="600" color="primary">{{ nudgeCopy.title }}</Text>
					<Text size="11" weight="500" color="tertiary">{{ nudgeCopy.body }}</Text>
				</Flex>
				<a
					:href="FEE_JUICE_BRIDGE_URL"
					target="_blank"
					rel="noopener noreferrer"
					:class="$style.get_fee_juice"
					data-testid="send-fee-get-juice"
				>{{ nudgeCopy.link }}</a>
			</Flex>

			<FeeCostReadout
				v-if="effectiveMethod && !feeJuiceMissing"
				:estimate="estimatedFeeDisplay"
				:isEstimating="isEstimating"
			/>

			<FeePriorityRow v-if="effectiveMethod && !feeJuiceMissing" v-model="selectedPriority" />
		</template>
	</Flex>
</template>

<style module>
.wrapper {
	border: 1px solid var(--nulo-outline);
	overflow: hidden;
}

.embedded {
	border: none;
}

.card {
	padding: 12px;
}

.detail_row {
	composes: detail_row from "./fee-shared.module.css";
}

.link {
	cursor: pointer;

	& span,
	& svg {
		transition: all 0.2s var(--bezier);
	}

	&:hover {
		& span {
			color: var(--txt-primary);
		}

		& svg {
			fill: var(--txt-primary);
		}
	}
}

.get_fee_juice {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nulo-accent);
	white-space: nowrap;
	cursor: pointer;

	&:hover {
		text-decoration: underline;
	}
}

.payer_notice_icon {
	flex: none;
	color: var(--orange);
}

.payer_notice_remedy {
	align-self: flex-start;
	margin-top: 2px;
	color: var(--orange);
	text-decoration: underline;
	text-underline-offset: 4px;
}

</style>
