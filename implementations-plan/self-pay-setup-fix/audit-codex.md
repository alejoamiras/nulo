# Codex audit — round 1 (plan draft 9a9f3d3f)

Session `01a0733a-145b-7232-be47-98956537f7a1`, GPT-6 Astra at `high`, fresh context, read-only. Verbatim response follows.

The plan needs revision before implementation. Its strongest feature is the real bridge regression test; its weakest is treating test outcomes as proof of a particular root cause.

**Confidence: high** in the source findings below. The production root cause remains **unknown**. I ran only `bun test scripts/ci-cd/behavior-gating.test.ts`: **8 passed**. No e2e configuration or browser harness was executed. HEAD differs from `898a3b99` only by the audit documents.

**Facts**

1. **HIGH — The proposed fixture cannot bootstrap on a clean CI checkout as specified.**  
   `plan.md:36,134`; `packages/bridge-core/scripts/script-artifacts.ts:12–16`; `.github/workflows/_network-e2e.yml:138–149`.  
   The smoke helpers read `contracts/bridge/evm/out/*.json`. Those outputs are untracked, and the network workflow neither builds them nor checks out contract submodules. Installing Aztec supplies tools, not this repository’s compiled bridge contracts. A locally prepared worktree could pass while CI fails before exercising the wallet.  
   **Smallest plan fix:** add the existing remapping/submodule/build prerequisites to fixture preparation and CI; require one clean-checkout validation before accepting Phase 1.

2. **HIGH — “Every fee-path change triggers the gate” is not established by Phase 4.**  
   `plan.md:40,147–148`; `.github/workflows/pr-network-e2e.yml:49–88`; `scripts/ci-cd/behavior-gating.test.ts:59–65,89–92`.  
   The filter covers bridge-core `src` and its manifest, but not the newly consumed `scripts/**` or EVM contracts/build inputs. The graph guard only requires dependency-library `src/**` and `package.json`. Adding the Aztec-contract glob and already-covered playground/extension paths leaves these holes. A workflow appearing in `gh run list` also proves neither execution of this test nor successful aggregation.  
   **Smallest plan fix:** enumerate and pin the fixture’s actual script, EVM, artifact and build dependencies; verify the new test’s execution and successful required status on the PR’s exact head. Check branch protection separately—the YAML cannot prove that the status is required.

3. **HIGH — The universal validation commands do not mean what the plan says.**  
   `plan.md:131`; root `package.json`, scripts `test`, `typecheck`, `test:all`, `typecheck:all`.  
   Root `bun run test` runs **extension tests only**; root `typecheck` checks the extension. Thus bridge-core extraction and playground changes can satisfy the advertised “all workspaces” gate without their own checks.  
   **Smallest plan fix:** name the affected-package checks explicitly, including bridge-core’s script typecheck and playground typecheck. Use existing aggregate commands only where appropriate.

4. **MED — Absence of an allow-list CLI flag does not establish identical enforcement.**  
   `plan.md:109–110`; `apps/extension/tests/e2e/global-setup.ts:576–577`; installed `@aztec/p2p/dest/config.js:246–247`.  
   The node inherits `process.env`; `TX_PUBLIC_SETUP_ALLOWLIST` configures extensions. Additionally, PXE validation is conditional: installed `@aztec/pxe/dest/pxe.js:808–817` skips `node.isValidTx` when `skipTxValidation` is true. Node `server.js:618` returns the list; it is not itself the simulation enforcement point.  
   **Smallest plan fix:** record the actual node version/list and validation flags. Require a control that rejects a deliberately forbidden setup enqueue. Preserve the list’s address and sender restrictions, not just function names.

5. **MED — The security explanation misstates both setup charging and the stub’s protection.**  
   `plan.md:98–100`; installed `contract_function_simulator.js:363–366`; `account_entrypoint.js:105–106`; `packages/aztec-runtime/src/account/nulo-account.ts:133–134`.  
   Setup is non-revertible; it is not universally “fee-free until `end_setup`”—the simulator meters non-revertible and revertible effects. Also, the build creates account authwitnesses before PXE substitution. The stub bypasses account validation; it is not the mechanism that establishes signing-key isolation.  
   **Smallest plan fix:** describe the actual risks: unintended non-revertible effects, wrong payer, and simulations accepting authorization that a real send rejects. Preserve key isolation and real-send authorization independently; do not prescribe keeping the stub as the only permissible implementation.

**Inferences**

