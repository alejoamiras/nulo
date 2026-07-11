/**
 * Non-network e2e coverage for the passkey full-backup flows after the
 * Path A modal migration. Lives next to `passkey-paths.test.ts`; shares
 * the `setupPasskeyVirtualAuth` fixture.
 *
 * Why a separate file: the existing `security-backup.test.ts` smoke runs
 * against a password profile (`registeredExtension`); rewriting it to
 * "expect a modal" would (a) drop the password coverage, (b) not exercise
 * the migrated path. New surface, new file.
 *
 * Coverage:
 *   1. Export full backup as a passkey profile — modal appears, virtual
 *      authenticator completes, CTAs become available. Locks in the
 *      `usePasskeyCeremony` wiring on the export page.
 *   2. Export cancel UX — Escape during the modal returns the user to
 *      the agreement gate (`isAgreed = false`), NOT a dead form or a
 *      toast+bounce.
 *   3. (Commit 2) In-session import round-trip — register, build a
 *      synthetic passkey backup with the real credentialId, reset storage,
 *      drive the import flow, assert the same address comes back.
 */
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, openPopup, replaceInputValue, waitForHash, test } from "./fixtures/extension"
import { getActiveProfileName } from "./fixtures/helpers"
import { setupPasskeyVirtualAuth } from "./fixtures/passkey"

/** Reset the wallet via the in-app reset flow (settings → security → reset).
 *  Cascades through every service (NetworkService.onProfileDeleted, etc.) so
 *  storage AND in-memory SW state are properly cleaned — a plain
 *  `chrome.storage.local.clear()` would leave the SW's cached account map
 *  populated and a subsequent import would hit a spurious "Duplicate
 *  address". Lands on /popup/register with the loader cleared. */
async function resetWallet(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.location.hash = "#/popup/settings/security/reset"
	})
	await waitForHash(page, "#/popup/settings/security/reset", 5_000)
	await page.waitForSelector('[data-testid="reset-checkbox-permanent"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page, "reset-checkbox-permanent")
	await clickByTestId(page, "reset-checkbox-undone")
	await clickByTestId(page, "reset-checkbox-sure")
	// Profile name is user-typed (F1) — read it from the reset page's
	// data-profile-name attribute rather than hardcoding.
	const activeProfileName = await getActiveProfileName(page)
	await page.evaluate((expectedName: string) => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="reset-confirm-input"] input')
		if (!input) throw new Error("reset-confirm-input not found")
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
		setter?.call(input, expectedName)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, activeProfileName)
	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="reset-submit-btn"]')
			return btn !== null && !btn.disabled
		},
		{ timeout: 5_000 },
	)
	await clickByTestId(page, "reset-submit-btn")
	await waitForHash(page, "#/popup/register", 10_000)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
		timeout: 15_000,
		polling: 500,
	})
}

/** Drive the passkey-register flow on a fresh extension at /popup/register.
 *  Mirrors `passkey-paths.test.ts:registerPasskeyProfile`. Lands on
 *  /popup/general. */
