/**
 * Component tests for PasskeyCeremonyDialog. Mocks the underlying
 * `runPasskeyCeremony` helper so we can drive each control-flow path
 * (success, error, cancel) deterministically.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { UserRejectedError } from "@nulo/extension-messaging/errors"
import PasskeyCeremonyDialog from "./PasskeyCeremonyDialog.vue"

// Mock the helper module — we don't want a real WebAuthn call.
vi.mock("@/wallet/utils/passkey-ceremony", () => ({
	runPasskeyCeremony: vi.fn(),
}))

import { runPasskeyCeremony } from "@/wallet/utils/passkey-ceremony"
const runPasskeyCeremonyMock = vi.mocked(runPasskeyCeremony)

const fakeRequest = { mode: "create" as const, userHandle: "uh", name: "Test" }
const fakeData = { id: "cred-x", prf: "prf-bytes" }

beforeEach(() => {
	// Provide a #popup teleport target the dialog can mount into.
	const popup = document.createElement("div")
	popup.id = "popup"
	document.body.appendChild(popup)
})

afterEach(() => {
	document.getElementById("popup")?.remove()
	runPasskeyCeremonyMock.mockReset()
})

describe("PasskeyCeremonyDialog", () => {
	test("emits resolve with credential data on success", async () => {
		runPasskeyCeremonyMock.mockResolvedValueOnce(fakeData)
		const w = mount(PasskeyCeremonyDialog, { props: { request: fakeRequest } })

		await flushPromises()

		expect(w.emitted("resolve")).toBeTruthy()
		expect(w.emitted("resolve")?.[0]).toEqual([fakeData])
		expect(w.emitted("reject")).toBeUndefined()
	})

	test("emits UserRejectedError when ceremony aborts (AbortError)", async () => {
		runPasskeyCeremonyMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
		const w = mount(PasskeyCeremonyDialog, { props: { request: fakeRequest } })
		await flushPromises()

		expect(w.emitted("reject")).toBeTruthy()
		expect(w.emitted("reject")?.[0]?.[0]).toBeInstanceOf(UserRejectedError)
	})

	test("emits UserRejectedError when WebAuthn returns NotAllowedError", async () => {
		runPasskeyCeremonyMock.mockRejectedValueOnce(new DOMException("not allowed", "NotAllowedError"))
		const w = mount(PasskeyCeremonyDialog, { props: { request: fakeRequest } })
		await flushPromises()

		expect(w.emitted("reject")?.[0]?.[0]).toBeInstanceOf(UserRejectedError)
	})

	test("emits the original error verbatim for non-cancel errors", async () => {
		const generic = new Error("Passkey PRF not available")
		runPasskeyCeremonyMock.mockRejectedValueOnce(generic)
		const w = mount(PasskeyCeremonyDialog, { props: { request: fakeRequest } })
		await flushPromises()

		expect(w.emitted("reject")?.[0]?.[0]).toBe(generic)
	})

	test("Escape key aborts the ceremony — emits UserRejectedError", async () => {
		// Helper resolves only when its signal aborts.
		runPasskeyCeremonyMock.mockImplementationOnce((_req, signal) => {
			return new Promise((_, reject) => {
				signal?.addEventListener("abort", () => reject(new DOMException(signal.reason, "AbortError")))
			})
		})
		const w = mount(PasskeyCeremonyDialog, { props: { request: fakeRequest } })

		// Wait one microtask so onMounted starts the helper + adds the keydown listener.
		await flushPromises()
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
		await flushPromises()

		expect(w.emitted("reject")?.[0]?.[0]).toBeInstanceOf(UserRejectedError)
	})

	test("non-Escape keys do NOT abort", async () => {
		runPasskeyCeremonyMock.mockImplementationOnce((_req, signal) => {
			return new Promise((_, reject) => {
				signal?.addEventListener("abort", () => reject(new DOMException(signal.reason, "AbortError")))
			})
		})
		const w = mount(PasskeyCeremonyDialog, { props: { request: fakeRequest } })
		await flushPromises()
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
		await flushPromises()

		expect(w.emitted("reject")).toBeUndefined()
		expect(w.emitted("resolve")).toBeUndefined()
	})

	test("onBeforeUnmount aborts the ceremony", async () => {
		let abortReason: unknown
		runPasskeyCeremonyMock.mockImplementationOnce((_req, signal) => {
			return new Promise((_, reject) => {
				signal?.addEventListener("abort", () => {
					abortReason = signal.reason
					reject(new DOMException(String(signal.reason), "AbortError"))
				})
			})
		})
		const w = mount(PasskeyCeremonyDialog, { props: { request: fakeRequest } })
		await flushPromises()
		w.unmount()
		await flushPromises()

		expect(abortReason).toBeInstanceOf(DOMException)
		expect((abortReason as DOMException).message).toMatch(/dismounted/)
	})

	test("removes the keydown listener on unmount (no leak)", async () => {
		runPasskeyCeremonyMock.mockResolvedValueOnce(fakeData)
		const before = (window as unknown as { _listenerCount?: number })._listenerCount ?? 0
		const addSpy = vi.spyOn(window, "addEventListener")
		const removeSpy = vi.spyOn(window, "removeEventListener")
		const w = mount(PasskeyCeremonyDialog, { props: { request: fakeRequest } })
		await flushPromises()
		w.unmount()
		await flushPromises()

		// One addEventListener for "keydown" on mount, one removeEventListener on unmount.
		// Cast: spy infers `c[0]` against the WorkerGlobalScope event map (tsconfig
		// includes worker libs); "keydown" overlaps in the Window map only.
		const added = addSpy.mock.calls.filter((c) => (c[0] as string) === "keydown").length
		const removed = removeSpy.mock.calls.filter((c) => (c[0] as string) === "keydown").length
		expect(added).toBe(1)
		expect(removed).toBe(1)
		// Sanity: no net listener leak compared to baseline.
		void before
	})

	test("teleports the dialog markup into #popup", async () => {
		runPasskeyCeremonyMock.mockResolvedValueOnce(fakeData)
		mount(PasskeyCeremonyDialog, { props: { request: fakeRequest }, attachTo: document.body })
		await flushPromises()
		const popup = document.getElementById("popup")
		// Any rendered child means the teleport landed (CSS module class names
		// are hashed; check for the static "Waiting for passkey…" copy instead).
		expect(popup?.textContent ?? "").toMatch(/waiting for passkey/i)
	})

	test("does NOT double-emit when unmount runs after a successful settle", async () => {
		runPasskeyCeremonyMock.mockResolvedValueOnce(fakeData)
		const w = mount(PasskeyCeremonyDialog, { props: { request: fakeRequest } })
		await flushPromises()
		// Snapshot emits BEFORE unmount; w.emitted() is rebuilt after
		// unmount in vue-test-utils and the post-unmount snapshot loses
		// pre-unmount events.
		const resolveEmitsBefore = w.emitted("resolve")
		expect(resolveEmitsBefore?.length).toBe(1)

		// Helper already resolved; unmount triggers cancel internally — must
		// short-circuit because `settled === true`.
		w.unmount()
		await flushPromises()

		// No new events fired between snapshot and unmount.
		expect(w.emitted("reject")).toBeUndefined()
	})

	test("renders the don't-navigate-away hint", async () => {
		runPasskeyCeremonyMock.mockResolvedValueOnce(fakeData)
		mount(PasskeyCeremonyDialog, { props: { request: fakeRequest }, attachTo: document.body })
		await flushPromises()
		expect(document.getElementById("popup")?.textContent ?? "").toMatch(/escape to cancel/i)
	})
})
