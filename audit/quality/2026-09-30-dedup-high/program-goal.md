# Harden-dedupe program brief

The full brief behind the `/goal` that ships the 2026-09-30 duplication findings. Re-read it at every phase boundary and after any context compaction. Where it conflicts with a memory note, this brief wins for this program; where it conflicts with CLAUDE.md or AGENTS.md hard limits, those win and the conflict is surfaced.

**Inputs.** Quality run: `audit/quality/2026-09-30-dedup-high/` (`report.md`, `findings/consolidated.md`, `findings/verified.md`, `stakeholder.json`). Matching bugs run: `audit/bugs/2026-09-30-ext-high/`. Both directories are untracked in the canonical clone: copy them into the worktree and commit them in the first arc.

## Authority (the owner's fresh OK for this program only)

- Consult Codex and Opus agents without asking. Commit, push arc branches, and create `harden-dedupe` from `origin/dev`.
- **Squash-merge arc PRs into `harden-dedupe` without the owner** once every gate below is green on the arc's head SHA and the Codex fix loop has converged.
- Never merge anything into `dev` or `main`, never use `--admin`, never force-push a branch someone else touched, never change rulesets or branch protection.
- Scope is the dedup findings Q-01…Q-27, plus the bugs they fix directly: B-08 via Q-05, B-09 via Q-04, B-12 via Q-03. Every other bug or security item goes into the final report as a follow-up, never into code.
- Same-family agents run on Opus (`model: 'opus'`), never Fable. Blueprint tiers are capped at **mid**.

## Phase 0: re-baseline

