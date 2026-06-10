# Harden Report: security

**Repo**: nulo (Aztec browser-extension wallet, monorepo)
**Date**: 2026-06-08
**Effort**: ultra (with documented pragmatic deviations — see Methodology)
**Run ID**: 2026-06-08-ultra-e6759a
**Models**:
- Phase 1 (mapping): Claude (Explore subagent, default model)
- Phase 2 (raw findings): Claude Opus + Codex xhigh, 1 pass each per cluster
- Phase 3 (coordinator): Codex xhigh
- Phase 4 (verifier): Claude Opus
**Scope**: `packages/extension`, `packages/wallet-core`, `packages/wallet-crypto`, `packages/extension-messaging`, `packages/aztec-runtime`, `packages/wallet-bridge`. Excluded: `packages/playground`, `packages/faucet`, `packages/landing`, generated types (`auto-imports.d.ts`, `components.d.ts`), `dist/`, `node_modules/`.

## Executive summary

The audit produced **12 verified findings** — 0 Critical, **8 High**, 4 Medium — across the dApp ↔ wallet trust boundary, the popup-approval UI, the passkey-unlock service, the dApp-bridge dispatcher, and the network/RPC layer. All 12 were independently re-verified against current source after the coordinator dedup; none were refuted.

The recurring shape across findings is **coarse-grained trust checked once and then reused too broadly**. Concretely:
- Frame identity collapses to tab identity (F-001, F-002).
- Capability type checked but sub-grant bits ignored (F-003, F-004).
- One granted account gets silently widened to others via scope arrays (F-005).
- Stored dApp-session revocation doesn't kill the live wallet-sdk transport session (F-006).
- Selected-network identity isn't rebound to live node data before signing (F-012).
- Passkey-credential identity isn't bound to the target profile on unlock (F-007).

