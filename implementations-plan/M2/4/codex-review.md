OpenAI Codex v0.120.0 (research preview)
--------
workdir: (project root)
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, (codex memory dir)]
reasoning effort: none
reasoning summaries: none
session id: 019db6fb-2f62-7b52-89ff-443fc0c0763a
--------
user
You are reviewing an implementation plan created by another AI agent (Claude).
Your job is to critique the plan — find gaps, risks, missed edge cases, better alternatives, or confirm it looks solid. Pessimism welcome.

## Task

Audit the M2.4 implementation plan at `implementations-plan/M2/4/plan.md` for execution readiness. This is a ~2-week refactor arc with 3 sub-PRs:
- **M2.4-a**: TokenBalanceService split (~450 LOC service, continuous `while(true) { sleep(1000) }` worker) into BalanceRepository + BalanceProjector + BalanceJobQueue + a new BackgroundTickerPort.
- **M2.4-b**: NodeFactory port injection into NetworkService — replaces 4 inline `createAztecNodeClient(...)` calls.
- **M2.4-c**: WindowManager extraction from PasskeyService + DappInteractionService. Centralizes `chrome.windows.*` calls.

The plan was drafted and audited in the original M2 planning arc. Since then M2.1, M2.2, and M2.3 have all shipped to master; the tree is at 0.12.0. Some plan facts may have drifted.

## Context — current tree state

Chrome MV3 extension, Aztec wallet. All three M2.4 targets run in the service worker (not offscreen). The MV3 SW can be suspended by Chrome at any time — any fine-grained timing promises in the plan need to survive that.

Shipped artifacts from M2.1/2/3 that M2.4 cross-cuts:

- `src/wallet/utils/rw-guard.ts` — ReadWriteGuard with drain-on-write, writer-FIFO priority, 5-min force-release on stuck readers. Only PxeService uses it.
- `src/wallet/services/pxe/chain-runtime.ts` — ChainRuntimeRegistry + PxeFactory. Per-chain PXE+Node keyed by (profileId, chainId). **M2.4-b introduces a SEPARATE `NodeFactory` — just for NetworkService.** The plan claims this is fine; verify whether they should share or really are distinct.
- `src/wallet/services/pxe/artifact-registry.ts` — ArtifactRegistry with explicit policy + byClassId pinning + config.onUpdate subscription.
- `src/wallet/base/offscreen/client.ts` — ServiceClient transport-base now hoists `ensureOffscreenRunning()` via template-method + `onReady()` hook. Offscreen-client-only (PxeServiceClient). Other services use `base/background`, which did not change.

## Nuances

