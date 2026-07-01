# Phase 1 lessons — throwaway full-lifecycle validation (nulo-release-rehearsal)

Venue: `alejoamiras/nulo-release-rehearsal` (made PUBLIC to enable rulesets, per user). release-please **17.3.0** via `bunx`. The throwaway already mirrored the bug structurally: latest stable tag (`v0.5.0`) is on `main` but NOT an ancestor of `dev`.

## What was validated (the FIXED lifecycle works end-to-end)

1. **Bug reproduced.** After resetting dev to share pre-`v0.5.0` history (so a genesis scan is visible), the buggy prerelease dry-run logged `⚠ No latest release pull request found` + `Considering: 14 commits` (genesis) — vs the ~4 real commits since v0.5.0. (The real repo additionally shows the WRONG-VERSION symptom because a `Release-As` footer sits in its genesis range; the throwaway has no footer so its version stayed correct — symptom (a) is proven on real data, symptom (b) here.)
2. **Fix verified.** A history-preserving merge of `main` into `dev` (establishing `v0.5.0` ancestry) made release-please anchor cleanly: the warning disappeared, `Considering` dropped 14→10 (the 4 excluded = pre-v0.5.0 genesis commits), version `0.6.0-rc.0`. `prerelease-type: "rc.0"` gives the counter suffix.
3. **rc.0 → rc.1 increment WORKS** (the part a dry-run cannot prove — needs a real tag). After tagging `v0.6.0-rc.0` + a new feat, the next cut produced `0.6.0-rc.1` (`✔ updating from 0.6.0-rc.0 to 0.6.0-rc.1`).
4. **v4 abort bug + manual unstick reproduced faithfully.** The rc.1 cut first **aborted** with `⚠ There are untagged, merged release PRs outstanding - aborting` because I tagged rc.0 but forgot to relabel the rc.0 PR `autorelease: pending → tagged`. Relabeling unstuck it → rc.1 PR appeared. Confirms the runbook's tag+relabel unstick is required per rc.
5. **Stable promotion NOT poisoned by rc tags (codex Q4).** After promoting dev→main, the stable channel (manifest 0.5.0) cut `chore(main): release 0.6.0` — `-rc` correctly dropped, anchored `compare/v0.5.0...v0.6.0`, bounded.

## MECHANISM findings (decision-changing — squash-only `dev` ruleset)
Created a ruleset mirroring real dev: `allowed_merge_methods:["squash"]` + `required_signatures` + `non_fast_forward` + PR-required.

- **A squash-only ruleset HARD-BLOCKS a PR merge-commit — for EVERYONE.** Triply confirmed: plain `--merge` → "Merge commits are not allowed on this repository"; `--merge --admin` → SAME block (admin does NOT override the method); RepositoryRole-admin **bypass actor** + `--merge` → SAME block. → **The user's chosen "bypass actor" mechanism does NOT work for PR-merge.** Only adding `"merge"` to `allowed_merge_methods` lets a PR merge-commit land (verified: with `["squash","merge"]` the signed sync PR #6 merged → `v0.5.0` became a dev ancestor).
- **BUT a bypass actor CAN push a signed merge commit DIRECTLY to dev.** The method restriction governs only PR merges. With squash-only + PR-required + signatures + admin-bypass, `git push origin dev` of a signed 2-parent merge commit SUCCEEDED ("Changes must be made through a pull request" was printed, but the bypass overrode it). → **A bypass-actor DIRECT-PUSH sync is viable and preserves squash-only PR enforcement.**
- **`--admin` is needed to squash-merge a release-please PR in the throwaway ONLY because the PAT-created release commit is `unsigned` (`verified:false`) and `required_signatures` blocks it pre-merge.** The REAL repo's App-authenticated release PRs are bot-verified → squash-merge passes WITHOUT `--admin`. Confirmed: a **signed** human feature PR (#13) squash-merged cleanly, no `--admin`.
- **SSH-signed commits are GitHub-verified** (`verified:true,reason:valid`) once `user.signingkey` is set; local `%G?`=N is just a missing `gpg.ssh.allowedSignersFile` (cosmetic).
- **required_signatures checks ALL commits a merge introduces**, not just the sync commit (codex F1 generalizes): a real merge bringing `main`'s unsigned history is blocked. Real `main` is signed, so a real-repo merge is fine; the throwaway's unsigned `main` history forced `--admin`/bypass.

## Revised mechanism options (for the user re-decision)
Establishing ancestry FUNDAMENTALLY needs a merge commit on dev — so **dev's history gains periodic sync-merge commits no matter what** (the "dev stays linear" guarantee is inherently relaxed by the fix). Given that:
- **(2a) Allow `["squash","merge"]` on dev; sync via the existing PR-based job (merge, not squash).** Simplest; reuses the conflict-surfacing PR job. Cost: humans CAN merge-commit a feature PR (squash is convention/default, not enforced).
- **(2-direct) Keep dev squash-only for PRs; the bot (a bypass actor) DIRECT-PUSHES the signed sync merge.** Preserves squash-only PR enforcement. Cost: no PR-based conflict surfacing (a real merge can conflict; `-s ours` can't but doesn't bring content); the App needs to be a bypass actor + push.
- The originally-chosen **bypass-actor-via-PR-merge is OFF the table** (method restriction not bypassable).

## Operational gotchas observed
- After a squash-merged release PR, the `release-please--branches--<branch>` head branch is NOT auto-deleted → it blocks the next cut. Delete it (or enable auto-delete) between cuts.
- Transient `401 Bad credentials` on rapid `gh pr merge` mutations (secondary rate-limit on the keyring token) — space out merge calls.
