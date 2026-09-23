import type { HTTPRequest, Page } from "puppeteer"
import { PRESTO_HOST, PRESTO_HTTPS_PORT, PRESTO_PORT } from "@/presto/config"

// The wallet probes Presto HTTPS-first; after an HTTPS failure the SDK runs one witness-free HTTP
// diagnostic. Both are intercepted below the TLS handshake, so no certificate is needed.
export const PRESTO_HTTPS_HEALTH_URL = `https://${PRESTO_HOST}:${PRESTO_HTTPS_PORT}/health`
export const PRESTO_HTTP_HEALTH_URL = `http://${PRESTO_HOST}:${PRESTO_PORT}/health`

/** What Presto serves an origin it has approved: versions, the prover flag and the HTTPS port. */
export const PRESTO_DETAILED_HEALTH = {
	status: "ok",
	api_version: 1,
	version: "1.1.1",
	aztec_version: "5.2.0",
	available_versions: ["5.2.0"],
	bb_available: true,
	https_port: PRESTO_HTTPS_PORT,
}
/** What Presto serves an origin it has not approved yet. */
export const PRESTO_MINIMAL_HEALTH = { status: "ok", api_version: 1 }

export type HealthAnswer = { status: number; body: unknown } | "refused"

/** Answer the two health probes per scheme; every other request passes through. */
export async function interceptHealth(page: Page, answers: { https: HealthAnswer; http: HealthAnswer }): Promise<void> {
	await page.setRequestInterception(true)
	const answer = (req: HTTPRequest, how: HealthAnswer) => {
		if (how === "refused") return req.abort("connectionrefused")
		return req.respond({ status: how.status, contentType: "application/json", body: JSON.stringify(how.body) })
	}
	page.on("request", (req) => {
		if (req.url() === PRESTO_HTTPS_HEALTH_URL) return answer(req, answers.https)
		if (req.url() === PRESTO_HTTP_HEALTH_URL) return answer(req, answers.http)
		return req.continue()
	})
}