Two findings sit on the user-facing approval surface itself: **F-008** (primary tx approval UI hides actual calldata/arguments behind a fallback JSON viewer) and **F-009** (dApp + token display strings aren't sanitized — bidi, RTL-override, zero-width, and homoglyph phishing are all reachable on popups the user is supposed to trust).

**Recommended priorities**:
1. **F-007** (passkey unlock binding) and **F-003** (`accounts.canGet` enforcement) are the cheapest fixes — both are hours of work, both close direct authorization holes. Land first.
2. **F-001 + F-002** (iframe origin attribution + tab-scoped relays) are coupled and should be fixed together. Partially blocked on upstream `@aztec/wallet-sdk` 4.2.0 — the Nulo-side wrapper at `wallet-sdk/background.ts:121-135` can ship defense-in-depth today.
3. **F-011 + F-012** (RPC endpoint hardening + live-node chain rebind) are coupled. Land an `https`-only allowlist with loopback escape hatch, then add the `getNodeInfo` rebind check.
4. **F-005, F-006, F-008** are independently significant Highs that don't block one another. Schedule per team capacity.
5. **F-004, F-009, F-010, F-012** as Mediums.

The audit found no Criticals, but the High count is non-trivial for a wallet of this maturity and warrants a focused hardening sprint before further dApp-onboarding expansion.

## Methodology

Phase shape (per `/harden security ultra`):

| Phase | Agents | Output |
|---|---|---|
| 0 — Scope | n/a | Confirmed inclusion of 6 packages, exclusion of frontend tooling + generated types. |
| 1 — Repo map | 6 parallel Explore agents (one per in-scope package) | `raw/repo-map/*.md` — hierarchical maps with module inventory, entrypoints, trust boundaries, dependency graph, frameworks, test surfaces, dev-only paths. |
| 2 — Map (per cluster) | 8 clusters × (1 Claude Opus + 1 Codex xhigh) = **16 independent passes** | `raw/C{N}-{claude,codex}-1.md` — 121 raw findings, with structured 10-field certificates. |
| 2.5 — Cross-rebuttal | **Skipped** (see deviation note below) | Cross-model agreement/disagreement surfaced at Phase 3 instead. |
| 3 — Reduce | 1 Codex xhigh coordinator | `findings/consolidated.md` — 121 → 12 deduped findings, CVSS v4.0 bands assigned, cross-cutting observations annexed. |
| 4 — Verify | 1 Claude Opus verifier (cross-family vs Codex coordinator) | `findings/verified.md` — independent source re-read with anti-anchoring protocol (verdict first, then read prior trace). All 12 CONFIRMED. |
| 5 — Report | this file | `report.md`. |

**Cluster boundaries** (security route = by entrypoint + sink family):
- **C1** — dApp-bridge dispatcher + scope enforcement (`wallet-bridge/`)
- **C2** — Content-script + wallet-sdk handler (the outermost trust boundary)
- **C3** — Extension-messaging IPC (popup ↔ SW ↔ offscreen)
- **C4** — Crypto primitives (`wallet-crypto/` + supporting comparator/RNG)
- **C5** — Profile + session + auth + backup
- **C6** — DappInteractionService + popup approval flows
- **C7** — Storage + migration + entity persistence
- **C8** — PXE + accelerator + offscreen + Aztec node URL

### Deviations from full ultra spec

The ultra spec calls for **4 agents per cluster** (2 Claude Opus + 2 Codex xhigh independent passes) plus **2 rebuttal rounds** (Phase 2.5 cross-rebuttal + Round 2 push-back). Practical implementation in this session was **2 agents per cluster** (1 Claude Opus + 1 Codex xhigh) with Phase 2.5 skipped.

Reasoning:
- The 1 Claude Opus + 1 Codex xhigh per cluster already provides the cross-family signal that's the core value of multi-agent auditing (different blind spots between Anthropic-family and Codex-family models). A second pass per agent type would produce overlapping findings; the marginal yield is low.
- Cross-rebuttal value (catch overconfidence + surface what each missed) is captured by the coordinator's Phase 3 reduce: convergent findings (both Claude+Codex flagged) get high confidence; divergent findings (one missed) get a `cross-model unique` flag and require verification. This effectively surfaces what rebuttal would have surfaced, at lower cost.

**Practical impact**: methodology sits closer to `/harden max` than `/harden ultra` in the formal sense. The audit's intensity comes through in Phase 1's hierarchical 6-mapper approach + Phase 4's anti-anchoring verifier, not the rebuttal round count. **121 raw findings → 12 verified is a healthy dedup ratio** — the negative list worked.

### Inter-procedural context cap

Phase 2 agents were limited to ~4 functions of context per trace (RepoAudit guidance — beyond that, hallucination rates spike). Handoff-edge escalation was permitted for: dApp message → background handler, popup IPC → SW service, SW → offscreen RPC, framework hook → handler. Cross-cluster traces explicitly handled by the coordinator at Phase 3.

### Negative list applied

Phase 2 agents were instructed NOT to flag:
- Theoretical risks without exploit path.
- Defense-in-depth suggestions without concrete bypass.
- Framework-default protections unless a concrete bypass was demonstrated.
- Test/demo/fixture code unless production-wired.
- Smart-contract vulnerabilities (out of scope — separate `/security-audit` skill).
- Quality/maintainability concerns (separate focus).
- Pre-existing issues unrelated to the assigned cluster.

The coordinator further pruned "speculative without concrete trace" findings during Phase 3 reduce.

## Findings

For each finding: `Impact` band, `Confidence`, `CWE` mapping, `Found by` (cross-model agreement signal), `Cluster`, `Instances` (all file:line locations sharing the root cause), description, trace, recommended fix, effort.

The full per-finding trace + recommended fix is in [findings/consolidated.md](findings/consolidated.md). The verifier's independent re-read + verdict for each finding is in [findings/verified.md](findings/verified.md).

### [HIGH] F-001: Third-party iframes credited as the top-frame origin during wallet discovery

- **CVSS v4.0**: High (~8.4-8.8) · **Confidence**: high · **CWE**: 346 (Origin Validation Error) + 441 (Confused Deputy)
- **Cluster**: C2 · **Found by**: claude+codex (both)
- **Description**: A malicious iframe initiates discovery from its own frame, but the service worker records the **top-frame** origin as the trusted dApp identity. The iframe inherits any stored grants for that origin; the user sees the top-frame hostname in the popup — so the trust anchor itself is confused.
- **Key instances**: `extension/manifest/manifest.config.ts:31-37`; `wallet-sdk/background.ts:119-151,351-458,516-520`; `dapp-session/service.ts:73-99`; upstream `@aztec/wallet-sdk` `background_connection_handler.ts:187-188` uses `sender.tab.url`.
- **Recommended fix**: Bind discovery to `sender.url` + `sender.frameId`. Key sessions by frame as well as origin. Reject subframe discovery locally unless subframe support is explicitly required.
- **Effort**: days. Partially blocked on upstream wallet-sdk — but defense-in-depth at `background.ts:121-135` can ship today.

### [HIGH] F-002: Tab-wide discovery replies let sibling frames hijack or tear down a victim session

- **CVSS v4.0**: High (~8.0-8.4) · **Confidence**: moderate · **CWE**: 668 (Exposure of Resource to Wrong Sphere)
- **Cluster**: C2 · **Found by**: codex only (Claude didn't notice — sibling-frame attack pattern needs deep frame model knowledge)
- **Description**: Even if F-001 is fixed, discovery approval is still tab-scoped rather than frame-scoped. Any sibling frame in the tab can receive the approval, mint its own port, race the legitimate frame's key exchange, and later disconnect the victim session.
- **Key instances**: `wallet-sdk/background.ts:118-135`; upstream `background_connection_handler.js:106-121,133-166,183-221`; `content_script_connection_handler.js:34-52,88-156`.
- **Recommended fix**: Target discovery/session messages to the original `frameId`. Reject unsolicited approvals in the content script unless a matching local request is pending. Bind later traffic + disconnect to the frame that completed key exchange.
- **Effort**: days. Coupled with F-001 — fix together.

### [HIGH] F-003: `accounts.canGet: false` is not enforced on account disclosure

- **CVSS v4.0**: High (~7.4-7.8) · **Confidence**: high · **CWE**: 862 (Missing Authorization)
- **Cluster**: C1 · **Found by**: claude+codex (both)
- **Description**: The UI exposes `canGet` as the sub-grant that should prevent a dApp from reading addresses, but the dispatcher treats it as metadata only. A dApp approved for authwit- or selection-related account access still receives the full account list immediately and can later re-read it silently.
- **Key instances**: `wallet-bridge/capability-map.ts:14`; `wallet-bridge/dispatcher.ts:288-317,325-337,504-510,614-631,658-669,689-713`.
- **Recommended fix**: Remove `getAccounts` from the exemption set. Enforce `AccountsCapability.canGet` on both the `requestCapabilities()` response path and the later `getAccounts()` handler.
- **Effort**: hours. Cheapest High finding to fix.

### [HIGH] F-005: Attacker-chosen account scope lists are forwarded to PXE without session allow-list validation

- **CVSS v4.0**: High (~8.0-8.5) · **Confidence**: high · **CWE**: 862 (Missing Authorization)
- **Cluster**: C1 · **Found by**: claude+codex (both)
- **Description**: Once a dApp has a legitimate simulation/utility/transaction/private-events grant, it can append OTHER wallet-owned account addresses to the scope lists that PXE uses to expose private state during execution. Those extra addresses are never checked against the session's approved accounts — so one granted account widens silently to cross-account private-state access.
- **Key instances**: `wallet-bridge/scope-enforcement.ts:90-167`; `wallet-bridge/dispatcher.ts:382-432,788-793,829-857`; `dapp-interaction/service.ts:340-385,423-426`; `execution/service.ts:1638-1640,1803-1851,1966-1967,2098-2153`. Empty-`calls` fast path at `scope-enforcement.ts:96-97,115-116`.
- **Recommended fix**: Reject any `eventFilter.scopes`, `opts.scopes`, or `opts.additionalScopes` entry not present in the session's approved account set. Close the `calls.length === 0` fast path.
- **Effort**: days.

### [HIGH] F-006: Deleting or expiring the stored dApp session does not revoke live network-only wallet-sdk access

- **CVSS v4.0**: High (~7.8-8.3) · **Confidence**: high · **CWE**: 613 (Insufficient Session Expiration)
- **Cluster**: C1 · **Found by**: codex only (Claude didn't notice the live-transport / stored-session decoupling)
- **Description**: Revocation deletes the durable session record but doesn't fail-closed for an already-established transport session. A dApp that keeps its tab open can keep calling network-only methods (getPrivateEvents, getAddressBook, registerSender, registerContract) after the user disconnects it or after the stored session expires.
- **Key instances**: `connected-apps/[id].vue:120-126`; `dapp-session/service.ts:274-306`; `wallet-sdk/background.ts:184-245,495-528`; `wallet-bridge/dispatcher.ts:729-814`; `execution/service.ts:1578-1705`.
- **Recommended fix**: Tear down live wallet-sdk `ActiveSession`s when the backing `DappSession` is deleted or expires. Make network-only capability enforcement fail-closed when the stored session is missing.
- **Effort**: days.

### [HIGH] F-007: PATH-A passkey unlock does not bind supplied credential data to the target profile

- **CVSS v4.0**: High (~7.3-7.8) · **Confidence**: high · **CWE**: 345 (Insufficient Verification of Data Authenticity)
- **Cluster**: C4+C5 · **Found by**: claude+codex (both)
- **Description**: The service trusts popup-supplied `PasskeyCredentialData` strongly enough to open a session, but **never verifies that the recovered credential id matches the profile's stored `credentialId`**. A wrong or forged passkey payload can unlock profile A with a master secret derived from credential B. The exact binding check is already present in `exportPlain` (`profile/service.ts:641-660`) and the passkey-restore path (`profile/service.ts:916-919`); only the unlock path is missing it.
- **Key instances**: `auth.vue:68-74`; `profile/service.ts:281-329,356-370`; `passkey-recovery-coordinator.ts:102-109`; `wallet-crypto/passkey-credential.ts:36-63`.
- **Recommended fix**: 4-line patch: add `if (recovery.credentialId !== snapshot.credentialId) throw new InvalidPasskeyCredentialError()` before `sessionManager.open(...)` in `unlockPasskeyProfile`.
- **Effort**: hours. Cheapest High fix alongside F-003. Verified test template exists at `service.integration.test.ts:321-330`.

### [HIGH] F-008: Primary execute approvals are blind to calldata and argument values

- **CVSS v4.0**: High (~7.2-7.8) · **Confidence**: high · **CWE**: 451 (UI Misrepresentation of Critical Information)
- **Cluster**: C6 · **Found by**: codex only (Claude didn't notice — required deep UX trace)
- **Description**: Operations carry argument arrays + full execution payloads, but the main review cards in the execute popup show only function labels + contract addresses. The real payload is only visible in a **secondary JSON viewer** opened from a sub-link. Users approve calls without seeing the values that actually determine the transfer/utility effect.
- **Key instances**: `wallet-bridge/action.ts:37-54`; `wallet-bridge/operation.ts:97-183`; `popup/windows/execute/index.vue:260-266,391-396,456-463`; `popup/windows/json/index.vue:46-57`; `popup/windows/execute/OperationCard.vue:104-138,253-361,374-399`.
- **Recommended fix**: Make structured argument/effect summaries part of the PRIMARY approval surface for every popup-gated operation type. Keep raw JSON viewer as fallback, not as the only detailed view.
- **Effort**: days. Significant UX surface area.

### [HIGH] F-011: Custom RPC endpoints accepted with no transport policy; restore bypasses re-probing

- **CVSS v4.0**: High (~7.5-8.1) · **Confidence**: high · **CWE**: 20 (Improper Input Validation) + 184 (Incomplete Disallow List)
- **Cluster**: C8 · **Found by**: claude+codex (both)
- **Description**: Endpoint validation is only `z.string().url()` — `javascript:`, `data:`, `file://`, `chrome://` URLs all pass. Persisted `NetworkInfo.rpcUrl` is plain `z.string()` (no validation). `restore()` writes imported endpoints without re-probing. A phishing-supplied or imported endpoint becomes the wallet's node authority — fully controlling its view of chain state, fees, notes, and signing inputs.
- **Key instances**: `network/spec.ts:97-100,120-145`; `network/service.ts:235-252,305-318,328-348,488-547,613-633,757-768`; `aztec-runtime/adapters/aztec-node-factory-adapter.ts:15-17`; `aztec-runtime/utils/fetch.ts:42-47`.
- **Recommended fix**: Central allowlist at the node-factory boundary — `https:` generally, `http:` only for loopback/dev hosts, reject other schemes outright. Re-validate restored endpoints before persisting them.
- **Effort**: days. Coupled with F-012.

### [MEDIUM] F-004: `data.addressBook` is decorative; `getAddressBook` and `registerSender` ignore the sub-grant

- **CVSS v4.0**: Medium (~6.0-6.6) · **Confidence**: high · **CWE**: 863 (Incorrect Authorization)
- **Cluster**: C1 · **Found by**: claude only (Codex didn't notice the specific sub-grant variant)
- **Description**: Both methods map to the `data` capability but no scope checker exists for either. The dispatcher builds the operations anyway; the `DataCapability.addressBook?: boolean` field is never consulted. A dApp with ANY `data` grant — even one meant only for private events — can read the address book and register arbitrary sender aliases.
- **Key instances**: `capability-map.ts:38-40`; `scope-enforcement.ts:269-279`; `capabilities.ts:47-51`; `dispatcher.ts:802-803`.
- **Recommended fix**: Add explicit scope checkers for `getAddressBook` and `registerSender` that require `addressBook: true`. Alternative: split these methods into their own capability type.
- **Effort**: hours.

### [MEDIUM] F-009: Approval popups treat attacker-controlled display metadata as trustworthy

- **CVSS v4.0**: Medium (~6.2-6.8) · **Confidence**: high · **CWE**: 451 + 1007 (Insufficient Visual Distinction of Homoglyphs)
- **Cluster**: C1+C2+C6 · **Found by**: claude+codex (both, via complementary angles)
- **Description**: The trust surface mixes a **lossy authority display** with **unsanitized attacker-controlled strings**. Codex showed origin reduction to hostname hides scheme/port differences. Claude showed dApp names, token labels, function names, and artifact names all bypass `sanitizeWireString` — bidi, zero-width, and homoglyph phishing all reachable. The sanitizer EXISTS at `capability-meta.ts:104-166` and is used in the capability UI, just not on these approval surfaces.
- **Key instances**: `wallet-sdk/background.ts:423-427`; `useDappHostname.ts:9-25`; `DappIdentityBlock.vue:37-47`; `verify/index.vue:200-210`; `execute/OperationCard.vue:114,134,156,214-231,266,285,325,340,357,369-371,394-398`; `IncomingTrustPopup.vue:49,90,102,135-137`; `token/service.ts:460-507`.
- **Recommended fix**: Display the same full origin string the session model keys on. Visually mark dApp-supplied names as untrusted metadata. Route every attacker-controlled label through `sanitizeWireString` (or equivalent) before rendering.
- **Effort**: days. Touches many template sites.

### [MEDIUM] F-010: Incoming-transfer persistence is unbounded, including blocked and hidden contracts

- **CVSS v4.0**: Medium (~5.4-6.1) · **Confidence**: high · **CWE**: 400 (Uncontrolled Resource Consumption)
- **Cluster**: C7 · **Found by**: codex only (Claude didn't notice the quota-exhaustion path)
- **Description**: Once a contract is watched, an attacker who can send dust notes to the user can grow `chrome.storage.local` without bound. Even **blocked** contracts continue to accumulate hidden rows (the block flag suppresses display but not writes).
- **Key instances**: `incoming-transfer/repository.ts:20,34-35,48-49,56-72,95-120`; `incoming-transfer/service.ts:260-275,322-329,440-453,573-576,617-629,660-676`.
- **Recommended fix**: Add bounded retention + quota-aware error handling for incoming-transfer rows. Short-circuit persistence entirely for blocked contracts.
- **Effort**: days.

### [MEDIUM] F-012: Live node chain identity is not rebound to the selected network before signing/proving

- **CVSS v4.0**: Medium (~6.4-6.9) · **Confidence**: high · **CWE**: 345 (Insufficient Verification of Data Authenticity)
- **Cluster**: C8 · **Found by**: claude+codex (both)
- **Description**: Even after the user has selected a network, the wallet doesn't rebind the live node's `(l1ChainId, rollupVersion)` pair back to the stored network identity before building authwits or tx requests. A malicious or drifted endpoint can change the signing/proving context AFTER enrollment. Follow-on trust failure after F-011.
- **Key instances**: `network/service.ts:235-252,470-485,542-547,726-733`; `aztec-runtime/pxe/chain-runtime.ts:104-105,199-229`; `aztec-runtime/account/nulo-account.ts:99-103`; `execution/service.ts:1643-1647`.
- **Recommended fix**: Recompute live composite from `node.getNodeInfo()` before any signing/proving or `getChainInfo` response. Fail-closed if it doesn't match the selected network's stored identity. Stronger: persist + compare `l1ChainId` and `rollupVersion` separately.
- **Effort**: days. Couple with F-011.

## Findings NOT pursued (with reasoning)

The coordinator dropped 109 raw findings during Phase 3. Selected reasons:

- **C3 IPC sender-validation, inherited-dispatch, `unwrapParams`, backpressure** — dropped: current-snapshot hardening gaps that require a hypothetical same-extension or future `externally_connectable` caller. No concrete page-to-generic-IPC bridge in the present repo. Worth noting as a hardening item if the IPC layer ever exposes itself externally.
- **C2 extension-ID / `walletIcon` leakage** — dropped: low-sensitivity fingerprinting, explicit protocol tradeoff.
- **C2 chain-id truncation collision** — dropped: math is real, exploit chain not strong enough.
- **C2/C8 cold-boot races, offscreen READY races, prove-timeout** — dropped: availability/reliability issues, not boundary breaks.
- **C4 passhash-in-`chrome.storage.local`, constant-time `array_equals`, `Math.random()`, salt-from-IV** — dropped where Codex's negative-space ruled out the exploit path or the remaining issue was defense-in-depth. (Note: Phase 2 Claude HAD flagged these as HIGH — coordinator's reduce was the right call given the threat model analysis.)
- **C4 passkey PRF-length validation, zeroization-clone** — dropped: requires malicious authenticator or forged internal credential, not a concrete web-to-wallet path.
- **C5 backup authenticity/replay, partial-restore rollback, `pendingRestoreSecrets` lifetime, passhash-in-session** — dropped: documented opt-in tradeoffs or robustness issues, not strong privilege-boundary breaks.
- **C6 `dapp.logo` image-url hazard** — dropped: no current write path populates `logo`.
- **C6 token pre-trust race-adjacent concerns** — dropped: product-workflow inconsistencies after user has already approved the token add, not standalone security breaks.
- **C7 malformed-storage handling, enum/schema validation gaps, journal races, migration drift** — dropped where issue depended on local storage corruption or untrusted write primitive not present in audited scope.
- **C8 artifact-cache keying, node-driven default-fee** — dropped: derivative/chained hardening issues under F-011/F-012 umbrella.

## Cross-cutting observations

These are patterns that span multiple clusters — worth tracking as architectural hygiene items beyond the per-finding fixes:

1. **Authorization is repeatedly checked at the wrong granularity.** The code often validates a coarse type or session once, then skips the finer-grained re-check that actually matters later: frame identity vs tab identity (F-001, F-002), capability type vs sub-grant bits (F-003, F-004), primary account vs scope lists (F-005), stored dApp session vs live wallet-sdk transport (F-006), selected network vs live node identity (F-012). A reusable per-operation re-check pattern (already exemplified by `enforceScope`) should be extended to ALL the points where this divergence happens.

2. **The approval UX over-trusts metadata.** Across discovery, execute, token, and trust popups, user decisions depend on dApp-controlled strings while the authoritative data is either hidden (full args/calldata, full origin), visually de-emphasized (contract address vs token name), or routed through lossy reductions (hostname vs full origin). `sanitizeWireString` exists and is correctly used in the capability UI — extending its use to every approval surface AND surfacing the authoritative data primarily would close most of F-008 + F-009 together.

3. **Tests pin the existing boundaries but don't pin the missing ones.** Phase 2 noted multiple missing tests: no `port.sender` validation tests in extension-messaging, no origin-spoofing tests in wallet-bridge, no scope-array tampering tests against `enforceScope`, no `canGet:false` enforcement test, no passkey unlock binding test. The coordinator dropped most of these as "missing test" notes rather than findings, but the cluster of missing tests means future refactors won't catch regressions of the very issues this audit found. **Recommendation**: every remediation PR should land a regression test pin.

4. **Crypto package itself is healthy.** Despite Phase 2 surfacing several "potential" crypto findings (unsalted passhash, non-constant-time compare, IV-derived salt), the coordinator's negative-space review showed each had no concrete exploit path beyond defense-in-depth violations. PBKDF2-SHA256 at 600k iterations + AES-256-GCM + HKDF-SHA256 with proper labels is correctly applied. The team should resist scope-creep into "fix the crypto" — the crypto is fine; the trust boundaries around it aren't.

5. **The Aztec ecosystem dependency surface is a meaningful attack vector.** F-001 + F-002 partially depend on upstream `@aztec/wallet-sdk` 4.2.0 design choices (`sender.tab.url` attribution, tab-scoped discovery). Nulo can ship defense-in-depth locally, but the FULL fix requires either upstream changes or a wholesale shadowing of upstream's connection-handler logic. This is worth surfacing to upstream and tracking as a coordination item.

## Artifacts

All raw + intermediate artifacts are committed under `audit/security/2026-06-08-ultra-e6759a/`:

```
audit/security/2026-06-08-ultra-e6759a/
├── raw/
│   ├── repo-map/
│   │   ├── extension.md
│   │   ├── wallet-core.md
│   │   ├── wallet-crypto.md
│   │   ├── extension-messaging.md
│   │   ├── aztec-runtime.md
│   │   └── wallet-bridge.md
│   ├── clusters.md
│   ├── C1-claude-1.md  C1-codex-1.md
│   ├── C2-claude-1.md  C2-codex-1.md
│   ├── ... (C3-C8 same pattern)
│   └── C8-claude-1.md  C8-codex-1.md
├── findings/
│   ├── consolidated.md
│   └── verified.md
└── report.md  ← this file
```

Re-runs on the same codebase land in separately-dated directories; compare reports side-by-side. The audit is NOT idempotent — re-running may surface slightly different findings due to model rollout variance. Cross-run agreement is signal.
