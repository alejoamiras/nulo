# Composition tests — what they are, when to use them, and their hard limits

**Normative.** This file governs the `*.composition.test.ts` layer. Contributors and AI assistants MUST follow it. Linked from [`CLAUDE.md`](../../../CLAUDE.md). It exists because the tempting failure mode — growing a fake until it re-implements the PXE — produces tests that are green while production breaks.

## What a composition test is

Drive the REAL wallet service graph (`ServiceCollection.start()` + the real service under test + its real cheap collaborators) in-process against DUMB fakes for the process boundaries only (the PXE-over-RPC client, `chrome.storage`, `AztecNode`). **No** Aztec sandbox, offscreen worker, BB proving, or browser. It sits between unit tests (one class, all deps stubbed) and Network e2e (real sandbox + real proving). Reference implementations:

- `services/dapp-session/service.composition.test.ts` — pure storage lifecycle (no PXE, no bb). The cleanest shape.
- `services/token/service.composition.test.ts` — shallow PXE + bb-free ABI parsing.
- `services/execution/service.composition.test.ts` — the original spike: cancel-mid-prove via the real journal FSM.

## When to reach for it — ALL must hold

1. The behavior is **orchestration across ≥2 real collaborators** (service → journal/lock/storage → events), not the logic of one class.
2. Every boundary you cross fakes with **canned, semantics-free values**.
3. Correctness needs **no proving, no simulation, no real contract/selector derivation, no real chain state**.

## When NOT to — escalate to Network e2e (any ONE triggers)

> **D1 — surface cap (the shared shallow-PXE fake).** The SHARED fake (`shallow-port.fake.ts`) may implement `getPXE` + at most the **4** `ShallowPxe` registry methods (`getContractInstance`, `getContractArtifact`, `getContracts`, `registerContract`). Need a 5th? STOP — wrong layer. **Carve-out:** the execution cancel spike (`execution/service.composition.test.ts`) uses a separate inline fake with `proveTx` — allowed ONLY because the test asserts `proveTx` was-or-wasn't-CALLED, never its output (D2), to prove the post-prove cancel checkpoint.

> **D2 — semantics tripwire.** If an assertion depends on `simulateTx`/`proveTx`/`profileTx`/`executeUtility` returning something *internally consistent* (real gas, public inputs, nullifiers, a proof) → e2e. A canned `proveTx` checked only for *was-it-called* is fine (the cancel spike); a canned `simulateTx` whose decoded result is asserted is theatre.

