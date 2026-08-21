HOLDS with concerns.

- **Finding 1 — HOLDS.** `finalizeRestore` now recomputes the fingerprint before opening, quarantines and zeroizes the DEK on mismatch or computation failure, emits degradation, and zeroizes both buffers if session opening throws.

- **Finding 2 — HOLDS.** String mode rejects missing, numeric, and mismatched embedded IDs in both individual and aggregate reads. `contains()` remains presence-only, but no caller trusts entity data from it.

- **Finding 3 — HOLDS for the 5→9 alias attack.** `AuthwitSchema` parses first, then numeric identity rejects the transplanted row; `revokeAuthwits(9)` therefore cannot operate on row 5.

- **Medium — remaining finalize consistency gap.** Between passkey restore and finalize, A1 can alter `dekSealed`, `credentialId`, or `pxeGeneration` while preserving the correct fingerprint. Finalize opens clean using the stashed DEK without comparing those stored fields. This does not substitute the master or bypass fingerprint binding, but silently postpones detection until unlock/export. Stash and compare the restored row’s security fields before clean-open.

- **Low — numeric mode is under-constrained.** `String()` admits negative, fractional, unsafe/exponential numbers and aliases `-0` to `"0"`. Authwit strings are rejected by the schema, so this does not recreate cross-key aliasing, but malformed numeric rows can poison ID allocation. Require a positive safe integer.

No other passkey fingerprint-open bypass found; silent session restore excludes passkeys. However, `d25f87b7` adds no integration regression test for finalize blinding or service-level authwit aliasing.