- **Type-lie pitfall** just bit us on master. M2.1-c declared `PasskeyRecovery.secret: Fr` but `PasskeyCredential.deriveMasterSecret()` always returned `Buffer<ArrayBuffer>`. Every unit test mocked the declared type (`Fr`) instead of the runtime type (`Buffer`), so tests passed but the real flow threw `"secret.toBuffer is not a function"`. I want you to flag analogous pitfalls proactively in M2.4's proposed collaborators (BalanceProjector, BalanceJobQueue, WindowManager, NodeFactory). Consider:
  - What does `ExecutionService.executeSimulateViews` actually return at runtime vs its declared type? (BalanceProjector's input)
  - What does `createAztecNodeClient` actually return? (NodeFactory's return — it's a safe-json-rpc proxy, not a POJO)
  - `chrome.windows.create` resolves with a `Window` whose `.id` may be `undefined`.

- **An independent verification agent already ran** and found:
  1. BalanceProjector ctor type in plan is wrong — plan says `ExecutionServiceClient`, should be `ExecutionService` (SW-local handle, not popup client). Same for TaskServiceClient → TaskService in BalanceJobQueue.
  2. M2.4-b's scope caveat cites `pxe/service.ts:398` — that file/line was removed by M2.3-a. The real 5th `createAztecNodeClient` call lives at `pxe/chain-runtime.ts:53` inside `ProductionPxeFactory`. Recommendation: extend M2.4-b to inject NodeFactory there too.
  3. Plan claims M2.2-f extracted GasBalanceCache; it didn't (still inline at `execution/service.ts:163, 209-221, 909, 995`). Doesn't block M2.4-a but the entry state is wrong.
  4. Pre-existing stale-write race on profile switch during in-flight `syncBatch` — TokenBalanceService has no guard; M2.4-a preserves the race. Plan should acknowledge rather than claim invariance.
  5. Plan text docs `window-port.ts:2-6` reference M3.5 for WindowManager extraction; the plan moves it to M2.4-c. Minor doc drift.

You are free to confirm, refute, or expand on these findings. They are inputs, not constraints.

## Review Instructions

Evaluate the plan broadly. Your scope is deliberately wide — do not narrow. I want:

1. **Architectural concerns** I missed. Is the split in M2.4-a the right shape? Does BackgroundTickerPort belong to `src/core/ports/` or is it a token-balance concern? Is WindowManager better as a plain class (plan's current audit-resolved choice) or a Service?

2. **Cross-sub-PR and cross-M2.X interactions**. The PxeFactory (M2.3) vs NodeFactory (M2.4-b) split — genuinely separate, or is the plan leaving a duplicated abstraction on the table?

3. **Edge cases in the proposed collaborator surfaces**:
   - BackgroundTickerPort "serialized + coalescing" contract — what happens if `onTick` throws? If cancel() fires during an in-flight tick?
   - BalanceJobQueue `clear()` vs in-flight tick during profile switch (plan risk #7) — the verification agent flagged this as an un-fixed pre-existing race. Does the plan's current design make it worse, better, or leave it?
   - WindowManager: settle-after-timeout, double-settle, concurrent same-kind windows, `CreatedWindow.id === undefined`, `chrome.windows.onRemoved` firing for ALL browser windows globally (must filter).

4. **Test-mock vs runtime-reality pitfalls** — as above, proactively flag shapes where the declared type would make tests pass with POJO fakes while the real runtime behavior differs.

5. **Simpler alternatives** — is M2.4-a over-engineered? Could we skip BackgroundTickerPort and just use ClockPort.setInterval with a manual serialization guard? Is the 4-class split in M2.4-a the right cardinality, or would 2 (Repository + rest) do?

6. **Execution order**. User proposed: b → a → manual QA gate → c. Sanity-check the ordering, gate placement, and whether any risk justifies a different sequence.

7. **Test cadence per sub-PR**. Claude's defaults: b=unit+smoke, a=unit+smoke+network, c=unit+smoke. Any sub-PR that deserves more or less?

8. **Anything else** that would make you want to rewrite the plan vs. ship as-is. Don't hold back.

Ship a comprehensive markdown review. Severity-tag findings if it helps communicate priority. Cite plan:line and code file:line. If you think the plan is sound, say so and move on — but it's a 398-line plan and a 2-week arc, so I expect *something*.

codex
I’m auditing the plan against the current 0.12.0 tree, not trusting the original M2 assumptions. First step is to read the plan and the live implementations for the three refactor targets plus the M2.1/2/3 cross-cutting pieces you called out.
  → Read M2.4 plan and note claimed scopes, invariants, collaborator APIs, and cited file references
  • Inspect current implementations for TokenBalanceService, NetworkService/node creation, PasskeyService, DappInteractionService, and relevant M2.1/M2.3 infrastructure
  • Compare plan against current tree, identify architectural/runtime/test risks, and draft severity-ranked review with file+line citations
exec
/bin/zsh -lc "sed -n '261,520p' implementations-plan/M2/4/plan.md" in (project root)
 succeeded in 0ms:
   *  RPC-addressable. Only the consumer that called `openAndAwait`
   *  (holding the handleId) can settle. Double-settle is a no-op. */
  settle<T>(handleId: string, value: T): void

  /** Cancel a pending window with an error. Same access semantics as
   *  `settle`. */
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
- Unit: `window-manager.test.ts` drives the service with FakeWindowPort + FakeClockPort. Cases: normal settle, timeout, user-close, double-settle (ignored), settle-after-timeout (ignored).
- Integration: Passkey + DappInteraction smoke test paths (already covered by existing e2e) — unchanged results.
- Regression: the existing `wallet-lock.test.ts` + any passkey e2e paths must still pass byte-for-byte.

**Rollback**: New service can be unregistered; Passkey + DappInteraction reverted to inline chrome.windows.* calls. Cost: ~100 LOC per consumer + the WindowManager files.

---

## Verification cadence (per sub-PR)

After each sub-PR:
1. `bunx vitest run` — all units, new + existing.
2. `bun run typecheck` + `bun run build:chrome`.
3. `bun run test:e2e` — smoke 15/15.
4. `bun run test:e2e:all` — network 31/31.
5. Manual QA:
   - M2.4-a: lock + unlock + verify token balances refresh on expected cadence.
   - M2.4-b: switch networks + verify nodeStatus + addNetwork flow.
   - M2.4-c: try passkey unlock + dApp approval popup — both behave identically to pre-M2.4-c.

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

exec
/bin/zsh -lc "sed -n '1,260p' implementations-plan/M2/4/plan.md" in (project root)
 succeeded in 0ms:
# M2.4 — Worker-heavy services (3 sub-PRs, ~2 weeks)

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
4. **ExecutionService.getGasBalances vs TokenBalance**: discovery flagged they share the same PXE-timeout concern. **Decision**: out of scope for M2.4. Both still call their respective ExecutionService methods; the ExecutionService-side caching is M2.2's problem (gas cache extracted in M2.2-f).

## Architecture invariants (preserved across all 3 sub-PRs)

1. **RPC surfaces frozen** — `TokenBalanceService`, `NetworkService`, `PasskeyService`, `DappInteractionService` all keep their `spec.ts` methods unchanged.
2. **Storage keys frozen** — `nulo:core:token-balances`, network storage key, etc. all preserved.
3. **Balance-sync semantics preserved** — same events fire, same batch size (12), same TTL. Just a different ticking mechanism.
4. **Popup lifecycles preserved** — PasskeyService (5min) and DappInteractionService (10min) timeouts unchanged. `onRemoved` still fires on user close.
5. **Profile-switch cache invalidation** unchanged — same triggers, same ordering.

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
   *      completes; no further ticks).
   *
   *  WHAT THIS DOES NOT PROMISE:
   *    - Persistence across SW suspension. The default adapter wraps
   *      `ClockPort.setInterval` which pauses when the SW suspends.
   *      A future chrome.alarms-backed adapter is NOT swap-in-compatible
   *      at sub-30s cadences (chrome.alarms floor is 30s).
   *    - Exact timing. Ticks may be delayed by arbitrary JS work.
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
  public constructor(private readonly execution: ExecutionServiceClient) {}

  /** Batch-project balances for a single account. Builds CallAction[] for
   *  private + public view calls, calls executeSimulateViews, maps
   *  results back. Mirrors today's syncBatch (service.ts:259-419). */
  async project(
    account: AccountAddress,
    balances: TokenBalanceRaw[],
    network: Network,
  ): Promise<ProjectedBalance[]>
}
```

**BalanceJobQueue surface**:
```ts
export class BalanceJobQueue {
  public constructor(
    private readonly ticker: BackgroundTickerPort,
    private readonly repo: BalanceRepository,
    private readonly projector: BalanceProjector,
    private readonly tasks: TaskServiceClient,
    private readonly onBalanceUpdated: (b: TokenBalanceInfo) => void,
    private readonly onBalanceFailed: (b: TokenBalanceInfo, err: Error) => void,
  ) {}

  start(): void    // subscribe to ticker
  stop(): void     // cancel subscription

  /** Enqueue a balance for refresh. Dedup via per-id pendingTasks map.
   *  Mirrors service.ts:108. */
  enqueue(balance: TokenBalanceRaw): void

  /** Clear queue (e.g., on profile switch). */
  clear(): void
}
```

**What moves**:
- Queue + pendingTasks (lines 32-33) → BalanceJobQueue.
- `EntityStorage<TokenBalanceRaw>` (line 31) → BalanceRepository.
- `syncBatch` (259-419) → BalanceProjector.
- Loop (233-257) → replaced with `ticker.subscribe(1000, () => queue.tick())`.
- Trigger handlers (`onTokenAdded`, `onAccountAdded`, etc., 148-231) → stay on TokenBalanceService, now call `queue.enqueue(balance)`.

**What stays on TokenBalanceService (the facade)**:
- The Service<Methods> RPC scaffolding.
- Event subscriptions (onAccountAdded, onTokenAdded, onTransactionUpdated, onActiveProfileChanged).
- Public API delegates to repo/queue.

**Test strategy**:
- Unit: `balance-repository.test.ts` with FakeBrowserApi.
- Unit: `balance-projector.test.ts` with fake ExecutionServiceClient.
- Unit: `balance-job-queue.test.ts` with fake ticker — drive ticks manually, verify dedup, batch size, onBalanceUpdated firing.
- Integration: unchanged (TokenBalanceService still works end-to-end).

**Rollback**: Drop-in (3 new files + rewire TokenBalanceService methods). The continuous loop can be re-introduced if tick-based scheduling causes surprises.

**Semantic change (DELIBERATE)**: Today a batch runs every 1000ms if the queue is non-empty. Post-M2.4-a: same. The difference is HOW we schedule. No user-visible change in cadence.

---

### M2.4-b — `NodeFactory` port injection into `NetworkService`

**Purpose**: Replace 4 inline `createAztecNodeClient(...)` calls with a `NodeFactory` port. Enables unit tests of NetworkService without real RPC.

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

**Scope caveat (audit-flagged)**: `pxe/service.ts:398` has ITS OWN inline `createAztecNodeClient` call. M2.4-b's NodeFactory targets **only** NetworkService. Document this explicitly in the PR description: "NodeFactory is scoped to NetworkService in M2.4-b. PxeService's inline call site at pxe/service.ts:398 is deferred to M2.3-a's ChainRuntime work (which creates its node via a PxeFactory, not the NodeFactory directly)." Otherwise a future reviewer will see the call site and file a bug.

**Test strategy**:
- Unit: new `network-service.test.ts` drives NetworkService with FakeNodeFactory. Verify getNetwork, setDefault, getNodeStatus, getChainId happy paths + error-on-invalid-rpc.
- Existing e2e: `networks.test.ts` exercises RPC validation — unchanged.

**Rollback**: Drop-in. Revert NodeFactory adapter + NetworkService ctor.

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
   *  user (via `chrome.windows.onRemoved`), or exceeds `timeoutMs`. */
  openAndAwait<T>(opts: OpenAndAwaitOpts<T>): AwaitedWindow<T>

  /** Settle a pending window with a value. Plain class method — NOT

exec
/bin/zsh -lc "nl -ba src/wallet/utils/rw-guard.ts | sed -n '1,260p'" in (project root)
 succeeded in 0ms:
nl: src/wallet/utils/rw-guard.ts: No such file or directory

exec
/bin/zsh -lc "rg -n \"class TokenBalanceService|createAztecNodeClient|chrome\\.windows\\.|class PasskeyService|class DappInteractionService|class NetworkService|class ChainRuntimeRegistry|class ProductionPxeFactory|class PxeFactory|class PxeService|class ExecutionService|GasBalanceCache|executeSimulateViews|window-port|BackgroundTickerPort|NodeFactory|BalanceProjector|BalanceJobQueue|BalanceRepository\" src" in (project root)
 exited 2 in 0ms:
rg: src: IO error for operation on src: No such file or directory (os error 2)

codex
The plan is loaded. I hit path drift immediately: this tree doesn’t have a top-level `src/`, so I’m locating the live files before I judge any plan citations or “verified” entry-state claims.
exec
/bin/zsh -lc "pwd && rg --files | rg 'token-balance/service.ts|network/service.ts|passkey/service.ts|dapp-interaction/service.ts|chain-runtime.ts|artifact-registry.ts|offscreen/client.ts|rw-guard.ts|window-port.ts|execution/service.ts|wallet-sdk/background.ts'" in (project root)
 succeeded in 0ms:
(project root)
packages/extension/src/wallet/services/token-balance/service.ts
packages/extension/src/wallet/services/pxe/artifact-registry.ts
packages/extension/src/wallet/services/pxe/chain-runtime.ts
packages/extension/src/wallet/services/dapp-interaction/service.ts
packages/extension/src/core/ports/window-port.ts
packages/extension/src/wallet/services/execution/service.ts
packages/extension/src/wallet/services/network/service.ts
packages/extension/src/wallet/utils/rw-guard.ts
packages/extension/src/wallet/base/offscreen/client.ts
packages/extension/src/wallet/services/wallet-sdk/background.ts
packages/extension/src/wallet/services/passkey/service.ts

exec
/bin/zsh -lc "rg --files implementations-plan/M2/4 . | sed -n '1,260p'" in (project root)
 succeeded in 0ms:
./SECURITY.md
./biome.json
./tsconfig.json
implementations-plan/M2/4/audit-codex.md
implementations-plan/M2/4/codex-review.md
implementations-plan/M2/4/plan.md
implementations-plan/M2/4/agent-review.md
implementations-plan/M2/4/audit-agent.md
implementations-plan/M2/4/audit-diff.md
./README.md
./patches/@aztec%2Faccounts@4.2.0-nightly.20260413.patch
./bun.lockb
./LICENSE.md
./packages/playground/src/main.ts
./packages/playground/vite.config.ts
./packages/playground/tsconfig.json
./packages/playground/package.json
./packages/playground/index.html
./architecture/my-notes/03-crypto-storage-keys.md
./architecture/my-notes/04-tx-pipeline-and-pxe.md
./architecture/my-notes/01-entry-points-and-messaging.md
./architecture/my-notes/06-synthesis.md
./architecture/my-notes/02-service-inventory.md
./architecture/my-notes/05-ui-build-test.md
./architecture/codex-notes/05-pxe-integration.md
./architecture/codex-notes/07-dapp-bridge.md
./architecture/codex-notes/10-build-and-manifest.md
./architecture/codex-notes/08-passkey-flow.md
./architecture/codex-notes/06-tx-pipeline.md
./architecture/codex-notes/13-risk-register.md
./architecture/codex-notes/14-plan.md
./architecture/codex-notes/11-testability-gaps.md
./architecture/codex-notes/02-service-messaging.md
./architecture/codex-notes/09-ui-architecture.md
./architecture/codex-notes/01-entry-points.md
./architecture/codex-notes/04-storage-and-crypto.md
./architecture/codex-notes/03-service-inventory.md
./architecture/codex-notes/12-modularization-opportunities.md
./architecture/README.md
./architecture/plan/review-ux-eng.md
./architecture/plan/01-revised-plan.md
./architecture/plan/00-draft-plan.md
./architecture/plan/02-final-plan.md
./architecture/plan/review-codex.md
./architecture/plan/03-final-plan-v3.md
./packages/extension/src/pages/about.vue
./architecture/research/mv3-wallet-state-of-the-art.md
./packages/extension/src/assets/logo.svg
./packages/extension/src/assets/fonts/SpaceGrotesk-latin-ext.woff2
./packages/extension/src/assets/fonts/SpaceGrotesk-latin.woff2
./packages/extension/src/assets/fonts/JetBrainsMono-latin.woff2
./packages/extension/src/assets/fonts/InterVariable.woff2
./packages/extension/src/assets/fonts/ClashDisplay-Medium.ttf
./packages/extension/src/assets/fonts/MaterialSymbolsOutlined.woff2
./packages/extension/src/assets/logo.png
./implementations-plan/M2/2/audit-codex.md
./implementations-plan/M2/2/plan.md
./implementations-plan/M2/2/audit-agent.md
./implementations-plan/M2/2/audit-diff.md
./packages/extension/src/assets/styles/_base.scss
./packages/extension/src/assets/styles/_text.scss
./packages/extension/src/assets/styles/_flex.scss
./packages/extension/src/assets/privacy-placeholder.svg
./packages/extension/src/assets/icons.json
./implementations-plan/M2/3/audit-codex.md
./implementations-plan/M2/3/d/audit-diff.md
./implementations-plan/M2/3/plan.md
./implementations-plan/M2/3/audit-agent.md
./implementations-plan/M2/3/audit-diff.md
./implementations-plan/M2/4/audit-codex.md
./implementations-plan/M2/4/codex-review.md
./implementations-plan/M2/4/plan.md
./implementations-plan/M2/4/agent-review.md
./implementations-plan/M2/4/audit-agent.md
./implementations-plan/M2/4/audit-diff.md
./implementations-plan/M2/README.md
./AUDIT.md
./packages/extension/src/composables/toast.js
./packages/extension/src/composables/configClient.ts
./packages/extension/src/composables/externalLinks.ts
./packages/extension/src/composables/syncedRef.js
./packages/extension/src/composables/ticker.ts
./packages/extension/src/composables/outside.js
./packages/extension/src/composables/notification.js
./packages/extension/src/composables/externalImage.ts
./packages/extension/src/wallet/services/account-state/service.ts
./packages/extension/src/wallet/services/account-state/client.ts
./packages/extension/src/wallet/services/account-state/spec.ts
./packages/extension/src/types/auto-imports.d.ts
./packages/extension/src/types/typed-router.d.ts
./packages/extension/src/types/components.d.ts
./packages/extension/src/wallet/services/log-viewer/service.ts
./packages/extension/src/wallet/services/log-viewer/client.ts
./packages/extension/src/wallet/services/log-viewer/spec.ts
./packages/extension/src/types/vite-env.d.ts
./packages/extension/src/types/console.d.ts
./packages/extension/src/content-script/content.ts
./packages/extension/src/wallet/services/auth-registry/service.ts
./packages/extension/src/wallet/services/auth-registry/client.ts
./packages/extension/src/wallet/services/auth-registry/spec.ts
./packages/extension/src/wallet/services/token-balance/service.ts
./packages/extension/src/wallet/services/token-balance/client.ts
./packages/extension/src/wallet/services/token-balance/spec.ts
./packages/extension/src/wallet/services/rpc/types.ts
./packages/extension/src/wallet/services/rpc/utils.ts
./packages/extension/src/popup/pages/general.vue
./packages/extension/src/wallet/services/account/service.ts
./packages/extension/src/wallet/services/account/client.ts
./packages/extension/src/wallet/services/account/spec.ts
./packages/extension/src/popup/pages/tokens/[id].vue
./packages/extension/src/popup/pages/send.vue
./packages/extension/src/popup/pages/[...catch].vue
./packages/extension/src/popup/pages/activity.vue
./packages/extension/src/wallet/services/account/contracts/index.ts
./packages/extension/src/wallet/services/account/contracts/nulo-account.test.ts
./packages/extension/src/wallet/services/account/contracts/nulo-account.ts
./packages/extension/src/popup/pages/tx/[id].vue
./packages/extension/src/popup/pages/register.vue
./packages/extension/src/wallet/services/task/wrapped-task.ts
./packages/extension/src/wallet/services/task/service.ts
./packages/extension/src/wallet/services/task/client.test.ts
./packages/extension/src/wallet/services/task/client.ts
./packages/extension/src/wallet/services/task/spec.ts
./packages/extension/src/wallet/services/task/service.test.ts
./packages/extension/src/popup/pages/settings/about.vue
./packages/extension/src/wallet/services/pxe/artifact-registry.test.ts
./packages/extension/src/wallet/services/pxe/service.ts
./packages/extension/src/wallet/services/pxe/artifact-registry.ts
./packages/extension/src/wallet/services/pxe/proxy.ts
./packages/extension/src/wallet/services/pxe/client.ts
./packages/extension/src/wallet/services/pxe/spec.ts
./packages/extension/src/wallet/services/pxe/chain-runtime.ts
./packages/extension/src/wallet/services/pxe/chain-runtime.test.ts
./packages/extension/src/wallet/services/pxe/known-artifacts.ts
./packages/extension/src/popup/pages/settings/tokens/index.vue
./packages/extension/src/wallet/services/dapp-interaction/service.ts
./packages/extension/src/wallet/services/dapp-interaction/client.ts
./packages/extension/src/wallet/services/dapp-interaction/spec.ts
./packages/extension/src/popup/app.vue
./packages/extension/vite.firefox.config.mts
./packages/extension/src/popup/pages/settings/index.vue
./packages/extension/src/popup/pages/auth.vue
./packages/extension/src/popup/pages/index.vue
./packages/extension/src/wallet/base/zod-helpers.ts
./packages/extension/src/wallet/services/passkey/service.ts
./packages/extension/src/wallet/base/index.ts
./packages/extension/src/wallet/base/topology.test.ts
./packages/extension/src/wallet/base/utils.ts
./packages/extension/src/wallet/base/topology.ts
./packages/extension/src/wallet/base/messages.ts
./packages/extension/src/wallet/base/zod-helpers.test.ts
./packages/extension/src/wallet/base/errors.ts
./packages/extension/src/wallet/base/errors.test.ts
./packages/extension/src/wallet/services/dapp-session/service.ts
./packages/extension/src/wallet/services/dapp-session/client.ts
./packages/extension/src/wallet/services/dapp-session/spec.ts
./packages/extension/src/popup/pages/settings/fpcs/index.vue
./packages/extension/src/popup/pages/settings/appearance.vue
./packages/extension/src/wallet/services/passkey/client.ts
./packages/extension/src/wallet/services/passkey/spec.ts
./packages/extension/src/wallet/services/passkey/credential.ts
./packages/extension/src/offscreen/index.ts
./packages/extension/src/offscreen/index.html
./packages/extension/vitest.e2e.network.config.ts
./packages/extension/vitest.config.ts
./packages/extension/vite.config.ts
./packages/extension/vitest.e2e.all.config.ts
./packages/extension/tsconfig.json
./packages/extension/package.json
./packages/extension/src/wallet/crypto/key-vectors.test.ts
./packages/extension/src/wallet/services/network/service.ts
./packages/extension/src/wallet/services/network/client.ts
./packages/extension/src/wallet/services/network/spec.ts
./packages/extension/src/wallet/services/profile/service.ts
./packages/extension/src/wallet/services/profile/client.test.ts
./packages/extension/src/wallet/services/execution/authwit-discoverer.ts
./packages/extension/src/wallet/services/profile/password-secret-box.ts
./packages/extension/src/wallet/services/profile/client.ts
./packages/extension/src/wallet/services/execution/service.ts
./packages/extension/src/wallet/services/profile/spec.ts
./packages/extension/src/wallet/services/execution/operation-planner.ts
./packages/extension/src/wallet/services/profile/session-manager.ts
./packages/extension/src/wallet/services/execution/client.ts
./packages/extension/src/wallet/services/execution/execution-coordinator.ts
./packages/extension/src/wallet/services/profile/repository.test.ts
./packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.test.ts
./packages/extension/src/wallet/services/profile/service.integration.test.ts
./packages/extension/src/wallet/services/execution/spec.ts
./packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts
./packages/extension/src/wallet/services/profile/session-manager.test.ts
./packages/extension/src/wallet/services/profile/repository.ts
./packages/extension/src/wallet/services/profile/password-secret-box.test.ts
./packages/extension/public/logo.svg
./packages/extension/src/wallet/base/offscreen/service.ts
./packages/extension/src/wallet/base/offscreen/client.test.ts
./packages/extension/src/wallet/base/offscreen/index.ts
./packages/extension/src/wallet/base/offscreen/client.ts
./packages/extension/src/wallet/base/offscreen/messages.ts
./packages/extension/src/wallet/services/operation-journal/service.ts
./packages/extension/src/wallet/services/operation-journal/client.ts
./packages/extension/src/wallet/services/operation-journal/spec.ts
./packages/extension/src/wallet/services/operation-journal/service.test.ts
./packages/extension/src/shims/detect-node.ts
./packages/extension/src/shims/bb-fetch-code.ts
./packages/extension/src/popup/pages/settings/accounts/index.vue
./packages/extension/src/wallet/services/config/service.ts
./packages/extension/src/wallet/services/config/client.ts
./packages/extension/src/wallet/services/config/spec.ts
./packages/extension/src/wallet/services/fpc/spec.ts
./packages/extension/src/wallet/services/fpc/fpc.ts
./packages/extension/src/wallet/services/fpc/client.ts
./packages/extension/src/wallet/services/fpc/service.ts
./packages/extension/src/wallet/services/execution/contract-resolver.test.ts
./packages/extension/src/wallet/services/execution/contract-resolver.ts
./packages/extension/src/wallet/services/execution/models/operation-result.ts
./packages/extension/src/wallet/services/profile/encryption/encryption-key.ts
./packages/extension/tests/vitest.setup.ts
./packages/extension/src/wallet/services/execution/models/index.ts
./packages/extension/src/wallet/services/execution/models/fee.ts
./packages/extension/src/wallet/services/execution/models/operation.ts
./packages/extension/src/wallet/services/execution/models/action.ts
./packages/extension/src/wallet/services/execution/models/authwit-content.ts
./packages/extension/src/wallet/services/logger/service.ts
./packages/extension/src/wallet/services/logger/client.ts
./packages/extension/src/wallet/services/logger/spec.ts
./packages/extension/src/wallet/base/background/service.ts
./packages/extension/src/wallet/base/background/client.test.ts
./packages/extension/src/wallet/base/background/index.ts
./packages/extension/src/wallet/base/background/client.ts
./packages/extension/src/wallet/index.ts
./packages/extension/src/wallet/runtime.ts
./packages/extension/src/wallet/services/profile/encryption/encryption-key.test.ts
./packages/extension/src/popup/pages/settings/profile/index.vue
./packages/extension/src/components/Header.vue
./packages/extension/src/components/Divider.vue
./packages/extension/src/components/update.vue
./packages/extension/src/wallet/services/fpc/handlers/index.ts
./packages/extension/src/popup/components/modules/send/FeeJuiceCard.vue
./packages/extension/src/wallet/services/execution/fee/fee-strategy.ts
./packages/extension/src/wallet/services/execution/fee/fpc-strategy.ts
./packages/extension/src/wallet/services/execution/fee/embedded-strategy.ts
./packages/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts
./packages/extension/src/wallet/services/fpc/handlers/default-sponsored-fpc-handler.ts
./packages/extension/src/wallet/services/fpc/handlers/private-fpc-handler.ts
./packages/extension/src/wallet/services/fpc/handlers/default-fpc-handler.ts
./packages/extension/src/wallet/services/execution/fee/fee-juice-with-claim-strategy.ts
./packages/extension/src/wallet/services/execution/authwit-discoverer.test.ts
./packages/extension/src/wallet/services/execution/operation-planner.test.ts
./packages/extension/src/wallet/services/execution/tx-request-builder.ts
./packages/extension/src/popup/components/modules/send/SendTypesCard.vue
./packages/extension/src/wallet/services/execution/utils/fee-detection.ts
./packages/extension/src/popup/components/modules/send/SelectTokenCard.vue
./packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue
./packages/extension/src/popup/components/modules/send/AmountCard.vue
./packages/extension/src/wallet/services/execution/utils/fee-detection.test.ts
./packages/extension/src/popup/index.ts
./packages/extension/tests/e2e/global-setup-smoke.ts
./packages/extension/tests/e2e/connect-dapp.test.ts
./packages/extension/src/wallet/services/wallet-sdk/dispatcher.ts
./packages/extension/src/wallet/storage/index.ts

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/network/service.ts | sed -n '1,380p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/token-balance/service.ts | sed -n '1,520p'" in (project root)
 succeeded in 0ms:
     1	import { type AztecNode, createAztecNodeClient } from "@aztec/stdlib/interfaces/client"
     2	import { makeFetchWithTimeout } from "@/wallet/utils/fetch"
     3	import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
     4	import { Service } from "@/wallet/base/background"
     5	import { validateParams } from "@/wallet/base/zod-helpers"
     6	import type { ILogger } from "@/wallet/logger"
     7	import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
     8	import { EntityStorage, StorageType } from "@/wallet/storage"
     9	import { getRandomHex, Lock } from "@/wallet/utils"
    10	import { EventHandler } from "@/wallet/utils/event-handler"
    11	import { getErrorMessage } from "@/wallet/utils/errors"
    12	import { type Events, type Methods, type Network, NETWORK_SERVICE_NAME, NetworkMethodSchemas, NodeStatus } from "./spec"
    13	
    14	export * from "./spec"
    15	
    16	export class NetworkService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
    17		public static name = NETWORK_SERVICE_NAME
    18	
    19		public readonly onNetworkAdded = new EventHandler<Network>()
    20		public readonly onNetworkUpdated = new EventHandler<Network>()
    21		public readonly onNetworkDeleted = new EventHandler<Network>()
    22		public readonly onDefaultNetworkChanged = new EventHandler<Network>()
    23	
    24		private readonly storage = new EntityStorage<Network>("nulo:core:networks", StorageType.Local)
    25		private readonly nodes = new Map<number, AztecNode>()
    26		private readonly lock: Lock
    27	
    28		private profileService: ProfileService = null!
    29	
    30		public constructor(logger: ILogger) {
    31			super(NETWORK_SERVICE_NAME, logger)
    32			this.lock = new Lock("network", logger)
    33		}
    34	
    35		protected async init(services: ServiceCollection) {
    36			this.profileService = services.get(ProfileService.name)
    37			this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
    38			this.profileService.onProfileDeleted.add(this.onProfileDeleted)
    39		}
    40	
    41		public async getOrInitNetworks(): Promise<Network[]> {
    42			await this.ensureInitialized()
    43			const profile = await this.profileService.getActiveProfile()
    44			if (!profile) {
    45				throw new Error("Profile locked")
    46			}
    47			try {
    48				await this.lock.enter()
    49				const networks = (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
    50				if (networks.length) {
    51					return networks
    52				}
    53	
    54				const defaultNetworks = []
    55				try {
    56					const name = "Alpha Mainnet"
    57					const rpcUrl = "https://aztec-mainnet.drpc.org"
    58					const chainId = 2934756904 // (1 ^ 2934756905) >>> 0
    59					defaultNetworks.push(await this._addNetwork(profile.id, name, rpcUrl, chainId, false))
    60				} catch (error) {
    61					this.logError("Failed to add 'Alpha Mainnet'", getErrorMessage(error))
    62				}
    63				try {
    64					const name = "Testnet"
    65					const rpcUrl = "https://rpc.testnet.aztec-labs.com"
    66					const chainId = 4138294185 // (11155111 ^ 4127419662) >>> 0
    67					defaultNetworks.push(await this._addNetwork(profile.id, name, rpcUrl, chainId, true))
    68				} catch (error) {
    69					this.logError("Failed to add 'Testnet'", getErrorMessage(error))
    70				}
    71				try {
    72					const name = "Devnet"
    73					const rpcUrl = "https://v4-devnet-3.aztec-labs.com/"
    74					const chainId = 896946031 // (11155111 ^ 903641544) >>> 0
    75					defaultNetworks.push(await this._addNetwork(profile.id, name, rpcUrl, chainId, false))
    76				} catch (error) {
    77					this.logError("Failed to add 'Devnet'", getErrorMessage(error))
    78				}
    79				try {
    80					const name = "Local Network"
    81					const rpcUrl = "http://localhost:8080"
    82					const chainId = 0
    83					defaultNetworks.push(await this._addNetwork(profile.id, name, rpcUrl, chainId, false))
    84				} catch (error) {
    85					this.logError("Failed to add 'Local Network'", getErrorMessage(error))
    86				}
    87				for (const network of defaultNetworks.filter((x) => x.isDefault)) {
    88					this.emit("onDefaultNetworkChanged", network)
    89					this.nodes.set(network.chainId, createAztecNodeClient(network.rpcUrl, {}, makeFetchWithTimeout()))
    90				}
    91				return defaultNetworks
    92			} finally {
    93				this.lock.leave()
    94			}
    95		}
    96	
    97		public async getNetworks(chainId?: number): Promise<Network[]> {
    98			validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
    99			await this.ensureInitialized()
   100			const profile = await this.profileService.getActiveProfile()
   101			if (!profile) {
   102				throw new Error("Profile locked")
   103			}
   104			return (await this.storage.getValues()).filter(
   105				(x) => x.profileId === profile.id && (chainId === undefined || x.chainId === chainId),
   106			)
   107		}
   108	
   109		public async getNetwork(id: string): Promise<Network> {
   110			validateParams(NetworkMethodSchemas.getNetwork.params, [id], "getNetwork")
   111			await this.ensureInitialized()
   112			const profile = await this.profileService.getActiveProfile()
   113			if (!profile) {
   114				throw new Error("Profile locked")
   115			}
   116			const network = await this.storage.get(id)
   117			if (network?.profileId !== profile.id) {
   118				throw new Error("Invalid id")
   119			}
   120			return network
   121		}
   122	
   123		public async addNetwork(name: string, rpcUrl: string): Promise<Network> {
   124			validateParams(NetworkMethodSchemas.addNetwork.params, [name, rpcUrl], "addNetwork")
   125			await this.ensureInitialized()
   126			const profile = await this.profileService.getActiveProfile()
   127			if (!profile) {
   128				throw new Error("Profile locked")
   129			}
   130			const chainId = await this.getChainId(rpcUrl)
   131			try {
   132				await this.lock.enter()
   133				const network = await this._addNetwork(profile.id, name, rpcUrl, chainId, false)
   134				this.emit("onNetworkAdded", network)
   135				return network
   136			} finally {
   137				this.lock.leave()
   138			}
   139		}
   140	
   141		public async updateNetwork(id: string, name: string, rpcUrl: string): Promise<Network> {
   142			validateParams(NetworkMethodSchemas.updateNetwork.params, [id, name, rpcUrl], "updateNetwork")
   143			await this.ensureInitialized()
   144			const profile = await this.profileService.getActiveProfile()
   145			if (!profile) {
   146				throw new Error("Profile locked")
   147			}
   148			const chainId = await this.getChainId(rpcUrl)
   149			try {
   150				await this.lock.enter()
   151				const network = await this.storage.get(id)
   152				if (network?.profileId !== profile.id) {
   153					throw new Error("Invalid id")
   154				}
   155				network.isDefault = network.chainId === chainId ? network.isDefault : false
   156				network.name = name
   157				network.rpcUrl = rpcUrl
   158				network.chainId = chainId
   159				await this.storage.set(id, network)
   160				this.emit("onNetworkUpdated", network)
   161				return network
   162			} finally {
   163				this.lock.leave()
   164			}
   165		}
   166	
   167		public async deleteNetwork(id: string): Promise<Network> {
   168			validateParams(NetworkMethodSchemas.deleteNetwork.params, [id], "deleteNetwork")
   169			await this.ensureInitialized()
   170			const profile = await this.profileService.getActiveProfile()
   171			if (!profile) {
   172				throw new Error("Profile locked")
   173			}
   174			try {
   175				await this.lock.enter()
   176				const network = await this.storage.get(id)
   177				if (network?.profileId !== profile.id) {
   178					throw new Error("Invalid id")
   179				}
   180				await this.storage.delete(id)
   181				this.emit("onNetworkDeleted", network)
   182				return network
   183			} finally {
   184				this.lock.leave()
   185			}
   186		}
   187	
   188		public async setDefault(id: string): Promise<Network> {
   189			validateParams(NetworkMethodSchemas.setDefault.params, [id], "setDefault")
   190			await this.ensureInitialized()
   191			const profile = await this.profileService.getActiveProfile()
   192			if (!profile) {
   193				throw new Error("Profile locked")
   194			}
   195			try {
   196				await this.lock.enter()
   197				const network = await this.storage.get(id)
   198				if (network?.profileId !== profile.id) {
   199					throw new Error("Invalid id")
   200				}
   201				const networks = (await this.storage.getAll()).filter(
   202					([_, _network]) => _network.profileId === network.profileId && _network.chainId === network.chainId && _network.isDefault,
   203				)
   204				for (const [id, _network] of networks) {
   205					_network.isDefault = false
   206					await this.storage.set(id, _network)
   207				}
   208				network.isDefault = true
   209				await this.storage.set(id, network)
   210				this.nodes.set(network.chainId, createAztecNodeClient(network.rpcUrl, {}, makeFetchWithTimeout()))
   211				this.emit("onDefaultNetworkChanged", network)
   212				return network
   213			} finally {
   214				this.lock.leave()
   215			}
   216		}
   217	
   218		public async getNodeStatus(id: string): Promise<NodeStatus> {
   219			validateParams(NetworkMethodSchemas.getNodeStatus.params, [id], "getNodeStatus")
   220			await this.ensureInitialized()
   221			const profile = await this.profileService.getActiveProfile()
   222			if (!profile) {
   223				throw new Error("Profile locked")
   224			}
   225			const network = await this.storage.get(id)
   226			if (network?.profileId !== profile.id) {
   227				throw new Error("Invalid id")
   228			}
   229			try {
   230				const chainId = await this.getChainId(network.rpcUrl)
   231				if (chainId !== network.chainId) {
   232					return NodeStatus.InvalidChain
   233				}
   234				return NodeStatus.Active
   235			} catch {
   236				return NodeStatus.Inactive
   237			}
   238		}
   239	
   240		public async getNode(chainId: number): Promise<AztecNode> {
   241			await this.ensureInitialized()
   242			try {
   243				await this.lock.enter()
   244				let node = this.nodes.get(chainId)
   245				if (!node) {
   246					const profile = await this.profileService.getActiveProfile()
   247					if (!profile) {
   248						throw new Error("Profile locked")
   249					}
   250					const networks = (await this.storage.getValues()).filter((x) => x.profileId === profile.id && x.chainId === chainId)
   251					const network = networks.find((x) => x.isDefault) ?? networks[0]
   252					node = createAztecNodeClient(network.rpcUrl, {}, makeFetchWithTimeout())
   253					this.nodes.set(chainId, node)
   254				}
   255				return node
   256			} finally {
   257				this.lock.leave()
   258			}
   259		}
   260	
   261		private async _addNetwork(profileId: string, name: string, rpcUrl: string, chainId: number, isDefault: boolean): Promise<Network> {
   262			let id: string
   263			do {
   264				id = getRandomHex(8)
   265			} while (await this.storage.contains(id))
   266			const network: Network = {
   267				id,
   268				profileId,
   269				name,
   270				rpcUrl,
   271				chainId,
   272				isDefault,
   273			}
   274			await this.storage.set(network.id, network)
   275			return network
   276		}
   277	
   278		private async getChainId(rpcUrl: string): Promise<number> {
   279			try {
   280				const rpc = createAztecNodeClient(rpcUrl, {}, makeFetchWithTimeout())
   281				const info = await rpc.getNodeInfo()
   282				if (rpcUrl === "http://localhost:8080") {
   283					return 0
   284				}
   285				return (info.l1ChainId ^ info.rollupVersion) >>> 0
   286			} catch (error) {
   287				this.logError("Failed to fetch node info", getErrorMessage(error))
   288				throw new Error("Failed to fetch node info")
   289			}
   290		}
   291	
   292		private readonly onActiveProfileChanged = async () => {
   293			try {
   294				await this.lock.enter()
   295				this.nodes.clear()
   296			} finally {
   297				this.lock.leave()
   298			}
   299		}
   300	
   301		private readonly onProfileDeleted = async (profile: ProfileInfo) => {
   302			this.logDebug(`Profile ${profile.id} deleted, remove related networks`)
   303			try {
   304				await this.lock.enter()
   305				this.nodes.clear()
   306				const networks = (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
   307				for (const network of networks) {
   308					this.logDebug(`Remove network #${network.id}`)
   309					await this.storage.delete(network.id)
   310					this.emit("onNetworkDeleted", network)
   311				}
   312			} finally {
   313				this.lock.leave()
   314			}
   315		}
   316	
   317		public async backup(): Promise<Network[]> {
   318			return await this.getNetworks()
   319		}
   320	
   321		public async restore(networks: Network[]): Promise<Restored<Network>[]> {
   322			await this.ensureInitialized()
   323	
   324			const result: Restored<Network>[] = []
   325			try {
   326				await this.lock.enter()
   327	
   328				for (const n of networks) {
   329					try {
   330						let id = n.id
   331						while (await this.storage.contains(id)) {
   332							id = getRandomHex(8)
   333						}
   334	
   335						await this.storage.set(id, { ...n, id })
   336						result.push({ ...n, id })
   337					} catch (err) {
   338						result.push({
   339							...n,
   340							restoreError: err instanceof Error ? err.message : err,
   341						})
   342					}
   343				}
   344	
   345				return result
   346			} finally {
   347				this.lock.leave()
   348			}
   349		}
   350	}

 succeeded in 0ms:
     1	import { FunctionType } from "@aztec/stdlib/abi"
     2	import type { ILogger } from "@/wallet/logger"
     3	import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
     4	import { Service } from "@/wallet/base/background"
     5	import { getTokenInfo } from "@/wallet/services/token/utils"
     6	import { EventHandler } from "@/wallet/utils/event-handler"
     7	import { EntityStorage, StorageType } from "@/wallet/storage"
     8	import { array_max, sleep } from "@/wallet/utils"
     9	import { Queue } from "@/wallet/utils/queue"
    10	import { AccountService, type Account } from "@/wallet/services/account/service"
    11	import { NetworkService } from "@/wallet/services/network/service"
    12	import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
    13	import { TokenService, type Token, type TokenInfo } from "@/wallet/services/token/service"
    14	import { BalanceOfPrivateFn, BalanceOfPublicFn } from "@/wallet/services/token/functions"
    15	import { ExecutionService, type CallAction, type EncodedCallAction } from "@/wallet/services/execution/service"
    16	import { TaskService, BalanceUpdateContent } from "@/wallet/services/task/service"
    17	import { OriginType, TransactionService, type Tx, TxStatus } from "@/wallet/services/transaction/service"
    18	import type { ViewFn } from "@/wallet/utils/fn"
    19	import { getErrorMessage } from "@/wallet/utils/errors"
    20	import { TOKEN_BALANCE_SERVICE_NAME, type TokenBalanceRaw, type TokenBalanceInfo, type Methods, type Events } from "./spec"
    21	
    22	export * from "./spec"
    23	
    24	export class TokenBalanceService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
    25		public static name = TOKEN_BALANCE_SERVICE_NAME
    26	
    27		public readonly onTokenBalanceAdded = new EventHandler<TokenBalanceInfo>()
    28		public readonly onTokenBalanceUpdated = new EventHandler<TokenBalanceInfo>()
    29		public readonly onTokenBalanceDeleted = new EventHandler<TokenBalanceInfo>()
    30	
    31		private readonly balances = new EntityStorage<TokenBalanceRaw>("nulo:core:token-balances", StorageType.Local)
    32		private readonly queue = new Queue<number, TokenBalanceRaw>((x) => x.id)
    33		private readonly pendingTasks = new Map<number, string>()
    34		private readonly tokens = new Map<number, Token>()
    35	
    36		private profileService: ProfileService = null!
    37		private networkService: NetworkService = null!
    38		private accountService: AccountService = null!
    39		private tokenService: TokenService = null!
    40		private transactionService: TransactionService = null!
    41		private executionService: ExecutionService = null!
    42		private taskService: TaskService = null!
    43	
    44		private profile?: ProfileInfo = undefined
    45	
    46		public constructor(logger: ILogger) {
    47			super(TOKEN_BALANCE_SERVICE_NAME, logger)
    48		}
    49	
    50		protected async init(services: ServiceCollection) {
    51			this.profileService = services.get(ProfileService.name)
    52			this.networkService = services.get(NetworkService.name)
    53			this.accountService = services.get(AccountService.name)
    54			this.tokenService = services.get(TokenService.name)
    55			this.transactionService = services.get(TransactionService.name)
    56			this.executionService = services.get(ExecutionService.name)
    57			this.taskService = services.get(TaskService.name)
    58	
    59			this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
    60			this.accountService.onAccountAdded.add(this.onAccountAdded)
    61			this.tokenService.onTokenAdded.add(this.onTokenAdded)
    62			this.tokenService.onTokenUpdated.add(this.onTokenUpdated)
    63			this.tokenService.onTokenDeleted.add(this.onTokenDeleted)
    64			this.transactionService.onTransactionUpdated.add(this.onTransactionUpdated)
    65	
    66			this.profile = await this.profileService.getActiveProfile()
    67			if (this.profile) {
    68				for (const token of await this.tokenService.getTokensRaw(this.profile.id)) {
    69					this.tokens.set(token.id, token)
    70				}
    71			}
    72	
    73			this.worker = this.startWorker()
    74		}
    75	
    76		public async getTokenBalance(id: number): Promise<TokenBalanceInfo> {
    77			await this.ensureInitialized()
    78			const balance = await this.balances.get(`${id}`)
    79			if (!balance) {
    80				throw new Error("unknown token balance id")
    81			}
    82	
    83			return this.getTokenBalanceInfo(balance)
    84		}
    85	
    86		public async getTokenBalances(tokenId?: number, accountAddress?: string): Promise<TokenBalanceInfo[]> {
    87			await this.ensureInitialized()
    88			return (await this.balances.getValues())
    89				.filter((x) => tokenId === undefined || x.token === tokenId)
    90				.filter((x) => accountAddress === undefined || x.account === accountAddress)
    91				.map((x) => this.getTokenBalanceInfo(x), this)
    92		}
    93	
    94		public async refreshTokenBalance(id: number): Promise<void> {
    95			const balance = await this.balances.get(`${id}`)
    96			if (!balance) {
    97				throw new Error("unknown token balance id")
    98			}
    99			this.addBalanceToRefreshQueue(balance)
   100		}
   101	
   102		public async refreshAccountBalances(account: string): Promise<void> {
   103			for (const balance of (await this.balances.getValues()).filter((x) => x.account === account)) {
   104				this.addBalanceToRefreshQueue(balance)
   105			}
   106		}
   107	
   108		private addBalanceToRefreshQueue(balance: TokenBalanceRaw): void {
   109			if (!this.pendingTasks.has(balance.id)) {
   110				const task = this.taskService.createNewTask(new BalanceUpdateContent(balance.id, balance.account))
   111				this.pendingTasks.set(balance.id, task.id)
   112			}
   113			this.queue.priorityPass(balance)
   114		}
   115	
   116		private async createTokenBalance(token: Token, account: Account) {
   117			const tb: TokenBalanceRaw = {
   118				id: array_max((await this.balances.getKeys()).map((x) => +x)) + 1,
   119				token: token.id,
   120				account: account.address,
   121				privateBalance: "0",
   122				publicBalance: "0",
   123				updatedAt: 0,
   124			}
   125			await this.balances.set(`${tb.id}`, tb)
   126			this.emit("onTokenBalanceAdded", this.getTokenBalanceInfo(tb))
   127			this.addBalanceToRefreshQueue(tb)
   128		}
   129	
   130		private getTokenBalanceInfo(tb: TokenBalanceRaw, tokenInfo?: TokenInfo): TokenBalanceInfo {
   131			if (!tokenInfo) {
   132				const token = this.tokens.get(tb.token)
   133				if (!token) {
   134					throw new Error("unknown token")
   135				}
   136				tokenInfo = getTokenInfo(token)
   137			}
   138			return {
   139				id: tb.id,
   140				token: tokenInfo,
   141				account: tb.account,
   142				publicBalance: tb.publicBalance,
   143				privateBalance: tb.privateBalance,
   144				updatedAt: tb.updatedAt,
   145			}
   146		}
   147	
   148		private readonly onActiveProfileChanged = async (profile?: ProfileInfo) => {
   149			this.profile = profile
   150			if (profile) {
   151				this.tokens.clear()
   152				for (const token of await this.tokenService.getTokensRaw(profile.id)) {
   153					this.tokens.set(token.id, token)
   154				}
   155			}
   156		}
   157	
   158		private readonly onAccountAdded = async (account: Account) => {
   159			for (const token of this.tokens.values().filter((x) => x.chainId === account.chainId)) {
   160				await this.createTokenBalance(token, account)
   161			}
   162		}
   163	
   164		private readonly onTokenAdded = async (token: TokenInfo) => {
   165			const tokenRaw = await this.tokenService.getTokenRaw(token.id)
   166			this.tokens.set(token.id, tokenRaw)
   167			for (const account of await this.accountService.getAccounts(this.profile!.id, token.chainId, true)) {
   168				await this.createTokenBalance(tokenRaw, account)
   169			}
   170		}
   171	
   172		private readonly onTokenUpdated = async (token: TokenInfo) => {
   173			this.tokens.set(token.id, await this.tokenService.getTokenRaw(token.id))
   174			for (const tb of (await this.balances.getValues()).filter((x) => x.token === token.id)) {
   175				this.addBalanceToRefreshQueue(tb)
   176			}
   177		}
   178	
   179		private readonly onTokenDeleted = async (token: TokenInfo) => {
   180			this.tokens.delete(token.id)
   181			for (const tb of (await this.balances.getValues()).filter((x) => x.token === token.id)) {
   182				await this.balances.delete(`${tb.id}`)
   183				this.emit("onTokenBalanceDeleted", this.getTokenBalanceInfo(tb, token))
   184			}
   185		}
   186	
   187		private readonly onTransactionUpdated = async (tx: Tx) => {
   188			if (tx.status !== TxStatus.Pending) {
   189				if (tx.origin.type === OriginType.UI) {
   190					const addresses = new Set<string>()
   191					const contracts = new Set<string>()
   192					const tokenIds = new Set<number>()
   193	
   194					for (const c of tx.calls) {
   195						if (c.contract && c.transfers) {
   196							contracts.add(c.contract)
   197						}
   198						if (c.transfers) {
   199							for (const t of c.transfers) {
   200								addresses.add(t.to)
   201								addresses.add(t.from)
   202							}
   203						}
   204					}
   205	
   206					// If we found specific transfer info, refresh only affected balances.
   207					// Otherwise (e.g. faucet mints, generic contract calls), refresh all
   208					// balances for the tx account since we can't narrow the scope.
   209					if (addresses.size > 0 && contracts.size > 0) {
   210						for (const t of this.tokens.values()) {
   211							if (contracts.has(t.contract)) {
   212								tokenIds.add(t.id)
   213							}
   214						}
   215	
   216						const _balances = await this.balances.getValues()
   217						for (const tb of _balances) {
   218							if (addresses.has(tb.account) && tokenIds.has(tb.token)) {
   219								this.addBalanceToRefreshQueue(tb)
   220							}
   221						}
   222					} else {
   223						await this.refreshAccountBalances(tx.account)
   224					}
   225	
   226					return
   227				}
   228	
   229				await this.refreshAccountBalances(tx.account)
   230			}
   231		}
   232	
   233		private async startWorker() {
   234			while (true) {
   235				if (this.profile) {
   236					try {
   237						if (this.queue.length) {
   238							this.logDebug(`Syncing ${this.queue.length} token balances`)
   239							const start = Date.now()
   240							while (this.queue.length) {
   241								const firstAccount = this.queue.peek()!.account
   242								const tbs: TokenBalanceRaw[] = []
   243								while (this.queue.peek()?.account === firstAccount && tbs.length < 12) {
   244									tbs.push(this.queue.dequeue()!)
   245								}
   246								await this.syncBatch(firstAccount, tbs)
   247							}
   248							const end = Date.now()
   249							this.logDebug(`Token balances synced in ${end - start}ms`)
   250						}
   251					} catch (error) {
   252						this.logError("Failed to sync token balances.", getErrorMessage(error))
   253					}
   254				}
   255				await sleep(1000)
   256			}
   257		}
   258	
   259		private async syncBatch(account: string, tbs: TokenBalanceRaw[]) {
   260			for (const tb of tbs) {
   261				const taskId = this.pendingTasks.get(tb.id)
   262				if (!taskId) {
   263					const task = this.taskService.startNewTask(new BalanceUpdateContent(tb.id, account))
   264					this.pendingTasks.set(tb.id, task.id)
   265				} else {
   266					this.taskService.startTask(taskId)
   267				}
   268			}
   269	
   270			try {
   271				this.logDebug(`Syncing ${tbs.length} balances for ${account}`)
   272				const start = Date.now()
   273	
   274				const calls: [CallAction | EncodedCallAction, number, boolean, ViewFn][] = []
   275				let chainId: number | undefined
   276				for (let i = 0; i < tbs.length; i++) {
   277					const tb = tbs[i]
   278					const token = this.tokens.get(tb.token)
   279					if (!token) {
   280						this.logError(`Unknown token #${tb.token}`)
   281						const taskId = this.pendingTasks.get(tb.id)!
   282						this.taskService.failTask(taskId, `Unknown token #${tb.token}`)
   283						continue
   284					}
   285					chainId = token.chainId
   286					// sync private balance
   287					if (token.balanceOfPrivateFn) {
   288						const balanceOfPrivateFn = BalanceOfPrivateFn.new(token.balanceOfPrivateFn.name, token.balanceOfPrivateFn.impl)
   289						if (balanceOfPrivateFn.type === FunctionType.UTILITY) {
   290							calls.push([
   291								{
   292									kind: "call",
   293									contract: token.contract,
   294									method: balanceOfPrivateFn.name,
   295									args: balanceOfPrivateFn.buildArgs(account),
   296								},
   297								i,
   298								true,
   299								balanceOfPrivateFn,
   300							])
   301						} else {
   302							const selector = await balanceOfPrivateFn.getSelector()
   303							const encodedArgs = balanceOfPrivateFn.encodeArgs(balanceOfPrivateFn.buildArgs(account))
   304							calls.push([
   305								{
   306									kind: "encoded_call",
   307									to: token.contract,
   308									selector: selector.toString(),
   309									args: encodedArgs.map((x) => x.toString()),
   310									name: balanceOfPrivateFn.name,
   311									type: balanceOfPrivateFn.type,
   312									isStatic: balanceOfPrivateFn.isStatic,
   313									returnTypes: balanceOfPrivateFn.getReturnTypes(),
   314								},
   315								i,
   316								true,
   317								balanceOfPrivateFn,
   318							])
   319						}
   320					} else {
   321						tb.privateBalance = "0"
   322					}
   323					// sync public balance
   324					if (token.balanceOfPublicFn) {
   325						const balanceOfPublicFn = BalanceOfPublicFn.new(token.balanceOfPublicFn.name, token.balanceOfPublicFn.impl)
   326						if (balanceOfPublicFn.type === FunctionType.UTILITY) {
   327							calls.push([
   328								{
   329									kind: "call",
   330									contract: token.contract,
   331									method: balanceOfPublicFn.name,
   332									args: balanceOfPublicFn.buildArgs(account),
   333								},
   334								i,
   335								false,
   336								balanceOfPublicFn,
   337							])
   338						} else {
   339							const selector = await balanceOfPublicFn.getSelector()
   340							const encodedArgs = balanceOfPublicFn.encodeArgs(balanceOfPublicFn.buildArgs(account))
   341							calls.push([
   342								{
   343									kind: "encoded_call",
   344									to: token.contract,
   345									selector: selector.toString(),
   346									args: encodedArgs.map((x) => x.toString()),
   347									name: balanceOfPublicFn.name,
   348									type: balanceOfPublicFn.type,
   349									isStatic: balanceOfPublicFn.isStatic,
   350									returnTypes: balanceOfPublicFn.getReturnTypes(),
   351								},
   352								i,
   353								false,
   354								balanceOfPublicFn,
   355							])
   356						}
   357					} else {
   358						tb.publicBalance = "0"
   359					}
   360				}
   361				if (chainId !== undefined) {
   362					const network = (await this.networkService.getNetworks(chainId)).find((x) => x.isDefault)
   363					if (!network) {
   364						throw new Error(`Failed to find network #${chainId}`)
   365					}
   366					const results = await this.executionService.executeSimulateViews({
   367						kind: "simulate_views",
   368						networkId: network.id,
   369						accountAddress: account,
   370						calls: calls.map((x) => x[0]),
   371					})
   372					for (let i = 0; i < calls.length; i++) {
   373						const [_, tbIndex, isPrivate, viewFn] = calls[i]
   374						const balance = (viewFn.unpackResult(results.encoded[i]) as bigint).toString()
   375						if (isPrivate) {
   376							if (tbs[tbIndex].privateBalance !== balance) {
   377								this.logDebug(`Private balance #${tbs[tbIndex].id} changed: ${tbs[tbIndex].privateBalance} -> ${balance}`)
   378								tbs[tbIndex].privateBalance = balance
   379							}
   380						} else {
   381							if (tbs[tbIndex].publicBalance !== balance) {
   382								this.logDebug(`Public balance #${tbs[tbIndex].id} changed: ${tbs[tbIndex].publicBalance} -> ${balance}`)
   383								tbs[tbIndex].publicBalance = balance
   384							}
   385						}
   386					}
   387				}
   388				const now = Date.now()
   389				const balances = await this.balances.getValues()
   390				for (const tb of tbs) {
   391					tb.updatedAt = now
   392					const balance = balances.find((x) => x.token === tb.token && x.account === tb.account)
   393	
   394					const taskId = this.pendingTasks.get(tb.id)!
   395					if (balance) {
   396						await this.balances.set(`${tb.id}`, tb)
   397						this.taskService.completeTask(taskId)
   398						this.emit("onTokenBalanceUpdated", this.getTokenBalanceInfo(tb))
   399					} else {
   400						this.taskService.failTask(taskId, "Balance record not found")
   401					}
   402				}
   403	
   404				const stop = Date.now()
   405				this.logDebug(`Synced in ${stop - start}ms`)
   406			} catch (error) {
   407				const errorMessage = getErrorMessage(error)
   408				this.logError("Failed to sync", errorMessage)
   409				for (const tb of tbs) {
   410					const taskId = this.pendingTasks.get(tb.id)!
   411					const task = this.taskService.getTaskSync(taskId)
   412					if (!task.finishedAt) {
   413						this.taskService.failTask(taskId, errorMessage)
   414					}
   415				}
   416			} finally {
   417				tbs.forEach((tb) => this.pendingTasks.delete(tb.id))
   418			}
   419		}
   420	
   421		public async backup(): Promise<TokenBalanceRaw[]> {
   422			const profile = await this.profileService.getActiveProfile()
   423			if (!profile) {
   424				throw new Error("Profile locked")
   425			}
   426	
   427			return await this.balances.getValues()
   428		}
   429	
   430		public async restore(tokenBalances: TokenBalanceRaw[]): Promise<Restored<TokenBalanceRaw>[]> {
   431			await this.ensureInitialized()
   432	
   433			const result: Restored<TokenBalanceRaw>[] = []
   434			for (const tb of tokenBalances) {
   435				try {
   436					const id = array_max((await this.balances.getKeys()).map((x) => +x)) + 1
   437					await this.balances.set(`${id}`, { ...tb, id })
   438					result.push({ ...tb, id })
   439				} catch (err) {
   440					result.push({
   441						...tb,
   442						restoreError: err instanceof Error ? err.message : err,
   443					})
   444				}
   445			}
   446	
   447			return result
   448		}
   449	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/passkey/service.ts | sed -n '1,260p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/dapp-interaction/service.ts | sed -n '1,320p'" in (project root)
 succeeded in 0ms:
     1	import type { ServiceSpec } from "@/wallet/base"
     2	import { Service } from "@/wallet/base/background"
     3	import type { ILogger } from "@/wallet/logger"
     4	import { PASSKEY_SERVICE_NAME, type Methods, type PasskeyCredentialData, type PasskeyRequest, type PasskeyRequestPromise } from "./spec"
     5	import { PasskeyCredential } from "./credential"
     6	import { getRandomHex } from "@/wallet/utils"
     7	
     8	export * from "./spec"
     9	
    10	/**
    11	 * Hard timeout for a passkey popup. Bounds the worst case when neither the
    12	 * user interacts nor `chrome.windows.onRemoved` fires (eg. extension reload,
    13	 * popup crash, MV3 suspension races). 5 minutes is ample for WebAuthn UX.
    14	 */
    15	const PASSKEY_TIMEOUT_MS = 5 * 60 * 1000
    16	
    17	export class PasskeyService extends Service<Methods> implements ServiceSpec<Methods> {
    18		public static name = PASSKEY_SERVICE_NAME
    19	
    20		private pending: Map<string, PasskeyRequestPromise> = new Map()
    21	
    22		public constructor(logger: ILogger) {
    23			super(PASSKEY_SERVICE_NAME, logger)
    24		}
    25	
    26		public async createKey(userHandle: string): Promise<PasskeyCredential> {
    27			return await this.openWindowAndWait({ mode: "create", userHandle })
    28		}
    29	
    30		public async getKey(credentialId?: string): Promise<PasskeyCredential> {
    31			return await this.openWindowAndWait({ mode: "get", credentialId })
    32		}
    33	
    34		public async getPendingRequest(requestId: string): Promise<PasskeyRequest> {
    35			const entry = this.pending.get(requestId)
    36			if (!entry) throw new Error("Invalid request id")
    37			return entry.request
    38		}
    39	
    40		public async resolvePasskeyRequest(requestId: string, result: PasskeyCredentialData): Promise<void> {
    41			const entry = this.pending.get(requestId)
    42			if (!entry) throw new Error("Invalid request id")
    43			const credential = await PasskeyCredential.create(result)
    44			this.pending.delete(requestId)
    45			this.logDebug("Passkey request resolved: ", credential.id)
    46			entry.resolve(credential)
    47		}
    48	
    49		public async rejectPasskeyRequest(requestId: string, reason: string): Promise<void> {
    50			const entry = this.pending.get(requestId)
    51			if (!entry) throw new Error("Invalid request id")
    52			this.pending.delete(requestId)
    53			this.logInfo("Passkey request rejected: ", reason)
    54			entry.reject(reason)
    55		}
    56	
    57		private async openWindowAndWait(request: PasskeyRequest): Promise<PasskeyCredential> {
    58			let id: string
    59			do {
    60				id = getRandomHex(8)
    61			} while (this.pending.has(id))
    62			const promise = new Promise<PasskeyCredential>((resolve, reject) => {
    63				this.pending.set(id, { resolve, reject, request })
    64			})
    65	
    66			const fail = (reason: string) => {
    67				const entry = this.pending.get(id)
    68				if (entry) {
    69					this.pending.delete(id)
    70					entry.reject(reason)
    71				}
    72			}
    73	
    74			const timeoutHandle = setTimeout(() => fail("Passkey request timed out"), PASSKEY_TIMEOUT_MS)
    75	
    76			chrome.windows.create(
    77				{
    78					type: "popup",
    79					url: chrome.runtime.getURL(`src/popup/index.html#/windows/passkey?requestId=${id}`),
    80					height: 800,
    81					width: 500,
    82				},
    83				(createdWindow) => {
    84					// chrome.runtime.lastError must be read inside the callback to clear it.
    85					const runtimeError = chrome.runtime.lastError
    86					if (runtimeError || !createdWindow || createdWindow.id == null) {
    87						clearTimeout(timeoutHandle)
    88						fail(runtimeError?.message ?? "Failed to open passkey window")
    89						return
    90					}
    91	
    92					const windowId = createdWindow.id
    93	
    94					const onRemoved = (closedWindowId: number) => {
    95						if (closedWindowId === windowId) {
    96							chrome.windows.onRemoved.removeListener(onRemoved)
    97							clearTimeout(timeoutHandle)
    98							fail("User closed the passkey window")
    99						}
   100					}
   101	
   102					chrome.windows.onRemoved.addListener(onRemoved)
   103				},
   104			)
   105	
   106			return promise.finally(() => clearTimeout(timeoutHandle))
   107		}
   108	}

 succeeded in 0ms:
     1	import type { AztecAddress } from "@aztec/stdlib/aztec-address"
     2	import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
     3	import { Service } from "@/wallet/base/background"
     4	import type { ILogger } from "@/wallet/logger"
     5	import { ProfileService } from "@/wallet/services/profile/service"
     6	import { NetworkService, type Network } from "@/wallet/services/network/service"
     7	import { AccountService, type Account } from "@/wallet/services/account/service"
     8	import { DappSessionService, AccessLevel, type DappSession } from "@/wallet/services/dapp-session/service"
     9	import { ExecutionService, type Operation, type OperationKind } from "@/wallet/services/execution/service"
    10	import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/service"
    11	import { getRandomHex, Lock } from "@/wallet/utils"
    12	import { parseCaipAccount, parseCaipChain, resolveNetworkByChainId } from "@/wallet/utils/caip"
    13	import { getErrorMessage } from "@/wallet/utils/errors"
    14	import { EventHandler } from "@/wallet/utils/event-handler"
    15	import {
    16		DAPP_INTERACTION_SERVICE_NAME,
    17		type ExecutionPayload,
    18		type ExecutionResult,
    19		type CapabilityPayload,
    20		type CapabilityParams,
    21		type CapabilityResult,
    22		type DiscoveryPayload,
    23		type DiscoveryParams,
    24		type DiscoveryResult,
    25		type ExecutionParams,
    26		type CaipChain,
    27		type CaipAccount,
    28		type OperationRequest,
    29		type Methods,
    30		type Events,
    31		type DappInteraction,
    32	} from "./spec"
    33	
    34	export * from "./spec"
    35	
    36	/**
    37	 * Hard timeout for an approval popup. Bounds the worst case when neither the
    38	 * user interacts nor `chrome.windows.onRemoved` fires (eg. extension reload,
    39	 * popup crash, MV3 suspension races). Longer than the longest realistic
    40	 * prove+approve flow so legitimate users aren't surprised.
    41	 */
    42	const INTERACTION_TIMEOUT_MS = 10 * 60 * 1000
    43	
    44	export class DappInteractionService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
    45		public static name = DAPP_INTERACTION_SERVICE_NAME
    46	
    47		public readonly onInteractionCancelled = new EventHandler<string>()
    48	
    49		private readonly storage: Map<string, DappInteraction> = new Map()
    50		private readonly lock = new Lock()
    51	
    52		private profileService: ProfileService = null!
    53		private networkService: NetworkService = null!
    54		private accountService: AccountService = null!
    55		private dappSessionService: DappSessionService = null!
    56		private executionService: ExecutionService = null!
    57	
    58		public constructor(logger: ILogger) {
    59			super(DAPP_INTERACTION_SERVICE_NAME, logger)
    60		}
    61	
    62		protected async init(services: ServiceCollection) {
    63			this.profileService = services.get(ProfileService.name)
    64			this.networkService = services.get(NetworkService.name)
    65			this.accountService = services.get(AccountService.name)
    66			this.dappSessionService = services.get(DappSessionService.name)
    67			this.executionService = services.get(ExecutionService.name)
    68		}
    69	
    70		public async getInteractionPayload(id: string): Promise<ExecutionPayload | CapabilityPayload | DiscoveryPayload> {
    71			const interactionRequest = this.storage.get(id)
    72			if (!interactionRequest) {
    73				throw new Error("Invalid id")
    74			}
    75			return interactionRequest.payload
    76		}
    77	
    78		public async approveInteraction(id: string, operations: Operation[], origin: LocalTxOrigin): Promise<void> {
    79			const interaction = this.storage.get(id)
    80			if (!interaction) {
    81				throw new Error("Invalid id")
    82			}
    83			this.storage.delete(id)
    84			this.executeAndResolve(interaction, operations, origin)
    85		}
    86	
    87		public async resolveInteraction(id: string, result: ExecutionResult | CapabilityResult | DiscoveryResult): Promise<void> {
    88			const interactionRequest = this.storage.get(id)
    89			if (!interactionRequest) {
    90				throw new Error("Invalid id")
    91			}
    92			this.storage.delete(id)
    93			interactionRequest.resolve(result)
    94		}
    95	
    96		public async rejectInteraction(id: string, reason: string): Promise<void> {
    97			const interactionRequest = this.storage.get(id)
    98			if (!interactionRequest) {
    99				return
   100			}
   101			this.storage.delete(id)
   102			interactionRequest.reject(reason)
   103		}
   104	
   105		private async executeAndResolve(interaction: DappInteraction, operations: Operation[], origin: LocalTxOrigin): Promise<void> {
   106			const kinds = operations.map((o) => o.kind).join(", ")
   107			this.logInfo(`executeAndResolve: starting [${kinds}] for ${origin.name}`)
   108			try {
   109				await this.profileService.refreshSession()
   110				const result = await this.executionService.executeOperations(operations, origin)
   111				this.logInfo(`executeAndResolve: resolved [${kinds}]`)
   112				interaction.resolve(result)
   113			} catch (error) {
   114				this.logError(`executeAndResolve: failed [${kinds}]`, getErrorMessage(error))
   115				interaction.reject(error instanceof Error ? error.message : "Execution failed")
   116			}
   117		}
   118	
   119		public cancelInteraction(cancellationToken: string) {
   120			const interaction = this.storage.values().find((x) => x.cancellationToken === cancellationToken)
   121			if (interaction) {
   122				this.emit("onInteractionCancelled", interaction.id)
   123			}
   124		}
   125	
   126		public async execute(params: ExecutionParams, cancellationToken?: string): Promise<ExecutionResult> {
   127			await this.ensureInitialized()
   128			const session = await this.validateSession(params)
   129			const payload: ExecutionPayload = { params, session }
   130			if (!(await this.isConfirmationNeeded(payload))) {
   131				return await this.silentInteraction(payload)
   132			}
   133			return (await this.interaction("execute", payload, cancellationToken)) as ExecutionResult
   134		}
   135	
   136		public async requestCapabilities(params: CapabilityParams, cancellationToken?: string): Promise<CapabilityResult> {
   137			await this.ensureInitialized()
   138			const session = await this.dappSessionService.getDappSession(params.sessionId)
   139			const payload: CapabilityPayload = { params, session }
   140			return (await this.interaction("capabilities", payload, cancellationToken)) as CapabilityResult
   141		}
   142	
   143		public async discover(params: DiscoveryParams, cancellationToken?: string): Promise<DiscoveryResult> {
   144			const payload: DiscoveryPayload = { params }
   145			return (await this.interaction("discover", payload, cancellationToken)) as DiscoveryResult
   146		}
   147	
   148		private async interaction(
   149			type: string,
   150			payload: ExecutionPayload | CapabilityPayload | DiscoveryPayload,
   151			cancellationToken?: string,
   152		): Promise<ExecutionResult | CapabilityResult | DiscoveryResult> {
   153			let interaction: DappInteraction
   154			let promise: Promise<ExecutionResult | CapabilityResult | DiscoveryResult>
   155	
   156			try {
   157				await this.lock.enter()
   158	
   159				let id: string
   160				do {
   161					id = getRandomHex(8)
   162				} while (this.storage.has(id))
   163	
   164				interaction = {
   165					id,
   166					payload,
   167					resolve: null!,
   168					reject: null!,
   169					cancellationToken: cancellationToken ?? id,
   170				}
   171	
   172				promise = new Promise<ConnectionResult | ExecutionResult | CapabilityResult | DiscoveryResult>((resolve, reject) => {
   173					interaction.resolve = resolve
   174					interaction.reject = reject
   175				})
   176	
   177				this.storage.set(id, interaction)
   178			} finally {
   179				this.lock.leave()
   180			}
   181	
   182			const fail = (reason: string) => {
   183				if (this.storage.has(interaction.id)) {
   184					this.storage.delete(interaction.id)
   185					interaction.reject(reason)
   186				}
   187			}
   188	
   189			// Hard timeout guards against popup-approval requests sitting in storage
   190			// forever when neither user interaction nor window close ever fires.
   191			// 10 minutes matches the longest realistic prove+approve flow.
   192			const timeoutHandle = setTimeout(() => fail("Approval request timed out"), INTERACTION_TIMEOUT_MS)
   193	
   194			chrome.windows.create(
   195				{
   196					type: "popup",
   197					url: chrome.runtime.getURL(`src/popup/index.html#/windows/${type}?requestId=${interaction.id}`),
   198					height: 800,
   199					width: 400,
   200				},
   201				(createdWindow) => {
   202					// chrome.runtime.lastError must be read inside the callback to clear it.
   203					const runtimeError = chrome.runtime.lastError
   204					if (runtimeError || !createdWindow?.id) {
   205						clearTimeout(timeoutHandle)
   206						fail(runtimeError?.message ?? "Failed to open approval window")
   207						return
   208					}
   209					const windowId = createdWindow.id
   210					const onWindowClosed = (closedWindowId: number) => {
   211						if (closedWindowId !== windowId) return
   212						chrome.windows.onRemoved.removeListener(onWindowClosed)
   213						clearTimeout(timeoutHandle)
   214						fail("User closed the popup window")
   215					}
   216					chrome.windows.onRemoved.addListener(onWindowClosed)
   217				},
   218			)
   219	
   220			return promise.finally(() => clearTimeout(timeoutHandle))
   221		}
   222	
   223		private async silentInteraction(payload: ExecutionPayload): Promise<ExecutionResult> {
   224			const profile = await this.profileService.getActiveProfile()
   225			if (profile?.id !== payload.session.profileId) {
   226				throw new Error("Wallet locked")
   227			}
   228			const getNetwork = async (caipChain: CaipChain): Promise<Network> => {
   229				const { chainId } = parseCaipChain(caipChain)
   230				return resolveNetworkByChainId(this.networkService, chainId)
   231			}
   232			const getNetworkAndAccount = async (caipAccount: CaipAccount): Promise<[Network, Account]> => {
   233				const { chainId, address } = parseCaipAccount(caipAccount)
   234				const network = await resolveNetworkByChainId(this.networkService, chainId)
   235				const account = await this.accountService.getAccount(profile!.id, network.chainId, address)
   236				if (!account) {
   237					throw new Error("Account no longer exists")
   238				}
   239				return [network, account]
   240			}
   241			const operations: Operation[] = []
   242			for (const op of payload.params.operations) {
   243				switch (op.kind) {
   244					case "register_contract":
   245					case "register_sender":
   246					case "aztec_getContractClassMetadata":
   247					case "aztec_getContractMetadata":
   248					case "aztec_getChainInfo":
   249					case "aztec_registerSender":
   250					case "aztec_getAddressBook":
   251					case "aztec_registerContract":
   252					case "aztec_getPrivateEvents": {
   253						const network = await getNetwork(op.chain)
   254						operations.push({ ...op, networkId: network.id })
   255						break
   256					}
   257					case "get_complete_address":
   258					case "register_token":
   259					case "simulate_transaction":
   260					case "simulate_utility":
   261					case "simulate_views":
   262					case "aztec_simulateTx":
   263					case "aztec_executeUtility":
   264					case "aztec_profileTx":
   265					case "aztec_createAuthWit": {
   266						const [network, account] = await getNetworkAndAccount(op.account)
   267						operations.push({ ...op, networkId: network.id, accountAddress: account.address })
   268						break
   269					}
   270					case "aztec_sendTx":
   271					case "send_transaction": {
   272						const [network, account] = await getNetworkAndAccount(op.account)
   273						operations.push({
   274							...op,
   275							networkId: network.id,
   276							accountAddress: account.address,
   277							feeSettings: { paymentMethod: { kind: "embedded" } },
   278						})
   279						break
   280					}
   281					default: {
   282						throw new Error("Invalid operation kind")
   283					}
   284				}
   285			}
   286			await this.profileService.refreshSession()
   287			return await this.executionService.executeOperations(operations, {
   288				type: OriginType.DAPP,
   289				name: payload.session.dappMetadata.name ?? "Unknown dapp",
   290			})
   291		}
   292	
   293		private async validateSession({ sessionId, operations }: ExecutionParams): Promise<DappSession> {
   294			const session = await this.dappSessionService.tryGetDappSession(sessionId)
   295			if (!session) {
   296				throw new Error("Invalid session")
   297			}
   298			// validate permissions
   299			for (const operation of operations) {
   300				switch (operation.kind) {
   301					case "register_contract":
   302					case "register_sender":
   303					case "aztec_getContractClassMetadata":
   304					case "aztec_getContractMetadata":
   305					case "aztec_getChainInfo":
   306					case "aztec_registerSender":
   307					case "aztec_getAddressBook":
   308					case "aztec_registerContract": {
   309						this.checkMethodPermission(session, operation.kind, operation.chain)
   310						break
   311					}
   312					case "aztec_getPrivateEvents": {
   313						this.checkMethodPermission(session, operation.kind, operation.chain)
   314						this.checkScopesPermissions(session, operation.eventFilter.scopes)
   315						break
   316					}
   317					case "get_complete_address":
   318					case "register_token":
   319					case "simulate_utility":
   320					case "aztec_simulateTx":

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/pxe/chain-runtime.ts | sed -n '1,260p'" in (project root)
 succeeded in 0ms:
     1	import { getPXEConfig, type PXEConfig } from "@aztec/pxe/config"
     2	import { createPXE, type PXE } from "@aztec/pxe/client/bundle"
     3	import { type AztecNode, createAztecNodeClient } from "@aztec/stdlib/interfaces/client"
     4	import { AcceleratorProver } from "@alejoamiras/aztec-accelerator"
     5	import type { Network } from "@/wallet/services/network/client"
     6	import { makeFetchWithTimeout } from "@/wallet/utils/fetch"
     7	
     8	/**
     9	 * Holds the `AztecNode` + `PXE` pair for a single chain bound to a
    10	 * single profile. Created lazily on first access; torn down via
    11	 * `dispose()` when the profile changes or the profile is deleted.
    12	 *
    13	 * The `ChainRuntime` is owned by `ChainRuntimeRegistry`; callers should
    14	 * not construct it directly.
    15	 */
    16	export class ChainRuntime {
    17		public constructor(
    18			public readonly chainId: number,
    19			public readonly node: AztecNode,
    20			public readonly pxe: PXE,
    21			public readonly rpcUrl: string,
    22		) {}
    23	
    24		/**
    25		 * Shut down the PXE. `pxe.stop()` drains the job queue rather than
    26		 * aborting in-flight work (verified against upstream @aztec/pxe); so
    27		 * correctness across profile switch comes from the ReadWriteGuard's
    28		 * drain-on-write semantics, not teardown. This method just releases
    29		 * handles after the guard has ensured no readers remain.
    30		 */
    31		public async dispose(): Promise<void> {
    32			const stoppable = this.pxe as unknown as { stop?: () => Promise<void> }
    33			if (typeof stoppable.stop === "function") {
    34				try {
    35					await stoppable.stop()
    36				} catch {
    37					// Swallow: the caller is tearing down regardless; a failed stop
    38					// is not actionable here.
    39				}
    40			}
    41		}
    42	}
    43	
    44	/** Seam for unit tests: swap this out with a fake that returns a
    45	 *  fixture `ChainRuntime` (e.g. with mock PXE / node) instead of
    46	 *  running real PXE init. */
    47	export interface PxeFactory {
    48		createChainRuntime(network: Network): Promise<ChainRuntime>
    49	}
    50	
    51	export class ProductionPxeFactory implements PxeFactory {
    52		public async createChainRuntime(network: Network): Promise<ChainRuntime> {
    53			const node = createAztecNodeClient(network.rpcUrl, {}, makeFetchWithTimeout())
    54			const config = {
    55				...getPXEConfig(),
    56				dataDirectory: `pxe/${network.profileId}/${network.chainId}`,
    57				proverEnabled: true,
    58			} as PXEConfig
    59			const prover = new AcceleratorProver()
    60			const pxe = await createPXE(node, config, { proverOrOptions: prover })
    61			return new ChainRuntime(network.chainId, node, pxe, network.rpcUrl)
    62		}
    63	}
    64	
    65	/**
    66	 * Per-(profileId, chainId) registry of `ChainRuntime` instances. Owns
    67	 * the dedup-on-concurrent-init promise map so two callers asking for
    68	 * the same chain at once share the init, not double-init.
    69	 *
    70	 * The registry is intended to be called from INSIDE the PxeService
    71	 * ReadWriteGuard's read lock. Under that contract, `clear()` (called
    72	 * from the write lock on profile switch / delete) never runs
    73	 * concurrently with `getOrInit`, so there is no separate stale-init
    74	 * race to handle here — the guard serializes it.
    75	 */
    76	export class ChainRuntimeRegistry {
    77		private readonly runtimes = new Map<string, ChainRuntime>()
    78		private readonly initPromises = new Map<string, Promise<ChainRuntime>>()
    79	
    80		public constructor(private readonly factory: PxeFactory) {}
    81	
    82		private key(profileId: string, chainId: number): string {
    83			return `${profileId}:${chainId}`
    84		}
    85	
    86		/** Returns the initialized runtime for `(profileId, chainId)` or
    87		 *  `undefined` if it hasn't been initialized yet. Never mutates
    88		 *  registry state. */
    89		public peek(profileId: string, chainId: number): ChainRuntime | undefined {
    90			return this.runtimes.get(this.key(profileId, chainId))
    91		}
    92	
    93		/** Lazy-init for `(network.profileId, network.chainId)`. Concurrent
    94		 *  callers share the same init promise. If the runtime exists but
    95		 *  its rpcUrl no longer matches (network re-bound), the existing
    96		 *  runtime is disposed and re-initialized under the new URL. */
    97		public async getOrInit(network: Network): Promise<ChainRuntime> {
    98			const k = this.key(network.profileId, network.chainId)
    99			const existing = this.runtimes.get(k)
   100			if (existing && existing.rpcUrl === network.rpcUrl) {
   101				return existing
   102			}
   103			if (existing && existing.rpcUrl !== network.rpcUrl) {
   104				this.runtimes.delete(k)
   105				await existing.dispose()
   106			}
   107	
   108			let promise = this.initPromises.get(k)
   109			if (!promise) {
   110				promise = this.factory
   111					.createChainRuntime(network)
   112					.then((runtime) => {
   113						this.runtimes.set(k, runtime)
   114						this.initPromises.delete(k)
   115						return runtime
   116					})
   117					.catch((err) => {
   118						this.initPromises.delete(k)
   119						throw err
   120					})
   121				this.initPromises.set(k, promise)
   122			}
   123			return promise
   124		}
   125	
   126		/** Dispose every runtime this registry owns. Must be called under
   127		 *  the PxeService write lock — otherwise concurrent reads may
   128		 *  observe a torn-down runtime. */
   129		public async clear(): Promise<void> {
   130			const runtimes = Array.from(this.runtimes.values())
   131			this.runtimes.clear()
   132			this.initPromises.clear()
   133			await Promise.all(runtimes.map((r) => r.dispose()))
   134		}
   135	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/execution/service.ts | sed -n '140,260p'" in (project root)
 succeeded in 0ms:
   140	export class ExecutionService extends Service<Methods> implements ServiceSpec<Methods> {
   141		public static name = EXECUTION_SERVICE_NAME
   142	
   143		private pxeService: PxeServiceClient = null!
   144		private profileService: ProfileService = null!
   145		private networkService: NetworkService = null!
   146		private accountService: AccountService = null!
   147		private contactService: ContactService = null!
   148		private tokenService: TokenService = null!
   149		private fpcService: FpcService = null!
   150		private transactionService: TransactionService = null!
   151		private authRegistryService: AuthRegistryService = null!
   152		private taskService: TaskService = null!
   153		private operationJournal: OperationJournalService = null!
   154		private planner: OperationPlanner = null!
   155		private resolver: ContractResolver = null!
   156		private authwit: AuthwitDiscoverer = null!
   157		private txBuilder: TxRequestBuilder = null!
   158		private feeStrategies: Map<FeeSettings["paymentMethod"]["kind"], FeeStrategy> = null!
   159		private coordinator: ExecutionCoordinator = null!
   160	
   161		/** TTL cache for gas balance queries (survives popup reopens). */
   162		private static readonly GAS_BALANCE_TTL_MS = 5 * 60 * 1000 // 5 minutes
   163		private gasBalanceCache = new Map<string, { result: GasBalances; fetchedAt: number }>()
   164		/** Single-flight dedup for concurrent getGasBalances callers.
   165		 *  The Send popup mounts multiple components that each call this
   166		 *  simultaneously on unlock; without dedup, each request independently
   167		 *  enters FpcService discovery under a shared lock, amplifying
   168		 *  contention and exposing a wedged PXE call as an N-caller stall. */
   169		private gasBalanceInFlight = new Map<string, Promise<GasBalances>>()
   170	
   171		public constructor(logger: ILogger) {
   172			super(EXECUTION_SERVICE_NAME, logger)
   173		}
   174	
   175		protected async init(services: ServiceCollection) {
   176			this.pxeService = new PxeServiceClient(this.logger)
   177			this.profileService = services.get(ProfileService.name)
   178			this.networkService = services.get(NetworkService.name)
   179			this.accountService = services.get(AccountService.name)
   180			this.contactService = services.get(ContactService.name)
   181			this.tokenService = services.get(TokenService.name)
   182			this.fpcService = services.get(FpcService.name)
   183			this.transactionService = services.get(TransactionService.name)
   184			this.authRegistryService = services.get(AuthRegistryService.name)
   185			this.taskService = services.get(TaskService.name)
   186			this.operationJournal = services.get(OperationJournalService.name)
   187			this.planner = new OperationPlanner(this.profileService, this.tokenService)
   188			this.resolver = new ContractResolver(this.logger)
   189			this.authwit = new AuthwitDiscoverer(this.logger)
   190			this.coordinator = new ExecutionCoordinator(this.taskService, this.logger)
   191			this.txBuilder = new TxRequestBuilder(
   192				this.pxeService,
   193				this.profileService,
   194				this.networkService,
   195				this.accountService,
   196				this.authRegistryService,
   197				this.taskService,
   198				this.resolver,
   199				this.authwit,
   200				this.logger,
   201			)
   202			const feeDeps: FeeStrategyDeps = {
   203				txBuilder: this.txBuilder,
   204				simulateTxTask: (pxe, req, opts, parentTask) => this.coordinator.simulateTxTask(pxe, req, opts, parentTask),
   205				fpcService: this.fpcService,
   206				tasks: this.taskService,
   207				logger: this.logger,
   208			}
   209			this.feeStrategies = new Map<FeeSettings["paymentMethod"]["kind"], FeeStrategy>([
   210				["fj", new FeeJuiceStrategy(feeDeps)],
   211				["fjwc", new FeeJuiceWithClaimStrategy(feeDeps)],
   212				["fpc", new FpcStrategy(feeDeps)],
   213				["embedded", new EmbeddedStrategy(feeDeps)],
   214			])
   215	
   216			// Invalidate gas balance cache when a transaction settles
   217			this.transactionService.onTransactionUpdated.add((tx) => {
   218				if (tx.status !== TxStatus.Pending) {
   219					for (const key of this.gasBalanceCache.keys()) {
   220						if (key.endsWith(`:${tx.account}`)) {
   221							this.gasBalanceCache.delete(key)
   222						}
   223					}
   224				}
   225			})
   226		}
   227	
   228		public async executeTransfer(
   229			networkId: string,
   230			accountAddress: string,
   231			tokenId: number,
   232			transferType: TransferType,
   233			recipientAddress: string,
   234			amount: bigint,
   235			feeSettings: FeeSettings,
   236		): Promise<string> {
   237			await this.ensureInitialized()
   238			amount = BigInt(amount)
   239			const origin: LocalTxOrigin = { type: OriginType.UI }
   240			const transferContent = new TransferContent(tokenId, transferType, accountAddress, recipientAddress, amount)
   241			const transferTask = this.taskService.startNewTask(transferContent, undefined, origin)
   242	
   243			// Durable record of this in-flight operation. Survives SW restart
   244			// and popup close/reopen so consumers can recover a consistent view
   245			// of "what is this tx doing right now" (M1.1). State transitions:
   246			//   planned → proving → submitting → submitted | failed
   247			let journalOp: OperationRecord | undefined
   248			try {
   249				journalOp = await this.operationJournal.createOperation({
   250					kind: "transfer",
   251					accountAddress,
   252					networkId,
   253					tokenId,
   254				})
   255			} catch (error) {
   256				this.logError("Failed to create journal operation", getErrorMessage(error))
   257			}
   258			const journalId = journalOp?.id
   259			const markJournal = async (state: Parameters<OperationJournalService["updateOperationState"]>[1]) => {
   260				if (!journalId) return

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/execution/service.ts | sed -n '880,1040p'" in (project root)
 succeeded in 0ms:
   880				for (const [call, i, j, types] of calls) {
   881					const values = (call.type === FunctionType.PUBLIC ? publicReturn[j] : privateReturn[j]).values ?? []
   882					result.encoded[i] = values
   883					try {
   884						result.decoded[i] = decodeFromAbi(types, values)
   885					} catch (error) {
   886						this.logError("Failed to decode simulation results", types, values, getErrorMessage(error))
   887					}
   888				}
   889			}
   890	
   891			for (const [promise, i, types] of utility) {
   892				const { result: values } = await promise
   893				try {
   894					result.decoded[i] = decodeFromAbi(types, values)
   895				} catch (error) {
   896					this.logError("Failed to encode utility simulation results", types, values, getErrorMessage(error))
   897				}
   898				result.encoded[i] = values
   899			}
   900	
   901			return result
   902		}
   903	
   904		public async getGasBalances(networkId: string, accountAddress: string, forceRefresh?: boolean): Promise<GasBalances> {
   905			await this.ensureInitialized()
   906	
   907			const cacheKey = `${networkId}:${accountAddress}`
   908			if (!forceRefresh) {
   909				const cached = this.gasBalanceCache.get(cacheKey)
   910				if (cached && Date.now() - cached.fetchedAt < ExecutionService.GAS_BALANCE_TTL_MS) {
   911					return cached.result
   912				}
   913			}
   914	
   915			// Single-flight: coalesce concurrent callers for the same key onto
   916			// one in-flight promise. Fresh popup opens fire several of these
   917			// simultaneously (FeeSettingsCard + GasBalanceCard), and each
   918			// independently triggered FpcService discovery before this guard
   919			// existed — see project_getgasbalances_timeout_regression memory.
   920			const inFlight = this.gasBalanceInFlight.get(cacheKey)
   921			if (inFlight) {
   922				this.logDebug(`getGasBalances: dedup — awaiting in-flight request for ${cacheKey}`)
   923				return inFlight
   924			}
   925			const pending = this.#computeGasBalances(cacheKey, networkId, accountAddress).finally(() => {
   926				this.gasBalanceInFlight.delete(cacheKey)
   927			})
   928			this.gasBalanceInFlight.set(cacheKey, pending)
   929			return pending
   930		}
   931	
   932		async #computeGasBalances(cacheKey: string, networkId: string, accountAddress: string): Promise<GasBalances> {
   933			const profile = await this.profileService.getActiveProfile()
   934			if (!profile) {
   935				throw new Error("Wallet locked")
   936			}
   937			const network = await this.networkService.getNetwork(networkId)
   938	
   939			// Public FeeJuice balance via balance_of_public on the FeeJuice contract
   940			this.logDebug(`getGasBalances: networkId=${networkId}, accountAddress=${accountAddress}`)
   941			let publicFeeJuice = "0"
   942			try {
   943				const publicResult = await this.executeSimulateViews({
   944					kind: "simulate_views",
   945					networkId,
   946					accountAddress,
   947					calls: [
   948						{
   949							kind: "call",
   950							contract: feeJuiceAddress,
   951							method: "balance_of_public",
   952							args: [accountAddress],
   953						},
   954					],
   955				})
   956				if (publicResult.encoded[0]?.[0]) {
   957					publicFeeJuice = publicResult.encoded[0][0].toBigInt().toString()
   958				}
   959			} catch (err) {
   960				this.logDebug(`getGasBalances: Failed to get public FeeJuice balance:`, getErrorMessage(err))
   961				this.logError("Failed to get public FeeJuice balance", getErrorMessage(err))
   962			}
   963			this.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}`)
   964	
   965			// Private FeeJuice balance via balance_of on PrivateFPC
   966			let privateFeeJuice: string | null = null
   967			try {
   968				const fpcs = await this.fpcService.getFpcs(network.chainId)
   969				const bridgedFpc = fpcs.find((f) => f.type === FpcType.PrivateFpc)
   970				if (bridgedFpc) {
   971					const privateResult = await this.executeSimulateViews({
   972						kind: "simulate_views",
   973						networkId,
   974						accountAddress,
   975						calls: [
   976							{
   977								kind: "call",
   978								contract: bridgedFpc.address,
   979								method: "balance_of",
   980								args: [accountAddress],
   981							},
   982						],
   983					})
   984					if (privateResult.encoded[0]?.[0]) {
   985						privateFeeJuice = privateResult.encoded[0][0].toBigInt().toString()
   986					}
   987				}
   988			} catch (err) {
   989				this.logDebug(`getGasBalances: Failed to get private FeeJuice balance:`, getErrorMessage(err))
   990				this.logError("Failed to get private FeeJuice balance", getErrorMessage(err))
   991			}
   992			this.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}, privateFeeJuice=${privateFeeJuice}`)
   993	
   994			const result = { publicFeeJuice, privateFeeJuice }
   995			this.gasBalanceCache.set(cacheKey, { result, fetchedAt: Date.now() })
   996			return result
   997		}
   998	
   999		// Aztec.js interface:
  1000	
  1001		private async executeAztecGetContractClassMetadata(
  1002			op: AztecGetContractClassMetadataOperation,
  1003		): Promise<{ isContractClassPubliclyRegistered: boolean; isArtifactRegistered: boolean }> {
  1004			const network = await this.networkService.getNetwork(op.networkId)
  1005			const artifact = await this.pxeService.getContractArtifact(network, op.id, { pxeOnly: true })
  1006			return {
  1007				isContractClassPubliclyRegistered: !!artifact,
  1008				isArtifactRegistered: !!artifact,
  1009			}
  1010		}
  1011	
  1012		private async executeAztecGetContractMetadata(op: AztecGetContractMetadataOperation): Promise<{
  1013			instance?: ContractInstanceWithAddress
  1014			initializationStatus: ContractInitializationStatus
  1015			isContractPublished: boolean
  1016			isContractUpdated: boolean
  1017			updatedContractClassId?: Fr
  1018		}> {
  1019			const network = await this.networkService.getNetwork(op.networkId)
  1020	
  1021			// Check PXE-local only: simulation requires both instance AND artifact
  1022			// registered in PXE. The full cascade (node/known/registry) finds on-chain
  1023			// data that PXE can't use for simulation.
  1024			const localInstance = await this.pxeService.getContractInstance(network, op.address, { pxeOnly: true })
  1025	
  1026			let hasArtifact = false
  1027			if (localInstance) {
  1028				try {
  1029					const artifact = await this.pxeService.getContractArtifact(network, localInstance.currentContractClassId, { pxeOnly: true })
  1030					hasArtifact = !!artifact
  1031				} catch {
  1032					hasArtifact = false
  1033				}
  1034			}
  1035	
  1036			const isLocallyRegistered = !!localInstance && hasArtifact
  1037	
  1038			// Use full cascade only for isContractPublished (on-chain existence)
  1039			let isPublished = isLocallyRegistered
  1040			if (!isPublished) {

exec
/bin/zsh -lc "nl -ba packages/extension/src/core/ports/window-port.ts | sed -n '1,220p'" in (project root)
 succeeded in 0ms:
     1	/**
     2	 * `chrome.windows` abstracted. Used today by `DappInteractionService` and
     3	 * `PasskeyService` to open approval / passkey popups.
     4	 *
     5	 * M3.5 extracts these callers behind a `WindowManager` service; the port
     6	 * underneath stays the same.
     7	 */
     8	
     9	import type { Unsubscribe } from "./types"
    10	
    11	export interface CreatedWindow {
    12		id?: number
    13	}
    14	
    15	export interface CreateWindowOptions {
    16		type?: "normal" | "popup" | "panel"
    17		url: string
    18		height?: number
    19		width?: number
    20		focused?: boolean
    21	}
    22	
    23	export interface WindowPort {
    24		/** Open a new browser window. `id` may be absent if creation failed. */
    25		create(options: CreateWindowOptions): Promise<CreatedWindow>
    26	
    27		/** Fires with `windowId` whenever any window closes. */
    28		onRemoved(listener: (windowId: number) => void): Unsubscribe
    29	
    30		/** Close a window by id. No-op / rejects if it is already closed. */
    31		remove(windowId: number): Promise<void>
    32	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/base/offscreen/client.ts | sed -n '1,240p'" in (project root)
 succeeded in 0ms:
     1	import { type ILogger, LogLevel } from "@/wallet/logger"
     2	import { getRandomHex } from "@/wallet/utils"
     3	import { ensureOffscreenRunning } from "@/wallet/utils/offscreen"
     4	import { jsonSanitize } from "@/wallet/utils/serialization"
     5	import { MessageType } from "../messages"
     6	import type { EventsMap, EventsSpec, MethodsMap } from "../."
     7	import type { EventMessage, RequestMessage, ResponseMessage } from "./messages"
     8	import { wrapParams } from "../utils"
     9	
    10	/** Timeout for offscreen requests (ms). PXE operations can take 60s+ (fetch timeout + proof gen). */
    11	const REQUEST_TIMEOUT_MS = 90_000
    12	
    13	export abstract class ServiceClient<TRequests extends MethodsMap, TEvents extends EventsMap = {}> {
    14		private readonly uid: string
    15		private readonly name: string
    16		private readonly service: string
    17		private readonly logger: ILogger
    18	
    19		private readonly requests: Map<number, [(result: unknown) => void, (error: string) => void]> = new Map()
    20		private readonly requestTimers: Map<number, NodeJS.Timeout> = new Map()
    21		private nextRequestId = 1
    22		private connected = false
    23	
    24		protected constructor(service: string, logger: ILogger, name?: string) {
    25			this.uid = getRandomHex(8)
    26			this.name = name ?? `${service}-client`
    27			this.service = service
    28			this.logger = logger
    29		}
    30	
    31		public connect() {
    32			if (this.connected) return
    33			chrome.runtime.onMessage.addListener(this.onMessageListener)
    34			this.connected = true
    35			this.logDebug("Connected")
    36		}
    37	
    38		public disconnect() {
    39			if (!this.connected) return
    40			this.connected = false
    41			chrome.runtime.onMessage.removeListener(this.onMessageListener)
    42			this.requestTimers.forEach((timer) => clearTimeout(timer))
    43			this.requestTimers.clear()
    44			if (this.requests.size) {
    45				this.requests.forEach(([_, reject]) => reject("Client disconnected"))
    46				this.requests.clear()
    47			}
    48			this.logDebug("Disconnected")
    49		}
    50	
    51		private readonly onMessageListener = (message: ResponseMessage<TRequests> | EventMessage<TEvents>): boolean => {
    52			if (message.to === this.uid || (message.type === MessageType.Event && message.from === this.service && message.to === undefined)) {
    53				this.onMessage(message) // fire and forget
    54			}
    55			return false
    56		}
    57	
    58		private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
    59			if (
    60				(message?.type !== MessageType.Response && message.type !== MessageType.Event) ||
    61				message.from !== this.service ||
    62				!message.content
    63			) {
    64				this.logWarn("Invalid message received", message)
    65				return
    66			}
    67			if (message.type === MessageType.Response) {
    68				const { requestId, result, error } = message.content
    69				const requestPromise = this.requests.get(requestId)
    70				if (!requestPromise) {
    71					this.logWarn("Invalid response received", message.content)
    72					return
    73				}
    74				const [resolve, reject] = requestPromise
    75				if (error !== undefined) {
    76					reject(error)
    77					this.logDebug("Request rejected", message.content)
    78				} else {
    79					resolve(result)
    80					this.logDebug("Request resolved", message.content)
    81				}
    82				this.requests.delete(requestId)
    83				const timer = this.requestTimers.get(requestId)
    84				if (timer) {
    85					clearTimeout(timer)
    86					this.requestTimers.delete(requestId)
    87				}
    88				this.logDebug("Pending requests", this.requests.size)
    89			} else {
    90				const { event, payload } = message.content
    91				this.logDebug("Event received", event, payload)
    92				;(this as EventsSpec<TEvents>)[event].invoke(payload)
    93			}
    94		}
    95	
    96		/**
    97		 * Non-overridable template: runs base transport-readiness
    98		 * (`ensureOffscreenRunning()`), then invokes the subclass
    99		 * `onReady()` hook. Called from every request before the message
   100		 * is sent so no subclass can forget to prepare the transport.
   101		 */
   102		private async ensureReady(): Promise<void> {
   103			await ensureOffscreenRunning()
   104			await this.onReady()
   105		}
   106	
   107		/**
   108		 * Overridable hook: runs AFTER base transport-readiness for any
   109		 * subclass-specific post-transport setup. Default is no-op. Do NOT
   110		 * call `ensureOffscreenRunning()` from an override — the base has
   111		 * already done it by the time this is invoked.
   112		 */
   113		protected async onReady(): Promise<void> {
   114			// no-op by default
   115		}
   116	
   117		protected async request<T extends keyof TRequests>(method: T, ...params: Parameters<TRequests[T]>): Promise<ReturnType<TRequests[T]>> {
   118			if (!this.connected) {
   119				this.connect()
   120			}
   121			await this.ensureReady()
   122			const request: RequestMessage<TRequests> = {
   123				type: MessageType.Request,
   124				content: {
   125					requestId: this.getRequestId(),
   126					method: method,
   127					params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
   128				},
   129				from: this.uid,
   130				to: this.service,
   131			}
   132			const requestId = request.content.requestId
   133			const promise = new Promise<ReturnType<TRequests[T]>>((resolve, reject) => {
   134				this.requests.set(requestId, [resolve as (result: unknown) => void, reject])
   135				const timer = setTimeout(() => {
   136					if (this.requests.delete(requestId)) {
   137						this.requestTimers.delete(requestId)
   138						const methodName = String(method)
   139						this.logError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${methodName}`)
   140						reject(`Offscreen request timed out: ${methodName}`)
   141					}
   142				}, REQUEST_TIMEOUT_MS)
   143				this.requestTimers.set(requestId, timer)
   144			})
   145			await chrome.runtime.sendMessage(request)
   146			this.logDebug("Request sent", request)
   147			this.logDebug("Pending requests", this.requests.size)
   148			return promise
   149		}
   150	
   151		private getRequestId() {
   152			return this.nextRequestId++
   153		}
   154	
   155		protected logDebug(...data: unknown[]) {
   156			this.logger.log(this.name, LogLevel.Debug, ...data)
   157		}
   158	
   159		protected logInfo(...data: unknown[]) {
   160			this.logger.log(this.name, LogLevel.Info, ...data)
   161		}
   162	
   163		protected logWarn(...data: unknown[]) {
   164			this.logger.log(this.name, LogLevel.Warn, ...data)
   165		}
   166	
   167		protected logError(...data: unknown[]) {
   168			this.logger.log(this.name, LogLevel.Error, ...data)
   169		}
   170	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/utils/rw-guard.ts | sed -n '1,260p'" in (project root)
 succeeded in 0ms:
     1	import { type ILogger, LogLevel } from "@/wallet/logger"
     2	
     3	/** Force-release timeout for stuck readers (ms). Mirrors `Lock.MAX_HOLD_MS`.
     4	 *  Converts a deadlock into a loud log + forced drain so the wallet
     5	 *  recovers on its own instead of hanging forever. */
     6	const MAX_READER_DRAIN_MS = 5 * 60_000
     7	
     8	interface Deferred<T> {
     9		promise: Promise<T>
    10		resolve: (value: T) => void
    11	}
    12	
    13	function deferred<T = void>(): Deferred<T> {
    14		let resolve!: (value: T) => void
    15		const promise = new Promise<T>((res) => {
    16			resolve = res
    17		})
    18		return { promise, resolve }
    19	}
    20	
    21	/**
    22	 * Read/write concurrency guard.
    23	 *
    24	 * - `read(fn)`: counts as a reader. Runs immediately if no writer is
    25	 *   active or queued; otherwise waits for the writer to finish. Multiple
    26	 *   concurrent reads proceed in parallel.
    27	 * - `write(fn)`: waits for all active readers to drain, then runs
    28	 *   exclusively. Other readers and writers queue behind it.
    29	 * - `enterWrite()`/`leaveWrite()`: manual write-hold for destructive ops
    30	 *   that span multiple awaits (profile switch/delete).
    31	 *
    32	 * Writers have FIFO priority: a reader arriving while a writer is queued
    33	 * waits behind that writer. This prevents writer starvation under heavy
    34	 * read load.
    35	 *
    36	 * Force-release: if readers don't drain within `MAX_READER_DRAIN_MS`,
    37	 * the guard logs an error and force-unsticks queued writers. This is a
    38	 * debuggability aid — it should never fire in practice.
    39	 *
    40	 * Reentry: calling `write()` from within a `read()` callback will
    41	 * deadlock (the write waits for the read to finish; the read can't
    42	 * finish until the write returns). The force-release unsticks this
    43	 * after 5 minutes. MV3 lacks `AsyncLocalStorage`, so we don't detect
    44	 * reentry statically — the sync-detector approach produces false
    45	 * positives under legitimate concurrent reads vs. writes. Callers must
    46	 * not nest.
    47	 */
    48	export class ReadWriteGuard {
    49		private readers = 0
    50		private writeActive = false
    51		private readonly writeWaiters: Deferred<void>[] = []
    52		private readonly readWaiters: Deferred<void>[] = []
    53		private forceReleaseTimer?: ReturnType<typeof setTimeout>
    54	
    55		constructor(
    56			private readonly name?: string,
    57			private readonly logger?: ILogger,
    58		) {}
    59	
    60		async read<T>(fn: () => Promise<T>): Promise<T> {
    61			if (this.writeActive || this.writeWaiters.length > 0) {
    62				const d = deferred()
    63				this.readWaiters.push(d)
    64				await d.promise
    65			}
    66	
    67			if (this.readers === 0) this.startForceReleaseTimer()
    68			this.readers++
    69	
    70			try {
    71				return await fn()
    72			} finally {
    73				this.readers--
    74				if (this.readers === 0) {
    75					this.stopForceReleaseTimer()
    76					this.drainWriteIfReady()
    77				}
    78			}
    79		}
    80	
    81		async write<T>(fn: () => Promise<T>): Promise<T> {
    82			await this.acquireWrite()
    83			try {
    84				return await fn()
    85			} finally {
    86				this.releaseWrite()
    87			}
    88		}
    89	
    90		async enterWrite(): Promise<void> {
    91			await this.acquireWrite()
    92		}
    93	
    94		leaveWrite(): void {
    95			this.releaseWrite()
    96		}
    97	
    98		private async acquireWrite(): Promise<void> {
    99			if (this.writeActive || this.writeWaiters.length > 0 || this.readers > 0) {
   100				const d = deferred()
   101				this.writeWaiters.push(d)
   102				await d.promise
   103				// Baton-pass from releaseWrite / drainWriteIfReady: writeActive
   104				// is already set to true by the handoff. Nothing more to do.
   105				return
   106			}
   107			this.writeActive = true
   108		}
   109	
   110		private releaseWrite(): void {
   111			if (this.writeWaiters.length > 0) {
   112				// Hand the write slot to the next waiter directly. Keeping
   113				// writeActive=true through the handoff prevents a racing writer
   114				// from jumping the queue.
   115				this.writeWaiters.shift()!.resolve()
   116				return
   117			}
   118			this.writeActive = false
   119			if (this.readWaiters.length > 0) {
   120				const waiters = this.readWaiters.splice(0)
   121				for (const d of waiters) d.resolve()
   122			}
   123		}
   124	
   125		private drainWriteIfReady(): void {
   126			if (!this.writeActive && this.readers === 0 && this.writeWaiters.length > 0) {
   127				this.writeActive = true
   128				this.writeWaiters.shift()!.resolve()
   129			}
   130		}
   131	
   132		private startForceReleaseTimer(): void {
   133			this.forceReleaseTimer = setTimeout(() => {
   134				if (this.readers > 0) {
   135					if (this.logger && this.name) {
   136						this.logger.log(
   137							this.name,
   138							LogLevel.Error,
   139							`ReadWriteGuard: force-released ${this.readers} stuck reader(s) after ${MAX_READER_DRAIN_MS}ms`,
   140						)
   141					}
   142					this.readers = 0
   143					this.drainWriteIfReady()
   144				}
   145				this.forceReleaseTimer = undefined
   146			}, MAX_READER_DRAIN_MS)
   147		}
   148	
   149		private stopForceReleaseTimer(): void {
   150			if (this.forceReleaseTimer) {
   151				clearTimeout(this.forceReleaseTimer)
   152				this.forceReleaseTimer = undefined
   153			}
   154		}
   155	}

codex
I’ve got the live service implementations now. Next I’m checking the exact runtime shapes the plan wants to abstract over, because this tree already has at least one declared-type-vs-runtime mismatch history and M2.4 is exposed to the same failure mode.
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/execution/spec.ts | sed -n '1,260p'" in (project root)
 succeeded in 0ms:
     1	import type { TransferType, LocalTxOrigin } from "@/wallet/services/transaction/spec"
     2	import type { FeeSettings, GasBalances, TransferFeeEstimate, Operation, OperationResult } from "./models"
     3	
     4	export const EXECUTION_SERVICE_NAME = "execution"
     5	
     6	export * from "./models"
     7	
     8	export type Methods = {
     9		/**
    10		 * Executes batch request and returns transaction hash.
    11		 * @param network Network id.
    12		 * @param account Sender account address.
    13		 * @param token Token id.
    14		 * @param transferType Transfer type.
    15		 * @param recipient Recipient address.
    16		 * @param amount Amount.
    17		 */
    18		executeTransfer(
    19			networkId: string,
    20			accountAddress: string,
    21			tokenId: number,
    22			transferType: TransferType,
    23			recipientAddress: string,
    24			amount: bigint,
    25			feeSettings: FeeSettings,
    26		): string
    27		/**
    28		 * Executes batch of operations.
    29		 * @param operations Operations to execute.
    30		 * @param origin Origin.
    31		 */
    32		executeOperations(operations: Operation[], origin: LocalTxOrigin): OperationResult[]
    33	
    34		/**
    35		 * Returns public FeeJuice balance and private FeeJuice balance (via PrivateFPC).
    36		 * Cached for 5 minutes in the service worker; pass forceRefresh to bypass.
    37		 * @param networkId Network id.
    38		 * @param accountAddress Account address.
    39		 * @param forceRefresh Bypass cache and fetch fresh values.
    40		 */
    41		getGasBalances(networkId: string, accountAddress: string, forceRefresh?: boolean): GasBalances
    42	
    43		/**
    44		 * Estimates the fee for a transfer without executing it.
    45		 * Runs simulation in the background and returns fee breakdown.
    46		 */
    47		estimateTransferFee(
    48			networkId: string,
    49			accountAddress: string,
    50			tokenId: number,
    51			transferType: TransferType,
    52			recipientAddress: string,
    53			amount: bigint,
    54			feeSettings: FeeSettings,
    55		): TransferFeeEstimate
    56	
    57		/**
    58		 * Estimates the fee for a pre-built operation (send_transaction or aztec_sendTx).
    59		 */
    60		estimateOperationFee(operation: Operation, feeSettings: FeeSettings): TransferFeeEstimate
    61	}

exec
/bin/zsh -lc "rg -n \"executeSimulateViews|SimulateViews|encoded:|decoded:|type Simulate|interface Simulate|Promise<.*encoded|createAztecNodeClient\\(|PasskeyCredentialData|class PasskeyCredential|windowId|chrome\\.windows\\.onRemoved|WindowPort|CreatedWindow\" packages/extension/src/wallet/services/execution packages/extension/src/wallet/services/passkey packages/extension/src/core packages/extension/src/wallet/services/wallet-sdk packages/extension/src/wallet/services/network packages/extension/src/wallet/services/pxe" in (project root)
 succeeded in 0ms:
packages/extension/src/core/ports/index.ts:23:export type { WindowPort, CreatedWindow, CreateWindowOptions } from "./window-port"
packages/extension/src/wallet/services/wallet-sdk/dispatcher.ts:702:	 * The ExecutionService's SimulateViewsOperation expects `(CallAction | EncodedCallAction)[]`.
packages/extension/src/wallet/services/network/service.ts:89:				this.nodes.set(network.chainId, createAztecNodeClient(network.rpcUrl, {}, makeFetchWithTimeout()))
packages/extension/src/wallet/services/network/service.ts:210:			this.nodes.set(network.chainId, createAztecNodeClient(network.rpcUrl, {}, makeFetchWithTimeout()))
packages/extension/src/wallet/services/network/service.ts:252:				node = createAztecNodeClient(network.rpcUrl, {}, makeFetchWithTimeout())
packages/extension/src/wallet/services/network/service.ts:280:			const rpc = createAztecNodeClient(rpcUrl, {}, makeFetchWithTimeout())
packages/extension/src/wallet/services/execution/service.ts:71:	type SimulateTransactionOperation,
packages/extension/src/wallet/services/execution/service.ts:72:	type SimulateUtilityOperation,
packages/extension/src/wallet/services/execution/service.ts:73:	type SimulateViewsOperation,
packages/extension/src/wallet/services/execution/service.ts:454:						result = await this.executeSimulateViews(operation)
packages/extension/src/wallet/services/execution/service.ts:687:	public async executeSimulateViews(op: SimulateViewsOperation): Promise<{ encoded: Fr[][]; decoded: AbiDecoded[] }> {
packages/extension/src/wallet/services/execution/service.ts:714:			encoded: Fr[][]
packages/extension/src/wallet/services/execution/service.ts:715:			decoded: AbiDecoded[]
packages/extension/src/wallet/services/execution/service.ts:717:			encoded: [],
packages/extension/src/wallet/services/execution/service.ts:718:			decoded: [],
packages/extension/src/wallet/services/execution/service.ts:943:			const publicResult = await this.executeSimulateViews({
packages/extension/src/wallet/services/execution/service.ts:971:				const privateResult = await this.executeSimulateViews({
packages/extension/src/wallet/services/passkey/service.ts:4:import { PASSKEY_SERVICE_NAME, type Methods, type PasskeyCredentialData, type PasskeyRequest, type PasskeyRequestPromise } from "./spec"
packages/extension/src/wallet/services/passkey/service.ts:12: * user interacts nor `chrome.windows.onRemoved` fires (eg. extension reload,
packages/extension/src/wallet/services/passkey/service.ts:40:	public async resolvePasskeyRequest(requestId: string, result: PasskeyCredentialData): Promise<void> {
packages/extension/src/wallet/services/passkey/service.ts:92:				const windowId = createdWindow.id
packages/extension/src/wallet/services/passkey/service.ts:95:					if (closedWindowId === windowId) {
packages/extension/src/wallet/services/passkey/service.ts:96:						chrome.windows.onRemoved.removeListener(onRemoved)
packages/extension/src/wallet/services/passkey/service.ts:102:				chrome.windows.onRemoved.addListener(onRemoved)
packages/extension/src/core/ports/browser-api.ts:11:import type { WindowPort } from "./window-port"
packages/extension/src/core/ports/browser-api.ts:16:	windows: WindowPort
packages/extension/src/wallet/services/pxe/chain-runtime.ts:53:		const node = createAztecNodeClient(network.rpcUrl, {}, makeFetchWithTimeout())
packages/extension/src/wallet/services/passkey/client.ts:4:import { PASSKEY_SERVICE_NAME, type Methods, type PasskeyRequest, type PasskeyCredentialData } from "./spec"
packages/extension/src/wallet/services/passkey/client.ts:17:	public resolvePasskeyRequest(requestId: string, result: PasskeyCredentialData): Promise<void> {
packages/extension/src/core/adapters/chrome-browser-api.ts:23:	CreatedWindow,
packages/extension/src/core/adapters/chrome-browser-api.ts:33:	WindowPort,
packages/extension/src/core/adapters/chrome-browser-api.ts:161:class ChromeWindowsAdapter implements WindowPort {
packages/extension/src/core/adapters/chrome-browser-api.ts:162:	public async create(options: CreateWindowOptions): Promise<CreatedWindow> {
packages/extension/src/core/adapters/chrome-browser-api.ts:167:	public onRemoved(listener: (windowId: number) => void): Unsubscribe {
packages/extension/src/core/adapters/chrome-browser-api.ts:168:		// @types/chrome for chrome.windows.onRemoved.addListener signature
packages/extension/src/core/adapters/chrome-browser-api.ts:170:		const onRemoved = chrome.windows.onRemoved as unknown as {
packages/extension/src/core/adapters/chrome-browser-api.ts:171:			addListener(cb: (windowId: number) => void): void
packages/extension/src/core/adapters/chrome-browser-api.ts:172:			removeListener(cb: (windowId: number) => void): void
packages/extension/src/core/adapters/chrome-browser-api.ts:178:	public async remove(windowId: number): Promise<void> {
packages/extension/src/core/adapters/chrome-browser-api.ts:179:		await chrome.windows.remove(windowId)
packages/extension/src/core/adapters/chrome-browser-api.ts:202:	public readonly windows: WindowPort = new ChromeWindowsAdapter()
packages/extension/src/core/ports/window-port.ts:11:export interface CreatedWindow {
packages/extension/src/core/ports/window-port.ts:23:export interface WindowPort {
packages/extension/src/core/ports/window-port.ts:25:	create(options: CreateWindowOptions): Promise<CreatedWindow>
packages/extension/src/core/ports/window-port.ts:27:	/** Fires with `windowId` whenever any window closes. */
packages/extension/src/core/ports/window-port.ts:28:	onRemoved(listener: (windowId: number) => void): Unsubscribe
packages/extension/src/core/ports/window-port.ts:31:	remove(windowId: number): Promise<void>
packages/extension/src/wallet/services/wallet-sdk/scope-enforcement.ts:153:function checkSimulateViews(args: unknown[], grants: GrantedCapabilityRecord[]): void {
packages/extension/src/wallet/services/wallet-sdk/scope-enforcement.ts:299:	simulateViews: checkSimulateViews,
packages/extension/src/wallet/services/passkey/spec.ts:7:export type PasskeyCredentialData = {
packages/extension/src/wallet/services/passkey/spec.ts:43:	resolvePasskeyRequest(requestId: string, result: PasskeyCredentialData): void
packages/extension/src/wallet/services/passkey/credential.ts:2:import type { PasskeyCredentialData } from "./spec"
packages/extension/src/wallet/services/passkey/credential.ts:11:export class PasskeyCredential {
packages/extension/src/wallet/services/passkey/credential.ts:24:	public static async create(params: PasskeyCredentialData): Promise<PasskeyCredential> {
packages/extension/src/wallet/services/execution/models/operation.ts:22:	| SimulateViewsOperation
packages/extension/src/wallet/services/execution/models/operation.ts:88:export type SimulateTransactionOperation = {
packages/extension/src/wallet/services/execution/models/operation.ts:97:export type SimulateUtilityOperation = {
packages/extension/src/wallet/services/execution/models/operation.ts:106:export type SimulateViewsOperation = {
packages/extension/src/wallet/services/execution/fee/fee-strategy.ts:69:export type SimulateTxFn = (
packages/extension/src/core/testing/fake-browser-api.ts:22:	CreatedWindow,
packages/extension/src/core/testing/fake-browser-api.ts:33:	WindowPort,
packages/extension/src/core/testing/fake-browser-api.ts:216:class FakeWindowsAdapter implements WindowPort {
packages/extension/src/core/testing/fake-browser-api.ts:221:	public async create(_options: CreateWindowOptions): Promise<CreatedWindow> {
packages/extension/src/core/testing/fake-browser-api.ts:227:	public onRemoved(listener: (windowId: number) => void): Unsubscribe {
packages/extension/src/core/testing/fake-browser-api.ts:235:	public async remove(windowId: number): Promise<void> {
packages/extension/src/core/testing/fake-browser-api.ts:236:		if (this.live.delete(windowId)) {
packages/extension/src/core/testing/fake-browser-api.ts:237:			for (const l of this.removedListeners) l(windowId)
packages/extension/src/core/testing/fake-browser-api.ts:241:	/** Test-only: fire onRemoved for `windowId` as if the user closed it. */
packages/extension/src/core/testing/fake-browser-api.ts:242:	public closeByUser(windowId: number): void {
packages/extension/src/core/testing/fake-browser-api.ts:243:		if (this.live.delete(windowId)) {
packages/extension/src/core/testing/fake-browser-api.ts:244:			for (const l of this.removedListeners) l(windowId)
packages/extension/src/core/testing/fake-browser-api.ts:278:	public readonly windows: WindowPort = new FakeWindowsAdapter()

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/wallet-sdk/background.ts | sed -n '110,180p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/passkey/credential.ts | sed -n '1,240p'" in (project root)
 succeeded in 0ms:
     1	import { Fr } from "@aztec/foundation/curves/bn254"
     2	import type { PasskeyCredentialData } from "./spec"
     3	
     4	const te = new TextEncoder()
     5	
     6	// SECURITY: Domain separators in the key derivation chain. Changing these labels
     7	// produces different keys and invalidates every existing passkey wallet.
     8	const PASSKEY_KDF_LABEL = te.encode("nulo:kdf:v1")
     9	const PASSKEY_MASTER_LABEL = te.encode("nulo:master:v1")
    10	
    11	export class PasskeyCredential {
    12		public readonly id: string
    13		public readonly userHandle?: string
    14		private baseKey: CryptoKey
    15		private salt: ArrayBuffer
    16	
    17		private constructor(id: string, baseKey: CryptoKey, salt: ArrayBuffer, userHandle?: string) {
    18			this.id = id
    19			this.userHandle = userHandle
    20			this.baseKey = baseKey
    21			this.salt = salt
    22		}
    23	
    24		public static async create(params: PasskeyCredentialData): Promise<PasskeyCredential> {
    25			const ikm = Buffer.from(params.prf, "base64")
    26			const credential = Buffer.from(params.id, "base64")
    27			const saltInput = Buffer.concat([PASSKEY_KDF_LABEL, credential])
    28			const baseKey = await self.crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
    29			const salt = await self.crypto.subtle.digest("SHA-256", saltInput)
    30			return new PasskeyCredential(params.id, baseKey, salt, params.userHandle)
    31		}
    32	
    33		public async deriveMasterSecret(): Promise<Buffer<ArrayBuffer>> {
    34			const masterBits = await self.crypto.subtle.deriveBits(
    35				{ name: "HKDF", hash: "SHA-256", salt: this.salt, info: PASSKEY_MASTER_LABEL },
    36				this.baseKey,
    37				256,
    38			)
    39			const masterFr = Fr.fromBufferReduce(Buffer.from(new Uint8Array(masterBits)))
    40			return masterFr.toBuffer() as Buffer<ArrayBuffer>
    41		}
    42	}

 succeeded in 0ms:
   110					handleDiscovery(
   111						discovery,
   112						handler,
   113						profileService,
   114						dappInteractionService,
   115						dappSessionService,
   116						pendingVerification,
   117						pendingDiscoveryPromises,
   118						discoveryQueue,
   119						logger,
   120					)
   121				},
   122	
   123				onSessionEstablished: async (session) => {
   124					const dappSession = await dappSessionService.tryGetDappSessionByOrigin(session.origin)
   125					if (dappSession) {
   126						await dappSessionService.setVerificationHash(dappSession.id, session.verificationHash)
   127					}
   128	
   129					const isNewConnection = pendingVerification.has(session.origin)
   130					if (isNewConnection) pendingVerification.delete(session.origin)
   131	
   132					const needsVerification = isNewConnection || (dappSession && !dappSession.trustedVerification)
   133	
   134					if (needsVerification && dappSession) {
   135						chrome.windows.create({
   136							type: "popup",
   137							url: chrome.runtime.getURL(
   138								`src/popup/index.html#/windows/verify?sessionId=${dappSession.id}&isReconnect=${!isNewConnection}`,
   139							),
   140							height: 800,
   141							width: 400,
   142						})
   143					}
   144				},
   145	
   146				onSessionTerminated: (sessionId) => {
   147					sessionQueues.delete(sessionId)
   148					decryptQueues.delete(sessionId)
   149				},
   150	
   151				onWalletMessage: (session, message) => {
   152					const key = session.sessionId
   153					const prev = sessionQueues.get(key) ?? Promise.resolve()
   154					const next = prev.then(() => handleWalletMessage(session, message, handler, dispatcher, profileService, logger))
   155					sessionQueues.set(
   156						key,
   157						next.catch(() => {}),
   158					)
   159				},
   160			},
   161		)
   162	
   163		discoveryQueue = new DiscoveryQueue(handler, logger)
   164	
   165		/**
   166		 * Serialize decryption per-session to prevent message reordering.
   167		 * The wallet-sdk uses `void this.handleEncryptedMessage(...)` (fire-and-forget),
   168		 * so two messages can have their decryptions race.
   169		 * TODO: Remove this monkey-patch if wallet-sdk adds a proper serialization API.
   170		 */
   171		// biome-ignore lint/suspicious/noExplicitAny: monkey-patching private method on BackgroundConnectionHandler to serialize decryption
   172		const origDecrypt = (handler as any).handleEncryptedMessage.bind(handler)
   173		const decryptQueues = new Map<string, Promise<void>>()
   174		// biome-ignore lint/suspicious/noExplicitAny: monkey-patching private method on BackgroundConnectionHandler to serialize decryption
   175		;(handler as any).handleEncryptedMessage = async (sessionId: string, encrypted: unknown) => {
   176			const prev = decryptQueues.get(sessionId) ?? Promise.resolve()
   177			const next = prev.then(() => origDecrypt(sessionId, encrypted))
   178			decryptQueues.set(
   179				sessionId,
   180				next.catch(() => {}),

exec
/bin/zsh -lc "nl -ba packages/extension/src/core/testing/fake-browser-api.ts | sed -n '210,255p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/core/adapters/chrome-browser-api.ts | sed -n '150,190p'" in (project root)
 succeeded in 0ms:
   210		}
   211	}
   212	
   213	// ── Windows ───────────────────────────────────────────────────────────
   214	// fake-browser doesn't ship a chrome.windows fake. Minimal in-memory impl.
   215	
   216	class FakeWindowsAdapter implements WindowPort {
   217		private nextId = 1000
   218		private readonly live = new Set<number>()
   219		private readonly removedListeners: Array<(id: number) => void> = []
   220	
   221		public async create(_options: CreateWindowOptions): Promise<CreatedWindow> {
   222			const id = this.nextId++
   223			this.live.add(id)
   224			return { id }
   225		}
   226	
   227		public onRemoved(listener: (windowId: number) => void): Unsubscribe {
   228			this.removedListeners.push(listener)
   229			return () => {
   230				const i = this.removedListeners.indexOf(listener)
   231				if (i >= 0) this.removedListeners.splice(i, 1)
   232			}
   233		}
   234	
   235		public async remove(windowId: number): Promise<void> {
   236			if (this.live.delete(windowId)) {
   237				for (const l of this.removedListeners) l(windowId)
   238			}
   239		}
   240	
   241		/** Test-only: fire onRemoved for `windowId` as if the user closed it. */
   242		public closeByUser(windowId: number): void {
   243			if (this.live.delete(windowId)) {
   244				for (const l of this.removedListeners) l(windowId)
   245			}
   246		}
   247	
   248		public reset(): void {
   249			this.live.clear()
   250			this.removedListeners.length = 0
   251		}
   252	}
   253	
   254	// ── Alarms ────────────────────────────────────────────────────────────
   255	

 succeeded in 0ms:
   150			// chrome.runtime.getContexts is MV3 / Chrome 116+; we rely on it for
   151			// offscreen supervision. The runtime.d.ts type is looser than ours.
   152			type GetContextsFn = (f: unknown) => Promise<Array<{ contextId: string; contextType: string; documentUrl?: string }>>
   153			const runtime = chrome.runtime as unknown as { getContexts?: GetContextsFn }
   154			if (!runtime.getContexts) {
   155				throw new Error("chrome.runtime.getContexts is unavailable; Chrome 116+ required")
   156			}
   157			return await runtime.getContexts(filter)
   158		}
   159	}
   160	
   161	class ChromeWindowsAdapter implements WindowPort {
   162		public async create(options: CreateWindowOptions): Promise<CreatedWindow> {
   163			const created = await chrome.windows.create(options)
   164			return { id: created?.id }
   165		}
   166	
   167		public onRemoved(listener: (windowId: number) => void): Unsubscribe {
   168			// @types/chrome for chrome.windows.onRemoved.addListener signature
   169			// varies across releases; the runtime API is (callback[, filter]).
   170			const onRemoved = chrome.windows.onRemoved as unknown as {
   171				addListener(cb: (windowId: number) => void): void
   172				removeListener(cb: (windowId: number) => void): void
   173			}
   174			onRemoved.addListener(listener)
   175			return () => onRemoved.removeListener(listener)
   176		}
   177	
   178		public async remove(windowId: number): Promise<void> {
   179			await chrome.windows.remove(windowId)
   180		}
   181	}
   182	
   183	class ChromeAlarmsAdapter implements AlarmsPort {
   184		public async create(name: string, options: AlarmCreateOptions): Promise<void> {
   185			await chrome.alarms.create(name, options)
   186		}
   187	
   188		public async clear(name: string): Promise<boolean> {
   189			return await chrome.alarms.clear(name)
   190		}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/task/service.ts | sed -n '1,220p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/token-balance/spec.ts | sed -n '1,220p'" in (project root)
 succeeded in 0ms:
     1	import type { TokenInfo } from "@/wallet/services/token/spec"
     2	
     3	export const TOKEN_BALANCE_SERVICE_NAME = "token-balance"
     4	
     5	export type TokenBalanceRaw = {
     6		id: number
     7		token: number
     8		account: string
     9		publicBalance?: string
    10		privateBalance?: string
    11		updatedAt: number
    12	}
    13	
    14	export type TokenBalanceInfo = {
    15		id: number
    16		token: TokenInfo
    17		account: string
    18		publicBalance?: string
    19		privateBalance?: string
    20		updatedAt: number
    21	}
    22	
    23	export type Methods = {
    24		/**
    25		 * Returns a token balance with the specified id.
    26		 * @param id Token balance id.
    27		 */
    28		getTokenBalance(id: number): TokenBalanceInfo
    29	
    30		/**
    31		 * Returns a list of token balances.
    32		 * @param tokenId Token id.
    33		 * @param accountAddress Account address.
    34		 */
    35		getTokenBalances(tokenId?: number, accountAddress?: string): TokenBalanceInfo[]
    36	
    37		/**
    38		 * Enqueues the token balance for immediate syncing.
    39		 * @param id Token balance id.
    40		 */
    41		refreshTokenBalance(id: number): void
    42	}
    43	
    44	export type Events = {
    45		onTokenBalanceAdded: TokenBalanceInfo
    46		onTokenBalanceUpdated: TokenBalanceInfo
    47		onTokenBalanceDeleted: TokenBalanceInfo
    48	}

 succeeded in 0ms:
     1	import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
     2	import { Service } from "@/wallet/base/background"
     3	import type { ILogger } from "@/wallet/logger"
     4	import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
     5	import type { TxOrigin } from "@/wallet/services/transaction/service"
     6	import { getRandomHex } from "@/wallet/utils"
     7	import { EventHandler } from "@/wallet/utils/event-handler"
     8	import {
     9		TASK_SERVICE_NAME,
    10		type Task,
    11		TaskStatus,
    12		type ITaskContent,
    13		EmptyResult,
    14		type ITaskResult,
    15		type Methods,
    16		type Events,
    17		TASK_RETENTION_PERIOD_MS,
    18	} from "./spec"
    19	import { WrappedTask } from "./wrapped-task"
    20	
    21	export * from "./spec"
    22	export * from "./wrapped-task"
    23	
    24	export class TaskService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
    25		public static name = TASK_SERVICE_NAME
    26	
    27		public readonly onTaskCreated = new EventHandler<Task>()
    28		public readonly onTaskUpdated = new EventHandler<Task>()
    29		public readonly onTaskDeleted = new EventHandler<Task>()
    30	
    31		private readonly tasks: Map<string, Task> = new Map()
    32		private profile?: string = undefined
    33	
    34		private profileService: ProfileService = null!
    35	
    36		public constructor(logger: ILogger) {
    37			super(TASK_SERVICE_NAME, logger)
    38		}
    39	
    40		protected async init(services: ServiceCollection) {
    41			this.profileService = services.get(ProfileService.name)
    42			this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
    43		}
    44	
    45		private createTask(content: ITaskContent, parentId?: string, origin?: TxOrigin, status: TaskStatus = TaskStatus.Pending): WrappedTask {
    46			let taskId: string
    47			do {
    48				taskId = getRandomHex(8)
    49			} while (this.tasks.has(taskId))
    50	
    51			const parent = parentId ? this.getTaskById(parentId) : undefined
    52			if (parent?.finishedAt) {
    53				throw new Error(`Cannot add task to finished parent ${parentId}`)
    54			}
    55	
    56			const newTask: Task = {
    57				id: taskId,
    58				content,
    59				status,
    60				createdAt: Date.now(),
    61				startedAt: undefined,
    62				subtasks: [],
    63				origin,
    64				parentId: parent?.id,
    65				finishedAt: undefined,
    66				result: undefined,
    67				error: undefined,
    68			}
    69	
    70			if (status !== TaskStatus.Pending) {
    71				newTask.startedAt = Date.now()
    72			}
    73	
    74			this.tasks.set(newTask.id, newTask)
    75			this.emit("onTaskCreated", newTask)
    76	
    77			if (parent) {
    78				parent.subtasks.push(newTask)
    79				this.emit("onTaskUpdated", parent)
    80			}
    81			return new WrappedTask(newTask.id, this, origin)
    82		}
    83	
    84		/**
    85		 * Creates a new pending task of any level.
    86		 * @param content - Task content
    87		 * @param parentId - Optional parent task ID
    88		 * @param origin - Optional origin of the task
    89		 * @returns Created task wrapper
    90		 */
    91		public createNewTask(content: ITaskContent, parentId?: string, origin?: TxOrigin): WrappedTask {
    92			return this.createTask(content, parentId, origin, TaskStatus.Pending)
    93		}
    94	
    95		/**
    96		 * Creates a new processing task of any level.
    97		 * @param content - Task content
    98		 * @param parentId - Optional parent task ID
    99		 * @param origin - Optional origin of the task
   100		 * @returns Created task wrapper
   101		 */
   102		public startNewTask(content: ITaskContent, parentId?: string, origin?: TxOrigin): WrappedTask {
   103			return this.createTask(content, parentId, origin, TaskStatus.Processing)
   104		}
   105	
   106		private validateTaskBeforeFinish(task: Task): void {
   107			if (task.finishedAt) {
   108				throw new Error(`Cannot finish already finished task ${task.id}`)
   109			}
   110			const unfinishedSubtasks = task.subtasks.filter((t) => !t.finishedAt)
   111			if (unfinishedSubtasks.length > 0) {
   112				const unfinishedIds = unfinishedSubtasks.map((t) => t.id).join(", ")
   113				throw new Error(`Cannot finish task ${task.id} with unfinished subtasks: ${unfinishedIds}`)
   114			}
   115		}
   116	
   117		private validateNotPending(task: Task): void {
   118			if (task.status === TaskStatus.Pending) {
   119				throw new Error(`Cannot finish pending task ${task.id} since it is not started`)
   120			}
   121		}
   122	
   123		/**
   124		 * Completes task with result.
   125		 * @param taskId - Task ID to complete
   126		 * @param result - Completion result (default: EmptyResult)
   127		 */
   128		public completeTask(taskId: string, result: ITaskResult = new EmptyResult()): void {
   129			const task = this.getTaskById(taskId)
   130			this.validateNotPending(task)
   131			this.validateTaskBeforeFinish(task)
   132	
   133			task.finishedAt = Date.now()
   134			task.result = result
   135			task.status = TaskStatus.Completed
   136			this.emit("onTaskUpdated", task)
   137		}
   138	
   139		/**
   140		 * Fails task with error.
   141		 * @param taskId - Task ID to fail
   142		 * @param error - Error message
   143		 */
   144		public failTask(taskId: string, error = "Unknown error"): void {
   145			const task = this.getTaskById(taskId)
   146			this.validateNotPending(task)
   147			this.validateTaskBeforeFinish(task)
   148	
   149			task.error = error
   150			task.finishedAt = Date.now()
   151			task.status = TaskStatus.Failed
   152			this.emit("onTaskUpdated", task)
   153		}
   154	
   155		/**
   156		 * Cancels task.
   157		 * @param taskId - Task ID to cancel
   158		 */
   159		public cancelTask(taskId: string): void {
   160			const task = this.getTaskById(taskId)
   161			this.validateTaskBeforeFinish(task)
   162	
   163			task.finishedAt = Date.now()
   164			task.status = TaskStatus.Cancelled
   165			this.emit("onTaskUpdated", task)
   166		}
   167	
   168		public startTask(taskId: string): void {
   169			const task = this.getTaskById(taskId)
   170			if (task.status !== TaskStatus.Pending) {
   171				throw new Error(`Cannot start task ${taskId} that is not pending`)
   172			}
   173			task.status = TaskStatus.Processing
   174			task.startedAt = Date.now()
   175			this.emit("onTaskUpdated", task)
   176		}
   177	
   178		private getTaskById(taskId: string): Task {
   179			const task = this.tasks.get(taskId)
   180			if (!task) {
   181				throw new Error(`Invalid task id: ${taskId}`)
   182			}
   183			return task
   184		}
   185	
   186		public async getTask(taskId: string): Promise<Task> {
   187			const task = this.getTaskById(taskId)
   188			this.cleanupStaleTasks()
   189			if (!this.tasks.has(taskId)) {
   190				throw new Error(`Task ${taskId} has been expired`)
   191			}
   192			return task
   193		}
   194	
   195		public getTaskSync(taskId: string): Task {
   196			const task = this.getTaskById(taskId)
   197			this.cleanupStaleTasks()
   198			if (!this.tasks.has(taskId)) {
   199				throw new Error(`Task ${taskId} has been expired`)
   200			}
   201			return task
   202		}
   203	
   204		public async getTasks(): Promise<Task[]> {
   205			this.cleanupStaleTasks()
   206			return this.getRootTasks()
   207		}
   208	
   209		public getTasksSync(): Task[] {
   210			this.cleanupStaleTasks()
   211			return this.getRootTasks()
   212		}
   213	
   214		private getRootTasks(): Task[] {
   215			return Array.from(this.tasks.values()).filter((t) => !t.parentId)
   216		}
   217	
   218		private cleanupStaleTasks(): void {
   219			const now = Date.now()
   220			const isStale = (task: Task) => task.finishedAt && now - task.finishedAt > TASK_RETENTION_PERIOD_MS

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/execution/service.ts | sed -n '680,760p'" in (project root)
 succeeded in 0ms:
   680				return decodeFromAbi(fn.returnTypes, result)
   681			} catch (error) {
   682				this.logError("Failed to decode simulation results", fn.returnTypes, result, getErrorMessage(error))
   683				return result as AbiDecoded
   684			}
   685		}
   686	
   687		public async executeSimulateViews(op: SimulateViewsOperation): Promise<{ encoded: Fr[][]; decoded: AbiDecoded[] }> {
   688			await this.ensureInitialized()
   689			const profile = await this.profileService.getActiveProfile()
   690			if (!profile) {
   691				throw new Error("Wallet locked")
   692			}
   693			const network = await this.networkService.getNetwork(op.networkId)
   694			const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
   695	
   696			const node = await this.networkService.getNode(network.chainId)
   697			const pxe = this.pxeService.getPXE(network)
   698			const contracts = this.resolver.extractContracts(op.calls)
   699			const instances = await this.resolver.resolveInstances(pxe, contracts)
   700			const artifacts = await this.resolver.resolveArtifacts(pxe, instances)
   701	
   702			const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
   703			for (const [contract, instance] of instances) {
   704				if (!registeredContracts.has(contract)) {
   705					this.logDebug("Register contract")
   706					await pxe.registerContract({
   707						instance,
   708						artifact: artifacts.get(instance.currentContractClassId.toString()),
   709					})
   710				}
   711			}
   712	
   713			const result: {
   714				encoded: Fr[][]
   715				decoded: AbiDecoded[]
   716			} = {
   717				encoded: [],
   718				decoded: [],
   719			}
   720	
   721			const calls: [FunctionCall, number, number, AbiType[]][] = []
   722			const utility: [Promise<UtilityExecutionResult>, number, AbiType[]][] = []
   723			let privateCalls = 0
   724			let publicCalls = 0
   725	
   726			await account.ensureRegistered(pxe)
   727	
   728			for (let i = 0; i < op.calls.length; i++) {
   729				const call = op.calls[i]
   730				switch (call.kind) {
   731					case "call": {
   732						const instance = instances.get(call.contract)
   733						if (!instance) {
   734							throw new Error("Contract not found")
   735						}
   736						const artifact = artifacts.get(instance.currentContractClassId.toString())
   737						if (!artifact) {
   738							throw new Error("Contract artifact not found")
   739						}
   740						const fn =
   741							artifact.functions.find((x) => x.name === call.method) ??
   742							artifact.nonDispatchPublicFunctions.find((x) => x.name === call.method)
   743						if (!fn) {
   744							throw new Error("Method not found")
   745						}
   746						const fnSelector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
   747						const encodedArgs = encodeArguments(fn, call.args)
   748						if (fn.functionType === FunctionType.UTILITY) {
   749							utility.push([
   750								pxe.executeUtility(
   751									new FunctionCall(
   752										fn.name,
   753										AztecAddress.fromString(call.contract),
   754										fnSelector,
   755										fn.functionType,
   756										false,
   757										fn.isStatic,
   758										encodedArgs,
   759										fn.returnTypes,
   760									),

codex
I’ve confirmed several of the “entry state” facts against the live tree, and some are already stale or wrong. I’m numbering the plan now so the final review can pin each issue to exact `plan.md` lines instead of hand-waving.
exec
/bin/zsh -lc "nl -ba implementations-plan/M2/4/plan.md | sed -n '1,430p'" in (project root)
 succeeded in 0ms:
     1	# M2.4 — Worker-heavy services (3 sub-PRs, ~2 weeks)
     2	
     3	## Context & entry state
     4	
     5	Three services that directly touch worker-unfriendly APIs (chrome.windows, chrome.alarms, inline factory constructors) — unblocking the "services constructable with fake ports" exit criterion for M3 package extraction.
     6	
     7	### Targets (from `architecture/plan/03-final-plan-v3.md:170-176`)
     8	
     9	| Sub-PR | Extract | Est. |
    10	|---|---|---|
    11	| M2.4-a | `TokenBalanceService` → `BalanceRepository` + `BalanceProjector` + `BalanceJobQueue` (uses `BackgroundTickerPort`) | 1w |
    12	| M2.4-b | `NetworkService` — `NodeFactory` port injection (not inline `createAztecNodeClient`) | 2d |
    13	| M2.4-c | `WindowManager` service — only thing calling `chrome.windows.create/remove`. `DappInteractionService` + `PasskeyService` route through it. Unblocks both for unit test. | 2-3d |
    14	
    15	### Entry state (verified via discovery — 2026-04-22)
    16	
    17	**TokenBalanceService** (`src/wallet/services/token-balance/service.ts`, 450 LOC):
    18	- Runs a continuous background worker (init at 73, loop at 233-257): `while (true) { if (queue.length) syncBatch; await sleep(1000) }`.
    19	- Queue: `Queue<number, TokenBalanceRaw>` (line 32) — per-id dedup + priority.
    20	- Pending-task map: `Map<number, string>` — bridges balance id ↔ TaskService task id.
    21	- Storage: `EntityStorage<TokenBalanceRaw>` at `"nulo:core:token-balances"` (line 31, StorageType.Local).
    22	- Triggers that enqueue: user `refreshTokenBalance`, `onAccountAdded`, `onTokenAdded`, `onTokenUpdated`, `onTransactionUpdated` (smart refresh).
    23	- **`onActiveProfileChanged`** (service.ts:148-156) ONLY swaps `this.profile` + reloads token metadata via `tokenService.getTokensRaw()`. It does **NOT** clear balances, clear the queue, or re-enqueue all balances. Persisted balances remain visible across profile switches (they're stored per-account, not filtered by profile). **M2.4-a preserves this behavior verbatim** — no deliberate semantic change on profile switch.
    24	- Sync impl (line 259): builds `CallAction[]`, calls `executionService.executeSimulateViews()`, updates private/public balance fields.
    25	- No `chrome.alarms` — just a `setInterval`-like `sleep(1000)` loop.
    26	
    27	**NetworkService** (`src/wallet/services/network/service.ts`, 350 LOC):
    28	- Four call sites of `createAztecNodeClient(rpcUrl, {}, makeFetchWithTimeout())`: 89, 210, 252, 280. All inline imports from `@aztec/stdlib/interfaces/client`.
    29	- Node cache `Map<number, AztecNode>` (line 25), keyed by chainId.
    30	- Cache cleared on profile switch (line 295).
    31	- `getChainId(rpcUrl)` at 280 creates a one-shot node to validate RPC URL + read nodeInfo before persisting.
    32	
    33	**Window-management call sites** (candidates for M2.4-c):
    34	- PasskeyService (`src/wallet/services/passkey/service.ts:76-104`): `chrome.windows.create({ type: "popup" })` + `chrome.windows.onRemoved.addListener`. 5-min timeout. Maps `windowId → requestId`.
    35	- DappInteractionService (`src/wallet/services/dapp-interaction/service.ts:194-220`): same pattern, 10-min timeout. Maps `windowId → interactionId`.
    36	- wallet-sdk background (`src/wallet/services/wallet-sdk/background.ts:135`): fire-and-forget verification popup, no onRemoved listener. **3rd consumer flagged by discovery.**
    37	- Chrome adapter impl (`src/core/adapters/chrome-browser-api.ts:162-180`): wraps `chrome.windows.*`. Already exposes `WindowPort`.
    38	
    39	**Existing ports** (from `src/core/ports/`):
    40	- `ClockPort` — exists, used widely.
    41	- `BrowserApi` (facade over StoragePort, RuntimePort, WindowPort, AlarmsPort) — exists.
    42	- `WindowPort` — exists at `src/core/ports/window-port.ts`. Interface: `create` / `remove` / `onRemoved`. **Not yet consumed by PasskeyService or DappInteractionService.**
    43	- `AlarmsPort` — exists but zero usage.
    44	- `BackgroundTickerPort` — **does NOT exist**. Nearest analog: `ClockPort.sleep` + `setInterval` pattern.
    45	- `NodeFactory` — **does NOT exist**. Port index explicitly lists it as a future addition.
    46	
    47	### Gap decisions (flagged by discovery)
    48	
    49	1. **BackgroundTickerPort naming**: the plan uses this name. Discovery confirmed no port exists. **Decision**: M2.4-a ships the `BackgroundTickerPort` interface + a real adapter that wraps `ClockPort.setInterval`. **Alternative considered and rejected**: reuse `ClockPort.setInterval` directly — rejected because we want a higher-level "periodic background work" semantic that can later switch to `chrome.alarms` without caller changes (`chrome.alarms` survives SW suspension; `setInterval` doesn't).
    50	2. **wallet-sdk verification popup** (3rd `chrome.windows.create` site): plan labels this out-of-scope but flags in risks. Follow-up PR after M2.4-c.
    51	3. **TokenBalanceService sleep-loop testability**: the `while (true) { await sleep(1000) }` pattern is hard to drive in unit tests even with MockClock. **Decision**: M2.4-a replaces the continuous loop with a `BalanceJobQueue` that runs on `BackgroundTickerPort.tick()` events. In tests, the fake ticker fires manually. In prod, tick is every 1 second.
    52	4. **ExecutionService.getGasBalances vs TokenBalance**: discovery flagged they share the same PXE-timeout concern. **Decision**: out of scope for M2.4. Both still call their respective ExecutionService methods; the ExecutionService-side caching is M2.2's problem (gas cache extracted in M2.2-f).
    53	
    54	## Architecture invariants (preserved across all 3 sub-PRs)
    55	
    56	1. **RPC surfaces frozen** — `TokenBalanceService`, `NetworkService`, `PasskeyService`, `DappInteractionService` all keep their `spec.ts` methods unchanged.
    57	2. **Storage keys frozen** — `nulo:core:token-balances`, network storage key, etc. all preserved.
    58	3. **Balance-sync semantics preserved** — same events fire, same batch size (12), same TTL. Just a different ticking mechanism.
    59	4. **Popup lifecycles preserved** — PasskeyService (5min) and DappInteractionService (10min) timeouts unchanged. `onRemoved` still fires on user close.
    60	5. **Profile-switch cache invalidation** unchanged — same triggers, same ordering.
    61	
    62	## Per-sub-PR specifications
    63	
    64	### M2.4-a — `TokenBalanceService` split (→ `BalanceRepository` + `BalanceProjector` + `BalanceJobQueue` + `BackgroundTickerPort`)
    65	
    66	**Purpose**: 
    67	1. Make TokenBalanceService unit-testable without driving a real loop + clock.
    68	2. Separate the 3 concerns — storage, balance projection (ExecutionService call + result normalization), work scheduling.
    69	
    70	**New files**:
    71	- `src/core/ports/background-ticker-port.ts` — port interface.
    72	- `src/core/adapters/clock-ticker-adapter.ts` — production adapter (wraps ClockPort).
    73	- `src/core/testing/fake-background-ticker.ts` — test double.
    74	- `src/wallet/services/token-balance/balance-repository.ts`
    75	- `src/wallet/services/token-balance/balance-projector.ts`
    76	- `src/wallet/services/token-balance/balance-job-queue.ts`
    77	
    78	**BackgroundTickerPort surface** (audit-corrected — serialized/coalescing contract, honest JSDoc):
    79	```ts
    80	export interface BackgroundTickerPort {
    81	  /** Register a periodic tick for ASYNC background work.
    82	   *
    83	   *  CONTRACT (what this port guarantees that raw setInterval does NOT):
    84	   *    - **Serialized**: at most ONE `onTick` invocation in flight at a time.
    85	   *      If a tick is still running when the next interval fires, the new
    86	   *      tick is COALESCED into a single pending slot (no backlog).
    87	   *    - **`cancel()` prevents future delivery** (already-running tick
    88	   *      completes; no further ticks).
    89	   *
    90	   *  WHAT THIS DOES NOT PROMISE:
    91	   *    - Persistence across SW suspension. The default adapter wraps
    92	   *      `ClockPort.setInterval` which pauses when the SW suspends.
    93	   *      A future chrome.alarms-backed adapter is NOT swap-in-compatible
    94	   *      at sub-30s cadences (chrome.alarms floor is 30s).
    95	   *    - Exact timing. Ticks may be delayed by arbitrary JS work.
    96	   *
    97	   *  If you don't need the serialized/coalescing contract, use
    98	   *  `ClockPort.setInterval` directly. */
    99	  subscribe(intervalMs: number, onTick: () => void | Promise<void>): TickerHandle
   100	}
   101	
   102	export interface TickerHandle {
   103	  cancel(): void
   104	}
   105	```
   106	
   107	**BalanceRepository surface** (storage ownership):
   108	```ts
   109	export class BalanceRepository {
   110	  public constructor(browserApi?: BrowserApi) {
   111	    // mirrors ProfileRepository / SessionManager pattern
   112	  }
   113	
   114	  /** Frozen root: nulo:core:token-balances. */
   115	  async get(id: number): Promise<TokenBalanceRaw | undefined>
   116	  async getAll(): Promise<TokenBalanceRaw[]>
   117	  async set(id: number, balance: TokenBalanceRaw): Promise<void>
   118	  async delete(id: number): Promise<void>
   119	  async generateUniqueId(): Promise<number>
   120	}
   121	```
   122	
   123	**BalanceProjector surface** (ExecutionService call + result merge):
   124	```ts
   125	export class BalanceProjector {
   126	  public constructor(private readonly execution: ExecutionServiceClient) {}
   127	
   128	  /** Batch-project balances for a single account. Builds CallAction[] for
   129	   *  private + public view calls, calls executeSimulateViews, maps
   130	   *  results back. Mirrors today's syncBatch (service.ts:259-419). */
   131	  async project(
   132	    account: AccountAddress,
   133	    balances: TokenBalanceRaw[],
   134	    network: Network,
   135	  ): Promise<ProjectedBalance[]>
   136	}
   137	```
   138	
   139	**BalanceJobQueue surface**:
   140	```ts
   141	export class BalanceJobQueue {
   142	  public constructor(
   143	    private readonly ticker: BackgroundTickerPort,
   144	    private readonly repo: BalanceRepository,
   145	    private readonly projector: BalanceProjector,
   146	    private readonly tasks: TaskServiceClient,
   147	    private readonly onBalanceUpdated: (b: TokenBalanceInfo) => void,
   148	    private readonly onBalanceFailed: (b: TokenBalanceInfo, err: Error) => void,
   149	  ) {}
   150	
   151	  start(): void    // subscribe to ticker
   152	  stop(): void     // cancel subscription
   153	
   154	  /** Enqueue a balance for refresh. Dedup via per-id pendingTasks map.
   155	   *  Mirrors service.ts:108. */
   156	  enqueue(balance: TokenBalanceRaw): void
   157	
   158	  /** Clear queue (e.g., on profile switch). */
   159	  clear(): void
   160	}
   161	```
   162	
   163	**What moves**:
   164	- Queue + pendingTasks (lines 32-33) → BalanceJobQueue.
   165	- `EntityStorage<TokenBalanceRaw>` (line 31) → BalanceRepository.
   166	- `syncBatch` (259-419) → BalanceProjector.
   167	- Loop (233-257) → replaced with `ticker.subscribe(1000, () => queue.tick())`.
   168	- Trigger handlers (`onTokenAdded`, `onAccountAdded`, etc., 148-231) → stay on TokenBalanceService, now call `queue.enqueue(balance)`.
   169	
   170	**What stays on TokenBalanceService (the facade)**:
   171	- The Service<Methods> RPC scaffolding.
   172	- Event subscriptions (onAccountAdded, onTokenAdded, onTransactionUpdated, onActiveProfileChanged).
   173	- Public API delegates to repo/queue.
   174	
   175	**Test strategy**:
   176	- Unit: `balance-repository.test.ts` with FakeBrowserApi.
   177	- Unit: `balance-projector.test.ts` with fake ExecutionServiceClient.
   178	- Unit: `balance-job-queue.test.ts` with fake ticker — drive ticks manually, verify dedup, batch size, onBalanceUpdated firing.
   179	- Integration: unchanged (TokenBalanceService still works end-to-end).
   180	
   181	**Rollback**: Drop-in (3 new files + rewire TokenBalanceService methods). The continuous loop can be re-introduced if tick-based scheduling causes surprises.
   182	
   183	**Semantic change (DELIBERATE)**: Today a batch runs every 1000ms if the queue is non-empty. Post-M2.4-a: same. The difference is HOW we schedule. No user-visible change in cadence.
   184	
   185	---
   186	
   187	### M2.4-b — `NodeFactory` port injection into `NetworkService`
   188	
   189	**Purpose**: Replace 4 inline `createAztecNodeClient(...)` calls with a `NodeFactory` port. Enables unit tests of NetworkService without real RPC.
   190	
   191	**New files**:
   192	- `src/core/ports/node-factory-port.ts` — port interface.
   193	- `src/core/adapters/aztec-node-factory-adapter.ts` — production adapter.
   194	- `src/core/testing/fake-node-factory.ts` — test double.
   195	
   196	**NodeFactory surface**:
   197	```ts
   198	export interface NodeFactory {
   199	  /** Construct an AztecNode from an rpcUrl. Production impl calls
   200	   *  createAztecNodeClient with makeFetchWithTimeout(). Tests pass a
   201	   *  FakeNodeFactory that returns a deterministic in-memory node. */
   202	  createNode(rpcUrl: string): AztecNode
   203	}
   204	```
   205	
   206	**What changes in NetworkService**:
   207	- Ctor accepts optional `nodeFactory?: NodeFactory`. Default: production adapter.
   208	- Lines 89, 210, 252, 280: `createAztecNodeClient(...)` → `this.nodeFactory.createNode(rpcUrl)`.
   209	
   210	**Scope caveat (audit-flagged)**: `pxe/service.ts:398` has ITS OWN inline `createAztecNodeClient` call. M2.4-b's NodeFactory targets **only** NetworkService. Document this explicitly in the PR description: "NodeFactory is scoped to NetworkService in M2.4-b. PxeService's inline call site at pxe/service.ts:398 is deferred to M2.3-a's ChainRuntime work (which creates its node via a PxeFactory, not the NodeFactory directly)." Otherwise a future reviewer will see the call site and file a bug.
   211	
   212	**Test strategy**:
   213	- Unit: new `network-service.test.ts` drives NetworkService with FakeNodeFactory. Verify getNetwork, setDefault, getNodeStatus, getChainId happy paths + error-on-invalid-rpc.
   214	- Existing e2e: `networks.test.ts` exercises RPC validation — unchanged.
   215	
   216	**Rollback**: Drop-in. Revert NodeFactory adapter + NetworkService ctor.
   217	
   218	---
   219	
   220	### M2.4-c — `WindowManager` (injectable collaborator, NOT Service<Methods>)
   221	
   222	**Shape — audit-resolved**: Originally planned as a full `Service<Methods, Events>` with `client.ts` + `spec.ts`. **Agent flagged** that only SW-side code calls this — no popup-side or content-script client needs RPC access. Full Service ceremony is unjustified. **Codex** was fine with Service layering but also noted "just lifecycle" is the right cut (no RPC boundary ownership).
   223	
   224	**Resolution**: WindowManager becomes a **plain injectable class** (ctor-arg pattern, same as `BalanceRepository` / `SessionManager` from M2.1). No `spec.ts`, no `client.ts`, no RPC `Methods` surface. If a future cross-process consumer appears (e.g., a debug panel listing open approvals), promote to Service then.
   225	
   226	**Purpose**: Centralize `chrome.windows.*` calls. Two consumers (Passkey + DappInteraction) today re-implement the same pattern (create popup + onRemoved listener + timeout + resolve/reject). Extract the shared coordination; consumers delegate.
   227	
   228	**Note**: `WindowPort` already exists as a port — the adapter work is done. M2.4-c is about building the **WindowManager service** that consumes WindowPort and provides a higher-level "open + await result with timeout" API to other services.
   229	
   230	**New file**:
   231	- `src/wallet/services/window-manager/window-manager.ts` — plain class, ctor-injected into consumers.
   232	
   233	**Surface**:
   234	```ts
   235	/**
   236	 * Owns chrome.windows.* lifetime for popup-based user approvals.
   237	 * Injectable collaborator (NOT a Service<Methods>). Two consumer
   238	 * patterns:
   239	 *   - PasskeyService (WebAuthn prompt)
   240	 *   - DappInteractionService (dApp approval)
   241	 * Both open a popup, wait for a settlement (user action or
   242	 * timeout/close), then clean up.
   243	 *
   244	 * Handles are keyed by a random `handleId`, NEVER by `kind` — multiple
   245	 * concurrent windows of the same kind (e.g., two dApp approvals) are
   246	 * supported, matching today's behavior.
   247	 */
   248	export class WindowManager {
   249	  public constructor(
   250	    private readonly windows: WindowPort,
   251	    private readonly clock: ClockPort,
   252	    private readonly logger: ILogger,
   253	  ) {}
   254	
   255	  /** Open a popup at `url`. Returns a handle that resolves when the
   256	   *  popup settles (via `settle(handleId, value)`), is closed by the
   257	   *  user (via `chrome.windows.onRemoved`), or exceeds `timeoutMs`. */
   258	  openAndAwait<T>(opts: OpenAndAwaitOpts<T>): AwaitedWindow<T>
   259	
   260	  /** Settle a pending window with a value. Plain class method — NOT
   261	   *  RPC-addressable. Only the consumer that called `openAndAwait`
   262	   *  (holding the handleId) can settle. Double-settle is a no-op. */
   263	  settle<T>(handleId: string, value: T): void
   264	
   265	  /** Cancel a pending window with an error. Same access semantics as
   266	   *  `settle`. */
   267	  cancel(handleId: string, reason: string): void
   268	}
   269	
   270	export type OpenAndAwaitOpts<T> = {
   271	  url: string
   272	  width: number
   273	  height: number
   274	  timeoutMs: number
   275	  /** Tag used in logs only — NOT for dedup or routing. */
   276	  kind: string
   277	}
   278	
   279	export type AwaitedWindow<T> = {
   280	  handleId: string
   281	  promise: Promise<T>
   282	  windowId: Promise<number | undefined>  // resolves once window is created
   283	}
   284	```
   285	
   286	**Consumer refactor pattern**:
   287	
   288	**PasskeyService.openWindowAndWait** today (simplified):
   289	```ts
   290	async openWindowAndWait(request) {
   291	  const requestId = crypto.randomUUID()
   292	  const window = await chrome.windows.create({...})
   293	  this.pending.set(requestId, { request, window.id, deferred })
   294	  const timer = setTimeout(() => deferred.reject(...), PASSKEY_TIMEOUT_MS)
   295	  chrome.windows.onRemoved.addListener(onRemoved)
   296	  const result = await deferred.promise
   297	  chrome.windows.onRemoved.removeListener(onRemoved)
   298	  clearTimeout(timer)
   299	  return result
   300	}
   301	```
   302	
   303	**Post-M2.4-c**:
   304	```ts
   305	async openWindowAndWait(request) {
   306	  const handle = this.windowManager.openAndAwait<PasskeyCredential>({
   307	    url: ".../passkey/...",
   308	    width: 500, height: 800,
   309	    timeoutMs: PASSKEY_TIMEOUT_MS,
   310	    kind: "passkey",
   311	  })
   312	  // Popup's window.ts calls passkey.resolvePasskeyRequest(requestId, creds)
   313	  // which forwards via windowManager.settle(handle.handleId, creds).
   314	  return await handle.promise
   315	}
   316	```
   317	
   318	**What moves**:
   319	- From PasskeyService: window-create, onRemoved wiring, timeout, pending-map plumbing → WindowManager.
   320	- From DappInteractionService: same set → WindowManager.
   321	
   322	**What stays in each consumer**:
   323	- Business logic (what the popup asks for, what result shape is expected).
   324	- The popup's content-script entry points (window.ts for passkey, approval.ts for dapp).
   325	
   326	**Cross-cut with M2.1 PasskeyRecoveryCoordinator**: The coordinator calls `passkeys.createKey(userHandle)` + `passkeys.getKey(credentialId)`. These wrap `openWindowAndWait`. After M2.4-c, the wrap delegates to WindowManager. **The coordinator's contract is preserved** — it still awaits a PasskeyCredential promise.
   327	
   328	**wallet-sdk's 3rd window call site** (`background.ts:135`): Out of scope. A follow-up PR can route it through WindowManager if desired. **Audit-required enforcement** (agent finding): add a lint-level guard when M2.4-c lands — e.g., eslint `no-restricted-syntax` on `chrome.windows.create` everywhere except `src/wallet/services/window-manager/` and `src/wallet/services/wallet-sdk/background.ts:135` (explicitly allowed with a comment pointing to the follow-up task). Without enforcement, the "all windows through WindowManager" invariant erodes silently.
   329	
   330	**Test strategy**:
   331	- Unit: `window-manager.test.ts` drives the service with FakeWindowPort + FakeClockPort. Cases: normal settle, timeout, user-close, double-settle (ignored), settle-after-timeout (ignored).
   332	- Integration: Passkey + DappInteraction smoke test paths (already covered by existing e2e) — unchanged results.
   333	- Regression: the existing `wallet-lock.test.ts` + any passkey e2e paths must still pass byte-for-byte.
   334	
   335	**Rollback**: New service can be unregistered; Passkey + DappInteraction reverted to inline chrome.windows.* calls. Cost: ~100 LOC per consumer + the WindowManager files.
   336	
   337	---
   338	
   339	## Verification cadence (per sub-PR)
   340	
   341	After each sub-PR:
   342	1. `bunx vitest run` — all units, new + existing.
   343	2. `bun run typecheck` + `bun run build:chrome`.
   344	3. `bun run test:e2e` — smoke 15/15.
   345	4. `bun run test:e2e:all` — network 31/31.
   346	5. Manual QA:
   347	   - M2.4-a: lock + unlock + verify token balances refresh on expected cadence.
   348	   - M2.4-b: switch networks + verify nodeStatus + addNetwork flow.
   349	   - M2.4-c: try passkey unlock + dApp approval popup — both behave identically to pre-M2.4-c.
   350	
   351	## Risk register
   352	
   353	| # | Risk | Likelihood | Mitigation |
   354	|---|---|---|---|
   355	| 1 | **BackgroundTickerPort choice (setInterval vs chrome.alarms)** — the port design should allow a future switch without caller changes. If the port is too thin, future migration is a breaking change. | LOW | Interface supports callback + cancel only; no timing precision guarantees. Documented to allow chrome.alarms swap-in. |
   356	| 2 | **TokenBalanceService cadence drift** — replacing the while loop with a ticker could subtly shift when the first batch runs. | LOW | Test: first-tick-after-start behavior pinned. |
   357	| 3 | **WindowManager + popup RPC routing** — the popup's content script must call a settle RPC that reaches WindowManager. Who owns the RPC methodology? | MED | Keep passkey + dapp-interaction popups' existing RPCs. WindowManager's `settle` is an INTERNAL method, called by those services when they receive the popup's RPC. No popup-side change. |
   358	| 4 | **M2.4-b createNode options** — today the call includes `makeFetchWithTimeout()`. The NodeFactory port must preserve this. | LOW | Adapter constructor hardcodes the fetch factory. |
   359	| 5 | **PasskeyRecoveryCoordinator's contract** must survive M2.4-c. | LOW | WindowManager's result-promise shape matches what coordinator expects from PasskeyService.createKey/getKey. No coordinator change. |
   360	| 6 | **wallet-sdk 3rd window call site** not routed through WindowManager — future debt. | LOW | Flag in M2.4-c PR description; create follow-up task. |
   361	| 7 | **Profile-switch during in-flight balance refresh** — today the continuous loop re-enqueues all balances on profile change. Post-M2.4-a, the queue clear + re-enqueue still happens but via event handlers. Timing could differ. | MED | Integration test: profile switch during active balance refresh; assert final state correct. |
   362	| 8 | **Storage-key or persistence drift in BalanceRepository** — refactor must preserve the exact EntityStorage shape. | LOW | Repo unit tests pin the key + shape. |
   363	
   364	## Pre-formulated codex audit questions (for M2.4 plan audit)
   365	
   366	Q1. **BackgroundTickerPort vs ClockPort**: is a new port justified? Why not use `ClockPort.setInterval` directly? What specific property does BackgroundTickerPort guarantee that ClockPort doesn't?
   367	
   368	Q2. **BalanceJobQueue-driven vs continuous loop**: is there a regression risk around "time-to-first-balance-shown" for a freshly-unlocked wallet? Walk through the boot sequence.
   369	
   370	Q3. **WindowManager scope**: should it own BOTH window creation AND the associated RPC boundary (popup ↔ SW for settle), or just the window lifecycle? My plan picks "just lifecycle"; is that the right cut?
   371	
   372	Q4. **Tx/balance interaction**: TokenBalanceService calls ExecutionService.executeSimulateViews (which has its own gas-balance cache post-M2.2-f). Is there a coupling M2.4-a needs to respect? Can BalanceProjector become leaner by going through ContractResolver / direct PXE instead?
   373	
   374	Q5. **NodeFactory port — single method sufficient**? Future growth might need `destroyNode`, `isHealthy`, etc. Is it OK to ship minimal now?
   375	
   376	Q6. **WindowManager + multiple pending windows of same kind** — e.g., 2 concurrent dApp approvals. Plan says handles are per-request. Does the current code prevent this, and should WindowManager?
   377	
   378	Q7. **Existing WindowPort** is already defined but unused. M2.4-c introduces a higher-level service — is there risk of WindowManager duplicating WindowPort's responsibilities?
   379	
   380	Q8. **BalanceRepository + BalanceProjector + BalanceJobQueue** is 3 classes from a 450-LOC service. Is this the right granularity, or is it over-split?
   381	
   382	Q9. **wallet-sdk's 3rd chrome.windows.create call** (`background.ts:135`) — should we address it now to prevent drift, or defer as planned?
   383	
   384	Q10. **What's the BLAST radius** if BackgroundTickerPort has a subtle bug (e.g., double-tick per interval)?
   385	
   386	## Cross-M2.X dependencies (for the arc README)
   387	
   388	- **M2.4-a** depends on M2.2's `ExecutionServiceClient.executeSimulateViews` remaining stable. M2.2 preserves this in the facade; no conflict.
   389	- **M2.4-c** depends on `WindowPort` (already exists). The coordinator from M2.1 is preserved.
   390	- **M2.4-b** has no dependencies; can ship any time.
   391	- None of M2.4-a/b/c depend on each other.
   392	
   393	## Open decisions for execution time
   394	
   395	1. **BackgroundTickerPort.subscribe return** — TickerHandle vs plain cancel function. Plan picks TickerHandle for extensibility (could later add `.isActive`, `.invokeNow`).
   396	2. **BalanceProjector error surfacing** — today's syncBatch fails all balances in a batch on any error. Plan preserves; reconsider per-balance partial-success later.
   397	3. **WindowManager logging** — plan omits; add if the consumer-side log drift becomes painful.
   398	4. **FakeBackgroundTicker** test ergonomics — manual `tick()` call vs cooperative with FakeClock? Plan: manual tick method; decide during implementation.

exec
/bin/zsh -lc "nl -ba packages/extension/src/core/ports/clock-port.ts | sed -n '1,220p'" in (project root)
 succeeded in 0ms:
     1	/**
     2	 * Time + timers abstracted so services can be unit-tested with a MockClock
     3	 * that advances virtual time, instead of real-wall-clock waits.
     4	 *
     5	 * Not included: alarms. Those are Chrome-specific and live on `AlarmsPort`.
     6	 */
     7	
     8	export type TimerHandle = unknown
     9	
    10	export interface ClockPort {
    11		/** Epoch milliseconds; equivalent to `Date.now()` with the real clock. */
    12		now(): number
    13	
    14		/** Resolve after `ms` milliseconds. Used by services that busy-wait. */
    15		sleep(ms: number): Promise<void>
    16	
    17		/** Schedule `fn` after `ms`. Returns a handle for `clearTimeout`. */
    18		setTimeout(fn: () => void, ms: number): TimerHandle
    19		clearTimeout(handle: TimerHandle): void
    20	
    21		/** Schedule `fn` every `ms`. Returns a handle for `clearInterval`. */
    22		setInterval(fn: () => void, ms: number): TimerHandle
    23		clearInterval(handle: TimerHandle): void
    24	}

exec
/bin/zsh -lc "rg -n \"class .*Client extends ServiceClient|new BrowserApi|ClockPort|interface ClockPort|FakeClock|clock\" packages/extension/src/core packages/extension/src/wallet/services | sed -n '1,260p'" in (project root)
 succeeded in 0ms:
packages/extension/src/core/ports/index.ts:10: *   - ClockPort       — time + timers
packages/extension/src/core/ports/index.ts:20:export type { ClockPort, TimerHandle } from "./clock-port"
packages/extension/src/core/ports/clock-port.ts:3: * that advances virtual time, instead of real-wall-clock waits.
packages/extension/src/core/ports/clock-port.ts:10:export interface ClockPort {
packages/extension/src/core/ports/clock-port.ts:11:	/** Epoch milliseconds; equivalent to `Date.now()` with the real clock. */
packages/extension/src/core/adapters/index.ts:7:export { SystemClock } from "./system-clock"
packages/extension/src/core/adapters/system-clock.ts:2: * Real-clock implementation of ClockPort. Wraps Date.now and the global
packages/extension/src/core/adapters/system-clock.ts:6:import type { ClockPort, TimerHandle } from "@/core/ports"
packages/extension/src/core/adapters/system-clock.ts:8:export class SystemClock implements ClockPort {
packages/extension/src/core/testing/index.ts:6:export { MockClock } from "./mock-clock"
packages/extension/src/wallet/services/network/client.ts:16:export class NetworkServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/core/testing/mock-clock.ts:2: * ClockPort implementation for tests. Time is virtual — `advance(ms)` runs
packages/extension/src/core/testing/mock-clock.ts:3: * timers whose deadlines fall within the advance window. No wall-clock
packages/extension/src/core/testing/mock-clock.ts:7: *   const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.ts:8: *   const svc = new SomeService(clock, ...)
packages/extension/src/core/testing/mock-clock.ts:9: *   clock.advance(1000)            // fire all timers due in next 1s
packages/extension/src/core/testing/mock-clock.ts:12: * The API mirrors ClockPort plus a small test-only surface (`advance`,
packages/extension/src/core/testing/mock-clock.ts:16:import type { ClockPort, TimerHandle } from "@/core/ports"
packages/extension/src/core/testing/mock-clock.ts:25:export class MockClock implements ClockPort {
packages/extension/src/core/testing/mock-clock.test.ts:2:import { MockClock } from "./mock-clock"
packages/extension/src/core/testing/mock-clock.test.ts:6:		const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.test.ts:7:		expect(clock.now()).toBe(0)
packages/extension/src/core/testing/mock-clock.test.ts:11:		const clock = new MockClock(1000)
packages/extension/src/core/testing/mock-clock.test.ts:12:		expect(clock.now()).toBe(1000)
packages/extension/src/core/testing/mock-clock.test.ts:16:		const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.test.ts:18:		clock.setTimeout(() => {
packages/extension/src/core/testing/mock-clock.test.ts:23:		clock.advance(499)
packages/extension/src/core/testing/mock-clock.test.ts:25:		clock.advance(1)
packages/extension/src/core/testing/mock-clock.test.ts:27:		expect(clock.now()).toBe(500)
packages/extension/src/core/testing/mock-clock.test.ts:31:		const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.test.ts:33:		const handle = clock.setTimeout(() => {
packages/extension/src/core/testing/mock-clock.test.ts:36:		clock.clearTimeout(handle)
packages/extension/src/core/testing/mock-clock.test.ts:37:		clock.advance(1000)
packages/extension/src/core/testing/mock-clock.test.ts:42:		const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.test.ts:44:		clock.setInterval(() => {
packages/extension/src/core/testing/mock-clock.test.ts:48:		clock.advance(350)
packages/extension/src/core/testing/mock-clock.test.ts:50:		clock.advance(200)
packages/extension/src/core/testing/mock-clock.test.ts:55:		const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.test.ts:57:		const handle = clock.setInterval(() => {
packages/extension/src/core/testing/mock-clock.test.ts:60:		clock.advance(250)
packages/extension/src/core/testing/mock-clock.test.ts:62:		clock.clearInterval(handle)
packages/extension/src/core/testing/mock-clock.test.ts:63:		clock.advance(1000)
packages/extension/src/core/testing/mock-clock.test.ts:68:		const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.test.ts:70:		const promise = clock.sleep(100).then(() => {
packages/extension/src/core/testing/mock-clock.test.ts:73:		clock.advance(50)
packages/extension/src/core/testing/mock-clock.test.ts:76:		clock.advance(50)
packages/extension/src/core/testing/mock-clock.test.ts:82:		const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.test.ts:84:		clock.setTimeout(() => {
packages/extension/src/core/testing/mock-clock.test.ts:85:			clock.setTimeout(() => {
packages/extension/src/core/testing/mock-clock.test.ts:90:		clock.advance(200)
packages/extension/src/core/testing/mock-clock.test.ts:95:		const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.test.ts:96:		clock.setTimeout(() => {}, 100)
packages/extension/src/core/testing/mock-clock.test.ts:97:		clock.setTimeout(() => {}, 200)
packages/extension/src/core/testing/mock-clock.test.ts:98:		expect(clock.pendingCount).toBe(2)
packages/extension/src/core/testing/mock-clock.test.ts:99:		clock.advance(150)
packages/extension/src/core/testing/mock-clock.test.ts:100:		expect(clock.pendingCount).toBe(1)
packages/extension/src/core/testing/mock-clock.test.ts:104:		const clock = new MockClock()
packages/extension/src/core/testing/mock-clock.test.ts:106:		clock.setTimeout(() => {
packages/extension/src/core/testing/mock-clock.test.ts:109:		clock.setNow(10_000)
packages/extension/src/core/testing/mock-clock.test.ts:111:		expect(clock.now()).toBe(10_000)
packages/extension/src/wallet/services/account-state/client.ts:9:export class AccountStateServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/auth-registry/client.ts:10:export class AuthRegistryServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/account/client.ts:9:export class AccountServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/dapp-session/client.ts:19:export class DappSessionServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/logger/client.ts:8:export class LoggerServiceClient extends ServiceClient<Methods> implements ServiceSpec<Methods>, ILogger {
packages/extension/src/wallet/services/log-viewer/client.ts:9:export class LogViewerServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/token-balance/client.ts:9:export class TokenBalanceServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/config/client.ts:9:export class ConfigServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/contact/client.ts:9:export class ContactServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/note/client.ts:8:export class NoteServiceClient extends ServiceClient<Methods> implements ServiceSpec<Methods> {
packages/extension/src/wallet/services/transaction/client.ts:9:export class TransactionServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/dapp-interaction/client.ts:21:export class DappInteractionServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/passkey/client.ts:8:export class PasskeyServiceClient extends ServiceClient<Methods> implements ServiceSpec<Methods> {
packages/extension/src/wallet/services/operation-journal/client.ts:19:export class OperationJournalServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/profile/client.ts:9:export class ProfileServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/execution/client.ts:17:export class ExecutionServiceClient extends ServiceClient<Methods> implements ServiceSpec<Methods> {
packages/extension/src/wallet/services/fpc/client.ts:9:export class FpcServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/task/client.ts:9:export class TaskServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/token/client.ts:9:export class TokenServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/pxe/client.ts:29:export class PxeServiceClient extends ServiceClient<Methods> implements ServiceSpec<Methods> {

exec
/bin/zsh -lc "rg -n \"network-service\\.test|NetworkService\" packages/extension/src/wallet/services/network packages/extension/tests packages/extension/src | sed -n '1,240p'" in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/services/network/service.ts:16:export class NetworkService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/network/client.ts:16:export class NetworkServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/account-state/service.ts:6:import { NetworkService } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/account-state/service.ts:29:	private networkService: NetworkService = null!
packages/extension/src/wallet/services/account-state/service.ts:37:		this.networkService = services.get(NetworkService.name)
packages/extension/src/utils/core.ts:24:import type { NetworkServiceClient } from "@/wallet/services/network/client"
packages/extension/src/utils/core.ts:46:	network: NetworkServiceClient
packages/extension/src/utils/core.ts:75:		network: null as unknown as NetworkServiceClient,
packages/extension/src/wallet/services/auth-registry/service.ts:6:import { NetworkService } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/auth-registry/service.ts:33:	private networkService: NetworkService = null!
packages/extension/src/wallet/services/auth-registry/service.ts:45:		this.networkService = services.get(NetworkService.name)
packages/extension/src/wallet/services/token-balance/service.ts:11:import { NetworkService } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/token-balance/service.ts:37:	private networkService: NetworkService = null!
packages/extension/src/wallet/services/token-balance/service.ts:52:		this.networkService = services.get(NetworkService.name)
packages/extension/src/wallet/services/network/service.ts:16:export class NetworkService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/wallet-sdk/dispatcher.ts:43:import type { NetworkService, Network } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/wallet-sdk/dispatcher.ts:155:		private readonly networkService: NetworkService,
packages/extension/src/wallet/services/network/client.ts:16:export class NetworkServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
packages/extension/src/wallet/services/wallet-sdk/background.ts:30:import { NetworkService } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/wallet-sdk/background.ts:53:	const networkService: NetworkService = services.get(NetworkService.name)
packages/extension/src/wallet/services/wallet-sdk/background.ts:452: * used by NetworkService (chainId = l1ChainId ^ rollupVersion).
packages/extension/src/wallet/services/execution/service.ts:36:import { NetworkService } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/execution/service.ts:145:	private networkService: NetworkService = null!
packages/extension/src/wallet/services/execution/service.ts:178:		this.networkService = services.get(NetworkService.name)
packages/extension/src/wallet/services/transaction/service.ts:6:import { NetworkService } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/transaction/service.ts:41:	private networkService: NetworkService = null!
packages/extension/src/wallet/services/transaction/service.ts:51:		this.networkService = services.get(NetworkService.name)
packages/extension/src/wallet/services/note/service.ts:6:import { NetworkService, type Network } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/note/service.ts:17:	private networkService: NetworkService = null!
packages/extension/src/wallet/services/note/service.ts:25:		this.networkService = services.get(NetworkService.name)
packages/extension/src/wallet/services/token/service.ts:5:import { NetworkService } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/token/service.ts:44:	private networks: NetworkService = null!
packages/extension/src/wallet/services/token/service.ts:55:		this.networks = services.get(NetworkService.name)
packages/extension/src/wallet/services/fpc/service.ts:6:import { NetworkService } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/fpc/service.ts:39:	private networkService: NetworkService = null!
packages/extension/src/wallet/services/fpc/service.ts:48:		this.networkService = services.get(NetworkService.name)
packages/extension/src/wallet/services/execution/tx-request-builder.ts:58:import type { NetworkService, Network } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/execution/tx-request-builder.ts:77:		private readonly networkService: NetworkService,
packages/extension/src/wallet/services/dapp-interaction/service.ts:6:import { NetworkService, type Network } from "@/wallet/services/network/service"
packages/extension/src/wallet/services/dapp-interaction/service.ts:53:	private networkService: NetworkService = null!
packages/extension/src/wallet/services/dapp-interaction/service.ts:64:		this.networkService = services.get(NetworkService.name)
packages/extension/src/popup/app.vue:13:import { NetworkServiceClient } from "@/wallet/services/network/client"
packages/extension/src/popup/app.vue:80:	managers.network = new NetworkServiceClient()
packages/extension/src/popup/pages/settings/security/export/full.vue:20:import { NetworkServiceClient } from "@/wallet/services/network/client"
packages/extension/src/popup/pages/settings/security/export/full.vue:46:	new NetworkServiceClient(),
packages/extension/src/wallet/runtime.ts:32:import { NetworkService } from "./services/network/service"
packages/extension/src/wallet/runtime.ts:114:		services.add(new NetworkService(logger))
packages/extension/src/popup/windows/execute/index.vue:13:import { type Network, NetworkServiceClient } from "@/wallet/services/network/client"
packages/extension/src/popup/windows/execute/index.vue:134:		const networkService = new NetworkServiceClient()
packages/extension/src/popup/windows/verify/index.vue:12:import { NetworkServiceClient, type Network } from "@/wallet/services/network/client"
packages/extension/src/popup/windows/verify/index.vue:92:	const networkService = new NetworkServiceClient()
packages/extension/src/popup/pages/settings/connected-apps/[id].vue:22:import { NetworkServiceClient } from "@/wallet/services/network/client"
packages/extension/src/popup/pages/settings/connected-apps/[id].vue:89:	const networkServiceClient = new NetworkServiceClient()
packages/extension/src/wallet/utils/caip.ts:68:/** Minimal shape expected of a NetworkService-like object. Using the
packages/extension/src/popup/components/popups/ImportPopup.vue:10:import { NetworkServiceClient } from "@/wallet/services/network/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:433:		const networkService = new NetworkServiceClient()

exec
/bin/zsh -lc "nl -ba packages/extension/src/core/testing/fake-clock.ts | sed -n '1,260p'" in (project root)
 succeeded in 0ms:
nl: packages/extension/src/core/testing/fake-clock.ts: No such file or directory

exec
/bin/zsh -lc "nl -ba packages/extension/src/core/testing/mock-clock.ts | sed -n '1,260p'" in (project root)
 succeeded in 0ms:
     1	/**
     2	 * ClockPort implementation for tests. Time is virtual — `advance(ms)` runs
     3	 * timers whose deadlines fall within the advance window. No wall-clock
     4	 * waiting, no coupling to `vi.useFakeTimers()`.
     5	 *
     6	 * Usage:
     7	 *   const clock = new MockClock()
     8	 *   const svc = new SomeService(clock, ...)
     9	 *   clock.advance(1000)            // fire all timers due in next 1s
    10	 *   expect(...).toBe(...)
    11	 *
    12	 * The API mirrors ClockPort plus a small test-only surface (`advance`,
    13	 * `setNow`, `pendingCount`).
    14	 */
    15	
    16	import type { ClockPort, TimerHandle } from "@/core/ports"
    17	
    18	interface ScheduledTimer {
    19		id: number
    20		due: number
    21		fn: () => void
    22		intervalMs?: number
    23	}
    24	
    25	export class MockClock implements ClockPort {
    26		private virtualNow: number
    27		private nextId = 1
    28		private readonly timers = new Map<number, ScheduledTimer>()
    29	
    30		public constructor(initialNow = 0) {
    31			this.virtualNow = initialNow
    32		}
    33	
    34		public now(): number {
    35			return this.virtualNow
    36		}
    37	
    38		public sleep(ms: number): Promise<void> {
    39			return new Promise((resolve) => {
    40				this.setTimeout(resolve, ms)
    41			})
    42		}
    43	
    44		public setTimeout(fn: () => void, ms: number): TimerHandle {
    45			const id = this.nextId++
    46			this.timers.set(id, { id, due: this.virtualNow + ms, fn })
    47			return id
    48		}
    49	
    50		public clearTimeout(handle: TimerHandle): void {
    51			this.timers.delete(handle as number)
    52		}
    53	
    54		public setInterval(fn: () => void, ms: number): TimerHandle {
    55			const id = this.nextId++
    56			this.timers.set(id, { id, due: this.virtualNow + ms, fn, intervalMs: ms })
    57			return id
    58		}
    59	
    60		public clearInterval(handle: TimerHandle): void {
    61			this.timers.delete(handle as number)
    62		}
    63	
    64		/** Test-only: advance virtual time by `ms`, firing timers due in the window. */
    65		public advance(ms: number): void {
    66			const target = this.virtualNow + ms
    67	
    68			// Loop because timers may schedule new timers when they fire.
    69			while (true) {
    70				const dueNext = [...this.timers.values()].filter((t) => t.due <= target).sort((a, b) => a.due - b.due)
    71				if (!dueNext.length) break
    72	
    73				const timer = dueNext[0]
    74				this.virtualNow = timer.due
    75				if (timer.intervalMs !== undefined) {
    76					// Intervals: reschedule for next tick before firing.
    77					timer.due = timer.due + timer.intervalMs
    78				} else {
    79					this.timers.delete(timer.id)
    80				}
    81				timer.fn()
    82			}
    83	
    84			this.virtualNow = target
    85		}
    86	
    87		/** Test-only: jump `now` without firing timers. Useful for seeding time. */
    88		public setNow(ms: number): void {
    89			this.virtualNow = ms
    90		}
    91	
    92		/** Test-only: number of scheduled timers still pending. */
    93		public get pendingCount(): number {
    94			return this.timers.size
    95		}
    96	}

exec
/bin/zsh -lc "sed -n '1,260p' implementations-plan/M2/4/codex-review.md" in (project root)
exec
/bin/zsh -lc "sed -n '1,240p' implementations-plan/M2/4/agent-review.md" in (project root)
 succeeded in 0ms:
OpenAI Codex v0.120.0 (research preview)
--------
workdir: (project root)
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, (codex memory dir)]
reasoning effort: none
reasoning summaries: none
session id: 019db6fb-2f62-7b52-89ff-443fc0c0763a
--------
user
You are reviewing an implementation plan created by another AI agent (Claude).
Your job is to critique the plan — find gaps, risks, missed edge cases, better alternatives, or confirm it looks solid. Pessimism welcome.

## Task

Audit the M2.4 implementation plan at `implementations-plan/M2/4/plan.md` for execution readiness. This is a ~2-week refactor arc with 3 sub-PRs:
- **M2.4-a**: TokenBalanceService split (~450 LOC service, continuous `while(true) { sleep(1000) }` worker) into BalanceRepository + BalanceProjector + BalanceJobQueue + a new BackgroundTickerPort.
- **M2.4-b**: NodeFactory port injection into NetworkService — replaces 4 inline `createAztecNodeClient(...)` calls.
- **M2.4-c**: WindowManager extraction from PasskeyService + DappInteractionService. Centralizes `chrome.windows.*` calls.

The plan was drafted and audited in the original M2 planning arc. Since then M2.1, M2.2, and M2.3 have all shipped to master; the tree is at 0.12.0. Some plan facts may have drifted.

## Context — current tree state

Chrome MV3 extension, Aztec wallet. All three M2.4 targets run in the service worker (not offscreen). The MV3 SW can be suspended by Chrome at any time — any fine-grained timing promises in the plan need to survive that.

Shipped artifacts from M2.1/2/3 that M2.4 cross-cuts:

- `src/wallet/utils/rw-guard.ts` — ReadWriteGuard with drain-on-write, writer-FIFO priority, 5-min force-release on stuck readers. Only PxeService uses it.
- `src/wallet/services/pxe/chain-runtime.ts` — ChainRuntimeRegistry + PxeFactory. Per-chain PXE+Node keyed by (profileId, chainId). **M2.4-b introduces a SEPARATE `NodeFactory` — just for NetworkService.** The plan claims this is fine; verify whether they should share or really are distinct.
- `src/wallet/services/pxe/artifact-registry.ts` — ArtifactRegistry with explicit policy + byClassId pinning + config.onUpdate subscription.
- `src/wallet/base/offscreen/client.ts` — ServiceClient transport-base now hoists `ensureOffscreenRunning()` via template-method + `onReady()` hook. Offscreen-client-only (PxeServiceClient). Other services use `base/background`, which did not change.

## Nuances

- **Type-lie pitfall** just bit us on master. M2.1-c declared `PasskeyRecovery.secret: Fr` but `PasskeyCredential.deriveMasterSecret()` always returned `Buffer<ArrayBuffer>`. Every unit test mocked the declared type (`Fr`) instead of the runtime type (`Buffer`), so tests passed but the real flow threw `"secret.toBuffer is not a function"`. I want you to flag analogous pitfalls proactively in M2.4's proposed collaborators (BalanceProjector, BalanceJobQueue, WindowManager, NodeFactory). Consider:
  - What does `ExecutionService.executeSimulateViews` actually return at runtime vs its declared type? (BalanceProjector's input)
  - What does `createAztecNodeClient` actually return? (NodeFactory's return — it's a safe-json-rpc proxy, not a POJO)
  - `chrome.windows.create` resolves with a `Window` whose `.id` may be `undefined`.

- **An independent verification agent already ran** and found:
  1. BalanceProjector ctor type in plan is wrong — plan says `ExecutionServiceClient`, should be `ExecutionService` (SW-local handle, not popup client). Same for TaskServiceClient → TaskService in BalanceJobQueue.
  2. M2.4-b's scope caveat cites `pxe/service.ts:398` — that file/line was removed by M2.3-a. The real 5th `createAztecNodeClient` call lives at `pxe/chain-runtime.ts:53` inside `ProductionPxeFactory`. Recommendation: extend M2.4-b to inject NodeFactory there too.
  3. Plan claims M2.2-f extracted GasBalanceCache; it didn't (still inline at `execution/service.ts:163, 209-221, 909, 995`). Doesn't block M2.4-a but the entry state is wrong.
  4. Pre-existing stale-write race on profile switch during in-flight `syncBatch` — TokenBalanceService has no guard; M2.4-a preserves the race. Plan should acknowledge rather than claim invariance.
  5. Plan text docs `window-port.ts:2-6` reference M3.5 for WindowManager extraction; the plan moves it to M2.4-c. Minor doc drift.

You are free to confirm, refute, or expand on these findings. They are inputs, not constraints.

## Review Instructions

Evaluate the plan broadly. Your scope is deliberately wide — do not narrow. I want:

1. **Architectural concerns** I missed. Is the split in M2.4-a the right shape? Does BackgroundTickerPort belong to `src/core/ports/` or is it a token-balance concern? Is WindowManager better as a plain class (plan's current audit-resolved choice) or a Service?

2. **Cross-sub-PR and cross-M2.X interactions**. The PxeFactory (M2.3) vs NodeFactory (M2.4-b) split — genuinely separate, or is the plan leaving a duplicated abstraction on the table?

3. **Edge cases in the proposed collaborator surfaces**:
   - BackgroundTickerPort "serialized + coalescing" contract — what happens if `onTick` throws? If cancel() fires during an in-flight tick?
   - BalanceJobQueue `clear()` vs in-flight tick during profile switch (plan risk #7) — the verification agent flagged this as an un-fixed pre-existing race. Does the plan's current design make it worse, better, or leave it?
   - WindowManager: settle-after-timeout, double-settle, concurrent same-kind windows, `CreatedWindow.id === undefined`, `chrome.windows.onRemoved` firing for ALL browser windows globally (must filter).

4. **Test-mock vs runtime-reality pitfalls** — as above, proactively flag shapes where the declared type would make tests pass with POJO fakes while the real runtime behavior differs.

5. **Simpler alternatives** — is M2.4-a over-engineered? Could we skip BackgroundTickerPort and just use ClockPort.setInterval with a manual serialization guard? Is the 4-class split in M2.4-a the right cardinality, or would 2 (Repository + rest) do?

6. **Execution order**. User proposed: b → a → manual QA gate → c. Sanity-check the ordering, gate placement, and whether any risk justifies a different sequence.

7. **Test cadence per sub-PR**. Claude's defaults: b=unit+smoke, a=unit+smoke+network, c=unit+smoke. Any sub-PR that deserves more or less?

8. **Anything else** that would make you want to rewrite the plan vs. ship as-is. Don't hold back.

Ship a comprehensive markdown review. Severity-tag findings if it helps communicate priority. Cite plan:line and code file:line. If you think the plan is sound, say so and move on — but it's a 398-line plan and a 2-week arc, so I expect *something*.

codex
I’m auditing the plan against the current 0.12.0 tree, not trusting the original M2 assumptions. First step is to read the plan and the live implementations for the three refactor targets plus the M2.1/2/3 cross-cutting pieces you called out.
  → Read M2.4 plan and note claimed scopes, invariants, collaborator APIs, and cited file references
  • Inspect current implementations for TokenBalanceService, NetworkService/node creation, PasskeyService, DappInteractionService, and relevant M2.1/M2.3 infrastructure
  • Compare plan against current tree, identify architectural/runtime/test risks, and draft severity-ranked review with file+line citations
exec
/bin/zsh -lc "sed -n '261,520p' implementations-plan/M2/4/plan.md" in (project root)
 succeeded in 0ms:
   *  RPC-addressable. Only the consumer that called `openAndAwait`
   *  (holding the handleId) can settle. Double-settle is a no-op. */
  settle<T>(handleId: string, value: T): void

  /** Cancel a pending window with an error. Same access semantics as
   *  `settle`. */
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
- Unit: `window-manager.test.ts` drives the service with FakeWindowPort + FakeClockPort. Cases: normal settle, timeout, user-close, double-settle (ignored), settle-after-timeout (ignored).
- Integration: Passkey + DappInteraction smoke test paths (already covered by existing e2e) — unchanged results.
- Regression: the existing `wallet-lock.test.ts` + any passkey e2e paths must still pass byte-for-byte.

**Rollback**: New service can be unregistered; Passkey + DappInteraction reverted to inline chrome.windows.* calls. Cost: ~100 LOC per consumer + the WindowManager files.

---

## Verification cadence (per sub-PR)

After each sub-PR:
1. `bunx vitest run` — all units, new + existing.
2. `bun run typecheck` + `bun run build:chrome`.
3. `bun run test:e2e` — smoke 15/15.
4. `bun run test:e2e:all` — network 31/31.
5. Manual QA:
   - M2.4-a: lock + unlock + verify token balances refresh on expected cadence.
   - M2.4-b: switch networks + verify nodeStatus + addNetwork flow.
   - M2.4-c: try passkey unlock + dApp approval popup — both behave identically to pre-M2.4-c.

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

exec
/bin/zsh -lc "sed -n '1,260p' implementations-plan/M2/4/plan.md" in (project root)
 succeeded in 0ms:
# M2.4 — Worker-heavy services (3 sub-PRs, ~2 weeks)

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

 succeeded in 0ms:
# M2.4 pre-flight verification

Hands-on audit against master at `2d1f5c0` (v0.12.0). Scope: every `file:line` claim in `plan.md`, plus test-mock pitfalls, cross-cuts with the shipped M2.1/M2.2/M2.3 work, port inventory, profile-switch semantics, and WindowManager blast radius.

---

## 1. Plan line numbers vs current master

All of the TokenBalanceService and NetworkService callouts are **byte-accurate**. The passkey/dapp/wallet-sdk callouts are accurate on line numbers but have minor pseudocode drift (not behavioural). One shipped M2.3 change has invalidated a scope-caveat sentence in M2.4-b.

### TokenBalanceService (`src/wallet/services/token-balance/service.ts`, 449 LOC)

| Plan claim | Master truth | Verdict |
|---|---|---|
| `while (true) { sleep(1000) }` at 233-257 | `startWorker` body exactly at 233-257, `await sleep(1000)` at 255 | EXACT |
| `syncBatch` at 259-419 | method body 259-419 | EXACT |
| `onActiveProfileChanged` at 148-156 | arrow method 148-156 | EXACT |
| `Queue + pendingTasks` at 32-33 | `this.queue` at 32, `this.pendingTasks` at 33 | EXACT |
| `EntityStorage` at line 31, key `nulo:core:token-balances`, `StorageType.Local` | line 31 — `new EntityStorage<TokenBalanceRaw>("nulo:core:token-balances", StorageType.Local)` | EXACT |
| Plan says file is "450 LOC" | 449 | OK (1-line slack) |

### NetworkService (`src/wallet/services/network/service.ts`, 350 LOC)

| Plan claim | Master truth | Verdict |
|---|---|---|
| `createAztecNodeClient` at 89, 210, 252, 280 | present at exactly 89, 210, 252, 280 | EXACT |
| Node cache `Map<number, AztecNode>` at line 25 | line 25 | EXACT |
| Cache cleared on profile switch at line 295 | `this.nodes.clear()` at 295 | EXACT |
| `getChainId(rpcUrl)` at 280 | method starts at 278, `createAztecNodeClient` call at 280 | EXACT |

### PasskeyService (`src/wallet/services/passkey/service.ts`, 108 LOC)

| Plan claim | Master truth | Verdict |
|---|---|---|
| `chrome.windows.create + onRemoved + 5min timeout` at 76-104 | `chrome.windows.create(` at 76, `onRemoved.addListener` at 102, timeout constant `PASSKEY_TIMEOUT_MS = 5*60*1000` at 15 | EXACT |
| Plan pseudocode for `openWindowAndWait` | Runtime uses `chrome.windows.create(opts, callback)` form (callback at 83-104), not `await chrome.windows.create(...)` as the plan's simplified listing implies. `promise.finally(() => clearTimeout(timeoutHandle))` at 106 instead of inline await + `clearTimeout`. | **Doc drift — not structural.** Behaviour same. |

### DappInteractionService (`src/wallet/services/dapp-interaction/service.ts`, 452 LOC)

| Plan claim | Master truth | Verdict |
|---|---|---|
| Same pattern, 10 min timeout, `windowId → interactionId`, at 194-220 | `chrome.windows.create(` at 194, onRemoved at 210-216, `INTERACTION_TIMEOUT_MS = 10*60*1000` at 42, `setTimeout` at 192 | EXACT |

### wallet-sdk background (`src/wallet/services/wallet-sdk/background.ts`)

| Plan claim | Master truth | Verdict |
|---|---|---|
| Fire-and-forget `chrome.windows.create` at line 135 | `chrome.windows.create({` at 135, no `onRemoved`, no timeout | EXACT |

### Chrome adapter (`src/core/adapters/chrome-browser-api.ts`)

| Plan claim | Master truth | Verdict |
|---|---|---|
| `chrome.windows.*` wrapped at 162-180 | `ChromeWindowsAdapter` class spans **161-181** (`create` 162-165, `onRemoved` 167-176, `remove` 178-180) | OFF-BY-ONE. Inconsequential. |
| `WindowPort` exists at `src/core/ports/window-port.ts` | exists, interface `{create, onRemoved, remove}` at lines 23-32 | EXACT — with one caveat: adapter's `CreatedWindow.id` is `id?: number` (line 12) — **see section 2** |

### M2.4-b scope-caveat drift (important)

The plan says (line 210):
> PxeService's inline call site at **`pxe/service.ts:398`** is deferred to M2.3-a's ChainRuntime work

M2.3-a has already shipped (commits `2449d7e`, `cf85968`). `pxe/service.ts` no longer contains any `createAztecNodeClient` call (`grep -c` returns 0; file is now 338 LOC). The call moved to `src/wallet/services/pxe/chain-runtime.ts:53` inside `ProductionPxeFactory.createChainRuntime`.

`grep -rn createAztecNodeClient src/` today:
- `network/service.ts:89,210,252,280` — 4x (M2.4-b scope)
- `pxe/chain-runtime.ts:53` — 1x (`ProductionPxeFactory`, out of scope)

**Action**: M2.4-b's PR description should say *"chain-runtime.ts:53 inside `ProductionPxeFactory` is out of scope; that site is the PxeFactory seam shipped in M2.3-a."* Keeping the stale pxe/service.ts:398 reference will confuse reviewers.

---

## 2. Test-mock vs runtime-reality pitfalls

The `deriveMasterSecret: Fr → Buffer<ArrayBuffer>` lesson applies sharply to two of the six M2.4 collaborators.

### BalanceRepository
Tests will pass `FakeBrowserApi` and assert storage reads/writes. The repo talks to `EntityStorage<TokenBalanceRaw>` only — TokenBalanceRaw is a plain interface shape. **Low risk.** Pitfall: `EntityStorage` serialises via `JSON.stringify`, so if a `TokenBalanceRaw` later accrued a BigInt or Buffer field, the round-trip would silently stringify it. No runtime-vs-declared gap today.

### BalanceProjector — **high-risk area**
Plan surface: `constructor(private readonly execution: ExecutionServiceClient)`. Two pitfalls:

1. **Wrong type.** `TokenBalanceService` calls `this.executionService.executeSimulateViews(...)` where `executionService` is typed `ExecutionService` (`service.ts:41` — the SW-side real implementation, not `ExecutionServiceClient`). TokenBalanceService is itself a Service in the SW; it reaches into another Service directly via `services.get(ExecutionService.name)` (`service.ts:56`). The plan's `ExecutionServiceClient` is incorrect — BalanceProjector should receive `ExecutionService`. **Fix in the plan before execution.**

2. **Return-shape of `executeSimulateViews`** (`execution/service.ts:687`): declared `Promise<{ encoded: Fr[][]; decoded: AbiDecoded[] }>`. At runtime inside the SW this is a real `Fr` class array (because BalanceProjector will call it in-process). But a test that fakes ExecutionService with `{ executeSimulateViews: async () => ({ encoded: [[{value: 0n}]], decoded: [] }) }` would pass TypeScript (structural typing: `Fr` is assignable to `{value: bigint}` in duck form) and never hit `viewFn.unpackResult(results.encoded[i])` (`service.ts:374`) — which internally calls `Fr` instance methods. Test authors must pass **actual** `Fr` instances (e.g. `new Fr(0n)` or `Fr.fromString(...)`), not POJOs, or else production code paths that do `fr.toBuffer()` / `fr.toString()` go untested.

   **Mitigation for the plan**: in `balance-projector.test.ts`, build fixtures with `Fr.random()` / `Fr.fromString()` rather than shape literals. Call this out in the test strategy explicitly.

### BalanceJobQueue
Surface takes FakeBackgroundTicker + repo + projector + `TaskServiceClient`. One pitfall: TaskServiceClient is a popup-side RPC client; but the SW-side code uses `TaskService` directly (`service.ts:42`). Same substitution bug as Projector. Also the plan is using a `TaskServiceClient`, fix to `TaskService`.

### BackgroundTickerPort
Test double drives ticks manually. Runtime wraps `ClockPort.setInterval` which is `globalThis.setInterval` (`system-clock.ts:26`). Pitfall: MV3 SW suspension silently kills `setInterval`; the test fake wouldn't model that. Since the port JSDoc already disclaims persistence across SW suspension, this is **documented, not a test-mock bug** — but worth a single test case asserting that a subscription handle becomes no-op after an explicit `cancel()`.

### NodeFactory — **highest-risk area**
Return type is `AztecNode`, a pure interface. Production returns a `createSafeJsonRpcClient(...)` proxy (`@aztec/stdlib/dest/interfaces/aztec-node.js:100`), so the real node rejects unknown methods, validates params against `AztecNodeApiSchema`, and throws marshalled JSON-RPC errors. A test `FakeNodeFactory` returning a POJO `{ getNodeInfo: async () => ({l1ChainId: 1, rollupVersion: 1}) }` satisfies the interface trivially — this is exactly the `deriveMasterSecret: Promise<Fr>` lie at a different layer. Units will go green; any code path that relies on the proxy's error surface (e.g. `getChainId`'s catch block at `network/service.ts:286`) won't be exercised.

Also: `makeFetchWithTimeout()` is hardcoded in all 4 prod sites. NodeFactory adapter must pass it identically, or timeouts change silently. Put it in the adapter ctor and never expose an override path.

### WindowManager
Pitfall #1 — `CreatedWindow.id` is optional (`window-port.ts:12: id?: number`) because `chrome.windows.create` may resolve with a window whose `.id` is `undefined` (closed-before-assignment, user-cancelled, browser teardown). The real PasskeyService already handles this at `passkey/service.ts:86` (`createdWindow.id == null` → fail). If WindowManager's `openAndAwait` returns `windowId: Promise<number | undefined>` as the plan shows (line 282), consumers MUST handle the undefined branch. A test that mocks `WindowPort.create` to always return `{id: 1}` won't catch consumers that forget.

Pitfall #2 — `onRemoved` fires globally for ALL windows, not just yours. Real adapter at `chrome-browser-api.ts:167-176` passes the listener through untouched. WindowManager must filter by windowId inside. The plan's surface is fine but the test fixture needs to drive `onRemoved(otherWindowId)` to assert no spurious settle.

---

## 3. Cross-cuts with M2.1/M2.2/M2.3 shipped work

### M2.3-c (ensureOffscreenRunning hoist into offscreen ServiceClient)
Grepped `wallet/base/offscreen/client.ts` — hoist is **offscreen-side only** (line 3, 98-113). `ExecutionServiceClient` imports `ServiceClient from "@/wallet/base/background"` (execution/client.ts:2), not offscreen. And TokenBalanceService talks to `ExecutionService` directly (in-process, same SW). **No interaction with M2.4-a.** Section 2's note about the plan saying `ExecutionServiceClient` is orthogonal — that's a plan typo, not an M2.3-c bleed.

### M2.3-a (`PxeFactory` in `chain-runtime.ts`) vs M2.4-b `NodeFactory`
Both exist; no symbol collision. But there is a conceptual overlap worth calling out in the PR description:

- `PxeFactory.createChainRuntime(network)` — constructs both node + PXE (chain-runtime.ts:51-63)
- `NodeFactory.createNode(rpcUrl)` — constructs node only

`PxeFactory`'s `ProductionPxeFactory` *itself* calls `createAztecNodeClient` inline at `chain-runtime.ts:53`. Post-M2.4-b the cleanest picture has `ProductionPxeFactory` also consume `NodeFactory` instead of calling `createAztecNodeClient` directly. **The plan does not mention this.** Decision points:
- Option A (plan as-written): leave `ProductionPxeFactory` untouched, document 1 remaining createAztecNodeClient call site as out-of-scope.
- Option B (small extension): inject `NodeFactory` into `ProductionPxeFactory` in M2.4-b, unifying node creation.

Recommend Option B — it adds maybe 10 LOC to M2.4-b and eliminates the last `createAztecNodeClient` callsite, which makes the "NodeFactory is the only way to build an AztecNode" invariant enforceable via lint.

### M2.3-d (ReadWriteGuard + drain-on-write) vs BalanceJobQueue
PxeService has `ReadWriteGuard` at `pxe/service.ts:50`. NetworkService uses a plain `Lock` (`network/service.ts:26`). TokenBalanceService has no guard at all today — the continuous loop just checks `this.profile` at each iteration (service.ts:235).

Post-M2.4-a: `BalanceJobQueue.clear()` is called on profile switch (by the facade's `onActiveProfileChanged` handler). If a `projector.project(...)` call is in-flight when `clear()` fires, the in-flight result still returns, and the facade still writes `this.balances.set(id, tb)` at `syncBatch` line 396 — **for the old account, under the new profile**. This race exists TODAY with the sleep-loop too (the plan's risk-register #7 tangentially notes it), and M2.4-a doesn't make it worse, but the plan's "preserves semantics verbatim" line is technically true while being uninformative about this stale-write window.

**Recommendation**: keep M2.4-a as scoped, but in the PR description explicitly note "no new guard, same pre-existing stale-write window on profile switch during in-flight batch" rather than claiming invariance.

### M2.2-f (GasBalanceCache) vs BalanceProjector
Grep shows GasBalanceCache was NOT extracted into a separate class — it lives inline in `execution/service.ts:163, 209-221, 909, 995` and the M2.2-f comment at `execution-coordinator.ts:23` actually says *"Fold in GasBalanceCache (codex flagged: facade-owned, coordinator-dependent)"*. The plan's entry-state says "gas cache extracted in M2.2-f" — **inaccurate but irrelevant**: BalanceProjector only calls `executeSimulateViews`, not `getGasBalances`. No real interaction.

---

## 4. Port/adapter inventory

| Port | File | Exists? | Surface matches plan? |
|---|---|---|---|
| `ClockPort` | `src/core/ports/clock-port.ts` | Yes | `now/sleep/setTimeout/setInterval` present (lines 10-24). BackgroundTickerPort subscribes to intervals; `ClockPort.setInterval` gives raw non-serialised callback. Distinct contracts — no duplication. |
| `BrowserApi` | `src/core/ports/browser-api.ts` | Yes | Facade at lines 13-18 with storage/runtime/windows/alarms. Matches plan. |
| `WindowPort` | `src/core/ports/window-port.ts` | Yes | `create/onRemoved/remove` at 23-32. Matches plan. Also unused today — `PasskeyService` and `DappInteractionService` still call `chrome.windows.*` directly — confirmed by `grep chrome.windows src/wallet/services/`. |
| `AlarmsPort` | `src/core/ports/alarms-port.ts` | Yes | `create/clear/onAlarm` at 28-37. Zero consumers today (`grep AlarmsPort src/wallet/services/` → zero hits). Plan claim stands. |
| `BackgroundTickerPort` | — | **Does NOT exist.** Correct per plan. |
| `NodeFactory` | — | **Does NOT exist.** Correct per plan. |

`BackgroundTickerPort` vs `ClockPort.setInterval`: the plan already justifies this well (serialized + coalescing). `ClockPort.setInterval` would silently allow re-entrance on slow ticks. Not duplicative — a true superset.

---

## 5. Profile-switch semantics

TokenBalanceService's `onActiveProfileChanged` (service.ts:148-156) — re-read today:

```ts
private readonly onActiveProfileChanged = async (profile?: ProfileInfo) => {
    this.profile = profile
    if (profile) {
        this.tokens.clear()
        for (const token of await this.tokenService.getTokensRaw(profile.id)) {
            this.tokens.set(token.id, token)
        }
    }
}
```

Confirmed: **only `this.tokens` (the in-memory metadata map) is cleared + repopulated.** `this.balances` (persistent storage, keyed by numeric id) is untouched. `this.queue` (in-mem queue of pending refreshes) is untouched. `this.pendingTasks` untouched. Plan claim at entry state is accurate.

**Race window** — assume profile switches from A to B at the exact moment a `syncBatch` for an A-account token balance is running:
- `syncBatch` on entry already read `this.tokens` for chainId lookup (service.ts:285)
- `syncBatch` then awaits `networkService.getNetworks(chainId)` — NetworkService's `getNetworks` filters by the **current** profile (network/service.ts:104). If profile changed mid-await, the filter now returns B's networks for B's profile. If A's chainId isn't in B's networks, `syncBatch` throws "Failed to find network" (service.ts:364) and the task fails. Balance data is NOT overwritten in storage in that branch (the throw short-circuits before `this.balances.set`).
- If A's chainId IS in B's networks (common for default chains), the RPC call fires against B's network for A's balance — wrong result silently written to storage for the balance id.

This race is PRE-EXISTING. M2.4-a shouldn't fix it but shouldn't reify it either. The plan's preservation claim is accurate. Flag for M3 follow-up: the queue's items should carry a profileId, and the facade should drop items whose profileId != active on dequeue.

---

## 6. WindowManager blast radius

PasskeyRecoveryCoordinator (`profile/passkey-recovery-coordinator.ts`) calls:
- `this.passkeys.createKey(profileId)` → line 63, 77, 90, 110
- `this.passkeys.getKey(credentialId)` → line 77, 110
- `this.passkeys.getKey()` → line 90

Each result is a `PasskeyCredential`. Only `deriveMasterSecret()`, `id`, `userHandle` are consumed. `PasskeyRecovery.secret` type is `Buffer<ArrayBuffer>` (credential.ts:33, tests at passkey-recovery-coordinator.test.ts:34, 55, 85, 104, 122, 136). M2.4-c's WindowManager sits **below** PasskeyService — the passkey credential shape is unchanged by moving window lifetime into WindowManager. Coordinator contract is preserved.

M2.4-c's design talks about `PasskeyCredential` resolution via `windowManager.settle(handle.handleId, creds)`. This is the popup → SW path — the popup's `resolvePasskeyRequest(requestId, creds)` RPC today (passkey/service.ts:40-47) would need to map `requestId` to `handleId`. The plan's consumer-refactor pattern on line 306-316 glosses this; in practice PasskeyService will still own `resolvePasskeyRequest` as the RPC endpoint and forward to `windowManager.settle`. That's fine, but the plan should say so (risk #3 hints at it).

**Nothing in the M2.4-c design assumes the old `PasskeyRecovery.secret: Fr` shape.** The secret doesn't pass through WindowManager at all.

---

## 7. Surprising things encountered

1. **Plan typo: `ExecutionServiceClient`** in BalanceProjector ctor (plan line 126) should be `ExecutionService`. `TaskServiceClient` in BalanceJobQueue ctor (plan line 146) should be `TaskService`. Both are SW-internal direct-service handles. Fix before coding.

2. **5th `createAztecNodeClient` call site** at `src/wallet/services/pxe/chain-runtime.ts:53` inside `ProductionPxeFactory`. Plan's M2.4-b scope caveat references `pxe/service.ts:398` which no longer exists. Update the caveat — and consider injecting NodeFactory into `ProductionPxeFactory` so all createAztecNodeClient calls funnel through one seam (see section 3).

3. **GasBalanceCache was not actually extracted** in M2.2-f — it lives inline in `execution/service.ts:163, 209-221, 909, 995`. Plan's entry-state claim is wrong but doesn't change M2.4-a scope.

4. **WindowPort's docstring** (`window-port.ts:2-6`) already mentions a future WindowManager — but at **M3.5**, not M2.4. Update the docstring when M2.4-c ships to reflect actual version.

5. **Chrome adapter for WindowPort** has a `@types/chrome` version workaround at `chrome-browser-api.ts:170-173` (`as unknown as` cast on `onRemoved.addListener`). Any test FakeWindowPort should model the same 1-arg listener signature; don't accidentally model the filter-param overload.

6. **Queue enqueue dedup today** uses `this.queue.priorityPass(balance)` (service.ts:113) — a custom `Queue` util. The `BalanceJobQueue` interface says "Dedup via per-id pendingTasks map" but the real dedup happens inside `Queue.priorityPass` (by key fn `(x) => x.id`). The surface contract in plan line 154 is imprecise — both the `Queue.priorityPass` dedup AND the `pendingTasks` per-id TaskService dedup must be preserved. Two different dedup layers, both needed (one prevents double-sync, the other prevents double-task-record).

7. **PasskeyService pseudocode in plan (line 290-300) is wrong about structure.** Real impl uses the callback form of `chrome.windows.create(opts, callback)` — not `await chrome.windows.create(...)`. Post-M2.4-c the WindowManager can use the promise form (since `WindowPort.create` returns `Promise<CreatedWindow>`), but this IS a behaviour change: the real callback-form clears `chrome.runtime.lastError` inside the callback (passkey/service.ts:85). The promise-form-based WindowPort adapter doesn't handle `lastError` (`chrome-browser-api.ts:162-165`). In practice `chrome.windows.create` as a promise rejects on failure, so this is fine — but verify the adapter throws appropriately on the "window creation failed" branch during M2.4-c implementation.

---

## TL;DR — changes the plan should absorb before execution

1. **Fix ctor types**: BalanceProjector takes `ExecutionService`, not `ExecutionServiceClient`. BalanceJobQueue takes `TaskService`, not `TaskServiceClient`.
2. **Fix stale scope caveat in M2.4-b**: the deferred createAztecNodeClient site is `pxe/chain-runtime.ts:53`, not `pxe/service.ts:398`. Consider extending M2.4-b to inject NodeFactory into `ProductionPxeFactory` and eliminate the last call site.
3. **Correct GasBalanceCache entry-state claim** (it wasn't extracted) — or just drop the sentence; nothing in M2.4-a depends on it.
4. **Test-fixture warnings** in M2.4-a test strategy: use real `Fr` instances in BalanceProjector tests (don't let duck-typing let POJOs satisfy `Fr[][]`). In M2.4-b FakeNodeFactory tests: be aware that a POJO fake never exercises the real JSON-RPC proxy error surface.
5. **Test a spurious-onRemoved case** in WindowManager tests — the listener fires for all windows, not just ours.
6. **PR description for M2.4-a** should explicitly note "no new guard; pre-existing stale-write-on-profile-switch window is preserved, not fixed." Don't claim full invariance.
7. **WindowPort docstring** still references `M3.5` for the manager extraction — update to M2.4-c.

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/utils/queue.ts | sed -n '1,220p'" in (project root)
 succeeded in 0ms:
     1	export class Queue<TKey, TValue> {
     2		private readonly items: TValue[] = []
     3		private readonly keys: Set<TKey> = new Set()
     4	
     5		constructor(private readonly key: (item: TValue) => TKey) {}
     6	
     7		public get length(): number {
     8			return this.items.length
     9		}
    10	
    11		public clear() {
    12			this.items.splice(0, this.items.length)
    13			this.keys.clear()
    14		}
    15	
    16		public enqueue(item: TValue) {
    17			const key = this.key(item)
    18			if (this.keys.has(key)) {
    19				return
    20			}
    21			this.keys.add(key)
    22			this.items.push(item)
    23		}
    24	
    25		public priorityPass(item: TValue) {
    26			const key = this.key(item)
    27			if (this.keys.has(key)) {
    28				this.items.splice(
    29					this.items.findIndex((x) => this.key(x) === key),
    30					1,
    31				)
    32			} else {
    33				this.keys.add(key)
    34			}
    35			this.items.unshift(item)
    36		}
    37	
    38		public dequeue(): TValue | undefined {
    39			if (!this.items.length) {
    40				return undefined
    41			}
    42			const item = this.items.shift()!
    43			this.keys.delete(this.key(item))
    44			return item
    45		}
    46	
    47		public dequeueBatch(size: number): TValue[] {
    48			const res = []
    49			while (size-- > 0) {
    50				const item = this.dequeue()
    51				if (!item) break
    52				res.push(item)
    53			}
    54			return res
    55		}
    56	
    57		public peek(): TValue | undefined {
    58			return this.items.at(0)
    59		}
    60	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/core/adapters/system-clock.ts | sed -n '1,220p'" in (project root)
 succeeded in 0ms:
     1	/**
     2	 * Real-clock implementation of ClockPort. Wraps Date.now and the global
     3	 * timer functions. Tests substitute MockClock (see src/core/testing/).
     4	 */
     5	
     6	import type { ClockPort, TimerHandle } from "@/core/ports"
     7	
     8	export class SystemClock implements ClockPort {
     9		public now(): number {
    10			return Date.now()
    11		}
    12	
    13		public sleep(ms: number): Promise<void> {
    14			return new Promise((resolve) => setTimeout(resolve, ms))
    15		}
    16	
    17		public setTimeout(fn: () => void, ms: number): TimerHandle {
    18			return globalThis.setTimeout(fn, ms)
    19		}
    20	
    21		public clearTimeout(handle: TimerHandle): void {
    22			globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0])
    23		}
    24	
    25		public setInterval(fn: () => void, ms: number): TimerHandle {
    26			return globalThis.setInterval(fn, ms)
    27		}
    28	
    29		public clearInterval(handle: TimerHandle): void {
    30			globalThis.clearInterval(handle as Parameters<typeof globalThis.clearInterval>[0])
    31		}
    32	}

exec
/bin/zsh -lc "rg -n \"constructor\\(logger: ILogger,|constructor\\(["'^)]*logger: ILogger[''^)]*," packages/extension/src/wallet/services packages/extension/src/core | sed -n '"'1,260p'" in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/services/operation-journal/service.ts:38:	public constructor(logger: ILogger, browserApi?: BrowserApi) {
packages/extension/src/wallet/services/contact/service.ts:35:	public constructor(logger: ILogger, browserApi?: BrowserApi) {
packages/extension/src/wallet/services/profile/service.ts:43:	public constructor(config: IConfig, logger: ILogger, browserApi?: BrowserApi) {

codex
I found a more serious `M2.4-a` issue than the stale-write race: the proposed `BalanceJobQueue.clear()` can introduce immortal pending tasks if it drops queued items without also cancelling their `TaskService` records. I’m checking the task lifecycle code now so I can cite it cleanly.
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/task/service.ts | sed -n '218,280p'" in (project root)
 succeeded in 0ms:
   218		private cleanupStaleTasks(): void {
   219			const now = Date.now()
   220			const isStale = (task: Task) => task.finishedAt && now - task.finishedAt > TASK_RETENTION_PERIOD_MS
   221			const staleRoots = this.getRootTasks().filter((task) => isStale(task))
   222	
   223			for (const root of staleRoots) {
   224				this.deleteTaskTree(root.id)
   225			}
   226		}
   227	
   228		private deleteTaskTree(taskId: string): void {
   229			const task = this.tasks.get(taskId)
   230			if (!task) return
   231	
   232			task.subtasks.forEach((child) => this.deleteTaskTree(child.id))
   233			this.tasks.delete(taskId)
   234			this.emit("onTaskDeleted", task)
   235		}
   236	
   237		private readonly onActiveProfileChanged = async (profile?: ProfileInfo) => {
   238			if (profile) {
   239				if (this.profile && this.profile !== profile.id) {
   240					this.tasks.clear()
   241					this.logDebug(`Tasks cleared for profile #${profile.id}`)
   242				}
   243				this.profile = profile.id
   244			}
   245		}
   246	}

codex
**Verdict**

`M2.4-b` and `M2.4-c` are close to execution-ready. `M2.4-a` is not. The direction is mostly reasonable, but the plan still underspecifies core runtime semantics of the balance worker, and a few “preserved behavior” claims are either stale or internally contradictory.

**Findings**

- **[High] `M2.4-a` does not pin the current worker semantics tightly enough, so the refactor can silently change throughput and freshness.** The current worker drains the queue until empty in one pass, grouping by first account and batching up to 12 before sleeping again; it does not do “one batch per second” ([plan.md]((project root)/implementations-plan/M2/4/plan.md:167), [plan.md]((project root)/implementations-plan/M2/4/plan.md:183), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:237), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:243)). `queue.tick()` is too vague. The plan needs to state explicitly: immediate-first-run or not, drain-until-empty or not, preserve account grouping or not.

- **[High] The plan contradicts itself on profile-switch behavior in `M2.4-a`.** Early on it says profile switch does not clear balances, queue, or re-enqueue anything, and that `M2.4-a` preserves that verbatim ([plan.md]((project root)/implementations-plan/M2/4/plan.md:23)). Later it introduces `BalanceJobQueue.clear()` “e.g. on profile switch” and risk #7 talks about “queue clear + re-enqueue” post-refactor ([plan.md]((project root)/implementations-plan/M2/4/plan.md:158), [plan.md]((project root)/implementations-plan/M2/4/plan.md:361)). Those cannot both be true. Decide whether profile-switch semantics are changing, then document that honestly.

- **[High] The pre-existing stale-write race is worse than the plan currently frames.** This is not just “timing could differ.” An in-flight `syncBatch` can cross a profile switch, resolve networks under the new active profile, and then write old balance rows with results computed against the new profile’s default network for that chain ([token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:361), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:396), [network/service.ts]((project root)/packages/extension/src/wallet/services/network/service.ts:97)). If `M2.4-a` is not fixing it, the plan should say “preserved known race” rather than “same ordering/invalidation” ([plan.md]((project root)/implementations-plan/M2/4/plan.md:60)).

- **[High] `M2.4-b` should almost certainly absorb `ProductionPxeFactory` too.** The plan scopes `NodeFactory` to `NetworkService`, but the remaining live `createAztecNodeClient(...)` call is now in `ProductionPxeFactory.createChainRuntime()` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:210), [chain-runtime.ts]((project root)/packages/extension/src/wallet/services/pxe/chain-runtime.ts:51)). Leaving that out means you ship two abstractions for “construct an AztecNode”: `NodeFactory` and `ProductionPxeFactory`’s inline constructor. That is duplicated policy, not clean separation.

- **[Medium] `BackgroundTickerPort` is probably over-abstracted as a core port.** The plan justifies it partly as future `chrome.alarms` swap space, but the same JSDoc also admits alarms are not swap-compatible for 1s cadence ([plan.md]((project root)/implementations-plan/M2/4/plan.md:91)). That makes the portability story weak. If this is only for token-balance and still fundamentally wraps `ClockPort.setInterval`, a local `SerializedIntervalRunner` or `CoalescingTicker` helper is cleaner than a new top-level core port.

- **[Medium] If `BackgroundTickerPort` stays, its failure semantics are underspecified.** The contract says serialized/coalescing/cancel, but not what happens when `onTick` throws or rejects, or when `cancel()` fires while a tick is running and another coalesced tick is pending ([plan.md]((project root)/implementations-plan/M2/4/plan.md:78)). For this use case the correct behavior is probably: log/swallow errors, clear `running`, drop any pending rerun if cancelled, and continue future ticks. If you do not spell that out, implementations and tests will drift.

- **[Medium] The plan’s `BalanceProjector` surface introduces a new under-specified precondition.** Today `syncBatch` derives chain/network from the queued balances’ tokens inside the same method ([token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:274), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:362)). The proposed `project(account, balances, network)` API pushes correctness up to the caller without encoding “all balances belong to that network” in types ([plan.md]((project root)/implementations-plan/M2/4/plan.md:131)). That is exactly the sort of test-friendly, runtime-fragile lie that already burned this repo once.

- **[Medium] The known type fixes from the verification agent are real and not cosmetic.** `BalanceProjector` should depend on `ExecutionService`, not `ExecutionServiceClient`, and `BalanceJobQueue` should depend on `TaskService`, not `TaskServiceClient` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:126), [plan.md]((project root)/implementations-plan/M2/4/plan.md:146), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:41), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:42)). These services run SW-local; using client types in the plan hides real runtime behavior and invites fake-friendly tests.

- **[Medium] `executeSimulateViews()` is a test-mock trap and the plan does not warn loudly enough.** At runtime, `BalanceProjector` will get real `Fr` instances in `encoded`, and current code immediately feeds them into `viewFn.unpackResult(...)` ([execution/service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:687), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:374)). A POJO fake can satisfy TypeScript and still miss the real runtime path. The test strategy should explicitly require real `Fr` fixtures.

- **[Medium] `NodeFactory` tests have the same fake-vs-runtime hazard.** `createAztecNodeClient(...)` returns a safe JSON-RPC proxy, not a dumb POJO. A fake `{ getNodeInfo() {} }` proves almost nothing about the real error surface that `NetworkService.getChainId()` depends on ([plan.md]((project root)/implementations-plan/M2/4/plan.md:196), [network/service.ts]((project root)/packages/extension/src/wallet/services/network/service.ts:278)). At minimum, the plan should call out that unit fakes will not exercise proxy validation/error translation.

- **[Medium] `WindowManager` as a plain class is the right cut, but its API is still too broad and slightly dishonest.** Saying only the caller holding `handleId` can settle is not really true if the popup URL must carry some correlator that ultimately reaches `settle()` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:260), [plan.md]((project root)/implementations-plan/M2/4/plan.md:312)). This is not a security boundary; it is a correlation ID. I would either reuse the service’s existing request/interaction ID, or keep handle correlation entirely internal and expose only `promise`, not `windowId: Promise<number | undefined>`.

- **[Medium] `WindowManager` needs stricter edge-case requirements than the plan currently lists.** It must filter global `onRemoved` events, treat `id == null` as failure, make settle-after-timeout and double-settle true no-ops, and decide whether timeout/cancel should also attempt `windows.remove(windowId)` ([window-port.ts]((project root)/packages/extension/src/core/ports/window-port.ts:23), [chrome-browser-api.ts]((project root)/packages/extension/src/core/adapters/chrome-browser-api.ts:167), [passkey/service.ts]((project root)/packages/extension/src/wallet/services/passkey/service.ts:86), [dapp-interaction/service.ts]((project root)/packages/extension/src/wallet/services/dapp-interaction/service.ts:204)). Also, `DappInteractionService` currently uses a truthy check for `createdWindow?.id`; the extracted manager should normalize to the passkey variant’s nullish check.

- **[Medium] The balance queue semantics currently rely on two different dedup layers, and the plan only documents one.** `pendingTasks` dedups task records, but sync dedup/priority bumping currently comes from `Queue.priorityPass()` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:154), [queue.ts]((project root)/packages/extension/src/wallet/utils/queue.ts:25), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:108)). If `BalanceJobQueue` preserves only one of those, behavior changes.

- **[Low] Some plan facts are just wrong/stale and should be cleaned before execution.** `GasBalanceCache` was not extracted; it is still inline in `ExecutionService` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:52), [execution/service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:163)). `window-port.ts` still says M3.5 for WindowManager extraction ([window-port.ts]((project root)/packages/extension/src/core/ports/window-port.ts:2)). The invariant “same TTL” for token balances is bogus; this service does not have a TTL concept ([plan.md]((project root)/implementations-plan/M2/4/plan.md:58)).

**Architecture**

`M2.4-b`: extend it to `ProductionPxeFactory` now. Otherwise you are institutionalizing duplicated node-construction policy for no benefit.

`M2.4-c`: plain class is correct. Making it a `Service<Methods>` would create a fake RPC boundary and more surface than the system needs.

`M2.4-a`: I would simplify unless there is a strong reason to reuse the ticker elsewhere. The cleanest minimum-change split is:
1. `BalanceRepository`
2. `BalanceWorker` or `BalanceCoordinator` owning queue + projector + task lifecycle + timer

`BalanceProjector` is only justified if it owns all of `syncBatch`’s call-building/result-mapping logic without pushing network/token invariants into callers. `BackgroundTickerPort` is only justified if you truly want a reusable, generic serialized periodic-work boundary. Right now it reads more like a local helper elevated into a port.

**Execution Order**

`b -> a -> QA gate -> c` is sane. `b` is the smallest and least risky. `a` is the hardest and most likely to hide logic regressions. `c` is user-facing and easier to isolate once the queue refactor is stable.

I would add one more explicit gate after `c`. A QA gate before `c` does not reduce popup regression risk inside `c`; it only protects the arc from carrying `a` instability into it.

**Test Cadence**

Claude’s cadence is too blunt.

`M2.4-b`: unit + smoke + network suite. This one actually touches live RPC node creation and deserves the network pass.

`M2.4-a`: strong unit coverage plus smoke, plus targeted manual/network validation of balance refresh behavior. Full network suite after every revision is probably low-signal unless you have specific token-balance network scenarios in it.

`M2.4-c`: unit + smoke, but heavier manual browser QA than the others. Popup timing, close behavior, and suspension races are exactly where unit tests under-model reality.

**Bottom Line**

I would not ship the plan as-is. I would rewrite `M2.4-a` to lock down exact worker semantics, fix the profile-switch contradiction, and either demote `BackgroundTickerPort` to a local helper or justify it much better. `M2.4-b` should absorb `ProductionPxeFactory`. `M2.4-c` is directionally solid, but its API should be tightened and its edge cases specified more aggressively.
tokens used
108,350
**Verdict**

`M2.4-b` and `M2.4-c` are close to execution-ready. `M2.4-a` is not. The direction is mostly reasonable, but the plan still underspecifies core runtime semantics of the balance worker, and a few “preserved behavior” claims are either stale or internally contradictory.

**Findings**

- **[High] `M2.4-a` does not pin the current worker semantics tightly enough, so the refactor can silently change throughput and freshness.** The current worker drains the queue until empty in one pass, grouping by first account and batching up to 12 before sleeping again; it does not do “one batch per second” ([plan.md]((project root)/implementations-plan/M2/4/plan.md:167), [plan.md]((project root)/implementations-plan/M2/4/plan.md:183), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:237), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:243)). `queue.tick()` is too vague. The plan needs to state explicitly: immediate-first-run or not, drain-until-empty or not, preserve account grouping or not.

- **[High] The plan contradicts itself on profile-switch behavior in `M2.4-a`.** Early on it says profile switch does not clear balances, queue, or re-enqueue anything, and that `M2.4-a` preserves that verbatim ([plan.md]((project root)/implementations-plan/M2/4/plan.md:23)). Later it introduces `BalanceJobQueue.clear()` “e.g. on profile switch” and risk #7 talks about “queue clear + re-enqueue” post-refactor ([plan.md]((project root)/implementations-plan/M2/4/plan.md:158), [plan.md]((project root)/implementations-plan/M2/4/plan.md:361)). Those cannot both be true. Decide whether profile-switch semantics are changing, then document that honestly.

- **[High] The pre-existing stale-write race is worse than the plan currently frames.** This is not just “timing could differ.” An in-flight `syncBatch` can cross a profile switch, resolve networks under the new active profile, and then write old balance rows with results computed against the new profile’s default network for that chain ([token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:361), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:396), [network/service.ts]((project root)/packages/extension/src/wallet/services/network/service.ts:97)). If `M2.4-a` is not fixing it, the plan should say “preserved known race” rather than “same ordering/invalidation” ([plan.md]((project root)/implementations-plan/M2/4/plan.md:60)).

- **[High] `M2.4-b` should almost certainly absorb `ProductionPxeFactory` too.** The plan scopes `NodeFactory` to `NetworkService`, but the remaining live `createAztecNodeClient(...)` call is now in `ProductionPxeFactory.createChainRuntime()` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:210), [chain-runtime.ts]((project root)/packages/extension/src/wallet/services/pxe/chain-runtime.ts:51)). Leaving that out means you ship two abstractions for “construct an AztecNode”: `NodeFactory` and `ProductionPxeFactory`’s inline constructor. That is duplicated policy, not clean separation.

- **[Medium] `BackgroundTickerPort` is probably over-abstracted as a core port.** The plan justifies it partly as future `chrome.alarms` swap space, but the same JSDoc also admits alarms are not swap-compatible for 1s cadence ([plan.md]((project root)/implementations-plan/M2/4/plan.md:91)). That makes the portability story weak. If this is only for token-balance and still fundamentally wraps `ClockPort.setInterval`, a local `SerializedIntervalRunner` or `CoalescingTicker` helper is cleaner than a new top-level core port.

- **[Medium] If `BackgroundTickerPort` stays, its failure semantics are underspecified.** The contract says serialized/coalescing/cancel, but not what happens when `onTick` throws or rejects, or when `cancel()` fires while a tick is running and another coalesced tick is pending ([plan.md]((project root)/implementations-plan/M2/4/plan.md:78)). For this use case the correct behavior is probably: log/swallow errors, clear `running`, drop any pending rerun if cancelled, and continue future ticks. If you do not spell that out, implementations and tests will drift.

- **[Medium] The plan’s `BalanceProjector` surface introduces a new under-specified precondition.** Today `syncBatch` derives chain/network from the queued balances’ tokens inside the same method ([token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:274), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:362)). The proposed `project(account, balances, network)` API pushes correctness up to the caller without encoding “all balances belong to that network” in types ([plan.md]((project root)/implementations-plan/M2/4/plan.md:131)). That is exactly the sort of test-friendly, runtime-fragile lie that already burned this repo once.

- **[Medium] The known type fixes from the verification agent are real and not cosmetic.** `BalanceProjector` should depend on `ExecutionService`, not `ExecutionServiceClient`, and `BalanceJobQueue` should depend on `TaskService`, not `TaskServiceClient` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:126), [plan.md]((project root)/implementations-plan/M2/4/plan.md:146), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:41), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:42)). These services run SW-local; using client types in the plan hides real runtime behavior and invites fake-friendly tests.

- **[Medium] `executeSimulateViews()` is a test-mock trap and the plan does not warn loudly enough.** At runtime, `BalanceProjector` will get real `Fr` instances in `encoded`, and current code immediately feeds them into `viewFn.unpackResult(...)` ([execution/service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:687), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:374)). A POJO fake can satisfy TypeScript and still miss the real runtime path. The test strategy should explicitly require real `Fr` fixtures.

- **[Medium] `NodeFactory` tests have the same fake-vs-runtime hazard.** `createAztecNodeClient(...)` returns a safe JSON-RPC proxy, not a dumb POJO. A fake `{ getNodeInfo() {} }` proves almost nothing about the real error surface that `NetworkService.getChainId()` depends on ([plan.md]((project root)/implementations-plan/M2/4/plan.md:196), [network/service.ts]((project root)/packages/extension/src/wallet/services/network/service.ts:278)). At minimum, the plan should call out that unit fakes will not exercise proxy validation/error translation.

- **[Medium] `WindowManager` as a plain class is the right cut, but its API is still too broad and slightly dishonest.** Saying only the caller holding `handleId` can settle is not really true if the popup URL must carry some correlator that ultimately reaches `settle()` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:260), [plan.md]((project root)/implementations-plan/M2/4/plan.md:312)). This is not a security boundary; it is a correlation ID. I would either reuse the service’s existing request/interaction ID, or keep handle correlation entirely internal and expose only `promise`, not `windowId: Promise<number | undefined>`.

- **[Medium] `WindowManager` needs stricter edge-case requirements than the plan currently lists.** It must filter global `onRemoved` events, treat `id == null` as failure, make settle-after-timeout and double-settle true no-ops, and decide whether timeout/cancel should also attempt `windows.remove(windowId)` ([window-port.ts]((project root)/packages/extension/src/core/ports/window-port.ts:23), [chrome-browser-api.ts]((project root)/packages/extension/src/core/adapters/chrome-browser-api.ts:167), [passkey/service.ts]((project root)/packages/extension/src/wallet/services/passkey/service.ts:86), [dapp-interaction/service.ts]((project root)/packages/extension/src/wallet/services/dapp-interaction/service.ts:204)). Also, `DappInteractionService` currently uses a truthy check for `createdWindow?.id`; the extracted manager should normalize to the passkey variant’s nullish check.

- **[Medium] The balance queue semantics currently rely on two different dedup layers, and the plan only documents one.** `pendingTasks` dedups task records, but sync dedup/priority bumping currently comes from `Queue.priorityPass()` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:154), [queue.ts]((project root)/packages/extension/src/wallet/utils/queue.ts:25), [token-balance/service.ts]((project root)/packages/extension/src/wallet/services/token-balance/service.ts:108)). If `BalanceJobQueue` preserves only one of those, behavior changes.

- **[Low] Some plan facts are just wrong/stale and should be cleaned before execution.** `GasBalanceCache` was not extracted; it is still inline in `ExecutionService` ([plan.md]((project root)/implementations-plan/M2/4/plan.md:52), [execution/service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:163)). `window-port.ts` still says M3.5 for WindowManager extraction ([window-port.ts]((project root)/packages/extension/src/core/ports/window-port.ts:2)). The invariant “same TTL” for token balances is bogus; this service does not have a TTL concept ([plan.md]((project root)/implementations-plan/M2/4/plan.md:58)).

**Architecture**

`M2.4-b`: extend it to `ProductionPxeFactory` now. Otherwise you are institutionalizing duplicated node-construction policy for no benefit.

`M2.4-c`: plain class is correct. Making it a `Service<Methods>` would create a fake RPC boundary and more surface than the system needs.

`M2.4-a`: I would simplify unless there is a strong reason to reuse the ticker elsewhere. The cleanest minimum-change split is:
1. `BalanceRepository`
2. `BalanceWorker` or `BalanceCoordinator` owning queue + projector + task lifecycle + timer

`BalanceProjector` is only justified if it owns all of `syncBatch`’s call-building/result-mapping logic without pushing network/token invariants into callers. `BackgroundTickerPort` is only justified if you truly want a reusable, generic serialized periodic-work boundary. Right now it reads more like a local helper elevated into a port.

**Execution Order**

`b -> a -> QA gate -> c` is sane. `b` is the smallest and least risky. `a` is the hardest and most likely to hide logic regressions. `c` is user-facing and easier to isolate once the queue refactor is stable.

I would add one more explicit gate after `c`. A QA gate before `c` does not reduce popup regression risk inside `c`; it only protects the arc from carrying `a` instability into it.

**Test Cadence**

Claude’s cadence is too blunt.

`M2.4-b`: unit + smoke + network suite. This one actually touches live RPC node creation and deserves the network pass.

`M2.4-a`: strong unit coverage plus smoke, plus targeted manual/network validation of balance refresh behavior. Full network suite after every revision is probably low-signal unless you have specific token-balance network scenarios in it.

`M2.4-c`: unit + smoke, but heavier manual browser QA than the others. Popup timing, close behavior, and suspension races are exactly where unit tests under-model reality.

**Bottom Line**

I would not ship the plan as-is. I would rewrite `M2.4-a` to lock down exact worker semantics, fix the profile-switch contradiction, and either demote `BackgroundTickerPort` to a local helper or justify it much better. `M2.4-b` should absorb `ProductionPxeFactory`. `M2.4-c` is directionally solid, but its API should be tightened and its edge cases specified more aggressively.
