<script setup lang="ts">
/** Components */
import BridgeJournalCard from "./BridgeJournalCard.vue"

/** Composables */
import { useBridgeBackup } from "@/composables/useBridgeBackup"
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useToast } from "@/composables/useToast"

/** Utils */
import { type BridgeJournalRecord, assetKindOf } from "@nulo/bridge-core"
import { computed, ref } from "vue"
import { assetDecimals, assetSymbol } from "@/lib/asset-label"
import { formatBigInt } from "@/lib/format"
import { TESTIDS } from "@/lib/testids"

// `source` picks the record set: `visible` omits the record the wizard is foregrounding (its stepper
// is that record's one surface); `all` is for the Activity page, where no stepper is on screen.
// `kind` scopes the list to one asset kind. Completion toasts are the shell's (`useCompletionToasts`).
const props = withDefaults(
	defineProps<{ kind?: "bridge-token" | "fee-juice"; title?: string; source?: "visible" | "all"; highlightedId?: string | null }>(),
	{ title: "YOUR BRIDGES", source: "visible", highlightedId: null },
)

const journal = useBridgeJournal()
const backup = useBridgeBackup()
const { push } = useToast()

const restoreInput = ref<HTMLInputElement | null>(null)
const restoring = ref(false)

/** A recovery file is a few KB of JSON. The check is on `size` and comes BEFORE `file.text()`,
 *  because reading is what costs: a multi-gigabyte pick would be decoded whole into memory just to
 *  be rejected by the validator afterwards. */
const MAX_RESTORE_BYTES = 1024 * 1024
const RESTORE_TOO_LARGE = "That file is too large to be a recovery file (the limit is 1 MB)."

const onBackup = backup.exportBridgeWithToast

async function onRestorePick(event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ""
	if (!file || restoring.value) return
	if (file.size > MAX_RESTORE_BYTES) {
		push({ kind: "error", text: RESTORE_TOO_LARGE })
		return
	}
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
	const all = props.source === "all" ? journal.records.value : journal.visibleRecords.value
	const recs = props.kind ? all.filter((r) => assetKindOf(r) === props.kind) : all
	return [...recs].sort((a, b) => b.createdAt - a.createdAt)
})
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
			<slot name="empty">
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
			</slot>
		</div>
		<Flex v-else direction="column" gap="10">
			<BridgeJournalCard
				v-for="rec in sorted"
				:key="rec.id"
				:record="rec"
				:class="{ highlighted: rec.id === props.highlightedId }"
				:data-highlighted="rec.id === props.highlightedId || undefined"
				@backup="onBackup"
			/>
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

/* The record the shell opened Activity for: an ink rule, no fill, no accent. */
.highlighted {
	box-shadow: -14px 0 0 -12px var(--txt-primary);
}
</style>
