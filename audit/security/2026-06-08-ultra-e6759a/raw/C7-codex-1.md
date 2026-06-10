# C7 — Storage + migration + entity persistence (Codex xhigh Pass 1)

## Findings

### Finding 1 — `ValueStorage.get()` can brick wallet boot or unlock on one malformed row

**Title**: `ValueStorage<T>.get()` does a bare `JSON.parse()` with no schema validation, no delete-on-failure path, and no caller-independent recovery. A single malformed `nulo:config` or `nulo:core:session` row can stop runtime startup before migration runs or stop `ProfileService` initialization during silent restore.

**Impact factors**:
- CIA+A: **Availability**. The wallet can fail to boot, fail to load config, or fail to restore/unlock the active profile until the bad key is manually cleared.
- Blast radius: global for `nulo:config` and profile-local for `nulo:core:session`, but both happen on startup paths that gate the rest of the wallet.
- Exploitability: requires any write primitive into extension storage or accidental corruption/partial write. Once the malformed row exists, the DoS is persistent across service-worker restarts.

**Evidence confidence**: **high** — direct code path from persisted key to uncaught `JSON.parse` on startup.

**OWASP / CWE mapping**: A05:2021 Security Misconfiguration / resilience failure — **CWE-248** (Uncaught Exception), **CWE-20** (Improper Input Validation), **CWE-755** (Improper Handling of Exceptional Conditions).

**Trace** (source → sink):
1. `ValueStorage.get()` does `return JSON.parse(res[this.root] as string)` with no `try/catch` or fallback at `packages/wallet-core/src/storage/value-storage.ts:18-22`.
2. `ConfigStore` persists wallet config under `nulo:config` via `new ValueStorage<Config>("nulo:config", chrome.storage.local)` at `packages/extension/src/wallet/config/store.ts:10`.
3. Runtime startup calls `config.load()` before migration or service startup at `packages/extension/src/wallet/runtime.ts:93-103`.
4. `ConfigStore.load()` immediately calls `await this.storage.get()` at `packages/extension/src/wallet/config/store.ts:17-20`. A malformed `nulo:config` value throws out of `Promise.all(...)`, aborting startup before `runStorageMigration()` executes.
5. Separately, `SessionManager` persists the active session under `nulo:core:session` via `ValueStorage<Session>` at `packages/extension/src/wallet/services/profile/session-manager.ts:130-132`.
6. `ProfileService.init()` awaits `this.sessionManager.restore(...)` at `packages/extension/src/wallet/services/profile/service.ts:69-84`.
7. `SessionManager.restore()` immediately does `const session = await this.session.get()` at `packages/extension/src/wallet/services/profile/session-manager.ts:313-315`. A malformed `nulo:core:session` row throws out of restore and prevents `ProfileService` from finishing init.

**Missing control**:
- `ValueStorage` needs the same “parse-or-self-heal” semantics `EntityStorage` has, or an equivalent schema-validated fallback.
- Startup callers need a bounded recovery path for malformed singleton keys (`delete bad row + continue with defaults/locked state`) rather than trusting every persisted byte.

**Exploit story**:
1. A buggy write path, dev/test fixture, future version drift, or any local write primitive stores non-JSON bytes under `nulo:config`.
2. On the next extension boot, `runtime.start()` calls `config.load()` before migration.
3. `ValueStorage.get()` throws during `JSON.parse`.
4. `Promise.all([config.load(), BarretenbergSync.initSingleton(...)])` rejects, so the wallet never reaches migration or `services.start()`.
5. Result: the extension appears dead until the storage row is manually deleted.

A parallel variant uses `nulo:core:session`: the wallet boots, but `ProfileService.init()` never finishes because silent restore throws before the service marks itself initialized.

**Preconditions**:
- The attacker or fault can write one malformed singleton row into `chrome.storage.local` or `chrome.storage.session`.
- No additional user interaction is required after the bad row lands; the next startup/reload triggers the failure.

