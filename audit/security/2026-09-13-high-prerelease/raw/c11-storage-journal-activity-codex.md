Files read: 46 required source/spec files in full, plus popup consumers, storage constructors, ownership paths, and immediate callers.
Findings: 3.
Non-findings: 14.

### F-1: A queued token deletion can delete another profile’s replacement token

1. **Title:** Token deletion authorizes an old row, then deletes whichever row subsequently occupies its numeric ID.

2. **Impact factors:** Integrity and authorization violation across profiles; loss of the replacement token’s registry entry and emission of its deletion event. No on-chain asset destruction demonstrated. Requires concurrent token operations, including removal and reuse of the highest numeric ID. A concurrent backup restore supplies a normal replacement writer. Complexity is moderate; ordinary extension operations suffice, without raw-storage access or another profile’s secret. User interaction consists of overlapping deletion/import operations.

3. **Evidence confidence:** **High** for the deletion mechanism. An isolated, in-memory probe executed the three deletion methods extracted unchanged from the source, with the real `Lock`, `EntityStorage`, and ownership helper. The intervening restore allocation/write was emulated. It produced:
   ```text
   firstDeleted: A
   restoredId: 1
   lateDeleteReturned: B
   victimRowSurvives: false
   ```
   This was not a browser integration test.

4. **OWASP / CWE mapping:** [OWASP A01:2025 — Broken Access Control](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/); CWE-863, Incorrect Authorization, included in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:** Popup-exposed `deleteToken` (`apps/extension/src/wallet/services/token/service.ts:73`) → active-profile ownership check **before locking** (`apps/extension/src/wallet/services/token/service.ts:545`) → `_deleteTokenById` waits for the token lock (`apps/extension/src/wallet/services/token/service.ts:565`) → `_deleteTokenByIdHoldingLock` reloads by ID and deletes without checking the captured owner or token identity (`apps/extension/src/wallet/services/token/service.ts:571`).

   The intervening writer is `restore`, which allocates a fresh numeric ID under that same lock and writes the restored token (`apps/extension/src/wallet/services/token/service.ts:800`, `apps/extension/src/wallet/services/token/service.ts:808`, `apps/extension/src/wallet/services/token/service.ts:824`). Removing the highest ID makes that ID allocatable again (`apps/extension/src/wallet/services/id-allocators.ts:17`).

6. **Missing control:** The deletion commit does not compare the loaded row with the token authorized before the wait. It needs an owner/identity check under the deletion lock, preserving the captured `(profileId, chainId, contract)` as well as the ID. An ownership check only before acquiring the lock is insufficient.

7. **Violation scenario:**
   - Profile A owns the highest token ID, `1`.
   - A token update holds the token lock during metadata I/O; this is an actual production wait (`apps/extension/src/wallet/services/token/service.ts:489`, `apps/extension/src/wallet/services/token/service.ts:502`).
   - First deletion D1 checks A’s token and queues.
   - A restore for new profile B queues its token batch.
   - Second deletion D2 also checks the still-present A token and queues behind the restore.
   - The lock holder finishes. D1 deletes A’s token.
   - B’s restore correctly finds ID `1` free and writes B’s token there.
   - D2 resumes, loads B’s token, deletes it, and returns B’s token information to the caller authorized against A.

8. **Preconditions:** Overlapping extension operations; the deleted token must occupy an ID that the intervening writer reuses. A custom token avoids the additional seed-marker wait. B’s restore must have reached its token stage while A remains active; full restore intentionally writes slices before activating the new profile.

9. **Why mitigations fail:** Allocation is correctly serialized and does not overwrite an occupied row. The bug occurs afterward: a stale deletion treats a reused identifier as continuing authorization. The lock serializes the harmful sequence but does not validate identity. The balance store’s separate identity protections do not protect the parent token row.

10. **Instances:** The vulnerable public authorization/commit split is `apps/extension/src/wallet/services/token/service.ts:545`, `apps/extension/src/wallet/services/token/service.ts:565`, and `apps/extension/src/wallet/services/token/service.ts:571`. Both normal token creation (`apps/extension/src/wallet/services/token/service.ts:378`) and restore (`apps/extension/src/wallet/services/token/service.ts:808`) can reuse a freed numeric ID. Contact, FPC, and network by-ID deletion perform their ownership check inside their mutation lock; they do not share this exact split.

### F-2: Popup journal mutations can report cancellation while the transaction still broadcasts

1. **Title:** Journal lifecycle writes are exposed without the execution controller’s authorization or cancellation semantics.

2. **Impact factors:** Integrity and authorization violation affecting any known journal record, including another profile’s records. A caller can falsify progress, remove an in-flight record, or prevent subsequent legitimate cancellation from reaching its controller. Transaction execution can continue despite a displayed cancellation. Requires an admitted same-extension context capable of issuing internal RPCs; **no ordinary dApp-to-journal RPC route was demonstrated**. Complexity is low once that privilege exists. An already-running transaction is required for the execution/display divergence.

