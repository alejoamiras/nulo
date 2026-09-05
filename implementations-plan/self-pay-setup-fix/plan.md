---
plan: self-pay-setup-fix
tier: mid
driver: claude-code
status: rev 6 — the audit-approved shape (rev 5) reshaped to the owner's directions; awaiting the owner's verdict
eli5_mode: artifact
code_review: off
codex_effort: high
base: 898a3b99 (origin/dev at planning time)
budget: recon 2 agents (done); codex high; no /code-review
---

# self-pay-setup-fix — the wallet simulates and profiles as the account the dApp named, and the playground proves it on the node's real rules

## Summary

A bridge claim that pays from the account's own public Fee Juice (the `dapp-self-pay` route PR #544 added) failed on alpha-testnet inside the dApp-facing `simulateTx` with `Setup function not on allow list`; a sibling attempt on the private-credit path failed with `unknown nullifier`. Cause (**H5**, code-verified, and attributed to production by the owner's answer A4 — two accounts granted, the failing one second): the wallet-bridge dispatcher builds `aztec_simulateTx` and `aztec_profileTx` as the session's **first** wallet-ordered account and overwrites the dApp's `opts.from` with it (`packages/wallet-bridge/src/dispatcher.ts:1299-1301, 1368-1376, 1389-1396`); PR #110 fixed this for `sendTx` only (`:834-838`, `implementations-plan/network-e2e-required/FOLLOWUP-opts-from-clobber.md`). A simulate of a self-pay payload from account B runs as A: `classifyFeePayer` says `fpc`, the planner builds `EXTERNAL`, no call ends setup, and the PXE's kernelless split files every public enqueue under setup — the production error, on simulate only. The bridge simulates every claim before sending, so the claim never went out. `executeUtility` names its account through `scopes` and `createAuthWit` signs as `args[0]` through its own handler — neither is in scope.

