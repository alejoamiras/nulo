---
plan: dedup-p3-service-wrappers
tier: mid
driver: claude-code
code_review: off
eli5_mode: readme-row
worktree: .claude/worktrees/dedup-p3-service-wrappers (branch worktree-dedup-p3-service-wrappers, on top of worktree-dedup-p2-adopt-helpers / PR #566)
ledger: implementations-plan/dedup-ledger (phase P3)
status: drafted 2026-09-07 — dual audit (codex + fable) pending
---

# P3 — collapse the repeated wrappers in the service and utility layer

Twenty-five ledger findings (D1 D2 D3 D4 G1 C1 C2 C5 C6 F1 F2 F3 E4 E6 B1 B2 B3 B5 A1 A3 H2 H4 X4 I1
I2), all TypeScript below the Vue layer: a wrapper, guard or scan written out N times where one private
helper or one table carries it. ≈−740 net lines, no behaviour change, no new public surface beyond four
small helpers named in `recon.md`. Scope is exactly those ids; anything unsafe on contact is skipped and
logged.

## Architecture & Implementation

**Shape of every change**: a helper in the smallest scope that reaches all its call sites — a private
method when the copies share a class, a module-private function when they share a file, a package-local
export only for A3 (test fakes in two packages), C2 (execution coordinator + builder + fee strategies) and
D2 (four repositories in two service folders).

| Id | Helper and home | Contract kept |
|---|---|---|
| D1 | `definePassthroughsExhaustive<Methods>()(ProfileServiceClient.prototype, [...22 names])` + `interface ProfileServiceClient extends MethodsSpec<Methods> {}` | the same 22 RPC names; the factory's type check refuses a missing or extra name |
| G1 | `private call<K extends keyof Methods>(method: K, params: Parameters<Methods[K]>): Promise<ReturnType<Methods[K]>>` in `network/client.ts` | `validateParams` → `request` → `validateResult` with the same per-method schema and label |
| D2 | `RawPrefixedStore<T>` (`apps/extension/src/wallet/utils/raw-prefixed-store.ts`): `key(id)`, `get(id)`, `set(id, v)`, `remove(id)`, `rawIds()`, `validPayloads()`, `corruptIds()` over a `StorageArea`, root and zod schema; each repository becomes a thin wrapper with its current public methods | corrupt rows still count as present (`rawIds` is raw), parse failures still yield `undefined`, no auto-repair |
| D3 | `private async toRecovery(credential): Promise<PasskeyRecovery>` | same calls, same order, same fields |
| D4 | `private async viaPxe<T>(networkId, action, fn: (info) => Promise<T>)` | `ensureInitialized` stays at each public method; log verb and `"PXE request failed"` unchanged |
| C1 | `private recordSentTx(ctx): (hash: string) => Promise<void>` | argument order to `addTransaction` unchanged |
| C2 | `runTaskStep<T>(task, fn)` in `execution/task-step.ts` | `complete()` after `fn` resolves, `fail(error)` then rethrow on reject; only catches of exactly that shape migrate |
| C5 | `TRANSFER_FN_BY_TYPE: Record<TransferType, { field; descriptor }>` | `"Transfer type not supported"` / `"Invalid transfer type"` verbatim |
| C6 | module-private `decodeInto(decoded, index, types, values, logger, label)` | log-and-continue, same log fields |
| F1 | module-level `safeString(read: () => { toString(): string })` / `safeNumber(read: () => unknown)` | `""` / `0` on throw |
| F2 | loop over the kind list into `candidatesByKind` / `fnByKind` maps; the `TokenInterface` literal stays explicit | identical descriptor per kind; public shape untouched |
| F3 | `private async deleteAndInvalidate(row, emitAs: Token \| undefined)` | each loop keeps its filter, its epoch fence and decides `emitAs` itself |
| E4 | `private stopWatching(handle)` | timeout cleared before the `onRemoved` unsubscribe, both nulled |
| E6 | local `terminateWith(msg): false` inside `handleSessionEstablished` | same source, level and messages |
| X4 | `private startPollScheduler(key, poll, label)` | born-at-epoch fence and both comments preserved; initial poll still fired |
| B1 | `contractsAddressChecker(method, flag)` and `addressBookChecker(method)` factories; the five exported checker names stay | error strings verbatim, `grantsOfType`/`inAddressList` semantics unchanged |
| B2 | module-private `deriveRecord(registry, project)` / `deriveSet(registry, project)`; six exported derive functions stay | frozen-oracle outputs identical |
| B3 | `private logDebug/logWarn(msg, ...rest)` on the dispatcher | `"wallet-sdk"` source, same levels, same text |
| B5 | `private requireSession(dappSession, ctx): IDappSessionRef` | throws before any use, same message |
| A1 | `private async scopedEntries(): Promise<Array<[id, unknown]>>` | five public methods keep their return shapes |
| A3 | `createListenerBag<T>()` in `wallet-core/src/testing/listener-bag.ts` (exported from `testing/index.ts`); the messaging harness wraps it as `{ addListener, removeListener }` | same add/remove semantics; test-only |
| H2 | delete `waitForProfileActive.ts` + its test; `import.vue` calls `awaitProfileActivation(appStore, id, ms)` | the third signal (`bootstrapFailure`) now also rejects, which is what `auth.vue` already relies on |
| H4 | `useFullscreenPopupSetting()` returns `{ showFullscreen, start, dispose }`; `PopupCard.vue` calls `start()` in `onMounted`, `dispose()` in `onBeforeUnmount` at the same points | mount/unmount order identical |
| I1 | `waitForStorageRelease(key, { timeoutMs, onTimeout })` in `src/e2e/storage-gate.ts` | event-driven release, safety timeout, re-check after subscribe |
| I2 | `COMPRESSION_FORMATS` table driving the three lookups | same extensions, mimes and detection aliases |

**Critical flows that must not change**: D2's "corrupt row still blocks" reads (`rawIds()` vs
`validPayloads()`), C2's catch shapes (none of the migrated catches may call `maybeRethrowAsRpcCancel`),
F3's epoch fence, X4's born-at-epoch check, B1/B5's fail-closed throws.

