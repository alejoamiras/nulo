# Plan v1: Bump Aztec packages → 4.2.0

## Context

Currently pinned across 5 packages at `4.2.0-nightly.20260413` (April 13).
Target: `4.2.0` stable. The user-supplied changelog covers SDK behavior
deltas; we're already on a nightly that may contain some of them.

Repo state: master at `6cde23f`, no in-flight work. The recent
registry/stealth/notes arc (PRs #29-31, #33, #36) added the
`note-schemas.ts` map keyed by hardcoded slot offsets — a key
**risk surface** if the upgrade shifts storage layouts.

## Inventory of impact areas (already verified empirically)

### From the user-supplied changelog

| Change | Status in our codebase |
|---|---|
| `GasSettings.default()` → `.fallback()` | **Already migrated** — `tx-request-builder.ts:444` calls `GasSettings.fallback({ maxFeesPerGas })` |
| `DEFAULT_GAS_LIMIT` / `DEFAULT_TEARDOWN_GAS_LIMIT` removed | **Never used** — zero hits |
| `forEstimation()` new method | n/a — opt-in, we don't currently use estimation gas-limit semantics |
| `'ALL_SCOPES'` removed | **Never used** — zero hits; we always pass explicit `AztecAddress[]` |
| Capsule scope enforcement | Likely fine — we always scope `[account.address, ...additional]`; the zero-address back-compat for global scope is preserved |
| `EmbeddedWalletOptions` `pxe` unification | **Migrate one site**: `tests/e2e/fixtures/aztec.ts:76` uses `pxeConfig: {...}` — old field still works per changelog, but we should rename to `pxe` for cleanliness |
| Aztec.nr ephemeral arrays vs capsule arrays | n/a — we don't write Noir, only consume artifacts |

**Net code-change scope from the changelog itself**: 1 line in 1 file
(the `pxeConfig` → `pxe` rename in the e2e fixture). The bulk of the
work is the **dep bump itself** + verifying nothing silently broke.

### Beyond the changelog (unknown unknowns)

We're jumping ~3 weeks from `nightly.20260413` to whatever stable
`4.2.0` shipped on. The Aztec stable release notes are typically a
condensed subset of all commits; assume undocumented changes.

Categories of risk:
- **Storage layouts** of bundled artifacts (Aztec Token / NFT, Wonderland Token, PrivateFPC) — note-schemas.ts hardcodes slot offsets `0x3 / 0x7 / 0x7 / 0x1`; the `note-schemas.test.ts` regression gates fail loud if any shifts.
- **PXE IndexedDB shape** — handled by storage-version bump (wipe + reseed).
- **Class IDs** — recomputed by `loadProductionKnownArtifacts` on first load; no cached values to invalidate.
- **API renames not in the user changelog** — typecheck catches.
- **Runtime behavior shifts** — unit tests catch some; e2e network tests + manual QA cover the rest.

## Files touched

### A. Bump dependency versions (5 × `package.json`)

All 5 packages with Aztec deps:

| Package | Aztec deps to bump |
|---|---|
| `@nulo/aztec-runtime` | `@aztec/{accounts,aztec.js,bb.js,entrypoints,foundation,noir-contracts.js,protocol-contracts,pxe,simulator,stdlib}`, `@alejoamiras/aztec-accelerator`, `@defi-wonderland/aztec-standards`, `@wonderland/aztec-fee-payment` |
| `@nulo/extension` | All of the above + `@aztec/{constants,kv-store,noir-acvm_js,noir-noirc_abi,wallet-sdk,ethereum,l1-artifacts,wallets}` (devDep) |
| `@nulo/wallet-bridge` | `@aztec/{aztec.js,foundation,stdlib,wallet-sdk}` |
| `@nulo/wallet-crypto` | `@aztec/{foundation,stdlib}` |
| `@nulo/playground` | `@aztec/{aztec.js,bb.js,foundation,noir-acvm_js,noir-noirc_abi,stdlib,wallet-sdk}`, `@defi-wonderland/aztec-standards` |

**Targets:**
- All `@aztec/*`: `4.2.0-nightly.20260413` → `4.2.0`
- `@aztec/viem`: leave at `2.38.2` (separate version axis, not Aztec-release-coupled)
- `@alejoamiras/aztec-accelerator`: `4.2.0-nightly.20260413.1` → **decision needed (Q1)** — does a `4.2.0` accelerator exist?
- `@wonderland/aztec-fee-payment`: `4.2.0-aztecnr-rc.2` → user-supplied tarball URL `https://github.com/defi-wonderland/aztec-fee-payment/releases/download/prerelease-215fd08/wonderland-aztec-fee-payment-4.2.0-prerelease.215fd08.tgz`
- `@defi-wonderland/aztec-standards`: `4.2.0-aztecnr-rc.2` → **decision needed (Q2)** — bump to a matching prerelease, or stay?

After edits: `bun install` to re-resolve the workspace lockfile.

### B. `tests/e2e/fixtures/aztec.ts:75-77` — `pxeConfig` → `pxe`

```diff
- const wallet = await EmbeddedWallet.create(node, {
-   pxeConfig: { dataDirectory, proverEnabled: false },
- })
+ const wallet = await EmbeddedWallet.create(node, {
+   pxe: { dataDirectory, proverEnabled: false },
+ })
```

Old field still works (deprecated path), but migrating eliminates a
future-removal warning and matches the canonical shape.

### C. `packages/extension/src/wallet/storage/migrate.ts` — bump `CURRENT_VERSION` 3 → 4

Per the user's `[No migrations until users exist]` memory, pre-launch
wallet → bump version, wipe affected state, let `getOrInitNetworks()`
reseed defaults. Same destructive-wipe pattern used in v2 (account
addressing) and v3 (network rework).

This handles any silent PXE IndexedDB shape change in stable. Keys
already wiped: `pxe/*` IndexedDB + `keyval-store` (via
`INDEXEDDB_WIPE_PREFIXES`/`NAMES`). The version-bump itself is what
re-triggers the wipe on first unlock after upgrade.

Add a comment line documenting v4 (the dep-bump rationale).

### D. `packages/extension/package.json` — version bump `0.13.51` → `0.13.52`

Patch bump; pre-launch so semver isn't load-bearing.

### E. Verify bundled-artifact regression gates

Run `bun run test packages/extension/src/wallet/services/note/note-schemas.test.ts`
after `bun install`. The 4 regression-gate tests assert:

- Aztec Token `balances` slot = `0x3`
- Aztec NFT `private_nfts` slot = `0x7`
- Wonderland Token `private_balances` slot = `0x7`
- PrivateFPC `balances` slot = `0x1`

If any test fails after the bump:
- The slot for that contract has shifted in the new release.
- Update both `note-schemas.test.ts` (the assertion) AND
  `note-schemas.ts` (the schema map key).

## Verification gates

Run in order, stop on first failure:

1. `bun install` (re-resolve lockfile)
2. `bun run typecheck` — catches API renames not in the user changelog
3. `bun run lint` — should be clean (no preexisting warnings became errors)
4. `bun run test` — unit tests + slot regression gates
5. `bun run build` — produces fresh dist; bundle size delta is informational
6. `bun run test:e2e` (smoke) — offscreen wiring + popup flows
7. `bun run test:e2e:network` (with local Aztec node, `bun run aztec-up`) — the **real signal** for runtime behavior shifts; covers send-token, receive, FPC fee path, contract-register

## Manual QA

1. Reload extension. Storage migration logs `Storage version 3 → 4; wiping legacy state + PXE DBs.`. Wallet boots clean.
2. Create a fresh profile (or unlock existing). General page loads.
3. Send Aztec Token to another account. simulate → approve → send → confirmed. Verifies simulateTx + proveTx + sendTx end-to-end.
4. Receive on the recipient profile. Verifies note discovery + decoding (Aztec Token UintNote at slot 0x3).
5. PrivateFPC fee-payment flow: bridge fee juice → mint → pay a fee with `pay_fee`. Verifies PrivateFPC artifact + slot 0x1 schema.
6. Open Notes viewer (Settings → Advanced → Account State → Notes). Verify decoded notes still show `UintNote · Aztec Token`, `UintNote · Private FPC`, etc.
7. dApp connect flow via playground: connect, request capabilities, simulateTx, register a custom contract. Verify smart-tighten + dApp surface still works.
8. Lock + unlock 3x. SW restarts. Profile re-loads cleanly.

## Risks tracked

| # | Risk | Mitigation |
|---|---|---|
| 1 | Stable contains undocumented API changes beyond user changelog | Typecheck catches signature changes; unit + e2e tests catch behavior |
| 2 | Storage layouts of bundled artifacts shift | Regression gates fail loud → update slot map + storage migration |
| 3 | Class IDs change across versions | Recomputed at load; storage-version bump wipes stale PXE state |
| 4 | PXE IndexedDB shape changes silently | Storage migration wipes `pxe/*` + `keyval-store` on first unlock |
| 5 | `@alejoamiras/aztec-accelerator` 4.2.0 not published | Q1 decision; fallback options listed |
| 6 | `@defi-wonderland/aztec-standards` not in sync | Q2 decision |
| 7 | Wonderland NFT artifact (deferred bundle, task #213) becomes incompatible later | Out of scope; tracked as deferral |
| 8 | E2E smoke flakes from previous arcs (`appearance`, `contacts`) reappear | Pre-existing; not caused by this PR |

## Open questions for the user

### Q1. `@alejoamiras/aztec-accelerator` version

Currently `4.2.0-nightly.20260413.1`. Three options:
- (a) Bump to `4.2.0` if a matching version is published
- (b) Bump to a newer nightly suffix (e.g., `4.2.0-nightly.20260506.1`) if available
- (c) Keep current pin — the accelerator only needs to match the bb.js version; if the current pin still works against `@aztec/bb.js@4.2.0`, no change required

My instinct: try (a), fall back to (c) if not published.

### Q2. `@defi-wonderland/aztec-standards`

Currently `4.2.0-aztecnr-rc.2`. We bundle Wonderland Token from this
package. Options:
- (a) Bump to a matching `4.2.0-prerelease.<sha>` if Wonderland publishes one
- (b) Stay at `rc.2` and rely on the bundled-artifact slot regression
  gate to catch any incompatibility

My instinct: (a) if available; (b) as fallback. If we stay and
Wonderland Token slot has drifted vs the new aztec.nr release, the
regression gate fails the upgrade.

### Q3. Storage-version bump (3 → 4)

Default in this plan. This wipes PXE IndexedDB + the network journal
on first unlock after upgrade. Per pre-launch convention, this is the
right move. **Confirm OK.**
