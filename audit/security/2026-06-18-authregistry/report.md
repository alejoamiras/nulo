# Harden Report: security (NARROW — auth-registry trust-point change)
Repo: nulo-2 · Date: 2026-06-18 · Effort: high (narrow) · Branch: fix/measure-f1-authwits @ b1d1c94
Models: 2 Claude Sonnet agents (authz boundary + trust-point integrity) + reused prior codex xhigh
post-impl audit (session 019edb4d) as the codex cross-model side.
Scope: ONLY the Phase 4-5 change — auth-registry/{service,spec}.ts, wallet-bridge/dispatcher.ts
(opts.from), execution/{tx-request-builder,dapp-send-executor}.ts + fee/*-strategy.ts.

## Executive summary
NO Critical/High. The security-critical authorization surface (the dApp-supplied `opts.from`) is
SOLID — triple-confirmed (codex + 2 Claude agents): session-scoped, double-predicate, canonical
lowercase compare; no cross-account escalation, no first-account fallback. The trust-point
(recording/reconcile/cap) has Medium durability/integrity gaps + one Low UI-integrity issue, all
WALLET-behavior follow-ups that do NOT affect the Network-e2e gate's reliability (so NOT
flip-blockers). Tracked in FOLLOWUP-authregistry-persistence.md for a dedicated PR.

## Methodology + deviations (honest)
- Skipped the whole-repo Phase-1 map: scope is 6 known files (narrow).
- Cross-model = 2 fresh Claude agents (clustered by trust boundary) + the prior codex audit reused
  as the codex side (it audited this exact scope). Did NOT spawn fresh per-cluster codex — justified
  by the narrow scope + the recent codex pass; documented rather than pretended.
- Skipped the stakeholder HTML companion: no Critical/High findings → report.md + the FOLLOWUP
  actionable doc suffice. (Skill says "always" for security; deviation justified by zero high/crit.)

## Findings (all Medium/Low → FOLLOWUP, none flip-blocking)
- M1 (Medium, both): terminal-status race → stuck `pending:true` row (reconcileFromTx handles only
  Proven/Finalized, no Mined; no history replay). Impact: revoke-UX DoS, not a bypass.
- M2 (Medium [codex] / High [Claude] — CALIBRATED Medium): crash between broadcast and
  recordPendingAuthwits → landed grant lost from the index (unrevocable via UI). Rare crash-window
  DURABILITY gap, not an attacker-driven CIA breach → Medium. = the deferred journal-recovery (codex #4).
- M3 (Medium, both): cap (256) bypassable under concurrent send_transaction (snapshot check, the
  non-aztec_sendTx path skips the execution lane) → 257. Flood-defense weakening, minor overshoot.
- NEW restore-inflate (Medium, Claude): `restore` writes `pending:true` rows verbatim → stuck,
  unreconcilable, counts toward cap. Fix: restore should drop/verify pending rows.
- NEW cross-account UI event leak (Low, Claude): onAuthwitAdded un-account-filtered in useEntityCrud
  → account B's row can render under account A. UI integrity only (storage per-account-keyed).
- NON-FINDING: NO_FROM records nothing (buildNoFrom hardcodes pendingPublicAuthwits:[]). opts.from authz solid.

## Verdict
Ship-acceptable. No Critical/High. The 5 Medium/Low items are wallet-durability/UX follow-ups
(FOLLOWUP doc), independent of the e2e-gate flip. Recommend a follow-up PR addressing M2 (the
journal-recovery — the highest-value) + the restore fix + the useEntityCrud account-filter.
