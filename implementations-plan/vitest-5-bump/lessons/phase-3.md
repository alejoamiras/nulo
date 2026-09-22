# Phase 3 — the matrix commit (2026-09-21 → 2026-09-22)

The matrix commit is `93b95f06` (`test(extension): make two test files resolve on node as they do on bun`),
on top of Phase 2's `ed829637`. Every summary below stamps `gitSha 93b95f06…`, `gitDirty false`,
`lockfileSha256 ab02750185039d7ddb555a20ab1dac871e12a3c54c11c5eef4b36d934969f006`, `vitestVersion 5.0.1`,
`pool forks`, `maxWorkers null`, `timeoutMin 20`. Reference engine: Node **24.21.0** (nvm, first on PATH);
candidate: Bun **1.4.2**. The compacts (`scripts/ci-cd/test-soak/baselines/{node,bun}/<name>.json`, 32 files)
are committed on top of the matrix commit with this file; the full reports stay gitignored.

## Preconditions, as met

- **Frozen install.** `bun install --frozen-lockfile` at `ed829637` (2026-09-21 22:25 UTC):
  `Checked 1026 installs across 1188 packages (no changes) [49.00ms]`. `93b95f06` changes two test files and
  `biome.json` only — `git diff ed829637 93b95f06 -- bun.lock` is empty and the file's SHA-256 is the
  `ab027501…` every summary stamps — so the tree the matrix ran on is the frozen one.
- **Host idle — not met, recorded.** The plan asked for load < 4 for 3 minutes. This host is shared with other
  agent sessions running Playwright, `bb` proving and `e2e:agent` sandboxes; the 1-minute load never fell below
  ~30 in the windows tried. The launcher waited up to 15 minutes for load < 24 (60 for the extension re-run) and
  recorded the load it launched at: matrix #1 `36.42`, matrix #2 `48.54`, extension re-run `51.74` (15-minute
  average `95.34`). Consequences: the wall-clock lines compare Node-v5 and Bun-v5 **under the same contention
  window**, nothing more, and one contention timeout on the Node reference (below).
- **No tracked edit while a matrix ran.** Lessons, plan and CLAUDE.md edits all came after the last soak.

## Matrix #1 at `ed829637` (2026-09-21 22:40 → 23:34 UTC) — superseded

Launched at load 36.42. 13 × `COMPARE OK`; three `COMPARE FAILED`:

