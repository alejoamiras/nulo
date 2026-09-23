# Harden Bugs Report — Production-Readiness Round

**Repo:** nulo | **Date:** 2026-08-22 | **Effort:** solo deep pass (subagent fan-out) | **Run ID:** 2026-08-22-production-ready
**Scope:** `apps/extension` + workspace dependency closure (`wallet-core`, `wallet-crypto`, `extension-messaging`, `aztec-runtime`, `wallet-bridge`, `bridge-core`, `wallet-sdk-schema-patch`; `design` logic-bearing pieces only). Excluded: apps/faucet/playground/landing, generated catalogs, vendored frozen-artifact internals, test/e2e code itself.
**Method orientation maps:** [raw/repo-map/](./raw/repo-map/) · **Raw cluster scans:** [raw/](./raw/) · **Proof tests:** [proofs/](./proofs/) (`RED-evidence.txt`)

## Executive summary

This run audited the extension for correctness bugs reachable in normal operation, weighting recently landed surfaces (KDF v2 crypto stack, account import/export page flows, popup enter-lifecycle consolidation) heaviest. Twenty-eight findings survive adjudication: **1 Critical, 10 Major, 11 Minor, 6 Low**, each with a concrete counter-example; six carry executing RED proofs ([proofs/](./proofs/)) that fail against current HEAD and become green regression pins when fixed.

The headline result cuts both ways. The freshly rewritten crypto core came through remarkably clean: the KDF v2 derivation chain, the DEK isolation model, envelope MAC v2, and the passkey master reduce survived two independent scan lenses with zero data-level findings — the vector discipline is doing its job. The defects cluster instead at the *seams the new code didn't touch*: lifecycle races around MV3 service-worker wakes (N-02, N-05), stage machines missing entry latches or error boundaries (N-01), and a recurring pattern this audit adds to the known "capture generation → await → compare-and-commit" family — **async work that outlives the authority or context that started it** (N-03, N-04, N-08, N-14).

Three findings deserve immediate attention before any production exposure:

1. **N-01 (Critical)** — the full-backup export page has no re-entry latch and no error boundary: an SW restart mid-loop strands the UI on an eternal spinner with leaked ports and plaintext key material parked in module memory, and a narrow interleaving ships a backup file that fails its own checksum on import.
2. **N-02 (Major, launch-blocking)** — every ambient service-worker wake re-runs the migration engine and spends one unit of its durable retry budget; three ordinary tab reloads during a transiently-failing migration flip the recovery screen from "restart to retry" to "reinstall the extension." Dormant today only because no real migrations exist yet — it arms itself at launch.
3. **N-04/N-09 (Major)** — identity-binding gaps: a live dApp channel silently re-binds to whichever profile unlocks next, and a stale destructive-notification modal deletes whichever profile is active at click time.

