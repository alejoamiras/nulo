# Research: Trust-recheck primitive design

**Targets**: F-003, F-004, F-005, F-006, F-012 (per audit's "trust checked once, reused too broadly" cross-cutting theme)
**Conclusion**: The "one primitive closes all 5" idea is OVER-AGGRESSIVE. Findings live in 3 different layers.

## Current `enforceScope` shape (`packages/wallet-bridge/src/scope-enforcement.ts`)

- Signature: `enforceScope(methodName: string, args: unknown[], grants: GrantedCapabilityRecord[]): void`
- Per-method checker registry at lines 269-279 — `METHOD_SCOPE_CHECKER: Record<string, (args, grants) => void>`
- 9 methods currently registered: `registerContract`, `getContractMetadata`, `getContractClassMetadata`, `sendTx`, `simulateTx`, `profileTx`, `executeUtility`, `getPrivateEvents`, `createAuthWit`
- Pass-through (no checker = silent no-op): `registerSender`, `getAddressBook`, `getChainInfo`, `requestCapabilities`, `getAccounts`, `batch`
- Fast-path: empty `calls` array returns early (lines 96, 115-116) — **the F-005 bypass surface**
- Helpers at lines 31-49: `matchesPattern`, `matchesScope`, `inAddressList`, `grantsOfType<T>`
- Type-guards at lines 203-217: `isCallIntent`, `isIntentInnerHash`
- **Pure function**: no session I/O, no async — by design

## Per-finding requirements

### F-003 (`accounts.canGet`)
- Enforce `AccountsCapability.canGet` on both response path (`dispatcher.ts:704-713`) AND handler (`dispatcher.ts:288-317`)
- Current: `getAccounts` in `EXEMPT_METHODS` at `capability-map.ts:14`
- Fix: add `checkGetAccounts` to `METHOD_SCOPE_CHECKER`; remove `getAccounts` from `EXEMPT_METHODS`

### F-004 (`data.addressBook`)
- Add scope checkers for `getAddressBook` + `registerSender` that require `DataCapability.addressBook === true`
- Same shape as F-003

### F-005 (account scope arrays)
- Validate `eventFilter.scopes` / `opts.scopes` / `opts.additionalScopes` against `session.accounts` allow-list
- **Different from F-003/F-004**: requires session-context, not just grants
- Current `enforceScope` signature doesn't take session — would need new overload OR pass session through grants

### F-006 (session revocation)
- NOT a scope issue. Session-lifecycle management.
- Lives in `dapp-session/service.ts` + `wallet-sdk/background.ts`, not `scope-enforcement.ts`

### F-012 (live chain rebind)
- NOT a scope issue. Runtime chain-identity validation at signing time.
- Lives in `aztec-runtime/account/nulo-account.ts` + `execution/service.ts`

## Recommendation: 3-layer approach, not one primitive

| Layer | Findings | Approach |
|---|---|---|
| **Scope-enforcement** | F-003, F-004, F-005 | Extend `METHOD_SCOPE_CHECKER`. F-005 needs session-context — pass via new `enforceScopeWithSession(methodName, args, grants, sessionAccounts)` overload. |
| **Session-lifetime** | F-006 | Hook `onDappSessionDeleted` to upstream `handler.terminateSession()`. Make `enforceCapability` fail-closed on missing session. |
| **Runtime chain validation** | F-012 | Add live `node.getNodeInfo()` rebind check in `NuloAccount.buildTxExecutionRequest()` and `getChainInfo` response. |

## Implementation sketches

### Option A — Conservative (recommended): F-003 + F-004 only

```typescript
// scope-enforcement.ts
function checkGetAccounts(args, grants) {
  const caps = grantsOfType<AccountsCapability>(grants, "accounts")
  if (!caps.length) return
  if (!caps.some((c) => c.canGet)) throw new Error("Scope violation: getAccounts requires accounts.canGet=true")
}
function checkGetAddressBook(args, grants) {
  const caps = grantsOfType<DataCapability>(grants, "data")
  if (!caps.length) return
  if (!caps.some((c) => c.addressBook)) throw new Error("Scope violation: getAddressBook requires data.addressBook=true")
}
// + add to METHOD_SCOPE_CHECKER, remove getAccounts from EXEMPT_METHODS
```

### Option B — Account-scope validator for F-005

Requires session-context. New helper:

```typescript
function validateAccountScopes(scopeField, sessionAccounts, fieldName) {
  if (!Array.isArray(scopeField)) return
  for (const addr of scopeField) {
    if (!sessionAccounts.has(String(addr))) {
      throw new Error(`Scope violation: ${fieldName} contains ${addr}, not in session's approved accounts`)
    }
  }
}
```

Called from existing checkers + via a new `enforceAccountScopes(args, sessionAccounts)` pass after `enforceScope` returns.

### NOT recommended: Option C (unified gate)

Over-design. F-005's session-context requirement + F-006's lifecycle + F-012's runtime check don't share an abstraction cleanly.

## Test patterns to mirror

`scope-enforcement.test.ts` already establishes the per-method pattern:

```typescript
describe("getAccounts (post-F-003)", () => {
  test("canGet:true passes", () => { ... })
  test("canGet:false throws", () => { ... })
})
```

Reuse this shape for F-003, F-004, F-005 regression tests.
