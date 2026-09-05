---
plan: self-pay-setup-fix
tier: mid
driver: claude-code
status: drafting (rev 2, after the dual audit)
eli5_mode: artifact
code_review: off
codex_effort: high
base: 898a3b99 (origin/dev at planning time)
budget: recon 2 agents (done); codex high; no /code-review
---

# self-pay-setup-fix — the wallet runs a dApp simulate as the account the dApp named, and a real bridge claim proves it

## Summary

A bridge claim that pays from the account's own public Fee Juice (the `dapp-self-pay` route PR #544 added) failed on alpha-testnet inside the dApp-facing `simulateTx` with `Setup function not on allow list`; a sibling attempt on the private-credit path failed with `unknown nullifier`. Both audits and the code agree on the most likely cause (**H5**): the wallet-bridge dispatcher builds every account-scoped operation other than `sendTx` (`aztec_simulateTx`, `aztec_profileTx`, `aztec_executeUtility`, `aztec_createAuthWit`) as the session's **first** wallet-ordered account and overwrites the dApp's `opts.from` with it (`packages/wallet-bridge/src/dispatcher.ts:1299-1301, 1368-1376`); PR #110 fixed this for `sendTx` only (`dispatcher.ts:834-838`, `implementations-plan/network-e2e-required/FOLLOWUP-opts-from-clobber.md`). With two accounts granted and the second selected, a simulate of a self-pay payload runs as A while the payload names B as payer: `classifyFeePayer` says `fpc`, the planner builds `EXTERNAL`, no call ends setup, and the PXE's kernelless split files every public enqueue under setup — the exact production error, on simulate only, while `sendTx` would have worked. The green e2e (`tx-sendTx-selfPay`) never sees it: single account, send only.

The plan: (0) pin and fix the dispatcher, with the cheapest deterministic repro (a two-account simulate); (1) build the gate the owner asked for — an extension network e2e that drives the REAL hub claim from the sandbox-deployed generation through the wallet-sdk, on a node that enforces the same setup allow-list as testnet, across `{never-sent, deployed} × {first, second account} × {simulate, send}`; (2) diagnose anything the matrix still reds, with an all-green branch that goes back to production evidence rather than declaring victory; (3) any remaining fix; (4) make the gate a required PR check with the CI prerequisites it actually needs; (5) the private-credit cells, with an explicit boundary. Owner's words: "Things were working and #544 while trying to fix something broke everything on the wallet side. That should never happen again."

