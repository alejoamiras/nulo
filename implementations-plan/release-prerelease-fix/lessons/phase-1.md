# Phase 1 lessons — research + planning

## Root cause (settled)
The rc cut produced `0.23.0` + a genesis (186-commit) changelog because `v0.23.0`'s commit `50b4145a` is NOT an ancestor of `dev` — the post-release main→dev sync (#146) was **squashed**, so dev got the version content but not main's release commit in its history. release-please couldn't anchor → scanned from genesis; an old `Release-As: 0.23.0` (#142, before the anchor) then pinned the version.

Proven via release-please@17.3.0 `--dry-run` on a throwaway branch: a `git merge -s ours origin/main` (establishes `50b4145a` as an ancestor, dev tree unchanged) + `prerelease-type: "rc.0"` → `0.24.0-rc.0` with a clean 43-commit `compare/v0.23.0...v0.24.0-rc.0` changelog. Two config-only variants (drop `versioning: prerelease`; add `last-release-sha`) did NOT fix it — confirming it's ancestry, not a knob.

## Codex consult (research) → verdict
Diagnosed the branch-ancestry root cause + the fix (rc.0 + history-preserving sync). Verified empirically.

## Codex plan audit → conditional approve (session 019f19d4-540d-7b11-a405-676886c46aa3)
5 findings, all adopted: F1 signed-commit rule on a merge-commit sync; F2 flip runbook/sync-code/tests squash→merge; F3 AUTO_UNSTICK-off ⇒ manual stable sync; F4 verify stable changelog in rehearsal; F5 Phase-3 preflight.

## LESSON: a stale local checkout almost wrote a wrong fact into the plan
While drafting, I asserted (from local file reads) that the repo had NOT restructured and `extra-files` pointed at `packages/extension/package.json`. **Codex contradicted me**, saying `origin/dev` has `apps/extension/package.json` and `packages/extension/` is gone.

Resolution: my local checkout was **3 commits behind `origin/dev`** — the missing commits included `8e919f6a refactor(repo): restructure to apps/ + packages/ + contracts/ (#186)`. Codex read the authoritative `origin/dev` ref; my working tree was pre-#186. I `git pull --ff-only`'d local→origin/dev; both configs correctly target `apps/extension/package.json` on the real tree.

**Takeaways:**
- Before asserting any file-layout / path fact, reconcile `git rev-parse HEAD` vs `git rev-parse origin/<branch>` and check `git log HEAD..origin/<branch>`. A behind-checkout silently lies about structure.
- For authoritative reads when a checkout may be behind, prefer `git show origin/dev:<path>` over the working tree.
- I initially trusted the working tree over both the conversation summary AND codex. The summary was right (it recorded #186). Cross-model disagreement on a checkable fact ⇒ go check the ref, don't pick a side.
- release-please `extra-files` uses `createIfMissing: false`: a wrong path FAILS the PR update (not a silent miss) — so a stale path would have surfaced loudly, but better to never ship it.
