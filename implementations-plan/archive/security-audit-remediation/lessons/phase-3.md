# Phase 3 — F-006 session revocation teardown

## Closed finding
- **F-006**: disconnecting a dApp (or session expiry) now both deletes the stored `DappSession` AND tears down every matching live wallet-sdk `ActiveSession`. The dispatcher fail-closes for non-exempt methods when the stored session is missing.

## Implementation

### `packages/extension/src/wallet/services/wallet-sdk/background.ts`
1. Added `dappSessionService.onDappSessionDeleted` subscriber (~30 lines). For each event:
   - Extract `origin = deleted.dappMetadata.url` and `chainId = deleted.chainId`.
   - Filter `handler.getActiveSessions()` by `(origin, chainId)` tuple.
   - Call `handler.terminateSession(matchedSessionId)` for each.
   - This is the upstream-API call that fires `SESSION_DISCONNECTED` to the dApp tab AND triggers `onSessionTerminated` (which already cleans up the per-session queues).
   - Tuple-matching (NOT a single `walletSdkSessionId` field) per Round 1 reversal of Decision 8 — a stored DappSession may correspond to multiple live ActiveSessions (multi-tab same-dApp).
2. Modified `onSessionEstablished` (~lines 153-187): if a session establishes but no matching DappSession exists (revoked between approveDiscovery and key-exchange), call `handler.terminateSession()` immediately. Closes the Round 2 B-2 race where an approved `pendingDiscovery` could re-establish a live session after revocation.

### `packages/wallet-bridge/src/dispatcher.ts`
3. `enforceCapability` now throws `CapabilityNotGrantedError` when `dappSession` is undefined (line ~735). Pre-fix returned `[]`, letting non-exempt methods (`getPrivateEvents`, `getAddressBook`, `registerSender`, `registerContract`, `getContractMetadata`, `getContractClassMetadata`) execute unchecked. Paired with the live-transport teardown above.

## Tests
- **Updated**: `dispatcher.handleGetAccounts — no session` test renamed + reframed to reflect F-006's fail-closed policy. Pre-fix pinned `No dApp session found` plain Error; post-fix pins `CapabilityNotGrantedError`.
- **New**: `F-006: network-only methods fail-closed on missing session (Phase 3)` describe block, 4 tests:
  - `getPrivateEvents` throws `CapabilityNotGrantedError` (was silently succeeded)
  - `getAddressBook` throws `CapabilityNotGrantedError`
  - `registerContract` throws `CapabilityNotGrantedError`
  - `getChainInfo` (exempt) does NOT throw `CapabilityNotGrantedError` (probe path preserved)

## Verification
- `bun test` (wallet-bridge): 102 pass, 1 pre-existing fail (`schema patch reachability`, ENOENT on `@aztec/noir-noirc_abi`).
- `bun --cwd packages/extension lint` on STAGED files: clean. (`useProfileBootstrap.test.ts` has a pre-existing biome warning in the broader codebase, unrelated to Phase 3.)
- `bun --cwd packages/extension typecheck`: clean.

## Codex consult
**Deferred to PR review.** The plan flagged "codex consult mandated before merge" for Phase 3's cross-package wiring. Will run `/codex xhigh` on the diff once Phase 7 lands and we open the PR for `/code-review max --fix` + post-impl audit.

## Surprises
- Upstream `BackgroundConnectionHandler.pendingDiscoveries` is PRIVATE — not externally iterable. Round 2 B-2's "purge approved pendingDiscoveries on revocation" couldn't be done directly. Instead, added a guard at `onSessionEstablished` that terminates immediately if no DappSession matches. Closes the race functionally even though the pending-discovery itself stays in the upstream's internal map until upstream times it out.
- The existing `handleGetAccounts` test pinned the plain "No dApp session found" Error ordering. This was a defensive pin against a future refactor moving the session-check after the cap-check. The F-006 audit fix is EXACTLY that refactor — so the pin was inverted into a F-006 fail-closed pin instead.

## Open follow-ups
- File upstream issue/PR: `BackgroundConnectionHandler.pendingDiscoveries` should be externally iterable so subscribers can purge approved entries directly without relying on the `onSessionEstablished` post-check.
- Codex consult on the diff at PR-creation time.

LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-3.md
