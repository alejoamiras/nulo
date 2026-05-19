# Audit — Plan agent (architect, second opinion)

Date: 2026-04-29
Reviewer: Plan agent (Opus 4.7, 1M ctx)

Codex's audit was thorough and largely correct; my disagreements are limited and noted explicitly.

## BLOCKING

### B1. Codex BLOCKING #1 confirmed — but the cleanest mitigation is "tighten `aztec_registerContract`" rather than "manual paste"

Codex's framing is accurate and the file-line citations check out:
- `packages/wallet-bridge/src/operation.ts:152-157` — `artifact?: ContractArtifact` is genuinely optional in the operation type.
- `packages/wallet-bridge/src/dispatcher.ts:644-650` — preserves optionality.
- `packages/extension/src/popup/windows/execute/index.vue:768` — `v-if="op.artifact"` accepts the missing case (currently just hides the artifact name row).
- `packages/extension/src/wallet/services/execution/service.ts:893-905` — falls back to `pxeService.getContractArtifact()` when no artifact provided.

**My recommendation differs from codex's framing.** Codex offers two options: (a) require artifact, or (b) add manual paste. I argue option (a) is the only architecturally clean choice for a pre-launch wallet:

1. The `aztec_registerContract` JSON-RPC verb's whole purpose is to push a contract definition into PXE. Allowing the dApp to call it without the artifact means the wallet has to source the artifact somehow — and once the HTTP registry is gone, the only sources are pxe-local (which is exactly what registration is meant to populate, so it's circular) or compiled-in-known (which is finite).
2. Manual paste in the popup is hostile UX, leaks artifact JSON into a confirmation surface that wasn't designed to render multi-kilobyte JSON, and creates a security gap (user pastes attacker-supplied JSON).
3. The wire change is small: make `artifact` required in `AztecRegisterContractOperation`, surface a clear error when missing, and update the wallet-sdk types in the same release. Pre-launch wallet — there are no production dApps depending on the optional-artifact path.

The escape hatch for "wallet-internal" registration paths (FPC discovery, sponsored FPC instance, future protocol contracts) already supplies its artifact directly via `pxe.registerContract({ instance, artifact })`. None of those code paths go through the bridge operation, so the operation-level tightening only affects *external* callers — which is exactly what we want.

**Acceptance criteria PR 1 should add:**
- `aztec_registerContract` rejects requests without `artifact` with an explicit error string.
- The four other contract-resolving surfaces codex flagged — token-interface parsing (`token/service.ts:240-256,325-341`), manual FPC add-by-address (`fpc/service.ts:191-206`), `ContractResolver.resolveArtifact` (`execution/contract-resolver.ts:101-107`), account-state backup (`account-state/service.ts:156-169`) — must each get a documented error path that surfaces a "contract not bundled / not registered with PXE" message rather than the current generic `"Contract artifact not found"` / silent skip. The plan should pick a wording and a test for each.

### B2. Codex BLOCKING #2 confirmed empirically — and the artifact has even less metadata than the plan implies

