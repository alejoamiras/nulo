# Phase 4 — Re-diff, detectors, builds, smoke, full prover-ON suite

## Step 1 — copied-logic re-diff (verdict per file; sources = both installed generations)

| Mirror | Upstream evidence at 5.2.0 | Verdict |
|---|---|---|
| `fee-options.ts` + `embedded-fpc-cap.ts` (MIN_FEE_PADDING=0.5 ×2) | `wallet-sdk/dest/base-wallet/base_wallet.js:40` `minFeePadding = 0.5` at BOTH generations; `maxFeesPerGas` formula line identical | HOLD, no edit |
| `fast-path.ts` (named imports + appCallOffset) | imports resolve (typecheck) + `computeAppCallOffset` call shape identical | HOLD |
| `block-header-anchor.ts` | base_wallet total diff = 47 lines, none in the header-preference region | HOLD |
| `batched-view-simulation.ts` (SerialQueue cite) | `SerialQueue` present ×2 in pxe@5.2.0 `dest/pxe.js` | HOLD |
| `pxe/service.ts` tagging trio | `registerTaggingSecretSource`/`getTaggingSecretSources`/`removeTaggingSecretSource` all present in pxe@5.2.0 | HOLD |
| `pxe/service.ts` `overrides`⇒`skipKernels` | rule still enforced (pxe.js:770 throw); `skipKernels` now DEFAULTS to true — our explicit pass stays correct | HOLD |
| `effective-class.ts` (preimage split) | service tests green; no `currentContractClassId` resurrection in pxe.js | HOLD |
| `opfs-store.ts` PIN=13 | asserted by its own test in test:all (green) | HOLD |
| `public-events.ts` | `getPublicLogsByTags` unchanged (typecheck + tests) | HOLD |
| `pxe/schemas.ts` NoteDaoSchema (no compile pin) | `stdlib/dest/note/note_dao.d.ts` BYTE-IDENTICAL across generations | HOLD |
| `note-schemas.ts` class-id keying | keys are COMPUTED from the installed artifact catalog at runtime — self-consistent across the noir-contracts.js class-id shifts; live NULO token rides the held standards package | HOLD, no edit |
| `wallet-core serialization.ts` jsonStringify copy | `foundation/dest/json-rpc/convert.js` BYTE-IDENTICAL | HOLD |
| `content-script-validator.ts` InternalMessageType | wallet-sdk `extension/handlers` byte-identical (dossier + typecheck) | HOLD |
| `runtime.ts` BarretenbergSync memoized rejection | `bb.js/src/barretenberg/index.ts` BYTE-IDENTICAL across generations | HOLD |
| `bridge-core fee-juice.ts` getMinFees mirror | the mirrored logic lives in wallet-sdk base_wallet (`getMinFees(congestionEstimate)` — identical both generations); wallets@5.2.0's only change is an additive `nodeClientOptions` bag | HOLD |
| `wallet-sdk-schema-patch/apply.ts` header | stale "== 5.0.0" → "== 5.2.0" | EDITED |

Behavioral notes carried from the base_wallet 47-line diff (dossier-confirmed): `scopesFrom`
gains `sendMessagesAs` (tagging scoped to the selected sender), the local duplicate-tx throw is
gone, and receipt polling gains an initialDelay — e2e timing drift candidates, watched in the
full-suite run.

## Phase 3 canary triage (chronology lives here because it fed step-1 pacing)

