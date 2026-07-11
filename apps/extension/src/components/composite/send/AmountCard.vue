<script setup>
/** Utils */
import { purgeNumber, normalizeAmount, clampDecimals, comma } from "@/utils/amount"

const props = defineProps({
	selectedSendType: {
		type: String,
	},
	token: {
		type: Object,
		required: false,
	},
	tokenBalanceByType: Number,
})

const model = defineModel()

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

const amountInUSD = computed(() => Number.parseFloat(purgeNumber(model.value || 0)) * 3.4)

const handleFocus = () => {
	if (props.tokenBalanceByType) inputEl.value.focus()
}

const handleMax = () => {
	if (!props.tokenBalanceByType) return
	model.value = props.tokenBalanceByType
}

const handleHalf = () => {
	if (!props.tokenBalanceByType) return
	const raw = model.value
	const value = raw ? Number.parseFloat(purgeNumber(typeof raw === "string" ? raw : String(raw))) : props.tokenBalanceByType
	// Number-domain `/2` can produce more decimals than the token supports
	// (e.g. 6-dec balance "1.234567" → 0.6172835). Clamp to the token's
	// precision so the typed-input contract holds.
	const halved = String(value / 2)
	model.value = tokenDecimals.value !== undefined ? clampDecimals(halved, tokenDecimals.value) : halved
}
</script>

<template>
	<Flex @click="handleFocus" gap="8" direction="column" :class="$style.wrapper">
		<Flex direction="column" gap="4">
			<Flex gap="4">
				<input
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
			</Flex>

			<Flex align="center" justify="between">
				<Tooltip position="start">
					<Flex align="center" gap="4" style="opacity: 0.5">
						<span :class="$style.conversion">~ $0.00</span>
						<Icon name="warning" size="10" color="tertiary" />
					</Flex>

					<template #content> No quotes available at the moment</template>
				</Tooltip>

				<Flex align="center" gap="8">
					<span @click="handleHalf" data-testid="send-amount-half" :class="$style.action_link">Half</span>
					<span @click="handleMax" data-testid="send-amount-max" :class="$style.action_link">Max</span>
				</Flex>
			</Flex>

			<span v-if="wasClamped && tokenDecimals !== undefined" :class="$style.clamp_hint" data-testid="send-amount-clamp-hint">
				{{ token.symbol || "Token" }} supports {{ tokenDecimals }} decimal{{ tokenDecimals === 1 ? "" : "s" }}
			</span>
		</Flex>

		<Flex v-if="token && tokenBalanceByType" align="center" gap="4" :class="$style.balance_row">
			<span :class="$style.balance_text">{{ comma(tokenBalanceByType, ",", 8) }} {{ token.symbol }} · {{ selectedSendType }}</span>
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

	font-family: var(--font-headline);
	font-size: 40px;
	font-weight: 700;
	letter-spacing: -0.04em;
	color: var(--txt-primary);

	&::placeholder {
		color: var(--txt-tertiary);
	}
}

.conversion {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
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

.balance_row {
	padding: 4px 0;
}

.balance_text {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
}
</style>
