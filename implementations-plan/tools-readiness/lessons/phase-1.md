# Phase 1 — the wallet widens a session on a repeat `accounts` request

Commit `c1993c2f` (arc 1, branch `worktree-tools-readiness`).

## What landed

- `packages/wallet-bridge/src/dispatcher.ts`: `ungrantedAccounts` (exported, pure, case-blind hex),
  `planAccountsWidening` (membership-only joins the delta; a declined widening with nothing left to
  add answers from the stored grant instead of re-prompting; field-diff keeps the replacement
  path), `applyAccountsWidening` (chain-scoped: `resolveNetwork` → `accountService.getAccounts` →
  `getSessionAccountAddresses`), `accountsAdditions` (only unheld CAIP entries and their aliases),
  `CapabilityPlan.sessionAccounts` / `accountsWidening`, popup params `grantedAccounts` +
  `accountsMembershipOnly`, the decision's `requiresGrant: ["accounts"]` on an approved widening.
- `services-contract.ts`: `CapabilityDecision.requiresGrant?`. `dapp-interaction-protocol.ts`: the
  two popup params.
- `apps/extension/src/wallet/services/dapp-session/service.ts`: the precondition inside the
  existing lock — a listed type with no stored grant throws `CapabilityNotGrantedError(type)` and
  writes nothing. No new error class: the meaning is exactly "the accounts capability is not
  granted; re-request", and the code is already wire-registered.
- Popup: `AccountSelectRow` `locked` (pre-selected, `data-granted`, `aria-disabled`, `tabindex -1`,
  click/Enter/Space guarded, alias input hidden, "SHARED" chip); the `disabled` prop now also blocks
  keyboard toggles (codex round 1 #2); Space added per the keyboard rule. `index.vue`:
  `initAccountPicker`, `isAccountGranted`, `selectAccount` ignores held rows, `buildGrantedCaps`
  excludes the rider from the existing list too (a membership-only rider is `isNew: false`, so it
  would otherwise be pushed as a second accounts cap), the approve gate asks for a new row on a
  membership-only request, section label "Add accounts to share". `build-items.ts`: the rider is an
  existing (non-deselectable) card when `accountsMembershipOnly`.

## Deviations from plan.md (recorded, not silent)

- The row is a `div role="button"`, so "native `disabled`" is `aria-disabled` + `tabindex="-1"` +
  a handler guard; the tests prove click, Enter and Space are ignored.
- `GrantRevokedError` → `CapabilityNotGrantedError`. Smaller and already serializable.

## Gate (retry 0, working tree = `c1993c2f`)

| Command | Result |
|---|---|
| `bun run lint` | 0 errors (33 pre-existing warnings), complexity-baseline OK |
| `bun run --cwd packages/wallet-bridge typecheck` | exit 0 |
| `bun run --cwd packages/wallet-bridge test` | 10 files, 274 passed (12 new widening tests) |
| `bun run --cwd apps/extension typecheck` | exit 0 |
| `bun run --cwd apps/extension test -- src/popup/windows/capabilities src/wallet/services/dapp-session` | 12 files, 121 passed |

## Lessons

- The existing decision path replaced the accounts grant with the popup's echo; the widening
  refactor had to keep that for field-diff and skip it for membership-only, decided by flag
  equality alone — delta origin (rejection vs coverage) is not a safe discriminator.
- `applyDecisionTo`, the test fake of the service merge, mirrors the new precondition so the
  dispatcher test can prove the refusal path without the real service.
