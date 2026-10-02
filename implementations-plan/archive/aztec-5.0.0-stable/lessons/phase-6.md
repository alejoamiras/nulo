# Phase 6 — Delivery: PR + CI + audits

PR #282 → dev, labels `e2e:network` + `e2e:smoke`. `quality-status` GREEN. `/code-review max --fix`
(4 clusters) applied in `06885be`; codex post-impl audit (REJECT → all merge-blockers folded in
`63541a2`, transcript `audit-codex-postimpl.md`). Deferred OPFS concurrency → issue #281.

## OPEN REGRESSION — full-backup-restore boot hangs (network + smoke e2e RED)

**Not a flake — deterministic, reproduces locally, and dev's own smoke CI is green on these tests.**

### Symptoms
- `network-e2e` shards 1 & 5 + `smoke` all RED. Every failure is a BACKUP test timing out:
  `backup-restore-integrity`, `backup-migration-roundtrip` (network), `backup-roundtrip` (smoke).
- The network shards also log `[aztec-node] Error: Address already in use (os error 98)` — a real
  but SEPARATE infra-contention signal; the smoke failure is node-free, so it isolates the bug.
- All three hang inside `importFullBackup` → the final `waitForHash("#/popup/general")`.

### Localization (via local repro + SW/offscreen console capture)
The full-backup RESTORE itself SUCCEEDS: slices restore, config restores, FPC discovery registers
the canonical PrivateFPC `0x257aa8…` exactly once (the salt fix works), and `finalizeRestore` emits
`Profile unlocked, draining discovery queue (0 queued)`. Then it HANGS — the import-side offscreen
PXE **never boots** (no `Started PXE`, no store creation, no FPC discovery for the second extension,
unlike the export-side extension which boots fully).

Chain: `finalizeRestore` (holds `ProfileService.runExclusive`) → `onActiveProfileChanged` →
`app.vue bootstrapActiveProfile` → `ensureDefaultAccount` → account/PXE boot → HANGS before the PXE
opens its encrypted store. `completeImport`'s `waitForProfileActive(30s)` then times out and routes
to `/popup/auth` (NOT `/popup/general`), so the test's `waitForHash` never matches → 60s timeout.

### Prime suspects (not yet root-caused)
1. The store-key provider (`runtime.ts`) re-enters `profileService.getProfileSecret` — which takes
   `runExclusive` — during the restore bootstrap. A lock/re-entrancy interplay with the restore
   sequence could wedge the import-side PXE boot.
2. This likely INTERSECTS the deferred #281 OPFS store-lifecycle concurrency items (D3/D4/D6) — the
   "acceptable pre-production" deferral is FALSIFIED if one of them breaks a required restore e2e.

### Fix applied so far (does NOT resolve the hang)
`ensureContractRegistered` → `getContractInstance(address, { pxeOnly: true })` (`d58840f`): a real,
codex-flagged hardening (the 5.0.0 preimage seam made a PXE-local miss cascade to an unreachable
node), but the restore-boot hang persists past it.

### Why NOT merged / NOT re-run-spammed
Deterministic red (re-run is pointless), the fix is non-trivial in a fund/security-sensitive boot
path, and it touches the #281 deferral decision (plan scope). Phase 7 is user-gated regardless.
**Surfaced to the user for a decision on the path forward.**
