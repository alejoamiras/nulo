# Three-pronged refactor — plan v2

Date: 2026-04-29
Supersedes: `plan-v1.md`
Audits: `audit-codex.md` (gpt-5.4 xhigh), `audit-plan-agent.md` (Opus 4.7, 1M ctx)

## Headline changes from v1

| Topic | v1 | v2 |
|---|---|---|
| **PR ordering** | PR 1 (registry) → PR 2 (stealth) → PR 3 (notes) | **PR 2 → PR 1 → PR 3** (Plan agent pivot — privacy mass deletion absorbs config edits, leaves PR 1 as runtime-only diff). |
| **PR 2 scope** | Remove Stealth Mode master toggle; keep individual external-services toggles | **Delete the entire Privacy settings page + 3 composables + asset + 13 consumer rewrites** (user directive). |
| **PR 1: artifact safety net** | Implicitly relied on the HTTP registry as fallback | **Tighten `aztec_registerContract` to require artifact** (Plan-agent rec). Document fail-loud error path for the 5 surfaces that today fall back through the registry. |
| **PR 3.B: note-decoding strategy** | "Decode via `artifact.outputs.structs`" — not implementable | **Hand-written per-class slot-to-note-schema map** colocated with `known-artifacts.ts`, decoded via existing `decodeFromAbi` upstream helper. |
| **PR 3.A: bundling decision** | PrivateFPC; Wonderland NFT optional | **Bundle PrivateFPC AND Wonderland NFT** (Plan agent: token-interface parsing fails hard on missing Wonderland NFT artifact). |
| **PR 3.C: decimals rendering** | Format value using `decimals` from artifact | **Punted** — artifact doesn't carry decimals (deployment-time storage). Render raw u128. Decimal-aware rendering is follow-up work via existing `TokenService.getInterface`. |
| **u128 packing** | "Verify across versions" | **Pinned: `u128 = 1 Fr`** at the lockfile. Confirmed in `@aztec/stdlib/src/abi/encoder.ts:158-166`, `decoder.ts:49-58`. |
| **Stealth Mode framing** | "Master toggle + snapshot/restore + promo popup" | **Mostly dead code already** — `showStealthPromo` never set to `true`; `stealthModeSnapshot` field exists but is never written. PR 2 reframed as dead-code cleanup. |
| **Inventory** | 9 stealth files | **+3**: `Header.vue` dead refs; `tests/e2e/wallet-lock.test.ts:24-65`; `CLAUDE.md:180-189` stale docs. |
| **Test strategy** | Thin | **Per-PR rewrite**: PR 1 rewrites `artifact-registry.test.ts` around the 2-source policy + adds explicit "missing artifact fails loud" assertions. PR 3 adds slot-map-vs-artifact invariant test. |

## Final architecture

### PR 2 — Privacy mass deletion (executes FIRST)

**Files deleted:**
- `packages/extension/src/popup/components/popups/StealthPromoPopup.vue`
- `packages/extension/src/popup/pages/settings/privacy/index.vue` (entire route)
- `packages/extension/src/composables/configClient.ts`
- `packages/extension/src/composables/externalLinks.ts`
- `packages/extension/src/composables/externalImage.ts`
- `packages/extension/src/assets/privacy-placeholder.svg`
- `packages/extension/tests/e2e/privacy.test.ts`

**Config fields removed** (from `wallet/config/config.ts`):
- `stealthMode: boolean`
- `stealthModeSnapshot: StealthModeSnapshot | null`
- `hasSeenStealthPromo: boolean`
- `contractRegistry: boolean`
- `uploadExternalImages: boolean`
- `externalLinks: ExternalLinksMode`
- `StealthModeSnapshot` type
- `ExternalLinksMode` type

**Consumer rewrites** (~13 sites): `useExternalLink().handleExternalLink(e, url)` → `window.open(url, "_blank", "noopener,noreferrer")`. Sites: `WarningView.vue`, `discover/index.vue`, `execute/index.vue`, `TransactionCard.vue`, `capabilities/index.vue`, `verify/index.vue`, `connected-apps/index.vue`, `connected-apps/[id].vue`, `tx/[id].vue`, `security/export/key.vue|full.vue|seed.vue`.

**Token-icon consumers**: `useExternalImage().loadExternalImage(url)` → plain `<img :src="url">`. Browser handles caching.

**Other inventoried touch points:**
- `pages/register.vue:24-26,52-54,106-111` — strip `showStealthPromo` ref + dead handler.
- `pages/profile/new.vue:63-68` — strip `cacheStore.privacySettings` write + `hasSeenStealthPromo` flip.
- `components/Header.vue:33-37,128-143,192-195,212-255` — strip dead `stealthMode` ref + handler.
- `components/popups/PopupManager.vue` — drop import + render of `StealthPromoPopup`.
- `stores/cache.store.ts` — drop `privacySettings` ref.
- `popup/pages/settings/index.vue` — drop the "Privacy" entry.
- `tests/e2e/wallet-lock.test.ts:24-65` — strip stealth-related test cases.
- `CLAUDE.md:180-189` — strip "Privacy/Stealth Mode" doc section.

