<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */

/** Utils */
import { NoteServiceClient } from "@/wallet/services/note/client"
import { stringCompare, trimAddress } from "@/utils/string"

/** Brutalist grayscale palette for the per-contract left-border accent.
 *  Replaces the colored 10-shade palette (`getColorFromAddress`) so the
 *  contract-grouping affordance survives without breaking the brutalist
 *  rule of "no decorative color." Five tonal steps span near-black →
 *  off-white. The contract address is the only chip surface; this band
 *  is purely a "rows from same contract share a stripe" visual hint. */
const NOTE_BORDER_SHADES = [
	"var(--nulo-border)",
	"var(--nulo-outline)",
	"var(--nulo-surface-highest)",
	"var(--nulo-secondary)",
	"var(--txt-primary)",
]
function noteBorderColor(address) {
	if (!address) return NOTE_BORDER_SHADES[0]
	const clean = address.startsWith("0x") ? address.slice(2) : address
	let hash = 0
	for (let i = 0; i < clean.length; i++) {
		hash = (hash + clean.charCodeAt(i)) % 2147483647
	}
	return NOTE_BORDER_SHADES[hash % NOTE_BORDER_SHADES.length]
}

/** Composables */
import { useToast } from "@/composables/toast.js"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
import { useCacheStore } from "@/stores/cache.store"
const appStore = useAppStore()
const popupStore = usePopupStore()
const cacheStore = useCacheStore()

const notes = ref([])
const noteService = new NoteServiceClient()
const isFetchingNotes = ref(false)

const error = ref()
const isErrorOccurred = computed(() => !!error.value)

const searchTerm = ref("")

/**
 * Each `displayNote` is a flat, plain-object snapshot ready for the template.
 * All helper calls (color, address trim, content shape) run inside this script
 * inside try/catch so a single malformed note becomes a fallback card with
 * `renderError` instead of breaking the entire v-for. Template renders only
 * primitives — no helper calls, no chained ?. lookups.
 *
 * Failure modes covered:
 *   - service-side parse error (already handled by NoteService — note.renderError set)
 *   - missing/odd-shaped fields (this script's per-note try/catch)
 *   - unrelated render exception inside the v-for body (fallback card)
 */
const displayNotes = computed(() => {
	const items = []
	for (const note of notes.value ?? []) {
		try {
			items.push(buildDisplayNote(note))
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			console.warn("[notes] failed to build display row:", message, note)
			items.push({
				key: `err-${items.length}`,
				type: "Note (failed to render)",
				contractTrim: "",
				borderColor: "",
				location: "",
				kvEntries: [],
				rawLines: [],
				renderError: message,
				_raw: note,
			})
		}
	}
	return items
})

const filteredDisplayNotes = computed(() => {
	const term = searchTerm.value.trim().toLowerCase()
	if (!term) return displayNotes.value

	return displayNotes.value.filter((d) => {
		const haystack = [
			(d.contractTrim || "").toLowerCase(),
			(d.type || "custom note").toLowerCase(),
			(d.contractName || "").toLowerCase(),
			(d.location || "").toLowerCase(),
		]
		return haystack.some((h) => h.includes(term))
	})
})

const fetchNotes = async (isRefetching) => {
	if (isRefetching) openToast({ label: "Fetching notes again", icon: "zap" })
	isFetchingNotes.value = true
	error.value = undefined

	try {
		const result = await noteService.getNotes(appStore.network.id, appStore.account.address)
		// Stable sort by contract then by location so the same notes land in
		// the same order each refetch.
		result.sort((a, b) => {
			const contractCompare = stringCompare(a.contract ?? "", b.contract ?? "")
			return contractCompare ? contractCompare : stringCompare(a.location ?? "", b.location ?? "")
		})
		notes.value = result
	} catch (err) {
		error.value = err
		notes.value = []
	} finally {
		isFetchingNotes.value = false
	}
}

