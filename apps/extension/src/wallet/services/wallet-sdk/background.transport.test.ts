/**
 * The content wrapper on the REAL SDK handler: the order of its checks — subframe, then schema,
 * then the dead-session reply — and what each lets through. `background.admission.test.ts` and
 * `background.init-order.pins.test.ts` mock the handler and the relay away, so neither can see
 * the wrapper; here both are real, the relay is a stub that hands back the listener it was given,
 * and the live session is established through the real key exchange, the way a page does it.
 * (The "no handler yet" forward is a property of `sessionKnownTo`, pinned in its own table test —
 * `initWalletSdkHandler` binds the handler before it attaches the listener, so the wrapper itself
 * never runs without one.)
 */
import { exportPublicKey, generateKeyPair } from "@aztec/wallet-sdk/crypto"
import { BackgroundConnectionHandler, type MessageSender } from "@aztec/wallet-sdk/extension/handlers"
import { RECEIVER_GONE_MESSAGE } from "@nulo/extension-messaging/errors"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

type Listener = (message: unknown, sender: MessageSender) => void
let attached: Listener | undefined
vi.mock("./content-message-relay", () => ({
	attachContentListener: (listener: Listener) => {
		attached = listener
	},
}))
vi.mock("./tab-lifecycle", () => ({ wireTabLifecycle: () => {} }))
vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))

import { initWalletSdkHandler } from "./background"
import { SESSION_DISCONNECTED } from "./stale-session"
import { fakeSdkPorts } from "./test-ports"
import { FAKE_DAPP_ORIGIN, fakeSdkServices } from "./test-services"

const noopLogger = { log: () => {} } as never
const TAB = 7
const OTHER_TAB = 9
const sendMessage = vi.fn<(tabId: number, message: unknown) => Promise<void>>()
const sender = (tab: number, frameId = 0): MessageSender => ({ tab: { id: tab, url: `${FAKE_DAPP_ORIGIN}/` }, frameId }) as MessageSender
const disconnect = (sessionId: string) => ({ origin: "background", type: SESSION_DISCONNECTED, sessionId })
const disconnectsSent = () => sendMessage.mock.calls.filter(([, message]) => (message as { type?: string }).type === SESSION_DISCONNECTED)
const ping = (sessionId: string) => ({ origin: "content-script", type: "ping", sessionId })
const secure = (sessionId: string) => ({ origin: "content-script", type: "secure-message", sessionId, content: { iv: "", ciphertext: "" } })
const discovery = (requestId: string) => ({
	origin: "content-script",
	type: "discovery-request",
	content: { type: "aztec-wallet-discovery", requestId, appId: "app", chainInfo: { chainId: "1", version: "1" } },
})

type Deliver = (message: unknown, from?: MessageSender) => void

function boot(init: typeof initWalletSdkHandler = initWalletSdkHandler): { handler: BackgroundConnectionHandler; deliver: Deliver } {
	attached = undefined
	const handler = init(fakeSdkServices({ remembered: { trusted: true } }).services, noopLogger, fakeSdkPorts())
	// `init` assigned it through the mock; the control-flow analysis cannot see that.
	const wrapper = attached as Listener | undefined
	if (!wrapper) throw new Error("the wrapper was not attached to the relay")
	return { handler, deliver: (message, from = sender(TAB)) => wrapper(message, from) }
}

/**
 * Establish `sessionId` for `tab` as a page does: discovery, the wallet's (remembered, trusted)
 * approval, then a real key exchange — and, like the page, nothing further until the response.
 */
async function establish(deliver: Deliver, sessionId: string, tab = TAB): Promise<void> {
	deliver(discovery(sessionId), sender(tab))
	await vi.waitFor(() =>
		expect(sendMessage).toHaveBeenCalledWith(tab, expect.objectContaining({ type: "discovery-approved", sessionId })),
	)
	const publicKey = await exportPublicKey((await generateKeyPair()).publicKey)
	deliver(
		{
			origin: "content-script",
			type: "key-exchange-request",
			sessionId,
			content: { type: "aztec-wallet-key-exchange-request", requestId: sessionId, publicKey },
		},
		sender(tab),
	)
	await vi.waitFor(() =>
		expect(sendMessage).toHaveBeenCalledWith(tab, expect.objectContaining({ type: "key-exchange-response", sessionId })),
	)
}

const flush = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve()
}

let encrypted: ReturnType<typeof vi.spyOn>

