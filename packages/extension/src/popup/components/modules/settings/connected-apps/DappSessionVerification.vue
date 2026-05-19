<script setup>
import EmojiGrid from "@/components/composite/general/EmojiGrid.vue"

/**
 * Shared-secret verification block for the connected-app detail page.
 * Renders the emoji grid and the always-trust toggle. Emits
 * `toggle-trust` with the new value; parent persists it through the
 * service.
 */
const props = defineProps({
	emojis: { type: String, required: true },
	isTrusted: { type: Boolean, default: false },
})

const emit = defineEmits(["toggleTrust"])
</script>

<template>
	<Flex direction="column" gap="10" wide>
		<SectionLabel label="Connection verification" />
		<Flex direction="column" align="center" wide>
			<EmojiGrid :emojis="emojis" />
		</Flex>
		<Text size="12" color="tertiary" :style="{ lineHeight: '1.4' }">
			These emojis should match what the connected app displays
		</Text>
		<Flex align="center" justify="between" gap="12" wide>
			<Flex direction="column" gap="4">
				<span :class="$style.setting_key">Always trust</span>
				<span :class="$style.setting_sub">Skip verification on reconnect</span>
			</Flex>
			<Toggle :modelValue="isTrusted" @update:modelValue="(v) => emit('toggleTrust', v)" />
		</Flex>
	</Flex>
</template>

<style module>
.setting_key {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.setting_sub {
	font-family: var(--font-mono);
	font-size: 11px;
	line-height: 1.4;
	color: var(--nulo-outline);
}
</style>
