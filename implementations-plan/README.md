# implementations-plan/

Repo-tracked planning archive for non-trivial work in this codebase. One directory per topic. Plans live next to their audit transcripts and decision logs so future contributors (or future Claude sessions) can understand *why* a change was shaped the way it was.

## What lives here

Each subdirectory captures one body of work:

```
implementations-plan/<topic>/
├── plan.md            # The spec — phases, file paths, validation gates.
├── plan-v2.md         # Revisions, if the plan was re-cut after audit feedback.
├── audit-codex.md     # Codex review of the plan (or implementation), if requested.
├── audit-opus.md      # Opus 4.7 review, if requested.
├── decisions.md       # Open + closed questions with rationale.
└── STATUS.md          # Live-progress log, deleted after merge.
```

Not every plan uses every file. The pattern is suggestive, not enforced.

## When to add a plan

- **Non-trivial implementations** — multi-file refactors, new services, security-sensitive flows, anything that needs phasing.
- **Audit-driven work** — when you've explicitly asked codex / opus / another agent for a review, capture the prompt + response here.
- **Migrations** — anything that bumps the storage version, changes a derivation chain, or touches the message-wire format.

Single-file bug fixes do not need a plan. The PR description is enough.

## Naming

Kebab-case topic name. One topic per directory. Examples in this repo:

- `backup-import-repair/` — the import-flow fix that became PR #71.
- `passkey-modal-export-import/` — Path A migration for the passkey ceremonies (PR #72).
- `network-test-triage/` — live tracker for the e2e network suite failures.
- `passkey-e2e/PRF-NON-PORTABLE.md` — long-form note on the WebAuthn PRF portability limit.

## Retention

Plans **stay** after the work lands. They are the "why was this built like this" archive. Two rules govern their relationship to code:

1. **Code comments do NOT reference plans by milestone tag.** Not `M4.10`, `A11.1`, `phase 4b`, `PR-2`. Git history is in git; the milestone vocabulary lives here.
2. **Code MAY reference plans by path** — but only when the plan is the load-bearing source of truth for behavior the code depends on. Today, two such cross-references exist:
   - `passkey-e2e/PRF-NON-PORTABLE.md` — documents a real Chromium limitation that tests rely on.
   - `network-test-triage/plan.md` — tracks the current set of skipped e2e network tests.

Everything else is history. New code should explain WHY/INVARIANTS inline (see [`CLAUDE.md`](../CLAUDE.md) "Code-comment style"), not point at a plan.

## Milestone vocabulary — key

Old code comments referenced milestones by short prefix. The repo is mid-cleanup; if you encounter one, this is what it meant:

| Prefix | Theme | Landed |
|---|---|---|
| **M2** | `wallet-crypto` extraction — KDF / `PasswordSecretBox` / passkey PRF derivation, vector lock. | 2025 H2 |
| **M3** | Layer-package split — `wallet-core`, `wallet-crypto`, `extension-messaging`, `aztec-runtime`, `wallet-bridge` carved out of the extension monolith. | 2025 H2 / 2026 Q1 |
| **M4** | Profile / session / security model — session-manager extraction, strict mode default, lock TTL hardening, network model rework. | 2026 Q1 |
| **M6** | Component refactor — L0–L6 layer model, C0/C1 composable rules, Storybook stories, design tokens. | 2026 Q1 |
| **A11** | `onBeforeUnmount` / service-client lifecycle / cleanup-order hardening. | 2026 Q1 |

The prefixes are historical. Don't add new ones — new work gets a kebab-case topic directory.

## Plans currently in flight

Live-progress entries (deletable when the work merges) typically include a `STATUS.md`. Check the per-directory contents when you need to know whether a plan is finished or active.
