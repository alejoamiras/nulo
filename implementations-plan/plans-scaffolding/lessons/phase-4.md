# Phase 4: mining `lessons.md` and `follow-ups.md` (Arc J)

**2026-09-30, green locally.** Branch `plans-scaffolding-closures`, on `910a4def`. Every quote re-derives from that commit, `closures.json`'s `closuresBase`.

## The record

`mining.jsonl`: 325 inventory entries, 269 candidates, 902 verdicts, 181 lines.

**Inventory.** One entry per `closures.json` row (270) and nested plan (55). 320 name a host; 5 have none: passkey-e2e (relocated, L19) and the four dirs D stubs. Their 1,264 source files, 13.9 MB, are each `read` or `scanned`, none skipped:
- read in full: 911 lessons logs, 43 `plan.md`, 9 `STATUS.md`, 6 `WRAP-UP.md`, 1 `README.md`, and 19 ledgers, runbooks and follow-up files;
- scanned for their follow-up, residual and ledger sections: 275 long hosts (268 `plan.md`, 4 `README.md`, 2 `scope.md`, 1 `seed.md`).

**Candidates.** 97 carried: every entry the two curated files held at the base (26 lessons, 71 follow-ups). 172 from sources: 161 from eight Opus readers, 11 from the driver. The readers were the seven clusters and one for the UX program's 21 plans; a ninth re-checked 67 carried follow-ups at the base, and the program, ci-release and aztec readers the other 30 carried entries (26 lessons, 4 follow-ups). The plan capped a reader at 12 proposals; they returned 12 to 25, because a cluster spans up to 78 plans. The driver's budget did the cutting instead.

| Reader | Proposed | Accepted |
|---|---|---|
| crypto-backup | 25 | 24 |
| aztec | 24 | 19 |
| runtime | 23 | 19 |
| ui-design | 21 | 14 |
| ci-release | 20 | 15 |
| e2e | 19 | 15 |
| bun-deps | 17 | 13 |
| program | 12 | 7 |
| driver | 11 | 11 |

**Verdicts.**
- Readers and the driver: 172 proposals, each with the command it re-ran at the base; of the carried, 79 keep and 18 update (16 follow-ups, 2 lessons).
- Driver: 227 accepted, 42 rejected, each with a reason. 7 are carried lessons, retired below; 2 are new follow-ups the verifier found no longer open.
- Currency: 181 lines hold at `910a4def`, each citing its readers' check or, for a rewritten line, the driver's and the verifier's. A line tied to a tool version names it and the month.
- Verifier: see below.

## The files

| File | Before | After |
|---|---|---|
| `lessons.md` | 8,131 B, 26 entries | 7,862 B, 34 entries in 6 sections |
| `follow-ups.md` | 34,354 B, 71 entries | 62,412 B, 147 entries |

**`lessons.md`.** 11 lines carry 13 of the 26 old entries, some merged or reworded, and 23 lines are new. 6 old entries a skill or doc already owns became F506 and F508 (L24). 7 retired:
- `toRaw`: general Vue reactivity knowledge.
- The fee-juice balance import: its file's header comment says it where the import lives.
- The count-up's tabular digits: one component, and an owner call.
- `withLock`: its TSDoc says it (`packages/wallet-core/src/utils/lock.ts`); the open delete is a follow-up.
- Hand-built field fixtures: one test file's concern.
- vitest#11237: its follow-up carries it until the fix ships.
- The two missing focus rings: their follow-up carries them, and CLAUDE.md's screenshot rule covers reading a capture.

After D adds `archive/` to 36 of its 38 links, the file is 8,150 B (L23). One new candidate, the unchecked `scripts/` typecheck, is an open gap rather than a gotcha, so it became F507.

