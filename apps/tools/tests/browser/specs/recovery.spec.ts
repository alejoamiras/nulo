/** Recovery (cells 24a, 25): a claim interrupted by a reload completes from the journal; a declined grant signs nothing. */
import { balanceOf, freshToken, mint, setRoutable } from "@nulo/bridge-core/sandbox"
import { TESTIDS } from "../../../src/lib/testids"
import { expect, test } from "../fixtures/test"
import { connectAztec, driveToConnected, tid, walletCalls, walletFrame } from "../pages/connect"
import { depositRecords } from "../pages/journal"
import { confirmReview, connectL1, openSend, reviewDeposit } from "../pages/send"

test.use({ family: "recovery", cells: 2, l1Index: 4 })

const USDC = 10n ** 6n
const L1 = 31337

/** After a reload the remembered wallet reconnects — from wherever the page picks it up. */
const reconnected = (page: import("@playwright/test").Page, account: string) => driveToConnected(page, { profile: "plain", account })

test("cell 24a — a fueled deposit interrupted by a reload after the Ethereum leg is claimed from the journal", async ({
	page,
	run,
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
	// The interruption is made deterministic, and BEFORE the attempt is latched: the claim's first
	// simulation against the hub (its arrival gate) never answers, so the Ethereum leg lands, no
	// claim is ever sent, and the record stays a plain "claim me" for the page that comes next. (A
	// refused SEND would not do: the attempt latches first, and a latched attempt with no hash is
	// an outcome the journal must wait on, not retry.)
	const hub = sandbox.manifest.bridge?.l2.hub.address ?? ""
	expect(hub).not.toBe("")
	await walletFrame(page, run, "plain").evaluate((hubAddress) => window.__nuloTestWallet!.holdNext("simulateTx", hubAddress), hub)
	await confirmReview(page)
	await expect.poll(async () => (await depositRecords(page)).at(-1)?.depositTxHash, { timeout: 180_000 }).toBeTruthy()
	await expect.poll(async () => (await walletCalls(page, run, "plain")).simulateTx ?? 0, { timeout: 180_000 }).toBeGreaterThan(0)
	const calls = await walletCalls(page, run, "plain")
	expect(calls.sendTx ?? 0, "no transaction left this page's wallet").toBe(0)
	expect((await depositRecords(page)).at(-1)?.claimTxHash, "interrupted before the claim").toBeUndefined()

	await page.reload()
	await openSend(page)
	await connectL1(page)
	await reconnected(page, actor.address)
	await page.locator(tid(TESTIDS.tabActivity)).click()
	const card = page.locator(tid(TESTIDS.journalCard)).first()
	await expect(card).toBeVisible()
	// The card offers the claim again, or resumes it on its own; either way the claim is a
	// transaction THIS page's wallet sends, from the journal alone.
	const claim = card.locator(tid(TESTIDS.journalClaim))
	const done = page.locator(`${tid(TESTIDS.journalCard)}[data-stage="done"]`)
	await expect(claim.or(done).first()).toBeVisible({ timeout: 180_000 })
	if (await claim.isVisible()) await claim.click()
	await expect(card).toHaveAttribute("data-stage", "done", { timeout: 8 * 60_000 })

	expect((await depositRecords(page)).at(-1)?.claimTxHash, "the claim landed from the journal").toBeTruthy()
	expect((await walletCalls(page, run, "plain")).sendTx ?? 0, "sent by the reloaded page's wallet").toBeGreaterThanOrEqual(1)
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

	await walletFrame(page, run, "plain").evaluate(() => window.__nuloTestWallet!.declineNextGrant())
	const confirm = page.locator(tid(TESTIDS.sendReviewConfirm))
	await expect(confirm).toBeEnabled({ timeout: 60_000 })
	await confirm.click()
	await expect(page.locator(tid(TESTIDS.sendGrantDeclined))).toBeVisible({ timeout: 120_000 })
	await expect(page.locator(tid(TESTIDS.stepper))).toHaveCount(0)
	expect(l1.signatures, "the grant comes before any Ethereum signature").toBe(0)
	expect((await depositRecords(page)).length, "no deposit was filed").toBe(0)
})
