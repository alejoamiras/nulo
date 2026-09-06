# Codex final pass 2 — fresh context, over plan rev 3 (1c90fd69) + decision ledger

Session `01a07359-b66f-7792-a730-129d3d48cf0f`, GPT-6 Astra at `high`, read-only. Verbatim response follows.

Rev 3 fixes most prior findings, but the cheap reversal still has an earlier failure path, and the simulation oracle does not prove claim execution. **Confidence: high** in the source findings; **production attribution: unknown**.

I checked all 11 prior findings against the operative text:

| Prior finding → ledger row | Rev 3 assessment |
|---|---|
| 1 → 20: API scope | Partly adopted; Interfaces still says all `ACCOUNT_KINDS`. |
| 2 → 21: reversal validation | Requested changes adopted; a separate authorization obstacle remains below. |
| 3 → 22: CI placement/filter | Adopted. |
| 4 → 23: allow-list/control/oracles | Env/control adopted; simulation oracle remains insufficient. |
| 5 → 24: export/wire/instances | Partly adopted; Interfaces retains the incorrect wire shape. |
| 6 → 25: deposit/isolation | Adopted; helper-reuse wording needs clarification. |
| 7 → 26: security wording | Adopted. |
| 8 → 27: falsifiers/proving | Mostly adopted; the counter predicate remains incorrect. |
| 9 → 28: registration case | Adopted; PXO and initialization assertions address the bypass. |
| 10 → 29: production attribution/H6 | Partly adopted; H6 prematurely excludes possible causes. |
| 11 → 30: required check/executed cells | Adopted as explicit acceptance requirements. |

1. **HIGH — The cheap transfer reversal can fail before reaching the allow-list validator.**  
   [plan.md:39](implementations-plan/self-pay-setup-fix/plan.md:39), [simulation.ts:50](apps/playground/src/sections/simulation.ts:50).

   The transfer carries a token-owner `from` argument. The installed Token’s `transfer_public_to_public` uses `#[authorize_once("from", "_nonce")]`; its generated check requires public authorization when that owner differs from `msg_sender`. With the intended transfer from B executed as A, the fixture has supplied no B→A authorization.

   Installed PXE `pxe.js:799–817` simulates public calls **before** calling `node.isValidTx`; public simulation errors propagate. Funding B and minting tokens therefore do not establish the required reversal preconditions.

   **Smallest plan fix:** use a sender-independent, non-allow-listed enqueue for the cheap reversal, or explicitly authorize A’s transfer from B beforehand. Specify that the override updates both transfer arguments and `opts.from`, and that `pg-input-feePayer` actually populates `exec.feePayer`. Retain the exact-error requirement after making those preconditions valid.

2. **MED — `claim_private` has no return value that can establish the advertised simulation oracle.**  
   [plan.md:46](implementations-plan/self-pay-setup-fix/plan.md:46), [main.nr:254](contracts/bridge/aztec/token_bridge_hub/src/main.nr:254).

   The function returns nothing. Installed `contract_function_interaction.js:115–122` decodes its return values, falling back to `[]` when missing. An empty result plus unchanged balances cannot distinguish the intended claim from a missing or incorrectly selected return frame. Request correlation addresses stale results, not this distinction.

   **Smallest plan fix:** assert the raw simulation execution tree contains the expected hub address, claim selector/arguments and mint enqueue, traversing the initialization wrapper when present. Keep request correlation and unchanged-balance assertions.

3. **MED — The Interfaces section contradicts two corrected decisions.**  
   [plan.md:83](implementations-plan/self-pay-setup-fix/plan.md:83).

   It still specifies requested-`from` extraction for `ACCOUNT_KINDS`, which includes utility, and still lists the old `HubClaimWire`, omitting required `claimValue` and `from`. An implementer following this section would undo ledger rows 20/24. The claimed `Invalid opts.from` rejection also differs from the resolver’s actual “not authorized” error.

   **Smallest plan fix:** replace those lines with simulate/profile-only extraction and:
   ```ts
   type HubClaimWire =
     Omit<HubClaimParams, "amount" | "claimValue" | "leafIndex"> & {
       amount: string
       claimValue: string
       leafIndex: string
     }
   ```
   Preserve `token: JournalTokenBlock` and the existing authorization error. Correct the “every account-scoped operation” phase heading too.

4. **MED — Two diagnosis rules still prejudge the evidence.**  
   [plan.md:59](implementations-plan/self-pay-setup-fix/plan.md:59), [plan.md:62](implementations-plan/self-pay-setup-fix/plan.md:62).

   Installed `contract_function_simulator.js:441–449` intentionally places **all** effects in setup when the boundary is zero; otherwise counters **equal to** the boundary are revertible. The proposed `counter > boundary` test can falsely diagnose a split bug at zero and miss an equality error.

   Separately, its settled-nullifier check at `:403–437` establishes only that the requested nullifier is absent at the anchor. It does not establish eventual registration/message visibility or exclude initialization and simulated-read construction errors. The argumentless `pay_fee()` disproves Fable’s specific B-authwit story, not every possible contribution from incorrect account selection.

   **Smallest plan fix:** use `boundary > 0 && counter >= boundary` for the misplaced-effect test. Broaden H6 to an unexplained settled-nullifier read; identify its value and emitting frame before excluding initialization or conversion.

5. **MED — The new heavy caller can inherit test retries and mask a regression.**  
   [plan.md:74](implementations-plan/self-pay-setup-fix/plan.md:74), [_network-e2e.yml:82](.github/workflows/_network-e2e.yml:82), [vitest.e2e.network.config.ts:46](apps/extension/vitest.e2e.network.config.ts:46).

   The reusable input defaults to empty, yielding two retries. Existing PR callers explicitly set `"0"`. Rev 3 specifies files, proving mode and aggregation but omits that setting; an intermittent wallet failure could pass on retry.

   **Smallest plan fix:** require and behavior-pin `retry: "0"` on `network-e2e-heavy-bridge`.

6. **LOW — “Reuse the smoke’s helpers as functions” conflicts with “no helper lift.”**  
   [plan.md:43](implementations-plan/self-pay-setup-fix/plan.md:43), [deploy-sandbox.ts:288](packages/bridge-core/scripts/deploy-sandbox.ts:288).

   `mint` is private to a script that unconditionally invokes `main()` at line 1060. It cannot be imported safely as specified.

   **Smallest plan fix:** name the already exported allowance/send/readiness helpers; permit a tiny fixture-local mint call using the existing artifact. No generation-helper extraction is necessary.

`resolveAuthorizedSessionAccount` is the correct boundary alongside existing capability and scope enforcement: the fix selects another **already granted** account, without granting access to C. The proposed ownership-bound endpoints, shared-signer serialization, pinned bytecode and `finally` cleanup are appropriate. Explicitly run the negative control through **simulation with validation enabled**, matching the production failure path.

The subpath export, instance JSON, PXO orchestration case and shared forge composite are proportionate. I found no further material CI-filter omission.

Validation: the existing behavior-gating unit file passed **8 tests**. No E2E configuration or harness was executed; I made no edits.

reject (with blocking findings: cheap reversal can fail before the intended validator; simulation oracle does not prove claim execution)