I reproduced codex's finding and went one level deeper. On the pinned nightly:
- `outputs.structs` only ever contains `events` and `functions` keys (`@aztec/stdlib/src/abi/abi.ts:355-366` — the schema's `.transform` confirms this is the only sort path).
- `storageLayout` is `Record<string, { slot: Fr }>` (`abi.ts:343,369`) — name-to-slot, no note schema.
- `outputs.globals.storage` is the source NoirCompiledContract carries (raw): each storage field has `(name, kind: "struct", fields: [{ name: "slot", value: integer }])` — **no AbiType reference, no note type id**.
- `NoteDao` has no `noteTypeId` (`@aztec/stdlib/dest/note/note_dao.d.ts:11-94`). `NoteSelector` exists at the *creation/oracle* layer (`@aztec/pxe/.../private_execution_oracle.ts:402`) — when contracts emit notes, PXE knows the type. **PXE drops the type at persistence.** This is a known upstream gap, not something we can route around.
- `decodeFromAbi(typ: AbiType[], buffer: Fr[])` exists in `@aztec/stdlib/src/abi/decoder.ts:144` and is re-exported by aztec.js — but it requires you to supply the `AbiType[]`. There is no `decodeNote(artifact, slot, items)` upstream. I checked.

**Verdict on the proposed strategies — I recommend strategy (a), but framed differently:**

The plan should adopt: **a hand-written, per-bundled-class slot-to-note-schema map, colocated with `known-artifacts.ts`.** Specifically a registry shaped like:

```
classId → { [storageSlot: string]: { typeName: string, abi: AbiType[], location: string } }
```

Then `parseNote` becomes: classId → if entry exists, `decodeFromAbi(abi, items)` to produce `content`, set `type`, `location`. Otherwise, raw fallback (preserving today's per-note try/catch invariant).

Why this beats the alternatives:
- We control which contracts we support post-PR-1. Bundled classes are a finite, hand-picked list (today: Token×2, NFT×1, FPC, SponsoredFPC, PrivateFPC after 3.A). Manual mapping for ~5–7 classes is tractable.
- The map is artifact metadata, not parser logic. Codex's NICE-TO-HAVE about colocating it with the bundle commit is correct — keep it next to `known-artifacts.ts` so artifact-version bumps and slot-map updates land in the same diff.
- The `AbiType[]` we hand-write for each note type (e.g. UintNote = `[{kind:"integer",sign:false,width:128},{kind:"struct",path:"AztecAddress",fields:[...]}, {kind:"field"}]`) is short and reviewable. The on-chain Noir types for notes change rarely.
- Source-metadata parsing (option (c)) is brittle — `file_map` is debug source, not a stable API.

**I disagree with codex on one minor point**: codex listed "intentional parsing of source/file metadata" as a realistic option. I think it's a trap — `fileMap` is debug source and is explicitly ordered arbitrarily (`abi.ts:357-365` notes path-ordering is arbitrary outside events/functions). Don't go there.

### B3. Codex BLOCKING #3 confirmed — PR 1 risk register understates blast radius. **Plus one surface codex missed:** the dApp execution-flow contract resolver

Codex enumerated four surfaces. Add a fifth:

`packages/extension/src/popup/windows/execute/index.vue:763-771` — the *approval window itself* renders artifact name only `v-if="op.artifact"`. If we tighten `aztec_registerContract` per B1, this template branch needs to either become unconditional ("Artifact: present/missing") or the operation-level rejection happens before the approval window opens. Either is fine; pick one and document it in PR 1.

Also, **`ContractResolver.resolveArtifact` is the chokepoint** for tx-simulation, authwit discovery, and call execution. Today it goes through `pxe.getContractArtifact()` which transparently consults the registry. Post-PR-1, every dApp tx that hits a previously-unseen class will hard-fail at simulation, with the exact string `"Contract artifact not found for class ${classId}"`. The plan must decide: is that the desired UX? My read is yes (fail loud, no silent privacy leak), but PR 1 should add a test that asserts this exact failure mode rather than letting it appear as a regression.

## SHOULD-FIX

### S1. Privacy expansion (user's new directive) is mostly clean deletion — **but it absorbs PR 2 entirely**

Verified scope of the expansion:
- `composables/configClient.ts` — only readers are `externalLinks.ts` + `externalImage.ts`. Pure leaf, safe to delete.
- `composables/externalLinks.ts` + `externalImage.ts` — used by ~13 sites I enumerated. All call sites are isomorphic: `useExternalLink().handleExternalLink(e, url)` becomes `window.open(url, "_blank", "noopener,noreferrer")` — a one-line replacement.
- `assets/privacy-placeholder.svg` — only consumer is `externalImage.ts:2`. Safe.
- `pages/settings/privacy/index.vue` — sole consumer of `Config.stealthMode`/`contractRegistry`/`uploadExternalImages`/`externalLinks` from the UI layer.
- `Config.ts` fields `stealthMode`, `stealthModeSnapshot`, `contractRegistry`, `uploadExternalImages`, `externalLinks`, `hasSeenStealthPromo`, type `StealthModeSnapshot`, type `ExternalLinksMode` — all become orphan after the deletions.

**Architectural verdict**: this is purely additive deletion. No second-order effects I can see.

**But this changes the PR-shape question (codex's branch-overlap finding):**

With the expansion, **PR 2 becomes "delete the whole privacy page + composables"** — which means PR 1's edits to `privacy/index.vue` are wasted work, and PR 1's edits to `config.ts` are partially redundant.

**My recommendation: invert the order. PR 2 first, PR 1 second, PR 3 third.**

Rationale:
1. PR 2 (privacy expansion) deletes `Config.contractRegistry` along with `stealthMode`/`uploadExternalImages`/`externalLinks`. Once that field is gone, `ArtifactRegistry`'s `IConfigReader.onUpdate` subscription has nothing to wire to.
2. PR 1 then becomes a smaller, runtime-focused diff: drop `HttpRegistryFetcher`, drop the `"registry"` source from `ArtifactSource`, drop `allowRegistry`, drop the `onConfigUpdate` subscription. No UI files touched; no `config.ts` touched (PR 2 did it).
3. PR 3 lands on a clean base.

Plan-v1's argument for PR-1-first ("smallest scope, lowest risk") was reasonable when PR 2 was "remove master toggle + keep individual toggles." With the user's expansion, PR 2 is now the largest deletion — so the "smaller first" heuristic flips.

### S2. Codex's "snapshot/restore is misnamed" finding is correct — and it has implications for tests

Verified:
- `Config.stealthModeSnapshot` is declared (`config.ts:5-9,28`).
- The privacy page does direct fan-out writes (`privacy/index.vue:84-126`), never reads or writes `stealthModeSnapshot`.
- Nothing else in the codebase reads or writes `stealthModeSnapshot`.

Plan-v1's risk register includes "snapshot/restore" as a feature — it isn't one. PR 2's tests should **not** include "verify snapshot is restored on disable" because there's no such behavior. The privacy page just hard-codes the "all on" defaults at disable time. Plan should drop that language.

### S3. Plan needs to pin **decimals/asset-metadata** as a non-goal for PR 3.C

Plan-v1.3.C says "format `value` as a human balance using `decimals` from the contract artifact." This is a trap — the artifact doesn't carry decimals (it's a deployment-time storage value, not a compile-time constant). Reading decimals requires a `pxe.simulateTx` round-trip against the contract's `get_decimals()` view function. That's a real cost to drop on the notes page render path.

**Recommendation**: PR 3 explicitly punts decimals. Render `u128` value as the raw integer or hex; let the existing tokens-page render layer (which does have decimals via `TokenInterface`) own decimal-aware rendering. Notes page already has a `contract` address; if a decimals-aware rendering is needed later, it's a follow-up that uses the existing `TokenService.getInterface` machinery.

### S4. Test strategy across all three PRs

**PR 2 (privacy expansion):**
- Delete `tests/e2e/privacy.test.ts` outright (page is gone).
- `tests/e2e/wallet-lock.test.ts:24-65` and `CLAUDE.md:180-189` — codex flagged these; the privacy expansion makes them dead-code references.
- No new tests required — deletion of a feature is verified by the absence of the feature's symbols (typecheck + grep).

**PR 1 (registry deletion, after PR 2):**
- Rewrite `artifact-registry.test.ts` around the two-source policy. Test invariants: default order `["pxe-local", "known"]`, `pxeOnly=true` skips known, `byClassId` pin still works for "known", class-id verification still applies to pxe-local, cache clears on `clear()`.
- Add an explicit test against `aztec_registerContract` with no artifact: assert it rejects (per B1).
- Add an integration test against `ContractResolver.resolveArtifact` with a class-id not in `known-artifacts` and not in PXE: assert the formatted error string is preserved verbatim (`"Contract artifact not found for class ${classId}"` — `contract-resolver.ts:103-105` documents this is load-bearing).

**PR 3 (note parsing):**
- Keep the current per-note isolation test (codex was right — non-negotiable invariant).
- Add: TokenNote (Aztec) decode → `{type: "TokenNote", location: "balances", content: {...}}`.
- Add: PrivateFPC note decode (post-3.A bundle).
- Add: unknown class-id → falls back to `rawContent`, no throw.
- Add: artifact-bundle test that asserts the slot-map matches the artifact's `outputs.globals.storage` (so a future artifact-version bump that renumbers slots breaks loud, not silent).

I agree with codex's NICE-TO-HAVE: don't block PR 3 on a live-PXE integration test.

### S5. Header.vue dead-code + missing inventory items

Codex listed `Header.vue:33-37,128-143,192-195,212-255` — there's a `stealthMode` ref + update handler with no rendered indicator. PR 2 (privacy expansion) absorbs this cleanup naturally. Add `Header.vue` to the explicit file list. Also add `tests/e2e/wallet-lock.test.ts:24-65` and `CLAUDE.md:180-189`.

### S6. Bundling decision for Wonderland NFT

I'll take a position: **bundle it.** Rationale: Token (Aztec) and Token (Wonderland) are both bundled today. NFT (Aztec) is bundled, NFT (Wonderland) isn't. The wallet's NFT support would silently fail post-PR-1 for Wonderland NFTs without bundling. Marginal artifact size is tens of KB. Slot-map maintenance cost is one extra entry.

## NICE-TO-HAVE

### N1. Plan should call out the testnet/devnet URL constants in `HttpRegistryFetcher` for explicit deletion

`artifact-registry.ts:97-99` — `https://testnet.aztec-registry.xyz` and `https://devnet.aztec-registry.xyz` are the only known references. Plan-v1 question 5 asks "should we ALSO remove these" — answer: yes, they go with `HttpRegistryFetcher`.

### N2. Verified-class-ids cache survives the simplification cleanly

The `verifiedClassIds` cache (`artifact-registry.ts:129`) was designed to skip Poseidon recomputes on the registry-returned-untrusted-source path. Post-PR-1, the only verified source is "pxe-local". The cache still has value (skip recompute on repeat pxe-local resolves) so leave it; just simplify the doc comment.

### N3. Commit-message rationale for PR 1

Plan-v1 risk #6 says "removing the registry signals 'we don't trust the legacy wallet'." I'd reframe: removing the registry *is* a privacy decision (no phone-home), not a trust statement. Lead with the verifiable property, not the interpretation.

## VERIFIED (agreement with codex)

- **`outputs.structs` is empty for note types** in the artifact: reproduced empirically. Codex's BLOCKING #2 stands.
- **Stealth promo is dead code** (`register.vue:24-26,52-54,106-111` — `showStealthPromo` is declared but never set to `true`).
- **`profile/new.vue:63-68` only reads `cacheStore.privacySettings` ref + flips `hasSeenStealthPromo`** — there's no real persistence path beyond the boolean flag.
- **`PrivateFPC` is already loaded inline** at `fpc/service.ts:18-22,118-130` via the `@private-fpc-artifact` Vite alias; bundling it in `known-artifacts.ts` (PR 3.A) helps note-decoding for PrivateFPC notes only.
- **Activity feed doesn't go through the registry** — `transaction/service.ts` uses local tx records.
- **`ConfigStore.apply()` — not the storage migration — handles unknown keys gracefully** (`config/store.ts:17-21,46-55`).
- **Notes UI is wired for decoded content already** (`account-state/notes/index.vue:128-156` + `note/spec.ts:13-17`).
- **`u128 = 1 Fr` on the pinned stdlib** (`@aztec/stdlib/src/abi/encoder.ts:158-166`, `decoder.ts:49-58`).

---

## Recommended PR ordering (final position)

Plan-v1 says: PR 1 → PR 2 → PR 3.

I recommend, given the user's privacy-expansion directive: **PR 2 (privacy mass deletion) → PR 1 (HTTP registry deletion + tighten `aztec_registerContract`) → PR 3 (note parsing with hand-written slot map)**.

This order:
1. Eliminates codex's branch-overlap concern (no `config.ts` or `privacy/index.vue` edits in PR 1).
2. Lets PR 1 be a clean runtime-only diff against an already-simplified config layer.
3. Keeps PR 3 last, isolating the largest design risk (note-decoding strategy) on a clean base.
4. Each PR is self-contained and reviewable.
