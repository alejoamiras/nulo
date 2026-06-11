# Plan draft — main agent

Arc: execution-decomposition (audit Q5+Q4+Q18+Q17+Q23). Delivery: stacked checkpoints on one arc branch → single final PR to dev → RC + manual QA → squash-merge.

## Phase ordering argument

**Q18 (tuples→objects) goes FIRST**, not after Q5. Three reasons: (1) it's the lowest-regression-risk phase, so it doubles as the shakedown run for the per-phase gate machinery (e2e:agent + codex parity) before we touch anything scary; (2) every later phase churns the same call sites — converting `built[N]` indexing to named fields first makes every subsequent diff legible to reviewers; (3) the Q5 tail extraction wants a typed context object as its parameter — building that object IS the Q18 conversion, so doing Q5 first would mean extracting against tuples and re-churning a week later.

Q5 second (the keystone). Q4a/Q4b third/fourth (cache extractions — independent of each other, sequenced only to keep checkpoints small). Q17 fifth (mechanical once tails are unified). Q23 sixth (the riskiest semantics — claim/cancel — goes LAST so it benefits from every prior simplification and the most-exercised gate pipeline). Sweep seventh.

## Phases

### Phase 0 — Characterization safety net (0.5d)
Goal: pin current behavior where extraction will occur, beyond what e2e already covers.
- Verify the e2e journal-stage assertions (landed in commit `989e4be`) cover all four send paths; add missing path coverage if any.
- Unit characterization tests for the module-level free functions that will move: `fingerprintBaseFee`/`fingerprintFeeSettings` exact string format (constraint: estimate-reuse contract depends on byte-stable fingerprints), `getEstimatedFee`, `getGasDetails`, `pickActionMethod`.
- Record baseline: `wc -l service.ts` (2,302), the four tail sites' exact argument variations (scopes arrays, addTransaction args, journal-marking differences) documented in `lessons/phase-0.md` as the parity contract for Phase 2.
Gate: lint + test. No e2e needed (no behavior touched). Revert: trivial.

### Phase 1 — Q18: named result objects (1d)
Goal: kill positional consumption.
- `StandardTxRequestResult` 7-tuple + `NoFromTxRequestResult` 6-tuple (tx-request-builder.ts:69-70) → interfaces `BuiltStandardTx` / `BuiltNoFromTx` with named fields (`txRequest`, `node`, `pxe`, `account`, `network`, `nonce`, `txCalls`).
- Update all call sites (service.ts ×6+, fee/fee-juice-with-claim-strategy.ts, authwit-discoverer DiscoverContext already object-shaped). Kill every `built[N]` and `_`-placeholder destructure.
- Transfer-request data clump: introduce `TransferRequest` param object ONLY for internal signatures (the RPC wire shape in spec.ts is a published contract — do NOT change it; map at the RPC boundary).
Gate: lint + test + e2e:agent + codex parity (mechanical diff review). Revert: drop checkpoint commits.

### Phase 2 — Q5: `proveAndSend` on ExecutionCoordinator (2d)
Goal: ONE pipeline tail, four callers — the docblock's promise (execution-coordinator.ts:17-19) finally built.
- Extract the `proveTxTask → toTx → sendTxTask → addTransaction → markJournal(submitted)` sequence from service.ts:550-567, 1181-1190, 1976-1986, 2166-2176 into `coordinator.proveAndSend(ctx)`.
- Variation becomes DATA, not branches: `ctx.scopes` (the four sites differ: `[account.address]` / `+sendAdditionalScopes` / `scopesWithAccount`), `ctx.buildTransactionRecord` callback, `ctx.markSubmitted` callback. No op-kind conditionals inside the coordinator.
- Bug-pin rule: any per-site quirk found during extraction (e.g. ordering differences between addTransaction and journal marking) is preserved verbatim per-site via the callbacks and pinned with a test if surprising.
Gate: full (lint + test + e2e:agent + codex parity against the Phase-0 parity contract). Revert: checkpoint drop; callers re-inline cleanly because Phase 1 already gave them named objects.

### Phase 3 — Q4a: estimate-reuse cache module (1d)
- `estimate-reuse-cache.ts`: the inline `TransferEstimateReuseEntry` type (service.ts:154-190), the cache map + TTL, `tryConsumeTransferEstimate` validation logic, and the fingerprint functions move out. Facade keeps a thin delegation.
- Colocated tests: TTL expiry, fingerprint mismatch (base fee drift), endpoint change, actions-hash mismatch, happy-path consume-once.
- CONSTRAINT: fingerprint string format byte-stable (Phase 0 characterization is the lock).
Gate: full. Revert: checkpoint drop.

### Phase 4 — Q4b: gas-balance cache module (1d)
- `gas-balance-cache.ts`: gasBalanceCache + gasBalanceInFlight single-flight + `#computeGasBalances` (service.ts:1504-1578) move out, with the invalidation subscriptions (transaction.onTransactionUpdated at :383, fpc events at :401-402) wired by the facade but targeting the module.
- Colocated tests: TTL, single-flight coalescing, invalidation per event, per-(profile,chain,account) keying.
Gate: full. Revert: checkpoint drop.

