# Remediation Plan — security audit (2026-06-08)

## Summary
This plan implements 11 of the 12 consolidated findings: `F-001`, `F-002`, `F-003`, `F-004`, `F-005`, `F-006`, `F-007`, `F-008`, `F-009`, `F-011`, and `F-012`. `F-010` stays deferred. The sequencing follows the chosen policy: cheapest wins land early, but only after a small architectural setup PR that removes the current pattern of checking trust once and then reusing it too broadly.

The refactor is intentionally narrow. Verified code shows the findings split across three different layers: wallet-bridge authorization (`packages/wallet-bridge/src/dispatcher.ts:227-232`, `packages/wallet-bridge/src/scope-enforcement.ts:269-297`), wallet-sdk session lifetime (`packages/extension/src/wallet/services/wallet-sdk/background.ts:110-247`, `packages/extension/src/wallet/services/dapp-session/service.ts:274-319`), and network/runtime trust (`packages/extension/src/wallet/services/network/spec.ts:13-48`, `packages/aztec-runtime/src/account/nulo-account.ts:92-137`, `packages/extension/src/wallet/services/execution/service.ts:1643-1647`). So Phase 1 only fixes the first layer and sets hooks for the rest; later phases close the actual sinks.

## Phases

### Phase 1: Architectural setup — sub-grant enforcement + trust re-check
- What's built: extend `METHOD_SCOPE_CHECKER` to accept optional session context; add explicit sub-grant checkers for `getAccounts`, `getAddressBook`, and `registerSender`; add a reusable account-scope-list validator hook for later `F-005`; make dispatcher capability enforcement fail closed when a non-exempt method has no backing session.
- Closes: `F-003`, `F-004` directly. Sets up `F-005` and the fail-closed half of `F-006`. Does not close `F-012`.
- Files touched: `packages/wallet-bridge/src/scope-enforcement.ts`, `packages/wallet-bridge/src/capability-map.ts`, `packages/wallet-bridge/src/dispatcher.ts`, `packages/wallet-bridge/src/scope-enforcement.test.ts`, `packages/wallet-bridge/src/dispatcher.test.ts`.
- Concrete code shape:
  - Add `type ScopeEnforcementContext = { sessionAccountAddresses?: ReadonlySet<string> }`.
  - Change `enforceScope(methodName, args, grants)` to `enforceScope(methodName, args, grants, ctx?)`.
  - Add `checkGetAccounts`, `checkGetAddressBook`, `checkRegisterSender`, and `assertAllowedAccountScopes(fieldName, rawScopes, allowed)`.
  - In `dispatcher.ts`, load the `DappSession` once near the current auth choke point at `dispatch()` (`packages/wallet-bridge/src/dispatcher.ts:227-232`) and pass `new Set(session.accounts)` into `enforceScope(...)`.
  - In `enrichGrantedCapabilities()` (`packages/wallet-bridge/src/dispatcher.ts:676-719`), return `accounts: []` when stored `accounts.canGet !== true`; do not leak the selected addresses on the initial grant response.
  - In `enforceCapability()` (`packages/wallet-bridge/src/dispatcher.ts:729-744`), replace the permissive `if (!dappSession) return []` with a fail-closed throw for non-protocol methods. Keep `requestCapabilities`/`batch` exempt; keep `getAccounts` on its dedicated handler path so the existing `No dApp session found` and `4100` contracts pinned in `dispatcher.test.ts:340-418` survive.
- Test pins:
  - `scope-enforcement: getAccounts requires accounts.canGet=true`
  - `scope-enforcement: getAddressBook requires data.addressBook=true`
  - `scope-enforcement: registerSender requires data.addressBook=true`
  - `dispatcher: requestCapabilities does not echo selected accounts when canGet=false`
  - `dispatcher: getAccounts with canGet=false throws CapabilityNotGrantedError`
  - `dispatcher: non-exempt network-only method throws when session lookup misses`
