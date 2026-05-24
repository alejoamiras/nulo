# Network E2E Follow-ups — Consolidated Plan (v1)

> Tier A consolidation. Synthesizes `plan-main.md` (main agent), `audit-codex.md` (codex xhigh), `audit-opus.md` (opus 4.7 subagent). Each major decision below is annotated with `[SRC: main | opus | codex | consolidation]`. Conflicts resolved with explicit reasoning.

## 1. Context

### 1.1 Where we are
- PR #46 (`fix/e2e-network-suite-recovery`) landed: **61/61 local**, **52-54/61 CI**.
- 7-9 rotating-flake failures on CI per run — all infra-shaped (cumulative sandbox load).
- 3 follow-ups bundled here: suite sharding, TokenBalance on-mount refresh, slow-test investigation.

### 1.2 Branch + base
- Stacks on `fix/e2e-network-suite-recovery` (per user constraint).
- Branch: `feat/network-followups`.
- Will rebase onto `dev` after PR #46 merges.
- PR opens as DRAFT with a `## Blocked-on` callout pointing at #46. [SRC: opus]

### 1.3 User constraints (explicit)
1. **Sharding shape**: GH Actions matrix (parallel), one sandbox per runner.
2. **Slowness investigation**: probe-driven, codex-led, **2-hour time-box**.
3. **Tier A full protocol**.
4. **One PR** for all 3 follow-ups.

### 1.4 Goal
- Network e2e CI runs as N-shard matrix, each shard exits 0.
- Token detail page auto-refreshes balance on entry (helper `waitForTokenDetailBalances` deleted).
- Slow-test investigation: bounded fix OR documented findings.
- Bundle-grep CI guard against probe-leak (the recovery PR's outstanding follow-up). [SRC: opus]
- Network e2e becomes a **required check on `dev`** again. Out of scope to flip the ruleset in this PR — that's separate policy work, documented in PR body. [SRC: codex's correction over opus + main]

## 2. Decisions on the contested questions

| Question | Decision | Source | Reasoning |
|---|---|---|---|
| Shard count | **N=5** | codex | Vitest's SHA-1-of-file-path sharder is verified deterministic. N=4 clusters `multi-account-from.test.ts` + `tx-sendTx-multicall.test.ts` (the 2 known slow files) into the same shard; N=5 splits them. ~25% more runners for materially better worst-case shard wall-time. |
| Phase order | **Sharding first → TokenBalance → slow-test probes** | codex | Sharding is the highest-confidence CI win; iterate fast. Each subsequent phase rebases CI baseline on top of stable sharded gate. Opus's "stabilize before partitioning" argument is valid in principle but the helper TokenBalance fixes is well-understood; sharding has more uncertainty in CI behavior. |
| TokenBalance fix shape | **Page-level fire-and-forget on mount + watchers, helper deleted** | codex | `refreshTokenBalance` returns after enqueue, not after projection (verified `spec.ts:37-41`, `service.ts:108-114`). Awaiting it gives nothing. Opus's "synchronous projection in service" is bigger surgery on shared service code with broader risk. Page-level fix is localized, low risk. If e2e proves the page-level fix isn't enough, escalate to opus's service-level fix in a follow-up. |
| Touch `onTransactionUpdated`? | **No** | codex | Existing code at `service.ts:193-236` already enqueues targeted refreshes for UI-origin non-pending txs. The gap is page-entry timing, not missed fan-out. Opus's diagnosis of "1s tick lag" is real but compensated by the auto-refresh on mount + `onTokenBalanceUpdated` event. |
| Bundle-grep CI step | **Land in this PR** | opus | Recovery PR's `probe-infrastructure.md:90` explicitly flagged this as TODO. ~10 lines in `_network-e2e.yml`. Permanent guard rail against probe leak. |
| `fail-fast: false` on matrix | **Required** | opus + codex agreed | Flaky-CI debugging needs full per-shard picture, not cancellation cascade. |
| Probe placement | **Combine: `proveTxTask` + `simulateTxTask` (opus) + `getTxReceipt` + `executeAztecSendTx` (codex)** | consolidation | Cover both ends of the pipeline. Opus's coverage gets the bb.wasm cost; codex's gets the receipt-wait. Trace will tell us which dominates. |
| Slow-test fix candidate (if probes reveal one) | **`wait: "NO_WAIT"` for the 2 target tests if `getTxReceipt` dominates AND assertion is popup-shape** | codex | Concrete and actionable. Opus's bb.wasm cold-start theory is also testable but harder to mitigate. |
| `extension-network` paths-filter extension | **Add `services/token-balance/**` + `pages/tokens/**`** | codex | Without this, future TokenBalance-only bugfix PRs on `dev` skip the network matrix entirely. Caught by codex; missed by main + opus. |
| Artifact naming under matrix | **`network-e2e-logs-${{ inputs.shard \|\| 'full' }}`** | codex | `actions/upload-artifact` warns on same-name uploads from matrix legs. Must suffix. |
| `agent.sh` / `resolve-ports.ts` changes | **None (docstring updates only)** | codex | `agent.sh:60` already pass-through forwards `"$@"` to vitest. Matrix legs run on separate runners — no port collision. Smallest possible diff. |
| Make Network e2e required on `dev` ruleset | **OUT of PR scope** | codex | Policy work, not code. PR body documents the post-merge gh-api command for the user to run manually. |

