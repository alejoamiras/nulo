import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { ensureUnlocked, lockWallet, stopServiceWorker } from "../fixtures/helpers"
import { openPlayground } from "../fixtures/playground"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** Strictly-newer liveness heartbeat = the REPLACEMENT worker booted (the
 *  pre-kill value survives in chrome.storage.session, so truthy checks lie). */
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

/** The toolbar badge text, read from an extension page. The badge is
 *  Chrome-level state that SURVIVES an SW kill — which is exactly how a lost
 *  in-memory queue leaves a ghost count behind. */
async function readBadgeText(page: Page): Promise<string> {
	return await page.evaluate(async () => {
		return await chrome.action.getBadgeText({})
	})
}

/**
 * F-B16 (clean-loss semantics, codex+fable-agreed deviation): a discovery
 * queued while locked does NOT survive a service-worker kill — durable replay
 * was rejected in audit (tab-origin continuity is unverifiable without a
 * `tabs` permission expansion; the SDK owns the pending map; the dApp times
 * out locally at 60s and can reissue on user/app retry). What the wallet MUST
 * do instead:
 * reconcile the toolbar badge at boot, so the surviving Chrome-level badge
 * never ghosts a count over an empty queue (before this fix the ghost was
 * permanent — even unlocking never cleared it, because the empty-queue drain
 * early-returns without touching the badge).
 */
test.skipIf(!hasConfig)(
	"connect-locked-queue-sw-restart — a killed SW drops the queue cleanly: badge reconciled at boot, no popup on unlock",
	{ timeout: 120_000 },
	async ({ registeredExtensionPerTest }) => {
		const ext = registeredExtensionPerTest

		// Lock the wallet first.
		const popupPage = await openPopup(ext)
		await waitForHash(popupPage, "#/popup/general")
		await lockWallet(popupPage)

		// Fire discovery — queued (no popup while locked), badge shows the count.
		const dappPage = await openPlayground(ext)
		await clickByTestId(dappPage, "pg-btn-connect")
		await new Promise((r) => setTimeout(r, 1_500))
		expect(ext.browser.targets().some((t) => t.url().includes("#/windows/discover"))).toBe(false)
		expect(await readBadgeText(popupPage)).toBe("1")

		// Kill the SW for real; the popup page holds the pre-kill liveness baseline.
		const baseline = await readLiveness(popupPage)
		await popupPage.close()
		await stopServiceWorker(ext)

		// Re-open the popup (wakes the replacement worker) and wait for its boot.
		const popupPage2 = await openPopup(ext)
		await waitForLiveness(popupPage2, baseline)

		// Boot reconciliation: the ghost badge is cleared BEFORE any unlock/drain.
		await popupPage2.waitForFunction(async () => (await chrome.action.getBadgeText({})) === "", { timeout: 10_000, polling: 250 })

		// Unlock — the queue was in-memory, so nothing drains: clean loss, no popup.
		await ensureUnlocked(popupPage2)
		await new Promise((r) => setTimeout(r, 3_000))
		expect(ext.browser.targets().some((t) => t.url().includes("#/windows/discover"))).toBe(false)
		expect(await readBadgeText(popupPage2)).toBe("")

		await dappPage.close()
		await popupPage2.close()
	},
)
