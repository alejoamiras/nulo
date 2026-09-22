/**
 * Store screenshots, opt-in: `STORE_CAPTURES=1` writes three 360×600 popup captures into
 * `store/captures/`, which `scripts/store-art.ts` then frames at 1280×800. Skipped in every
 * ordinary run so the smoke suite never rewrites committed art. Chrome build only.
 */
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect } from "vitest"
import { openPopup, test, waitForHash } from "./fixtures/extension"
import { navigateByHash } from "./fixtures/helpers"

const OUT_DIR = resolve(__dirname, "../../store/captures")
const VIEWPORT = { width: 360, height: 600 }

describe.skipIf(!process.env.STORE_CAPTURES)("store captures", () => {
	test("home, send and security at the popup's size", { timeout: 120_000 }, async ({ registeredExtension: ctx }) => {
		mkdirSync(OUT_DIR, { recursive: true })
		const page = await openPopup(ctx)
		await page.setViewport(VIEWPORT)
		await waitForHash(page, "#/popup/general", 15_000)
		await page.waitForSelector('[data-testid="balance-amount"]', { visible: true, timeout: 30_000 })
		await page.screenshot({ path: resolve(OUT_DIR, "home.png") })

		await navigateByHash(page, "#/popup/send", 15_000)
		await page.waitForSelector('[data-testid="send-submit"]', { visible: true, timeout: 15_000 })
		await page.screenshot({ path: resolve(OUT_DIR, "send.png") })

		await navigateByHash(page, "#/popup/settings/security", 15_000)
		await page.waitForSelector('[data-testid="strict-security-toggle"]', { visible: true, timeout: 15_000 })
		await page.screenshot({ path: resolve(OUT_DIR, "security.png") })

		expect(ctx.pageErrors).toEqual([])
	})
})
