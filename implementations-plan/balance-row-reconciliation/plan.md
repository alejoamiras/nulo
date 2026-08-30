# balance-row-reconciliation — a token with no balance row is invisible forever

**Tier:** `mid` — escalated from `light` after recon (see Tier call). **`eli5_mode`:** Artifact.
**Budget:** recon 2 agents (spent) · competing outline + codex/fable dual audit + final fresh codex pass · `/code-review` **medium** · codex fix loop ≤3 rounds.
**Base:** `origin/dev` @ `23228d1d` (the merged #485 seeding fix). **Worktree/branch:** `balance-row-reconciliation` / `worktree-balance-row-reconciliation`.
**Owner standing preference:** the most durable, testable, modularized solution — not the smallest hack. All open questions routed to codex, not the owner.

## Problem

`TokenBalanceService` creates balance rows in exactly two event handlers — `onAccountAdded` (`service.ts:276-282`) and `onTokenAdded` (`:284-301`). Neither `init()` (`:127-134`) nor `onActiveProfileChanged` (`:255-274`) reconciles; both only rebuild the in-memory `this.tokens` map.

The assets view reads balance **rows**, filtered to the active account (`TokensView.vue:309` → `getTokenBalances(undefined, account.address)`), and hides any row whose token isn't in the map (`service.ts:156`). So a token with no balance row is **invisible**, and nothing ever repairs it.

An MV3 worker death between the token row landing and the backfill completing produces exactly that. It is the residual tail of #485: after seeding persists a default token, `onTokenAdded` fires un-awaited (`base-service.ts:129-133`); a worker death before its loop finishes leaves the token permanently invisible — the same symptom the owner originally reported, by another route.

## Tier call (escalated)

Rubric after recon: novelty **low** (five repair precedents), migration cost **none**, external coupling **low**, security **low**, irreversibility **low-med** (rows are derived, but a wrong *cleanup* deletes real user-visible state), **blast radius HIGH** — this runs on every service-worker wake for every user, and recon found a *pre-existing silent row-loss path* in the same allocation code the reconcile would exercise more often.

1 HIGH → `mid`. The escalation is on recon's evidence, not on scope creep: the naive design is wrong in six specific ways (`recon.md`), and two of the brief's own premises were false. A competing outline plus a dual audit is proportionate to changing a boot path that every user hits.

## Open questions — all routed to codex (Assumptions §Asks)

1. **Scope.** Reconcile only, or also fix the two adjacent defects recon found: (a) concurrent id allocation silently overwriting rows, (b) `onAccountDeleted` having no subscriber so imported-account removal orphans rows that can silently reattach on re-import? (a) is arguably *inside* scope because the reconcile adds a third concurrent creator.
2. **Awaited vs detached.** Run the pass inside `init()` awaited (guarantees no gaps before the first read, but adds to boot latency on a path every SW wake pays) or fire-and-forget per `account-integrity/coordinator.ts:73-84`? Recon notes detached re-introduces races with in-flight purge cascades.
3. **Serialization.** Introduce a `Lock` in `TokenBalanceService` (matching `TokenService.persistToken`'s `lock.withLock` around `nextNumericId`), or keep the pass strictly sequential and leave the existing two-handler race as-is?
4. **E2E shape.** Build a 4th rendezvous-gate instance to park the SW precisely between token persist and balance backfill (the `restore-gate`/`incoming-poll-gate`/`proof-gate` family), or use a cheaper, more durable construction — seed the gap directly into `chrome.storage.local`, restart the worker, assert recovery — which tests the *reconcile* rather than the *race that produces the gap*?
5. **Direction.** Create-only, or also delete rows for pairs that shouldn't exist? Recon argues create-only: restore-order gaps, foreign-profile rows, and draining chain-purges all make rows legitimately "unexplained".
6. **Tier.** Confirm `mid`, or is `light` still right?

## Architecture & Implementation — Outline A (chosen draft)

**A private, idempotent, create-only pass on `TokenBalanceService`, run from the two places that already rebuild the token map.**

```ts
/** Rows missing for live (token, account) pairs — the gap an MV3 death between
 *  a token write and its backfill leaves behind. Create-only: an unexplained
 *  row may be a restore-order gap or a foreign profile's, never garbage. */
private async reconcileBalanceRows(profileId: string, gen: number): Promise<void>
```

- **One batched read, then in-memory work.** `repo.getAll()` once → `Set<`${token}:${account}`>`; one `getAccounts(profileId, chainId, true)` per distinct chainId present in `this.tokens`. Never `existsByTokenAndAccount` per candidate — every `getAll`/`getKeys`/`getAccounts` reads the whole `chrome.storage.local` namespace and filters client-side (`entity_storage.ts:8-10,194-224`), so a per-pair check multiplies a full-store read by the pair count.
- **`all: true`, always.** Hidden accounts keep rows on purpose (`recon.md` disproved premise 1); the visible-only default would under-create.
- **Chain join is explicit.** Pair only where `token.chainId === account.chainId` — `TokenBalanceRaw` carries neither `chainId` nor `profileId` (`spec.ts:30-38`).
- **Creation routes through the existing `createTokenBalance(token, account, gen)`** (`:215-234`) — inherits id allocation, the generation re-check with no await gap before the write, the `onTokenBalanceAdded` emit, and the queue enqueue. No re-derivation.
- **Strictly sequential** (`for … await`), never `Promise.all`: `allocateUnfencedId` is a lock-free read-then-compute, so parallel allocation collides and the later `repo.set` silently overwrites (`recon.md` §1).
- **Call sites**: `init()` between the token-map hydration (`:132`) and `queue.start()` (`:134`), and the tail of `onActiveProfileChanged` (`:274`). `enqueue()` has no dependency on `queue.start()` having run, so pre-start enqueues drain on the first tick — the ordering is free.
- **Failure-isolated**, per `account/service.ts:118-122`: its own try/catch, logged, never able to wedge service start.
- **`Debug`-level elapsed-ms log**, matching `balance-job-queue.ts:152-167` and `transaction/service.ts:377` — the repo's only cost convention.

**Modularity.** The pair-diff is pure and belongs in its own module — `token-balance/reconcile-pairs.ts`, exporting `missingBalancePairs({ tokens, accountsByChain, existing })` returning the ordered `(token, account)` list. No `chrome.*`, no repo, no service: directly unit-testable over hostile inputs, and the service method becomes read → diff → sequential create.

### File-level change map (draft)

| File | Change |
|---|---|
| `token-balance/reconcile-pairs.ts` | **new** — pure diff, no I/O |
| `token-balance/reconcile-pairs.test.ts` | **new** — table-driven over the six wrongness cases in `recon.md` |
| `token-balance/service.ts` | `reconcileBalanceRows` + two call sites + elapsed-ms log |
| `token-balance/service.test.ts` | extend the `:247-422` generation-fence describe: creates missing rows; creates nothing when complete; bails on a mid-flight profile switch |
| e2e (shape pending Open question 4) | a spec proving a token with no balance row becomes visible after a worker restart |

### Trade-offs / alternatives not taken (in Outline A)

- **Cleanup (delete) direction** — rejected for now; see Open question 5.
- **A new epoch/lock of its own** — rejected; `profileGeneration` is the established fence, pinned by six existing tests.
- **Reconcile on every `onAccountAdded`/`onTokenAdded` too** — rejected as redundant; those handlers already create what they need.

## Architecture & Implementation — Outline B (competing, for the audit)

**Make the gap unrepresentable instead of repairing it: give `BalanceRepository` an idempotent `ensureRow(token, account)` and have every creator call it.**

Rather than a boot pass that diffs, push the invariant down into the repository: `ensureRow` does a keyed existence check and allocates only on miss, under a new `Lock` owned by the repository so allocation is serialized by construction. `onAccountAdded`, `onTokenAdded`, and a thin boot sweep all call it; the boot sweep becomes a trivial loop with no diff logic because `ensureRow` is idempotent.

- **Wins:** kills the concurrent-allocation row-loss bug (Open question 1a) at its source rather than working around it; removes the "must be strictly sequential" footgun from every future caller; the idempotency is one testable unit.
- **Costs:** a keyed existence check per pair is a full-store read unless `BalanceRepository` gains an index; touches the two live handlers (larger blast radius than a purely additive pass); introduces a lock where none exists today.
- **Why not chosen as the draft:** it is the more durable shape and matches the owner's stated preference, but it converts an additive change into a modification of the two hot paths — exactly the kind of trade the audit should rule on rather than the author.

## Security & Adversarial Considerations

- **Threat model.** No new trust boundary: no new RPC surface, no new storage key, no network I/O, no user input. The pass reads rows already present and writes rows the two live handlers would have written.
- **Hostile stored state.** `repo.getAll()` returns rows from the shared `chrome.storage.local` namespace including other profiles'. The diff must key strictly on ids drawn from the active profile's token map, never on anything a foreign row asserts about itself. `TokenBalanceRaw` has no `profileId` to trust in the first place.
- **Denial-of-repair.** A malformed row that fails the read codec is invisible to `getAll()`, so the pass would recreate its pair — producing a duplicate at a new id alongside a codec-hidden original. Whether that is acceptable (the original is unreadable anyway) or must be detected via the raw key space (as `purgeMalformedRows` does, `purge-rows.ts:58-84`) is an audit question.
- **Resource exhaustion.** Rows scale as tokens × accounts with no cap on either (`recon.md`). A profile with many of both makes every SW wake pay a full-store read plus a per-chain account read. Bounded and measured, but the budget belongs in the audit.
- **Supply chain / crypto:** untouched. No dependencies, no lockfile change, no key material.

## Assumptions

### Facts (verified at `23228d1d`)

1. Balance rows are created only in `onAccountAdded` (`service.ts:276-282`) and `onTokenAdded` (`:284-301`), both via `createTokenBalance` (`:215-234`).
2. Neither `init()` (`:127-134`) nor `onActiveProfileChanged` (`:255-274`) reconciles; both only rebuild `this.tokens`.
3. `getTokenBalances` hides any row whose token is absent from `this.tokens` (`:156`); `getTokenBalanceInfo` throws `"unknown token"` on a map miss (`:238-241`), reachable from the singular `getTokenBalance(id)` RPC (`:137-144`).
4. `createTokenBalance` writes unconditionally — no existence check (`:215-228`) — so a diff-free loop would duplicate rows.
5. `allocateUnfencedId` (`:211-213`) is lock-free; `EventHandler.invoke` (`event-handler.ts:47-61`) and `Service.emit` (`base-service.ts:129-133`) dispatch async subscribers un-awaited. The two live handlers are safe only by sequential `await` in a `for` loop (`:280`, `:299`).
6. `enqueue()` (`balance-job-queue.ts:128-134`) is synchronous and independent of `queue.start()` (`:83-86`), which only subscribes to the ticker.
7. Every `getAll`/`getKeys`/`getAccounts` reads the entire `chrome.storage.local` namespace and filters client-side (`entity_storage.ts:8-10,194-224`; one shared adapter at `chrome-browser-api.ts:69`).
8. `getAccounts(profileId, chainId, all)` filters `… && (all || x.visible)` (`account/service.ts:160-173`); `onTokenAdded` passes `all: true` (`service.ts:295`).
9. `TokenBalanceRaw` has no `chainId` and no `profileId` (`spec.ts:30-38`).
10. `footprint-coverage.test.ts` governs migrations only; `TOKEN_BALANCE_STORAGE_ROOT` is already registered (`backup-migration-registry.ts:205`) — no new registration needed.
11. `TokenBalanceService` has no `onAccountDeleted` subscriber (`:120-125`).
12. No `Lock`/`KeyedLock` exists in `TokenBalanceService`; `TokenService.persistToken` uses one around `nextNumericId` (`token/service.ts:279,298`).

### Inferences (unverified — attack these)

1. **Create-only is safe and sufficient** to restore visibility. Assumes no scenario where a *stale* row (right pair, wrong data) is the failure rather than a missing one.
2. **The steady-state cost is acceptable**: one full-store read plus one `getAccounts` per chain per SW wake, with zero writes in the common case. Unmeasured.
3. **A strictly sequential loop is sufficient serialization** without a lock, because the pass runs at init before events can interleave and at the tail of a profile switch. Recon shows this holds for `init()` (awaited before RPCs) but is weaker on the switch path.
4. **The pure-diff module is the right seam** — that `missingBalancePairs` can be expressed without needing repo or chrome access.

### Asks — the six Open questions above, all routed to codex.

## Phases

*(Phase content is provisional pending the audit's rulings on Open questions 1-5; validation gates are already concrete.)*

### Phase 1 — Pure diff module

`reconcile-pairs.ts` + colocated table-driven test covering: cross-chain pairs excluded, hidden accounts included, duplicate-pair inputs, empty inputs, a row whose token is absent from the map, and ordering determinism.

**Validation gate.** `bun run lint && bun run typecheck && bun run --cwd apps/extension vitest run src/wallet/services/token-balance/`. Pass: exit 0. Layers: lint · typecheck · unit.

### Phase 2 — Service wiring

`reconcileBalanceRows` + the two call sites + the elapsed-ms log. Extend the generation-fence describe block: creates missing rows; creates **nothing** when state is complete (the test that proves it stays cheap); bails cleanly on a mid-flight profile switch.

**Validation gate.** Same commands as Phase 1 plus `bun run --cwd apps/extension vitest run src/wallet/services/`. Pass: exit 0; the no-op test asserts zero `repo.set` calls. Layers: lint · typecheck · unit.

### Phase 3 — E2E

Shape per Open question 4. Must fail without the reconcile and pass with it — recorded red/green in `lessons/phase-3.md`, as #485 did.

**Validation gate.** `bun run e2e:agent tests/e2e/network/<spec>.test.ts` (or the smoke equivalent if the audit picks that shape), plus the documented pre-fix red run. Layers: e2e.

### Phase 4 — Regression sweep + docs

`bun run audit:vue`, both smoke modes (armed source + unarmed artifact — see #485's `lessons/phase-4.md` for why the default command exercises neither), and the full network suite. Docs: `ARCHITECTURE.md` if the balance-row lifecycle description changes.

**Validation gate.** `bun run audit:vue` · armed source smoke · unarmed artifact-mode smoke · `NULO_E2E_PROVERLESS=1 bun run e2e:agent`. Pass: all exit 0.

## Delivery

**Single arc, single PR** → `dev`, plain `gh pr create`. `/code-review` level **medium**. Provisional title (≤93 chars): `fix(balances): reconcile missing token-balance rows on boot and profile switch`

## Post-implementation

1. **`/code-review medium --fix`** on the net diff; skim; commit separately from implementation commits.
2. **Codex audit** (`/codex xhigh`): net diff + code-review commit summary + this plan.md + decision ledger + adversarial/security ask + both rules below verbatim.
   - *No over-engineering:* "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - *Comment quality:* "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
3. **Iterative fix loop.** Verify each claim against the repo, apply, commit, log the round in `lessons/`, then RESUME the same codex session with the fix diff. Loop until a round yields no new material findings; surface and stop if still material after 3.
4. **Delivery.** Only now: `gh pr create --base dev`, then `gh pr checks --watch` until `quality-status`, `smoke-e2e-status` and `network-e2e-status` are green. Re-run genuine flakes; fix real breakage; never weaken a gate. Update `implementations-plan/index.md`.

**Post-implementation hardening:** no `/harden` pass — no new trust boundary.

## Decision ledger

*(filled from the audits)*

## Audit verdicts

*(pending — codex `xhigh` + fable subagent)*
