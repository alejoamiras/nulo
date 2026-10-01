# Phase 2 ✓ — units · Noir recompile · shift inventory

## THE SHIFT INVENTORY (drift confirmed TOTAL — Phase 3's redeploy checklist)

| Live contract | Recorded (rc.1) | rc.2-derived |
|---|---|---|
| dripper | `0x0d27e525…7254354f` | `0x127f76a6…91b40c40` |
| usdc (AZLO) | `0x071bb9bc…d5aa3b91` | `0x0c23f918…1d647050` |
| eth (OLUN) | `0x1a246cb5…21579d5f` | `0x2e32fd82…0555675d2f` |
| bridge | `0x1a90f8c3…93af0a57` | `0x11898f22…38c74cee` |
| proxy (token_minter_proxy) | `0x2e8bf619…6ff5303b` | `0x2a740b8b…110db853` |
| PrivateFPC | `0x1fa8746e…f44c5c4c` | `0x0d4b2c28…260065f6` (**re-pinned** in `private-fuel.ts`; live re-canary owed by Phase 3) |
| keystone | no committed artifact before | first artifact compiled |
| SponsoredFPC | runtime-derived (salt 0) — shifts automatically with the rc.2 artifact | — |

Detectors: `verify:deployments` RED (dripper/usdc/eth all `[DRIFT]`) · the PrivateFPC tripwire fired (expected↔received above) · the one-shot bridge/proxy re-derive (recorded metas + rc.2 artifacts) both `[DRIFT]`. **Every identity moves → the full Phase-3 redeploy is required**, exactly as the user predicted at the gate.

## Fixes made in-phase

1. **Tripwire re-pin (conscious act):** `PRIVATE_FPC_ADDRESS` → `0x0d4b2c…` with the comment updated to name the rc.2 artifact + the owed live re-canary. bridge-core 129/129 after.
2. **Noir toolchain:** `compile.sh` → `~/.aztec/versions/5.0.0-rc.2` (already installed locally) + **keystone added to the compile loop** (codex-final HIGH#3 — it was never compiled before); the 5 `Nargo.toml` aztec-nr/portal-lib tags → `v5.0.0-rc.2`.
3. **The 20 nargo type errors** ("Could not determine the value of the generic argument `N`/`M` on `call`") were a **mixed-Noir-set problem**: `token_minter_proxy`'s `token` dep pinned the rc.1-era standards source (`prerelease-334c38d`) against rc.2 aztec-nr. Bumped to `prerelease-568f58f` (the rc.2 standards tag) → clean compile. The initial `thread 'main' has overflowed its stack` from `aztec compile` was a red herring masking these errors; raw `aztec-nargo compile` surfaced them (keep `ulimit -s 65520` + `RUST_MIN_STACK` handy anyway).
4. **Biome 2.5.1 `useArrowFunction` safe-fix footgun (self-inflicted):** a blanket `biome check --write apps packages` (run to fix MY widened `…Unsafe` lines) rewrote `vi.fn(function () { return x })` → `vi.fn(() => x)` in 10 extension test files — the exact pattern their in-file comment warns about ("Vitest 4 requires `function` expressions for mocks instantiated with `new`") → 95 test failures. Plain `check` (the lint gate) never flags these; only `--write` applies the fixer. **Restored the 10 files from dev; never blanket-`--write` test trees.**

## Gates (green)
`test:all` → only the intended tripwire fire, then all green after the re-pin (extension **2637** · faucet **423** · bridge-core **129** · the rest green) · Noir recompile all 3 + transpile + path-scrub ✓ · shift inventory complete (above) · `lint` 0 · builds: chrome 0 · firefox 0 · faucet 0 · playground 0 · landing 0. (`verify:deployments` intentionally RED until Phase 3 re-pins — it's the drift detector, and CI's faucet build stays red until promotion.)
