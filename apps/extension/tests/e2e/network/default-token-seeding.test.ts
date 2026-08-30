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

import { expect, inject } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import { switchToLocalNetwork } from "../fixtures/helpers"
import { seedSandboxDefaultToken } from "../fixtures/token-seeds"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test.skipIf(!hasConfig)(
	"a chain's first account seeds the default tokens with no user action",
	{ timeout: 180_000 },
	async ({ registeredExtensionPerTest }) => {
		const page = await openPopup(registeredExtensionPerTest)
		await waitForHash(page, "#/popup/general")

		// Before the switch — the pass it triggers reads the list once.
		await seedSandboxDefaultToken(page, { address: aztecConfig!.tokenAddress, classId: aztecConfig!.tokenClassId })

		await switchToLocalNetwork(page)

		await page.waitForSelector('[data-testid="tokens-card"] [data-testid="token-symbol"][data-symbol="TST"]', {
			visible: true,
			timeout: 120_000,
		})

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