- `landing` — 30 problems, the Node reference red 10/10 by design (see § landing).
- `extension-components` — 3 problems: `reference: 10 run row(s) fail the gate`, `failedRuns=10`, and
  `inventories differ: 1 only in reference, 7 only in candidate`. `LegalAcceptanceSheet.test.ts` did
  `require("@nulo/wallet-core/utils")` inside `vi.hoisted`; a `require()` bypasses Vite and reaches the raw
  workspace TS through Node's own loader, where the barrel's extensionless `export * from "./alarm-dispatcher"`
  does not resolve. On Node the file failed at collection (its one file-level failure is the "1 only in
  reference"; its 7 tests, the "7 only in candidate", never existed there). Bun's resolver accepts the
  extensionless re-export, so CI, which runs the units on Bun, never saw it.
- `extension` — 4 problems: the same three plus
  `"src/presto/presto-core-deps.test.ts :: @alejoamiras/presto-core declares no @aztec dependency": statuses [["failed",10]] vs [["passed",10]]`
  — the test imported `@alejoamiras/presto-core/package.json`, a subpath the package's `exports` map does not
  expose; Node refuses it, Bun does not.

Both are Node-only **test-shape** bugs, not vitest-5 behaviour and not Bun divergence: classified per the
Phase 3 dispositions as test bugs → fixed in `93b95f06` (the hoisted factory is now async and imports both
modules through Vite; the manifest is located with `resolvePackageAsset` and read as a file). Each file is 8/8
green alone on both engines. A new matrix followed. The commit also excludes
`scripts/ci-cd/test-soak/baselines` from Biome: the tool-written compacts carry `failing` arrays the formatter
rejected at `bun run lint`.

## Matrix #2 at `93b95f06` (2026-09-21 23:51 → 2026-09-22 00:43 UTC, extension re-run 14:38 → 15:15 UTC)

Launched at load 48.54, `node v24.21.0 … bun 1.4.2 sha 93b95f06… start 2026-09-21T23:51:18Z`. Fifteen suites
ran 23:51 → 00:08: 14 × `COMPARE OK` and `landing` (by design). The `extension` pair ran 00:08 → 00:43 and
failed once, was classified, and re-ran at the owner's disposition (below). Final: **15 × `COMPARE OK` +
`landing` recorded Bun-only** — the gate as amended by the owner on 2026-09-21.

### The extension pair, first attempt (00:08 → 00:43 UTC) — discarded, kept here

Node reference run 2/10: `FAILED exit=1 136672 ms 6851 tests (2 failed)`; the other nine green. Bun candidate
10/10 green. The compare:

```
reference apps/extension test [node] 10 runs, failedRuns=1, inventory 6851 tests, digest b4c2f99cb20058bc
candidate apps/extension test [script] 10 runs, failedRuns=0, inventory 6851 tests, digest ab74e36534129ed4
wall-clock reference: min 114090 ms · median 126140 ms · p95 136672 ms
wall-clock candidate: min 82647 ms · median 84017 ms · p95 85426 ms
  src/wallet/services/wallet-sdk/content-message-relay.test.ts :: content-message-relay post-attach: content messages forward synchronously; exactly once: failures 1 → 0
  src/wallet/services/wallet-sdk/content-message-relay.test.ts :: content-message-relay pre-attach: a validated top-frame discovery buffers and flushes FIFO on attach, exactly once: failures 1 → 0
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
  ✖ reference: 1 run row(s) fail the gate
  ✖ reference: failedRuns=1, expected 0
  ✖ "… content-message-relay post-attach: …": statuses [["failed",1],["passed",9]] vs [["passed",10]]
  ✖ "… content-message-relay pre-attach: …": statuses [["failed",1],["passed",9]] vs [["passed",10]]
COMPARE FAILED (4 problems)
```

The two failure messages, from the full report: (1) `Error: Test timed out in 5000ms.` — the first test's
`freshRelay()` awaits a fresh `import("./content-message-relay")` after `vi.resetModules()`, i.e. a cold Vite
transform under a 5 s `testTimeout`, at a 1-minute load between 48 and 65; (2)
`AssertionError: expected [ [Function], [Function] ] to have a length of 1 but got 2` — the timed-out import
resolved after `beforeEach` had reset `chromeListeners`, so its late `registerContentMessageRelay()` pushed a
second listener into the next test. One cause, two ids.

**Reproduced and classified** (plan § Dispositions): the file alone on Node 24.21.0, six runs at load 48.22:

```
run 1: exit=0 2529 ms  Tests  7 passed (7)
run 2: exit=0 1809 ms  Tests  7 passed (7)
run 3: exit=0 1755 ms  Tests  7 passed (7)
run 4: exit=0 1809 ms  Tests  7 passed (7)
run 5: exit=0 1751 ms  Tests  7 passed (7)
run 6: exit=0 1743 ms  Tests  7 passed (7)
```

Classification: **environment** — host contention on the reference side, the same class as Phase 2's
`presto/client.test.ts` timeout; not a vitest-5 regression (the test is deterministic alone and 9/10 in the
suite), not a Bun divergence (Bun 10/10), not a product defect. No assertion or timeout was touched. **Owner
disposition, 2026-09-22: re-run the extension pair at the same commit** (no tracked edit, so the matrix commit
is unchanged); the discarded attempt's full reports are kept out of the tree, its compare and reproduction are
this section.

### The extension pair, re-run (14:38 → 15:15 UTC)

Launched at load 51.74 (15-minute average 95.34 — another session's `e2e:agent` run; the Bun runs slowed from
92 s to 109 s across the soak). Node reference 10/10, Bun candidate 10/10, identical inventory digests. The
report is in the table below; it is the one whose compacts are committed.

## `landing` — Node reference red by design

`apps/landing/scripts/legal-pages.ts:120` renders the legal documents with `Bun.markdown.html` and throws
`build-legal needs Bun >= 1.4 (Bun.markdown.html is missing)` on any other runtime. 28 of the 40 tests in
`scripts/legal-pages.test.ts` reach it (every `renderLegalPage` and real-document case, plus `planLegalPages`);
the other 12 pass on Node. So the Node side is `failedRuns=10`, 28 ids `[["failed",10]]`, on every run of both
matrices — deterministic, not flake. The Bun side is 10/10 green, inventory 40, digest `405c423853df7547`.
This is the one suite whose tests **require** Bun, and it says so in the code (a guard, not an accident).
**Owner disposition, 2026-09-21: record landing as Bun-only by design** — the gate reads 15 × `COMPARE OK` +
landing's Bun soak with its Node side quoted red-by-design; CLAUDE.md carries one clause saying landing's
tests need Bun. Its Node compact is committed like the others: it records the divergence exactly, and a future
matrix that ever sees it green on Node has something to explain.

## The sixteen compare reports

Each block is the `compare` output verbatim (meta lines, inventory digests, wall-clock, resolution line,
verdict). Wall-clock is Node-v5 against Bun-v5 on this host in the same window; it says nothing about v4 → v5.

#### resolve-asset — 30 runs (runtime flipped to Bun in Phase 1; 23:51:18 → 23:51:50)

```
reference packages/resolve-asset test [node] 30 runs, failedRuns=0, inventory 14 tests, digest f0b8890614c07a3e
candidate packages/resolve-asset test [script] 30 runs, failedRuns=0, inventory 14 tests, digest f0b8890614c07a3e
wall-clock reference: min 539 ms · median 559 ms · p95 598 ms
wall-clock candidate: min 458 ms · median 479 ms · p95 514 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### legal (23:51:50 → 23:52:01)

```
reference packages/legal test [node] 10 runs, failedRuns=0, inventory 54 tests, digest 1914ef0defcf79bd
candidate packages/legal test [script] 10 runs, failedRuns=0, inventory 54 tests, digest 1914ef0defcf79bd
wall-clock reference: min 564 ms · median 579 ms · p95 631 ms
wall-clock candidate: min 466 ms · median 495 ms · p95 519 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### wallet-sdk-schema-patch (23:52:01 → 23:52:16)

```
reference packages/wallet-sdk-schema-patch test [node] 10 runs, failedRuns=0, inventory 11 tests, digest d6f7f44b921d57f6
candidate packages/wallet-sdk-schema-patch test [script] 10 runs, failedRuns=0, inventory 11 tests, digest d6f7f44b921d57f6
wall-clock reference: min 671 ms · median 701 ms · p95 774 ms
wall-clock candidate: min 571 ms · median 601 ms · p95 1016 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### third-party-notices (23:52:16 → 23:52:31)

```
reference packages/third-party-notices test [node] 10 runs, failedRuns=0, inventory 65 tests, digest 88e93473004b2103
candidate packages/third-party-notices test [script] 10 runs, failedRuns=0, inventory 65 tests, digest 88e93473004b2103
wall-clock reference: min 670 ms · median 698 ms · p95 1152 ms
wall-clock candidate: min 687 ms · median 711 ms · p95 718 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### landing (23:52:31 → 23:52:44) — Node red by design, Bun 10/10

```
reference apps/landing test [node] 10 runs, failedRuns=10, inventory 40 tests, digest fcc0b05118beb974
candidate apps/landing test [script] 10 runs, failedRuns=0, inventory 40 tests, digest 405c423853df7547
wall-clock reference: min 723 ms · median 748 ms · p95 788 ms
wall-clock candidate: min 521 ms · median 546 ms · p95 597 ms
  scripts/legal-pages.test.ts :: … (28 ids, each): failures 10 → 0
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
  ✖ reference: 10 run row(s) fail the gate
  ✖ reference: failedRuns=10, expected 0
  ✖ "scripts/legal-pages.test.ts :: …" (28 ids, each): statuses [["failed",10]] vs [["passed",10]]
COMPARE FAILED (30 problems)
```

The 28 ids: `planLegalPages one canonical page per document plus a permalink per version`, the 25
`renderLegalPage …` cases, `the real documents privacy.md renders against the shipped manifest`,
`the real documents terms.md renders against the shipped manifest`. All 30 problems are the one cause in
§ landing; nothing else differs (12 ids `[["passed",10]]` on both sides, resolutions identical).

#### wallet-crypto (23:52:44 → 23:55:05)

```
reference packages/wallet-crypto test [node] 10 runs, failedRuns=0, inventory 120 tests, digest 64bf601c76fafdd6
candidate packages/wallet-crypto test [script] 10 runs, failedRuns=0, inventory 120 tests, digest 64bf601c76fafdd6
wall-clock reference: min 7466 ms · median 7544 ms · p95 9709 ms
wall-clock candidate: min 5927 ms · median 5957 ms · p95 6629 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### extension-messaging (23:55:05 → 23:55:34)

```
reference packages/extension-messaging test [node] 10 runs, failedRuns=0, inventory 229 tests, digest c25cc551869a9750
candidate packages/extension-messaging test [script] 10 runs, failedRuns=0, inventory 229 tests, digest c25cc551869a9750
wall-clock reference: min 1594 ms · median 1630 ms · p95 1738 ms
wall-clock candidate: min 1221 ms · median 1270 ms · p95 1321 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### wallet-core (23:55:34 → 23:56:12)

```
reference packages/wallet-core test [node] 10 runs, failedRuns=0, inventory 247 tests, digest 70d17d2bf3bd8125
candidate packages/wallet-core test [script] 10 runs, failedRuns=0, inventory 247 tests, digest 70d17d2bf3bd8125
wall-clock reference: min 2014 ms · median 2087 ms · p95 3027 ms
wall-clock candidate: min 1366 ms · median 1396 ms · p95 2158 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### wallet-bridge (23:56:12 → 23:56:38)

```
reference packages/wallet-bridge test [node] 10 runs, failedRuns=0, inventory 279 tests, digest 683e39f554abd8a5
candidate packages/wallet-bridge test [script] 10 runs, failedRuns=0, inventory 279 tests, digest 683e39f554abd8a5
wall-clock reference: min 1485 ms · median 1558 ms · p95 1626 ms
wall-clock candidate: min 979 ms · median 1013 ms · p95 1165 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### design (23:56:38 → 23:57:28)

```
reference packages/design test [node] 10 runs, failedRuns=0, inventory 327 tests, digest 245a01d48b9f90ee
candidate packages/design test [script] 10 runs, failedRuns=0, inventory 327 tests, digest 245a01d48b9f90ee
wall-clock reference: min 2662 ms · median 2755 ms · p95 3754 ms
wall-clock candidate: min 1932 ms · median 1980 ms · p95 2863 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### aztec-runtime (23:57:28 → 23:58:26)

```
reference packages/aztec-runtime test [node] 10 runs, failedRuns=0, inventory 248 tests, digest c639d499f5603993
candidate packages/aztec-runtime test [script] 10 runs, failedRuns=0, inventory 248 tests, digest c639d499f5603993
wall-clock reference: min 3289 ms · median 3391 ms · p95 3442 ms
wall-clock candidate: min 2035 ms · median 2152 ms · p95 3278 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### bridge-core (23:58:26 → 00:00:45)

```
reference packages/bridge-core test [node] 10 runs, failedRuns=0, inventory 446 tests, digest 388851c91b330042
candidate packages/bridge-core test [script] 10 runs, failedRuns=0, inventory 446 tests, digest 388851c91b330042
wall-clock reference: min 6584 ms · median 6788 ms · p95 8193 ms
wall-clock candidate: min 6520 ms · median 6670 ms · p95 7430 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### tools-smoke — `apps/tools test:e2e`, the jsdom smoke (00:00:45 → 00:03:11)

```
reference apps/tools test:e2e [node] 10 runs, failedRuns=0, inventory 29 tests, digest 433d3dde37d355d5
candidate apps/tools test:e2e [script] 10 runs, failedRuns=0, inventory 29 tests, digest 433d3dde37d355d5
wall-clock reference: min 7449 ms · median 7566 ms · p95 9000 ms
wall-clock candidate: min 6336 ms · median 6712 ms · p95 8221 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### tools (00:03:11 → 00:06:34)

```
reference apps/tools test [node] 10 runs, failedRuns=0, inventory 1461 tests, digest 08b218458c24c202
candidate apps/tools test [script] 10 runs, failedRuns=0, inventory 1461 tests, digest 08b218458c24c202
wall-clock reference: min 10528 ms · median 10880 ms · p95 12357 ms
wall-clock candidate: min 8093 ms · median 8492 ms · p95 11980 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### extension-components (00:06:34 → 00:08:30)

```
reference apps/extension test:components [node] 10 runs, failedRuns=0, inventory 565 tests, digest d7f40cc0729c3921
candidate apps/extension test:components [script] 10 runs, failedRuns=0, inventory 565 tests, digest d7f40cc0729c3921
wall-clock reference: min 5406 ms · median 6259 ms · p95 8411 ms
wall-clock candidate: min 4222 ms · median 4744 ms · p95 5459 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

#### extension — the re-run (2026-09-22 14:38:18 → 15:15:49)

```
reference apps/extension test [node] 10 runs, failedRuns=0, inventory 6851 tests, digest ab74e36534129ed4
candidate apps/extension test [script] 10 runs, failedRuns=0, inventory 6851 tests, digest ab74e36534129ed4
wall-clock reference: min 114879 ms · median 123221 ms · p95 132678 ms
wall-clock candidate: min 92334 ms · median 97947 ms · p95 126237 ms
resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios
COMPARE OK
```

Resolution parity held on every suite: the four pinned allowlist entries (`isows`, `msgpackr`,
`@logtape/logtape`, `axios`) are unresolvable from the workspace on both engines (`ERR_MODULE_NOT_FOUND`), the
other seven probes resolve to the same store paths.

## Fan-outs at `93b95f06`

| Gate | Result |
|---|---|
| `bun run test:all` ×5, sequential (15:17 → 15:26 UTC, 1-minute load 104–137) | exit 0 ×5: 118 s · 121 s · 118 s · 121 s · 116 s |
| `bun run audit:vue` | exit 0 — typecheck ∥ units (extension `6840 passed \| 4 skipped \| 7 todo (6851)`) ∥ lint (0 errors, 33 warnings, 5 infos), then the build (`✓ built in 15.78s`); its build disarms the dist, so the smoke build below came after it |
| armed smoke e2e — `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:chrome` (exit 0), then `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` on Node 24.21.0 | exit 0 in 909 s — `Test Files 34 passed \| 2 skipped (36)`, `Tests 137 passed \| 7 skipped (144)` (15:30 → 15:45 UTC) |
| `bun run test:ci-gating` (`bun test scripts/ci-cd/`) | exit 0 — `132 pass, 2 skip, 0 fail, 990 expect() calls, 134 tests across 11 files [22.75s]` |
| `pr-quick.yml` `workflow_dispatch --ref worktree-vitest-5-bump` | run `35746293931`, `headSha 93b95f0684c2795ee139428f786dd6e63c58798a`, `completed success`: Detect changes · Build Landing · Unit tests / Vitest · Lint + Typecheck / Biome + vue-tsc · Build Tools (mainnet) · Build Tools (testnet) · Build Firefox · Build Chrome · `quality-status` all `success`; Commitlint and the preview-build comment `skipped` (both are PR-only by design — a dispatch has no PR) |

`bun run lint` after the md + compacts were added: exit 0 (the compacts are excluded from Biome by
`93b95f06`; `full/` stays gitignored — `scripts/ci-cd/test-soak/baselines/full/.gitignore`).

## Notes for the next matrix

- 10 runs detect a 10 % per-run flake with 65 % power and a 5 % one with 40 %; the one red seen across 330
  reference runs and 330 candidate runs was a contention timeout, and it took a same-commit re-run, not a
  bigger matrix, to clear.
- The "load < 4" precondition is not achievable on this host while other sessions run; the honest substitute
  is to record the launch load and read the wall-clock lines as same-window comparisons only.
- A red reference run cascades: a timed-out `await import()` in one test can leak state into the next, so two
  ids with one cause. Read the failure messages before counting problems.
