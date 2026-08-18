/**
 * Unit tests for `ProfileRepository`.
 *
 * Constructable with `FakeBrowserApi`, no `chrome.storage` mocks, no
 * real crypto. Exercises every public method + the "unlocked id-gen +
 * locked re-verify" contract via a stubbed random source.
 */

import { beforeEach, describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import type { Profile } from "./spec"
import { PROFILE_STORAGE_ROOT, ProfileRepository } from "./repository"

function setup(): { api: FakeBrowserApi; repo: ProfileRepository } {
	const api = new FakeBrowserApi()
	api.reset()
	const repo = new ProfileRepository(api)
	return { api, repo }
}

const samplePasswordProfile = (id: string): Profile => ({
	id,
	name: "test",
	type: "password",
	pxeGeneration: "gen-test",
	guard: "Z3VhcmQ=",
	secret: "c2VjcmV0",
	entropy: "ZW50cm9weQ==",
	envelopeMac: "bWFj",
})

describe("ProfileRepository", () => {
	let api: FakeBrowserApi
	let repo: ProfileRepository

	beforeEach(() => {
		;({ api, repo } = setup())
	})

	describe("set / get / contains / delete", () => {
		test("set stores and get returns the profile", async () => {
			const p = samplePasswordProfile("abcd1234")
			await repo.set(p.id, p)
			await expect(repo.get(p.id)).resolves.toEqual(p)
		})

		test("get returns undefined for a missing id", async () => {
			await expect(repo.get("nope")).resolves.toBeUndefined()
		})

		test("contains reports presence accurately", async () => {
			await expect(repo.contains("abcd1234")).resolves.toBe(false)
			await repo.set("abcd1234", samplePasswordProfile("abcd1234"))
			await expect(repo.contains("abcd1234")).resolves.toBe(true)
		})

		test("delete removes the record", async () => {
			const p = samplePasswordProfile("abcd1234")
			await repo.set(p.id, p)
			await repo.delete(p.id)
			await expect(repo.get(p.id)).resolves.toBeUndefined()
			await expect(repo.contains(p.id)).resolves.toBe(false)
		})
	})

	describe("getAll", () => {
		test("returns every profile currently on disk", async () => {
			const a = samplePasswordProfile("aaaa1111")
			const b = samplePasswordProfile("bbbb2222")
			await repo.set(a.id, a)
			await repo.set(b.id, b)
			const all = await repo.getAll()
			expect(all).toHaveLength(2)
			expect(all).toEqual(expect.arrayContaining([a, b]))
		})

		test("returns an empty array when no profiles exist", async () => {
			await expect(repo.getAll()).resolves.toEqual([])
		})
	})

	describe("generateUniqueId", () => {
		test("returns an id that is not yet in storage", async () => {
			const id = await repo.generateUniqueId()
			await expect(repo.contains(id)).resolves.toBe(false)
			expect(id).toMatch(/^[0-9a-f]+$/)
		})

		test("skips ids that collide with existing records", async () => {
			// Pre-seed a record under a known id so the generator has to
			// retry past it. We stub the random source to produce
			// the collision on the first draw, then a fresh id on the
			// second.
			await repo.set("cafebabe", samplePasswordProfile("cafebabe"))

			const getRandomValues = self.crypto.getRandomValues.bind(self.crypto)
			const calls: Uint8Array[] = []
			let callCount = 0
			self.crypto.getRandomValues = ((target: Uint8Array) => {
				calls.push(target)
				// First call returns bytes that hex-encode to "cafebabe"
				// (collision). Second call returns bytes that
				// hex-encode to "deadbeef" (fresh).
				const bytes = callCount === 0 ? [0xca, 0xfe, 0xba, 0xbe] : [0xde, 0xad, 0xbe, 0xef]
				callCount += 1
				target.set(bytes.slice(0, target.length))
				return target
			}) as typeof self.crypto.getRandomValues
			try {
				const id = await repo.generateUniqueId()
				expect(id).toBe("deadbeef")
				expect(callCount).toBe(2)
			} finally {
				self.crypto.getRandomValues = getRandomValues
			}
		})
	})

	describe("storage key invariant", () => {
		test("writes under the frozen 'nulo:core:profiles' root", async () => {
			const p = samplePasswordProfile("abcd1234")
			await repo.set(p.id, p)
			const raw = await api.storage.local.get(null)
			expect(`${PROFILE_STORAGE_ROOT}@${p.id}` in raw).toBe(true)
			expect(PROFILE_STORAGE_ROOT).toBe("nulo:core:profiles")
		})
	})
})
