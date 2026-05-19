# M4 audit consolidation — master summary

Date: 2026-04-26
Branch: `planning/m4` (from `55f88a4` = 0.13.1)

## Coverage

10 active plans dual-audited (codex xhigh + Plan agent). 1 stub (M4.11). README + 10 × `plan.md` + 10 × `audit-codex.md` + 10 × `audit-agent.md` + 10 × `audit-diff.md` = 41 files.

## Plan status table

| PR | Plan format | Audit risk | Plan revision needed? | Notes |
|---|---|---|---|---|
| M4.6 | execution | low | minor | 5 missing zeroize sites + JSDoc edits + Fr-self-test patterns. In-place. |
| M4.9 | execution | medium | minor | 2 BLOCKERs: missed `rp.id` at create flow (line 40); pre-build script reads non-existent dist manifests. In-place. |
| M4.3 | execution | medium | minor | 3 BLOCKERs: trust-check seam wrong layer; wrong imports; M4.7 dependency claim wrong. In-place. |
| M4.5 | execution | medium | minor | 2 BLOCKERs: stale alarm scheduledTime gate; sync EventHandler.add issue. In-place. |
| **M4.7** | execution | **HIGH** | **MATERIAL RESHAPE** | 3 BLOCKERs: version-key clobbers ValueStorage; runner can't migrate session/IndexedDB; write fence not actually shared mutex. **Plan v1 needed before M4.7-a opens.** |
| **M4.10** | execution | **HIGH** | **MATERIAL RESHAPE** | 3 BLOCKERs: migrator can't fit single-root contract; orphan cleanup contradicts itself; `renameIndexedDb` underspecified. **Depends on M4.7 v1.** |
| **M4.4** | execution | **HIGH** | **MATERIAL RESHAPE** | 4 BLOCKERs: durability claim impossible; 5min reap unreachable behind 90s timeout; missing `chrome.runtime.sendMessage` failure window; idempotency catalog absent. **Recommend descope to "observability-only" OR persist pending state.** |
| M4.2 | decision memo | medium | memo revision | 1 BLOCKER: internal contradiction on non-extractable CryptoKey. Plus prework tightening. Awaits passhash decision. |
| M4.8 | decision memo | medium | memo revision | 2 BLOCKERs: Design Y `parseInt(handleId)` wrong; M4.7 session-storage incoherence. Awaits M4.2 decision. |
| M4.1 | decision memo | medium | memo revision | 3 BLOCKERs: bootstrap mechanism missing; Design 1 wrong seam; Design 2 migration underspecified. Plus add Design 1.5. Awaits M0.5.a decision. |

## Critical findings — what to escalate to user

### Plans needing material reshape before execution (3)

1. **M4.4 — Offscreen recoverability**: codex showed the "durable + reapable" claim is impossible without persistence. The 5-min reap path is dead behind the 90s request timeout. Plan needs reshape:
   - **Option A (recommended)**: descope to "observability-only" (telemetry surface + send-failure cleanup). Drop `orphaned`/alarm/reap/durable claims.
   - **Option B**: persist pending request metadata in `chrome.storage.session.nulo:offscreen:pending` (M4.7-c migration entry needed). Higher cost.
   - **Idempotency catalog** required regardless — classify every `PxeServiceClient` RPC.

2. **M4.7 — Schema migrations**: codex showed 3 design errors that would clobber storage roots and not migrate session/IndexedDB at all. Plan needs reshape:
   - Backend-aware migrator type (`local` / `session` / `indexeddb`) instead of single-root.
   - Backend-agnostic version-metadata adapter (bare-root for EntityStorage, sidecar for ValueStorage/IndexedDB).
   - Shared per-root lock registry (or simplify to boot-only migrations, drop lazy migrate-on-read).
   - Cross-root ordering (`after: [...]`) — required, not deferred.
   - Inventory cleanup: `nulo:core:session` is session-only; `nulo:core:tx-cursors` is dead code.

