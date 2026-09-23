Verified against commit `62f3456af552b40fed7aa8bfe5e0b838ffe3d720`. Independent assessments were recorded before reading each full finding. No files were modified or `node_modules` files read.

Validation combined source tracing with dependency-free, in-memory checks. Browser rendering, complete backup restoration, PXE execution, and on-chain acceptance were not run; those limits are distinguished below.

### F-01 — XOR-only chain validation permits a different signing domain

**Independent read (before reading the trace):**  
`packages/aztec-runtime/src/utils/chain-identity.ts:53-61` compares only the unsigned XOR composite; it never checks stored `l1ChainId`.  
The repository’s mainnet tuple is `(1, 4248422647)`, composite `4248422646` (`apps/extension/src/utils/chain-ids.ts:17-30`).  
The supplied `(2, 4248422644)` tuple passes that guard, then becomes the hash metadata at `apps/extension/src/wallet/services/execution/service.ts:876-879`.  
Normal account and artifact resolution permit execution to reach hashing and signing at `:922` and `:935`.

**Verdict:** **CONFIRMED.**

**Comparison with the full trace:** The central trace matches. The evidence establishes construction/signing with the wrong domain, not successful redemption on another real rollup. The NO_FROM instance constructs a transaction context; it should not itself be described as an account-signature bypass.

**Strengthened trace:**

1. **Precondition:** An unlocked account uses a configured endpoint that returns the colliding tuple; the requested authwit otherwise satisfies ordinary account, artifact, and function checks.
2. **Source:** `apps/extension/src/wallet/services/execution/service.ts:871-872` obtains endpoint-controlled node information.
3. **Gap:** `packages/aztec-runtime/src/utils/chain-identity.ts:55-56` accepts `(2 ^ 4248422644) >>> 0 === 4248422646`.
4. **Consumption:** `apps/extension/src/wallet/services/execution/service.ts:877-878` constructs `Fr(2)` and `Fr(4248422644)`. Its checks at `:889-918` validate the contract, function identity, and arguments, without comparing the exact chain identity.
5. **Sink:** `:922` passes that metadata to `computeAuthWitMessageHash`; `:935` calls `account.createAuthWit`. `packages/aztec-runtime/src/account/nulo-account.ts:133-134` delegates to the account’s witness provider.

An in-memory execution of the extracted guard and service method reached the hash function with `{chainId: 2, version: 4248422644}` and invoked the signer stub. Cryptography and external dependencies were stubbed.

Additional instances match the shared defect:

- Standard transactions: `apps/extension/src/wallet/services/execution/tx-request-builder.ts:220-221` → `:286` → `packages/aztec-runtime/src/utils/chain-identity.ts:69-70` → `packages/aztec-runtime/src/account/nulo-account.ts:184`.
- NO_FROM: `apps/extension/src/wallet/services/execution/tx-request-builder.ts:404-418`.
- Authwit discovery: `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:853-864`, `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:106-122`, and `apps/extension/src/wallet/services/execution/discovery-probe.ts:73-90`.
- Identity reuse and reads: `apps/extension/src/wallet/services/execution/service.ts:227-231`, `apps/extension/src/wallet/services/execution/fast-path.ts:176-183`, `apps/extension/src/wallet/services/execution/view-executor.ts:207-212`, and `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:203-205`, `:357-366`, `:538-549`.
- Metadata simulation has no guard: `apps/extension/src/wallet/services/token/service.ts:711-720` → `apps/extension/src/wallet/utils/fn.ts:85-100`. This is a local simulation path, not demonstrated broadcast or signature extraction.

Endpoint enrollment already checks exact L1 equality at `apps/extension/src/wallet/services/network/service.ts:560-572`; that check does not cover an endpoint changing its response later.

**Severity check:** **Keep High:** the configured endpoint can alter the domain supplied to signing; cross-chain redemption remains unproven.

**Fix check:** Extending the helper to require stored `l1ChainId` is appropriate; mirror `apps/extension/src/wallet/services/network/service.ts:568-572`. For nonzero composites, also compare the live version directly with `(network.chainId ^ network.l1ChainId) >>> 0`, or enforce canonical numeric ranges before relying on XOR equality. Otherwise, bitwise truncation undermines the claim that composite equality pins the version exactly.

