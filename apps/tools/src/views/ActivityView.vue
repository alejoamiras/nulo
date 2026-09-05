<script setup lang="ts">
/** Components */
import BridgeJournal from "@/components/BridgeJournal.vue"

/** Composables */
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useShell } from "@/composables/useShell"

/** Utils */
import { computed } from "vue"
import { IS_PLACEHOLDER } from "@/contracts/bridge-generation"
import { TESTIDS } from "@/lib/testids"

/**
 * Every bridge as its full card. On this section the wizard's stepper is off screen, so the list
 * reads ALL records, the foregrounded one included. A first visit gets the two verbs instead of an
 * empty box; the restore control stays the journal's own (its size cap and guards with it).
 */
const shell = useShell()
const journal = IS_PLACEHOLDER ? null : useBridgeJournal()
const firstVisit = computed(() => (journal?.records.value.length ?? 0) === 0)
</script>

<template>
	<div class="activity" :data-testid="TESTIDS.activityView">
		<section v-if="IS_PLACEHOLDER" class="placeholder" :data-testid="TESTIDS.activityUnavailable">
			<p class="placeholder-title">Bridging is being upgraded</p>
			<p class="sub">Back with the next generation on this network. The faucet keeps working meanwhile.</p>
		</section>
		<BridgeJournal v-else source="all" title="YOUR BRIDGES" :highlighted-id="shell.highlightedId.value">
			<template v-if="firstVisit" #empty>
				<div class="first" :data-testid="TESTIDS.activityFirstVisit">
					<span class="eb">First time here</span>
					<h2>Move any ERC-20 between Ethereum and Aztec, and arrive with gas to spend.</h2>
					<p class="lede">Public or private. A send you background or lose track of lands on this page, with its next step.</p>
					<div class="tiles">
						<button type="button" class="tile primary" :data-testid="TESTIDS.activityTileSend" @click="shell.goTo('send')">
							<b>Bridge tokens</b><span>Ethereum ↔ Aztec · any ERC-20 · public or private</span><i aria-hidden="true">→</i>
						</button>
						<button type="button" class="tile" :data-testid="TESTIDS.activityTileDrip" @click="shell.goTo('drip')">
							<b>Get test tokens</b><span>NULO · OLUN · fixed drip · no rate limit</span><i aria-hidden="true">→</i>
						</button>
					</div>
				</div>
			</template>
		</BridgeJournal>
	</div>
</template>

<style scoped>
.activity {
	display: flex;
	flex-direction: column;
	gap: 24px;
	width: 100%;
	max-width: 900px;
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

.sub {
	margin: 0;
	color: var(--txt-secondary);
	font-size: 15px;
	line-height: 1.55;
}

.first {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 16px;
	max-width: 560px;
	padding: 24px 0 8px;
}

.eb {
	font: 500 10.5px/1 var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
}

.first h2 {
	margin: 0;
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 28px;
	line-height: 1.08;
	letter-spacing: -0.02em;
}

.lede {
	margin: 0;
	color: var(--txt-secondary);
	font-size: 14px;
	line-height: 1.6;
}

.tiles {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px;
	width: 100%;
	margin-top: 6px;
}

.tile {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 6px 14px;
	align-items: center;
	padding: 18px 20px;
	border: 1px solid var(--nulo-outline);
	background: var(--card-bg);
	color: var(--txt-primary);
	text-align: left;
	cursor: pointer;
}

.tile:hover,
.tile:focus-visible {
	border-color: var(--txt-primary);
}

.tile.primary {
	border-color: var(--txt-primary);
}

.tile b {
	grid-column: 1;
	font: 700 16px/1.1 var(--font-headline);
	letter-spacing: -0.01em;
}

.tile span {
	grid-column: 1;
	font: 500 11.5px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}

.tile i {
	grid-column: 2;
	grid-row: 1 / 3;
	font: 500 16px/1 var(--font-mono);
	font-style: normal;
}
</style>