First post-bump canary run FAILED at 22.5s with ZERO accelerator requests — pre-proving. Two
mechanical causes found: STALE VITE OPTIMIZER CACHES in the dev-served apps after the dep swap
(`.vite/deps/*.js does not exist` pre-transform errors — the dApp page couldn't load) and a
transient `aztec-node: Address already in use` (no orphan held any listener on inspection; the
other agent's anvil on 8545 is theirs and untouched). Fix: `rm -rf <app>/node_modules/.vite`
for faucet/playground/extension; retry launched. Durable lesson: ANY dependency-line swap
invalidates vite dep-optimizer caches in dev-served apps — clear `.vite` before the first
post-bump e2e run.

## THE ONE REAL SOURCE CHANGE THIS BUMP NEEDED (e2e fixture)

`fee-methods.test.ts` failed prover-ON with
`Address derivation parity broken: NuloAccount=0x03e8… vs createSchnorrAccount=0x24b3…`
(`fixtures/aztec.ts:518`, `setupPreFundedAccount`). **This is the freeze working, surfacing in
test infrastructure** — upstream recompiled SchnorrAccount at 5.2.0, so
`EmbeddedWallet.createSchnorrAccount` derives a NEW address while `NuloAccount` (vendored
artifact) stays pinned. The fixture funded the frozen address but deployed the upstream one.

- **Production blast radius: ZERO.** `rg createSchnorrAccount apps/extension/src packages/*/src`
  → no hits; production derives only through the frozen path. Failure was confined to the three
  pre-funded-fee-juice cases (public FJ, private FJ, gas-balance card).
- **Fix**: build the script-side `AccountManager` from the FROZEN artifact —
  `AccountManager.create(wallet, secretKey, new FrozenSchnorrAccountContract(signingKey),
  {salt: Fr.ZERO})`, where `FrozenSchnorrAccountContract extends SchnorrAccountContract` and
  overrides only `getContractArtifact()`. Verified safe to override just that hook:
  `getContractArtifact()` is the abstract artifact seam on `DefaultAccountContract`, and
  upstream 5.2.0's `getInitializationFunctionAndArgs()` returns `constructorName: "constructor"`
  with args `[x, y]` — byte-for-byte the frozen descriptor's pins (salt `Fr.ZERO` too). The
  parity assertion is KEPT and now guards the fixture's frozen path against NuloAccount.
- **Durable lesson (belongs in the aztec-update skill)**: any bump that recompiles upstream's
  account artifacts breaks e2e fixtures that build accounts through upstream helpers, even
  though production is immune. Fixtures must derive through the frozen artifact, not
  `createSchnorrAccount`. Typecheck cannot see this — `tests/e2e` is outside the tsconfig graph.

## Battery results

Re-run after the SDK 5.2.0 bump (the re-diff verdicts above are unaffected — they compare OUR
copied logic against upstream 5.2.0 sources, independent of the accelerator's own version).

- **Builds**: `audit:vue` green (typecheck ∥ test ∥ lint → chrome build, `✓ built in 4.23s`);
  faucet, playground, and firefox builds all produced their outputs.
- **Drift detectors**: `verify:deployments` — dripper / nulo / olun all `[OK]`
  (computed == committed); the opt-in `BRIDGE_MANIFEST=public/testnet-bridge.json` lane —
  bridge.proxy / bridge.token / bridge.bridge all `[OK]`. Six live testnet addresses re-derive
  bit-identically under the 5.2.0 loader against unchanged artifacts: the dossier's
  loader-neutrality claim, confirmed on our own deployments.
- **Smoke**: first run had ONE failure — `backup-migration.test.ts` "fixture-arming contract:
  unarmed runs are allowed ONLY against a release artifact". NOT a bump regression: that test
  is a guard asserting the suite can't silently skip; it fires whenever a repo build lacks
  `VITE_NULO_E2E_MIGRATION_FIXTURE=1`. CI arms it via `_smoke-e2e.yml`
  (`MIGRATION_FIXTURE_ARMED` → both the build-time and run-time vars). Re-run with a
  fixture-armed build (build with `VITE_NULO_E2E_MIGRATION_FIXTURE=1`, run with
  `NULO_E2E_MIGRATION_FIXTURE=1`). **Local-runbook lesson: `bun run test:e2e` after a plain
  `bun run build` is NOT the CI-equivalent smoke — arm the fixture or the guard reds.**
- **Smoke, armed run**: backup-migration guard passed; two SW files failed
  (`sw-restart-network`, `sw-resilience`). Triaged, NOT neutralized:
  - `sw-restart-network` passed on the first targeted re-run → flake.
  - `sw-resilience` failed twice — but the stacks point at the **initial**
    `waitForHash(page, "#/popup/general")` on lines 98/139, i.e. cold popup boot BEFORE any SW
    kill, not the SW logic. Run in isolation the whole file passes, fast: 7.1s / 3.7s / 3.3s
    against a 15s budget. Verdict: host contention during a 32-file parallel smoke run, the
    same cold-boot-opener flake class dev commit #468 raised the budget for — not a bump
    regression (this diff has ZERO runtime source changes, and the SDK 5.2.0 bump makes the
    bundle single-generation, i.e. smaller than the dual-generation state, not larger).
    Confirmation re-run on an idle host recorded below; CI's dedicated smoke runner is the
    authority.

