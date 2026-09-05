<script setup lang="ts">
/** Components */
import SendWizard from "@/components/send/SendWizard.vue"

/** Utils */
import { IS_PLACEHOLDER } from "@/contracts/bridge-generation"
import { TESTIDS } from "@/lib/testids"

/**
 * `IS_PLACEHOLDER` is per-NETWORK, not per-build: a manifest with no bridge block means this network
 * has no generation to send through yet. The wizard is a child component precisely so that state
 * never instantiates its composables — nothing wires the journal engine to a bridge that isn't there.
 * The wallet chips and the journal live in the shell; this view is the wizard.
 */
</script>

<template>
	<div class="send-view" :data-testid="TESTIDS.sendView">
		<section v-if="IS_PLACEHOLDER" class="placeholder" :data-testid="TESTIDS.sendUnavailable">
			<p class="placeholder-title">Bridging is being upgraded</p>
			<p class="sub">Back with the next generation on this network. The faucet keeps working meanwhile.</p>
		</section>
		<SendWizard v-else />
	</div>
</template>

<style scoped>
.send-view {
	display: flex;
	flex-direction: column;
	gap: 28px;
	width: 100%;
	max-width: 760px;
}

.sub {
	color: var(--txt-secondary);
	font-size: 15px;
	max-width: 62ch;
	margin: 0;
	line-height: 1.55;
}

.placeholder {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 24px;
	border: 1px dashed var(--nulo-outline);
}

.placeholder-title {
	margin: 0;
	color: var(--txt-primary);
	font: 600 15px/1.4 var(--font-mono);
	letter-spacing: 0.04em;
}
</style>
