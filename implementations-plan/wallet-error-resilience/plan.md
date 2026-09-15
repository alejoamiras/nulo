---
plan: wallet-error-resilience
tier: light
driver: claude-code
eli5_mode: artifact
eli5: https://claude.ai/artifact/CfRfD3Vtum4GVEx8UEVRDa
eli5_source: implementations-plan/wallet-error-resilience/eli5.html
code_review: off
budget: recon 3 agents (1 reuse sweep + 2 mappers); codex at high; no /code-review (owner directive 2026-09-03)
base: dev @ e01e416e
status: APPROVED 2026-09-15 (owner, conditional) — A1 = no; scope/tier/gates/stack confirmed; condition: verify real stale-anchor recovery and RS256 compatibility ON THE ARC (Phase 2 real-PXE test + Phase 4 network canary + passkey smoke) — implementing
---

# wallet-error-resilience — recover from a flapping node, name the errors, quiet the console

One user session on 2026-09-15 produced four distinct failures while the tools app drove the
extension: every transaction and balance sync failed for an hour after the node's answers went
inconsistent ("block hash not found … possibly a reorg", "not-yet-synchronized PXE",
"RewindableRegister write originates behind the current version"); a tools send failed because the
wallet had no artifact for the contract's class; every failure reached the dApp as the same opaque
sentence; and the console carried four kinds of noise that hide real errors. This plan makes the
wallet resync-and-retry once on the stale-anchor family and then fail with a *named* error, makes the
balance projector reschedule instead of pinning a "sync failed" mark on the row, gives dApps two new
error codes, makes the tools app gate sends on registration and re-register on the new code, and
removes the four noise lines.

## Scope (from the Phase 0 answers)

- **Validation layers**: typecheck + lint + unit on every phase; smoke e2e (`test:e2e`) at the end of the
  extension arc; network e2e (`e2e:agent`) once at the end of the extension arc, run alone; tools
  browser e2e (`e2e:tools`) at the end of the tools arc.
- **Delivery**: two-arc stack — arc 1 extension (typed errors, resync-and-retry, balance reschedule,
  noise sweep), arc 2 tools (registration gate + lazy re-registration), stacked because arc 2
  consumes arc 1's error code.
- **Reorg policy**: resync + retry exactly once, then a typed error. Never more. Recovery is
  bounded best-effort: a resync can advance the anchor, can roll back notes/facts, or can silently
  make no progress (the block stream swallows processing errors) — the retry is one more draw, not a
  guarantee.
- **Registration policy in tools**: eager on every connect (already true) + gate sends until it
  completes + lazy re-register-and-retry once, keyed on the structured `CONTRACT_NOT_REGISTERED`
  code only, around individual pre-submission wallet calls only.
- **Out of scope**: fixing the node endpoint itself (the wallet cannot make two nodes agree); a generic
  retry/backoff utility; changing the `UNCLASSIFIED_ERROR_MESSAGE` privacy rule; any UI redesign;
  migrations (none — no persisted shape changes; the `syncFailure` row field keeps its shape);
  wrapping the multi-transaction hub claim and exit workflows in a retry (see Phase 6 — they get the
  eager gate and the named error, not an automatic resend).
- **Not scheduled**: `/harden`. The plan touches one trust boundary (error text to dApps) and keeps the
  existing constant-message rule; no new secrets, CI, or publishing surface.
- **Owner decisions at approval (2026-09-15)**: A1 = **no** (a delayed balance retry does not survive a
  service-worker restart; the next trigger refreshes the row). Retries key on the structured code
  only; no `classId` in the envelope. **Condition attached**: the two items the audit left unverified
  by automation — that a resync really repairs the chain view, and that the widened passkey
  algorithm list is compatible with a real authenticator — must be verified on the arc, not deferred.
  That condition is met by the real-PXE integration test in Phase 2, the network canary in Phase 4,
  and the passkey checks in Phase 4.

## Success criterion

Done means, with every gate green:

1. A PXE op that fails with a stale-anchor message succeeds on the retried attempt when the node has
   recovered, and otherwise reaches the dApp as `walletErrorCode: "PXE_STALE_ANCHOR"` (never the
   unclassified sentence) — through BOTH boundaries (offscreen port and operation result). Proven by
   unit tests on the helper, the operation-result conversion, and the envelope, AND by a real-PXE
   integration test against the sandbox in which an actual L1 reorg (`anvil_reorg`) invalidates the
   anchor and the wrapped op recovers (Phase 2), AND by a network canary through the extension
   (Phase 4). If the sandbox cannot be made to produce the stale-anchor error, that is reported in
   lessons and at delivery as an unmet verification — never silently downgraded.
2. A balance chunk that fails transiently is re-run by the queue without writing `syncFailure`; after
   the bounded retries it falls back to today's behaviour unchanged. Proven by queue unit tests over
   the interleavings listed in Phase 3.
3. A send that references an unregistered contract reaches the dApp as
   `walletErrorCode: "CONTRACT_NOT_REGISTERED"`, and the tools app re-registers and retries that
   one pre-submission call once before showing an error. Proven by tools unit tests and one browser
   e2e spec using `failNext`.
4. The tools app refuses a send while registration is in flight, with one plain sentence; a failed
   registration lands the session in its existing error state with the existing retry action.
5. The four console lines from the session — the uncaught "Client disconnected", "Receiving end does
   not exist", "[object Object]", and the `pubKeyCredParams` warning — no longer appear. Proven by
   unit tests on each predicate/formatter and by a manual smoke on a dev build (recorded in lessons).
   The widened passkey algorithm list is proven compatible by the passkey smoke specs (Chrome's CDP
   virtual authenticator with PRF, ES256) staying green and by a real-device registration + unlock
   on the owner's Mac (Touch ID, ES256) recorded in lessons; RS256-only hardware (Windows Hello on a
   TPM without ES256) is not in the fleet and is stated as such, not claimed.
6. `bun run test`, `bun run test:all`, and `bun run lint` exit 0; the smoke, network, and tools e2e
   suites are green once each at their arc boundaries.

## Delivery — two arcs, one stack

