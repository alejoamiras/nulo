# Phase 1 — Build flag + plain proverless + prod-absence guard ✓

Most of Phase 1 landed during the Phase-0 spike (the spike produced the real
seam, not throwaway wiring — per the quality bar). This phase formalizes +
the prod guard.

## Delivered
- **Double-opt-in build flag** (`src/e2e/config.ts`): `E2E_PROVERLESS` true only
  when BOTH `VITE_NULO_E2E_PROVERLESS=1` AND `VITE_NULO_E2E_PROVERLESS_CONFIRM=1`;
  fail-closed throw if exactly one is set (codex HIGH — Vite auto-loads `.env*`).
- **Proverless factory** (`chain-runtime.ts`): `{ proverless }` → `proverEnabled:false`,
  no `AcceleratorProver`, keeps `WASMSimulator`; `proverless`⊥`required` throws.
- **Offscreen** (`offscreen/index.ts`): proverless factory behind `E2E_PROVERLESS`,
  pins the stamp, throws if proverless+accelerator-required both set (A2).
- **agent.sh**: `NULO_E2E_PROVERLESS=1` arms the double-opt-in flags + asserts the
  positive build stamp (mutually exclusive with accelerator-required).
- **`_build-extension.yml`**: negative grep (D5) — proverless stamp + `nulo:e2e:proof-gate`
  asserted ABSENT from every shipped `dist/{chrome,firefox}`. actionlint ✓.
  (`_smoke-e2e.yml` direct build is exempt — covered by layer-1 source hard-fail +
  DCE, documented in §Security per audit S1.)

## Gate — met
- `bun run lint` ✓ · `bun run test` ✓ (factory unit test: proverEnabled:false, no
  AcceleratorProver, mutual-exclusion — 31 chain-runtime tests green).
- **Prod build (flag UNSET) → stamp + gate key + `ChromeStorageProofGate` class ABSENT**
  (post-relocation DCE confirmed); proverless build → all PRESENT.
- e2e on a public flow (`multi-account-from`) + a private dApp flow (`cancel-mid-prove`),
  both proverless, green (covered in Phase 0).

LESSONS_FILE=implementations-plan/e2e-proverless-stub/lessons/phase-1.md