**Why mitigations fail**:
- Unlike `EntityStorage.parseOrDelete()`, `ValueStorage` has no exception handling at all (`value-storage.ts:18-22`).
- Migration cannot save `nulo:config` corruption because startup calls `config.load()` before `runStorageMigration()` (`runtime.ts:93-103`).
- `SessionManager.restore()` does not wrap `this.session.get()` in a recovery `try/catch`; its cleanup logic only runs after a parsed `Session` object exists (`session-manager.ts:313-350`).

**Instances**:
- `packages/wallet-core/src/storage/value-storage.ts:18-22`
- `packages/extension/src/wallet/config/store.ts:10`
- `packages/extension/src/wallet/config/store.ts:17-20`
- `packages/extension/src/wallet/runtime.ts:93-103`
- `packages/extension/src/wallet/services/profile/session-manager.ts:130-132`
- `packages/extension/src/wallet/services/profile/session-manager.ts:313-315`
- `packages/extension/src/wallet/services/profile/service.ts:69-84`

---

### Finding 2 — v6/v7 migration claims to wipe incompatible journal rows but only purges the old session-storage location

**Title**: The v6/v7 migration comments say journal schema changes are handled by the existing `nulo:journal@` wipe path, but the actual wipe only scans `chrome.storage.session`. `OperationJournalService` now stores journal rows in `chrome.storage.local`, so incompatible local records survive the version bump.

**Impact factors**:
- CIA+A: **Integrity** + **Availability**. The migration’s safety guarantee is false: stale journal rows can survive upgrades and continue driving UI/state decisions under a schema the migration explicitly said must be wiped.
- Blast radius: every upgrade path where a prior build already wrote journal rows into local storage.
- Exploitability: passive/persistent. A user only needs to upgrade across the affected version boundary; no attacker-controlled race is required.

**Evidence confidence**: **high** — direct mismatch between migration targets and journal storage backend.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-436** (Interpretation Conflict), **CWE-664** (Improper Control of a Resource Through its Lifetime), **CWE-345** (Insufficient Verification of Data Authenticity / version assumptions).

**Trace** (source → sink):
1. Migration comment for v6 says incompatible `OperationRecord` rows are handled by the existing `nulo:journal@` wipe path at `packages/extension/src/wallet/storage/migrate.ts:25-30`.
2. Migration comment for v7 says the same wipe path avoids the pre-v7 fake `"0 USDC"` ghost at `packages/extension/src/wallet/storage/migrate.ts:31-36`.
3. Actual local prefixes to wipe are listed at `packages/extension/src/wallet/storage/migrate.ts:50-64`; there is no `nulo:journal@` entry there.
4. The only journal wipe prefix is `KEY_PREFIXES_TO_WIPE_SESSION = ["nulo:journal@"]` at `packages/extension/src/wallet/storage/migrate.ts:66-67`, and the wipe loop only scans `chrome.storage.session` at `:99-108`.
5. `OperationJournalService` now stores rows in local storage, not session storage, via `new EntityStorage<OperationRecord>("nulo:journal", browserApi.storage.local)` / `chrome.storage.local` at `packages/extension/src/wallet/services/operation-journal/service.ts:76-87`.
6. Runtime executes migration before services start at `packages/extension/src/wallet/runtime.ts:101-104`, then the journal service reads the surviving local rows as authoritative.

**Missing control**:
- If v6/v7 truly require a destructive journal wipe, `nulo:journal@` must be included in `KEY_PREFIXES_TO_WIPE_LOCAL`.
- Better: stepwise migrations should validate the actual storage backend being migrated instead of relying on stale comments from the old session-storage era.

**Exploit story**:
1. A user runs a build that already stores journal rows in `chrome.storage.local`.
2. The user upgrades to the build with `CURRENT_VERSION = 7`.
3. `runStorageMigration()` logs a v6→v7 wipe, but only removes `nulo:journal@*` keys from `chrome.storage.session`.
4. Old local journal rows remain.
5. The wallet now runs on top of the rows the migration text said were unsafe to keep; the v7 “wipe to avoid fake 0 USDC ghost” guarantee is not actually enforced.

