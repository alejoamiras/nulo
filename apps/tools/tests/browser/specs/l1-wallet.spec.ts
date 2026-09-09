/** The Ethereum side (cell 26): a refused signature, an account change, the wrong chain. */
import { anvilKey, mint } from "@nulo/bridge-core/sandbox"
import { TESTIDS } from "../../../src/lib/testids"
import { expect, test } from "../fixtures/test"
import { connectAztec, tid } from "../pages/connect"
import { connectL1, openSend, reviewDeposit } from "../pages/send"

test.use({ cells: 3, l1Index: 7 })

const USDC = 10n ** 6n
const L1 = 31337

test("cell 26 — a refused signature ends the send on the review with the wallet's reason; nothing was sent", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdt } = sandbox.tokens
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 200n * USDC)
	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdt.erc20, amount: "100", intent: "token+gas", isPrivate: false })

	l1.rejectNext("signature")
	const confirm = page.locator(tid(TESTIDS.sendReviewConfirm))
	await expect(confirm).toBeEnabled({ timeout: 60_000 })
	await confirm.click()
	const error = page.locator(tid(TESTIDS.sendReviewError))
	await expect(error).toBeVisible({ timeout: 120_000 })
	await expect(error).toContainText(/rejected/i)
	await expect(page.locator(tid(TESTIDS.stepper))).toHaveCount(0)
	expect(l1.signatures, "the refusal was the only signature asked for").toBe(0)
	await expect(confirm, "the review stays live for another try").toBeEnabled()
})

test("cell 26 — the connected Ethereum account changes under the app: the chip follows", async ({ page, actor, l1 }) => {
	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	const chip = page.locator(tid(TESTIDS.l1Account))
	await expect(chip).toContainText(l1.address.slice(0, 6))

	await l1.setAccount(anvilKey(9))
	await expect(chip).toContainText(l1.address.slice(0, 6), { timeout: 30_000 })
	await expect(page.locator(tid(TESTIDS.l1Status))).toHaveAttribute("data-connected", "true")
})

test("cell 26 — the wrong Ethereum chain shows the switch, and the switch asks the wallet back", async ({ page, actor, l1 }) => {
	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	const switchBtn = page.locator(tid(TESTIDS.l1SwitchChain))
	await expect(switchBtn).toHaveCount(0)

	await l1.setChainId(1)
	await expect(switchBtn).toBeVisible({ timeout: 30_000 })
	await switchBtn.click()
	await expect(switchBtn).toHaveCount(0, { timeout: 30_000 })
	await expect(page.locator(tid(TESTIDS.l1Status))).toHaveAttribute("data-connected", "true")
})
