/**
 * Seam tests for the popup router guard (extracted from `popup/index.ts`, which mounts on import):
 * the decision table, and the two cold-boot invariants — the early branches make NO service calls
 * and call `next` SYNCHRONOUSLY, before the guard callback's promise resolves.
 */
import { describe, expect, test, vi } from "vitest"
import type { RouteLocationNormalized } from "vue-router"

const gateMock = vi.fn()
const lastActiveMock = vi.fn()
vi.mock("./auth-guard", () => ({ authRequiredGate: (...args: unknown[]) => gateMock(...args) }))
vi.mock("@/utils/lastActiveProfile", () => ({ getLastActiveProfileId: () => lastActiveMock() }))

import { createPopupGuard, earlyDecision, lateDecision } from "./route-guard"

const route = (name: string, meta: Record<string, unknown> = {}) => ({ name, meta }) as unknown as RouteLocationNormalized
const store = (over: Record<string, unknown> = {}) =>
	({ isRegistered: false, isLogined: false, isSessionChecked: true, profile: undefined, ...over }) as never
const profileApi = () => ({
	getActiveProfile: vi.fn(async () => undefined),
	getProfiles: vi.fn(async () => [] as never[]),
})

describe("earlyDecision (synchronous)", () => {
	test("a passkey interaction proceeds; register-when-registered and auth-when-logined bounce to `from` (or general)", () => {
		expect(earlyDecision(route("x", { isPasskeyInteraction: true }), route("y"), store())).toEqual({ kind: "proceed" })
		expect(earlyDecision(route("popup-register"), route("popup-home"), store({ isRegistered: true }))).toEqual({
			kind: "redirect",
			to: { name: "popup-home" },
		})
		expect(earlyDecision(route("popup-auth"), { name: undefined, meta: {} } as never, store({ isLogined: true }))).toEqual({
			kind: "redirect",
			to: { name: "popup-general" },
		})
		expect(earlyDecision(route("popup-register"), route("y"), store())).toBeUndefined()
		expect(earlyDecision(route("popup-auth"), route("y"), store())).toBeUndefined()
	})
})

describe("lateDecision", () => {
	test("auth-required while not logged in consults the gate; `auth` redirects, anything else falls through", async () => {
		const api = profileApi()
		gateMock.mockResolvedValueOnce("auth")
		expect(await lateDecision(route("p", { isAuthRequired: true }), store({ profile: { id: "p1" } }), api)).toEqual({
			name: "popup-auth",
		})
		gateMock.mockResolvedValueOnce("proceed")
		expect(await lateDecision(route("p", { isAuthRequired: true }), store({ profile: { id: "p1" } }), api)).toBeUndefined()
		expect(gateMock).toHaveBeenCalledTimes(2)
	})

	test("no profile: selects the last active (else the first), or redirects to register when there are none", async () => {
		const api = profileApi()
		api.getProfiles.mockResolvedValueOnce([{ id: "a" }, { id: "b" }] as never)
		lastActiveMock.mockResolvedValueOnce("b")
		const s = store()
		expect(await lateDecision(route("popup-general"), s, api)).toBeUndefined()
		expect((s as { profile?: { id: string } }).profile).toEqual({ id: "b" })

		api.getProfiles.mockResolvedValueOnce([{ id: "a" }] as never)
		lastActiveMock.mockResolvedValueOnce(null)
		const s2 = store()
		await lateDecision(route("popup-general"), s2, api)
		expect((s2 as { profile?: { id: string } }).profile).toEqual({ id: "a" })

		api.getProfiles.mockResolvedValueOnce([])
		expect(await lateDecision(route("popup-general"), store(), api)).toEqual({ name: "popup-register" })
		// The onboarding routes never trigger the selection.
		expect(await lateDecision(route("popup-import"), store(), api)).toBeUndefined()
		expect(api.getProfiles).toHaveBeenCalledTimes(3)
	})

	test("a password-only route bounces a passkey profile to settings", async () => {
		expect(
			await lateDecision(
				route("p", { requirePasswordProfile: true }),
				store({ profile: { id: "p", type: "passkey" } }),
				profileApi(),
			),
		).toEqual({
			path: "/popup/settings/profile",
		})
		expect(
			await lateDecision(
				route("p", { requirePasswordProfile: true }),
				store({ profile: { id: "p", type: "password" } }),
				profileApi(),
			),
		).toBeUndefined()
	})
})

describe("createPopupGuard — cold-boot contract", () => {
	test("early branches call next SYNCHRONOUSLY, before the callback's promise settles, and touch no service", () => {
		const api = profileApi()
		const guard = createPopupGuard(
			() => store({ isLogined: true }),
			() => api,
		)
		const next = vi.fn()
		const pending = guard(route("popup-auth"), route("popup-home"), next)
		expect(next).toHaveBeenCalledWith({ name: "popup-home" })
		expect(api.getActiveProfile).not.toHaveBeenCalled()
		expect(api.getProfiles).not.toHaveBeenCalled()
		expect(gateMock).not.toHaveBeenCalled()
		return pending
	})

	test("the late path calls next exactly once with the decision (or bare)", async () => {
		const api = profileApi()
		api.getProfiles.mockResolvedValueOnce([])
		const guard = createPopupGuard(
			() => store(),
			() => api,
		)
		const next = vi.fn()
		await guard(route("popup-general"), route("x"), next)
		expect(next).toHaveBeenCalledTimes(1)
		expect(next).toHaveBeenCalledWith({ name: "popup-register" })

		const next2 = vi.fn()
		await guard(route("popup-import"), route("x"), next2)
		expect(next2).toHaveBeenCalledTimes(1)
		expect(next2).toHaveBeenCalledWith()
	})
})
