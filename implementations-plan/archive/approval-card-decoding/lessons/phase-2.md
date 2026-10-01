# Phase 2 — display-only ABI decode (retrofit log)

Commit `ec297815`.

## What landed

- `packages/wallet-bridge/src/decoded-call.ts`: the projected value tree (`address | integer |
  boolean | field | string | selector | none | array | struct`), `DecodedCall`, `UndecodedReason`
  (`unknown-contract | unknown-function | arguments | unavailable`), `DisplayCallInput`.
- `execution/call-decoder.ts`: `decodeCallForDisplay(lookup, call)`; selector before name;
  `countArgumentsSize` arity check; `decodeFromAbi`; struct projection for Aztec/Eth addresses,
  selectors, wrapped fields, options; arrays capped at 8 shown items.
- `execution/service.ts`: `decodeCallsForDisplay(networkId, calls)` — `ensureInitialized`, array +
  ≤ 64 check, active-profile/network ownership, one artifact promise per address.

## Attempts that failed and why

1. Fixture `FunctionAbi` with `isInternal` → typecheck: 5.2.0 has `isOnlySelf` (required), no
   `isInternal`. Fixed the fixture, not the type.
2. Address fixture `0xbbb…` (64 b's) → `Fr.fromString` throws above the field modulus. Test
   addresses now start with `0x00`.
3. `decodeFromAbi` returns a bare value for a single-type ABI and an array otherwise — the decoder
   normalizes before projecting.

## Gate

`bunx vitest run src/wallet/services/execution/call-decoder.test.ts` + extension and bridge
typechecks — green on `ec297815`.
