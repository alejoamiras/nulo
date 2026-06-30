/**
 * Unit tests for `requireActiveProfile` — the canonical active-profile lock
 * guard swept across the SW service layer.
 *
 * The message-preservation cases are load-bearing: the three drifted strings
 * ("Profile locked" / "Wallet locked" / "Wallet is locked") are asserted by
 * downstream tests + the dApp wire contract, so the helper must throw the exact
 * string it is handed and default to "Profile locked".
 */
import { describe, expect, test } from "vitest"
import { requireActiveProfile } from "./require-active-profile"
import type { ProfileInfo } from "./spec"

const aProfile: ProfileInfo = { id: "p1", name: "Alice", type: "password" }

describe("requireActiveProfile", () => {
	test("returns the active profile when one is set", async () => {
		const source = { getActiveProfile: async () => aProfile }
		await expect(requireActiveProfile(source)).resolves.toBe(aProfile)
	})

	test('defaults to throwing "Profile locked" when absent', async () => {
		const source = { getActiveProfile: async () => undefined }
		await expect(requireActiveProfile(source)).rejects.toThrow("Profile locked")
	})

	test("throws the exact message it is handed (preserve verbatim, no unify)", async () => {
		const source = { getActiveProfile: async () => undefined }
		await expect(requireActiveProfile(source, "Wallet locked")).rejects.toThrow("Wallet locked")
		await expect(requireActiveProfile(source, "Wallet is locked")).rejects.toThrow("Wallet is locked")
	})

	test("returns the profile (not just truthiness) so callers can use its fields", async () => {
		const source = { getActiveProfile: async () => aProfile }
		const profile = await requireActiveProfile(source)
		expect(profile.id).toBe("p1")
		expect(profile.name).toBe("Alice")
	})

	test("accepts any { getActiveProfile() } source — adapter / captured getter, not only ProfileService", async () => {
		const depsAdapter = { getActiveProfile: () => Promise.resolve(aProfile), getNetwork: () => Promise.resolve(undefined) }
		await expect(requireActiveProfile(depsAdapter)).resolves.toBe(aProfile)
	})

	test("propagates a source that rejects (does not swallow getActiveProfile errors)", async () => {
		const source = {
			getActiveProfile: async (): Promise<ProfileInfo | undefined> => {
				throw new Error("storage down")
			},
		}
		await expect(requireActiveProfile(source)).rejects.toThrow("storage down")
	})
})
