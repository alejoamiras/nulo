# Remediation Plan — security audit (2026-06-08) [Main draft]

## Summary

Implement 11 of 12 findings from the `/harden security ultra` audit at `audit/security/2026-06-08-ultra-e6759a/`. Skip F-010 (deferred — unbounded incoming-transfer persistence; cost/benefit unfavorable this round). Final phase re-runs `/harden security max` to verify closure.

Architectural shape: **NOT one unifying trust primitive across all findings**. The audit's "trust checked once, reused too broadly" theme is real, but the fixes live in **three different layers**: scope-enforcement (F-003, F-004, F-005), session-lifetime (F-006), and runtime chain validation (F-012). A single primitive obscures the layer boundaries and pulls F-005 from "scope-checker" into "session-context-aware checker" — a bigger lift than the cheapest-wins-first principle warrants for Phase 1.

Sequencing reconciles "cheapest wins first" + "architectural refactor first" by minimizing Phase 1 scope to the genuinely-shared abstraction (sub-grant checker for F-003 + F-004 ONLY) and letting subsequent phases EXTEND the same pattern without bundling everything into a multi-day setup PR.

## Architectural decision: Phase 1 minimalism

**Phase 1 = sub-grant checker abstraction, F-003 + F-004 only.**

The research artifact `trust-recheck-primitive.md` documents that F-003 and F-004 share the **exact** shape: enforce a sub-grant bit on a method that's currently exempt-or-pass-through. F-005's account-allow-list check is structurally adjacent but requires session-context injection into the scope-enforcement signature — that's a different refactor. F-006's session-lifecycle and F-012's runtime chain validation are different layers entirely.

