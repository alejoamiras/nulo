# Remediation Plan — security audit (2026-06-08) [Opus draft]

## Summary

Eleven findings, three architecturally distinct layers, one trap. The audit cross-cutting observation #1 ("authorization checked at the wrong granularity") is the right diagnosis but tempts the implementer toward a unified primitive that doesn't exist. The research artifact `trust-recheck-primitive.md` is correct to reject it.

This plan sequences eight phases. Phase 1 extends `enforceScope` to take `sessionAccounts`, closing F-003 + F-004 + F-005 in one coherent change. F-007 ships as a 4-line standalone patch ahead of refactor. F-011 lands the URL allowlist. F-006 (session revocation) gets its own phase because it crosses packages and lives in the lifecycle layer, not scope. F-012 (chain rebind) gets its own phase because it lives in `aztec-runtime`, not `wallet-bridge`. F-008 + F-009 are coupled at the OperationCard surface and ship as one UX phase. F-001/F-002 ship Nulo-side defense-in-depth. Phase 8 reruns `/harden security max`.

~10-14 PRs total. Phase 1, 2, 3, 7 are week-1 quick wins. Phase 4 (F-006) and Phase 6 (F-008/F-009) carry the most architectural weight and need codex consult before merging.

## Architectural decision: WHICH primitives to build in Phase 1?

**I agree with the research artifact's 3-layer recommendation.** The three trust-recheck shapes:

1. **Scope-enforcement (sub-grant + allow-list bits)** — F-003, F-004, F-005. Pure synchronous function over `(method, args, grants, sessionAccounts)`. Lives in `packages/wallet-bridge/src/scope-enforcement.ts`. Tests are colocated unit tests, no mocks required.

2. **Session-lifetime** — F-006. Event-driven, async, cross-package (`dapp-session/service.ts` → `wallet-sdk/background.ts`). Crosses the upstream `@aztec/wallet-sdk` `BackgroundConnectionHandler` boundary via `handler.terminateSession(sessionId)`. Has race semantics.

3. **Runtime chain validation** — F-012. Lives at signing time inside `packages/aztec-runtime/`. Requires async `node.getNodeInfo()`. Fail-closed; failure mode is "signing context wrong → user signs against wrong chain."

These layers don't share an abstraction: layer 1 is sync+pure, layers 2+3 async+I/O. Layer 1 lives in `wallet-bridge`, layer 2 in `extension`, layer 3 in `aztec-runtime`. Their failure surfaces are different. A generic `TrustGate<T>` interface that spans them becomes more abstract than helpful.

**Phase 1 scope**: scope-enforcement primitive ONLY. F-003 + F-004 + F-005 land in Phase 1 because F-005 forces the signature change to take `sessionAccounts`, and F-003/F-004 are trivial extensions of the same `METHOD_SCOPE_CHECKER` registry. F-006 and F-012 are their own phases.

## Phases

### Phase 1: Scope-enforcement primitive + F-003 + F-004 + F-005

**Purpose**: Extend `enforceScope` to take session accounts; close all three scope sub-grant + allow-list findings in a single coherent change with one extended test file.

**Files touched**:
- `packages/wallet-bridge/src/scope-enforcement.ts` — extend signature, add `checkGetAccounts`, `checkGetAddressBook`, `checkRegisterSender`, account-scope validator.
- `packages/wallet-bridge/src/capability-map.ts` — remove `getAccounts` from `EXEMPT_METHODS`.
- `packages/wallet-bridge/src/dispatcher.ts` — pass `dappSession.accounts` into `enforceScope`; close the empty-`calls` fast-path bypass; fix the `requestCapabilities` response path to honor `canGet`.
- `packages/wallet-bridge/src/scope-enforcement.test.ts` — regression test pins for each of F-003, F-004, F-005.

**Code shape** (the architectural call):

