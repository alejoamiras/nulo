<script setup lang="ts">
/** Components */
import BridgeJournalCard from "./BridgeJournalCard.vue"

/** Composables */
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useToast } from "@/composables/useToast"

/** Utils */
import { computed, watch } from "vue"
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
import { TESTIDS } from "@/lib/testids"

const journal = useBridgeJournal()
const { push } = useToast()

const sorted = computed(() => [...journal.visibleRecords.value].sort((a, b) => b.createdAt - a.createdAt))

watch(
	() => journal.lastCompleted.value,
	(done) => {
		if (!done) return
		const amount = (Number(done.amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })
		const href = done.txHash ? (done.direction === "deposit" ? explorerTxUrl(done.txHash) : etherscanTxUrl(done.txHash)) : ""
		push({
			kind: "ok",
			text: done.direction === "deposit" ? `Bridged ${amount} USDC to Aztec ✓` : `Released ${amount} USDC to Ethereum ✓`,
			link: href ? { label: "view tx", href } : undefined,
		})
	},
)
</script>

<template>
	<section class="journal" :data-testid="TESTIDS.journal">
		<header>
			<h3>IN-FLIGHT BRIDGES</h3>
		</header>
		<p v-if="sorted.length === 0" class="empty" :data-testid="TESTIDS.journalEmpty">No bridges in flight.</p>
		<div v-else class="cards">
			<BridgeJournalCard v-for="rec in sorted" :key="rec.id" :record="rec" />
		</div>
	</section>
</template>

<style scoped>
.journal {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.journal h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 16px;
	color: var(--txt-primary);
	margin: 0;
}

.empty {
	margin: 0;
	color: var(--txt-secondary);
	font: 500 13px/1.5 var(--font-mono);
}

.cards {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
</style>
