/**
 * Non-network e2e coverage for the import / export pathways.
 *
 * Existing coverage:
 * - Plain-key import is implicitly exercised by the `feeJuiceImportedExtension`
 *   fixture in `tests/e2e/fixtures/extension.ts:419-470`.
 * - Reveal flows for seed/key/full-backup are exercised by `security-backup.test.ts`.
 *
 * Gaps closed by this file:
 * - Standalone "import via seed phrase" test (24-word canonical mnemonic).
 * - Standalone "import via encrypted key" test.
 * - Round-trip tests: register profile → export → import in fresh extension
 *   → assert the same on-chain account address derives. Locks in the
 *   determinism contract (poseidon2Hash([master, chainId, type, index]) +
 *   Fr.ZERO salt) at the e2e level.
 * - Backup-file import (full-backup repair): fresh-install plain import,
 *   plus a duplicate-address rejection that locks in the codex-flagged
 *   fix to the previously-dead `err === "Duplicate address"` string check.
 *
 * Deferred (not in this PR):
 * - True backup round-trip (export the file → re-import). The current tests
 *   feed the importer a synthetic-but-valid backup payload built in node
 *   so we don't have to intercept the `chrome.downloads.download` blob;
 *   covering the encoded round-trip is on the follow-up list.
 * - Passkey import (needs WebAuthn virtualization).
 */
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, launchExtension, openPopup, waitForHash, type ExtensionContext, test } from "./fixtures/extension"

const TEST_PASSWORD = "TestPassword123!"

/** Canonical BIP39 24-word zero-entropy vector. Stable across Aztec versions
 *  and BIP39 dictionary changes. Sourced from `mnemonic.test.ts:24`. */
const CANONICAL_SEED_24 =
	"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"

/** Open a fresh extension's popup and land on the /popup/import page.
 *  Mirrors the existing `feeJuiceImportedExtension` boot pattern (wait for
 *  /popup/register + global-loader to clear before navigating). */
async function gotoImport(ctx: ExtensionContext): Promise<Page> {
	const page = await openPopup(ctx)
	await waitForHash(page, "#/popup/register", 15_000)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
		timeout: 15_000,
		polling: 500,
	})
	await page.evaluate(() => {
		window.location.hash = "#/popup/import"
	})
	await waitForHash(page, "#/popup/import", 5_000)
	return page
}

/** Drive the import-private-key flow on a fresh extension at /popup/import.
 *  Returns when the page has settled on /popup/general. */
async function importPlainKey(page: Page, secret: string, password: string): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-private-key"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-private-key")

	await page.waitForSelector('[data-testid="import-private-key-input"] input', { visible: true, timeout: 10_000 })
	await page.evaluate(
		({ s, p }: { s: string; p: string }) => {
			const setVal = (sel: string, v: string) => {
				const input = document.querySelector<HTMLInputElement>(sel)
				if (!input) throw new Error(`input not found: ${sel}`)
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
				setter?.call(input, v)
				input.dispatchEvent(new Event("input", { bubbles: true }))
			}
			// F2: profile name is required at submit time.
			setVal('[data-testid="import-name-input"] input', "Imported Profile")
			setVal('[data-testid="import-private-key-input"] input', s)
			setVal('[data-testid="import-password-input"] input', p)
			setVal('[data-testid="import-password-confirm-input"] input', p)
		},
		{ s: secret, p: password },
	)

	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-private-key-submit-btn"]')
			return btn && !btn.disabled
		},
		{ timeout: 10_000 },
	)
	await clickByTestId(page, "import-private-key-submit-btn")
	await waitForHash(page, "#/popup/general", 30_000)
}

/** Drive the import-encrypted-key flow on a fresh extension at /popup/import. */
async function importEncryptedKey(page: Page, encrypted: string, password: string): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-public-key"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-public-key")

	await page.waitForSelector('[data-testid="import-public-key-input"] input', { visible: true, timeout: 10_000 })
	await page.evaluate(
		({ s, p }: { s: string; p: string }) => {
			const setVal = (sel: string, v: string) => {
				const input = document.querySelector<HTMLInputElement>(sel)
				if (!input) throw new Error(`input not found: ${sel}`)
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
				setter?.call(input, v)
				input.dispatchEvent(new Event("input", { bubbles: true }))
			}
			// F2: profile name is required at submit time.
			setVal('[data-testid="import-name-input"] input', "Imported Profile")
			setVal('[data-testid="import-public-key-input"] input', s)
			// public_key flow has a single password field (no confirm).
			setVal('[data-testid="import-password-input"] input', p)
		},
		{ s: encrypted, p: password },
	)

	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-public-key-submit-btn"]')
			return btn && !btn.disabled
		},
		{ timeout: 10_000 },
	)
	await clickByTestId(page, "import-public-key-submit-btn")
	await waitForHash(page, "#/popup/general", 30_000)
}