**Alternative considered — risk-tiered split** (the competing outline for the audit): ship the 19
low-risk ids in this arc and hold the six the ledger marks medium (D2, F2, F3, X4, H2, G1) for a follow-up
PR stacked above, so the audited storage codecs, contract introspection, epoch-fenced purge and scheduler,
and the activation-wait swap get a review of their own. Cost: a sixth PR in the owner's queue and one more
CI cycle. The draft keeps a single arc because every medium item is pinned by an existing test file and
the invariants above are explicit; the audits decide whether that is enough.

## Phases

### Phase 1 — packages (A1, A3, B1, B2, B3, B5)

**Validation gate**: `bun run lint && bun run typecheck:all && bun run --cwd packages/wallet-core test && bun run --cwd packages/extension-messaging test && bun run --cwd packages/wallet-bridge test`. Pass: exit 0 each. Layers: lint/typecheck + unit.

### Phase 2 — clients and small service helpers (D1, G1, D3, D4, E4, E6, F1, F3, X4)

**Validation gate**: `bun run lint && bun run --cwd apps/extension typecheck && (cd apps/extension && bun --bun vitest run src/wallet/services/profile src/wallet/services/network src/wallet/services/account-state src/wallet/services/window-manager src/wallet/services/wallet-sdk src/wallet/services/note src/wallet/services/token-balance src/wallet/services/incoming-transfer src/wallet/base)`. Pass: exit 0 each. Layers: lint/typecheck + unit + composition.

### Phase 3 — execution and token introspection (C1, C2, C5, C6, F2)

**Validation gate**: `bun run lint && bun run --cwd apps/extension typecheck && (cd apps/extension && bun --bun vitest run src/wallet/services/execution src/wallet/services/token src/wallet/services/fpc)`. Pass: exit 0 each. Layers: lint/typecheck + unit + composition.

### Phase 4 — repositories, composables, utils, e2e seams (D2, H2, H4, I1, I2)

**Validation gate**: `bun run lint && bun run --cwd apps/extension typecheck && (cd apps/extension && bun --bun vitest run src/wallet/services/profile src/wallet/services/account-integrity src/wallet/services/backup src/composables src/components/Popup src/e2e src/utils src/popup/pages)`. Pass: exit 0 each; `bun run baseline:complexity` reports no manifest change unless a directive was deleted on merit. Layers: lint/typecheck + unit + component.

### Phase 5 — full local gate

**Validation gate**: `bun run lint && bun run typecheck:all && bun run test`. Pass: exit 0 each, quoted. No e2e locally; CI runs smoke and network on the PR.

## Security & Adversarial Considerations

- **Threat surface unchanged**; every change is a call-site substitution. The attack-relevant ones:
- **B1 scope checkers** gate dApp RPCs against granted capabilities. The factories keep the same
  `grantsOfType` narrowing, the same "no caps of this type → allow" early return, the same `some(...)`
  predicate and the same error text; `scope-enforcement.test.ts` and the dispatcher tests assert them.
- **B5** must keep throwing before any property of the missing session is read.
- **D1** exposes the same 22 RPC names — an exhaustive list, so no method is silently dropped or added.
- **G1** keeps per-method zod validation on both directions; the generic helper looks the schema up by
  the same key.
- **D2** is the audited fail-closed storage: a corrupt tombstone still reserves its id, a corrupt block
  still blocks. The shared codec never repairs or deletes; wrappers keep reading the raw id set.
- **I1** helpers stay under `src/e2e/` (test-only seams; the build's negative grep keeps them out of
  production).
- **Supply chain**: no dependency added or bumped.

## Assumptions

**Facts (verified in the worktree)**
1. `profile/client.ts` has 22 `return this.request(...)` forwards; 16 of the 23 `client.ts` files use
   `definePassthroughsExhaustive`.
2. Four repository classes across three files hand-roll the prefixed-row codec.
3. `passkey-recovery-coordinator.ts` repeats the recovery tail 4×; `account-state/service.ts` throws
   `"PXE request failed"` 5×; `network/client.ts` calls `validateParams(NetworkMethodSchemas…` 16×.
