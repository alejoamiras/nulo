# `@nulo/aztec-runtime` — QUALITY audit (typing + dedup lens)

Scope: `packages/aztec-runtime/src/**` excluding `*.test.ts`. Quality only (maintainability / change-cost). Correctness/security items are in `## Out-of-focus notes`.

Findings ordered by maintenance impact. Every instance cited.

---

### AR-1 5-way hand-maintained PXE method surface
- Smell: Duplicate Code + Shotgun Surgery
- Lens: dedup
- Maintenance impact: architectural
- Blast radius: 7 declaration sites across 6 files
- Instances:
  - `pxe/spec.ts:24-81` — `Methods` type (21 methods, each with `network` param).
  - `pxe/ipxe.ts:27-50` — `IPXE` interface (18 methods, `network` stripped, promisified).
  - `pxe/proxy.ts:32-102` — `PXEProxy` class body (18 one-line currying forwarders).
  - `pxe/client.ts:76-201` — `PxeServiceClientBase` body (21 methods, each `this.request(...)` + per-method zod rehydrate).
  - `pxe/service.ts:190-470` — `PxeService` body (21 methods, each guard-wrapped + inbound zod parse).
  - `pxe/service.ts:60-82` — `defineRpcMethods<Methods>(...)` name array (21 string literals).
  - `pxe/subset.ts:25-44` — `PXE_SUBSET_METHODS` name array (18 string literals).
- Evidence: adding one RPC (or renaming one) requires touching all 7 sites. `subset.ts:20-24` explicitly concedes the gap: "Full mapped-type derivation of `IPXE`/`PXEProxy` from `Methods` is a larger step … so this pins the KEY boundary only." The compile-time `Equal<>` asserts (`subset.ts:54-60`) catch *name-set* drift but not the per-method body/zod, which stay hand-written.
- Why it harms future change: every PXE-surface change is a 7-file edit; the @aztec 5.x bump (which reshapes `proveTx`/`simulateTx` opts) will ripple through all of them. `PXEProxy` (`proxy.ts:32-102`) is pure boilerplate — 18 methods that only drop `this.network` in front of the args.
- Refactoring: Extract Class / Replace Boilerplate-with-Generic. Derive `IPXE` from `Methods` via a mapped type that strips the leading `network` param and promisifies; generate `PXEProxy` via a `Proxy`/factory keyed off `PXE_SUBSET_METHODS`; table-drive `client.ts`'s rehydration as a `Record<keyof Methods, ZodSchema>` map so the per-method bodies collapse to one `request`-then-`parse` loop. `Methods` stays the single source; the three derivations disappear.
- Effort: days
- Confidence: high

---

### AR-2 Artifact class-id double-loaded and double-hashed across two loaders
- Smell: Duplicate Code (Divergent Change risk)
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 2 files, 4 artifacts hashed twice under 2 cache regimes
- Instances:
  - `pxe/known-artifacts.ts:13-21` imports `TokenContractArtifact`, `NFTContractArtifact`, `WonderlandTokenJson`, `PrivateFPCJson`; `:65-68` `getContractClassFromArtifact` over all 12 compiled-in artifacts → keyed map (shared-promise cache via `ArtifactRegistry.ensureKnown`).
  - `pxe/note-schemas.ts:3-8` imports the same `NFTContractArtifact`, `TokenContractArtifact`, `WonderlandTokenJson`, `PrivateFPCJson`; `:71,74,78,82` `getContractClassFromArtifact` over Token/NFT/Wonderland/PrivateFPC → keyed map (module-level `cachedSchemas` promise, `:64-94`).
- Evidence: the same 4 artifacts' class-ids are Poseidon-recomputed in two places, each with its own retry-on-failure cache (`known-artifacts` via `artifact-registry.ts:99-112`; `note-schemas.ts:87-93`). `loadContractArtifact(WonderlandTokenJson)`/`(PrivateFPCJson)` runs in both (`known-artifacts.ts:41-42`, `note-schemas.ts:77,81`).
- Why it harms future change: an artifact swap (or a `getContractClassFromArtifact` upstream change) must be mirrored in two files or the known-bundle and the note-schema map silently disagree on a class-id — a note would render raw because its schema is keyed under a stale id while the artifact resolves fine. Two cache lifecycles also mean two reset paths.
- Refactoring: Consolidate to one artifact catalog that computes `classId→artifact` once; `note-schemas` looks up its 4 entries from that catalog instead of re-hashing. One load, one cache, one source of class-ids.
- Effort: hours
- Confidence: high

