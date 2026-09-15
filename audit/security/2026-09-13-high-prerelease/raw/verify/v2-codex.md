Verified against `62f3456a`. Independent conclusions were recorded before reading the full traces. Verification included source inspection and in-memory checks using extracted source functions, native WebCrypto, and mocked storage. No files were modified or `node_modules` accessed. Browser/authenticator and OPFS end-to-end tests were not run.

### F-05 — Passkey wallet master is reproducible by an RP-eligible web origin

**Independent read (before reading the trace):**

- `apps/extension/src/wallet/services/passkey/spec.ts:21` selects `nulo.sh`; `apps/extension/src/wallet/utils/passkey-ceremony.ts:68-86` requests that RP, requires user verification, and permits credential discovery.
- `apps/extension/src/wallet/utils/passkey-ceremony.ts:33-36` hashes the public label from `packages/wallet-crypto/src/constants.ts:10` into a constant PRF input.
- `apps/extension/src/wallet/utils/passkey-ceremony.ts:131-135` returns the credential ID and PRF output.
- `packages/wallet-crypto/src/passkey-credential.ts:49-92` derives the master entirely from those values and public constants. No extension-exclusive secret, origin, or profile identifier enters the derivation.

**Verdict:** **CONFIRMED.**

**Comparison with the full trace:** The derivation claim matches the independent read. The web-origin reachability also follows from WebAuthn’s RP-domain rules and credential-associated PRF semantics. This establishes the mechanism; it does not establish that any Nulo website is currently compromised. [WebAuthn RP scoping](https://www.w3.org/TR/webauthn-3/#relying-party-identifier), [PRF specification](https://www.w3.org/TR/webauthn-3/#prf-extension).

**Strengthened trace:**

1. **Precondition:** Script runs on an eligible HTTPS origin, such as `nulo.sh` or its subdomain; the user selects the existing wallet credential and completes verification using a PRF-capable authenticator. Chrome permits extensions to use website RP IDs through host permissions, matching `apps/extension/manifest/manifest.config.ts:20`. [Chrome implementation announcement](https://lists.w3.org/Archives/Public/public-webauthn/2023Dec/0078.html).
2. The page supplies the same `publicKey` request options as `apps/extension/src/wallet/utils/passkey-ceremony.ts:68-86`: `rpId: "nulo.sh"` and `prf.eval.first = SHA256("nulo:profile:v1")`.
3. Successful authentication exposes `rawId` and `prf.results.first`, exactly the inputs collected at `apps/extension/src/wallet/utils/passkey-ceremony.ts:121-135`.
4. `packages/wallet-crypto/src/passkey-credential.ts:49-57` imports the PRF output into HKDF and computes the salt from `"nulo:kdf:v1"` plus the credential ID.
5. `packages/wallet-crypto/src/passkey-credential.ts:79-92` expands with `"nulo:master:v1"` and reduces the result into the wallet master.

User verification gates credential use. Random challenges protect assertion freshness. Neither introduces a secret into the master derivation. Extension sender checks and CSP do not mediate a separate website’s ceremony.

**Verification result:** Executing the extracted option builders produced identical PRF inputs across different random challenges, with `rpId: "nulo.sh"`, required verification, and no credential allow-list when the ID was omitted.

**Severity check:** **Keep High.** Successful exploitation exposes the derived-account master, but requires control of an eligible origin and user participation.

**Fix check:** A dedicated, application-free RP subdomain is a small mitigation for exposure through the parent and sibling application sites. It narrows eligible web origins; it does **not** create extension-exclusive cryptographic isolation.

Update the RP constant and matching host permission together. The existing validator already consumes the configured RP dynamically at `apps/extension/scripts/check-rp-id.ts:34` and `apps/extension/src/wallet/services/passkey/check-rp-id.ts:27-44`; its implementation does not inherently need changing.

Changing the RP makes existing credentials inaccessible through the new configuration, as documented at `apps/extension/src/wallet/services/passkey/spec.ts:6-15`. Existing wallets therefore require an explicit recovery transition.

**Confidence:** **High** in the mechanism: source and specification agree. Physical-authenticator interoperability remains untested.

### F-06 — Same-master profiles lack independent session-MAC and PXE-key protection

**Independent read (before reading the trace):**

- `apps/extension/src/wallet/services/profile/service.ts:913-928` uses `profileId` only to retrieve the master; both HKDF labels are fixed. Identical masters therefore produce identical MAC keys.
- `apps/extension/src/wallet/services/dapp-session/integrity.ts:30-65` authenticates the whole row, including `profileId`; changing that field without recomputing the MAC still fails.
- `packages/wallet-crypto/src/pxe-store-key.ts:29-34` produces different keys for different profile IDs, but anyone holding the shared master can calculate either key.
- Duplicate-master profiles are supported through `allowDuplicate` at `apps/extension/src/wallet/services/profile/service.ts:2004-2015`. Normal API access still enforces the active-profile boundary.

**Verdict:** **CONFIRMED.**

**Comparison with the full trace:** Both cryptographic claims match. The consolidated trace correctly requires forging a new MAC rather than merely copying a row. Its statement that both protections become “same master ⇒ same key” needs narrowing: MAC keys coincide; PXE keys remain distinct but mutually derivable.

**Strengthened trace:**

1. **Precondition:** Profiles A and B share a master. The attacker knows that master and can write extension storage for the MAC branch, or read B’s OPFS data for the storage branch. Same-phrase imports derive their master at `apps/extension/src/wallet/services/profile/service.ts:1616-1620`; the duplicate override permits coexistence at `:2004-2015`.

2. **MAC source → gap → sink:**
   - Derive the master-only key using `apps/extension/src/wallet/services/profile/service.ts:913-928`.
   - Construct a valid B-scoped session with the chosen origin, grants, accounts, chain and unexpired lifetime; sign it using `apps/extension/src/wallet/services/dapp-session/integrity.ts:50-52`.
   - When B is unlocked, `apps/extension/src/wallet/services/dapp-session/mac-storage.ts:94-104` accepts the recomputed MAC.
   - `apps/extension/src/wallet/services/dapp-session/service.ts:128-137` matches B, origin and chain.
   - `apps/extension/src/wallet/services/wallet-sdk/background.ts:647-650` takes the existing-session discovery path. `packages/wallet-bridge/src/dispatcher.ts:650-655` and `:1354-1369` consume the stored grants.

3. **PXE source → gap → sink:**
   - Compute B’s key from the shared master and B’s public ID using `packages/wallet-crypto/src/pxe-store-key.ts:29-34`.
   - This matches B’s legitimate provisioning calculation at `apps/extension/src/wallet/runtime.ts:542-544`.
   - The key reaches the encrypted store through `packages/aztec-runtime/src/pxe/chain-runtime.ts:158-163` and `packages/aztec-runtime/src/pxe/opfs-store.ts:102-120`.
   - Imported-account privacy material reaches PXE through `apps/extension/src/wallet/services/account/service.ts:378-383`, `packages/aztec-runtime/src/account/nulo-account.ts:77-79,102-106`, and `packages/aztec-runtime/src/pxe/service.ts:386-398`. Actual extraction from an existing database was not exercised.

**Existing controls:** `apps/extension/src/wallet/services/profile/session-manager.ts:214-219` prevents requesting B’s secret through A’s active session. That does not prevent offline derivation by someone already holding the master. Schema validation and signed profile fields remain effective against edits without a valid replacement MAC. Transaction confirmation remains enforced: the schema restricts confirmation levels to the enum at `apps/extension/src/wallet/services/dapp-session/spec.ts:84`, whose maximum is `Transactions = 5`, and `apps/extension/src/wallet/services/dapp-interaction/service.ts:586-589` requires confirmation at that level.

**Verification result:** Extracted source functions demonstrated:

- A’s MAC verifies with B’s same-master key.
- Editing `profileId` without re-signing fails.
- Re-signing the B row with A’s key succeeds.
- A’s and B’s PXE keys differ, while A’s shared master reproduces B’s exact key.

**Severity check:** **Keep Medium.** The separation failure is concrete, but requires the shared master plus storage access; the traced session forgery preserves transaction confirmation.

**Fix check:** Mixing the independently generated profile DEK into both derivations addresses this attacker. Mirror the fixed-length concatenation, separate HKDF domain and zeroization in `packages/wallet-crypto/src/entropy-mac.ts:61-82`. Adding only `profileId` would not prevent a shared-master holder from deriving B’s key.

The proposed fix needs lifecycle handling: DEK-less sessions cannot derive these keys, and DEK regeneration at `apps/extension/src/wallet/services/profile/service.ts:1027-1029` would invalidate existing session tags and PXE encryption keys. The current PXE store covers the whole profile/chain; protecting only imported-account data would require additional storage separation.

**Confidence:** **High** for key derivability and MAC forgery, supported by executable checks and source traces. OPFS plaintext extraction was not tested.

### F-07 — Auth-registry operations discard profile and chain provenance

**Independent read (before reading the trace):**

- `apps/extension/src/wallet/services/auth-registry/spec.ts:24-53` has neither `profileId` nor `chainId`; `service.ts:71-82` creates global stores.
- `apps/extension/src/wallet/services/auth-registry/service.ts:132-134,428-448` reads and purges by address alone.
- `apps/extension/src/wallet/services/account/service.ts:689-719` accepts a valid account row with an existing address under a new profile without proving key ownership.
- Reconciliation deletes a keyless imported row and emits its deletion at `apps/extension/src/wallet/services/account/service.ts:835-854`; the auth listener drops its profile/chain context at `apps/extension/src/wallet/services/auth-registry/service.ts:97-99`.

**Verdict:** **CONFIRMED.**

**Comparison with the full trace:** The hostile-backup, profile-deletion, cross-network synchronization and address-only read paths match. The reconciliation purge is asynchronous, so deletion is eventual rather than guaranteed before the reconciliation call returns. These paths delete local records, not on-chain authorizations.

**Strengthened trace:**

1. **Precondition:** P1 has an authwit for address A. The user imports an otherwise-valid backup into P2 containing an `Imported` account for A, valid network/schema fields, and no matching imported-key row. P1’s secret and a shared mnemonic are unnecessary.
2. `apps/extension/src/composables/useFullBackupImport.ts:485` remaps child profile IDs to P2. Account restoration at `:170` reaches `apps/extension/src/wallet/services/account/service.ts:689-719`: the full tuple does not collide with P1, and the row is stored.
3. Missing imported-key data does not reject the account stage: restoration is conditional at `apps/extension/src/composables/full-backup-restore.ts:352-356`.
4. `apps/extension/src/composables/useFullBackupImport.ts:534` calls reconciliation. `apps/extension/src/wallet/services/account/service.ts:837-851` detects the missing key, deletes P2’s account and emits `onAccountDeleted`.
5. Local event dispatch occurs at `packages/extension-messaging/src/core/base-service.ts:129-131`. The listener at `apps/extension/src/wallet/services/auth-registry/service.ts:97-99` passes only A to the purge.
6. `apps/extension/src/wallet/services/auth-registry/service.ts:432-446` deletes every matching authwit and status flag, including P1’s.

The other cited paths also hold:

- **Profile deletion:** `apps/extension/src/wallet/services/profile-deletion/coordinator.ts:120` invokes the same unscoped purge.
- **Cross-network sync:** `apps/extension/src/wallet/services/auth-registry/service.ts:303-305` selects a node, `:349-350` loads every row for A, and `:365-372` deletes confirmed rows when that node reports no authorization. The node read is at `apps/extension/src/wallet/utils/auth-registry.ts:51-57`. Pending rows are preserved.
- **Cross-profile display:** `apps/extension/src/popup/pages/settings/advanced/account-state/authwits/index.vue:47,55` fetches and accepts rows using address alone.

**Existing controls:** Schema validation, tuple collision checks, profile-ID remapping and restore deletion fences protect their respective boundaries. None supplies ownership provenance to the address-only purge.

**Verification result:** Extracted reconciliation, event, and purge code deleted P1’s authwit and status while preserving P1’s account and unrelated-address records. A separate check confirmed that synchronization deletes a confirmed row on a false consumability response while preserving a pending row.

**Severity check:** **Keep Medium.** A crafted backup can destroy another profile’s local revocation index without its keys; no grant is created or revoked by this trace.

**Fix check:** Full `(profileId, chainId, account)` scoping is necessary across reads, writes, statuses, purges, synchronization, reconciliation, deduplication and backup handling. Mirror the awaited, scoped purge in `apps/extension/src/wallet/services/token-balance/service.ts:147,574-598` and composite identity pattern at `apps/extension/src/wallet/services/account/spec.ts:25-31`.

Do **not** blanket-skip auth cleanup merely because the account is keyless: authwit slices may already have been restored at `apps/extension/src/composables/useFullBackupImport.ts:524`, before reconciliation at `:534`. Correct scoping removes the cross-profile deletion without assuming those records cannot exist. Legacy rows also lack enough provenance for an automatic, unambiguous reassignment.

**Confidence:** **High.** Source and in-memory execution reproduce the requested deletion path; full browser backup import was not run.