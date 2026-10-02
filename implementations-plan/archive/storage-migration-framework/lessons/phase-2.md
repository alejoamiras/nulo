# Phase 2 — Extension adapter + boot wiring + legacy deletion + crypto docs

## Work
- **Engine refinement (in `packages/wallet-core/src/migration/`)**: added `baselineVersion` to `MigratorOptions` — the launch shape is v1 (per the plan), so fresh installs stamp 1 even with an empty registry (`maxVersion = max(baselineVersion, …migration versions)`). Added a final `SCHEMA_VERSION_KEY` stamp after the migration loop so a below-baseline install with no bridging migration still reaches max (idempotent). +3 tests (22→ then +1 parity = 23).
- **`@nulo/wallet-core/migration` export** added to `packages/wallet-core/package.json`.
- **Registry** `apps/extension/src/wallet/storage/migrations/`: `index.ts` (`BASELINE_VERSION = 1` + empty `migrations: Migration[]`) + `template.ts` (copy-paste guide for a new migration; declares footprint, idempotent, `breaking` default true, warns crypto is out-of-band).
- **Boot wiring** (`runtime.ts`): replaced `runStorageMigration(...)` with `new Migrator({ store: browserApi.storage.local, migrations, baselineVersion })`, run **before `config.load()`** (pulled it out of the `Promise.all` with BB init). Fail-closed: `needs-recovery` or a breaking `failed` throws (no service start on bad data); an additive `failed` logs + boots degraded. `browserApi.storage.local` satisfies `MinimalStorageArea` structurally (verified by typecheck).
- **Deleted** `apps/extension/src/wallet/storage/migrate.ts` (the wipe + v2–v8 changelog); one caller, cleanly removed. Removed the `BalanceView.vue` stray key-rename migration + switched its `onMounted` caller to `loadBalanceDisplayOption` (the safe path — also fixes the pre-existing falsy-value crash).
- **Docs**: rewrote `packages/wallet-crypto/README.md` (vector/KDF change = re-encrypt-on-unlock-or-reset, NOT a numbered migration — the migrator runs pre-unlock) and `apps/extension/README.md` (migrations are data-preserving, not wipe-on-bump).

## Decisions / deviations
- **reset.vue NOT touched.** The plan said "add the version marker + backup key to the reset wipe set (reset.vue)", but `reset.vue` is a **per-profile** delete — the global schema keys (`nulo:schema:*`) correctly persist across it and are wiped by the browser on uninstall (the only full wipe, per reset.vue's own comment). Wiping them on a profile-delete would corrupt migration state for other profiles. So there was nothing to add.
- **No runtime unit harness exists** (`grep` found no `runtime.test.ts` / integration test driving `createWalletRuntime`). Building one from scratch (mock browserApi + config + the whole service graph) is heavy; the boot-path wiring (migrate-before-config.load, fail-closed) gets its real end-to-end coverage in **Phase 4's smoke e2e** (which loads the actual build), per the plan. Engine correctness is unit-covered in wallet-core.
- Added a `ctx.local.rows(root)` ≡ `EntityStorage.getAll` **parity test** in wallet-core (the gate's explicit criterion) — same `[id, value]` pairs for well-formed data; the "no read-time malformed-row delete" side is covered by the fail-closed-throw test.

## Gate (`bun run audit:vue` components)
- `typecheck:all` ✓ (all 12 `@nulo/*` packages exit 0, incl. extension + faucet).
- wallet-core tests ✓ **116/116** (23 in the migration module incl. baseline + parity).
- BalanceView component test ✓ (2/2 — stray removal didn't break it).
- `bun run build` (extension chrome+firefox bundle) ✓.
- biome on all changed files ✓ (0 errors/warnings after auto-format).
- Full extension test suite ✓ **2660 passed | 7 todo (220 files), 16.9s**.

## Incident: 3-hour vitest hang (environmental, not code)
The first full-suite run sat **3h04m at 0.0% CPU with zero output** — a wedged vitest fork worker, not a slow suite (the healthy re-run takes ~17s). Two compounding mistakes made it look like a mystery: (1) piping through `| tail -12` withheld ALL output until process exit, so there was no liveness signal; (2) the completion watcher keyed on output that could never appear. Diagnosis that worked: `ps -o pid,etime,%cpu` on the vitest PIDs — 0.0% CPU over hours = hung, kill by PID (never `pkill -f vitest`; other agents run vitest on this machine). Lessons: run big suites in background with RAW output (no tail), verify the RUN banner appears within seconds, and treat `etime` vs `%cpu` as the hang detector. A fast subset first (`test src/wallet`: 976 tests, 9s) gave an immediate signal that the touched area was healthy before committing to the full run.
