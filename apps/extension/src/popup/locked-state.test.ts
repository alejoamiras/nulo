import { describe, expect, test } from "vitest"
import { reactive, ref } from "vue"
import type { ToastState } from "@/composables/toast"
import { createLockedState, watchLockStart } from "./locked-state"
import { createScopeEpochHandlers } from "./scope-epoch"

const p1 = { id: "p1" }

function shell(profiles = [p1]) {
	const store = reactive({ isLogined: true, scopeEpoch: 0, profiles, activity: 3, inFlight: 1, popups: 1 })
	const toast = ref<ToastState | null>({ id: 1, kind: "success", label: "Received 5 USDC" })
	const routes: string[] = []
	const { onLocked } = createScopeEpochHandlers({
		bumpEpoch: () => {
			store.scopeEpoch++
		},
		toast,
		closeToast: () => {
			toast.value = null
		},
	})
	const locked = createLockedState<{ id: string }>({
		closePopups: () => {
			store.popups = 0
		},
		onLocked,
		markLocked: () => {
			store.isLogined = false
		},
		clearActivity: () => {
			store.activity = 0
		},
		resetInFlight: () => {
			store.inFlight = 0
		},
		cachedProfiles: () => store.profiles,
		setProfiles: (next) => {
			store.profiles = next
		},
		route: (path) => routes.push(path),
	})
	return { store, toast, routes, onLocked, ...locked }
}

function held<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { read: () => promise, resolve, reject }
}

function expectSealed(s: ReturnType<typeof shell>) {
	expect(s.toast.value).toBeNull()
	expect(s.store.scopeEpoch).toBeGreaterThan(0)
	expect(s.store).toMatchObject({ isLogined: false, activity: 0, inFlight: 0, popups: 0 })
}

describe("the lock event", () => {
	test("seals the popup before its profile lookup answers, and lands once it does", async () => {
		const s = shell()
		const lookup = held<{ id: string }[]>()
		const done = s.onLockEvent(lookup.read, () => true)

		expectSealed(s)
		expect(s.routes).toEqual([])

		lookup.resolve([])
		await done
		expect(s.store.profiles).toEqual([])
		expect(s.routes).toEqual(["/popup/register"])
	})

	test("a newer profile event supersedes the landing, never the seal", async () => {
		const s = shell()
		const lookup = held<{ id: string }[]>()
		let current = true
		const done = s.onLockEvent(lookup.read, () => current)
		expectSealed(s)

		current = false
		lookup.resolve([])
		await done
		expect(s.store.profiles).toEqual([p1])
		expect(s.routes).toEqual([])
	})

	test("a rejected lookup lands on the cached list", async () => {
		const s = shell()
		const lookup = held<{ id: string }[]>()
		const done = s.onLockEvent(lookup.read, () => true)
		lookup.reject(new Error("port closed"))
		await done
		expectSealed(s)
		expect(s.routes).toEqual(["/popup/auth"])
	})
})

describe("the header's Lock", () => {
	test("closes the snack and moves the epoch in the same tick as the mark", () => {
		const s = shell()
		const stop = watchLockStart(() => s.store.isLogined, s.onLocked)
		s.store.isLogined = false
		expect(s.toast.value).toBeNull()
		expect(s.store.scopeEpoch).toBe(1)
		stop()
	})

	test("an unlock moves nothing", () => {
		const s = shell()
		s.store.isLogined = false
		const stop = watchLockStart(() => s.store.isLogined, s.onLocked)
		s.store.isLogined = true
		expect(s.toast.value).not.toBeNull()
		expect(s.store.scopeEpoch).toBe(0)
		stop()
	})
})
