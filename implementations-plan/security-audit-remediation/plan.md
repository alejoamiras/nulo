# Remediation Plan — security audit (2026-06-08)

**Status**: drafted, audit findings addressed (Round 1 codex + opus), pending final fresh-context codex pass + approval gate
**Tier**: `/blueprint mega-deep` (user invoked `ultra`; mapped to heaviest available tier)
**Sources**:
- Audit: `audit/security/2026-06-08-ultra-e6759a/` (12 findings, 11 in scope; F-010 deferred)
- Research: `implementations-plan/security-audit-remediation/research/` (6 artifacts)
- Phase 0 answers: `implementations-plan/security-audit-remediation/clarifying-answers.md`
- Decision ledger: `implementations-plan/security-audit-remediation/decision-ledger.md`
- Alternative drafts: `plan-codex.md`, `plan-opus.md`
- Audit transcripts: `audit-codex.md` (verdict: REJECT, 5 blockers), `audit-opus.md` (verdict: conditional approve, 6 blockers, 7 significant)

**Audit verdicts**:
- **Round 1 Codex**: REJECT with 5 blocking findings. All addressed in Round 1 revision (see "Revision log" below).
- **Round 1 Opus**: conditional approve with 6 blocking + 7 significant. All blocking addressed.
- **Final fresh codex pass (Round 2)**: REJECT with 3 NEW blocking findings — addressed in Round 2 revision (see Round-2 revision log below).

**Revision log (from Round 1 audits)**:
- Added **Phase 0.5**: consolidate dispatcher session lookups (opus B-1/CC-2).
- **Phase 1 expanded** to include F-005 (decision-ledger Decision 1 reversed), `enrichGrantedCapabilities` fix for F-003 (codex B-1), and `checkRegisterSender` for F-004 (codex B-2).
- **Phase 3 removed** (F-005 absorbed into Phase 1).
- **Phase 4 (F-006)**: data model changed from single `walletSdkSessionId` field to tuple matching `(origin, chainId)` over `handler.getActiveSessions()` (decision-ledger Decision 8 reversed; codex S-1).
- **Phase 5 (F-001 + F-002)**: scope clamped — frame-targeted send marked as upstream-blocked; Nulo-side fixes are subframe rejection + content-script pending-request correlation only (codex B-3).
- **Phase 6 (F-011 + F-012)**: added node-factory adapter boundary guard for F-011; fixed `[::1]` IPv6 string-match (broken under WHATWG-URL serialization); F-012 redesigned around shared `assertLiveChainIdentity(networkInfo, nodeInfo)` helper at all live-node sink sites (codex B-4/B-5, opus B-3).
- **Phase 7 (F-008)**: added "do not guess" semantics — only show semantic labels when wallet can prove the shape from wallet-owned builders or locally resolved ABI/artifact; otherwise fall back to indexed args with "unverified summary" marker. Added negative tests for silent misclassification. 7a + 7b merge as single landing event to avoid half-rollout phishing signal (opus B-4/M-4, codex S-2).
- **Phase 8 (F-009)**: scope expanded to cover the F-008 sanitization-at-landing pattern as paired tests, plus all dApp-controlled string render sites flagged in audit S-3.
- **Refactor threat model** subsection added to Security & Adversarial section (opus M-2).
- **Phase 9 failure handling** explicit (opus M-3).

**Round-2 revision log (final fresh codex pass)**:
- **Phase 0.5 B1 fix**: file scope expanded to include `resolveNetworkAndAccount()` at `dispatcher.ts:904-909` — that's the 6th lookup site; original revision missed it. All 6 lookups now threaded through `dispatch()` entry capture.
- **Phase 3 B2 fix**: F-006 scope expanded to handle approved `pendingDiscoveries`, not just `ActiveSession`s. Upstream `BackgroundConnectionHandler` keeps `pendingDiscoveries` in `approved` state after `approveDiscovery()` and can re-establish a session via `handleKeyExchangeRequest()` even after `terminateSession()`. The Phase 3 fix MUST also purge approved-but-not-yet-key-exchanged pending discoveries when the backing DappSession is revoked OR reject `KEY_EXCHANGE_REQUEST` when no DappSession matches.
- **Phase 5 B3 fix (IPv6 loopback)**: `new URL("http://[::1]:8080").hostname` returns `"[::1]"` (WITH brackets) in both Bun 1.3.13 and Node v24 — empirically verified by codex. Round 1 revision's claim that brackets are stripped was WRONG. Phase 5 allowlist host match: `localhost`, `127.0.0.1`, `[::1]` (with brackets, per actual runtime). Test vectors include `http://[::1]:8080` (valid) — NOT `http://::1:8080` (invalid URL syntax).

