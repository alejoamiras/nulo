import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	AUTHWITS_CHANGED_MESSAGE,
	ESTIMATE_INCOMPLETE_MESSAGE,
	PREVIEW_FOREIGN_MESSAGE,
	PreviewSnapshots,
	assertWithinPreview,
} from "./preview-snapshots"
import { ESTIMATE_REUSE_TTL_MS } from "./transfer-estimate-reuse"

const A = { interactionId: "i-a", index: 0, fingerprint: "fp" }

describe("PreviewSnapshots", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test("found once, then missing (single-shot)", () => {
		const s = new PreviewSnapshots()
		s.stash("p1", { ...A, discoveredHashes: ["h1"] })
		expect(s.take("p1", A)).toEqual({ kind: "found", snapshot: expect.objectContaining({ discoveredHashes: ["h1"] }) })
		expect(s.take("p1", A)).toEqual({ kind: "missing" })
	})

	test("another interaction, index or fingerprint is foreign — never missing", () => {
		const s = new PreviewSnapshots()
		s.stash("p1", { ...A, discoveredHashes: [] })
		expect(s.take("p1", { ...A, interactionId: "i-b" })).toEqual({ kind: "foreign" })
		s.stash("p2", { ...A, discoveredHashes: [] })
		expect(s.take("p2", { ...A, index: 1 })).toEqual({ kind: "foreign" })
		s.stash("p3", { ...A, discoveredHashes: [] })
		expect(s.take("p3", { ...A, fingerprint: "drifted" })).toEqual({ kind: "foreign" })
	})

	test("a null fingerprint on either side binds on the pair alone", () => {
		const s = new PreviewSnapshots()
		s.stash("p1", { ...A, fingerprint: null, discoveredHashes: [] })
		expect(s.take("p1", A).kind).toBe("found")
		s.stash("p2", { ...A, discoveredHashes: [] })
		expect(s.take("p2", { ...A, fingerprint: null }).kind).toBe("found")
	})

	test("evict and TTL both make it missing; no id is missing", () => {
		const s = new PreviewSnapshots()
		s.stash("p1", { ...A, discoveredHashes: [] })
		s.evict("p1")
		expect(s.take("p1", A)).toEqual({ kind: "missing" })
		s.stash("p2", { ...A, discoveredHashes: [] })
		vi.advanceTimersByTime(ESTIMATE_REUSE_TTL_MS + 5)
		expect(s.take("p2", A)).toEqual({ kind: "missing" })
		expect(s.take(undefined, A)).toEqual({ kind: "missing" })
	})
})

describe("assertWithinPreview", () => {
	const found = (hashes: string[]) => ({ kind: "found" as const, snapshot: { ...A, discoveredHashes: hashes, builtAt: 0 } })

	test("subset passes; an unseen hash aborts with the changed-since-preview message", () => {
		expect(() => assertWithinPreview(found(["h1", "h2"]), ["h1"])).not.toThrow()
		expect(() => assertWithinPreview(found(["h1"]), ["h1", "h3"])).toThrow(AUTHWITS_CHANGED_MESSAGE)
	})

	test("no snapshot: nothing discovered passes, anything discovered asks for a retry", () => {
		expect(() => assertWithinPreview({ kind: "missing" }, [])).not.toThrow()
		expect(() => assertWithinPreview({ kind: "missing" }, ["h1"])).toThrow(ESTIMATE_INCOMPLETE_MESSAGE)
	})

	test("a foreign snapshot aborts even with nothing discovered", () => {
		expect(() => assertWithinPreview({ kind: "foreign" }, [])).toThrow(PREVIEW_FOREIGN_MESSAGE)
	})
})
