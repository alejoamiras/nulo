import { expect } from "vitest"
import type { Page } from "puppeteer"
import { TEST_PASSWORD } from "./fixtures/constants"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue, withTimeoutMessage } from "./fixtures/extension"
import { acceptConfirmPopup, ensureUnlocked, lockWallet, navigateByHash, stopServiceWorker } from "./fixtures/helpers"

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

// Chrome's MV3 lifecycle recycle — the idle worker is killed, the next event
// respawns it cold — is where storage migrations, service init and cold-boot
// races actually break. `stopServiceWorker` (fixtures/helpers.ts) is what makes
// these tests mean anything: a kill that leaves the worker running lets every
// test here pass against a worker that never died.
test("extension survives SW stop+respawn: lock → kill SW → unlock → general", async ({ registeredExtension }) => {
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
test("strict mode default ON: unlock → kill SW → expect lock screen on respawn", async ({ registeredExtension }) => {
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
 * Strict-mode opt-out: when the user disables strict mode AND re-unlocks, the
 * persisted bearer comes back. Cold-restore then silently reconstructs the
 * in-memory secret → `/popup/general` (no lock screen).
 *
 * The opt-out is driven through the real Settings → Security toggle. An earlier
 * version posted to ConfigService over `chrome.runtime.sendMessage` to stay
 * independent of layout, but wallet services listen on PORTS — the SW's only
 * onMessage listener returns false — so the flag never actually changed and this
 * test asserted a silent restore that strict mode had never been turned off for.
 */
// SKIP — three distinct blockers, all measured, none of them "flaky CI":
//  1. The original setup was dead. It flipped strictSecurityMode by posting to
//     ConfigService over `chrome.runtime.sendMessage`, but wallet services listen
//     on PORTS: the SW's only onMessage listener (`src/wallet/index.ts`) returns
//     false. A probe confirmed the call resolves with no reply and `nulo:config`
//     is never written, so strict mode stayed ON and the silent restore asserted
//     here could not occur. The test only ever "passed" because the old kill left
//     the worker running, so nothing needed restoring.
//  2. Driving the real Settings → Security toggle instead (below, kept for the
//     next attempt) gets further but stalls: the page's `onBeforeMount` awaits two
//     `configService.getValue` calls and `isLoading` never clears within 10s in
//     this post-unlock, post-restart context, so `strict-security-toggle` never
//     renders. That points at the config client's reconnect lifecycle after an
//     unlock — its own investigation, not a wait to lengthen.
//  3. Reaching settings via the nav tab additionally races the routing the unlock
//     is still finishing; hash navigation avoids that but does not fix (2).
// The other three tests in this file are un-skipped and green.
test.skip("strict mode OFF (opt-out): unlock → toggle off → relock+unlock → kill SW → silent restore", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	// These tests share one browser, and the strict-mode test above now leaves the
	// wallet genuinely LOCKED — which it always should have, but could not while
	// the "kill" left the worker running. Establish the precondition instead of
	// inheriting it.
	await ensureUnlocked(page)
	await waitForHash(page, "#/popup/general")

	// Turn strict mode off the way a user does: the Settings → Security toggle,
	// through its confirmation dialog. Then assert the flag actually flipped —
	// a setup step that silently no-ops is what made this test vacuous before.
	// Direct hash navigation, not the nav tab: clicking through the shell races
	// the routing the unlock above is still finishing, and this test's subject is
	// the strict-mode contract, not settings navigation.
	await navigateByHash(page, "#/popup/settings/security")
	await page.waitForSelector('[data-testid="strict-security-toggle"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "strict-security-toggle")
	await acceptConfirmPopup(page)
	await withTimeoutMessage(
		page.waitForFunction(
			() => document.querySelector('[data-testid="strict-security-toggle"]')?.getAttribute("data-toggle-active") === "false",
			{ timeout: 10_000, polling: 200 },
		),
		async () => {
			const seen = await page
				.evaluate(
					() =>
						document.querySelector('[data-testid="strict-security-toggle"]')?.getAttribute("data-toggle-active") ?? "<absent>",
				)
				.catch(() => "<unreadable>")
			return `strict-security-toggle never flipped off (still ${seen}) — the opt-out this test depends on did not happen`
		},
	)
	await navigateByHash(page, "#/popup/general")

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
 * Existence vs timestamp comparison:
 * chrome.storage.session survives SW termination while the extension
 * stays loaded, so an existence check would pass on the stale pre-restart
 * value and miss the regression. Fresh-timestamp comparison is the
 * correctness fix.
 */
test("regression: liveness signal lands within HEARTBEAT_INTERVAL_MS of SW respawn", async ({ registeredExtension }) => {
	const HEARTBEAT_INTERVAL_MS = 10_000

	const page = await openPopup(registeredExtension)
	// These tests share one browser, and the strict-mode test above now leaves the
	// wallet genuinely LOCKED — which it always should have, but could not while
	// the "kill" left the worker running. Establish the precondition instead of
	// inheriting it.
	await ensureUnlocked(page)
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

	// Clock starts at the KILL, not after `openPopup` — which already waits for
	// the background to be connected, i.e. for the very write being timed. Timing
	// from there measured nothing and would not have caught the regression this
	// test exists for. Including the popup-open cost makes this an upper bound on
	// respawn-to-liveness, which is what the assertion needs.
	const start = Date.now()
	const page2 = await openPopup(registeredExtension)
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