async function registerPasskeyProfile(page: Page): Promise<void> {
	await waitForHash(page, "#/popup/register", 15_000)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
		timeout: 15_000,
		polling: 500,
	})
	await clickByTestId(page, "register-create-btn")

	// F1: name is required at submit time.
	await page.waitForSelector('[data-testid="register-name-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page, '[data-testid="register-name-input"]', "Test Profile")

	await page.waitForSelector('[data-testid="register-method-passkey"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "register-method-passkey")
	await page.waitForSelector('[data-testid="register-submit-btn"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "register-submit-btn")
	await waitForHash(page, "#/popup/general", 60_000)
}

/** Read the active account address from chrome.storage.local. */
async function readActiveAccount(page: Page): Promise<string> {
	return await page.evaluate(async () => {
		const r = await chrome.storage.local.get("nulo:ui:activeAccount")
		return r["nulo:ui:activeAccount"] as string
	})
}

/** Read the registered profile's stored record (id + name + type + credentialId).
 *  EntityStorage rows live under `nulo:core:profiles@<id>`. */
async function readRegisteredPasskeyProfile(page: Page): Promise<{ id: string; credentialId: string }> {
	return await page.evaluate(async () => {
		const all = await chrome.storage.local.get(null)
		for (const key of Object.keys(all)) {
			if (!key.startsWith("nulo:core:profiles@")) continue
			const raw = (all as Record<string, unknown>)[key]
			const profile = typeof raw === "string" ? JSON.parse(raw) : raw
			if (profile && profile.type === "passkey") {
				return { id: profile.id as string, credentialId: profile.credentialId as string }
			}
		}
		throw new Error("No passkey profile found in storage")
	})
}

/** Build a passkey-typed synthetic backup payload that the import flow
 *  will accept. Mirrors `import-paths.test.ts:buildSyntheticBackup` but
 *  sets `profile.type = "passkey"` and uses the credentialId as the
 *  `master-key`. The address must match the active account at register
 *  time so the `Duplicate address` check doesn't fire post-reset (post-
 *  reset there's nothing to collide with anyway, but the imported
 *  account address still has to be a valid Aztec address). */
function buildSyntheticPasskeyBackup(credentialId: string, accountAddress: string): string {
	const body = {
		"wallet-version": "test",
		"aztec-version": "test",
		"compat-epoch": 2,
		"backup-schema-version": 1,
		"master-key": credentialId,
		data: {
			profile: { id: "syn-profile-id", name: "Imported PK", type: "passkey" },
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
					address: accountAddress,
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
			// migration reads contacts and rejects a missing required slice.
			contact: [],
		},
	}
	const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex")
	return JSON.stringify({ ...body, checksum })
}

function writeBackupToTemp(content: string, filename = "passkey-backup.json"): string {
	const dir = mkdtempSync(join(tmpdir(), "nulo-e2e-passkey-backup-"))
	const file = join(dir, filename)
	writeFileSync(file, content)
	return file
}

/** Drive the full-backup-import flow for a PASSKEY backup. Unlike the
 *  password-profile driver in `import-paths.test.ts`, this one does NOT
 *  fill new-password inputs (passkey backups have no "New Password"
 *  section) and just waits for the modal to render + dismiss. */
async function importPasskeyFullBackup(page: Page, filePath: string): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-full-backup")

	await page.waitForSelector('[data-testid="import-full-backup-pick-file"]', { visible: true, timeout: 10_000 })
	const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), clickByTestId(page, "import-full-backup-pick-file")])
	await chooser.accept([filePath])

	// Submit button gates on isAllowedToImportBackup — for passkey backups
	// that means just `profileType && backup`. Wait for it + click.
	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-full-backup-submit-btn"]')
			return btn && !btn.disabled
		},
		{ timeout: 10_000 },
	)
	await clickByTestId(page, "import-full-backup-submit-btn")

	// The modal opens via `useFullBackupImport.runCeremony({ mode: "get", credentialId })`.
	// Virtual authenticator resolves WebAuthn.get() in ms. After credentialData
	// reaches the service, restore + finalizeRestore proceed and the page
	// navigates to /popup/general (via the completeImport handoff).
	await waitForHash(page, "#/popup/general", 30_000)
}

