# Phase 4 · Browser proof and the arc gate

## Interruption

The build was cut off by an API spend limit at the start of this phase, after P3's commits and
before any P4 edit or run. Nothing was running and nothing was left to reap, so P4 started from
its first step. Not a flake.

## Change (test side)

- `tests/e2e/helpers/rpc-stub.ts`: `startStub`, `planBatchReplies` and `nodeInfoResult(l1ChainId,
  rollupVersion)`, moved out of `import-dead-rpc.test.ts`, which imports them (its no-browser
  `planBatchReplies` cases stay there).
- `tests/e2e/helpers/backup-export.ts`: `exportPlainBackup` (the export drive the integrity,
  round-trip and crash-truth specs each repeated), `accountChainId` (the funded account's chain)
  and `sealPlainBackup` (the re-checksum). Integrity and round-trip use all three.
- `tests/e2e/helpers/crash-truth.ts`: `exportFundedBackup(ctx, tokenAddress)` keeps only the funded
  chain's account-state and re-seals; both sw-restart scenarios pass the sandbox token.
- `src/popup/components/popups/DataViewerPopup.vue`: `data-testid="data-viewer"` on its content.
  `Popup` renders two roots, so the id sits on the `Flex` inside `PopupCard`. No visible change.
- `tests/e2e/network/backup-import-stalled-network.test.ts`: the stall spec, Chrome-only
  (`CHROME_ONLY.cdpFetch`). The error rows are read from the text the data viewer renders; the
  balance check runs on a fresh popup page, because the import page's store does not follow a
  network switch made on another page. Its Retry leg is its own commit, so option (A) reverts it
  with P3.
- `tests/e2e/FIREFOX.md`, `CLAUDE.md`, `.claude/skills/e2e-testing/SKILL.md`: the Chrome-only set
  is three files. The skill says adding one is the owner's call: asked on the P5 page.

## Red first (the stall spec on the base)

Branch `capture/backup-import-red-base` (local, never pushed): `85c4d20f` plus the helper and spec
commits cherry-picked, so the product code is dev's, without B1 to B3. Chrome, prover on, retry 0.

- Run 1 (`net.sh` → `e2e:agent tests/e2e/network/backup-import-stalled-network.test.ts`): exit 1,
  2 tests, 1 passed (the arming contract), 1 failed, 327 s. `expected { 'account-state': [ { …(4)
  }, …(1) ] } to deeply equal { 'account-state': [ …(1) ] }`: two rows, both `Skipped — ran out of
  time reaching the network`, Alpha V5's (`d29c7c68`) and the local network's (`7c1b1632`). The
  hard row check stopped the test before the sender check.
- The spec then made the sender check soft and put it first (`a50ddcab`), so one run shows both
  symptoms. Run 2 on the same base: exit 1, 1 passed and 1 failed, 220 s, two assertion errors:
  `the local network's restored sender, before Continue: expected false to be true`, then the same
  two deadline rows (`37488b32`, `07238e25`).

So on the base the stalled Alpha V5, first in the slice, costs the local network its registration
and adds its row, exactly as § Non-obvious mechanics predicts.

## Local gates (step 1)

At `a50ddcab`, each command from the repo root:

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | |
| `bun run typecheck:all` | 0 | |
| `bun run test:all` | 0 | extension 609 files (606 passed, 3 skipped), 8059 tests (8047 passed, 4 skipped, 8 todo); aztec-runtime 35 files (34, 1 skipped), 252 tests (250, 2 skipped); every other workspace all passed |
| `bun run test:ci-gating` | 0 | 246 tests, 244 passed, 2 skipped, 0 failed |
| `bun run build` | 0 | |

## Smoke (step 2)

The migration-fixture build per browser (`VITE_NULO_E2E_MIGRATION_FIXTURE=1
VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1
bun run build:<b>`, all three markers present), then
`NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e --retry=0`. Both ran
unsharded, one shard each: they started before the owner's sharding instruction (2026-09-29, "run
tests e2e sharded so they are faster"), which applies from the next run on.

- Chrome: exit 0, 1250 s. 41 files (38 passed, 3 skipped), 164 tests (157 passed, 7 skipped). The
  skips are the suite's own environment gates (`_probe-console-capture` 3, `action-popup-layout`,
  `appearance`, `store-captures`, `sw-resilience`'s strict-mode-off case). All seven
  `import-dead-rpc` cases passed, on the moved `rpc-stub` helper.
- Firefox: exit 0, 1583 s. 41 files (39 passed, 2 skipped), 164 tests (153 passed, 11 skipped):
  `_probe-console-capture` 3, `appearance` 1, `store-captures` 1, `sw-resilience` 2 (its
  Chrome-only open-page kill and the strict-mode-off gate), and `import-dead-rpc`'s four
  interception cases, which redirect over CDP Fetch (`CHROME_ONLY.cdpFetch`); its three
  `planBatchReplies` cases ran and passed.

## Network (steps 4 and 5)

Each run: `NULO_E2E_BROWSER=<b> NULO_E2E_RETRY=0 NULO_E2E_RESULTS_FILE=<report>
NODE_OPTIONS=--dns-result-order=ipv4first [NULO_E2E_PROVERLESS=1] bun run e2e:agent <files>`, its
report removed first and checked after with
`jq -e '.numTotalTests > 0 and .numPassedTests == .numTotalTests'`. Under the owner's sharding
instruction the files that share a browser and a prover mode ran in one invocation (one sandbox
boot), and two worktrees of the same commit ran one invocation each at a time: this worktree, and
the extra worktree detached at `a50ddcab` (its own `bun install --frozen-lockfile`). Two streams,
so at most two of these runs at once on the loaded host.

| Invocation | Worktree | Browser, prover | e2e:agent, jq | Cases | Time |
|---|---|---|---|---|---|
| integrity + round-trip + the stall spec (its run 02) | extra | Chrome, on | 0, 0 | 6 of 6: integrity 2, round-trip 2, stall 2 | 357 s |
| `backup-restore-sw-restart` | extra | Chrome, proverless | 0, 0 | 3 of 3 | 203 s |
| integrity + round-trip | this | Firefox, proverless | 0, 0 | 4 of 4: integrity 2, round-trip 2 | 268 s |

**Flake bar**: the stall spec, retry 0, eleven runs in a row, all green, 2 of 2 cases (the arming
contract and the stall with its Retry leg) each, none skipped. Run 01 alone before the smoke, run
02 inside the Chrome invocation above, runs 03 to 11 from a shared counter, one at a time per
worktree:

| Run | Worktree | Time | | Run | Worktree | Time |
|---|---|---|---|---|---|---|
| 01 | this | 222 s | | 07 | this | 326 s |
| 02 | extra | (357 s, the invocation) | | 08 | extra | 244 s |
| 03 | this | 250 s | | 09 | this | 233 s |
| 04 | extra | 396 s | | 10 | extra | 260 s |
| 05 | this | 401 s | | 11 | this | 255 s |
| 06 | extra | 357 s | | | | |

## Capture run (step 6)

A probe spec, copied into `tests/e2e/network/` untracked for each run and deleted after it (never
committed), Chrome, prover on, retry 0. It ran in two extra worktrees, each with its own
`bun install --frozen-lockfile`, so it could run beside the main worktree's runs and never beside
another run in its own: one detached at `a50ddcab` (the branch head), one on the local branch
`capture/backup-import-O1-A` (P2's `e6380efc` plus the e2e helpers and the data viewer's
`data-testid`, never pushed).

- Head, pass 1: exit 0, 7 cases, 6 passed, 1 skipped (the P2-only case), 421 s. P2, pass 1: exit
  0, 7 cases, 2 passed, 5 skipped (the head-only cases), 258 s.
- **Classification** (Inferences 0 and 1; kinds and counts only). The funded wallet's export held
  two items. Alpha V5: 7 contracts, 3 protocol (ContractClassRegistry, ContractInstanceRegistry,
  FeeJuice) and 4 preloaded (HandshakeRegistry twice, current and historical, AuthRegistry,
  MultiCallEntrypoint), no sender. Local network: the same 7 plus PrivateFPC, Token and
  SponsoredFPC, no sender. Inference 0 holds. Inference 1 was not observable: Testnet's node did
  not answer at export time, so the export wrote no Testnet item (Fact 10); #719's probe had one.
- **One immediate Retry** (Inference 8): the errors screen came 31.8 s after submit (the probe
  answered, then the 30 s registration cap); a Retry pressed at once took 30.9 s, ran out of time
  again and left the one Alpha V5 row, on the import page. Inference 8 holds. The stalled stub saw
  `aztec_getNodeInfo` then `aztec_getL1ContractAddresses`: the Alpha V5 boot started, then hung.
- **Alpha-only shape** (UI row 3): a Testnet item holding only the 7 rebuilt contracts, Testnet's
  node refused, the local network active: the popup went straight into the wallet, no errors screen.
- **Row 5**: the popup closed at the `chain-sync` stage and reopened on `#/popup/general`, Home on
  Alpha V5 (the backup's active network), with nothing saying a network was not restored.
- **P2 rows** (option A): exactly one account-state row, Alpha V5's, `Skipped — ran out of time
  reaching the network`.
- In the 360x600 popup the errors screen's warning sits under the footer: dev's and (A)'s three
  buttons cover its last line, (B)'s four cover all of it until the page scrolls. A second pass
  pictures the scrolled screen and moves the O2 mocks there, since the unscrolled ones cannot
  show the sentence: head exit 0, 2 cases, 1 passed, 1 skipped (P2's), 199 s; P2 exit 0, 1 passed,
  1 skipped (the head's), 200 s.
- The P2 build regenerated `auto-imports.d.ts` and `.eslintrc-auto-import.json` with the exported
  `ImportChainSyncRecordKind` alias, which P2's commit left out and P3's `4c0b26e1` removed. The
  head's declarations are consistent (P3's build gate); a revert to (A) keeps `4c0b26e1`
  (Decision ledger).

## Reap (step 7)

`bun run e2e:reap` in this worktree and in both extra worktrees: exit 0 each, "nothing to reap".

## Gate

Steps 1 to 7 as written: every command exited 0, every network report passed step 4's check, the
stall spec's red run (two, above) and its green runs recorded, the capture run's results above.
