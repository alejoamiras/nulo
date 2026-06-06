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

## Status (P1 in progress)
- ✅ `token_minter_proxy` compiles clean with the rc.2 nargo.
- ⏳ `token_bridge`: strip the attestation layer (clean-hands/passport/schnorr,
  `_validatePrivateAttestations`, the `exit_to_l1_private` gate), then compile.
- ⏳ Keystone: content-hash equality test (Solidity `Hash.sha256ToField` vs the
  Noir `token_portal_content_hash_lib`) for fixed vectors — the one cross-chain
  guard the TXE can't provide.
