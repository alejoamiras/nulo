# P9 lessons — F1 skip-route e2e pins

## Outcome

`test(e2e): onboarding learn-skip + fees-skip both route to /accelerator` —
typecheck clean (post the in-passing PopupManager.test.ts type-tightening),
lint clean, vitest unchanged. The new e2e test is gated behind the smoke
suite (`bun run test:e2e`) and runs in CI under the smoke / network e2e
labels.

## The pin

Arc-relabeling moved the happy-path flow from `learn → accelerator` to
`learn → fees → accelerator`. Each skip button now has its own handler routing
to `/accelerator` (NOT `/done`). Without an explicit pin, a future refactor
that consolidates the two split handlers could silently fan one of them to
the wrong target — the happy-path test would still pass (it clicks Continue,
not Skip).

## What shipped

`packages/extension/tests/e2e/onboarding-tab.test.ts`:

- New test: `"skip links on /learn and /fees both route to /accelerator
  (split-handler pin)"`.
- Navigates directly to `#/onboarding/learn` via `window.location.hash` (no
  full create flow needed — the route guard allows direct hash navigation,
  consistent with the existing accelerator-direct-navigation tests).
- Clicks `onboarding-learn-skip` → waits for `#/onboarding/accelerator`.
- Navigates to `#/onboarding/fees` → clicks `onboarding-fees-skip` → waits
  for `#/onboarding/accelerator`.
- Single test rather than two — both assertions are trivial route checks,
  splitting would just inflate teardown cost in the smoke suite.

## In-passing fix

The PopupManager P7 test file (`PopupManager.test.ts`) had implicit-`any`
errors that surfaced when running `bun run typecheck` after the e2e file
landed. The errors were on mock function parameters (`isOpened(target)`,
`open(target)`, `firePending(p)`, etc.) and the `cacheState.incomingTrust`
reactive that had no shape annotation.

Tightened with explicit types (`PendingPayload` interface, `(target: string)`
parameter annotations, `IncomingTrustState` interface for the cache state).
The runtime behavior is unchanged; this was a delta-detection by typecheck
that didn't surface on the P7 commit because the new file's types were the
only consumers at that time.

## Files

- `packages/extension/tests/e2e/onboarding-tab.test.ts` (new test).
- `packages/extension/src/popup/components/popups/PopupManager.test.ts`
  (typecheck cleanup; no behavioral change).

## Open items

None. The arc is now feature-complete pending the post-impl codex audit
of the consolidated diff and any fixes that surfaces.
