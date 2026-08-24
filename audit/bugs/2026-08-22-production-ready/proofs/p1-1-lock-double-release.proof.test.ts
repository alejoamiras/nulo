/**
 * BUG PROOF — P1-1: `Lock` force-release watchdog theft (double-release).
 *
 * When a holder wedges past MAX_HOLD_MS, the watchdog force-releases and the
 * lock grants the next waiter. The ORIGINAL holder's eventual `leave()` has no
 * ownership check: it releases the NEW holder's hold and clears their
 * watchdog, admitting a third party while waiter #2 still believes it holds
 * the lock. Mutual exclusion is violated; ~14 production locks ship this.
 *
 * Pinned as known-and-deferred in packages/wallet-core/src/utils/lock.test.ts
 * ("deliberately NOT fixed in this arc") — this proof pins the CORRECT
 * behavior so the fix arc inherits a RED test for free. Concrete harm is not
 * hypothetical: see C4-2 (incoming-transfer note CS resurrection after a 5-min
 * PXE stall rides exactly this theft).
 *
 * RED today: the third acquire succeeds while W2 holds. GREEN after fix:
 * H1's late leave() is a no-op; W2 remains the exclusive owner until released.
 */
import { Lock } from "@nulo/wallet-core/utils"
import { describe, expect, test } from "vitest"

describe("P1-1: a wedged holder's late leave() must not release the new owner's lock", () => {
	test("force-release hands off cleanly and late leave is a no-op", async () => {
		const lock = new Lock("proof-lock", undefined, 25)
		let releaseH1: () => void = () => {}
		const h1Gate = new Promise<void>((resolve) => {
			releaseH1 = resolve
		})

		// H1 acquires and wedges past the watchdog (NOT awaited inline — its
		// promise settles only when we release the gate below).
		const h1 = lock.withLock(async () => {
			await h1Gate // stalled work; exceeds maxHoldMs
		})
		await new Promise((r) => setTimeout(r, 5))

		// W2 must be QUEUED *before* the watchdog fires (t≈25ms) so the
		// force-release grants it while H1 still believes it holds the lock.
		let w2Done = false
		const w2 = lock.withLock(async () => {
			w2Done = true
			await new Promise((r) => setTimeout(r, 30))
		})

		// Wait past the watchdog: it force-releases H1's hold and hands the lock
		// to W2 (which arms its own watchdog T2).
		await new Promise((r) => setTimeout(r, 40))
		expect(w2Done).toBe(true)

		// H1 finally settles → its withLock finally calls leave().
		releaseH1!()
		await h1
		await new Promise((r) => setTimeout(r, 10))

		// …a THIRD caller must be BLOCKED while W2 owns the lock.
		let w3Entered = false
		const w3 = lock.withLock(async () => {
			w3Entered = true
		})
		await new Promise((r) => setTimeout(r, 5))

		expect(w3Entered).toBe(false)

		await Promise.all([w2, w3])
		expect(w2Done).toBe(true)
	})
})