/** Compute a flat display snapshot from a single Note. Throws on internal
 *  failure; the caller wraps in try/catch and falls back to an error card. */
function buildDisplayNote(note) {
	const contract = String(note.contract ?? "")
	const showingContent = parseNoteContent(note)
	const kvEntries = showingContent ? Object.entries(showingContent).map(([k, v]) => ({ key: k, value: v, isLongHex: isLongHex(v) })) : []

	return {
		key: `${contract || "?"}:${note.storageSlot ?? "?"}:${note.txHash ?? "?"}`,
		type: note.type ?? "Custom Note",
		contractName: note.contractName ?? "",
		contractTrim: trimAddress(contract, 4, 4),
		borderColor: noteBorderColor(contract),
		location: note.location ?? "",
		kvEntries,
		rawLines: Array.isArray(note.rawContent) ? note.rawContent.map((x) => String(x ?? "")) : [],
		renderError: note.renderError,
		_raw: note,
	}
}

function parseNoteContent(note) {
	if (!note?.content) return null

	// Order-preserving allow-list: schema-decoded fields first, side-channel
	// (owner, randomness) last. Anything else falls through to the full content.
	const allowed = ["value", "amount", "token_id", "expiry_block_number", "remaining_txs", "points", "owner", "randomness"]

	const ordered = {}
	for (const key of allowed) {
		if (Object.hasOwn(note.content, key)) ordered[key] = note.content[key]
	}

	return Object.keys(ordered).length > 0 ? ordered : note.content
}

const handleOpenNote = (display) => {
	cacheStore.viewerData = display._raw ?? display
	popupStore.open("data_viewer")
}

/** Long hex values (addresses, hashes, preimages) should wrap with
 *  overflow-wrap: anywhere instead of ellipsis-truncate — users need
 *  to glance-verify the head and tail, not just the head. Numeric
 *  values (amounts, block numbers) stay single-line. */
function isLongHex(value) {
	if (value === null || value === undefined) return false
	const s = String(value)
	return s.startsWith("0x") && s.length > 40
}

watch(
	() => appStore.account,
	() => {
		fetchNotes()
	},
)

onMounted(async () => {
	if (appStore.network && appStore.isLogined) fetchNotes()
})

onBeforeUnmount(() => {
	noteService.disconnect()
})
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper">
		<SubPageHeader title="Notes" :backTo="'/popup/settings/advanced/account-state'" />

		<Flex direction="column" gap="16" :class="$style.content">
			<Input
				v-if="notes.length"
				v-model="searchTerm"
				icon="search"
				placeholder="Search by type, contract, name or location"
				clearable
				@clear="searchTerm = ''"
			/>

			<LoadingState v-if="isFetchingNotes" label="FETCHING NOTES" />

			<Tooltip v-else-if="isErrorOccurred" wide>
				<Banner :action="{ name: 'Try again', callback: () => fetchNotes(true) }" variant="error" wide>
					Something went wrong
				</Banner>

				<template #content>
					{{ error }}
				</template>
			</Tooltip>

			<Flex v-else-if="filteredDisplayNotes.length" direction="column" gap="8">
				<div
					v-for="display in filteredDisplayNotes"
					:key="display.key"
					@click="handleOpenNote(display)"
					:class="[$style.card, display.renderError && $style.card_error]"
					:style="{ borderLeftColor: display.borderColor }"
				>
					<div :class="$style.header">
						<span :class="$style.type">
							{{ display.type }}<span v-if="display.contractName" :class="$style.contract_name"> · {{ display.contractName }}</span>
						</span>
						<span v-if="display.contractTrim" :class="$style.contract">{{ display.contractTrim }}</span>
					</div>

					<span v-if="display.location" :class="$style.location">{{ display.location }}</span>

					<div v-if="display.kvEntries.length" :class="$style.kv_grid">
						<template v-for="entry in display.kvEntries" :key="entry.key">
							<span :class="$style.kv_key">{{ entry.key }}</span>
							<span :class="[$style.kv_val, entry.isLongHex && $style.kv_val_wrap]">{{ entry.value }}</span>
						</template>
					</div>

					<div v-else-if="display.rawLines.length" :class="$style.raw">
						<span v-for="(el, i) in display.rawLines" :key="i" :class="$style.raw_line">{{ el }}</span>
					</div>

					<div v-if="display.renderError" :class="$style.render_error">
						<span :class="$style.render_error_label">RENDER ERROR</span>
						<span :class="$style.render_error_msg">{{ display.renderError }}</span>
					</div>
				</div>
			</Flex>

			<div v-else-if="filteredDisplayNotes.length === 0 && searchTerm" :class="$style.no_results">
				NO MATCHES · TRY A DIFFERENT TERM
			</div>

			<div v-else :class="$style.empty">
				<span :class="$style.empty_headline">NO NOTES YET</span>
				<span :class="$style.empty_sub">Notes from your account contracts will appear here.</span>
			</div>
		</Flex>

	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	background: var(--app-bg);
	scrollbar-gutter: stable;
}

