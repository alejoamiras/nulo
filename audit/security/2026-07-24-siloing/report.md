# Harden Report: security

**Repo:** nulo (branch `worktree-account-profile-siloing`)
**Date:** 2026-07-24
**Effort:** medium
**Run ID:** 2026-07-24-siloing
**Scope:** the branch diff `dev...HEAD` (the account+profile siloing arc), NOT the whole repo.

## Executive summary

Three auditors reviewed the siloing change: two Claude cluster agents (slices+keys, protocol+guard) and one
Codex pass over the whole diff. **Zero Critical, zero High. Eight Medium/Low findings, six fixed in this
branch, two recorded as accepted.**

The most important result is not a finding count. Two of the fixed issues were introduced *by this arc itself*:

- The queued journal resolved its account from **all** accounts while the dispatcher resolves from **visible**
  ones — reintroducing, through a different argument, the exact journal-vs-dispatcher divergence the shared
  resolver was written to eliminate. Sharing a function is not sharing a rule; the inputs must match too.
- The first round of security fixes filtered a fetch on "does this row have a scope" instead of "is this row's
  scope the active one". Because the fetch is by address alone, that admitted **every** profile's rows for a
  shared address directly into the active slice — a cross-profile leak created while closing a cross-profile
  leak.

A third finding is structural rather than introduced: the account re-key is what makes two same-mnemonic
profiles able to coexist, which **promoted a dormant weakness into a live one** — the legacy fallback that
attributed an unscoped transaction by address and chain.

## Methodology

Map-reduce, deliberately reduced for a diff-scoped run. **Deviations from the formal `medium` spec, stated
plainly:** clusters were derived from the change's security surfaces rather than a fresh repo map (Phase 1 was
skipped — the diff is the map); two Claude agents covered four clusters (two each) rather than one agent per
cluster; the Codex leg ran once over the whole diff instead of per cluster; Phase 3 reduce and Phase 4
verification were performed by the main agent against the source rather than by a separate coordinator agent.
Cross-model coverage (Claude + Codex) was preserved, which is the property that matters most.

Clusters: (A) per-scope activity slices, (B) composite storage keys, (C) durable causal protocol,
(D) in-flight-send guard + journal locking + shared dApp account resolver.

## Findings

### [MEDIUM] F-001: A fetch filtered on scope existence, not scope identity — FIXED
**Confidence:** high · **Mapping:** CWE-639, OWASP A01 · **Found by:** claude
**Instances:** `apps/extension/src/stores/app.store.ts` (syncTransactions filter)

`getTransactions(address)` returns rows for that address across every profile. The filter accepted any row for
which a scope could be derived — which is true of every self-scoped row, including other profiles' — and then
wrote the whole array into the active slice. **Fix:** `txBelongsToScope` compares the row's own scope to the
captured one field by field.

### [MEDIUM] F-002: Journal and dispatcher resolved from different account sets — FIXED
**Confidence:** high · **Mapping:** CWE-863, OWASP A01 · **Found by:** codex + claude
**Instances:** `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts`

The journal passed `all=true` (hidden accounts included); the dispatcher omits it (visible only). A hidden
lower-index account wins the default on one side and not the other, so the operation is filed under one account
and sent from another. **Fix:** identical set on both sides.

### [MEDIUM] F-003: Sender extraction diverged from the dispatcher's normalization — FIXED
**Confidence:** high · **Mapping:** CWE-863 · **Found by:** claude
**Instances:** `queued-journal.ts` (`extractSendFrom`)

The journal required `typeof from === "string"`; the dispatcher coerces with `String(from)`. A non-string `from`
(e.g. `["0xB"]`) was therefore read as no-from on one side and as an explicit sender on the other. **Fix:**
mirror the dispatcher exactly — absent or `NO_FROM` means default, everything else is stringified.

### [MEDIUM] F-004: The sole-profile quarantine failed open — FIXED
**Confidence:** high · **Mapping:** CWE-639 · **Found by:** claude
**Instances:** `app.store.ts` (`soleProfile`)

