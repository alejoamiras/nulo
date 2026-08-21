HOLDS with one low-severity concern — the F-1/F-2 closure is sound.

- **F-1:** MAC v3 binds the requested storage-key identity, every sealed slot, and fingerprint. Embedded-id swaps are hidden; changing both key and embedded ID still fails MAC verification. All non-adjudicated DEK trust/reseal paths verify first. I found no A1/A2 transplant that yields clean persistent adoption.

- **F-2/passkeys:** Create/import/restore derive the fingerprint; unlock/export recompute it; finalize now compares the four-field snapshot and recomputes from the stashed master. Drift zeroizes the DEK and degrades correctly. The regression test exercises the important slot-swap case.

- **Numeric mode:** Correctly requires a positive safe integer and canonical suffix. Authwit aliasing is closed. Minor test inaccuracies: the service test actually copies row 1, not row 5; and the unsafe-number test uses suffix `1000000000000000000000`, which the old `String(1e21)` check already rejected. Use key `journal@1e+21` to regression-pin `Number.isSafeInteger`.

- **New Low:** Profile rows have no runtime schema, and finalize uses `if (type === "password") … else passkey`. A1 can change `type` to `"bogus"` while preserving all snapshotted fields; finalize opens clean despite row drift. This does not bypass F-1/F-2 or substitute the secret/DEK, but it violates the consistency guarantee. Explicitly require `profile.type === "passkey"` or snapshot `type`.

Tests were inspected but could not execute in the read-only sandbox.