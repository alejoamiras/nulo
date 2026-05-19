# Autonomous session status — typecheck cleanup

**Branch**: `cleanup/typecheck-green` (off master `63d232e`)
**Started**: 2026-04-24 autonomous run (user at park)
**1Password SSH agent locked** → commits impossible → everything is UNCOMMITTED work-tree changes.

## How to resume / test

```bash
# branch + worktree already has changes
git status
git diff --stat

# test
bun run typecheck   # expect 0 errors (or track phase count below)
bun run test
bun run build

# if good: unlock 1Password, commit per-phase using the boundaries noted below
# if broken: git reset --hard 63d232e && git checkout master && git branch -D cleanup/typecheck-green
```

## Phase progress

_(this section updated after each phase verifies)_

- [x] Phase 1 — Stale paths + dead directives + test fixtures (113→89, +4 cascade fixes; tests green)
- [x] Phase 2 — IntentInnerHash rewrite (89→85, tests green)
- [x] Phase 3 — Aztec SDK drift (85→74; **MANUAL QA REQUIRED**; tests + build green)
- [x] Phase 4 — Vue SFC shims + router (74→69, tests green)
- [x] Phase 5 — Stores + implicit-any + passkey + files.ts + execute (69→45, tests green)
- [x] Phase 6 — Logger signature separation (45→45, tests green — the 2 logger errors were cascade-fixed inside Phase 5's work)
- [x] Phase 7 — Capability runtime guard + UI narrowing (45→0, tests + build green)
- [x] Phase 8 — Per-package typecheck + CI gate (`typecheck:all` wires all 8 @nulo/* packages; all exit 0)

## Current error count

Start: 113
After Phase 8 (final): **0** ✓

## Final verification

- `bun run typecheck` → 0 errors ✓
- `bun run typecheck:all` → all 8 @nulo/* packages exit 0 ✓
- `bun run test` → 458/458 ✓
- `bun run build` → clean ✓
- `bun run test:e2e` → 15/15 + 2 skipped ✓
- `bun run test:e2e:all` → 31/31 + 5 skipped ✓

## All phases complete. Ready for user review.

## Commit note

1Password SSH agent was locked during this autonomous run, so nothing committed. All changes are uncommitted on branch `cleanup/typecheck-green`. When you return:

```bash
# verify
bun run typecheck:all   # expect all 8 packages exit 0
bun run test             # 458/458
bun run test:e2e:all     # 31/31

# commit (unlock 1Password first)
git add -A
git commit -m "fix(typecheck): cleanup 113 → 0 errors [audit-incorporated plan]"
# or split into phase-boundary commits — each phase's edits are tracked in this doc
```

## Files touched

~40 files across all 8 packages. Grouped by plan phase:

**Phase 1 — stale paths + test fixtures**:
- packages/extension/src/wallet/services/execution/authwit-discoverer.ts (ContractArtifact + FunctionAbi narrow)
- packages/extension/src/wallet/services/execution/contract-resolver.ts
- packages/extension/src/wallet/services/execution/contract-resolver.test.ts
- packages/extension/src/wallet/services/transaction/{service,spec}.ts
- packages/extension/src/core/testing/fake-node-factory.ts
- packages/extension/src/popup/windows/{capabilities,discover,execute,verify}/index.vue (4x @ts-expect-error removal)
- packages/extension/src/wallet/services/pxe/{artifact-registry,chain-runtime}.test.ts
- packages/extension/src/wallet/services/profile/service.integration.test.ts
- packages/extension/src/wallet/logger/store.test.ts
- packages/extension-messaging/src/{background,offscreen}/client.ts (Awaited<ReturnType> fix)

**Phase 2 — IntentInnerHash rewrite**:
- packages/extension/src/wallet/services/execution/{authwit-discoverer,service}.ts

**Phase 3 — Aztec SDK drift (RUNTIME-AFFECTING)**:
- packages/extension/src/wallet/services/execution/service.ts (timestamp, scopes, GasFees)
- packages/extension/src/wallet/services/execution/operation-planner.ts (GasFees)
- packages/extension/src/wallet/services/execution/fee/fee-strategy.ts (scopes type)

**Phase 4 — Vue SFC shims + router**:
- packages/extension/src/shims-vue.d.ts (new)
- packages/extension/src/utils/amount.d.ts (new)
- packages/extension/src/composables/syncedRef.d.ts (new)
- packages/extension/src/popup/index.ts (vue-router/auto → vue-router)
- packages/extension/src/setup/index.ts (same)

**Phase 5 — Stores + implicit-any**:
- packages/extension/src/stores/app.store.ts (type refs + handlers; also fixed a real bug: `network.id` → `network.chainId` in account calls)
- packages/extension/src/core/adapters/clock-ticker-adapter.test.ts
- packages/extension/src/popup/index.ts (router guard types)
- packages/extension/src/popup/windows/passkey/index.vue (LocationQueryValue narrow)
- packages/extension/src/utils/files.ts (chrome.runtime.lastError + CompressionStream)
- packages/extension/src/popup/windows/execute/index.vue (Operation cast for approveInteraction + UIOperation cast for startEstimation)
- packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue (appStore.network undefined guard)

**Phase 6 — Logger signature separation**:
- packages/extension/src/wallet/services/logger/{service,client}.ts

**Phase 7 — Capability narrowing**:
- packages/extension/src/popup/components/modules/capabilities/CapabilityDetailPanel.vue (prop: Capability)
- packages/extension/src/popup/windows/capabilities/index.vue (UICapability.capability: Capability; cast delta / existingGrants)
- packages/extension/src/components/ui/Tooltip.vue (lang=ts + defineSlots + inline type fixes)

**Phase 8 — Per-package + CI wire-up**:
- packages/aztec-runtime/src/account/nulo-account.ts (@/wallet/logger → @nulo/wallet-core/logger)
- packages/aztec-runtime/src/utils/fetch.ts (export DEFAULT_REQUEST_TIMEOUT_MS)
- packages/wallet-bridge/package.json (+ vitest devDep)
- packages/playground/src/main.ts (status → statusEl shadowing)
- package.json (+ typecheck:all script)

**Lint cleanups from pre-commit biome**:
- packages/extension/src/stores/app.store.ts (deleted unused WalletMetadata type + AccountTokenMap class)
- packages/extension/src/utils/files.ts (typed `let blob: Blob`)
- packages/extension-messaging/src/{background,offscreen}/client.ts (formatter-applied + {} → Record<string, never>)
- packages/extension/src/shims-vue.d.ts (double biome-ignore for noExplicitAny)

## Known deferrals

- `contract-resolver.test.ts:152` — test name has `${classId}` in a plain string (biome warning, not error). Left as-is; it's inside a test name string (not an actual template).
- `transaction/service.ts:42` — unused `pxeService` private field (biome warning). Pre-existing dead code; out of scope for typecheck cleanup.

## Known improvements (real bugs the cleanup surfaced)

1. **app.store.ts:94,109**: `changeAccountVisibility` + `changeAccountName` were calling with `network.value.id` (string — the network id) where the service expected `chainId` (number). Fixed both call sites.
2. **FeeSettingsCard.vue**: Has ~47 errors when flipped to lang="ts" — indicating lots of implicit-any work. Deferred; blanket shim covers consumers.
3. **discover/index.vue + others**: Tooltip slot types were invisible without proper `defineSlots`. Fixed by typing Tooltip.vue.

## Notes for user testing

- Phase 3 is the only phase with runtime behavior change. Manual QA: send-tx UI, send-tx dApp, extension reload + retry.
- If typecheck delta goes NEGATIVE on any phase (new errors introduced), halt is triggered and this file documents the reason.
