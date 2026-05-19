# Three-pronged refactor — plan v3 (final pre-execution)

Date: 2026-04-29
Supersedes: `plan-v2.md`
Audit trail: `audit-codex.md` (R1), `audit-plan-agent.md` (R1), `audit-codex-r2.md`, `audit-plan-agent-r2.md`

## Headline changes from v2

| Topic | v2 | v3 |
|---|---|---|
| **Slot dispatch (Plan agent vs codex conflict)** | Sketched as `classId → storageSlotHex → schema`; Plan agent R2 said this breaks for Map-stored notes | **Confirmed correct via codex R2's empirical artifact inspection** — bundled contracts use `BalanceSet<Context>` / `PrivateSet<NFTNote>`, not `Map<Address, ...>`. Notes ARE at base slots. Dispatch shape preserved. |
| **Note schema details** | "TokenNote with `{amount, owner, randomness}` from `decodeFromAbi`" | **Wrong**. Codex R2 inspected actual artifacts: notes use `UintNote { value: u128 }` (Aztec Token, Wonderland Token, PrivateFPC) and `NFTNote { token_id }` (Aztec NFT, Wonderland NFT). `decodeFromAbi` only decodes packed note items — `owner` + `randomness` live as side-channel fields on `NoteDao`, NOT in items. |
| **Bundled slots (concrete)** | Vague | Aztec Token `balances=0x03`, Wonderland Token `private_balances=0x07`, PrivateFPC `balances=0x01`, Aztec NFT `private_nfts=0x07`, Wonderland NFT `private_nfts=0x05`. Verified via codex R2. |
| **PR 1 missing file** | Listed `dispatcher.ts` + `operation.ts` for `aztec_registerContract` tightening | **Add `execution/service.ts:1495-1513`** — executor still has fallback that parses `op.artifact` as optional. Plus `playground/src/sections/contracts.ts:83-92` (caller passes no artifact today) + `tests/e2e/network/contracts-register.test.ts:10-65` (e2e exercises the silent path). |
| **Wallet-sdk divergence** | Listed as open question | **Decision**: intentional divergence from upstream `@aztec/wallet-sdk` (which keeps `artifact?` optional). Pre-launch, no production dApps. Document in `CLAUDE.md` + commit message. |
| **PR 3 bundler plumbing** | Missing | **Add to PR 3**: re-export `note-schemas.ts` from `aztec-runtime/src/pxe/index.ts`; add Wonderland NFT alias in `extension/vite.config.ts` + `vitest.config.ts` (mirroring PrivateFPC + Wonderland Token aliases). |
| **Slot-map invariant test** | Asserts slot exists | **Stronger**: assert slot exists AND `schema.location` matches the artifact's storageLayout key for that slot. |
| **Error normalization** | Open | **Shared formatter helper**, not new error class. ~15 LoC: `formatArtifactNotFoundError(classId)` returning `"Contract artifact not found for class ${classId}"`. Used by token/service, fpc/service, contract-resolver, executor. |
| **Decimals on notes UI** | Punt entirely | **Hardcode `decimals: 18`** with documented assumption (correct for every Aztec/Wonderland token in our bundled set). Display value as human-readable balance + a small `(unverified decimals)` badge. Follow-up: read decimals via `TokenService.getInterface`. |
| **PXE config plumbing dead code** | Mentioned removal of registry instantiation | **Add explicit removal**: `PxeService` no longer needs `IPxeConfig` for the registry; drop the constructor optimistic-allow-registry seed + the init-time reconciliation. |

## Final architecture

### PR 2 — Privacy mass deletion (executes FIRST)

**Files deleted:**
- `popup/components/popups/StealthPromoPopup.vue`
- `popup/pages/settings/privacy/index.vue` (entire route)
- `composables/configClient.ts`
- `composables/externalLinks.ts`
- `composables/externalImage.ts`
- `assets/privacy-placeholder.svg`
- `tests/e2e/privacy.test.ts`

**Config fields/types removed** (`wallet/config/config.ts`):
- `stealthMode`, `stealthModeSnapshot`, `hasSeenStealthPromo`, `contractRegistry`, `uploadExternalImages`, `externalLinks`
- `StealthModeSnapshot`, `ExternalLinksMode`

**Consumer rewrites** (~13 sites): `useExternalLink().handleExternalLink(e, url)` → `window.open(url, "_blank", "noopener,noreferrer")`. Sites: `WarningView.vue`, `discover/index.vue`, `execute/index.vue`, `TransactionCard.vue`, `capabilities/index.vue`, `verify/index.vue`, `connected-apps/index.vue`, `connected-apps/[id].vue`, `tx/[id].vue`, `security/export/key.vue|full.vue|seed.vue`.

