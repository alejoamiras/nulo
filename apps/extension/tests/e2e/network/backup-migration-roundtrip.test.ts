/**
 * Backup-migration ROUND-TRIP on a live sandbox — the durable harness that
 * gives every future real backup-schema migration automated on-chain coverage:
 *
 *   1. A funded wallet (registered + 1,000 tokens minted on the local chain)
 *      exports a REAL full backup through the export UI. The download is
 *      captured in-page (chrome.downloads stubbed — no native prompt, no
 *      filesystem) and gunzipped with the page's own DecompressionStream.
 *   2. The blob is doctored into a PRE-shape v1 backup: a contact row carrying
 *      `legacyName` (the shape the build-stamped declarative backup fixture
 *      v9001 migrates), checksum recomputed — legitimate, a plain backup's
 *      checksum is integrity detection, not authentication.
 *   3. A FRESH extension imports it: the migrator runs the real engine over
 *      the slices, then the unchanged restore pipeline writes them.
 *   4. On-chain functionality is asserted, not inferred: the restored profile
 *      keeps its id, so key derivation reproduces the SAME account address,
 *      and the wallet syncs the account's REAL 1,000-token balance from the
 *      chain through its own PXE (contract registrations restored from the
 *      backup's account-state slice).
 *
 * Run isolation: this file runs under `bun run e2e:agent`, which owns its
 * port pack + processes; the second browser here uses its own temp profile
 * dir and is closed + removed in finally.
 */
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, launchExtension, openPopup, replaceInputValue, test, waitForHash } from "../fixtures/extension"
import { getAccountAddress, navigateByHash, refreshBalances, switchToLocalNetwork, waitForBalance } from "../fixtures/helpers"
import { gotoPopupImport, importFullBackup, POPUP_IMPORT_SHELL, TEST_PASSWORD, writeBackupToTemp } from "../helpers/import-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined
const HAS_FIXTURE = process.env.NULO_E2E_MIGRATION_FIXTURE === "1"

test.skipIf(!hasConfig)("fixture-arming contract: the agent runner must arm the backup fixture", () => {
	// agent.sh stamps the build AND exports NULO_E2E_MIGRATION_FIXTURE=1. If
	// either half regresses, this FAILS the run — the round-trip below must
	// never silently skip on a live sandbox (a skipped fixture e2e is a false
	// green).
	expect(HAS_FIXTURE).toBe(true)
})

