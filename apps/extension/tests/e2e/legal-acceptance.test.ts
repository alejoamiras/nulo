/**
 * The Terms acceptance, end to end against the built extension. Every launch here names the
 * acceptance state it starts from; the rest of the suite runs on the fixture's `current` default
 * and never meets the gate.
 */
import { describe, expect } from "vitest"
import { LEGAL_MANIFEST } from "@nulo/legal"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "puppeteer"
import { extensionUrl, reloadExtensionPage, waitForOpenedUrl } from "./fixtures/browser"
import {
	clickByTestId,
	expectNoNameField,
	launchExtension,
	openOnboarding,
	openPopup,
	registerProfile,
	replaceInputValue,
	test,
	waitForHash,
} from "./fixtures/extension"
import { ensureUnlocked, lockWallet, navigateByHash, waitForLockScreen } from "./fixtures/helpers"
import { setupPasskeyVirtualAuth } from "./fixtures/passkey"
import { exportAccountBody, FIRST_ACCOUNT_NAME } from "./helpers/account-io"
import { armBackupDownloadCapture, readCapturedBackupDownload } from "./helpers/backup-export"
import { CANONICAL_SEED_24, importSeed, ONBOARDING_IMPORT_SHELL, readActiveAccount, TEST_PASSWORD } from "./helpers/import-drivers"
import {
	acceptOnboardingTerms,
	isContinueDisabled,
	isSheetPresent,
	pointerClick,
	readLegalRecord,
	reloadWithLegalState,
	waitForSheet,
	waitForTermsGate,
} from "./helpers/legal-drivers"

const CURRENT_TERMS = LEGAL_MANIFEST.terms.at(-1)?.version
const CURRENT_PRIVACY = LEGAL_MANIFEST.privacy.at(-1)?.version

describe("onboarding: the Terms gate", () => {
	test("S1 a fresh install cannot continue unticked; ticking records the manifest version, then create works", async ({
		freshExtensionPerTest: extension,
	}) => {
		const page = await openOnboarding(extension, { legal: "missing" })
		await clickByTestId(page, "onboarding-welcome-create")
		await waitForTermsGate(page, "create")
		expect(await page.$$eval('[data-testid="legal-point"]', (rows) => rows.length)).toBe(4)
		expect(await isContinueDisabled(page)).toBe(true)
		expect(await page.$eval('[data-testid="legal-consent-checkbox"]', (el) => el.getAttribute("aria-checked"))).toBe("false")
		// A click on the disabled button must not record anything.
		await page.$eval('[data-testid="legal-continue"]', (el) => (el as HTMLButtonElement).click())
		expect(await readLegalRecord(page)).toBeUndefined()

		const before = Date.now()
		await acceptOnboardingTerms(page, "create")

		const record = await readLegalRecord(page)
		expect(record).toMatchObject({ termsVersion: CURRENT_TERMS, privacyVersionShown: CURRENT_PRIVACY, surface: "onboarding" })
		expect(record?.acceptedAt).toBeGreaterThanOrEqual(before)
		expect(record?.history).toHaveLength(1)

		await expectNoNameField(page, "onboarding-create-page", "onboarding-name-input")
		await replaceInputValue(page, '[data-testid="onboarding-password-input"]', TEST_PASSWORD)
		await replaceInputValue(page, '[data-testid="onboarding-password-confirm"]', TEST_PASSWORD)
		await clickByTestId(page, "onboarding-submit-create")
		await waitForHash(page, "#/onboarding/learn", 30_000)

		expect(extension.pageErrors).toEqual([])
		await page.close()
	}, 90_000)

	test("S2 the gate cannot be skipped by jumping to a later step", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension, { legal: "missing" })
		for (const step of ["create", "import", "learn", "fees", "presto", "done"]) {
			await page.evaluate((hash) => {
				window.location.hash = hash
			}, `#/onboarding/${step}`)
			await waitForTermsGate(page, step === "import" ? "import" : "create")
		}
		expect(await readLegalRecord(page)).toBeUndefined()
		await page.close()
	}, 60_000)

	test("S3 the import path passes the same gate and resumes at import", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension, { legal: "missing" })
		await clickByTestId(page, "onboarding-welcome-import")
		await acceptOnboardingTerms(page, "import")
		expect(await readLegalRecord(page)).toMatchObject({ termsVersion: CURRENT_TERMS, surface: "onboarding" })

		await importSeed(page, CANONICAL_SEED_24, TEST_PASSWORD, ONBOARDING_IMPORT_SHELL)
		expect((await readActiveAccount(page)).startsWith("0x")).toBe(true)

		expect(extension.pageErrors).toEqual([])
		await page.close()
	}, 90_000)
})