**Round-3 revision log (user approval conditions, 2026-06-08)**:
- **Phase 6 / Phase 7 swap**: user concern about UX redesign risk. F-009 Unicode sanitization sweep now ships in Phase 6 (before F-008); F-008 broad UX redesign moves to Phase 7 — the LAST fix phase before re-audit. Rationale: F-009 establishes sanitization patterns on EXISTING surfaces with low risk; F-008 then adopts those established patterns when introducing new components, reducing the chance of sanitization gaps in net-new code AND giving the user maximum time + visibility on the highest-risk PR. Phase numbering updated throughout the plan.
- **F-010 disposition**: explicitly tagged for the next remediation cycle. Phase 8 re-audit will flag it as unclosed; output should record this as a known-deferred item under the `audit-followup` tag, not as a "new finding caused by remediation."

## Summary

Implement 11 of 12 findings from the `/harden security ultra` audit at `audit/security/2026-06-08-ultra-e6759a/`. Skip F-010 (deferred — unbounded incoming-transfer persistence; cost/benefit unfavorable this round). Final phase re-runs `/harden security max` to verify closure.

Architectural shape: **NOT one unifying trust primitive across all findings**. Fixes live in **three different layers**: scope-enforcement (F-003, F-004, F-005), session-lifetime (F-006), and runtime chain validation (F-012). A single primitive obscures these layer boundaries.

**However**, the dispatcher's 6 ad-hoc `tryGetDappSessionByOriginAndChain` calls ARE a shared architectural unit. Phase 0.5 consolidates these into one entry-point capture before Phase 1's scope-enforcement work, closing a TOCTOU window across multiple phases.

Sequencing reconciles "cheapest wins first" + "architectural refactor first": Phase 0.5 + Phase 1 are the architectural setup (one consolidated PR); Phase 2 (F-007) is the cheapest independent quick-win that can ship in parallel.

## Phases

### Phase 0.5 — Dispatcher session-lookup consolidation ✓
**Goal**: Replace 6 ad-hoc `tryGetDappSessionByOriginAndChain` calls in `dispatcher.ts` (lines 289, 391, 457, 505, 735, 904) with one entry-point capture at `dispatch()` invocation, passed through to call sites.

**Why this is Phase 0.5**: This is the deeper architectural unit the audit's cross-cutting #1 was pointing at — none of the three drafts caught it. It crosses Phase 1 (which adds checkers but doesn't consolidate lookups), Phase 4 (which adds a 7th lookup via fail-closed), and Phase 5+ extensions. Closing the TOCTOU window once at entry simplifies every later phase.

**Files**:
- `packages/wallet-bridge/src/dispatcher.ts` — introduce `SessionLookupResult` type at `dispatch()` entry; thread through ALL 6 callsites: `enforceCapability` (line 735), `enforceScope` (line 231 entry), `handleGetAccounts` (line 289), `handleSendTx` (line 391), `handleRegisterToken` (line 457), `requestCapabilities` (line 505), `enrichGrantedCapabilities` (line 704), **AND `resolveNetworkAndAccount()` (line 904-909)** — the 6th lookup site the Round 1 revision missed. Single lookup; reuse across all handlers.
- `packages/wallet-bridge/src/dispatcher.test.ts` — TOCTOU test pin: session deleted mid-dispatch must not cause inconsistent grant decisions.

**Risk**: medium. Touches dispatcher chokepoint, affects all handlers. Tests must pin the threaded session-lookup behavior identically to current behavior across all 6 callsites (refactor = no behavior change).
**Test pins**: 2 tests — (a) all handlers see consistent session state within a single dispatch; (b) session deletion mid-dispatch produces consistent behavior (either all-or-none, not half-applied).
**Rollback**: revert. No data migration.
**Effort**: 1 day. **PR shape**: 1 PR, ships before Phase 1.