**Settings index entry removed**: the route push to `/popup/settings/privacy`.

**Acceptance criteria:**
- `bun run typecheck` clean — no orphan references to deleted symbols.
- Grep for `stealthMode`, `contractRegistry`, `uploadExternalImages`, `externalLinks` (case-insensitive) returns zero hits in `src/` and `tests/e2e/`.
- Build clean.

### PR 1 — Drop HTTP artifact registry + tighten `aztec_registerContract`

**Runtime-only diff** (PR 2 already deleted the config field).

**Files touched:**

`packages/aztec-runtime/src/pxe/artifact-registry.ts`:
- Drop `HttpRegistryFetcher` class.
- Drop `RegistryFetcher` interface.
- Drop the `"registry"` branch in `ArtifactSource` union and `ArtifactPolicy.order` default.
- Drop `allowRegistry` flag from `ArtifactPolicy`.
- Drop `IConfigReader` injection + `onConfigUpdate` handler.
- Drop the `URL` constants for testnet/devnet aztec-registry.
- Default policy becomes `["pxe-local", "known"]`.
- Keep M4.3 class-id verification + `verifiedClassIds` cache (still useful for pxe-local).
- Update doc comments — drop registry references.

`packages/aztec-runtime/src/pxe/index.ts`: drop `HttpRegistryFetcher` and `RegistryFetcher` from exports.

`packages/aztec-runtime/src/pxe/service.ts:80-86,132-134`: drop `HttpRegistryFetcher` instantiation; drop the `init()` reconciliation of `contractRegistry` config (field no longer exists post-PR-2).

`packages/wallet-bridge/src/operation.ts:152-157`: change `artifact?: ContractArtifact` to **required** in `AztecRegisterContractOperation`.

`packages/wallet-bridge/src/dispatcher.ts:644-650`: dispatcher no longer accepts missing artifact. Surface explicit error: `"aztec_registerContract requires artifact"`.

`packages/extension/src/popup/windows/execute/index.vue:763-771`: rendering of artifact name becomes unconditional (artifact is now guaranteed when register-contract op reaches the approval window).

**Documented fail-loud error paths** (no behavior change to error semantics, but plan now documents them as intentional):

| Surface | File:line | Behavior post-PR-1 |
|---|---|---|
| Token-interface parsing | `token/service.ts:240-256,325-341` | Throws `"Contract artifact not found for class ${classId}"` — propagates to add-token flow as failure toast |
| Manual FPC add-by-address | `fpc/service.ts:191-206` | Same throw — propagates to add-FPC popup as failure |
| `ContractResolver.resolveArtifact` | `execution/contract-resolver.ts:101-107` | Same throw — propagates to dApp tx simulation failure |
| Account-state backup | `account-state/service.ts:156-169` | Silently skips contract (existing behavior — kept) |
| Notes parsing | `note/service.ts` | Falls back to `rawContent` (per-note try/catch) |

**Tests** (rewrite `packages/extension/src/wallet/services/pxe/artifact-registry.test.ts`):
- Default order is `["pxe-local", "known"]`.
- `pxeOnly=true` skips known.
- `byClassId` pin still works for "known".
- Class-id verification still applies to pxe-local artifacts.
- Cache (`verifiedClassIds`) clears on `clear()`.
- New: `aztec_registerContract` with missing artifact rejects.
- New: `ContractResolver.resolveArtifact` with class-id not in known + not in PXE throws the verbatim error string.

### PR 3 — Note parsing with hand-written slot map

#### 3.A — Bundle missing artifacts

`packages/aztec-runtime/src/pxe/known-artifacts.ts`:
- Add `PrivateFPC` from `@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json` (already imported via Vite alias for runtime use; just register in the known map).
- Add `Wonderland NFT` from `@defi-wonderland/aztec-standards/target/nft_contract-NFT.json`.

#### 3.B — Per-class slot map + parser

**New file**: `packages/aztec-runtime/src/pxe/note-schemas.ts`:

```ts
import type { AbiType } from "@aztec/stdlib/abi"

export type NoteSchema = {
  typeName: string
  /** Storage location name from the artifact (e.g., "balances"). Used for UI display. */
  location: string
  /** Per-field ABI types. Decoded via decodeFromAbi(abi, items). */
  abi: AbiType[]
}

/** classId → { storageSlotHex → NoteSchema } */
export const NOTE_SCHEMAS: Map<string, Record<string, NoteSchema>> = new Map([
  // Aztec Token: balances slot → TokenNote
  // Wonderland Token: balances slot → UintNote
  // PrivateFPC: balances slot → UintNote
  // Aztec NFT, Wonderland NFT: per-NFT slots
  // (filled in during execution; placeholder shape)
])
```

