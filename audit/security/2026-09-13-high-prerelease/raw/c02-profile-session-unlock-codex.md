Files read: all existing assigned cluster sources in full; both session-manager suites in full; selected profile integration cases; supplied maps and bounded crypto, messaging, PXE, and dApp consumers.  
Findings: 5.  
Non-findings: 18.

### F-1: Same-phrase profiles share the key that authenticates dApp permissions

1. **Title:** A sibling profile’s master can forge another profile’s dApp-session MAC.

2. **Impact factors:** Violates authorization and permission-record integrity. An attacker can fabricate remembered connections and capability grants for a victim profile, including grants concerning imported accounts. Requires the shared master, write access to local extension storage, and a subsequent dApp connection while the victim profile is unlocked. Victim-password or victim-DEK knowledge is unnecessary. Transaction confirmations remain enforced; this review does **not** establish silent fund transfers.

3. **Evidence confidence:** **High.** An in-memory probe using the extracted production derivation method and production MAC functions confirmed that a MAC produced using sibling A’s master verifies as victim B’s MAC.

4. **OWASP / CWE mapping:** OWASP A01:2025 Broken Access Control; CWE-863 Incorrect Authorization, included in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html). Category names follow [OWASP Top 10:2025](https://top10.owasp.org/2025/).

5. **Trace:** Attacker-controlled rows enter `nulo:core:dappSessions` through local storage, configured at `apps/extension/src/wallet/services/dapp-session/service.ts:66` → `DappSessionMacStorage.verifyOrDrop` obtains the claimed profile’s key and accepts a valid tag at `apps/extension/src/wallet/services/dapp-session/mac-storage.ts:94` and `:100` → that key is derived from **master alone**, with constant salt and info, at `apps/extension/src/wallet/services/profile/service.ts:913` → the matching origin/profile/chain row is returned at `apps/extension/src/wallet/services/dapp-session/service.ts:132` → the immediate consumer automatically approves discovery at `apps/extension/src/wallet/services/wallet-sdk/background.ts:647` and `:703`. Separately, dispatcher authorization consumes the forged `capabilityGrants` at `packages/wallet-bridge/src/dispatcher.ts:1354`.

6. **Missing control:** The authentication key contains no credential-protected, profile-specific secret. The random DEK should participate in this authorization boundary; adding only the public profile ID would not prevent an attacker who knows the master from computing another profile’s key.

7. **Exploit story:** Create/import A and B from the same phrase using different passwords. Obtain A’s master using A’s legitimate credentials. Construct a schema-valid dApp-session row naming B, the attacker’s origin, the desired chain/accounts/grants, and a future expiry. Compute its MAC with the published master-only KDF and place it in local storage. When B is unlocked, its verifier accepts the row and the attacker’s discovery receives automatic approval.

8. **Preconditions:** Same-phrase profiles; attacker knows the phrase or A’s password and encrypted row; local-storage write access; B subsequently unlocked; victim visits the attacker-controlled dApp.

9. **Why mitigations fail:** The MAC covers `profileId` and grants, but the attacker can recompute it. Non-extractable `CryptoKey` objects do not protect a key whose input is already known. Schema validation and origin/chain filters accept deliberately matching values. The duplicate-wallet warning permits duplicates by design. The independent confirmation check at `apps/extension/src/wallet/services/dapp-interaction/service.ts:587` limits the impact on fund-moving operations.

10. **Instances:** Root derivation: `apps/extension/src/wallet/services/profile/service.ts:913`. Shared signing/verification consumers: `apps/extension/src/wallet/services/dapp-session/mac-storage.ts:30`, `:85`; `apps/extension/src/wallet/services/dapp-session/integrity.ts:50`, `:56`. Affected authorization consumers include `apps/extension/src/wallet/services/wallet-sdk/background.ts:647`, `:725`, and `packages/wallet-bridge/src/dispatcher.ts:1354`.

### F-2: A sibling master decrypts the victim profile’s PXE privacy store

1. **Title:** PXE encryption bypasses the per-profile DEK isolation boundary.

2. **Impact factors:** Violates confidentiality of imported accounts’ privacy keys and PXE data. A disk reader possessing a same-phrase sibling’s master can derive the victim’s database key offline. This exposes viewing/tagging/nullifier-hiding secrets, not imported signing keys. The victim need not be currently unlocked, and no interaction is required after the attacker obtains the files and sibling credential.

3. **Evidence confidence:** **High.** The production KDF probe confirmed that A’s master plus B’s public ID reproduces B’s PXE key. Production wiring and the installed PXE dependency confirm that the encrypted database contains account privacy keys. No live OPFS database was decrypted during this review.

4. **OWASP / CWE mapping:** OWASP A04:2025 Cryptographic Failures; CWE-200 Exposure of Sensitive Information to an Unauthorized Actor, included in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html). The underlying defect is missing secret separation between profiles. See [OWASP A04:2025](https://top10.owasp.org/2025/A04_2025-Cryptographic_Failures/).

5. **Trace:** The provider obtains the profile master and derives the store key at `apps/extension/src/wallet/runtime.ts:542` and `:544` → `packages/wallet-crypto/src/pxe-store-key.ts:29` derives `HKDF(master, public profileId, constant info)` → that key opens the encrypted database at `packages/aztec-runtime/src/pxe/opfs-store.ts:120`. The separate data handoff is concrete: imported accounts derive privacy secrets at `packages/aztec-runtime/src/account/nulo-account.ts:77`, register them at `:106`, and `packages/aztec-runtime/src/pxe/service.ts:388` forwards the four privacy keys. The installed PXE creates its key store on the same backing store at `packages/aztec-runtime/node_modules/@aztec/pxe/src/storage/open_pxe_stores.ts:48`.

6. **Missing control:** PXE encryption needs secret input unavailable to a same-phrase sibling, such as the credential-protected random DEK or a separately protected store key. Public IDs separate outputs but do not prevent their computation by someone holding the shared master.

7. **Exploit story:** B imports an external account and uses it, causing its privacy keys to enter PXE storage. The attacker obtains A’s master and copies B’s encrypted OPFS files. Using B’s visible profile ID, the attacker runs the existing PXE KDF, opens the copied database, and reads the imported account’s privacy keys.

8. **Preconditions:** Same-phrase A/B profiles; knowledge of A’s master; read access to B’s OPFS files and profile ID; B has previously registered the affected imported account with PXE.

9. **Why mitigations fail:** Imported signing-key ciphertext correctly uses B’s DEK, but the privacy secrets are subsequently persisted under a different, master-derived key. Generation checks and active-profile checks constrain live provisioning; they do not constrain offline derivation. Deleting B also cannot cryptographically erase retained database copies while the shared master remains available through A.

10. **Instances:** Root: `packages/wallet-crypto/src/pxe-store-key.ts:29`; provider: `apps/extension/src/wallet/runtime.ts:544`; encrypted-store consumer: `packages/aztec-runtime/src/pxe/opfs-store.ts:120`. Privacy-key persistence is confirmed at `node_modules/.bun/@aztec+pxe@5.2.0+9654951505f092be/node_modules/@aztec/key-store/src/key_store.ts:366`, which writes the incoming/outgoing viewing, tagging, and nullifier-hiding secrets.

### F-3: The website RP scope can yield the wallet’s passkey-derived master

1. **Title:** Code running on an RP-eligible website can request the wallet’s deterministic PRF output.

2. **Impact factors:** Violates confidentiality of the passkey wallet master and, consequently, control of its derived accounts. The attack requires JavaScript execution on `https://nulo.sh` or an eligible HTTPS subdomain and the victim completing a passkey ceremony. No extension compromise, extension RPC access, or local-storage access is needed to derive the master. Access to the sealed DEK would additionally expose imported-key material.

3. **Evidence confidence:** **Moderate.** The source and WebAuthn scope/PRF rules establish the mechanism. A real-authenticator website-to-extension credential exercise was not performed, and this report does not assert that any website is currently compromised.

4. **OWASP / CWE mapping:** OWASP A07:2025 Authentication Failures—incorrect credential audience/scope; CWE-863 Incorrect Authorization, listed in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html). See [OWASP A07:2025](https://top10.owasp.org/2025/A07_2025-Authentication_Failures/).

5. **Trace:** Credentials are created for `RP_ID = "nulo.sh"` at `apps/extension/src/wallet/services/passkey/spec.ts:21` and `apps/extension/src/wallet/utils/passkey-ceremony.ts:50` → the PRF input is the hash of public constant `"nulo:profile:v1"` at `packages/wallet-crypto/src/constants.ts:10` and `apps/extension/src/wallet/utils/passkey-ceremony.ts:33` → a website using the same credential/input receives the PRF result through the same WebAuthn output used at `apps/extension/src/wallet/utils/passkey-ceremony.ts:126` → credential ID plus PRF completely determine the wallet master at `packages/wallet-crypto/src/passkey-credential.ts:49` and `:73`.

6. **Missing control:** The ownership-root derivation has no extension-exclusive secret or credential scope. Extension `host_permissions` permit use of the website RP; they do not reserve that RP for the extension. [Chrome’s RP-ID announcement](https://lists.w3.org/Archives/Public/public-webauthn/2023Dec/0078.html) documents this sharing.

7. **Exploit story:** Malicious code on an RP-eligible origin requests a discoverable credential with `rpId: "nulo.sh"`, required user verification, and `prf.eval.first = SHA256("nulo:profile:v1")`. The victim selects the Nulo credential and completes verification. The page obtains the credential ID and PRF output, then independently runs Nulo’s published HKDF and field reduction. The resulting master can be used outside the extension.

8. **Preconditions:** A supported PRF authenticator holding the wallet credential; malicious code on an RP-eligible origin; victim consent to that website ceremony. Ordinary unrelated websites do not qualify.

9. **Why mitigations fail:** WebAuthn permits an HTTPS subdomain to use a registrable parent RP ID, and the PRF is associated with the credential rather than the challenge. Thus a fresh challenge does not produce a new ownership secret. These are specified behaviors, not a browser bypass. [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/#sctn-code-injection-attacks) explicitly discusses malicious subdomains exercising parent-scoped credentials; its [PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension) defines the deterministic output. The extension’s sender guard, profile credential-ID equality check, and CSP never run on this independent website ceremony. Checking an assertion afterward cannot retract a PRF already delivered to the page.

10. **Instances:** Shared RP: `apps/extension/src/wallet/services/passkey/spec.ts:21`; public PRF input: `packages/wallet-crypto/src/constants.ts:10`; creation/get options: `apps/extension/src/wallet/utils/passkey-ceremony.ts:38`, `:68`; master and DEK-wrap derivations: `packages/wallet-crypto/src/passkey-credential.ts:73`, `:109`. Both modal and separate-window ceremonies use these options.

### F-4: Expired passkey restore credentials survive lock and still open a session

1. **Title:** Finalization never enforces the pending passkey secret’s own TTL.

2. **Impact factors:** Violates authentication expiry and explicit-lock expectations. A previously authorized but delayed restore continuation can open a full session, including its DEK, after the 30-minute cache lifetime and after an explicit lock. Requires an unfinished passkey restore and the same surviving service worker. This is a concrete accidental authorization-lifetime violation; an arbitrary website cannot directly invoke finalization.

3. **Evidence confidence:** **High.** An in-memory harness executing the extracted production sweep, lock, and finalization methods confirmed that a 31-minute-old entry survived lock and reached `openSessionVerified` with its intact master and DEK. Storage and the downstream open were stubbed; this was not a browser integration test.

4. **OWASP / CWE mapping:** OWASP A07:2025 Authentication Failures; CWE-287 Improper Authentication, included in the permitted [2024 CWE Top 25](https://cwe.mitre.org/top25/archive/2024/2024_top25_list.html). The specific failure is acceptance of expired cached authentication.

5. **Trace:** Passkey restore stores master, DEK, and `capturedAt` at `apps/extension/src/wallet/services/profile/service.ts:2517` → `finalizeRestore` calls the sweep with the target ID excluded at `:2561`; the exclusion occurs at `:185` → `finalizePasskeyRestoreHoldingLock` retrieves the target without checking its age at `:2652` → it opens a session with the cached material at `:2681`. Explicit lock only closes `SessionManager` at `:856`. The production delayed caller is `apps/extension/src/composables/useFullBackupImport.ts:546`.

6. **Missing control:** Finalization needs an age check on the consumed entry, and explicit lock needs to clear or invalidate pending authentication material. `consumeDekRewrapContext` already performs the missing target-age check at `apps/extension/src/wallet/services/profile/service.ts:221`.

7. **Exploit story:** Begin a legitimate passkey backup restore. After the profile is created but before finalization, suspend or delay the import continuation while the worker remains alive. Explicitly lock the wallet and let more than 30 minutes elapse. Resume the original continuation. `finalizeRestore(id)` requires no credential parameter for passkey profiles and opens the profile using the expired stash.

8. **Preconditions:** An unconsumed pending restore; unchanged profile security fields; no intervening sweep targeting another profile that removes the entry; the worker survives; the delayed internal continuation resumes.

9. **Why mitigations fail:** The ordinary session alarm and read-time expiry apply to `SessionManager`, not this map. Row consistency and fingerprint checks establish identity, not freshness. Deletion clears the stash, and worker termination loses it, but explicit lock does neither. The existing TTL test at `apps/extension/src/wallet/services/profile/service.integration.test.ts:2295` exercises a **different restore** sweeping the abandoned entry, not finalization consuming its own expired entry.

10. **Instances:** Stash creation `apps/extension/src/wallet/services/profile/service.ts:2517`; sweep exemption `:185`; finalization exemption `:2561`; unchecked consumption/open `:2652`, `:2681`; lock omission `:853`. These are one cached-authentication lifetime defect.

### F-5: Deleting one profile erases a surviving sibling’s authwit index

1. **Title:** Profile deletion purges address-shared authorization records without checking surviving owners.

2. **Impact factors:** Violates integrity and availability of the local authorization/revocation index. Deleting A can remove authwit records and registry-status metadata still needed by B. On-chain grants remain unaffected; direct fund theft is not established. No storage tampering or malicious code is required—ordinary deletion of one same-phrase profile triggers the issue.

3. **Evidence confidence:** **High.** The production cascade passes addresses without a profile scope, and the immediate purge handler deletes every matching record.

4. **OWASP / CWE mapping:** OWASP A01:2025 Broken Access Control; CWE-863 Incorrect Authorization, included in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:** User-authorized deletion enters `apps/extension/src/wallet/services/profile/service.ts:1400` → the profile’s addresses are captured at `apps/extension/src/wallet/services/profile-deletion/coordinator.ts:86` and `:95` → the cascade calls `auth.purgeForAccounts(s.addresses)` without profile ownership at `:120` → `apps/extension/src/wallet/services/auth-registry/service.ts:432` selects all address-matching authwits and deletes them at `:435`, followed by registry-status deletion at `:446`. B reads that same address-shared collection through `:132`.

6. **Missing control:** Before deleting address-shared records, establish that no surviving profile owns that address, or represent and preserve ownership explicitly. An existing lookup for all owners is available at `apps/extension/src/wallet/services/account/service.ts:586`.

7. **Exploit story:** A and B share a phrase and therefore an account address on the same chain/index. B records a public authorization for that address. The user deletes A while retaining B. The cascade removes the shared authorization records; B’s next query returns an empty index although the on-chain grant still exists. Normal synchronization iterates existing records at `apps/extension/src/wallet/services/auth-registry/service.ts:349`, so it does not reconstruct the deleted hashes.

8. **Preconditions:** Two surviving profile representations share an address, and that address has tracked authwits or registry-status metadata. A is deleted while B remains.

9. **Why mitigations fail:** The tombstone correctly scopes which profile is being deleted, but its address snapshot contains no ownership/refcount information. Profile-scoped transaction and balance purges do not protect the separate auth registry. Account-row composite keys preserve B’s account while the address-only authorization cleanup removes its shared index.

10. **Instances:** Profile cascade: `apps/extension/src/wallet/services/profile-deletion/coordinator.ts:120`. Shared purge: `apps/extension/src/wallet/services/auth-registry/service.ts:428`, `:440`, `:446`. The standalone account-deletion subscription at `:97` calls the same address-only purge and has the same surviving-owner problem.

## Non-findings

- **NF-1 — Privileged RPC entry [high]:** The Port server checks the same-extension sender before attaching its message handler; content-script/web URLs fail the predicate. Method invocation is allowlisted. Evidence: `packages/extension-messaging/src/background/service.ts:45`, `packages/extension-messaging/src/core/sender-auth.ts:17`, `packages/extension-messaging/src/core/base-service.ts:94`. No direct web-to-profile/passkey RPC bypass was found.

- **NF-2 — Password unlock residency [high]:** Password enters from `apps/extension/src/popup/pages/auth.vue:107`, crosses the authenticated Port as a parameter, and is unsealed at `apps/extension/src/wallet/services/profile/service.ts:597`. SHA-256 passhash feeds PBKDF2-SHA256/600,000 and AES-GCM in `packages/wallet-crypto/src/encryption-key.ts:15`, `:112`, `:123`. Profile local storage receives ciphertexts, not plaintext passhash/master/entropy/DEK; the live master and DEK are retained by `SessionManager`.

- **NF-3 — Popup PRF trust and replay [high]:** Raw PRF **does reach the popup/onboarding ceremony context** and is returned as base64 at `apps/extension/src/wallet/utils/passkey-ceremony.ts:133`. `materializeCredential` accepts these caller-supplied bytes at `apps/extension/src/wallet/services/passkey/service.ts:86`; no freshness proof accompanies them. Captured PRF is replayable. Compromised trusted-popup replay is not reported separately from the accepted popup trust boundary; F-3 identifies a separate website-origin exposure.

- **NF-4 — Logs and events [high]:** Normal unlock/profile events contain profile metadata, and RPC diagnostics do not log params/results: `apps/extension/src/wallet/services/profile/service.ts:268`, `packages/extension-messaging/src/core/base-service.ts:107`, `:115`. Passkey resolution logs the credential ID, not PRF. No ordinary cluster path was found writing a master, PRF, passhash, or bearer into logs or profile-event payloads.

- **NF-5 — Bearer readers and strict mode [high]:** Production access to `nulo:core:session` is concentrated in `SessionManager`: existence/readback at `apps/extension/src/wallet/services/profile/session-manager.ts:413`, strict-mode cleanup at `:490`, and restoration at `:517`; runtime getters read memory. Only non-strict, non-degraded password sessions persist a bearer (`:267`). Strict mode defaults on; enabling it clears cached/persisted bearer fields (`:465`, `:726`). Privileged popup code could directly read session storage, but no normal popup bearer reader was found.

- **NF-6 — Ordinary session invalidation [high]:** Explicit lock closes and checks durable deletion (`apps/extension/src/wallet/services/profile/service.ts:853`); TTL closes at `session-manager.ts:824`; switching/finalizing replaces the single session at `:298`; deletion closes at `profile/service.ts:1429`; integrity failure closes at `:1246`. Silent restore rejects missing/deleted/torn/blocked profiles (`:463`, `:486`). Failed storage deletion can leave a record, but explicit lock reports failure; expired or otherwise invalid records are rejected on subsequent reads. F-4 concerns a separate pending-secret cache.

- **NF-7 — TTL fallback [high]:** Failed alarm creation does not remove expiry enforcement: `getActive`, secret/DEK reads, and boot restore check expiration at `apps/extension/src/wallet/services/profile/session-manager.ts:198`, `:214`, `:226`, `:530`. Expiry uses `Date.now()` and persisted timestamps (`:663`), so backward clock movement can extend effective lifetime; it is not a monotonic-time guarantee. No untrusted-web clock-control path was established.

- **NF-8 — Password-change atomicity and bearer limitation [high]:** Guard, master, entropy, DEK envelope, and MAC are committed in one row write at `apps/extension/src/wallet/services/profile/service.ts:1102` and `:1112`; no separate-slot crash window was found. Successful active-session reopening rotates the stored bearer (`:1115`). This is **not cryptographic revocation**: master and DEK remain unchanged, and a pre-change bearer can authenticate the newly MACed row if retained/replayed; a crash between row commit and session replacement can leave it present. Possession of that bearer already exposes the underlying master/DEK, an accepted capability of non-strict mode, so this is not claimed as a new independent exposure.

- **NF-9 — Passkey profile binding [high]:** Unlock checks recovered credential ID against both snapshot and current row at `apps/extension/src/wallet/services/profile/service.ts:770`, `:786`; export checks it at `:1691`; restore checks backup identity at `:2409`; finalization compares its saved security fields at `:2662`. Supplying B’s genuine credential to unlock an intact A fails. `confirmProfileOperation`’s passkey helper only checks successful return (`profile/passkey-recovery-coordinator.ts:113`), but its boolean is not a backend authorization token.

- **NF-10 — MAC verification coverage and accepted exceptions [high]:** MAC v3 covers requested profile ID, four encrypted slots, and fingerprint using `master || DEK` (`packages/wallet-crypto/src/entropy-mac.ts:57`, `:67`). Password unlock/finalize, silent restore, and password reseal check it (`profile/service.ts:368`, `:1020`, `:2627`; `profile/session-manager.ts:588`). It is not verified before every metadata read, and password recovery exports intentionally omit it. Derived-only unlock after failure and export under a damaged MAC are explicitly accepted at `implementations-plan/mac-identity-binding/plan.md:25`; they are not re-reported.

- **NF-11 — Export authorization and outputs [high]:** Password exports re-unseal credentials and verify master/entropy pairing: `apps/extension/src/wallet/services/profile/service.ts:1639`, `:1755`, `:1885`. They intentionally return master, mnemonic, or master/entropy/DEK to the requesting trusted popup. Passkey `exportPlain` returns credential ID after credential/fingerprint/DEK checks (`:1680`). `getProfileDekSealed` returns ciphertext without password re-check (`:1819`). Locked profiles may be exported after fresh authentication; tombstoned profiles fail the row/epoch fences (`:312`, `:1647`, `:1902`).

- **NF-12 — Integrity-block tampering [high]:** Corrupting a block payload does not clear it: raw key presence blocks at `apps/extension/src/wallet/services/account-integrity/blocked-repository.ts:36`. Deleting the key does clear that storage signal; verified stamps are also unauthenticated and can be fabricated. They must not be treated as tamper-proof attestations. Fresh credential opens rederive accounts (`coordinator.ts:133`), and signing independently verifies derived/imported addresses (`apps/extension/src/wallet/services/account/service.ts:349`, `:384`); no signing bypass from block/stamp tampering alone was established.

- **NF-13 — Withheld-session and cross-profile scope [high]:** Mismatch detection withholds/closes the matching session even if block persistence fails (`apps/extension/src/wallet/services/account-integrity/coordinator.ts:171`; `profile/service.ts:1242`). Master/DEK consumers require the active profile (`profile/session-manager.ts:214`, `:226`). Verification spans every derived account in the target profile, so one chain can block that profile’s other chains; `lockProfileIfActive` prevents closing a different profile (`profile/service.ts:880`). Boot re-verification is deliberately asynchronous (`account-integrity/coordinator.ts:82`), rather than a startup-wide barrier.

- **NF-14 — Interrupted deletion [high]:** Deletion reserves the ID and persists a tombstone before removing the row (`apps/extension/src/wallet/services/profile/service.ts:1424`); pending master/DEK contexts and integrity markers are cleared before cascade completion. Failed purges retain the tombstone, and startup reserves raw tombstone IDs before restoring sessions (`:445`). Epoch checks bracket session open (`:1210`, `:1260`). No ordinary failed-delete path was found leaving a tombstoned profile unlockable/exportable; shared authwit cleanup is F-5.

- **NF-15 — Remaining key-separation inventory [high]:** Derived account signing/privacy roots and wallet fingerprints intentionally depend on the shared master; sibling equality is expected. Imported signing-key encryption uses the random DEK plus chain/address (`packages/wallet-crypto/src/imported-account-key-box.ts:26`); envelope MAC uses master plus DEK (`entropy-mac.ts:67`); password/PRF credentials wrap the DEK (`imported-keys-dek-box.ts:29`, `passkey-credential.ts:109`). Session wrapping uses a fresh random token and profile-ID AAD (`session-secret-box.ts:76`, `:86`). The master-only authorization/PXE exceptions are F-1 and F-2.

- **NF-16 — Restore clone separation [high]:** Password and passkey restores generate a new destination DEK and rewrap imported rows instead of retaining the backup’s source DEK as the destination key (`apps/extension/src/wallet/services/profile/service.ts:2313`, `:2421`). Rewrap-context consumption explicitly rejects its own expired entry (`:221`). This protection does not fix the separate pending-master finalization defect in F-4.

- **NF-17 — Onboarding secret handling [high]:** Creation/import credentials remain in local reactive state and authenticated RPC parameters; onboarding clears password/seed references on disposal (`apps/extension/src/onboarding/pages/create.vue:96`, `apps/extension/src/onboarding/pages/import.vue:120`). Full-backup decryption occurs in popup/onboarding memory (`apps/extension/src/composables/useFullBackupImport.ts:385`), and reset drops the parsed backup/password (`:797`). This is reference clearing, not guaranteed erasure of immutable strings.

- **NF-18 — Backup configuration downgrade [high]:** Backup restoration only accepts presentation-preference keys; strict mode, TTL, and other security settings cannot be lowered through this path (`apps/extension/src/wallet/services/config/service.ts:64`). Direct configuration RPCs remain inside the trusted extension boundary.

## Handoff edges followed

- **Popup → privileged service:** `apps/extension/src/popup/pages/auth.vue:101` → Port admission at `packages/extension-messaging/src/background/service.ts:45` → allowlisted dispatch at `packages/extension-messaging/src/core/base-service.ts:94`.
- **Ceremony UI → passkey/profile service:** `apps/extension/src/components/passkey/PasskeyCeremonyDialog.vue:58` and `apps/extension/src/popup/windows/passkey/index.vue:49` → passkey resolution/materialization and profile credential checks.
- **Backup import → delayed activation:** `apps/extension/src/composables/useFullBackupImport.ts:546` → `apps/extension/src/wallet/services/profile/service.ts:2556`.
- **Integrity registration → session gate:** `apps/extension/src/wallet/services/account-integrity/coordinator.ts:68` → `apps/extension/src/wallet/services/profile/service.ts:1231`; operation-time mismatch handling was checked at `apps/extension/src/wallet/services/account/service.ts:536`.
- **Profile-key provider → dApp authorization:** `apps/extension/src/wallet/services/dapp-session/service.ts:67` → MAC verification → immediate discovery and dispatcher consumers.
- **Profile-key provider → PXE storage:** `apps/extension/src/wallet/runtime.ts:544` → `packages/aztec-runtime/src/pxe/opfs-store.ts:120`; account registration and installed PXE key-store persistence were followed to identify the protected data.
- **Deletion → dependent purge:** `apps/extension/src/wallet/services/profile/service.ts:1450` → `apps/extension/src/wallet/services/profile-deletion/coordinator.ts:116` → immediate auth-registry purge handler and account-deletion subscription.

Validation used read-only inspection and synthetic, in-memory probes. No files were modified, no live credentials were accessed, and no live website/passkey or OPFS exploitation was performed.

## Cross-rebuttal

**Its findings, one line each**

- **Claude F-1 — DOWNGRADE impact; CONFIRM root, high confidence:** The master-only MAC KDF is vulnerable (`apps/extension/src/wallet/services/profile/service.ts:913`), but the claimed transaction-prompt bypass is wrong: transaction access equals 5, and `accessLevel >= confirmationLevel` requires confirmation even at threshold 5 (`apps/extension/src/wallet/services/dapp-interaction/service.ts:587`).
- **Claude F-2 — DOWNGRADE to documented accepted residual:** Its unconditional transition from degraded unlock to a usable wrong-master session omits the integrity delegate (`apps/extension/src/wallet/services/profile/service.ts:1232`), which rejects mismatching derived accounts (`apps/extension/src/wallet/services/account-integrity/coordinator.ts:154`); password-change laundering also rejects the copied envelope (`apps/extension/src/wallet/services/profile/service.ts:1023`). Remaining degraded-open/export behavior is expressly accepted at `implementations-plan/mac-identity-binding/plan.md:27`.
- **Claude F-3 — UPGRADE evidence confidence to high; retain bounded impact:** Deletion passes shared addresses without checking surviving owners (`apps/extension/src/wallet/services/profile-deletion/coordinator.ts:120`) and deletes matching authwit records (`apps/extension/src/wallet/services/auth-registry/service.ts:435`); identical derivation inputs deterministically produce the shared address (`packages/wallet-crypto/src/derive-account-seed.ts:30`). Conditional occurrence does not weaken this code evidence.

**What it missed**

- **My F-2 — PXE isolation:** Its assertion that PXE derivation “gets this right” confuses distinct keys with inaccessible keys. A sibling knowing the master can compute B’s key using B’s public ID (`packages/wallet-crypto/src/pxe-store-key.ts:29`). Imported-account privacy secrets enter PXE at `packages/aztec-runtime/src/pxe/service.ts:388`.
- **My F-3 — Website RP scope:** Excluding webpage interception of extension RPCs does not exclude an independent website ceremony using the shared `nulo.sh` RP (`apps/extension/src/wallet/services/passkey/spec.ts:21`) and public PRF input (`apps/extension/src/wallet/utils/passkey-ceremony.ts:33`). This remains moderate confidence, with no real-authenticator demonstration.
- **My F-4 — Expired restore authentication:** Finalization excludes its target from sweeping (`apps/extension/src/wallet/services/profile/service.ts:2561`), consumes its secret without checking age (`:2652`), and opens with it (`:2681`); explicit lock does not clear that cache (`:853`).

**What I missed**

I **ADOPT, high confidence**, its testing observation: `apps/extension/src/wallet/services/dapp-session/service.test.ts:41` supplies independently generated keys per profile, masking the production KDF defect. `apps/extension/src/wallet/services/dapp-session/integrity.test.ts:53` likewise tests different keys rather than actual sibling derivation. This strengthens F-1’s regression-test explanation; it adds no separate vulnerability. I do not adopt Claude F-2 as a new finding.

**Overconfidence in either report**

- Its “PRF never leaves the SW” non-finding is false: the ceremony obtains and returns raw PRF in the popup/window at `apps/extension/src/wallet/utils/passkey-ceremony.ts:123` and `:133`.
- Its proposed public-profile-ID KDF fix is insufficient against an attacker knowing the shared master. A profile-specific **secret** must separate authorization keys.
- Its blanket bearer-invalidation claim overlooks the password-change crash interval between row commit and session replacement (`apps/extension/src/wallet/services/profile/service.ts:1112`, `:1115`). Rotation is not cryptographic revocation of a retained master/DEK bearer.
- Its claim that operation checks close the startup window overstates coverage: boot verification is asynchronous and can skip using an unauthenticated stamp (`apps/extension/src/wallet/services/account-integrity/coordinator.ts:82`, `:99`).
- My own evidence has limits: F-2 did not decrypt a live OPFS database; F-4’s isolated harness demonstrated stale-secret consumption, not a browser-reproduced takeover. F-4 requires the same surviving worker and an unfinished restore. Neither establishes imported signing-key disclosure.

**Net position — my IDs**

- **F-1:** Shared-master dApp permission-MAC forgery — **high**.
- **F-2:** Sibling-derived PXE key exposes imported-account privacy material — **high**.
- **F-3:** RP-eligible website ceremony can yield the wallet PRF/master — **moderate**.
- **F-4:** Expired passkey restore authentication survives explicit lock — **high**, conditional as above.
- **F-5:** Profile deletion destroys surviving siblings’ shared authwit index — **high**.