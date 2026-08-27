/**
 * Crash truth for the mid-restore service-worker kill.
 *
 * Two DETERMINISTIC scenarios, each killing the worker while a restore RPC is
 * genuinely parked at a known phase (the `nulo:e2e:restore-gate` rendezvous —
 * armed by the test, ACKNOWLEDGED by the SW-side handler, so "armed" is never
 * mistaken for "reached"):
 *
 *  A. PRE-finalize crash (gate at `service-restore`, inside
 *     `ContactService.restore`): the product defines this as rollback — the
 *     import page's catch deletes the orphan profile (`useFullBackupImport`,
 *     pre-finalize branch) and marks `data-restore-stage=rolled-back`. The
 *     test then exercises the designed retry (a full re-import) and converges
 *     on-chain. A stage stuck pre-finalize with the page alive is classified
 *     by the disconnect probe: probe fired + no rollback = PRODUCT BUG
 *     (rollback never dispatched/completed after a real crash); probe silent
 *     = inconclusive kill/Port mechanics, reported as such — never a product
 *     verdict.
 *
 *  B. POST-finalize crash (gate at `account-state`, inside
 *     `AccountStateService.restore`): the product deliberately RETAINS the
 *     profile (its data is fully in storage). The restore-pending marker is
 *     asserted ABSENT before the kill (`finalizeRestore` clears it at entry),
 *     NO rollback stage may ever appear, and the reopen path must land on
 *     RECOVERY — a torn refusal here is a FAILURE (the marker is gone, so a
 *     matching torn screen would mean corruption or a stale marker).
 *
 * History: the previous version of this test used `Runtime.terminateExecution`,
 * which never terminated the worker (deflake-round-3 `lessons/phase-3.md`) —
 * its fast-rollback leg was reachable only because a live worker serviced
 * `deleteProfile` instantly, and its 300s re-import wait lapsed two
 * certification campaigns from that leg. With a real kill the fork was never
 * observed passively (five runs, up to 240s), which is WHY the rendezvous +
 * stage classification exist (deflake-round-4 plan, codex-audited).
 *
 * @requires-proverless — the restore-gate rendezvous is constructed only
 * under the statically-false-in-prod `NULO_E2E_PROVERLESS=1` branch (the
 * STUB-test family contract, which is also what the CI network shards run).
 * The agent runner greps for this marker and REFUSES a prover-ON invocation
 * of this file before any build; prover-ON coverage of the delete/re-import
 * surface lives in `profile-reimport-matrix.test.ts`, which has no gate
 * dependence.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, inject } from "vitest"
import type { Page, Target } from "puppeteer"
import type { AztecTestConfig } from "../fixtures/aztec"
import {
	clickByTestId,
	launchExtension,
	openPopup,
	test,
	waitForHash,
	withTimeoutMessage,
	type ExtensionContext,
} from "../fixtures/extension"
import {
	captureBalanceBaseline,
	ensureUnlocked,
	getAccountAddress,
	switchToLocalNetwork,
	waitForFreshBalanceRow,
	waitForTokenCardAmount,
} from "../fixtures/helpers"
import { armRestoreGate, clearRestoreGate, waitForRestoreGateHeld } from "../fixtures/restore-gate"
import {
	completeResetRitual,
	driveImportToSubmit,
	exportFundedBackup,
	readStage,
	reimportToTerminal,
	ROLLBACK_BUDGET_MS,
} from "../helpers/crash-truth"
import {
	gotoPopupImport,
	importFullBackup,
	POPUP_IMPORT_SHELL,
	TEST_PASSWORD,
	setInputs,
	waitForActiveAccount,
} from "../helpers/import-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	if (process.env.E2E_REQUIRE_SETUP === "1") {
		expect(hasConfig).toBe(true)
	}
})

/** Terminate the SW and wait for the ORIGINAL target's destruction —
 *  `worker().close()` is Chrome's documented termination primitive; object
 *  identity on `targetdestroyed` proves THIS worker died (a fast replacement
 *  cannot be mistaken for it). `Runtime.terminateExecution` is not a kill:
 *  it aborts the running script and leaves the worker alive. */
