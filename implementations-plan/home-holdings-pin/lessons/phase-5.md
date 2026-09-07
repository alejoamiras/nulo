# Phase 5 — `usePinnedTokens`

Implemented on the Mac, 2026-09-06 (drafted while Phase 3's network gate ran).

## What changed
- `popup/constants/storage-keys.ts`: `pinnedTokensKey(profileId)` beside `UI_STORAGE_KEYS`.
- `composables/usePinnedTokens.ts`: `sanitizePinMap` (unknown roots → `{}`, canonical decimal chain
  keys only, lowercase address-shaped entries, dedup, ≤ 3 per chain, first 32 chains), the composable
  with `pinnedContracts` (the loaded profile's list for the current chain — the computed reads
  `getScope()` so a chain switch re-evaluates against the store; a profile switch needs `refresh()`
  and reads empty until then), `pin` / `unpin` / `refresh` / `dispose`, deletion cleanup scoped to the
  event's profile + chain, `onChanged` re-read.
- Departures from the plan's sketch, both small: `pin` has a fourth result, `"stale"`, for an op
  whose scope changed between enqueue and run (the plan folded it into the three; a distinct value
  keeps the token page from toasting on it). `unpin` skips the write when nothing was removed or
  pruned, so a no-op does not fire an `onChanged` round-trip.
- The chain budget evicts the oldest OTHER chain when a 33rd appears, so the pin just written
  survives `sanitizePinMap`'s first-32 rule on the next read.

## Test notes
- `usePinnedTokens.test.ts` (18 cases) runs against an in-memory `chrome.storage.local` whose `set`
  fires `onChanged` listeners, plus an `external()` write that bypasses the mock's call count.
- The scope holder in the test is `reactive` — a plain variable left the computed cached, which is
  not how the store behaves.
- Biome budgets: `sanitizePinMap` split its list loop into `sanitizeContracts`; the composable's
  read/prune/budget helpers moved to module scope to fit the 80-line cap.
