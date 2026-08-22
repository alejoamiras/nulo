/**
 * Non-network e2e coverage for the POPUP import / export pathways.
 *
 * The import drivers are shared with the onboarding shell — see
 * `helpers/import-drivers.ts` (`onboarding-import.test.ts` reuses the same
 * functions with `ONBOARDING_IMPORT_SHELL`). This file passes
 * `POPUP_IMPORT_SHELL` and adds the popup-only round-trip + full-backup tests.
 *
 * Under KDF v2 the only wallet-level secret import is the 24-word recovery phrase
 * (plain-key + encrypted-key import surfaces were removed).
 *
 * Deferred: true backup file round-trip; passkey import (needs WebAuthn virtualization).
 */
import { expect } from "vitest"
import { clickByTestId, launchExtension, openPopup, test, waitForHash } from "./fixtures/extension"
import {
	buildSyntheticBackup,
	CANONICAL_SEED_24,
	deriveNuloAccountAddress,
	gotoPopupImport,
	importFullBackup,
	importSeed,
	LOCAL_L1_CHAIN_ID,
	makeRecoveryTriple,
	POPUP_IMPORT_SHELL,
	readActiveAccount,
	TEST_PASSWORD,
	writeBackupToTemp,
} from "./helpers/import-drivers"

// ── Standalone import-path tests ────────────────────────────────────────

test("import via recovery phrase (24-word) creates profile and lands on /popup/general", async ({ freshExtensionPerTest }) => {
	const page = await gotoPopupImport(freshExtensionPerTest)
	await importSeed(page, CANONICAL_SEED_24, TEST_PASSWORD, POPUP_IMPORT_SHELL)

	const address = await readActiveAccount(page)
	expect(typeof address).toBe("string")
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)

// ── Round-trip test ─────────────────────────────────────────────────────

/**
 * Round-trip determinism: register a profile in ext1, export its recovery phrase,
 * import in ext2, assert the SAME on-chain address derives (NULO-ACCOUNT-KDF v2:
 * words → PBKDF2 master → deriveAccountSeed → NuloAccount, salt=Fr.ZERO).
 */
test("round-trip: register → export recovery phrase → import in fresh ext → same address", async ({ registeredExtensionPerTest }) => {
	const page1 = await openPopup(registeredExtensionPerTest)
	await waitForHash(page1, "#/popup/general", 15_000)
	const address1 = await readActiveAccount(page1)
	expect(address1.startsWith("0x")).toBe(true)

	await page1.evaluate(() => {
		window.location.hash = "#/popup/settings/security/export/seed"
	})
	await waitForHash(page1, "#/popup/settings/security/export/seed", 5_000)

	await page1.waitForSelector('[data-testid="agree-continue-btn"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page1, "agree-continue-btn")

	await page1.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 5_000 })
	await page1.evaluate((p: string) => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="unlock-password-input"] input')
		if (!input) throw new Error("unlock-password-input not found")
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
		setter?.call(input, p)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, TEST_PASSWORD)
	await clickByTestId(page1, "unlock-submit-btn")

	// The seed page renders the 24-word phrase as a single space-separated string.
	await page1.waitForSelector('[data-testid="reveal-content"] input', { visible: true, timeout: 10_000 })
	const seed = await page1.evaluate(() => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="reveal-content"] input')
		return input?.value ?? ""
	})
	expect(seed.split(" ").length).toBe(24)
	await page1.close()

	const ctx2 = await launchExtension()
	try {
		const page2 = await gotoPopupImport(ctx2)
		await importSeed(page2, seed, TEST_PASSWORD, POPUP_IMPORT_SHELL)
		const address2 = await readActiveAccount(page2)
		expect(address2).toBe(address1)
		expect(ctx2.pageErrors).toEqual([])
		await page2.close()
	} finally {
		await ctx2.browser.close()
	}
}, 120_000)

// ── Full-backup import (synthetic-payload route) ────────────────────────────

test("full backup: fresh install → synthetic backup → /popup/general", async ({ freshExtensionPerTest }) => {
	const { masterBase64, entropyBase64 } = await makeRecoveryTriple()
	// The account row must be derivation-consistent with the master (l1ChainId 31337 = the
	// synthetic Local Network) — the integrity coordinator blocks a mismatched import at finalize.
	const accountAddress = await deriveNuloAccountAddress(masterBase64, LOCAL_L1_CHAIN_ID)
	const filePath = writeBackupToTemp(buildSyntheticBackup({ masterBase64, entropyBase64, accountAddress }))

	const page = await gotoPopupImport(freshExtensionPerTest)
	await importFullBackup(page, filePath, TEST_PASSWORD, POPUP_IMPORT_SHELL)

	const address = await readActiveAccount(page)
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	const storage = await page.evaluate(async () => {
		return await chrome.storage.local.get(["nulo:ui:lastActiveProfile", "nulo:ui:sentinel", "nulo:ui:activeAccount"])
	})
	expect(storage["nulo:ui:lastActiveProfile"]).toBeTruthy()
	expect(storage["nulo:ui:sentinel"]).toBeTruthy()
	expect(storage["nulo:ui:activeAccount"]).toBeTruthy()

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 90_000)
