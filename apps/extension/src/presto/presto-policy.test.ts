import { PrestoClient, type ProveRequest } from "@alejoamiras/presto-core"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PRESTO_HOST, PRESTO_HTTPS_PORT, PRESTO_PORT } from "./config"

/**
 * Production transport policy, proven on the real `presto-core` client: with the options the
 * offscreen factory passes, a private witness never leaves the browser over plain HTTP. After any
 * HTTPS failure the only HTTP request the client may issue is the witness-free `GET /health`
 * diagnostic — never a `/prove`.
 */

const HTTPS_HEALTH = `https://${PRESTO_HOST}:${PRESTO_HTTPS_PORT}/health`
const HEALTH_BODY = {
	status: "ok",
	api_version: 1,
	version: "1.1.1",
	aztec_version: "5.2.0",
	available_versions: ["5.2.0"],
	bb_available: true,
}

type Seen = { method: string; url: string }

/** A stubbed network: `https` decides what HTTPS requests do; HTTP always answers a healthy `/health`. */
function stubNetwork(https: (url: string, method: string) => Response | Error) {
	const seen: Seen[] = []
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = String(input)
			const method = init?.method ?? "GET"
			seen.push({ method, url })
			if (url.startsWith("https:")) {
				const out = https(url, method)
				if (out instanceof Error) throw out
				return out
			}
			return json(HEALTH_BODY)
		}),
	)
	return seen
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const refused = () => new TypeError("Failed to fetch")

function productionClient() {
	return new PrestoClient({
		aztecVersion: "5.2.0",
		presto: { host: PRESTO_HOST, port: PRESTO_PORT, httpsPort: PRESTO_HTTPS_PORT, httpsOnly: true },
	})
}

const request: ProveRequest = {
	path: "/prove",
	contentType: "application/octet-stream",
	body: () => new Uint8Array([1, 2, 3]),
}

const httpRequests = (seen: Seen[]) => seen.filter((r) => r.url.startsWith("http:"))
const expectOnlyHttpHealthGets = (seen: Seen[]) => {
	expect(seen.some((r) => r.url.endsWith("/prove") && r.url.startsWith("http:"))).toBe(false)
	for (const r of httpRequests(seen)) expect(r).toEqual({ method: "GET", url: `http://${PRESTO_HOST}:${PRESTO_PORT}/health` })
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("production Presto policy: no HTTP /prove, ever", () => {
	test("HTTPS health refused → fallback; the only HTTP traffic is the GET /health diagnostic", async () => {
		const seen = stubNetwork(() => refused())
		const outcome = await productionClient().prove(request)
		expect(outcome).toMatchObject({ kind: "fallback", reason: "secure-connection-unavailable" })
		expectOnlyHttpHealthGets(seen)
		expect(httpRequests(seen).length).toBeGreaterThan(0)
	}, 15_000)

	test("HTTPS health good, then the HTTPS POST /prove fails → fallback without an HTTP retry", async () => {
		const seen = stubNetwork((_url, method) => (method === "POST" ? refused() : json(HEALTH_BODY)))
		const outcome = await productionClient().prove(request)
		expect(outcome).toMatchObject({ kind: "fallback", reason: "network" })
		expect(seen.filter((r) => r.method === "POST")).toEqual([
			{ method: "POST", url: `https://${PRESTO_HOST}:${PRESTO_HTTPS_PORT}/prove` },
		])
		expectOnlyHttpHealthGets(seen)
	}, 15_000)

	test("HTTPS proved earlier in the session, then refused → fallback; still no HTTP /prove", async () => {
		let httpsUp = true
		const seen = stubNetwork((_url, method) => {
			if (!httpsUp) return refused()
			return method === "POST" ? json({ proof: "AAAA" }) : json(HEALTH_BODY)
		})
		const client = productionClient()
		expect(await client.prove(request)).toMatchObject({ kind: "native" })
		expect(seen.map((r) => r.url)).toContain(HTTPS_HEALTH)

		httpsUp = false
		await client.checkStatus({ forceRefresh: true })
		const outcome = await client.prove(request)
		expect(outcome).toMatchObject({ kind: "fallback" })
		expectOnlyHttpHealthGets(seen)
	}, 20_000)
})
