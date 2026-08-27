### Finding: Legacy IndexedDB `deleteDatabase` promise wrapper hand-duplicated three times

**Smell name:** Duplicate Code (Fowler).

**Maintenance impact:** structural. Blast radius: 1 file (`packages/aztec-runtime/src/pxe/service.ts`), but 3 call-site groups inside the two legacy-cleanup paths (`sweepOrphanStores`, `clearProfileState`) that back every profile/chain purge. Change frequency: `service.ts` has 13 commits since 2026-06-01 (highest churn file in the cluster) — this is a hot file, not a stable corner.

**Concrete evidence:** the same `indexedDB.deleteDatabase(name)` → Promise wrapper is written three separate times with subtly different `onblocked` behavior:
- `sweepOrphanStores`, orphan-DB loop, `service.ts:242-250` — `onblocked` calls `resolve(false)` (skip, don't hang).
- `sweepOrphanStores`, shared `keyval-store` cleanup, `service.ts:259-267` — `onblocked` calls `resolve()` (treats blocked as done).
- The extracted, timeout-hardened `deleteDb` private method, `service.ts:760-775` — `onblocked` sets a 5s timer that **rejects** on timeout, and is the one used everywhere else (`clearChainState` at `service.ts:643`, `clearProfileState` at `service.ts:685` and `:693`).

Confirmed via grep: only `deleteDb`'s three call sites (643, 685, 693) reuse the extracted helper; the two `sweepOrphanStores` sites at 242-250 and 259-267 re-implement the executor inline instead. This is a distinct, still-open item — not the "six hand-rolled promise caches" already unified by `async-memo` (2026-08-14 dedup audit, Q-04/#376), which is a different, already-remediated duplication.

**Why it harms future change:** a future fix to IndexedDB-delete handling (e.g. a browser quirk report, adding telemetry, or changing the "resolve vs reject on blocked" policy) will naturally be made in `deleteDb` since that's the named, documented method — and the two inline copies in `sweepOrphanStores` will silently keep the old (possibly buggy) behavior unless the author remembers to hunt down both. The three copies already disagree on error-vs-best-effort semantics, so a reader can't currently tell whether that's intentional divergence or drift.

**Smallest safe refactoring:** Extract Method (already 2/3 done) — route `sweepOrphanStores`'s two inline deletes through `deleteDb`, adding a mode/timeout parameter (e.g. `deleteDb(name, { onBlockedTimeoutMs, treatBlockedAsSuccess: true })`) so the deliberate best-effort-vs-fail-closed distinction becomes an explicit, visible argument instead of two silently-forked implementations.

**What disappears:** ~26 lines of duplicated `Promise` executor boilerplate collapse into 2 call sites of the existing helper; the "resolve on blocked" vs "reject on blocked" behaviors become one documented parameter instead of an implicit difference a reader has to infer by diffing three code blocks.

**Instances:** `packages/aztec-runtime/src/pxe/service.ts:242-250`, `:259-267`, `:760-775` (root/shared implementation).

---

### Finding: Purge-epoch anti-resurrection check duplicated between `withPxeRead` and `withPxeWrite`

**Smell name:** Duplicate Code (Fowler).

**Maintenance impact:** structural. Blast radius: 1 file (`service.ts`), but both of the package's two universal op-wrapper methods — every one of the 20 public `PxeService` RPC methods routes through one of these two functions, so this is maximally central, not a leaf. Change frequency: `service.ts`, 13 commits since 2026-06-01, several explicitly about this exact concurrency-fencing area (`fix(pxe): re-imported profile boots past its predecessor's tombstone…`, `feat(aztec): 5.0.1 line … #281 fence …`).

**Concrete evidence:** both methods independently (a) snapshot the purge epoch at entry and (b) re-check it before allowing a runtime rebind, with the identical `this.chainPurgeEpochs.get(this.chainKey(...)) ?? 0` expression and near-identical throw:
- `withPxeRead`: snapshot at `service.ts:828`, re-check + throw at `service.ts:844`.
- `withPxeWrite`: snapshot at `service.ts:879`, re-check + throw at `service.ts:889`.

Both blocks exist to guard the exact same invariant (documented at `service.ts:132-137`, the "#281 review" anti-resurrection fence) but are two independent hand-written copies, not a shared helper.

**Why it harms future change:** this is precisely the kind of subtle concurrency logic this file's own comments show the team has repeatedly had to re-derive and patch (the "#281 D3/D4" fencing history, the "concurrency audit MED #4" comment at `service.ts:885-888` noting the write path was *once already* found to be missing this exact check that the read path had). A future tweak to the fencing behavior (better diagnostics, a metric, a relaxed retry condition) made in one method and not the other silently reintroduces the same class of bug this code was written to close.

**Smallest safe refactoring:** Extract Method — a shared private helper, e.g. `private assertPurgeEpochUnchanged(label: string, network: NetworkInfo, epochAtEntry: number): void` (plus a `currentPurgeEpoch(network)` accessor to also collapse the snapshot expression), called identically from both `withPxeRead`'s rebind step and `withPxeWrite`.

**What disappears:** 2 duplicated epoch-snapshot expressions and 2 duplicated compare-and-throw blocks collapse into one helper; a correction to the anti-resurrection check is then structurally guaranteed to apply to both the read and write paths.

**Instances:** `packages/aztec-runtime/src/pxe/service.ts:828`, `:844` (withPxeRead); `:879`, `:889` (withPxeWrite).

---

### Finding: `(profileId, chainId)` passed as split primitives instead of the package's own `ChainCoordinates` value object

**Smell name:** Primitive Obsession → Data Clumps (Fowler). The package already models the coordinate as a value type (`ChainCoordinates` in `chain-coordinates.ts`) and several functions correctly take it as one object (`chainRegistryKey`, `chainDataDir`), but the two files that use it most — `service.ts` and `chain-runtime.ts` — bypass that type and keep re-splitting/re-boxing the pair as two positional primitives.

**Maintenance impact:** structural. Blast radius: `pxe/service.ts` and `pxe/chain-runtime.ts` directly; `pxe/spec.ts` (the `Methods` RPC contract) and `pxe/client.ts` would also need touching if `clearChainState`'s public/wire signature were ever converted, since it's part of the typed RPC surface. Change frequency: `service.ts` 13 commits, `chain-runtime.ts` 4 commits since 2026-06-01.

**Concrete evidence:**
- `chain-coordinates.ts:11-14` defines `ChainCoordinates = { profileId: string; chainId: number }`; `chainRegistryKey`/`chainDataDir` (`:20`, `:30`) correctly take it as one object.
- `service.ts:172` `private chainKey(profileId: string, chainId: number)` immediately re-boxes into `chainRegistryKey({ profileId, chainId })` — it exists solely to undo the split its own caller performed.
- `service.ts:176` `getChainGuard(profileId, chainId)`, `service.ts:626` `clearChainState(profileId, chainId)` (calls `chainKey`/`getChainGuard` 3 times with the split pair at `:628`, `:638-639`, `:641`).
- `chain-runtime.ts:269` `ChainRuntimeRegistry.key(profileId, chainId)`, `:276` `peek(profileId, chainId)`, `:356` `dispose(profileId, chainId)` — same split-then-reassemble pattern, independently reinvented in a sibling file.
- Contrast: the network-op paths (`withPxeRead`/`withPxeWrite`) already take a single `NetworkInfo` (which itself embeds `profileId`+`chainId`) — so the codebase already knows the better pattern; only the "administrative" methods regressed to the split form.

**Why it harms future change:** every future admin-level chain operation (e.g. a new "suspend" or "pin" concept) that needs this coordinate will be tempted to keep adding `profileId, chainId` as two more positional parameters rather than accepting the value object that already exists, compounding the debt. It also means a future change to what identifies a chain (e.g. adding a rollup-epoch discriminator to `ChainCoordinates`) can't be verified complete by checking one type — the split call sites in `service.ts` and `chain-runtime.ts` must be hunted down and updated by hand.

**Smallest safe refactoring:** Introduce Parameter Object (Fowler) — already half-modeled: change `chainKey`, `getChainGuard`, `ChainRuntimeRegistry.key`/`peek`/`dispose` to accept `ChainCoordinates` directly, mirroring `chainRegistryKey`/`chainDataDir`'s existing signature shape; `clearChainState`'s external/wire signature can stay `(profileId, chainId)` and construct the object once at the boundary.

**What disappears:** the repeated "re-box two primitives into the object the codec functions actually want" step at ~6 call sites, and the two near-duplicate private `key`/`chainKey` methods that exist only to perform that re-boxing.

**Instances:** `packages/aztec-runtime/src/pxe/service.ts:172-184`, `:626-643`; `packages/aztec-runtime/src/pxe/chain-runtime.ts:269-278`, `:356-359`; contrast baseline: `packages/aztec-runtime/src/pxe/chain-coordinates.ts:11-14`, `:20-22`, `:30-32`.

---

### Finding: `buildTxExecutionRequest` / `IAccountContract.buildTxExecutionRequest` — 6-parameter positional signature

**Smell name:** Long Parameter List (Fowler).

**Maintenance impact:** structural. Blast radius inside the cluster: `packages/aztec-runtime/src/account/nulo-account.ts` (implementation) and `packages/aztec-runtime/src/account/index.ts` (the `IAccountContract` interface declaration both must stay in lockstep with). Outside the cluster (cited only as change-cost evidence, not audited): 3 call sites in `apps/extension` reproduce the same 6-argument positional call shape. Change frequency: `nulo-account.ts` 4 commits since 2026-06-01.

**Concrete evidence:** the signature takes 6 positional parameters of similar/related shape:
```
buildTxExecutionRequest(node: AztecNode, pxe: IPXE, payload: ExecutionPayload, options: DefaultAccountEntrypointOptions, chainInfo: ChainInfo, gasSettingsRPC?: PartialGasSettingsRPC)
```
— declared at `account/nulo-account.ts:116-123`, mirrored in the interface at `account/index.ts:29-36`. Every call site (`apps/extension/src/wallet/utils/fn.ts:95-104`, `apps/extension/src/wallet/services/execution/tx-request-builder.ts:360-371`, `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:453-462`) passes `node, pxe, payload, {cancellable, txNonce, feePaymentMethodOptions}, chainInfo[, gasSettings]` in the same fixed order, with nothing but positional convention enforcing it.

**Why it harms future change:** adding, removing, or reordering an input requires touching the interface declaration, its implementation, and every call site's positional argument list by hand; nothing stops two same-shaped arguments from being silently swapped at a call site except structural type luck. A future required addition (e.g., an explicit sender override) has no natural single insertion point.

**Smallest safe refactoring:** Introduce Parameter Object (Fowler) — group the tx-construction inputs (at minimum `node`+`pxe`, which are always passed together as the "chain access" pair, or the full argument set) into one object, consistent with the value-object style the package already uses for `NetworkInfo`/`ChainCoordinates` elsewhere.

**What disappears:** the 6-positional-argument call shape duplicated near-identically across 3+ call sites; future signature growth becomes "add a field to the object" instead of "edit every call site's argument list in the same order."

**Instances:** `packages/aztec-runtime/src/account/nulo-account.ts:116-123`; `packages/aztec-runtime/src/account/index.ts:29-36`.

## Non-findings considered

- `pxe/index.ts`'s 12-file re-export fan-in — a plain barrel with no delegation logic (not Middle Man); widest by import count only, not by coupling/complexity, per the orientation map's own framing.
- The "six independently-invented promise caches" the map flagged — already remediated by the 2026-08-14 dedup audit (Q-04, PR #376, unified into `async-memo.ts`'s `memoizeAsync`/`memoizeAsyncBy`); current 5 call sites are the post-fix state.
- `PXEProxy` (proxy.ts) vs. `PxeServiceClientBase` (client.ts) structural similarity — deliberate non-duplication: proxy.ts is runtime-generated from `descriptors.ts` specifically to avoid duplicating client.ts's hand-written, zod-validated bodies; confirmed by descriptors.ts's own stated design goal.
- `client.ts`'s ~25 near-identical `request(...) → Schema.parseAsync(...)` method bodies — genuinely repetitive but each carries a distinct schema/shape and a documented rationale (`descriptors.ts` explicitly states body generation was rejected because validation/timeout logic is hand-written per method); no observed drift instance, so not flagged as measurable duplication cost.
- Untested pure/type-only modules (`effective-class.ts`, `artifact-class-id.ts`, `ipxe.ts`, `spec.ts`, `schemas.ts`) — all are pure functions or type declarations with no hidden global/DI coupling; nothing structurally resists testing them, so "untested" alone isn't a named smell here (per task instructions).
- `adapters/aztec-node-factory-adapter.ts` and `utils/fetch.ts` (untested per the map) — `isAllowedRpcUrl` is a pure function, and `fetch`/`AbortController`/`setTimeout` are standard globally-stubbable browser APIs; no structure resists testing.
- `onActiveProfileChanged` no-op subscriber, never unsubscribed (`service.ts:210`, `:906-914`) — explicitly documented deliberate design (Phase 2 Week 3); the service is a process-lifetime singleton, so there is no leak.
- `chain-runtime.ts`'s `buildRuntime` proverless/production branches each ending in `createPXE(...)` + `return new ChainRuntime(...)` — a 2-line echo, cosmetic scale, not worth a named-smell flag.
- `public-events.ts`'s `fetchPublicTokenTransferEvents` (~110 lines, several validation stages) — a Long Method candidate on line count alone, but each branch is an independently-tracked hostile-input guard (codex R1-R4 audit findings cited inline); extracting would add indirection without reducing the real complexity driver (the number of distinct threat models the function must reject).
- `NuloAccount` constructor's 5 DI parameters — single call site (`NuloAccount.new`'s static factory); not a change-amplification risk.

## Bug handoffs

None surfaced within the context cap for this cluster.