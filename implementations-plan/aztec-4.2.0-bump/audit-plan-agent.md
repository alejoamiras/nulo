# Audit: aztec-4.2.0-bump plan-v1 (strategic critique)

> Audit by Plan agent (Opus 4.7), parallel pair to the codex xhigh static
> analysis. Agent ran read-only and returned this content inline; written
> here for the audit trail.

## BLOCKING

### B1. Patch on `@aztec/accounts@4.2.0-nightly.20260413` is not in the plan

`package.json` lines 31-33 register `patches/@aztec%2Faccounts@4.2.0-nightly.20260413.patch`. The patch adds `with: { type: 'json' }` import attributes to six lazy-loaders in `dest/{ecdsa,schnorr,stub}/.../lazy.js` — required to keep vite from breaking the JSON imports in MV3. After bumping `@aztec/accounts` to `4.2.0` the patch key won't match and bun will refuse the install (or silently drop the patch if the strictness is loose). You must:
- rename the patch file + key to `@aztec/accounts@4.2.0`,
- re-apply (the line offsets very likely shifted in 3 weeks),
- verify upstream didn't already land the import-attributes fix (in which case drop the patch entirely).

This is the single likeliest failure that forces a stack and cannot be discovered by typecheck. Add a step before "bun install" to refresh the patch.

### B2. Vendored bb.js WASM is pinned to the nightly build

`packages/extension/libs/@aztec/bb.js/barretenberg{,-threads}.wasm.gz` (Apr 11, ~2.7 MB each) are vendored alongside the JS package and served via `viteStaticCopy` to `/assets/`. They're not in npm — there's no postinstall hook to refresh them. After the dep bump, the JS in `node_modules/@aztec/bb.js` will be 4.2.0 but the WASM the extension loads at runtime will still be from the nightly. If the bb.js ↔ barretenberg ABI shifted (it commonly does between releases — circuit-keys, witness layout, memory-layout symbols), proving will break at first transaction with no compile-time signal.

**Add an explicit step**: re-copy `barretenberg*.wasm.gz` from the new `node_modules/@aztec/bb.js/dest/browser/` (or wherever the package ships them) into `libs/@aztec/bb.js/` and verify size/hash changed. This belongs ahead of `bun run build`.

## SHOULD-FIX

### S1. Risk inventory missing the patch + WASM items above

Add risks #9 (patch drift) and #10 (vendored WASM staleness).

### S2. PXE WASM compatibility / `bb.js` memory growth not tracked

Risk inventory has nothing about proving-time memory regression. Service-worker heap is constrained; a 4.2.0 prover that grows memory faster will OOM the offscreen document under FPC fee path (the heaviest manual-QA case). Mitigation isn't an action — it's a data-collection ask: capture a proving memory baseline pre-bump, compare post-bump on the same fixture (FPC pay_fee), file an issue if regression > ~25%.

### S3. Service-worker boot time / bundle size regression

Plan calls bundle-size delta "informational." Disagree — promote to a tracked gate. The offscreen chunk is the dominant cost and the 4.2.0 stable likely pulls in additional symbols (registry rework, capsule scope enforcement). Capture before/after `dist/chrome/assets/offscreen-*.js` size in the PR description. If the chunk grew > 10% with no obvious justification, that's a signal to investigate, not to merge.

### S4. dApp dispatcher (`aztec_*` namespace) drift not tracked

`packages/wallet-bridge/src/dispatcher.ts` exposes the dApp surface. The plan should explicitly verify against the upstream `@aztec/wallet-sdk@4.2.0` capability schema — particularly `aztec_simulateTx`/`aztec_profileTx`/`aztec_sendTx` payload shapes and the `executeUtility` / `registerSender` / `getAddressBook` family. If 4.2.0 stable added/removed RPC methods or changed args, the dispatcher's switch will silently fall through. Add a step: "diff `wallet-sdk` exported method names + arg schemas vs current dispatcher cases."

### S5. `tx-request-builder.ts:444` and `service.ts:1555,1597` build `GasSettings` via two different paths

The plan correctly notes `.fallback()` is migrated, but the constructor path (`new GasSettings(gasLimits, teardownGasLimits, maxFeesPerGas, maxPriorityFeesPerGas)`) at three call sites was **not** verified. If 4.2.0 changed the `GasSettings` positional-constructor signature (added/removed a field, reordered), typecheck catches this — but the plan should call it out as a specific verification target rather than relying on the generic "typecheck catches signature changes" line.

### S6. The Q3 storage-bump call is correct but the comment in `migrate.ts` should distinguish v4's rationale

The existing v2/v3 history is documented at the top; v4 should also be documented inline (the plan says "add a comment line" — make sure the comment names the dep bump, not just "bump"). Otherwise next time someone reads `migrate.ts` they'll see three entries that look like schema changes when v4 is a defensive wipe.

## NITS

### N1. Q1/Q2 belong in a single "ecosystem-package alignment" decision

`aztec-accelerator` and `aztec-standards`/`aztec-fee-payment` are all third-party packages keyed on aztec-packages. Roll Q1+Q2 into one decision tree with an explicit rule: "if no matching `4.2.0`, stay on the prerelease, run the slot-regression gate, accept the result." That removes ambiguity in execution.

### N2. Plan doesn't mention the `__AZTEC_VERSION__` define in `vite.config.ts:204`

