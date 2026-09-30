<script setup>
/** Utils */
import { clampDecimals, formatBaseUnits, readAmountText } from "@/utils/amount"
import { fitHero } from "@/utils/hero-fit"
import { inputRoom, rulerWidth } from "@/utils/hero-ruler"
import { usdToTokenAmount, tokenAmountToUsdMicro, formatUsdMicro, usdMicroToPlainString } from "@/wallet/services/price/convert"
import { caretAfter, nextAmountText, restingAmount } from "./amount-field"

const props = defineProps({
	token: {
		type: Object,
		required: false,
	},
	tokenBalanceByType: Number,
	/** The selected side's balance in base units, as a digit string; null until it loads. Every
	 *  balance digit Max fills or the corner shows comes from it: `tokenBalanceByType` is a float. */
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
 * The quote-consistency guard, owned here, ENFORCED by the parent's submit
 * gate: null outside fiat mode; { frozenUsd, frozenAt, converting } inside.
 * `converting` is true while the debounced fiat→token derivation is pending —
 * submit must stay disabled until it lands.
 */
const fiatGuard = defineModel("fiatGuard", { default: null })
/**
 * `rested` is text the card itself wrote at rest (the blur, Max, a re-clamp): only it reads its
 * commas as the wallet's grouping. Every other write and every edit clears it, an edit only after
 * reading the prior text with it, so it never matches later text. The comma point marks the text's
 * one "." as one a typed comma wrote, and lasts while that point does.
 */
const rested = defineModel("rested", { default: null })
let commaPoint = false
/** The text the card last wrote or the page last set: the prior text of the next edit. */
let lastText = String(model.value ?? "")

const inputEl = useTemplateRef("inputEl")
const fieldRuler = useTemplateRef("fieldRuler")

const tokenDecimals = computed(() => (typeof props.token?.decimals === "number" ? props.token.decimals : undefined))

/** True when the user typed more decimal places than the token supports
 *  and the input was clamped on the most recent keystroke. Drives the
 *  "Token supports N decimals" inline hint. Cleared when the user
 *  brings the input back within range or clears the field. */
const wasClamped = ref(false)
/** Why the field's text reads as no one amount ("unreadable" or "ambiguous"): shown at once after a
 *  paste, after a keystroke once the field is left, and gone once the text reads or empties. */
const readHint = ref(null)

onMounted(() => {
	if (props.tokenBalanceByType) inputEl.value.focus()
	fitField()
	document.fonts?.addEventListener("loadingdone", fitField)
})

/** Every write of the token amount goes through here, so the next edit starts from it. */
function writeAmount(text, { atRest = false, point = false } = {}) {
	lastText = text
	commaPoint = point
	rested.value = atRest ? text : null
	model.value = text
}

/** Shows `text` in the input with the caret before the digits that followed it, where a browser
 *  would put it at the end. */
function showText(input, text) {
	if (input.value === text) return
	const caret = caretAfter(input.value, input.selectionEnd ?? input.value.length, text)
	input.value = text
	input.setSelectionRange(caret, caret)
}

// The field's only input listener, bound one way: a browser flushes microtasks between two listeners
// of one keystroke, so a v-model write of the raw text would reach the page, and come back through
// the model watcher below, before this read its prior text.
const handleAmountInput = (e) => {
	const next = nextAmountText({
		prior: lastText,
		value: e.target.value,
		inputType: e.inputType,
		data: e.data,
		decimals: tokenDecimals.value,
		rested: rested.value,
		commaPoint,
		hint: readHint.value,
	})
	wasClamped.value = next.hint === "clamp"
	readHint.value = next.hint === "clamp" ? null : next.hint
	writeAmount(next.text, { point: next.commaPoint })
	// When the text equals what the parent already holds, no re-render comes to correct the field.
	showText(e.target, next.text)
}

// A write from the page (a token pick clears the amount) ends the card's own state.
watch(model, (value) => {
	const text = String(value ?? "")
	if (text === lastText) return
	lastText = text
	commaPoint = false
	rested.value = null
	readHint.value = null
})

/** When the active token changes, re-clamp an amount that reads, so a token swap (e.g. 18-dec →
 *  6-dec) doesn't leave a value the new token can't accept; held text stays as it is. */
watch(
	() => tokenDecimals.value,
	(newDecimals) => {
		if (newDecimals === undefined || !model.value) return
		const read = readAmountText(String(model.value), { rested: rested.value })
		if (!read.ok) return
		const clamped = clampDecimals(read.plain, newDecimals)
		if (clamped === read.plain) return
		writeAmount(restingAmount(clamped, newDecimals), { atRest: true })
		wasClamped.value = true
	},
)

const isFocused = ref(false)
const handleAmountFocus = () => {
	if (props.tokenBalanceByType) isFocused.value = true
	fieldScale.value = 1
}
const handleAmountBlur = () => {
	isFocused.value = false
	if (!model.value || tokenDecimals.value === undefined) return
	const read = readAmountText(String(model.value), { rested: rested.value })
	if (!read.ok) {
		readHint.value = read.reason
		return
	}
	const rest = restingAmount(read.plain, tokenDecimals.value)
	writeAmount(rest, { atRest: true, point: commaPoint && rest.includes(".") })
}

/** The token field's type as a fraction of its 40 px: full with focus, and at rest the largest
 *  that shows the whole amount, however small. */
const fieldScale = ref(1)
function fitField() {
	const input = inputEl.value
	const form = fieldRuler.value
	if (fiatMode.value || !input || !form) return
	// Both: the fiat input sets `isFocused` and never clears it, and a window losing focus blurs the
	// field while leaving it the document's active element.
	const typing = isFocused.value && document.activeElement === input
	fieldScale.value = typing ? 1 : fitHero(1, (_, scale) => rulerWidth(form, scale), inputRoom(input)).scale
}

// ── Fiat-denominated input ──────────────────────────────────────────

const CONVERT_DEBOUNCE_MS = 250

const fiatTerm = ref("")
let convertTimer = null

const canUseFiatInput = computed(() => props.liveQuote != null && tokenDecimals.value !== undefined)

/** Token base units currently expressed by `model` (both modes), for display. */
const modelRaw = computed(() => {
	if (tokenDecimals.value === undefined) return null
	const read = readAmountText(String(model.value ?? ""), { rested: rested.value })
	if (!read.ok) return null
	const [whole, fraction = ""] = read.plain.split(".")
	const frac = fraction.slice(0, tokenDecimals.value).padEnd(tokenDecimals.value, "0")
	return BigInt(whole || "0") * 10n ** BigInt(tokenDecimals.value) + BigInt(frac || "0")
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

/** The two amounts the field's ambiguous text can be ("1,234": 1234 or 1.234), named from it. */
const ambiguousReadings = computed(() => {
	const text = String((fiatMode.value ? fiatTerm.value : model.value) ?? "")
		.trim()
		.replace(/^\$/, "")
	return [text.replace(",", ""), text.replace(",", ".")]
})

/** The conversion line's tooltip names the price's proxy, if any. */
const conversionTitle = computed(() => (props.proxyTicker ? `Priced via ${props.proxyTicker}, at today's rate` : "At today's rate"))

/** Corner balance segment: amount + symbol only — the From selector above
 *  already names the private/public side, so no dot/word repeats it here.
 *  Truncated at 8 places, so it never reads more than the balance. */
const balanceSegment = computed(() => {
	if (!props.token || !props.tokenBalanceByType || props.balanceRawByType == null || tokenDecimals.value === undefined) return null
	const amount = formatBaseUnits(props.balanceRawByType, tokenDecimals.value, { maxDecimals: 8, thousandsSep: ",", decimalSep: "." })
	return `${amount} ${props.token.symbol}`
})

/** Fiat-mode secondary line: the DERIVED token amount that will send;
 *  the unit rate while the field is still empty. */
const derivedTokenLabel = computed(() => {
	if (modelRaw.value === null || (modelRaw.value === 0n && !fiatTerm.value)) return unitRateLabel.value
	return `≈ ${formatBaseUnits(modelRaw.value, tokenDecimals.value, { thousandsSep: ",", decimalSep: "." })} ${props.token?.symbol ?? ""}`
})

const plainAmount = (raw) => formatBaseUnits(raw, tokenDecimals.value, { thousandsSep: "", decimalSep: "." })

const writeModelFromRaw = (raw) => {
	writeAmount(plainAmount(raw))
}

let fiatLastText = ""
let fiatCommaPoint = false
/** Every write of the USD text goes through here, so its next edit starts from it. */
function writeFiat(text, point = false) {
	fiatLastText = text
	fiatCommaPoint = point
	fiatTerm.value = text
}

/** A USD reading takes a "0" before a bare point (`parseUsdToMicro` refuses ".5") and is cut to
 *  micro precision, rounding down; a text that needs neither stays as written. */
function usdText(text) {
	const read = readAmountText(text, { currency: "$" })
	if (!read.ok) return text
	const fixed = clampDecimals(read.plain.startsWith(".") ? `0${read.plain}` : read.plain, 6)
	return fixed === read.plain ? text : fixed
}

const scheduleConvert = (base = fiatGuard.value) => {
	if (!base) return
	fiatGuard.value = { ...base, converting: true }
	clearTimeout(convertTimer)
	convertTimer = setTimeout(() => {
		const guard = fiatGuard.value
		if (!guard) return
		const read = readAmountText(fiatTerm.value, { currency: "$" })
		const raw = read.ok ? usdToTokenAmount(read.plain, tokenDecimals.value, guard.frozenUsd) : null
		if (raw !== null) {
			writeModelFromRaw(raw)
		} else {
			writeAmount("")
		}
		fiatGuard.value = { ...guard, converting: false }
	}, CONVERT_DEBOUNCE_MS)
}

const handleFiatInput = (e) => {
	const next = nextAmountText({
		prior: fiatLastText,
		value: e.target.value,
		inputType: e.inputType,
		data: e.data,
		commaPoint: fiatCommaPoint,
		hint: readHint.value,
		currency: "$",
	})
	readHint.value = next.hint
	const text = usdText(next.text)
	// Before the write, so v-model's re-render finds the text in place and leaves the caret.
	showText(e.target, text)
	writeFiat(text, next.commaPoint && text.includes("."))
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
		writeFiat(
			modelRaw.value !== null && modelRaw.value > 0n
				? usdMicroToPlainString(tokenAmountToUsdMicro(modelRaw.value, tokenDecimals.value, props.liveQuote.usd))
				: "",
		)
	} else {
		fiatMode.value = false
		fiatGuard.value = null
		clearTimeout(convertTimer)
	}
	readHint.value = null
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
// After the render, so the ruler holds what the field shows; the fiat toggle takes the field's width.
watch([model, isFocused, fiatMode, canUseFiatInput], fitField, { flush: "post" })
/**
 * Watch-driven exits are FAIL-CLOSED: they also clear the amount. Leaving the
 * fiat-derived token amount sendable after the session's basis vanished (quote
 * lost/expired, token swapped) would silently convert a blocked fiat submit
 * into an allowed token-mode submit of a possibly-stale derivation. The
 * user-driven toggle exit keeps the amount.
 */
function exitFiatMode({ clearAmount = false } = {}) {
	fiatMode.value = false
	fiatGuard.value = null
	readHint.value = null
	clearTimeout(convertTimer)
	if (clearAmount) {
		writeAmount("")
		writeFiat("")
	}
}

/** Parent-driven re-freeze after a stale/moved-quote block: re-derives the
 *  send amount at the CURRENT quote — the user sees the new derived token
 *  amount before confirming. */
const refreezeQuote = () => {
	if (!fiatMode.value || !props.liveQuote) return
	// Handed over, not written first: `fiatGuard.value` reads the page's old quote until it re-renders.
	scheduleConvert({ frozenUsd: props.liveQuote.usd, frozenAt: Date.now(), converting: false })
}
defineExpose({ refreezeQuote })

onBeforeUnmount(() => {
	clearTimeout(convertTimer)
	document.fonts?.removeEventListener("loadingdone", fitField)
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
	if (props.balanceRawByType == null || tokenDecimals.value === undefined) return
	// Max's click stops short of the card's focus, so no blur rests the amount: it is written at rest,
	// in one write, as `model.value` reads the page's old value until the page re-renders.
	writeAmount(restingAmount(plainAmount(BigInt(props.balanceRawByType)), tokenDecimals.value), { atRest: true })
	readHint.value = null
}

/** Fiat-mode Max/Half: bigint-exact from the RAW balance — the sent amount is
 *  balance-derived (÷ divisor, round-down); the fiat figure is display-only. */
const handleFiatBalanceAction = (divisor) => {
	const guard = fiatGuard.value
	if (!guard || props.balanceRawByType == null) return
	const raw = BigInt(props.balanceRawByType) / divisor
	writeModelFromRaw(raw)
	writeFiat(usdMicroToPlainString(tokenAmountToUsdMicro(raw, tokenDecimals.value, guard.frozenUsd)))
	readHint.value = null
	fiatGuard.value = { ...guard, converting: false }
	clearTimeout(convertTimer)
}
</script>

<template>
	<Flex @click="handleFocus" gap="8" direction="column" :class="$style.wrapper">
		<Flex direction="column" gap="4">
			<Flex gap="8" justify="between" data-testid="send-amount-row">
				<div :class="$style.field_line">
					<input
						v-if="fiatMode"
						ref="inputEl"
						v-model="fiatTerm"
						@input="handleFiatInput"
						@focus="handleAmountFocus"
						:disabled="!tokenBalanceByType"
						placeholder="0.00"
						data-testid="send-amount-fiat-input"
						:class="[$style.input_field, $style.field_type]"
					/>
					<input
						v-else
						ref="inputEl"
						:value="model"
						@input="handleAmountInput"
						@focus="handleAmountFocus"
						@blur="handleAmountBlur"
						:disabled="!tokenBalanceByType"
						placeholder="0.00"
						data-testid="send-amount-input"
						:class="[$style.input_field, $style.field_type]"
						:style="{ '--hero-scale': fieldScale }"
					/>
					<!-- The fit's ruler: it shares the field's `field_type` class, or the two widths part. -->
					<span aria-hidden="true" :class="$style.field_ruler"><span ref="fieldRuler" :class="$style.field_type">{{ model }}</span></span>
				</div>
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
					<span @click.stop="handleMax" data-testid="send-amount-max" :class="$style.action_link">Max</span>
				</Flex>
			</Flex>

			<!-- A read hint first: the clamp hint can outlive a switch to USD, a read hint never outlives its text. -->
			<span v-if="readHint === 'unreadable'" :class="$style.clamp_hint" data-testid="send-amount-unreadable-hint">
				Not an amount. Type it like 1234.56
			</span>
			<span v-else-if="readHint === 'ambiguous'" :class="$style.clamp_hint" data-testid="send-amount-ambiguous-hint">
				Is that {{ ambiguousReadings[0] }} or {{ ambiguousReadings[1] }}? Type the one you mean.
			</span>
			<span v-else-if="wasClamped && tokenDecimals !== undefined" :class="$style.clamp_hint" data-testid="send-amount-clamp-hint">
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

/* The line keeps the full size's height and baseline while the amount's type shrinks, so nothing
 * below it moves. */
.field_line {
	position: relative;
	flex: 1;
	min-width: 0;

	white-space: nowrap;
}

/* A zero-width strut in the full type, with the input's vertical padding. The unit toggle holds
 * one too, so its label sits on the amount's baseline and its box, the press target, still fills
 * the row. */
.field_line::after,
.unit_pair::before {
	content: "\200b";
	display: inline-block;
	width: 0;
	padding-block: 1px;

	font-family: var(--font-headline);
	font-size: 40px;
	font-weight: 700;
}

.input_field {
	width: 100%;
	/* The browsers' own, stated because the strut copies it. */
	padding-block: 1px;

	color: var(--txt-primary);

	&::placeholder {
		color: var(--txt-tertiary);
	}
}

.field_type {
	font-family: var(--font-headline);
	font-size: calc(40px * var(--hero-scale, 1));
	font-weight: 700;
	letter-spacing: -0.04em;
}

.field_ruler {
	position: absolute;
	width: 0;
	height: 0;
	overflow: hidden;
	visibility: hidden;
	pointer-events: none;
}

.field_ruler > span {
	position: absolute;
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
