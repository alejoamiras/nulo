/**
 * State-machine tests for the wallet-picker session (the audit-required matrix).
 *
 * The factory is tested directly (not through the singleton wrapper) with a
 * push-driven discovery stream, so every stream shape — 0, 1, n, latecomers,
 * buffered-after-cancel — is exercised deterministically. The SDK's real
 * buffering quirk (yields delivered AFTER cancel()) is emulated by a cancel
 * that does NOT close the stream: the composable's epoch checks, not
 * cancellation, must be the correctness boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))
vi.mock("@/lib/chain-info", () => ({ readChainInfo: () => ({ chainId: 1 }) }))
vi.mock("@/lib/emoji", () => ({ hashToEmoji: () => "🟢🔵🟡🟣🔴⚪⚫🟠🟤" }))

const mockGetAvailableWallets = vi.fn()
vi.mock("@aztec/wallet-sdk/manager", () => ({
	WalletManager: {
		configure: vi.fn(() => ({ getAvailableWallets: mockGetAvailableWallets })),
	},
}))

import { createAztecWalletSession, type DiscoveredWallet } from "./createAztecWalletSession"

// ── Push-driven discovery stream ─────────────────────────────────────

type AnyProvider = Record<string, unknown>

function makeStream() {
	const queue: AnyProvider[] = []
	const resolvers: Array<(r: IteratorResult<AnyProvider>) => void> = []
	let ended = false
	const push = (p: AnyProvider) => {
		const r = resolvers.shift()
		if (r) r({ value: p, done: false })
		else queue.push(p)
	}
	const end = () => {
		ended = true
		for (const r of resolvers.splice(0)) r({ value: undefined as never, done: true })
	}
	const wallets: AsyncIterable<AnyProvider> = {
		[Symbol.asyncIterator]() {
			return {
				next(): Promise<IteratorResult<AnyProvider>> {
					if (queue.length) return Promise.resolve({ value: queue.shift() as AnyProvider, done: false })
					if (ended) return Promise.resolve({ value: undefined as never, done: true })
					return new Promise((res) => resolvers.push(res))
				},
			}
		},
	}
	// Deliberately does NOT end the stream: emulates the SDK's buffered-yields-
	// after-cancel behavior. `end()` is the natural timeout/exhaustion.
	const cancel = vi.fn()
	return { wallets, push, end, cancel }
}

function makeProvider(over: Partial<{ id: string; name: string; type: string; icon: string }> = {}) {
	const pending = {
		verificationHash: "deadbeef",
		confirm: vi.fn(),
		cancel: vi.fn(async () => {}),
	}
	const walletHandle = {
		requestCapabilities: vi.fn(async () => ({ granted: [{ type: "accounts", accounts: [{ alias: "Main", item: "0xa1" }] }] })),
	}
	pending.confirm.mockImplementation(async () => walletHandle)
	const provider = {
		id: over.id ?? "nulo",
		name: over.name ?? "Nulo",
		type: over.type ?? "extension",
		icon: over.icon,
		establishSecureChannel: vi.fn(async () => pending),
		disconnect: vi.fn(async () => {}),
		onDisconnect: vi.fn(() => () => {}),
	}
	return { provider, pending, walletHandle }
}

function makeSession() {
	return createAztecWalletSession({
		appId: "test-app",
		buildManifest: async () => ({}),
		registerContracts: vi.fn(async () => {}),
	})
}

async function flush(times = 4) {
	for (let i = 0; i < times; i++) await Promise.resolve()
}

function keys(list: DiscoveredWallet[]): number[] {
	return list.map((w) => w.key)
}

let stream: ReturnType<typeof makeStream>

beforeEach(() => {
	localStorage.clear()
	stream = makeStream()
	mockGetAvailableWallets.mockReset()
	mockGetAvailableWallets.mockImplementation(() => ({ wallets: stream.wallets, cancel: stream.cancel }))
})
afterEach(() => {
	vi.useRealTimers()
	vi.clearAllMocks()
})

describe("progressive discovery (fresh path)", () => {
	it("accumulates announcements with opaque keys; first arrival flips to choosing", async () => {
		const s = makeSession()
		const c = s.connect()
		await flush()
		expect(s.status.value).toBe("discovering")

		stream.push(makeProvider({ id: "nulo" }).provider)
		await flush()
		expect(s.status.value).toBe("choosing")
		expect(s.scanning.value).toBe(true)

		stream.push(makeProvider({ id: "acmewallet", name: "Acme", type: "web" }).provider)
		await flush()
		expect(s.discoveredWallets.value).toHaveLength(2)
		expect(new Set(keys(s.discoveredWallets.value)).size).toBe(2)

		stream.end()
		await c
		expect(s.status.value).toBe("choosing")
		expect(s.scanning.value).toBe(false)
	})

	it("claimed-id collision renders BOTH rows (no dedup by claimed id)", async () => {
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(makeProvider({ id: "nulo" }).provider)
		stream.push(makeProvider({ id: "nulo", name: "Nulo" }).provider)
		await flush()
		expect(s.discoveredWallets.value).toHaveLength(2)
	})

	it("natural zero-result end → no-wallet error; intentional cancel is never no-wallet", async () => {
		const s = makeSession()
		const c = s.connect()
		await flush()
		stream.end()
		await c
		expect(s.status.value).toBe("error")
		expect(s.error.value?.category).toBe("no-wallet")

		// Intentional cancel from choosing.
		stream = makeStream()
		mockGetAvailableWallets.mockImplementation(() => ({ wallets: stream.wallets, cancel: stream.cancel }))
		void s.connect()
		await flush()
		stream.push(makeProvider().provider)
		await flush()
		expect(s.status.value).toBe("choosing")
		s.cancelChoice()
		expect(s.status.value).toBe("idle")
		expect(s.error.value).toBeNull()
	})

	it("buffered yields delivered after cancelChoice are discarded (epoch guard)", async () => {
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(makeProvider().provider)
		await flush()
		s.cancelChoice()
		// The stream was NOT closed by cancel (SDK buffering emulation) — push more.
		stream.push(makeProvider({ id: "late" }).provider)
		await flush()
		expect(s.discoveredWallets.value).toHaveLength(0)
		expect(s.status.value).toBe("idle")
	})
})

describe("selection", () => {
	it("selectWallet drives the unchanged chain to connected and persists ONLY then", async () => {
		const { provider } = makeProvider()
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(provider)
		await flush()

		s.selectWallet(s.discoveredWallets.value[0].key)
		expect(s.status.value).toBe("verifying") // synchronous transition
		expect(localStorage.getItem("test-app:preferred-wallet")).toBeNull()
		await flush()
		expect(stream.cancel).toHaveBeenCalled()
		expect(s.verificationEmojis.value).toBe("🟢🔵🟡🟣🔴⚪⚫🟠🟤")

		await s.confirmVerification()
		expect(s.status.value).toBe("connected")
		expect(JSON.parse(localStorage.getItem("test-app:preferred-wallet") ?? "{}")).toEqual({ id: "nulo", name: "Nulo" })
	})

	it("double selectWallet is one flow (second call no-ops)", async () => {
		const a = makeProvider({ id: "a" })
		const b = makeProvider({ id: "b", name: "B" })
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(a.provider)
		stream.push(b.provider)
		await flush()

		const [rowA, rowB] = s.discoveredWallets.value
		s.selectWallet(rowA.key)
		s.selectWallet(rowB.key) // status is already "verifying" — must no-op
		await flush()
		expect(a.provider.establishSecureChannel).toHaveBeenCalledTimes(1)
		expect(b.provider.establishSecureChannel).not.toHaveBeenCalled()
	})

	it("onDisconnect subscribes AFTER confirm (the pre-existing no-op-subscription bug stays fixed)", async () => {
		const { provider } = makeProvider()
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()
		expect(provider.onDisconnect).not.toHaveBeenCalled()
		await s.confirmVerification()
		expect(provider.onDisconnect).toHaveBeenCalledTimes(1)
	})

	it("stale-provider establish failure discards providers and surfaces a retryable error", async () => {
		const bad = makeProvider()
		bad.provider.establishSecureChannel.mockRejectedValue(new Error("port closed"))
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(bad.provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()
		expect(s.status.value).toBe("error")
		expect(s.discoveredWallets.value).toHaveLength(0)

		// Retry re-discovers from scratch (never reuses the stale object).
		stream = makeStream()
		mockGetAvailableWallets.mockImplementation(() => ({ wallets: stream.wallets, cancel: stream.cancel }))
		void s.connect()
		await flush()
		expect(mockGetAvailableWallets).toHaveBeenCalledTimes(2)
	})
})

describe("stale-epoch SDK cleanup (results discarded AND side effects undone)", () => {
	it("a stale establish resolution cancels the pending connection", async () => {
		const { provider, pending } = makeProvider()
		type Pending = ReturnType<typeof makeProvider>["pending"]
		let resolveEstablish: (p: Pending) => void = () => {}
		provider.establishSecureChannel.mockImplementation(() => new Promise<Pending>((res) => (resolveEstablish = res)))
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()

		await s.cancelVerification() // bumps the epoch while establish is in flight
		expect(s.status.value).toBe("idle")
		resolveEstablish(pending)
		await flush()
		expect(pending.cancel).toHaveBeenCalled()
		expect(s.verificationEmojis.value).toBeNull()
	})

	it("a stale confirm disconnects the provider and a stale flow cannot release a newer flow's lock", async () => {
		const first = makeProvider({ id: "first" })
		let resolveConfirm: (w: unknown) => void = () => {}
		first.pending.confirm.mockImplementation(() => new Promise((res) => (resolveConfirm = res)))
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(first.provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()
		const confirming = s.confirmVerification()

		await s.disconnect() // stale-ifies the confirm continuation, releases the flow

		// A NEW flow acquires the lock — the stale confirm resolving must not break it.
		stream = makeStream()
		mockGetAvailableWallets.mockImplementation(() => ({ wallets: stream.wallets, cancel: stream.cancel }))
		const second = makeProvider({ id: "second", name: "Second" })
		void s.connect()
		await flush()
		stream.push(second.provider)
		await flush()
		expect(s.status.value).toBe("choosing")

		resolveConfirm(first.walletHandle)
		await confirming
		expect(first.provider.disconnect).toHaveBeenCalled()
		expect(s.status.value).toBe("choosing") // newer flow untouched
		expect(s.wallet.value).toBeNull()
		expect(localStorage.getItem("test-app:preferred-wallet")).toBeNull() // never persisted
	})
})

describe("remembered path (bounded ambiguity window)", () => {
	function remember(id = "nulo", name = "Nulo") {
		localStorage.setItem("test-app:preferred-wallet", JSON.stringify({ id, name }))
	}

	it("a sole claimant surviving the 1s window auto-connects (discovery cancelled, no picker)", async () => {
		vi.useFakeTimers()
		remember()
		const { provider } = makeProvider()
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(provider)
		await flush()
		expect(s.status.value).toBe("discovering") // no picker while the window runs

		await vi.advanceTimersByTimeAsync(1_000)
		await flush()
		expect(s.status.value).toBe("verifying")
		expect(stream.cancel).toHaveBeenCalled()
	})

	it("a second claimant inside the window forces the picker and disables auto-reconnect", async () => {
		vi.useFakeTimers()
		remember()
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(makeProvider({ id: "nulo" }).provider)
		await flush()
		stream.push(makeProvider({ id: "nulo", name: "Nulo" }).provider) // impostor (or vice versa)
		await flush()
		expect(s.status.value).toBe("choosing")
		expect(s.discoveredWallets.value).toHaveLength(2)

		await vi.advanceTimersByTimeAsync(2_000)
		expect(s.status.value).toBe("choosing") // the dead window never fires the auto path

		// Auto-reconnect stays off for the session: a fresh connect goes straight to choosing.
		s.cancelChoice()
		stream = makeStream()
		mockGetAvailableWallets.mockImplementation(() => ({ wallets: stream.wallets, cancel: stream.cancel }))
		void s.connect()
		await flush()
		stream.push(makeProvider({ id: "nulo" }).provider)
		await flush()
		await vi.advanceTimersByTimeAsync(1_500)
		expect(s.status.value).toBe("choosing")
	})

	it("the ambiguity-window timer is inert after disconnect (epoch-owned)", async () => {
		// Note: manual selection cannot race the window by construction — the
		// picker is not rendered while the window runs (status stays
		// "discovering"), and selectWallet guards on "choosing". Disconnect is
		// the interruption that CAN land mid-window.
		vi.useFakeTimers()
		remember("nulo")
		const nulo = makeProvider({ id: "nulo" })
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(nulo.provider) // opens the window; status stays "discovering"
		await flush()
		expect(s.status.value).toBe("discovering")

		await s.disconnect()
		expect(s.status.value).toBe("idle")
		await vi.advanceTimersByTimeAsync(2_000)
		await flush()
		expect(nulo.provider.establishSecureChannel).not.toHaveBeenCalled()
		expect(s.status.value).toBe("idle")
	})

	it("remembered-path failure clears the stored preference and lands in error; retry is fresh", async () => {
		vi.useFakeTimers()
		remember()
		const bad = makeProvider()
		bad.provider.establishSecureChannel.mockRejectedValue(new Error("wallet gone"))
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(bad.provider)
		await flush()
		await vi.advanceTimersByTimeAsync(1_000)
		await flush()
		expect(s.status.value).toBe("error")
		expect(localStorage.getItem("test-app:preferred-wallet")).toBeNull()
		expect(s.preferredWalletName.value).toBeNull()
	})

	it("discovery ending BEFORE the window fires resolves the sole claimant immediately", async () => {
		vi.useFakeTimers()
		remember()
		const { provider } = makeProvider()
		const s = makeSession()
		const c = s.connect()
		await flush()
		stream.push(provider)
		await flush()
		stream.end() // natural end at ~0ms — well before the 1s window
		await c
		expect(s.status.value).toBe("verifying")
	})

	it("throwing localStorage never corrupts a session (best-effort everywhere)", async () => {
		const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("storage dead")
		})
		const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("storage dead")
		})
		try {
			const { provider } = makeProvider()
			const s = makeSession()
			void s.connect()
			await flush()
			stream.push(provider)
			await flush()
			expect(s.status.value).toBe("choosing") // unreadable preference = fresh path
			s.selectWallet(s.discoveredWallets.value[0].key)
			await flush()
			await s.confirmVerification()
			expect(s.status.value).toBe("connected") // unwritable preference = still connected
		} finally {
			getItem.mockRestore()
			setItem.mockRestore()
		}
	})

	it("forgetPreferredWallet clears the stored choice and the reactive name", async () => {
		remember("nulo", "Nulo")
		const s = makeSession()
		expect(s.preferredWalletName.value).toBe("Nulo")
		s.forgetPreferredWallet()
		expect(s.preferredWalletName.value).toBeNull()
		expect(localStorage.getItem("test-app:preferred-wallet")).toBeNull()
	})
})
