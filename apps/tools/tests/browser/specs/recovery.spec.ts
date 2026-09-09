/** Recovery (cells 24a, 25): a claim interrupted by a reload completes from the journal; a declined grant signs nothing. */
import { balanceOf, freshToken, mint, setRoutable } from "@nulo/bridge-core/sandbox"
import { TESTIDS } from "../../../src/lib/testids"
import { expect, test } from "../fixtures/test"
import { connectAztec, driveToConnected, tid, walletFrame } from "../pages/connect"
import { depositRecords } from "../pages/journal"
import { confirmReview, connectL1, openSend, reviewDeposit } from "../pages/send"

test.use({ cells: 2, l1Index: 4 })

const USDC = 10n ** 6n
const L1 = 31337

/** After a reload the remembered wallet reconnects — from wherever the page picks it up. */
const reconnected = (page: import("@playwright/test").Page, account: string) => driveToConnected(page, { profile: "plain", account })

test("cell 24a — a fueled deposit interrupted by a reload after the Ethereum leg is claimed from the journal", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdt } = sandbox.tokens
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 200n * USDC)
	const usdtL2 = await actor.l2TokenOf(usdt)
	const before = await balanceOf(usdtL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdt.erc20, amount: "100", intent: "token+gas", isPrivate: false })
	await confirmReview(page)
	// The Ethereum leg is done the moment the journal holds the deposit's hash; the claim is still ahead.
	await expect.poll(async () => (await depositRecords(page)).at(-1)?.depositTxHash, { timeout: 180_000 }).toBeTruthy()
	expect((await depositRecords(page)).at(-1)?.claimTxHash, "interrupted before the claim").toBeUndefined()

	await page.reload()
	await openSend(page)
	await connectL1(page)
	await reconnected(page, actor.address)
	await page.locator(tid(TESTIDS.tabActivity)).click()
	const card = page.locator(tid(TESTIDS.journalCard)).first()
	await expect(card).toBeVisible()
	// Claimable again after the sync: the card offers the claim, or resumes it on its own.
	const claim = card.locator(tid(TESTIDS.journalClaim))
	await claim.click({ timeout: 180_000 }).catch(() => {})
	await expect(card).toHaveAttribute("data-stage", "done", { timeout: 8 * 60_000 })

	expect((await depositRecords(page)).at(-1)?.claimTxHash, "the claim landed from the journal").toBeTruthy()
	expect((await balanceOf(usdtL2, actor.actor.address, "public")) - before).toBeGreaterThan(0n)
})

test("cell 25 — a declined token grant ends on the review with the refusal; nothing is signed on Ethereum", async ({
	page,
	run,
	sandbox,
	actor,
	l1,
}) => {
	// A token the wallet has never been asked about: the generation's own are granted at connect,
	// so only a fresh one raises the grant at the confirm, where the decline is armed.
	const erc20 = await freshToken(sandbox.clients.l1, { name: "Fresh Declined", symbol: "FRSHD", decimals: 6 }, [l1.address], 1000n * USDC)
	await setRoutable(sandbox.clients.l1, sandbox.clients.deployment.quoter, erc20)
	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20, amount: "100", intent: "token+gas", isPrivate: false, viaLookup: true })

	await walletFrame(page, run.testWalletOrigin, "plain").evaluate(() => window.__nuloTestWallet!.declineNextGrant())
	const confirm = page.locator(tid(TESTIDS.sendReviewConfirm))
	await expect(confirm).toBeEnabled({ timeout: 60_000 })
	await confirm.click()
	await expect(page.locator(tid(TESTIDS.sendGrantDeclined))).toBeVisible({ timeout: 120_000 })
	await expect(page.locator(tid(TESTIDS.stepper))).toHaveCount(0)
	expect(l1.signatures, "the grant comes before any Ethereum signature").toBe(0)
	expect((await depositRecords(page)).length, "no deposit was filed").toBe(0)
})
