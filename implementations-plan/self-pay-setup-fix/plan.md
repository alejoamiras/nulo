---
plan: self-pay-setup-fix
tier: mid
driver: claude-code
status: approved by audit (rev 5) — awaiting the owner
eli5_mode: artifact
code_review: off
codex_effort: high
base: 898a3b99 (origin/dev at planning time)
budget: recon 2 agents (done); codex high; no /code-review
---

# self-pay-setup-fix — the wallet simulates and profiles as the account the dApp named, and a real bridge claim proves it

## Summary

A bridge claim that pays from the account's own public Fee Juice (the `dapp-self-pay` route PR #544 added) failed on alpha-testnet inside the dApp-facing `simulateTx` with `Setup function not on allow list`; a sibling attempt on the private-credit path failed with `unknown nullifier`. Both audits and the code agree on the most likely cause (**H5**): the wallet-bridge dispatcher builds `aztec_simulateTx` and `aztec_profileTx` as the session's **first** wallet-ordered account and overwrites the dApp's `opts.from` with it (`packages/wallet-bridge/src/dispatcher.ts:1299-1301, 1368-1376, 1389-1396`); PR #110 fixed this for `sendTx` only (`dispatcher.ts:834-838`, `implementations-plan/network-e2e-required/FOLLOWUP-opts-from-clobber.md`). `aztec_executeUtility` names its account through `scopes` (the wallet-sdk's `ExecuteUtilityOptions` has no `from`) and `aztec_createAuthWit` already signs as `args[0]` through its own handler (`:685, 896-925`) — neither is in scope. With two accounts granted and the second selected, a simulate of a self-pay payload runs as A while the payload names B as payer: `classifyFeePayer` says `fpc`, the planner builds `EXTERNAL`, no call ends setup, and the PXE's kernelless split files every public enqueue under setup — the exact production error, on simulate only, while `sendTx` would have worked. The green e2e (`tx-sendTx-selfPay`) never sees it: single account, send only.

The plan: (0) pin and fix the dispatcher, with the cheapest deterministic repro (a two-account simulate); (1) build the gate the owner asked for — an extension network e2e that drives the REAL hub claim from the sandbox-deployed generation through the wallet-sdk, on a node that enforces the same setup allow-list as testnet, across `{never-sent, deployed} × {first, second account} × {simulate, send}`; (2) diagnose anything the matrix still reds, with an all-green branch that goes back to production evidence rather than declaring victory; (3) any remaining fix; (4) make the gate a required PR check with the CI prerequisites it actually needs; (5) the private-credit cells, with an explicit boundary. Owner's words: "Things were working and #544 while trying to fix something broke everything on the wallet side. That should never happen again."

**In.** The dispatcher fix + unit pins; the playground claim section; the sandbox generation fixture (attach mode of bridge-core's smoke script); the matrix test; a production-shaped `claimViaHub` case; CI (filter, a dedicated heavy job with the forge build it needs, behaviour-gating pins); docs; lessons.
**Out.** The tools app (`apps/tools`) beyond nothing; PR #546 (held until this lands); the bridge contracts; a testnet canary (follow-up, A3); bridge-core's 13-flow smoke stays as the contract-level check.

## Acceptance criteria

1. `aztec_simulateTx` and `aztec_profileTx` act as the session-authorized account the dApp named in `opts.from` (refused as `not-authorized` when it is not in the session), exactly as `sendTx` does; `executeUtility`'s `scopes` and `createAuthWit`'s `args[0]` signer are unchanged and pinned as such; a wallet-bridge unit pin proves it without a node.
2. On the local sandbox, the extension simulates and lands a hub `claim_private` whose fee is the account's own public Fee Juice from a never-sent account and a deployed one, as the first and as the second granted account; each landed cell shows a successful receipt, the recipient's private token balance up by the claim amount, and the payer's public Fee Juice down by the receipt's fee; each simulate cell reaches the node's validator (no `skipTxValidation`) and returns.
3. One production-shaped case runs bridge-core's own `claimViaHub` orchestration from the extension on a token the hub has NOT registered (the manifest's portal-only PXO), so registration and the visibility poll actually run: the result's `path` is `"register,claim"`, the registration hash is recorded, and the claim simulation is shown to have executed.
4. The new tests run in a dedicated caller-level job (`pr-network-e2e.yml`), the `extension-network` filter covers every path the fee route and the fixture depend on (including the new composite action), both pinned by `scripts/ci-cd/behavior-gating.test.ts`; a clean CI checkout runs the fixture (the EVM artifacts are built in the job); the harness rejects an unexpected `TX_PUBLIC_SETUP_ALLOWLIST`; a negative control (a deliberately forbidden setup enqueue) is rejected by the node in CI; and the target branch's protection is shown, read-only, to require `network-e2e-status`.
5. The private-credit path: either its cells land (Phase 5) or the owner is told, in writing, that only the public self-pay failure is fixed by this PR.
6. No new suppression, no weakened gate, `apps/tools` behaviour unchanged, the frozen account artifact untouched.

