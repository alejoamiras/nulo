<script setup>
/**
 * The save-failure note the contact popups render above their submit
 * button: an info line with the error detail behind a tooltip. The
 * tooltip is disabled when there is no detail to show.
 */
defineProps({
	show: Boolean,
	title: { type: String, default: "" },
	/** Raw error detail; shown in the tooltip body. */
	tooltip: { type: [String, Object], default: "" },
})
</script>

<template>
	<Transition name="fade">
		<Tooltip
			v-if="show"
			side="top"
			position="start"
			wide
			:disabled="!tooltip"
			:style="{ marginTop: '-12px' }"
		>
			<Flex align="center" wide>
				<Icon
					name="info"
					size="14"
					color="primary"
				/>

				<Text size="12" weight="600" color="secondary" :style="{ paddingLeft: '4px' }">
					{{ title }}
				</Text>
			</Flex>

			<template #content>
				<Text size="12" color="secondary">
					{{ tooltip }}
				</Text>
			</template>
		</Tooltip>
	</Transition>
</template>
