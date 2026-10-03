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

# dapp-grant-planning: one grant-matching rule, one sender rule, consent planning out of the dispatcher

Findings Q-19, Q-01 (c) and the non-widening part of Q-11, from `audit/quality/2026-09-30-dedup-high/`, in that order. This is the dApp consent path: every method name, argument, manifest, batch leg and `opts.from` below is attacker-controlled. For every request shape, the set of requests refused, the order in which checks refuse, and the error class and message a dApp's request ends with stay byte-identical. The batch refusal set stays exactly `{sendTx, registerToken}`.

## Outcome & Quality Bar

- **For whom:** the next person who changes what a grant covers or how a sender is named. Today "does this grant reach that call" is written twice in `wallet-bridge` (consent coverage and enforcement), the NO_FROM rule three times across two packages, and 550 lines of pure consent planning share `dispatcher.ts` (1,802 lines) with routing and handlers.
- **Excellent:**
  - Coverage and enforcement call the same wildcard and address-list predicates, so a new wildcard form cannot reach one and not the other.
  - The sender a request names is computed by one function, used where the journal files the request and where the dispatcher sends it.
  - The batch refusal set is a registry fact, pinned behaviourally over every registry method.
  - `dispatcher.ts` loses the pure planning block to `capability-negotiation.ts`, moved byte-for-byte.
  - A characterization suite, green on today's code and frozen before the refactor, pins every refusal, its order and its exact error for the coverage, enforcement, sender and batch paths, with wire-shaped values.
- **Good enough:** the popup handlers keep their own scaffolds (see Asks), and the enforcement-only empty-name guard stays where it is.

## Architecture & Implementation

Lines read 2026-10-03 on `harden-dedupe` at `61260efc`. "Guard set" means every condition that can refuse or decide, in evaluation order.

### Q-19: coverage reuses enforcement's matchers

Enforcement's helpers in `packages/wallet-bridge/src/method-scope-checkers.ts` gain `export`; their bodies do not change. Coverage in `dispatcher.ts` calls them. No new module: `method-scope-checkers.ts` is already the leaf `dispatcher.ts` imports, and the package entry re-exports only five named members of it (`src/index.ts:25-31`), so the public surface does not grow.

| site | today | guard set (unchanged after) | after |
|---|---|---|---|
| `matchesPattern` `checkers:38-43` | private | contract: pattern `"*"`, else `sameFieldAddress(pattern, call)`; then function: pattern `"*"`, else `===` | exported, body untouched |
| `matchesScope` `checkers:45-55` | private | `fn === ""` refuses first, then scope `"*"`, then any pattern | untouched, stays private: the empty-name guard stays enforcement-only |
| `inAddressList` `checkers:57-60` | private | list `"*"`, else any `sameFieldAddress(String(item), address)` | exported, body untouched |
| `grantsOfType` `checkers:62-64` and `dispatcher:692-694` | two copies, one untyped | `filter(type ===)` then `map(capability)` | one, the typed `<K extends Capability["type"]>` form, exported from checkers; the 12 checker calls (`:76, 101, 118, 136, 153, 182, 199, 225, 226, 273, 328, 356`) drop their explicit type argument (type-only) |
| `scopeCovers` `dispatcher:225-235` | inline copy of the pattern rule | existing `"*"` covers; requested `"*"` is covered only by `"*"`; each requested pattern needs ONE existing pattern matching contract then function | `requested.every((rp) => existing.some((ep) => matchesPattern(String(rp.contract), rp.function, ep)))`, after the same two `"*"` returns |
| `contractsRequestCovered` `dispatcher:210-219` | inline address-list copy | per flag: unflagged request covered; requested `"*"` needs a flagged `"*"` grant; else every address needs a grant with the flag AND a listing | inner test becomes `e[flag] && inAddressList(String(addr), e.contracts)` (flag still first) |
| `privateEventsCovered` `dispatcher:269-278` | inline address-list copy | no request covered; `"*"` needs a held `"*"`; else every address needs a held list that is `"*"` or an ARRAY containing it | `list === "*" \|\| (Array.isArray(list) && inAddressList(String(addr), list))`: the `Array.isArray` guard stays, since `inAddressList` would throw on a held grant with no `privateEvents` |