---

### AR-3 `ProductionPxeFactory` modes are boolean flags, not a discriminated union
- Smell: Boolean Blindness (analog of Primitive Obsession + Combinatorial-flag smell) — illegal state (`required && proverless`) is representable and rejected only at runtime
- Lens: typing
- Maintenance impact: structural
- Blast radius: 1 file (factory) + every caller that constructs options
- Instances:
  - `pxe/chain-runtime.ts:26-40` — `ProductionPxeFactoryOptions { required?; host?; port?; proverless? }` (4 independent optionals).
  - `pxe/chain-runtime.ts:103-117` — 4 private fields + ctor that throws `"`proverless` and `required` are mutually exclusive"` at runtime (`:114-116`).
  - `pxe/chain-runtime.ts:142-145` (proverless branch), `:152-190` (required branch), `:172` (`host/port` only meaningful in required path).
- Evidence: `host`/`port` are only read in the non-proverless accelerator branch (`:172`); `required` is illegal with `proverless`; nothing at the type level prevents `{ required: true, proverless: true, host: "x" }`. The ctor throw is the only guard.
- Why it harms future change: adding a fourth mode means another boolean + another runtime exclusion check + more "which optional pairs are valid" tribal knowledge. Callers can't tell from the type which fields go together.
- Refactoring: Replace flags with a discriminated union — `type PxeMode = { kind: "production" } | { kind: "required"; host?: string; port?: number } | { kind: "proverless" }`. The illegal combo becomes a compile error; `host`/`port` live only on the variant that uses them; the runtime throw at `:114-116` is deleted.
- Effort: hours
- Confidence: high

---

### AR-4 `${profileId}:${chainId}` key codec + `pxe/<profile>/<chain>` DB-path scattered
- Smell: Shotgun Surgery + Data Clump (`(profileId, chainId)` travel together everywhere, unencapsulated)
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 2 files, 9 literal sites
- Instances (guard key `${profileId}:${chainId}` + prefix scan):
  - `pxe/service.ts:127` `chainKey()`, `pxe/chain-runtime.ts:215` `ChainRuntimeRegistry.key()` — identical body.
  - prefix scan `${profileId}:`: `pxe/service.ts:521` (`onProfileDeleted` guard cleanup), `pxe/chain-runtime.ts:291` (`disposeProfile`).
- Instances (IndexedDB path `pxe/${profileId}/${chainId}`):
  - `pxe/chain-runtime.ts:123` (`dataDirectory`), `pxe/service.ts:458` (`clearChainState`), `pxe/service.ts:156` (`pxe/${x.id}/` orphan scan), `pxe/service.ts:531` (`pxe/${profile.id}/` delete scan).
- Evidence: two independent key formats (`:`-joined guard key vs `/`-joined DB path) are each re-spelled at multiple sites, and the `(profileId, chainId)` pair is threaded as two loose params through `withPxeRead`/`withPxeWrite`/`getChainGuard`/registry methods rather than as one value object.
- Why it harms future change: changing the DB-path layout (e.g. adding a schema-version segment, the kind of thing `ARCHITECTURE.md` storage-versioning would force) means hunting 4 string literals across 2 files; a missed one leaves orphan DBs uncollectable. The two key formats can drift independently.
- Refactoring: Introduce a `ChainKey`/`PxeDbPath` codec (one module: `key()`, `dbPath()`, `prefix()`, `matches()`); pass a `ChainCoordinates` value object instead of `(profileId, chainId)`. Every literal collapses to one call.
- Effort: hours
- Confidence: high

---

