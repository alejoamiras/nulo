# M4 — Production hardening (~10-15d of execution)

## Overview

M4 is the security/reliability hardening arc after the M3 package boundary work. Source of truth: `architecture/plan/03-final-plan-v3.md:218-232`.

11 plans pre-written + dual-audited. After 2026-04-26 user decisions (see `DECISIONS.md`) the initial active list was **6 PRs** (4.6, 4.9, 4.5, 4.4, 4.3, 4.1). M4.2 + M4.8 were subsequently un-deferred and shipped together as one PR ("strict security mode default ON" pivot). M4.10 was reshaped into a standalone "network-model rework" arc (planned + audited under `10-network-rework/`) and shipped 2026-04-27.

**Final shipped scope: 9 PRs.** Two plans remain deferred:
- **M4.7** — per-collection migrations (re-opens when users exist).
- **M4.11** — encrypted metadata at rest (large refactor, unchanged deferral).

See `DECISIONS.md` for the per-PR rationale.

## Ship status

All 9 active PRs shipped + 1 user-requested follow-up. Manual smoke verified (DevTools `[sw:offscreen-telemetry]` records flowing on M4.4-followup; M4.10 manually QA'd across all three sub-PRs).

| Order | PR | Commit | Notes |
|---|---|---|---|
| 1 | M4.6 | `26b2659` | zeroize helper + 11 secret/passhash sites |
| 2 | M4.9 | `1686132` | passkey RP ID build-time gate (`nulo.sh`) |
| 3 | M4.5 | `05a6cc5` | proactive TTL via `chrome.alarms` |
| 4 | M4.4 | `34d5189` | offscreen Option A — telemetry + send-failure sync cleanup |
| 5 | M4.3 | `93a31c9` | artifact-registry class-id verification |
| 6 | M4.1 | `b6903c6` | wallet-sdk zod content-script envelope validator |
| 7 | M4.4-followup | `7f76aa4` | default `LoggingTelemetrySink` + Info-level for anomaly statuses (User-flagged: M4.4 telemetry surface shipped but defaulted to `NoopTelemetrySink`, so production callers dropped events. See `4/wiring-followup.md`.) |
| 8 | M4.2 + M4.8 | `4330d33` (+ followup `bb20f95`) | strict security mode default ON; opt-out toggle. Symmetry: passkey + password profiles both lock on SW death by default. |
| 9 | M4.10 (network-model rework) | merge `51a1cb8` | split conflated `Network` into `Network` (chain-level) + nested `NetworkEndpoint[]`; `primaryEndpointId` resolves active endpoint; pending txs pin to submission URL. Three sub-PRs: core entity rewrite + cascade + polling pin · per-Network detail page + endpoint CRUD popups · e2e/docs. Plan archive: `10-network-rework/plan-v1.md` → `plan-v4.md`. Original `10/plan.md` preserved with a SUPERSEDED banner. No migrations — storage v3 wipes + reseeds. |

Versions: 0.13.1 → 0.13.7 (M4 ship) → 0.13.8 (M4.4-followup) → 0.13.9 (M4.2+M4.8) → 0.13.16 (M4.10 arc closed).

**Closes the M4 arc.** Remaining items (M4.7, M4.11) are tracked for future arcs.

## Sequencing graph (post-audit)

```
1.  M4.6 — Best-effort zeroization                  hours       [self-review tier]
2.  M4.9 — RP ID build-time contract                1-2d        [dual audit]
3.  M4.3 — Registry trust (class-id validation)     2-4d        [dual audit]
4.  M4.5 — Proactive TTL via chrome.alarms          1-2d        [dual audit]
5.  M4.7 — Per-collection schema migrations         1-2w        [dual audit]
6.  M4.10 — Per-RPC PXE isolation  ⟵ depends on M4.7  2-3d        [dual audit]
7.  M4.4 — Offscreen recoverability                 3-5d        [dual audit]
8.  M4.2 — Harden session secret                    decision    [dual audit on memo]
9.  M4.8 — Passkey session symmetry  ⟵ depends on M4.2  decision  [dual audit on memo]
10. M4.1 — Content-script scope review              decision    [dual audit on memo]
11. M4.11 — Encrypted metadata at rest              DEFERRED    [stub]
```

**Sequencing rationale (audit synthesis):**
- M4.6 first per user override (codex's "ship the small stuff early" over Plan agent's "wait for M4.2"). M4.6 plan documents the "best-effort while persisted passhash still leaks via M4.2" caveat explicitly.
- M4.9 → M4.3 → M4.5 are independent low-risk locks of the foundation: build-time RP-ID gate, artifact-trust hardening, proactive lock alarm.
- **M4.7 must precede M4.10** (codex BLOCKING). M4.10's `${profileId}/${chainId}/${sha256(rpcUrl)}` PXE data-dir scheme requires a one-time IndexedDB rename, which M4.7's per-collection migrator handles cleanly. Without M4.7 first, M4.10 ships its own one-shot wipe — strictly worse.
- M4.5 does NOT need to wait for M4.4 (codex confirmed; alarms fire SW→SW, not SW→offscreen).
- M4.2 / M4.8 / M4.1 are decision memos (M0.5.a content-script scope, passhash design, passkey symmetry mode). These are written as design constraints + prework checklists, NOT step-by-step execution. They convert to execution plans once the underlying decisions land.
- M4.4 follows the foundation work because its durable request-id map benefits from M4.7's collection migrator if the relay state becomes persistent.

**Audit tiering:**

| PR | Tier | Audit calls |
|---|---|---|
| M4.6 | self-review | 0 |
| M4.9 | dual | 2 |
| M4.3 | dual | 2 |
| M4.5 | dual | 2 |
| M4.7 | dual | 2 |
| M4.10 | dual | 2 |
| M4.4 | dual | 2 |
| M4.2 | dual (memo audit) | 2 |
| M4.8 | dual (memo audit) | 2 |
| M4.1 | dual (memo audit) | 2 |
| M4.11 | stub only | 0 |
| **Total** | | **18** |

User override: dual audit on every active plan except M4.6 (self-review tier).

## Critical invariants (preserved across the entire arc)

1. **M2.6 crypto vectors** (`packages/extension/src/wallet/crypto/key-vectors.test.ts`) — byte-identical KDF + AES-GCM output across the full M4 arc. Any plan that touches `@nulo/wallet-crypto` runs M2.6 vectors before + after.
2. **KDF labels** — `nulo:kdf:v1`, `nulo:master:v1`, `nulo:profile:v1`, `nulo:passkey:prf` — never change values.
3. **Storage keys** — `nulo:core:session`, `nulo:core:profiles`, `nulo:core:accounts`, etc. — frozen names. M4.7 introduces per-collection version sidecars but does NOT rename collections.
4. **AES-GCM ciphertext format** — `[version byte][12b IV][ct]` — frozen.
5. **Passkey RP ID `nulo.sh`** — locked. M4.9 doesn't change the value, it gates the value behind a build-time mismatch check.
6. **Layer hierarchy** (M3.7-enforced) — `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`. M4 plans respect existing boundaries; new abstractions land in the right layer.

## Test philosophy across M4 (audit-incorporated)

**Include (per plan):**
- Tests that fail if you remove the new code.
- Helper-level + invariant tests (not per-callsite white-box).
- Security-critical paths (build-time gates, wrap/unwrap vectors, mismatch detection, lock enforcement).
- Seam tests using `@webext-core/fake-browser` via `FakeBrowserApi` (no `vi.mock` for chrome APIs).
- Migration round-trips with golden fixtures (M4.7).
- Contract tests modeled on the M1-RT pattern (`background/client.test.ts:71`) for transport-touching plans (M4.4).

**Skip (per plan):**
- Trivial getters/setters.
- Testing chrome APIs themselves (e.g. that `chrome.alarms.create` accepts an object).
- UI/visual state (defer to e2e).
- "Buffer-state-after-zero" assertions and similar GC theater (M4.6 audit).
- "100% coverage" tests with no meaningful invariant.
- Integration paths covered by smoke e2e.

Where existing tests need attention, plans explicitly say: "delete X (doesn't fail on regression)" or "tighten Y (passes for wrong reason)" — not just add more.

## Per-PR audit deliverables

Each `implementations-plan/M4/X/` directory ends up with:

- `plan.md` — the implementation plan
- `audit-codex.md` — codex xhigh review
- `audit-agent.md` — Plan agent review
- `audit-diff.md` — what changed in the plan after audit feedback (BLOCKING fixes applied, SHOULD-FIX inline-noted, NITs dropped)

(M4.6 ships with `plan.md` only — self-review tier per user override.)
(M4.11 ships with a stub `plan.md` — deferred status, no audits.)

## Branch strategy

This planning batch lives on `planning/m4` (forked from master `55f88a4` = `0.13.1`). After all 10 plans audited + consolidated, single ref-refresh pass against master, then merge.

## Exit criteria for M4 (the milestone, not the planning arc)

- All 10 active PRs shipped.
- M2.6 crypto vectors pass byte-identically post-M4.6, post-M4.7's wallet-crypto-touching changes, post-M4.2 (when it executes).
- Storage migration test suite passes for every collection in M4.7's migration registry.
- `bun run check:imports` clean across the entire arc.
- Smoke e2e + network e2e green at every checkpoint.
- `SECURITY.md` updated to reflect post-M4 threat model: passhash bearer eliminated (M4.2), zeroization shipped (M4.6), proactive TTL (M4.5), build-time RP ID gate (M4.9).
