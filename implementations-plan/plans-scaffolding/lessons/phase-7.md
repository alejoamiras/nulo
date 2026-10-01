# Phase 7: archive move, index split, repairs (Arc D)

**2026-10-01, green locally on the nulo v6 base. Not pushed: D opens with J and C in wave 2.**

## The tools

- `archive-move.ts` `git mv`s every closed top-level dir into `archive/` and stages nothing else. Its `--verify --parent <tools tip>` re-derives all four tools' output from the parent and reads `git diff --raw -M` against it: every closed path renamed to its mapped path, every edit equal to its derivation, only `archive/index.md` and the stubs added, fewer than 3,000 files.
- `split-index.ts` keeps `index.md`'s header and every line the move leaves, verbatim, and generates `archive/index.md`, one line per closed dir.
- `repair-links.ts` resolves each relative link from the file's old home, maps it and re-relativizes it from the new one through `rewrite-links`' proved rewrite. It maps `implementations-plan/X` tokens in live docs and the curated and index files, and applies `HAND_FIXES`, which include ux-feedback's two design scripts (`shots.mjs` `../../..` → `../../../..`, `build.py` `parents[3]` → `parents[4]`).

## What building them found

1. **A planned edit git cannot pair.** `execution-decomposition/drafts/contradiction-codex.md` has 13 long lines, each opening with a rooted cite. Git scores renames in chunks of long lines, so mapping the cites drops it to R027, and the diff shows it deleted and added. Verify accepts that pair only for a planned edit, still proves its text, and prints a note; an unedited file must pair. Splitting the Outcome commit off, the plan's fallback, would not pair it: the edit is a repair (ledger L46).
2. **Relative spellings of plan paths.** The token pass skipped a token after a slash, to spare permalinks, so `../implementations-plan/X` in `.github/README.md` kept its pre-move dir. A run of `./` and `../` after a non-path character is now part of the token.
3. **R100 is not byte identity**, here too (L39). Verify now accepts an unedited moved file only with an unchanged blob.
4. **untrack read the unpaired repair as a removal.** `untrack.ts --verify` now reads an archive-path addition paired with its source's deletion as a non-exact rename into the archive, so a transcript moved that way still needs a row (L47).
5. **The split voided curated verdicts.** `follow-ups.md` names `implementations-plan/ux-feedback/...` in a code span, which the split re-points, so its mined verdicts no longer matched. `mine.ts` reads `implementations-plan/archive/` as `implementations-plan/` when it matches an entry to its mined line (L48).

A mutation pass disabled each rule the four tools enforce; the tests now fail on every mutant that survived it, from a dir both live and archived to verify's missing edit, wrong rename path and post-move parent.

## tools-extraction joins the archive (owner, 2026-10-01)

J's table held tools-extraction active ("P1 keeps it open"). Once the split scans every active dir, it trips `index-structure` (an Outcome under an active line) and `local-path` (5 hits, all its scrubber's own regexes and Aztec's public CI path). The owner chose to archive it rather than hold it with blob-pinned exemptions: it leaves `ACTIVE_DIRS`, its row derives as closed from its 15 merged PRs, and P1 stays in `follow-ups.md` (L43). Its Outcome sits under its title like the exemplar's, so it joins the grandfathered hosts and gains only its `Shipped` field (L44, Phase 6).

## `lessons.md`'s budget

The split adds `archive/` to all 38 links, 2 more than J measured now that tools-extraction moves too: 7,898 B would become 8,202 B, over the 8,192 B budget. One lesson is reworded, with nothing dropped: "Blocks above the proven tip can be pruned and a symbolic tag can name another fork per call: pin reads to one block hash; reconcile what was recorded above the tip." It saves 13 B, so the repaired file is 8,189 B. `mine.ts --verify` reports that one entry from here on (record L30, 2 problem lines), by design: the mining lock proves J's text, and this is the one deliberate edit to it (L45).

## Step 4: enforcement

`ENFORCED` gains `path-token` for documents, `index-structure` and `archive-structure`, so all fail a pull request or a local run. The commit sits in the tools stage, before generation, so `--verify --parent <tools tip>` judges the generated commits against a tree that already enforces them; after generation only `plans-scaffolding/` may change (L49). CLAUDE.md and the planning README describe the gate as it now runs, and CLAUDE.md drops its "until the archive split" rule.

## The run on the nulo v6 base

