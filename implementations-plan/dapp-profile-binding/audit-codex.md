# Codex audits — dapp-profile-binding

Session `01a03591-f807-7da0-b4d6-82cbaafc1cd8`, xhigh, read-only, cwd = this worktree. Dispositions in plan.md's ledger.

## Round 1 — on revision 1

Verdict: **reject** (blocking: the guard remains TOCTOU-vulnerable; the stamp source is not reliably the approving row; N-26 still misclassifies immediate reconnects for 90 s).

- Hybrid genuinely necessary (teardown = disconnect signal; stamping = identity isolation; either alone incomplete). Stamp-based teardown correct; tuple-based under-fixes.
- TOCTOU: `requireActiveProfile` + adjacent guard are interleaving-safe (profile listeners fire synchronously), but once `dispatcher.dispatch` reaches its first await a switch can land and the lookup independently reads live profile B (`service.ts:114`) — B's grants/row with A's captured context; termination doesn't cancel the running callback.
- Stamp source unsafe: establishment's "validated row" comes through the live-profile lookup (`session-established.ts:61`) — approval under A + activation change before lookup returns a same-tuple B row and stamps the A-era channel B. Required ask: bind approval to the exact profile/row.
- `getActiveSessions()` is a synchronous snapshot — a key exchange completing after the listener escapes teardown. Map-miss policy self-contradicts between the listener and Phase 2. SW restart safe for identity (both maps in-memory; upstream forgets sessions).
- N-26: 90 s not justified by the 55 s cutoff (separate phases); an orphan marker still poisons an immediate reconnect for the full window. The true verification floor is `!trustedVerification` — marker expiry can never skip a first verification.
- Tests: two-profile e2e realistic but the "queued call" race needs a deterministic gate; the capability-lookup spy lacks a seam; add switch-after-guard, switch-during-key-exchange, and immediate post-tab-close reconnect controlled tests. toJsonSafe: sound if cleanup is try/finally and toJSON recurses in-frame.

All findings adopted in revision 2 (plan ledger) — including the approver-bound `Map<key, {at, profileId}>` unification of the marker and the stamp source.

## Final fresh-context pass

_(appended below)_
