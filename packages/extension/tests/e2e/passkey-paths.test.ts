/**
 * Non-network e2e coverage for the passkey-profile path.
 *
 * Coverage in this file (in-page modal path A — same FrameTreeNode):
 *   1. Register a passkey profile via the in-page modal (path A).
 *      Asserts the popup lands on /popup/general with a valid 0x... address.
 *   2. Lock + unlock-via-passkey within the same extension session.
 *      Unblocked by path A: the modal runs in the popup's existing
 *      FrameTreeNode, so the credential created at register persists
 *      across the lock/unlock cycle on the SAME virtual authenticator.
 *   3. Register → reset profile → import via passkey discovery → same
 *      address. The "I wiped my profile and want it back" flow. Same
 *      popup, same FTN, same authenticator = same PRF = same master.
 *
 * NOT covered (still blocked, see implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md):
 *   - Passkey IMPORT in a FRESH extension instance. PRF state is per-
 *     credential authenticator-internal and not serializable via CDP.
 *     The reset-then-import test (3 above) is the closest in-FTN proxy.
 *   - Cross-browser passkey-only round-trip.
 */
import { expect } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, openPopup, waitForHash, test } from "./fixtures/extension"
import { setupPasskeyVirtualAuth } from "./fixtures/passkey"

/** Read the active account address from chrome.storage.local. The wallet
 *  writes this key after the post-register account derivation settles. */
async function readActiveAccount(page: Page): Promise<string> {
	return await page.evaluate(async () => {
		const r = await chrome.storage.local.get("nulo:ui:activeAccount")
		return r["nulo:ui:activeAccount"] as string
	})
}

/** Drive the passkey-register flow on a fresh extension at /popup/register.
 *  Preconditions: `setupPasskeyVirtualAuth` has been called against the
 *  popup target (otherwise navigator.credentials.create routes to the
 *  platform authenticator and times out under headless). */
