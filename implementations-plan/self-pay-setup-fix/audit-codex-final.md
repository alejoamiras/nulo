# Codex final pass — fresh context, over plan rev 2 (dd56056d) + decision ledger

Session `01a0734f-565f-7a42-a3c0-0271421fa6ee`, GPT-6 Astra at `high`, read-only. Verbatim response follows.

H5 is a real defect for `simulateTx` and `profileTx`, but rev 2 still misstates the API surface and leaves material gaps in reproduction and CI enforcement. **Confidence: high** in the source findings; **production causality: unknown**. This was source inspection only; I made no changes and ran no tests or e2e configuration.

**Facts**

1. **HIGH — Phase 0 targets two methods incorrectly.**  
   [plan.md:37](implementations-plan/self-pay-setup-fix/plan.md:37); `packages/wallet-bridge/src/dispatcher.ts:684,905`; `method-descriptors.ts:198,356`; `view-executor.ts:386`.

   `createAuthWit` already uses a dedicated handler, resolves its signer from **`args[0]`**, and is excluded from the derived `ACCOUNT_KINDS`. Its second argument is an intent, not options. Meanwhile, installed `ExecuteUtilityOptions` contains **`scopes` and `authWitnesses`, no `from`**; execution passes `opts.scopes` to PXE.

   **Failure:** fabricated `{from:B}` unit calls could “prove” utility behavior the public API does not offer; routing signing through the generic handler could lose its confirmation behavior.

   **Smallest plan fix:** limit requested-`from` extraction to simulate/profile. Preserve utility scopes and the dedicated authwit handler; test authwit using `[B, intent]`. Correct acceptance criterion 1, H5, A6 and the security section.

   **Security answer:** the resolver prevents selection outside the session’s profile/chain accounts. It is sufficient for that boundary **alongside** existing capability checks, account-scope validation and signing confirmation. A session granting A+B does not thereby authorize C. Utility `scopes`/simulation `additionalScopes` remain independently checked at `scope-enforcement.ts:96`.

2. **HIGH — Phase 0’s proposed reversal retains a validation bypass.**  
   [plan.md:39](implementations-plan/self-pay-setup-fix/plan.md:39); `apps/playground/src/sections/simulation.ts:76`.

   The reused button explicitly sets `skipTxValidation: true`. Rev 2 removes that flag only from the **new claim section**, not the cheap repro.

   **Failure:** the old dispatcher can avoid the intended phases-validator rejection, or fail for another reason. “Any red on 898a3b99” is insufficient evidence.

   **Smallest plan fix:** explicitly enable validation for the cheap repro, reuse the existing `pg-input-feePayer`, and require reversal evidence showing resolved A, payer B, `EXTERNAL`, and the intended validator failure. Assert setup and funding preconditions before accepting that red.

3. **HIGH — The dedicated CI job is specified in the wrong workflow.**  
   [plan.md:70](implementations-plan/self-pay-setup-fix/plan.md:70); `.github/workflows/pr-network-e2e.yml:181,255`; `_network-e2e.yml:3,99`; `scripts/ci-cd/behavior-gating.test.ts:145`.

   Dedicated callers, file partitioning and status aggregation live in **`pr-network-e2e.yml`**. `_network-e2e.yml` is invoked separately by every caller.

   **Failure:** adding an unconditional bridge job inside the reusable workflow deploys a generation repeatedly across shard/heavy/canary invocations. The existing partition test only inspects the caller workflow. Also, the proposed filter additions omit `.github/actions/forge-build-bridge/**`.

   **Smallest plan fix:** put `network-e2e-heavy-bridge` in the caller; add a narrowly gated forge prerequisite to the reusable workflow; pin its explicit files, exclusions, proving mode and aggregate dependency. Add the composite-action glob.