### Phase 1 — Scope-enforcement primitives (F-003 + F-004 + F-005) ✓
**Goal**: enforce sub-grant bits and account-scope allow-listing in the dispatcher. Closes 3 findings via shared checker registry pattern + new session-context overload.

**Bundled per audit reversal of Decision 1**: F-005 belongs in Phase 1 — same file, same registry, same review surface. Codex draft had this; consolidated plan-main wrongly split. Audit Round 1 (both codex + opus) explicitly reversed this.

**Files**:
- `packages/wallet-bridge/src/scope-enforcement.ts`:
  - Add `checkGetAccounts` (F-003: requires `accounts.canGet === true`)
  - Add `checkGetAddressBook` + `checkRegisterSender` (F-004: requires `data.addressBook === true`) — **register both** per codex B-2
  - Add `validateAccountScopes(scopeField, sessionAccounts, fieldName)` helper for F-005
  - Extend signature: `enforceScopeWithSession(methodName, args, grants, sessionAccounts)` (F-005)
  - Close empty-`calls` fast-path at `scope-enforcement.ts:96-97, 115-116` for account-scope check (F-005)
- `packages/wallet-bridge/src/capability-map.ts` — remove `getAccounts` from `EXEMPT_METHODS` (F-003)
- `packages/wallet-bridge/src/dispatcher.ts`:
  - `enrichGrantedCapabilities()` (lines 689-713) — return `accounts: []` when stored `accounts.canGet !== true` (F-003 codex B-1 — primary disclosure happens at grant-response time, not just on later getAccounts)
  - Wire `enforceScopeWithSession` into `dispatch()` (uses Phase 0.5's consolidated session lookup)
- Tests: 8-10 new tests covering:
  - F-003: `getAccounts` with `canGet:true` passes / `canGet:false` throws / `requestCapabilities` response does not echo accounts when `canGet:false` (codex B-1 pin)
  - F-004: `getAddressBook` + `registerSender` × `addressBook:true/false`
  - F-005: per-method scope-array tampering (`opts.scopes`, `opts.additionalScopes`, `eventFilter.scopes`); empty-`calls` bypass closed
  - Negative: missing-session case (depends on Phase 4's fail-closed behavior; pin both that Phase 1 doesn't break missing-session callers AND that Phase 4 closes the residual gap)

**Risk**: medium-high. Closing 3 findings in one PR; covers grant-response + handler + scope-array paths. Larger PR (~400-600 LOC) per opus B-2 reasoning.
**Rollback**: revert. No data migration.
**Effort**: 1.5-2 days. **PR shape**: 1 PR (depends on Phase 0.5 landing first).

### Phase 2 — F-007 passkey unlock binding (independent quick win)
**Goal**: 4-line patch + 1 test mirror in `service.ts` to reject unlock when supplied `credentialData.id !== profile.credentialId`. Mirrors the pattern at `exportPlain:656-660`.

**Files**:
- `packages/extension/src/wallet/services/profile/service.ts` — insert binding check at line 312 (after `acquireRecovery`, before Phase 3 lock re-entry)
- `packages/extension/src/wallet/services/profile/service.integration.test.ts` — add test mirroring lines 321-330

**Patch shape**:
```typescript
const recovery = await this.acquireRecovery({ ceremony: "getById", credentialId: snapshot.credentialId }, credentialData)

// F-007 binding check (mirrors exportPlain:656-660)
if (recovery.credentialId !== snapshot.credentialId) {
    throw new Error("Invalid profile id")
}

try { await this.lock.enter(); ... }
```

**Risk**: minimal. **Effort**: <1 hour. **PR shape**: 1 small PR. **Can ship in parallel with Phase 0.5/Phase 1.**

### Phase 3 — F-006 session revocation teardown (cross-package, own phase)
**Goal**: tear down live wallet-sdk transport when stored DappSession is deleted/expires. Make `enforceCapability` fail-closed for non-exempt methods when session missing.

**Data model change** (per Round 1 audit reversal of Decision 8): use **tuple matching** `(origin, chainId)` over `handler.getActiveSessions()`, NOT a `walletSdkSessionId` field on DappSession. Reasoning: a single stored DappSession can correspond to MULTIPLE live ActiveSessions (multi-tab same-dApp case); a single-id field doesn't model that correctly. Tuple matching is O(n) where n is bounded by tabs-with-dApp-loaded — typically <10, no performance concern.

**Additional scope expansion (Round 2 codex B-2)**: terminate `ActiveSession`s AND also purge approved `pendingDiscoveries`. Upstream `BackgroundConnectionHandler` keeps `pendingDiscoveries` in `approved` state after `approveDiscovery()` (`background_connection_handler.ts:243-260`); `handleKeyExchangeRequest()` establishes a live session whenever pending discovery is `approved` (`:277-279`); `terminateSession()` itself recreates a pending discovery in `approved` state (`:356-379`). Without purging these, a terminated session can be re-key-exchanged against the restored approved discovery before `SESSION_DISCONNECTED` closes the content-script port. The plan needs an explicit local answer for approved `pendingDiscoveries`, not just `ActiveSession`s.

**Files**:
- `packages/extension/src/wallet/services/dapp-session/service.ts:274-288` — on `deleteDappSession`, emit `onDappSessionDeleted(origin, chainId)` instead of just session row
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` — subscribe to `onDappSessionDeleted`. For each event: (a) iterate `handler.getActiveSessions()`, match by `(origin, chainId)` tuple, call `handler.terminateSession(matchedSessionId)` for each; (b) iterate `handler.pendingDiscoveries` (if exposed; if not, file an upstream gap as a sub-item), purge approved-but-not-yet-key-exchanged entries matching the same tuple; (c) install a guard in `handleKeyExchangeRequest` (or equivalent Nulo-side wrapper if upstream doesn't expose it) that rejects key exchange when no matching DappSession exists.
- `packages/wallet-bridge/src/dispatcher.ts:735-736` — change `return []` to throw for non-exempt methods (fail-closed when session missing). Uses Phase 0.5's single session-lookup result; TOCTOU window closed.
- Schema: **no changes** (tuple-matching doesn't require new field)
- Upstream coordination sub-item: if `pendingDiscoveries` is not externally iterable, file upstream issue alongside Phase 4's wallet-sdk PR.

**Code shape (fail-closed at dispatcher, using Phase 0.5's threaded session)**:
```typescript
// dispatcher.ts: enforceCapability now reads session from threaded context, not new lookup
const session = ctx.session // from Phase 0.5's consolidated capture
if (!session) {
    if (isCapabilityExempt(methodName)) return []
    throw new CapabilityNotGrantedError("Session not found or expired") // NEW: fail-closed
}
```

**Test pins**:
- DappSessionService: deletion emits `(origin, chainId)` tuple
- background.ts: terminateSession called for each matching ActiveSession on delete (multi-tab scenario tested)
- dispatcher: getPrivateEvents/etc throw when session missing
- E2E: disconnect dApp via Settings → multi-tab dApp can't keep calling network-only methods

**Risk**: high. Cross-package wiring. Codex consult mandated before merge.
**Effort**: 2-3 days. **PR shape**: 1 larger PR. **Independent of other phases.**

### Phase 4 — F-001 + F-002 frame-vs-tab (Nulo-side defense-in-depth ONLY)
**Goal**: Subframe-origin attack mitigation. NOTE: per audit Round 1 (codex B-3), the originally-planned frame-targeted send is **infeasible** with the current upstream wallet-sdk transport (upstream `sendToTab` hardcodes `(tabId, message)` — no `{frameId}` option exposed). Frame-targeted send becomes an **upstream coordination item only**.

**Nulo-side scope (what we can ship locally)**:
1. **Subframe rejection at listener** (closes F-001 if iframe dApps not intentionally supported) — feature-flag with a default of "reject subframes" so we can roll back if a legitimate iframe dApp surfaces
2. **Content-script pending-request correlation** — content script tracks which frame initiated a discovery; only acts on approvals matching a pending local request. Partial F-002 mitigation: sibling frames receive the broadcast but can't fabricate a matching pending state.

**Files**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:121-135` — subframe rejection (gate with feature flag)
- `packages/extension/src/content-script/content.ts` — pending-request correlation
- `packages/extension/src/wallet/services/wallet-sdk/content-script-validator.ts` — tighten envelope schema to include pending-request id (if upstream allows)

**Upstream coordination (separate item, NOT blocking)**:
- File issue/PR against `@aztec/wallet-sdk` to:
  - Add `frameId`, `url` to `MessageSender` interface
  - Use `sender.url || sender.tab?.url` for attribution
  - Track `frameId` in `ActiveSession`; expose in `sendToTab` signature

**Test pins**: unit subframe-rejection test; integration test for content-script pending-request correlation. **Frame-targeted send tests deferred** until upstream lands.

**Risk**: medium. Subframe rejection breaks legitimate iframe dApps. Feature flag mitigates. Research found NO iframe dApps in Nulo's ecosystem, but `packages/playground/` should be spot-checked (per opus S-4).
**Effort**: 2-3 days for Nulo-side scope. **PR shape**: 1 PR + 1 upstream issue.

### Phase 5 — F-011 + F-012 RPC endpoint trust
**Goal**: Scheme allowlist on RPC URL + live-node chain rebind at signing — multiple sinks.

**Files**:
- `packages/extension/src/wallet/services/network/spec.ts`:
  - Add `RpcUrlSchema = z.string().url().refine(...)` for `https:` general + `http:` loopback-only
  - **Loopback string match**: `localhost`, `127.0.0.1`, **`[::1]`** (WITH brackets — empirically verified by codex Round 2 B3 in both Bun 1.3.13 and Node v24; `new URL("http://[::1]:8080").hostname` returns `"[::1]"`, NOT `"::1"`. Round 1 revision's claim that brackets are stripped was wrong.)
  - Apply to `NetworkEndpointSchema`, `NetworkInfoSchema`, `addNetwork`/`addEndpoint`/`updateEndpoint` params
- `packages/extension/src/wallet/services/network/service.ts` — `restore()` re-validates URLs
- **`packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:15-17` — NEW: central allowlist guard at the node-factory boundary** (codex B-5 — the audit's explicit recommendation; plan-main missed this)
- **F-012 redesigned around shared `assertLiveChainIdentity(networkInfo, nodeInfo)` helper** (codex B-4):
  - New helper in `aztec-runtime` or a shared utility module
  - Called from EACH live-node sink site:
    - `packages/extension/src/wallet/services/execution/tx-request-builder.ts:106,447-455`
    - `packages/extension/src/wallet/services/execution/authwit-discoverer.ts:100-101`
    - `packages/extension/src/wallet/services/execution/fast-path.ts:170-175`
    - `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:236-243`
    - `packages/extension/src/wallet/services/execution/service.ts:2202-2207`
    - `packages/aztec-runtime/src/pxe/chain-runtime.ts:104-105, 199-229`
  - The original plan's `nulo-account.ts:99-103` hook is removed — that site has no `networkInfo` to compare against
- **Cache**: memoize `node.getNodeInfo()` per `(networkId, dispatch-id)`; **evict on `onActiveNetworkChanged`** (opus S-3; cache must survive only within an active dispatch on the original network)

**Per-finding test pins**:
- F-011: 6+ tests — scheme allowlist (`javascript:`, `data:`, `file:`, `http://attacker`, `https://`, `http://localhost:8888`, `http://127.0.0.1:9999`, `http://[::1]:8080`). Backup-restore rejection. **Adapter guard test**: even when called with persisted-but-invalid URL, adapter rejects.
- F-012: per-sink chain-mismatch test. Migration: existing Local Network seed is `http://localhost:8080` — explicitly verified against allowlist (already loopback; no migration cost).

**Risk**: medium. The scheme allowlist could trip on a non-loopback dev host. Research grep found none; opus correction: confirm with team before landing.
**Effort**: 2-3 days. **PR shape**: 1 PR.

### Phase 6 — F-009 Unicode sanitization sweep (covers all existing surfaces; precedes F-008)

**Goal**: ensure EVERY dApp-controlled string in popup approval surfaces routes through `sanitizeWireString`. Ships BEFORE Phase 7 (F-008 UX redesign) so the new F-008 components can adopt the established sanitization pattern rather than introducing it. Establishes the helper-application discipline before the higher-risk Phase 7 PR.

**Files**:
- `packages/extension/src/composables/useDappHostname.ts` — show full origin, not just hostname
- `packages/extension/src/components/composite/DappIdentityBlock.vue:37-47` — sanitize `dapp.name`; visually mark as untrusted metadata
- `packages/extension/src/popup/windows/verify/index.vue:200-210` — sanitize
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:49,90,102,135-137` — sanitize token name/symbol
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:423-427` — sanitize at PERSISTENCE time (defense in depth)
- Tests: sanitization injection tests on EACH surface

**Coupling decision** (Round-3 user condition): F-009 ships FIRST in Phase 6; F-008 (Phase 7) is the last fix phase, adopts F-009's established patterns.

**Risk**: low. Sanitization is additive; can't break legitimate rendering.
**Effort**: 1 day. **PR shape**: 1 PR.

### Phase 7 — F-008 broad UX redesign (LAST fix phase, all 5 popup-gated op types, with "do not guess" semantics)

**Phase ordering note (Round-3 user condition)**: This is the LAST fix phase before the re-audit. F-009 (Phase 6) ships first to establish sanitization patterns on EXISTING surfaces with low risk; F-008's new components then ADOPT those established patterns rather than introducing them. Reduces sanitization-gap risk in net-new code AND gives the user maximum visibility on the highest-risk PR before Phase 8 re-audit.

**Goal**: structured argument summaries on PRIMARY approval surface for transfer, registerToken, registerContract, createAuthWit, simulate/utility/profile. JSON viewer demoted to fallback.

**"Do not guess" semantics** (per audit Round 1 — codex S-2, opus B-4):
- Only show semantic labels when the wallet can **prove** the shape from wallet-owned builders or a locally resolved ABI/artifact
- Otherwise render **indexed args** with "Unverified summary" marker
- Router-fallback to JSON viewer catches throws; the explicit shape-validation catches silent mis-parses (the more important failure mode)

**Files** (per `approval-card-redesign.md` Hybrid recommendation):
- `packages/extension/src/popup/windows/execute/OperationCard.vue` — refactor as router/discriminator
- New: `packages/extension/src/popup/windows/execute/OperationCardTransfer.vue` — F-008 anchor; structured args ONLY when typed Nulo SendAction kind is recognized; else indexed-args fallback
- New: `OperationCardRegisterToken.vue` — token contract + sanitized name/symbol + decimals
- New: `OperationCardRegisterContract.vue` — instance address + classId + sanitized artifact.name + verified badge
- Leave inline (low-change kinds): authwit, simulate-types, utility, getContractMetadata, etc.
- Sanitization at landing: adopt Phase 6's `sanitizeWireString` pattern on ALL dApp-controlled strings in new components (paired test per finding per audit Decision 4 caveat)

**Rollout shape** (per opus M-4):
- Phase 7a (transfer): develops in isolation, demos to product, holds in feature branch
- Phase 7b (other 4 op types): builds on 7a; both merge to `dev` in **single landing event** (avoids half-rollout phishing signal)

**Test pins** (codex S-2 mandate):
- Sanitization tests: inject RTL/ZWSP/homograph into dapp.name, token name/symbol, artifact name; verify stripped + length-clamped output
- **Negative tests for silent misclassification**: craft a transfer-like payload where method label, selector, and arg positions LOOK transfer-like but aren't — assert "Unverified summary" path triggers, NOT a precise-but-wrong "To/Amount"
- **Multi-call payload tests**: benign-looking first call + harmful later call — assert ALL calls render their args, not just the first
- Structured arg tests per op type: mock op with typed args, verify primary surface shows recipient/amount/network/etc
- Router fallback test: pass malformed op; verify JSON viewer link still works

**Risk**: high. UX-facing; touches many template sites. ~4-5 days work.
**Effort**: 4-5 days. **PR shape**: 1 PR (7a + 7b together per opus M-4).

### Phase 8 — `/harden security max` re-run + failure handling

After all 7 fix phases land + merge to `dev`, run `/harden security max` (NOT ultra — we have the baseline; max is sufficient verification). Compare against this audit's findings.

**Failure mode definition** (per opus M-3):
- If re-run reports **no new H/C findings**: remediation complete; close arc.
- If re-run reports **new H/C findings caused BY the remediation**: triage; if blocker → loop back to Phase 1-7 with new findings as inputs.
- If re-run reports **new H/C findings unrelated to the remediation** (newly-discovered pre-existing issues): tag as `audit-followup`; open a new arc; do NOT block this arc's closure.
- If re-run reports **only Medium/Low findings**: document; close arc with a "follow-up issues" list.

**Effort**: 60-90 min wall (audit runtime) + variable triage.
**Output**: new audit dir under `audit/security/<date>-max-<run-id>/`. Compare side-by-side with `2026-06-08-ultra-e6759a/`.

## Security & Adversarial Considerations

**Threat model for the refactor itself** (per audit opus M-2 — explicit refactor threat-model):
- **Mistaken-refactor risk**: a Phase 1 PR removes `getAccounts` from `EXEMPT_METHODS` without also patching `enrichGrantedCapabilities`. Mitigation: explicit test pin for the response-path leak (codex B-1).
- **Phase ordering accidents**: if Phase 3 (F-006 fail-closed) lands before Phase 1 (F-003/F-004/F-005), pre-grant dApps get THROWS instead of silent leaks — actually safer, not worse. If Phase 1 lands but Phase 3 is delayed, the missing-session sub-case for F-004 is unfixed; test pin must cover both in-session AND missing-session paths.
- **Test pin loss during rebase**: PRs are squash-merged to `dev`. If a regression test pin is later reverted, the bug returns silently. Mitigation: PR template includes "this PR closes F-XXX; the test at <file:line> pins the regression."

**Per-finding threat model**: see `audit/security/2026-06-08-ultra-e6759a/report.md`'s per-finding sections. Each fix targets a specific CWE.

**Least privilege**: Phase 3 (F-006) adds NO new credential surface (tuple-matching uses existing data; opus B-something reversal of single-field design).

**Cryptography**: no fix touches crypto primitives. Audit confirmed wallet-crypto is healthy.

**Input validation**:
- Phase 5's URL allowlist is the central new validation surface. Lives in `network/spec.ts` zod schemas + the node-factory adapter guard. Applied at add-network, restore, AND adapter call.
- Phase 1's account-scope check is the central new authorization gate. Lives in `wallet-bridge/scope-enforcement.ts`.

**Supply chain**: no dependency changes planned.

**Domain-specific risks**:
- Phase 4 (F-001/F-002): risk of breaking legitimate iframe-dApp support. Feature-flag mitigates. Spot-check `packages/playground/` confirmed not iframe-loaded.
- Phase 6 (F-008): risk of mis-parsing typed args and showing WRONG values. Mitigation: explicit shape-validation per op type + "Unverified summary" indexed-args fallback when shape can't be proven. Router fallback to JSON viewer for thrown errors. Triple-belt approach.

**Audit prompt**: each phase's PR review (codex post-impl per `/blueprint` spec) MUST include adversarial ask: "What can an attacker do AFTER this fix that they couldn't before? Any new attack surface introduced by the primitives?"

## Assumptions

### Facts (verified)
- The 12 findings in `audit/security/2026-06-08-ultra-e6759a/findings/consolidated.md` are accurate (verified by Phase 4 verifier — `findings/verified.md`).
- Research artifacts cite real file:line locations in current source.
- e2e:agent generates loopback-only URLs (`resolve-ports.ts` lines 106-114 produce `127.0.0.1` + `localhost` URLs only).
- `exportPlain` already has the F-007 binding pattern (`profile/service.ts:656-660`).
- `sanitizeWireString` already exists at `dapp-session/capability-meta.ts:104-166`.
- **Dispatcher has 6 separate `tryGetDappSessionByOriginAndChain` calls** (`dispatcher.ts:289, 391, 457, 505, 735, 904`) — per opus B-1.
- **Default Local Network seed is `http://localhost:8080`** (`network/service.ts:63, 88-90`) — passes the proposed loopback allowlist; per codex B-5.
- **Upstream `BackgroundConnectionHandler.sendToTab` signature is `(tabId, message)`** — does NOT accept `{frameId}` option (`node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:82-88`); per codex B-3.

### Inferences (deduced, may be wrong)
- The team uses no non-loopback dev hostnames (grep found none). **Confirm with team before Phase 5 lands.**
- `packages/playground/` does not run in iframe contexts. **Spot-check before Phase 4 lands** (per opus S-4).
- F-008's typed-arg extraction for transfer can work via Nulo's `SendAction` kind enum. The Nulo SendAction model exposes typed transfer args; if it doesn't, the "do not guess" fallback triggers — safe regression.

### Asks (decisions still needed from user)
- **Upstream coordination for F-001/F-002**: file upstream PR/issue in parallel with Phase 4, or land Nulo-side first? **Plan default**: file in parallel.
- **Phase 5 allowlist tightening**: are `localhost` / `127.0.0.1` / `::1` literals enough, or do we also accept `*.local` (mDNS)? **Plan default**: loopback only.
- **Phase 9 re-audit scope**: `max` tier is plan default. User may override to `medium` (faster) or `ultra` (deeper).
- **Subframe rejection feature flag default**: default to "reject subframes" (closes F-001) or "allow subframes" (preserves iframe-dApp compat, defers F-001 closure)? **Plan default**: reject; codex consult before merge.

## Test strategy

Per audit cross-cutting #3, **every remediation PR lands a regression test pin**. Per-phase specifics above. Common pattern:
- Unit test where the bug lives (per-checker, per-helper, per-component)
- Integration test where the bug manifests (dispatcher, popup mount, network service)
- E2E test for user-visible flows (disconnect-dApp multi-tab, add-malicious-URL, iframe-vs-topframe)

E2E tests use the existing `bun run e2e:agent` harness (parallel-safe, per-worktree).

**Test pin discipline (per opus M-2)**: PR template requires "this PR closes F-XXX; the test at <file:line> pins the regression." Reviewers verify the test exists before merging.

## Open architectural questions

1. **Should Phase 0.5 happen first or be folded into Phase 1?** Plan default: separate PR (smaller review surface, easier rollback if the dispatcher refactor introduces a subtle bug). **Question for codex final pass**: is the refactor scope small enough to merge into Phase 1?

2. **F-006 tuple-matching performance**: with multi-tab same-dApp scenarios, `handler.getActiveSessions()` iterates ALL active sessions. Typical n < 10. **No optimization needed** at this scale; revisit if upstream sessions grow into hundreds.

3. **Phase 6 router fallback UX**: when shape-validation fails and we render "Unverified summary + indexed args," what's the visual treatment? Banner? Inline marker? **Codex consult before Phase 6 merge.**

## Seeds

### `/goal` (durable outer)
```
/goal All 8 phases marked ✓ in implementations-plan/security-audit-remediation/plan.md; for each phase the agent has printed `LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-N.md` in the transcript; every phase has a regression test pin landed; /code-review max --fix complete with findings applied and committed separately from implementation; codex post-impl audit complete with high/critical findings addressed; `bun --cwd packages/extension test` + `bun --cwd packages/extension lint` + `bun --cwd packages/extension typecheck` all report exit 0 in the transcript; Phase 8's /harden security max re-run committed under audit/security/<new-date>/ with verdict matching this plan's failure-mode definition (no new related-Critical/High; unrelated findings tagged audit-followup).
```

### `/loop` (per-session cadence)
```
/loop Each turn:
1. Read implementations-plan/security-audit-remediation/plan.md + lessons/ for phase state; run git status + git log --oneline -5; if PR exists, gh pr view --json statusCheckRollup.
2. CI in flight on HEAD SHA? Stream via gh run watch <id> for up to 10 min.
3. Failed check? Triage; call /codex xhigh on non-trivial. Commit small + conventional + push. 5 failures on same step → stop + reassess.
4. Phase green? Mark ✓ in plan.md, file lessons log, print LESSONS_FILE=..., advance.
5. Nothing in flight? Pick next pending phase from plan.md (Phase 0.5 → 1 → 2 → ... 7 in order; some can parallelize per the plan); execute (edit → bun --cwd packages/extension lint → bun --cwd packages/extension test → commit → push).
6. All 7 fix phases ✓? Run post-impl sequence: /code-review max --fix → commit separately → codex post-impl audit /codex xhigh with adversarial ask → address high/critical findings → /harden security max for Phase 8 → compare against audit/security/2026-06-08-ultra-e6759a/. Apply Phase 8 failure-mode protocol if new H/C findings. Stop + surface.

Discipline: plan.md authoritative. Per-finding codex consult on Phase 3 (cross-package session-id wiring) + Phase 4 (subframe rejection feature flag) + Phase 6 (router fallback UX). Never merge to main or release branches. Stop when 7 fix phases ✓ + post-impl clean + Phase 8 re-audit shows no new related H/C.
```
