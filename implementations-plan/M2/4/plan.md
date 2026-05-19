# M2.4 — Worker-heavy services (3 sub-PRs, ~2 weeks)

> **Pre-execution revision (2026-04-22)** — absorbed findings from a second codex-xhigh + general-purpose agent pass. Summary of deltas applied:
> - BalanceProjector ctor type `ExecutionServiceClient` → `ExecutionService`; BalanceJobQueue ctor type `TaskServiceClient` → `TaskService` (SW-local direct handles, not popup RPC clients).
> - M2.4-b scope extended to absorb `ProductionPxeFactory` (the stale `pxe/service.ts:398` caveat referenced a call site removed by M2.3-a; the live site is `pxe/chain-runtime.ts:53` in `ProductionPxeFactory.createChainRuntime`). After M2.4-b lands, zero `createAztecNodeClient` calls remain outside the `NodeFactory` adapter.
> - BalanceProjector signature changed from `project(account, balances, network)` to `project(balances)` — the Projector resolves account+network internally (mirroring today's `syncBatch`). Eliminates a type-lie-shaped precondition leak.
> - Worker semantics pinned: `BalanceJobQueue.tick()` drains the queue until empty, batching by first-account's chain, max 12 items per batch — matching today's `syncBatch` behavior byte-for-byte. NOT "one batch per tick".
> - Profile-switch stays no-op (current behavior preserved). `BalanceJobQueue.clear()` dropped from the surface — never called. Pre-existing stale-write race on profile-switch-during-in-flight-batch is **acknowledged as preserved**, not claimed fixed.
> - BackgroundTickerPort edge-case semantics specified: `onTick` throw swallowed + logged + future ticks continue; `cancel()` mid-tick lets the running tick finish + drops any pending coalesced tick.
> - Test-mock warnings added to each test-strategy section: use real `Fr` instances in BalanceProjector tests (POJO `Fr` fakes satisfy structural typing but skip the real Fr methods consumed by `viewFn.unpackResult`); FakeNodeFactory tests should explicitly note the JSON-RPC proxy error surface is unexercised; WindowManager tests must drive a spurious `onRemoved(otherWindowId)` to verify filtering.
> - Test cadence corrected: M2.4-b runs units + smoke + e2e network (touches live RPC proxy creation). M2.4-a runs the same. M2.4-c runs units + smoke, manual QA gate after. Second QA gate after M2.4-c (not just before).
> - GasBalanceCache entry-state claim dropped (it was never extracted in M2.2-f; still inline in `execution/service.ts`). Does not affect M2.4-a scope.
> - `window-port.ts:2-6` docstring reference to M3.5 for WindowManager extraction will be updated to M2.4-c when c ships.
> - Separate M2.4 audit artifacts at `codex-review.md` + `agent-review.md` next to this plan.

## Context & entry state

Three services that directly touch worker-unfriendly APIs (chrome.windows, chrome.alarms, inline factory constructors) — unblocking the "services constructable with fake ports" exit criterion for M3 package extraction.

### Targets (from `architecture/plan/03-final-plan-v3.md:170-176`)

| Sub-PR | Extract | Est. |
|---|---|---|
| M2.4-a | `TokenBalanceService` → `BalanceRepository` + `BalanceProjector` + `BalanceJobQueue` (uses `BackgroundTickerPort`) | 1w |
| M2.4-b | `NetworkService` — `NodeFactory` port injection (not inline `createAztecNodeClient`) | 2d |
| M2.4-c | `WindowManager` service — only thing calling `chrome.windows.create/remove`. `DappInteractionService` + `PasskeyService` route through it. Unblocks both for unit test. | 2-3d |

### Entry state (verified via discovery — 2026-04-22)

**TokenBalanceService** (`src/wallet/services/token-balance/service.ts`, 450 LOC):
- Runs a continuous background worker (init at 73, loop at 233-257): `while (true) { if (queue.length) syncBatch; await sleep(1000) }`.
- Queue: `Queue<number, TokenBalanceRaw>` (line 32) — per-id dedup + priority.
- Pending-task map: `Map<number, string>` — bridges balance id ↔ TaskService task id.
- Storage: `EntityStorage<TokenBalanceRaw>` at `"nulo:core:token-balances"` (line 31, StorageType.Local).
- Triggers that enqueue: user `refreshTokenBalance`, `onAccountAdded`, `onTokenAdded`, `onTokenUpdated`, `onTransactionUpdated` (smart refresh).
- **`onActiveProfileChanged`** (service.ts:148-156) ONLY swaps `this.profile` + reloads token metadata via `tokenService.getTokensRaw()`. It does **NOT** clear balances, clear the queue, or re-enqueue all balances. Persisted balances remain visible across profile switches (they're stored per-account, not filtered by profile). **M2.4-a preserves this behavior verbatim** — no deliberate semantic change on profile switch.
- Sync impl (line 259): builds `CallAction[]`, calls `executionService.executeSimulateViews()`, updates private/public balance fields.
- No `chrome.alarms` — just a `setInterval`-like `sleep(1000)` loop.

**NetworkService** (`src/wallet/services/network/service.ts`, 350 LOC):
- Four call sites of `createAztecNodeClient(rpcUrl, {}, makeFetchWithTimeout())`: 89, 210, 252, 280. All inline imports from `@aztec/stdlib/interfaces/client`.
- Node cache `Map<number, AztecNode>` (line 25), keyed by chainId.
- Cache cleared on profile switch (line 295).
- `getChainId(rpcUrl)` at 280 creates a one-shot node to validate RPC URL + read nodeInfo before persisting.

**Window-management call sites** (candidates for M2.4-c):
- PasskeyService (`src/wallet/services/passkey/service.ts:76-104`): `chrome.windows.create({ type: "popup" })` + `chrome.windows.onRemoved.addListener`. 5-min timeout. Maps `windowId → requestId`.
- DappInteractionService (`src/wallet/services/dapp-interaction/service.ts:194-220`): same pattern, 10-min timeout. Maps `windowId → interactionId`.
- wallet-sdk background (`src/wallet/services/wallet-sdk/background.ts:135`): fire-and-forget verification popup, no onRemoved listener. **3rd consumer flagged by discovery.**
- Chrome adapter impl (`src/core/adapters/chrome-browser-api.ts:162-180`): wraps `chrome.windows.*`. Already exposes `WindowPort`.

**Existing ports** (from `src/core/ports/`):
- `ClockPort` — exists, used widely.
- `BrowserApi` (facade over StoragePort, RuntimePort, WindowPort, AlarmsPort) — exists.
- `WindowPort` — exists at `src/core/ports/window-port.ts`. Interface: `create` / `remove` / `onRemoved`. **Not yet consumed by PasskeyService or DappInteractionService.**
- `AlarmsPort` — exists but zero usage.
- `BackgroundTickerPort` — **does NOT exist**. Nearest analog: `ClockPort.sleep` + `setInterval` pattern.
- `NodeFactory` — **does NOT exist**. Port index explicitly lists it as a future addition.

### Gap decisions (flagged by discovery)

1. **BackgroundTickerPort naming**: the plan uses this name. Discovery confirmed no port exists. **Decision**: M2.4-a ships the `BackgroundTickerPort` interface + a real adapter that wraps `ClockPort.setInterval`. **Alternative considered and rejected**: reuse `ClockPort.setInterval` directly — rejected because we want a higher-level "periodic background work" semantic that can later switch to `chrome.alarms` without caller changes (`chrome.alarms` survives SW suspension; `setInterval` doesn't).
2. **wallet-sdk verification popup** (3rd `chrome.windows.create` site): plan labels this out-of-scope but flags in risks. Follow-up PR after M2.4-c.
3. **TokenBalanceService sleep-loop testability**: the `while (true) { await sleep(1000) }` pattern is hard to drive in unit tests even with MockClock. **Decision**: M2.4-a replaces the continuous loop with a `BalanceJobQueue` that runs on `BackgroundTickerPort.tick()` events. In tests, the fake ticker fires manually. In prod, tick is every 1 second.
4. **ExecutionService.getGasBalances vs TokenBalance**: discovery flagged they share the same PXE-timeout concern. **Decision**: out of scope for M2.4. Both still call their respective ExecutionService methods; gas-balance caching is still inline in `execution/service.ts` (not extracted in M2.2-f despite earlier claim) but `BalanceProjector` only calls `executeSimulateViews`, not `getGasBalances`, so there's no interaction.

## Architecture invariants (preserved across all 3 sub-PRs)

1. **RPC surfaces frozen** — `TokenBalanceService`, `NetworkService`, `PasskeyService`, `DappInteractionService` all keep their `spec.ts` methods unchanged.
2. **Storage keys frozen** — `nulo:core:token-balances`, network storage key, etc. all preserved.
3. **Balance-sync semantics preserved** — same events fire, same batch size (12), same dequeue-until-empty-per-tick, same account-grouping. Just a different ticking mechanism. (No TTL — the service doesn't have a TTL concept; pre-revision plan incorrectly listed it.)
4. **Popup lifecycles preserved** — PasskeyService (5min) and DappInteractionService (10min) timeouts unchanged. `onRemoved` still fires on user close.
5. **Profile-switch cache invalidation** unchanged — `onActiveProfileChanged` still only swaps `this.profile` + reloads token metadata; balances/queue/pendingTasks remain untouched. **Known pre-existing stale-write race preserved, not fixed**: an in-flight `syncBatch` that crosses a profile switch can resolve networks under the new profile and write old-profile balance rows against a new-profile network. M2.4-a does NOT address this — file a follow-up PR (queue items carry profileId; drop on dequeue if stale) if QA ever reports it.

## Per-sub-PR specifications

### M2.4-a — `TokenBalanceService` split (→ `BalanceRepository` + `BalanceProjector` + `BalanceJobQueue` + `BackgroundTickerPort`)

**Purpose**: 
1. Make TokenBalanceService unit-testable without driving a real loop + clock.
2. Separate the 3 concerns — storage, balance projection (ExecutionService call + result normalization), work scheduling.

**New files**:
- `src/core/ports/background-ticker-port.ts` — port interface.
- `src/core/adapters/clock-ticker-adapter.ts` — production adapter (wraps ClockPort).
- `src/core/testing/fake-background-ticker.ts` — test double.
- `src/wallet/services/token-balance/balance-repository.ts`
- `src/wallet/services/token-balance/balance-projector.ts`
- `src/wallet/services/token-balance/balance-job-queue.ts`

**BackgroundTickerPort surface** (audit-corrected — serialized/coalescing contract, honest JSDoc):
```ts
export interface BackgroundTickerPort {
  /** Register a periodic tick for ASYNC background work.
   *
   *  CONTRACT (what this port guarantees that raw setInterval does NOT):
   *    - **Serialized**: at most ONE `onTick` invocation in flight at a time.
   *      If a tick is still running when the next interval fires, the new
   *      tick is COALESCED into a single pending slot (no backlog).
   *    - **`cancel()` prevents future delivery** (already-running tick
   *      completes; any coalesced pending tick is DROPPED; no further ticks).
   *    - **`onTick` errors are swallowed** — if the callback throws or the
   *      returned promise rejects, the port logs the error and continues
   *      future ticks. Failures do NOT leak the serialization slot (the
   *      `running` flag is always cleared in a try/finally).
   *
   *  WHAT THIS DOES NOT PROMISE:
   *    - Persistence across SW suspension. The default adapter wraps
   *      `ClockPort.setInterval` which pauses when the SW suspends.
   *      A future chrome.alarms-backed adapter is NOT swap-in-compatible
   *      at sub-30s cadences (chrome.alarms floor is 30s).
   *    - Exact timing. Ticks may be delayed by arbitrary JS work.
   *    - First-tick-on-subscribe. The first tick fires after `intervalMs`,
   *      not immediately. Callers that want a cold-start refresh enqueue
   *      work BEFORE calling `subscribe`.
   *
   *  If you don't need the serialized/coalescing contract, use
   *  `ClockPort.setInterval` directly. */
  subscribe(intervalMs: number, onTick: () => void | Promise<void>): TickerHandle
}

export interface TickerHandle {
  cancel(): void
}
```

**BalanceRepository surface** (storage ownership):
```ts
export class BalanceRepository {
  public constructor(browserApi?: BrowserApi) {
    // mirrors ProfileRepository / SessionManager pattern
  }

  /** Frozen root: nulo:core:token-balances. */
  async get(id: number): Promise<TokenBalanceRaw | undefined>
  async getAll(): Promise<TokenBalanceRaw[]>
  async set(id: number, balance: TokenBalanceRaw): Promise<void>
  async delete(id: number): Promise<void>
  async generateUniqueId(): Promise<number>
}
```

**BalanceProjector surface** (ExecutionService call + result merge):
```ts
export class BalanceProjector {
  public constructor(
    /** SW-local direct handle (NOT the popup-side ExecutionServiceClient).
     *  TokenBalanceService reaches ExecutionService in-process via
     *  `services.get(ExecutionService.name)`. */
    private readonly execution: ExecutionService,
    /** TokenService is also SW-local — we need it to resolve a token's
     *  `chainId`/`accountAddress` from its id when iterating balances. */
    private readonly tokens: TokenService,
    /** NetworkService (SW-local) — resolves the active Network for a
     *  given chainId so the projector can own the precondition
     *  ("these balances all target THIS network") internally rather
     *  than pushing it onto callers. */
    private readonly networks: NetworkService,
  ) {}

  /** Batch-project any set of balances. Resolves each balance's
   *  (account, network) pair internally from the token metadata;
   *  balances targeting different accounts/networks are grouped and
   *  projected as separate batches of up to 12. Mirrors today's
   *  `syncBatch` (service.ts:259-419) byte-for-byte. */
  async project(balances: TokenBalanceRaw[]): Promise<ProjectedBalance[]>
}
```

**BalanceJobQueue surface**:
```ts
export class BalanceJobQueue {
  public constructor(
    private readonly ticker: BackgroundTickerPort,
    private readonly repo: BalanceRepository,
    private readonly projector: BalanceProjector,
    /** SW-local direct handle, not TaskServiceClient. */
    private readonly tasks: TaskService,
    private readonly onBalanceUpdated: (b: TokenBalanceInfo) => void,
    private readonly onBalanceFailed: (b: TokenBalanceInfo, err: Error) => void,
  ) {}

  start(): void    // subscribe to ticker; no first-tick-on-start (see port contract)
  stop(): void     // cancel subscription

  /** Enqueue a balance for refresh. Two dedup layers preserved from today:
   *   - `Queue.priorityPass(balance)` — key fn `(x) => x.id`, prevents
   *     double-sync when the same balance is enqueued from multiple triggers.
   *   - `pendingTasks` per-id map — prevents double-creation of TaskService
   *     task records.
   *  Mirrors service.ts:108 + the Queue util's priority semantics. */
  enqueue(balance: TokenBalanceRaw): void

  /** Single tick: drain queue until empty, grouping by first-account's
   *  chain, batching up to 12 items per projector call. Matches today's
   *  `startWorker` + `syncBatch` flow — NOT "one batch per tick". */
  tick(): Promise<void>
}
```

Note: there is deliberately no `clear()` method. Profile switch does NOT clear the queue today (see invariant #5 above) and M2.4-a preserves that.

**What moves**:
- Queue + pendingTasks (lines 32-33) → BalanceJobQueue.
- `EntityStorage<TokenBalanceRaw>` (line 31) → BalanceRepository.
- `syncBatch` (259-419) → BalanceProjector.
- Loop (233-257) → replaced with `ticker.subscribe(1000, () => queue.tick())`. The loop's implicit "drain-until-empty-then-sleep-1s" behavior is preserved by `tick()` draining the queue synchronously per invocation.
- Trigger handlers (`onTokenAdded`, `onAccountAdded`, etc., 148-231) → stay on TokenBalanceService, now call `queue.enqueue(balance)`.

**What stays on TokenBalanceService (the facade)**:
- The Service<Methods> RPC scaffolding.
- Event subscriptions (onAccountAdded, onTokenAdded, onTransactionUpdated, onActiveProfileChanged).
- `onActiveProfileChanged` keeps its current body: swap `this.profile`, reload `this.tokens` metadata. Does NOT touch the queue.
- Public API delegates to repo/queue.

**Test strategy**:
- Unit: `balance-repository.test.ts` with FakeBrowserApi.
- Unit: `balance-projector.test.ts` with fake SW-local services. **Use real `Fr` instances in fixtures** — `executeSimulateViews` declares `Fr[][]` and the projector pipes results into `viewFn.unpackResult(...)` which invokes real `Fr` methods. POJO fakes of the form `{value: 0n}` satisfy structural typing but skip the real runtime path (same type-lie shape that caused the M2.1-c passkey regression). Build fixtures via `Fr.random()` / `Fr.fromString()`.
- Unit: `balance-job-queue.test.ts` with fake ticker — drive ticks manually, verify (a) drain-until-empty per tick, (b) batch size ceiling of 12, (c) both dedup layers (priorityPass key + pendingTasks), (d) onBalanceUpdated/onBalanceFailed firing on success/throw paths, (e) `onTick` throw is swallowed + logged + future ticks continue, (f) `cancel()` mid-tick drops pending coalesced ticks.
- Integration: unchanged (TokenBalanceService still works end-to-end).

**Rollback**: Drop-in (3 new files + rewire TokenBalanceService methods). The continuous loop can be re-introduced if tick-based scheduling causes surprises.

**Semantic change (DELIBERATE)**: Today a batch runs every 1000ms if the queue is non-empty; `syncBatch` drains until the queue is empty before the next sleep. Post-M2.4-a: byte-for-byte identical drain-and-sleep pattern, just re-expressed via the ticker. No user-visible change in cadence.

---

### M2.4-b — `NodeFactory` port + NetworkService injection + `ProductionPxeFactory` absorption

**Purpose**: Retire every `createAztecNodeClient(...)` call site outside the `NodeFactory` adapter. Today there are 5:
- NetworkService: `src/wallet/services/network/service.ts:89, 210, 252, 280` (4 sites)
- `ProductionPxeFactory.createChainRuntime`: `src/wallet/services/pxe/chain-runtime.ts:53` (1 site)

All 5 become `this.nodeFactory.createNode(rpcUrl)`. Post-M2.4-b, a lint guard (`no-restricted-syntax` on `createAztecNodeClient` outside `src/core/adapters/aztec-node-factory-adapter.ts`) can enforce "there is exactly one way to construct an AztecNode."

**New files**:
- `src/core/ports/node-factory-port.ts` — port interface.
- `src/core/adapters/aztec-node-factory-adapter.ts` — production adapter.
- `src/core/testing/fake-node-factory.ts` — test double.

**NodeFactory surface**:
```ts
export interface NodeFactory {
  /** Construct an AztecNode from an rpcUrl. Production impl calls
   *  createAztecNodeClient with makeFetchWithTimeout(). Tests pass a
   *  FakeNodeFactory that returns a deterministic in-memory node. */
  createNode(rpcUrl: string): AztecNode
}
```

**What changes in NetworkService**:
- Ctor accepts optional `nodeFactory?: NodeFactory`. Default: production adapter.
- Lines 89, 210, 252, 280: `createAztecNodeClient(...)` → `this.nodeFactory.createNode(rpcUrl)`.

**What changes in `ProductionPxeFactory`** (`src/wallet/services/pxe/chain-runtime.ts`):
- Ctor accepts `nodeFactory: NodeFactory`. Line 53 `createAztecNodeClient(...)` → `this.nodeFactory.createNode(network.rpcUrl)`.
- PxeService instantiates `new ProductionPxeFactory(new AztecNodeFactoryAdapter())` (or whatever the shared production adapter is). No behavioral change — the adapter hardcodes `makeFetchWithTimeout()` exactly as today's inline call does.

**Scope caveat retired**: the previous "pxe/service.ts:398 is out of scope" caveat is obsolete (M2.3-a moved that call into ProductionPxeFactory, which M2.4-b now absorbs). After this PR, zero `createAztecNodeClient` calls remain outside `src/core/adapters/aztec-node-factory-adapter.ts`.

**Test strategy**:
- Unit: new `network-service.test.ts` drives NetworkService with FakeNodeFactory. Verify getNetwork, setDefault, getNodeStatus, getChainId happy paths + error-on-invalid-rpc.
- **Test-mock warning**: `createAztecNodeClient` returns a `createSafeJsonRpcClient` proxy that validates params against `AztecNodeApiSchema` and throws marshalled JSON-RPC errors. A `FakeNodeFactory` that returns a plain POJO satisfies the `AztecNode` interface trivially but **does not exercise the proxy's error surface** (e.g., `getChainId`'s catch block at `network/service.ts:286`). Document this in the test file comment; consider a separate `*.integration.test.ts` that uses the production adapter pointed at a test node if deeper validation is needed later.
- Existing unit: `chain-runtime.test.ts` already injects a `PxeFactory`; no changes needed — the test's FakeFactory still works.
- Existing e2e: `networks.test.ts` exercises RPC validation — unchanged.

**Rollback**: Drop-in. Revert NodeFactory adapter + NetworkService ctor + ProductionPxeFactory ctor.

---

### M2.4-c — `WindowManager` (injectable collaborator, NOT Service<Methods>)

**Shape — audit-resolved**: Originally planned as a full `Service<Methods, Events>` with `client.ts` + `spec.ts`. **Agent flagged** that only SW-side code calls this — no popup-side or content-script client needs RPC access. Full Service ceremony is unjustified. **Codex** was fine with Service layering but also noted "just lifecycle" is the right cut (no RPC boundary ownership).

**Resolution**: WindowManager becomes a **plain injectable class** (ctor-arg pattern, same as `BalanceRepository` / `SessionManager` from M2.1). No `spec.ts`, no `client.ts`, no RPC `Methods` surface. If a future cross-process consumer appears (e.g., a debug panel listing open approvals), promote to Service then.

**Purpose**: Centralize `chrome.windows.*` calls. Two consumers (Passkey + DappInteraction) today re-implement the same pattern (create popup + onRemoved listener + timeout + resolve/reject). Extract the shared coordination; consumers delegate.

**Note**: `WindowPort` already exists as a port — the adapter work is done. M2.4-c is about building the **WindowManager service** that consumes WindowPort and provides a higher-level "open + await result with timeout" API to other services.

**New file**:
- `src/wallet/services/window-manager/window-manager.ts` — plain class, ctor-injected into consumers.

**Surface**:
```ts
/**
 * Owns chrome.windows.* lifetime for popup-based user approvals.
 * Injectable collaborator (NOT a Service<Methods>). Two consumer
 * patterns:
 *   - PasskeyService (WebAuthn prompt)
 *   - DappInteractionService (dApp approval)
 * Both open a popup, wait for a settlement (user action or
 * timeout/close), then clean up.
 *
 * Handles are keyed by a random `handleId`, NEVER by `kind` — multiple
 * concurrent windows of the same kind (e.g., two dApp approvals) are
 * supported, matching today's behavior.
 */
export class WindowManager {
  public constructor(
    private readonly windows: WindowPort,
    private readonly clock: ClockPort,
    private readonly logger: ILogger,
  ) {}

  /** Open a popup at `url`. Returns a handle that resolves when the
   *  popup settles (via `settle(handleId, value)`), is closed by the
   *  user (global `chrome.windows.onRemoved` filtered by the owned
   *  windowId), or exceeds `timeoutMs`.
   *
   *  Edge-case contract:
   *   - `window.id === undefined` on `windows.create` resolution is
   *     treated as failure; the promise rejects with "Failed to open
   *     window." The passkey path already handles this case inline
   *     today; this is a normalize-across-consumers win.
   *   - Global `onRemoved` fires for EVERY Chrome window on the system.
   *     WindowManager's listener filters on the owned windowId — a
   *     spurious `onRemoved(otherWindowId)` does NOT settle the handle.
   *   - Timeout is implemented via `clock.setTimeout` so MockClock can
   *     drive it in tests.
   *   - On timeout OR cancel, WindowManager also calls
   *     `windows.remove(windowId)` so the orphan popup doesn't persist
   *     after settlement. (Today neither consumer does this; the window
   *     just lingers until the user closes it. Preserving that would
   *     require explicit `closeOnSettle: false`.) */
  openAndAwait<T>(opts: OpenAndAwaitOpts<T>): AwaitedWindow<T>

  /** Settle a pending window with a value. Correlation-only, NOT a
   *  security boundary — whichever caller holds the handleId can
   *  settle. Second and subsequent calls are no-ops (settle-after-
   *  timeout and double-settle both swallowed silently).
   *  Logs a debug line on the ignored attempt to aid diagnosis. */
  settle<T>(handleId: string, value: T): void

  /** Cancel a pending window with an error. Same idempotence as
   *  `settle` — once settled/cancelled/timed-out, further calls are
   *  no-ops. */
  cancel(handleId: string, reason: string): void
}

export type OpenAndAwaitOpts<T> = {
  url: string
  width: number
  height: number
  timeoutMs: number
  /** Tag used in logs only — NOT for dedup or routing. */
  kind: string
}

export type AwaitedWindow<T> = {
  handleId: string
  promise: Promise<T>
  windowId: Promise<number | undefined>  // resolves once window is created
}
```

**Consumer refactor pattern**:

**PasskeyService.openWindowAndWait** today (simplified):
```ts
async openWindowAndWait(request) {
  const requestId = crypto.randomUUID()
  const window = await chrome.windows.create({...})
  this.pending.set(requestId, { request, window.id, deferred })
  const timer = setTimeout(() => deferred.reject(...), PASSKEY_TIMEOUT_MS)
  chrome.windows.onRemoved.addListener(onRemoved)
  const result = await deferred.promise
  chrome.windows.onRemoved.removeListener(onRemoved)
  clearTimeout(timer)
  return result
}
```

**Post-M2.4-c**:
```ts
async openWindowAndWait(request) {
  const handle = this.windowManager.openAndAwait<PasskeyCredential>({
    url: ".../passkey/...",
    width: 500, height: 800,
    timeoutMs: PASSKEY_TIMEOUT_MS,
    kind: "passkey",
  })
  // Popup's window.ts calls passkey.resolvePasskeyRequest(requestId, creds)
  // which forwards via windowManager.settle(handle.handleId, creds).
  return await handle.promise
}
```

**What moves**:
- From PasskeyService: window-create, onRemoved wiring, timeout, pending-map plumbing → WindowManager.
- From DappInteractionService: same set → WindowManager.

**What stays in each consumer**:
- Business logic (what the popup asks for, what result shape is expected).
- The popup's content-script entry points (window.ts for passkey, approval.ts for dapp).

**Cross-cut with M2.1 PasskeyRecoveryCoordinator**: The coordinator calls `passkeys.createKey(userHandle)` + `passkeys.getKey(credentialId)`. These wrap `openWindowAndWait`. After M2.4-c, the wrap delegates to WindowManager. **The coordinator's contract is preserved** — it still awaits a PasskeyCredential promise.

**wallet-sdk's 3rd window call site** (`background.ts:135`): Out of scope. A follow-up PR can route it through WindowManager if desired. **Audit-required enforcement** (agent finding): add a lint-level guard when M2.4-c lands — e.g., eslint `no-restricted-syntax` on `chrome.windows.create` everywhere except `src/wallet/services/window-manager/` and `src/wallet/services/wallet-sdk/background.ts:135` (explicitly allowed with a comment pointing to the follow-up task). Without enforcement, the "all windows through WindowManager" invariant erodes silently.

**Test strategy**:
- Unit: `window-manager.test.ts` drives the service with FakeWindowPort + MockClock. Required cases:
  - Normal settle → promise resolves with value, `windows.remove` called, listener removed.
  - Timeout → promise rejects, `windows.remove` called, listener removed.
  - User-close → promise rejects with "Window closed", `windows.remove` NOT called (already gone), listener removed.
  - Double-settle → second call is a no-op (logged).
  - Settle-after-timeout → no-op (logged), no second settlement.
  - Cancel-after-settle → no-op.
  - **Spurious `onRemoved(otherWindowId)`** → NOT settled; the listener must filter by owned windowId. Easy regression without this test.
  - `windows.create` resolves with `id === undefined` → promise rejects with "Failed to open window."
  - Concurrent opens (two `openAndAwait` calls in flight) — both receive distinct handleIds, settle independently.
- Integration: Passkey + DappInteraction smoke test paths (already covered by existing e2e) — unchanged results.
- Regression: the existing `wallet-lock.test.ts` + any passkey e2e paths must still pass byte-for-byte.

**Rollback**: New service can be unregistered; Passkey + DappInteraction reverted to inline chrome.windows.* calls. Cost: ~100 LOC per consumer + the WindowManager files.

---

## Verification cadence (per sub-PR) — revised

Execution order: **b → a → manual QA gate → c → manual QA gate → done**. Gates are where the user exercises paths the automated suite can't drive (real balance refresh cadence; real passkey + dApp approval popups with WebAuthn).

| Sub-PR | Unit | Smoke | e2e network | Manual QA |
|---|---|---|---|---|
| **M2.4-b** | ✅ | ✅ | ✅ | Optional (no user-visible change) |
| **M2.4-a** | ✅ | ✅ | ✅ | Required gate after — lock + unlock + verify token balances refresh on expected cadence; profile-switch during active refresh (confirm pre-existing race is not worse). |
| **M2.4-c** | ✅ | ✅ | ❌ (WebAuthn + chrome.windows not reliably drivable in headless Puppeteer) | Required gate after — passkey unlock, dApp approval, popup close-by-user, popup timeout (long-running). |

Network e2e earns time on M2.4-b (touches live JSON-RPC proxy creation — POJO fakes don't exercise it) and M2.4-a (touches live balance refresh across real node). Skipped on M2.4-c because popup lifecycle isn't covered by the e2e suite today.

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **BackgroundTickerPort choice (setInterval vs chrome.alarms)** — the port design should allow a future switch without caller changes. If the port is too thin, future migration is a breaking change. | LOW | Interface supports callback + cancel only; no timing precision guarantees. Documented to allow chrome.alarms swap-in. |
| 2 | **TokenBalanceService cadence drift** — replacing the while loop with a ticker could subtly shift when the first batch runs. | LOW | Test: first-tick-after-start behavior pinned. |
| 3 | **WindowManager + popup RPC routing** — the popup's content script must call a settle RPC that reaches WindowManager. Who owns the RPC methodology? | MED | Keep passkey + dapp-interaction popups' existing RPCs. WindowManager's `settle` is an INTERNAL method, called by those services when they receive the popup's RPC. No popup-side change. |
| 4 | **M2.4-b createNode options** — today the call includes `makeFetchWithTimeout()`. The NodeFactory port must preserve this. | LOW | Adapter constructor hardcodes the fetch factory. |
| 5 | **PasskeyRecoveryCoordinator's contract** must survive M2.4-c. | LOW | WindowManager's result-promise shape matches what coordinator expects from PasskeyService.createKey/getKey. No coordinator change. |
| 6 | **wallet-sdk 3rd window call site** not routed through WindowManager — future debt. | LOW | Flag in M2.4-c PR description; create follow-up task. |
| 7 | **Profile-switch during in-flight balance refresh** — today the continuous loop re-enqueues all balances on profile change. Post-M2.4-a, the queue clear + re-enqueue still happens but via event handlers. Timing could differ. | MED | Integration test: profile switch during active balance refresh; assert final state correct. |
| 8 | **Storage-key or persistence drift in BalanceRepository** — refactor must preserve the exact EntityStorage shape. | LOW | Repo unit tests pin the key + shape. |

## Pre-formulated codex audit questions (for M2.4 plan audit)

Q1. **BackgroundTickerPort vs ClockPort**: is a new port justified? Why not use `ClockPort.setInterval` directly? What specific property does BackgroundTickerPort guarantee that ClockPort doesn't?

Q2. **BalanceJobQueue-driven vs continuous loop**: is there a regression risk around "time-to-first-balance-shown" for a freshly-unlocked wallet? Walk through the boot sequence.

Q3. **WindowManager scope**: should it own BOTH window creation AND the associated RPC boundary (popup ↔ SW for settle), or just the window lifecycle? My plan picks "just lifecycle"; is that the right cut?

Q4. **Tx/balance interaction**: TokenBalanceService calls ExecutionService.executeSimulateViews (which has its own gas-balance cache post-M2.2-f). Is there a coupling M2.4-a needs to respect? Can BalanceProjector become leaner by going through ContractResolver / direct PXE instead?

Q5. **NodeFactory port — single method sufficient**? Future growth might need `destroyNode`, `isHealthy`, etc. Is it OK to ship minimal now?

Q6. **WindowManager + multiple pending windows of same kind** — e.g., 2 concurrent dApp approvals. Plan says handles are per-request. Does the current code prevent this, and should WindowManager?

Q7. **Existing WindowPort** is already defined but unused. M2.4-c introduces a higher-level service — is there risk of WindowManager duplicating WindowPort's responsibilities?

Q8. **BalanceRepository + BalanceProjector + BalanceJobQueue** is 3 classes from a 450-LOC service. Is this the right granularity, or is it over-split?

Q9. **wallet-sdk's 3rd chrome.windows.create call** (`background.ts:135`) — should we address it now to prevent drift, or defer as planned?

Q10. **What's the BLAST radius** if BackgroundTickerPort has a subtle bug (e.g., double-tick per interval)?

## Cross-M2.X dependencies (for the arc README)

- **M2.4-a** depends on M2.2's `ExecutionServiceClient.executeSimulateViews` remaining stable. M2.2 preserves this in the facade; no conflict.
- **M2.4-c** depends on `WindowPort` (already exists). The coordinator from M2.1 is preserved.
- **M2.4-b** has no dependencies; can ship any time.
- None of M2.4-a/b/c depend on each other.

## Open decisions for execution time

1. **BackgroundTickerPort.subscribe return** — TickerHandle vs plain cancel function. Plan picks TickerHandle for extensibility (could later add `.isActive`, `.invokeNow`).
2. **BalanceProjector error surfacing** — today's syncBatch fails all balances in a batch on any error. Plan preserves; reconsider per-balance partial-success later.
3. **WindowManager logging** — plan omits; add if the consumer-side log drift becomes painful.
4. **FakeBackgroundTicker** test ergonomics — manual `tick()` call vs cooperative with FakeClock? Plan: manual tick method; decide during implementation.
