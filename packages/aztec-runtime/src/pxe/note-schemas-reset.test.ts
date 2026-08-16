/**
 * Pins the note-schema memo + the CASCADING catalog reset end to end: the test
 * hook must clear both the schema memo AND the real artifact-catalog store, or
 * class ids re-resolve against stale entries after a reset. Only the class-id
 * hasher is mocked (the real one Poseidon-hashes through bb WASM, excluded in
 * vitest) — the catalog module, its Map, and both reset hooks are REAL, so a
 * no-op'd catalog reset reds the recompute assertion below.
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

import { getCatalogEntry } from "./artifact-catalog"
import { _resetNoteSchemasForTests, loadProductionNoteSchemas } from "./note-schemas"

describe("note-schema memo + cascading catalog reset (real catalog, mocked hasher)", () => {
	beforeEach(() => {
		_resetNoteSchemasForTests()
		hashState.count = 0
	})

	test("schemas load once; repeat calls and direct catalog hits reuse the real cached entries", async () => {
		const first = await loadProductionNoteSchemas()
		expect(hashState.count).toBe(4) // the four note-bearing keys, hashed once each
		const second = await loadProductionNoteSchemas()
		expect(second).toBe(first)
		await getCatalogEntry("token") // same REAL map the schema load populated
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
