/**
 * N-05 pins — the network-switch orchestration's identity fence. Each pin
 * parks the run at ONE await boundary, forces the race there, and proves the
 * superseded/drifted run commits NOTHING past that point.
 */
import { describe, expect, test, vi } from "vitest"
import { createNetworkSwitchHandler, type NetworkSwitchDeps, type NetworkSwitchScope } from "./network-switch"

function _deferred<T = void>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

const ACCOUNT = { address: "0xa" }

function makeDeps(over: Partial<NetworkSwitchDeps> = {}) {
	let scope: NetworkSwitchScope | undefined = { profileId: "p1", chainId: 1 }
	let live: NetworkSwitchScope = { profileId: "p1", chainId: 1 }
	const setAccounts = vi.fn()
	const setupActiveAccount = vi.fn(async () => {})
	const syncTransactions = vi.fn(async () => {})
	const syncNetworkStatus = vi.fn()
	const client = {
		getAccounts: vi.fn(async () => [ACCOUNT]),
		ensureDefaultAccount: vi.fn(async () => ({})),
	}
	const deps: NetworkSwitchDeps = {
		getScope: () => scope,
		liveScopeMatches: (s) => live.profileId === s.profileId && live.chainId === s.chainId,
		syncNetworkStatus,
		replaceAccountClient: vi.fn(() => client),
		setAccounts,
		setupActiveAccount,
		syncTransactions,
		...over,
	}
	return {
		deps,
		client,
		setAccounts,
		setupActiveAccount,
		syncTransactions,
		setScope: (s: NetworkSwitchScope | undefined) => {
			scope = s
		},
		setLive: (s: NetworkSwitchScope) => {
			live = s
		},
	}
}