Cosmetic, but worth knowing it auto-flows from `package.json.dependencies["@aztec/pxe"]` so any in-app version readouts will reflect the new pin without code changes.

### N3. Manual-QA step 7 (dApp playground flow) covers `register a custom contract` which exercises smart-tighten — good

Add: also exercise `aztec_executeUtility` (read-only path) since it has its own scope handling at `service.ts:1582`, distinct from simulate/profile/send.

### N4. Verification gates list `bun run lint` between typecheck and test

Lint won't catch dep bumps unless rules cite specific imports — leave it but downgrade to "informational; do not block on it" so a stylistic regression doesn't gate the PR.

## DISAGREE-WITH-PLAN

### D1. Storage version 3 → 4 unconditional bump: agree with the call, but the implementation as described is under-cautious in one specific way

The plan says it wipes `pxe/*` IDB + `keyval-store` + the journal. It does **not** wipe `chrome.storage.local` rows like `nulo:core:tx-cursors` or `nulo:core:txs` (those are in `KEYS_TO_WIPE` from v3, but v4 doesn't add anything). After a class-id reshuffle, transactions in tx history that reference old contract addresses are still meaningful (they're just historical), but per-network tx cursors might pin off-chain into a sync horizon that no longer matches the new PXE state. Walk through `tx-cursors` post-wipe-of-PXE: if PXE is empty, the cursor should be reset too. **Add `nulo:core:tx-cursors` and `nulo:core:txs` (already there) to v4 wipe — explicitly.** Otherwise the wallet ends up with empty PXE + non-empty cursors.

### D2. Don't surf the maintenance window for unrelated deps

Agree with your instinct: vitest/biome/etc. should NOT be in this PR. The bug-bisect cost if anything regresses post-merge is dominated by Aztec changes; bundling unrelated bumps will make `git bisect` near useless. If there's appetite for a maintenance-window pass, do it as a separate PR after this lands.

### D3. Order: dep bump first, then fixture migration, then storage bump — agree with sequencing but propose an explicit checkpoint after typecheck

Specifically: do NOT touch `migrate.ts` until typecheck + unit tests pass against the new deps. Reason: if typecheck fails in a way that requires more than the documented changes, you may want to abandon the bump and fall back. The storage-version bump is irreversible for any installed dev profile (it triggers wipes once seen). Keep it as the **last** edit before the build/e2e gates.

### D4. The PrivateFPC manual-QA step (#5) is the most fragile item; consider skipping on first iteration

Bridging fee juice + minting + paying with `pay_fee` requires a working L1 contract, fee juice portal, and a configured FPC instance — all of which depend on the local sandbox being up and matching protocol versions. If your local sandbox is also bumping to 4.2.0 (`bun run aztec-up`) at the same time, you may get a false positive failure that's actually a sandbox regression, not a wallet issue. **Suggest**: do step 5 only if steps 1-4 + 6-8 are all green. Treat step 5 as the "final-confidence" check, not a blocker for merging if everything else is clean and you can validate FPC on a follow-up.

### D5. The plan punts `@alejoamiras/aztec-accelerator` to Q1, but you can decide internally

The accelerator only needs to match `bb.js` ABI, not the full aztec-packages release. If the current pin works against `@aztec/bb.js@4.2.0` (verifiable with a quick offscreen smoke test of any private function), keep it. Don't bump just for cosmetic alignment — the accelerator is your own package and you control its release cadence. Move Q1 from "user decision" to "execution-time check, default = keep current pin."

## Bundle-size / SW boot expectations

For the user's specific concerns:
- The offscreen chunk almost certainly grows. The recent registry/notes arc (PR #29-#31, #33, #36) added bundled artifacts (Wonderland Token + PrivateFPC JSON via vite alias). Stable 4.2.0 has had ~3 weeks to add more ContractInstance/Class fields and tightening. Expect 2-8% growth.
- Service-worker boot: dominated by PXE init + `loadProductionKnownArtifacts` Poseidon-hashing 12 artifacts. Unlikely to regress unless artifact JSONs themselves grew.
- bb.js memory: most likely regression vector. Not catchable without live proving.

## Recommended additions to the plan

1. Step 0 (before bun install): refresh patch — rename `patches/@aztec%2Faccounts@4.2.0-nightly.20260413.patch` to `4.2.0`, update `package.json` patchedDependencies key, attempt apply, drop if upstream fixed it.
2. Step between bun install and typecheck: re-vendor `barretenberg*.wasm.gz` from `node_modules/@aztec/bb.js/`.
3. Add risks #9 (patch drift) and #10 (WASM staleness).
4. Promote bundle-size from "informational" to "captured in PR description; investigate if delta > 10%."
5. Storage v4: add `nulo:core:tx-cursors` to wipe set (or document why it's not needed).
6. Decide Q1 internally; default = keep current accelerator pin.
7. Explicit checkpoint after typecheck — only proceed to the migrate.ts edit if everything is green.

## Critical Files for Implementation

- `package.json` (root patchedDependencies — patch key must rename)
- `patches/@aztec%2Faccounts@4.2.0-nightly.20260413.patch` (rename + re-apply)
- `packages/extension/libs/@aztec/bb.js/barretenberg.wasm.gz` (re-vendor from new dep)
- `packages/extension/src/wallet/storage/migrate.ts` (v3→v4 + add tx-cursors)
- `packages/aztec-runtime/src/pxe/note-schemas.ts` (regression-gate target if slots shift)
