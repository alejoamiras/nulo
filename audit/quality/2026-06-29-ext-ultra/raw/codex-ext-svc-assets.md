### Q-C1 Token function ABI matchers are copy-paste catalogs
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 10 files/modules
- Instances: `token/functions/balance-of-private.ts:10,24,53,86,95`; `balance-of-public.ts:10,24,53,86,95`; `get-name.ts:10,26,69,92,102,111,116,139,149`; `get-symbol.ts:10,26,69,92,102,111,116,139,149`; `get-decimals.ts:10,26,69,86,107,112,129`; `transfer-private.ts:11,25,75,107,117,138,184,194,196`; `transfer-public-to-private.ts:11,25,75,107,117,138,184,194,196`; `transfer-public.ts:10,24,67,113,123,125`; `transfer-private-to-public.ts:10,24,67,113,123,125`; `token/service.ts:322,401,503,508,512`
- Evidence: each module repeats enum dispatch, `new()`, candidate scoring, literal ABI JSON, artifact scan predicates, and `as StructType` narrowing. `token/service.ts:322-372` and `token/service.ts:401-451` repeat the same 9-function candidate/default assembly.
- Why it harms future change: adding one token capability or changing the Aztec ABI predicate means touching every catalog layer: file enum, ABI literal, matcher, scorer, default choice, `TokenInterface`, and both service assembly paths.
- Refactoring: Parameterize Method + Extract Function → a `TokenFnDescriptor`/factory with shared ABI builders, artifact source, scorer, candidate predicate, pack/unpack hooks.
- Effort: days
- Confidence: high

### Q-C2 Restore/id-remap loops are hand-rolled per entity
- Smell: Boilerplate-per-consumer (analog: the same backup/restore contract is reimplemented by each storage-owning service instead of one restore template)
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 9 files/modules
- Instances: `account/service.ts:221,227,232`; `auth-registry/service.ts:401,421,429`; `contact/service.ts:270,274,283`; `fpc/service.ts:443,450,470`; `network/service.ts:624,634,660`; `token/service.ts:529,535,543`; `token-balance/service.ts:259,264,269`; `token-balance/balance-repository.ts:40`; `utils/full-backup-helpers.ts:73,94`
- Evidence: services repeat `backup()`, `restore()`, `ensureInitialized()`, `Restored<T>[]`, per-row `try/catch`, id collision handling, storage writes, and `{ ...row, restoreError: toRestoreError(err) }`. Numeric ids use `array_max(...) + 1`; string ids use repeated `while (contains(id)) getRandomHex(8)`.
- Why it harms future change: changing restore error shape, parent-id remapping, collision policy, validation, or partial-failure reporting must be patched service-by-service and kept consistent with `full-backup-helpers`.
- Refactoring: Form Template Method / Extract Function → shared `restoreRows<T>()` with pluggable validate, allocate key, store, and project-restored hooks.
- Effort: days
- Confidence: high

### Q-C3 Chrome host APIs leak into general utilities outside the adapter
- Smell: Shotgun Surgery + Boundary Type Erosion (analog: host API access has multiple untyped/ad-hoc seams instead of one typed adapter)
- Lens: typing
- Maintenance impact: structural
- Blast radius: 4 scoped utility files
- Instances: `utils/general.js:32,34,37`; `utils/files.ts:41,64,72`; `utils/core.ts:143,144,148`; `utils/lastActiveProfile.ts:7,8,13`
- Evidence: `core/adapters/chrome-browser-api.ts` is the intended Chrome wrapper, but utilities still call `chrome.permissions`, `chrome.downloads.download`, `chrome.runtime.lastError`, and `chrome.storage.local` directly. `utils/files.ts:72` uses `(chrome.runtime as any).lastError`; `utils/general.js` is production JS with untyped parameters.
- Why it harms future change: changing host behavior, Firefox/polyfill handling, fake-browser tests, or `lastError` normalization requires edits outside the adapter and leaves utility imports dependent on a global `chrome`.
- Refactoring: Introduce Gateway / Extract Adapter → extend `BrowserApi` or add a small `HostUiApi` for permissions, downloads, and UI storage keys; migrate `general.js` to TS.
- Effort: days
- Confidence: moderate

## Likely false positives
- The 21× `spec/service/client` triplet is documented repo convention, not itself a finding.
- `core/adapters/chrome-browser-api.ts` double-casts are mostly isolated compatibility shims; I would not score those alone.
- Token capability booleans are a mild smell, but the concrete change cost is in the duplicated token-function catalog above.

## Summary 3 findings; highest-value: Q-C1 token function ABI matcher duplication.