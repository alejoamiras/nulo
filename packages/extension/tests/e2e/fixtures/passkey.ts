import type { Browser, CDPSession, Page, Target } from "puppeteer"

/**
 * Wires a Chrome virtual authenticator (CDP `WebAuthn` domain) into the
 * test browser so the wallet's `navigator.credentials.create({ extensions:
 * { prf } })` call resolves without a real device. Without this the call
 * routes to the platform authenticator (Touch ID / Windows Hello / system
 * passkey UI), which is unavailable under headless puppeteer.
 *
 * The wallet hard-requires PRF output (`src/popup/windows/passkey/index.vue:61`
 * throws "Passkey PRF not available" otherwise), so the virtual authenticator
 * is configured with `hasPrf: true`. PRF support landed in Chrome 130 / CDP
 * `devtools-protocol@0.0.1581282` and is exposed in our `puppeteer-core@24.40.0`.
 *
 * Architecture
 * ------------
 * Empirically (test run 2026-05-08) virtual authenticators are scoped
 * per-FrameTreeNode, NOT per-BrowserContext — codex's reading of
 * Chromium's `webauthn_handler.cc` was correct. A `chrome.windows.create`
 * popup is a fresh FrameTreeNode root that does NOT inherit
 * authenticators from sibling pages. Each passkey-popup target therefore
 * needs its own `WebAuthn.enable` + `addVirtualAuthenticator` call.
 *
 * Consequence for tests: a credential created during register-passkey
 * lives in the register-popup's authenticator, gets garbage-collected
 * when the popup self-closes via `window.close()` in `finally`, and is
 * NOT discoverable by a subsequent unlock-passkey popup. Combined with
 * PRF state being non-portable via CDP `getCredentials`/`addCredential`,
 * this means lock+unlock and import flows are not e2e-testable today.
 * See `implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md`.
 *
 * The "anchor" session on the test page is kept around as a no-op for
 * future use (e.g., if Chromium gains BrowserContext-wide authenticator
 * scope, or if we add a test-only PRF-injection product hook).
 *
 * Race-window mitigation: the wallet popup's `onMounted` hook does
 * `passkey.connect()` + `await passkey.getPendingRequest(requestId)` (a SW
 * RPC round-trip, ~50-200ms) BEFORE calling `navigator.credentials.create`.
 * Puppeteer's `targetcreated` fires when the target is registered with the
 * browser, well before that round-trip resolves. Empirically that's enough
 * margin to attach + configure WebAuthn.
 */

const PASSKEY_URL_FRAGMENT = "/windows/passkey"

const VIRTUAL_AUTH_OPTIONS = {
	protocol: "ctap2" as const,
	ctap2Version: "ctap2_1" as const,
	transport: "internal" as const,
	hasResidentKey: true,
	hasUserVerification: true,
	hasPrf: true,
	automaticPresenceSimulation: true,
	isUserVerified: true,
}

export interface PasskeyAuthSetup {
	/** The anchor session that owns the persistent virtual authenticator. */
	readonly anchorSession: CDPSession
	/** AuthenticatorId of the long-lived authenticator on the anchor session.
	 *  May be undefined if Chromium rejects the BrowserContext-scope path. */
	readonly anchorAuthenticatorId: string | undefined
	/** Per-popup CDP sessions, keyed by target URL. Useful for inspection
	 *  / debugging; not required by tests. */
	readonly perPopupSessions: ReadonlyMap<string, CDPSession>
	/** Detach listeners and best-effort remove every authenticator we
	 *  created. Auto-called by the `passkeyAuth` fixture in `extension.ts`. */
	cleanup(): Promise<void>
}

/**
 * @param anchorPage  A long-lived page in the test browser. Pass the page
 *                    you opened with `openPopup(ctx)` BEFORE driving register
 *                    — this fixture configures WebAuthn against this target,
 *                    keeping the credential alive while subsequent passkey
 *                    popups (register / unlock) come and go.
 */
export async function setupPasskeyVirtualAuth(browser: Browser, anchorPage: Page): Promise<PasskeyAuthSetup> {
	const anchorSession = await anchorPage.createCDPSession()
	let anchorAuthenticatorId: string | undefined

	try {
		await anchorSession.send("WebAuthn.enable", { enableUI: false })
		const result = await anchorSession.send("WebAuthn.addVirtualAuthenticator", { options: VIRTUAL_AUTH_OPTIONS })
		anchorAuthenticatorId = result.authenticatorId
	} catch (err) {
		// If WebAuthn isn't enable-able on this target type, fall through —
		// per-popup setup below will still configure each passkey window.
		console.warn("[passkey-fixture] anchor authenticator setup failed (ok if per-popup path works):", err)
	}

	const perPopupSessions = new Map<string, CDPSession>()
	const perPopupAuthIds = new Map<CDPSession, string>()

	const onTarget = async (target: Target) => {
		const url = target.url()
		if (!url.includes(PASSKEY_URL_FRAGMENT)) return

		let session: CDPSession
		try {
			session = await target.createCDPSession()
		} catch {
			return
		}

		try {
			await session.send("WebAuthn.enable", { enableUI: false })
			// Each passkey popup gets its OWN authenticator. Empirically
			// (test run 2026-05-08) the anchor authenticator on a sibling
			// page is NOT visible to a chrome.windows.create-spawned popup
			// — codex's per-FrameTreeNode reading was correct. Without
			// this addVirtualAuthenticator the popup's
			// `navigator.credentials.create` routes to the platform
			// authenticator and times out.
			const result = await session.send("WebAuthn.addVirtualAuthenticator", { options: VIRTUAL_AUTH_OPTIONS })
			perPopupSessions.set(url, session)
			perPopupAuthIds.set(session, result.authenticatorId)
		} catch (err) {
			console.error("[passkey-fixture] failed to configure passkey-popup virtual auth:", err)
		}
	}

	browser.on("targetcreated", onTarget)

	return {
		anchorSession,
		anchorAuthenticatorId,
		perPopupSessions,
		async cleanup() {
			browser.off("targetcreated", onTarget)

			// Best-effort remove per-popup authenticators. Sessions detach
			// when the popup self-closes, so most of these calls will fail.
			for (const [session, id] of perPopupAuthIds.entries()) {
				try {
					await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: id })
				} catch {
					// session detached
				}
			}

			// Tear down anchor authenticator + session.
			if (anchorAuthenticatorId !== undefined) {
				try {
					await anchorSession.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: anchorAuthenticatorId })
				} catch {
					// already detached
				}
			}
			try {
				await anchorSession.detach()
			} catch {
				// already detached
			}
		},
	}
}