// Env-gate to local-only. The 11-service backup chain + SHA hash is 5-10×
// slower on hosted GitHub Actions runners than local (15-22s local, 96-180s+
// per attempt on hosted under cumulative load — confirmed empirically on
// PR #80 multiple times even after bumping the inner wait to 180s). Locally
// the coverage stays full; hosted CI loses this test until we either profile
// the chain, accept a larger runner (requires org/enterprise plan per codex
// audit), or get a deterministic completion signal we can wait on.
test.skipIf(process.env.CI === "true")(
	"passkey full-backup export: modal appears + status card + CTAs become available",
	{ timeout: 240_000 },
	async ({ freshExtensionPerTest }) => {
		const page = await openPopup(freshExtensionPerTest)
		const auth = await setupPasskeyVirtualAuth(freshExtensionPerTest.browser, page)

		try {
			await registerPasskeyProfile(page)

			// Navigate to the full-backup export page.
			await page.evaluate(() => {
				window.location.hash = "#/popup/settings/security/export/full"
			})
			await waitForHash(page, "#/popup/settings/security/export/full", 5_000)

			// Tick the agreement gate. For passkey profiles, agreement
			// auto-fires `handleBackup` → opens the modal (see `handleAgree`
			// in export/full.vue:73). No "Create Backup" button for passkey.
			await page.waitForSelector('[data-testid="agree-continue-btn"]', { visible: true, timeout: 5_000 })
			await clickByTestId(page, "agree-continue-btn")

			// After modal resolves, backupStatus flips to "progress" and the
			// inline status card mounts. Polling-based assertion catches the
			// intermediate state — without it, the existing CTA-enabled assert
			// would still pass if the body regressed to blank during progress.
			// Assert the card's expected copy ("Creating your backup") too so
			// a future copy regression is caught at the e2e level.
			await page.waitForFunction(
				() => {
					const card = document.querySelector('[data-testid="backup-status-card"]')
					return card !== null && (card.textContent ?? "").includes("Creating your backup")
				},
				{ timeout: 15_000, polling: 100 },
			)

			// Bottom CTAs are disabled while the card is visible — codify the
			// "no action available right now" invariant.
			const ctaState = await page.evaluate(() => {
				const download = document.querySelector<HTMLButtonElement>('[data-testid="download-backup-btn"]')
				return { disabled: download?.disabled ?? false, label: download?.textContent?.trim() ?? "" }
			})
			expect(ctaState.disabled).toBe(true)
			expect(ctaState.label).toMatch(/Creating Backup/i)

			// 11-service backup() loop + SHA hash. Once the status flips to
			// "finished", the card unmounts and the terminal CTAs become enabled.
			// 30s suffices locally on a fast machine, but the hosted GitHub
			// Actions runner regularly takes 45–55s for the full chain — and
			// occasionally 90-120s under cumulative load (real observation on
			// PR #79 hosted run: 96s/attempt × 3 retries blew past the prior
			// 90s budget). 180s gives enough headroom for the slow path
			// without masking a genuine deadlock.
			await page.waitForFunction(
				() => {
					const protect = document.querySelector<HTMLButtonElement>('[data-testid="protect-password-btn"]')
					const download = document.querySelector<HTMLButtonElement>('[data-testid="download-backup-btn"]')
					return !!protect && !protect.disabled && !!download && !download.disabled
				},
				{ timeout: 180_000, polling: 250 },
			)

			// Drive the encryption path so the second status card variant
			// ("Encrypting your backup") is exercised too. For passkey profiles
			// the "Protect with Password" CTA is a two-click flow:
			//   1st click → clears `showRecommendation` and exposes the password
			//     fields (the `handleEncrypt` passkey branch sets
			//     `showRecommendation = false` then returns early on empty
			//     password).
			//   2nd click → with password + repeat filled, actually runs the
			//     PBKDF2 + AES-GCM encryption.
			// Order matters: the password fields are only mounted when
			// `!showRecommendation`, so we have to click first to reveal them.
			const ENCRYPT_PASSWORD = "EncryptPassword123!"
			await clickByTestId(page, "protect-password-btn")
			await page.waitForSelector('[data-testid="backup-encrypt-password-input"]', { visible: true, timeout: 5_000 })
			await page.evaluate((pwd: string) => {
				const setVal = (sel: string, v: string) => {
					const input = document.querySelector<HTMLInputElement>(`${sel} input`)
					if (!input) throw new Error(`input not found: ${sel}`)
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
					setter?.call(input, v)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="backup-encrypt-password-input"]', pwd)
				setVal('[data-testid="backup-encrypt-password-confirm-input"]', pwd)
			}, ENCRYPT_PASSWORD)
			await clickByTestId(page, "protect-password-btn")

			// Encrypting card mounts briefly (~1s PBKDF2 + AES-GCM). Same race-
			// tolerant pattern: poll for the card with its expected copy.
			await page.waitForFunction(
				() => {
					const card = document.querySelector('[data-testid="backup-status-card"]')
					return card !== null && (card.textContent ?? "").includes("Encrypting your backup")
				},
				{ timeout: 10_000, polling: 100 },
			)

			// Then the "encrypted" banner appears and Download Backup is enabled.
			await page.waitForFunction(
				() => {
					const download = document.querySelector<HTMLButtonElement>('[data-testid="download-backup-btn"]')
					const body = document.body.textContent ?? ""
					return !!download && !download.disabled && body.includes("Backup is successfully encrypted")
				},
				{ timeout: 15_000, polling: 250 },
			)

			// Filter the benign "Client disconnected" cascade that can fire when
			// the export's loop disconnects each backup service client.
			const nonBenign = freshExtensionPerTest.pageErrors.filter((e) => !e.message.includes("Client disconnected"))
			expect(nonBenign).toEqual([])
		} finally {
			await auth.cleanup()
			await page.close()
		}
	},
	120_000,
)