- Risk:
  - Argument against refactor: `F-003` and `F-004` alone are small patches.
  - Argument for refactor: the current coarse-then-fine split already exists at `dispatch()` and `scope-enforcement.ts`; `F-005` needs the same session context, and `F-006` needs the same “missing session is fatal” rule.
  - Pick: do the minimal refactor here, but do not try to fold `F-006` transport teardown or `F-012` chain binding into the same primitive. `trust-recheck-primitive.md` is right that a “one primitive closes all 5” design is overengineered.
- PR shape: 1 PR.
- Effort: 6-8 hours.
- Rollback: clean revert; no storage migration.

### Phase 2: F-007 passkey unlock binding
- What's built: mirror the existing `exportPlain` credential-binding check inside `unlockPasskeyProfile()`.
- Closes: `F-007`.
- Files touched: `packages/extension/src/wallet/services/profile/service.ts`, `packages/extension/src/wallet/services/profile/service.integration.test.ts`.
- Concrete code shape:
  - After `const recovery = await this.acquireRecovery(...)` at `packages/extension/src/wallet/services/profile/service.ts:311`, add:
    - `if (recovery.credentialId !== snapshot.credentialId) throw new Error("Invalid profile id")`
  - This mirrors the verified pattern already present in `exportPlain` at `packages/extension/src/wallet/services/profile/service.ts:656-660`.
- Test pins:
  - `unlockPasskeyProfile rejects credentialData for a different credential`
  - `unlockPasskeyProfile still succeeds for matching credentialData`
- Risk: extremely low. This only tightens an existing trust check and does not change ceremony transport.
- PR shape: 1 PR.
- Effort: under 1 hour.
- Rollback: revert the guard and test.

### Phase 3: Wire dependent findings into Phase 1 primitives
- What's built:
  - `F-005`: populate the account-scope allow-list hook for all attacker-controlled scope arrays: `getPrivateEvents`, `simulateTx`, `profileTx`, `executeUtility`, and `sendTx` / default-entrypoint paths.
  - `F-006`: terminate live wallet-sdk channels when the backing `DappSession` is deleted or expires.
  - `F-012`: rebind live node identity to the selected network before any signing/proving/authwit or `getChainInfo` response.
- Closes: `F-005`, `F-006`, `F-012`.
- Files touched:
  - `packages/wallet-bridge/src/scope-enforcement.ts`
  - `packages/wallet-bridge/src/dispatcher.ts`
  - `packages/extension/src/wallet/services/wallet-sdk/background.ts`
  - `packages/extension/src/wallet/services/network/spec.ts`
  - `packages/extension/src/wallet/services/network/service.ts`
  - `packages/aztec-runtime/src/account/nulo-account.ts`
  - `packages/extension/src/wallet/services/execution/tx-request-builder.ts`
  - `packages/extension/src/wallet/services/execution/service.ts`
  - `packages/extension/src/wallet/services/execution/authwit-discoverer.ts`
  - `packages/extension/src/wallet/services/execution/fast-path.ts`
  - `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts`
  - Tests in `scope-enforcement.test.ts`, `dispatcher.test.ts`, `network/service.test.ts`, plus new `wallet-sdk/background.test.ts`.
