<script setup lang="ts">
/** Components */
import Flex from "../core/Flex.vue"
import MaterialIcon from "../core/MaterialIcon.vue"

// Router-free base: emits `back` instead of touching the router. The extension wrapper owns the
// history policy (`window.history.length > 1 ? router.back() : backTo ?? "/popup/general"`).
defineEmits<{ back: [] }>()
defineProps({
	title: {
		type: String,
		required: false,
		default: "",
	},
	showBack: {
		type: Boolean,
		default: true,
	},
	leadingIcon: {
		type: String,
		required: false,
	},
	leadingIconColor: {
		type: String,
		default: "secondary",
	},
})
</script>

<template>
	<Flex align="center" justify="between" gap="12" :class="$style.wrapper">
		<button v-if="showBack" @click="$emit('back')" :class="$style.back_btn" type="button" aria-label="Back">
			<MaterialIcon name="arrow_back" :size="22" color="primary" />
		</button>
		<div v-else :class="$style.back_spacer" />

		<Flex align="center" justify="center" gap="8" :class="$style.title_wrapper">
			<slot name="title">
				<MaterialIcon v-if="leadingIcon && title" :name="leadingIcon" :size="18" :color="leadingIconColor" />
				<span v-if="title" :class="$style.title">{{ title }}</span>
			</slot>
		</Flex>

		<div :class="$style.trailing">
			<slot name="trailing" />
		</div>
	</Flex>
</template>

<style module>
.wrapper {
	position: sticky;
	top: 0;
	z-index: 10;

	padding: 0 24px;
	min-height: 56px;

	background: var(--app-bg);
}

.back_btn {
	display: flex;
	align-items: center;
	justify-content: center;

	width: 40px;
	height: 40px;

	background: transparent;
	border: none;
	cursor: pointer;

	flex-shrink: 0;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: rgba(248, 241, 231, 0.08);
	}
}

.back_spacer {
	width: 40px;
	flex-shrink: 0;
}

.title_wrapper {
	flex: 1;
	min-width: 0;
}

.title {
	font-family: var(--font-headline);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--txt-primary);

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.trailing {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 4px;
	min-width: 40px;
	flex-shrink: 0;
}
</style>
