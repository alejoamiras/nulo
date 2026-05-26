# Network E2E Follow-ups — Opus 4.7 Independent Plan

> Tier A protocol — independent draft written without anchoring on `plan-main.md` (read after my own opinion crystallized). Same shape as main for clean consolidation.

## Verdict

**APPROVE-WITH-DELTAS.** Shape is right; ordering, sharding count, TokenBalance fix shape, and probe ergonomics need surgery before the user signs off.

## Major deltas from `plan-main.md`

1. **Phase order is wrong.** Main plan starts with sharding. I argue **TokenBalance MUST be first** — it both stabilizes existing tests AND removes the `waitForTokenDetailBalances` workaround whose existence is a recurring debugging trap. Slow-test probe phase belongs in the middle (it can land or document independently). Sharding lands LAST because (a) it must validate against an already-stabilized suite, (b) its CI-time and runner-minute impact is the most visible to other contributors, and (c) it crystallizes a CI surface change the whole team is going to feel — you want it stamped on the most stable possible test set.
2. **Shard count: N=3 (not N=4)** as the default, with the workflow shape making it trivially tunable to 4 if Q3 below tells us to. Justification: 45 files / 3 = 15 files per shard; vitest's deterministic SHA-1-of-file-path sharder (`node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:35-46`) won't perfectly balance wall-time because slow files (`transfers.test.ts` ~140s, `tx-sendTx-multicall` ~427s on CI) hash-distribute randomly. With 3 shards the worst-case shard "owns" 1 slow file with ~14 fast neighbors; with 4 shards the slow file dominates one runner while the others idle. **The Aztec sandbox cold-start is ~90s** (`global-setup.ts:344` waits up to 90s) — adding shards multiplies that overhead. 3 shards is the right cost/benefit floor; raise to 4 only if empirical max-shard wall time stays >18min.
3. **TokenBalance fix shape**: main plan does `getTokenBalances → fire-and-forget refreshTokenBalance`. That's an UI-side workaround. **The root cause is in `TokenBalanceService.onTransactionUpdated` (`packages/extension/src/wallet/services/token-balance/service.ts:193-237`)** — it enqueues balances into the 1s-tick `BalanceJobQueue` rather than projecting synchronously when the tx that drove the change is the user's own UI tx that just settled. The proper fix is a **synchronous projection path on tx settle for the UI's own transactions** — keep async for background polling, but for transactions whose `origin.type === OriginType.UI` (already a branch the code special-cases at `service.ts:195`), call `BalanceProjector.project()` directly and emit `onTokenBalanceUpdated` before `onTransactionUpdated` returns. Then the popup's existing `onTokenBalanceUpdated` watcher sees the new value with no extra round trip. Removes the e2e helper AND the user-visible lag, without making the page do an extra RPC on every mount.
4. **`tokens/[id].vue` does NOT need on-mount refresh.** Main plan's diff at §5.1 makes every token-page mount fire a refresh — that's both a privacy regression (extra PXE-touching RPCs every page open) AND a user-perceived-lag regression (the page now flicker-loads). The component already subscribes to `onTokenBalanceUpdated` (`tokens/[id].vue:52-56`). If §3 above lands, the watcher sees the freshly-projected value the moment the user's own tx settles. No mount-time refresh needed.
5. **Slow-test investigation has wrong probe placement.** Main plan probes `executeOperations` and `waitForTxConfirmation`. The actual long-tail surface for `tx-sendTx-multicall (#33)` is **`ExecutionCoordinator.proveTxTask` (`packages/extension/src/wallet/services/execution/execution-coordinator.ts:69-86`)** plus the upstream `pxe.proveTx` call inside it (barretenberg / bb.wasm). For `multi-account-from` the surface is `dappConnectedExtension` fixture's `switchToLocalNetwork` + the cap popup mount delay (15s budget under load). Probe placement should be where the time GOES, not where the test fails.
6. **Status aggregation pattern in main plan is incomplete.** `needs.network-e2e.result` for a matrix job aggregates by GitHub Actions native semantics — it returns `failure` only if AT LEAST ONE matrix leg fails AND there's no `continue-on-error: true`. Main plan claims this; it's correct but doesn't account for `result == 'cancelled'`. The recovery PR's `pr-network-e2e.yml:104-113` already checks both `failure` and `cancelled` — the followup plan needs to keep that pattern.
7. **No paths-filter change required.** Main plan §11 doesn't address this, but the existing `pr-network-e2e.yml:33-55` `extension-network` filter is already comprehensive. Sharding is an INFRA change to a workflow that already only fires on relevant changes. Don't loosen the filter.
8. **Probe stripping enforcement is missing.** Lessons from `implementations-plan/e2e-full-network-recovery/lessons/probe-infrastructure.md` line 90 explicitly call out CI bundle-grep as "planned, not yet wired." Main plan §8.3 hand-waves at the same gap. **This PR is the one that should land the bundle-grep enforcement** as a permanent guard rail — it costs ~5 lines in `_network-e2e.yml`, and the recovery PR's lessons explicitly flag it.
9. **One PR but stacking strategy.** Main plan stacks on `fix/e2e-network-suite-recovery`. That's correct BUT: that branch is currently a draft PR (PR #46). The follow-up branch must rebase on `dev` AFTER #46 squash-merges OR fork from #46's tip and clean-rebase later. Main plan §1.2 says "Will rebase onto `dev` after PR #46 merges" — that's fine for the open-PR window but the PR title + body must call this out so reviewers know not to merge until #46 lands.
10. **Slow-test 2h time-box must include a deliverable on exit.** Main plan §6.4 just says "ship sharding + TokenBalance, document the slow tests." If we exit without root cause, we must commit `implementations-plan/network-followups/slow-tests-hypotheses.md` listing the probes we wired, the data we collected, the 3 leading hypotheses, and the next-step plan. Otherwise the 2h burns with no archive.

## 1. Context

### 1.1 Where we are
Same as main: PR #46 landed, 61/61 local, 52-54/61 CI with 7-9 rotating-flake failures per run all infra-shaped (cumulative sandbox load). The 3 documented follow-ups are bundled here:
1. **Suite sharding** — parallel GH Actions matrix.
2. **TokenBalance projection on tx settle** — fix the root cause of `waitForTokenDetailBalances`.
3. **Slow tests** — `multi-account-from` (148s CI) + `tx-sendTx-multicall` (427s CI) — probe-driven investigation, 2h time-box.

