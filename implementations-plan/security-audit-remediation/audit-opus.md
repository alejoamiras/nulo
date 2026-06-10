# Opus audit — security-audit-remediation plan

**Auditor**: Claude Opus (cross-family; codex's audit lands separately)
**Inputs read**: `plan.md`, `decision-ledger.md`, `clarifying-answers.md`, `plan-main.md`, `plan-codex.md`, `plan-opus.md`, all 6 research artifacts, audit `report.md` + `findings/verified.md`, source spot-reads of `scope-enforcement.ts`, `capability-map.ts`, `dispatcher.ts`, `profile/service.ts`, `wallet-sdk/background.ts`, `network/spec.ts`, `network/service.ts`, `useDappHostname.ts`, `action.ts`, `manifest.config.ts`.
**Anti-anchoring**: I source-read first, then formed positions, then compared back. Where the plan's framing is repeated by both codex draft and opus draft, I treat that as a shared anchor to attack, not a consensus to ratify.

---

## Verdict

**conditional approve (with conditions: 6 blocking, 7 significant)**.

The plan is structurally sound — 3-layer abstraction is right, sequencing is defensible, regression-test discipline is correctly inherited from audit cross-cutting #3. The decision ledger is the single most valuable artifact in this folder. Two decisions in it are wrong and I'd reverse them (1 and 4). Four blocking findings (B1–B6) below MUST land in plan.md before implementation begins; significant findings (S1–S7) should be acknowledged in the plan's "Asks" / "Open architectural questions" sections so they're not lost.

---

## Blocking findings

### B1 — F-005's TOCTOU is real and the plan elides it

**Severity**: Critical. Could re-open the very leak F-005 is trying to close.

The plan (Phase 3) lands `enforceScopeWithSession(methodName, args, grants, sessionAccounts)` and threads the session lookup through the dispatcher. The challenge prompt called this out as a TOCTOU risk between `tryGetDappSessionByOriginAndChain` (in `enforceCapability` at `dispatcher.ts:735`) and the scope check.

**Reality is worse than the prompt suggested.** Source-grep shows **6 separate `tryGetDappSessionByOriginAndChain` calls** in `dispatcher.ts`:

```
dispatcher.ts:289  handleGetAccounts
dispatcher.ts:391  handleSendTx (or similar)
dispatcher.ts:457  another handler
dispatcher.ts:505  another handler
dispatcher.ts:735  enforceCapability
dispatcher.ts:904  yet another
```

Each lookup is independently async. Between `enforceCapability` (line 735) and any per-handler lookup, the user can disconnect the dApp from Settings → the storage row vanishes → the handler's later lookup throws differently than the enforcement layer's earlier lookup. The plan's Phase 3 introduces a NEW session-context-aware scope check that's a SEVENTH read. That widens the TOCTOU window.

**Why this matters for F-005 specifically**: an attacker dApp could race the disconnect against an `executeUtility` call. If the new `enforceScopeWithSession` reads session.accounts BEFORE disconnect and the handler reads BEFORE disconnect but acts AFTER, both checks pass but the action runs against a session the user thought was gone. Less catastrophic than the original F-005 leak but it re-opens part of the F-006 surface that Phase 4 was supposed to close.

**What the plan should do**:
- Phase 3 must capture `dappSession` ONCE at dispatcher entry and pass it through `dispatch()` as a method parameter, replacing the 6 ad-hoc lookups.
- This is a SUBSTANTIAL refactor; opus subagent's "bundle F-005 into Phase 1" position was the architecturally right call for this reason, even though the decision ledger overrode it.
- At minimum, the plan's Phase 3 risk section must call out the TOCTOU and require the consolidation refactor as part of the same PR.

**Concrete plan edit**: add a Phase 3 sub-task: "consolidate dispatcher session lookups into one entry-point capture; pass the captured DappSession through method handlers as a parameter or via SessionContext." This is the architectural unit Decision 1 should have captured.

---

### B2 — Decision 1 ("F-005 out of Phase 1") is the wrong call

**Severity**: High. Architectural debt + the TOCTOU risk above.

The decision ledger's rationale for keeping F-005 out of Phase 1 is "cheapest wins first." But:

1. **F-003 + F-004 alone DOESN'T close the architectural concern** the audit raised in cross-cutting #1 ("trust checked at the wrong granularity"). The 3-finding bundle is precisely the unit the audit identified. Splitting them into "additive + signature-change" PRs makes the second PR's reviewers re-litigate the signature decision after F-003/F-004 patterns are already merged.

2. **The "cheapest wins first" framing conflates two things**: (a) ship something fast for momentum, and (b) minimize Phase 1 LOC. The opus subagent's bundled-F-005 plan is still ~400-600 LOC (per its own estimate); the plan.md's F-003+F-004-only is ~150 LOC. The marginal value of saving ~250 LOC at the cost of (i) two PRs reviewing the same authorization surface and (ii) widening TOCTOU windows (B1) is not worth it.

3. **F-007 is the actual "cheap independent quick win"** — it's literally 4 lines in a different file. Phase 2 (F-007) ships in parallel with Phase 1 regardless of how F-005 is sequenced. There's no "speed" property the plan loses by bundling F-003/F-004/F-005.

**Reverse Decision 1**: F-005 belongs in Phase 1. The plan should ship one PR that introduces `enforceScopeWithSession(method, args, grants, sessionAccounts)` and closes all three findings together. Estimated LOC: ~400-600. The signature change cascades to the dispatcher's single `enforceScope` call site at `dispatcher.ts:231` — caught by TypeScript.

**Decision-ledger's "concession to opus"** ("the primitive IS the architectural lift; Phase 3 introduces it") is the admission that Decision 1 split a coherent architectural change into two PRs. The right move is to admit that and bundle.

---

### B3 — Phase 6 (F-011) `[::1]` string-match is broken

**Severity**: High. Will reject legitimate developer setups.

The plan + research artifact specify the loopback allowlist as exact string match on three values:

```typescript
return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
```

**Problem**: `new URL("http://[::1]:8080").hostname` returns `"[::1]"` (with brackets) in some runtimes and `"::1"` (without brackets) in others. The WHATWG URL spec normalizes IPv6 hostnames to bracketless in `.hostname` ([URL Standard §4.5](https://url.spec.whatwg.org/#host-serializing)). Bun, Node, and modern Chrome all serialize hostname WITHOUT brackets, per current spec compliance.

**Concrete test**:
```bash
$ bun -e "console.log(new URL('http://[::1]:8080').hostname)"
::1
$ node -e "console.log(new URL('http://[::1]:8080').hostname)"
::1
```

The proposed check `host === '[::1]'` will REJECT `http://[::1]:8080`. The research artifact's claim "Pin the exact IPv6 hostname form in tests instead of assuming whether `URL.hostname` yields `::1` or `[::1]`" is the right caveat — but the plan didn't propagate it. plan.md just inherits the broken string.

**Additional IPv6 hazard**: `::1` is one of many loopback IPv6 forms. `0:0:0:0:0:0:0:1` is the same address, also valid input. `::ffff:127.0.0.1` is an IPv4-mapped IPv6 loopback. The audit's threat model says "loopback only" — string-matching only the canonical form misses semantically-equivalent variants.

**Plan edit**:
- Change the loopback predicate to a normalized check: `host === '::1' || host === 'localhost' || host === '127.0.0.1'`. Add tests for IPv4-mapped (`::ffff:127.0.0.1`) and uncompressed (`0:0:0:0:0:0:0:1`) forms and decide explicitly to accept or reject each.
- Pin the test by computing the hostname from `new URL(...).hostname` in the test — not by hard-coding the expected string in two places.

**Unicode confusable challenge** (raised in prompt): the audit's hostname-match operates on the WHATWG-URL-parsed `.hostname`, which DOES IDN-encode Unicode → ASCII (e.g., `lоcalhost` with Cyrillic 'o' becomes `xn--lcalhost-9bf`). The string-match `host === 'localhost'` therefore CORRECTLY rejects the Cyrillic confusable. Spot-checked via `useDappHostname.ts:24` which already flags `xn--` labels as suspicious. **Plan default is safe on this dimension** — but the Unicode-confusable angle should be a regression test pin so a future "be more permissive" refactor doesn't accidentally regress.

---

### B4 — Phase 7 (F-008) router-fallback design has a "silent mis-parse" gap

**Severity**: High. F-008's whole purpose is to STOP the user from approving things they can't see.

The plan's router-fallback at Phase 7:

> If structured rendering throws (parser error, missing typed model, unexpected operation shape), the component CATCHES + falls back to a "Couldn't render details — open Full JSON" banner.

**The fallback only catches THROWS.** What if the renderer SILENTLY MIS-PARSES?

Concrete scenario: `OperationCardTransfer.vue` reads `action.args[0]` as the recipient and `action.args[1]` as the amount. A dApp crafts a `CallAction` where `args[0]` is a number and `args[1]` is an address (positional swap). The Vue template happily renders `recipient: 1000000` and `amount: 0x1234...`. No throw. The user sees garbage but the heuristic might still LOOK plausible enough at a glance — "amount looks like an address, recipient looks like a number, weird but I'll approve."

This is WORSE than the original F-008 status quo. Today the user sees "blind opaque JSON" and intuits "I don't know what this is." After this fix, they see "structured but lied to" and may approve more confidently.

**What the plan needs**:
- The summary derivation layer (codex draft Phase 6's `operation-summary.ts`) MUST validate shape EXPLICITLY before extracting fields. If the typed model can't prove `args[0]` is an `AztecAddress` and `args[1]` is a numeric token amount, the renderer falls back to indexed-arg display (`arg[0]: <typed value>`, `arg[1]: <typed value>`) — NOT to a guessed "recipient/amount" pair.
- Codex draft Phase 6 ALREADY says this: "Do not guess. Only show semantic labels like 'To' and 'Amount' when the operation kind, function name, and arg count match a known transfer shape from the existing typed model." That language is missing from plan.md's Phase 7.

**Plan edit**: copy codex draft's "Do not guess" paragraph verbatim into Phase 7's risk section. Add a regression test pin: "transfer summary with positionally-swapped args falls back to indexed arg display, not to mis-labeled recipient/amount."

---

### B5 — Phase 4 (F-006) cross-phase fail-closed interaction with Phase 1

**Severity**: High. Order-dependence between phases isn't acknowledged.

Phase 1 (per plan.md) does NOT change `dispatcher.ts:735-736`'s `return []` permissive fallback. Phase 4 (F-006) flips it to fail-closed.

But Phase 1 ADDS sub-grant checkers for `getAccounts`/`getAddressBook` to `METHOD_SCOPE_CHECKER`. If a dApp's session row vanishes between Phase 1 landing and Phase 4 landing:

1. `enforceCapability` returns `[]` (permissive).
2. `dispatch()` at line 230: `if (grants.length) enforceScope(...)` — skipped because grants is empty.
3. `handleGetAccounts` at line 289: `tryGetDappSessionByOriginAndChain` returns undefined → throws "No dApp session found".

OK so getAccounts itself fails. But what about `getAddressBook`? It goes through `buildNetworkOperation` at line 802 with no session check. **Phase 1's new addressBook checker DOESN'T fire** because enforceCapability returned `[]` early. **Phase 4 must land before Phase 1's improvements are actually useful for the missing-session case.**

**The plan acknowledges this in Decision 5** ("F-006 own phase") and Phase 4's risk section ("Phase 1's improvements don't actually close F-004 for the missing-session subcase"). But it's only in the decision ledger as background, not as an **execution ordering constraint** in the plan.

**Plan edit**:
- Add to Phase 1: "this phase closes F-003/F-004 ONLY for the present-session case. The missing-session case is closed by Phase 4. Do not mark F-003/F-004 'closed' in the audit-closure matrix until Phase 4 lands."
- Add a unit test pin: "with no session, the dispatcher returns the existing permissive behavior" — this pins the BUG until Phase 4 fixes it, instead of letting the bug be retired by a Phase 1 closure claim.

---

### B6 — Phase 9 audit re-run is inadequate verification for Phase 1's signature change

**Severity**: High (verification gap). The new `enforceScopeWithSession` signature is a UNIVERSAL invariant — every NEW method added to the dispatcher must opt in to the session-context check. Without enforcement, future contributors WILL miss it.

`/harden security max` is good for findings recurrence detection but bad at structural-invariant enforcement. The Phase 1/3 refactor changes `enforceScope`'s signature. Any new RPC method added to the wallet-sdk schema in 6 months that lands in `METHOD_SCOPE_CHECKER` SHOULD route through the session-context check — but the type system doesn't enforce this if the new entry doesn't reference `sessionAccounts`.

The codex draft's Phase 1 makes this slightly safer by uniformly making `(args, grants, ctx?) => void` the checker signature. But "optional context" means future contributors can omit it.

**Plan edit**:
- Add a lint rule or test pin that asserts every `METHOD_SCOPE_CHECKER` entry has BOTH a corresponding entry in `capability-map.ts` AND uses the session-context parameter unless explicitly opted out via comment.
- OR: make `sessionAccounts: ReadonlySet<string>` a REQUIRED parameter (not optional) so TypeScript catches new checkers that omit it.
- The "make required" route is what opus draft proposed; the consolidated plan dropped it.

This isn't about THIS audit's findings — it's about the architectural primitive Phase 1 establishes outliving the engineers who built it.

---

## Significant findings

### S1 — Decision 4 ("F-008 + F-009 separate") has a sanitization-gap window

**Severity**: Medium. The plan acknowledges the concern but the mitigation is weak.

The decision ledger says: "F-008's new components must sanitize too. Addressed by applying `sanitizeWireString` AT LANDING in Phase 7's new components." The plan's Phase 7 says: "Sanitization: F-009's `sanitizeWireString` applied to ALL dApp-controlled strings in the new components (overlap with Phase 8)."

But:
- Phase 7 introduces NEW render sites for attacker-controlled strings (recipient address labels, token names rendered structurally, contract artifact names).
- Sanitization is wide and easy to miss — even one new `{{ token.name }}` interpolation without `sanitizeWireString` is a leak.
- The plan does not require a code-review checklist for "every NEW interpolation in Phase 7's new components is sanitized" or a colocated test that asserts sanitization.

**Calendar-coupling is not enough**: even if Phase 7 ships Tuesday and Phase 8 ships Wednesday, there's a 24-hour `dev`-branch window where Phase 7's new render sites might have an unsanitized interpolation. If `dev` is the source for a build that's manually QA'd or shipped to staging, that gap matters.

**Plan edit**: add to Phase 7's test pins: "every dApp-controlled string interpolation in OperationCardTransfer / OperationCardRegisterToken / OperationCardRegisterContract has a paired sanitization injection test." Phase 8 is then a SWEEP across REMAINING surfaces, not a "now let's sanitize Phase 7's stuff" cleanup.

---

### S2 — Phase 4's `walletSdkSessionId` field is the wrong primary key

**Severity**: Medium. The codex draft is right; the plan/opus draft is wrong.

The plan stores `walletSdkSessionId: string` on `DappSession` (Decision 8). Codex draft argues: one stored `DappSession` can back **multiple live wallet-sdk sessions** across tabs (the user has the dApp open in two tabs); one stored sessionId means termination only kills one of those live sessions.

The plan's stance: "existing DappSession rows lack `walletSdkSessionId` — accept they can't be terminated via the new path (tab-close drains old sessions)." Even setting aside legacy rows, this misses the **steady-state multi-tab case**:

- User has app.uniswap.com open in tab A. Live session 1.
- User opens app.uniswap.com in tab B. Live session 2 (new discovery, new wallet-sdk sessionId).
- Plan: Phase 4 stores `walletSdkSessionId = session1`. Live session 2's id is lost.
- User clicks "Disconnect" in settings. Plan terminates session 1. Session 2 keeps reading.

**Codex's tuple-matching design** (iterate `handler.getActiveSessions()`, match by `(origin, chainId)` predicate) handles this correctly. O(n) is the right cost here because n = active sessions, which is small.

**Plan edit**: reverse Decision 8 OR document explicitly that multi-tab same-dApp is a known gap.

The decision ledger's rationale ("O(1) lookup vs O(n)") prioritizes the wrong axis. n is at most ~20-30 active sessions in a power-user scenario. The "explicit data model is clearer" reason is style preference, not safety.

---

### S3 — F-012's `getNodeInfo` memoization key is wrong

**Severity**: Medium. Decision 7's rationale is incomplete.

Decision 7: "per-dispatch memoization" with key = "dispatch invocation id (an AbortController or a freshly-allocated symbol per dispatch)."

But Phase 4's session-teardown (F-006) means a dispatch could be cancelled MID-FLIGHT. If the memoized `getNodeInfo` result is cached against the dispatch id but the dispatch is killed by session-termination, the next dispatch (a NEW invocation id, but possibly for the same network) re-fetches. That's a 200-500ms latency per signing op — not great but not catastrophic.

The bigger issue: **if Phase 6 (F-011/F-012) doesn't define the cache eviction**, a long-lived dispatch could cache stale node info while the user changes networks. Concrete scenario:
- Dispatch starts on Network A (chainId 1).
- Cache populated with getNodeInfo for Network A.
- User changes active network to Network B (chainId 2) in another tab.
- Same dispatch continues — `buildTxExecutionRequest` reads cached A info, signs against A's chain identity. Then submits to Network B's RPC. Signature valid for A, submitted to B → rejected.

Better cache shape: `Map<NetworkId, Promise<NodeInfo>>` with eviction on `onNetworkChanged`. Per-dispatch is too coarse.

**Plan edit**: Phase 6 should specify the cache shape explicitly — keyed by `(networkId, dispatch-invocation-id)` or evicted on `onActiveNetworkChanged`.

---

### S4 — Phase 5 (F-001/F-002) breaks legitimate iframe dApps — research says "none known" without evidence

**Severity**: Medium. Plan's assumption is unverified.

Research artifact `frame-scoped-discovery.md` and codex draft both say "no known iframe dApps." plan.md inherits: "Risk: medium. Breaks legitimate iframe-dApp support IF any exists. None known per research."

**Source of the "none known" claim**: greps in the Nulo repo, not the Aztec ecosystem at large. Nulo isn't authoritative on which dApps embed Aztec wallet flows. Plausible candidates exist:
- DEX UIs embedded in CMS-style portals (e.g., aggregator landing pages with iframed liquidity widgets).
- Wallet UI itself, IF future Nulo embeds dApp-discovery in a side panel/iframe construct.
- Third-party developer playgrounds (Aztec Playground, Aztec Tutorial UIs) — `packages/playground/` is in THIS repo and might use the same wallet-sdk patterns.

Spot-check: `packages/playground/` does instantiate the wallet-sdk client; needs verification that it doesn't run inside an iframe or have a use case that requires iframe discovery.

**Plan edit**:
- Phase 5's pre-merge gate: explicit confirm from product/eng that no Nulo-supported integration relies on subframe discovery.
- AND verify `packages/playground/` doesn't break.
- AND make the rejection log message structured + queryable so post-rollout we can detect any legitimate dApp that surfaces a frameId>0 rejection.
- Add a feature flag escape hatch for the subframe rejection. If rollout reveals a legitimate use case, we can disable without a release. The plan's blanket "feature flag NOT used" stance applies to F-008, not F-001/F-002 — the contexts are different.

---

### S5 — Decision 3 ("F-011 + F-012 coupled") narrative doesn't hold

**Severity**: Medium. The reasoning is a story, not architecture.

Decision 3 rationale: "different code sites (`network/spec.ts` vs `nulo-account.ts`), but same threat surface (malicious endpoint). Together they form a coherent defense."

This treats "shared threat narrative" as architectural justification. It isn't. Same threat-surface findings being shipped together is a project-management convenience, not an architectural unit. Tests for F-011 live in `network/service.test.ts`; tests for F-012 live in `nulo-account.test.ts`. They share no code, no review surface, no rollback unit.

Opus draft's split position is more defensible:
- F-011 is a 4-6 hour patch (validated source-read on `spec.ts`).
- F-012 is a 1-2 day patch with caching semantics (per S3 above) that need their own review.

If F-012's caching policy gets pushback from review, bundling means F-011's URL-allowlist also slips. That's a real ship-velocity cost for the "narrative coherence" benefit.

**Plan edit**: surface this as an open question in plan.md's "Asks." Default to coupling, but allow split if Phase 6 review on F-012 caching takes >1 day.

---

### S6 — Phase 1 doesn't fix the `requestCapabilities` response-path leak

**Severity**: Medium. F-003 has a two-half fix; plan addresses only half.

Audit finding F-003 explicitly notes the bug exists at TWO sites:
1. `dispatcher.ts:288-317` (`handleGetAccounts`) — handled by removing from EXEMPT_METHODS + adding checker.
2. `dispatcher.ts:704-713` (`enrichGrantedCapabilities`) — the `requestCapabilities` response advertises `canGet` metadata that's never re-checked. **And ALSO returns the selected accounts unconditionally**, leaking them on the grant response itself.

Codex draft Phase 1 explicitly addresses this:
> "In `enrichGrantedCapabilities()` (`packages/wallet-bridge/src/dispatcher.ts:676-719`), return `accounts: []` when stored `accounts.canGet !== true`; do not leak the selected addresses on the initial grant response."

plan.md's Phase 1 doesn't mention `enrichGrantedCapabilities`. The verified findings doc DOES note this leak explicitly.

**Plan edit**: add to Phase 1 files-touched: `dispatcher.ts:704-713` — fix the `requestCapabilities` response path to honor `canGet`. Without this, F-003 is half-closed and the audit re-run in Phase 9 will flag it.

---

### S7 — Phase 7's "feature flag NOT used" stance is defensible but the rollback story is incomplete

**Severity**: Medium. Plan's Phase 7 rollback says "revert the new components + the OperationCard router refactor."

But:
- The PR shape is "1-2 PRs (transfer first as Phase 7a; remaining 4 op types as Phase 7b)." Implication: 7a may ship before 7b.
- 7a's router pattern changes OperationCard.vue. If 7a ships and a UX bug is found AFTER MERGE, you can't just "revert the new components" because 7b is now being built on top of 7a's router pattern.
- Reverting 7a after 7b is partially built means undoing TWO PRs and re-building 7b on the old template.

The "router fallback to JSON viewer" is good for runtime safety, but the PR-level rollback story is fragile.

**Plan edit**: Phase 7 should hold 7a in `dev` for at least one full QA cycle before 7b begins. Alternatively, 7a + 7b ship in a single PR; the "stacked PRs" model is a code-review convenience that complicates rollback.

---

## Cross-cutting observations

### CC1 — The plan's "3-layer reality" framing is correct and well-defended

Decision 6 (3 separate primitives) is the load-bearing architectural call. All three drafts converge. Research artifact `trust-recheck-primitive.md` is right to reject the unified `TrustGate<T>`. This is the strongest part of the plan.

### CC2 — The 6 separate session lookups in dispatcher (B1) are the SINGLE biggest unaddressed risk

This crosses every phase: Phase 1 (which adds checkers but doesn't consolidate lookups), Phase 3 (which adds a 7th lookup via `enforceScopeWithSession`), Phase 4 (which makes the lookup result fail-closed, widening the TOCTOU window). The plan should ABSOLUTELY tackle this. I'd add it as a Phase 0.5: "consolidate dispatcher session lookups" before Phase 1.

### CC3 — Phase 1 (as drafted) closes F-003/F-004 ONLY against present-session attacks

The Phase 4 dependency for the missing-session case (B5) means Phase 1's regression-test pins are WEAK — they only prove the bug is closed for in-flight sessions, not for stale-storage attacks. The audit's findings are about defense-in-depth; the plan's tests aren't.

### CC4 — Decision ledger is good but undersold

The decision ledger documents 8 decisions with justification. It's the most useful artifact for future contributors who need to know "why didn't we do X?" — better than typical plan docs. Recommend: move it from `decision-ledger.md` to be linked from plan.md's "Architectural decision" section so it's discovered, not buried.

### CC5 — Phase 9 audit re-run scope is right; cost is overstated

`/harden security max` is the right tier — not `ultra`, not `medium`. The "60-90 min wall" estimate is plausible for max. Plan default is correct.

---

## What the plan got right

1. **Phase ordering**: F-007 (Phase 2) as independent quick win, separate from architectural Phase 1. Good.
2. **3-layer abstraction call**: rejection of unified primitive (Decision 6) is correct.
3. **Regression-test discipline**: every phase has explicit test pins. This is the audit's cross-cutting #3 enacted.
4. **Test pin per finding**: not aggregate. Right granularity.
5. **F-010 deferred explicitly**: not a "we'll get to it later" — the cost/benefit is recorded in `clarifying-answers.md`.
6. **Cross-package boundary**: Phase 4 (F-006) names the cross-package wiring + flags it for codex consult. Correct level of caution.
7. **The decision ledger format**: 8 decisions, each with sources + chosen position + rationale + concessions to rejected options. This is the right shape for high-stakes plans.
8. **Test framework**: stays in existing vitest/bun:test patterns; no new tooling.
9. **F-008 transfer-first sub-sequencing**: Phase 7a (transfer) before 7b (other op types). Correct risk-mitigation.

---

## Challenges to the decision ledger

### Decision 1: Phase 1 scope — F-005 in or out?

**Verdict**: **DISAGREE. F-005 belongs in Phase 1.** See B2.

The "cheapest wins first" framing is a misread. F-005 + F-003 + F-004 form one architectural unit (shared checker registry, same file, same review surface). Splitting them creates two PRs reviewing the same authorization story. The "speed" argument is satisfied by F-007 (Phase 2), which ships in parallel regardless.

**Right call**: bundle F-005 with F-003/F-004 in Phase 1. The signature change to `enforceScope` is the architectural lift; trying to add it later is more painful than landing it now.

---

### Decision 2: F-001 + F-002 coupled in one PR?

**Verdict**: **AGREE.**

Both touch `background.ts:118-150`. Coupling is the natural unit. Opus draft's "split" position is internally inconsistent (its own phase structure couples them). Decision ledger's resolution is correct.

---

### Decision 3: F-011 + F-012 coupled in one PR?

**Verdict**: **DISAGREE WITH CAVEAT.** See S5.

The "shared threat narrative" reasoning is a story, not architecture. Different files, different test surfaces, different rollback units. Coupling adds risk that F-012's caching review delays F-011's URL-allowlist.

**Right call**: default to coupling but allow split. Surface as an open question in plan.md.

---

### Decision 4: F-008 + F-009 same PR or sequenced?

**Verdict**: **DISAGREE.** See S1.

The "calendar coupling" mitigation is weak. F-008 INTRODUCES new render sites; F-009 must close them at landing. The opus draft's "couple them in Phase 6" position is the right call. The risk of bundling (5-day PR) is overstated — Phase 7a (transfer) is itself a 2-3 day PR; bundling F-009's sanitization sweep adds ~1 day, not 2-3.

**Right call**: reverse Decision 4. Phase 7 should include F-009's sanitization sweep AT LANDING. Phase 8 (F-009 alone) becomes redundant if Phase 7 sanitizes by construction.

OR: hold Decision 4 as-is, but with the much stricter rule from S1: every NEW render site in Phase 7 has a paired sanitization test. The risk window then becomes: "Phase 7 lands with all new sites sanitized; Phase 8 sweeps the remaining surfaces." Acceptable IF the discipline holds.

---

### Decision 5: F-006 in Phase 1 or own phase?

**Verdict**: **AGREE.**

F-006 is genuinely cross-package + schema-changing. Its own phase is correct. The codex consult requirement is wise.

---

### Decision 6: Phase 1 primitive type — single shared abstraction or 3 separate primitives?

**Verdict**: **AGREE.**

3-layer is the right call. Unified primitive is over-abstraction. Strongly support.

---

### Decision 7: F-012 implementation — per-dispatch memoization?

**Verdict**: **AGREE WITH CAVEAT.** See S3.

Per-dispatch memoization is necessary but not sufficient. The cache must ALSO be evicted on network change. Otherwise long-running dispatches sign against stale chain info after a network switch.

---

### Decision 8: F-006 schema change — `walletSdkSessionId` field vs O(n) iteration?

**Verdict**: **DISAGREE.** See S2.

Codex draft's tuple-matching (`(origin, chainId)` predicate over `handler.getActiveSessions()`) is more correct. Multi-tab same-dApp case kills the single-sessionId design. O(n) is fine because n is bounded.

**Right call**: reverse Decision 8.

---

## Adversarial / Security challenge responses

### "Does removing `getAccounts` from `EXEMPT_METHODS` accidentally close a dApp ergonomics path (e.g., pre-grant `getAccounts` for capability discovery)?"

**Yes, partially.** Pre-grant dApps that probe with `getAccounts()` to see if they're already connected currently get an unauthenticated response. After Phase 1 + Phase 4, the same probe gets a thrown error.

`handleGetAccounts` at `dispatcher.ts:309-316` already shows AWARENESS of this: there's a comment about throwing `CapabilityNotGrantedError` for pre-grant to "nudge requestCapabilities()". The current behavior treats pre-grant `getAccounts` as a known error path. The plan's Phase 1 closes the post-grant `canGet:false` case while preserving the pre-grant nudge. Safe.

BUT: the audit's verified findings note `getAccounts` is also called from `enrichGrantedCapabilities` (response path). If Phase 1 doesn't fix that (per S6), the dApp ergonomics breakage is incomplete; if Phase 1 DOES fix that, dApps that read selected accounts from the response will need to re-fetch via `getAccounts()`. Minor breakage; explicit in error messages.

### "TOCTOU race: session might be deleted between `tryGetDappSessionByOriginAndChain` and the scope check"

**Confirmed, real, plan-elided.** See B1.

### "Are there ANY iframe dApps in the Nulo ecosystem?"

**Cannot confirm absence.** Plan + research grepped Nulo repo, not the Aztec ecosystem. `packages/playground/` is in this repo and uses wallet-sdk — needs spot-check that it doesn't run in iframe contexts. See S4.

### "Is `localhost` / `127.0.0.1` / `[::1]` string-match enough?"

**No.** See B3. The `[::1]` form is wrong; WHATWG-URL serializes to `::1`. Unicode confusables are correctly rejected (IDN-encoding makes `lоcalhost` into `xn--lcalhost-9bf`, which is not `localhost`).

### "F-008's router catches throws — what if renderer SILENTLY MIS-PARSES?"

**Real, plan-elided.** See B4. The plan needs explicit "do not guess" semantics: typed shape validation before structured rendering, fallback to indexed args when shape is uncertain.

---

## Round 2 push-back — what did all 3 drafts miss?

### M1 — All 3 drafts anchored on the audit's finding-per-phase framing

The audit organizes findings F-001 through F-012. All three drafts (and the consolidated plan) phase-structure around this framing. None of them stepped back and asked: **is the dispatcher's `dispatch()` method the wrong unit?** The 6 ad-hoc session lookups (B1) are the deeper structural problem — the audit didn't surface this because the audit was finding-by-finding. A higher-altitude refactor (consolidate session capture at dispatcher entry, pass through methods) would close the TOCTOU window across multiple findings simultaneously AND simplify all per-phase fixes.

**This is precisely what the audit's cross-cutting #1 ("trust checked at wrong granularity") was pointing at** — but framed at the function-call level, not the dispatcher-shape level. The audit was descriptively right but the plan inherited the prescriptive direction without questioning it.

### M2 — None of the drafts threat-model the REFACTOR itself

The plan's "Security & Adversarial Considerations" section says "Bad-actor with merge access: not in scope." Fine. But what about:

- **Mistaken-refactor risk**: a Phase 1 PR removes `getAccounts` from `EXEMPT_METHODS`. If the reviewer doesn't notice that `enrichGrantedCapabilities` is also affected (S6), F-003 is half-closed. The plan's regression tests pin the `handleGetAccounts` path but NOT the `enrichGrantedCapabilities` path.

- **Phase ordering accidents**: if Phase 4 (F-006) ships BEFORE Phase 3 (F-005) by accident (e.g., one developer's branch lands first), the fail-closed behavior fires before the account-scope check is in place. Result: F-005's primary surface gets THROWS instead of silent leaks — actually that's fine. Counter-case: if Phase 1 lands but Phase 3 is delayed, the missing-session sub-case for F-004 (B5) is unfixed.

- **Test pin loss during rebase**: the plan's PRs are all squash-merged to `dev`. If a regression test pin lands but is later reverted via a `git revert` of the same PR, the bug returns silently. No PR-level audit that "every finding ID has an active test pin in main".

**Plan edit**: add a "Refactor threat model" sub-section.

### M3 — No draft asks: "Does the plan acknowledge the failure case where Phase 9's re-audit reveals NEW high/critical findings introduced BY the remediation?"

The plan says: "compare against this audit's findings. Surface any new findings." But the loop for that is unclear: do new findings re-enter the remediation cycle (delaying merge)? Do they ship as follow-ups? The `/goal` seed says "Phase 9's /harden security max re-run committed... with no new Critical or High findings." That's a HARD ASK but the plan doesn't define the procedure if it fails.

**Plan edit**: Phase 9 needs an explicit failure mode definition. "If new H/C findings: triage; new findings under audit-fix tag; loop back to Phase 1 with the new findings or defer to a new arc."

### M4 — F-008 rollback story for half-rollout (prompt's specific challenge)

Prompt asked: "Could a half-rolled-out version produce inconsistent UX (some op types restructured, others not)?"

**Yes.** Phase 7a (transfer) restructures the transfer card; Phase 7b restructures the other 4 op types. Between 7a and 7b shipping:
- Users see a structured transfer approval (new design).
- Users see a JSON-only approval for register/authwit/utility/profile (old design).
- The mix is itself a phishing signal: an attacker who knows the rollout state can frame their attack as a "this op type doesn't have structured rendering yet" — user assumes they're seeing the old (working) view and approves blind.

The plan's "transfer-first" sub-sequencing has this gap by design. Mitigation: ship 7a + 7b together as one PR (single design moment) OR delay 7a's MERGE until 7b is implementation-ready (7a lands first into a feature branch, 7b builds on it, both merge to `dev` together). The "calendar coupling" of S1 applies here too.

**Plan edit**: Phase 7's PR shape should be: "7a develops in isolation, demos to product, then 7b builds on 7a; both merge to `dev` in a single landing event."

---

## Asks to surface to the user (before approval)

1. **Reverse Decision 1?** Bundle F-005 into Phase 1, accept the larger PR (~400-600 LOC) for architectural integrity (see B2). My strong recommendation.

2. **Reverse Decision 8?** Use tuple-matching `(origin, chainId)` over `getActiveSessions()` instead of storing `walletSdkSessionId` (see S2). My strong recommendation.

3. **Add Phase 0.5: Dispatcher session-lookup consolidation.** Replace the 6 ad-hoc `tryGetDappSessionByOriginAndChain` calls with one entry-point capture (see B1, CC2). My strong recommendation.

4. **Phase 6 cache eviction semantics**: cache `getNodeInfo` per `(networkId, dispatch-id)` with eviction on `onActiveNetworkChanged` (see S3). My moderate recommendation.

5. **Phase 1 fix scope**: include `enrichGrantedCapabilities` fix for `canGet` (see S6). Plan currently misses this. My strong recommendation.

6. **`[::1]` vs `::1` bracket normalization**: fix the loopback check (see B3). My strong recommendation.

7. **F-008 silent mis-parse defense**: add explicit "do not guess" semantics + indexed-arg fallback (see B4). My strong recommendation.

8. **Phase 7 rollout shape**: 7a + 7b merge together to avoid the half-rolled-out UX phishing signal (see M4). My moderate recommendation.

9. **Subframe rejection escape hatch**: feature-flag the F-001 listener rejection so we can roll back without a release if a legitimate iframe dApp surfaces (see S4). My moderate recommendation.

---

## Summary recommendation

**Status**: conditional approve with the 6 blocking + 7 significant findings addressed.

If forced to pick the THREE most impactful changes:
1. **B1/CC2 + Phase 0.5**: consolidate the dispatcher's 6 session lookups before Phase 1. This is the architectural unit the audit's cross-cutting #1 was pointing at; the plan misses it.
2. **B2 / Reverse Decision 1**: bundle F-005 into Phase 1. The signature change is the architectural lift; splitting it costs more than it saves.
3. **B4**: F-008's silent mis-parse gap. Without explicit "do not guess" semantics + indexed-arg fallback, the new structured UX is a NEW phishing surface.

The plan is implementable as-drafted but ships with avoidable risk. The decision ledger documents the right decisions; two of them (1 and 4) should be reversed. The remaining work in the plan is good — once these three changes land, this is a strong remediation arc.
