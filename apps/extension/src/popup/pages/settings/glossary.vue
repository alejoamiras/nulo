<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Utils */
import { GLOSSARY, GLOSSARY_SECTIONS } from "@/utils/glossary"
</script>

<template>
	<SettingsPageShell title="Glossary" backTo="/popup/settings">
		<section
			v-for="section in GLOSSARY_SECTIONS"
			:key="section.title"
			:class="$style.section"
			:data-testid="`glossary-section-${section.title.toLowerCase()}`"
		>
			<span :class="$style.title">{{ section.title }}</span>
			<div v-for="key in section.keys" :key="key" :class="$style.entry" :data-testid="`glossary-entry-${key}`">
				<span :class="$style.term" :data-testid="`glossary-term-${key}`">{{ GLOSSARY[key].term }}</span>
				<span :class="$style.definition" :data-testid="`glossary-definition-${key}`">{{ GLOSSARY[key].definition }}</span>
				<span :class="$style.where" :data-testid="`glossary-where-${key}`">{{ GLOSSARY[key].where }}</span>
			</div>
		</section>
	</SettingsPageShell>
</template>

<style module>
.section {
	display: flex;
	flex-direction: column;
}

.title {
	padding: 18px 0 2px;

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

/* The shell's content already starts 16px down, where the drawn list starts 4px down. */
.section:first-child .title {
	padding-top: 6px;
}

.entry {
	display: flex;
	flex-direction: column;
	gap: 4px;

	padding: 12px 0;
	border-bottom: 1px solid rgba(74, 70, 63, 0.2);
}

.term {
	font-size: 14px;
	font-weight: 600;
	color: var(--txt-primary);
}

.definition {
	font-size: 12.5px;
	line-height: 1.45;
	color: var(--nulo-secondary);
}

.where {
	font-family: var(--font-mono);
	font-size: 9.5px;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--nulo-outline);
}
</style>
