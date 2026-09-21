# Phase 3 — Docs, index, lessons

## What shipped

- `apps/extension/tests/e2e/FIREFOX.md`: the background row now states the three facts that shape a kill spec
  on Firefox — no successor until the add-on's next event, the termination is polite and is declined
  silently under an open extension page, `storage.session` survives — and names the four files that remain
  Chrome-only with their reasons. The PXE-host row no longer calls background-only termination a follow-up.
- `.claude/skills/e2e-testing/SKILL.md`: § 3 is "Kill or restart the background", with the Firefox paragraph
  ahead of Chrome's six lines; the trigger words, the Chrome-only count, the liveness rule, the open-popup
  pin and ledger row 1 carry the new helper names and the helper's new home.
- `ARCHITECTURE.md` § 6, `CLAUDE.md` (the Firefox-lanes bullet) and `CI.md` (the Firefox callers) say four
  files, not ten, and why.
- `implementations-plan/index.md`; the previous plan's follow-ups 1–3 point here.

## Follow-ups (recorded, not done)

1. **A dApp call in flight when the background died remained unanswered for 210 seconds**, in one run per
   browser (phase 2's table). A product decision — reject pending calls when the new background boots, or leave it to the dApp's
   own timeout — for its own plan.
2. **The canaries on Firefox** (Ask A1): the seam makes it mechanical, the cost is a second real-proving
   canary per PR, and `behavior-gating.test.ts`'s `CHROME_ONLY_CANARY` plus the Firefox canary job's file list
   are workflow-side pins that would move with it.
3. **A crash, as opposed to a polite termination**, is still not reproducible on Firefox: the two Chrome-only
   "kill under an open page" pins (`sw-resilience` case 2, `backup-restore-sw-restart`) would need a way to end
   the extension process itself. Not needed by anything today.

## Codex fix loop

Foreign reviewer: codex (GPT-6 Astra, `high`, read-only), one session resumed across rounds. Told not to run
the vitest e2e configs, builds or workflows. `/code-review` not run (owner directive).

### Round 1 — conditional approve

No Chrome drift (stop body and worker probe match the base but for the error prefix), no production change,
the un-skips are honest, the debt maps only shrink. Findings, all on Firefox's `stopBackground`:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| M1 | Medium | Firefox's termination returns early — reporting success — while a listener promise is pending, and the helper only observed for 15 s; a brief refusal became a permanent failure | Fixed: the termination is asked again every 2 s while the same identity is observed |
| M2 | Medium | The page unloads asynchronously, so the first identity probe after the call can fail during teardown and rejected a kill that worked | Fixed: a probe error during confirmation is noted and the probe repeated; only an *observation* (absent, or a newer `timeOrigin`) ends the wait, and a persistent error is carried in the rejection |
| M3 | Medium | The 15 s budget was a loop condition, not a deadline — a probe started just before expiry could add its own 10 s | Fixed: one outer deadline races the attempts; nothing starts after it expires |
| L1 | Low | plan.md still said an open popup outlives the kill on Firefox; its Security section misstated `backgroundAlive`; the restart spec's comment implied crash equivalence (Firefox runs `runtime.onSuspend`) | Fixed in all three |
| L2 | Low | "never answered" claimed more than one 210 s run per browser measured | Reworded here, in phase 2 and in the index |

M1–M3 became `stopBackgroundWith(stopper)` — the loop with its identity probe, termination call and clocks
injected — so `scripts/e2e/firefox-driver.test.ts` pins each behaviour without a browser: a declined
termination asked again, a successor counted as gone, a teardown probe failure never read as gone, a
persistent failure rejected with its error, a never-settling probe bounded by the budget, the two by-name
rejections. Codex's own unit run executed nothing (its sandbox's workers timed out); the local run is the
authority.

