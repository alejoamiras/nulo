# ExecutionService PXE-injection spike

**Tier:** `/blueprint light` · **Status:** awaiting approval · **Codex:** conditional approve (conditions folded in below)

## Summary

Prove the missing "integration / composition" test layer with the smallest vertical slice: make **one** service's PXE dependency injectable and write **one** in-process composition test driving the real `ExecutionService.executeTransfer` → coordinator → journal graph against a dumb fake — no Aztec sandbox, no offscreen worker, no proving, no browser. If the shape holds, it's Phase 1 of the 8-service rollout; if it's awkward, we learned it in ~half a day.

This is the "(a) spike" from the testing-strategy investigation (4-way convergence: 3 subagents + codex). The seam is already intended — `createWalletRuntime` says tests should drive the real graph with fakes, and `ProfileService`/`IncomingTransferService` already do it — but the execution path stops at a hard-`new`'d `PxeServiceClient`.

## Goal / success criterion (from clarifying answers)

- **Disposition:** KEEP — behavior-preserving DI; reusable fake; this IS Phase 1 of the rollout.
- **Proof test:** the **cancel-mid-prove journal story**, driven through the **real `ExecutionService.executeTransfer` + `cancelJob`** public API (per codex: not the coordinator directly, not dApp-send).
- **Gate:** **fast layers only** — `lint` + `typecheck` + existing execution unit tests green + a new default-wiring test + the composition test green + a bundle-hygiene grep. No sandbox.

Done = `ExecutionService`'s PXE is injectable behind a default (production untouched + asserted), a dumb fake + harness exist and are proven absent from the production bundle, and the cancel-mid-prove composition test runs green in vitest with zero sandbox.

## Phases

### Phase 1 — Make ExecutionService's PXE injectable (behavior-preserving), at the CLIENT level — ✓ GATE MET
Replace the hard `this.pxeService = new PxeServiceClient(this.logger)` in `ExecutionService` with an optional injected **`pxeClientFactory?: (logger) => PxeServiceClient`** (the concrete client surface — NOT raw `IPXE`; see Assumptions: the execution path uses client-level methods beyond `IPXE`), defaulting to `() => new PxeServiceClient(logger)`. Thread the produced client to the coordinator/executors/builder unchanged. First step: trace every PXE call `executeTransfer` makes (`getPXE().simulateTx/proveTx` via `IPXE`, plus client-level `getContractInstance`/`getContractArtifact`/`registerContract`/`registerSender` on the facade/view-executor/tx-request-builder) so Phase 2's fake covers exactly that surface. Production (default factory, `runtime.ts` passes nothing) is behavior-identical.
- **Validation gate.** `bun run lint` (0) + `bun run --cwd packages/extension typecheck` (0) + `bun run --cwd packages/extension vitest run src/wallet/services/execution/` (existing green) + a NEW unit test asserting that `ExecutionService` constructed with no `pxeClientFactory` uses the real `PxeServiceClient` (the existing suite bypasses construction via private-field injection, so it does NOT cover this seam — this test does). Layers: lint · typecheck · unit.

### Phase 2 — Dumb fake client + composition harness (test-scoped, proven out of prod) — ✓ GATE MET
Add a `FakePxeServiceClient` implementing the `PxeServiceClient` surface that `executeTransfer` exercises (from Phase 1's trace): `getPXE()` returns a dumb `FakeIPXE` (canned, shaped `TxSimulationResult`/`TxProvingResult` — enough for transfer-cancel, NOT modelling `publicInputs`/`getOffchainEffects`, which only dApp-send needs); the client-level methods (`getContractInstance`/`getContractArtifact`/`registerContract`/`registerSender`) return canned values / no-op. Models NO Aztec semantics. Add a harness wiring the REAL `ExecutionService`/coordinator/journal/task-service/lane against this fake (via Phase 1's factory) + the existing `FakeNodeFactory` + `FakeBrowserApi` + a controllable `ProofGate`. **Non-prod boundary (stronger than grep, per codex):** the fakes live in a test-only path that production never imports, AND a build + bundle-grep gate proves a unique `FakeIPXE` marker string is absent from `dist/` (mirrors the existing probe-grep bundle-hygiene precedent in `_network-e2e.yml` / `runtime.ts`).
- **Validation gate.** `bun run --cwd packages/extension typecheck` (0; the fake satisfies the client surface) + a smoke (`vitest run` the harness file: build the graph, no throw) + `bun run --cwd packages/extension build` then `grep -L`/`grep -c` confirms the `FakeIPXE` marker is absent from `dist/`. Layers: typecheck · unit · build/bundle-hygiene.

