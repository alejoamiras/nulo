import { describe, expect, test } from "vitest"
import type { LockLandingAction } from "./lock-landing"
import { reconcileLockedBoot } from "./reconcile-locked-boot"

type R = { kind: "locked" | "active" | "unreachable"; profiles: string[] }
const locked: R = { kind: "locked", profiles: ["p1"] }

function deferred<T>() {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

/** A shell: the event counter, the run fence, the recorded actions, and a decision that can
 *  change between the lookup and the action (the event path mutates the store meanwhile). */
function shell(opts: { decide?: () => LockLandingAction; current?: () => boolean } = {}) {
	const state = { eventSeq: 0, current: true, calls: [] as string[] }
	const lookup = deferred<R>()
	const run = reconcileLockedBoot<R>({
		readEventSeq: () => state.eventSeq,
		isCurrent: opts.current ?? (() => state.current),
		lookup: () => lookup.promise,
		decide: opts.decide ?? (() => "lock"),
		act: {
			lock: () => state.calls.push("lock"),
			selectAndAuth: () => state.calls.push("select-and-auth"),
			settle: () => state.calls.push("settle"),
		},
	})
	return { state, lookup, run }
}

describe("reconcileLockedBoot", () => {
	test("no session, no event in flight: the boot run locks the shell", async () => {
		const { state, lookup, run } = shell()
		lookup.resolve(locked)
		expect(await run).toEqual(locked)
		expect(state.calls).toEqual(["lock"])
	})

	test("an unlock event lands while the lookup is in flight: the boot run must not lock", async () => {
		const { state, lookup, run } = shell()
		state.eventSeq += 1 // onActiveProfileChanged(profile) started: the event path owns the state now
		lookup.resolve(locked) // the stale read from before the open committed
		await run
		expect(state.calls).toEqual(["settle"])
	})

	test("the lookup resolves first, then an event lands before the run reaches its action: still no lock", async () => {
		const { state, lookup, run } = shell()
		lookup.resolve(locked)
		// The resolution is queued; the event handler runs synchronously ahead of the continuation.
		state.eventSeq += 1
		await run
		expect(state.calls).toEqual(["settle"])
	})

	test("an event that landed BEFORE the run started is already counted: the lock proceeds", async () => {
		const state = { eventSeq: 7, calls: [] as string[] }
		const lookup = deferred<R>()
		const run = reconcileLockedBoot<R>({
			readEventSeq: () => state.eventSeq,
			isCurrent: () => true,
			lookup: () => lookup.promise,
			decide: () => "lock",
			act: {
				lock: () => state.calls.push("lock"),
				selectAndAuth: () => state.calls.push("s"),
				settle: () => state.calls.push("settle"),
			},
		})
		lookup.resolve(locked)
		await run
		expect(state.calls).toEqual(["lock"])
	})

	test("a newer boot run supersedes: nothing is applied", async () => {
		const { state, lookup, run } = shell()
		state.current = false
		lookup.resolve(locked)
		expect(await run).toEqual({ kind: "superseded" })
		expect(state.calls).toEqual([])
	})

	test("the decision is read at action time: an unlock that set the profile turns 'select' into 'lock', then the fence holds", async () => {
		let hasProfile = false
		const { state, lookup, run } = shell({ decide: () => (hasProfile ? "lock" : "select-and-auth") })
		lookup.resolve(locked)
		hasProfile = true // the event path's bootstrap selected the profile meanwhile…
		state.eventSeq += 1 // …and the counter records that it did
		await run
		expect(state.calls).toEqual(["settle"])
	})

	test("select-and-auth and settle need no event fence; passkey-hold touches nothing", async () => {
		const a = shell({ decide: () => "select-and-auth" })
		a.lookup.resolve(locked)
		await a.run
		expect(a.state.calls).toEqual(["select-and-auth"])

		const b = shell({ decide: () => "settle" })
		b.lookup.resolve(locked)
		await b.run
		expect(b.state.calls).toEqual(["settle"])

		const c = shell({ decide: () => "passkey-hold" })
		c.lookup.resolve(locked)
		await c.run
		expect(c.state.calls).toEqual([])
	})

	test("a non-locked result passes through untouched", async () => {
		const { state, lookup, run } = shell()
		const active: R = { kind: "active", profiles: ["p1"] }
		lookup.resolve(active)
		expect(await run).toEqual(active)
		expect(state.calls).toEqual([])
	})
})
