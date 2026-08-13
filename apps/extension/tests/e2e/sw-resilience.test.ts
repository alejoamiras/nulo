import { expect } from "vitest"
import type { Page } from "puppeteer"
import { TEST_PASSWORD } from "./fixtures/constants"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue, type ExtensionContext } from "./fixtures/extension"
import { lockWallet } from "./fixtures/helpers"

/** Stop the SW via CDP — closest approximation of MV3's idle-suspend
 *  recycle. Used by both strict-mode tests below. */
async function stopServiceWorker(ext: ExtensionContext): Promise<void> {
	const swTarget = await ext.browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(ext.extensionId), {
		timeout: 5_000,
	})
	const swSession = await swTarget.createCDPSession()
	try {
		await swSession.send("Runtime.terminateExecution")
	} catch {
		// Session dies along with the SW; swallow disconnect noise.
	}
}

/** Post-restart readiness: chrome.storage.session RETAINS the dead worker's
 *  heartbeat while the extension stays loaded, so the gate requires a
 *  timestamp STRICTLY NEWER than the pre-kill snapshot — truthy alone passes
 *  before the replacement worker boots (see the regression pin below). */
async function waitForLiveness(page: Page, afterTs: number): Promise<void> {
	await page.waitForFunction(
		async (priorTs: number) => {
			try {
				const result = await chrome.storage.session.get("nulo:liveness")
				return Number(result["nulo:liveness"] ?? 0) > priorTs
			} catch {
				return false
			}
		},
		{ timeout: 30_000, polling: 500 },
		afterTs,
	)
}

/** Read the current liveness heartbeat (0 when absent/unreadable). */
async function readLiveness(page: Page): Promise<number> {
	return await page.evaluate(async () => {
		try {
			const r = await chrome.storage.session.get("nulo:liveness")
			return Number(r["nulo:liveness"] ?? 0)
		} catch {
			return 0
		}
	})
}

// Stopping and restarting the SW via CDP is the closest e2e approximation
// of Chrome's MV3 lifecycle recycle (idle SW gets killed; next event respawns
// it cold). chrome.storage.session survives the kill, so a FRESH heartbeat
// (strictly newer than pre-kill) must appear before the popup can boot. This test
// catches storage migration regressions, broken SW initialization, and any
// hard-to-reach race in the cold-start boot path. (chrome.runtime.reload()
// fully unloads the extension long enough that puppeteer-launched Chrome
// returns ERR_BLOCKED_BY_CLIENT for an unbounded window — too brittle.)
// SKIP: SW-respawn lifecycle tests are intrinsically flaky on hosted CI
// (Chrome internal timing). User-visible lock/unlock + strict-mode behavior
// is covered by tests/e2e/security.test.ts and registration.test.ts. The
// three SW-respawn tests in this file are excellent locally for development
// and stay skipped on CI until the respawn waiter is hardened to a stable
// signal. Un-skip when the helper waits on something deterministic.
test.skip("extension survives SW stop+respawn: lock → kill SW → unlock → general", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await lockWallet(page)
	const preKillLiveness = await readLiveness(page)
	await page.close()

	await stopServiceWorker(registeredExtension)

	// Open a fresh popup. The popup app's SW client will trigger the SW to
	// spawn cold, write the liveness heartbeat, and serve the locked-state
	// initial route (/popup/auth).
	const page2 = await openPopup(registeredExtension)
	await waitForLiveness(page2, preKillLiveness)

	// Locked from before reload, so we land on auth
	await waitForHash(page2, "#/popup/auth", 15_000)

	// Unlock with the original password
	await page2.waitForSelector('[data-testid="auth-password-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page2, '[data-testid="auth-password-input"]', TEST_PASSWORD)
	await clickByTestId(page2, "auth-submit")
	await page2.waitForFunction(() => !window.location.hash.includes("/popup/auth"), { timeout: 15_000 })
	await waitForHash(page2, "#/popup/general", 10_000)

	expect(registeredExtension.pageErrors).toEqual([])
	await page2.close()
}, 90_000)

/**
 * With strict security mode default ON, SW death without a manual lock
 * MUST also land the user on `/popup/auth`. Without strict mode the
 * persisted `passhash` bearer would silently re-unlock; under strict ON
 * the bearer is never persisted, so cold-restore short-circuits → lock
 * screen.
 *
 * Automated coverage for the strict-default-ON contract. Differs from
 * the previous test by NOT calling `lockWallet()` — proves the lock
 * comes from strict mode, not from explicit user action.
 */
// SKIP: same SW-respawn timing flake as the first test in this file.
test.skip("strict mode default ON: unlock → kill SW → expect lock screen on respawn", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")
	// Note: deliberately NO lockWallet() call. Strict mode is the lock.
	const preKillLiveness = await readLiveness(page)
	await page.close()

	await stopServiceWorker(registeredExtension)

	const page2 = await openPopup(registeredExtension)
	await waitForLiveness(page2, preKillLiveness)

	// Strict ON: persisted Session has no passhash → restore() silentCloses
	// → popup boots locked → /popup/auth. This route assertion IS the
	// strict-mode contract; the actual unlock UI is exercised by the
	// existing "lock → kill SW → unlock" test above.
	await waitForHash(page2, "#/popup/auth", 15_000)

	expect(registeredExtension.pageErrors).toEqual([])
	await page2.close()
}, 90_000)

