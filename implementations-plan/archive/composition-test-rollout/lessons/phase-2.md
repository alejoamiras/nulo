# Phase 2 — FpcService composition test + THE bb-boundary finding

## Headline finding (reshapes the rollout + the doc)
FpcService's INTERESTING orchestration is NOT composition-testable. `getFpcs` (auto-discovery), `addFpc`, `updateFpc`, `deleteFpc` all route through `getOrComputeProtocolAddresses` (`fpc/service.ts:91`) → `getContractInstanceFromInstantiationParams`, which computes a poseidon/Barretenberg artifact hash. The bb.js WASM is NOT loaded in vitest/jsdom → `BBApiException: std::bad_cast`. The repo DELIBERATELY keeps bb out of unit tests (`contract-resolver.test.ts:190` "selector derivation hits poseidon, which [vitest jsdom doesn't load]"; `nulo-account.test.ts:7`; `note-schemas.test.ts:13` "tends to fault under repeated unit-test calls").

So the composition layer's real boundary is NARROWER than "shallow PXE surface": it is **shallow PXE AND bb-free AND no simulate/prove**. The recon checked Fpc's PXE surface (shallow ✓) but missed that the orchestration internally DERIVES instances (bb). (Lesson: "shallow PXE surface" is necessary but NOT sufficient — the orchestration must also avoid bb crypto + simulation.)

## Codex consult (xhigh, session 019ee71c) — verdict adopted
Asked A (init bb) / B (drop Fpc) / C (re-scope to bb-free CRUD) / D. Verdict: **B** — "A means fighting an already-documented repo boundary for a flaky setup; C is weaker than it sounds (every interesting Fpc method hits the bb path; the bb-free sliver is too low-value to present as orchestration coverage). Fpc is the right counter-example." Codex confirmed Token's `parseTokenInterface` is NOT bb-blocked (candidate extraction is ABI-name filtering) and that the rollout stays worth it IF the claim is tightened to "shallow PXE, bb-free, no simulate/prove" (meaningful for DappSession storage, Token interface parsing, account-state backup/restore).

## What landed (honoring the /goal's "FpcService has a green composition test")
`fpc/service.composition.test.ts` re-scoped to the bb-FREE seam + read/authz paths: (1) the injected fake seam constructs + starts + serves the chainless `getFpcs()` early-return list (no protocol derivation, no PXE); (2) `getFpc` profile-scoped existence guard (unknown id → "Invalid id"). The bb-bound discovery/add coverage stays in Network e2e. Fpc is now the doc's HEADLINE counter-example. (Deviation from the approved plan — surfaced to the user; honest maximum composition coverage for Fpc, with the limit documented rather than gamed.)

## TRIMMED (post-impl value review) — Fpc cut entirely
After the correctness audits, a value-review (main + codex 019ee…) judged the re-scoped Fpc test **theatre**: the seam-pin asserts the new plumbing circularly; the bb-free reads are near-tautological; and the injectable `pxeClientFactory` was prod surface no test exercised. Verdict (both): cut it. Fpc was **fully reverted** (no `pxeClientFactory`/`browserApi` seams, composition test deleted). It stays the doc's pure counter-example — prose, no test. The rollout's real keepers: DappSession (real lifecycle/security coverage), Token (a wiring smoke test), the seams those two actually use, and — most durable — `COMPOSITION-TESTS.md` itself.

## Gate (pre-trim, for the record) — was MET
`vitest run fpc/service.composition.test.ts` (2/2) · fpc dir green · typecheck 0 · lint clean · build:chrome + marker grep → 0. (Test since deleted; Fpc service reverted to baseline.)

LESSONS_FILE=implementations-plan/composition-test-rollout/lessons/phase-2.md
