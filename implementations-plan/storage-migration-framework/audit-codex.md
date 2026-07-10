# Codex audit — storage-migration-framework plan (Round 1)

Session: `019f19d8-7a9b-7d20-a1b7-42e5fc971471` · effort xhigh · read-only.

**Verdict:** `conditional approve (with conditions: fix IDB delete failure semantics, move or reload config around genesis, define marker validation/downgrade behavior, make the lock genuinely shared or narrow the claim, correct journal/local wipe inventory, and make phases 1-3 atomic)`

**A-vs-B:** Pick **Plan A over Plan B**, but tighten it. Plan B repeats the backend/lock blind spots M4 called out. Plan A's real value is **injected backend-aware ports + tests**, not `wallet-core` placement per se. If wallet-core is used, keep it a **pure runner/types package** and leave all IndexedDB semantics in the extension adapter.

## Critical
- **IDB delete failures swallowed** (`migrate.ts:82/:87`). Stamping last isn't enough: `deleteDatabase()` resolves on `onblocked`, and the runner stamps after IndexedDB enumeration/delete errors. The IDB adapter must treat `onblocked`, unsupported enumeration, and delete errors as migration **failure**, no marker stamp — else stale PXE DBs survive forever under `nulo:schema:version=1`.
- **Config loaded before migration** (`runtime.ts:95/:105`, `config/store.ts:17`). Genesis wipes `nulo:config`, but runtime loads config before migration → stale, security-sensitive `strictSecurityMode` lives in memory the whole boot. Malformed `nulo:config` can also abort before migration runs. Move migration before `config.load()` or force a post-genesis config reload/reset.

## High
- **Marker parsing underspecified** (`plan.md:41/:43/:101`). "Marker present at N" must define behavior for string/float/NaN/negative/huge/JSON/corrupt. Treat persisted state as hostile: validate safe-integer range, fail closed, decide explicitly whether an invalid marker means genesis or blocked startup.
- **"Shared migration lock" overclaimed** (`wallet-core/src/utils/lock.ts:6`). The existing `Lock` is in-memory only; it won't serialize separate runtime instances, popup direct storage writes, or an already-running offscreen. Either implement a real extension-wide lease or narrow the claim to boot-only single-flight.
- **Journal fact is stale** (`operation-journal/service.ts:86/:97`, `migrate.ts:77`). `nulo:journal@…` is now in `chrome.storage.local`, not session. Genesis must wipe local `nulo:journal@` or stale operation records survive.
- **Profiles preservation not airtight until wipe strategy is concrete** (`profile/repository.ts:22`). Don't use broad `nulo:core:` prefix removal. Use explicit allow/deny tested prefixes with adversarial fixtures for `nulo:core:profiles`, `…profiles@id`, `…profiles@id.extra`, session keys, PXE DB names.

## Medium
- **Offscreen-held IDB across SW lifetime** (`pxe/service.ts:149/:183`, `offscreen.ts:205`). Boot-before-services isn't enough if a prior-lifetime offscreen PXE still holds IDB connections. Genesis should close/kill the offscreen before deleting PXE DBs, then verify deletion before stamping.
- **Phase 1 "old call shape until Phase 3" is risky** (`plan.md:80`). Marker + genesis + engine should land atomically; a half-step using the old equality-gated runner reintroduces the int-direction trap.
- **Package exports** (`wallet-core/package.json:6/:14`). If Plan A exports `@nulo/wallet-core/migration`, the package `exports` map must be updated; the plan doesn't call this out.

## Low
- **BalanceView** (`BalanceView.vue:198/:221`). Removing the lazy migration is fine, but genesis must wipe both old and new keys; the old-key path can dereference `optionsMap` when the old value is falsy. Test the default path.

## Facts / Inferences / Asks
- **Facts misstated:** journal backend is local now. "One caller" true for `runStorageMigration`, but boot isn't the only storage actor — popup/onboarding read/write Chrome storage directly. wallet-core bans `chrome.*` AND its README says no I/O → keep core strictly adapter-free.
- **Unsafe inferences:** "genesis delete-only has little untrusted-input risk" too optimistic (version/config parsing + key enumeration are still untrusted). "Lock resolves blocker ③" unsafe without a cross-context lease. "Fresh install wipe is harmless" only true if onboarding/UI keys excluded or races handled.
- **Asks to surface:** confirm wiping `nulo:config` (resets strict/security + prefs); confirm exact genesis inventory; confirm downgrade behavior for marker > code max; confirm whether Firefox IndexedDB enumeration support matters this release.

## Phase/Gate judgment
Scripts exist, but gates need sharper pass criteria. Add tests for invalid markers, blocked IDB delete, offscreen-held DB, local journal wipe, config-load ordering, profile-prefix adversaries. E2E must seed BOTH Chrome storage AND IndexedDB in the same browser profile, then verify DB absence after restart. `audit:vue` proves build health, not migration ordering.

---

# Codex — Round 2 (final fresh-context pass)

