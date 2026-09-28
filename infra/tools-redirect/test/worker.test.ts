import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import worker from "../src/worker"

// Hand-written, independent of the Worker's map, so a changed target moves the implementation
// without moving the expectation.
const EXPECTED: Record<string, string> = {
	"tools.nulo.sh": "https://unleashed-mainnet.alejo-amiras.workers.dev",
	"testnet.tools.nulo.sh": "https://unleashed-testnet.alejo-amiras.workers.dev",
}

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

	test("an unknown host is a 404 with no location", async () => {
		for (const url of [
			"https://nulo.sh/",
			"https://evil.example/",
			"https://tools.nulo.sh.evil.example/",
			"https://x.tools.nulo.sh/",
		]) {
			const res = worker.fetch(new Request(url))
			expect(res.status).toBe(404)
			expect(res.headers.get("location")).toBeNull()
			expect(res.headers.get("cache-control")).toBe("no-store")
			expect(await res.text()).toBe("")
		}
	})

	test("neither the path nor a header can move the redirect off its origin", () => {
		const origin = EXPECTED["tools.nulo.sh"] as string
		const paths = [
			"//evil.example/x",
			"/\\evil.example",
			"/%2F%2Fevil.example",
			"/@evil.example",
			"/..%2F..%2Fevil.example",
			"/%0d%0aLocation:%20https://evil.example",
		]
		for (const path of paths) {
			const location = redirectOf(`https://tools.nulo.sh${path}?next=https://evil.example`)
			expect(new URL(location).origin).toBe(origin)
			expect(location.startsWith(`${origin}/`)).toBe(true)
			expect(location).not.toMatch(/[\r\n]/)
		}
		const spoofed = redirectOf("https://tools.nulo.sh/p", {
			headers: {
				host: "evil.example",
				"x-forwarded-host": "evil.example",
				"x-original-url": "https://evil.example/",
				forwarded: "host=evil.example",
			},
		})
		expect(spoofed).toBe(`${origin}/p`)
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
