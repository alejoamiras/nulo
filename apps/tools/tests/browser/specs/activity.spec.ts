/** Activity (cell 39): a bridge's recovery file round-trips, and a backgrounded send reports back. */
import { mint } from "@nulo/bridge-core/sandbox"
import { TESTIDS } from "../../../src/lib/testids"
import { expect, test } from "../fixtures/test"
import { connectAztec, tid } from "../pages/connect"
import { depositRecords } from "../pages/journal"
import { confirmReview, connectL1, openSend, reviewDeposit, waitForReceipt } from "../pages/send"

test.use({ cells: 2, l1Index: 5 })

const USDC = 10n ** 6n
const L1 = 31337

test("cell 39 — the recovery file of a finished bridge restores it into an empty journal, under one Ethereum signature", async ({
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
	await confirmReview(page)
	// A recovery file is offered while a bridge is in flight (a finished card offers Clear); the
	// stepper's export needs the row named, which the journal shows by holding the deposit's hash.
	const stepper = page.locator(tid(TESTIDS.stepper))
	await expect(stepper).toBeVisible({ timeout: 120_000 })
	await expect.poll(async () => (await depositRecords(page)).at(-1)?.depositTxHash, { timeout: 180_000 }).toBeTruthy()
	const signaturesBefore = l1.signatures
	// The toast is read alongside the download, on a shorter clock: an export that fails says why
	// there, briefly, and that reason is what a failure must report.
	const [download] = await Promise.all([
		page.waitForEvent("download", { timeout: 60_000 }),
		stepper.locator(tid(TESTIDS.stepperBackup)).click(),
		expect(page.locator(tid(TESTIDS.toast))).toContainText("Recovery file downloaded", { timeout: 20_000 }),
	])
	const file = await download.path()
	expect(file).toBeTruthy()
	await waitForReceipt(page)
	const record = (await depositRecords(page)).at(-1)
	expect(record?.claimTxHash).toBeTruthy()
	// The key IS a signature over the record's binding. A provider the app cannot fingerprint (the
	// shim is "injected") never caches its determinism proof, so every export signs twice: once for
	// the key, once to prove the wallet re-derives it.
	expect(l1.signatures - signaturesBefore, "the export derives its key from the signature, proven deterministic").toBe(2)

	// An empty journal on the same Ethereum account takes the file back.
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await openSend(page)
	await connectL1(page)
	await page.locator(tid(TESTIDS.tabActivity)).click()
	await expect(page.locator(tid(TESTIDS.journalEmpty))).toBeVisible()
	await page.locator(tid(TESTIDS.journalRestoreInput)).setInputFiles(file as string)
	await expect(page.locator(tid(TESTIDS.journalCard)).first()).toBeVisible({ timeout: 60_000 })
	expect(
		(await depositRecords(page)).some((r) => r.id === record?.id),
		"the same record is back",
	).toBe(true)
})

test("cell 39 — a send sent to the background keeps running: the strip follows it, and its completion is announced", async ({
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
	await confirmReview(page)
	await expect(page.locator(tid(TESTIDS.stepper))).toBeVisible({ timeout: 120_000 })
	await page.locator(tid(TESTIDS.stepperBackground)).click()
	await expect(page.locator(tid(TESTIDS.sendBackgroundStrip))).toBeVisible()
	await expect(page.locator(tid(TESTIDS.sendStepToken)), "the wizard starts over").toBeVisible()

	await expect(page.locator(tid(TESTIDS.toast))).toBeVisible({ timeout: 8 * 60_000 })
	await page.locator(tid(TESTIDS.tabActivity)).click()
	await expect(page.locator(tid(TESTIDS.journalCard)).first()).toHaveAttribute("data-stage", "done", { timeout: 60_000 })
	expect((await depositRecords(page)).at(-1)?.claimTxHash).toBeTruthy()
})