**Token-icon consumers**: `useExternalImage().loadExternalImage(url)` → plain `<img :src="url">`.

**Other touch points:**
- `pages/register.vue:24-26,52-54,106-111` — strip dead `showStealthPromo` ref + handler.
- `pages/profile/new.vue:63-68` — strip `cacheStore.privacySettings` write + `hasSeenStealthPromo` flip.
- `components/Header.vue:33-37,128-143,192-195,212-255` — strip dead `stealthMode` ref + handler.
- `components/popups/PopupManager.vue` — drop `StealthPromoPopup` import + render.
- `stores/cache.store.ts` — drop `privacySettings` ref.
- `popup/pages/settings/index.vue` — drop "Privacy" entry + route.
- `tests/e2e/wallet-lock.test.ts:24-65` — strip stealth-related test cases.
- `CLAUDE.md:180-189` — strip stale Privacy/Stealth doc section.

**Acceptance criteria:**
- `bun run typecheck` clean.
- Grep for `stealthMode`/`contractRegistry`/`uploadExternalImages`/`externalLinks` (case-insensitive) → 0 hits in `src/` + `tests/e2e/`.
- Build clean.

### PR 1 — Drop HTTP artifact registry + tighten `aztec_registerContract`

Runtime-only diff (PR 2 already deleted config fields).

**Files touched:**

`packages/aztec-runtime/src/pxe/artifact-registry.ts`:
- Drop `HttpRegistryFetcher` class + `RegistryFetcher` interface.
- Drop `"registry"` source from `ArtifactSource` union and `ArtifactPolicy.order` default.
- Drop `allowRegistry` flag from `ArtifactPolicy`.
- Drop `IConfigReader` injection + `onConfigUpdate` handler.
- Drop testnet/devnet `aztec-registry.xyz` URL constants.
- Default policy → `["pxe-local", "known"]`.
- Keep M4.3 class-id verification + `verifiedClassIds` cache (still useful for pxe-local).

`packages/aztec-runtime/src/pxe/index.ts`: drop `HttpRegistryFetcher` and `RegistryFetcher` exports.

`packages/aztec-runtime/src/pxe/service.ts:54-86,125-135`:
- Drop `HttpRegistryFetcher` instantiation.
- Drop `IPxeConfig`-flavored `contractRegistry` reconciliation in `init()`.
- Constructor signature simplified: `ArtifactRegistry` no longer takes `config` parameter.
- Offscreen bootstrap (`offscreen/entry.ts`) and extension shell (`offscreen/index.ts`) still threading `ConfigServiceClient` keep doing so for OTHER config keys, but the registry-specific seam is gone.

`packages/wallet-bridge/src/operation.ts:152-157`: change `artifact?: ContractArtifact` → required in `AztecRegisterContractOperation`.

`packages/wallet-bridge/src/dispatcher.ts:644-650`: dispatcher rejects requests without `artifact` with explicit error: `"aztec_registerContract requires artifact"`.

`packages/extension/src/wallet/services/execution/service.ts:1495-1513`: drop the fallback path that calls `pxeService.getContractArtifact(...)` when `op.artifact` is missing. Post-tightening at the operation level, this fallback is dead — delete it.

`packages/extension/src/popup/windows/execute/index.vue:763-771`: rendering of artifact name becomes unconditional (artifact is now guaranteed when register-contract op reaches the approval window).

`packages/playground/src/sections/contracts.ts:83-92`: pass artifact to the `wallet.registerContract(instance, artifact)` call. Playground already has the artifact locally.

`packages/extension/tests/e2e/network/contracts-register.test.ts:10-65`: update test to pass artifact JSON OR rewrite to assert deterministic rejection when artifact missing.

**Shared error formatter** (new helper at `packages/extension/src/wallet/utils/artifact-error.ts`):

```ts
export function formatArtifactNotFoundError(classId: string): string {
  return `Contract artifact not found for class ${classId}`
}
```

Used by:
- `wallet/services/token/service.ts:245-248,330-333` (currently lowercase, no class id)
- `wallet/services/fpc/service.ts:196-199` (currently capitalized, no class id)
- `wallet/services/execution/contract-resolver.ts:98-105` (already has the format string)
- `wallet/services/execution/service.ts` register-contract fallback (deleted, no replacement)

After PR 1, all 4 surfaces throw the SAME formatted string, so toast UX is consistent.

**Documented fail-loud surfaces** (no behavior change, just intentional documentation):

