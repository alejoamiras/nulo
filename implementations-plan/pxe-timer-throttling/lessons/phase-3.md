# Phase 3 — Docs, index, follow-ups

## What shipped

- `ARCHITECTURE.md`: the §1 diagram names the host per browser; §6 describes the frame, the per-frame
  generation on READY and PONG, why a frame (the throttling numbers) and the lifetime contract; the builds
  paragraph no longer speaks of a hidden-window strategy.
- `apps/extension/tests/e2e/FIREFOX.md`: the timer-throttling row (three prefs) is gone; a new row states
  the host, what a hidden host would cost, and the three guards (`pxeHostState`, the two specs, the pref
  test); the tab-placement row says what it now guards against; the debugging checklist's "background
  window" became "hidden document" and records the masked-prefs wrong turn.
- `.claude/skills/chrome-extension-debug/SKILL.md`: the two Firefox lines that named the minimized window;
  `.claude/skills/e2e-testing/SKILL.md`: the one clause that did. The remaining mentions in the tree are
  historical (`audit/**`, `wallets-architecture-research/**`) and stay as records.
- `implementations-plan/index.md` row; this file.

## Follow-ups (recorded, not done)

1. **The restart spec's mechanism.** It ends the background with `runtime.reload()`; the plan named
   Firefox's privileged `terminateBackground()` (Ask A3, the spike's mechanism in `spike/spike.patch`).
   Swapping it is two lines in `tests/e2e/network/firefox-background-restart.test.ts` behind a driver
   method; the assertions stay. Owner's call — see `lessons/phase-2.md` § Deviation.
2. **Port the background-kill specs to Firefox** (plan § Follow-ups 1). Needs the privileged termination
   above: those files kill the background under a live popup, which a reload would close.
3. **An interrupted dApp call never settles** (plan § Follow-ups 2) — 120–180 s unsettled on both Firefox
   hosts, not run on Chrome; an observation for the port.
4. **The upstream batch timer** (plan § Follow-ups 3) — informational only.
5. **The e2e tree is not typechecked** by any repo script (`tsconfig.json` includes `src/**` only; a one-off
   `vue-tsc` over `tests/e2e/**` shows 341 pre-existing errors). Not this plan's scope; noted because a
   fixture change gets only lint and the run as gates.

## Gate

| Command | Result |
|---|---|
| `bun run test:ci-gating` | exit 0 |
| `bun run lint:actions` | exit 0 (`actionlint`) |
| `bun run audit:vue` | exit 0 — typecheck:all, extension tests 542 files / 3 skipped, lint, then the build |
