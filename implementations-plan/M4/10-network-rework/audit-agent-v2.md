# Plan-Agent Audit — M4.10 v2 Plan

**Date**: 2026-04-27. **Agent**: Claude Plan-agent. **Target**: `plan-v2.md`.

## 1. Verdict

**APPROVE WITH FIXES.** The plan is structurally sound and codex-aligned. v2 closes the major gaps from v0 (`isDefault` consumers, journal staleness, balanceDisplayOption remap, pending-tx polling race, name collisions). However I found **3 BLOCKING** issues, **6 SHOULD-FIX**, and several test-layering and coupling concerns. PR-1's scope is real but achievable; the bigger risk is **PR-4 sequencing** and a **PR-1 ↔ PR-3 hidden dependency** the plan papers over with compat aliases that don't actually compile.

## 2. BLOCKING

### B1. Compat alias `setDefault(id)` cannot be implemented as described — PR-1 breaks UI typecheck.
Plan §7 PR-1 says:
> `setDefault(id)` → calls `setPrimaryEndpoint(network.id, network.primaryEndpointId)` after switching active.

Today's `setDefault(id)` (`packages/extension/src/wallet/services/network/service.ts:191`) takes a Network row id. After migration there is exactly one Network per chainId, so legacy callers in `app.vue:101`, `NetworksPopup.vue:35`, `NewNetworkPopup.vue:57`, `settings/networks/index.vue:39, 60` pass `appStore.network.id`. **But** the alias should call `setPrimaryEndpoint(network.id, network.primaryEndpointId)` — that's a no-op (same primary). The legacy callers used `setDefault` to communicate "I switched chain, sync the AztecNode cache." Under v2 this is `setActiveNetwork` (chain-pointer mutation), NOT a primary-endpoint operation. **Fix**: PR-1 must expose a `setActiveNetwork(networkId)` method; the alias `setDefault(id)` calls `setActiveNetwork(id)`, NOT `setPrimaryEndpoint`. Plan currently undefined.

### B2. `Network.name` / endpoint URL collision rules contradict each other.
Test 3 (§8) "rejects duplicate `name`" and `addEndpoint` validation (§1g) say the service rejects duplicates. But:
- Test 4: "rpcUrl already used by ANY endpoint of ANY Network in profile" → cross-Network URL reuse blocked.
- §6 smart-add UX: probe → if chainId matches existing Network → "Add as endpoint to <Network>" → which means cross-Network URL collisions can't even arise organically through that flow.

Either:
- Loosen test 4 to "same Network only" (consistent with §6), OR
- Tighten smart-add to surface cross-Network URL conflicts.
Plan contradicts itself between §1g, test 4, and §6.

### B3. Migration step 6 (`deletes`) is non-atomic — half-migrated state on crash leaves orphans + breaks idempotency.
§5 step 7:
```
await chrome.storage.local.set(writes)
if (deletes.length) await chrome.storage.local.remove(deletes)
```
If SET succeeds but REMOVE fails (or SW dies between), next boot sees:
- New canonical Network rows written.
- Non-canonical Network rows still present.
- Sentinel NOT yet set (good — set comes later at step 9).

On rerun, step 1 reads ALL `nulo:core:networks@*` rows — both new shape (with `endpoints[]`) AND old shape (with `rpcUrl`). The grouping in step 2 is `${profileId}:${chainId}` — both shapes have these fields. Step 3 then includes the new-shape rows as "old" rows. **Old-shape detector missing.**

**Fix**: Either (a) add shape gate in step 1 (`if "endpoints" in value: skip`), OR (b) merge writes+deletes into a single `chrome.storage.local.set({...writes, ...nullify_deletes})` since `chrome.storage.local.set` IS atomic for a batched set. Recommend (b).

## 3. SHOULD-FIX

### S1. PR-4 PxeService cascade — registration site is wrong.
`PxeService` lives in offscreen worker (`aztec-runtime/src/pxe/service.ts:63`); `NetworkService` lives in SW. The cascade event fires in the SW. There's no SW→offscreen event channel for `onNetworkDeleted`. SW services subscribe to the event in-process; PXE delete-IDB op needs to go via `PxeServiceClient.deleteChainState(profileId, chainId)` (NEW method) marshalled to offscreen. Plan §7 PR-4 lists `operation-journal/service.ts` but elides PxeService's RPC indirection. **Also**: ordering matters — PXE should run AFTER all SW-side cascade handlers wipe their own state, otherwise PXE rebinds to a fresh empty IDB while orphaned tx/account rows reference the chain.

### S2. `import.vue` backup-restore matcher under-spec'd for endpoint mapping.
`import.vue:389-403` matches old networks by `(name, rpcUrl, chainId)` then remaps `networkId` everywhere. After v2:
- Old-shape backups have flat `rpcUrl`. New-shape has `endpoints[]`.
- Dependent records (`accountAddress`, `tokenId`) carry `networkId` referring to old non-canonical row IDs. After restore, only canonical id survives. The matcher must build `oldToNewNetworkId` like the migrator does.

