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

## Codex round 3

Approve, high confidence, no findings: the plain-target rule held against literal, encoded, double-encoded and escaped decoys, all 270 real targets passed, and 512 accepted probes rendered and opened as written. The move-map mode check passed identical blobs' cross-pairings and caught six injected changes. D's loop converged here, at its cap.

## Cross-arc pass, round 1

A fresh session over `80663b61..3551372e`, asked for seams, duplication and plan drift: changes needed, 6 findings, each reproduced before it was fixed.

- **Y1** (J): `rowProblems` compared each row with its derivation but never the reverse, so a deleted row made a closed plan rowless, which reads as active. It now reports a derived dir without a row.
- **Y2** (J): `readManifest` returns `[]` on ENOENT, and the data paths were fixed to the live dir, so after E's move `untrack.ts --verify` would pass with 0 rows. `gate.ts` exports `OWN`, read from its own location; `MANIFEST`, `CLOSURES`, the snapshots and `MINING` use it; `verify` refuses a missing manifest. Two fixtures, one in C and one in D, had relied on a missing manifest reading as empty: each now writes an empty one.
- **Y3** (D): L30's reword voided its verdicts. A fresh Opus verifier supported the new text against `incoming-public-transfers/lessons/phase-5.md` and the code; the currency check holds at the V6 base (`orphanedByReconciliation`, `public-events.ts:152`). `mine.ts --decide` recorded both, and the verify passes on D.
- **Y4** (D, E): the narrowed guard finds 18 files on D's tools stage, every one in a closed plan not yet moved, and none on D's generated tree. The hook scans the whole index, so D's tools and Outcome commits could not pass it: the narrowing ships in E (L57), and the plan text now describes E as one PR on top of D (L58).
- **Y5** (D): `closed.ts`'s `catBlobs` and `ancestorDirs` were copies of `lib.ts`'s, the first without its 120 s timeout. `lib.ts` exports both and the tools use them.
- **Y6**: `classify.ts`'s answers comment and an `archive-move.test.ts` fixture comment no longer cite the plan.

J moved to `df2de6ad`, C to `fc2492a6` (its fixture fix on J's), and D's tools stage onto it; D was then regenerated.

## Cross-arc pass, round 2

Every round-1 fix held. Two findings:

- **Y7, rejected.** An emptied or trimmed manifest still verifies, since the branch removes nothing once A has merged. The manifest only indexes: each link to an untracked file is a permalink the gate pins to an allowlisted, ancestry-checked commit, so a lost row loses no reachable evidence, and the verify belongs to a tool CI never runs. E's gate checks its own move instead: every rename in its move commit keeps its blob and mode. The plan's "append-only" now reads as what holds: `record` only appends.
- **Y8, adopted.** § Data & control flow, § Security's guard line, the A9 answer (annotated, not rewritten), the merge command (`--squash`) and both seeds still described E then F, or the guard narrowing in A.

## Cross-arc pass, round 3

Approve, high confidence, no findings. Codex accepted Y7's decline (a lost row leaves git history and every pinned link intact, and the historical manifest stays recoverable) and confirmed Y8: what still reads E then F is history. Its one note is for E: the move check compares each file's source and destination blob ids and modes, because R100 with an unchanged mode does not prove byte identity (L39). The cross-arc pass converged here.

## Restacks onto 0.29.0, #740, #745 and #747

`dev` moved to `d7da8e62` (the 0.29.0 release: `CHANGELOG.md`, the release-please manifests and two `package.json` versions) after the pass converged. J moved to `d1307f35` and C to `e43f2ae8`, each with no conflict. `git rebase --onto e43f2ae8 fc2492a6` replayed the tools stage from `000b467a` to `e2dd894b`, 28 commits, every one signed. Regenerated there, the generated delta is byte-identical to `000b467a..69e0fafc` (`git diff -M --raw --no-abbrev`: the same 1,697 records).

`dev` then moved to `3452ac3b`, #740, which closed nulo-v6 and edited `SKILL.md`, `index.md`, `lessons.md` and `follow-ups.md`. J moved to `b541e579`, keeping #740's `follow-ups.md` edits (`lessons/phase-4.md`), and C to `79af0797`, with no conflict. `git rebase --onto 79af0797 e43f2ae8` replayed the tools stage to `dbbfefea`, 29 commits, every one signed. Regenerated there, the delta keeps its 1,697 paths, and three blobs differ from the 0.29.0 run: `SKILL.md` and `index.md` carry #740's text around the same repaired lines, and `follow-ups.md` no longer repairs P1, which #740 deleted. No repair touches nulo-v6. It is newer than `closuresBase`, so it stays active, its line reading `closed, awaiting archive` over a complete Outcome, which the gate accepts.

Then `dev` moved to `7c2425ca`, #745, two release entries in `follow-ups.md`. J placed them in its `## Release` section (`lessons/phase-4.md`), C replayed without a conflict, and `git rebase --onto bd5efaed 79af0797` replayed the tools stage, 29 commits, every one signed. Regenerated there, the delta again keeps its 1,697 paths; only `follow-ups.md`'s blob differs, by #745's two entries, which link nothing, around the same 282 repaired lines.

Last, `dev` moved to `fe597a1d`, #747, which hash-pins `setup-aztec`'s installer and edits `SKILL.md`, `.github/README.md`, `CI.md` and three of #740's entries in `follow-ups.md`. J and C replayed it without a conflict (`lessons/phase-4.md`, `lessons/phase-5.md`), and `git rebase --onto 8cd6f20f bd5efaed` replayed the tools stage, 29 commits, every one signed. Regenerated there, the delta keeps its 1,697 paths and every repaired line; the blobs of those four files differ, by #747's text around the repairs, which links no moved plan.

This entry then moved the tools tip once more, and D was regenerated on it.

## For E

- E's move commit is checked file by file: each source's blob id and mode at the parent equal its destination's at the commit (L39).
- `mine.ts --verify` no longer gates (L60): it reports 13 problems on J, all from text `dev` added after `closuresBase` (#740, #745, #747), and its record stays evidence of J's curation.
- E narrows `check-no-local-paths.sh`'s exemption to `archive/` (L57): on D's generated tree the narrowed guard finds nothing, on its tools stage 18 unmoved plan files.
- E deletes `tools/` in its own commit before the move (L61). `untrack.ts --verify` would read that deletion as files leaving without a row, so it runs at E's last commit before it, and the repairs run from a checkout of D's head.
- The R100-frozen texts C left (`reference/aztec-5.0.0-stable/regime-a-vectors.ts:5`, `PRF-NON-PORTABLE.md`'s `packages/extension/` paths) and the three held crypto-source mentions are E's follow-ups.
- `follow-ups.md`'s plans-scaffolding/ux-feedback entry is resolved by this arc: the move archived ux-feedback and fixed both design scripts' depth.
- J's mined `setup-aztec` entry asks for the installer pin #747 shipped, so it is resolved too; #747's rewritten V6 entry keeps what stays unpinned.
- nulo-v6's move goes to `follow-ups.md`: this arc does not edit that plan.