### Phase 3 — The cancel-mid-prove composition test (real service API) — ✓ GATE MET
One test, driven through the **real public API**: `ExecutionService.executeTransfer(...)` in flight; hold the fake at the `proving` stage via the `ProofGate`; call `ExecutionService.cancelJob(...)`; assert (a) the journal FSM reaches `proving` then the post-prove cancel checkpoint drops the proof artifact and does NOT submit, (b) a structured cancel (`JobCancelledError`/4001) surfaces, (c) the fake node's `sendTx` was never called. Transfer leg only (dApp-send is out of scope — its `publicInputs`/`getOffchainEffects` reads need a richer fake). This exercises the real coordinator path, not a re-test of `execution-coordinator.test.ts`.
- **Validation gate.** `bun run --cwd packages/extension vitest run <new composition test>` green + `bun run --cwd packages/extension vitest run src/wallet/services/execution/` still green + `bun run lint` + `bun run --cwd packages/extension typecheck` (all 0). No sandbox. Layers: lint · typecheck · unit · composition.

## Security & Adversarial Considerations

- **Threat surface:** test infrastructure + a constructor seam. No new trust boundary, no auth/secret/network exposure, no supply-chain or crypto change.
- **The one real risk — production reaching the fake:** a mis-wired default could silently make production use the fake (a wallet that "succeeds" without proving/sending). Mitigations, hardened per codex: (1) the default factory IS the real `new PxeServiceClient`; production passes none; (2) a NEW unit test pins the default path (Phase 1); (3) the fakes live in a test-only path AND a **build + bundle-grep** proves the `FakeIPXE` marker is absent from `dist/` (Phase 2) — stronger than "grep no prod import," matching the repo's existing bundle-hygiene precedent; (4) the network e2e (rollout PR, not the spike) is the final behavior-drift catch.
- **No least-privilege / CI-token / supply-chain impact.**
- **Fake-fidelity (strategic risk, OUT of spike scope):** a fake that drifts from the real PXE is confidence theatre. The spike keeps the fake deliberately dumb + scoped to transfer-cancel; the rollout adds 3–5 narrow real-PXE contract canaries (codex) — explicitly deferred.

## Assumptions

**Facts (verified this session):**
- `ExecutionService` hard-constructs PXE: `this.pxeService = new PxeServiceClient(this.logger)` (`service.ts:135`); 7 sibling services do the same. (grep)
- **The execution path uses `PxeServiceClient` client-level methods BEYOND `IPXE`** — `view-executor.ts:54` types `pxeService: PxeServiceClient` and calls `getContractArtifact`/`getContractInstance`/`registerContract` (`:98,138,157,181`); `tx-request-builder.ts:88` takes the concrete client + calls `getPXE` (`:119,381`); the facade calls `getContractInstance`/`getContractArtifact`/`registerContract`/`registerSender`/`registerAccount` (`service.ts:466,473,488,493,575,600,614,617`). So the seam is the **client**, not raw `IPXE`. (verified — corrects an earlier overstatement)
- `IPXE` (`aztec-runtime/src/pxe/ipxe.ts`) is the prove/simulate sub-surface (`getPXE()` returns it); the dumb fake of it is sufficient ONLY for the transfer-cancel leg. (read)
- The existing execution suite **bypasses construction/init** via private-field injection (`service.characterization.test.ts:12` — "Tests bypass ServiceCollection.start() … inject only the collaborators each path touches"), so it does NOT cover the new seam — hence the Phase-1 default-wiring test. (verified)
- The in-process composition pattern already exists in-repo: `ProfileService.service.integration.test.ts` + `IncomingTransferService.service.scenarios.test.ts` (50 cases), no RPC/sandbox. (verified)
- Fakes already exist: `FakeNodeFactory` (`core/testing/fake-node-factory.ts`), `FakeBrowserApi` (`wallet-core/src/testing/fake-browser-api.ts`); `AztecNode` is already injectable. (verified)
- `ProofGate` is an injected, defaulted seam (`ExecutionService` ctor `proofGate = NOOP_PROOF_GATE`; e2e uses `ChromeStorageProofGate`) — holding at `proving` is controllable in-process. (verified)
- `ExecutionCoordinator.proveAndSend` cancel checkpoint is real + after prove (`:164`); `cancelJob` journals-first then aborts (`execution-lane.ts:136`). (verified, codex-confirmed)
- dApp-send reads `provedTx.publicInputs` + `getOffchainEffects()` (`dapp-send-executor.ts:379,576`) — so a dumb fake can't cover dApp-send; transfer-only scope is required. (verified)

