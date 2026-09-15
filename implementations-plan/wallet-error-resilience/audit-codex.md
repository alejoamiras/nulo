# Codex audit — wallet-error-resilience

Foreign reviewer: Codex (GPT-6 Astra) at `high`, read-only sandbox, run from the plan worktree. Paths in the transcript are repo-relative or name the installed dependency under `packages/aztec-runtime/node_modules/@aztec/`.

## Round 1 — plan v1 (2026-09-15)

Session `01a0a696-a99c-77c2-9937-b8847ea264c8`. Verdict: **reject (with blocking findings: R1, R3, R5, R8)**. All 13 findings verified against the worktree and adopted in plan v2 — see plan.md "Decision log".

### Prompt

```
You are the foreign reviewer for a `/blueprint light` plan in this repo (a Bun monorepo: a Chrome-extension Aztec wallet "Nulo" under `apps/extension` + `packages/*`, and a Vue dApp under `apps/tools` that drives it through `@aztec/wallet-sdk`). You are running read-only in the worktree; read whatever you need.

Read, in this order:
1. `implementations-plan/wallet-error-resilience/plan.md` — the plan under review.
2. `implementations-plan/wallet-error-resilience/recon.md` — the codebase recon it was drafted against (reuse map + verified error-string origins).
3. `CLAUDE.md` (repo rules: package layering, comment style, testing philosophy, e2e selector rule) and `apps/extension/tests/COMPOSITION-TESTS.md` (the shallow-fake limits).

Then verify the plan's factual claims against the actual files it cites before critiquing — cite file:line for anything you dispute. Key files: `packages/extension-messaging/src/errors.ts`, `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts`, `packages/aztec-runtime/src/pxe/service.ts` (lines ~467–600 and ~884–976), `apps/extension/src/wallet/services/token-balance/{balance-projector,balance-job-queue,reconcile-pairs}.ts`, `apps/extension/src/wallet/services/execution/{contract-resolver,service}.ts`, `apps/extension/src/wallet/logger/console-forwarding.ts`, `apps/extension/src/offscreen/index.ts`, `apps/extension/src/wallet/index.ts`, `apps/extension/src/components/JsonViewer/logs-format.ts`, `apps/extension/src/wallet/utils/passkey-ceremony.ts`, `apps/tools/src/composables/{createAztecWalletSession,useWalletConnection,useSend,useHubExit,useDrip}.ts`, `apps/tools/src/lib/errors.ts`, `apps/tools/tests/browser/test-wallet/main.ts`. The installed `@aztec/pxe@5.2.0` is at `packages/aztec-runtime/node_modules/@aztec/pxe/dest/` (check `pxe.d.ts` for `sync()` and `pxe.js` for `autoSync`).

Return ONE report with these sections, in this order:

## 1. Adversarial / security review
What could go wrong? What would a malicious dApp or a hostile/flapping node target? What are we trusting that we shouldn't? Specifically attack: (a) the two new envelope arms — any leak of internal state to an arbitrary dApp, any way a dApp can distinguish wallet state it shouldn't; (b) retry amplification and cost — can a dApp or node make the wallet prove more than once extra per request, or loop the balance queue; (c) double-submission — is there ANY path where the resync-and-retry or the tools re-register-and-retry re-broadcasts a transaction; (d) the reorg semantics of proving after `pxe.sync()`; (e) the `preventDefault()` suppression scope; (f) the passkey RS256 addition.

## 2. Assumption attack
Attack the plan's Assumptions section. Which Facts (F1–F13) are misstated — check each against the file:line it cites? Which Inferences (I1–I6) are unsafe, and what would falsify them? Which Asks are missing — decisions the plan silently made that the owner should be making? Return findings under Facts / Inferences / Asks buckets.

## 3. Implementation critique
Critique the Architecture & Implementation and each phase's design. Is this the right structure, or is there a simpler / more idiomatic pattern in THIS codebase? Wrong abstraction or boundary? Do the interfaces leak? Specifically: (a) is placing `withStaleAnchorRetry` inside `withPxeWrite`'s callback (offscreen side, under the chain write guard) right, versus the SW-side `recoverMissingStoreKey` location? (b) is substring-matching the three upstream strings acceptable, and is the set right (should `RewindableRegister` be in it)? (c) the balance-queue transient path — `cancelTask` + skip `writeSyncFailure` + in-memory `retryDue` drained by the ticker: any interaction with `startBatchTasks`, `releaseOwnedTaskPointers`, the generation fences, or a profile switch that the plan misses? (d) throwing `ContractNotRegisteredError` with byte-identical messages at the six sites — any caller that would break? (e) the tools `contractsReady` + `reregisterContracts` + `retryOnUnregistered` design — the flow-ownership rule, the gate placement after `ensureSendGrant`, the `useWalletConnection.test.ts:531` 7-call pin; (f) does any part duplicate or ignore what `recon.md` found reusable? What would you build differently, and why?

## 4. Validation gates and tests
Are the per-phase gates real commands from this repo's `package.json` scripts, and do they prove what each phase claims? Is any test in the plan theatre (asserting a canned result) per COMPOSITION-TESTS.md? Is the browser e2e spec feasible with `failNext`/`holdNext` as documented in `apps/tools/tests/browser/test-wallet/main.ts`?

## 5. Findings table
Every finding as a row: `id | severity (Critical/High/Medium/Low) | file:line or plan section | claim | evidence | suggested change`. Verified claims only; mark anything you could not verify as "unverified".

## 6. Verdict
Exactly one of: `approve` | `conditional approve (with conditions: ...)` | `reject (with blocking findings: ...)`. List each condition or blocking finding by id.

Rules: be concrete and cite lines; do not propose new layers, generic abstractions, or rewrites — the plan is deliberately narrow; if something is fine, say so in one line and move on. Do NOT run any vitest e2e config, `bun run test:e2e`, `e2e:agent`, or `e2e:tools` — they kill browser processes other agents own on this host. Unit tests (`bun run --cwd <pkg> test`) are fine if you need to confirm a claim.
```

### Response

## 1. Adversarial / security review

**Confidence: high on the code findings; moderate on recovery effectiveness against a real flapping node.**

- **Envelope privacy:** constant messages are appropriate. However, “the address was supplied, therefore its class ID is public” is unsupported: instance lookup prefers wallet-local PXE data before consulting the node (`packages/aztec-runtime/src/pxe/service.ts:325`). Omit `classId` unless its disclosure is explicitly justified. Capability enforcement still precedes dispatch; I found no new unauthenticated probing route (`packages/wallet-bridge/src/dispatcher.ts:709`). **R10**
- **Retry amplification:** a hostile error containing both a stale-anchor substring and `PXE_STORE_KEY_MISSING` activates the proposed two-attempt helper, then the existing client recovery, which invokes that helper again. That permits **four PXE attempts**, contradicting “one extra prove per request” (`packages/aztec-runtime/src/pxe/client.ts:150`, `:205`). **R5**
- **Double submission:** the offscreen retry itself does not broadcast; proving precedes the separate submission step (`execution-coordinator.ts:197`, `:206`). Tools’ substring-based retry has no equivalent safety guarantee for other wallets. Also, public exits and private bridge claims contain multiple transactions, so wrapping their enclosing workflows would replay already-completed legs. **R3**
- **Reorg semantics:** `sync()` does not guarantee a fresh anchor. The underlying block stream catches processing errors and logs them without rethrowing (`…/l2_block_stream.js:178`). Successful sync processing can roll back notes, private events and facts (`…/block_synchronizer.js:123`). The plan should describe recovery as a bounded attempt, not a guaranteed move to the new fork. **R4**
- **Suppression:** consolidating the exact `"Client disconnected"` predicate is sound. Receiver-gone suppression is justified at `sendToTab`; a global substring predicate has weaker provenance and can hide unrelated bugs carrying that text. Keep the Debug record and require an `Error` with the canonical Chrome message.
- **RS256:** no blocker. The ceremony requires PRF, and derivation imports PRF bytes into HKDF; the credential’s signing algorithm is not an input (`passkey-ceremony.ts:101`, `packages/wallet-crypto/src/passkey-credential.ts:49`). This verifies derivation independence, not authenticator compatibility.

## 2. Assumption attack

### Facts

| Fact | Verification |
|---|---|
| **F1** | Correct: unclassified errors collapse to the constant at `error-envelope.ts:143`. |
| **F2** | Correct for the messaging boundary (`core/error-response.ts:21`, `errors.ts:417`), but insufficient end to end: the operation-result boundary subsequently discards both proposed codes. **R1** |
| **F3** | Correct: all four calls hold `withPxeWrite`; its catch logs and rethrows (`pxe/service.ts:948`). |
| **F4** | Correct: public `sync()` exists at installed `pxe.d.ts:207`; default `autoSync` is true at `dest/config/index.js:36`; Nulo spreads that config without overriding it (`chain-runtime.ts:148`). |
| **F5** | AnchorBlockStore origin verified (`anchor_block_store.js:24`). RewindableRegister assertion verified in `HandshakeRegistry.json`, embedded `file_map["57"].source`, lines 59–68. The node-server source attribution is **unverified** in this checkout. |
| **F6** | Overstated. Automatic reconciliation only re-enqueues rows with **`updatedAt === 0`** and no failure (`reconcile-pairs.ts:143`). Previously successful rows do not recover this way. Explicit refreshes also already enqueue failed rows (`token-balance/service.ts:208`). **R6** |
| **F7** | Ref publication timing is correct. Drip additionally has a UI-level connected gate: `DripView.vue:49` withholds its wallet during initial setup. Its composable still lacks a readiness guard. This affects the proposed browser test. **R11** |
| **F8** | Correct: the three handlers do not call `preventDefault()`. |
| **F9** | Correct (`logs-format.ts:37`), but arrays recurse before that fallback. **R12** |
| **F10** | Correct: ES256-only options and the cited test pin. |
| **F11** | Partly wrong. `service.ts:727` and `:867` are registration handlers; `:910` is authwit creation. The cited “matchers” are comments describing preserved messages, not substring-classification code. Missing throw sites include `contract-resolver.ts:130` and `service.ts:917`. **R2** |
| **F12** | Correct about ordered substrings and SDK envelope wrapping. Those UI categories do not establish that retrying a write is safe. **R3** |
| **F13** | Fault injection exists. `walletCalls` returns **counts by method**, not an ordered trace (`pages/connect.ts:175`). **R11** |

### Inferences

- **I1 — common cause:** plausible, not established. Missing header initialization and a backward register write do not uniquely identify load-balanced nodes. Reproduction against one consistent node would falsify the diagnosis.
- **I2 — RewindableRegister recovery:** plausible enough for one bounded attempt. The assertion compares the incoming origin block with the newest stored version; sync may advance the anchor or roll back facts. However, this utility can execute inside `proveTx` (`pxe.js:250`), so “only one extra ~1 s utility” is not a valid cost bound. **R4/R5**
- **I3:** verified; promote to fact.
- **I4:** repeated registration is supported by overwrite/cache behavior (`contract_store.js:84`, `:102`). It still performs hashing and other work; it is not necessarily a cheap no-op.
- **I5:** changing to an `Error` subclass while preserving messages is compatible with the inspected callers. The consequential loss occurs in `classifyOperationCatch`, not constructor comparisons. **R1**
- **I6:** reasonable for Nulo with an existing grant. It is **unverified for every wallet-sdk-compatible wallet**. Recovery must tolerate rejection, delay and disconnection.

### Asks

The owner should explicitly decide:

1. Whether automatic **write** retry is allowed for arbitrary substring-classified errors from other wallets. Recommend requiring the new structured code. **R3**
2. Whether delayed balance retries must survive SW restart for previously projected rows. The current “no persisted change” proposal does not deliver that. **R6**
3. Whether exposing wallet-local `classId` is necessary. The tools recovery re-registers everything and does not use it. **R10**

The recorded retry-once and eager/lazy-registration decisions need no reconfirmation.

## 3. Implementation critique

### Phase 1: incomplete error path

The critical flow omits:

```text
executeOperations
→ classifyOperationCatch
→ OperationResult
→ unwrapOperationResult
→ error envelope
```

`classifyOperationCatch` preserves only `DuplicateInitializationError.CODE` (`rpc-cancel.ts:75`). Consequently, both new errors become plain `Error`s in `dispatcher.ts:167` and still reach dApps as the unclassified sentence.

Extend the existing explicit allowlist and reconstruction path. If retaining details, carry only the intended fields through `OperationResult`; do not introduce blanket error-detail forwarding. Add a test covering this complete conversion chain. **R1**

Also cover the actual missing-instance path at `contract-resolver.ts:130` and missing-authwit-artifact path at `service.ts:917`. Byte-identical messages remain a sensible compatibility precaution. **R2**

### Phase 2: correct placement, incomplete recovery contract

**Inside the offscreen write callback is the right location.** It keeps the PXE instance and guard together. SW-side recovery would release that guard between calls.

Substring matching is acceptable for a narrow compatibility shim, but:

- Match the full distinctive block-hash diagnostic rather than the generic `"not found when resolving query"`.
- Treat RewindableRegister as a recovery hypothesis, not proof of node desynchronization.
- Define what happens when the explicit `sync()` throws. As written, a matching sync failure escapes untyped and defeats both the envelope and balance transient classification. **R4**
- Prevent the existing missing-store-key retry from retrying the new typed stale error. **R5**

Literal tests containing copied strings will not detect upstream wording changes. Use an installed-source/artifact check where practical, or make dependency-update verification explicit. **R13**

### Phase 3: delayed work needs lifecycle rules

`cancelTask` is a reasonable terminal state for an abandoned attempt. Let the existing identity-checked `releaseOwnedTaskPointers` release its pointer; the next attempt must receive a fresh task.

The proposed maps need additional rules:

- An external enqueue during the delay must consume, replace or explicitly defer the delayed entry.
- Success and terminal failure must remove `retryDue`, not merely clear the counter.
- Scheduling and draining must respect generation, row identity and deletion fences.
- Reset must clear maps in its `finally` cleanup.
- A stale completion must not clear a successor generation’s counter.

Otherwise an immediate refresh can succeed or fail terminally, yet the old delayed entry still triggers another attempt with a reset budget. Existing `enqueue` has no awareness of the new delay (`balance-job-queue.ts:129`). **R7**

Skipping `writeSyncFailure` is not durable scheduling for a row whose timestamp is already nonzero, nor does it clear a pre-existing failure marker. **R6**

### Phase 4: mostly sound

- Shared disconnect predicate: good reuse.
- Offscreen client send failures already become `RpcDisconnectedError` (`core/base-client.ts:168`, `:332`).
- Offscreen service response failures are caught by the response fallback/drop path, rather than converted to `RpcDisconnectedError` (`core/base-service.ts:141`). Leave these transport semantics intact.
- Formatting must include arrays in cycle handling. Replacing only the object fallback leaves self-referential arrays recursively calling `formatArg` forever (`logs-format.ts:28`). **R12**
- Passkey change: appropriately narrow.

### Phases 5–6: retain session ownership through every await

The new method needs the same **captured wallet + epoch + stale-result check + owner-only release** discipline as `finishSetup`. Merely checking `activeFlowEpoch` on entry is insufficient. An old registration completion must not mark a newly connected wallet ready or publish an old error into it. **R8**

Define recovery after registration throws. The proposal leaves:

```text
status = connected
contractsReady = false
no registration running
```

Every subsequent send then says “still setting up,” while its gate prevents reaching lazy recovery. Provide an explicit retry path or actionable reconnect state. **R9**

The send gate after `ensureSendGrant` is correct, as is preserving the initial seven-call registration pin.

Phase 6 needs an exact call-site map:

- `executeSend` performs the L1 deposit; its Aztec claim runs through `buildHubClaim` (`useSend.ts:380`).
- Public exits send an authwit transaction before the exit (`useHubExit.ts:467`).
- Private claims may register on chain before claiming (`hub-l2.ts:286`).
- `createAuthWit` itself can raise the missing-artifact error.

Retry individual safe operations, never these enclosing workflows. Keep substring classification for display/read recovery; require a documented pre-submission error contract for automatic `sendTx` retry. **R3**

## 4. Validation gates and tests

**The named scripts exist.** Package unit commands and tools typecheck are valid. Root `audit:vue` runs typecheck, extension tests and lint concurrently, then builds; it does not run every package’s tests. Add the `wallet-bridge` unit gate when fixing **R1**.

No tests or browser runners were executed during this review.

### Necessary test additions

- **Error path:** new exception → `classifyOperationCatch` → `unwrapOperationResult` → exact sanitized envelope.
- **Retry:** explicit-sync failure; stale error containing `PXE_STORE_KEY_MISSING`; terminal second failure.
- **Queue:** immediate refresh during delay, success/terminal failure clearing delayed work, reset during an in-flight projection, previously projected row after restart.
- **Session:** disconnect/reconnect during re-registration; registration rejection followed by a usable recovery action.
- **Tools:** second retry failure and ambiguous submission failure must not trigger further sends.

The helper’s scripted success/failure tests are legitimate **control-flow tests**. They do not prove reorg repair or proof validity. A canned PXE result asserted as evidence of recovered chain state would violate COMPOSITION-TESTS D2/D4. The scheduled generic network suite is a regression gate unless a targeted recovery scenario actually exercises this behavior.

### Browser spec feasibility

The first scenario is feasible with adjustments:

- Inject through `walletFrame(...).evaluate`, not the tools page’s window.
- `failNext` rejects before invoking the real wallet, so the next successful send can be real.
- Compare call-count deltas and real submission/balance results.
- To prove ordering, inspect the existing numbered log or add a small ordered trace; counts alone cannot prove it.

The second scenario is not specified well enough. Holding initial registration prevents Drip’s wallet prop from being supplied (`DripView.vue:49`), so that UI cannot exercise the new refusal branch. Use a **quiet re-grant while already connected**, hold its registration, then attempt another operation. Keep selectors testid-based. **R11**

## 5. Findings table

Paths below are repository-relative; `…/dest/` references the installed dependency under `packages/aztec-runtime/node_modules/@aztec/`.

| id | severity | file:line or plan section | claim | evidence | suggested change |
|---|---|---|---|---|---|
| **R1** | High | `apps/extension/src/wallet/services/execution/rpc-cancel.ts:75`; `packages/wallet-bridge/src/dispatcher.ts:166` | New codes will reach dApps end to end. | Operation results preserve only `DuplicateInitializationError`; other classes become plain errors. | Extend the explicit conversion contract and test the full chain. |
| **R2** | Medium | `execution/contract-resolver.ts:130`; `execution/service.ts:917`; F11 | Six sites cover missing registration; cited consumers substring-match. | Real missing-instance/artifact sites are omitted; cited “matchers” are comments. | Include relevant omitted sites and correct F11. |
| **R3** | High | Phase 6; `useSend.ts:380`; `useHubExit.ts:467`; `packages/bridge-core/src/hub-l2.ts:286` | Category-based retry cannot resubmit transactions. | Category accepts arbitrary text; actual flows contain multiple submissions and differ from the named call sites. Safety for other wallets is **unverified**. | Require a pre-submission code for write retries; identify individual calls and exclude enclosing workflows. |
| **R4** | Medium | Phase 2; `…/stdlib/dest/block/l2_block_stream/l2_block_stream.js:178`; `…/pxe/dest/block_synchronizer/block_synchronizer.js:123` | Sync guarantees a new-fork anchor; exhausted recovery is typed. | Stream errors can be swallowed; sync can roll back stores; helper leaves explicit-sync rejection unclassified. | Specify bounded best-effort recovery, classify matching sync failures, correct state/anchor claims. |
| **R5** | High | `packages/aztec-runtime/src/pxe/client.ts:150`, `:205` | At most two prove attempts per request. | Combined stale/store-key text activates both retry mechanisms, allowing four attempts. | Exclude classified stale errors from key recovery and test combined markers. |
| **R6** | Medium | `token-balance/reconcile-pairs.ts:143`; Phase 3 | Not writing `syncFailure` durably schedules recovery. | Reconcile requires zero timestamp; old failure markers also remain. | Narrow the guarantee or deliberately implement restart recovery for those rows. |
| **R7** | Medium | `token-balance/balance-job-queue.ts:129`, `:203`, `:346`; Phase 3 | Existing dedup/fences suffice for delayed retries. | Existing enqueue ignores delays; plan clears counters without clearing delayed entries on success/terminal failure. | Define delayed-entry consumption, invalidation and generation ownership; test interleavings. |
| **R8** | High | Phase 5; `createAztecWalletSession.ts:406`, `:920` | Entry-time flow ownership suffices for re-registration. | Existing setup requires post-await epoch checks; new method does not explicitly specify them. | Capture handles/epoch; fence success, error publication, flow release and retry continuation. |
| **R9** | Medium | Phase 5 `reregisterContracts` and send gates | Failed lazy registration leaves a usable retry flow. | Failure leaves connected-but-not-ready; gates prevent reaching recovery again. | Provide a retry/reconnect transition and truthful refusal copy. |
| **R10** | Medium | Phase 1 envelope; `pxe/service.ts:325` | Returned `classId` is necessarily public chain data. | Lookup can use wallet-local instance data without querying the node. A concrete unauthorized disclosure is **unverified**. | Omit the unused field or establish a scoped disclosure rule. |
| **R11** | Medium | `tests/browser/pages/connect.ts:175`; `src/views/DripView.vue:49`; Phase 6 | Existing harness proves call order and initial-setup refusal. | Counts have no order; initial setup withholds Drip’s wallet. | Use frame injection, ordered evidence and a quiet-registration scenario. |
| **R12** | Low | `apps/extension/src/components/JsonViewer/logs-format.ts:28` | Object stringify replacement handles circular inputs. | Arrays recurse before the guarded stringify. | Cover arrays with the same cycle protection and add one self-referential-array case. |
| **R13** | Low | Architecture, “Non-obvious mechanics” | Upstream string changes will fail literal unit tests. | Copied input strings remain unchanged when dependencies change. | Add source-backed verification or remove the promised drift detection. |

## 6. Verdict

**reject (with blocking findings: R1, R3, R5, R8)**

## Round 2 — plan v2 (2026-09-15, same session resumed)

Verdict: **reject (with blocking findings: R5, R14)**. All 7 findings verified and adopted in plan v3 — see plan.md "Decision log".

### Prompt

```
Round 2. Your 13 findings were each re-verified against the worktree (all held) and adopted; nothing was rejected. Re-read the revised plan in full — `implementations-plan/wallet-error-resilience/plan.md` — it is a rewrite, not a patch. Its "Decision log" table maps every R-id to what changed. The three owner decisions you asked for are handled as: (1) write retries key on the structured `CONTRACT_NOT_REGISTERED` code only, around four single pre-submission calls, never a workflow; (2) restart-durable balance retry is surfaced as Ask A1 with a "no" recommendation; (3) `classId` is dropped from the envelope.

Re-audit the revised plan with the same packet (adversarial/security, assumption attack incl. the new F14/F15/I7 and Ask A1, implementation critique, validation gates) and ONE extra ask:

**Did the fixes introduce new problems?** In particular check: (a) Phase 1's allowlist extension in `classifyOperationCatch` — is "message-only reconstructible" actually true for both classes as now specified (constant `PxeStaleAnchorError` message, `details` dropped at that boundary), and does `unwrapOperationResult` → `walletErrorFromPayload` rebuild them correctly with no `details`? (b) Phase 2's `PXE_STORE_KEY_MISSING` exclusion and constant message — does that fully close the four-attempt path you found, and does classifying a `sync()` rejection as `PxeStaleAnchorError` misclassify anything that should propagate (e.g. a generation/purge fence error thrown from inside `sync()`)? (c) Phase 3's five lifecycle rules — any interleaving still unhandled (an `enqueue` racing the drain inside the same tick; a due entry whose balance row was deleted; `startBatchTasks` minting a task for a re-enqueued id)? (d) Phase 5's `reregisterContracts` ownership discipline as now written vs `finishSetup`'s — any gap left? Is the "failed registration → status = error" transition consistent with how `ConnectionErrorStrip` / `retryCapabilities` recover today? (e) Phase 6's call-site table — are those four calls truly pre-submission in the tools code as it exists, and is leaving the hub claim / public-exit workflows unwrapped the right scoping? (f) The browser spec as rewritten — feasible with the harness as it exists (`walletFrame(...).evaluate`, `failNext` accepting a JSON-envelope string as the message, `holdNext` on `registerContract` during a quiet re-grant)?

Same output format as round 1: sections 1–4, a findings table (new ids R14+; reference prior ids only if a fix is incomplete), and the explicit verdict line — `approve` | `conditional approve (with conditions: ...)` | `reject (with blocking findings: ...)`. Cite file:line for every claim; mark anything unverified. Do NOT run any vitest e2e config or the e2e scripts. Keep it narrow: no new layers, no generic abstractions.
```

### Response

## 1. Adversarial / security review

**Confidence: high on the verified control-flow findings.** The rewrite fixes the error-conversion boundary and removes the unnecessary `classId` disclosure, but two safety gaps remain.

### Retry amplification — R5 remains incomplete

The exclusion closes the **same-message** attack, not an attacker changing messages between attempts:

1. PXE attempt 1 throws a stale-only message.
2. After sync, attempt 2 throws `PXE_STORE_KEY_MISSING`.
3. The helper propagates that nonmatching error unchanged (`plan.md:163`).
4. The SW client reprovisions and repeats the request (`packages/aztec-runtime/src/pxe/client.ts:152`, `:205`).
5. Attempts 3 and 4 can again take the stale retry.

The constant `PxeStaleAnchorError` message is never involved at step 2. Reserve provisioning recovery for a trusted **pre-operation** missing-key failure; exceptions originating inside a PXE operation must not activate it.

### Retry ownership — new R14

The revised `reregisterContracts` correctly protects **its own** await. The outer `retryOnUnregistered` still does not capture the original session before awaiting `op` (`plan.md:373`).

An old wallet call can reject after a disconnect and replacement connection. The helper then registers contracts on the replacement session and retries a closure still holding the old wallet. This matters especially for balance polling: `readBalance` retains its wallet argument, while disposal is checked only after the read settles (`useTokenBalance.ts:55`, `:59`, `:148`).

Bind the entire recovery sequence to the original wallet/session, checking before registration and again before the second operation.

### Other security conclusions

- **Envelope:** message-only reconstruction is sufficient for both proposed consumers; dropping `details` is safe for the intended behavior. `unwrapOperationResult` already supplies `{code, message}` to the reconstruction switch (`packages/wallet-bridge/src/dispatcher.ts:166`).
- **Double submission:** restricting write retry to the structured code and the individual Drip `sendTx` is sound. Leaving multi-transaction claim/public-exit workflows unwrapped is correct (`useHubExit.ts:467`; `packages/bridge-core/src/hub-l2.ts:291`).
- **Sync fences:** I found no current route by which Nulo’s generation/purge checks execute inside raw `pxe.sync()`. They run before the callback (`pxe/service.ts:958`, `:963`); raw sync enters PXE’s own queue (`dest/pxe.js:350`). However, unrelated PXE job/storage errors can escape sync and should not all become stale-anchor errors. **R4**
- **Suppression and RS256:** the revised exact-message predicates and PRF-based derivation remain appropriately scoped (`plan.md:268`; `packages/wallet-crypto/src/passkey-credential.ts:49`).

## 2. Assumption attack

### Facts

The corrected **F1–F11 and F13–F15** are materially supported by the cited code. In particular:

- **F14:** PRF bytes supply HKDF input; no signing-algorithm dependency (`passkey-credential.ts:49`).
- **F15:** the existing operation-result allowlist and reconstruction work exactly as described (`rpc-cancel.ts:75`; `dispatcher.ts:166`).
- **F12 needs a transport qualification:** the extension can return an object envelope, but the browser harness’s iframe handler reduces exceptions to a **string**, which its client JSON-encodes again. The proposed browser injection therefore does not produce the parser input assumed by the plan. **R11**

The Phase 5 assertion that `ConnectionErrorStrip` supplies a retry action is false. Its only button dismisses the error (`ConnectionErrorStrip.vue:28`). The wallet panel supplies **“Retry connection”**, invoking `connect()`, while `retryCapabilities` is exposed for capability-rejection states (`AztecWalletPanel.vue:76`, `:92`, `:110`). **R9**

### Inferences

- **I1/I2:** remain explicitly uncertain, appropriately so. Bounded retry can be retained without claiming successful reorg repair. The unit tests prove retry orchestration, not real recovery.
- **I4:** overwrite/cache behavior supports repeated registration; hashing and other work still occur (`contract_store.js:84`, `:102`).
- **I5:** the nine typed replacements preserve the inspected callers’ message contracts.
- **I6:** the Nulo-specific qualification is appropriate. Avoid the absolute assertion that *other wallets never emit the code* (`plan.md:542`); another wallet could implement the same documented contract.
- **I7:** exact node-server source attribution remains **unverified locally**. The revised separation from verified facts is correct.

### Ask A1

**“No” is a reasonable recommendation**, provided it means accepting refresh loss across restart until another trigger occurs.

Two qualifications should accompany that decision:

- A pre-existing failure marker remains until success, as Phase 3 already acknowledges (`plan.md:237`).
- Five seconds is a scheduling delay, not a maximum vulnerability window: the ticker drains awaited batches serially (`balance-job-queue.ts:156`).

A1 remains an owner decision; the review does not supply that approval.

## 3. Implementation critique

### Phase 1 — acceptable

The explicit three-class allowlist is the right change. Neither new class requires details to determine its code or public message (`plan.md:98`, `:116`). Following the existing `(message, details?)` constructor pattern lets the switch reconstruct both with `details === undefined` (`errors.ts:372`).

The stale message is constant **per wallet-authored label**, rather than globally constant; that is sufficient to prevent upstream text entering it (`plan.md:164`).

Place any combined conversion-chain test in the extension test layer. A `wallet-bridge` test should not import extension services to reach `classifyOperationCatch` or the envelope (`CLAUDE.md:113`).

### Phase 2 — two corrections remain

**R5:** add a composed client/helper test with the sequence:

```text
stale → missing-key marker → stale → success
```

The existing combined-marker test does not exercise this sequence (`plan.md:194`).

**R4:** replace “every sync rejection becomes stale-anchor” with a distinction between matching stale failures and unrelated failures. Raw sync also executes job bookkeeping and commits stores (`dest/pxe.js:209`, `:215`); those operations can fail for reasons unrelated to chain state (`job_coordinator.js:45`, `:58`). Preserve such errors rather than putting them into the balance transient-retry path.

The offscreen callback remains the correct location.

### Phase 3 — substantially improved

The five rules resolve the previously identified delayed-entry duplication and generation ownership problems.

An enqueue can occur while `syncBatch` awaits projection. After that batch releases its pointer, `startBatchTasks` can legitimately mint a new task for the queued refresh (`balance-job-queue.ts:210`, `:242`, `:346`). That is consistent with the existing queue model; an explicit refresh may intentionally supersede the delay.

One cleanup gap remains: **generation-valid delayed entries can reference deleted rows**. Check the existing `isBalanceInvalidated` callback before scheduling/draining delayed work and clear their retry state. The service marks that fence synchronously before deletion (`token-balance/service.ts:92`, `:133`). Existing write fences prevent resurrection, but do not prevent needless retry work. **R7**

### Phase 5 — method ownership fixed; recovery description still inaccurate

The method’s captured wallet, epoch checks and owner-only release correctly follow the existing lifecycle discipline (`plan.md:320`; `createAztecWalletSession.ts:378`).

The failed-registration transition to `status = "error"` is compatible with existing reconnect behavior. Correct the plan to name that behavior rather than an error-strip capability retry. **R9**

Also, `SETUP_PENDING` is **not restricted to connected sessions by the proposed guards**. `performExit` checks wallet/account/grant, while failed setup retains those refs; `performSend` likewise lacks a connected-status guard (`useHubExit.ts:509`; `useSend.ts:569`). Thus an error-state attempt can still receive “still setting up” when nothing is running. Return the actionable session error in that state.

Clarify the quiet-retry test: readiness should be **false during registration, true afterward**, not continuously true (`plan.md:317`, `:353`).

### Phase 6 — call boundaries are safe; two seams need attention

The listed operations do not themselves submit before their relevant failure:

| Site | Assessment |
|---|---|
| `useHubExit.ts:364` | `createAuthWit` creates an off-chain witness. |
| `fuelClaim.ts:127` | Direct simulation call. |
| `preflightHubExit` | Its body only simulates (`hub-l2.ts:363`); wrapping this helper is safe even when a prior authorization transaction already landed. |
| `useTokenBalance.ts:148` | The selected utility balance read does not submit. |
| `useDrip.ts:102` | One send; retry safety depends on the documented structured-code contract. |

These are four **method categories**, with multiple concrete call sites. Keep the wrapper around these operations, not `authorizeExit` or the claim workflow.

Beyond **R14**, the claim that unwrapped workflows display the existing normalized copy is unsupported. Exit uses `humanizeWalletError`, which only translates confirmation-window timeouts; send failure handling similarly ignores normalized categories except user rejection (`useHubExit.ts:584`; `useSend.ts:766`; `lib/wallet-errors.ts:25`). New envelopes can therefore appear as raw JSON. **R15**

## 4. Validation gates and tests

The revised script gates are valid, and adding `wallet-bridge` tests plus `test:all` closes the earlier coverage omission (`package.json:18`, `:33`; `packages/wallet-bridge/package.json:9`).

No tests or browser runners were executed during this review.

### Required targeted tests

- Cross-mechanism retry sequence for **R5**.
- Unrelated sync failure propagates unchanged for **R4**.
- Original wallet rejects after replacement connection; no recovery or retry against the replacement for **R14**.
- Deleted delayed balance is discarded for **R7**.
- Registration failure exposes the actual reconnect action and truthful send refusal for **R9**.
- Actual iframe serialization reaches the structured-code parser for **R11**.

The scripted helper tests remain valid orchestration tests. Change “recovery itself is proven by the unit layer” (`plan.md:305`) to “retry orchestration is proven”; real anchor recovery remains unverified, consistent with COMPOSITION-TESTS D2/D4.

### Browser scenarios

**Lazy retry: not feasible as written — R11 remains incomplete.**

The installed path is:

```text
failNext(JSON.stringify(envelope))
→ Error(envelopeText)
→ iframe handler: error = err.message
→ iframe client: Error(JSON.stringify(envelopeText))
```

Evidence: test-wallet `main.ts:64`; installed `iframe_connection_handler.js:208`; `iframe_wallet.js:136`.

One JSON parse returns a **string**, not an envelope object. Either support one bounded additional JSON-string decoding step with tests, or provide genuine object-envelope injection in the harness. Do not restore substring-triggered write retries.

**Quiet re-grant hold: feasible.** `ensureGranted` invokes `retryCapabilities` for an ungranted token (`useTokenGrant.ts:46`), and connected retries remain quiet (`createAztecWalletSession.ts:750`). Wait until the registration hold is observably reached before attempting Drip; release it before asserting recovery.

## 5. Findings table

| id | severity | file:line or plan section | claim | evidence | suggested change |
|---|---|---|---|---|---|
| **R5 — incomplete** | High | `plan.md:159`; `pxe/client.ts:152`, `:205` | The two retry mechanisms cannot chain. | A stale first failure followed by a missing-key second failure escapes unchanged and activates client recovery: up to four PXE attempts. | Reserve key recovery for trusted pre-operation failures; test changing error sequences across both layers. |
| **R14 — new** | High | `plan.md:373`; `useTokenBalance.ts:55`, `:148` | Guarding `reregisterContracts` protects the whole retry. | The original operation can outlive its session before registration begins; the closure retains the old wallet. | Bind recovery and the second attempt to the original wallet/session; recheck after awaits. |
| **R4 — incomplete** | Medium | `plan.md:160`; installed `pxe.js:209`; `job_coordinator.js:58` | Every sync rejection represents stale-anchor recovery failure. | Sync includes job/storage operations with unrelated failure modes. Nulo generation fences run outside this callback. | Classify matching stale failures; propagate unrelated failures unchanged. |
| **R7 — incomplete** | Low | `plan.md:223`; `token-balance/service.ts:92`, `:133` | Generation checks fully validate delayed entries. | Same-generation rows can be deleted while their delayed entry survives. Write fences prevent resurrection but not retry work. | Drop invalidated delayed entries using the existing callback and clear their maps. |
| **R9 — incomplete** | Medium | `plan.md:330`; `ConnectionErrorStrip.vue:28`; `AztecWalletPanel.vue:92` | Error strip provides capability retry; pending copy occurs only during registration. | Strip only dismisses; generic error recovery reconnects. Send/exit guards do not enforce connected status. | Describe/test actual reconnect recovery; distinguish failed setup from setup in progress. |
| **R11 — incomplete** | Medium | `plan.md:402`; installed iframe handler `:208`, wallet `:136` | Injected JSON-envelope text exercises the structured parser. | Iframe transport JSON-encodes that text again; one parse yields a string. | Add bounded nested-string decoding or object-envelope injection, with a transport-shaped test. |
| **R15 — new** | Medium | `plan.md:394`; `useHubExit.ts:584`; `useSend.ts:766` | Unwrapped flows display normalized contract-registration copy. | Their display paths preserve these envelope strings rather than using that category’s copy. | Map the two new codes at those existing display seams without adding retries. |

## 6. Verdict

**reject (with blocking findings: R5, R14)**

## Round 3 — plan v3 (2026-09-15, same session resumed)

Verdict: **approve**. No new findings; no prior finding incomplete. (The first two attempts at this round were killed by the harness memory watchdog; the run that completed ran under tmux.)

### Prompt

```
Round 3. All 7 round-2 findings were verified and adopted (none rejected); the plan is now v3 — re-read `implementations-plan/wallet-error-resilience/plan.md` in full. The "Decision log" has a round-2 table mapping each id to the change. The substantive changes since v2:

- **R5**: the key recovery is now gated on ORIGIN, not text — `chain-runtime.ts:145` throws a new `PxeStoreKeyMissingError extends WalletError` (only pre-op site; message text unchanged), and `pxe/client.ts:152` checks `instanceof PxeStoreKeyMissingError` instead of the substring. The helper's v2 substring exclusion is dropped as redundant. Composed tests (g)/(h) in `client-recovery.pins.test.ts`. New F16.
- **R14**: `retryOnUnregistered(session, wallet, op)` binds to the original wallet — identity checked before re-registration and again before the second attempt.
- **R4**: only a stale-shaped `sync()` rejection becomes `PxeStaleAnchorError`; anything else propagates unchanged.
- **R7**: rule (6) — invalidated rows' delayed entries dropped at schedule and at drain via `isBalanceInvalidated`.
- **R9**: recovery named correctly ("Retry connection" → `connect()`); gates check `status !== "connected"` first and return the session's error; quiet-retry test corrected. New F17.
- **R11**: `parseWalletEnvelope` decodes two levels (object-once extension shape, string-twice iframe shape) with transport-shaped tests; spec 2 waits for the hold to be observably reached.
- **R15**: `sendFailureCopy` and the exit copy map the two new categories to their copy; no retry.

Re-audit v3 with the same packet, plus: did any v3 change introduce a new problem? In particular: (a) does `errorPayload` really get attached ONLY to `WalletError` instances thrown by service code — confirm at `packages/extension-messaging/src/core/error-response.ts` / `base-service.ts` — so that a plain `Error` thrown inside `pxe.<op>()` can never reconstruct as `PxeStoreKeyMissingError` on the client, whatever its message; is there any other path (offscreen event, a different transport) by which the client could receive a forged `errorPayload`? (b) does switching the client trigger from substring to `instanceof` break any existing legitimate path — e.g. a `PXE_STORE_KEY_MISSING` thrown from somewhere other than `chain-runtime.ts:145`, or the `logOpFailure` demotion, or the `provisionChainStoreKey` exclusion? (c) the two-level decode in tools — any way a wallet-authored envelope could be mis-decoded, or an attacker-shaped message could be promoted into a structured code it does not carry? (d) anything in the helper's wallet-identity binding that `session.wallet.value` does not capture (e.g. same wallet object, different account)?

Same output format: sections 1–4, findings table (new ids R16+; prior ids only if still incomplete), and the explicit verdict line — `approve` | `conditional approve (with conditions: ...)` | `reject (with blocking findings: ...)`. Cite file:line; mark unverified claims. Do NOT run any vitest e2e config or the e2e scripts. Keep it narrow. If v3 is sound, say so and approve — do not manufacture findings.
```

### Response

## 1. Adversarial / security review

**No new security finding. Confidence: high for the reviewed control flow; real reorg recovery remains unverified.**

- **Envelope privacy:** the two new arms expose constant messages and codes, with neither `classId` nor internal `details`. Capability and account-scope enforcement still precede dispatch. The observable distinction is an actionable failure of an authorized operation, not unrestricted wallet-state enumeration. (`plan.md:116`, `plan.md:613`; `packages/wallet-bridge/src/dispatcher.ts:709`.)

- **Key-recovery origin is now trustworthy within this transport.** `buildErrorResponseContent` attaches `errorPayload` only when `error instanceof WalletError`; the service invokes that builder on caught failures. Ordinary returned objects remain nested under `result`. A plain PXE error—including one containing serialized JSON or `PXE_STORE_KEY_MISSING`—therefore reconstructs as plain `Error`. (`packages/extension-messaging/src/core/error-response.ts:21`; `core/base-service.ts:112`; `packages/extension-messaging/src/errors.ts:417`.)

- **No alternate payload-forgery route found.** The concrete extension PXE client accepts the exact offscreen document identity; responses and events take separate branches, and events cannot settle requests. Offscreen requests themselves require the background sender. The generic client’s default trust is broader, but Nulo overrides it. Compromised background/offscreen code remains trusted code, not an attacker-controlled node response. (`apps/extension/src/wallet/services/pxe/client.ts:67`; `packages/extension-messaging/src/offscreen/client.ts:65`, `:92`; `offscreen/service.ts:50`; `core/sender-auth.ts:39`.)

- **Retry amplification:** the previous four-attempt sequence is closed. The legitimate key miss occurs before the PXE operation, and key recovery’s replay bypasses its own recovery catch. Provisioning followed by stale recovery can still occur, but produces at most two actual executions of that wrapped PXE operation. This is a per-operation bound, not a global dApp rate limit. (`packages/aztec-runtime/src/pxe/chain-runtime.ts:145`; `service.ts:965`; `client.ts:198`, `:205`; `plan.md:163`, `:238`.)

- **Double submission:** no replay path introduced by the proposed wrappers was found. Proving completes before the separate node submission. Tools retries only the documented pre-submission code and single calls; ambiguous submission failures and multi-transaction workflows remain outside the retry. This relies on the selected wallet honoring that code’s contract. (`apps/extension/src/wallet/services/execution/execution-coordinator.ts:197`, `:206`; `plan.md:437`, `:449`.)

- **Reorg semantics:** `sync()` is serialized PXE work, not a finality guarantee. The retried proof uses the subsequently selected anchor; `autoSync` also runs again. Propagating unrelated sync failures fixes the earlier misclassification. (`packages/aztec-runtime/node_modules/@aztec/pxe/dest/pxe.js:350`, `:611`; `plan.md:164`, `:636`.)

- **Suppression and RS256:** suppression remains limited to exact messages and retains debug records. RS256 changes credential-algorithm negotiation; PRF availability and user verification remain required, and HKDF consumes PRF bytes rather than a credential signature. Authenticator compatibility remains unverified. (`plan.md:294`, `:314`; `apps/extension/src/wallet/utils/passkey-ceremony.ts:58`, `:101`; `packages/wallet-crypto/src/passkey-credential.ts:49`.)

## 2. Assumption attack

### Facts

No material factual misstatement remains in **F1–F17**.

| Facts | Verification |
|---|---|
| **F1, F2, F15** | Unknown errors use the constant envelope fallback; typed transport errors reconstruct through `errorPayload`; operation results require explicit code preservation. `error-envelope.ts:129`; messaging `errors.ts:417`; `rpc-cancel.ts:75`; dispatcher `:166`. |
| **F3, F4** | The four operations use the write guard; public `sync()` exists and `autoSync` defaults true. Runtime `service.ts:467`, `:488`, `:572`, `:581`, `:948`; installed `pxe.d.ts:207`, `config/index.js:36`. |
| **F5** | Both locally claimed strings exist: installed `anchor_block_store.js:24` and `@aztec/standard-contracts/artifacts/HandshakeRegistry.json:5257`. Node-server attribution is appropriately separated into I7. |
| **F6** | Failure persistence, successful clearing and reconcile’s restricted eligibility match the source. `balance-job-queue.ts:254`, `:295`; `reconcile-pairs.ts:143`. |
| **F7** | Wallet/account publication precedes registration completion; quiet registration needs an additional readiness gate. `createAztecWalletSession.ts:694`, `:881`, `:920`; `DripView.vue:49`. |
| **F8–F10** | Existing rejection logging does not suppress the browser report; arrays bypass the stringify fallback; creation currently lists ES256 only. `console-forwarding.ts:17`; `logs-format.ts:28`, `:37`; `passkey-ceremony.ts:57`. |
| **F11** | The nine listed missing-instance/artifact sites are present. Resolver `:45`, `:47`, `:130`, `:155`; execution service `:720`, `:727`, `:867`, `:910`, `:917`. |
| **F12, F13** | Iframe errors acquire the additional JSON-string layer; harness calls are counts and injection belongs in the session frame. Installed `iframe_connection_handler.js:208`, `iframe/provider/iframe_wallet.js:136`; browser `pages/connect.ts:158`, `:175`. |
| **F14** | PRF bytes enter HKDF directly. `passkey-ceremony.ts:101`; `wallet-crypto/src/passkey-credential.ts:49`. |
| **F16** | The production marker throw is pre-operation; generation/purge checks precede runtime acquisition and callback execution. Runtime `chain-runtime.ts:145`; `service.ts:918`, `:958`, `:965`. |
| **F17** | Error-state recovery calls `connect()`; capability retry is separate; existing send/exit display paths need adaptation. `AztecWalletPanel.vue:77`, `:94`, `:111`; `useSend.ts:766`; `useHubExit.ts:584`. |

### Inferences

- **I1/I2:** remain hypotheses, not correctness guarantees. A consistent-node reproduction falsifies the shared-cause diagnosis; persistent `RewindableRegister` failure after a successful sync falsifies its proposed recovery. The bounded retry remains reasonable despite that uncertainty. (`plan.md:733`, `:739`.)
- **I4/I5:** no contradictory registration-effect or caller-compatibility evidence found. Preserving messages and `Error` inheritance is appropriate. (`plan.md:743`; `contract-resolver.ts:45`; messaging `errors.ts:24`.)
- **I6:** Nulo behavior supports the design; other wallets remain unverified. (`plan.md:748`.)
- **I7:** node-source attribution remains **unverified locally**, as the plan now states. (`plan.md:753`.)

### Asks

**A1 is appropriately surfaced.** Accepting loss of delayed retries on worker restart is an owner decision; the “no” recommendation is consistent with this scope. No additional owner decision is needed. (`plan.md:760`.)

## 3. Implementation critique

- **Phase 1:** message-only reconstruction works for both specified constructors. Missing `details` does not prevent rebuilding their class/code/message. Keeping an explicit allowlist avoids promoting unrelated errors. (`plan.md:130`; messaging `errors.ts:366`; dispatcher `:166`.)

- **Phase 2:** placement inside the existing write-guard callback is correct. The typed key miss preserves the legitimate recovery route and unchanged message-based log demotion; the provisioning exclusion remains intact. Keep the narrow substring matcher, including `RewindableRegister`, with its stated experimental recovery status. (`runtime/service.ts:941`, `:956`; `client.ts:152`; `plan.md:157`, `:174`.)

- **Phase 3:** the six lifecycle rules cover the identified interleavings. Drain/enqueue mutations are synchronous; an enqueue during awaited projection is handled by pointer release followed by fresh task creation. Generation fencing protects replacement-profile maps, and invalidation checks prevent delayed work for deleted rows. No further queue change is needed. (`plan.md:246`; `balance-job-queue.ts:162`, `:232`, `:346`; token-balance `service.ts:92`.)

- **Phase 5:** ownership checks and failure-state handling fit the existing session design. Status-first gates correctly distinguish failed setup from active setup. Two-level parsing handles the actual transports without searching arbitrary prose for codes: a retry requires an explicit decoded `data.walletErrorCode`. It is structural decoding, not authentication of an arbitrary wallet. (`plan.md:348`, `:370`, `:378`; `createAztecWalletSession.ts:936`.)

- **Phase 6:** the wallet checks close the replacement-session race. **Wallet identity alone does not bind an account**, but these call sites capture account arguments, and write flows hold the existing account-switch guard. Read-only balance calls retain their captured scopes. (`useDrip.ts:45`, `:100`; `useHubExit.ts:363`, `:606`; `useTokenBalance.ts:140`; `createAztecWalletSession.ts:982`.)

The witness, simulation and utility sites are non-submitting; the drip site is one submission governed by the typed failure contract. Leaving hub claim/public-exit workflows unwrapped is correct. The display changes address their errors without replaying completed work. (`fuelClaim.ts:127`; bridge-core `hub-l2.ts:363`; `useDrip.ts:102`; `plan.md:449`, `:457`.)

The plan uses the existing transport, task, session and registration machinery. No additional abstraction is warranted.

## 4. Validation gates and tests

**The named commands exist.** Package tests, aggregate checks, builds and e2e entry points match the package scripts. `audit:vue` runs its checks in parallel before building; that does not undermine the gate. (`package.json:17`, `:24`, `:32`, `:40`; relevant package `scripts` sections.)

The planned transport, retry-count, lifecycle and state-transition assertions are meaningful. They do not claim that canned PXE results prove real chain recovery, satisfying the composition-test distinction. Real reorg recovery is explicitly **unverified**. (`COMPOSITION-TESTS.md:21`, `:39`; `plan.md:214`, `:335`.)

Both browser cases are feasible:

- `failNext` rejects before invoking the wallet; the two-level parser matches its actual transport shape.
- `holdNext` increments the observable call count and parks registration until `release()`. Waiting for that observation closes the timing hole.

(`tests/browser/test-wallet/main.ts:64`, `:78`, `:90`, `:151`; `plan.md:467`, `:477`.)

The existing seven-call connection pin can remain unchanged. (`useWalletConnection.test.ts:538`.)

**No tests or e2e commands were run during this review.**

## 5. Findings table

No new R16+ findings. No prior finding remains incomplete in the reviewed design.

| id | severity | file:line or plan section | claim | evidence | suggested change |
|---|---|---|---|---|---|
| — | — | v3 | No actionable finding | Verification above | None |

## 6. Verdict

approve
