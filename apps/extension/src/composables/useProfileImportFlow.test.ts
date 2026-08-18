import { effectScope } from "vue"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { UserRejectedError } from "@nulo/extension-messaging/errors"

vi.mock("@/utils/core", () => {
	const profileMock = {
		getProfiles: vi.fn(async () => [] as Array<{ name: string }>),
		importMnemonic: vi.fn(async () => ({ id: "p1", name: "Imported", type: "password" })),
		importPasskey: vi.fn(async () => ({ id: "p1", name: "Imported", type: "passkey" })),
	}
	return { managers: { profile: profileMock } }
})

import { managers } from "@/utils/core"
import { useProfileImportFlow, type UseProfileImportFlowOptions } from "./useProfileImportFlow"

const profileApi = managers.profile as unknown as Record<string, ReturnType<typeof vi.fn>>

/** Run the composable inside an owned effect scope so its internal `watch` is
 *  disposed between tests; return the flow + a scope-stopper. */
function makeFlow(overrides: Partial<UseProfileImportFlowOptions> = {}) {
	const opts: UseProfileImportFlowOptions = {
		completeImport: vi.fn(async () => undefined),
		showErrorLog: vi.fn(),
		notifyImportFailed: vi.fn(),
		openToast: vi.fn(),
		...overrides,
	}
	const scope = effectScope()
	let flow!: ReturnType<typeof useProfileImportFlow>
	scope.run(() => {
		flow = useProfileImportFlow(opts)
	})
	return { flow, opts, stop: () => scope.stop() }
}

const SEED_24 = Array(24).fill("word").join(" ")
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
	vi.clearAllMocks()
	profileApi.getProfiles.mockResolvedValue([])
})

describe("useProfileImportFlow", () => {
	test("seed happy path imports and completes once", async () => {
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		flow.seedPhrase.value = SEED_24
		await flow.handleImportSeed()
		expect(profileApi.importMnemonic).toHaveBeenCalledWith("MyProfile", SEED_24.split(" "), "password123")
		expect(opts.completeImport).toHaveBeenCalledTimes(1)
		expect(flow.isImporting.value).toBe(false)
	})

	test("passkey happy path runs the ceremony then imports + completes once", async () => {
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		const fakeCred = { credentialId: "c1" } as never
		const p = flow.handleImportPasskey()
		await tick()
		expect(flow.ceremonyRequest.value).toEqual({ mode: "get" })
		flow.onCeremonyResolve(fakeCred)
		await p
		expect(profileApi.importPasskey).toHaveBeenCalledWith("MyProfile", fakeCred)
		expect(opts.completeImport).toHaveBeenCalledTimes(1)
	})

	test("latch: two synchronous seed calls import only once", async () => {
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		flow.seedPhrase.value = SEED_24
		await Promise.all([flow.handleImportSeed(), flow.handleImportSeed()])
		expect(profileApi.importMnemonic).toHaveBeenCalledTimes(1)
		expect(opts.completeImport).toHaveBeenCalledTimes(1)
	})

	test("empty name blocks the import and resets the latch", async () => {
		const { flow, opts } = makeFlow()
		// profileName left empty -> validate fails at submit time
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		flow.seedPhrase.value = SEED_24
		await flow.handleImportSeed()
		expect(profileApi.importMnemonic).not.toHaveBeenCalled()
		expect(opts.completeImport).not.toHaveBeenCalled()
		expect(flow.isImporting.value).toBe(false)
		expect(flow.nameError.value).toBeTruthy()
	})

	test("duplicate name blocks the import", async () => {
		profileApi.getProfiles.mockResolvedValue([{ name: "Taken" }])
		const { flow, opts } = makeFlow()
		flow.profileName.value = "Taken"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		flow.seedPhrase.value = SEED_24
		await flow.handleImportSeed()
		expect(profileApi.importMnemonic).not.toHaveBeenCalled()
		expect(opts.completeImport).not.toHaveBeenCalled()
		expect(flow.nameError.value).toBeTruthy()
	})

	test("(A1) generic import error uses the unified shape, not [object Object]", async () => {
		profileApi.importMnemonic.mockRejectedValueOnce(new Error("boom"))
		const { flow } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		flow.seedPhrase.value = SEED_24
		await flow.handleImportSeed()
		expect(flow.error.value).toEqual({ type: "unknown", title: "Import failed", tooltip: "boom" })
		// The title is a real string, never the Error object -> no "[object Object]".
		expect(String(flow.error.value.title)).not.toBe("[object Object]")
	})

	test("passkey user-cancel is silent (no failure notification)", async () => {
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		const p = flow.handleImportPasskey()
		await tick()
		flow.onCeremonyReject(new UserRejectedError("cancelled"))
		await p
		expect(opts.notifyImportFailed).not.toHaveBeenCalled()
		expect(profileApi.importPasskey).not.toHaveBeenCalled()
		expect(flow.isImporting.value).toBe(false)
	})

	test("passkey generic failure notifies once", async () => {
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		const p = flow.handleImportPasskey()
		await tick()
		flow.onCeremonyReject(new Error("authenticator exploded"))
		await p
		expect(opts.notifyImportFailed).toHaveBeenCalledTimes(1)
	})

	test("(Quirk 1) completeImport fires exactly once per import — composable never bootstraps", async () => {
		// The composable has no bootstrap dependency; activation happens solely
		// through the injected completeImport. Pinning call-count == 1 catches a
		// regression that an end-state-only assertion would miss.
		const { flow, opts } = makeFlow()
		flow.profileName.value = "MyProfile"
		flow.selectedImportOption.value = "seed"
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"
		flow.seedPhrase.value = SEED_24
		await flow.handleImportSeed()
		expect(opts.completeImport).toHaveBeenCalledTimes(1)
		expect(opts.completeImport).toHaveBeenCalledWith({ id: "p1", name: "Imported", type: "password" })
	})

	test("dispose() is callable and the composable registers no onUnmounted", () => {
		// Constructed outside a component setup; if it registered onUnmounted Vue
		// would warn. dispose() (name-field shake-timer cleanup) must be safe to
		// call directly from the parent's onBeforeUnmount.
		const { flow, stop } = makeFlow()
		expect(() => flow.dispose()).not.toThrow()
		stop()
	})
})
