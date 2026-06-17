# Phase 3 — Measure F1 (capture-first, NO fix)

**Status: DRAFT — awaiting measure-soak confirmation before classifying + advancing to Phase 4.**

F1 = `authwit-lifecycle.test.ts` fails at the revoke step: `settingsAction` clicks
`authwits-revoke-all`, which is `:disabled="!authwits.length"` (authwits view
`index.vue:140`). If the page's authwit list loads empty, the button stays
disabled, `clickByTestId` (which waits out `aria-disabled`) times out → fail.

## Capture (shipped: dc778b3)
Test-side `dumpAuthwitMeasurement(page, label)` in `tests/e2e/fixtures/journal.ts`
(reuses `extCtxEvaluate`), wired into `authwit-lifecycle.test.ts` `settingsAction`
right after the actions-btn click, before the action click. Dumps under
`[authwit-measure]`:
- stored `nulo:core:auth-registry` rows (write-side `account` keys + hashes),
- stored `nulo:core:accounts` rows (read-side queried address),
- page render state (FETCHING / NO AUTHWITS YET / error / cards) + revoke-all
  `aria-disabled`.
Test-side ⇒ never ships in a build (obviates the plan's app-side probe + the
bundle-grep concern entirely).

Measure soak: `network-e2e-soak.yml` `mode=files authwit-lifecycle repeats=3
retry=0 proverless` (run 27716251879). Expected RED (F1 unfixed) — the VALUE is
the `[authwit-measure]` logs, not a pass.

## Static analysis (the comparison the capture targets)
- **Write key** — `tx-request-builder.ts:204`: `trackAuthwit(account.address.toString(), …)`
  ⇒ stored `auth-registry` row `.account` = `AztecAddress.toString()`.
- **Read key** — authwits view `index.vue:47`: `getAuthwits(appStore.account.address)`;
  `appStore.account` is `Account` and `Account.address` is a **string**
  (`account/spec.ts:15`).
- `getAuthwits` filters `x.account === account` (string `===`, `service.ts:90`).
- **Bucket A is plausible IFF** the `Account.address` string differs in format
  from `AztecAddress.toString()`. The capture dumps BOTH strings side-by-side, so
  the soak log resolves this decisively. (Static analysis alone can't — exactly
  why the plan mandates measure-before-fix.)

## Buckets (to select from the soak log)
- **A** — auth-registry rows present, but their `.account` ≠ the accounts row's
  `address` (format mismatch). Fix (Phase 4): canonicalize the key in the service
  (`AztecAddress.fromString().toString()` both sides). Lowest blast radius.
- **B** — rows absent AFTER a successful grant (synced-deleted by `syncAuthwit`
  on not-yet-consumable). Fix: gate deletion on a positive "gone" signal.
- **C** — never persisted (no rows ever). Fix: the write path.
- **D** — rows present AND `.account` === queried address, but page still empty
  (render/bootstrap race). Fix: page-side account watch / explicit first refresh.

## Decisive evidence (TO FILL from run 27716251879 `[authwit-measure]` logs)
_pending soak — record here: the auth-registry row `.account` value, the accounts
row `address` value, whether they are `===`, and the page state. Then select the
bucket (must agree across the 3 iterations) and only THEN implement Phase 4._
