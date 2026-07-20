/**
 * Shared drivers for the profile-IMPORT e2e flows, used by both the popup
 * (`import-paths.test.ts`) and onboarding (`onboarding-import.test.ts`) shells.
 *
 * The import method picker + secret/password inputs are shared L3 composite
 * components (`@/components/composite/import/*`), so their testids are identical
 * across shells. Only three things differ per shell — the profile-name input
 * testid, the submit-button testid, and the success hash — captured in
 * `ImportShell`.
 */
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "puppeteer"
import { clickByTestId, type ExtensionContext, openOnboarding, openPopup, waitForHash } from "../fixtures/extension"
export { TEST_PASSWORD } from "../fixtures/constants"

/** Canonical BIP39 24-word zero-entropy vector. Stable across Aztec versions
 *  and BIP39 dictionary changes. Sourced from `mnemonic.test.ts:24`. */
export const CANONICAL_SEED_24 =
	"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"

export type ImportMethod = "seed" | "private-key" | "public-key" | "full-backup"

/** The only parts of the import flow that differ between shells. */
export interface ImportShell {
	/** Profile-name input testid — popup: `import-name-input`; onboarding: `onboarding-name-input`. */
	nameInputTestId: string
	/** Submit-button testid for a method — popup: per-method `import-<m>-submit-btn`; onboarding: single `onboarding-submit-import`. */
	submitTestId: (method: ImportMethod) => string
	/** Hash the flow lands on after a successful import. */
	successHash: string
}

export const POPUP_IMPORT_SHELL: ImportShell = {
	nameInputTestId: "import-name-input",
	submitTestId: (m) => `import-${m}-submit-btn`,
	successHash: "#/popup/general",
}

export const ONBOARDING_IMPORT_SHELL: ImportShell = {
	nameInputTestId: "onboarding-name-input",
	submitTestId: () => "onboarding-submit-import",
	successHash: "#/onboarding/learn",
}

/** Set a batch of `<Input>` values in page context (native setter + input event
 *  so Vue's v-model picks them up). Keys are CSS selectors. */
export async function setInputs(page: Page, fields: Record<string, string>): Promise<void> {
	await page.evaluate((entries: Array<[string, string]>) => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
		for (const [sel, v] of entries) {
			const input = document.querySelector<HTMLInputElement>(sel)
			if (!input) throw new Error(`input not found: ${sel}`)
			setter?.call(input, v)
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}
	}, Object.entries(fields))
}

/** Wait for a testid'd button to be enabled, then click it. */
export async function submitWhenEnabled(page: Page, testId: string): Promise<void> {
	await page.waitForFunction(
		(id: string) => {
			const btn = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
			return !!btn && !btn.disabled
		},
		{ timeout: 10_000 },
		testId,
	)
	await clickByTestId(page, testId)
}

/** Open the popup and land on `/popup/import` (waits for register + global-loader to clear). */
export async function gotoPopupImport(ctx: ExtensionContext): Promise<Page> {
	const page = await openPopup(ctx)
	await waitForHash(page, "#/popup/register", 15_000)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), { timeout: 15_000, polling: 500 })
	await page.evaluate(() => {
		window.location.hash = "#/popup/import"
	})
	await waitForHash(page, "#/popup/import", 5_000)
	return page
}

/** Open the onboarding tab and land on `/onboarding/import` via the welcome CTA. */
export async function gotoOnboardingImport(ctx: ExtensionContext): Promise<Page> {
	const page = await openOnboarding(ctx)
	await page.waitForSelector('[data-testid="onboarding-welcome-import"]', { visible: true, timeout: 15_000 })
	await clickByTestId(page, "onboarding-welcome-import")
	await waitForHash(page, "#/onboarding/import", 10_000)
	return page
}

export async function importPlainKey(page: Page, secret: string, password: string, shell: ImportShell): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-private-key"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-private-key")
	await page.waitForSelector('[data-testid="import-private-key-input"] input', { visible: true, timeout: 10_000 })
	await setInputs(page, {
		[`[data-testid="${shell.nameInputTestId}"] input`]: "Imported Profile",
		'[data-testid="import-private-key-input"] input': secret,
		'[data-testid="import-password-input"] input': password,
		'[data-testid="import-password-confirm-input"] input': password,
	})
	await submitWhenEnabled(page, shell.submitTestId("private-key"))
	await waitForHash(page, shell.successHash, 30_000)
}

export async function importEncryptedKey(page: Page, encrypted: string, password: string, shell: ImportShell): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-public-key"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-public-key")
	await page.waitForSelector('[data-testid="import-public-key-input"] input', { visible: true, timeout: 10_000 })
	// public_key flow has a single password field (no confirm).
	await setInputs(page, {
		[`[data-testid="${shell.nameInputTestId}"] input`]: "Imported Profile",
		'[data-testid="import-public-key-input"] input': encrypted,
		'[data-testid="import-password-input"] input': password,
	})
	await submitWhenEnabled(page, shell.submitTestId("public-key"))
	await waitForHash(page, shell.successHash, 30_000)
}

export async function importSeed(page: Page, seed: string, password: string, shell: ImportShell): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-seed"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-seed")
	await page.waitForSelector('[data-testid="import-seed-input"] input', { visible: true, timeout: 10_000 })
	await setInputs(page, {
		[`[data-testid="${shell.nameInputTestId}"] input`]: "Imported Profile",
		'[data-testid="import-seed-input"] input': seed,
		'[data-testid="import-password-input"] input': password,
		'[data-testid="import-password-confirm-input"] input': password,
	})
	await submitWhenEnabled(page, shell.submitTestId("seed"))
	await waitForHash(page, shell.successHash, 30_000)
}