Argument order into `sameFieldAddress` is unchanged at every site (grant side first), and the function is symmetric anyway (`field-address.ts:26-29`). The scopeCovers comment that coverage "deliberately mirrors enforcement's shape" stays; the checkers' header gains one sentence saying coverage shares these helpers.

### Q-01 (c): one sender rule in `account-resolution.ts`

`packages/wallet-bridge/src/account-resolution.ts` already holds the one "which account a request acts as" rule both sides call. It gains:

- `isNoFromRequest(from: unknown): boolean`: `from === "NO_FROM"` (the literal in a module-private const).
- `requestedSenderOf(opts: unknown): string | undefined`: reads `opts?.from`; `undefined` when it is `== null` or NO_FROM, else `String(from)`. Its TSDoc carries the reason now at `queued-journal.ts:75-83`: a stricter rule on one side files a request under one account and sends it from another.

| site | guard set today | after |
|---|---|---|
| `dispatcher.ts:191-193` `isNoFromRequest`, `:198-200` `requestedFromOf` | `from === "NO_FROM"`; then NO_FROM or `== null` → none, else `String(from)`; input `args[1] ?? {}` | deleted; imported from `./account-resolution` |
| users `dispatcher.ts:1118` (entrypoint + opts), `:1123` (sendTx sender), `:1622` (simulateTx/profileTx sender via `FROM_ADDRESSED_KINDS`) | as above | same calls, `requestedFromOf` renamed `requestedSenderOf`; `:1118` keeps `isNoFromRequest`, so only the exact sentinel switches to `default_entrypoint` (a `null` `from` stays standard) |
| `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:84-89` `extractSendFrom` | `args?.[1]?.from`; `== null` or `"NO_FROM"` → none, else `String(from)` | deleted (no other caller); `:153` passes `requestedSenderOf((message as { args?: unknown[] }).args?.[1])`, imported from `@nulo/wallet-bridge` beside `resolveAuthorizedSessionAccount` (`:31`) |
| `apps/extension/src/wallet/services/execution/utils/fee-detection.ts:15-20` `isNoFromRequest` | `from === "NO_FROM"` | deleted: no caller outside its own test (`fee-detection.test.ts:58-70`), whose block goes with it |

Every input maps identically: `args[1]` nullish gives `{}` on one side and `undefined?.from` on the other, both `undefined`; a primitive `args[1]` has no `from` on either. The wire is JSON, so no getter makes the extra property reads observable. Account matching after normalization is untouched: `resolveAuthorizedSessionAccount` compares the exact string (`account-resolution.ts:54`). The playground's stale pointer (`apps/playground/src/sections/transactions.ts:109`, "dispatcher.ts:82-88") becomes one sentence naming the behaviour, not a line.

### Q-11, the non-widening part