Apply the guard to the metadata helper with the selected network supplied by its caller. For local networks, check the stored L1 identity even where version comparison is skipped; preserve custom/local network behavior rather than embedding an unconditional runtime constant.

**Confidence:** **High** — the collision and service-level propagation were reproduced in memory, and the cited callers share the same guard.

### F-02 — Approval cards omit arguments and authorization details

**Independent read (before reading the trace):**  
`apps/extension/src/utils/transfer-intent.ts:23` recognizes four transfer names, and `:72` requires exactly three arguments.  
`transfer(to, amount)` and four-argument transfers return `unverified`; `apps/extension/src/popup/windows/execute/OperationCard.vue:135-156` has no fallback rendering.  
The explicit authwit card omits the delegate, arguments, and inner hash (`:357-392`), while execution consumes them.  
Discovered witnesses are added to execution actions, but the card iterates the original `exec.calls` (`:117`).

**Verdict:** **CONFIRMED.**

**Comparison with the full trace:** The disclosure finding holds. Correct the execution citation: `tx-request-builder.ts:184-188` does not encode these `aztec_sendTx` arguments. They follow the encoded-call path through `:188-192` and `:584-597`. Also, discovery is established **before approval**, including estimation initiated by the popup; “before the popup” is too broad.

**Strengthened trace:**

