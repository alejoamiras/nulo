# Three-pronged refactor: drop HTTP artifact registry + remove Stealth Mode + improve note parsing

Date: 2026-04-29
Branches: TBD (one per workstream — see "Execution order" below)
Status: DRAFT — awaiting dual-audit (codex xhigh + Plan agent) before execution.

## Context

Three intertwined topics surfaced together:

1. **HTTP artifact registry**: a legacy-team-operated external service. The wallet phones home to `https://testnet.aztec-registry.xyz` / `https://devnet.aztec-registry.xyz` to fetch unknown contract artifacts. This is the privacy concern.

2. **Stealth Mode**: a master kill-switch UX layer that bundles three external-service flags (`contractRegistry`, `uploadExternalImages`, `externalLinks`) under a single toggle, with snapshot/restore + a promo popup on first profile creation. Inherited from the legacy wallet.

3. **Note parsing**: the `NoteService.parseNote()` method is functionally a no-op — it returns raw `note.items` field elements as strings. The UI is wired for richer output (`displayNote.content`, `displayNote.type`) but the parser never populates them. Notes today render as hex blobs.

The user wants:
- Remove the external HTTP registry entirely
- Remove Stealth Mode (the master toggle)
- Actually parse notes properly, using the artifacts the wallet ALREADY bundles

## Investigation findings

### What the HTTP artifact registry does today

`packages/aztec-runtime/src/pxe/artifact-registry.ts`:

- `HttpRegistryFetcher` fetches `${url}/api/artifacts/${classId}` for unknown class IDs.
- URL switch: testnet chainId → `testnet.aztec-registry.xyz`; devnet chainId → `devnet.aztec-registry.xyz`. Other chains → no fetch.
- Resolution policy walks: `["pxe-local", "known", "registry"]`.
- Class-id verification (M4.3) recomputes Poseidon hash on registry-returned artifacts before trusting them.
- `config.contractRegistry` toggle gates the registry source globally.

Used at: `PxeService.getContractArtifact()` (which is hit by note parsing, contract-resolver, fee-strategy authwit discovery, etc.).

### What we already bundle in `known-artifacts.ts`

```
Protocol contracts:    AuthRegistry, ContractClassRegistry, FeeJuice,
                       ContractInstanceRegistry, MultiCallEntrypoint,
                       PublicChecks
Aztec Noir Contracts:  FPC (DefaultFpc), NFT, SponsoredFPC, Token (Aztec)
Wonderland:            Token (Wonderland aztec-standards)
```

