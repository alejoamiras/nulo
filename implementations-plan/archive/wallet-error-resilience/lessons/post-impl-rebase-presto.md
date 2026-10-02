# Post-implementation — rebase onto the presto prove path (pre-merge)

The presto migration (#600–#604) merged to `dev` after this plan was approved, restructuring the same
PXE prove-path files arc 1 touches. Before merging the stack, it was rebased onto post-#605 `dev`
(`9fc2f27d`). New tips: arc 1 `8f111949`, arc 2 `ccc1c35c`.

## Conflicts resolved (4)
- `implementations-plan/index.md` (×2, once per branch) — kept all three plan entries; the
  wallet-error-resilience entry updated to "rebased onto presto + #605, merging".
- `packages/aztec-runtime/src/pxe/chain-runtime.ts` — import block: kept presto's
  `PrestoProver`/`PrestoPhase` + `ProveBackend` and arc 1's `PxeStoreKeyMissingError`; dropped the
  removed `AcceleratorProver` import. The store-key throw site was untouched by presto (applied clean).
- `packages/aztec-runtime/src/pxe/service.ts` — the one real merge, at `proveTx`. Presto sets
  `runtime.activeProve = { proveId, seq: 0 }` before the call and clears it in `finally` (its phase
  observer attributes every prove phase to `proveId`); arc 1 wraps the call in
  `retryOnceOnStaleAnchor`. Resolution nests the retry INSIDE presto's try/finally, keeping the same
  `proveId`/`seq` across a retry. The other three wrap sites (simulateTx/executeUtility/profileTx)
  and `execution/service.ts` (the #605 overlap) auto-merged.

## Validation (post-rebase, exit 0)
`typecheck:all`; aztec-runtime 246 passed / 2 skipped (presto's prove-phase tests + our stale-anchor
tests coexist); `test:all` (extension 501 files, tools 102, all packages); `lint` (complexity-baseline
undisturbed).

## Codex — rebased arc-1 integration, session `01a0aa3f-72fb-73f3-bee7-8b403fcb762d`
**Verdict, quoted:** "**No new HIGH/MED correctness or security findings in `9fc2f27d..8f111949`.
Confidence: high from static inspection.**"

Key clearance of the flagged interaction: the recognized stale-anchor failures occur during
synchronization/execution/kernel preparation — BEFORE Presto's `createChonkProof` emits phases — so a
resync-and-retry cannot follow a partial phase sequence and corrupt backend attribution or Settings'
denial display. `activeProve` is cleared on success, failed resync, and failed retry alike. Keeping
the same `proveId` with increasing `seq` is correct — resetting `seq` would make the receiver discard
retry events. Store-key recovery remains origin-trusted; no dangling accelerator references; the other
three wrappers preserve their options/setup. No fix recommended.