6. **HIGH — The diagnosis table is not discriminating, and Phase 2 can force a false conclusion.**  
   `plan.md:48–51,139–140`; `operation-planner.ts:249–256`; `view-executor.ts:305–335`.  
   H1 and H4 can produce the same simulate-only failure. H3 can also be an initialization-dependent stub/conversion problem, rather than a defective real account wrapper. H2’s send dispatcher is not used by dApp simulation, so that dispatcher alone cannot explain both paths failing. Moreover, **missing `feePayer` alone defaults simulation to `PREEXISTING_FEE_JUICE`**, not `EXTERNAL`.

   I1 is partly verifiable now: the installed 5.2.0 `SimulatedSchnorrAccount.json` embeds `main.nr:66–68`, delegating to `AccountActions`, whose embedded `account.nr:66–73` sets the payer and ends setup for option 1.

   **Smallest plan fix:** replace “pattern → hypothesis → fix site” with candidate explanations and falsifiers. Add **H5: correct entrypoint execution, incorrect simulated transaction construction/validation**, including kernelless conversion, override identity and anchor state. PXE calls `generateSimulatedProvingResult` at `pxe.js:785–796`; that converter partitions public calls using the collected revertibility counter. Capture:

   - Actual encoded fee option and request origin.
   - Relevant nested phase counters and resulting setup/app public-call lists.
   - Stub overrides, validation flags and anchor state.
   - Wire payer/from plus resolved wallet account.

   Accept a causal explanation supported by a controlled intervention, not merely a lesson naming ONE hypothesis. If all cells pass unchanged, diagnosis remains open.

7. **HIGH — The test’s proposed oracle can green a broken bridge.**  
   `plan.md:24,37–39,136`; `apps/playground/src/sections/transactions.ts:83–97`.  
   “Mined and FJ fell” can describe a reverted transaction that charged fees. “Simulation did not throw” does not prove the intended claim executed. The deployment warm-up returns with `NO_WAIT`, and shared state or reused claims can invalidate the matrix labels. Reaching an assertion also permits capability failures, stale UI results or message-visibility failures to masquerade as useful reproduction.

   **Smallest plan fix:** require independent claim messages and explicit account-state checks immediately before each cell; poll warm-up mining. Assert successful receipt execution, the intended recipient’s private-token increase, and fee debit matching the receipt. Simulation should exercise the expected call and leave on-chain state unchanged. Phase 1 may accept red cells, but only after verified fixture preconditions and the targeted failure at the intended boundary—not arbitrary red assertions.

8. **MED — I3 is unsupported and conflicts with the claimed production path.**  
   `plan.md:121`; `packages/bridge-core/src/hub-l2.ts:285–320`.  
   The owner does not know the accounts’ history. An unknown-nullifier error is not unique to an undeployed account. More strongly, `awaitClaimVisible` runs after this caller’s registration send has produced a hash; the normal path proceeds after its fate is mined. If that is where production failed, the account has just sent a registration transaction.  
   **Smallest plan fix:** mark production deployment state unknown, record the registration hash/from and relevant block state, and retain both account-state cells without asserting either reproduces the historical state.

9. **MED — The playground bypasses part of the production flow while claiming equivalence.**  
   `plan.md:38,87`; `hub-l2.ts:129–135,317–320`; `deposit-flow.ts:618–626,775–790`.  
   Bridge-core passes the **same `claimOpts`** to its visibility poll and eventual send. Installed aztec.js also builds both interaction payloads through `request(options)` and preserves `from` in its option translators. These reads weaken the proposed “different claim options” explanation, although runtime capture is still necessary.

   The proposed direct buttons omit registration, `registeredClaimFee` selection, visibility polling and tools’ supplied gas settings. A plain pre-registered-token test cannot prove those seams.

   **Smallest plan fix:** retain the direct matrix for diagnosis, plus one production-shaped `claimViaHub` registration→poll→send case using the real fee-options construction. Full tools UI coverage is optional; claiming equivalent coverage is not.

10. **MED — I2 overstates the need for extraction and understates helper coupling.**  
    `plan.md:36,120,134`; `deploy-sandbox.ts:13,667–674,1039–1062`; `scripts/sandbox/local-network.ts:373–382`.  
    The smoke already attaches to an existing network through `SANDBOX_L1_RPC` and `SANDBOX_NODE_URL`. Extraction is not necessary merely to target the harness. Conversely, `depositFresh` hardcodes a public deposit to script accounts, and `claimInputs` obtains `from` from script-wallet options. They are not directly reusable for arbitrary extension recipients.

    **Smallest plan fix:** reuse the attach mode for the unchanged smoke validation; extract only the setup/deposit functionality the extension test actually needs, with explicit recipient/privacy inputs and cleanup ownership. Do not import the CLI as-is: its unconditional `main()` executes deployment and can exit the process. Executing the smoke alone still cannot test the extension.