/** Drive the import-seed-phrase flow on a fresh extension at /popup/import. */
async function importSeed(page: Page, seed: string, password: string): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-seed"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-seed")

	await page.waitForSelector('[data-testid="import-seed-input"] input', { visible: true, timeout: 10_000 })
	await page.evaluate(
		({ s, p }: { s: string; p: string }) => {
			const setVal = (sel: string, v: string) => {
				const input = document.querySelector<HTMLInputElement>(sel)
				if (!input) throw new Error(`input not found: ${sel}`)
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
				setter?.call(input, v)
				input.dispatchEvent(new Event("input", { bubbles: true }))
			}
			// F2: profile name is required at submit time.
			setVal('[data-testid="import-name-input"] input', "Imported Profile")
			setVal('[data-testid="import-seed-input"] input', s)
			setVal('[data-testid="import-password-input"] input', p)
			setVal('[data-testid="import-password-confirm-input"] input', p)
		},
		{ s: seed, p: password },
	)

	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-seed-submit-btn"]')
			return btn && !btn.disabled
		},
		{ timeout: 10_000 },
	)
	await clickByTestId(page, "import-seed-submit-btn")
	await waitForHash(page, "#/popup/general", 30_000)
}

/** Read the active account address from chrome.storage.local. The wallet
 *  writes this key after the post-register / post-import account derivation
 *  settles. */
async function readActiveAccount(page: Page): Promise<string> {
	return await page.evaluate(async () => {
		const r = await chrome.storage.local.get("nulo:ui:activeAccount")
		return r["nulo:ui:activeAccount"] as string
	})
}

/** Generate an Fr-valid 32-byte master and return its base64 encoding —
 *  the form `importPlain` accepts. Lazy-imports `Fr` to avoid loading the
 *  heavy aztec wasm in the smoke suite. */
async function makeRandomMasterBase64(): Promise<string> {
	const { Fr } = await import("@aztec/aztec.js/fields")
	return Buffer.from(Fr.random().toBuffer()).toString("base64")
}

/** Encrypt a base64-encoded master with the test password and return the
 *  base64 ciphertext that `importEncrypted` accepts. Runs INSIDE the popup
 *  page's browser context so `self.crypto.subtle` is available — wallet-
 *  crypto's EncryptionKey.fromPassword reaches for `self.crypto` directly,
 *  which is undefined in node. The popup tab loaded by openPopup is the
 *  most convenient browser context to use; the popup state is unaffected. */
async function makeEncryptedKeyBlob(page: Page, masterBase64: string, password: string): Promise<string> {
	return await page.evaluate(
		async ({ master, pwd }: { master: string; pwd: string }) => {
			const utf8 = new TextEncoder()
			const passhash = await self.crypto.subtle.digest("SHA-256", utf8.encode(pwd))
			// Mirror EncryptionKey.encrypt: 1-byte version + 12-byte IV + ct.
			const iv = self.crypto.getRandomValues(new Uint8Array(12))
			const salt = await self.crypto.subtle.digest("SHA-256", iv)
			const baseKey = await self.crypto.subtle.importKey("raw", passhash, { name: "PBKDF2" }, false, ["deriveKey"])
			// 600_000 — must match wallet-crypto/src/encryption-key.ts
			// PBKDF2_ITERATIONS. Lower iteration counts produce blobs that
			// the wallet's importEncrypted can't decrypt (silent failure;
			// the popup catches the decrypt error + stays on the import
			// page → e2e times out without an actionable signal).
			const key = await self.crypto.subtle.deriveKey(
				{ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
				baseKey,
				{ name: "AES-GCM", length: 256 },
				false,
				["encrypt"],
			)
			const masterBytes = Uint8Array.from(atob(master), (c) => c.charCodeAt(0))
			const ctBuf = await self.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, masterBytes)
			const ct = new Uint8Array(ctBuf)
			const out = new Uint8Array(13 + ct.length)
			out[0] = 0
			out.set(iv, 1)
			out.set(ct, 13)
			let bin = ""
			for (const b of out) bin += String.fromCharCode(b)
			return btoa(bin)
		},
		{ master: masterBase64, pwd: password },
	)
}

// ── Standalone import-path tests ────────────────────────────────────────