- **Transfer arguments:** A connected dApp supplies a valid call with the real `transfer` selector and encoded recipient/amount. `packages/wallet-bridge/src/dispatcher.ts:933-957` resolves the authorized account and forwards the payload. `apps/extension/src/utils/transfer-intent.ts:59-66` returns `unverified`; `apps/extension/src/popup/windows/execute/OperationCard.vue:126-135` shows the method label and contract while suppressing the arguments block. The friendly label comes from `apps/extension/src/utils/tx-enrichment.ts:17`.
  
  Approval preserves the operation at `apps/extension/src/popup/windows/execute/index.vue:412-449`. `apps/extension/src/wallet/services/execution/operation-planner.ts:206-218` preserves arguments in an `encoded_call`; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:188-192` constructs the call, with the actual fields retained at `:595`. The payload then enters account transaction construction at `:275-286`.

  Direct execution of the parser returned `unverified` for both the two-argument `transfer` and four-argument `transfer_in_private`; the three-argument legacy control was recognized. Template inspection establishes the missing fallback; no mounted-browser assertion was run.

- **Explicit authwits:** Uncovered call intents and inner-hash requests reach confirmation through `packages/wallet-bridge/src/dispatcher.ts:1002-1010`. `apps/extension/src/popup/windows/execute/OperationCard.vue:357-392` omits the relevant authority details. Execution includes `caller` and arguments at `apps/extension/src/wallet/services/execution/service.ts:909-922`, or `consumer` and `innerHash` at `:925-929`, then signs at `:935`.

- **Discovered authwits:** For a foldable fee estimate, `apps/extension/src/wallet/services/execution/discovery-aware-estimator.ts:99-109` creates the probe. `apps/extension/src/wallet/services/execution/discovery-probe.ts:80-90` produces opaque authorization actions; `apps/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts:32-39` appends them and rebuilds. `apps/extension/src/wallet/services/execution/tx-request-builder.ts:146-162` creates the witnesses. The estimate response contains fee fields and an ID, without authorization details (`apps/extension/src/wallet/services/execution/dapp-send-executor.ts:293-305`).

- **Other supplied fields:** Witnesses, capsules, and extra arguments enter execution through `apps/extension/src/wallet/services/execution/operation-planner.ts:175-203`, or the NO_FROM parser at `apps/extension/src/wallet/services/execution/tx-request-builder.ts:347-358`. Original request fields remain available through the JSON window (`apps/extension/src/popup/windows/json/index.vue:12`, `:56`). Discovered actions are not part of that original request.

Existing session/account checks and selector/name binding at `apps/extension/src/wallet/services/execution/tx-request-builder.ts:573-580` prevent different attacks; they do not disclose recipient, amount, or delegate. This does not establish unrestricted witness export or replay.

**Severity check:** **Keep High:** valid transfer and authorization requests can receive approval without displaying their material parameters.

**Fix check:** The smallest immediate correction is the missing indexed-argument fallback and warning. Mirror the spender/argument presentation at `apps/extension/src/popup/windows/execute/OperationActionRow.vue:20-31`, ensuring complete values remain inspectable.

Share transfer descriptors through a lightweight common module; importing the entire wallet implementation into the popup is unnecessary. Name and arity alone should not imply verified token semantics. Discovered authorization disclosure must remain bound to the execution being approved, including rebuilds when an estimate cannot be reused.

**Confidence:** **High** — parser behavior was executed directly; the rendering branches and argument-preserving execution paths are explicit.

### F-03 — Restored PrivateFPC rows can displace the canonical fee payer

**Independent read (before reading the trace):**  
`apps/extension/src/wallet/services/fpc/service.ts:503-525` accepts a supported numeric type and string address without checking the canonical PrivateFPC address.  
`getFpcs()` retains restored rows and appends discovered canonical rows (`:172-187`); decoration correctly marks the noncanonical row as nonprotocol.  
`apps/extension/src/popup/components/modules/send/fee-helpers.ts:157-163` nevertheless selects the first PrivateFPC and omits every later one.  
Execution obtains that row’s handler and constructs `pay_fee()` at its address (`apps/extension/src/wallet/services/fpc/service.ts:426-432`; `apps/extension/src/wallet/services/fpc/handlers/private-fpc-handler.ts:23-31`).

**Verdict:** **CONFIRMED** for canonical-option displacement and fee-call substitution.

**Comparison with the full trace:** The main mechanism matches. “Registers any backup-supplied instance/artifact” needs qualification: downstream registration parses both objects and checks the derived address. The source does not establish acceptance of malformed artifacts, loss of funds held in the canonical PrivateFPC, or sequencer acceptance of a nonpaying contract.

**Strengthened trace:**

1. **Precondition:** A valid imported profile/network receives the noncanonical row before any canonical PrivateFPC row. For a usable fee option and executable transaction, its address must resolve to a compatible registered contract whose balance read succeeds with a positive value.
2. **Source:** Service slices are restored at `apps/extension/src/composables/full-backup-restore.ts:425-429`. The checksum is explicitly unauthenticated (`apps/extension/src/composables/useFullBackupImport.ts:85-94`).
3. **Gap:** `apps/extension/src/wallet/services/fpc/service.ts:512-524` persists the supplied address. `apps/extension/src/wallet/services/fpc/spec.ts:35-41` checks only a string address and supported enum.
4. **Selection:** `apps/extension/src/wallet/services/fpc/service.ts:172-187` appends the genuine row. `apps/extension/src/popup/components/modules/send/fee-helpers.ts:157-163` selects the restored row and suppresses the canonical alternative.
5. **Balance and settings:** `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:180-187` reads `balance_of` at that same first address. A positive result permits settings containing its `fpcId` at `apps/extension/src/popup/components/modules/send/fee-helpers.ts:89-92`.
6. **Sink:** `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:101-106` obtains the implementation; `:241-248` prepends its fee payload and rebuilds. `apps/extension/src/wallet/services/fpc/fpc.ts:17-18` delegates to the handler, which targets the supplied address.

An in-memory check using the actual fee helpers returned exactly one `private_fpc` option carrying the noncanonical address and `isProtocol: false`; `settingsForMethod` selected its ID.

The backup registration path reaches `apps/extension/src/wallet/services/account-state/service.ts:397-400`, but `packages/aztec-runtime/src/pxe/service.ts:444-452` performs schema parsing and derived-address verification. Missing contracts/artifacts also fail execution resolution at `apps/extension/src/wallet/services/execution/contract-resolver.ts:127-155`. A planted row alone therefore does not prove a successful transaction.

**Severity check:** **Keep High** for substitution of the contract included as the user’s private fee payer; canonical-balance theft and successful on-chain execution remain unverified.

**Fix check:** Reject noncanonical **PrivateFPC** addresses on restore, select only protocol PrivateFPCs in the UI and balance reader, and enforce the same restriction at `getFpcImpl` so existing rows cannot bypass the UI correction. Reuse canonical derivation/decoration at `apps/extension/src/wallet/services/fpc/service.ts:109-131`; protocol-based eligibility already exists at `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:111-115`.

The proposed blanket rejection of noncanonical **sponsored** FPCs is excessive. Custom sponsored contracts are supported by `apps/extension/src/wallet/services/fpc/service.ts:276-305` and `:373-405`; rejecting them would break valid backup restoration.

**Confidence:** **High** for the selection and call-construction defect; compatible-contract execution and settlement were not reproduced.

### F-04 — Restored network rows silently replace the default RPC configuration

**Independent read (before reading the trace):**  
`apps/extension/src/wallet/services/network/service.ts:1046-1059` validates shape, URL policy, and profile/chain collisions without authenticating a seeded network designation or endpoint.  
A complete mainnet-shaped row using `https://attacker.example` satisfies the visible schema (`apps/extension/src/wallet/services/network/spec.ts:169`, `:187-196`).  
Once stored, `getOrInitNetworks()` returns it before reaching default seeding (`apps/extension/src/wallet/services/network/service.ts:240-246`).  
`getNode()` subsequently creates the client from its primary endpoint (`:724-728`).