## Architecture & Implementation

### Phase 0 — the dispatcher fix and its cheap repro

`packages/wallet-bridge/src/dispatcher.ts`: `buildOperation` reads `rawOpts.from` for `aztec_simulateTx` and `aztec_profileTx` only, the way `handleSendTx` does (`isNoFromRequest` sentinel and `null` → no request; otherwise `String(rawOpts.from)`), and passes it to `resolveNetworkAndAccount(ctx, dappSession, requestedFrom)`, which already routes through `resolveAuthorizedSessionAccount` (`account-resolution.ts:48-60`: an unauthorized `from` is refused, never downgraded — the session boundary; capability checks, scope enforcement (`scope-enforcement.ts:96`) and the signing confirmation stay as they are). `buildAccountOperation` keeps setting `opts.from` to the resolved address (now the requested one). `executeUtility` keeps resolving as today (its account is `scopes`); `createAuthWit` keeps its handler. Unit pins in `dispatcher.test.ts` mirroring the `sendTx` block (`:902-960`): simulate and profile with `from: B` act as B; `from: C` (not in session) is refused; no `from` keeps the first account; `executeUtility` with `scopes` and `createAuthWit([B, intent])` unchanged.

Cheap e2e repro, `apps/extension/tests/e2e/network/sim-from-selfpay.test.ts`: `dappConnectedExtensionWithFirstTwoAccountsCap`; the playground's simulate-transfer section gains a `pg-input-from` override (it sets BOTH the transfer's owner argument and `opts.from`), a `pg-toggle-skipValidation` this test sets OFF (the existing button hardcodes `skipTxValidation: true`, `sections/simulation.ts:76`, which would bypass the phases validator), and `pg-input-feePayer` populating `exec.feePayer`. With `from = feePayer = accounts[1]`, validation on, the simulate must return with the wallet's log showing resolved = accounts[1]. The reversal on `898a3b99`'s dispatcher cannot reach the allow-list validator on a transfer — `transfer_public_to_public` is `#[authorize_once("from")]` and a transfer owned by accounts[1] executed as accounts[0] fails on authorization first (installed PXE simulates public calls before `node.isValidTx`) — so its evidence is the wrong resolution itself: the SW debug line resolved = accounts[0] ≠ payer = accounts[1], route `fpc`, option `EXTERNAL`, and the operation failing with the authorization error, after preconditions asserted (two accounts granted, accounts[1] funded with public FJ, tokens minted). The exact production error is reproduced pre-fix in Phase 1, on the hub claim (no owner argument), by running the matrix's second-account simulate cells against `898a3b99`'s dispatcher. No hub in Phase 0, minutes.

### Phase 1 — the gate