/** Drive the full-backup import. Lands on the shell's success hash, or — when
 *  `expectError` — waits for the inline error banner + disabled submit
 *  (`true` expects the default "Can't import" copy; a string expects that
 *  exact banner title — a content assertion, not a click target). */
export async function importFullBackup(
	page: Page,
	filePath: string,
	password: string,
	shell: ImportShell,
	{ expectError = false }: { expectError?: boolean | string } = {},
): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-full-backup")

	// `pickFile` creates a hidden <input type="file"> + clicks it; puppeteer
	// captures the resulting file chooser.
	await page.waitForSelector('[data-testid="import-full-backup-pick-file"]', { visible: true, timeout: 10_000 })
	const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), clickByTestId(page, "import-full-backup-pick-file")])
	await chooser.accept([filePath])

	await page.waitForSelector(`[data-testid="${shell.submitTestId("full-backup")}"]`, { visible: true, timeout: 10_000 })
	await setInputs(page, {
		'[data-testid="import-full-backup-password-input"] input': password,
		'[data-testid="import-full-backup-password-confirm-input"] input': password,
	})

	await submitWhenEnabled(page, shell.submitTestId("full-backup"))

	if (expectError) {
		const expectedText = typeof expectError === "string" ? expectError : "Can't import"
		await page.waitForFunction(
			(id: string, wanted: string) => {
				const btn = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
				const text = document.body.textContent ?? ""
				return btn?.disabled === true && text.includes(wanted)
			},
			{ timeout: 30_000, polling: 250 },
			shell.submitTestId("full-backup"),
			expectedText,
		)
	} else {
		await waitForHash(page, shell.successHash, 30_000)
	}
}

/** Read the active account address the wallet writes after import settles. */
export async function readActiveAccount(page: Page): Promise<string> {
	return await page.evaluate(async () => {
		const r = await chrome.storage.local.get("nulo:ui:activeAccount")
		return r["nulo:ui:activeAccount"] as string
	})
}

/** Generate an Fr-valid 32-byte master, base64-encoded (the form `importPlain`
 *  accepts). Lazy-imports `Fr` to avoid loading the heavy aztec wasm. */
export async function makeRandomMasterBase64(): Promise<string> {
	const { Fr } = await import("@aztec/aztec.js/fields")
	return Buffer.from(Fr.random().toBuffer()).toString("base64")
}

/** Encrypt a base64 master with the test password, returning the base64
 *  ciphertext `importEncrypted` accepts. Runs in the page's browser context so
 *  `self.crypto.subtle` is available. */
export async function makeEncryptedKeyBlob(page: Page, masterBase64: string, password: string): Promise<string> {
	return await page.evaluate(
		async ({ master, pwd }: { master: string; pwd: string }) => {
			const utf8 = new TextEncoder()
			const passhash = await self.crypto.subtle.digest("SHA-256", utf8.encode(pwd))
			const iv = self.crypto.getRandomValues(new Uint8Array(12))
			const salt = await self.crypto.subtle.digest("SHA-256", iv)
			const baseKey = await self.crypto.subtle.importKey("raw", passhash, { name: "PBKDF2" }, false, ["deriveKey"])
			// 600_000 — must match wallet-crypto encryption-key.ts PBKDF2_ITERATIONS.
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

export interface SyntheticBackupOpts {
	masterBase64: string
	profileName?: string
	/** Override the embedded account address (used for the duplicate-rejection test). */
	accountAddress?: string
	/** Extra slices merged into `data` (e.g. a pre-shape `contact` slice for the
	 *  backup-migration smoke). */
	extraData?: Record<string, unknown>
	/** Top-level metadata overrides merged over the body BEFORE the checksum is
	 *  computed. A key set to `undefined` is dropped by JSON.stringify — use
	 *  that to build pre-baseline (legacy `schema-version`) blobs. */
	bodyOverrides?: Record<string, unknown>
}

/** Build a minimum-viable full-backup payload (current metadata fields + valid SHA-256
 *  checksum) the importer accepts: profile + one network + one account + empty
 *  token slice. Missing slices are treated as no-ops by the importer. */
export function buildSyntheticBackup({
	masterBase64,
	profileName = "Imported",
	accountAddress,
	extraData,
	bodyOverrides,
}: SyntheticBackupOpts): string {
	const body = {
		"wallet-version": "test",
		"aztec-version": "test",
		"compat-epoch": 3,
		"backup-schema-version": 1,
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
					endpoints: [{ id: "syn-endpoint-id", rpcUrl: process.env.AZTEC_NODE_URL ?? "http://localhost:8080" }],
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
			token: [],
			// Present-but-empty, like a real export: the stamped backup fixture
			// migration READS contacts, and a missing non-optional slice a
			// pending migration reads rejects the import.
			contact: [],
			...(extraData ?? {}),
		},
		...(bodyOverrides ?? {}),
	}
	const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex")
	return JSON.stringify({ ...body, checksum })
}

/** Drop a JSON string onto disk so puppeteer's `FileChooser.accept(paths)` can pick it up. */
export function writeBackupToTemp(content: string, filename = "backup.json"): string {
	const dir = mkdtempSync(join(tmpdir(), "nulo-e2e-backup-"))
	const file = join(dir, filename)
	writeFileSync(file, content)
	return file
}
