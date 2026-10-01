# Lessons — P21 promote-range commitlint relint (RED-policy fix)

The `dev-quality → dev` promote PR (#220) went RED on **Commitlint** the moment it
opened, even though every finding PR had been green. Root cause + fix below.

## Root cause: a squash subject that was never linted as a range until the promote

One historical squash commit — `ea4e22d` (PR #207, P13.2) — had the subject:

```
feat(token): TokenFnDescriptor registry proving byte-identity for all 9 token fns (Q-12 P13.2) (#207)
```

Two commitlint violations, **both on the subject**:
- `header-max-length` — 101 chars. The PR title was 94; GitHub appended ` (#207)` on
  squash → 101. (This is exactly the ≤93 budget CLAUDE.md warns about.)
- `subject-case` — starts `TokenFnDescriptor` (capital `T`).

Why it survived until the promote: a finding PR's own CI lints **its qa-branch commits**,
not the eventual squash subject (which only exists at merge time and is derived from the PR
title). Direct/merge commits on `dev-quality` never re-trigger commitlint. The promote PR is
the **first** time the whole `dev..dev-quality` range is re-linted — so a bad squash subject
sits latent until then. CLAUDE.md § Branching calls this out verbatim.

## The fix: surgical `filter-branch` reword (NOT a weaken)

RED policy forbids weakening the check. The only honest fix is to correct the commit message,
which means rewriting `dev-quality` history (allowed: non-protected arc branch, mine, no other
human, not main/release — CLAUDE.md sanctions "amending + force-pushing the arc branch, which
is only an option on non-protected branches").

New subject (92 chars, lowercase-first):
```
feat(token): token-fn descriptor registry, byte-identity proof for 9 fns (Q-12 P13.2) (#207)
```

## THE TRAP (cost me one wasted rewrite): a stale remote-tracking ref

`git fetch origin dev` **fails silently on SSH-down** (origin is an SSH remote; the arc's
1Password/SSH outage). So local `origin/dev` was **stale** at `5acd6df` while the real remote
`dev` was `cb9f1ff`. My first `filter-branch 'origin/dev..dev-quality'` used the stale boundary
→ the range pulled in commits below the true merge-base → it **forked shared history**
(merge-base moved `8e919f6` → `5acd6df`) and reported a phantom `body-max-line-length`
(from dev-only commits that aren't in the real promote range). Caught it pre-push via the
merge-base check; `git reset --hard` to the backup branch undid it fully.

**Fix for the trap:** get ground truth first —
`git ... ls-remote <https-url> refs/heads/dev` for the REAL remote SHA, fetch it into a
scratch ref (`refs/tmp/realdev`), and use the **true merge-base** (`git merge-base
refs/tmp/realdev dev-quality` = `8e919f6`, = local `dev`) as the `filter-branch` boundary. Then
`8e919f6..dev-quality` is exactly the arc — pre-target commits keep their trees, base untouched,
no fork.

## Verification gate before force-push (all passed)

1. `git diff <backup> dev-quality` — **empty** (content byte-identical; only one message changed).
2. `git merge-base refs/tmp/realdev dev-quality` — **`8e919f6`** (no fork).
3. `commitlint --from refs/tmp/realdev --to dev-quality` — **0 problems** (only warnings).
4. Force-push with an **explicit lease** (`--force-with-lease=refs/heads/dev-quality:<known-sha>`)
   because SSH-down means no auto remote-tracking ref for the HTTPS push URL.
5. Post-push: #220 **Commitlint = pass**.

## Side effect (documented, acceptable): the arc is now unsigned

`filter-branch` re-creates every rewritten commit **unsigned** (it can't re-sign, and the
1Password agent was down anyway). So all `dev-quality` commits — including the previously
GitHub-signed finding-PR squashes — are now `N`. This does **not** block the promote: `dev` is
squash-only, so merging collapses the arc into one GitHub-web-flow-signed squash, satisfying
`required_signatures` (self-authored squash → GitHub signs). Optional owner backfill:
`git rebase --exec 'git commit --amend --no-edit -S' <base>` before merge if signed
dev-quality history is wanted.

## Lessons

- **Budget the `(#NN)` suffix in PR titles: ≤93 chars, lowercase-first subject** — or the squash
  subject silently exceeds commitlint's 100 and the *promote* catches it, not the finding PR.
- **On an SSH-down run, never trust `origin/*` tracking refs.** `git fetch origin` fails silently;
  `origin/dev` goes stale; any range or merge-base off it is wrong. Get the real SHA via
  `ls-remote` over the HTTPS+token path and fetch into a scratch ref first.
- **Before any history-rewrite force-push: back up the ref, assert tree-identical + merge-base
  unchanged.** The merge-base check is what catches an accidental shared-history fork.
