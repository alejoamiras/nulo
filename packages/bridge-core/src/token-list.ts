/**
 * The token catalog behind "pick a token": a Uniswap-format list, fetched at most once a TTL,
 * validated, narrowed to one chain, and cached.
 *
 * Nothing here throws. A list is a convenience — the wizard always accepts a pasted address — so
 * every failure degrades to the cached catalog (however stale) and then to an empty one. The
 * remote body is hostile input: it is size-capped WHILE streaming, never redirected, and only the
 * validated per-chain subset is persisted (the live list is ~670 KB and `no-store`).
 */
import type { Address } from "viem"
import z from "zod"
import type { KV } from "./journal"

export const TOKEN_LIST_ORIGIN = "https://tokens.uniswap.org"
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_BYTE_CAP = 2 * 1024 * 1024
const DEFAULT_TOKEN_CAP = 2000
const DEFAULT_TIMEOUT_MS = 8_000

export const tokenListCacheKey = (chainId: number): string => `nulo-bridge:token-list:v1:${chainId}`

/** Unknown keys (`tags`, `extensions`, …) are dropped rather than rejected — lists carry vendor extras. */
export const tokenListEntrySchema = z.object({
	chainId: z.number().int().positive(),
	address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte 0x hex address"),
	name: z.string(),
	symbol: z.string(),
	decimals: z.number().int().min(0).max(255),
	logoURI: z.string().optional(),
})

export const tokenListSchema = z.object({
	name: z.string(),
	tokens: z.array(tokenListEntrySchema),
})

/** The persisted shape: addresses are already lowercased, so the cache is read back byte-strict. */
export const catalogTokenSchema = tokenListEntrySchema.extend({
	address: z.string().regex(/^0x[0-9a-f]{40}$/, "expected a lowercase 20-byte 0x hex address"),
})

export const tokenListCacheSchema = z.object({
	fetchedAt: z.number().int().nonnegative(),
	chainId: z.number().int().positive(),
	tokens: z.array(catalogTokenSchema),
})

export interface CatalogToken {
	chainId: number
	/** Lowercase — the canonical key for lookups and de-duplication. */
	address: Address
	name: string
	symbol: string
	decimals: number
	logoURI?: string
}

export interface LoadTokenListOptions {
	chainId: number
	fetch: typeof fetch
	kv: KV
	now?: () => number
	ttlMs?: number
	origin?: string
	byteCap?: number
	tokenCap?: number
	timeoutMs?: number
}

/** `fresh` = fetched now; `cache` = an unexpired cache hit, no network; `fallback` = the fetch failed. */
export type TokenListProvenance = "fresh" | "cache" | "fallback"

interface TokenListCache {
	fetchedAt: number
	chainId: number
	tokens: CatalogToken[]
}

function readCache(kv: KV, key: string, chainId: number): TokenListCache | undefined {
	const raw = kv.getItem(key)
	if (raw === null) return undefined
	let json: unknown
	try {
		json = JSON.parse(raw)
	} catch {
		kv.removeItem(key)
		return undefined
	}
	const parsed = tokenListCacheSchema.safeParse(json)
	// A cache written for another chain is as untrustworthy as a malformed one — drop, don't reuse.
	if (!parsed.success || parsed.data.chainId !== chainId) {
		kv.removeItem(key)
		return undefined
	}
	return parsed.data as TokenListCache
}

function persist(kv: KV, key: string, cache: TokenListCache): void {
	try {
		kv.setItem(key, JSON.stringify(cache))
	} catch {
		// Quota (or a KV that refuses writes): the catalog stays memory-only for this session.
	}
}

async function readCapped(res: Response, byteCap: number, controller: AbortController): Promise<string> {
	if (res.body === null) throw new Error("token list response had no body")
	const reader = res.body.getReader()
	const decoder = new TextDecoder()
	let seen = 0
	let text = ""
	let chunk = await reader.read()
	while (chunk.done !== true) {
		seen += chunk.value.byteLength
		// The cap is enforced on the RUNNING total: a hostile origin never gets to hand us the
		// whole body and have us decide afterwards.
		if (seen > byteCap) {
			controller.abort()
			throw new Error("token list exceeded its byte cap")
		}
		text += decoder.decode(chunk.value, { stream: true })
		chunk = await reader.read()
	}
	return text + decoder.decode()
}

function narrow(entries: readonly z.infer<typeof tokenListEntrySchema>[], chainId: number, cap: number): CatalogToken[] {
	const tokens: CatalogToken[] = []
	const seen = new Set<string>()
	for (const entry of entries) {
		if (entry.chainId !== chainId) continue
		const address = entry.address.toLowerCase() as Address
		if (seen.has(address)) continue
		seen.add(address)
		const token: CatalogToken = { chainId, address, name: entry.name, symbol: entry.symbol, decimals: entry.decimals }
		// The logo lands in an <img src>: only https survives, anything else is dropped rather than rendered.
		if (entry.logoURI?.startsWith("https://")) token.logoURI = entry.logoURI
		tokens.push(token)
		if (tokens.length === cap) break
	}
	return tokens
}

async function fetchCatalog(o: LoadTokenListOptions): Promise<CatalogToken[]> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? DEFAULT_TIMEOUT_MS)
	try {
		// `redirect: "error"` — a list that redirects is no longer the origin whose content we vetted.
		const res = await o.fetch(o.origin ?? TOKEN_LIST_ORIGIN, { redirect: "error", signal: controller.signal })
		if (!res.ok) throw new Error(`token list responded ${res.status}`)
		const body = await readCapped(res, o.byteCap ?? DEFAULT_BYTE_CAP, controller)
		const list = tokenListSchema.parse(JSON.parse(body))
		return narrow(list.tokens, o.chainId, o.tokenCap ?? DEFAULT_TOKEN_CAP)
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Loads the catalog for one chain: unexpired cache, else network, else whatever cache exists, else
 * nothing. Never rejects.
 */
export async function loadTokenList(o: LoadTokenListOptions): Promise<{ tokens: CatalogToken[]; provenance: TokenListProvenance }> {
	const key = tokenListCacheKey(o.chainId)
	const now = o.now ?? Date.now
	const cached = readCache(o.kv, key, o.chainId)
	if (cached !== undefined && now() - cached.fetchedAt < (o.ttlMs ?? DEFAULT_TTL_MS)) {
		return { tokens: cached.tokens, provenance: "cache" }
	}
	try {
		const tokens = await fetchCatalog(o)
		persist(o.kv, key, { fetchedAt: now(), chainId: o.chainId, tokens })
		return { tokens, provenance: "fresh" }
	} catch {
		return { tokens: cached?.tokens ?? [], provenance: "fallback" }
	}
}
