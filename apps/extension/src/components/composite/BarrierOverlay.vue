<script setup>
/** The detail span follows the slot's presence, not its content: an empty detail still renders. */
defineProps({
	testid: { type: String, default: undefined },
	subTestid: { type: String, default: undefined },
	detailTestid: { type: String, default: undefined },
})
</script>

<template>
	<div :class="$style.wrapper" :data-testid="testid">
		<div :class="$style.card">
			<slot name="icon"><MaterialIcon name="warning" size="24" color="--red" /></slot>
			<span :class="$style.title"><slot name="title" /></span>
			<span v-if="$slots.sub" :class="$style.sub" :data-testid="subTestid"><slot name="sub" /></span>
			<span v-if="$slots.detail" :class="$style.detail" :data-testid="detailTestid"><slot name="detail" /></span>
			<slot />
		</div>
	</div>
</template>

<style module>
.wrapper {
	position: fixed;
	inset: 0;

	display: flex;
	justify-content: center;
	align-items: center;

	background-color: rgba(10, 9, 8, 0.92);
	z-index: 10000;
}

.card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;

	max-width: 280px;
	text-align: center;
}

.title {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	color: var(--txt-primary);
}

.sub {
	font-size: 12px;
	color: var(--txt-secondary);
}

.detail {
	font-size: 10px;
	color: var(--txt-tertiary);
	word-break: break-word;
}
</style>
