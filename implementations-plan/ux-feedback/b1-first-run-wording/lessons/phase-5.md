# Phase 5 · Arc gate and review loop

Picks re-read before P5 (the proposal artifact's `picks` collection, 22 rows): unchanged since
P3's read. i1 A, i3 V4, i5 A, i7 A1, i8 B; no U11–U16 row, so those stay built as recommended and
**sign-off pending**.

## Review loop (codex high, GPT-6 Astra, one resumed session)

| Round | Verdict | Material findings | Fix |
|---|---|---|---|
| 1 | changes-requested | `createAndActivateProfile` counted the picker's rows, which arrive after its button, so a slow read expected "Profile 1"; `importSeed` accepted whichever name-field state the page settled on and any "Profile N"; the fee menu's disabled row was dimmed twice (tertiary ink plus `DropdownItem`'s 0.5 fade) against U14A's drawing | `56ded6f9` (both helpers read the stored names and expect `defaultProfileName(before)` exactly, then check the saved name), `acd72861` (the menu cancels the fade on its disabled rows) |
| 2 | changes-requested | the new postcondition passed when a profile vanished; the case and NFKC collision tests never collided; the readout's and menu's headers narrated their templates and named their parent | `cb4faa65` (sorted exact equality; collisions that land on a taken variant, one bumping twice), `95ce251f` (headers cut to the parent-decides constraint) |
| 3 | changes-requested | five comments restating one-line helpers (`textOf`, `spoken`, `drawn`, `glyphOf`, `FIRST_PROFILE_NAME`) | `46a0ed32` (those five, plus three of the same kind codex had not listed) |
| 4 (confirmation) | **approve**, high | none | — |
| 5 (after `f0edddcf`) | **approve**, high | none; one nit on the gate wording | `803da36d` |

Round 4's verdict, verbatim: *"VERDICT: approve — confidence: high. no new material findings.
Commit `46a0ed32` closes the remaining finding: all five cited comments are deleted, along with the
additional redundant comments. It contains only comment deletions and is the sole change since
round 3."*

Round 5's verdict, verbatim: *"VERDICT: approve — confidence: high. no new material findings"*.
It checked that `protocolTimeout` reaches BiDi's command timer and that Puppeteer starts the wait
deadline before the awaited call, so matching budgets is enough.

Deviation: the plan caps the loop at three rounds. Round 3's only material finding was comment
lines, and the program's goal needs a quoted verdict with no new material findings, so a fourth
pass confirmed the deletion commit alone. Round 1's prompt also left out the plan's two standing
instructions (targeted fixes only; the comment audit) and the arc map; round 2 carried them and
asked for the comment audit over the whole arc, which is where rounds 2 and 3 found the comments.

## Decisions

1. **The e2e helpers use the product's naming rule.** `defaultProfileName` computes the expected
   prefill from the names read straight from storage; the rule itself is pinned by
   `profile-name.test.ts`, whose collision cases now actually collide.
2. **The disabled fee row loses `DropdownItem`'s fade only in the fee menu.** Every disabled fee
   row ("couldn't check balance", "no balance", "not available") matches `r5/i3.html`, which draws
   all three at full tertiary ink. `DropdownItem`'s other disabled users keep the fade.

## Firefox network run and the gate modes

- **The failure.** The first Firefox network flake run was prover on (WASM, no Presto). It failed
  both execution tests of `imported-account-execution` (7 of 9 passed). Each failed in
  `waitForToast` inside `sendTransfer`: "Waiting failed", caused by "ProtocolError:
  script.callFunction timed out". Test 1 failed on its first self-transfer, test 2 on its transfer
  after the passkey re-unlock. Chrome had passed the same four specs 3 of 3, 9 of 9 each. Runs 2
  and 3 were stopped.
- **The proven cause.** Firefox's BiDi session ran with Puppeteer's default 180 s protocol
  timeout, while `sendTransfer` waits 300 s for the toast. Chrome's launch already allowed 300 s.
  Fixed in `f0edddcf`.
- **The second cause, measured.** After the fix, a prover-on diagnostic run (not a gate) failed
  the same two tests on `sendTransfer`'s own 300 s toast wait: "Waiting failed: 300000ms
  exceeded", with no protocol error. So a WASM-proved transfer took more than 300 s on Firefox on
  this host (load average 55–93). Whether the shared extension process or the load makes it slow
  is not established; Chrome proves the same spec prover-on inside the budget (3 of 3).
- **The decision** (`/codex high`, session `01a0d4da-73b1-7d11-829f-440c0c958eab`, "DECISION: C —
  confidence: moderate"):
  - Firefox's network gate and flake bar run proverless with retry 0, as CI's Firefox shards do,
    over all thirteen P5 specs.
  - Chrome keeps prover on.
  - Firefox's protocol budget matches Chrome's.
  - Batch 5's Firefox canaries take their evidence from CI's Presto canary job.

  The program plan's Local gates table records the modes (`8524b16a`).
- **Rejected from the consult, out of this arc's diff:** the comment rewrite it proposed for
  `vitest.e2e.network.config.ts`, which this arc does not touch.

## Traps

- `resume-codex.sh`'s third argument is the codex dir (where responses go), not the review's
  working directory; passing the worktree wrote `response-1.md`, `log.jsonl` and friends into it.
  They were moved out before anything was staged.
- The extension's `typecheck` does not cover `tests/e2e/**`. The changed helpers were checked with
  a scratch tsconfig; the only errors are pre-existing (chrome-types' `storage.local.get(null)`
  overloads, `runtime.connect({ name })`, a `Logger`/`ILogger` mismatch).
- An `Edit` whose replacement ends in a space loses the space; the formatter put it back.
- `agent.sh` refuses a prover-on run that includes a file marked `@requires-proverless`
  (`backup-restore-sw-restart`, `profile-switch-sweeps-transfer`) and exits 2 before building.
  The first attempt at the thirteen-spec gate did exactly that on both browsers; those two now run
  separately on Chrome with `NULO_E2E_PROVERLESS=1`.
- The first network parity capture failed on the temporary parity spec's own 5 s wait, not on
  the extension; the spec was fixed and the captures retaken on the final source.

## Parity

<https://claude.ai/artifact/3bsU92KDV4gfrqFGPBoy1m>: fourteen rows, each drawing beside the
built extension (smoke captures for rows 1–4, 7 and 12, sandbox captures for the fee and mark
rows), on the final source (`46a0ed32`; later commits touch only e2e and docs). Every visible
difference is listed on its row. Nothing needed a fix. Three are today's words or lines that no
drawing covers, left for the owner:

- Row 5: the dApp window's app-set fee row keeps its label "Pay fee with".
- Row 9: the review sheet's fee line shows FJ only, with no dollar value.
- Row 10: for a hand-added fee contract, the sheet still reads "paid by the sponsor" next to a
  card that says "—".

## Gate

On `feat/ux-1-first-run-wording`, extension source at `46a0ed32`:

- Local gates (`46a0ed32`): `bun run lint` exit 0 (30 warnings, 5 infos, none in changed files);
  `typecheck:all` exit 0; `test:all` exit 0 (extension 7,123 passed, 4 skipped, 7 todo; tools
  1,461; bridge-core 437; aztec-runtime 246); `test:ci-gating` exit 0 (150 tests); `build` exit 0.
- Smoke, full: Chrome exit 0 (139 passed, 8 skipped); Firefox exit 0 (135 passed, 12 skipped).
- Smoke flake bar (`fee6b4a2`), retry 0, three runs each: Chrome 46/46 ×3, Firefox 46/46 ×3.
- Smoke, full, Firefox again after the BiDi budget change (`803da36d`): exit 0 (135 passed, 12
  skipped).
- Network, Chrome, prover on (`8524b16a`): 11 files, 25 tests passed; the two proverless-marked
  files with `NULO_E2E_PROVERLESS=1`: 2 files, 4 tests passed.
- Network flake bar, Chrome, prover on (`fee6b4a2`), the four changed specs: 9/9 ×3.
- Network flake bar, Firefox, proverless (`803da36d`), the four changed specs: 9/9 ×3.
- Network, Firefox, proverless (`803da36d`), all thirteen specs: 12 files and 26 tests passed;
  `backup-restore-sw-restart` skipped whole-file on Firefox (`CHROME_ONLY`, as in CI).
- Diagnostic, Firefox prover on (not a gate): `imported-account-execution` 1 passed, 2 failed on
  the 300 s wait (above).
- `bun run e2e:reap` after every chain.
