/** Token-only deposits (cells 1–6): what pays the claim, and what the wallet's shape changes about it. */
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
import { type ActorHandle, expect, test } from "../fixtures/test"
import { connectAztec, tid } from "../pages/connect"
import { walletCeiling } from "../pages/fees"
import { depositRecords } from "../pages/journal"
import { confirmReview, connectL1, newSend, openSend, reviewDeposit, waitForReceipt } from "../pages/send"

test.use({ cells: 6, l1Index: 2 })

const USDC = 10n ** 6n
const FJ = 10n ** 18n
const L1 = 31337

/** What the FPC keeps for a claim of this shape — the wallet's pricing, which the app reads the same way. */
const ceilingOf = walletCeiling

/** One credit note sized to `multiple` claim ceilings, so the FPC has something to keep. */
async function fundCredit(actor: ActorHandle, amount: bigint): Promise<bigint> {
	const fpc = await privateFpc(actor.s)
	await mintPrivateGasNote(actor.s, fpc, amount)
	return privateCreditOf(actor.s, fpc)
}

test("cell 1 — plain, public, registered token: the claim is paid from one private credit note", async ({ page, sandbox, actor, l1 }) => {
	const { usdc } = sandbox.tokens
	const ceiling = await ceilingOf(actor, { isPrivate: false, registers: false })
	const creditBefore = await fundCredit(actor, (ceiling * 14n) / 10n)
	await mint(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address, 100n * USDC)
	const usdcL2 = await actor.l2TokenOf(usdc)
	const usdcBefore = await balanceOf(usdcL2, actor.actor.address, "public")
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "10", intent: "token", isPrivate: false })
	await confirmReview(page)
	const receipt = await waitForReceipt(page)
	expect(receipt.gas).toBeNull()

	expect(await balanceOf(usdcL2, actor.actor.address, "public")).toBe(usdcBefore + 10n * USDC)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public"), "no public Fee Juice was touched").toBe(fjBefore)
	expect(await privateCreditOf(actor.s, await privateFpc(actor.s)), "the FPC kept the claim's ceiling").toBe(creditBefore - ceiling)
})

test("cell 2 — plain, private, registered token: the private claim is paid from credit", async ({ page, sandbox, actor, l1 }) => {
	const { usdc } = sandbox.tokens
	const ceiling = await ceilingOf(actor, { isPrivate: true, registers: false })
	const creditBefore = await fundCredit(actor, (ceiling * 14n) / 10n)
	await mint(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address, 100n * USDC)
	const usdcL2 = await actor.l2TokenOf(usdc)
	const privateBefore = await balanceOf(usdcL2, actor.actor.address, "private")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "10", intent: "token", isPrivate: true })
	await confirmReview(page)
	const receipt = await waitForReceipt(page)
	expect(receipt.gas).toBeNull()

	expect(await balanceOf(usdcL2, actor.actor.address, "private")).toBe(privateBefore + 10n * USDC)
	expect(await privateCreditOf(actor.s, await privateFpc(actor.s)), "the FPC kept the private claim's ceiling").toBe(
		creditBefore - ceiling,
	)
})

test("cell 3 — plain, public, first-time token from credit: register + claim, then a cheaper second send", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const erc20 = await freshToken(sandbox.clients.l1, { name: "Fresh Public", symbol: "FRSHP", decimals: 6 }, [l1.address], 1000n * USDC)
	await setRoutable(sandbox.clients.l1, sandbox.clients.deployment.quoter, erc20)
	const first = await ceilingOf(actor, { isPrivate: false, registers: true })
	const second = await ceilingOf(actor, { isPrivate: false, registers: false })
	expect(first).toBeGreaterThan(second)
	const creditBefore = await fundCredit(actor, ((first + second) * 12n) / 10n)

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20, amount: "10", intent: "token", isPrivate: false, viaLookup: true })
	await expect(page.locator(tid(TESTIDS.sendReviewFirstTime)), "the review says this send registers the token").toBeVisible()
	await confirmReview(page)
	await waitForReceipt(page)
	const record = (await depositRecords(page)).at(-1)
	expect(record?.claimTxHash, "the claim landed").toBeTruthy()
	expect(record?.registerTxHash, "a public first-time token registers inside its claim, not in a transaction of its own").toBeUndefined()
	const fpc = await privateFpc(actor.s)
	const afterFirst = await privateCreditOf(actor.s, fpc)
	expect(afterFirst, "the FPC kept the register + claim ceiling").toBe(creditBefore - first)

	await newSend(page)
	await reviewDeposit(page, { l1ChainId: L1, erc20, amount: "10", intent: "token", isPrivate: false })
	await expect(page.locator(tid(TESTIDS.sendReviewFirstTime))).toHaveCount(0)
	await confirmReview(page)
	await waitForReceipt(page)
	expect(await privateCreditOf(actor.s, fpc), "the second send is a plain claim at the smaller ceiling").toBe(afterFirst - second)
})