4. **MED — The allow-list finding was not faithfully adopted.**  
   [plan.md:126](implementations-plan/self-pay-setup-fix/plan.md:126); `apps/extension/tests/e2e/global-setup.ts:577`; installed node `@aztec/p2p/dest/config.js:247`.

   The node inherits `process.env`, including `TX_PUBLIC_SETUP_ALLOWLIST`. “No allow-list flag or env” is false. Round-1 Codex finding 4 requested a runtime list/version check and forbidden-setup control; neither appears in the ledger or gates.

   **Failure:** an extended allow-list makes the regression green despite incorrect setup placement. A session-level “Method simulateTx” log does not establish the intended claim or validator ran.

   **Smallest plan fix:** reject unexpected allow-list extensions, record effective configuration, and retain a negative setup control in CI. Correlate simulation results to the specific request; assert the expected claim and unchanged on-chain balances.

5. **MED — The browser fixture interface remains incomplete.**  
   [plan.md:45,80](implementations-plan/self-pay-setup-fix/plan.md:45); `packages/bridge-core/package.json:6`; `src/hub-l2.ts:172`; `apps/playground/src/sections/transactions.ts:187`.

   Neither permitted subpath exports `claimViaHub`. The suggested wire fields do not precisely represent `HubClaimParams`: it needs a full `JournalTokenBlock`, `claimValue`, and `from`. Addresses alone also do not supply `registerContract`’s instance argument.

   **Failure:** implementation must violate the import restriction, duplicate orchestration, or invent missing registration/claim data.

   **Smallest plan fix:** add a browser-safe `./hub-l2` export; define the wire as the actual claim type with bigint/Fr fields serialized. Reuse delegated-authwit’s **instance JSON plus bundled artifact** pattern for hub/token registration. Keeping a small playground section is reasonable.

6. **MED — `runSend` is not the complete deposit fixture, and isolation needs an explicit boundary.**  
   [plan.md:43,116](implementations-plan/self-pay-setup-fix/plan.md:43); `send-flow.ts:228`; `deploy-sandbox.ts:288,359,453`; `fixtures/aztec.ts:398,421`.

   `runSend` signs, submits and reads the L1 receipt. It does not mint the ERC-20, establish Permit2 allowance, or advance/wait for the L2 anchor. Existing helpers cover those steps. Serializing only the new fixture does not serialize `fundPublicFeeJuice`, which uses the same signer.

   Attach mode accepts arbitrary endpoint pairs and its `stop()` is a no-op (`packages/bridge-core/scripts/sandbox/local-network.ts:373`). `--out` isolates files, not the chain.

   **Failure:** deposits fail before the wallet boundary; concurrent funding races nonces; stale attach variables overwrite singleton bytecode on another run’s Anvil.

   **Smallest plan fix:** specify mint → allowance → send → message/anchor readiness, reusing existing helpers. Bind endpoints and cached generation identity to the harness ownership record; serialize all shared-signer activity. Make hash verification and impersonation `finally` explicit Phase 1 deliverables—the “two script changes only” restriction currently contradicts them.

7. **LOW — Two security statements remain overbroad.**  
   [plan.md:113](implementations-plan/self-pay-setup-fix/plan.md:113); `fee-payer.ts:63`; `packages/bridge-core/src/private-fuel.ts:144`.

   Legitimate fee/authentication calls can enqueue public work during setup. Likewise, `feePayer ≠ from` deliberately selects external payment; an FPC can elect itself and end setup.

   **Smallest plan fix:** say **application claim enqueues** must follow setup, and that a *self-pay payload misclassified as external without a payment call* leaves setup unfinished.

**Inferences**

