# Phase 0 — Clarifying answers

**Plan**: security-audit-remediation
**Date**: 2026-06-08
**Tier**: mega-deep (user invoked `ultra`; skill aliases to heaviest available = `mega-deep`)
**Inputs**:
- `audit/security/2026-06-08-ultra-e6759a/report.md`
- `audit/security/2026-06-08-ultra-e6759a/report.html`
- `audit/security/2026-06-08-ultra-e6759a/findings/consolidated.md`
- `audit/security/2026-06-08-ultra-e6759a/findings/verified.md`

## Scope

Implement **11 of 12 findings** from the 2026-06-08 security audit. **Skip F-010** (incoming-transfer persistence unbounded) — deferred as cost/benefit unfavorable for this round.

### Findings in scope

| ID | Severity | One-liner | Audit effort |
|---|---|---|---|
| F-001 | High | Iframes credited as top-frame origin during discovery | days |
| F-002 | High | Tab-wide discovery replies → sibling-frame hijack | days |
| F-003 | High | `accounts.canGet:false` decorative; addresses leak | **hours** |
| F-004 | Medium | `data.addressBook` sub-grant decorative; book leaks | **hours** |
| F-005 | High | dApps forward unvalidated account scope arrays to PXE | days |
| F-006 | High | Disconnect doesn't kill live wallet-sdk channel | days |
| F-007 | High | Passkey unlock skips credential→profile binding | **hours** |
| F-008 | High | Tx approval UI hides calldata args behind sub-link | days |
| F-009 | Medium | dApp/token display strings not Unicode-sanitized | days |
| F-011 | High | RPC URL validation accepts `javascript:`/`data:`/`file://` | days |
| F-012 | Medium | Live node chain identity not rebound to selected network | days |

Out of scope: F-010 (deferred).

## Sequencing decisions

- **Cheapest wins first** (user choice) — F-007 + F-003 + F-004 land as small PRs early.
- **Architectural refactor first** (user choice) — Phase 1 lands an architectural setup PR (extend `enforceScope` / introduce a "trust re-check" primitive) that creates the structural hooks the per-finding fixes wire into.
- These two choices RECONCILE as: Phase 1 = setup refactor; Phase 2 = F-007 (independent quick win, no refactor dependency); Phase 3 = F-003 + F-004 + F-005 + F-006 + F-012 using the new primitives.

Final phase order:

1. **Phase 1** — Architectural setup: sub-grant enforcement primitive + trust re-check pattern. Closes F-003, F-004 by construction; sets up F-005, F-006, F-012.
2. **Phase 2** — F-007 passkey unlock binding (independent, ~4-line patch, has verified test template).
3. **Phase 3** — F-005 (scope-array allow-list), F-006 (live-transport teardown on revoke), F-012 (live node chain rebind) — leverage Phase 1 primitives.
4. **Phase 4** — F-001 + F-002 coupled (frame-vs-tab trust scoping; partially blocked on upstream `@aztec/wallet-sdk` 4.2.0; ship Nulo-side defense-in-depth).
5. **Phase 5** — F-011 (RPC scheme allowlist with loopback escape hatch for dev).
6. **Phase 6** — F-008 broad scope: structured argument summaries on PRIMARY approval surface for all 5 popup-gated op types (transfer, registerToken, registerContract, createAuthWit, simulate/utility/profile). JSON viewer becomes fallback only.
7. **Phase 7** — F-009 Unicode sanitization sweep across dApp + token display surfaces.
8. **Phase 8** — `/harden security max` re-run to verify closure + catch any regressions introduced.

## F-008 UX scope (resolved via ASCII mockups, see chat)

**Broad** — all 5 popup-gated op types get structured argument summaries on the primary approval card. The proposed layout was reviewed via ASCII mockups before approval; user confirmed direction.

**Risk mitigations**:
- Parser MUST use the existing typed operation model in `wallet-bridge/operation.ts` — never hand-roll generic ABI decoding.
- Show 3-5 critical fields per op type; collapse the rest.
- JSON viewer stays as escape hatch (defense in depth).
- Transfer case lands first (highest impact, lowest risk to get right). Validate the UX direction before expanding.

## Quality bar

**Production.** Security-critical self-custody wallet. Every fix needs:
- Regression test pin (audit cross-cutting observation #3 explicitly called this out).
- Cross-package layer compliance (per `ARCHITECTURE.md` §2).
- No breaking changes to the dApp public RPC schema without explicit coordination.

## Post-implementation hardening

**`/harden security max` re-run after all 11 fixes land.** Cheaper than ultra (we have the prior baseline as comparison); ~60-90 min wall. Confirms the fixes close the identified findings AND catches any regressions introduced by the architectural refactor.

## Decisions to surface vs delegate

**Surfacing to user**:
- F-001/F-002 upstream coordination: Nulo-side defense-in-depth scope vs filing an upstream PR vs both. Plan agents recommend.
- F-011 loopback escape hatch: exact host patterns to allow (`127.0.0.1`, `localhost`, `[::1]`, custom dev hostnames?). Plan agents recommend.
- F-008 collapse threshold: above what arg count do we hide-by-default? Plan agents recommend.

**Delegated to plan agents** (no need to surface):
- Exact test framework + location per fix (existing vitest + colocated pattern).
- Per-finding commit shape (small + conventional, per project standards).
- Module-internal refactor details (e.g., exactly which helper functions in `wallet-bridge` get extracted).

## Cost expectation

Mega-deep is the heaviest planning ceremony available. Realistic agent count: ~25-30 subagent runs + ~5-10 codex sessions across research, parallel plans, contradiction check, audit Round 1, audit Round 2 (split), final fresh-context audit. Comparable scope to the `/harden security ultra` run that produced the audit.

Wall clock estimate: 2-4 hours for the full ceremony before implementation begins. The ELI5 + approval gate land at the end of this window; implementation is a separate `/loop` or `/goal` session.