test("cell 4 — plain, private, first-time token from credit: a registration of its own, then the claim", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const erc20 = await freshToken(sandbox.clients.l1, { name: "Fresh Private", symbol: "FRSHV", decimals: 6 }, [l1.address], 1000n * USDC)
	await setRoutable(sandbox.clients.l1, sandbox.clients.deployment.quoter, erc20)
	const ceiling = await ceilingOf(actor, { isPrivate: true, registers: true })
	const creditBefore = await fundCredit(actor, (ceiling * 14n) / 10n)

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20, amount: "10", intent: "token", isPrivate: true, viaLookup: true })
	await expect(page.locator(tid(TESTIDS.sendReviewFirstTime))).toBeVisible()
	await confirmReview(page)
	await waitForReceipt(page)
	const record = (await depositRecords(page)).at(-1)
	expect(record?.registerTxHash, "a private first-time token registers in a transaction of its own").toBeTruthy()
	expect(record?.claimTxHash, "then claims").toBeTruthy()
	expect(await privateCreditOf(actor.s, await privateFpc(actor.s)), "the FPC kept the register + claim ceiling").toBe(
		creditBefore - ceiling,
	)
})

test("cell 5 — selfpay, public, registered token: the claim is paid from held public Fee Juice", async ({ page, sandbox, actor, l1 }) => {
	const { usdc } = sandbox.tokens
	await fundPublicFeeJuice(actor.s, 5n * FJ)
	await mint(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address, 100n * USDC)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	const usdcL2 = await actor.l2TokenOf(usdc)
	const usdcBefore = await balanceOf(usdcL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "selfpay", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "10", intent: "token", isPrivate: false })
	await expect(page.locator(tid(TESTIDS.sendReviewNetworkFee))).toContainText("Fee Juice you already hold")
	await confirmReview(page)
	const receipt = await waitForReceipt(page)
	expect(receipt.gas).toBeNull()

	expect(await balanceOf(usdcL2, actor.actor.address, "public")).toBe(usdcBefore + 10n * USDC)
	const fjAfter = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	expect(fjAfter, "the claim's fee came out of the held public Fee Juice").toBeLessThan(fjBefore)
	expect(fjAfter, "and only the fee").toBeGreaterThan(fjBefore - FJ / 100n)
	expect(await privateCreditOf(actor.s, await privateFpc(actor.s)), "no credit existed and none was minted").toBe(0n)
})

test("cell 6 — plain, public FJ held AND credit: the wallet lacks the feature, so credit pays and the public FJ is untouched", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdc } = sandbox.tokens
	const ceiling = await ceilingOf(actor, { isPrivate: false, registers: false })
	await fundPublicFeeJuice(actor.s, 5n * FJ)
	const creditBefore = await fundCredit(actor, (ceiling * 14n) / 10n)
	await mint(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address, 100n * USDC)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "10", intent: "token", isPrivate: false })
	await expect(page.locator(tid(TESTIDS.sendReviewNetworkFee))).toContainText("private gas you already hold")
	await confirmReview(page)
	await waitForReceipt(page)

	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public"), "the public Fee Juice was never a payer").toBe(fjBefore)
	expect(await privateCreditOf(actor.s, await privateFpc(actor.s)), "the FPC kept the claim's ceiling").toBe(creditBefore - ceiling)
})
