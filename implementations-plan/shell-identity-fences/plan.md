# shell-identity-fences — batch 6 of audit-448-remediation (rev 3)

Fixes **N-05 (Major)**, **N-08 (Major, split verdict)**, **N-23 (Low)**, **N-22 (Minor)** and executes the **owner-authorized N-09 REMOVAL**. Spec: runbook batch 6; recon: [recon.md](./recon.md); audits: [audit-codex.md](./audit-codex.md) + [audit-fable.md](./audit-fable.md) (round 1: codex REJECT ×6, fable APPROVE-WITH-CHANGES ×8 — all folded below). Base: dev `2665af59`. Tier: **mid**.

## Architecture & Implementation (rev 2)

### N-05 — extracted, fully-scoped network-switch orchestration

Both audits demanded the wiring be testable (a fence pinned only via its primitive is silently revertible in test-less app.vue). Following the repo's own extract-from-shell precedent (`should-advance-to-general.ts`, `auth-guard.ts`, `new-profile-helpers.ts`):

- NEW `apps/extension/src/popup/network-switch.ts`: **a handler FACTORY** (final-gate demand — the glue must not live unpinned in test-less app.vue): `createNetworkSwitchHandler(deps)` owns the per-component fence, entry invalidation, scope capture, and the compound guard internally; app.vue's entire wiring is `watch(() => appStore.network, createNetworkSwitchHandler(deps))`. Inside the handler: `begin()` is the TRUE first line (before the null-network early return — bootstrap's transitional `network = undefined` write must supersede in-flight runs); `scope = { profileId, chainId }` captured next (never live-read; passed to getAccounts ×2 AND `ensureDefaultAccount`); the run guard is `isCurrent() && liveScopeMatches(scope)` (generation AND live-scope compare — a profile drift landing before Vue runs the next network callback leaves generation-only checks true). **Split-statement discipline throughout**: `const accs = await deps.getAccounts(scope…); if (!guard()) return; sink.accounts = accs`. The freshly-created account client is a LOCAL. A final guard runs immediately before the awaited `syncTransactions` tail.
- Tests park EACH await boundary (not just the first RPC) and prove no subsequent assignment/call: superseded-at-await-1/2/3/4, profile-drift-only (generation intact, scope moved), rapid double-switch, ABA.
- NEW `src/composables/runFence.ts` (`createRunFence`) as rev 1, per-component instance (fable verified: one app.vue root per realm; nothing for a module counter to coordinate).
- Tests: `runFence.test.ts` (≥10) + `network-switch.test.ts` — superseded-run interleaving (parked await, second begin()), profile-drift mid-run, rapid double-switch, ABA, and the split-statement discipline (a stale run commits NOTHING).

### N-08 — bounded wait + identity-keyed failure JOIN (final gate overturned the shell-toast-only shape)

- **The wait**: `Promise.race([waitForProfileActive(appStore, activeProfile?.id, UNLOCK_WAIT_MS), rejectOnBootstrapFailure(activeProfile?.id)])`. `waitForProfileActive` (existing, tested) supplies the bounded identity-aware half; the NEW failure channel releases the waiter the moment bootstrap definitively fails (final-gate ruling: a definitive rejection must not leave submit disabled for the remaining bound).
  - Channel: `appStore.bootstrapFailure: { profileId: string; message: string } | null` (pinia state, cleared on any successful bootstrap). `app.vue`'s `onActiveProfileChanged` wrap sets it on rejection (identity-keyed) + logs; its shell toast fires ONLY while that profile is still the relevant one (`!appStore.isLogined || appStore.profile?.id === profile.id`) — stale A-failure toasts are suppressed after B wins (final-gate).
  - `rejectOnBootstrapFailure(profileId)` (in the same composable file as the race caller): watches the store field, rejects with a TYPED `BootstrapFailedError` on a matching profileId; teardown on settle.
