# Path-2 + token-delete + journal-nit audit arc — codex post-impl audits

Six iterative audit cycles against the Path-2 (chain block-timestamp adoption) + token-remove/re-add hardening + journal terminal-tx detail nits work on branch `feat/onboarding-fees-history-arc`.

## Commits

| # | SHA | Title |
|---|-----|-------|
| 1 | `ee1c900` | block-timestamp sort + token-delete wipe (initial Path 2 + nits) |
| 2 | `e3f8065` | post-impl audit findings (scan race + popup-stale + ts-backfill) |
| 3 | `2f86ceb` | generation counter race guard + boolean trust-flip return |
| 4 | `aae4c21` | guard unknown→pending against mid-scan delete |
| 5 | `af0f077` | replayPendingPrompts live-recheck before emit |
| 6 | `136bb36` | setTrustAllow/Reject compensating-action + per-record re-check |

## Audit transcripts

| Cycle | Verdict | What it caught | Resolution commit |
|-------|---------|----------------|-------------------|
| 1 (initial post-impl) | Reject | scanContract race, popup-state stale, blockTimestamp permanent miss, false-positive on per-account loop | `e3f8065` |
| 2 | Reject | Last-token-delete race, backfill upsert race, silent no-op leaks via success toast | `2f86ceb` |
| 3 | Reject | unknown→pending transition unguarded | `aae4c21` |
| 4 | Reject | replayPendingPrompts has the same stale-snapshot race | `af0f077` |
| 5 | Reject | setTrustAllow/Reject race after upfront guard | `136bb36` |
| 6 | Reject (refactor advised) | scanContract local `trustState` becomes stale if user clicks Allow during PXE backfill | **deferred** |

## What's shipped

Every concrete failure mode reachable by typical user interaction patterns is closed:
- Token remove + re-add preserves activity-feed order via chain block timestamps (Path 2 primary goal).
- Token delete properly wipes records + resets trust to `unknown` so re-add re-prompts.
- All four "snapshot stale" races (scanContract main loop, scanContract backfill, scanContract unknown→pending, replayPendingPrompts) are guarded by a generation counter (`scanContract`) or per-row live re-checks (`replayPendingPrompts`).
- `setTrustAllow` / `setTrustReject` use compensating-action pattern to revert clobbered trust state when a delete lands during the trust write.
- Popup-side: `PopupManager` closes the trust prompt on `onIncomingTrustChanged → unknown` and purges queued payloads for the same triple.
- Boolean return contract on `setTrustAllow` / `setTrustReject` lets `IncomingTrustPopup` suppress misleading success toasts on refused flips.

Tests cover all of the above (12 new scenarios added across the six commits in `service.scenarios.test.ts` + 3 in `PopupManager.test.ts`). Full extension vitest: 2152 passed.

## Deferred follow-up (codex audit-6 recommendation)

Codex's final response on commit `136bb36`:

> The surface is **not fully converged yet**, and the pattern suggests multiple unsynchronized writers mutating the same `(profile, network, contract)` trust row and its record set from different async paths. The concrete design fix is a **per-triple serialized critical section / actor** that owns: trust transitions, record visibility flips, delete/reset, replay/pending emits.

### The specific residual race

`scanContract` captures `trustState` from the repo at line ~525 (`getTrustState`), sets it to `"pending"` locally after the unknown→pending transition (~line 605), then uses that LOCAL value when constructing the record via `buildRecord` (~line 638). If the user clicks Allow during the PXE `blockTimestampFor` await (between lines 605 and 638), `setTrustAllow` writes `trusted` to the repo — but our local snapshot is still `pending`, so we persist the new record with `hidden: true`.

**Final state**: trust row is `trusted`, but the just-discovered note stays hidden forever. Subsequent scans skip via the `getRecord` existing-record branch. `replayPendingPrompts` ignores it (trust is no longer `pending`).

### Practical likelihood

The window between `setTrust("pending")` and the eventual `upsertRecord` includes:
- `emit("onIncomingTrustChanged")` — sync
- `await isVisibilityEnabled()` — one config service await
- `emit("onIncomingTransferPending")` — sync (this opens the popup)
- `await blockTimestampFor(...)` — one PXE getBlock call

For the race to fire: the user must read the popup, click Allow, AND have all that propagate through the message bus + setTrustAllow's own awaits FASTER than `blockTimestampFor` completes. Scan-loop work is single-digit milliseconds; PXE backfill is sub-second on a healthy node; popup-render-to-user-click is human-time (seconds). The window is closed in practice by human reaction time.

### Why we're deferring

- **Scope**: a per-triple serialized critical section / actor is a structural refactor of the entire incoming-transfer service core. Days of work. Out of the original Path-2 audit-fix arc scope.
- **Practical impact**: the residual race requires slow-PXE + instant-click + very specific microtask ordering. Not reproducible in QA.
- **All concrete known failure modes are closed**: the six commits address every race codex could point to a deterministic test for.

### When to revisit

- If a user reports "I received tokens but they're not showing up in history, but the contract is in my registered tokens" — that's the symptom of this race (hidden record stuck in storage). Confirm by querying repo state via the dev panel.
- If the trust state machine grows additional state transitions (e.g. unblock-blocked, separate-network-trust, multi-account trust scoping) — the additional concurrent writers will compound the race surface. Refactor before adding.

### Refactor sketch (when it lands)

- Per-`(profileId, networkId, contract)` lock held for the duration of: trust state transition, record visibility flip, record wipe, popup-pending emit.
- Replace direct `repo.setTrust` calls with `acquireLock(triple).then(setTrust).then(emits).then(releaseLock)` shape.
- Repo `setTrust` becomes a compare-and-swap: writer passes expected prior state; mismatch is an error.
- Scan path captures the lock before the unknown→pending transition; releases AFTER `upsertRecord`. setTrustAllow blocks waiting for the lock until scan releases.

## Lessons captured

This arc surfaced that the incoming-transfer trust state machine has more concurrent writers than the original design accounted for: scan path, user action (popup), token-lifecycle (TokenService events), profile/chain clear (administrative paths). Six rounds of patching closed every concrete race but didn't change the fundamental "no serialization" property. The architecture note for the eventual refactor lives here so future Claude sessions don't re-discover the same issue from scratch.
