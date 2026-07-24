<script setup>
/** Utils */
import { purgeNumber, normalizeAmount, clampDecimals, comma, formatBaseUnits } from "@/utils/amount"
import { usdToTokenAmount, tokenAmountToUsdMicro, formatUsdMicro, usdMicroToPlainString } from "@/wallet/services/price/convert"

const props = defineProps({
	token: {
		type: Object,
		required: false,
	},
	tokenBalanceByType: Number,
	/** Raw base-units balance for the selected send type (string). Powers the
	 *  bigint-exact fiat-mode Max/Half — the display-unit `tokenBalanceByType`
	 *  Number path stays for token mode (pre-existing behavior, preserved). */
	balanceRawByType: { type: String, required: false, default: null },
	/** Live usable quote for the selected token ({ usd, fetchedAt }) or null.
	 *  Null hides all fiat UI (and the fiat-input toggle). */
	liveQuote: { type: Object, required: false, default: null },
	/** Proxy ticker for honest labeling (e.g. "USDC" → `≈ $12.34 via USDC`). */
	proxyTicker: { type: String, required: false, default: null },
})

/** Token amount string — ALWAYS the value that validates + sends, in both
 *  modes. In fiat mode it is derived (round-DOWN, bigint) at the FROZEN
 *  session quote and shown on the secondary line: what you see is what sends. */
const model = defineModel()
/** Fiat-input mode flag (parent reads it for submit gating). */
const fiatMode = defineModel("fiatMode", { default: false })
/**
 * C3 quote-consistency guard, owned here, ENFORCED by the parent's submit
 * gate: null outside fiat mode; { frozenUsd, frozenAt, converting } inside.
 * `converting` is true while the debounced fiat→token derivation is pending —
 * submit must stay disabled until it lands.
 */
const fiatGuard = defineModel("fiatGuard", { default: null })

const inputEl = useTemplateRef("inputEl")

const tokenDecimals = computed(() => (typeof props.token?.decimals === "number" ? props.token.decimals : undefined))

/** True when the user typed more decimal places than the token supports
 *  and the input was clamped on the most recent keystroke. Drives the
 *  "Token supports N decimals" inline hint. Cleared when the user
 *  brings the input back within range or clears the field. */
const wasClamped = ref(false)

onMounted(() => {
	if (props.tokenBalanceByType) inputEl.value.focus()
})

const handleAmountInput = (e) => {
	const purgedAmount = purgeNumber(model.value)

	model.value = purgedAmount

	if (["0", ","].includes(e.data) && model.value.length === 1) model.value = "0."

	const normalizedAmount = normalizeAmount(purgedAmount)
	if (typeof normalizedAmount === "string") {
		model.value = normalizedAmount
	}

	// Clamp decimal places to the token's `decimals`. If the typed value
	// had more, surface a small inline hint so the truncation is visible.
	if (tokenDecimals.value !== undefined) {
		const before = model.value
		const clamped = clampDecimals(model.value, tokenDecimals.value)
		if (clamped !== before) {
			model.value = clamped
			wasClamped.value = true
		} else {
			wasClamped.value = false
		}
	}
}

/** When the active token changes, re-clamp whatever the user previously
 *  typed so a token swap (e.g. 18-dec → 6-dec) doesn't leave a value
 *  the new token can't accept. */
watch(
	() => tokenDecimals.value,
	(newDecimals) => {
		if (newDecimals === undefined || !model.value) return
		const stringy = typeof model.value === "string" ? model.value : String(model.value)
		const clamped = clampDecimals(stringy, newDecimals)
		if (clamped !== stringy) {
			model.value = clamped
			wasClamped.value = true
		}
	},
)

const isFocused = ref(false)
const handleAmountFocus = () => {
	if (props.tokenBalanceByType) isFocused.value = true
}
const handleAmountBlur = () => {
	isFocused.value = false

	if (!model.value) return
	if (model.value.toString().includes(",")) return model.value

	// Cap the post-blur formatting at the token's decimals (was hardcoded 8;
	// tokens with >8 decimals were silently rounded). Falls back to 8 when
	// decimals unknown, matching prior behavior.
	const fixed = tokenDecimals.value !== undefined ? Math.min(tokenDecimals.value, 8) : 8
	model.value = comma(model.value, ",", fixed)
}