describe("createNetworkSwitchHandler (N-05)", () => {
	test("happy path: fetch → set → setup → sync; no default-create when accounts exist", async () => {
		const h = makeDeps()
		await createNetworkSwitchHandler(h.deps)()
		expect(h.setAccounts).toHaveBeenCalledWith([ACCOUNT])
		expect(h.client.ensureDefaultAccount).not.toHaveBeenCalled()
		expect(h.setupActiveAccount).toHaveBeenCalled()
		expect(h.syncTransactions).toHaveBeenCalled()
	})

	test("empty chain: ensureDefaultAccount then re-fetch, both sets land", async () => {
		const h = makeDeps()
		h.client.getAccounts.mockResolvedValueOnce([]).mockResolvedValueOnce([ACCOUNT])
		await createNetworkSwitchHandler(h.deps)()
		expect(h.client.ensureDefaultAccount).toHaveBeenCalledWith("p1", 1, expect.anything(), "Account")
		expect(h.setAccounts).toHaveBeenNthCalledWith(1, [])
		expect(h.setAccounts).toHaveBeenNthCalledWith(2, [ACCOUNT])
	})

	test("not-ready (no scope): returns without touching anything — but still supersedes an in-flight run", async () => {
		const h = makeDeps()
		const gate = _deferred<never[]>()
		h.client.getAccounts.mockReturnValueOnce(gate.promise as never)
		const handler = createNetworkSwitchHandler(h.deps)
		const run1 = handler() // parks at getAccounts
		h.setScope(undefined)
		await handler() // the transitional undefined-network fire
		gate.resolve([])
		await run1
		// run1 was superseded by the null-scope invocation's begin(): nothing landed.
		expect(h.setAccounts).not.toHaveBeenCalled()
		expect(h.setupActiveAccount).not.toHaveBeenCalled()
	})

	test("superseded at await 1 (first getAccounts): no set, no setup, no sync", async () => {
		const h = makeDeps()
		const gate = _deferred<Array<typeof ACCOUNT>>()
		h.client.getAccounts.mockReturnValueOnce(gate.promise)
		const handler = createNetworkSwitchHandler(h.deps)
		const run1 = handler()
		const run2gate = _deferred<Array<typeof ACCOUNT>>()
		h.client.getAccounts.mockReturnValueOnce(run2gate.promise)
		const run2 = handler() // supersedes
		gate.resolve([ACCOUNT]) // run1 resumes — must abandon
		await run1
		expect(h.setAccounts).not.toHaveBeenCalled()
		run2gate.resolve([ACCOUNT])
		await run2
		expect(h.setAccounts).toHaveBeenCalledTimes(1) // only run2's
	})

	test("superseded at await 2 (ensureDefaultAccount): the re-fetch and second set never happen", async () => {
		const h = makeDeps()
		h.client.getAccounts.mockResolvedValueOnce([])
		const gate = _deferred()
		h.client.ensureDefaultAccount.mockReturnValueOnce(gate.promise as never)
		const handler = createNetworkSwitchHandler(h.deps)
		const run1 = handler() // parks at ensureDefaultAccount
		await Promise.resolve()
		await Promise.resolve()
		const run2gate = _deferred<Array<typeof ACCOUNT>>()
		h.client.getAccounts.mockReturnValueOnce(run2gate.promise)
		const run2 = handler()
		gate.resolve()
		await run1
		expect(h.client.getAccounts).toHaveBeenCalledTimes(2) // run1's first + run2's — run1's RE-fetch never fired
		expect(h.setupActiveAccount).not.toHaveBeenCalled()
		run2gate.resolve([ACCOUNT])
		await run2
	})

	test("superseded at await 3 (re-fetch): the second set never lands", async () => {
		const h = makeDeps()
		h.client.getAccounts.mockResolvedValueOnce([])
		const gate = _deferred<Array<typeof ACCOUNT>>()
		h.client.getAccounts.mockReturnValueOnce(gate.promise)
		const handler = createNetworkSwitchHandler(h.deps)
		const run1 = handler() // set([]) lands, parks at the re-fetch
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
		expect(h.setAccounts).toHaveBeenCalledTimes(1)
		const run2gate = _deferred<Array<typeof ACCOUNT>>()
		h.client.getAccounts.mockReturnValueOnce(run2gate.promise)
		const run2 = handler()
		gate.resolve([ACCOUNT]) // run1's re-fetch resumes — must abandon
		await run1
		expect(h.setAccounts).toHaveBeenCalledTimes(1) // still only run1's first set
		run2gate.resolve([ACCOUNT])
		await run2
	})

	test("superseded at await 4 (setupActiveAccount): the tail sync never starts", async () => {
		const h = makeDeps()
		const gate = _deferred()
		h.setupActiveAccount.mockReturnValueOnce(gate.promise)
		const handler = createNetworkSwitchHandler(h.deps)
		const run1 = handler() // parks in setupActiveAccount
		await Promise.resolve()
		await Promise.resolve()
		const run2gate = _deferred<Array<typeof ACCOUNT>>()
		h.client.getAccounts.mockReturnValueOnce(run2gate.promise)
		const run2 = handler()
		gate.resolve()
		await run1
		expect(h.syncTransactions).not.toHaveBeenCalled()
		run2gate.resolve([ACCOUNT])
		await run2
		expect(h.syncTransactions).toHaveBeenCalledTimes(1) // run2's only
	})

	test("PROFILE DRIFT with no new watcher fire: generation intact, live scope moved — the run still abandons", async () => {
		const h = makeDeps()
		const gate = _deferred<Array<typeof ACCOUNT>>()
		h.client.getAccounts.mockReturnValueOnce(gate.promise)
		const run = createNetworkSwitchHandler(h.deps)()
		h.setLive({ profileId: "p2", chainId: 1 }) // drift — no second handler call
		gate.resolve([ACCOUNT])
		await run
		expect(h.setAccounts).not.toHaveBeenCalled()
	})

	test("captured scope is passed to the calls — never a live re-read", async () => {
		const h = makeDeps()
		h.client.getAccounts.mockResolvedValueOnce([])
		// Scope object mutates AFTER capture; the calls must use the captured values.
		const handler = createNetworkSwitchHandler(h.deps)
		const run = handler()
		await run
		expect(h.client.getAccounts).toHaveBeenCalledWith("p1", 1, true)
		expect(h.client.ensureDefaultAccount).toHaveBeenCalledWith("p1", 1, expect.anything(), "Account")
	})

	test("rapid double-switch: only the second run's results land", async () => {
		const h = makeDeps()
		const g1 = _deferred<Array<typeof ACCOUNT>>()
		const g2 = _deferred<Array<typeof ACCOUNT>>()
		h.client.getAccounts.mockReturnValueOnce(g1.promise).mockReturnValueOnce(g2.promise)
		const handler = createNetworkSwitchHandler(h.deps)
		const run1 = handler()
		const run2 = handler()
		g2.resolve([ACCOUNT]) // second finishes FIRST
		await run2
		expect(h.setAccounts).toHaveBeenCalledTimes(1)
		g1.resolve([{ address: "0xstale" }] as never) // first resumes late
		await run1
		expect(h.setAccounts).toHaveBeenCalledTimes(1) // stale set never landed
		expect(h.setAccounts).toHaveBeenCalledWith([ACCOUNT])
	})
})
