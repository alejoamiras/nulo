/**
 * The follow's ordering and fences, driven directly with deferrable dependencies and a fake Web
 * Lock (jsdom has none). The window-level cases — when it fires, that it never fails an approval —
 * live in `scope-follow.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import { installChromeStorage } from "../../../../tests/helpers/chrome-storage-mock"
import { storageLocalSet } from "@/utils/storage"
import { createScopeFollow, SCOPE_FOLLOW_LOCK, type ScopeFollowDeps } from "./scope-follow"
import type { ScopeView } from "./scope-mismatch"

const LOCAL = { id: "net-local", name: "Local Network", chainId: 1 } as unknown as Network
const MAIN = { address: "0xmain", name: "Main", visible: true } as unknown as Account

const view = (over: Partial<ScopeView> = {}): ScopeView => ({
	network: LOCAL,
	networkMismatch: true,
	signers: [MAIN],
	followAccount: MAIN,
	accountMismatch: false,
	readOnly: false,
	...over,
})

/** A Web Lock that serializes callbacks per name and logs the boundaries. */
const installFakeLocks = (log: string[]) => {
	const tails = new Map<string, Promise<unknown>>()
	const request = vi.fn((name: string, callback: () => Promise<unknown>) => {
		const previous = tails.get(name) ?? Promise.resolve()
		const run = previous.then(async () => {
			log.push(`lock:${name}`)
			try {
				return await callback()
			} finally {
				log.push(`unlock:${name}`)
			}
		})
		tails.set(
			name,
			run.catch(() => undefined),
		)
		return run
	})
	Object.defineProperty(navigator, "locks", { value: { request }, configurable: true })
	return request
}

const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

let log: string[]
let deps: ScopeFollowDeps & { setActiveNetwork: ReturnType<typeof vi.fn>; writeActiveAccount: ReturnType<typeof vi.fn> }

beforeEach(() => {
	log = []
	installFakeLocks(log)
	deps = {
		refreshInFlight: vi.fn(async () => {
			log.push("refresh")
		}),
		hasInFlightSend: () => false,
		setActiveNetwork: vi.fn(async (id: string) => {
			log.push(`network:${id}`)
		}),
		writeActiveAccount: vi.fn(async (address: string) => {
			log.push(`account:${address}`)
			return true
		}),
	}
})

afterEach(() => {
	Reflect.deleteProperty(navigator, "locks")
})

describe("createScopeFollow — what it writes, in which order, under which lock", () => {
	test("network first, then the account pointer, both inside the lock", async () => {
		const follow = createScopeFollow(deps)
		await follow.follow(view(), false, follow.capture())
		expect(log).toEqual([`lock:${SCOPE_FOLLOW_LOCK}`, "refresh", "network:net-local", "account:0xmain", `unlock:${SCOPE_FOLLOW_LOCK}`])
	})

	test("nothing to follow, or declined, or captured before a change: no lock, no writes", async () => {
		const follow = createScopeFollow(deps)
		await follow.follow(undefined, false, follow.capture())
		await follow.follow(view({ networkMismatch: false, accountMismatch: false }), false, follow.capture())
		await follow.follow(view(), true, follow.capture())
		const stale = follow.capture()
		follow.invalidate()
		await follow.follow(view(), false, stale)
		expect(log).toEqual([])
	})

	test("the guard is read only after the refresh answered; a cold tracker cannot suppress the follow", async () => {
		let refreshed = false
		deps.refreshInFlight = vi.fn(async () => {
			refreshed = true
		})
		deps.hasInFlightSend = () => !refreshed
		const follow = createScopeFollow(deps)
		await follow.follow(view(), false, follow.capture())
		expect(deps.setActiveNetwork).toHaveBeenCalledWith("net-local")
	})

	test("a send in flight skips both writes", async () => {
		deps.hasInFlightSend = () => true
		const follow = createScopeFollow(deps)
		await follow.follow(view(), false, follow.capture())
		expect(deps.setActiveNetwork).not.toHaveBeenCalled()
		expect(deps.writeActiveAccount).not.toHaveBeenCalled()
	})

	test("same row: only the account pointer moves", async () => {
		const follow = createScopeFollow(deps)
		await follow.follow(view({ networkMismatch: false, accountMismatch: true }), false, follow.capture())
		expect(deps.setActiveNetwork).not.toHaveBeenCalled()
		expect(deps.writeActiveAccount).toHaveBeenCalledWith("0xmain", expect.any(Function))
	})

	test("no follow account (a hidden or shared signer): the network moves, the account does not", async () => {
		const follow = createScopeFollow(deps)
		await follow.follow(view({ followAccount: undefined }), false, follow.capture())
		expect(deps.setActiveNetwork).toHaveBeenCalledTimes(1)
		expect(deps.writeActiveAccount).not.toHaveBeenCalled()
	})

	test("a network write that rejects skips the account write and does not throw", async () => {
		deps.setActiveNetwork = vi.fn(async () => {
			throw new Error("persist failed")
		})
		const follow = createScopeFollow(deps)
		await expect(follow.follow(view(), false, follow.capture())).resolves.toBeUndefined()
		expect(deps.writeActiveAccount).not.toHaveBeenCalled()
	})

	test("a rejecting account write after a successful network write rolls nothing back and does not throw", async () => {
		deps.writeActiveAccount = vi.fn(async () => {
			throw new Error("storage unavailable")
		})
		const follow = createScopeFollow(deps)
		await expect(follow.follow(view(), false, follow.capture())).resolves.toBeUndefined()
		expect(deps.setActiveNetwork).toHaveBeenCalledTimes(1)
	})
})

