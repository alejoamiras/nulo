/**
 * Non-network e2e coverage for the ONBOARDING-shell import flow.
 *
 * Closes the gap flagged in the Q2 review: onboarding create-password had e2e
 * coverage (`onboarding-tab.test.ts`) but onboarding IMPORT had none — even
 * though Q2 refactored both shells' import onto the shared `useProfileImportFlow`
 * composable. These reuse the exact popup drivers via `ONBOARDING_IMPORT_SHELL`
 * (the import method picker + secret inputs are shared composite components;
 * only the name-input testid, submit-button testid, and success hash differ).
 *
 * Deferred (as on the popup side): passkey import (needs WebAuthn virtualization).
 */
import { expect } from "vitest"
import { test } from "./fixtures/extension"
import {
	CANONICAL_SEED_24,
	gotoOnboardingImport,
	importEncryptedKey,
	importPlainKey,
	importSeed,
	makeEncryptedKeyBlob,
	makeRandomMasterBase64,
	ONBOARDING_IMPORT_SHELL,
	readActiveAccount,
	TEST_PASSWORD,
} from "./helpers/import-drivers"

test("onboarding: import via plain key creates profile and lands on /onboarding/learn", async ({ freshExtensionPerTest }) => {
	const masterBase64 = await makeRandomMasterBase64()

	const page = await gotoOnboardingImport(freshExtensionPerTest)
	await importPlainKey(page, masterBase64, TEST_PASSWORD, ONBOARDING_IMPORT_SHELL)

	const address = await readActiveAccount(page)
	expect(typeof address).toBe("string")
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)

test("onboarding: import via seed phrase (24-word) creates profile", async ({ freshExtensionPerTest }) => {
	const page = await gotoOnboardingImport(freshExtensionPerTest)
	await importSeed(page, CANONICAL_SEED_24, TEST_PASSWORD, ONBOARDING_IMPORT_SHELL)

	const address = await readActiveAccount(page)
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)

test("onboarding: import via encrypted key creates profile", async ({ freshExtensionPerTest }) => {
	const masterBase64 = await makeRandomMasterBase64()

	const page = await gotoOnboardingImport(freshExtensionPerTest)
	const encrypted = await makeEncryptedKeyBlob(page, masterBase64, TEST_PASSWORD)
	await importEncryptedKey(page, encrypted, TEST_PASSWORD, ONBOARDING_IMPORT_SHELL)

	const address = await readActiveAccount(page)
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)
