# Fable audit — round 1 (plan draft 9a9f3d3f)

Fable 5.1 `Plan` subagent, independent context, read-only. Verbatim response follows.

# Audit — self-pay-setup-fix plan (fable leg)

Everything below was verified against the worktree at `898a3b99` + `9a9f3d3f` (recon/plan commit), the installed `@aztec/*@5.2.0` under `node_modules/.bun`, the node under `~/.aztec/current`, and the v5.2.0 noir sources at `<aztec-packages v5.2.0 checkout>`.

## Lead: the strongest counterargument, and the hypothesis the plan misses

**The plan's gate, as specified, cannot reproduce the most likely cause of attempt 2 — and that cause is readable in the code today.**

`aztec_simulateTx` discards the dApp's `opts.from`. `packages/wallet-bridge/src/dispatcher.ts:1299-1301` (`buildOperation`) calls `resolveNetworkAndAccount(ctx, dappSession)` with **no** `requestedFrom`, so `account-resolution.ts:58` returns the first wallet-ordered session account; `dispatcher.ts:1368-1376` (`buildAccountOperation`) then overwrites `opts.from` with that address. `handleSendTx` was fixed to honor `from` in PR #110 (`dispatcher.ts:834-838`, `implementations-plan/network-e2e-required/FOLLOWUP-opts-from-clobber.md`); `simulateTx` / `profileTx` / `executeUtility` were not. The `Invalid opts.from` guard at `view-executor.ts:227` is vacuous because both fields were set from the same value.

Consequence for a self-pay payload from account B in a session where A is wallet-first: `operation-planner.ts:249` computes `classifyFeePayer(exec.feePayer = B, opts.from = A, calls)`; `fee-payer.ts:63` returns `"fpc"`; the planner picks `EXTERNAL`; the entrypoint (`aztec-nr/.../authwit/account.nr:66-73`) neither elects a payer nor ends setup; the kernelless split (`@aztec/pxe/dest/contract_function_simulator/contract_function_simulator.js:441-455`: `minRevertibleSideEffectCounter === 0 ⇒ every public call is non-revertible`) files `Token._finalize_mint_to_private_unsafe` under SETUP; `phases_validator.js` rejects it; `pxe.js:808-816` throws exactly `The simulated transaction is unable to be added to state and is invalid. Reason: Setup function not on allow list`. `sendTx` from the same dApp would honor `from` and route self-pay correctly — so the bridge's `awaitClaimVisible` (`hub-l2.ts:231-248`) and the tools app's `probeHubClaim` (`apps/tools/src/composables/useSend.ts:440-453`) fail on simulate forever while the send would have worked. That is the "simulate fails, send lands" cell the plan's table attributes to H1.

Call this **H5: wallet-side `from` clobber on the account-operation route.** Evidence for it: the owner used two accounts (`0x00f6…`, `0x0e35…`) in the same tools preview; the tools app has a multi-account grant + choose-account modal (`apps/tools/src/composables/createAztecWalletSession.ts:812-845`); the asymmetry is already documented as a class. It also explains attempt 1 under the other wallet ordering (simulate runs as A while the PrivateFPC `pay_fee` payload targets B's credit and B's *real, unstubbed* `verify_private_authwit` reads `signing_public_key` on an undeployed account → `Nullifier read request at index 0 is reading an unknown nullifier`). Only the sender is stubbed (`pxe/service.ts:520-529`), so a cross-account payload hits the real account artifact.