**Refactor** `packages/extension/src/wallet/services/note/service.ts`:

```ts
private async parseNote(network: Network, note: NoteDao): Promise<Note> {
  // Resolve class id of the contract
  const instance = await this.pxeService.getContractInstance(...)
  if (!instance) return rawFallback(note)

  const classId = instance.currentContractClassId.toString()
  const schemas = NOTE_SCHEMAS.get(classId)
  if (!schemas) return rawFallback(note)

  const slotKey = note.storageSlot.toString()
  const schema = schemas[slotKey]
  if (!schema) return rawFallback(note)

  // Decode via upstream helper
  const decoded = decodeFromAbi(schema.abi, note.note.items)
  return {
    ...rawShape,
    type: schema.typeName,
    location: schema.location,
    content: flattenForDisplay(decoded),
  }
}
```

**Per-note try/catch invariant preserved** — single bad note can't blank the page (existing test at `note/service.test.ts:82-135` stays).

#### 3.C — UI: render decoded notes

UI is already wired for `displayNote.content` and `displayNote.type`. Once the parser populates them, decoded notes render. **Decimals scope-cut**: render `u128` value as raw integer; decimal-aware rendering is a follow-up using existing `TokenService.getInterface` machinery.

**Tests** (extend `note/service.test.ts`):
- Aztec TokenNote decode → `{type: "TokenNote", location: "balances", content: {amount, owner, randomness}}`.
- Wonderland UintNote decode → similar.
- PrivateFPC note decode (post-3.A bundle).
- Unknown class-id → falls back to `rawContent`, no throw.
- **Slot-map invariant test**: assert each NOTE_SCHEMAS entry's slot exists in the corresponding artifact's `storageLayout` — so a future artifact-version bump that renumbers slots breaks loud, not silent.
- Per-note isolation invariant retained.

## Execution order

1. **PR 2** — Privacy mass deletion. Largest deletion. Establishes the simplified config base.
2. **PR 1** — Registry deletion + `aztec_registerContract` tightening. Runtime-only on PR-2 base.
3. **PR 3** — Note parsing with hand-written slot map. Requires PR 1's clean ArtifactRegistry.

Each PR is independently mergeable. Suggested merge cadence: PR 2 → master → manual smoke → PR 1 → master → manual smoke → PR 3 → master.

## Risks (consolidated)

1. **Unbundled contracts hard-fail post-PR-1.** Fail-loud is the intended UX (no privacy leak via registry phone-home). Documented per-surface in PR 1 acceptance criteria.

2. **Wonderland Standards version drift.** Bundling artifacts pins the class-id at install time. If Wonderland publishes a new version with different class-id, deployed contracts using the new version won't resolve to the bundled artifact. Mitigation: existing dependency-bump cadence catches this; CI test asserts the bundled class-id matches Wonderland package's deployed version.

3. **Aztec nightly artifact schema change.** If a future nightly changes the slot numbering or the storage shape of a bundled contract, the slot-map test fires loud — which is the intended behavior.

4. **u128 ABI shape change.** Pinned at lockfile (1 field). If upstream changes packing (unlikely for a primitive integer type), parser tests break loud.

5. **Tests for surfaces that the registry was masking.** Token-interface parsing, manual FPC add, contract-resolver tests may have implicitly relied on the registry returning artifacts. Review and update.

6. **Privacy expansion is purely deletion** — no behavior-change risk beyond the deletion itself.

## Open questions for the next audit round

1. **Tightening `aztec_registerContract`** — Plan-agent recommends requiring `artifact` outright (option A). Codex offered option A or option B (manual paste). Pre-launch wallet, no production dApps yet. Confirming Plan-agent's strict choice. **OK?**

2. **Wonderland NFT bundling** — Plan-agent recommends "bundle now to avoid silent token-interface failures." Codex left it open. Confirming "bundle." **OK?**

3. **Decimals rendering on notes page** — Plan-agent recommends punting to a follow-up. Plan-v1 had it in scope. Confirming "out of scope for this branch." **OK?**

4. **Note schemas — known shape today vs evolving** — the hand-written `NOTE_SCHEMAS` map starts with: Aztec Token (TokenNote), Wonderland Token (UintNote), Wonderland NFT, Aztec NFT, PrivateFPC. Anything else worth adding for completeness? FPC (Default), SponsoredFPC — do those store notes the user would see, or are they wallet-internal infra contracts?

5. **PR sequencing** — three PRs, sequential merges, each with manual QA. Or parallel-development with sequenced merges?

6. **Wallet-sdk type sync** — tightening `aztec_registerContract` to require `artifact` is a wire change. We need to publish a wallet-sdk update too. Is that an issue?