beforeEach(() => {
	sendMessage.mockReset().mockResolvedValue(undefined)
	encrypted = vi.spyOn(BackgroundConnectionHandler.prototype, "handleEncryptedMessage")
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub
	;(globalThis as any).chrome = {
		runtime: { getURL: (p: string) => p },
		tabs: { sendMessage },
		action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
	}
	// biome-ignore lint/suspicious/noExplicitAny: vite define-injected global
	;(globalThis as any).__VERSION__ = "test"
})
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe("the wrapper's order of checks", () => {
	test("a subframe's message is dropped before anything else — its dead session gets no reply", async () => {
		const { deliver } = boot()
		deliver(ping("ghost"), sender(TAB, 3))
		deliver(secure("ghost"), sender(TAB, 3))
		await flush()
		expect(sendMessage).not.toHaveBeenCalled()
		expect(encrypted).not.toHaveBeenCalled()
	})

	test("a malformed content-script envelope is dropped", async () => {
		const { deliver } = boot()
		deliver({ origin: "content-script", type: "bogus", sessionId: "ghost" })
		await flush()
		expect(sendMessage).not.toHaveBeenCalled()
	})

	test("a message that is not the content script's passes through untouched", async () => {
		const { deliver } = boot()
		deliver({ origin: "background", type: "ping", sessionId: "ghost" })
		await flush()
		expect(sendMessage).not.toHaveBeenCalled()
	})
})

describe("a session this background does not know", () => {
	test.each([
		["ping", ping],
		["secure-message", secure],
	])("a %s naming it is answered with session-disconnected in the sender's tab and not forwarded", async (_type, make) => {
		const { deliver } = boot()
		deliver(make("ghost"))
		await flush()
		expect(sendMessage).toHaveBeenCalledTimes(1)
		expect(sendMessage).toHaveBeenCalledWith(TAB, disconnect("ghost"))
		expect(encrypted).not.toHaveBeenCalled()
	})

	test("the same message again is answered again — no state, no memory of the first", async () => {
		const { deliver } = boot()
		deliver(ping("ghost"))
		deliver(ping("ghost"))
		await flush()
		expect(disconnectsSent()).toEqual([
			[TAB, disconnect("ghost")],
			[TAB, disconnect("ghost")],
		])
	})

	test("a reply the tab can no longer receive is swallowed like any other reply", async () => {
		const { deliver } = boot()
		sendMessage.mockRejectedValueOnce(new Error(RECEIVER_GONE_MESSAGE))
		deliver(ping("ghost"))
		await flush()
		expect(sendMessage).toHaveBeenCalledWith(TAB, disconnect("ghost"))
	})
})

describe("a live session, established through the real key exchange", () => {
	test("its ping is answered with pong to its tab and never disconnected", async () => {
		const { deliver } = boot()
		await establish(deliver, "s1")
		deliver(ping("s1"))
		await flush()
		expect(sendMessage).toHaveBeenCalledWith(TAB, { origin: "background", type: "pong", sessionId: "s1" })
		expect(disconnectsSent()).toEqual([])
	})

	test("its first secure message after the key-exchange response reaches the handler", async () => {
		const { deliver } = boot()
		await establish(deliver, "s1")
		deliver(secure("s1"))
		await flush()
		expect(encrypted).toHaveBeenCalledWith("s1", expect.anything())
		expect(disconnectsSent()).toEqual([])
	})

	test("its id sent from another tab is forwarded as known: the pong goes to the session's tab, no tab is disconnected", async () => {
		const { deliver } = boot()
		await establish(deliver, "s1")
		deliver(ping("s1"), sender(OTHER_TAB))
		await flush()
		expect(sendMessage).toHaveBeenCalledWith(TAB, { origin: "background", type: "pong", sessionId: "s1" })
		expect(sendMessage).not.toHaveBeenCalledWith(OTHER_TAB, expect.anything())
		expect(disconnectsSent()).toEqual([])
	})

	test("a page that picked a dead id is disconnected in its own tab only", async () => {
		const { deliver } = boot()
		await establish(deliver, "s1")
		deliver(ping("chosen-dead"), sender(OTHER_TAB))
		await flush()
		expect(disconnectsSent()).toEqual([[OTHER_TAB, disconnect("chosen-dead")]])
	})

	test("after the wallet terminated it, a tab that missed that disconnect is told again on its next ping", async () => {
		const { handler, deliver } = boot()
		await establish(deliver, "s1")
		handler.terminateSession("s1")
		await flush()
		expect(disconnectsSent()).toEqual([[TAB, disconnect("s1")]])
		deliver(ping("s1"))
		await flush()
		expect(disconnectsSent()).toEqual([
			[TAB, disconnect("s1")],
			[TAB, disconnect("s1")],
		])
	})
})

describe("with VITE_NULO_ALLOW_IFRAME_DAPPS=1", () => {
	test("a subframe's message is forwarded, and its dead session is answered in the sender's tab only", async () => {
		vi.stubEnv("VITE_NULO_ALLOW_IFRAME_DAPPS", "1")
		vi.resetModules()
		const { initWalletSdkHandler: init } = await import("./background")
		const { deliver } = boot(init)
		deliver(ping("ghost"), sender(TAB, 3))
		await flush()
		expect(sendMessage).toHaveBeenCalledTimes(1)
		expect(sendMessage).toHaveBeenCalledWith(TAB, disconnect("ghost"))
	})
})
