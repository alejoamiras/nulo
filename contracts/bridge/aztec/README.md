# bridge-aztec (Noir)

L2 contracts for the Nulo bridge: `token_bridge_hub` — one hub per generation that
registers a token from the L1 factory's attested words, then claims into it
(`claim_public`/`claim_private`) and exits back to Ethereum. `claim_secret` and
`register_hash` are the shared derivation libraries; `keystone` pins them against
their TypeScript and Solidity mirrors.

## Toolchain — use the 5.0.0 nargo (NOT the default)

The contracts pin aztec-nr at the `v5.0.1` git tag. A mismatched default aztec
toolchain fails with a flood of macro errors (`cannot find self`, `Could not
resolve 'at'` — the `#[aztec]` macros don't expand). Always compile via the
pinned toolchain, which `scripts/compile.sh` selects for you:

```bash
scripts/compile.sh            # uses AZTEC_HOME=~/.aztec/versions/5.0.0 (aztec-up install 5.0.0 first)
```

CI must pin this toolchain version for the Noir build.

## Status
- ✅ `token_bridge_hub` + `keystone` compile clean with the pinned nargo via
  `scripts/compile.sh` (`aztec compile` + the `bb` AVM transpile → deployable `target/*.json`).
- ✅ The hub's TXE suite runs via `scripts/run-txe-tests.sh`, gated by `txe-manifest.txt`.
- ✅ Sole-consumer invariant (three named consume sites; `claim_private` derives its secret)
  enforced statically by `scripts/check-sole-consumer.sh`.
- ✅ Keystone content-hash equality (Solidity vs Noir vs TS) pinned in
  `bridge-evm/test/WitnessHash.t.sol` + `bridge-core/src/l1.test.ts`.
