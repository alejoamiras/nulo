<script setup lang="ts">
import type { SeverityTone } from "../severity"

type Kind = Extract<SeverityTone, "ok" | "error" | "info">

withDefaults(
	defineProps<{
		kind?: Kind
		text: string
		link?: { label: string; href: string }
	}>(),
	{ kind: "info" },
)

const emit = defineEmits<{ dismiss: [] }>()
</script>

<template>
	<div :class="['toast', `toast--${kind}`]" :data-kind="kind" role="status" aria-live="polite">
		<span class="toast__text">{{ text }}</span>
		<a
			v-if="link"
			class="toast__link"
			:href="link.href"
			target="_blank"
			rel="noopener noreferrer"
		>{{ link.label }}</a>
		<button class="toast__dismiss" aria-label="Dismiss" @click="emit('dismiss')">×</button>
	</div>
</template>

<style scoped>
.toast {
	display: inline-flex;
	align-items: center;
	gap: 12px;
	padding: 12px 16px;
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font-size: 14px;
	min-width: 280px;
	max-width: 480px;
}

.toast--ok { border-left: 3px solid var(--mint); }
.toast--error { border-left: 3px solid var(--red); }
.toast--info { border-left: 3px solid var(--nulo-accent); }

.toast__text { flex: 1; }

.toast__link {
	color: var(--nulo-accent);
	text-decoration: underline;
	text-underline-offset: 2px;
	font-family: var(--font-mono);
	font-size: 12px;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.toast__dismiss {
	color: var(--txt-secondary);
	font-size: 20px;
	line-height: 1;
	padding: 0 4px;
}

.toast__dismiss:hover { color: var(--txt-primary); }
</style>
