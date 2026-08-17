/**
 * Prove-first pin for B-15: the request deadline must cover connection
 * establishment. A wedged transport whose `ensureTransportReady()` never resolves
 * (e.g. `connect()` retrying "Extension context invalidated" forever) previously
 * hung the request FOREVER, because the timeout timer only installed after
 * readiness resolved. Now the deadline is set before awaiting readiness, so the
 * request rejects within its configured timeout regardless.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { silentLogger } from "../testing/transport-harness"
import { BaseServiceClient } from "./base-client"

type Methods = { ping: () => Promise<string> }

class NeverReadyClient extends BaseServiceClient<Methods> {
	constructor() {
		super("test", silentLogger, "test-client", { defaultTimeoutMs: 500 })
	}
	protected ensureTransportReady(): Promise<void> {
		// A wedged transport: readiness never completes.
		return new Promise<void>(() => {})
	}
	protected sendEnvelope(): void {}
	protected timeoutMessage(): string {
		return "request timed out"
	}
	protected sendFailureMessage(): string {
		return "send failed"
	}
	public callPing(): Promise<string> {
		return this.request("ping")
	}
}

describe("BaseServiceClient — readiness deadline (B-15)", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	test("(B-15 PIN) a wedged transport readiness rejects the request within its timeout", async () => {
		vi.useFakeTimers()
		const client = new NeverReadyClient()
		const rejected = client.callPing().then(
			() => "resolved",
			() => "rejected",
		)
		// Advance PAST the 500ms deadline. Pre-fix the request awaited readiness with
		// no timer, so it never settled; now the deadline fires and rejects it.
		await vi.advanceTimersByTimeAsync(600)
		expect(await rejected).toBe("rejected")
	})
})