**Preconditions**:
- Existing local journal rows from an older build.
- A version mismatch that triggers migration (`version !== CURRENT_VERSION`).

**Why mitigations fail**:
- `OperationRecordSchema.safeParse()` only protects against rows that fail the new schema. The v7 comment itself states the critical case is a row that still parses but is semantically wrong (`amountRaw` absent yet rendered as `0`) (`migrate.ts:31-36`).
- The migration’s journal wipe points at the wrong storage area after the journal durability move to local (`service.ts:76-87`).

**Instances**:
- `packages/extension/src/wallet/storage/migrate.ts:25-36`
- `packages/extension/src/wallet/storage/migrate.ts:50-67`
- `packages/extension/src/wallet/storage/migrate.ts:99-108`
- `packages/extension/src/wallet/services/operation-journal/service.ts:76-87`
- `packages/extension/src/wallet/runtime.ts:101-104`

---

### Finding 3 — incoming-transfer persistence is unbounded and continues even for hidden / blocked contracts, enabling silent quota exhaustion

**Title**: `IncomingTransferService` persists one row per discovered note with no per-account cap, no per-contract cap, and no GC. Once a contract is being watched, every unique incoming note is stored forever; even `blocked` contracts still persist hidden records. A dust sender can exhaust `chrome.storage.local`’s finite quota and make unrelated wallet writes fail.

**Impact factors**:
- CIA+A: **Availability**. Exhausting `chrome.storage.local` can break unrelated persistence across the wallet (journal writes, token updates, settings, sessions that depend on local state).
- Blast radius: any profile with at least one watched token contract and a known account address.
- Exploitability: AV:Network / AC:Low once the attacker can send notes to the user’s address from a watched contract. No repeated popup is required after the token is watched; for newly added tokens the service auto-trusts them.

**Evidence confidence**: **high** — the storage growth path is direct and there is no limiting code in the audited service/repository.

**OWASP / CWE mapping**: A08:2021 Software and Data Integrity Failures / resource exhaustion — **CWE-400** (Uncontrolled Resource Consumption), **CWE-770** (Allocation of Resources Without Limits or Throttling).

**Trace** (source → sink):
1. Incoming-transfer records are persisted in `chrome.storage.local` under `nulo:core:incoming-transfers` at `packages/extension/src/wallet/services/incoming-transfer/repository.ts:20,34-35`.
2. The repository exposes only raw upsert/list/delete operations; there is no cap/GC path (`repository.ts:48-49`, `56-72`, `95-120`).
3. When a token is added, `IncomingTransferService.onTokenAdded()` eagerly flips trust to `trusted` before scanning at `packages/extension/src/wallet/services/incoming-transfer/service.ts:440-453`, then starts schedulers for all accounts at `:455-465`.
4. Each poll calls `noteService.getNotesRaw(networkId, accountAddress, contract)` at `packages/extension/src/wallet/services/incoming-transfer/service.ts:573-576`.
5. For each note, dedupe only checks existing `siloedNullifier` and tx-hash suppression sets (`service.ts:617-629`). A fresh dust note with a new nullifier passes.
6. The note is converted to an `IncomingTransferRecord` and unconditionally persisted via `await this.repo.upsertRecord(record)` at `packages/extension/src/wallet/services/incoming-transfer/service.ts:660-671`.
7. `blocked` is not a persistence stop-state: `setTrustReject()` only flips trust to `"blocked"` (`service.ts:322-329`), and later scans still execute the same `upsertRecord(record)` path with `hidden: true` because the code only suppresses the live event, not the write (`service.ts:636-676`).

**Missing control**:
- The service needs bounded retention for `IncomingTransferRecord` rows: per-account/per-contract caps, age-based GC, or both.
- `blocked` should short-circuit persistence entirely, not merely hide rows, if the goal is “silent rejection.”
- The write path should handle storage-quota failures explicitly instead of assuming local storage is effectively infinite.

