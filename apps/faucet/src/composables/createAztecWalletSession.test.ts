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

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest"

vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))
vi.mock("@/lib/chain-info", () => ({ readChainInfo: () => ({ chainId: 1 }) }))
vi.mock("@/lib/emoji", () => ({ hashToEmoji: () => "🟢🔵🟡🟣🔴⚪⚫🟠🟤" }))

const mockGetAvailableWallets = vi.fn()
vi.mock("@aztec/wallet-sdk/manager", () => ({
	WalletManager: {
		configure: vi.fn(() => ({ getAvailableWallets: mockGetAvailableWallets })),
	},
}))

import { createAztecWalletSession, type DiscoveredWallet, parseGrantedAccounts } from "./createAztecWalletSession"

// ── Push-driven discovery stream ─────────────────────────────────────

type AnyProvider = Record<string, unknown>

// Full-length canonical address: the hardened parser rejects short fakes (32-byte hex required).
const ADDR_MAIN = `0x${"a1".padStart(64, "0")}`

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
		requestCapabilities: vi.fn(async () => ({ granted: [{ type: "accounts", accounts: [{ alias: "Main", item: ADDR_MAIN }] }] })),
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
		// Fresh path: the picker is open BEFORE any wallet answers (a wallet's
		// discovery-approval prompt can gate the first announcement).
		expect(s.pickerOpen.value).toBe(true)

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

	it("cancel from the empty scanning state (no announcements yet) returns to idle", async () => {
		const s = makeSession()
		void s.connect()
		await flush()
		expect(s.pickerOpen.value).toBe(true)
		expect(s.discoveredWallets.value).toHaveLength(0)
		s.cancelChoice()
		expect(s.status.value).toBe("idle")
		expect(s.pickerOpen.value).toBe(false)
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

describe("audit round: flow-ownership + interruption hardening", () => {
	it("retryCapabilities is a no-op while the initial capability request is in flight", async () => {
		const { provider, walletHandle } = makeProvider()
		type CapsResult = Awaited<ReturnType<typeof walletHandle.requestCapabilities>>
		let resolveCaps: (v: CapsResult) => void = () => {}
		walletHandle.requestCapabilities.mockImplementation(() => new Promise<CapsResult>((res) => (resolveCaps = res)))
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()
		const confirming = s.confirmVerification()
		await flush()
		expect(s.status.value).toBe("capability-approval")

		await s.retryCapabilities() // flow is owned — must not start a second request
		expect(walletHandle.requestCapabilities).toHaveBeenCalledTimes(1)

		resolveCaps({ granted: [{ type: "accounts", accounts: [{ alias: "Main", item: ADDR_MAIN }] }] })
		await confirming
		expect(s.status.value).toBe("connected")
	})

	it("a wallet-side disconnect DURING setup wipes the flow — the late continuation cannot set connected", async () => {
		const { provider } = makeProvider()
		let firedDisconnect: (() => void) | null = null
		provider.onDisconnect = vi.fn((handler: () => void) => {
			firedDisconnect = handler
			return () => {}
		}) as typeof provider.onDisconnect
		let resolveRegister: () => void = () => {}
		const registerContracts = vi.fn(() => new Promise<void>((res) => (resolveRegister = res)))
		const s = createAztecWalletSession({ appId: "test-app", buildManifest: async () => ({}), registerContracts })
		void s.connect()
		await flush()
		stream.push(provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()
		const confirming = s.confirmVerification()
		await flush(8)
		expect(s.status.value).toBe("setting-up")

		;(firedDisconnect as (() => void) | null)?.() // remote interruption mid-registerContracts
		expect(s.status.value).toBe("idle")
		resolveRegister()
		await confirming
		expect(s.status.value).toBe("idle") // NOT "connected" over wiped state
		expect(s.wallet.value).toBeNull()
		expect(localStorage.getItem("test-app:preferred-wallet")).toBeNull()
	})

	it("connect() after a capability failure sweeps the retained provider session", async () => {
		const { provider, walletHandle } = makeProvider()
		walletHandle.requestCapabilities.mockRejectedValueOnce(new Error("boom"))
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()
		await s.confirmVerification()
		expect(s.status.value).toBe("error")
		expect(provider.disconnect).not.toHaveBeenCalled()

		stream = makeStream()
		mockGetAvailableWallets.mockImplementation(() => ({ wallets: stream.wallets, cancel: stream.cancel }))
		void s.connect() // "Retry connection" — must disconnect the retained session first
		await flush()
		expect(provider.disconnect).toHaveBeenCalledTimes(1)
	})

	it("buffered yields after selectWallet do NOT grow the list during verification", async () => {
		const { provider } = makeProvider()
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()
		expect(s.status.value).toBe("verifying")
		// The cancel-emulating stream still delivers a buffered straggler:
		stream.push(makeProvider({ id: "straggler", name: "Straggler" }).provider)
		await flush()
		expect(s.discoveredWallets.value).toHaveLength(1)
	})

	it("remembered id ABSENT: non-claimant wallets show in the picker after the window, not after 60s", async () => {
		vi.useFakeTimers()
		localStorage.setItem("test-app:preferred-wallet", JSON.stringify({ id: "gone-wallet", name: "Gone" }))
		const other = makeProvider({ id: "acme", name: "Acme", type: "web" })
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(other.provider) // non-claimant — opens the window anyway
		await flush()
		expect(s.status.value).toBe("discovering")

		await vi.advanceTimersByTimeAsync(1_000)
		await flush()
		expect(s.status.value).toBe("choosing") // picker, not a 60s black hole
		expect(s.discoveredWallets.value).toHaveLength(1)
	})
})

describe("tri-audit round pins", () => {
	it("double confirmVerification is ONE confirm (pending claimed synchronously)", async () => {
		const { provider, pending } = makeProvider()
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()

		const a = s.confirmVerification()
		const b = s.confirmVerification() // same tick — must observe the claimed pending and no-op
		await Promise.all([a, b])
		expect(pending.confirm).toHaveBeenCalledTimes(1)
		expect(s.status.value).toBe("connected")
	})

	it("the swept-away session's onDisconnect firing later cannot wipe the replacement flow", async () => {
		const first = makeProvider()
		let firstDisconnectHandler: (() => void) | null = null
		first.provider.onDisconnect = vi.fn((handler: () => void) => {
			firstDisconnectHandler = handler
			return () => {
				firstDisconnectHandler = null
			}
		}) as typeof first.provider.onDisconnect
		first.walletHandle.requestCapabilities.mockRejectedValueOnce(new Error("boom"))
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(first.provider)
		await flush()
		s.selectWallet(s.discoveredWallets.value[0].key)
		await flush()
		await s.confirmVerification()
		expect(s.status.value).toBe("error")

		// Re-entry sweeps the residue AND unsubscribes — the captured old
		// callback must already be dead (or, if the SDK still fires it, inert).
		stream = makeStream()
		mockGetAvailableWallets.mockImplementation(() => ({ wallets: stream.wallets, cancel: stream.cancel }))
		void s.connect()
		await flush()
		stream.push(makeProvider({ id: "second", name: "Second" }).provider)
		await flush()
		expect(s.status.value).toBe("choosing")

		;(firstDisconnectHandler as (() => void) | null)?.()
		expect(s.status.value).toBe("choosing") // replacement flow untouched
		expect(s.discoveredWallets.value).toHaveLength(1)
	})

	it("truncateName is code-point-safe (no split surrogate pairs)", async () => {
		const { truncateName } = await import("./createAztecWalletSession")
		const emojiName = "🦊".repeat(50)
		const out = truncateName(emojiName, 48)
		expect(out.endsWith("…")).toBe(true)
		expect(Array.from(out)).toHaveLength(49) // 48 points + ellipsis
		expect(out.includes("\uFFFD")).toBe(false)
		expect(truncateName("short", 48)).toBe("short")
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

		const disconnectsBefore = first.provider.disconnect.mock.calls.length
		resolveConfirm(first.walletHandle)
		await confirming
		// The stale confirm's cleanup targets its CAPTURED provider (a fresh
		// call beyond disconnect()'s own), never the newer flow's provider.
		expect(first.provider.disconnect.mock.calls.length).toBe(disconnectsBefore + 1)
		expect(second.provider.disconnect).not.toHaveBeenCalled()
		expect(s.status.value).toBe("choosing") // newer flow untouched
		expect(s.wallet.value).toBeNull()
		expect(localStorage.getItem("test-app:preferred-wallet")).toBeNull() // never persisted
	})
})

describe("remembered path (bounded ambiguity window)", () => {
	function remember(id = "nulo", name = "Nulo") {
		localStorage.setItem("test-app:preferred-wallet", JSON.stringify({ id, name }))
	}

	it("switchWallet forces the picker and KEEPS the stored preference on cancel", async () => {
		remember()
		const s = makeSession()
		void s.switchWallet()
		await flush()
		expect(s.status.value).toBe("discovering")
		expect(s.pickerOpen.value).toBe(true) // forced: the remembered id is ignored for this flow

		stream.push(makeProvider({ id: "acmewallet", name: "Acme", type: "web" }).provider)
		await flush()
		expect(s.status.value).toBe("choosing") // no ambiguity window on the forced path

		s.cancelChoice()
		// Cancelling the forced picker must not cost the user their remembered wallet.
		expect(localStorage.getItem("test-app:preferred-wallet")).toContain("nulo")
		expect(s.preferredWalletName.value).toBe("Nulo")
	})

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
		expect(s.pickerOpen.value).toBe(false) // remembered attempt: no picker flash

		await vi.advanceTimersByTimeAsync(1_000)
		await flush()
		expect(s.status.value).toBe("verifying")
		expect(s.pickerOpen.value).toBe(false)
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
		expect(s.pickerOpen.value).toBe(true) // forced open on the collision
		expect(s.autoReconnectDisabled.value).toBe(true) // reactive: the split button must stop promising the name
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

// ── Multi-account: choose-on-connect pause, per-wallet memory, switching ─────

function addr(suffix: string): string {
	return `0x${suffix.padStart(64, "0")}`
}
const MA_A = addr("aa")
const MA_B = addr("bb")
const MA_C = addr("cc")
const SELECTED_KEY = "test-app:selected-accounts"

type GrantEntry = { alias?: unknown; item?: unknown } | null

function makeMultiProvider(opts: { id?: string; accounts?: GrantEntry[] } = {}) {
	const walletHandle = {
		requestCapabilities: vi.fn(async () => ({
			granted: [
				{
					type: "accounts",
					accounts: opts.accounts ?? [
						{ alias: "Main", item: MA_A },
						{ alias: "Savings", item: MA_B },
					],
				},
			],
		})),
	}
	const pending = {
		verificationHash: "deadbeef",
		confirm: vi.fn(async () => walletHandle),
		cancel: vi.fn(async () => {}),
	}
	let disconnectHandler: (() => void) | null = null
	const provider = {
		id: opts.id ?? "nulo",
		name: "Nulo",
		type: "extension",
		icon: undefined,
		establishSecureChannel: vi.fn(async () => pending),
		disconnect: vi.fn(async () => {}),
		onDisconnect: vi.fn((h: () => void) => {
			disconnectHandler = h
			return () => {
				disconnectHandler = null
			}
		}),
	}
	return { provider, pending, walletHandle, fireDisconnect: () => disconnectHandler?.() }
}

function makeSessionWith(over: { registerContracts?: Mock<() => Promise<void>>; isSwitchBlocked?: () => boolean } = {}) {
	const registerContracts = over.registerContracts ?? vi.fn(async () => {})
	const session = createAztecWalletSession({
		appId: "test-app",
		buildManifest: async () => ({}),
		registerContracts,
		isSwitchBlocked: over.isSwitchBlocked,
	})
	return { session, registerContracts }
}

/** Fresh-path drive to the end of the capability handshake (grant applied or paused). */
async function driveThroughGrant(s: ReturnType<typeof makeSessionWith>["session"], provider: Record<string, unknown>) {
	void s.connect()
	await flush()
	stream.push(provider)
	await flush()
	s.selectWallet(s.discoveredWallets.value[0].key)
	await flush()
	await s.confirmVerification()
}

function storedMap(): Array<[string, string]> {
	return JSON.parse(localStorage.getItem(SELECTED_KEY) ?? "[]")
}

describe("multi-account: choose-on-connect", () => {
	it("two accounts, nothing remembered → pauses in choosing-account; confirm resumes, persists, connects", async () => {
		const { provider, walletHandle } = makeMultiProvider()
		const { session: s, registerContracts } = makeSessionWith()
		await driveThroughGrant(s, provider)

		expect(s.status.value).toBe("choosing-account")
		expect(s.accounts.value).toHaveLength(2)
		expect(s.selectedAccount.value).toBeNull()
		expect(registerContracts).not.toHaveBeenCalled()
		expect(walletHandle.requestCapabilities).toHaveBeenCalledTimes(1)

		await s.confirmAccountChoice(MA_B)
		expect(s.status.value).toBe("connected")
		expect(s.selectedAccount.value).toBe(MA_B)
		expect(registerContracts).toHaveBeenCalledTimes(1)
		expect(storedMap()).toEqual([["nulo", MA_B]])
		// The preferred WALLET is persisted only on full success (existing rule, now via finishSetup).
		expect(JSON.parse(localStorage.getItem("test-app:preferred-wallet") ?? "{}")).toEqual({ id: "nulo", name: "Nulo" })
	})

	it("a single granted account skips the choice step and is remembered (D-6)", async () => {
		const { provider } = makeMultiProvider({ accounts: [{ alias: "Only", item: MA_A }] })
		const { session: s } = makeSessionWith()
		await driveThroughGrant(s, provider)

		expect(s.status.value).toBe("connected")
		expect(s.selectedAccount.value).toBe(MA_A)
		expect(storedMap()).toEqual([["nulo", MA_A]])
		expect(s.consumeSelectionNotices()).toEqual([])
	})

	it("a valid remembered choice skips the modal and emits exactly one auto-remembered notice", async () => {
		localStorage.setItem(SELECTED_KEY, JSON.stringify([["nulo", MA_B]]))
		const { provider } = makeMultiProvider()
		const { session: s } = makeSessionWith()
		await driveThroughGrant(s, provider)

		expect(s.status.value).toBe("connected")
		expect(s.selectedAccount.value).toBe(MA_B)
		const notices = s.consumeSelectionNotices()
		expect(notices).toHaveLength(1)
		expect(notices[0]).toMatchObject({ kind: "auto-remembered", address: MA_B, alias: "Savings" })
		expect(s.consumeSelectionNotices()).toEqual([]) // drained exactly once
	})

	it("a remembered address missing from the live grant re-opens the choice", async () => {
		localStorage.setItem(SELECTED_KEY, JSON.stringify([["nulo", MA_C]]))
		const { provider } = makeMultiProvider()
		const { session: s } = makeSessionWith()
		await driveThroughGrant(s, provider)
		expect(s.status.value).toBe("choosing-account")
	})

	it("a choice remembered under a DIFFERENT wallet id does not apply", async () => {
		localStorage.setItem(SELECTED_KEY, JSON.stringify([["other-wallet", MA_B]]))
		const { provider } = makeMultiProvider()
		const { session: s } = makeSessionWith()
		await driveThroughGrant(s, provider)
		expect(s.status.value).toBe("choosing-account")
	})

	it("per-wallet memory is a map: a second wallet's choice keeps the first wallet's entry (A→B→A)", async () => {
		localStorage.setItem(SELECTED_KEY, JSON.stringify([["w1", MA_A]]))
		const { provider } = makeMultiProvider({
			id: "w2",
			accounts: [
				{ alias: "B", item: MA_B },
				{ alias: "C", item: MA_C },
			],
		})
		const { session: s } = makeSessionWith()
		await driveThroughGrant(s, provider)
		await s.confirmAccountChoice(MA_C)
		expect(s.status.value).toBe("connected")
		expect(storedMap()).toEqual([
			["w2", MA_C],
			["w1", MA_A],
		])
	})

	it("oversized wallet ids are refused on WRITE — no quota churn from hostile provider ids (D-23)", async () => {
		const hugeId = "w".repeat(300)
		const { provider } = makeMultiProvider({ id: hugeId, accounts: [{ alias: "Only", item: MA_A }] })
		const { session: s } = makeSessionWith()
		await driveThroughGrant(s, provider)
		expect(s.status.value).toBe("connected") // selection still applies in-session
		expect(localStorage.getItem(SELECTED_KEY)).toBeNull() // but nothing was persisted
	})

	it("the memory is bounded: writing a 9th wallet evicts the oldest entry", async () => {
		const seeded: Array<[string, string]> = Array.from({ length: 8 }, (_, i) => [`w${i + 1}`, MA_A])
		localStorage.setItem(SELECTED_KEY, JSON.stringify(seeded))
		const { provider } = makeMultiProvider({ id: "w9", accounts: [{ alias: "Only", item: MA_B }] })
		const { session: s } = makeSessionWith()
		await driveThroughGrant(s, provider)
		const map = storedMap()
		expect(map).toHaveLength(8)
		expect(map[0]).toEqual(["w9", MA_B])
		expect(map.some(([id]) => id === "w8")).toBe(false)
	})

	it("cancelAccountChoice wipes to idle and disconnects the CAPTURED provider", async () => {
		const { provider } = makeMultiProvider()
		const { session: s, registerContracts } = makeSessionWith()
		await driveThroughGrant(s, provider)
		expect(s.status.value).toBe("choosing-account")

		await s.cancelAccountChoice()
		expect(s.status.value).toBe("idle")
		expect(s.accounts.value).toEqual([])
		expect(provider.disconnect).toHaveBeenCalled()
		expect(registerContracts).not.toHaveBeenCalled()
	})

	it("a wallet-side disconnect during the choice closes the pause; the late confirm is a no-op", async () => {
		const { provider, fireDisconnect } = makeMultiProvider()
		const { session: s, registerContracts } = makeSessionWith()
		await driveThroughGrant(s, provider)
		expect(s.status.value).toBe("choosing-account")

		fireDisconnect()
		expect(s.status.value).toBe("idle")
		await s.confirmAccountChoice(MA_A)
		expect(s.status.value).toBe("idle")
		expect(registerContracts).not.toHaveBeenCalled()
	})

	it("double confirmAccountChoice runs setup ONCE (token claimed synchronously)", async () => {
		let resolveSetup: () => void = () => {}
		const registerContracts = vi.fn(
			() =>
				new Promise<void>((res) => {
					resolveSetup = res
				}),
		)
		const { provider } = makeMultiProvider()
		const { session: s } = makeSessionWith({ registerContracts })
		await driveThroughGrant(s, provider)

		const first = s.confirmAccountChoice(MA_A)
		const second = s.confirmAccountChoice(MA_B) // loses the synchronous claim → no-op
		resolveSetup()
		await Promise.all([first, second])

		expect(s.status.value).toBe("connected")
		expect(s.selectedAccount.value).toBe(MA_A)
		expect(registerContracts).toHaveBeenCalledTimes(1)
	})

	it("setup failure after confirm → error; retryCapabilities auto-applies the persisted choice without re-prompting (D-20)", async () => {
		const registerContracts = vi.fn(async () => {}).mockRejectedValueOnce(new Error("PXE unavailable"))
		const { provider, walletHandle } = makeMultiProvider()
		const { session: s } = makeSessionWith({ registerContracts })
		await driveThroughGrant(s, provider)

		await s.confirmAccountChoice(MA_B)
		expect(s.status.value).toBe("error")
		expect(storedMap()).toEqual([["nulo", MA_B]]) // persisted AT selection time

		await s.retryCapabilities()
		expect(walletHandle.requestCapabilities).toHaveBeenCalledTimes(2)
		expect(s.status.value).toBe("connected") // remembered hit — never paused again
		expect(s.selectedAccount.value).toBe(MA_B)
	})

	it("a throwing localStorage never blocks the choice flow (best-effort persistence)", async () => {
		const { provider } = makeMultiProvider()
		const { session: s } = makeSessionWith()
		await driveThroughGrant(s, provider)
		const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("QuotaExceededError")
		})
		try {
			await s.confirmAccountChoice(MA_A)
			expect(s.status.value).toBe("connected")
			expect(s.selectedAccount.value).toBe(MA_A)
		} finally {
			setItem.mockRestore()
		}
	})

	it("an oversized grant is truncated WITH a disclosed notice; cancel clears pending notices", async () => {
		const seventeen: GrantEntry[] = Array.from({ length: 17 }, (_, i) => ({
			alias: `Acct ${i}`,
			item: addr((i + 1).toString(16)),
		}))
		const { provider } = makeMultiProvider({ accounts: seventeen })
		const { session: s } = makeSessionWith()
		await driveThroughGrant(s, provider)

		expect(s.status.value).toBe("choosing-account")
		expect(s.accounts.value).toHaveLength(16)
		expect(s.selectionNotices.value).toEqual([expect.objectContaining({ kind: "grant-truncated", hiddenCount: 1 })])

		await s.cancelAccountChoice() // wipe (cleanupSession) must clear undrained notices
		expect(s.selectionNotices.value).toEqual([])
	})
})

describe("multi-account: switching (selectAccount)", () => {
	async function connectedSession(over: Parameters<typeof makeSessionWith>[0] = {}) {
		const made = makeMultiProvider()
		const built = makeSessionWith(over)
		await driveThroughGrant(built.session, made.provider)
		await built.session.confirmAccountChoice(MA_A)
		expect(built.session.status.value).toBe("connected")
		return { ...made, ...built }
	}

	it("switches to another granted account, persists it, and returns true", async () => {
		const { session: s } = await connectedSession()
		expect(s.selectAccount(MA_B)).toBe(true)
		expect(s.selectedAccount.value).toBe(MA_B)
		expect(storedMap()).toEqual([["nulo", MA_B]])
	})

	it("rejects an address outside the live grant", async () => {
		const { session: s } = await connectedSession()
		expect(s.selectAccount(MA_C)).toBe(false)
		expect(s.selectedAccount.value).toBe(MA_A)
	})

	it("rejects when not connected", async () => {
		const { session: s } = await connectedSession()
		await s.disconnect()
		expect(s.selectAccount(MA_B)).toBe(false)
	})

	it("isSwitchBlocked gates the mutation boundary itself (D-18)", async () => {
		let blocked = true
		const { session: s } = await connectedSession({ isSwitchBlocked: () => blocked })
		expect(s.selectAccount(MA_B)).toBe(false)
		expect(s.selectedAccount.value).toBe(MA_A)
		blocked = false
		expect(s.selectAccount(MA_B)).toBe(true)
		expect(s.selectedAccount.value).toBe(MA_B)
	})
})

describe("parseGrantedAccounts hardening", () => {
	it("skips malformed, short, above-modulus, and throwing entries without crashing", () => {
		const { accounts, hiddenCount } = parseGrantedAccounts({
			granted: [
				{
					type: "accounts",
					accounts: [
						{ alias: "ok", item: MA_A },
						{ alias: "short", item: "0xa1" },
						{ alias: "junk", item: "0xzz" },
						{ alias: "overflow", item: `0x${"ff".repeat(32)}` },
						{
							alias: "thrower",
							item: {
								toString: () => {
									throw new Error("boom")
								},
							},
						},
						null,
						{ alias: "no-item" },
					],
				},
			],
		})
		expect(accounts).toEqual([{ address: MA_A, alias: "ok" }])
		expect(hiddenCount).toBe(0)
	})

	it("canonicalizes case/prefix and dedupes by canonical address (first wins)", () => {
		const upper = `0x${"aa".padStart(64, "0")}`.toUpperCase().replace("0X", "0x")
		const { accounts } = parseGrantedAccounts({
			granted: [
				{
					type: "accounts",
					accounts: [
						{ alias: "first", item: upper },
						{ alias: "dup", item: MA_A },
					],
				},
			],
		})
		expect(accounts).toEqual([{ address: MA_A, alias: "first" }])
	})

	it("sanitizes aliases: control/bidi characters stripped, length capped, non-strings emptied", () => {
		const { accounts } = parseGrantedAccounts({
			granted: [
				{
					type: "accounts",
					accounts: [
						{ alias: "Sav‮ings⁦", item: MA_A },
						{ alias: "x".repeat(60), item: MA_B },
						{ alias: 42, item: MA_C },
					],
				},
			],
		})
		expect(accounts[0].alias).toBe("Savings")
		expect(accounts[1].alias).toBe(`${"x".repeat(48)}…`)
		expect(accounts[2].alias).toBe("")
	})

	it("accepts a PROVABLY curve-invalid (but syntactic) address — the documented boundary (D-30)", () => {
		// 0x…03 is NOT a valid Grumpkin x-coordinate: `AztecAddress.fromStringUnsafe(addr("3")).isValid()`
		// returns false (verified out-of-band with bun — isValid needs the Barretenberg WASM,
		// which this jsdom suite deliberately does not boot; 0x…02 and 0x…05 ARE valid, so the
		// fixture choice matters). It still round-trips fromStringUnsafe: the parser performs
		// syntactic validation ONLY. Authorization is enforced wallet-side per RPC; a send
		// involving such an address surfaces through the normal error path.
		const curveInvalid = addr("3")
		const { accounts } = parseGrantedAccounts({
			granted: [{ type: "accounts", accounts: [{ alias: "edge", item: curveInvalid }] }],
		})
		expect(accounts).toEqual([{ address: curveInvalid, alias: "edge" }])
	})

	it("caps the list at 16 and reports the hidden remainder", () => {
		const entries = Array.from({ length: 20 }, (_, i) => ({ alias: `a${i}`, item: addr((i + 1).toString(16)) }))
		const { accounts, hiddenCount } = parseGrantedAccounts({ granted: [{ type: "accounts", accounts: entries }] })
		expect(accounts).toHaveLength(16)
		expect(hiddenCount).toBe(4)
	})
})
