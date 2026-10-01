# Phase 6 — onTokenDeleted authoritative profileId (C) — lessons

**Status: ✓ (`da71eba`).** Gate: `vitest run incoming-transfer token cross-profile-isolation network` 183 pass; typecheck 0; lint 0.

## What was built
- `token/spec.ts`: `TokenDeleted = TokenInfo & { profileId: string }`; `onTokenDeleted` event retyped to it.
- `token/service.ts` + `token/client.ts`: both emit sites (`clearChainState:99`, `_deleteTokenById:300`) + the client's `EventHandler` carry `token.profileId`.
- `network/service.ts`: NEW lock-free `getNetworksRaw(profileId, chainId?)` (no `requireActiveProfile`) — reused by P8's snapshot.
- `incoming-transfer/service.ts` `onTokenDeleted`: scopes to `token.profileId` via `getNetworksRaw`, NOT `getActiveProfile()` + the active-scoped `resolveNetworkByChainId`.

## Key decisions / gotchas
- **The bug is specifically the `clearChainState`/`onProfileDeleted` path** — `_deleteTokenById` (single delete via RPC) always has active==token profile, so no bug there; but the profile-delete cascade fires `onTokenDeleted` for an INACTIVE profile → `getActiveProfile()` returned the wrong (active) profile → wiped IT.
- **`TokenInfo` is structurally a subset of `TokenDeleted`** → every OTHER `onTokenDeleted` consumer (token-balance, UI) typechecks unchanged (a `(t: TokenInfo)` handler accepts a `TokenDeleted`). Only the emit sites + the two profile-scoping consumers needed edits.
- **Two test-infra updates required:** (1) `tokenA` scenario fixture needed `profileId: "p1"` (the payload now carries it); (2) `makeNetworkStub` needed a `getNetworksRaw` (the handler switched off `getNetworks`). Both mechanical.
- **zsh doesn't word-split unquoted vars** — `git add $FILES` fed the whole string as one pathspec; use explicit paths or `${=FILES}`.
- **Pin is property-injected** (bypasses the 8-dep `init`): asserts `getNetworksRaw`/`getAccounts`/`listByContract`/`getTrust` are all called with the DELETED profile P2, never active P1. Fails pre-fix (which used P1).
