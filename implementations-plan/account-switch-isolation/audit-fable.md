# Fable (Opus) adversarial audit — account-switch isolation plan v1

**VERDICT: conditional approve** — conditions: fix structural-proof soundness (C1); specify §2.2
delete/tombstone handling (S1+S2); specify the SW→test ack channel for the poll gate (S3/determinism);
resolve the Phase-1.6 owner-check contradiction (C3). None reopen the production leak; all fixable at the gate.

## Contradiction
- **C1 (most severe)** — structural proof (delete guards→rerun→green) is unsound: Phase 3 removes only the
  ingest filter but `buildActivityRows` render filter (keyed on active account) survives and masks any
  Phase-3 mis-routing → leak test stays green while structure is broken. Must remove ALL runtime scope
  enforcement simultaneously (ingest + buildActivityRows + sync visible-ref clear) OR assert raw slice placement.
- **C2** — the off-ramp ships the exact "targeted-guards-as-final-state" the §6 ledger REJECTED as fragile.
  Phase 1 is a legit ship-now fix, but stop claiming the off-ramp is a stable end state / "correctness guaranteed."
- **C3** — Phase 1.6 "PXE owner == captured account" contradicts `service.ts:780` `owner ?? accountAddress`
  (owner often absent). Resolve to: drop only when `content.owner` PRESENT AND ≠ accountAddress.
- **C4** — A3/A5 (and A2) are pre-decided in phase steps but listed as open Asks. Promote to adopted or the
  gate could reverse a decision the impl already assumes.

## Security
- **S1** — §2.2 step 6 "merge by stable ID" resurrects deleted rows on reconnect-mid-delete: a DELETE during
  a snapshot removes X (revision++), stale fetch still has X, union-merge re-adds X. Under an intervening
  delete the ONLY correct option is reschedule a fresh snapshot; merge-by-ID must not be co-equal.
- **S2** — tombstones guard fetches (step 4) but NOT event reducers (step 7). A late A `onIncomingTransferAdded`
  after account A delete writes to A's tombstoned slice by payload scope; re-importing the same mnemonic yields
  the SAME scope key → resurrected row under the "new" account. Event reducers must drop writes to tombstoned scopes.
- **S3** — the deterministic gate needs a SW→test ACK channel the one-way proof-gate lacks (test must know the
  emission is pending before switching to B). That's a second SW-written storage key — NOT "exactly" the existing
  envelope. Without a reliable ack, "sync until" degrades to a timing soak → intermittent RED under RETRY=0.
  Specify the ack protocol + a timeout well under the 30s network testTimeout, or drop the "deterministic" claim.
- **S4** — `owner` is attacker-settable, persisted as unconstrained `z.string()` (`spec.ts:91`); inert only if
  NO path reads it. Scoping on `accountAddress` IS watertight (PXE per-account decryption + trusted poll param
  `service.ts:574,776`). Condition: canonicalize-or-drop `owner` at ingest + a static guard that no
  render/scope/dedup path reads `owner`. Dedup on `siloedNullifier` is safe (cryptographically unique).

## Assumptions
- **A1** — §5 Fact misstatement: `:780` falls back to `accountAddress` (trusted scan param), NOT "active-account"
  (there is no active account in the background scan context). Fix the Fact.
- **A2** — I5 "pre-production ⇒ no migration" sound ONLY with two unstated constraints for the Phase-2 tx-shape
  change: (a) new tx-schema fields OPTIONAL (legacy rows parse), (b) codec per-row tolerant (a legacy row is
  skipped/ambiguous, not throwing and bricking the whole transactions load). Add explicitly; confirm A6 baseline.
- **A3** — A1's "fix rests on single-global-account" is wrong/misleading: `account` is a plain ref
  (`app.store.ts:49`), not synced; popup + side panel CAN diverge but each document is self-consistent. The
  robust design rests on PER-DOCUMENT scope from the document's own store, never the global storage value.
- **A4** — "synchronously clear visible refs" conflicts with the only existing reset (async `app.vue:87` watch,
  flushes nextTick → one-tick window where A renders under B → §7 "absent immediately" fails). Clear must live in
  the mutation path (selectAccount/centralized setter) or flush:'sync'. Explicit constraint.

## What looks right
Root-cause decomposition + file:line inventory accurate; scope-on-accountAddress-never-owner correct and
provably watertight (PXE per-account decryption); composite ActivityScope; fail-closed throughout + fail-closed
Zod at the wire + dropping orphan TaskService cards until strict correlation; guards-first staging with Phase 1
standalone shippable (incoming events dropped at ingest while records stay persisted server-side → switch-back
re-fetch restores B's own data without leaking A); the proverless double-opt-in + DCE + bundle-grep envelope
for the new e2e gate.
