# Recon — export-integrity (batch 1 of audit-448-remediation)

Base: dev HEAD `ea9be876`. Three read-only recon passes (import contract / export page + shell / file readers + caps). File:line cites verified by direct reads.

## The checksum contract (the load-bearing invariant)

- Import strips ONLY `checksum` via object-rest (`useFullBackupImport.ts:117`), re-stringifies **compact** (`JSON.stringify(backup)`, single-arg, key insertion order preserved through parse→stringify), hashes SHA-256-hex via `EncryptionKey.getHashHex` (`packages/wallet-crypto/src/encryption-key.ts:132-139`). Mismatch → `"Backup Integrity Check Failed"` / "corrupted or has been tampered with" (`useFullBackupImport.ts:126-132`), gate order checksum → compat-epoch → schema-version (deliberate, pinned by test `useFullBackupImport.test.ts:293-296`).
- Export must therefore compute the checksum LAST, over the compact stringify of the COMPLETE envelope; `checksum` must be the only absent key at hash time and lands as the last own-property.
- **Pretty-printed download is checksum-neutral** (`full.vue:234` writes `JSON.stringify(backup, null, 2)`; import parses then re-stringifies compact — whitespace is discarded, key order survives). Gzip likewise neutral (`downloadFile`/`pickFile` are a lossless symmetric transport; export always gzips → file actually lands as `.gz`, `files.ts:157-171`).
- `undefined` fields are dropped by stringify — load-bearing: passkey vs password profiles carry different field sets and import presence-guards them exactly (`useFullBackupImport.ts:616-641`). Fields must stay literal `undefined`, never `null`.
- `data` slice keys must match `BACKUP_SLICE_REGISTRY` (`backup-migration-registry.ts:197-223`) — an unknown key rejects the whole import (`:261-263`).
- **Sharpest trap:** any new top-level field appended AFTER the hash line ships a file whose stored checksum never covered it → every such export self-rejects at import.

## The latch precedent (same directory)

`export/account.vue` is the load-bearing pattern to port:
- `isBusy`/`isDownloading` refs (`:50-51`) + monotonic `let generation = 0` (`:59`, bumped on every flow reset AND in `onBeforeUnmount` `:209-216`).
- Handler shape (`handleCreate` `:117-146`): synchronous `if (!password.value || isBusy.value) return` → `isBusy = true` → `const gen = generation` → after EVERY await `if (gen !== generation) return` → `finally { if (gen === generation) isBusy.value = false }`.
- Keydown guard `:201-206` no-ops once a stage has produced a result.
- CTAs disabled off the same refs (`:304,312-318`).

`export/seed.vue` has no latch (weaker sibling; small blast radius). `full.vue` is below even that bar: `onKeydown:245-259`'s `default` arm catches `""`, `"progress"`, AND `"encrypting"` → re-invokes `handleBackup()`; the Create Backup CTA (`:437-444`) has no busy guard; `backup` (`:58`) and the 11-client `backupServices` array (`:63-82`) are `<script setup>` per-mount locals shared across handler calls — two interleaved runs race `backup = {...}` / `backup.data[name] =` and double-`.backup()`/`.disconnect()` shared clients. Slice loop `:193-198` has NO try/catch → any throw strands `backupStatus` at `"progress"` (spinner + disabled CTAs, no error).

Import-side equivalents (same discipline, composable-shaped): latch `if (restoreStatus.value === "progress") return` (`useFullBackupImport.ts:497`, also `pickBackupFile:401-402`); whole-loop `try { for } finally { for (…) client.disconnect() }` (`:828-842`, "P7" — never per-iteration).

Other page facts: no leave guards anywhere (`SecretExportLayout` → `SubPageHeader.handleBack` → router, no confirm); `PasskeyCeremonyDialog` aborts its ceremony on unmount → `UserRejectedError` reaches `full.vue`'s existing catch; `usePasskeyCeremony.runCeremony` rejects a concurrent ceremony with a PLAIN `Error("A passkey ceremony is already in flight")` — message-match only, no typed class (`usePasskeyCeremony.ts:40-43`; pinned by message-regex in its test).

## Tests + testids

- NO colocated tests for any export page (L6 — optional per policy). `SecretExportLayout.test.ts` (7 cases) and `usePasskeyCeremony.test.ts` (10 cases, incl. concurrent-rejection) exist.
- **`tests/e2e/backup-roundtrip.test.ts` drives `full.vue`'s real UI** (required smoke gate `smoke-e2e-status`): agree → password → create (polls `protect-password-btn` enabled, 120s) → encrypt (polls disappear + `download-backup-btn` enabled, 60s) → capture download via `helpers/backup-export.ts` (stubs `chrome.downloads.download`, DecompressionStream-inflates) → import round-trip incl. wrong-password path. Happy path only; zero double-invocation coverage. Button transition shapes must keep satisfying these polls.
- `full.vue` testids (preserve verbatim): `backup-status-card`, `backup-encrypt-password-input`, `backup-encrypt-password-confirm-input`, `backup-encrypt-error-text`, `agree-continue-btn`, `unlock-submit-btn`, `protect-password-btn`, `download-backup-btn`; plus `unlock-password-input`/`unlock-error-text` from `SecretUnlockSection`.

