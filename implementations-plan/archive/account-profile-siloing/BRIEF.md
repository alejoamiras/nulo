# Planning brief — Account + Profile Siloing architecture (deep)

You are producing an INDEPENDENT, IMPLEMENTATION-DETAIL-HEAVY plan for a focused architectural arc in the
**Nulo** repo (Chrome-extension Aztec wallet; Vue 3 + TS; Bun; Vitest + Puppeteer e2e). Another planner
(codex) and the main agent draft the same task in parallel — commit to concrete design + defend it. The user
explicitly wants **exhaustive analysis, deep architecture discussion, and heavy bug-finding** — so be concrete
(name files, functions, data shapes, exact interleavings), and attack your own design.

## The arc (consolidates deferred Phase 1a + Phases 2–4 of `account-switch-isolation`)

**Goal:** make the active **composite scope `(profileId, networkId, chainId, accountAddress)`** GOVERN the
entire activity + execution path, so no cross-account/cross-profile state can ever render or bind — AND deliver
the **instant-from-cache** switch UX. Phase 1 (containment, merged #314, on `dev`) already closes the
same-network account-switch FEED leak; this arc generalizes it to profiles, makes it structural (slices), and
hardens the EXECUTION side.

### USER DECISIONS (binding — do not re-litigate)
1. **Mid-switch execution → ABORT + WARN.** If the active profile/account changes during an in-flight dApp send
   (after the execution fence is captured), ABORT the operation cleanly and surface a user-facing warning. Do
   NOT thread the captured scope through the whole mutex/tx-builder to keep executing under it — the user chose
   the simpler abort to avoid over-architecting. (Reference: the p1a branch `a6ed183` already implemented an
   abort-on-drift variant — read it, but this arc re-plans cleanly.)
2. **NO dApp-card re-enable.** Keep Phase 1's fail-closed state: the dApp `ExecuteOperation` in-progress
   "spinner" cards stay HIDDEN (dApp progress still renders via the durable journal cards). Removing the deep
   task↔journal correlation + publication machinery from scope drops the single biggest source of audit pain.
   (Final Ask at the gate, but plan as DROPPED.)
3. **Delivery: ONE big PR** for the whole arc (user chose this over staged).
4. **Validation: property-based tests for the durable protocol + a dedicated multi-PROFILE + multi-account
   network e2e + `/harden security` at the end** (all three).

### In scope
- **A. Captured-scope-governs-EXECUTION via abort-on-drift.** The execution fence captures the AUTHORIZED
  `(profileId, [account])` atomically; a builder/mutex chokepoint aborts the op if active drifts from captured,
  with a user warning. (Covers r4 fence-atomicity + r5 post-capture-drift.)
- **B. Durable causal protocol** (epoch + per-`(source,scope)` counter + atomic snapshot watermark +
  per-record tombstones), SPIKED as a pure module + PROPERTY-tested standalone before wiring. Governs which
  slice a record lands in and event/snapshot ordering (late result → its OWN scope's slice, never the active).
- **C. Per-`(profile,network,chain,account)` composite-scope SLICES** for the feed state (transactions,
  awaiting, journal, incoming). Active view = active slice → switch is an O(1) swap = **instant-from-cache**.
- **D. Profile-aware display + (any remaining) publication filters** — present-and-equal profile+network+account
  (lenient on undefined for legacy rows).
- **E. Queued-journal / claim correctness** — dispatcher-consistent account derivation; lock-serialized
  delete; composite claim guard; pending-residue cleanup (covers r1/r2/r3/r5 hazards).

### Out of scope (state explicitly)
- The dApp task↔journal correlation + the dApp-card re-enable (dropped, decision 2).
- Any change that would ship proverless or touch release/publish.

## HAZARD CATALOG — design AGAINST every one of these (from Phase 1 + the 5 codex audit rounds; full transcripts
in `research/audit-codex-p1a-r{1..5}.md`, `research/phase-1a.md`, `research/surface-map.md`)

- **H0 (Phase 1, shipped):** feed state was flat + keyed on "active-now"; broadcast events + async fetches from
  account A landed in B's view. Closed via sync-clear-on-switch + generation-guarded fetches + scope-filtered
  ingest + `flush:'sync'` watchers. THIS ARC must not regress it and should SUBSUME it structurally (slices).
- **H1 (r1):** `wallet-sdk/queued-journal.ts` derived the record account from `dapp.accounts[0]` — a session
  `[A,B]` send from B journaled under A. Must derive from the actual authorized `from`.
- **H2 (r2):** the NO_FROM default must match the DISPATCHER's rule exactly — `allAccounts.find(a =>
  sessionAddresses.has(a.address))` in INDEX-SORTED WALLET order (`dispatcher.ts:1349-1385`), NOT session-array
  order. Queued-create and dispatch reading it differently = mis-scope.
- **H3 (r3):** `operation-journal/service.ts` `deleteOperation` (and `setOperationMeta`) were NOT serialized by
  the `transitionLock` → a racing transition resurrected a just-deleted record. Any delete/supersede in a
  slice/claim path must be lock-serialized (or tombstoned) so no load-modify-write resurrects it.
- **H4 (r4):** the execution fence was not atomically bound to the interaction's AUTHORIZED profile —
  `executeAndResolve` checked profile, then `await refreshSession`, then `ExecutionService` re-captured
  active-now. `captureExecutionFence(expectedProfileId)` must verify active==authorized INSIDE the same
  `runExclusive` the profile switch takes (atomic).
- **H5 (r5a):** POST-CAPTURE DRIFT — even with an atomic fence, the mutex key (`execution-lane.ts:193`) and both
  tx builders (`tx-request-builder.ts:113`, NO_FROM `:382`) re-read ACTIVE-NOW; a switch mid-prove builds a P1
  account under a P2 journal. Abort-on-drift chokepoint required (decision 1).
- **H6 (r5b):** SILENT-ABORT RESIDUE — the silent path fast-forwards the record to `pending` before fence
  capture (`dapp-interaction/service.ts:334`); background failure cleanup handled only `queued`
  (`wallet-sdk/background.ts:687`). Abort must terminalize a `pending` residue too.
- **H7 (r5c):** DISPLAY FILTER `journalRecordInScope` (`RecentActivityView.vue`) ignored `profileId` → a P2
  record with a colliding account+network rendered under P1. Filters must be profile-aware (lenient on undefined
  legacy, present-and-equal otherwise).
- **H8 (concurrency, from the plan's own v3):** the durable protocol must handle: ABA + SW-restart (in-memory
  counters reset — need DURABLE epoch+counter), delete-during-snapshot (no resurrection), snapshot-vs-newer-event
  (watermark, no clobber), cross-source atomic revisioning, mnemonic re-import (SAME composite scope key → an
  epoch must distinguish incarnations). Siloed nullifiers are unique within ONE rollup tree, NOT across
  `networkId` trees — the incoming key must be `(scope, nullifier)`, not global.

## The architecture I (main) lean toward — attack it

- **One `activity.store.ts` coordinator** owning `Map<ActivityScopeKey, ActivitySlice>` where
  `ActivityScopeKey = profileId|networkId|chainId|accountAddress` and `ActivitySlice = { transactionsByHash,
  awaitingById, journalOpsById, incomingByNullifier, seqBySource, epoch, tombstones }`. UI reads a readonly
  `activeSlice`; switching = O(1) swap (instant-cache).
- Every producer (tx service, journal service, incoming service) routes its event to the slice for the record's
  OWN composite scope (never active-now). Late results land in their own slice, invisible unless that scope is
  active. This SUBSUMES Phase 1's guards (a foreign record structurally can't reach the active slice).
- Durable epoch+counter+watermark+tombstone reducer (§B) as a pure module, property-tested (ABA, SW-restart,
  delete-during-snapshot, re-import) BEFORE wiring — the plan's spike.
- Execution: `captureExecutionFence(expectedProfileId)` atomic; abort-on-drift at the tx-builder chokepoint
  (`requireActiveProfile` snapshot equality) + the mutex key on the captured profile; a user-facing warning on
  abort; `pending`-residue cleanup.
- Filters profile-aware; NO dApp task/card re-enable.

## Required plan shape (ALL sections)
- **Phases**, each ending in a concrete **Validation gate** (REAL commands: `bun run lint`, `bun run
  typecheck:all`, `bun run test`, `bun run --cwd apps/extension test src/<paths>`, `bun run test:e2e`,
  `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/<file>`). Early phase: the durable-
  protocol SPIKE (pure module + property tests) BEFORE any wiring. A phase for the multi-profile e2e harness.
- **Security & Adversarial Considerations** — the cross-profile/cross-account leak threat model; Aztec note
  provenance (owner is trusted NoteDao.owner — do NOT re-introduce the reverted owner-drop); the abort path as a
  DoS/UX surface; the execution trust boundary.
- **Assumptions** — Facts (file:line) / Inferences (labelled) / Asks (surface).
- **Decision ledger** + **trade-off analysis** (esp. abort-on-drift vs the rejected thread-captured-scope; slices
  vs guards-only; one-PR risk mitigation given it touches shared execution code).
- **A multi-profile/multi-account network-e2e design** that deterministically reproduces H5 (switch mid-dApp-send
  across two profiles with colliding account addresses) + asserts no cross-profile render/bind.
- **Migration note:** pre-production ⇒ no numbered migration, BUT new persisted fields (tx `profileId/networkId`;
  any slice-key fields) must be OPTIONAL + per-row-tolerant codec (legacy rows parse). Confirm.

## Bug-finding / assumption-attack asks (answer in your plan)
- What could go wrong? Attack the slice model: can a producer ever route to the active slice by mistake? Can a
  switch mid-snapshot lose or duplicate a record? Does the durable epoch actually cover SW-restart + re-import?
- Is abort-on-drift airtight, or is there a drift window it misses (between the snapshot-equality check and the
  actual sign/submit)? What does the user-warning UX look like, and can a malicious dApp weaponize forced aborts?
- Attack the Assumptions. Which Facts are misstated? Which Inferences unsafe? Which Asks silently assumed?
- Given ONE big PR touching shared execution-lane code used by ALL sends (not just dApp): what's the blast-radius
  mitigation, and which existing network e2es (`concurrent-sendtx*`, `cancel-mid-prove`, `transfers`,
  `multi-account-from`) must stay green?

Return a complete `plan.md`-shaped document with concrete implementation details.
