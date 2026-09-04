<script setup lang="ts">
/** Utils */
import { onMounted, useTemplateRef } from "vue"
import { SPRITE_SOURCE, adoptableSymbols } from "./token-sprite"

const sheet = useTemplateRef<SVGSVGElement>("sheet")

// Adopted as PARSED, allowlisted nodes, never as injected markup: the page keeps no raw-HTML sink,
// and only drawing elements can reach the document. The first sheet in document order owns the ids,
// so a second instance stays empty rather than duplicating them.
onMounted(() => {
	const host = sheet.value
	if (!host || host.childElementCount > 0) return
	if (document.querySelector("svg[data-token-sprite]") !== host) return
	for (const symbol of adoptableSymbols(SPRITE_SOURCE)) host.appendChild(document.importNode(symbol, true))
})
</script>

<template>
	<svg ref="sheet" class="sheet" data-token-sprite aria-hidden="true" focusable="false" />
</template>

<style scoped>
/* Out of layout and out of the accessibility tree: it exists only as a <use> target. */
.sheet {
	position: absolute;
	width: 0;
	height: 0;
	overflow: hidden;
}
</style>