3. **Evidence confidence:** **High** for the source-level behavior. The real FSM accepted `proving → cancelled` and rejected the subsequent `cancelled → submitting` in an in-memory probe. Full service import was unavailable because the local dependency resolution lacked `@wonderland-token-artifact`; the execution consequence was verified statically.

4. **OWASP / CWE mapping:** [OWASP A01:2025 — Broken Access Control](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/); CWE-862, Missing Authorization, included in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:** Same-extension port admission (`packages/extension-messaging/src/background/service.ts:38`) → registered RPC invocation (`packages/extension-messaging/src/core/base-service.ts:125`) → explicitly exposed `transitionOperation`, `setOperationMeta`, and `deleteOperation` (`apps/extension/src/wallet/services/operation-journal/service.ts:47`) → unscoped row mutation and event emission (`apps/extension/src/wallet/services/operation-journal/service.ts:309`, `apps/extension/src/wallet/services/operation-journal/service.ts:349`, `apps/extension/src/wallet/services/operation-journal/service.ts:445`).

   Execution consequence: transfer cancellation checks only its controller’s signal (`apps/extension/src/wallet/services/execution/transfer-executor.ts:115`); journal-update failures are swallowed (`apps/extension/src/wallet/services/execution/transfer-executor.ts:106`); the coordinator proceeds through proving and `sendTxTask` (`apps/extension/src/wallet/services/execution/execution-coordinator.ts:195`). The journal update reaches the popup’s terminal-state handling (`apps/extension/src/popup/components/modules/general/RecentActivityView.vue:563`).

6. **Missing control:** The RPC surface does not distinguish execution-owned lifecycle writes from user requests. There is no active-profile check on these methods and no controller ownership requirement. User cancellation should enter the controller-aware operation, whose existing implementation checks the active profile and aborts the controller.

7. **Exploit story:**
   - An internal caller obtains an in-flight transfer ID through `getOperations`.
   - While it is proving, the caller invokes `transitionOperation(id, { stage: "cancelled" })`.
   - The journal accepts this legal FSM edge, persists `terminalAt`, and emits the cancellation.
   - The transfer’s controller remains un-aborted. Proof completion passes `checkCancelled`.
   - The attempted transition to `submitting` throws because the journal is terminal; `markJournal` swallows that error.
   - Execution broadcasts the transaction and records it.
   - A later genuine `cancelJob(id)` also fails to abort: it first attempts the already-illegal cancellation transition and returns on rejection (`apps/extension/src/wallet/services/execution/execution-lane.ts:195`).
   - Alternatively, `deleteOperation(id)` removes the in-flight record; genuine cancellation then returns at its missing-record check (`apps/extension/src/wallet/services/execution/execution-lane.ts:174`).

8. **Preconditions:** An over-privileged or compromised internal extension context. Browser sender authentication excludes ordinary web pages and content scripts (`packages/extension-messaging/src/core/sender-auth.ts:17`). The transaction must already have been authorized; this finding does not create a new signing authorization.

9. **Why mitigations fail:** Schema validation and the FSM establish valid shape and transition order, not the caller’s authority. The normal `cancelJob` implementation has the missing profile/controller logic (`apps/extension/src/wallet/services/execution/execution-lane.ts:163`), but direct journal RPC bypasses it. Display filtering does not establish that a terminal state reflects actual execution.

10. **Instances:** `createOperation` can also fabricate attributed history, although it checks profile/network existence (`apps/extension/src/wallet/services/operation-journal/service.ts:211`). The mutable RPC instances are `transitionOperation:297`, `setOperationMeta:349`, and `deleteOperation:445` in that file. Both transfer and dApp execution swallow journal-update failures: `apps/extension/src/wallet/services/execution/transfer-executor.ts:106` and `apps/extension/src/wallet/services/execution/execution-lane.ts:425`.

### F-3: A hostile backup can preserve fabricated balances by supplying a future refresh timestamp

1. **Title:** Restored balance observations can claim they were refreshed far in the future.

2. **Impact factors:** Integrity violation in displayed wallet holdings, including derived fiat values. The attacker controls a backup accepted by the user; the effect is confined to the restored profile’s valid account/token pairs. No cross-profile overwrite or ability to spend nonexistent funds was demonstrated. Complexity is low; user interaction requires importing the crafted or modified backup.

3. **Evidence confidence:** **High** for acceptance and automatic-refresh suppression. A probe using the actual balance schema and reconciliation function accepted:
   ```json
   {
     "publicBalance": "1000000000000000000",
     "privateBalance": "0",
     "updatedAt": 9999999999999
   }
   ```
   For a matching account/token pair, reconciliation returned no missing, stale, or mismatched rows; the automatic stale-age comparison returned false.

