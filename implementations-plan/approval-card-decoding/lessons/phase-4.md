# Phase 4 — flat layout, owner-picked

Commit `600c99ba`.

## The owner's read of revision 1

"There is something weird with the padding (the thing with the left-border)" and "even if we know
the details maybe it should be toggable? it's too much info maybe?"

## Diagnosis

Structural, not cosmetic: `.prop` is a key/value row whose `:last-child` is right-aligned, and the
argument block sat inside that right column with its own `border-left` + `margin-left` + padding —
an indented block floating in the middle of the card.

## Two options offered (artifact revision 2)

A: one plain-words headline per call ("Send **5 USDC** to 0x77e1…0b3d") with everything else behind
a `Details` toggle. B: the alignment fix alone, every row visible.

Owner: "Ok, let's do flat, nevermind. […] It's good enough!" → B.

## What landed

- `CallArguments.vue`: `.block` is full width; every row `justify="between"` + `.row` (value
  right-aligned, `min-width: 0`).
- `OperationCard.vue`: `Payload` is a `.group` label; each `aztec_sendTx` call is a `.call` stack
  (name left, `on <address>` right, hairline between calls); the discovered-authorizations wrapper
  and the createAuthWit `Arguments` block use `.group` instead of `.prop`; `.structured_args` lost
  its border and indent.
- `send_transaction` keeps its legacy `Payload:` prop row (out of scope).

## Gate

`bunx vitest run src/popup/windows/execute` 12 files / 90 tests; `bun run typecheck`; root
`bun run lint`; `bun run --cwd apps/extension build` — all exit 0 on `600c99ba`.
