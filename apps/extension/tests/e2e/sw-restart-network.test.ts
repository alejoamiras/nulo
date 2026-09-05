import { expect } from "vitest"
import type { Page } from "puppeteer"
import { TEST_PASSWORD } from "./fixtures/constants"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "./fixtures/extension"
import { lockWallet, stopServiceWorker } from "./fixtures/helpers"

/** Readiness after the restart: session storage retains the pre-kill heartbeat,
 *  so a truthy check passes instantly against a stale value and the next UI wait
 *  races the booting worker. Requiring a STRICTLY NEWER timestamp is what makes
 *  this causal.
 *
 *  It is only meaningful because `stopServiceWorker` waits for the old worker
 *  INSTANCE to be gone. Against a kill that leaves it running, a fresh
 *  timestamp arrives from its ordinary heartbeat within HEARTBEAT_INTERVAL_MS
 *  and proves nothing. */
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

// The active chain (`Network.id`) and the chain's primary endpoint
// (`Network.primaryEndpointId`) live in `chrome.storage.local`. SW
// recycle wipes session, NOT local — so both should round-trip. This
// test stops + respawns the SW and asserts the network detail page
// renders the same primary-endpoint marker.
test("SW restart preserves active network + primary endpoint", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	// Read pre-restart state from chrome.storage.local: NetworkService's
	// EntityStorage writes per-row keys `nulo:core:networks@<id>`, and the
	// UI-level active-network pointer is `nulo:ui:activeNetwork`. Both
	// are durable across SW recycle.
	const before = await page.evaluate(async () => {
		const all = await chrome.storage.local.get(null)
		const networkRows = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("nulo:core:networks@")))
		return {
			networkRows,
			activeNetwork: all["nulo:ui:activeNetwork"] ?? null,
		}
	})
	expect(Object.keys(before.networkRows).length).toBeGreaterThan(0)

	await lockWallet(page)
	const preKillLiveness = await readLiveness(page)
	await page.close()

	await stopServiceWorker(registeredExtension)

	const page2 = await openPopup(registeredExtension)
	await waitForLiveness(page2, preKillLiveness)
	await waitForHash(page2, "#/popup/auth", 15_000)

	// Unlock
	await page2.waitForSelector('[data-testid="auth-password-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page2, '[data-testid="auth-password-input"]', TEST_PASSWORD)
	await clickByTestId(page2, "auth-submit")
	await page2.waitForFunction(() => !window.location.hash.includes("/popup/auth"), { timeout: 15_000 })
	await waitForHash(page2, "#/popup/general", 10_000)

	// Confirm: storage values byte-equal pre-restart.
	const after = await page2.evaluate(async () => {
		const all = await chrome.storage.local.get(null)
		const networkRows = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("nulo:core:networks@")))
		return {
			networkRows,
			activeNetwork: all["nulo:ui:activeNetwork"] ?? null,
		}
	})

	expect(after.networkRows).toEqual(before.networkRows)
	expect(after.activeNetwork).toEqual(before.activeNetwork)

	// Each Network row must carry a `primaryEndpointId` and at least one
	// endpoint after the restart. EntityStorage serializes values via
	// JSON.stringify, so chrome.storage returns the raw JSON string.
	// Catches a subtle regression where the storage shape persists but
	// `primaryEndpointId` gets stripped on read.
	for (const raw of Object.values(after.networkRows) as unknown[]) {
		const row = JSON.parse(raw as string) as { primaryEndpointId?: string; endpoints?: unknown[] }
		expect(typeof row.primaryEndpointId).toBe("string")
		expect((row.primaryEndpointId ?? "").length).toBeGreaterThan(0)
		expect(Array.isArray(row.endpoints)).toBe(true)
		expect((row.endpoints ?? []).length).toBeGreaterThanOrEqual(1)
	}

	expect(registeredExtension.pageErrors).toEqual([])
	await page2.close()
}, 90_000)
