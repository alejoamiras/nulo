# Audit — Plan agent (architect) — Round 2

Date: 2026-04-29
Reviewer: Plan agent (Opus 4.7, 1M ctx)
Subject: `implementations-plan/registry-stealth-notes/plan-v2.md`

## Executive verdict

Plan-v2 has resolved 2 of the 3 round-1 BLOCKINGs cleanly (#1 artifact safety net, #3 blast radius). **The third BLOCKING is NOT actually resolved** — the proposed `classId → { storageSlotHex → NoteSchema }` dispatch table is **architecturally incompatible with how Aztec stores notes in maps**. Plan-v2 also introduces a NEW BLOCKING around `aztec_registerContract` tightening that breaks an in-tree caller and the upstream-SDK contract.

**Plan-v2 is NOT execution-ready** as written. PR 2 is execution-ready; PR 1 needs a wire-shape rethink; PR 3 needs the dispatch-key redesigned.

---

## BLOCKING

### B1. The proposed `storageSlotHex → NoteSchema` dispatch table cannot work for `Map<Address, Set<Note>>` storage

This is the most important finding in this round. Plan-v2 (`plan-v2.md:135-142`) sketches:

```
classId → { [storageSlotHex: string]: NoteSchema }
```

and the parser does `schemas[note.storageSlot.toString()]` (`plan-v2.md:157-159`).

**Why this fails:**

1. Note storage in tokens uses `Map<AztecAddress, PrivateSet<UintNote>>`. The slot the contract writes to is **`deriveStorageSlotInMap(map_base_slot, owner_key)`** — Poseidon hash of `(base_slot, owner_address)`. Verified at `node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/hash/map_slot.ts:11-19` (single `poseidon2HashWithSeparator([mapSlot, key.toField()], DomainSeparator.PUBLIC_STORAGE_MAP_SLOT)` call).
2. The `NoteDao.storageSlot` field is the *derived* slot, not the base slot. Verified by inspection of PXE's `notifyCreatedNote` at `node_modules/.bun/@aztec+pxe@4.2.0-nightly.20260413/node_modules/@aztec/pxe/src/contract_function_simulator/oracle/private_execution_oracle.ts:398-431`.
3. The artifact's `outputs.globals.storage` only contains the **base** slots (verified empirically — Wonderland Token shows `private_balances → 0x7`, Aztec Token similar; same pattern for NFTs).
4. So `note.storageSlot.toString()` (derived) will **never** equal any base slot in the artifact, and the schemas dictionary keyed by base slot misses every lookup. Every note returns `rawFallback`. Silent regression vs intended.

**Impact:** PR 3.B as specified ships and silently does nothing. The slot-map invariant test (`plan-v2.md:183`) would also pass, since each base slot does exist in `storageLayout` — but the dispatch never finds those slots at runtime.

**Fix shape — pick one:**

(a) **Dispatch by `(classId, base_slot)` and reverse-derive at lookup time.** For each `(classId, baseSlot)` candidate from `NOTE_SCHEMAS`, compute `deriveStorageSlotInMap(baseSlot, note.owner)` and match against `note.storageSlot`. Owner is on the NoteDao. Tractable since each contract has 1–2 note-bearing maps. Adds a poseidon hash per candidate per note (cheap).

(b) **Dispatch by classId alone**, since the bundled token/NFT contracts each have effectively ONE primary note type (Aztec Token = UintNote at `private_balances`; Aztec NFT = NFTNote; Wonderland Token = UintNote; Wonderland NFT = single NFT note; PrivateFPC = UintNote). Skip the slot dimension. Lose disambiguation between e.g. private_balances and a hypothetical pending_notes slot, but that limitation is fine to declare.

(c) **Do strategy (a) but cache the (classId → baseSlot → NoteSchema) map plus a reverse index: at first hit, compute owner-derived slots for all known owners and remember.**

**I recommend (a)** — explicit and correct. (b) is fine for the bundled set today but fragile if Wonderland adds a second map-stored note type.

**Note types per bundled contract (for the schema population step):**
- Aztec Token (`@aztec/noir-contracts.js/Token`): `UintNote` at base slot for `private_balances`.
- Wonderland Token: `UintNote` at base slot 0x7 (`private_balances`).
- Aztec NFT: `NFTNote` at the relevant private slot.
- Wonderland NFT: 1 NFT note type at base slot 0x5 (`private_nfts`).
- PrivateFPC: needs source inspection during impl; likely `UintNote` for fee-balance tracking.

I verified base slots for Wonderland Token and Wonderland NFT empirically. The plan should record these explicitly so impl doesn't re-derive them.

### B2. Tightening `aztec_registerContract` to require `artifact` BREAKS an in-tree caller and the upstream-SDK behavioral contract

Plan-v2 makes `artifact` required (`operation.ts:152-157`, `dispatcher.ts:644-650` per `plan-v2.md:87-89`). Two issues:

1. **In-tree caller breaks.** The Nulo playground calls `wallet.registerContract(instance)` with **no artifact** at `packages/playground/src/sections/contracts.ts:91`. There's also an existing E2E test (`packages/extension/tests/e2e/network/contracts-register.test.ts:59-66`) that exercises this exact path and asserts `["ok", "error"]` — the test will start failing in a *different* way (concrete rejection vs. structural error). Plan-v2 doesn't mention either site.

2. **Upstream SDK signature.** `@aztec/wallet-sdk`'s `Wallet.registerContract(instance, artifact?, secretKey?)` defines artifact as optional. Verified at `node_modules/.bun/@aztec+wallet-sdk@4.2.0-nightly.20260413/node_modules/@aztec/wallet-sdk/dest/base-wallet/base_wallet.d.ts`. Any external dApp using upstream wallet-sdk will, by default and silently, send `artifact: undefined` and get rejected by Nulo. The wire change is unilateral — Nulo cannot bump the upstream SDK. Pre-launch wallet, no production dApps yet, so the impact is real-but-bounded; the plan should call this out as an intentional divergence from the upstream SDK contract.

**Fix shape:**
- Decide whether the Nulo wallet's `aztec_registerContract` is a strict superset/subset of the upstream `wallet-sdk` SDK contract. Document it.
- Update the playground's caller to always pass the artifact (it has it locally already).
- Update or remove `tests/e2e/network/contracts-register.test.ts:43-66` — currently the test pastes JSON of `instance` only and expects `["ok", "error"]`; under new rules it must paste artifact JSON too OR assert deterministic rejection.
- Add the documented divergence to the wallet's docs (`CLAUDE.md` or a wire-spec doc) so dApp authors discover it before integration support tickets.

Note: `@nulo/wallet-bridge` is `private: true` (verified `packages/wallet-bridge/package.json:3`). No published SDK to bump. The ergonomic problem is on the consumer side, not the publishing side.

### B3. Codex BLOCKING #1 (artifact safety net) — plan-v2's mitigation is ALMOST complete but misses the executor service fallback

Plan-v2 documents 5 fail-loud surfaces (`plan-v2.md:96-102`) and tightens `aztec_registerContract` (B2 above). One surface in codex's audit is partially missed: `packages/extension/src/wallet/services/execution/service.ts:893-905` (`executeRegisterContract`) ALSO accepts a missing artifact and falls back to `pxeService.getContractArtifact(...)`. Tightening at the wallet-bridge `Operation` type level (B2 fix) does close this — the operation will be rejected at parsing time before reaching `executeRegisterContract` — but plan-v2 doesn't explicitly call out that the runtime fallback at line 902 becomes dead code post-tightening. Either delete that fallback (clean) or document why it's kept (defense-in-depth).

---

## SHOULD-FIX

### S1. Slot-map invariant test should also assert `location` matches the artifact's storage layout name

Plan-v2 (`plan-v2.md:183`) only asserts the slot exists in `storageLayout`. The schema's `location: string` field is meant for UI display (e.g., "balances"). If a future artifact renames `private_balances` → `balances`, the schema's `location` could go stale silently. The test should additionally assert that the schema's `location` matches the artifact's `storageLayout` key for that slot. Trivial addition, large blast-radius prevention.

### S2. Normalize the 5 fail-loud error strings to a shared error type

Plan-v2 documents fail-loud at 5 surfaces (`plan-v2.md:96-102`) but the error strings are heterogeneous today:
- `ContractResolver.resolveArtifact` throws `"Contract artifact not found for class ${classId}"` (verified `contract-resolver.ts:104`).
- `token/service.ts:247` throws `"contract artifact not found"` (lowercase, no class id).
- `fpc/service.ts:198` throws `"Contract artifact not found"` (capitalized, no class id).
- `execution/service.ts:904` throws `"Contract artifact not found"`.

Without normalization, each call site renders a different toast; users will see "contract artifact not found" sometimes with a class id, sometimes not. A shared error class (`ContractArtifactUnavailableError extends Error` carrying `classId` and `surface` metadata) is small effort and better UX. Tradeoff: adds ~30 LOC to the diff vs. prettier failure surfaces. **Recommend doing it as part of PR 1** — the error semantics change is a one-time cost and PR 1 is already touching all five surfaces' resolution paths transitively.

### S3. Test-fakes (FakeRegistryFetcher, FakeConfigReader) — most are deletable

With the registry source removed:
- `RegistryFetcher` interface is gone. All `RegistryFetcher` test fakes go.
- `IConfigReader` injection is gone. The `makeConfig()` helper at `artifact-registry.test.ts:52-69` becomes dead.
- `passthroughVerifier`, `makeMismatchVerifier`, `makeRecordingVerifier` (`artifact-registry.test.ts:21-42`) **stay** — class-id verification still runs on pxe-local source.
- `emptyLoader: KnownArtifactsLoader = async () => ({ artifacts: new Map(), instances: new Map() })` stays.

**The `IConfigReader` removal also propagates further than plan-v2 acknowledges**: the `ArtifactRegistry` constructor signature changes (`artifact-registry.ts:135-155`), affecting `PxeService` instantiation at `packages/aztec-runtime/src/pxe/service.ts:80-86`. Plan-v2 mentions dropping the instantiation but not the signature change. Should be a one-line constructor diff but it must be called out so reviewers don't miss it.

### S4. PR 3 vitest `loadContractArtifact` risk is low but unverified

Plan-v2 unit tests will load Wonderland Token/NFT/PrivateFPC JSON via the existing vite aliases (`vitest.config.ts:39-43`) and call `loadContractArtifact()`. **No existing test does this** (verified — `grep -rn "loadContractArtifact" packages --include="*.test.ts"` returns zero hits). The function uses `ContractArtifactSchema.parseAsync` (zod) plus `getContractClassFromArtifact` (poseidon hashing via `@aztec/foundation/crypto`). These should work in jsdom but it's a load-bearing assumption — first contact between vitest and `getContractClassFromArtifact`.

**Mitigation**: First check during PR 3 impl is "load each bundled artifact in a unit test and recompute its class id." If that works, the rest of the plan flows. If `@aztec/foundation/crypto` poseidon implementation tries to use `globalThis.crypto.subtle` or WebCrypto in unsupported ways under jsdom, polyfill via vitest setup. Plan-v2 should explicitly identify "smoke test artifact loading" as the first impl step.

### S5. Decimals scope-cut justification is right, but the punt makes the notes UI look unfinished

Plan-v2 punts decimals (`plan-v2.md:176`): notes will render `u128` value as raw integer. With Aztec Token decimals typically 18, a 1.0 token balance renders as `1000000000000000000` — visually broken. The plan should at least include in PR 3.C an explicit "raw u128 + a hint badge that decimals aren't applied yet" or scope a follow-up ticket explicitly. Otherwise users see balance-like numbers that look unbounded and the UX feels half-done.

**Mitigation options:**
- Render with thousands separators only.
- Render value in scientific notation when ≥1e6.
- Hardcode `decimals: 18` as a heuristic for now and document the assumption (it's correct for every Aztec/Wonderland token in our bundled set today).

### S6. Plan-v2's PR ordering rationale is correct but the "each PR independently mergeable" claim is over-strong

Plan-v2 (`plan-v2.md:192`) says each PR is independently mergeable. With B2's playground/E2E test fix, PR 1 now has a hard dependency on a coordinated playground patch. That's still a small dependency, but "independently mergeable" should be qualified — PR 1 must land with the playground caller fix in the same commit OR the e2e test will start failing on master after PR 1 merges.

---

## NICE-TO-HAVE

### N1. Bundle `PrivateFPC` and `Wonderland NFT` decisions are correct

Both confirmed in scope (`plan-v2.md:117-118`). Wonderland NFT artifact + PrivateFPC artifact verified to exist.

### N2. The user directive (delete entire Privacy page + 3 composables + asset + 13 consumers) is purely additive deletion

PR 2 in plan-v2 (`plan-v2.md:24-64`) is the cleanest of the three workstreams. No second-order effects beyond what's documented.

### N3. Aztec Sandbox / e2e test churn

PR 1's tightening of `aztec_registerContract` will require updating `packages/extension/tests/e2e/network/contracts-register.test.ts:43-66`. Plan-v2 doesn't enumerate this. Add it to PR 1's test list.

### N4. Header.vue dead-code cleanup is correctly inventoried

Verified `packages/extension/src/components/Header.vue:36, 136-137, 195` reference `stealthMode` ref + handler with no rendered indicator. PR 2 absorbs this cleanup.

---

## VERIFIED

- **Codex BLOCKING #1 (artifact safety net broken)** — plan-v2 addresses via `aztec_registerContract` tightening + 5-surface fail-loud documentation. Modulo B2/B3, **resolved**.
- **Codex BLOCKING #3 (blast radius)** — plan-v2 documents 5 surfaces explicitly. **Resolved.**
- **Codex BLOCKING #2 (PR 3 decoding strategy broken)** — plan-v2 pivots to hand-written map + `decodeFromAbi`. **Resolved at the abi-decoder layer, but the dispatch-key shape is wrong (B1).**
- **Stealth promo dead code** — verified `register.vue:24-26,52-54,106-111` shows `showStealthPromo` declared but never set true.
- **`stealthModeSnapshot` field never written** — verified by codebase grep; only declaration in `config.ts`.
- **`u128 = 1 Fr` on pinned stdlib** — confirmed.
- **`@nulo/wallet-bridge` is `private: true`** — no published SDK; the wire-change is in-tree only.
- **Storage slot derivation in maps** — confirmed `deriveStorageSlotInMap(mapSlot, key) = poseidon2HashWithSeparator([mapSlot, key.toField()], PUBLIC_STORAGE_MAP_SLOT)`. NoteDao carries the derived slot, not the base.
- **PXE drops `noteTypeId` at persistence** — confirmed.
- **Wonderland Token base slots** — empirically: name=0x1, symbol=0x3, decimals=0x5, **private_balances=0x7**, total_supply=0x8, public_balances=0x9, minter=0xa.
- **Wonderland NFT base slots** — empirically: symbol=0x1, name=0x3, **private_nfts=0x5**, nft_exists=0x6, public_owners=0x7, minter=0x8.

---

## Critical files for implementation

- `packages/aztec-runtime/src/pxe/note-schemas.ts` (new, gated by B1 fix)
- `packages/aztec-runtime/src/pxe/artifact-registry.ts`
- `packages/wallet-bridge/src/operation.ts`
- `packages/wallet-bridge/src/dispatcher.ts`
- `packages/extension/src/wallet/services/note/service.ts`
- `packages/playground/src/sections/contracts.ts` (caller fix for B2)
- `packages/extension/tests/e2e/network/contracts-register.test.ts` (E2E fix for B2)
- `packages/aztec-runtime/src/pxe/known-artifacts.ts` (PR 3 bundling)