| Surface | File:line | Behavior post-PR-1 |
|---|---|---|
| `aztec_registerContract` (dApp call) | `dispatcher.ts:644-650` | Rejected: `"aztec_registerContract requires artifact"` |
| Token-interface parsing | `token/service.ts:240-256,325-341` | Throws via shared formatter |
| Manual FPC add-by-address | `fpc/service.ts:191-206` | Throws via shared formatter |
| `ContractResolver.resolveArtifact` | `execution/contract-resolver.ts:98-105` | Throws via shared formatter |
| Account-state backup | `account-state/service.ts:156-169` | Silently skips contract (existing behavior — kept) |
| Notes parsing | `note/service.ts` | Falls back to `rawContent` (per-note try/catch) |

**Wallet-sdk divergence note**: `@aztec/wallet-sdk`'s `Wallet.registerContract(instance, artifact?, secretKey?)` keeps `artifact` optional. Nulo intentionally diverges. Pre-launch, no production dApps yet. Document in `CLAUDE.md` (under "wallet bridge contract") and the PR 1 commit message.

**Tests** (rewrite `packages/extension/src/wallet/services/pxe/artifact-registry.test.ts`):
- Default order is `["pxe-local", "known"]`.
- `pxeOnly=true` skips known.
- `byClassId` pin still works for "known".
- Class-id verification still applies to pxe-local artifacts.
- Cache (`verifiedClassIds`) clears on `clear()`.
- New: `aztec_registerContract` with missing artifact rejects.
- Drop `makeConfig` helper (config seam gone). Keep `passthroughVerifier`, `makeMismatchVerifier`, `makeRecordingVerifier`, `emptyLoader`.
- Move contract-resolver miss case to existing `contract-resolver.test.ts:140-155`.

### PR 3 — Note parsing with hand-written slot map

#### 3.A — Bundle missing artifacts + alias plumbing

`packages/aztec-runtime/src/pxe/known-artifacts.ts`:
- Add `PrivateFPC` from `@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json` (already imported via `@private-fpc-artifact` alias for runtime — just register in known map).
- Add `Wonderland NFT` from `@defi-wonderland/aztec-standards/target/nft_contract-NFT.json`.

**Vite/Vitest aliases** (codex R2 finding):
- `extension/vite.config.ts:40-49`: add `@wonderland-nft-artifact` alias mirroring existing PrivateFPC + Wonderland Token aliases.
- `extension/vitest.config.ts:36-44`: same.

#### 3.B — Per-class slot map + parser

**New file**: `packages/aztec-runtime/src/pxe/note-schemas.ts`:

```ts
import type { AbiType } from "@aztec/stdlib/abi"

export type NoteSchema = {
  /** Display name shown in UI (e.g., "UintNote"). */
  typeName: string
  /** Storage location name from the artifact (e.g., "private_balances"). */
  location: string
  /** Per-field ABI types for the PACKED note items.
   *  Decoded via decodeFromAbi(abi, items). owner/randomness/etc come from
   *  NoteDao side-channel, not from items. */
  abi: AbiType[]
}

const U128: AbiType = { kind: "integer", sign: false, width: 128 }
const FIELD: AbiType = { kind: "field" }

const UINT_NOTE_ABI: AbiType[] = [U128]
const NFT_NOTE_ABI: AbiType[] = [FIELD]

/** classId → { baseSlotHex → NoteSchema } */
export const NOTE_SCHEMAS: Map<string, Record<string, NoteSchema>> = new Map([
  // Class IDs derived at load time via getContractClassFromArtifact in known-artifacts.ts.
  // Populate via a small registration helper that takes (artifact, slotEntries).
])
```

**Loading helper** (lives next to `known-artifacts.ts`):

```ts
function registerNoteSchemas(
  classId: string,
  schemas: Record<string, NoteSchema>,
) {
  NOTE_SCHEMAS.set(classId, schemas)
}

// In loadProductionKnownArtifacts(), after each artifact is loaded:
// (Pseudo)
// const aztecTokenClassId = await getContractClassFromArtifact(TokenContractArtifact)
// registerNoteSchemas(aztecTokenClassId.id.toString(), {
//   "0x0000...0003": { typeName: "UintNote", location: "balances", abi: UINT_NOTE_ABI },
// })
// ... etc for Wonderland Token (slot 0x07), PrivateFPC (slot 0x01), Aztec NFT (slot 0x07), Wonderland NFT (slot 0x05)
```

**Refactor** `packages/extension/src/wallet/services/note/service.ts`:

```ts
private async parseNote(network: Network, note: NoteDao): Promise<Note> {
  const baseShape = {
    contract: note.contractAddress.toString(),
    storageSlot: note.storageSlot.toString(),
    txHash: note.txHash.toString(),
    rawContent: note.note.items.map((x) => x.toString()),
  }

  // Resolve class id of the contract via PXE
  const instance = await this.pxeService.getContractInstance(...)
  if (!instance) return baseShape

  const classId = instance.currentContractClassId.toString()
  const schemas = NOTE_SCHEMAS.get(classId)
  if (!schemas) return baseShape

  const slotKey = note.storageSlot.toString()
  const schema = schemas[slotKey]
  if (!schema) return baseShape

  // Decode packed items via upstream helper
  const decoded = decodeFromAbi(schema.abi, note.note.items)
  const content = flattenForDisplay(decoded, schema)

  // Append owner + randomness from NoteDao side-channel
  content.owner = note.owner.toString()
  content.randomness = note.randomness.toString()

  return {
    ...baseShape,
    type: schema.typeName,
    location: schema.location,
    content,
  }
}
```

