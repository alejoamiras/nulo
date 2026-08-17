/**
 * Prove-first pins for the security-critical session-established path (arc 4).
 *
 * B-06: the verify window must show THIS session's own verification emojis — the
 * hash is passed per-session via the window URL, not read from the shared row.
 * B-13: the callback is fail-closed — any failure terminates the session, and the
 * pending-verification marker is always cleared (incl. the missing-row early return).
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { ILogger } from "@/wallet/logger"
import { type SessionEstablishedDeps, handleSessionEstablished } from "./session-established"

const noopLogger = { log: () => {} } as unknown as ILogger

const makeSession = (over: Record<string, unknown> = {}) => ({
	origin: "https://dapp.example",
	sessionId: "sess-1",
	verificationHash: "DEADBEEF",
	// chainInfoToChainId = (1 ^ 1) >>> 0 = 0 → key "https://dapp.example|0"
	chainInfo: { chainId: "1", version: "1" },
	...over,
})

function makeDeps(over: Partial<SessionEstablishedDeps> = {}) {
	const terminate = vi.fn()
	const deps: SessionEstablishedDeps = {
		dappSessionService: {
			tryGetDappSessionByOriginAndChain: vi.fn().mockResolvedValue({ id: "dapp-1", trustedVerification: false }),
			setVerificationHash: vi.fn().mockResolvedValue(undefined),
		},
		terminateSession: terminate,
		pendingVerification: new Set<string>(),
		logger: noopLogger,
		...over,
	}
	return { deps, terminate }
}

describe("handleSessionEstablished — B-06 / B-13 pins", () => {
	beforeEach(() => {
		const c = (globalThis.chrome ?? {}) as Record<string, unknown>
		c.runtime = { ...((c.runtime as object) ?? {}), getURL: (p: string) => p }
		c.windows = { create: vi.fn().mockResolvedValue({ id: 99 }) }
		globalThis.chrome = c as never
	})

	test("(B-06 PIN) opens the verify window with THIS session's own verification hash", async () => {
		const { deps } = makeDeps()
		await handleSessionEstablished(makeSession({ verificationHash: "CAFEBABE" }), deps)
		const createSpy = chrome.windows.create as unknown as ReturnType<typeof vi.fn>
		expect(createSpy).toHaveBeenCalledTimes(1)
		const url = createSpy.mock.calls[0][0].url as string
		// The trust-decision emojis derive from the URL's hash, immune to the shared
		// row being overwritten by a concurrent same-tuple session.
		expect(url).toContain("verificationHash=CAFEBABE")
	})

	test("(B-13 PIN) a missing DappSession terminates the session AND clears pendingVerification", async () => {
		const pendingVerification = new Set<string>(["https://dapp.example|0"])
		const { deps, terminate } = makeDeps({
			pendingVerification,
			dappSessionService: {
				tryGetDappSessionByOriginAndChain: vi.fn().mockResolvedValue(undefined),
				setVerificationHash: vi.fn(),
			},
		})
		await handleSessionEstablished(makeSession(), deps)
		expect(terminate).toHaveBeenCalledWith("sess-1")
		// The early return no longer leaks the pending marker for the SW's lifetime.
		expect(pendingVerification.has("https://dapp.example|0")).toBe(false)
	})

	test("(B-13 PIN) a failed verify-window open terminates the session (fail closed)", async () => {
		const { deps, terminate } = makeDeps()
		;(chrome.windows.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: undefined })
		await handleSessionEstablished(makeSession(), deps)
		// A session whose verification UI couldn't open must not stay live unverified.
		expect(terminate).toHaveBeenCalledWith("sess-1")
	})
})
