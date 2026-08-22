<script setup>
/**
 * Method-selection list shown on the import page when no import method is
 * selected yet. Three entries; passkey is fired immediately as an event,
 * the others set the import option in the parent.
 */
const emit = defineEmits(["select", "passkey"])

const props = defineProps({
	type: { type: String, default: "import" }, // "import" | "recovery"
})
</script>

<template>
	<div :class="$style.section_last">
		<span :class="$style.section_label">{{ type === "recovery" ? "Recovery" : "Import" }} with</span>
		<ItemsContainer flat>
			<SettingItem
				@click="emit('select', 'full_backup')"
				data-testid="import-option-full-backup"
				title="Full Backup"
				chevron
			/>
			<SettingItem @click="emit('select', 'seed')" data-testid="import-option-seed" title="Recovery Phrase" chevron />
			<SettingItem
				@click="emit('passkey')"
				data-testid="import-option-passkey"
				title="Passkey"
				chevron
			/>
		</ItemsContainer>
	</div>
</template>

<style module>
.section_last {
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
</style>