- **Generation on the sandbox.** No helper lift. `packages/bridge-core/scripts/deploy-sandbox.ts` already attaches to an existing network when `SANDBOX_L1_RPC` + `SANDBOX_NODE_URL` are set (`scripts/sandbox/local-network.ts:373-383`) and writes `sandbox-deploy/sandbox.json` (hub, tokens incl. the portal-only PXO). Script changes: `--out <dir>` (two parallel harness runs never share a journal); an explicit `--no-smoke`; the Permit2/Multicall3 bytecode it installs with `anvil_setCode` (`:108-111`) verified against pinned hashes or taken from local artifacts; owner impersonation restored in `finally`. The fixture `apps/extension/tests/e2e/fixtures/bridge-generation.ts` runs the script attached against the endpoints in the harness's own ownership record (never ambient `SANDBOX_*` variables — a stale pair would overwrite bytecode on another run's anvil), once per harness run, memoised with the generation identity in the lock record, and reads the manifest. Deposits use the exported helpers in order — the allowance and send steps from `packages/bridge-core/scripts/script-l1.ts` / `script-send.ts` and `runSend` (`packages/bridge-core/src/send-flow.ts:228`) + `sendGenerationOf`, addressed to the extension account with an explicit `isPrivate`, then the message's L2 anchor readiness — plus a fixture-local ERC-20 mint over the existing artifact (`deploy-sandbox.ts`'s `mint` is private to a script whose `main()` runs on import, so it is not imported). **Every** L1 send from the shared anvil key — the fixture's and `fundPublicFeeJuice`'s (`fixtures/aztec.ts:398,421`, same signer) — goes through one serialized queue. The fixture returns `{ manifest, hub, tokens, deposit(to, amount, isPrivate) → HubClaimWire }`.
- **The wire shape.** `HubClaimWire` is `HubClaimParams` itself (`hub-l2.ts:172-181`: the full `JournalTokenBlock`, `claimValue`, `from`, secret/leaf fields) with `bigint`/`Fr` fields serialised as strings; a `toWire`/`fromWire` pair lives beside the type. The hub and token contract instances travel as instance JSON, the `tx-sendTx-delegated-authwit` pattern (`pg-input-delegated*Instance`), so `registerContract` gets its instance argument; artifacts come bundled.
- **The claim through the wallet.** `apps/playground/src/sections/bridge-claim.ts`: inputs `pg-input-claim-hubInstance`, `pg-input-claim-tokenInstance` (instance JSON), `pg-input-claim-params` (JSON `HubClaimWire`), `pg-input-claim-from`; buttons `pg-btn-claim-register` (`registerContract` for both, under the `transaction-contracts` bundle, `apps/playground/src/lib/bundles.ts:81-89`), `pg-btn-claim-simulate`, `pg-btn-claim-send`, `pg-btn-claim-viaHub`; result `pg-result-claim` (`ok:<path>:<hashes>` | `error:<message>`). `@nulo/bridge-core` gains a browser-safe `./hub-l2` subpath export (`claimViaHub`, `HubClaimParams`, the wire helpers) beside the existing `./artifacts` and `./fee-juice`; the section imports only those three (no root import — `viem`/L1 modules stay out of the dApp bundle). The direct buttons build `claim_private` with `{ from, fee: { paymentMethod: selfPaidFeeJuicePayment(from) } }` and never set `skipTxValidation`.
- **The matrix**, `bridge-claim-selfpay.test.ts`: `{ never-sent, deployed } × { first, second granted account } × { simulate, send }` on a pre-registered token (USDC), one fresh L1→L2 message per cell. Before each cell: `requiresInitialization` asserted (`true` for never-sent, `false` for deployed — the deployed account got there by one throwaway `pg-btn-sendTx-default`, mined and polled, not `NO_WAIT`); the funding asserted. Oracles: **send** — receipt status success, the recipient's private token balance rose by the amount, the payer's public FJ fell by the receipt's fee; **simulate** — the section calls `wallet.simulateTx` and exposes the result's execution tree (the nested private calls' contract address + selector, traversing the initialization wrapper when present, and the public call requests); the test asserts the hub's `claim_private` frame is in it with `publicInputs.argsHash` equal to the hash of THIS cell's encoded claim arguments (token, recipient, amount, claim value, leaf index — `hub-l2.ts:217`; another valid deposit's frame would otherwise pass) and the token's mint enqueue beneath it (`claim_private` returns nothing, so a return value proves nothing), the result is correlated to THIS request (a request id echoed in the SW log), and on-chain balances are unchanged. A failure is classified by origin: node/PXE (`The simulated transaction is unable…`, `Setup function not on allow list`, `unknown nullifier`) is a red cell to diagnose; anything else (capability, registration, visibility) is a fixture failure and fails the phase. Every cell's execution is evidenced by name in the run log (a skipped cell fails the gate).
- **Production-shaped case**, same file: `claimViaHub` from the playground on the portal-only PXO token (unregistered on the hub — asserted absent first), second granted account, never-sent: the result's `path === "register,claim"`, the registration hash recorded, `requiresInitialization` asserted `true` before the registration and `false` before the claim (registration deploys the account — this case is not a never-sent claim cell and is not counted as one), the claim simulation shown to have run (the same `argsHash` oracle), and the claim's own settlement proven with the matrix's send oracles: `claimTxHash` polled to a successful receipt (`claimViaHub` returns the hash only, `hub-l2.ts:203`; the extension reads a receipt once at submission, `dapp-send-executor.ts:591`), the recipient's private PXO balance up by the amount, and the claim's fee debit measured separately from the registration's.
- **Negative control**, same file: a payload that deliberately enqueues a non-allow-listed public call before `end_setup` (a `claim_private` sent with `feePayer` = another session account and no fee call, which the wallet legitimately builds as `EXTERNAL`), run through **simulation with validation enabled** — the production path — must be rejected by the node with `Setup function not on allow list`. This proves the harness node enforces the list; the harness also asserts `TX_PUBLIC_SETUP_ALLOWLIST` is unset in the node's environment and records the node version and the effective list.
- **Pre-fix reproduction**, once: the two second-account simulate cells run against `898a3b99`'s `dispatcher.ts` (the file checked out temporarily, the suite otherwise at HEAD) and must fail with the production error text, with the SW log showing resolved = first account — the causal reversal for H5, quoted in `lessons/phase-1.md`.

### Phase 2 — diagnosis, keyed on what the wallet used

Every red cell records the node error, the wire `feePayer`/`opts.from` the dApp sent, the account the wallet ran as (`op.accountAddress`), the route and `feePaymentMethod` the planner chose (a `debug`-level log at `processAztecJsPayload`: route, option, `feePayerMatchesFrom: boolean` — never the addresses, per the logging policy), the request origin (init-wrapped or not) and the resulting setup/app public-call lists. Explanations and their falsifiers:

