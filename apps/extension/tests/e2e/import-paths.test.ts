/**
 * Non-network e2e coverage for the POPUP import / export pathways.
 *
 * The import drivers are shared with the onboarding shell — see
 * `helpers/import-drivers.ts` (`onboarding-import.test.ts` reuses the same
 * functions with `ONBOARDING_IMPORT_SHELL`). This file passes
 * `POPUP_IMPORT_SHELL` and adds the popup-only round-trip + full-backup tests.
 *
 * Gaps closed here:
 * - Standalone import via seed / plain key / encrypted key.
 * - Round-trip determinism: register → export → import in fresh ext → same address.
 * - Full-backup import (synthetic payload) + duplicate-address rejection.
 *
 * Deferred: true backup file round-trip; passkey import (needs WebAuthn virtualization).
 */
import { expect } from "vitest"
import { clickByTestId, launchExtension, openPopup, waitForHash, test } from "./fixtures/extension"
import {
	buildSyntheticBackup,
	CANONICAL_SEED_24,
	deriveNuloAccountAddress,
	gotoPopupImport,
	importEncryptedKey,
	importFullBackup,
	importPlainKey,
	importSeed,
	makeEncryptedKeyBlob,
	makeRandomMasterBase64,
	POPUP_IMPORT_SHELL,
	readActiveAccount,
	TEST_PASSWORD,
	writeBackupToTemp,
} from "./helpers/import-drivers"

// ── Standalone import-path tests ────────────────────────────────────────

test("import via plain key creates profile and lands on /popup/general", async ({ freshExtensionPerTest }) => {
	const masterBase64 = await makeRandomMasterBase64()

	const page = await gotoPopupImport(freshExtensionPerTest)
	await importPlainKey(page, masterBase64, TEST_PASSWORD, POPUP_IMPORT_SHELL)

	const address = await readActiveAccount(page)
	expect(typeof address).toBe("string")
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)

test("import via encrypted key creates profile", async ({ freshExtensionPerTest }) => {
	const masterBase64 = await makeRandomMasterBase64()

	const page = await gotoPopupImport(freshExtensionPerTest)
	const encrypted = await makeEncryptedKeyBlob(page, masterBase64, TEST_PASSWORD)
	await importEncryptedKey(page, encrypted, TEST_PASSWORD, POPUP_IMPORT_SHELL)

	const address = await readActiveAccount(page)
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)

test("import via seed phrase (24-word) creates profile", async ({ freshExtensionPerTest }) => {
	const page = await gotoPopupImport(freshExtensionPerTest)
	await importSeed(page, CANONICAL_SEED_24, TEST_PASSWORD, POPUP_IMPORT_SHELL)

	const address = await readActiveAccount(page)
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)

// ── Round-trip tests ────────────────────────────────────────────────────

/**
 * Round-trip determinism: register a profile in ext1, export plain key,
 * import in ext2, assert the SAME on-chain address derives.
 *
 *   accountAddress = NuloAccount(secret, salt=Fr.ZERO).address
 *   secret = poseidon2Hash([master, chainId, accountType, index])
 */
test("round-trip: register → export plain key → import in fresh ext → same address", async ({ registeredExtensionPerTest }) => {
	const page1 = await openPopup(registeredExtensionPerTest)
	await waitForHash(page1, "#/popup/general", 15_000)
	const address1 = await readActiveAccount(page1)
	expect(address1.startsWith("0x")).toBe(true)

	// Walk through the export-key reveal flow to capture the plain master.
	await page1.evaluate(() => {
		window.location.hash = "#/popup/settings/security/export/key"
	})
	await waitForHash(page1, "#/popup/settings/security/export/key", 5_000)

	// Step 1: pick the "Plain" variant (the agree-continue button only renders
	// after a variant is selected).
	await page1.waitForSelector('[data-testid="key-variant-plain-btn"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page1, "key-variant-plain-btn")

	// Step 2: agree to the risk disclaimer.
	await page1.waitForSelector('[data-testid="agree-continue-btn"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page1, "agree-continue-btn")

	// Unlock to populate `privateKey.value` (rendered in the SecretRevealCard).
	await page1.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 5_000 })
	await page1.evaluate((p: string) => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="unlock-password-input"] input')
		if (!input) throw new Error("unlock-password-input not found")
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
		setter?.call(input, p)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, TEST_PASSWORD)
	await clickByTestId(page1, "unlock-submit-btn")

	await page1.waitForSelector('[data-testid="reveal-content"] input', { visible: true, timeout: 10_000 })
	const masterBase64 = await page1.evaluate(() => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="reveal-content"] input')
		return input?.value ?? ""
	})
	expect(masterBase64.length).toBeGreaterThan(0)
	await page1.close()

	// Launch a fresh extension and import the captured master.
	const ctx2 = await launchExtension()
	try {
		const page2 = await gotoPopupImport(ctx2)
		await importPlainKey(page2, masterBase64, TEST_PASSWORD, POPUP_IMPORT_SHELL)
		const address2 = await readActiveAccount(page2)
		expect(address2).toBe(address1)
		expect(ctx2.pageErrors).toEqual([])
		await page2.close()
	} finally {
		await ctx2.browser.close()
	}
}, 90_000)

