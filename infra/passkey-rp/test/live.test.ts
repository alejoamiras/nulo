import { describe, expect, test } from "bun:test"
import { resolve4, resolve6 } from "node:dns/promises"
import { EXPECTED_POLICY, INERT_HTML, RP_HOST } from "./policy"

// Black-box probe of the deployed RP host from outside: what a browser would see, so a zone-level
// regression (a challenge rule, an HTML rewriter, a wildcard record, another Worker on the route)
// fails by its effect, with no Cloudflare credentials. Gated on RP_HOST_LIVE=1 — it needs the network.
// Coverage is sampled: these paths, these user agents, these descendant names, from this runner.
const url = (path: string, scheme = "https") => `${scheme}://${RP_HOST}${path}`
// A bot-shaped agent: a challenge or block rule on the host answers it with a page, not the Worker.
const BOT_UA = "python-requests/2.32"
const REQUEST_MS = 10_000
const TEST_MS = 60_000
const get = (path: string, init: RequestInit = {}) =>
	fetch(url(path), {
		redirect: "manual",
		signal: AbortSignal.timeout(REQUEST_MS),
		...init,
		headers: { "user-agent": BOT_UA, ...(init.headers as Record<string, string> | undefined) },
	})
const expectPolicy = (res: Response) => {
	for (const [name, value] of Object.entries(EXPECTED_POLICY)) expect(res.headers.get(name)).toBe(value)
	expect(res.headers.get("cf-mitigated")).toBeNull()
}
const expectPage = async (res: Response) => {
	expect(res.status).toBe(200)
	expectPolicy(res)
	expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8")
	const body = await res.text()
	expect(body).not.toMatch(INERT_HTML)
	expect(body).toContain('<meta name="robots" content="noindex">')
}

describe.skipIf(process.env.RP_HOST_LIVE !== "1")("the deployed RP host", () => {
	test(
		"serves the page under the exact policy, with no script and no edge mitigation",
		async () => {
			await expectPage(await get("/"))
		},
		TEST_MS,
	)

	test(
		"/.well-known/webauthn and any other path are 404, other methods 405, under the same policy",
		async () => {
			for (const path of ["/.well-known/webauthn", "/index.html"]) {
				const res = await get(path)
				expect(res.status).toBe(404)
				expectPolicy(res)
				expect(await res.text()).toBe("")
			}
			const post = await get("/", { method: "POST" })
			expect(post.status).toBe(405)
			expectPolicy(post)
		},
		TEST_MS,
	)

	test(
		"an AI crawler gets either the same page or a plain-text refusal — never a page with script",
		async () => {
			const res = await get("/", { headers: { "user-agent": "GPTBot/1.0" } })
			if (res.status === 200) {
				await expectPage(res)
				return
			}
			expect(res.status).toBe(403)
			expect(res.headers.get("content-type")).toMatch(/^text\/plain/)
			expect(res.headers.get("cf-mitigated")).toBeNull()
			expect(await res.text()).not.toMatch(INERT_HTML)
		},
		TEST_MS,
	)

	test(
		"plain http is a 301 to https, not served",
		async () => {
			const plain = await fetch(url("/x?y=1", "http"), {
				redirect: "manual",
				signal: AbortSignal.timeout(REQUEST_MS),
				headers: { "user-agent": BOT_UA },
			})
			expect(plain.status).toBe(301)
			expect(plain.headers.get("location")).toBe(url("/x?y=1"))
		},
		TEST_MS,
	)

	test(
		"Cloudflare's own /cdn-cgi/ surface is script-free",
		async () => {
			// /cdn-cgi/* never reaches the Worker: the trace is text, and any other sampled path is the
			// edge's static 404 page. Neither may ever carry script or a mitigation.
			const trace = await get("/cdn-cgi/trace")
			expect(trace.status).toBe(200)
			expect(trace.headers.get("content-type")).toMatch(/^text\/plain/)
			for (const path of [
				"/cdn-cgi/x",
				"/cdn-cgi/scripts/x.js",
				"/cdn-cgi/rum",
				"/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1",
			]) {
				const res = await get(path)
				expect(res.status).toBe(404)
				expect(res.headers.get("cf-mitigated")).toBeNull()
				expect(await res.text()).not.toMatch(INERT_HTML)
			}
		},
		TEST_MS,
	)

	test(
		"no descendant of the RP host resolves",
		async () => {
			for (const name of [`x.${RP_HOST}`, `www.${RP_HOST}`, `a.b.${RP_HOST}`]) {
				await expect(resolve4(name)).rejects.toMatchObject({ code: "ENOTFOUND" })
				await expect(resolve6(name)).rejects.toMatchObject({ code: "ENOTFOUND" })
			}
		},
		TEST_MS,
	)
})
