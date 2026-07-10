<script setup lang="ts">
import type { PropType } from "vue"
import Flex from "../core/Flex.vue"
import type { SeverityTone } from "../severity"

/** Badge renders the 3 semantic tones it has styles for + the non-semantic `purple` accent. */
type BadgeVariant = Extract<SeverityTone, "info" | "warning" | "error"> | "purple"

const props = defineProps({
	variant: {
		type: String as PropType<BadgeVariant>,
		default: "info",
	},
})
</script>

<template>
	<Flex align="center" gap="6" :class="[$style.wrapper, $style[variant]]">
		<slot />
	</Flex>
</template>

<style module>
.wrapper {
	padding: 2px 6px;

	&.info {
		background: var(--nulo-surface-high);
		color: var(--txt-primary);
	}

	&.warning {
		background: var(--orange);
		color: var(--txt-inverse);
	}

	&.error {
		background: var(--red);
		color: var(--txt-inverse);
	}

	&.purple {
		background: var(--purple);
		color: var(--txt-inverse);
	}
}
</style>