`dev` has moved since 2026-09-30 (25+ commits, including #748 execute, #752 dApp and #754 home).

1. Home into worktree `harden-dedupe` (`EnterWorktree`), register it in `~/.agents/workspaces.md`, run `bun install`, then read `implementations-plan/lessons.md` and `follow-ups.md`.
2. Re-verify every Q-01…Q-27 finding against current `origin/dev`: re-grep the instances, fix shifted lines, and mark each finding still-valid / partly fixed / fixed / changed shape. Look hardest at Q-02, Q-06 and Q-07.
3. Record the duplication baseline: `bun run audit:dup` (3.90% on 2026-09-30, about three quarters test↔test) and the scoped production jscpd figure the audit used (2.0%; command in `raw/jscpd-production.md`).
4. Docs drift from the 2026-10-02 protection change: `extension-smoke-e2e-firefox-status` and `extension-network-e2e-firefox-status` are now **required on `dev`** (applied with `scripts/ci-cd/required-checks.sh --add`; `main` unchanged). Open ONE small PR **into `dev`** that updates every place that still calls them advisory: CLAUDE.md (§ Branching, § In CI, the staged-rollout table, the Firefox post-merge checklist), `CI.md`, `.github/README.md`, and the "advisory lane" comments in the two Firefox workflows. Leave that PR green for the owner to merge; it is not part of the stack.

## Phase 1: batch

- Group the still-valid findings into batches that ship together:
  - group by shared files and shared helpers;
  - honour the report's "ship together" pairs;
  - put a helper's creation before its consumers;
  - order from lowest risk and most mechanical to riskiest.

  One batch = one arc = one PR, reviewable in one sitting.
- Give each batch a tier, with a one-line reason:
  - **NONE**: mechanical extract with no behaviour change; the Codex fix loop is the review.
  - **LIGHT**: bounded, one subsystem.
  - **MID**: crosses packages or layers, touches a security-relevant guard (Q-02 authwit/selector, Q-07 hostname), or touches persisted state.
- Write `implementations-plan/harden-dedupe/plan.md` as the program index: batch table (id, findings, tier, arc order, UI impact yes/no), the delivery model, and the gate list.
- Have Codex (xhigh) and one Opus agent critique the batching before building. Settle disagreements on the merits and log them.

## Phase 2: per batch, in arc order

1. **Plan.** LIGHT/MID: `/blueprint <tier>`, with the plan in `implementations-plan/harden-dedupe-<batch>/` inside the umbrella worktree. This is a deliberate deviation from one-worktree-per-plan; note it in each plan. NONE: a short section in the program `plan.md`.
2. **Questions go to a panel, not the owner.** The panel is Codex (xhigh) plus one Opus agent. Resolve each question from code, docs, CLAUDE.md, owner precedents in memory, and the stronger argument. Record every question, both answers and the call in the plan's "Decisions (delegated)" section. Surface instead of deciding only when the answer conflicts with CLAUDE.md, a hard limit or this brief.
3. **Build** on an arc branch stacked on the previous arc (`gh stack`, base `harden-dedupe`). Validate after each step. Add tests inline: the smallest set that proves the shared helper, and that each consumer's behaviour is unchanged.
   - Respect the layer rules.
   - Respect the complexity baseline: rerun `bun run baseline:complexity` when you touch an accepted function, and never add a suppression.
   - Preserve every testid.
   - Follow the comment rules.
4. **Codex fix loop** on the arc diff, with adversarial review requested, no over-engineering and no scope creep. **At most 5 rounds**; if it has not converged by then, stop and surface that arc.
5. **Open the PR** ready for review, not as a draft, so the Firefox lanes run. Add the `e2e:extension-smoke` and `e2e:extension-network` labels AFTER opening, never in `gh pr create`.
6. **Merge gate into `harden-dedupe`.** Every check below must be green on the arc's head SHA, the same bar `dev` now enforces:
   - `quality-status`
   - `extension-smoke-e2e-status`
   - `extension-network-e2e-status`
   - `extension-smoke-e2e-firefox-status`
   - `extension-network-e2e-firefox-status`
   - local `bun run audit:vue` and `bun run test:all`

   A red check is either a genuine flake, which you re-run once and log, or real breakage, which you fix. Never make a check advisory and never skip one. Merge with `gh pr merge --squash`.

## UX rules (extra care)

- **Every arc that touches a `.vue` file or CSS must be pixel-identical.** Capture before/after screenshots of each touched surface:
  - Chrome and Firefox;
  - dark and light theme;
  - every state the change reaches (empty, loading, error, filled).

  Save them in `implementations-plan/harden-dedupe/shots/<batch>/`. Any diff that isn't zero is a bug in the refactor; fix it.
- **Drift is never resolved silently.** Where the copies already disagree, unifying them changes behaviour: Q-06 History vs Home network/profile guards, Q-08 `autocomplete`, Q-09 trimmed names, and any others found. Put every such change in its own "behaviour alignment" arc at the TOP of the stack, so the owner can drop it.
  - The panel proposes the behaviour, and you implement it.
  - Label it "delegated, pending owner sign-off" in the plan and the PR body, with before/after screenshots.
  - A Codex or Opus approval is never owner sign-off (CLAUDE.md § UI changes).
- Copy follows Nulo's rules: no clause-joining em dash; CONSENT/legal strings untouched.

## Dev drift

- Whenever `origin/dev` moves, and at the latest between arcs, merge `dev` into `harden-dedupe` with a merge commit (`chore: sync dev → harden-dedupe`).
- Then restack the open arcs onto it one at a time with `git rebase --onto` (never `gh stack rebase`), rerun the gates, and log the conflict resolutions.
- Reconcile `implementations-plan/index.md`, `lessons.md` and `follow-ups.md` against `dev` by reading them, never by trusting a clean merge.

## Finish

1. When all arcs have landed: sync with `dev` one last time, then open ONE PR `harden-dedupe → dev`, titled as a Conventional Commit of 93 characters or fewer. Run every gate on it, with the labels added after opening. **Leave it green and unmerged.** The owner merges it with a **merge commit**, which keeps each arc's signed squash on `dev`. Note in the PR body that this is the agreed one-off exception to dev's squash convention.
2. Close the plans per AGENTS.md: an Outcome block in each plan, promote lessons, move follow-ups, and `git mv` into `archive/`. Do all of it inside the program, before the final PR.
3. Publish ONE private Artifact, "Harden Dedupe Program". Republish with `root` + `files` so the screenshots upload, then check `scope=files`. It contains:
   - what shipped per arc, with PR links;
   - duplication before/after (`audit:dup` and the scoped figure);
   - findings dropped or deferred, and why;
   - every delegated decision, grouped, with the panel's reasoning;
   - an owner decision page for the behaviour-alignment arc: at most about five calls, each with before/after screenshots and a recommendation, then one blanket sign-off line;
   - risks the owner should know;
   - Codex outages and gate flakes, logged.

## Stop and surface (park that batch, continue with independent ones)

- The same non-review step fails 3 times.
- A Codex fix loop passes 5 rounds without converging.
- A gate is red twice for the same real cause.
- A Codex or Opus suggestion conflicts with CLAUDE.md, a hard limit or this brief.
- A finding turns out to need a protocol, storage-shape or account-freeze change.
- Codex is logged out on every account.

Log each one in the batch's `lessons/`.
