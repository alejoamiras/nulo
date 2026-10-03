---
plan: harden-dedupe / dapp-grant-planning (arc 6 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/06-dapp-grant-planning, stacked on harden-dedupe
---

# dapp-grant-planning: one typed grant reader, one sender rule, consent planning out of the dispatcher

Findings Q-19, Q-01 (c) and the non-widening part of Q-11, from `audit/quality/2026-09-30-dedup-high/`, in that order. This is the dApp consent path: every method name, argument, manifest, batch leg and `opts.from` below is attacker-controlled. For every request shape, the set of requests refused, the order in which checks refuse, and the error class and message a dApp's request ends with stay byte-identical. The batch refusal set stays exactly `{sendTx, registerToken}`.

## Outcome & Quality Bar

- **For whom:** the next person who changes what a grant covers or how a sender is named. Today "does this grant reach that call" is written twice in `wallet-bridge` (consent coverage and enforcement), the NO_FROM rule three times across two packages, and 550 lines of pure consent planning share `dispatcher.ts` (1,802 lines) with routing and handlers.
- **Excellent:**
  - Coverage and enforcement read grants through one typed `grantsOfType`. Coverage keeps its own match expressions, which mirror enforcement's clause for clause, because a malformed stored element must keep throwing the same text (Decisions, code review round 1).
  - The sender a request names is computed by one function, used where the journal files the request and where the dispatcher sends it.
  - The batch refusal set is a registry fact, pinned behaviourally over every registry method.
  - `dispatcher.ts` loses the pure planning block to `capability-negotiation.ts`, moved byte-for-byte.
  - A characterization suite, green on today's code and frozen before the refactor, pins every refusal, its order and its exact error for the coverage, enforcement, sender and batch paths, with wire-shaped values.
- **Good enough:** the popup handlers keep their own scaffolds, the three coverage predicates keep their own expressions (see Decisions), and the enforcement-only empty-name guard stays where it is.

## Architecture & Implementation

Lines read 2026-10-03 on `harden-dedupe` at `61260efc`. "Guard set" means every condition that can refuse or decide, in evaluation order.

### Q-19: one typed grant reader; coverage keeps its expressions

The typed `grantsOfType` in `packages/wallet-bridge/src/method-scope-checkers.ts` gains `export` and replaces the dispatcher's copy. The plan also had coverage call enforcement's matchers; code review round 1 reverted that (see Decisions), so `matchesPattern` and `inAddressList` stay private and the three coverage predicates keep their expressions, each with one line saying why. No new module: `method-scope-checkers.ts` is already the leaf `dispatcher.ts` imports, and the package entry re-exports only five named members of it (`src/index.ts:25-31`).

| site | today | guard set (unchanged after) | after |
|---|---|---|---|
| `matchesPattern` `checkers:38-43` | private | contract: pattern `"*"`, else `sameFieldAddress(pattern, call)`; then function: pattern `"*"`, else `===` | untouched, stays private (code review round 1) |
| `matchesScope` `checkers:45-55` | private | `fn === ""` refuses first, then scope `"*"`, then any pattern | untouched, stays private: the empty-name guard stays enforcement-only |
| `inAddressList` `checkers:57-60` | private | list `"*"`, else any `sameFieldAddress(String(item), address)` | untouched, stays private (code review round 1) |
| `grantsOfType` `checkers:62-64` and `dispatcher:692-694` | two copies, one untyped | `filter(type ===)` then `map(capability)` | one, the typed `<K extends Capability["type"]>` form, exported from checkers; the 12 checker calls (`:76, 101, 118, 136, 153, 182, 199, 225, 226, 273, 328, 356`) drop their explicit type argument (type-only) |
| `scopeCovers` `dispatcher:225-235` | inline copy of the pattern rule | existing `"*"` covers; requested `"*"` is covered only by `"*"`; each requested pattern needs ONE existing pattern matching contract then function | **unchanged** (code review round 1). A held `scope: [null]` throws `null is not an object (evaluating 'ep.contract')` on Bun; through `matchesPattern` it read `pattern.contract`. One line says why the expression stays |
| `contractsRequestCovered` `dispatcher:210-219` | inline address-list copy | per flag: unflagged request covered; requested `"*"` needs a flagged `"*"` grant; else every address needs a grant with the flag AND a listing | **unchanged.** A held grant whose `contracts` is a truthy non-array throws `TypeError: e.contracts.some is not a function` today; through `inAddressList` the text would read `list.some`. Such a grant is storable (see Security), so the expression stays, with one line saying why, and Phase 1 pins its error |
| `privateEventsCovered` `dispatcher:269-278` | inline address-list copy | no request covered; `"*"` needs a held `"*"`; else every address needs a held list that is `"*"` or an ARRAY containing it | **unchanged** (code review round 1), plus one line saying an address-book-only grant legitimately has no list and one on why the expression stays. A held element `String()` cannot convert throws `can't convert x to string` on Firefox; through `inAddressList` it read `item` |

Argument order into `sameFieldAddress` is unchanged at every site (grant side first), and the function is symmetric anyway (`field-address.ts:26-29`). The `scopeCovers` comment that coverage mirrors enforcement's single-capability shape stays.

### Q-01 (c): one sender rule in `account-resolution.ts`

`packages/wallet-bridge/src/account-resolution.ts` already holds the one "which account a request acts as" rule both sides call. It gains:

- `isNoFromRequest(from: unknown): boolean`: `from === "NO_FROM"` (the literal in a module-private const).
- `requestedSenderOf(opts: unknown): string | undefined`: reads `opts?.from`; `undefined` when it is `== null` or NO_FROM, else `String(from)`. Its TSDoc carries the reason now at `queued-journal.ts:75-83`: a stricter rule on one side files a request under one account and sends it from another.

| site | guard set today | after |
|---|---|---|
| `dispatcher.ts:191-193` `isNoFromRequest`, `:198-200` `requestedFromOf` | `from === "NO_FROM"`; then NO_FROM or `== null` → none, else `String(from)`; input `args[1] ?? {}` | deleted; imported from `./account-resolution` |
| users `dispatcher.ts:1118` (entrypoint + opts), `:1123` (sendTx sender), `:1622` (simulateTx/profileTx sender via `FROM_ADDRESSED_KINDS`) | as above | same calls, `requestedFromOf` renamed `requestedSenderOf`; `:1118` keeps `isNoFromRequest`, so only the exact sentinel switches to `default_entrypoint` (a `null` `from` stays standard) |
| `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:84-89` `extractSendFrom` | `args?.[1]?.from`; `== null` or `"NO_FROM"` → none, else `String(from)` | deleted (no other caller); `:153` passes `requestedSenderOf((message as { args?: unknown[] }).args?.[1])`, imported from `@nulo/wallet-bridge` beside `resolveAuthorizedSessionAccount` (`:31`) |
| `apps/extension/src/wallet/services/execution/utils/fee-detection.ts:15-20` `isNoFromRequest` | `from === "NO_FROM"` | deleted: no caller outside its own test, whose import (`fee-detection.test.ts:3`) and block (`:58-70`) go with it |

Every input maps identically: `args[1]` nullish gives `{}` on one side and `undefined?.from` on the other, both `undefined`; a primitive `args[1]` has no `from` on either; `String()` coerces the same values, and throws the same `TypeError` for an object whose `toString` is not callable. The wire is JSON, so no getter makes the changed property-read count observable. Account matching after normalization is untouched: `resolveAuthorizedSessionAccount` compares the exact string (`account-resolution.ts:54`). The playground's stale pointer (`apps/playground/src/sections/transactions.ts:109`, "dispatcher.ts:82-88") becomes one sentence naming the behaviour, not a line.

### Q-11, the non-widening part

1. **Batch refusal from the registry.** `MethodDescriptor` (`method-descriptors.ts:94-108`) gains `refusedInBatch?: true`, set on `sendTx` (`:279-284`) and `registerToken` (`:207-215`) only. Its TSDoc says it is named for the refusal, not for popup routing, so marking a new popup method never widens the set by itself. `BATCH_REFUSED_METHODS: ReadonlySet<string>` is derived beside the other tables with the existing `deriveSet` (`:335-342`), which walks `Object.entries`, so no attacker-supplied name ever indexes the registry. `handleBatch`'s pre-scan (`dispatcher.ts:1089-1093`) becomes `if (BATCH_REFUSED_METHODS.has(method.name)) throw new Error(...)` with today's template literal unchanged, em dash included. `argsBatch` (`:141-145`) has already proved every leg name a string, so `Set.has` equals the two `===` tests. The comment at `:1079-1088` keeps the raw-protocol-client reason and drops the sentence naming the two methods.
2. **Inline `unwrapResult`.** The private wrapper (`dispatcher.ts:1799-1801`) is deleted; its six callers (`:859, 1154, 1200, 1212, 1258, 1311`) call `unwrapOperationResult`, the function it delegates to.
3. **Move the planning block.** `dispatcher.ts:207-752` (coverage, projectors, `sessionAccountsOf`, `CapabilityPlan`, `computeCapabilityDelta`, `planAccountsWidening`, `reRequestedTypes`, `mergeGrantsAndRejections` and its helpers, `collectNewGrants`, `isCapabilityCovered`, `dataAnswer`, `storedGrantAnswer`, `CapabilityManifest`) moves verbatim to `packages/wallet-bridge/src/capability-negotiation.ts`. The move commit edits only `export` keywords and the import block; comments are cleaned in a separate commit (below). `grantsOfType` is by then an import (Q-19). Imports: `capabilities`, `caip`, `field-address`, `method-scope-checkers`, `@nulo/extension-messaging/errors`, and the type-only `IDappSessionRef` (`./session-types`) and `CapabilityResult` (`./dapp-interaction-protocol`) from their defining modules. None of them imports `dispatcher.ts`, so no cycle.
   - **Imported back by `dispatcher.ts`:** `projectRequestedCapabilities`, `grantsNothing`, `computeCapabilityDelta`, `mergeGrantsAndRejections`, `reRequestedTypes`, `planAccountsWidening`, `ungrantedAccounts`, `dataAnswer`, `storedGrantAnswer`, `sessionAccountsOf`, and the types `CapabilityPlan` and `CapabilityManifest`.
   - **Stays in `dispatcher.ts`:** `unwrapOperationResult`, `DispatchHooks`, `FROM_ADDRESSED_KINDS` (`:205`), `assertAuthRelevantArgShape` (`:772-813`), and every class method, including the impure requestCapabilities orchestration. Each moved function is called at the same point with the same arguments.
   - **Package surface:** existing exports are preserved: `dispatcher.ts` re-exports `dataFieldsCovered`, `projectKnownCapability` and `ungrantedAccounts`, so `src/index.ts` is not edited and every consumer keeps compiling (`apps/extension/src/popup/windows/capabilities/build-items.ts:15`, `dapp-session/service.test.ts:13`, `wallet-sdk/error-envelope.test.ts:21`, `dispatcher.test.ts:13`). Two sender helpers are added, through `export * from "./account-resolution"` (`index.ts:11`); the journal needs one of them. The planning internals stay internal: the new module is not in the entry file.
4. **Comment cleanup, its own commit after the move,** in the moved code: drop the narration at `dispatcher.ts:549`, `:560` and `:637`; keep the replacement invariant at `:652-658` and drop its bug history; drop the out-of-arc finding reference and the narrowing narration at `:696-702`. The single-capability coverage invariant and the popup-echo constraints stay.
5. **Not done, by plan:** the `grantPublicAuthwit` widening (program Deferred list) and `runPopupOperation` (Decisions).

### Complexity and docs

- No function in the touched files has a complexity acceptance (`scripts/complexity-baseline/manifest.json` names none of them), so the move needs no `baseline:move-approved` label.
- `packages/wallet-bridge/README.md` file map gains a `capability-negotiation.ts` row; `ARCHITECTURE.md:170` gains half a sentence naming the planning module.

### Alternatives not taken

- **A new leaf `scope-matching.ts`** (the audit's suggestion): a file for three short functions whose natural home, the enforcement leaf, the dispatcher already imports.
- **A `popupGated` descriptor flag:** it would pull `grantPublicAuthwit` into the refusal set, the security change the program deferred.
- **Leaving the two-name literal:** the registry is the declared single source of per-method facts (`method-descriptors.ts:1-9`).

## Security & Adversarial Considerations

- **Who calls.** Any page holding an established wallet-sdk session, through the stock SDK or a raw protocol client that skips the SDK's Zod (so the batch pre-scan is the only server-side batch gate). It controls method names, every argument, the capability manifest, batch legs and nesting, and `opts.from`. Session rows are MAC-protected (`apps/extension/src/wallet/services/dapp-session/service.ts:88-97`), which proves integrity, not validity: the row schema checks each grant only as a non-null object (`spec.ts:69`), `applyCapabilityDecision` appends `grantRecords` without projection (`service.ts:364-368`), and `setCapabilityGrants` assigns directly (`:302-307`). Grants stored before projection landed (`da79ac34`, 2026-09-28) are never re-projected on read. So a malformed held grant is reachable, and this arc preserves today's behaviour on it rather than normalizing it.
- **What coverage looseness could and could not do.** Coverage never grants authority: enforcement runs independently on every call, and a covered request writes nothing. A looser coverage would skip an honest prompt or tell the dApp it holds what enforcement then refuses. Coverage's expressions match enforcement's predicates clause for clause and the Phase 1 rows pin both sides on the same inputs, so it cannot be looser; the empty-name guard is unreachable in coverage because projection refuses `function: ""` first (`dispatcher.ts:335`).
- **The refusal ladder this arc must not reorder** (`dispatch`, `dispatcher.ts:836-916`): session read; `assertKnownMethod` (`UnsupportedMethodError`); `argSchema` (`Invalid arguments for wallet method: X`); `assertAuthRelevantArgShape`; `enforceCapability` (exempt skip, else `CapabilityNotGrantedError`, missing session included); scope checkers and account-scope arrays (`ScopeViolationError`, or plain `Error` for shape faults); then the handler: network (`ChainNotSupportedError`), account resolution (`ScopeViolationError` "requested account not authorized", or the two plain errors), execution, unwrap. No guard moves.
- **The batch path, fully.** `batch` passes `assertKnownMethod`, then its own `argsBatch` (a non-array, a non-record leg, a non-string name or non-array args refuse with `Invalid arguments for wallet method: batch` before the pre-scan), has no shape guard, is capability-exempt, and has no scope. `handleBatch` then scans every leg in order and refuses the FIRST refused name before any leg runs, even a refused leg listed last. Survivors dispatch sequentially through the full ladder with no hooks and a fresh session read per leg; the first failure aborts and later legs never run. The pre-scan sees only top-level legs: in `[getChainInfo, batch([sendTx])]` the first leg runs, then the inner batch refuses. Legs named `__proto__`, `constructor`, `hasOwnProperty`, `toString` or `SendTx` miss the refusal set and fail at their own `assertKnownMethod`. `grantPublicAuthwit` and a popup `createAuthWit` run inside a batch today and still do.
- **What each consolidation could widen, and why it does not:**
  - *Address lists and patterns:* all three coverage predicates keep today's expressions, so a malformed stored element throws the same text; dropping `privateEventsCovered`'s `Array.isArray` guard would turn "re-prompt" into a thrown `TypeError`, so it is kept and pinned.
  - *Sender rule:* a unified rule that diverged from either copy would file a request under one account and send it from another, or honour a sender one side refuses. Both copies are the same predicate; the tables pin both sides on the same rows, including a coerced `Fr` that resolves and an object `String()` cannot convert.
  - *Batch set:* a derived set could widen (a routing-derived flag) or narrow (a typo in the field). The registry-wide table pins exactly two names.
  - *Move:* a re-export that leaks planning internals, or an import cycle that changes module evaluation order. Neither: the entry file is untouched, and the new module imports only leaves.
- **Text that changes:** none on a dApp or journal path. Stack traces lose the `unwrapResult` frame; no stack reaches a dApp.
- **Logging:** no new log line, and no log line moves.
- **npm surface:** none. `@nulo/wallet-bridge` is private and not on the `scripts/publish/packages.ts` allowlist.
- **Layering:** all new imports stay inside `wallet-bridge`, plus one extension import from the package entry it already uses.

## Assumptions

**Facts** (read 2026-10-03 at `61260efc`):

1. `scopeCovers`, `contractsRequestCovered`, `privateEventsCovered` and the typed `grantsOfType` sit at the dispatcher lines above; `matchesPattern`, `matchesScope`, `inAddressList` and the untyped `grantsOfType` at `method-scope-checkers.ts:38-64`. Coverage runs only on projected requests (`dispatcher.ts:1329, 1339-1340`); held grants are not projected on read.
2. The three NO_FROM copies and their users are at the lines above. `fee-detection.ts`'s copy has no caller outside its test. `extractSendFrom` has one caller (`queued-journal.ts:153`), inside a `try` that turns a throw into "no record" (`:222-225`).
3. The batch pre-scan is the only place the refusal set is written (`dispatcher.ts:1090`); the two tests that see it match by regex (`dispatcher.test.ts:1506-1518`).
4. `argsBatch` requires string leg names (`method-descriptors.ts:144`); `batch` is exempt (`:184-189`); `registerContractClass` always refuses at scope enforcement (`method-scope-checkers.ts:387-391`).
5. No touched function carries a complexity directive, and `dispatcher.test.ts` imports the three moved exports from `./dispatcher` (`:13`).
6. Untyped errors reach a dApp as `UNCLASSIFIED_ERROR_MESSAGE` (`wallet-sdk/error-envelope.ts:200-216`). Queued records store `getErrorMessage(error)` (`queued-journal.ts:267-275`), so message text is observable in the activity feed too.
7. `tests/e2e/network/tx-sendTx-noFrom.test.ts:69` accepts either outcome, so the sender-equivalence proof must live in the frozen unit tables.

**Inferences:**

- No caller depends on `execute` arity or on a private method name except the route-pin test, which stubs handler names this arc keeps (`dispatcher.route.pins.test.ts:26-35`).
- **Coupling with later arcs.** Arc 7 (chain-id) rewrites `queued-journal.ts:44-56`, next to this arc's hunks at `:31`, `:75-89` and `:153`; a restack conflict there is mechanical. Arc 8 shares no file. Arc 15 (Q-15 (e) record guards) is the only later arc that edits `dispatcher.ts`: its `isObj` at `:773`, which accepts arrays, while `isRecord` (`:313`, by then in `capability-negotiation.ts`) rejects them. That arc must keep the distinction wherever the guard lands.

**Asks:** none open; the four were decided by the panel (Decisions).

## Phases

### Phase 1: characterize today (test only)

One new file, `packages/wallet-bridge/src/dapp-grant.characterization.test.ts`, with its own small harness, plus rows in `queued-journal.test.ts` whose inputs override the short-address fixtures at `:222-243` with wire-shaped ones. Addresses are `0x` + 64 hex digits, one with letters for case rows, plus one malformed value. Every refusal assertion pins `constructor` and the full `message`. Executable rows that are not refused assert their success path; deliberately disabled methods assert their exact downstream refusal.

- **Coverage agrees with enforcement** (Q-19). One table; each row runs both public paths on the same stored grant: `requestCapabilities` (covered means no window opens) and the enforced call (`sendTx` for transaction scopes, `registerContract` / `getContractMetadata` for contracts, `getPrivateEvents` for data), which either reaches the runner or throws `ScopeViolationError`. Rows: exact match; case-changed address; other address; wildcard function; wildcard contract; function mismatch; scope `"*"`; requested `"*"` against a list (coverage only); requested contract `"*"` against a listed or wildcard contract (coverage only); a stored malformed address (coverage re-prompts, enforcement refuses a call naming the same value); an empty call name, refused by enforcement even under `"*"`, while coverage refuses `function: ""` as `ValidationError("Malformed transaction capability")`; a contracts grant whose flag differs from the request's; contracts `"*"`; private events listed and case-changed; an address-book-only data grant against a private-events request (window opens, nothing throws; the call is refused). **Malformed held grant:** `{ type: "contracts", contracts: {}, canRegister: true }` against a listed `canRegister` request rejects with `TypeError: e.contracts.some is not a function`.
- **Batch refusal** (Q-11). Rows: `[sendTx]` and `[registerToken]` each give `Error` with the exact template text and nothing executes; `[getChainInfo, sendTx]` refuses before the first leg runs; `[registerToken, sendTx]` names `registerToken`; `[unknownMethod, sendTx]` gives the batch refusal, not `UnsupportedMethodError`; a malformed envelope gives `Invalid arguments for wallet method: batch`; `__proto__`, `constructor`, `hasOwnProperty`, `toString` and `SendTx` each reach `UnsupportedMethodError`; the nested `[getChainInfo, batch([sendTx])]` runs one leg, then refuses; `[]` resolves `[]`. **Registry-wide,** on a session with no grants so no popup leg can wait: for every key of `METHOD_REGISTRY` (domain asserted non-empty), a one-leg batch rejects with the refusal text if and only if the name is in the literal `["registerToken", "sendTx"]`. **Drift pin:** `grantPublicAuthwit` inside a batch reaches the runner as `send_transaction`, marked `(DRIFT PIN)`.
- **Sender rule** (Q-01 (c)). One literal row list, used for `sendTx`, `simulateTx` and `profileTx`: `opts` absent, `undefined` or `null`; `from` absent, `undefined`, `null`, `"NO_FROM"`, `"no_from"`, `""`, `0`, `false`, `{}`, a second session account, that account case-changed, a non-session wallet account, an `Fr` whose `toString()` is the second session account (resolves to it), and `{ toString: "x" }` (today's `TypeError: Cannot convert object to primitive value`). Pin the account acted as, or the exact refusal. For `sendTx`, also pin `executionMode` (only the exact sentinel gives `default_entrypoint`) and the forwarded `opts.from` (NO_FROM kept, otherwise the resolved address); for the other two, `opts.from` is always the resolved address. The same rows in `queued-journal.test.ts` pin the record's `accountAddress` or no record (the `toString: "x"` row: no record, since the throw is caught), so each row shows the filing account equals the sending account, or that the send is refused and nothing is filed.

Green against today's code, committed alone, so every test file is frozen before Phase 2.

### Phase 2: the refactor, one commit per item

In order: Q-19; Q-01 (c), with the playground comment; batch refusal from the registry; inline `unwrapResult`; the planning-block move; docs; then the comment cleanup. Every test file stays byte-identical except `fee-detection.test.ts`, which loses the import of the deleted function (`:3`) and its block (`:58-70`).

**Validation gate (after each commit):**

- **Commands:** `bun run --cwd packages/wallet-bridge test`, the extension's `queued-journal` and `fee-detection` tests, `bun run lint`, `bun run typecheck:all`; at the arc head also `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`, `bun run build`.
- **Pass criteria:** all exit 0. `git diff <phase-1 commit> -- '*.test.ts'` shows only the `fee-detection.test.ts` edit. `src/index.ts` is unchanged. The move is byte-identical: a scratch script takes the deleted `dispatcher.ts` span from the parent commit and the new module's body, strips the import blocks and leading `export ` keywords, and diffs them to empty (recorded in the lessons log, script not committed).
- **Mutation check:** scratch edits on the Phase 2 head, one at a time, restored from a copy, never with git; each must turn at least one Phase 1 test red:
  1. `matchesPattern` with `===` for `sameFieldAddress`;
  2. `matchesPattern` without the function wildcard;
  3. `privateEventsCovered` without `Array.isArray`;
  4. `contractsRequestCovered` without `e[flag] &&`;
  5. `refusedInBatch` added to `grantPublicAuthwit`;
  6. the batch check moved into the dispatch loop;
  7. `requestedSenderOf` with `!from` for `== null`;
  8. `requestedSenderOf` without `String()`;
  9. `requestedSenderOf` without the NO_FROM test;
  10. `handleSendTx`'s entrypoint keyed on `requestedSenderOf(...) === undefined`.
- **Duplication:** `implementations-plan/harden-dedupe/tools/scoped-dup.sh` before and after, in the lessons log.
- **e2e, locally before the PR:** `bun run e2e:agent` on `network/batch-mixed`, `network/batch-partial-failure`, `network/meta-batch`, `network/cap-request-basic`, `network/cap-request-repeat-noPopup`, `network/cap-widening`, `network/scope-refusal`, `network/authwit-variants` and `network/tx-sendTx-noFrom`. CI then runs both browsers in full, per the program gates.
- **Screenshots:** none; no `.vue` or CSS file changes.

## Post-implementation

1. **Code audit** of the arc diff: Codex (GPT-6 Astra, xhigh), with the adversarial, assumption-attack and implementation-critique asks, the request to break the refusal-order and batch invariants above, the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix, commit, log the round in `implementations-plan/harden-dedupe/lessons/arc-06-dapp-grant-planning.md`, and resume the same Codex session. Stop when a round has no material finding; at 5 rounds, park the arc. A fix that touches a frozen test file needs a written reason in the log.
3. **Delivery:** push, open a ready PR against its stack parent, then add both e2e labels. When the program gates are green, with the shards that ran recorded, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/06-dapp-grant-planning`, one PR, stacked on `harden-dedupe` (the driver sets the parent at delivery). Code review: off.

## UI impact

None. The capabilities window imports `dataFieldsCovered` from the package entry, which still exports it.

## Preserved drift and follow-ups

- **The batch refusal set omits `grantPublicAuthwit`** (`dispatcher.ts:1090`), which is popup-routed (`:966-968`). Deferred to the program's follow-ups as a security change; pinned here as a drift.
- **Coverage has no empty-name guard** (`scopeCovers`). Unreachable; pre-cleared, omitted by the panel.
- **Stale comment** at `queued-journal.ts:45` (it says it mirrors `background.ts`): arc 7 owns those lines.
- **Follow-up lead: malformed held grants.** A grant stored before projection (`da79ac34`), or written through `setCapabilityGrants` / `applyCapabilityDecision` without projection, survives on the row and is never re-projected, so coverage and enforcement both see raw shapes (`contracts: {}` throws a `TypeError` in both). Whether reads should re-project or refuse such a row is a security call outside a dedup.

## Decisions (delegated)

### Plan audit: Codex (GPT-6 Astra, xhigh), round 1: REVISE

1. **Blocker, adopted: the contracts consolidation changed a reachable error.** Codex showed a malformed held grant is storable (schema `spec.ts:69` checks only a non-null object; `applyCapabilityDecision` and `setCapabilityGrants` store unprojected grants; pre-`da79ac34` sessions are never re-projected) and probed both `TypeError` texts. `contractsRequestCovered` keeps today's expression, Phase 1 pins the error, and no storage validation or error normalization is added. The exposure is recorded above as a follow-up lead.
2. **Should-fix, adopted: the sender table could not kill the `String()` mutation.** Added an `Fr` row that resolves through coercion and a `{ toString: "x" }` row pinning today's `TypeError`, with the journal's no-record result; the ten mutations are numbered so each gets its own red.
3. **Should-fix, adopted: "not refused" does not mean "succeeds".** Executable rows assert success; `registerContractClass` and other disabled paths pin their exact refusal; the registry-wide assertion stays about the two names; `hasOwnProperty` and `toString` join the prototype rows.
4. **Should-fix, adopted:** the drift section is renamed "Preserved drift and follow-ups", keeping each item's destination.
5. **Nit, adopted:** the surface change is stated (two sender helpers added via `index.ts:11`; planning internals stay internal).
6. **Nit, adopted:** the move stays mechanical and a separate commit cleans the named comments; no header sentence about shared helpers; one line on the private-events guard.

Also adopted from the round: direct type-only imports of `IDappSessionRef` and `CapabilityResult`; the list of symbols `dispatcher.ts` imports back; the loosened test-diff criterion for `fee-detection.test.ts:3`; dropping "schema-parsed" (the MAC guards integrity, not validity); the registry-wide test on a grantless session; sender equivalence carried by unit tables, since `tx-sendTx-noFrom.test.ts:69` accepts either outcome; wire-shaped journal rows; the `isObj` / `isRecord` note for arc 15.

### Plan audit: Opus panelist: APPROVE with text corrections

Its framing is adopted in Security: coverage looseness cannot widen authority, because enforcement is independent and a covered request writes nothing; the risk is a skipped honest prompt or a misinformed dApp.

### The four Asks (both legs agreed)

1. `runPopupOperation`: dropped to the follow-ups. Handler order, hook arguments and execute arity, and `createAuthWit`'s fenced silent branch differ enough that a byte-preserving wrapper would be bigger than what it removes.
2. The coverage empty-name guard: not added. Unreachable; a red-then-green test would need a test-only export.
3. `refusedInBatch` with the derived `Set`: adopted.
4. The matchers exported from `method-scope-checkers.ts`: adopted, no new leaf. Superseded by code review round 1: no coverage site calls them, so they stay private.

### Code review: Codex (GPT-6 Astra, xhigh), round 1: NOT CONVERGED

1. **Should-fix, adopted: a malformed pattern changed the coverage error.** A stored transaction grant with `scope: [null]` passes the row schema; through `matchesPattern` its `TypeError` read `pattern.contract` instead of `ep.contract` on Bun. `scopeCovers` is back to its original expression. The same audit over every coverage site switched to a shared matcher, for a malformed element inside a stored list (`null`, a number, `{}`, an object `String()` cannot convert, an array, a string), probed on Bun, Chrome and Firefox:
   - `scopeCovers`: differs on `null` (Bun names the variable; V8 does not). **Reverted to inline.**
   - `privateEventsCovered`: `null`, numbers, `{}`, arrays and strings stringify on both forms; an element whose `toString` and `valueOf` are not callable throws, and Firefox names the variable (`can't convert x to string` against `item`). Bun and V8 word both alike. **Reverted to inline**, since the extension runs on Firefox.
   - `contractsRequestCovered`: already inline (plan audit, Decision 1).
   - `grantsOfType`: the typed and untyped bodies are the same expression; no element is touched. **Kept shared.**

   With no consumer left, `matchesPattern` and `inAddressList` lose their `export`. Each inline site carries one sentence on why. The rows compute the expected text from a reference that binds the production variable name, so they hold on every engine; the null-pattern row goes red on Bun under the swap back to `matchesPattern`, the private-events row only on SpiderMonkey.
2. **Should-fix, adopted:** the successful sender rows assert the answer: `{ ok: "0xsent" }` for sendTx, `{ ok: "0xran" }` for simulateTx and profileTx.
3. **Nit, adopted:** the batch order control runs `getAddressBook` then `getChainInfo` and asserts that order in the answer and in the operations run.
4. **Nit, adopted:** `collectNewGrants`' doc states the three-step fallback: the last differing answer entry of the type, else the last entry of the type, and only when there is none, the requested delta.
5. **Nit, adopted:** dropped the narrating `grantsOfType` TSDoc and "in Phase 2" in `method-descriptors.ts`.

### Split, resolved

Opus judged the `contracts` error-text difference unreachable; Codex showed it reachable. **Codex**: in a no-behaviour-change program the stricter reading is the safe one, so the expression stays (Decision 1 above).
