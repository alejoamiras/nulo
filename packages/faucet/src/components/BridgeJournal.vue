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
import { BRIDGE_TOKEN_DECIMALS, BRIDGE_TOKEN_SYMBOL } from "@/contracts/bridge-deployments"
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
import { formatBigInt } from "@/lib/format"
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
		const amount = formatBigInt(BigInt(rec.amount), BRIDGE_TOKEN_DECIMALS)
		push({
			kind: "ok",
			text: `Restored: ${amount} ${BRIDGE_TOKEN_SYMBOL} ${rec.direction === "deposit" ? "to Aztec" : "to Ethereum"}.`,
		})
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
		const amount = formatBigInt(BigInt(done.amount), BRIDGE_TOKEN_DECIMALS)
		const href = done.txHash ? (done.direction === "deposit" ? explorerTxUrl(done.txHash) : etherscanTxUrl(done.txHash)) : ""
		push({
			kind: "ok",
			text:
				done.direction === "deposit"
					? `Bridged ${amount} ${BRIDGE_TOKEN_SYMBOL} to Aztec ✓`
					: `Released ${amount} ${BRIDGE_TOKEN_SYMBOL} to Ethereum ✓`,
			link: href ? { label: "view tx", href } : undefined,
		})
	},
)
</script>

<template>
	<section class="journal" :data-testid="TESTIDS.journal">
		<header class="head-row">
			<h3>PENDING BRIDGES</h3>
			<button
				type="button"
				class="restore"
				:disabled="restoring"
				title="Load a bridge from its recovery file (one Ethereum signature)."
				:data-testid="TESTIDS.journalRestore"
				@click="restoreInput?.click()"
			>
				{{ restoring ? "RESTORING…" : "RESTORE ⤒" }}
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
		<div v-if="sorted.length === 0" class="empty-state" :data-testid="TESTIDS.journalEmpty">
			<span class="empty-headline">NOTHING PENDING YET</span>
			<span class="empty-sub">
				Bridges you background or lose track of land here.
				<button
					type="button"
					class="empty-link"
					:data-testid="TESTIDS.journalRestoreLink"
					@click="restoreInput?.click()"
				>Restore</button>
				a saved bridge from its recovery file.
			</span>
		</div>
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

.cards {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.head-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

/* The backup button's sibling: same white-block treatment, inverse on hover. */
.restore {
	padding: 8px 12px;
	background: var(--txt-primary);
	border: 1px solid var(--txt-primary);
	color: var(--nulo-bg, #000);
	font: 700 11px/1 var(--font-mono);
	letter-spacing: 0.06em;
	cursor: pointer;
	white-space: nowrap;
}

.restore:hover {
	background: transparent;
	color: var(--txt-primary);
}

.restore:disabled {
	opacity: 0.6;
	cursor: default;
}

/* The extension's empty-state pattern: dashed box, centered, with an inline link-button
   (a real button for native a11y - focusable, Enter/Space). */
.empty-state {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	padding: 32px 16px;
	border: 1px dashed var(--nulo-outline);
	text-align: center;
}

.empty-headline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--txt-secondary);
}

.empty-sub {
	font: 500 12px/1.6 var(--font-mono);
	color: var(--txt-secondary);
	max-width: 48ch;
}

.empty-link {
	display: inline;
	padding: 0;
	margin: 0;
	border: 0;
	background: transparent;
	font: inherit;
	color: var(--txt-secondary);
	text-decoration: underline;
	text-underline-offset: 2px;
	cursor: pointer;
}

.empty-link:hover {
	color: var(--txt-primary);
}

.hidden-input {
	display: none;
}
</style>