```typescript
// new signature — session accounts threaded through
export function enforceScope(
  methodName: string,
  args: unknown[],
  grants: GrantedCapabilityRecord[],
  sessionAccounts: ReadonlySet<string>,
): void

// account-scope validator (F-005)
function validateAccountScopes(
  scopeField: unknown,
  sessionAccounts: ReadonlySet<string>,
  fieldName: string,
): void {
  if (!Array.isArray(scopeField)) return
  for (const addr of scopeField) {
    if (!sessionAccounts.has(String(addr))) {
      throw new Error(
        `Scope violation: ${fieldName} contains ${addr}, not in session's approved accounts`,
      )
    }
  }
}
```

`checkTransactionCalls`, `checkSimulationTransactions`, `checkExecuteUtility`, `checkGetPrivateEvents`, `checkCreateAuthWit` all call `validateAccountScopes` for their respective scope fields (`opts.scopes`, `opts.additionalScopes`, `eventFilter.scopes`). The empty-`calls` fast-path (lines 96, 115) is removed for any method where account scopes can still leak.

**Tests** (regression pins, per audit cross-cutting #3):
- `getAccounts canGet:false throws` (F-003)
- `getAddressBook + registerSender without data.addressBook=true throws` (F-004)
- `sendTx with opts.scopes containing unapproved account throws` (F-005)
- `simulateTx with empty calls + additionalScopes containing unapproved account throws` (F-005 fast-path closure)
- `getPrivateEvents with eventFilter.scopes containing unapproved account throws` (F-005)

**Risk**: Medium. The `enforceScope` signature change ripples to every dispatcher call site (one — line 231). The dispatcher needs to look up `dappSession.accounts` and pass it through; missing that wire causes runtime errors. Mitigation: the type system catches it (the new required argument).

**PR scope**: 1 PR, ~400-600 LOC including tests. Conventional commit: `fix(wallet-bridge): enforce accounts.canGet, data.addressBook, and account-scope allow-list`.

**Effort**: 1-2 days.

**Dependency**: None. Phase 1 is the foundation; later phases (notably F-006) depend on the dispatcher's existing `enforceCapability` shape, not on Phase 1's changes.

---

### Phase 2: F-007 — Passkey unlock binding (4-line patch)

**Purpose**: Add the missing `recovery.credentialId !== snapshot.credentialId` check before `sessionManager.open(...)` in `unlockPasskeyProfile`.

**Files touched**:
- `packages/extension/src/wallet/services/profile/service.ts` — insert check between line 311 and line 313.
- `packages/extension/src/wallet/services/profile/service.integration.test.ts` — mirror the existing `exportPlain` test at lines 321-330, adapted for `unlockPasskeyProfile`.

**Code shape**:

```typescript
// Insert immediately after recovery = await this.acquireRecovery(...)
if (recovery.credentialId !== snapshot.credentialId) {
  throw new Error("Invalid profile id")
}
```

**Tests**:
- `unlockPasskeyProfile rejects credentialData for a different credential` (regression pin for F-007).

**Risk**: Very low. The check is already present in `exportPlain` (line 656-660) and the restore path (line 916-919). This patch closes the parity gap.

**PR scope**: 1 PR, ~20 LOC. Conventional commit: `fix(profile): bind passkey credential id to target profile on unlock`.

**Effort**: < 1 hour.

**Dependency**: None. Ships independently of Phase 1.

---

### Phase 3: F-011 — RPC URL allowlist

**Purpose**: Reject `javascript:`, `data:`, `file:`, `chrome:`, `ftp:` and non-loopback `http:` URLs at the schema boundary, including persisted shapes.

**Files touched**:
- `packages/extension/src/wallet/services/network/spec.ts` — add `RpcUrlSchema` refine; apply to `NetworkEndpointSchema.rpcUrl`, `NetworkInfoSchema.rpcUrl`, `addNetwork`/`addEndpoint`/`updateEndpoint` param schemas.
- `packages/extension/src/wallet/services/network/service.ts` — `restore()` should fail individual entries via the schema parse (no separate validation logic).
- `packages/extension/src/wallet/services/network/service.test.ts` — regression pins.

**Code shape**: per `rpc-url-allowlist.md`. `https:` always allowed; `http:` only for `localhost`, `127.0.0.1`, `[::1]`. All other schemes rejected with a structured error.

**Tests** (regression pins):
- `addNetwork("Evil", "javascript:alert(1)") rejects`
- `addNetwork("Bad", "http://attacker.example.com") rejects`
- `addNetwork("Local", "http://localhost:8888") accepts`
- `restore([{...rpcUrl: "data:..."}]) flags the entry as a restore error`

**Risk**: Low. e2e:agent uses loopback exclusively; CI is unaffected. Existing wallets default to `https://` so no migration cost.

