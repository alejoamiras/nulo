import type { Page } from "puppeteer"
import { RESTORE_GATE_KEY } from "@/e2e/chrome-storage-restore-gate"
import type { RestoreGateHoldPoint } from "@/e2e/restore-gate"
import { withTimeoutMessage } from "./extension"

/**
 * Drive the restore gate from an e2e test.
 *
 * Only meaningful against a PROVERLESS build (`NULO_E2E_PROVERLESS=1`), where
 * `wallet/runtime.ts` injects `ChromeStorageRestoreGate` into the contact and
 * account-state services. The key literal is imported from the source so the
 * two halves of the contract can never drift.
 *
 * Protocol: ARM with a hold point, drive the import, then wait for the
 * SW-side handler to ACKNOWLEDGE (`held: true`) — only then is a restore RPC
 * genuinely parked at the named phase and a kill meaningful. Armed alone
 * proves nothing ("armed ≠ reached"). ALWAYS `clearRestoreGate` in the
 * test's `finally`: the gate's safety timer runs inside the worker the test
 * kills, so it cannot clean up after itself.
 */
export async function armRestoreGate(extensionPage: Page, at: RestoreGateHoldPoint): Promise<void> {
	await extensionPage.evaluate((key, holdAt) => chrome.storage.session.set({ [key]: { at: holdAt } }), RESTORE_GATE_KEY, at)
}

/** Resolve once the SW handler acknowledged entry (`held: true`). */
export async function waitForRestoreGateHeld(extensionPage: Page, at: RestoreGateHoldPoint, timeoutMs: number): Promise<void> {
	await withTimeoutMessage(
		extensionPage.waitForFunction(
			async (key: string, holdAt: string) => {
				const rec = (await chrome.storage.session.get(key))[key] as { at?: string; held?: boolean } | undefined
				return rec?.at === holdAt && rec?.held === true
			},
			{ timeout: timeoutMs, polling: 100 },
			RESTORE_GATE_KEY,
			at,
		),
		async () => {
			const rec = await extensionPage
				.evaluate(async (key) => JSON.stringify((await chrome.storage.session.get(key))[key] ?? null), RESTORE_GATE_KEY)
				.catch(() => "<unreadable>")
			return (
				`restore gate never acknowledged at "${at}" within ${timeoutMs}ms (record: ${rec}). ` +
				"Armed is not reached — the import either failed before this phase or the build is not proverless-armed."
			)
		},
	)
}

/** Remove the key. Call from the test's `finally` — releases a surviving
 *  worker's hold and, after a kill, clears the stale record for the next run. */
export async function clearRestoreGate(extensionPage: Page): Promise<void> {
	await extensionPage.evaluate((key) => chrome.storage.session.remove(key), RESTORE_GATE_KEY).catch(() => {})
}