## 3. Phased commit structure

```
[ ] Phase A — Sharding infra (caller workflow matrix + reusable workflow input + artifact rename) — 1 commit
[ ] Phase A.1 — First CI matrix validation push (no commit; observe)
[ ] Phase A.2 — Bundle-grep CI step (permanent probe-leak guard) — 1 commit
[ ] Phase B — TokenBalance: page-level mount-refresh — 1 commit
[ ] Phase B.1 — Delete `waitForTokenDetailBalances` + simplify `transfers.test.ts` — 1 commit
[ ] Phase C — Slow-test probes (TEMPORARY, gated VITE_E2E_PROBE) — 1 commit  [2h time-box STARTS here]
[ ] Phase C.1 — CI probe-run capture for the 2 target tests (no commit; observe traces)
[ ] Phase C.2 — Either: targeted slow-test fix (e.g. `wait: "NO_WAIT"`)  OR: commit `slow-tests-hypotheses.md`
[ ] Phase C.3 — Strip slow-test probes — 1 commit (revert prior probe commit)
[ ] Phase D — 3 consecutive green CI runs (verify; no commit unless flake exposed)
[ ] Phase E — PR body update (drop #46's advisory callout; document post-merge ruleset re-required)
```

## 4. Phase A — Sharding infra

### 4.1 `.github/workflows/pr-network-e2e.yml`

Replace the existing `network-e2e` job with:

```yaml
network-e2e:
  name: Run / shard ${{ matrix.shard }}/5
  needs: decide
  if: needs.decide.outputs.run == 'true'
  strategy:
    fail-fast: false       # flaky-CI debugging needs full per-shard picture
    matrix:
      shard: [1, 2, 3, 4, 5]
  uses: ./.github/workflows/_network-e2e.yml
  with:
    ref: ${{ github.event.pull_request.head.sha || github.ref }}
    shard: ${{ matrix.shard }}/5
  secrets:
    SPONSORED_FPC_SALT: ${{ secrets.SPONSORED_FPC_SALT }}
```

Extend the `extension-network` paths filter (codex catch):

```yaml
extension-network:
  - 'packages/extension/src/wallet/services/network/**'
  - 'packages/extension/src/wallet/services/execution/**'
  - 'packages/extension/src/wallet/services/fpc/**'
  - 'packages/extension/src/wallet/services/dapp-interaction/**'
  - 'packages/extension/src/wallet/services/dapp-session/**'
  - 'packages/extension/src/wallet/services/token-balance/**'   # ← new (codex)
  - 'packages/extension/src/popup/pages/tokens/**'              # ← new (codex)
  # ... existing entries ...
```

Keep the existing `status` reducer job unchanged. Matrix-result aggregation: `needs.network-e2e.result` for a matrix-strategy job is `success` ONLY if ALL legs succeed; `failure` if any leg fails; `cancelled` if any cancelled. Existing pattern at `pr-network-e2e.yml:104-113` already handles `failure || cancelled`. No change needed.

### 4.2 `.github/workflows/_network-e2e.yml`

Add `shard` input and forward to agent:

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
          vitest --shard expression (e.g. "1/5"). Empty string runs the full suite.
        required: false
        type: string
        default: ""
      # ... existing ...
