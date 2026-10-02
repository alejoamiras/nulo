# P2 · One key for every contract comparison

## What changed

- `packages/wallet-bridge/src/field-address.ts` holds `isFieldAddress` (moved from the dispatcher
  unchanged), `fieldAddressKey` and `sameFieldAddress`. The dispatcher no longer imports `Fr`: the
  leaf is the only reader of the modulus.
- `matchesPattern`, `inAddressList` and the three coverage functions compare through
  `sameFieldAddress`; the `"*"` branches still run first.
- `handleSendTx`'s three interpolating debug calls are gone, and with them the `execPayload` local
  that only they read.

## Red before the deletion

The logger-spy test ("a sendTx a scope in another case admits: no log line at any level carries
…"), run with the comparison fixed and the three debug calls still present, failed on
`expected '[["wallet-sdk",0,"handleSendTx: accou…' not to contain '0x0a0a…'`: the account reached
a finished string. It passes after the deletion.

## Fact 13, confirmed

A throwaway run of the unmodified dispatcher tests against the fixed code (the probe file was
deleted straight after and never staged) failed exactly the six tests Fact 13 predicts:
`isTokenRegistered` granted and no-reader, the `executeUtility` raw-hex test, the reader
stickiness pin, and `grantPublicAuthwit`'s routing and account-rejection tests; 222 passed. The
vacuous three (`"0xother"` vs `"0xtok"`, the flag-off case, `"0xtoken"` vs `"0xOTHER"`) now use
distinct 64-hex constants, and the old `"0xtok"` success case is the dispatcher-level invalid pair
(a held `"0xtok"` refuses `isTokenRegistered("0xtok")`). `bun run test:all` found no further red
fixture.

## Gate

- `bun run lint`: exit 0. 29 warnings and 3 infos, the same counts as the run on the plan-landing
  commit; `complexity-baseline check OK`. No `biome-ignore` added anywhere in the diff.
- `bun run typecheck:all`: exit 0, every workspace.
- `bun --bun vitest run` in `packages/wallet-bridge`: exit 0, 12 files, 478 tests passed. Every P1
  wallet-bridge case that was red now passes, the invalid-pair cases included; the "refuses any
  other value or spelling" rows and the three wildcard pins still pass.
- `bun run test:all`: exit 0. extension 7842 passed, 4 skipped, 8 todo (597 files passed,
  3 skipped); wallet-bridge 478; design 401; aztec-runtime 250 passed, 2 skipped; wallet-core 247;
  extension-messaging 239; wallet-crypto 120; third-party-notices 66; legal 54; landing 40;
  resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp exit 0. The extension count includes
  the P3 window tests sitting uncommitted in the tree: they pass on the P2 code alone, as the plan
  predicts, since today's table key already equals the new key for valid addresses.
- `dispatcher.test.ts:1992-2009` ("valid wire strings pass unchanged, in the case sent") has no
  edit in the diff and passes: stored grants keep the case sent.
