# Fable audit — round 1 (independent top-tier Claude auditor, parallel with codex)

Verdict: **conditional approve** (conditions below). Full report:

## 1. Adversarial / security

**S1 (high): the type system cannot catch the fail-open landmine.** `null === "0"` typechecks fine on `string | null`; both cards are plain-JS `<script setup>` (no `lang="ts"`), so `audit:vue` typecheck sees none of the card-level null handling. The atomic-phase mitigation holds ONLY because of the enumerated red-first tests; those tests are load-bearing. Independent consumer sweep confirms the recon table complete; no other fail-closed→fail-open flips found; `fiatFor` null-safe.

**S2 (high): D3's justification is factually wrong for the fpcs slice.** `FpcService.getFpcs(chainId)` filters by the SW's CURRENT PROFILE (`service.ts:132`). Balances are chain-state (profile-free), but the fpcs slice is profile-dependent data cached under a profile-free key → profile A's FPC list served to profile B (same address in two profiles is realistic — same seed). "Map cleared on profile switch" is a required invariant with a mid-switch in-flight race, not "cheap safety". Today's `reqKey` includes profileId; the store as drafted loses that.

## 2. Assumption attack

- **Inference 1** (drop profileId): FALSE as argued (S2). Facts 1–8 otherwise verified against code.
- **Inference 2** (version-watch == today's retry): two drifts: (a) `retryAttempt` resets on identity change today — per-key store backoff on an A→B→A flap may resume escalated; (b) degraded-then-embedded: today the retry chain DIES at runInit's early-return until `useOwnMethod` revives it; a refcounted store keeps retrying while subscribed → background RPC traffic that doesn't exist today.
- **Inference 3** (pin migration preserves power): **the sharpest hole.** "Store single-flight subsumes rawRequests/reuseRawRequest" is FALSE. Single-flight dedups concurrent callers; `reuseRawRequest` re-attaches a retry to a timed-out-but-UNSETTLED RPC. A store fetch settles at timeout, clears its in-flight slot, and the backoff retry issues a NEW RPC — exactly the unbounded pre-connect accumulation the mechanism prevents (pinned at `FeeSettingsCard.test.ts:771-778`, calledTimes(1) across retry-after-timeout). Pins re-anchored to "store fetches" would pass vacuously while the regression ships.
- **Inference 4** (execute window): wire traffic is strictly FEWER RPCs, not identical — relabel honestly.

## 3. Implementation critique

Store-with-snapshot-commit is right; D4 is the only mechanism preserving FeeSettingsCard's tx-settle non-reactivity and #66 gating byte-identical. **Internal contradiction**: GasBalanceCard "keeps optimistic deduction" but "deletes tx subscription" — the deduction is DRIVEN BY `onTransactionAdded`. Resolution: card keeps a TransactionServiceClient for tx-added + a card-local display overlay; optimistic mutation of the shared entry would leak deducted balances into FeeSettingsCard snapshots.

**Outline B: reject, harder than the plan does.** `base-client.ts:213` — `disconnect()` rejects every in-flight request; shared in-flight maps + component-owned clients = card A's unmount rejects promises card B joined. Cross-component poisoning today's private maps can't produce.

**Unenumerated deviations**: (4th) today the nudge DOES fire on a failed public read (fabricated "0" indistinguishable from confirmed zero); post-flip it won't — enumerate + pin. Also `resolveSavedSelection` falls through to the network default when the fj row is null-disabled — enumerate under deviation 2 + pin.

Phase ordering sound. Gate weakness: Phases 3/4 must use the REAL Pinia store with client-layer mocks — `createTestingPinia`-stubbed actions would gut the pins.

## 4. Ledger

Reverse **D3** (keep profileId — costs nothing, kills S2 incl. the mid-switch race). Keep D1 (strengthened by the outline-B disconnect argument), D2, D4, D5.

## Conditions

1. Port the timeout-survivor raw-request reuse into the store OR keep the accumulation pin anchored at client-call counts; delete "single-flight subsumes" from the plan.
2. Resolve optimistic-deduction as card-local overlay + retained tx-added subscription; never shared-entry mutation.
3. Reverse D3 or promote clear-on-profile-switch to a pinned invariant with the in-flight-settle race handled.
4. Enumerate the nudge-on-failed-read change as deviation 4 and the saved-selection fallthrough under deviation 2, each pinned.
5. Phases 3/4 mock at the client layer against the real store; acknowledge JS SFCs get no typecheck coverage — red-first tests are the only fail-open guard.
