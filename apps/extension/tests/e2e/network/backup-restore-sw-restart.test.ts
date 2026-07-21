/**
 * The P3 fold from P2's diagnosis: an MV3 service-worker restart MID-RESTORE is
 * production-plausible, and contract registrations applied during the restore
 * must survive it — after the user's natural recovery (reopen + unlock), the
 * imported wallet must be fully on-chain functional (account address intact,
 * real token balance syncs), which is only possible if the account + token
 * contracts are (re)registered against the encrypted PXE store.
 *
 * The kill lands deterministically MID-restore: after the import submit, the
 * test waits for the restored profile ROW to appear in raw chrome.storage
 * (restore started) and kills the SW before the import page's success
 * navigation (restore not finished). If the restore wins the race and finishes
 * first, the test degenerates to the plain reopen-recovery leg — still a valid
 * pass, logged for visibility.
 *
 * The registration guarantee only applies when there ARE registrations to lose:
 * a kill landing PRE-finalize triggers the import composable's designed rollback
 * (the orphan profile is deleted so a retry starts clean) and registrations
 * haven't happened yet — the wallet legitimately resets to register. The test
 * therefore accepts two outcomes, asserting whichever occurred was performed
 * correctly: full recovery to a synced balance, or a CLEAN rollback. What it
 * rejects is the third state this test once flaked on: a silent park where the
 * wallet is neither recovered nor reset.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import {
	clickByTestId,
	launchExtension,
	openPopup,
	replaceInputValue,
	test,
	waitForHash,
	type ExtensionContext,
} from "../fixtures/extension"
import {
	ensureUnlocked,
	getAccountAddress,
	navigateByHash,
	refreshBalances,
	switchToLocalNetwork,
	waitForBalance,
} from "../fixtures/helpers"
import { armBackupDownloadCapture, readCapturedBackupDownload } from "../helpers/backup-export"
import {
	gotoPopupImport,
	POPUP_IMPORT_SHELL,
	TEST_PASSWORD,
	setInputs,
	submitWhenEnabled,
	writeBackupToTemp,
} from "../helpers/import-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	if (process.env.E2E_REQUIRE_SETUP === "1") {
		expect(hasConfig).toBe(true)
	}
})

// Mirrors sw-restart-network.test.ts — kept inline per that file's precedent.
// One deviation: an ABSENT service-worker target is a pass-through, not a failure.
// The precedent tests kill the SW right after actively messaging it (guaranteed
// awake); here the kill lands mid-restore, and under CI load Chrome's own MV3
// reaper can take the SW down first — which IS the mid-restore SW death this
// test exists to exercise, so proceed to the recovery leg instead of failing.
async function stopServiceWorker(ctx: ExtensionContext): Promise<void> {
	const swTarget = await ctx.browser
		.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(ctx.extensionId), { timeout: 5_000 })
		.catch(() => null)
	if (!swTarget) {
		console.warn("[sw-restart-restore] no live SW target — Chrome already killed it; proceeding to recovery")
		return
	}
	const swSession = await swTarget.createCDPSession()
	try {
		await swSession.send("Runtime.terminateExecution")
	} catch {
		// Session dies along with the SW; swallow disconnect noise.
	}
}

test.skipIf(!hasConfig)(
	"a SW restart mid-restore recovers to a synced on-chain balance or rolls back cleanly — never a silent wedge",
	// 15 min: this test does export + fresh-import + mid-restore SW kill + full recovery + on-chain
	// balance sync — more than any single-op network test, so it needs headroom for the generous
	// inner waits above under CI proving load.
	{ timeout: 900_000 },
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
		await armBackupDownloadCapture(page)
		await clickByTestId(page, "download-backup-btn")
		const exportedJson = await readCapturedBackupDownload(page)
		await page.close()
		const funded = tokenReadyExtension.accountAddress
		const filePath = writeBackupToTemp(exportedJson)

		// ── 2. Import into a FRESH extension, killing the SW mid-restore ──
		const profileDir = mkdtempSync(join(tmpdir(), "nulo-sw-restart-restore-"))
		const ctx2 = await launchExtension({ userDataDir: profileDir })
		try {
			const page2 = await gotoPopupImport(ctx2)
			// Inlined importFullBackup WITHOUT its success wait — the kill must
			// land before the success navigation.
			await page2.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 10_000 })
			await clickByTestId(page2, "import-option-full-backup")
			await page2.waitForSelector('[data-testid="import-full-backup-pick-file"]', { visible: true, timeout: 10_000 })
			const [chooser] = await Promise.all([
				page2.waitForFileChooser({ timeout: 10_000 }),
				clickByTestId(page2, "import-full-backup-pick-file"),
			])
			await chooser.accept([filePath])
			await page2.waitForSelector(`[data-testid="${POPUP_IMPORT_SHELL.submitTestId("full-backup")}"]`, {
				visible: true,
				timeout: 10_000,
			})
			await setInputs(page2, {
				'[data-testid="import-full-backup-password-input"] input': TEST_PASSWORD,
				'[data-testid="import-full-backup-password-confirm-input"] input': TEST_PASSWORD,
			})
			await submitWhenEnabled(page2, POPUP_IMPORT_SHELL.submitTestId("full-backup"))

			// Mid-restore marker: the restored profile ROW exists (restore started)
			// but the page hasn't navigated to success (restore not finished). Best-effort:
			// under CI proving load the marker can be slow, and the kill+recovery below is the
			// real assertion — a marker timeout must NOT fail the test, it just degrades to a
			// post-import restart (still a valid recovery exercise).
			const midRestore = await page2
				.waitForFunction(
					async () => {
						if (window.location.hash.includes("general")) return "finished"
						const all = await chrome.storage.local.get()
						return Object.keys(all).some((k) => k.startsWith("nulo:core:profiles@")) ? "mid" : false
					},
					{ timeout: 120_000, polling: 100 },
				)
				.then((h) => h.jsonValue())
				.catch(() => "timeout")

			if (midRestore !== "mid") {
				console.warn(`[sw-restart-restore] marker=${midRestore}; killing anyway (post-import restart leg)`)
			}
			await stopServiceWorker(ctx2)
			await page2.close()

			// ── 3. The user's natural recovery: reopen + unlock ─────────────
			// Two DESIGNED outcomes exist, decided by where the kill lands relative to
			// finalizeRestore (verified against useFullBackupImport):
			//  - RECOVERED: kill landed post-finalize (session opened, registrations
			//    applied) — reopen routes to auth, unlock re-derives the master and
			//    boots the chain runtime, and the wallet lands on general.
			//  - ROLLED BACK: kill landed pre-finalize — the import page's outer catch
			//    deletes the just-created profile ("delete the orphan so a retry starts
			//    clean"), so the reopened popup has ZERO profiles and legitimately routes
			//    to register. Registrations only happen post-finalize, so this kill point
			//    has none to lose; the user retries with their backup file. This leg
			//    asserts the rollback was CLEAN (no orphan profile row).
			// A settle LOOP (not a one-shot unlock + single long wait) is required: the
			// fresh popup can transiently show /popup (an index route that immediately
			// pushes general) before the auth guard settles, and a one-shot hash sample
			// taken in that window no-ops the unlock — after which nobody ever types the
			// password and the old 240s wait parked silently.
			const page3 = await openPopup(ctx2)
			// Route-trajectory recorder: poll-based because vue-router's hash history
			// navigates via pushState, which fires neither hashchange nor popstate.
			await page3.evaluate(() => {
				const w = window as unknown as { __nuloRouteTrace?: Array<{ t: number; h: string }> }
				const trace: Array<{ t: number; h: string }> = [{ t: Date.now(), h: window.location.hash }]
				w.__nuloRouteTrace = trace
				setInterval(() => {
					const h = window.location.hash
					if (trace[trace.length - 1]?.h !== h) trace.push({ t: Date.now(), h })
				}, 100)
			})
			await page3.waitForFunction(() => window.location.hash.length > 2, { timeout: 60_000 })

			let leg: "recovered" | "rolled-back" | "timeout" = "timeout"
			const deadline = Date.now() + 240_000
			while (Date.now() < deadline) {
				const hash = await page3.evaluate(() => window.location.hash)
				if (hash.includes("/popup/general")) {
					leg = "recovered"
					break
				}
				if (hash.includes("/popup/auth")) {
					await ensureUnlocked(page3, TEST_PASSWORD).catch(() => {})
					continue
				}
				if (hash.includes("/popup/register")) {
					// Register is terminal ONLY with the profile row really gone (the guard
					// routes here strictly on an empty getProfiles()); re-check raw storage
					// so a transient guard state can't end the loop early.
					const profileRows = await page3.evaluate(async () => {
						const all = await chrome.storage.local.get()
						return Object.keys(all).filter((k) => k.startsWith("nulo:core:profiles@"))
					})
					if (profileRows.length === 0) {
						leg = "rolled-back"
						break
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 500))
			}

			if (leg === "timeout") {
				const diag = await page3
					.evaluate(async () => {
						const w = window as unknown as { __nuloRouteTrace?: Array<{ t: number; h: string }> }
						const local = await chrome.storage.local.get()
						const session = await chrome.storage.session.get()
						return {
							trace: w.__nuloRouteTrace ?? "<recorder lost — page reloaded>",
							hash: window.location.hash,
							authFormVisible: document.querySelector('[data-testid="auth-password-input"]') !== null,
							bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
							localKeys: Object.keys(local).sort(),
							sessionKeys: Object.keys(session).sort(),
						}
					})
					.catch((evalErr) => ({ evalFailed: String(evalErr) }))
				throw new Error(
					`[sw-restart-restore] recovery neither reached general nor rolled back within 240s; parked state: ${JSON.stringify(diag)}`,
				)
			}

			if (leg === "rolled-back") {
				console.warn(
					"[sw-restart-restore] pre-finalize kill → designed clean rollback (profile deleted, register shown); recovery leg not exercised this run",
				)
				return
			}

			// ── 4. RECOVERED: contracts survived — the imported account syncs its REAL balance ──
			await switchToLocalNetwork(page3)
			expect(await getAccountAddress(page3)).toBe(funded)
			for (let i = 0; i < 40; i++) {
				await refreshBalances(page3)
				if ((await page3.evaluate(() => document.body.innerText)).includes("1,000")) break
				await page3
					.waitForFunction(() => document.body.innerText.includes("1,000"), { timeout: 3_000, polling: 500 })
					.catch(() => {})
			}
			await waitForBalance(page3, "1,000", 120_000)
		} finally {
			await ctx2.browser.close().catch(() => {})
			rmSync(profileDir, { recursive: true, force: true })
		}
	},
)