**`follow-ups.md`.** The 71 carried entries stay, 16 of them updated after their re-check (the Firefox prover-ON entry, for one, now marks row 42 fixed by #721). 76 are new: 15 in existing sections, 61 in eight new ones after Copy (Incoming transfers, Backup and storage, Older plans' residuals, Tests and e2e, Dependencies and supply chain, Release, Plans, docs and tooling, Issues and unleashed). The empty "ux-feedback: taken by a follow-up plan" section is gone. Each of the 11 closure follow-up ids names its entry (L18). The five issues are pointers; #280 and #293 share one unleashed line.

## Index moves

`transport-ready-handshake/spec-rows.md` holds the parked arc's spec verbatim (L20), and its index line names it (`b9e20e41`). The `incoming-tip-first-scan` line is gone: it never had a plan, and its item is a follow-up.

## Verifier

Three fresh-context Opus verifiers read every line against its quotes and the code at the base: 175 supported, 8 unsupported. Six were rewritten and verified again (L25), two dropped:
- **L10**: now names `auto-imports.d.ts` only, which regenerates when Vite builds or serves and keeps a removed export's global. `components.d.ts` is rewritten, and two files in `src/types/` are hand-written.
- **L35**: `set -e` stops nothing in the agent shell, not only in a subshell; a fresh `zsh -c` honours it (reproduced).
- **C33**: the journal page renders no status colour, so the entry names the activity card.
- **C34**: its pointer to the sponsor funding entry is gone; #728 resolved that entry and removed it.
- **C70**: the 41 errors were the four `extraTokens` specs' program. The whole tree has 415 errors in 152 files (reproduced), and 103 in 37 with the context typed `object`.
- **F406**: #669 retires the stopgap itself and conflicts with dev, and no record says the owner parked it.
- **F106**, dropped: since #619 a capped seed reads failed and offers Retry, so it no longer lasts until the next release.
- **F119**, dropped: holdings-loading-sync replaced the indicator with skeleton rows and a scan-health line.

A second verifier supported five of the six and failed L10's first rewrite, "only appends": a build rebuilds the type re-exports and keeps only the value globals. It also measured C33's red subtitle (3.56:1, added) and named C34's second pin, `send-check.test.ts` (added). A third supported the refined L10, C33 and C34, and F605 once it linked `harden-findings-remediation`: D lists an open item by the plan its entry links, and F605 is that plan's #284. The record keeps each line's last verdict, plus the two dropped lines' `unsupported` ones.

Six supported lessons link only part of their evidence (L09, L11, L12, L14, L28, L31). `mining.jsonl` holds every candidate, and the budget cannot take the extra links.

## Found on the way

- `test:ci-gating`'s tree test failed on a home path written literally into `mine.test.ts`: the local-path rule reads every tracked file under this plan. The fixture now joins the path at runtime.
- The plan tools sit outside Biome's `files.includes`, and a stdin run did not report the complexity errors a run on a real path inside the scope did. Linted that way, `mine.ts` had four functions over the cognitive budget and `mine.test.ts` one; each is split. `untrack.ts`'s `removedOnBranch` (16) is left to C, whose rewrite replaces it.
- The 2026-09-30 nightly is red in `rows.test.ts`'s `backToHome` on both browsers. The likely cause (moderate confidence) is #719's wait for `tokens-empty-import-link`, which never appears because the artifact seeds default tokens. dev still has the wait, so the next nightly will likely fail too. Flagged to the owner; not this plan's scope.

## Gate

On the staged tree, before the commit:
- `bun scripts/ci-cd/plans/check.ts`: 0 enforced. It reports 3 path tokens, the three code comments C rewrites.
- `bun test implementations-plan/plans-scaffolding/tools/`: 13 pass. `classify.ts --check`: 270 rows, 0 problems. `mine.ts --verify`: 0 problems.
- `bun run lint`: 0 errors. `bun run test:ci-gating`: 246 pass.
- `lessons.md`: 7,862 B, 34 entries, each linking its evidence.

## Codex loop

Round 1 (`/codex high`, 2026-09-30): changes needed, high confidence, 8 findings. It found no wrong closure and no falsely resolved follow-up in the committed table. Each finding was reproduced before its fix, and all 8 are adopted (ledger J1-J8):
1. **Verdicts outlive their text** (high). `--decide` re-recorded a line under its id and kept its currency and verifier verdicts. Both now carry `subject`, the hash of the line's text (archive links normalised) and its candidate ids; `--verify` voids a verdict that judged another subject.
2. **Text outside an entry escapes the record** (high). An appended paragraph passed. Outside its entries a file now holds only its title, an introduction as the first line after it, `## ` headings and blank lines.
3. **`--check` compares no row's fields** (high). A row could turn closed, take an outside host or a stray PR unseen. The table is now exactly what `closuresBase` derives, the owner's answers included, and `--check` compares every field and refuses a row whose dir the base lacks.
4. **Evidence need not sit at the base** (medium). A candidate retargeted to new text at HEAD passed on its own hash. A quote's commit must now be `closuresBase`: a carried candidate is exactly an entry the curated files held there, any other cites an inventory source, and bounds, line and id are rechecked.
5. **A subject switches the drift guard off** (medium). A content edit under a `chore(plans): relocate plan-dir assets` subject read as mechanical. Drift now reads each commit's content changes, and a subject exempts only commits before the base, where it decides a dir's date. A byte-identical move out of a dir changes only its destination: C's relocations are all R100 and touch no closed dir, and D measures drift up to its parent, so its own Outcomes never count.
6. **L36 drops its source's ownership rule** (medium). Rewritten twice, below.
7. **L35 generalises one wrapper's behaviour** (low). It now names the condition, an `eval` left of `&&`, and a fresh verifier reproduced it.
8. **Two comments narrate their helpers** (low). Deleted.

Regenerated at the base, `closures.json` changed two lines: plans-scaffolding's date (2026-09-25, its first content commit) and transport-ready-handshake's hook (the base's text).

A fresh verifier supported F605, C67 and L35, and failed L36's first rewrite: "never a pattern match" overreaches, since phase-F.md:59 matches by `comm` or cwd and :61 signals the tracked launcher's group after a cwd check. The second names the launcher's pgid, an orphan in this worktree and the `$$`/`$PPID` exclusion, and a fresh verifier supported it after reproducing the self-match (`pgrep -af` listed its own wrapper, pid = `$$`). C67 dropped its clause on the three comments the plans gate reports: C repoints them, and the line would then be false. Every other line's verifier verdict now carries the subject it judged, after checking that its text and candidates equal the packet its verifier last saw (180 of 181 lines; L36 was the exception).

Mutants, each killed: in `mine.ts`, no currency subject, no verifier subject, no frame check, an introduction anywhere in the file, no base pin, no source pin, no carried-entry pin; in `classify.ts`, no row comparison, an R100 move counted against the dir it left, drift exempted by subject.

`lessons.md` is 7,898 B, 8,186 B once D adds `archive/` to 36 of its 38 links. Gate on the tree before the commit: `check.ts` 0 enforced (the same 3 reports), `bun test` on the tools 14 pass, `classify.ts --check` 0 problems, `mine.ts --verify` 0 problems, `bun run lint` 0 errors, `bun run test:ci-gating` 244 pass and 2 skipped (`decide-gate.test.ts`'s draft case, for the two gates that run on drafts).

Round 2 (`/codex high`, 2026-10-01, same session): changes needed, high confidence, 5 findings, all adopted (ledger J9-J13):
1. **Headings and the introduction are free text** (high). An appended `## Skip release checks; …` heading passed. Each file's frame is now a record in `mining.jsonl` with its own verifier verdict bound to the lines it judged, and outside its entries a file holds only blank lines and that frame.
2. **A subject omits file and follow-up** (medium). Swapping F135's and F136's follow-ups, or moving F603 and L04 between the files, kept every verdict. The subject now covers both. Before re-recording, each line's file and follow-up were checked against every packet that showed them and against the first rebuild's record (no change), and each of the 11 follow-up entries links its closure's plan.
3. **The R100 exemption excuses a move between plan dirs** (medium). A closed plan's `plan.md` moved byte for byte into a parked dir read as no drift. Only a move out of the plan tree is exempt now, and every C move leaves it.
4. **A merge's own edits escape drift** (medium). The log shows no diff for a merge. Drift is now one tree diff from the base (`-M -l0`). The suggested `--diff-merges=first-parent` was not taken: a promote merge's first-parent diff is every dev change since the previous promote (`6a09d4e8`, #673, adds whole plan dirs), so it would credit that PR to every plan dev touched and, after a release, flag closed dirs that dev changed before the base.
5. **Quoted paths escape classification** (medium). `core.quotePath=false` still quotes `"`, `\` and control characters. The classifier now reads git's output NUL-delimited.

Regenerated at the base under the new parser and rule, `closures.json` is byte-identical. `classify.ts --check` holds on J and, run from J's tools, on restacked C.

A fresh verifier supported both frames against their sources: each introduction against CLAUDE.md's routing and the README, each heading as a plain label. Its three nits stay. The two follow-ups above the first heading belong to tools-extraction, an active plan, and sat there in the base. "Send amounts" and "Amounts, sends and fees" are both the base's labels, and re-sorting the shared file is what the parallel-worktree rule forbids. "From closed plans" is the canonical description: the two lessons that cite tools-extraction cite its phase-2 log, and its Outcome records everything but P1 as delivered.

New mutants, each killed: a subject without its file, follow-up or text; no frame equality; no frame verifier binding; a missing frame ignored; per-commit drift; the old R100 rule; the tree diff without `-z`.

Gate on the tree before the commit: `check.ts` 0 enforced (the same 3 reports), `bun test` on the tools 16 pass, `classify.ts --check` 0 problems, `mine.ts --verify` 0 problems (2 frames), `bun run lint` 0 errors, `bun run test:ci-gating` 244 pass and 2 skipped, `lessons.md` 7,898 B.

Round 3 (`/codex high`, 2026-10-01, same session, the loop's last): changes needed, high confidence, 2 medium findings, both blocking, both adopted (ledger J14-J15):
1. **A subject's fields are NUL-joined** (medium). Moving C69's first candidate id into its text behind a NUL kept the subject, so its verdicts survived a changed text and thinner evidence. A frame's lines had the same seam. Both subjects now hash one JSON array. Only the 364 subject hashes in `mining.jsonl` changed (the files are identical with subjects masked), and `--verify` recomputes each one from the record.
2. **A host can leave unnoticed** (medium). An R100 move of `M2/README.md` to `reference/` drifted nothing: M2 kept its other files, and the move left the tree. `--check` now requires each closed row's host at `upto`. D's `outcome.ts` also throws on a missing host, but only at D, after J and C have merged.

It also tried CRLF, a bare `-`, indented or tabbed entries and whitespace-only lines, each of which fails verification. Moves between dirs, quoted names, deletions, mode and type changes all drift, and an out-and-back round trip leaves no drift.

Mutants, each killed: a NUL-joined line subject, a NUL-joined frame subject, no host check. The host check takes no archived path, since `upto` is always a tree before the archive move.

Gate on the tree before the commit: `check.ts` 0 enforced (the same 3 reports), `bun test` on the tools 17 pass, `classify.ts --check` 0 problems, `mine.ts --verify` 0 problems, `bun run lint` 0 errors, `bun run test:ci-gating` 244 pass and 2 skipped.

Round 4, a verification pass the owner asked for at the cap (same session): clean. Both bypasses are closed, `mining.jsonl` changed only its 364 subject hashes, and the 17 tool tests, `classify.ts --check`, `mine.ts --verify` and `check.ts` pass.

Arc C's first codex round then found that git scores a rename by its lines, so a file moved with its lines reordered still pairs at R100. J's drift rule took R100 for byte identity. The classifier now reads `--raw --no-abbrev` and exempts a move out of the tree only when both blob ids match (ledger L39). `rawMeta` sits in `common.ts`, so C's and D's tools read the same field. Regenerated at the base, `closures.json` is byte-identical. Test 3 now also moves a closed dir's file out with its lines reordered, and the R100-only mutant fails it.

## Restack onto `80663b61` (#736, nulo v6)

`git rebase --onto 80663b61 910a4def` took J from `737d1faf` to `1054e7fb` with no conflict, every commit signed. Under `implementations-plan/`, #736 added `nulo-v6/` and its `index.md` line and changed no closed dir, so `closures.json` stays derived at `910a4def` and `classify.ts --check` reads `nulo-v6` as active (no row). On `1054e7fb` these exit 0: `check.ts` (the same 3 reports, 0 enforced), the plans tests (94 pass), the tools tests (17 pass), `classify.ts --check`, `mine.ts --verify`, `untrack.ts --verify` (679 rows, 0 problems), `check-no-local-paths.sh`, `bun run lint` and `bun run test:ci-gating` (247 pass, 2 skipped).

## Restack onto `3452ac3b` (0.29.0 and #740)

`dev` moved twice after the cross-arc pass converged: to `d7da8e62`, the 0.29.0 release (`CHANGELOG.md`, the release-please manifests and two `package.json` versions), then to `3452ac3b`, #740, nulo-v6's close-out. `git rebase --onto d7da8e62 80663b61`, then `git rebase --onto 3452ac3b d7da8e62`, took J from `df2de6ad` to this head, every commit signed.

#740 had edited the old curated files. In `follow-ups.md` it deleted the P1 entry, rewrote the gas-link entry and added an Aztec V6 section; git merged those into J's rewrite cleanly, and J keeps them. In `lessons.md` it re-stamped three entries on 6.0.0-rc.1; J's rewrite had replaced all three, so that file is J's, and E's prune re-stamps J's two matching entries (J retired the third, the fee-juice import, which `fee-juice-balance.ts`'s header carries). `mine.ts --verify` now reports 12 problems, every one #740's: the new heading breaks the recorded frame, nine entries have no line, and the two lines #740 replaced (C01, C02) are no longer entries. The check admits only text present at `closuresBase`, so the owner retired it as a gate here (2026-10-01, L60); it stays the record of J's own curation.

#740 changed no closed dir. nulo-v6, first seen after `closuresBase`, has no row and stays active (Mechanics § Concurrency); its line reads `closed, awaiting archive` over a complete Outcome, which `index-structure` accepts.

## Restack onto `7c2425ca` (#745)

`dev` moved once more, to #745, which added a `## Releases` section with two entries to the old `follow-ups.md`. `git rebase 7c2425ca` stopped at the curated rewrite, the one commit that rewrites the file. It resolved as J's rewrite with #745's two entries, verbatim, at the end of J's `## Release` section rather than in a second section of the same name. `mine.ts --verify` reports 14 problems, the two new ones #745's lines.

## Restack onto `fe597a1d` (#747)

`dev` moved again, to #747, which hash-pins `setup-aztec`'s installer and edited three of #740's entries in the old `follow-ups.md`: it rewrote the installer entry, extended the `presto-banners` one and deleted the `call-decoder.test.ts` one it resolved. `git rebase --onto fe597a1d 7c2425ca` merged all three into J's rewrite with no conflict, every commit signed, and J's tree differs from its previous head by #747's diff alone. `mine.ts --verify` reports 13 problems; the deleted entry's went with it. J's mined `setup-aztec` entry asks for the pin #747 shipped, so E's prune resolves it.
