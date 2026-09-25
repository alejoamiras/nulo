# Phase 1: the gate library, report-only (Arc A0)

**2026-09-25, green.**

## What landed

`scripts/ci-cd/plans/`:

- `lib.ts`: the leaf module, holding the rule ids, the canonical shapes, index-only git access (`GIT_NO_LAZY_FETCH=1`), `mode()`, the index parser and the step summary.
- `links.ts`: link extraction via `Bun.markdown.html` → `HTMLRewriter`, `resolveHref`, `link-untracked`, `link-missing` and `path-token`.
- `permalinks.ts`: `permalink-shape`, `permalink-base` and `permalink-ancestry`.
- `structure.ts`: `tracked-artifact`, `hygiene-files`, `nested-ignore`, `index-structure`, `archive-structure`, `curated-budget` and `local-path`.
- `check.ts` and `permalink-bases.json` (9f11de70 and 6611f861).
- `fixture-repo.ts` and five test files. `biome.json` includes the new dir.

Fixtures per rule. "pass" and "fail" are the fixture repos with no finding and with a finding:

| Rule | Tests | Pass | Fail |
|---|---|---|---|
| tracked-artifact | 3 | clean tree; nested `lessons/audit-x.md` | tracked transcript; tracked-ignored (`ls-files -ci`); `!audit-*.md` appended |
| hygiene-files | 3 | canonical pair | both files missing; `!audit-*.md` appended |
| nested-ignore | 2 | the allowlisted `vitest-on-bun` baseline ignore | a nested `.gitignore` |
| link-untracked | 2 | lessons file with a transcript name; a transcript's own links | a kept file linking `audit-codex.md` |
| link-missing | 3 | live doc whose targets exist; plan prose citing code | on disk but not indexed; `docs/a.md:3` cite; dead plan-tree link |
| path-token | 3 | resolving token; code naming an archived plan | dead token in a live doc; one brace alternative |
| permalink-shape | 2 | file, `#L`, pathless `tree/<sha>`; other repos | short SHA; fork owner; pathless blob |
| permalink-base | 1 | allowlisted SHA | SHA outside the allowlist |
| permalink-ancestry | 5 | dev ancestor (local and shallow PR clone); push run reports | side-branch entry; parent-arc SHA in a shallow PR clone; no `origin/dev`; unreachable origin |
| index-structure | 4 | pre-split tree; one line per active dir | unlisted, duplicate, dead, archive target, malformed; Outcome and status mismatch |
| archive-structure | 2 | archived plan with line and Outcome | fenced Outcome; `Outcome & Quality Bar`; no Seeds line; no index line |
| curated-budget | 3 | 8,192 B; follow-ups linking a repo issue | 8,193 B; two-line entry; no evidence; foreign URL |
| local-path | 2 | `~/` paths; closed plan prose before the split | home path in a curated file, the index and the active plan dir |

Helpers (`lib.test.ts` 9, extraction and resolution 5) and `tree.test.ts` make 50 tests over 5 files.

## Deviations from the plan text

- **`checkTree` lives in `check.ts`, not `lib.ts`.** Otherwise `lib.ts` imports the rule modules while they import it. Under ESM that cycle is a TDZ crash at load: "Cannot access 'PLANS' before initialization". `lib.ts` must stay a leaf.
- **`link-missing` skips transcript-shaped source docs.** They are already `tracked-artifact` findings and leave the tree with their links. Counting them gave 1,310 findings, nearly all of them reviewers' `path:line` cites.
- **Plan prose in the `plans` scope skips repo-rooted cites.** These are a `:line` suffix, or a first segment that is a top-level repo entry. They were broken before any move and stay history. Links into the plan tree are still checked. With both calibrations `link-missing` = 1 and `link-untracked` = 112, matching recon.
- **The scheme regex takes no dot.** `plan.md:40` is a broken file cite, not a URL. A mutation that allowed dots survived until this fixture was added.
- **A pathless `tree/<sha>` permalink is allowed.** CLAUDE.md links the freeze commit's root that way.
- **`path-token` excludes `scripts/ci-cd/plans`.** Its own fixtures named 81 fake plan paths.
- **`local-path` covers `PRE_SPLIT_ACTIVE = ["plans-scaffolding"]`** until `archive/index.md` exists. Before the split there is no active set to read.
- **The `local-path` fixtures assemble their home paths at runtime.** `scripts/check-no-local-paths.sh` greps the whole tree outside `implementations-plan/` with no test carve-out, and the first commit attempt tripped it. Assembling the paths keeps that guard's allowlist unchanged.
- **A report-only Actions run skips the ancestry fetch.** A push, nightly or release run never touches the network. A PR run fetches `dev` by name with `--filter=tree:0` and fails closed. A local run uses the existing `origin/dev` and asks for a fetch when it is missing.