Session: `019f19e5-83ae-7db1-bc9e-683ac78ac8cc` · NEW session (not a resume) · xhigh · read-only. Given plan v2 + decision ledger + both round-1 audits.

**Confirms Plan A-minus.** "Plan B still re-entrenches the old Chrome-coupled blind spots, and full Plan A is still too much. A-minus is the right decision, but v2 is not clean yet."

**Verdict:** `conditional approve (with conditions: make DeleteOutcome enforceable by the engine; add migration-specific fail-closed PXE deletion; fix Firefox chainId/offscreen fallback; keep the migration guard outside wiped session; split held-open and partial-wipe retry gates; bound accepted marker versions)`

## Critical
- **DeleteOutcome unenforceable** (plan §4.2). `up(ctx): Promise<void>` + `ctx.indexedDb.delete(): Promise<DeleteOutcome>` lets the migration body ignore `blocked`; the engine never sees it. Make the IDB port THROW on non-deleted, or have `up` return collected outcomes. → folded: port throws `MigrationBlockedError`.
- **"Delegate via existing blocked-aware path" is unsafe** (`pxe/service.ts:156/161/463` delete only orphans + resolve on `onblocked`). Genesis needs its own migration-specific fail-closed deletion. → folded.

## High
- **Firefox name fallback not implementable "from preserved profiles"** — profiles have no chainId (`profile/spec.ts`); chainIds are on network rows (`network/spec.ts:28`) which genesis wipes. Snapshot networks before wipe / fail closed. → folded.
- **"Close offscreen before wipe" incomplete on Firefox** — a leaked post-SW-restart hidden window can't be closed without `tabs` (`offscreen.ts:103/183`). Handle or don't claim fail-closed on Firefox. → folded (Firefox fails closed → retry).
- **The migration guard deletes itself** — plan wipes all session but puts `nulo:schema:migrating` in session. → folded: in-memory SW readiness gate.

## Medium
- **Phase 3 conflates held-open-DB vs blocked-delete-retry** — split the gates; add a partial-wipe retry test. → folded.
- **Marker validation needs a hard upper bound** — `0..currentMaxVersion`, else `999999`/future-`2` skips genesis. → folded.

## Low
- "deletion-done-right at pxe/service.ts" is a misstated Fact — it's awareness/logging, not fail-closed. → Fact corrected.
- §8 Asks 2 & 3 should be **pre-Phase-2 approval gates**, not late confirmations (they define destructive + hostile-marker behavior). → elevated to the approval gate.

---

# Codex — Round 3 (data-preserving design, plan v4) — REJECT

Session: `019f1dc0-fd8e-7483-837e-aeb26942e26e` · xhigh · read-only. (Rounds 1–2 above audited the earlier WIPE design, now scrapped.)

**Verdict:** `reject (with blocking findings: direct chrome.storage.local readers/writers can race migration; checkpoint/restore lacks a durable crash-safe state machine; session storage is incorrectly included under a local global version)`

## Critical
- **Direct-UI read race NOT mitigated by an in-memory SW gate.** `runtime.start()` is fire-and-forget (`wallet/index.ts:75-82`); direct `chrome.storage.local` access in `composables/syncedRef.js:7-15`, `stores/app.store.ts:34-39`, `BalanceView.vue:229-237`, `FeeSettingsCard.vue:215-247`. A SW promise only protects RPC paths. Fix: all pages await a migration-ready signal before mounting storage consumers, OR all storage goes through a migration-aware facade. Add an e2e that holds migration mid-flight, opens the popup, proves no old-shape read/write.
- **Checkpoint/restore underspecified + inconsistent.** "1…N-1 durable" (plan:32) vs "restore pre-migration backup" (plan:33/72) contradict; writes are piecemeal (`chrome-browser-api.ts:47-52`, `entity_storage.ts:75-80`). Needs a durable phase journal: backup saved → migration N `running` → writes → version stamped → `running` cleared. On boot, `running` restores before retry; restore-fail ⇒ fail closed, keep backup.

## High
- **Session doesn't belong under a durable local version** (plan:25 exposes `ctx.session.*`; marker+backup local-only, plan:33/71). Session is ephemeral (`storage-port.ts:1-5`), holds the passhash bearer (`profile/spec.ts:31-35`, `session-manager.ts:211-218`). Remove session from v1 or give it a separate non-durable path.
- **Test fixture must be BUILD-TIME excluded**, not a writable `nulo:test:*` flag (plan:46/75). Use the existing trust-boundary pattern: absence from prod bundle + negative grep (`e2e/chrome-storage-proof-gate.ts:37-43`).
- **Stale legacy-key path silently blesses unknown old data** (plan:37-39). A non-reinstalled dev with stale rows + `nulo:core:storage-version` gets stamped max; readers later drop malformed rows (`entity_storage.ts:47-59`). Make (stale marker + existing roots) fail closed with reinstall/dev-reset instructions, or a one-time legacy bridge.
- **Backup retention stricter.** Snapshot includes encrypted profile secrets + credential IDs (`profile/spec.ts:18-28`) — ciphertext, but doubles sensitive local state. Never keep last-N; exclude backup keys from snapshots; clear after success AND after successful restore; clean orphans only when no `running` marker.

