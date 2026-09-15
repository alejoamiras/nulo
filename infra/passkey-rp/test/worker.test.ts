import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import worker from "../src/worker"

// Mirrors `RP_ID` in apps/extension/src/wallet/services/passkey/spec.ts; the extension's own
// build gate pins that constant, this file pins the host that serves it.
const RP_HOST = "passkey.nulo.sh"
const request = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://${RP_HOST}${path}`, init))

describe("the RP host serves one static, script-free page", () => {
	test("GET / is the page — sandboxed by policy, script-less by content", async () => {
		const res = request("/")
		expect(res.status).toBe(200)
		const csp = res.headers.get("content-security-policy") ?? ""
		for (const directive of ["default-src 'none'", "frame-ancestors 'none'", "sandbox"]) expect(csp).toContain(directive)
		expect(res.headers.get("permissions-policy")).toContain("publickey-credentials-get=()")
		expect(res.headers.get("strict-transport-security")).toContain("includeSubDomains")
		const body = await res.text()
		expect(body).not.toMatch(/<script|<iframe|<link|\son[a-z]+=|javascript:/i)
		expect(body).toContain('<meta name="robots" content="noindex">')
	})

	test("/.well-known/webauthn is a 404 — related-origin authorization is never enabled", async () => {
		const res = request("/.well-known/webauthn")
		expect(res.status).toBe(404)
		expect(await res.text()).toBe("")
		expect(res.headers.get("content-security-policy")).toContain("default-src 'none'")
	})

	test("plain http is redirected to https before anything is served", () => {
		const res = worker.fetch(new Request(`http://${RP_HOST}/x?y=1`))
		expect(res.status).toBe(301)
		expect(res.headers.get("location")).toBe(`https://${RP_HOST}/x?y=1`)
		const proxied = request("/", { headers: { "x-forwarded-proto": "http" } })
		expect(proxied.status).toBe(301)
		expect(proxied.headers.get("location")).toBe(`https://${RP_HOST}/`)
	})

	test("every other path is a 404 and every other method a 405, both under the same policy", async () => {
		expect(request("/index.html").status).toBe(404)
		const post = request("/", { method: "POST" })
		expect(post.status).toBe(405)
		expect(post.headers.get("allow")).toBe("GET, HEAD")
		expect(post.headers.get("content-security-policy")).toContain("sandbox")
	})
})

describe("wrangler.jsonc pins the deployment to the one host", () => {
	const raw = readFileSync(join(import.meta.dir, "../wrangler.jsonc"), "utf8")
	const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""))

	test("one custom domain — the RP host — no wildcard, no workers.dev or preview origin", () => {
		expect(config.routes).toEqual([{ pattern: RP_HOST, custom_domain: true }])
		expect(config.workers_dev).toBe(false)
		expect(config.preview_urls).toBe(false)
	})
})
