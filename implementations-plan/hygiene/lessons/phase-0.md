# Phase 0 · Home the plan

- Worktree: `.claude/worktrees/agent-a73dfc179a31a2fe5`, a harness-created agent worktree.
- Branch `chore/hygiene`, cut from `origin/dev` at `85c4d20f` (#719), the commit the plan's Facts
  were verified at. No merge has landed on `dev` since, so no cited line can have moved.
- `bun install --frozen-lockfile` at the root: 993 packages, exit 0.
- `agent-worktree register` refused the worktree twice: under the slug `hygiene` (the directory
  does not match it), then under the directory's own name (the branch is not the harness's
  `worktree-<dir>` branch). Not forced; the manifest carries no row for this build.
- The plan lands from its package with `recon.md`, whose one link (`recon.md`) is committed with
  it; neither file carries an absolute path. The index line sits after `e2e-reliability-fixes`',
  where the recent active plans are listed.

## The driver's F-5 decision, applied

The driver moved F-5 into C2's scope on 2026-09-29: #719's squash message says it raised no
timeout, yet it passed `30_000` to `content-message-relay.test.ts`'s `beforeEach`. Applied in
`plan.md`: the summary's C2 line, the constraints line, § C2 (a paragraph on the relay), Fact 23,
the change map, P1 (steps 2 and 3, the gate and its pass criteria), audit-ledger row 11, D9 and
Delivery (F-1 to F-4), P7 step 3, the tier table's blast radius and the `/goal` seed. The F-5
bullet leaves Follow-ups with a one-line pointer to row 11; `recon.md`'s reuse row says C2 removes
the raise.

## Re-grep at the base (`85c4d20f`)

- The two tags C5 sweeps:
  `git grep -n -i -e "post-impl" -e "phase 2 follow-up" -- . ':!implementations-plan' ':!audit' ':!architecture' ':!wallets-architecture-research'`
  returns 70 lines in 41 files, the plan's count (10 + 51 + 9). Each line falls inside its C5
  row's range; none moved.
- Read at their cited lines, all matching: C1's setups and assertions (`holdings.test.ts:30-37`,
  `:44-51`; `home-cap.test.ts:32-39`, `:43-51`; `pin-to-home.test.ts:42-49`, `:52`, `:57`, `:72`),
  `tokenReadyExtension` (`fixtures/extension.ts:731`, `:792`), `send-picker.test.ts:18-35`,
  `waitForHomeTotal` (`fixtures/helpers.ts:999-1002`), `seedUsdQuoteAndReload` (`:1026-1034`),
  `pinFromTokenPage` and `readPinState` (`:1057-1074`); `presto/client.test.ts:6-7`, `:14-17`;
  `content-message-relay.test.ts:15-27`; `check-derivation-parity.ts:117-118` (214 lines);
  `browser-seam.test.ts:10-15`; `legal-acceptance.test.ts:213-216`;
  `incoming-arrival.test.ts:280-294`, `:312-337`; `CLAUDE.md:291`, `:501`; `README.md:74`;
  `package.json:20`, `:27-28`; the e2e-testing skill's `:532-537` and ledger row 43 (`:652`); the
  chrome-extension-debug skill's `:17-22`; `lessons.md`'s timing-budget line (`:9`).
- Re-located lines: none.
