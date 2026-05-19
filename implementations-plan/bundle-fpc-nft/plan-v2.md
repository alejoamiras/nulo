# Plan v2: Bundle PrivateFPC + Wonderland NFT (note-parsing coverage)

> Supersedes plan-v1. Consolidates findings from `audit-codex.md` and
> `audit-plan-agent.md`. The change set itself is small; most v2 deltas
> are about correct framing, sharper QA, and dropped wrong claims.

## Context

PR #31 (note parsing) bundled artifact + schema for **3 contracts**:
Aztec Token / Aztec NFT / Wonderland Token. This PR adds the long-tail
**2 contracts** flagged in the original plan-v3: PrivateFPC (Wonderland
fee-payment) + Wonderland NFT (Wonderland NFT standard).

### Important framing correction (codex blocking + plan-agent D1)

> Plan-v1 said `@private-fpc-artifact` was "aliased but unused".
> **Wrong** — `packages/extension/src/wallet/services/fpc/service.ts:19`
> already imports it for auto-discovery of PrivateFPC instances.

What this means concretely:
- **PrivateFPC artifact is already in the bundle today**, registered into
  PXE for any user who has a Nulo profile that interacted with the
  fee-payment flow. Notes from PrivateFPC already retrieve correctly;
  they just render as raw `items: Fr[]` because PR #31 didn't have a
  schema entry for the PrivateFPC class id.
- **The user-facing change for PrivateFPC** in this PR is the **schema
  entry**, not the bundle entry. Bundle is no-op for PrivateFPC; we
  still add it for symmetry + smart-tighten coverage if a non-Nulo dApp
  uses PrivateFPC's class id.
- **Wonderland NFT is the case where bundling actually matters**: no
  existing wallet code imports it, so adding it expands smart-tighten
  coverage AND adds new bundle surface (~2.8 MB).

### Smart-tighten scope is narrower than plan-v1 implied (codex SHOULD-FIX #1)

Bundling expands `aztec_registerContract`'s artifact-fallback chain so
dApps can omit `artifact` for these classes. **It does NOT change** the
behavior of:
- `aztec_getContractClassMetadata` (`execution/service.ts:1419`)
- `aztec_getContractMetadata` (`execution/service.ts:1438`)

Both of those still pass `pxeOnly: true` and continue to report "not
registered" for any class until the contract is registered in PXE. So
this PR doesn't make Wonderland NFT contracts magically appear — it
makes registration easier when a dApp eventually does call
`aztec_registerContract` for one.

## Verified slot + shape data (codex confirmed independently)

| Contract | classId source | Storage slot | Note shape | Verified field |
|---|---|---|---|---|
| PrivateFPC | `@wonderland/aztec-fee-payment` | `0x1` (`balances`) | `PrivateSet<UintNote>` → `UintNote { value: u128 }` | `balance_of` returns `u128` |
| Wonderland NFT | `@defi-wonderland/aztec-standards` | `0x5` (`private_nfts`) | `Owned<PrivateSet<NFTNote>>` → `NFTNote { token_id: field }` | mirrors Aztec NFT shape |

Slots `0x6` (`nft_exists`) and `0x7` (`public_owners`) on Wonderland NFT
are public state, not notes — irrelevant to schema.

## Files touched (5)

### A. `packages/extension/vite.config.ts` — alias for Wonderland NFT

PrivateFPC alias already exists (line 45). Add:
```ts
"@wonderland-nft-artifact": resolvePackageFile(
  "@defi-wonderland/aztec-standards",
  "target/nft_contract-NFT.json",
),
```
Codex verified the `target/` path is canonical.

### B. `packages/extension/vitest.config.ts` — mirror alias

Mirror the same alias for unit tests.

### C. `packages/aztec-runtime/src/pxe/known-artifacts.ts` — bundle entries

Add 2 imports + 2 entries. Bundle: 11 → 13 contracts.
PrivateFPC adds zero new bundle weight (already loaded via FpcService).
Wonderland NFT JSON is **2.8 MB** new — ~5% growth on top of the
existing ~57 MB offscreen chunk.

### D. `packages/aztec-runtime/src/pxe/note-schemas.ts` — schema entries

Append 2 entries to `loadProductionNoteSchemas`:
```ts
const PrivateFPCArtifact = loadContractArtifact(PrivateFPCJson)
const privateFpcClass = await getContractClassFromArtifact(PrivateFPCArtifact)
map.set(privateFpcClass.id.toString(), new Map([["0x1", UINT_NOTE]]))

const WonderlandNFTArtifact = loadContractArtifact(WonderlandNFTJson)
const wonderlandNftClass = await getContractClassFromArtifact(WonderlandNFTArtifact)
map.set(wonderlandNftClass.id.toString(), new Map([["0x5", NFT_NOTE]]))
```

Per codex: the duplicate `loadContractArtifact()` across this file +
`known-artifacts.ts` is **not a correctness issue** (function is pure;
the duplicated cost is the class-id Poseidon hash, already the
established pattern). Plan-agent flagged drift risk as worth a future
follow-up — see "Open follow-ups" below.

### E. `packages/extension/src/wallet/services/note/note-schemas.test.ts` — regression gates

Add 2 storage-layout tests (same shape as the existing 3):
```ts
test("PrivateFPC: balances at slot 0x1 (UintNote)")
test("Wonderland NFT: private_nfts at slot 0x5 (NFTNote)")
```

### F. `packages/extension/src/wallet/services/execution/service.test.ts` (new test, per codex SHOULD-FIX #2)

