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
 * correctly: full recovery, or a COMPLETED rollback (profile row + deletion
 * tombstone both purged, provenance-gated on the marker having seen the row)
 * followed by the product's designed retry (re-import, no kill). Both legs
 * converge on the same funded-address + on-chain-balance assertions, so the
 * load-bearing checks run on EVERY pass. What the test rejects is the third
 * state it once flaked on: a silent park where the wallet is neither recovered
 * nor reset.
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
	captureBalanceBaseline,
	ensureUnlocked,
	getAccountAddress,
	navigateByHash,
	switchToLocalNetwork,
	waitForFreshBalanceRow,
	waitForTokenCardAmount,
} from "../fixtures/helpers"
import { armBackupDownloadCapture, readCapturedBackupDownload } from "../helpers/backup-export"
import {
	gotoPopupImport,
	importFullBackup,
	POPUP_IMPORT_SHELL,
	TEST_PASSWORD,
	setInputs,
	submitWhenEnabled,
	waitForActiveAccount,
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
	"a SW restart mid-restore recovers or rolls back cleanly then retries — either way the account syncs on-chain",
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
			// The ROLLED-BACK outcome is dispatched by THIS page's catch: the SW kill
			// rejects its in-flight restore RPC, the catch calls deleteProfile, and that
			// call wakes the restarted SW. Closing the page immediately RACES that
			// dispatch — when close wins, NEITHER designed outcome materializes:
			// profile+account rows survive un-finalized with token/balance slices
			// missing (observed live, census {tokenRows:0, accountRows:2}), the
			// reopened popup masquerades as RECOVERED, and no balance can ever
			// converge. A real SW restart leaves the page open (this test's scenario);
			// close-before-dispatch models a browser CRASH, whose silent partial
			// restore is a PRODUCT gap tracked in the deflake ledger, not this test's
			// subject. Hold the page until the post-kill fork is OBSERVABLE, then
			// close — the SW-side deletion cascade, once dispatched, survives page
			// close. chrome.storage is page-direct (not SW-routed), so these reads
			// work with the SW down.
			// Fork outcomes (audit-corrected): `general` AND `auth` are both designed
			// completion routes of the in-page recovery (`needs-unlock` routes to auth);
			// tombstone-present / zero-profile-rows mark a dispatched rollback. A fork
			// that stays unobserved is NOT a test failure by itself — the import flow
			// has a designed failure state that RETAINS the profile without a tombstone
			// (post-finalize-start errors), and its validity is decided by the reopen
			// path's on-chain assertions below, not pre-judged here. The hold's job is
			// only to give the page's rollback/recovery a chance to dispatch before the
			// close (the race that manufactured the phantom partial-restore state).
			let forkErr = ""
			const postKillFork = await page2
				.waitForFunction(
					async () => {
						const h = window.location.hash
						if (h.includes("general") || h.includes("auth")) return "actionable-route"
						const all = await chrome.storage.local.get()
						const keys = Object.keys(all)
						if (keys.some((k) => k.startsWith("nulo:core:profile-tombstones@"))) return "rollback-dispatched"
						if (!keys.some((k) => k.startsWith("nulo:core:profiles@"))) return "rollback-row-deleted"
						return false
					},
					{ timeout: 45_000, polling: 200 },
				)
				.then((h) => h.jsonValue())
				.catch((e) => {
					forkErr = e instanceof Error ? e.message : String(e)
					return "fork-unobserved"
				})
			if (postKillFork === "fork-unobserved") {
				const dump = await page2
					.evaluate(async () => {
						const all = await chrome.storage.local.get()
						return {
							hash: window.location.hash,
							coreKeys: Object.keys(all)
								.filter((k) => k.startsWith("nulo:core:"))
								.slice(0, 30),
						}
					})
					.catch((e) => ({ evalFailed: String(e) }))
				console.warn(
					`[sw-restart-restore] post-kill fork unobserved in 45s (designed retain-without-rollback state, or slow recovery); proceeding to reopen — the on-chain assertions decide. state: ${JSON.stringify(dump)}; waitErr: ${forkErr}`,
				)
			} else {
				console.warn(`[sw-restart-restore] post-kill fork: ${postKillFork}`)
			}
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
			//    has none to lose. This leg asserts the rollback COMPLETED (profile row
			//    gone AND its deletion tombstone cleared — the coordinator's
			//    purge-complete signal), then exercises the product's designed retry:
			//    re-import the same backup file, no kill, and converge into the same
			//    on-chain assertions as the recovered leg. Scope note: this is profile
			//    rollback — globally-written presentation config is deliberately outside
			//    the coordinator's purge.
			// A settle LOOP (not a one-shot unlock + single long wait) is required: the
			// fresh popup can transiently show /popup (an index route that immediately
			// pushes general) before the auth guard settles, and a one-shot hash sample
			// taken in that window no-ops the unlock — after which nobody ever types the
			// password and the old 240s wait parked silently.
			let page3 = await openPopup(ctx2)
			// Route-trajectory recorder: poll-based because vue-router's hash history
			// navigates via pushState, which fires neither hashchange nor popstate. It
			// can only observe from THIS point on — openPopup has already waited out the
			// earliest boot transitions, hence the "sinceRecorderInstall" label.
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

			let lastUnlockErr = ""
			const collectParkedState = async () =>
				await page3
					.evaluate(async () => {
						const w = window as unknown as { __nuloRouteTrace?: Array<{ t: number; h: string }> }
						const local = await chrome.storage.local.get()
						const session = await chrome.storage.session.get()
						return {
							traceSinceRecorderInstall: w.__nuloRouteTrace ?? "<recorder lost — page reloaded>",
							hash: window.location.hash,
							authFormVisible: document.querySelector('[data-testid="auth-password-input"]') !== null,
							bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
							localKeys: Object.keys(local).sort(),
							sessionKeys: Object.keys(session).sort(),
						}
					})
					.then((state) => ({ ...state, lastUnlockErr }))
					.catch((evalErr) => ({ evalFailed: String(evalErr), lastUnlockErr }))

			let leg: "recovered" | "rolled-back" | "timeout" = "timeout"
			const deadline = Date.now() + 240_000
			while (Date.now() < deadline) {
				const hash = await page3.evaluate(() => window.location.hash)
				if (hash.includes("/popup/general")) {
					leg = "recovered"
					break
				}
				if (hash.includes("/popup/auth")) {
					// Fall through to the sleep below after an attempt — a transient
					// auth/non-auth oscillation must not spin the loop hot. The last
					// unlock error rides into the timeout diagnostics.
					await ensureUnlocked(page3, TEST_PASSWORD).catch((err) => {
						lastUnlockErr = String(err)
					})
				} else if (hash.includes("/popup/register")) {
					// Register is terminal ONLY when the rollback has COMPLETED: the profile
					// row is deleted in deleteProfile's phase 1, but the deletion tombstone
					// is cleared only after the coordinator's purge of every profile-bearing
					// root succeeds — tombstone-gone is the designed completion signal. A
					// row-gone-tombstone-present window (purge in flight, or wedged) keeps
					// polling; a wedged purge ends in the timeout leg, whose storage-key dump
					// will show the lingering tombstone.
					const remnants = await page3.evaluate(async () => {
						const all = await chrome.storage.local.get()
						const keys = Object.keys(all)
						return {
							profileRows: keys.filter((k) => k.startsWith("nulo:core:profiles@")).length,
							tombstones: keys.filter((k) => k.startsWith("nulo:core:profile-tombstones@")).length,
						}
					})
					if (remnants.profileRows === 0 && remnants.tombstones === 0) {
						// Provenance gate: a clean register end-state is only the DESIGNED
						// rollback if the profile row demonstrably existed first (marker
						// "mid") — the only row-remover is tombstone-fenced deleteProfile,
						// so existed-then-fully-purged pins that path. Without the marker,
						// register-with-clean-storage is merely consistent with a restore
						// that crashed before creating anything — fail, don't absorb.
						if (midRestore !== "mid") {
							throw new Error(
								`[sw-restart-restore] wallet reset to register but the mid-restore marker was "${midRestore}" — no evidence the designed rollback ran; state: ${JSON.stringify(await collectParkedState())}`,
							)
						}
						leg = "rolled-back"
						break
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 500))
			}

			if (leg === "timeout") {
				throw new Error(
					`[sw-restart-restore] recovery neither reached general nor rolled back within 240s; parked state: ${JSON.stringify(await collectParkedState())}`,
				)
			}

			if (leg === "rolled-back") {
				// Complete the product's own retry journey so the load-bearing on-chain
				// assertions below run on EVERY path — a required gate must not stay
				// green while the registration checks are skipped run after run.
				console.warn(
					"[sw-restart-restore] pre-finalize kill → clean rollback confirmed (profile + tombstone purged); exercising the designed retry (re-import, no kill)",
				)
				await page3.close()
				page3 = await gotoPopupImport(ctx2)
				// Lands on general (the shell's successHash); the convergence wait then
				// covers the post-import account setup exactly as the integrity test does.
				await importFullBackup(page3, filePath, TEST_PASSWORD, POPUP_IMPORT_SHELL)
				await waitForActiveAccount(page3, funded)
			}

			// ── 4. Both legs converge: the imported account syncs its REAL balance ──
			// FRESHNESS-gated: the imported/re-imported backup already carries the
			// funded rows with nonzero updatedAt, so a value-only wait could pass
			// without any post-recovery sync. Baseline is captured here (post-recovery,
			// pre-refresh) so only a projection that ran AFTER this point satisfies the
			// wait; the exact raw row value + a card-scoped display assert replace the
			// body-text scan (false-positive prone) and the 40× refresh spam (starves
			// the popup thread, queues PXE readers). Same ~240s total envelope.
			await switchToLocalNetwork(page3)
			expect(await getAccountAddress(page3)).toBe(funded)
			const recoveryBaseline = await captureBalanceBaseline(page3, funded, aztecConfig!.tokenAddress)
			await waitForFreshBalanceRow(page3, {
				account: funded,
				tokenContract: aztecConfig!.tokenAddress,
				expectedPublicRaw: (1000n * 10n ** 18n).toString(),
				baselineUpdatedAt: recoveryBaseline,
				timeoutMs: 210_000,
			})
			await waitForTokenCardAmount(page3, "1,000", "TST")
		} finally {
			await ctx2.browser.close().catch(() => {})
			rmSync(profileDir, { recursive: true, force: true })
		}
	},
)