async function stopServiceWorker(ctx: ExtensionContext): Promise<void> {
	const swTarget = await ctx.browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(ctx.extensionId), {
		timeout: 15_000,
	})
	const destroyed = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			ctx.browser.off("targetdestroyed", onDestroyed)
			reject(new Error("stopServiceWorker: the service-worker target was still alive 15s after close()"))
		}, 15_000)
		function onDestroyed(target: Target) {
			if (target !== swTarget) return
			clearTimeout(timer)
			ctx.browser.off("targetdestroyed", onDestroyed)
			resolve()
		}
		ctx.browser.on("targetdestroyed", onDestroyed)
	})
	const worker = await swTarget.worker()
	if (!worker) throw new Error("stopServiceWorker: service-worker target exposed no worker to close")
	await worker.close()
	await destroyed
}

/** Page-side disconnect probe: an owned port (the SW's service collection
 *  claims "profile") whose `onDisconnect` timestamps the moment Chrome
 *  actually delivered the worker's death to this page. Distinguishes "the
 *  crash never reached the page" (inconclusive mechanics) from "the page saw
 *  the crash and the rollback still never ran" (a product finding). */
async function armDisconnectProbe(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as { __nuloDisconnectProbe?: { connectedAt: number; disconnectedAt: number | null } }
		const port = chrome.runtime.connect({ name: "profile" })
		w.__nuloDisconnectProbe = { connectedAt: Date.now(), disconnectedAt: null }
		port.onDisconnect.addListener(() => {
			if (w.__nuloDisconnectProbe) w.__nuloDisconnectProbe.disconnectedAt = Date.now()
		})
	})
}

async function readDisconnectProbe(page: Page): Promise<{ connectedAt: number; disconnectedAt: number | null } | null> {
	return await page
		.evaluate(() => {
			const w = window as unknown as { __nuloDisconnectProbe?: { connectedAt: number; disconnectedAt: number | null } }
			return w.__nuloDisconnectProbe ?? null
		})
		.catch(() => null)
}

// Budget for the SW handler to acknowledge the hold: the whole pre-hold
// restore runs under CI proving load first (decrypt, migrate, profile,
// networks, tokens for A; plus finalize's argon2 + session open for B).
const HELD_BUDGET_A_MS = 180_000
const HELD_BUDGET_B_MS = 300_000

