# Phase 1 — Scope-enforcement primitives (F-003 + F-004 + F-005)

## Closed findings
- **F-003**: `accounts.canGet` sub-grant now enforced on both the grant-response path (`enrichGrantedCapabilities`) and the handler path (`getAccounts` via scope-enforcement).
- **F-004**: `data.addressBook` sub-grant now enforced on `getAddressBook` AND `registerSender`.
- **F-005**: account-scope arrays (`exec.scopes`, `opts.scopes`, `opts.additionalScopes`, `eventFilter.scopes`) validated against session's approved-accounts set. Empty-`calls` fast-path bypass closed.

## Implementation
- `packages/wallet-bridge/src/scope-enforcement.ts`:
  - New `checkGetAccounts` — requires at least one `AccountsCapability` with `canGet === true`.
  - New `checkGetAddressBook` + `checkRegisterSender` — require at least one `DataCapability` with `addressBook === true`.
  - New helper `validateAccountScopes(scopeField, sessionAccounts, fieldName)` — throws if any scope-list entry is not in the session's approved set.
  - New public `enforceScopeWithSession(methodName, args, grants, sessionAccounts)` — runs `enforceScope` first, then F-005 account-scope check on `exec.scopes` / `opts.scopes` / `opts.additionalScopes` / `eventFilter.scopes` (the last only for `getPrivateEvents`).
- `packages/wallet-bridge/src/capability-map.ts`:
  - Removed `getAccounts` from `EXEMPT_METHODS`.
  - Mapped `getAccounts` → `"accounts"` in `METHOD_CAPABILITY_MAP`.
- `packages/wallet-bridge/src/dispatcher.ts`:
  - `enrichGrantedCapabilities` (line 720) now honors `canGet`: `accounts: []` when `canGet !== true`. Closes the F-003 grant-response leak that the original Phase 1 plan missed (codex Round 1 B-1).
  - `enforceCapability` now throws `CapabilityNotGrantedError` (was plain `Error`) — preserves the dApp-facing error contract since `getAccounts` (which had `CapabilityNotGrantedError`-pinned tests) is no longer exempt.
  - `dispatch()` switches from `enforceScope` to `enforceScopeWithSession` when a session exists; falls back to `enforceScope` when no session.
  - Added Debug log in `enforceCapability` before throw — preserves the log-noise control test for pre-grant calls.

## Tests added (14 new)
- 3 F-003 tests for `checkGetAccounts` (canGet:true passes, canGet:false throws, canGet missing throws).
- 5 F-004 tests for `checkGetAddressBook` + `checkRegisterSender` (addressBook:true/false × 2 methods, plus a missing-flag case).
- 6 F-005 tests for `enforceScopeWithSession` — empty-calls bypass closed, scope-array tampering in `opts.additionalScopes`, `eventFilter.scopes`, `sendTx.opts.additionalScopes`. Plus back-compat: plain `enforceScope` (no session) doesn't check account scopes.

## Updated tests (1)
- `dispatcher.handleGetAccounts — session has 1 account → returns formatted` now requires an `accounts` grant with `canGet: true` in the test session (post-F-003, the legacy "accounts present without a grant" fast-path is gone).

## Verification
- `bun test` (wallet-bridge): 98 pass, 1 pre-existing fail (`schema patch reachability`, ENOENT on `@aztec/noir-noirc_abi`).
- `bun --cwd packages/extension lint`: 0 errors.
- `bun --cwd packages/extension typecheck`: clean.

## Surprises
- The existing `dispatcher.handleGetAccounts — session has 1 account` test pinned a "fast-path returns accounts without checking grants" behavior. That fast-path IS the F-003 bug. Updating the test was the right call.
- `enforceCapability` threw plain `Error` previously; `getAccounts` was exempt so the `CapabilityNotGrantedError` from `handleGetAccounts` was what dApps saw. Removing exemption surfaced the inconsistency — converting `enforceCapability` to throw `CapabilityNotGrantedError` unifies the error contract.

## Open follow-ups
- None for Phase 1. The F-005 helpers stay usable for any future scope-array methods.

LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-1.md
