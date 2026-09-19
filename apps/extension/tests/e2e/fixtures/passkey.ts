import type { Browser, Page } from "puppeteer"
import { type VirtualAuthenticator, holdNextCredentialGet, virtualAuthenticator } from "./browser"
import { clickByTestId, replaceInputValue, waitForHash } from "./extension"

/** Drive the passkey-register flow on a fresh extension at /popup/register.
 *  Preconditions: `setupPasskeyVirtualAuth` has been called against the popup
 *  target (otherwise navigator.credentials.create routes to the platform
 *  authenticator and times out under headless). The ceremony runs in-page
 *  (path A) on the SAME FrameTreeNode, so the created credential lives on the
 *  popup page's virtual authenticator — keep that page open for any later
 *  ceremony (lock/unlock, SW-restart recovery, re-import). */
export async function registerPasskeyProfile(page: Page): Promise<void> {
	await waitForHash(page, "#/popup/register", 15_000)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
		timeout: 15_000,
		polling: 500,
	})

	await clickByTestId(page, "register-create-btn")

	// Wait for the create page to mount before typing the name.
	await page.waitForSelector('[data-testid="register-name-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page, '[data-testid="register-name-input"]', "Test Profile")

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

export type PasskeyAuthSetup = VirtualAuthenticator

/**
 * A PRF-capable virtual authenticator, so `navigator.credentials` resolves without a device.
 *
 * @param anchorPage  A long-lived page in the test browser. Pass the page
 *                    you opened with `openPopup(ctx)` BEFORE driving register
 *                    — Chrome scopes an authenticator to the page it was added
 *                    on, so this one keeps the credential alive while passkey
 *                    popups (register / unlock) come and go.
 */
export const setupPasskeyVirtualAuth = (browser: Browser, anchorPage: Page): Promise<PasskeyAuthSetup> =>
	virtualAuthenticator(browser, anchorPage)

/** Leave the next ceremony on `page` pending, so a test can cancel it. */
export async function stallNextPasskeyCeremony(page: Page, auth: PasskeyAuthSetup): Promise<void> {
	await auth.cleanup()
	await holdNextCredentialGet(page)
}
