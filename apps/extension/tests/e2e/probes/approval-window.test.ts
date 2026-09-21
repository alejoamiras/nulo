import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { BROWSER } from "../fixtures/browser"
import { openPopup, test, waitForHash } from "../fixtures/extension"

const hasConfig = (inject("aztecTestConfig") as AztecTestConfig | undefined) !== undefined

/**
 * PROBE 1 — can a dApp reach the wallet, and can the suite reach the windows that answers it?
 *
 * The body is almost empty on purpose: `dappConnectedExtension` IS the probe. Setting it up
 * creates an account through the popup, lets the playground discover the wallet through the
 * content script, and finds and clicks a `data-testid` in two approval windows the extension
 * opened itself (`discover`, then `verify`). Re-implementing that here would measure a copy; this
 * measures the fixture every network test stands on.
 */
test.skipIf(!hasConfig)(
	"PROBE 1 — the playground connects through windows the extension opened",
	{ timeout: 120_000 },
	async ({ dappConnectedExtension }) => {
		const status = await dappConnectedExtension.playgroundPage.evaluate(() =>
			document.querySelector('[data-testid="pg-status"]')?.getAttribute("data-status"),
		)
		expect(status).toBe("connected")

		const popup = await openPopup(dappConnectedExtension)
		await waitForHash(popup, "#/popup/general")
		await popup.close()

		console.log(`PROBE 1 PASS (${BROWSER})`)
	},
)