### AR-5 IndexedDB `deleteDatabase` Promise-wrapper repeated 4×
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: local
- Blast radius: 1 file, 4 sites
- Instances: `pxe/service.ts:157-165` (orphan DB), `:172-180` (keyval-store), `:459-467` (`clearChainState`), `:530-534` (fire-and-forget in `onProfileDeleted`, no await, drops the onblocked log).
- Evidence: the first three are the same `new Promise((resolve,reject) => { req.onsuccess/onerror/onblocked })` block with only the log message and the error-vs-resolve choice differing; the fourth (`:530-534`) silently diverges — no onblocked handling, no await, so a blocked delete there is invisible.
- Why it harms future change: the onblocked-resolve-vs-reject policy is decided inline 4 times; the divergent 4th instance is exactly the kind of inconsistency that bites during a storage-version migration. A bug fix to the blocked-handling must be applied 4×.
- Refactoring: Extract Function `deleteIndexedDb(name, { onBlocked }): Promise<void>`; all four call it, the fire-and-forget one becomes `void deleteIndexedDb(...)`.
- Effort: hours
- Confidence: high

---

### AR-6 SDK-boundary `as`/`as unknown as` casts laundering untyped values
- Smell: Stringly/loosely-typed boundary (analog of Primitive Obsession at the SDK seam)
- Lens: typing
- Maintenance impact: structural
- Blast radius: 3 files, 7 casts
- Instances:
  - `pxe/client.ts:144` `(await z.array(NoteDaoSchema).parseAsync(result)) as unknown as NoteDao[]` — zod yields POJOs, not `NoteDao` instances; consumers silently lose class methods (`toBuffer`/`equals`). Documented at `:141-143`, but the type lies.
  - `pxe/chain-runtime.ts:82` `this.pxe as unknown as { stop?: () => Promise<void> }` — PXE type omits `stop`; double-cast to reach a runtime-probed method.
  - `pxe/chain-runtime.ts:121-125` `{ ...getPXEConfig(), dataDirectory, proverEnabled } as PXEConfig` — partial-config cast.
  - `account/fee-options.ts:64,68,70,74` `... as Parameters<typeof Gas.from>[0]` / `as Parameters<typeof GasFees.from>[0]` (×4) — launders the `unknown` RPC fields into `Gas.from`/`GasFees.from`.
- Evidence: each cast is a place where the compiler is told to stop checking at the @aztec boundary. The `client.ts:144` one is the most dangerous: the return type `NoteDao[]` is structurally false.
- Why it harms future change: an @aztec type reshape (5.x → next) won't surface as a type error at these sites — it'll compile and fail at runtime. The `NoteDao` lie means any future consumer that does call `.toBuffer()` typechecks and then throws.
- Refactoring: For `client.ts:144`, change the declared return type to the zod-inferred POJO shape (`z.infer<typeof NoteDaoSchema>[]`) and update `NoteService` to consume that — the cast disappears and the type tells the truth. For `fee-options`, parse the 4 RPC fields through a typed schema once (see AR-8) so `Gas.from` receives a typed value. For the PXE `stop`/`PXEConfig` casts, narrow via a local typed shim interface.
- Effort: hours
- Confidence: high (moderate on the `NoteDao` consumer-impact — depends on whether any caller touches class methods)

---

### AR-7 Inconsistent zod result-rehydration on the client path
- Smell: Divergent Change (one class, two policies for the "same kind" of method)
- Lens: typing
- Maintenance impact: local
- Blast radius: 1 file, 2 of 21 methods
- Instances: every `PxeServiceClientBase` method zod-`parseAsync`-es its result (`client.ts:82,87,97,102,107,116,136,144,149,154,164,169,178,185`) EXCEPT:
  - `client.ts:90-93` `getNoteSchemas` → `(result ?? {}) as Record<...>` (cast, no parse).
  - `client.ts:191-195` `getBlockTimestamp` → `Number(result)` (coercion, no parse).
- Evidence: the two SW-only methods opt out of the validation discipline applied to the other 19. Both cross the same JSON RPC seam as the validated ones.
- Why it harms future change: a reader can't trust "the client always rehydrates" — they must check each method. If `getNoteSchemas`'s shape evolves, the unparsed cast won't catch a drift the way the parsed siblings would.
- Refactoring: give both a zod schema (`getBlockTimestamp` → `z.number().optional()`, `getNoteSchemas` → a record schema) so the discipline is uniform; folds into the table-driven rehydration of AR-1.
- Effort: hours
- Confidence: high

