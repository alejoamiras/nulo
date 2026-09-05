# Phase 3 — the popup: banner, switch action, identity line

Status: ✓ (2026-09-05)

## What landed
- `Banner` (`@nulo/design`): `action.testId` → `data-testid` on the action button (both directions).
- `windows/capabilities/chain-mismatch.ts`: pure `resolveDappChain` (row name, built-in fallback, switch
  target, mismatch); 7 tests.
- `windows/capabilities/index.vue`: `dappChain`, `isSwitching`, `switchedTo`, `chainBannerState`
  (`mismatch` | `switched` | hidden while the hard error shows); the banner with the owner's copy; the
  switch via `useNetworkActivation({ persist, read })` on `requireNetwork()`; the footer held while
  switching; `reject()` unconditional; identity line "is requesting permissions on {name}"; the hard-error
  tooltip names the chain and the remedy.
- `IdentityStrip`: `data-testid="identity-network"` on the network label (Phase 4's e2e selector).
- `chain-switch.test.ts`: 8 deterministic component cases (deferred activation).

## Gate
- `bun run test src/popup/windows/capabilities` → 7 files, 74 passed (15 new).
- `packages/design`: 37 files, 314 passed. `src/components/composite`: 26 files, 291 passed.
- `bun run lint` exit 0 · `bun run typecheck` exit 0 · `bun run baseline:complexity` → only the
  `generated` date moved (no acceptance change); reverted to keep the manifest untouched.

## Notes
- The window is `<script setup lang="ts">`, so `managers.network` is `| null` under strict checks —
  `requireNetwork()` is the accessor for unlock-guarded code (the window renders only when logged in).
- The two pre-existing capability tests mocked the app store without `networks` and one payload without
  `session`; both now mock the real shape (a `networks: []` and a `session.chainId`). No production
  fallback was added for an incomplete mock.
- `toBe` on an object pulled out of a reactive store compares the proxy — `toMatchObject` instead.
