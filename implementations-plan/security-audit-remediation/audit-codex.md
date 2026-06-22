# Codex audit — security-audit-remediation plan

## Verdict
`reject (with blocking findings: Phase 1 does not actually close F-003/F-004 as written; Phase 5's frame-targeted mitigation is infeasible in the current wallet-sdk transport; Phase 6's F-012 hook plan is incomplete and partly impossible at the chosen boundary; Phase 6 omits a boundary guard the audit explicitly asked for.)`

## Blocking findings (must address before approval)

### B-1: Phase 1 leaves the F-003 `requestCapabilities()` leak open
**Severity**: blocker
**Trace**: `implementations-plan/security-audit-remediation/plan.md:36-63` only adds a `getAccounts` checker, removes the exemption, and pins the later handler. The audit requires both the later handler and the initial grant-response path to enforce `accounts.canGet` (`audit/security/2026-06-08-ultra-e6759a/report.md:112-119`). Current `packages/wallet-bridge/src/dispatcher.ts:689-713` still returns `accounts: sessionAccounts.map(...)` unconditionally while only copying `canGet` from storage at `:704-707`. `implementations-plan/security-audit-remediation/plan-codex.md:18-20` had the missing fix and the consolidated plan dropped it.
**Why it blocks**: the primary disclosure happens at capability-grant time. A dApp can still receive the full selected account list immediately after approval even if the later `getAccounts()` call is blocked.
**Recommended fix**: expand Phase 1 to modify `enrichGrantedCapabilities()` so `accounts` is empty unless stored `accounts.canGet === true`, and add a dispatcher regression pin for "requestCapabilities does not echo selected accounts when canGet=false".

### B-2: Phase 1 claims to close F-004 but omits `registerSender`
**Severity**: blocker
**Trace**: `implementations-plan/security-audit-remediation/plan.md:39-45` scopes the change to `checkGetAccounts` and `checkGetAddressBook`. F-004 in the audit is explicitly two methods: `getAddressBook` and `registerSender` (`audit/security/2026-06-08-ultra-e6759a/report.md:166-173`). The current checker map still has neither method at `packages/wallet-bridge/src/scope-enforcement.ts:269-279`. Both `plan-codex.md:17-18` and `plan-opus.md:32-35` kept `checkRegisterSender`; the consolidation dropped it without justification.
**Why it blocks**: with the plan as written, any dApp holding any `data` grant still keeps the write-side address-book capability the audit called out.
**Recommended fix**: Phase 1 must add `checkRegisterSender` requiring `data.addressBook === true`, plus a regression pin for both `getAddressBook` and `registerSender`.

### B-3: Phase 5 assumes frame-targeted discovery replies that the current transport cannot send
**Severity**: blocker
**Trace**: `implementations-plan/security-audit-remediation/plan.md:153-181` assumes Nulo can change `sendToTab` to `chrome.tabs.sendMessage(tabId, message, { frameId })` and then key sessions by frame. Chrome supports `frameId` on tab messages (`node_modules/@types/webextension-polyfill/namespaces/tabs.d.ts:520-527`), but that is not the boundary this code uses. The actual wrapper is `sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message)` (`packages/extension/src/wallet/services/wallet-sdk/background.ts:118-118`). Upstream hard-codes the transport interface to two arguments (`node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:82-88`) and all the vulnerable paths call it without a frame id (`:255-260`, `:310-315`, `:360-364`). The research already flagged this dependency (`implementations-plan/security-audit-remediation/research/frame-scoped-discovery.md:60-74`).
**Why it blocks**: the proposed F-002 mitigation cannot work as described. A mocked wrapper test can go green while the real exploit path remains tab-scoped.
**Recommended fix**: rewrite Phase 5 around feasible local mitigations. If iframe support is not required, clamp to top-frame-only (`manifest.config.ts`) and add content-script pending-request correlation. If iframe support is required, mark frame-targeted routing as upstream-blocked or vendor/shadow the connection handler instead of pretending the current transport already carries `frameId`.