**Exploit story**:
1. The attacker gets the user to watch a token contract once. This is especially easy through the normal add-token path because `onTokenAdded()` auto-marks the contract `trusted` (`service.ts:440-453`).
2. The attacker learns the user’s Aztec address.
3. The attacker sends thousands of tiny notes from that watched token contract to the user’s account.
4. Every scheduler tick rediscovers new unique nullifiers and persists them one by one to `chrome.storage.local`.
5. Because there is no cap or GC, storage grows until Chrome quota is hit; subsequent writes elsewhere in the wallet begin failing.

Even if a contract ever reaches `blocked`, the service still persists future rows hidden (`service.ts:322-329`, `636-676`), so rejection does not mitigate the quota-exhaustion vector.

**Preconditions**:
- The victim has at least one watched token contract.
- The attacker can send notes to the victim’s account from that contract and knows the account address.

**Why mitigations fail**:
- `siloedNullifier` idempotency only prevents exact duplicates, not fresh dust notes (`repository.ts:5-10`, `service.ts:617-625`).
- The journal GC cap is irrelevant here; it only touches terminal journal records, not incoming-transfer rows (`packages/extension/src/wallet/services/operation-journal/gc.ts:44-47`, `115-147`).
- The user-visible `incomingTransfersVisible` toggle only hides records from rendering; it explicitly still persists them (`service.ts:260-275`).

**Instances**:
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts:20`
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts:34-35`
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts:48-49`
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts:56-72`
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts:95-120`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:260-275`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:322-329`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:440-453`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:573-576`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:617-629`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:660-676`

---

### Finding 4 — incoming-transfer trust rows are never schema-validated, so out-of-enum `state` values bypass the FSM

**Title**: `IncomingTrustRecord.state` is specified as `"unknown" | "pending" | "trusted" | "blocked"`, but persisted trust rows are loaded through raw `EntityStorage` with no `safeParse`. A malformed row can return an arbitrary string, and the service then treats it as a valid `IncomingTrustState` while skipping all expected trust-state branches.

**Impact factors**:
- CIA+A: **Integrity** + **Availability**. The incoming-transfer trust FSM can be wedged into a non-existent state where prompts never fire, records remain hidden, and callers receive an out-of-contract value.
- Blast radius: per `(profileId, networkId, contract)` trust row, but it affects all future incoming-note handling for that contract.
- Exploitability: requires a malformed storage row (corruption, future-version drift, buggy internal writer, or any local write primitive).

**Evidence confidence**: **high** — the enum contract exists only at the TypeScript type layer; runtime validation is absent.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-20** (Improper Input Validation), **CWE-1287** (Improper Validation of Specified Type of Input).

**Trace** (source → sink):
1. The enum contract is declared in `packages/extension/src/wallet/services/incoming-transfer/spec.ts:23-27`, and `IncomingTrustRecord.state` is typed as `IncomingTrustState` at `:81-88`.
2. The repository loads trust rows via raw `EntityStorage` and returns them verbatim: `getTrust(...) { return this.trust.get(...) }` at `packages/extension/src/wallet/services/incoming-transfer/repository.ts:77-79`.
3. `EntityStorage` only does `JSON.parse` and casts to `T`; it does not validate fields against the declared TypeScript type (`packages/wallet-core/src/storage/entity_storage.ts:47-59`, `90-95`).
4. `IncomingTransferService.getTrustState()` returns `record?.state ?? "unknown"` at `packages/extension/src/wallet/services/incoming-transfer/service.ts:278-281`.
5. `scanContract()` reads `const liveTrust = (await this.repo.getTrust(...))?.state ?? "unknown"` at `packages/extension/src/wallet/services/incoming-transfer/service.ts:636-637`.
6. The state machine only handles explicit `"unknown"` and `"trusted"` branches (`service.ts:642-676`). Any other string falls through: no pending prompt, `buildRecord(... trustState ...)` marks the row hidden because `trustState !== "trusted"`, and future scans repeat the same hidden persistence.

**Missing control**:
- Trust rows need a runtime schema (`zod` or equivalent) with delete-on-failure, mirroring `OperationRecordSchema.safeParse()` in the journal service.
- `getTrustState()` should never return an out-of-enum string to callers; invalid rows should collapse to `"unknown"` or be dropped.

**Exploit story**:
1. A malformed trust row lands in storage with `state: "pending "` or `state: "evil"`.
2. The next scan loads that row through `EntityStorage`, which happily returns the parsed object.
3. `getTrustState()` now returns the bad string to callers, and `scanContract()` uses it as `trustState`.
4. Because the code only branches on `"unknown"` and checks `"trusted"` for visibility, the contract never re-enters the normal prompt flow and every new note is persisted hidden.
5. From the user’s perspective the contract is silently wedged outside the documented FSM.

**Preconditions**:
- Any malformed `nulo:core:incoming-trust@...` row.
- The service later scans or reads trust state for that contract.

**Why mitigations fail**:
- The repository has no layer-2 schema validation equivalent to `OperationJournalService._loadValidated()` (`operation-journal/service.ts:117-145`).
- `EntityStorage`’s generic cast (`JSON.parse(...) as T`) gives compile-time comfort but no runtime guarantee (`entity_storage.ts:47-59`).

**Instances**:
- `packages/extension/src/wallet/services/incoming-transfer/spec.ts:23-27`
- `packages/extension/src/wallet/services/incoming-transfer/spec.ts:81-88`
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts:77-79`
- `packages/wallet-core/src/storage/entity_storage.ts:47-59`
- `packages/wallet-core/src/storage/entity_storage.ts:90-95`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:278-281`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:636-676`

