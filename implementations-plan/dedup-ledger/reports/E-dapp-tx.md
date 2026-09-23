# Cluster E — dApp + tx services

## Cluster verdict

This cluster (dapp-session, dapp-interaction, wallet-sdk, window-manager, transaction, operation-journal, activity-protocol, task — ~7.3k lines) is dense, security-critical code, and it reads like it. The vast majority of the length is load-bearing: race-condition guards, fail-closed branches, and profile/session identity checks each carry a comment explaining a real incident or attack the code defends against (B-13, F-04, F-12, D16, etc.), and several places (`DappSessionService.patchSession`, `dapp-interaction/materialize.ts`) show the team already noticed and fixed their own duplication mid-flight. The quality bar here is noticeably higher than "verbose LLM output" — most candidate simplifications I checked turned out to be justified by a documented race. The biggest real lever is a small, well-evidenced cluster of copy-pasted mechanics (a collision-avoiding random-ID mint duplicated 3 ways instead of reusing the existing `nextRandomId` helper, a verbose access-level switch that could be a typed lookup table, and one genuinely dead class). Total realistically removable: **~80-110 LOC**, concentrated in 5-6 small findings rather than one big one.

## Findings

### F1 [duplication] Collision-avoiding random-ID mint hand-rolled 3 times instead of reusing `nextRandomId`

- **Where:**
  - `apps/extension/src/wallet/services/window-manager/window-manager.ts:65-68`
  - `apps/extension/src/wallet/services/task/service.ts:47-50`
  - `apps/extension/src/wallet/services/dapp-interaction/service.ts:345-349`
- **Evidence:**
  ```ts
  // window-manager.ts:65-68
  let handleId: string
  do {
      handleId = getRandomHex(8)
  } while (this.handles.has(handleId))
  ```
  ```ts
  // task/service.ts:47-50
  let taskId: string
  do {
      taskId = getRandomHex(8)
  } while (this.tasks.has(taskId))
  ```
  ```ts
  // dapp-interaction/service.ts:345-349
  let id: string
  do {
      // 16 bytes / 128 bits (codex-round-1 defense-in-depth).
      id = getRandomHex(16)
  } while (this.storage.has(id))
  ```
  The identical loop already exists as a shared helper, `packages`-adjacent at `apps/extension/src/wallet/services/id-allocators.ts:36-41`, and is already used by two *other* services in this same cluster (`dapp-session/service.ts:163` and `operation-journal/service.ts:258` both call `nextRandomId(this.storage, ...)`). Its own doc comment says the structural param type (`{ contains(id): Promise<boolean> }`) exists precisely "so a store picks one explicitly rather than re-deriving it."
- **Refactor:** The three in-memory `Map`s (`handles`, `tasks`, `storage`) only need an async adapter to match `nextRandomId`'s structural type, e.g. `nextRandomId({ contains: async (id) => this.handles.has(id) }, 8)`. Each call site collapses from 4-5 lines to 1. No new shared code needed — `nextRandomId` already lives at the correct layer (`wallet-core`-adjacent extension util, importable by all three).
- **LOC delta:** -10 (3 sites × ~4 lines saved, minus trivial adapter overhead).
- **Risk / tests:** Low — pure mechanical substitution, same semantics (loop until free). Covered by `window-manager.test.ts`, `task/service.test.ts`, `dapp-interaction/service.test.ts`.
- **Confidence:** High.

### F2 [verbosity] `getOperationAccessLevel`'s 44-line switch is a 1:1 lookup table, and its `default` branch is unreachable

- **Where:** `apps/extension/src/wallet/services/dapp-interaction/service.ts:597-640`
- **Evidence:**
  ```ts
  private getOperationAccessLevel(kind: OperationKind): AccessLevel {
      switch (kind) {
          case "register_token":
              return AccessLevel.AppState
          case "register_contract":
              return AccessLevel.PxeState
          // ...16 more single-line cases...
          default:
              return AccessLevel.None
      }
  }
  ```
  `OperationKind` (`packages/wallet-bridge/src/operation.ts:12`, `= Operation["kind"]`) has exactly 18 variants, and all 18 appear as cases here — the `default` is dead: every legal `OperationKind` value is already handled above it. Worse, that dead `default` means a *future* 19th variant silently gets `AccessLevel.None` (the weakest confirmation gate) instead of a compile error.
