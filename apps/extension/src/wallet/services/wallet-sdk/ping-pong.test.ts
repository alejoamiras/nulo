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
 */

import { describe, expect, test, vi } from "vitest"
import { BackgroundConnectionHandler } from "@aztec/wallet-sdk/extension/handlers"
import { NOOP_LOGGER } from "@aztec/wallet-sdk/types"
import { validateContentScriptMessage } from "./content-script-validator"

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