8. **HIGH — Phase 2 still contains invalid falsifiers.**  
   [plan.md:55](implementations-plan/self-pay-setup-fix/plan.md:55); installed `contract_function_simulator.js:320,363,441`; `packages/aztec-runtime/src/pxe/service.ts:544`.

   - A nonzero boundary legitimately leaves calls whose counters precede it in setup.
   - A successful real send **supports**, rather than falsifies, a simulation-only conversion problem.
   - Enabling proving does not remove the account override and `skipKernels` from dApp simulation.
   - Popup kind agreeing with planner intent does not establish which option the builder actually encoded.
   - Remaining red after H5’s fix does not exclude H5 as one of multiple defects.

   **Smallest plan fix:** compare each call counter with the collected boundary; capture the actual encoded option, overrides and anchor; require controlled interventions with stated expected outcomes. If initialization/PXE behavior changes, explicitly require the **claim itself** under real proving. The unrelated frozen-account canary does not fulfill ledger row 17.

9. **HIGH — The production-shaped case can silently skip its advertised path.**  
   [plan.md:47](implementations-plan/self-pay-setup-fix/plan.md:47); `deploy-sandbox.ts:1034`; `hub-l2.ts:285,318,324`.

   Deployment pre-registers USDC/USDT. `claimViaHub` immediately sends for a registered token, bypassing registration and `awaitClaimVisible`. The manifest also includes PXO with `register:false`, which is reusable.

   **Failure:** the test passes without exercising the seam acceptance criterion 3 requires. Conversely, when registration really runs from the never-sent account, that account is deployed **before** the subsequent claim simulation.

   **Smallest plan fix:** reserve an unregistered token for this case; assert the initial binding is absent, `path === "register,claim"`, registration hash, and claim-simulation execution. Assert initialization before registration and again before the claim. Keep this separate from the direct never-sent claim cell.

10. **MED — I1 remains load-bearing for production attribution; attempt 1 needs a separate candidate.**  
    [plan.md:134,142](implementations-plan/self-pay-setup-fix/plan.md:134); `audit-fable.md:17`; `hub-l2.ts:318`; `apps/tools/src/composables/useSend.ts:443`.

    Two accounts across two session IDs do not establish either session’s membership/order. A successful post-fix rerun with matching payer/from does not establish the historical mismatch.

    Fable’s specific attempt-1 explanation is also unsupported: installed `FPCFeePaymentMethod` emits argumentless `pay_fee()`, and its embedded Noir implementation deducts from `msg_sender`; that payload does not itself name B or request B’s authwit.

    **Smallest plan fix:** retain **H6: nullifier/registration visibility or simulated-read construction at the chosen anchor**. The installed converter checks settled nullifiers against the anchor (`contract_function_simulator.js:403–437`); identify the rejected nullifier and emitting frame before attributing it to account initialization.

    Obtain A4’s historical evidence early. If unavailable, explicitly leave production attribution unresolved. `registers:false` identifies a registered **token**, not account deployment; it points toward tools’ preflight probe rather than post-registration polling. I4’s root-frame inference remains conditional on having the complete trace.

**Asks**

11. **MED — A required-check verification is still missing.**  
    [plan.md:167](implementations-plan/self-pay-setup-fix/plan.md:167); `.github/workflows/pr-network-e2e.yml:255`.

    A green dispatch demonstrates execution, not that merging requires its status. The plan also does not require evidence that every expected matrix cell actually executed rather than skipped.

    **Smallest plan fix:** require the final commit’s clean dispatched run, named-cell execution evidence, and read-only verification that the target branch’s protection/ruleset requires `network-e2e-status`. This was requested in round 1; deleting A1 did not adopt it.

    A2’s explicit public-only boundary and A3’s deferred canary are reasonable. A5 should remain an unvalidated estimate until measured; A6 should cover only the actual simulate/profile behavior change.

The per-package commands, stronger send oracles, forge reuse and conditional removal of the send-path guard are sound revisions. The ledger must nevertheless mark the omissions and partial adoptions above accurately; its current “all adopted” account is unsupported.

reject (with blocking findings: incorrect Phase 0 API scope; incomplete reversal validation; mislocated CI job and missing dependency coverage; non-causal diagnosis falsifiers; production-shaped case can bypass registration and polling)