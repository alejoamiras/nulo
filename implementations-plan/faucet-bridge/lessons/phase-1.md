# Phase 1 — Network recon + L1↔L2 interop spike

**Status:** Contract-compilation foundations **DONE** (bridge-evm `forge build` green; both bridge-aztec contracts compile with rc.2 nargo). Keystone content-hash test = the next live-net-independent step. Live-net recon **BLOCKED** in this sandbox (operator infra) — the plan's stop-the-line gate.

## Toolchain (critical finding — would bite anyone)
- Noir contracts pin aztec-nr `v4.2.0-aztecnr-rc.2`. The machine's default aztec toolchain (`~/.aztec/current` → `4.2.0`) bundles `nargo 1.0.0-beta.19`, which **mismatches** rc.2 → ~1299 errors (`cannot find self`, `Could not resolve 'at'`) because the `#[aztec]` macros don't expand.
- **FIX:** compile with the rc.2 toolchain's nargo: `~/.aztec/versions/4.2.0-aztecnr-rc.2/bin/nargo` (= `nargo 1.0.0-beta.18`). `token_minter_proxy` then compiles clean (exit 0, artifact produced). The matching version was already installed under `~/.aztec/versions/`.
- **Implication:** `bridge-aztec` (and CI) must pin the rc.2 nargo, not the default. Documented in the package README.

## bridge-evm (Foundry) — done
- Scaffold compiles (`forge build` green). Reusable `UniswapFuelSwap` + interfaces verbatim. Libs vendored from the reference (gitignored). `@aztec/` remaps to the installed `@aztec/l1-artifacts` 4.2.0 L1 sources (no aztec-contracts submodule) — version-matched by construction.

## Done (live-net-independent)
- ✅ `token_minter_proxy` compiles (rc.2 nargo).
- ✅ `token_bridge` attestation stripped + compiles (rc.2 nargo); schnorr dep + TXE test module removed.
- ✅ bridge-evm `UniswapFuelSwap` + interfaces compile (`forge build`).

## Next (live-net-independent — not yet done)
- Keystone content-hash equality test (Solidity `Hash.sha256ToField` vs Noir `token_portal_content_hash_lib`) for fixed vectors — the one cross-chain guard the TXE can't provide. Ready to build with both toolchains in place.

## BLOCKED (needs operator infra — the plan's stop-the-line gate)
- Live-net recon go/no-go: `getNodeInfo()` for FeeJuicePortal underlying + `FeeAssetHandler` wiring + `mintAmount` + rollup version. Needs `VITE_AZTEC_NODE_URL` + network egress + a Sepolia key. **Cannot run in CI/sandbox** — must be run on operator infra before P2 deploy-shaping.
