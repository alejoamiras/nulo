<script setup>
import CapabilityDetailPanel from "@/components/composite/capabilities/CapabilityDetailPanel.vue"
import { getCapabilityLabel } from "./connected-app-helpers"

/**
 * Expandable list of capability grants on a connected dApp session.
 * Each row toggles open to reveal the per-capability detail panel.
 */
const props = defineProps({
	grants: { type: Array, default: () => [] },
})

const expanded = ref(new Set())

const toggle = (i) => {
	if (expanded.value.has(i)) expanded.value.delete(i)
	else expanded.value.add(i)
}

const isExpanded = (i) => expanded.value.has(i)
</script>

<template>
	<Flex direction="column" gap="6" wide>
		<Flex
			v-for="(grant, gi) in grants"
			:key="grant.capability.type"
			direction="column"
			:class="$style.grant_card"
		>
			<Flex
				@click="toggle(gi)"
				align="center"
				justify="between"
				:class="$style.grant_header"
			>
				<Flex align="center" gap="6">
					<Icon name="check-circle" size="11" color="green" />
					<Text size="13" color="secondary">{{ getCapabilityLabel(grant.capability.type) }}</Text>
				</Flex>
				<Icon
					name="chevron"
					size="12"
					color="tertiary"
					:style="{ transform: isExpanded(gi) ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s ease' }"
				/>
			</Flex>
			<CapabilityDetailPanel
				v-if="isExpanded(gi)"
				:capability="grant.capability"
				:granted="true"
			/>
		</Flex>
	</Flex>
</template>

<style module>
.grant_card {
	width: 100%;
	overflow: hidden;
	border: 1px solid var(--nulo-border);
}

.grant_header {
	padding: 10px 12px;
	cursor: pointer;

	transition: background 0.15s ease;

	&:hover {
		background: var(--nulo-surface-high);
	}
}
</style>
