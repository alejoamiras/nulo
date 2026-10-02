# Phase 1 — downloads as a required permission (item 2)

**Done.** Moved `downloads` from `optional_permissions` → required `permissions` in the SHARED
`apps/extension/manifest/manifest.config.ts` (chrome + firefox both inherit; verified both built
manifests carry it in `permissions`, no `optional_permissions`). Removed the
`ensurePermissions({permissions:["downloads"]})` pre-check from `downloadFile` (`utils/files.ts`)
entirely — the runtime `chrome.permissions.request` prompt was firing AFTER backup generation,
stealing focus and closing the MV3 popup. Since `downloads` is now install-granted, the check was
redundant; a genuine failure still surfaces via `chrome.downloads.download`'s `lastError`.

**Discriminating test** (codex condition): `files.test.ts` forces `chrome.permissions.contains → false`
and asserts `chrome.permissions.request` is NEVER called — the OLD code would have prompted on that
branch; the new code never touches `chrome.permissions`. Second test keeps the `lastError` failure
path covered.

**Contacts export** (`useContactImportExport.ts:43`) still calls `ensurePermissions(["downloads"])`
via the retained `general.ts` helper — now a no-op that always resolves granted (no prompt), so it
benefits identically without a code change.

**Gate:** build:chrome + build:firefox exit 0 (downloads in required permissions); files unit 2/2;
lint + typecheck:all 0.
