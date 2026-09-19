import type { Browser, CDPSession, Page, Target } from "puppeteer"
import type { VirtualAuthenticator } from "./index"

/**
 * Chrome's virtual authenticator, over the CDP `WebAuthn` domain, with `hasPrf` because the wallet
 * refuses a passkey that returns no PRF output.
 *
 * An authenticator is scoped to the frame tree it was added on, not to the browser: a
 * `chrome.windows.create` popup is a fresh root and sees none of its siblings'. So the anchor page
 * gets one, and every passkey window gets its own as its target appears. A credential dies with
 * the window that made it, and PRF state does not survive CDP `getCredentials`/`addCredential` —
 * see `implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md`.
 *
 * Attaching on `targetcreated` wins the race with the ceremony: the window makes a round trip to
 * the background before it calls `navigator.credentials`.
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

export async function cdpVirtualAuthenticator(browser: Browser, anchorPage: Page): Promise<VirtualAuthenticator> {
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
			// Its own authenticator: the anchor's is invisible from here, and without one the
			// ceremony goes to the platform authenticator and times out.
			const result = await session.send("WebAuthn.addVirtualAuthenticator", { options: VIRTUAL_AUTH_OPTIONS })
			perPopupSessions.set(url, session)
			perPopupAuthIds.set(session, result.authenticatorId)
		} catch (err) {
			console.error("[passkey-fixture] failed to configure passkey-popup virtual auth:", err)
		}
	}

	browser.on("targetcreated", onTarget)

	return {
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
