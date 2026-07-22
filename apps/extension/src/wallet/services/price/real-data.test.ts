/**
 * Real-data integration test against the live CoinGecko API. Local
 * diagnostic only (NOT a CI gate — shared-IP rate limits make it flaky
 * there): run with `COINGECKO_REAL_TESTS=1 bun run test src/wallet/services/price`.
 *
 * Verifies the two load-bearing external assumptions:
 * - the mapped ids (`aztec`, `usd-coin`) exist and resolve to quotes that
 *   pass our own sanity bands;
 * - the keyless endpoint answers with permissive CORS (the manifest ships
 *   NO CoinGecko host_permission — the fetch relies on `ACAO: *`).
 */

import { describe, expect, test } from "vitest"
import { allCoingeckoIds, getSanityBand } from "./price-map"

describe.skipIf(!process.env.COINGECKO_REAL_TESTS)("CoinGecko live API", () => {
	test("all mapped ids resolve to in-band quotes with last_updated_at", async () => {
		const ids = allCoingeckoIds()
		const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_last_updated_at=true`
		const response = await fetch(url)
		expect(response.ok).toBe(true)

		const body = (await response.json()) as Record<string, { usd?: number; last_updated_at?: number }>
		for (const id of ids) {
			const row = body[id]
			expect(row, `id "${id}" missing from response — delisted or renamed?`).toBeDefined()
			expect(typeof row.usd).toBe("number")
			const band = getSanityBand(id)
			expect(band).toBeDefined()
			expect(row.usd).toBeGreaterThanOrEqual((band as { min: number }).min)
			expect(row.usd).toBeLessThanOrEqual((band as { max: number }).max)
			expect(typeof row.last_updated_at).toBe("number")
		}
	}, 20_000)

	test("keyless endpoint serves permissive CORS (no host_permission needed)", async () => {
		const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd")
		expect(response.ok).toBe(true)
		expect(response.headers.get("access-control-allow-origin")).toBe("*")
	}, 20_000)
})
