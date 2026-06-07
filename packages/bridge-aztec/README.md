# bridge-aztec (Noir)

L2 contracts for the Nulo Faucet→Bridge: `token_minter_proxy` (single-minter
proxy with an allow-list, so the faucet Dripper AND the bridge can mint the
same token) and `token_bridge` (claim_public/private + exit_to_l1, stripped of
the reference's attestation layer).

## Toolchain — use the rc.2 nargo (NOT the default)

The contracts pin aztec-nr `v4.2.0-aztecnr-rc.2`. The machine's default aztec
toolchain (`~/.aztec/current` → `4.2.0`, `nargo 1.0.0-beta.19`) **mismatches**
it and fails with ~1299 macro errors (`cannot find self`, `Could not resolve
'at'` — the `#[aztec]` macros don't expand). Compile with the matching nargo:

```bash
~/.aztec/versions/4.2.0-aztecnr-rc.2/bin/nargo compile   # = nargo 1.0.0-beta.18
```

CI must pin this toolchain version for the Noir build.

## Status
- ✅ `token_minter_proxy` + `token_bridge` compile clean with the rc.2 nargo via
  `scripts/compile.sh` (`aztec compile` + the `bb` AVM transpile → deployable `target/*.json`).
- ✅ `token_bridge` attestation layer stripped (no clean-hands/passport/schnorr gate).
  `claim_public`/`claim_private` + `exit_to_l1_public`/`exit_to_l1_private`, the latter with a
  non-zero-`recipient` assert (codex HIGH #3). Proven end-to-end via
  `bridge-core/scripts/deploy-sandbox.ts --smoke` — deposit + withdraw, both public + private.
- ✅ Keystone content-hash equality (Solidity vs Noir vs TS) pinned in
  `bridge-evm/test/WitnessHash.t.sol` + `bridge-core/src/l1.test.ts`.
