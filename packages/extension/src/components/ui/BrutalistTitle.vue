<script setup lang="ts">
/**
 * Two-line uppercase brutalist title used as the page hero across all 6
 * onboarding pages. Accent-color main line + secondary-color sub line,
 * stacked, Space Grotesk weight 700. The accent bar that sits below most
 * heroes stays inline at each consumer — bar widths vary per page and
 * don't justify a prop.
 *
 * Center alignment adds a small gap between the two lines; left alignment
 * has no gap. Two sizes: 48px default, 56px hero (used only on welcome).
 *
 * Renders as `<h1>` — every consumer is a page-level hero.
 */
defineProps<{
	main: string
	sub: string
	align?: "left" | "center"
	size?: "default" | "hero"
}>()
</script>

<template>
	<h1
		:class="[
			$style.stack,
			align === 'center' && $style.center,
			size === 'hero' && $style.hero,
		]"
	>
		<span :class="$style.main">{{ main }}</span>
		<span :class="$style.sub">{{ sub }}</span>
	</h1>
</template>

<style module>
.stack {
	display: flex;
	flex-direction: column;
	line-height: 0.95;
	margin: 0;
	font-weight: 700;
}

.center {
	align-items: center;
	gap: 4px;
}

.main,
.sub {
	font-family: var(--font-headline);
	font-size: 48px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
}

.hero .main,
.hero .sub {
	font-size: 56px;
}

.main {
	color: var(--nulo-accent);
}

.sub {
	color: var(--nulo-secondary);
}
</style>