- Concrete code shape:
  - `F-005`: remove the “empty calls means done” loophole by separating call-scope checks from account-scope checks. Today `sendTx` and `simulateTx` return early on `calls.length === 0` (`packages/wallet-bridge/src/scope-enforcement.ts:90-129`), while execution later forwards `additionalScopes`/`scopes` into PXE (`packages/extension/src/wallet/services/execution/service.ts:1803-1818`, `1832-1835`, `1846-1851`, `2098-2153`). The validator should reject any scope entry not present in `session.accounts`.
  - `F-006`: subscribe to `dappSessionService.onDappSessionDeleted` inside `initWalletSdkHandler()` and terminate every active wallet-sdk session whose `(origin, chainId)` matches the deleted session. Do not store a single `walletSdkSessionId` on `DappSession`; one stored session can legitimately back multiple live tabs, so matching `handler.getActiveSessions()` by tuple is safer.
  - `F-012`: add optional persisted raw identity fields on `Network` (`l1ChainId`, `rollupVersion`) while keeping the existing composite `chainId` for compatibility. Probe and store them on add/update/restore. Add one shared `assertLiveChainIdentity(network, nodeInfo)` helper and call it before:
    - `NuloAccount.buildTxExecutionRequest()` (`packages/aztec-runtime/src/account/nulo-account.ts:92-137`)
    - `TxRequestBuilder.buildStandard()` / `buildNoFrom()` (`packages/extension/src/wallet/services/execution/tx-request-builder.ts:101-106`, `447-454`)
    - `executeAztecCreateAuthWit()` (`packages/extension/src/wallet/services/execution/service.ts:2194-2207`)
    - `AuthwitDiscoverer` (`packages/extension/src/wallet/services/execution/authwit-discoverer.ts:100-101`)
    - `fast-path.ts` and `batched-view-simulation.ts` (`packages/extension/src/wallet/services/execution/fast-path.ts:170-175`, `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:236-243`)
    - `executeAztecGetChainInfo()` (`packages/extension/src/wallet/services/execution/service.ts:1643-1647`)
- Test pins:
  - `scope-enforcement: sendTx additionalScopes must be subset of session accounts even when calls=[]`
  - `scope-enforcement: executeUtility opts.scopes outside session are rejected`
  - `background: deleting DappSession tears down every matching active session`
  - `dispatcher: deleted session blocks getPrivateEvents/registerSender/registerContract`
  - `network: live node identity mismatch rejects tx build`
  - `execution: getChainInfo fails closed when live node identity drifts`
- Risk:
  - `F-006`: tuple-match teardown will disconnect all tabs for that origin+chain. That is correct for “Disconnect app”.
  - `F-012`: storage shape grows. Make raw identity fields optional and lazy-backfill old rows so rollback is safe.
- PR shape: 2 PRs. `3a = F-005/F-006`, `3b = F-012`.
- Effort: 1.5-2 days.
- Rollback:
  - `3a`: revert scope-array enforcement + teardown listener together.
  - `3b`: revert runtime validator; keep added storage fields ignored if the rollback happens after merge.

### Phase 4: F-001 + F-002 coupled (frame-vs-tab)
- What's built: main-frame-only discovery plus request-correlation defense in depth on both sides of the content-script boundary.
- Closes: `F-001`, `F-002` on the Nulo side. Leaves an upstream cleanup item.
- Files touched: `packages/extension/manifest/manifest.config.ts`, `packages/extension/src/content-script/content.ts`, `packages/extension/src/wallet/services/wallet-sdk/background.ts`, tests under `packages/extension/src/wallet/services/wallet-sdk/`.
- Concrete code shape:
  - Set `all_frames: false` in the manifest unless a real iframe integration must be preserved. Today injection is explicit in `packages/extension/manifest/manifest.config.ts:31-37`.
  - In `content.ts`, wrap `sendToBackground` to remember pending discovery `requestId`s, and wrap `addBackgroundListener` to ignore `DISCOVERY_APPROVED` unless the local frame initiated that request.
  - In `background.ts`, reject any content-script message whose `sender.frameId > 0`, even if the message shape is otherwise valid. Keep this even after the manifest clamp as defense in depth.
- Nulo-side vs upstream:
  - Nulo can fully close the present exploit chain locally because the bug only matters when subframes can both receive approvals and act on them. Main-frame-only injection plus local pending-request checks remove that capability.
  - Upstream still should be fixed because its public types do not model `frameId` or `sender.url` (`node_modules/@aztec/wallet-sdk/src/extension/handlers/internal_message_types.ts:61-68`) and its transport is tab-only (`background_connection_handler.ts:82-93`). File an upstream PR/issue for long-term maintainability and future iframe support.
