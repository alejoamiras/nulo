# P9 · A-3: the field at rest shows every digit

The owner's `field` answer ("every", 2026-09-29): once the field is left, its type shrinks until
the whole amount fits, with no 60% floor; while typing, it scrolls as today.

## The probe (Inference 5)

A throwaway script (never in the tree) opened a text input in each browser with `base.css`'s input
reset and the field's type, and read its computed box:

| Browser | Padding (top right bottom left) | Border | Line height |
|---|---|---|---|
| HeadlessChrome 152 | 1px 2px 1px 2px | 0 | normal |
| Firefox 153 | 1px 2px 1px 2px | 0 | normal |

So the strut's `padding-block: 1px` is the input's own, and the input states it too, so a browser
that changes its default cannot split them. Nothing in the popup sets a `line-height` above the
field (`base.css`, `popup/index.scss`, the send page, `Flex`), so the input and the strut both lay
out at `normal` for the same font, size and weight.

## Red, on `1448a6be` plus the tests (no fit in the component)

`bun --bun vitest run src/components/composite/send/AmountCard.test.ts` from `apps/extension`:
3 failed, 48 passed. Each failure is the missing scale: the long amount before and after leaving
(`expected '' to be '1'`, then `'0.37'`), the short one at rest (`expected '' to be '1'`), and the
font load and fiat toggle (`expected '' to be '0.37'`).

## Fix

§ The rebuild, A-3, as planned: `inputRoom` beside `rulerWidth`; `fieldScale` on the token input;
the ruler, the wrapper and its strut; the fit after each render that changes the model, the focus,
the fiat mode or the toggle, and on `loadingdone`. The fit counts the field as typed in only while
it is both marked focused and the document's active element: the fiat input sets the mark and
never clears it, and a window losing focus blurs the field but leaves it active.

Gate: `bun --bun vitest run src/popup/pages/send-amount.test.ts src/popup/pages/send.test.ts
src/components/composite/send/ src/utils/hero-fit.test.ts` 219 passed, 9 files; `bun run lint`
exit 0 (29 warnings and 3 infos, as before, none in the changed files); `bun run typecheck:all`
exit 0.

## The browser

`send-amount-exact.test.ts` through the isolated runner at retry 0, as P7's red runs:

| Browser | Exit | Time | Failed checks |
|---|---|---|---|
| Chrome | 1 | 227 s | only the review's amount line (overflow 147 px at 30 px, P10's) |
| Firefox | 1 | 164 s | the same one, the same numbers |

Every field check passed in both: typed and at rest, the field cannot scroll; after Max with focus
it is at 40 px; left, it cannot scroll, and `send-amount-meta` did not move. The popup's body is
360 px on every surface that shows the send page (the side panel centers it), so its width moves
only with the fiat toggle, which the fit already follows; no resize trigger was added.

`bun run e2e:reap`: nothing to reap. ✓
