<!-- codex session 01a00a8f-e280-7571-a3a2-bca4799d04b6 -->

### Finding: Migration-barrier recheck failure can hang every UI storage access indefinitely

1. **Severity:** Major
2. **Repro confidence:** High
3. **Type:** bad error path; resource leak
4. **Counter-example:** `migrationIdle()` performs its first `chrome.storage.local.get()` and observes `nulo:schema:running`. The migration clears the marker before the change listener is attached, so no event will arrive. The post-subscription recheck then rejects due to a transient storage error. Its rejection is unhandled, the listener remains installed, and the returned promise never settles.
5. **Violated invariant:** The facade says every accessor waits “once no migration is running” and that the recheck closes the check-then-subscribe race. A storage failure must reject to the caller; it must not turn an already-idle state into a permanent wait.
6. **Failing path:** `storageLocalGet` / `storageLocalSet` / `storageLocalRemove` → `migrationIdle()` initial read at `apps/extension/src/utils/storage.ts:31` → listener registration at `:41` → fire-and-forget recheck at `:44` rejects without a rejection handler → promise created at `:33` remains pending.
7. **Expected vs actual behavior:** Expected: the accessor either proceeds after confirming the marker is absent or rejects with the storage error and removes its listener. Actual: it hangs indefinitely and leaks the listener; popup initialization and subsequent storage-backed operations can remain stuck.
8. **Recommended fix:** Construct the promise with `reject`, and attach a rejection handler to the recheck that removes the listener and rejects. Use a shared idempotent settle helper so both the change event and recheck clean up exactly once.
9. **Instances:** `apps/extension/src/utils/storage.ts:30-49`, reached by `storageLocalGet` at `:53-55`, `storageLocalSet` at `:58-60`, and `storageLocalRemove` at `:63-65`.
10. **Certificate summary:** The marker-clear race is explicitly possible and is why the second read exists. Because that read has only `.then(...)`, its rejection leaves the enclosing promise with no remaining completion source.

### Finding: Malformed-row cleanup can delete a concurrent valid replacement

1. **Severity:** Major
2. **Repro confidence:** High
3. **Type:** lost update; race
4. **Counter-example:** Storage initially contains `users@a = "{"`. `get("a")` obtains that malformed value and yields before its continuation runs. Another operation successfully replaces `users@a` with `JSON.stringify({name:"Alice",age:30})`. The original `get()` resumes, decodes its stale snapshot, and fire-and-forget removes `users@a`, deleting the valid replacement it never observed.
5. **Violated invariant:** The documented syntax-failure policy permits dropping the unrecoverable malformed byte. It does not permit deleting a newer valid row written after the read snapshot. A cleanup operation must not erase a concurrent update.
6. **Failing path:** `EntityStorage.get()` awaits its snapshot at `packages/wallet-core/src/storage/entity_storage.ts:93` → concurrent `EntityStorage.set()` writes the replacement at `:98-99` → stale value enters `decodeRow()` at `:95` → parsing fails at `:63-65` → unconditional key removal at `:69` deletes the replacement. `getAll()` and `getValues()` have the same snapshot-to-cleanup window through `:108-113` and `:128-133`.
7. **Expected vs actual behavior:** Expected: the stale malformed value is ignored or removed only if it is still current. Actual: deletion is keyed only by row ID, so a later valid write can be silently lost.
8. **Recommended fix:** Do not automatically delete malformed rows on the read path unless the storage layer provides atomic compare-and-delete. With the current storage API, the smallest fully safe change is to log, retain, and hide malformed rows, leaving deletion to an explicitly serialized repair path. A re-read-and-compare alone only narrows the race and is not atomic.
9. **Instances:** Unconditional cleanup at `packages/wallet-core/src/storage/entity_storage.ts:61-73`, triggered from `get()` at `:91-95`, `getAll()` at `:106-114`, and `getValues()` at `:126-134`.
10. **Certificate summary:** The read and removal are separate asynchronous storage operations with no lock or version check. Therefore a valid write can complete after the stale snapshot but before the unconditional removal.

## Non-findings considered

- `Lock`’s original holder releasing a successor after force-release is explicitly characterization-pinned as current intentional behavior in `lock.test.ts:231-269`; excluded per audit instructions.
- `ReadWriteGuard` force-release expires reader tokens, not active writers; orphaned readers’ late completion cannot release a writer or skew the reader count.
- `Migrator.run()` catches storage failures from resume, backup writes, commits, checkpoints, attempt counters, and cleanup, returning `needs-recovery`; post-checkpoint cleanup failures deliberately avoid restoring committed data.
- Row-map `__proto__` transform targets and DSL data are rejected, config projections use a null-prototype accumulator, and root row IDs are prefixed before insertion; the proposed prototype-pollution paths are closed.
- Codec-validation failures in `EntityStorage` deliberately retain the persisted row while hiding it from typed reads, and this behavior is documented and characterization-tested.
- `migrationIdle()`’s remaining idle-check-to-access TOCTOU is explicitly documented as accepted pending routing all UI storage through the service worker.