### 1.2 Branch + base
- Stacks on `fix/e2e-network-suite-recovery` (PR #46 draft).
- New branch: `feat/network-followups`.
- Rebase onto `dev` once #46 squash-merges.
- PR opens as **draft** with a `## Blocked-on` callout pointing at #46 so the merge-order is obvious to reviewers.

### 1.3 User constraints (explicit)
1. Sharding shape = GH Actions matrix; each shard owns its own anvil+aztec sandbox.
2. Slowness investigation = probe-driven, codex-led, 2h time-box.
3. Tier A full protocol (plan + dual audit + approval gate).
4. One PR for all 3 follow-ups.

### 1.4 Goal
- `bun run e2e:agent` per shard exits 0 on CI; each shard's ~15 files pass within ~20 min wall-time.
- Network e2e becomes a **required check on `dev`** again (currently advisory per #46 callout).
- Token detail page shows correct post-tx balance with no e2e helper polling (`waitForTokenDetailBalances` deleted, `transfers.test.ts` step 6 uses `getTokenDetailBalances` directly with an asserted timeout).
- Slow tests: either fixed OR documented in `slow-tests-hypotheses.md` with 3 next-step candidates.

## 2. Three follow-ups breakdown

### 2.1 TokenBalance projection on tx settle (P0 — ships first)

**Problem**: `TokenBalanceService.onTransactionUpdated` (`packages/extension/src/wallet/services/token-balance/service.ts:193-237`) enqueues balance refresh into the 1s-tick `BalanceJobQueue`. For the user's OWN UI tx that just settled, this means a perceptible lag (≥1s tick + projector run time, typically 3-8s under load) between the activity card flipping to "confirmed" and the token-detail balance updating. The e2e helper `waitForTokenDetailBalances` (`packages/extension/tests/e2e/fixtures/helpers.ts:514-547`) papers over this by clicking the Refresh button + polling.

**Root cause**: the async-projection path is correct for background polling (network polls every 1s; cheap), but for a tx that was just submitted via the popup's Send flow, the wallet KNOWS exactly which token's balance changed (it built the tx). Routing through the same generic queue means the synchronous knowledge is lost.

**Fix shape** (see §5 for the diff):
1. In `TokenBalanceService.onTransactionUpdated`, when `tx.origin.type === OriginType.UI` AND we've already narrowed down `tokenIds + addresses` (the path at `service.ts:215-227`), call `BalanceProjector.project()` directly on those specific balances FIRST. On success, emit `onTokenBalanceUpdated` synchronously. THEN fall back to the existing `queue.enqueue` for background reconciliation.
2. Keep the dApp / faucet / fallback path (`service.ts:228-236`) on async-queue — those don't have the narrow scoping.
3. Remove `waitForTokenDetailBalances` from `helpers.ts`.
4. `transfers.test.ts` Step 6 becomes `await getTokenDetailBalances(page)` directly with no waitForFunction, asserting on the first read.

**Why P0**:
- Removes a real product-side latency (visible to users, not just to tests).
- Removes the e2e helper that's been a debugging crutch for two PRs running.
- Stabilizes the test suite BEFORE sharding moves files around — easier to debug a regression in one helper than in one helper × 3 shards.

### 2.2 Suite sharding (P1 — ships last)

**Problem**: 45 files share one anvil + aztec sandbox spawned in `global-setup.ts`. Cumulative on-chain state slows later files past their per-test timeouts. CI sees 7-9 rotating-flake failures per run.

**Approach**: GitHub Actions matrix in `pr-network-e2e.yml`. **N=3 shards** initially; each shard:
- Runs on its own `ubuntu-latest` runner.
- Spawns its own anvil+aztec sandbox via `setup-aztec` + `global-setup.ts`.
- Executes its slice via vitest's `--shard=N/M` flag (handed to `agent.sh` as a positional / env-var arg).

**Per-shard wall-time estimate**: ~18-22 min (vs current ~30-40 min sequential, of which 5-7 min is sandbox cold-start that now runs in parallel).

**Runner-minute impact**: ~3 runners × 20 min ≈ 60 runner-min vs current 1 runner × 35 min = 35 runner-min. **~1.7× runner cost for ~2× wall-time speedup**. Acceptable.

**Why P1 (last)**:
- Validation requires the suite to already be stable.
- Easier to debug shard-distribution issues against a known-green baseline.
- The CI surface change is the most-felt change by other contributors — land it last so the rest of the PR's diff isn't drowning in CI-failure noise during iteration.

### 2.3 Slow-test investigation (P2 — middle, time-boxed)

**Problem**: 2 tests consistently slow on CI:
- `multi-account-from` (`packages/extension/tests/e2e/network/multi-account-from.test.ts`): 148s on CI. Uses `dappConnectedExtension` (file-scoped). Hits `waitForPopup(..., "capabilities", { timeout: 15_000 })` — under load the cap popup can take >15s to mount. Test budget: 180s.
- `tx-sendTx-multicall` (`packages/extension/tests/e2e/network/tx-sendTx-multicall.test.ts`): 427s on CI for the chunked (7-call) case. Uses `dappConnectedExtensionPerTest` (fresh fixture). Test budget: 240s with `retry: 1` (so practical budget: 480s when retry fires). Hits `waitForPgResult(page, "sendTx", seqTx, 180_000)` — the wallet's `proveTx` + chunked-authwit path can exceed 3 minutes under load.

**Approach**: probe-driven, **2h time-box** starting when probes are wired. If root cause not identified by the 2h mark, commit `slow-tests-hypotheses.md` and ship sharding + TokenBalance without the slow-test fix. Sharding alone is likely to soften the symptom (less cumulative load on the shard that owns these files).

**Probe placement** (different from main plan):
- `ExecutionCoordinator.proveTxTask` (`packages/extension/src/wallet/services/execution/execution-coordinator.ts:69-86`) — wrap the `await pxe.proveTx(...)` in start/end probes. This is the dominant time sink for chunked multicall.
- `ExecutionCoordinator.simulateTxTask` (same file, lines 51-67) — fee strategies call simulate multiple times per send.
- `TransactionService.runWorker` (`packages/extension/src/wallet/services/transaction/service.ts:176-194`) — log the time `getTxReceipt` calls take under load (if the node is slow to confirm, this surfaces it).
- `dappConnectedExtension` fixture (`packages/extension/tests/e2e/fixtures/extension.ts:292-307`) — probe the time from `clickByTestId(page, 'pg-btn-requestCapabilities')` to capability popup mount, broken into "RPC dispatched" / "interaction opened" / "popup target appeared".

**Hypotheses ranked** (more grounded than main plan's H1-H3):
- **H-OP-1 (top)**: bb.wasm `proveTx` cold-start cost on each fresh Chrome browser. `dappConnectedExtensionPerTest` opens a fresh browser per test; the worker that loads bb.wasm is freshly created. First proveTx in a worker is order-of-magnitude slower than subsequent ones. Chunked multicall does ≥2 proveTx (one per chunk).
- **H-OP-2**: PXE block-sync lag under CI's slower IO. `getTxReceipt` polls; if the L2 node's block production is paced by anvil (3-call multicall = 3 separate block fills under `SEQ_MIN_TX_PER_BLOCK=0`), each tx waits a full block for receipt. With CI's slower disk, block production stretches.
- **H-OP-3**: cap popup target-creation backpressure. Under cumulative load, `waitForPopup` 15s timeout fires not because the SW is slow but because puppeteer's `waitForTarget` polls every 500ms and may miss a fast-mount window. Sharding fixes this incidentally (less cumulative load per shard).

**2h exit criterion**:
- IF probe data confirms one of H-OP-1/-2/-3 → apply targeted fix in same commit batch.
- IF inconclusive → commit `slow-tests-hypotheses.md` with probe traces + 3 ranked next-step candidates. **Do not bump timeouts to mask** (per user constraint #2 from the recovery PR).

### 2.4 Why this ordering (TokenBalance → slow probes → sharding)

```
[ ] Phase A — TokenBalance fix + helper removal     (~2 hr coding + iteration)
[ ] Phase B — Slow-test probes wired, traces captured (2-hr time-boxed)
[ ] Phase B.1 — Slow-test fix OR slow-tests-hypotheses.md commit
[ ] Phase B.2 — Strip slow-test probes
[ ] Phase C — Sharding infra (workflow + agent.sh)
[ ] Phase C.1 — First CI matrix validation
[ ] Phase D — Bundle-grep CI step (universal probe-leak guard)
[ ] Phase E — PR body, revert "advisory" callout, re-enable required check
```

Each phase produces a green local `bun run audit:vue + e2e:agent` before the next starts. The slow-test probes are stripped BEFORE sharding lands so we're not debugging shard distribution against a noisy probe-instrumented build.

## 3. Strategy

### 3.1 Phased commits on `feat/network-followups`

```
[ ] feat(token-balance): project balances synchronously for UI-origin tx settle    (~80 lines src + 30 lines test)
[ ] test(e2e): drop waitForTokenDetailBalances helper                                (~20 lines diff)
[ ] test(e2e): wire diagnostic probes for slow-test investigation (TEMPORARY)        (≤120 lines, gated behind VITE_E2E_PROBE)
[ ] docs(implementations-plan): slow-test traces + hypothesis ranking                (commit even if 2h fix lands; trace is reference for future)
[ ] (CONDITIONAL) fix(execution): <root-cause-specific change>                       (only if 2h yields a clear fix)
[ ] test(e2e): strip slow-test probes                                                (revert prior probe commit)
[ ] ci: shard network e2e across N=3 matrix legs                                     (~40 lines _network-e2e.yml + 10 lines pr-network-e2e.yml + 5 lines agent.sh)
[ ] ci: bundle-grep guard against probe leak                                         (~10 lines _network-e2e.yml)
[ ] docs(pr): drop "advisory" callout, re-require Network e2e on dev                 (CLAUDE.md + ruleset update via gh CLI in PR description)
```

### 3.2 Sharding details

**Vitest `--shard` semantics** (verified from `node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:35-46`):
- Sorts test files by SHA-1 hex of the file path relative to `config.root` (deterministic, stable across runs and machines).
- Slices the sorted list by `calculateShardRange(filesCount, index, count)` (evenly distributes remainders to lower-index shards — shard 1 gets 1 extra file when 45 isn't divisible by 3).
- 45 files / 3 = 15 per shard exactly.

**Workflow shape** (concrete YAML):

`.github/workflows/pr-network-e2e.yml` — replace the existing `network-e2e` job with:

```yaml
network-e2e:
  name: Run
  needs: decide
  if: needs.decide.outputs.run == 'true'
  strategy:
    fail-fast: false       # don't cancel other shards if one fails — full picture matters
    matrix:
      shard: ['1/3', '2/3', '3/3']
  uses: ./.github/workflows/_network-e2e.yml
  with:
    ref: ${{ github.event.pull_request.head.sha || github.ref }}
    shard: ${{ matrix.shard }}
  secrets:
    SPONSORED_FPC_SALT: ${{ secrets.SPONSORED_FPC_SALT }}
```

`.github/workflows/_network-e2e.yml` — add `shard` input, forward to agent.sh:

```yaml
on:
  workflow_call:
    inputs:
      ref:
        required: false
        type: string
        default: ""
      shard:
        description: |
          vitest --shard expression (e.g. "1/3"). Empty string runs the full suite.
        required: false
        type: string
        default: ""
      # ... existing aztec_node_url, etc
    secrets:
      SPONSORED_FPC_SALT:
        required: false

jobs:
  network-e2e:
    name: ${{ inputs.shard && format('Aztec agent (shard {0})', inputs.shard) || 'Aztec agent' }}
    runs-on: ubuntu-latest
    timeout-minutes: 30      # down from 60 (per-shard wall-time is ~20m worst-case)
    env:
      VITEST_SHARD: ${{ inputs.shard }}
      # ... existing
    # ... existing steps ...
    - name: Run network e2e via agent
      run: bun run e2e:agent ${{ inputs.shard && format('--shard={0}', inputs.shard) || '' }}
```

`packages/extension/scripts/e2e/agent.sh` — pass-through args already forwarded to vitest (`"$@"` at line 60); only change is **docstring** at the top to document the new usage:

```sh
# Pass-through args go straight to vitest. Common flags:
#   --shard=N/M    Run only the N-th of M deterministic file slices.
#                  CI uses this; local dev usually runs unsharded.
#   <file-glob>    Run only matching test files (e.g. networks.test.ts).
```

**Status aggregation** (existing pattern in `pr-network-e2e.yml:95-114` already correct):

```yaml
status:
  name: Status
  if: always()
  needs: [changes, decide, network-e2e]
  runs-on: ubuntu-latest
  timeout-minutes: 2
  steps:
    - name: Aggregate results
      run: |
        for r in \
          "${{ needs.changes.result }}" \
          "${{ needs.decide.result }}" \
          "${{ needs.network-e2e.result }}" \
        ; do
          if [ "$r" = "failure" ] || [ "$r" = "cancelled" ]; then
            echo "::error::A required job failed or was cancelled: $r"
            exit 1
          fi
        done
        echo "Network e2e gate passed (or was skipped — no relevant changes / not labeled)."
```

Matrix-result aggregation: `needs.network-e2e.result` for a matrix-strategy job is `success` ONLY if ALL legs succeeded. `failure` if any leg failed. `cancelled` if any leg cancelled (including from `fail-fast: false` not protecting against external cancel like concurrency replacement). This is correct as-is; no change needed.

**Why `fail-fast: false`**: in PR debugging, you want to see "this shard fails AND that shard fails" as separate signals, not "this shard fails and the others got killed before they could tell you anything." For a flaky-CI repo specifically this is non-negotiable — the cancellation behavior obscures the diagnostic.

### 3.3 Local invocation
`bun run e2e:agent` — runs the full suite (no shard flag).
`bun run e2e:agent --shard=1/3` — runs only the first shard locally for repro of a CI failure.

The agent script's port-resolution already handles the no-shard case; we don't need shard-aware port packs because each CI shard runs on its own runner. **Local parallel shards (two `agent.sh` invocations in the same worktree at the same time) are NOT supported by this PR** — that's a different scope. CI matrix legs are on different runners so no port collision.

## 4. Phase A — TokenBalance fix details

### 4.1 The change in `TokenBalanceService.onTransactionUpdated`

`packages/extension/src/wallet/services/token-balance/service.ts:193-237` becomes:

```ts
private readonly onTransactionUpdated = async (tx: Tx) => {
    if (tx.status !== TxStatus.Pending) {
        if (tx.origin.type === OriginType.UI) {
            const addresses = new Set<string>()
            const contracts = new Set<string>()
            const tokenIds = new Set<number>()

            for (const c of tx.calls) {
                if (c.contract && c.transfers) contracts.add(c.contract)
                if (c.transfers) {
                    for (const t of c.transfers) {
                        addresses.add(t.to)
                        addresses.add(t.from)
                    }
                }
            }

            if (addresses.size > 0 && contracts.size > 0) {
                for (const t of this.tokens.values()) {
                    if (contracts.has(t.contract)) tokenIds.add(t.id)
                }

                const balances = await this.repo.getAll()
                const affected = balances.filter(
                    (tb) => addresses.has(tb.account) && tokenIds.has(tb.token),
                )

                // Synchronous projection for the user's own UI tx — we know
                // exactly which balances changed and the user is staring at
                // them. Routing through the 1s-tick async queue adds 1-8s of
                // visible lag for no benefit when we have the narrow scope.
                // Fall back to async queue if projection throws (network blip,
                // PXE blocked) so the next tick still picks it up.
                try {
                    const projected = await this.queue.projectAndEmitSync(affected)
                    // Anything not handled synchronously (shouldn't happen for
                    // a properly-narrowed UI tx) falls back to async.
                    for (const tb of affected) {
                        if (!projected.has(tb.id)) this.queue.enqueue(tb)
                    }
                } catch (err) {
                    this.logError("UI tx synchronous projection failed; falling back to async queue", err)
                    for (const tb of affected) this.queue.enqueue(tb)
                }
                return
            }

            await this.refreshAccountBalances(tx.account)
            return
        }

        await this.refreshAccountBalances(tx.account)
    }
}
```

### 4.2 New `BalanceJobQueue.projectAndEmitSync`

`packages/extension/src/wallet/services/token-balance/balance-job-queue.ts` adds:

```ts
/** Project a narrow set of balances synchronously, write storage, emit
 *  `onBalanceUpdated`, and return the set of IDs that were successfully
 *  projected. Used by `TokenBalanceService.onTransactionUpdated` for the
 *  user's own UI transactions where the scope is known and the lag is
 *  visible.
 *
 *  Caller falls back to `enqueue` for any IDs missing from the return set.
 *  Errors are NOT swallowed here — the caller's try/catch decides whether
 *  to fall back the whole batch. */
public async projectAndEmitSync(balances: TokenBalanceRaw[]): Promise<Set<number>> {
    if (balances.length === 0) return new Set()
    const ok = new Set<number>()
    const results = await this.projector.project(balances)
    const now = Date.now()
    for (const result of results) {
        if (result.kind === "error") continue   // queue will retry
        const current = await this.repo.get(result.id)
        if (!current) continue
        const updated: TokenBalanceRaw = {
            ...current,
            privateBalance: result.privateBalance,
            publicBalance: result.publicBalance,
            updatedAt: now,
        }
        await this.repo.set(updated)
        this.callbacks.onBalanceUpdated(updated)
        ok.add(result.id)
    }
    return ok
}
```

NB: no Task records get created for this path (those are for the user-visible "task journal"; sync projection is invisible by design). Optional follow-up: if `TaskService.startNewTask` is needed for journal-visibility of UI-triggered refreshes, gate it on `tx.origin.type === OriginType.UI` and create the task in the synchronous branch. **Not in this PR's scope** — out-of-band journal entries for already-confirmed txs are noise.

### 4.3 Helper removal in `helpers.ts`

Delete `waitForTokenDetailBalances` (`packages/extension/tests/e2e/fixtures/helpers.ts:514-547`). Update `transfers.test.ts` Step 6:

```ts
// ── Step 6: token detail shows correct post-transfer balances ────
{
    const page = await openPopup(tokenReadyExtension)
    await waitForHash(page, "#/popup/general")
    await navigateToTokenDetail(page)
    // Synchronous projection on tx settle (TokenBalanceService.onTransactionUpdated)
    // means the balance is current by the time we land on this page.
    const { privateBalance, publicBalance } = await getTokenDetailBalances(page)
    expect(publicBalance).toContain("950")
    expect(privateBalance).toContain("50")
    console.log("✓ Token detail balances correct (pub=950, priv=50)")
    await page.close()
}
```

### 4.4 Unit-test coverage (inline with the change)

Add to `packages/extension/src/wallet/services/token-balance/balance-job-queue.test.ts` (file may not exist — add it):
- `projectAndEmitSync` happy path: 1 balance, projection ok, returns set with the id, emits `onBalanceUpdated`.
- `projectAndEmitSync` partial: 2 balances, 1 errors → returns set with only the ok id; caller's fallback handles the other.
- `projectAndEmitSync` empty input: returns empty set, no projector call.

Add to `packages/extension/src/wallet/services/token-balance/service.test.ts` (likely exists; extend):
- UI-origin tx with narrow scope → synchronous emit observed.
- UI-origin tx with broad scope (no transfers detail) → falls back to async path.
- dApp-origin tx → falls back to async path (current behavior preserved).

## 5. Phase B — Slow-test probes

### 5.1 Reuse the storage-based probe pattern from PR #46's lessons

Reintroduce `packages/extension/src/wallet/utils/probe.ts` per the `probe-infrastructure.md` lesson doc — same shape (`VITE_E2E_PROBE === "1"` gate, unique-key storage writes, `probe(boundary, payload)` helper). Strip on Phase B.2 commit.

### 5.2 Probe boundaries

| # | Probe | Placement | Question |
|---|---|---|---|
| 1 | EC-PROVE-START / EC-PROVE-END | `packages/extension/src/wallet/services/execution/execution-coordinator.ts:69-86` (proveTxTask) | How long does each `pxe.proveTx` take? |
| 2 | EC-SIM-START / EC-SIM-END | same file `:51-67` (simulateTxTask) | Cumulative simulate time per tx? |
| 3 | EC-SEND-START / EC-SEND-END | same file `:88-99` (sendTxTask) | Node `sendTx` latency? |
| 4 | TX-RECEIPT-POLL | `packages/extension/src/wallet/services/transaction/service.ts:212-241` (`updateTx`) | How long does the node take to return a non-pending receipt after `sendTx`? |
| 5 | FIXTURE-CAP-WAIT | test-side, inside `dappConnectedExtension` fixture and inside the failing test files | Capture popup mount latency under load. |

### 5.3 Probe-run capture

- Add `_diag-slow-tx.test.ts` (deleted at strip) that runs JUST the 2 failing scenarios with `dumpProbes` on failure.
- Run on CI via `gh workflow run pr-network-e2e.yml --ref feat/network-followups` with the diagnostic file.
- Pull the artifact from `actions/upload-artifact` (existing `network-e2e-logs` artifact already includes `/tmp/aztec-*.log` paths but not the probe dump — extend it to glob `/tmp/nulo-probes-*.jsonl`).

### 5.4 2h time-box deliverable

If 2h elapses without a clear root cause, COMMIT `implementations-plan/network-followups/slow-tests-hypotheses.md` with:
- Probe boundaries wired (list).
- Sample probe trace for each of the 2 failing tests (anonymized — no addresses).
- Top 3 hypotheses with falsification criteria.
- Next-step probes that would falsify each.
- Status: "Deferred — probes archived; suite sharding mitigates by isolating these files on their own shard's load profile."

## 6. Phase C — Sharding rollout

### 6.1 Local validation BEFORE pushing the workflow change

```bash
bun run e2e:agent --shard=1/3   # ~14-16 files, ~12-18 min
bun run e2e:agent --shard=2/3   # ~14-16 files
bun run e2e:agent --shard=3/3   # ~14-16 files
```

Each must exit 0. If shard 1 or 3 contains BOTH slow files (`transfers` + `tx-sendTx-multicall` are 4-deep apart in file-path sort order — vitest's SHA-1 hash distribution determines which shard each lands in), document the wall-time delta in the PR body. If the worst shard is >25 min, **escalate to N=4** before the final push (see §10 Q3).

### 6.2 CI matrix validation

First push triggers 3 parallel runners. Pass criterion: all 3 exit 0. Re-run twice to confirm flake rate dropped from 7-9 to ≤1 (idiomatic for the slow tests if still in their shard).

### 6.3 Re-require Network e2e on `dev`

Once CI is green twice consecutively, update the PR body to remove the "advisory" callout and add the `gh api` command to re-add Network e2e to `dev`'s required-checks ruleset. The user runs the command manually post-merge (it's a single curl).

## 7. Phase D — Bundle-grep CI step (universal probe-leak guard)

This is the recovery PR's `probe-infrastructure.md` line 90 follow-up that hasn't shipped. Add as a step in `_network-e2e.yml` AFTER `bun run e2e:agent`:

```yaml
- name: Verify no probe code in shipped bundle
  if: always()
  shell: bash
  run: |
    cd packages/extension
    PROBE_HITS=$(grep -c -E '(PROBE|nulo:probe:|VITE_E2E_PROBE)' dist/chrome/**/*.js 2>/dev/null || echo 0)
    if [ "$PROBE_HITS" -gt 0 ]; then
      echo "::error::Probe strings found in built bundle ($PROBE_HITS hits)."
      echo "::error::Either VITE_E2E_PROBE was not unset, or a probe call-site bypassed the gate."
      grep -nE '(PROBE|nulo:probe:|VITE_E2E_PROBE)' dist/chrome/**/*.js | head -20
      exit 1
    fi
    echo "Bundle clean: no probe strings."
```

This is permanently in the workflow. When probes are gated correctly (Vite tree-shakes the off-branch), the check is silent. When somebody forgets to unset VITE_E2E_PROBE locally and pushes, the workflow fails loud.

**Caveat**: this runs in the test-execution job which builds WITH `VITE_E2E_PROBE=1` if the dev set it. The check should ONLY run when `VITE_E2E_PROBE` is unset (i.e., production-shaped build). Add gating:

```yaml
- name: Verify no probe code in shipped bundle
  if: always() && env.VITE_E2E_PROBE != '1'
  ...
```

CI never sets `VITE_E2E_PROBE=1` — so the check fires every CI run, validating that the agent script's no-probe path is bundle-clean.

## 8. Test plan

### 8.1 Local validation
- `bun run audit:vue` → green (TokenBalance fix passes typecheck + new unit tests).
- `bun run e2e:agent` (unsharded) → 61/61 (regression check).
- `bun run e2e:agent --shard=1/3`, `--shard=2/3`, `--shard=3/3` → each shard's 14-16 files passing.
- Manual: token detail page after a transfer shows fresh balance instantly (no second-long delay).

### 8.2 CI validation
- 3-shard matrix, each runner ~18-22 min, all 3 exit 0.
- Bundle-grep step fires per shard, passes (zero probe strings).

### 8.3 Regression criteria
- `bun run test:e2e` (smoke) ≥17 passing (1 pre-existing security flake allowance).
- No new lint warnings.
- No new biome `noExplicitAny` violations.

## 9. Security & Adversarial Considerations

### 9.1 Probe leakage (THE one we keep slipping on)
- **Threat**: probes ship to prod via VITE_E2E_PROBE gate failing or a call-site bypassing the gate. Browser-console-readable leak of method names, account addresses (if a buggy probe payload includes them), session IDs, queue depths.
- **Mitigation A**: every probe call-site uses `if (E2E_PROBE_ENABLED) probe(...)` per the lesson doc. The const is compile-time-replaced by Vite when VITE_E2E_PROBE is unset.
- **Mitigation B (the real safety property)**: **bundle-grep in CI** (§7). This is the guard rail; mitigation A is design intent. Both must be present.
- **Mitigation C (payload sanitization)**: probe payloads include ONLY method/boundary names, timestamps, elapsed ms, batch sizes, hashed sessionId (NOT raw). **No addresses, balances, ciphertext, manifests, balances in any payload.** Enforced by code review of every probe call-site that lands in this PR.

### 9.2 TokenBalance synchronous projection — privacy
- **Threat**: a synchronous projection on every UI tx settle is slightly more responsive than the prior async path; could this leak via timing? E.g., a deep-linked timer measuring the "time to balance update" could distinguish "wallet has X token" from "wallet has 0 of X token."
- **Mitigation**: the projection runs identically regardless of balance value (it's an `executeSimulateViews` that always queries `balanceOf(address)`). The TIMING is uniform; only the RESULT differs. No new oracle.

### 9.3 TokenBalance synchronous projection — error path
- **Threat**: synchronous projection throws → user sees stale balance + no error toast. Worse than async (which silently retries).
- **Mitigation**: fall-back to async queue on throw (per §4.1). The user sees the next tick's projection result if it succeeds. Existing async queue's error-handling lights up the TaskService journal.

### 9.4 Sharding — runner-state isolation
- **Threat**: a shard misbehaves and corrupts shared cache (Aztec CLI cache key is shared across shards in `setup-aztec` action via `actions/cache@v5`).
- **Mitigation**: each shard runs on its own ephemeral runner with its own filesystem. The cache is READ-ONLY for the consuming shard (it's a `restore-and-save` pattern in `actions/cache@v5`); saves happen on cache MISS only. Three shards racing to save on miss is benign — last-write-wins, all writes are identical (same version → same content).

### 9.5 Sharding — Aztec contract deploy cost × 3
- **Threat**: each shard now deploys SponsoredFPC + a test Token. That's ~3x the on-chain deploy cost vs the current single sandbox. NOT an adversarial threat, but a cost concern.
- **Mitigation**: the deploys are LOCAL (anvil/aztec sandbox per shard). No real cost. Reset on each runner.

### 9.6 Sharding — race in test-only fixture data
- **Threat**: tests assume specific account addresses or contract addresses; if those are deterministic (derived from seed), they're identical across shards and don't conflict; if random, they're isolated per shard. Verify.
- **Verification**: `createTestWallet` in `global-setup.ts:425` derives wallet from seed; `deployTestToken` uses the test wallet (deterministic). Each shard's deploys produce IDENTICAL addresses for SponsoredFPC + Token. NOT a problem; tests across shards don't compare addresses.

### 9.7 Bundle-grep — false negatives
- **Threat**: the grep pattern `(PROBE|nulo:probe:|VITE_E2E_PROBE)` could miss future probe naming.
- **Mitigation**: **convention**: all probe-related identifiers MUST contain "PROBE" or "probe" in their name. Document this in the probe.ts file header + add a test that asserts the pattern coverage on a representative probe call (live unit test against the grep pattern).

### 9.8 Slow-test 2h time-box — partial probe shipping
- **Threat**: if the time-box exits mid-investigation and we forget to strip probes, they ship.
- **Mitigation**: the strip commit is REQUIRED before merge. The bundle-grep CI step (§7) is the failsafe — if probes survive the strip commit, the CI build fails. Two-layer protection.

### 9.9 Sharding — CI-runner concurrency vs `concurrency` group
- The existing `concurrency: pr-network-e2e-...-${{ github.head_ref }}` group will cancel-in-progress on new commits. Matrix legs inherit this. NEW commits to the same PR cancel ALL running matrix legs (correct behavior). No change needed.

### 9.10 Supply chain (no change)
- No new deps. The fix is internal to `@/wallet/services/token-balance/`. The workflow change uses existing `actions/cache@v5`, `actions/upload-artifact@v7`, etc. `bun audit` baseline unchanged.

## 10. File catalog

### 10.1 TokenBalance fix
- `packages/extension/src/wallet/services/token-balance/service.ts` (~30 lines, lines 193-237 rewrite)
- `packages/extension/src/wallet/services/token-balance/balance-job-queue.ts` (new method `projectAndEmitSync`, ~25 lines)
- `packages/extension/src/wallet/services/token-balance/service.test.ts` (extend)
- `packages/extension/src/wallet/services/token-balance/balance-job-queue.test.ts` (new or extend)
- `packages/extension/tests/e2e/fixtures/helpers.ts` (delete `waitForTokenDetailBalances`)
- `packages/extension/tests/e2e/network/transfers.test.ts` (Step 6 simplification)

### 10.2 Slow-test probes (temporary)
- `packages/extension/src/wallet/utils/probe.ts` (re-introduce, then strip)
- `packages/extension/src/wallet/services/execution/execution-coordinator.ts` (5 probe sites — wrap proveTxTask/simulateTxTask/sendTxTask)
- `packages/extension/src/wallet/services/transaction/service.ts` (1 probe — updateTx)
- `packages/extension/tests/e2e/fixtures/extension.ts` (FIXTURE-CAP-WAIT probe inside `dappConnectedExtension`)
- `packages/extension/tests/e2e/network/_diag-slow-tx.test.ts` (new diagnostic — delete on strip)
- `implementations-plan/network-followups/slow-tests-hypotheses.md` (commit even if fix lands)

### 10.3 Sharding
- `.github/workflows/_network-e2e.yml` (add `shard` input, forward to agent.sh, bundle-grep step)
- `.github/workflows/pr-network-e2e.yml` (add `strategy.matrix.shard`, name suffix from input)
- `packages/extension/scripts/e2e/agent.sh` (docstring only — already forwards args)
- `packages/extension/vitest.e2e.network.config.ts` (drop the "advisory" comment block lines 28-44)

### 10.4 Docs
- `CLAUDE.md` (update e2e section + paths-filter section if needed)
- `PR #46-or-new-PR body` (drop advisory callout)
- `implementations-plan/network-followups/plan.md` (this consolidated plan + lessons subdir)
- `implementations-plan/network-followups/lessons/phase-A.md`, `phase-B.md`, `phase-C.md` per lesson-tracking discipline

## 11. Open questions before approval

1. **N=3 vs N=4 shards**: locked at N=3 default; willing to escalate to N=4 if empirical max-shard wall-time exceeds 22 min OR if both slow files hash into the same shard. **Question to user**: any opinion on the runner-minute budget threshold for escalation?

2. **TokenBalance synchronous projection — Task records?**: Should sync projections create a TaskService record (so the task journal shows them) or skip the journal? My recommendation: SKIP (UI-confirmed-tx-driven refreshes are invisible by design). **Question**: does the journal currently show "balance refresh" entries for the async path? If yes, we'd be regressing visibility for UI txs. If no, we're consistent.

3. **Slow-test 2h boundary**: 2h from when probes are wired, OR 2h from when probe data is captured (i.e., excluding the time to land the probe commit + run CI)? Recommendation: 2h from probe-wire start (includes CI iteration). **Question**: confirm?

4. **Bundle-grep step**: include in this PR even though probes are stripped in the same PR? My recommendation: YES — the lesson doc explicitly flags this as a follow-up and we should never have to write "bundle-grep not yet wired" again. **Question**: confirm scope creep is acceptable?

5. **Probe-leak retroactive scan**: do we also bundle-grep the historical `dist/chrome/` archives (release artifacts) to prove no past release shipped probes? My recommendation: NO (scope creep) — the existing `release.yml` builds from clean. **Question**: confirm out of scope?

6. **Network e2e re-required on `dev`**: do this in the same PR's body, or as a separate follow-up after this PR proves stable on CI? My recommendation: SAME PR body, but the user runs the `gh api` ruleset-update command post-merge themselves (don't automate ruleset changes from CI). **Question**: confirm?

7. **`fail-fast: false`**: I argue strongly for it (§3.2). **Question**: confirm OK?

## 12. Rejected / deferred

- **Per-file sandbox restart** (main plan §11 already rejected) — too slow, agreed.
- **Bumping `waitForFunction` timeouts to 240s** — papers over real slowness; user constraint #2 from PR #46 forbade this; same applies.
- **CI-only `retry: 3`** — already proven worse than `retry: 2` per PR #46 empirical data.
- **`onMounted` refresh in `tokens/[id].vue`** (main plan §5.1) — privacy + UX regression; root cause is service-side; fix that instead.
- **Aztec sandbox "warm pool" workflow** (e.g., pre-warm 3 sandboxes between PRs) — high infra complexity, low ROI vs sharding which spawns per-shard. Defer indefinitely.
- **Vitest `testNamePattern` filtering instead of `--shard`** — would let us assign slow tests to known shards, but adds maintenance burden (every new test file needs a routing decision). `--shard` is mechanical and durable.
- **Bumping per-test `retry` on the 2 slow files** — masks load-induced slowness, doesn't fix root cause; main plan correctly excludes.

## 13. Phase ordering (final)

```
[ ] A.1  TokenBalance: synchronous projection on UI tx settle    (1-2 commits)
[ ] A.2  Drop waitForTokenDetailBalances helper                  (1 commit)
[ ] A.3  Local + per-shard validation (manual)                    (no commit)
[ ] B.1  Slow-test probes wired (TEMPORARY)                      (1 commit)
[ ] B.2  CI probe-run to capture traces                          (push, observe, document)
[ ] B.3  Slow-test fix OR slow-tests-hypotheses.md (2h gate)     (≥1 commit)
[ ] B.4  Strip probes                                            (1 commit)
[ ] C.1  Sharding workflow + agent.sh changes                    (1 commit)
[ ] C.2  First CI matrix validation                              (push, observe)
[ ] C.3  Iterate on shard distribution if needed                 (≤2 commits)
[ ] D.1  Bundle-grep CI guard                                    (1 commit)
[ ] D.2  PR body: drop advisory, re-require check post-merge     (PR-description edit, no commit)
[ ] E.1  Final 3 consecutive CI runs all green                   (verify)
[ ] APPROVAL GATE for merge
```

## 14. Done definition

- `bun run e2e:agent` (unsharded) local: 61/61.
- CI: each of 3 shards exits 0; aggregate Status check green; flake rate ≤1 per 10 runs.
- Network e2e re-required on `dev` ruleset (via post-merge `gh api`).
- Token detail page shows fresh balance with no helper polling — `waitForTokenDetailBalances` deleted, replaced with direct `getTokenDetailBalances` read in `transfers.test.ts`.
- Slow-test investigation: fix landed OR `slow-tests-hypotheses.md` committed.
- All probes stripped (CI bundle-grep verifies).
- `bun run test:e2e` smoke green (1 known security flake allowance).
- `bun run audit:vue` green.
- PR body documents the deltas + reverts the recovery PR's advisory callout.

## 15. Decision provenance summary

| Decision | Source(s) | Reasoning |
|---|---|---|
| 3 follow-ups in 1 PR | user | constraint #4 |
| Sharding via GH Actions matrix | user | constraint #1 |
| 2h time-box on slow probes | user | constraint #2 |
| Tier A protocol | user | constraint #3 |
| **TokenBalance fix in service, not page** | opus (this doc) | root cause is service-level race between async-queue tick and tx-settle event |
| **Phase order: TokenBalance → probes → sharding** | opus (this doc) | stabilize before sharding; debug load against known-green baseline |
| N=3 shards (not N=4) | opus (this doc) | Aztec cold-start cost amortizes better with fewer shards; escalation criterion documented |
| **Bundle-grep step lands in this PR** | opus (this doc) | recovery PR lesson explicitly flagged it as follow-up; permanent guard rail |
| `fail-fast: false` on matrix | opus (this doc) | flaky-CI debugging needs full per-shard picture, not cancellation cascade |
| **No `onMounted` refresh in tokens/[id].vue** | opus (this doc) | privacy + UX regression; service-level fix obviates the need |
| Probes in proveTxTask/simulateTxTask | opus (this doc) | concrete time-sink in chunked multicall is barretenberg; probe where the time goes |
| `2h-deliverable: hypotheses.md` | opus (this doc) | otherwise the 2h burns with no archive |

## 16. What the main plan got specifically wrong

| Issue | Main plan claim | Reality |
|---|---|---|
| `tokens/[id].vue:58-77` reads `getTokenBalances(...)` on mount | Main plan §2.2 | Correct — but the watcher at `:52-56` ALSO subscribes to `onTokenBalanceUpdated`, so on-mount refresh is redundant if service emits correctly. Main plan misses this. |
| Concurrent CI runner cost "similar total runner-minutes" | Main plan §8.4 | Roughly correct directionally; under-estimates the sandbox cold-start overhead (5-7 min × 3 shards = 15-21 runner-min OVERHEAD per run that didn't exist before). Real ratio is ~1.7× cost for ~2× speedup. |
| `vitest.e2e.network.config.ts` change | Main plan §4.4 says "comment update only" + "Remove the 'advisory only' comment" | Correct on intent, but also implicit: keep `retry: 2`. Worth being explicit. |
| Phase ordering: sharding FIRST | Main plan §3.1 | Wrong — see major delta #1. |
| `executeOperations` per-operation probe | Main plan §6.1 | Right location but wrong granularity — the time sink is INSIDE proveTx, not in the operation dispatch loop. Per-operation timing won't differentiate fee-strategy simulates from authwit simulates from the prove itself. |
| Helper removal "Update `transfers.test.ts` to use `getTokenDetailBalances` directly (with a small poll if needed)" | Main plan §5.2 | The "small poll if needed" hedge invalidates the whole point of the fix — if service-level sync emit works, no poll needed; if it doesn't work, the test should fail loudly, not silently re-add the workaround. |
| Status aggregation `needs.network-e2e.result == 'failure'` for matrix | Main plan §3.2 | Correct shape, but misses `'cancelled'` (which the existing workflow already checks at `pr-network-e2e.yml:109`). Wouldn't regress because the existing pattern is being kept, but worth being explicit. |

## 17. What the main plan got right

- Stacking on `fix/e2e-network-suite-recovery` and rebase on dev after #46.
- Bundling all 3 in one PR per user constraint.
- Vitest `--shard` is stable and deterministic; sharding semantics are correct.
- Status aggregation needs explicit `failure || cancelled` check.
- Probe gating via `VITE_E2E_PROBE` per lesson docs.
- Strip probes BEFORE merge.
- Bundle-grep as belt-and-suspenders (though main plan hedges; this plan elevates to required).

## 18. Sources

- `implementations-plan/e2e-full-network-recovery/plan.md` — consolidated recovery plan
- `implementations-plan/e2e-full-network-recovery/findings.md` — probe findings + race fix narrative
- `implementations-plan/e2e-full-network-recovery/lessons/probe-infrastructure.md` — probe pattern, explicit "bundle-grep planned not yet wired"
- `implementations-plan/e2e-full-network-recovery/lessons/hypothesis-falsification.md` — "be ready to discard 80% of the plan after probes run"
- `implementations-plan/network-test-triage/full-suite-findings.md` — pre-PR-46 baseline + load-induced-flake characterization
- `packages/extension/src/wallet/services/token-balance/service.ts:193-237` — onTransactionUpdated
- `packages/extension/src/wallet/services/token-balance/balance-job-queue.ts` — async queue + 1s tick semantics
- `packages/extension/src/wallet/services/execution/execution-coordinator.ts:51-99` — proveTxTask / simulateTxTask / sendTxTask
- `packages/extension/src/wallet/services/transaction/service.ts:176-194` — runWorker 1s polling
- `packages/extension/src/popup/pages/tokens/[id].vue:52-56,58-77` — existing onTokenBalanceUpdated subscription
- `packages/extension/tests/e2e/fixtures/helpers.ts:514-547` — waitForTokenDetailBalances workaround
- `packages/extension/tests/e2e/fixtures/extension.ts:292-323` — dappConnectedExtension + dappConnectedExtensionPerTest fixtures
- `packages/extension/scripts/e2e/agent.sh:60` — `"$@"` pass-through
- `.github/workflows/_network-e2e.yml` — current shape (no shard input)
- `.github/workflows/pr-network-e2e.yml:85-93,95-114` — current shape + Status aggregation
- `node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:30-90` — vitest `--shard` semantics (SHA-1 hash of file path, slice by index/count)

---

End of independent opus 4.7 plan. Ready for consolidation with main + codex.
