# Codex final pass 3 — fresh context, over plan rev 4 (6819491a) + decision ledger

Session `01a07364-bc96-73c0-a16c-98251485e91c`, GPT-6 Astra at `high`, read-only. Verbatim response follows.

Rev 4 has the right implementation shape, but four plan corrections remain. **Confidence: high** in the source findings; **production attribution: unknown**.

The six previous findings were folded in as follows:

| Ledger row | Verification |
|---|---|
| 31 — cheap reversal | Partial: architecture corrected; Phase 0 gate still contradicts it. |
| 32 — simulation oracle | Partial: execution tree added; expected claim arguments omitted. |
| 33 — Interfaces | Interface corrected; “every account-scoped operation” heading remains stale. |
| 34 — counter predicate/H6 | Predicate and diagnosis table corrected; I5 retains the narrower explanation. |
| 35 — retries | Adopted: `retry: "0"` explicitly required and pinned. |
| 36 — private mint helper | Adopted: exported helpers plus fixture-local mint; no unsafe script import. |

1. **MED — Phase 0 still requires an impossible reversal result.**  
   [plan.md:160](implementations-plan/self-pay-setup-fix/plan.md:160)

   The gate requires `Setup function not on allow list`, while line 39 correctly says the transfer fails authorization first. The installed Token has `#[authorize_once("from", "_nonce")]`; installed PXE runs public simulation before `node.isValidTx` at `pxe.js:799–817`.

   **Failure:** a faithful implementation produces the intended authorization failure but cannot pass Phase 0.

   **Smallest fix:** require the authorization error plus wrong-account/`EXTERNAL` evidence here; retain the exact validator-error reversal exclusively in Phase 1. Narrow the heading at line 158 to simulate/profile.

2. **MED — The simulation oracle identifies the function, but not the intended claim.**  
   [plan.md:46](implementations-plan/self-pay-setup-fix/plan.md:46)

   The previous finding requested selector **and arguments**. Rev 4 requires only the hub frame, mint enqueue and request correlation. [hub-l2.ts:217](packages/bridge-core/src/hub-l2.ts:217) constructs the claim from token, recipient, amount, claim value and leaf index.

   **Failure:** a simulate button uses another valid deposit’s parameters on the same hub/token. The expected frames appear, the current request ID matches, and balances remain unchanged: all specified assertions pass.

   **Smallest fix:** compare the claim frame’s `publicInputs.argsHash` against the hash of the expected encoded arguments, alongside address/selector checks. The installed result exposes `argsHash`; no new tracing layer is needed.

3. **MED — The PXO orchestration case can pass before its claim lands.**  
   [plan.md:47](implementations-plan/self-pay-setup-fix/plan.md:47)

   Its explicit assertions cover registration, initialization and simulation, but omit the matrix’s send-success oracles. [hub-l2.ts:203](packages/bridge-core/src/hub-l2.ts:203) extracts only the claim hash. The extension [reads its receipt once immediately after submission](apps/extension/src/wallet/services/execution/dapp-send-executor.ts:591).

   **Failure:** registration lands and simulation passes, but the subsequent claim remains pending or fails at inclusion. The prescribed PXO assertions can still pass.

   **Smallest fix:** explicitly apply the existing send oracles to this case: poll `claimTxHash` to successful execution, assert the private-token increase, and check the claim’s fee debit separately from registration.

4. **MED — I5 still prejudges the unknown-nullifier diagnosis.**  
   [plan.md:142](implementations-plan/self-pay-setup-fix/plan.md:142)

   I5 describes H6 as registration/message visibility, contradicting the broader table at line 63. Installed `pay_fee()` takes no arguments but deducts from `msg_sender`; changing the executing account still changes whose credit it reads. The converter’s settled-nullifier check establishes absence at the anchor, not its cause.

   **Failure:** investigation excludes wrong-account, initialization or conversion involvement before identifying the rejected nullifier.

   **Smallest fix:** say Fable’s specific B-authwit explanation is unsupported; retain every candidate already listed in H6 until the nullifier and emitting frame are identified.

For **A**, `resolveAuthorizedSessionAccount` is the correct boundary alongside existing capability/scope checks. Selecting B adds the intended ability to execute as an already-granted account; it grants no access to C. Bound endpoints, shared-signer serialization, pinned bytecode, `finally`, environment assertion and the validation-enabled negative control are appropriate requirements.

For **B–D**, no additional hypothesis is justified by the inspected evidence. The subpath export, wire conversion, instance JSON, attach-mode reuse, caller-level heavy job and shared forge composite are proportionate. I found no further material filter omission. Required-check verification and named-cell enforcement are explicitly required, but remain implementation acceptance conditions—not properties established by these planning documents.

Validation: **8 CI-gating unit tests passed**. No E2E config or harness ran; no files changed.

conditional approve (with conditions: correct the Phase 0 reversal gate; bind simulation to expected claim arguments; require PXO claim settlement oracles; align I5 with the broader H6)