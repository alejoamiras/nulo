# Phase 5: relocate assets, repair broken mentions (Arc C)

**2026-09-30, green locally. Not pushed: C is restacked onto J (`plans-scaffolding-closures`) before it opens.**

Branch `plans-scaffolding-repoints`, cut from `origin/dev` at `910a4def` (#735), upstream unset. It was built beside J, so it keeps to Phase 5's file set and leaves J's `lessons.md`, `follow-ups.md` and `index.md` alone.

## Commits

| Commit | Step | What |
|---|---|---|
| `e2c20529` | 2, 3, 5 | `chore(plans)`: the three reference projects → `reference/<plan>/` (15 R100); the five KAT imports; the vector cites in `key-vectors.test.ts`, `address-freeze.ts`, `UPDATE.md:36` and `PROVENANCE.md:29` |
| `6c5332e2` | 2, 5 | `chore(plans)`: `phantom-sweep.ts` → `scripts/`; CLAUDE.md's command |
| `21a6683d` | 2, 5 | `docs(e2e)`: `PRF-NON-PORTABLE.md` → `apps/extension/tests/e2e/`; its six mentions in five files; CLAUDE.md's cross-reference list becomes the A7 rule, and the README's rule 2 with it |
| `741608b0` | 2 | `chore(test-soak)`: 25 baselines → `scripts/ci-cd/test-soak/baselines/`; `BASELINES_DIR`; the Biome exclude |
| `787d9cfc` | 4 | `fix(plans)`: the four broken mentions still on dev |
| `4022ef07` | 5 | `docs(ci)`: CI.md's quarantine line |
| `249c5986` | 5 | `docs(notices)`: two reopen triggers → `implementations-plan/follow-ups.md` |
| `d266e41c` | 6 | `ci(plans)`: the nested-ignore allowlist removed |
| `46d2b7f9` | 6 | `ci(plans)`: `path-token` enforced in code and config; `check:plans` |
| `02c0541e` | gate | `fix(plans)`: `untrack.ts --verify` reads an exact move out of the plan tree as a move |

Every commit is signed; `bunx commitlint --from origin/dev --to HEAD` exits 0.

## Step 1: importers

`git grep -n -E "from .*reference/" origin/dev -- ':!implementations-plan' ':!audit'` lists 5, the plan's upper count: the four tests plus `scripts/publish/stage.test.ts` (F7's fifth, added by #694).

| Importer | Import after the move |
|---|---|
| `packages/aztec-runtime/src/account/account-seed-vectors.test.ts:5` | `../../../../reference/key-model-v2/vectors.json` |
| `packages/aztec-runtime/src/account/derivation-vectors.test.ts:6` | same |
| `packages/wallet-crypto/src/account-derivation.test.ts:3` | `../../../reference/key-model-v2/vectors.json` |
| `packages/wallet-crypto/src/mnemonic-master.test.ts:2` | same |
| `scripts/publish/stage.test.ts:5` | `../../reference/key-model-v2/vectors.json` |

## Step 2: the moves

42 pure renames and no add or delete: 15 reference files, the sweep, the PRF doc, 24 baselines and `full/.gitignore`. `git diff -M100% --name-status origin/dev...HEAD` pairs all 42 as `R100`.

**Deviation: the plan's R100 command prints nothing.** `git diff -M100% --diff-filter=R --stat origin/dev...HEAD -- reference scripts apps/extension/tests/e2e` exits 0 with empty output. A pathspec limits the diff before rename detection, and every source sits in `implementations-plan/`, outside it, so each move reads as an add and the filter drops it. With the sources in scope (`… -- reference scripts apps/extension/tests/e2e implementations-plan`) it reports `42 files changed, 0 insertions(+), 0 deletions(-)`.

**Deviation: `biome.json` gains one line.** A bare `git mv` of the baselines reds `bun run lint`: Biome's includes reach `scripts/ci-cd/test-soak/**`, and a stdin probe showed it reformatting 24 of the 24 JSON files. The exclude `"!scripts/ci-cd/test-soak/baselines"` is byte-identical to #669's line, so that line merges cleanly whichever lands first. Apart from `package.json`, it is the only JSON change that is not a rename.

The sweep's output at its new path is identical to dev's copy.

## Step 3: KAT imports

The edits change paths only: no vector or pin moved. `git diff --name-only origin/dev...HEAD -- packages/wallet-crypto/src ':!*.test.ts'` is empty.

| Tests | Result |
|---|---|
| aztec-runtime `derivation-vectors`, `account-seed-vectors`, `address-freeze` | 34 pass |
| wallet-crypto `account-derivation`, `mnemonic-master` | 11 pass |
| extension `key-vectors` | 10 pass |
| `bun test scripts/publish/` (holds `stage.test.ts`) | 22 pass |

`address-freeze.ts:55-56` is on the freeze surface, and its edit is a comment naming the two vector dirs. `address-freeze.test.ts` pins the regime entries, not the file's text.

## Step 4: the six broken mentions

| Mention at A | On dev at `910a4def` | Now |
|---|---|---|
| `ChangeAuthwitsRegistryPopup.test.ts:7`, `RevokeAuthwitsPopup.test.ts:9` → `network-followups/audit-codex-fix-review.md` | removed by #717 (`a7b1ff62`) | no change needed |
| `embedded-fpc-cap.ts:64` → `embedded-fpc-firsttx-cosmetic/plan-v2.md` | broken | the promoted `plan.md` |
| `vitest.e2e.network.config.ts:40` → `network-followups/audit-codex-rootcause.md` | broken | permalink to `network-followups/investigation-journey.md` at `9f11de70` |
| `prune-stale-branches.sh:6` → `ci-cd/audit-smoke-gating.md` | broken | permalink at its manifest row, `9f11de70`, `#L27` |
| `wallets-architecture-research/nulo-phase-2-plus.html:98` → `phase-2-plus/plan-v4.md`, `eli5.html` | broken, outside `path-token` | permalinks at their manifest rows, `9f11de70` |

**Deviation: the network config cites a different file.** Its comment credited `audit-codex-rootcause.md` with the popup race's investigation and fix, but that audit's verdict is a PXE slowdown. `investigation-journey.md` documents the race and its fix, and has not changed since `9f11de70`. The rewritten comment states the live behavior: two retries unless `NULO_E2E_RETRY` says otherwise, and 0 on the PR gates and the soak. It drops the old comment's plan-phase reference and its second dead cite, `network-test-triage/full-suite-findings.md`.

## Step 5: stale texts

- `CI.md`: "18 quarantined tests" was false (F13). The line now says the suite quarantines nothing, names where its skips and flakes live, and cites `CHROME_ONLY` and `FIREFOX_ONLY` for browser skips. `git grep -E "\b(test|it|describe)\.skip\(" -- apps/extension/tests/e2e/network` finds 0; `skipIf` has 155 lines.
- CLAUDE.md: the sweep command (L48); the "Live cross-references are OK" list, which named `passkey-e2e/PRF-NON-PORTABLE.md` and `network-test-triage/plan.md`, becomes the A7 rule: "Cite a live doc or a permalink, never a plan path." `implementations-plan/README.md` rule 2 says the same.
- `legal/README.md:68` and `packages/third-party-notices/README.md:113` now name `implementations-plan/follow-ups.md`.
- `PROVENANCE.md:29` and `UPDATE.md:36` now name `reference/`.
- **Deviation: the wallet-crypto README names no vector path**, neither at `9f11de70` nor on dev. Its one moved-asset mention is the PRF doc, repointed in `21a6683d`.
- Other live mentions of a moved path: `ARCHITECTURE.md:197`, the `e2e-testing` skill (L400), `chrome-webauthn.ts:12` and `passkey-paths.test.ts:15,197`.
- Final sweep for every old path outside the plan tree finds only the frozen `audit/` tree (4 lines), the three held comments in `packages/wallet-crypto/src` (step 6) and the gate's own allowlist and fixture.

## Step 6: the gate

`"check:plans": "bun scripts/ci-cd/plans/check.ts"` joins the root scripts. CLAUDE.md's gate bullet and the README's § The gate now name it and the new rule.

`lib.ts` gains `ENFORCED_IN_CODE` (`path-token`) and `Ctx.oids`. `isEnforced` fails a `path-token` finding unless its file is a document (`.md`, `.html`). The tree went from 29 report-only findings to 0 by three means:

| Means | Findings cleared | Why |
|---|---|---|
| An allowlisted permalink's span is blanked before token extraction | 1 (`prune-stale-branches.sh:7`) | A permalink pins its commit, so its plan path says nothing about HEAD. `isAllowedPermalink` judges each URL-shaped span whole, so a dot segment, an unlisted SHA or `blob/dev` keeps its tokens. |
| `PATH_TOKEN_EXCLUDES` gains `reference` and `scripts/ci-cd/test-soak/baselines` | 25 | `regime-a-vectors.ts:5` (its usage line) and each baseline's line 15 (`--out`) record their old paths and are R100-bound. On dev, neither tree was scanned: both sat under the excluded plan tree. |
| `PATH_TOKEN_ALLOWLIST`, three entries, blob-pinned and shrink-only | 3 | `account-derivation.ts:15`, `mnemonic-master.ts:11`, `nulo-separators.ts:10` name the old vector dir, and C may not edit `packages/wallet-crypto/src`. Each hold lasts while its file is the recorded blob, so the first edit to the file ends it. `tree.test.ts` fails once an entry is stale, so a repointed mention also leaves the list. |

**Deviation: the blob-pinned allowlist.** A6 assumes every kept code mention resolves under `archive/`. These three named an asset that moved out of the plan tree, so they resolve nowhere. The alternative was to edit the three comments, which the staging would not see (F15: `removeComments`). The plan rules it out (§ Crypto and the account freeze), so the comments wait for their next edit.

The nested-ignore allowlist (`NESTED_IGNORE_ALLOWLIST`, one entry) is deleted with its only entry: that file now sits at `scripts/ci-cd/test-soak/baselines/full/.gitignore`.

**Fail-first.** The new tests ran against the unchanged gate (`249c5986`): `bun test scripts/ci-cd/plans/` exits 1 (64 pass, 3 fail).

- `links.test.ts` fails to load: `Export named 'PATH_TOKEN_ALLOWLIST' not found`.
- The nested-ignore test finds no finding for the baselines' ignore file.
- `verdict` passes a code-file `path-token` finding.

A scratch copy of the two `links.test.ts` fixtures that need no new export fails 2 of 2:
- The permalink fixture also flags `docs/notes.md:1`, `src/a.ts:1` and `src/a.ts:2`, beyond the expected `src/a.ts:3` (unlisted SHA) and `src/a.ts:4` (`blob/dev`).
- The exclusion fixture also flags `reference/p/gen.ts` and `scripts/ci-cd/test-soak/baselines/bun/x.json`.

After the change the plans suite has 99 pass, 0 fail.

**Probe on the real tree.** Three files were staged into a scratch copy of the index (`GIT_INDEX_FILE`), leaving the real index untouched. The gate then exits 1:
- `probe/code.ts:1` is enforced.
- `probe/notes.md:1` is reported only.
- `probe/pinned.ts`, which holds an allowlisted permalink to a gone transcript, is no finding.

**Gotcha.** An autolink `<https://…/implementations-plan/…>` is skipped: its `>` lands in the token, and a token holding `<>{}*` reads as a template. The first doc fixture used one and proved nothing, so it now uses a markdown link. The same angle brackets would hide a stale mention in code. Nothing in scope uses the form today: the only template-shaped tokens are `.gitattributes:6` and `check-no-local-paths.sh:14` (`**`) and two in CLAUDE.md (`<plan>` and a brace list, which is expanded).

## Gate-adjacent fix: `untrack.ts --verify`

C's pre-merge gate (§ Delivery, "Before every merge") runs `untrack.ts --verify`. Here it exits 1 with 42 problems: each moved asset "leaves the tree without a row". `removedOnBranch` diffed with `-- implementations-plan`, so a rename out of the tree had no target and read as a deletion. The plan states its coverage rule over the whole diff (§ Non-obvious mechanics, "Evidence manifest and permalink base"). The verifier now diffs the whole tree and still asks a row for any move that changes a byte (`R` below 100) or leaves a transcript name.

Fixture (`untrack.test.ts`): `kept.ts` moves out byte for byte, `edited.txt` moves out with one line changed, and `audit-x.md` moves out byte for byte. Before the fix, verify flagged all three; after it, it flags `audit-x.md` and `edited.txt`. On the branch, `untrack.ts --verify` reports 679 rows, 0 problems, and `--dry-run` prints nothing.

## Gate on `46d2b7f9`

The heavy suites ran once on `46d2b7f9`. `02c0541e` and this log touch only `implementations-plan/plans-scaffolding/`, which no workspace suite, build or e2e reads. The last seven rows ran on the tip.

| Command | Exit | Result |
|---|---|---|
| `git diff -M100% --diff-filter=R --stat origin/dev...HEAD -- reference scripts apps/extension/tests/e2e implementations-plan` | 0 | 42 files, 0 insertions, 0 deletions (the plan's form: empty, see step 2) |
| `git diff --name-only origin/dev...HEAD -- packages/wallet-crypto/src ':!*.test.ts'` | 0 | empty |
| `git diff --stat origin/dev...HEAD -- '*.json' ':!package.json'` | 0 | 32 renames, 0 lines each, and `biome.json` +1 |
| `bun install --frozen-lockfile` | 0 | no changes |
| `bun run test:all` | 0 | 12 workspaces, 10,559 pass, 6 skip, 7 todo |
| `bun run typecheck:all` | 0 | clean |
| `bun run test:ci-gating` | 0 | 249 pass, 2 skip |
| `bun run test:release` | 1 | 159 pass, 5 skip, 3 fail. All 3 failures are in `zip-reproducible.test.ts`, which spawns `zip`, and `zip` is not on this machine's PATH. C does not touch `scripts/release/`; `scripts/publish/` alone, which holds `stage.test.ts`, passes 22. |
| `bun run lint` | 0 | 28 warnings and 3 infos, none in a changed file; complexity-baseline OK |
| `bun run lint:actions` | 0 | clean |
| `bun scripts/phantom-sweep.ts` | 0 | identical to dev's copy |
| `bun test scripts/ci-cd/test-soak/` | 0 | 40 pass |
| `bun run audit:vue` | 0 | typecheck, tests and lint, then the build |
| smoke build, CI's flags (`VITE_NULO_E2E_MIGRATION_FIXTURE=1`, `VITE_NULO_E2E_DEFAULT_NET=testnet`, `VITE_NULO_E2E_TOKEN_SEEDS{,_CONFIRM}=1`) | 0 | both token-seed markers in `dist/chrome` |
| `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_BROWSER=chrome NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` | 0 | 40 files pass, 3 skip (43); 166 tests pass, 7 skip, no retry; 1,203 s. No Chrome left on this worktree's `dist` afterwards. |
| `bun run check:plans` | 0 | 0 findings, 0 enforced |
| `bun test scripts/ci-cd/plans/` | 0 | 99 pass |
| `bun test implementations-plan/plans-scaffolding/tools/` | 0 | 9 pass |
| `bun implementations-plan/plans-scaffolding/tools/untrack.ts --verify` | 0 | 679 rows, 0 problems |
| `./scripts/check-no-local-paths.sh` | 0 | ok |
| `bunx commitlint --from origin/dev --to HEAD` | 0 | clean |
| the two tool files, linted as copies under `scripts/ci-cd/plans/` | 0 | clean; the first cut of `removedOnBranch` scored 16 and was split |

The network suite runs as the PR's required check.

## For the restack onto J, and for D

- **Rerun the gate after the restack.** `path-token` now fails a code mention of anything J untracks or moves. Run `bun run check:plans` and `untrack.ts --verify` on the restacked tip.
- **`passkey-e2e/` is empty.** Its only file moved, and J's `closures.json` still carries its row (closed, no Outcome file). D's Outcome generator and archive mover must skip it: there is no directory left to archive.
- **The notices' reopen triggers** point at `implementations-plan/follow-ups.md`. J lifted all six items of `third-party-notices/follow-ups.md` into its § Dependencies and supply chain: the five declined items as one entry with their triggers, and the dev-server routing as its own.
- **#669** deletes the old baselines and adds regenerated ones at C's destination. Its rebase over C can conflict there: add/add wherever git does not pair #669's rewrite with the old file. #669's baselines win. Its `BASELINES_DIR` line and Biome exclude are identical to C's.
- **R100-frozen text.** `reference/aztec-5.0.0-stable/regime-a-vectors.ts:5` still tells a reader to run `bun implementations-plan/aztec-5.0.0-stable/reference/regime-a-vectors.ts`. `PRF-NON-PORTABLE.md` keeps its pre-restructure `packages/extension/` paths. A plain edit after C can fix both; C cannot.
- **For D's strict docs mode:** the angle-bracket gotcha above; and after the archive split, a held wallet-crypto mention still resolves nowhere, so the allowlist stays until those files are edited.
- C trips the extension, packages, landing (`legal/**`) and root-config filters, so both e2e suites and the advisory Firefox lanes run on its PR.

## Restacks onto J

Each restack was `git rebase --onto <J tip> <previous J tip>`. Every replayed commit stayed signed, and each one moved C by exactly J's diff between the two tips (`cmp` of the two diffs).

| C tip | J tip | Gate |
|---|---|---|
| `95fccfe6` | none: built on `910a4def` | the table above, on `46d2b7f9` |
| `20de6e05` | `7bb11cb6`, round 1 | the plan-tree checks |
| `aa45f6b0` | `a2758473`, round 2 | Phase 5's full gate, below |
| `ed03e1b8` | `4b5b4fd9`, round 3 | the plan-tree checks: J's round 3 touched only `implementations-plan/plans-scaffolding/` |

The plan-tree checks are `check:plans`, the tools tests, `classify.ts --check`, `mine.ts --verify` and `untrack.ts --verify`. They exit 0 on each tip.

Phase 5's gate on `aa45f6b0`, against `a2758473`:
- **R100:** the plan's form passes vacuously (step 2). The corrected form pairs 42 moves, all `R100`. `packages/wallet-crypto/src` has no non-test change. The JSON diff is 32 `R100` renames plus `biome.json`'s one line.
- **Smoke:** CI's smoke build, then `bun run test:e2e --shard=i/5` in five parallel shards, each with its own copy of `dist/chrome` as `EXTENSION_PATH`, since the global setup kills Chrome by its `--load-extension` path. 40 files pass and 3 skip, with 166 tests passing and 7 skipped. It took 441 s against 1,203 s unsharded, and `e2e:reap` found nothing left.
- **Exit 0:** `test:all`, `typecheck:all`, `test:ci-gating`, `lint`, `lint:actions`, `phantom-sweep.ts`, the soak tests, `check:plans`, the tools tests, `classify.ts --check`, `mine.ts --verify`, `untrack.ts --verify`, `check-no-local-paths.sh` and `audit:vue`.
- **Exit 1:** `test:release`, with the same 3 `zip-reproducible` failures as before (`zip` is not on this machine's PATH).