11. **MED — The new interfaces contain concrete gaps.**  
    `plan.md:38,63–69`; `hub-l2.ts:172–181,213`; `packages/bridge-core/package.json:exports`.  
    `claimCall` is private, not an importable export. `HubClaimParams` contains `bigint` and `Fr`, so “JSON of HubClaimParams” needs a defined wire representation. The illustrated `.send({ fee: selfPaidFeeJuicePayment(from) })` is wrong: the payment method belongs under `fee.paymentMethod`. Contract registration for the new hub/token must also be specified.

    **Smallest plan fix:** define the string-based fixture wire shape and rehydration, correct fee nesting, and reuse the existing instance/artifact registration pattern. I4 is reasonable for browser-facing exports; it does not authorize importing script modules into the playground.

12. **MED — The unconditional mismatch error mixes payment policy with setup correctness.**  
    `plan.md:49,58`; `fee/fpc-strategy.ts:129–130`; `fee/embedded-strategy.ts:25–31`; `popup/windows/execute/OperationCard.vue:80–83`.  
    An `fpc` strategy legitimately prepends payment calls before building `EXTERNAL`; therefore `EXTERNAL` does not inherently mean setup stays open. “Require kind fj” also differs from “reject strategies building EXTERNAL”—the latter leaves other mismatches unspecified.

    Today self-pay’s fee card is locked, so rejecting an actual self-pay override agrees with current policy. An absent-payer transaction deliberately switched to Sponsored FPC is legitimate and must remain so.

    **Smallest plan fix:** make this a separately justified route-policy check, derived from the parsed request, with explicit allowed combinations. Cover absent-payer overrides, FJ-with-claim and embedded FPC. Do not present it as a guaranteed fix for simulation or as a universal setup validator.

13. **MED — The newly reused harness has supply-chain and ownership obligations beyond “workspace dependency.”**  
    `plan.md:63,101–103`; `deploy-sandbox.ts:108–111,138–158,995–1033`.  
    Setup fetches executable Permit2/Multicall3 bytecode from an RPC and installs it with `anvil_setCode`, without a hash check. An unavailable or dishonest RPC can break or alter the fixture. Helpers also impersonate an owner and write deployment journals/manifests. A public development key provides no isolation from another agent’s sandbox.

    **Smallest plan fix:** pin expected bytecode hashes or reuse verified local artifacts; pass run-owned endpoints/output directories explicitly; serialize shared-signer writes; return cleanup handles and restore impersonation in `finally`. Keep keys out of browser inputs. Existing read-only workflow permissions are appropriately narrow; mutable action tags and the curl-to-shell Aztec installer remain inherited supply-chain exposure, not newly solved by this plan.

**Asks**

14. **MED — A2 needs an explicit completion boundary; deployability alone is insufficient.**  
    `plan.md:25,126,150–152`; `deploy-sandbox.ts:405–415`.  
    `ensurePrivateFpc` deploys the contract; it does not establish a spendable credit note for the extension account. Recording a blocker can therefore satisfy Phase 5 while the second reported production failure remains unresolved.  
    **Smallest plan fix:** distinguish “public self-pay fixed” from “both reported failures fixed.” Surface that scope decision and specify credit funding, account ownership and PXE visibility before making the private-credit matrix conditional.

15. **LOW — A1 repeats authorization already given; A3 must not become an escape hatch.**  
    `plan.md:125–127`.  
    The owner explicitly requested the e2e gate. No further preference question is needed to add it. Historical account/registration evidence is useful missing information, while a nightly canary is genuinely separate scope.  
    **Smallest plan fix:** replace A1 with verification of required-check configuration. Keep A3 deferred, but require further investigation if sandbox tests never reproduce the failure.

I would keep **reproduction before fixing**, but shorten the sequence: first verify the installed semantics and capture the failing request; then implement the smallest real-claim matrix, diagnose causally, and fix. The competing fix-first outline guesses the invariant is useful and still leaves production verification manual, so it does not satisfy the owner’s requirement.

For the browser driver, test-side `page.evaluate` using the playground’s exported `getWallet()` can avoid a permanent bridge section. A raw `ExecutionPayload` is sufficient for wallet routing coverage, but bypasses interaction `.simulate()` construction; retain one real interaction/bridge orchestration case. Also, `frozen-account-canary` actually drives existing buttons—it is not already an arbitrary-payload injection primitive.

Finally, Phase 3’s neighbours are incomplete for the possible fix sites. Add targeted coverage for absent-payer fee-card switching, FJ-with-claim, NO_FROM, multicall/chunking and stubbed authwit discovery as those paths are touched. If initialization or PXE behavior changes, require the claim case under real proving: the default network shard pool is proverless (`pr-network-e2e.yml:169–170`). Resolve the contradiction between `plan.md:104` excluding the frozen canary and `:144` requiring it.

VERDICT: **reject (with blocking findings: non-causal diagnosis gate, insufficient claim assertions, missing clean-CI fixture prerequisites, incomplete CI dependency coverage, and misstated validation commands).**