---

### AR-8 `unknown`-typed boundary bags
- Smell: Primitive Obsession (analog — `unknown` as a stand-in for an unmodeled domain type)
- Lens: typing
- Maintenance impact: local
- Blast radius: 2 files
- Instances:
  - `account/fee-options.ts:32-37` `PartialGasSettingsRPC` — all 4 fields `unknown`, defended only by `Gas.from`/`GasFees.from` throwing (forces the 4 casts in AR-6).
  - `pxe/service.ts:54` `IProfileReader.onActiveProfileChanged: { add(handler: (profile: unknown) => void) }` — handler arg is `unknown` (and `onActiveProfileChanged` at `:541-549` ignores it entirely).
- Evidence: these are real trust boundaries (dApp-supplied fees; cross-process profile event), so `unknown` is defensible — but it's untyped at a point where a zod schema would both validate and type.
- Why it harms future change: every consumer re-casts. A typed `GasSettingsRpcSchema` (zod) would parse-and-type in one move and kill AR-6's 4 casts.
- Refactoring: Replace the `unknown` fields with a zod schema whose `z.infer` is the declared type; parse at the boundary.
- Effort: hours
- Confidence: moderate (intentional at the trust boundary; the win is removing the downstream casts)

---

### AR-9 Duplicate type name `NetworkInfo` with two different shapes
- Smell: Divergent Change / name collision (Speculative Generality on the registry copy)
- Lens: typing
- Maintenance impact: local
- Blast radius: 2 files
- Instances: `pxe/chain-runtime.ts:52-56` `interface NetworkInfo { profileId; chainId; rpcUrl }` (the exported, widely-used one — re-exported `pxe/index.ts:1`); `pxe/artifact-registry.ts:13-17` `interface NetworkInfo { chainId }` (different shape, same name).
- Evidence: `artifact-registry.ts`'s `NetworkInfo` is barely used — `resolve(..., _network: NetworkInfo, ...)` ignores it (`artifact-registry.ts:162`, leading underscore). The comment at `:14-15` admits `chainId` is "kept on the API for future per-chain policy hooks even though the current resolver doesn't read it."
- Why it harms future change: two unrelated `NetworkInfo`s invite a wrong-import bug (TS won't complain — both are structural and the registry's is a subset). The unused param is dead surface.
- Refactoring: Rename the registry's to nothing — drop the `_network` param entirely (Remove Dead Parameter), or if the per-chain hook is real, reuse the canonical `NetworkInfo`.
- Effort: hours
- Confidence: high

---

### AR-10 `withPxeRead`/`withPxeWrite` + `[SYNC-DEBUG]` near-twins
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: local
- Blast radius: 1 file
- Instances:
  - `pxe/service.ts:472-490` `withPxeRead` vs `:492-511` `withPxeWrite` — identical except `chainGuard.read` vs `.write` and the `[READ]`/`[WRITE]` log strings + timing scaffold.
  - `pxe/service.ts:294-301` (`proveTx`) and `:329-336` (`simulateTx`) — verbatim `[SYNC-DEBUG]` try/catch block (read synced header + node tip, log, swallow).
- Evidence: the two guard wrappers differ by one method name; the SYNC-DEBUG block is copy-pasted.
- Why it harms future change: a change to the lock/log/timing protocol must be applied to both wrappers; the SYNC-DEBUG block (debug scaffolding shipped in production, `:294`/`:329`) is duplicated noise.
- Refactoring: Parameterize one `withPxe(mode: "read"|"write", ...)`; extract `logSyncState(pxe, node, label)`. Consider deleting the SYNC-DEBUG scaffolding outright.
- Effort: hours
- Confidence: high

---

