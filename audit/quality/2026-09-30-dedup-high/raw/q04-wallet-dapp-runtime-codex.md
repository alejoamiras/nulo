# q04-wallet-dapp-runtime — codex

Scope read:

- `CLAUDE.md`, `implementations-plan/lessons.md`, the supplied outer/wallet repo maps, production clone leads, and both prior quality reports.
- Production source under `apps/extension/src/wallet/services/{wallet-sdk,dapp-interaction,dapp-session,auth-registry,network,pxe,window-manager,logger,log-viewer}/`.
- `apps/extension/src/wallet/{runtime.ts,single-flight-start.ts,utils/,logger/,config/,constants/,base/}`.
- `apps/extension/src/{offscreen/,presto/,core/adapters/,content-script/}`.
- Immediate dependency implementations: `packages/aztec-runtime/src/adapters/{aztec-node-factory-adapter.ts,index.ts}`, `apps/extension/src/wallet/services/purge-rows.ts`, and `apps/extension/src/wallet/services/task/wrapped-task.ts`.
- Selected network, auth-registry, session-establishment, and queued-journal test bodies.

Read-only inspection; no files changed or tests executed. Commit counts below use the current branch’s path history, without `--follow`, reported as **total / since 2026-06-01**. Counts measure file churn, not changes to individual functions.

## q04-wallet-dapp-runtime-X-1: Endpoint creation and editing duplicate identity validation

**Title:** Endpoint creation and editing duplicate identity validation. **RECURRING (prior: 2026-08-16 Q-09, network instance).**

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** **Local**, high confidence. Two mutation paths in one service; changes affect endpoint creation and editing. `network/service.ts`: **31 / 31 commits**.

**Concrete evidence:** Both methods resolve the active profile, read the owned network to obtain its kind, probe outside the lock, reread ownership inside the lock, and independently check both composite chain identity and exact L1 identity:

- `apps/extension/src/wallet/services/network/service.ts:592-629` — `addEndpoint`.
- `apps/extension/src/wallet/services/network/service.ts:632-682` — `updateEndpoint`.

The duplicated identity checks are specifically at `603-615` and `650-661`. The second block explicitly refers readers to the first block’s rationale for exact L1 equality.

**Why it harms future change:** Changes to endpoint identity validation must land in both mutation paths. The existing L1-equality rule already demonstrates that obligation: both copies contain the same additional check and error construction. Updating only one changes which endpoints can be added versus edited.

**Smallest safe refactoring:** **Extract Function** into private helpers in `network/service.ts`: one for the unlocked owned-network lookup/probe, and one synchronous assertion for the probed identity against the locked reread. Preserve the existing lock boundaries, error ordering, collision messages, and update-only cache eviction.

**What disappears:** One duplicate lookup/probe preamble and one duplicate two-branch identity validator. Operation-specific insertion/replacement remains explicit.

**Instances:**

- `apps/extension/src/wallet/services/network/service.ts:595`
- `apps/extension/src/wallet/services/network/service.ts:640`

## q04-wallet-dapp-runtime-X-2: RPC transport allowlist has two policy owners

**Title:** RPC transport allowlist has two policy owners.

**Smell name:** Duplicate Code / Shotgun Surgery — Fowler. Changing the shared scheme/loopback rule requires edits in independently maintained application and package modules.

**Maintenance impact:** **Structural**, high confidence. Two implementation files across the extension and `aztec-runtime`; covers endpoint validation and actual node construction/probing. History: `network/spec.ts` **9 / 9**; `aztec-node-factory-adapter.ts` **5 / 4**.

**Concrete evidence:** Both implementations parse a URL, accept HTTPS, permit HTTP only for `localhost`, `127.0.0.1`, or `[::1]`, and reject other schemes:

- `apps/extension/src/wallet/services/network/spec.ts:151-178` — `RpcUrlSchema`.
- `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58-73` — `isAllowedRpcUrl`.

The adapter’s `createNode`, `createSingleAttemptNode`, `probeChainId`, and `readPublicStorageOnce` call its local checker at `76-107`. Its header describes the policy as matching the schema. The implementations already have different surrounding rules: the schema rejects userinfo at `166`, while the adapter accepts HTTPS immediately at `66`.

**Why it harms future change:** Maintaining the same transport policy at both boundaries requires copying every scheme/host adjustment. The existing userinfo difference also means a reviewer must distinguish intentionally stronger schema validation from accidental drift by comparing implementations.

**Smallest safe refactoring:** **Move Function / Extract Function**: place the shared transport-policy checker in a lightweight `packages/wallet-core/src/utils/rpc-url.ts`, exported through `@nulo/wallet-core/utils`. Both higher layers may import it. Keep both enforcement sites, their error presentation, and the schema’s additional userinfo restriction unchanged.

**What disappears:** One independently maintained scheme decision tree and one copy of the three-host loopback allowlist. Validation still runs at both boundaries.

**Instances:**

- `apps/extension/src/wallet/services/network/spec.ts:155`
- `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58`

## q04-wallet-dapp-runtime-X-3: Auth-registry mutations repeat the transaction settlement workflow

