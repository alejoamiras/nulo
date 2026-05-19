<script setup>
/**
 * Page chrome shared by `pages/settings/security/export/key.vue` and
 * `.../export/seed.vue`. Owns:
 *
 * - SubPageHeader with the scroll-collapse "secondary title" treatment
 * - Hero block (big two-tone title + accent bar)
 * - Scrollable content slot
 * - Bottom-bar slot (page wires its CTA — usually `<Button>` or
 *   `<SecretCountdownClose>`)
 *
 * The page owns variant-picking + reveal/unlock flow; the layout is
 * purely visual chrome.
 */
defineProps({
	/**
	 * Hero title is rendered in two stacked lines using the `<<main>>`
	 * + `<<sub>>` pair. Pass a single string in `heroMain` if you don't
	 * need the sub-line.
	 */
	heroMain: { type: String, required: true },
	heroSub: { type: String, default: "" },
	/** Compact title shown in SubPageHeader once the hero scrolls out. */
	collapsingLabel: { type: String, required: true },
	/** Where the back arrow points. */
	backTo: { type: String, required: true },
})

const wrapperRef = useTemplateRef("wrapperRef")
const heroVisible = ref(true)
let scrollEl = null

const handleScroll = () => {
	if (!scrollEl) return
	heroVisible.value = scrollEl.scrollTop < 40
}

onMounted(async () => {
	await nextTick()
	scrollEl = wrapperRef.value?.wrapper
	if (!scrollEl) return
	scrollEl.addEventListener("scroll", handleScroll, { passive: true })
	handleScroll()
})

onBeforeUnmount(() => {
	scrollEl?.removeEventListener("scroll", handleScroll)
	scrollEl = null
})
</script>

<template>
	<Flex direction="column" :class="$style.page">
		<Flex ref="wrapperRef" direction="column" :class="$style.wrapper">
			<SubPageHeader :backTo="backTo">
				<template #title>
					<span :class="[$style.collapsing_label, !heroVisible && $style.collapsing_label_visible]">
						{{ collapsingLabel }}
					</span>
				</template>
			</SubPageHeader>

			<Flex direction="column" :class="$style.content">
				<div :class="$style.hero">
					<div :class="$style.title_stack">
						<span :class="$style.title_main">{{ heroMain }}</span>
						<span v-if="heroSub" :class="$style.title_sub">{{ heroSub }}</span>
					</div>
					<div :class="$style.hero_bar" />
				</div>

				<slot />
			</Flex>
		</Flex>

		<div v-if="$slots.bottom" :class="$style.bottom">
			<slot name="bottom" />
		</div>
	</Flex>
</template>

<style module>
.page {
	flex: 1;
	min-height: 0;
	background: var(--app-bg);
}

.wrapper {
	flex: 1;
	min-height: 0;
	overflow: auto;
	scrollbar-gutter: stable;
}

.collapsing_label {
	font-family: var(--font-headline);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--txt-primary);

	text-decoration: underline;
	text-decoration-color: var(--nulo-accent);
	text-decoration-thickness: 2px;
	text-underline-offset: 4px;

	opacity: 0;
	pointer-events: none;

	transition: opacity 0.18s cubic-bezier(0.4, 0, 1, 1);
}

.collapsing_label_visible {
	opacity: 1;
	pointer-events: auto;
}

.content {
	flex: 1;
	padding: 0 24px;
}

.hero {
	padding: 20px 0;
}

.title_stack {
	display: flex;
	flex-direction: column;
	line-height: 1.02;
}

.title_main {
	font-family: var(--font-headline);
	font-size: 40px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-accent);
}

.title_sub {
	font-family: var(--font-headline);
	font-size: 40px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.hero_bar {
	width: 32px;
	height: 2px;
	background: var(--nulo-accent);
	margin-top: 10px;
}

.bottom {
	flex-shrink: 0;
	padding: 20px 24px;
	background: var(--app-bg);
	border-top: 1px solid var(--nulo-border);
}

/**
 * Shared section utility classes. Prefixed `export_` so the global
 * names cannot collide with unrelated `.section` classes elsewhere.
 * Consumer pages reference these directly: `<div class="export_section">`.
 */
:global(.export_section) {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px 0;
	border-bottom: 1px solid rgba(35, 31, 28, 1);
}

:global(.export_section:last-child) {
	border-bottom: none;
}

:global(.export_section_last) {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px 0;
}

:global(.export_section_label) {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	color: var(--nulo-secondary);
}

:global(.export_learn_link) {
	display: inline-block;
	align-self: flex-start;

	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;

	color: var(--nulo-secondary);
	text-decoration: underline;
	text-decoration-thickness: 1px;
	text-underline-offset: 4px;

	transition: color 0.2s var(--bezier);
}

:global(.export_learn_link:hover) {
	color: var(--txt-primary);
}

:global([theme="light"] .export_learn_link) {
	color: var(--txt-secondary);
}

:global([theme="light"] .export_learn_link:hover) {
	color: var(--txt-primary);
}
</style>
