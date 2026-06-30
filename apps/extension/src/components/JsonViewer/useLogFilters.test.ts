import { describe, expect, test } from "vitest"
import { effectScope } from "vue"
import { LogLevel } from "@/wallet/logger"
import { LOG_LEVELS, LOG_SOURCES, useLogFilters } from "./useLogFilters"

const baseLog = (overrides: Partial<{ source: string; level: number }> = {}) => ({
	id: 1,
	timestamp: Date.now(),
	source: "transaction",
	level: LogLevel.Info,
	data: ["x"],
	...overrides,
})

describe("JsonViewer/useLogFilters", () => {
	test("starts with every source + level enabled", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			expect(f.allowedSources.value.size).toBe(LOG_SOURCES.length)
			expect(f.allowedLevels.value.size).toBe(LOG_LEVELS.length)
			expect(f.allOptionsSelected.value).toEqual({ source: true, level: true })
		})
		scope.stop()
	})

	test("includes a log when both source and level are allowed", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			expect(f.isLogInclude(baseLog())).toBe(true)
		})
		scope.stop()
	})

	test("excludes a log when its source is filtered out", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			f.updateFilter("source", "transaction")
			expect(f.isLogInclude(baseLog())).toBe(false)
		})
		scope.stop()
	})

	test("excludes a log when its level is filtered out", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			f.updateFilter("level", "INFO")
			expect(f.isLogInclude(baseLog())).toBe(false)
		})
		scope.stop()
	})

	test("updateFilter toggles in both directions", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			f.updateFilter("source", "transaction")
			expect(f.allowedSources.value.has("transaction")).toBe(false)
			f.updateFilter("source", "transaction")
			expect(f.allowedSources.value.has("transaction")).toBe(true)
		})
		scope.stop()
	})

	test("selectAll inverts current state when everything was selected", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			f.selectAll("level")
			expect(f.allowedLevels.value.size).toBe(0)
			expect(f.allOptionsSelected.value.level).toBe(false)
		})
		scope.stop()
	})

	test("selectAll restores all-on when called from a partial state", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			f.updateFilter("level", "INFO")
			f.selectAll("level")
			expect(f.allowedLevels.value.size).toBe(LOG_LEVELS.length)
		})
		scope.stop()
	})

	test("openPopover + closePopover toggles the popovers map", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			f.openPopover("source")
			expect(f.popovers.source).toBe(true)
			f.closePopover("source")
			expect(f.popovers.source).toBe(false)
		})
		scope.stop()
	})

	test("closing the source popover clears the search term", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			f.searchTerm.value = "wallet"
			f.closePopover("source")
			expect(f.searchTerm.value).toBe("")
		})
		scope.stop()
	})

	test("closing the level popover does NOT clear the search term", () => {
		const scope = effectScope()
		scope.run(() => {
			const f = useLogFilters()
			f.searchTerm.value = "anything"
			f.closePopover("level")
			expect(f.searchTerm.value).toBe("anything")
		})
		scope.stop()
	})
})
