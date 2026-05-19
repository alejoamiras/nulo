# Plan: Bundle PrivateFPC + Wonderland NFT (extend note-parsing coverage)

## Context

PR #31 (note parsing) shipped decoding for the **3 bundled token-shaped contracts**:
- Aztec Token  → slot `0x3` → `UintNote { value: u128 }`
- Aztec NFT    → slot `0x7` → `NFTNote  { token_id: field }`
- Wonderland Token → slot `0x7` → `UintNote { value: u128 }`

Two known-standard contracts were deliberately deferred from PR #31:
- **PrivateFPC** (`@wonderland/aztec-fee-payment`) — used by Nulo's own private-fee-payment flow
- **Wonderland NFT** (`@defi-wonderland/aztec-standards`) — Wonderland's NFT standard

This PR completes the original plan-v3 scope: bundle these two so they
also get artifact resolution + named-field decoding without a dApp passing
artifacts via `aztec_registerContract`.

## Slot verification (re-confirmed against real artifacts)

| Contract | Storage slot | Field | Schema |
|---|---|---|---|
| PrivateFPC | `0x1` | `balances` | `UintNote { value: u128 }` (verified: `balance_of` returns `u128`) |
| Wonderland NFT | `0x5` | `private_nfts` | `NFTNote { token_id: field }` (mirrors Aztec NFT shape; only slot offset differs) |

Confirmed via `loadContractArtifact(...).storageLayout` on the pinned
release. PrivateFPC has only ONE storage slot (`balances`). Wonderland
NFT has multiple slots but only `private_nfts` is a private note —
`nft_exists` and `public_owners` are public state.

## Files touched (5)

### A. `packages/extension/vite.config.ts`

Add Wonderland NFT alias (PrivateFPC alias already exists at line 45).

```ts
"@wonderland-nft-artifact": resolvePackageFile(
  "@defi-wonderland/aztec-standards",
  "target/nft_contract-NFT.json",
),
```

### B. `packages/extension/vitest.config.ts`