---

### Finding 5 — `setOperationMeta()` is an unlocked load-merge-write path that can clobber concurrent journal transitions

**Title**: `OperationJournalService` documents that any metadata-update path must take the same lock as `transitionOperation()`, but `setOperationMeta()` does not. It performs an unlocked read-modify-write of the whole record, so a concurrent transition (including the reaper’s fail transition) can be overwritten by a stale snapshot.

**Impact factors**:
- CIA+A: **Integrity** + **Availability**. A record can lose its terminal/error state, revert to an earlier stage, or clear `terminalAt`, confusing the activity feed and any retry/cleanup logic keyed off journal state.
- Blast radius: any operation record that receives a concurrent metadata update and stage transition on the same id.
- Exploitability: timing-dependent but real. The current token-import path already uses `setOperationMeta()` after a potentially slow metadata fetch, while the reaper can independently transition stale `simulating` rows to `failed`.

**Evidence confidence**: **medium-high** — the race requires interleaving, but the unsynchronized load-merge-write is explicit.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-362** (Concurrent Execution using Shared Resource with Improper Synchronization), **CWE-367** (Time-of-check Time-of-use Race Condition).

**Trace** (source → sink):
1. The journal service’s own lock contract says any future “metadata updates” path must acquire the same lock at `packages/extension/src/wallet/services/operation-journal/service.ts:69-70`.
2. `transitionOperation()` does acquire `transitionLock` and rewrites the full record under the lock at `packages/extension/src/wallet/services/operation-journal/service.ts:216-224` and `:288-297`.
3. `touchOperation()` correctly follows that rule and takes the same lock for its load-merge-write at `packages/extension/src/wallet/services/operation-journal/service.ts:343-360`.
4. `setOperationMeta()` does not: it reads `existing = await this._loadValidated(id)`, builds `updated = { ...existing, ...meta }`, and writes it back with no lock at `packages/extension/src/wallet/services/operation-journal/service.ts:314-328`.
5. `TokenService.addToken()` calls `await this.journal.setOperationMeta(journalOp.id, { title: symbol })` after awaiting `fetchTokenMetadata(...)` at `packages/extension/src/wallet/services/token/service.ts:155-163`.
6. Independently, `JournalReaper` can transition a stale `simulating` record to `failed` after the grace window at `packages/extension/src/wallet/services/operation-journal/reaper.ts:175-205`.

