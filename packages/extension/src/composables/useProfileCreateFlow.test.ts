import { effectScope } from "vue"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { UserRejectedError } from "@nulo/extension-messaging/errors"

vi.mock("@/utils/core", () => {
	const profileMock = {
		getProfiles: vi.fn(async () => [] as Array<{ name: string }>),
		createProfile: vi.fn(async () => ({ id: "p1", name: "Created", type: "password" })),
		generateProfileId: vi.fn(async () => "p1"),
		createPasskeyProfile: vi.fn(async () => ({ id: "p1", name: "Created", type: "passkey" })),
	}
	return { managers: { profile: profileMock } }
})

vi.mock("@/wallet/utils/create-passkey-profile", () => ({
	createPasskeyProfileWithRetry: vi.fn(async () => ({ id: "p1", name: "Created", type: "passkey" })),
}))

import { managers } from "@/utils/core"
import { createPasskeyProfileWithRetry } from "@/wallet/utils/create-passkey-profile"
import { useProfileCreateFlow, type UseProfileCreateFlowOptions } from "./useProfileCreateFlow"

const profileApi = managers.profile as unknown as Record<string, ReturnType<typeof vi.fn>>
const passkeyRetry = createPasskeyProfileWithRetry as unknown as ReturnType<typeof vi.fn>

function makeFlow(overrides: Partial<UseProfileCreateFlowOptions> = {}) {
	const opts: UseProfileCreateFlowOptions = {
		onCreated: vi.fn(async () => undefined),
		notifyCreateFailed: vi.fn(),
		...overrides,
	}
	const scope = effectScope()
	let flow!: ReturnType<typeof useProfileCreateFlow>
	scope.run(() => {
		flow = useProfileCreateFlow(opts)
	})
	return { flow, opts, stop: () => scope.stop() }
}

beforeEach(() => {
	vi.clearAllMocks()
	profileApi.getProfiles.mockResolvedValue([])
})

describe("useProfileCreateFlow", () => {
	test("password create happy path creates + activates once", async () => {
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		await flow.handleCreate()
		expect(profileApi.createProfile).toHaveBeenCalledWith("MyProfile", "password123")
		expect(opts.onCreated).toHaveBeenCalledTimes(1)
		expect(opts.onCreated).toHaveBeenCalledWith({ id: "p1", name: "Created", type: "password" })
		expect(flow.isCreating.value).toBe(false)
	})

	test("passkey create delegates to createPasskeyProfileWithRetry then activates once", async () => {
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.authMethod.value = "passkey"
		await flow.handleCreate()
		expect(passkeyRetry).toHaveBeenCalledTimes(1)
		expect(passkeyRetry.mock.calls[0]?.[0]).toBe("MyProfile")
		expect(opts.onCreated).toHaveBeenCalledTimes(1)
	})

	test("latch: two synchronous submits create only once", async () => {
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		await Promise.all([flow.handleCreate(), flow.handleCreate()])
		expect(profileApi.createProfile).toHaveBeenCalledTimes(1)
		expect(opts.onCreated).toHaveBeenCalledTimes(1)
	})

	test("empty name blocks creation and resets the latch", async () => {
		const { flow, opts } = makeFlow()
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		await flow.handleCreate()
		expect(profileApi.createProfile).not.toHaveBeenCalled()
		expect(opts.onCreated).not.toHaveBeenCalled()
		expect(flow.isCreating.value).toBe(false)
		expect(flow.nameError.value).toBeTruthy()
	})

	test("duplicate name blocks creation", async () => {
		profileApi.getProfiles.mockResolvedValue([{ name: "Taken" }])
		const { flow, opts } = makeFlow()
		flow.profileName.value = "Taken"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		await flow.handleCreate()
		expect(profileApi.createProfile).not.toHaveBeenCalled()
		expect(opts.onCreated).not.toHaveBeenCalled()
	})

	test("passkey user-cancel is silent (no failure notification)", async () => {
		passkeyRetry.mockRejectedValueOnce(new UserRejectedError("cancelled"))
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.authMethod.value = "passkey"
		await flow.handleCreate()
		expect(opts.notifyCreateFailed).not.toHaveBeenCalled()
		expect(opts.onCreated).not.toHaveBeenCalled()
		expect(flow.isCreating.value).toBe(false)
	})

	test("password create failure notifies with isPasskey=false", async () => {
		profileApi.createProfile.mockRejectedValueOnce(new Error("boom"))
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		await flow.handleCreate()
		expect(opts.notifyCreateFailed).toHaveBeenCalledWith(false)
		expect(opts.onCreated).not.toHaveBeenCalled()
		expect(flow.isCreating.value).toBe(false)
	})

	test("passkey create failure notifies with isPasskey=true", async () => {
		passkeyRetry.mockRejectedValueOnce(new Error("authenticator exploded"))
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.authMethod.value = "passkey"
		await flow.handleCreate()
		expect(opts.notifyCreateFailed).toHaveBeenCalledWith(true)
	})

	test("isAllowedToContinue: passkey always true; password needs length + match", () => {
		const { flow } = makeFlow()
		flow.authMethod.value = "passkey"
		expect(flow.isAllowedToContinue.value).toBe(true)
		flow.authMethod.value = "password"
		flow.password.value = "short"
		expect(flow.isAllowedToContinue.value).toBe(false)
		flow.password.value = "password123"
		flow.repeatedPassword.value = "different"
		expect(flow.isAllowedToContinue.value).toBe(false)
		flow.repeatedPassword.value = "password123"
		expect(flow.isAllowedToContinue.value).toBe(true)
	})

	test("strengthHint reflects password state", () => {
		const { flow } = makeFlow()
		flow.authMethod.value = "passkey"
		expect(flow.strengthHint.value).toBe("")
		flow.authMethod.value = "password"
		flow.password.value = "short"
		expect(flow.strengthHint.value).toBe("At least 8 characters")
		flow.password.value = "password123"
		flow.repeatedPassword.value = "nope"
		expect(flow.strengthHint.value).toBe("Passwords don't match")
		flow.repeatedPassword.value = "password123"
		expect(flow.strengthHint.value).toBe("Strong password")
	})

	test("latch stays set if onCreated throws (matches popup 'Network not set')", async () => {
		const { flow } = makeFlow({
			onCreated: vi.fn(async () => {
				throw new Error("Network not set")
			}),
		})
		flow.profileName.value = "MyProfile"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		await expect(flow.handleCreate()).rejects.toThrow("Network not set")
		expect(flow.isCreating.value).toBe(true)
	})

	test("dispose() is callable and the composable registers no onUnmounted", () => {
		const { flow, stop } = makeFlow()
		expect(() => flow.dispose()).not.toThrow()
		stop()
	})
})