### B-4: Phase 6's F-012 plan chooses a hook that does not have the data it needs and misses multiple real sinks
**Severity**: blocker
**Trace**: `implementations-plan/security-audit-remediation/plan.md:189-199` limits F-012 mostly to `nulo-account.ts` and `executeAztecGetChainInfo()`. But `packages/aztec-runtime/src/account/nulo-account.ts:92-103` already calls `node.getNodeInfo()` only to build live `chainInfo`; it has no selected-network identity to compare against, and `packages/aztec-runtime/src/account/index.ts:25-31` exposes no parameter for that identity. Meanwhile other call sites independently consume live node identity today: `packages/extension/src/wallet/services/execution/tx-request-builder.ts:106-106,447-455`, `packages/extension/src/wallet/services/execution/authwit-discoverer.ts:100-101`, `packages/extension/src/wallet/services/execution/fast-path.ts:170-175`, `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:236-243`, `packages/extension/src/wallet/services/execution/service.ts:2202-2207`. The audit also names `packages/aztec-runtime/src/pxe/chain-runtime.ts:104-105,199-229` as part of the trust surface (`audit/security/2026-06-08-ultra-e6759a/report.md:193-200`). `plan-codex.md:72-87` captured the broader sink set; the consolidated plan regressed it.
**Why it blocks**: at the chosen account-contract hook, the comparison cannot be implemented without additional interface plumbing that the plan never acknowledges. Even if you add that plumbing, the plan still leaves other live-node identity reads untouched.
**Recommended fix**: redesign F-012 around a shared `assertLiveChainIdentity(networkInfo, nodeInfo)` helper at call sites that already have both `network` and `node`, and make any account-level hook an explicit follow-on interface change rather than an implicit "small patch". Expand the sink list and test pins accordingly.

### B-5: Phase 6 omits the node-factory boundary guard the audit explicitly recommended for F-011
**Severity**: high
**Trace**: `implementations-plan/security-audit-remediation/plan.md:189-201` adds schema validation and restore-time validation, but omits the node-factory boundary guard. The audit recommendation is explicit: "Central allowlist at the node-factory boundary" (`audit/security/2026-06-08-ultra-e6759a/report.md:157-164`). The research repeats the same point (`implementations-plan/security-audit-remediation/research/rpc-url-allowlist.md:12-15,35-36`). The actual adapter remains a raw pass-through at `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:15-17`.
**Why it blocks**: the plan leaves the last trust boundary unguarded. Older persisted rows, restore mistakes, and future internal bypasses can still feed arbitrary schemes into `createAztecNodeClient(...)`. The plan also misstates rollback context: it says "existing networks all use https" (`plan.md:201`), but the seeded Local Network is `http://localhost:8080` today (`packages/extension/src/wallet/services/network/service.ts:63,88-90`).
**Recommended fix**: include the adapter guard in Phase 6, and correct the rollback/migration notes to acknowledge the existing loopback HTTP seed.

## Significant findings (should address; conditional approval requires acknowledgment)

### S-1: Phase 4's single `walletSdkSessionId` field conflicts with actual session cardinality and the plan's own later frame-scoping
**Trace**: `implementations-plan/security-audit-remediation/plan.md:123-129,298-301` and `decision-ledger.md:128-140` choose a single `walletSdkSessionId?: string`. Current storage is one `DappSession` per `(origin, chainId, profileId)` (`packages/extension/src/wallet/services/dapp-session/service.ts:85-99`), but upstream can hold multiple live `ActiveSession`s keyed by `sessionId` (`node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:167-170,290-301,412-417`). Returning-user discovery auto-approves new tabs against the same stored row (`packages/extension/src/wallet/services/wallet-sdk/background.ts:373-380`), and `onSessionEstablished` only looks up one stored row and writes `verificationHash` back to it (`:153-164`). Phase 5 then proposes frame-scoped session keying at `plan.md:156`.
**Impact**: even if fail-closed closes the main access bug, this data model does not reliably achieve the teardown goal the phase claims, and it does not compose with the later frame-scoped design.
**Recommended fix**: either terminate by tuple over `handler.getActiveSessions()` or model a one-to-many association explicitly. Do not approve Decision 8's single-field rationale as final.