**Ranking of H1–H4 by my reading:**
- H1 (stub/kernelless divergence): near-dead. The 5.2.0 stub delegates to `AccountActions::entrypoint` (`simulated_schnorr_account_contract/src/main.nr:64-69`), and `getFinalMinRevertibleSideEffectCounter` + `splitOrderedSideEffects` honor `end_setup` from a nested entrypoint even under init-wrap. I1 is verifiable now, not a matrix question.
- H2 (route↔kind mismatch): cannot produce a *simulate* failure — `executeAztecSimulateTxStandard` (`view-executor.ts:305-330`) never enters `buildAndEstimateTxRequest`; the planner hands `PREEXISTING_FEE_JUICE` straight to `buildStandard`. It only exists on the send path, where the popup lock (`OperationCard.vue:83`) holds.
- H3 (init-wrap × self-pay × nested enqueue): refuted by the green `tx-sendTx-selfPay` (never-sent, `PREEXISTING`, one public enqueue after `end_setup`) — nesting depth does not move the phase counter. The trace's root frame being `SimulatedSchnorrAccount:entrypoint` with no `MultiCallEntrypoint` frame also suggests attempt 2's account was already deployed, contradicting I3.
- H4 (SDK payload parity): false at the SDK — `ContractFunctionInteraction.simulate` and `BaseContractInteraction.send` both call `this.request(options)` which merges the fee method's `feePayer`; `toSimulateOptions`/`toSendOptions` both spread `...options` so `from` survives. The parity break is H5, on the wallet side.

