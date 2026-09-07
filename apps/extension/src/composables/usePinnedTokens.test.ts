/**
 * Pin store over an in-memory `chrome.storage.local` with a working `onChanged`. Covers the hostile
 * read path, the cap against the known token set, scope capture, deletion cleanup on another
 * profile, serialised writes, and disposal.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { nextTick, reactive } from "vue"
import { pinnedTokensKey } from "@/popup/constants/storage-keys"
import { PINNED_TOKENS_MAX_CHAINS, type PinScope, sanitizePinMap, usePinnedTokens } from "./usePinnedTokens"

type Change = Record<string, { oldValue?: unknown; newValue?: unknown }>
type Listener = (changes: Change, area: string) => void

function memoryStorage() {
	const data = new Map<string, unknown>()
	const listeners = new Set<Listener>()
	let failNextSet = false
	let holding = false
	const held: Array<() => void> = []
	const local = {
		// The snapshot is taken at call time; while holding, a pin-map read waits for a release (the
		// facade's migration-flag read that precedes it is never held, so one read = one held entry).
		get: vi.fn(async (keys?: string | string[]) => {
			const list = typeof keys === "string" ? [keys] : (keys ?? [...data.keys()])
			const snapshot = Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]))
			if (holding && list.some((k) => k.startsWith("nulo:ui:pinnedTokens@"))) await new Promise<void>((r) => held.push(r))
			return snapshot
		}),
		set: vi.fn(async (items: Record<string, unknown>) => {
			if (failNextSet) {
				failNextSet = false
				throw new Error("quota")
			}
			const changes: Change = {}
			for (const [k, v] of Object.entries(items)) {
				changes[k] = { oldValue: data.get(k), newValue: v }
				data.set(k, v)
			}
			for (const l of [...listeners]) l(changes, "local")
		}),
	}
	const onChanged = {
		addListener: vi.fn((l: Listener) => listeners.add(l)),
		removeListener: vi.fn((l: Listener) => listeners.delete(l)),
	}
	return {
		data,
		listeners,
		local,
		onChanged,
		failNextSet: () => {
			failNextSet = true
		},
		/** Hold every `get` issued from now on; `release(i)` delivers the i-th held read, `releaseAll` the rest. */
		holdGets() {
			holding = true
			held.length = 0
			return {
				release: (i: number) => held[i]?.(),
				releaseAll: () => {
					holding = false
					for (const r of held.splice(0)) r()
				},
			}
		},
		/** Simulate another context's write: store + notify without going through `set`'s mock count. */
		external(key: string, value: unknown) {
			data.set(key, value)
			for (const l of [...listeners]) l({ [key]: { newValue: value } }, "local")
		},
	}
}

const addr = (n: number) => `0x${n.toString(16).padStart(64, "0")}`
const A = addr(0xa1)
const B = addr(0xb2)
const C = addr(0xc3)
const D = addr(0xd4)

const makeDeleted = () => {
	const handlers = new Set<(x: unknown) => void>()
	return {
		add: vi.fn((fn: (x: unknown) => void) => handlers.add(fn)),
		remove: vi.fn((fn: (x: unknown) => void) => handlers.delete(fn)),
		emit: (x: unknown) => {
			for (const fn of [...handlers]) fn(x)
		},
	}
}

let storage: ReturnType<typeof memoryStorage>
let deleted: ReturnType<typeof makeDeleted>
const state = reactive({ scope: undefined as PinScope | undefined })
let known: ReadonlySet<string> | undefined

// Let the queued op run (each awaits two facade calls, so a few macrotask hops).
const settle = async () => {
	for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
}

function make() {
	return usePinnedTokens({
		tokenService: { onTokenDeleted: deleted },
		getScope: () => state.scope,
		knownContracts: () => known,
	})
}

beforeEach(() => {
	storage = memoryStorage()
	deleted = makeDeleted()
	state.scope = { profileId: "p1", chainId: 7 }
	known = new Set([A, B, C, D])
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).local = storage.local
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).onChanged = storage.onChanged
})

describe("sanitizePinMap", () => {
	test("rejects every non-map root", () => {
		for (const raw of [undefined, null, 3, "x", [], [A]]) expect(sanitizePinMap(raw)).toEqual({})
	})

	test("drops non-canonical chain keys, non-array values, non-string and non-address entries", () => {
		expect(
			sanitizePinMap({
				"00": [A],
				"1e3": [A],
				"-1": [A],
				"12345678901234567": [A],
				"9999999999999999": [A],
				"7": "not-a-list",
				"8": [1, null, "0xzz", `0x${"a".repeat(63)}`, A.toUpperCase(), A, B],
			}),
		).toEqual({ "8": [A, B] })
	})

	test("caps a list at three and the map at 32 chains; an empty list is dropped", () => {
		const big: Record<string, string[]> = {}
		for (let i = 1; i <= PINNED_TOKENS_MAX_CHAINS + 2; i++) big[String(i)] = [A]
		big["999"] = []
		const out = sanitizePinMap({ ...big, "5": [A, B, C, D] })
		expect(Object.keys(out)).toHaveLength(PINNED_TOKENS_MAX_CHAINS)
		expect(out["5"]).toEqual([A, B, C])
		expect(out["999"]).toBeUndefined()
	})
})

