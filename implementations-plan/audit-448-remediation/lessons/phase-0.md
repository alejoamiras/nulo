# Phase 0 lessons — landing the audit

## PR #448 unmergeable: unverified base commit vs required signatures

**Symptom:** all three required gates green, `mergeable: MERGEABLE`, no review required — yet `gh pr merge --squash` refused with "base branch policy prohibits the merge" (`mergeStateStatus: BLOCKED`).

**Root cause:** dev's ruleset requires verified commits on every PR commit. The branch's original commit `10f35eb1` was created in a prior session with signing skipped and is `verified: false`; the two later commits (dev merge + adjudication) are verified. The CLAUDE.md § Branching note that "signatures don't independently block" self-authored squashes was verified on an all-signed branch — it does NOT hold when a branch commit is unverified.

**Options weighed:** (A) rebase-amend-sign + force-push the branch (the owner's own documented signature-backfill procedure, owner-solo branch) — rejected: the run's autonomy contract flatly forbids history rewrites/force-pushes, and an autonomous run breaking its own approved prohibition is a worse precedent than a superseded PR number. (B) supersede: squash the branch into ONE signed commit on a fresh branch off dev, byte-identical tree, new PR, close #448 with a cross-reference after the successor merges. (C) halt and wait for the owner — excluded by the goal's zero-intervention directive.

**Codex consult (xhigh, session `01a033ff-1f9a-7dc0-92be-7e6b509e8888`): verdict B**, first round, no iteration needed. Its strongest counter to B — that superseding also interprets intent over contract text, just on the DONE clause — was accepted and mitigated by reporting honestly ("superseded in substance, not literally satisfied") rather than claiming literal completion. Mitigations adopted from the consult: close #448 only AFTER the successor merges; record both tree hashes; verify the successor commit shows `verified: true` on GitHub before merging; keep the #448 branch (no immediate deletion); state in the close-out comment that no ruleset, check, or admin override was bypassed.

**Proof of supersession:** successor commit tree `e74b00149321f7deb6ec6ed72a59ed59b6f0e4b6` == PR #448 head (`a5b7a734`) tree `e74b00149321f7deb6ec6ed72a59ed59b6f0e4b6`. This lessons file is the successor PR's only addition, as its own second commit.

**Durable lesson:** any unattended pipeline that must land a pre-existing branch should pre-flight `gh api .../pulls/N/commits` for `verification.verified` on EVERY commit before counting on a merge — green checks say nothing about the signature rule.
