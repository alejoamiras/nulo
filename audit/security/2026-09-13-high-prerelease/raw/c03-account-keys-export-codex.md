Files read: Assigned c03 account source/tests, security and import pages, requested network excerpts, supplied context/maps, and relevant crypto, storage, execution, bridge, and PXE handoffs at `62f3456a`.
Findings count: 2.
Non-findings count: 13.

### F-1: Signing still accepts a different chain identity with the same XOR composite

1. **Title:** A lying RPC can change the exact chain identity used for signatures while satisfying the selected-network check.

2. **Impact factors:** Violates signing authorization and integrity: the wallet signs material for an L1/rollup pair different from the selected pair. The affected scope includes transaction entrypoint signatures and intent-based authwits. Attack vector is a selected RPC’s response; constructing a collision is trivial. No wallet password, storage access, or key extraction is required. The user must initiate a relevant operation, or a connected dApp must already hold sufficient capabilities. Spendable consequences depend on the resulting authorization being usable on the alternative chain; arbitrary theft from an existing mainnet account was **not** demonstrated.

3. **Evidence confidence:** **High.** The production guard accepted a concrete colliding tuple in an in-memory check. The signing paths directly consume the accepted response’s exact fields. This is the explicitly held July collision, revalidated as still open after the account KDF changes.

4. **OWASP / CWE mapping:** [OWASP A01:2025 — Broken Access Control](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/); CWE-863, Incorrect Authorization, included in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html). The authorization boundary is the chain on which the selected account may sign.

5. **Trace:** An RPC-controlled `getNodeInfo()` response enters `executeAztecCreateAuthWit` at `apps/extension/src/wallet/services/execution/service.ts:872` → `assertLiveChainIdentity` compares only `(l1ChainId ^ rollupVersion) >>> 0` at `packages/aztec-runtime/src/utils/chain-identity.ts:53` → the execution handler uses the unchecked exact values in metadata at `apps/extension/src/wallet/services/execution/service.ts:876` and hashes the intent at `:922` or `:929` → `account.createAuthWit` at `:935` reaches the signing provider at `packages/aztec-runtime/src/account/nulo-account.ts:133`.

   The dApp handoff is concrete: `packages/wallet-bridge/src/dispatcher.ts:987` resolves the authorized account/network; `:991` constructs the operation; `:998` executes it and `:999` returns the result.

6. **Missing control and recommended fix:** The signing guard’s selected-network interface contains only the composite `chainId`; it cannot compare the stored exact `l1ChainId`. Require canonical numeric identities and compare the exact approved L1 and rollup version before creating signed material. For nonlocal networks, the expected version can be recovered from a validated composite plus the approved exact L1, or persisted explicitly. Local networks should also validate their expected L1 instead of unconditionally returning. Thread the validated snapshot through every signing caller, including metadata simulation.

7. **Failure scenario:** The repository pins mainnet to L1 `1`, rollup version `4248422647`, composite `4248422646` at `apps/extension/src/utils/chain-ids.ts:17`. A selected malicious RPC instead reports L1 `31337`, rollup version `4248416927`. Both pairs produce composite `4248422646`. The guard accepts the response. The account service re-derives the legitimate original account using its stored L1 `1`, while execution hashes the requested intent with L1 `31337` and version `4248416927`. It then returns an authwit signed by the original account for that alternative pair.

   The in-memory check executed the production guard and confirmed acceptance of these values. It did not execute a live-chain transaction.

8. **Preconditions:** The attacker controls or compromises a selected RPC, or can change its reported identity after enrollment. An unlocked wallet performs an operation that creates chain-bound signed material. The authwit example uses a structured intent; it does not depend on bypassing the dispatcher’s rejection of raw-hash requests.

9. **Why mitigations fail:** Exact-L1 account derivation protects the account’s key/address derivation, not the later signing context. Creation verifies L1 at `apps/extension/src/wallet/services/network/service.ts:372`, but signing reuses the row-carried derivation input at `apps/extension/src/wallet/services/account/service.ts:349` and independently accepts the RPC’s colliding identity. Threading one checked `nodeInfo` snapshot closes the earlier refetch race, but preserves whatever the insufficient check accepted. The local loopback restriction authenticates neither the responding process nor its reported chain.