**PR scope**: 1 PR, ~80 LOC. Conventional commit: `fix(network): reject non-https RPC URLs except loopback (F-011)`.

**Effort**: 0.5-1 day.

**Dependency**: None.

---

### Phase 4: F-006 — Session revocation teardown

**Purpose**: Tear down upstream `ActiveSession` when `DappSession` is deleted or expires; fail-closed in `enforceCapability` when session is missing.

**Files touched**:
- `packages/extension/src/wallet/services/dapp-session/spec.ts` — add `walletSdkSessionId?: string` to `DappSession` (or migration-safe optional field).
- `packages/extension/src/wallet/services/dapp-session/service.ts` — record `walletSdkSessionId` at `setVerificationHash` (or session-establish) time.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` — subscribe to `dappSessionService.onDappSessionDeleted` and call `handler.terminateSession(walletSdkSessionId)`.
- `packages/wallet-bridge/src/dispatcher.ts` — change line 736 from `return []` to fail-closed throw for non-exempt methods.
- `packages/extension/src/wallet/services/dapp-session/service.test.ts` + `packages/wallet-bridge/src/dispatcher.test.ts` — regression pins.

**Architectural call — schema field vs iteration**: I recommend `walletSdkSessionId?: string` (Option 1a from `session-revocation-teardown.md`). The audit explicitly noted O(n) iteration as error-prone; with the schema field, termination is O(1) and the relationship is explicit + grep-able. Migration cost is near-zero (optional field; old sessions without the field continue to work — they'll just not get torn down until next reconnect, which is acceptable for an audit-fix).

**Cross-package boundary**: This phase DOES introduce a new cross-package dependency: `wallet-sdk/background.ts` (in `extension`) listens to events from `dapp-session/service.ts` (in `extension`). Both are L5 in the extension component hierarchy — same package, no layer violation. The `handler.terminateSession()` call goes through upstream `@aztec/wallet-sdk` (already imported). **No ARCHITECTURE.md layer crossing.**

**Code shape**:

```typescript
// wallet-sdk/background.ts — additional listener wired during init
dappSessionService.onDappSessionDeleted.add((session) => {
  if (session.walletSdkSessionId) {
    handler.terminateSession(session.walletSdkSessionId)
  }
})
```

```typescript
// dispatcher.ts:735-736 — fail-closed
const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(
  ctx.origin, String(ctx.chainId)
)
if (!dappSession) {
  throw new Error("No dApp session found or session expired")
}
```

**Tests** (regression pins):
- `delete DappSession → live ActiveSession is terminated` (integration test with mock handler).
- `network-only method (getPrivateEvents) after delete throws` (dispatcher unit test).
- `getChainInfo, requestCapabilities still work without session` (exempt-method preservation).
- `expired DappSession → onDappSessionDeleted fires → ActiveSession torn down` (lifecycle test).

**Risk**: Medium-High. The fail-closed change at dispatcher:735-736 is a **behavior change**: a dApp that previously got an empty result for a network-only method after disconnect now gets an error. Could surface latent bugs in dApps that depend on the silent-pass-through behavior. Mitigation: error message includes "session expired" diagnostic; existing dApp pattern `try { getAccounts } catch { requestCapabilities }` already handles thrown errors.

**Codex consult before merge**: yes. The session-id correspondence between `DappSession.id` (Nulo 128-bit hex) and upstream `sessionId` (= discovery `requestId`) is fragile; I want a second-family check that the wire-up at session-establish time is race-safe.

**PR scope**: 1 PR, ~300 LOC. Conventional commit: `fix(dapp-session): tear down live wallet-sdk transport on session revocation`.

**Effort**: 2-3 days.

**Dependency**: None on Phase 1 (different layer). Logical dependency: ships after Phase 1 only because Phase 1 was the cheaper architectural lift.

---

### Phase 5: F-012 — Live node chain identity rebind

**Purpose**: Before any signing/proving, compare `node.getNodeInfo().{l1ChainId, rollupVersion}` against the selected `NetworkInfo`. Fail-closed on mismatch.

**Files touched**:
- `packages/aztec-runtime/src/account/nulo-account.ts` — in `buildTxExecutionRequest`, fetch live node info, compare to stored `NetworkInfo`.
- `packages/aztec-runtime/src/pxe/chain-runtime.ts` — same check in any other signing/proving entry points (lines 199-229).
- `packages/extension/src/wallet/services/execution/service.ts` — apply rebind check on the `getChainInfo` response path (lines 1643-1647).
- `packages/extension/src/wallet/services/network/spec.ts` — extend `NetworkInfo` to persist `l1ChainId` + `rollupVersion` as separate fields (currently composite only).
- Regression test pins in colocated test files.

**Architectural call — composite vs separate fields**: The audit's "stronger still" recommendation (persist + compare both fields separately) is the right call. The composite chain id is a packed encoding that can collision-truncate under pathological input (the audit dropped that as low-impact, but it remains a robustness issue here). Storing both separately costs ~16 bytes per network row and gives the rebind check a direct comparison.

**Cross-package boundary**: This phase DOES cross packages: `aztec-runtime` (L4) reads from `NetworkInfo` whose schema is owned by `extension/wallet/services/network/spec.ts` (L4/L5). Currently `aztec-runtime` receives the schema-decoded `NetworkInfo` via a constructor parameter; the schema extension lives in `extension`, but `aztec-runtime` just consumes the shape. **No layer violation if the `NetworkInfo` interface is mirrored in `aztec-runtime`** (it likely already is; spot-check during implementation).

**Code shape**:

```typescript
// nulo-account.ts: buildTxExecutionRequest
const liveInfo = await this.node.getNodeInfo()
if (
  liveInfo.l1ChainId !== this.networkInfo.l1ChainId ||
  liveInfo.rollupVersion !== this.networkInfo.rollupVersion
) {
  throw new ChainIdentityMismatchError(this.networkInfo, liveInfo)
}
```

**Tests** (regression pins):
- `signing with mismatched node l1ChainId throws ChainIdentityMismatchError`
- `signing with mismatched rollupVersion throws`
- `signing with matching live info proceeds normally`
- `getChainInfo response: live mismatch causes the call to throw (fail-closed)`

**Risk**: Medium. The `node.getNodeInfo()` call is an extra network round-trip per signing op. Caching is permissible (call once per dispatch + memoize for the duration of the request) — flag for codex review.

**PR scope**: 1 PR, ~200 LOC. Conventional commit: `fix(aztec-runtime): rebind live node chain identity before signing (F-012)`.

**Effort**: 1-2 days.

**Dependency**: None on Phase 1. Ships after Phase 3 (F-011) ideally because F-011 closes the URL-acceptance hole that F-012 partially compensates for — defense in depth makes more sense when both are present.

---

### Phase 6: F-008 + F-009 — Approval card structured args + Unicode sanitization

**Purpose**: Make argument summaries the PRIMARY visual content of the approval card; route every attacker-controlled string through `sanitizeWireString`; show full origin (not just hostname) on the approval surface.

**Files touched** (per `approval-card-redesign.md`):
- `packages/extension/src/popup/windows/execute/OperationCard.vue` — convert to router-by-kind; demote JSON viewer to footer link.
- NEW `OperationCardTransfer.vue` (send_transaction + aztec_sendTx) — structured args.
- NEW `OperationCardRegisterToken.vue` — sanitized token name/symbol + verification badge.
- NEW `OperationCardRegisterContract.vue` — sanitized artifact name + class id.
- `packages/extension/src/composables/useDappHostname.ts` — return full origin alongside hostname; surface scheme/port differences visually.
- `packages/extension/src/components/composite/DappIdentityBlock.vue` — render full origin string + visual untrusted-metadata marker for `dapp.name`.
- `packages/extension/src/popup/windows/verify/index.vue` — sanitize raw name renders (lines 200-210).
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue` — sanitize token symbols/names (lines 49, 90, 102, 135-137).
- Colocated test files (NEW `OperationCardTransfer.test.ts` etc.).

