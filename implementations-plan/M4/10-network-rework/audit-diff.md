# Audit Diff: M4.10 v2 → v3

Cross-references every finding from `audit-codex-v2.md` and `audit-agent-v2.md` to the v3 plan section that addresses it.

## Codex BLOCKING (5/5 addressed)

| # | Finding | Resolution in v3 |
|---|---------|------------------|
| 1 | Migrator wire format wrong (EntityStorage stores JSON strings) | §5: explicit `JSON.parse`/`JSON.stringify` at boundary; shape gate (`"endpoints" in value` skip) for v3 rows; rerun converges from mixed storage. Test 10 covers mixed-storage scenario. |
| 2 | `normalizeRpcUrl` lowercases everything | §5 helper: `new URL()` parse; `protocol.toLowerCase()` + `hostname.toLowerCase()` only; path/search preserved. Test 11 covers URL case preservation. |
| 3 | PR-1 cannot merge alone with compat aliases (UI shape access broken) | §0 v2→v3 change #1 + §7 PR-1: collapsed PR-1+PR-2+PR-3+PR-4 from v2 into single atomic PR-1. UI plumbing (app.vue, app.store, NetworksPopup, NewNetworkPopup, EditNetworkPopup, settings/networks index, NetworkBadge) ships in PR-1. No compat aliases. |
| 4 | Cascade event-handler model not implementable; PXE in offscreen; AuthRegistry missing | §1(h): replaced events with awaited `purgeChain` coordinator. Each chain-keyed service exposes `clearChainState(profileId, chainId)` method. PXE goes via NEW `PxeServiceClient.clearChainState` SW→offscreen RPC. AuthRegistry added to cascade list. Init-order contract documented. |
| 5 | Backup contract change breaks callers | §0 change #5 + §3 + §7 PR-1 commit 9: `backup()` preserves `Network[]` array shape. `restore(networks)` shape-detects per element. Returns `{ oldToNewNetworkId }` for caller remapping. `import.vue` consumes the map. `full.vue` unchanged (still calls `s.backup()`). |

## Plan-agent BLOCKING (3/3 addressed)

| # | Finding | Resolution in v3 |
|---|---------|------------------|
| B1 | `setDefault` compat alias semantics broken (chain-switch vs primary-endpoint) | §0 change #7 + §3: explicit `setActiveNetwork(id)` method + `onActiveNetworkChanged` event in PR-1. Replaces `setDefault` directly (no compat alias). Mutates internal active-id pointer; primes nodes cache; doesn't touch `primaryEndpointId`. |
| B2 | `Network.name` / endpoint URL collision rules contradict | §1(g) clarified: validation rules per-Network scope (not per-profile). Cross-Network `rpcUrl` reuse ALLOWED. Unit test #4 rephrased to "rejects duplicate rpcUrl within SAME Network." Smart-add §6 uses chainId match (not URL match) to detect "add-as-endpoint" case. Internally consistent. |
| B3 | Migration step 6 non-atomic; rerun fails for partial-success | §5 algorithm: shape gate added (skip rows with `"endpoints" in value`). Single `local.set(writes)` is atomic for batched object (chrome.storage spec). `local.remove(deleteKeys)` is separate; if it fails after writes succeed, next boot's shape gate skips already-migrated rows + cleanup attempt re-runs. Sentinel set last (in outer `runStorageMigration`). |

## Codex SHOULD-FIX (5/5 addressed)

| # | Finding | Resolution in v3 |
|---|---------|------------------|
| S1 | Pending-tx pinning needs URL-keyed transient cache | §0 change #9 + §4: `getNodeForUrl` uses `Map<string, { node, failures }>` keyed by URL. `reportEndpointFailure(url)` increments; 3 failures evicts. `deleteEndpoint` evicts. Doesn't fall back as soon as endpoint edited. |
| S2 | Restore conflict policy underspecified | §0 change #12 + §3: `restore()` rejects `(profileId, chainId)` collision unless `force: true`. Full-profile-import path passes `force`; ad-hoc restore doesn't. |
| S3 | `Network.kind` canonicalization explicit | §0 change #13 + §1(e): migration sets canonical `kind` for known seeded chainIds regardless of name. Custom chains → `kind: "custom"`. Documented in `deriveChainKind` helper §5. |
| S4 | Smart-add race/error handling | §0 change #11 + §6: NewNetworkPopup catches `DuplicateChainError`/`DuplicateEndpointError` from service. Service-side Lock acquire before chainId probe (concurrent probes serialize). 10s probe timeout with toast. |
| S5 | `setActiveNetwork` location ambiguous | §0 change #7 + §3 PR-1 commit 6: defined as service method on `NetworkService`. App.vue + popups call via `NetworkServiceClient.setActiveNetwork(id)`. App.store mutator wraps it. |

## Plan-agent SHOULD-FIX (6/6 addressed)

