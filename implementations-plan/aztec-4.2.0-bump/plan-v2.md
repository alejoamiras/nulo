# Plan v2: Bump Aztec packages → 4.2.0

> Supersedes plan-v1. Consolidates codex (xhigh) + Plan-agent (Opus 4.7)
> findings. Plan-v1's biggest gaps:
> - Missed the bun-patch on `@aztec/accounts` (will silently drop)
> - Missed the vendored `barretenberg*.wasm.gz` files (won't auto-update with npm bump)
> - Severely under-counted `GasSettings` call sites (11, not 1)
> - Missed `GAS_ESTIMATION_*` constant usage that pairs with the new `forEstimation()` API
> - Missed scope discrepancy in `executeNoFromSendTx` discovery sim
> - Storage v4 wipe set was incomplete

## Context

Currently pinned at `4.2.0-nightly.20260413` (April 13). Target: `4.2.0`
stable (~3 weeks of additional commits). Repo at master `6cde23f`.

The bulk of work is the **dep bump itself** + verifying nothing
silently broke. Documented changelog items either don't apply
(`'ALL_SCOPES'`, `DEFAULT_GAS_LIMIT*`) or are already migrated
(`GasSettings.fallback`).

## Verified inventory (post-audit)

| Surface | What | Plan-v1 said | Truth |
|---|---|---|---|
| `GasSettings.fallback` (renamed `default`) | 1 site at `tx-request-builder.ts:444` | ✓ | ✓ migrated |
| `new GasSettings(...)` constructor | "constructor unchanged" | wrong | **11 sites in 7 files** — must verify positional-arg signature didn't change in 4.2.0 |
| `GAS_ESTIMATION_*` constants | "n/a" | wrong | **Used in 2 files** (`nulo-account.ts:18`, `default-fpc-handler.ts:11`) — these constants may be removed in 4.2.0 in favor of `GasSettings.forEstimation()` |
| `'ALL_SCOPES'` literal | n/a | ✓ | zero hits |
| `EmbeddedWallet.create` with `pxeConfig` | 1 site | ✓ | only `tests/e2e/fixtures/aztec.ts:75` |
| Capsule scope path | "always pass `[account.address]`" | partially wrong | `executeNoFromSendTx` at `service.ts:1763` runs the discovery sim with `scopes: additionalScopes` — **omitting the caller account** (vs `authwit-discoverer.ts:93` which includes it). Likely break under 4.2.0's stricter capsule scope enforcement |
| Bun patch on `@aztec/accounts` | not mentioned | wrong | **Patch key won't match after the bump** — must rename + reapply (or drop if upstream fixed it) |
| Vendored `barretenberg*.wasm.gz` | not mentioned | wrong | `libs/@aztec/bb.js/{barretenberg,barretenberg-threads}.wasm.gz` dated Apr 11; npm bump only updates JS half. **Must re-vendor manually** |
| Storage v4 wipe scope | covers PXE IDB + journal | incomplete | also need to wipe `nulo:core:tx-cursors` (sync horizon would mismatch empty PXE); consider `nulo:core:tokens` and `nulo:core:fpcs` (entity rows survive while related account/network state clears — drift risk) |

## Files touched (revised)

### Step 0 (PRE-INSTALL): refresh the bun patch

`package.json` (root) `patchedDependencies`:
```diff
-  "@aztec/accounts@4.2.0-nightly.20260413": "patches/@aztec%2Faccounts@4.2.0-nightly.20260413.patch"
+  "@aztec/accounts@4.2.0": "patches/@aztec%2Faccounts@4.2.0.patch"
```

Then either:
- Rename the patch file `patches/@aztec%2Faccounts@4.2.0-nightly.20260413.patch` → `patches/@aztec%2Faccounts@4.2.0.patch` and let bun retry on install. If line offsets drifted, re-generate (`bun patch @aztec/accounts@4.2.0`).
- OR if upstream landed the `with: { type: 'json' }` import-attribute fix, drop the patch entirely.

The patch adds JSON-import attributes to 6 lazy-loaders; if vite doesn't error on `bun install` post-bump, the fix is upstream and we delete.

### Step 1: bump dependency versions (5 × `package.json`)

Same matrix as plan-v1:

- All `@aztec/*`: `4.2.0-nightly.20260413` → `4.2.0`
- `@aztec/viem`: leave at `2.38.2` (separate version axis)
- `@alejoamiras/aztec-accelerator`: keep current `4.2.0-nightly.20260413.1` pin (Q1 collapsed to internal decision per Plan-agent D5 — accelerator only needs to match `bb.js` ABI; if it works against `bb.js@4.2.0`, leave it)
- `@wonderland/aztec-fee-payment`: user-supplied tarball URL
- `@defi-wonderland/aztec-standards`: try matching prerelease if published, else stay at `4.2.0-aztecnr-rc.2` and let the slot-regression gate decide (Q2 collapsed)

Run `bun install`.

### Step 2 (POST-INSTALL): re-vendor `barretenberg*.wasm.gz`

```bash
cp node_modules/@aztec/bb.js/dest/browser/barretenberg.wasm.gz packages/extension/libs/@aztec/bb.js/
cp node_modules/@aztec/bb.js/dest/browser/barretenberg-threads.wasm.gz packages/extension/libs/@aztec/bb.js/
```

Verify size/hash changed vs the Apr 11 baseline. If unchanged, the npm package didn't bump barretenberg either — note in PR but no action needed.

### Step 3: typecheck

`bun run typecheck` — primary signal for undocumented API changes. Expected catch points:
- All 11 `new GasSettings(...)` constructor sites — if signature changed
- `GAS_ESTIMATION_*` constants — if removed (migrate to `GasSettings.forEstimation()`)
- Anything in `@aztec/wallet-sdk` the dispatcher consumes (`packages/wallet-bridge/src/dispatcher.ts`)

**STOP HERE if typecheck fails** in a way that requires more than the changelog covers. Don't proceed to storage migration (irreversible per dev profile).

### Step 4: API migration (in code)

Fix anything typecheck flagged. At minimum:
- `tests/e2e/fixtures/aztec.ts:75` — `pxeConfig` → `pxe`
- If `GAS_ESTIMATION_*` constants removed: migrate `nulo-account.ts:113` and `default-fpc-handler.ts:19` to `GasSettings.forEstimation()`

For the **`executeNoFromSendTx` scope discrepancy** (`service.ts:1763`):
- The discovery sim runs with `scopes: additionalScopes` (excludes account). If 4.2.0's stricter capsule-scope enforcement breaks this path, options:
  - (a) Add `account.address` to the discovery sim scopes (semantically inert for kernelless sim)
  - (b) Wrap the discovery call to catch capsule-scope errors and fall back
- Verification gate: run `tests/e2e/network/tx-sendTx-noFrom.test.ts` against a 4.2.0 sandbox. **Note**: the test currently accepts both success/failure (`tx-sendTx-noFrom.test.ts:66`) — tighten to require success in this PR so the path is actually pinned.

### Step 5: storage version 3 → 4

`packages/extension/src/wallet/storage/migrate.ts`:
- Bump `CURRENT_VERSION` 3 → 4
- Add to `KEYS_TO_WIPE`: `"nulo:core:tx-cursors"` (sync horizon mismatch with empty PXE)
- Document v4 inline at the top of the file (per Plan-agent S6: "v4 wipes PXE state defensively after the 4.2.0 dep bump in case storage layouts shifted")

**Open consideration** (decision-Q3 below): also wipe `nulo:core:tokens` + `nulo:core:fpcs`? Codex flagged these as drift surfaces. My instinct: keep them. They're user-curated lists (token registry + FPC registry); contract addresses don't change with the version bump, only on-chain state does. Wiping these would erase user-added tokens — bad UX.

### Step 6: gates + version bump

- `bun run lint` (informational; do not block on stylistic regressions)
- `bun run test` — unit + slot regression gates
- `bun run build` — capture `dist/chrome/assets/*.js` size delta vs pre-bump in PR description; investigate if offscreen chunk grew >10%
- `bun run test:e2e` (smoke) — offscreen wiring
- `bun run test:e2e:network` (with `bun run aztec-up` running 4.2.0 sandbox) — the **real signal**

Bump `packages/extension/package.json` version 0.13.51 → 0.13.52.

## Manual QA (revised order per Plan-agent D4)

Run steps 1-4 + 6-8 first; treat step 5 (FPC fee path) as final-confidence gate, not a merge blocker.

1. Reload extension. Storage migration logs `Storage version 3 → 4`. Boots clean.
2. Create / unlock profile. General page loads.
3. Send Aztec Token. simulateTx + proveTx + sendTx round-trip.
4. Receive on recipient profile. Note discovery + decode (Aztec Token at slot 0x3).
5. **(final-confidence; can defer)** PrivateFPC fee-payment: bridge → mint → `pay_fee`.
6. Notes viewer: confirm decoded type labels (`UintNote · Aztec Token`, etc.)
7. dApp playground: connect → request capabilities → simulate → register custom contract → `aztec_executeUtility` (read-only path tests its own scope handling at `service.ts:1582`)
8. Lock + unlock × 3. SW restarts. Profile re-loads cleanly.

## Risks tracked (revised — adds #9-#12)

| # | Risk | Mitigation |
|---|---|---|
| 1 | Stable contains undocumented API changes beyond user changelog | Typecheck + tests; checkpoint before storage migration |
| 2 | Bundled artifact storage layouts shift | Slot regression gates fail loud → update slot map + storage migration |
| 3 | Class IDs change across versions | Recomputed at load; storage-version bump wipes stale PXE state |
| 4 | PXE IndexedDB shape changes silently | Storage migration wipes `pxe/*` + `keyval-store` on first unlock |
| 5 | E2E smoke flakes from prior arcs reappear | Pre-existing; not caused by this PR |
| 6 | `GasSettings(...)` constructor signature change | 11 typecheck-protected call sites |
| 7 | `GAS_ESTIMATION_*` removed in favor of `GasSettings.forEstimation()` | Typecheck-protected; migrate `nulo-account.ts` + `default-fpc-handler.ts` |
| 8 | `executeNoFromSendTx` discovery sim breaks under capsule scope enforcement | Tighten `tx-sendTx-noFrom.test.ts:66` to require success; add `[account.address]` to discovery scopes if needed |
| **9** | **Bun patch on `@aztec/accounts` silently drops** | **Step 0: rename + re-apply (or drop if upstream fixed)** |
| **10** | **Vendored `barretenberg*.wasm.gz` stale → silent proving break** | **Step 2: re-vendor from new `node_modules`; verify hash** |
| **11** | **bb.js prover memory growth in offscreen heap** | Manual data: capture memory baseline pre/post on FPC pay_fee fixture; investigate if >25% regression |
| **12** | **dApp `aztec_*` namespace drift in `wallet-bridge/dispatcher.ts`** | Diff `wallet-sdk@4.2.0` exported method names vs current `dispatcher.ts` switch cases |

## Out of scope (per Plan-agent D2)

- Surfing the maintenance window with unrelated bumps (vitest/biome/etc.) — separate PR.
- Wonderland NFT bundling (still deferred, task #213).
- Refactoring the bundled-artifact import pattern into a shared `bundled-artifacts.ts` (separate follow-up from earlier note-decoding arc).

## Open questions for the user (down to 1)

Q1 (accelerator) and Q2 (defi-wonderland) collapsed to internal decisions per audits.

### Q3. Storage-version bump (3 → 4)

Plan defaults to:
- Bump `CURRENT_VERSION` 3 → 4
- Wipe set adds `nulo:core:tx-cursors` (codex SHOULD-FIX confirmed)
- DOES NOT wipe `nulo:core:tokens` or `nulo:core:fpcs` (user-curated lists; addresses don't change with version bump)

**Confirm OK?** Or do you want a more aggressive wipe that also drops user-added tokens + FPCs (forcing them to re-add through the UI)? My instinct: keep the user lists. They're idempotent against on-chain state — if a token contract gets re-deployed at a different address later, that's a user-added entry the user can delete.
