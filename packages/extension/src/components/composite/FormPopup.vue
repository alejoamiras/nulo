<script setup>
const emit = defineEmits(["onClose", "submit"])

defineProps({
	show: { type: Boolean, default: false },
	displaceIdx: { type: Number, required: true },
	/** Simple title text. For richer titles (icon + suffix etc.) use the
	 *  `#title` slot which fully overrides this. */
	title: { type: String, default: "" },
	submitLabel: { type: String, required: true },
	submitDisabled: { type: Boolean, default: false },
	submitLoading: { type: Boolean, default: false },
	submitTestId: { type: String, default: undefined },
	submitVariant: { type: String, default: "primary" },
	/** Body wrapper gap. Most popups use 24; a few (denser) use 16. */
	bodyGap: { type: String, default: "24" },
})
</script>

<template>
	<Popup :show="show" @onClose="emit('onClose')" :displaceIdx="displaceIdx">
		<PopupCard :displaceIdx="displaceIdx">
			<PopupHeader @onClose="emit('onClose')" closable>
				<template #title>
					<slot name="title">
						<Text size="14" weight="600" color="primary">{{ title }}</Text>
					</slot>
				</template>
				<template v-if="$slots.headerRight" #right>
					<slot name="headerRight" />
				</template>
			</PopupHeader>

			<Flex wide direction="column" :gap="bodyGap" :class="$style.wrapper">
				<slot />

				<Flex direction="column" gap="10">
					<slot name="aboveSubmit" />

					<Button
						@click="emit('submit')"
						wide
						:variant="submitVariant"
						size="medium"
						:disabled="submitDisabled"
						:loading="submitLoading"
						:data-testid="submitTestId"
					>
						{{ submitLabel }}
					</Button>

					<slot name="belowSubmit" />
				</Flex>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	padding: 0 20px 24px 20px;
}
</style>
