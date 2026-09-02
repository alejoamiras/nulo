<script setup lang="ts">
import { computed, type PropType, ref, watch } from "vue"
import { useWalletConnection } from "@/composables/useWalletConnection"
import { TESTIDS } from "@/lib/testids"

const props = defineProps({
	/** Error categories the strip must NOT show — states that already own a
	 *  dedicated UI in the wallet panel (denied morph, install-Nulo CTA). */
	exclude: {
		type: Array as PropType<string[]>,
		default: () => ["capability-rejected"],
	},
})

const { status, error } = useWalletConnection()

const dismissed = ref(false)
watch(error, () => {
	dismissed.value = false
})

const visible = computed(
	() => status.value === "error" && error.value !== null && !props.exclude.includes(error.value.category) && !dismissed.value,
)
</script>

<template>
	<div v-if="visible" class="strip" role="alert" :data-testid="TESTIDS.errorStrip">
		<span class="label">Error</span>
		<span class="msg">{{ error?.message }}</span>
		<button
			class="x"
			type="button"
			aria-label="Dismiss"
			:data-testid="TESTIDS.errorStripDismiss"
			@click="dismissed = true"
		>
			✕
		</button>
	</div>
</template>

<style scoped>
.strip {
	display: flex;
	align-items: center;
	gap: 12px;
	border: 1px solid var(--red);
	border-left-width: 3px;
	background: color-mix(in srgb, var(--red) 6%, var(--card-bg));
	padding: 10px 14px;
	font-size: 13px;
}

.label {
	color: var(--red);
	font: 700 10px/1 var(--font-mono);
	letter-spacing: 0.12em;
	text-transform: uppercase;
	flex: none;
}

.msg {
	flex: 1;
	min-width: 0;
}

.x {
	background: none;
	border: none;
	color: var(--txt-secondary);
	font: 600 12px/1 var(--font-mono);
	cursor: pointer;
	padding: 2px 4px;
	flex: none;
}

.x:hover {
	color: var(--txt-primary);
}
</style>
