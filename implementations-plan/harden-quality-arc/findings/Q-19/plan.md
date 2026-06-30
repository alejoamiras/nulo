# Q-19 — PXE factory discriminated union + ChainCoordinates codec + NetworkInfo rename · tier: **light** (claude-only → codex cross-check)

**Re-verify (STEP 1, vs `dev-quality` @ b8c832a):** VALID. Three distinct smells in `aztec-runtime/pxe`:
1. **Boolean blindness** — `ProductionPxeFactoryOptions` (chain-runtime.ts:26-40): `required?`, `host?`, `port?`, `proverless?`. The comment says `proverless` is "mutually exclusive with `required`" but the type allows BOTH → illegal combos checked only at runtime.
2. **Data clump** — `(profileId, chainId)` encoded TWO ways: `${profileId}:${chainId}` (registry key chain-runtime.ts:215, chainGuard key service.ts:127) AND `pxe/${profileId}/${chainId}` (dataDirectory chain-runtime.ts:123, PXE-name `startsWith` service.ts:156). ~6 inline sites.
3. **Name collision** — `NetworkInfo` is TWO shapes: the live one (chain-runtime.ts:52: profileId+chainId+rpcUrl, used by proxy/client/service) vs artifact-registry.ts:13 (just `chainId`, "not read by the current resolver").

**Disjoint from Q-18's files** (known-artifacts/note-schemas/catalog) → safe to pipeline.

## Design sketch (to CONFIRM against the full options usage — chain-runtime.ts:103-190, read next tick)
1. **DU for the factory options.** Likely: a `provingMode` discriminated union `{ kind: "default" } | { kind: "required" } | { kind: "proverless" }` (proverless ⊥ required becomes unrepresentable) + the orthogonal node endpoint `{ host?, port? }`. MUST preserve every CURRENTLY-LEGAL combo + the runtime semantics (what `required`/`proverless`/`host`/`port` each drive). The `VITE_NULO_E2E_PROVERLESS` double-opt-in + "never in prod" invariant stays.
2. **`ChainCoordinates` + codec.** `type ChainCoordinates = { profileId: string; chainId: number }` + a single codec module: `registryKey(c) → \`${profileId}:${chainId}\`` and `dataDir(c) → \`pxe/${profileId}/${chainId}\``. Replace the ~6 inline encodings. **Byte-identical strings** (the PXE `dataDirectory` + persisted PXE name + the `startsWith` prefix MUST not change — they key on-disk state).
3. **Rename the artifact-registry `NetworkInfo`** → e.g. `ArtifactNetworkContext` (or remove if `:162` usage is dead) so it stops colliding with the live one. Behavior-preserving (type rename only).

## Behavior-preservation pins
- The `dataDirectory`/PXE-name strings are PERSISTED (on-disk PXE state keyed by `pxe/profile/chain`) — a changed encoding orphans existing PXE data. Byte-identical, asserted by a codec unit test.
- The DU must map 1:1 onto the current legal flag combos — no combo dropped, none newly allowed-then-mishandled.
- service.ts:156 `pxes[i].name!.startsWith(\`pxe/${x.id}/\`)` profile-cleanup logic must still match the same names.

## Validation gate
- `bun run lint` + `bun run typecheck:all`.
- `bun run test` for **aztec-runtime** (chain-runtime + service + the new codec test) + **extension** (the PXE factory consumers — Network satisfies NetworkInfo).
- New `chain-coordinates.test.ts`: `registryKey`/`dataDir` byte-identical to the prior inline literals (incl. an explicit vector).
- smoke + FULL network e2e (PXE init + profile switch + cleanup exercise the keys/modes).

