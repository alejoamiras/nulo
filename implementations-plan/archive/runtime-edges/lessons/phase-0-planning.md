# Phase 0 — planning (light tier: single codex audit)

## Codex round 1 — APPROVE-WITH-CHANGES ×5, all adopted (session logged in scratchpad b9-codex-out.log)

Codex read the installed Aztec 5.0.1 source and corrected the plan on facts:

1. **Mined receipts have NO error field** (`SUCCESS | REVERTED` only) — my "classify at the REVERTED mapping" idea was unimplementable; only send-time rejections and dropped receipts carry the validator text `Existing nullifier`. The seam is `execution-coordinator.ts:139-147`. **Lesson: pick the classification seam by reading what data each observation point actually carries — the audit's own recipe ("typed duplicate-nullifier error") is seam-agnostic and the obvious seam had no data.**
2. **Error text alone is unsafe**: any double-spend yields `Existing nullifier`; classifying without provenance converts a note collision into a false "account initialized elsewhere". The wrap decision exists at exactly one place (`nulo-account.ts:170-175`) and was being DISCARDED — thread `initializesAccount` through the built-tx context and gate on it. **Lesson: a typed error that upgrades UX must be at least as precise as the generic one it replaces — provenance-gate any string-match classification.**
3. Taxonomy spelled out end-to-end (journal kind + humanization, WalletError registration in BOTH messaging + sdk envelope, task copy that is user-actionable — "retry without re-initializing" was not something a user controls).
4. N-21's bare constant-relationship pin was shallow — pin the consumer's `timeoutMs` through a mocked WindowManager too.
5. **My N-28 "unhandled rejection" premise was factually wrong** — `Promise.all` installs handlers on every input, so late sibling rejections are handled TODAY; the planned process-spy pin would have been vacuous (possibly green pre-fix). Replaced with the settle-before-throw pin (start() pending until every sibling settles → AggregateError naming all rejections). **Lesson: before pinning "no unhandled rejection", verify the mechanism can produce one — Promise.all's handler installation is easy to forget.**

Ratifications: the N-15 no-cross-check call (recon's trap held), the 7-min derived budget, the N-28 listener-gating scope cut (with the no-rollback limit documented in code), solo network e2e required.
