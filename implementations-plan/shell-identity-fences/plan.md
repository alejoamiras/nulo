# shell-identity-fences — batch 6 of audit-448-remediation (rev 2)

Fixes **N-05 (Major)**, **N-08 (Major, split verdict)**, **N-23 (Low)**, **N-22 (Minor)** and executes the **owner-authorized N-09 REMOVAL**. Spec: runbook batch 6; recon: [recon.md](./recon.md); audits: [audit-codex.md](./audit-codex.md) + [audit-fable.md](./audit-fable.md) (round 1: codex REJECT ×6, fable APPROVE-WITH-CHANGES ×8 — all folded below). Base: dev `2665af59`. Tier: **mid**.

## Architecture & Implementation (rev 2)

### N-05 — extracted, fully-scoped network-switch orchestration

Both audits demanded the wiring be testable (a fence pinned only via its primitive is silently revertible in test-less app.vue). Following the repo's own extract-from-shell precedent (`should-advance-to-general.ts`, `auth-guard.ts`, `new-profile-helpers.ts`):

- NEW `apps/extension/src/popup/network-switch.ts`: `runNetworkSwitch(deps, scope, isCurrent)` — deps-injected (account-client factory, appStore-shaped sinks), taking the CAPTURED `scope = { profileId, chainId }` (runbook conformance — never live-read; passed to getAccounts ×2 AND `ensureDefaultAccount`) and the run's `isCurrent`. **Split-statement discipline throughout** (fable's check-after-assign trap): `const accs = await deps.getAccounts(scope…); if (!isCurrent()) return; sink.accounts = accs` — the check must precede every assignment, exactly as `useProfileBootstrap.ts:98-100`. The freshly-created account client is held in a LOCAL (never re-dereference mutable `managers.account`). A final `isCurrent()` guard runs immediately before the awaited `syncTransactions` tail (belt — the tail is internally scope-fenced via `app.store.ts:389-423`'s compare-and-commit, fable-verified).
- app.vue's watcher shrinks to: `begin()` as the TRUE first line (before the `!appStore.network` early return — bootstrap's transitional `network = undefined` write must supersede in-flight runs), scope capture, then `await runNetworkSwitch(...)`.
- NEW `src/composables/runFence.ts` (`createRunFence`) as rev 1, per-component instance (fable verified: one app.vue root per realm; nothing for a module counter to coordinate).
- Tests: `runFence.test.ts` (≥10) + `network-switch.test.ts` — superseded-run interleaving (parked await, second begin()), profile-drift mid-run, rapid double-switch, ABA, and the split-statement discipline (a stale run commits NOTHING).

### N-08 — adopt the existing primitive + discriminated timeout