10. **Instances:** The shared insufficient check is `packages/aztec-runtime/src/utils/chain-identity.ts:54`–`:56`; `chainInfoFrom` at `:69` forwards exact values without validation. Its production consumers are:

    - `apps/extension/src/wallet/services/execution/service.ts:230` and `:875`.
    - `apps/extension/src/wallet/services/execution/tx-request-builder.ts:221` and `:407`; the standard account-building sink is `:277`.
    - `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:854`, followed by authwit creation at `:863`.
    - `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:109`.
    - `apps/extension/src/wallet/services/execution/discovery-probe.ts:74`.
    - `apps/extension/src/wallet/services/execution/fast-path.ts:179`.
    - `apps/extension/src/wallet/services/execution/view-executor.ts:211`.
    - `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:204` and `:362`, feeding the account request builder at `:538`.

    These include both direct signing sinks and consumers that prepare chain-bound simulation/discovery material.

    An additional production caller omits the guard entirely: `apps/extension/src/wallet/services/token/service.ts:711`, `:716`, and `:720` call `simulate`; `apps/extension/src/wallet/utils/fn.ts:85` builds an account request using unchecked `node.getNodeInfo()` at `:94`. This branch is reachable: metadata descriptors explicitly select PUBLIC or PRIVATE functions at `apps/extension/src/wallet/services/token/functions/descriptors.ts:152`. Thus fixing the shared helper alone will not cover every caller.

### F-2: A tampered account row can redirect an authorized lookup to another imported signer

1. **Title:** Imported account loading verifies the signer against the row body, not the requested account address.

2. **Impact factors:** Violates account authorization and signature integrity within one profile. An operation authorized for account A can receive a signature from imported account B. The attacker needs write access to the account metadata storage root, but does not need the password, DEK, signing key, or write access to the encrypted-key root. For a dApp request, timing matters: account A must have passed selection before its row is replaced. This increases attack complexity. Transaction effects depend on the requested calls; the demonstrated primitive is selection of B’s signer for an A lookup.

3. **Evidence confidence:** **High** for the account substitution. An in-memory reproduction used the production account-loading methods and actual imported-key AES-GCM implementation. Storage and the address-construction factory were stubbed; no end-to-end Schnorr signature or live transaction was executed.

4. **OWASP / CWE mapping:** [OWASP A01:2025 — Broken Access Control](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/); CWE-863, Incorrect Authorization, included in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:** The attacker replaces the value under A’s canonical key in the account root declared at `apps/extension/src/wallet/services/account/spec.ts:10`. `getAccountContract(P, C, A)` reads that key at `apps/extension/src/wallet/services/account/service.ts:336`, checks only profile and chain at `:337`, then takes the imported branch at `:340` → `loadImportedAccountContract` selects the encrypted-key row using the body’s address B at `:368`, decrypts using B at `:378`, and compares the reconstructed address only with body B at `:384` → `executeAztecCreateAuthWit`, which requested A at `apps/extension/src/wallet/services/execution/service.ts:869`, uses the returned account at `:935` → `packages/aztec-runtime/src/account/nulo-account.ts:134` invokes B’s signing provider.

6. **Missing control and recommended fix:** Every keyed Account read must verify the complete requested tuple, including address, before branching or using body fields to select another resource. Add a shared check equivalent to `accountRowIdOf(row) === requestedRowId`. Independently require the returned imported contract address to equal the original requested address. Reject the affected imported account under the A4 policy; do not convert this into a profile-wide derivation failure.

   Add one regression covering two valid imported accounts in the same profile/chain: put B’s account body under A’s key, leave both encrypted-key rows untouched, and assert that requesting A fails.

