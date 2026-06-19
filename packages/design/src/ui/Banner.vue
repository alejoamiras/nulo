<script setup lang="ts">
/** Vendor */
import type { PropType } from "vue"

/** Components */
import Flex from "../core/Flex.vue"
import Icon from "../core/Icon.vue"
import Text from "../core/Text.vue"
import Spinner from "./Spinner.vue"

defineProps({
	variant: {
		type: String,
		default: "info",
	},
	direction: {
		type: String,
		default: "horizontal",
	},
	text: {
		type: String,
	},
	wide: {
		type: Boolean,
	},
	action: {
		type: Object as PropType<{ name: string; callback: () => void }>,
	},
	isLoading: {
		type: Boolean,
		default: false,
	},
})
</script>

<template>
	<Flex justify="between" align="center" :wide="wide" :class="[$style.wrapper, $style[variant]]">
		<Flex :align="direction === 'horizontal' ? 'center' : 'start'" gap="8">
			<Flex align="center" justify="center" :class="$style.icon">
				<Icon v-if="!isLoading" name="info" size="16" color="secondary" />
				<Spinner v-else size="16" color="--txt-primary" />
			</Flex>

			<Flex :direction="direction === 'horizontal' ? 'row' : 'column'" gap="8">
				<Text size="12" weight="600" :height="direction === 'vertical' ? '120' : '140'" color="primary" :style="{ marginTop: direction === 'vertical' && '4px' }">
					<slot />
					<slot name="title" />
				</Text>

				<Text size="12" weight="500" height="120" color="tertiary" :style="{ marginBottom: !action && '4px' }">
					<slot name="description" />
				</Text>

				<button
					v-if="action && direction === 'vertical'"
					@click="action.callback()"
					type="button"
					:class="$style.action_btn"
					style="margin-bottom: 4px"
				>
					{{ action.name }}
				</button>
			</Flex>
		</Flex>

		<button
			v-if="action && direction === 'horizontal'"
			@click="action.callback()"
			type="button"
			:class="$style.action_btn"
		>
			{{ action.name }}
		</button>
	</Flex>
</template>

<style module>
.wrapper {
	border: 1px solid var(--nulo-border);

	padding: 8px 16px 8px 8px;

	&.info {
		background: var(--nulo-surface-low);
	}

	&.done {
		background: var(--nulo-surface-low);

		& .icon {
			& svg {
				fill: var(--green);
			}
		}
	}

	&.warning {
		background: var(--nulo-surface-low);

		& .icon {
			& svg {
				fill: var(--orange);
			}
		}
	}

	&.error {
		background: var(--nulo-surface-low);

		& .icon {
			& svg {
				fill: var(--red);
			}
		}
	}
}

.icon {
	min-width: 20px;
	min-height: 20px;
	height: 20px;

	box-sizing: content-box;
}

.text {
	line-height: 20px !important;
}

.action_btn {
	align-self: flex-start;

	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;

	color: var(--nulo-accent);
	background: transparent;
	border: none;
	cursor: pointer;

	padding: 0;
	text-decoration: underline;
	text-decoration-thickness: 1px;
	text-underline-offset: 4px;

	transition: color 0.2s var(--bezier);

	&:hover {
		color: var(--txt-primary);
	}
}

:global([theme="light"]) {
	.action_btn {
		color: var(--txt-primary);
	}
	.action_btn:hover {
		color: var(--txt-secondary);
	}
}
</style>
