/**
 * Ping→pong reachability pin.
 *
 * The dApp's in-flight liveness PING is an unencrypted control message the
 * vendored `BackgroundConnectionHandler` answers with PONG — but our zod
 * boundary (`content-script-validator.ts`) used to omit "ping" from its type
 * enum, so every heartbeat died before reaching the upstream switch. These
 * pins prove the full chain on the REAL upstream handler: a validator-passed
 * ping for an active session produces a PONG on the transport; an unknown
 * session stays silently ignored (the upstream's safe default).
 *
 * The active session is seeded directly into the handler's private map —
 * establishing one for real requires the full ECDH key exchange, which is the
 * network suite's job. If upstream renames `activeSessions` or reshapes
 * `handlePing`, this reds — that is the point: it pins the vendored behavior
 * the validator change relies on.
 *
 * Two more pins guard the wallet's own use of `session-disconnected` for a session a restarted
 * background does not know (`stale-session.ts`): the wire literal is read from the installed SDK's
 * source, since its package entry does not export the enum; and the content script posts nothing
 * to the page for a disconnect whose port it does not hold — a port exists only from the discovery
 * approval on, so the reply can reach no page the user never approved.
 */

import { readFileSync } from "node:fs"
import { describe, expect, test, vi } from "vitest"
import { BackgroundConnectionHandler, ContentScriptConnectionHandler } from "@aztec/wallet-sdk/extension/handlers"
import { NOOP_LOGGER } from "@aztec/wallet-sdk/types"
import { resolvePackageAsset } from "@nulo/resolve-asset"
import { validateContentScriptMessage } from "./content-script-validator"
import { SESSION_DISCONNECTED } from "./stale-session"

import type { MessageSender } from "@aztec/wallet-sdk/extension/handlers"

type CapturedListener = (message: unknown, sender: MessageSender) => void

function makeHandler() {
	const sendToTab = vi.fn()
	let listener: CapturedListener | undefined
	const handler = new BackgroundConnectionHandler(
		{ walletId: "nulo-test", walletName: "Nulo Test", walletVersion: "0.0.0", walletIcon: "", logger: NOOP_LOGGER },
		{
			sendToTab,
			addContentListener: (l: CapturedListener) => {
				listener = l
			},
		},
	)
	handler.initialize()
	if (!listener) throw new Error("handler did not register its content listener")
	return { handler, sendToTab, listener }
}

/** Deliver an envelope the way background.ts's wrapper does: validate first,
 *  forward only when the verdict is `valid`. The sender must carry a tab id —
 *  the upstream handleMessage drops non-tab senders before its type switch. */
function deliverThroughValidator(listener: CapturedListener, envelope: unknown) {
	const verdict = validateContentScriptMessage(envelope)
	expect(verdict.kind).toBe("valid")
	listener(envelope, { tab: { id: 7, url: "https://dapp.example/" } })
}

describe("ping→pong reachability (validator + vendored handler)", () => {
	test("a validated ping for an ACTIVE session is answered with PONG to the session's tab", () => {
		const { handler, sendToTab, listener } = makeHandler()
		const priv = handler as unknown as { activeSessions: Map<string, { tabId: number }> }
		priv.activeSessions.set("sess-1", { tabId: 7 })

		deliverThroughValidator(listener, { origin: "content-script", type: "ping", sessionId: "sess-1" })

		expect(sendToTab).toHaveBeenCalledWith(7, { origin: "background", type: "pong", sessionId: "sess-1" })
	})

	test("a validated ping for an UNKNOWN session is silently ignored (no pong, no throw)", () => {
		const { sendToTab, listener } = makeHandler()
		deliverThroughValidator(listener, { origin: "content-script", type: "ping", sessionId: "ghost" })
		expect(sendToTab).not.toHaveBeenCalled()
	})
})

describe("session-disconnected — the SDK's side of the wallet's reply", () => {
	test("the wire literal is the installed SDK's own", () => {
		const source = readFileSync(
			resolvePackageAsset("@aztec/wallet-sdk", "src/extension/handlers/internal_message_types.ts", { from: import.meta.url }),
			"utf8",
		)
		expect(source).toMatch(new RegExp(`SESSION_DISCONNECTED:\\s*'${SESSION_DISCONNECTED}'`))
	})

	test("the content script posts nothing to the page for a port it does not hold, and holds one only from approval on", () => {
		let fromBackground: ((message: unknown) => void) | undefined
		const content = new ContentScriptConnectionHandler({
			sendToBackground: vi.fn(),
			addBackgroundListener: (listener) => {
				fromBackground = listener as (message: unknown) => void
			},
		})
		content.start()
		const posted = vi.spyOn(window, "postMessage").mockImplementation(() => {})
		if (!fromBackground) throw new Error("the content script registered no background listener")

		fromBackground({ origin: "background", type: SESSION_DISCONNECTED, sessionId: "ghost" })
		expect(posted).not.toHaveBeenCalled()
		expect(content.getConnectionCount()).toBe(0)

		fromBackground({
			origin: "background",
			type: "discovery-approved",
			sessionId: "s1",
			content: { id: "nulo", name: "Nulo", version: "0", icon: "" },
		})
		expect(posted).toHaveBeenCalledTimes(1)
		expect(content.getConnectionCount()).toBe(1)

		fromBackground({ origin: "background", type: SESSION_DISCONNECTED, sessionId: "s1" })
		expect(content.getConnectionCount()).toBe(0)
		posted.mockRestore()
	})
})