// REGRESSION GATE for BUG-TRANSPORT (fixed by the liveness-gated rollback
// dispatch in useFullBackupImport): after a real
// mid-restore kill, the rollback's `deleteProfile` used to be rejected <1s
// later — the messaging client flips to Connected on doomed ports during the
// SW respawn gap and rejectAllPending kills gap-issued calls ("Client
// disconnected"), reproduced 4x with metronomic timing (sinceKill
// 811/798/784/799ms — deflake-round-4 `lessons/phase-1.md` runs 2-7). The
// composable's catch now classifies disconnect failures and gates the
// bounded rollback helper on the NEW worker's liveness advance (written only
// after full service wiring), so the delete runs against a live worker; the
// `rollback-failed` branch below stays as the PRODUCT-FINDING tripwire.
test.skipIf(!hasConfig)(
	"scenario A: a PRE-finalize crash rolls the orphan back, and the designed retry converges on-chain",
	{
		timeout: 900_000,
	},
	async ({ tokenReadyExtension }) => {
		const { filePath, funded } = await exportFundedBackup(tokenReadyExtension)

		const profileDir = mkdtempSync(join(tmpdir(), "nulo-sw-crash-pre-"))
		const ctx2 = await launchExtension({ userDataDir: profileDir })
		let gatePage: Page | null = null
		try {
			const page2 = await gotoPopupImport(ctx2)
			gatePage = page2
			// Unfiltered console tap — DIAGNOSTICS ONLY, and honest about its
			// limits: run-7 evidence showed app `console.*` from the popup never
			// reaches this CDP stream at all (ledger: consoleErrors blind spot),
			// so `deleteRejectionTail` is expected EMPTY under that blind spot.
			// The tap still earns its keep by counting the BROWSER-emitted
			// reconnect-churn lines ("Receiving end does not exist"), whose
			// monotone growth through the rejection window is the transport
			// attribution's actual discriminator, and by catching any future
			// capture-path change.
			const rawErrors: string[] = []
			page2.on("console", (msg) => {
				if (msg.type() === "error") rawErrors.push(msg.text())
			})
			// A real export always emits the contact slice as an array
			// (ContactService.backup returns getContacts()), so the per-service
			// loop always calls ContactService.restore — the held-wait's failure
			// diagnostic reads the stage to catch the "never reached" case anyway.
			await armRestoreGate(page2, "service-restore")
			await armDisconnectProbe(page2)
			await driveImportToSubmit(page2, filePath)
			await waitForRestoreGateHeld(page2, "service-restore", HELD_BUDGET_A_MS)

			const probePre = await readDisconnectProbe(page2)
			expect(probePre?.disconnectedAt ?? null).toBeNull()
			const stageAtKill = await readStage(page2)
			console.warn(`[sw-crash] A: killing while held at service-restore (stage=${stageAtKill})`)
			const killAt = Date.now()
			await stopServiceWorker(ctx2)

			// The state machine: the page is alive and its catch owns the
			// rollback. Terminal `rolled-back` is the designed outcome;
			// `rolling-back` need not be observed (DOM sampling can skip it).
			const outcome = await page2
				.waitForFunction(
					() => {
						const s = document.querySelector("[data-restore-stage]")?.getAttribute("data-restore-stage")
						return s === "rolled-back" || s === "rollback-failed" ? s : null
					},
					{ timeout: ROLLBACK_BUDGET_MS, polling: 250 },
				)
				.then((h) => h.jsonValue())
				.catch(() => "stuck")

			if (outcome === "stuck") {
				const probe = await readDisconnectProbe(page2)
				const stage = await readStage(page2)
				const store = await page2
					.evaluate(async () => {
						const all = await chrome.storage.local.get()
						const keys = Object.keys(all)
						return {
							profileRows: keys.filter((k) => k.startsWith("nulo:core:profiles@")),
							pendingMarkers: keys.filter((k) => k.startsWith("nulo:core:restore-pending@")),
						}
					})
					.catch(() => null)
				const detail = `stage=${stage}, sinceKill=${Date.now() - killAt}ms, probe=${JSON.stringify(probe)}, store=${JSON.stringify(store)}`
				if (probe?.disconnectedAt != null) {
					throw new Error(
						`PRODUCT BUG (pre-finalize crash, page alive): the disconnect reached the page but the designed ` +
							`rollback never completed within ${ROLLBACK_BUDGET_MS}ms — the orphan profile and restore-pending ` +
							`marker survive a crash the product defines as roll-back. ${detail}`,
					)
				}
				throw new Error(
					`INCONCLUSIVE (kill/Port mechanics): the page never observed the worker's disconnect, so no product ` +
						`verdict is possible. ${detail}`,
				)
			}

			if (outcome === "rollback-failed") {
				// The rollback DISPATCHED (the catch ran) and deleteProfile threw.
				// The raw tap above carries the rejection's actual text; settle
				// briefly first — the catch's console.error races CDP event
				// delivery, and this branch is diagnostics, not an assertion wait.
				await new Promise((r) => setTimeout(r, 750))
				const deleteRejectionTail = rawErrors.filter((t) => !t.includes("Receiving end does not exist")).slice(-6)
				const churnCount = rawErrors.length - rawErrors.filter((t) => !t.includes("Receiving end does not exist")).length
				const store = await page2
					.evaluate(async () => {
						const all = await chrome.storage.local.get()
						const keys = Object.keys(all)
						return {
							profileRows: keys.filter((k) => k.startsWith("nulo:core:profiles@")),
							pendingMarkers: keys.filter((k) => k.startsWith("nulo:core:restore-pending@")),
						}
					})
					.catch(() => null)
				const sinceKill = Date.now() - killAt
				// Before reporting, measure the DESIGNED BACKSTOP empirically: with
				// the orphan + marker in place, a re-import must hit the duplicate
				// branch, delete the orphan on the (now alive) worker, and retry to
				// convergence. Clear the gate FIRST — the armed record lives in
				// chrome.storage.session, which outlives the killed worker, and
				// would park the recovery import at the same hold point.
				await clearRestoreGate(page2)
				await page2.close()
				let recovery: string
				try {
					// The REAL designed path out of this state. The fresh-install
					// import route is unreachable (the popup boots to auth for the
					// surviving orphan): the unlock attempt must be REFUSED with the
					// torn message, whose own copy instructs delete-below-and-
					// re-import — so that is exactly what this probe drives.
					const pageR = await openPopup(ctx2)
					gatePage = pageR
					await pageR.waitForSelector('[data-testid="auth-password-input"] input', { visible: true, timeout: 15_000 })
					await setInputs(pageR, { '[data-testid="auth-password-input"] input': TEST_PASSWORD })
					await clickByTestId(pageR, "auth-submit")
					await pageR.waitForSelector('[data-testid="auth-restore-torn"]', { visible: true, timeout: 30_000 })
					await clickByTestId(pageR, "auth-reset")
					await pageR.waitForSelector('[data-testid="forgot-reset-btn"]', { visible: true, timeout: 10_000 })
					await clickByTestId(pageR, "forgot-reset-btn")
					await waitForHash(pageR, "#/popup/settings/security/reset", 10_000)
					// This delete rides the SAME deleteProfile the rollback could not
					// reach — on a live worker now.
					await completeResetRitual(pageR)
					const cleaned = await pageR.evaluate(async () => {
						const all = await chrome.storage.local.get()
						const keys = Object.keys(all)
						return {
							profileRows: keys.filter((k) => k.startsWith("nulo:core:profiles@")),
							pendingMarkers: keys.filter((k) => k.startsWith("nulo:core:restore-pending@")),
						}
					})
					if (cleaned.profileRows.length > 0 || cleaned.pendingMarkers.length > 0) {
						throw new Error(`reset left residue: ${JSON.stringify(cleaned)}`)
					}
					const skipErrors = await reimportToTerminal(pageR, filePath)
					await waitForActiveAccount(pageR, funded)
					const baselineR = await captureBalanceBaseline(pageR, funded, aztecConfig!.tokenAddress)
					await waitForFreshBalanceRow(pageR, {
						account: funded,
						tokenContract: aztecConfig!.tokenAddress,
						expectedPublicRaw: (1000n * 10n ** 18n).toString(),
						baselineUpdatedAt: baselineR,
						timeoutMs: 210_000,
					})
					await waitForTokenCardAmount(pageR, "1,000", "TST")
					recovery = skipErrors
						? `torn-unlock, delete, re-import: CONVERGED WITH SKIP ERRORS — summary: ${JSON.stringify(skipErrors)}`
						: "torn-unlock, delete, re-import: CONVERGED clean"
				} catch (recoveryErr) {
					// Where the probe died matters as much as that it died: the
					// route, the import's stage attribute, and whether the errors
					// screen (which never auto-routes) is what the success-hash
					// wait was actually starving behind.
					const diag = gatePage
						? await gatePage
								.evaluate(() => ({
									hash: window.location.hash,
									stage: document.querySelector("[data-restore-stage]")?.getAttribute("data-restore-stage") ?? null,
									errorsScreen: !!document.querySelector('[data-testid="import-full-backup-continue-btn"]'),
								}))
								.catch(() => null)
						: null
					recovery =
						`torn-unlock, delete, re-import FAILED: ${(recoveryErr as Error)?.message ?? String(recoveryErr)} ` +
						`diag=${JSON.stringify(diag)} probeConsole=${JSON.stringify(ctx2.consoleErrors.slice(0, 8))}`
				}
				throw new Error(
					`PRODUCT FINDING (pre-finalize crash, page alive): the designed rollback dispatched but ` +
						`deleteProfile FAILED — the orphan survives a crash the product defines as roll-back. ` +
						`recovery-backstop=${JSON.stringify(recovery)} deleteRejection=${JSON.stringify(deleteRejectionTail)} ` +
						`reconnectChurn=${churnCount} pageErrors=${JSON.stringify(
							ctx2.pageErrors.map((e) => e.message),
						)} store=${JSON.stringify(store)} sinceKill=${sinceKill}ms`,
				)
			}
			expect(outcome).toBe("rolled-back")
			// The rollback's storage effects, not just the stage: orphan gone,
			// marker gone.
			const store = await page2.evaluate(async () => {
				const all = await chrome.storage.local.get()
				const keys = Object.keys(all)
				return {
					profileRows: keys.filter((k) => k.startsWith("nulo:core:profiles@")),
					pendingMarkers: keys.filter((k) => k.startsWith("nulo:core:restore-pending@")),
				}
			})
			expect(store.profileRows).toEqual([])
			expect(store.pendingMarkers).toEqual([])
			await clearRestoreGate(page2)
			await page2.close()

			// The designed retry — previously reachable only by race, now on
			// every A run. importFullBackup's own success wait applies.
			const page3 = await gotoPopupImport(ctx2)
			gatePage = page3
			await importFullBackup(page3, filePath, TEST_PASSWORD, POPUP_IMPORT_SHELL)
			await waitForActiveAccount(page3, funded)

			await switchToLocalNetwork(page3)
			expect(await getAccountAddress(page3)).toBe(funded)
			const baseline = await captureBalanceBaseline(page3, funded, aztecConfig!.tokenAddress)
			await waitForFreshBalanceRow(page3, {
				account: funded,
				tokenContract: aztecConfig!.tokenAddress,
				expectedPublicRaw: (1000n * 10n ** 18n).toString(),
				baselineUpdatedAt: baseline,
				timeoutMs: 210_000,
			})
			await waitForTokenCardAmount(page3, "1,000", "TST")
			expect(ctx2.pageErrors).toEqual([])
		} finally {
			if (gatePage) await clearRestoreGate(gatePage).catch(() => {})
			await ctx2.browser.close().catch(() => {})
			rmSync(profileDir, { recursive: true, force: true })
		}
	},
)