**Why not F-003 + F-004 + F-005 in Phase 1 (opus subagent's stance)**: bundling F-005's signature change into Phase 1 turns the "hours of work, cheapest wins" PR into a multi-day refactor that touches the dispatcher's session-context wiring. The plan loses the "fast cadence early" property that justified the cheapest-first ordering. F-005 gets its own phase that adopts the same checker registry pattern but with session-context. Same primitive *shape* (per-method checker), different *signature*.

**Why not include F-006 in Phase 1**: F-006 is session-lifetime — fixing it requires `DappSessionService` to communicate with `wallet-sdk/background.ts`'s `BackgroundConnectionHandler`. That's a cross-package wire-up + a schema change to `DappSession` (add `walletSdkSessionId?: string` per research). Different file footprint, different review surface. Own phase.

## Phases

### Phase 1 — Sub-grant checker (F-003 + F-004)
**Goal**: enforce `accounts.canGet` and `data.addressBook` sub-grants at the dispatcher level. Establishes the per-method-checker pattern that later phases adopt.

**Files**:
- `packages/wallet-bridge/src/scope-enforcement.ts` — add `checkGetAccounts` + `checkGetAddressBook` to `METHOD_SCOPE_CHECKER`
- `packages/wallet-bridge/src/capability-map.ts` — remove `getAccounts` from `EXEMPT_METHODS`
- `packages/wallet-bridge/src/dispatcher.ts` — confirm `enforceScope(methodName, args, grants)` is called on the new methods (currently exempt for `getAccounts`)
- `packages/wallet-bridge/src/scope-enforcement.test.ts` — add tests for both checkers
- `packages/wallet-bridge/src/dispatcher.test.ts` — pin "getAccounts without canGet throws"

**Code shape** (per `trust-recheck-primitive.md`):
```typescript
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
// Add to METHOD_SCOPE_CHECKER; remove "getAccounts" from EXEMPT_METHODS in capability-map.ts
```

**Test pins**: 4 unit tests (canGet:true passes, canGet:false throws × 2 methods).
**Risk**: low. Existing `enforceScope` callers already in place; adding a checker is additive. The `EXEMPT_METHODS` change for `getAccounts` is the riskier line — verify the `dispatch()` chokepoint calls `enforceScope` after removing exemption.
**Rollback**: revert the PR. No data migration.
**Effort**: hours. **PR shape**: 1 small PR.

### Phase 2 — F-007 passkey unlock binding (independent quick win)
**Goal**: 4-line patch + 1 test mirror in `service.ts` to reject unlock when supplied `credentialData.id !== profile.credentialId`.

**Files**:
- `packages/extension/src/wallet/services/profile/service.ts` — insert binding check at line 312 (after `acquireRecovery`, before Phase 3 lock re-entry)
- `packages/extension/src/wallet/services/profile/service.integration.test.ts` — add test mirroring `exportPlain` binding test at lines 321-330

**Patch shape**:
```typescript
const recovery = await this.acquireRecovery({ ceremony: "getById", credentialId: snapshot.credentialId }, credentialData)

// F-007 binding check (mirrors exportPlain:656-660)
if (recovery.credentialId !== snapshot.credentialId) {
    throw new Error("Invalid profile id")
}

try { await this.lock.enter(); ... }
```

**Test pin**: 1 new test `unlockPasskeyProfile rejects credentialData for different credential`.
**Risk**: minimal. Mirrors a verified existing pattern. No legitimate user-facing edge case breaks.
**Rollback**: revert.
**Effort**: <1 hour. **PR shape**: 1 small PR. **Can ship in parallel with Phase 1** (different file).

### Phase 3 — F-005 account-scope allow-list (uses Phase 1 pattern)
**Goal**: validate `eventFilter.scopes` / `opts.scopes` / `opts.additionalScopes` against session's approved accounts. Close empty-`calls` fast-path bypass.

**Files**:
- `packages/wallet-bridge/src/scope-enforcement.ts` — new helper `validateAccountScopes(scopes, sessionAccounts, fieldName)`; either:
  - **Option 3a (preferred)**: new signature `enforceScopeWithSession(methodName, args, grants, sessionAccounts)` called from dispatcher after `tryGetDappSessionByOriginAndChain` returns
  - **Option 3b**: pass `sessionAccounts` through the existing `enforceScope` as an optional 4th param; checkers read it from grants context

  Decision: 3a. Cleaner separation; 3b muddies the existing function contract.
- `packages/wallet-bridge/src/dispatcher.ts` — call `enforceScopeWithSession` after capability enforcement, before sink dispatch. Close fast-path at `scope-enforcement.ts:96-97,115-116` (account-scope check fires even when `calls.length === 0`).
- `packages/wallet-bridge/src/scope-enforcement.test.ts` — tests for each scope field × each method.

**Code shape** (per `trust-recheck-primitive.md` Option B):
```typescript
function validateAccountScopes(scopeField, sessionAccounts, fieldName) {
  if (!Array.isArray(scopeField)) return
  for (const addr of scopeField) {
    if (!sessionAccounts.has(String(addr))) {
      throw new Error(`Scope violation: ${fieldName} contains ${addr}, not in session's approved accounts`)
    }
  }
}
// New: enforceAccountScopes(methodName, args, sessionAccounts) — called from dispatcher
```

**Test pins**: 6 tests (one per method × scopes/additionalScopes/eventFilter.scopes; empty-calls bypass closed).
**Risk**: medium. Touches dispatcher chokepoint. Need to thread session lookup through. Affects all `simulateTx` / `executeUtility` / `profileTx` / `getPrivateEvents` / `aztec_sendTx` calls.
**Rollback**: revert. Schema change: none (sessionAccounts already in DappSession).
**Effort**: 1-2 days. **PR shape**: 1 PR.

### Phase 4 — F-006 session revocation teardown (cross-package, own phase)
**Goal**: tear down live wallet-sdk transport when stored DappSession is deleted/expires. Make `enforceCapability` fail-closed for non-exempt methods when session missing.

**Files**:
- `packages/extension/src/wallet/services/dapp-session/spec.ts` — add `walletSdkSessionId?: string` to `DappSession` schema
- `packages/extension/src/wallet/services/dapp-session/service.ts` — populate `walletSdkSessionId` at discovery-approval time (data flows via `onDappSessionCreated` event from `wallet-sdk/background.ts`); on delete, emit `onDappSessionDeleted` with the id
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` — subscribe to `onDappSessionDeleted`; call `handler.terminateSession(walletSdkSessionId)` on each event
- `packages/wallet-bridge/src/dispatcher.ts:735-736` — change `return []` to throw for non-exempt methods (fail-closed when session missing)
- Storage migration: existing DappSession rows lack `walletSdkSessionId`. Live transports for those sessions can't be terminated via the new path — they'll terminate on tab-close as before. ACCEPT this gap for existing sessions; new sessions get the field.

