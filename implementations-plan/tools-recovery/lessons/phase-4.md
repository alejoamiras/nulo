# Phase 4 — the deposit reconcile in the engine, the affordance, the copy, cells 26d/26e

Arc 2 (`tools-recovery/deposit-reconcile`), commits `f24bb67c` + `c0355dae`. Gate: the Phase 3
commands green again; `src/composables/useBridgeJournal src/lib/record-policy src/components/BridgeJournalCard`
(200 tests) green; typecheck (app + browser tests) exit 0; `bun run lint` exit 0;
`bun run e2e:tools -- specs/l1-wallet.spec.ts` on its own sandbox at retry 0: **26d passed (36 s)**,
26e failed once on a wrong testid (see below), re-run green — see the boundary section.

## What landed

- Engine: `findDepositTx` dep; `recoverLegIfNeeded` calls `reconcileDepositLeg` for a hash-less
  record — narrates "looking for the deposit on Ethereum", writes the found hash once through
  `patchRecordWhen` under the journal lock with `sameDepositSnapshot` (the claim snapshot + token,
  fuel amounts / secret hash, `createdAt`) and "no hash yet" as the guard; a hash another tab wrote
  meanwhile is used, never overwritten; then the existing receipt-based leg recovery runs on the live
  record. `none` / `ambiguous` / `incomplete` get their notes.
- `record-policy`: `depositLegRecoverable` also for a hash-less schema-3 record with a token block
  (gas-only and legacy keep Discard-only). Card: the "look for it on Ethereum" guidance
  (`depositGuidance`, split out of `stageLabel` for the complexity budget).
- `useSend.ts`: `findDepositTx` wired with the viem public client, `MANIFEST_CHAIN.l1ChainId` and the
  generation's router.
- L1 fixture: `swallowNext({ to })` — the transaction is broadcast for real, the page's promise parks.
  Cell 26d flipped to that shape (reload → CLAIM finds the deposit → claim lands → done, nothing sent
  twice); cell 26e keeps the never-answered wallet (CLAIM finds nothing → the note → Discard).
- Engine tests: found / none / ambiguous / incomplete / throw / discarded / other-tab hash kept /
  identity moved / gas-only + legacy bail. Policy and card pins.

## Lessons

- **An attention's note is rendered by the rail, not the card's `journalAttention` line.** With an
  attention set, `BridgeJournalCard`'s `note` computed yields null and `BridgePhaseRail` shows the
  note under `TESTIDS.journalStep` (`compactDetail`). Cell 26e first asserted on `journalAttention`
  and timed out with the attention correctly set; recovery cell 24c already read the rail. Assert
  attention notes on `journalStep`.
- The sandbox's build happens at boot from the working tree: editing sources while a run boots
  changes what it tests. Wait for "running playwright" before touching the tree.

## Cells

- `l1-wallet.spec.ts` full file at `f24bb67c`: 26d ✓ (36.0 s), 26 ×3 ✓, 26e ✘ (the testid); 26e alone at
  `c0355dae`: ✓ (30.8 s). The spec is re-run in full inside the arc-2 shards.
