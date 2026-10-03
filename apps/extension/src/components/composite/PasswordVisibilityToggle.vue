<script setup>
/**
 * Show/hide button for a credential `Input`'s `#suffix`. Out of the Tab order by owner decision
 * (CLAUDE.md § Keyboard & focus order). The host owns the flag and negates it on `toggle`, so one
 * flag can mask several fields and two clicks in one task cancel out.
 */
defineProps({
	hidden: { type: Boolean, required: true },
	subject: { type: String, default: "password" },
})

const emit = defineEmits(["toggle"])
</script>

<template>
	<button
		type="button"
		tabindex="-1"
		:class="$style.visibility_btn"
		:aria-label="hidden ? `Show ${subject}` : `Hide ${subject}`"
		@click="emit('toggle')"
	>
		<MaterialIcon :name="hidden ? 'visibility' : 'visibility_off'" :size="18" color="secondary" />
	</button>
</template>

<style module>
.visibility_btn {
	display: flex;
	align-items: center;
	justify-content: center;
	background: transparent;
	border: none;
	cursor: pointer;
	padding: 4px 0 4px 8px;
}
</style>
