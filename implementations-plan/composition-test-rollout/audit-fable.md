# Fresh hostile audit — composition-test-rollout

Run by a top-tier **Opus `Plan` subagent** in isolated context (the `/blueprint deep` fresh-hostile-audit slot; **Fable 5 was unavailable**, so an Opus subagent filled the role — capability-over-name). It saw the plan for the first time and verified every load-bearing claim against the code. Its value: it was anchored on nothing, so it caught two shared-framing blind spots the two planner-derived reviewers (main + codex) missed.

**Verdict: conditional approve** (conditions: H1 + H2 + M1 + downgrade the "castless everywhere"/"<2s" claims + fix Phase-4 signature prose). All adopted.

## Blocking (High) — both adopted, both were shared blind spots
- **H1 — the bundle-grep CI guard does not exist.** The plan (inheriting the spike's framing) called bundle-grep "an existing CI guard." It is not: CI's only `dist/chrome` grep is for PROBE strings (`_network-e2e.yml:293`); the spike's marker is a comment enforced by a manual local grep only. **Fix adopted:** adding a real CI grep step for `SHALLOW_PXE_FAKE_BUNDLE_MARKER` (+ the spike's `FAKE_IPXE_BUNDLE_MARKER`) is now an explicit Phase-1 deliverable; Goal #4 + Security reworded. Ledger #12.
- **H2 — fake under `tests/` kills the drift guard.** `tsconfig include = src/**` and `lint = biome check src/`, so a fake under `tests/composition/` is never typechecked or linted → the "compile-time conformance" primary drift guard would be vapor for the fake side. **Fix adopted:** the shared fake lives under `src/` (`pxe/shallow-port.fake.ts`), relying on the CI marker-grep (H1) for the prod boundary. Ledger #11.

## Medium / Low — adopted
- **M1 — harness under-specified, throws at `init()`.** Token/Fpc `init()` need Profile/Account/Task/Journal + `onProfileDeleted.add` + `registerChainPurgeSubscriber`; `parseTokenInterface` calls `startNewTask`. **Fix:** Phases 2/3 now spell out the full required stub surface.
- **M2 — "castless" is real for the client, contingent for the fake.** The fake is castless only if it returns genuine stdlib instances/artifacts. **Fix:** seed real artifacts AND real instances (`getContractInstanceFromInstantiationParams`); "castless everywhere" downgraded to a constraint; at most one cast in the fake factory. Ledger #9.
- **M3 — "<2s" optimistic.** `TokenService` module-imports `simulate` → its graph loads even for unexercised paths. **Fix:** doc says measure, don't promise a hard number.
- **M4 — the global-stub rejection rationale was wrong.** `vitest.setup.ts:88-113` already does `vi.stubGlobal("chrome", …)` and the base `Service` ctor depends on it, so global-stubbing is the house pattern — "fragile global mutation" was not a valid reason to reject it. **Fix:** ledger #7 keeps the ctor seam but on correct grounds (per-test isolation + explicitness + symmetry), not fragility.
- **L1 — Phase-4 signature prose wrong.** `addDappSession(dappMetadata, permissions, accounts, confirmationLevel, chainId: string)`; `tryGetDappSessionByOriginAndChain(origin, chainId: string)` matches on `dappMetadata.url`. **Fix:** Phase-4 prose corrected.
- **L2 — Phase-1 marker-grep trivial until a fake-importing test exists.** **Fix:** noted in the Phase-1 gate (load-bearing from Phase 2+).

## Validated (genuinely fine)
Castless port (client side), Token scope-out, storage ctor-seam behavior-preservation, Fpc fully shallow, DappSession PXE-free, harness mechanics (`ServiceCollection.start()` is exactly the proven spike pattern). The single-shared-fake security story becomes net-positive once H1 + H2 are fixed (both adopted).