const textOf = (page: Page, testid: string) =>
	page.$eval(`[data-testid="${testid}"]`, (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())

/** Decline from the sheet and land on the declined screen. */
async function declineFromSheet(page: Page, variant: "changed" | "review"): Promise<void> {
	await waitForSheet(page, variant)
	await pointerClick(page, "legal-sheet-not-now")
	await waitForHash(page, "#/popup/legal/declined", 10_000)
	await page.waitForSelector('[data-testid="legal-declined"]', { visible: true })
}

/** Reveal the recovery phrase through the page flow, with real pointer input on the first control. */
async function revealSeedPhrase(page: Page): Promise<string> {
	await navigateByHash(page, "#/popup/settings/security/export", 15_000)
	await navigateByHash(page, "#/popup/settings/security/export/seed", 15_000)
	await pointerClick(page, "agree-continue-btn")
	await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page, '[data-testid="unlock-password-input"]', TEST_PASSWORD)
	await pointerClick(page, "unlock-submit-btn")
	await page.waitForSelector('[data-testid="reveal-content"] input', { visible: true, timeout: 15_000 })
	return page.$eval('[data-testid="reveal-content"] input', (el) => (el as HTMLInputElement).value)
}

/**
 * Assemble a full backup through the page flow and download it. A password profile unlocks first;
 * a passkey profile's agreement starts its WebAuthn ceremony in the page itself, which is exactly
 * what an overlay would break. Returns the parsed file.
 */
async function downloadFullBackup(page: Page, password?: string): Promise<Record<string, unknown>> {
	await navigateByHash(page, "#/popup/settings/security/export", 15_000)
	await navigateByHash(page, "#/popup/settings/security/export/full", 15_000)
	await pointerClick(page, "agree-continue-btn")
	if (password) {
		await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 10_000 })
		await replaceInputValue(page, '[data-testid="unlock-password-input"]', password)
		await pointerClick(page, "unlock-submit-btn")
	}
	await page.waitForFunction(
		() => {
			const download = document.querySelector<HTMLButtonElement>('[data-testid="download-backup-btn"]')
			return !!download && !download.disabled
		},
		{ timeout: 180_000, polling: 250 },
	)
	await armBackupDownloadCapture(page)
	await pointerClick(page, "download-backup-btn")
	return JSON.parse(await readCapturedBackupDownload(page)) as Record<string, unknown>
}