describe("createScopeFollow — the lifecycle fence", () => {
	test("invalidate bumps synchronously, whatever the trigger", () => {
		const follow = createScopeFollow(deps)
		const stillOurs = follow.capture()
		expect(stillOurs()).toBe(true)
		follow.invalidate()
		expect(stillOurs()).toBe(false)
	})

	test("a change landing during the refresh aborts before the network write", async () => {
		const refresh = deferred<void>()
		deps.refreshInFlight = vi.fn(() => refresh.promise)
		const follow = createScopeFollow(deps)
		const pending = follow.follow(view(), false, follow.capture())
		follow.invalidate()
		refresh.resolve()
		await pending
		expect(deps.setActiveNetwork).not.toHaveBeenCalled()
	})

	test("a change landing during the network write aborts before the account write", async () => {
		const network = deferred<void>()
		deps.setActiveNetwork = vi.fn(() => network.promise)
		const follow = createScopeFollow(deps)
		const pending = follow.follow(view(), false, follow.capture())
		await vi.waitFor(() => expect(deps.setActiveNetwork).toHaveBeenCalled())
		follow.invalidate()
		network.resolve()
		await pending
		expect(deps.writeActiveAccount).not.toHaveBeenCalled()
	})

	test("a change landing while the write is suspended inside the storage facade writes nothing", async () => {
		const storage = installChromeStorage({})
		deps.writeActiveAccount = vi.fn((address: string, unless: () => boolean) =>
			storageLocalSet({ "nulo:ui:activeAccount": address }, { unless }),
		)
		const follow = createScopeFollow(deps)
		const gate = storage.deferNextGet() // the facade's migration barrier, suspended
		const pending = follow.follow(view({ networkMismatch: false, accountMismatch: true }), false, follow.capture())
		await vi.waitFor(() => expect(storage.get).toHaveBeenCalled())
		follow.invalidate()
		gate.release()
		await pending
		expect(storage.set).not.toHaveBeenCalled()
	})

	test("the same write lands when nothing changed during the barrier", async () => {
		const storage = installChromeStorage({})
		deps.writeActiveAccount = vi.fn((address: string, unless: () => boolean) =>
			storageLocalSet({ "nulo:ui:activeAccount": address }, { unless }),
		)
		const follow = createScopeFollow(deps)
		await follow.follow(view({ networkMismatch: false, accountMismatch: true }), false, follow.capture())
		expect(storage.data["nulo:ui:activeAccount"]).toBe("0xmain")
	})
})

describe("createScopeFollow — two follows at once", () => {
	test("serialize into two whole pairs in request order, never interleaved", async () => {
		const OTHER = { id: "net-other", name: "Other", chainId: 2 } as unknown as Network
		const SAVINGS = { address: "0xsavings", name: "Savings", visible: true } as unknown as Account
		const first = createScopeFollow(deps)
		const second = createScopeFollow(deps)
		await Promise.all([
			first.follow(view(), false, first.capture()),
			second.follow(view({ network: OTHER, followAccount: SAVINGS }), false, second.capture()),
		])
		expect(log).toEqual([
			`lock:${SCOPE_FOLLOW_LOCK}`,
			"refresh",
			"network:net-local",
			"account:0xmain",
			`unlock:${SCOPE_FOLLOW_LOCK}`,
			`lock:${SCOPE_FOLLOW_LOCK}`,
			"refresh",
			"network:net-other",
			"account:0xsavings",
			`unlock:${SCOPE_FOLLOW_LOCK}`,
		])
	})
})