Plan PR-2 handles "old-shape transformer" but ONLY for `restore({networks})` — doesn't extend cross-service mapping in `import.vue`. **Fix**: Either (a) PR-2 extends `import.vue:389-403` to consume the `oldToNewNetworkId` map the service produces, OR (b) `restore()` returns the mapping table.

### S3. `caip.ts:74` clean break — drop `find(isDefault)` and `isDefault?` from `INetworkRef`.
Plan §1c says "we stop populating it" — `find(isDefault)` returns undefined; `networks[0]` wins. After migration there's only one Network per chainId, so [0] is correct. Compat-keeping `isDefault?` indefinitely is a code smell. **Fix**: PR-1 removes `find(isDefault)` from `caip.ts:74` and `extension/src/wallet/utils/caip.ts:93`; drops `isDefault?` from `INetworkRef`. Plan claims wallet-bridge needs no edits — wrong if we want a clean break.

### S4. Pending-tx polling pin — `Tx.submittedEndpointUrl` field add timing.
Plan §3 says it's added in PR-4. Existing v2 migrator wipes `nulo:core:txs@*`, so post-migration there are no orphan txs to worry about. **But** PR-4 lands AFTER PR-1, so any new pending tx between PR-1 and PR-4 won't have the field. Behavior degrades gracefully via `if (tx.submittedEndpointUrl) ... else getNode(tx.chainId)`, but the cleaner fix is **move the field add to PR-1 spec**, with PR-4 wiring writer (`addTransaction`) + reader (`updateTx`) sides. Less PR-coupling.

### S5. `setActiveNetwork` method + `onActiveNetworkChanged` event must be in PR-1.
Today three sites call `managers.network.setDefault(network.id)` for the AztecNode cache prime side effect. Plan §6 says "this mutation needs to die in PR-4." Correct, but in the meantime PR-1's compat alias must fire the right event — `onActiveNetworkChanged`, NOT `onPrimaryEndpointChanged`. Otherwise UI consumers get the wrong signal. **Fix**: PR-1 introduces:
- `setActiveNetwork(networkId)` method: updates SW-side active pointer, primes `nodes.get(chainId)`, emits `onActiveNetworkChanged`.
- `onActiveNetworkChanged({ networkId, chainId })` event.
- Compat alias `setDefault(id) → setActiveNetwork(id)`.
- Compat alias `onDefaultNetworkChanged → onActiveNetworkChanged`.

### S6. UX gap: profile-creation onboarding + `network.isDefault` shape access.
`app.vue:97` reads `appStore.networks.find((n) => n.isDefault)` — a shape access on Network, not a method call. Compat aliases don't cover this. Plan says "drop PR-1's compat aliases" in PR-3 — but PR-1 itself fails typecheck if `Network.isDefault` doesn't exist. **Fix**: PR-1 either (a) keeps `isDefault?: boolean` as a derived getter on the new Network type (compat-preserving), OR (b) PR-1 must already update `app.vue:75-103`. Plan's "compat aliases survive one PR cycle so PR-1 doesn't touch UI" is **broken** by this access pattern. Recommend (b): PR-1 touches `app.vue`. Net: PR-1 grows by ~30 lines but is consistent.

## 4. NITS

- §3 surface map omits `EditNetworkPopup.vue:25-26` and `NewNetworkPopup.vue:24-25` — the `notAllowed*` lists.
- §3 omits `popup/components/popups/SelectNetworksPopup.vue:87` — direct `network.rpcUrl` read in template.
- §5 `normalizeRpcUrl` lowercases the entire URL — should ONLY lowercase the host. Path-case matters for some RPC providers.
- §5 `dedupeEndpointsByUrl` doesn't specify which one wins. Spec: "earliest in source order."
- §8 test count: 25 + 9 + 6 = 40 NEW tests in PR-1. §13 estimates 2-2.5d. Tight.
- §8 test 25 ("Concurrent setPrimaryEndpoint + getNode") needs an explicit scheduler.
- §6 chain-switcher: needs to also clear `appStore.account` if no accounts on new chain. Today `app.vue:143-146` auto-creates; plan doesn't acknowledge.
- §6 Add-Endpoint probe TIMEOUT vs reject — surface 10s timeout error toast.
- `Network.kind` derivation: helpers ambiguous for legacy custom networks whose chainId now matches a known seed. Default to "custom" — doc.

## 5. Test architecture concerns

