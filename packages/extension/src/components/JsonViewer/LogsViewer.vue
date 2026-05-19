<script setup>
/** Vendor */
import { onMounted, ref } from "vue"
import { EditorView } from "codemirror"
import { EditorState } from "@codemirror/state"
import { keymap, highlightActiveLine } from "@codemirror/view"
import { defaultKeymap } from "@codemirror/commands"
import { searchKeymap } from "@codemirror/search"

/** Components */
import LogsToolbar from "./LogsToolbar.vue"

/** Utils */
import { Config } from "@/wallet/config"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
import { downloadFile } from "@/utils"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Logs helpers */
import { formatLogs, formatSingleLog } from "./logs-format"
import { buildLogsCsv } from "./logs-csv"
import { logDecorationsField } from "./logs-decoration"
import { useLogFilters } from "./useLogFilters"
import { createLoggerTheme } from "./creator.js"

const editorRef = ref(null)
let view = null

const logViewerService = new LogViewerServiceClient()
logViewerService.onLog.add(onLogAdded)

const configService = new ConfigServiceClient()
configService.onUpdate.add(onSettingUpdate)

const logs = ref([])
const filters = useLogFilters()
const filteredLogs = computed(() => logs.value.filter((log) => filters.isLogInclude(log)))

const AUTO_SCROLL_TIMEOUT_MS = 30_000
const SCROLL_DISABLE_THRESHOLD = 20
const MAX_LOGS_DIFF = 100
const maxLogsCount = ref(new Config().debugMode ? 10_000 : 1_000)

const shouldAutoScroll = ref(true)
const showScrollBtn = ref(false)
let scrollTimeout = null

function onLogAdded(log) {
	logs.value.push(log)

	if (logs.value.length > maxLogsCount.value + MAX_LOGS_DIFF) {
		logs.value.splice(0, MAX_LOGS_DIFF)
	}

	if (!filters.isLogInclude(log)) return
	if (!view) return

	const doc = view.state.doc
	if (filteredLogs.value.length > maxLogsCount.value + MAX_LOGS_DIFF) {
		view.dispatch({
			changes: { from: doc.line(1).from, to: doc.line(MAX_LOGS_DIFF).to + 1, insert: "" },
		})
	}

	view.dispatch({
		changes: { from: doc.length, insert: `${formatSingleLog(log)}\n` },
	})

	if (shouldAutoScroll.value) scrollToBottom()
	else showScrollBtn.value = true
}

function enableAutoScroll() {
	clearTimeout(scrollTimeout)
	shouldAutoScroll.value = true
}
function disableAutoScroll() {
	clearTimeout(scrollTimeout)
	shouldAutoScroll.value = false
	scrollTimeout = setTimeout(() => {
		shouldAutoScroll.value = true
	}, AUTO_SCROLL_TIMEOUT_MS)
}
function updateShouldAutoScroll() {
	const el = view?.scrollDOM
	if (!el) return
	const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_DISABLE_THRESHOLD
	if (isAtBottom) {
		showScrollBtn.value = false
		enableAutoScroll()
	} else {
		showScrollBtn.value = true
		disableAutoScroll()
	}
}
function scrollToBottom() {
	if (!view) return
	const lastLine = view.state.doc.line(view.state.doc.lines)
	view.dispatch({ effects: EditorView.scrollIntoView(lastLine.from, { y: "end" }) })
	showScrollBtn.value = false
}

function updateEditorContent() {
	if (!view) return
	const newDoc = `${formatLogs(filteredLogs.value)}\n`
	const currentDoc = view.state.doc.toString()
	if (currentDoc === newDoc) return

	view.dispatch({
		changes: { from: 0, to: currentDoc.length, insert: newDoc },
	})
	requestAnimationFrame(() => {
		if (shouldAutoScroll.value) scrollToBottom()
	})
}

function scrollToTargetLog(targetLogId) {
	if (!view) return
	const idx = logs.value.findIndex((l) => l.id === targetLogId)
	if (idx === -1) return
	const pos = formatLogs(logs.value.slice(0, idx)).length + 1
	view.dispatch({
		effects: EditorView.scrollIntoView(pos, { y: "center" }),
		selection: { anchor: pos },
	})
}

const handleToggleFilter = (kind, value) => {
	filters.updateFilter(kind, value)
	updateEditorContent()
}
const handleSelectAll = (kind) => {
	filters.selectAll(kind)
	updateEditorContent()
}

async function exportLogsToCSV() {
	try {
		const csv = buildLogsCsv(logs.value)
		await downloadFile({
			data: csv,
			filename: `NuloWalletLogs_${Math.floor(Date.now() / 1000)}.csv`,
		})
		openToast({ label: "Logs downloaded successfully", icon: "download" })
	} catch (err) {
		console.error(err)
		openToast({ label: "Failed to download logs", icon: "warning" }, TOAST_DURATION.LONG)
	}
}

