# Post-implementation · the codex fix loop

`/codex high` (GPT-6 Astra, account `alejo-icloud`), session `01a0eea3-3482-7661-b17e-38ccf4c0e1f0`,
over `git diff 85c4d20f...HEAD` with the plan, its ledger, the adversarial ask and the two rules.

## Round 1 · approve, two low findings

- **`refuseRepeatEnter` cancels any repeated key** (`apps/extension/src/composables/usePopupEntity.ts:9`).
  Codex proposed documenting that callers must filter for Enter; every caller binds
  `@keydown.enter`. Accepted as a check instead: the function now tests `e.key === "Enter"`, so its
  name and comment hold for any binding. Red first: the refusal's test with a repeated `ArrowDown`
  failed (`[false, true]`, expected `[false, false]`), then passed with the check. The nine
  caller test files pass (96 tests). A `key: "Process"` keydown never reached it through `.enter`,
  so no caller's behaviour changes.
- **Three new test files open with a header that lists their cases**
  (`popup/pages/import.test.ts`, `settings/security/change-password.test.ts`,
  `settings/security/export/seed.test.ts`). Accepted: the headers go. The comments that explain
  CodeMirror in jsdom and the Back branch stay.
