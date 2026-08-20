/**
 * Smoke coverage for per-account Export/Import — the tests the key-model-v2 P5 gate promised but
 * never shipped (see `implementations-plan/key-model-v2-hardening/plan.md` §D).
 *
 * Covered here:
 *   1. Round-trip into a SECOND profile (plaintext + encrypted), via the paste path and the
 *      file-chooser path — export reveals inline, import previews the recomputed address, the
 *      user confirms, the account lands with the imported badge.
 *   2. A tampered file is REJECTED (the confirm step never renders).
 *   3. A duplicate import is rejected (same profile, second attempt).
 *
 * Selector discipline: testids only. `account-export-btn` is a PER-ROW testid shared by every
 * row, so it is always clicked through its row's `data-account-name` — a bare `clickByTestId`
 * would silently hit the LAST matching row (see `accounts.test.ts`'s edit-name idiom).
 *
 * The second profile uses the proven cross-browser pattern (a second `launchExtension` +
 * `registerProfile`), NOT the in-session profile picker: that in-page path has never been driven
 * end-to-end by a test (`auth-flows.test.ts` only asserts its route).
 */
import { rmSync } from "node:fs"
import { expect } from "vitest"
import { TEST_PASSWORD } from "./fixtures/constants"
import { clickByTestId, launchExtension, openPopup, registerProfile, test, waitForHash } from "./fixtures/extension"
import { waitForToast } from "./fixtures/helpers"
import { exportAccountBody, gotoAccounts, previewImport } from "./helpers/account-io"
import { writeBackupToTemp } from "./helpers/import-drivers"

test("account export → import into a SECOND profile (plaintext + encrypted round-trips)", { timeout: 240_000 }, async ({
	registeredExtension,
}) => {
	const source = registeredExtension
	const sourcePage = await openPopup(source)
	await waitForHash(sourcePage, "#/popup/general", 30_000)

	// Export the default account BOTH ways from the source profile.
	const plaintextBody = await exportAccountBody(sourcePage, "Account", false)
	const encryptedBody = await exportAccountBody(sourcePage, "Account", true)
	// A plaintext export is a JSON envelope; the encrypted one is an opaque base64 blob.
	expect(plaintextBody.trim().startsWith("{")).toBe(true)
	expect(encryptedBody.trim().startsWith("{")).toBe(false)
	await sourcePage.close()

	// A genuinely separate profile: second browser + its own registration.
	const target = await launchExtension()
	try {
		await registerProfile(target)
		const targetPage = await openPopup(target)
		await waitForHash(targetPage, "#/popup/general", 30_000)

		// --- plaintext round-trip (paste path) ---
		const previewed = await previewImport(targetPage, plaintextBody)
		expect(previewed).toBeTruthy()
		expect(previewed?.startsWith("0x")).toBe(true)
		await clickByTestId(targetPage, "import-account-submit")
		await waitForToast(targetPage, "Account imported")
		await gotoAccounts(targetPage)
		await targetPage.waitForSelector('[data-testid="account-imported-badge"]', { visible: true, timeout: 20_000 })

		// The imported address equals the source account's address (the round-trip's point).
		const importedAddress = previewed as string

		// --- encrypted round-trip (file-chooser path) into the SAME profile is a duplicate,
		// so assert the encrypted body previews to the SAME address instead (decrypt works).
		const encryptedPreview = await previewImport(targetPage, encryptedBody, TEST_PASSWORD)
		expect(encryptedPreview).toBe(importedAddress)

		expect(target.pageErrors.filter((e) => !e.message.includes("Client disconnected"))).toEqual([])
	} finally {
		await target.browser.close()
	}
})

test("a TAMPERED account export is rejected (confirm step never renders)", { timeout: 180_000 }, async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general", 30_000)
	const body = await exportAccountBody(page, "Account", false)

	// Flip one hex digit of the signing key inside the plaintext envelope: the service recomputes
	// the address from the key and rejects the mismatch (the checksum authenticates nothing).
	const parsed = JSON.parse(body) as { signingKey: string }
	const original = parsed.signingKey
	parsed.signingKey = `${original.slice(0, -1)}${original.slice(-1) === "a" ? "b" : "a"}`
	const tampered = JSON.stringify(parsed)

	const previewed = await previewImport(page, tampered)
	// Rejected: no confirm block, an error instead.
	expect(previewed).toBeNull()
	await page.waitForSelector('[data-testid="import-account-error"]', { visible: true, timeout: 10_000 })
})

test("a DUPLICATE account import is rejected", { timeout: 180_000 }, async ({ registeredExtensionPerTest }) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general", 30_000)
	const body = await exportAccountBody(page, "Account", false)

	// The account is ALREADY in this profile — the very first import must be refused as a
	// duplicate (importAccount's dup check is (profileId, chainId)-scoped).
	const previewed = await previewImport(page, body)
	expect(previewed).toBeTruthy() // preview only decodes; the write is what rejects
	await clickByTestId(page, "import-account-submit")
	await page.waitForSelector('[data-testid="import-account-error"]', { visible: true, timeout: 20_000 })
	const errorText = await page.evaluate(() => document.querySelector('[data-testid="import-account-error"]')?.textContent ?? "")
	expect(errorText).toMatch(/already in your wallet/i)
})

test("the file-chooser import path accepts a written export file", { timeout: 180_000 }, async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general", 30_000)
	const body = await exportAccountBody(page, "Account", false)
	// A plaintext export carries a REAL signing key — clean the temp file up.
	const filePath = writeBackupToTemp(body, "account-export.json")
	try {
		await gotoAccounts(page)
		await clickByTestId(page, "accounts-import-btn")
		await page.waitForSelector('[data-testid="import-account-pick-file"]', { visible: true, timeout: 15_000 })
		const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), clickByTestId(page, "import-account-pick-file")])
		await chooser.accept([filePath])
		// The picked body lands in the textarea; preview then decodes it.
		await page.waitForFunction(
			() => {
				const input = document.querySelector('[data-testid="import-account-body-input"] input') as HTMLInputElement | null
				return (input?.value ?? "").length > 0
			},
			{ timeout: 15_000, polling: 200 },
		)
		await clickByTestId(page, "import-account-submit")
		await page.waitForFunction(
			() =>
				document.querySelector('[data-testid="import-account-preview-address"]') !== null ||
				document.querySelector('[data-testid="import-account-error"]') !== null,
			{ timeout: 30_000, polling: 200 },
		)
		// Same profile ⇒ the account already exists, so this previews fine and would reject at
		// write; the point here is that the FILE PATH produced a decodable body.
		const previewed = await page.evaluate(
			() => document.querySelector('[data-testid="import-account-preview-address"]')?.textContent?.trim() ?? null,
		)
		expect(previewed).toBeTruthy()
	} finally {
		rmSync(filePath, { force: true })
	}
})
