<script setup lang="ts">
/**
 * Single capability card rendered inside the capabilities window. Two
 * shapes:
 *
 * - `granted=false` (the "new" delta variant) — toggleable via the
 *   leading checkbox; head is fully clickable to expand the detail
 *   panel; risk tag + chevron sit on the right; an optional
 *   "previously denied" badge surfaces re-requests.
 * - `granted=true` — readonly with a static check icon; chevron
 *   toggles expansion only.
 *
 * The parent owns the index → card mapping; the card just emits
 * `toggleSelected` (head checkbox) and `toggleExpanded` (head body or
 * chevron) so the parent can drive `capabilities[i].selected` and the
 * `expandedCards` set.
 *
 * Risk visual is mono uppercase + glyph (no semantic color). Targeted
 * orange accents are reserved for the warning badges (PREVIOUSLY DENIED)
 * so the user's eye lands on a warning, not on risk severity.
 */
import CapabilityDetailPanel from "@/components/composite/capabilities/CapabilityDetailPanel.vue"
import type { Capability } from "@nulo/wallet-bridge"
import type { CapabilityRisk } from "@/wallet/services/dapp-session/capability-meta"

defineProps<{
	capability: Capability
	label: string
	description: string
	risk: CapabilityRisk
	selected: boolean
	granted: boolean
	expanded: boolean
	reRequested?: boolean
	/**
	 * Unknown capability types pass `isUnknown=true` so the card head
	 * shows an UNRECOGNIZED chip alongside the (dApp-controlled) label.
	 * The parent (`build-items.ts`) also flips `selected` to `false` for
	 * these — together, the user gets a loud visual signal AND must
	 * deliberately click to approve.
	 */
	isUnknown?: boolean
	disabled?: boolean
}>()

const emit = defineEmits(["toggleExpanded", "toggleSelected"])

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
		:data-cap-id="capability.type"
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
				align="center"
				data-testid="cap-toggle"
				@click.stop="emit('toggleSelected')"
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

		<CapabilityDetailPanel v-if="expanded" :capability="capability" :granted="granted" />
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
 * The dApp-controlled cap.type string lands as the head label for an
 * unrecognized capability. Render it in mono + tertiary so the eye
 * lands on the UNRECOGNIZED chip first; the type itself is visibly
 * "raw data, not friendly UI". Sanitization happens upstream in
 * `getCapabilityInfo` / `sanitizeWireString` in the detail panel; here
 * the typography signals the trust boundary.
 */
.mono_label {
	font-family: var(--font-mono);
	letter-spacing: 0.04em;
}

.head_label_row {
	flex-wrap: wrap;
}
</style>
