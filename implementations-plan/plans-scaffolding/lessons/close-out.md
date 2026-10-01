# Close-out (PR E)

E closes this plan in one PR, where the plan had two (E, then F once E merged): the owner's call on 2026-10-01, "then do the archive move + clean up / prune also the lessons on that PR, make the docs PR + merge please" (L58). E prunes the curated files, narrows the guard, writes the Outcome, deletes the migration tools and then archives this directory, each in its own commit.

## `lessons.md`

D left it at 8,189 B against the 8,192 B budget, so each promotion here retires something.

- **Promoted.** `bunx` at the repo root resolves only root dependencies under the isolated linker and takes anything else from npm `@latest`, past the lockfile and the age gate ([phase-7.md](phase-7.md), the vitest 5.0.3 run). `git diff -M` scores renames by shared lines, so R100 is not byte identity, and a pathspec cuts the diff before pairing ([phase-5.md](phase-5.md), [phase-7.md](phase-7.md)).
- **Retired.** A scripted edit with a missing anchor that silently does nothing: generic, and the editing tools now refuse a missing anchor. Agents sharing one worktree's index: the one-worktree-per-task rule and the harness's worktree isolation cover it.
- **Merged.** The two Vue unit-test entries (auto-imports and the `Button` stub; the fake-timer, `mount` and `defineModel` traps) are one entry with both evidence links.
- **Re-stamped on 6.0.0-rc.1.** #740 re-stamped three entries of the file J replaced, and J's restack kept J's file ([phase-4.md](phase-4.md)), so E carries two of them onto J's lines; J had retired the third, the fee-juice import. The `bun test` entry names `@aztec-labs/*`: `@aztec-labs/foundation`'s `dest/curves/bn254/field.js:413` still calls `expect.addEqualityTesters` at load. The node-client entry says 4xx: `dest/json-rpc/client/fetch.js:45` throws `NoRetryError` for a 4xx and a plain `Error`, which the client retries, for anything else.
- Eight entries and the header reworded shorter, meaning unchanged. 34 entries became 33, at 8,161 B before the move and 8,185 B after it, once its three links into this plan gain `archive/`. `bun run lint` still prints 20 of its 31 standing diagnostics (28 warnings, 3 infos), so that entry holds as written.

`mine.ts --verify` stopped gating at J's restack onto #740 (L60); on E's curated files it reports 46 problems: J's thirteen, from the text #740, #745 and #747 added, and 33 from E's curation, F401 the resolved `setup-aztec` line among them. The mining record is evidence of J's curation, not a gate.

## `follow-ups.md`

- **Resolved:** the plans-scaffolding/ux-feedback entry. J lists ux-feedback closed, and D archived it with both design scripts' depth fixed (`shots.mjs:11` `../../../..`, `build.py:9` `parents[4]`). J's mined `setup-aztec` entry is resolved too: it asks for the installer pin #747 shipped, and #747's rewritten V6 entry keeps what stays unpinned.
- **Kept as `dev` wrote them:** #740's P1 deletion, its rewritten gas link and `## Aztec V6`'s entries, of which #747 rewrote one, extended one and deleted the one it resolved, leaving seven; #745's two release entries, which J's restack placed in its `## Release` section.
- **Added:** the five files whose stale paths no arc could edit (the two C moved byte for byte, and the three npm-staged `packages/wallet-crypto/src` sources whose holds `PATH_TOKEN_ALLOWLIST` keeps); the A4 scrub, which waits on counsel: 21 archived files hold 146 home paths by the gate's `LOCAL_PATH_RE`; and nulo-v6's archive move. nulo-v6 is newer than `closuresBase`, so the split kept it active, and this arc does not edit that plan.

## The guard

`check-no-local-paths.sh` exempted all of `implementations-plan/`; it now exempts `archive/` only (L57). On E's tree before the move it finds nothing, so every commit from here scans the active plans, the indexes and the curated files.

## The tools

`tools/`, 22 files of migration code and tests, leaves in its own commit before the move (L61, the owner's call). Nothing outside this directory imported, ran or linked it, and CI never ran its tests. Its data stays here: `closures.json`, `untrack-manifest.json`, `mining.jsonl` and the two GitHub snapshots; the code stays readable in D's squash commit on `dev`. `untrack.ts --verify` ran on the commit before the deletion, which it would otherwise read as the nine tool files `dev` holds leaving without a row.

## The move

`git mv` moves the directory's 16 remaining files to `archive/plans-scaffolding/` in a renames-only commit, each keeping its blob id and mode. The next commit repairs the links the extra level broke, with `repair-links.ts` run from a checkout of D's head, and moves the index line to `archive/index.md` in the generated format.