- **Refactor:** Replace with a top-level `const OPERATION_ACCESS_LEVELS: Record<OperationKind, AccessLevel> = { register_token: AccessLevel.AppState, ... }` (module scope, same file or `dapp-interaction/spec.ts`) and `getOperationAccessLevel = (kind: OperationKind) => OPERATION_ACCESS_LEVELS[kind]`. A `Record<OperationKind, ...>` is exhaustiveness-checked by TypeScript — adding a 19th `OperationKind` variant without updating the map becomes a compile error instead of a silent security downgrade.
- **LOC delta:** -20 (44 → ~24 lines including the object literal).
- **Risk / tests:** Low — pure data-shape change, same outputs for all 18 known kinds. `dapp-interaction/service.test.ts` exercises `execute()`'s confirmation-gating, which depends on this table.
- **Confidence:** High.

### F3 [dead-code] `TokenMintContent` class and `TaskService.getTasksSync` are unreferenced

- **Where:**
  - `apps/extension/src/wallet/services/task/spec.ts:63-74` (`TokenMintContent` class)
  - `apps/extension/src/wallet/services/task/service.ts:217-220` (`getTasksSync`)
- **Evidence:**
  ```ts
  // spec.ts:63-74
  export class TokenMintContent implements ITaskContent {
      public readonly kind = ContentKind.TokenMint
      public readonly label = "Mint token"
      constructor(
          public readonly name: string,
          ...
      ) {}
  }
  ```
  ```ts
  // service.ts:217-220
  public getTasksSync(): Task[] {
      this.cleanupStaleTasks()
      return this.getRootTasks()
  }
  ```
  `grep -rn "new TokenMintContent(" apps/ packages/` returns zero hits anywhere (including tests) — no code path ever constructs this content kind (`startNewTask`/`createNewTask` call sites all pass `StepContent`, `BalanceUpdateContent`, `ExecuteOperationContent`, `TransferContent`, or `RevokeAuthwitsContent`). `grep -rn "getTasksSync"` shows only its own declaration — not called from anywhere, not in the RPC method list (`rpcMethods` only exposes `getTask`/`getTasks`), not from a test.
  Side note (out of this cluster, informational only): `apps/extension/src/popup/components/modules/general/TokensView.vue` still branches on `ContentKind.TokenMint` in 3 switch cases — those branches are already unreachable in production since nothing produces that kind; removing `TokenMintContent` here doesn't newly break anything, but that popup-layer cleanup is a separate follow-up outside this cluster.
- **Refactor:** Delete both. `TokenMintContent`'s `ContentKind.TokenMint` enum member can stay (removing it would touch the popup layer, out of scope) but the concrete builder class is safe to delete.
- **LOC delta:** -16 (12 lines class + 4 lines dead method).
- **Risk / tests:** Low. No test references either symbol (`grep` confirms zero hits including `*.test.ts`).
- **Confidence:** High.

### F4 [duplication] `WindowManager`'s "stop watching a handle" block repeated between `detach()` and `_settle()`

- **Where:** `apps/extension/src/wallet/services/window-manager/window-manager.ts:186-193` and `:220-227`
- **Evidence:**
  ```ts
  // detach(), lines 186-193
  if (handle.timeoutHandle !== null) {
      this.clock.clearTimeout(handle.timeoutHandle)
      handle.timeoutHandle = null
  }
  if (handle.unsubOnRemoved !== null) {
      handle.unsubOnRemoved()
      handle.unsubOnRemoved = null
  }
  ```
  ```ts
  // _settle(), lines 220-227 — byte-identical body
  if (handle.timeoutHandle !== null) {
      this.clock.clearTimeout(handle.timeoutHandle)
      handle.timeoutHandle = null
  }
  if (handle.unsubOnRemoved !== null) {
      handle.unsubOnRemoved()
      handle.unsubOnRemoved = null
  }
  ```
- **Refactor:** Extract `private stopWatching(handle: Handle<unknown>): void { ...the 8 lines above... }`. `detach()` becomes a guard + one call; `_settle()` replaces its inline block with the same call.
- **LOC delta:** -6.
- **Risk / tests:** Low — `window-manager.test.ts` covers settle/cancel/timeout/detach interplay directly.
- **Confidence:** High.

### F5 [inconsistency] Two incompatible client-boilerplate styles for the same "typed RPC passthrough" concept

- **Where:**
  - Auto-installed, unvalidated passthroughs: `apps/extension/src/wallet/services/task/client.ts`, `transaction/client.ts`, `dapp-session/client.ts`, `dapp-interaction/client.ts` (all via `definePassthroughsExhaustive<Methods>()(...)`)
  - Hand-written, zod-validated passthroughs: `apps/extension/src/wallet/services/operation-journal/client.ts:29-68`
