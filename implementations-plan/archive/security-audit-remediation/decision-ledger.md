# Decision Ledger — security-audit-remediation

**Plan inputs**: 3 independent drafts (`plan-main.md`, `plan-codex.md`, `plan-opus.md`).
**Consolidator**: main agent.
**Audit revisions**: Round 1 codex + opus audits surfaced 5 blocking + 6 blocking findings respectively. Both audits explicitly recommended reversing Decisions 1 and 8. This ledger documents the reversals + audit citations.

## Decision 1: Phase 1 scope — F-005 in or out?

| Source | Position |
|---|---|
| plan-main | F-005 **out** of Phase 1; in Phase 3 with new `enforceScopeWithSession` overload |
| plan-codex | "Wire dependent findings into Phase 1 primitives" — F-005 essentially bundled |
| plan-opus | F-005 **in** Phase 1 alongside F-003 + F-004 — argues "the signature change IS the architectural lift" |
| Audit Round 1 (codex B-2 + opus B-2) | **REVERSED**: F-005 belongs in Phase 1. Bundling is the right call. |

**FINAL DECISION (after Round 1 audit)**: F-005 **IN** Phase 1 (reversed).

**Rationale**:
- The user's "cheapest wins first" preference is undermined if Phase 1 becomes a multi-day refactor.
- F-003 + F-004 are pure additive `METHOD_SCOPE_CHECKER` entries (no signature change). F-005 requires either a new overload OR threading session-context through `dispatcher.dispatch`. That's a non-trivial dispatcher refactor.
- Splitting maintains the "Phase 1 = hours, Phase 2 = hours" cadence early. Momentum matters for security remediation.
- The pattern from Phase 1 (per-method checker registry) carries forward to Phase 3 without code duplication. Phase 3 EXTENDS Phase 1's primitive; both PRs leverage the same shape.

**Concession to opus**: the *primitive* (`enforceScopeWithSession`) does count as an architectural lift. Phase 3 is correctly described in the plan as "introduces the session-context overload," not just "wires findings to existing primitives."

## Decision 2: F-001 + F-002 coupled in one PR?

| Source | Position |
|---|---|
| plan-main | **Couple** (one PR, both touch the same wrapper) |
| plan-codex | Couple |
| plan-opus | "F-001/F-002 NOT coupled" in summary, but Phase 7 has them in the same phase — internally inconsistent. Treating opus's PHASE STRUCTURE as their actual position: couple. |
| audit report | Couple ("fix together") |

**Chosen**: couple in one PR.

**Rationale**:
- Both fixes touch `wallet-sdk/background.ts:118-150` (the Nulo wrapper).
- Combined effort is ~2-3 days; review overhead of one larger PR is less than two PRs.
- Independent test pins (subframe rejection test + frame-targeted send-message test) — not coupled at the test level.
- Splitting creates a partial-defense window between the two PRs where one mitigation is in place but not the other.

## Decision 3: F-011 + F-012 coupled in one PR?

| Source | Position |
|---|---|
| plan-main | **Couple** (one PR, shared threat narrative) |
| plan-codex | F-011 alone (Phase 5); F-012 not explicitly addressed as separate phase |
| plan-opus | Split (F-011 in Phase 3, F-012 in Phase 5) |
| audit report | Couple ("fix together") |

**Chosen**: couple in one PR.