1. **Batch refusal from the registry.** `MethodDescriptor` (`method-descriptors.ts:94-108`) gains `refusedInBatch?: true`, set on `sendTx` (`:279-284`) and `registerToken` (`:207-215`) only. Its TSDoc says it is named for the refusal, not for popup routing, so marking a new popup method never widens the set by itself. `BATCH_REFUSED_METHODS: ReadonlySet<string>` is derived beside the other tables with the existing `deriveSet` (`:335-342`). `handleBatch`'s pre-scan (`dispatcher.ts:1089-1093`) becomes `if (BATCH_REFUSED_METHODS.has(method.name)) throw new Error(...)` with today's template literal unchanged, em dash included. `argsBatch` (`:141-145`) has already proved every leg name a string, so `Set.has` equals the two `===` tests; a `Set` cannot resolve prototype names. The comment at `:1079-1088` keeps the raw-protocol-client reason and drops the sentence naming the two methods.
2. **Inline `unwrapResult`.** The private wrapper (`dispatcher.ts:1799-1801`) is deleted; its six callers (`:859, 1154, 1200, 1212, 1258, 1311`) call `unwrapOperationResult`, the function it delegates to. Same function, same arguments.
3. **Move the planning block.** `dispatcher.ts:207-752` (coverage, projectors, `sessionAccountsOf`, `CapabilityPlan`, `computeCapabilityDelta`, `planAccountsWidening`, `reRequestedTypes`, `mergeGrantsAndRejections` and its helpers, `collectNewGrants`, `isCapabilityCovered`, `dataAnswer`, `storedGrantAnswer`, `CapabilityManifest`) moves verbatim to `packages/wallet-bridge/src/capability-negotiation.ts`. The only edits are `export` keywords and the import block. `grantsOfType` is by then an import (Q-19). It imports only `capabilities` (types), `caip`, `field-address`, `method-scope-checkers` and `@nulo/extension-messaging/errors`, none of which imports `dispatcher.ts`, so no cycle.
   - **Stays in `dispatcher.ts`:** `unwrapOperationResult`, `DispatchHooks`, `FROM_ADDRESSED_KINDS` (`:205`), `assertAuthRelevantArgShape` (`:772-813`), and every class method, including the impure requestCapabilities orchestration (`handleRequestCapabilities`, `askCapabilities`, `applyAccountsWidening`, `heldAccountsOf`, `loadAvailableAccountsForPopup`, `persistRejectionOnPopupFailure`, `enrichGrantedCapabilities`). Each moved function is called at the same point with the same arguments.
   - **Package surface unchanged:** `dispatcher.ts` re-exports `dataFieldsCovered`, `projectKnownCapability` and `ungrantedAccounts` from the new module, so `src/index.ts` is not edited, the new module is not added to it, and planning internals such as `computeCapabilityDelta` stay unimportable from the extension. Consumers that keep compiling unedited: `apps/extension/src/popup/windows/capabilities/build-items.ts:15`, `dapp-session/service.test.ts:13`, `wallet-sdk/error-envelope.test.ts:21`, `dispatcher.test.ts:13`.
   - **Comments inside the moved block are not edited,** so the move stays byte-verifiable.
4. **Not done, by plan:** the `grantPublicAuthwit` widening (program Deferred list) and `runPopupOperation` (see Asks).

### Complexity and docs

- No function in the touched files has a complexity acceptance (`scripts/complexity-baseline/manifest.json` names none of them), so the move needs no `baseline:move-approved` label. `handleBatch` gets simpler; nothing new nears a budget.
- `packages/wallet-bridge/README.md` file map: a `capability-negotiation.ts` row, and the `method-scope-checkers.ts` row notes that coverage shares its matchers. `ARCHITECTURE.md:170` gains half a sentence naming the planning module.

### Alternatives not taken