```

Job step change:

```yaml
- name: Run network e2e via agent
  run: |
    if [ -n "${{ inputs.shard }}" ]; then
      bun run e2e:agent --shard=${{ inputs.shard }}
    else
      bun run e2e:agent
    fi
```

Artifact rename (codex catch):

```yaml
- name: Upload network e2e logs on failure
  if: failure()
  uses: actions/upload-artifact@v7
  with:
    name: network-e2e-logs-${{ inputs.shard || 'full' }}   # ← suffix to avoid matrix collision
    path: |
      packages/extension/.e2e-state
      /tmp/aztec-*.log
      /tmp/anvil-*.log
      /tmp/nulo-probes-*.jsonl                              # ← include probe dumps (Phase C)
    if-no-files-found: ignore
    retention-days: 7
```

Reduce `timeout-minutes: 60` → `30` (per-shard wall-time is ~15-20m worst-case). [SRC: opus]

### 4.3 `packages/extension/scripts/e2e/agent.sh`

**No functional changes**. `"$@"` pass-through at line 60 already forwards `--shard=N/M` to vitest. If we touch it at all, docstring update only:

```sh
# Pass-through args go straight to vitest. Common flags:
#   --shard=N/M    Run only the N-th of M deterministic file slices.
#                  CI uses this; local dev usually runs unsharded.
#   <file-glob>    Run only matching test files (e.g. networks.test.ts).
```

### 4.4 `packages/extension/vitest.e2e.network.config.ts`

No functional change. Update the existing "advisory only" comment in the `retry: 2` block — sharding is now the proper CI fix.

### 4.5 Local invocation

```bash
bun run e2e:agent              # full suite (no shard flag)
bun run e2e:agent --shard=1/5  # run only shard 1 of 5 (for CI repro)
```

Each shard locally takes ~12-18 min; full suite takes ~24 min.

### 4.6 Phase A.2 — Bundle-grep CI step

Add as final step in `_network-e2e.yml` job (lands as a separate commit so the diff is reviewable independently). Gate is a new workflow input (`probe`) — `env.VITE_E2E_PROBE` is only visible to `if:` if set at job/step env level, so we use an explicit boolean input. Grep uses `-R` (recursive) instead of `**` (which requires `globstar`); the `|| true` swallows the no-match exit code and we count via `wc -l`:

```yaml
# In _network-e2e.yml workflow_call.inputs:
probe:
  description: |
    Set to "1" when this workflow run is intentionally running with probes on
    (slow-test investigation). The bundle-grep guard skips when "1" because
    the build will legitimately contain probe strings.
  required: false
  type: string
  default: ""

# As final step in the agent job:
- name: Verify no probe code in shipped bundle
  if: always() && inputs.probe != '1'
  shell: bash
  run: |
    cd packages/extension
    HITS=$(grep -RnE '(PROBE|nulo:probe:|VITE_E2E_PROBE)' dist/chrome 2>/dev/null | wc -l | tr -d ' ')
    if [ "$HITS" -gt 0 ]; then
      echo "::error::Probe strings found in built bundle ($HITS hits)."
      grep -RnE '(PROBE|nulo:probe:|VITE_E2E_PROBE)' dist/chrome | head -20
      exit 1
    fi
    echo "Bundle clean: no probe strings."
```

[SRC: opus contributor; codex final-review correction on gate + globstar/wc-l].
Reason: `implementations-plan/e2e-full-network-recovery/lessons/probe-infrastructure.md:90` explicitly flagged this as a follow-up. Permanent guard rail.

## 5. Phase B — TokenBalance: page-level auto-refresh

### 5.1 `packages/extension/src/popup/pages/tokens/[id].vue`

Refactor to use shared helpers:

```ts
async function readCurrentTokenBalance() {
  if (!token.value || !appStore.account?.address) return
  tokenBalance.value = (await tokenBalanceService.getTokenBalances(token.value.id, appStore.account.address))?.at(0)
}