Attribution of unscoped legacy rows was gated on `profiles.length <= 1`, and the list is empty before it loads —
so on any path that reads it early, "not loaded" was indistinguishable from "only one profile" and another
profile's row could be attributed to the viewer. **Fix:** `=== 1`, a positive signal only.

### [MEDIUM] F-005: A connected dApp could hold the account-switch guard indefinitely — FIXED
**Confidence:** high · **Mapping:** CWE-770 (availability) · **Found by:** claude
**Instances:** `apps/extension/src/utils/in-flight-send.ts`

A dApp journals a `queued` record *before any approval*. The guard was profile-scoped while in-flight cards
render per account+network, so a record could block switching while being invisible — and therefore
un-cancellable — and was re-armable past the reaper. **Fix:** the guard is scoped to the account on screen, so
what blocks is always what the user can see and cancel.

### [MEDIUM] F-006: Profile and chain purges deleted outside the transition lock — FIXED
**Confidence:** high · **Mapping:** CWE-362 · **Found by:** claude
**Instances:** `operation-journal/service.ts` (`clearChainState`, `purgeForProfile`)

`deleteOperation` was serialized but the bulk purges were not, so a concurrent transition could write a row back
after its profile was deleted, orphaning dApp origin, addresses and amounts (the reaper can fail such a record
but never remove it). **Fix:** both purge paths delete under the same lock.

### [MEDIUM] F-007: Re-keyed rows written before this branch are not deletable — ACCEPTED
**Confidence:** high · **Mapping:** CWE-459 · **Found by:** claude
**Instances:** account + incoming-transfer delete/purge paths

Deletes re-derive the key from the row value, so rows written under the old key shape are never matched.
Purges silently no-op while still emitting delete events. **Accepted, not fixed:** the repo is pre-production and
its documented stance is that a shape change redefines the baseline and developers reinstall; the arc was
explicitly scoped to add no storage or backup migration. Exposure is upgrade-only, on installs that predate the
branch.

### [LOW] F-008: Dormant defects in the causal coordinator — ACCEPTED (not yet wired)
**Confidence:** high · **Found by:** claude
**Instances:** `activity-protocol/coordinator.ts`

`advance()` wedges on an allocate-without-settle (routine under MV3 service-worker termination, which never
reaches `abandon`), with unbounded `settled` growth; `purgeProfile` is the only unlocked method. **Accepted:**
the coordinator has no production importer on this branch — only its tests — so these are design debts to settle
when it is wired, and they are recorded in the plan for that moment.

## Findings NOT pursued

- JSON key forging in `activityScopeKey` / `accountRowId` / `recordKey` — probed by both models; the encoding is
  injective, so separator, quote, bracket and unicode forgery all fail.
- `purgeProfile`'s prefix match — not forgeable; JSON encoding is prefix-free at the `",` boundary.
- Hostile-backup profile grafting — closed by the unconditional id remap before restore.
- Envelope-vs-embedded scope disagreement in the backup migrator — caught by anchor re-derivation.
- LRU eviction and `clearAll()` on lock — no inactive rows reachable through the active slice.
- Deadlock or lock-order inversion from the new `transitionLock` uses — traced one-directional; `emit` is
  synchronous and never awaits listeners.
- `BigInt` coercion DoS through coordinator rows — blocked by the zod row schemas.

## Cross-cutting observations

**The guard covers one of several active-account mutation paths.** `settings/accounts`, visibility changes and
new-account creation also set the active account and are unguarded. The send path threads its account explicitly,
so no wrong-account signature is demonstrable today — but the guard is defense-in-depth resting on an invariant
that is not enforced at a single chokepoint. Moving it inside `selectAccount` would be the structural answer.

**Two of the six fixed findings were self-inflicted by this arc**, one of them by the previous round of fixes.
That is the argument for running the audit against the *final* diff rather than the design, and for cross-model
review: each was caught by the model that had not written it.