async function registerPasskeyProfile(page: Page): Promise<void> {
	await waitForHash(page, "#/popup/register", 15_000)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
		timeout: 15_000,
		polling: 500,
	})

	await clickByTestId(page, "register-create-btn")

	// Switch the method-tabs from password (default) → passkey.
	await page.waitForSelector('[data-testid="register-method-passkey"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "register-method-passkey")

	await page.waitForSelector('[data-testid="register-submit-btn"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "register-submit-btn")

	// The in-page modal opens, runs WebAuthn against the virtual
	// authenticator (resolves in ms), self-dismisses on success. Assert on
	// the page hash transitioning to /popup/general.
	await waitForHash(page, "#/popup/general", 60_000)
}

test("create passkey profile: register flow lands on /popup/general", async ({ freshExtensionPerTest }) => {
	const page = await openPopup(freshExtensionPerTest)
	const auth = await setupPasskeyVirtualAuth(freshExtensionPerTest.browser, page)

	try {
		await registerPasskeyProfile(page)

		const address = await readActiveAccount(page)
		expect(typeof address).toBe("string")
		expect(address.startsWith("0x")).toBe(true)
		expect(address.length).toBeGreaterThan(2)

		expect(freshExtensionPerTest.pageErrors).toEqual([])
	} finally {
		await auth.cleanup()
		await page.close()
	}
}, 60_000)

test("lock + unlock via passkey: header-lock → auth-submit returns to /popup/general", async ({ freshExtensionPerTest }) => {
	const page = await openPopup(freshExtensionPerTest)
	const auth = await setupPasskeyVirtualAuth(freshExtensionPerTest.browser, page)

	try {
		await registerPasskeyProfile(page)
		const addressBefore = await readActiveAccount(page)
		expect(addressBefore.startsWith("0x")).toBe(true)

		// Lock via the header. Sets `appStore.isLogined = false` and calls
		// `managers.profile.lockActiveProfile()`; a watcher in app.vue
		// pushes the router to /popup/auth.
		await clickByTestId(page, "header-lock")
		await waitForHash(page, "#/popup/auth", 10_000)

		// Auth page detects passkey-profile, hides password input, exposes
		// just `auth-submit`. Click triggers in-page passkey ceremony in the
		// SAME popup (and SAME FrameTreeNode) — finds the credential created
		// during register on the same virtual authenticator instance.
		// Wait for auth-submit to be present AND ENABLED. After lock, the SW
		// emits onActiveProfileChanged(undefined) which clears appStore.profile.
		// auth.vue's onMounted refetches it asynchronously; while in flight,
		// isAllowedToContinue is false and the submit button is disabled.
		// Clicking a disabled button is a no-op (puppeteer happily clicks
		// disabled elements; nothing fires).
		await page.waitForSelector('[data-testid="auth-submit"]', { visible: true, timeout: 5_000 })
		await page.waitForFunction(
			() => {
				const btn = document.querySelector<HTMLButtonElement>('[data-testid="auth-submit"]')
				return btn !== null && !btn.disabled
			},
			{ timeout: 10_000 },
		)
		await clickByTestId(page, "auth-submit")
		await waitForHash(page, "#/popup/general", 60_000)

		const addressAfter = await readActiveAccount(page)
		expect(addressAfter).toBe(addressBefore)

		// Filter the benign "Client disconnected" cascade — lock closes the
		// SW session, in-flight ServiceClients reject with this on cleanup.
		// Same pattern as `security.test.ts:isBenignPasswordChangeError`.
		const nonBenignErrors = freshExtensionPerTest.pageErrors.filter((e) => !e.message.includes("Client disconnected"))
		expect(nonBenignErrors).toEqual([])
	} finally {
		await auth.cleanup()
		await page.close()
	}
}, 90_000)

test("register → reset profile → import via passkey discovery → same address", async ({ freshExtensionPerTest }) => {
	const page = await openPopup(freshExtensionPerTest)
	const auth = await setupPasskeyVirtualAuth(freshExtensionPerTest.browser, page)

	try {
		// Step 1: register passkey.
		await registerPasskeyProfile(page)
		const addressBefore = await readActiveAccount(page)
		expect(addressBefore.startsWith("0x")).toBe(true)

		// Step 2: reset profile via /popup/settings/security/reset.
		// All three confirm checkboxes + the profile-name confirm input
		// must be ticked/typed for `reset-submit-btn` to enable. Default
		// passkey-profile name is "Profile 1" (`profile/new.vue:67`:
		// `name = \`Profile ${profiles.length + 1}\``).
		await page.evaluate(() => {
			window.location.hash = "#/popup/settings/security/reset"
		})
		await waitForHash(page, "#/popup/settings/security/reset", 5_000)

		await page.waitForSelector('[data-testid="reset-checkbox-permanent"]', { visible: true, timeout: 5_000 })
		await clickByTestId(page, "reset-checkbox-permanent")
		await clickByTestId(page, "reset-checkbox-undone")
		await clickByTestId(page, "reset-checkbox-sure")

		await page.evaluate(() => {
			const input = document.querySelector<HTMLInputElement>('[data-testid="reset-confirm-input"] input')
			if (!input) throw new Error("reset-confirm-input not found")
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
			setter?.call(input, "Profile 1")
			input.dispatchEvent(new Event("input", { bubbles: true }))
		})

		await page.waitForFunction(
			() => {
				const btn = document.querySelector<HTMLButtonElement>('[data-testid="reset-submit-btn"]')
				return btn !== null && !btn.disabled
			},
			{ timeout: 5_000 },
		)
		await clickByTestId(page, "reset-submit-btn")
		// reset.vue routes to /popup/register when no profiles remain.
		await waitForHash(page, "#/popup/register", 10_000)

		// Step 3: navigate to /popup/import and trigger import-passkey.
		// The credential created at register lives in the popup's anchor
		// authenticator (created by setupPasskeyVirtualAuth) — that
		// authenticator persists across the SPA navigation, so WebAuthn
		// `get` (no allowedCredentials = discovery) finds it. PRF output
		// is identical (same authenticator instance, same credential =
		// same internal HMAC seed), so the derived master is identical
		// → the imported profile's account address must match.
		await page.evaluate(() => {
			window.location.hash = "#/popup/import"
		})
		await waitForHash(page, "#/popup/import", 5_000)
		await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
			timeout: 15_000,
			polling: 500,
		})

		await page.waitForSelector('[data-testid="import-option-passkey"]', { visible: true, timeout: 10_000 })
		await clickByTestId(page, "import-option-passkey")

		await waitForHash(page, "#/popup/general", 60_000)

		const addressAfter = await readActiveAccount(page)
		expect(addressAfter).toBe(addressBefore)

		// Same benign-error filter as lock+unlock — reset closes the SW
		// session, in-flight ServiceClients reject with "Client disconnected".
		const nonBenignErrors = freshExtensionPerTest.pageErrors.filter((e) => !e.message.includes("Client disconnected"))
		expect(nonBenignErrors).toEqual([])
	} finally {
		await auth.cleanup()
		await page.close()
	}
}, 90_000)

// NOTE: cross-browser passkey-only round-trip is STILL blocked even after
// the in-page modal refactor. A different `puppeteer.launch()` = a different
// browser context = a different popup target = a different authenticator
// = no shared credential. The reset-then-import test above is the closest
// in-the-same-FTN proxy: same authenticator instance, same PRF, same master.
// See `implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md` for the full
// blocker analysis.