- **`waitForProfileActive(appStore, activeProfile?.id, UNLOCK_WAIT_MS)` replaces the busy-wait AND the separate identity guard** (fable found it: `src/composables/waitForProfileActive.ts`, already tested — bounded, identity-aware, watch-based, rejects on timeout, tears down on both paths). Neither recon nor rev 1 priced it; adopting it deletes the hand-rolled loop entirely.
- `UNLOCK_WAIT_MS = 30_000` — grounded (fable: the e2e suite's dominant post-unlock envelope is 30 s ×36 occurrences; codex: transport bound 60 s, the analogous import handshake allows 30 s). Cited in the code comment.
- **Discriminated timeout handling** (fable killed rev 1's false claim — auth.vue has NO toast today and its inner catch's generic branch silently returns; a blanket toast would regress deliberately-silenced benign classes like the lock-cascade "Client disconnected"): catch ONLY the wait's timeout rejection (dedicated error/message check), and before toasting re-check — if a DIFFERENT profile won (`appStore.isLogined && appStore.profile?.id !== activeProfile?.id`), return silently (the winner's UI is live; a "try again" toast would race a successful navigation); otherwise toast the family-standard timeout error. `useToast` gets wired into auth.vue (it isn't today). The `finally` latch-release is verified-existing and stands.
- **Post-`setLastActiveProfileId` re-check** (codex): A can pass the wait, park in that await, resume after B activates and replace B's managers — re-verify identity after it, before `managers.account = …`/`initTransactionService`.
- `app.vue` `onActiveProfileChanged`: try/catch + log + a SHELL-side toast on bootstrap failure (`openToast` is already wired at app.vue:24, precedent :172-174) — the user learns immediately instead of at the timeout. (Adjudicated disagreement: codex asked for an identity-keyed failure signal/join to release the waiter early; fable assessed the signal channel as over-engineering once the wait is bounded and the shell toasts. ADOPTED fable's smaller shape; logged.)
- Tests (auth.test.ts): timeout → latch released + timeout toast (fake timers); hijack → silent yield (no toast, no continuation writes); bootstrap-failure path → shell toast (app-side, covered in network-switch/bootstrap wrap test scope); happy path unchanged; the post-setLastActiveProfileId drift case.

### N-23 — collapsed scope key + per-loader generations (+ tokens refresh)

- Watch source: `const scopeTriple = () => { const p = appStore.profile?.id, n = appStore.network?.id, a = appStore.account?.address; return p && n && a ? `${p} ${n} ${a}` : "" }` — **the collapse-to-empty is load-bearing** (fable: bare interpolation stringifies undefined → never-falsy key → the `!nv` guard dead + throwaway RPC storms on every bootstrap transition; mirrors the component's own scope build :239-242). `network.id` (not chainId — records carry networkId; chainId aliases rows; both audits concur).
- The two loaders (`resnapshotJournal`, `loadExecutingTaskSnapshot`) take the component-level `createRunFence`'s `isCurrent` instead of captured-equality guards — **generation-monotonic, so A→B→A cannot revalidate a stale run** (codex's ABA).
- The reload branch also calls `loadTokens()` (fable: B's rows otherwise render with A's token symbols/decimals — the token map is mount-only).
- **Logged residual (out of scope, for final-pass ratification)**: codex found a same-address NETWORK-switch task gap — `TaskService` clears on profile change only, and `isExecutingTask` can only compare `senderAddress` (TransferContent carries no network field). The widened watcher now CLEARS the card on network switch (strictly better than today); the reload can re-accept an address-matching cross-network task — fixing THAT requires a TransferContent schema change, beyond the adjudicated-Low finding's strict requirements. Residual documented in code comment.
- Tests: same-address profile switch → reset+reload (the missing Layer-A case); mid-await profile flip → stale loader commits nothing (pins the generation guards — fable flagged the widened guards as otherwise silently revertible); the collapse case (missing scope part → no RPCs).

### N-22 — unchanged from rev 1 (both audits confirmed): verbatim family catch + `TOAST_DURATION` import + rejection-path test.

### N-09 — removal per the recon inventory, plus the round-1 additions

Rev 1's inventory stands (both audits independently re-verified it grep-complete) with: `utils/core.ts:10` file-header comment (names the deleted functions — both audits); `new-profile-helpers.test.ts:63` test TITLE edit; the ordering pin REPLACED (sentinel-before-route → **active-account-storage-before-route**, codex — never deleted); the post-removal verification grep uses `grep -rnE` (rev 1's basic-grep alternation was vacuous — fable).

## Security & Adversarial Considerations

As rev 1, plus: the timeout discriminator cannot silence NEW error classes (it matches only the wait's own rejection); the hijack-yield path writes nothing (fail-safe); all fences remain read-compare-before-write.

## Phases

1. `runFence` + `network-switch` extraction + N-05 wiring + tests.
2. N-08 (waitForProfileActive adoption + discriminated timeout + drift re-check + shell toast) + N-22 + N-23 + tests.
3. N-09 removal (inventory + round-1 additions) + regenerated types + `grep -rnE` verification.
4. Battery: audit:vue + SMOKE (required) + full solo network (the two edited specs are members). Host shared with NOTHING.
5. Post-impl: max review → codex final-diff loop → PR → checks → squash-merge.

## Decision ledger

- Extraction over inline (BOTH audits; silently-revertible wiring in test-less app.vue was the recurring pipeline lesson).
- Full scope capture {profileId, chainId} passed to all three calls (runbook conformance; codex + fable).
- `waitForProfileActive` ADOPTED (fable's find; deletes the hand-rolled wait + guard); hijack semantics handled by the silent-yield discriminator (the "misleading timeout on hijack" trade-off resolved in code, not accepted as UX).
- 30 s bound (empirically grounded); discriminated toast only (regression trap); shell-side bootstrap toast over a waiter-signal channel (adjudicated codex/fable disagreement → fable's smaller shape; LOGGED).
- N-23: collapse-to-empty key; per-loader generations over equality (ABA); loadTokens in reload; the cross-network task residual OUT (adjudicated-Low finding; schema change not strictly required — flagged for final-pass ratification).
- N-09: ordering pin replaced not deleted; grep -rnE.
- Gate arc: round-1 dual audit (codex REJECT ×6 / fable APPROVE-WITH-CHANGES ×8, zero contradictions between them — every finding either overlapped or was complementary) → rev 2 → final fresh-context codex pass (pending).
