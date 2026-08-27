# Adjudication — 2026-08-24 second opinion

Independent re-verification of every finding in [report.md](./report.md), performed 2026-08-24 against dev HEAD `30fa4806` (three commits past the audit base `024ddaac`; none of the three touches any finding, so the report applies to that dev HEAD unchanged). Method: all six RED proofs executed against dev HEAD in a clean worktree — **all six fail exactly as documented**; nine independent source-level adjudication passes, each instructed to refute rather than confirm; the Critical (N-01) additionally traced first-hand.

**Scoreboard: 19 findings confirmed as stated · 8 real but re-weighted · 1 refuted as production-reachable (N-20).** No fabrications; file:line citations accurate throughout. The audit's systematic bias is crediting worst-case triggers without checking the transport timeouts that foreclose them.

## Launch gate — fix before production exposure

- **N-01** (confirmed, first-hand — worse than "compound race"): `backupStatus` stays empty through the whole KDF leg, so the CTA stays enabled and the Enter handler's `default` branch re-fires, including during `"progress"`. Two runs interleave over module-level state → stuck spinner on any slice throw, and a downloadable backup whose embedded checksum matches no snapshot — a backup that self-rejects as tampered at restore. Fix = port the import side's own latch pattern (`useFullBackupImport.ts` names this exact hazard).
- **N-02** (confirmed, proof red): "launch-blocking" is precise, not hyperbole — repo policy ships the first real migration at production launch, so dormant-today and blocking share a date. N-18 rides in the same PR.
- **N-04** (confirmed): cross-profile reads need the second profile's own non-expired grant, but the cross-profile linkability over one continuous channel needs nothing — a product-promise break for a privacy wallet.
- **N-11** (confirmed, proof red): overturn the deferral. The audit's harm witness (N-17) fails — the intra-lock PXE call is bounded by the 90 s offscreen timeout — but a stronger witness exists: `deleteNetwork` holds the network lock across `purgeChain`, whose `clearChainState` leg deliberately carries the 30-min prove-tx envelope, so >5-min holds are by-design reachable. 16 production locks inherit the owner-token fix.
- **N-06** (confirmed, latent): the sweep's live-set comes from the decoded view (schema-invalid rows hidden-but-kept) while keys enumerate raw — a row the storage layer deliberately preserved gets its sealed signing key destroyed on every boot. No producer today; permanent loss when one appears. ~5-line fix on the in-file precedent.

## Full verdict table

