/**
 * A/B interleaving pins for the shell's bootstrap outcome channel: a run
 * superseded mid-await must commit nothing — neither the failure record, its
 * clear, nor the toast.
 */
import { describe, expect, test, vi } from "vitest"
import { runFencedBootstrap, type FencedBootstrapDeps } from "./profile-bootstrap"

function makeDeps(over: Partial<FencedBootstrapDeps> = {}) {
	const setFailure = vi.fn()
	const toast = vi.fn()
	const deps: FencedBootstrapDeps = {
		profileId: "pA",
		bootstrap: async () => {},
		isCurrent: () => true,
		setFailure,
		shouldToast: () => true,
		toast,
		...over,
	}
	return { deps, setFailure, toast }
}

function _deferred() {
	let resolve!: () => void
	let reject!: (e: unknown) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe("runFencedBootstrap", () => {
	test("current success clears the failure record", async () => {
		const h = makeDeps()
		await runFencedBootstrap(h.deps)
		expect(h.setFailure).toHaveBeenCalledWith(null)
		expect(h.toast).not.toHaveBeenCalled()
	})

	test("current failure writes the identity-keyed record and toasts", async () => {
		const h = makeDeps({ bootstrap: async () => Promise.reject(new Error("boom")) })
		vi.spyOn(console, "error").mockImplementation(() => {})
		await runFencedBootstrap(h.deps)
		expect(h.setFailure).toHaveBeenCalledWith({ profileId: "pA", message: "boom" })
		expect(h.toast).toHaveBeenCalled()
	})

	test("STALE success (B superseded A mid-await) does not clear B's record", async () => {
		const gate = _deferred()
		let current = true
		const h = makeDeps({ bootstrap: () => gate.promise, isCurrent: () => current })
		const run = runFencedBootstrap(h.deps)
		current = false // B's event bumped the seq while A awaited
		gate.resolve()
		await run
		expect(h.setFailure).not.toHaveBeenCalled()
	})

	test("STALE failure (B superseded A mid-await) writes nothing and never toasts", async () => {
		const gate = _deferred()
		let current = true
		const h = makeDeps({ bootstrap: () => gate.promise, isCurrent: () => current })
		vi.spyOn(console, "error").mockImplementation(() => {})
		const run = runFencedBootstrap(h.deps)
		current = false
		gate.reject(new Error("late A failure"))
		await run
		expect(h.setFailure).not.toHaveBeenCalled()
		expect(h.toast).not.toHaveBeenCalled()
	})

	test("current failure with shouldToast false stays silent but still records", async () => {
		const h = makeDeps({
			bootstrap: async () => Promise.reject(new Error("x")),
			shouldToast: () => false,
		})
		vi.spyOn(console, "error").mockImplementation(() => {})
		await runFencedBootstrap(h.deps)
		expect(h.setFailure).toHaveBeenCalledWith({ profileId: "pA", message: "x" })
		expect(h.toast).not.toHaveBeenCalled()
	})

	test("non-Error rejection is stringified into the record", async () => {
		const h = makeDeps({ bootstrap: async () => Promise.reject("raw string") })
		vi.spyOn(console, "error").mockImplementation(() => {})
		await runFencedBootstrap(h.deps)
		expect(h.setFailure).toHaveBeenCalledWith({ profileId: "pA", message: "raw string" })
	})
})
