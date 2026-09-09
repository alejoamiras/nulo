/** The Aztec connect flow, testid-only. Which panel drives it depends on the tab (bridge or drip). */
import { expect, type Frame, type Page } from "@playwright/test"
import { TESTIDS } from "../../../src/lib/testids"
import type { TestWalletProfile } from "../test-wallet/profile"

export const tid = (t: string) => `[data-testid="${t}"]`

/** The id the test wallet announces itself under — profile-keyed, so the picker row is unambiguous. */
export const walletIdOf = (profile: TestWalletProfile) => `nulo-test-wallet-${profile}`

export interface ConnectOptions {
	profile: TestWalletProfile
	/** Which panel's connect button to press; the bridge one lives on the Send tab. */
	panel?: "bridge" | "drip"
	/** The actor to select when the grant lists several; defaults to the first row. */
	account?: string
}

/** Connect tools to a test-wallet profile: picker → emoji verification → grant → account choice. */
export async function connectAztec(page: Page, o: ConnectOptions): Promise<void> {
	const panel = o.panel ?? "bridge"
	const ids =
		panel === "bridge"
			? { connect: TESTIDS.bridgeL2Connect, status: TESTIDS.bridgeL2Status }
			: { connect: TESTIDS.btnConnect, status: TESTIDS.status }
	const row = page.locator(`${tid(TESTIDS.walletPickerRow)}[data-wallet-id="${walletIdOf(o.profile)}"]`)
	await openPickerWith(page, ids.connect, row)
	await row.locator(tid(TESTIDS.walletPickerConnect)).click()
	await expect(page.locator(tid(TESTIDS.verificationModal))).toBeVisible()
	await page.locator(tid(TESTIDS.btnVerifyConfirm)).click()
	await chooseAccountIfAsked(page, o.account)
	await expect(page.locator(tid(ids.status))).toHaveAttribute("data-status", "connected", { timeout: 120_000 })
}

/**
 * Open the picker until it lists the wanted wallet. Discovery probes every listed wallet URL with a
 * 10 s budget, and a frame that posts READY after the probe left it is missed by that scan — a
 * page connecting right after load sees only the fastest frame. Cancelling and reopening scans
 * again, with every frame ready by then.
 */
async function openPickerWith(page: Page, connect: string, row: ReturnType<Page["locator"]>): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		await page.locator(tid(connect)).first().click()
		try {
			await expect(row).toBeVisible({ timeout: 15_000 })
			return
		} catch (e) {
			if (attempt >= 2) throw e
			await page.locator(tid(TESTIDS.walletPickerCancel)).click()
			await expect(page.locator(tid(TESTIDS.walletPicker))).toBeHidden()
		}
	}
}

/**
 * Drive whatever state the Aztec connection is in to `connected` — a page that reloaded with a
 * remembered wallet: the reconnect may already sit at the emoji check, may still be idle (then
 * Connect skips the picker and goes straight to that check), or may have erred. Every stop on
 * the way (picker row, emoji check, account choice) is answered as it appears.
 */
export async function driveToConnected(page: Page, o: ConnectOptions): Promise<void> {
	const status = page.locator(tid(TESTIDS.bridgeL2Status))
	const connect = page.locator(tid(TESTIDS.bridgeL2Connect)).first()
	const row = page.locator(`${tid(TESTIDS.walletPickerRow)}[data-wallet-id="${walletIdOf(o.profile)}"]`)
	const confirm = page.locator(tid(TESTIDS.btnVerifyConfirm))
	const accounts = page.locator(tid(TESTIDS.accountChoice))
	const started = Date.now()
	let state: string | null = null
	while (Date.now() < started + 180_000) {
		state = await status.getAttribute("data-status")
		if (state === "connected") return
		if (await confirm.isVisible()) await confirm.click()
		else if (await accounts.isVisible()) await chooseAccount(page, o.account)
		else if (await row.isVisible()) await row.locator(tid(TESTIDS.walletPickerConnect)).click()
		else if (state === "choosing") await rescanIfMissing(page, row)
		else if (state === "idle" || state === "error" || state === "verifying") await connect.click()
		await page.waitForTimeout(500)
	}
	throw new Error(`the Aztec connection never reached connected (last state: ${state})`)
}

/** In the picker with the wanted row absent: give the scan its budget, then cancel so the next
 *  Connect scans again (see `openPickerWith`). */
async function rescanIfMissing(page: Page, row: ReturnType<Page["locator"]>): Promise<void> {
	const seen = await row.waitFor({ state: "visible", timeout: 15_000 }).then(
		() => true,
		() => false,
	)
	if (!seen) await page.locator(tid(TESTIDS.walletPickerCancel)).click()
}

/** With more than one granted account and none remembered, the choose-account modal pauses the flow. */
async function chooseAccountIfAsked(page: Page, account?: string): Promise<void> {
	const modal = page.locator(tid(TESTIDS.accountChoice))
	const status = page.locator(`[data-status="connected"]`)
	await Promise.race([
		modal.waitFor({ state: "visible", timeout: 120_000 }),
		status.first().waitFor({ state: "attached", timeout: 120_000 }),
	])
	if (!(await modal.isVisible())) return
	await chooseAccount(page, account)
}

async function chooseAccount(page: Page, account?: string): Promise<void> {
	const modal = page.locator(tid(TESTIDS.accountChoice))
	const row = account
		? modal.locator(`${tid(TESTIDS.accountChoiceRow)}[data-address="${account}"]`)
		: modal.locator(tid(TESTIDS.accountChoiceRow)).first()
	await row.click()
	await modal.locator(tid(TESTIDS.accountChoiceContinue)).click()
}

/** The SESSION frame of a connected profile — the one whose `window.__nuloTestWallet` drives the
 *  wallet the page talks to (the discovery frames are separate documents). */
export function walletFrame(page: Page, walletOrigin: string, profile: TestWalletProfile): Frame {
	const frames = page.frames().filter((f) => f.url().startsWith(walletOrigin) && f.url().includes(`profile=${profile}`))
	const frame = frames.at(-1)
	if (!frame) throw new Error(`no session frame for the ${profile} wallet`)
	return frame
}

/** Every address the grant carried, as the switcher menu lists them. */
export async function grantedAccounts(page: Page): Promise<string[]> {
	await page.locator(tid(TESTIDS.accountChip)).first().click()
	const rows = page.locator(tid(TESTIDS.accountMenuRow))
	await expect(rows.first()).toBeVisible()
	const addresses = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.address ?? ""))
	await page.keyboard.press("Escape")
	return addresses
}

/** Select an actor in the account switcher (the chip's menu). */
export async function switchAccount(page: Page, address: string): Promise<void> {
	await page.locator(tid(TESTIDS.accountChip)).first().click()
	await page.locator(`${tid(TESTIDS.accountMenuRow)}[data-address="${address}"]`).click()
	await expect(page.locator(tid(TESTIDS.accountChip)).first()).toContainText(address.slice(2, 6), { ignoreCase: true })
}
