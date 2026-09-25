<script setup lang="ts">
/**
 * One card of the capabilities window. A new card with a `switchLabel` has a switch whose state
 * the parent drives; a new card without one is granted as requested; a granted card is
 * read-only. The head expands the detail panel, and the switch stops propagation so a flip never
 * expands it.
 *
 * Risk visual is mono uppercase + glyph (no semantic color). Targeted orange accents are reserved
 * for the warning badges (PREVIOUSLY DENIED) so the user's eye lands on a warning, not on risk
 * severity.
 */
import CapabilityDetailPanel from "@/components/composite/capabilities/CapabilityDetailPanel.vue"
import type { Capability } from "@nulo/wallet-bridge"
import type { CapabilityRisk } from "@/wallet/services/dapp-session/capability-meta"

const props = defineProps<{
	capability: Capability
	/** Every capability the detail panel lists; defaults to `capability`. */
	panelCapabilities?: Capability[]
	rowKey: string
	/** `data-cap-id`; absent on a card that stands for several types. */
	capId?: string
	label: string
	description: string
	risk: CapabilityRisk
	selected: boolean
	granted: boolean
	expanded: boolean
	/** The switch's accessible name; a card without one has no switch. */
	switchLabel?: string
	reRequested?: boolean
	/**
	 * Unknown capability types pass `isUnknown=true` so the card head shows an UNRECOGNIZED chip.
	 * The `label` is the wallet-controlled constant "Unknown permission": the dApp-controlled
	 * `cap.type` never reaches this prop.
	 */
	isUnknown?: boolean
	disabled?: boolean
}>()

const emit = defineEmits(["toggleExpanded", "toggleSelected"])

const panels = computed(() => props.panelCapabilities ?? [props.capability])

const toggle = () => {
	if (!props.disabled) emit("toggleSelected")
}

/**
 * Mono glyphs for the risk indicator. `—` (em-dash) reads as a quiet
 * negation for LOW; `●` (black circle) is a neutral pip for MED;
 * `▲` (black up triangle) is a soft alert for HIGH. All three live in
 * the same geometric weight at 10px in `var(--font-mono)`.
 */
function riskGlyph(r: CapabilityRisk): string {
	if (r === "high") return "▲"
	if (r === "medium") return "●"
	return "—"
}

function riskWord(r: CapabilityRisk): string {
	if (r === "medium") return "MED"
	return r.toUpperCase()
}
</script>

