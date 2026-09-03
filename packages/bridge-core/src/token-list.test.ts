import { describe, expect, it, vi } from "vitest"
import type { KV } from "./journal"
import { loadTokenList, tokenListCacheKey } from "./token-list"

const CHAIN = 11_155_111
const KEY = tokenListCacheKey(CHAIN)
const ORIGIN = "https://example.invalid/list.json"

function memoryKv(seed: Record<string, string> = {}): KV & { store: Map<string, string>; removed: string[] } {
	const store = new Map(Object.entries(seed))
	const removed: string[] = []
	return {
		store,
		removed,
		getItem: (k) => store.get(k) ?? null,
		setItem: (k, v) => void store.set(k, v),
		removeItem: (k) => {
			removed.push(k)
			store.delete(k)
		},
	}
}

const entry = (address: string, over: Record<string, unknown> = {}) => ({
	chainId: CHAIN,
	address,
	name: `Token ${address.slice(2, 6)}`,
	symbol: "TKN",
	decimals: 18,
	...over,
})

const A = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaAaAaAaAaAaaAa"
const B = "0xbBbBBBBbbBBBbbbBbbBbbbbbBBbBbbbbBbBbbBBb"

/** A `Response` whose body only materializes chunk by chunk, so a byte cap can bite mid-stream. */
function streamResponse(body: string, opts: { status?: number; chunkSize?: number; pulls?: { count: number } } = {}): Response {
	const bytes = new TextEncoder().encode(body)
	const chunkSize = opts.chunkSize ?? bytes.length
	let offset = 0
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (opts.pulls) opts.pulls.count++
			if (offset >= bytes.length) return controller.close()
			controller.enqueue(bytes.slice(offset, offset + chunkSize))
			offset += chunkSize
		},
	})
	return new Response(stream, { status: opts.status ?? 200 })
}

const listBody = (tokens: unknown[]) => JSON.stringify({ name: "Test List", tokens })

const fetchReturning = (make: () => Response) => vi.fn(async () => make()) as unknown as typeof fetch

const cacheEntry = (fetchedAt: number, tokens: Record<string, unknown>[], chainId = CHAIN) =>
	JSON.stringify({ fetchedAt, chainId, tokens: tokens.map((t) => ({ chainId, decimals: 18, name: "Cached", symbol: "CACHE", ...t })) })