Add a focused unit test pinning the bundled-class smart-tighten
behavior: `executeAztecRegisterContract` succeeds without a passed
artifact when the class id is bundled. Existing E2E
`contracts-register.test.ts:59` accepts both success/error so it
doesn't pin the new behavior — adding a unit test makes the contract
explicit. Tests use a fake PxeService that returns the bundled artifact
through `getContractArtifact`.

### G. `packages/extension/package.json` — version bump

`0.13.49` → `0.13.50`. Patch bump (consistent with the arc; pre-launch
so semver isn't load-bearing).

## Verification

- `bun run typecheck` clean
- `bun run lint` clean
- `bun run test` — three new tests added (2 schema gates + 1 register-contract behavior pin)
- `bun run build` clean — bundle grows by ~2.8 MB (Wonderland NFT JSON)
- Auto-imports regen automatically

### Manual QA (rewritten per codex blocking #1 + #2)

The behavior shifts in this PR live in two places:

1. **Note decoding** for already-resolvable contracts:
   - **PrivateFPC**: profiles using Nulo's private-fee-payment flow already
     have PrivateFPC contracts registered in PXE (via FpcService
     auto-discovery). Open `Settings → Advanced → Account State → Notes`;
     PrivateFPC notes that previously rendered as raw `items: Fr[]`
     should now show `UintNote` with decoded `value`. **This is the
     headline user-visible change for PrivateFPC.**
   - **Wonderland NFT**: requires the user's PXE to have a Wonderland NFT
     contract registered first. There's no in-wallet auto-discovery for
     NFTs (NoteService walks only PXE-registered contracts at
     `note/service.ts:129`). **QA requires a dApp interaction** — see
     §"Open issues" Q1.

2. **Smart-tighten in `aztec_registerContract`**:
   - dApps can now call `aztec_registerContract({ instance })` for
     PrivateFPC or Wonderland NFT class ids without passing `artifact`.
     Verified by the new unit test in §F.

## Risks / Invariants preserved

1. **M4.3 trust enforcement** unchanged: known branch keys by load-time-computed
   classId (Map.get is itself the equality check); skip-recompute applies
   uniformly to the 2 new entries.
2. **Bundle as a permanent classId commitment** (per plan-agent strategic
   note): every contract bundled becomes a permanent smart-tighten
   target; removing one later breaks dApps relying on the no-artifact
   path. PrivateFPC + Wonderland NFT meet the bundling bar: PrivateFPC
   is wallet-internal-use, Wonderland NFT is the de-facto NFT standard
   in the Wonderland ecosystem.
3. **No new instances**: per plan-agent D2, every PrivateFPC deployment
   has a unique salt; no canonical compiled-in instance to add. Same for
   Wonderland NFT. The bundle resolves classes only — `getKnownInstance`
   continues to return undefined for these contracts.
4. **Bundle size**: +2.8 MB Wonderland NFT JSON in the offscreen chunk
   (~5% growth on a chunk that's already large due to bb.js + 11
   bundled artifacts). Acceptable; would deserve a fix-pass if we kept
   adding contracts at this rate.
5. **Slot uniqueness**: Wonderland NFT `0x5` doesn't collide with any
   existing schema entry. Map keying is `(classId, slot)` so collision
   is structurally impossible.

## Open follow-ups (NOT this PR)

These are tracked but explicitly **out of scope** for this PR:

- **Shared `bundled-artifacts.ts`** (plan-agent D3): a module exporting
  `{ artifact, classId }` per contract, consumed by both
  `known-artifacts.ts` and `note-schemas.ts`. Eliminates drift risk + makes
  invariant testing trivial. Worth doing once we add a 6th contract.
- **classId-cross-module invariant test** (plan-agent D4): once the
  shared module above exists, add a test asserting every classId in the
  schema map exists in the known bundle. Catches the silent drift mode
  storage-layout gates can't see.
- **Slot-collision unit test** (plan-agent S2): assert no two
  `(classId, slot)` pairs collide. Cheap insurance, follow-up.
- **Decimals on UintNote display** (plan-v3 from the previous arc): a
  user-friendly view that scales `value` by 10^18 with an "(unverified
  decimals)" badge. Decided against during PR #31 — brutalist Notes
  inspector should show raw bigint. Same call here.
- **More Wonderland standards** (Dripper, Escrow, GenericProxy,
  TestLogic): none meet the bundling bar (per plan-agent's argument:
  bundle = (a) wallet-internal-use, OR (b) so widespread that
  not-bundling creates user friction). Add later if usage warrants.

## Open issues for the user

### Q1. Wonderland NFT manual-QA path is genuinely weak

Codex BLOCKING #2 + plan-agent S1 converge on this. The schema only
fires after the contract is in PXE; there's no auto-discovery. So the
Wonderland NFT half of this PR effectively ships on:
- The storage-layout regression-gate test (catches slot drift)
- The new register-contract unit test (catches smart-tighten regressions)
- Manual code review

Three options:
- **(a) Find a deployed Wonderland NFT instance on the testnet you're
  running against** and have a test dApp register it.
- **(b) Defer this PR** until you have a real Wonderland NFT use case
  to validate against.
- **(c) Ship as-is** acknowledging "Wonderland NFT decoding is verified
  via storage-layout test + code review only; first real use will be
  the manual smoke."

My pick: **(c)**. The risk surface is small (a 1-line schema entry +
1-line bundle entry), the storage-layout gate protects against the
most likely break (slot drift), and the test coverage is fine.

### Q2. Bundle scope — stay at 2 or extend?

Both audits agree: stay at 2. Plan-agent's articulation:

> Default-bundle should be: (a) contracts the wallet itself uses,
> (b) contracts so widespread that not bundling them creates user
> friction. PrivateFPC is (a). Wonderland NFT is (b)-ish. Dripper
> et al. are neither.

I want to confirm: green-light staying at 2?
