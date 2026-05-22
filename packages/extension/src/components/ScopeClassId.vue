<script setup lang="ts">
/**
 * Renderer for `contractClasses.classes` scope entries. Class IDs LOOK
 * like addresses (long hex strings) but are NOT addresses — they're
 * compiled-program identifiers. Resolving them against the contact
 * book would mislabel them with whatever contact happens to share the
 * same hex; v1 of this rework made that mistake with `<AddressDisplay>`.
 *
 * The component shares its visual rhythm with `<ScopeAddress>` so the
 * detail panel stays consistent, but explicitly drops contact lookup so
 * a hostile dApp can't pick a class ID that collides with a user's
 * named contact to imply a relationship that doesn't exist.
 */
import { trimAddress } from "@/utils/string"
import { sanitizeWireString, stripWireControl } from "@/wallet/services/dapp-session/capability-meta"

const props = defineProps<{ id: string }>()

const { openToast } = useToast()

function handleClick() {
	// Same stripping-without-truncation rule as ScopeAddress (codex post-impl §3).
	window.navigator.clipboard.writeText(stripWireControl(props.id))
	openToast({ label: "Class id is copied", icon: "copy" })
}
</script>

<template>
	<span
		data-testid="scope-class-id"
		:data-scope-class-id="id"
		@click="handleClick"
		@keydown.enter="handleClick"
		role="button"
		tabindex="0"
		:class="$style.row"
	>
		<span :class="$style.id">{{ sanitizeWireString(trimAddress(id), 128) }}</span>
	</span>
</template>

<style module>
.row {
	display: inline-flex;
	align-items: center;

	cursor: pointer;
	outline: none;
	word-break: break-all;
	line-height: 1.4;

	transition: color 0.15s var(--bezier);

	&:hover .id,
	&:focus-visible .id {
		color: var(--txt-primary);
	}
}

.id {
	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--nulo-secondary);
}
</style>
