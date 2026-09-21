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

## Post-implementation — codex fix loop (Astra, `high`, read-only, under tmux)

**Round 1 — conditional approve.** Three Medium, two Low; all adopted, one as wording.

| Finding | What changed |
|---|---|
| M — the manifest guard compares slashless `src/offscreen/index.html`, and Firefox reports `web_accessible_resources` patterns with a leading `/` | the matcher strips leading slashes; positive and negative controls in the spec |
| M — `runtime.reload()` ends every context, so "zero hosts" cannot show the old host died *with the background*; `backgroundIdentity` counts only the new background's frames | wording: the spec header, `ARCHITECTURE.md` §6 and `FIREFOX.md` say it pins the locked state and the recovery after a reload; the mechanism stays the owner's ask (§ Deviation, phase 2) |
| M — "comes back locked" was never asserted: `ensureUnlocked` succeeds on an already-unlocked wallet | `waitForLockScreen` (record gone, popup on `/popup/auth`) before the unlock |
| L — the debug skill turned a 20 s send into a diagnosis | "check the host's `visible` state before the node or the prover" |
| L — `isLiveOffscreenSender`'s doc claimed document identity a same-extension page copying the URL also has; `isOffscreenHealthy`'s doc narrated; the host-state header repeated itself | the doc states "rejects previous generations; does not authenticate a document against same-extension code"; one-line health doc; header halved |

Codex's own unit run executed zero tests (its worker start-up timed out in the read-only sandbox); the
gates here are the authority. Not adopted: nothing.

**Round 2 (resume, on the fix diff `bff2a617`) — conditional approve, converged.** Quoted: "No new
material findings. The fixes are correct and targeted; the matcher checks and Biome check passed." The
one unresolved condition is the coverage gap the reload mechanism leaves (background-only termination),
with the smallest resolution named as "record the owner's explicit acceptance of deferring that gate, or
add the background-only regression before merge" — which is the owner ask already recorded in phase 2's
§ Deviation and in the PR body. Nothing else to fold in; the loop stops here at two rounds.

**A trap that cost a re-run:** two parallel Bash calls that each `cd` somewhere race on the tool shell's
one working directory — a vitest run meant for `apps/extension` executed from the repo root, picked
the root config (no jsdom), and failed every `document`-using case. Run cwd-sensitive commands one per
call, or chain them in a single call.

## Gate

| Command | Result |
|---|---|
| `bun run test:ci-gating` | exit 0 |
| `bun run lint:actions` | exit 0 (`actionlint`) |
| `bun run audit:vue` | exit 0 — typecheck:all, extension tests 542 files / 3 skipped, lint, then the build |
