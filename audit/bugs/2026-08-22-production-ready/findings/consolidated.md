# Consolidated findings — adjudicated

Adjudication: dedupe by root cause + failing operation + affected state; every Major+ candidate personally re-verified against source this session (file:line reads); Minor-grade claims carry the scanner's exact line evidence. Converged = found independently by ≥2 agents.

| ID | Severity | Confidence | Title | Cluster | Proof |
|---|---|---|---|---|---|
| N-01 | Critical | high | Full-backup export: no re-entrancy latch, unguarded slice loop, stuck-progress wedge, stale-checksum artifact | F2 (converged ×2) | recipe |
| N-02 | Major | moderate→high | Migration retry budget burned by ambient SW wakes → auto-escalates to terminal "Reinstall" | C3 | RED ✓ |
| N-03 | Major | high | `createAccount` writes unfenced profile-scoped row racing `deleteProfile` → permanent orphan | C1 | recipe |
| N-04 | Major | high | Live dApp channel silently re-binds to whichever profile unlocks next | C6 | recipe |
| N-05 | Major | high | Superseded network-watcher run survives `disconnect()` (pre-registration immunity) → cross-chain active account | F4b | recipe |
| N-06 | Major | high | Orphan imported-key sweep deletes signing keys for codec-hidden account rows | C5 | recipe |
| N-07 | Major | moderate | Session-FIFO queued dApp requests exceed reaper's 10-min queued grace → approved ops cancelled | C2 | RED ✓ |
| N-08 | Major | moderate | `auth.vue` busy-wait continuation lacks identity guard → stale-profile hijack (cross-context) + bricked spinner on bootstrap RPC failure | F4a | recipe |
| N-09 | Major | moderate | Stale aztecReset modal deletes whichever profile is active at click time (multi-context trigger) | F4a/F4b dispute resolved | recipe |
| N-10 | Major | moderate→high | BalanceJobQueue has no generation fence inside syncBatch → A→B→A commits wrong-profile balance | C4 | recipe |
| N-11 | Major | high (known-deferred) | `Lock` watchdog double-release steals the new owner's hold (~14 production locks) | P1 (+C4-2 harm) | RED ✓ |
| N-12 | Minor | high | Reactive TTL close runs outside serializer, cancels fresh lock alarm (lazy auto-lock) | F1a | RED ✓ |
| N-13 | Minor | high | Backup/account file readers have no input size cap → popup OOM on mis-picked file | F2 (converged ×2) | recipe |
| N-14 | Minor | high | Composable rollback races still-running slice restores after timeout-classified failures → orphan rows | F2a | recipe |
| N-15 | Minor | medium-high | First-tx init decision trusts single possibly-stale node witness → duplicate-init fee burn | P1 | recipe |
| N-16 | Minor | high | `revokeAuthwits`/`setRegistryEnabled` hang while locked (`waitForTx` unbounded) | C1+C2 (converged) | recipe |
| N-17 | Minor | high | Incoming-transfer note-CS holds serviceLock across PXE call; watchdog theft resurrects purged token records | C4 | recipe |
| N-18 | Minor | medium-low | SW kill during `up()` bypasses durable attempt bound → infinite crash-boot loop, no recovery surface (latent until first real migration) | C5 | recipe |
| N-19 | Minor | high | `toJsonSafe` DAG-as-cycle corruption → "[Circular]" in dApp responses | C6 | RED ✓ |
| N-20 | Minor | medium | `nextNumericId` consumes alias/huge suffixes → id collapse onto one clobbering key (needs poisoned key) | C5 | RED ✓ |
| N-21 | Minor | medium | PATH-B passkey window timeout (5 min) < two-leg WebAuthn ceremony (~6 min worst case) | F3a | recipe |
| N-22 | Minor | high | `EditProfilePopup` swallows rename failures with zero feedback | F4a | recipe |
| N-23 | Minor | medium | RecentActivityView reset keyed on address only → foreign progress card survives same-address profile switch | F4b | recipe |
| N-24 | Minor | high | `AuthRegistryService.restore()` no `(account, hash)` dedupe → cloned backup doubles authwits vs 255 cap | C1 | recipe |
| N-25 | Minor | medium | Controller-map leak in `runInSlot` when claim throws genuine storage error | C2 | recipe |
| N-26 | Low | high | `pendingVerification` marker leak forces spurious emoji re-verification on trusted reconnect | C6 | recipe |
| N-27 | Low | high | Boot storage probe counts journal records in session area (always 0) — telemetry only | C5 | recipe |
| N-28 | Low | medium | ServiceCollection mid-phase failure abandons sibling starts: mixed liveness + unhandled rejections | P1 | recipe |

## Adjudication notes

- **F4a-1 vs F4b dispute resolved (N-09):** the full-screen overlay blocks same-context interaction, but the side panel hosts the SAME shell (`manifest.config.ts:28-30`, `default_path: src/popup/index.html`), and a switch there re-points the popup's `appStore.profile` via the broadcast listener while the modal is up. Trigger additionally requires a stale sentinel (`package.json#sentinel`, manually bumped — rare). Downgraded Critical→Major for frequency; impact remains irreversible deletion of the WRONG profile; fix trivial.
- **F4a-2 scope corrected (N-08):** the disabled submit button blocks the scanner's exact same-context second-unlock path (`auth.vue:224`). Realistic triggers are cross-context (side-panel unlock races the popup's continuation) and the un-guarded bootstrap-failure spin (`isAwaitingResponse` latched forever when a bootstrap RPC rejects — reachable single-context).
- **P1-1 known-deferred:** pinned in `lock.test.ts:249-287`. Kept as Major because C4-2 supplies a concrete production-shaped counter-example (watchdog theft during a 5-min PXE stall resurrects purged token records), and the blast radius spans ~14 locks.
- **C3-1 latent-today:** `realMigrations` is empty pre-production, so the burn is dormant until the FIRST real migration ships — which per repo policy is exactly at production launch. Treat as launch-blocking.
- Dropped during reduce: classGateCache-not-swept lead (no user-visible consequence constructible — keys carry CSPRNG profileId + byte-exact tip/hash gates); selectAccount-bypass lead (both production callers already wrap it); cache.store closure-clobber lead (all writers gesture-gated behind blocking modals); NewSender premature-submit (registerSender idempotent).
