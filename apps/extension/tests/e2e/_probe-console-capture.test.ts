/**
 * PROBE — console-capture truth (plan: import-stage-deadlines, Phase 5).
 * Gated on NULO_E2E_CONSOLE_PROBE=1; skip-by-default so the smoke suite never
 * pays for it. Underscore prefix = probe, not a regression gate (convention:
 * `network/_probe-warmup-effect.test.ts`).
 *
 * Establishes, empirically, the three-channel truth the flake-ledger's
 * consoleErrors entry needs:
 *   1. an app `console.error` in the popup NEVER reaches `page.on("console")`
 *      (the console-sniffer reroutes it over RPC to the SW realm), but IS
 *      readable via the SW's session-storage log ring (`readSwLogTrail`,
 *      polled past LoggerStore's 2s persistence debounce);
 *   2. an UNCAUGHT throw and an UNHANDLED rejection each DO reach
 *      `page.on("pageerror")` — the native uncaught path survives the
 *      entry-point handlers;
 *   3. the BUILT popup HTML preserves sniffer-before-entry script order
 *      (module order is spec-guaranteed; this eliminates the build-reorder
 *      residual).
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"
import { openPopup, test } from "./fixtures/extension"
import { readSwLogTrail } from "./fixtures/journal"

const PROBE_ENABLED = process.env.NULO_E2E_CONSOLE_PROBE === "1"
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = process.env.EXTENSION_PATH ? path.resolve(process.env.EXTENSION_PATH) : path.resolve(__dirname, "../../dist/chrome")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.skipIf(!PROBE_ENABLED)(
	"console.error is invisible to page console but lands in the SW log ring",
	async ({ registeredExtension: ctx }) => {
		const page = await openPopup(ctx)
		const nonce = `NULO-PROBE-${Date.now()}`

		await page.evaluate((n: string) => {
			console.error(n, "probe-payload")
		}, nonce)

		// Give any hypothetical console event a generous settle, then assert the
		// page-side capture saw NOTHING (the blind spot under test).
		await sleep(1_500)
		const pageSide = ctx.consoleErrors.filter((t) => t.includes(nonce))
		expect(pageSide, `page.on("console") should never see app console.error — got: ${JSON.stringify(pageSide)}`).toEqual([])

		// The routed copy must appear in the SW's log ring once LoggerStore's 2s
		// debounce flushes — poll to 10s so one slow flush can't flake the probe.
		let found: unknown[] | string = []
		for (let i = 0; i < 20; i++) {
			found = await readSwLogTrail(page, { match: nonce, limit: 10 })
			if (Array.isArray(found) && found.length > 0) break
			await sleep(500)
		}
		expect(
			Array.isArray(found) && found.length > 0,
			`nonce should reach the SW log ring via the sniffer's RPC route — trail: ${JSON.stringify(found).slice(0, 400)}`,
		).toBe(true)
	},
)

test.skipIf(!PROBE_ENABLED)("uncaught throw and unhandled rejection each reach pageerror", async ({ registeredExtension: ctx }) => {
	const page = await openPopup(ctx)
	const throwNonce = `NULO-PROBE-THROW-${Date.now()}`
	const rejectNonce = `NULO-PROBE-REJECT-${Date.now()}`

	await page.evaluate((n: string) => {
		setTimeout(() => {
			throw new Error(n)
		}, 0)
	}, throwNonce)
	await page.evaluate((n: string) => {
		setTimeout(() => {
			void Promise.reject(new Error(n))
		}, 0)
	}, rejectNonce)

	await sleep(1_500)
	const messages = ctx.pageErrors.map((e) => e.message)
	expect(
		messages.some((m) => m.includes(throwNonce)),
		`uncaught throw should reach pageerror — got: ${JSON.stringify(messages)}`,
	).toBe(true)
	expect(
		messages.some((m) => m.includes(rejectNonce)),
		`unhandled rejection should reach pageerror — got: ${JSON.stringify(messages)}`,
	).toBe(true)

	// The probes are deliberate noise: drain them so nothing downstream
	// misreads the fixture arrays.
	ctx.pageErrors.length = 0
})

test.skipIf(!PROBE_ENABLED)("built popup HTML keeps the sniffer script before the entry script", () => {
	const html = readFileSync(path.join(EXTENSION_PATH, "src/popup/index.html"), "utf8")
	const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1])
	const snifferIdx = scripts.findIndex((s) => /sniffer/i.test(s))
	const entryIdx = scripts.findIndex((s) => !/sniffer/i.test(s))
	expect(snifferIdx, `no sniffer script found in built HTML — scripts: ${JSON.stringify(scripts)}`).toBeGreaterThanOrEqual(0)
	expect(entryIdx, `no entry script found in built HTML — scripts: ${JSON.stringify(scripts)}`).toBeGreaterThanOrEqual(0)
	expect(snifferIdx, `sniffer must precede the entry script — scripts in order: ${JSON.stringify(scripts)}`).toBeLessThan(entryIdx)
})
