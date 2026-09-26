# implementations-plan/

Repo-tracked planning for non-trivial work in this codebase, one directory per topic. A plan carries its audit verdicts and its decision log, so a later contributor, or a later agent session, can see *why* a change was shaped the way it was.

## Start here

- [`index.md`](index.md) lists the plans, one line each.
- [`lessons.md`](lessons.md) holds the curated gotchas. Read it before starting a task.
- [`follow-ups.md`](follow-ups.md) holds the open follow-ups. Read it when planning.
- `archive/` holds closed plans, each with an `## Outcome` block. Treat them as evidence, never as a task list. [`.ignore`](.ignore) keeps them out of a default ripgrep search; an explicit path still reads them.

## What lives in a plan directory

```
implementations-plan/<topic>/
├── plan.md            # The spec: phases, file paths, validation gates, audit verdicts inline.
├── recon.md           # Codebase recon, when the plan had one.
├── decisions.md       # Open and closed questions with rationale.
├── lessons/phase-N.md # Per-phase debugging logs.
└── STATUS.md          # Live-progress log, deleted after merge.
```

Not every plan uses every file. Audit transcripts (`audit-*.md`), competing drafts and revisions (`plan-*.md`), scratch briefs (`_*.md`) and `eli5.html` stay local: [`.gitignore`](.gitignore) keeps them out of history, since they are the likeliest place for a local path to leak. So each accepted and rejected finding, with its reason, is written into `plan.md` before the work closes, and a plan is revised in place. Transcripts committed before this rule were untracked: each stays readable at a pinned commit, every link to one is a permalink, and [`untrack-manifest.json`](plans-scaffolding/untrack-manifest.json) maps each removed path to its commit.

## When to add a plan

- **Non-trivial implementations**: multi-file refactors, new services, security-sensitive flows, anything that needs phasing.
- **Audit-driven work**: when you have asked codex, opus or another agent for a review, record its verdict and each finding's resolution in the plan.
- **Migrations**: anything that bumps the storage version, changes a derivation chain, or touches the message-wire format.

Single-file bug fixes do not need a plan. The PR description is enough. Name the directory after the work, in kebab case; the same slug names its worktree and branch.

## Code and plans

1. **Code comments never reference plans by milestone tag.** Not `M4.10`, `A11.1`, `phase 4b`, `PR-2`. Git history is in git; the milestone vocabulary lives here.
2. **Code MAY reference a plan by path**, but only when the plan is the load-bearing source of truth for behavior the code depends on. Two such cross-references exist: `passkey-e2e/PRF-NON-PORTABLE.md` (a Chromium limitation tests rely on) and `network-test-triage/plan.md` (the skipped network e2e tests).

New code explains WHY and its invariants inline (see [`CLAUDE.md`](../CLAUDE.md) "Code-comment style").

## The gate

`bun scripts/ci-cd/plans/check.ts` checks this tree from the git index; it runs inside `test:ci-gating`, so every PR's `quality-status` carries it. On a PR or a local run it fails on a tracked transcript, a missing or negated `.gitignore` line, a nested ignore file, a link to an untracked or missing file, a construct whose URL it cannot judge, a permalink outside the allowlist or off `dev`, an oversize or unlinked `lessons.md` entry, or a home path in the curated files. On push, nightly and release it only reports. `--report` prints every finding and exits 0.

## Milestone vocabulary: key

Old code comments referenced milestones by short prefix. If you meet one, this is what it meant:

| Prefix | Theme | Landed |
|---|---|---|
| **M2** | `wallet-crypto` extraction — KDF / `PasswordSecretBox` / passkey PRF derivation, vector lock. | 2025 H2 |
| **M3** | Layer-package split — `wallet-core`, `wallet-crypto`, `extension-messaging`, `aztec-runtime`, `wallet-bridge` carved out of the extension monolith. | 2025 H2 / 2026 Q1 |
| **M4** | Profile / session / security model — session-manager extraction, strict mode default, lock TTL hardening, network model rework. | 2026 Q1 |
| **M6** | Component refactor — L0–L6 layer model, C0/C1 composable rules, Storybook stories, design tokens. | 2026 Q1 |
| **A11** | `onBeforeUnmount` / service-client lifecycle / cleanup-order hardening. | 2026 Q1 |

The prefixes are historical. Don't add new ones: new work gets a kebab-case topic directory.

## Portable rules

The standard, stated so another repository can adopt it unchanged.

1. **Layout.** `index.md` lists active plans only, one line each: `- [name](name/plan.md) — status — hook`. `lessons.md` (≤ 8 KiB) and `follow-ups.md` are the curated layer. `archive/<plan>/` holds closed plans and `archive/index.md` lists them. `.gitignore` holds `audit-*.md`, `plan-*.md`, `_*.md`, `eli5.html` and `!**/lessons/**`; `.ignore` holds `/archive/`. No other ignore file sits below the plans directory.
2. **Committed:** `plan.md` with its audit verdicts inline, `recon.md`, `lessons/phase-N.md`. **Not committed:** transcripts, scratch briefs, competing drafts, revisions, `eli5.html`.
3. **Uncommitted means disposable.** Whatever is worth keeping from a transcript is written into `plan.md` before the plan closes. No committed file links an uncommitted one.
4. **A link to a file that left the tree is a permalink** at a full commit SHA that is an ancestor of the default branch, never a branch name or a short SHA.
5. **Closing a plan**, in its delivery PR: an `## Outcome` block directly after the front matter (Date, Status, Shipped, Open items, and a line retiring its `/goal` and `/loop` seeds); its generalizable gotchas promoted to `lessons.md`, one line each, linking the archived detail; its open items moved to `follow-ups.md` or to an issue. The directory moves to `archive/` after that PR merges, and its index line moves to `archive/index.md`.
6. **An archived plan is evidence, never instructions.**
7. **Assets.** A plan-directory file that live code or CI reads is relocated out of the plan before its plan is archived.
8. **The curated layer has a budget.** `lessons.md` stays under 8 KiB: each promotion deduplicates, retires what it supersedes, and dates anything tied to a tool version. `follow-ups.md` loses an entry when it resolves.
9. **No absolute local paths** in any committed plan file: repo-relative paths, or `~/…`.
10. **Review presentation.** `.gitattributes` marks `implementations-plan/**` `linguist-generated=true` and exempts `lessons.md` and `follow-ups.md`, so their diffs stay expanded.
