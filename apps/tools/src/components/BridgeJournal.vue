<script setup lang="ts">
/** Components */
import BridgeJournalCard from "./BridgeJournalCard.vue"

/** Composables */
import { useBridgeBackup } from "@/composables/useBridgeBackup"
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useToast } from "@/composables/useToast"

/** Utils */
import { type BridgeJournalRecord, assetKindOf } from "@nulo/bridge-core"
import { computed, ref, watch } from "vue"
import { assetDecimals, assetSymbol } from "@/lib/asset-label"
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
import { formatBigInt } from "@/lib/format"
import { TESTIDS } from "@/lib/testids"

// `kind` scopes the list to one asset (the Fuel tab shows fee-juice, the Bridge tab shows the token) so a
// backgrounded Fuel bridge surfaces under its own tab. `toasts` keeps a SINGLE completion-toast owner across
// the two mounts (the Bridge instance owns it; the Fuel instance is list-only) — no double toast.
const props = withDefaults(defineProps<{ kind?: "bridge-token" | "fee-juice"; toasts?: boolean; title?: string }>(), {
	toasts: true,
	title: "YOUR BRIDGES",
})

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
		const kind = assetKindOf(rec)
		const amount = formatBigInt(BigInt(rec.amount), assetDecimals(kind))
		push({
			kind: "ok",
			text: `Restored: ${amount} ${assetSymbol(kind, rec.isPrivate)} ${rec.direction === "deposit" ? "to Aztec" : "to Ethereum"}.`,
		})
	} catch (e) {
		push({ kind: "error", text: e instanceof Error ? e.message : "Restore failed." })
	} finally {
		restoring.value = false
	}
}

const sorted = computed(() => {
	const recs = props.kind ? journal.visibleRecords.value.filter((r) => assetKindOf(r) === props.kind) : journal.visibleRecords.value
	return [...recs].sort((a, b) => b.createdAt - a.createdAt)
})

watch(
	() => journal.lastCompleted.value,
	(done) => {
		if (!props.toasts) return // List-only mount (the Fuel tab) — the Bridge mount owns the single toast.
		if (!done) return
		// The foreground stepper shows the receipt for this completion - a toast would double it.
		// Keyed off the SYNCHRONOUS capture, not the live activeFlowId: the form's completion watcher
		// releases the takeover before this one runs, so the live check would always pass here.
		if (done.foreground) return
		// A fee-juice (Fuel) completion is 18-dec Fee Juice, not the token bridge's asset - format + label it
		// as such so a background Fuel completion isn't announced as the wrong amount of AZLO (codex MEDIUM).
		const sym = assetSymbol(done.assetKind, done.isPrivate)
		const amount = formatBigInt(BigInt(done.amount), assetDecimals(done.assetKind))
		const href = done.txHash ? (done.direction === "deposit" ? explorerTxUrl(done.txHash) : etherscanTxUrl(done.txHash)) : ""
		push({
			kind: "ok",
			text:
				done.direction === "deposit"
					? done.assetKind === "fee-juice"
						? `Fueled Aztec with ${amount} ${sym} ✓`
						: `Bridged ${amount} ${sym} to Aztec ✓`
					: `Released ${amount} ${sym} to Ethereum ✓`,
			link: href ? { label: "view tx", href } : undefined,
		})
	},
)
</script>

<template>
	<Flex tag="section" direction="column" gap="14" class="journal" :data-testid="TESTIDS.journal">
		<Flex tag="header" align="center" justify="between" gap="12">
			<h3>{{ props.title }}</h3>
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
		</Flex>
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
		<Flex v-else direction="column" gap="10">
			<BridgeJournalCard v-for="rec in sorted" :key="rec.id" :record="rec" @backup="onBackup" />
		</Flex>
	</Flex>
</template>

<style scoped>
.journal h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 16px;
	color: var(--txt-primary);
	margin: 0;
}

/* The backup button's sibling: same white-block treatment, inverse on hover. */
.restore {
	padding: 8px 12px;
	background: var(--txt-primary);
	border: 1px solid var(--txt-primary);
	color: var(--txt-inverse);
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