describe("popup: declining never locks a person out", () => {
	test("S4 no record + a profile: sheet, Not now, the declined screen, the Send banner, and it all survives a relaunch", async () => {
		const profileDir = mkdtempSync(join(tmpdir(), "nulo-e2e-legal-"))
		let ctx = await launchExtension({ userDataDir: profileDir })
		try {
			await registerProfile(ctx)
			let page = await openPopup(ctx)
			await waitForHash(page, "#/popup/general", 30_000)
			await reloadWithLegalState(page, "missing")

			await declineFromSheet(page, "review")
			expect(await textOf(page, "legal-declined-version")).toBe(`Terms v${CURRENT_TERMS} not accepted`)
			expect(await page.$$eval('[data-testid="legal-declined-kept"]', (rows) => rows.length)).toBe(3)
			expect(await page.$$eval('[data-testid="legal-declined-paused"]', (rows) => rows.length)).toBe(1)
			expect(await readLegalRecord(page)).toBeUndefined()

			// Declined holds for the session: the wallet is usable and the sheet stays away.
			await navigateByHash(page, "#/popup/send", 15_000)
			await page.waitForSelector('[data-testid="send-legal-banner"]', { visible: true, timeout: 15_000 })
			expect(await isSheetPresent(page)).toBe(false)
			expect(await page.$eval('[data-testid="send-submit"]', (el) => (el as HTMLButtonElement).disabled)).toBe(true)

			// Review on the banner brings the sheet back, over Send.
			await pointerClick(page, "send-legal-review")
			await waitForSheet(page, "review")
			await page.close()

			// A relaunch forgets the dismissal and nothing else: still no record, so the sheet asks again.
			await ctx.close()
			ctx = await launchExtension({ userDataDir: profileDir })
			page = await openPopup(ctx)
			await ensureUnlocked(page)
			await waitForHash(page, "#/popup/general", 30_000)
			expect(await readLegalRecord(page)).toBeUndefined()
			await waitForSheet(page, "review")
		} finally {
			await ctx.close().catch(() => {})
			rmSync(profileDir, { recursive: true, force: true })
		}
	}, 240_000)

	test.each(["missing", "stale", "corrupt"] as const)(
		"S5 %s: the recovery phrase, an account file and a full backup still export, under real pointer input",
		async (seed) => {
			const ctx = await launchExtension()
			try {
				await registerProfile(ctx)
				const page = await openPopup(ctx)
				await waitForHash(page, "#/popup/general", 30_000)
				await reloadWithLegalState(page, seed)
				await declineFromSheet(page, seed === "stale" ? "changed" : "review")

				await pointerClick(page, "legal-declined-export")
				await waitForHash(page, "#/popup/settings/security/export", 10_000)

				const phrase = await revealSeedPhrase(page)
				expect(phrase.split(" ")).toHaveLength(24)
				expect(await isSheetPresent(page)).toBe(false)

				const body = await exportAccountBody(page, FIRST_ACCOUNT_NAME, false)
				expect(Object.keys(JSON.parse(body) as object).length).toBeGreaterThan(0)
				expect(await isSheetPresent(page)).toBe(false)

				// The download's success snack sits over the footer of a page without the nav for 6 s, held
				// while the pointer rests on it, and the next step presses that footer with a real pointer.
				await page.mouse.move(180, 40)
				await page.waitForFunction(() => !document.querySelector('[data-testid="snackbar"]'), { timeout: 10_000, polling: 100 })
				const backup = await downloadFullBackup(page, TEST_PASSWORD)
				expect(Object.keys(backup).length).toBeGreaterThan(0)
				expect(await isSheetPresent(page)).toBe(false)
				// The acceptance record is device-local: a backup must not carry it to another device.
				expect(JSON.stringify(backup)).not.toContain("nulo:legal:accepted")
			} finally {
				await ctx.close().catch(() => {})
			}
		},
		480_000,
	)

	test("S7 newer Terms: the sheet lists the change, Continue records it, the banner goes and history grows", async ({
		registeredExtensionPerTest: extension,
	}) => {
		const page = await openPopup(extension)
		await waitForHash(page, "#/popup/general", 30_000)
		await reloadWithLegalState(page, "stale")

		await waitForSheet(page, "changed")
		expect(await textOf(page, "legal-sheet-title")).toBe("The terms have changed")
		expect(await page.$$eval('[data-testid="legal-change"]', (rows) => rows.map((row) => row.textContent?.trim()))).toEqual(
			LEGAL_MANIFEST.terms.flatMap((version) => version.changes),
		)
		expect(await textOf(page, "legal-consent-label")).toBe(`I agree to the Terms of Use, version ${CURRENT_TERMS}.`)
		expect(await isContinueDisabled(page)).toBe(true)

		await pointerClick(page, "legal-consent-checkbox")
		await pointerClick(page, "legal-continue")
		await page.waitForFunction(() => !document.querySelector('[data-testid="legal-sheet"]'), { timeout: 10_000 })

		const record = await readLegalRecord(page)
		expect(record).toMatchObject({ termsVersion: CURRENT_TERMS, surface: "popup" })
		expect(record?.history).toHaveLength(2)

		await navigateByHash(page, "#/popup/send", 15_000)
		await page.waitForSelector('[data-testid="send-submit"]', { visible: true, timeout: 15_000 })
		expect(await page.$('[data-testid="send-legal-banner"]')).toBeNull()
		await page.close()
	}, 120_000)

	test("S8 the sheet stays off the lock screen, register, and every export route", async ({ registeredExtensionPerTest: extension }) => {
		const page = await openPopup(extension)
		await waitForHash(page, "#/popup/general", 30_000)
		await reloadWithLegalState(page, "missing")
		await waitForSheet(page, "review")

		for (const route of ["", "/seed", "/account", "/full"]) {
			await navigateByHash(page, `#/popup/settings/security/export${route}`, 15_000)
			await page.waitForFunction(() => !document.querySelector('[data-testid="legal-sheet"]'), { timeout: 10_000 })
		}

		// Back on a wallet page it returns, so the routes above were exclusions, not a dismissal.
		await navigateByHash(page, "#/popup/general", 15_000)
		await waitForSheet(page, "review")
		await pointerClick(page, "legal-sheet-not-now")
		await waitForHash(page, "#/popup/legal/declined", 10_000)

		await navigateByHash(page, "#/popup/general", 15_000)
		await lockWallet(page)
		await waitForLockScreen(page)
		await page.evaluate(() => chrome.storage.session.remove("nulo:legal:dismissed"))
		await reloadExtensionPage(page)
		await waitForLockScreen(page)
		expect(await isSheetPresent(page)).toBe(false)
		await page.close()
	}, 180_000)

	test("S8b a fresh wallet's register screen shows plain links and no sheet", async ({ freshExtensionPerTest: extension }) => {
		const page = await openPopup(extension)
		await waitForHash(page, "#/popup/register", 30_000)
		await reloadRegisterWithoutRecord(page)
		await page.waitForSelector('[data-testid="legal-register-terms"]', { visible: true, timeout: 15_000 })
		await page.waitForSelector('[data-testid="legal-register-privacy"]', { visible: true })
		expect(await isSheetPresent(page)).toBe(false)
		await page.close()
	}, 90_000)

	test("S9 Settings, About: the accepted version and date; declined reads Not accepted and leads back to the sheet", async ({
		registeredExtensionPerTest: extension,
	}) => {
		const page = await openPopup(extension)
		await waitForHash(page, "#/popup/general", 30_000)

		await navigateByHash(page, "#/popup/settings/about", 15_000)
		await page.waitForSelector('[data-testid="legal-about-accepted"]', { visible: true, timeout: 15_000 })
		const accepted = await textOf(page, "legal-about-accepted")
		expect(accepted).toContain("You accepted the Terms")
		expect(accepted).toContain(`Terms v${CURRENT_TERMS}`)
		expect(await textOf(page, "legal-about-privacy")).toContain(`Privacy Policy v${CURRENT_PRIVACY}`)

		await reloadWithLegalState(page, "missing")
		await declineFromSheet(page, "review")
		await navigateByHash(page, "#/popup/settings/about", 15_000)
		await page.waitForSelector('[data-testid="legal-about-not-accepted"]', { visible: true, timeout: 15_000 })
		expect(await textOf(page, "legal-about-not-accepted")).toContain("Not accepted")
		expect(await page.$('[data-testid="legal-about-accepted"]')).toBeNull()

		await pointerClick(page, "legal-about-not-accepted")
		await waitForHash(page, "#/popup/general", 10_000)
		await waitForSheet(page, "review")
		await page.close()
	}, 150_000)
})

