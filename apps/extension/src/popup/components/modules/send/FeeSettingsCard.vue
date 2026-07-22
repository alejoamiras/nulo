<script setup>
/** Components */
import FeeMethodRow from "./FeeMethodRow.vue"
import FeeCostReadout from "./FeeCostReadout.vue"
import FeePriorityRow from "./FeePriorityRow.vue"
import FeeMethodSelector from "./FeeMethodSelector.vue"

/** Vendor */
import { getRandomHex } from "@/wallet/utils"
import { getErrorData, getErrorMessage } from "@nulo/wallet-core/utils"
import { UI_STORAGE_KEYS } from "@/popup/constants/storage-keys"

/** Utils */
import { storageLocalGet, storageLocalSet } from "@/utils/storage"

/** Services */
import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"
import { ExecutionServiceClient } from "@/wallet/services/execution/client"
import { PriceServiceClient } from "@/wallet/services/price/client"

/** Helpers */
import { buildFeeMethods, formatGasBalance, resolveSavedSelection, settingsForMethod } from "./fee-helpers"
import { feeJuicePricingFromUsd, feeToUsd } from "@/utils/fee-estimation"
import { usePrices } from "@/composables/usePrices"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Stores */
import { useCacheStore } from "@/stores/cache.store"
const cacheStore = useCacheStore()

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
const methods = computed(() => buildFeeMethods(registeredFpcs.value, isInitComplete.value ? gasBalances.value : undefined))

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

const gasBalances = ref({ publicFeeJuice: "0", privateFeeJuice: null })
const isLoading = ref(false)
const error = ref("")

const feeJuiceBalanceFormatted = computed(() => formatGasBalance(gasBalances.value.publicFeeJuice))
const privateFeeJuiceFormatted = computed(() =>
	gasBalances.value.privateFeeJuice !== null ? formatGasBalance(gasBalances.value.privateFeeJuice) : null,
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
	return settingsForMethod(m, selectedPriority.value, gasBalances.value.publicFeeJuice, gasBalances.value.privateFeeJuice)
})

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

const executionService = new ExecutionServiceClient()

// Coalesces concurrent init() invocations. `onBeforeMount` and the
// props watcher both fire init() when the component mounts with
// populated props, and the SW's PXE is single-threaded — letting
// two parallel getGasBalances/getFpcs pairs queue up caused the
// 60s timeout regression users hit during QA.
let initInFlight = null
let initRequested = false
let isMounted = true

const init = async () => {
	if (!isMounted) return
	if (initInFlight) {
		initRequested = true
		return initInFlight
	}
	initRequested = false
	initInFlight = runInit().finally(() => {
		initInFlight = null
		if (initRequested && isMounted) {
			initRequested = false
			void init()
		}
	})
	return initInFlight
}

const runInit = async () => {
	try {
		if (!props.network || !props.account || (isCustomMethod.value && !useOwnMethod.value)) return

		// Re-arm the gate. Anything that read derivedSettings while it was
		// `true` from a previous init now reads `undefined` until we
		// re-resolve.
		isInitComplete.value = false

		// Pre-fill from local storage BEFORE the slow SW fetch so the
		// dropdown trigger displays the user's last-used method while the
		// fetch is in flight. The `isInitComplete` gate ensures this
		// pre-fill doesn't drive settings derivation against stale state.
		const saved = (await storageLocalGet(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}
		if (saved[props.account.address]) {
			selectedMethod.value = saved[props.account.address]
		}
		// Snapshot the (possibly-prefilled) selection AFTER any pre-fill
		// assignment. If the user picks something during the Promise.all
		// await, `selectedMethod.value` will be a different reactive
		// proxy reference than `baseline`, and we skip the reconcile
		// path so we don't clobber their choice.
		const baseline = selectedMethod.value

		isLoading.value = true
		const [gasResult, fpcs] = await Promise.all([
			executionService.getGasBalances(props.network.id, props.account.address),
			fpcService.getFpcs(props.network.chainId),
		])
		gasBalances.value = gasResult
		registeredFpcs.value = fpcs ?? []

		const userPickedDuringInit = selectedMethod.value !== baseline

		if (!userPickedDuringInit) {
			// Resolve saved selection against fresh `methods` by semantic
			// key — never trust the stored `fpc.name`. Returns undefined
			// when the saved fpc.id is dangling (e.g. v3→v4 migration wiped
			// the row, or the user deleted it while the popup was closed).
			const resolved = resolveSavedSelection(saved[props.account.address], methods.value)
			if (resolved) {
				selectedMethod.value = resolved
			} else {
				if (saved[props.account.address]) {
					delete saved[props.account.address]
					await storageLocalSet({ [FEE_METHOD_LS_KEY]: saved })
				}
				// Fall through to auto-select: prefer sponsored if registered.
				const sponsoredMethod = methods.value.find((m) => m.fpc?.type === FpcType.DefaultSponsoredFpc)
				selectedMethod.value = sponsoredMethod ? { ...sponsoredMethod } : undefined
			}
		}

		isInitComplete.value = true
	} catch (e) {
		console.error("Failed to init", getErrorData(e))
		error.value = getErrorMessage(e)
	} finally {
		isLoading.value = false
	}
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
		await init()
	},
)
watch(useOwnMethod, async (val) => {
	// Switching from embedded → "use my own" needs to load balances/fpcs
	// for the dropdown. Pre-#fix this was broken: clicking "Override with
	// my method" on an embedded op never triggered the fetch pipeline.
	if (val && !isInitComplete.value) {
		await init()
	}
})

onBeforeMount(async () => {
	console.log(`[fee:${methodId}] mounting`)
	fpcService.connect()
	await init()
})
onBeforeUnmount(() => {
	console.log(`[fee:${methodId}] unmounting`)
	// Cancel any pending init re-run before tearing down the clients, so
	// the queued void init() can't fire against disconnected clients or
	// torn-down refs.
	isMounted = false
	initRequested = false
	fpcService.disconnect()
	executionService.disconnect()
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

			<!-- Error -->
			<Flex v-if="error" align="start" gap="6" wide :class="$style.detail_row">
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

			<FeeCostReadout
				v-if="selectedMethod"
				:estimate="estimatedFeeDisplay"
				:isEstimating="isEstimating"
			/>

			<FeePriorityRow v-if="selectedMethod" v-model="selectedPriority" />
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

</style>
