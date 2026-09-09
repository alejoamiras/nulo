/** The Send tab, testid-only: the L1 chip, the deposit wizard, the stepper and the receipt. */
import { expect, type Page } from "@playwright/test"
import { TESTIDS } from "../../../src/lib/testids"
import { tid } from "./connect"

export type Intent = "token" | "token+gas" | "gas"

export interface DepositPlan {
	l1ChainId: number
	erc20: string
	/** Decimal string as a user types it. */
	amount: string
	intent: Intent
	isPrivate: boolean
	/** The token is not in the list: paste its address, add it, and let the add select it. */
	viaLookup?: boolean
}

/** Paste an address into the search, wait for the lookup to read it, add it — which selects it. */
export async function pasteToken(page: Page, erc20: string): Promise<void> {
	await page.locator(tid(TESTIDS.sendTokenSearch)).fill(erc20)
	const lookup = page.locator(tid(TESTIDS.sendTokenLookup))
	await expect(lookup).toHaveAttribute("data-status", "found", { timeout: 30_000 })
	await lookup.locator(tid(TESTIDS.sendLookupAdd)).click()
}

/** From the receipt back to the token step, with the list as the last send left it. */
export async function newSend(page: Page): Promise<void> {
	await page.locator(tid(TESTIDS.receiptNewBridge)).click()
	await expect(page.locator(tid(TESTIDS.sendStepToken))).toBeVisible()
}

export async function openSend(page: Page): Promise<void> {
	await page.locator(tid(TESTIDS.tabSend)).click()
	await expect(page.locator(tid(TESTIDS.sendView))).toBeVisible()
}

export async function connectL1(page: Page): Promise<void> {
	await page.locator(tid(TESTIDS.l1Connect)).click()
	await expect(page.locator(tid(TESTIDS.l1Status))).toHaveAttribute("data-connected", "true")
}

/** Deposit direction → token → amount typed. Leaves the wizard on the amount step, choice untouched. */
export async function startDeposit(page: Page, plan: Pick<DepositPlan, "l1ChainId" | "erc20" | "amount" | "viaLookup">): Promise<void> {
	await page.locator(tid(TESTIDS.sendDirectionDeposit)).click()
	if (plan.viaLookup) await pasteToken(page, plan.erc20)
	else await page.locator(`${tid(TESTIDS.sendTokenTile)}[data-key="${plan.l1ChainId}:${plan.erc20.toLowerCase()}"]`).click()
	await expect(page.locator(tid(TESTIDS.sendStepAmount))).toBeVisible()
	await page.locator(tid(TESTIDS.sendAmountInput)).fill(plan.amount)
}

/** The wizard opens private; a public send flips the toggle. */
export async function setVisibility(page: Page, isPrivate: boolean): Promise<void> {
	const toggle = page.locator(tid(TESTIDS.sendPrivateToggle))
	if ((await toggle.getAttribute("aria-checked")) !== String(isPrivate)) await toggle.click()
	await expect(toggle).toHaveAttribute("aria-checked", String(isPrivate))
}

/** Token → amount → choice → visibility → review. Leaves the wizard on the review step. */
export async function reviewDeposit(page: Page, plan: DepositPlan): Promise<void> {
	await startDeposit(page, plan)
	const choice = { token: TESTIDS.sendChoiceToken, "token+gas": TESTIDS.sendChoiceTokenGas, gas: TESTIDS.sendChoiceGas }[plan.intent]
	const card = page.locator(tid(choice))
	await expect(card).toBeEnabled({ timeout: 30_000 })
	await card.click()
	await expect(card).toHaveAttribute("aria-selected", "true")
	await setVisibility(page, plan.isPrivate)
	// The route quote lands asynchronously and a landing quote stands a review down: reach the
	// review only once the step has stopped quoting (a found route prints nothing of its own).
	await expect(page.locator(tid(TESTIDS.sendStepAmount))).not.toHaveAttribute("data-route-loading", "true", { timeout: 60_000 })
	await goToReview(page)
	await expect(page.locator(tid(TESTIDS.sendReviewVisibility))).toHaveAttribute("data-visibility", plan.isPrivate ? "private" : "public")
}

async function goToReview(page: Page): Promise<void> {
	await page.locator(tid(TESTIDS.sendAmountNext)).click()
	await expect(page.locator(tid(TESTIDS.sendStepReview))).toBeVisible()
}

/**
 * Confirm the review; the grant (if any) is auto-approved by the test wallet. A read that lands
 * after the review opened (held gas, a re-priced fee) stands the review down with a reason on the
 * amount step — exactly what a user would answer by reviewing again, so the helper does the same,
 * a bounded number of times.
 */
export async function confirmReview(page: Page): Promise<void> {
	const confirm = page.locator(tid(TESTIDS.sendReviewConfirm))
	const stale = page.locator(tid(TESTIDS.sendReviewStale))
	const left = page.locator(`${tid(TESTIDS.stepper)}, ${tid(TESTIDS.receipt)}, ${tid(TESTIDS.sendGrantPending)}`)
	for (let attempt = 0; attempt < 4; attempt++) {
		await expect(confirm).toBeEnabled({ timeout: 60_000 })
		await confirm.click()
		await expect(left.or(stale).first()).toBeVisible({ timeout: 120_000 })
		if (!(await stale.isVisible())) return
		console.log(`[send] review stood down: ${(await stale.textContent())?.trim()}`)
		await goToReview(page)
	}
	throw new Error("the review was stood down four times in a row")
}

export interface Receipt {
	hero: string
	gas: string | null
}

/** Waits out the whole bridge — L1 signatures, the deposit, the L2 sync, the claim — for the receipt. */
export async function waitForReceipt(page: Page, timeout = 8 * 60_000): Promise<Receipt> {
	const receipt = page.locator(tid(TESTIDS.receipt))
	await expect(receipt).toBeVisible({ timeout })
	// A token send's hero is the token row; a gas-only bridge's hero IS the Fee Juice row.
	const hero = receipt.locator(`${tid(TESTIDS.sendReceiptToken)}, ${tid(TESTIDS.receiptFuel)}`).first()
	const gas = receipt.locator(tid(TESTIDS.sendReceiptGas))
	return {
		hero: (await hero.textContent()) ?? "",
		gas: (await gas.count()) > 0 ? await gas.first().textContent() : null,
	}
}

/** The stepper's phases as `key → state`, for asserting which path a send took. */
export async function stepperPhases(page: Page): Promise<Record<string, string>> {
	const phases = page.locator(`${tid(TESTIDS.stepperPhase)}, ${tid(TESTIDS.sendStepperRegister)}`)
	const entries = await phases.evaluateAll((els) =>
		els.map((e) => [(e as HTMLElement).dataset.phase ?? "", (e as HTMLElement).dataset.state ?? ""]),
	)
	return Object.fromEntries(entries)
}
