/**
 * N-21 budget pins: the PATH-B window ceiling must cover the two-leg WebAuthn
 * worst case (PRF-on-get authenticators re-run a full `get` leg after
 * `create`), i.e. 2 × PASSKEY_TIMEOUT + slack. The path is latent (no
 * production caller), so the pins target the budget CONTRACT: the derivation
 * relationship AND the value the consumer actually hands the WindowManager —
 * either a constant regression or a hard-coded `timeoutMs` at the call site
 * reds.
 */
import { describe, expect, test, vi } from "vitest"
import type { ILogger } from "@/wallet/logger"
import type { WindowManager } from "@/wallet/services/window-manager/window-manager"
import { PasskeyService, PASSKEY_TIMEOUT } from "./service"

const noopLogger = { log: () => {} } as unknown as ILogger

describe("PasskeyService PATH-B window budget (N-21)", () => {
	test("openAndAwait receives a budget covering the two-leg ceremony worst case", async () => {
		const openAndAwait = vi.fn(() => ({
			id: "h1",
			promise: Promise.resolve({ kind: "credential" }),
		}))
		const windowManager = { openAndAwait } as unknown as WindowManager
		const service = new PasskeyService(noopLogger, windowManager)
		vi.spyOn(chrome.runtime, "getURL").mockReturnValue("chrome-extension://x/passkey.html")

		await service.createKey("uh-1", "Profile")

		expect(openAndAwait).toHaveBeenCalledTimes(1)
		const opts = (openAndAwait.mock.calls[0] as unknown[])[0] as { timeoutMs: number }
		expect(opts.timeoutMs).toBe(2 * PASSKEY_TIMEOUT + 60_000)
	})

	// (No separate constant-relationship pin: an earlier draft asserted
	// `2*T + slack > 2*T`, a tautology. The consumer pin above is the real
	// discriminator — it observes the value the WindowManager actually
	// receives, so a hard-coded regression at the call site reds too.)
})