/**
 * Strict-mode opt-out: when the user disables strict mode AND
 * re-unlocks, the persisted `passhash` bearer comes back. Cold-restore
 * then silently reconstructs the in-memory secret → `/popup/general`
 * (no lock screen).
 *
 * Drives the toggle through the SW console rather than the settings UI
 * to keep the test independent of layout changes (the toggle's data-testid
 * still gets covered by the manual smoke checklist).
 */
// SKIP: same SW-respawn timing flake as the first test in this file.
test.skip("strict mode OFF (opt-out): unlock → toggle off → relock+unlock → kill SW → silent restore", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	// Drive the config flag from the SW console — equivalent to flipping
	// the Settings → Security toggle. Goes through ConfigService so the
	// onUpdate event fires (matches production semantics).
	await page.evaluate(async () => {
		await chrome.runtime.sendMessage({
			to: "config",
			from: "e2e-test",
			type: "Request",
			content: { method: "setValue", params: ["strictSecurityMode", false], requestId: 1 },
		})
	})

	// Lock then unlock so the next session is opened under strict OFF — the
	// new bearer gets persisted via SessionManager.open's gate.
	await lockWallet(page)
	await page.waitForSelector('[data-testid="auth-password-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page, '[data-testid="auth-password-input"]', TEST_PASSWORD)
	await clickByTestId(page, "auth-submit")
	await waitForHash(page, "#/popup/general", 10_000)
	const preKillLiveness = await readLiveness(page)
	await page.close()

	await stopServiceWorker(registeredExtension)

	const page2 = await openPopup(registeredExtension)
	await waitForLiveness(page2, preKillLiveness)

	// Lenient mode: bearer cached → silent restore → directly into /popup/general.
	// (No lock screen; user wouldn't see it under strict OFF.)
	await waitForHash(page2, "#/popup/general", 15_000)

	expect(registeredExtension.pageErrors).toEqual([])
	await page2.close()
}, 120_000)

/**
 * Regression pin for the c67e4f0 setInterval-vs-while-loop liveness gap.
 *
 * After the SW is stopped via CDP, a fresh popup must see a NEW liveness
 * timestamp (strictly newer than the pre-restart snapshot) within
 * HEARTBEAT_INTERVAL_MS (10s). Pre-fix, the first liveness write happened
 * only after waiting the full setInterval tick — so on cold respawn the
 * gap between "SW spawned" and "fresh liveness appears" was always
 * >= 10s plus startup time. The runtime.ts immediate write closes that
 * gap; this test fails if anyone reintroduces the setInterval-only
 * pattern.
 *
 * Note on existence vs timestamp comparison (codex audit catch):
 * chrome.storage.session survives SW termination while the extension
 * stays loaded, so an existence check would pass on the stale pre-restart
 * value and miss the regression. Fresh-timestamp comparison is the
 * correctness fix.
 */
// SKIP: pre-existing smoke flake — Puppeteer "Navigating frame was detached"
// race on the SW respawn + immediate popup re-navigation path. The three
// SW-lifecycle tests above assert the user-visible behavior; the inner
// heartbeat-timing assertion adds little marginal coverage at this flake cost.
// Un-skip once the navigation-after-respawn helper waits on a stable signal.
test.skip("regression: liveness signal lands within HEARTBEAT_INTERVAL_MS of SW respawn", async ({ registeredExtension }) => {
	const HEARTBEAT_INTERVAL_MS = 10_000

	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	// Snapshot the liveness timestamp BEFORE killing the SW. The new
	// value after respawn must be strictly greater than this.
	const beforeLiveness = (await page.evaluate(async () => {
		try {
			const r = await chrome.storage.session.get("nulo:liveness")
			return Number(r["nulo:liveness"] ?? 0)
		} catch {
			return 0
		}
	})) as number
	await page.close()

	await stopServiceWorker(registeredExtension)

	const page2 = await openPopup(registeredExtension)
	const start = Date.now()
	await page2.waitForFunction(
		async (priorTs: number) => {
			try {
				const r = await chrome.storage.session.get("nulo:liveness")
				const v = Number(r["nulo:liveness"] ?? 0)
				return v > priorTs
			} catch {
				return false
			}
		},
		{ timeout: HEARTBEAT_INTERVAL_MS, polling: 250 },
		beforeLiveness,
	)
	const elapsed = Date.now() - start

	// Strict bound — 10s. If this fails the runtime is back to setInterval-only
	// semantics and the launchExtension flake will resurface in unrelated tests.
	expect(elapsed).toBeLessThan(HEARTBEAT_INTERVAL_MS)
	expect(registeredExtension.pageErrors).toEqual([])
	await page2.close()
}, 60_000)