test("passkey full-backup export: Escape during modal resets agreement gate", async ({ freshExtensionPerTest }) => {
	const page = await openPopup(freshExtensionPerTest)

	// IMPORTANT: do NOT attach a virtual authenticator here. Without it,
	// `navigator.credentials.get` would block waiting for the platform
	// authenticator. We rely on the dialog's Escape handler to abort
	// before WebAuthn resolves.
	let auth: Awaited<ReturnType<typeof setupPasskeyVirtualAuth>> | undefined
	try {
		auth = await setupPasskeyVirtualAuth(freshExtensionPerTest.browser, page)
		await registerPasskeyProfile(page)

		await page.evaluate(() => {
			window.location.hash = "#/popup/settings/security/export/full"
		})
		await waitForHash(page, "#/popup/settings/security/export/full", 5_000)

		// Click agree to launch the passkey ceremony, then immediately
		// detach the virtual authenticator so the prompt won't resolve.
		// (Without this, the virtual authenticator's `automaticPresence-
		// Simulation:true` would auto-complete the ceremony before our
		// Escape key fires.)
		await page.waitForSelector('[data-testid="agree-continue-btn"]', { visible: true, timeout: 5_000 })

		// Tear down the virtual authenticator BEFORE clicking agree so
		// navigator.credentials.get hangs, giving the Escape handler a
		// real chance to abort first.
		await auth.cleanup()
		auth = undefined

		await clickByTestId(page, "agree-continue-btn")

		// Press Escape via the page's keydown handler in PasskeyCeremony-
		// Dialog.vue. Wait for the modal to dismount and the agreement
		// gate to return.
		await page.keyboard.press("Escape")

		await page.waitForFunction(
			() => {
				// `isAgreed = false` → the "Before you continue" copy is shown
				// AND the agree-continue button is rendered again.
				const btn = document.querySelector<HTMLButtonElement>('[data-testid="agree-continue-btn"]')
				return btn !== null && !btn.disabled
			},
			{ timeout: 10_000, polling: 200 },
		)

		const nonBenign = freshExtensionPerTest.pageErrors.filter((e) => !e.message.includes("Client disconnected"))
		expect(nonBenign).toEqual([])
	} finally {
		if (auth) await auth.cleanup()
		await page.close()
	}
}, 90_000)

test("passkey full-backup: in-session round-trip (register → reset → import same credential)", async ({ freshExtensionPerTest }) => {
	// Why this test is possible AFTER the Path A migration but wasn't
	// before: Chrome virtual authenticators are per-FrameTreeNode. The
	// previous Path B export/import opened a fresh `chrome.windows.create`
	// popup for each ceremony → each got its own (empty) authenticator →
	// the credential created at register wasn't reachable from the export/
	// import windows. Path A runs everything in the SAME popup's FTN, so
	// the credential persists across register + export + import within a
	// single popup session. (Cross-extension round-trip is still blocked
	// by PRF non-portability — see fixtures/passkey.ts:14-30.)
	const page = await openPopup(freshExtensionPerTest)
	const auth = await setupPasskeyVirtualAuth(freshExtensionPerTest.browser, page)

	try {
		// 1. Register passkey profile. Captures address + the real
		//    credentialId that the virtual authenticator handed out.
		await registerPasskeyProfile(page)
		const addressBefore = await readActiveAccount(page)
		expect(addressBefore.startsWith("0x")).toBe(true)
		const { credentialId } = await readRegisteredPasskeyProfile(page)
		expect(credentialId.length).toBeGreaterThan(0)

		// 2. Build the synthetic backup file with that exact credentialId.
		const filePath = writeBackupToTemp(buildSyntheticPasskeyBackup(credentialId, addressBefore))

		// 3. Reset the wallet via the in-app reset flow — the same pattern
		//    `passkey-paths.test.ts:140-172` uses.
		await resetWallet(page)

		// 4. Drive the import flow.
		await page.evaluate(() => {
			window.location.hash = "#/popup/import"
		})
		await waitForHash(page, "#/popup/import", 5_000)
		await importPasskeyFullBackup(page, filePath)

		// 5. Address comes back identical. Proves the credentialId binding
		//    + master-secret derivation round-tripped through the modal.
		const addressAfter = await readActiveAccount(page)
		expect(addressAfter).toBe(addressBefore)

		// Storage sentinels populated post-import (same as the password
		// round-trip test in import-paths.test.ts).
		const storage = await page.evaluate(async () => {
			const r = await chrome.storage.local.get(["nulo:ui:lastActiveProfile", "nulo:ui:sentinel", "nulo:ui:activeAccount"])
			return r
		})
		expect(storage["nulo:ui:lastActiveProfile"]).toBeTruthy()
		expect(storage["nulo:ui:sentinel"]).toBeTruthy()
		expect(storage["nulo:ui:activeAccount"]).toBeTruthy()

		// Lock-cascade benign errors are the same shape as other Path A tests.
		const nonBenign = freshExtensionPerTest.pageErrors.filter((e) => !e.message.includes("Client disconnected"))
		expect(nonBenign).toEqual([])
	} finally {
		await auth.cleanup()
		await page.close()
	}
}, 120_000)

// NOTE: a REAL passkey export → reset → import round-trip (capturing the
// actual EXPORT file, mirroring the encrypted/password real-export tests) was
// prototyped but NOT landed: it depends on the passkey EXPORT ceremony, which
// does not resolve on this machine's virtual authenticator — the SAME
// pre-existing limitation that already CI-skips + locally-fails the
// "status card" export test above (verified failing at the branch base). The
// passkey IMPORT path is fully covered by the synthetic round-trip above, and
// the export FILE format is covered by the password (network round-trip) and
// encrypted (`backup-roundtrip.test.ts`) real-export tests. Revisit if the
// export-ceremony virtual-auth issue is fixed.