- **A new leaf `scope-matching.ts`** (the audit's suggestion): a file for three short functions whose natural home, the enforcement leaf, the dispatcher already imports.
- **A `popupGated` descriptor flag:** it would pull `grantPublicAuthwit` into the refusal set, the security change the program deferred.
- **Leaving the two-name literal:** the registry is the declared single source of per-method facts (`method-descriptors.ts:1-9`); the literal is the one routing fact outside it.

## Security & Adversarial Considerations

- **Who calls.** Any page holding an established wallet-sdk session, through the stock SDK or a raw protocol client that skips the SDK's Zod (so the batch pre-scan is the only server-side batch gate). It controls method names, every argument, the capability manifest, batch legs and nesting, and `opts.from`. It cannot write the session row: rows are schema-parsed and MAC-verified (`apps/extension/src/wallet/services/dapp-session/service.ts:88-97`) and written only from projected capabilities. The popup's answer is treated as untrusted and re-projected (`collectNewGrants`), unchanged.
- **The refusal ladder this arc must not reorder** (`dispatch`, `dispatcher.ts:836-916`): session read; `assertKnownMethod` (`UnsupportedMethodError`); `argSchema` (`Invalid arguments for wallet method: X`); `assertAuthRelevantArgShape`; `enforceCapability` (exempt skip, else `CapabilityNotGrantedError`, missing session included); scope checkers and account-scope arrays (`ScopeViolationError`, or plain `Error` for shape faults); then the handler: network (`ChainNotSupportedError`), account resolution (`ScopeViolationError` "requested account not authorized", or the two plain errors), execution, unwrap. No guard moves; the arc changes which function body holds three predicates and one set.
- **The batch path, fully.** `batch` passes `assertKnownMethod`, then its own `argsBatch` (a non-array, a non-record leg, a non-string name or non-array args refuse with `Invalid arguments for wallet method: batch` before the pre-scan), has no shape guard, is capability-exempt, and has no scope. `handleBatch` then scans every leg in order and refuses the FIRST refused name before any leg runs, even a refused leg listed last. Survivors dispatch sequentially through the full ladder with no hooks and a fresh session read per leg; the first failure aborts and later legs never run. The pre-scan sees only top-level legs: in `[getChainInfo, batch([sendTx])]` the first leg runs, then the inner batch refuses. A leg named `__proto__`, `constructor` or `SendTx` is not refused by the pre-scan and fails at its own `assertKnownMethod`. `grantPublicAuthwit` and a popup `createAuthWit` run inside a batch today and still do.
- **What each consolidation could widen, and why it does not:**
  - *Shared matchers:* coverage that approves more than enforcement grants silently (no re-prompt). Coverage now calls the exact enforcement predicate, so it cannot be looser; the empty-name guard is unreachable in coverage because projection refuses `function: ""` first (`dispatcher.ts:335`).
  - *Address lists:* dropping `privateEventsCovered`'s `Array.isArray` guard would turn "re-prompt" into a thrown `TypeError`; the guard is kept and pinned.
  - *Sender rule:* a unified rule that diverged from either copy would file a request under one account and send it from another, or honour a sender one side refuses. Both copies are the same predicate; the table pins both sides on the same rows, including `""`, `0`, `false`, objects, `"no_from"` and a case-changed address.
  - *Batch set:* a derived set could widen (a routing-derived flag) or narrow (a typo in the field). The registry-wide behavioural table pins exactly two names.
  - *Move:* a re-export that leaks planning internals, or an import cycle that changes module evaluation order. Neither: the entry file is untouched, and the new module imports only leaves.
- **The one text that can differ.** A stored contracts grant whose `contracts` is a truthy non-array would make coverage throw V8's `TypeError` naming `list.some` rather than `e.contracts.some`. That row cannot exist (MAC and projection above), enforcement's `inAddressList` already throws that same text for it on every call, and the dApp receives the unclassified constant either way (`wallet-sdk/error-envelope.ts:208`). Stack traces lose the `unwrapResult` frame; no stack reaches a dApp.
- **Logging:** no new log line, and no log line moves.
- **npm surface:** none. `@nulo/wallet-bridge` is private and not staged by `scripts/publish/packages.ts`.
- **Layering:** all new imports stay inside `wallet-bridge`, plus one extension import from the package entry it already uses.

## Assumptions

**Facts** (read 2026-10-03 at `61260efc`):

1. `scopeCovers`, `contractsRequestCovered`, `privateEventsCovered` and the typed `grantsOfType` sit at the dispatcher lines above; `matchesPattern`, `matchesScope`, `inAddressList` and the untyped `grantsOfType` at `method-scope-checkers.ts:38-64`. Coverage runs only on projected requests (`dispatcher.ts:1329, 1339-1340`), and projection refuses an empty function name (`:335`) and a non-field address (`:352`).
2. The three NO_FROM copies and their users are at the lines above. `fee-detection.ts`'s copy has no caller outside its test (`git grep isNoFromRequest`). `extractSendFrom` has one caller (`queued-journal.ts:153`).
3. The batch pre-scan is the only place the refusal set is written (`dispatcher.ts:1090`; `git grep` finds the message only there and in two tests at `dispatcher.test.ts:1506-1518`, which match by regex only).
4. `argsBatch` requires string leg names (`method-descriptors.ts:144`); `batch` is exempt (`:184-189`).
5. No touched function carries a complexity directive, and `dispatcher.test.ts` imports the three moved exports from `./dispatcher` (`:13`).
6. Untyped errors reach a dApp as `UNCLASSIFIED_ERROR_MESSAGE`; the typed classes above have their own envelopes (`wallet-sdk/error-envelope.ts:200-216`). Queued records store `getErrorMessage(error)` (`queued-journal.ts:267-275`), so message text is observable in the activity feed too.

**Inferences:**

- No caller depends on `execute` arity or on a private method name except the route-pin test, which stubs handler names this arc keeps (`dispatcher.route.pins.test.ts:26-35`).
- **Coupling with later arcs.** Arc 7 (chain-id) rewrites `queued-journal.ts:44-56`, next to this arc's hunks at `:31`, `:75-89` and `:153`; a restack conflict there is mechanical. Arc 8 shares no file. Arc 15 (Q-15 (e) record guards) is the only later arc that edits `dispatcher.ts`: its `isObj` at `:773`; its `isRecord` (`:313`) will by then live in `capability-negotiation.ts`. That arc's plan should cite the new location.

**Asks** (for the panel):

1. **Drop `runPopupOperation` to the follow-ups?** Recommended: yes. The shared part is four lines per handler. Keeping today's bytes needs a strategy field for each difference: `sendTx` resolves the account before `requireSession` and passes a three-key hook bag; `grantPublicAuthwit` passes `originKey` only; `registerToken` and the `createAuthWit` popup leg call `execute` with one argument; `createAuthWit`'s fenced silent branch sits between resolution and the popup. That helper would be bigger than what it removes, on the trust boundary.
2. **Apply the pre-cleared Q-19 empty-name guard to coverage?** Recommended: no. It is unreachable (projection refuses `function: ""` first), so a red-then-green test would need a test-only export of a private function, and sharing `matchesPattern` already removes the divergence risk the finding names. If taken, it lands as its own last commit.
3. **`refusedInBatch` on the registry, or leave the literal?** Recommended: the field, for the reasons above; the Deferred list allows a field named for the refusal.
4. **Export the matchers from `method-scope-checkers.ts`, or add `scope-matching.ts`?** Recommended: export (see Alternatives).

## Phases

### Phase 1: characterize today (test only)

One new file, `packages/wallet-bridge/src/dapp-grant.characterization.test.ts`, with its own small harness (session writer, network, account and execution fakes; the `dispatcher.test.ts` harness is not exported), plus rows in `queued-journal.test.ts`. Addresses are wire-shaped: `0x` + 64 hex digits, one with letters for case rows, plus one malformed value. Every refusal assertion catches the rejection and pins `constructor` and the full `message` string; every "not refused" row asserts the success path (lessons: "a test that something never happens… pair it with a success-path control").

- **Coverage agrees with enforcement** (Q-19). One table; each row runs both public paths on the same stored grant: `requestCapabilities` (covered means no window opens and the answer is the stored grant) and the enforced call (`sendTx` for transaction scopes, `registerContract` / `getContractMetadata` for contracts, `getPrivateEvents` for data), which either reaches the runner or throws `ScopeViolationError`. Rows: exact match; case-changed address; other address; wildcard function; wildcard contract; function mismatch; scope `"*"`; requested `"*"` against a list (coverage only); requested contract `"*"` against a listed or wildcard contract (coverage only); a stored malformed address (coverage re-prompts for any valid request, and enforcement refuses a call naming that same malformed value); an empty call name, refused by enforcement even under `"*"`, while coverage refuses `function: ""` as `ValidationError("Malformed transaction capability")`; a contracts grant whose flag differs from the request's; contracts `"*"`; private events listed and case-changed; a data grant with `addressBook` only against a private-events request (window opens, nothing throws; the call is refused).
- **Batch refusal** (Q-11). Rows: `[sendTx]` and `[registerToken]` each give `Error` with the exact template text and nothing executes; `[getChainInfo, sendTx]` refuses before the first leg runs; `[registerToken, sendTx]` names `registerToken`; `[unknownMethod, sendTx]` gives the batch refusal, not `UnsupportedMethodError`; a malformed envelope gives `Invalid arguments for wallet method: batch` (argument guard before pre-scan); `[__proto__]`, `[constructor]`, `[SendTx]` reach `UnsupportedMethodError`; the nested `[getChainInfo, batch([sendTx])]` runs one leg, then refuses; `[]` resolves `[]`. **Registry-wide:** for every key of `METHOD_REGISTRY` (asserting the domain is non-empty), a one-leg batch rejects with the refusal text if and only if the name is in the literal `["registerToken", "sendTx"]`. **Drift pin:** `grantPublicAuthwit` inside a batch reaches the runner as `send_transaction`, marked `(DRIFT PIN)` per CLAUDE.md's bug-pin convention.
- **Sender rule** (Q-01 (c)). One literal row list, used for `sendTx`, `simulateTx` and `profileTx`: `opts` absent, `undefined` or `null`; `from` absent, `undefined`, `null`, `"NO_FROM"`, `"no_from"`, `""`, `0`, `false`, `{}`, a second session account, that account case-changed, and a non-session wallet account. Pin the account acted as, or `ScopeViolationError("Scope violation: requested account not authorized for this dApp session")`. For `sendTx`, also pin `executionMode` (only the exact sentinel gives `default_entrypoint`) and the forwarded `opts.from` (NO_FROM kept, otherwise the resolved address). For the other two, pin that `opts.from` is always the resolved address. The same rows in `queued-journal.test.ts`'s "record account" block pin the record's `accountAddress` or no record, so each row shows the filing account equals the sending account, or that the send is refused and nothing is filed.

Green against today's code, committed alone, so every test file is frozen before Phase 2.

### Phase 2: the refactor, one commit per item

In order: Q-19; Q-01 (c), with the playground comment; batch refusal from the registry; inline `unwrapResult`; the planning-block move; docs. Every test file stays byte-identical except `fee-detection.test.ts:58-70`, deleted with the function it tests (its three cases are covered by the sender table).

**Validation gate (after each commit):**

- **Commands:** `bun run --cwd packages/wallet-bridge test`, `bun run --cwd apps/extension test -- queued-journal`, `bun run lint`, `bun run typecheck:all`; at each phase head also `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`, `bun run build`.
- **Pass criteria:** all exit 0. `git diff <phase-1 commit> -- '*.test.ts'` shows only the `fee-detection.test.ts` deletion. `src/index.ts` is unchanged. The move is proven byte-identical: a scratch script takes the deleted `dispatcher.ts` span from the parent commit and the new module's body, strips the import blocks and leading `export ` keywords, and diffs them to empty (recorded in the lessons log, script not committed).
- **Mutation check** (scratch edits on the Phase 2 head, one at a time, restored from a copy, never with git; each must turn at least one Phase 1 test red): `matchesPattern` with `===` for `sameFieldAddress`; `matchesPattern` without the function wildcard; `privateEventsCovered` without `Array.isArray`; `contractsRequestCovered` without `e[flag] &&`; `refusedInBatch` added to `grantPublicAuthwit`; the batch check moved into the dispatch loop; `requestedSenderOf` with `!from` for `== null`, without `String()`, and without the NO_FROM test; `handleSendTx`'s entrypoint keyed on `requestedSenderOf(...) === undefined`.
- **Duplication:** `implementations-plan/harden-dedupe/tools/scoped-dup.sh` before and after, in the lessons log.
- **e2e, locally before the PR:** `bun run e2e:agent` on `network/batch-mixed`, `network/batch-partial-failure`, `network/meta-batch`, `network/cap-request-basic`, `network/cap-request-repeat-noPopup`, `network/cap-widening`, `network/scope-refusal`, `network/authwit-variants` and `network/tx-sendTx-noFrom`. CI then runs both browsers in full, per the program gates.
- **Screenshots:** none; no `.vue` or CSS file changes.

## Post-implementation

1. **Dual audit** of the arc diff: Codex (GPT-6 Astra, xhigh) and one independent Opus agent, each with the adversarial, assumption-attack and implementation-critique asks, the request to break the refusal-order and batch invariants above, the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix, commit, log the round in `implementations-plan/harden-dedupe/lessons/arc-06-dapp-grant-planning.md`, and resume the same Codex session. Stop when a round has no material finding; at 5 rounds, park the arc. A fix that touches a frozen test file needs a written reason in the log.
3. **Delivery:** push, open a ready PR against its stack parent, then add both e2e labels. When the program gates are green, with the shards that ran recorded, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/06-dapp-grant-planning`, one PR, stacked on `harden-dedupe` (the driver sets the parent at delivery). Code review: off.

## UI impact

None. The capabilities window imports `dataFieldsCovered` from the package entry, whose export set is unchanged.

## Drift left for the alignment arc

- **The batch refusal set omits `grantPublicAuthwit`** (`dispatcher.ts:1090`), which is popup-routed (`:966-968`). Already on the program's Deferred list as a security change; pinned here as a drift.
- **Coverage has no empty-name guard** (`scopeCovers`). Unreachable; pre-cleared as an invisible fix, recommended not taken (Ask 2).
- **Stale comment outside this arc:** `queued-journal.ts:45` says it mirrors `background.ts`; arc 7 owns those lines.

## Decisions (delegated)
