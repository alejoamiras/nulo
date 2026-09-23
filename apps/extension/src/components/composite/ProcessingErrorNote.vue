<script setup>
defineProps({
	show: Boolean,
	title: { type: String, default: "" },
	tooltip: { type: [String, Object], default: "" },
	color: { type: String, default: "primary" },
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
				<Icon name="info" size="14" :color="color" />

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