<template>
	<Flex
		data-testid="cap-item"
		:data-cap-id="capId"
		:data-cap-row="rowKey"
		:data-cap-name="label"
		:data-cap-granted="granted ? 'true' : undefined"
		direction="column"
		:class="[$style.cap_card, granted && $style.cap_granted, disabled && $style.cap_disabled]"
	>
		<Flex
			v-if="!granted"
			@click="emit('toggleExpanded')"
			data-testid="cap-detail-toggle"
			gap="10"
			:class="$style.cap_head"
		>
			<Flex
				v-if="switchLabel"
				align="center"
				data-testid="cap-toggle"
				role="switch"
				:aria-checked="selected ? 'true' : 'false'"
				:aria-label="switchLabel"
				:aria-disabled="disabled || undefined"
				:tabindex="disabled ? -1 : 0"
				@click.stop="toggle"
				@keydown.enter.prevent.stop="toggle"
				@keydown.space.prevent.stop="toggle"
				:class="$style.checkbox_hit"
			>
				<Icon v-if="selected" name="check-circle" size="16" color="primary" />
				<Icon v-else name="circle" size="16" color="secondary" />
			</Flex>

			<Flex direction="column" gap="2" wide>
				<Flex align="center" justify="between" gap="8">
					<Flex align="center" gap="6" :class="$style.head_label_row">
						<Text size="14" weight="600" :color="isUnknown ? 'tertiary' : 'primary'" :class="isUnknown && $style.mono_label">
							{{ label }}
						</Text>
						<span v-if="isUnknown" data-testid="cap-unrecognized-badge" :class="$style.warning_badge">
							unrecognized
						</span>
						<span v-if="reRequested" data-testid="cap-rerequested-badge" :class="$style.warning_badge">
							previously denied
						</span>
					</Flex>
					<Flex align="center" gap="6">
						<span :class="$style.risk_tag" :data-cap-risk="risk">
							<span :class="$style.risk_glyph">{{ riskGlyph(risk) }}</span>
							{{ riskWord(risk) }}
						</span>
						<Icon
							name="chevron"
							size="12"
							color="tertiary"
							:style="{
								transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
								transition: 'transform 0.2s ease',
							}"
						/>
					</Flex>
				</Flex>
				<Text size="12" color="secondary" :style="{ lineHeight: '1.4' }">{{ description }}</Text>
			</Flex>
		</Flex>

		<Flex v-else gap="10" :class="$style.cap_head_readonly">
			<Flex align="center">
				<Icon name="check-circle" size="16" color="tertiary" />
			</Flex>

			<Flex direction="column" gap="2" wide>
				<Flex align="center" justify="between" gap="8">
					<Flex align="center" gap="6" :class="$style.head_label_row">
						<Text size="14" weight="600" color="tertiary" :class="isUnknown && $style.mono_label">
							{{ label }}
						</Text>
						<span v-if="isUnknown" data-testid="cap-unrecognized-badge" :class="$style.warning_badge">
							unrecognized
						</span>
					</Flex>
					<Icon
						@click.stop="emit('toggleExpanded')"
						name="chevron"
						size="12"
						color="tertiary"
						:style="{
							transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
							transition: 'transform 0.2s ease',
							cursor: 'pointer',
						}"
					/>
				</Flex>
				<Text size="12" color="tertiary" :style="{ lineHeight: '1.4' }">{{ description }}</Text>
			</Flex>
		</Flex>

		<template v-if="expanded">
			<CapabilityDetailPanel v-for="(panel, i) in panels" :key="i" :capability="panel" :granted="granted" />
		</template>
	</Flex>
</template>

<style module>
.cap_card {
	width: 100%;

	border: 1px solid var(--nulo-border);
	background: transparent;
	overflow: hidden;

	transition: border-color 0.2s var(--bezier);
}

.cap_head {
	cursor: pointer;
	padding: 12px;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-high);
	}

	&:active {
		background: var(--nulo-surface-highest);
	}
}

.cap_head_readonly {
	padding: 12px;
}

.cap_granted {
	opacity: 0.6;
}

.cap_disabled {
	cursor: default;
	pointer-events: none;
}

.checkbox_hit {
	padding: 8px;
	margin: -8px;
	cursor: pointer;
}

/**
 * Risk tag — mono uppercase, no fill, no semantic color. Glyph + word
 * carry the signal at the family's quiet tag rhythm (compare
 * AccountSelectRow's chain_label + alias_label).
 */
.risk_tag {
	flex-shrink: 0;

	display: inline-flex;
	align-items: center;

	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.08em;
	color: var(--nulo-secondary);
	white-space: nowrap;
}

.risk_glyph {
	padding-right: 4px;
}

/**
 * Warning badge — used for PREVIOUSLY DENIED and UNRECOGNIZED chips.
 * Orange border on transparent fill matches the family's targeted-
 * warning treatment (verify popup's IDN-warning, signer strip's MIXED
 * tag) while staying brutalist.
 */
.warning_badge {
	padding: 1px 6px;
	border: 1px solid var(--orange);

	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--orange);
	background: transparent;
	white-space: nowrap;
}

/**
 * Mono treatment for the unknown-capability head label. The label
 * itself is the wallet-controlled constant "Unknown permission"
 * (build-items.ts routes through getSafeDisplay so the dApp-controlled
 * cap.type never reaches the head). The mono typography is a
 * visual-rhythm tweak that pairs with the UNRECOGNIZED chip — both
 * signal "this card is the odd one out" so the eye lands on the
 * warning. The dApp-controlled raw type is rendered separately in the
 * detail panel through sanitizeWireString.
 */
.mono_label {
	font-family: var(--font-mono);
	letter-spacing: 0.04em;
}

.head_label_row {
	flex-wrap: wrap;
}
</style>