The gate, per the owner's direction (A5): **no bridge deployment**. The wallet defect is "a private-phase payload that enqueues a public call, paid by the account itself, simulated as the wrong account", and the playground drives that shape directly, on the harness's local node, which enforces the same setup allow-list as testnet. Phases: (0) the dispatcher fix, unit-pinned, with a two-account simulate e2e; (1) the playground gate — `{never-sent, deployed} × {first, second granted account} × {simulate, send} × {public FJ self-pay, PrivateFPC credit}` on two call shapes (the public transfer the existing e2e uses, and `mint_to_private` on a token whose minter is the account — the hub claim's inner call), a negative control that reproduces the production error text on the node, and the pre-fix reversal; (2) diagnosis only if a cell stays red; (3) any remaining fix; (4) the gate's CI placement and pins. The tools app, bridge-core and the contracts are untouched. Owner's words: "Things were working and #544 while trying to fix something broke everything on the wallet side. That should never happen again."

**In.** The dispatcher fix + unit pins; playground inputs (`from` override, validation toggle, a `mint_to_private` section); the matrix e2e; CI pins; docs; lessons.
**Out.** `apps/tools`, `packages/bridge-core`, the contracts; PR #546 (held until this lands); a testnet canary (follow-up, A3); the tools-UI drive (follow-up).

## Acceptance criteria

1. `aztec_simulateTx` and `aztec_profileTx` act as the session-authorized account the dApp named in `opts.from` (refused as `not-authorized` when it is not in the session), exactly as `sendTx` does; `executeUtility`'s `scopes` and `createAuthWit`'s `args[0]` signer are pinned unchanged; a wallet-bridge unit pin proves it without a node.
2. On the local sandbox, the extension simulates and lands, from a never-sent account and a deployed one, as the first and as the second granted account, paying from the account's own public Fee Juice AND from its PrivateFPC credit: (a) a public transfer and (b) a `mint_to_private` whose public finalisation is the same non-allow-listed enqueue the hub claim makes. Each landed cell shows a successful receipt, the expected balance movement, and the payer's fee debit; each simulate cell reaches the node's validator (validation ON), is bound to its own request's arguments, and leaves on-chain state unchanged.
3. The negative control — `from = B`, `feePayer = A`, no fee call, a public enqueue — is rejected by the node in simulation with validation ON with `Setup function not on allow list`; the harness asserts `TX_PUBLIC_SETUP_ALLOWLIST` is unset and records the node version and the effective list.
4. The new test files are in the network suite with `retry: "0"`, their placement pinned by `scripts/ci-cd/behavior-gating.test.ts`, and the `dev` branch's protection is shown (read-only) to require `network-e2e-status`; every cell is named in the run log.
5. No new suppression, no weakened gate, the frozen account artifact untouched.

## Architecture & Implementation

### Phase 0 — the dispatcher fix and its cheap repro

`packages/wallet-bridge/src/dispatcher.ts`: `buildOperation` reads `rawOpts.from` for `aztec_simulateTx` and `aztec_profileTx` only, the way `handleSendTx` does (`isNoFromRequest` sentinel and `null` → no request; otherwise `String(rawOpts.from)`), and passes it to `resolveNetworkAndAccount(ctx, dappSession, requestedFrom)`, which already routes through `resolveAuthorizedSessionAccount` (`account-resolution.ts:48-60`: an unauthorized `from` is refused, never downgraded — the session boundary; capability checks, scope enforcement (`scope-enforcement.ts:96`) and the signing confirmation stay as they are; a session granting A and B does not reach C). `buildAccountOperation` keeps setting `opts.from` to the resolved address. `executeUtility` keeps resolving as today (its account is `scopes`); `createAuthWit` keeps its handler. Unit pins in `dispatcher.test.ts` mirroring the `sendTx` block (`:902-960`): simulate and profile with `from: B` act as B; `from: C` refused (`not-authorized`); no `from` keeps the first account; `executeUtility` with `scopes` and `createAuthWit([B, intent])` unchanged.

Cheap e2e repro, `apps/extension/tests/e2e/network/sim-from-selfpay.test.ts`: `dappConnectedExtensionWithFirstTwoAccountsCap`; the playground's simulate-transfer section gains a `pg-input-from` override (it sets BOTH the transfer's owner argument and `opts.from`) and a `pg-toggle-skipValidation` this test sets OFF (the existing button hardcodes `skipTxValidation: true`, `sections/simulation.ts:76`); `pg-input-feePayer` populates `exec.feePayer`. With `from = feePayer = accounts[1]`, validation ON, the simulate returns and the wallet's log shows resolved = accounts[1]. Reversal on `898a3b99`'s dispatcher: `transfer_public_to_public` is `#[authorize_once("from")]`, so the transfer owned by accounts[1] executed as accounts[0] fails on authorization before the validator (the PXE simulates public calls before `node.isValidTx`); the reversal's evidence is therefore the wrong resolution itself — resolved = accounts[0] ≠ payer = accounts[1], route `fpc`, option `EXTERNAL`, the authorization error — after asserted preconditions. The production error text is reproduced on this node by Phase 1's negative control.

### Phase 1 — the playground gate

