import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import worker from "../src/worker"
import { ENCODED_SUFFIX, EXPECTED, HOSTILE_PATHS } from "./expected"

const SPOOF_HEADERS = (host: string) => ({
	host,
	"x-forwarded-host": host,
	"x-original-url": `https://${host}/`,
	forwarded: `host=${host}`,
})

const redirectOf = (url: string, init?: RequestInit) => {
	const res = worker.fetch(new Request(url, init))
	expect(res.status).toBe(302)
	expect(res.headers.get("cache-control")).toBe("no-store")
	return res.headers.get("location") as string
}

describe("each retired tools host redirects to its new origin", () => {
	test("both hosts → 302 to the matching origin, path and query carried, never cached", () => {
		for (const [host, origin] of Object.entries(EXPECTED)) {
			expect(redirectOf(`https://${host}/a/b?c=1`)).toBe(`${origin}/a/b?c=1`)
			expect(redirectOf(`https://${host}/`)).toBe(`${origin}/`)
			expect(redirectOf(`http://${host}/x`, { method: "POST" })).toBe(`${origin}/x`)
		}
	})

	test("the encoded path and query pass through byte for byte", () => {
		for (const [host, origin] of Object.entries(EXPECTED)) {
			expect(redirectOf(`https://${host}${ENCODED_SUFFIX}`)).toBe(`${origin}${ENCODED_SUFFIX}`)
		}
	})

	test("an unknown host is an empty, uncached 404 — even when its headers name a redirected host", async () => {
		const unknown = ["https://nulo.sh/", "https://evil.example/", "https://tools.nulo.sh.evil.example/", "https://x.tools.nulo.sh/"]
		for (const url of unknown) {
			const res = worker.fetch(new Request(url, { headers: SPOOF_HEADERS("tools.nulo.sh") }))
			expect(res.status).toBe(404)
			expect(res.headers.get("location")).toBeNull()
			expect(res.headers.get("cache-control")).toBe("no-store")
			expect(await res.text()).toBe("")
		}
	})

	test("neither the path nor a header can move the redirect off its origin", () => {
		for (const [host, origin] of Object.entries(EXPECTED)) {
			for (const path of HOSTILE_PATHS) {
				const location = redirectOf(`https://${host}${path}?next=https://evil.example`)
				expect(new URL(location).origin).toBe(origin)
				expect(location.startsWith(`${origin}/`)).toBe(true)
				expect(location).not.toMatch(/[\r\n]/)
			}
			expect(redirectOf(`https://${host}/p`, { headers: SPOOF_HEADERS("evil.example") })).toBe(`${origin}/p`)
		}
	})
})

describe("wrangler.jsonc pins the deployment to the two hosts", () => {
	const raw = readFileSync(join(import.meta.dir, "../wrangler.jsonc"), "utf8")
	const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""))

	test("two custom domains — exactly the redirected hosts — no workers.dev or preview origin", () => {
		expect(config.routes).toEqual(Object.keys(EXPECTED).map((pattern) => ({ pattern, custom_domain: true })))
		expect(config.workers_dev).toBe(false)
		expect(config.preview_urls).toBe(false)
	})
})