4. `dapp-send-executor.ts` has 2 `recordTransaction: async` closures; `task.fail(` appears 3× in
   `execution-coordinator.ts`, 2× in `tx-request-builder.ts`, 5× across `fee/*-strategy.ts`, 2× in
   `rpc-cancel.ts` (excluded).
5. `operation-planner.ts` has 4 `case TransferType.` arms; `batched-view-simulation.ts` logs
   `Failed to decode` 3×; `note/service.ts` has 8 `private safe*`; `token/service.ts` has 9
   `FnCandidates = getTokenFnCandidates` pairs; `token-balance/service.ts` adds to
   `invalidatedBalanceIds` 3×; `window-manager.ts` nulls `unsubOnRemoved` 3×; `session-established.ts`
   calls `terminateSession` 4×; `incoming-transfer/service.ts` has 2 `private start*Scheduler`.
6. wallet-bridge: 16 `Scope violation` strings, 6 exported `derive*`, 7 `"wallet-sdk",` log calls,
   6 `No dApp session found for origin` throws. wallet-core `entity_storage.ts` builds
   `` `${this.root}@` `` 5×; the two test fakes splice listeners 6× each.
7. `waitForProfileActive` is referenced only by its own file, `unlockWait.ts`'s doc and
   `popup/pages/import.vue`; `useFullscreenPopupSetting`'s only consumer is `components/Popup/PopupCard.vue`.
8. The three `src/e2e/chrome-storage-*-gate.ts` files each carry a safety timeout; `utils/files.ts` has 3
   switches.

**Inferences (unverified — the audits should attack these)**
- All 22 profile-client methods are pure forwards (no argument or result transformation).
- Every `task.fail(error); throw error` catch outside `rpc-cancel.ts` has exactly that shape and does not
  call `maybeRethrowAsRpcCancel`.
- `import.vue`'s catch around `waitForActive` does not depend on the rejection's message text or class.
- A runtime list of `TokenFnKind` exists (or `Object.keys(TOKEN_FN_DESCRIPTORS)` equals it).
- `fullscreenPopupSetting.test.ts` pins the mount/unmount order that H4 must preserve.

**Asks** — none open; tier, review setting, delivery and approval are pre-answered in the ledger README.
The one design fork (single arc vs risk-tiered split) is resolved by the audits under the pre-approval
rule, not by the owner.

## Decision ledger

_(filled after the dual audit: chosen outline, rejected alternatives with reasons, unresolved disagreements)_

## Post-implementation

1. `code_review` is `off`: `/code-review` is NOT run.
2. **Codex audit** (`/codex high`, GPT-6 Astra): the net diff `git diff worktree-dedup-p2-adopt-helpers...HEAD -- . ':!implementations-plan'`,
   this plan with its decision ledger, `recon.md`, the ledger rows, an adversarial/security ask, and —
   verbatim — *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
   extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem.
   If code works and is clear, leave it alone."* and *"Audit the comments for value per character. Flag any
   comment that narrates what the code visibly does, restates its line, references implementation plans /
   phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious
   invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future
   reader, human or LLM, pays to re-read: they must be few, dense, and exact."* Tell codex not to run the
   vitest e2e configs.
3. **Fix loop**: verify each claim against the tree, apply accepted fixes, commit, log the round in
   `lessons/phase-N.md`, RESUME the same codex session with the fix diff; repeat until a round reports no
   new material findings (quote it). Still material after 3 rounds → surface and hold.
4. **Delivery** below — the first and only time a PR is opened for this phase.

## Delivery

Single arc = this branch, one PR stacked on P2 (#566): `gh stack submit --auto --open` from this
worktree, then `gh pr edit <n>` with the ledger title `refactor(services): collapse the repeated wrappers in the service and utility layer`
and a body listing ids addressed, ids skipped with reasons, net LOC, the Phase 5 gate output and the codex
rounds. Then `gh pr checks <n> --watch`; red = flake → re-run once, red again → fix or hold. Green → README
row P3 = `open #<n> · green`, `agent-worktree status`, print
`LESSONS_FILE=implementations-plan/dedup-p3-service-wrappers/lessons/phase-5.md`. **Never merge.**

## Audit log

_(codex + fable verdicts, adopted / rejected findings, then the final fresh-context codex pass)_

## Seeds

The session-level `/goal` in `implementations-plan/dedup-ledger/README.md` drives this phase. For a fresh
session picking up only this phase:

```
/goal All five phases marked ✓ in implementations-plan/dedup-p3-service-wrappers/plan.md, each ✓ backed by its validation gate quoted passing; `LESSONS_FILE=implementations-plan/dedup-p3-service-wrappers/lessons/phase-N.md` printed per phase; `/code-review` NOT run; the codex fix loop converged with a resumed pass reporting no new material findings, quoted; the PR opened via `gh stack submit` on worktree-dedup-p3-service-wrappers with base worktree-dedup-p2-adopt-helpers only after the loop converged, `gh pr checks` all green, no merge command run.
```