7. **Failure scenario:** Profile P has accounts A and imported B on chain C. A dApp request resolves and is authorized for A. After that resolution, a storage writer places B’s valid Account body under A’s account key; B’s real account and encrypted-key rows remain intact. Execution subsequently calls `getAccountContract(P, C, A)`. The profile/chain check passes because B belongs to P and C. The imported branch loads B’s authentic ciphertext from B’s original key, decrypts it with B’s correct HKDF context, reconstructs B, and returns it. Execution signs using B without checking that its address is A.

   The in-memory reproduction also confirmed that directly transplanting B’s ciphertext into A’s cryptographic context fails. The substitution succeeds by redirecting the lookup, without defeating AES-GCM.

8. **Preconditions:** An imported account B with a usable encrypted key exists in the active profile and chain. The attacker can write raw account metadata. For the dApp trace, the operation has already selected A before the replacement and later resolves its signer again. A freshly dispatched request after persistent corruption is generally stopped by the account-list filter; that timing constraint is material.

9. **Why mitigations fail:** `AccountSchema` validates the body’s shape but does not bind it to its storage key. Account storage is instantiated without a composite identity check at `apps/extension/src/wallet/services/account/service.ts:84`; the generic storage check is optional at `packages/wallet-core/src/storage/entity_storage.ts:154`. `liveRows` correctly rejects key/body disagreement at `apps/extension/src/wallet/services/account/service.ts:103`, but direct signer loading does not use that filter. The integrity coordinator skips imported accounts at `apps/extension/src/wallet/services/account-integrity/coordinator.ts:152`. The key repository and HKDF correctly authenticate B because the corrupted Account body has already redirected both checks to B. The derived-account branch’s comparison against the original requested address at `apps/extension/src/wallet/services/account/service.ts:351` is bypassed by the imported branch’s early return.

10. **Instances:** The signing defect is the combination of `apps/extension/src/wallet/services/account/service.ts:337`, `:341`, `:368`, and `:384`. The same incomplete keyed-row identity check appears in `getAccount` at `:180`, metadata mutation at `:322`, and export lookup at `:407`. Metadata mutation can additionally write the loaded body under B’s key at `:327` while holding A’s lock. Export’s imported-key lookup uses the original requested address at `:418`, so that method does **not** independently demonstrate the same imported-signer substitution; it still shares the missing Account identity validation.

    Signing consumers include `apps/extension/src/wallet/services/execution/service.ts:869`/`:935` and `apps/extension/src/wallet/services/execution/tx-request-builder.ts:216`/`:277`. The defect is centralized in AccountService and affects callers that trust its returned account identity.

## Non-findings

- **NF-1 — Derivation uses the exact L1 input, not the XOR composite; confidence high.** Creation obtains it through `resolveVerifiedL1ChainId` and passes it to the KDF at `apps/extension/src/wallet/services/account/service.ts:267`; signing re-derives from the account row at `:349`; integrity uses the same row-carried value at `apps/extension/src/wallet/services/account-integrity/coordinator.ts:56`. Seeded networks enforce their L1 constants; custom networks compare a single stored snapshot with a live probe at `apps/extension/src/wallet/services/network/service.ts:374`. Changing only an existing derived row’s L1/index produces an address mismatch. Custom-network verification remains dependent on the chosen RPC’s truthfulness, and these controls do not close F-1.

- **NF-2 — Import does not re-derive an account seed from the export’s L1; confidence high.** Imported accounts reconstruct directly from the supplied signing key. The destination Account row receives the selected network’s stored L1 at `apps/extension/src/wallet/services/account/service.ts:485`; `decodeAccountExport` discards the parsed source L1 at `:731`. Consequently, importing the same key onto another network is permitted, and the source/destination L1 difference is not presented by this preview. This is account portability, not proof that the destination RPC’s identity has been authenticated.

