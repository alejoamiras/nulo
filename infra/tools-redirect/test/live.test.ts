import { describe, expect, test } from "bun:test"
import { ENCODED_SUFFIX, EXPECTED, HOSTILE_PATHS } from "./expected"

// Black-box probe of the deployed hosts from outside: the unit tests feed the Worker synthetic
// requests, so only this sees what Cloudflare's ingress actually hands it. Gated on
// TOOLS_REDIRECT_LIVE=1 — it needs the network and the cut-over done.
const REQUEST_MS = 10_000
const TEST_MS = 60_000
const get = (url: string) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_MS) })

describe.skipIf(process.env.TOOLS_REDIRECT_LIVE !== "1")("the deployed redirect hosts", () => {
	test(
		"each host answers a 302 to its origin with the encoded path and query intact, never cached",
		async () => {
			for (const [host, origin] of Object.entries(EXPECTED)) {
				for (const suffix of ["/a/b?c=1", ENCODED_SUFFIX]) {
					const res = await get(`https://${host}${suffix}`)
					expect(res.status).toBe(302)
					expect(res.headers.get("location")).toBe(`${origin}${suffix}`)
					expect(res.headers.get("cache-control")).toBe("no-store")
					expect(res.headers.get("cf-mitigated")).toBeNull()
				}
			}
		},
		TEST_MS,
	)

	test(
		"no hostile path moves a redirect off its origin",
		async () => {
			for (const [host, origin] of Object.entries(EXPECTED)) {
				for (const path of HOSTILE_PATHS) {
					const res = await get(`https://${host}${path}`)
					expect(res.status).toBe(302)
					expect(new URL(res.headers.get("location") as string).origin).toBe(origin)
				}
			}
		},
		TEST_MS,
	)
})