test("import via plain key creates profile and lands on /popup/general", async ({ freshExtensionPerTest }) => {
	const masterBase64 = await makeRandomMasterBase64()

	const page = await gotoImport(freshExtensionPerTest)
	await importPlainKey(page, masterBase64, TEST_PASSWORD)

	const address = await readActiveAccount(page)
	expect(typeof address).toBe("string")
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)

test("import via encrypted key creates profile", async ({ freshExtensionPerTest }) => {
	const masterBase64 = await makeRandomMasterBase64()

	const page = await gotoImport(freshExtensionPerTest)
	const encrypted = await makeEncryptedKeyBlob(page, masterBase64, TEST_PASSWORD)
	await importEncryptedKey(page, encrypted, TEST_PASSWORD)

	const address = await readActiveAccount(page)
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 60_000)

test("import via seed phrase (24-word) creates profile", async ({ freshExtensionPerTest }) => {
	const page = await gotoImport(freshExtensionPerTest)
	await importSeed(page, CANONICAL_SEED_24, TEST_PASSWORD)

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
 * The contract being verified:
 *   accountAddress = NuloAccount(secret, salt=Fr.ZERO).address
 *   secret = poseidon2Hash([master, chainId, accountType, index])
 *
 * Same `master` + same default network's `chainId` + same `accountType`
 * (Nulo v1 = 0) + same `index` (first account = 0) → identical address.
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

	// Step 1: pick the "Plain" variant. The page lands on a variant picker
	// (encrypted / plain) — the agree-continue button only renders after a
	// variant is selected.
	await page1.waitForSelector('[data-testid="key-variant-plain-btn"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page1, "key-variant-plain-btn")

	// Step 2: agree to the risk disclaimer.
	await page1.waitForSelector('[data-testid="agree-continue-btn"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page1, "agree-continue-btn")

	// The default `selectedKey` is "private" (plain). Unlock to populate
	// `privateKey.value`, which renders inside the SecretRevealCard's
	// `<Input :modelValue=privateKey>` (testId="reveal-content").
	await page1.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 5_000 })
	await page1.evaluate((p: string) => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="unlock-password-input"] input')
		if (!input) throw new Error("unlock-password-input not found")
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
		setter?.call(input, p)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, TEST_PASSWORD)
	await clickByTestId(page1, "unlock-submit-btn")

	// Read the revealed master (the input's value attribute is readable
	// regardless of type=password).
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
		const page2 = await gotoImport(ctx2)
		await importPlainKey(page2, masterBase64, TEST_PASSWORD)
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

	// Navigate to seed export.
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

	// Read the revealed mnemonic. The seed page renders the 24-word phrase
	// inside the SecretRevealCard's input as a single space-separated string
	// (see seed.vue:57 — `phrase.value = mnemonic.join(" ")`).
	await page1.waitForSelector('[data-testid="reveal-content"] input', { visible: true, timeout: 10_000 })
	const seed = await page1.evaluate(() => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="reveal-content"] input')
		return input?.value ?? ""
	})
	expect(seed.split(" ").length).toBe(24)
	await page1.close()

	// Fresh extension + seed import.
	const ctx2 = await launchExtension()
	try {
		const page2 = await gotoImport(ctx2)
		await importSeed(page2, seed, TEST_PASSWORD)
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

	// Navigate to the export-key page and pick the "Encrypted" variant.
	// Unlike the plain-key flow, the encrypted variant doesn't need the
	// agree-continue + unlock-password steps — the blob is already
	// password-protected, so the page renders the SecretRevealCard
	// directly via the `selectedKey === 'public'` watcher (key.vue:55-59
	// kicks off `exportEncrypted` async; the SecretRevealCard mounts as
	// soon as `publicKey.value` populates).
	await page1.evaluate(() => {
		window.location.hash = "#/popup/settings/security/export/key"
	})
	await waitForHash(page1, "#/popup/settings/security/export/key", 5_000)

	await page1.waitForSelector('[data-testid="key-variant-encrypted-btn"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page1, "key-variant-encrypted-btn")

	// Read the encrypted blob from the SecretRevealCard once exportEncrypted
	// resolves. waitForFunction polls until value lands (the watcher's
	// `await managers.profile.exportEncrypted(...)` is async; first paint
	// after the variant click can be empty).
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

	// Fresh extension + encrypted-key import. Use the same password the
	// fixture's registerProfile used (TEST_PASSWORD) — exportEncrypted
	// re-uses the active profile's existing passhash, so importEncrypted
	// must be given the same password to decrypt.
	const ctx2 = await launchExtension()
	try {
		const page2 = await gotoImport(ctx2)
		await importEncryptedKey(page2, encrypted, TEST_PASSWORD)
		const address2 = await readActiveAccount(page2)
		expect(address2).toBe(address1)
		expect(ctx2.pageErrors).toEqual([])
		await page2.close()
	} finally {
		await ctx2.browser.close()
	}
}, 90_000)

// ── Full-backup import (synthetic-payload route) ────────────────────────────

interface SyntheticBackupOpts {
	masterBase64: string
	profileName?: string
	/** Optional account.address to embed — used for the duplicate-rejection
	 *  test. When absent, an account with a sentinel address is included so
	 *  the import has something to feed into `accountService.restore`. */
	accountAddress?: string
}

/**
 * Build a minimum-viable full-backup payload (schema v2 + valid SHA-256
 * checksum) that the wallet's importer accepts. Mirrors the structure
 * produced by `popup/pages/settings/security/export/full.vue:handleBackup`
 * and is sufficient to drive `useFullBackupImport.restoreBackup` end-to-end
 * — profile, one network (so the "no networks" rollback doesn't trigger),
 * one account (default carries a non-colliding stub address, override for
 * the duplicate test).
 *
 * Intentionally simple: we leave out token / token-balance / transaction
 * / account-state / contact / config / fpc / auth-registry / operation-
 * journal because the importer treats missing slices as no-ops.
 */
function buildSyntheticBackup({ masterBase64, profileName = "Imported", accountAddress }: SyntheticBackupOpts): string {
	const body = {
		"wallet-version": "test",
		"aztec-version": "test",
		"schema-version": 2,
		"master-key": masterBase64,
		data: {
			profile: { id: "syn-profile-id", name: profileName, type: "password" },
			network: [
				{
					id: "syn-network-id",
					profileId: "syn-profile-id",
					name: "Local Network",
					rpcUrl: process.env.AZTEC_NODE_URL ?? "http://localhost:8080",
					chainId: 31337,
					kind: "local",
					endpoints: [
						{
							id: "syn-endpoint-id",
							rpcUrl: process.env.AZTEC_NODE_URL ?? "http://localhost:8080",
						},
					],
					primaryEndpointId: "syn-endpoint-id",
				},
			],
			account: [
				{
					address: accountAddress ?? `0x${"01".repeat(32)}`,
					profileId: "syn-profile-id",
					chainId: 31337,
					name: "Account",
					index: 0,
					type: 0,
					visible: true,
				},
			],
			// `tokenService.restore` is called unconditionally on `data.token`
			// (see useFullBackupImport.ts:247) so include an empty array. The
			// rest of the slices (transaction, token-balance, account-state,
			// auth-registry, fpc, contact, config) are guarded by Array.isArray
			// and tolerate the field being absent.
			token: [],
		},
	}
	const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex")
	return JSON.stringify({ ...body, checksum })
}

/** Drop a JSON string onto disk in an OS temp dir so puppeteer's
 *  `FileChooser.accept(paths)` can pick it up. */
function writeBackupToTemp(content: string, filename = "backup.json"): string {
	const dir = mkdtempSync(join(tmpdir(), "nulo-e2e-backup-"))
	const file = join(dir, filename)
	writeFileSync(file, content)
	return file
}

/** Drive the full-backup-import flow on a fresh extension at /popup/import.
 *  Returns once the page has either landed on /popup/general (success) OR
 *  the inline error banner has rendered (caller asserts the banner copy). */
async function importFullBackup(
	page: Page,
	filePath: string,
	password: string,
	{ expectError = false }: { expectError?: boolean } = {},
): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-full-backup")

	// `pickFile` (utils/files.ts:83) creates a hidden <input type="file"> +
	// programmatically clicks it. Puppeteer captures the resulting file chooser.
	await page.waitForSelector('[data-testid="import-full-backup-pick-file"]', { visible: true, timeout: 10_000 })
	const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), clickByTestId(page, "import-full-backup-pick-file")])
	await chooser.accept([filePath])

	// The new-password section is rendered when `selectedBackup.profileType
	// === "password" && !restoreStatus`. Wait for the password inputs to
	// appear before driving them.
	await page.waitForSelector('[data-testid="import-full-backup-submit-btn"]', { visible: true, timeout: 10_000 })
	await page.evaluate((p: string) => {
		const setVal = (sel: string, v: string) => {
			const input = document.querySelector<HTMLInputElement>(`${sel} input`)
			if (!input) throw new Error(`input not found: ${sel}`)
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
			setter?.call(input, v)
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}
		setVal('[data-testid="import-full-backup-password-input"]', p)
		setVal('[data-testid="import-full-backup-password-confirm-input"]', p)
	}, password)

	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-full-backup-submit-btn"]')
			return btn && !btn.disabled
		},
		{ timeout: 10_000 },
	)
	await clickByTestId(page, "import-full-backup-submit-btn")

	if (expectError) {
		// The composable sets restoreStatus="failed" + fillError() synchronously
		// in the duplicate-address branch — the submit button stays in the DOM
		// (template guard is `restoreStatus !== 'finished'`) but flips to
		// disabled, and the banner copy lands above it.
		await page.waitForFunction(
			() => {
				const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-full-backup-submit-btn"]')
				const text = document.body.textContent ?? ""
				return btn?.disabled === true && text.includes("Can't import")
			},
			{ timeout: 30_000, polling: 250 },
		)
	} else {
		await waitForHash(page, "#/popup/general", 30_000)
	}
}