- **NF-3 — Direct sealed-key transplantation is rejected, and recovery failures follow A4; confidence high.** HKDF binds the DEK, composite chain ID, and address at `packages/wallet-crypto/src/imported-account-key-box.ts:26`; AES-GCM checks that derived context at `:70`. Independent profile DEKs prevent ciphertext reuse across profiles even when their recovery phrase is shared. The key repository checks all three row identity fields at `apps/extension/src/wallet/services/account/imported-keys-repository.ts:28`. Loading errors become `ImportedAccountUnusableError`, with no derived-key fallback or profile-wide integrity block, at `apps/extension/src/wallet/services/account/service.ts:367`. Temporary DEK/key byte buffers are wiped at `:392`. F-2 redirects the legitimate lookup rather than breaking these cryptographic checks.

- **NF-4 — Import verifies key/address consistency before persistence; confidence high.** The decoder reconstructs the account from the signing key and rejects a claimed-address mismatch at `apps/extension/src/wallet/services/account/service.ts:734`. Import then checks the recomputed address against the confirmed address at `:473`, before sealing at `:491`, writing the key at `:497`, or writing the Account row at `:511`. The decoder also caps the supplied body at `:727`.

- **NF-5 — The encrypted export authenticates every envelope field; confidence high.** Address, exact `l1ChainId`, regime identifiers/digests, signing key, and checksum are all inside the serialized ciphertext at `packages/aztec-runtime/src/account/account-export.ts:148`. Fixed purpose AAD at `:35` is sufficient; those fields need not also be duplicated in AAD. Encryption uses PBKDF2-HMAC-SHA256 with 600,000 iterations, AES-256-GCM, and a random 12-byte IV at `packages/wallet-crypto/src/encryption-key.ts:6`, `:15`, and `:42`. No unauthenticated identity field outside the encrypted payload was found.

- **NF-6 — Plaintext exports provide consistency, not provenance authentication; confidence high.** A replacement signing key with its own correct address and checksum is accepted by the documented posture at `packages/aztec-runtime/src/account/account-export.ts:16`. Preview returns the recomputed address at `apps/extension/src/wallet/services/account/service.ts:741`; the UI submits that full value for confirmation at `apps/extension/src/popup/pages/settings/accounts/import.vue:114` and invalidates it when the file/password changes at `:144`. The visible preview is abbreviated at `:227`. A self-consistent replacement supplied before preview therefore remains possible; the confirmation comparison is not an independent authentication of the original account. No practical abbreviated-address impersonation was demonstrated.

- **NF-7 — Export requires fresh service-side credentials; confidence high.** Export authenticates the supplied password through `exportPlain` at `apps/extension/src/wallet/services/account/service.ts:413`. Imported-key export additionally unseals the DEK using that supplied credential at `:422`, rather than relying on an already unlocked session. Plaintext output contains the signing key by design; it is not a seed/privacy-key mix-up.

- **NF-8 — Runtime uses the frozen inputs, but does not recompute their pinned digests; confidence high.** Account construction uses the vendored artifact and fixed descriptor at `packages/aztec-runtime/src/account/nulo-account.ts:90`; first initialization uses the same descriptor’s constructor builder at `:233`. However, `packages/aztec-runtime/src/account/frozen-artifact.ts:25` loads the JSON without asserting its SHA/class-ID constants; descriptor and KDF digests are test pins at `instantiation-descriptor.ts:61` and `address-freeze.ts:68`. Integrity re-derives addresses rather than hashing those artifacts. Import compares supplied digest labels with build constants at `account-export.ts:106`. Thus the requested claim that all digests are enforced by runtime recomputation is false. No attacker-controlled runtime artifact/descriptor selection path was established, so this is not a separate vulnerability.

- **NF-9 — No alternate wallet-account address derivation bypass was found; confidence high.** The account construction match is `packages/aztec-runtime/src/account/nulo-account.ts:90`. Other production matches serve privacy-key registration at `packages/aztec-runtime/src/pxe/service.ts:387`, sponsored/private FPC construction at `apps/extension/src/wallet/services/fpc/service.ts:113`, `:114`, `:212`, and `:217`, known FPC registration at `packages/aztec-runtime/src/pxe/known-artifacts.ts:34`, or generic contract-address validation at `apps/extension/src/wallet/services/execution/service.ts:693`.