**Title:** Auth-registry mutations repeat the transaction settlement workflow.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** **Local**, high confidence. Two public mutation methods in one service; affects revocation and registry enable/disable. `auth-registry/service.ts`: **14 / 14 commits**.

**Concrete evidence:** Both methods submit a UI-origin transaction with the captured execution fence, wait through `TransactionService`, obtain the initiating network’s node, wait for the transaction’s block to become proven, synchronize registry state, and complete the task; both catches convert cancellation, fail the task, and rethrow:

- `apps/extension/src/wallet/services/auth-registry/service.ts:281-321` — revocation.
- `apps/extension/src/wallet/services/auth-registry/service.ts:336-375` — enable/disable.

The meaningful differences are the action list, task content, and final synchronization callback (`syncAuthwits` versus `syncStatus`).

**Why it harms future change:** Adjusting confirmation handling, endpoint pinning, or cancellation propagation requires editing both workflows. The existing test at `apps/extension/src/wallet/services/auth-registry/service.test.ts:199-213` already checks both paths together because they must preserve the same fence-capture ordering.

**Smallest safe refactoring:** **Extract Function / Parameterize Function**: a private registry-mutation runner in `auth-registry/service.ts`, receiving the prepared operation, task, captured fence, network, and synchronization callback. Keep each public method’s validation and early fence capture in place; the runner must consume that fence rather than capture another.

**What disappears:** One copy of the submit → wait → pinned-node → proven → synchronize workflow, plus one duplicate completion/cancellation/error-handling block.

**Instances:**

- `apps/extension/src/wallet/services/auth-registry/service.ts:281`
- `apps/extension/src/wallet/services/auth-registry/service.ts:336`

## q04-wallet-dapp-runtime-X-4: Three auth-registry purge paths repeat the same cleanup sequence

**Title:** Three auth-registry purge paths repeat the same cleanup sequence.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** **Local**, high confidence. Three lifecycle entry points in one service, reached by account, profile, and chain deletion. `auth-registry/service.ts`: **14 / 14 commits**.

**Concrete evidence:** Each path independently composes the same ordered cleanup: enumerate matching decoded authwits, delete and emit through `purgeRows`, purge matching malformed rows, then delete matching registry-status keys:

- `apps/extension/src/wallet/services/auth-registry/service.ts:512-538` — account scopes.
- `apps/extension/src/wallet/services/auth-registry/service.ts:541-557` — profile.
- `apps/extension/src/wallet/services/auth-registry/service.ts:561-577` — chain.

Only the scope predicates differ. The account-scoped raw predicate additionally checks field types before constructing its membership key.

**Why it harms future change:** Repairs to malformed-row cleanup, deletion/event ordering, or secondary-status cleanup must be applied to all three entry points. Existing `purgeRows` and `purgeMalformedRows` centralize individual steps, but the service still maintains three copies of their required composition.

**Smallest safe refactoring:** **Extract Function / Parameterize Function**: a private `purgeMatchingAuthwitsLocked` in `auth-registry/service.ts`, accepting separate typed-row, raw-row, and status predicates. Keep initialization and lock acquisition visible in the public methods. Preserve the raw predicate’s type checks and the existing abort-on-failure ordering.

**What disappears:** Two copies of the three-stage cleanup sequence and repeated delete/emit/log callbacks. Each entry point retains only its scope definition and lock framing.

**Instances:**

- `apps/extension/src/wallet/services/auth-registry/service.ts:517`
- `apps/extension/src/wallet/services/auth-registry/service.ts:544`
- `apps/extension/src/wallet/services/auth-registry/service.ts:564`

## q04-wallet-dapp-runtime-X-5: Journal and session handling independently decode SDK chain identity

**Title:** Journal and session handling independently decode SDK chain identity.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** **Structural**, high confidence; small extraction with a meaningful identity boundary. Two implementation files, with `background.ts` consuming the establishment copy. History: `queued-journal.ts` **9 / 9**; `session-established.ts` **8 / 8**; `background.ts` **23 / 23**.

**Concrete evidence:** Both functions convert SDK `chainInfo.chainId` and `version` from either strings or `Fr` objects, XOR the numeric values, and normalize the result to unsigned 32-bit:

- `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:51-56`.
- `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:16-21`.

`queued-journal.ts:44-49` explicitly describes its implementation as an inline mirror retained to avoid importing the background module. The other implementation now lives in `session-established.ts`; background imports it at `background.ts:82` and uses it for teardown, discovery, and dispatch.

**Why it harms future change:** Journal admission and dispatch must assign the same request to the same chain. Changes to SDK field decoding currently require synchronizing two implementations, even though the conversion itself needs no runtime services or browser APIs.

**Smallest safe refactoring:** **Move Function** into a leaf `wallet/services/wallet-sdk/chain-info.ts`. Import it from both consumers; preserve a re-export from `session-established.ts` if needed to keep existing imports stable.

**What disappears:** One six-line conversion function, its duplicate type import, and the mirror-maintenance comment. Tests retain a lightweight import path.

**Instances:**

- `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:51`
- `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:16`

## Non-findings considered