**Most likely: H5 for attempt 2 (with H5 or the private-credit path's own issue for attempt 1).** If the tools session was single-account, then none of H1–H5 survive my reading and the plan needs *instrumentation* (log `route`/`feePayer`/`opts.from`/`feePaymentMethod` at `processAztecJsPayload`) before a sandbox matrix, because a single-account sandbox will be all green and Phase 2's gate ("names ONE hypothesis") becomes unmeetable.

## A. Adversarial / security

- **Trusting `opts.from` as "the account the dApp meant"**: the wallet silently substitutes it on three methods. Fixing H5 must go through `resolveAuthorizedSessionAccount({ requestedFrom })` (reject `not-authorized`), never a raw honor — `executeUtility`'s `from` is also the scope for private reads. The #110 shape is the template. (HIGH, see F1.)
- **Fee-payer classification** is sound in the attacker direction: `feePayer ≠ from ⇒ "fpc" ⇒ EXTERNAL`, which fails closed (no payer elected). Nothing in the plan loosens `isClaimAndEndSetup`'s args[0] pin. OK.
- **The stubbed simulate** (`is_valid_impl → true`, `skipKernels: true` at `pxe/service.ts:544-548`) means a passing `simulateTx` proves nothing about authwits or the real ctor gas. `hub-l2.ts:225-230` claims a simulation "sees exactly what the send will see" — false under the stub. Not this plan's bug, but Phase 5's private-credit cells lean on it. (LOW.)
- **`skipTxValidation` passthrough** (`view-executor.ts:322`): the dApp can switch off node validation on its own simulate. Harmless, but the playground's existing simulate button sets `skipTxValidation: true` (`apps/playground/src/sections/simulation.ts:76`); the new claim section must NOT copy that, or the gate never reaches the phases validator. (MED, see F6.)
- **Harness anvil key**: public dev key 0 shared by `fixtures/aztec.ts:398` and `deploy-sandbox.ts:61`. Concurrent L1 sends from the same key race on nonce (the script says so at `:180`); the fixture must serialize deploy → deposits. (LOW.)
- **CI filter**: the hub artifact lives at `contracts/bridge/aztec/token_bridge_hub/target/…json`, imported by `packages/bridge-core/src/artifacts.ts:5` — outside `extension-network`. The plan's pin is right; it is missing `packages/bridge-core/scripts/**` if the fixture executes the deploy script. (MED, see F9.)
- **Supply chain**: no new registry deps, but pulling `@nulo/bridge-core`'s root export into the playground drags `viem`, `@aztec/ethereum`, `@aztec/l1-artifacts`, `@aztec/wallets`, `@alejoamiras/private-fee-juice` into the dApp bundle the extension is tested against. Use the existing subpath exports `@nulo/bridge-core/artifacts` + `@nulo/bridge-core/fee-juice` (both light; `package.json` exports map) and `Contract.at` directly. (LOW.)
- **Least privilege in CI**: no permission change. OK.

## B. Assumption attack

**Facts — misstated or incomplete**
- "The bridge polls `claimCall(hub, p).simulate(claim)`" — also `probeHubClaim` in `useSend.ts:440-453` simulates the real claim for every *registered* token. Simulate is on the critical path of every claim, not only first private ones.
- "`claimCall` from `hub-l2.ts`" — module-private (`hub-l2.ts:213`), not exported.
- "The harness spawns the tools server" — opt-in only via `TOOLS_DEV_PORT` (`global-setup.ts:96-100`).
- "Every cap fixture yields a never-sent account" — true, but `dappConnectedExtensionWithTransactionCap` grants the `transaction` bundle, which has **no `contracts.canRegister`** (`apps/playground/src/lib/bundles.ts:75-80`). The claim section must `registerContract` the hub + derived Token; use the `transaction-contracts` bundle (`:81-89`) as `tx-sendTx-delegated-authwit` does.
- H4's premise "the wallet-sdk builds simulate and send payloads on different code paths" — false (above).
- "Trace names the stub" — the trace's *root* is the stub entrypoint; if the trace is the full tree, attempt 2 was not init-wrapped.
- Two session ids (`ext-4`, `ext-6`) — two connects; account composition per session unknown.
- Line cites `service.ts:965`, `operation-fingerprint.ts:146`, `view-executor.ts:257`, `server.js:618/892` (actually 619/893): correct.

**Inferences**
- I1: now a verified fact (stub source + kernelless split). Demote H1.
- I2: already true without any lift — `scripts/sandbox/local-network.ts:373-383` attaches when `SANDBOX_L1_RPC` + `SANDBOX_NODE_URL` are set; `deploy-sandbox.ts:1039-1046` writes `sandbox-deploy/sandbox.json` (hub, tokens). The lift phase is unnecessary.
- I3: unsafe (trace root frame; 71 FJ can be held by a never-sent address, but also by one that claimed). Keep both states — the plan does — but stop treating "never-sent fails" as diagnostic of H3 alone.
- I4: true, and cheaper via subpath exports.

**Asks that must be surfaced, not assumed**
- A4 (new): Did the tools session grant ≥2 accounts, and was the selected account the non-first wallet account? (Owner can answer from the choose-account modal / `handleSendTx: account=` SW log.)
- A5 (new): CI wall-time budget for a per-file generation deploy + dedicated heavy job.
- A6 (new): honoring dApp `from` on simulate/profile/utility is a dApp-visible behaviour change for multi-account sessions — approve.

**Diagnosis table soundness**: "simulate fails, send lands" is produced by H5 as well as H1; "never-sent fails, deployed lands" can be produced by a stub/kernelless quirk on the init-wrapped simulate unrelated to fees; "all green" has no row at all. The table must key on the captured node error *and* the wire `from`/`feePayer` the wallet actually used, and must have an all-green branch.

## C. Implementation critique

- **Structure**: right shape (extension-driven, sandbox node enforcing the real allow-list, playground as the dApp), wrong first move. The cheapest deterministic repro of H5 needs no hub at all: `dappConnectedExtensionWithFirstTwoAccountsCap` + the existing `pg-btn-simulateTx-transfer` with `feePayer = from = accountAddresses[1]` (the playground needs a `from` override input — the exact follow-up `multi-account-from.test.ts:14-24` names). Same node error, minutes not hours. Plus a `dispatcher.test.ts` pin mirroring the #110 block at `:902-960` for `simulateTx({from: B})`. That is acceptance criterion 4 for free.
- **Lifting `deploy-sandbox.ts` helpers into `scripts/sandbox/generation.ts`**: over-engineering, and a name collision with the existing `scripts/generation.ts` (`deployGeneration`, `preCreateToken`, already network-agnostic). Run the script attached (`SANDBOX_L1_RPC/SANDBOX_NODE_URL`) from the fixture, read `sandbox.json`; deposit with the public `runSend` (`src/send-flow.ts:228`) + `sendGenerationOf`. Only two small script changes are needed: an `--out <dir>` (two parallel harness runs collide on `packages/bridge-core/sandbox-deploy/`) and a `--no-smoke` default is already the default.
- **Playground section vs raw `page.evaluate` vs tools UI**: playground section is right — the "frozen-account-canary pattern" is inputs + testids, not a raw payload injection (the wallet object is not on `window`). Rejecting the tools UI is right (EIP-1193 + journal). Give the section a `pg-input-claim-from` so the multi-account cell exists.
- **`SelfPayRouteMismatchError` in `buildAndEstimateTxRequest`**: wrong layer for the failure that happened — the simulate path never passes there. It cannot break a legitimate flow today (the fee card is locked), and it cannot fire either; keep it as a two-line guard + unit pin if you like, but drop "core invariant regardless of hypothesis" from the plan. The invariant that would have caught attempt 2 is "the account the op runs as is the account the dApp named" — that lives in the dispatcher.
- **Gate-first vs fix-first**: gate-first is right in spirit, but with H5 code-verified, the honest sequencing is: Phase 0 cheap repro (multi-account simulate cell + unit pin) → Phase 1 hub-claim gate (attach-mode script, transaction-contracts bundle, `{never-sent, deployed} × {simulate, send} × {first, second account}`) → fix → CI. The hub gate still earns its keep (owner's requirement is the REAL claim shape), it just should not be the *only* discriminator. What I'd build differently: no lift, no new `generation.ts`, subpath imports only, a `from` axis in the matrix, and the dispatcher fix + pin in the same PR.

## D. Validation gates

- Phase 1 "runs to its assertions on every cell" is gameable (a `try/catch` that asserts on captured text always "runs to its assertions"). Make it objective: each cell must show a wallet-side artifact (send: journal row via `waitForDappExecuteWorked`; simulate: the SW log line `Method simulateTx …` for the session) and must assert `requiresInitialization` (never-sent `true`, deployed `false`) *before* the claim; failure text must be classified node/PXE-origin (`The simulated transaction is unable…`, `Setup function not on allow list`, `unknown nullifier`) vs fixture-origin, and fixture-origin fails the gate.
- Phase 2 gate needs the all-green branch (see B) and the wire capture must include the `from` the wallet *used* (`op.accountAddress`), not only what the dApp sent.
- Phase 3 neighbours: if the fix lands in `dispatcher.ts`, add `sim-methods`, `multi-account-from`, `authwit-lifecycle`, `tx-sendTx-sponsoredFpc`, `tx-sendTx-noFrom`, plus `bun run --cwd packages/wallet-bridge test`. `fee-methods` runs on its own heavy runner; say so.
- Phase 4: the SHA-1 sharder will drop a generation-deploying file into the proverless pool next to popup-shape tests (`pr-network-e2e.yml:131-165`); the heavy-job `exclude_files` list is a manual pin ("Keep this list in sync"). Add a `network-e2e-heavy-bridge` job and the exclude entry, and pin both in `behavior-gating.test.ts`. Add `contracts/bridge/aztec/**` and `packages/bridge-core/scripts/**` to the filter. `network-e2e-status` skip-passes when the filter misses, so the filter *is* the gate.

## Ranked findings

**HIGH**
- **F1 — H5 missing; matrix blind to it.** `packages/wallet-bridge/src/dispatcher.ts:1299-1301, 1368-1376`; `account-resolution.ts:53-59`; `operation-planner.ts:249`; `fee-payer.ts:63`. Scenario: two-account session, dApp `from = B`, wallet simulates as A, payer B → `fpc`/`EXTERNAL` → all public calls in setup → the exact production error on simulate only; single-account sandbox reproduces nothing. Fix to plan: add H5 to the hypothesis table with fix site `dispatcher.ts buildOperation/buildAccountOperation` (honor session-authorized `from` like #110); add a `from ∈ {first, second}` axis using `dappConnectedExtensionWithFirstTwoAccountsCap` + a playground `from` input; add a `dispatcher.test.ts` pin; add Ask A4.
- **F2 — Phase 2 gate unmeetable on all-green.** `plan.md` Phase 2. Fix: define the all-green branch (H5 cell, instrumentation of `route/feePayer/from/feePaymentMethod` at `processAztecJsPayload`, owner re-run on testnet reading the log) before any code change.

**MED**
- **F3 — The "core invariant" does not cover the failing path.** `view-executor.ts:305-330` bypasses `service.ts:946-979`. Fix: reword Phase 3 — the guard is send-path only; the cross-path invariant is account identity in the dispatcher.
- **F4 — Lift is unnecessary; attach mode exists.** `scripts/sandbox/local-network.ts:373-383`, `deploy-sandbox.ts:1039-1046, :55`; existing `scripts/generation.ts` name clash. Fix: Phase 1 runs the script attached with `--out`, deposits via public `runSend`; delete the lift and the new `generation.ts`.
- **F5 — Wrong capability bundle.** `apps/playground/src/lib/bundles.ts:75-89`. Fix: name the `transaction-contracts` bundle (or a fixture that grants it) and the `registerContract` calls for hub + derived Token in the section spec.
- **F6 — Simulate must not skip validation.** `apps/playground/src/sections/simulation.ts:76` vs `view-executor.ts:322`. Fix: the section spec states `skipTxValidation` unset on the simulate button and the test asserts the request reached `node.isValidTx` (error class or success).
- **F7 — Diagnosis table ambiguous** (H1 row = H5 pattern; no all-green row). Fix: key rows on node error + used-`from`; add H5 and all-green rows.
- **F8 — CI placement.** `pr-network-e2e.yml:131-165, 168-215`. Fix: Phase 4 adds a dedicated heavy job + exclude entry, pinned in `behavior-gating.test.ts`; Ask A5 for the wall-time.
- **F9 — Filter pin incomplete.** Fix: add `packages/bridge-core/scripts/**` alongside `contracts/bridge/aztec/**`.
- **F10 — Phase 1 gate gameable.** Fix: objective artifacts + error-origin classification + `requiresInitialization` pre-asserts (see D).

**LOW**
- F11 — H4 premise false at the SDK (`contract_function_interaction.js request()`, `base_contract_interaction.js:18-22`); rewrite H4 as the wallet-side parity break (= H5).
- F12 — I1/H1 verifiable now (`simulated_schnorr_account_contract/src/main.nr:64-69`; `contract_function_simulator.js:441-455`); demote.
- F13 — `claimCall` not exported (`hub-l2.ts:213`); use `Contract.at(hub, tokenBridgeHubArtifact, wallet).methods.claim_private`.
- F14 — Playground dependency surface: import `@nulo/bridge-core/artifacts` + `/fee-juice` only.
- F15 — Phase 3 neighbour set incomplete for a dispatcher change (add `sim-methods`, `multi-account-from`, `authwit-lifecycle`, wallet-bridge unit).
- F16 — I3 contradicted by the trace's root frame; note it, keep both states.
- F17 — Shared anvil key 0 nonce race; serialize L1 sends in the fixture.

**NIT**
- N1 — "harness spawns the tools server" → opt-in (`global-setup.ts:96-100`).
- N2 — `server.js` lines are 619/893 in the installed build.
- N3 — Recon's prior-art row misses `FOLLOWUP-opts-from-clobber.md`, which names this class.
- N4 — Phase 5 rationale should not rely on `hub-l2.ts:225-230`'s "simulation sees what the send sees" (false under the stub).

### Critical Files for Implementation
- packages/wallet-bridge/src/dispatcher.ts
- apps/extension/src/wallet/services/execution/operation-planner.ts
- apps/extension/src/wallet/services/execution/view-executor.ts
- packages/bridge-core/scripts/deploy-sandbox.ts (with `scripts/sandbox/local-network.ts` attach mode)
- apps/extension/tests/e2e/network/multi-account-from.test.ts (the two-account fixture + the documented `from` gap)

**VERDICT:** `conditional approve (with conditions: add H5 (dispatcher from-clobber) with a multi-account `from` axis in the matrix and a dispatcher unit pin as Phase 0; define the all-green branch of Phase 2; replace the helper lift with attach-mode execution of deploy-sandbox.ts (+ `--out`); use the transaction-contracts bundle and leave skipTxValidation unset on the claim simulate; reword the SelfPayRouteMismatchError as send-path-only; add `packages/bridge-core/scripts/**` to the filter and a dedicated heavy job pinned in behavior-gating; make Phase 1's gate assert wallet-side artifacts and error origin; surface Asks A4–A6)`