/** The register screen with no acceptance stored, as a fresh install has it. */
async function reloadRegisterWithoutRecord(page: Page): Promise<void> {
	await page.evaluate((key) => chrome.storage.local.remove(key), "nulo:legal:accepted")
	await reloadExtensionPage(page)
	await waitForHash(page, "#/popup/register", 30_000)
}

describe("popup: a passkey wallet that declined", () => {
	test("S6 the full backup's in-page passkey ceremony completes and the file downloads, with the Terms declined", async ({
		freshExtensionPerTest: extension,
	}) => {
		const page = await openPopup(extension)
		const auth = await setupPasskeyVirtualAuth(extension.browser, page)
		try {
			await waitForHash(page, "#/popup/register", 15_000)
			await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), { timeout: 15_000, polling: 500 })
			await clickByTestId(page, "register-create-btn")
			await expectNoNameField(page, "register-page", "register-name-input")
			await clickByTestId(page, "register-method-passkey")
			await clickByTestId(page, "register-submit-btn")
			await waitForHash(page, "#/popup/general", 60_000)

			await reloadWithLegalState(page, "stale")
			await declineFromSheet(page, "changed")

			const backup = await downloadFullBackup(page)
			expect(Object.keys(backup).length).toBeGreaterThan(0)
			expect(await isSheetPresent(page)).toBe(false)
		} finally {
			await auth.cleanup()
			await page.close().catch(() => {})
		}
	}, 300_000)
	test("S10 Settings, About: Open-source licences opens the notices file the build shipped", async ({
		registeredExtensionPerTest: extension,
	}) => {
		const page = await openPopup(extension)
		await waitForHash(page, "#/popup/general", 30_000)
		await navigateByHash(page, "#/popup/settings/about", 15_000)
		await page.waitForSelector('[data-testid="legal-about-licences"]', { visible: true, timeout: 15_000 })

		await pointerClick(page, "legal-about-licences")
		const expected = extensionUrl(extension.extensionId, "/THIRD-PARTY-NOTICES.txt")
		await waitForOpenedUrl(extension.browser, expected, 15_000)

		// Read through the extension origin rather than the tab's text/plain rendering.
		const notices = await page.evaluate(async (url) => (await fetch(url)).text(), expected)
		expect(notices.startsWith("THIRD-PARTY NOTICES\n")).toBe(true)
		for (const name of ["@aztec/sqlite3mc-wasm@", "@alejoamiras/presto@", "@vue/runtime-core@", "buffer@"]) {
			expect(notices).toContain(`\n${name}`)
		}
		await page.close()
	}, 90_000)
})
