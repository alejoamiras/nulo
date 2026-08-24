# Cluster C5 — storage layer + migration engine + backup trust gates

> Scanner: general agent, 2026-08-22. Engine itself well-armored (full hostile-journal matrix tested); findings live at seams between RETAIN-on-bad-row read policy and consumers assuming list() completeness.

## C5-1 — Imported-account orphan sweep deletes signing keys for codec-hidden account rows

**Severity:** Medium | **Repro confidence:** high (mechanism certain; trigger = any schema-invalid-but-parseable Account row: version skew, corruption preserving JSON validity) | **Type:** RETAIN-on-bad-row × cleanup-assumes-completeness

**Counter-example:** An Imported account row at nulo:core:accounts@p|1|0xabc becomes parseable-JSON but fails AccountSchema (field type-drift after storage bit-corruption). Boot: sweepOrphanImportedKeys builds live-set from liveRows() → getAll() → decodeRow returns undefined → row silently absent from accountKeys. importedKeys.allRowIds() enumerates via RAW stringEntries (codec-free), sees key row, finds no matching account → deletes nulo:core:imported-keys@p|1|0xabc. Account row deliberately KEPT (RETAIN policy) → wallet holds permanently un-signable imported account; encrypted key material gone, cannot be regenerated. Sweep runs fire-and-forget every boot until success.

**Violated invariant:** both sides of 1:1 (accountRowId) pairing must be enumerated under SAME visibility policy; "imported-key row with no matching Account row is dead weight" only holds if account-row absence is authoritative — KEEP-but-hide read path breaks that.

**Failing path:** account/service.ts:114-127 (sweep) + :97-103 (liveRows codec filter) vs imported-keys-repository.ts:49-56 (raw allRowIds); hiding at entity_storage.ts:84-91.

**Smallest fix:** build accountKeys from account root's rawStringEntries() + parseAccountRowId (mirror of allRowIds), or refuse deletion when storage.rawValue(compositeId) on account root returns anything.

**Instances:** init sweep only (clearChainState/clearProfile purges key-attributed, unaffected).

## C5-2 — SW kill during up() bypasses durable attempt bound — unbounded crash-boot loop, no recovery surface

**Severity:** Low-Medium (latent: realMigrations empty today) | **Repro confidence:** high mechanism / moderate reachability | **Type:** unhandled journal decision-table row

Migration N's up() deterministically KILLS the SW instead of throwing (OOM parsing huge row set, MV3 CPU budget exceeded mid-transform). State left: running + valid backup, version < N. Next boot resumeIfInterrupted restores footprint, clears journal, runInner re-runs N — NO attempt counter bumped anywhere on this path (bumpAttempts fires only in the two catch arms :236/:246/:326). Kill repeats every boot forever: run() never returns → runtime.ts never writes SCHEMA_BLOCKED_KEY → no recovery screen ever renders → each boot re-arms UI barrier.

**Violated invariant:** types.ts:76-88 attempts contract ("Durable attempt count across boots… switch from retry to block-vs-degrade"); migrator header: counters "bound both the up() retries and restore retries across boots."

**Failing path:** migrator.ts:323-334 (resume → restore → clear → rerun, unbumped).

**Smallest fix:** in resumeIfInterrupted, after successful restore bumpAttempts(backup.version, …) and return needs-recovery (journal kept) once bound hit.

## C5-3 — nextNumericId accepts non-canonical huge numeric key suffixes → future token/balance ids collapse onto one key

**Severity:** Low-Medium | **Repro confidence:** mechanism high / trigger low-moderate (requires one poisoned key under tokens/token-balances root) | **Type:** allocator lacks alias hardening applied elsewhere

Row at suffix "999999999999999999999" (~1e21): getKeys returns it; +"999…9" = 1e21; array_max = 1e21; next id = 1e21 + 1 === 1e21 (double ulp at 1e21 ≈ 2^17 so +1 rounds back). Every subsequent allocation returns 1e21 forever: writes ${root}@1e+21 — SAME key — silently overwriting previous row. Balances for new tokens/accounts collapse into one clobbering row. Same collapse with suffix "Infinity".

**Violated invariant:** allocated ids fresh (max+1); inconsistent with repo's own hardening — canonicalNumericStorageId (purge-rows.ts:93-96) exists because "1e3"/"01" aliases ruled hostile for purge cascades, but allocator consumes raw.

**Failing path:** services/id-allocators.ts:14-16; wallet-core/utils/arrays.ts:13-21 (skips NaN not huge/alias numerics). Consumers: balance-repository.ts:44-46 (→ allocateUnfencedId token-balance/service.ts:207-211), token/service.ts:270,:681.

**Smallest fix:** in nextNumericId keep only suffixes where String(Number(id)) === id (reuse canonicalNumericStorageId) before max.

## C5-4 — Boot storage probe counts journal records in wrong storage area

**Severity:** Low (telemetry-only) | **Repro confidence:** high
Probe reads browserApi.storage.session filtering nulo:journal@ but journal moved to chrome.storage.local (deliberate 2026-06-05). Boot log always prints "0 journal records".
**Fix:** count in browserApi.storage.local. runtime.ts:338-348 vs operation-journal/service.ts:99-110.

## Verified clean

- Migration decision table: every stranded-shape row converges; staging read-your-writes works cross-key; guardCommit rejects undeclared/engine-namespace writes; restore tombstones created rows via declared refs.
- UI facade: B-22 rejection handler present; subscribe-then-recheck closes attach race; no-timeout wait can't wedge past a boot; MigrationBarrier reads raw storage (facade-ban-exempt).
- Quota: unlimitedStorage in BOTH manifests → chrome.storage.local has NO total/per-item cap; migration-backup doubling and big journal payloads cannot hit QUOTA_BYTES. (session 10MB holds only liveness/e2e gates.)
- ValueStorage throw-on-corrupt: ConfigStore.load swallows (F-13); price readUsable catches → {}; seeder treats marker hostile; session ephemeral. No crash-loop caller.
- purge guarded delete: all four sites hold store lock or satisfy key-attribution/fence arguments.
- mac-storage drop race: no blind same-key writer; backup restore never touches dapp-session slice; contains() drop side-effect unreachable-as-damage.
- Backup trust gates order correct; id-anchor re-derivation rejects drift; duplicate/unknown slices rejected; block-listed roots enforced.
