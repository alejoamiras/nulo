/**
 * Default-token seeding must happen for a chain's FIRST account, with no user
 * action.
 *
 * The regression this pins: `TokenService` used to trigger a seed pass only on
 * profile activation and active-network change, and BOTH fire before the
 * chain's first account row exists — the popup creates networks, then accounts.
 * Every seed hit the zero-accounts guard, nothing re-triggered the pass, and
 * the defaults never appeared until some unrelated later event happened to fire
 * one.
 *
 * Switching to Local Network is that exact shape in miniature: the switch fires
 * `onActiveNetworkChanged` first, and only then does `network-switch.ts` create
 * the chain's first account. Everything here must be automatic — the moment
 * this test needs `importToken`, it is testing something else.
 */

import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import { switchToLocalNetwork } from "../fixtures/helpers"
import { seedSandboxDefaultToken } from "../fixtures/token-seeds"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

type SeedTrace = { step: number; seedRowAt: number; cardAt: number; emptyAfterSeedRow: boolean }

/**
 * Records, from inside the popup, the ORDER in which the Holdings list showed things. Installed
 * before the switch because the window it measures is short: a poll from the test side can miss a
 * placeholder that lived for two seconds, and cannot prove the empty state never flashed.
 */
async function traceHoldings(page: Page): Promise<void> {
	await page.evaluate(() => {
		const trace: SeedTrace = { step: 0, seedRowAt: 0, cardAt: 0, emptyAfterSeedRow: false }
		;(window as unknown as { __seedTrace: SeedTrace }).__seedTrace = trace
		const has = (selector: string) => document.querySelector(selector) !== null
		const record = () => {
			trace.step += 1
			if (!trace.seedRowAt && has('[data-testid="token-seed-row"][data-symbol="TST"]')) trace.seedRowAt = trace.step
			if (!trace.cardAt && has('[data-testid="tokens-card"] [data-testid="token-symbol"][data-symbol="TST"]'))
				trace.cardAt = trace.step
			if (trace.seedRowAt && !trace.cardAt && has('[data-testid="tokens-empty-import-link"]')) trace.emptyAfterSeedRow = true
		}
		new MutationObserver(record).observe(document.body, { childList: true, subtree: true, attributes: true })
	})
}

test.skipIf(!hasConfig)(
	"a chain's first account seeds the default tokens with no user action",
	{ timeout: 180_000 },
	async ({ registeredExtensionPerTest }) => {
		const page = await openPopup(registeredExtensionPerTest)
		await waitForHash(page, "#/popup/general")

		// Before the switch — the pass it triggers reads the list once.
		await seedSandboxDefaultToken(page, { address: aztecConfig!.tokenAddress, classId: aztecConfig!.tokenClassId })
		await traceHoldings(page)

		await switchToLocalNetwork(page)

		await page.waitForSelector('[data-testid="tokens-card"] [data-testid="token-symbol"][data-symbol="TST"]', {
			visible: true,
			timeout: 120_000,
		})

		// The default was on screen, by name, BEFORE its token row existed — and from that moment
		// until the row landed the list never claimed to be empty.
		const trace = await page.evaluate(() => (window as unknown as { __seedTrace: SeedTrace }).__seedTrace)
		expect(trace.seedRowAt, "the TST placeholder never rendered").toBeGreaterThan(0)
		expect(trace.seedRowAt, "the TST placeholder rendered only after the real row").toBeLessThan(trace.cardAt)
		expect(trace.emptyAfterSeedRow, "the empty state showed while a default token was still on its way").toBe(false)

		// The row must come from the seeder, not a stray import: seeding records
		// its outcome in the per-profile marker blob.
		const marker = await page.evaluate(async () => {
			const all = await chrome.storage.local.get(null)
			const key = Object.keys(all).find((k) => k.startsWith("nulo:core:token-seeded@"))
			return key ? (all[key] as string) : undefined
		})
		expect(marker, "seed marker blob missing — the token did not come from the seeder").toBeDefined()
		const outcomes = Object.values(JSON.parse(marker as string) as Record<string, { outcome?: string }>)
		expect(outcomes.some((e) => e.outcome === "seeded")).toBe(true)

		expect(registeredExtensionPerTest.pageErrors).toEqual([])
	},
)
