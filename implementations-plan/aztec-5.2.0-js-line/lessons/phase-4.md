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

(Battery results appended below when the phase completes.)