### S-2: Phase 7's typed-arg plan can silently lie; fallback-on-throw is not a real mitigation
**Trace**: `implementations-plan/security-audit-remediation/plan.md:204-232,279-280,294-296` assumes transfer-style semantic summaries can be extracted from a "typed" model. The actual model is deliberately generic: `packages/wallet-bridge/src/action.ts:37-54` has only `call` / `encoded_call` actions with `args: unknown[]` / `string[]`, and `packages/wallet-bridge/src/operation.ts:79-104,176-190` has no typed transfer payload. The research says this explicitly (`implementations-plan/security-audit-remediation/research/approval-card-redesign.md:18-27`) and warns that semantic extraction requires runtime interpretation (`:98-99`).
**Impact**: worst case, a malicious dApp crafts a payload whose method label, selector, and arg positions look transfer-like, and the UI renders a precise-but-wrong "To / Amount" summary. No exception is thrown, so the router fallback never activates. Multi-call payloads make this worse: a benign-looking first call can distract from a harmful later call.
**Recommended fix**: use a proof rule, not an exception rule. Only show semantic labels when the wallet can prove the shape from wallet-owned builders or a locally resolved ABI/artifact. Otherwise render indexed args plus an explicit "unverified summary" / "summary incomplete" marker. Add negative tests for silent misclassification, not just malformed-input fallback.

### S-3: Phase 8's sanitization sweep is incomplete as scoped
**Trace**: `implementations-plan/security-audit-remediation/plan.md:207-214` says low-change execute kinds stay inline in `OperationCard.vue`, but `plan.md:237-243` omits `OperationCard.vue` from the F-009 sweep. The current inline card still renders unsanitized attacker-controlled labels at `packages/extension/src/popup/windows/execute/OperationCard.vue:114,134,156,223,231,266,285,340,357,371,394-398`. The audit names this file directly for F-009 (`audit/security/2026-06-08-ultra-e6759a/report.md:175-182`).
**Impact**: even if the new extracted components sanitize correctly, the residual inline execute surfaces remain phishable.
**Recommended fix**: keep `OperationCard.vue` in Phase 8 scope unless Phase 7 fully routes every execute-card string through sanitized subcomponents.

### S-4: The Assumptions section overstates evidence and drops asks that Phase 0 said to surface
**Trace**: `implementations-plan/security-audit-remediation/clarifying-answers.md:74-77` said to surface exact F-001/F-002 coordination, F-011 loopback host patterns, and the F-008 collapse threshold. The consolidated asks section only keeps three asks at `plan.md:298-301`, dropping the loopback-host policy and the collapse-threshold decision entirely. The inferences are also shaky:
- `plan.md:293` says no non-loopback dev hostnames were found, but there is at least a test fixture using `http://node.local` at `packages/aztec-runtime/src/pxe/chain-runtime.test.ts:67`.
- `plan.md:294` treats `chrome.tabs.sendMessage(..., {frameId})` support as the main uncertainty, but the real issue is the upstream two-argument transport interface (`background_connection_handler.ts:82-88`), not Chrome capability.
- `plan.md:296` assumes `walletSdkSessionId` population is straightforward, but current data flow creates a stored session before approval (`packages/extension/src/wallet/services/wallet-sdk/background.ts:452-465`) and later auto-approves additional discoveries against the same stored session (`:373-380`).
**Impact**: the plan silently resolves policy questions that were supposed to be explicit product/engineering choices.
**Recommended fix**: move iframe policy, exact loopback/dev-host allowlist, F-008 confidence/collapse rule, and F-006 teardown-model choice back into explicit approval-gate asks.