| Arc | Branch | Phases | Stacks on | `code_review` |
|---|---|---|---|---|
| 1 — extension | `worktree-wallet-error-resilience` (the worktree branch, adopted as layer 1 via `gh stack init --adopt worktree-wallet-error-resilience --base dev`) | 1–4 | `dev` | off |
| 2 — tools | `wallet-error-resilience/tools` (`gh stack add wallet-error-resilience/tools` after arc 1's loop converges) | 5–6 | arc 1 | off |

Each arc is independently revertable: arc 1 leaves tools behaviour unchanged (tools' substring
classifier already recognises the new messages for display); arc 2 without arc 1 still gates sends,
and its lazy retry simply never fires (no structured code arrives).

PR titles (≤ 93 chars, Conventional Commits, become the squash subjects):

- arc 1: `fix(extension): resync-and-retry on stale pxe anchor, typed dapp errors, console noise`
- arc 2: `fix(tools): gate sends on contract registration and re-register on unregistered errors`

PRs are opened only in the Post-implementation Delivery step, after both arc loops and the cross-arc
pass converge — never during implementation.

## Phases

### Arc 1 — extension

#### Phase 1 ✓ — two typed errors, through BOTH boundaries

**What.** Add `PxeStaleAnchorError` (`CODE = "PXE_STALE_ANCHOR"`) and `ContractNotRegisteredError`
(`CODE = "CONTRACT_NOT_REGISTERED"`) to `packages/extension-messaging/src/errors.ts`, following the
`RpcDisconnectedError` shape exactly (frozen literal name through `super`; `details?: unknown`,
carried offscreen → SW only). Both are **message-only reconstructible**: every consumer needs only
the code, so the loss of `details` at the operation-result boundary is lossless for them (this is
the criterion `classifyOperationCatch` ratifies for `DuplicateInitializationError`). Wire both into
`KnownWalletErrorPayload` and the `walletErrorFromPayload` switch.

**The second boundary (codex R1).** `executeOperations` → `classifyOperationCatch`
(`apps/extension/src/wallet/services/execution/rpc-cancel.ts:75`) carries a `code` only for
`DuplicateInitializationError`; everything else becomes `{ status: "failed", error }` and
`unwrapOperationResult` (`packages/wallet-bridge/src/dispatcher.ts:166`) re-throws it as a plain
`Error`. Extend that explicit allowlist to the two new classes — `code: error instanceof X ? error.code : …` for the three classes, no blanket `WalletError` pass-through (the comment there explains
why: detail-dependent classes lose their details on this channel; ours carry none that matter).

**The envelope.** Two arms in `toWalletResponseError`
(`apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts`):

- `PxeStaleAnchorError` → `{ code: -32603, message: "The wallet's view of the chain was behind the node. Retry the request.", data: { walletErrorCode } }`.
- `ContractNotRegisteredError` → `{ code: -32602, message: "Contract not registered with the wallet. Register it and retry.", data: { walletErrorCode } }`. -32602 (invalid params): the dApp referenced a contract it never registered. **No `classId`** (codex R10 — instance lookup can be served from wallet-local PXE data without a node round-trip, so "it's public chain data" is not established, and tools re-registers everything without it). The message contains "not registered" on purpose — tools' existing substring classifier keys on it for display.
- The `ContractNotRegisteredError` arm's comment states the **pre-submission contract**: the wallet raises this code only while resolving contract instances/artifacts (request building, authwit creation, registration) — always before proving and before any broadcast. That sentence is what makes a dApp-side retry on this code safe (Phase 6).

**Throw sites.** Every site in `apps/extension/src/wallet/services/execution/contract-resolver.ts`
and `execution/service.ts` that throws one of the four messages — `"Contract not found"`,
`"Contract instance not found"`, `"Contract artifact not found"`, `` `Contract artifact not found for class ${classId}…` `` — throws `ContractNotRegisteredError` **with the message byte-identical**
(today: `contract-resolver.ts:45,47,130,155`, `service.ts:720,727,867,910,917` — the acceptance check
is `grep -n "not found" apps/extension/src/wallet/services/execution/{contract-resolver,service}.ts`
showing no bare `new Error(` left for these strings). Messages stay identical as a compatibility
precaution: the comments in `tx-request-builder.ts:20`, `authwit-discoverer.ts:146`, and
`batched-view-simulation.ts:58` document them as preserved, and callers keep working because the
class extends `Error`.

Both classes use the existing `(message, details?)` constructor pattern so the switch rebuilds them
with `details === undefined` after the message-only hop.

**Assumptions for this phase**: F1, F2, F11, F15; I5.

**Tests (inline).** `errors.test.ts`: payload round-trip for both classes (subclass restored,
`instanceof` true, code intact). `packages/wallet-bridge/src/dispatcher.test.ts`:
`unwrapOperationResult` re-throws the two subclasses from `{ status: "failed", error, code }` (no
extension imports — the layer rule). `rpc-cancel.test.ts` + `error-envelope.test.ts` (extension test
layer): the full chain — throw the class inside an operation → `classifyOperationCatch` carries the
code → `unwrapOperationResult` → `toWalletResponseError` yields the exact envelope (one test per
class; assert the node text in `details` does not appear). `contract-resolver.test.ts`: the resolver
sites produce `ContractNotRegisteredError` with the unchanged message.

**Validation gate.**
```
bun run --cwd packages/extension-messaging test
bun run --cwd packages/wallet-bridge test
bun run --cwd apps/extension test src/wallet/services/wallet-sdk/error-envelope.test.ts src/wallet/services/execution
bun run typecheck:all && bun run lint
```
Pass: all exit 0, the new cases listed above green. Layers: typecheck/lint · unit.

#### Phase 2 ✓ — resync-and-retry once on the stale-anchor family (offscreen side)

**What.** New file `packages/aztec-runtime/src/pxe/stale-anchor.ts`:

- `isStaleAnchorMessage(message: string): boolean` — true when the message contains
  `"not found when resolving query"` **and** `"reorg"` (the full distinctive block-hash diagnostic,
  not the generic first half — codex), or `"not-yet-synchronized PXE"`, or
  `"RewindableRegister write originates behind"`. Substring match because all three cross as
  message-only strings (recon, "Error-string origins") and the first arrives inside an
  `AggregateError` whose message concatenates the members.
- `withStaleAnchorRetry<T>(label, pxe, op: () => Promise<T>, log): Promise<T>` — run `op`; on a
  non-matching throw rethrow untouched; on a match: `await pxe.sync()`. **If `sync()` itself
  throws**: a stale-anchor-shaped rejection becomes `PxeStaleAnchorError` (`details.phase: "sync"`);
  any other rejection propagates unchanged (codex R4 round 2 — raw `sync()` also runs job
  bookkeeping and store commits whose failures are not chain-state failures and must not enter the
  balance transient path). Then log one info line, run `op` again; if the second throw also matches,
  throw `PxeStaleAnchorError`; a second throw that does not match propagates as-is.
- `PxeStaleAnchorError`'s **message is constant per wallet-authored label**
  (`"<label>: stale chain anchor persisted after a resync"`); the upstream text goes in
  `details.cause` (+ `details.phase: "op" | "sync"`), so no upstream text ever enters a message.

**Closing the cross-mechanism chain for good (codex R5, rounds 1–2).** The client-side store-key
recovery (`client.ts:150–205`) today re-provisions and re-issues the whole request whenever the
error *message* contains `PXE_STORE_KEY_MISSING`. A hostile node can put that text in its second
answer (stale → marker → client re-issues → stale → sync → fourth attempt). The fix is to make that
recovery trust its **origin**, not its text: the one legitimate throw site (`chain-runtime.ts:145`,
inside `registry.ensure`, which `withPxeRead`/`withPxeWrite` run **before** the op callback — F16)
throws a new `PxeStoreKeyMissingError extends WalletError` (`CODE = "PXE_STORE_KEY_MISSING"`, message
text unchanged so `logOpFailure`'s demotion keeps working), and the client's condition becomes
`err instanceof PxeStoreKeyMissingError` (rebuilt via `errorPayload`, which the service attaches only
to `WalletError`s it throws itself). An error raised *inside* `pxe.<op>()` is a plain `Error`
however its message reads, so it can never activate the key recovery. Every retry on the PXE path
is then bounded by construction: at most one stale retry per op, at most one key re-provision per
request, and the two cannot compose. `client-recovery.pins.test.ts` is updated to throw the typed
error (behaviour unchanged for the legitimate case).

Apply it inside the `withPxeWrite` callbacks of `proveTx`, `simulateTx`, `executeUtility`, and
`profileTx` in `packages/aztec-runtime/src/pxe/service.ts` (lines 467–596), wrapping only the
`pxe.<op>(…)` call. The retry runs under the same chain write guard the op already holds, so no
other write interleaves between the resync and the retry (codex agrees this is the right seam:
SW-side recovery would release the guard between calls). `pxe.sync()` is the public
`@aztec/pxe@5.2.0` method; nothing new is exposed over the port. The explicit `sync()` is kept even
though `autoSync` runs on op entry: it makes the recovery independent of the `autoSync` config,
readable at the call site, and gives the sync failure a classified home.

**Cost bound (corrected, codex I2).** One extra attempt of the wrapped op — which for `proveTx` is a
full prove, and a utility executed inside a prove is a prove too. Not "one extra ~1 s".

**Not wrapped**: the node broadcast (`sendTx` on the node client — `execution-coordinator.ts:197/206`
proves first and submits separately) and every read. A retried prove never re-broadcasts.

**Assumptions for this phase**: F3, F4, F5, F16; I1, I2, I7.

**Tests (inline).** `stale-anchor.test.ts` (behaviours-queue pattern from
`client-recovery.pins.test.ts`): (a) unrelated error → propagates, `sync` never called, `op` once;
(b) stale then ok → `sync` once, `op` twice, result returned; (c) stale twice → `sync` once, `op`
twice, `PxeStaleAnchorError` with `details.op === label` and the constant message; (d) stale then
unrelated → the unrelated error propagates; (e) the `AggregateError` shape ("2 of 6 concurrent
operations failed: Block hash … not found when resolving query. … possibly a reorg has occurred.")
matches; (f1) `sync()` rejects with stale text → `PxeStaleAnchorError` with
`details.phase === "sync"`, `op` once; (f2) `sync()` rejects with an unrelated error → that error
propagates, `op` once. `client-recovery.pins.test.ts` gains the composed sequence: (g) op rejects
stale, then rejects with a plain `Error` whose message carries `PXE_STORE_KEY_MISSING` → the client
does NOT re-provision, exactly two PXE attempts, the second error propagates; (h) the legitimate
pre-op `PxeStoreKeyMissingError` → re-provision + one retry, as today. One facade test pins that
`executeUtility` runs through the helper. These are retry-orchestration tests; they do not prove
that a resync repairs chain state (COMPOSITION-TESTS D2/D4).
`stale-anchor.sources.test.ts`: reads the installed `@aztec/pxe` `anchor_block_store` dest file and
the `HandshakeRegistry` artifact and asserts the two locally verifiable substrings still exist — so an
`@aztec` bump that rewords them reds here (codex R13; the node-server string cannot be checked
locally — it gets a line in `UPDATE.md`'s coupled-strings list instead).

**Real-recovery verification (owner condition).** `packages/aztec-runtime/src/pxe/stale-anchor.real.test.ts`,
`// @vitest-environment node`, `describe.skipIf(!process.env.ANVIL_URL || !process.env.AZTEC_NODE_URL)`
— the repo's real-data integration-test convention for code that consumes external-system data.
Against the sandbox the e2e agent boots (`apps/extension/scripts/e2e/agent.sh` exports both URLs to
vitest, `:200–202`): build a real `@aztec/pxe` runtime through `ProductionPxeFactory` (the same path
`chain-runtime.ts:148` uses), register a test account, run one op so the PXE anchors to an L2 block
`N` (`getSyncedBlockHeader().hash`), then **reorg L1 deep enough to drop the L1 block that carried
L2 block `N`** via `anvil_reorg` (anvil 1.7.1, `ANVIL_URL`) and wait for the node's tip to move past
the pruned range; then call `withStaleAnchorRetry("executeUtility", pxe, () => pxe.executeUtility(...))`
with a log spy. Assert, in order: the first attempt threw a stale-anchor message (the spy saw the
"resynced, retrying once" line), the call resolved, and `getSyncedBlockHeader().hash` is no longer
`N`'s hash (the anchor really moved). A second case runs the same op WITHOUT the helper after a
reorg and asserts it throws the stale-anchor message — the control that proves the sandbox reproduces
the failure at all. **If the control never throws** (the node prunes and `autoSync` re-anchors before
the op sees a stale hash), the test cannot verify recovery: record exactly that in
`lessons/phase-2.md`, keep the control as a documented `test.skip` with the reason, and carry it as
an unmet verification into the delivery report — do not turn it into a passing test that proves
nothing (COMPOSITION-TESTS D2/D4).

**Validation gate.**
```
bun run --cwd packages/aztec-runtime test
bun run typecheck:all && bun run lint
# real-PXE recovery test, with the sandbox up (boot it the way e2e:agent does, or reuse its ports.json):
ANVIL_URL=<from ports.json> AZTEC_NODE_URL=<from ports.json> bun run --cwd packages/aztec-runtime test src/pxe/stale-anchor.real.test.ts
```
Pass: exit 0; cases (a)–(h) + the sources test green; the real test's control case throws the
stale-anchor message and the helper case recovers with a moved anchor (or the documented skip with
its reason in lessons). Layers: typecheck/lint · unit · integration (real PXE + sandbox).

**Implementation note (2026-09-15, gate green).** The real test reproduced the failure and the
recovery on a reorged sandbox — and surfaced a second node wording for the same condition
(`Reference block … not found when querying contract …`, next to the logged `Block hash … not found
when resolving query`). `isStaleAnchorMessage` keys on their shared tail, `possibly a reorg has
occurred`, instead of the first half + `reorg`. The test PXE runs `autoSync: false` to freeze the
"synced before the prune" half of the production race, which a single-node sandbox cannot land
inside the window on its own; the account is one of the sandbox's initializerless test accounts and
the op is its `lookup_validity` utility. Details in `lessons/phase-2.md`.

#### Phase 3 — the balance queue reschedules transient failures (bounded, in-memory)

**What.** `ProjectedBalance`'s error variant gains `transient: boolean`
(`balance-projector.ts:31`); `projectChunk` sets it to `err instanceof PxeStaleAnchorError`
(the class survives the port after Phase 1 — F2). In `balance-job-queue.ts`:

- `MAX_TRANSIENT_RETRIES = 2`, `TRANSIENT_RETRY_DELAY_MS = 5_000`, an in-memory
  `transientRetries: Map<number, number>` and
  `retryDue: Map<number, { at: number; balance: TokenBalanceRaw; gen: number }>`.
- `applyProjectedError`: when `result.transient` and the id's count `< MAX_TRANSIENT_RETRIES` →
  increment, `tasks.cancelTask(taskId)` (an abandoned attempt ends in the existing terminal state;
  `releaseOwnedTaskPointers` then releases its pointer as today, so the next attempt mints a fresh
  task), record `retryDue` stamped with the batch's `gen`, and **skip** `writeSyncFailure`.
  Otherwise the existing path runs unchanged (fail + persist), and both maps drop the id.
- **Lifecycle rules (codex R7)**: (1) `enqueue()` for an id with a `retryDue` entry deletes that entry
  — an external refresh supersedes the delayed retry, no double attempt, no reset budget; (2) a
  successful `applyProjectedOk` and a terminal failure both delete `retryDue` and `transientRetries`
  for the id; (3) `tick()` drains due entries first, inside the existing generation check — an entry
  whose `gen` is not the current generation is dropped, not enqueued; (4) `reset()` clears both maps
  in its existing cleanup (`:122–123`); (5) a stale completion (generation mismatch) touches neither
  map; (6) a delayed entry whose row was invalidated (`callbacks.isBalanceInvalidated(id)`, the
  fence the service sets synchronously before a delete — `token-balance/service.ts:92,133`) is
  dropped at scheduling time and again at drain time, maps cleared (codex R7 round 2: the write
  fences already prevent resurrection; this prevents the wasted attempt). `enqueue` stays the only
  entry point into `queue`; the drain calls it. An `enqueue` that lands while `syncBatch` awaits a
  projection is the existing model: after that batch releases its pointer, `startBatchTasks` mints a
  fresh task for the queued refresh — intended.
- Rewrite the `reconcile-pairs.ts:141` comment so it describes what exists: a bounded in-memory
  retry while the SW lives, and the reconcile filter unchanged.

**What this does NOT promise (codex R6).** If the SW dies during the delay, the row is neither
stamped nor re-enqueued by reconcile (it only re-enqueues rows with `updatedAt === 0` and no
failure, `reconcile-pairs.ts:143`). The row keeps rendering its last-known balance and is refreshed
by the next trigger (an explicit refresh — `token-balance/service.ts:208` — a new tx, a token add, an
account switch), exactly like any healthy row today. A pre-existing `syncFailure` marker stays until a
successful projection clears it (`balance-job-queue.ts:295`). The 5 s is a scheduling delay, not a
bound on the window: the ticker drains batches serially (`balance-job-queue.ts:156`), so a due
entry waits behind whatever is queued. Restart-durable retry would need a persisted marker (a shape
change); it is an **Ask** (A1) at the approval gate, recommended "no".

**Assumptions for this phase**: F2, F6.

**Tests (inline).** `balance-job-queue.test.ts` (fake ticker + fake clock): transient error → task
cancelled, no `writeSyncFailure`, re-enqueued after the delay, second run ok → row updated, maps
empty; transient × 3 → the third failure persists `syncFailure` exactly as today; non-transient →
byte-identical to the existing test; an explicit `enqueue` during the delay → one attempt, the
delayed entry gone; success during the delay (from that enqueue) → no later attempt; `reset()` during
an in-flight projection → nothing re-enqueued, maps empty; a due entry from an older generation →
dropped; a due entry whose row was invalidated → dropped, no attempt, maps empty.
`balance-projector.test.ts`: `transient` is true only for `PxeStaleAnchorError`.

**Validation gate.**
```
bun run --cwd apps/extension test src/wallet/services/token-balance
bun run typecheck:all && bun run lint
```
Pass: exit 0, the existing order pins untouched and green. Layers: typecheck/lint · unit.

#### Phase 4 — the noise sweep

Four independent, small changes; one commit each.

1. **Uncaught "Client disconnected"**: in `console-forwarding.ts` call `e.preventDefault()` on the
   `isClientDisconnectRejection` branch (keep the debug log). In `offscreen/index.ts` replace
   `isBenignSwDisconnect` with the shared `isClientDisconnectRejection` and add `preventDefault()`;
   delete `is-benign-sw-disconnect.ts` and its test (the shared predicate is pinned in
   `errors.test.ts`). `preventDefault()` is what stops DevTools printing the line; the logger demotion
   alone never did (F8).
2. **"Receiving end does not exist"**: add `RECEIVER_GONE_MESSAGE = "Could not establish connection. Receiving end does not exist."`
   and `isReceiverGoneRejection(reason)` — `reason instanceof Error && reason.message === RECEIVER_GONE_MESSAGE`
   (exact canonical Chrome text, not a substring — codex) — next to `isClientDisconnectRejection` in
   `errors.ts`. The SW handler in `wallet/index.ts:76` demotes both predicates to Debug (the record is
   kept) + `preventDefault()`. `sendToTab` in `background.ts:290` catches receiver-gone (the tab or
   its content script is gone — the notification has nowhere to go) and resolves; any other error
   still rejects. The other two awaited sites are left alone on purpose: the offscreen client's send
   failures already become `RpcDisconnectedError` (`core/base-client.ts:168,332`) and the offscreen
   service's response failures take the existing drop path (`core/base-service.ts:141`).
3. **"[object Object]"**: `logs-format.ts` `formatArg` — one `WeakSet` cycle guard shared by the
   **array recursion and the object branch** (a self-referential array recurses forever today —
   codex R12); `bigint` → decimal string via a replacer; a revisited object or array renders as
   `"[circular]"`; if stringify still throws, `"[unserializable <constructor name>]"`. Never
   `String(obj)`.
4. **Passkey warning**: `passkey-ceremony.ts:57` becomes
   `[{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }]`; update the pin at
   `passkey-ceremony.test.ts:47`. ES256 stays first. Key material is the PRF extension output fed to
   HKDF (F14), so the signing algorithm is not an input. **Compatibility verification (owner
   condition)**: (i) the passkey smoke specs (`tests/e2e/passkey-paths.test.ts`,
   `passkey-backup.test.ts`, driven by the CDP virtual authenticator with PRF in
   `tests/e2e/fixtures/passkey.ts`) run explicitly in this phase's gate — register, lock/unlock,
   reset/re-import all green with the widened list; (ii) a grep pins that nothing in the wallet reads
   `getPublicKeyAlgorithm()` or otherwise depends on the credential's algorithm; (iii) a real-device
   check on the owner's Mac (build sent via `send-to-mac`; register a passkey profile with Touch ID,
   lock, unlock via passkey) recorded in `lessons/phase-4.md`. RS256-only hardware is not available;
   the plan says so rather than claiming it.

**Assumptions for this phase**: F8, F9, F10, F14.

**Tests (inline).** `errors.test.ts`: `isReceiverGoneRejection` exact-match true/false cases (a
substring-only variant is false). `console-forwarding.test.ts` (new, jsdom): a disconnect rejection
calls `preventDefault`, an unrelated one does not. `logs-format.test.ts`: a `bigint` field renders as
digits; a self-referential object AND a self-referential array render without throwing and without
"[object Object]". `passkey-ceremony.test.ts`: the updated pin.

**Network canary (owner condition).** New spec
`apps/extension/tests/e2e/network/stale-anchor-recovery.test.ts`, same shape as
`frozen-account-canary.test.ts`: connect the playground dApp, land one tx (the PXE anchors), reorg
L1 via `anvil_reorg` on `ANVIL_URL` deep enough to drop the anchor's L2 block, wait for the node tip
to move, then drive a dApp `simulateTx`/view through the wallet and assert: the op succeeds, and
`readSwLogTrail(page, { match: "stale anchor on" })` (`fixtures/journal.ts:233`, reads the SW's
`nulo:logs` ring) contains the helper's "resynced, retrying once" line. This proves the recovery
through the real extension, offscreen PXE, and node — not a fake. Same rule as Phase 2: if the
sandbox never produces the stale error, the spec documents the skip with its reason and the delivery
report carries it as unmet.

**Validation gate (also the arc-1 gate).**
```
bun run audit:vue                # typecheck:all → extension tests → lint → build
bun run test:all                 # every @nulo package's unit tests (audit:vue runs only the extension's)
bun run test:e2e                 # smoke, from apps/extension per the cd rule — includes the passkey specs
bun run e2e:agent tests/e2e/network/stale-anchor-recovery.test.ts   # the canary, first and alone
bun run e2e:agent                # full network suite, run ALONE (nothing else on the host)
```
Pass: every command exit 0; the canary's assertions as written above; a red network shard is re-run
once before triage (the suite mass-fails under host load). Layers: typecheck/lint · unit · e2e ·
e2e-live-network (sandbox; the canary is the real-recovery gate through the extension, the rest of
the suite is regression). Then manual, on the owner's Mac (`send-to-mac`): load the build, open a
tools session, confirm in DevTools that none of the four noise lines appears on a service-worker
restart; register a passkey profile with Touch ID, lock, unlock via passkey; note both in
`lessons/phase-4.md`.

### Arc 2 — tools

#### Phase 5 — `contractsReady`, envelope-aware errors, send gates

**What.**

- `createAztecWalletSession.ts`: add `contractsReady: Ref<boolean>` to `SessionState` and the
  returned session. Set `false` in `wipeToIdle`, at the top of `finishSetup` (before the await), and
  in `retryCapabilities` before `requestCapabilities`; set `true` immediately after
  `await s.config.registerContracts(flowWallet)` resolves **and the `isStale(s, flowEpoch)` check
  passes** (both the normal and the `quiet` path). Add `reregisterContracts(): Promise<boolean>`
  with **the same ownership discipline as `finishSetup`** (codex R8): no-op (`false`) when
  `!wallet.value` or `activeFlowEpoch !== null`; otherwise capture `flowWallet = s.wallet.value` and
  `flowEpoch = s.epoch`, claim `activeFlowEpoch`, set `contractsReady = false`, `await
  s.config.registerContracts(flowWallet)`, then **re-check `isStale(s, flowEpoch)` before publishing
  anything** — stale → return `false` without touching state (an old completion never marks a newer
  wallet ready or publishes an old error into it); fresh → `contractsReady = true`,
  `releaseFlowIfOwner`, return `true`. On a throw: stale → swallow and return `false`; fresh → mirror
  `finishSetup`'s catch exactly — `error = normalizeError(err)`, `status = "error"`,
  `contractsReady` stays `false`, `releaseFlowIfOwner` — and rethrow. Status never changes on success
  (quiet by definition).
- **Failed registration is not a dead end (codex R9, rounds 1–2).** Both the initial `finishSetup`
  and `reregisterContracts` land a failed registration in `status = "error"` with the normalized
  error. The recovery that exists today for that state is `AztecWalletPanel`'s **"Retry connection"**
  button, which calls `connect()` (`AztecWalletPanel.vue:77,94`) — a fresh connect that re-runs
  registration. (`ConnectionErrorStrip` only shows and dismisses the message,
  `ConnectionErrorStrip.vue:28`; `retryCapabilities` is wired to the capability-rejection state,
  `:111`.) Nothing new is added to the UI.
- **Gate order (codex R9 round 2).** A failed setup keeps `wallet`/`selectedAccount` populated, so a
  bare `!contractsReady` check would say "still setting up" when nothing is running. Each gate
  therefore checks **`status !== "connected"` first** and refuses with the session's own normalized
  error message (fallback: `"Connect your Aztec wallet first."`), and only then `!contractsReady` →
  `SETUP_PENDING`. `SETUP_PENDING` is thereby reachable only while a registration is genuinely in
  flight on a connected session.
- `src/lib/errors.ts`: add category `"chain-desync"` with copy
  `"Your wallet's view of the network was behind. Try again."`. `normalizeError` first tries
  `parseWalletEnvelope(msg)`: `JSON.parse` the message; **if the result is a string, parse it once
  more** (two levels, never deeper — codex R11 round 2: the extension transport wraps the envelope
  *object* once, `new Error(JSON.stringify(error))`, while the wallet-sdk iframe transport used by
  the embedded test wallet reduces a thrown error to its message string and then JSON-encodes that
  string again — `iframe_connection_handler.js:208`, `iframe_wallet.js:136` — so one parse yields a
  string); accept only an object with a string `data.walletErrorCode`: `PXE_STALE_ANCHOR` →
  `chain-desync`, `CONTRACT_NOT_REGISTERED` → `contract-not-registered`; anything else falls through
  to the existing substring rules unchanged. Export `walletErrorCodeOf(err): string | undefined`
  (the parsed code, or undefined) for Phase 6.
- Gates, in this order, in `performSend` (after `ensureSendGrant`, so a quiet re-grant's own
  registration has finished), `performExit` (after the `isGranted` check), and `drip()` (before
  `inflight` is set): (1) `session.status.value !== "connected"` → refuse with
  `session.error.value?.message ?? "Connect your Aztec wallet first."`; (2) `!session.contractsReady.value`
  → refuse with `SETUP_PENDING = "Your wallet is still setting up the app's contracts. Try again in a moment."`.
  Drip reads the singleton session via `useWalletConnection()`. (`DripView.vue:49` already withholds
  the wallet prop until `status === "connected"`; the composable guard covers the quiet
  re-registration window that the view cannot see.)

**Assumptions for this phase**: F7, F12; I4, I6.

**Tests (inline).** `createAztecWalletSession.test.ts`: `contractsReady` is false until
`registerContracts` resolves, true after, false again after a wallet-side disconnect during setup;
across a quiet `retryCapabilities` it is **false while the re-registration runs and true after**
(not continuously true); `reregisterContracts` returns `false` while a flow is live; returns `true`
and calls `registerContracts` once otherwise; a disconnect (epoch bump) during its await → returns
`false`, `contractsReady` untouched, no error published; a rejection → `status` `"error"`, `error`
set, `contractsReady` false, rethrown — and from that state a `connect()` walks the statuses fresh
(the "Retry connection" path). `errors.test.ts`: the two envelope codes map to their categories from
BOTH transport shapes (the object-once extension shape and the string-twice iframe shape); a
non-JSON message still hits the substring rules; a JSON message without `walletErrorCode` falls
through; three levels of nesting → undefined; `walletErrorCodeOf` returns the code / undefined.
`useSend.test.ts` / `useHubExit.test.ts`: in the error state the refusal is the session's error
message, not `SETUP_PENDING`; when connected and not ready it is `SETUP_PENDING`; the send proceeds
when ready. `useWalletConnection.test.ts:531`'s 7-call pin stays as is.

**Validation gate.**
```
bun run test:tools
bun run --cwd apps/tools typecheck
bun run lint
```
Pass: exit 0. Layers: typecheck/lint · unit.

#### Phase 6 — re-register and retry once, on the structured code, around single pre-submission calls

**What.** `apps/tools/src/composables/useWalletConnection.ts`:
`retryOnUnregistered<T>(session, wallet: Wallet, op: () => Promise<T>): Promise<T>` — `wallet` is the
handle the closure uses, passed explicitly so the helper can **bind the whole recovery to the
original session** (codex R14): run `op`; on a throw whose
`walletErrorCodeOf(e) !== "CONTRACT_NOT_REGISTERED"` rethrow (**the structured code only — never the
substring category**, codex R3: the category accepts arbitrary text from any wallet, and only Nulo
documents this code as pre-submission); then, **before re-registering**, if
`session.wallet.value !== wallet` rethrow the original (the op outlived its session — a disconnect
and replacement connection happened while it was in flight; `useTokenBalance`'s `readBalance`
retains its wallet argument and checks disposal only after the read settles, `:55,:59,:148`);
`await session.reregisterContracts()` — `false` (a flow was live, or the session went stale) →
rethrow the original; **before the second attempt**, check `session.wallet.value === wallet` again,
else rethrow the original; run `op` once more; a second throw of any kind propagates untouched.

**Exact call-site map (codex R3).** Wrap only these operations — four method categories, each with
its concrete sites — each of which completes no submission before it can raise the code:

| Operation | Sites | Why it is safe to retry |
|---|---|---|
| `createAuthWit` | `useHubExit.ts:364` (`privateBurnWitness`) | produces an off-chain witness; no transaction |
| `simulateTx` | `fuelClaim.ts:127`; the exit preflight helper `preflightHubExit` (its body only simulates, `bridge-core/src/hub-l2.ts:363` — safe to wrap even after a prior authorization transaction landed) | simulation only |
| `executeUtility` | `useTokenBalance.ts:148` (`readBalance`) | read only |
| `sendTx` | `useDrip.ts:102` | one transaction; the code is raised before proving/broadcast (Phase 1 contract) |

Wrap these operations, never `authorizeExit` or the claim workflow around them.

**Deliberately NOT wrapped**: the hub claim (`useSend.ts:380` `buildHubClaim` → bridge-core's
`.send()` chains, which include `register_token` + claim legs with journaling, `hub-l2.ts:291`) and
the public-exit workflow (`useHubExit.ts:467` authwit transaction, then the exit). These are
multi-transaction workflows; wrapping the workflow would replay completed legs. They get the Phase 5
eager gate — which removes the race that produced the observed failure — and the named error.
Wrapping their individual inner `.send()` calls inside bridge-core is a possible follow-up, not this
plan.

**Display seams for the unwrapped flows (codex R15).** Today `sendFailureCopy` (`useSend.ts:766`)
and the exit's failure copy (`useHubExit.ts:584`) hand everything but a user rejection to
`humanizeWalletError`, which only translates a confirmation-window timeout
(`lib/wallet-errors.ts:25`) — a new envelope would render as raw JSON. Both seams first run
`normalizeError` and, when the category is `contract-not-registered` or `chain-desync`, show that
category's copy; everything else keeps today's path. No retry is added at these seams.

**Browser e2e (new spec, `apps/tools/tests/browser/specs/registration-retry.spec.ts`)**, selectors by
`data-testid` only:

1. *Lazy retry*: `driveToConnected`; read `walletCalls` (a `Record<method, count>` — F13); inject via
   the wallet frame, `walletFrame(page, run, profile).evaluate(() => window.__nuloTestWallet!.failNext("sendTx", undefined, JSON.stringify({ code: -32602, message: "Contract not registered with the wallet. Register it and retry.", data: { walletErrorCode: "CONTRACT_NOT_REGISTERED" } })))`.
   The harness rejects with `new Error(thatText)` (`main.ts:64`); the iframe transport reduces it to
   the message string and JSON-encodes it again, so the dApp sees a JSON *string* — which is exactly
   the second decoding level `parseWalletEnvelope` supports (Phase 5), so the structured-code path is
   what fires. `failNext` rejects before invoking the real wallet, so the retried send is real. Run
   the drip flow as `drip.spec.ts` does; assert the count deltas — `registerContract` increased by the
   `registerAllContracts` count and `sendTx` by 2 — and the drip success state, not the error toast.
   Order evidence: the test wallet's timed RPC log (`main.ts:39`) if it is readable from the frame,
   else the deltas plus the success state.
2. *Setup-pending refusal*: on an already-connected session, `holdNext("registerContract")` via the
   frame, then trigger a quiet re-grant (pick a token not yet in `grantedContracts`;
   `useTokenGrant.ensureGranted` calls `retryCapabilities`, `useTokenGrant.ts:46`, which stays quiet
   when connected, `createAztecWalletSession.ts:750`); **wait until the hold is observably reached**
   (the `registerContract` count delta, or the frame's "injected hold" log line) before attempting a
   drip: assert the `SETUP_PENDING` copy and `sendTx` delta 0; release the hold; assert the drip
   proceeds. (The initial setup cannot be used for this — `DripView.vue:49` withholds the wallet
   until connected.)

**Assumptions for this phase**: F11, F13, F15; I4, I6.

**Tests (inline).** `useWalletConnection.test.ts`: the helper's branches (ok; unrelated error; the
substring category WITHOUT the code → no retry; code + reregister ran + second ok; code + reregister
returned false → original error; code twice → second error propagates, `op` called exactly twice;
**the original wallet rejects after a replacement connection → original error, no re-registration,
no second attempt**). `useSend.test.ts` / `useHubExit.test.ts`: the two new categories render their
copy at the display seams; other errors unchanged.

**Validation gate (also the arc-2 gate).**
```
bun run typecheck:all && bun run test:tools && bun run lint
bun run build:tools
bun run e2e:tools                # tools browser suite (owns its ports per the run-isolation rules)
```
Pass: exit 0 across the board, the new spec's two cases green. Layers: typecheck/lint · unit · e2e.

## Architecture & Implementation

**Shape.** No new layers. Two error classes join the existing `WalletError` family and its two
boundary allowlists; one narrow offscreen-side helper wraps four PXE calls; the balance queue gains a
bounded in-memory retry with explicit lifecycle rules; three existing rejection handlers gain
`preventDefault()`; the tools session gains one boolean and one epoch-fenced method, and four
single wallet calls gain one wrapper.

**Where new code lives (from recon's reuse map).**

| Change | File(s) | Reuses |
|---|---|---|
| `PxeStaleAnchorError`, `ContractNotRegisteredError`, `isReceiverGoneRejection` | `packages/extension-messaging/src/errors.ts` | `WalletError` base, payload round-trip, `isClientDisconnectRejection` |
| operation-result allowlist | `apps/extension/src/wallet/services/execution/rpc-cancel.ts` (`classifyOperationCatch`) | the `DuplicateInitializationError` code channel; `unwrapOperationResult` unchanged |
| envelope arms | `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts` | the `DuplicateInitializationError` transient arm as the model |
| typed throw sites | `execution/contract-resolver.ts`, `execution/service.ts` | messages unchanged |
| `isStaleAnchorMessage`, `withStaleAnchorRetry` | `packages/aztec-runtime/src/pxe/stale-anchor.ts` (new), applied in `service.ts` | `recoverMissingStoreKey`'s retry-once shape; `pxe.sync()` |
| `PxeStoreKeyMissingError` (origin-trusted key recovery) | `packages/extension-messaging/src/errors.ts`; thrown at `packages/aztec-runtime/src/pxe/chain-runtime.ts:145`; checked by `instanceof` in `pxe/client.ts:152` | the existing recovery sequence, unchanged except its trigger |
| tools display seams | `apps/tools/src/composables/useSend.ts` (`sendFailureCopy`), `useHubExit.ts` (exit failure copy) | `normalizeError` + `TOAST_COPY` |
| transient reschedule | `token-balance/balance-projector.ts`, `balance-job-queue.ts`, `reconcile-pairs.ts` (comment) | the ticker, `enqueue` dedup, `cancelTask`, the generation fences |
| noise | `wallet/logger/console-forwarding.ts`, `offscreen/index.ts` (+ delete `is-benign-sw-disconnect.ts`), `wallet/index.ts`, `wallet-sdk/background.ts`, `components/JsonViewer/logs-format.ts`, `wallet/utils/passkey-ceremony.ts` | shared predicates |
| tools session | `apps/tools/src/composables/createAztecWalletSession.ts`, `useWalletConnection.ts`, `useSend.ts`, `useHubExit.ts`, `useDrip.ts`, `useTokenBalance.ts`, `fuelClaim.ts`, `src/lib/errors.ts` | `finishSetup`'s ownership discipline, `normalizeError`, `useTokenGrant`'s gate placement |
| `@aztec` coupling note | `UPDATE.md` | the existing coupled-shape list |

**Key interfaces.**

```ts
// packages/extension-messaging/src/errors.ts
export class PxeStaleAnchorError extends WalletError { static readonly CODE = "PXE_STALE_ANCHOR" }   // message constant per label; details?: { op: string; phase: "op" | "sync"; cause: string }
export class ContractNotRegisteredError extends WalletError { static readonly CODE = "CONTRACT_NOT_REGISTERED" }
export class PxeStoreKeyMissingError extends WalletError { static readonly CODE = "PXE_STORE_KEY_MISSING" }  // message text unchanged from today's marker string
export const RECEIVER_GONE_MESSAGE: string
export function isReceiverGoneRejection(reason: unknown): boolean

// packages/aztec-runtime/src/pxe/stale-anchor.ts
export function isStaleAnchorMessage(message: string): boolean
export function withStaleAnchorRetry<T>(label: string, pxe: Pick<PXE, "sync">, op: () => Promise<T>, log: (line: string) => void): Promise<T>

// apps/extension/src/wallet/services/execution/rpc-cancel.ts — classifyOperationCatch's code channel
code: error instanceof DuplicateInitializationError || error instanceof PxeStaleAnchorError || error instanceof ContractNotRegisteredError ? error.code : undefined

// apps/extension/src/wallet/services/token-balance/balance-projector.ts
type ProjectedBalance = { kind: "ok"; … } | { kind: "error"; id: number; error: string; transient: boolean }

// packages/aztec-runtime/src/pxe/client.ts — the key recovery's trigger
if (method === "provisionChainStoreKey" || !(err instanceof PxeStoreKeyMissingError) || !profileId || !this.storeKeyProvider) throw err

// apps/tools/src/composables/createAztecWalletSession.ts (session surface)
contractsReady: Ref<boolean>
reregisterContracts(): Promise<boolean>

// apps/tools/src/composables/useWalletConnection.ts
export function retryOnUnregistered<T>(session: AztecWalletSession, wallet: Wallet, op: () => Promise<T>): Promise<T>

// apps/tools/src/lib/errors.ts
export function walletErrorCodeOf(err: unknown): string | undefined   // two-level JSON decode, then data.walletErrorCode
```

**Critical flow (a dApp `sendTx` during a flapping node).** dApp → wallet-sdk → `background.ts`
`handleWalletMessage` → dispatcher → `ExecutionService.executeOperations` → `PxeServiceClient.proveTx`
(SW) → port → `PxeService.proveTx` (offscreen) → `withPxeWrite` → `withStaleAnchorRetry(pxe.proveTx)`:
first attempt throws "block hash … not found … reorg" → `pxe.sync()` → second attempt. Success: proof
returns as today. Second stale failure: `PxeStaleAnchorError` → `toPayload()` on the service side →
reconstructed by `walletErrorFromPayload` on the SW side → `classifyOperationCatch` carries
`code: "PXE_STALE_ANCHOR"` in the `failed` result → `unwrapOperationResult` re-throws the subclass →
`handleWalletMessage`'s catch → `toWalletResponseError` → `{ code: -32603, data: { walletErrorCode: "PXE_STALE_ANCHOR" } }`
→ tools `normalizeError` → `chain-desync` copy.

**Non-obvious mechanics.**

- The retry runs inside the chain write guard the op already holds, so a resync cannot interleave
  with another writer; the cost is a doubled lock hold time on a stale-anchor prove (bounded: one
  retry).
- Substring matching is the only option for the three upstream strings; the constants live in one
  place (`stale-anchor.ts`) with a comment naming each string's origin. Drift detection is the
  sources test (two strings) plus the `UPDATE.md` line (the third) — not the literal unit tests,
  which can only pin our own copies.
- The balance queue's retry is in-memory and bounded; durability across a SW death is not claimed.

**Alternatives not taken.**

- Exposing `sync()` over the offscreen port and retrying from the SW-side client (the
  `recoverMissingStoreKey` location): would need four new RPC descriptors and a second round trip,
  and the retry would run outside the chain guard. Rejected — the helper sits where the lock and the
  PXE both are (codex concurs).
- A blanket `WalletError` pass-through in `classifyOperationCatch`: rejected by that file's own
  reasoning (detail-dependent classes reconstruct lossily); the allowlist grows by two message-only
  classes instead.
- Keeping the key recovery's substring trigger and having the stale helper refuse marker-bearing
  messages (v2): closes only the same-message case; a node that changes its text between attempts
  still chains the two retries (codex R5 round 2). Replaced by origin-trusted gating
  (`instanceof PxeStoreKeyMissingError`), which no message text can forge.
- A `Proxy` around the wallet-sdk `Wallet` in tools to retry every method: hides which calls retry,
  and private-field methods break under `Proxy`. Rejected for the explicit wrapper at four calls.
- Wrapping the hub claim / exit workflows: replays completed legs. Rejected; the eager gate covers
  the observed race.
- A generic `withRetry(fn, { attempts, backoff })`: the repo has five bespoke retries and no shared
  one on purpose; a sixth narrow one matches convention (recon D).
- Retrying up to three times with backoff on the stale-anchor family: each failed prove can cost
  tens of seconds; one retry catches a reorg, more only delays the honest error (Phase 0 answer).
- A persisted "retry pending" marker on the balance row: a shape change for a case (SW dies inside a
  5 s window) the next trigger already covers. Deferred to Ask A1.

## Security & Adversarial Considerations

**Threat model.** Two trust boundaries are touched: the offscreen ↔ SW port (trusted, same extension)
and the wallet → dApp response (the dApp is arbitrary). Attackers of interest: a malicious dApp
probing error text for wallet state, a malicious or flapping node, and a dApp trying to provoke
expensive retries.

- **Error text to dApps.** Both new envelope arms carry a constant message and a code; the node's raw
  text stays in `details` on the wallet side and is dropped at the operation-result boundary anyway
  (message-only channel). No `classId` (codex R10). The existing rule — unclassified throws collapse
  to one constant — is untouched; both additions are classified because they are actionable
  (`error-envelope.ts`'s own contract). Capability enforcement still precedes dispatch
  (`wallet-bridge/src/dispatcher.ts:709`); no new unauthenticated route.
- **Retry amplification.** One retry per PXE op, two per balance id with a 5 s scheduling delay,
  one per tools call. The two retry mechanisms on the PXE path cannot chain (codex R5, rounds 1–2):
  the client's key recovery fires only on `instanceof PxeStoreKeyMissingError`, which is
  reconstructed from an `errorPayload` the service attaches only to `WalletError`s thrown by its own
  code — and the one such throw site runs before the op callback. An error raised inside a PXE op is
  a plain `Error` whatever its text, and `PxeStaleAnchorError`'s message carries no upstream text.
  A hostile node that answers "not found", then a forged marker, then "not found" again gets exactly
  two PXE attempts. The user pays at most one extra attempt (possibly a full prove) and then gets a
  clear error; nothing loops the wallet.
- **Double submission.** The offscreen retry wraps proving/simulation only; the node broadcast is
  never retried by the wallet. Tools' retry re-issues a call only on the structured
  `CONTRACT_NOT_REGISTERED` code — which Nulo documents as raised before proving and broadcast — and
  only around single calls (a witness, a simulation, a utility read, one drip `sendTx`); never around
  a multi-transaction workflow; and only while the session still holds the wallet the call was made
  with. An ambiguous submission failure carries no such code and is never retried. No other wallet
  is known to emit the code; one that did would be implementing the same documented pre-submission
  contract.
- **Reorg semantics.** A resync moves the PXE anchor toward the node's current view; it can also roll
  back notes, private events, and facts, or make no progress if the block stream swallowed an error
  (codex R4). A proof built after the resync is anchored to whatever the PXE now holds; a proof
  against an orphaned anchor is rejected by the node, which is the correct failure. The helper
  mutates no wallet state itself; a stale-shaped `sync()` failure is classified, any other `sync()`
  failure propagates unchanged — never swallowed, never mislabelled.
- **Hostile input.** `parseWalletEnvelope` in tools accepts only a JSON object with a string
  `data.walletErrorCode`; every other shape falls through. `isStaleAnchorMessage` is a pure substring
  check on a string the wallet already logs.
- **Console suppression scope.** `preventDefault()` runs only on the two exact-message predicates; the
  Debug record is kept; every other rejection still surfaces at Error. A bug that happens to throw
  exactly "Client disconnected" would be hidden — the same trade the offscreen handler already made.
- **Passkey.** Adding RS256 widens the algorithms an authenticator may pick for the credential's
  signing key; the wallet derives its secret from the PRF extension output through HKDF
  (`passkey-ceremony.ts:101`, `wallet-crypto/src/passkey-credential.ts:49`), so the signing
  algorithm is not an input.
- **Supply chain / least privilege.** No new dependencies, no workflow or token changes, no secrets.
  The 7-day min-age and frozen lockfile apply unchanged.
- **Migrations.** None: `syncFailure` keeps its shape, and the transient path writes nothing.

## Assumptions

**Facts (verified in this worktree at `dev @ e01e416e`; codex round 1 re-verified F1–F13 and
corrected F5, F6, F11, F13).**

- **F1.** Unrecognised throws reach dApps as the constant `UNCLASSIFIED_ERROR_MESSAGE`;
  every actionable error needs its own `instanceof` arm — `error-envelope.ts:143` and its header
  comment; `error-envelope.test.ts:103`.
- **F2.** A thrown value that is not a `WalletError` crosses the offscreen ↔ SW port as a plain
  `Error` with only its message; a `WalletError` is rebuilt as its subclass via `errorPayload` —
  `errors.ts` `remoteErrorFromResponseContent`, `core/error-response.ts:21`, pinned at
  `errors.test.ts:205`. **This is not the last boundary**: see F15.
- **F3.** `PxeService` runs `proveTx`/`simulateTx`/`executeUtility`/`profileTx` inside `withPxeWrite`
  (`service.ts:467–596`), which holds the chain write guard and neither catches nor retries op errors
  (`service.ts:948–976`). The node broadcast is not among these four (`execution-coordinator.ts:197/206`).
- **F4.** `@aztec/pxe@5.2.0` (installed at `packages/aztec-runtime/node_modules/@aztec/pxe`) exposes
  public `sync(): Promise<void>` (`dest/pxe.d.ts:207`); `autoSync` defaults true
  (`dest/config/index.js:36`) and Nulo never overrides it (`chain-runtime.ts:148`).
- **F5.** Two of the three stale-anchor strings originate outside Nulo and are verifiable locally:
  `@aztec/pxe`'s `AnchorBlockStore` (`anchor_block_store.js:24`) and the `HandshakeRegistry`
  artifact's `RewindableRegister` assertion (embedded source lines 59–68). The block-hash string's
  attribution to the node server is I7 (not installed here).
- **F6.** The balance queue never re-enqueues a failed row on its own: `applyProjectedError` fails
  the task and writes `syncFailure` (`balance-job-queue.ts:254–266`); the reconcile pass re-enqueues
  only rows with `updatedAt === 0` and no failure (`reconcile-pairs.ts:143`); an explicit refresh
  enqueues any row (`token-balance/service.ts:208`); a successful projection clears `syncFailure`
  (`balance-job-queue.ts:295`); the ticker drains only what is queued (`:17`, `:86`).
- **F7.** Tools sets `wallet.value` (`createAztecWalletSession.ts:694`) and `selectedAccount.value`
  (`:881/889`) before `registerContracts` resolves in `finishSetup` (`:920`); `performSend`,
  `performExit`, and `drip` gate on those refs, never on registration. `DripView.vue:49` withholds
  the wallet prop until `status === "connected"`, which covers initial setup but not a quiet
  re-registration.
- **F8.** No handler under `apps/extension/src` calls `preventDefault()` on an unhandled rejection
  (grep, tests excluded: zero hits); `console-forwarding.ts:17` only demotes the log level.
- **F9.** `logs-format.ts:37` falls back to `String(arg)` when `JSON.stringify` throws; arrays
  recurse through `formatArg` before that fallback (`:28`).
- **F10.** `passkey-ceremony.ts:57` lists only `alg: -7`; the sole pin is `passkey-ceremony.test.ts:47`.
- **F11.** The "not found" throws for missing instances/artifacts sit in contract resolution,
  registration, and authwit creation (`contract-resolver.ts:45,47,130,155`,
  `execution/service.ts:720,727,867,910,917`), all of which run before `proveTx` and therefore before
  any broadcast. The references in `tx-request-builder.ts:20`, `authwit-discoverer.ts:146`, and
  `batched-view-simulation.ts:58` are comments documenting the preserved messages, not
  classification code.
- **F12.** Tools' `normalizeError` (`src/lib/errors.ts:52+`) classifies by ordered substrings on
  `err.message`; `"contract-not-registered"` matches `"unknown contract"` or `"not registered"`. The
  transport shape differs by provider: the extension provider wraps the envelope **object** once
  (`new Error(JSON.stringify(error))`, `error-envelope.ts` header); the wallet-sdk iframe provider —
  what the embedded test wallet uses — reduces a thrown error to its message string
  (`iframe_connection_handler.js:208`) and JSON-encodes that string again (`iframe_wallet.js:136`),
  so one parse yields a string. The inner message is substring-visible in both. A UI category is a
  display classification, not a retry-safety proof.
- **F13.** The tools browser harness exposes `failNext(method, pattern?, message?)` and `holdNext`
  (`tests/browser/test-wallet/main.ts:151,154`, used by `specs/recovery.spec.ts`), injected through
  the wallet frame; `walletCalls` returns **counts by method**, not an ordered trace
  (`pages/connect.ts:175`).
- **F14.** Passkey key material is the PRF extension output (`passkey-ceremony.ts:101`) imported into
  HKDF (`wallet-crypto/src/passkey-credential.ts:49`); the credential's signing algorithm is not an
  input.
- **F15.** A typed executor error is flattened a second time at the operation-result boundary:
  `classifyOperationCatch` (`rpc-cancel.ts:75`) carries a `code` only for
  `DuplicateInitializationError`, and `unwrapOperationResult` (`wallet-bridge/src/dispatcher.ts:166`)
  re-throws anything without a code as a plain `Error`.
- **F16.** The `PXE_STORE_KEY_MISSING` marker has exactly one throw site, `chain-runtime.ts:145`,
  inside `registry.ensure`, which `withPxeRead`/`withPxeWrite` call **before** the op callback
  (`service.ts:958–963`); the client's recovery (`client.ts:152`) today triggers on the message
  substring for any method except `provisionChainStoreKey`. Nulo's generation/purge fences also run
  before the callback, never inside raw `pxe.sync()` (which enters the PXE's own job queue,
  `dest/pxe.js:350`).
- **F17.** In tools, the error-state recovery is `AztecWalletPanel`'s "Retry connection" →
  `connect()` (`AztecWalletPanel.vue:77,94`); `ConnectionErrorStrip` only dismisses
  (`ConnectionErrorStrip.vue:28`); `retryCapabilities` is bound to the capability-rejection state
  (`AztecWalletPanel.vue:111`). `sendFailureCopy` (`useSend.ts:766`) and the exit copy
  (`useHubExit.ts:584`) route non-rejection errors through `humanizeWalletError`, which only
  translates a confirmation-window timeout (`lib/wallet-errors.ts:25`).
- **F18.** The sandbox harness can stage the scenario: the installed anvil (1.7.1) implements
  `anvil_reorg`; `apps/extension/scripts/e2e/agent.sh` boots anvil + the Aztec node per worktree and
  exports `ANVIL_URL` / `AZTEC_NODE_URL` to vitest (`:60–61`, `:200–202`) and accepts a spec path;
  `fixtures/aztec.ts:394` already reads `ANVIL_URL`; `fixtures/journal.ts:233` `readSwLogTrail`
  reads the SW log ring by regex; the passkey smoke specs use a CDP virtual authenticator with PRF
  (`fixtures/passkey.ts:5–23`).

**Inferences (unverified; audits should attack these).**

- **I1.** The three stale-anchor errors in the session share one cause: the node endpoint answered
  from inconsistent tips (a reorg, or load-balanced nodes disagreeing — the "2 of 6 concurrent
  operations failed" shape fits the latter). Confidence moderate; a missing header and a backward
  register write do not uniquely identify it. Falsified by reproducing against one consistent node.
  The plan does not depend on which: one resync + retry helps both, and the typed error is right for
  both.
- **I2.** The `RewindableRegister` assertion is recoverable by a resync (the anchor advances past the
  register's stored version, or the sync rolls facts back). Confidence moderate-low. If not, the
  cost is one extra attempt of the wrapped op — a full prove when the utility runs inside `proveTx`
  (`pxe.js:250`) — before the typed error; the substring can be dropped from the matcher on its own.
- **I4.** `wallet.registerContract` on an already-registered instance is idempotent in effect
  (overwrite/cache — `contract_store.js:84,102`), though not free (hashing runs). Confidence high.
- **I5.** No caller compares the "Contract … not found" errors by identity or `constructor`; all
  compatible with an `Error` subclass carrying the same message. Confidence high (codex inspected
  the callers); phase 1's tests will catch a miss.
- **I6.** `registerContract` for a contract the dApp already holds a grant for is silent (no popup) in
  Nulo, so the lazy re-registration cannot stall on a prompt. Confidence moderate-high for Nulo;
  unverified for other wallets — which is why the retry keys on the structured code and tolerates
  rejection, delay, and disconnection (a throw propagates; a stale epoch or a replaced wallet aborts
  with the original error).
- **I7.** The "Block hash … not found when resolving query … possibly a reorg" text is produced by
  the Aztec node server (`@aztec/aztec-node` `node_world_state_queries.ts`), which is not installed
  in this workspace. Confidence high (the log line carries it verbatim from the node RPC); it cannot
  be pinned by a local sources test, hence the `UPDATE.md` line.
- **I8.** An L1 reorg via `anvil_reorg`, deep enough to drop the L1 block carrying the PXE's anchor
  L2 block, makes the sandbox node answer the block-hash query with the stale-anchor error before
  `autoSync` re-anchors the PXE. Confidence moderate: the Aztec archiver does prune L2 blocks on an
  L1 reorg, but whether the PXE's next op queries with the old hash (retry fires) or re-syncs first
  (no error, nothing to prove) depends on ordering the test controls only partly. The Phase 2
  control case settles it empirically; a negative result is reported, not hidden.

**Asks — all resolved at approval (2026-09-15).**

- **A1 — decided: no.** A delayed balance retry does not survive a service-worker restart; the row
  keeps its last-known balance with no failure stamp, and the next trigger (explicit refresh, new
  tx, token add, account switch) refreshes it as it does any healthy row today. Accepted
  consequences: a refresh lost to a restart waits for that next trigger; 5 s is the scheduling delay,
  not a bound (the ticker drains batches serially).
- Confirmed: write retries key on the structured code only (Phase 6); the envelope carries no
  `classId` (Phase 1).
- Condition: real stale-anchor recovery and RS256 compatibility verified on the arc (Phase 2 real
  test, Phase 4 canary + passkey checks).

## Decision log

### Codex round 1 (reject — blocking R1, R3, R5, R8; 13 findings) → v2

Session `01a0a696-a99c-77c2-9937-b8847ea264c8`; transcript in `audit-codex.md`. Every factual claim
was re-verified against the worktree before adoption (all held).

| id | sev | verdict | what changed |
|---|---|---|---|
| R1 | High | **adopted** | Phase 1 extends `classifyOperationCatch`'s allowlist to the two message-only classes; full-chain test; F15 added; the critical flow now shows both boundaries |
| R2 | Med | **adopted** | throw-site list corrected to all nine sites incl. `contract-resolver.ts:130` and `service.ts:917`; F11 rewritten (the cited "matchers" are comments) |
| R3 | High | **adopted** | Phase 6 retries only on the structured code, only around four single pre-submission calls; the hub claim and public-exit workflows are explicitly NOT wrapped; the pre-submission contract is documented at the envelope arm |
| R4 | Med | **adopted** | `sync()` failure → `PxeStaleAnchorError` (`phase: "sync"`); recovery described as bounded best-effort; the "anchored to the new fork" claim replaced |
| R5 | High | **adopted** | constant `PxeStaleAnchorError` message (upstream text in `details.cause` only) + `isStaleAnchorMessage` refuses `PXE_STORE_KEY_MISSING`; test (g) pins the combined-marker case at two attempts |
| R6 | Med | **adopted** | durability claim withdrawn; F6 corrected (reconcile requires `updatedAt === 0`); restart-durable retry surfaced as Ask A1, recommended "no" |
| R7 | Med | **adopted** | five explicit lifecycle rules for `retryDue` / `transientRetries` + interleaving tests |
| R8 | High | **adopted** | `reregisterContracts` captures wallet + epoch, re-checks `isStale` after the await, owner-only release, stale → silent `false` |
| R9 | Med | **adopted** | a failed registration mirrors `finishSetup`'s catch (`status = "error"`), so the existing retry UI applies; the gate copy is reachable only while a registration is in flight |
| R10 | Med | **adopted** | `classId` dropped from the envelope |
| R11 | Med | **adopted** | injection via `walletFrame(...).evaluate`, count deltas + success state as evidence, scenario 2 rebuilt on a quiet re-grant hold; F13 corrected |
| R12 | Low | **adopted** | one cycle guard across arrays and objects; self-referential-array test |
| R13 | Low | **adopted** | drift claim narrowed; `stale-anchor.sources.test.ts` pins the two locally verifiable strings; the third goes to `UPDATE.md` |
| — | — | **adopted** | I3 promoted to F14 with codex's file refs; F5 split (node-server attribution → I7); I2's cost bound corrected; `bun run test:all` + the wallet-bridge unit gate added |
| — | — | **rejected** | none |

### Codex round 2 (reject — blocking R5, R14; 7 findings) → v3

Same session, resumed; transcript in `audit-codex.md`. Verified: the iframe transport really does
double-encode (`iframe_connection_handler.js:208`, `iframe_wallet.js:136`); the marker's single
throw site sits before the op callback; the tools error UI is as codex described.

| id | sev | verdict | what changed |
|---|---|---|---|
| R5 (incomplete) | High | **adopted** | v2's substring exclusion only covered a same-message attacker. v3 gates the key recovery on origin: `PxeStoreKeyMissingError` thrown at the one pre-op site, `instanceof` check in the client; the helper's exclusion is dropped as redundant; composed tests (g)/(h) added; F16 added |
| R14 (new) | High | **adopted** | `retryOnUnregistered(session, wallet, op)` binds to the original wallet — identity checked before re-registering and again before the second attempt; test added |
| R4 (incomplete) | Med | **adopted** | only a stale-shaped `sync()` rejection becomes `PxeStaleAnchorError`; anything else propagates unchanged; tests (f1)/(f2) |
| R7 (incomplete) | Low | **adopted** | rule (6): invalidated rows' delayed entries dropped at schedule and drain via the existing `isBalanceInvalidated` fence; test added |
| R9 (incomplete) | Med | **adopted** | recovery named correctly ("Retry connection" → `connect()`; the strip only dismisses); gates check `status !== "connected"` first and return the session's error; quiet-retry test corrected to false-during / true-after; F17 added |
| R11 (incomplete) | Med | **adopted** | `parseWalletEnvelope` decodes two levels (object-once extension shape, string-twice iframe shape) with transport-shaped tests; spec 1 explains the path; spec 2 waits for the hold to be reached; F12 qualified |
| R15 (new) | Med | **adopted** | the two display seams map `contract-not-registered` / `chain-desync` to their copy; no retry added |
| — | — | **adopted** | full-chain test moved to the extension test layer (layer rule); "recovery proven by the unit layer" → "orchestration proven"; I6 / "other wallets never emit" softened; A1 qualifications added |
| — | — | **rejected** | none |

### Codex round 3 (approve — no findings)

Same session, resumed. Codex confirmed: `errorPayload` is attached only to `WalletError`s thrown by
service code (`core/error-response.ts:21`, `core/base-service.ts:112`), no alternate forgery route
exists (the PXE client pins the offscreen sender, `pxe/client.ts:67`; events cannot settle requests),
the four-attempt chain is closed (per-op bound: at most two executions of a wrapped op), the
two-level decode is structural decoding not authentication, the wallet-identity binding is
sufficient because the call sites capture their account arguments and the write flows hold the
existing account-switch guard (`createAztecWalletSession.ts:982`), and both browser cases are
feasible. Explicitly still unverified by any automated gate: real reorg recovery (I1/I2) and
authenticator compatibility of RS256. No owner decision beyond A1.

### Owner approval (conditional, 2026-09-15) → v4

A1 = no; scope, tier, validation plan, two-arc stack, and both safer defaults confirmed. Condition:
"please verify on the arc" the two items codex flagged as unverified. Folded as: Phase 2's real-PXE
integration test with a control case (`anvil_reorg` on the sandbox, F18/I8), Phase 4's network
canary through the extension asserting the retry's log line via `readSwLogTrail`, and Phase 4's
passkey verification (smoke specs explicit in the gate, a no-algorithm-dependency grep, a real
Touch ID device check on the Mac). Each carries an honest failure mode: a scenario the sandbox cannot
reproduce is reported as unmet, never converted into a passing test.

## Post-implementation

Executed by the implementing session from this file. `code_review` is **off** for this plan: do NOT run
`/code-review`; the codex fix loop is the review.

**Loop placement — multi-arc.** Steps 1–3 run **per arc, at each arc boundary**: after the arc's
phases are ✓ and BEFORE `gh stack add` opens the next arc, scoped to that arc's diff while the arc is
still the stack tip. After both arcs are green and looped, run one **final cross-arc integration pass**
(step 4), then Delivery (step 5).

1. **Codex audit** (`/codex high`, fresh session, via `~/.claude/skills/codex/scripts/run-codex.sh <prompt-file> <worktree> high read-only`):
   send the arc's diff (`git diff dev...HEAD` for arc 1; `git diff worktree-wallet-error-resilience...HEAD` for arc 2), this plan.md + its decision log, the arc map ("this is arc N of 2; arc 2 builds the tools gate and retry on arc 1's `CONTRACT_NOT_REGISTERED` and `PXE_STALE_ANCHOR` codes"), an explicit adversarial/security ask ("What could go wrong? What would a malicious dApp or a hostile node target? What are we trusting that we shouldn't? Any double-submission or retry-amplification path?"), and the two rules below verbatim. Do not run codex concurrently with `bun run audit:vue` on this host (it gets OOM-killed) — sequence them.
2. **Iterative fix loop**: triage codex's findings — verify every factual claim against the repo before acting (codex can misread code). Apply the accepted fixes, commit (`fix:`/`refactor:`/`test:` conventional subjects, ≤ 100 chars), log the round (consult + verdict + adopted/rejected) in `implementations-plan/wallet-error-resilience/lessons/post-impl-arc-N.md`, then RESUME the same codex session (`resume-codex.sh <session-id> <followup-file> <codex-dir> high`) with the fix diff and ask for a re-review under the same rules. Repeat until a round yields no new material findings — rejected nitpicks do not count as churn. Still producing material findings after 3 rounds? Stop and surface to the owner: that is a scope smell, not a polish problem.
3. **Arc boundary**: only after the loop converges, `gh stack add wallet-error-resilience/tools` and begin arc 2.
4. **Final cross-arc pass**: a FRESH codex session over the net diff from `dev`, asking explicitly for cross-arc issues (seams between the arcs, duplication across them, drift from this plan), plus the two rules. Same loop-until-clean; it should converge in a round or two.
5. **Delivery**: the FIRST time any PR is opened. `gh stack sync` if `dev` moved, then `gh stack submit --auto`, then `gh pr edit` each PR with a body (what changed, why, how it was validated, the lessons links), titles per the Delivery table (≤ 93 chars), then `gh pr checks --watch`. Merging (`gh stack merge`) is the owner's call — never done by the session. Then mark this plan in `implementations-plan/index.md`.

**The no-over-engineering rule** (include verbatim in every post-impl codex prompt, initial and resumed):
"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If
code works and is clear, leave it alone."

**The comment-quality rule** (same treatment — verbatim in every post-impl codex prompt): "Audit the
comments for value per character. Flag any comment that narrates what the code visibly does, restates
its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence
works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't
have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be
few, dense, and exact."

**Lessons + manifest discipline.** Each phase writes `lessons/phase-N.md` (attempts, dead ends, the
gate output summary) and prints `LESSONS_FILE=implementations-plan/wallet-error-resilience/lessons/phase-N.md`
in the transcript. At each gate pass: `agent-worktree status wallet-error-resilience "phase N green: <next>"`.
Human-driven: stop after 3 failures on one step; autonomous loop: after 5.

**Machine rules that apply here.** Commit signing is non-interactive on this host — keep signing.
Never run `bun run test:e2e` or `e2e:agent` from the repo root without `--cwd`/`cd` (they pkill the
dist's Chromes); run the network suite alone. Long e2e runs go in `tmux`.

## Seeds

FINAL — approved scope (2026-09-15, A1 = no, verification condition folded). Mirrored in the ELI5
Artifact. Use exactly ONE per session — they do not compose. Run the implementing session INSIDE
this worktree (`agent-worktree resume wallet-error-resilience`).

**Recommended: `/goal`** (completion is transcript-observable).

```
/goal All six phases marked ✓ in implementations-plan/wallet-error-resilience/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript (phase 2's gate includes the real-PXE stale-anchor test against the sandbox with its control case, or its documented skip reason; phase 4's gate includes bun run audit:vue, bun run test:all, the smoke suite with the passkey specs, the stale-anchor-recovery network canary run first and alone, and one solo full network e2e run; phase 6's includes bun run e2e:tools); for each phase the agent has printed `LESSONS_FILE=implementations-plan/wallet-error-resilience/lessons/phase-N.md` in the transcript; /code-review was NOT run (code_review is off); the codex fix loop converged for arc 1 at its boundary, for arc 2 at its boundary, and for the final cross-arc pass — each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the two-PR stack from plan.md's Delivery section exists on GitHub, created only AFTER all three loops converged (`gh stack view` output in the transcript); the delivery report names any verification the sandbox could not reproduce as unmet; `bun run test`, `bun run test:all`, and `bun run lint` all report exit 0 in the transcript.
```

**Alternative: `/loop 15m`**

```
/loop 15m Drive implementations-plan/wallet-error-resilience forward. Never idle waiting for my input. Each firing:
1. **Reality check**: read implementations-plan/wallet-error-resilience/plan.md and lessons/ (authoritative state — not the chat); native task list empty (fresh session)? rebuild it from plan.md, one task per remaining phase / loop / delivery step; run `git status` and `git log --oneline -5`. If a PR exists, `gh stack view` (no --watch). Without a PR but with CI configured, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **Waiting on CI is fine** — confirm it's actually progressing (`gh run watch <run-id>` up to 10 minutes; queued or stuck past that → inspect logs, log it as blocked in lessons). Use the wait productively: review the diff, prep the next phase, strengthen tests. Don't start work that would conflict with the in-flight change.
3. **No task in hand?** Pick the next pending phase from plan.md and start it. After each meaningful edit, run the fast layers (`bun run lint` + the touched package's `test`) — catch mistakes in-step, not phases later. Then commit → push (`gh stack push`; `gh stack sync` if dev or arc 1 moved).
4. **Stuck, or facing a decision you'd normally bring to me?** Don't wait. Call `/codex high` with full context and go back and forth until you two reach a defensible decision, then act on it. Log every consult + verdict in lessons/phase-N.md. Exception — hard limits stay hard: never merge to dev or main, never publish or deploy, never expand scope beyond plan.md; if the decision requires crossing one, surface it and hold.
5. **Same step failed 5 times?** Stop retrying; reassess the approach with codex, then continue down the agreed path.
6. **Phase green?** "Green" means THE PHASE'S VALIDATION GATE as written in plan.md passes (commands + pass criteria — for phase 2 that includes the real-PXE stale-anchor test with its control case; for phase 4 the stale-anchor-recovery canary and the passkey smoke specs). A sandbox scenario that cannot be reproduced is written up in lessons and carried as unmet — never converted into a passing test. Run the full gate, paste the result, mark ✓ in plan.md, file the lessons entry, print `LESSONS_FILE=implementations-plan/wallet-error-resilience/lessons/phase-N.md`, run `agent-worktree status wallet-error-resilience "phase N green: <next>"`, advance. Arc boundary crossed (after phase 4, after phase 6)? Run the arc's codex loop FIRST (code_review is off — no /code-review): `/codex high` (under tmux on this host — the harness's memory watchdog kills background codex runs) with the arc diff, the arc map, the plan's no-over-engineering + comment-quality rules, until a round yields nothing material — THEN `gh stack add wallet-error-resilience/tools` before arc 2's work.
7. **All phases ✓?** Close out per plan.md's Post-implementation section: the final cross-arc codex pass (FRESH session, net diff from dev, cross-arc ask + the two rules, loop until clean), then Delivery — the FIRST time any PR is opened: `gh stack sync` then `gh stack submit --auto` + `gh pr edit` bodies, then `gh pr checks --watch`. Then write the wrap-up report: what shipped, every contentious decision codex and I debated — each with ELI5 context — and open items. Surface and stop. Never `gh stack merge`.

Keep the native task list current (`TaskUpdate` as steps start/finish; plan.md stays the source of truth).
```