test.skipIf(!hasConfig)(
	"scenario B: a POST-finalize crash retains the profile — no rollback, recovery only, never torn",
	{ timeout: 900_000 },
	async ({ tokenReadyExtension }) => {
		const { filePath, funded } = await exportFundedBackup(tokenReadyExtension)

		const profileDir = mkdtempSync(join(tmpdir(), "nulo-sw-crash-post-"))
		const ctx2 = await launchExtension({ userDataDir: profileDir })
		let gatePage: Page | null = null
		try {
			const page2 = await gotoPopupImport(ctx2)
			gatePage = page2
			await armRestoreGate(page2, "account-state")
			await armDisconnectProbe(page2)
			await driveImportToSubmit(page2, filePath)
			await waitForRestoreGateHeld(page2, "account-state", HELD_BUDGET_B_MS)

			// Post-finalize preconditions, asserted BEFORE the kill:
			// finalizeRestore cleared the pending marker at entry, so a torn
			// screen after the crash cannot be a designed outcome.
			const pre = await page2.evaluate(async () => {
				const all = await chrome.storage.local.get()
				const keys = Object.keys(all)
				return {
					profileRows: keys.filter((k) => k.startsWith("nulo:core:profiles@")),
					pendingMarkers: keys.filter((k) => k.startsWith("nulo:core:restore-pending@")),
				}
			})
			expect(pre.profileRows.length).toBeGreaterThan(0)
			expect(pre.pendingMarkers).toEqual([])
			const probePre = await readDisconnectProbe(page2)
			expect(probePre?.disconnectedAt ?? null).toBeNull()

			console.warn("[sw-crash] B: killing while held at account-state (post-finalize)")
			await stopServiceWorker(ctx2)
			await clearRestoreGate(page2)

			// The retain contract: no rollback stage may EVER appear. Bounded
			// observation (an absence has no completion signal); the follow-on
			// assertions are the real proof.
			const sawRollback = await page2
				.waitForFunction(
					() => {
						const s = document.querySelector("[data-restore-stage]")?.getAttribute("data-restore-stage")
						return s === "rolling-back" || s === "rolled-back" || s === "rollback-failed" ? s : null
					},
					{ timeout: 10_000, polling: 250 },
				)
				.then((h) => h.jsonValue())
				.catch(() => null)
			expect(sawRollback).toBeNull()

			// The import page finishes against the NEW worker (the in-flight
			// account-state RPC rejects and is RECORDED as skip errors, not
			// fatal). Accept either terminal shape: the errors screen's
			// Continue, or a clean finish.
			const terminal = await withTimeoutMessage(
				page2
					.waitForFunction(
						() => {
							if (document.querySelector('[data-testid="import-full-backup-continue-btn"]')) return "errors-continue"
							const s = document.querySelector("[data-restore-stage]")?.getAttribute("data-restore-stage")
							return s === "finished" ? "finished" : null
						},
						{ timeout: 300_000, polling: 250 },
					)
					.then((h) => h.jsonValue()),
				async () => `post-finalize crash: the import never reached a terminal state (stage=${await readStage(page2)})`,
			)
			if (terminal === "errors-continue") {
				await clickByTestId(page2, "import-full-backup-continue-btn")
			}
			// The retained profile must never present the torn screen: assert
			// its testid absent once the route settles.
			await page2.waitForFunction(() => window.location.hash.length > 2, { timeout: 60_000, polling: 200 }).catch(() => {})
			const torn = await page2.evaluate(() => !!document.querySelector('[data-testid="auth-restore-torn"]')).catch(() => false)
			expect(torn).toBe(false)
			await page2.close()

			// Reopen: strict mode silentCloses the bearer-less session on the
			// new worker, so recovery is an ordinary unlock — then the imported
			// account proves usable on-chain.
			const page3 = await openPopup(ctx2)
			await ensureUnlocked(page3, TEST_PASSWORD)
			await waitForActiveAccount(page3, funded)
			// The restored active-network pointer was written during
			// restoring:networks — BEFORE this scenario's kill point — so it is
			// part of the retain contract: the wallet must REOPEN on Local
			// Network, no switch. (Switching here would be a repeat switch,
			// whose "address flips" disambiguation can never be satisfied —
			// the target chain re-derives the address already active.) Wait
			// for the header to render before asserting; the chip mounts
			// empty for a beat on a fresh popup.
			await withTimeoutMessage(
				page3.waitForFunction(
					() => {
						const btn = document.querySelector('[data-testid="network-button"]')
						return !!btn && (btn.textContent ?? "").trim().length > 0
					},
					{ timeout: 30_000, polling: 250 },
				),
				async () => "post-crash reopen: the network header never rendered",
			)
			const activeNetwork = await page3.evaluate(() => {
				const btn = document.querySelector('[data-testid="network-button"]')
				return (btn?.textContent ?? "").trim()
			})
			expect(activeNetwork).toBe("Local Network")
			expect(await getAccountAddress(page3)).toBe(funded)
			const baseline = await captureBalanceBaseline(page3, funded, aztecConfig!.tokenAddress)
			await waitForFreshBalanceRow(page3, {
				account: funded,
				tokenContract: aztecConfig!.tokenAddress,
				expectedPublicRaw: (1000n * 10n ** 18n).toString(),
				baselineUpdatedAt: baseline,
				timeoutMs: 210_000,
			})
			await waitForTokenCardAmount(page3, "1,000", "TST")
		} finally {
			if (gatePage) await clearRestoreGate(gatePage).catch(() => {})
			await ctx2.browser.close().catch(() => {})
			rmSync(profileDir, { recursive: true, force: true })
		}
	},
)