test("full backup: fresh install → synthetic plain backup → /popup/general", async ({ freshExtensionPerTest }) => {
	const masterBase64 = await makeRandomMasterBase64()
	const filePath = writeBackupToTemp(buildSyntheticBackup({ masterBase64 }))

	const page = await gotoImport(freshExtensionPerTest)
	await importFullBackup(page, filePath, TEST_PASSWORD)

	const address = await readActiveAccount(page)
	expect(address.startsWith("0x")).toBe(true)
	expect(address.length).toBeGreaterThan(2)

	// Storage assertions: the wallet writes these as part of the post-
	// import handoff (setLastActiveProfileId + setSentinel + onActiveProfile-
	// Changed's setupActiveAccount).
	const storage = await page.evaluate(async () => {
		const r = await chrome.storage.local.get(["nulo:ui:lastActiveProfile", "nulo:ui:sentinel", "nulo:ui:activeAccount"])
		return r
	})
	expect(storage["nulo:ui:lastActiveProfile"]).toBeTruthy()
	expect(storage["nulo:ui:sentinel"]).toBeTruthy()
	expect(storage["nulo:ui:activeAccount"]).toBeTruthy()

	expect(freshExtensionPerTest.pageErrors).toEqual([])
	await page.close()
}, 90_000)

test("full backup: duplicate-address rejection shows the new copy, stays on /popup/import", async ({ registeredExtensionPerTest }) => {
	// Register a profile and read its first account address — this is the
	// address we'll force-collide via a synthetic backup. `registeredExt`
	// already lands on /popup/general post-register.
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general", 15_000)
	const existingAddress = await readActiveAccount(page)
	expect(existingAddress.startsWith("0x")).toBe(true)

	// Build a backup containing this exact address. The importer will write
	// the profile + the network (both succeed under a NEW profile id) but
	// `accountService.restore` throws "Duplicate address" — the catch in
	// useFullBackupImport then rolls back via deleteProfile and surfaces
	// the new copy. (Pre-A11, the comparison was `err === string` and the
	// rollback branch never ran; this test would have failed before the fix.)
	const masterBase64 = await makeRandomMasterBase64()
	const filePath = writeBackupToTemp(buildSyntheticBackup({ masterBase64, profileName: "Conflict", accountAddress: existingAddress }))

	// Hash-navigate to /popup/import (this is the same target the
	// SelectProfilePopup CTA + register page link to). isAuthRequired=false
	// for the import route so the navigation succeeds even while the user is
	// logged in.
	await page.evaluate(() => {
		window.location.hash = "#/popup/import"
	})
	await waitForHash(page, "#/popup/import", 5_000)

	await importFullBackup(page, filePath, TEST_PASSWORD, { expectError: true })

	// Banner copy assertion. The composable sets:
	//   opts.fillError("full_backup", "Can't import",
	//     "An account from this backup is already in your wallet")
	// which renders the inline `error_wrapper` block in ImportFullBackupForm.
	const banner = await page.evaluate(() => document.body.textContent ?? "")
	expect(banner).toContain("Can't import")
	expect(banner).toContain("An account from this backup is already in your wallet")

	// Still on the import page.
	expect(page.url()).toContain("#/popup/import")

	// Rollback ran: only one profile in storage (the original registered one).
	// EntityStorage prefixes entity rows as `${root}@${id}` — see
	// wallet-core/src/storage/entity_storage.ts.
	const profileCount = await page.evaluate(
		() =>
			new Promise<number>((resolve) => {
				chrome.storage.local.get(null, (all) => {
					const keys = Object.keys(all).filter((k) => k.startsWith("nulo:core:profiles@"))
					resolve(keys.length)
				})
			}),
	)
	expect(profileCount).toBe(1)

	await page.close()
}, 90_000)