On tools tip `fbbceebe` (C `d6e853ce`):
- `outcome.ts`: 267 closed dirs, 309 files (block 245, fields 8, stub 4, nested 50, seed 2).
- `archive-move.ts`: 267 dirs, 1,682 renames, no content edit.
- `split-index.ts`: 267 archive lines, 3 active entries kept verbatim (transport-ready-handshake, PARKED; plans-scaffolding; nulo-v6, which #736 added).
- `repair-links.ts`: 24 files, 12 live docs, skills, curated files and the audit adjudication, and 12 moved plan files. `UPDATE.md` left the set: #736 rewrote the line that named `aztec-5.2.0-js-line`.

Gate on `83d510bc`, exit codes:
- `archive-move.ts --verify --parent fbbceebe`: 0, 1,678 renames (1 unpaired by git), 329 planned edits (5 added), 1,697 changed files, 0 problems.
- `outcome.ts --verify --parent fbbceebe`: 0, 267 closed dirs, 0 problems.
- `check:plans`: 0, 0 findings with every rule enforced.
- `classify.ts --check <closures> fbbceebe`: 0, 270 rows; `untrack.ts --verify`: 0, 679 rows; `mine.ts --verify`: 1, the reworded lesson only.
- All four generators again: `git status` empty.
- Tools tests 36 pass, plans tests 99 pass, `test:ci-gating` 252 pass and 2 skipped, `lint`, `typecheck:all`, `check-no-local-paths.sh`: 0. Every commit signed.

The full 1,697-file diff stays under GitHub's 3,000-file API cap. Its paginated listing is reconciled with the move map once PR D is open (Delivery).

## Restacks

D is never rebased whole: each restack drops the generated commits, replays the tools stage and regenerates (Mechanics § Concurrency).

| Tools tip | C tip | Generated |
|---|---|---|
| `ea0c0cbd` | `144e6f3c` | `89919a7d`, `62f4b860` (no split yet) |
| `367808b7` | `8ea9fe02` | `2d32fbf4`, `95f1f853`, `c02c8f62` |
| `8b85c72c` | `04933e84` | `7268f252`, `e808ba2e`, `67ae12cc` |
| `fbbceebe` | `d6e853ce` (nulo v6 base) | `7f305540`, `ad2d583b`, `83d510bc` |

An earlier tools tip moved tools-extraction's Outcome above its title (Phase 6, attempt 1) and was dropped before generation. Another placed the enforcement after generation; it moved into the tools stage (L49).

## An unreviewed install, caught

`bunx vitest` from the repo root fetched vitest 5.0.3, published the day before. Under the isolated linker the root's `node_modules/.bin` holds only root devDependencies, so `bunx` fell through to npm `@latest`, outside the lockfile and the 7-day `minimumReleaseAge`. It died at config load; its cache dir was deleted. The tests run through the workspace scripts (`bun run test:ci-gating`) or a workspace's own binary.

## Codex round 1 (`/codex high`)

Changes needed, high confidence. All five findings reproduced and adopted (D1-D5, ledger L50-L53).

1. **Blocking: an index line could lend another dir's Outcome.** The gate took a line's dir from the first raw segment of its target, so `tools-extraction/../send-publish-ledger/plan.md` listed tools-extraction while judging send-publish-ledger's Outcome, `nulo-v6/../README.md` hid an active plan's Outcome, `./nulo-v6/plan.md` read as the dir `.`, and a second archive line passed. `entryDir` normalizes the target and returns null unless it names a file inside one plan dir; both index rules use it, and the archive rule refuses a dir listed twice (L50).
2. **Blocking: the documented API reconciliation could not accept PR D.** PR D's diff against C holds 1,716 records, the tools stage's files among them, and the R027 repair shows as a deletion and an addition. The plan now reconciles the API with `$PARENT`'s diff, tools stage included, and an unpaired planned edit is no split trigger (L53). Phases 6 and 7 now record the grandfathered hosts and tools-extraction's closure.
3. **Plan paths in the indexes and curated files were never token-checked.** The scan excludes `implementations-plan/`, and `link-missing` reads links, not code spans. A second grep covers the three indexes and the two curated files (L51); the old head and the tools tip both pass it.
4. **A mode flip passed archive verify.** `rawMeta` returns both modes, and a rename, a planned edit's modification and an unpaired move must each keep theirs (L52). The real move changes no mode.
5. **`outcome.ts`'s comments** cited A15 and put missing fields "at its end". They now state the placement rule, and that the fields extend the list the block opens with, else follow its last text line.

Each new test fails on the code before its fix.

## Codex round 2

Changes needed, high confidence. All four findings reproduced and adopted (D6-D9; L50 and L52 restated).

1. **Blocking: an encoded traversal split the checked host from the clicked link.** `entryDir` normalized without decoding, while link resolution decodes, and a browser reads `%2e%2e` as `..`. So `tools-extraction/%2e%2e/send-publish-ledger/plan.md`, with a decoy file at that literal path, passed: the structure check read the decoy and the link reached send-publish-ledger. `entryDir` now decodes as `resolveHref` does, and the host comes from `resolveHref` and must lie inside the named dir.
2. **Blocking: the mode check trusted git's pairing.** Two identical blobs, one 100644 and one 100755, can trade modes while every pair git reports still matches. Modes are now read from both trees through the move map (`git ls-tree`): a moved or edited file keeps its source's mode, an addition is 100644. `rawMeta` drops the modes round 1 gave it.
3. **A generated addition could be executable.** Covered by the same check.
4. **The plan contradicted the code.** It allowed a planned edit's mode change, still kept tools-extraction's index line, and left "nears the cap" unquantified; the split fallback now fires at 2,900 files.

Each new test fails on round 1's code.

## Before round 3: a plain target

Probing the spellings round 3 would try found one more. Markdown renders a backslash escape, so `d/\.\./a/plan.md` opens as `d/../a/plan.md` while the gate read the literal path, where a decoy with an Outcome passed. Decoding cannot reach that, so an index target must now be a plain `<dir>/<file>` path, the documented format, and anything else is a finding (L50). All 270 real targets already are; `./x/plan.md` now asks for `x/plan.md` instead of being read as `x`.

## For E

- `mine.ts --verify` stays at the reworded lesson until E rewrites `lessons.md`; from then on the mining record is evidence of J's curation, not a gate.
- The R100-frozen texts C left (`reference/aztec-5.0.0-stable/regime-a-vectors.ts:5`, `PRF-NON-PORTABLE.md`'s `packages/extension/` paths) and the three held crypto-source mentions are E's follow-ups.
- `follow-ups.md`'s plans-scaffolding/ux-feedback entry is resolved by this arc: the move archived ux-feedback and fixed both design scripts' depth.
