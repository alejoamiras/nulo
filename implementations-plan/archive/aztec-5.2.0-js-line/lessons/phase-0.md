# Phase 0 — Pre-flight probes (no repo edits)

## 1. Snappy probe — verdict: REMOVE the setup-aztec pin step in PR-1

- First attempt (scratch-`HOME` full installer) failed BEFORE the npm step: noirup's installer
  writes outside the overridden `HOME` (`.nargo/bin/noirup: No such file or directory` ×3,
  `INSTALL_RC=1`) — a harness artifact, not a signal. Lesson: probe the DECISIVE step directly.
- Faithful probe: fresh `npm install` of the installer's exact root
  (`{"@aztec/aztec":"^5.2.0","@aztec/bb.js":"^5.2.0","@aztec/cli-wallet":"^5.2.0"}`) in a
  scratch prefix, normal HOME. Result: `NPM_RC=0`, **`FRESH snappy@7.2.2`, `FRESH LOAD OK`**.
- Durability: `@aztec/p2p` and `@aztec/blob-client` at 5.2.0 declare `"snappy": "7.2.2"` —
  an EXACT pin upstream; a fresh resolve can never pick the broken 7.4.0 line again.
- Placement: the step still protects the 5.0.1 line CI installs TODAY (PR-0 era), so removal
  correctly lands in PR-1 Phase 5.2 alongside the pin bump that makes CI install 5.2.0.

## 2. Local toolchain

`~/.aztec/versions/5.2.0` was ALREADY installed on this machine and `~/.aztec/current` already
pointed at 5.2.0 before any action of ours (snapshot: `current -> versions/5.2.0`, unchanged by
us; 5.0.1 remains installed for compile.sh). No `aztec-up` run needed; no symlink mutation.

## 3. SponsoredFPC probes — PASS with floor

`node_getContract`: both instances non-null (recon, re-verified). Balances via
`getPublicStorageAt(FeeJuice=0x…03, deriveStorageSlotInMap(slot 1, fpc))`:
- 2026-08-25: old `0x1441…970c` ≈ 1400.7e18 · new `0x2ece…315b` ≈ 969.8e18
- 2026-08-26: old ≈ 1381.1e18 (actively consumed — live traffic) · new ≈ 969.8e18
Floor: ≥1e18 (≈10–1000× any single sponsored tx at observed fee scales) — new instance passes
by ~970×. Probe scripts: session scratchpad (`sponsored-fpc-balance-probe.ts`); resolution
gotcha: probe scripts must run from inside a declaring workspace (isolated linker) and
`@aztec/aztec.js` has NO bare "." export — import `createAztecNodeClient` from
`@aztec/aztec.js/node`; `AztecAddress.fromStringUnsafe` is async at 5.x.

## 4. Operational

Port 59833 coordination complete (see phase-a.md); the multi-hour solo window for Phase 4 is
cleared with the only other accelerator-using session. Machine load low (≈0.3).
