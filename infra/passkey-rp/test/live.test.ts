import { describe, expect, test } from "bun:test"
import { resolve4, resolve6 } from "node:dns/promises"
import { POLICY } from "../src/worker"

// Black-box probe of the deployed RP host from outside: what a browser would see, so a zone-level
// regression (a challenge rule, an HTML rewriter, a wildcard record, another Worker on the route)
// fails by its effect, with no Cloudflare credentials. Gated on RP_HOST_LIVE=1 — it needs the network.
const RP_HOST = "passkey.nulo.sh"
const url = (path: string, scheme = "https") => `${scheme}://${RP_HOST}${path}`
// A bot-shaped agent: a challenge or block rule on the host answers it with a page, not the Worker.
const BOT_UA = "python-requests/2.32"
const get = (path: string, init: RequestInit = {}) => fetch(url(path), { redirect: "manual", headers: { "user-agent": BOT_UA }, ...init })

describe.skipIf(process.env.RP_HOST_LIVE !== "1")("the deployed RP host", () => {
	test("serves the page under the exact policy, with no script and no edge mitigation", async () => {
		const res = await get("/")
		expect(res.status).toBe(200)
		for (const [name, value] of Object.entries(POLICY)) expect(res.headers.get(name)).toBe(value)
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8")
		expect(res.headers.get("cf-mitigated")).toBeNull()
		const body = await res.text()
		expect(body).not.toMatch(/<script|<iframe|<link|<object|<embed|\ssrc=|\shref=|\son[a-z]+=|javascript:/i)
		expect(body).toContain('<meta name="robots" content="noindex">')
	})

	test("/.well-known/webauthn and any other path are 404, other methods 405, under the same policy", async () => {
		for (const path of ["/.well-known/webauthn", "/index.html"]) {
			const res = await get(path)
			expect(res.status).toBe(404)
			for (const [name, value] of Object.entries(POLICY)) expect(res.headers.get(name)).toBe(value)
			expect(await res.text()).toBe("")
		}
		const post = await get("/", { method: "POST" })
		expect(post.status).toBe(405)
		expect(post.headers.get("content-security-policy")).toBe(POLICY["content-security-policy"])
	})

	test("the AI-crawler block is a plain-text refusal, not a page with script", async () => {
		const res = await get("/", { headers: { "user-agent": "GPTBot/1.0" } })
		expect([200, 403]).toContain(res.status)
		if (res.status === 403) expect(res.headers.get("content-type")).toMatch(/^text\/plain/)
		expect(await res.text()).not.toMatch(/<script|javascript:/i)
	})

	test("plain http is a 301 to https, not served", async () => {
		const res = await fetch(url("/x?y=1", "http"), { redirect: "manual", headers: { "user-agent": BOT_UA } })
		expect(res.status).toBe(301)
		expect(res.headers.get("location")).toBe(url("/x?y=1"))
	})

	test("Cloudflare's own /cdn-cgi/ surface is script-free, and no descendant resolves", async () => {
		// /cdn-cgi/* never reaches the Worker: the trace is text, and any other path is the edge's
		// static 404 page. Neither may ever carry script or a mitigation.
		const trace = await get("/cdn-cgi/trace")
		expect(trace.status).toBe(200)
		expect(trace.headers.get("content-type")).toMatch(/^text\/plain/)
		for (const path of ["/cdn-cgi/x", "/cdn-cgi/scripts/x.js", "/cdn-cgi/rum", "/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"]) {
			const res = await get(path)
			expect(res.status).toBe(404)
			expect(res.headers.get("cf-mitigated")).toBeNull()
			expect(await res.text()).not.toMatch(/<script|javascript:/i)
		}
		for (const name of [`x.${RP_HOST}`, `www.${RP_HOST}`, `a.b.${RP_HOST}`]) {
			await expect(resolve4(name)).rejects.toMatchObject({ code: "ENOTFOUND" })
			await expect(resolve6(name)).rejects.toMatchObject({ code: "ENOTFOUND" })
		}
	})
})