## File readers + caps (N-13 surface)

- `pickFile` (`files.ts:79-123`) never reads content — resolves a `File`; BUT when the name says `.gz`/`.gzip` and `autoDecompress` (default ON), it decompresses INSIDE pickFile (`:97-114`) before the caller ever sees the file: `decompressData` (`:249-273`) buffers the whole input, drains the whole `DecompressionStream` output via `new Response(...).blob()` with ZERO ceiling, then wraps a new `File` (original compressed size discarded). **A caller-side `file.size` check is a no-op against a decompression bomb.** A cap must live at three points: compressed `file.size` pre-check (between `:89` and `:97`), chunk-wise output cap inside `decompressData` (reader loop + running total + cancel), and post-decompress `blob.size` before resolve (`:104-110`).
- **Swallow trap:** `pickFile`'s decompress `catch` (`:111-114`) `console.warn`s and silently resolves the ORIGINAL COMPRESSED file — a cap error thrown from `decompressData` must be special-cased (typed error, rethrow), or it falls into the fallback.
- Call sites (exhaustive per auto-import registry + traced consumers): backup import (`useFullBackupImport.ts:404` via injected `opts.pickFile`, wired `useProfileImportFlow.ts:260`, both shells) — bare `pickFile()`, gz-exposed; account import (`settings/accounts/import.vue:54`) — bare `pickFile()`, gz-exposed; contacts (`popup/components/modules/settings/contacts/useContactImportExport.ts:87`) — `pickFile(".json", true)`, already capped.
- `readBackupFile` (`full-backup-helpers.ts:34-59`): unbounded `file.text()` at `:35`; sole caller `useFullBackupImport.ts:406`. Giant-file worst case (>~512MB) throws RangeError → caught by `pickBackupFile`'s try/catch → clean error; the exposed band is mid-size + bombs.
- Precedents: account cap = inline `64 * 1024` on STRING length inside `decodeAccountExport` (`account/service.ts:657-670`, error `"Account export file is too large"` shown verbatim inline); contacts cap = `MAX_CONTACT_IMPORT_BYTES = 1_000_000` in `utils/contacts-export-format.ts:38,43`, enforced on `file.size` BEFORE `.text()` (`useContactImportExport.ts:90-94` — comment explains UTF-16-vs-bytes reasoning; toast `"Contacts file is too large"`), plus defense-in-depth `raw.length` re-check in the parser (`contacts-export-format.ts:49-51`).
- Copy templates: size → `"<Thing> file is too large"`; format → `"The selected file is not a valid <X>. Please select a correct <X> file."`.
- Tests: `files.test.ts` covers ONLY `downloadFile`; no `pickFile`/`decompressData` coverage or File/Blob fixtures. `full-backup-helpers.test.ts` uses a `{ name, text }` duck-shim (no `.size`). Cap tests need Blob-based fixtures (real `.size`) + real `CompressionStream`-produced gzip fixtures (available in the vitest node env — verify at impl).

## Reuse / adapt / collision summary

- **Reuse as-is:** account.vue latch+fence idiom; `EncryptionKey` primitives; `BACKUP_SCHEMA_VERSION_FIELD`/`COMPAT_EPOCH_FIELD` constants (already single-sourced both sides); whole-loop try/finally teardown; toast idiom (`useToast` explicit import, `TOAST_DURATION` bare — auto-imported); size/format copy templates.
- **Adapt:** `onKeydown` default arm (explicit no-op cases for `progress`/`encrypting`); CTA `:disabled` gains busy check; `backup` becomes a per-run local draft assigned once, checksum from that one frozen draft; `pickFile` gains an optional per-call byte cap threaded to `decompressData` (typed `FileTooLargeError`, rethrown past the swallow); `readBackupFile` gains a `file.size` pre-check (contacts precedent) surfacing through its existing `parseError` channel; account-import call site passes a modest cap.
- **Collisions:** new envelope fields must precede the hash line; slice keys must stay registry-known; per-flow size profiles differ (backup ≫ account) so the cap is per-call-site, never a `pickFile` default; smoke-gate button-transition polls must keep passing; a component test for the page must stub the 11 service-client modules (heavier mock surface than composable tests).
