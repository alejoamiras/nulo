# Phase 6 · C5 · the comment sweep

## What changed

The C5 table's 67 rows as 69 anchored replacements over 41 files (rows 3 and 4 share one block,
row 34 takes two replacements and row 50 three, and row 67's one replacement matches twice), one
commit per area:

| Area | Edits | Files | The area's own check |
|---|---|---|---|
| `apps/extension/src` | 57 | 30 | the 22 touched or colocated test files: 22 passed, 803 tests |
| `packages` | 4 | 3 | `theme-contrast.test.ts` 45 passed; `hardening.test.ts` 39 passed; `pxe/service.test.ts` 13 passed |
| e2e and scripts | 6 | 6 | `browser-seam` and `unresolved-names` scans 45 passed; `shellcheck` and `bash -n` on `agent.sh` exit 0 (comments only, no e2e run needed) |
| workflows | 2 | 2 | `bun run lint:actions` exit 0; the `.github` key-change grep empty |

Before the sweep the tag grep matched 70 lines in 41 files; after it, none.

One deviation from the table's text, under C5's own rule (keep every live claim, correct one the
code contradicts): row 14's comment said the recipient address was persisted "for future tx-detail
views". That view exists: `popup/pages/journal/[id].vue` renders it under "To"
(`journal-detail-recipient`; `recipientLabel` at `:120-127`, the row at `:294-297`). So the rewrite reads "Transfer recipient
address, shown on the journal-detail page; no card renders it." rather than the table's "Transfer
recipient address; no card renders it."

The remainder of the class (F-1), counted after the sweep with the plan's own commands:
`git grep -i -w -E 'codex|opus|fable' -- apps/extension/src packages` matches 174 lines in 81 files
(222 in 94 at `85c4d20f`), and `git grep -E '\bPhase [0-9]|\(P[0-9]'` 160 lines in 60 files (67 files
at `85c4d20f`). Without `-w` the first also matches "spoofable".

## Gate

- `git grep -n -i -e "post-impl" -e "phase 2 follow-up" -- . ':!implementations-plan' ':!audit' ':!architecture' ':!wallets-architecture-research'`:
  no match.
- `git diff -U0 origin/dev -- .github | grep -E '^[+-][^+-]' | grep -v -E '^[+-]\s*#'`: no match.
- `bun run lint`: exit 0 (28 warnings, 3 infos; the two the pre-commit hook printed for
  `PopupManager`, `useOptionalChain` at `PopupManager.vue:64` and `noDelete` at
  `PopupManager.test.ts:439`, are on lines this sweep did not touch).
- `bun run lint:actions`: exit 0.
- `bun run typecheck:all`: exit 0 (83 s).
- `bun run test:all`: exit 0 (170 s), itself, with no isolated rerun. Every workspace passed; the
  only skips are env-gated real-data suites (`aztec-runtime` 2 tests in 1 file; `extension` 4 tests
  in 3 files, plus 8 `todo`; `passkey-rp` 6 tests, its `RP_HOST_LIVE` suite), none in a file this PR
  changes.
- `bun run test:ci-gating`: exit 0, 244 passed, 2 skipped, 0 failed, 17 files.