- **NF-10 — No concrete chunk-boundary authorization or fee-payer bypass was found; confidence moderate.** Chunking preserves head/tail call order, supplies each nested entrypoint with its own nonce and `EXTERNAL` fee option, and carries forward witnesses, capsules, and hashed arguments at `packages/aztec-runtime/src/account/nulo-account.ts:201`. The caller’s outer options reach the final entrypoint at `:184` or `:228`. The pinned upstream entrypoint hashes the encoded application payload and binds its outer authwit to account and chain metadata. [Aztec v5.2.0 account entrypoint](https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v5.2.0/yarn-project/entrypoints/src/account_entrypoint.ts). This conclusion does not certify every arbitrary fee-metadata combination; the concrete chain-check gap is reported in F-1.

- **NF-11 — PXE receives privacy material, not the account seed or Schnorr signing key; confidence high for the dataflow.** The local derivation is seed → signing key → privacy secret at `packages/wallet-crypto/src/account-derivation.ts:31`. `NuloAccount` passes only that privacy secret and partial address at `packages/aztec-runtime/src/account/nulo-account.ts:106`. The PXE service derives and forwards four privacy secret keys plus message-signing/fallback public keys at `packages/aztec-runtime/src/pxe/service.ts:387`. No reverse derivation of the signing key or seed was found. This is a cryptographic dataflow boundary, not isolation against arbitrary offscreen code execution: same-extension offscreen contexts are trusted internal senders under `packages/extension-messaging/src/core/sender-auth.ts:17`.

- **NF-12 — A profile B session does not directly unlock profile A’s signing material; confidence high.** Row lookups check profile and chain at `apps/extension/src/wallet/services/account/service.ts:337`; secret access requires the requested profile to match the active session at `apps/extension/src/wallet/services/profile/session-manager.ts:214` and `:226`. Metadata reads/name/visibility edits are not themselves active-session-gated at `apps/extension/src/wallet/services/account/service.ts:162`, `:177`, and `:313`, so “every mutation requires the active profile” would overstate the implementation. No untrusted dApp route to those metadata methods was established. F-2 operates inside the same active profile.

- **NF-13 — The account ID codec rejects noncanonical aliases; confidence high.** JSON tuple encoding avoids delimiter ambiguity at `apps/extension/src/wallet/services/account/spec.ts:25`, and `parseAccountRowId` requires byte-identical re-encoding at `:58`. In-memory checks confirmed canonical tuple round-trips and rejection of whitespace, negative-zero, alternate numeric encoding, and overflow aliases. The parser does not compare a separate row body with the decoded identity; that missing check is F-2, not an encoding collision.

## Handoff edges followed

- **Bridge → execution:** `packages/wallet-bridge/src/dispatcher.ts:979` constructs and dispatches account-scoped authwit requests to `apps/extension/src/wallet/services/execution/service.ts:866`. Its account-list resolution at `dispatcher.ts:1548` was inspected to establish F-2’s timing constraint.
- **Account service → credential service:** Derived signing obtains the active profile secret through `apps/extension/src/wallet/services/profile/service.ts:2032`; imported signing obtains the active profile DEK through `:1871`. Immediate session checks were inspected.
- **Popup → account service:** Export and import RPC callers were traced through their service implementations, including preview recomputation and full-address confirmation.
- **Account → PXE:** `packages/aztec-runtime/src/account/nulo-account.ts:106` was followed to `packages/aztec-runtime/src/pxe/service.ts:379` to identify the exact key material crossing the seam.
- **Token metadata → account request construction:** `apps/extension/src/wallet/services/token/service.ts:711` was followed through `apps/extension/src/wallet/utils/fn.ts:85` to confirm that an actual production caller omits the chain guard.

Validation used source inspection and in-memory probes of the production chain guard, account-loading methods, imported-key encryption, and account ID codec. The full repository suite was not run: this worktree lacks installed dependencies, and the available canonical-clone dependencies differ from the audited pin. No files were written or modified.

