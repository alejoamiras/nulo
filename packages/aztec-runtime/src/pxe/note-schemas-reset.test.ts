/**
 * Pins the note-schema memo + the CASCADING catalog reset: the test hook must
 * clear both the schema memo and the whole artifact-catalog store, or class
 * ids re-resolve against stale entries after a reset (the pre-refactor hook
 * did both; the shared-memo migration must keep doing both). Catalog mocked —
 * real entries hash artifacts through bb WASM, which vitest excludes.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("./artifact-catalog", () => ({
	getCatalogEntry: vi.fn(async (key: string) => ({ artifact: {}, classId: `0xclass:${key}` })),
	_resetArtifactCatalogForTests: vi.fn(),
}))

import { _resetArtifactCatalogForTests, getCatalogEntry } from "./artifact-catalog"
import { _resetNoteSchemasForTests, loadProductionNoteSchemas } from "./note-schemas"

describe("note-schema memo + cascading catalog reset", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		_resetNoteSchemasForTests()
		vi.clearAllMocks() // discard the reset's own catalog-reset call
	})

	test("schemas load once across repeated calls (memoized)", async () => {
		const first = await loadProductionNoteSchemas()
		const second = await loadProductionNoteSchemas()
		expect(second).toBe(first)
		expect(getCatalogEntry).toHaveBeenCalledTimes(4) // the four note-bearing keys, once
	})

	test("the test reset clears the schema memo AND cascades to the catalog reset", async () => {
		await loadProductionNoteSchemas()
		_resetNoteSchemasForTests()
		expect(_resetArtifactCatalogForTests).toHaveBeenCalledTimes(1)
		await loadProductionNoteSchemas()
		expect(getCatalogEntry).toHaveBeenCalledTimes(8) // reloaded after reset
	})
})
