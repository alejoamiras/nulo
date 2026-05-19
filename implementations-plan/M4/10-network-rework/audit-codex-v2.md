# Codex xhigh Audit — M4.10 v2 Plan

**Date**: 2026-04-27. **Tool**: codex-cli 0.120.0, `model_reasoning_effort=xhigh`. **Target**: `plan-v2.md`.

## Verdict

**REJECT**

The direction is right: one logical network per `(profileId, chainId)` with nested endpoints is the correct model. But the plan has several merge-blocking execution gaps. Most are not taste issues; they are places where the plan contradicts the current storage/runtime contracts or where a PR would leave `master` broken.

## BLOCKING

### 1. v3 migrator specified against the wrong storage wire format; "idempotent on rerun" doesn't hold under partial success.
Refs: `plan-v2.md:252`, `plan-v2.md:323`, `plan-v2.md:366`, `entity_storage.ts:57`, `entity_storage.ts:84`.

`EntityStorage` stores **JSON strings**, not raw objects. The plan's scan (`typeof value === "object"`) would skip real network rows. Writing raw objects back under `nulo:core:networks@*` would break later `JSON.parse` reads. Even after fixing parse/stringify, `set(writes)` before the sentinel still leaves a mixed v2/v3 root if SW dies mid-migration; rerun reads partially migrated rows as `OldNetwork`.

**Fix**: explicit `JSON.parse`/`JSON.stringify` at migrator boundary; v2/v3 row-shape detection; reruns must converge from mixed storage. A staging sidecar or "rebuild full root then swap + sentinel last" approach is safer.

### 2. `normalizeRpcUrl()` corrupts valid RPC endpoints.
Ref: `plan-v2.md:401`.

Lowercasing the entire URL is unsafe. Hostnames are case-insensitive; paths, query params, and API keys are not. Silently breaks custom providers.

**Fix**: parse with `new URL()`; normalize protocol/hostname only; leave path/query unchanged.

### 3. PR-1 cannot merge alone with compat aliases; current popup depends on old data shape + signature.
Refs: `plan-v2.md:524, 556, 572`, `app.vue:97`, `NetworkBadge.vue:46`, `NewNetworkPopup.vue:25`, `EditNetworkPopup.vue:59`, `app.store.ts:102`.

Plan says PR-1 ships with UI untouched. But popup code reads `network.isDefault`, `network.rpcUrl`, calls `updateNetwork(id, name, rpcUrl)`. JS/Vue callers not caught by TS. PR-1 removing fields/signatures without full compat projection breaks `master` immediately.

**Fix**: either keep full shape/signature compatibility in PR-1 (`rpcUrl`, `isDefault`, old `updateNetwork`) OR move popup/store edits into PR-1.

### 4. Delete-cascade design needs awaited coordinator; event-subscriber model not implementable.
Refs: `plan-v2.md:117, 633`, `event-handler.ts:22`, `background/service.ts:104`, `offscreen/index.ts:41`, `offscreen/entry.ts:31`, `pxe/spec.ts:15`, `network/service.ts:304`, `auth-registry/service.ts:28`.

`EventHandler.invoke()` doesn't await async cleanup. PXE in offscreen has no per-chain delete RPC. Profile-delete double-fires (services subscribe to both `onProfileDeleted` and `onNetworkDeleted`). Purge list omits `AuthRegistryService` (per-account auth state outside PXE).

**Fix**: explicit awaited purge coordinator. Deterministic order: stop tx tracking / delete account-derived state first → explicit PXE `clearChain(profileId, chainId)` → emit post-purge event for UI refresh only. Not best-effort async subscribers.

### 5. Backup/restore surface change breaks current import/export callers.
Refs: `plan-v2.md:582, 591`, `full.vue:101`, `import.vue:374, 389`.

Export/import UI assumes `backup.data.network` is an array. Plan changes `network.backup()` to `{ networks: [...] }` and says callers need no changes — wrong. Import remap matches by `name + rpcUrl + chainId`, doesn't survive same-chain collapse.

**Fix**: keep array contract for `backup.data.network`, shape-detect per element, OR update export/import in same PR. Restore must return deterministic `oldNetworkId -> newNetworkId` map.

## SHOULD-FIX

### 1. Pending-tx pinning needs URL-keyed transient-node contract.
Refs: `plan-v2.md:243`, `network/service.ts:25, 243`.

`getNodeForUrl()` falling back as soon as the endpoint is edited/deleted doesn't really pin. Specify transient cache keyed by URL; poll the literal submitted URL until it actually fails.

### 2. Restore conflict policy underspecified.
Refs: `plan-v2.md:584`, `network/service.ts:324`. What if restored old-shape chains collide with already-present `(profileId, chainId)` rows? Reject outside full-profile-import path.

### 3. Migration behavior for `Network.kind` and canonical naming explicit.
Refs: `plan-v2.md:398, 399`. Same-chain custom rows get implicitly promoted to canonical chain metadata. State this plainly.

### 4. Smart-add race/error handling at UI boundary.
Ref: `plan-v2.md:473`. Two concurrent probes can race. Popup should catch "duplicate chain" / "duplicate endpoint" service errors and convert to endpoint-add flow.

### 5. `setActiveNetwork` location ambiguous.
Refs: `plan-v2.md:606, 687, 539`. Popup-store helper or service API? Plan mixes them.

## NITS

- Validation rules inconsistent: §1(g) forbids duplicate `rpcUrl` only within a network, unit tests forbid it anywhere in profile.
- `balance-projector` should use explicit `getNetworkByChainId()` helper instead of `[0]`.
- If seeded network names become read-only in UI, state whether migration canonicalizes pre-existing renamed seeded chains.

## Test gaps

- Migration test with **mixed storage**: one v3 row already written, one v2 row still present, sentinel absent.
- Migration test for **URL case preservation** (path/query/API-key segments).
- Full-backup round-trip test where same-chain duplicate rows collapse and dependent `networkId` references remap correctly.
- Delete-network test with **pending tx worker active** + assertion cleanup is awaited.
- **Profile delete** integration test once network-purge exists; prove no duplicate cleanup paths leave orphans.
- **MV3 SW restart** test after primary-endpoint swap + after pending-tx submission.
- **Smart-add concurrency** test: two simultaneous submissions for same chain/url.

## Confidence

High on BLOCKING items — direct code/plan mismatches (storage wire format, popup compat, import/export callers, event/offscreen topology). Lower confidence on best `getNodeForUrl()` cache lifecycle; depends on AztecNode caching aggression.