### Phase 5 — Q17: finish ContractResolver (1d)
- Artifact function-lookup (re-inlined ×7) → `resolver.getFunctionAbi(...)`; PXE ensure-registered loop (×4: service.ts, tx-request-builder.ts, batched-view-simulation.ts already has its own — leave; helpers) → `resolver.ensureRegistered(pxe, instances)`.
- Pure consolidation; resolver stays stateless.
Gate: full. Revert: checkpoint drop.

### Phase 6 — Q23: claim/cancel lifecycle encapsulation (1.5d)
- Introduce `withExecutionSlot(op, hooks, fn)` execute-around helper owning the order-sensitive sequence: acquireExecutionSlot → claimOrCreate → checkCancelled → fn → finally {controller cleanup + releaseSlot}. The four send paths + simulate path adopt it.
- CONSTRAINTS (registry): execution-mutex no-timeout/no-force-release invariant untouched; FIFO baton release point (onExecutionEnqueued) unchanged; JobCancelledSentinel never crosses RPC (rpc-cancel.ts stays the boundary); journal FSM legal transitions unchanged.
- This is the highest-semantic-risk phase — hence last, smallest diff per commit, parity review on the interleaving description, e2e concurrent-sendtx + cancel-mid-prove are the must-pass shards.
Gate: full + heavy e2e shards (concurrent-confirm, cancel paths). Revert: checkpoint drop.

### Phase 7 — Sweep + close (1d)
- Facade line check (target ≤1,200 — TARGET not hard-fail; if >1,200 remains, document why per remaining block).
- Milestone-comment cleanup ONLY in regions the arc touched (CLAUDE.md policy).
- Docs: execution README/file-map update; coordinator docblock now true.
- End-of-arc: `/code-review max --fix` (separate commits) → codex post-impl audit (net diff + code-review summary + plan + adversarial ask) → RC bump + build → manual QA script for the user (send public/private, dApp sendTx, cancel-mid-prove, fee methods) → final PR to dev.

Total: ~9 focused days.

## Assumptions

**Facts** (verified today against source):
- Coordinator has only the 3 task wrappers; `proveAndSend` promised but absent (execution-coordinator.ts:14-19, 43-100).
- Four tail sites: service.ts:550-567, 1181-1190, 1976-1986, 2166-2176; scopes arrays differ per site.
- Tuples at tx-request-builder.ts:69-70; facade = 2,302 lines (wc -l today).
- Free functions at service.ts:141-247; estimate-reuse type inline at :154-190; gas-balance block at :1504-1578 (audit-verified).
- e2e journal-stage assertions exist for sendTx paths (commit 989e4be); network e2e covers transfers/sendTx/concurrent/cancel in CI shards.
- No storage-schema surface in scope: the arc touches no EntityStorage shapes (execution has none — journal is operation-journal's).

**Inferences** (attack me here):
- The scopes-array variation is the only semantic difference between the four tails besides record/journal args. MUST be confirmed by Phase-0 characterization before Phase 2 extraction; if false, Phase 2 keeps per-site callbacks for the divergent steps.
- Gas-balance invalidation subscriptions can re-target the module without changing emission order (subscriber registration order in init() preserved).
- `audit:vue`'s unit run + e2e:agent are sufficient parity evidence; no golden-file harness needed beyond Phase-0 pins.

**Asks**: none open. (Done-conditions, delivery, gates all fixed in Phase 0 of blueprint.)

## Security & Adversarial Considerations

Threat model = refactor regression on the money path, not external attackers:
- **Wrong scopes in unified tail** → proving with broader scopes than the user approved (privacy regression) or narrower (tx failure). Mitigation: scopes stay per-call-site data (never computed inside coordinator); parity review explicitly diffs the four scope expressions; e2e multi-account-from + sendTx shards.
- **Journal/record reordering** → duplicate or stuck sends after SW restart (reaper interplay). Mitigation: callbacks preserve per-site order; journal-stage e2e assertions are the contract.
- **Fingerprint drift** → estimate-reuse accepting stale fees (user-visible fee error). Mitigation: Phase-0 byte-stability characterization.
- **Cancel-check displacement** → user cancels, op continues to prove/send (violates the 4001 contract codex pinned in the durable-jobs arc). Mitigation: Phase 6 last + heavy shards + parity review on interleavings.
- **What the gates do NOT cover**: fee drift within multiplier tolerance; native-vs-WASM proving parity beyond CI's enforced native; Firefox build behavior; long-horizon reaper interactions (>30min). Accepted residual; manual QA covers a SW-restart case.
- Supply chain/crypto: no new deps, no crypto-adjacent changes. Least privilege: no CI/permission changes.

## Test strategy
Phase-0 characterization pins (fingerprints, free fns, tail parity contract); per-extraction colocated tests (cache TTLs, single-flight, resolver lookups, execute-around interleavings via fake clock + aborted controllers); bug-pins for preserved quirks; e2e per phase; heavy shards for Phase 6. No new e2e files expected — existing suite already exercises all four paths (add only if Phase 0 finds a path gap).

## Rollback story
One arc branch; each phase = contiguous checkpoint commits + plan.md ✓ + lessons file. Revert = drop the checkpoint (no storage migrations anywhere in the arc — hard constraint; any phase needing one is out of scope). Final PR carries the whole stack; abandoning mid-arc still leaves dev untouched and each landed checkpoint shippable from the branch.