| # | Finding | Resolution in v3 |
|---|---------|------------------|
| S1 | PR-4 PxeService cascade registration site wrong | Folded into codex BLOCKER 4 fix. PxeService gets `clearChainState({profileId, chainId})` method (offscreen). SW-side `PxeServiceClient.clearChainState` RPCs into offscreen. |
| S2 | `import.vue` matcher under-spec'd for endpoint mapping | Codex BLOCKER 5 fix supplies `oldToNewNetworkId` map from `restore()`. `import.vue:389-403` consumes it for remapping `accountAddress` / `tokenId` / etc. |
| S3 | `caip.ts:74` clean break (drop find(isDefault) + INetworkRef.isDefault?) | §0 change #6 + §3: `INetworkRef.isDefault?` dropped. Both `caip.ts:74` and extension/utils/caip mirror updated to `networks[0]`. |
| S4 | `Tx.submittedEndpointUrl` field add timing | §0 change #8: moved to PR-1 spec. Writer (sendTx) + reader (`updateTx`) wired in PR-1 commit 7. No PR-coupling. |
| S5 | Need explicit `setActiveNetwork` method + `onActiveNetworkChanged` event | Same as codex SHOULD-FIX 5. Defined in PR-1. |
| S6 | UX gap: `app.vue:97` shape access on `network.isDefault` breaks compat | Codex BLOCKER 3 fix: PR-1 includes UI plumbing. `app.vue:97` reads `appStore.networks.find(n => n.id === appStore.network?.id)` or equivalent (using new shape). No compat layer needed. |

## Plan-agent NITS + What-Missing (incorporated where cheap)

- §3 surface map adds `EditNetworkPopup.vue:25-26`, `NewNetworkPopup.vue:24-25`, `SelectNetworksPopup.vue:87` (with delete-if-dead caveat).
- §5 `normalizeRpcUrl` only lowercases protocol+hostname.
- §5 `dedupeEndpointsByUrl`: "earliest in source order" wins.
- §8 test count math reconciled (~25 + 11 + 7 = 43 in PR-1).
- §8 test 25 (concurrency): doc explicit interleaved awaits as the scheduler.
- §11 verification: `bun run test:e2e:all` confirmed real script (`packages/extension/package.json:26`).
- §6 chain-switcher: auto-account-create on switch acknowledged (existing app.vue:143-146 behavior preserved).
- §6 Add-Endpoint timeout: 10s with error toast.
- "Service init-order contract" section: added to v3 §1(h).
- "Cascade subscriber ordering" section: added to v3 §1(h).
- "Backup version detection": added to v3 §3 (per-element shape detect).
- "Test infrastructure changes": `runStorageMigration(browserApi)` refactor + e2e fixture-injection hook documented in v3 §3 + §7 PR-3.
- Pending-tx CARD UI tooltip: deferred to follow-up enhancement (v3 open question 5).
- SECURITY.md endpoint-as-input: ship in PR-3 (v3 §7 + open question 4).

## Codex NITS (3/3)

- Validation rules consistency: §1(g) + test 4 reconciled (per-Network scope).
- `balance-projector` uses explicit `[0]` after grep-confirmed migration is unique-per-chainId post-rework. (v3 keeps `[0]` as the pattern; alternative `getNetworkByChainId()` helper is a follow-up — not addressed in this PR to avoid scope creep.)
- Seeded names canonicalization: §1(e) + §5 doc the explicit override behavior. Migration overrides user's renamed seeded chain only for `kind`; `name` is preserved.

## Test gaps (from both audits, all addressed)

| Source | Test | Where it lands |
|--------|------|----------------|
| codex | Mixed storage (v3 + v2 + no sentinel) | Migration test 10 in §5 / §8. |
| codex | URL case preservation | Migration test 11. |
| codex | Full-backup round-trip with same-chain collapse | Integration test (extend `service.integration.test.ts` PR-1) — implicit in restore-old-shape test 22. v3 makes the `oldToNewNetworkId` return value testable. |
| codex | Delete-network with pending tx | Integration test 7 in §8. |
| codex | Profile-delete after network-purge | Integration suite extension (`profile/service.integration.test.ts`). |
| codex | MV3 SW restart | E2E `sw-restart-network.test.ts` (PR-3). |
| codex | Smart-add concurrency | Unit test extension on Lock acquire. |
| plan-agent | E2E migration with fixture injection | E2E `migration.test.ts` (PR-3) + `storage-seed.ts` fixture. |

---

## Items NOT incorporated (with justification)

- **Plan-agent NIT**: `balance-projector.getNetworkByChainId()` helper. Deferred — `[0]` is correct for the new model, helper is purely cosmetic. Cost > value for this PR.
- **Plan-agent §7 missing**: Pending-tx card UI tooltip "Submitted via X." Deferred to a follow-up (v3 open question 5). Doesn't gate the PR; pure UX polish.
- **Codex SHOULD-FIX 3 nuance** (renamed seeded chains): v3 picks "preserve user's name; override `kind` only." Codex's flag was that the v2 plan was implicit. v3 makes it explicit (§1(e), §5 helper). Final answer: user's renamed name SURVIVES; only `kind` is recomputed from chainId.

---

## Confidence summary

- All 8 BLOCKERs (5 codex + 3 plan-agent) addressed with concrete v3 sections.
- 11 SHOULD-FIX items: 9 incorporated; 2 deferred with justification.
- All 7 codex test gaps explicitly added to v3 test plan.
- Both audits flagged the same root issue (compat-aliases-for-PR-1 broken). v3's response is to merge PR-1 through PR-4 of v2 into a single PR-1 — this changes the iteration shape but preserves test gates within the PR (commit-by-commit reviewable).

---

*Audit-diff complete. v3 is ready for user approval.*