describe("loadTokenList", () => {
	it("fetches, narrows to the chain, and persists only the validated subset", async () => {
		const kv = memoryKv()
		const fetchImpl = fetchReturning(() => streamResponse(listBody([entry(A), entry(B, { chainId: 1 })])))
		const result = await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv, now: () => 1_000 })

		expect(result.provenance).toBe("fresh")
		expect(result.tokens).toEqual([{ chainId: CHAIN, address: A.toLowerCase(), name: "Token AAaA", symbol: "TKN", decimals: 18 }])
		expect(JSON.parse(kv.store.get(KEY) as string)).toEqual({ fetchedAt: 1_000, chainId: CHAIN, tokens: result.tokens })
	})

	it("passes redirect:error and an abort signal to fetch", async () => {
		const fetchImpl = fetchReturning(() => streamResponse(listBody([])))
		await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv: memoryKv(), origin: ORIGIN })
		const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit]
		expect(url).toBe(ORIGIN)
		expect(init.redirect).toBe("error")
		expect(init.signal).toBeInstanceOf(AbortSignal)
	})

	it("serves an unexpired cache without touching the network", async () => {
		const kv = memoryKv({ [KEY]: cacheEntry(1_000, [{ address: A.toLowerCase() }]) })
		const fetchImpl = fetchReturning(() => streamResponse(listBody([])))
		const result = await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv, now: () => 2_000, ttlMs: 5_000 })

		expect(result.provenance).toBe("cache")
		expect(result.tokens).toHaveLength(1)
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it("refetches once the cache is older than the ttl", async () => {
		const kv = memoryKv({ [KEY]: cacheEntry(1_000, [{ address: A.toLowerCase() }]) })
		const fetchImpl = fetchReturning(() => streamResponse(listBody([entry(B)])))
		const result = await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv, now: () => 9_000, ttlMs: 5_000 })

		expect(result.provenance).toBe("fresh")
		expect(result.tokens[0]?.address).toBe(B.toLowerCase())
	})

	it("aborts mid-stream once the byte cap is exceeded and falls back to the stale cache", async () => {
		const kv = memoryKv({ [KEY]: cacheEntry(0, [{ address: A.toLowerCase() }]) })
		const pulls = { count: 0 }
		const body = listBody(Array.from({ length: 40 }, (_, i) => entry(`0x${String(i).padStart(40, "0")}`)))
		const fetchImpl = fetchReturning(() => streamResponse(body, { chunkSize: 64, pulls }))
		const result = await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv, now: () => 1e9, byteCap: 200 })

		expect(result.provenance).toBe("fallback")
		expect(result.tokens[0]?.address).toBe(A.toLowerCase())
		// The cap bit while streaming: far fewer pulls than the body needs to drain.
		expect(pulls.count).toBeLessThan(body.length / 64)
	})

	it("falls back with an empty catalog on a non-2xx response", async () => {
		const kv = memoryKv()
		const fetchImpl = fetchReturning(() => streamResponse("nope", { status: 503 }))
		expect(await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv })).toEqual({ tokens: [], provenance: "fallback" })
	})

	it("falls back when the body does not match the token-list schema", async () => {
		const kv = memoryKv()
		const fetchImpl = fetchReturning(() => streamResponse(listBody([entry(A, { decimals: 999 })])))
		expect((await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv })).provenance).toBe("fallback")
		expect(kv.store.has(KEY)).toBe(false)
	})

	it("drops a poisoned cache and refetches instead of serving it", async () => {
		const kv = memoryKv({ [KEY]: cacheEntry(1_000, [{ address: "not-an-address" }]) })
		const fetchImpl = fetchReturning(() => streamResponse(listBody([entry(A)])))
		const result = await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv, now: () => 1_000 })

		expect(kv.removed).toEqual([KEY])
		expect(result.provenance).toBe("fresh")
	})

	it("drops a cache written for another chain", async () => {
		const kv = memoryKv({ [KEY]: cacheEntry(1_000, [{ address: A.toLowerCase() }], 1) })
		const fetchImpl = fetchReturning(() => streamResponse("boom", { status: 500 }))
		const result = await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv, now: () => 1_000 })

		expect(kv.removed).toEqual([KEY])
		expect(result).toEqual({ tokens: [], provenance: "fallback" })
	})

	it("still serves fresh tokens when the store refuses the write", async () => {
		const kv = memoryKv()
		kv.setItem = () => {
			throw new Error("QuotaExceededError")
		}
		const fetchImpl = fetchReturning(() => streamResponse(listBody([entry(A)])))
		const result = await loadTokenList({ chainId: CHAIN, fetch: fetchImpl, kv })

		expect(result.provenance).toBe("fresh")
		expect(result.tokens).toHaveLength(1)
	})

	it("de-duplicates by lowercased address (first wins) and caps the catalog", async () => {
		const kv = memoryKv()
		const body = listBody([
			entry(A, { symbol: "FIRST" }),
			entry(A.toLowerCase(), { symbol: "DUPE" }),
			entry(B),
			entry(`${A.slice(0, 41)}1`),
		])
		const result = await loadTokenList({ chainId: CHAIN, fetch: fetchReturning(() => streamResponse(body)), kv, tokenCap: 2 })

		expect(result.tokens.map((t) => t.symbol)).toEqual(["FIRST", "TKN"])
		expect(result.tokens.map((t) => t.address)).toEqual([A.toLowerCase(), B.toLowerCase()])
	})

	it("keeps only https logos — anything else is dropped rather than rendered", async () => {
		const kv = memoryKv()
		const body = listBody([entry(A, { logoURI: "https://cdn.example/a.png" }), entry(B, { logoURI: "javascript:alert(1)" })])
		const result = await loadTokenList({ chainId: CHAIN, fetch: fetchReturning(() => streamResponse(body)), kv })
		expect(result.tokens.map((t) => t.logoURI)).toEqual(["https://cdn.example/a.png", undefined])
	})
})
