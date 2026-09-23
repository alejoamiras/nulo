<script setup lang="ts">
/**
 * A bordered mono search box: icon + native input. No sanitizer by design — the value never
 * leaves the surface that owns it and a symbol may contain any punctuation.
 */
defineProps({
	modelValue: { type: String, required: true },
	placeholder: { type: String, default: "Search" },
	testid: { type: String, default: undefined },
})
defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
	<label :class="$style.search">
		<MaterialIcon name="search" :size="16" color="secondary" />
		<input
			:value="modelValue"
			@input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
			type="text"
			:placeholder="placeholder"
			maxlength="80"
			autocomplete="off"
			spellcheck="false"
			:data-testid="testid"
			:class="$style.search_input"
		/>
	</label>
</template>

<style module>
.search {
	display: flex;
	align-items: center;
	gap: 8px;

	height: 36px;
	padding: 0 10px;
	border: 1px solid var(--nulo-outline);
	background: var(--nulo-surface);
	cursor: text;
}

.search_input {
	flex: 1;
	min-width: 0;

	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--txt-primary);
	background: transparent;
	border: none;
	outline: none;

	&::placeholder {
		color: var(--nulo-outline);
	}
}
</style>
