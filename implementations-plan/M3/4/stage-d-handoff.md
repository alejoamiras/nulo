# M3.4 Stage D — handoff breadcrumb

Stages A-C shipped (merged to master). This doc captures everything a
future session needs to pick up Stage D cleanly without re-deriving
context.

## What's left to move

Four extension files still tangle Aztec heavy deps with
extension-internal types. They're blocked on decoupling work that's
larger than a single file-move, so we split them out of the initial
M3.4 merge.

| File | Blocker | Decoupling pattern |
|---|---|---|
| `packages/extension/src/wallet/services/pxe/service.ts` — `PxeService` | Field-initializes `new ProfileServiceClient()`, `new ConfigServiceClient()`, `new LoggerServiceClient()`, `new ReadWriteGuard(...)` | Constructor DI. Define minimal structural interfaces in aztec-runtime (`IProfileReader`, `IConfigReader` — `ILogger` already lives in wallet-core). Extension composition root constructs concrete clients and passes them in. |
| `packages/extension/src/wallet/services/pxe/client.ts` — `PxeServiceClient` | `onReady()` override calls `ensureOffscreenRunning()` — extension-specific Chrome offscreen bootstrap | Two options: (a) subclass split — `PxeServiceClientBase` in aztec-runtime, extension subclass adds onReady; (b) function injection — accept `ensureTransport?: () => Promise<void>` as ctor arg. Option (a) is more type-safe. |
| `packages/extension/src/wallet/services/pxe/spec.ts` | Uses extension's `Network` type at `getNotes(network, filter)` etc. | Same pattern as chain-runtime's inline `NetworkInfo` interface — narrow structural type covering only `rpcUrl`, `chainId`, and whatever other fields the methods read. |
| `packages/extension/src/wallet/services/pxe/proxy.ts` — `PXEProxy` | Wraps `PxeServiceClient + Network`; needs both pieces moved. IPXE interface already in aztec-runtime (Stage B). | Moves naturally once client.ts + spec.ts are decoupled. |

Plus the offscreen shell (plan Solution A):

- Current: `packages/extension/src/offscreen/index.ts` contains full PXE bootstrap logic (see current file — ~45 lines that instantiate `ServiceCollection`, add `PxeService()`, `await services.start()`, signal READY).
- Target: move the bootstrap into `packages/aztec-runtime/src/offscreen/entry.ts` as an exported `createPxeOffscreen(deps)` function. Extension's `offscreen/index.ts` becomes a thin shell: instantiate the concrete clients (`ProfileServiceClient`, `ConfigServiceClient`, `LoggerServiceClient`), call `createPxeOffscreen({ profiles, config, logger })`, run it.

## What's already done (safe to build on)

- `@nulo/aztec-runtime` scaffold exists at `packages/aztec-runtime/` with `package.json`, `tsconfig.json` (no `vitest.config.ts` — tests stay in extension per plan, same pattern as M3.2 key-vectors).
- Subpath exports already declared in aztec-runtime/package.json: `.`, `/pxe`, `/account`, `/ports`, `/adapters`, `/utils`, `/offscreen/entry`.
- `src/offscreen/` directory is empty scaffold — ready for `entry.ts`.
- `IPXE` interface already in `aztec-runtime/src/pxe/ipxe.ts`.
- `NetworkInfo` pattern already established in `aztec-runtime/src/pxe/chain-runtime.ts` lines 18-22 — copy-paste template for `pxe/spec.ts`'s Network structural type.
- Tests that'll stay in extension: `pxe/chain-runtime.test.ts`, `pxe/artifact-registry.test.ts`, `account/contracts/nulo-account.test.ts` — all import extension-internal types for their fixtures; same pattern as M3.2.
- Extension's vitest config already has `server.deps.inline: [/^@nulo\//]` — works for aztec-runtime too.
- `resolve.alias` for `@wonderland-token-artifact` + `@private-fpc-artifact` added to both `vite.config.ts` and `vitest.config.ts`.

## Recommended order for Stage D

1. **Refactor PxeService constructor** (in-place, before moving). Add three params: `profiles: IProfileReader`, `config: IConfigReader`, `logger: ILogger`. Remove the field initializers. `wallet/index.ts` composition root already has these — pass them in.
2. **Verify green** — all unit + smoke + network E2E pass. This is a pure DI refactor, no semantic change.
3. **Move PxeService** — copy to `aztec-runtime/src/pxe/service.ts`. Inline NetworkInfo-style interfaces for IProfileReader + IConfigReader. Update extension imports.
4. **PxeServiceClient decision**: pick (a) subclass split or (b) function injection. Recommend (a) — cleaner types. Create `PxeServiceClientBase` in aztec-runtime (no onReady override), extension's `PxeServiceClient` extends it and adds the offscreen bootstrap.
5. **Move spec.ts + proxy.ts**. Network → structural NetworkInfo.
6. **Offscreen shell** — move bootstrap to `aztec-runtime/src/offscreen/entry.ts`. Extension shell becomes ~10 lines.

Each step is verifiable. Commit between them. Full E2E (smoke + network) gates each commit.

## Risks to watch

- **PxeService ctor is a big surface change** — many test fixtures may field-initialize `new PxeService()`. Grep first, inventory the sites, and batch-update.
- **Offscreen shell swap is runtime-critical** — the SW↔offscreen handshake (READY message) must fire at exactly the right moment. Keep the `chrome.runtime.sendMessage(OFFSCREEN_READY_MESSAGE)` call at the end of the entry function, not inside aztec-runtime internals. Test with cold-start E2E smoke.
- **Type-assertion landmines** — some of the moved files use `@aztec/stdlib` types as parameter types (Network, Fr, etc.). Structural subtyping usually makes this seamless, but `currentContractClassId: Fr` is a branded type; if the structural interface declares it as `string` or similar, calls might diverge. Spot-check the 4 files' parameter types before committing.
- **IPXE proxy re-export shim** — extension's current `pxe/proxy.ts` re-exports IPXE from aztec-runtime. When proxy.ts moves, drop that re-export. Grep `@/wallet/services/pxe/proxy` for consumers importing `IPXE` from there — they need to switch to `@nulo/aztec-runtime/pxe`.

## State as of M3.4 merge

- Branch `m3/4-aztec-runtime`: deleted after merge (commits preserved on master).
- Merge commit: top of master (one above the M3.4-c chore commit).
- Master HEAD is clean; all 4 extracted packages typecheck.
- Version at 0.12.6 (bumped in the m3/4 bump commit).

## Reference — what the M3.4 plan doc at `implementations-plan/M3/4/plan.md` originally wanted

Read that plan for the full architectural rationale + risk register. The deferred items above correspond to:

- Plan's "**Account contracts — `IAccountContract` boundary**" section: ✅ shipped in Stage B
- Plan's "**Offscreen document boundary**": ⏳ deferred (Solution A thin-shell not yet wired)
- Plan's "**WASM asset management**": ✅ extension's vite.config still owns it, applies transitively — no change needed
- Plan's "**Changes in `@nulo/extension` → Import migrations**": ⏳ partial; PXE service/client/spec/proxy consumers still import `@/wallet/services/pxe/*` — they'll flip to `@nulo/aztec-runtime/pxe` in Stage D
- Plan's pre-refactor Step 0: ✅ already done (Network → inline structural types, NodeFactory port relocated)
