<script setup lang="ts">
/** Utils */
import { computed, ref } from "vue"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{
	/** What the catalog said about the last accepted address (already in the list, zero address, …). */
	error: string | null
}>()
const emit = defineEmits<{ paste: [address: string] }>()

const HEX20 = /^0x[0-9a-fA-F]{40}$/
const SHAPE_ERROR = "Enter a token address: 0x followed by 40 hex characters."
/** Referenced by the field's `aria-describedby`: one paste row exists at a time. */
const ERROR_ID = "send-paste-error"

const draft = ref("")
const localError = ref<string | null>(null)

const shown = computed(() => localError.value ?? props.error)

function onInput(): void {
	// The shape complaint belongs to the text that produced it; the parent's error is its own to clear.
	localError.value = null
}

function submit(): void {
	const trimmed = draft.value.trim()
	if (!HEX20.test(trimmed)) {
		localError.value = SHAPE_ERROR
		return
	}
	localError.value = null
	emit("paste", trimmed.toLowerCase())
}
</script>

<template>
	<div class="paste">
		<label class="label" for="send-paste-address">Not listed? Paste its Ethereum address</label>
		<div class="row">
			<input
				id="send-paste-address"
				v-model="draft"
				class="input"
				type="text"
				inputmode="text"
				autocomplete="off"
				spellcheck="false"
				placeholder="0x…"
				:aria-invalid="shown ? 'true' : undefined"
				:aria-describedby="shown ? ERROR_ID : undefined"
				:data-testid="TESTIDS.sendPasteInput"
				:data-invalid="shown ? 'true' : undefined"
				@input="onInput"
				@keydown.enter.prevent="submit"
			/>
			<button type="button" class="add" :disabled="draft.trim() === ''" :data-testid="TESTIDS.sendPasteAdd" @click="submit">ADD</button>
		</div>
		<p v-if="shown" :id="ERROR_ID" class="err" aria-live="polite" :data-testid="TESTIDS.sendPasteError">{{ shown }}</p>
	</div>
</template>

<style scoped>
.paste {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.label {
	font: 600 11px/1 var(--font-mono);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--txt-secondary);
}

.row {
	display: flex;
	gap: 8px;
}

.input {
	flex: 1;
	min-width: 0;
	padding: 8px 10px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 500 12px/1.3 var(--font-mono);
}

.input[data-invalid] {
	border-color: var(--red);
}

.add {
	padding: 8px 14px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.05em;
	cursor: pointer;
}

.add:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.add:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.err {
	margin: 0;
	color: var(--red);
	font: 500 12px/1.5 var(--font-mono);
}
</style>
