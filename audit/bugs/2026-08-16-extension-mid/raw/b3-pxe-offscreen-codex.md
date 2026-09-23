<!-- codex session 01a00a8c-049f-7830-b928-f7eae34771d9 -->

### Finding: Chain purge can be followed by resurrection from an operation entering during the erase

1. **Title:** Chain purge can be followed by resurrection from an operation entering during the erase
2. **Severity:** Major
3. **Repro confidence:** High
4. **Type:** Race; secondary: state invariant violation
5. **Counter-example:** Runtime `(profile=p1, chain=31337)` exists. `clearChainState("p1", 31337)` acquires the chain write guard and increments the purge epoch from 0 to 1. While it is disposing/removing the store, an operation using previously obtained `NetworkInfo` calls `withPxeWrite`. It captures epoch 1 and waits on the same guard. The purge removes the runtime/store and returns; the waiting operation observes epoch 1, passes the equality check, and `registry.ensure()` recreates the runtime and OPFS directory. The network deletion then reports success even though PXE state has been resurrected.
6. **Violated invariant:** `clearChainState` promises to dispose the runtime and delete the chain’s persisted state. The service’s own comment says an operation overlapping the purge must not recreate “a fresh OPFS store dir for a chain whose network row is gone.”
7. **Failing path:** `PxeService.clearChainState` increments the epoch before its awaited cleanup at `packages/aztec-runtime/src/pxe/service.ts:626-644` → the concurrent operation captures that already-incremented epoch in `withPxeWrite` at `service.ts:875-879` → after the purge releases the guard, the epoch comparison succeeds at `service.ts:883-890` → `ChainRuntimeRegistry.ensure` creates and records a fresh runtime at `packages/aztec-runtime/src/pxe/chain-runtime.ts:304-314` → `ProductionPxeFactory.createChainRuntime` opens/recreates the store at `chain-runtime.ts:140-169`.
8. **Expected vs actual behavior:** Expected: every operation whose execution overlaps a chain purge is rejected, leaving no runtime or persisted directory after the purge. Actual: an operation entering after the initial epoch bump but before cleanup completes is classified as post-purge and recreates both.
9. **Recommended fix:** Advance the epoch again at the end of the destructive section, immediately before releasing the chain write guard. Equivalently, maintain an explicit `purging` state and reject captures made while it is set. A terminal epoch bump is the smallest change: queued operations that captured either the pre-purge or in-progress epoch will then fail, while calls genuinely starting after `clearChainState` resolves capture the stable final epoch.
10. **Instances:** `packages/aztec-runtime/src/pxe/service.ts:626-644`, `packages/aztec-runtime/src/pxe/service.ts:828-848`, `packages/aztec-runtime/src/pxe/service.ts:875-893`.

### Finding: OPFS timeout abandons a live worker when initialization never settles

1. **Title:** OPFS timeout abandons a live worker when initialization never settles
2. **Severity:** Major
3. **Repro confidence:** High
4. **Type:** Resource leak; secondary: bad retry-or-timeout
5. **Counter-example:** `AztecSQLiteOPFSStore.open()` creates its worker but the worker’s init protocol never resolves or rejects—for example, the documented silent WASM-load failure. At 30 seconds, `openChainStore` rejects its caller. Its cleanup is only `openPromise.then(store => store.close())`; since `openPromise` never settles, the worker is never closed or terminated. Retrying the wallet action starts another worker and repeats the leak. If the first worker acquired the SAH-pool lock before stalling, later opens and purge also remain blocked.
6. **Violated invariant:** The timeout is documented as converting a silent worker hang into a “recoverable” error and preventing a permanent SAH-pool wedge. A timeout must cancel or otherwise dispose the operation it abandons.
7. **Failing path:** `PxeService.withPxeWrite` requests a runtime at `packages/aztec-runtime/src/pxe/service.ts:875-893` → `ChainRuntimeRegistry.ensure` calls the factory without retaining a failed runtime at `packages/aztec-runtime/src/pxe/chain-runtime.ts:304-314` → `ProductionPxeFactory.createChainRuntime` calls `openChainStore` at `chain-runtime.ts:140-163` → `openChainStore` times out at `packages/aztec-runtime/src/pxe/opfs-store.ts:68-80` → the cleanup at `opfs-store.ts:81-92` runs only if the original open promise eventually settles.
8. **Expected vs actual behavior:** Expected: after the 30-second error, no abandoned worker or exclusive directory lock remains, and a retry starts from clean state. Actual: a never-settling open leaves an unreachable worker alive; retries can accumulate workers and the chain can remain unusable for the offscreen document’s lifetime.
9. **Recommended fix:** Make the underlying open operation cancellable. Add an `AbortSignal`/timeout facility to `AztecSQLiteOPFSStore.open` that terminates its worker and rejects pending init, then invoke it from this timeout. If the dependency cannot be changed immediately, move the timeout into a local/open wrapper that owns the `Worker`; merely attaching a fulfillment handler cannot clean up a never-settling promise.
10. **Instances:** `packages/aztec-runtime/src/pxe/opfs-store.ts:68-92`.

### Finding: Health checks treat an initializing offscreen document as ready for PXE RPC

