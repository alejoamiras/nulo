Files read: all assigned cluster sources in full, requested tests, audit context/maps, and bounded handoff targets; accelerator SDK inspected at its pinned 5.2.0 tag.  
Findings: 4.  
Non-findings: 21; verification was static plus read-only URL/XOR checks; no files changed or integration tests executed.

### F-1: Live signing still accepts a different chain identity with the same XOR composite

1. **Title:** Exact stored L1 identity is not enforced when constructing signed material.

2. **Impact factors:** Integrity and authorization: the wallet can sign an authwit using chain-domain values different from the selected network’s stored identity. A compromised shared RPC could affect every wallet using that endpoint. Network attack; low complexity after RPC control; no wallet credentials required; an otherwise authorized signing operation is required. This establishes wrong-domain signing, **not demonstrated redemption on another deployed chain or automatic fund theft**.

3. **Evidence confidence:** **High** for the validation bypass and signing trace. Cross-chain financial exploitation remains unproven.

4. **OWASP / CWE mapping:** [OWASP A08:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/); CWE-20, ranked 18 in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:**
   - `apps/extension/src/wallet/services/execution/service.ts:869` resolves the selected account before obtaining live node identity.
   - The attacker-controlled response enters at `service.ts:872`; `service.ts:875` passes it to `assertLiveChainIdentity`.
   - `packages/aztec-runtime/src/utils/chain-identity.ts:54` bypasses validation for composite `0`; otherwise `:55` checks only `(l1ChainId ^ rollupVersion) >>> 0`.
   - `apps/extension/src/wallet/services/execution/service.ts:877` and `:878` construct signing metadata directly from those live values; `:922` or `:929` computes the authwit hash; `:935` signs it.
   - `packages/aztec-runtime/src/account/nulo-account.ts:133` delegates that hash to the account’s authwit provider.

6. **Missing control:** Compare the live exact L1 identity with the canonical stored L1 identity at the signing boundary, and bind the expected rollup identity without relying solely on a lossy composite. The local exception also needs an independently enforced definition of “local”; `chainId === 0` alone provides none.

7. **Exploit story:**
   - The configured mainnet identity is L1 `1`, rollup version `4248422647`, composite `4248422646` (`apps/extension/src/utils/chain-ids.ts:17`, `:18`, `:30`).
   - After enrollment, the RPC reports L1 `2`, rollup version `4248422644`.
   - Both pairs produce composite `4248422646`; this equality was independently checked with JavaScript.
   - An authorized structured authwit request reaches the executor. Its account remains the selected account, but its signed metadata becomes `(2, 4248422644)`.
   - The wallet returns the resulting authwit without detecting the domain substitution.

8. **Preconditions:** Control of the configured RPC response and an authorized authwit request. Financial exploitation additionally requires a meaningful target domain accepting that account/key and authorization; this review did not establish one.

9. **Why mitigations fail:** Exact L1 checks now protect endpoint addition/update (`network/service.ts:568`, `:614`) and account derivation (`:337`, `:372`). They do not constrain a previously accepted endpoint that changes its responses. The single-response TOCTOU fix remains effective, but threads a tuple validated only by XOR. Separately, `validateRestoredNetwork` (`:1046`) validates URL/schema/collisions without pinning a seeded composite: a restored `kind: "mainnet"` row can retain `l1ChainId: 1` while carrying another composite, including `0`. This is the explicitly requested reassessment of the previously held collision, **not a regression of the July TOCTOU fix**.

10. **Instances:** Root helper: `packages/aztec-runtime/src/utils/chain-identity.ts:53`. Consumers sharing its incomplete validation:
    - `apps/extension/src/wallet/services/execution/service.ts:230`, `:875`
    - `apps/extension/src/wallet/services/execution/tx-request-builder.ts:221`, `:407`
    - `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:854`
    - `apps/extension/src/wallet/services/execution/fast-path.ts:179`
    - `apps/extension/src/wallet/services/execution/discovery-probe.ts:74`
    - `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:109`
    - `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:204`, `:362`
    - `apps/extension/src/wallet/services/execution/view-executor.ts:211` — returns wrong-domain metadata rather than signing.
    
    Related identity-loss boundary: `apps/extension/src/wallet/services/network/spec.ts:95` projects away exact L1 identity.