> **D3 — no second wallet.** If faking requires building a `TxExecutionRequest`, standing up an account contract, validating node chain-identity, or deriving addresses → STOP. (The spike's `buildStandard` was unfakeable for exactly this; it used the reuse fast-path to skip it.)

> **D4 — state cap.** Fake state = seeded contract metadata + a registered-address set ONLY. Modeling note/sync/fee/public-private-return/authwit/node-response state → STOP.

> **D5 — shape, not depth.** The faked client methods are shallow at the SW boundary (one RPC each) but DEEP behind it (`getContractInstance` falls back PXE→node→known-bundle; `registerContract` is writeful). The fake reproduces the client *contract* (return shape), never the worker cascade. Cascade-dependent behavior (e.g. instance source-selection) → e2e.

> **D6 — bb-free (the boundary most likely to surprise you).** If the path computes ANY poseidon / artifact hash / function selector / contract-instance address — i.e. it touches the **Barretenberg WASM** — STOP. **The bb.js WASM is not loaded in the vitest/jsdom env** (`std::bad_cast`), and the repo deliberately keeps bb out of unit tests (`services/execution/contract-resolver.test.ts:190`, `services/account/contracts/nulo-account.test.ts:7`, `services/note/note-schemas.test.ts:13`). Deriving an instance via `getContractInstanceFromInstantiationParams`, or a selector via `utils/fn.ts`, is bb → e2e. A service can have a shallow PXE *surface* and still be bb-bound *internally* (see the Fpc counter-example below). To use a contract instance in a composition test, **hardcode a fake** (`{ address, currentContractClassId }`), as `contract-resolver.test.ts:34` does — never derive one.

**The real boundary is the intersection: shallow PXE AND bb-free AND no simulate/prove.** That is narrower than "real services minus the sandbox" — but still covers storage/lifecycle services, ABI parsing, and journal/lock orchestration.

## Always

- **One shared shallow-PXE fake**, `services/pxe/shallow-port.fake.ts`, under `src/` (so `vue-tsc` + `biome` cover it — that under-`src/` location IS the compile-time drift guard, because the fake's `ShallowPxe` surface is `Pick<IPXE, …>`; an `IPXE` shape change breaks `typecheck`). No per-service shallow-PXE fakes — the cancel spike's proving fake (D1 carve-out) is the lone exception. Its marker is carried as live data on the returned object so the `dist/chrome` grep survives tree-shaking.
- **Real artifacts.** Seed with real compiled artifacts (`TokenContractArtifact`, `SponsoredFPCContractArtifact`), never hand-written ABI.
- **Assert real state.** ≥1 assertion on real-collaborator state (storage rows, journal stage, emitted events), never on the fake's own canned return.
- **Bundle hygiene.** Every fake carries a unique marker (`SHALLOW_PXE_FAKE_BUNDLE_MARKER`); the `_build-extension.yml` "Assert test-only markers absent" CI step greps `dist/chrome|firefox` and fails on any hit. A fake reaching production = a wallet that "succeeds" without a real PXE.
- **Inject the boundaries** via defaulted ctor params (`pxeClientFactory` + `browserApi?`), mirroring `OperationJournalService`. Production passes nothing → real client + real `chrome.storage`.

## Failure taxonomy — name it in review

- **Theatre** — the test asserts the fake's scripted state, not the real service's transitions/outputs. Tell: deleting the real service would not change the assertions.
- **Second wallet** — the fake grew until it re-implements Aztec semantics (tx-request building, proving, contract resolution). Tell: the fake file is longer than the service, or imports account-contract machinery.
- **Drift** — the dumb fake's shape diverges from the real client. Guard: the under-`src/` `Pick<IPXE,…>` conformance (compile-time) + the Network e2e backstop.
- **bb-bound** — the orchestration looks composition-able (shallow PXE surface) but internally derives via the Barretenberg WASM → it belongs in e2e. This is the subtlest one (see Fpc).

## Worked examples (from this repo)

| Service / path | Composition-testable? | Why |
|---|---|---|
| `DappSessionService` lifecycle | ✅ yes | Pure storage + profile scoping. No PXE, no bb. The cleanest. |
| `TokenService.parseTokenInterface` | ✅ yes | Shallow PXE (registry reads) + bb-FREE candidate extraction (filters `artifact.functions` by name). |
| `TokenService.addToken` / `fetchTokenMetadata` | ❌ no → e2e | Calls `simulate(...)` (D2) + selector derivation (D6). Same service, deep path. |
| `FpcService.getFpcs` / `addFpc` (discovery) | ❌ no → e2e | **The counter-example.** Shallow PXE surface, BUT `getOrComputeProtocolAddresses` derives protocol instances via `getContractInstanceFromInstantiationParams` → poseidon/bb (D6). Only the bb-free reads (`getFpcs()` chainless list, `getFpc` ownership guard) are composition-tested; discovery lives in Network e2e. |
| `ExecutionService.executeTransfer` cancel | ✅ via reuse fast-path | The shallow path (seeded prepared tx) is testable; the fresh-build (`buildStandard`) is the "second wallet" the spike avoided (D3). |

**The lesson Fpc teaches:** "shallow PXE surface" is necessary but NOT sufficient. Check the orchestration for bb derivation and simulation BEFORE assuming a service is a composition target.

## Reviewer checklist (paste into the PR)

- [ ] PXE fake implements ≤ 4 `ShallowPxe` methods (D1).
- [ ] No assertion depends on simulate/prove *semantics* (D2).
- [ ] No tx-request / account-contract / address derivation in the fake or the driven path (D3).
- [ ] No poseidon / selector / instance derivation on the driven path — instances are hardcoded fakes (D6).
- [ ] Fake state is seeded-metadata + registered-set only (D4).
- [ ] ≥ 1 assertion on real-collaborator state, not the fake's return.
- [ ] Fake lives under `src/` with its marker; CI marker-grep is green.

**When in doubt → Network e2e.** Composition tests are a scalpel; e2e remains the source of truth for everything crypto-, proving-, or network-shaped.
