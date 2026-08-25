# Phase 1 — implementation + review arc

## Max review — REQUEST-CHANGES ×5, all adopted (commit 527b08ce)

1. **MAJOR (empirically proven): the dApp-facing envelope branch was DEAD CODE.** I registered `DuplicateInitializationError` in `toWalletResponseError` — but the production chain flattens executor failures to `{ status: "failed", error: string }` (`classifyOperationCatch`) and the dispatcher re-materializes a bare `new Error(string)`, so the `instanceof` branch could never fire; and the error wasn't in `walletErrorFromPayload`'s switch, so class identity also died at genuine RPC hops. Fix (the reviewer's cancelled-status-precedent shape): `FailedOperationResult` gains `code?`, `classifyOperationCatch` stamps it for `WalletError`s, `unwrapOperationResult` re-materializes via `walletErrorFromPayload`, the payload union + switch gain the case, and a composition pin drives the three REAL functions end-to-end (probed red with the code ride-along stripped). **Lesson: registering an error type at the boundary is worthless without tracing the actual value path to that boundary — mine crossed two data-flattening hops; the reviewer found it by composing the real functions, which is exactly what the pin now does.**
2. AggregateError folded only NAMES into its message while the boot log prints message/stack only — and with retry vetoed for the SW lifetime, that log line is the entire post-mortem. Root-cause messages now folded in.
3. The regex's `duplicate (siloed )?nullifier` alternation: source-verified, the only SEND-time text it can match is "Duplicate nullifier in tx" — an intra-tx malformed-tx error, NO race — while the simulation texts it was written for never reach the send catch. Narrowed to `/existing nullifier/i`. **Lesson: when codex hands you candidate match strings ("optionally cover the simulation strings"), verify each string is REACHABLE at your chosen seam before matching it — an unreachable alternation's only effect is false positives.**
4. The transfer path threaded the flag but kept the `transfer` journal kind — same failure, two kinds. The instanceof→kind pick now applied at both catch sites.
5. My "relationship pin" was a tautology (`2T+60s > 2T`); deleted with a comment — the consumer pin (observing the value WindowManager receives) is the real discriminator, and the claimed "both pins red" probe result was half false (the reviewer re-probed).

Verified clean by the review: provenance threading complete (all four contexts, both reuse branches undefined, no stale-true path), the N-28 settle-before-throw semantics + all callers, no other 5-min assumptions, comment/TSDoc conventions.

## Codex plan-gate lessons already in phase-0; this phase's addendum

- The biome 2.5.9 line rejects unformatted code as ERRORS while the legacy warnings stay warnings — a `bun run lint` exit 1 with untouched-file warnings means MY files have a format error hiding among them; `grep "Formatter would have printed" -B6` finds it fast.
- Commit subjects near 100 chars: check `git log` after committing (the hook rejects silently, leaving files staged) — bitten twice this pipeline.
