<script setup>
/**
 * Full-window cancellation overlay rendered when the dApp ended the
 * request mid-flight (or the wrong profile is active in the execute
 * window). The single OK button delegates to the parent for window
 * close; the parent owns the actual chrome.windows.remove call.
 */
defineProps({
	message: { type: String, default: "Connection request was cancelled" },
})

const emit = defineEmits(["dismiss"])
</script>

<template>
	<Flex align="center" justify="center" :class="$style.notification_overlay">
		<Flex direction="column" align="center" gap="16" :class="$style.notification_content">
			<Text size="13" weight="600" color="primary">{{ message }}</Text>
			<Button @click="emit('dismiss')" variant="primary" size="small" :style="{ width: '50%' }">
				<Text size="13" color="inverse">OK</Text>
			</Button>
		</Flex>
	</Flex>
</template>

<style module>
.notification_overlay {
	position: fixed;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	background: rgba(10, 9, 8, 0.8);
	z-index: 1000;
}

.notification_content {
	width: 90%;

	padding: 16px;
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);

	text-align: center;
	line-height: 1.2;
	z-index: 1001;
}
</style>
