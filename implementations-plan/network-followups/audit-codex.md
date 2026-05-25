Couldn’t write [audit-codex.md](/Users/alejoamiras/Projects/nulo/nulo-2/implementations-plan/network-followups/audit-codex.md) because the sandbox is read-only. Exact contents:

```md
APPROVE-WITH-DELTAS

1. Start with **5 shards, not 4**. Vitest 4.1.5 assigns shards by SHA-1 of the relative file path and then slices evenly (`node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:35-45,78-88`). On the current 45-file suite, `4` shards clusters `multi-account-from.test.ts` and `tx-sendTx-multicall.test.ts` together; `5` shards splits them.
2. Do **not** change `agent.sh` or `resolve-ports.ts` for sharding. `packages/extension/scripts/e2e/agent.sh:11,60` already forwards extra args to Vitest, and `packages/extension/tests/e2e/README.md:17-20` already documents that pass-through. Matrix jobs run on separate runners, so shard-specific `.e2e-state/ports.json` paths are unnecessary.
3. Keep the existing `decide` gate shape, but extend the path filter to include the TokenBalance surfaces. The current workflow is **not** “paths-only”: PRs to `main` already run unconditionally at `.github/workflows/pr-network-e2e.yml:76-80`. Add `packages/extension/src/wallet/services/token-balance/**` and `packages/extension/src/popup/pages/tokens/**` to the `extension-network` filter instead of broadening the workflow to every PR.
4. The TokenBalance fix must be **fire-and-forget plus event/task driven**, not “await refresh.” `refreshTokenBalance` is an enqueue-only RPC (`packages/extension/src/wallet/services/token-balance/spec.ts:37-41`, `packages/extension/src/wallet/services/token-balance/service.ts:108-114`); awaiting it does not await fresh balances.
5. Do **not** change `onTransactionUpdated` by default. It already enqueues targeted refreshes for UI-origin non-pending txs at `packages/extension/src/wallet/services/token-balance/service.ts:193-236`. The gap is page-entry timing, not obviously missed tx fan-out.
6. Slow-test probes belong on `waitForPgResult` / `executeAztecSendTx` / `ExecutionCoordinator` / `node.getTxReceipt`, not on `waitForTxConfirmation`. The two target tests never call `waitForTxConfirmation`; they wait on `packages/extension/tests/e2e/fixtures/playground.ts:67-88`.
7. Treat “make Network e2e required on dev again” as **separate policy work unless approval explicitly expands scope**. `plan-main` mixes branch-protection policy into code follow-ups, and the current workflow still lacks `merge_group`.

# Network E2E Follow-ups — Plan (codex, independent)

## 1. Context

### 1.1 Where we are
- PR #46 landed with the local suite green and CI still flaky under cumulative sandbox load.
- The current tree has **45 network test files** under `packages/extension/tests/e2e/network`.
- The reusable workflow still runs the whole suite in one job via `.github/workflows/_network-e2e.yml:22-56` and `packages/extension/scripts/e2e/agent.sh:18-60`.
- Prior art already says the rotating-flake pattern is a **single long-lived sandbox problem**, not a one-file deterministic logic failure: `implementations-plan/network-test-triage/full-suite-findings.md:26-35,48-54`.

This PR should bundle the three requested follow-ups, but they are still three separate changesets:
- workflow sharding
- token-detail auto-refresh
- time-boxed slow-test investigation

### 1.2 Branch + base
- Base branch for the work: `fix/e2e-network-suite-recovery`
- Feature branch: `feat/network-followups`
- One PR for all three follow-ups, but with logically separate commits

### 1.3 User constraints
1. GH Actions matrix sharding, one sandbox per runner.
2. Slow-test work is probe-driven, codex-led, and hard-capped at 2 hours.
3. Tier A protocol applies.
4. One PR only.

### 1.4 Goal
- Replace the single-runner full-suite CI shape with matrix shards, each owning its own Anvil + Aztec + playground stack.
- Remove the manual-refresh crutch from the token-detail transfer scenario.
- Either land a bounded slow-test fix or ship documented findings without blocking the other two.

## 2. Three Follow-ups Breakdown

### 2.1 Suite sharding (P0)

**Problem**

Right now the caller workflow runs one reusable workflow invocation, which runs one `bun run e2e:agent`, which in turn runs the full network suite against one sandbox:
- `.github/workflows/pr-network-e2e.yml:85-93`
- `.github/workflows/_network-e2e.yml:22-56`
- `packages/extension/scripts/e2e/agent.sh:43-60`

That means all 45 files share:
- one Anvil
- one Aztec node
- one playground dev server

`global-setup.ts` makes that explicit:
- env-selected ports: `packages/extension/tests/e2e/global-setup.ts:33-40`
- per-run Aztec data dir: `packages/extension/tests/e2e/global-setup.ts:41-47`
- Anvil spawn: `packages/extension/tests/e2e/global-setup.ts:209-269`
- Aztec spawn with `--data-directory`: `packages/extension/tests/e2e/global-setup.ts:294-315`
- playground spawn: `packages/extension/tests/e2e/global-setup.ts:358-403`
- contract deployment per run: `packages/extension/tests/e2e/global-setup.ts:412-495`

**Recommendation**

Use **5 shards** in the caller workflow matrix.

Why `5`:
- 45 files divides cleanly into `9` files per shard.
- Vitest sharding is deterministic but **not runtime-aware**. It hashes relative file paths and slices equal ranges; it does not balance by historical duration (`node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:35-45,78-88`).
- With the current 45-file set, `4` shards puts both known slow outliers, `multi-account-from.test.ts` and `tx-sendTx-multicall.test.ts`, in the same shard. `5` shards separates them.
- Cost increase from `4` to `5` runners is only 25%, but it lowers the risk that one “bad hash bucket” dominates wall time.

**Expected shape**

Caller workflow:

```yaml
network-e2e:
  if: needs.decide.outputs.run == 'true'
  needs: decide
  strategy:
    fail-fast: false
    matrix:
      shard: [1, 2, 3, 4, 5]
  name: Run / shard ${{ matrix.shard }}/5
  uses: ./.github/workflows/_network-e2e.yml
  with:
    ref: ${{ github.event.pull_request.head.sha || github.ref }}
    shard: ${{ matrix.shard }}/5
  secrets:
    SPONSORED_FPC_SALT: ${{ secrets.SPONSORED_FPC_SALT }}
```

Reusable workflow:

```yaml
on:
  workflow_call:
    inputs:
      ref:
        type: string
        default: ""
      shard:
        type: string
        default: ""
```

and then:

```yaml
- name: Run network e2e via agent
  run: |
    if [ -n "${{ inputs.shard }}" ]; then
      bun run e2e:agent --shard=${{ inputs.shard }}
    else
      bun run e2e:agent
    fi
```

**What stays unchanged**

- `packages/extension/scripts/e2e/agent.sh` already forwards arbitrary Vitest args at line 60.
- `packages/extension/scripts/e2e/resolve-ports.ts` does not need shard awareness for CI; each matrix leg gets its own runner filesystem and process space.
- `packages/extension/tests/e2e/global-setup.ts` already gives each run its own ports and Aztec data dir.

**Status aggregation**

Keep the existing `status` reducer job in `.github/workflows/pr-network-e2e.yml:95-114` as the single branch-protected check. It already evaluates `needs.*.result`; after matrixing, the important validation is that one failed shard makes `needs.network-e2e.result` report `failure`.

I would not replace the reducer with five required shard checks unless GitHub proves the reducer semantics wrong on the first shard-fail run.

**Trigger policy**

Do **not** make the matrix run on every `dev` PR.

Keep the current `decide` logic:
- manual dispatch always runs: `.github/workflows/pr-network-e2e.yml:56-59`
- PRs to `main` always run: `.github/workflows/pr-network-e2e.yml:76-80`
- PRs to `dev` run on matching paths or `e2e:network` label: `.github/workflows/pr-network-e2e.yml:73-80`

But extend `extension-network` to include follow-up #2’s code:
- `packages/extension/src/wallet/services/token-balance/**`
- `packages/extension/src/popup/pages/tokens/**`

Without that, a future TokenBalance-only bug fix on `dev` would skip the network matrix entirely.

### 2.2 TokenBalance projection on mount (P1)

**Problem**

The token detail page reads cached balance state but does not actively refresh it on entry:
- token watcher reads cached balance: `packages/extension/src/popup/pages/tokens/[id].vue:58-66`
- account watcher reads cached balance again: `packages/extension/src/popup/pages/tokens/[id].vue:68-77`
- mount only loads the token, not the balance: `packages/extension/src/popup/pages/tokens/[id].vue:100-105`
- manual refresh just enqueues a refresh: `packages/extension/src/popup/pages/tokens/[id].vue:79-83`

The service-side refresh is asynchronous by design:
- `refreshTokenBalance(id)` only enqueues: `packages/extension/src/wallet/services/token-balance/service.ts:108-114`
- the queue drains on a 1s ticker: `packages/extension/src/wallet/services/token-balance/balance-job-queue.ts:36,64-67,89-106`
- balance writes arrive later through `onTokenBalanceUpdated`: `packages/extension/src/popup/pages/tokens/[id].vue:51-56`

The current e2e helper works around that by clicking refresh and then polling:
- helper implementation: `packages/extension/tests/e2e/fixtures/helpers.ts:514-547`
- only usage: `packages/extension/tests/e2e/network/transfers.test.ts:124-129`

**Recommendation**

Make the token detail page do what the helper currently forces:

1. Read the current cached balance immediately so the page renders fast.
2. If a balance id exists, **fire** `refreshTokenBalance(id)` on mount and on relevant identity changes.
3. Let `onTokenBalanceUpdated` replace the stale value when the projector finishes.

That means:
- **fire-and-forget**, not `await`
- **event/task-driven UI**, not “read-after-await”

`await tokenBalanceService.refreshTokenBalance(...)` is semantically wrong here because the method returns after enqueue, not after projection:
- `packages/extension/src/wallet/services/token-balance/spec.ts:37-41`
- `packages/extension/src/wallet/services/token-balance/service.ts:108-114`

**Concrete page change**

Refactor `packages/extension/src/popup/pages/tokens/[id].vue` around a shared helper:

```ts
async function readCurrentTokenBalance() {
  if (!token.value || !appStore.account?.address) return
  tokenBalance.value = (await tokenBalanceService.getTokenBalances(token.value.id, appStore.account.address))?.at(0)
}

function scheduleRefresh() {
  if (!tokenBalance.value?.id) return
  void tokenBalanceService.refreshTokenBalance(tokenBalance.value.id)
}
```

Then:
- `onMounted`: load token, then `await readCurrentTokenBalance()`, then `scheduleRefresh()`
- `watch(() => token.value, ...)`: same sequence
- `watch(() => appStore.account, ...)`: same sequence, with null guards first
- `handleRefreshBalance`: call the same `scheduleRefresh()` helper

**Spinner state**

Do not use `refreshTokenBalance(...).finally(() => isRefreshingBalance.value = false)`.

That would measure RPC completion, not actual balance projection completion.

If we touch `isRefreshingBalance`, copy the working pattern already used in:
- `packages/extension/src/popup/components/modules/general/BalanceView.vue:105-188`
- `packages/extension/src/popup/components/modules/general/TokensView.vue:75-228`

Those pages subscribe to `TaskServiceClient` `BalanceUpdate` tasks, which matches real background progress.

**Do we also change `onTransactionUpdated`?**

Not in the first pass.

`onTransactionUpdated` already:
- ignores pending
- targeted-refreshes matching balances for UI txs with transfer metadata
- falls back to account-wide refresh when it cannot narrow scope

That logic lives at `packages/extension/src/wallet/services/token-balance/service.ts:193-236`. The safer move is to fix page-entry behavior first and only touch tx fan-out if probes show a specific miss.

### 2.3 Slow-test investigation (P2, hard time-boxed)

**Problem**

The two target tests do **not** wait on `waitForTxConfirmation`; they wait on playground RPC completion:
- `waitForPgResult` uses `page.waitForFunction(...)`: `packages/extension/tests/e2e/fixtures/playground.ts:67-88`
- `multi-account-from.test.ts` waits `120_000`: `packages/extension/tests/e2e/network/multi-account-from.test.ts:67-84`
- `tx-sendTx-multicall.test.ts` waits `180_000`: `packages/extension/tests/e2e/network/tx-sendTx-multicall.test.ts:64-75`

That matters because the likely slow path is the dApp `sendTx` response path, not the activity-card confirmation path.

**Most likely explanations, ranked**

1. **Sandbox-wide slowdown in the post-submit wait path.**  
   Both dApp send paths call `node.getTxReceipt(txHash)` unless `opts.wait === "NO_WAIT"`:
   - standard path: `packages/extension/src/wallet/services/execution/service.ts:1912-1949`
   - no-from path: `packages/extension/src/wallet/services/execution/service.ts:2070-2109`

2. **Per-test over-waiting for full receipt when the assertion is really popup shape.**  
   Both target files primarily assert execute-popup content, then accept either `"ok"` or `"error"` from the dApp result:
   - `multi-account-from.test.ts:73-84`
   - `tx-sendTx-multicall.test.ts:70-75`

3. **Wallet-side prove/build cost, especially multicall.**  
   `tx-sendTx-multicall` builds one `ExecutionPayload` with 3 or 7 calls, not N separate transactions:
   - `packages/playground/src/sections/transactions.ts:37-58`
   - `packages/playground/src/sections/transactions.ts:118-135`

4. **A real wallet bug specific to multi-account routing or multicall authwit handling.**  
   Possible, but lower prior because the two tests hit different fixture scopes:
   - `multi-account-from` uses file-scoped `dappConnectedExtension`: `packages/extension/tests/e2e/network/multi-account-from.test.ts:30-31`
   - `tx-sendTx-multicall` uses per-test `dappConnectedExtensionPerTest`: `packages/extension/tests/e2e/network/tx-sendTx-multicall.test.ts:27-28`

That split pushes me toward “shared sendTx wait path” over “file fixture leak.”

## 3. Strategy

### 3.1 Phased commits

```text
[ ] Phase A — Caller-workflow sharding + reusable-workflow input + unique artifacts
[ ] Phase B — First shard CI validation and shard-count confirmation
[ ] Phase C — Token-detail auto-refresh on mount/account change
[ ] Phase D — Remove `waitForTokenDetailBalances` and simplify `transfers.test.ts`
[ ] Phase E — Slow-test probe commit (time-box starts here)
[ ] Phase F — Probe run(s) on the two target files only
[ ] Phase G — Bounded slow-test fix OR findings doc
[ ] Phase H — Strip probes / keep only permanent fixes
```

### 3.2 Ordering

**Sharding first, TokenBalance second, slow-test investigation last.**

I do **not** want the slow investigation to block sharding, because:
- the user explicitly time-boxed it
- sharding is the highest-confidence CI reliability win
- sharding itself changes the load model; if the “slow tests” become normal on isolated runners, that is already a strong finding

TokenBalance is independent of sharding and should ship as its own commit inside the same PR.

### 3.3 Workflow details I would actually implement

1. Caller workflow owns the matrix. GitHub explicitly allows `strategy` on a job that calls a reusable workflow.
2. Set `fail-fast: false` so one failed shard does not cancel the rest and erase evidence.
3. Keep the existing `status` reducer job as the one required check.
4. Give artifact uploads a shard suffix. The current fixed name `network-e2e-logs` at `.github/workflows/_network-e2e.yml:46-55` will collide in a failing matrix run.
5. Do **not** modify `resolve-ports.ts`, `global-setup.ts`, or the lockfile model for CI sharding.

### 3.4 Local invocation

Local shard testing already works through the existing pass-through:
- `packages/extension/tests/e2e/README.md:17-20`
- `packages/extension/scripts/e2e/agent.sh:60`

Examples:
- `bun run e2e:agent --shard=1/5`
- `bun run e2e:agent --shard=2/5`

## 4. Phase A — Sharding Infra

### 4.1 `.github/workflows/pr-network-e2e.yml`

Changes:
- add `strategy.matrix.shard: [1, 2, 3, 4, 5]`
- add `strategy.fail-fast: false`
- name the job with the shard number
- preserve `decide`
- extend `extension-network` paths with:
  - `packages/extension/src/wallet/services/token-balance/**`
  - `packages/extension/src/popup/pages/tokens/**`

I would **not** change the `BASE == main` unconditional-run rule in this PR. That is policy, not the core follow-up.

### 4.2 `.github/workflows/_network-e2e.yml`

Changes:
- add string input `shard`
- pass `--shard=<N/M>` to `bun run e2e:agent` only when input is non-empty
- rename failure artifact to include the shard:
  - `network-e2e-logs-${{ inputs.shard || 'full' }}`

This last point is mandatory in a matrix. `actions/upload-artifact` warns that same-name uploads from multiple jobs conflict in matrix runs.

### 4.3 `packages/extension/scripts/e2e/agent.sh`

No functional changes required for sharding.

It already:
- documents pass-through args: `packages/extension/scripts/e2e/agent.sh:11`
- forwards them to Vitest: `packages/extension/scripts/e2e/agent.sh:60`

If we touch it at all, make it documentation-only.

### 4.4 `packages/extension/vitest.e2e.network.config.ts`

No functional shard logic belongs here.

Keep:
- `fileParallelism: false`: `packages/extension/vitest.e2e.network.config.ts:16`
- `retry: 2`: `packages/extension/vitest.e2e.network.config.ts:28-45`

If we edit this file, it should only be to update the stale comment that still says sharding is a future PR.

Do **not** justify sharding by claiming `pool: "forks"` / `isolate: true` are the critical fix. The repo’s own recovery notes already say they were redundant defaults and not causal.

## 5. Phase C — TokenBalance On-Mount Refresh

### 5.1 `packages/extension/src/popup/pages/tokens/[id].vue`

Target changes:
- add a shared read helper with null guards
- add a shared schedule-refresh helper
- call both from:
  - `onMounted`
  - the `token.value` watcher
  - the `appStore.account` watcher
- make the manual refresh button call the same helper

Important constraints:
- read first, then refresh
- do not block route mount on background projection
- do not assume `refreshTokenBalance` completion means “fresh balance available”

### 5.2 `waitForTokenDetailBalances`

Delete it.

Reason:
- it is a workaround, not a stable contract
- it is only used once
- once the page self-refreshes, the test should only wait for the DOM to reflect the background update, not force the update itself

Evidence:
- helper definition: `packages/extension/tests/e2e/fixtures/helpers.ts:526-547`
- only live usage: `packages/extension/tests/e2e/network/transfers.test.ts:124-129`

### 5.3 `transfers.test.ts`

Replace:
- helper click-refresh + helper poll

With:
- plain `page.waitForFunction(...)` on `[data-testid="public-balance-value"]` and `[data-testid="private-balance-value"]`
- final read through `getTokenDetailBalances`

The test still waits for asynchronous UI update. What goes away is the **manual refresh side effect**, not all waiting.

## 6. Phase E-G — Slow-Test Investigation

### 6.1 Probe placement

Re-use the storage-based probe pattern from:
- `implementations-plan/e2e-full-network-recovery/lessons/probe-infrastructure.md:13-40`
- `implementations-plan/e2e-full-network-recovery/lessons/probe-infrastructure.md:42-73`

Probe these boundaries:

1. `packages/extension/src/wallet/services/execution/service.ts:865-981`  
   High-level op start/end with a `traceId`.

2. `packages/extension/src/wallet/services/execution/execution-coordinator.ts:49-99`  
   Start/end timings for:
   - `simulateTxTask`
   - `proveTxTask`
   - `sendTxTask`

3. `packages/extension/src/wallet/services/execution/service.ts:1891-1949`  
   Standard dApp send path:
   - authwit discovery
   - build/estimate
   - prove
   - send
   - `node.getTxReceipt(txHash)` start/end

4. `packages/extension/src/wallet/services/execution/service.ts:2040-2109`  
   No-from send path only if the repro touches it.

5. `packages/extension/tests/e2e/fixtures/playground.ts:67-88`  
   Optional correlation timestamps around `waitForPgResult`, not primary diagnosis.

I would **not** spend probe budget on `waitForTxConfirmation`; that helper is irrelevant to the two target files.

### 6.2 Exit criterion

The 2-hour window starts when the first probe commit is ready.

“We found it” means:
- one stage owns most of the delay
- we can state whether it is:
  - protocol/sandbox delay
  - wallet logic delay
  - test over-wait
- and we either land a small fix or consciously defer with evidence

“We are documenting” means:
- after 2 hours we still cannot name the dominant stage with confidence
- or the only confirmed cause is “shared sandbox load,” which sharding already mitigates

### 6.3 Bounded fix candidates

If `node.getTxReceipt` dominates and the assertion does not need a mined receipt:
- consider changing the playground invocation for these two tests to `wait: "NO_WAIT"` or a dedicated no-wait test action
- especially for `multi-account-from`, whose real assertion ends at the popup’s from-account row

If prove/authwit dominates only the multicall case:
- investigate the multicall-specific pre-send path first
- do **not** just raise the timeout

If sharded CI makes both tests normal:
- stop
- document that the root cause is cumulative load
- ship no extra product fix

## 7. Test Plan

### 7.1 Local validation

- `bun run e2e:agent` once as the full regression check
- `bun run e2e:agent --shard=1/5` through `--shard=5/5`
- `bun run e2e:agent packages/extension/tests/e2e/network/transfers.test.ts` after the TokenBalance change

### 7.2 CI validation

First matrix run must confirm:
- all 5 shards execute
- no artifact-name collision on failure uploads
- `status` fails when any shard fails
- wall time drops materially versus the single-runner workflow

### 7.3 TokenBalance regression

- `transfers.test.ts` passes without `waitForTokenDetailBalances`
- manual check: open token detail after a tx, stale cached value is replaced automatically without clicking refresh

### 7.4 Slow-test check

- run `multi-account-from.test.ts`
- run `tx-sendTx-multicall.test.ts`
- only keep probing work if the sharded baseline still leaves them pathological

## 8. Security & Adversarial Considerations

### 8.1 Sharding and state isolation

Risk:
- cross-shard state leaks

Assessment:
- low in CI

Why:
- each matrix leg gets its own runner filesystem
- each run gets its own port pack and Aztec data dir:
  - `packages/extension/scripts/e2e/resolve-ports.ts:93-104`
  - `packages/extension/tests/e2e/global-setup.ts:41-47`
  - `packages/extension/tests/e2e/global-setup.ts:294-315`

The only real matrix-specific footgun here is artifact-name collision, not sandbox leakage.

### 8.2 TokenBalance mount-refresh race

Risk:
- page reads stale cached balance, then refresh arrives later

Assessment:
- acceptable and already the architecture

Why:
- multiple enqueue paths collapse safely:
  - queue dedup: `packages/extension/src/wallet/services/token-balance/balance-job-queue.ts:47-50,78-84`
  - pending-task dedup: same file
- eventual update fan-out is already event-based:
  - `packages/extension/src/popup/pages/tokens/[id].vue:51-56`

The real bug would be pretending we can “await freshness” when we cannot.

### 8.3 Probe leakage

Risk:
- leftover probe code ships
- probe payloads expose more than needed

Mitigation:
- same `VITE_E2E_PROBE=1` gate as the prior investigation
- storage-based unique keys
- dump-and-clear on failure
- keep payloads to trace ids, stage names, timestamps, and maybe tx-hash prefixes only

### 8.4 CI cost

Risk:
- more concurrent hosted runners

Mitigation:
- keep the current gate shape
- extend the path filter only where follow-up #2 actually lives
- prefer `5` shards now because it reduces the risk of a single overloaded hash bucket

## 9. File Catalog

### 9.1 Sharding
- `.github/workflows/pr-network-e2e.yml`
- `.github/workflows/_network-e2e.yml`
- `packages/extension/tests/e2e/README.md` (only if we want shard examples in docs)

### 9.2 TokenBalance
- `packages/extension/src/popup/pages/tokens/[id].vue`
- `packages/extension/tests/e2e/fixtures/helpers.ts`
- `packages/extension/tests/e2e/network/transfers.test.ts`

### 9.3 Temporary slow-test probes
- `packages/extension/src/wallet/utils/probe.ts` (temporary)
- `packages/extension/src/wallet/services/execution/service.ts`
- `packages/extension/src/wallet/services/execution/execution-coordinator.ts`
- `packages/extension/tests/e2e/fixtures/playground.ts` (only if correlation timing is needed)

## 10. Open Questions Before Approval

1. Is **5 concurrent `ubuntu-latest` runners** acceptable for this repo’s Actions budget, or do we need to cap the initial rollout at 4 despite the worse hash-bucket clustering?
2. Is **branch-protection / required-check policy** in scope for this PR, or should this PR stop at making the workflow itself reliable?
3. If probes show the delay is **only** the final receipt wait, may these two tests switch to **`wait: "NO_WAIT"`** because their core assertions are popup-shape assertions, not mined-receipt assertions?
4. Do maintainers want to preserve the current **`main` always-runs** behavior in `.github/workflows/pr-network-e2e.yml:76-80`, or should that policy be reconsidered separately once the matrix lands?

## 11. Rejected / Deferred

- Reject changing `agent.sh` / `resolve-ports.ts` just to support CI sharding.
- Reject touching `onTransactionUpdated` without evidence of a miss.
- Reject global timeout inflation as the primary fix.
- Defer “required on dev” policy unless reviewers explicitly widen scope.

## 12. Done Definition

- The workflow runs as a **5-shard matrix** with one sandbox per runner.
- Any failing shard makes the single `status` job fail.
- Failure-log artifacts are uniquely named per shard.
- Token detail auto-refreshes on entry without the test clicking Refresh.
- `waitForTokenDetailBalances` is gone.
- Slow-test work ends as either:
  - a bounded fix with evidence, or
  - a documented time-boxed finding that did not block the other two.
```