**Per-note try/catch invariant preserved** — single bad note can't blank the page (existing test at `note/service.test.ts:82-135` stays).

#### 3.C — UI: render decoded notes with hardcoded decimals

UI is already wired for `displayNote.content` and `displayNote.type`. Once parser populates them, decoded notes render.

**Decimals heuristic** (`packages/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:148-155`):
- For `UintNote` notes, divide `value` by `10^18` and render with thousands separators.
- Add a small `(unverified decimals)` badge or tooltip noting the assumption.
- TODO comment pointing to the `TokenService.getInterface` follow-up.

**Allowlist update**: extend the displayed-keys allowlist to include `value`, `token_id`, `owner`, `randomness`.

**Tests** (extend `note/service.test.ts`):
- Aztec Token UintNote decode → `{type: "UintNote", location: "balances", content: {value, owner, randomness}}`.
- Wonderland Token UintNote decode (slot 0x07).
- PrivateFPC UintNote decode (slot 0x01).
- Aztec NFT NFTNote decode → `{type: "NFTNote", location: "private_nfts", content: {token_id, owner, randomness}}`.
- Wonderland NFT NFTNote decode (slot 0x05).
- Unknown class-id → falls back to `rawContent`, no throw.
- **Slot-map invariant test**: each `NOTE_SCHEMAS` entry's slot must exist in the corresponding artifact's `storageLayout` AND the artifact's storageLayout key for that slot must equal `schema.location`.
- Per-note isolation invariant retained.

## Execution order

1. **PR 2** — Privacy mass deletion (largest deletion, simplest). Establishes simplified config base.
2. **PR 1** — Registry deletion + `aztec_registerContract` tightening + shared error formatter + `aztec-registry.xyz` URL deletion. Runtime-only on PR-2 base.
3. **PR 3** — Note parsing with `NOTE_SCHEMAS` + bundler plumbing + decimals heuristic.

PR 1 has a hard dependency: must include playground caller fix + e2e test fix in the SAME commit (Plan agent S6 + codex B1).

## Risks (consolidated)

1. **Unbundled contracts hard-fail post-PR-1.** Fail-loud is the intended UX. Documented per-surface.
2. **Wonderland Standards version drift.** Bundling pins class-id at install time. CI test asserts bundled class-id matches deployed.
3. **Aztec nightly artifact schema change.** Slot-map invariant test fires loud.
4. **u128 ABI shape change.** Pinned at lockfile (1 field). Tests break loud if upstream changes.
5. **vitest jsdom artifact loading.** First test in PR 3 should be a smoke-test (`loadContractArtifact + getContractClassFromArtifact`). If poseidon needs a polyfill in jsdom, surface early.
6. **Wallet-sdk divergence.** Intentional. Documented.
7. **Decimals heuristic.** Hardcoded 18 is correct for our bundled set today. Wrong if a future bundled token uses different decimals — slot-map test won't catch this. Risk accepted; follow-up to read decimals via `TokenService`.
8. **Privacy expansion is purely deletion** — no behavior-change risk beyond the deletion.

## Decision questions for user

These are the remaining open choices before execution. Defaults proposed; you can override.

1. **Tighten `aztec_registerContract` to require `artifact`** (Plan agent + codex agree). Pre-launch, no production dApps. Intentional divergence from upstream `@aztec/wallet-sdk`. **Default: yes, tighten + document divergence.**

2. **Wonderland NFT bundling**: Plan agent + codex both recommend. **Default: yes, bundle.**

3. **Decimals on notes UI**: hardcode 18 with `(unverified decimals)` badge. Codex flagged the rendering is half-done without it. **Default: hardcode + badge + follow-up TODO.**

4. **Note display fields**: `value` (or `token_id`) decoded from items + `owner` + `randomness` appended from NoteDao. Codex caught that decodeFromAbi alone won't include the side-channel fields. **Default: include all four for debug UX value.**

5. **Shared error formatter** (one helper used by 4 sites) vs new `ContractArtifactUnavailableError` class. Codex says formatter is enough; Plan agent suggested the class. **Default: shared formatter — lighter touch.**

6. **PR ordering**: PR 2 → PR 1 → PR 3. **Default: confirm.**