**Rationale**:
- Different code sites (`network/spec.ts` vs `nulo-account.ts`), but same threat surface (malicious endpoint).
- Together they form a coherent defense: scheme allowlist (F-011) prevents bad URLs from being saved; live-node rebind (F-012) prevents a previously-accepted endpoint from drifting its chain identity post-enrollment.
- Either alone leaves a gap: F-011 alone misses post-enrollment chain manipulation; F-012 alone allows arbitrary URLs to be saved (though they'd fail the rebind).
- One review cycle vs two; reviewer can validate the full RPC-trust narrative at once.

**Concession to opus**: independent test pins per fix. Each finding gets its own regression test even within the coupled PR.

## Decision 4: F-008 + F-009 same PR or sequenced?

| Source | Position |
|---|---|
| plan-main | **Separate phases** — F-008 (Phase 7) lands sanitization INSIDE its new components by default; F-009 (Phase 8) sweeps remaining surfaces |
| plan-codex | Separate (Phase 6 + Phase 7) |
| plan-opus | Coupled (Phase 6 combines both) |

**Chosen**: separate phases.

**Rationale**:
- F-008 is a UX redesign with NEW components (3 sub-components: TransferCard, RegisterTokenCard, RegisterContractCard). Risk surface is "did we get the typed-arg parsing right?"
- F-009 is a sanitization sweep across EXISTING components (DappIdentityBlock, IncomingTrustPopup, verify popup, etc.) and the WALLET-SDK persistence layer. Risk surface is "did we cover every surface?"
- Bundling produces a 5-day PR that's hard to review and risky to revert.
- The PRACTICAL coupling concern (F-008's new components must sanitize too) is addressed by applying `sanitizeWireString` AT LANDING in Phase 7's new components — not by combining phases. F-009 is then a sweep on the remaining surfaces.

**Concession to opus**: F-008 and F-009 land in close succession (Phase 7 → Phase 8); they should NOT be interleaved with other unrelated phases. Calendar-coupled, even if PR-decoupled.

## Decision 5: F-006 in Phase 1 or own phase?

| Source | Position |
|---|---|
| plan-main | **Own phase (Phase 4)** — cross-package wiring |
| plan-codex | Bundled into Phase 3 (dependent findings) |
| plan-opus | Own phase (Phase 4) |

**Chosen**: own phase.

**Rationale**:
- F-006 requires `DappSessionService` ↔ `wallet-sdk/background.ts` communication.
- Requires a schema change to `DappSession` (`walletSdkSessionId?: string` field).
- Requires forward-thinking about existing sessions (acceptance: tab-close drains old sessions, only new sessions get the new field — see plan.md "Assumptions → Asks").
- This is the highest-risk cross-package change in the plan; codex consult mandated before merge.
- Bundling with scope-enforcement (Phase 1 or Phase 3) muddles the review surface.

## Decision 6: Phase 1 primitive type — single shared abstraction or 3 separate primitives?

| Source | Position |
|---|---|
| plan-main | **3 separate** (scope-enforcement, session-lifetime, runtime chain validation) |
| plan-codex | 3 separate (acknowledges layers in research) |
| plan-opus | 3 separate ("explicitly reject a unifying `TrustGate<T>` as more abstract than helpful") |

**Chosen**: 3 separate primitives across 3 layers.

**Rationale**:
- All 3 drafts converge on this.
- Research artifact `trust-recheck-primitive.md` documents the 3-layer reality.
- A unifying primitive obscures the layer boundaries (scope-enforcement is pure / session-lifetime is async + cross-package / runtime chain validation is per-tx).
- Speculative generality risk per "Don't add abstractions beyond what the task requires."

## Decision 7: F-012 implementation — per-dispatch memoization?

| Source | Position |
|---|---|
| plan-main | Not explicitly addressed |
| plan-codex | Not explicitly addressed |
| plan-opus | **Cache `node.getNodeInfo()` per-dispatch** to bound latency cost |

**Chosen**: opus's position — per-dispatch memoization.

**Rationale**:
- Calling `getNodeInfo()` on every signing operation would add per-tx network round-trips.
- Per-dispatch caching: one `getNodeInfo()` per dispatcher.dispatch() invocation; both `buildTxExecutionRequest` and `getChainInfo` share the cached value if both run in the same dispatch.
- Cache key: dispatch invocation id (an `AbortController` or a freshly-allocated symbol per dispatch).
- Cache lifetime: tied to the dispatch promise.

## Decision 8: F-006 schema change — `walletSdkSessionId` field vs O(n) iteration?

| Source | Position |
|---|---|
| plan-main | **Schema field** (1a) over iteration (1b) |
| plan-opus (initial) | Schema field (1a) — same reasoning |
| Audit Round 1 (codex S-1 + opus B-something) | **REVERSED**: a single `walletSdkSessionId` field does NOT model one stored `DappSession` → many live `ActiveSession`s. Multi-tab same-dApp scenario breaks this. Use tuple matching `(origin, chainId)` over `handler.getActiveSessions()`. |

**FINAL DECISION (after Round 1 audit)**: **tuple matching** `(origin, chainId)` predicate over `handler.getActiveSessions()` (reversed). O(n) where n is bounded by tabs-with-dApp-loaded (typically <10) — no performance concern. Schema unchanged.

## Unresolved disputes (need user decision OR will resolve during audit rounds)

1. **F-001/F-002 upstream coordination timing**: plan defaults to filing upstream PR/issue in parallel with Phase 5. User may want to land Nulo-side first, then file upstream after confirming the gap. Surface in approval gate.

2. **F-008 router fallback specifics**: plan says "router fallback to JSON viewer if structured rendering throws." But: does the fallback show a WARNING banner or fail silent? Codex consult on this UX call before Phase 7 merge.

3. **Phase parallelism**: plans 1, 2, 5, 6 touch independent files. Could ship in parallel branches if multiple developers are working. Plan defaults to sequential for review-load reasons. User may override.

4. **Phase 9 audit scope**: `/harden security max` re-run is recommended. But `max` is still expensive. Could downgrade to `medium` or run only on the changed clusters. Plan defaults to `max`; user can downgrade in approval gate.
