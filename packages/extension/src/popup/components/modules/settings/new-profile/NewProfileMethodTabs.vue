<script setup>
/**
 * Method tabs for the create-profile page (Password / Passkey).
 * Two-tab segmented control bound through v-model. The active tab
 * gets the underline + primary color treatment.
 */
const type = defineModel("type", { type: String, default: "password" })
</script>

<template>
	<div :class="$style.section">
		<span :class="$style.section_label">Method</span>
		<div :class="$style.tabs">
			<button
				type="button"
				@click="type = 'password'"
				:class="[$style.tab, type === 'password' && $style.tab_active]"
				data-testid="register-method-password"
			>
				Password
			</button>
			<button
				type="button"
				@click="type = 'passkey'"
				:class="[$style.tab, type === 'passkey' && $style.tab_active]"
				data-testid="register-method-passkey"
			>
				Passkey
			</button>
		</div>
	</div>
</template>

<style module>
/* No outer border-bottom: the inner .tabs already paints its own underline
 * (the active-tab marker overlaps it via bottom: -1px). Stacking the
 * section-level divider on top of the tabs underline created the
 * "double-line" look across the password flow. */
.section {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px 0;
}

.section_label {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	color: var(--nulo-secondary);
}

.tabs {
	display: grid;
	grid-template-columns: 1fr 1fr;
	border-bottom: 1px solid var(--nulo-border);
}

.tab {
	position: relative;

	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: var(--nulo-secondary);

	background: transparent;
	border: none;
	cursor: pointer;

	padding: 14px 0;

	transition: color 0.15s var(--bezier);
}

.tab:hover:not(.tab_active) {
	color: var(--txt-primary);
}

.tab_active {
	color: var(--txt-primary);
}

.tab_active::after {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	bottom: -1px;
	height: 2px;
	background: var(--nulo-accent);
}

.tab:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 2px;
}
</style>