// ── C3: fiat-denominated input ──────────────────────────────────────────

const CONVERT_DEBOUNCE_MS = 250

const fiatTerm = ref("")
let convertTimer = null

const canUseFiatInput = computed(() => props.liveQuote != null && tokenDecimals.value !== undefined)

/** Token base units currently expressed by `model` (both modes), for display. */
const modelRaw = computed(() => {
	if (tokenDecimals.value === undefined) return null
	const stringy = typeof model.value === "string" ? model.value : model.value?.toString()
	if (!stringy) return null
	const plain = purgeNumber(stringy)
	const match = /^(\d*)(?:\.(\d*))?$/.exec(plain)
	if (!match) return null
	const frac = (match[2] ?? "").slice(0, tokenDecimals.value).padEnd(tokenDecimals.value, "0")
	return BigInt(match[1] || "0") * 10n ** BigInt(tokenDecimals.value) + BigInt(frac || "0")
})

/** Token-mode conversion line — LIVE quote (display-only; freezing applies to
 *  the fiat-INPUT session, where the quote derives the send amount). Empty
 *  input shows the UNIT RATE, not a warning — "Price unavailable" is reserved
 *  for genuinely unpriced tokens (the pre-input warning was a bug). */
const unitRateLabel = computed(() => {
	if (!props.liveQuote || tokenDecimals.value === undefined) return null
	const unitMicro = tokenAmountToUsdMicro(10n ** BigInt(tokenDecimals.value), tokenDecimals.value, props.liveQuote.usd)
	return `1 ${props.token?.symbol ?? "token"} ≈ ${formatUsdMicro(unitMicro)}`
})

const tokenModeFiatLabel = computed(() => {
	if (!props.liveQuote) return null
	if (modelRaw.value === null || modelRaw.value === 0n) return unitRateLabel.value
	const micro = tokenAmountToUsdMicro(modelRaw.value, tokenDecimals.value, props.liveQuote.usd)
	return `≈ ${formatUsdMicro(micro)}`
})

/** Proxy provenance moved off the line into a tooltip (G1b). */
const conversionTitle = computed(() => (props.proxyTicker ? `Priced via ${props.proxyTicker}, at today's rate` : "At today's rate"))

/** Corner balance segment: amount + symbol only — the From selector above
 *  already names the private/public side, so no dot/word repeats it here. */
const balanceSegment = computed(() => {
	if (!props.token || !props.tokenBalanceByType) return null
	return `${comma(props.tokenBalanceByType, ",", 8)} ${props.token.symbol}`
})

/** Fiat-mode secondary line: the DERIVED token amount that will send;
 *  the unit rate while the field is still empty. */
const derivedTokenLabel = computed(() => {
	if (modelRaw.value === null || (modelRaw.value === 0n && !fiatTerm.value)) return unitRateLabel.value
	return `≈ ${formatBaseUnits(modelRaw.value, tokenDecimals.value, { thousandsSep: ",", decimalSep: "." })} ${props.token?.symbol ?? ""}`
})

const writeModelFromRaw = (raw) => {
	// Plain machine format (no separators) — this exact string is what the
	// parent validates and integerizes; it IS the amount that sends.
	model.value = formatBaseUnits(raw, tokenDecimals.value, { thousandsSep: "", decimalSep: "." })
}

const scheduleConvert = () => {
	if (!fiatGuard.value) return
	fiatGuard.value = { ...fiatGuard.value, converting: true }
	clearTimeout(convertTimer)
	convertTimer = setTimeout(() => {
		const guard = fiatGuard.value
		if (!guard) return
		const raw = fiatTerm.value ? usdToTokenAmount(purgeNumber(fiatTerm.value), tokenDecimals.value, guard.frozenUsd) : null
		if (raw !== null) {
			writeModelFromRaw(raw)
		} else {
			model.value = ""
		}
		fiatGuard.value = { ...guard, converting: false }
	}, CONVERT_DEBOUNCE_MS)
}

