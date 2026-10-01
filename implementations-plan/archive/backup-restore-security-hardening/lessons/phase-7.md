# Phase 7 — PXE deletion honesty + profile-wide clear (D privacy) — lessons

**Status: ✓ (`3e5aeb0`).** Gate: `bun run --filter '@nulo/aztec-runtime' test` 45 pass; typecheck 0; lint 0.

## What was built (`packages/aztec-runtime/src/pxe/`)
- **`deleteDb(name, timeoutMs)` helper:** awaited IndexedDB delete — `onerror` → reject (never false-success); `onblocked` → wait up to `timeoutMs` for the blocking connection to close (then `onsuccess`), else reject. Replaces the resolve-on-everything pattern.
- **`clearChainState`** now uses `deleteDb` → rejects on failure so `purgeChain`/the coordinator can detect a real erasure failure.
- **NEW `clearProfileState(profileId)`** (RPC): awaited prefix-scan (`chainDataDirPrefix(profileId)`) delete of ALL the profile's PXE DBs — catches a DB on a chainId with no surviving network row that per-chain clear misses — + drops the SHARED `keyval-store` ONLY when no PXE DB remains for any profile.
- **REMOVED the 8th `onProfileDeleted` consumer** (the offscreen PXE subscriber): it fire-and-forget-deleted DBs AND unconditionally deleted `keyval-store` regardless of surviving profiles = cross-profile corruption (finding D). The P8 coordinator calls the awaited `clearProfileState` instead.

## Key decisions / gotchas
- **Descriptor-driven RPC surface:** a new PXE method must be added in FOUR places — `spec.ts` `Methods`, `descriptors.ts` `PXE_METHOD_DESCRIPTORS` (`satisfies Record<keyof Methods, …>` enforces it), the service `rpcMethods` list, AND the HAND-WRITTEN `PxeServiceClientBase` (it implements each method explicitly, NOT auto-generated). Missing the client → `TS2420 incorrectly implements ServiceSpec`.
- **`descriptors.test.ts` hard-codes the method count** (21 → 22) — update on any add.
- **Intermediate-state note:** removing the subscriber in P7 means profile-delete doesn't clear PXE until P8 wires the coordinator — acceptable because it's ONE PR (the branch is coherent when both land).
- **Pins stub `indexedDB`** (`vi.stubGlobal`) with a fake `IDBOpenDBRequest` firing `onsuccess`/`onerror` via `queueMicrotask`, and inject a stub `registry` (dispose/disposeProfile no-ops) — the barriers/guards are real and need no setup.
