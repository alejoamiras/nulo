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
