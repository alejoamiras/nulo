# Phase 2 — Frozen instantiation descriptor (revised Outline A)

## What shipped

- `instantiation-descriptor.ts`: `FROZEN_INSTANTIATION_DESCRIPTOR` (version 1, constructor name,
  `salt: Fr.ZERO`, explicit `immutablesHash: Fr.ZERO`, `deployer: AztecAddress.ZERO`),
  `frozenConstructorArgs(signingPublicKey)` = `[x, y]`, `canonicalDescriptorContent()` +
  `FROZEN_DESCRIPTOR_DIGEST` =
  `3883065f0d6603d1be25db42348ec25b7a9dc29746d85b925b09efbd2a460605` (sha256 of the canonical
  JSON; feeds the Phase 3 regime record), and `buildFrozenConstructorCall` — the ONE builder for
  the first-tx ctor call (frozen name lookup, hard error, NO fuzzy `includes("constructor")`
  fallback anymore).
- Both call sites consume the descriptor: `NuloAccount.new` passes every fixed field explicitly
  (including `deployer`, previously an implicit upstream default) and builds args via
  `frozenConstructorArgs`; `buildWithInitialization` delegates to `buildFrozenConstructorCall`.
  Upstream `getInitializationFunctionAndArgs` / `getImmutablesHash` are no longer called — the
  upstream class remains ONLY the auth-witness/signing provider (+ `getSigningPublicKey`, which is
  protocol crypto).
- `instantiation-descriptor.test.ts` (5 tests): digest pin; frozen-value pins; derived instance
  carries every fixed field; the emitted ctor `FunctionCall`'s selector + args recompute the SAME
  `initializationHash` the address derivation committed to
  (`computeInitializationHashFromEncodedArgs(call.selector, encodeArguments(ctorFn, call.args))`
  vs `instance.initializationHash`); missing frozen ctor name → hard error.

## Lessons

1. **Address-equivalence held with zero KAT edits** — explicit `deployer: AztecAddress.ZERO` +
   explicit `immutablesHash: Fr.ZERO` are byte-identical to upstream's implicit defaults
   (verified in upstream dist: `opts.deployer ?? AztecAddress.ZERO`,
   `opts.immutablesHash ?? Fr.ZERO`).
2. **The descriptor digest is hardcoded, not computed at module init** — browser contexts have no
   sync sha256; the constant is recomputed and pinned by the paired test in the node-env suite.
3. New account tests that hash (init-hash, address derivation) must be excluded from the
   extension's jsdom vitest run (same `std::bad_cast` pattern as Phase 1) — done for
   `instantiation-descriptor.test.ts`.

## Validation gate

`bun run lint && bun run typecheck:all && bun run test:all` — exit 0 / 0 / 0 (transcript). KAT
green, zero vector edits; consistency tests green (aztec-runtime suite now 12 files / 93 tests).
