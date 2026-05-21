<script setup lang="ts">
import { TESTIDS } from "@/lib/testids"
import AppButton from "./ui/AppButton.vue"
import EmojiGrid from "./composite/EmojiGrid.vue"

defineProps<{ emojis: string | null }>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()

function onKey(evt: KeyboardEvent) {
	if (evt.key === "Escape") emit("cancel")
}
</script>

<template>
	<Teleport to="body">
		<div
			v-if="emojis"
			class="overlay"
			role="dialog"
			aria-modal="true"
			:data-testid="TESTIDS.verificationModal"
			tabindex="-1"
			@keydown="onKey"
		>
			<div class="modal">
				<h2 class="title">VERIFY THE GRID</h2>
				<p class="body">Match this grid with the wallet window. If it differs, stop.</p>
				<p class="secondary">This check is for the secure channel. It is not decorative.</p>
				<EmojiGrid :emojis="emojis" class="grid" />
				<div class="actions">
					<AppButton
						variant="outline"
						:data-testid="TESTIDS.btnVerifyCancel"
						@click="emit('cancel')"
					>
						Cancel
					</AppButton>
					<AppButton
						variant="primary"
						:data-testid="TESTIDS.btnVerifyConfirm"
						@click="emit('confirm')"
					>
						They match
					</AppButton>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.overlay {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.7);
	z-index: 100;
	padding: 24px;
}

.modal {
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-outline);
	padding: 32px;
	display: flex;
	flex-direction: column;
	gap: 16px;
	max-width: 480px;
	width: 100%;
}

.title {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 20px;
	letter-spacing: 0.04em;
	color: var(--txt-primary);
}

.body {
	color: var(--txt-primary);
	font-size: 14px;
}

.secondary {
	color: var(--txt-secondary);
	font-size: 12px;
}

.grid {
	margin: 8px 0;
	align-self: center;
}

.actions {
	display: flex;
	gap: 12px;
	justify-content: flex-end;
}
</style>
