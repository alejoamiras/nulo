<script setup>
import { h, mergeProps, useCssModule, withKeys, withModifiers } from "vue"
import { RouterLink } from "vue-router"
import RowTarget from "@/components/ui/RowTarget.vue"

defineOptions({ inheritAttrs: false })

const $style = useCssModule()

const props = defineProps({
	size: {
		type: String,
		default: "medium",
	},
	title: String,
	description: String,
	icon: String,
	materialIcon: String,
	iconBgColor: {
		type: String,
		default: "gray-20",
	},
	iconFillColor: {
		type: String,
		default: "secondary",
	},
	to: String,
	chevron: {
		type: Boolean,
		required: false,
	},
	external: {
		type: Boolean,
		default: false,
	},
	disabled: {
		type: Boolean,
		default: false,
	},
	loading: {
		type: Boolean,
		default: false,
	},
	raw: {
		type: Boolean,
		default: false,
	},
})

const attrs = useAttrs()
const titleId = useId()

/** `disabled` decides first: a disabled row is inert whatever `to` or `@click` it carries. */
const mode = computed(() => {
	if (props.disabled) return "inert"
	if (props.to) return props.external ? "external" : "link"
	if (attrs.onClick) return "click"
	return "inert"
})

const rootClass = computed(() => [
	$style.wrapper,
	$style[props.size],
	mode.value !== "inert" && $style.interactive,
	props.raw && $style.raw,
	props.disabled && $style.disabled,
])

/** An anchor has no native Space action; a bare Space presses it, and a modified one scrolls. */
const pressOnSpace = withKeys(
	withModifiers((e) => e.currentTarget.click(), ["exact", "prevent"]),
	["space"],
)

/** The row root by mode, written once around the same body. */
const Root = (_, { slots }) => {
	const body = slots.default?.()
	const shared = mergeProps(mode.value === "inert" ? { ...attrs, onClick: undefined } : attrs, { class: rootClass.value })
	if (mode.value === "link") {
		return h(
			RouterLink,
			{ to: props.to, custom: true },
			{
				default: ({ href, navigate }) =>
					h("a", mergeProps(shared, { href, onClick: navigate, onKeydown: withKeys(navigate, ["space"]) }), body),
			},
		)
	}
	if (mode.value === "external") {
		return h("a", mergeProps(shared, { href: props.to, target: "_blank", rel: "noopener noreferrer", onKeydown: pressOnSpace }), body)
	}
	return h("div", shared, body)
}
</script>

<template>
	<Root>
		<RowTarget v-if="mode === 'click'" :labelledby="titleId" />

		<Flex wide align="center" justify="between" gap="16">
			<Flex align="center" gap="14" wide>
				<div v-if="icon || materialIcon || $slots.dot || $slots.icon" :class="$style.icon_wrapper">
					<!-- Dot -->
					<slot name="dot" />

					<!-- Icon: custom slot wins, otherwise prop-driven fallback -->
					<slot name="icon">
						<MaterialIcon
							v-if="materialIcon && !loading"
							:name="materialIcon"
							:size="20"
							color="secondary"
							:class="$style.material_icon"
						/>
						<Icon
							v-else-if="icon && !loading"
							:name="icon"
							size="18"
							:color="iconFillColor"
							:class="$style.icon"
						/>
						<div v-else-if="(icon || materialIcon) && loading" :class="$style.icon_loading">
							<Spinner size="16" color="--txt-primary" />
						</div>
					</slot>
				</div>

				<!-- Labels: Title & Description -->
				<Flex direction="column" gap="4" wide>
					<Flex align="center" gap="6">
						<Text :id="titleId" size="14" weight="500" color="primary" :class="[$style.title, $slots.titleSuffix && $style.titleWithSuffix]"> {{ title }} </Text>
						<slot name="titleSuffix" />
					</Flex>
					<Text v-if="description || $slots.description" size="12" weight="500" color="tertiary" :class="$style.description">
						<slot name="description">{{ description }}</slot>
					</Text>
				</Flex>
			</Flex>

			<Flex align="center" gap="12">
				<slot name="right">
					<MaterialIcon
						v-if="to || chevron"
						:name="!external ? 'chevron_right' : 'arrow_outward'"
						:size="18"
						color="secondary"
						:class="$style.chevron_icon"
					/>
				</slot>
			</Flex>
		</Flex>
	</Root>
</template>

<style module>
.wrapper {
	position: relative;

	display: flex;
	align-items: center;

	background: transparent;
	text-decoration: none;

	padding: 16px 20px;

	&.disabled {
		pointer-events: none;
		opacity: 0.5;
	}

	&::after {
		position: absolute;
		bottom: 0;
		left: 20px;
		right: 20px;
		display: block;
		height: 1px;

		background: rgba(74, 70, 63, 0.3);

		content: " ";
	}

	&:last-child::after {
		display: none;
	}

	&.large {
		padding: 20px;
	}

	&.medium {
		padding: 16px 20px;
	}

	&.small {
		padding: 12px 20px;
	}

	&.raw {
		background: var(--nulo-surface-low);
	}
}

.interactive {
	cursor: pointer;
	transition: background 0.2s var(--bezier);

	&:hover,
	&:focus-visible,
	&:has(> [data-row-target]:focus-visible) {
		background: var(--nulo-surface-high);
	}

	&:focus-visible,
	&:has(> [data-row-target]:focus-visible) {
		outline: 2px solid var(--nulo-accent);
		outline-offset: -2px;
	}

	&:active {
		background: var(--nulo-surface-highest);
	}
}

.icon_wrapper {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	flex-shrink: 0;
}

.material_icon {
	color: var(--nulo-secondary);
	transition: color 0.2s var(--bezier);
}

.interactive:hover .material_icon {
	color: var(--nulo-accent);
}

.icon_loading {
	display: inline-flex;
	align-items: center;
	justify-content: center;
}

.chevron_icon {
	color: var(--nulo-secondary);
	transition: color 0.2s var(--bezier);
}

.interactive:hover .chevron_icon {
	color: var(--nulo-accent);
}

.title {
	min-width: 100%;
	width: 0;

	line-height: 20px !important;
	letter-spacing: 0.01em;

	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;

	&.titleWithSuffix {
		min-width: unset;
		width: auto;
	}
}

.description {
	min-width: 100%;
	width: 0;

	line-height: 16px !important;

	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
}
</style>