## Medium
- **Narrow-slice API insufficient for safe backup** (plan:25). Engine needs migration metadata declaring read/write roots + value keys BEFORE `up()`, else "snapshot affected state" (plan:33) becomes "backup all local." Add `localRows`/`localValues`/delete ops to the Migration type.
- **Move crypto-README fix to Phase 2** (where `migrate.ts` is deleted), not Phase 4 (`wallet-crypto/README.md:37`).
- **Gates don't prove adversarial properties.** Add SW-kill tests at each phase boundary (backup-before-marker, marker-before-write, partial-write, write-before-checkpoint, restore-failure) + the popup direct-storage race. Phase 3's two-spec e2e is necessary but insufficient.

## Facts/Inferences/Asks
- Facts: config.load runs before migration + writes normalized config back (`config/store.ts:17-21,:55`) → moving migration earlier is required. Passhash is in session, not local profiles.
- Inferences: single global version is conditionally OK for durable local ONLY; the MetaMask study itself warns global-version maps poorly to multiple backends (`research/metamask-migrations.md:210-214`). Narrow-slice right only WITH declared roots + a recovery protocol. Always-backup OK only for pending local migrations, not a retained debug artifact.
- Asks: block on race fix, durable phase journal, session exclusion, build-time fixture exclusion, stale-legacy behavior.

---

# Codex — Round 4 (final pass on v5) — REJECT

Session: `019f1e45-f7e0-7da1-bdc2-8c3f0c65e0ca` · xhigh · read-only.

**Verdict:** `reject (with blocking findings: C1 barrier order/coverage; backup blob/live ctx abstraction plus compatibility-gate split; crash-safe journal retry/restore contract and gates)`

**C1–C4 status:** C1 not resolved (barrier order + coverage); C2 partial (barrier/journal edges underspecified); C3 resolved (exact DCE + grep); C4 resolved for the crypto truth (backup-gate split still required).

## Critical
- **C1 barrier ordering.** Backup is written BEFORE `running=N` is set (plan:40), but `running` IS the barrier (§3.7). A popup can mount during async SW startup (`wallet/index.ts:75-83`) and write old-shape data before the barrier exists. Need a durable `preparing/running` state set BEFORE backup capture, with resume semantics for "barrier set but no complete backup."
- **Facade coverage unenforced.** More raw local readers than v5 lists: `new-profile-helpers.ts:36`, `NewAccountPopup.vue:56`, `settings/fpcs/index.vue:87-95`, `lastActiveProfile.ts:8-13`, `utils/core.ts:143-148` + the named ones. Phase 3 requires only component tests, not a STATIC ban/allowlist proving ALL UI/popup/onboarding storage goes through the facade.
- **Backup ≠ live representation.** Live = EntityStorage rows (`entity_storage.ts:83-90`); backup = service-name arrays built at export (`export/full.vue:127-141`) + restored by service clients (`useFullBackupImport.ts:381-402`). `ctx.local.rows(root)` can't faithfully back both without explicit root↔backup-slice mapping, ID-key mapping, config-value mapping, missing-root semantics, parity tests.
- **Compat gate not separate.** The "custom account contracts" rejection IS `schema-version !== 2` (`useFullBackupImport.ts:216-223`); export writes no separate crypto/account epoch. Repurposing `schema-version` as the data version makes incompatible backups indistinguishable from migratable old data → need a new non-migratable compatibility field.

## High
- **C2 partial.** Stamp-then-crash covered IF boot handles `running` before trusting `version`, but multi-root writes are "batched where possible" (too vague); the port has separate `set`/`remove` (`storage-port.ts:18-32`). Need a concrete batched diff/restore contract incl. absent-key tombstones for deletes/creates. Run-twice ≠ enough for prefix-torn states unless restore is complete + idempotent first.
- **Retry policy undefined.** Where is the attempt counter stored? Crash-safe? OUTSIDE the restored footprint (else restore resets it → infinite retry)? Wiped on reset/uninstall?
- **Corrupt marker.** Treating out-of-range/corrupt as fresh (plan:55) is dangerous for a data-preserving framework — corrupt marker + existing roots should FAIL CLOSED / require recovery, not init-at-max-skip-all.

## Medium
- Gates don't prove properties: Phase 3 needs a static "no raw `chrome.storage.local` outside the facade" check; Phase 4 needs backup-parity/missing-root/checksum-order/compat-epoch tests; Phase 5 needs the journal kill-points (backup-before-marker, marker-before-write, stamp-before-clear, restore-partial-fail).
- C3 resolved IF implemented as static-false conditional spread + negative bundle grep (`chrome-storage-proof-gate.ts:37-43`, `_build-extension.yml:74-80`).
- C4 crypto truth resolved; remaining issue is the backup compat-epoch split.
