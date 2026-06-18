<script setup lang="ts">
import Flex from "../core/Flex.vue"
import Icon from "../core/Icon.vue"

const props = defineProps(["modelValue", "checked", "disabled"])
const emit = defineEmits(["update:modelValue"])
</script>

<template>
	<Flex
		@click="emit('update:modelValue', !modelValue)"
		@keydown.enter="emit('update:modelValue', !modelValue)"
		gap="10"
		align="center"
		:class="[$style.wrapper, disabled && $style.disabled]"
		tabindex="0"
	>
		<Flex align="center" justify="center" :class="[$style.checkbox, (modelValue || checked) && $style.active]">
			<Icon v-if="modelValue || checked" name="check" size="14" color="inverse" />
		</Flex>

		<slot />
	</Flex>
</template>

<style module>
.wrapper {
	cursor: pointer;

	&:hover {
		.checkbox {
			border-color: var(--nulo-outline);
		}
	}

	&.disabled {
		cursor: not-allowed;

		& .checkbox {
			opacity: 0.5;
		}
	}
}

.wrapper:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 2px;

	.checkbox {
		border-color: var(--nulo-accent);
	}
}

.checkbox {
	min-width: 18px;
	min-height: 18px;
	max-width: 18px;
	max-height: 18px;

	background: transparent;
	border: 1.5px solid var(--nulo-border);

	transition: all 0.1s ease;

	&.active {
		background: var(--txt-primary);
		border-color: var(--txt-primary);
	}
}
</style>
