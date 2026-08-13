/**
 * ENCRYPTED full-backup round-trip through the real UI — the one import leg
 * nothing else drives (`decryptBackup` had zero unit or e2e coverage):
 *
 *   export (password profile) → Protect with Password → capture the .gz
 *   download in-page → import in a FRESH extension → wrong password rejects
 *   cleanly → right password decrypts → restore succeeds → the derived
 *   account address round-trips.
 *
 * The plain-backup legs live elsewhere: synthetic imports in
 * `import-paths.test.ts`, the migration path in `backup-migration.test.ts`,
 * and the on-chain proof in `network/backup-migration-roundtrip.test.ts`.
 * No fixture arming needed — this file exercises no migration.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect } from "vitest"
import { clickByTestId, launchExtension, openPopup, replaceInputValue, test, waitForHash } from "./fixtures/extension"
import { ensureUnlocked, navigateByHash, reopenAndRecoverAfterImport } from "./fixtures/helpers"
import { armBackupDownloadCapture, readCapturedBackupDownload } from "./helpers/backup-export"
import { gotoPopupImport, readActiveAccount, TEST_PASSWORD, waitForActiveAccount } from "./helpers/import-drivers"

// Release-artifact smoke runs a PROD-SHAPED build (Alpha mainnet seeded active — no e2e env pin,
// by design: the artifact must be what ships). CI runners cannot reach the public Alpha RPC, so
// the fresh-extension import leg would stall through the node client's full timeout envelope.
// Skip on artifact runs — the identical flow runs on EVERY PR via the pinned in-job build (the
// same artifact-run carve-out the migration arming contract established). Keyed off the EXPLICIT
// workflow-set flag, NOT bare EXTENSION_PATH — a developer pointing at a custom build must not
// silently lose this unique encrypted-backup coverage (codex Med).
const IS_RELEASE_ARTIFACT_RUN = process.env.NULO_E2E_ARTIFACT_RUN === "1"

// 900s: export chain (120s) + import navigation incl. the app's bounded recovery leg (300s) +
// active-account convergence (240s) must ALL fit with headroom on slow runners.
test.skipIf(IS_RELEASE_ARTIFACT_RUN)(
	"encrypted full backup: export → wrong password rejects → decrypt → restore in a fresh extension",
	{ timeout: 900_000 },
	async ({ registeredExtension }) => {
		// ── Export + encrypt from the registered wallet ────────────────────
		const page = await openPopup(registeredExtension)
		await waitForHash(page, "#/popup/general")
		const addressBefore = await readActiveAccount(page)
		expect(addressBefore.startsWith("0x")).toBe(true)

		await navigateByHash(page, "#/popup/settings/security/export/full")
		await clickByTestId(page, "agree-continue-btn")
		await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 10_000 })
		await replaceInputValue(page, '[data-testid="unlock-password-input"]', TEST_PASSWORD)
		await clickByTestId(page, "unlock-submit-btn")

		// The 11-service backup chain is slow on hosted runners — same budget
		// the security-backup export test uses, with headroom.
		await page.waitForFunction(
			() => {
				const btn = document.querySelector<HTMLButtonElement>('[data-testid="protect-password-btn"]')
				return !!btn && !btn.disabled
			},
			{ timeout: 120_000, polling: 250 },
		)
		// For a PASSWORD profile, Protect encrypts with the profile password
		// immediately (no extra inputs). Encrypted state = protect CTA gone +
		// download enabled.
		await clickByTestId(page, "protect-password-btn")
		await page.waitForFunction(
			() => {
				const protect = document.querySelector('[data-testid="protect-password-btn"]')
				const download = document.querySelector<HTMLButtonElement>('[data-testid="download-backup-btn"]')
				return protect === null && !!download && !download.disabled
			},
			{ timeout: 60_000, polling: 250 },
		)

		await armBackupDownloadCapture(page)
		await clickByTestId(page, "download-backup-btn")
		const ciphertext = await readCapturedBackupDownload(page)
		await page.close()

		// The capture is the DECOMPRESSED file content: base64 ciphertext whose
		// first decoded byte is the version 0 the importer's type sniffer keys on.
		expect(ciphertext.trim().startsWith("{")).toBe(false)

		const dir = mkdtempSync(join(tmpdir(), "nulo-e2e-enc-backup-"))
		const filePath = join(dir, "NuloEncryptedBackup_e2e.txt")
		writeFileSync(filePath, ciphertext)

		// ── Import in a FRESH extension ────────────────────────────────────
		const profileDir = mkdtempSync(join(tmpdir(), "nulo-enc-rt-"))
		const ctx2 = await launchExtension({ userDataDir: profileDir })
		try {
			const page2 = await gotoPopupImport(ctx2)
			await page2.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 10_000 })
			await clickByTestId(page2, "import-option-full-backup")
			const [chooser] = await Promise.all([
				page2.waitForFileChooser({ timeout: 10_000 }),
				clickByTestId(page2, "import-full-backup-pick-file"),
			])
			await chooser.accept([filePath])

			// Wrong password first: a clean, retryable "Decryption Failed".
			await page2.waitForSelector('[data-testid="import-full-backup-decrypt-password-input"] input', {
				visible: true,
				timeout: 10_000,
			})
			await replaceInputValue(page2, '[data-testid="import-full-backup-decrypt-password-input"]', "definitely-wrong-1")
			await clickByTestId(page2, "import-full-backup-decrypt-btn")
			await page2.waitForFunction(() => (document.body.textContent ?? "").includes("Decryption Failed"), {
				timeout: 30_000,
				polling: 250,
			})

			// Right password: decrypt reveals the password-profile section.
			await replaceInputValue(page2, '[data-testid="import-full-backup-decrypt-password-input"]', TEST_PASSWORD)
			await clickByTestId(page2, "import-full-backup-decrypt-btn")
			await page2.waitForSelector('[data-testid="import-full-backup-password-input"] input', { visible: true, timeout: 30_000 })
			await replaceInputValue(page2, '[data-testid="import-full-backup-password-input"]', TEST_PASSWORD)
			await replaceInputValue(page2, '[data-testid="import-full-backup-password-confirm-input"]', TEST_PASSWORD)
			await page2.waitForFunction(
				() => {
					const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-full-backup-submit-btn"]')
					return !!btn && !btn.disabled
				},
				{ timeout: 10_000 },
			)
			// Route-trajectory recorder, armed BEFORE submit: vue-router's hash nav is
			// pushState-based (no hashchange/popstate fires), so transitions must be
			// POLLED. On a timeout below, the trace turns a silent 90s park into a
			// diagnosable record (which leg stalled: restore, activation, or routing).
			await page2.evaluate(() => {
				const w = window as unknown as { __nuloImportNavTrace?: Array<{ t: number; hash: string }> }
				w.__nuloImportNavTrace = [{ t: Date.now(), hash: window.location.hash }]
				window.setInterval(() => {
					const trace = w.__nuloImportNavTrace as Array<{ t: number; hash: string }>
					if (window.location.hash !== trace[trace.length - 1].hash) trace.push({ t: Date.now(), hash: window.location.hash })
				}, 200)
			})
			const submittedAt = Date.now()
			await clickByTestId(page2, "import-full-backup-submit-btn")

			// REALISTIC settle: the MV3 worker can restart mid-import (P0-proven), so a
			// straight assertion of `/popup/general` is wrong — the honest post-import
			// state is an ACTIONABLE screen: `/popup/general` (session survived),
			// `/popup/auth` (strict mode + worker restart dropped the master → unlock
			// to finish), or the finished-with-errors screen (the app's BOUNDED
			// chain-registration leg skipped unreachable networks — Continue proceeds;
			// the wallet requires a reachable RPC to re-register chain state, and says
			// so instead of hanging). What must NEVER happen is a silent dead-end.
			//
			// LEDGER ENTRY 1 (e2e-deflake) FIX: the import's account-state leg used to
			// await unbounded PXE registrations against the backup-carried public-RPC
			// URL — a degraded endpoint parked this wait through no fault of the
			// runner. The leg is now preflight-gated + deadline-bounded in-product, so
			// every branch below lands well inside the SAME 90s deadline (UNCHANGED —
			// the Continue click below consumes the remainder, never a fresh budget).
			// ONE absolute deadline for the whole post-submit settle: both waits
			// below consume the REMAINDER of `submittedAt + 90_000` — never a fresh
			// budget (a fresh post-click wait would silently raise the bound).
			const routeDeadlineAt = submittedAt + 90_000
			const routeRemainder = () => {
				const remainder = routeDeadlineAt - Date.now()
				if (remainder <= 0) throw new Error(`post-import 90s deadline exhausted (${Date.now() - submittedAt}ms since submit)`)
				return remainder
			}
			try {
				await page2.waitForFunction(
					() => {
						const h = window.location.hash
						if (h.includes("/popup/general") || h.includes("/popup/auth")) return true
						return !!document.querySelector('[data-testid="import-full-backup-continue-btn"]')
					},
					{ timeout: routeRemainder(), polling: 250 },
				)
				// Errors-screen branch: acknowledge the recorded skips (what a real
				// user does) and continue INTO the wallet on the remaining deadline.
				const continueVisible = await page2.evaluate(
					() => !!document.querySelector('[data-testid="import-full-backup-continue-btn"]'),
				)
				if (continueVisible) {
					await clickByTestId(page2, "import-full-backup-continue-btn")
					await page2.waitForFunction(
						() => {
							const h = window.location.hash
							return h.includes("/popup/general") || h.includes("/popup/auth")
						},
						{ timeout: routeRemainder(), polling: 250 },
					)
				}
			} catch (err) {
				const diag = await page2
					.evaluate(async () => {
						const all = await chrome.storage.local.get(null)
						const keys = Object.keys(all)
						return {
							hash: window.location.hash,
							navTrace: (window as unknown as { __nuloImportNavTrace?: Array<{ t: number; hash: string }> })
								.__nuloImportNavTrace,
							profileRows: keys.filter((k) => k.startsWith("nulo:core:profiles@")).length,
							activeAccountPointer: !!all["nulo:ui:activeAccount"],
							bodySnippet: (document.body.innerText ?? "").slice(0, 120),
						}
					})
					.catch((e) => ({ evalFailed: String(e) }))
				throw new Error(
					`post-import route wait timed out ${Date.now() - submittedAt}ms after submit; parked state: ${JSON.stringify(diag)}; original: ${(err as Error).message}`,
				)
			}
			// The recovery lands either locked (the documented strict-mode path, not a
			// failure) or already unlocked; ensureUnlocked reads the shell's own state
			// and no-ops in the latter, so it needs no caller-side hash sample.
			await ensureUnlocked(page2)
			await waitForHash(page2, "#/popup/general", 30_000)

			// Same profile id + master key ⇒ identical derived account. Proves the
			// imported profile is usable (store re-opened under the derived key), never
			// stranded on a dead-end "Finishing…" screen.
			// CONVERGENCE wait, not a snapshot read: post-import account setup races against the active
			// network's RPC latency (Alpha mainnet's public RPC is slow; the old Testnet default masked it).
			await waitForActiveAccount(page2, addressBefore)

			// Store-reopen cycle: lock (drop the in-memory master, as a worker restart
			// would) → unlock (re-derive → re-provision the store key → re-open the OPFS
			// store) → general. Re-read the account to prove the store RE-OPENED under the
			// re-derived key (refuse-and-preserve — never wiped).
			await reopenAndRecoverAfterImport(page2)
			await waitForActiveAccount(page2, addressBefore)
			await page2.close()
		} finally {
			await ctx2.browser.close()
			rmSync(profileDir, { recursive: true, force: true })
			// The ciphertext file embeds the (test) master key — never leave it around.
			rmSync(dir, { recursive: true, force: true })
		}
	},
)