- **Prior 2026-08-16 Q-04, wallet-SDK bootstrap:** addressed through named dependency, state, transport, callback, discovery, and teardown helpers; `initWalletSdkHandler` is no longer the previously reported undecomposed closure.
- **Prior 2026-08-16 Q-08, decryption FIFO:** now delegates to `KeyedLock`; the remaining session baton deliberately releases at execution enqueue and is not interchangeable with a lock held until completion.
- **Prior 2026-08-16 Q-09, dApp-session setters:** now share `patchSession`; not recurring.
- **Prior helper-adoption findings:** auth-registry restore uses `restoreRows`; dApp-session IDs use `nextRandomId`; inspected passthrough clients use `definePassthroughsExhaustive`.
- **Network service/client/spec triad:** deliberate contract layering. The client shares validation through `call`; replacing it with unvalidated passthroughs would discard behavior.
- **Network storage versus wire schemas:** their validation strengths deliberately differ; similarity alone does not establish a redundant boundary.
- **Network projection clone:** `getNetworkInfo` repeats the three-statement `networkInfoFrom` projection; confirmed but not promoted over the larger workflow duplications.
- **WindowManager versus verify-window reservations:** different ownership contracts. Placement and retry behavior already share `topRightOf` and `createPlaced`.
- **Offscreen readiness versus runtime startup memoization:** readiness is rechecked across document lifetimes; successful runtime startup stays memoized. Their settlement policies differ.
- **Logger redaction versus SDK JSON conversion:** distinct contracts—redaction removes payload detail, while response conversion preserves it. The accepted complexity directive on `trim` is not a finding.
- **Service size, type imports, and registration-driven symbols:** no Large Class, cyclic-dependency, or dead-code finding inferred solely from size or apparent import absence.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/wallet/services/network/service.ts:734` — **High confidence, source-traced:** take a `kind: "local"`, `chainId: 0` network whose primary endpoint was changed to `http://localhost:18080`, with the node reporting `l1ChainId: 31337` and `rollupVersion: 1`. `getNodeStatus` calls `_getChainId` without `network.kind`, so the non-seed URL produces `31336` and returns `InvalidChain`. Local endpoint mutation explicitly supports such URLs, and `probeNodeStatus` correctly applies the local-kind override at `753`.

## Cross-rebuttal (codex on claude)

Source checks: **high confidence**. IDs below share the prefix `q04-wallet-dapp-runtime-`.

**1. Overconfident / wrong in Claude’s findings**

- **C-1 — Agree.** The duplicated decoding and XOR formula are real; `apps/extension/src/utils/chain-ids.ts:12–14` provides an existing formula owner that my X-5 overlooked. Extract the decoder into a leaf utility using it. The dependency explanation needs correction: `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:10–12` imports window-manager at runtime, but verify-admission only as a type.

- **C-2 — Partially agree.** The projection duplicate at `apps/extension/src/wallet/services/network/service.ts:846–848` warrants calling `networkInfoFrom`. However, different missing-primary policies are meaningful: `apps/extension/src/wallet/services/network/service.ts:423–424` permits fallback, while `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:141–143` verifies both endpoint identity and URL. Narrow the finding to duplicated selection/projection logic; DTO access alone does not establish Feature Envy, and “14 edits” is not demonstrated.

- **C-3 — Agree.** Same root cause as X-1. Correct guard locations are `apps/extension/src/wallet/services/network/service.ts:603–615` and `:650–661`; the original report’s ranges truncate the guards and misidentify the preambles. Preserve probing outside the lock and the locked reread.

- **C-4 — Partially agree with the original; agree with Claude’s appended correction.** Extract the purge pipeline, retaining separate predicates. `apps/extension/src/wallet/services/auth-registry/service.ts:529–533` requires valid chain/account fields for account-scoped deletion, whereas `:552` deliberately matches malformed rows using profile alone. The original assertion that all row shapes uniformly carry those fields is false.

- **C-5 — Agree.** `apps/extension/src/wallet/services/wallet-sdk/background.ts:939–949` and `:1021–1031` duplicate admission options and rejection handling. The returning-user branch at `:875–887` is meaningfully different: synchronous admission, token consumption, and conditional window reservation. Keep it outside this extraction.

**2. What Claude missed that I found**

- **X-2 — Still stands; Claude now acknowledges it.** Duplicate Code: `apps/extension/src/wallet/services/network/spec.ts:151–178` and `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58–73` repeat the transport/loopback allowlist. Share that decision while preserving schema-only userinfo rejection and both enforcement sites.

- **X-3 — Still stands, with local impact.** Duplicate Code: `apps/extension/src/wallet/services/auth-registry/service.ts:281–321` and `:336–375` repeat submission, settlement, state synchronization, task completion, and cancellation/error handling. Two sites suffice when the same settlement policy must change together; a third copy is unnecessary. Parameterize actions and synchronization, preserving the already-captured execution fence.

**3. What BOTH of you missed**

No additional finding confirmed. Claude’s appended status-method proposal overlaps C-2 and my existing incidental-bug lead; it should not become another independent finding. The workflow-reference comment violates the documented comment convention, but that alone does not establish a substantive maintainability smell.