---
plan: self-pay-setup-fix
tier: mid
driver: claude-code
status: drafting
eli5_mode: artifact
code_review: off
codex_effort: high
base: 898a3b99 (origin/dev at planning time)
budget: recon 2 agents (done); codex high; no /code-review
---

# self-pay-setup-fix — a bridge claim paid from held Fee Juice must build a valid transaction, and the gate that proves it

## Summary

A bridge claim that pays from the account's own public Fee Juice (the `dapp-self-pay` route PR #544 added) fails on alpha-testnet inside the dApp-facing `simulateTx` with `Setup function not on allow list`: the hub's private claim enqueues a public call (`Token._finalize_mint_to_private_unsafe`) and, by the time it runs, nothing in the transaction has ended the setup phase. A sibling attempt on the private-credit path failed with `unknown nullifier`. The network e2e is green because the only self-pay test sends one public transfer through `sendTx`; no test drives the hub claim shape, the `simulateTx` of a self-pay payload, or a deployed-vs-never-sent account. This plan (1) builds the gate first — an extension network e2e that drives the REAL hub claim (bridge-core's own claim call + `selfPaidFeeJuicePayment`, through the wallet-sdk) on the local sandbox, whose node enforces the same setup allow-list as testnet, from a never-sent account and a deployed one, through simulate and send — (2) uses it to pin the failing cell and diagnose which of four hypotheses holds, (3) fixes the wallet, and (4) makes the gate a required PR check for every package on the fee path. Owner's words: "Things were working and #544 while trying to fix something broke everything on the wallet side. That should never happen again."

**In.** The e2e harness pieces (generation deploy + L1 deposit on the harness's anvil/node via bridge-core's script helpers; a playground raw-claim section; the test matrix), the wallet fix the diagnosis names, unit/composition pins for it, the paths-filter check, docs, lessons.
**Out.** The tools app UI (`apps/tools`) beyond nothing; PR #546 (held until this lands); the bridge contracts; a testnet canary (recorded as follow-up if the owner wants it after the sandbox gate); bridge-core's own 13-flow smoke (stays as the contract-level check).

## Acceptance criteria

1. On the local sandbox, the extension builds and lands a hub `claim_private` whose fee is `selfPaidFeeJuicePayment(account)` from (a) an account that has never sent a transaction and (b) one that has, through both `simulateTx` (the bridge's visibility poll) and `sendTx`; the account's public Fee Juice falls by the fee.
2. The same matrix for the private-credit path (PrivateFPC) lands — **Phase 5, conditional on the PrivateFPC being deployable on the harness's sandbox without new infrastructure** (Ask A2).
3. The new test is in the network suite, so `network-e2e-status` (required on `dev` and `main`) reds on any regression, and the `extension-network` paths filter triggers it for every package on the fee path.
4. A unit or composition pin in the extension reproduces the diagnosed defect without a node, so the cheap layer catches the same class.
5. No new suppression, no weakened gate, no change to `apps/tools` behaviour, the frozen account artifact untouched.

## Architecture & Implementation

### The gate (Phases 1, 4)

`apps/extension/tests/e2e/network/bridge-claim-selfpay.test.ts` over the existing harness (`global-setup.ts` already owns anvil, the node, the playground, the tools server, and provides `aztecTestConfig` + `playgroundUrl`).

- **Generation on the sandbox** — `tests/e2e/fixtures/bridge-generation.ts` (new): deploy the L1 factory + router and the L2 hub on the harness's anvil + node, pre-create one token, mint ERC20 to the anvil signer. Built from `packages/bridge-core/scripts/deploy-sandbox.ts`'s `deployL1Fixtures` / `buildL2` / `freshToken` / `depositFresh` / `claimInputs` **after** those are lifted from the script into `packages/bridge-core/scripts/sandbox/generation.ts` (exported, script-only, not the package's public surface) so the smoke and the e2e share them; `deploy-sandbox.ts` keeps its CLI shape. The fixture memoises per harness run and exposes `{ manifest, hub, token, deposit(to: AztecAddress, amount, isPrivate) → HubClaimParams }`.
- **Accounts** — `dappConnectedExtensionWithTransactionCap` yields a never-sent account (recon: every cap fixture does). The deployed case sends one throwaway `pg-btn-sendTx-default` first and asserts `requiresInitialization` flipped via the node's init-nullifier witness (the `frozen-account-canary` pattern). `fundPublicFeeJuice` credits public FJ; `readPublicFeeJuice` reads it.
- **The claim through the wallet** — a new playground section `apps/playground/src/sections/bridge-claim.ts` (`pg-input-claim-params` JSON, `pg-btn-claim-simulate`, `pg-btn-claim-send`) that builds `hub.methods.claim_private(...)` exactly as the tools app does (`claimCall` from `@nulo/bridge-core`'s `hub-l2.ts`, `selfPaidFeeJuicePayment(from)` from `fee-juice.ts`, `from` set) and calls `.simulate(opts)` / `.send(opts)` on the wallet-sdk wallet. `@nulo/bridge-core` becomes a playground dependency. This is the real shape: same SDK path, same payload, same wallet.
- **The matrix** — `{ never-sent, deployed } × { simulate, send }` for public self-pay (Phase 1); `× { private credit }` in Phase 5. Each cell asserts either success (send: tx mined, FJ fell; simulate: no throw) or, until the fix lands, the captured node error text — the test is written to FAIL on the production error, never to expect it.
- **Filter** — `.github/workflows/pr-network-e2e.yml` `extension-network` already lists `apps/extension/**`, `apps/playground/**`, `packages/{aztec-runtime,bridge-core,wallet-bridge,…}/src/**`; Phase 4 pins `contracts/bridge/aztec/**` presence (the hub is what the claim calls) and the new fixture paths, via `scripts/ci-cd/behavior-gating.test.ts`.

### The diagnosis (Phase 2)

Run the Phase 1 matrix; every cell's outcome and node error goes to `lessons/phase-2.md`. Discriminate:

| Cell pattern | Hypothesis | Fix site |
|---|---|---|
| simulate fails, send lands, both account states | **H1** dApp `simulateTx` path: the stubbed account (`view-executor.ts:305-330`, `pxe/service.ts:493-523`) or its build does not end setup for `PREEXISTING_FEE_JUICE` | `view-executor.ts` / `pxe/service.ts` stub handling |
| both fail, both states | **H2** route ↔ strategy mismatch (`service.ts:965` dispatches on `kind` alone; `EXTERNAL` never ends setup) | `service.ts` `buildAndEstimateTxRequest` + planner: enforce `requestedPayment === "fj"` ⇒ kind `fj` |
| never-sent fails, deployed lands | **H3** init-wrap × self-pay × nested public enqueue | `packages/aztec-runtime/src/account/nulo-account.ts` `buildWithInitialization` |
| simulate fails only, payload differs on the wire | **H4** the wallet-sdk's simulate payload lacks `feePayer`/`from` parity with send | `packages/bridge-core/src/hub-l2.ts` / wallet-sdk usage |

Ambiguous cells → one codex consult (`/codex high`) with the matrix and the wire payloads before touching code.

### The fix (Phase 3)

The smallest change at the diagnosed site, plus:
- a **core invariant** regardless of hypothesis: `buildAndEstimateTxRequest` refuses a self-pay payload (`fee.requestedPayment === "fj"`) with a strategy that would build `EXTERNAL`, throwing a typed error naming both — mirrors `EmbeddedStrategy`'s own self-check, closes the door the popup is the only guard on today;
- unit pins in the extension (`service.test.ts` / `view-executor.test.ts` / `fee/strategies-structural.test.ts` as the site dictates) and, if H3, `nulo-account.test.ts` in aztec-runtime.

### Interfaces

- `packages/bridge-core/scripts/sandbox/generation.ts`: `deployGenerationOnSandbox(env: { nodeUrl; l1RpcUrl; l1PrivateKey }) → { manifest: ManifestV2; hub: AztecAddress; token: ManifestToken }`, `depositToAccount(env, gen, to, amount, isPrivate) → HubClaimParams` — script-tier types already exported by `script-*.ts`.
- Playground: `pg-input-claim-hub`, `pg-input-claim-params` (JSON of `HubClaimParams`), `pg-btn-claim-simulate`, `pg-btn-claim-send`, `pg-result-claim` (the result/error text the test reads).
- Extension: `SelfPayRouteMismatchError extends Error` in `services/execution/fee/` (message names route and kind).

### Data & control flow (critical path, after the fix)

tools/playground: `claimCall(hub, params).send({ from, fee: selfPaidFeeJuicePayment(from) })` → wallet-sdk `aztec_sendTx { exec: { calls: [claim_private], feePayer: from }, opts: { from } }` → extension `classifyFeePayer` = `self-pay` → popup locks the fee card to fj → `buildAndEstimateTxRequest` picks `FeeJuiceStrategy` (invariant holds) → `buildStandard(op, PREEXISTING_FEE_JUICE)` → `NuloAccount.buildTxExecutionRequest` (init-wrap if never sent) → account entrypoint `set_as_fee_payer(); end_setup()` → app calls → `Token._finalize_mint_to_private_unsafe` in the app phase → validator accepts. The `simulateTx` leg follows the same build with the stubbed account and must reach the same phase layout.

### File-level change map

| Path | Change |
|---|---|
| `packages/bridge-core/scripts/sandbox/generation.ts` (new) + `deploy-sandbox.ts` | lift the deploy/deposit/claim-input helpers; the smoke imports them |
| `apps/extension/tests/e2e/fixtures/bridge-generation.ts` (new) | harness fixture over those helpers |
| `apps/playground/src/sections/bridge-claim.ts` (new), `apps/playground/package.json` | the claim section; `@nulo/bridge-core` dependency |
| `apps/extension/tests/e2e/network/bridge-claim-selfpay.test.ts` (new) | the matrix |
| `apps/extension/src/wallet/services/execution/service.ts`, `fee/…` | the invariant + the diagnosed fix, with tests |
| `apps/extension/src/wallet/services/execution/view-executor.ts`, `packages/aztec-runtime/src/pxe/service.ts` | only if H1 |
| `packages/aztec-runtime/src/account/nulo-account.ts` | only if H3 |
| `scripts/ci-cd/behavior-gating.test.ts`, `.github/workflows/pr-network-e2e.yml` | filter pins |
| `apps/extension/tests/e2e/README.md`, `CI.md`, `implementations-plan/index.md` | docs |

### Trade-offs & alternatives not taken

- **Drive the tools app UI instead of the playground.** The harness spawns it, but the claim needs an EIP-1193 L1 wallet in the browser for the deposit and a journal record for the card; the playground route exercises the identical wallet-sdk call chain with a tenth of the fixture. The tools-UI drive is a follow-up.
- **Fix first, gate second (the competing outline, below).** Rejected: four live hypotheses; a guessed fix could pass a test written to the guess.
- **A testnet canary instead of the sandbox.** Slower, flaky, not a PR gate; the sandbox node enforces the same allow-list. Canary is a follow-up.
- **Relax the sandbox allow-list to "see more".** Never: it would hide exactly this class.

## Competing outline — "fix-first"

1. Implement the route ↔ strategy invariant and audit the `simulateTx` stub path by reading; add unit pins. 2. Extend `tx-sendTx-selfPay.test.ts` with a multi-call private payload from the playground's delegated pattern. 3. Ship; verify on testnet by hand. Cheaper by a phase; loses the deterministic repro, keeps the owner's testnet walk as the only proof, and its e2e would not exercise the hub or the never-sent/deployed split. Kept for the audits to weigh.

## Security & Adversarial Considerations

- **Threat model.** A dApp names the account as payer with no fee call; the wallet must never let that payload run with an open setup phase (a setup-phase call is non-revertible and fee-free until `end_setup`). The invariant in Phase 3 is a defence against any future caller that bypasses the popup's lock.
- **Fee payer integrity.** `classifyFeePayer` stays pinned (address/selector/static/hideMsgSender/args[0]); nothing here loosens it.
- **The stubbed simulate.** `stubAccountAddresses` keeps real signing keys out of the PXE during dApp simulations; any H1 fix must keep the stub, not remove it.
- **Harness secrets.** The anvil signer key is the sandbox's public dev key; nothing new is persisted. No production credentials anywhere in this plan.
- **Least privilege in CI.** No workflow permissions change; the filter edit is path globs only.
- **Supply chain.** No new npm dependencies; `@nulo/bridge-core` is a workspace package.
- **Frozen account.** Untouched; `artifact-freeze.test.ts` and the KAT stay green, and the frozen-account canary is not rerun by this plan (no `@aztec/*` bump).

## Assumptions

**Facts**
- The node validates setup calls in `simulateTx` and on submission against `getDefaultAllowedSetupFunctions()` + `txPublicSetupAllowListExtend` (`@aztec/aztec-node/dest/aztec-node/server.js:618,892`; `@aztec/p2p …/allowed_public_setup.js`: AuthRegistry `set_authorized`/`_set_authorized`, FeeJuice `_increase_public_balance`).
- The e2e sandbox passes no allow-list flag (`apps/extension/tests/e2e/global-setup.ts:555-616`), so it enforces the same list.
- `PREEXISTING_FEE_JUICE` → `set_as_fee_payer(); end_setup()` before `execute_calls`; `EXTERNAL` → neither; the multicall entrypoint never ends setup (`aztec-nr/aztec/src/authwit/account.nr:55-78`, `multi_call_entrypoint_contract/src/main.nr:19`, 5.1; the mapper found 5.0.1 and 5.2.0 artifacts agree).
- The public call in the failing trace is `Token._finalize_mint_to_private_unsafe`, enqueued by `Token.mint_to_private` from `TokenBridgeHub.claim_private` (`contracts/bridge/aztec/token_bridge_hub/src/main.nr:253-273`).
- Both production failures were in the dApp `simulateTx` (`[sw:wallet-sdk] Method simulateTx failed for session ext-4/ext-6`); the bridge polls `claimCall(hub, p).simulate(claim)` before sending (`packages/bridge-core/src/hub-l2.ts:236`).
- `tx-sendTx-selfPay.test.ts` is green and covers one public transfer via `sendTx` on a never-sent account; no test drives the hub claim or a dApp `simulateTx` of a self-pay payload (recon trails).
- The strategy dispatch keys on `feeSettings.paymentMethod.kind` only (`service.ts:965`); `requestedPayment` is read by `operation-fingerprint.ts:146` alone.
- `pr-network-e2e.yml`'s `extension-network` filter covers `apps/extension/**`, `apps/playground/**`, `packages/{aztec-runtime,bridge-core,wallet-bridge,wallet-core,wallet-crypto,extension-messaging,resolve-asset,design,wallet-sdk-schema-patch}` src + manifest.

**Inferences**
- I1. The stubbed `SimulatedSchnorrAccount` (5.2.0) ends setup for option 1 like the real account (its 5.1 source delegates to `AccountActions::entrypoint`). Unverified for the installed artifact; H1 tests it.
- I2. bridge-core's smoke helpers can target the harness's existing anvil + node once lifted out of `deploy-sandbox.ts` (the script boots its own network today).
- I3. The owner's testnet accounts were never-sent at the time (both symptoms match), which the sandbox's never-sent cell will mirror.
- I4. The playground can import `@nulo/bridge-core` without pulling node-only modules (the tools app already does).

**Asks**
- A1. **Approve the gate as a required PR check** (it joins the network suite → `network-e2e-status`, already required). Default: yes.
- A2. **Private-credit path (PrivateFPC) in the matrix** — Phase 5, only if `ensurePrivateFpc` from the smoke deploys on the harness sandbox without new infrastructure; otherwise recorded as follow-up. Default: attempt, time-boxed to one phase.
- A3. **Testnet canary** for the claim (nightly, opt-in) — follow-up, not this plan. Default: follow-up.

## Phases

`<lint>` = `bun run lint`; `<typecheck>` = `bun run typecheck`; `<unit>` = `bun run test` (root, all workspaces); `<ext-unit>` = `bun run --cwd apps/extension test`; `<network>` = `bun run --cwd apps/extension e2e:agent <file>` (owns anvil + node + playground per worktree; run sharded/solo per memory). Every gate is `<lint> ∧ <typecheck> ∧ <unit>` exit 0 plus the phase's own line.

### Phase 1 — The gate: generation fixture, playground claim section, the matrix test
- Lift `deployL1Fixtures`/`buildL2`/`freshToken`/`depositFresh`/`claimInputs` into `packages/bridge-core/scripts/sandbox/generation.ts`; `deploy-sandbox.ts` imports them (smoke unchanged: `bun run --cwd packages/bridge-core deploy:sandbox -- --smoke` still passes).
- `fixtures/bridge-generation.ts`; playground `bridge-claim` section (+ testids); `bridge-claim-selfpay.test.ts` with the public self-pay matrix, written to fail on the production error.
- **Gate:** `<network> tests/e2e/network/bridge-claim-selfpay.test.ts` runs to its assertions on every cell (no fixture error), and `<network> tests/e2e/network/tx-sendTx-selfPay.test.ts` stays green; `bun run --cwd packages/bridge-core deploy:sandbox -- --smoke` exit 0. Failing cells are EXPECTED here and recorded verbatim.

### Phase 2 — Diagnosis
- Run the matrix; capture per-cell outcome + node error + the wire payloads (`exec.feePayer`, `opts.from`, `calls[0]`) for simulate and send; map to H1–H4 in `lessons/phase-2.md`; codex consult if two hypotheses survive.
- **Gate:** `lessons/phase-2.md` names ONE hypothesis with the cell evidence; `<lint> ∧ <typecheck> ∧ <unit>` exit 0 (no code change expected).

### Phase 3 — The wallet fix + the invariant + unit pins
- The diagnosed fix; `SelfPayRouteMismatchError` invariant in `buildAndEstimateTxRequest`; unit pins.
- **Gate:** `<ext-unit>` exit 0 with the new pins; `<network> bridge-claim-selfpay.test.ts` GREEN on every public self-pay cell; `tx-sendTx-selfPay`, `tx-sendTx-feePayer`, `fee-methods`, `frozen-account-canary` green (the neighbours); `bun run --cwd packages/aztec-runtime test` exit 0 (freeze pins).

### Phase 4 — Make it the gate
- `behavior-gating.test.ts` pins that `extension-network` covers `contracts/bridge/aztec/**` (add the glob if absent) and the new fixture/playground paths; `bun run lint:actions`; README (e2e) + CI.md rows; `implementations-plan/index.md`.
- **Gate:** `bun run lint:actions` exit 0; `bun run test:ci-gating` (or the repo's name for the CI-gating suite) exit 0; a `gh run list` after push shows the network suite triggered by this branch's diff.

### Phase 5 — Private-credit cell (conditional, A2)
- If the harness sandbox can host the PrivateFPC via the smoke's `ensurePrivateFpc`, add `{ never-sent, deployed } × { simulate, send }` for `fpcCreditFee`; otherwise write the follow-up and stop.
- **Gate:** the added cells green, or `lessons/phase-5.md` records the blocker and the follow-up; `<lint> ∧ <typecheck> ∧ <unit>` exit 0.

## Post-implementation

`code_review: off` — `/code-review` is not run.

1. **Codex audit** (`/codex high`, fresh session): the net diff from `898a3b99`, this plan.md with its decision ledger, an explicit adversarial/security ask ("what could go wrong, what would an attacker target, what are we trusting that we shouldn't — in particular the fee payer, the setup phase and the stubbed simulate"), and both rules below verbatim.
2. **Iterative fix loop:** verify each factual claim against the repo before acting; apply accepted fixes; commit; log the round in `lessons/post-impl.md`; resume the same codex session with the fix diff. Stop when a round yields no new material findings. Still material after 3 rounds → surface to the owner.
3. **Delivery** (below): open the PR only now.

The no-over-engineering rule: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*

The comment-quality rule: *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

## Delivery

Single arc, single PR: branch `worktree-self-pay-setup-fix` → `dev`, `gh pr create` after the codex loop converges. Title: `fix(wallet): self-pay claims end setup on every path; bridge-claim e2e gate`. `code_review: off`. After it lands, PR #546 (tools-console) rebases and the owner's preview walk resumes.

## Audit verdicts

_(filled by Phase 2 of the protocol)_

## Decision ledger

_(filled after the audits)_

## Seeds

_(finalised after approval)_