3. **M4.10 — PXE per-RPC isolation**: codex showed M4.10's migrator can't fit M4.7's single-root contract. Depends on M4.7 v1's reshape. Also: orphan-cleanup logic contradicts itself; `renameIndexedDb` underspecified for partial-failure idempotency.

### Decision-memo plans awaiting product input (3)

- **M4.2** (passhash hardening) — Design B (re-auth on SW restart) recommended; awaits product call.
- **M4.8** (passkey symmetry) — Design X recommended; awaits M4.2 decision + M4.8's "in-flight pending" question.
- **M4.1** (content-script scope) — 3 designs (1.5 = narrow allowlist; 1 = broad+wrap; 2 = dynamic registration). Awaits M0.5.a + bootstrap-mechanism decision.

### Plans with minor in-place fixes (4)

- **M4.6** (zeroization) — 5 missing callsites + JSDoc + Fr-self-test patterns.
- **M4.9** (RP ID build-time) — patch `rp.id` line 40 + read source manifests + AST drift detection.
- **M4.3** (registry trust) — relocate trust check into `ArtifactRegistry.resolve`; fix imports; cache verified class-ids.
- **M4.5** (proactive TTL) — `scheduledTime` gate; sync EventHandler.add via `void (async () => {})()`.

## Files dropped per plan dir

```
implementations-plan/M4/
├── README.md                # master overview
├── AUDITS-SUMMARY.md        # this file
├── 1/                       # M4.1 (DECISION MEMO)
│   ├── plan.md
│   ├── audit-codex.md
│   ├── audit-agent.md
│   └── audit-diff.md
├── 2/                       # M4.2 (DECISION MEMO)
│   ├── plan.md
│   ├── audit-codex.md
│   ├── audit-agent.md
│   └── audit-diff.md
├── 3/ … 10/                 # 8 more plans, same shape
└── 11/
    └── plan.md              # DEFERRED stub, no audits
```

## What was NOT done (deliberate scope cuts)

- **In-place plan revisions**: audit findings are documented in audit-diff.md per plan, but the `plan.md` files themselves are NOT revised in-place. Reasoning: 3 plans need material reshape (M4.4, M4.7, M4.10); revising them piecemeal during the audit pass would risk introducing partial-fixed plans. Recommended: when M4.4/M4.7/M4.10 execution begins, do a focused "plan v1" pass against audit-diff.md, then ship.
- **Per-plan epoch counters / shared lock registries** for M4.7 — sketched in audit-diff but not yet detailed in plan.
- **M4.10 migrator interface adjustments** — depend on M4.7 v1.

## Branch state

`planning/m4` has 41 new files. Audits done; consolidated. Ready for user review.

When user approves, options:
- Squash-merge `planning/m4` to master.
- Or rebase + interactive squash to keep individual plan history.

## Next steps (post user approval)

1. Squash-merge `planning/m4` → master.
2. When the first M4 PR begins (recommended: **M4.6** since user picked it as first), the implementer:
   - Reads `plan.md` + `audit-diff.md`.
   - Applies the SHOULD-FIX absorptions in the actual code change.
   - Documents any further deviations in a "Pre-execution revision" section at the top of `plan.md` before the PR opens.
3. For M4.4, M4.7, M4.10: do a **planning revision pass** before opening the execution PR. Plan v1 should ship as a commit on top of the audit-diff before any code lands.

## Audit telemetry

| Metric | Value |
|---|---|
| Audits fired | 20 (10 codex + 10 Plan agent) |
| Audits returned cleanly | 20 / 20 |
| Codex hangs | 0 |
| Plans with at least one BLOCKER | 7 / 10 (M4.6, M4.2 = no BLOCKER) |
| Plans with material-reshape BLOCKERS | 3 (M4.4, M4.7, M4.10) |
| Plans ready for execution after in-place absorption | 4 (M4.6, M4.9, M4.3, M4.5) |
| Decision memos awaiting product input | 3 (M4.1, M4.2, M4.8) |
| Total wall-time for the planning arc | ~3 hours |