### AR-11 Schnorr account-contract init duplicated in `NuloAccount`
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: local
- Blast radius: 1 file
- Instances: `account/nulo-account.ts:54-57` (`new`: `deriveSigningKey` → `new SchnorrAccountContract` → `getInitializationFunctionAndArgs`) and `:193-198` (`buildWithInitialization`: same three calls to re-derive `constructorArgs`).
- Evidence: `buildWithInitialization` rebuilds the signing account + initializer purely to recover `constructorArgs`, which `new` already computed at `:61`. The ctor stores `secret`, `instance`, `completeAddress`, `signingAccountContract` but not the init result.
- Why it harms future change: if upstream changes `getInitializationFunctionAndArgs` shape (the README flags `aztec-packages#5837` as the exposure point), both sites must change. The recompute is also wasted work on the deploy path.
- Refactoring: cache `constructorArgs`/initializer on the instance in `new`, reuse in `buildWithInitialization`. One derivation.
- Effort: hours
- Confidence: moderate

---

### AR-12 (LOW) Residual typing nits
- Smell: Primitive Obsession (unbranded domain ids) + boilerplate suppression
- Lens: typing
- Maintenance impact: cosmetic
- Instances:
  - Unbranded ids crossing the package + RPC seam: `chainId: number`, `profileId: string`, `rpcUrl: string` (`chain-runtime.ts:52-56`), the composite `(l1ChainId ^ rollupVersion) >>> 0` (`utils/chain-identity.ts:52`), `getBlockTimestamp`'s bare `number | undefined` epoch-seconds (`spec.ts:74`, `client.ts:191`).
  - 4× `// @ts-expect-error — raw JSON import via vite alias`: `known-artifacts.ts:18,20`, `note-schemas.ts:5,7`.
- Evidence: nothing distinguishes a `chainId` from a `blockNumber` at the type level; a `declare module "@*-artifact"` shim would type the JSON imports and delete the 4 suppressions.
- Why it harms future change: low — but a transposed `profileId`/`rpcUrl` (both `string`) would typecheck.
- Refactoring: branded types for the ids (the repo already uses `@aztec/foundation/branded-types`, e.g. `BlockNumberSchema` in `schemas.ts:7`); a typed module shim for the artifact aliases.
- Effort: hours
- Confidence: moderate

---

## Positive patterns (keep — do NOT flag)
- `isAllowedRpcUrl` returns a `{ ok: true } | { ok: false; reason }` DU (`adapters/aztec-node-factory-adapter.ts:32-47`) — the right shape; AR-3 should mirror it.
- `subset.ts:48-60` compile-time `Equal<>`/`Expect<>` asserts pin the method-name boundary — the correct partial mitigation given AR-1 isn't yet fully derived.
- `artifact-class-id.ts` DI-port verifier (`ArtifactClassIdVerifier` + `DefaultArtifactClassIdVerifier`) — clean seam, testable.
- `completeFeeOptions` (`account/fee-options.ts`) already centralizes the standard+fast fee translation it was extracted to dedupe — keep; only its `unknown` inputs (AR-8) and casts (AR-6) are the issue.

## Out-of-focus notes (correctness/security/doc — not scored as quality)
- README drift: `README.md:62` and `chain-runtime.ts` comment cite `@aztec` `4.2.0`; `package.json` pins `5.0.0-rc.1`. `service.ts:362` comment cites `@aztec/pxe@4.2.0`. README file-map omits `subset.ts`, `schemas.ts`, `note-schemas.ts`, `utils/chain-identity.ts`.
- Known gap (already documented, not a new finding): `assertLiveChainIdentity` is NOT called inside `nulo-account.ts:buildTxExecutionRequest` (`chain-identity.ts:21-24`, `nulo-account.ts:103`) — chain-spoofing defense has a hole on the signing path. Flagged here only because it intersects the `node.getNodeInfo()` call at `nulo-account.ts:103`.
- `service.ts:530-534` fire-and-forget `deleteDatabase` swallows blocked/errored deletes silently (correctness, folded into AR-5).

## Summary
12 findings (3 high-impact: AR-1, AR-2, AR-3). Highest value: **AR-1 — the 7-site hand-maintained PXE method surface**; deriving `IPXE`/`PXEProxy`/the zod map from `Methods` turns the single biggest change-amplification surface in the package into one source of truth.
