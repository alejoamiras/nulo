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
import { PENDING_VERIFICATION_STALE_MS, type PendingVerificationEntry } from "./pending-verification"
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
	const stamp = vi.fn()
	const deps: SessionEstablishedDeps = {
		dappSessionService: {
			tryGetDappSessionByOriginAndChain: vi.fn().mockResolvedValue({ id: "dapp-1", profileId: "prof-A", trustedVerification: false }),
			setVerificationHash: vi.fn().mockResolvedValue(undefined),
		},
		terminateSession: terminate,
		pendingVerification: new Map<string, PendingVerificationEntry>(),
		stampSessionProfile: stamp,
		logger: noopLogger,
		...over,
	}
	return { deps, terminate, stamp }
}

/** A fresh marker for the harness session, approved under `profileId`. */
const marker = (profileId = "prof-A", over: Partial<PendingVerificationEntry> = {}): PendingVerificationEntry => ({
	at: Date.now(),
	profileId,
	tabId: 7,
	...over,
})

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
		const pendingVerification = new Map([["sess-1", marker()]])
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
		expect(pendingVerification.has("sess-1")).toBe(false)
	})

	test("(B-13 PIN) a failed verify-window open terminates the session (fail closed)", async () => {
		const { deps, terminate } = makeDeps()
		;(chrome.windows.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: undefined })
		await handleSessionEstablished(makeSession(), deps)
		// A session whose verification UI couldn't open must not stay live unverified.
		expect(terminate).toHaveBeenCalledWith("sess-1")
	})
})

describe("handleSessionEstablished — profile binding (N-04)", () => {
	beforeEach(() => {
		const c = (globalThis.chrome ?? {}) as Record<string, unknown>
		c.runtime = { ...((c.runtime as object) ?? {}), getURL: (p: string) => p }
		c.windows = { create: vi.fn().mockResolvedValue({ id: 99 }) }
		globalThis.chrome = c as never
	})

	test("a fresh matching marker stamps the session with the validated row's profile", async () => {
		const pendingVerification = new Map([["sess-1", marker("prof-A")]])
		const { deps, stamp, terminate } = makeDeps({ pendingVerification })
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(true)
		expect(stamp).toHaveBeenCalledWith("sess-1", "prof-A")
		expect(terminate).not.toHaveBeenCalled()
		expect(pendingVerification.has("sess-1")).toBe(false) // consumed
	})

	test("approve-under-A, validate-under-B fail-closes (profile skew)", async () => {
		const pendingVerification = new Map([["sess-1", marker("prof-A")]])
		const { deps, stamp, terminate } = makeDeps({
			pendingVerification,
			dappSessionService: {
				tryGetDappSessionByOriginAndChain: vi
					.fn()
					.mockResolvedValue({ id: "dapp-1", profileId: "prof-B", trustedVerification: false }),
				setVerificationHash: vi.fn().mockResolvedValue(undefined),
			},
		})
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(false)
		expect(terminate).toHaveBeenCalledWith("sess-1")
		expect(stamp).not.toHaveBeenCalled()
		expect(pendingVerification.has("sess-1")).toBe(false) // consumed either way
	})

	test("a STALE marker terminates — a parked approval is dead, never a reconnect", async () => {
		const pendingVerification = new Map([["sess-1", marker("prof-A", { at: Date.now() - PENDING_VERIFICATION_STALE_MS - 1 })]])
		const { deps, stamp, terminate } = makeDeps({ pendingVerification })
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(false)
		expect(terminate).toHaveBeenCalledWith("sess-1")
		expect(stamp).not.toHaveBeenCalled()
		expect(pendingVerification.has("sess-1")).toBe(false)
	})

	test("no marker (trusted reconnect) stamps from the validated row", async () => {
		const { deps, stamp } = makeDeps({
			dappSessionService: {
				tryGetDappSessionByOriginAndChain: vi
					.fn()
					.mockResolvedValue({ id: "dapp-1", profileId: "prof-B", trustedVerification: true }),
				setVerificationHash: vi.fn().mockResolvedValue(undefined),
			},
		})
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(true)
		expect(stamp).toHaveBeenCalledWith("sess-1", "prof-B")
	})

	test("a concurrent handshake's marker is untouched (request-keyed isolation)", async () => {
		const other = marker("prof-A")
		const pendingVerification = new Map([
			["sess-1", marker("prof-A")],
			["sess-OTHER", other],
		])
		const { deps } = makeDeps({ pendingVerification })
		await handleSessionEstablished(makeSession(), deps)
		expect(pendingVerification.get("sess-OTHER")).toBe(other) // survives intact
	})
})
