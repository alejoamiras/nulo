# Arc 8 — quality-dedup-adoption (Q-07, Q-08, Q-09, Q-10, Q-11)

[mid] tier of the 2026-08-16 dual-audit **quality** remediation. Five STRUCTURAL Duplicate-Code findings. **Zero behavior change** (quality arc). Dual audit (codex + fable) over the complete arc diff at the end; bounded loop.

Source of truth: `audit/quality/2026-08-16-extension-mid/findings/consolidated.md` (Q-06..Q-12 are consolidated-only — verified.md covered Q-01..Q-05).

Anchors below are **current** (verified by 4 parallel recon agents against `dev@f6318cad`; audit line numbers had drifted).

## Governing discipline
- ANTI-OVERENGINEERING: smallest safe change; **no NEW abstraction unless ≥3 call sites benefit AND codex agrees**. Adopting an EXISTING helper is not gated by ≥3.
- Every extraction preserves `data-testid` verbatim; owner-locked visuals untouched.
- Riskier / lower-value sub-parts are split into **codex-agreed documented follow-ups**, not silently dropped.

---

## Q-07 — incomplete adoption of existing extractions

### (a) `isPopupSubmitKey` — extract the byte-identical Enter-submit predicate [DO]
5 popups hand-copy the identical input/textarea-focus-guarded predicate; `usePopupEntity` (C0) already owns the same guard inline. Extract a pure `isPopupSubmitKey(e: KeyboardEvent): boolean` (C0 helper), adopt in the 5 hand-rollers + `usePopupEntity`. ≥6 sites.
- Sites: `NewContactPopup.vue` (onKeydown 151-162), `EditContactPopup.vue` (195-203), `NewFpcPopup.vue` (121-127), `EditFpcPopup.vue` (192-197), `NewTokenPopup.vue` (296-301); + `usePopupEntity.ts` (33-38).
- OUT OF SCOPE (different behavior — global Enter, no focus guard): `NewEndpointPopup`, `EditProfilePopup`, `NewSenderPopup`, `ChangeAuthwitsRegistryPopup`, `RevokeAuthwitsPopup`. Folding these in would change behavior.