describe("usePinnedTokens", () => {
	test("refresh reads the sanitized map and pins expose the current chain only", async () => {
		storage.data.set(pinnedTokensKey("p1"), { "7": [A.toUpperCase(), "junk", B], "8": [C] })
		const pins = make()
		await pins.refresh()
		expect([...pins.pinnedContracts.value]).toEqual([A, B])
		expect(pins.isPinned(A.toUpperCase())).toBe(true)
		expect(pins.isPinned(C)).toBe(false)
		state.scope = { profileId: "p1", chainId: 8 }
		expect([...pins.pinnedContracts.value]).toEqual([C])
		pins.dispose()
	})

	test("pin writes lowercase, returns pinned / already / full, and the write is the sanitized map", async () => {
		const pins = make()
		await pins.refresh()
		expect(await pins.pin(A.toUpperCase())).toBe("pinned")
		expect(await pins.pin(A)).toBe("already")
		expect(await pins.pin(B)).toBe("pinned")
		expect(await pins.pin(C)).toBe("pinned")
		expect(await pins.pin(D)).toBe("full")
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "7": [A, B, C] })
		expect([...pins.pinnedContracts.value]).toEqual([A, B, C])
		pins.dispose()
	})

	test("unpin removes the contract and drops an emptied chain key", async () => {
		storage.data.set(pinnedTokensKey("p1"), { "7": [A], "9": [B] })
		const pins = make()
		await pins.refresh()
		await pins.unpin(A)
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "9": [B] })
		expect(pins.pinnedContracts.value.size).toBe(0)
		pins.dispose()
	})

	test("the cap counts only known contracts once the set is loaded; dangling entries go on the next write", async () => {
		const dangling = [addr(1), addr(2), addr(3)]
		storage.data.set(pinnedTokensKey("p1"), { "7": dangling })
		const pins = make()
		await pins.refresh()
		expect(await pins.pin(A)).toBe("pinned")
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "7": [A] })
		pins.dispose()
	})

	test("while the token set is not loaded, stored entries count toward the cap and nothing is pruned", async () => {
		known = undefined
		storage.data.set(pinnedTokensKey("p1"), { "7": [addr(1), addr(2), addr(3)] })
		const pins = make()
		await pins.refresh()
		expect(await pins.pin(A)).toBe("full")
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "7": [addr(1), addr(2), addr(3)] })
		pins.dispose()
	})

	test("the known set is read at write time, so a token added after enqueue is not pruned", async () => {
		storage.data.set(pinnedTokensKey("p1"), { "7": [D] })
		known = new Set([A])
		const pins = make()
		await pins.refresh()
		const first = pins.pin(A)
		// D becomes known before the queued op reads the set.
		known = new Set([A, D])
		await first
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "7": [D, A] })
		pins.dispose()
	})

	test("an op enqueued under one scope and run after a switch is a no-op", async () => {
		const pins = make()
		await pins.refresh()
		const op = pins.pin(A)
		state.scope = { profileId: "p1", chainId: 8 }
		expect(await op).toBe("stale")
		expect(storage.data.has(pinnedTokensKey("p1"))).toBe(false)

		storage.data.set(pinnedTokensKey("p1"), { "8": [A] })
		const op2 = pins.unpin(A)
		state.scope = { profileId: "p1", chainId: 9 }
		await op2
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "8": [A] })
		expect(storage.local.set).not.toHaveBeenCalled()
		pins.dispose()
	})

	test("chains are isolated and a 33rd chain evicts the oldest other chain, keeping the new pin", async () => {
		const big: Record<string, string[]> = {}
		for (let i = 100; i < 100 + PINNED_TOKENS_MAX_CHAINS; i++) big[String(i)] = [B]
		storage.data.set(pinnedTokensKey("p1"), big)
		const pins = make()
		await pins.refresh()
		expect(await pins.pin(A)).toBe("pinned")
		await pins.refresh()
		const stored = storage.data.get(pinnedTokensKey("p1")) as Record<string, string[]>
		expect(Object.keys(stored)).toHaveLength(PINNED_TOKENS_MAX_CHAINS)
		expect(stored["7"]).toEqual([A])
		expect(stored["100"]).toBeUndefined()
		expect(stored["101"]).toEqual([B])
		expect([...pins.pinnedContracts.value]).toEqual([A])
		pins.dispose()
	})

	test("a deletion event for ANOTHER profile removes only that contract from that profile's chain", async () => {
		storage.data.set(pinnedTokensKey("p1"), { "7": [A] })
		storage.data.set(pinnedTokensKey("p2"), { "7": [A, B], "8": [A] })
		const pins = make()
		await pins.refresh()
		deleted.emit({ profileId: "p2", chainId: 7, contract: A.toUpperCase() })
		await settle()
		expect(storage.data.get(pinnedTokensKey("p2"))).toEqual({ "7": [B], "8": [A] })
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "7": [A] })
		expect([...pins.pinnedContracts.value]).toEqual([A])
		pins.dispose()
	})

	test("a deletion of a contract that is not pinned writes nothing", async () => {
		storage.data.set(pinnedTokensKey("p1"), { "7": [A] })
		const pins = make()
		await pins.refresh()
		deleted.emit({ profileId: "p1", chainId: 7, contract: B })
		await settle()
		expect(storage.local.set).not.toHaveBeenCalled()
		pins.dispose()
	})

	test("a deletion missed while disconnected is pruned by the next ordinary write", async () => {
		storage.data.set(pinnedTokensKey("p1"), { "7": [A, B] })
		known = new Set([A, C])
		const pins = make()
		await pins.refresh()
		await pins.unpin(A)
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({})
		pins.dispose()
	})

	test("concurrent pin and unpin in one context serialise to a consistent final state", async () => {
		const pins = make()
		await pins.refresh()
		const results = await Promise.all([pins.pin(A), pins.pin(B), pins.unpin(A), pins.pin(C), pins.pin(D)])
		expect(results).toEqual(["pinned", "pinned", undefined, "pinned", "pinned"])
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "7": [B, C, D] })
		pins.dispose()
	})

	test("a rejected write leaves the chain usable", async () => {
		const pins = make()
		await pins.refresh()
		storage.failNextSet()
		await expect(pins.pin(A)).rejects.toThrow("quota")
		expect(await pins.pin(B)).toBe("pinned")
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "7": [B] })
		pins.dispose()
	})

	test("another context's write to this profile's key triggers a re-read; dispose unsubscribes", async () => {
		const pins = make()
		await pins.refresh()
		storage.external(pinnedTokensKey("p1"), { "7": [C] })
		await settle()
		await nextTick()
		expect([...pins.pinnedContracts.value]).toEqual([C])

		pins.dispose()
		expect(storage.onChanged.removeListener).toHaveBeenCalledTimes(1)
		expect(deleted.remove).toHaveBeenCalledTimes(1)
		storage.external(pinnedTokensKey("p1"), { "7": [D] })
		await settle()
		expect([...pins.pinnedContracts.value]).toEqual([C])
	})

	test("a chain switch during the storage read makes the write a no-op: the old chain is never pruned", async () => {
		storage.data.set(pinnedTokensKey("p1"), { "7": [A, B] })
		known = new Set([C]) // the NEW chain's tokens: pruning with them would erase A and B
		const pins = make()
		await pins.refresh()
		const gate = storage.holdGets()
		const op = pins.pin(C)
		await new Promise((r) => setTimeout(r, 0))
		state.scope = { profileId: "p1", chainId: 8 }
		gate.releaseAll()
		expect(await op).toBe("stale")
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "7": [A, B] })
		expect(storage.local.set).not.toHaveBeenCalled()
		pins.dispose()
	})

	test("a write in flight when the instance is disposed lands nothing", async () => {
		const pins = make()
		await pins.refresh()
		const gate = storage.holdGets()
		const op = pins.pin(A)
		await new Promise((r) => setTimeout(r, 0))
		pins.dispose()
		gate.releaseAll()
		expect(await op).toBe("stale")
		expect(storage.local.set).not.toHaveBeenCalled()
	})

	test("an older refresh resolving after a newer one never rolls the pins back", async () => {
		storage.data.set(pinnedTokensKey("p1"), { "7": [A] })
		const pins = make()
		const gate = storage.holdGets()
		const first = pins.refresh() // its snapshot holds A
		await new Promise((r) => setTimeout(r, 0))
		storage.data.set(pinnedTokensKey("p1"), { "7": [B] })
		const second = pins.refresh() // its snapshot holds B
		await new Promise((r) => setTimeout(r, 0))
		gate.release(1)
		await second
		expect([...pins.pinnedContracts.value]).toEqual([B])
		gate.release(0)
		await first
		expect([...pins.pinnedContracts.value]).toEqual([B])
		gate.releaseAll()
		pins.dispose()
	})

	test("writes serialise across instances of the same profile: two pages pinning at once keep both", async () => {
		const page1 = make()
		const page2 = make()
		await Promise.all([page1.refresh(), page2.refresh()])
		expect(await Promise.all([page1.pin(A), page2.pin(B)])).toEqual(["pinned", "pinned"])
		expect(storage.data.get(pinnedTokensKey("p1"))).toEqual({ "7": [A, B] })
		page1.dispose()
		page2.dispose()
	})

	test("a profile switch needs refresh; until then the pins read empty, never the old profile's", async () => {
		storage.data.set(pinnedTokensKey("p1"), { "7": [A] })
		storage.data.set(pinnedTokensKey("p2"), { "7": [B] })
		const pins = make()
		await pins.refresh()
		state.scope = { profileId: "p2", chainId: 7 }
		expect(pins.pinnedContracts.value.size).toBe(0)
		await pins.refresh()
		expect([...pins.pinnedContracts.value]).toEqual([B])
		state.scope = undefined
		await pins.refresh()
		expect(pins.pinnedContracts.value.size).toBe(0)
		pins.dispose()
	})
})
