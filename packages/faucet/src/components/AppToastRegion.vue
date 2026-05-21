<script setup lang="ts">
import { useToast } from "@/composables/useToast"
import { TESTIDS } from "@/lib/testids"
import Toast from "./ui/Toast.vue"

const { toasts, dismiss } = useToast()
</script>

<template>
	<div class="toast-region" aria-live="polite">
		<TransitionGroup name="toast">
			<Toast
				v-for="t in toasts"
				:key="t.id"
				:kind="t.kind"
				:text="t.text"
				:link="t.link"
				:data-testid="TESTIDS.toast"
				@dismiss="dismiss(t.id)"
			/>
		</TransitionGroup>
	</div>
</template>

<style scoped>
.toast-region {
	position: fixed;
	top: 24px;
	right: 24px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	z-index: 1000;
	max-width: calc(100% - 48px);
}
</style>