**Architectural call — split or coupled**: I argued strongly against splitting F-008 and F-009 into separate phases. The OperationCard is the shared rendering surface for both. Splitting forces two passes over the same template — first to add structured args (introducing new render sites for attacker strings), then to retroactively sanitize them. The unified phase ensures every NEW render site is sanitized by construction.

**Transfer-first sub-sequencing within Phase 6**: Land the transfer card first as a separate PR (highest impact, lowest risk to get the UX right). Validate the UX direction before expanding to registerToken / registerContract / createAuthWit / executeUtility.

**Tests** (regression pins):
- `OperationCardTransfer renders recipient + amount + token without raw JSON viewer dependency`
- `dapp.name with RTL override is stripped before render`
- `tokenMetadata.symbol with zero-width space is stripped + length-clamped`
- `artifact.name with bidi codepoints is stripped`
- `full origin (with scheme + port) is displayed on approval card`

**Risk** (the user's anxiety point): The typed-arg parsing is the riskiest piece. **My risk assessment**:
- The `Action.kind === "transfer"` discriminator is internal to Nulo (`SendAction` enum in `wallet-bridge/action.ts`). Arguments are typed by Nulo, not the dApp. **Low risk of parsing failure** on the transfer happy path.
- For arbitrary contract calls (typed by ABI but semantically opaque), the fallback is to display typed labels + values verbatim with collapse-above-5 — **graceful degradation** if a particular kind's arg shape is unexpected.
- The JSON viewer staying as a footer link is the **defense-in-depth escape hatch**: even if structured rendering bugs out, the user can always open full JSON to verify.

**Rollback story**: If a release ships with broken parsing for a specific op kind, the OperationCard router falls back to the current template (a kind-agnostic generic display) and prominently shows the "View Full JSON" link. The structured rendering is additive, never substitutive — there's no path where the user is left with no information. **Codex consult on the router pattern itself before merge**: yes, specifically on the fallback path.

**PR scope**: 3-5 PRs (transfer first; sanitization sweep separate; register-token + register-contract separate; createAuthWit + executeUtility last). Conventional commits: `feat(execute): structured argument summary for transfer approvals (F-008)`, `fix(execute): sanitize attacker-controlled display strings (F-009)`, etc.

**Effort**: 3-5 days total across PRs.

**Dependency**: None on prior phases (UI-only).

---

### Phase 7: F-001 + F-002 — Frame-scoped discovery (Nulo-side defense-in-depth)

**Purpose**: Reject subframe discovery messages locally; target session messages to the originating frame.

**Files touched**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` — content listener subframe rejection (line 121-135); `sendToTab` frame-targeted variant (line 118).
- `packages/extension/src/content-script/content.ts` — reject unsolicited discovery approvals in the content script unless a matching pending request exists.
- Session-key extension to include `frameId` for frames > 0 (defense-in-depth even if upstream attribution stays broken).
- Colocated tests.

**Architectural call — F-001 vs F-002 coupling**: The audit groups them. I disagree on the FIX coupling. F-001 (subframe attribution) is closed by **rejecting `sender.frameId !== 0`** unilaterally. F-002 (tab-wide replies) is closed by **`chrome.tabs.sendMessage(tabId, message, { frameId })`** — a different code site. The two CAN ship independently:

- **F-001 ships first**: 1-hour patch in `addContentListener`. Closes the iframe-credited-as-top-frame attack class entirely.
- **F-002 ships second**: requires upstream `ActiveSession` to carry `frameId`, OR a local Nulo map of `(origin, chainId) → frameId` populated at discovery time. The local map is feasible but adds a new piece of state.

I recommend a single PR that bundles BOTH because they share the same trust-boundary fix narrative, and ARCHITECTURE.md's per-package PR-gate philosophy keeps merge complexity local. But if Phase 7 risks slipping, F-001 alone is shippable as a defensive partial fix.

**Coordinate upstream**: File `@aztec/wallet-sdk` issue/PR for `MessageSender.frameId`, `MessageSender.url`, attribution fix at `background_connection_handler.ts:187-188`, `ActiveSession.frameId`. Track as a separate coordination doc, not blocking Nulo-side phase.

**Tests** (regression pins):
- `subframe sender (frameId > 0) is rejected before reaching upstream handler`
- `discovery approval is sent only to the originating frameId, not the whole tab`
- `sibling frame in same tab cannot pick up discovery approval`

**Risk**: Medium. The subframe rejection is a **behavior change** that breaks iframe-hosted dApp wallets, IF any exist. Confirm with product: are iframe dApps a supported use case? If yes, default-reject + allowlist by origin. If no, reject-all.

**PR scope**: 1-2 PRs. Conventional commit: `fix(wallet-sdk): reject subframe discovery and frame-target session messages (F-001, F-002)`.

**Effort**: 2-3 days.

**Dependency**: None on prior phases.

---

### Phase 8: `/harden security max` re-run

**Purpose**: Verify all 11 findings are closed; catch any new findings introduced by Phases 1-7.

**Inputs**:
- Pre-fix baseline: `audit/security/2026-06-08-ultra-e6759a/`
- Post-fix codebase state on `dev` after all phase PRs merge.

**Method**: Run `/harden security max` (one cluster less than `ultra` so cheaper). Compare new findings vs the 11 fixes:
- Each of F-001..F-012 (minus F-010) should appear in the "previously-flagged, now closed" annex.
- Any NEW finding triggers a follow-up phase.

**Specific regression sites to check**:
- The new `enforceScope` signature: does any caller miss the `sessionAccounts` parameter?
- The session-termination wire-up in `wallet-sdk/background.ts`: any race between delete and terminate?
- The chain identity rebind: does the extra `getNodeInfo()` call introduce timing-attack signal?
- The OperationCard structured render: any new attacker-controlled strings rendered unsanitized?

**Effort**: 60-90 min wall (one model family, max not ultra). Plus follow-up triage.

---

## Cross-finding pattern analysis

The audit's "trust checked once, reused too broadly" framing is **descriptively** correct but I refine four couplings:

**F-001/F-002**: Audit couples them; fixes are technically independent (subframe filter vs frameId targeting). Bundle in Phase 7 for narrative coherence only.

**F-003/F-004/F-005**: Audit treats as separate; architecturally coupled (same file, same registry, F-005's signature change benefits F-003/F-004). **Phase 1 bundles all three.**

**F-006**: Audit lumps with the "trust checked once" pattern; architecturally it's a **lifecycle teardown** problem in a different package, crossing the upstream `BackgroundConnectionHandler` boundary. **Standalone Phase 4.**

**F-011/F-012**: Audit couples them as defense-in-depth narrative. Fixes are independent (different files, different packages). I sequence F-011 (Phase 3) before F-012 (Phase 5) only because F-011 is the cheaper lift; either can slip without breaking the other.

**F-008/F-009**: Audit lists separately; fix is one architectural change to OperationCard. **Phase 6 bundles them.**

The audit's cross-cutting #3 ("regression test pin per fix") is the only cross-cutting that ports uniformly. Every phase ships test pins.

## Security & Adversarial Considerations

**Refactor risks** (Phase 1 signature change):
- Dispatcher call site forgets `sessionAccounts` → caught by required-arg TypeScript.
- New method later registered in `METHOD_SCOPE_CHECKER` without account-scope check → uniform `(args, grants, sessionAccounts) => void` signature signals the requirement.
- Empty-`calls` fast-path closure → regression test verifies empty `calls` still passes when there are no `additionalScopes` to widen.

**Per-finding adversarial verifications** (each phase regression-tests these explicitly):
- **F-003/F-004**: dApp granted `canGet:false` / `addressBook:false` cannot read addresses or address book on EITHER `requestCapabilities` response path OR later getter handler.
- **F-005**: dApp with single-account grant cannot widen via `opts.scopes`, `opts.additionalScopes`, or `eventFilter.scopes` across any of `sendTx`, `simulateTx`, `profileTx`, `executeUtility`, `getPrivateEvents`.
- **F-006**: After `deleteDappSession`, any subsequent dApp call throws (network-only methods included), not silently succeeds.
- **F-007**: Passkey unlock with wrong credentialData throws, no session opened.
- **F-008/F-009**: Approval render with RTL + zero-width + homoglyph attack on dApp name + token symbol + artifact name shows sanitized output AND structured args.
- **F-011**: `javascript:`, `data:`, `file:`, `chrome:`, `ftp:`, non-loopback `http:` all rejected; restored state with bad URLs flags errors.
- **F-012**: Signing with mismatched `l1ChainId` or `rollupVersion` throws. `getNodeInfo` cached per dispatch to avoid timing-leak signal.
- **F-001/F-002**: Subframe rejected; discovery approval reaches only originating frame; sibling-frame can't pick up.

**Aztec-specific**: F-012 explicitly guards against L1 chain mixup + rollup version drift (the two stronger threats given a malicious endpoint accepted via F-011's gap). Reorg/replay are out of scope.

## Assumptions

**Facts** (file:line citations):
- `enforceScope(methodName, args, grants)` at `packages/wallet-bridge/src/scope-enforcement.ts:293`.
- `getAccounts` in `EXEMPT_METHODS` at `packages/wallet-bridge/src/capability-map.ts:14`.
- Empty-calls fast-path at `packages/wallet-bridge/src/scope-enforcement.ts:96, 115`.
- `unlockPasskeyProfile` at `packages/extension/src/wallet/services/profile/service.ts:281-329`.
- Reference binding pattern in `exportPlain` at `packages/extension/src/wallet/services/profile/service.ts:656-660`.
- `deleteDappSession` emits `onDappSessionDeleted` at `packages/extension/src/wallet/services/dapp-session/service.ts:283`.
- `enforceCapability` returns `[]` on missing session at `packages/wallet-bridge/src/dispatcher.ts:735-736`.
- `z.string().url()` only validation at `packages/extension/src/wallet/services/network/spec.ts:120-145`.
- Node factory boundary at `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:15-17`.
- `sanitizeWireString` at `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:104-166`.

**Inferences**:
- *High confidence*: Phase 1 signature change is TypeSystem-enforced; the dispatcher's single `enforceScope` call site won't compile without `sessionAccounts`.
- *Moderate confidence*: F-006's `walletSdkSessionId` == upstream `requestId`; verify at impl time the upstream's `activeSessions` Map key is that exact value.
- *Moderate confidence*: F-012's `node.getNodeInfo()` adds <500ms per dispatch; cache per-dispatch.
- *High confidence*: F-008 transfer args extractable from Nulo's typed `Action` model in `wallet-bridge/action.ts` without ABI consultation.

**Asks** (to surface):
- Iframe dApps: supported or not? Drives F-001 scope (reject-all vs origin allowlist).
- Loopback hosts: strict 3-host list (`localhost`, `127.0.0.1`, `[::1]`) or extend?
- F-008 collapse threshold: default 5 args visible, rest collapsed.
- F-006 fail-closed: release-note callout if any dApp depends on silent-pass-through.

## Test strategy

Per audit cross-cutting #3: **every remediation PR lands a regression test pin**.

**Per-phase regression test design**:
- **Phase 1**: 5 unit tests in `scope-enforcement.test.ts` (1 per sub-grant + 1 fast-path closure + 1 cross-account-scope-validator test). All under `bun run test --filter wallet-bridge`.
- **Phase 2**: 1 integration test in `service.integration.test.ts` mirroring the existing `exportPlain` pattern.
- **Phase 3**: 5 unit tests in `network/service.test.ts` covering reject + accept cases + restore path.
- **Phase 4**: 1 lifecycle integration test (delete → terminate); 1 dispatcher unit test (missing session → throw); 1 expired-session test.
- **Phase 5**: 4 chain-identity tests in `nulo-account.test.ts` + `chain-runtime.test.ts`.
- **Phase 6**: Vue component tests in `OperationCardTransfer.test.ts` + sanitization tests in render sites. Component test coverage minimums per CLAUDE.md (≥10 cases for L3 composites — `OperationCard.vue` straddles L3/L5 but the transfer sub-component is essentially L3).
- **Phase 7**: 3 content-listener tests (subframe reject, frame-targeted send, sibling-frame can't pick up approval). Mock `chrome.tabs.sendMessage` and `chrome.runtime.onMessage`.

**Cross-phase smoke**: `bun run test:e2e` smoke after each phase merges to dev. Network e2e (`bun run e2e:agent`) for Phases 4, 5, 7 which touch transport / signing / discovery flows.

**Audit verifier**: Phase 8's `/harden security max` re-run is itself the meta-test — it independently re-reads source and verifies each F-001..F-012 (minus F-010) closure.

## Open architectural questions

**Where I disagree with the audit's framing**:
1. The audit's "trust checked once" cross-cutting is descriptively right, prescriptively wrong. It tempts the implementer toward a unified primitive that doesn't exist. The plan explicitly resists this temptation.
2. The audit pairs F-011 + F-012 as "fix together." I argue they can ship independently and SHOULD because F-012 carries a latency cost (extra `getNodeInfo` per sign) that warrants its own performance review.
3. The audit pairs F-008 + F-009 implicitly. I argue they are MORE coupled than the audit acknowledged — they share the rendering surface, and splitting them creates a half-fixed approval card.

**Where the research left ambiguities**:
1. F-006's `walletSdkSessionId` schema field: when exactly is it set? At discovery-approval or at first `setVerificationHash`? Resolved in plan: at `setVerificationHash` time (when the `ActiveSession` is known to exist).
2. F-012's `getNodeInfo` caching: per-dispatch or per-tx? Resolved in plan: per-dispatch (memoize for the duration of a single wallet-sdk message → wallet-bridge dispatch → result).
3. F-008's per-op-type sub-components: 3 high-change (transfer, registerToken, registerContract) plus inline for the rest? Or all 12+ kinds get split? Resolved in plan: hybrid (3 sub-components + inline for the rest) per the research artifact's recommendation.

**Where I want codex consult**:
- F-006 session-id correspondence + race semantics.
- F-008 OperationCard router fallback path (what does the user see if a sub-component throws during render?).
- F-012 `getNodeInfo` caching policy.

## Seeds

**`/goal` seed**:
```
implement security-audit-remediation plan-opus.md
phases 1-8, sequential, one PR per phase (or per sub-PR within phase 6)
gates: bun run audit:vue + bun run test:e2e per phase
phase 4 + phase 6 require /codex consult before merge
phase 8 is the closure verification — do not skip
```

**`/loop` seed**:
```
plan: implementations-plan/security-audit-remediation/plan-opus.md
state: starting phase 1
next: extend enforceScope signature with sessionAccounts; add checkGetAccounts, checkGetAddressBook, checkRegisterSender; close empty-calls fast-path for F-005; remove getAccounts from EXEMPT_METHODS; pass dappSession.accounts from dispatcher; add 5 regression tests
gate: bun run audit:vue passes; bun run test --filter wallet-bridge passes; new tests in scope-enforcement.test.ts pin F-003, F-004, F-005 each.
on green: open PR with conventional commit "fix(wallet-bridge): enforce accounts.canGet, data.addressBook, and account-scope allow-list"
log lessons: implementations-plan/security-audit-remediation/lessons/phase-1.md
```
