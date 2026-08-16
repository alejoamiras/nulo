/**
 * Pins the note-schema memo + the CASCADING catalog reset end to end against
 * the REAL aztec-runtime modules (this tree resolves the vite-only artifact
 * aliases; the aztec-runtime package's own vitest run cannot load the catalog
 * at all). Only the class-id hasher is mocked — real bb.js faults under
 * repeated unit-test calls (see note-schemas.test.ts). If
 * `_resetArtifactCatalogForTests` ever stops clearing the real catalog store,
 * the recompute count below stays at 4 and this file reds.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const hashState = vi.hoisted(() => ({ count: 0 }))
vi.mock("@aztec/stdlib/contract", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		getContractClassFromArtifact: async () => {
			hashState.count += 1
			return { id: { toString: () => `0xmockclass:${hashState.count}` } }
		},
	}
})

import { _resetNoteSchemasForTests, loadProductionNoteSchemas } from "@nulo/aztec-runtime/pxe"

describe("note-schema memo + cascading catalog reset (real modules, mocked hasher)", () => {
	beforeEach(() => {
		_resetNoteSchemasForTests()
		hashState.count = 0
	})

	test("schemas load once: the four note-bearing keys hash exactly once across repeat loads", async () => {
		const first = await loadProductionNoteSchemas()
		expect(hashState.count).toBe(4)
		const second = await loadProductionNoteSchemas()
		expect(second).toBe(first)
		expect(hashState.count).toBe(4)
	})

	test("the test reset clears the schema memo AND the real catalog store (keys recompute)", async () => {
		await loadProductionNoteSchemas()
		expect(hashState.count).toBe(4)
		_resetNoteSchemasForTests()
		await loadProductionNoteSchemas()
		// 8 proves the catalog map was genuinely cleared through the cascade —
		// a no-op'd _resetArtifactCatalogForTests would leave this at 4.
		expect(hashState.count).toBe(8)
	})
})
