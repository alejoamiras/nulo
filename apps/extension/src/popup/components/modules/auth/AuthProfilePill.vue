<script setup>
/**
 * Compact "Current Profile" pill used by `pages/auth.vue` to show
 * which profile the user is about to unlock and surface the
 * "Switch profile" affordance.
 */
defineProps({
	name: { type: String, default: "" },
})

const emit = defineEmits(["click"])
</script>

<template>
	<button
		@click="emit('click')"
		type="button"
		data-testid="auth-profile"
		:class="$style.profile_pill"
	>
		<Flex align="center" gap="12">
			<div :class="$style.profile_icon_box">
				<MaterialIcon name="person" :size="16" color="secondary" />
			</div>
			<Flex direction="column" align="start" gap="2">
				<span :class="$style.profile_label">Current Profile</span>
				<span :class="$style.profile_name">{{ name }}</span>
			</Flex>
		</Flex>
		<MaterialIcon name="chevron_right" :size="18" color="secondary" />
	</button>
</template>

<style module>
.profile_pill {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;

	width: 100%;
	max-width: 280px;

	background: var(--nulo-surface-low);
	border: 1px solid var(--nulo-border);
	cursor: pointer;

	padding: 10px 14px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-high);
		border-color: var(--nulo-outline);
	}
}

.profile_icon_box {
	display: flex;
	align-items: center;
	justify-content: center;

	width: 32px;
	height: 32px;

	background: var(--nulo-surface-highest);
	border: 1px solid var(--nulo-border);

	flex-shrink: 0;
}

.profile_label {
	font-family: var(--font-mono);
	font-size: 9px;
	font-weight: 500;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nulo-secondary);
}

.profile_name {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 500;
	letter-spacing: -0.02em;
	color: var(--txt-primary);
	max-width: 180px;

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
