# Popup-Handshake Fast-Path — Design + Implementation Plan

Status: **revised (post-codex audit, ready to ship)**

## Problem

`tests/e2e/fixtures/extension.ts:openPopup` unconditionally does a triple-navigation to work around an empirical SW handshake bug:

```ts
await page.goto(popupUrl)
await page.goto("about:blank")        // ← the workaround
await page.goto(popupUrl)
await page.waitForFunction(() => hash !== "#/" && hash !== "", { timeout: 15_000 })
```

Comment in the source: *"Empirically the SW's first popup connection on a brand-new tab can lose the wallet-bridge handshake (popup logs 'Client disconnected'… and Vue never mounts; hash stays at '#/')."*

**115 call sites** across the e2e suite. Conservative estimate ~500-700ms of redundant navigation per call.

## The hypothesis

The Vue router redirects away from `#/` only when the app actually mounts — which requires the SW handshake to succeed. So we already have a signal for "handshake landed": the post-mount hash being something other than `#/`.

If we **try the single-goto first**, wait briefly for that signal, and fall back to the about:blank dance only on timeout, we get the savings without giving up the workaround when it's actually needed.

## Measurement

### Methodology

Replaced the unconditional triple-nav with a fast-path-then-fallback (`tests/e2e/fixtures/extension.ts:openPopup`):

```ts
await page.goto(popupUrl, { waitUntil: "domcontentloaded" })
try {
    await page.waitForFunction(() => hash !== "#/" && hash !== "", {
        timeout: 2_000, polling: 100,
    })
    // fast path
} catch {
    // fallback: classic triple-nav
    await page.goto("about:blank")
    await page.goto(popupUrl, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => hash !== "#/" && hash !== "", {
        timeout: 15_000, polling: 200,
    })
}
console.log(`[openPopup-spike] path=... totalMs=... ...`)
```

Each call emits `[openPopup-spike]` to stdout. Post-run grep + awk aggregates path-taken + duration distribution.

### Smoke results

Full smoke suite (`bun run --cwd packages/extension test:e2e`):
- **67 / 67 tests passed**
- Suite wall time: **260s** (down from ~322s baseline = ~62s saved)
- **103 openPopup invocations**
- **103 / 103 took the fast path. Zero fallbacks needed.**

Fast-path duration distribution:

| Stat | Value |
|---|---|
| Mean | 198ms |
| P50 | 150ms |
| P90 | 273ms |
| P99 | 811ms |
| Max | 936ms |

Conclusion: in smoke conditions, the workaround is unnecessary every single time. The 2s budget is conservative — P99 is 811ms.

### Network results

Targeted run of 9 test files (the 8 dapp tests that flaked yesterday + transfers):
- **9 / 11 tests passed**, 2 failed
- Suite wall time: 258.72s
- **31 openPopup invocations**
- **31 / 31 took the fast path. Zero fallbacks.**

Fast-path duration distribution (network):

| Stat | Value |
|---|---|
| Mean | 170ms |
| P50 | 158ms |
| P90 | 231ms |
| P99 | 238ms |
| Max | 238ms |

Tighter distribution than smoke — likely because the SW is already warm after global setup.

**The 2 failures are unrelated to openPopup.** Both `cancel-mid-prove` (the same `expect(parsed.code).toBe(4001)` assertion failure that hit yesterday) and `cap-request-repeat-noPopup` (TimeoutError waiting for the second cap-request to skip the popup) occur **after** openPopup completes successfully. The exact `LifecycleWatcher disposed` failure mode from yesterday — which fired at the *second* goto in the triple-nav — did not surface in this run because the fast path never reaches that goto.

This is the strongest evidence we have so far that the fast-path-with-fallback shrinks the flake surface: yesterday's run produced 8 LifecycleWatcher failures; today's targeted re-run of the same files produced 0.

## Design

### Recommended approach: ship the spike, with codex-driven tightening

Three changes from the initial spike, applied after codex audit:

1. **Tightened readiness predicate.** The spike used `hash !== "#/"` alone. Codex found this fires too early: `app.vue:214` pushes `/popup/auth` BEFORE `initNetworks()` / `initAccount()` complete, and `index.vue` immediately pushes `/popup/general` before the wallet-bridge is connected. In the spike's smoke run this was hidden because every caller does its own `waitForHash` / `waitForSelector` afterwards, but `openPopup` itself was overclaiming readiness.

   New predicate: hash !== `"#/"` **AND** `[data-testid="global-loader"]` is absent. `GlobalLoader.vue:13` renders the testid when `!isBackgroundConnected`; its absence is the correct "wallet-bridge connected" signal.

2. **Narrowed catch to `TimeoutError`.** The spike caught any thrown error and fell back. Codex caught: page crashes, CDP disconnects, etc. would be silently swallowed by the fallback. Now we re-throw anything that isn't a `TimeoutError` so the real fault surfaces.