Mirror the alias for unit tests (matching PrivateFPC's existing pattern).

### C. `packages/aztec-runtime/src/pxe/known-artifacts.ts`

Add 2 imports + 2 entries to `loadProductionKnownArtifacts.compiledIn`.

```ts
// @ts-expect-error — raw JSON import via vite alias
import PrivateFPCJson from "@private-fpc-artifact"
// @ts-expect-error — raw JSON import via vite alias
import WonderlandNFTJson from "@wonderland-nft-artifact"

// inside loader:
const PrivateFPCArtifact = loadContractArtifact(PrivateFPCJson)
const WonderlandNFTArtifact = loadContractArtifact(WonderlandNFTJson)

const compiledIn = [
  ...existing 11,
  PrivateFPCArtifact,
  WonderlandNFTArtifact,
]
```

Bundle grows from **11 → 13** entries.

### D. `packages/aztec-runtime/src/pxe/note-schemas.ts`

Append 2 entries to `loadProductionNoteSchemas`.

```ts
const PrivateFPCArtifact = loadContractArtifact(PrivateFPCJson)
const privateFpcClass = await getContractClassFromArtifact(PrivateFPCArtifact)
map.set(privateFpcClass.id.toString(), new Map([["0x1", UINT_NOTE]]))

const WonderlandNFTArtifact = loadContractArtifact(WonderlandNFTJson)
const wonderlandNftClass = await getContractClassFromArtifact(WonderlandNFTArtifact)
map.set(wonderlandNftClass.id.toString(), new Map([["0x5", NFT_NOTE]]))
```

The same JSONs are loaded again here (mirroring the existing pattern
where each loader independently does its own `loadContractArtifact`).
Could share via re-export, but coupling these modules tighter than they
already are isn't worth a deduplication that the JIT will inline anyway.

### E. `packages/extension/src/wallet/services/note/note-schemas.test.ts`

Add 2 storage-layout regression gates (same shape as the existing 3).

```ts
test("PrivateFPC: balances at slot 0x1 (UintNote)", () => {
  const artifact = loadContractArtifact(PrivateFPCJson)
  expect(slotOf(artifact, "balances")).toBe(0x1n)
})

test("Wonderland NFT: private_nfts at slot 0x5 (NFTNote)", () => {
  const artifact = loadContractArtifact(WonderlandNFTJson)
  expect(slotOf(artifact, "private_nfts")).toBe(0x5n)
})
```

### F. `packages/extension/package.json`

Bump `0.13.49` → `0.13.50`.

## Verification

- `bun run typecheck` clean
- `bun run lint` clean
- `bun run test` — expect 932 + 2 = **934 unit tests** pass
- `bun run build` clean
- Auto-imports regen automatically; no manual edits

**Manual QA**

1. Reload extension. PrivateFPC + Wonderland NFT should appear in
   `getContractInstance` resolutions without requiring `aztec_registerContract`
   to pass an artifact (smart-tighten covers them).
2. Notes viewer (Settings → Advanced → Account State → Notes) on a
   profile that has interacted with PrivateFPC (e.g., the wallet's own
   private-fee-payment flow): notes from PrivateFPC should now render
   as `UintNote` with decoded `value`. Same flow for Wonderland NFT mints.

## Risks / Invariants preserved

1. **M4.3 trust enforcement** stays intact: the `known` branch SKIPS
   recompute since the map is keyed by load-time-computed classId.
   Adding entries follows the same trust model.
2. **Smart-tighten** behavior shifts positively: dApps calling
   `aztec_registerContract` for these classes can now omit `artifact`.
   This is a UX improvement, not a regression — existing dApps that
   *do* pass artifacts continue working unchanged.
3. **Bundle size**: +2 contract artifact JSONs in the offscreen bundle
   (~20-50 KB each). Drop in the bucket vs. the existing ~57 MB chunk
   that already includes 11 contracts + bb.js.
4. **Slot collision check**: Wonderland NFT also has slots `0x6`
   (`nft_exists`) and `0x7` (`public_owners`). Neither is a private
   note. Aztec NFT uses `0x7` for `private_nfts` — but the schema map
   is keyed by `(classId, slot)`, so the collision is impossible.
5. **No instances added**: PrivateFPC + Wonderland NFT have no canonical
   "always-deployed" instances (unlike SponsoredFPC). Nothing to add to
   the `instances` map.
6. **No new e2e tests**: PR #31's NoteService tests cover the decode
   path generically (they use synthetic class ids); the new schemas hit
   the same code paths. Storage-layout regression gates protect against
   slot drift in future aztec-packages bumps.

## Out of scope

- **Other Wonderland standards** (Dripper, Escrow, GenericProxy,
  TestLogic). They're niche; custom contracts can pass artifacts via
  `aztec_registerContract`. Add later if usage warrants.
- **Decimals badge** on UintNote display (was in plan-v3 originally).
  Decided against during PR #31; the brutalist Notes inspector should
  show raw bigint values, not user-friendly token amounts.
- **bb.js-dependent unit tests** for class-id resolution. Same WASM
  flakiness pattern from PR #31 applies — covered manually + by the
  storage-layout gates instead.

## Open questions for the user

1. **Bundle scope**: stick to PrivateFPC + Wonderland NFT, or extend to
   other Wonderland standards (Dripper / Escrow / GenericProxy)? My
   instinct: stay tight (KISS, plan-v3 scope).

2. **Schema verification depth**: should we add ANY runtime test that
   actually computes a class-id (going through bb.js) to verify our
   slot map keys match real artifacts? Trade-off: catches "wrong
   classId stored against slot" mistakes that the storage-layout
   gates can't, but introduces the WASM flakiness from PR #31.
   My instinct: no — the manual QA on a profile with real notes is
   the better signal.