### (b) `restoreRows` adoption — 3 clean adopters [DO]
Helper `restore-rows.ts:22-35` (`restoreRows(rows, writeOne)`), already used by contact/fpc/token. Adopt in:
- `auth-registry/service.ts` restore (431-456) — cleanest; mutable-id closure mirrors token restore.
- `account/service.ts` restore (345-390) — keep the pre-loop `collides` throw + `restoreLock` outside the helper; `writeOne` closes over the `seen` Set.
- `transaction/service.ts` restore (505-547) — convert the two `continue`+literal-string branches (`"restored pending transaction rejected"`, `"transaction already exists (hash collision)"`) to `throw new Error(<exact string>)` so `toRestoreError` reproduces them verbatim.
- DEFER (documented — real behavior-preservation blockers): `network/service.ts` (takes `unknown[]`; helper's `TIn extends object` + bare `{...row}` spread would change non-object-row behavior), `config/service.ts` (allowlist `continue` with NO push → result length < input; helper emits one `Restored` per input, cannot express skip).

### (c) id-allocators adoption [DO, partial]
- `preferOrReallocId(storage, sourceId, avoid?)` — NEW helper for the "prefer source id, reroll only on collision" loop hand-rolled 3× (contact/service.ts:259-262, fpc/service.ts:436-439, network/service.ts:737-738). Network's variant has an EXTRA intra-batch `sourceIds` guard (`id !== candidate.id && sourceIds.has(id)`) — the helper takes an optional `avoid: Set<string>` to preserve it. 3 sites.
- Adopt existing `nextRandomId(storage, 64)` in `dapp-session/service.ts:141-144` (plain reroll).
- DEFER: `task/service.ts:47-50` — `this.tasks.has()` is SYNC vs `nextRandomId`'s async `contains()`; adapter not worth it for one site.

---

## Q-08 — hand-rolled keyed-promise-chain FIFO reimplemented 3×

`KeyedLock` — NEW `@nulo/wallet-core/utils` class (sibling to `Lock`) wrapping `Map<string, Lock>` + `withLock(key, fn)` + `delete(key)` (for session-termination eviction). Generalizes the proven `activity-protocol/coordinator.ts:94-101` `lockFor` idiom. [DO]
- Adopt in `coordinator.ts` (scopeLocks + sourceLocks → KeyedLock) — the proven idiom becomes the 1st adopter.
- Migrate `account/service.ts` `serializePerTuple` (180-197) → `keyedLock.withLock(key, op)`; **drop the dead `finally` (190-195)** — its guard is always-false, body is comment-only, and its `void next.finally` spawns a latent unhandled-rejection branch the `next.catch` sibling doesn't cover.
- Migrate `wallet-sdk/background.ts` `decryptQueues` monkeypatch (338-350) → `keyedLock.withLock`; keep the `onSessionTerminated` eviction via `keyedLock.delete(sessionId)`.
- 4 adopters (coordinator ×2 maps counts as the idiom source; serializePerTuple; decryptQueues) — ≥3.
- DEFER (documented): `sessionQueues` (background.ts:240-326) — early-release baton + arrival-time concurrent journal creation (the `concurrent-sendtx` anti-lost-tx invariant, fixed in Arc 4 B-13). Migrating would require an explicit split acquire/early-release AND keep pre-lock journal creation outside the lock — not a plain FIFO. `pendingDiscoveryPromises` is a dedup guard, not a FIFO — excluded.

---

## Q-09 — near-identical N-way method families

### `patchSession(id, mutator)` for dapp-session's 6 setters [DO]
`dapp-session/service.ts` — `updateDappSession` (163-182), `setVerificationHash` (205-214), `setTrustedVerification` (216-225), `setAccountAliases` (227-236), `setCapabilityGrants` (238-247), `setCapabilityRejections` (255-264) all repeat `lock.withLock → get → if(!session) throw "Invalid id" → mutate → set → emit("onDappSessionUpdated")`. Extract a private `patchSession(sessionId, mutate: (s) => void)`; each setter becomes a one-line `mutate` closure. Handles the 3-field `updateDappSession` and the MERGE in `setAccountAliases` (both are just closures). `applyCapabilityDecision` (290-324) stays separate (merges deltas under one lock — different shape).

### DEFER (documented — higher risk, weigh in dual audit):
- token `getTokenInterface`/`parseTokenInterface` 9-way unroll → iterate `TOKEN_FN_DESCRIPTORS` with a parameterized per-kind "pick source" step (the two methods differ in the second half of each pair; parse is wrapped in task/try-catch + pin-check). Real behavior-preservation surface.
- token `addToken`/`addSeededToken` → `persistToken` helper with a PLUGGABLE metadata source (must NOT collapse the seed path's no-refetch TOCTOU fix into a re-fetch).
- network `addEndpoint`/`updateEndpoint` → shared `resolveEndpointWrite` preamble (divergences: push-vs-replace, self-excluding collision predicate, post-write cache eviction).

---

## Q-10 — estimate-reuse caches duplicate stash/evict/validation-ladder [DO — pending codex agreement on 2-site bar]
`transfer-estimate-reuse.ts` + `operation-estimate-reuse.ts`. Only the cache mechanics are byte-identical; the validators diverge in load-bearing ways.
- Extract a generic single-shot TTL store (`SingleShotTtlCache<E>` with `stash`/`evict`/`evictStale` + the `setTimeout` self-delete) — byte-identical across both (transfer 124/131-137/141-143/239-246; operation 94/98-104/108-110/185-190).
- Extract a shared pending-set equality helper (unifies the INCIDENTAL Set-vs-sorted-array divergence: transfer 228-233 uses `Set`, operation 138-145 uses sorted array — same semantics, two impls).
- LEAVE per-caller (do NOT unify): the base-fee check (transfer's try/catch fail-closed + `new GasFees()` re-wrap vs operation's throw-through; `inputs`-vs-`entry` multiplier source), the ladder ORDER (transfer: TTL→input→profile→endpoint→base-fee→pending; operation interleaves fingerprint/chain-identity/FPC and orders base-fee LAST — the colocated tests pin rejection-reason precedence).
- gas-balance-reader.ts is structurally distinct (stale-while-revalidate + eviction generations) — NOT folded in.
- **≥3-site note:** only 2 sites → below the default abstraction bar. Audit-recommended + fixes a real incidental divergence. Present to the dual audit; DEFER if codex rejects.
- Net: both files' colocated tests (`*-estimate-reuse.test.ts`, pinning every `tryConsume` exit) must stay green unchanged.

---

## Q-11 — UI overlay/window shells duplicate markup + CSS

### (a) `DappApprovalFooter.vue` for the 3 approval windows [DO]
`windows/{execute,discover,capabilities}/index.vue` share byte-identical `.wrapper`/`.scroll_area`/`.footer` CSS + a footer template (error-tooltip banner + Reject/Confirm pair). Extract a `DappApprovalFooter` (L3/composite) with props/slots for: reject+confirm labels, testids, `:loading`, the per-window Confirm `:disabled` expression, and the optional Tooltip `wide` attr (execute lacks it; discover/capabilities have it). 3 sites.
- **Testids preserved verbatim** (component emits them via props): `error-text` (all 3), `execute-reject-btn`/`execute-confirm-btn`, `discover-deny-btn`/`discover-allow-btn`, `cap-reject-btn`/`cap-approve-btn`. Reject `:disabled` (`isLoading || !requestId`) is identical across all 3.
- `useDappApprovalWindow` already owns the logic half — untouched.

### (b) `BlockingBarrierFrame.vue` for the 2 barriers [DEFERRED — documented, present to dual audit]
`MigrationBarrier.vue` + `AccountIntegrityBarrier.vue` share byte-identical `.wrapper`/`.card`/`.title`/`.sub`/`.detail` CSS + a Teleport-overlay skeleton. **Deferred** and NOT implemented in this arc: it's a **2-site** extraction (below the default ≥3 bar), pure-visual (no incidental-divergence fix to justify it the way Q-10 had), and touches two security-sensitive blocking overlays whose distinct staleness guards (Migration's `eventTouched` Set-wins-over-snapshot vs Integrity's `refreshGeneration` monotonic counter) must NOT be merged. Q-11's higher-value, ≥3-justified half (the footer) is done. Owned follow-up (2026-08-17): extract a visual-only `BlockingBarrierFrame` (title/sub/detail slots + testid prop) if the dual audit judges the 2-site dedup worth it — testids to preserve: `migration-blocked`/`-detail`/`migration-updating`/`migration-degraded`/`-dismiss`; `account-integrity-blocked`/`-copy`.

---

## Implementation order (lowest-risk first, commit each)
1. Q-07(a) isPopupSubmitKey — pure predicate, 6 adoptions.
2. Q-08 KeyedLock — new class + 3 adoptions + drop dead finally.
3. Q-09 patchSession — 6 dapp-session setters.
4. Q-07(b/c) restoreRows ×3 + preferOrReallocId ×3 + nextRandomId ×1.
5. Q-10 SingleShotTtlCache + pending-set helper.
6. Q-11 DappApprovalFooter + BlockingBarrierFrame (testid-critical).

## Validation per finding
Typecheck (affected package) + the finding's existing colocated tests + new tests for each new helper/class. Full repo typecheck:all + lint + affected suites before the dual audit. `audit:vue` before PR (apps/extension touched).

## Dual audit (codex + fable) over complete arc diff — bounded (initial + max 2 resumes)
_pending._
