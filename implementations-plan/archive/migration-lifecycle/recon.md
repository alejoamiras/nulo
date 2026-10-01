# Recon — migration-lifecycle (batch 2 of audit-448-remediation)

Base: dev `85460d83`. One recon pass (engine + runtime + barrier + proof + precedents); cites verified against source. Verbatim-critical mechanics below; the full trace lives in the recon agent's report (this file is the distilled, load-bearing subset).

## The N-02 burn machinery

- `createWalletRuntime(...)` is constructed ONCE at SW module top level (`apps/extension/src/wallet/index.ts:82`); `runtime.start()` fires from the unconditional module-top-level chain (`:101-111` — EVERY SW respawn) and the price-alarm shim (`:91-99`). MV3 re-evaluates the whole module per respawn → fresh `retrySafe=true` + fresh single-flight memo → a brand-new `Migrator.run()` per ambient wake.
- `retrySafe` veto (`runtime.ts:107-123`, set false at `:172` on blocked-throw) is module-lifetime — it only stops SAME-lifetime retries, exactly as the audit said.
- Attempts: durable `SCHEMA_ATTEMPTS_KEY` (migrator-private, per-`(version, phase)` with reset-on-mismatch, `migrator.ts:356-361`); bumped on up-throw (`:246`, unconditional after restore), restore-throw (`:236`), resume-restore-throw (`:326`). `terminal = attempts >= maxRetries(3)` (`:254`); `needs-recovery.retryable = attempts < maxRetries` (`:240,:330`).
- Blocked status is EXTENSION-layer: `SCHEMA_BLOCKED_KEY = "nulo:schema:blocked"` + `SCHEMA_DEGRADED_KEY` in `apps/extension/src/wallet/storage/migrations/index.ts:45-55` (`{kind, detail, terminal}`), written by `runtime.ts:157-186` (blocked → `retrySafe=false` + persist + throw; non-breaking failed → degraded; success → clear both).

## The N-18 hole (verified precisely)

`resumeIfInterrupted` (`migrator.ts:275-335`): armed journal found → restore. Restore-THROW bumps (`:326`); restore-SUCCESS falls through to clear-journal + `return undefined` (`:330-334`) with ZERO durable signal → `runInner` re-attempts the same migration fresh. An armed journal can ONLY arise from a hard SW kill mid-`up()` (a same-boot throw is fully resolved by `applyOne`, journal cleared). So kill→resume→re-run→kill cycles forever: counter untouched, no blocked status, no recovery UI. The neighboring catch (`:325-332`) is the copyable bump shape.

## The barrier (N-02's UX surface)

`MigrationBarrier.vue`: terminal copy "UPDATE FAILED … Reinstall the extension to start clean"; non-terminal "UPDATE INTERRUPTED … Close and reopen the extension to retry the update" (`:21-32`). **Zero interactive affordances for blocked state** (only the unrelated degraded-dismiss button). Status via RAW `chrome.storage.local.get([RUNNING, BLOCKED, DEGRADED])` + `onChanged` listener with an `eventTouched` stale-snapshot guard (`:35-61`) — an ALLOWLISTED exception to the storage-facade ban (documented `:6-10`: the facade awaits `running` clearing; the barrier's job is to observe it — facade would deadlock). This raw-storage channel is the natural, plumbing-free vehicle for a retry gesture (a button writing a key the SW consumes) — the barrier issues no RPCs today and needs none.

## Clock + cool-down precedents

- No backoff precedent in wallet-core (grepped); the engine is clock-free by design.
- Nearest shape: `operation-journal/reaper.ts` — persisted timestamp + injectable `now` (`:102-116`) + fixed grace windows (`:191-216`).
- `runtime.ts` ALREADY holds `clock: ClockPort` in `WalletRuntimeDeps` (`:70`; `ClockPort.now()` at `packages/wallet-core/src/ports/clock-port.ts:11-12`) — a doStart-entry check needs no new dependency threading; the pure engine stays clock-free.

## N-27 (exact)

`runtime.ts:338-348`: probe reads `browserApi.storage.session` for BOTH `getBytesInUse` (`:340-341`) and `.get()` (`:342`), filters keys `nulo:journal@` — but the journal moved to `storage.local` on 2026-06-05 (`operation-journal/service.ts:97-110`; EntityStorage rows keyed `nulo:journal@<id>`). Count always 0; bytes mis-scoped. Fix swaps BOTH reads to `storage.local`; the file's OTHER `storage.session` use (liveness heartbeat `:365-374`) must stay untouched.

## Proof + test conventions

- `proofs/c3-1-migration-ambient-burn.proof.test.ts`: `FlakySetStore extends MemoryStorageArea` injecting one transient set-failure per wake; three independent `new Migrator({maxRetries:3}).run()` calls against ONE durable store; asserts terminal stays false across all three. RED today (wake 3 → attempts 3 → terminal). Adopt into `packages/wallet-core/src/migration/migrator.test.ts`… EXCEPT the short-circuit fix lives in runtime.ts (extension layer), not the engine — the colocated adoption needs BOTH layers: an engine-level test can't see the runtime short-circuit. Adoption shape: runtime-level test (extension) driving `doStart` equivalents, OR adapt the proof's semantics: engine keeps burning per-run (correct at engine level — a run IS an attempt); the FIX is that runtime stops invoking runs. So the adopted regression pin belongs at the RUNTIME layer (`apps/extension/src/wallet/runtime.test.ts`? — check existing runtime tests during impl) asserting: blocked-non-terminal persisted + N ambient `start()` cycles across fresh runtime instances → engine invoked at most per policy (gesture/cool-down), attempts NOT exhausted.
- `migrator.test.ts` (642 lines): `MemStore` fault-injection + `journal()`/`row()`/`ver()` builders; describes named `"Migrator — <topic>"`; the "crash-safe journal" describe (`:207-381`) has the sibling shape for N-18 ("restore failure → needs-recovery with BOUNDED retries across boots", `:355-368`); "retry counter" describe (`:550-605`) has the canonical bound-crossing shape.

## Reuse / adapt / collisions

- **Reuse:** `runtime.ts`'s blocked-status build+throw block (`:162-174`) for the short-circuit path; the `:325-332` bump shape for N-18; reaper's injectable-now pattern; `MemStore` fixtures; barrier's raw-storage + `onChanged` idiom for any new key.
- **Adapt:** `resumeIfInterrupted` needs the phase decision — `AttemptRecord.phase` is `"up" | "restore"` (`:59`); bumping `"up"` on resume shares the counter with same-boot up-throws (kill≈failed-attempt semantics), bumping `"restore"` isolates it; reset-on-mismatch (`:358`) means the choice changes cross-path accounting. Engine's "never throw, fail-closed" contract (`:113-122`) must survive; the veto comment (`runtime.ts:107-122`) must be updated to describe post-fix reality.
- **Collisions:** a BARE short-circuit makes "close and reopen to retry" permanently false (nothing distinguishes ambient from gesture wakes at doStart) — the adjudicated trap; barrier copy must stay honest with whatever policy ships. A cool-down alone only SLOWS the burn (price alarm ≈3 min cadence → 3 attempts still exhaust in ~3 cool-downs). N-18's early-terminal return must not regress the existing crash-safe-journal tests (first resume must stay silent; only repeat cycles bound out). N-27 swap is two lines, scoped.
