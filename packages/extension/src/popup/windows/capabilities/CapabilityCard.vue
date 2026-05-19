<script setup lang="ts">
/**
 * Single capability card rendered inside the capabilities window. Two
 * shapes:
 *
 * - `granted=false` (the "new" delta variant) — toggleable via the
 *   leading checkbox; head is fully clickable to expand the detail
 *   panel; risk chip + chevron sit on the right; an optional
 *   "previously denied" badge surfaces re-requests.
 * - `granted=true` — readonly with a static check icon; chevron
 *   toggles expansion only.
 *
 * The parent owns the index → card mapping; the card just emits
 * `toggleSelected` (head checkbox) and `toggleExpanded` (head body or
 * chevron) so the parent can drive `capabilities[i].selected` and the
 * `expandedCards` set.
 */
import CapabilityDetailPanel from "@/components/composite/capabilities/CapabilityDetailPanel.vue"
import type { Capability } from "@nulo/wallet-bridge"
import type { CapabilityRisk } from "./capability-meta"

defineProps<{
	capability: Capability
	label: string
	description: string
	risk: CapabilityRisk
	selected: boolean
	granted: boolean
	expanded: boolean
	reRequested?: boolean
	disabled?: boolean
}>()

const emit = defineEmits(["toggleExpanded", "toggleSelected"])
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
				<Icon v-if="selected" name="check-circle" size="16" color="green" />
				<Icon v-else name="circle" size="16" color="secondary" />
			</Flex>

			<Flex direction="column" gap="2" wide>
				<Flex align="center" justify="between" gap="8">
					<Flex align="center" gap="6">
						<Text size="14" weight="600" color="primary">{{ label }}</Text>
						<span v-if="reRequested" data-testid="cap-rerequested-badge" :class="$style.denied_badge">
							previously denied
						</span>
					</Flex>
					<Flex align="center" gap="6">
						<Text
							size="11"
							weight="600"
							:color="risk === 'high' ? 'red' : risk === 'medium' ? 'yellow' : 'green'"
						>
							{{ risk }}
						</Text>
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
					<Text size="14" weight="600" color="tertiary">{{ label }}</Text>
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

.denied_badge {
	padding: 1px 6px;

	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--orange);
	background: rgba(255, 170, 0, 0.12);
	white-space: nowrap;
}
</style>
