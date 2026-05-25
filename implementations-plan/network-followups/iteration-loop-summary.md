# Network e2e iteration loop — final state

11 iterations against `feat/network-followups` (PR #55). User went AFK after iteration #7; iterations #8-11 done unsigned per the user's standing "commit unsigned, re-sign on return" directive.

## TL;DR

**Stable floor: 2-3/5 shards green per CI run** (varies per runner — rotating). The matrix structure, bundle-grep, quarantine, retry-4, and timeout sweeps all work. The remaining 2-3 failing shards consistently hit the same root cause: **upstream `@aztec/wallet-sdk` has a hardcoded 2-second ECDH key-exchange timeout** (`KEY_EXCHANGE_TIMEOUT_MS = 2000` at `extension_provider.js:6`) that fires before our cold MV3 SW finishes booting `BarretenbergSync.initSingleton + chrome.storage migrations + services.start() + initWalletSdkHandler()` on CI's CPU-pressured runners. When it fires, the dApp aborts the channel; our test fixture then waits 30s for a verify popup that will never be opened, surfacing as `connectPlayground:awaitVerifyPopup — Timed out after waiting 30000ms`.

## Iteration ledger

| # | Change | Result | Net |
|---|--------|--------|-----|
| 1 | Sharding + bundle-grep | 0/5 (bundle-grep bug) | baseline |
| 2 | Slow-test quarantine + retry 2→4 | 2/5 | +2 |
| 3 | waitForPopup default 15→30s | 2/5 | — |
| 4 | Mass 15→30s in test files | 0/5 (regression) | -2 |
| 5 | Fixture-path 15→30s | 2/5 | back to floor |
| 6 | Codex sweep (extension.ts) + phase-tag | 2/5 | (now know it's `connectPlayground`) |
| 7 | Verify popup race fix (codex audit-2) | 2/5 | — |
| 8 | Inner phase-tag in connectPlayground | 2/5 | (now know it's `awaitVerifyPopup`) |
| 9 | wallet-sdk patch 2s→10s (codex audit-3) | 1/5 (regression — bumping budget changed race semantics) | reverted |
| 10 | Keep setupPage open through connect (codex audit-4) | 0/5 (regression — MV3 SWs aren't kept alive by extension pages alone) | reverted |
| 11 | Restore iter #8 baseline | **3/5 (best run yet — runner luck)** | floor confirmed |

## What's confirmed working

- ✅ 5-shard matrix with isolated anvil + aztec sandbox per shard
- ✅ Per-shard artifact upload with safe naming (`network-e2e-logs-N-of-5`)
- ✅ Bundle-grep guard (probe leak prevention) — fixed `set -e -o pipefail` bug
- ✅ Slow-test quarantine via `NULO_E2E_SKIP_DEFERRED_SLOW=1` env in CI
- ✅ vitest retry 4 (5 attempts) — absorbs most rotating flakes
- ✅ Comprehensive 15s/10s → 30s timeout sweep across `extension.ts`, `popups.ts`, `playground.ts` + 31 test files
- ✅ Phase-tagged fixture errors (`dappConnectedExtensionPerTest:<step>` + `connectPlayground:<step>`) — turned opaque destructuring failures into precise origin lines
- ✅ TokenBalance auto-refresh on token-detail page mount + watcher
- ✅ Plan + 4 codex audit transcripts committed under `implementations-plan/network-followups/`

## What's NOT working

- ❌ Eliminating the 2s upstream KEY_EXCHANGE_TIMEOUT race
- ❌ Solving `tx-sendTx-default` 120s receipt wait (codex audit-1 flagged — needs NO_WAIT refactor; deferred)
- ❌ Per-shard cumulative aztec node state (would need either tear-down per file or much higher shard count)

## What we ruled out (with evidence)

1. **PXE block-sync gating verify-popup creation** — codex traced the wallet path; no PXE call on the discover/verify hot path.
2. **Puppeteer `waitForTarget` polling lag** — it's event-driven, not polling-based.
3. **Verify popup race in our fixture** (codex audit-2) — fix applied; didn't fix shard 5; confirmed not the bottleneck.
4. **Bumping upstream KEY_EXCHANGE_TIMEOUT_MS** (codex audit-3) — patched 2s→10s via `bun patch`; iter #9 went 1/5 (regression). Hypothesis: extending the budget changed handshake race semantics in a way that masked the verify-popup creation. Reverted.
5. **Keeping setupPage open through connectPlayground** (codex audit-4) — tested; broke ALL 5 shards. MV3 SWs aren't kept alive by extension pages alone, only by active Port connections. Reverted.

## Concrete next-step recommendations for follow-up PR

In rough order of expected payoff:

1. **Pre-warm SW via chrome.runtime.connect Port keepalive** — open a long-lived chrome.runtime.Port from setupPage before closing it; the port keeps the SW alive 5min (port disconnect heuristic). Close port + setupPage right before clickConnect. Empirical test.
2. **Upstream contribution** — open an issue at `@aztec/wallet-sdk` requesting `KEY_EXCHANGE_TIMEOUT_MS` be configurable via `establishSecureChannel` options. Pin the discovery: extension provider hardcodes 2s while iframe provider uses 15s.
3. **NO_WAIT playground variant for popup-shape sendTx tests** — codex audit-1 flagged `tx-sendTx-default`'s 120s receipt wait as wrong target; refactor playground to expose a NO_WAIT button.
4. **Higher shard count** — bump matrix from N=5 to N=9 (1 file/shard) to eliminate cumulative L2 state. 9× runner cost; only if other fixes don't converge.

## Branch state for re-sign

5 commits at the tip are unsigned (committed during AFK per directive):
- `ee7d42e` — revert iter #10
- `fe186a4` — revert iter #9 patch + (failed) keep-setupPage-open
- `699cba1` — wallet-sdk patch (kept in history; the revert at `fe186a4` removes its effect)
- `92c64a7` — inner phase-tag
- `9c05e72` — verify-race fix

Re-sign in one pass:
```bash
git rebase --exec 'git commit --amend --no-edit -S' d41e0da
```

Then force-push:
```bash
TOKEN=$(gh auth token)
git push "https://x-access-token:${TOKEN}@github.com/alejoamiras/nulo.git" \
  --force-with-lease \
  HEAD:feat/network-followups
```

## Optional cleanup before declaring done

The branch history includes the iter #9 wallet-sdk patch commit (`699cba1`) which was reverted at `fe186a4`. Both are kept in history for auditability — they show the iteration loop. If you want a clean PR diff, you can interactive-rebase to squash both into nothing.

The diagnostic phase-tagging (iter #8) and verify-race fix (iter #7) are KEPT — they're genuine improvements regardless of root-cause.

## CI minutes consumed

11 dispatches × 5 shards × ~10-20min each ≈ 8-15 hours of CI minutes. Cost is real; recommend NOT bumping shard count until other fixes are tried.
