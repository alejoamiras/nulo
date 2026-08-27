<script setup>
/**
 * Q-11: the shared footer for the three dApp approval windows (execute /
 * discover / capabilities) — the error-tooltip banner + Reject/Confirm button
 * pair they rendered with byte-identical markup and `.footer` CSS. Only the
 * test-ids, labels, the optional `wide` tooltip, and the Confirm `:disabled`
 * expression differed between windows, so those are props the parent supplies;
 * the Reject `:disabled` (`isLoading || !requestId`) was identical and is passed
 * as `rejectDisabled`. Test-ids are forwarded verbatim (e2e depends on them).
 */
defineProps({
	/** The window's processing error ({ title, tooltip?, type }) or undefined. */
	processingError: { type: Object, default: undefined },
	/** discover/capabilities render the tooltip `wide`; execute does not. */
	wideTooltip: { type: Boolean, default: false },
	rejectTestid: { type: String, required: true },
	rejectLabel: { type: String, required: true },
	rejectDisabled: { type: Boolean, default: false },
	confirmTestid: { type: String, required: true },
	confirmLabel: { type: String, required: true },
	confirmLoading: { type: Boolean, default: false },
	confirmDisabled: { type: Boolean, default: false },
})

const emit = defineEmits(["reject", "approve"])
</script>

<template>
	<Flex direction="column" gap="10" :class="$style.footer">
		<Tooltip v-if="processingError" side="top" position="start" :wide="wideTooltip" :disabled="!processingError.tooltip">
			<Flex align="center" wide gap="6">
				<Icon name="info" size="14" :color="processingError.type === 'warning' ? 'orange' : 'red'" />
				<Text data-testid="error-text" role="alert" size="12" weight="600" color="secondary">{{ processingError.title }}</Text>
			</Flex>

			<template #content>
				<Text size="12" color="secondary">{{ processingError.tooltip }}</Text>
			</template>
		</Tooltip>

		<Flex align="center" justify="between" gap="12">
			<Button :data-testid="rejectTestid" @click="emit('reject')" wide variant="primary_outline" size="medium" :disabled="rejectDisabled">
				{{ rejectLabel }}
			</Button>

			<Button
				:data-testid="confirmTestid"
				@click="emit('approve')"
				wide
				variant="primary"
				size="medium"
				:loading="confirmLoading"
				:disabled="confirmDisabled"
			>
				<Text size="13" color="inverse">{{ confirmLabel }}</Text>
			</Button>
		</Flex>
	</Flex>
</template>

<style module>
.footer {
	flex-shrink: 0;

	padding: 16px;
	border-top: 1px solid var(--nulo-border);
	background: var(--nulo-surface);
}
</style>
