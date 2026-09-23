# @nulo/wallet-core

The foundation. Pure ports, types, and platform-agnostic utilities. No `chrome.*` (enforced by biome `noRestrictedGlobals`); no I/O. Every package above depends on this; this depends on nothing.

## Position in the stack

```
wallet-core  →  wallet-crypto  →  extension-messaging  →  aztec-runtime  →  wallet-bridge  →  extension
```

`wallet-core` sits at the bottom. It defines the abstractions other packages depend on so the wallet remains testable without a browser: `BrowserApi`, `AlarmsPort`, `RuntimePort`, `WindowPort`, `StorageArea`, `ILogger`.

## File map

| Path | Purpose |
|---|---|
| `src/ports/browser-api.ts` | The `BrowserApi` interface — runtime, storage, alarms, windows. Used by services that need chrome.* through an injectable seam. |
| `src/ports/alarms-port.ts`, `runtime-port.ts`, `window-port.ts` | Narrower ports for services that only need one slice. |
| `src/storage/value-storage.ts`, `entity_storage.ts` | Typed wrappers over a `StorageArea`. `ValueStorage<T>` for single records; `EntityStorage<T>` for indexed entity rows keyed `${root}@${id}`. |
| `src/migration/` | The data-preserving storage-migration engine: numbered `Migration`s applied where `version > persisted`, crash-safe journal (running marker → atomic footprint backup → staged batched commit → checkpoint), fail-closed retry with a durable attempt counter, marker decision table. Pure — the extension injects the store + registry (`apps/extension/src/wallet/storage/migrations/`). |
| `src/utils/lock.ts` | Single-flight per-service lock. Ownership-ticketed: `enter()` returns a per-grant `LockTicket`, `leave(ticket)` no-ops for anyone but the current owner, and the force-release watchdog invalidates the displaced holder's ticket. Prefer `withLock` (threads the ticket internally). |
| `src/utils/rw-guard.ts` | Reader/writer guard. Multiple parallel reads; writers drain readers then run exclusively. Writers have FIFO priority. |
| `src/utils/event-handler.ts` | The `EventHandler<T>` primitive every service emits through. |
| `src/utils/mnemonic.ts`, `random.ts`, `serialization.ts`, `arrays.ts`, `queue.ts`, `sleep.ts`, `errors.ts` | Pure helpers. |
| `src/base/index.ts` | `ServiceCollection` + `ServiceSpec<Methods, Events>` — the typed service-spec contract used across the codebase. |
| `src/base/topology.ts` | Topological-phase startup. Services declare `dependencies`; the collection runs them in parallel phases respecting dependency order. |
| `src/logger/interfaces.ts` | `ILogger` interface + `LogLevel`. The concrete chrome-backed `LoggerStore` lives in `@nulo/extension`. |
| `src/testing/fake-browser-api.ts` | In-memory `BrowserApi` implementation for unit tests. |
| `src/testing/mock-clock.ts`, `fake-background-ticker.ts` | Deterministic time control for tests. |

## Scripts

| Command | Effect |
|---|---|
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run test` | Unit tests via vitest. |

## Testing

Colocated `*.test.ts`. The package ships its own `vitest.config.ts` because it must run without any Vue / Chrome stubs. `FakeBrowserApi` (in `src/testing/`) is the standard substitute when a test exercises a port-consuming class.

## Key invariants

- **No `chrome.*` imports.** Enforced via biome `noRestrictedGlobals`. If you need chrome behavior in core, expose it through a port and let the caller inject the real impl in the extension.
- **No I/O.** No `fetch`, no DB access, no clock. Tests provide a `MockClock` when timing matters.
- **`EntityStorage` row keys** are `${root}@${id}` — not `:${id}`. Migration scripts and prefix wipes depend on this exact encoding.
- **`Lock`'s 5-minute default watchdog** mirrors `ReadWriteGuard.MAX_READER_DRAIN_MS` — these force-release timers exist to turn a deadlock into a loud log + recovery, not to mask a bug. If one fires in practice, fix the caller. A force-release cannot be un-run: the displaced holder's remaining code still executes (its `leave(ticket)` is just inert), so a lock whose long holds are BY DESIGN must be constructed with `maxHoldMs: null` (the network service lock is the precedent).
- **Service-startup phases** (`base/index.ts`, `base/topology.ts`) describe live runtime behavior, not historical milestones. `phase 0` means "services with no declared deps run first, in parallel". Cycles and unknown deps throw at startup, not at first call.
- **`ServiceSpec`-typed services** are the universal contract — both `Service` and `ServiceClient` (from `@nulo/extension-messaging`) consume it. If you add a method or event, update the spec in one place.