1. **Title:** Health checks treat an initializing offscreen document as ready for PXE RPC
2. **Severity:** Major
3. **Repro confidence:** High
4. **Type:** State invariant violation; secondary: bad error path
5. **Counter-example:** The offscreen page loads and immediately installs its PING listener, then spends several seconds in `createPxeOffscreen`. Before service startup completes, the service worker restarts. A PXE request in the new worker calls `ensureOffscreenRunning`; `getContexts` finds the existing page, its early listener returns PONG, and the ensure call returns successfully. The client then sends the PXE RPC even though `PxeService` has not yet been registered, producing a missing-handler failure or transport timeout.
6. **Violated invariant:** `PxeServiceClient.onReady` promises that the offscreen transport/service is live before every request. The READY handshake is explicitly supposed to occur only after `createPxeOffscreen` completes.
7. **Failing path:** The page registers PING/PONG before initialization at `apps/extension/src/offscreen/index.ts:12-19` → PXE service initialization remains pending at `index.ts:91-112` → `PxeServiceClient.onReady` calls `ensureOffscreenRunning` at `apps/extension/src/wallet/services/pxe/client.ts:38-45` → `doEnsureOffscreenRunning` accepts any PONG as success at `apps/extension/src/wallet/utils/offscreen.ts:292-300` → the caller proceeds without observing `OFFSCREEN_READY`, which is not sent until `index.ts:113-116`.
8. **Expected vs actual behavior:** Expected: an existing document is adopted only once its PXE services are initialized. Actual: document liveness is mistaken for service readiness, so requests can be routed into a partially initialized page.
9. **Recommended fix:** Make the health response readiness-aware. Keep an offscreen-local `servicesReady` flag that becomes true only after `createPxeOffscreen` resolves, and either withhold PONG until then or return a structured response distinguishing `initializing` from `ready`. `ensureOffscreenRunning` must require the ready state before returning.
10. **Instances:** `apps/extension/src/offscreen/index.ts:12-19`, `apps/extension/src/offscreen/index.ts:91-116`, `apps/extension/src/wallet/utils/offscreen.ts:123-146`, `apps/extension/src/wallet/utils/offscreen.ts:292-300`.

### Finding: Ready-timeout releases the single-flight gate before destructive close finishes

1. **Title:** Ready-timeout releases the single-flight gate before destructive close finishes
2. **Severity:** Major
3. **Repro confidence:** Moderate
4. **Type:** Race; secondary: bad retry-or-timeout
5. **Counter-example:** Pass A reaches its 10-second READY timeout. `onOffscreenTimeout` invokes `closeOffscreen()` but does not await it, rejects pass A, and clears `offscreenPromise`. The `ensureInFlight.finally` then clears the single-flight gate. Pass B immediately begins while A’s `chrome.offscreen.closeDocument()` is still pending; it can observe or create a document and proceed. A’s outstanding close then completes against Chrome’s singleton offscreen document, tearing down the document pass B adopted or created and causing B’s subsequent RPC to fail.
6. **Violated invariant:** The `passSeq` fence is documented to prevent a timed-out pass’s zombie continuation from tearing down a successor’s document. That invariant must cover destructive cleanup as well as `createOffscreen`’s retry continuation.
7. **Failing path:** READY timer invokes `onOffscreenTimeout` at `apps/extension/src/wallet/utils/offscreen.ts:92-104` → `closeOffscreen` starts the asynchronous singleton close at `offscreen.ts:160-177` but its promise is discarded → pass A rejects and `ensureInFlight` is cleared at `offscreen.ts:283-289` → pass B enters `doEnsureOffscreenRunning` at `offscreen.ts:292-314` while A’s close is outstanding → A’s late close can remove B’s current document.
8. **Expected vs actual behavior:** Expected: timeout cleanup completes, or is fenced and joined, before a successor ensure pass can inspect/create a document. Actual: the successor pass is admitted while the predecessor still owns an unfenced destructive close.
9. **Recommended fix:** Track timeout cleanup as a shared promise and await it before clearing `ensureInFlight` or before any successor probes/creates. Prefer moving the close into `doEnsureOffscreenRunning`’s rejection path so that the single-flight promise covers the entire timeout cleanup. Keep `passSeq` for late create continuations.
10. **Instances:** `apps/extension/src/wallet/utils/offscreen.ts:92-104`, `apps/extension/src/wallet/utils/offscreen.ts:160-177`, `apps/extension/src/wallet/utils/offscreen.ts:283-314`.

## Non-findings considered

- `ArtifactRegistry.clear()` can be undone by a late successful load, but no production profile-delete path calls `clear()`, and the production loader contains only profile-independent compiled artifacts; no concrete wrong result follows in the current wiring.
- Reusing `chainGuards` after a completed `clearChainState` is intentional and harmless by itself; the reportable problem is the epoch captured during the purge window, not guard reuse.
- A late-resolving OPFS open is closed by the existing fulfillment handler; only a never-settling initialization remains unowned.
- `Promise.race([creating, ready])` can return READY before `creating` settles, but the source explicitly documents and accepts that characterized transient race.
- Module-level PXE key/generation providers are registered after client construction, but client instances call closures that read the current module variables, and production registration occurs before service startup; no use-before-registration path was found.
- Profile deletion’s generation lifecycle rejects stale same-incarnation operations and provisions; the chain-purge race does not bypass that profile-level fence.