- **Accounts.** `dappConnectedExtensionWithFirstTwoAccountsCap` yields two never-sent accounts. The "deployed" state comes from one throwaway `pg-btn-sendTx-default` from that account, mined and polled (never `NO_WAIT`), and is asserted with `requiresInitialization` (`true` before, `false` after). `fundPublicFeeJuice` credits public FJ; `bridgeForMint` (`fixtures/aztec-private-fpc-bridge.ts:44`, the `fee-methods` fixture) credits PrivateFPC credit for an account. All L1 sends from the shared anvil key go through one serialized queue.
- **Two call shapes.** (a) The public transfer the existing self-pay e2e uses (`pg-btn-sendTx-feePayer` / the simulate-transfer button with the new inputs). (b) `mint_to_private` on a token deployed by the script wallet with the extension account as minter (`deployTestToken(wallet, minter)`, `fixtures/aztec.ts:147`) — a private function whose public finalisation is the same non-allow-listed enqueue `TokenBridgeHub.claim_private → Token.mint_to_private` makes in production (`contracts/bridge/aztec/token_bridge_hub/src/main.nr:253-273`). A new playground section `apps/playground/src/sections/mint-private.ts` (`pg-input-mint-tokenInstance` as instance JSON — the `tx-sendTx-delegated-authwit` pattern — `pg-input-mint-from`, `pg-input-mint-feePayer`, `pg-select-mint-fee` = `self-pay | private-fpc`, `pg-btn-mint-register`, `pg-btn-mint-simulate`, `pg-btn-mint-send`, `pg-result-mint`) builds `Token.at(instance).methods.mint_to_private(to, amount)` with `{ from, fee: { paymentMethod } }`, never sets `skipTxValidation`, calls `wallet.simulateTx` / `sendTx`, and exposes the simulation's execution tree (nested private frames' address + selector + `publicInputs.argsHash`, the public call requests) in `pg-result-mint`. The `transaction-contracts` bundle (`apps/playground/src/lib/bundles.ts:81-89`) is the grant, for `registerContract`.
- **The matrix**, `apps/extension/tests/e2e/network/selfpay-phase.test.ts`: `{ never-sent, deployed } × { first, second granted account } × { simulate, send } × { public FJ self-pay, PrivateFPC credit }` for shape (b), plus the second-account cells for shape (a). Oracles — **send**: receipt success, the recipient's private balance up by the amount (shape b) or the public transfer's balances moved (shape a), the payer's fee debit (public FJ down, or the FPC credit note consumed) matching the receipt; **simulate**: the `mint_to_private` frame present with `argsHash` equal to the hash of THIS cell's encoded arguments and its public enqueue beneath it, correlated to this request (request id echoed in the SW log), on-chain balances unchanged. Failure origin classified: node/PXE (`The simulated transaction is unable…`, `Setup function not on allow list`, `unknown nullifier`) is a red cell to diagnose; anything else is a fixture failure and fails the phase. Every cell is named in the log; a skipped cell fails the gate.
- **Negative control**, same file: shape (a) with `from = B` (the transfer's owner and `opts.from`) and `feePayer = A`, no fee call, simulated with validation ON. The wallet legitimately classifies it `fpc` → `EXTERNAL`; the transfer's public enqueue sits in setup; the node must reject it with `Setup function not on allow list`. This is the production failure mechanism on the harness node, post-fix. The harness asserts `TX_PUBLIC_SETUP_ALLOWLIST` is unset in the node's environment (`global-setup.ts:577` spawns with `...process.env`; `@aztec/p2p/dest/config.js:247`) and records the node version and the effective list.
- **Pre-fix reversal**, once: the second-account self-pay simulate cells of shape (b) run against `898a3b99`'s `dispatcher.ts` (the file checked out temporarily, the suite otherwise at HEAD): resolved = first account, `EXTERNAL`, and the minter check failing (`mint_to_private` asserts the caller is the minter) — the wrong-account causal chain, quoted in `lessons/phase-1.md`.

### Phase 2 — diagnosis (only if a cell stays red)

Captured per red cell, from the wallet side: the account resolved (`op.accountAddress`) vs the dApp's `from`/`feePayer`; the route and the option the planner chose AND the option actually encoded in the entrypoint call (`argsOfCalls` of the built request); the request origin (init-wrapped or not); the stub overrides and validation flags; the anchor block; for every public call, its side-effect counter next to the collected `minRevertibleSideEffectCounter`. Candidates, each with an intervention and its expected outcome:

| Candidate | Intervention | Expected if the candidate holds |
|---|---|---|
| H5 (fixed in Phase 0) | the second-account simulate cells after Phase 0 | green; before Phase 0 (reversal) the wrong-account chain above |
| H1' kernelless split files a post-`end_setup` call as setup | compare each public call's counter with the collected boundary (`contract_function_simulator.js:441-449`: boundary 0 ⇒ everything setup by design; otherwise counter ≥ boundary is revertible) | boundary > 0 and a call with counter ≥ boundary listed as non-revertible |
| init-wrapped simulate conversion (stubbed origin) | the same cell with a pre-deployed account | green when deployed, red when never-sent, with the capture showing the boundary at 0 |
| send-path route ↔ strategy (H2) | the encoded option in the send's built request vs the planner's | they differ |
| H6 an unexplained settled-nullifier read (attempt 1's `unknown nullifier`) | identify the rejected nullifier's value and the emitting frame from the simulator's settled-nullifier check (`contract_function_simulator.js:403-437`), then match it: a registration/message nullifier not yet settled at the anchor, the account's initialization nullifier, a wrong-account read (the FPC's `pay_fee()` deducts from `msg_sender`), a simulated-read construction fault | the matched candidate; nothing excluded before the value is identified |
| all green | none in the matrix reproduces production | A4 is answered (two accounts, the second failing): attribution stands on H5; the gate stands; nothing further to attribute |

The dApp simulate is always kernelless and stubbed; "under real proving" is a falsifier for the SEND path only. If Phase 3 changes initialization or PXE behaviour, the cells themselves rerun under real proving (the canary shard's prover). Two survivors → one `/codex high` consult with the captures before code.

### Phase 3 — remaining fix (if any)

The smallest change at the diagnosed site plus its pin. No send-path guard unless Phase 2 shows a send-path mismatch (then a route-policy check with explicit allowed combinations: absent payer → any kind; self-pay → `fj`; fjwc → `fjwc`; fpc → `embedded`).

### Phase 4 — the gate in CI

- Placement: `sim-from-selfpay.test.ts` in the shard pool; `selfpay-phase.test.ts` in the existing heavy `fee-methods` job's `test_files` (its PrivateFPC cells use the same `bridgeForMint` path that put `fee-methods` on its own runner, `pr-network-e2e.yml:174-188`) and in the pool's `exclude_files` (`:169`); `retry: "0"` as every PR caller sets (`:160-162`; the reusable default is two retries, `_network-e2e.yml:82`). `behavior-gating.test.ts` pins both placements, the exclusion, `retry: "0"` and the aggregate dependency. The `extension-network` filter already covers `apps/extension/**`, `apps/playground/**` and `packages/wallet-bridge/**` (`:55-69`) — no filter change.
- Proof: a `workflow_dispatch` of the network workflow on this branch's FINAL commit with the heavy job green and every cell named in its log, linked in `lessons/phase-4.md`; a read-only `gh api repos/{owner}/{repo}/branches/dev/protection` quoted, showing `network-e2e-status` among the required checks (the YAML cannot prove a status is required). Measured wall-time recorded (A5).

### Interfaces

- `dispatcher.ts` `buildOperation(kind, args, ctx, dappSession)` → reads `requestedFrom` for `aztec_simulateTx` and `aztec_profileTx` only; `aztec_executeUtility` unchanged; the refusal is the resolver's existing `not-authorized` error, surfaced as today.
- Playground: `pg-input-from`, `pg-toggle-skipValidation` on the simulate-transfer section; the `mint-private` section's testids as listed; `pg-result-mint` carries `ok:<txHash>` | `sim:<json execution tree>` | `error:<message>`.
- Fixture additions in `apps/extension/tests/e2e/fixtures/`: `deployMinterToken(wallet, minter)` (a thin wrapper over `deployTestToken` returning the instance JSON the playground registers), `fundPrivateFpcCredit(account, amount)` (over `bridgeForMint`), and the shared-signer queue.

### Data & control flow (after Phase 0)

playground → wallet-sdk `aztec_simulateTx { exec: { calls: [mint_to_private], feePayer: B }, opts: { from: B } }` → dispatcher resolves B (session-authorized) → `op.accountAddress = B`, `opts.from = B` → planner: `classifyFeePayer(B, B, calls)` = `self-pay` → `PREEXISTING_FEE_JUICE` → `buildStandard` → `NuloAccount.buildTxExecutionRequest` (init-wrap if never sent) → stubbed account entrypoint `set_as_fee_payer(); end_setup()` → app calls → the token's public finalisation in the app phase → validator accepts. `sendTx` follows the same route through the popup's locked fee card. The PrivateFPC variant replaces the payer with the FPC's `pay_fee()` in the fee payload (route `fpc` → `EXTERNAL` → the FPC ends setup).

### File-level change map

| Path | Change |
|---|---|
| `packages/wallet-bridge/src/dispatcher.ts`, `dispatcher.test.ts` | honour requested `from` on simulate/profile; pins |
| `apps/playground/src/sections/simulation.ts` (or `transactions.ts`) | `pg-input-from`, `pg-toggle-skipValidation`, `pg-input-feePayer` wiring |
| `apps/playground/src/sections/mint-private.ts` (new) | the `mint_to_private` section with the execution-tree result |
| `apps/extension/tests/e2e/fixtures/aztec.ts` (+ a small `selfpay.ts`) | `deployMinterToken`, `fundPrivateFpcCredit`, the signer queue |
| `apps/extension/tests/e2e/network/sim-from-selfpay.test.ts`, `selfpay-phase.test.ts` (new) | the repro and the matrix |
| `apps/extension/src/wallet/services/execution/operation-planner.ts` | the debug log line (route, option, `feePayerMatchesFrom`) |
| `.github/workflows/pr-network-e2e.yml`, `scripts/ci-cd/behavior-gating.test.ts` | placement + pins |
| `apps/extension/tests/e2e/README.md`, `CI.md`, `implementations-plan/index.md`, `network-e2e-required/FOLLOWUP-opts-from-clobber.md` | docs; the follow-up closed |

### Trade-offs & alternatives not taken

- **Deploying the bridge in the harness (revs 1–5).** Drives the literal hub claim but costs a generation deploy per run, a forge build in CI, a dedicated heavy job, bridge-core script changes and a new bridge-core export — for a wallet defect the playground reproduces on the same node with the same phase layout. Dropped on the owner's direction (A5); the tools-UI drive stays a follow-up.
- **Fix-first.** Phase 0 does fix first — because the defect is code-verified and unit-pinnable — but the gate still follows; a guessed fix is never proven by a test written to the guess.
- **Raw `page.evaluate` payload injection.** The wallet object is not on `window`; the playground section is the harness's convention.
- **Relax the sandbox allow-list.** Never.

## Security & Adversarial Considerations

- **Account identity is the invariant.** A `simulateTx`/`profileTx` request must run as the account it names or be refused; the wallet must never substitute another session account (a simulate as A of a payload meant for B returns A's private reads and, as here, builds an invalid or wrongly-paid transaction). The fix goes through `resolveAuthorizedSessionAccount` — unauthorized `from` refused, never downgraded — which bounds the choice to the session's granted accounts on the profile/chain; capability checks, scope enforcement and the signing confirmation are untouched.
- **Setup phase.** Setup is non-revertible and metered; the risk is unintended non-revertible effects and a wrong payer. Fee and authorisation calls may legitimately enqueue allow-listed public work in setup; the dApp's own enqueues must follow `end_setup`. A self-pay payload misclassified as `EXTERNAL` — no payment call of its own — leaves setup unfinished; that is the defect class the negative control proves against.
- **The stubbed simulate.** `stubAccountAddresses` bypasses the account's `is_valid_impl` and skips kernels (`pxe/service.ts:520-548`): a passing simulate proves nothing about authorization; signing-key isolation is established by the build creating account authwitnesses before substitution (`nulo-account.ts:133-134`) and must be preserved. The new section never sets `skipTxValidation`.
- **Fee-payer classification** stays pinned; `feePayer ≠ from` still means "an external payer" and never a silent self-pay.
- **Harness.** The anvil dev key never enters a browser input; every shared-signer L1 send is serialized; `bridgeForMint` runs against the harness's own anvil. CI permissions unchanged (`contents: read`).
- **Frozen account.** Untouched.

## Assumptions

**Facts**
- Both production failures were in the dApp `simulateTx` (`[sw:wallet-sdk] Method simulateTx failed for session ext-4/ext-6`); the bridge simulates every claim before sending (`hub-l2.ts:236`; `apps/tools/src/composables/useSend.ts:440-453`).
- The owner's tools session had two accounts granted and the failing account was the second (A4, 2026-09-05).
- `dispatcher.ts:1299-1301` resolves ACCOUNT_KINDS without `requestedFrom`; `:1368-1376, 1389-1396` overwrite `opts.from` for simulate and profile; `handleSendTx` (`:834-838`) honours it; `createAuthWit` has its own handler resolving `args[0]` (`:685, 896-925`); the wallet-sdk's `ExecuteUtilityOptions` carries `scopes`, not `from`; `account-resolution.ts:48-60` refuses an unauthorized `from`.
- `classifyFeePayer` returns `fpc` when `feePayer !== from` (`fee-payer.ts:63`); the planner maps `fpc` → `EXTERNAL` (`operation-planner.ts:251-256`); the account entrypoint ends setup only for `PREEXISTING_FEE_JUICE` (and via the leading claim for `FEE_JUICE_WITH_CLAIM`) — `authwit/account.nr:66-73`, identical in the frozen 5.0.1 and installed 5.2.0 artifacts; the multicall entrypoint never ends setup.
- The PXE's kernelless simulate files every public call as non-revertible when `minRevertibleSideEffectCounter === 0` (`contract_function_simulator.js:441-455`); `pxe.js:799-817` simulates public calls, then runs `node.isValidTx` unless `skipTxValidation`; the node's default setup allow-list is AuthRegistry `set_authorized`/`_set_authorized` + FeeJuice `_increase_public_balance` (+ `TX_PUBLIC_SETUP_ALLOWLIST`), enforced in `aztec-node/server.js:619,893`.
- aztec.js 5.2.0 `simulate()` and `send()` share `request(options)`; the 5.2.0 stub delegates to `AccountActions::entrypoint`.
- `Token.transfer_public_to_public` is `#[authorize_once("from")]`; `Token.mint_to_private` asserts the minter and enqueues a public finalisation; `deployTestToken(wallet, minter)` exists (`fixtures/aztec.ts:147`); `bridgeForMint` credits PrivateFPC credit for a claimer (`fixtures/aztec-private-fpc-bridge.ts:44`) and is what puts `fee-methods` on the heavy runner.
- Root `bun run test` / `typecheck` cover the extension only; wallet-bridge and the playground have their own scripts.
- `tx-sendTx-selfPay.test.ts` is green: one public transfer, `sendTx`, single account, never-sent.

**Inferences**
- I2. `mint_to_private` on a minter-owned token reaches the same phase layout as the hub's inner call (a private frame enqueueing a non-allow-listed public call after the account's `end_setup`); the cell's execution tree shows it.
- I3. The PrivateFPC credit variant on the second account failed in production for the same wrong-account reason (the FPC's `pay_fee()` deducts from `msg_sender`; running as A reads A's credit). The matrix's PrivateFPC cells test it; if they stay red after Phase 0, H6 applies.
- I4. Attempt 2's account was already deployed (the trace's root frame is the account entrypoint, no multicall frame). Both states stay in the matrix.

**Asks (answered 2026-09-05 unless marked)**
- A2. Private-credit path — **in the gate**, not a follow-up: "it used to work". The PrivateFPC cells are required for Phase 1/3 green.
- A3. Testnet canary — follow-up.
- A4. Two accounts, the failing one second — **yes**. H5 is attributed.
- A5. No bridge deployment; playground-only gate — **adopted** (this revision). Wall-time measured in Phase 4 instead of estimated.
- A6. Honouring the dApp's `from` on simulate/profile — **yes**, "the actual correct behaviour".
- **A7 (open):** confirm this reshaped gate is what you want: it proves the wallet's phase layout and account identity on the node's real rules with the hub claim's inner call, but it does not drive the hub itself; the tools-UI drive stays a follow-up.

## Phases

`<lint>` = `bun run lint`; `<ext-typecheck>` = `bun run --cwd apps/extension typecheck`; `<ext-unit>` = `bun run --cwd apps/extension test`; `<wb>` = `bun run --cwd packages/wallet-bridge typecheck && bun run --cwd packages/wallet-bridge test`; `<pg>` = `bun run --cwd apps/playground typecheck`; `<network> <file>` = `bun run --cwd apps/extension e2e:agent <file>` (owns anvil + node + playground per worktree; run solo). Every gate is `<lint>` exit 0 plus the phase's own lines.

### Phase 0 ✓ — Dispatcher honours the dApp's `from` on `simulateTx` and `profileTx`
- `dispatcher.ts` + pins; playground `pg-input-from` + `pg-toggle-skipValidation` + `pg-input-feePayer` wiring; `sim-from-selfpay.test.ts`.
- **Gate:** `<wb>` exit 0 with the new pins; `<ext-typecheck>`, `<ext-unit>`, `<pg>` exit 0; `<network> sim-from-selfpay.test.ts` green with validation ON and resolved = accounts[1] in the log; the reversal on `898a3b99`'s dispatcher quoted in `lessons/phase-0.md` (resolved = accounts[0] ≠ payer = accounts[1], route `fpc`, option `EXTERNAL`, the authorization error), preconditions asserted first; neighbours `<network>` `sim-methods`, `multi-account-from`, `tx-sendTx-selfPay`, `authwit-lifecycle` green.

### Phase 1 — The playground gate
- Fixtures (`deployMinterToken`, `fundPrivateFpcCredit`, the signer queue); `mint-private` section; `selfpay-phase.test.ts` (matrix, negative control, env/list assertions, pre-fix reversal).
- **Gate:** `<pg>` exit 0; `<ext-typecheck>`, `<ext-unit>` exit 0; `<network> selfpay-phase.test.ts` — the negative control rejected with the production error text, `TX_PUBLIC_SETUP_ALLOWLIST` asserted unset and the effective list recorded, every cell named in the log and ending in the success oracles or a node/PXE-origin error, zero fixture-origin failures; the pre-fix reversal quoted in `lessons/phase-1.md`. Red node-origin cells are recorded verbatim and are NOT a pass of Phase 2.

### Phase 2 — Diagnosis (skipped when Phase 1 is all green after Phase 0)
- **Gate:** `lessons/phase-2.md` names each surviving explanation with its intervention's observed outcome, or records "no red cells"; `<lint>`, `<ext-typecheck>`, `<ext-unit>` exit 0.

### Phase 3 — Remaining fix (if any) + pins
- **Gate:** `<ext-unit>` (+ `<wb>` / `bun run --cwd packages/aztec-runtime test` as touched) exit 0; `<network> selfpay-phase.test.ts` GREEN on every cell, both fee variants; neighbours green: `tx-sendTx-selfPay`, `tx-sendTx-feePayer`, `tx-sendTx-sponsoredFpc`, `tx-sendTx-noFrom`, `sim-methods`, `multi-account-from`, `authwit-lifecycle`, `fee-methods`; if initialization or PXE behaviour changed, the cells rerun under real proving.

### Phase 4 — The gate in CI
- Placement + `retry: "0"` + pins; README/CI.md/index; the follow-up doc closed.
- **Gate:** `bun run lint:actions` exit 0; `bun run test:ci-gating` exit 0 with the new pins; a `workflow_dispatch` on this branch's final commit with the heavy job green and every cell named, `network-e2e-status` green, and the `dev` branch protection quoted with `network-e2e-status` required — all linked in `lessons/phase-4.md`; measured wall-time recorded.

## Post-implementation

`code_review: off` — `/code-review` is not run.

1. **Codex audit** (`/codex high`, fresh session): the net diff from `898a3b99`, this plan.md with its decision ledger, an explicit adversarial/security ask ("what could go wrong, what would an attacker target, what are we trusting that we shouldn't — the account a request runs as, the fee payer, the setup phase, the stubbed simulate"), and both rules below verbatim.
2. **Iterative fix loop:** verify each factual claim against the repo before acting; apply accepted fixes; commit; log the round in `lessons/post-impl.md`; resume the same codex session with the fix diff. Stop when a round yields no new material findings. Still material after 3 rounds → surface to the owner.
3. **Delivery** (below): open the PR only now.

The no-over-engineering rule: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*

The comment-quality rule: *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

## Delivery

Single arc, single PR: branch `worktree-self-pay-setup-fix` → `dev`, `gh pr create` after the codex loop converges. Title: `fix(wallet): dapp simulate/profile run as the account they name; self-pay phase e2e gate`. `code_review: off`. After it lands, PR #546 (tools-console) rebases and the owner's preview walk resumes.

## Audit verdicts

- **Codex (round 1, `01a0733a-145b-7232-be47-98956537f7a1`)** — `audit-codex.md`. VERDICT: reject (rev 1).
- **Fable (round 1)** — `audit-fable.md`. VERDICT: conditional approve — found H5 in the code.
- **Codex final (`01a0734f-565f-7a42-a3c0-0271421fa6ee`)** over rev 2 — `audit-codex-final.md`. VERDICT: reject.
- **Codex final 2 (`01a07359-b66f-7792-a730-129d3d48cf0f`)** over rev 3 — `audit-codex-final-2.md`. VERDICT: reject.
- **Codex final 3 (`01a07364-bc96-73c0-a16c-98251485e91c`)** over rev 4 — `audit-codex-final-3.md`. VERDICT: **conditional approve**; the four conditions applied in rev 5.
- **Rev 6** reshapes the gate on the owner's directions (A2, A4, A5, A6). The audited wallet fix, the account-identity invariant, the validation-ON rule, the argument-bound simulate oracle, the negative control, `retry: "0"` and the branch-protection proof are carried over unchanged; the bridge-deploy fixture, the forge composite, the dedicated job and the bridge-core changes are removed. Open Ask A7 is the owner's confirmation of that reshape.

## Decision ledger

Rows 1–40 (revs 1–5) are recorded in this file's git history (`git log -p -- implementations-plan/self-pay-setup-fix/plan.md`, commits 9a9f3d3f → 75418170) and summarised: every finding of every round was adopted, none rejected. Rows for rev 6:

| # | Direction (owner, 2026-09-05) | Decision |
|---|---|---|
| 41 | A4: two accounts, the second failing | **Fact.** H5 attributed to production; I1 retired; the all-green branch of Phase 2 no longer needs owner evidence. |
| 42 | A5: no bridge deployment; keep the work in the extension + playground | **Adopted.** Playground-only gate; the hub claim's inner call (`mint_to_private`) as the shape; the negative control reproduces the production error text on the node. Revs 1–5's bridge fixture, forge composite, dedicated job and bridge-core changes removed. |
| 43 | A2: the private-gas variant used to work | **Adopted.** PrivateFPC credit cells (via `bridgeForMint`) are required in the gate, not a follow-up. |
| 44 | A6: honouring `from` on simulate/profile is the correct behaviour | **Confirmed.** |
| 45 | A3: canary as follow-up | **Confirmed.** |
| 46 | Implementation finding (Phase 1 design): the literal matrix `{never-sent} × {send} × {both fee variants}` is infeasible on two accounts — an account's FIRST send deploys it, and the PrivateFPC *credit* (`pay_fee`) needs a prior `PrivateFPC.mint` sent AS the account, which is itself that first send | **Adopted.** The private route splits into its two real dApp shapes: `fpc-fuel` (FeeJuice.claim + `mint_and_pay_fee` — the bridge's first-claim path, valid on a never-sent account) and `fpc-credit` (`pay_fee` from held credit — deployed accounts only). Never-sent send cells: one per account (self-pay on one, fpc-fuel on the other); deployed cells: the full `{first, second} × {simulate, send} × {self-pay, fpc-credit}`; never-sent simulate cells: both accounts × {self-pay, fpc-fuel}. |
| 47 | Implementation finding (Phase 0): the SW log trail is retained only with Developer Mode on | **Adopted.** The gate's account oracle is the kernel output — the fee payer and the entrypoint frame of the simulation summary the playground projects (`simulation-summary.ts`) — not a log line. |

**Open:** A7 — the owner's confirmation of the reshaped gate.

## ELI5

Artifact: https://claude.ai/code/artifact/6bb17a86-152f-4e9c-a576-75a4de0e3f49 — source `implementations-plan/self-pay-setup-fix/eli5.html` (republish the same file path to update the same URL).

## Seeds

_(draft in the ELI5; finalised after approval)_
