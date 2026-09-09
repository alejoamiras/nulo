/** Token + gas deposits (cells 13–17): the fueled claim pays for itself, and what that leaves alone. */
import {
	balanceOf,
	freshToken,
	fundPublicFeeJuice,
	mint,
	mintPrivateGasNote,
	privateCreditOf,
	privateFpc,
	setRoutable,
} from "@nulo/bridge-core/sandbox"
import { TESTIDS } from "../../../src/lib/testids"
import { expect, test } from "../fixtures/test"
import { connectAztec, tid } from "../pages/connect"
import { depositRecords, fuelConservation } from "../pages/journal"
import { confirmReview, connectL1, openSend, reviewDeposit, setVisibility, startDeposit, waitForReceipt } from "../pages/send"

test.use({ cells: 7, l1Index: 4 })

const USDC = 10n ** 6n
const FJ = 10n ** 18n
const L1 = 31337

test("cell 13 — plain, public, nothing held: the claim pays from the fuel the same send bridged", async ({ page, sandbox, actor, l1 }) => {
	const { usdt } = sandbox.tokens
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 200n * USDC)
	const usdtL2 = await actor.l2TokenOf(usdt)
	const before = await balanceOf(usdtL2, actor.actor.address, "public")
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdt.erc20, amount: "100", intent: "token+gas", isPrivate: false })
	await expect(page.locator(tid(TESTIDS.sendReviewGas))).toBeVisible()
	await confirmReview(page)
	const receipt = await waitForReceipt(page)
	expect(receipt.gas, "the receipt carries the gas leg").not.toBeNull()

	const gained = (await balanceOf(usdtL2, actor.actor.address, "public")) - before
	expect(gained, "the token leg arrived, minus the slice that became gas").toBeGreaterThan(0n)
	expect(gained).toBeLessThan(100n * USDC)
	const { received, fee } = await fuelConservation(page, actor.s.l2.node)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public"), "public FJ = the fuel minus the claim's own fee").toBe(
		fjBefore + received - fee,
	)
	expect(await privateCreditOf(actor.s, await privateFpc(actor.s)), "no credit was minted or spent").toBe(0n)
})

test("cell 13b — selfpay, public FJ held: conservation, after = before + claimed − the fee charged", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdt } = sandbox.tokens
	await fundPublicFeeJuice(actor.s, 5n * FJ)
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 200n * USDC)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "selfpay", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdt.erc20, amount: "100", intent: "token+gas", isPrivate: false })
	await confirmReview(page)
	const receipt = await waitForReceipt(page)
	expect(receipt.gas).not.toBeNull()

	const { received, fee } = await fuelConservation(page, actor.s.l2.node)
	expect(received).toBeGreaterThan(0n)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")).toBe(fjBefore + received - fee)
})

test("cell 14 — plain, public, credit held: the fueled claim leaves the credit untouched", async ({ page, sandbox, actor, l1 }) => {
	const { usdt } = sandbox.tokens
	const fpc = await privateFpc(actor.s)
	await mintPrivateGasNote(actor.s, fpc, FJ / 10n)
	const creditBefore = await privateCreditOf(actor.s, fpc)
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 200n * USDC)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdt.erc20, amount: "100", intent: "token+gas", isPrivate: false })
	await confirmReview(page)
	await waitForReceipt(page)

	const { received, fee } = await fuelConservation(page, actor.s.l2.node)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")).toBe(fjBefore + received - fee)
	expect(await privateCreditOf(actor.s, fpc), "the credit was never a payer").toBe(creditBefore)
})

test("cell 15 — plain, private: the fuel becomes credit at the FPC, which pays the private claim", async ({ page, sandbox, actor, l1 }) => {
	const { usdt } = sandbox.tokens
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 200n * USDC)
	const usdtL2 = await actor.l2TokenOf(usdt)
	const before = await balanceOf(usdtL2, actor.actor.address, "private")
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdt.erc20, amount: "100", intent: "token+gas", isPrivate: true })
	await confirmReview(page)
	const receipt = await waitForReceipt(page)
	expect(receipt.gas).not.toBeNull()

	expect((await balanceOf(usdtL2, actor.actor.address, "private")) - before, "the token leg arrived privately").toBeGreaterThan(0n)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public"), "nothing public was touched").toBe(fjBefore)
	const credit = await privateCreditOf(actor.s, await privateFpc(actor.s))
	expect(credit, "the fuel minus the ceiling the FPC kept remains as credit").toBeGreaterThan(0n)
})

test("cell 15b — selfpay, private, public FJ held: the private fence leaves it untouched", async ({ page, sandbox, actor, l1 }) => {
	const { usdt } = sandbox.tokens
	await fundPublicFeeJuice(actor.s, 5n * FJ)
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 200n * USDC)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "selfpay", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdt.erc20, amount: "100", intent: "token+gas", isPrivate: true })
	await confirmReview(page)
	await waitForReceipt(page)

	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public"), "a private claim never pays from public Fee Juice").toBe(
		fjBefore,
	)
	expect(await privateCreditOf(actor.s, await privateFpc(actor.s))).toBeGreaterThan(0n)
})

test("cell 16 — plain, private, first-time token: registration, then the credit-paid claim", async ({ page, sandbox, actor, l1 }) => {
	const erc20 = await freshToken(sandbox.clients.l1, { name: "Fresh Fueled", symbol: "FRSHG", decimals: 6 }, [l1.address], 1000n * USDC)
	await setRoutable(sandbox.clients.l1, sandbox.clients.deployment.quoter, erc20)

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20, amount: "100", intent: "token+gas", isPrivate: true, viaLookup: true })
	await expect(page.locator(tid(TESTIDS.sendReviewFirstTime))).toBeVisible()
	await confirmReview(page)
	await waitForReceipt(page)
	const record = (await depositRecords(page)).at(-1)
	expect(record?.registerTxHash, "a private first-time token registers in a transaction of its own").toBeTruthy()
	expect(record?.claimTxHash, "then claims").toBeTruthy()
	expect(await privateCreditOf(actor.s, await privateFpc(actor.s))).toBeGreaterThan(0n)
})

test("cell 17 — the slice under the claim minimum is refused at the amount step, nothing signed", async ({ page, sandbox, actor, l1 }) => {
	const { usdt } = sandbox.tokens
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 200n * USDC)

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	// One USDT buys one FJ on the venue; half of it as gas is under the network's 1 FJ claim minimum.
	await startDeposit(page, { l1ChainId: L1, erc20: usdt.erc20, amount: "1" })
	await setVisibility(page, false)
	await page.locator(tid(TESTIDS.sendChoiceTokenGas)).click()
	await expect(page.locator(tid(TESTIDS.sendStepAmount))).not.toHaveAttribute("data-route-loading", "true", { timeout: 60_000 })
	await expect(page.locator(tid(TESTIDS.sendGasBreakdown))).toContainText("minimum a claim needs")
	await expect(page.locator(tid(TESTIDS.sendAmountNext))).toBeDisabled()
	expect(l1.signatures).toBe(0)
})
