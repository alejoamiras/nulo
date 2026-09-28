import { describe, expect, test } from "bun:test"
import { ENCODED_SUFFIX, EXPECTED, HOSTILE_PATHS } from "./expected"

// Black-box probe of the deployed hosts from outside: the unit tests feed the Worker synthetic
// requests, so only this sees what Cloudflare's ingress actually hands it. Gated on
// TOOLS_REDIRECT_LIVE=1 — it needs the network and the cut-over done.
const REQUEST_MS = 10_000
// Requests run sequentially, so a test's budget grows with its request count.
const budget = (requests: number) => REQUEST_MS * (requests + 1)
const get = (url: string) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_MS) })
const SUFFIXES = ["/a/b?c=1", ENCODED_SUFFIX]

describe.skipIf(process.env.TOOLS_REDIRECT_LIVE !== "1")("the deployed redirect hosts", () => {
	for (const [host, origin] of Object.entries(EXPECTED)) {
		test(
			`${host} answers a 302 to its origin with the encoded path and query intact, never cached`,
			async () => {
				for (const suffix of SUFFIXES) {
					const res = await get(`https://${host}${suffix}`)
					expect(res.status).toBe(302)
					expect(res.headers.get("location")).toBe(`${origin}${suffix}`)
					expect(res.headers.get("cache-control")).toBe("no-store")
					expect(res.headers.get("cf-mitigated")).toBeNull()
				}
			},
			budget(SUFFIXES.length),
		)

		test(
			`no hostile path moves ${host}'s redirect off its origin`,
			async () => {
				for (const path of HOSTILE_PATHS) {
					const res = await get(`https://${host}${path}`)
					expect(res.status).toBe(302)
					expect(new URL(res.headers.get("location") as string).origin).toBe(origin)
				}
			},
			budget(HOSTILE_PATHS.length),
		)
	}
})