4. **OWASP / CWE mapping:** [OWASP A08:2025 — Software or Data Integrity Failures](https://top10.owasp.org/2025/A08_2025-Software_or_Data_Integrity_Failures/); CWE-20, Improper Input Validation, included in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:** Backup slices enter the service restore loop (`apps/extension/src/composables/full-backup-restore.ts:419`) → balance restore preserves backup amounts and `updatedAt` while replacing identity fields (`apps/extension/src/wallet/services/token-balance/service.ts:710`) → the schema accepts arbitrary numeric timestamps (`apps/extension/src/wallet/services/token-balance/spec.ts:45`) → automatic refresh trusts that timestamp in `Date.now() - tb.updatedAt >= 30 minutes` (`apps/extension/src/utils/core.ts:142`).

   Display handoff: `getTokenBalances` returns the accepted amounts (`apps/extension/src/wallet/services/token-balance/service.ts:191`, `apps/extension/src/wallet/services/token-balance/service.ts:436`); the home list consumes them (`apps/extension/src/popup/components/modules/general/TokensView.vue:290`); `TokenCard` formats the amounts and treats only `updatedAt === 0` as never synchronized (`apps/extension/src/popup/components/modules/general/TokenCard.vue:33`, `apps/extension/src/popup/components/modules/general/TokenCard.vue:59`).

6. **Missing control:** Imported cache freshness is treated as service-established freshness. Restore neither invalidates the observation nor marks it unverified pending a successful projection. Timestamp validation also lacks a future-time bound.

7. **Exploit story:**
   - Modify a valid plaintext backup’s balance row for one of its legitimately imported account/token pairs.
   - Set a large valid decimal balance, omit `syncFailure`, and set `updatedAt` to `9999999999999`.
   - Recompute the ordinary checksum; the importer explicitly recognizes that this checksum is attacker-recomputable (`apps/extension/src/composables/useFullBackupImport.ts:90`).
   - The user imports the backup. Profile remapping and token relinking succeed because the identities are legitimate.
   - The card displays the fabricated amount as an ordinary balance.
   - Activation reconciliation does not enqueue it: only `updatedAt === 0` without a failure is treated as never projected (`apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:140`).
   - Unlock-time stale refresh also skips it because its age is negative.

8. **Preconditions:** A structurally valid, importable backup containing valid restored account/token relationships. The attacker needs control of plaintext backup contents, not an ability to alter authenticated ciphertext without its key.

9. **Why mitigations fail:** Identity matching verifies whose balance row it is, not whether its amount was observed on-chain. Numeric rendering guards accept the deliberately valid amounts. Manual refresh, opening the token detail page, or subsequent transaction/incoming-transfer refreshes can correct it; therefore this is persistence until an independent refresh, not an uncorrectable condition.

10. **Instances:** Unbounded persisted timestamp: `apps/extension/src/wallet/services/token-balance/spec.ts:54`; restore preservation: `apps/extension/src/wallet/services/token-balance/service.ts:710`; reconciliation trust: `apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:143`; stale-age trust: `apps/extension/src/utils/core.ts:160`; synchronized-display inference: `apps/extension/src/popup/components/modules/general/TokenCard.vue:61`.

## Non-findings

- **NF-1 — Direct web access to internal storage RPCs:** No bypass demonstrated; the background port authenticates the browser-provided extension ID and extension URL. F-2 explicitly requires an admitted internal caller (`packages/extension-messaging/src/core/sender-auth.ts:17`).
- **NF-2 — Ordinary foreign-row getters/deleters:** Contacts, networks, FPCs, and token by-ID getters check the active profile; token deletion’s delayed commit is the specific exception in F-1 (`apps/extension/src/wallet/services/contact/service.ts:75`, `apps/extension/src/wallet/services/network/service.ts:390`, `apps/extension/src/wallet/services/fpc/service.ts:268`, `apps/extension/src/wallet/services/token/service.ts:222`).
- **NF-3 — Balance cross-profile transplantation:** Numeric key identity plus the row/token `(profileId, chainId, contract)` join rejects foreign or obsolete token identities; activation clears the active token map synchronously (`apps/extension/src/wallet/services/token-balance/balance-repository.ts:23`, `apps/extension/src/wallet/services/token-balance/service.ts:179`, `apps/extension/src/wallet/services/token-balance/service.ts:455`).
- **NF-4 — Transplanted authwit IDs revoking another account:** Authwit rows require numeric key identity, and revocation checks every row’s account against the requested execution account (`apps/extension/src/wallet/services/auth-registry/service.ts:71`, `apps/extension/src/wallet/services/auth-registry/service.ts:191`).
- **NF-5 — ID prediction/collision as standalone authorization bypass:** IDs are identifiers, not authority; numeric allocation checks physical occupancy and safe integers, while random allocation uses `crypto.getRandomValues`. The length argument counts hex characters: default eight characters means 32 bits, journal sixteen means 64 bits, and dApp-session sixty-four means 256 bits (`apps/extension/src/wallet/services/id-allocators.ts:17`, `packages/wallet-core/src/utils/random.ts:9`, `apps/extension/src/wallet/services/dapp-session/service.ts:164`).
- **NF-6 — Backup IDs overwriting occupied live rows:** Token/balance restore reallocates IDs; contact/FPC/network restore checks physical occupancy; transaction restore rejects existing hashes. Profile remapping and imported-account provenance filtering prevent ordinary backup grafts into another profile; F-1 concerns a later stale deletion (`apps/extension/src/wallet/services/id-allocators.ts:64`, `apps/extension/src/wallet/services/transaction/service.ts:593`, `apps/extension/src/composables/useFullBackupImport.ts:164`, `apps/extension/src/composables/useFullBackupImport.ts:485`).
- **NF-7 — Terminal resurrection and cancellation-sentinel leakage:** Terminal stages have no outgoing FSM edges; deletion and transition share the journal lock. Cancellation is converted into structured RPC cancellation or an operation result at the execution boundary (`packages/wallet-core/src/jobs/fsm.ts:38`, `apps/extension/src/wallet/services/operation-journal/service.ts:445`, `apps/extension/src/wallet/services/execution/rpc-cancel.ts:47`, `apps/extension/src/wallet/services/execution/rpc-cancel.ts:69`).
- **NF-8 — GC normally deleting live execution records:** GC selects terminal succeeded records; the reaper changes state rather than deleting and uses conditional stage/timestamp checks against stale snapshots. Failed/cancelled retention is unbounded, but no additional concrete quota-exhaustion exploit was established in this cluster (`apps/extension/src/wallet/services/operation-journal/gc.ts:113`, `apps/extension/src/wallet/services/operation-journal/reaper.ts:199`).
- **NF-9 — Production retired-incarnation replay:** The causal reducer and `ActivityProtocolCoordinator` have no production callers. The cold-snapshot gap remains real in dormant code; the coordinator also does not inspect record envelopes, so it does not implement the required envelope/record scope check (`packages/wallet-core/src/activity/causal.ts:172`, `packages/wallet-core/src/activity/model.ts:43`, `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:77`).
- **NF-10 — First-install learning of an attacker-selected default token:** Seed addresses, expected class IDs, and expected symbols are compiled constants; first install does not choose them from the node. Decimals are only bounded, and an existing seed-address row bypasses fresh seed validation, so the pins do not authenticate all stored metadata (`apps/extension/src/wallet/services/token/default-tokens.ts:29`, `apps/extension/src/wallet/services/token/service.ts:613`, `apps/extension/src/wallet/services/token/seeder.ts:273`, `apps/extension/src/wallet/services/token/seeder.ts:364`).
- **NF-11 — Contact XSS or silent name-match replacement:** Contact fields render as Vue text and selected/copied values retain the stored address. The current import flow caps files at 1,000,000 bytes and 512 rows, validates addresses, and explicitly warns about replacing matching names/addresses; no contact-controlled URL sink was found (`apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:30`, `apps/extension/src/utils/contacts-export-format.ts:38`, `apps/extension/src/components/composite/ImportContactsPopup.vue:160`).
- **NF-12 — Serializer gadgets removing authorization fields:** Cycles and throwing getters do throw; BigInts become decimal strings; a Buffer-shaped object becomes base64 and loses other fields. No concrete path was found where that conversion removes a required security field and subsequently authorizes an operation. RPC result serialization errors are caught; ordinary JSON messages cannot transport live getters or Proxies (`packages/wallet-core/src/utils/serialization.ts:25`, `packages/extension-messaging/src/core/base-service.ts:111`).
- **NF-13 — July malformed-ValueStorage startup regression:** `ValueStorage` throws and preserves malformed values, but configuration and session startup handle that failure; seed markers also catch it. Absence of a constructor codec does not itself demonstrate a startup failure (`packages/wallet-core/src/storage/value-storage.ts:28`, `apps/extension/src/wallet/config/store.ts:23`, `apps/extension/src/wallet/services/profile/session-manager.ts:517`, `apps/extension/src/wallet/services/token/seeder.ts:384`).
- **NF-14 — Fabricated transaction confirmation causing on-chain effects:** Terminal transaction restore accepts backup-reported status without independently verifying it; Pending restore is rejected, and normal polling debounces DROPPED and watches for late mining. This can import fictitious history, but no new signing or cross-profile authority follows from that status; no separate finding beyond the concrete cache-freshness issue was established (`apps/extension/src/wallet/services/transaction/service.ts:411`, `apps/extension/src/wallet/services/transaction/service.ts:429`, `apps/extension/src/wallet/services/transaction/service.ts:563`).

## Handoff edges followed

### Storage constructor inventory

`false/string` means identity matching is disabled and the unused mode defaults to string. ValueStorage has no key-identity option. Repeated browser-adapter/fallback constructors are counted once. Test-only constructors are excluded.

| Storage root | Row / read codec | Identity matching | Ownership fields or key | Owner / constructor |
|---|---|---|---|---|
| `nulo:core:profiles` | `Profile`; no injected codec | **true/string** | Row `id` | `apps/extension/src/wallet/services/profile/repository.ts:46` |
| `nulo:core:accounts` | `AccountSchema` | false/string; manual canonical-key filtering | Composite profile/chain/address key; corresponding row fields | `apps/extension/src/wallet/services/account/service.ts:84` |
| `nulo:core:imported-account-keys` | `ImportedAccountKeySchema` | false/string; manual full identity comparison | Composite profile/chain/address key and row | `apps/extension/src/wallet/services/account/imported-keys-repository.ts:21` |
| `nulo:core:auth-registry` | `AuthwitSchema` | **true/numeric** | `account`; no profile field | `apps/extension/src/wallet/services/auth-registry/service.ts:71` |
| `nulo:core:auth-registry-enabled` | Boolean / `AuthwitStatusSchema` | false/string | Account address key | `apps/extension/src/wallet/services/auth-registry/service.ts:80` |
| `nulo:core:tokens` | `TokenSchema` | false/string | `profileId`, `chainId`, `contract` | `apps/extension/src/wallet/services/token/service.ts:110` |
| `nulo:core:dappSessions` | `DappSessionSchema`, then profile-keyed HMAC verification | false/string | `profileId`, string `chainId`, accounts, origin | `apps/extension/src/wallet/services/dapp-session/service.ts:65` |
| `nulo:core:networks` | `NetworkRowSchema` | false/string | `profileId`, `chainId`, `l1ChainId` | `apps/extension/src/wallet/services/network/service.ts:213` |
| `nulo:core:fpcs` | `StoredFpcSchema` | false/string | `profileId`, `chainId`, contract address | `apps/extension/src/wallet/services/fpc/service.ts:77` |
| `nulo:core:contacts` | `ContactSchema` | false/string | `profileId`; contacts are not chain-scoped | `apps/extension/src/wallet/services/contact/service.ts:59` |
| `nulo:journal` | `OperationRecordSchema` | false/string | Required `profileId`; optional network/account/session/token IDs | `apps/extension/src/wallet/services/operation-journal/service.ts:109` |
| `nulo:core:txs` | `TxSchema` | false/string; keyed by `hash`, not `id` | `chainId`, `account`; optional `profileId`, `networkId` | `apps/extension/src/wallet/services/transaction/service.ts:88` |
| `nulo:core:token-balances` | `TokenBalanceRawSchema` | **true/numeric** | `profileId`, `chainId`, `contract`, token ID, account | `apps/extension/src/wallet/services/token-balance/balance-repository.ts:23` |
| `nulo:core:incoming-transfers` | `IncomingTransferRecordSchema` | false/string | Scoped record ID plus `profileId`, `networkId`, `accountAddress`, contract | `apps/extension/src/wallet/services/incoming-transfer/repository.ts:50` |
| `nulo:core:incoming-trust` | `IncomingTrustRecordSchema` | false/string | Profile/network/contract in key and row | `apps/extension/src/wallet/services/incoming-transfer/repository.ts:53` |
| `nulo:core:incoming-public-cursors` | `PublicScanCursorSchema` | false/string | Profile/network/contract in key | `apps/extension/src/wallet/services/incoming-transfer/repository.ts:56` |
| `nulo:core:incoming-balance-outbox` | `IncomingBalanceOutboxRowSchema` | false/string | Profile/network/account/token in key | `apps/extension/src/wallet/services/incoming-transfer/repository.ts:59` |
| `nulo:core:activity-incarnations` | `ActivityIncarnationRowSchema` | false/string | Activity scope in key | Dormant: `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:89` |
| `nulo:core:activity-counters` | `ActivityCounterRowSchema` | false/string | Activity scope/source in key | Dormant: `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:90` |
| `nulo:core:activity-tombstones` | `ActivityTombstoneRowSchema` | false/string | Activity scope/source in key | Dormant: `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:91` |
| `nulo:core:session` | `Session`; no injected codec | N/A; **session storage** | Session’s profile field | `apps/extension/src/wallet/services/profile/session-manager.ts:168` |
| `nulo:config` | `Config`; no injected codec; owner applies field schemas | N/A | Global | `apps/extension/src/wallet/config/store.ts:16` |
| `nulo:core:token-prices` | `PriceState`; no injected codec; owner validates usable quotes | N/A | Global asset-price cache | `apps/extension/src/wallet/services/price/service.ts:109` |
| `nulo:core:token-seeded@<profileId>` | `SeedMarkerState`; no injected codec; manual shape checks | N/A | Profile in key; chain/contract in marker entry keys | `apps/extension/src/wallet/services/token/seeder.ts:373` |

The generic matcher compares only embedded `id` with the physical suffix; it does not validate owner relationships (`packages/wallet-core/src/storage/entity_storage.ts:154`). Transaction hash keys and composite account keys therefore need their own comparisons rather than blindly enabling the string-ID option.

### Getter/deleter ownership and concrete foreign-row calls

The following examples assume profile A is active and a known row belongs to B. They describe **internal RPC behavior**, not a demonstrated web entry point.

| Surface | Active-profile enforcement | Result for B’s row |
|---|---|---|
| Journal `getOperation`, `getOperations`, `countOperations` | **Absent** | `getOperation(bId)` and `getOperations({profileId:"B"})` return B’s records; omission returns all records. Count filtering is also caller-controlled. `apps/extension/src/wallet/services/operation-journal/service.ts:401` |
| Journal `deleteOperation` | **Absent** | `deleteOperation(bId)` deletes B’s record, including a live one. F-2. `apps/extension/src/wallet/services/operation-journal/service.ts:445` |
| Transaction `getTransaction`, `getTransactions` | **Absent** | `getTransaction(bHash)` returns B’s transaction; `getTransactions(bAddress)` returns matching rows across profiles/chains. No public by-ID transaction deleter exists. `apps/extension/src/wallet/services/transaction/service.ts:130` |
| Token `getTokens` | **Absent** | `getTokens("B")` returns B’s catalogue; `getTokens()` returns all catalogues. `apps/extension/src/wallet/services/token/service.ts:207` |
| Token `getToken`, internal `getTokenRaw` | Present | Reject B’s ID. `apps/extension/src/wallet/services/token/service.ts:222` |
| Token `deleteToken` | Present before locking; absent at commit | Ordinary foreign ID rejects; replacement-ID race succeeds as F-1. `apps/extension/src/wallet/services/token/service.ts:545` |
| Balance `getTokenBalance`, `getTokenBalances`, refresh | Active token map plus identity join | Reject/hide B’s rows; no public by-ID deleter. `apps/extension/src/wallet/services/token-balance/service.ts:179` |
| Contact getters and delete | Present | Reject/hide B’s rows. `apps/extension/src/wallet/services/contact/service.ts:68`, `apps/extension/src/wallet/services/contact/service.ts:153` |
| FPC getters, implementation getter, delete | Present | Reject/hide B’s rows. `apps/extension/src/wallet/services/fpc/service.ts:134`, `apps/extension/src/wallet/services/fpc/service.ts:268`, `apps/extension/src/wallet/services/fpc/service.ts:410`, `apps/extension/src/wallet/services/fpc/service.ts:426` |
| Network list/by-ID/info/status; network/endpoint delete | Present directly or through guarded getter | Reject/hide B’s rows. `apps/extension/src/wallet/services/network/service.ts:309`, `apps/extension/src/wallet/services/network/service.ts:390`, `apps/extension/src/wallet/services/network/service.ts:478`, `apps/extension/src/wallet/services/network/service.ts:642`, `apps/extension/src/wallet/services/network/service.ts:683`, `apps/extension/src/wallet/services/network/service.ts:779` |
| dApp session by-ID/grant/rejection getters and delete | Indirectly present through MAC-key access | Wrong-profile key derivation fails, so the row is hidden and deletion rejects. `apps/extension/src/wallet/services/dapp-session/mac-storage.ts:92`, `apps/extension/src/wallet/services/profile/session-manager.ts:214` |
| Account `getAccount`, `getAccounts` | Explicit caller scope; **no active-profile requirement** | `getAccounts("B", chain)` can return B’s public account rows. Single lookup compares profile and chain; list enumeration additionally checks the canonical composite key. `apps/extension/src/wallet/services/account/service.ts:100`, `apps/extension/src/wallet/services/account/service.ts:162` |
| Auth-registry getters | Account filter/key; **no active-profile requirement** | `getAuthwits(bAddress)` returns B-account rows; `getRegistryEnabled(bAddress)` reads its status key. `apps/extension/src/wallet/services/auth-registry/service.ts:132`, `apps/extension/src/wallet/services/auth-registry/service.ts:252` |
| Incoming by-ID getter | Present | Hides B’s receipt. `apps/extension/src/wallet/services/incoming-transfer/service.ts:465` |
| Incoming list/trust getters | Explicit caller scope; **no direct active-profile requirement** | `getTrustState("B", bNetwork, contract)` reads that tuple; the list selects the supplied tuple, subject to visibility/dust handling. `apps/extension/src/wallet/services/incoming-transfer/service.ts:434`, `apps/extension/src/wallet/services/incoming-transfer/service.ts:610` |

Unscoped journal reads were already recorded as a latent gap in the July report; they are not counted again as a standalone finding. The table records the actual remaining service contract. Current transaction UI state scopes the returned rows before display (`apps/extension/src/stores/app.store.ts:547`), and the journal detail page checks its current scope (`apps/extension/src/popup/pages/journal/[id].vue:173`).

The dApp `isTokenRegistered` handoff supplies the dispatcher’s profile and chain rather than exposing arbitrary `getTokens` parameters (`apps/extension/src/wallet/services/wallet-sdk/background.ts:182`).

### Row transplantation: demonstrated effects and limits

Most listed entity roots have **global ID keys**, not separate profile A/B namespaces. Moving an unchanged B row under another key preserves its embedded B ownership. A guarded A getter consequently rejects it. Composite account/incoming keys are the exceptions.

| Root family | Consequence of missing physical-key binding |
|---|---|
| Contacts | Typed profile purge selects by embedded `profileId` but deletes by embedded `id`. An A-shaped alias embedding B’s ID can make A cleanup delete B’s physical row. `apps/extension/src/wallet/services/contact/service.ts:253` |
| Tokens | Typed purge likewise passes embedded IDs to an unrestricted deletion helper, which reloads the physical occupant. `apps/extension/src/wallet/services/token/service.ts:766` |
| Journal | Bulk enumeration discards physical keys; profile/chain purge, reaper, and GC subsequently target embedded IDs. Aliases can misdirect cleanup or journal attribution. `apps/extension/src/wallet/services/operation-journal/service.ts:158`, `apps/extension/src/wallet/services/operation-journal/service.ts:179`, `apps/extension/src/wallet/services/operation-journal/service.ts:198` |
| Transactions | Keys are hashes, but no key/hash equality is enforced. A transplanted row supplies the hash used by pending tracking and subsequent writes. `apps/extension/src/wallet/services/transaction/service.ts:120`, `apps/extension/src/wallet/services/transaction/service.ts:486` |
| Networks/FPCs | Embedded IDs feed some purge/write operations even though public reads check the embedded owner. Endpoint deletion writes the modified network using its embedded ID. `apps/extension/src/wallet/services/network/service.ts:657`, `apps/extension/src/wallet/services/fpc/service.ts:457` |
| dApp sessions | HMAC authenticates row contents, not the physical storage suffix. Invalid/missing-MAC quarantine deletes `row.id`, potentially targeting another physical row. Profile purge separately uses physical keys and removes aliases correctly. `apps/extension/src/wallet/services/dapp-session/mac-storage.ts:85`, `apps/extension/src/wallet/services/dapp-session/mac-storage.ts:107`, `apps/extension/src/wallet/services/dapp-session/service.ts:397` |
| Incoming trust/cursors/outbox | Key relocation can change the context under which an otherwise valid value is consumed; repository getters do not compare embedded scope with requested scope, and cursor/outbox values have no embedded owner. `apps/extension/src/wallet/services/incoming-transfer/repository.ts:103`, `apps/extension/src/wallet/services/incoming-transfer/repository.ts:119`, `apps/extension/src/wallet/services/incoming-transfer/repository.ts:137` |
| Profiles/authwits/balances | Explicit key-identity checks reject mismatched IDs. Balance reads additionally reject mismatched token ownership. |
| Activity protocol roots | Relocation changes the scope represented by the key, but the coordinator is dormant. |

An in-memory `EntityStorage` probe confirmed the cleanup pattern: an alias with `{id:"victim", profileId:"A"}` caused a value-based A purge to delete the B row at `victim`, leaving the alias. These raw-storage cases are **not additional findings**: no lower-privilege production writer capable of planting those aliases was established. They must not be described as ordinary backup-import exploits.

A copied, valid MACed dApp-session alias is also not enough to claim successful reconnection after deleting its canonical row: session establishment calls `setVerificationHash` using the embedded canonical ID, which then fails when that row is absent (`apps/extension/src/wallet/services/wallet-sdk/session-established.ts:126`). No cross-profile grant forgery or authwit revocation was demonstrated.

### Other followed boundaries

- **Journal → execution → popup:** Lifecycle events reach progress/terminal consumers; execution cancellation remains controller-driven. This is the material distinction behind F-2.
- **Backup → restore → reconciliation → cards:** Identity remapping is effective, but restored observation freshness remains attacker-controlled. This establishes F-3.
- **Token deletion → dependent stores:** Deletion emits the freshly loaded token’s profile, which preserves event attribution but cannot repair the wrong-target deletion in F-1.
- **Seed preview → token persistence:** Address/class checks happen before registration, metadata is checked once, and that same snapshot is persisted. `observedDecimals` records an observation rather than an equality pin. Updating a token replaces name/symbol/decimals from chain metadata; there is no separate user-name field preserved by that update (`apps/extension/src/wallet/services/token/service.ts:502`). Fee-juice metadata has its own fallback; it is not selected from the USDC seed list (`apps/extension/src/wallet/services/token/service.ts:709`).
- **Contact file → preview → service:** The current file-import UI applies the caps and replacement warning. The older `ContactService.importContacts` RPC still performs its own uncapped parse (`apps/extension/src/wallet/services/contact/service.ts:179`); no current file-picker route to that legacy method was established.
- **Objects → serialization → wire/storage:** The probe confirmed exceptions and Buffer-shape field loss. `EntityStorage.set` itself uses ordinary `JSON.stringify`, not `jsonSanitize` (`packages/wallet-core/src/storage/entity_storage.ts:188`). No claim of universal cycle handling, size limits, or security-field preservation is warranted.

All probes were in memory. No repository files were modified.

## Cross-rebuttal

**1. Its findings**

- **CONFIRM peer F-1, high confidence:** `TokensView` fetches every token-import journal row (`apps/extension/src/popup/components/modules/general/TokensView.vue:204`), filters only kind/address/time (`apps/extension/src/popup/components/modules/general/TokensView.vue:49`), and renders foreign metadata (`apps/extension/src/popup/components/modules/general/TokenImportRow.vue:32`). Duplicate-wallet creation is explicitly supported (`apps/extension/src/wallet/services/profile/service.ts:2004`). A recently failed B import can therefore appear under same-address profile A through ordinary navigation.

**2. What it missed**

- **My F-1 — token deletion after ID reuse:** Ownership is checked before acquiring the token lock (`apps/extension/src/wallet/services/token/service.ts:548`); the eventual deletion reloads the occupant without comparing owner or identity (`apps/extension/src/wallet/services/token/service.ts:571`). Its blanket “every by-id … deleter” protection claim misses this interval.
- **My F-2 — journal cancellation does not cancel execution:** Direct journal mutation leaves the controller untouched. Execution checks that controller, swallows journal-update errors, and can still broadcast (`apps/extension/src/wallet/services/execution/transfer-executor.ts:106`, `apps/extension/src/wallet/services/execution/execution-coordinator.ts:204`). The peer lists these mutations but understates their execution consequences.
- **My F-3 — fabricated balance freshness:** Restore preserves attacker-supplied `updatedAt` (`apps/extension/src/wallet/services/token-balance/service.ts:710`). Future timestamps defeat automatic stale refresh (`apps/extension/src/utils/core.ts:160`) and avoid never-projected reconciliation (`apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:143`).

**3. What I missed**

I **ADOPT peer F-1 as F-4, high confidence**. I documented unscoped journal reads but missed the existing, ordinary UI disclosure sink. My characterization of those reads as merely latent was incomplete. Keep F-4 distinguishable from my F-2: F-4 needs normal navigation; F-2 requires an admitted internal caller exercising inappropriate write authority.

**4. Overconfidence in both reports**

- The peer says success/hash invariants prevent fake success. They enforce a nonempty hash and consistency with a previously supplied hash, **not transaction authenticity** (`apps/extension/src/wallet/services/operation-journal/service.ts:547`, `apps/extension/src/wallet/services/operation-journal/service.ts:572`). An internal caller can walk legal stages using its own hash.
- Its “reconstructable history” justification for journal deletion contradicts GC’s explicit statement that failed/cancelled records have no other authoritative copy (`apps/extension/src/wallet/services/operation-journal/gc.ts:17`). Public deletion also permits nonterminal records.
- Its statement that `getTokens()` filters against the active profile is false: the profile argument is optional and caller-controlled (`apps/extension/src/wallet/services/token/service.ts:207`).
- Its dApp-session assurance needs qualification: missing-MAC rows trigger deletion by embedded ID **before** profile-key derivation (`apps/extension/src/wallet/services/dapp-session/mac-storage.ts:88`). That does not establish grant forgery, but defeats the unconditional “foreign rows are hidden, not deleted” claim.
- **My F-1 confidence needs separation:** the source-method probe demonstrated wrong-occupant deletion, but emulated the intervening restore write. I downgrade the complete concurrency scenario to **moderate** pending integration reproduction.
- **My F-2 remains conditional:** no ordinary dApp route to generic journal RPC was established. Its execution mechanism is high-confidence; remote exploitability is not established.
- **My F-3 is correctable:** explicit or event-driven refresh can replace the fabricated balance. Neither permanent corruption nor spending nonexistent funds follows.

**5. Net position**

- **F-1 — Queued token deletion can delete a replacement token belonging to another profile — moderate confidence.**
- **F-2 — Internal journal lifecycle writes can display cancellation while execution broadcasts — high confidence, privileged internal-caller precondition.**
- **F-3 — Backup-supplied future timestamps preserve fabricated balances against automatic refresh — high confidence.**
- **F-4 / peer F-1 — Tokens view renders another same-address profile’s token-import activity — high confidence.**