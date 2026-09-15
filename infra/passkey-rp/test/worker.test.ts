import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import worker from "../src/worker"

// Mirrors `RP_ID` in apps/extension/src/wallet/services/passkey/spec.ts; the extension's own
// build gate pins that constant, this file pins the host that serves it.
const RP_HOST = "passkey.nulo.sh"

// The exact policy every response carries, whatever its status. A relaxed `sandbox`, an added
// `script-src` or a zeroed HSTS max-age must fail here, not pass a substring check.
const POLICY: Record<string, string> = {
	"content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
	"permissions-policy": "publickey-credentials-create=(), publickey-credentials-get=()",
	"strict-transport-security": "max-age=31536000; includeSubDomains",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
	"x-robots-tag": "noindex",
}

const request = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://${RP_HOST}${path}`, init))
const expectPolicy = (res: Response) => {
	for (const [name, value] of Object.entries(POLICY)) expect(res.headers.get(name)).toBe(value)
}

describe("the RP host serves one static, script-free page", () => {
	test("GET / is the page — sandboxed by the exact policy, script-less and reference-less by content", async () => {
		const res = request("/")
		expect(res.status).toBe(200)
		expectPolicy(res)
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8")
		const body = await res.text()
		expect(body).not.toMatch(/<script|<iframe|<link|<object|<embed|\ssrc=|\shref=|\son[a-z]+=|javascript:/i)
		expect(body).toContain('<meta name="robots" content="noindex">')
	})

	test("/.well-known/webauthn is an empty 404 under the same policy — related-origin authorization is never enabled", async () => {
		const res = request("/.well-known/webauthn")
		expect(res.status).toBe(404)
		expect(await res.text()).toBe("")
		expectPolicy(res)
	})

	test("plain http is redirected to https before anything is served, under the same policy", () => {
		const res = worker.fetch(new Request(`http://${RP_HOST}/x?y=1`))
		expect(res.status).toBe(301)
		expect(res.headers.get("location")).toBe(`https://${RP_HOST}/x?y=1`)
		expectPolicy(res)
		const proxied = request("/", { headers: { "x-forwarded-proto": "http" } })
		expect(proxied.status).toBe(301)
		expect(proxied.headers.get("location")).toBe(`https://${RP_HOST}/`)
	})

	test("every other path is a 404 and every other method a 405, under the same policy", async () => {
		const other = request("/index.html")
		expect(other.status).toBe(404)
		expectPolicy(other)
		const post = request("/", { method: "POST" })
		expect(post.status).toBe(405)
		expect(post.headers.get("allow")).toBe("GET, HEAD")
		expect(await post.text()).toBe("")
		expectPolicy(post)
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
