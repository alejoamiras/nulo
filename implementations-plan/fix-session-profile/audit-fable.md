# Fable audit trail — fix-session-profile (Arc 1)

Claude-side leg of the mid-tier dual audit (Plan agent). Single round; **conditional approve** with four conditions, all adopted into the plan's "Reconciled resolutions" and reconciled against the codex leg.

## Verdict: conditional approve — conditions

- **C1 (B-01 test)** — B-01c ("storage rejection surfaces an error") can't go green under memory-first-swallow (a rejected `set` still resolves = documented degradation). Reframed to resolve-AND-getSecret-succeeds; keep the post-open `isActive` check as a cheap invariant (don't drop it under the can't-repro rule).
- **C2 (B-01 close — BLOCKING)** — the plan dropped verified.md's post-close check. A memory-first `close()` with a swallowed `session.delete` rejection leaves the persisted bearer alive → next SW restart silently re-unlocks via `restore()`; the memory-only close pin passes straight through this. Resolution: `lockActiveProfile` gains a `hasPersistedSession()` read-back that surfaces the failure. (Codex concurred; also required `session.delete` to get its own catch so `clearLockAlarm` always runs.)
- **C3 (B-01 minor)** — schedule the TTL alarm independently of the write's success; still `clearLockAlarm` on a delete rejection. Racing-alarm gate preserved by memory-first (state clears earlier, re-checked under `runExclusive`); emitting `onChange` before persist is safe (subscribers read in-memory via the facade).
- **C4 (B-11)** — sweep MUST run under `runExclusive` (finalizeRestore holds a live buffer reference; an unlocked sweep zeroizing mid-open is a real hazard); TTL ≥ a slow backup import (≥30 min); NEVER sweep the id being finalized. (Codex added: 3 trigger sites justify one private helper; remove the finalize entry from the map before its await.)
- **C5 (B-10)** — confirmed real, fix minimal; RED test by capturing the fake's derived buffer and asserting it's wiped after the F-007 rejection.

## Cross-model reconciliation

Both auditors independently converged on the C1/C2/C3 condition set. Codex sharpened three points folded into the final design: B-11's helper is justified by its 3 trigger sites (clears the ≥3-benefit bar); B-12 needs a raw-key **read-back-after-reject** (a rejected tombstone write is commit-ambiguous — release only if `reservedIds()` confirms absence, else fail-closed retain), keeping the epoch bump; `session.delete` in its own catch. The complete-arc-diff codex pass (see audit-codex.md) later added ARC1-01 / ARC1-01R (stale-record cleanup + read-back-and-surface on open) before converging.
