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
})

const FEE_METHOD_LS_KEY = UI_STORAGE_KEYS.FEE_PAYMENT_METHODS

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
/**
 * `methods` is the dropdown list. We pass `gasBalances` only after init
 * completes, so the loading-state items don't briefly flash "no balance"
 * before the first fetch returns. This honors PR #66's stated intent.
 */
const methods = computed(() =>
	buildFeeMethods(registeredFpcs.value, isInitComplete.value ? gasBalances.value : undefined, {
		allowSponsored: props.network?.chainId !== CHAIN_IDS.MAINNET,
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
	const m = selectedMethod.value
	if (!m) return undefined
	return settingsForMethod(m, selectedPriority.value, gasBalances.value)
})

/** True when the selected fee-juice method (public or private) can't pay because
 *  its balance is zero — the trigger for the get-fee-juice nudge (banner + CTA). */
const feeJuiceMissing = computed(() => {
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
})
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
	const fpms = (await storageLocalGet(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}
	fpms[props.account.address] = method
	await storageLocalSet({ [FEE_METHOD_LS_KEY]: fpms })

	if (method.type === "fpc" || method.type === "private_fpc") {
		const idx = cacheStore.feePaymentMethods.findIndex((m) => m.id === methodId)
		const entry = { id: methodId, fpc: method.fpc }
		if (idx === -1) cacheStore.feePaymentMethods.push(entry)
		else cacheStore.feePaymentMethods[idx] = entry
	}
}

const handleMethodPicked = (m) => {
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
	// Replace the full snapshot so address-edit changes propagate to the
	// dropdown trigger and any persisted-fee-method round-trips below.
	// Object replacement (not deep mutation) keeps the derived computed
	// reactive.
	if (selectedMethod.value?.fpc?.id === fpc.id) {
		selectedMethod.value = { ...selectedMethod.value, fpc }
	}
}
const onFpcDeleted = (fpc) => {
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

/** This card's capabilities: both legs, backoff retry while mounted, no
 *  tx-settle refresh and no peek — exactly its pre-store traffic. */
const CARD_CAPS = { legs: ["gas", "fpc"], retry: true, txRefresh: false, peek: false }

// Identity of the last fully-committed snapshot. Lets a background refresh
// (store retry, same-identity watcher refire) keep serving the committed
// snapshot instead of yanking settings — and the Confirm gate behind them —
// for the length of every in-flight window.
let committedKey = null
/** Structured scope of the committed snapshot — the recovery watch's target. */
const committedScope = ref(null)

let subscription = null
let subscribedKey = null

/** Release-before-subscribe on every identity change (codex round 2): the
 *  old key must not stay subscribed — and store-retrying — after the card
 *  moves on. The store resets backoff attempts on the 0→1 retry-capable
 *  transition, reproducing today's fresh-identity-fresh-backoff rule. */
const subscribeTo = (scope, reqKey) => {
	if (subscribedKey === reqKey) return
	subscription?.release()
	subscription = balancesStore.subscribe(scope, CARD_CAPS)
	subscribedKey = reqKey
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
const commitFromEntry = (scope, reqKey, saved, baseline) => {
	const entry = balancesStore.entry(scope)
	if (!entry) return

	// UNKNOWN (undefined) on any failed balance read, never a fabricated zero
	// and never a stale last-good figure — self-paid derivation fails closed.
	// `verified` is exactly that: cleared by every failed refresh. The store
	// retains last-good FPC data per key, matching the old lastGoodFpcKey rule.
	gasBalances.value = entry.gas.verified
	registeredFpcs.value = entry.fpc.data ?? []

	const userPickedDuringInit = selectedMethod.value !== baseline

	if (!userPickedDuringInit) {
		// Resolve saved selection against fresh `methods` by semantic
		// key — never trust the stored `fpc.name`. Returns undefined
		// when the saved fpc.id is dangling (e.g. v3→v4 migration wiped
		// the row, or the user deleted it while the popup was closed).
		const resolved = resolveSavedSelection(saved[scope.accountAddress], methods.value)
		if (resolved) {
			selectedMethod.value = resolved
		} else {
			// A dangling saved selection (e.g. a deleted FPC) is simply ignored — it
			// re-resolves to undefined every time and we fall through to the default. We
			// deliberately do NOT prune it from storage here: a whole-map write would race
			// persistSelection / another mounted FeeSettingsCard and could clobber a newer
			// selection (last-write-wins on a stale snapshot).
			// Fall through to the network's default method: Alpha (mainnet) → Private Fee
			// Juice; every other network → Sponsored FPC (its historical default).
			const preferred =
				props.network?.chainId === CHAIN_IDS.MAINNET
					? methods.value.find((m) => m.type === "private_fpc")
					: methods.value.find((m) => m.fpc?.type === FpcType.DefaultSponsoredFpc)
			selectedMethod.value = preferred ? { ...preferred } : undefined
		}
	}

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

const runInit = async () => {
	try {
		if (!props.network || !props.account || (isCustomMethod.value && !useOwnMethod.value)) {
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
		const reqKey = `${reqProfileId}|${reqNetworkId}|${reqAccount}`
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
		const saved = (await storageLocalGet(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}
		if (saved[props.account.address]) {
			selectedMethod.value = saved[props.account.address]
		}
		// Snapshot the (possibly-prefilled) selection AFTER any pre-fill
		// assignment. If the user picks something during the ensure await,
		// `selectedMethod.value` will be a different reactive proxy reference
		// than `baseline`, and we skip the reconcile path so we don't clobber
		// their choice.
		const baseline = selectedMethod.value

		isLoading.value = true
		subscribeTo(scope, reqKey)
		try {
			// The store fetches the legs with per-leg isolation, timeout, and
			// raw-promise reuse; ensure settles when both requested legs settle,
			// ready OR degraded.
			await balancesStore.ensure(scope, { legs: ["gas", "fpc"] })
		} catch (e) {
			// A superseded ensure means a profile switch fenced this run out —
			// the new identity's own init covers it. Explicit NO-OP: no degraded
			// state, no notice (the drift guard below cannot observe a rejection).
			if (e instanceof EnsureSuperseded) return
			throw e
		}
		// Discard if the profile/network/account switched mid-flight — the props
		// watcher already fired a fresh init for the new identity. Everything
		// past this guard is synchronous (no awaits), so the commit is atomic
		// against the checked identity.
		if (!isMounted || props.profile?.id !== reqProfileId || props.network?.id !== reqNetworkId || props.account?.address !== reqAccount)
			return

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
		isLoading.value = false
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
		void recommit()
	},
)

const recommit = async () => {
	const scope = committedScope.value
	if (!scope || !isMounted) return
	// Mirror runInit's entry conditions: a recovery landing while embedded
	// must die exactly like a retry hitting the old early-return did.
	if (!props.network || !props.account || (isCustomMethod.value && !useOwnMethod.value)) return
	// The recovery targets the committed identity; if props moved on, the
	// identity watcher owns the transition.
	if (props.profile?.id !== scope.profileId || props.network?.id !== scope.networkId || props.account?.address !== scope.accountAddress)
		return
	const saved = (await storageLocalGet(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}
	const baseline = selectedMethod.value
	if (!isMounted) return
	commitFromEntry(scope, `${scope.profileId}|${scope.networkId}|${scope.accountAddress}`, saved, baseline)
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
		const liveKey = `${props.profile?.id}|${props.network?.id}|${props.account?.address}`
		if (liveKey !== committedKey) isInitComplete.value = false
		await runInit()
	},
)
watch([isCustomMethod, useOwnMethod], ([custom, own]) => {
	// Entering the embedded-visible state (a dApp op's v-model flip lands
	// here without any runInit call) releases the subscription, killing the
	// store's retry loop for this key — today's retry-chain death when a
	// retry tick hit the embedded early-return. The useOwnMethod watcher
	// below is the revival path.
	if (custom && !own) releaseSubscription()
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
	console.log(`[fee:${methodId}] mounting`)
	fpcService.connect()
	await runInit()
})
onBeforeUnmount(() => {
	console.log(`[fee:${methodId}] unmounting`)
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
	<Flex direction="column" :class="[$style.wrapper, embedded && $style.embedded]">
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
			<FeeMethodSelector
				:modelValue="selectedMethod"
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
			<Flex v-if="error" align="start" gap="6" wide :class="$style.detail_row" data-testid="fee-init-degraded">
				<Icon name="info" size="14" color="primary" />
				<Text size="12" weight="600" color="secondary" :style="{ paddingTop: '1px' }">
					{{ error }}
				</Text>
			</Flex>

			<FeeMethodRow
				v-else
				:method="selectedMethod"
				:isLoading="isLoading"
				:feeJuiceBalanceFormatted="feeJuiceBalanceFormatted"
				:privateFeeJuiceFormatted="privateFeeJuiceFormatted"
			/>

			<!-- Get-fee-juice nudge: the selected method has no fee juice to pay with. -->
			<Flex v-if="feeJuiceMissing" align="center" gap="8" :class="$style.detail_row" data-testid="send-fee-nudge">
				<Icon name="warning" size="14" color="secondary" />
				<Flex direction="column" gap="2" :style="{ flex: 1, minWidth: 0 }">
					<Text size="12" weight="600" color="primary">You have no fee juice yet</Text>
					<Text size="11" weight="500" color="tertiary">Bridge some to cover the network fee.</Text>
				</Flex>
				<a
					:href="FEE_JUICE_BRIDGE_URL"
					target="_blank"
					rel="noopener noreferrer"
					:class="$style.get_fee_juice"
					data-testid="send-fee-get-juice"
				>Get fee juice</a>
			</Flex>

			<FeeCostReadout
				v-if="selectedMethod && !feeJuiceMissing"
				:estimate="estimatedFeeDisplay"
				:isEstimating="isEstimating"
			/>

			<FeePriorityRow v-if="selectedMethod && !feeJuiceMissing" v-model="selectedPriority" />
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
	background: transparent;
	overflow: hidden;
	border-top: 1px solid rgba(74, 70, 63, 0.2);

	padding: 10px 12px;
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

</style>
