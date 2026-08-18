# Arc 2 — fix-profile-deletion-status (F-B24 durable resume)

[mid] tier of the 2026-08-16 remediation follow-ups ([spec](../remediation-followups/plan.md)). One classified **behavior fix**, prove-first. Dual audit (codex + fable); bounded loop. Validation: repo gates + `audit:vue` + **armed smoke** + **SOLO proverless network e2e**.

## Recon (2 parallel agents, `dev@a114aa1b`) — the spec's design is REDIRECTED

The spec proposed "a deletion-status field on the profile row". Recon rejects both halves on current dev:

1. **No row field.** The pre-production no-migration rule holds verbatim (`CLAUDE.md:92`; also `service.ts:944-945` in-code). Stronger: `nulo:core:profiles` is on the backup import **block-list** (`backup-migration-registry.ts:223` — "a migration touching either blocks import"), so a migration here would be actively harmful. And the profile store has NO codec (`repository.ts:42-46` → `entity_storage.ts:84` un-validated path), so even an optional field is parse-neutral — but it's also unnecessary:
2. **The durable orphan signal already exists.** `RestorePendingRepository` (`nulo:core:restore-pending@<id>`) is written service-side BEFORE the row lands (`service.ts:1461-1472`, marker-before-row bracket) and cleared only by `finalizeRestore` entry (`:1628`), `deleteProfile` phase 1 (`:996` — AFTER the tombstone, so a pre-tombstone failure leaves it), or the resume (`:1035`). EVERY F-B24 orphan variant — persistent rollback failure, SW death mid-import, popup closed, RPC transport death (service never ran) — leaves marker + row with matching `pxeGeneration`. A marker surviving into a NEW SW lifetime is definitionally a torn import: it can never be finalized (`openSessionVerified:836-860` throws `RestoreTornError`); today it is inert but **immortal** (manually deletable only).
3. **The boot-resume machinery already exists** for the tombstone half: `resumePendingDeletions` (`service.ts:1015-1056`) ← `ProfileDeletionCoordinator.resumePending` ← `runtime.ts:260-266`, which already re-runs phase 1 idempotently and swallows per-profile failures. The residual is exactly the **no-tombstone window** (B-12's cleanly-failed tombstone write releases the reservation with nothing durable; plus transport-death).
4. The rollback helper's own comment (`useFullBackupImport.ts:375-382`) explicitly hands "a truly authoritative deletion-status" to a ProfileService-level follow-up — this arc.

## Fix (smallest safe change — no new storage shape, no new marker repo, no UI change)

**Extend `resumePendingDeletions` with a torn-import sweep** that walks stale restore-pending markers and *initiates the real `deleteProfile`*, letting the existing three-phase machinery (tombstone durability → next-boot resume) self-heal everything downstream:

- `RestorePendingRepository` gains a listing API mirroring `TombstoneRepository.validPayloads()` (valid payloads; corrupt keys surfaced for fail-closed logging).
- `resumePendingDeletions(bootCutoff?)`: after the existing tombstone loop, for each valid marker with `at < bootCutoff` (**B-03 discipline — a LIVE import's marker, `at >= bootCutoff`, is never touched**; `runtime.ts:255` already captures the cutoff for the reaper):
  - row present + `pxeGeneration` matches → torn import → `await this.deleteProfile(id)` (full cascade; if IT fails pre-tombstone the marker survives → next boot retries; if post-tombstone, the tombstone loop finishes it — self-healing).
  - row absent → purge the bare marker.
  - generation mismatch → purge marker only (the lazy purge `openSessionVerified` does, eagerly).
  - corrupt marker → fail-closed: leave everything, log (tombstone doctrine — never delete what you can't decode).
  - per-marker try/catch + log, mirroring the tombstone loop.
- `ProfileDeletionCoordinator.resumePending(bootCutoff?)` passes through; `runtime.ts` passes the already-captured `bootCutoff`.

**Constraints honored:** the B-12 pin (`service.integration.test.ts:1788` — cleanly-failed tombstone write leaves `isReserved=false` + profile listed) stays green: `deleteProfile` itself is untouched; the sweep acts only at the NEXT boot. `getProfiles` filtering unchanged (the torn-import path deliberately chose show-but-refuse; between failure and next boot the orphan stays visible + `RestoreTornError`-refusable — unchanged from today; no popup-register empty-list side effect). Composable unchanged (bounded retry + CLEANUP_PENDING copy stay honest; the orphan now self-heals at next SW boot). General (non-import) delete failures have no marker and are OUT of F-B24's scope — recorded, not smuggled in.

## Prove-first (RED before fix; two-boot harness per `service.integration.test.ts:1291`)

- **RED-1 (primary):** boot1: `restore()` a profile (row + marker land; finalize never runs — import died). boot2 (fresh `ServiceCollection` over the same `FakeBrowserApi`): wire the delegate, run the resume → assert TODAY: row still present, marker still present, `getProfiles` lists it. **RED.** GREEN: row gone, marker gone, siblings purged, id released.
- **RED-2 (rollback variant):** boot1: `restore()` + `deleteProfile` with tombstone-write fault injection (the B-12 `vi.spyOn(set)` key-prefix idiom) → phase 1 aborts pre-`:996` → marker survives, reservation released (B-12 green). boot2 resume → same GREEN.
- **Guard pins (GREEN-side invariants):** live-import safety (`at >= bootCutoff` NOT reaped); generation-mismatch purges marker only (row untouched); bare marker purged; corrupt marker fail-closed (row + marker untouched).
- Existing suites stay green: B-12 pins (`:1788/:1810`), torn-marker block (`:1564-1690`), composable rollback pins (`useFullBackupImport.test.ts:1136-1250` — no composable change), repository/tombstone/restore-pending unit suites.

## Dual audit (codex + fable) over complete arc diff — bounded (initial + max 2 resumes)
_pending._