**Missing control**:
- `setOperationMeta()` must take `transitionLock`, or the service must centralize all record mutations through one locked helper.
- Any future unlocked mutation path on `OperationRecord` will have the same stale-snapshot problem.

**Exploit story**:
1. A token-import journal row is in `simulating` while metadata fetch is slow.
2. `setOperationMeta()` starts and reads the current record.
3. Before it writes back, the reaper (or another transition caller) acquires `transitionLock` and marks the row `failed`.
4. `setOperationMeta()` then writes its stale snapshot, restoring the pre-failure `progress` / `error` / `terminalAt` fields while only changing the title.
5. The record is now resurrected to a stale non-terminal state, despite the reaper having already failed it.

**Preconditions**:
- Two concurrent writers targeting the same journal row.
- At least one writer uses `setOperationMeta()`.

**Why mitigations fail**:
- The lock contract exists only in comments for this path; the implementation omits it (`service.ts:69-70`, `314-328`).
- Schema validation does not help because both sides write schema-valid `OperationRecord`s.
- The reaper is an independent writer outside the token-import call stack (`reaper.ts:175-205`), so “current callers are sequential” is not a sufficient safety argument.

**Instances**:
- `packages/extension/src/wallet/services/operation-journal/service.ts:69-70`
- `packages/extension/src/wallet/services/operation-journal/service.ts:216-224`
- `packages/extension/src/wallet/services/operation-journal/service.ts:288-297`
- `packages/extension/src/wallet/services/operation-journal/service.ts:314-328`
- `packages/extension/src/wallet/services/operation-journal/service.ts:343-360`
- `packages/extension/src/wallet/services/token/service.ts:155-163`
- `packages/extension/src/wallet/services/operation-journal/reaper.ts:175-205`

## Non-findings

- **Cross-profile / cross-chain dApp-session bleed in the current lookup path** — the live auto-approve lookup is filtered by active profile, origin, and chain id in `packages/extension/src/wallet/services/dapp-session/service.ts:85-99`. I did not find a same-origin cross-chain bleed in the audited migration/storage paths.
- **Incoming-transfer writer paths outside the service lock** — I did not find an unguarded persistence mutation in the audited service. `setTrustAllow` / `setTrustReject`, profile/chain clears, token add/delete handlers, tx-hash late-delete, and the per-note commit path all route through `withServiceLock(...)` (`packages/extension/src/wallet/services/incoming-transfer/service.ts:124-131`, `290-329`, `345-362`, `449-453`, `474-506`, `529-541`, `601-677`).
- **`trustKey()` delimiter collision via `|` under current producers** — `trustKey(profileId, networkId, contract)` uses `|`, but the current producers for `profileId` and `networkId` are generated hex ids (`packages/extension/src/wallet/services/profile/repository.ts:101-106`, `packages/extension/src/wallet/services/network/service.ts:701-706`), and token contracts are Aztec address strings. I did not find a reachable path that can inject `|` into these fields.
- **Silent queued-journal flood at message-arrival surface** — the sendTx “queued” surface is atomically capped at 8 per session and 32 global before creation in `packages/extension/src/wallet/services/wallet-sdk/queued-journal.ts:32-39` and `:110-129`. I did not find a bypass for that specific burst-control in this cluster.
- **Read-before-migrate race on normal boot** — runtime startup executes `runStorageMigration()` before `services.start()` (`packages/extension/src/wallet/runtime.ts:101-104`), so the audited services do not read pre-migration storage on a standard boot path.
- **`EntityStorage`’s 200-char malformed-payload preview as a standalone high-severity leak in this cluster** — the preview is real (`packages/wallet-core/src/storage/entity_storage.ts:18-19`, `47-57`), but I did not rate it separately here because it is only emitted to the extension’s own console and the highest-impact singleton secrets in this cluster (`nulo:config`, `nulo:core:session`) go through `ValueStorage`, not this logger path.