.content {
	padding: 16px 24px var(--nav-clearance) 24px;
}

.card {
	display: flex;
	flex-direction: column;
	gap: 10px;

	cursor: pointer;

	/* Structural border on 3 sides; the left edge is a 4px colored
	   accent per-contract (getColorFromAddress inline style) so notes
	   from the same contract share a visual band. Keeps the chip
	   itself neutral — avoids collision with semantic red/orange. */
	border: 1px solid var(--nulo-border);
	border-left: 4px solid var(--nulo-border);

	padding: 12px 12px 12px 10px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);
		border-color: var(--nulo-outline);
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

.card_error {
	border-left-color: var(--red) !important;
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.type {
	flex: 1;
	min-width: 0;

	font-family: var(--font-headline);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--txt-primary);

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.contract {
	flex-shrink: 0;

	padding: 3px 6px;

	background: var(--nulo-surface-low);
	border: 1px solid var(--nulo-border);

	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.02em;
	color: var(--nulo-secondary);
}

/** Inline contract-name annotation appended to the note-type label
 *  with a middle-dot separator. Lighter weight than the type itself
 *  so the type stays the primary glyph; brutalist-friendly. */
.contract_name {
	font-weight: 500;
	color: var(--nulo-secondary);
}

.location {
	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--nulo-outline);
	line-height: 1.4;
	word-break: break-all;
}

.kv_grid {
	display: grid;
	grid-template-columns: minmax(90px, 120px) 1fr;
	gap: 4px 12px;
	align-items: baseline;
}

.kv_key {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.kv_val {
	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--txt-primary);

	min-width: 0;

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/** Long hex values get a 2-line wrap so users can glance-verify head + tail. */
.kv_val_wrap {
	white-space: normal;
	overflow-wrap: anywhere;
	line-height: 1.4;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	line-clamp: 2;
}

.raw {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.raw_line {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
	overflow-wrap: anywhere;
	line-height: 1.4;

	&:not(:first-child) {
		padding-top: 4px;
		border-top: 1px solid var(--nulo-border);
	}
}

.render_error {
	display: flex;
	flex-direction: column;
	gap: 4px;

	padding-top: 6px;
	border-top: 1px solid var(--nulo-border);
}

.render_error_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.06em;
	color: var(--red);
}

.render_error_msg {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
	overflow-wrap: anywhere;
	line-height: 1.4;
}

.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;

	padding: 32px 16px;
	border: 1px dashed var(--nulo-border);

	text-align: center;
}

.empty_headline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.empty_sub {
	width: 100%;

	font-family: var(--font-mono);
	font-size: 11px;
	line-height: 1.4;
	color: var(--nulo-outline);
	overflow-wrap: break-word;
}

.no_results {
	padding: 24px 16px;
	text-align: center;

	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: var(--nulo-outline);
}
</style>