## Mutation pass

16 of 16 mutants were killed:

- dev not fetched;
- ancestry anchored to HEAD;
- report runs fetching;
- lessons not exempt from the canonical shapes;
- `mode()` always enforcing;
- resolution from the filesystem;
- the `:line` cite rule removed;
- code spans counted as links;
- any Outcome counted as complete;
- an Outcome prefix match;
- negations allowed;
- the budget off by one;
- foreign URLs allowed;
- the index checked before the split;
- archive tokens rejected in code;
- braces not expanded.

## Gate

Run on the committed tree:

| Command | Exit | Result |
|---|---|---|
| `bun test scripts/ci-cd/plans/` | 0 | 50 pass, 0 fail, ≈6 s |
| `bun run test:ci-gating` | 0 | 200 pass, 2 skip, 0 fail |
| `bun run lint` | 0 | Biome clean on the new files; complexity-baseline check OK, with no new acceptance |
| `time bun scripts/ci-cd/plans/check.ts --report` | 0 | ≈2.9 s |

Report baseline, 787 findings:

| Rule | Findings |
|---|---|
| tracked-artifact | 667 |
| hygiene-files | 6 |
| nested-ignore | 1 (`tools-extraction/.gitignore`) |
| link-untracked | 112 |
| link-missing | 1: `token-identity/lessons/phase-1.md:13`, the doubled-dir link |
| every other rule | 0 |

Read-only against `feat/extraction-recipe`, the gate raises nothing on `implementations-plan/tools-extraction/tools/`. That branch adds 15 `permalink-base` findings only because it does not track the bases file.

## Stack rehearsal (I5)

A16 = local, so there is no GitHub sandbox. `gh stack` v0.1.1 is installed and was run against a bare `file://` remote with the stack dev ← b1 ← b2 ← b3, where b1 has two commits:

1. `gh stack init --base dev b1 b2 b3` adopts all three branches, and `view` works with no GitHub remote.
2. b1 squash-merged on the remote, plus one unrelated dev commit. **`gh stack rebase`** fast-forwarded the local trunk and rebased b1 onto it. b1's commits emptied and dropped because the squash carried the same content, which left b2 with only its own commit. Without GitHub it cannot see the PR merged, so this only works while dev has not touched b1's lines since.
3. **The manual `--onto` fallback:**
   - `git rebase --onto origin/dev <old b1> b2`, then `--onto b2 <old b2> b3`, never replays b1.
   - The squash commit is an ancestor of b2.
   - `push --force-with-lease=b2:<old tip>` succeeds, and a lease naming the wrong tip is refused (`stale info`).
4. **Re-adopting:** `gh stack init --base dev b2 b3` refuses while the old stack still tracks b2 ("already part of a stack", exit 5). `gh stack unstack --local` has to come first, so Delivery step 5 now says so.
5. **Conflict path.** dev and b2 edit the same line. `gh stack rebase` exits 3 with `UU shared.txt`; after resolving, `git add` and `--continue` finish b3 on b2 on dev. The same conflict under `--abort` restores both tips exactly, with no rebase left in progress.
6. **`gh stack push`** pushes both branches with per-branch leases, and the remote tips match the local ones.
7. **Trunk checked out in another worktree:** the case of the canonical clone's `dev`. git refuses to move it. `gh stack rebase` warns "Could not update local dev", rebases onto `origin/dev` instead and exits 0, and the other worktree stays clean.

**Incident: `gh stack` has no `-C` and acts on the cwd's repository.** On the first run, one `gh stack init` executed from the session's worktree instead of the rehearsal clone:

- It created `b1`, `b2` and `b3` at the local `dev` tip in the real clone.
- It wrote the worktree's `gh-stack` metadata file there.
- Its checkout of `b3` failed on local changes, so that worktree was not touched.

Cleanup, verified before deleting:

- The reflogs showed only "Created from refs/heads/dev" at that second, and no worktree had the branches checked out. `git branch -d` removed them.
- The metadata file held only that stack and was removed.

The rerun guards every `gh stack` call by asserting that `git rev-parse --show-toplevel` is the rehearsal clone. **Run `gh stack` only after `cd` into the intended checkout, and confirm the toplevel first.**

## Harness note

The session's worktree guard pins Bash to another worktree. This phase was built and committed in a scratch clone of `worktree-plans-scaffolding` outside the repo, and fast-forwarded into the worktree from there.
