# Planning brief — execution-decomposition arc

Input document for the three independent planners (main / codex / fable). Not the plan.

## Task

Decompose the extension's execution service per the 2026-06-11 quality audit (run `audit/quality/2026-06-11-ultra-50b45d`). In-scope findings, in priority order:

- **Q5** — four journaled send pipelines (`executeTransfer`, `executeSendTransaction`, `executeAztecSendTx`, `executeNoFromSendTx`) duplicate the prove→submit→record→journal lifecycle tail; `execution-coordinator.ts` documents a `proveAndSend` that was never built.
- **Q4** — `execution/service.ts` (2,302 lines) embeds whole subsystems: estimate-reuse cache (+fingerprints), gas-balance cache (+single-flight), controller registry, mutex wiring; none unit-testable in isolation.
- **Q18** — positional tuple returns (`StandardTxRequestResult` 7-tuple etc.) consumed via `built[N]` / `_`-placeholder destructuring; transfer-request data clumps across ~8 signatures.
- **Q17** — contract-resolver extraction incomplete: artifact function-lookup re-inlined ×7, PXE ensure-registered loop ×4.
- **Q23** — claim/cancel lifecycle (claim-helper, activeControllers, JobCancelledSentinel, journal FSM) relies on cross-file temporal coupling with order-sensitive steps.

Authoritative finding detail + instance lists: `audit/quality/2026-06-11-ultra-50b45d/findings/verified.md` (READ Q4, Q5, Q17, Q18, Q23 AND the **Refactoring constraints registry** at the end — those 19 constraints are HARD scope limits; several relate directly to this arc: byte-parity upstream mirrors (`completeFeeOptions`, fetch wrapper), the fpc-strategy two-pass mutation ban, estimate-fingerprint contract, execution-mutex no-timeout invariant, journal FSM legal-transition table, wire-format pins).
Cluster-level evidence: `audit/quality/2026-06-11-ultra-50b45d/raw/c1-*.md`.

## Clarifying answers (user-fixed; do not relitigate)

1. **Scope**: full arc Q5+Q4+Q18+Q17+Q23.
2. **Done =** (these become /goal conditions): (a) ONE extracted pipeline tail with all four send paths as callers; (b) `execution/service.ts` ≤ ~1,200 lines with estimate-reuse + gas-balance caches in their own unit-tested modules; (c) ZERO behavior change, proven by the network e2e suite per phase — pre-existing quirks preserved verbatim (house bug-pin rule, CLAUDE.md); (d) every extracted module ships colocated tests in the same checkpoint.
3. **Delivery**: stacked checkpoints — each phase builds on the previous branch state ("virtual checkpoints", reviewable individually), but the arc lands as ONE final PR to dev that gets an RC build + manual QA before merge. Plan must keep every checkpoint independently revertable within the stack.
4. **Gates per phase**: `bun run lint` + `bun run test` + network e2e (`bun run e2e:agent`, parallel-safe) + a codex parity review of extracted-vs-original code. End of arc: `/code-review max --fix` → codex post-impl audit → RC build + manual QA. Post-arc `/harden` re-run: not scheduled (decision recorded; constraints registry + per-phase parity reviews are the substitute).

## House rules that bind this plan

- CLAUDE.md comment policy (no milestone vocabulary; the arc may clean banned `[PR 8c]`-style comments ONLY in regions it already touches).
- Bug-pin rule: surprising preserved behavior gets a `(BUG PIN)` test.
- `noExplicitAny` enforced; `bun run audit:vue` is the pre-PR gate; conventional commits; squash-merge to dev.
- Composables/services conventions per CLAUDE.md; biome layer rules.
- Tests: smallest set that proves behavior + failure modes; colocated.

## Required plan sections (every draft)

Phases (each with: goal, files, gate, revert story) · Assumptions (Facts with file:line / Inferences / Asks) · Security & Adversarial Considerations (this is the signing/proving/fee path — what could a refactor regression cost? what do the e2e + parity gates NOT cover?) · Test strategy · Rollback story per checkpoint · Effort estimates.
