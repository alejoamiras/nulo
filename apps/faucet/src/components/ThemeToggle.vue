<script setup lang="ts">
import { computed } from "vue"
import { useTheme } from "@/composables/useTheme"
import { TESTIDS } from "@/lib/testids"

const { mode, cycleTheme } = useTheme()

const ICON = { dark: "dark_mode", light: "light_mode", system: "brightness_auto" } as const
const LABEL = { dark: "Dark", light: "Light", system: "System" } as const

const icon = computed(() => ICON[mode.value])
const label = computed(() => LABEL[mode.value])
</script>

<template>
	<button
		type="button"
		class="theme-toggle"
		:data-testid="TESTIDS.themeToggle"
		:data-theme-mode="mode"
		:aria-label="`Theme: ${label}. Click to change.`"
		:title="`Theme: ${label}`"
		@click="cycleTheme"
	>
		<span class="material-symbols-outlined" aria-hidden="true">{{ icon }}</span>
		<span class="label">{{ label }}</span>
	</button>
</template>

<style scoped>
.theme-toggle {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-family: var(--font-headline, inherit);
	font-weight: 600;
	font-size: 13px;
	color: var(--txt-secondary);
	background: transparent;
	border: none;
	padding: 8px 12px;
	cursor: pointer;
	transition: color 0.15s ease;
}

.theme-toggle:hover {
	color: var(--txt-primary);
}

.theme-toggle .material-symbols-outlined {
	font-size: 18px;
}
</style>
