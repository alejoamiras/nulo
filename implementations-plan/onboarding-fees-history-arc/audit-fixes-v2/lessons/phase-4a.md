# P4a lessons — C2 popup-reopen failing repro e2e

## Outcome

`test(e2e): repro C2 popup-reopen trust-prompt loss` — new test case
appended to `tests/e2e/network/incoming-transfers.test.ts`. Typecheck
clean. The test lives under the `network` e2e suite (real Aztec
sandbox required); skipped locally.

## What shipped

Deterministic puppeteer test that:

1. Opens the popup once via the `registeredExtension` fixture (a
   profile is already registered + unlocked).
2. Pre-seeds chrome.storage.local with a `pending` trust row + a
   `hidden=true` incoming-transfer record matching the active
   (profile, network, account) triple. Uses EntityStorage's
   `${root}@${id}` key shape verified at
   `packages/wallet-core/src/storage/entity_storage.ts:84-102`.
3. Closes that seed popup.
4. **First popup open**: asserts the trust prompt
   (`data-testid="incoming-trust-contract"`) becomes visible within
   10s.
5. **Closes the popup window** (mimics the user's accidental dismissal
   per C2 QA report).
6. **Second popup open**: asserts the trust prompt re-fires within
   10s.

The second-open assertion is the regression pin. On current `dev` it
likely fails (the `onConnected` handler in `PopupManager.vue:71` reads
the appStore triple inline and early-returns if any field is empty —
H7 from the v3 audit). P8 lands the fix.

## What I deliberately did NOT do

- Did NOT exercise the real first-receive flow (would need an external
  Aztec sender + non-deterministic note discovery). The pre-seed path
  exercises the replay-on-reopen logic which is what C2 is about.
- Did NOT inline `network e2e` config. The test inherits
  `aztecTestConfig` from the existing suite's `inject("aztecTestConfig")`.

## Files

- `packages/extension/tests/e2e/network/incoming-transfers.test.ts`
  (+1 test case, ~95 lines).

## Open items

- This test runs only under `bun run e2e:agent` or the
  `Network e2e / Status` CI workflow. Local validation skipped.
- If the test passes on dev (i.e. C2 doesn't repro under puppeteer's
  timing), it's still a regression pin against future drift.