| ID | Audit | Verdict | Adjudicated call |
|---|---|---|---|
| N-01 | Critical | confirmed | Launch gate. Re-entry is one extra click/Enter; self-rejecting backup artifact. Fix S (port import-side latch). |
| N-02 | Major | confirmed | Launch gate (first migration = launch). Proof red. TRAP: audit's recipe kills auto-retry — add cool-down or gesture-gated retry. |
| N-03 | Major | re-weighted | Mechanism real; orphan row is inert (no secrets, invisible to reads). Hygiene fence, S. Audit's `getSecretWithFence` helper doesn't exist — use the real ProfileDeletionState API. |
| N-04 | Major | confirmed | Launch gate. Terminate tuple-matching sessions in `onActiveProfileChanged`. Fix S. |
| N-05 | Major | confirmed | Pre-launch. Immunity window + auto-reconnect verified; trigger compound-rare; adopt the existing fence pattern. S. |
| N-06 | Major | confirmed | Launch gate (cheap landmine defusal). Live-set from raw row-id parse. S. |
| N-07 | Major | confirmed | Pre-launch. Proof red; reap clock starts at arrival, popup clock at baton-grant. No fund loss; retry works. S/M. |
| N-08 | Major | re-weighted | Split: bricked-spinner half is the real defect (single-context, any bootstrap RPC failure); hijack half very rare. One guard fixes both. S. |
| N-09 | Major | confirmed | **Resolved by removal** (decision of record below). |
| N-10 | Major | re-weighted | Fence gap real; harm ceiling = same address's balance at a different sync height, self-healing; needs same account imported into both profiles + double-switch mid-batch. Minor; fix for pattern consistency. S. |
| N-11 | Major | confirmed | Launch gate. Proof red. Owner token; witness corrected (see gate). S. |
| N-12 | Minor | confirmed | Proof red. Never serves secrets past TTL — lazy auto-lock only. TRAP: naive `runExclusive` wrap deadlocks. S/M. |
| N-13 | Minor | re-weighted | Giant-file path already fails clean (RangeError caught); real band is mid-size/gzip-bomb → transient popup crash. Cap anyway. S. |
| N-14 | Minor | confirmed | Same deletion-fence family as N-03; orphans unreferenced; retry shows confusing errors. M. |
| N-15 | Minor | re-weighted | Duplicate init usually rejects rather than burns fees; once-per-account ~30 s window; self-heals. Post-launch. M. |
| N-16 | Minor | re-weighted | UI never hangs the lock period — 60 s popup RPC timeout intervenes. Residual: background poll leak + misleading 60 s error. S. |
| N-17 | Minor | re-weighted | Trigger foreclosed by the 90 s offscreen timeout. Owner-token covers structurally; add post-await epoch re-checks opportunistically. S. |
| N-18 | Minor | confirmed | N-02 rider: bump attempts on the resume-restore path. S. |
| N-19 | Minor | confirmed | Proof red (verbatim copy verified byte-identical). Track ancestors, not all visited. S. |
| N-20 | Minor | **refuted** | Unreachable: every restore path reallocates ids via the canonical allocator. Proof c5-3 defective — can never go green; never adopt as a pin. Optional one-line hardening. |
| N-21 | Minor | re-weighted | Math checks out but PATH-B create has no production caller — latent. Bump the constant. S. |
| N-22 | Minor | confirmed | Literally empty catch; sole outlier in the popup family. Minutes. |
| N-23 | Low | confirmed | Progress-card-only residual, self-corrects; rows already profile-filtered. S. |
| N-24 | Minor | confirmed | Reachable via double-import of one backup; halves the 255 headroom. S. |
| N-25 | Minor | confirmed | Slightly broader than claimed (reaped-sentinel path leaks too); cleared on SW restart. S. |
| N-26 | Low | confirmed | Self-limiting; fails toward over-verification. TTL the marker. S. |
| N-27 | Low | confirmed | Telemetry one-liner (count in `storage.local`). |
| N-28 | Low | confirmed | Rare boot-time throw; next SW wake re-boots clean. `allSettled` + aggregate. S/M. |

## Where the audit ran hot, and what it missed

- **Transport timeouts, twice**: the 90 s offscreen default forecloses N-17's 5-min stall; the 60 s popup RPC timeout means N-16 never hangs the UI for the lock period.
- **The stronger N-11 witness**: `deleteNetwork` → `purgeChain` → `clearChainState` under the 30-min prove-tx envelope — right conclusion, wrong evidence in the report.
- **Dead-code reachability**: N-21 lives in caller-less PATH-B create; N-09's aztecReset path is vestigial (see below).
- **One defective proof**: c5-3 cannot distinguish bug from fix. The other five import real source and become regression pins once green.
- **Impact ceilings taken at worst case**: N-03's orphan is inert; N-10's "wrong balance" is the same address at a different sync height; N-15's "fee burn" is usually a rejected tx.

## Fix-recipe traps

1. **N-02**: the proposed short-circuit kills automatic retry — pair with a cool-down or a gesture-gated retry on the barrier; keep the "reopen to retry" copy honest.
2. **N-12**: wrapping `getActive()`'s close in `runExclusive` deadlocks (non-reentrant lock, most facade methods already inside the serializer). Use an alarm-identity-aware clear or serialize only the off-lock entry points.
3. **N-20**: do not merge proof c5-3 as a regression pin — it fails on healthy stores and after the fix alike.

## Decisions of record

- **N-09 → resolved by removal (owner-approved 2026-08-24).** The aztecReset/sentinel path is vestigial three ways: the sentinel has never been bumped since the open-source import (fresh installs stamp it at profile create, so the modal has never rendered for anyone); testnet resets are now handled by `purgeChain` → per-service `clearChainState` with the profile preserved; deeper protocol breaks ship as a new extension major via the integrity coordinator, whose design explicitly retired delete-CTA prompts ("deletion stays a deliberate settings flow"). The modal's prescribed remedy — delete your profile because Aztec changed — is affirmatively wrong under the address freeze. Removal deletes N-09's bug and the policy violation at once; the generic notification store/manager stay (they have other producers). Removal surface is enumerated in [the remediation runbook](../../../implementations-plan/audit-448-remediation/runbook.md), batch 6.
- **Remediation** is executed per [implementations-plan/audit-448-remediation/runbook.md](../../../implementations-plan/audit-448-remediation/runbook.md): nine strictly-sequential batches, each blueprint-planned, codex-mediated, gate-validated, and squash-merged on green.
