/** Cell 46: a wallet sharing ONE account connects straight through — no account chooser. */
import { TESTIDS } from "../../../src/lib/testids"
import { expect, test } from "../fixtures/test"
import { connectAztec, grantedAccounts, tid } from "../pages/connect"
import { openSend } from "../pages/send"

// No spares: the pool IS the wallet's account list, and this cell needs exactly one.
test.use({ family: "accounts-single", cells: 1, spares: 0, l1Index: 8 })

test("cell 46 — a one-account grant skips the chooser and lands connected on that account", async ({ page, actor }) => {
	await page.goto("/")
	await openSend(page)
	await connectAztec(page, { profile: "plain" })
	expect(await page.locator(tid(TESTIDS.accountChoice)).count(), "no chooser for a single account").toBe(0)
	await expect(page.locator(tid(TESTIDS.accountChip)).first()).toContainText(actor.address.slice(2, 6), { ignoreCase: true })
	expect((await grantedAccounts(page)).map((a) => a.toLowerCase())).toEqual([actor.address.toLowerCase()])
})
