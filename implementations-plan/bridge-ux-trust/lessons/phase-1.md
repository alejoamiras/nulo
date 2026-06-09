# P1 — bridge-core foundations (lessons)

## 2026-06-09 — implementation opened (gate: APPROVE)
Gate outcome: user APPROVE; A1 retain-until-Clear; A2 no-backwards-compat (L15 — legacy keys deleted, v2-only blobs, downgrade attack closed structurally); A3 CSP deferred. Plan frozen at the post-final-codex fold.

P1 scope (from plan.md): `journal.ts` (+test) NEW — schema D1, per-record merge-write, stage derivation, MAX_RECORDS prioritized retention, prune; `recovery.ts` (+test) DELETE; `recovery-crypto.ts` (+test) EXTEND — v2 envelope (`sealDepositEnvelope`/`openDepositEnvelope`, v2-only, no fallback), `sealDepositRecord({sign, binding, meta, trusted})` (trusted ⇒ 1 sign, untrusted ⇒ 2-sign self-test); `seal-trust.ts` (+test) NEW — provider-aware positive-only cache; `index.ts` export swap.

Validation gate: `bun run --cwd packages/bridge-core test && bun run --cwd packages/bridge-core typecheck && bun run lint`.
