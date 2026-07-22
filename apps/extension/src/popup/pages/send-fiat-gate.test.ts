/**
 * The C3 submit gate is the wall between "typed $50" and "sent something
 * else" — every branch is pinned, and every ambiguous input must land on
 * the BLOCPED side (fail-closed).
 */

import { describe, expect, test } from "vitest"
import { QUOTE_DRIFT_LIMIT, SNAPSHOT_MAX_AGE_MS, evaluateFiatGate } from "./send-fiat-gate"

const GUARD = (usd = 1, converting = false) => ({ frozenUsd: usd, frozenAt: 1, converting })

describe("send-fiat-gate", () => {
	test("token mode: gate is inert", () => {
		expect(evaluateFiatGate({ fiatMode: false, guard: null, liveUsd: null, now: 1 })).toEqual({ ok: true, requote: false })
	})

	test("fiat mode without a frozen guard → blocked, no requote offered (nothing to re-freeze from)", () => {
		expect(evaluateFiatGate({ fiatMode: true, guard: null, liveUsd: 1, now: 1 })).toEqual({
			ok: false,
			requote: false,
			reason: "no-guard",
		})
	})

	test("conversion in flight → blocked (submit waits for the derived amount)", () => {
		expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(1, true), liveUsd: 1, now: 1 })).toEqual({
			ok: false,
			requote: false,
			reason: "converting",
		})
	})

	test("no CURRENT usable quote → blocked WITH requote (stale mid-edit)", () => {
		for (const liveUsd of [null, undefined, 0, -1, Number.NaN]) {
			expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(), liveUsd, now: 1 })).toEqual({
				ok: false,
				requote: true,
				reason: "no-live-quote",
			})
		}
	})

	test("drift beyond the limit → blocked with requote; within → allowed", () => {
		// 1% limit: 1.0 → 1.011 blocks, 1.0 → 1.009 passes.
		expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(1), liveUsd: 1.011, now: 1 })).toEqual({
			ok: false,
			requote: true,
			reason: "drift",
		})
		expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(1), liveUsd: 1.009, now: 1 })).toEqual({ ok: true, requote: false })
		// Symmetric on the way down.
		expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(1), liveUsd: 0.989, now: 1 })).toEqual({
			ok: false,
			requote: true,
			reason: "drift",
		})
	})

	test("boundary pin: strictly below the limit passes, above blocks (float-exact AT-limit is fuzzy by IEEE754 — acceptable, it errs BLOCKED)", () => {
		expect(QUOTE_DRIFT_LIMIT).toBe(0.01)
		expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(1), liveUsd: 1.0099, now: 1 }).ok).toBe(true)
		expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(1), liveUsd: 1.0101, now: 1 }).ok).toBe(false)
	})

	test("corrupt frozen quote (0 / negative / NaN) → blocked as no-guard (drift math would be meaningless)", () => {
		for (const frozen of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(frozen), liveUsd: 1, now: 1 })).toEqual({
				ok: false,
				requote: false,
				reason: "no-guard",
			})
		}
	})

	test("custom drift limit is honored", () => {
		expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(1), liveUsd: 1.04, now: 1, driftLimit: 0.05 }).ok).toBe(true)
		expect(evaluateFiatGate({ fiatMode: true, guard: GUARD(1), liveUsd: 1.06, now: 1, driftLimit: 0.05 }).ok).toBe(false)
	})
})

describe("send-fiat-gate — snapshot expiry (codex post-impl H4)", () => {
	test("a frozen session older than 15 min blocks with requote, even at ZERO drift", () => {
		const frozenAt = 1_000_000
		const guard = { frozenUsd: 1, frozenAt, converting: false }
		expect(evaluateFiatGate({ fiatMode: true, guard, liveUsd: 1, now: frozenAt + SNAPSHOT_MAX_AGE_MS + 1 })).toEqual({
			ok: false,
			requote: true,
			reason: "stale-snapshot",
		})
		// Exactly AT the TTL is already expired (>= — never one tick past it).
		expect(evaluateFiatGate({ fiatMode: true, guard, liveUsd: 1, now: frozenAt + SNAPSHOT_MAX_AGE_MS })).toEqual({
			ok: false,
			requote: true,
			reason: "stale-snapshot",
		})
		// Just inside the window it still passes.
		expect(evaluateFiatGate({ fiatMode: true, guard, liveUsd: 1, now: frozenAt + SNAPSHOT_MAX_AGE_MS - 1 }).ok).toBe(true)
	})
})
