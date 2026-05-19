# M2.3 — Narrow `PxeService` (4 sub-PRs, ~2 weeks)

## Context & entry state

PxeService is the **offscreen-hosted facade** over `@aztec/pxe`. Today: ~789 LOC across `service.ts` (494) + `client.ts` (155) + `proxy.ts` (107) + `spec.ts` (33). Lives at `packages/extension/src/wallet/services/pxe/` with the offscreen document entry point at `packages/extension/src/offscreen/index.ts`.

M2.3's goal is NOT to split into a facade like M2.1 / M2.2. It's to **narrow the responsibilities** so:
- Per-chain state lives in a `ChainRuntime` class, not scattered maps.
- Artifact resolution has an explicit policy (local → known → remote) with pinning hooks.
- Every caller doesn't re-run `ensureOffscreenRunning()` — the transport base does it.
- Concurrency guard actually drains readers (today it doesn't — profile-switch race exists).

### Targets (from `architecture/plan/03-final-plan-v3.md:163-168`)

**Execution order: d → a → b → c** (post-audit correction). M2.3-d is the only sub-PR fixing correctness today (profile-switch races). Shipping a/b/c atop the broken guard means intermediate commits carry the race. d first isolates.

| Sub-PR | Extract | Est. |
|---|---|---|
| **M2.3-d (first)** | **Finish `ReadWriteGuard`** — reader counting + drain + bounded read-I/O + reentry fail-fast + force-release | 3d |
| M2.3-a | `ChainRuntime` — per-chain PXE + node, keyed by (chainId, profileId) | 3d |
| M2.3-b | `ArtifactRegistry` with explicit policy (local → known → remote), registry pinning | 3d |
| M2.3-c | **(renamed)** `ensureOffscreenRunning` hoist — move into ServiceClient transport base via template-method + hook | 2d |

### Entry state (verified via discovery — 2026-04-22)

- **Per-chain maps** at `service.ts:67-72`: `nodes`, `pxes`, `rpcs`, `chainInitPromises`. Keyed by `network.chainId`.
- **Lazy initialization** (`ensureChain` at 344, `initChain` at 397): creates AztecNode + PXE per chainId, data dir `pxe/{profileId}/{chainId}`.
- **ensureOffscreenRunning** at `src/wallet/utils/offscreen.ts:101-134`: called by **every** `PxeServiceClient` method (20 call sites in `client.ts`). Not centralized.
- **Artifact resolution** at `service.ts:146-163` + `413-450`: 3-tier fallback — PXE local → `knownArtifacts` Map (10 hardcoded entries at 318-332) → remote registry (gated on `config.contractRegistry`).
- **Registry URLs** at `service.ts:452-460`: testnet → `testnet.aztec-registry.xyz`, devnet → `devnet.aztec-registry.xyz`, others undefined.
- **ReadWriteGuard** stub at `src/wallet/utils/rw-guard.ts` (56 LOC): writes serialize, reads bypass. **No reader counting, no drain.** Profile-switch clears per-chain maps while reads may be in flight at `service.ts:367` — races are real but haven't surfaced because the read gap is narrow.
- **Transport base** (M1-RT) at `src/wallet/base/offscreen/{service,client}.ts`: already exists. `Service<TRequests>` + `ServiceClient<TRequests>`. Both use `chrome.runtime.sendMessage` directly. `ensureOffscreenRunning` hasn't been pulled in.
- **Profile-switch handler** at `service.ts:483-492`: clears per-chain state. Calls `guard.enterWrite()` but since readers don't count, the serialize is cosmetic.
- **Profile-delete handler** at `service.ts:463-480`: same + deletes IndexedDB `pxe/{profile.id}/*` directories.

### Consumers (who depends on current behavior)

| Consumer | File | What breaks if PxeService changes |
|---|---|---|
| ExecutionService | `execution/service.ts:614, 620, 1074, 1093, 1098, 1110, 1163` | Uses `getContractArtifact`, `getContractInstance` — M2.2-c wraps these via ContractResolver |
| TokenBalanceService | `token-balance/service.ts:223, 308, 401` | Calls `getPXE(network)` + `pxe.getNotes()`, `pxe.getContractInstance()` via proxy |
| NoteService | `note/service.ts` | Same pattern as TokenBalance |
| NetworkService | (read-only) | PxeService reads `network.rpcUrl`, `network.chainId`, `network.profileId` |
| ProfileService | `onActiveProfileChanged`, `onProfileDeleted` events | M2.3-a + M2.3-d change WHEN state clears, not the trigger |

## Architecture invariants (preserved across all 4 sub-PRs)

1. **RPC surface frozen** — `spec.ts` methods unchanged; client API unchanged.
2. **Data-dir paths frozen** — `pxe/{profileId}/{chainId}` IndexedDB naming preserved. Changing this detaches every existing PXE state from its profile.
3. **Known-artifact list frozen** — the 10 hardcoded class IDs at `service.ts:318-332` stay locally compiled-in. M2.3-b doesn't move them to remote; it just puts them behind a policy.
4. **Offscreen lifecycle unchanged** — M2.3-c moves WHERE `ensureOffscreenRunning` is called, not WHAT it does.
5. **Guard semantics preserved for non-race cases** — if no concurrent profile switch, read behavior is byte-identical.
6. **Registry URL scheme frozen** — testnet/devnet registry hosts unchanged.
7. **Read/write method classification preserved** — today's PxeService has a deliberate read/write split (service.ts:129 reads vs service.ts:166 writes; `simulateTx` at service.ts:242 is a **write**, not a read). M2.3-d does NOT re-classify. Audit caught the plan mistakenly implying "all methods wrap `guard.read`".

## Per-sub-PR specifications

### M2.3-a — `ChainRuntime` (per-chain PXE + node)

**Purpose**: Replace the 3 parallel maps (`nodes`, `pxes`, `rpcs`) with a single `Map<RuntimeKey, ChainRuntime>`. Each ChainRuntime owns one node + one PXE + the RPC URL it was created against. Lifecycle centralized.

**Identity — audit-corrected**: runtime key MUST include `profileId` in addition to `chainId`. Today the PXE data dir is `pxe/{profileId}/{chainId}` (service.ts:401) and `Network` carries `profileId` (network/spec.ts:11). A profile switch during or just after `getOrInit()` can reinsert an old-profile runtime or let a queued read use a stale handle. The key is either `` `${profileId}:${chainId}` `` or a `(generation, chainId)` tuple where `generation` bumps on every profile change.

**New file**: `src/wallet/services/pxe/chain-runtime.ts`

**Surface**:
```ts
/**
 * Holds the AztecNode + PXE pair for a single chain. Created lazily on
 * first access, torn down when the profile changes.
 */
export class ChainRuntime {
  public constructor(
    public readonly chainId: number,
    public readonly node: AztecNode,
    public readonly pxe: PXE,
    public readonly rpcUrl: string,
  ) {}

  /** Shut down the PXE and release node handles. Called during profile
   *  switch / profile delete. */
  async dispose(): Promise<void>
}

/** Factory + registry owned by PxeService. Encapsulates the per-chain
 *  init promise so concurrent callers don't double-initialize a chain.
 *  Keyed by (profileId, chainId) to eliminate the cross-profile identity
 *  bug flagged in the audit. */
export class ChainRuntimeRegistry {
  public constructor(
    private readonly guard: ReadWriteGuard,          // M2.3-d contract
    private readonly pxeFactory: PxeFactory,
    private readonly profileId: () => string,
  ) {}

  /** Lazy-init for `(profileId, chainId)`. Deduped via an internal
   *  init-promise map so concurrent callers share the same init.
   *  Snapshots active profileId at entry; if the profile changes
   *  mid-init, the resolved runtime is DISPOSED and `getOrInit` re-runs
   *  under the new profile. Generation-checked under the guard. */
  async getOrInit(network: Network): Promise<ChainRuntime>

  /** Returns the active runtime for (profileId, chainId) if initialized,
   *  else undefined. No side effect. Used during teardown to avoid
   *  initializing runtimes just to dispose them. */
  peek(profileId: string, chainId: number): ChainRuntime | undefined

  /** Dispose every runtime. Called from onActiveProfileChanged /
   *  onProfileDeleted. `dispose()` is POST-DRAIN cleanup only —
   *  `pxe.stop()` drains the job queue rather than aborting in-flight
   *  work (verified via upstream @aztec/pxe source in audit). Correctness
   *  across profile switch comes from LOCK ORDERING, not teardown. */
  async clear(): Promise<void>
}
```

**What moves**:
- `nodes`, `pxes`, `rpcs`, `chainInitPromises` maps (service.ts:67-72) → `ChainRuntimeRegistry` internals.
- `ensureChain` (344), `initChain` (397), `hasChain` (394) → ChainRuntimeRegistry methods.
- `onActiveProfileChanged` / `onProfileDeleted` map clearing (483-492, 463-480) → `registry.clear()`.

**What stays in PxeService**:
- RPC method bodies (they now call `registry.getOrInit(network)` and read `.pxe` / `.node`).
- Event wiring to ProfileService.
- IndexedDB directory cleanup on profile delete (it's not chain-specific).

**PxeFactory abstraction**: M2.3-a introduces a seam so tests can inject a fake runtime:
```ts
export interface PxeFactory {
  createChainRuntime(network: Network, profileId: string): Promise<ChainRuntime>
}
```
Production impl uses `createAztecNodeClient` + `createPXE` (today's inline logic).

**Test strategy**:
- Unit: `chain-runtime.test.ts` + `chain-runtime-registry.test.ts` with a FakePxeFactory. Verify: dedup of concurrent inits, clear() disposes everything, peek() non-side-effecting.
- Integration: unchanged (PxeService still works end-to-end).

**Rollback**: Drop-in; revert the one file + PxeService field.

---

### M2.3-b — `ArtifactRegistry` (explicit policy + pinning)

**Purpose**: Extract artifact resolution into a class with an explicit **policy object** that callers (or config) can swap. Today's resolution is hardcoded: local → known → registry; M2.3-b makes the order + per-class pinning configurable.

**New file**: `src/wallet/services/pxe/artifact-registry.ts`

**Surface**:
```ts
export type ArtifactSource = "pxe-local" | "known" | "registry"

export type ArtifactPolicy = {
  /** Resolution order. Default: ["pxe-local", "known", "registry"]. */
  order: ArtifactSource[]

  /** Per-class pin: if `byClassId[classId]` is set, resolution SKIPS
   *  all sources except the named one. Use "known" to force the
   *  compiled-in version for a protocol contract. */
  byClassId?: Record<string, ArtifactSource>

  /** Kill-switch: if false, "registry" source is disabled globally
   *  (equivalent to today's `config.contractRegistry` toggle). */
  allowRegistry: boolean
}

export class ArtifactRegistry {
  public constructor(
    private readonly knownArtifacts: Map<string, ContractArtifact>,  // compile-time pins
    private readonly config: ConfigService,                          // read policy at boot + on-update
    private readonly fetcher: RegistryFetcher,                       // remote artifact fetcher (seam)
  ) {}

  /** Resolve an artifact by class id, consulting PXE first (via callback)
   *  then applying the policy order. Equivalent of today's
   *  getContractArtifact flow at service.ts:146-163. */
  async resolve(
    classId: Fr,
    pxeLookup: (id: Fr) => Promise<ContractArtifact | undefined>,
    network: Network,
    opts?: { pxeOnly?: boolean },
  ): Promise<ContractArtifact | undefined>
}

export interface RegistryFetcher {
  fetchArtifact(classId: Fr, network: Network): Promise<ContractArtifact | undefined>
}
```

**What moves**:
- `knownArtifacts` Map + `loadKnownArtifacts` (service.ts:318-341) → ArtifactRegistry constructor.
- `fetchArtifactFromRegistry` (413-450) → `RegistryFetcher` impl.
- `getRegistryUrl` (452-460) → RegistryFetcher impl internals.
- Policy application (the fallback chain at 146-163) → ArtifactRegistry.resolve.

**What stays in PxeService**:
- `getContractArtifact` method body becomes `this.artifacts.resolve(classId, pxe.getContractArtifact, network, opts)`.
- Schema validation + logging of the call path.

**Cross-cut with M2.2-c**: ContractResolver (M2.2-c) calls `pxeServiceClient.getContractArtifact`. The PxeService method now delegates to ArtifactRegistry. **Order**: M2.2-c ships first (or parallel); M2.3-b doesn't change ContractResolver's API.

**Pinning — the "registry pinning" deliverable**: today we have no pinning. M2.3-b ships the `byClassId` pin DICTIONARY + config UI wiring (staff-only setting, not user-visible). This lays groundwork for "compliance mode" where only pinned artifacts load.

**Test strategy**:
- Unit: `artifact-registry.test.ts` with a FakeRegistryFetcher. Verify: order respected, pin bypasses order, allowRegistry=false skips registry, pxeOnly flag bypasses fallbacks.
- Integration: unchanged.

**Rollback**: Drop-in.

---

### M2.3-c — Centralize `ensureOffscreenRunning` in `ServiceClient` transport base (RENAMED)

**Renaming** (post-audit): the original "PxeProcessSupervisor" name was misleading. This PR doesn't build a process supervisor — the real supervisor (ghost detection, zombie cleanup, ping/pong) already lives inside `ensureOffscreenRunning` at `utils/offscreen.ts:101-134`. All we're doing is hoisting the call site. Pick a plain descriptive name.

**Purpose**: Today **every** `PxeServiceClient` method opens with `await ensureOffscreenRunning()`. Duplicated 20× in `client.ts`. Move this responsibility into the `ServiceClient` base class.

**Files touched**:
- `src/wallet/base/offscreen/client.ts` — base class gets a `ensureTransportReady()` protected hook.
- `src/wallet/services/pxe/client.ts` — remove all 20 `ensureOffscreenRunning()` calls.
- `src/wallet/utils/offscreen.ts` — stays as the implementation, now invoked from the base.

**Proposed ServiceClient modification** (`base/offscreen/client.ts`) — **template-method + hook pattern** (audit-corrected):
```ts
export abstract class ServiceClient<T extends MethodsMap> {
  /** Non-overridable template: runs base transport-readiness (so no
   *  subclass can forget `super`), then the subclass hook. */
  private async ensureReady(): Promise<void> {
    await ensureOffscreenRunning()
    await this.onReady()
  }

  /** Overridable hook: runs AFTER base readiness, for subclass-specific
   *  post-transport setup. Default is no-op. Do NOT call ensureOffscreenRunning
   *  from here — that's already done. */
  protected async onReady(): Promise<void> {
    // no-op by default
  }

  /** Internal: every request method calls this first. Base class
   *  handles the 20×-per-service repetition. */
  protected async request<K extends keyof T>(method: K, ...args: Params<T[K]>): Promise<Result<T[K]>> {
    await this.ensureReady()
    return await this.sendRpc(method, args)
  }
}
```

**Why template-method + hook, not a simple override** (audit finding): a simple protected method override requires subclasses to remember `super.ensureTransportReady()`. Forgetting it silently breaks readiness. The template-method + hook pattern makes the base-class work unskippable by construction.

**What to watch for**: some clients MIGHT legitimately not need offscreen readiness (e.g. if we later add a popup-hosted service client). The default is override-friendly; such a client passes `ensureTransportReady` = no-op.

**Test strategy**:
- Unit: `service-client.test.ts` (new file) verifies the base-class override fires exactly once per batch, respects overrides.
- Integration: e2e suite still runs — PxeServiceClient's behavior is identical from the caller's perspective.

**Rollback**: Drop-in. The `ensureOffscreenRunning()` function stays — just moves its invocation point.

---

### M2.3-d — Finish `ReadWriteGuard` (reader counting + drain + reentry + bounded I/O)  **[ships FIRST]**

**Purpose**: Today's guard at `src/wallet/utils/rw-guard.ts` has reads bypass the write lock entirely. Profile-switch clears state at `service.ts:483-492` while reads may be accessing the maps → race. M2.3-d fixes this with: reads count, writes drain, reentry fails fast, reader-counter has force-release, and READ-PATH I/O is bounded before we trust drain-wait.

**Why first**: M2.3-d is the only sub-PR fixing correctness today. a/b/c are refactors. Shipping them atop the broken guard means every intermediate commit carries the race, and QA regressions become ambiguously "race or refactor". Land d first to isolate.

**Pre-requisite (blocker)**: bound read-path I/O with timeouts BEFORE assuming infinite drain is safe:
- **Registry fetch** at `service.ts:426` uses raw `fetch()` with no timeout. Profile switch/delete can block forever on a stuck registry. Fix in M2.3-d: add `AbortController` + timeout (30s default).
- **Any other unbounded I/O** in the read-path: grep during implementation. Each must be bounded or documented as intentionally unbounded.

**File**: `src/wallet/utils/rw-guard.ts` (rewrite).

**New behavior**:
```ts
export class ReadWriteGuard {
  private readers = 0
  private writeActive = false
  private writeWaiting: Deferred<void>[] = []
  private readDrain: Deferred<void>[] = []

  /** Acquire a read "pass" — succeeds immediately if no writer is
   *  pending/active, otherwise waits for the writer to finish. Readers
   *  count; writer cannot start until count hits zero. */
  async read<T>(fn: () => Promise<T>): Promise<T>

  /** Exclusive write — waits for all active readers to drain, then runs
   *  exclusively. No reader or other writer runs until fn resolves. */
  async write<T>(fn: () => Promise<T>): Promise<T>

  /** Manual write-hold for destructive ops that span multiple awaits
   *  (e.g. IndexedDB cleanup on profile delete). Pair with leaveWrite. */
  async enterWrite(): Promise<void>
  leaveWrite(): void
}
```

**Invariants**:
- A read started before `write()` is called completes before the writer runs.
- A read started after `write()` is called but before fn is invoked waits for the writer.
- Multiple concurrent `read()`s all proceed in parallel.
- Multiple concurrent `write()`s serialize (FIFO).
- **Nested `write` from inside `read` FAILS FAST** — throws synchronously with a clear error. Enforced via `AsyncLocalStorage`-style dev-assertion (audit Q8 requirement). Documented.
- **5-minute force-release** on the reader counter (mirrors `Lock.MAX_HOLD_MS`) — if readers don't drain within MAX_HOLD_MS, the guard force-decrements + logs ERROR. Converts "forever hang" into "5-min hang + loud log" for debuggability.

**Test strategy** (`rw-guard.test.ts` significantly expanded — 6+ new tests per codex Q8):
- Existing tests preserved.
- NEW: **reader-arrives-after-writer-queued** — R1 in flight → W1 queued → R2 arrives → R2 must wait for W1.
- NEW: **enterWrite() drain** — readers active → `enterWrite()` → must wait for readers to complete.
- NEW: **rejection paths decrement counters** — reader fn throws → counter still decrements; writer fn throws → next writer can still run.
- NEW: **reentry fails fast** — `guard.read(() => guard.write(...))` throws synchronously with a clear message. NOT deadlocks.
- NEW: **writer FIFO / no starvation** — many readers + many writers; all writers eventually run in enqueue order.
- NEW: **stale-profile init race** — simulate the `ChainRuntimeRegistry.getOrInit` scenario where profile changes mid-init; assert stale runtime is disposed.
- NEW: **profile-switch race regression** — simulate the service.ts:483-492 scenario end-to-end with a fake PxeService; assert no stale map access.
- NEW: **5-min force-release** — reader counter stuck, verify force-decrement + error log after MAX_HOLD_MS.

**PxeService integration**:
- `onActiveProfileChanged` and `onProfileDeleted` switch to `guard.write(...)` with the map-clear logic inside the callback.
- All public methods wrap logic in `guard.read(...)` — already done today, but now reads actually count.

**Semantic change (DELIBERATE)**: Profile switch during an in-flight read now WAITS for that read to complete before clearing state. Previously the read could see a partially-cleared state. Document in the PR; UX impact: profile-switch latency increases slightly during busy moments (expected).

**Rollback**: The old rw-guard.ts is preserved at one git version back. If drain-on-write causes latency complaints we can flip to a "drain with 500ms deadline → cancel in-flight reads" variant, but that's out of scope for M2.3-d.

---

## Verification cadence (per sub-PR)

After each sub-PR:
1. `bunx vitest run src/wallet/services/pxe/` + `src/wallet/utils/rw-guard.test.ts` — all related units green.
2. `bun run typecheck` — no new errors.
3. `bun run build:chrome` — clean build.
4. `bun run test:e2e` — smoke 15/15.
5. `bun run test:e2e:all` — network 31/31, including the profile-switch flow in `wallet-lock.test.ts` + token load on `tokens.test.ts`.
6. Manual QA at M2.3-d: lock + unlock + network-switch during an active balance-refresh. No stale balance, no stuck UI.

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **M2.3-c base-class change** affects every offscreen-hosted client (today just PxeServiceClient, but future ones). Default override keeps behavior identical; still, base-class modifications warrant extra care. | LOW | Keep the change minimal (single protected method, single override in ServiceClient.request). Exhaustive e2e. |
| 2 | **M2.3-d reader-drain** introduces latency on profile switch during heavy reads. | MED | Document in PR. Add a benchmark showing tail latency. Ensure typical (<100ms) reads drain well below perception. |
| 3 | **M2.3-a teardown** ordering — ChainRuntime.dispose() may fail if PXE is mid-operation. | MED | dispose() aborts in-flight operations; PXE has a `stop()` method. Wrap in try/catch + log. Use guard to ensure no readers active first. |
| 4 | **ArtifactRegistry policy** not wired to config on every update — user toggles registry in settings but the in-memory policy stays stale. | MED | Subscribe to `config.onUpdate` in ArtifactRegistry ctor (same pattern SessionManager uses for sessionTtl). |
| 5 | **Cross-cut with M2.2-c** — ContractResolver (M2.2) and ArtifactRegistry (M2.3) both "resolve artifacts". The dependency stack is: ContractResolver → PxeServiceClient → ArtifactRegistry. Must be ordered correctly. | LOW | Landing order doesn't matter (M2.2-c ships without touching ArtifactRegistry; M2.3-b rewires PxeService internals). Documented in plan dependencies. |
| 6 | **Existing tests of rw-guard assume bypass behavior** — they pass because reads bypass writes today. After M2.3-d they should still pass (if they don't assert the buggy behavior). | LOW | Read every existing test during M2.3-d; update any that assume bypass. |
| 7 | **IndexedDB teardown on profile delete** (service.ts:473-480) runs BEFORE ChainRuntime.dispose — order matters for orderly shutdown. | LOW | M2.3-a preserves the order: `guard.write(clear + delete-dbs)`. |

## Pre-formulated codex audit questions (for M2.3 plan audit)

Q1. **Per-chain vs per-profile isolation**: today PXE data lives at `pxe/{profileId}/{chainId}`. After M2.3-a, does the ChainRuntime key include the profile id? Should `ChainRuntimeRegistry.getOrInit` reject calls if the profile changed under it mid-init?

Q2. **Reader-drain semantics**: M2.3-d makes writes drain readers. What's the right behavior if a reader is "stuck" (e.g., PXE simulateTx hangs)? Drain timeout? Kill-on-timeout? Current proposal is "drain indefinitely" — is that acceptable?

Q3. **ArtifactRegistry config-update timing**: when the user flips `contractRegistry` in settings mid-flow, does an in-flight artifact resolve use the old or new policy? Is there a correctness concern?

Q4. **PxeProcessSupervisor scope**: M2.3-c moves `ensureOffscreenRunning` into the base. Does the supervisor name imply more (e.g. restart on error, health-check)? Scope creep risk — should the PR scope be explicitly LIMITED to the move?

Q5. **M2.3-a ChainRuntime.dispose** — how do we guarantee a PXE mid-`simulateTx` cleanly stops? Is there a `@aztec/pxe` teardown API we should rely on, or do we just drop the handle?

Q6. **Known-artifact list mutation** — the 10 hardcoded artifacts at service.ts:318-332 are compile-time pins. After M2.3-b, where do they live (ArtifactRegistry ctor arg? Static field? Separate file?) and how does a developer add a new one?

Q7. **Profile-delete IndexedDB cleanup** — should this move into ChainRuntime.dispose (each runtime deletes its chain's DB) or stay at the PxeService level (single sweep across all chains)?

Q8. **ReadWriteGuard test completeness** — what scenarios are we NOT testing that could break? Nested read-in-write? Re-entry?

Q9. **Transport-base override ergonomics** — `ensureTransportReady` is a protected method on the base. Easy to forget to call `super.ensureTransportReady()` if overridden. Should the base provide a non-overridable template method + an overridable hook?

Q10. **What's the blast radius** if M2.3-d's reader-drain has a subtle bug (e.g. missed decrement) — does the wallet deadlock?

## Cross-M2.X dependencies (for the arc README)

- M2.2-c (ContractResolver) → uses PxeServiceClient.getContractArtifact → M2.3-b (ArtifactRegistry) rewires underlying impl. No API change for ContractResolver.
- M2.3-d (ReadWriteGuard) is a correctness fix for profile-switch races that materially affects today's behavior. **Priority-bump candidate**: consider landing M2.3-d before M2.2 starts if profile-switch stability matters to ongoing QA.
- M2.3-c (PxeProcessSupervisor) touches the base `ServiceClient` — any new client created during M2.2-f or M2.4 picks up the change.

## Open decisions for execution time

1. **ChainRuntime ownership of dispose logic vs registry** — dispose could live on ChainRuntime OR on the registry. Plan picks ChainRuntime for cohesion; confirm.
2. **Fallback RegistryFetcher behavior** on network error — retry? Swallow? Today: swallowed silently with a log. Plan preserves this. Any reason to change?
3. **Reader-drain timeout** — infinity vs 5s vs configurable. Plan: infinity. Reconsider if QA reports latency complaints.
4. **Policy pinning UI** — staff-only ConfigService field or hidden? Plan: hidden + settable via devtools console for now. Productionize later.