### F-2: A compromised RPC can manufacture successful incoming-transfer records

1. **Title:** Public receipts are promoted to successful wallet activity without authenticating their chain inclusion.

2. **Impact factors:** Integrity: false sender, amount, transaction hash, block and receipt status can appear for an already trusted token. The display can induce an off-chain delivery or another user action based on a nonexistent payment. Network attack; low complexity with RPC control; no wallet credentials or per-receipt approval required for trusted tokens. This does **not** create spendable on-chain funds.

3. **Evidence confidence:** **High** for fabrication through persistence and display.

4. **OWASP / CWE mapping:** [OWASP A08:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/); CWE-20, [2025 Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:**
   - RPC ingestion: `packages/aztec-runtime/src/pxe/public-events.ts:267` calls `getPublicLogsByTags`; `:369` decodes the supplied fields and `:374` constructs an event containing node-supplied amount, sender and transaction/block identifiers.
   - The returned page crosses the PXE RPC boundary into `apps/extension/src/wallet/services/incoming-transfer/public-event-indexer.ts:96`; events are accumulated at `:113` and consumed by `incoming-transfer/service.ts:1564`, `:1600`.
   - Persistence segment: `incoming-transfer/service.ts:1867` resolves the already registered token, `:1890` resolves trust, and `:1893` calls `commitPublicRecord`.
   - `:1954` persists the record; `:1956` emits `onIncomingTransferAdded` for trusted tokens. The stored amount and visibility derive directly from the event/trust state at `:1979`, `:1984`.
   - Display handoff: `apps/extension/src/composables/useIncomingTransfers.ts:92` inserts the event into the active account’s feed. `apps/extension/src/components/composite/activity/TransactionIncomingCard.vue:57` displays the positive amount and `:63` supplies a green success badge.

6. **Missing control:** Evidence tying the log to authenticated canonical chain state before representing it as a successful receipt. Ordering, ABI decoding and agreement between several answers from the same RPC do not establish inclusion.

7. **Exploit story:**
   - Target a token already registered and trusted by the wallet.
   - Return normal-looking checkpoint/finality information and contract instances whose current class matches the bundled token class.
   - Return a syntactically valid Transfer event addressed to the victim, with a fresh transaction hash and a large amount. Keep its position increasing and below the reported checkpoint.
   - The recipient, class, ordering and deduplication checks pass.
   - The wallet persists and displays a successful incoming payment that never happened. Choosing a sufficiently large amount also avoids the read-time dust filter.

8. **Preconditions:** Control of the active RPC; a watched standard-token contract and known recipient address; incoming activity enabled. The token must already be trusted to avoid first-receive confirmation.

9. **Why mitigations fail:** Both class checks query the same endpoint (`public-events.ts:436`, `:442`). Tips also come from that endpoint (`:395`). The ancestry helper checks only whether a membership witness exists (`:328`, `:329`), not its validity against an authenticated root. The balance outbox schedules a separate refresh; it does not condition receipt insertion on balance or inclusion verification. Explicit token addition marks trust before scanning (`incoming-transfer/service.ts:921`).

10. **Instances:** Both forward insertion (`incoming-transfer/service.ts:1600`) and reconciliation insertion (`:1759`) converge on `commitPublicRecord` (`:1944`). Supporting unauthenticated assertions occur in `public-events.ts:267`, `:327`, `:394`, `:421`. The same trust root also drives reconciliation deletion (`incoming-transfer/service.ts:1796`, `:1807`) and the monotonic finalized watermark (`:1634`): fabricated completeness/finality can erase recent receipt history or advance the rewind floor. These are consequences of the same RPC-authenticity gap, not separate findings.

### F-3: Reconciliation errors trigger an unbounded immediate retry cycle

1. **Title:** A failing log RPC can keep incoming-transfer reconciliation running indefinitely.

2. **Impact factors:** Availability: sustained RPC, storage and logging activity; accumulation of unresolved asynchronous calls; the affected poll never finishes its normal cycle. Network attack; low complexity; RPC control or a persistent selective endpoint failure suffices; no wallet privileges or further user interaction required after the watched stream exists. Whole-browser resource impact was not measured.

3. **Evidence confidence:** **High**.

4. **OWASP / CWE mapping:** [OWASP A10:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/); CWE-770, ranked 25 in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:**
   - `apps/extension/src/wallet/services/incoming-transfer/service.ts:1713` awaits the node-backed indexer scan.
   - Any rejection enters `:1723`; if `getTips` succeeds at `:1729`, the handler immediately awaits `beginReconciliation` at `:1733`.
   - `beginReconciliation` writes another marker at `:1693` and immediately awaits `stepReconciliation` again at `:1694`.
   - The resulting cycle is `stepReconciliation → beginReconciliation → stepReconciliation`, without returning to the scheduler.
   - `pollPublic` remains awaiting the scan at `:895`; its outbox drain at `:896` and single-flight cleanup at `:900` are not reached while the cycle continues.

6. **Missing control:** A bounded reconciliation-restart budget, delayed retry, and classification distinguishing an actual invalidated anchor from arbitrary RPC errors.

7. **Exploit story:**
   - Let a watched stream obtain an anchor, or wait for an existing reconciliation marker.
   - Continue answering tip requests successfully with a checkpoint hash.
   - Reject every log scan with a quick JSON-RPC application error.
   - Every rejection fetches tips, persists a replacement marker and immediately retries.
   - Repeat indefinitely. Successful HTTP responses carrying RPC errors need not encounter the HTTP retry backoff.

8. **Preconditions:** A watched standard-token stream with a reconciliation marker or previous sync anchor. For the latter, the forward-scan catch enters reconciliation at `service.ts:1449`, `:1452`. The profile/service epoch must remain current.

9. **Why mitigations fail:** The five-page limit belongs to one `PublicEventIndexer.scan` invocation (`public-event-indexer.ts:46`, `:89`). Each restart creates another invocation. The ordinary scheduler interval and single-flight flag prevent overlapping polls but do not bound the current poll. Per-request timeouts do not help against fast failures.

10. **Instances:** The recursive pair at `incoming-transfer/service.ts:1693`, `:1694`, `:1723`, `:1729`, `:1733`; entry paths include resumed reconciliation (`:1409`), pending-page reconciliation (`:1418`) and anchored forward-scan failure (`:1452`). All share one retry-policy defect.

### F-4: Production accelerator discovery can disclose private proving inputs to an unauthenticated local process

1. **Title:** The wallet enables automatic private-witness delivery to a replaceable loopback HTTP listener.

2. **Impact factors:** Confidentiality: the listener receives serialized private execution steps used for proving. Exposure covers the private inputs carried by that proving request; **master-secret or Schnorr-key extraction is not established**. Local attack; an unprivileged process able to bind the vacant port suffices; no browser-profile access required; the user must initiate proving. A different local OS account may satisfy the port-binding condition.

3. **Evidence confidence:** **High** for endpoint selection and payload delivery; exact sensitive fields depend on the execution being proved.

4. **OWASP / CWE mapping:** [OWASP A07:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/); CWE-200, [2025 Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:**
   - Production uses the default factory at `apps/extension/src/offscreen/index.ts:96`, `:115`.
   - `packages/aztec-runtime/src/pxe/chain-runtime.ts:228` constructs only optional host/port settings; `:229` creates `AcceleratorProver` without requiring authenticated HTTPS; `:248` installs it into PXE.
   - External handoff, **the pinned `@alejoamiras/aztec-accelerator@5.2.0` tag**, commit `acb3d317d4d64ca2aeee2e7a8d0d7dd90365e39b`: `packages/sdk/src/lib/accelerator-prover.ts:351` checks availability, `:370` enters remote proving, `:407` serializes `PrivateExecutionStep[]`, and `:426` submits it.
   - In that same dependency, `packages/sdk/src/lib/accelerator-transport.ts:201` recognizes health using public response fields; `:740`–`:759` posts the payload to `/prove`. Request headers provide content type and Aztec version, not server authentication.

6. **Missing control:** Authenticate the accelerator before sending private execution data. A fixed loopback address and recognizable JSON response do not identify the intended native application.

7. **Exploit story:**
   - When the genuine accelerator is absent, bind `127.0.0.1:59833`.
   - Answer `/health` with the recognized status/API-version contract and compatible version information; supply the necessary CORS response.
   - With no healthy HTTPS accelerator selected, automatic discovery accepts the HTTP service.
   - When the wallet proves a transaction, capture the binary `/prove` request.
   - Return an error or malformed proof afterward. A later fallback or proof rejection cannot retract the disclosed input.

8. **Preconditions:** The attacker can listen on the unprivileged loopback port; the genuine listener is absent; no healthy HTTPS endpoint takes precedence; a production proving operation occurs.

9. **Why mitigations fail:** The SDK prefers HTTPS and prevents certain downgrades after HTTPS has been established, but initial HTTP discovery remains permitted. Health-shape validation defeats accidental protocol collisions, not deliberate impersonation. WASM fallback happens after availability/proving decisions and does not protect data already posted. This is an integration finding at Nulo’s prover configuration boundary, not an audit of the accelerator server implementation.

10. **Instances:** Nulo wiring at `offscreen/index.ts:96`, `:115` and `chain-runtime.ts:228`, `:229`, `:248`; every production proving request using that factory. The endpoint declaration also appears at `apps/extension/src/accelerator/config.ts:22`. The external SDK locations above were inspected at the exact dependency tag, not inferred from its current default branch.

## Non-findings

- **NF-1 — RPC URL rules, high confidence:** `RpcUrlSchema` permits any HTTPS hostname and HTTP only when the parsed hostname is exactly `localhost`, `127.0.0.1` or `[::1]`; it rejects nonempty username/password (`network/spec.ts:152`). Read-only WHATWG URL checks confirmed HTTP `127.1`, `2130706433` and `0x7f000001` normalize to accepted `127.0.0.1`; `[::1]` passes; `0.0.0.0` and `localhost.` fail. HTTPS IDNs normalize to punycode and remain allowed. URL ports `0` and `65535` parse; `65536` fails; browser forbidden-port restrictions are additional. The adapter omits the userinfo check (`aztec-node-factory-adapter.ts:32`), but add/update/restore apply the stricter schema; no unprivileged credential-URL bypass was established.

- **NF-2 — Local enrollment does not skip probing, high confidence:** `_probeChainIdentity` calls `getNodeInfo` before either local carve-out (`network/service.ts:997`). URL matching or `kind === "local"` changes only the returned composite to zero (`:999`); the exact probed L1 value survives. HTTPS is allowed even for a local-kind endpoint, so the signing helper’s “loopback-only substitute” comment is inaccurate. The downstream identity weakness is F-1.

- **NF-3 — Seed pins have narrower scope than their name suggests, high confidence:** `assertCanonicalStoredL1` pins seeded **L1 IDs**, not composite IDs or endpoint ownership (`network/service.ts:346`). It is used by the derivation-oriented readers at `:337` and `:372`, not every network read. Restore accepts a schema-valid hostile HTTPS endpoint while retaining the pinned L1 value (`:1046`); F-011’s scheme protection is intact, but it is not endpoint authentication.

- **NF-4 — Profile/chain runtime separation, high confidence:** Runtime keys include profile and chain (`chain-coordinates.ts:20`), and store opening uses the corresponding directory plus the provisioned profile key (`chain-runtime.ts:140`; `opfs-store.ts:98`). Switching profiles deliberately retains warm runtimes (`pxe/service.ts:965`). This means profile isolation depends on the SW/session authorization boundary as well as storage partitioning; a shared offscreen document is not itself a discovered dApp bypass.

- **NF-5 — Store-key incarnation protection, high confidence:** The SW captures generation, derives the key, and rechecks generation before returning it (`wallet/runtime.ts:536`). The client preserves the captured generation during recovery; provisioning rejects deleting profiles, erased-generation replay and conflicting live generations (`pxe/service.ts:775`). The requested incarnation tests cover stale provisioning, failed deletion retries, successor protection and stale operation rebinding.

- **NF-6 — Destructive cleanup protections, high confidence:** Orphan sweeping requires an absent profile snapshot, takes its write barrier and rechecks lifecycle state before removal (`pxe/service.ts:227`). Chain deletion leaves the parent profile directory intact (`opfs-store.ts:281`). Profile deletion rejects stale generations and preserves its deleting fence on failure (`pxe/service.ts:710`). Legacy IndexedDB sweeping intentionally targets all `pxe/` databases; shared `keyval-store` removal is conditional on none remaining. No wrong-profile wipe was demonstrated through these lifecycle paths.

- **NF-7 — Coordinate injection remains an explicitly bounded uncertainty:** The codec performs raw interpolation and prefix construction (`chain-coordinates.ts:20`, `:25`, `:30`, `:35`); it does not escape profile IDs. Password restore can retain a supplied unused profile ID (`profile/service.ts:2317`). OPFS deletion uses directory-handle entry APIs (`opfs-store.ts:285`, `:298`), not a shell path. I did not establish upstream store-open normalization or a complete crafted-backup-to-victim-store deletion/read exploit; therefore no traversal finding or blanket claim that arbitrary restored IDs are safe.

- **NF-8 — Artifact verification is not limited to dApp-supplied artifacts, high confidence:** PXE-local artifact lookup passes through the class verifier (`artifact-registry.ts:184`, `:210`); compiled artifacts are keyed by their computed class IDs. dApp registration separately compares artifact class ID with the instance (`execution/service.ts:854`). However, node-sourced **instances** pass through the no-upgrade check, not `verifyArtifactClassId` (`pxe/service.ts:342`). Artifact hashing does not authenticate a node’s assertion that an address has that class; F-2 uses that distinction.

- **NF-9 — The 25 PXE methods are not 25 dApp methods, high confidence:** `pxe/descriptors.ts:43` lists the internal RPC surface. Scoped dApp operations can cause contract-instance/artifact reads, contract registration, sender registration/address-book reads, utility execution, simulation, profiling, private-event reads and transaction proving through approved `sendTx`. Registration can also cause internal account/class registration. There are no corresponding raw dApp routes for `getNoteSchemas`, `getNotes`, `getRegisteredAccounts`, `removeSender`, `getContracts`, `getSyncedBlockHeader`, `getBlockTimestamp`, the three public-indexing methods, the two clear methods or key provisioning. Some are supporting calls during other operations. The dApp registry is separately enumerated in `packages/wallet-bridge/src/method-descriptors.ts:171`.

- **NF-10 — Class registration and offscreen authorization, high confidence:** Standalone dApp `registerContractClass` is denied by `method-scope-checkers.ts:407`; allowed `registerContract` intentionally registers its artifact class internally (`pxe/service.ts:447`), and simulation registers a bundled stub (`:562`). Clear/provision methods are **not authenticated as SW-exclusive**: `extension-messaging/src/core/sender-auth.ts:17` also trusts this extension’s popup/options/offscreen pages. It rejects ordinary content-script and foreign-extension senders, and the dApp dispatcher supplies no raw management route. No direct web-to-clear/provision exploit was found.

- **NF-11 — Notes and explicit account scopes, high confidence within the inspected boundary:** `note/service.ts:169` requests notes with the selected account scope, and `pxe/schemas.ts:35` requires a scope array. Note rendering catches failures per note and returns `renderError` rather than aborting the whole rendering loop (`note/service.ts:119`). dApp-supplied account-scope arrays, including private-event scopes, are checked against session accounts (`wallet-bridge/src/scope-enforcement.ts:96`). The omitted-scope behavior inside upstream private-event processing was not established here; no cross-account note exploit is claimed.

- **NF-12 — Hostile page ordering is contained, high confidence:** Public pages must increase strictly and stay below the pinned upper bound (`public-events.ts:335`); cross-page nonprogress becomes `dropped` (`public-event-indexer.ts:104`). Malformed individual events are skipped while the examined cursor advances. Dropped pages do not finish reconciliation or advance the finalized floor (`incoming-transfer/service.ts:1745`, `:1634`). These controls resist malformed ordering; they do not authenticate fabricated but well-ordered data, as F-2 shows.

- **NF-13 — Sender-induced prompts and dust are not authorization, high confidence:** Only registered/watched tokens enter these receive paths. First receipt changes unknown trust to pending, coalescing subsequent receipts under that contract (`incoming-transfer/service.ts:1918`). Explicit token addition currently auto-trusts before scanning (`:921`), despite older popup commentary describing a mandatory second confirmation. Dust filtering is read-time display filtering (`:577`), so it does not prevent pending prompts or persistence. Allow changes receipt visibility; it does not execute a token transaction. The previously reported unbounded incoming-record retention issue is not presented as a new finding.

- **NF-14 — Amount/decimal sanitization is partial, high confidence:** Public amounts undergo ABI decoding and bigint conversion (`public-events.ts:369`); note amounts are parsed before insertion (`incoming-transfer/service.ts:1155`). Trust-popup symbols use `sanitizeWireString` (`IncomingTrustPopup.vue:55`). Ordinary token-decimal discovery matches an unsigned 8-bit ABI (`token/functions/descriptors.ts:221`), but the numeric unpacker and general display formatter lack a shared maximum-decimal check (`:223`; `utils/amount.ts:238`). Dust/fiat guards are not universal display validation. No independent honest-node malicious-token resource exploit was demonstrated.

- **NF-15 — Balance displays still depend on node honesty, high confidence:** Public balance calls deliberately use the node simulation fast path (`token-balance/balance-projector.ts:118`; `execution/helpers/batched-view-simulation.ts:574`). A malicious RPC can falsify public simulation results or censor synchronization. Private utilities run through PXE, so “all private balances are directly supplied by the RPC” would be inaccurate. Neither a fabricated balance display nor F-2’s receipt insertion proves creation of spendable funds.

- **NF-16 — Fee inflation is bounded by execution context, high confidence:** Absent an explicit gas-price override, `getCurrentMinFees` supplies the padded default (`aztec-runtime/src/account/fee-options.ts:63`). A lying RPC can inflate quotes, caps and failure likelihood. This is not proof it can collect the advertised amount: actual fee charging and sponsored/FPC budget enforcement are separate. No arbitrary-fee debit bypass was established in this cluster.

- **NF-17 — Other node RPC consequences, high confidence:** `getBlock` supplies receipt timestamps (`pxe/service.ts:614`) and simulation anchors (`execution/helpers/block-header-anchor.ts:28`). Nullifier-witness presence chooses whether account initialization is wrapped (`account/nulo-account.ts:172`, `:193`); lies can cause wrong construction and rejection. `getL1ContractAddresses` supplies the OPFS rollup stamp (`chain-runtime.ts:157`). Stamp mismatch throws and preserves the store (`opfs-store.ts:186`), so RPC-induced store wiping is not present.

- **NF-18 — Price cache defenses hold, high confidence:** CoinGecko requests use a fixed HTTPS endpoint and fixed asset-ID set. Cache reads revalidate ID, positive finite price, timestamps, freshness and asset-specific bands (`price/service.ts:264`, `:282`). Bands are USDC `$0.20–$5` and AZTEC `$0.0001–$100` (`price-map.ts:24`, `:31`). These reject malformed/out-of-band poisoning; they do not authenticate an in-band value written by an already privileged local actor or supplied by a compromised provider.

- **NF-19 — Prices affect more than fee display, high confidence:** Quotes also drive receipt dust filtering (`incoming-transfer/service.ts:596`) and fiat-denominated send conversion (`price/convert.ts:109`; `AmountCard.vue:178`). A poisoned accepted quote changes the derived token amount; the UI displays that token amount (`AmountCard.vue:158`). No quote-driven capability grant, signature without an authorized operation, or hidden automatic transfer was found.

- **NF-20 — HTTP retries themselves are finite, high confidence:** `fetch.ts:40` keeps the 60-second abort active through response-body JSON reading; `:118` supplies finite backoff delays. Connectivity probes use the single-attempt variant. Parsed HTTP 4xx responses are terminal (`:90`); a malformed non-OK body instead enters the generic parse-error branch (`:59`) and may be retried. There is no response-byte cap in this wrapper. The concrete unbounded retry finding is the higher-level reconciliation cycle in F-3.

- **NF-21 — Accelerator response validation is not established as local proof verification:** The pinned SDK bounds/decodes the returned proof and constructs `ChonkProofWithPublicInputs`; decoding is not cryptographic verification. Nulo’s visible pipeline calls `proveTx`, `toTx`, then `node.sendTx` without an explicit verifier (`execution/execution-coordinator.ts:149`, `:202`, `:206`). Whether upstream PXE verifies the accelerator’s proof before returning was not established within this review. No claim that malformed proofs can become valid canonical transactions is made; F-4’s disclosure occurs before this question matters.

## Handoff edges followed

- **Node factory → JSON-RPC transport:** adapter URL checks and timeout/retry injection.
- **Live node identity → executor/account signing:** authwit metadata and transaction-request chain information.
- **PXE public-event RPC → SW indexer → incoming-record consumer:** page handling, persistence, trust state, reconciliation and watermark updates.
- **Incoming-transfer event → popup consumer:** active profile/network/account filtering and successful-receipt presentation.
- **DApp dispatcher → execution/PXE facade:** method registry, class-registration denial, explicit scope enforcement and management-method reachability.
- **Runtime provider registration → PXE client/service:** profile-secret access, key derivation, generation capture and deletion/provision fences.
- **Profile/network backup import → cluster restore methods:** profile-ID retention/remapping and network-row validation; no `bridge-core` bodies audited.
- **PXE prover injection → accelerator SDK:** inspected the exact 5.2.0 tag’s detection, serialization, request and response boundary. No accelerator-server audit performed.
- **Price service → dust/send UI:** verified both non-fee consumers.
- **Verification limits:** URL normalization and the collision arithmetic were checked read-only. No live hostile RPC, native listener, proof generation, OPFS browser test or cross-chain redemption test was run.

## Cross-rebuttal

**1. Its findings, one line each**

- **Claude F-1 — DOWNGRADE:** Restore accepts arbitrary HTTPS endpoints (`apps/extension/src/wallet/services/network/service.ts:885`), but its exploit step 7.4 is wrong: an attacker-created backup does not reproduce the victim’s existing address merely by using `l1ChainId:1`; derivation also requires the victim’s master (`packages/wallet-crypto/src/derive-account-seed.ts:30`). Moreover, endpoint-add probing checks self-reported IDs, not operator authenticity (`apps/extension/src/wallet/services/network/service.ts:557`). Retain the restore-provenance concern, not “undetectable MITM” or full confidentiality loss.
- **Claude F-2 — CONFIRM, narrowly:** The FPC path validates the returned artifact but persists the originally requested address (`apps/extension/src/wallet/services/fpc/service.ts:292`, `:305`, `:316`, `:323`); registration compares the derived address only with `instance.address` (`packages/aztec-runtime/src/pxe/service.ts:450`). This establishes false FPC classification, without establishing malicious transaction execution.

**2. What it missed**

- **My F-1:** Its collision-closed conclusion confuses invoking the helper with validating exact identity. `packages/aztec-runtime/src/utils/chain-identity.ts:55` still compares XOR only. `(1,4248422647)` and `(2,4248422644)` collide; live values enter authwit metadata and signing at `apps/extension/src/wallet/services/execution/service.ts:877`, `:935`.
- **My F-2:** It mentions fake receipts as an impact but misses the concrete acceptance path: ancestry checks only witness presence (`packages/aztec-runtime/src/pxe/public-events.ts:329`), while trusted events are persisted and emitted as received (`apps/extension/src/wallet/services/incoming-transfer/service.ts:1954`, `:1956`).
- **My F-3:** Reconciliation restarts immediately after arbitrary scan errors (`apps/extension/src/wallet/services/incoming-transfer/service.ts:1733`), then calls itself again (`:1694`). Finite HTTP retries and page budgets do not bound this cycle.
- **My F-4:** It acknowledges witness interception but treats upstream documentation as mitigation. Nulo installs the default prover without requiring authenticated transport (`packages/aztec-runtime/src/pxe/chain-runtime.ts:229`). HTTPS preference does not prevent initial HTTP impersonation.

**3. What I missed**

**ADOPT Claude F-2 as my F-5, high confidence for FPC classification.** I identified the instance/artifact distinction but failed to follow it into the persistent FPC sink. Its requested-address versus returned-address distinction is decisive.

Reject its stronger backup characterization: `apps/extension/src/wallet/services/account-state/service.ts:397` registers the supplied instance, and `:402` reports the supplied entry as successful. That does not demonstrate persistence of a verified contract under the different outer address. Public-call misexecution remains unproven.

**4. Overconfidence in both reports**

Claude’s non-findings contain material errors:

- “Every live read” checks seeded identity is too broad: ordinary lookup at `apps/extension/src/wallet/services/network/service.ts:390` differs from the derivation readers.
- `registerContractClass` is **`ipxe:true`**, not false (`packages/aztec-runtime/src/pxe/descriptors.ts:52`), and allowed registration invokes it (`packages/aztec-runtime/src/pxe/service.ts:447`). The standalone dApp denial is the relevant defense.
- Malformed HTTP 4xx bodies throw generic retryable errors (`packages/aztec-runtime/src/utils/fetch.ts:59`), contradicting unconditional “4xx terminal.”
- “Same-user-only” accelerator trust is unsupported by a TCP loopback endpoint; binding is not authenticated by OS user identity.

My own report also needs tighter boundaries: **F-1 proves wrong-domain signing, not redeemable cross-chain theft; F-2 proves false activity, not spendable balance; F-3 establishes an unbounded retry cycle, not measured browser exhaustion. F-4 is a documented dependency-integration exposure, not a newly discovered SDK defect.**

**5. Net position**

- **F-1:** Exact chain identity remains unbound at signing — **high**.
- **F-2:** RPC-fabricated successful incoming receipts — **high**.
- **F-3:** Unbounded reconciliation restart cycle — **high**.
- **F-4:** Unauthenticated accelerator discovery exposes private proving inputs — **high**, documented integration risk.
- **F-5, adopted:** Returned contract instance is not bound to the requested FPC address — **high** for classification; downstream execution consequences unproven.

No separate finding retained for Claude F-1’s claimed recovery-to-victim-address exploit.