**Verdict:** **CONFIRMED** for persistent endpoint substitution and suppression of default seeding.

**Comparison with the full trace:** The mechanism matches. Two descriptions need correction: `kind` is an enumerated optional field, not arbitrary text, and the normal seed path also writes seeded kinds. Neither correction removes the restore gap. Claims about fabricated results must remain limited by downstream validation; endpoint control alone does not prove that every false response is accepted.

**Strengthened trace:**

1. **Precondition:** The user imports an otherwise valid backup into a newly restored profile. The supplied network includes `id`, `profileId`, `name`, `kind: "mainnet"`, `l1ChainId: 1`, `chainId: 4248422646`, endpoint ID `e1`, and matching `primaryEndpointId`.
2. **Source:** `apps/extension/src/composables/useFullBackupImport.ts:475-488` creates the profile, remaps child ownership, and restores networks. `apps/extension/src/composables/full-backup-restore.ts:267-268` accepts successful network results.
3. **Gap and persistence:** `apps/extension/src/wallet/services/network/service.ts:1046-1059` accepts the row; `:885-891` writes it. HTTPS passes the URL policy at `apps/extension/src/wallet/services/network/spec.ts:167-169`.
4. **Seeding suppression:** Activation is deliberately delayed until data restoration finishes (`apps/extension/src/composables/useFullBackupImport.ts:540-546`). The subsequent existing-row branch at `apps/extension/src/wallet/services/network/service.ts:241-242` returns without seeding defaults.
5. **Selection and sink:** `apps/extension/src/wallet/services/network/service.ts:415` recognizes the row by the primary seed’s composite; `:724-728` builds a client using the supplied endpoint. PXE network snapshots likewise carry that URL through `apps/extension/src/wallet/services/network/spec.ts:92-95`.
6. **Presentation:** The execution identity strip uses the stored network name (`apps/extension/src/popup/windows/execute/SignerIdentityStrip.vue:25-35`), allowing the ordinary mainnet label to remain.

An in-memory execution of the actual `getOrInitNetworks()` method, with the supplied row in stubbed storage, returned only that row and never reached seeding. Restore acceptance was verified against the source schema and guards, not through a complete restore integration test.

Ownership remapping, collision checks, deletion fences, and URL restrictions remain effective for their respective purposes. `assertCanonicalStoredL1` at `apps/extension/src/wallet/services/network/service.ts:346-355` would pass the supplied genuine L1 constant. A self-reported identity probe cannot establish that the endpoint operator is trustworthy.

**Severity check:** **Keep High** for persistent RPC substitution under the hostile-backup threat model; wrong-domain signing additionally depends on F-01.

**Fix check:** The recommendation needs refinement. Forcing the imported row to `custom` and then seeding by missing kind can create two rows with the same profile/chain identity, violating the uniqueness rule at `apps/extension/src/wallet/services/network/service.ts:1055-1056`.

Use one canonical row per seeded chain and make imported alternative endpoints require explicit review before activation, while preserving legitimate endpoint customization. Reuse seed construction at `apps/extension/src/wallet/services/network/service.ts:267-283` and exact identity checks at `:560-572`. Literal seed-URL rejection alone would break intentionally customized mainnet/testnet backups, which the endpoint-edit API explicitly supports at `:589-628`.

**Confidence:** **High** for restore acceptance and endpoint selection from the inspected source; the seeding branch was also executed in memory. No hostile RPC or on-chain interaction was performed.