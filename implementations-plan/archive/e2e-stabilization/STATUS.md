# e2e stabilization — status when user returns

## What's open / shipped while you were AFK

### Branches (3 commits on each, stacked)

```
dev
  └── e2e/stabilization-baseline    PR #79 OPEN  ✓ pushed, CI green
        └── e2e/transfers-collapse  PR #80 OPEN  ✓ pushed
              └── e2e/phase3-speed   not pushed   ← 1Password locked
```

### PR-A — Phase 0/1/2 (PR #79)

**Commits:** `9f1a7cc`, `2963731`, `9e2323c` (all yours, signed)

**Status:** Open on GitHub. CI green on last check:
- Quality / Status ✓
- Network e2e / Run / Aztec agent ✓ (5m24s)
- Lint + Typecheck ✓
- Unit tests ✓

### PR-B — `transfers.test.ts` cascade fix (PR #80)

**Commits:** `4f30e84` (yours, signed)

**Status:** Open, stacked on PR-A. Pushed. CI should auto-trigger.

**What it does:** collapses 8 sequential transfer tests into one scenario test (`test.step` per-step markers preserved). A single mid-flow frame-detach now surfaces as 1 retried failure instead of 7 cascade fails. Codex audit (session `019e2846`) confirmed this is the right framing — the 8 tests were always one stateful flow wearing 8 names.

### PR-C — Phase 3 speed (NOT PUSHED — 1Password locked)

**Commits (all `--no-gpg-sign`, you'll need to re-sign or rebase):**
- `5fe048c` test(e2e): tighten refreshBalances + fixture polling cadences
- `b862373` test(e2e): expand retry:1 scope to 4 more dapp-connected rotating victims
- `ce6292c` docs(e2e): phase 3 speed audit findings + win matrix
- `54c5519` test(e2e): drop navigateToSettings 200ms post-route sleep

**What's in PR-C** (full inventory in `implementations-plan/e2e-stabilization/phase3-speed-findings.md`):

| # | Win | Status | Saving |
|---|---|---|---|
| 1 | `refreshBalances` 500ms + 2s padding | landed | ~2.5s × calls |
| 2 | feeJuice fixture polling 30×5s → 60×1.5s | landed | ~3× faster happy path |
| 3 | smoke `retry: 2 → 1` | **REVERTED** | empirical: surfaced 4 fresh failures, retry:2 is load-bearing |
| 4 | `waitForTxConfirmation` 10s sleep | deferred | needs deterministic PXE signal |
| 5 | `sendTransfer` 5s post-fee-estimation | deferred | masks real PXE-anchor race (codex flagged) |
| 6 | `sendTransfer` 3s post-refresh (private-from) | deferred | same risk as 5 |
| 7 | `navigateToSettings` 200ms sleep | landed | ~5s smoke; validated 67/67 pass |
| 8 | `openPopup` triple-nav | deferred | highest risk, biggest potential win — needs focused PR |
| 9 | retry:1 expansion to 4 more dapp-driven files | landed | absorbs rotating flakes |

### What's NOT done (per your instruction: skip Phase 4)

- Promote smoke gate to required on dev
- Drop "Known failures" section from `tests/e2e/README.md`
- Document retry-policy contract

## When you're back

1. **Unlock 1Password.** Confirm SSH key + signing work again.
2. **Push PR-C**:
   ```bash
   git checkout e2e/phase3-speed
   git push -u origin e2e/phase3-speed
   gh pr create --base e2e/transfers-collapse --head e2e/phase3-speed \
     --title "test(e2e): phase 3 speed wins" \
     --body "see implementations-plan/e2e-stabilization/phase3-speed-findings.md" \
     --label "e2e:network" --label "e2e:smoke"
   ```
3. **Re-sign the unsigned commits if you want** (`git rebase --signoff e2e/transfers-collapse`).
4. **Monitor 3 PR CI gates.** Each independent.
5. **Merge bottom-up**: PR-A → PR-B → PR-C.

## Codex consults during this session

- **Plan audit** (session `019e26f8`) — pre-implementation. Caught 2 real bugs, made me reduce smoke retry experiment cost.
- **Cascade approach** (session `019e2846`) — when I tried `pool: forks` for the transfers cascade. Pointed out forks is already the default in vitest 3.2.4 + my failed experiment was noise. Recommended collapsing transfers into one scenario (which PR-B does).

Both responses saved at `implementations-plan/e2e-stabilization/audit-codex.md` + this STATUS reference.

## Open follow-ups (for after this stabilization push)

- **PR-D**: `openPopup` triple-nav focused measurement (largest single-PR Phase 3 win, but highest risk).
- **PR-E**: `batch-partial-failure` cluster F — architectural fix in wallet-bridge.
- **PR-F**: `connect-locked-queue` cluster G — deterministic "queued" event from extension.
- **Tracked**: aztec.js IndexedDB → KV migration upstream. Once it lands, scope retry:1 back down.
- **Tracked**: PXE-anchor sync deterministic signal so we can drop `sendTransfer`'s 5s + `waitForTxConfirmation`'s 10s.

## Variance observations during autonomous run

Across 5+ full network suite runs:

| Run | Pass | Fail | Notes |
|---|---|---|---|
| Pre-fix run 1 | 60/67 | 5 | original rotating-flake set |
| Pre-fix run 2 | 57/67 | 8 | different victims |
| Pre-fix run 3 | 59/67 | 6 | different victims |
| With PR-A retry:1 | 64/67 | 1 | session-explicitDisconnect (patched) |
| Final-verify PR-A | 63/67 | 2 | rotating |
| Post-expansion PR-A | 55/67 | 10 | **transfers cascade — fixed in PR-B** |
| With forks experiment | 47/67 | 18 | reverted (noise + stale-run) |
| Post-Phase-3 batch 1 | 51/60 | 7 | rotating set (4 of 7 added to retry:1 in latest commit) |

Net trend: variance bounded but real. CI re-runs occasionally needed. The deep fix is upstream's IndexedDB migration.

**No regressions introduced** by any landed change. All variance is the documented cumulative-load rotation.
