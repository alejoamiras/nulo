# Phase 3 · Send's loading token card (D3)

## Red first

The new cases in `SelectTokenCard.test.ts`, `send.test.ts` and `send.integration.test.ts` ran
against the P2 commit's `send.vue` and `SelectTokenCard.vue` (86 tests): 14 red, 72 green, and two
unhandled rejections (`Error: port closed`, the refused mount read reaching nothing that caught it).

The cases the gate names:

- Step 3, the real card (`send.integration.test.ts`): a tap during the load opened the import
  popup, `expected true to be false` on `popupStore.isOpened("new_token")`.
- A → B: `expected { loading: 'false', symbol: 'TST' } to deeply equal { loading: 'true', symbol:
  undefined }`: A's token stayed on the card through B's load. The balance guard passed (no
  `TypeError`), as a preservation guard should.
- The two foreign-event cases, same shape: `{ loading: 'false', symbol: 'TST' }` during B's load
  and after B's read is refused. On the old code the list is never emptied, so the card shows A's
  token. To prove the cases also catch the appending handler, a probe put the old
  `onTokenAdded` (`tokens.value.push(token)`) into the fixed page: both drew the foreign token,
  `expected { loading: 'true', symbol: 'FRN' }` and `{ loading: 'false', symbol: 'FRN' }`, and the
  event during the load was lost (`symbol: undefined`, expected `OTH`). Restored from a scratch
  copy, `cmp` clean.

The others: the mount read, the superseded read, the refused-then-B read and the event during the
load all read `loading: 'false'` where `'true'` was due; the refused mount read reached the app's
error handler (`expected 1 to be +0`). The card: a tap while loading opened the import popup; no
`data-state`, no skeleton (`expected +0 to be 3`), no keyboard handler or `role`/`tabindex`.

Green on today's code, as guards: the identity going incomplete mid-load, a read that finds no
tokens, an empty load then a token event (the `tokens` watch still adopts it), and the skeleton
timer's cleanup.

## Found while fixing: a token re-read outlived an incomplete identity

The first fix bumped the re-read sequence only on a complete identity. A re-read still out when
the identity went incomplete then landed the old identity's tokens on the cleared card. Pinned
first ("a token re-read still out when the identity goes incomplete never lands": `expected {
loading: 'false', symbol: 'TST' } to deeply equal { loading: 'false', symbol: undefined }`), then
fixed: every identity fetch bumps the sequence, which also makes the re-read's own loading check
redundant, so it was dropped.

## Built as planned

- `tokensLoading` starts true; only the current identity fetch ends it, in a `finally`.
- An identity fetch clears tokens and balances before its read, so a switch never shows the
  previous identity's token or balance; `tokenBalanceByType` returns 0 without an active token.
- `onTokenAdded` never appends: outside a load it re-reads the current identity's tokens; during a
  load it marks the fetch, which reads the tokens again before it ends loading (a loop, so a second
  event during that re-read is not lost either).
- Every caller catches and logs at `debug` with `{ error }`; a refused read ends on today's empty
  card.
- The card: `loading`, `data-state`, `role="button"`, `tabindex` 0 or -1, Enter and Space, `aria-busy`
  and `aria-disabled` while loading, an empty row the token row's height and the skeleton after
  300 ms.

## Gate

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 29 warnings, 3 infos, all pre-existing |
| `bun run typecheck:all` | 0 | |
| `bun --bun vitest run` the three P3 files (from `apps/extension`) | 0 | 3 files, 87 passed |
| `bun run test:all` | 0 | extension 7848 passed, 4 skipped, 8 todo; every workspace exit 0 |

## The owner's name for the loading card

On the sign-off page (2026-09-29, `name`) the owner picked "Name it Loading tokens (Recommended)":
while the card loads, a screen reader hears "Loading tokens" instead of a nameless busy button.
Nothing drawn changes.

- Red first: one new case in `SelectTokenCard.test.ts`, 1 failed and 6 passed
  (`expected undefined to be 'Loading tokens'`).
- Built: `:aria-label="isLoading ? 'Loading tokens' : undefined"`. The ready and empty rows keep
  the names their content gives, and so does a token handed in while loading, which is drawn.
- `bun --bun vitest run src/popup/components/modules/send/` (from `apps/extension`): exit 0,
  12 files, 275 passed.
