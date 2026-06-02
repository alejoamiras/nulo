# v3 — post-implementation codex review (full diff `dev..HEAD`)

Final critical + adversarial pass over the complete v3 "parallel dApp popups"
changeset, after all phases + the local e2e sweep. `xhigh`, read-only.

**Verdict:** `blocked` → addressed (1 fixed, 2 documented per owner decision).

## Findings + dispositions

### Blocker — stale popup executes against the current (possibly switched) profile → FIXED

The popup execution path validated the request only at popup-creation, but
`executeAndResolve` ran against whatever profile is active at approval time, and
`resolveExecutionMutexKey` (`packages/extension/src/wallet/services/execution/service.ts:1247`)
keys on the *current* active profile. A popup is a separate window that can
outlive a profile switch / wallet lock (up to `INTERACTION_TIMEOUT_MS`). Effects:
the tx could run against the wrong profile's PXE (if the same account address
exists in both), and two requests from one session could serialize on *different*
mutex lanes (`A:chain` then `B:chain` / `noprofile:chain`), breaking the
in-order guarantee.

Largely pre-existing (the popup path never re-validated the profile; the *silent*
path already did — `silentInteraction`'s "Wallet locked" throw). v3's mutex made
the lane-split observable.

**Fix:** mirror the silent-path guard in `executeAndResolve`
(`packages/extension/src/wallet/services/dapp-interaction/service.ts`): before
executing, re-check `getActiveProfile()?.id === payload.session.profileId`; abort
otherwise. With the guard, the executing profile always equals the session's
profile, so the mutex key is consistent (no lane split) and no wrong-profile
execution. typecheck + service tests green.

**Re-audit:** `closed`, no new issue. Codex confirmed the guard removes the
stale-popup window, placement before `refreshSession()` is correct (matches the
silent path), the capabilities popup is unaffected (it resolves via
`resolveInteraction`, not `executeAndResolve`), and the throw settles the dApp
promise via `windowManager.cancel` with no handle/storage leak. **Residual
(negligible, deferred):** a microsecond TOCTOU remains because
`resolveExecutionMutexKey` re-reads the active profile a few async hops after the
guard — vs the minutes-long popup-open window now closed. Making it airtight
would require threading `session.profileId` through execution keying instead of
re-reading active state; deferred as a follow-up (a user profile-switch inside a
sub-millisecond window is not realistically exploitable).

### P1 — unbounded execution-mutex queue for silent/self-paid sendTx → DEFER + DOCUMENT (owner decision)

A buggy/malicious dApp can burst many silent (self-paid, embedded-fee) sendTx;
each releases the session FIFO at mutex-enqueue, so they pile up as waiters on
one `(profileId, chainId)` lane. The 8/32 journal limits cap *visibility* only,
not execution waiters, so a backlog beyond the cap is invisible + uncancellable
while it blocks the lane.

**Disposition (owner):** defer + document. Rationale: pre-existing economic-DoS
*class* — the attacker pays a fee per tx (self-paid), it blocks only their own
lane on one profile+chain, and execution was already serial pre-v3 (v3 makes the
queue deep instantly rather than trickling; total work + per-lane impact are
unchanged). The user can disconnect the dApp. **Follow-up:** add a per-key
queue-depth cap to `ExecutionMutex` (reject enqueue beyond N → dApp gets a clean
error) if this surfaces in practice.

### P2 — no e2e coverage for the NO_FROM (DefaultEntrypoint) path → DOCUMENT (owner decision)

The new e2es drive only `pg-btn-sendTx-default` (standard path). The nonce-less
NO_FROM path (`executeNoFromSendTx`), which relies *entirely* on the mutex for
on-chain correctness, is untested under concurrency at e2e.

**Disposition (owner):** document + lean on existing coverage. A clean "both
confirm" NO_FROM concurrency test isn't feasible in the sandbox — NO_FROM doesn't
reliably confirm there (the existing `tx-sendTx-noFrom.test.ts` is itself lenient
`expect(["ok","error"])`), so the test would be flaky. Mitigants relied upon:
- `executeNoFromSendTx` uses the **byte-identical** `acquireExecutionSlot(…,
  hooks?.onExecutionEnqueued)` integration as `executeAztecSendTx` (same call
  shape, same enqueue-then-release ordering) — a regression in the mutex
  integration would almost certainly hit both, and E2 (standard, both-confirm)
  covers the shared primitive end-to-end.
- The `ExecutionMutex` FIFO + abort + ordering properties are unit-pinned
  (`execution-mutex.test.ts`).

**Follow-up:** build the NO_FROM funding fixture (pre-deploy + embedded-fee) so a
real NO_FROM "both confirm" concurrency e2e becomes reliable.

## Not flagged

Codex found no new dependency, and no crypto / fee-handling regression in the
diff — "the risk is state ownership and queue correctness, not supply-chain."
