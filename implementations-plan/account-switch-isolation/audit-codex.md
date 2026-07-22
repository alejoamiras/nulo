reject (with blocking findings: Phase 1 is not demonstrably privacy-complete, concurrency semantics are underspecified, and the structural/e2e proofs can pass without proving isolation)

### Contradiction

- The structural proof is invalid. Phase 3 removes only the ingest filter while permanently retaining `buildActivityRows` scope filtering. An A record incorrectly stored in B’s slice remains hidden, so the leak test stays green. Assert raw slice placement for every source, or bypass all presentation guards in a test-only proof. Keep the main draft’s metamorphic placement invariant.

- Phase 1 promises exact composite isolation, but transactions lack `profileId`/`networkId` until Phase 2; Phase 1 can only verify account+chain. It may close the stated same-network A→B bug, but not the broader profile/network invariant it claims.

- The TaskService fallback is ambiguous and potentially leaky. Current `Task`, `ExecuteOperationContent`, and `OperationRecord` have no exact shared correlation ID. Dropping only “orphan-card enrichment” is insufficient: A’s kind-only dApp task can still decorate B’s journal card. Until `taskId ↔ journalId` is atomically established, disable all uncorrelated TaskService cards and journal enrichment.

- “Fail-closed visibility” is ADOPTED in §6 but absent from Phase 1’s implementation steps and still presented as Ask A2. Likewise, Phase 2 already decides A3/A5, and the phase behavior decides A4, despite those remaining “Asks.”

- “All three planners converged” is false: the main draft explicitly preferred scoped guards as the final state and rejected a primary Map refactor.

### Security

- §2.2 does not safely handle deletes. If a delete arrives during a snapshot, event revision changes, but a “merge by stable ID” can resurrect the deleted row. Scope tombstones do not solve per-record deletion. Require per-record tombstones/sequence numbers or mandate a post-event authoritative resnapshot.

- Per-source revisions miss cross-source mutations. Example: an awaiting snapshot starts; `onTxAdded` removes its placeholder but increments only the transaction revision; the awaiting snapshot then restores it. Journal-terminal cleanup of awaiting/task/cancel state has the same problem. Every mutated source needs its revision advanced atomically.

- “Events win” is not causally sound: a delayed old event may arrive during a snapshot that already contains newer state. Define authoritative ordering using service sequence numbers or record versions; `updatedAt` is unavailable or unsuitable for every source.

- `record.accountAddress` is safe against a note sender because it is stamped from the scheduler’s captured scan parameter. The Fact claiming `owner` falls back to the active account is wrong—it falls back to captured `accountAddress`. Nevertheless, account membership must be revalidated inside the locked commit, not merely before PXE I/O.

- Zod schemas alone will not validate wire events: the messaging client currently invokes an allowed EventHandler without parsing its payload. The plan must specify service-side parameter validation, client result validation, and an event-dispatch validation override. Scan validation should also reject `renderError`, require the expected token note schema/storage location, and use scoped `(scope,nullifier)` identity; storage is currently keyed globally by nullifier.

### Assumptions

- I1 is overstated: not “ANY” incoming note leaks—outgoing/in-flight dedupe, visibility, hidden trust state, or prior idempotency can suppress it. A third-party trusted visible receive does leak persistently.

- I2’s conclusion is correct, but the listed mechanisms are insufficient without record tombstones, cross-source revisioning, and causal ordering.

- I3 is not presently true: `OperationRecord.taskId` does not exist. Queued dApp journals precede task creation, while transfer tasks precede journal creation; the binding protocol needs an explicit atomic design.

- I4 is false for the masking reason above.

- I5 is correct narrowly: CLAUDE.md explicitly says no numbered migrations pre-production. But Phase 2 must still update `TxSchema`, every producer, backup/restore fixtures, lookup keys, and legacy decode behavior. Adding fields alone does not fix the globally hash-keyed transaction repository.

- A1/A6 are genuine blockers, not gate-time details. Separate popup/side-panel Pinia stores do not synchronize `account` on storage changes. The network baseline is unverified: README says 46/66, while an incoming test’s “currently fails because no token is seeded” comment contradicts the code that now seeds one.

- The commands exist, but the gates do not prove what they claim: `test:components` filters `src/components`, excluding the named popup/composable tests; the race command omits `NULO_E2E_PROVERLESS=1`, so the poll gate is not built; and no listed local command performs the production negative grep.

- §7 arms the gate with the external mint hash before that mint supplies the hash. Define submit→capture hash→arm-before-mining/discovery explicitly. One emission also cannot live-event-test both Recent Activity and an unmounted History page; use separate runs.

### What looks right

- Composite scope, fail-closed ambiguous records, and scoping on `accountAddress` rather than `owner`.
- Keeping inactive-account polling.
- Guards-first staging and the Phase-1 off-ramp.
- Listener-before-snapshot, ABA request versions, retry-zero execution, mutation observation, and switch-back positive controls—once the missing semantics above are fixed.