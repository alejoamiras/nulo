# Phase 1 — facts, copy, review state

Date: 2026-09-21. Gate: `bun run --cwd apps/extension test src/components/composite/send/publish-facts.test.ts src/composables/useSendReview.test.ts src/popup/components/modules/send/fee-privacy.test.ts` → 3 files, 72 tests green · `bun run lint` → 0 errors (30 warnings, 5 infos, all pre-existing; the touched files check clean on their own) · `bun run --cwd apps/extension typecheck` → exit 0.

## Deviations from plan.md (implementation-level, no scope change)

- **`useSendReview` takes `isOpen` as a getter and watches both getters itself** (`watch([isOpen, isGated], …, { flush: "sync" })`) instead of exposing `onOpened` / `onFactsChanged` / `onClosed`. Reason: three calls the page could forget or misorder become zero; a sync flush closes the window in which a send turns gated while `ready` is still true. The two sources are watched as separate getters, not one tuple, so a `facts` recompute that lands on the same answer (a fee re-estimate) does not restart the 800 ms. The `now` option is dropped — a timer alone is enough, and nothing reads a deadline.
- **`authorises(source)` no longer takes `isOpen`**: `ready` is false whenever the sheet is closed (same sync watcher), so a second open-check inside the composable would be a mutant no test could kill. The page's own open-check (`(source === "review") !== reviewOpen`) is the independent guard T13 exercises.
- **`PublishFacts.recipient` / `.amount` are `SideVisibility` (`hidden | public`)**, not the four-valued `Visibility`; `FACT_WORDS` is typed per cell. The strip and sheet render `you` with four words and the other two with two.
- **`rowSentence(cell, facts, payer)` and `paidBy(payer, type)` added** to `publish-facts.ts` so the sheet holds no copy logic — the sheet stays a dumb renderer.
- **T2's real-`settingsForMethod` table lives in `fee-privacy.test.ts` (L4)**, importing `payerKindOf` downward, rather than in the L3 test importing `fee-helpers` upward. Lint would have allowed the upward test import; the direction is kept honest anyway.

## Notes

- The root `bun run typecheck` script cannot find `vue-tsc` under the isolated linker on this box; the workspace script `bun run --cwd apps/extension typecheck` is what the gate means (and what `typecheck:all` runs).
- `NOTICE_TITLE` stays in `fee-privacy.ts` until phase 4 deletes the row; the bodies moved now, so the sheet and the row read the same string from one place in between.
