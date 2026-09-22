# Phase 7 — the rule, the bump gate, the closeout

## The rule, everywhere recon found it

| Place | Before | After |
|---|---|---|
| `apps/extension/tests/e2e/FIREFOX.md` row 1 | "Four files stay Chrome-only … the two execution canaries are pinned to Chrome (`canary`)" | two files; the canaries run on both browsers in every canary lane; the passkey one closes its anchor popup where `credentialOutlivesPage` |
| `CLAUDE.md` § Account-address freeze | "runs the frozen-account execution canary prover-ON" | both canaries, Chrome and Firefox (`NULO_E2E_BROWSER=firefox`); a red canary on either browser blocks the bump — the Firefox lane is advisory as a check, the rule is not |
| `CLAUDE.md` Firefox-lanes bullet | "Four files are Chrome-only … the two execution canaries are pinned to Chrome" | two files; every canary lane runs the same four prover-ON files on both browsers; `Assert canary results` |
| `CI.md` § Presto Layer 3 | "fails the `canary` lane" | "fails a `canary*` lane" |
| `CI.md` § real BB proving | two send specs | + the two execution canaries, both browsers, the results step |
| `CI.md` § Firefox lanes | "the canary omits `frozen-account-canary` — one of the four files that skip whole-file" | two files skip; the canary job runs the same four files; the pins |
| `.github/README.md` Firefox network row | "minus the Chrome-only `frozen-account-canary`" | "the same four files as on Chrome" |
| `UPDATE.md` § frozen account surface | the frozen canary alone | both canaries, both browsers; a red one on either blocks |
| `UPDATE.md` § validation | "includes the frozen-account canary"; the `canary` shard | both canaries; the `canary` job of both browser lanes, the json report read back |
| `e2e-testing` skill §3 | "The set is four files … the two execution canaries are pinned to Chrome" | two files; the canaries on both browsers; the fresh-popup ceremony |
| `e2e-testing` skill, the open-popup lock paragraph | "the passkey canary's stage 4 … Chrome's alone" | stage 4 on Chrome is the pin; on Firefox the popup closes first, the fresh popup boots into the lock screen |
| `e2e-testing` skill, the idle-reaper paragraph | "Chrome's idle reaper … `restartServiceWorker`" | the browser's; `restartBackground` |
| `e2e-testing` skill ledger | — | row 33: the green canary job that proved nothing, the pins and the results step |
| `aztec-update` skill | the frozen canary, Chrome, the required check | both canaries, both browsers, both lanes, the results step, the passkey arc; "advisory means it cannot block a merge, not that it may be ignored" |
| `nightly.yml` Firefox-lanes comment; the Chrome PR canary job's comment; the Firefox PR canary job's false comment | "minus the Chrome-only frozen-account-canary"; three bullets; "Firefox has no service worker, so it runs on Chrome alone" | mirrored exactly; a fourth bullet + the both-browsers line; deleted (Phase 6 commit) |
| `implementations-plan/firefox-background-kill/plan.md` rows 56–57 | "Ask A1 (default: not ported)" | superseded — ported here (Phases 4, 5) |
| `implementations-plan/index.md` | `firefox-background-kill` in review; this plan implementing | completed (#661, `60da5d66`), Ask A1 superseded; this plan → in review with the PR numbers (below) |

**Final sweep.** `git grep -iE "chrome-only|four files|pinned to chrome|CHROME_ONLY\.canary|canaries stay|canary omits|minus the chrome"` outside `implementations-plan/`, `audit/` and the fixtures: every hit is either one of the rewritten sentences above, a `sidePanel` / manifest "Chrome-only API" remark, the seam test's own header, or `FIREFOX.md` row 3's "a dApp's web page, and Chrome-only files" (still true: the reload-debt list). No stale sentence remains.

`closing-ledger.md` written: done / consciously accepted / noted for a later look / only time-gated.

## Gate

- `cd ROOT && bun run audit:vue` → exit 0 (typecheck:all 0 ∥ `Test Files 544 passed | 3 skipped (547)`, `Tests 6885
  passed | 4 skipped | 7 todo (6896)` ∥ lint 0, then the Chrome build green, 1 min 28 s wall).
- `cd ROOT && bun run test:ci-gating` → exit 0 (146 pass, 0 fail); `bun run lint:actions` → exit 0.

## Arc 2 codex loop (GPT-6 Astra at `high`, read-only, under tmux, `CODEX_ACCOUNT=best`)

### Round 1 — session `01a0c68d-fd2d-7211-9eb1-767763340f75`, verdict **changes required**

| # | Finding (codex) | Verified | Disposition |
|---|---|---|---|
| M1 | `_extension-network-e2e.yml` — `read -ra` consumes one line: a `test_files` written as a YAML block scalar keeps the whitespace-splitting pins green while both the run step and the results step see only its first line (codex reproduced four files becoming `transfers` alone, the reduced report accepted) | True (pre-existing in the run step; `read` proof: folded 4 files, unfolded 2) | **Adopted.** Both steps fold newlines to spaces before `read -ra` (`${TEST_FILES//$'\n'/ }`, the exclude list too); a new pin refuses a multi-line `test_files` / `exclude_files` in any of the four lanes |
| M2 | `behavior-gating.test.ts` pin (e) accepted a disarmed step: `&& inputs.browser == 'chrome'` on the condition, `continue-on-error: true`, or the call commented out all kept the fragments it looked for | True | **Adopted.** The condition and the env value are pinned whole (`toBe`), `continue-on-error` must be absent on the job, the run step, the results step and the presto step, and the script call and the zero-proofs `if` must be command lines (comments stripped) |
| M3 | pin (d) proved textual presence, not loop membership: a comment or an echo could carry `needs.x.result` while the loop tested another job; `publish-nightly`'s `if` accepted `!= 'failure'` | True | **Adopted.** `resultsTested()` parses the operands of every `for r in …; do` list and every direct `[ "${{ needs.x.result }}" …` check from the command lines, and the set must equal `needs` exactly; `publish-nightly` must carry `needs.<need>.result == 'success'` for each need |
| L1 | `closing-ledger.md` — "the seam scan bans the fact outside the driver files" is false: specs read it by design | True | **Adopted**: "in shared fixtures and helpers outside the driver files (a spec may read it)" |

Codex ran 36 focused CI tests (green); its read-only sandbox could not start vitest workers for the seam tests; no builds, e2e or workflows.

**Round-1 mutations** (each applied to a backed-up copy, the pins run, restored — `27 pass` after every restore): M6 `continue-on-error: true` on the results step → red ("a red assertion is a red job"); M7 the condition narrowed with `&& inputs.browser == 'chrome'` → red; M8 the script call commented out → red; M9 the canary's result moved into an `echo` and replaced in the loop by a duplicate → red ("tests exactly its needs"); M10 `publish-nightly` on `!= 'failure'` for the canary → red; M11 the Chrome PR canary list as a block scalar → red ("every file list is one line").

**Round-1 gate.** `bun run lint` 0; `bun run test:ci-gating` 147 pass, 0 fail; `bun run lint:actions` 0. Committed as
`ci(e2e): fold newlines before reading the file lists; pin the canary steps whole`.

### Round 2 — the same session resumed on the fix diff (`d6d45b06`), verdict **approve** — converged

Codex's whole reply: *"approve"* — no findings. Two rounds; the hard stop at three was not reached.

## Cross-arc pass (fresh session `01a0c695-ac1e-77e2-be81-c4eec23c90dc`, GPT-6 Astra at `high`, read-only, `CODEX_ACCOUNT=best`)

Scope: `git diff 60da5d66..HEAD` — 53 files, +3424/−281 — briefed with what each per-arc loop had settled (the tab-bound reply and the untouched relay; the driver fact; the results step and pins (a)–(e)) and asked only for what neither loop could see: a seam between the arcs, a fact one arc states that the other contradicts, a gate one arc weakened and the other assumed.

Verdict **approve**, no findings. Codex's closing sentence: *"The two arcs are consistent with each other and the changed docs, including the heartbeat-dependent cold-start limit and Firefox's advisory check versus mandatory bump rule; confidence: moderate, with runtime verification limited by the read-only environment."* One round; nothing to adopt, nothing to re-gate.

All three loops converged: arc 1 in two rounds (`lessons/phase-3.md`), arc 2 in two rounds (above), the cross-arc pass in one. The hard stop at three rounds was never reached; the three pre-declared owner stops were never reached.

## Delivery

`gh stack view` before submit: `dev ← worktree-firefox-arc-closeout @ f34ed0da ← firefox-arc-closeout-canaries @ d6d45b06` (+ this docs commit). Submitted with `gh stack submit --auto --open` only after the three loops converged; titles arc 1 `fix(wallet-sdk): reject a dApp's in-flight call in seconds when the background dies`, arc 2 `test(e2e): run both execution canaries on firefox and assert every canary lane ran them`; each body quotes the owner's calls and states `UI impact: none`. The PR numbers are in the index row. Merging is the owner's; the session never merges.