- Test pins:
  - `content-script ignores unsolicited discovery-approved`
  - `background rejects sender.frameId > 0`
  - `main-frame discovery still succeeds`
- Risk: if any production dApp depends on iframe embedding, this breaks connect. If that exists, switch from manifest clamp to explicit frame-scoped routing instead of landing this variant.
- PR shape: 1 PR in Nulo + 1 upstream issue/PR.
- Effort: 1 day.
- Rollback: revert manifest/background clamp if a required iframe integrator surfaces; keep the pending-request correlation in place.

### Phase 5: F-011 RPC scheme allowlist
- What's built: strict RPC URL policy at schema level, restore path, and node-factory boundary.
- Closes: `F-011`.
- Files touched: `packages/extension/src/wallet/services/network/spec.ts`, `packages/extension/src/wallet/services/network/service.ts`, `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts`, `packages/extension/src/wallet/services/network/service.test.ts`, plus optional adapter unit test.
- Concrete code shape:
  - Introduce `RpcUrlSchema` in `network/spec.ts`.
  - Allow `https:` for any host; allow `http:` only for exact loopback literals.
  - Replace plain `z.string()` on `NetworkEndpoint.rpcUrl` and `NetworkInfo.rpcUrl` (`packages/extension/src/wallet/services/network/spec.ts:77-100`) and replace `.url()` params on `addNetwork` / `addEndpoint` / `updateEndpoint` (`packages/extension/src/wallet/services/network/spec.ts:120-145`).
  - In `restore()` (`packages/extension/src/wallet/services/network/service.ts:613-633`), validate the imported URL and re-probe identity before persisting.
  - Add a final guard in `AztecNodeFactoryAdapter.createNode()` (`packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:15-17`) so older storage rows or future bypasses cannot reach `createAztecNodeClient(...)` unchecked.
- String match vs IP resolution:
  - Use string match on parsed `URL.hostname`. Do not add DNS/IP resolution. Resolution would introduce TOCTOU, platform variance, and “trusted because it resolved this once” bugs. The repo only shows `localhost` / `127.0.0.1` dev usage, and exact-loopback literals are sufficient.
  - Pin the exact IPv6 hostname form in tests instead of assuming whether `URL.hostname` yields `::1` or `[::1]`.
- Test pins:
  - reject `javascript:`, `data:`, `file:`, remote `http://`
  - accept `https://...`
  - accept exact loopback `http://...`
  - `restore()` returns `restoreError` for invalid endpoints
- PR shape: 1 PR.
- Effort: 4-6 hours.
- Rollback: revert schema + adapter guard; no migration needed.

### Phase 6: F-008 broad UX redesign (all 5 op types)
- What's built: a pure summary-derivation layer plus a hybrid `OperationCard` split, keeping JSON as fallback only.
- Closes: `F-008`.
- Files touched: `packages/extension/src/popup/windows/execute/OperationCard.vue`, new execute subcomponents, `packages/extension/src/popup/windows/execute/index.vue`, `packages/wallet-bridge/src/action.ts`, `packages/wallet-bridge/src/operation.ts`, new popup tests.
- Concrete code shape:
  - Add a pure `operation-summary.ts` that turns a `DraftUIOperation` into one of: `transfer`, `registerToken`, `registerContract`, `authwit`, `callSummary`, or `unknown`.
  - Keep `OperationCard.vue` as the router; extract `OperationCardTransfer.vue`, `OperationCardRegisterToken.vue`, `OperationCardRegisterContract.vue`, and a shared `OperationArgsTable.vue`.
  - Cover all approved popup-gated families: `send_transaction` / `aztec_sendTx`, `register_token`, `register_contract`, `aztec_createAuthWit`, `aztec_simulateTx` / `aztec_executeUtility` / `aztec_profileTx`.