- 25 unit tests use `FakeNodeFactory` + reach-in stub of `profileService` (per `service.test.ts:54-67`). For tests #15, #19, #25, this stub-style doesn't exercise `init()` (where cascade-event subscription wires up). **Move tests #7, #15 (event emission) to integration suite** so they exercise real DI.
- 9 migration tests require `runStorageMigration(log, browserApi?)` to accept a port. Plan doesn't say. **It must**, or migration tests smell like global mocking. Concrete fix: PR-1 also refactors `runStorageMigration` to accept the port; tests pass `FakeBrowserApi`.
- `FakeBrowserApi` exposes both `chrome.storage.local` AND `chrome.storage.session` (verified at `packages/wallet-core/src/testing/fake-browser-api.ts`).
- E2E migration test (PR-5) needs a global-setup hook to inject seed via `chrome.storage.local.set` before extension boot. **NEW e2e infrastructure**, not just a new test file.
- E2E continuity test ("send tx on Endpoint A, swap to B, balance refreshes from B") needs a SECOND working RPC. CI uses ONE local Aztec node. **Either** drop the test, **or** spec a second-node fixture (`tests/e2e/fixtures/`).
- `PxeService.deleteChainState` cascade is best tested in offscreen integration tests.

## 6. Coupling / hidden dependencies

The cascading-delete event surface hooks **7 services** to `NetworkService.onNetworkDeleted`.

**Init-order hazard**: `NetworkService.init()` runs concurrently with peer services. Subscribers do `services.get(NetworkService.name).onNetworkDeleted.add(...)` in their `init()` — fine if `services.get` returns the singleton before its `init()` completes. Verified by `ProfileService` already doing this pattern. But fan-out timing matters: emitter does `await this.storage.delete(id)` then `this.emit("onNetworkDeleted", network)`. Subscribers run async (`EventHandler.invoke` is fire-and-forget). If `AccountService.onNetworkDeleted` handler crashes mid-cascade, chain is half-purged; next-boot reads inconsistent state.

**Fix**: Change `NetworkService.deleteNetwork` to AWAIT all subscribers (turn `EventHandler.invoke` into `invokeAndWait` for THIS event), OR document cleanup as best-effort + add startup-time orphan sweeper.

**Re-entrancy**: `ProfileService.onProfileDeleted` cascades to `NetworkService.onProfileDeleted` → emits `onNetworkDeleted` for each network → 7 subscribers fire 4× (4 default networks). Subscribers ALSO subscribe to `onProfileDeleted` directly. **Profile-delete now triggers TWO cascade waves**: profile-delete cascade + per-network cascade. Idempotent but wasted work. **Fix**: Subscribers handle `onNetworkDeleted` OR `onProfileDeleted` but not both. Document the contract: `onNetworkDeleted` is the canonical cascade event; `onProfileDeleted` is consumed only by `NetworkService` to emit per-network deletes.

**No new circular deps** — verified.

## 7. What's missing from the plan

1. **Section "Service init-order contract"** — explicit invariant about EventHandler subscription pre-`init()`.
2. **Section "Compat alias semantics, end-to-end"** — table of method+event+shape aliases and their replacements.
3. **Section "Test infrastructure changes"** — `runStorageMigration(BrowserApi)` refactor + e2e fixture-injection hook.
4. **Section "Backup version detection"** — explicit detector: `if (network[0].endpoints) → v3 else v2`.
5. **Section "Cascade subscriber ordering"** — Account FIRST, PXE-IDB-clear LAST.
6. **`SelectNetworksPopup.vue:87`** — inventory in §3.
7. **Pending-tx CARD UI** — tooltip "Submitted via {endpointLabel}" on pending tx cards.
8. **Threat model** — endpoint-as-input surface in SECURITY.md (smart-add probes user URL with full network privileges).

## 8. Confidence

Medium-high. Read 24 files (plan + spec + service + migrator + 8 consumer services + 4 popups + caip + integration test + transaction service + import flow + chain-runtime + balance projector + network badge + selectnetworkspopup + balanceview + appstore wiring). Static-analysis based; have not run the codebase.

3 BLOCKING items at 80%+ confidence. 6 SHOULD-FIX items at 65-75%. Highest-impact issue codex missed is the **PR-1 ↔ PR-3 hidden coupling** (S6 + S5) around shape vs method aliases.

I disagree with codex's apparent comfort with "compat aliases for one PR cycle." Works for **method** aliases but fails for **shape** aliases (`Network.isDefault` is a property; `app.vue:97` reads it directly). Either drop compat-aliases-for-PR-1 entirely (merge PR-1+PR-3, see Q11 default override) and ship a single bigger PR, OR keep `isDefault` as a derived getter on the Network type for one cycle. Plan punts this decision.

### Critical files for implementation
- `packages/extension/src/wallet/services/network/service.ts`
- `packages/extension/src/wallet/storage/migrate.ts`
- `packages/extension/src/popup/app.vue`
- `packages/extension/src/wallet/services/network/spec.ts`
- `packages/extension/src/wallet/services/transaction/service.ts`
