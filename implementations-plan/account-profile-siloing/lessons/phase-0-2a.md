# Lessons — Phases 0, 1, 2a′

## Phase 0 — characterization

**bb.js is unavailable in the unit/composition test layer.** A characterization test that drove real account
derivation (`poseidon2Hash` → `NuloAccount.new`) died with `BBApiException: std::bad_cast`. `COMPOSITION-TESTS.md`
requires this layer to be bb-free, so collisions had to be expressed through the service's own bb-free write path
(`restore`) rather than by deriving two colliding addresses. Same conclusion applies to any future test that
wants a *real* address: it belongs in the network e2e, not here.

**`createOperation` defaults to stage `pending`, not `queued`.** A first attempt transitioned `queued → pending`
and threw `IllegalTransitionError: pending → pending` before reaching any storage write, which silently defeated
the write-gate the test used to interleave a race. `initialStage: "queued"` is reserved for the wallet-sdk arrival
surface and is schema-enforced to `kind: "dapp_execute"` + `origin: "dapp"` + non-empty `sessionId`
(`operation-journal/spec.ts:249-261`) — which is the realistic shape for these hazards anyway.

**Gating `storage.local.set` is a reliable interleave point.** `EntityStorage.set` delegates to
`storage.set({...})`, so spying on the fake's `set` and holding the first call lets a competing operation run to
completion inside a load→write gap. That is how both journal races are pinned deterministically.

## Phase 1 — durable causal protocol

**A property suite is worthless until it has been shown to fail.** Two deliberate mutations were run against the
finished module: disabling the tombstone guard (caught by P1 + P2) and making snapshot rows overwrite
unconditionally (caught by P3). Both were caught by the properties written to catch them; the module was then
restored and re-verified. Do this on any future property work here.

**fast-check finds under-specified generators, not just bugs.** The first run failed on `" "` — a whitespace-only
identifier the scope validator correctly rejects. The fix was to constrain the arbitrary and add an explicit
blank-identifier test, not to loosen the validator.

## Phase 2a′ — account composite re-key

**The blast radius was in two non-obvious places, both caught by tests rather than by reading the service.**

1. **The backup registry's row anchor** (`backup-migration-registry.ts`). Account rows are reconstructed on
   import from `idOf(row)`; that anchor was `address` alone and had to become the full triple. The compile-time
   `AssertAnchor` pin had to widen with it. The new anchor is fail-closed (a row missing any of the three fields
   has no reconstructable identity and is rejected) — which then surfaced that several test fixtures used
   under-specified stubs like `{ address: "0xMINE" }`. Real `Account` rows always carry all three (the schema
   requires them), so the fixtures were wrong, not the anchor.

2. **A production string coupling on the thrown error.** `useFullBackupImport.ts` matched
   `err.message === "Duplicate address"` to roll back a half-created profile. Renaming the error to
   `"Duplicate account"` (correct now that a duplicate *address* across profiles is legal) would have silently
   broken that rollback. Both sides were updated together. Worth remembering: grep for the literal message text
   before renaming any thrown error.

**`restore`'s duplicate check was the real gate, not the storage key.** It refused any incoming address already
present in storage (`hasIntersectionByKeys(..., ["address"])`), so even with composite keys the second profile's
import would still have been rejected. Re-keying storage without fixing that check would have looked correct and
changed nothing observable.

**Verify a suspected pre-existing failure instead of assuming.** When 12 tests failed after the re-key, stashing
the work and re-running proved they passed at HEAD — i.e. the breakage was mine. That took ~30 seconds and
removed the temptation to write it off as flake.

**The freeze surface stayed provably untouched.** `packages/aztec-runtime` has zero diff and its 99 tests
(including the address KAT) pass unchanged, which is the intended proof that re-keying storage never touched
derivation.