The single highest-leverage structural fix is a shared **ownership token for `Lock`** (N-11): the watchdog double-release hazard is pinned as known-deferred, but this run supplies its first concrete production-shaped counter-example (N-17's resurrection of purged token records rides exactly this theft), and ~14 production locks inherit the fix at once.

## Methodology

Solo orchestration per owner instruction — one model family, no cross-model legs. Three phases of subagent fan-out: **7 mapping agents** (process topology, user-journey traces, state-owner census, crypto/session model, transport/dApp surface, fresh-diff since 2026-08-08, execution/pollers/storage survey) produced the orientation maps in [raw/repo-map/](./raw/repo-map/); **15 scanning agents across 12 clusters** (fresh clusters double-covered with independent async-concurrency and data/validation lenses) produced raw findings with mandatory structured certificates; **adjudication was performed personally** — every Major+ candidate was re-verified against source by direct file reads before acceptance, disputes between scanners were resolved by reading the disputed lines, and converged claims were merged keeping all instances. Clean-room rule honored: prior audit reports under `audit/bugs/*` were neither read by scanners nor used as seeds; self-correction is inherent (a claim matching already-fixed behavior fails its proof).

Honest deviations: (1) Phase-4 blind verifier agents were folded into personal source-level verification — stronger than rubber-stamp risk mitigation, but single-model judgment; compensating control is the RED-proof requirement, which turns "confirmed" into "executes." (2) Two scanner outputs arrived truncated and were recovered via session resume / reconstructed with explicit verify-before-accept flags (C2). (3) Finding density (28 vs the ~1.2/cluster heuristic) reflects deliberate retention of structurally distinct minors rather than negative-list failure — the Major band is 11.

## Findings

Severity anchors: **Blocker** = persistent loss/crash on common path · **Critical** = high-impact, conditional · **Major** = user-visible feature behavior · **Minor/Low** = limited or rare. Confidence: high = traced end-to-end in source this session; moderate = mechanism verified, trigger compound.

---

### [CRITICAL] N-01: Full-backup export has no re-entry latch, no error boundary, and a stale-checksum window

**Confidence:** high | **Type:** race / bad error path | **Found by:** F2a + F2b (converged) | **Proof:** recipe (component-level)
**Instances:** `apps/extension/src/popup/pages/settings/security/export/full.vue:102` (no latch), `:164` (status set after awaits), `:169`+`:193-198` (shared module binding + unguarded loop), `:200` (hash/assign gap), `:245-258` (Enter default branch re-fires during progress), `:118-128` (concurrent-ceremony error misclassified → navigate-away).

**Counter-examples:** (1) Click Create Backup, press Enter again while PBKDF2 runs (~0.5–3 s): two concurrent builds share module-level `backup`; the loser's in-flight RPCs are rejected mid-loop by the winner's `disconnect()` → unhandled rejection, ports leaked. (2) Any `client.backup()` throw (SW restart, 60 s timeout on the PXE-heavy leg): loop has no try/catch → `backupStatus` sticks at `"progress"` forever, CTAs disabled, no error surfaced, plaintext master/entropy/DEK unreachable in module memory. (3) Two runs interleaving the stringify→await-hash→assign at :200 can ship a file whose embedded checksum matches neither body — import rejects a pristine backup as tampered.

**Violated invariant:** a stage machine latches re-entry at entry and guarantees teardown on every exit path; an exported artifact must satisfy its own integrity gate. The sibling import flow implements exactly this (`useFullBackupImport.ts:497, :833-842, :980-983`).
**Fix (smallest):** latch first line (`if (status === "progress" || status === "encrypting") return`); flip status before crypto awaits; wrap slice loop in try/catch/finally disconnecting all clients; compute checksum and download body from ONE snapshot string; restrict Enter default branch.

---

### [MAJOR] N-02: Ambient SW wakes burn the migration retry budget — recoverable block auto-escalates to "Reinstall the extension"

**Confidence:** moderate→high (every link verified; dormant until first real migration ships) | **Type:** lifecycle design gap | **Found by:** C3 | **Proof:** RED ✓ `c3-1-migration-ambient-burn.proof.test.ts`
**Instances:** `apps/extension/src/wallet/index.ts:103-111` (module-top-level start), `:91-99` (alarm shim driver); `apps/extension/src/wallet/runtime.ts:143-175`; `packages/wallet-core/src/migration/migrator.ts:246, :254, :56` (attempt bump + terminal at ≥3); `apps/extension/src/components/MigrationBarrier.vue:21-32` (terminal copy).

**Counter-example:** update ships migration N; `up()` throws transiently (storage pressure — converted to retryable). User goes back to browsing; dApp tabs reload, each firing a cold-wake message → full boot → attempt++. Within minutes-to-hours of ordinary activity attempts hit 3 → `terminal: true` → barrier instructs destructive reinstall. With the price alarm surviving into the blocked regime (pre-Chrome-150 update semantics), the burn cadence is machine-driven every 3 min.

**Violated invariant:** `runtime.ts:107-122`'s own contract — the veto exists so a retry loop can't "flip a recoverable block to terminal without a single real boot"; it only stops same-lifetime retries, while arbitrary cross-boot wake traffic achieves exactly that.
**Fix:** short-circuit at `doStart()` entry — if a non-terminal blocked status is persisted, skip engine re-run and rethrow directly; optionally add a cool-down timestamp.

---

### [MAJOR] N-03: `createAccount` writes an unfenced profile-scoped row racing `deleteProfile` — orphan survives every purge

**Confidence:** high | **Type:** lost update / incomplete deletion | **Found by:** C1 | **Proof:** recipe
**Instances:** `apps/extension/src/wallet/services/account/service.ts:205` (single entry gate) → `:216-218` (slow probe + derivation) → `:229-230` (unfenced write + emit); contrast `transaction/service.ts:180-184` (the correct D13 pattern).

**Counter-example:** bootstrap fires `ensureDefaultAccount(X)`; the auth gate passes and the lock releases; a custom-network L1 probe takes seconds; user confirms delete X — snapshot harvests current addresses, tombstone written, purge runs; the creation resumes, writes the new address row, emits. Phase-2 purge covers only snapshot addresses; `resumePendingDeletions` replays the same tombstone. The derived-address row outlives the erased profile forever.
**Fix:** capture secret+epoch atomically (`getSecretWithFence`) and `deletionState.assertCurrent(profileId, epoch)` immediately before the durable write — mirror the transaction service.

### [MAJOR] N-04: Live dApp channels silently re-bind to whichever profile unlocks next

**Confidence:** high | **Type:** authorization-binding gap | **Found by:** C6 | **Proof:** recipe
**Instances:** `wallet-sdk/background.ts:681-688` (ctx from CURRENT active profile), `:392-423` (profile-change listener drains discoveries only — never terminates sessions); `dapp-session/service.ts:114-129` (lookup keyed to active profile); `dispatcher.ts:1328`.

**Counter-example:** profiles A and B both granted dApp X historically (two rows). Unlock A, connect X. Lock; unlock B (same tab). The encrypted channel survives — teardown triggers are session-delete/tab-close/nav/failure/TTL only. X calls `simulateTx`: ctx carries B's profileId, capability lookup finds B's row, B's private state returns over the A-era channel. Silent readers (simulate/getPrivateEvents/getAddressBook) cross identities without any prompt.
**Fix:** terminate tuple-matching live sessions in the existing `onActiveProfileChanged` listener (same shape as the `onDappSessionDeleted` handler), or stamp establishing-profileId onto the transport session and refuse mismatched dispatch.

### [MAJOR] N-05: Superseded network-watcher run survives `disconnect()` via pre-registration RPC immunity — lands cross-chain active account

**Confidence:** high mechanism / compound trigger | **Type:** missing fence + transport immunity | **Found by:** F4b | **Proof:** recipe
**Instances:** `popup/app.vue:100-131`; `packages/extension-messaging/src/core/base-client.ts:121` vs `:143` (readiness await precedes pending registration); `background/client.ts:66-78` (rejects only registered pendings).

**Counter-example:** SW restarting; watcher run WA swaps clients and issues `getAccounts(chainA)` which suspends in readiness (not yet registered). Flip A→B completes; WB's `managers.account.disconnect()` cannot reject WA's unregistered request; SW returns; WA resolves LAST — overwrites `appStore.accounts` with chain-A rows, then `setupActiveAccount` captures LIVE scope `(P,B)` (matches!), pointer lookup fails, falls back to `accounts[0]` = a chain-A account → active account points at the wrong chain until the next flip/reopen.
**Fix:** capture target network/profile ids synchronously at watcher entry and bail after every await on mismatch (same `isCurrent` pattern as `useProfileBootstrap`).

### [MAJOR] N-06: Orphan imported-key sweep deletes signing keys hidden by the RETAIN-on-bad-row policy

**Confidence:** high | **Type:** cleanup-assumes-completeness | **Found by:** C5 | **Proof:** recipe
**Instances:** `account/service.ts:114-127` (sweep), `:97-103` (`liveRows` decoded view) vs `imported-keys-repository.ts:49-56` (raw enumeration); hiding at `entity_storage.ts:84-91`.

**Counter-example:** an Imported account row becomes parseable-but-schema-invalid (corruption/version skew). It stays stored but vanishes from `getAll()`. Boot sweep compares decoded account keys against RAW imported-key ids → sees the key row as orphaned → deletes the sealed signing key. Result: permanently un-signable imported account; key material unrecoverable.
**Fix:** build the live-set from `rawStringEntries()` + row-id parse (mirror of `allRowIds`), or refuse deletion when raw bytes exist at the composite id.

### [MAJOR] N-07: Session-FIFO queued dApp requests cross the reaper's grace while legitimately waiting — approved ops get cancelled

**Confidence:** moderate (mechanism verified; needs ≥10 min head-of-line hold + same-session queue) | **Type:** bad timeout premise | **Found by:** C2 | **Proof:** RED ✓ `c2-1-reaper-vs-fifo-waiter.proof.test.ts`
**Instances:** `operation-journal/reaper.ts:72-82` (queued grace = 10 min, justified by "background crashed" premise); heartbeat coverage starts only at lane wait (`execution-lane.ts:243, :287-302`), not at wallet-sdk FIFO wait; `claim-helper.ts` rejects non-{queued,pending} stages.

**Counter-example:** one dApp queues 3 sends; user approves sequentially, spending ~6 min per approval popup. Sibling #3's record sits `queued` >10 min → reaped `stuck_queued`→failed. Its popup then opens, the user approves, and claim hits `JobCancelledSentinel` — an explicitly approved operation reports cancelled.
**Fix:** extend the existing executionWaiters heartbeat to session-FIFO waiters, or key the grace on claim-eligibility rather than age alone.

### [MAJOR] N-08: `auth.vue` unlock continuation lacks identity guard — stale-profile hijack (cross-context) and bricked spinner on bootstrap failure

**Confidence:** moderate | **Type:** wrong-entity post-await write / unhandled rejection | **Found by:** F4a (scope corrected in adjudication) | **Proof:** recipe
**Instances:** `auth.vue:82-84` (busy-wait), `:107-118` (unguarded writes); contributing `app.vue:133-146` (listener rejection unhandled), `useProfileBootstrap.ts:139-165`.

**Counter-example A (cross-context):** popup unlocks A and spins waiting for `isLogined`; a side panel (same shell, `manifest.config.ts:28`) unlocks B → broadcast aborts A's bootstrap and sets `isLogined` via B's; BOTH popups' continuations resume nondeterministically — the stale one repoints `appStore.profile` to A, replaces `managers.account`, routes home, while the background session is B. UI claims A; sends execute under B.
**Counter-example B (single-context brick):** any RPC failure inside `bootstrapActiveProfile` propagates out of the event listener → `isLogined` never set → spinner forever, `isAwaitingResponse` latched (finally unreachable).
**Fix:** after the wait, bail unless `appStore.profile?.id === activeProfile.id && appStore.isLogined`; wrap the bootstrap call site and release the latch on rejection.

### [MAJOR] N-09: Stale aztecReset modal deletes whichever profile is active at click time

**Confidence:** moderate (mechanism verified; trigger requires sentinel bump × multi-context switch) | **Type:** stale closure on destructive action | **Found by:** F4a; exploitability disputed by F4b, resolved in adjudication (side-panel co-context confirmed) | **Proof:** recipe
**Instances:** `composables/notification.js:27-32`; render site `auth.vue:120`; persistence gap `app.vue:136-145` (lock branch clears popups/activity, not notifications).

**Counter-example:** sentinel bumped by an update → stale-sentinel users get the blocking "Delete Profile" modal (autoDestroy: false). While it sits open, another context (side panel) unlocks profile B; the broadcast re-points `appStore.profile`. Clicking Delete runs `deleteProfile(appStore.profile.id)` → deletes B — irreversible keystore deletion of the profile the wallet is now showing.
**Fix:** capture the profile id when building the template and close over it; belt: purge notificationStore in the lock branch.

### [MAJOR] N-10: Balance projection commits values computed under a departed profile context (A→B→A disarm)

**Confidence:** moderate→high | **Type:** generation-fence gap | **Found by:** C4 | **Proof:** recipe
**Instances:** `token-balance/balance-job-queue.ts:186-293` (no gen capture/check; commit gated only by tokens-map membership :250/:256/:264); enabled by `balance-projector.ts:157` + view-deps resolving the LIVE active profile mid-projection.

**Counter-example:** shared-address profiles A/B; batch projecting A's token starts; switch to B mid-chunk (PXE/network handles now resolve against B); switch back to A — the tokens map repopulates, disarming the emittable check; the in-flight result commits B-derived balances onto A's row with fresh updatedAt. Wrong private balance displayed until the row's next successful refresh.
**Fix:** capture `profileGeneration` at syncBatch entry and bail after the projector await and again before the write; alternatively freeze resolved handles per batch.

### [MAJOR] N-11: `Lock` watchdog force-release enables double-release theft across ~14 production locks *(known-deferred, harm now demonstrated)*

**Confidence:** high | **Type:** mutex ownership violation | **Found by:** P1 (+C4-2 concrete harm) | **Proof:** RED ✓ `p1-1-lock-double-release.proof.test.ts`
**Instances:** `wallet-core/utils/lock.ts:63-68, :92-106`; every default-watchdog instantiation incl. journal transitionLock, profile facade lock, incoming-transfer serviceLock, KeyedLock default.

**Counter-example:** H1 wedges >maxHoldMs → watchdog releases → W2 granted and arms T2 → H1 settles → its unconditional `leave()` clears **T2** and unlocks → W3 admitted while W2 holds. Two critical sections execute concurrently inside a mutex everyone believes exclusive.
**Note:** pinned as deliberately-not-fixed in `lock.test.ts:249-287`. Kept Major because N-17 supplies a production-shaped counter-example riding exactly this theft, and the fix is a ~10-line owner token benefiting every instantiation.
**Fix:** mint an owner token per acquisition; `leave(token)` no-ops unless it matches the current owner.

---

### Minor band (certificates condensed; full traces in [raw/](./raw/) + [findings/consolidated.md](./findings/consolidated.md))

| ID | Title | Instances | Fix direction | Proof |
|---|---|---|---|---|
| N-12 | Reader-triggered TTL close runs outside serializer; cancels fresh lock alarm (lazy auto-lock) | `session-manager.ts:174-184`, `service.ts:806-807` | lock-queued in-lock-revalidated close | RED ✓ |
| N-13 | Backup/account file readers lack size caps → popup OOM on mis-picked file | `full-backup-helpers.ts:21,:35`, `files.ts:104` | cap before read/decompress (precedent: 64 KB account cap) | recipe |
| N-14 | Composable rollback races still-running slice restores after timeout-classified failures → orphan rows | `useFullBackupImport.ts:947-978` vs `restore-rows.ts` | tornGuard-style deletion or epoch-fenced slice writes | recipe |
| N-15 | First-tx init trusts single possibly-stale witness → duplicate-init fee burn (+ two-device TOCTOU) | `nulo-account.ts:170-188`, `view-executor.ts:249` | cross-check instance existence; typed duplicate-nullifier error | recipe |
| N-16 | `waitForTx` unbounded → revoke/registry flows hang whole lock period | `transaction/service.ts:221-227`; callers `auth-registry/service.ts:217,:266` | bound the wait; honor task cancellation | recipe |
| N-17 | Note-CS holds serviceLock across PXE call; watchdog theft resurrects purged token records | `incoming-transfer/service.ts:1045-1124`, `lock.ts:63-88` | post-await epoch re-checks (seeder precedent); consider `maxHoldMs:null` | recipe |
| N-18 | SW kill during `up()` bypasses attempt bound → infinite crash-boot loop, no recovery surface (latent until real migrations exist) | `migrator.ts:323-334` | bump attempts on resume-restore path | recipe |
| N-19 | `toJsonSafe` DAG-as-cycle corruption → "[Circular]" in dApp responses | `wallet-sdk/background.ts:761-787` applied at `:695` | prune seen-set on exit / track ancestors only | RED ✓ |
| N-20 | `nextNumericId` consumes alias/huge suffixes → id collapse onto one clobbering key (requires poisoned key) | `id-allocators.ts:14-16`, `arrays.ts:13-21` | reuse `canonicalNumericStorageId` filter | RED ✓ |
| N-21 | PATH-B passkey window timeout (5 min) < legitimate two-leg ceremony (~6 min) → false failure + orphan credential | `passkey/spec.ts:4`, `service.ts:16`, `passkey-ceremony.ts:104-118` | raise budget or thread remaining time | recipe |
| N-22 | EditProfilePopup silent rename failures (only silent catch among 12 consumers) | `EditProfilePopup.vue:86-87` | family-standard error toast | recipe |

### Low band

| ID | Title | Fix direction |
|---|---|---|
| N-26 | `pendingVerification` leak forces spurious emoji re-verify after mid-ECDH tab close | TTL the marker (~90 s) |
| N-27 | Boot probe counts journal rows in session area (always 0; telemetry-only) | read `storage.local` |
| N-23 | RecentActivity reset keyed on address only → foreign progress card after same-address switch | watch the (profile,network,address) triple |
| N-24 | AuthRegistry restore lacks `(account,hash)` dedupe → cloned backup doubles rows vs 255 cap | skip-or-record duplicates like tx restore |
| N-25 | Controller-map leak when claim throws genuine storage error (sentinel paths safe) | delete controller in catch |
| N-28 | ServiceCollection mid-phase failure abandons siblings: mixed liveness + unhandled rejections | allSettled + aggregate; gate handler registration |

## Cheapest fixes first (hours, outsized impact)

1. **N-22** — replace the empty catch with the family toast. Minutes.
2. **N-27** — one-line storage-area fix. Minutes.
3. **N-26** — swap Set for Map + staleness check. Under an hour.
4. **N-09** — capture the profile id at template build; belt-purge notifications on lock. Under an hour; removes the worst irreversible-outcome surface in the UI.
5. **N-13** — early `file.size` cap reusing existing unrecognized-file copy. An hour.
6. **N-11** — owner-token Lock (~10 lines) closes N-11 and de-teethes N-17 simultaneously.

## Cross-cutting observations

- **"Authority outlives its context" is this codebase's dominant residual bug family.** The remediated generation-fence family covered state transitions; what remains is *identity/context* authority: a channel established under profile A serving profile B (N-04), an unlock continuation applying stale identity (N-08), a modal acting on click-time identity (N-09), a projection computed under departed context (N-10), compensation racing uncancellable remote work (N-14). A shared helper ("carry {actor, scope} with every async op; validate before commit") would close five of these by construction.
- **Stage machines are only as strong as their entry latch.** The import side is exemplary (guard + try/finally everywhere); the export side (N-01) predates that discipline. A lint-level convention ("every multi-await handler flips a synchronous latch first") would prevent recurrence.
- **MV3 ambient traffic is an adversary.** Module-top-level work executes on every wake (N-02); anything counted, aged, or swept must assume wakes are free, frequent, and user-unconsented.
- **The crypto core's cleanliness is load-bearing evidence.** Zero data-level findings across KDF v2 under two lenses — keep the reference-vector ritual sacred; it is why this band stayed quiet.

## Coverage statement

Scanned: all four extension contexts' owned code; all background services; both packages' primitive layers; every recently landed feature listed in Map D. Not scanned: upstream SDK internals beyond documented seams, vendored artifact bytes, e2e infrastructure, faucet/landing/playground. Residual risk concentrates where proofs couldn't reach in-process (live offscreen timing, multi-context interactions) — those carry precise repro recipes instead.

**Verdict:** not yet production-hardened, but close. Fix N-01, N-02 (before the first real migration ships), N-03/N-04/N-09, adopt the Lock ownership token, and re-run a delta audit over the fix diffs. Everything else fits comfortably inside normal pre-launch hardening arcs using the prove-first culture this repo already runs on.
