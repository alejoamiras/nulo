# Phase 2 — F-007 passkey unlock binding

## Closed finding
- **F-007**: `unlockPasskeyProfile` now rejects when the popup-supplied `credentialData.id` doesn't match the profile's stored `credentialId`. Mirrors the existing binding check in `exportPlain:656-660` and `restore()` line ~916.

## Implementation
- `packages/extension/src/wallet/services/profile/service.ts`: 4-line insert after `acquireRecovery` (line 312), before the Phase 3 lock re-entry:
  ```typescript
  if (recovery.credentialId !== snapshot.credentialId) {
      throw new Error("Invalid profile id")
  }
  ```

## Test added (1)
- `service.integration.test.ts`: `F-007: unlockPasskeyProfile rejects credentialData for a different credential` — creates a passkey profile, locks it, attempts unlock with a `cred-OTHER` credential, asserts `Invalid profile id` throw. Mirrors the existing `exportPlain passkey rejects credentialData for a different credential` pattern.

## Verification
- `bun --cwd packages/extension test -- profile/service.integration.test.ts`: 42 pass (0 fail).
- `bun --cwd packages/extension lint`: 0 errors.
- `bun --cwd packages/extension typecheck`: clean.

## Surprises
- None. Genuinely 4 lines + 1 test as the audit predicted.
- One minor: the test originally used `service.lockProfile()` (doesn't exist); the actual API is `service.lockActiveProfile()`. Trivial fix.

LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-2.md
