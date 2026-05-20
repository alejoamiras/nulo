<script setup lang="ts">
/**
 * Onboarding step indicator. Four-step brutalist row:
 *   [01]     [02]     [03]     [04]
 *   ━━━━━    ━━━━━    ─────    ─────
 *   SETUP    AZTEC    SPEED    DONE
 *
 * The 2px bar underneath each cell carries the state:
 *   active:  --nulo-accent (warm off-white)
 *   past:    --nulo-secondary
 *   future:  --nulo-border (dim, almost-bg)
 *
 * Welcome page intentionally has no indicator — it owns the canvas with
 * its own hero. Indicator appears starting from /create.
 */
defineProps<{ current: 1 | 2 | 3 | 4 }>()

const steps: Array<{ num: string; label: string }> = [
	{ num: "01", label: "Setup" },
	{ num: "02", label: "Aztec" },
	{ num: "03", label: "Speed" },
	{ num: "04", label: "Done" },
]
</script>

<template>
	<nav :class="$style.row" aria-label="Onboarding progress">
		<div
			v-for="(s, i) in steps"
			:key="s.num"
			:class="[
				$style.cell,
				i + 1 < current && $style.past,
				i + 1 === current && $style.active,
				i + 1 > current && $style.future,
			]"
			:aria-current="i + 1 === current ? 'step' : undefined"
		>
			<span :class="$style.num">{{ s.num }}</span>
			<span :class="$style.bar" />
			<span :class="$style.label">{{ s.label }}</span>
		</div>
	</nav>
</template>

<style module>
.row {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 8px;
	width: 100%;
	max-width: 560px;
	margin: 0 auto 16px;
}

.cell {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.num {
	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.08em;
	color: var(--txt-tertiary);
	transition: color 0.2s var(--bezier);
}

.bar {
	display: block;
	width: 100%;
	height: 2px;
	background: var(--nulo-border);
	transition: background 0.2s var(--bezier);
}

.label {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
	transition: color 0.2s var(--bezier);
}

.past .num,
.past .label {
	color: var(--nulo-secondary);
}
.past .bar {
	background: var(--nulo-secondary);
}

.active .num,
.active .label {
	color: var(--txt-primary);
}
.active .bar {
	background: var(--nulo-accent);
}
</style>
