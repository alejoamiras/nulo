# Phase 4 — E2E rework

## What shipped
- `helpers.ts` `addContact`: dropped the `registerAsSender` option, toggle click, and chip wait —
  saving a contact is contact-service-only.
- Deleted `tests/e2e/network/contacts-sender.test.ts` (all four scenarios tested removed
  behavior: delete-confirm toggle ON/OFF, edit-address migration, drop-both).
- New `tests/e2e/network/senders-advanced.test.ts` (2 tests, green on live node):
  1. add-contact registers NO sender (chip absent) → Advanced registration lights the read-only
     chip → Advanced delete clears it, contact survives.
  2. THE decoupling pin: delete a contact whose address IS a registered sender → confirm offers
     no toggle → sender registration survives in Advanced.
- New testids (added BEFORE tests per the strict rule): `senders-add-btn`, `sender-row` +
  `data-sender-address`, `sender-delete`, `new-sender-address-input`, `new-sender-submit`.
- Smoke `contacts.test.ts`: removed the stale toggle diag field; renamed the confirm-toggle test
  to state the new invariant. Smoke contacts 4/4 green.
- `data-registerSender.test.ts` (dApp RPC): untouched, still green.

## Root-caused failures (3 debug rounds — hit the reassess threshold, each round found a REAL bug)
1. **Sub-pages have no bottom nav**: `navigateToSettings` starts with `clickNavTab("settings")`,
   which waits for the nav bar — but settings SUB-pages (contacts, senders) render a
   SubPageHeader instead. Any settings→settings hop mid-test hangs. Fix: direct
   `navigateByHash` hops (helpers already HAD `navigateByHash` for exactly this — same pattern
   as passkey-backup.test.ts; a first attempt to add a duplicate helper was caught by
   `noRedeclare`).
2. **File-scoped identities + vitest retries = duplicate-validation wall**: the extension fixture
   is file-scoped; a retry re-enters with the previous attempt's contacts persisted, so
   beforeAll-fixed names/addresses trip "Already exist" and the submit never enables. The
   diagnostic snapshot (values typed fine + both fields flagged duplicate + the contact already
   listed) was the tell. Fix: generate identity per TEST BODY (`AztecAddress.random()` + a
   name derived from the address).
3. **`sender-delete` is an `<Icon>` → SVG**: `SVGElement` has no `.click()` —
   `document.querySelector(...)?.click()` throws TypeError. Fix: dispatch a bubbling
   `MouseEvent("click")` (same pattern as `navigateToTokenDetail`'s anchor click).

## Validation gate (plan Phase 4)
- `bun run lint` → exit 0; `bun run typecheck` → exit 0
- `bun run e2e:agent tests/e2e/network/senders-advanced.test.ts tests/e2e/network/data-registerSender.test.ts`
  → 2 files, 3 tests passed against a live local node (the runner's post-suite "Vite server
  exiting" warning is a known teardown quirk; test results green, script exit driven by it was
  verified NOT present on the final run).
