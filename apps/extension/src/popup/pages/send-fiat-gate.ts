/**
 * C3 fiat-mode submit gate — pure and FAIL-CLOSED. Extracted from `send.vue`
 * (which owns `handleSend`) so the policy that stops "typed $50, sent 2×
 * that" is unit-testable in isolation, like its sibling `send-amount.ts`.
 *
 * Policy (plan §C3 quote-consistency):
 * - outside fiat mode the gate is inert (`ok`);
 * - no frozen session guard, a conversion still in flight, or NO currently
 *   usable quote → blocked (fail closed);
 * - live quote drifting > `QUOTE_DRIFT_LIMIT` from the frozen session quote →
 *   blocked pending explicit re-confirmation (requote).
 */

export const QUOTE_DRIFT_LIMIT = 0.01

/** A frozen session older than this must re-confirm regardless of drift —
 *  mirrors the price feed's own 15-min usable-quote TTL. */
export const SNAPSHOT_MAX_AGE_MS = 15 * 60_000

export type FiatGuard = { frozenUsd: number; frozenAt: number; converting: boolean }

export type FiatGateVerdict =
	| { ok: true; requote: false }
	| { ok: false; requote: boolean; reason: "no-guard" | "converting" | "no-live-quote" | "drift" | "stale-snapshot" }

export function evaluateFiatGate(input: {
	fiatMode: boolean
	guard: FiatGuard | null | undefined
	liveUsd: number | null | undefined
	/** Current wall-clock ms — pass a TICKER-backed value so expiry flips reactively. */
	now: number
	driftLimit?: number
	maxSnapshotAgeMs?: number
}): FiatGateVerdict {
	const { fiatMode, guard, liveUsd, now } = input
	const limit = input.driftLimit ?? QUOTE_DRIFT_LIMIT
	const maxAge = input.maxSnapshotAgeMs ?? SNAPSHOT_MAX_AGE_MS

	if (!fiatMode) return { ok: true, requote: false }
	if (!guard) return { ok: false, requote: false, reason: "no-guard" }
	if (guard.converting) return { ok: false, requote: false, reason: "converting" }
	// An hours-old frozen session can stay within 1% cumulative drift while
	// being far from anything the user actually confirmed — hard expiry.
	if (now - guard.frozenAt >= maxAge) return { ok: false, requote: true, reason: "stale-snapshot" }
	// Guard against a frozen quote that could never have been valid — a zero
	// or non-finite denominator would make the drift check meaningless.
	if (!Number.isFinite(guard.frozenUsd) || guard.frozenUsd <= 0) return { ok: false, requote: false, reason: "no-guard" }
	if (liveUsd === null || liveUsd === undefined || !Number.isFinite(liveUsd) || liveUsd <= 0) {
		return { ok: false, requote: true, reason: "no-live-quote" }
	}
	if (Math.abs(liveUsd - guard.frozenUsd) / guard.frozenUsd > limit) {
		return { ok: false, requote: true, reason: "drift" }
	}
	return { ok: true, requote: false }
}
