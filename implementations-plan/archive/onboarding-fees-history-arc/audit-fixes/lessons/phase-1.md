# P1 lessons — sanitize widening + apply at every dApp-label surface

## Outcome

`fix(activity): widen sanitize-subtitle gate to scheme: prefix + apply at every dApp-label surface` —
typecheck clean, 2049/2056 vitest passing (+8 sanitize regex cases + 1 builder pin), 47/47 in
`journal-state.test.ts`.

## What shipped

- `journal-state.ts:sanitizeJournalSubtitle` regex widened from `^[a-z][a-z0-9+.\-]*:\/\/` to
  `^[a-z][a-z0-9+.\-]*:` (scheme + colon; no `//` required). Now brackets `mailto:`, `tel:`,
  `javascript:`, `data:`, `http:evil`, `chrome-extension:abc`.
- `journal-state.ts:buildJournalTerminalCardProps` wraps `op.subtitle` with `sanitizeJournalSubtitle`.
  Per-codex M2 — `display.subtitle` (wallet-controlled, from `failedSubtitleFor`) is NOT sanitized.
- `RecentActivityView.vue:executingOriginLabel` wraps `executingTask.value.origin?.name` with
  `sanitizeJournalSubtitle`. The orphan-fallback awaiting cards at lines ~716–724 and ~770–777 bind
  this same computed, so the wrap covers all three render sites.
- `RecentActivityView.vue:cardOriginLabelFor` wraps `op.subtitle` with `sanitizeJournalSubtitle`.

## Tests

- 6 new regex cases (mailto / tel / javascript / data / http:evil / chrome-extension: no-slashes).
- 3 false-positive pins (timestamp 12:34 unchanged — digit prefix; word-with-colon `note:` bracketed;
  CSS-like `color:red` bracketed). Documents the trade-off so a future regex-tighten PR doesn't
  silently break the schemeful coverage.
- New `buildJournalTerminalCardProps` test pin: `dapp_execute` with `subtitle: "https://evil.com"`
  → `originLabel === "[https://evil.com]"`.

## What broke during impl (and the fix)

### `12:34` test name was misleading

First wrote `test("(FALSE POSITIVE PIN) timestamp 12:34 → bracketed", ...)` but the assertion was
`toBe("12:34")` (unchanged). The digit-prefix case isn't a false positive — RFC 3986 scheme grammar
requires ALPHA first, so `12:34` correctly passes through. Renamed the test to reflect that and
added a comment explaining the grammar constraint.

**Generalisation:** when widening a regex and writing "false positive" pins, double-check each
case actually matches the new pattern. The 12:34 case fails the matcher; the `note:`/`color:red`
cases pass — those are the real FP pins.

## Files

- `packages/extension/src/utils/journal-state.ts` (regex + builder wrap)
- `packages/extension/src/utils/journal-state.test.ts` (+9 cases)
- `packages/extension/src/popup/components/modules/general/RecentActivityView.vue` (import +
  executingOriginLabel + cardOriginLabelFor)

## Open items

None — P1 is self-contained. Next phase: P2 (humanizeErrorKind).
