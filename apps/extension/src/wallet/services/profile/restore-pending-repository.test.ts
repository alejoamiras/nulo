import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import type { StorageArea } from "@nulo/wallet-core/ports"
import { RESTORE_PENDING_ROOT, RestorePendingRepository } from "./restore-pending-repository"

function makeRepo(): { repo: RestorePendingRepository; storage: StorageArea } {
	const api = new FakeBrowserApi()
	api.reset()
	const storage = api.storage.local as StorageArea
	return { repo: new RestorePendingRepository(storage), storage }
}

const MARKER = { profileId: "p1", pxeGeneration: "gen-1", at: 123 }

describe("RestorePendingRepository", () => {
	test("absent by default; write → valid; delete → absent", async () => {
		const { repo } = makeRepo()
		expect(await repo.get("p1")).toEqual({ kind: "absent" })
		await repo.write(MARKER)
		expect(await repo.get("p1")).toEqual({ kind: "valid", marker: MARKER })
		await repo.delete("p1")
		expect(await repo.get("p1")).toEqual({ kind: "absent" })
	})

	test("an existing-but-undecodable row reports corrupt — NEVER absent, never removed", async () => {
		const { repo, storage } = makeRepo()
		await storage.set({ [`${RESTORE_PENDING_ROOT}@p1`]: "{truncated" })
		expect(await repo.get("p1")).toEqual({ kind: "corrupt" })
		// Reading did not repair-by-deletion (fail-closed stays durable).
		expect(await repo.get("p1")).toEqual({ kind: "corrupt" })
	})

	test("a schema-mismatched row (valid JSON, wrong shape) is corrupt too", async () => {
		const { repo, storage } = makeRepo()
		await storage.set({ [`${RESTORE_PENDING_ROOT}@p1`]: JSON.stringify({ profileId: "p1" }) })
		expect(await repo.get("p1")).toEqual({ kind: "corrupt" })
	})

	test("markers are per-profile — one profile's marker never answers for another", async () => {
		const { repo } = makeRepo()
		await repo.write(MARKER)
		expect(await repo.get("p2")).toEqual({ kind: "absent" })
	})

	test("delete is idempotent on an absent marker", async () => {
		const { repo } = makeRepo()
		await expect(repo.delete("never-written")).resolves.toBeUndefined()
	})
})