3. **Budget marked provisional.** Codex noted that `launchExtension()` already pre-warms the SW (the `nulo:liveness` wait at line 70-80 runs before any test starts), so the spike's P99 numbers don't cover true cold-start. The 2s budget stays, but the plan documents this as a known limitation. If `NULO_E2E_OPENPOPUP_LOG=1` ever shows non-zero fallbacks in CI, we extend the first-call budget.

Reasoning held over from initial spike:

- **No wallet-side marker is needed.** Codex's earlier audit raised concerns about `chrome.storage.session` lifecycle + Vue watcher timing. Those concerns don't apply here because we're not introducing a new marker — we're reordering existing waits + adding the global-loader check.
- **Fallback preserves correctness.** If the handshake bug ever surfaces, the `catch` block does the about:blank dance and we're back to old behavior. Budget cost: 2s extra latency on the rare failure.
- **Logging stays env-gated.** `NULO_E2E_OPENPOPUP_LOG=1` re-emits a per-call `[openPopup] path=... totalMs=...` line so we can count fallback-incidence in CI artifacts.

### Known limitations (codex)

- **Fallback path still has the second-goto flake.** The about:blank → popup sequence is exactly where yesterday's 8 `LifecycleWatcher disposed` failures fired. We've shrunk the blast radius (rare fallback → rare flake) but the per-fallback hazard hasn't moved. Follow-up: if fallbacks ever appear in CI, replace the fallback's second goto path too.
- **Cold-start coverage gap.** Measurement was against a prewarmed SW. Treat the 2s budget as provisional until CI data confirms.

### Alternatives considered (and rejected)

**A. Wallet writes `popup-ready` marker to `chrome.storage.session`.**
- Rejected (codex `019e2c76`): storage area survives SW suspension → stale-prone, needs freshness scoping; the marker is observability not a fix; risks complicating the test for no behavioral gain over the simpler hash-redirect signal.

**B. Wallet sets a `window.__nulo_popupReady` flag.**
- Rejected: same observability-not-a-fix issue, plus introduces a test-only code path in production source.

**C. Just delete the about:blank bounce entirely.**
- Rejected: would re-introduce the handshake-drop failure mode in any environment where it does fire (slower CI runners, cold SW after long idle, etc.). The fallback is cheap insurance.

**D. Stay with the triple-nav.**
- Rejected: spike shows ~60s/smoke run on the table for a low-risk change.

## Implementation plan

Single PR onto `dev`. ~40 LOC.

### Scope

1. **`tests/e2e/fixtures/extension.ts:openPopup`** — replace the triple-nav block with fast-path-then-fallback. Update the comment to describe the new semantics.
2. **Logging gate** — wrap the `console.log` behind `process.env.NULO_E2E_OPENPOPUP_LOG`. Off by default; on for the measurement re-run after merge.
3. **Commit message + PR description** — include the smoke + network measurement tables so reviewers can verify the claim.

### Validation

- `bun run --cwd packages/extension test:e2e` — 67/67 green, wall time down ~60s.
- `bun run e2e:agent` (full network) — confirms fast-path holds under cumulative load. Target: zero fallbacks, or a small known-flakey set.
- The 8 dapp tests that flaked yesterday: re-run with the spike. Expectation: they no longer flake at the `LifecycleWatcher disposed` site, because they no longer hit the second `goto`.

### Rollback

Single-revert. The fallback is the old behavior.

## Risks

| Risk | Mitigation |
|---|---|
| Fast-path succeeds, handshake later drops mid-test | Pre-existing failure mode, not introduced here. |
| 2s budget too tight for slow CI | P99 in smoke is 811ms. Tighten only if network data agrees. |
| Fallback path itself is flake-prone (the 8 failures yesterday) | Out of scope for this PR. If fast-path lands ~100% of calls, fallback is rare → flake exposure shrinks proportionally. |
| Logging spam in default test output | Env-gated. |

## Open questions for codex audit

1. Is the hash-leaves-`#/` check **sufficient** as a post-handshake signal? Are there code paths where Vue redirects away from `#/` without the wallet-bridge being fully connected (and so we'd resolve the fast-path but a subsequent client RPC would still hit "Client disconnected")?
2. Is the 2s fast-path budget the right size given that P99 is 811ms? Should we factor in cold-start (first openPopup of the suite vs subsequent)?
3. The 8 dapp tests yesterday failed at the second `goto` of the triple-nav. If we hit the fallback path with this design, do we still face the same `LifecycleWatcher disposed` risk? (Yes — but only on the rare fallback. The blast radius shrinks.)
4. Anything else this design misses?

## Audit lineage

- `019e2c76` (codex) — rejected the wallet-side marker approach, recommended hash-based signal with fallback. This plan adopts that recommendation.
- Spike measurement run — captured in this doc.
- **Post-spike codex audit (this round)** — `change-and-ship` verdict. Key findings: hash-alone is too weak (use hash + global-loader), narrow `catch` to `TimeoutError` only, document the prewarm-SW measurement limitation. All applied.