**Code shape (fail-closed at dispatcher)**:
```typescript
// dispatcher.ts:735-736
const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))
if (!dappSession) {
    if (isCapabilityExempt(methodName)) return []  // existing methods like getChainInfo still work
    throw new CapabilityNotGrantedError("Session not found or expired") // NEW: fail-closed
}
```

**Test pins**:
- DappSessionService: stored sessionId field round-trips through storage
- background.ts: terminateSession called on dapp-session-deleted event
- dispatcher: getPrivateEvents/etc throw when session missing (was: returned empty grants and proceeded)
- E2E: disconnect dApp via Settings → confirm dApp's tab can't keep calling network-only methods

**Risk**: high. Cross-package wiring; schema change (storage migration for existing sessions). Codex consult before merge.
**Rollback**: revert wiring + schema change in storage migration.
**Effort**: 2-3 days. **PR shape**: 1 larger PR. **Independent of other phases.**

### Phase 5 — F-001 + F-002 coupled: frame-vs-tab trust scoping
**Goal**: Nulo-side defense-in-depth for iframe-origin attribution (F-001) + sibling-frame hijack (F-002). Coordinate upstream for full fix.

**Files**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:121-135` — add subframe-rejection at the listener layer (`sender.frameId !== 0 → reject`)
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:118` — override `sendToTab` to use `chrome.tabs.sendMessage(tabId, message, { frameId })` for discovery replies (F-002 fix)
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` — extend session keying from `(origin, chainId)` to `(origin, chainId, frameId)` for frame-scoped session isolation
- Tests: mock `chrome.runtime.MessageSender` with `frameId !== 0`; assert rejection. Mock `chrome.tabs.sendMessage` with `{frameId}` option assertion.

**Code shape** (per `frame-scoped-discovery.md` option 5a + 5d + 5c):
```typescript
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.frameId !== 0 && sender.frameId !== undefined) {
    logger.log("wallet-sdk-bg", LogLevel.Debug, `Rejected subframe frameId=${sender.frameId}`)
    return undefined
  }
  // existing flow
})
// And:
sendToTab: (tabId, message, frameId) => chrome.tabs.sendMessage(tabId, message, { frameId: frameId ?? 0 })
```

**Coupling decision**: F-001 + F-002 ship in ONE PR. They both touch the same wrapper (`background.ts:118-135`); the fix is small (~2-3 days combined including tests). Each has an independent test pin. **Disagreement with opus subagent's stance that they should ship independently** — the wrapper is the natural unit, splitting creates a partial-defense window.

**Upstream coordination**: separate issue/PR filed against `@aztec/wallet-sdk` for:
1. Add `frameId`, `url` to `MessageSender` interface
2. Use `sender.url || sender.tab?.url` for attribution
3. Track `frameId` in `ActiveSession`

These items don't block Phase 5 — Nulo-side defense-in-depth lands first.

**Test pins**: unit (subframe rejection); integration (mock chrome.runtime + chrome.tabs); E2E (iframe-vs-top-frame discovery — drives via Puppeteer multi-frame setup).
**Risk**: medium. Breaks legitimate iframe-dApp support IF any exists. None known per research.
**Rollback**: revert the wrapper changes.
**Effort**: 2-3 days. **PR shape**: 1 PR + 1 upstream issue.

### Phase 6 — F-011 + F-012 RPC endpoint trust
**Goal**: scheme allowlist on RPC URL (F-011) + live-node chain rebind at signing (F-012).

**Files**:
- `packages/extension/src/wallet/services/network/spec.ts` — add `RpcUrlSchema = z.string().url().refine(...)` for `https:` general + `http:` loopback-only; apply to `NetworkEndpointSchema`, `NetworkInfoSchema`, `addNetwork`/`addEndpoint`/`updateEndpoint` params
- `packages/extension/src/wallet/services/network/service.ts` — `restore()` re-validates URLs (currently skips this)
- `packages/aztec-runtime/src/account/nulo-account.ts:99-103` — before `buildTxExecutionRequest`, recompute live `node.getNodeInfo()` and compare to selected network's stored `(l1ChainId, rollupVersion)`. Fail-closed on mismatch.
- `packages/extension/src/wallet/services/execution/service.ts:1643-1647` — same rebind check before returning `getChainInfo`
- Cache: memoize `node.getNodeInfo()` per dispatch to avoid latency
- Tests: scheme allowlist (5+ cases); backup-restore rejection; live-node mismatch throws

**Coupling decision**: F-011 + F-012 ship in ONE PR. **Disagreement with opus** — even though the code sites are different (network/spec.ts vs nulo-account.ts), both fixes address the same threat surface (malicious endpoint). Shipping together gives a coherent threat-defense narrative + one review cycle. Each has independent tests.

**Test pins**: 5 unit tests for scheme allowlist (javascript:, data:, http://attacker, https://, http://localhost); 1 restore-rejection test; 1 chain-rebind mismatch test in nulo-account.
**Risk**: medium. The scheme allowlist could trip on a non-loopback dev host. Research grep'd for `host.docker.internal` etc. — none found in this repo. Confirm with team before landing.
**Rollback**: revert. Migration: none (existing networks all use https).
**Effort**: 1-2 days. **PR shape**: 1 PR.

### Phase 7 — F-008 broad UX redesign (all 5 popup-gated op types)
**Goal**: structured argument summaries on PRIMARY approval surface for transfer, registerToken, registerContract, createAuthWit, simulate/utility/profile. JSON viewer demoted to fallback.

**Files** (per `approval-card-redesign.md` Hybrid recommendation):
- `packages/extension/src/popup/windows/execute/OperationCard.vue` — refactor as router/discriminator
- New: `packages/extension/src/popup/windows/execute/OperationCardTransfer.vue` — F-008 anchor: recipient + amount + network on primary card
- New: `OperationCardRegisterToken.vue` — token contract + sanitized name/symbol + decimals
- New: `OperationCardRegisterContract.vue` — instance address + classId + sanitized artifact.name + verified badge
- Leave inline (low-change kinds): authwit, simulate-types, utility, getContractMetadata, etc.
- Sanitization: F-009's `sanitizeWireString` applied to ALL dApp-controlled strings in the new components (overlap with Phase 8)
- Tests: new `OperationCard.test.ts` + per-component tests

**Rollback story** (addressing user's anxiety):
- New components are ADDITIVE: the router pattern keeps the JSON viewer link as a footer fallback.
- If structured rendering throws (parser error, missing typed model, unexpected operation shape), the component CATCHES + falls back to a "Couldn't render details — open Full JSON" banner.
- Feature flag NOT used. The router pattern itself IS the safety net.
- Manual QA per op type before merge.
- Codex consult on the router fallback + per-op-type renderer before merge.

**Code shape**: per ASCII mockups (already approved by user + in `approval-card-redesign.md`).

**Test pins**:
- Sanitization tests: inject RTL/ZWSP/homograph into dapp.name, token name/symbol, artifact name; verify stripped + length-clamped output
- Structured arg tests per op type: mock op with typed args, verify primary surface shows recipient/amount/network/etc
- Router fallback test: pass malformed op; verify JSON viewer link still works

**Risk**: high. UX-facing; touches many template sites. ~3-4 days work. The argument-extraction for transfer requires consulting the action's typed kind enum — if Nulo's SendAction kind doesn't already expose recipient/amount as typed fields, we need to add them OR introspect args[0]/args[1] with care.
**Rollback**: revert the new components + the OperationCard router refactor. JSON viewer comes back as primary.
**Effort**: 3-4 days. **PR shape**: 1-2 PRs (transfer first as Phase 7a; remaining 4 op types as Phase 7b).

### Phase 8 — F-009 Unicode sanitization sweep (covers Phase 7 surfaces + others)
**Goal**: ensure EVERY dApp-controlled string in the popup approval surface routes through `sanitizeWireString`.

**Files**:
- `packages/extension/src/composables/useDappHostname.ts` — show full origin, not just hostname
- `packages/extension/src/components/composite/DappIdentityBlock.vue:37-47` — sanitize `dapp.name`; visually mark as untrusted metadata
- `packages/extension/src/popup/windows/verify/index.vue:200-210` — sanitize
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:49,90,102,135-137` — sanitize token name/symbol
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:423-427` — sanitize at persistence time (defense in depth)
- Tests: sanitization injection tests on EACH surface

**Coupling decision**: F-008 + F-009 are SEPARATE phases. **Disagreement with opus's "coupled" stance** — F-008 is a UX redesign with novel components; F-009 is a sanitization sweep across existing components. Shipping F-008 first means we know the new surfaces sanitize correctly; the F-009 sweep ensures no other surface was missed. Bundling them creates a 5-day PR that's hard to review.

**Risk**: low. Sanitization is additive; can't break legitimate rendering (only strips control chars + clamps length).
**Rollback**: revert.
**Effort**: 1 day. **PR shape**: 1 PR.

### Phase 9 — `/harden security max` re-run

After all 8 fix phases land + merge to dev, run `/harden security max` (NOT ultra — we have the baseline; max is sufficient verification). Compare against this audit's findings.list. Surface any new findings or unclosed regressions.

**Effort**: 60-90 min wall (audit runtime).
**Output**: new audit dir under `audit/security/<date>-max-<run-id>/`. Compare side-by-side with `2026-06-08-ultra-e6759a/`.

## Security & Adversarial Considerations

**Threat model for the refactor itself**:
- Bad-actor with merge access: not in scope (assume CI gates + signed commits, per repo's existing posture).
- Regression introduced by mistake: each phase has a regression test pin per audit cross-cutting #3. The /harden re-run at Phase 9 catches systemic regressions.
- Scope-enforcement primitive bug: e.g., new checker accidentally has wrong condition. Mitigation: paired test (allow + deny cases) per finding.

**Per-finding threat model**: see `audit/security/2026-06-08-ultra-e6759a/report.md`'s per-finding sections. Each fix targets a specific CWE.

**Least privilege**: Phase 4 (F-006) adds `walletSdkSessionId` to DappSession schema. This is wallet-internal data, not dApp-visible. No new credential surface.

**Cryptography**: no fix touches crypto primitives. Audit confirmed wallet-crypto is healthy.

**Input validation**:
- Phase 6's URL allowlist is the central new validation surface. Lives in `network/spec.ts` zod schemas. Applied at add-network AND restore.
- Phase 3's account-scope check is the central new authorization gate. Lives in `wallet-bridge/scope-enforcement.ts`.

**Supply chain**: no dependency changes planned.

**Domain-specific risks**:
- Phase 5 (F-001/F-002): risk of breaking legitimate iframe-dApp support. None known. If any exists, the rejection at the listener gives a clear error message.
- Phase 7 (F-008): risk of mis-parsing typed args and showing WRONG values. Mitigation: per-op-type renderer + router fallback to JSON viewer on error.

**Audit prompt**: each phase's PR review (codex post-impl per `/blueprint` spec) MUST include adversarial ask: "What can an attacker do AFTER this fix that they couldn't before? Any new attack surface introduced by the primitives?"

## Assumptions

### Facts (verified)
- The 12 findings in `audit/security/2026-06-08-ultra-e6759a/findings/consolidated.md` are accurate (verified by Phase 4 verifier — `audit/.../findings/verified.md`).
- Research artifacts cite real file:line locations in current source (verified per artifact).
- e2e:agent generates loopback-only URLs (`resolve-ports.ts` lines 106-114 produce `127.0.0.1` + `localhost` URLs only).
- `exportPlain` already has the F-007 binding pattern (verified at `profile/service.ts:656-660`).
- `sanitizeWireString` already exists at `dapp-session/capability-meta.ts:104-166`.

### Inferences (deduced, may be wrong)
- The team uses no non-loopback dev hostnames. Grep found nothing, but a dev with an unusual setup may surface a counterexample.
- `chrome.tabs.sendMessage(tabId, msg, {frameId})` works for the discovery-reply path. The MV3 docs say yes, but Phase 5 should validate empirically.
- The F-008 typed-arg extraction for transfer can work via Nulo's `SendAction` kind enum without ABI introspection. Research suggests yes but the typed model in `wallet-bridge/operation.ts:97-183` is partially generic — Phase 7a needs to validate.
- F-006's `walletSdkSessionId` can be populated at discovery-approval time. The upstream `BackgroundConnectionHandler` exposes the sessionId in the discovery-approved callback (per research) — confirm.

### Asks (decisions still needed from user)
- **Upstream coordination for F-001/F-002**: file the upstream issue/PR now (in parallel with Phase 5)? Or land Nulo-side defense-in-depth first + file upstream later? **Plan default**: file in parallel.
- **F-006 schema change**: accept that existing DappSession rows can't trigger upstream termination (only new sessions get the new field)? **Plan default**: yes (tab-close drains old sessions; users disconnect rarely; not worth a forward-migration).
- **F-008 phase split**: ship transfer (7a) before remaining 4 op types (7b)? **Plan default**: yes, transfer is the highest-volume and lowest-risk to get right.

## Test strategy

Per audit cross-cutting #3, **every remediation PR lands a regression test pin**. Specifics per phase above. Common pattern:
- Unit test where the bug lives (per-checker, per-helper, per-component)
- Integration test where the bug manifests (dispatcher, popup mount, network service)
- E2E test for user-visible flows (disconnect-dApp, add-malicious-URL, iframe-vs-topframe)

E2E tests use the existing `bun run e2e:agent` harness (parallel-safe, per-worktree).

## Open architectural questions

1. **Should Phase 4 (F-006) introduce a new `IDappSessionLifecycleEmitter` abstraction** so `wallet-sdk/background.ts` doesn't directly import `DappSessionService`? Current architecture has them in the same layer; cross-import is fine. But adding an event-emitter wrapper would future-proof for cross-package boundary. **Plan default**: NO, ship as direct subscription. Revisit if cross-package boundary becomes a concern.

2. **Should Phase 7 (F-008) feature-flag the new components**? **Plan default**: NO — the router pattern + JSON-viewer fallback IS the rollback. A feature flag adds a code path that itself needs testing.

3. **Should the audit's "trust checked once, reused too broadly" theme drive a CODEBASE-WIDE primitive** (not just `enforceScope`)? E.g., a `SubGrant` type that EVERY capability subkey routes through. **Plan default**: NO. Speculative generality — solve the 5 specific findings; if another sub-grant emerges, refactor THEN.

## Seeds

### `/goal` (durable outer)
```
/goal All 8 fix phases marked ✓ in plan.md; for each phase the agent has printed `LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-N.md` in the transcript; every phase has a regression test pin landed; /code-review max --fix complete with findings applied and committed (separately from implementation commits); codex post-impl audit complete with high/critical findings addressed; `bun --cwd packages/extension test` + `bun --cwd packages/extension lint` + `bun --cwd packages/extension typecheck` all report exit 0 in the transcript; Phase 9's /harden security max re-run committed under audit/security/<new-date>/ with no new Critical or High findings.
```

### `/loop` (per-session cadence)
```
/loop Each turn:
1. Read implementations-plan/security-audit-remediation/plan.md + lessons/ for phase state; run git status + git log --oneline -5; if PR exists, gh pr view --json statusCheckRollup.
2. CI in flight on HEAD SHA? Stream via gh run watch <id> for up to 10 min.
3. Failed check? Triage; call /codex xhigh on non-trivial. Commit small + conventional + push. 5 failures on same step → stop + reassess.
4. Phase green? Mark ✓ in plan.md, file lessons log, print LESSONS_FILE=..., advance.
5. Nothing in flight? Pick next pending phase from plan.md (Phase 1 → 8 in order; some can parallelize per the plan); execute (edit → bun --cwd packages/extension lint → bun --cwd packages/extension test → commit → push).
6. All 8 phases ✓? Run post-impl sequence: /code-review max --fix → commit separately → codex post-impl audit /codex xhigh with adversarial ask → address high/critical findings → /harden security max for Phase 9 → compare against audit/security/2026-06-08-ultra-e6759a/. Stop + surface.

Discipline: plan.md authoritative. Per-finding codex consult on Phase 4 (cross-package session-id wiring) + Phase 5 (frame-targeted messaging) + Phase 7 (router fallback pattern). Never merge to main or release branches. Stop when 8 phases ✓ + post-impl clean + Phase 9 re-audit shows no new High/Critical.
```
