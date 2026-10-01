/**
 * The schema-patch control, run by rehearse.sh with the register import removed: on every wallet
 * profile, add-to-wallet must throw inside the app's own proxy. The wallet frame logs each call it
 * receives (`→ <method> #<id>`), so a call that never left the app is told apart from one the
 * wallet refused or a transport that failed.
 */
import { TESTIDS } from "../../../src/lib/testids"
import { expect, test } from "../fixtures/test"
import { connectAztec, tid } from "../pages/connect"

test.use({ family: "drip", cells: 4, l1Index: 6 })

for (const profile of ["plain", "selfpay", "full"] as const) {
	test(`control — add-to-wallet on ${profile} throws in the app's proxy`, async ({ page, actor }) => {
		const received: string[] = []
		page.on("console", (msg) => {
			const call = /\[test-wallet:\w+\] → (\w+) #/.exec(msg.text())
			if (call) received.push(call[1])
		})
		await page.goto("/")
		await connectAztec(page, { profile, account: actor.address })
		await page.locator(tid(TESTIDS.tabDrip)).click()
		const add = page.locator(`${tid(TESTIDS.tokenCard)}[data-symbol="NULO"]`).locator(tid(TESTIDS.btnAddToWallet))
		await add.click()
		await expect(add).toHaveAttribute("data-add-status", "error", { timeout: 30_000 })
		expect(received.length, "the wallet answered the connect flow").toBeGreaterThan(0)
		expect(received.filter((m) => m === "registerToken" || m === "isTokenRegistered")).toEqual([])
	})
}