**Inferences (unverified — confirm in-phase):**
- The exact `PxeServiceClient` method set `executeTransfer` touches is small (getPXE + a few contract/register calls); Phase 1's trace confirms it before the fake is written.
- A defaulted factory makes production behavior-identical; the Phase-1 default-wiring test + existing suite are a sufficient oracle for the spike (full e2e deferred to the rollout PR).

**Asks:** none — resolved by the Phase-0 clarifying answers.

**Post-implementation hardening:** none (test-infra + DI seam; no `/harden` surface).

## Codex audit (xhigh, session 019ee004) — conditional approve

Verdict: **conditional approve.** All 3 conditions ADOPTED (verified against code):
1. *"Scope the spike to transfer/cancel via the real service API."* → ADOPTED: Phase 3 drives `ExecutionService.executeTransfer` + `cancelJob`; dApp-send explicitly out of scope (needs `publicInputs`/`getOffchainEffects`).
2. *"Do not present IPXE as the full ExecutionService seam."* → ADOPTED: inject at the `PxeServiceClient` (client) level; fake covers `getPXE()→FakeIPXE` PLUS the client-level methods; Assumptions corrected.
3. *"Stronger non-prod boundary for FakeIPXE than grep."* → ADOPTED: test-only path + build + bundle-grep that the marker is absent from `dist/`.
Plus codex's finding that the existing suite bypasses the construction seam → ADOPTED: added the Phase-1 default-wiring test. Rejected: none. (Rollout-only suggestion — a dedicated `ExecutionPxePort` instead of the client — noted for the rollout, NOT the spike.)
Transcript: `audit-codex.md`.

## Post-implementation audit (codex xhigh, session 019ee18e)

Verdict: **production safety intact** — no runtime path for production to reach a fake PXE (prod builds `ExecutionService` only in `runtime.ts`; `init()` uses the default factory; `*.test.ts` are test-runner inputs only). Findings:
- **High (test confidence) — ADDRESSED.** The composition test originally faked the journal + had loose assertions, so it didn't exercise the real FSM and could pass even if cancel fired at a later checkpoint. Fixed: it now uses the REAL `OperationJournalService` (FakeBrowserApi-backed FSM + transition lock), asserts the op ends terminally `cancelled` and NEVER reaches `submitting`/`succeeded`, and spies `toTx` to prove the proof artifact was dropped at the post-PROVE checkpoint (never converted to a tx, never sent). (Bonus: using the real journal surfaced that `TransferType` is a numeric enum — the stub had masked an invalid string.)
- **Medium (scope) — ADDRESSED (doc).** The test seeds private `estimateReuse` + skips the fresh-build path. Re-documented narrowly in the test header + lessons: it proves the REUSED-prepared-tx cancel path, not the full execution path. Rollout: extract a narrower preparation seam.
- **Low (wiring) — covered.** The pxe-seam unit pins the default factory's type; the composition test now exercises the injected factory end-to-end (the real graph runs against the fake via the constructor seam), so `init()` using the seam is proven.

## Seeds (draft — finalized after approval)

See `eli5.html`. `/goal` recommended (completion fully transcript-observable: 3 phases ✓ + fast-layer gates).