- **Typed errors, not message matching** (final-gate): `UnlockTimeoutError` wraps/discriminates `waitForProfileActive`'s timeout rejection; the catch branches on `instanceof` only.
- **First-line reentry guard** (final-gate): `if (isAwaitingResponse.value) return` at the top of `handleUnlockWallet` — two programmatic submits must not mint duplicate same-profile continuations.
- **The IMMEDIATE post-wait window has its own check** (final-gate): re-verify `{ appStore.isLogined, appStore.profile?.id === activeProfile?.id }` FIRST after the race resolves, before the password clear or ANY assignment; the redundant `appStore.profile = activeProfile` assignment is REMOVED (bootstrap already established identity — a stale A-continuation must have nothing to write). The post-`setLastActiveProfileId` second check stays. Both windows pinned separately.
- `UNLOCK_WAIT_MS = 30_000` — grounded (e2e envelope 30 s ×36; transport 60 s; import handshake 30 s). Cited.
- Toast discrimination as rev 2: timeout → family-standard toast unless a different profile won (silent yield); BootstrapFailedError → family-standard failure toast (the auth-side complement of the shell toast); benign silenced classes untouched. `useToast` wired into auth.vue.
- Tests (auth.test.ts): timeout → latch + toast; bootstrap-failure → IMMEDIATE release + failure toast (no 30 s wait — the join pin); hijack → silent yield; reentry guard (double submit → one continuation); immediate-post-wait drift pin; post-setLastActiveProfileId drift pin; happy path.

### N-23 — collapsed scope key + per-loader generations (+ tokens refresh)

- Watch source: `const scopeTriple = () => { const p = appStore.profile?.id, n = appStore.network?.id, a = appStore.account?.address; return p && n && a ? `${p} ${n} ${a}` : "" }` — **the collapse-to-empty is load-bearing** (fable: bare interpolation stringifies undefined → never-falsy key → the `!nv` guard dead + throwaway RPC storms on every bootstrap transition; mirrors the component's own scope build :239-242). `network.id` (not chainId — records carry networkId; chainId aliases rows; both audits concur).
- The two loaders (`resnapshotJournal`, `loadExecutingTaskSnapshot`) take the component-level `createRunFence`'s `isCurrent` instead of captured-equality guards — **generation-monotonic, so A→B→A cannot revalidate a stale run** (codex's ABA).
- The reload branch also calls a FENCED `loadTokens()` with a SYNCHRONOUS clear first (final gate: A's delayed `getTokens` could otherwise overwrite B's map after B resolves — the token load takes the same `isCurrent` guard and the map clears synchronously on scope change).
- **`TransferContent` gains `networkId`** (final gate OVERTURNED the residual ruling: the value is already in hand at `transfer-executor.ts:81-84`, making this strictly-adjacent in-memory state, not disproportionate schema work): the executor stamps it at task creation; `isExecutingTask` compares it WHEN PRESENT (old in-flight tasks without the field keep address-only semantics — graceful). Closes the same-address NETWORK-switch card gap end-to-end.
- Tests: same-address profile switch → reset+reload; same-address NETWORK switch → the cross-network task is NOT re-accepted (the new pin); deferred A/B token overwrite pin (A's slow getTokens resolves after B's — B's map stands); mid-await profile flip → stale loader commits nothing; the collapse case (missing scope part → no RPCs).

### N-22 — unchanged from rev 1 (both audits confirmed): verbatim family catch + `TOAST_DURATION` import + rejection-path test.

### N-09 — removal per the recon inventory, plus the round-1 additions

Rev 1's inventory stands (both audits independently re-verified it grep-complete) with: `utils/core.ts:10` file-header comment (names the deleted functions — both audits); `new-profile-helpers.test.ts:63` test TITLE edit; the ordering pin REPLACED (sentinel-before-route → **active-account-storage-before-route**, codex — never deleted); the verification grep is `rg`/`grep -rnE` **scoped to `apps/extension/{src,tests}`, `package.json`, `vite.shared.ts`** (final gate: a repo-wide zero-hit is impossible — committed audit/plan/architecture documents legitimately carry the terms; current-tense ARCHITECTURE references get updated or classified historical).

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
- Gate arc: round-1 dual audit (codex REJECT ×6 / fable APPROVE-WITH-CHANGES ×8, zero contradictions) → rev 2 → final fresh-context pass **APPROVE-WITH-CHANGES** with BOTH adjudicated disagreements OVERTURNED: (1) bootstrap failure gets an identity-keyed JOIN releasing the waiter immediately (+ typed errors, reentry guard, immediate-post-wait check, redundant profile assignment removed); (2) `TransferContent.networkId` IS strictly adjacent (value in hand at the executor) — the cross-network card gap closes fully; plus handler-factory extraction (all glue pinned) and the scoped verification grep. Rev 3 = plan of record; resumed re-verdict (pending) is confirmatory.