async function handleClearLogs() {
	try {
		logViewerService.onLog.remove(onLogAdded)
		await logViewerService.clearLogs()
		logViewerService.onLog.add(onLogAdded)
		logs.value = []
		await nextTick()
		updateEditorContent()
	} catch (err) {
		openToast({ label: "Failed to clear logs", icon: "warning" }, TOAST_DURATION.LONG)
		console.error(err)
	}
}

async function getLogs() {
	const res = []
	while (true) {
		const batch = await fetchLogs(1024, res.at(-1)?.id)
		res.push(...batch)
		if (
			batch.length !== 1024 &&
			batch.length !== 256 &&
			batch.length !== 64 &&
			batch.length !== 16 &&
			batch.length !== 4 &&
			batch.length !== 1
		) {
			break
		}
	}
	return res
}

async function fetchLogs(cnt, fromId) {
	try {
		const fetch = logViewerService.getLogs(cnt, fromId)
		const timeout = new Promise((_, reject) => {
			setTimeout(() => reject("Logs fetch timeout"), 500)
		})
		await Promise.race([fetch, timeout])
		return await fetch
	} catch {
		if (cnt === 1) throw new Error("Failed to fetch logs")
		return await fetchLogs(cnt / 4, fromId)
	}
}

async function onSettingUpdate(setting) {
	if (setting.key === "debugMode") {
		maxLogsCount.value = setting.value ? 10_000 : 1_000
		logs.value = await getLogs()
		updateEditorContent()
	}
}

onMounted(async () => {
	await nextTick()

	maxLogsCount.value = (await configService.getValue("debugMode")) ? 10_000 : 1_000
	logs.value = await getLogs()

	view = new EditorView({
		parent: editorRef.value,
		state: EditorState.create({
			doc: formatLogs(logs.value),
			extensions: [
				keymap.of([...defaultKeymap, ...searchKeymap]),
				...createLoggerTheme(),
				highlightActiveLine(),
				EditorState.readOnly.of(true),
				logDecorationsField,
			],
		}),
	})

	view.scrollDOM?.addEventListener("scroll", updateShouldAutoScroll)

	document.addEventListener("selectionchange", () => {
		const selection = document.getSelection()
		if (selection && !selection.isCollapsed) disableAutoScroll()
	})

	document.addEventListener("focusin", (e) => {
		if (e.target?.closest(".cm-panel.cm-search")) disableAutoScroll()
	})

	const params = new URLSearchParams(window.location.search)
	const targetLogId = params.get("logId")
	if (targetLogId) {
		scrollToTargetLog(+targetLogId)
		disableAutoScroll()
	} else {
		requestAnimationFrame(() => scrollToBottom())
	}
})

onBeforeUnmount(() => {
	logViewerService.disconnect()
	configService.disconnect()
	clearTimeout(scrollTimeout)
	view?.scrollDOM?.removeEventListener("scroll", updateShouldAutoScroll)
})
</script>

<template>
	<div :class="$style.wrapper">
		<LogsToolbar
			:popovers="filters.popovers"
			:filters="filters.filters"
			:searchTerm="filters.searchTerm.value"
			:allOptionsSelected="filters.allOptionsSelected.value"
			@openPopover="filters.openPopover"
			@closePopover="filters.closePopover"
			@toggleFilter="handleToggleFilter"
			@selectAll="handleSelectAll"
			@update:searchTerm="filters.searchTerm.value = $event"
			@exportCsv="exportLogsToCSV"
			@clearLogs="handleClearLogs"
		/>

		<Flex v-if="showScrollBtn" @click="scrollToBottom" align="center" :class="$style.scroll_btn">
			<Icon name="arrow-right" size="24" rotate="90" color="tertiary" />
		</Flex>

		<div ref="editorRef" :class="$style.logs_viewer" />
	</div>
</template>

<style module>
.wrapper {
	width: 100vw;
	height: 100vh;
	display: flex;
	flex-direction: column;
}

.logs_viewer {
	display: flex;
	flex: 1 1 auto;
	overflow: hidden;
}

.scroll_btn {
	position: absolute;
	right: 18px;
	bottom: 18px;
	z-index: 1;

	padding: 4px 4px;
	background-color: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
	border-radius: 50%;
	box-shadow: 0 1px 2px rgba(10, 9, 8, 0.3);

	cursor: pointer;

	&:hover {
		background: var(--dropdown-bg);
		border-color: var(--nulo-outline);
		* {
			fill: var(--txt-secondary);
		}
	}

	&:active {
		transform: scale(0.9);
	}
}
</style>
