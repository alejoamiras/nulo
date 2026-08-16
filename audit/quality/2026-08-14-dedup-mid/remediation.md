# Remediation record — quality audit 2026-08-14-dedup-mid

Full remediation of findings Q-01..Q-15 from [`report.md`](./report.md), executed as 8 sequential codex-converged PRs into `dev` (2026-08-12 → 2026-08-16). Every arc: blueprint (light/mid per finding risk) → codex xhigh design consult → implement → repo gates → one codex xhigh pass over the complete arc diff → converged → squash-merge. The verified findings ([`findings/verified/`](./findings/verified/)) were treated as authoritative over [`findings/consolidated.md`](./findings/consolidated.md) throughout.

## Finding → PR map

| Finding | Title (short) | Arc | PR | Status |
|---|---|---|---|---|
| Q-01 | 68 hand-rolled lock frames (14 files) | 2 dedup-withlock | #375 | ✅ remediated — `Lock.withLock()` + hardened never-reject `enter()` (deviation D2 below) |
| Q-02 | bridge script bootstrap ×10 files | 4 dedup-bridge-conductors | #377 | ✅ remediated — split client factories + `loadManifestFromConfigArg` |
| Q-03 | fee-estimation duplicate state machine | 8 dedup-fee-estimation | #381 | ✅ remediated — private state-sink engine; both composables thin adapters; 51 pins green on both impls |
| Q-04 | PXE promise-cache ×6 | 3 dedup-pxe-memo | #376 | ✅ remediated — `memoizeAsync`/`memoizeAsyncBy` |
| Q-05 | passthrough exhaustiveness (16/23 clients) | 1 dedup-messaging-primitives | #374 | ✅ remediated — curried `definePassthroughsExhaustive<M>()` |
| Q-06 | clipboard copy ritual ×22 modules | 7 dedup-clipboard | #380 | ✅ remediated — `copyToClipboard` + `useSecretClipboardCopy`; false-toast fix propagated (authorized behavior change per goal) |
| Q-07 | service-client timeout/failure shaping | 1 dedup-messaging-primitives | #374 | ✅ remediated — Template Method hooks |
| Q-08 | identity strip triplication | 6 dedup-ui-structure | #379 | ✅ remediated — `IdentityStrip` composite, testids verbatim |
| Q-09 | address trimming ×7 call sites | 6 dedup-ui-structure | #379 | ✅ remediated — `trimAddress(address, start, end, separator)`; each site keeps its current rendered output (deviation D3 + scope-out S1 below) |
| Q-10 | canonical private-FPC deploy duplication | 4 dedup-bridge-conductors | #377 | ✅ remediated — existence-check-first `deployCanonicalPrivateFpc` |
| Q-11 | error-identity ritual ×13 files | 1 dedup-messaging-primitives | #374 | ✅ remediated — super-name-param + `new.target.prototype` |
| Q-12 | CTA typography duplication | 5 dedup-design | #378 | ✅ remediated — shared comma-joined CTA rule |
| Q-13 | dispatcher network/account resolution | 4 dedup-bridge-conductors | #377 | ✅ remediated — `resolveNetworkAndAccount` reuse (stricter helper errors adopted, authorized per goal) |
| Q-14 | typed-error subclass boilerplate | 1 dedup-messaging-primitives | #374 | ✅ remediated (TooManyPendingError sweep impossible — BUG PIN + 10-code round-trip; see F1 below) |
| Q-15 | tooltip cross-axis geometry | 5 dedup-design | #378 | ✅ remediated — `crossAxisOffset` with old fall-through 0 default |

Arc 0 (#373) committed this audit directory itself.

## Documented deviations (codex-agreed)

- **D2 (Q-01, #375)** — `Lock.enter()` hardened to never reject (tryLog + guarded setTimeout; "resolved ⇒ ownership transferred" invariant). Error-path-only behavior change: the old code could reject a waiter on a pathological queue state; the audit agreed rejection parity was not worth preserving. Ledgered in `implementations-plan/dedup-withlock/plan.md`.
- **D3 (Q-09, #379)** — `trimAddress` renders ≤10-length (corrupted) inputs unchanged instead of the old garbled overlapping-slice duplication. Six unguarded callers affected only for inputs that are already invalid addresses. Codex-agreed boundary; the old output was a bug artifact, not a design.
- **S1 (Q-09 scope-out)** — ReceivePopup's distinct address rendering was scoped OUT of the unification (owner-locked visual surface); it keeps its bespoke formatting. The 4-style separator unification across the remaining sites is an owner follow-up (below), not unilateral.

## Residual gaps surfaced during remediation (owner follow-ups)

1. **Q-09 separator unification** — sites deliberately keep 4 distinct rendered styles; unifying is an owner visual decision.
2. **Design letter-spacing lead** — recurring near-identical letter-spacing tokens noticed in the design arc; candidate token extraction.
3. **`TOO_MANY_PENDING` reconstruction gap** — the wire round-trip cannot reconstruct the subclass (BUG PIN in #374); needs a protocol-level decision.
4. **`ArtifactRegistry.clear()`** — doc claims `onProfileDeleted` wiring that does not exist (dead claim found in arc 3 recon).
5. **Fee-juice canary live-manifest fallback** — retained in #377 pending an explicit removal decision.
6. **Provenance-based sanitization candidates** — IncomingTrustPopup's wire-derived contract address and TokenMetadataPopup's `token.contract` copy unsanitized wire-derived values (arc 7 survey); candidates for `sanitize: true`.
7. **`sw-resilience.test.ts` smoke flake** — 3 identical CI-only 5000ms timeouts across #374/#376/#377 (passes locally); deflake arc recommended.
8. **Stale `deflake-round-4` worktree** — still registered in the workspace manifest; reap.