## Codex consult — `conditional approve` (session 019f19d7); ADOPTED design
**12 current legal combos = 3 proving modes × 4 endpoint shapes** (none/host-only/port-only/both):
- `default` (required + proverless both false/omitted): `proverEnabled:true`, constructs `AcceleratorProver`, NO `onPhase`, NO preflight; endpoint passed iff host or port present.
- `required:true` (proverless false/omitted): same prover path PLUS `onPhase` throws on `fallback|denied`, warns on `downloading`, eager `checkAcceleratorStatus()`.
- `proverless:true` (required false/omitted): `proverEnabled:false`, NO `AcceleratorProver`; host/port currently legal but IGNORED.
- ILLEGAL today: `required:true` + `proverless:true` → constructor throws.

**Adopted DU** (host/port orthogonal to mode — keep it that way, don't couple to required):
```ts
type AcceleratorEndpoint = { host?: string; port?: number }
type ProductionPxeFactoryOptions =
  | (AcceleratorEndpoint & { provingMode?: "default" })
  | (AcceleratorEndpoint & { provingMode: "required" })
  | (AcceleratorEndpoint & { provingMode: "proverless" })
```
Map call sites: `required:true`→`provingMode:"required"`; `proverless:true`→`provingMode:"proverless"`; neither→`"default"` (or omit). The illegal combo becomes unrepresentable.

**Codec — preserve full keys AND PREFIXES (codex HIGH#1):** `${profileId}:${chainId}`, `${profileId}:` (per-profile dispose prefix), `pxe/${profileId}/${chainId}`, `pxe/${profileId}/` (cleanup prefix), and bare `"pxe/"`. A `ChainCoordinates` codec exposing `registryKey`, `registryKeyPrefix(profileId)`, `dataDir`, `dataDirPrefix(profileId)`. **DO NOT touch `account/service.ts`'s `${profileId}:${chainId}:${type}`** (a different 3-part key). No PXE-key parser/split exists (colon-splits elsewhere are unrelated CAIP/verify).

**Persisted-state (codex HIGH#2):** `dataDirectory` + `clearChainState` MUST stay `pxe/${profileId}/${chainId}` byte-identical — no escaping, no `path.join`, no trailing slash, no chainId normalization. Codec unit test pins exact vectors incl. prefixes.

**NetworkInfo (codex MED#3):** artifact-registry's is dead-as-data (`_network` never read) — **rename** to `ArtifactNetworkContext`, KEEP the param (removing it churns a public method signature).

**Biggest break (codex):** DU remaps default→proverless/required, endpoint pass-through lost, or a registry/guard/profile-delete prefix diverges so cleanup/dispose targets the wrong runtime/DB. Implementation reads the constructor (~103-117) + createChainRuntime (~119-190) + every option call site + every key/prefix site before editing.

## Codex post-impl (session 019f19d7 resumed) — `conditional approve`
Confirmations: codec strings byte-identical (`p:c`, `p:`, `pxe/p/c`, `pxe/p/`, `pxe/`); DU maps 1:1 for all migrated callers (default/required construct `AcceleratorProver`; required adds onPhase+preflight; proverless `proverEnabled:false`; host/port pass in default+required, ignored in proverless); `@ts-expect-error` reliable; `ArtifactNetworkContext` rename contained.
- **Medium → ACCEPTED as an API break** (no defensive legacy-key check): the constructor no longer reads `required`/`proverless`, so a hypothetical old-shape/`any`/JS caller would silently change behavior. All callers are migrated + TS-typed (`offscreen/index.ts` + `service.ts`); no JS/non-literal callers, no prod users → the DU is the new contract (no-backwards-compat ruling). Documented, not guarded.
- **Low → FIXED:** stale comments `offscreen/entry.ts:29` + `chain-runtime.test.ts` header (made stale by the DU rename).
- **Low → DEFERRED:** `apps/extension/src/wallet/storage/migrate.ts:79` `INDEXEDDB_WIPE_PREFIXES = ["pxe/"]` is byte-identical + in the storage-migration layer (outside Q-19's cited pxe-service scope); centralizing it would widen the codec export surface across a layer for marginal gain. Follow-up candidate.
