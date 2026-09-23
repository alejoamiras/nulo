/**
 * Non-network e2e coverage for the ONBOARDING-shell import flow.
 *
 * The onboarding + popup shells share `useProfileImportFlow` and the same import
 * composite components, driven here via `ONBOARDING_IMPORT_SHELL` (only the
 * name-input testid, submit-button testid, and success hash differ).
 *
 * Under KDF v2 the only secret import is the 24-word recovery phrase (plain-key +
 * encrypted-key imports were removed). Passkey import is deferred (needs WebAuthn
 * virtualization).
 */
import { expect } from "vitest"
import { test } from "./fixtures/extension"
import {
	CANONICAL_SEED_24,
	gotoOnboardingImport,
	importSeed,
	ONBOARDING_IMPORT_SHELL,
	readActiveAccount,
	TEST_PASSWORD,
} from "./helpers/import-drivers"

test("onboarding: import via recovery phrase (24-word) creates profile", async ({ freshExtensionPerTest }) => {
	const page = await gotoOnboardingImport(freshExtensionPerTest)
	await importSeed(page, CANONICAL_SEED_24, TEST_PASSWORD, ONBOARDING_IMPORT_SHELL)

	const address = await readActiveAccount(page)
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)
