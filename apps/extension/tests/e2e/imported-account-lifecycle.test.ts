/**
 * Imported-account LIFECYCLE — the smoke proof that an imported signing key survives every
 * session transition the credential-rooted DEK design changed: lock/unlock (DEK unseal at
 * unlock), a REAL service-worker kill (cold re-init + fresh unlock), a password change (the
 * dual reseal moves the DEK slot to the new credential), and finally the degradation state
 * machine when the envelope MAC is corrupted at rest.
 *
 * ONE sequential scenario, not five tests (the `transfers.test.ts` rationale): every stage
 * mutates the same profile, so independent tests would re-run against state a failed prior
 * attempt half-mutated, failing for reasons other than the original failure. The destructive
 * MAC-tamper stage runs LAST for the same reason.
 *
 * "Still usable" is asserted as: the export popup unseals the imported key and its re-exported
 * body previews to the SAME address. Preview re-derives the address from the decrypted key, so a
 * DEK that failed to unseal, or a row resealed under the wrong key, cannot pass it. On-network
 * signing with an imported key is the network suite's job (`imported-account-execution.test.ts`).
 *
 * The external account comes from a second browser's profile (the proven cross-browser pattern —
 * see `account-import-export.test.ts`): an account file from a DIFFERENT master is what makes the
 * imported row genuinely foreign, i.e. exactly the material the DEK isolates.
 */
import { expect } from "vitest"
import type { Page, Target } from "puppeteer"
import { TEST_PASSWORD } from "./fixtures/constants"
import {
	clickByTestId,
	launchExtension,
	openPopup,
	registerProfile,
	replaceInputValue,
	test,
	waitForHash,
	type ExtensionContext,
} from "./fixtures/extension"
import { changePassword, closeStuckPopup, ensureUnlocked, lockWallet, waitForToast } from "./fixtures/helpers"
import { confirmImport, exportAccountBody, exportImportedAccountBody, gotoAccounts, previewImport } from "./helpers/account-io"

const NEW_PASSWORD = "changed-password-9"

/** Duplicated verbatim from `sw-resilience.test.ts` (kept file-local there by design): a REAL
 *  MV3 worker kill is `Target.closeTarget` via `worker.close()`, and returning only once the
 *  ORIGINAL target is destroyed is what makes the post-kill assertions mean anything. */
async function stopServiceWorker(ext: ExtensionContext): Promise<void> {
	const swTarget = await ext.browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(ext.extensionId), {
		timeout: 15_000,
	})
	const destroyed = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			ext.browser.off("targetdestroyed", onDestroyed)
			reject(new Error("stopServiceWorker: the service-worker target was still alive 15s after close()"))
		}, 15_000)
		function onDestroyed(target: Target) {
			if (target !== swTarget) return
			clearTimeout(timer)
			ext.browser.off("targetdestroyed", onDestroyed)
			resolve()
		}
		ext.browser.on("targetdestroyed", onDestroyed)
	})
	const worker = await swTarget.worker()
	if (!worker) throw new Error("stopServiceWorker: service-worker target exposed no worker to close")
	await worker.close()
	await destroyed
}

/** The re-export-preview probe: export the IMPORTED (badge-carrying) row and preview the body —
 *  the previewed address must equal `expectedAddress`. Passing requires the profile DEK to unseal
 *  the row AND the decrypted key to re-derive the same address. */
async function assertImportedStillDecrypts(page: Page, expectedAddress: string, password: string): Promise<void> {
	const body = await exportImportedAccountBody(page, false, password)
	const previewed = await previewImport(page, body)
	expect(previewed).toBe(expectedAddress)
	// The probe never confirms; the import PAGE's state simply dies with the next navigation.
}

