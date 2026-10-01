# Phase 3: the closure table (Arc J)

**2026-09-30, green locally.** Branch `plans-scaffolding-closures`, cut from `origin/dev` at `910a4def` (#735); A0 and A are merged as #696 and #698. `closures.json` records `closuresBase` `910a4def`.

## Snapshots

`gh-prs.json`: 693 of 693 PRs; `gh-issues.json`: 13 of 13 issues; both captured 2026-09-30, totals from `gh api graphql`. Each PR row carries `state`, `base` (`baseRefName`), `mergedAt` and `mergeCommit`, one row per line so a refresh diffs by PR.

## The table

270 rows, one per top-level dir, 0 ambiguous:

| Class | Evidence | Rows |
|---|---|---|
| closed | S1: a merged PR | 173 |
| closed | S2: only the import touched it (38 historical, plus playwright-migration, abandoned) | 39 |
| closed | S3–S15, per dir | 39 |
| closed | the index line already reads `closed, awaiting archive` | 16 |
| active | tools-extraction, plans-scaffolding | 2 |
| parked | transport-ready-handshake (S16) | 1 |

Every closed row outside S2 names at least one PR. 10 rows carry a follow-up id; Phase 4 gives each an entry. 5 dirs have no host (dedup-p1-delete, passkey-e2e, phase-2, pr-8c-mixed-and-fee, reimport-pxe-fence), so D writes them stubs.

## Against the recon

No dir changed class, so nothing goes back to the owner:
- S2 equals recon's Q2 list exactly (39 dirs).
- Recon's 39 non-legacy AMBIGUOUS dirs are the S3–S15 answers, one per dir.
- S1 is recon's CLOSED 114 plus CLOSED-EVIDENCE 59. No S1 dir was first committed after the recon.
- The 17 dirs added since the recon are the 16 closing plans of the UX program and this plan.

## Decisions (ledger L15–L17)

**L15. Mechanical commits.** The plan names the import and #692. A (#698) also touched 178 dirs without changing what any plan says, so dating by it would move 178 dates to 2026-09-26. The classifier skips it and, by subject, the C and D squashes to come. Drift is a substantive commit in `closuresBase..upto`, not `git diff --quiet`: C's relocations would otherwise read as drift in every dir they touch once C lands. `--check [file] [upto]` takes D's refreshed base as `upto`.

**L16. Which PRs a plan delivered.** The first cut credited every merged `#N` in a dir's index line or commit subjects. Auditing its PR lists found four errors:
- **Context PRs.** Rows credited PRs merged before the plan existed: `pre-#186`, `post-#83`, `follow-up to #7`, `the two Send follow-ups #718 left`, `PR #110 fixed sendTx only`.
- **Another repo's PRs.** tools-extraction took `unleashed#1–#4, #7, #8` as nulo PRs.
- **Subject text.** Numbers inside a subject were read as claims: `(#288 context)`, `add ledger #35`.
- **Missed squashes.** Three dev squashes lost their `(#N)` suffix, so #72 (journal-stage-restructure) and #89 (private-fuel, swap-fuel) were missed.

The rule now:
- A squash that touched the dir counts, found by the snapshot's `mergeCommit`, else the subject's trailing `(#N)`.
- A PR the dir's line names (else its host) counts if it merged after the dir's first commit.
- Two exemptions:
  - A PR merged into a stack branch, not `dev` or `main`: its content reached trunk later through another squash (#474 and #478 into `log-safety/*`; #139 into `dev-quality`).
  - A PR merged up to 2 minutes before that commit, as part of the same stack merge (#639 and #640, 7 s and 3 s before #641).

Against the first cut, 27 rows changed. 6 PRs were added: #72 in the four dirs its squash touched, #89 in two. 35 were dropped. 32 of them were context. The other 3 were deliveries that merged into `dev` well before the dir's first commit. They are accepted as omissions, for two reasons: they show in the kept hook text, and no time threshold separates them from context PRs merged 45 minutes before a plan began (#187, #248). The three:
- #405 in deflake-round-4 (45 minutes before);
- #494 in cognitive-shallow-tail (35 minutes before);
- #321, the 0.26.0 release PR, in stable-release-0.26.0 (10 hours before; the plan was written afterwards).

A check for PRs named after a plan's last commit found none.

**L17.** Ranges are not expanded: `#400-#405` credits #400 and #404 (the squash), not #401–#403.

## Tests

`classify.test.ts` covers the plan's fixture list in two tests:
- the `#172 deliberate-red` and `gated on tag-integrity` texts;
- an issue number and a stack id (neither is a PR);
- a duplicate index line (one row, the later hook);
- a `STATUS.md` Outcome as the only evidence;
- a row-less dir (reported active, not a problem);
- a short snapshot;
- drift from a substantive commit next to a mechanical one;
- the L16 rules: a squash without a number, a context PR, a stack-branch PR, and the 2-minute slack against a PR 10 minutes early.

Mutation check: turning off the slack, the stack-branch exemption, the `mergeCommit` lookup or the mechanical-drift filter each fails a test.

## Open for D

- tools-extraction stays ACTIVE (P1 is pending in `follow-ups.md`), but its host has an incomplete Outcome block. After the split, `index-structure` reports that as an error until the tools-extraction session completes or reopens it; coordinate at D.
- 7 closing plans have Outcomes missing a field: backup-import, copy-polish, dapp-grants, failed-send-check, keyboard-guards, layout-polish and wallet-safety-fixes. `outcome.ts` appends the missing fields.

## Gate

| Command | Exit | Result |
|---|---|---|
| `bun test implementations-plan/plans-scaffolding/tools/` | 0 | 10 pass |
| `bun implementations-plan/plans-scaffolding/tools/classify.ts --check` | 0 | 270 rows, 0 problems |
| Biome over the tools (stdin, repo rules) | 0 | clean |
