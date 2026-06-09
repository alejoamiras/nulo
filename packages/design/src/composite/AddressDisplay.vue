<script setup lang="ts">
import { computed, ref } from "vue"

const props = withDefaults(defineProps<{ address: string; head?: number; tail?: number }>(), { head: 6, tail: 4 })

const emit = defineEmits<{ copy: [address: string] }>()

const copied = ref(false)

const short = computed(() => {
	const a = props.address
	if (!a) return "—"
	if (a.length <= props.head + props.tail + 2) return a
	return `${a.slice(0, props.head)}…${a.slice(-props.tail)}`
})

async function onClick() {
	if (!props.address) return
	try {
		await navigator.clipboard.writeText(props.address)
		copied.value = true
		setTimeout(() => {
			copied.value = false
		}, 1200)
		emit("copy", props.address)
	} catch {
		// best-effort; surface a toast at the call site if desired
	}
}
</script>

<template>
	<button
		class="address"
		type="button"
		:title="address"
		:aria-label="`Copy address ${address}`"
		@click="onClick"
	>
		<span class="value">{{ short }}</span>
		<span v-if="copied" class="copied-hint">copied</span>
	</button>
</template>

<style scoped>
.address {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	font-family: var(--font-mono);
	font-size: 13px;
	color: var(--txt-primary);
	border: 1px solid var(--nulo-outline);
	padding: 6px 10px;
	background: var(--nulo-surface-low);
	cursor: copy;
}

.address:hover {
	border-color: var(--nulo-accent);
}

.copied-hint {
	color: var(--mint);
	font-size: 11px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
}
</style>
