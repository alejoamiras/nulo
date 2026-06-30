import { computed, reactive, ref } from "vue"
import { type LogEntry, getLogLevelName } from "./logs-format"

export const LOG_SOURCES: string[] = [
	"account",
	"account-state",
	"auth-registry",
	"config",
	"contact",
	"dapp-interaction",
	"dapp-session",
	"execution",
	"faucet",
	"fpc",
	"log-viewer",
	"logger",
	"network",
	"note",
	"profile",
	"pxe",
	"rpc",
	"task",
	"token",
	"token-balance",
	"transaction",
	"wallet-sdk",
	"passkey",
]
	.flatMap((x) => [x, `${x}-client`])
	.concat(["wallet", "ui"])

export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"]

export interface UseLogFiltersResult {
	filters: { source: Record<string, boolean>; level: Record<string, boolean> }
	popovers: { source: boolean; level: boolean }
	searchTerm: { value: string }
	allowedSources: { value: Set<string> }
	allowedLevels: { value: Set<string> }
	allOptionsSelected: { value: { source: boolean; level: boolean } }
	isLogInclude: (log: LogEntry) => boolean
	updateFilter: (kind: "source" | "level", value: string) => void
	selectAll: (kind: "source" | "level") => void
	openPopover: (name: "source" | "level") => void
	closePopover: (name: "source" | "level") => void
}

export function useLogFilters() {
	const popovers = reactive({ source: false, level: false })
	const filters = reactive({
		source: Object.fromEntries(LOG_SOURCES.map((s) => [s, true])),
		level: Object.fromEntries(LOG_LEVELS.map((l) => [l, true])),
	})
	const searchTerm = ref("")

	const allowedSources = computed(() => new Set(Object.keys(filters.source).filter((k) => filters.source[k])))
	const allowedLevels = computed(() => new Set(Object.keys(filters.level).filter((k) => filters.level[k])))
	const allOptionsSelected = computed(() => ({
		source: allowedSources.value.size === LOG_SOURCES.length,
		level: allowedLevels.value.size === LOG_LEVELS.length,
	}))

	const isLogInclude = (log: LogEntry): boolean => {
		const sourceOk = allowedSources.value.has(log.source)
		const levelOk = allowedLevels.value.has(getLogLevelName(log.level))
		return sourceOk && levelOk
	}

	const updateFilter = (kind: "source" | "level", value: string) => {
		filters[kind][value] = !filters[kind][value]
	}

	const selectAll = (kind: "source" | "level") => {
		const value = allOptionsSelected.value[kind]
		for (const f of Object.keys(filters[kind])) {
			filters[kind][f] = !value
		}
	}

	const openPopover = (name: "source" | "level") => {
		popovers[name] = true
	}
	const closePopover = (name: "source" | "level") => {
		popovers[name] = false
		if (name === "source") searchTerm.value = ""
	}

	return {
		filters,
		popovers,
		searchTerm,
		allowedSources,
		allowedLevels,
		allOptionsSelected,
		isLogInclude,
		updateFilter,
		selectAll,
		openPopover,
		closePopover,
	}
}