**In.** The dispatcher fix + unit pins; the playground claim section; the sandbox generation fixture (attach mode of bridge-core's smoke script); the matrix test; a production-shaped `claimViaHub` case; CI (filter, a dedicated heavy job with the forge build it needs, behaviour-gating pins); docs; lessons.
**Out.** The tools app (`apps/tools`) beyond nothing; PR #546 (held until this lands); the bridge contracts; a testnet canary (follow-up, A3); bridge-core's 13-flow smoke stays as the contract-level check.

## Acceptance criteria

1. `aztec_simulateTx`, `aztec_profileTx`, `aztec_executeUtility` and `aztec_createAuthWit` act as the session-authorized account the dApp named in `opts.from` (refused as `not-authorized` when it is not in the session), exactly as `sendTx` does; a wallet-bridge unit pin proves it without a node.
2. On the local sandbox, the extension simulates and lands a hub `claim_private` whose fee is the account's own public Fee Juice from a never-sent account and a deployed one, as the first and as the second granted account; each landed cell shows a successful receipt, the recipient's private token balance up by the claim amount, and the payer's public Fee Juice down by the receipt's fee; each simulate cell reaches the node's validator (no `skipTxValidation`) and returns.
3. One production-shaped case runs bridge-core's own `claimViaHub` orchestration (registration → visibility poll → send, real fee options) from the extension.
4. The new tests are in the network suite in a dedicated heavy job, the `extension-network` filter covers every path the fee route and the fixture depend on, and both are pinned by `scripts/ci-cd/behavior-gating.test.ts`; a clean CI checkout can run the fixture (the EVM artifacts are built in the job).
5. The private-credit path: either its cells land (Phase 5) or the owner is told, in writing, that only the public self-pay failure is fixed by this PR.
6. No new suppression, no weakened gate, `apps/tools` behaviour unchanged, the frozen account artifact untouched.

## Architecture & Implementation

### Phase 0 — the dispatcher fix and its cheap repro

`packages/wallet-bridge/src/dispatcher.ts`: `buildOperation` for `ACCOUNT_KINDS` reads `rawOpts.from` the way `handleSendTx` does (`isNoFromRequest` sentinel and `null` → no request; otherwise `String(rawOpts.from)`) and passes it to `resolveNetworkAndAccount(ctx, dappSession, requestedFrom)`, which already routes through `resolveAuthorizedSessionAccount` (`account-resolution.ts:48-60`: an unauthorized `from` is refused, never downgraded). `buildAccountOperation` keeps setting `opts.from` to the resolved address (now the requested one). `executeUtility`'s `from` is also the private-read scope, so the same rule applies. Unit pins in `dispatcher.test.ts` mirroring the `sendTx` block (`:902-960`): simulate/profile/utility/createAuthWit with `from: B` act as B; `from: C` (not in session) is refused; no `from` keeps the first account.

Cheap e2e repro, `apps/extension/tests/e2e/network/sim-from-selfpay.test.ts`: `dappConnectedExtensionWithFirstTwoAccountsCap`; the playground's existing simulate-transfer button gains a `pg-input-from` override and a `pg-input-feePayer`; with `from = feePayer = accounts[1]` the simulate must return (before the fix it fails with the production error text). No hub, minutes.

### Phase 1 — the gate

- **Generation on the sandbox.** No helper lift. `packages/bridge-core/scripts/deploy-sandbox.ts` already attaches to an existing network when `SANDBOX_L1_RPC` + `SANDBOX_NODE_URL` are set (`scripts/sandbox/local-network.ts:373-383`) and writes `sandbox-deploy/sandbox.json` (hub, tokens). Two script changes only: `--out <dir>` so two parallel harness runs never share a journal, and an explicit `--no-smoke` (the current default, named). The fixture `apps/extension/tests/e2e/fixtures/bridge-generation.ts` runs the script attached (once per harness run, memoised in the lock record), reads the manifest, and funds/deposits with the package's public API: `runSend` (`packages/bridge-core/src/send-flow.ts`) + `sendGenerationOf`, addressed to the extension account with an explicit `isPrivate`. L1 sends from the shared anvil key are serialized inside the fixture (nonce race, `deploy-sandbox.ts:180`). The fixture returns `{ manifest, hub, token, deposit(to, amount, isPrivate) → HubClaimWire }`.
- **The wire shape.** `HubClaimParams` carries `bigint`/`Fr`; the fixture serialises a string-only `HubClaimWire` (hex/decimal strings) and the playground rehydrates it. Documented in the section.
- **The claim through the wallet.** `apps/playground/src/sections/bridge-claim.ts`: inputs `pg-input-claim-hub`, `pg-input-claim-token`, `pg-input-claim-params` (JSON `HubClaimWire`), `pg-input-claim-from`; buttons `pg-btn-claim-register` (`registerContract` for the hub and the derived Token — the `transaction-contracts` bundle, `apps/playground/src/lib/bundles.ts:81-89`, is the fixture's grant), `pg-btn-claim-simulate`, `pg-btn-claim-send`; result `pg-result-claim`. It builds `Contract.at(hub, tokenBridgeHubArtifact, wallet).methods.claim_private(...)` (`claimCall` is module-private in `hub-l2.ts:213`; the artifact comes from the `@nulo/bridge-core/artifacts` subpath, the payment method from `@nulo/bridge-core/fee-juice` — no root import, so `viem`/L1 modules stay out of the dApp bundle) with `{ from, fee: { paymentMethod: selfPaidFeeJuicePayment(from) } }`; the simulate button leaves `skipTxValidation` unset (the existing simulate section sets it, `sections/simulation.ts:76`, which would bypass the phases validator).
- **The matrix**, `bridge-claim-selfpay.test.ts`: `{ never-sent, deployed } × { first, second granted account } × { simulate, send }`, one fresh L1→L2 message per cell. Before each cell: `requiresInitialization` asserted (`true` for never-sent, `false` for deployed — the deployed account got there by one throwaway `pg-btn-sendTx-default`, mined and polled, not `NO_WAIT`). Oracles: **send** — receipt status success, the recipient's private token balance rose by the amount, the payer's public FJ fell by the receipt's fee; **simulate** — returns, and the SW log carries the session's `Method simulateTx` line. A failure is classified by origin: node/PXE (`The simulated transaction is unable…`, `Setup function not on allow list`, `unknown nullifier`) is a red cell to diagnose; anything else (capability, registration, visibility) is a fixture failure and fails the phase.
- **Production-shaped case**, same file: bridge-core's `claimViaHub` (registration → `awaitClaimVisible` → send) over the wallet-sdk wallet from the playground, with the real fee-options construction, for the second-account never-sent cell.

### Phase 2 — diagnosis, keyed on what the wallet used

Every red cell records the node error, the wire `feePayer`/`opts.from` the dApp sent, the account the wallet ran as (`op.accountAddress`), the route and `feePaymentMethod` the planner chose (a `debug`-level log at `processAztecJsPayload`: route, option, `feePayerMatchesFrom: boolean` — never the addresses, per the logging policy), the request origin (init-wrapped or not) and the resulting setup/app public-call lists. Explanations and their falsifiers:

| Observation | Candidate | Falsifier |
|---|---|---|
| second-account simulate red with `Setup function not on allow list`, first-account green | H5 (fixed in Phase 0; this cell must be green after it) | the cell stays red after Phase 0 |
| red only on simulate, both accounts | H1' stub/kernelless split (`contract_function_simulator.js:441-455`) — I1 says no | captured `minRevertibleSideEffectCounter` ≠ 0 with a public call still filed as setup |
| red only never-sent | init-wrapped simulate quirk in the kernelless conversion | same cell green under real proving (`e2e:agent` with the prover) |
| red on send too | route ↔ strategy on the send path (H2) | the popup's locked kind and the planner's option agree in the capture |
| all green | H5 was the whole story, or the production trigger is not in the matrix | the owner re-runs one claim on testnet against a `dev` extension build with the Phase 2 log line and reports route/option/`feePayerMatchesFrom`; Ask A4 |

Two survivors → one `/codex high` consult with the captures before code.

### Phase 3 — whatever the matrix still needs

The smallest change at the diagnosed site plus its pin. The send-path guard from rev 1 (`SelfPayRouteMismatchError`) is **not** an invariant for this failure (the simulate path never enters `buildAndEstimateTxRequest`); it is kept only as a two-line route-policy check with explicit allowed combinations (absent payer → any kind; self-pay → `fj`; fjwc → `fjwc`; fpc → `embedded`) if Phase 2 shows a send-path mismatch, otherwise dropped.

### Phase 4 — the gate in CI

- Filter (`pr-network-e2e.yml` `extension-network`): add `contracts/bridge/aztec/**`, `contracts/bridge/evm/**`, `packages/bridge-core/scripts/**`; `behavior-gating.test.ts` pins them.
- A dedicated heavy job `network-e2e-heavy-bridge` in `_network-e2e.yml` for the two new files (the SHA-1 sharder would drop a generation-deploying file into the proverless pool), with the `forge build` prerequisite lifted from `_bridge-contracts.yml:38-65` into a composite `.github/actions/forge-build-bridge` used by both; the exclude entry for the shard pool pinned in `behavior-gating.test.ts`. `network-e2e-status` aggregates it (skip-pass when the filter misses stays as is — the filter is the gate).
- Clean-checkout proof: one `workflow_dispatch` of the network workflow on this branch with the job green, linked in `lessons/phase-4.md`.

### Phase 5 — private-credit cells (boundary explicit)

Cells `{never-sent, deployed} × {simulate, send}` for `fpcCreditFee` need: the PrivateFPC on the sandbox (`ensurePrivateFpc`, `deploy-sandbox.ts:405-415`), a credit note **funded for the extension account** and visible to its PXE (the smoke's `fundedSendFor` mode does this for script accounts), and the private claim's registration leg. If the funding cannot be expressed with the package's public API in one phase, the phase records that only the public self-pay failure is fixed here and files the follow-up — the owner decides whether the PR waits (A2).

### Interfaces

- `dispatcher.ts` `buildOperation(kind, args, ctx, dappSession)` → reads `requestedFrom` for `ACCOUNT_KINDS`; error surface unchanged (`not-authorized` → the existing `Invalid opts.from`-class rejection).
- `HubClaimWire` (playground + fixture): `{ token, l2Token, amount: string, secretHex, secretHashHex, leafIndex: string, isPrivate, recipient, salt }` — whatever `HubClaimParams` needs, as strings.
- Playground testids as listed; `pg-result-claim` carries `ok | error:<message>`.
- Fixture: `deployGenerationForHarness(): Promise<HarnessGeneration>` and `HarnessGeneration.deposit(to, amount, isPrivate)`.

### Data & control flow (after Phase 0)

playground → wallet-sdk `aztec_simulateTx { exec: { calls: [claim_private], feePayer: B }, opts: { from: B } }` → dispatcher resolves B (session-authorized) → `op.accountAddress = B`, `opts.from = B` → planner: `classifyFeePayer(B, B, calls)` = `self-pay` → `PREEXISTING_FEE_JUICE` → `buildStandard` → `NuloAccount.buildTxExecutionRequest` (init-wrap if never sent) → stubbed account entrypoint `set_as_fee_payer(); end_setup()` → app calls → `Token._finalize_mint_to_private_unsafe` in the app phase → validator accepts. `sendTx` follows the same route through the popup's locked fee card.

### File-level change map

| Path | Change |
|---|---|
| `packages/wallet-bridge/src/dispatcher.ts`, `dispatcher.test.ts` | honour requested `from` on account-scoped operations; pins |
| `apps/playground/src/sections/transactions.ts` or `simulation.ts` | `pg-input-from` override on the simulate-transfer button |
| `apps/playground/src/sections/bridge-claim.ts` (new), `apps/playground/package.json` | the claim section; `@nulo/bridge-core` subpath deps |
| `packages/bridge-core/scripts/deploy-sandbox.ts` | `--out`, `--no-smoke` |
| `apps/extension/tests/e2e/fixtures/bridge-generation.ts` (new) | attach-mode deploy + deposits |
| `apps/extension/tests/e2e/network/sim-from-selfpay.test.ts`, `bridge-claim-selfpay.test.ts` (new) | the repro and the matrix |
| `apps/extension/src/wallet/services/execution/operation-planner.ts` | the debug log line |
| `.github/workflows/_network-e2e.yml`, `pr-network-e2e.yml`, `.github/actions/forge-build-bridge/action.yml` (new), `_bridge-contracts.yml`, `scripts/ci-cd/behavior-gating.test.ts` | heavy job, filter, composite, pins |
| `apps/extension/tests/e2e/README.md`, `CI.md`, `implementations-plan/index.md`, `network-e2e-required/FOLLOWUP-opts-from-clobber.md` | docs; the follow-up closed |

### Trade-offs & alternatives not taken

- **Fix-first (the competing outline).** Rev 1's fix-first guessed a send-path invariant that cannot fire on the failing path; both audits rejected it. Rev 2 keeps its instinct where it is right — Phase 0 fixes the code-verified defect before the heavy gate — but never lets a guessed fix be proven by a test written to the guess.
- **Lift bridge-core's smoke helpers.** Unnecessary (attach mode exists), would collide with `scripts/generation.ts`, and the helpers deposit to script accounts; dropped.
- **Drive the tools app UI.** Needs an EIP-1193 L1 wallet and a journal record; the playground section exercises the same wallet-sdk call chain; the tools drive is a follow-up (the harness can spawn it, opt-in via `TOOLS_DEV_PORT`).
- **Raw `page.evaluate` payload injection.** The wallet object is not on `window`; the playground section is the harness's convention.
- **Relax the sandbox allow-list.** Never.

## Security & Adversarial Considerations

- **Account identity is the invariant.** A dApp request must run as the account it names or be refused; the wallet must never substitute another session account (a simulate as A of a payload meant for B leaks A's private reads into the result and, as here, builds an invalid or wrongly-paid transaction). The fix goes through `resolveAuthorizedSessionAccount` — unauthorized `from` refused, never downgraded — for every account-scoped kind including `executeUtility` (its `from` is the private-read scope).
- **Setup phase.** Setup is non-revertible and metered; the risk is unintended non-revertible effects and a wrong payer, not "free" execution. Every public enqueue must sit after `end_setup`; the gate's validator cells prove it.
- **The stubbed simulate.** `stubAccountAddresses` bypasses the account's `is_valid_impl` and skips kernels (`pxe/service.ts:520-548`): a passing simulate proves nothing about authorization; signing-key isolation is established by the build creating account authwitnesses before substitution (`nulo-account.ts:133-134`) and must be preserved by any change here. The claim section never sets `skipTxValidation`.
- **Fee-payer classification** stays pinned (address, selector, static, `hideMsgSender`, `args[0]`); `feePayer ≠ from` still fails closed (no payer elected).
- **Fixture supply chain.** `deploy-sandbox.ts` fetches Permit2/Multicall3 bytecode from an RPC and installs it with `anvil_setCode` (`:108-111`); the harness must pin the expected bytecode hashes or use the local artifacts; run-owned output dir (`--out`); impersonation restored in `finally`; the anvil dev key never enters a browser input. CI's `contents: read` stays; the composite action pins foundry as `_bridge-contracts.yml` does.
- **Frozen account.** Untouched. The frozen-account canary runs in Phase 3 only if the fix touches `packages/aztec-runtime` account or PXE code.

## Assumptions

**Facts**
- Both production failures were in the dApp `simulateTx` (`[sw:wallet-sdk] Method simulateTx failed for session ext-4/ext-6`); the bridge simulates every claim before sending (`hub-l2.ts:236` `awaitClaimVisible`; `apps/tools/src/composables/useSend.ts:440-453` `probeHubClaim`).
- `dispatcher.ts:1299-1301` resolves ACCOUNT_KINDS without `requestedFrom`; `:1368-1376` overwrites `opts.from`; `handleSendTx` (`:834-838`) honours it; `account-resolution.ts:48-60` refuses an unauthorized `from`.
- `classifyFeePayer` returns `fpc` when `feePayer !== from` (`fee-payer.ts:63`); the planner maps `fpc` → `EXTERNAL` (`operation-planner.ts:251-256`); the account entrypoint ends setup only for `PREEXISTING_FEE_JUICE` (and via the leading claim for `FEE_JUICE_WITH_CLAIM`) — `authwit/account.nr:66-73`, identical in the frozen 5.0.1 and installed 5.2.0 artifacts; the multicall entrypoint never ends setup.
- The PXE's kernelless simulate files every public call as non-revertible when `minRevertibleSideEffectCounter === 0` (`@aztec/pxe/dest/contract_function_simulator/contract_function_simulator.js:441-455`); `pxe.js:808-817` runs `node.isValidTx` unless `skipTxValidation`; the node's default setup allow-list is AuthRegistry `set_authorized`/`_set_authorized` + FeeJuice `_increase_public_balance` (+ `TX_PUBLIC_SETUP_ALLOWLIST`), enforced in `aztec-node/server.js:619,893`.
- The e2e sandbox passes no allow-list flag or env (`global-setup.ts:555-616`).
- aztec.js 5.2.0 `simulate()` and `send()` share `request(options)` (`contract_function_interaction.js:55-65,113-114`): payloads are identical at the SDK.
- The 5.2.0 stub delegates to `AccountActions::entrypoint` (`simulated_schnorr_account_contract/src/main.nr:64-69`).
- Root `bun run test` and `bun run typecheck` cover the extension only (`package.json:17,29`); bridge-core, wallet-bridge and the playground have their own `test`/`typecheck` scripts.
- The EVM artifacts (`contracts/bridge/evm/out`) are untracked and built only by `_bridge-contracts.yml` (`foundry-toolchain@v1`, forge-std pin, remappings); `_network-e2e.yml` has no forge step; the tools server in the harness is opt-in (`TOOLS_DEV_PORT`).
- `tx-sendTx-selfPay.test.ts` is green: one public transfer, `sendTx`, single account, never-sent.

**Inferences**
- I1. The owner's tools session had two granted accounts with the second selected (two different accounts appear across the two attempts; the tools app has a multi-account grant and chooser). If false, H5 is still a real defect but not the production trigger — the all-green branch handles it (A4).
- I2. `deploy-sandbox.ts` attached to the harness's anvil + node deploys the generation the fixture needs (the attach path exists; it has run against its own network only).
- I3. The playground can consume `@nulo/bridge-core/artifacts` and `/fee-juice` without node-only modules (the tools app does).
- I4. Attempt 2's account was already deployed (the trace's root frame is the account entrypoint, no multicall frame); attempt 1's is unknown. Both states stay in the matrix; neither is claimed to mirror history.

**Asks**
- A2. **Private-credit cells.** Attempt (Phase 5), time-boxed; if the credit funding for the extension account cannot be built from the public API in the phase, this PR fixes the public self-pay failure only and the private-credit failure becomes its own arc. Default: attempt; the PR does not wait.
- A3. **Testnet canary** of the claim (nightly, opt-in) — follow-up. Default: follow-up.
- A4. **Did the tools session grant two or more accounts, with the failing account not the first?** (The choose-account modal, or the SW log `handleSendTx: account=`.) Needed only if the matrix is all green after Phase 0.
- A5. **CI wall-time** for a dedicated heavy job that deploys a generation per run (estimate 8–12 min on top of the pool). Default: accept.
- A6. **Behaviour change**: honouring a dApp's `from` on simulate/profile/utility/createAuthWit in multi-account sessions (today the first account is silently used). Default: yes — it is the documented follow-up of #110.

## Phases

`<lint>` = `bun run lint` (root); `<ext-typecheck>` = `bun run --cwd apps/extension typecheck`; `<ext-unit>` = `bun run --cwd apps/extension test`; `<wb>` = `bun run --cwd packages/wallet-bridge typecheck && bun run --cwd packages/wallet-bridge test`; `<bc>` = `bun run --cwd packages/bridge-core typecheck && bun run --cwd packages/bridge-core test`; `<pg>` = `bun run --cwd apps/playground typecheck`; `<network> <file>` = `bun run --cwd apps/extension e2e:agent <file>` (owns anvil + node + playground per worktree; run solo per memory). Every gate is `<lint>` exit 0 plus the phase's own lines.

### Phase 0 — Dispatcher honours the dApp's `from` on every account-scoped operation
- `dispatcher.ts` + `dispatcher.test.ts` pins; playground `pg-input-from` on the simulate-transfer button; `sim-from-selfpay.test.ts`.
- **Gate:** `<wb>` exit 0 with the new pins; `<ext-typecheck>`, `<ext-unit>`, `<pg>` exit 0; `<network> tests/e2e/network/sim-from-selfpay.test.ts` green, and the same test RED on a checkout of `898a3b99`'s dispatcher (the reversal quoted in `lessons/phase-0.md`); neighbours `<network>` `sim-methods`, `multi-account-from`, `tx-sendTx-selfPay`, `authwit-lifecycle` green.

### Phase 1 — The gate: attach-mode generation, playground claim section, the matrix
- `deploy-sandbox.ts --out/--no-smoke`; `fixtures/bridge-generation.ts`; `sections/bridge-claim.ts`; `bridge-claim-selfpay.test.ts` (matrix + the `claimViaHub` case).
- **Gate:** `<bc>` exit 0 and `bun run --cwd packages/bridge-core deploy:sandbox -- --smoke` exit 0 (the smoke unchanged); `<pg>` exit 0; `<network> bridge-claim-selfpay.test.ts` — every cell asserts its `requiresInitialization` precondition and ends in either the success oracles or a node/PXE-origin error; zero fixture-origin failures. Red node-origin cells are recorded verbatim in `lessons/phase-1.md` and are NOT a pass of Phase 2.

### Phase 2 — Diagnosis
- The planner debug log line; captures per red cell; the table above; the all-green branch (A4, the owner's testnet re-run with a `dev` build).
- **Gate:** `lessons/phase-2.md` names the surviving explanation with the captured evidence and its falsifier result, or records the all-green branch's owner evidence; `<lint>`, `<ext-typecheck>`, `<ext-unit>` exit 0.

### Phase 3 — Remaining fix (if any) + pins
- **Gate:** `<ext-unit>` (+ `<wb>` / `bun run --cwd packages/aztec-runtime test` as touched) exit 0; `<network> bridge-claim-selfpay.test.ts` GREEN on every public self-pay cell; neighbours green: `tx-sendTx-selfPay`, `tx-sendTx-feePayer`, `tx-sendTx-sponsoredFpc`, `tx-sendTx-noFrom`, `sim-methods`, `multi-account-from`, `frozen-account-canary` (the last only if `packages/aztec-runtime` account/PXE code changed; it needs the prover).

### Phase 4 — The gate in CI
- Filter globs + pins; `network-e2e-heavy-bridge` job; `forge-build-bridge` composite used by `_bridge-contracts.yml` and the new job; README/CI.md/index.
- **Gate:** `bun run lint:actions` exit 0; `bun run test:ci-gating` exit 0 with the new pins; a `workflow_dispatch` of the network workflow on this branch shows `network-e2e-heavy-bridge` green and `network-e2e-status` green, linked in `lessons/phase-4.md`.

### Phase 5 — Private-credit cells (A2)
- **Gate:** the cells green, or `lessons/phase-5.md` states the boundary ("this PR fixes the public self-pay failure only") and the follow-up; `<lint>`, `<ext-typecheck>`, `<ext-unit>` exit 0.

## Post-implementation

`code_review: off` — `/code-review` is not run.

1. **Codex audit** (`/codex high`, fresh session): the net diff from `898a3b99`, this plan.md with its decision ledger, an explicit adversarial/security ask ("what could go wrong, what would an attacker target, what are we trusting that we shouldn't — the account a request runs as, the fee payer, the setup phase, the stubbed simulate, the fixture's bytecode source"), and both rules below verbatim.
2. **Iterative fix loop:** verify each factual claim against the repo before acting; apply accepted fixes; commit; log the round in `lessons/post-impl.md`; resume the same codex session with the fix diff. Stop when a round yields no new material findings. Still material after 3 rounds → surface to the owner.
3. **Delivery** (below): open the PR only now.

The no-over-engineering rule: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*

The comment-quality rule: *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

## Delivery

Single arc, single PR: branch `worktree-self-pay-setup-fix` → `dev`, `gh pr create` after the codex loop converges. Title: `fix(wallet): dapp simulate runs as the account it names; bridge-claim self-pay e2e gate`. `code_review: off`. After it lands, PR #546 (tools-console) rebases and the owner's preview walk resumes.

## Audit verdicts

- **Codex (round 1, `01a0733a-145b-7232-be47-98956537f7a1`, GPT-6 Astra `high`)** — `audit-codex.md`. VERDICT: reject — non-causal diagnosis gate, insufficient claim assertions, missing clean-CI fixture prerequisites, incomplete CI dependency coverage, misstated validation commands.
- **Fable (round 1)** — `audit-fable.md`. VERDICT: conditional approve — add H5 (dispatcher `from` clobber) with a `from` axis and a dispatcher pin as Phase 0; all-green branch for Phase 2; attach mode instead of the helper lift; `transaction-contracts` bundle; `skipTxValidation` unset; the guard is send-path only; filter + heavy job pinned; Phase 1 gate on wallet-side artifacts and error origin; Asks A4–A6.

## Decision ledger

| # | Finding (source) | Decision |
|---|---|---|
| 1 | H5 dispatcher `from` clobber (fable HIGH, code-verified by the driver) | **Adopted** as Phase 0 with unit pins, a two-account simulate e2e, and the `from` axis in the matrix. |
| 2 | Diagnosis table non-discriminating; no all-green branch (codex HIGH 6, fable HIGH F2/F7) | **Adopted.** Rows keyed on captured error + the account the wallet used; all-green branch goes back to the owner's testnet evidence (A4). |
| 3 | Test oracle can green a reverted claim (codex HIGH 7, fable F10) | **Adopted.** Receipt success + recipient balance + fee debit; `requiresInitialization` pre-asserts; error-origin classification; fixture-origin failures fail the phase. |
| 4 | Fixture cannot bootstrap on a clean CI checkout — EVM artifacts untracked (codex HIGH 1) | **Adopted.** `forge-build-bridge` composite shared with `_bridge-contracts.yml`; a dispatched clean run is Phase 4's gate. |
| 5 | Filter misses `bridge-core/scripts/**` and the contracts; heavy job needed (codex HIGH 2, fable F8/F9) | **Adopted.** Three globs + a dedicated heavy job, both pinned. |
| 6 | Root `test`/`typecheck` are extension-only (codex HIGH 3) | **Adopted.** Per-package commands named in every gate. |
| 7 | Lift of the smoke helpers unnecessary; attach mode exists (fable F4, codex 10) | **Adopted.** No lift; `--out` + `--no-smoke` only; deposits via the public `runSend`. |
| 8 | `SelfPayRouteMismatchError` is the wrong layer for the failing path (fable F3, codex 12) | **Adopted.** Demoted to an optional route-policy check with explicit allowed combinations, only if Phase 2 shows a send-path mismatch. |
| 9 | `claimCall` private; `HubClaimParams` not JSON; fee nesting wrong; registration missing (codex 11, fable F5/F13) | **Adopted.** `Contract.at` + subpath artifacts; `HubClaimWire`; `fee.paymentMethod`; `transaction-contracts` bundle + register buttons. |
| 10 | Playground must not copy `skipTxValidation` (fable F6) | **Adopted.** |
| 11 | Security section misstated setup charging and the stub's role (codex 5) | **Adopted.** Rewritten. |
| 12 | Fixture supply chain: `anvil_setCode` bytecode from an RPC unpinned; shared key nonce race; output dir (codex 13, fable F17) | **Adopted.** Pinned hashes or local artifacts; serialized L1 sends; `--out`. |
| 13 | A2 needs a completion boundary (codex 14) | **Adopted.** Phase 5 states the boundary; the PR does not wait by default (Ask). |
| 14 | A1 redundant; A3 not an escape hatch (codex 15) | **Adopted.** A1 removed; A3 stays deferred; the all-green branch cannot end in "canary later". |
| 15 | Keep one production-shaped `claimViaHub` case (codex 9) | **Adopted.** |
| 16 | Frozen canary contradiction (codex) | **Adopted.** Runs only if aztec-runtime account/PXE code changes. |
| 17 | Real proving for init/PXE changes (codex) | **Adopted** into the Phase 2 falsifier and Phase 3's canary condition. |
| 18 | H1 demoted, H4 refuted (fable F11/F12) | **Adopted.** Recon updated. |
| 19 | Sequencing: gate-first vs fix-first | **Decided:** Phase 0 fixes the code-verified defect first (cheap, pinned), the gate follows; a guessed fix is never proven by a test written to the guess. |

**Disputed / open:** whether I1 (two accounts in the owner's session) holds — resolved by A4 only if the matrix is all green.

## Seeds

_(finalised after approval)_