Round-1 gate — every Firefox caller of the rewritten loop, proverless, `--retry=0`, alone on the host
(Chrome's driver is untouched by the fix and was not re-run):

| Command | Result |
|---|---|
| unit: `firefox-driver`, `browser-seam`, `unresolved-names` | 3 files, 62 passed |
| `bun run lint` | exit 0 |
| Firefox network: restart spec + the three ports | 4 files, 4 passed (28.6 s, 22.4 s, 21.8 s, 8.3 s) |
| Firefox smoke: the three ports | 3 files, 5 passed, 2 skipped (`sw-resilience` case 2, and its strict-mode-off case, a plain `test.skip` on both browsers) |

### Round 2 — conditional, one new finding

| # | Severity | Finding | Disposition |
|---|---|---|---|
| M4 | Medium | A re-ask could land on a **successor**: round 1's wait could see the old page, sleep across the retry time and ask again without looking, and a window of nothing but probe errors licensed a re-ask too. If the old page died and an add-on event woke a new one in between, the spec would exercise two background deaths while asserting one | Fixed: one loop in which every ask directly follows a sighting of the *same* page; a failed probe (`unknown`) never licenses one. Two unit cases pin it — a successor appearing between two sightings is never asked to end, and a run of failed probes longer than the retry interval produces no further ask |

Residual, stated rather than hidden: between the sighting and the privileged call there is still one
classic-channel round trip. Closing it entirely means making the termination itself conditional on the
page's identity inside the privileged script — codex's preferred fix. That script is the one piece of this
change the owner placed in the tree by hand and this session does not author or edit its body, so the
window is narrowed to that round trip and recorded here. For it to matter, the old page must die *and* an
add-on event must wake a successor inside those few milliseconds, with every extension page already closed.

Round-2 gate (same shape as round 1's): unit 3 files / 64 passed, the driver file 5× with no flake;
`bun run lint` exit 0; Firefox network 4 files / 4 passed (29.2 s, 22.6 s, 21.4 s, 8.5 s); Firefox smoke
3 files / 5 passed, 2 skipped.

### Round 3 — conditional, two new findings; the plan's three-round stop

Codex accepted the round-2 residual as documented ("acceptable for this harness") and raised:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| M5 | Medium | A probe could still *start* after the budget expired, when expiry landed during the ask or the pause — the caller already had its rejection and the abandoned loop would begin one more privileged call against its teardown | Fixed: `expired` is checked immediately before the probe. Pinned with fake timers — the budget runs out while the ask is in flight, the ask is then released, and the identity probe count must stay at one. Mutation-checked: with the guard removed that case fails (`called 2 times`) |
| M6 | Medium | The successor unit case rode real timers: a first poll delayed past 40 ms would legitimately re-ask on the old page and fail a correct implementation | Fixed: the case now runs on fake timers and steps through 30, 50 and 60 ms, so the interleaving is exact |

Round-3 gate: unit 3 files / 65 passed (the driver file 3× with no flake); `bun run lint` exit 0; Firefox
network 4 files / 4 passed (29.3 s, 22.3 s, 22.1 s, 8.5 s); Firefox smoke 3 files / 5 passed, 2 skipped.

**Not converged at the limit.** The plan's hard stop is three rounds, and the third still had findings, so the
session did not run a fourth pass on its own: it put the call to the owner — one more confirmation pass on
these two small fixes, or the PR as it stood.
The shape of the loop, for that call: 5 findings → 1 → 2. All six Mediums sit inside the one Firefox
`stopBackground` loop and its unit file; round 1's two Lows were wording. Nothing was ever raised on Chrome,
the seam, the ported specs or the debt maps. All eight adopted, none refuted.

### Round 4 — approve (converged)

The owner, asked at the three-round stop, chose one more pass scoped to round 3's two fixes ("4th codex pass").
Codex's whole reply, same session:

> Approve.
>
> no new material findings

## Gate

| Command | Result |
|---|---|
| `bun run test:ci-gating` | exit 0 |
| `bun run lint:actions` | exit 0 |
| `bun run audit:vue` | exit 0 — typecheck:all, extension tests 542 files passed / 3 skipped (6845 tests), lint, then the build |

Re-run after the three codex fix commits, all exit 0: `test:ci-gating`, `lint:actions`, `audit:vue` (542 files
passed / 3 skipped, 6854 tests — the nine new driver cases — then the build).