Captured per red cell, from the wallet side: the account resolved (`op.accountAddress`) vs the dApp's `from`/`feePayer`; the route and the option the planner chose AND the option actually encoded in the entrypoint call (`argsOfCalls` of the built request); the request origin (init-wrapped or not); the stub overrides and validation flags in force; the anchor block; for every public call, its side-effect counter next to the collected `minRevertibleSideEffectCounter`. Candidates, each with a controlled intervention and its expected outcome:

| Candidate | Intervention | Expected if the candidate holds |
|---|---|---|
| H5 (fixed in Phase 0) | the second-account simulate cell after Phase 0 | green; before Phase 0 (reversal) red with resolved ≠ payer, `EXTERNAL`, the validator error. Remaining reds after the fix do not clear H5 as one of several defects |
| H1' kernelless split files a post-`end_setup` call as setup | compare each public call's counter with the collected boundary (`contract_function_simulator.js:441-449`: boundary 0 ⇒ everything setup by design; otherwise counter ≥ boundary is revertible) | boundary > 0 and a call with counter ≥ boundary listed as non-revertible |
| init-wrapped simulate conversion (stubbed origin) | the same cell with a pre-deployed account | green when deployed, red when never-sent, with the capture showing the boundary at 0 |
| send-path route ↔ strategy (H2) | the encoded option in the send's built request vs the planner's | they differ |
| H6 an unexplained settled-nullifier read (attempt 1's `unknown nullifier`) | identify the rejected nullifier's value and the emitting frame from the simulator's settled-nullifier check (`contract_function_simulator.js:403-437`), then match it against the candidates: a registration/message nullifier not yet settled at the anchor, the account's initialization nullifier, a wrong-account read, a simulated-read construction fault | the matched candidate; none is excluded before the value is identified |
| all green | none in the matrix reproduces production | A4's historical evidence (session accounts and order; the registration/claim hashes) decides; if unavailable, production attribution is recorded as unresolved, the gate still stands, and the owner decides whether to hold the PR |

The dApp simulate is always kernelless and stubbed; "under real proving" is a falsifier for the SEND path only. If Phase 3 changes initialization or PXE behaviour, the claim cells themselves rerun under real proving (the canary shard's prover), not the unrelated frozen-account canary. Two survivors → one `/codex high` consult with the captures before code.

### Phase 3 — whatever the matrix still needs

The smallest change at the diagnosed site plus its pin. The send-path guard from rev 1 (`SelfPayRouteMismatchError`) is **not** an invariant for this failure (the simulate path never enters `buildAndEstimateTxRequest`); it is kept only as a two-line route-policy check with explicit allowed combinations (absent payer → any kind; self-pay → `fj`; fjwc → `fjwc`; fpc → `embedded`) if Phase 2 shows a send-path mismatch, otherwise dropped.

### Phase 4 — the gate in CI

- Filter (`pr-network-e2e.yml` `extension-network`): add `contracts/bridge/aztec/**`, `contracts/bridge/evm/**`, `packages/bridge-core/scripts/**`, `.github/actions/forge-build-bridge/**`; `behavior-gating.test.ts` pins them.
- A dedicated caller-level job `network-e2e-heavy-bridge` in **`pr-network-e2e.yml`** (beside `network-e2e-heavy` / `-heavy-concurrent`, `:174-215`), calling `_network-e2e.yml` with the two new files named explicitly, proving mode stated, `retry: "0"` like every other PR caller (the reusable default is two retries, `_network-e2e.yml:82`; a retry would mask an intermittent wallet regression), and added to the `network-e2e-status` `needs` + result loop (`:246-273`); the shard pool's `exclude_files` gains both files. The reusable workflow gets ONE narrowly gated step (`if: inputs.needs_bridge_artifacts`) that runs the new composite `.github/actions/forge-build-bridge` (lifted from `_bridge-contracts.yml:38-65`, which then uses it too), so no other caller deploys a generation. `behavior-gating.test.ts` pins the job, its files, the exclusions, the proving mode, `retry: "0"` and the aggregate dependency.
- Proof: a `workflow_dispatch` of the network workflow on this branch's FINAL commit with the job green and every matrix cell named in its log, linked in `lessons/phase-4.md`; plus a read-only `gh api` of the `dev` branch's required status checks showing `network-e2e-status` (the YAML cannot prove a status is required).

### Phase 5 — private-credit cells (boundary explicit)

Cells `{never-sent, deployed} × {simulate, send}` for `fpcCreditFee` need: the PrivateFPC on the sandbox (`ensurePrivateFpc`, `deploy-sandbox.ts:405-415`), a credit note **funded for the extension account** and visible to its PXE (the smoke's `fundedSendFor` mode does this for script accounts), and the private claim's registration leg. If the funding cannot be expressed with the package's public API in one phase, the phase records that only the public self-pay failure is fixed here and files the follow-up — the owner decides whether the PR waits (A2).

### Interfaces

- `dispatcher.ts` `buildOperation(kind, args, ctx, dappSession)` → reads `requestedFrom` for `aztec_simulateTx` and `aztec_profileTx` only; `aztec_executeUtility` unchanged; the refusal is the resolver's existing `not-authorized` error, surfaced as today.
- `HubClaimWire` (bridge-core `./hub-l2` export, playground + fixture): `Omit<HubClaimParams, "amount" | "claimValue" | "leafIndex"> & { amount: string; claimValue: string; leafIndex: string }` — `token: JournalTokenBlock` and `from` travel as they are; `toWire`/`fromWire` beside it.
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

- **Account identity is the invariant.** A `simulateTx`/`profileTx` request must run as the account it names or be refused; the wallet must never substitute another session account (a simulate as A of a payload meant for B returns A's private reads and, as here, builds an invalid or wrongly-paid transaction). The fix goes through `resolveAuthorizedSessionAccount` — unauthorized `from` refused, never downgraded — which bounds the choice to the session's granted accounts on the profile/chain; capability checks, scope enforcement (`scope-enforcement.ts:96`) and the signing confirmation are untouched. A session granting A and B does not thereby reach C.
- **Setup phase.** Setup is non-revertible and metered; the risk is unintended non-revertible effects and a wrong payer, not "free" execution. Fee and authorisation calls may legitimately enqueue allow-listed public work in setup; the dApp's own claim enqueues must follow `end_setup`. A self-pay payload misclassified as `EXTERNAL` — no payment call of its own — leaves setup unfinished; that is the defect class the gate's validator cells and the negative control prove against.
- **The stubbed simulate.** `stubAccountAddresses` bypasses the account's `is_valid_impl` and skips kernels (`pxe/service.ts:520-548`): a passing simulate proves nothing about authorization; signing-key isolation is established by the build creating account authwitnesses before substitution (`nulo-account.ts:133-134`) and must be preserved by any change here. The claim section never sets `skipTxValidation`.
- **Fee-payer classification** stays pinned (address, selector, static, `hideMsgSender`, `args[0]`); `feePayer ≠ from` still means "an external payer" (an FPC that elects itself and ends setup) and never a silent self-pay.
- **Fixture supply chain and isolation.** `deploy-sandbox.ts` fetches Permit2/Multicall3 bytecode from an RPC and installs it with `anvil_setCode` (`:108-111`): pinned hashes or local artifacts (Phase 1 deliverable); run-owned output dir (`--out`); endpoints bound to the harness ownership record, never ambient env; attach mode's `stop()` is a no-op (`local-network.ts:373`), so the harness owns teardown; impersonation restored in `finally`; every shared-signer L1 send serialized; the anvil dev key never enters a browser input. CI's `contents: read` stays; the composite action pins foundry as `_bridge-contracts.yml` does.
- **Frozen account.** Untouched. The frozen-account canary runs in Phase 3 only if the fix touches `packages/aztec-runtime` account or PXE code.

## Assumptions

**Facts**
- Both production failures were in the dApp `simulateTx` (`[sw:wallet-sdk] Method simulateTx failed for session ext-4/ext-6`); the bridge simulates every claim before sending (`hub-l2.ts:236` `awaitClaimVisible`; `apps/tools/src/composables/useSend.ts:440-453` `probeHubClaim`).
- `dispatcher.ts:1299-1301` resolves ACCOUNT_KINDS (`aztec_simulateTx`, `aztec_executeUtility`, `aztec_profileTx`) without `requestedFrom`; `:1368-1376, 1389-1396` overwrite `opts.from` for simulate and profile; `handleSendTx` (`:834-838`) honours it; `createAuthWit` has its own handler resolving `args[0]` (`:685, 896-925`); the wallet-sdk's `ExecuteUtilityOptions` carries `scopes`, not `from`; `account-resolution.ts:48-60` refuses an unauthorized `from`.
- `classifyFeePayer` returns `fpc` when `feePayer !== from` (`fee-payer.ts:63`); the planner maps `fpc` → `EXTERNAL` (`operation-planner.ts:251-256`); the account entrypoint ends setup only for `PREEXISTING_FEE_JUICE` (and via the leading claim for `FEE_JUICE_WITH_CLAIM`) — `authwit/account.nr:66-73`, identical in the frozen 5.0.1 and installed 5.2.0 artifacts; the multicall entrypoint never ends setup.
- The PXE's kernelless simulate files every public call as non-revertible when `minRevertibleSideEffectCounter === 0` (`@aztec/pxe/dest/contract_function_simulator/contract_function_simulator.js:441-455`); `pxe.js:808-817` runs `node.isValidTx` unless `skipTxValidation`; the node's default setup allow-list is AuthRegistry `set_authorized`/`_set_authorized` + FeeJuice `_increase_public_balance` (+ `TX_PUBLIC_SETUP_ALLOWLIST`), enforced in `aztec-node/server.js:619,893`.
- The e2e sandbox passes no allow-list flag (`global-setup.ts:555-616`) but spawns the node with `...process.env` (`:577`), so an ambient `TX_PUBLIC_SETUP_ALLOWLIST` (`@aztec/p2p/dest/config.js:247`) would extend the list; the harness must assert it is unset.
- aztec.js 5.2.0 `simulate()` and `send()` share `request(options)` (`contract_function_interaction.js:55-65,113-114`): payloads are identical at the SDK.
- The 5.2.0 stub delegates to `AccountActions::entrypoint` (`simulated_schnorr_account_contract/src/main.nr:64-69`).
- Root `bun run test` and `bun run typecheck` cover the extension only (`package.json:17,29`); bridge-core, wallet-bridge and the playground have their own `test`/`typecheck` scripts.
- The EVM artifacts (`contracts/bridge/evm/out`) are untracked and built only by `_bridge-contracts.yml` (`foundry-toolchain@v1`, forge-std pin, remappings); `_network-e2e.yml` has no forge step and is called separately by every caller job (the dedicated jobs, partitioning and the status aggregate live in `pr-network-e2e.yml:131-273`); the tools server in the harness is opt-in (`TOOLS_DEV_PORT`).
- `claimViaHub` returns `path: "claim" | "register+claim" | "register,claim"` (`hub-l2.ts:205-207, 278-320`) and sends immediately for a registered token; the sandbox deploy pre-registers USDC/USDT and leaves PXO portal-only (`deploy-sandbox.ts:92, 741-744, 1034`). Neither `./artifacts` nor `./fee-juice` exports `claimViaHub` (`packages/bridge-core/package.json` exports).
- `runSend` signs, submits and reads the L1 receipt only (`send-flow.ts:228`); mint, Permit2 allowance and anchor readiness are separate steps the smoke already has (`deploy-sandbox.ts:288, 359, 453`).
- `tx-sendTx-selfPay.test.ts` is green: one public transfer, `sendTx`, single account, never-sent.

**Inferences**
- I1. The owner's tools session had two granted accounts with the second selected. Load-bearing for **production attribution only**: two accounts across two session ids do not establish either session's membership or order, and a green post-fix rerun does not establish the historical mismatch. If A4's evidence is unavailable, attribution is recorded as unresolved; the defect, its fix and the gate stand on their own.
- I5. Fable's specific explanation of attempt 1 (B's authwit read on an undeployed account) is unsupported: the installed `FPCFeePaymentMethod` emits an argumentless `pay_fee()` that deducts from `msg_sender`, so the payload names no other account — but running as the wrong account still changes whose credit is read, so wrong-account selection stays a candidate. Attempt 1 is H6 in full (a settled-nullifier read the anchor does not hold: registration or message not yet settled, the account's initialization nullifier, a wrong-account read, or a simulated-read construction fault), and nothing is excluded before the nullifier's value and emitting frame are identified in Phase 2/5.
- I2. `deploy-sandbox.ts` attached to the harness's anvil + node deploys the generation the fixture needs (the attach path exists; it has run against its own network only).
- I3. The playground can consume `@nulo/bridge-core/artifacts` and `/fee-juice` without node-only modules (the tools app does).
- I4. Attempt 2's account was already deployed (the trace's root frame is the account entrypoint, no multicall frame); attempt 1's is unknown. Both states stay in the matrix; neither is claimed to mirror history.

**Asks**
- A2. **Private-credit cells.** Attempt (Phase 5), time-boxed; if the credit funding for the extension account cannot be built from the public API in the phase, this PR fixes the public self-pay failure only and the private-credit failure becomes its own arc. Default: attempt; the PR does not wait.
- A3. **Testnet canary** of the claim (nightly, opt-in) — follow-up. Default: follow-up.
- A4. **Did the tools session grant two or more accounts, with the failing account not the first?** (The choose-account modal, or the SW log `handleSendTx: account=`; the registration/claim hashes from the journal.) Asked now, not only on the all-green branch — it is the only evidence that ties H5 to production.
- A5. **CI wall-time** for a dedicated heavy job that deploys a generation per run — an unmeasured estimate of 8–12 min on top of the pool until Phase 4's dispatch measures it. Default: accept, revisit with the number.
- A6. **Behaviour change**: honouring a dApp's `from` on `simulateTx`/`profileTx` in multi-account sessions (today the first account is silently used). Default: yes — it is the documented follow-up of #110.

## Phases

`<lint>` = `bun run lint` (root); `<ext-typecheck>` = `bun run --cwd apps/extension typecheck`; `<ext-unit>` = `bun run --cwd apps/extension test`; `<wb>` = `bun run --cwd packages/wallet-bridge typecheck && bun run --cwd packages/wallet-bridge test`; `<bc>` = `bun run --cwd packages/bridge-core typecheck && bun run --cwd packages/bridge-core test`; `<pg>` = `bun run --cwd apps/playground typecheck`; `<network> <file>` = `bun run --cwd apps/extension e2e:agent <file>` (owns anvil + node + playground per worktree; run solo per memory). Every gate is `<lint>` exit 0 plus the phase's own lines.

### Phase 0 — Dispatcher honours the dApp's `from` on `simulateTx` and `profileTx`
- `dispatcher.ts` + `dispatcher.test.ts` pins (simulate/profile honour `from`; unauthorized refused; utility `scopes` and `createAuthWit([B, intent])` unchanged); playground `pg-input-from` + `pg-toggle-skipValidation`; `sim-from-selfpay.test.ts`.
- **Gate:** `<wb>` exit 0 with the new pins; `<ext-typecheck>`, `<ext-unit>`, `<pg>` exit 0; `<network> tests/e2e/network/sim-from-selfpay.test.ts` green with validation ON and the wallet's log showing resolved = accounts[1]; the reversal on `898a3b99`'s dispatcher quoted in `lessons/phase-0.md` showing resolved = accounts[0] ≠ payer = accounts[1], route `fpc`, option `EXTERNAL`, and the transfer's authorization error (the validator error is Phase 1's, on the hub claim); preconditions asserted first; neighbours `<network>` `sim-methods`, `multi-account-from`, `tx-sendTx-selfPay`, `authwit-lifecycle` green.

### Phase 1 — The gate: attach-mode generation, playground claim section, the matrix
- `deploy-sandbox.ts` (`--out`, `--no-smoke`, pinned bytecode, `finally`); `fixtures/bridge-generation.ts` (serialized signer, bound endpoints, mint → allowance → send → anchor); bridge-core `./hub-l2` export + wire helpers; `sections/bridge-claim.ts`; `bridge-claim-selfpay.test.ts` (matrix, the PXO `claimViaHub` case, the negative control, the env/list assertions).
- **Gate:** `<bc>` exit 0 and `bun run --cwd packages/bridge-core deploy:sandbox -- --smoke` exit 0 (the smoke unchanged); `<pg>` exit 0; `<network> bridge-claim-selfpay.test.ts` — the negative control rejected, `TX_PUBLIC_SETUP_ALLOWLIST` asserted unset and the effective list recorded, every matrix cell named in the log and ending in either the success oracles or a node/PXE-origin error, the PXO case with `path === "register,claim"`; zero fixture-origin failures. Red node-origin cells are recorded verbatim in `lessons/phase-1.md` and are NOT a pass of Phase 2.

### Phase 2 — Diagnosis
- The planner debug log line; the captures per red cell; the interventions above; the all-green branch (A4).
- **Gate:** `lessons/phase-2.md` names each surviving explanation with its intervention's observed outcome (a causal chain, not a cell pattern), or records the all-green branch with A4's evidence or "production attribution unresolved"; `<lint>`, `<ext-typecheck>`, `<ext-unit>` exit 0.

### Phase 3 — Remaining fix (if any) + pins
- **Gate:** `<ext-unit>` (+ `<wb>` / `bun run --cwd packages/aztec-runtime test` as touched) exit 0; `<network> bridge-claim-selfpay.test.ts` GREEN on every public self-pay cell and the PXO case; neighbours green: `tx-sendTx-selfPay`, `tx-sendTx-feePayer`, `tx-sendTx-sponsoredFpc`, `tx-sendTx-noFrom`, `sim-methods`, `multi-account-from`, `authwit-lifecycle`; if initialization or PXE behaviour changed, the claim cells rerun under real proving (`e2e:agent` with the prover enabled, the canary shard's mode).

### Phase 4 — The gate in CI
- Filter globs + pins; the caller-level `network-e2e-heavy-bridge` job + exclusions + aggregate; the gated forge step in the reusable workflow; the `forge-build-bridge` composite shared with `_bridge-contracts.yml`; README/CI.md/index.
- **Gate:** `bun run lint:actions` exit 0; `bun run test:ci-gating` exit 0 with the new pins; a `workflow_dispatch` on this branch's final commit with `network-e2e-heavy-bridge` green, every cell named in its log, and `network-e2e-status` green, linked in `lessons/phase-4.md`; `gh api repos/{owner}/{repo}/branches/dev/protection` (read-only) quoted, showing `network-e2e-status` among the required checks.

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
- **Codex final (fresh context, `01a0734f-565f-7a42-a3c0-0271421fa6ee`)** over rev 2 — `audit-codex-final.md`. VERDICT: reject — Phase 0 API scope wrong (utility/createAuthWit), reversal validation incomplete, CI job mislocated and a filter glob missing, non-causal falsifiers, the production-shaped case could bypass registration. Folded into rev 3 (ledger rows 20–30).
- **Codex final 2 (fresh context, `01a07359-b66f-7792-a730-129d3d48cf0f`)** over rev 3 — `audit-codex-final-2.md`. VERDICT: reject — the cheap reversal dies on transfer authorization before the validator; the simulate oracle cannot prove the claim ran (`claim_private` returns nothing); Interfaces stale; counter predicate; `retry: "0"`; a private `mint`. Folded into rev 4 (rows 31–36).
- **Codex final 3 (fresh context, `01a07364-bc96-73c0-a16c-98251485e91c`)** over rev 4 — `audit-codex-final-3.md`. VERDICT: **conditional approve** (with conditions: correct the Phase 0 reversal gate; bind simulation to expected claim arguments; require PXO claim settlement oracles; align I5 with the broader H6). All four applied in rev 5 (rows 37–40); no further pass — the conditions were editorial and the verdict explicit.

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

| 20 | Phase 0 scope: `executeUtility` has no `from`; `createAuthWit` has its own handler (codex final HIGH 1) | **Adopted.** Simulate + profile only; the other two pinned unchanged; criterion 1, H5, A6, Security corrected. |
| 21 | Cheap repro inherits `skipTxValidation: true`; "any red" is not evidence (codex final HIGH 2) | **Adopted.** A validation toggle set OFF; the reversal must show resolved ≠ payer, `EXTERNAL`, the validator error, after asserted preconditions. |
| 22 | Heavy job belongs in the caller workflow; `.github/actions/**` missing from the filter (codex final HIGH 3) | **Adopted.** Caller-level job + exclusions + aggregate; one gated forge step in the reusable workflow; the composite glob. |
| 23 | Ambient `TX_PUBLIC_SETUP_ALLOWLIST` reaches the node; no negative control (codex final MED 4; round-1 finding 4 previously only partly adopted) | **Adopted.** Env asserted unset, list recorded, a forbidden-setup negative control in the suite. Rev 2's ledger overstated this as adopted; corrected here. |
| 24 | `claimViaHub` not exported by the permitted subpaths; the wire shape and registration underspecified (codex final MED 5) | **Adopted.** `./hub-l2` export; `HubClaimWire` = `HubClaimParams` with string fields; instance JSON for registration. |
| 25 | `runSend` is not the whole deposit; signer serialization must cover `fundPublicFeeJuice`; attach-mode endpoints must be bound (codex final MED 6) | **Adopted.** Mint → allowance → send → anchor; one queue for the shared signer; endpoints from the ownership record; hashes + `finally` as Phase 1 deliverables. |
| 26 | Security wording overbroad (codex final LOW 7) | **Adopted.** |
| 27 | Falsifiers invalid; real proving does not remove the stub; the frozen canary is unrelated (codex final HIGH 8) | **Adopted.** Interventions with expected outcomes; per-call counters vs the boundary; the claim cells themselves under proving if init/PXE changes. |
| 28 | Production-shaped case bypasses registration on a registered token (codex final HIGH 9) | **Adopted.** PXO portal-only token; `path === "register,claim"` asserted; not counted as a never-sent cell. |
| 29 | I1 load-bearing; fable's attempt-1 explanation unsupported; H6 (codex final MED 10) | **Adopted.** I1 scoped to attribution; I5/H6 added; A4 asked now. |
| 30 | Required-check proof and named-cell execution (codex final MED 11) | **Adopted.** `gh api` branch protection quoted; cells named in the log; A5 marked unmeasured. |

| 31 | The cheap reversal fails on `authorize_once` before the validator (final-2 HIGH 1) | **Adopted.** The override sets the owner argument and `opts.from`; the reversal's evidence is the wrong resolution + the authorization failure; the exact production error is reproduced pre-fix on the hub claim in Phase 1. |
| 32 | `claim_private` returns nothing; the simulate oracle must read the execution tree (final-2 MED 2) | **Adopted.** |
| 33 | Interfaces contradicted rows 20/24 (final-2 MED 3) | **Adopted.** Rewritten; heading corrected. |
| 34 | Counter predicate wrong at the boundary; H6 too narrow (final-2 MED 4) | **Adopted.** |
| 35 | Heavy caller must set `retry: "0"` (final-2 MED 5) | **Adopted**, pinned. |
| 36 | `mint` is private to a script that runs on import (final-2 LOW 6) | **Adopted.** Exported helpers + a fixture-local mint. |
| 37 | Phase 0 gate still demanded the validator error the architecture rules out there (final-3 MED 1) | **Adopted.** The gate asks for the authorization error + wrong-account/`EXTERNAL` evidence; the validator error is Phase 1's. Heading narrowed. |
| 38 | Simulate oracle must bind the claim's arguments, not just the frame (final-3 MED 2) | **Adopted.** `argsHash` against this cell's encoded arguments. |
| 39 | PXO case could pass before its claim lands (final-3 MED 3) | **Adopted.** Send oracles applied; claim fee measured apart from registration. |
| 40 | I5 narrowed H6 (final-3 MED 4) | **Adopted.** |

**Disputed / open:** production attribution (whether H5 is what the owner hit) rests on A4; the fix and the gate do not.

## ELI5

Artifact: https://claude.ai/code/artifact/6bb17a86-152f-4e9c-a576-75a4de0e3f49 — source `implementations-plan/self-pay-setup-fix/eli5.html` (republish the same file path to update the same URL).

## Seeds

_(draft in the ELI5; finalised after approval)_
