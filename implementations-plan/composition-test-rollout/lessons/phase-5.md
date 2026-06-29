# Phase 5 — COMPOSITION-TESTS.md + CLAUDE pointer + drift guard

## What landed
- `packages/extension/tests/COMPOSITION-TESTS.md` — the normative doc. What-it-is + a decision tree + hard rules **D1–D6** (D6 = bb-free, the Phase-2 finding) + the failure taxonomy (theatre / second-wallet / drift / **bb-bound**) + a worked-examples TABLE (DappSession ✅, Token `parseTokenInterface` ✅ vs `addToken` ❌, **Fpc discovery ❌ — the counter-example**, Execution cancel ✅) + a paste-in reviewer checklist.
- `CLAUDE.md` "Pointers" gains a normative link to it.
- **Drift guard** — the compile-time conformance is already LIVE from Phase 1: the fake's surface is `Pick<IPXE,…>` under `src/`, so `typecheck` catches any `IPXE` shape drift, and `shallow-port.test.ts` pins it. The optional real-PXE seam canary stays deferred (compile-time conformance + Network e2e already cover shape + semantics; a canary would need the network lane — not worth the duplication, per the audit demotion).

## Gate — MET
`COMPOSITION-TESTS.md` exists + the CLAUDE link resolves · `bun run lint` (0) · `bun run --cwd packages/extension typecheck` (0).

LESSONS_FILE=implementations-plan/composition-test-rollout/lessons/phase-5.md
