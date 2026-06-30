import { ProfileIdConflictError, UserRejectedError } from "@nulo/extension-messaging/errors"
import { describe, expect, test, vi } from "vitest"

import { createPasskeyProfileWithRetry } from "./create-passkey-profile"

function makeDeps(overrides?: {
	runCeremony?: () => Promise<unknown>
	generateProfileId?: () => Promise<string>
	createPasskeyProfile?: (name: string, c: unknown) => Promise<unknown>
}) {
	let idSeq = 0
	const generateProfileId = vi.fn(overrides?.generateProfileId ?? (async () => `id-${++idSeq}`))
	const runCeremony = vi.fn(overrides?.runCeremony ?? (async () => ({ kind: "cred-data" })))
	const createPasskeyProfile = vi.fn(
		overrides?.createPasskeyProfile ?? (async (name) => ({ id: idSeq.toString(), name, type: "passkey" })),
	)
	return {
		generateProfileId: generateProfileId as never,
		runCeremony: runCeremony as never,
		createPasskeyProfile: createPasskeyProfile as never,
		mocks: { generateProfileId, runCeremony, createPasskeyProfile },
	}
}

describe("createPasskeyProfileWithRetry", () => {
	test("happy path: returns profile on first attempt; only one ceremony", async () => {
		const deps = makeDeps()
		const profile = await createPasskeyProfileWithRetry("My Wallet", deps)
		expect(profile).toMatchObject({ name: "My Wallet", type: "passkey" })
		expect(deps.mocks.generateProfileId).toHaveBeenCalledTimes(1)
		expect(deps.mocks.runCeremony).toHaveBeenCalledTimes(1)
		expect(deps.mocks.createPasskeyProfile).toHaveBeenCalledTimes(1)
	})

	test("conflict on attempt 1 triggers retry; second attempt uses a fresh id", async () => {
		let attempts = 0
		const deps = makeDeps({
			createPasskeyProfile: async (name) => {
				attempts++
				if (attempts === 1) throw new ProfileIdConflictError()
				return { id: "fresh", name, type: "passkey" }
			},
		})
		const profile = await createPasskeyProfileWithRetry("Wallet", deps)
		expect(profile.id).toBe("fresh")
		expect(deps.mocks.generateProfileId).toHaveBeenCalledTimes(2)
		expect(deps.mocks.runCeremony).toHaveBeenCalledTimes(2)
		expect(deps.mocks.createPasskeyProfile).toHaveBeenCalledTimes(2)
	})

	test("conflict on both attempts re-throws the second conflict", async () => {
		const deps = makeDeps({
			createPasskeyProfile: async () => {
				throw new ProfileIdConflictError()
			},
		})
		await expect(createPasskeyProfileWithRetry("X", deps)).rejects.toBeInstanceOf(ProfileIdConflictError)
		expect(deps.mocks.createPasskeyProfile).toHaveBeenCalledTimes(2)
	})

	test("non-conflict error propagates without retry (UserRejectedError)", async () => {
		const deps = makeDeps({
			runCeremony: async () => {
				throw new UserRejectedError()
			},
		})
		await expect(createPasskeyProfileWithRetry("X", deps)).rejects.toBeInstanceOf(UserRejectedError)
		expect(deps.mocks.createPasskeyProfile).not.toHaveBeenCalled()
	})

	test("non-conflict error from createPasskeyProfile propagates without retry", async () => {
		const deps = makeDeps({
			createPasskeyProfile: async () => {
				throw new Error("Some other failure")
			},
		})
		await expect(createPasskeyProfileWithRetry("X", deps)).rejects.toThrow("Some other failure")
		expect(deps.mocks.createPasskeyProfile).toHaveBeenCalledTimes(1)
	})

	test("runCeremony is invoked with mode=create and the generated userHandle", async () => {
		const ids: string[] = []
		const deps = makeDeps({
			generateProfileId: async () => {
				const id = `id-${ids.length + 1}`
				ids.push(id)
				return id
			},
		})
		await createPasskeyProfileWithRetry("My Wallet", deps)
		expect(deps.mocks.runCeremony).toHaveBeenCalledWith({ mode: "create", userHandle: ids[0], name: "My Wallet" })
	})
})