const handleFiatInput = () => {
	let purged = purgeNumber(fiatTerm.value)
	// A bare leading dot (".5") parses to null downstream — normalize to "0.5",
	// matching the token-mode input's behavior.
	if (purged.startsWith(".")) purged = `0${purged}`
	// USD input caps at micro precision; extra digits are truncated (round-down).
	const match = /^(\d*)(?:\.(\d*))?$/.exec(purged)
	if (match?.[2] !== undefined && match[2].length > 6) {
		purged = `${match[1]}.${match[2].slice(0, 6)}`
	}
	fiatTerm.value = purged
	scheduleConvert()
}

/** Entering fiat mode FREEZES the session quote: background refreshes never
 *  re-derive the send amount mid-edit. Leaving clears the guard. */
const toggleFiatMode = () => {
	if (!fiatMode.value) {
		if (!canUseFiatInput.value) return
		fiatMode.value = true
		fiatGuard.value = { frozenUsd: props.liveQuote.usd, frozenAt: Date.now(), converting: false }
		// Seed the fiat field from the current token amount at the frozen rate.
		fiatTerm.value =
			modelRaw.value !== null && modelRaw.value > 0n
				? usdMicroToPlainString(tokenAmountToUsdMicro(modelRaw.value, tokenDecimals.value, props.liveQuote.usd))
				: ""
	} else {
		fiatMode.value = false
		fiatGuard.value = null
		clearTimeout(convertTimer)
	}
}

/** A token swap mid-fiat-session would silently keep the OLD token's frozen
 *  quote (and could leave fiat mode active with the toggle hidden for an
 *  unpriced successor) — exit fiat mode whenever the token identity changes.
 *  Identity is chainId + contract: the same address on another chain is a
 *  DIFFERENT token (and a different price-map entry). */
watch(
	() => (props.token ? `${props.token.chainId}:${props.token.contract}` : null),
	(next, prev) => {
		if (next === prev || !fiatMode.value) return
		exitFiatMode({ clearAmount: true })
	},
)
/** Quote lost mid-session: the toggle hides and requote is a no-op without a
 *  live quote — fiat mode would be stuck. Exit instead. */
watch(canUseFiatInput, (can) => {
	if (!can && fiatMode.value) exitFiatMode({ clearAmount: true })
})
/**
 * Watch-driven exits are FAIL-CLOSED: they also clear the amount. Leaving the
 * fiat-derived token amount sendable after the session's basis vanished (quote
 * lost/expired, token swapped) would silently convert a blocked fiat submit
 * into an allowed token-mode submit of a possibly-stale derivation. The
 * user-driven toggle exit keeps the amount — that swap is the G1b design.
 */
function exitFiatMode({ clearAmount = false } = {}) {
	fiatMode.value = false
	fiatGuard.value = null
	clearTimeout(convertTimer)
	if (clearAmount) {
		model.value = ""
		fiatTerm.value = ""
	}
}

/** Parent-driven re-freeze after a stale/moved-quote block: re-derives the
 *  send amount at the CURRENT quote — the user sees the new derived token
 *  amount before confirming. */
const refreezeQuote = () => {
	if (!fiatMode.value || !props.liveQuote) return
	fiatGuard.value = { frozenUsd: props.liveQuote.usd, frozenAt: Date.now(), converting: false }
	scheduleConvert()
}
defineExpose({ refreezeQuote })

onBeforeUnmount(() => {
	clearTimeout(convertTimer)
})

const handleFocus = () => {
	if (props.tokenBalanceByType) inputEl.value.focus()
}

const handleMax = () => {
	if (!props.tokenBalanceByType) return
	if (fiatMode.value) {
		handleFiatBalanceAction(1n)
		return
	}
	model.value = props.tokenBalanceByType
}

/** Fiat-mode Max/Half: bigint-exact from the RAW balance — the sent amount is
 *  balance-derived (÷ divisor, round-down); the fiat figure is display-only. */
const handleFiatBalanceAction = (divisor) => {
	const guard = fiatGuard.value
	if (!guard || props.balanceRawByType == null) return
	const raw = BigInt(props.balanceRawByType) / divisor
	writeModelFromRaw(raw)
	fiatTerm.value = usdMicroToPlainString(tokenAmountToUsdMicro(raw, tokenDecimals.value, guard.frozenUsd))
	fiatGuard.value = { ...guard, converting: false }
	clearTimeout(convertTimer)
}
</script>

