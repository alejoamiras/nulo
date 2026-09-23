# Arc 1 — quality loop

## `/code-review low --fix`

The repo's `/code-review` skill is an interactive human walkthrough (one stop per message), which an autonomous `/goal` session cannot drive, so the `low` pass ran as ONE fresh Sonnet reviewer agent over `git diff origin/dev...HEAD -M` (saved copy, read in chunks) with the arc map and the keep list, asked for concrete defects only. It grepped the tree for every old identifier, traced the storage migration end to end and ran the affected suites (session ×62, smoke ×8, scripts ×43, lib ×47, biome, vue-tsc, actionlint).

Verdict: **2 findings, both prose** — `network.ts:55` (the sweep had turned the drip-feature phrase "the faucet tab, the faucet-token registration" into "the tools app tab …"; reverted, arc 2 makes it drip) and `testids.ts:48` (comment still citing `fa-` ids). One sibling it missed was fixed alongside (`AccountSwitcher.vue:27`, same `fa-` comment class). Commit `e80975b0` (`chore(tools): apply code-review fixes (arc 1)`), separate from the implementation commits.

## Codex round 1 (fresh session `01a05f30-ab1b-79e1-826e-e6fa42fe8982`, xhigh)

Opening line: "No active old/new producer-consumer split or security regression found. The structural lockfile/manifest comparisons hold, hostname pins use real targets, and legacy storage cannot select outside the live wallet grant or promote a wallet before setup succeeds." Critical/High: none. Six material findings (1 Medium, 5 Low), every one verified against the tree and adopted:

| # | finding | fix (commit `245c41f0`) |
|---|---|---|
| 1 | M — the CI wiring pin checked key presence and substrings only | exact output expressions, exact `if`, `status.needs`, AND `needs.build-tools.result` in the aggregation script |
| 2 | L — `resolve-ports.test.ts` counted six values (a `faucet` key would pass); `capabilities.test.ts` pinned `nulo-tools` only on the unused `buildFaucetManifest` | exact key-set assertion; a name pin on `buildCombinedManifest` (the shipped path) |
| 3 | L — release/refresh/CLAUDE.md prose said the tools app fails early / redeploys on dispatch; a "(codex post-impl finding)" parenthetical | prose matched to the code: skip + notice without the hook, redeploy only via CF Git-integration on `push:main`; parenthetical removed |
| 4 | L — touched comments still called the app testnet-only / the mainnet manifest a Phase-8 placeholder; a "(codex round-1 Critical)" reference | live invariant stated (build-time-pinned targets, no runtime override); archaeology removed |
| 5 | L — e2e comments described a `tools-add-token` spec that does not exist and a conditional allocation `agent.sh` always performs | comments describe only the `TOOLS_DEV_PORT` gate |
| 6 | L — `CI.md:170` said `packages/<target>/**` | `apps/<target>/**` |

Rejected: nothing.

Operational note: the first codex run was started as a background Bash call and died with the tool shell at its 10-minute cap (no response written). Reran under `tmux` with a completion monitor — the machine profile's rule for anything longer than a few minutes.

## Codex round 2 (resumed, fix diff `245c41f0`)

Verbatim: **"no new material findings"**. Arc 1 converged after one fix round.
