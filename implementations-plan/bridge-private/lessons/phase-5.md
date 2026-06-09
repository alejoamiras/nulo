# PV5 — final gates (lessons)

## 2026-06-09 — codex post-impl audit (kicked off)
PV1–PV4 are code-complete + green (lint, typecheck, 142 faucet tests, build). Kicking off the codex post-impl security/correctness audit of the WHOLE private-flow surface before declaring done (the loop's PV5 step).

Audit scope (prompt: `/tmp/codex-pv5-audit.md`): the seal (bearer-secret leak paths, per-record key, self-test), the deposit recipient-binding guard, the withdraw authwit (nonce replay, atomicity), cross-flow state confusion. Files: `useDeposit.ts`, `useWithdraw.ts`, `recovery-crypto.ts`.

**Verdict: PENDING** — codex running in the background; on completion, address CRITICAL/HIGH, then STOP.

## Not autonomous (the user's final steps)
- `/code-review max --fix` — interactive guided tour; the user drives it.
- Manual testnet tests for PV1 (private deposit) + PV2 (private withdraw) — signature-gated; see `lessons/phase-1.md` + `phase-2.md` for the expected flows.
