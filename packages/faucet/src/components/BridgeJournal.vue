<script setup lang="ts">
/** Components */
import BridgeJournalCard from "./BridgeJournalCard.vue"

/** Composables */
import { useBridgeBackup } from "@/composables/useBridgeBackup"
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useToast } from "@/composables/useToast"

/** Utils */
import type { BridgeJournalRecord } from "@nulo/bridge-core"
import { computed, ref, watch } from "vue"
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
import { TESTIDS } from "@/lib/testids"

const journal = useBridgeJournal()
const backup = useBridgeBackup()
const { push } = useToast()

const restoreInput = ref<HTMLInputElement | null>(null)
const restoring = ref(false)

const onBackup = backup.exportBridgeWithToast

async function onRestorePick(event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ""
	if (!file || restoring.value) return
	restoring.value = true
	try {
		const rec = await backup.restoreFile(await file.text())
		const amount = (Number(rec.amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })
		push({ kind: "ok", text: `Restored: ${amount} USDC ${rec.direction === "deposit" ? "to Aztec" : "to Ethereum"}.` })
	} catch (e) {
		push({ kind: "error", text: e instanceof Error ? e.message : "Restore failed." })
	} finally {
		restoring.value = false
	}
}

const sorted = computed(() => [...journal.visibleRecords.value].sort((a, b) => b.createdAt - a.createdAt))

watch(
	() => journal.lastCompleted.value,
	(done) => {
		if (!done) return
		// The foreground stepper shows the receipt for this completion - a toast would double it.
		if (journal.activeFlowId.value === done.id) return
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
		<header class="head-row">
			<div>
				<h3>PENDING BRIDGES</h3>
				<p class="sub">Bridges this browser started but isn't actively driving. Resume, finish, or discard them.</p>
			</div>
			<button
				type="button"
				class="restore"
				:disabled="restoring"
				title="Load a bridge from its recovery file (one Ethereum signature)."
				:data-testid="TESTIDS.journalRestore"
				@click="restoreInput?.click()"
			>
				{{ restoring ? "RESTORING…" : "RESTORE" }}
			</button>
			<input
				ref="restoreInput"
				type="file"
				accept="application/json,.json"
				class="hidden-input"
				:data-testid="TESTIDS.journalRestoreInput"
				@change="onRestorePick"
			/>
		</header>
		<p v-if="sorted.length === 0" class="empty" :data-testid="TESTIDS.journalEmpty">
			Nothing pending. Lost a bridge to a wiped browser? RESTORE loads its recovery file.
		</p>
		<div v-else class="cards">
			<BridgeJournalCard v-for="rec in sorted" :key="rec.id" :record="rec" @backup="onBackup" />
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

.journal .sub {
	margin: 4px 0 0;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
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

.head-row {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
}

.restore {
	padding: 6px 12px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-secondary);
	font: 600 11px/1 var(--font-mono);
	letter-spacing: 0.06em;
	cursor: pointer;
}

.restore:hover {
	color: var(--txt-primary);
	border-color: var(--txt-primary);
}

.hidden-input {
	display: none;
}
</style>