test.skipIf(!hasConfig || !HAS_FIXTURE)(
	"a doctored v1 backup migrates, restores, and the wallet is on-chain functional",
	{ timeout: 600_000 },
	async ({ tokenReadyExtension }) => {
		// ── 1. Export a REAL backup from the funded wallet ────────────────
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await navigateByHash(page, "#/popup/settings/security/export/full")
		await clickByTestId(page, "agree-continue-btn")
		await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 10_000 })
		await replaceInputValue(page, '[data-testid="unlock-password-input"]', TEST_PASSWORD)
		await clickByTestId(page, "unlock-submit-btn")
		await page.waitForFunction(
			() => {
				const btn = document.querySelector<HTMLButtonElement>('[data-testid="download-backup-btn"]')
				return !!btn && !btn.disabled
			},
			{ timeout: 120_000, polling: 250 },
		)

		// Capture the download in-page: stub the optional-permission gate and
		// chrome.downloads, fetch the blob URL BEFORE downloadFile's finally
		// revokes it, gunzip via DecompressionStream, hand the JSON back.
		await page.evaluate(() => {
			const w = window as unknown as { __backupCapture?: Promise<string> }
			w.__backupCapture = new Promise<string>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("backup download was not captured within 30s")), 30_000)
				const c = chrome as unknown as {
					permissions: { contains: (p: unknown, cb: (has: boolean) => void) => void }
					downloads: { download: (opts: { url: string }, cb: (id: number) => void) => void }
				}
				c.permissions.contains = (_perms, cb) => cb(true)
				c.downloads = {
					download: (opts, cb) => {
						fetch(opts.url)
							.then((r) => r.blob())
							.then(async (blob) => {
								const ds = new DecompressionStream("gzip")
								const text = await new Response(blob.stream().pipeThrough(ds)).text()
								clearTimeout(timer)
								resolve(text)
								cb(1)
							})
							.catch((err) => {
								clearTimeout(timer)
								reject(err instanceof Error ? err : new Error(String(err)))
							})
					},
				}
			})
			// Swallow the (test-only) unhandled rejection if the click never fires.
			w.__backupCapture.catch(() => {})
		})
		await clickByTestId(page, "download-backup-btn")
		const exportedJson = await page.evaluate(() => (window as unknown as { __backupCapture: Promise<string> }).__backupCapture)
		await page.close()

		// ── 2. Doctor it into a PRE-shape backup ──────────────────────────
		// Don't pin exact version VALUES: this harness must keep working when a
		// real migration bumps the export stamp — the fixture's 9001 sentinel
		// stays pending above any real version, which is all the test needs.
		const exported = JSON.parse(exportedJson) as { checksum?: string; data: Record<string, unknown> } & Record<string, unknown>
		expect(typeof exported["compat-epoch"]).toBe("number")
		const exportedVersion = exported["backup-schema-version"]
		expect(Number.isInteger(exportedVersion) && (exportedVersion as number) >= 1).toBe(true)
		const profile = exported.data.profile as { id: string }
		exported.data.contact = [
			{
				id: "rt-contact-1",
				profileId: profile.id,
				address: `0x${"03".repeat(32)}`,
				legacyName: "Roundtrip Ali",
				abbreviation: "RA",
			},
		]
		const { checksum: _stale, ...body } = exported
		const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex")
		const filePath = writeBackupToTemp(JSON.stringify({ ...body, checksum }))

		// ── 3. Import into a FRESH extension ──────────────────────────────
		const profileDir = mkdtempSync(join(tmpdir(), "nulo-backup-rt-"))
		const ctx2 = await launchExtension({ userDataDir: profileDir })
		try {
			const page2 = await gotoPopupImport(ctx2)
			await importFullBackup(page2, filePath, TEST_PASSWORD, POPUP_IMPORT_SHELL)

			// The migration ran BEFORE restore: the contact row landed in the
			// CURRENT shape (v9001 renamed legacyName → name).
			const contacts = await page2.evaluate(async () => {
				const all = await chrome.storage.local.get()
				return Object.entries(all)
					.filter(([k]) => k.startsWith("nulo:core:contacts@"))
					.map(([, v]) => JSON.parse(v as string) as Record<string, unknown>)
			})
			expect(contacts).toHaveLength(1)
			expect(contacts[0].name).toBe("Roundtrip Ali")
			expect(contacts[0]).not.toHaveProperty("legacyName")

			// ── 4. On-chain functionality ──────────────────────────────────
			// Restore preserved the profile id, so key derivation reproduces
			// the funded account.
			await switchToLocalNetwork(page2)
			const restoredAddress = await getAccountAddress(page2)
			expect(restoredAddress).toBe(tokenReadyExtension.accountAddress)

			// The wallet syncs the REAL on-chain balance through its own PXE
			// (token rows + account-state contract registrations came from the
			// backup). Mirror the tokenReadyExtension refresh cadence.
			for (let i = 0; i < 40; i++) {
				await refreshBalances(page2)
				const bodyText = await page2.evaluate(() => document.body.innerText)
				if (bodyText.includes("1,000")) break
				await page2
					.waitForFunction(() => document.body.innerText.includes("1,000"), { timeout: 3_000, polling: 500 })
					.catch(() => {})
			}
			await waitForBalance(page2, "1,000", 30_000)

			await page2.close()
		} finally {
			await ctx2.browser.close()
			rmSync(profileDir, { recursive: true, force: true })
			// The doctored file embeds the wallet's REAL (local-chain test)
			// master-key — never leave it in the temp dir (codex post-impl audit).
			rmSync(dirname(filePath), { recursive: true, force: true })
		}
	},
)
