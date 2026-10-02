# Phase 5 — Q14: extract the restore-result error helper + R3 normalize

Branch `refactor/q14-restore-result-helper` off `dev`. Developed in parallel with Q22
(#108, network flake hold) — zero file overlap (restore services vs wallet-core).

## Re-verified vs current dev (stale-snapshot guard)
- 14 `restoreError` accumulation sites confirmed: 11 service files (account-state ×2,
  profile ×2, fpc ×2 incl. the hardcoded carve-out, + account/auth-registry/config/contact/
  network/token-balance/token/transaction) + the consumer side (`useFullBackupImport.ts`,
  `full-backup-helpers.ts`) which only READ/filter `restoreError`.
- Plan line refs were stale (contact at :310/:311 not :290; fpc carve-out at :485/:486).
- **Scope correction:** the plan said to extract "the per-item result/error accumulation
  helper", but the only genuinely-shared, safe-to-dedup piece is the **error-derivation**
  (`err → string`). The accumulation loop/validation/locking/id-allocation legitimately
  differ per service (registry #11) — left as-is. So the extracted unit is `toRestoreError`.

## What shipped
- New `@/utils/restore-error.ts#toRestoreError(err)` = `err instanceof Error ? err.message : String(err)`.
  Pure, SW-safe, single-responsibility (NOT folded into the popup-themed `full-backup-helpers.ts`,
  to avoid SW services depending on a popup util).
- 13 sites routed through it (10 standard + account-state ×2 + fpc:511). `restoreError` is now
  uniformly `string` (was `string | unknown`) — a type improvement consumers already tolerate.
- **R3 (ratified behavior change):** `contact/service.ts` stored the raw `err`; now uses the
  helper → message string. object→string.
- **Carve-outs preserved verbatim:** `fpc/service.ts:486` hardcoded `"Token FPC deprecated…"`
  (not err-derived → helper not applied); `account-state` nested sender/contract shape (only the
  inner err-derivation swapped).

## Pins
- `restore-error.test.ts` (5): Error→message, subclass→message, string→itself, non-Error→String, always-string.
- `contact/service.test.ts` (R3): forced restore failure (`set` rejects) → `restoreError` is the
  message STRING, not the raw Error. This is the pin for the behavior change.
- `account-state/service.test.ts`: nested restore with absent network → both sender & contract
  `restoreError` are the normalized string at the nested level.
- **Deviation (fpc:485 pin):** no `fpc/service.test.ts` exists and standing up an FPC harness
  (mocks token+network+pxe+storage) to assert one UNTOUCHED hardcoded literal is disproportionate.
  Risk is nil — the helper is not applied there (grep-confirmed verbatim). Flagged for the codex
  post-impl audit; if required, a focused fpc restore test can be added then.

## Gate result (local)
| Check | Exit | Result |
|---|---|---|
| lint (repo) | 0 | Q14 files clean (53 pre-existing warnings, incl. transaction:43 unused pxeService — not mine) |
| extension typecheck (vue-tsc) | 0 | `restoreError` narrowed to `string`; `@/utils/restore-error` resolves |
| extension test (full) | 0 | 201 files / 2443 tests (network + profile + contact + account-state restore pins intact) |
| extension build | 0 | SW bundle compiles with the new import |
| smoke (`test:e2e`) | 0 | 19 files / 70 tests — full-backup import flow intact |

Pitfall logged: a long array-literal in the account-state pin tripped biome's **formatter**
(reported as 1 `bun run lint` error, not a lint-rule) — `biome check --write` fixed it. Edit-tool
insertions aren't auto-formatted; run biome --write on Edited test files before linting.

Network-e2e: NOT gated (smoke covers restore). Merge precondition: Quality green AND the smoke
job proven run (not skipped) + green in CI.

LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-5.md
