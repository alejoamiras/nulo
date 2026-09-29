/**
 * A held Enter acts once. On the recovery phrase's Retrieve the button ignores the repeat, so the
 * held key makes one retrieval; in onboarding's confirm field the browser's implicit submission
 * activates Create once. The page records each Enter keydown, click and submit, so a driver that
 * sends no repeat, or a repeat that lands anywhere but the control, fails on the record.
 */
import type { Page } from "puppeteer"
import { expect } from "vitest"
import { TEST_PASSWORD } from "./fixtures/constants"
import { clickByTestId, openOnboarding, openPopup, replaceInputValue, test, waitForHash } from "./fixtures/extension"
import { navigateByHash, readProfileNames } from "./fixtures/helpers"
import { waitForFocus } from "./helpers/pointer-probes"

type KeyRecord = { type: "keydown"; on: string | null; repeat: boolean } | { type: "click"; on: string | null } | { type: "submit" }

const sel = (testid: string) => `[data-testid="${testid}"]`

/** From now on, records in order each Enter keydown (its nearest testid and `repeat`), each click
 *  (its nearest testid) and each submit, at the window's capture phase. */
async function recordKeys(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as { __keyRecord?: unknown[] }
		w.__keyRecord = []
		const nearest = (t: EventTarget | null) =>
			t instanceof Element ? (t.closest("[data-testid]")?.getAttribute("data-testid") ?? null) : null
		const push = (r: unknown) => w.__keyRecord?.push(r)
		window.addEventListener(
			"keydown",
			(e) => {
				if (e.key === "Enter") push({ type: "keydown", on: nearest(e.target), repeat: e.repeat })
			},
			true,
		)
		window.addEventListener("click", (e) => push({ type: "click", on: nearest(e.target) }), true)
		window.addEventListener("submit", () => push({ type: "submit" }), true)
	})
}

async function readRecord(page: Page): Promise<KeyRecord[]> {
	return page.evaluate(() => (window as unknown as { __keyRecord?: KeyRecord[] }).__keyRecord ?? [])
}

const clicksOn = (record: KeyRecord[], testid: string) => record.filter((r) => r.type === "click" && r.on === testid)

async function focusWhenEnabled(page: Page, testid: string): Promise<void> {
	await page.waitForFunction(
		(s: string) => {
			const el = document.querySelector<HTMLButtonElement | HTMLInputElement>(s)
			return Boolean(el && !el.disabled)
		},
		{ timeout: 10_000, polling: 50 },
		sel(testid),
	)
	await page.focus(sel(testid))
	await waitForFocus(page, testid)
}

/** Holds Enter on the control: a press, its repeat, and the release, recorded from the press on. */
async function holdEnterOn(page: Page, testid: string): Promise<void> {
	await focusWhenEnabled(page, testid)
	await recordKeys(page)
	await page.keyboard.down("Enter")
	await page.keyboard.down("Enter")
	await page.keyboard.up("Enter")
}

function expectHeldEnterOn(record: KeyRecord[], testid: string): void {
	expect(
		record.filter((r) => r.type === "keydown"),
		`the press and its repeat did not both reach ${testid}, so the held Enter proved nothing: ${JSON.stringify(record)}`,
	).toEqual([
		{ type: "keydown", on: testid, repeat: false },
		{ type: "keydown", on: testid, repeat: true },
	])
}

test("a held Enter on Retrieve retrieves once", { timeout: 120_000 }, async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")
	await navigateByHash(page, "#/popup/settings/security/export", 15_000)
	await navigateByHash(page, "#/popup/settings/security/export/seed", 15_000)
	await clickByTestId(page, "agree-continue-btn")

	// A wrong password keeps Retrieve on the page after its retrieval, so the repeat lands on the button
	// however fast that retrieval ends. On Firefox a right one reveals the phrase before the repeat.
	await replaceInputValue(page, sel("unlock-password-input"), "not-the-password-1")
	await holdEnterOn(page, "unlock-submit-btn")
	await page.waitForSelector(sel("unlock-error-text"), { visible: true, timeout: 30_000 })
	const record = await readRecord(page)
	expectHeldEnterOn(record, "unlock-submit-btn")
	expect(clicksOn(record, "unlock-submit-btn"), `Retrieve ran more than once: ${JSON.stringify(record)}`).toHaveLength(1)

	await replaceInputValue(page, sel("unlock-password-input"), TEST_PASSWORD)
	await focusWhenEnabled(page, "unlock-submit-btn")
	await page.keyboard.press("Enter")
	await page.waitForSelector(sel("reveal-content"), { visible: true, timeout: 30_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("Enter in the confirm field creates the wallet once", { timeout: 120_000 }, async ({ freshExtensionPerTest: extension }) => {
	const page = await openOnboarding(extension)
	await clickByTestId(page, "onboarding-welcome-create")
	await waitForHash(page, "#/onboarding/create", 10_000)
	await replaceInputValue(page, sel("onboarding-password-input"), TEST_PASSWORD)
	await replaceInputValue(page, sel("onboarding-password-confirm-input"), TEST_PASSWORD)

	await holdEnterOn(page, "onboarding-password-confirm-input")
	await waitForHash(page, "#/onboarding/learn", 60_000)

	const record = await readRecord(page)
	expectHeldEnterOn(record, "onboarding-password-confirm-input")
	// Implicit submission clicks the form's default button. Create's click handler disables it before
	// the button's own activation runs, so no submit event follows.
	const activations = clicksOn(record, "onboarding-submit-create")
	expect(activations, `the Enter did not activate Create exactly once: ${JSON.stringify(record)}`).toHaveLength(1)
	expect(await readProfileNames(page)).toEqual(["Main"])

	expect(extension.consoleErrors).toEqual([])
	expect(extension.pageErrors).toEqual([])
})
