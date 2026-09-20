import { TermsAcceptanceRequiredError, ValidationError } from "@nulo/extension-messaging/errors"
import { LEGAL_ACCEPTANCE_KEY, currentVersion } from "@nulo/legal"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { LegalAcceptanceService } from "./service"

const TERMS = currentVersion("terms").version

describe("LegalAcceptanceService", () => {
	let api: FakeBrowserApi
	let service: LegalAcceptanceService
	let clock = 1_000

	const stored = async () => (await api.storage.local.get(LEGAL_ACCEPTANCE_KEY))[LEGAL_ACCEPTANCE_KEY]
	const seed = (value: unknown) => api.storage.local.set({ [LEGAL_ACCEPTANCE_KEY]: value })

	beforeEach(() => {
		api = new FakeBrowserApi()
		api.reset()
		clock = 1_000
		service = new LegalAcceptanceService(new LoggerStore(new ConfigStore()), api, () => clock++)
	})

	test("a fresh install has no record and may not broadcast", async () => {
		expect(await service.getStatus()).toBe("missing")
		expect(await service.getRecord()).toBeNull()
		await expect(service.assertCurrent()).rejects.toBeInstanceOf(TermsAcceptanceRequiredError)
	})

	test("accept stamps the compiled versions, persists, and announces the new status", async () => {
		const changed = vi.fn()
		service.onAcceptanceChanged.add(changed)
		const record = await service.accept("onboarding")
		expect(record).toMatchObject({ termsVersion: TERMS, surface: "onboarding", acceptedAt: 1_000 })
		expect(await stored()).toEqual(record)
		expect(changed).toHaveBeenCalledWith("current")
		await expect(service.assertCurrent()).resolves.toBeUndefined()
	})

	test("accept resolves only after the record is durable", async () => {
		let release!: () => void
		const set = vi.spyOn(api.storage.local, "set").mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
		let settled = false
		const run = service.accept("popup").then(() => (settled = true))
		await new Promise((resolve) => setTimeout(resolve, 5))
		expect(settled).toBe(false)
		release()
		await run
		expect(set).toHaveBeenCalledTimes(1)
	})

	test("two acceptances at once both land in the history", async () => {
		await Promise.all([service.accept("onboarding"), service.accept("popup")])
		const record = await service.getRecord()
		expect(record?.history.map((entry) => entry.surface).sort()).toEqual(["onboarding", "popup"])
	})

	test("an older accepted version is stale and refused; accepting again clears it", async () => {
		await seed({ termsVersion: "0.9", privacyVersionShown: "0.9", acceptedAt: 1, surface: "popup", history: [] })
		expect(await service.getStatus()).toBe("stale")
		await expect(service.assertCurrent()).rejects.toBeInstanceOf(TermsAcceptanceRequiredError)
		await service.accept("popup")
		await expect(service.assertCurrent()).resolves.toBeUndefined()
	})

	test.each([
		["a string", "accepted"],
		["a truthy flag", true],
		["a half record", { termsVersion: TERMS }],
		["a hostile version", { termsVersion: "9.9<x>", privacyVersionShown: "1.0", acceptedAt: 1, surface: "popup" }],
	])("%s in storage is no acceptance", async (_name, value) => {
		await seed(value)
		expect(await service.getStatus()).toBe("missing")
		await expect(service.assertCurrent()).rejects.toBeInstanceOf(TermsAcceptanceRequiredError)
	})

	test("unreadable storage refuses the broadcast rather than letting it through", async () => {
		await service.accept("popup")
		vi.spyOn(api.storage.local, "get").mockRejectedValue(new Error("storage unavailable"))
		await expect(service.assertCurrent()).rejects.toBeInstanceOf(TermsAcceptanceRequiredError)
	})

	test("an unknown surface from the RPC boundary is rejected and writes nothing", async () => {
		await expect(service.accept("dapp" as never)).rejects.toBeInstanceOf(ValidationError)
		expect(await stored()).toBeUndefined()
	})

	test("a newer accepted version survives an acceptance made by an older build", async () => {
		await seed({ termsVersion: "99.0", privacyVersionShown: "1.0", acceptedAt: 1, surface: "popup", history: [] })
		const record = await service.accept("popup")
		expect(record.termsVersion).toBe("99.0")
		expect(record.history.at(-1)?.termsVersion).toBe(TERMS)
	})
})