**Notable absences**:
- `PrivateFPC` — exists at `@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json`. NOT bundled.
- Wonderland NFT — exists at `@defi-wonderland/aztec-standards/target/nft_contract-NFT.json`. NOT bundled (we only have Aztec's NFT).
- Dripper, GenericProxy, TestLogic, etc. — likely not user-facing for our wallet.

So the user's concern "we use Aztec's Token, should use Wonderland's" is partially right: **we bundle BOTH**, and ArtifactRegistry resolves by class id — so a contract deployed with Wonderland's Token class hits the Wonderland artifact, and one deployed with Aztec's Token hits Aztec's. But neither would help if the user has private fee juice notes — PrivateFPC isn't bundled, so PrivateFPC notes would today fall back to the registry (or fail if registry is off).

### What `parseNote` does today (`extension/src/wallet/services/note/service.ts:104`)

```ts
private async parseNote(_network: Network, note: NoteDao): Promise<Note> {
  return {
    contract: note.contractAddress.toString(),
    storageSlot: note.storageSlot.toString(),
    txHash: note.txHash.toString(),
    rawContent: note.note.items.map((x) => x.toString()),
  }
}
```

That's literally the entire parser. No artifact lookup. No type detection. No field decoding. The `Note` type has spec'd fields `type`, `location`, `content` that the parser never sets — they're left undefined and the UI falls back to rendering `rawContent` as hex strings.

Note: `_network: Network` is even unused (prefixed underscore). Confirmation: nothing is being parsed.

### What Stealth Mode controls today

`config.stealthMode` toggles 3 flags as a group, with snapshot/restore:
- `contractRegistry` (will be removed in PR1)
- `uploadExternalImages` (token icons)
- `externalLinks` (explorer / help link behavior)

Plus:
- `hasSeenStealthPromo` (first-profile-creation promo popup gate)
- `StealthPromoPopup.vue` (the promo popup itself)
- Header indicator (visual cue that stealth is on)
- 9 files touched

### What `NoteDao` actually carries (verified from `@aztec/stdlib` types)

```
note: Note (packed items)        ← the field elements
contractAddress: AztecAddress
owner: AztecAddress              ← who can spend
storageSlot: Fr                  ← storage layout key
randomness: Fr
noteNonce: Fr
noteHash: Fr
siloedNullifier: Fr
txHash, l2BlockNumber, txIndexInBlock, noteIndexInTx
```

There's NO `noteTypeId` directly on the DAO. Type dispatch happens via storage slot + the artifact's storage layout / notes definitions. The artifact carries enough metadata to decode (in principle); the parser just never uses it.

---

## Proposed scope

Three separate PRs, executed in the order:

### PR 1 — Drop HTTP artifact registry (legacy external dep)

**Scope:**

Remove the "registry" source from ArtifactRegistry entirely. Resolution becomes pxe-local → known. Drop the HTTP fetcher class, the URL constants, the policy `allowRegistry` flag.

**Files touched:**

- `packages/aztec-runtime/src/pxe/artifact-registry.ts` — drop `HttpRegistryFetcher`, `RegistryFetcher` interface, `"registry"` source. Simplify `ArtifactPolicy` (no `allowRegistry`). Remove `onConfigUpdate` subscription.
- `packages/aztec-runtime/src/pxe/index.ts` — drop the exports.
- `packages/aztec-runtime/src/pxe/service.ts` — drop the constructor `HttpRegistryFetcher` instantiation. Drop the `init()` reconciliation of `contractRegistry` config value (no longer exists).
- `packages/extension/src/wallet/config/config.ts` — drop `contractRegistry` field. Drop `contractRegistry` from `StealthModeSnapshot` type.
- `packages/extension/src/popup/pages/settings/privacy/index.vue` — remove the "Contract Registry" toggle.
- `packages/extension/src/wallet/services/pxe/artifact-registry.test.ts` — drop registry-source tests; keep pxe-local + known.

**What stays:**

- `ArtifactRegistry` class itself (still resolves pxe-local + known)
- `KnownArtifacts` map and the bundled artifacts
- M4.3 class-id verification (still applied to pxe-local)
- `verifiedClassIds` cache

**Risk:** A contract that's not bundled and not yet registered with PXE can't be resolved at all post-change. Today the registry was the safety net. Mitigation:
- The dApp surface already calls `aztec_registerContract` to push artifacts into PXE (`dapp-interaction/service.ts`). Most contracts get registered through this normal path.
- For tx history of notes from contracts the user never explicitly registered (e.g. someone sent them a token from a brand-new contract), parsing would fall back to raw items — same as today when the registry path returns 404.

### PR 2 — Remove Stealth Mode

**Scope:**

Drop the master toggle, snapshot/restore logic, promo popup, and onboarding integration. Keep the individual external-services toggles (`uploadExternalImages`, `externalLinks`) — they remain user-controllable, just not bundled under "Stealth Mode."

**Files touched:**

- `packages/extension/src/wallet/config/config.ts` — drop `stealthMode`, `stealthModeSnapshot`, `hasSeenStealthPromo` fields and the `StealthModeSnapshot` type.
- `packages/extension/src/popup/components/popups/StealthPromoPopup.vue` — delete file.
- `packages/extension/src/popup/components/popups/PopupManager.vue` — drop the import + render.
- `packages/extension/src/popup/pages/register.vue` — drop the promo trigger (post-first-profile).
- `packages/extension/src/popup/pages/profile/new.vue` — drop the promo trigger.
- `packages/extension/src/popup/pages/settings/privacy/index.vue` — drop master toggle + `enable/disable/exitStealthAndApply` orchestration. Page becomes 2 simple toggles.
- `packages/extension/src/components/Header.vue` — drop the stealth-mode header indicator.
- `packages/extension/src/stores/cache.store.ts` — drop any `stealthMode`-prefixed state.
- `packages/extension/tests/e2e/privacy.test.ts` — remove stealth-specific tests; keep individual-toggle tests.

**Migration**: pre-launch wallet, no users → no migration. Existing dev installs may have `stealthMode: true` persisted but the field will just be ignored at read time (config layer handles unknown keys gracefully).

### PR 3 — Improve note parsing

**Scope:**

Make `NoteService.parseNote` actually parse using the contract artifact. Bundle additional Wonderland artifacts that we're missing. Surface decoded notes in the UI (the UI is already wired — just needs data flowing).

**Sub-tasks:**

#### 3.A — Bundle PrivateFPC artifact in `known-artifacts.ts`

The user's specific concern about "are we using the registered private fee juice artifact" is rooted in this gap. PrivateFPC artifact exists at `@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json`. Add it to the compiled-in list.

Optional: Wonderland NFT (less commonly used; defer unless tests fail without it).

#### 3.B — Parse notes against artifact

Refactor `NoteService.parseNote` to:

1. Resolve the contract's class id from `note.contractAddress` (via PXE's `getContractInstance`).
2. Resolve the artifact via `ArtifactRegistry.resolve(classId, ...)` (now pxe-local + known only).
3. If artifact unavailable → return raw items (today's behavior).
4. If artifact available → decode `note.note.items` against the artifact's note metadata:
   - Find the storage slot's note type assignment from `artifact.storageLayout`.
   - Get the note struct definition from `artifact.outputs.structs` (or the equivalent path — verify exact path during impl).
   - Map `note.items[i]` to named fields by struct order. Handle field types: `Field` → string, `AztecAddress` → trimmed, `u128` → packed across 1 or 2 fields (verify), `u64` → packed.
   - Set `Note.type` (e.g. "UintNote", "TokenNote"), `Note.location` (e.g. "balances"), `Note.content` (the named field map).
5. Wrap each note's parse step in its own try/catch (already done) so a single bad note can't blank the page.

**Field-decoding edge cases:**
- `u128` is packed differently on different versions of Aztec. Check `@aztec/stdlib` for the canonical helper.
- `AztecAddress` is a single field. Should be trimmed via existing `trimAddress` util.
- Custom structs (UintNote: `{ value: u128, owner: AztecAddress, randomness: Field }`) recurse.

#### 3.C — UI: render decoded notes

UI is mostly ready (`buildDisplayNote` already references `note.content`). Verify rendering looks correct after the parser populates `content`. Adjust display logic if needed (e.g. format `value` as a human balance using `decimals` from the contract artifact if it's a token).

**Test plan (PR 3):**
- Unit: `parseNote` against a known TokenNote → returns `{type: "TokenNote", content: {value, owner, randomness}}`.
- Unit: `parseNote` against an unknown contract (no artifact) → returns rawContent fallback (no throw).
- Unit: `parseNote` against PrivateFPC note → decodes correctly post-3.A bundling.
- Integration: real note from a Wonderland Token transfer → UI shows symbol + amount, not hex.

**Risk:**
- The artifact's note-decoding metadata format is non-trivial. May need a helper from `@aztec/stdlib` that we don't currently call. Plan to research during implementation; fall back to "raw items + best-effort field-level decoding" if the artifact doesn't carry enough info.
- Some notes may have unstable `noteTypeId` dispatch (multiple note types in one storage location). Heuristic-based fallback OK if the strict path doesn't work.

---

## Execution order

1. **PR 1** — Drop HTTP registry. Smallest scope, lowest risk. Establishes the simplification we'll lean on in PR 3.
2. **PR 2** — Remove Stealth Mode. Independent of PR 1 except for the `contractRegistry` field removal that PR 1 already did. Mostly UX deletion.
3. **PR 3** — Improve note parsing. Largest scope. Benefits from a clean ArtifactRegistry (no registry side-effect to reason about).

Each is a separate branch/PR. PR 3 may itself be split into 3.A (bundle PrivateFPC), 3.B (parser logic), 3.C (UI polish) commits on the same branch.

## Open questions for review

1. **Are there callers we'd strand by dropping the HTTP registry?** Specifically: dApp transaction approval window today — when a dApp tries to push a contract via `aztec_registerContract`, does the wallet rely on the registry to resolve the class id? Or does the dApp always supply the artifact directly? If always direct, we're safe. Need to verify in audit.

2. **Is `PrivateFPC` artifact actually used at runtime today?** If yes, where does it come from? PXE-local (registered by the wallet at fee-payment setup), the registry (HTTP), or compiled-in elsewhere I missed? If pxe-local, no behavior change in PR 1 for fee-payment flows; if registry, we need to bundle it.

3. **Note-decoding metadata path**: should we use a helper from `@aztec/stdlib` (if one exists for note-decoding from artifact + storage slot), or roll our own field-by-field decoder? Audit should look for existing helpers.

4. **Stealth Mode UX positioning**: should the privacy settings page get a quick rename / restructure to make the individual toggles more legible after the master is gone? Or leave it as-is? Open to feedback.

5. **Should we ALSO remove the `aztec-registry-test.xyz` URL hardcoded reference** if it's unused outside `HttpRegistryFetcher`? Or are there other code paths that hit it?

6. **`hasSeenStealthPromo` flag**: any other code reads this besides the popup itself? If yes, we need to update those readers. Audit should grep.

7. **Migration / cleanup**: pre-launch wallet, no users yet. Storage-version policy is wipe + reseed. Are existing dev profiles with `stealthMode: true` persisted going to cause any UI confusion until they wipe? Probably no — the field is just ignored. Confirm.

8. **Should the note parser fall back to a heuristic if artifact has no usable note metadata** (e.g., guess "looks like a TokenNote because it has 3 fields and the second is address-shaped")? Codex audit should weigh in on whether heuristics are worth the complexity vs. just showing rawContent.

## Risks (consolidated)

1. **Unbundled contracts can no longer be auto-resolved**. Previously the registry was the safety net for unknown class-ids. Post-PR-1, unbundled + un-registered contracts return undefined. UI surfaces fall back to "unknown contract" / raw items.

2. **Stealth Mode users lose the master toggle**. They can still flip the 2 remaining individual settings. Pre-launch impact: minimal.

3. **Note parsing complexity**. Aztec's artifact metadata format is evolving. We pin a Aztec nightly version; any change to the artifact schema breaks the parser. Mitigation: try/catch per-note + fall back to rawContent.

4. **Multi-network artifact caching**. PR 1 doesn't change the per-class-id verifiedClassIds cache; works the same.

5. **Tests**: PR 1's `artifact-registry.test.ts` has registry-source coverage that needs to be deleted. PR 3 introduces new tests against bundled artifacts.

6. **Codex / AI training fingerprint**: removing the registry signals "we don't trust the legacy wallet" — worth being explicit in commit message about the privacy rationale.
