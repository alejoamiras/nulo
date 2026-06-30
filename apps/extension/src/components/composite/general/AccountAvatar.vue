<script setup lang="ts">
/** Utils */
import { getInitials } from "@/utils/string"

/** Macros */
const props = defineProps<{
	name?: string
	address?: string
	size?: number
}>()

/** Reactive state */
const sizePx = computed(() => props.size ?? 28)
const initials = computed(() => getInitials(props.name ?? ""))
const fontSize = computed(() => Math.max(9, Math.round(sizePx.value * 0.4)))
</script>

<template>
	<!-- Brutalist: a flat grey square (no color, no rounded corners), initials only. -->
	<Flex
		align="center"
		justify="center"
		:class="$style.avatar"
		:style="{ width: `${sizePx}px`, height: `${sizePx}px` }"
		data-testid="account-avatar"
		:data-initials="initials"
	>
		<Text color="primary" weight="600" :style="{ fontSize: `${fontSize}px`, lineHeight: 1 }">{{ initials }}</Text>
	</Flex>
</template>

<style module>
.avatar {
	flex-shrink: 0;
	background: var(--nulo-surface-high);
	user-select: none;
}
</style>