test("round-trip: register → export seed → import in fresh ext → same address", async ({ registeredExtensionPerTest }) => {
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

test("round-trip: register → export encrypted key → import in fresh ext → same address", async ({ registeredExtensionPerTest }) => {
	const page1 = await openPopup(registeredExtensionPerTest)
	await waitForHash(page1, "#/popup/general", 15_000)
	const address1 = await readActiveAccount(page1)
	expect(address1.startsWith("0x")).toBe(true)

	await page1.evaluate(() => {
		window.location.hash = "#/popup/settings/security/export/key"
	})
	await waitForHash(page1, "#/popup/settings/security/export/key", 5_000)

	await page1.waitForSelector('[data-testid="key-variant-encrypted-btn"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page1, "key-variant-encrypted-btn")

	// Poll until exportEncrypted resolves and the blob lands in the card.
	await page1.waitForSelector('[data-testid="reveal-content"] input', { visible: true, timeout: 10_000 })
	const encrypted = await page1.evaluate(() => {
		return new Promise<string>((resolve, reject) => {
			const start = Date.now()
			const tick = () => {
				const input = document.querySelector<HTMLInputElement>('[data-testid="reveal-content"] input')
				const v = input?.value ?? ""
				if (v.length > 0) return resolve(v)
				if (Date.now() - start > 10_000) return reject(new Error("encrypted blob never rendered"))
				setTimeout(tick, 100)
			}
			tick()
		})
	})
	expect(encrypted.length).toBeGreaterThan(0)
	await page1.close()

	const ctx2 = await launchExtension()
	try {
		const page2 = await gotoPopupImport(ctx2)
		await importEncryptedKey(page2, encrypted, TEST_PASSWORD, POPUP_IMPORT_SHELL)
		const address2 = await readActiveAccount(page2)
		expect(address2).toBe(address1)
		expect(ctx2.pageErrors).toEqual([])
		await page2.close()
	} finally {
		await ctx2.browser.close()
	}
}, 90_000)

// ── Full-backup import (synthetic-payload route) ────────────────────────────

test("full backup: fresh install → synthetic plain backup → /popup/general", async ({ freshExtensionPerTest }) => {
	const masterBase64 = await makeRandomMasterBase64()
	// The account row must be derivation-consistent with the master (chainId 31337 = the
	// synthetic network) — the integrity coordinator blocks a mismatched import at finalize.
	const accountAddress = await deriveNuloAccountAddress(masterBase64, 31337)
	const filePath = writeBackupToTemp(buildSyntheticBackup({ masterBase64, accountAddress }))

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

test("full backup: an account address shared with an existing profile imports into its own profile", async ({
	registeredExtensionPerTest,
}) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general", 15_000)
	const existingAddress = await readActiveAccount(page)
	expect(existingAddress.startsWith("0x")).toBe(true)

	// A backup carrying the SAME account address as the installed profile — what
	// you get by importing one mnemonic twice. Account rows are keyed by
	// (profileId, chainId, address), so the imported profile owns its own row
	// instead of colliding with the existing one; this used to be refused with
	// "An account from this backup is already in your wallet".
	const masterBase64 = await makeRandomMasterBase64()
	const filePath = writeBackupToTemp(buildSyntheticBackup({ masterBase64, profileName: "Second", accountAddress: existingAddress }))

	await page.evaluate(() => {
		window.location.hash = "#/popup/import"
	})
	await waitForHash(page, "#/popup/import", 5_000)

	await importFullBackup(page, filePath, TEST_PASSWORD, POPUP_IMPORT_SHELL)

	// Both profiles now exist, and each holds its own row for that address.
	const stored = await page.evaluate(
		() =>
			new Promise<{ profiles: number; accountRows: string[] }>((resolve) => {
				chrome.storage.local.get(null, (all) => {
					const keys = Object.keys(all)
					resolve({
						profiles: keys.filter((k) => k.startsWith("nulo:core:profiles@")).length,
						accountRows: keys.filter((k) => k.startsWith("nulo:core:accounts@")),
					})
				})
			}),
	)
	expect(stored.profiles).toBe(2)

	// Two rows, same address, different owning profiles — neither took the other's.
	const rowsForAddress = stored.accountRows.filter((k) => k.includes(existingAddress))
	expect(rowsForAddress.length).toBe(2)

	expect(registeredExtensionPerTest.pageErrors).toEqual([])
	await page.close()
	// Importing into an EXISTING install can run the app's own bounded recovery
	// leg before it routes; the driver waits up to 300s for it.
}, 320_000)