<template>
	<Flex @click="handleFocus" gap="8" direction="column" :class="$style.wrapper">
		<Flex direction="column" gap="4">
			<Flex gap="8" align="baseline" justify="between">
				<input
					v-if="fiatMode"
					ref="inputEl"
					v-model="fiatTerm"
					@input="handleFiatInput"
					@focus="handleAmountFocus"
					:disabled="!tokenBalanceByType"
					placeholder="0.00"
					data-testid="send-amount-fiat-input"
					:class="$style.input_field"
				/>
				<input
					v-else
					ref="inputEl"
					v-model="model"
					@input="handleAmountInput"
					@focus="handleAmountFocus"
					@blur="handleAmountBlur"
					:disabled="!tokenBalanceByType"
					placeholder="0.00"
					data-testid="send-amount-input"
					:class="$style.input_field"
				/>
				<span
					v-if="canUseFiatInput"
					@click.stop="toggleFiatMode"
					data-testid="send-amount-fiat-toggle"
					:title="fiatMode ? `Type in ${token?.symbol || 'token'}` : 'Type in USD'"
					:class="$style.unit_pair"
				>
					<span :class="!fiatMode && $style.unit_on">{{ token?.symbol || "Token" }}</span>
					<span :class="$style.unit_sep">/</span>
					<span :class="fiatMode && $style.unit_on">USD</span>
				</span>
			</Flex>

			<Flex align="center" justify="between" gap="8">
				<span :class="$style.conversion" data-testid="send-amount-meta">
					<template v-if="fiatMode">
						<span v-if="fiatGuard?.converting" :class="$style.skeleton" data-testid="send-amount-converting" />
						<span v-else-if="derivedTokenLabel" :title="conversionTitle" data-testid="send-amount-derived">{{
							derivedTokenLabel
						}}</span>
					</template>
					<template v-else>
						<span v-if="tokenModeFiatLabel" :title="conversionTitle" data-testid="send-amount-fiat-label">{{
							tokenModeFiatLabel
						}}</span>
					</template>
				</span>

				<Flex align="center" gap="8" style="flex: none">
					<span v-if="balanceSegment" data-testid="send-amount-balance" :class="$style.balance_corner">{{ balanceSegment }}</span>
					<span @click="handleMax" data-testid="send-amount-max" :class="$style.action_link">Max</span>
				</Flex>
			</Flex>

			<span v-if="wasClamped && tokenDecimals !== undefined" :class="$style.clamp_hint" data-testid="send-amount-clamp-hint">
				{{ token.symbol || "Token" }} supports {{ tokenDecimals }} decimal{{ tokenDecimals === 1 ? "" : "s" }}
			</span>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	width: 100%;

	cursor: text;
	padding: 8px 0;
}

.input_field {
	width: 100%;
	flex: 1;
	min-width: 0;

	font-family: var(--font-headline);
	font-size: 40px;
	font-weight: 700;
	letter-spacing: -0.04em;
	color: var(--txt-primary);

	&::placeholder {
		color: var(--txt-tertiary);
	}
}

.unit_pair {
	flex: none;
	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.06em;
	color: var(--txt-tertiary);
	cursor: pointer;
	user-select: none;
}

.unit_on {
	color: var(--nulo-accent);
	text-decoration: underline;
	text-underline-offset: 3px;
}

.unit_sep {
	margin: 0 2px;
}

.balance_corner {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
}

.conversion {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
}

.skeleton {
	display: inline-block;
	width: 72px;
	height: 10px;
	background: linear-gradient(90deg, var(--nulo-surface-high) 25%, var(--nulo-surface) 50%, var(--nulo-surface-high) 75%);
	background-size: 200% 100%;
	animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
	0% {
		background-position: 200% 0;
	}
	100% {
		background-position: -200% 0;
	}
}

.clamp_hint {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
	padding-top: 4px;
}

.action_link {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nulo-accent);
	cursor: pointer;

	transition: opacity 0.2s var(--bezier);

	&:hover {
		text-decoration: underline;
	}
}

</style>
