---
plan: dedup-p3-service-wrappers
tier: mid
driver: claude-code
code_review: off
eli5_mode: readme-row
worktree: .claude/worktrees/dedup-p3-service-wrappers (branch worktree-dedup-p3-service-wrappers, on top of worktree-dedup-p2-adopt-helpers / PR #566)
ledger: implementations-plan/dedup-ledger (phase P3)
status: approved 2026-09-07 under the ledger README's pre-approval rule — dual audit + final fresh-context codex pass all conditional, every condition adopted below; implementing
---

# P3 — collapse the repeated wrappers in the service and utility layer

Twenty-five ledger findings (D1 D2 D3 D4 G1 C1 C2 C5 C6 F1 F2 F3 E4 E6 B1 B2 B3 B5 A1 A3 H2 H4 X4 I1
I2; **H2 and C2 skipped after audit**, see the decision ledger), all TypeScript below the Vue layer: a wrapper, guard or scan written out N times where one private
helper or one table carries it. ≈−660 net lines, no behaviour change, no new public surface beyond the small helpers named below. Scope is exactly those ids; anything unsafe on contact is skipped and
logged.

## Architecture & Implementation

**Shape of every change**: a helper in the smallest scope that reaches all its call sites — a private
method when the copies share a class, a module-private function when they share a file, a package-local
export only for A3 (test fakes in two packages), C2 (execution coordinator + builder + fee strategies) and
D2 (four repositories in two service folders).

| Id | Helper and home | Contract kept |
|---|---|---|
| D1 | `definePassthroughsExhaustive<Methods>()(ProfileServiceClient.prototype, [...22 names])` + `interface ProfileServiceClient extends MethodsSpec<Methods> {}` with the same `biome-ignore lint/suspicious/noUnsafeDeclarationMerging` directive the other 16 clients carry; `subscribeActiveProfile` stays hand-written | the same 22 RPC names; the factory's type check refuses a missing or extra name |
| G1 | `private call<K extends keyof Methods>(method: K, params: Parameters<Methods[K]>): Promise<ReturnType<Methods[K]>>` in `network/client.ts`, forwarding the RAW `params` to `request` (not zod's copy) | `validateParams` → `request` → `validateResult` with the same per-method schema and label; a new `client.test.ts` pins invalid params → no request, invalid result → throw |
| D2 | two functions, not a class: `decodeRow(schema, raw): { kind: "absent" } \| { kind: "corrupt" } \| { kind: "valid"; value }` in `apps/extension/src/wallet/utils/raw-row.ts`, and `prefixedEntries(all, prefix): Array<[key, id, value]>` exported from `packages/wallet-core/src/storage/prefixed-entries.ts` (shared with A1). Each repository keeps its own single-key reads, presence checks and compare-and-delete beside its audit comments and calls the two functions for the decode and the scan | `isBlocked` stays a raw single-key presence read; `RestorePendingRepository.get` stays tri-state from ONE read; storage failures propagate; no auto-repair |
| D3 | `private async toRecovery(credential): Promise<PasskeyRecovery>` | same calls, same order, same fields |
| D4 | `private async viaPxe<T>(action, fn: () => Promise<T>)` wrapping only the try/catch; `ensureInitialized` and `getNetwork(networkId)` stay outside it at each public method | a missing network keeps its own error (never relabelled "PXE request failed"); log verb and message unchanged |
| C1 | `private recordSentTx(ctx): (hash: string) => Promise<void>` | argument order to `addTransaction` unchanged |
| C2 | **skipped** — an `async` wrapper adds a microtask between the awaited step and `task.complete()`; `execution/mark-failed-unless-cancelled.ts:11-19` records that exact ordering class as a past regression, and `buildNoFrom` completes before building its return value while `sendTxTask` classifies before failing | — |
| C5 | `TRANSFER_FN_BY_TYPE: Record<TransferType, { field; descriptor }>` | `"Transfer type not supported"` / `"Invalid transfer type"` verbatim |
| C6 | module-private `decodeInto(decoded, index, types, values, logger, label)` logging `Array.isArray(values) ? values.length : 0` at all three arms (the utility arm's form); the "arity, never the values" comment moves onto it | log-and-continue, same fields |
| F1 | module-level `safeString(read: () => { toString(): string })` / `safeNumber(read: () => unknown)` | `""` / `0` on throw |
| F2 | local `resolveTokenFns(artifact): Record<TokenFnKind, { candidates; fn }>` iterating `Object.values(TOKEN_FN_DESCRIPTORS)` by `descriptor.kind` (one cast at the accumulator); the `TokenInterface` literal stays explicit | identical descriptor per kind; public shape untouched |
| F3 | `private invalidateAndDelete(id): Promise<void>` — SYNCHRONOUS body: adds the id to `invalidatedBalanceIds` then returns `this.repo.delete(id)` itself (no `async`, so `await` sees the very same promise and no microtask is inserted before the live-token check and emit); at all four sites | every loop keeps its filter, its lock, its epoch fence and decides its emit AFTER the await, as today; a test pins fence-before-delete and promise passthrough |
| E4 | `private stopWatching(handle)` | timeout cleared before the `onRemoved` unsubscribe, both nulled |
| E6 | local `terminateWith(msg): false` inside `handleSessionEstablished` | same source, level and messages |
| X4 | `private startPollScheduler(schedulers: Map<string, Timer>, key, poll: () => Promise<void>, labels: { tick; initial })` — captures the epoch at creation, writes the map BEFORE the initial kick, keeps both messages; the public arm still updates `publicWatched` before calling it | born-at-epoch fence and comments preserved; each arm keeps its own map |
| B1 | two module-private cores with their own comparison: `requireContractsGrant(method, address, flag, grants)` (truthy flag, as today) under `checkRegisterContract` / `checkGetContractMetadata` / `checkIsTokenRegistered`, each keeping its own address extraction (`instance?.address ?? instance` vs `args[0]`); `requireAddressBookGrant(method, grants)` (`=== true`, as today) under the two data checkers | error strings verbatim; `grantsOfType` / `inAddressList` / the no-grant early return unchanged |
| B2 | module-private `deriveRecord(registry, project)` / `deriveSet(registry, project)`; six exported derive functions stay | frozen-oracle outputs identical |
| B3 | `private logDebug/logWarn(msg, ...rest)` on the dispatcher | `"wallet-sdk"` source, same levels, same text |
| B5 | `private requireSession(dappSession, ctx): IDappSessionRef` called exactly where each guard sits today (the `handleSendTx` guard stays AFTER `resolveNetworkAndAccount`); no second lookup | throws before any use, same message, same error precedence |
| A1 | the five scans call `prefixedEntries(await this.storage.get(), \`${this.root}@\`)` yielding `[key, id, value]` (the full key feeds `decodeRow(k, v)`) | five public methods keep their return shapes |
| A3 | `createListenerBag<T>()` in `wallet-core/src/testing/listener-bag.ts` exposing a STABLE `items` array plus `add`, `remove` (first occurrence) and `removeAll`; dispatch loops stay caller-owned over `items` (the fake iterates the live array, the harness iterates a `[...snapshot]`, as today); adopted at the flat sites only | first-vs-all removal and live-vs-snapshot dispatch preserved per site; the bag test covers add/remove during dispatch; test-only |
| H2 | **skipped** — `awaitProfileActivation` rejects at once on a matching `bootstrapFailure`, so a failed bootstrap would enter recovery immediately instead of after the 30 s wait: a failure-path timing change | — |
| H4 | `useFullscreenPopupSetting()` returns `{ showFullscreen, start, dispose }`; `PopupCard.vue` calls `start()` in `onMounted`, `dispose()` in `onBeforeUnmount`; the composable test's host calls them too and a new `PopupCard.test.ts` pins the order | mount/unmount order identical |
| I1 | `waitForStorageRelease({ key, stillHeld: () => Promise<boolean>, timeoutMs, onTimeout, onFinish? })` in `src/e2e/storage-gate.ts`; `stillHeld` resolves TRUE while the gate is still held (restore: `still?.at === at`; proof/incoming: the key is still present) and the helper finishes as released when it resolves false | event-driven release, safety timeout, re-check after subscribe; `onFinish` runs fire-and-forget BEFORE resolve (proof and restore remove their key there, incoming-poll passes none); wrapper-level tests per gate cover matching vs changed hold points |
| I2 | `COMPRESSION_FORMATS` table driving the three lookups | same extensions, mimes and detection aliases |

**Critical flows that must not change**: D2's raw presence reads and tri-state single-key lookup, F3's
epoch fence and delete-before-emit, X4's born-at-epoch check and map-before-kick, B1's two comparisons and
per-checker address extraction, B5's guard placement, D4's network lookup outside the PXE try.

**Alternative considered — risk-tiered split** (the competing outline for the audit): ship the 19
low-risk ids in this arc and hold the six the ledger marks medium (D2, F2, F3, X4, H2, G1) for a follow-up
PR stacked above, so the audited storage codecs, contract introspection, epoch-fenced purge and scheduler,
and the activation-wait swap get a review of their own. Cost: a sixth PR in the owner's queue and one more
CI cycle. The draft keeps a single arc because every medium item is pinned by an existing test file and
the invariants above are explicit; the audits decide whether that is enough.

## Phases

### Phase 1 — packages (A1, A3, B1, B2, B3, B5) ✓

New tests: `listener-bag.test.ts` (first-vs-all removal, add/remove during a caller-owned dispatch); `method-scope-checkers` pins that a non-boolean `addressBook` grant (`"yes"`) is still denied.

**Validation gate**: `bun run lint && bun run typecheck:all && bun run --cwd packages/wallet-core test && bun run --cwd packages/extension-messaging test && bun run --cwd packages/wallet-bridge test`. Pass: exit 0 each. Layers: lint/typecheck + unit.

### Phase 2 — clients and small service helpers (D1, G1, D3, D4, E4, E6, F1, F3, X4) ✓

New tests: `network/client.test.ts` (invalid params → no request; invalid result → throw); `token-balance` pins fence-before-delete and that `invalidateAndDelete` returns the repo's own promise; `incoming-transfer` pins map-before-kick for BOTH scheduler arms (the existing scenario at `service.scenarios.test.ts:2325` covers only the note arm's stale tick). F3 and X4 land as their own commits.

**Validation gate**: `bun run lint && bun run --cwd apps/extension typecheck && (bun run --cwd apps/extension test src/wallet/services/profile src/wallet/services/network src/wallet/services/account-state src/wallet/services/window-manager src/wallet/services/wallet-sdk src/wallet/services/note src/wallet/services/token-balance src/wallet/services/incoming-transfer src/wallet/base)`. Pass: exit 0 each. Layers: lint/typecheck + unit + composition.

### Phase 3 — execution and token introspection (C1, C5, C6, F2)

**Validation gate**: `bun run lint && bun run --cwd apps/extension typecheck && (bun run --cwd apps/extension test src/wallet/services/execution src/wallet/services/token src/wallet/services/fpc)`. Pass: exit 0 each. Layers: lint/typecheck + unit + composition.

### Phase 4 — repositories, composables, utils, e2e seams (D2, H4, I1, I2)

New tests: `components/Popup/PopupCard.test.ts` (start on mount, dispose on unmount); `e2e/storage-gate.test.ts` (release-between-check-and-subscribe race, timeout, `onFinish` before resolve) plus one wrapper case per gate (restore: matching vs changed hold point); `restore-pending-repository` / `blocked-repository` pin one `storage.get(key)` call per lookup. D2 lands as its own commit.

**Validation gate**: `bun run lint && bun run --cwd apps/extension typecheck && (bun run --cwd apps/extension test src/wallet/services/profile src/wallet/services/account-integrity src/wallet/services/backup src/composables src/components/Popup src/e2e src/utils src/popup/pages)`. Pass: exit 0 each; `bun run baseline:complexity` reports no manifest change unless a directive was deleted on merit. Layers: lint/typecheck + unit + component.

### Phase 5 — full local gate

**Validation gate**: from a clean index (`git status --porcelain` empty), `bun run lint && bun run typecheck:all && bun run test && bun run --cwd apps/extension build:chrome && git diff --exit-code --stat HEAD -- apps/extension/src/types/ && test -z "$(git status --porcelain -- apps/extension/src/types/)"`, then the production-marker grep CI runs after the build (`.github/workflows/_build-extension.yml` § bundle hygiene, replicated verbatim against `apps/extension/dist`). Pass: exit 0 each, quoted (the build regenerates `src/types/` and CI asserts it unchanged; the marker grep proves the e2e gate helper stayed out of the bundle). No e2e locally; CI runs smoke and network on the PR.

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
   `invalidatedBalanceIds` 4× (`:408` without an emit, `:523`, `:542`, `:578`); `window-manager.ts` nulls `unsubOnRemoved` 3×; `session-established.ts`
   calls `terminateSession` 4× (three in the log-terminate-return shape); `incoming-transfer/service.ts` has 2 `private start*Scheduler`.
6. wallet-bridge: 16 `Scope violation` strings, 6 exported `derive*`, 7 `"wallet-sdk",` log calls,
   6 `No dApp session found for origin` throws. wallet-core `entity_storage.ts` builds
   `` `${this.root}@` `` 11×, five of them as scans (`:194-268`); the two test fakes splice listeners 6× each.
7. `waitForProfileActive` is referenced only by its own file, `unlockWait.ts`'s doc and
   `popup/pages/import.vue`; `useFullscreenPopupSetting`'s only consumer is `components/Popup/PopupCard.vue`.
8. The three `src/e2e/chrome-storage-*-gate.ts` files each carry a safety timeout; `utils/files.ts` has 3
   switches.

**Inferences — resolved by the audits**
- All 22 profile-client methods are pure forwards: true (`subscribeActiveProfile` is client-side and stays).
- Every `task.fail` catch outside `rpc-cancel.ts` is bare: true except `sendTxTask` (classifies first) — moot, C2 is skipped.
- `completeImportWithRecovery`'s catch ignores the rejection: true, but the earlier rejection on `bootstrapFailure` is itself a timing change — H2 skipped.
- No runtime `TokenFnKind` list; `TOKEN_FN_DESCRIPTORS` (`satisfies Record<TokenFnKind, …>`) is iterated by `descriptor.kind` with one cast.
- `fullscreenPopupSetting.test.ts` pins mount → `getValue` and unmount → `disconnect` through a synthetic host, not through `PopupCard`; the host adopts `start`/`dispose` and a `PopupCard.test.ts` is added.

**Asks** — none open; tier, review setting, delivery and approval are pre-answered in the ledger README.
The one design fork (single arc vs risk-tiered split) is resolved by the audits under the pre-approval
rule, not by the owner.

## Decision ledger

**Outline**: single arc (both auditors). Rejected: the risk-tiered split — a sixth PR buys no coverage the
medium ids lack, and the real risks were design shape (D2, H2, C2), fixed here, not merge order. Focused
commits: D2, F3, X4 and each skipped id's log entry land on their own.

**Skipped ids** (logged in lessons): **H2** — the superset wait rejects immediately on a matching
`bootstrapFailure`, so a failed bootstrap would enter recovery at once instead of after 30 s; a
failure-path timing change under the zero-behaviour-change rule (codex + fable). **C2** — an `async`
wrapper inserts a microtask before `task.complete()`; `mark-failed-unless-cancelled.ts` records that
ordering class as a past regression, `buildNoFrom` completes before constructing its return value and
`sendTxTask` classifies before failing (fable named the tick; codex wanted the restricted set) — the ~40
lines are not worth an unpinned ordering change.

**Reshaped**: D2 from a seven-method class to two functions (fable; codex independently required a
one-read tri-state and raw presence, which the functions leave in the repositories); the scan function is
shared with A1 (fable connected them). B1 split into two cores keeping each pair's own comparison
(truthy vs `=== true`) and `registerContract`'s own address extraction (both). B5 guards stay in place
— hoisting the `handleSendTx` one would change which error a session-less send gets (fable). D4's
`getNetwork` stays outside the try (both). F3 shrinks to the fence-first add + delete pair at four sites,
emit decisions untouched (codex). X4's helper takes the map and writes it before the initial kick (both).
I1 gains `stillHeld` and `onFinish` (both). A3 keeps first-vs-all removal and leaves the keyed maps
(both). C6 adopts the defensive count everywhere (fable). F2 becomes a typed record with one cast (fable
over codex's two maps). G1 forwards raw params and gains a client test (both).

**Unresolved disagreements**: none material. Codex accepted a restricted C2; fable's microtask point
decided it. Codex wanted `RawPrefixedStore` if it exposed one-read state; fable's function shape satisfies
the same constraint with less surface.

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

- **Codex** (`/codex high`, GPT-6 Astra, session `01a07c5f-47c3-76c0-9ea4-db0d61eeb178`): *conditional approve* — skip H2; B1 address extraction and `=== true`; B5 no re-lookup; D2 one-read tri-state and raw presence; C2 restricted set; F3 emit after the await, 4th site; X4 map + order; I1 `isReleased` + settlement callbacks; A3 first-vs-all; add client/PopupCard/listener/gate/scheduler tests; single arc. Every condition adopted or superseded by fable's stricter one (C2 skipped outright).
- **Fable** (`Agent` Plan leg, Fable 5.1; report in `audit-fable.md`): *conditional approve* — B1 two comparisons; B5 no hoist; D2 as functions with a raw single-key read, shared with A1; D4 network outside the try; C2 microtask delta named or dropped; X4 helper owns the map write; H2 logged as a deviation; Facts 5/6 corrected; A1 yields the full key; A3 flat sites only; C6 defensive count; F2 typed record; I1 `stillHeld`/`onFinish`; D1's declaration-merge directive; `cd` chains avoided in gates. Every condition adopted (H2 skipped rather than logged as a deviation).
- **Final fresh-context codex pass** (`/codex high`, new session `01a07c71-bc75-7f10-b79a-c6b0274446f5`): *conditional approve* — F3's helper must be synchronous (an `async` wrapper re-introduces the microtask that excluded C2; reproduced under Bun); I1's `stillHeld` polarity stated explicitly (restore: `still?.at === at`) with wrapper-level tests and `onFinish` before resolve; A3 must keep live-array vs snapshot dispatch (stable `items`, caller-owned loops) with a mutation-during-dispatch test; schedule the X4 both-arms map-before-kick test, the B1 non-boolean address-book denial pin and the D2 single-read pin; build gate from a clean index against `HEAD`, plus the production-marker grep; recon rows for the class-shaped D2, C2 and H2 marked superseded; keep H2 and C2 skipped. Every condition adopted above. Approval follows from the ledger README's pre-approval rule.

## Seeds

The session-level `/goal` in `implementations-plan/dedup-ledger/README.md` drives this phase. For a fresh
session picking up only this phase:

```
/goal All five phases marked ✓ in implementations-plan/dedup-p3-service-wrappers/plan.md, each ✓ backed by its validation gate quoted passing; `LESSONS_FILE=implementations-plan/dedup-p3-service-wrappers/lessons/phase-N.md` printed per phase; `/code-review` NOT run; the codex fix loop converged with a resumed pass reporting no new material findings, quoted; the PR opened via `gh stack submit` on worktree-dedup-p3-service-wrappers with base worktree-dedup-p2-adopt-helpers only after the loop converged, `gh pr checks` all green, no merge command run.
```
