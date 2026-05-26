# Network E2E Follow-ups — Plan (main, v1)

> Independent draft by main agent. Will be consolidated with codex's plan + opus's plan per Tier A protocol.

## 1. Context

### 1.1 Where we are
- PR #46 (`fix/e2e-network-suite-recovery`) landed: **61/61 local**, **52-54/61 CI**.
- 7-9 rotating-flake failures on CI per run — all infra-shaped (cumulative sandbox load).
- PR #46 body documents 3 follow-ups: **suite sharding**, **TokenBalance projection on mount**, **slow-tests investigation**.

This plan bundles all 3 into one PR.

### 1.2 Branch + base
- Stacks on `fix/e2e-network-suite-recovery` (per user constraint).
- New branch: `feat/network-followups`.
- Will rebase onto `dev` after PR #46 merges.

### 1.3 User constraints (explicit)
1. **Sharding shape: GH Actions matrix (parallel)** — split 45 files into N shards, each shard runs on its own runner with its own anvil+aztec sandbox.
2. **Slowness investigation: probe-driven, codex-led, 2h time-box** — don't block the PR on this. If root cause not found in 2h, document hypotheses + ship the other two.
3. **Tier A full protocol** — plan + dual audit + approval gate.
4. **One PR for all 3 follow-ups**.

