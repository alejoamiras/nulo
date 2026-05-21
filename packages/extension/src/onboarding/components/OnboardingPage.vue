<script setup lang="ts">
/**
 * Shared layout shell for every onboarding tab page. Owns the unified
 * 640 px max-width, the top margin, and the flex column that lets
 * `welcome.vue`'s legal footer pin to the bottom via `margin-top: auto`.
 *
 * Renders a `<div>` (NOT `<main>`) — app.vue's `.shell` is already the
 * page's single `<main>` landmark; nesting another `<main>` would violate
 * HTML5 + WAI-ARIA-1.2. The test file asserts `tagName === 'DIV'` so a
 * future refactor can't silently re-introduce nested-`<main>`.
 *
 * Hosts a CSS container (`container-type: inline-size`,
 * `container-name: onboarding-page`) so `learn.vue`'s 3-card grid can
 * stack via container query — viewport-based queries would have to
 * account for app.vue's 24+24 px horizontal padding, which is fragile.
 */

const props = defineProps<{
	/** Centers the inner content + hero block. Used by welcome + done. */
	align?: "start" | "center"
	/** Inter-child gap in px. Default 32 px. `import` passes 24, `learn`
	 * + `done` pass 40, `welcome` passes 56. */
	gap?: number
}>()

// `!== undefined` (not a truthy check) — otherwise `gap=0` silently collapses
// to the 32 px default.
const gapVar = computed(() => (props.gap !== undefined ? { "--onboarding-page-gap": `${props.gap}px` } : undefined))
</script>

<template>
	<div :class="[$style.page, align === 'center' && $style.center]" :style="gapVar">
		<slot />
	</div>
</template>

<style module>
.page {
	display: flex;
	flex-direction: column;
	width: 100%;
	max-width: 640px;
	margin: 24px auto 0;
	gap: var(--onboarding-page-gap, 32px);

	/* welcome.vue's footer pins via `margin-top: auto`; only works while
	 * the page is a flex column that fills the shell's available height. */
	flex: 1;

	/* Anchor for learn.vue's @container query. Benign on other pages. */
	container-type: inline-size;
	container-name: onboarding-page;
}

.center {
	align-items: center;
}
</style>
