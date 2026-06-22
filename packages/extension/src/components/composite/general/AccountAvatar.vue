<script setup lang="ts">
/** Utils */
import { getInitials } from "@/utils/string"

/** Macros */
const props = defineProps<{
	name?: string
	address?: string
	size?: number
}>()

/** Reactive state */
const sizePx = computed(() => props.size ?? 28)
const initials = computed(() => getInitials(props.name ?? ""))
const fontSize = computed(() => Math.max(9, Math.round(sizePx.value * 0.4)))

// Deterministic disc color from the address. This is DECORATION ONLY — the
// account's identity is carried by the name + address shown next to it; the
// color just lets accounts be told apart at a glance. Collisions are expected
// and harmless (a palette index, never a security indicator). djb2 over the
// lowercased address; falls back to the name, then a fixed index.
const PALETTE = ["#C0392B", "#D35400", "#B7950B", "#1E8449", "#117A65", "#2471A3", "#6C3483", "#A93226", "#BA4A78", "#515A5A"]
const color = computed(() => {
	const key = (props.address || props.name || "").toLowerCase()
	if (!key.length) return PALETTE[0]
	let h = 5381
	for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
	return PALETTE[h % PALETTE.length]
})
</script>

<template>
	<Flex
		align="center"
		justify="center"
		:class="$style.avatar"
		:style="{ width: `${sizePx}px`, height: `${sizePx}px`, background: color }"
		data-testid="account-avatar"
		:data-initials="initials"
	>
		<Text color="white" weight="600" :style="{ fontSize: `${fontSize}px`, lineHeight: 1 }">{{ initials }}</Text>
	</Flex>
</template>

<style module>
.avatar {
	flex-shrink: 0;
	border-radius: 6px;
	overflow: hidden;
	user-select: none;
}
</style>