### 1.4 Goal
- `bun run e2e:agent` per shard exits 0 on CI (each shard's 8-12 files passing).
- Network e2e workflow becomes a **required check on `dev`** again (currently advisory per #46).
- Token detail page shows correct post-tx balance without manual refresh (closes the `waitForTokenDetailBalances` helper's underlying gap).
- Slow tests either fixed OR documented with concrete next-step plan.

## 2. Three follow-ups breakdown

### 2.1 Suite sharding (P0 — biggest impact)

**Problem**: 45 files share one anvil + aztec sandbox spawned in global-setup. Cumulative on-chain state slows later files past their 120s `waitForFunction` timeouts. 7-9 rotating flakes per CI run.

**Approach**: GH Actions matrix strategy in `pr-network-e2e.yml`. N=4 shards (tunable). Each shard:
- Runs on its own `ubuntu-latest` runner
- Spawns its own anvil+aztec sandbox via existing `setup-aztec` + `global-setup.ts`
- Executes its slice of test files via vitest's `--shard` flag (e.g. `vitest run --shard=1/4`)

**Per-shard wall time estimate**: ~10-15 min (vs current ~30-40 min sequential).
**Concurrent CI cost**: ~4x parallel runners for ~12 min instead of 1 runner for ~35 min = ~similar total runner-minutes but ~3x faster feedback.

### 2.2 TokenBalance projection on mount (P1)

**Problem**: `packages/extension/src/popup/pages/tokens/[id].vue:58-77` reads `getTokenBalances(...)` on mount but doesn't force a refresh. Under e2e load, the projector hasn't caught up to the recent tx; UI shows stale balance.

**Current mitigation**: e2e helper `waitForTokenDetailBalances` clicks the Refresh button + polls.

**Proper fix**: on mount AND on `appStore.account` change, fire `tokenBalanceService.refreshTokenBalance(...)` and await the result (with timeout). This eliminates the test-side helper need AND gives users fresh balances by default.

**Code surface**: `packages/extension/src/popup/pages/tokens/[id].vue:58-77`, `packages/extension/src/wallet/services/token-balance/service.ts:193+`.

### 2.3 Slow-test investigation (P2 — time-boxed)

**Problem**: `multi-account-from` (148s on CI) + `tx-sendTx-multicall` (427s on CI) consistently hit 120s `waitForFunction` timeouts on tx confirmation. Persistent across both retry: 2 and retry: 3 runs.

**Approach**: probe-driven (use the storage-based probe pattern from PR #46 lessons — reintroduce just for this investigation, strip before merge):
- Probe the tx-confirmation path in wallet runtime
- Probe aztec sandbox tx mining latency
- Run the 2 failing tests with probes on CI, dump traces

**Time-box**: 2 hours total. If root cause unclear, document hypotheses + flag as known limitation.

**Hypotheses to test**:
- (H1) Aztec sandbox internal state buildup slows mining linearly with prior tx count
- (H2) `multi-account-from` does N concurrent calls, each waiting on the same shared resource
- (H3) `tx-sendTx-multicall` proves N transactions; cumulative prove time exceeds 120s

## 3. Strategy

### 3.1 Phased commits
```
[ ] Phase A — Suite sharding infra (workflow + agent.sh + vitest config) — 2-3 commits
[ ] Phase B — Validate sharding works (local + first CI run)
[ ] Phase C — TokenBalance on-mount refresh — 1-2 commits
[ ] Phase D — Remove the waitForTokenDetailBalances helper (now obsolete)
[ ] Phase E — Slowness probes + diagnostic test
[ ] Phase F — Probe-run CI + analyze
[ ] Phase G — Slowness fix OR documented limitations
[ ] Phase H — Strip slowness probes
[ ] Phase I — Update PR body, ensure CI Network e2e green required
```

### 3.2 Sharding strategy details

**Vitest 4 `--shard` flag**: divides test files into N groups by file path hash. Per shard, runs only its assigned files.

**Workflow shape**:
```yaml
network-e2e:
  strategy:
    matrix:
      shard: [1, 2, 3, 4]
  uses: ./.github/workflows/_network-e2e.yml
  with:
    shard: ${{ matrix.shard }}/4
```

The `_network-e2e.yml` reusable workflow takes a `shard` input and passes it to `bun run e2e:agent`. `agent.sh` forwards to vitest as `--shard=1/4`.

**Status aggregation**: `status` job needs to fail if ANY shard failed. Use `needs.network-e2e.result == 'failure'` (which evaluates true if any matrix job failed).

### 3.3 Local invocation
`bun run e2e:agent` still works for full-suite local runs (no shard flag = no sharding). `bun run e2e:agent --shard=1/4` for testing a specific shard locally.

## 4. Phase A — Sharding infra

### 4.1 `agent.sh` changes
- Accept positional `--shard=N/M` arg (or `SHARD=N/M` env var)
- Forward to vitest as `--shard=$SHARD`
- Adjust `.e2e-state/ports.json` path to be shard-aware (so concurrent shards on the same runner don't collide — though matrix runs on separate runners, so this is defensive)

### 4.2 `_network-e2e.yml` (reusable workflow) changes
- Add `shard` input (default empty)
- Pass to agent.sh: `bun run e2e:agent ${{ inputs.shard }}`

### 4.3 `pr-network-e2e.yml` changes
- `network-e2e` job: add `strategy.matrix.shard: [1, 2, 3, 4]`
- `status` job: aggregate all shards — fail if any one fails

### 4.4 `vitest.e2e.network.config.ts` changes
- Keep `pool: "forks"`, `isolate: true` (necessary per-shard)
- Keep `retry: 2` (per-shard load is now low enough)
- Remove the "advisory only" comment (sharding is the proper fix)

## 5. Phase C — TokenBalance on-mount refresh

### 5.1 `tokens/[id].vue` changes
On `onMounted` AND when `appStore.account` / `token.value` changes:
```ts
async function refreshAndRead() {
  if (!token.value || !appStore.account?.address) return
  tokenBalance.value = (await tokenBalanceService.getTokenBalances(token.value.id, appStore.account.address))?.at(0)
  // Then fire-and-forget refresh — the watcher on onTokenBalanceUpdated will update UI when complete
  if (tokenBalance.value?.id) {
    isRefreshingBalance.value = true
    tokenBalanceService.refreshTokenBalance(tokenBalance.value.id).finally(() => {
      isRefreshingBalance.value = false
    })
  }
}
```

### 5.2 Remove `waitForTokenDetailBalances` helper
In `tests/e2e/fixtures/helpers.ts`. Update `transfers.test.ts` to use `getTokenDetailBalances` directly (with a small poll if needed).

## 6. Phase E-G — Slow-test investigation

### 6.1 Probes (re-introducing the pattern)
Re-import `packages/extension/src/wallet/utils/probe.ts` from PR #46's lessons. Wire probes at:
- `executeOperations` per-operation timing
- `waitForTxConfirmation` (test-side) — capture polling cadence + final timestamps
- Aztec sandbox process: log tx mining latency from anvil's RPC

### 6.2 Probe-run on CI
- Push diagnostic branch with probes on
- Capture probe dumps from one CI run of multi-account-from + tx-sendTx-multicall
- Analyze trace to identify the dominant time sink

### 6.3 Fix or document
- If clearly identified (e.g. simple race or off-by-one): apply fix
- If broad infra slowness: document in lessons doc as "load-induced; sharding mitigates"

### 6.4 2-hour gate
Stopwatch starts when probes are wired. If 2h elapsed without identified cause, ship sharding + TokenBalance, document the slow tests.

## 7. Test plan

### 7.1 Local validation
- `bun run e2e:agent` → 61/61 (regression check, unchanged from PR #46)
- `bun run e2e:agent --shard=1/4` → ~12 files passing
- `bun run e2e:agent --shard=2/4`, `--shard=3/4`, `--shard=4/4` → other shards

### 7.2 CI validation
- First push: matrix of 4 shards each running ~10-12 files in ~10-15 min wall time
- Pass criterion: all 4 shards exit 0
- Removed advisory note from PR #46 in PR body; require Network e2e on dev again

### 7.3 TokenBalance regression check
- `transfers.test.ts` passes WITHOUT `waitForTokenDetailBalances` helper (uses plain `getTokenDetailBalances`)
- Manual QA: open token detail page after a transfer → balance updates within ~2s

## 8. Security & Adversarial Considerations

### 8.1 Sharding attack surface
- **Threat**: a shard that misbehaves could corrupt the shared CI cache or leak state across shards.
- **Mitigation**: each shard runs on a fresh ubuntu-latest runner with its own ephemeral filesystem. No shared mutable state.

### 8.2 TokenBalance refresh-on-mount privacy
- **Threat**: triggering a balance refresh on every page mount means more frequent RPC calls to the active network's node.
- **Mitigation**: refreshes were already happening (via the user-clicked refresh button); we're just doing it automatically. No new RPC surface, no new data exposure.

### 8.3 Slowness probes
- **Threat**: probes leaked to prod expose internal timing info.
- **Mitigation**: same VITE_E2E_PROBE gate as PR #46's investigation. Strip before merge (Phase H). CI bundle-grep recommended as belt + suspenders.

### 8.4 Concurrent CI runner cost
- **Threat**: 4x runners per PR = 4x GitHub Actions billing.
- **Mitigation**: only on PRs that touch network-relevant paths (existing `paths-filter` gate). Total runner-minutes are similar to current sequential (~35 min × 1 runner ≈ ~12 min × 4 runners).

### 8.5 Aztec sandbox state isolation per shard
- **Threat**: shard 2 might depend on contracts deployed by shard 1.
- **Verification**: each shard runs its own `global-setup.ts` which calls `deployContractsAndProvide`. No cross-shard dependencies.

## 9. File catalog

### 9.1 Sharding
- `.github/workflows/_network-e2e.yml` — add `shard` input
- `.github/workflows/pr-network-e2e.yml` — add `matrix.shard`, status aggregation
- `packages/extension/scripts/e2e/agent.sh` — accept/forward shard arg
- `packages/extension/vitest.e2e.network.config.ts` — comment update only

### 9.2 TokenBalance
- `packages/extension/src/popup/pages/tokens/[id].vue` — on-mount refresh
- `packages/extension/tests/e2e/fixtures/helpers.ts` — remove `waitForTokenDetailBalances`
- `packages/extension/tests/e2e/network/transfers.test.ts` — drop helper import

### 9.3 Slowness probes (temporary)
- `packages/extension/src/wallet/utils/probe.ts` — re-add (then strip)
- `packages/extension/src/wallet/services/execution/service.ts` — probes
- `packages/extension/tests/e2e/fixtures/helpers.ts` — probes in waitForTxConfirmation
- `packages/extension/tests/e2e/network/_diag-slow-tx.test.ts` — diagnostic test (then delete)

## 10. Open questions

1. **N=4 shards optimal?** Maybe 3 is enough if each shard handles 12-15 files. Need empirical timing.
2. **`--shard` flag stability**: vitest 4 `--shard` is stable; sharding semantics deterministic (file path hash)?
3. **TokenBalance refresh-on-mount**: should it await the refresh (slower mount) or fire-and-forget (faster mount but UI updates async)? Plan goes with fire-and-forget; user can override.
4. **Slow tests**: should the 2h time-box be strict, or extend if codex is close?

## 11. Rejected / deferred

- ~~Per-file sandbox restart~~ — too slow; matrix-shard is the right shape
- ~~Bumping `waitForFunction` timeouts to 240s~~ — papers over real slowness
- ~~CI-only retry: 3~~ — already proven (PR #46) to make things worse

## 12. Done definition

- `bun run e2e:agent` local: 61/61 (unchanged)
- CI: each of 4 shards exits 0; aggregate status passes
- Network e2e becomes required on `dev` ruleset
- Token detail page shows fresh balance without manual refresh in manual QA
- Slow-test investigation: fix landed OR documented with concrete follow-up plan
- All probes stripped (CI bundle-grep verifies)
- PR body updated; #46's "advisory" callout reverted
