# M4.8 — audit-diff (post-dual-audit; DECISION MEMO)

Date: 2026-04-26

## Codex BLOCKERs

1. **Design Y `parseInt(handleId)` is wrong (codex BLOCKING)**: `PendingPasskey.handleId` is `getRandomHex(8)` (random hex string), NOT `windowId`. WindowManager handles are random hex tokens, not chrome window IDs. Even if `windowId` were persisted, the recovery still wouldn't work — the old `handles` map and resolver closures die with the SW (`window-manager.ts:43,60-74`). **Fix**: rewrite Design Y to acknowledge that recovery isn't actually possible with current primitives. EITHER (a) Design Y becomes "drop pending entries on SW restart, surface clean error to popup," OR (b) needs a much larger redesign that introduces persistent resolver-handle mapping (out of M4.8 scope).
2. **Design Y "M4.7 territory" claim wrong (codex BLOCKING)**: M4.7 only boots migrations against `browserApi.storage.local`. Inventory mislists `nulo:core:session` under chrome.storage.local before correcting under .session. Session-storage migration is NOT actually covered. **Fix**: either say "no migrator is needed for a brand-new session-only root" OR push an extension to M4.7 to add a `storage.session` runner/registry.

## Codex SHOULD-FIX

- `PasskeyPendingStore` work called "type-only" but then proposes rewiring `PasskeyService` onto an async store abstraction. For recommended Design X, that abstraction is speculative churn with no payoff. **Fix**: true prework only — inventory call sites + define persisted envelope shape; defer store interface/injection until Design Y is actually approved.
- Wrong execution touchpoints: `ProfileService.restorePasskeySession` does NOT exist. Live restart path is:
  1. `SessionManager.restore()` leaving passkey sessions locked (`session-manager.ts:215-235`)
  2. `auth.vue` detects passkey profile + offers continuation (`auth.vue:37-61, 163-169`)
  3. `unlockPasskeyProfile()` reopens WebAuthn (`profile/service.ts:215-257`)
  Rewrite Step 1 around those concrete files. M4.2 is dependency for the *symmetry claim*, not for Design X cleanup itself.
- Test "Pending map empty post-SW-restart" is tautological. User-visible failure: stale passkey popup calls `getPendingRequest(requestId)` → `"Invalid request id"` (`popup/windows/passkey/index.vue:123-133`, `passkey/service.ts:43-45`). Add test for stale `requestId` popup behavior after restart, and test for auth-screen re-unlock path after `SessionManager.restore()` short-circuits.
- Don't add new M2.6 vector — V3 already pins passkey PRF→master-secret derivation (`crypto/key-vectors.test.ts:132-148`).

## Plan agent SHOULD-FIX

- M4.7 inventory listed for Design Y — explicit say "Design Y requires re-opening M4.7 to add `nulo:passkey:pending` to session-storage inventory."
- Test list: mid-PRF SW restart, WindowManager.detach race on cold SW, stale lock-screen state.
- `chrome.windows.get` reliability — never actually answered (only matters if Y revives).
- SECURITY.md cross-doc updates: post-M4.2+M4.8, "Session secret (passkey profiles)" rewrite, threat-model joint update with M4.2, mark `architecture/codex-notes/08-passkey-flow.md:198` resolved.

## Plan agent NIT

- Design X recommendation holds.
- handleId-vs-windowId category bug if Y revives.
- WindowManager.reattach scope — sub-PR if Y revives.

## Recommended execution-time absorption

1. **Memo revision** for Design Y: drop the recoverability promise. Either descope Y entirely (recommended: stick with Design X) or rewrite Y as "drop pending on restart, clean error UX."
2. **Step 1 rewrite** around real touchpoints: `SessionManager.restore` short-circuit, `auth.vue:37-61,163-169`, `unlockPasskeyProfile` (`service.ts:215-257`).
3. **Tighten prework**: inventory + envelope shape only. Defer the abstraction.
4. **Test additions**: stale-requestId-popup-after-restart, auth-screen-re-unlock, cold-SW detach race.
5. **Don't add new M2.6 vector** — V3 covers it.
6. **SECURITY.md cross-doc updates** owned by this PR (joint with M4.2).

## Status

- Plan v0 SHIPPED. Audits absorbed in this audit-diff.
- Plan v1 — memo-level revisions. Awaiting M4.2's design decision before transition.