- **Evidence:**
  ```ts
  // task/client.ts — the other 3 clients in this cluster look the same
  definePassthroughsExhaustive<Methods>()(TaskServiceClient.prototype, ["getTask", "getTasks"])
  ```
  ```ts
  // operation-journal/client.ts:29-33 — one of 6 methods with this shape
  public async createOperation(input: NewOperationInput): Promise<OperationRecord> {
      validateParams(OperationJournalMethodSchemas.createOperation.params, [input], "createOperation")
      const result = await this.request("createOperation", input)
      return validateResult(OperationJournalMethodSchemas.createOperation.result, result, "createOperation")
  }
  ```
  `grep -rl "MethodSchemas" apps/extension/src/wallet/services/*/spec.ts` across the *whole* extension (not just this cluster) returns only `network/spec.ts` and `operation-journal/spec.ts` — so this is a 2-of-20+ outlier pattern, not a deliberate two-tier convention documented anywhere in this cluster.
- **Refactor:** Not proposing a change here (fixing it either means adding runtime validation to 4 more clients — pure LOC growth — or removing it from `operation-journal`, which trades away a safety net on the journal's cross-process boundary). Flagging as a genuine inconsistency worth a deliberate call: is client-side zod validation supposed to be journal/network-specific, or should it be the norm? Right now it reads as "whoever wrote this file felt like it that day."
- **LOC delta:** 0 (flag only).
- **Risk / tests:** N/A.
- **Confidence:** Medium.

### F6 [duplication] `session-established.ts`'s log-then-terminate-then-return-false block repeated 3×

- **Where:** `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:84-92`, `:94-104`, `:108-116`
- **Evidence:**
  ```ts
  if (marker && isPendingVerificationStale(marker)) {
      deps.logger.log("wallet-sdk-bg", LogLevel.Warn, `Session ${describeExternalId(session.sessionId)} established on chain ${chainId} on a stale approval — terminating`)
      deps.terminateSession(session.sessionId)
      return false
  }
  ```
  ```ts
  if (!dappSession) {
      deps.logger.log("wallet-sdk-bg", LogLevel.Warn, `Session ${describeExternalId(session.sessionId)} on chain ${chainId} has no DappSession — terminating to honor revocation`)
      deps.terminateSession(session.sessionId)
      return false
  }
  ```
  A third occurrence (profile-skew check, lines 108-116) follows the identical shape. Only the log message differs across all three.
- **Refactor:** A small local closure at the top of `handleSessionEstablished`, e.g. `const terminateWith = (msg: string): false => { deps.logger.log("wallet-sdk-bg", LogLevel.Warn, msg); deps.terminateSession(session.sessionId); return false }`, then each guard becomes `if (...) return terminateWith(\`...\`)`.
- **LOC delta:** -14 (3 call sites shrink from ~9 lines to ~3, minus the 5-line closure).
- **Risk / tests:** Low — purely mechanical, `session-established.test.ts` exercises all three branches (B-06/B-13 pins named in the file header).
- **Confidence:** High.

## Not worth it

- **`JournalReaper.start()` / `JournalGC.start()` share an alarm-wiring shape** (`operation-journal/reaper.ts:129-156`, `gc.ts:85-98`) — real but small (~9 duplicated lines each), and the file already documents (Q-05) a deliberate decision not to merge further because the boot-sweep and periodic-tick call shapes differ between the two classes. Not re-litigating a reviewed decision for ~10 lines.
- **`chainInfoToChainId` duplicated between `session-established.ts:14-19` and `queued-journal.ts:50-55`** — 6 lines, explicitly commented as inlined on purpose "to keep this module test-harness-friendly (avoids dragging the full background.ts import graph into unit tests)." Below the value bar and a deliberate trade-off.
- **`NULO_ALLOW_IFRAME_DAPPS` constant duplicated in `background.ts:89` and `content-message-relay.ts:42`** — 1 line, documented as a deliberate mirror of a build-time flag. Not worth a shared-constants module for one line.
- **The `definePassthroughsExhaustive` client boilerplate itself** (~15 lines/file × 4 clients in this cluster) — real repetition, but it's a repo-wide framework pattern (used by 20+ services outside this cluster too) already about as thin as it gets given the declaration-merge trick; fixing it means touching `@nulo/extension-messaging`, out of this cluster's scope.
- **`error-envelope.ts`'s 9-branch `instanceof` chain** — each branch has a distinct wire shape (different `data` fields) and a bespoke security-rationale comment; a lookup-table refactor wouldn't actually shrink it, just relocate the same logic.
- **`DappInteractionService.materializeRequest`'s 4 similarly-grouped switch cases** — already extracted into a shared `materialize.ts` per the file's own header, specifically to kill a previous 2-copy duplication (the goswap crash). No further action needed.
