# Codex audit trail — fix-session-profile (Arc 1)

Dual audit (mid tier): codex xhigh + Fable Plan agent on the plan; single bounded codex xhigh pass on the complete arc diff (initial + 2 fix rounds -> converged).

## Plan audit — codex xhigh (REJECT -> conditions folded)

### B-01

Memory-first fixes immediate false success, but “swallow” leaves a persistence invariant broken: a failed open may retain another profile’s stored bearer; a failed close may leave the locked profile restorable after SW restart.

The post-open `isActive(profile.id)` check belongs immediately after `open()`, combined with the reservation/epoch condition. It proves only the in-memory transition—not persistence. After memory-first, rejected `session.set` leaves `isActive === true`, so B-01c (“storage rejection surfaces an error”) cannot become green. The plan must either propagate a persistence-status result while retaining memory, or redefine degraded in-memory success as success.

Close reordering is alarm-safe because operations share the facade lock and the racing alarm sees `activeSession === undefined`. However, `session.delete` needs its own catch so `clearLockAlarm()` always executes. Keep emit/alarm work after the attempted delete. The verified fix also explicitly requires a post-close check in `lockActiveProfile`; the plan omits it, though it likewise cannot detect persistence failure after memory-first.

### B-10

Confirmed and correctly scoped as an individual instance. Immediate zeroization before the mismatch throw is minimal; moving the check inside the existing `try/finally` is structurally safer. A RED test is viable using a known recovery buffer and asserting its bytes, rather than relying on an ESM spy.

Do not claim all of B-10 remediated: the consolidated finding lists additional setup-throw instances outside this arc.

### B-11

No alarm is required under the stated opportunistic/SW-lifetime threat model, but the entry is not “harmless”; sweep-on-next-op does not provide a wall-clock bound.

Use a dedicated 30-minute TTL from recovery capture, and sweep synchronously at entry to `restore`, `finalizeRestore`, and `deleteProfile`. Those three sites justify one private helper. In `finalizeRestore`, remove the target entry from the map before awaiting `openSessionVerified`, then zeroize it in `finally`; otherwise another sweep can zeroize it mid-use. Legitimate imports exceeding the TTL can expire when another trigger runs—this behavior must be explicitly accepted.

The B-11 test must advance time past TTL; “later restore” alone would remain RED after a correct implementation.

### B-12

Unconditional release on tombstone-write rejection is unsafe because rejection may be commit-ambiguous. Catch only `tombstones.write`; read raw-key presence (`reservedIds`, not decoded `get`). Release only when absence is confirmed. If the key exists, is corrupt, or readback fails, retain reservation fail-closed.

The rollback window ends once tombstone durability is possible—not when `repo.delete` succeeds. Any `repo.delete` failure retains tombstone and reservation. Keep the epoch bump: rolling it back creates ABA and reauthorizes pre-delete operations. Add a write-then-reject test proving reservation remains.

reject (blocking findings)
---

## Complete-arc-diff audit — codex xhigh

### Round 0 — initial (reject: ARC1-01 open->restart + pin gaps)

- **ARC1-01 — Critical:** On a swallowed `session.set` failure, [open()](apps/extension/src/wallet/services/profile/session-manager.ts:231) leaves any prior persisted record untouched. Sequence: profile A is persisted → open B → set rejects → memory reports B successfully → worker restarts → [restore()](apps/extension/src/wallet/services/profile/session-manager.ts:397) loads and silently reactivates A. Contrary to the comment, restore has no current in-memory profile against which to reject A. The rejection path must verify persisted state is absent/current, or clear and verify it; otherwise it must surface failure. Add an A→B→restart regression pin.

- **ARC1-T01 — Major:** The pins do not cover several reconciled requirements. The close pin checks only memory, so it would pass without `hasPersistedSession()` or the `lockActiveProfile()` read-back. B-12 lacks the agreed commit-then-reject/fail-closed pin. The B-11 test claims restore-triggered sweeping, but `deleteProfile(original2.id)` sweeps the secret before that restore occurs.

The close read-back itself is correct and read errors fail closed. B-10 zeroizes exactly once on every post-recovery exit without use-after-zeroize. B-11 map ownership, locking, TTL arithmetic, and remove-before-await are sound. B-12’s raw-key read-back and release sequencing are correct.

Targeted tests could not start because the read-only environment prevented Vitest from creating its temporary client directory.

Verdict: reject (blocking findings)
### Round 1 — after fixes (reject: ARC1-01R storage-fully-down)

- **ARC1-01R — Critical:** The stale-profile resurrection is reduced but not closed. After `session.set` rejects, `session.delete().catch(() => {})` is only best-effort. If storage is unavailable and both operations reject, persisted A remains, memory reports B, and restart restores A. The new pin only rejects `set`, so cleanup succeeds and misses this path. On unconfirmed cleanup, opening must not report degraded success—read back fail-closed and surface/clear the in-memory transition. The stale “harmless” comment is also still incorrect.

All revised B-11, B-12, and close read-back pins now faithfully cover their reconciled behaviors; no other material findings.

Verdict: reject (blocking finding)
### Round 2 — converged

The rollback/read-back closes the false-success path: `hasPersistedSession()` fails closed, memory is cleared before return, and `openSessionVerified()` rejects. The remaining durable record represents the previously authorized session and cannot be removed while storage is unavailable; it is not a new exposure created by opening B.

No remaining material findings.

converged