// NO retry (the `transfers.test.ts` rationale, sharpened): the scenario is DESTRUCTIVE — a retry
// re-enters against a profile whose password stage 4 already changed and whose MAC stage 5 may
// have corrupted, so every retry fails for a reason other than the original failure.
test("imported account survives lock/unlock, a REAL SW kill, and a password change; a MAC tamper degrades exactly as designed", {
	timeout: 480_000,
	retry: 0,
}, async ({ registeredExtension }) => {
	// ── Stage 0: obtain a genuinely FOREIGN account file (second browser, own master) ──
	let foreignBody: string
	{
		const donor = await launchExtension()
		try {
			await registerProfile(donor)
			const donorPage = await openPopup(donor)
			await waitForHash(donorPage, "#/popup/general", 30_000)
			foreignBody = await exportAccountBody(donorPage, "Account", false)
		} finally {
			await donor.browser.close()
		}
	}

	// ── Stage 1: import it (paste path) ──
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general", 30_000)
	const importedAddress = await previewImport(page, foreignBody)
	expect(importedAddress).toBeTruthy()
	expect(importedAddress?.startsWith("0x")).toBe(true)
	await confirmImport(page)
	await gotoAccounts(page)
	await page.waitForSelector('[data-testid="account-imported-badge"]', { visible: true, timeout: 20_000 })

	// ── Stage 2: lock → unlock → the DEK unseals again and the row decrypts ──
	await lockWallet(page)
	await ensureUnlocked(page)
	await waitForHash(page, "#/popup/general", 15_000)
	await assertImportedStillDecrypts(page, importedAddress as string, TEST_PASSWORD)

	// ── Stage 3: REAL SW kill → cold respawn → unlock → the row still decrypts ──
	// (Strict mode is the e2e default, so the cold worker lands on the lock screen; the
	// silent-restore bearer leg is integration-covered — the strict-OFF settings toggle has a
	// documented post-unlock stall, see sw-resilience's skipped test.)
	await page.close()
	await stopServiceWorker(registeredExtension)
	const page2 = await openPopup(registeredExtension)
	await ensureUnlocked(page2)
	await waitForHash(page2, "#/popup/general", 30_000)
	await assertImportedStillDecrypts(page2, importedAddress as string, TEST_PASSWORD)

	// ── Stage 4: password change → the DEK slot reseals to the NEW credential ──
	await changePassword(page2, TEST_PASSWORD, NEW_PASSWORD)
	await waitForToast(page2, "Profile password changed")
	await page2.waitForFunction(() => !window.location.hash.includes("change-password"), { timeout: 15_000 })
	// The export now authenticates with the NEW password — and still decrypts the row.
	await assertImportedStillDecrypts(page2, importedAddress as string, NEW_PASSWORD)
	// The old password no longer authenticates the export (the reseal actually moved).
	const staleBody = await (async () => {
		try {
			return await exportImportedAccountBody(page2, false, TEST_PASSWORD)
		} catch {
			return null
		}
	})()
	expect(staleBody).toBeNull()
	await page2.reload() // clear the failed export popup state
	await waitForHash(page2, "#/popup/general", 15_000)

	// ── Stage 5 (destructive, LAST): corrupt the envelope MAC at rest → degradation ──
	// The MAC field alone is flipped — dekSealed stays intact — which is precisely the case
	// the state machine must treat as untrusted: derived-only session, user-visible warning,
	// and a REFUSED password change (self-healing here would destroy recoverable keys — the
	// post-implementation round-3 decision).
	const tamperedCount = await page2.evaluate(async () => {
		const all = await chrome.storage.local.get(null)
		let count = 0
		for (const [key, raw] of Object.entries(all)) {
			if (!key.startsWith("nulo:core:profiles@") || typeof raw !== "string") continue
			const row = JSON.parse(raw)
			if (typeof row.envelopeMac !== "string") continue
			row.envelopeMac = btoa(String.fromCharCode(...new Uint8Array(32).fill(0xee)))
			await chrome.storage.local.set({ [key]: JSON.stringify(row) })
			count++
		}
		return count
	})
	expect(tamperedCount).toBe(1)

	await lockWallet(page2)
	await page2.waitForSelector('[data-testid="auth-password-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page2, '[data-testid="auth-password-input"]', NEW_PASSWORD)
	await clickByTestId(page2, "auth-submit")
	// The degradation warning is the ONLY user-visible signal before an imported account
	// fails at use time — it must fire on this unlock (subscription: popup app.vue).
	await waitForToast(page2, "Imported accounts unavailable", 30_000)
	await waitForHash(page2, "#/popup/general", 30_000)

	// Derived-account operation still works: the degraded session is derived-only, not dead.
	const derivedBody = await exportAccountBody(page2, "Account", false, NEW_PASSWORD)
	expect(derivedBody.trim().startsWith("{")).toBe(true)
	await closeStuckPopup(page2)

	// The password change REFUSES (no laundering, no destructive re-mint): the form errors
	// and the profile keeps its current password.
	await changePassword(page2, NEW_PASSWORD, "another-password-1")
	await page2.waitForFunction(() => /integrity check failed/i.test(document.body.textContent ?? ""), { timeout: 30_000, polling: 250 })
})