## Cross-rebuttal

**1. Its findings, one line each**

- **Claude F-1 — CONFIRM, high confidence:** `packages/aztec-runtime/src/utils/chain-identity.ts:55` checks only XOR equality; `apps/extension/src/wallet/services/execution/service.ts:876` then uses the accepted exact fields for authwit metadata. Exact-L1 endpoint checks at `apps/extension/src/wallet/services/network/service.ts:568` do not protect subsequent signing.
- **Claude F-2 — DOWNGRADE to a conditional hardening observation:** Truncation is confirmed at `apps/extension/src/popup/pages/settings/accounts/import.vue:227` and `apps/extension/src/utils/string.ts:13`, but its exploit step 2 assumes a practically affordable targeted vanity-key search without benchmarks or a demonstrated matching key. The display weakness is established; “moderately resourced” exploitability is not.

**2. What it missed**

- **My F-2: imported signer substitution.** `apps/extension/src/wallet/services/account/service.ts:337` checks profile/chain but omits the requested address. Its imported branch then selects the key using the body’s address at `:368` and checks the reconstructed address against that same body at `:384`. Replacing A’s Account body with B’s can therefore return B’s authentic imported signer for an A lookup. Ciphertext transplantation defenses remain intact because B’s ciphertext never moves.
- **My F-1 includes an entirely unguarded production caller.** `apps/extension/src/wallet/services/token/service.ts:711` calls metadata simulation; `apps/extension/src/wallet/utils/fn.ts:85` builds an account request using unchecked node identity at `:94`. These metadata functions are PUBLIC/PRIVATE at `apps/extension/src/wallet/services/token/functions/descriptors.ts:152`. Its assertion that call-site coverage is complete is false.

**3. What I missed**

No additional vulnerability adopted. I already recorded the truncated preview in my NF-6, but its report more clearly connects that truncation to the explicit confirmation instruction at `apps/extension/src/popup/pages/settings/accounts/import.vue:251`. I **adopt that clarification with high confidence**, while keeping practical impersonation unproven.

Its restore analysis adds useful negative evidence: `apps/extension/src/wallet/services/profile/service.ts:2628` routes finalization through session verification, which invokes account integrity at `:1232` when the delegate is installed. That supports excluding ordinary completed backup import as sufficient to establish my F-2; my finding requires raw storage tampering.

**4. Overconfidence in either report**

- Its A4 non-finding incorrectly says imported export performs address-mismatch checking and converts every decryption failure into `ImportedAccountUnusableError`. Export decrypts at `apps/extension/src/wallet/services/account/service.ts:426` with only a `finally` at `:431`; it neither reconstructs the address nor catches that failure into the typed error. Failure still stops export, so this correction is not another vulnerability.
- Its “no path reads another profile’s row” exceeds the evidence: `apps/extension/src/wallet/services/account/service.ts:177` accepts an explicit profile ID without requiring that profile’s active session. Signing isolation additionally depends on `apps/extension/src/wallet/services/profile/session-manager.ts:214` and `:226`.
- **My F-2 remains conditional:** fresh bridge resolution filters malformed rows through `packages/wallet-bridge/src/dispatcher.ts:1548` and `apps/extension/src/wallet/services/account/service.ts:103`. The dApp scenario needs replacement after account selection. My reproduction proved resolver substitution using an address-factory stub, not an end-to-end unauthorized transaction.
- **Both F-1 reports establish wrong-chain signed material, not demonstrated theft.** Choosing an alternative L1 fixes the colliding version; it does not permit any independently chosen pair or prove that an existing funded deployment accepts the signature.

**5. Net position**

- **Codex F-1 — Exact chain identity remains unenforced at signing, including an unguarded metadata caller — high confidence.**
- **Codex F-2 — Account key/body disagreement redirects an authorized lookup to another imported signer — high confidence in the resolver defect; end-to-end exploitation remains conditional.**

Claude F-2 remains a documented display weakness pending stronger exploitation evidence.