function scheduleRefresh() {
  if (!tokenBalance.value?.id) return
  // Fire-and-forget: refreshTokenBalance enqueues; balance arrives later via
  // the existing onTokenBalanceUpdated subscription at line 52-56.
  void tokenBalanceService.refreshTokenBalance(tokenBalance.value.id)
}
```

Wire to:
- `onMounted` — read first, then schedule refresh
- `watch(() => token.value, ...)` — same sequence
- `watch(() => appStore.account, ...)` — same sequence, with null guards
- `handleRefreshBalance` — call `scheduleRefresh()` (consolidates the button handler with the auto-refresh)

**Spinner state**: don't use `refreshTokenBalance(...).finally(() => isRefreshing.value = false)` — that measures RPC enqueue, not projection completion. If the spinner matters, follow the pattern in `BalanceView.vue:105-188` (subscribe to `TaskServiceClient` `BalanceUpdate` tasks). [SRC: codex]

### 5.2 Delete `waitForTokenDetailBalances` helper

`packages/extension/tests/e2e/fixtures/helpers.ts:514-547` — only call site is `transfers.test.ts:124-129`. Remove both.

### 5.3 Update `transfers.test.ts` Step 6

```ts
// ── Step 6: token detail shows correct post-transfer balances ────
{
  const page = await openPopup(tokenReadyExtension)
  await waitForHash(page, "#/popup/general")
  await navigateToTokenDetail(page)
  // Page auto-fires refreshTokenBalance on mount; wait for the DOM to reflect
  // the projection result.
  await page.waitForFunction(
    () => {
      const pub = document.querySelector('[data-testid="public-balance-value"]')?.textContent?.trim() ?? ""
      const priv = document.querySelector('[data-testid="private-balance-value"]')?.textContent?.trim() ?? ""
      return pub.includes("950") && priv.includes("50")
    },
    { timeout: 30_000, polling: 500 },
  )
  const { privateBalance, publicBalance } = await getTokenDetailBalances(page)
  expect(publicBalance).toContain("950")
  expect(privateBalance).toContain("50")
  await page.close()
}
```

The poll stays — we're waiting for ASYNC projection result, not forcing a refresh. What goes away is the **manual refresh button click + helper-internal poll**.

### 5.4 Regression check

Manual QA: open token detail page after a transfer → balance updates within ~2-3s without clicking refresh.

## 6. Phase C — Slow-test investigation (2h time-box)

### 6.1 Reintroduce probe pattern

Per `implementations-plan/e2e-full-network-recovery/lessons/probe-infrastructure.md`. Same shape: `import.meta.env.VITE_E2E_PROBE === "1"` gate, storage-based unique-key writes, `probe(boundary, payload)` helper. Strip at Phase C.3.

### 6.2 Probe boundaries (combined opus + codex)

| # | Probe | Placement | Purpose |
|---|---|---|---|
| 1 | EC-PROVE-START / EC-PROVE-END | `packages/extension/src/wallet/services/execution/execution-coordinator.ts:69-86` (proveTxTask) | bb.wasm prove time per tx [SRC: opus] |
| 2 | EC-SIM-START / EC-SIM-END | same file `:51-67` (simulateTxTask) | Cumulative simulate time [SRC: opus] |
| 3 | EC-SEND-START / EC-SEND-END | same file `:88-99` (sendTxTask) | Node sendTx latency [SRC: opus] |
| 4 | EXEC-AZTEC-SENDTX-START / END | `packages/extension/src/wallet/services/execution/service.ts:1891-1949` (executeAztecSendTx) | Full standard send path including `node.getTxReceipt` [SRC: codex] |
| 5 | EXEC-AZTEC-SENDTX-NOFROM-START / END | same file `:2040-2109` | No-from send path. **NOT** used by `multi-account-from` (clarified in codex final-review — `multi-account-from` clicks `pg-btn-sendTx-default` which calls `wallet.sendTx(exec, { from })` at `playground/src/sections/transactions.ts:77`, the standard path). Probe this only if a NO_FROM repro is added. [SRC: codex] |
| 6 | TX-RECEIPT-POLL (OPTIONAL) | `packages/extension/src/wallet/services/transaction/service.ts:212-241` (updateTx) | Activity-card lag — NOT the wait surface for either target test (their timeout is on `waitForPgResult`; the dApp response path does its own `node.getTxReceipt` inside `executeAztecSendTx`). Probe only if a separate activity-card-lag investigation arises. [SRC: opus contributor; codex final-review demoted to optional] |
| 7 | FIXTURE-CAP-WAIT | test-side, inside `dappConnectedExtension` fixture | Cap popup mount latency under load [SRC: opus] |

### 6.3 Diagnostic test file (TEMPORARY)

`packages/extension/tests/e2e/network/_diag-slow-tx.test.ts` runs JUST the 2 failing scenarios with `dumpProbes` on failure. **Run explicitly, not via shard.** Vitest's `--shard` is SHA-1-of-file-path, not filename sort, so the `_` prefix does NOT route it to any predictable shard. For the CI probe-run, invoke directly:

```yaml
- name: Probe-run slow-test diagnostics
  run: bun run e2e:agent tests/e2e/network/_diag-slow-tx.test.ts
  env:
    VITE_E2E_PROBE: "1"