- Typed-arg parsing risk:
  - Do not guess. Only show semantic labels like `To` and `Amount` when the operation kind, function name, and arg count match a known transfer shape from the existing typed model (`packages/wallet-bridge/src/action.ts:37-53`, `packages/wallet-bridge/src/operation.ts:79-94,176-190`).
  - If the parser cannot prove the shape, fall back to indexed argument rows (`arg[0]`, `arg[1]`, ...`) plus the raw JSON link. Better to be incomplete than wrong on the approval surface.
- Test pins:
  - `transfer summary shows recipient + amount for known transfer shape`
  - `mismatched transfer arity falls back to generic args`
  - `authwit call intent shows target contract + function`
  - `utility/profile/simulate cards show primary args without JSON dependency`
- PR shape: 2 stacked PRs.
- Effort: 1.5-2 days.
- Rollback: revert the new summary components; old JSON viewer path remains intact.

### Phase 7: F-009 Unicode sanitization sweep
- What's built: route every dApp-controlled label through `sanitizeWireString`, and show full origin strings instead of hostname-only trust anchors.
- Closes: `F-009`.
- Files touched: `packages/extension/src/wallet/services/dapp-session/capability-meta.ts`, `packages/extension/src/composables/useDappHostname.ts` or a successor helper, `packages/extension/src/components/composite/DappIdentityBlock.vue`, `packages/extension/src/popup/windows/verify/index.vue`, Phase 6 execute-card files, and any remaining token/trust popups named in the audit.
- Concrete code shape:
  - Keep the existing sanitizer implementation (`packages/extension/src/wallet/services/dapp-session/capability-meta.ts:155-165`).
  - Replace hostname-only rendering (`packages/extension/src/composables/useDappHostname.ts:8-27`, `DappIdentityBlock.vue:37-48`, `verify/index.vue:198-210`) with the session-keyed origin string, while still marking punycode/non-ASCII hosts as suspicious.
  - Apply `sanitizeWireString` to `dapp.name`, token symbol/name, artifact names, account aliases, and function labels on every approval surface.
- Test pins:
  - `dapp name strips bidi/zero-width controls`
  - `token symbol and artifact name are sanitized on execute cards`
  - `identity block shows full origin, not hostname-only`
- PR shape: 1 PR.
- Effort: 4-6 hours.
- Rollback: revert display helpers/components; sanitizer remains reusable.

### Phase 8: `/harden security max` re-run
- What's built: no code. Re-run the audit after all prior phases, compare against `audit/security/2026-06-08-ultra-e6759a/findings/consolidated.md`, and record a closure matrix.
- Closes: verification only.
- Files touched: new audit output under `audit/security/...` or `implementations-plan/security-audit-remediation/`.
- PR shape: none unless follow-up fixes are found.
- Effort: 60-90 minutes wall time.
- Rollback: none.

## Security & Adversarial Considerations
- Keep least privilege monotonic: capability type -> sub-grant -> per-call scope -> live session existence -> live chain identity. Do not let later layers “helpfully” reopen access when an earlier check fails.
- Prefer fail closed over compatibility when the current behavior leaks authority. That applies to missing sessions, invalid RPC URLs, node-identity drift, and low-confidence argument parsing.
- Do not vendor-patch `@aztec/wallet-sdk` for F-001/F-002 unless the local wrapper proves insufficient. Local hardening is faster and easier to carry; upstream coordination is still required to prevent future dependency drift.
- Treat backup/imported RPC configuration as attacker-controlled input. Validation must happen before persistence and again at the node-factory boundary.
- The UI work must never fabricate certainty. If summary derivation cannot prove semantics from the typed operation model, the card must say so and degrade to generic args + JSON.
- Every finding gets a regression pin. The audit’s cross-cutting observation #3 is correct: these are exactly the kind of fixes that silently regress during later refactors.

## Assumptions
### Facts (verified against code)
- Content scripts are injected into every frame today: `packages/extension/manifest/manifest.config.ts:31-37`.
- The wallet-sdk wrapper sends background replies to a whole tab and forwards raw Chrome senders: `packages/extension/src/wallet/services/wallet-sdk/background.ts:118-134`.
- Upstream discovery attribution still uses `sender.tab.url`, and its `MessageSender` type lacks `frameId` and `url`: `node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:181-197`, `node_modules/@aztec/wallet-sdk/src/extension/handlers/internal_message_types.ts:61-68`.
- `getAccounts` is currently capability-exempt, and the grant response currently injects selected accounts unconditionally: `packages/wallet-bridge/src/capability-map.ts:14`, `packages/wallet-bridge/src/dispatcher.ts:689-713`.
- `getAddressBook` and `registerSender` have no scope checker today: `packages/wallet-bridge/src/scope-enforcement.ts:269-279`.
- Missing sessions currently fall through as “no grants” for non-exempt methods: `packages/wallet-bridge/src/dispatcher.ts:729-744`.
- Deleting or expiring a `DappSession` emits `onDappSessionDeleted`, but wallet-sdk teardown only happens from `onSessionTerminated`: `packages/extension/src/wallet/services/dapp-session/service.ts:274-319`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:184-187`.
- `unlockPasskeyProfile()` lacks the credential-binding check that `exportPlain()` already has: `packages/extension/src/wallet/services/profile/service.ts:281-328`, `640-677`.
- RPC URLs are currently plain strings in persisted network shapes, and `restore()` persists imported rows without URL policy or re-probe: `packages/extension/src/wallet/services/network/spec.ts:77-100,120-145`, `packages/extension/src/wallet/services/network/service.ts:613-633`.
- Approval cards still hide critical argument values behind the JSON popup: `packages/extension/src/popup/windows/execute/OperationCard.vue:103-138,253-404`, `packages/extension/src/popup/windows/execute/index.vue:391-395,452-479`.

### Inferences (deduced, not directly verified)
- There is no clear product requirement for third-party iframe dApps; the only evidence is `all_frames: true`.
- One stored `DappSession` can back multiple live wallet-sdk sessions across tabs, so tuple-based teardown is safer than storing one transport session id.
- The safest F-012 implementation point is a shared chain-identity helper, not more ad hoc `node.getNodeInfo()` comparisons at each sink.

### Asks (explicit choices)
- Iframe policy: recommended `top-frame only` now. If a real iframe integrator exists, switch Phase 4 to frame-scoped routing instead of manifest clamp.
- Network identity persistence: recommended `persist raw l1ChainId + rollupVersion` on `Network` rows, optional/lazy-backfilled for older data.
- Dev hosts: recommended `exact loopback only` for `http:`. Do not widen to `host.docker.internal` or custom `.local` names without evidence.

## Test strategy
- Phase 1: wallet-bridge unit tests only. Pin sub-grant behavior and missing-session fail-closed semantics before touching session teardown.
- Phase 2: one integration test in `profile/service.integration.test.ts`; cheapest isolated win.
- Phase 3: split tests by layer. `scope-enforcement.test.ts` for `F-005`, new wallet-sdk background tests for `F-006`, and network/runtime tests for `F-012`.
- Phase 4: add focused content-script/background tests; do not rely on manual extension behavior.
- Phase 5: reuse `network/service.test.ts` for URL policy and restore-path coverage; add one adapter-boundary test if practical.
- Phase 6/7: add Vue render tests for summary correctness and sanitization. The parser itself should have pure-function tests separate from component tests.
- Phase 8: treat `/harden security max` as a regression suite, not just a confidence pass. Produce a finding-by-finding closure note.

## Seeds
- `/goal Implement implementations-plan/security-audit-remediation/plan-codex.md phases 1-7 in order, preserving current wire contracts where tests pin them, and land a regression test for every finding before moving to the next phase. Finish with /harden security max and a closure matrix.`
- `/loop Execute Phase 1 from implementations-plan/security-audit-remediation/plan-codex.md: add contextful sub-grant enforcement in wallet-bridge, close F-003/F-004, add the missing-session fail-closed hook, and land the pinned tests before opening the next PR.`
