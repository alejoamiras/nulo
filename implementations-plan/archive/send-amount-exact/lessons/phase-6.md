# P6 · A paste reads as typing does (F-1)

The owner's `paste` answer ("fix", 2026-09-29): the clamp cuts the purged value, not the typed
text.

## Red, on the handler as built (`0435406a`)

`bun --bun vitest run src/popup/pages/send-amount.test.ts src/components/composite/send/AmountCard.test.ts`
from `apps/extension`: 4 failed, 76 passed. Each failure is the raw clamp:

- "1.234,5678901" (6) rests as "1.234,56", expected "1.234567" (the owner's example);
- "12ab.1234567" (6) rests as "12ab.123456", expected "12.123456";
- "1.234,5,678901" (6) rests as "1.234,5,", expected "1.234567";
- AmountCard, the same paste with no parent re-render: the input reads "1.234,56", expected
  "1.234567".

The grouped paste "1,234,567.1234567" passes before and after: its purge and its raw text clamp to
the same resting form.

## Fix and gate

`handleAmountInput` clamps `purgedAmount` and compares the hint with it; the one comment above the
clamp now says why the purged value is the one clamped, and the validator's comment no longer
names a paste. Gate: `bun --bun vitest run src/popup/pages/send-amount.test.ts
src/popup/pages/send.test.ts src/components/composite/send/` 193 passed, 8 files; `bun run lint`
exit 0, none of its warnings in the changed files. ✓

Since the purge only removes characters and keeps every ".", the purged fraction is never longer
than the typed one, so the clamp now fires for the same pastes or fewer: "1.23,4,5,6,7" (6) used
to clamp to "1.23,4,5" with the hint and now reads "1.234567" with no hint, which is the owner's
rule (only digits and the point).