### S-5: The consolidated plan is weaker than the drafts it claims to synthesize
**Trace**: concrete regressions include:
- `plan-codex.md:18-20` had the missing F-003 response-path fix; consolidated plan lost it.
- `plan-codex.md:17-18` and `plan-opus.md:32-35` kept `registerSender`; consolidated plan lost it.
- `plan-codex.md:97-115` kept manifest/content-script pending-request defenses for F-001/F-002; consolidated plan replaced them with an infeasible frame-targeting assumption.
- `plan-codex.md:117-137` kept the node-factory guard for F-011; consolidated plan lost it.
- `plan-codex.md:72-87` kept broader F-012 sink coverage; consolidated plan narrowed it.
**Impact**: this is not just stylistic drift. Coverage regressed below already-vetted alternatives.
**Recommended fix**: re-run consolidation for the disputed phases against a stricter rule: do not drop a fix surface unless the replacement closes the same sink and is more feasible.

## Cross-cutting observations

- The consolidation is anchored too much on the audit's narrative symmetry ("same threat surface", "shared wrapper", "couple for one review cycle") and not enough on actual implementation boundaries. That is how Phase 5 ends up coupled around a fix surface the code cannot currently express.
- The plan repeatedly counts happy-path regression pins as stronger than they are. The weak spots here are silent failures: response-path leaks, multi-tab/session cardinality, iframe broadcast behavior, and UI misclassification that does not throw.
- The strongest drafts were better whenever they stayed concrete about the exact sink. The consolidated plan gets weaker when it abstracts upward into "one PR per theme" instead of preserving sink-level closure.

## What the plan got right

- Rejecting a single cross-cutting `TrustGate<T>` abstraction is correct. The research is right that F-003/F-005, F-006, and F-012 live in different layers (`implementations-plan/security-audit-remediation/research/trust-recheck-primitive.md:41-48`).
- F-007 is correctly scoped as a small mirrored fix with an existing template. That should stay a cheap early win.
- The fail-closed direction for missing stored sessions is correct. Even if the teardown model changes, `packages/wallet-bridge/src/dispatcher.ts:735-736` should not stay permissive.
- Re-running `/harden security max` after the implementation phases is the right closeout discipline.
- Showing the full origin, not just hostname, is the right direction for F-009; the current `useDappHostname` reduction is genuinely lossy.

## Specific challenges to the decision ledger

1. **Decision 1 — OK but with a caveat**: keeping F-005 out of Phase 1 is defensible, but only if Phase 1 still fully closes F-003 and F-004. The consolidated plan does not.
2. **Decision 2 — OK but with a major caveat**: coupling F-001 and F-002 is reasonable, but the chosen implementation is not. The issue is not whether one PR is fine; it is that the frame-targeting half is infeasible on the current transport.
3. **Decision 3 — OK but with a caveat**: coupling F-011 and F-012 is fine only if the F-011 boundary guard and the full F-012 sink set stay in scope. The consolidated plan narrows both.
4. **Decision 4 — OK but with a caveat**: separating F-008 and F-009 is acceptable only if Phase 7 sanitizes every new render path immediately and Phase 8 still sweeps the remaining inline execute surfaces.
5. **Decision 5 — Agree with caveat**: F-006 deserves its own phase, but the current single-session-id modeling is too hand-wavy for approval.
6. **Decision 6 — Agree**: three separate primitives across three layers is the right abstraction boundary.
7. **Decision 7 — Disagree**: per-dispatch memoization is underdesigned at plan stage. There is no concrete shared dispatch context yet spanning all the proposed F-012 sinks. Get correctness and coverage right first; optimize latency after the enforcement shape is settled.
8. **Decision 8 — Disagree**: a single `walletSdkSessionId` field does not model one stored `DappSession` to many live `ActiveSession`s, and it conflicts with the plan's later frame-scoped direction.