```

The diagnostic test + this workflow step are both removed at Phase C.3 (strip). [SRC: codex final-review correction]

### 6.4 2h exit criterion

The 2h clock starts when the probe commit is pushed (Phase C). If 2h elapses without confident root cause, commit `implementations-plan/network-followups/slow-tests-hypotheses.md` with: probe boundaries wired, sample traces (anonymized), top 3 hypotheses with falsification criteria, next-step probes, status note. Then Phase C.3 (strip).

### 6.5 Bounded fix candidates

If probe data shows:
- **`getTxReceipt` dominates** AND the test's assertion is popup-shape (not mined-receipt): switch the playground send call to `wait: "NO_WAIT"`. [SRC: codex]
- **bb.wasm prove dominates** AND it's a per-fresh-browser cold-start: investigate browser-reuse patterns or accept as load-class.
- **Cap popup mount dominates**: bump only the cap popup wait timeout in those specific tests; document.

If sharded CI (already landed in Phase A) makes these tests pass: stop. Document "root cause was cumulative load; sharding mitigates."

### 6.6 Probe strip

Same shape as PR #46's strip commit. Delete `probe.ts`, all call sites, the diagnostic test file. Bundle-grep step from Phase A.2 verifies bundle is clean.

## 7. Test plan

### 7.1 Local validation
- `bun run audit:vue` → green (TokenBalance refactor passes typecheck)
- `bun run e2e:agent` → 61/61 (regression check)
- `bun run e2e:agent --shard=1/5` through `--shard=5/5` → each shard's 9 files pass
- Manual: token detail page after a transfer shows fresh balance auto-updates within ~3s

### 7.2 CI validation
- 5-shard matrix, each runner ~15-20 min, all 5 exit 0
- Bundle-grep step fires per shard, passes
- 3 consecutive green runs before approval gate (post-impl review)

### 7.3 Regression
- `bun run test:e2e` (smoke) ≥17 passing (1 known pre-existing security flake allowance)
- No new lint warnings, no new `noExplicitAny` violations

## 8. Security & Adversarial Considerations

### 8.1 Probe leakage (the recurring issue)
- **Threat**: probes ship to prod via VITE_E2E_PROBE gate failing OR a call-site bypassing the gate.
- **Mitigation A**: every probe call-site uses `if (E2E_PROBE_ENABLED) probe(...)` per the lesson doc. Compile-time replaced.
- **Mitigation B (THE leak guarantee)**: **bundle-grep CI step** (§4.6). Hard guard rail. [SRC: opus]
- **Mitigation C (payload sanitization)**: probe payloads include ONLY method/boundary names, timestamps, elapsed ms, batch sizes. **Never**: addresses, balances, ciphertext, manifests. Enforced by code review.

### 8.2 Sharding state isolation
- **Threat**: cross-shard state leak via Aztec CLI cache.
- **Mitigation**: each matrix leg gets its own runner filesystem; Aztec cache (`actions/cache@v5`) is read-only for consumers; saves only happen on cache MISS with identical content. No real risk. [SRC: opus + codex agreed]

### 8.3 Sharding CI cost
- **Threat**: 5x runners per PR vs 1x.
- **Mitigation**: `extension-network` paths-filter ensures only network-relevant PRs trigger. Total runner-minutes: ~5 runners × 18 min ≈ 90 vs current 1 × 35 = 35. **~2.6× cost for ~2× wall-time speedup**. Acceptable trade. [SRC: codex's more honest accounting vs main plan's "similar"]

### 8.4 TokenBalance page-level refresh — UX regression risk
- **Threat**: page now fires an RPC on every mount; if the user opens/closes token detail rapidly, multiple enqueues stack.
- **Mitigation**: `BalanceJobQueue` already dedups pending tasks (`balance-job-queue.ts:47-50, 78-84`). [SRC: codex]
- **Threat**: page renders cached stale, then refresh arrives — perceived as flicker.
- **Mitigation**: this is ALREADY the architecture; we just trigger it more reliably. Mitigation B in the prior balance views (BalanceView, TokensView) uses TaskService spinner state for an explicit "refreshing" indicator. Apply same pattern if needed (small follow-up).

### 8.5 Slow-test probes
- Same controls as PR #46. No new attack surface.

### 8.6 `wait: "NO_WAIT"` (if probe data leads here)
- **Threat**: switching `multi-account-from` / `tx-sendTx-multicall` to `NO_WAIT` weakens the "tx was mined" assertion.
- **Mitigation**: both tests' real assertion is popup-shape (cap account list, multicall payload count), not receipt confirmation. A test that ALSO needs the mined receipt should still wait. [SRC: codex]

### 8.7 Supply chain
- No new deps. Workflow uses existing `actions/cache@v5`, `actions/upload-artifact@v7`. `bun audit` baseline unchanged.

### 8.8 Required-check policy re-flip
- The PR body documents the post-merge `gh api` command for user to run. NOT automated from CI. Ruleset changes from CI = potential foot-gun.

## 9. File catalog

### 9.1 Sharding (Phase A)
- `.github/workflows/pr-network-e2e.yml` — matrix, fail-fast, paths-filter extension
- `.github/workflows/_network-e2e.yml` — shard input, agent invocation, artifact rename, bundle-grep step
- `packages/extension/vitest.e2e.network.config.ts` — comment update only

### 9.2 TokenBalance (Phase B)
- `packages/extension/src/popup/pages/tokens/[id].vue` — onMount auto-refresh, shared helpers
- `packages/extension/tests/e2e/fixtures/helpers.ts` — delete `waitForTokenDetailBalances`
- `packages/extension/tests/e2e/network/transfers.test.ts` — drop helper import, use direct waitForFunction

### 9.3 Slow-test probes (Phase C — TEMPORARY)
- `packages/extension/src/wallet/utils/probe.ts` — re-introduce
- `packages/extension/src/wallet/services/execution/service.ts` — EXEC-AZTEC-SENDTX probes
- `packages/extension/src/wallet/services/execution/execution-coordinator.ts` — EC-* probes
- `packages/extension/src/wallet/services/transaction/service.ts` — TX-RECEIPT-POLL probe
- `packages/extension/tests/e2e/fixtures/extension.ts` — FIXTURE-CAP-WAIT probe
- `packages/extension/tests/e2e/network/_diag-slow-tx.test.ts` — new diagnostic (deleted at strip)
- `implementations-plan/network-followups/slow-tests-hypotheses.md` — commit even if fix lands

### 9.4 Docs (final)
- `implementations-plan/network-followups/plan.md` — this document
- `implementations-plan/network-followups/lessons/phase-N.md` per CLAUDE.md lesson-tracking
- PR #46-or-new-PR body — drop advisory callout

## 10. Open questions before approval

1. **5 concurrent ubuntu-latest runners** — acceptable for the repo's Actions budget? My recommendation: yes, paths-filter restricts to network-relevant PRs only.
2. **Slow-test 2h boundary timing** — 2h from probe commit pushed OR from probe data captured? Recommendation: from probe commit (includes CI iteration overhead).
3. **TokenBalance: if e2e test poll for balance to flip still times out** — escalate to opus's service-level sync projection? Recommendation: yes — add as follow-up if observed.
4. **`wait: "NO_WAIT"` for slow tests** — if codex's hypothesis lands, change both tests? Recommendation: yes, with a one-line comment explaining the change.

## 11. Rejected / deferred

- ~~Per-file sandbox restart~~ — too slow; matrix is the shape
- ~~Bumping `waitForFunction` timeouts to 240s~~ — papers over
- ~~CI-only `retry: 3`~~ — already proven worse in PR #46
- ~~`onMounted` refresh in tokens/[id].vue with await~~ — `refreshTokenBalance` is enqueue-only [SRC: codex]
- ~~Service-level sync projection in `onTransactionUpdated`~~ — bigger surgery for marginal benefit; page-level fix sufficient if `onTokenBalanceUpdated` event arrives within poll window. Deferred as follow-up if needed.
- ~~Aztec sandbox "warm pool"~~ — high infra complexity, low ROI
- ~~Network e2e re-required on `dev` ruleset~~ — policy work, separate from this PR
- ~~Vitest `testNamePattern` for slow-test routing~~ — adds maintenance burden; `--shard` is mechanical

## 12. Done definition

- `bun run e2e:agent` local: 61/61 (regression check)
- CI: each of 5 shards exits 0; aggregate Status check green
- Network e2e flake rate ≤1 per 10 runs (3 consecutive green required before merge)
- Token detail page auto-refreshes balance on entry; `waitForTokenDetailBalances` deleted
- Slow-test investigation: fix landed OR `slow-tests-hypotheses.md` committed
- All probes stripped (CI bundle-grep guards this permanently)
- Bundle-grep CI step in place
- `bun run test:e2e` smoke green (1 known security flake allowance)
- `bun run audit:vue` green
- PR body documents the deltas + reverts the recovery PR's advisory callout + includes the post-merge `gh api` ruleset command

## 13. Sources

- `implementations-plan/network-followups/plan-main.md` — main agent v1 (247 lines)
- `implementations-plan/network-followups/audit-codex.md` — codex xhigh (593 lines)
- `implementations-plan/network-followups/audit-opus.md` — opus 4.7 (668 lines)
- This document — main agent's consolidation pass, 2026-05-24

## 13a. Final codex review (post-consolidation)

Codex final pass: **APPROVE-WITH-MINOR-FIXES**. Three concrete corrections applied:

1. **Bundle-grep step fix** (§4.6): `env.VITE_E2E_PROBE` isn't visible to `if:` from a `run` step's env. Switched to a dedicated `probe` workflow input gate. Also replaced `dist/chrome/**/*.js` (requires `globstar`) with `grep -R dist/chrome` + `wc -l` for reliable matching.
2. **Probe table row 5** (§6.2): `multi-account-from` does NOT use the NO_FROM path — it calls `pg-btn-sendTx-default` → `wallet.sendTx(exec, { from })`. Removed the misleading label; clarified probe 5 is only for an added NO_FROM repro.
3. **Probe table row 6** (§6.2): `TX-RECEIPT-POLL` is the wrong wait surface for the 2 target tests (their timeout is on `waitForPgResult`; the dApp send path calls its own `getTxReceipt` inside `executeAztecSendTx`). Demoted to OPTIONAL.
4. **Diagnostic test invocation** (§6.3): vitest's `--shard` is SHA-1-of-file-path, not filename sort. Updated to invoke `_diag-slow-tx.test.ts` explicitly in CI, not via shard targeting.

The core consolidations (N=5 shards, page-level TokenBalance fix, no `onTransactionUpdated` touch, sharding-first phase order, bundle-grep included, fail-fast: false, agent.sh unchanged, paths-filter extended, artifact rename, ruleset-out-of-scope) are all approved.

## 14. Decision provenance summary

| Decision | Source(s) | Reasoning |
|---|---|---|
| 3 follow-ups in 1 PR | user | constraint #4 |
| Sharding via GH Actions matrix | user | constraint #1 |
| 2h time-box on slow probes | user | constraint #2 |
| Tier A protocol | user | constraint #3 |
| **N=5 shards (not 3 or 4)** | codex | Verified SHA-1 distribution clusters slow files at N=4 |
| **Phase order: sharding first → TokenBalance → probes** | codex | Sharding is highest-confidence CI win; rebase later phases on stable baseline |
| **TokenBalance fix at page level (fire-and-forget)** | codex | refreshTokenBalance is enqueue-only; service-level fix unnecessary risk |
| **No `onTransactionUpdated` changes** | codex | Existing code is correct; gap is page-entry timing |
| **Bundle-grep CI step lands in this PR** | opus | Recovery PR's lesson explicitly flagged it as follow-up |
| **fail-fast: false** | opus + codex agreed | Full per-shard picture for flake debugging |
| **Combined probe placement** (proveTx + simulateTx + sendTx + getTxReceipt + fixture) | consolidation | Cover both ends of the pipeline |
| **`wait: "NO_WAIT"` as targeted fix candidate** | codex | Concrete and actionable if probes confirm |
| **Extend `extension-network` paths-filter for TokenBalance** | codex | Without this, future TokenBalance bugfixes skip network gate |
| **Artifact rename for matrix** | codex | `actions/upload-artifact` collision warning |
| **No agent.sh / resolve-ports.ts changes** | codex | Already pass-through compatible |
| **Required-check ruleset out of scope** | codex | Policy, not code; user runs post-merge gh api manually |
