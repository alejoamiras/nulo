# Consolidated findings — 2026-09-13-high-prerelease

Target: `origin/dev` @ `62f3456a`. Inputs: 11 Claude cluster reports and 11 Codex cluster reports, each with a `## Cross-rebuttal` section (the c06 Codex report landed after two provider cyber-safety refusals — `raw/codex-runs/c06-dapp-bridge-dispatch.run{1,2}-refused.log` — and both c06 rebuttals were incorporated). Every `file:line` below was re-opened by the coordinator at HEAD; cluster agents' in-memory probes are cited as theirs, not re-run.

Bands are CVSS v4.0 qualitative bands (Critical ≥ 9.0 / High 7.0–8.9 / Medium 4.0–6.9 / Low 0.1–3.9), wallet-calibrated per the coordinator brief.

## Summary table

| ID | Band | Confidence | Title | Clusters | Found by | Cross-model |
|---|---|---|---|---|---|---|
| F-01 | High | high | Chain-identity check at every signing/authwit sink compares only the XOR composite; a lying RPC picks the signed `(l1ChainId, rollupVersion)` | c03, c06, c08, c09 | both | converged |
| F-02 | High | high | Approval popup renders only a subset of what is signed: stale transfer allowlist, hidden authwit caller/args/inner-hash, undisclosed discovered authwits | c07, c08 | both | converged (discovery instance: disagreement — resolved for, as disclosure only) |
| F-03 | High | high | Hostile backup plants a non-canonical `PrivateFpc` row that becomes the only selectable "Private Fee Juice" payer | c04 | both | converged |
| F-04 | High | high | Hostile backup mints a `kind:"mainnet"` row bound to an attacker RPC; default seeds are then suppressed for the profile | c09 | claude | disagreement — resolved for (restore-provenance mechanism stands; one exploit step corrected) |
| F-05 | High | high (mechanism) / moderate (real-world) | Passkey wallet master is reproducible by any `nulo.sh`-eligible web origin (shared RP ID + public PRF input) | c02, c10 | both | converged (Codex-found, Claude-adopted in both clusters) |
| F-06 | Medium | high | Same-master sibling profiles share the dApp-session MAC key and can derive each other's PXE store key | c02 (theme: c11) | both | converged |
| F-07 | Medium | high | Auth-registry rows carry no profile/chain provenance: address-only purge, sync-delete and read | c02, c04, c08 | both | converged |
| F-08 | Low | high | `aztec_simulateTx` public-static fast path authorizes by `name` but executes by `selector` | c06 | both | converged (Codex holds moderate confidence on impact; coordinator downgraded the band, see body) |
| F-09 | Medium | high | Production prover accepts an unauthenticated loopback HTTP accelerator and posts the private witness to it | c09, c10 | both | converged (c09 Claude non-finding overruled) |
| F-10 | Low | high | RPC errors flattened to strings bypass the logger's URL-credential scrub | c05, c10 | both | converged (Codex-found, Claude-adopted) |
| F-11 | Low | high | Operation-journal RPC surface has no active-profile/ownership binding (cross-profile disclosure; controller-less cancel) | c11 | both | converged |
| F-12 | Low | high | Restore paths persist unvalidated presentation data (unsanitized contact names; future-dated balance `updatedAt`) | c04, c11 | both | converged post-rebuttal |
| F-13 | Low | moderate | `AccountService` keyed reads bind profile/chain but not address; imported-branch signer follows the row body | c03, c04 | both | disagreement — resolved for, as Low (no untrusted writer found) |
| F-14 | Low | high | Offscreen transport: untargeted `runtime.sendMessage` broadcast + no sender check on the SW-side client/READY/PONG | c05 | both | converged post-rebuttal |
| F-15 | Low | high | Pending passkey-restore secret ignores its own TTL and survives explicit lock | c02 | both | converged (Codex-found, Claude-adopted) |
| F-16 | Low | high (mechanism) | `approveInteraction` executes caller-supplied operations with no binding to the stored interaction payload | c07 | both | converged post-rebuttal |
| F-17 | Low | high | `web_accessible_resources` exposes the logo to every origin — silent install fingerprint | c10 | both | converged |
| F-18 | Medium | high | Discovery flood caps skip the existing-session and duplicate-waiter branches; every reconnect handshake opens an uncapped verify window | c06 | both | converged post-rebuttal (Codex-found; Claude confirmed the window half at high, downgraded the waiter half) |

## Findings

### [High] F-01: Chain-identity check compares only the XOR composite — a lying RPC chooses the chain domain of every signed transaction and authwit

**Band:** High — integrity of all signed material (tx `TxContext`, authwit message hashes); attacker is the configured RPC (default endpoint is a third-party provider, `network/service.ts:102,111`); no user interaction beyond normal use; cross-chain redemption not demonstrated (keeps it below Critical).  **Confidence:** high  **Mapping:** OWASP A08:2021 / CWE-354 (Improper Validation of Integrity Check Value)
**Found by:** both   **Clusters:** c03, c06, c08, c09   **Cross-model:** converged (c09 Claude filed it as a non-finding because the helper is *called* everywhere; its rebuttal adopted the finding — the comparison, not the call coverage, is the defect. Codex c06 F-2 restates the same trace from the dispatcher side; the c06 Claude rebuttal correctly flags it as a duplicate of c08 — counted once here.)
**Instances:**
- `packages/aztec-runtime/src/utils/chain-identity.ts:34-36` (`SelectedNetworkChainInfo` carries only `chainId`), `:53-61` (composite-only compare), `:69-71` (`chainInfoFrom` forwards raw live values)
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:220-221,286` (standard build), `:404-407,414-418` (NO_FROM `TxContext`)
- `apps/extension/src/wallet/services/execution/service.ts:227-232` (estimate-reuse identity), `:872-879,935` (`executeAztecCreateAuthWit`)
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:853-863`; `authwit-discoverer.ts:106-110`; `discovery-probe.ts:73-75`; `fast-path.ts:176-183`; `view-executor.ts:207-211`; `helpers/batched-view-simulation.ts:203-205,357-366,538-547`
- Unguarded caller (no assert at all): `apps/extension/src/wallet/utils/fn.ts:85-95` via `apps/extension/src/wallet/services/token/service.ts:711,716,720` (metadata simulation; read-only)
**Description:** The stored network identity is `(l1ChainId ^ rollupVersion) >>> 0`. `assertLiveChainIdentity` recomputes that XOR from the live `getNodeInfo()` and compares composites. For any attacker-chosen `L'`, `rollupVersion' = stored ^ L'` collides. Every caller then embeds the *raw* live pair into what the account signs. The exact `l1ChainId` is already a first-class `Network` field (`network/spec.ts:36-39,69`) and endpoint add/edit already require exact equality with a comment naming this collision (`network/service.ts:565-572,612-618`) — that discipline never reached the signing-time gate.
**Trace:** RPC-controlled `node.getNodeInfo()` (`execution/service.ts:872`) → `assertLiveChainIdentity(network, nodeInfo)` compares only `(l1 ^ rv) >>> 0` (`chain-identity.ts:55-56`) → `metadata = {chainId: Fr(nodeInfo.l1ChainId), version: Fr(nodeInfo.rollupVersion)}` (`:876-879`) → `computeAuthWitMessageHash(intent, metadata)` (`:922`/`:929`) → `account.createAuthWit(messageHash)` (`:935`). Transaction arm: `tx-request-builder.ts:220-221` → `chainInfoFrom(nodeInfo)` at `:286` → `NuloAccount.buildTxExecutionRequest` (`packages/aztec-runtime/src/account/nulo-account.ts:184`).
**Why it matters:** Worked collision: mainnet is `(1, 4248422647)` → `4248422646` (`apps/extension/src/utils/chain-ids.ts:17-18,30`); `(2, 4248422644)` also → `4248422646`. The wallet's own F-012 invariant ("refuse to sign/prove against a drifted endpoint") is void. Key-model-v2 fixes *which key* signs (row-stored `l1ChainId`), not *which domain* it signs for. Precondition: a compromised, drifted, or MITM'd RPC the wallet is already configured to use — realistic for a wallet whose default RPC is a third-party load balancer, and trivially satisfied under F-04.
**Recommended fix:** Extend `SelectedNetworkChainInfo` to `{chainId, l1ChainId}`; in `assertLiveChainIdentity` require `nodeInfo.l1ChainId === network.l1ChainId` in addition to the composite (which then pins `rollupVersion` exactly); thread `network` (already in scope at every caller) unchanged. Route `fn.ts:85-95` through the same assert. Local networks (`chainId === 0`) should compare `l1ChainId` against `LOCAL_L1_CHAIN_ID`.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that with a stored mainnet row, a mocked `getNodeInfo()` returning `{l1ChainId: 2, rollupVersion: 4248422644}` passes `assertLiveChainIdentity` and reaches `computeAuthWitMessageHash` at `execution/service.ts:922` with `chainId = Fr(2)`.

---

### [High] F-02: Approval popup renders only a subset of what is signed

**Band:** High — the single control that turns a signature into informed consent fails on the most common real call shapes; attacker is any connected dApp with a transaction grant; a user click is required, but the click is the thing being deceived; direct fund movement follows.  **Confidence:** high  **Mapping:** OWASP A04:2021 / CWE-451 (UI Misrepresentation of Critical Information)
**Found by:** both   **Clusters:** c07 (transfer + authwit halves), c08 (discovered-authwit instance)   **Cross-model:** converged on (a)/(b); (c) is a cross-model disagreement — Codex c08 withdrew "discovery signs unchecked authority" as an *authorization* finding; resolved **for** as a *disclosure* instance of this finding (the authwit is real, signed, and shown nowhere).
**Instances:**
- (a) `apps/extension/src/utils/transfer-intent.ts:23` (four legacy names only), `:72` (`args.length !== 3`) vs the wallet's own descriptor table `apps/extension/src/wallet/services/token/functions/descriptors.ts:322-325` (2- and 4-arg variants), `:361-363` (`transfer`, `transfer_private_to_private` ranked above `transfer_in_private`); sink `apps/extension/src/popup/windows/execute/OperationCard.vue:117-156` — no fallback branch after the `v-if` at `:135`, contradicting the comment at `:115-116`. The confident label comes from a different table: `apps/extension/src/utils/tx-enrichment.ts:17,23-26`.
- (b) `OperationCard.vue:357-392` (`aztec_createAuthWit`): renders target + function name only — never `caller` (the delegate), never `call.args`, never the `innerHash`; execution hashes all of them (`execution/service.ts:909-922,925-929`) and signs (`:935`).
- (c) Kernelless discovery: `apps/extension/src/wallet/services/execution/discovery-probe.ts:80-90` keeps only `{contractAddress, innerHash}` and emits `add_private_authwit`; `fee/fee-juice-strategy.ts:32-39` appends it to `ctx.op.actions` at estimate time; `tx-request-builder.ts:146-161` signs the opaque hash. The popup iterates the original `exec.calls` only.
- (d) Lesser: dApp-supplied `exec/opts.authWitnesses`, `capsules`, `extraHashedArgs` are absent from the primary card (parsed at `tx-request-builder.ts:347-358`); they ARE visible in the JSON window (`apps/extension/src/popup/windows/json/index.vue:12,56`), so this is a prominence gap, not a hidden field.
**Description:** `handleSendTx` forwards the raw `args[0]` as `exec` (`packages/wallet-bridge/src/dispatcher.ts:941-952`). The popup's "do not guess" parser recognizes exactly four names at exactly three args; the pinned standard token's `transfer(to, amount)` and the 4-arg `_nonce` variants the wallet itself constructs both return `unverified`, and `unverified` renders *nothing* — no recipient, no amount, no warning. The authwit branch omits the one field that says who is being authorized. Discovered authwits are signed on the estimate path before the popup and never surfaced.
**Trace:** dApp `sendTx({calls:[{to: TOKEN, name: "transfer", args: [ATTACKER, AMOUNT]}]})` → `dispatcher.ts:946-952` → popup `OperationCard.vue:117` → `parseTransferIntent` returns `unverified` (`transfer-intent.ts:64-66`) → `:135` false → user sees "Transfer (private) on 0xTOKEN…" (`:126-128`, label from `tx-enrichment.ts:17`) → `approve()` forwards the untouched call (`popup/windows/execute/index.vue:412-446`) → `tx-request-builder.ts:184-188` encodes the real args.
**Why it matters:** The July "truthful approval display" remediation (B) is intact as a *sanitizer* but its *vocabulary* drifted from the token model; the result is the pre-F-008 state for the calls that matter. Any dApp holding a transaction grant can obtain approval for a transfer whose recipient and amount the user never saw. Blast radius: every `aztec_sendTx`/`aztec_createAuthWit` approval.
**Recommended fix:** (1) Derive the recognized-transfer set and arities from `TOKEN_FN_DESCRIPTORS` (one vocabulary) instead of a second hardcoded list. (2) Implement the promised fallback: for `unverified`, render indexed raw args with an explicit "unverified — review arguments" marker; never render a bare method label. (3) Authwit branch: render `caller`, args, and for `IntentInnerHash` the hash plus an "opaque authorization" warning. (4) Surface discovered authwits from the estimate (`dapp-send-executor.ts` returns fee fields — add the discovered `{consumer, innerHash}` list) and list them on the card.
**Effort:** days.
**Verification notes for Phase 4:** Confirm that an `aztec_sendTx` payload with `name: "transfer", args: [to, amount]` renders no `execute-op-structured-args` element and no warning in `OperationCard.vue`, while `tx-request-builder.ts:184-188` encodes those two args into the signed call.

---

### [High] F-03: Hostile backup plants a non-canonical `PrivateFpc` row that becomes the only selectable "Private Fee Juice" payer

**Band:** High — per the brief, a hostile backup that redirects fee payments is High; the crafted row is indistinguishable in the UI, suppresses the genuine option, and lands a `pay_fee()` call to an attacker contract inside the user's signed private transaction. Inclusion at the sequencer with a non-paying payer is unverified (keeps it below Critical).  **Confidence:** high  **Mapping:** OWASP A08:2021 / CWE-345 (Insufficient Verification of Data Authenticity), CWE-863
**Found by:** both   **Clusters:** c04   **Cross-model:** converged (Codex limits impact to "selection + unavailability"; the `account-state` compounding step that makes the row *callable* is Claude's and verified)
**Instances:**
- Root (no canonical-address check on restore): `apps/extension/src/wallet/services/fpc/service.ts:503-525`; enum `apps/extension/src/wallet/services/fpc/spec.ts:15-18` (`PrivateFpc = 2`)
- Type-only selection, `isProtocol` ignored: `apps/extension/src/popup/components/modules/send/fee-helpers.ts:157` (first `PrivateFpc`), `:161-163` (every other `PrivateFpc` row skipped), `:191-207` (option enabled iff balance non-zero), `:89-92` (`fpcId` into settings); `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:180-184` (`balance_of` read against the first row's address)
- Discovery appends the genuine row *after* the poisoned one: `fpc/service.ts:157-158,173-174,187`
- Execution sink: `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:101-106` → `getFpcImpl` (`fpc/service.ts:426-432`, ownership only) → `fpc/handlers/private-fpc-handler.ts:23-31` (`call pay_fee` at `fpc.address`)
- Compounding registration: `apps/extension/src/wallet/services/account-state/service.ts:384-400` registers any backup-supplied `{instance, artifact}`; `precheckContractAddress` (`:444-456`) skips only addresses 0–6
- Contrast (live edit path refuses a PrivateFpc address change): `fpc/service.ts:362-369`
**Description:** `FpcService.restore` accepts `{type: 2, address: X, name: "Private Fee Juice"}` after a shape parse. `getFpcs` sees no row at the canonical private address and appends the genuine one; `buildFeeMethods` picks the *first* `PrivateFpc` (the poisoned row) and `continue`s past the genuine one, so the canonical payer is unselectable. If the attacker's contract at `X` (registered into PXE by the same backup's `account-state` slice) answers `balance_of` non-zero, the option is enabled and the user's send carries `pay_fee()` to `X`.
**Trace:** backup `data.fpc[]` (checksum recomputable — `apps/extension/src/composables/useFullBackupImport.ts:93`) → `fpc/service.ts:498-525` writes the row → Send opens → `getFpcs` appends canonical after it (`:187`) → `fee-helpers.ts:157-163` selects poisoned row, hides canonical → user picks "Private Fee Juice" → `:92` `fpcId` → `fpc-strategy.ts:102-106` → `private-fpc-handler.ts:26-30` prepends `pay_fee` at attacker address into the transaction that is simulated, proven and signed.
**Why it matters:** The wallet's own header calls a wrong PrivateFPC address "unrecoverable loss" (`fpc/service.ts:40-42`, about deposits; the pay path here is a confused-deputy call executing attacker Noir inside the user's private tx). Precondition: victim imports a crafted/tampered backup — a live scam category; no other privilege.
**Recommended fix:** In `restore()`, force any `type ∈ {DefaultSponsoredFpc, PrivateFpc}` row whose address ≠ the derived protocol address (`getOrComputeProtocolAddresses`) to be rejected (recorded as `restoreError`). In `fee-helpers.ts:157` and `gas-balance-reader.ts:181` select `f.type === PrivateFpc && f.isProtocol === true` (the signal `fpc-strategy.ts:115` already uses). Optionally badge non-protocol rows.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that after `FpcService.restore([{type: 2, address: "0x…attacker", chainId, profileId, name: "Private Fee Juice"}])` and one `getFpcs(chainId)`, `buildFeeMethods(fpcs, {privateFeeJuice: "1"})` returns a single `private_fpc` option whose `fpc.address` is the restored address.

---

### [High] F-04: Hostile backup mints a `kind:"mainnet"` network row bound to an attacker RPC; default seeds are suppressed

**Band:** High — per the brief, a hostile backup that redirects RPC is High; the restored profile's only "mainnet" is the attacker's endpoint for every balance read, fee quote, simulation and broadcast; combined with F-01 the attacker also controls the signed chain domain.  **Confidence:** high  **Mapping:** OWASP A08:2021 / CWE-345, CWE-923 (Improper Restriction of Communication Channel to Intended Endpoint)
**Found by:** claude   **Clusters:** c09 (Codex NF-3 identified the same restore gap but did not trace the seed-suppression amplifier)   **Cross-model:** disagreement — resolved **for**. Codex's objection is correct on one exploit step (an attacker-*authored* backup cannot reproduce the victim's existing address without the victim's master) but does not touch the mechanism: a *doctored copy of the victim's own backup* (or any backup the victim is induced to import and then fund) restores the victim's real accounts behind a hostile endpoint. The "endpoint-add probing checks self-reported IDs" objection is why F-01 matters, not a mitigation.
**Instances:**
- `apps/extension/src/wallet/services/network/service.ts:1046-1059` (`validateRestoredNetwork`: schema + `(profileId, chainId)` collision only; never `assertCanonicalStoredL1` `:346-355`, never a probe)
- `:860-901` (`restore` writes the row), `:232-242` (`getOrInitNetworks` returns early when ≥1 row exists — seeds never land)
- `apps/extension/src/wallet/services/network/spec.ts:187-196` (`kind` is a free optional label; `:225-227` the only user-facing creator hardcodes `custom`)
- Entry: `apps/extension/src/composables/useFullBackupImport.ts:475-488` → `full-backup-restore.ts:267`
**Description:** `restore` is the only path that can write `kind: "mainnet"|"testnet"`. A row `{kind:"mainnet", l1ChainId: 1, chainId: 4248422646, endpoints:[{rpcUrl:"https://attacker"}]}` passes `NetworkSchema` (any HTTPS host), lands in a fresh profile with no collision, and because the profile now has a network row, `DEFAULT_SEEDS` (`:99-126`) are never seeded. `assertCanonicalStoredL1` would pass anyway (the attacker uses the genuine constant), so account derivation yields the user's real addresses and the UI is indistinguishable.
**Trace:** crafted `data.network[]` → `useFullBackupImport.ts:485` (profileId rewritten to the new profile) → `:488` → `full-backup-restore.ts:267` → `network/service.ts:885` `validateRestoredNetwork` (no seed/probe check) → `:889` `storage.set` → later `getOrInitNetworks` (`:241-242`) returns the attacker row → `networkInfoFrom(network).rpcUrl` (`network/spec.ts:92-95`) feeds `getNode`/`createNode` for every chain interaction.
**Why it matters:** Persistent, silent RPC-level MITM of the restored profile: fabricated balances/receipts, selective censorship, and — via F-01 — attacker-chosen signing domain. Precondition: importing a backup the attacker controls; the RPC-URL scheme allowlist (`spec.ts:152-179`) was designed against `javascript:`/plaintext, not against a hostile HTTPS operator.
**Recommended fix:** In `validateRestoredNetwork`, reject (or force to `kind: "custom"` with a distinct name) any row whose `kind` is a seeded kind unless its primary endpoint equals the in-code seed URL; then let `getOrInitNetworks` seed the genuine defaults regardless of restored rows (seed per-kind-missing, not all-or-nothing). Consider a live probe with exact-L1 equality at restore (mirror `:565-572`).
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that `NetworkService.restore([{kind:"mainnet", l1ChainId:1, chainId:4248422646, endpoints:[{id:"e1", rpcUrl:"https://attacker.example"}], primaryEndpointId:"e1", …}])` succeeds into an empty profile and a subsequent `getOrInitNetworks()` returns only that row.

---

### [High] F-05: Passkey wallet master is reproducible by any `nulo.sh`-eligible web origin

**Band:** High — full master-secret compromise (all derived accounts) with no extension involvement; preconditions are specific but realistic: script execution on `https://nulo.sh` or an eligible subdomain (the landing/tools sites are first-party web deployments, `fee-helpers.ts:215` defaults to `https://tools.nulo.sh`) plus one user-verified passkey ceremony on that page. Relabel to Potential High is not warranted: the mechanism is specification-defined, not inferred.  **Confidence:** high (mechanism; WebAuthn RP-ID + PRF semantics) / moderate (no physical-authenticator demonstration)  **Mapping:** OWASP A07:2021 / CWE-863, CWE-200
**Found by:** both (Codex found in c02 and c10; Claude adopted in both)   **Clusters:** c02, c10   **Cross-model:** converged post-rebuttal
**Instances:**
- `apps/extension/src/wallet/services/passkey/spec.ts:21` (`RP_ID = "nulo.sh"`); `apps/extension/manifest/manifest.config.ts:20` (host permission that lets the extension use that RP)
- `apps/extension/src/wallet/utils/passkey-ceremony.ts:33-36` (PRF input = SHA-256 of the public label), `:48-51,64` (create), `:68-77` (get: `rpId: RP_ID`, same PRF input), `:131-135` (credential id + PRF returned)
- `packages/wallet-crypto/src/constants.ts:10` (`PASSKEY_PRF_LABEL = "nulo:profile:v1"`, public)
- `packages/wallet-crypto/src/passkey-credential.ts:49-57,73-92` (master = HKDF(PRF, salt = H(label‖credentialId)) — no extension-exclusive input)
**Description:** WebAuthn lets any HTTPS origin whose effective domain is `nulo.sh` or a subdomain request an assertion with `rpId: "nulo.sh"`; the PRF extension output is a deterministic function of the credential and the `eval` input, which is a public constant. A page on such an origin that asks the user to "verify your Nulo wallet" receives `rawId` + `prf.results.first` and runs the published HKDF/reduce offline.
**Trace:** attacker script on an RP-eligible origin → `navigator.credentials.get({rpId:"nulo.sh", extensions:{prf:{eval:{first: SHA256("nulo:profile:v1")}}}})` (mirrors `passkey-ceremony.ts:68-77`) → user completes UV → page holds the same `{id, prf}` the extension would (`:131-135`) → `PasskeyCredential.create` + `deriveMasterSecret` (`passkey-credential.ts:49-92`) → master.
**Why it matters:** The extension's sender guard, credential-id equality check and CSP never run — the ceremony never touches the extension. Imported-account keys additionally need the DEK envelope, but every derived account is exposed. Precondition realism: a compromised first-party site or subdomain takeover, plus social engineering for one UV prompt.
**Recommended fix:** Pre-production is the only window: move `RP_ID` to a dedicated, content-less subdomain (e.g. `passkey.nulo.sh`) that never hosts application code, so `nulo.sh`/`tools.nulo.sh` are *not* RP-eligible for the credential (only that subdomain and its children are). Update `check-rp-id.ts` and the host permission. Changing `RP_ID` after launch bricks existing passkey wallets (`spec.ts:15`), so decide now. Additionally treat every `*.nulo.sh` deployment as key-material-adjacent (CSP, no third-party scripts).
**Effort:** hours (code) — plus the product decision.
**Verification notes for Phase 4:** Confirm that `buildGetOptions()` emits `rpId: "nulo.sh"` with a constant PRF input and that `PasskeyCredential.create({id, prf}).deriveMasterSecret()` consumes no input other than those two values.

---

### [Medium] F-06: Same-master sibling profiles share the dApp-session MAC key and can derive each other's PXE store key

**Band:** Medium — real cryptographic-separation break, but the attacker must already hold the shared master (a sibling profile from the same phrase) *and* raw storage/OPFS access; transaction confirmation remains enforced, so no unauthorized fund movement.  **Confidence:** high  **Mapping:** OWASP A02:2021 / CWE-323-class (key reuse across principals), CWE-863
**Found by:** both   **Clusters:** c02 (the same-phrase theme recurs in c11)   **Cross-model:** converged (MAC key: both independently; PXE key: Codex, Claude adopted and retracted its "done correctly" citation)
**Instances:**
- MAC key: `apps/extension/src/wallet/services/profile/service.ts:913-933` (IKM = master; fixed `salt`/`info`; `profileId` used only to fetch the secret) → `apps/extension/src/wallet/services/dapp-session/mac-storage.ts:30-34` (sign), `:85-104` (verify)
- PXE store key: `packages/wallet-crypto/src/pxe-store-key.ts:29-34` (salt = public `profileId`; own doc at `:15-16` concedes "profiles also have distinct masters today") ← `apps/extension/src/wallet/runtime.ts:542-544`
- Duplicate-phrase profiles are a supported, warned flow: `profile/service.ts:2004-2015` (`allowDuplicate`)
**Description:** Both derivations use the master as the only secret. Two profiles imported from one phrase have identical masters, so (a) a DappSession row forged for profile B verifies under B's key computed while A is unlocked (the row's `profileId` is covered by the MAC but the attacker computes the MAC), and (b) B's OPFS PXE database key is `HKDF(master, "nulo:pxe-store-salt:"+B.id)` — computable from A's master and B's public id. The DEK (credential-sealed, per profile) is the codebase's stated separator for exactly this attacker (`packages/wallet-crypto/src/entropy-mac.ts:12-15`).
**Trace (a):** attacker with A's master + storage write → crafts `DappSession{profileId: B, dappMetadata.url: attacker, accounts, capabilityGrants, …}` and MACs it with the master-only key → when B is unlocked, `mac-storage.ts:94-100` verifies → `background.ts:647-650` auto-approves discovery for that origin without a popup; `packages/wallet-bridge/src/dispatcher.ts` consumes the forged grants. Sends still hit `dapp-interaction/service.ts:586-589` (`Transactions = 5`, `session-types.ts:27`).
**Trace (b):** A's master → `derivePxeStoreKey(master, B.id)` → opens B's `pxe/<B>/<chain>` OPFS store, which holds imported-account privacy keys registered via `packages/aztec-runtime/src/pxe/service.ts:388`.
**Why it matters:** The F-12 row-integrity control and the per-profile PXE isolation both silently degrade to "same master ⇒ same key". The realistic attacker is another party who controls a sibling profile on a shared machine (the coordinator's calibration), or a storage/OPFS reader who obtained any sibling's master.
**Recommended fix:** Mix the profile DEK into both KDFs (`ikm = master ‖ dek`, as `entropy-mac.ts` already does for the envelope MAC). For the PXE key, accept that a degraded (DEK-less) session cannot open the store, or scope the DEK requirement to the imported-account subset. Pre-production: no migration needed (re-key on reinstall).
**Effort:** hours to a day (plus test updates: `dapp-session/service.test.ts:26-48` stubs the derivation and masks this).
**Verification notes for Phase 4:** Confirm that `deriveDappSessionMacKey(A)` and `deriveDappSessionMacKey(B)` produce keys that cross-verify a signed row when both profiles share one master, and that `derivePxeStoreKey(masterA, B.id)` equals B's own store key.

---

### [Medium] F-07: Auth-registry rows carry no profile/chain provenance — address-only purge, sync-delete and read

**Band:** Medium — integrity/availability of the only local index of live public authwits (hashes are not enumerable from chain, `auth-registry/service.ts:115-119`), triggerable by a hostile backup without any sibling; cross-profile disclosure of intent metadata; no on-chain grant is revoked or created.  **Confidence:** high  **Mapping:** OWASP A01:2021 / CWE-863, CWE-668
**Found by:** both   **Clusters:** c02 (profile-deletion purge), c04 (hostile-backup keyless reconciliation), c08 (cross-network sync delete + cross-profile read)   **Cross-model:** converged (each trigger was found by at least one family and confirmed by the other in rebuttal)
**Instances:**
- Row shape: `apps/extension/src/wallet/services/auth-registry/spec.ts:24-40` (no `profileId`, no `chainId`); `service.ts:71-82` (single flat root)
- Address-only read: `service.ts:132-134` (`getAuthwits`) ← UI `apps/extension/src/popup/pages/settings/advanced/account-state/authwits/index.vue:47`
- Address-only purge: `service.ts:428-448`; triggers: `service.ts:97-99` (`onAccountDeleted`), `apps/extension/src/wallet/services/profile-deletion/coordinator.ts:120` (unscoped, contrast `:119,121` which pass `profileId`), `apps/extension/src/wallet/services/account/service.ts:835-855` (keyless imported-account reconciliation, run unconditionally on import at `apps/extension/src/composables/useFullBackupImport.ts:534`)
- Cross-network sync delete: `service.ts:299-305` (caller-selected network) → `:346-350` loads every row for the address → `:358-374` deletes a row the *current* node reports non-consumable
- Restore does not prove key ownership: `account/service.ts:689` (collision on full tuple only)
**Description:** Addresses are chain- and profile-independent by construction (same phrase ⇒ same address; same address across networks). Every registry operation keys on `account` alone, so: (1) a backup carrying `type: Imported, address: A` with no key row is restored, reconciled as keyless, deleted, and its `onAccountDeleted` wipes *another profile's* authwits and status flag for `A`; (2) deleting profile X purges the sibling's index; (3) `syncRegistry(networkB, A)` deletes a grant that is live on network A because node B says it is not consumable.
**Trace (hostile backup):** `data.account[]` row `{type:1, address:A}` without an `imported-account-keys` entry → `account/service.ts:693-719` persists it (tuple collision only) → `useFullBackupImport.ts:534` → `reconcileImportedAccounts` (`account/service.ts:840-852`) emits `onAccountDeleted` → `auth-registry/service.ts:97-99` → `purgeForAccounts([A])` (`:432-446`) deletes every authwit row + status for `A` regardless of owner.
**Why it matters:** The wallet explicitly refuses auto-eviction because the index cannot be rebuilt (`spec.ts:19-22`); these three paths evict it anyway. Precondition for (1): the victim imports a crafted backup naming an address (public knowledge); for (2)/(3): ordinary use with a shared-address sibling or multi-network account.
**Recommended fix:** Add `profileId` + `chainId` to `Authwit` and the status key; scope `getAuthwits`, `purgeForAccounts`, `syncAuthwits` and the status store by `(profileId, chainId, account)`; in `reconcileImportedAccounts`, skip the auth purge (a never-keyed account has no local grants under this profile). Pre-production: no migration.
**Effort:** hours to a day.
**Verification notes for Phase 4:** Confirm that with an existing authwit row for address `A` in profile P1, restoring into a new profile P2 an `Imported`-type account row for `A` without a key row deletes P1's row via `reconcileImportedAccounts` → `purgeForAccounts`.

---

### [Low] F-08: `aztec_simulateTx` public-static fast path authorizes by `name` but executes by `selector`

**Band:** Low — a real scope-enforcement bypass, but the executable surface is PUBLIC+STATIC functions whose results are public chain state any dApp can read from a node without the wallet; the only wallet-added context is `fromAddr` as `msg_sender`, no state change, no signature. (Downgraded from Medium after the c06 Codex rebuttal correctly noted the trace establishes an authorization gap, not a confidentiality loss.)  **Confidence:** high (mechanism; the coordinator verified `name` and `selector` are independent dApp-supplied fields of the wire `FunctionCall`)  **Mapping:** OWASP A01:2021 / CWE-863
**Found by:** both   **Clusters:** c06   **Cross-model:** converged — identical trace from both families; Codex rates its own confidence moderate only because it could not read the upstream `simulateViaNode`, and disputes the confidentiality impact, which the coordinator accepts.
**Instances:**
- Scope check reads only `to`/`name`: `packages/wallet-bridge/src/method-scope-checkers.ts:31` (`WireCall`), `:166-170` (`matchesScope(String(call.to), call.name, scope)`), `:391-393`
- `exec` forwarded unchanged: `packages/wallet-bridge/src/dispatcher.ts:1467-1474`; routed at `apps/extension/src/wallet/services/execution/service.ts:635-637`
- Fast path admits calls by wire `type`/`isStatic` and a Zod shape parse only: `apps/extension/src/wallet/services/execution/fast-path.ts:96-110`; executes by selector via `simulateViaNode` `:200-211`; caller `view-executor.ts:242-246`
- Contrast (every other sink binds name↔selector): `execution/service.ts:900-908`
**Description:** `FunctionCall.name` and `.selector` are independent dApp-supplied fields. The checker matches the grant against `name`; the fast path never resolves the ABI function from `selector` and never compares it to `name` — the July unit-A bind was applied to `executeUtility`, sendTx, and authwit sinks, not to this later-added optimization.
**Trace:** dApp `simulateTx({calls:[{to: TOKEN, name: "balance_of_public", selector: <selector of another public static fn>, type: "public", isStatic: true, args}]})` → `checkSimulationTransactions` passes on `name` (`method-scope-checkers.ts:169`) → `rehydrateOptimizablePrefix` admits it (`fast-path.ts:99,109`) → `simulateViaNode(node, optimizableCalls, fromAddr, …)` (`:202-211`) executes the real selector → return value flows back in `TxSimulationResult`.
**Why it matters:** Defeats scope narrowing for simulation grants and is the one execution sink the unit-A bind missed; practical gain for the dApp is small because the reachable functions expose public state.
**Recommended fix:** In `executeAztecSimulateTx` (before `runFastPath`), resolve each optimizable call's artifact via `ContractResolver`, look up the function by `selector`, and reject on `fn.name !== call.name` — the same three lines as `execution/service.ts:900-908`. Add a `fast-path` test for the mismatch case (none exists).
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that a `simulateTx` call whose `name` matches the grant but whose `selector` belongs to a different public static function reaches `simulateViaNode` without any name↔selector comparison on the fast path.

---

### [Medium] F-09: Production prover accepts an unauthenticated loopback HTTP accelerator and posts the private witness to it

**Band:** Medium — confidentiality of the serialized private execution steps (note preimages, app-siloed nullifier secrets, all private circuit inputs); attacker is an unprivileged local process — including another OS user on a shared host — that binds `127.0.0.1:59833` before the genuine app; no browser or extension compromise; master/signing key not shown to be in the witness.  **Confidence:** high  **Mapping:** OWASP A07:2021 / CWE-306, CWE-200
**Found by:** both   **Clusters:** c09 (Codex), c10 (both)   **Cross-model:** converged; c09 Claude's non-finding ("upstream-documented, accepted") is overruled — the SDK exposes `httpsOnly` and the extension does not set it, so the exposure is an integration choice, and the SDK's own comment states the consequence (`accelerator-transport.ts:475`)
**Instances:**
- `apps/extension/src/accelerator/config.ts:22-24` (fixed `127.0.0.1:59833`, HTTP health URL)
- `apps/extension/src/offscreen/index.ts:100-116` (production passes `factory: undefined`)
- `packages/aztec-runtime/src/pxe/chain-runtime.ts:129-137,228-229,248` (`new AcceleratorProver({simulator, onPhase: undefined, accelerator: undefined})` — no `httpsOnly`)
- Pinned SDK `@alejoamiras/aztec-accelerator@5.2.0` (`apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/`): `accelerator-transport.ts:372` (`httpsOnly = false` default), `:603-605` (dual HTTP/HTTPS probe unless https-only), `:666-677` (a healthy HTTP wins after the grace window), `:201-205` (health = shape check), `:475` ("any local account that binds 127.0.0.1:59833 answers it and receives the witness"), `:740-758` (`POST /prove`, no auth header); `accelerator-prover.ts:407,426` (serialize + post)
**Description:** Every production wallet auto-discovers the accelerator over plaintext loopback HTTP. Health is a JSON-shape contract, not authentication. When no genuine HTTPS accelerator is healthy, a squatter answering `{status:"ok", api_version:1}` is selected and receives the full `PrivateExecutionStep[]` of the next proof.
**Trace:** `offscreen/index.ts:100` → `ProductionPxeFactory` default → `chain-runtime.ts:229` → `createPXE(..., {proverOrOptions: prover})` (`:248`) → on prove, `accelerator-prover.ts:351` probe → `accelerator-transport.ts:605` fires HTTP probe → `:669-677` accepts healthy HTTP → `accelerator-prover.ts:407` serializes steps → `:426` `postProve` → `accelerator-transport.ts:745-758` POST to `http://127.0.0.1:59833/prove`.
**Why it matters:** Silent, repeatable per-transaction privacy loss on multi-user or partially compromised hosts; a returned error just falls back to WASM with no user signal.
**Recommended fix:** Construct the production prover with `httpsOnly: true` (SDK-supported; its HTTPS path uses a name-constrained local CA per the SDK README) — users without the HTTPS-capable accelerator fall back to WASM, which is the current UX for users without the app at all. Alternatively require an explicit user opt-in before enabling accelerator discovery.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that with a mocked `fetch` answering `http://127.0.0.1:59833/health` with `{status:"ok", api_version:1}` and HTTPS refused, the transport selects HTTP and `postProve` sends the serialized steps without any authentication header.

---

### [Low] F-10: RPC errors flattened to strings bypass the logger's URL-credential scrub

**Band:** Low — confidentiality of an API key embedded in a custom RPC URL path/query; needs the user to export/share logs (or developer-mode retention plus a reader); impact scales with the provider key's authority.  **Confidence:** high  **Mapping:** OWASP A09:2021 / CWE-532
**Found by:** both (Codex in c05 and c10; Claude adopted in both)   **Clusters:** c05, c10   **Cross-model:** converged post-rebuttal
**Instances:**
- Producer: `packages/aztec-runtime/src/utils/fetch.ts:76,78,89` (full `host` URL in `Error.message`)
- Flatten-before-log: `packages/aztec-runtime/src/pxe/service.ts:926-927` (`errorMessageFromUnknown`), `apps/extension/src/wallet/services/network/service.ts:1003` (`getErrorMessage`); helpers `packages/wallet-core/src/utils/errors.ts:8-14,29`
- Sink: `apps/extension/src/wallet/logger/utils.ts:169-174` (`projectError` scrubs only `Error` instances), `:263` (primitive strings returned verbatim); `logger/store.ts:68-73` (buffer + console), `:107-118` (session persistence under developer mode); CSV `apps/extension/src/components/JsonViewer/logs-csv.ts:11-25`
- Other flatten sites (pattern, not individually proven to carry a URL): listed in c05 Codex F-1 §10 and c10 Codex F-3 §10
**Description:** The redactor is key-name/shape based. `trim()` scrubs URLs from `Error` objects and from `URL_KEYS`-named fields; a pre-flattened message string is opaque to it. The RPC transport interpolates the complete endpoint URL into every failure message, and the two most common consumers flatten before logging at Error level.
**Trace:** RPC 401/timeout → `fetch.ts:89` `Error("Error 401 from server https://rpc/v2/<KEY>: …")` → `network/service.ts:1003` `this.logError("…", getErrorMessage(error))` → `logger/utils.ts:263` returns the string unchanged → `store.ts:68-73` → log viewer / CSV export.
**Why it matters:** Exactly the leak the `scrubUrls` control exists for, on the endpoint the user is most likely to have a key in (custom provider URLs); `log-payload-ban.test.ts` cannot see it (indirection).
**Recommended fix:** Pass `Error` objects (not messages) to the logger at the two demonstrated sites and audit the listed flatten sites; add `scrubUrls` to the primitive-string branch of `trim()` as a backstop; extend `log-payload-ban.test.ts` to flag `getErrorMessage(`/`errorMessageFromUnknown(` used as a log argument.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that `trim(getErrorMessage(new Error("Error 401 from server https://h/p/KEY: x")))` returns a string still containing `KEY`, while `trim(new Error(...))` does not.

---

### [Low] F-11: Operation-journal RPC surface has no active-profile/ownership binding

**Band:** Low — (a) cross-profile disclosure of token-import metadata via ordinary navigation, limited to same-address sibling profiles; (b) a displayed "cancelled" transfer that still broadcasts, but only for an admitted same-extension caller (no popup/composable calls `transitionOperation`/`deleteOperation` — grep of `popup/`, `composables/`, `stores/`, `components/`, `onboarding/` at HEAD is empty).  **Confidence:** high  **Mapping:** OWASP A01:2021 / CWE-862
**Found by:** both   **Clusters:** c11   **Cross-model:** converged (Claude: the `TokensView` sink; Codex: the cancel-desync and the RPC inventory). The unscoped reads were already listed as latent in `audit/security/2026-07-06-max/report.md:160`; the UI sink and the cancel bypass are new.
**Instances:**
- RPC exposure: `apps/extension/src/wallet/services/operation-journal/service.ts:47-55`; no ownership check in `transitionOperation` `:297-333`, `setOperationMeta` `:349-369`, `getOperation` `:401-405`, `getOperations` `:407-420` (`profileId` optional), `deleteOperation` `:445-455`
- Consumer without a profile filter: `apps/extension/src/popup/components/modules/general/TokensView.vue:49-61` (kind + address + time only), `:204` (kind-only query), `:428-429` (renders `TokenImportRow`); contrast `RecentActivityView.vue:279-291` (checks `op.profileId`)
- Cancel desync: `apps/extension/src/wallet/services/execution/transfer-executor.ts:106-120` (journal failures swallowed; `checkCancelled` reads only the controller signal); `execution-lane.ts:174-200` (the correct, profile-gated cancel path a direct journal write bypasses)
- Same shape on `transaction/service.ts:130-140` (`getTransaction`/`getTransactions` by address; every present caller re-filters)
**Description:** Journal rows are stamped with `profileId` but no method enforces it. The Tokens view queries by kind and filters by account address, so a same-phrase sibling's in-flight or recently-failed token import (title, contract, failure reason) renders in the active profile. A privileged internal caller can move a proving transfer to `cancelled` (legal FSM edge) without aborting its controller; execution proceeds to broadcast while the UI shows cancelled, and a later genuine `cancelJob` drops on the terminal state.
**Trace (a):** B imports a token → `token/service.ts:345-349` journals `{profileId: B, accountAddress: A}` → user switches to sibling A (same address) → `TokensView.vue:204` `getOperations({kind})` → `service.ts:410-419` returns B's row → `:52-58` keeps it → `:429` renders.
**Why it matters:** The codebase treats the active profile as an authorization boundary everywhere else (`requireOwnedRow`); this service is the outlier, and its writers are execution-lifecycle internals that should not be popup-reachable at all.
**Recommended fix:** Gate every journal method on `record.profileId === activeProfile.id` (mirror `execution-lane.ts:174-177`); drop `transitionOperation`/`setOperationMeta`/`deleteOperation` from the popup-reachable `rpcMethods` (execution owns lifecycle writes in-process); add `op.profileId === appStore.profile.id` to `TokensView.vue:52`.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that `OperationJournalService.getOperations({kind: "token_import"})` returns rows stamped with a non-active `profileId` and that `TokensView.vue`'s `visibleTokenImports` does not compare `op.profileId`.

---

### [Low] F-12: Restore paths persist unvalidated presentation data (contact names, balance freshness)

**Band:** Low — display-integrity only: a hostile backup can plant a bidi-manipulated recipient label in the Send picker (address still shown alongside) and a fabricated balance that automatic refresh treats as fresh until an event-driven or manual refresh corrects it.  **Confidence:** high (traces) / moderate (deception yield)  **Mapping:** OWASP A08:2021 / CWE-451, CWE-20
**Found by:** both (contacts: Claude c04, Codex adopted narrowed; balances: Codex c11, Claude adopted)   **Clusters:** c04, c11   **Cross-model:** converged post-rebuttal
**Instances:**
- Contacts: `apps/extension/src/wallet/services/contact/service.ts:298-306` (restore: schema only) vs `:188-189` (import applies `sanitizeString`); `apps/extension/src/utils/string.ts:33-42` (strips everything outside `[\p{L}0-9 \-._]` — bidi/zero-width controls are removed; confusable *letters* are not); sinks `apps/extension/src/popup/components/modules/send/RecipientField.vue:41-44,100-104,129`
- Balances: `apps/extension/src/wallet/services/token-balance/service.ts:710-716` (spreads backup `publicBalance`/`privateBalance`/`updatedAt`; overrides identity only); `token-balance/spec.ts:54` (`updatedAt: z.number()` unbounded); `reconcile-pairs.ts:143` (only `updatedAt === 0` re-projects); `apps/extension/src/utils/core.ts:142,160` (negative age ⇒ fresh)
**Description:** Two restore paths trust backup-supplied presentation fields that every live path validates or derives. A contact named with U+202E etc. reorders the label the user selects a recipient from; a balance row with `updatedAt: 9999999999999` is never auto-refreshed.
**Trace (balance):** backup `token-balance[]` row → `service.ts:710` parse keeps amounts + timestamp → `TokenCard` renders → `core.ts:160` `Date.now() - updatedAt >= 30 min` false forever → no refresh; `reconcile-pairs.ts:143` skips (non-zero).
**Why it matters:** Same precondition as F-03/F-04 (hostile backup); much smaller impact — but a fake "received" balance is the classic lure for off-chain delivery scams.
**Recommended fix:** `ContactService.restore`: apply `sanitizeString(name, 20)`. `TokenBalanceService.restore`: force `updatedAt: 0` (or clamp to `Math.min(updatedAt, Date.now())`) so reconciliation re-projects on activation.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that `ContactService.restore` writes a `name` containing U+202E unchanged, and that `TokenBalanceService.restore` persists a backup `updatedAt` greater than `Date.now()` which `refreshBalances` then never refreshes.

---

### [Low] F-13: `AccountService` keyed reads bind profile/chain but not address; the imported-signer branch follows the row body

**Band:** Low — genuine defense-in-depth gap with a named precondition: a raw `chrome.storage.local` writer (no untrusted production writer found by either family; backup restore keys rows from their own body, `account/service.ts:714-718`); consequence is which of the victim's *own* accounts signs an authorized operation.  **Confidence:** moderate (defect certain; reachability undemonstrated)  **Mapping:** OWASP A01:2021 / CWE-863
**Found by:** both (Codex in c03 and c04; Claude adopted at moderate)   **Clusters:** c03, c04   **Cross-model:** disagreement on reachability — resolved for, as Low
**Instances:** `apps/extension/src/wallet/services/account/service.ts:84` (no `requireKeyIdentityMatch`), `:177-180` (`getAccount`), `:334-341` (`getAccountContract` checks `profileId`/`chainId`, not `address`, then dispatches on the body), `:367-387` (imported loader keys the ciphertext by `account.address` and compares the rebuilt address to the body, not the request), `:405-408` (`exportAccount`); contrast `:349-353` (derived branch compares to the requested `address`) and `:100-106` (`liveRows` enforces key/body agreement for bulk reads); `imported-keys-repository.ts:26-29` (checks the full tuple, but receives the substituted address)
**Description:** Placing imported account B's valid row under A's composite key makes `getAccountContract(P, C, A)` return B's signer; the HKDF/AES binding is not defeated — the lookup is redirected before it runs. Fresh dispatcher resolution filters through `liveRows`, so the window is "after account selection, before signer lookup".
**Trace:** raw write of B's row at key `accountRowId(P, C, A)` → `service.ts:336-337` passes → `:340-341` → `:368` loads B's key row → `:378-386` rebuilds B, compares to body (B) → returned to `execution/service.ts:869,935` which signs as B for an op authorized for A.
**Why it matters:** The row-identity guard the codebase built for this class (`packages/wallet-core/src/storage/entity_storage.ts` `requireKeyIdentityMatch`) is opt-in and not enabled on the account root.
**Recommended fix:** In every keyed read require `account.address === address` (or enable the composite-key identity check used by `liveRows`), and in `loadImportedAccountContract` compare the rebuilt address to the *requested* address.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that `getAccountContract(P, C, A)` with B's row stored under A's key returns a contract whose `address` is B, given both accounts are imported in the same profile/chain.

---

### [Low] F-14: Offscreen transport — untargeted broadcast plus no sender check on the SW-side client, READY and PONG listeners

**Band:** Low — precondition is an already-compromised same-extension page (no path from a web page: the content-script relay emits only SDK-shaped envelopes, and extension-originated `runtime.sendMessage` is not delivered to content scripts); consequences: passive capture of the PXE store key, forged responses/cancellations for observed requests, false readiness.  **Confidence:** high  **Mapping:** OWASP A07:2021 / CWE-306, CWE-200
**Found by:** both   **Clusters:** c05   **Cross-model:** converged post-rebuttal (Claude's F-1 + Codex's F-2/F-3 share the broadcast root)
**Instances:**
- `packages/extension-messaging/src/offscreen/client.ts:60-66` (no `sender`; routes on attacker-supplied `to`/`from`), `:136` (`sendEnvelope` broadcasts `from: this.uid` in the clear)
- `apps/extension/src/wallet/utils/offscreen.ts:97-104` (READY), `:170-177` (PONG), `:71-81` (Firefox ADOPT predicate admits any no-tab same-extension sender)
- Key on the wire: `packages/aztec-runtime/src/pxe/client.ts:198-200` (`provisionChainStoreKey` params carry the base64 key) → accepted for an unseen profile at `packages/aztec-runtime/src/pxe/service.ts:775-806`
- Contrast (gated): `offscreen/service.ts:38-41`, `background/service.ts:45`, predicate `core/sender-auth.ts:17-23`
**Description:** The July unit-G sender check was applied to the two *service-side* listeners; the SW-side client, the lifecycle listeners and the broadcast primitive were not covered. Any same-extension listener sees every request (including the 32-byte store key) and can settle a pending request by echoing `{to: uid, content:{requestId}}`.
**Trace:** compromised popup adds `runtime.onMessage` listener → observes `offscreen/client.ts:136` envelope (`from: uid`, `content.requestId`, key bytes at `pxe/client.ts:200`) → sends `{type: Response, from: "pxe", to: uid, content:{requestId, result: []}}` → `client.ts:62-63` → `core/base-client.ts` settles the pending call.
**Why it matters:** Symmetry debt on a documented invariant; the store key is the one secret that crosses this seam.
**Recommended fix:** Add `isTrustedInternalSender(sender)` to `offscreen/client.ts:60` and the READY/PONG listeners; move SW↔offscreen traffic (at minimum key provisioning) to a `chrome.runtime.connect` Port instead of broadcast `sendMessage`.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that `offscreen/client.ts`'s listener signature takes no `sender` argument and that `sendEnvelope` uses `chrome.runtime.sendMessage` with the client `uid` in the envelope.

---

### [Low] F-15: Pending passkey-restore secret ignores its own TTL and survives explicit lock

**Band:** Low — a stale, previously authorized restore can open a full (DEK-bearing) session after the 30-minute cache lifetime and after an explicit lock; needs an unfinished passkey restore, a surviving service worker, and the delayed internal continuation — narrow but a concrete authorization-lifetime defect.  **Confidence:** high (mechanism)  **Mapping:** OWASP A07:2021 / CWE-287
**Found by:** both (Codex; Claude adopted)   **Clusters:** c02   **Cross-model:** converged post-rebuttal
**Instances:** `apps/extension/src/wallet/services/profile/service.ts:2514,2517-2525` (stash with `capturedAt`), `:183-200` (sweep skips `exceptId`), `:2561` (finalize sweeps with its own id excluded), `:2651-2689` (`finalizePasskeyRestoreHoldingLock` never reads `capturedAt`; opens at `:2681`), `:853-870` (`lockActiveProfile` closes only the `SessionManager`); contrast `:221-225` (`consumeDekRewrapContext` enforces the TTL on the excluded entry)
**Trace:** restore stashes `{secret, dek, capturedAt}` (`:2517`) → user locks (`:856`, map untouched) → 31 min later the import continuation (`apps/extension/src/composables/useFullBackupImport.ts:546`) calls `finalizeRestore(id)` → `:2561` sweep excludes `id` → `:2652` retrieves it, no age check → `:2681` `openSessionVerified(profile, secret, undefined, dek)`.
**Recommended fix:** In `finalizePasskeyRestoreHoldingLock`, reject when `Date.now() - pending.capturedAt >= PENDING_RESTORE_TTL_MS` (mirror `:221-225`); clear `pendingRestoreSecrets`/`pendingDekRewraps` in `lockActiveProfile`.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that `finalizePasskeyRestoreHoldingLock` consumes a `pendingRestoreSecrets` entry whose `capturedAt` is older than `PENDING_RESTORE_TTL_MS` (`:168`) and that `lockActiveProfile` does not touch that map.

---

### [Low] F-16: `approveInteraction` executes caller-supplied operations with no binding to the stored interaction payload

**Band:** Low — the brief's canonical "requires a compromised popup" defense-in-depth gap; a buggy or compromised approval window can substitute operations/origin for a live request id, or approve a discovery-shaped id that skips session revalidation. No web-page path.  **Confidence:** high (mechanism)  **Mapping:** OWASP A01:2021 / CWE-863, CWE-639
**Found by:** both (Codex; Claude had filed it as a non-finding and upgraded)   **Clusters:** c07   **Cross-model:** converged post-rebuttal
**Instances:** `apps/extension/src/wallet/services/dapp-interaction/service.ts:150-155` (payload read by id only), `:158-186` (operations + origin taken from the caller; record deleted; forwarded), `:245-279` (`executeAndResolve` checks profile/session liveness only when `"session" in payload`, then executes the supplied array); caller `apps/extension/src/popup/windows/execute/index.vue:412-446`
**Description:** Approval authority is attached to a request id, not to the stored operation contents or the owning window. Downstream validation checks the operation *supplied*, never its equality with `interaction.payload.params.operations`.
**Trace:** `approveInteraction(idA, replacementOps, forgedOrigin)` from any `isTrustedInternalSender` context → `:164-176` claims the id → `:186` → `:272-279` `executionService.executeOperations(replacementOps, forgedOrigin, …)`.
**Recommended fix:** Materialize the executable operations SW-side from the stored payload and accept from the popup only the wallet-generated deltas (`feeSettings`, `previewedInterface`, estimate ids) per index; reject `approveInteraction` for payloads without `session`.
**Effort:** days.
**Verification notes for Phase 4:** Confirm that `approveInteraction` performs no comparison between its `operations` argument and `interaction.payload.params.operations` before `executeOperations`.

---

### [Low] F-17: `web_accessible_resources` exposes the logo to every origin — silent install fingerprint

**Band:** Low — privacy/targeting only: any page can probe `chrome-extension://<id>/src/assets/logo.png` and learn the wallet is installed, with no interaction.  **Confidence:** high  **Mapping:** OWASP A05:2021 / CWE-200
**Found by:** both   **Clusters:** c10   **Cross-model:** converged
**Instances:** `apps/extension/manifest/manifest.config.ts:55-60` (`matches: ["*://*/*"]`); the resource is handed to dApps as the discovery `walletIcon` (`apps/extension/src/wallet/services/wallet-sdk/background.ts:106`), which is why it is web-accessible at all.
**Description:** The icon must be loadable by dApps that complete discovery, but the manifest makes it loadable by every origin regardless of discovery, enabling targeted phishing.
**Recommended fix:** Serve the icon inline (data: URI) in the discovery response and drop the `web_accessible_resources` entry, or narrow `matches` to first-party origins if the SDK requires a URL.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm the manifest exposes `src/assets/logo.png` under `matches: ["*://*/*"]` and that `background.ts:106` is its only consumer.

---

### [Medium] F-18: Discovery flood caps skip the existing-session and duplicate-waiter branches; every reconnect handshake opens an uncapped verify window

**Band:** Medium (low end) — availability only, but zero-interaction and unbounded: any origin the user has connected once (and not ticked "always trust" for) can spawn real OS popup windows at will until the user revokes the session; it is a bypass of the July unit-D flood caps rather than a new resource class. The duplicate-waiter half is memory-only and bounded by one popup's lifetime.  **Confidence:** high (both branches verified at source; Codex's harness reproduced 40 window-creation calls and 256 retained waiters — theirs, not re-run)  **Mapping:** OWASP A04:2021 / CWE-770 (Allocation of Resources Without Limits or Throttling)
**Found by:** both (Codex c06 F-3; Claude c06 rebuttal confirmed the window half at high confidence and downgraded the waiter half to Low/moderate)   **Clusters:** c06   **Cross-model:** converged post-rebuttal
**Instances:**
- Cap bypass, existing-session branch: `apps/extension/src/wallet/services/wallet-sdk/background.ts:647-650` (`tryGetDappSessionByOriginAndChain` → `autoApproveExistingSession` → `return`) runs before `checkDiscoveryPopupCaps` at `:670`; the caps themselves `:606-607` (32 global / 4 per origin) count only `pendingDiscoveryPromises` keys (`:748-751`)
- Cap bypass, duplicate-waiter branch: `:663-668` (`pendingDiscoveryPromises.get(dedupeKey)` → `awaitPendingPopupDedupe` → `return`) — each fresh `requestId` retains a waiter at `:718`; cleared only when the single popup resolves (`:833-835`)
- Uncapped verify window: `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:143-154` — `needsVerification = isNewConnection || !dappSession.trustedVerification` → `chrome.windows.create(...)` on every established transport session; no coalescing, no count, no per-origin limit; `trustedVerification` is optional (`dapp-session/spec.ts:56`) and becomes `true` only through the checkbox at `apps/extension/src/popup/windows/verify/index.vue:73-75`
**Description:** The unit-D caps bound *connection popups* on the fresh-connection path. A remembered origin never takes that path: each new discovery is auto-approved (`:647-650`), key exchange completes, `handleSessionEstablished` runs, and — unless the user previously ticked "always trust" — a verify window is created for every handshake. Nothing bounds how many such handshakes an origin may run. Separately, while one connect popup is pending, unlimited duplicate discoveries for the same `(origin, chainId)` are retained as waiters without touching the cap accounting.
**Trace (windows):** page at a previously connected origin repeats the SDK discovery handshake with fresh request ids → `handleDiscovery` (`background.ts:619`) → `:647` finds the remembered `DappSession` → `:649` `approveDiscovery` (no cap check) → upstream key exchange → `handleSessionEstablished` (`session-established.ts:61`) → `:94` row found, `:141` stamped → `:143` `needsVerification` true (`trustedVerification` unset) → `:145` `chrome.windows.create` → repeat.
**Why it matters:** The July remediation D was written to stop a dApp from spawning unbounded popup work; its cap is on the wrong branch for the common case (a dApp the user already connected). Precondition: one prior approval of the origin and the default (unticked) trust checkbox — ordinary state for most connected dApps. Impact stays availability/annoyance (no authorization, secret or fund effect), which is why this is not High.
**Recommended fix:** (1) Coalesce verify windows per `(origin, chainId)` — reuse/focus an open verify window instead of creating another, and apply the same 4-per-origin/32-global cap to `chrome.windows.create` calls from `session-established.ts`. (2) Count duplicate waiters in `checkDiscoveryPopupCaps` (or reject duplicate request ids beyond a small per-key bound before `awaitPendingPopupDedupe`). (3) Run `checkDiscoveryPopupCaps` before the existing-session auto-approve, or rate-limit auto-approvals per origin.
**Effort:** hours.
**Verification notes for Phase 4:** Confirm that with a stored `DappSession` for `(origin, chainId)` whose `trustedVerification` is unset, N repeated discovery→key-exchange handshakes from that origin reach `chrome.windows.create` at `session-established.ts:145` N times with no branch consulting `DISCOVERY_PENDING_PER_ORIGIN_CAP`.

## Findings NOT pursued (with reasoning)

- **c01 Claude F-1 — unzeroized password bytes in `getPasshash` (`packages/wallet-crypto/src/encryption-key.ts:122-125`) + the additional copies in Codex NF-12/13.** Real hygiene gap, no disclosure sink; needs an independent memory-read primitive. Negative-list defense-in-depth. Noted under cross-cutting.
- **c01 Claude F-2 — strict-mode toggle racing `SessionManager.open()`.** Claude's own rebuttal retracted the persistent-bearer outcome (shared facade lock, `profile/service.ts:265-270`); residual is a microtask-scale transient. No exploit.
- **c02 Claude F-2 — whole-envelope swap opens a derived-only session.** Withdrawn by its author: documented accepted residual (`implementations-plan/mac-identity-binding/plan.md` "Accepted residuals"); the integrity delegate rejects mismatching derived accounts.
- **c03 Claude F-2 — 12-nibble truncated address on account-import preview (`import.vue:227`).** Display weakness is real; the vanity-grind exploit (~2^48 address derivations) has no feasibility evidence, the full address is copyable, and the software comparison is exact (`account/service.ts:473`). Cross-cutting note.
- **c07 Claude F-2 — `authWitnesses`/`capsules` not on the primary card.** Folded into F-02 instance (d): visible in the JSON window; no authorization consequence traced.
- **c07 Codex F-3 — `register_token` metadata refetched at persist time (`token/service.ts:368-403`).** Real TOCTOU, but the metadata is contract-controlled by design either way and the address is always rendered; impact is the token's own local label/decimals. Cross-cutting note.
- **c08 Claude F-2 — `buildNoFrom` registers contracts before the chain-identity assert (`tx-request-builder.ts:381-407`).** Ordering deviation from `resolveBuildContext`'s documented rule; Codex showed artifact resolution uses PXE/known artifacts, and no harmful persisted row was demonstrated. Subsumed by F-01's fix scope.
- **c08 Claude F-3 — dApp gas limits honored verbatim on self-pay.** The inflated maximum is displayed before approval (`FeeSettingsCard.vue`); no concealed charge. Fee-policy observation.
- **c08 Claude F-4 — user-added FPC rows validated by duck-typing.** User-consented trust decision; protocol identity is derived separately (`fpc/service.ts:126-131`); no unauthorized-spend sink. Refuted by Codex; agreed.
- **c08 Codex F-4 — `registerContract` mutates PXE before the address comparison (`packages/aztec-runtime/src/pxe/service.ts:449-450`).** Real ordering defect; consequence is a PXE registry entry for an address outside the grant, which confers no call permission. Below floor.
- **c09 Claude F-2 / Codex F-5 — node-sourced `ContractInstance` not anchored to the queried address (`contract-resolver.ts:127-133`, `fpc/service.ts:292-323`).** Needs a lying RPC and a user manually adding a custom FPC the wallet never claims is canonical. Below floor; the lying-RPC theme is cross-cutting.
- **c09 Codex F-2 — RPC-fabricated incoming-transfer receipts.** Inherent to trusting a node with no client-verifiable inclusion proof; same trust root as balances. Cross-cutting, not a Nulo-layer defect.
- **c09 Codex F-3 — unbounded reconciliation restart on scan errors (`incoming-transfer/service.ts:1693-1733`).** Availability-only against an RPC the user selected; no security property beyond what a stalling RPC already achieves. Cross-cutting note (worth a backoff).
- **c10 Claude F-2 — missing `autocomplete` on secret fields.** No trace of a browser capturing the value; unverified heuristic. Hardening suggestion.
- **c10 Claude F-3 — CSV formula injection in the log export (`logs-csv.ts:24`).** Sink is unneutralized but Codex showed the candidate source (`utils/core.ts:164`) receives reconstructed `Error` objects; no attacker-controlled unprefixed cell traced. Author downgraded; cross-cutting note.
- **c11 Codex F-1 — queued `deleteToken` deletes a replacement row after numeric-id reuse (`token/service.ts:545-571`).** Requires two queued deletes interleaved with a restore under one lock; correctness bug with no attacker; author downgraded to moderate.
- **c06 Codex N-2 / Claude rebuttal — top-frame `about:blank`/`data:` origin attribution and same-tab navigation cleanup (`content-script-validator.ts:93`, `tab-lifecycle.ts:26`).** Both families mark this *unresolved*, not safe: it depends on upstream `@aztec/wallet-sdk` transport behavior neither read. No trace; recorded as an open question for the upstream-coordination list, not a finding.

## Cross-cutting observations

1. **Backup import is a trust boundary defended by shape, not semantics.** The checksum is self-consistent by design (`useFullBackupImport.ts:93`), `normalizeAllIds` closes profile grafting, and F-011/F-06 (URL scheme, config allowlist) hold — but identity-bearing rows (network endpoints F-04, protocol FPC rows F-03, keyless imported accounts F-07, contact names and balance freshness F-12, `account-state` contract registration F-03) are accepted as truth. A single "restored rows are hostile until re-derived" review of every `restore()` would close four findings.
2. **Same-phrase sibling profiles are a supported flow the isolation model does not fully honour.** Separation keyed on the master alone (F-06) and rows keyed on the address alone (F-07, F-11, `transaction/service.ts:130-140`) collapse when two profiles share a master/address. The DEK is the intended separator; use it consistently.
3. **`isTrustedInternalSender` is the only gate on the SW RPC surface; per-method ownership and request binding are inconsistent.** Journal writes (F-11), `approveInteraction` (F-16), account keyed reads (F-13) and the offscreen client (F-14) each trust a same-extension caller with no further check. One trust tier, many principals.
4. **RPC honesty is the unstated trust root.** Node info (F-01), balances, incoming receipts, contract instances, fee quotes — none is client-verifiable. F-01 is the one place the wallet *claims* to verify and does not; the rest should be documented as accepted RPC trust with the default third-party endpoint named as the risk.
5. **Display vocabularies drift.** `transfer-intent.ts`, `tx-enrichment.ts` and `token/functions/descriptors.ts` each hardcode transfer semantics; only the last is maintained (F-02). Derive, don't duplicate.
6. **Logging: the key-name redactor is defeated by string flattening (F-10); the CSV sink has no formula neutralization; `getErrorMessage` is the idiom that turns an `Error` into an unscrubbable string.** Route errors, not messages.
7. **Local-service trust.** The accelerator (F-09) is the only non-loopback-URL-allowlisted local peer; the extension can turn on the SDK's `httpsOnly` and does not.
8. **Admission caps are written per branch, not per resource.** The locked `DiscoveryQueue`, the unlocked `pendingDiscoveryPromises` map, and the pre-boot content relay each carry their own 32/4 caps, and the two branches added beside them (existing-session auto-approve, duplicate waiters) plus the verify window in `session-established.ts` sit outside all three (F-18). Every new discovery/handshake branch needs its cap re-audited; a single per-origin budget over "windows + waiters + queued" would remove the class.

## July-2026 remediation regression check

- **A (raw-`Fr` authwit reject; `call.name`↔`selector` bound at signing sinks; arg-shape validation):** intact at `packages/wallet-bridge/src/method-scope-checkers.ts:327-331` and `execution/service.ts:900-908`; the later-added `aztec_simulateTx` fast path never received the bind (F-08) — a coverage gap, not a regression.
- **B (truthful approval display; bidi/RLO sanitizer):** sanitizer intact (`dapp-session/capability-meta.ts:128-176` `sanitizeWireString`; `safeWire` in `OperationCard.vue`); the transfer-recognition vocabulary regressed relative to the token model, restoring the pre-F-008 blank-args state for standard transfers (F-02).
- **C (single validated `getNodeInfo` threaded; no re-fetch):** threading intact at every traced site; the HELD XOR-composite collision is confirmed **open** at the signing gate (F-01), plus one caller with no assert (`fn.ts:85-95`).
- **D (discovery-flood caps 32/4, locked-queue/popup caps):** the caps themselves are intact (`wallet-sdk/background.ts:606-607`, `content-message-relay.ts:44`; locked queue per c06 both) — but they are **bypassed** on two branches of the unlocked path (existing-session auto-approve `:647-650`, duplicate waiters `:663-668`) and do not cover the verify window (`session-established.ts:143-154`), so an already-connected origin can still spawn unbounded popup windows (F-18). Treat as a partial regression of D's intent.
- **E (backup-restore config allowlist):** intact (`config/service.ts` `RESTORABLE_CONFIG_KEYS`; c04 both).
- **F (CSP):** intact (`manifest.config.ts:41`); `connect-src`/`frame-src` still absent with no traced sink (c10 both).
- **G (offscreen/messaging sender-auth + Firefox instance token):** intact at both service-side listeners (`background/service.ts:45`, `offscreen/service.ts:41`) and the token (`wallet/utils/offscreen.ts:57,301`); never extended to the SW-side client, READY/PONG, or the broadcast primitive (F-14) — asymmetry, not regression.
- **I (per-row DappSession HMAC):** mechanically intact (`mac-storage.ts:30-34,85-104`, all authority fields signed); key derivation does not separate same-master siblings (F-06).
- **J (ValueStorage parse containment):** intact (`packages/wallet-core/src/storage/value-storage.ts:28-34` parse hook; owners handle throws — c11 Codex NF-13).
- **K (clipboard secret hygiene):** intact (`useSecretClipboardCopy.ts:3,40` unconditional scrub; c10 both non-finding).

## Coordinator deviations / caveats

- **Density:** 18 findings vs the ~13 target (1.6/cluster). Five High, four Medium, nine Low. Each Low is a distinct root cause with a verified trace; merging them would have crossed the brief's "don't over-merge" line. Seventeen further traced items were deliberately dropped below the floor (listed above).
- **c06 coverage:** the Codex report arrived after two provider refusals and after the first draft of this file; it and both c06 rebuttals were incorporated in this revision. Its F-2 duplicates c08's chain-identity finding (folded into F-01, counted once); its F-1 converges with Claude on F-08 (band lowered on its impact objection); its F-3 became F-18.
- **Verification method:** static re-read of every cited line at `62f3456a`; no cluster probe was re-executed. Where a family reported an in-memory reproduction (c02 F-1/F-2/F-4, c04 F-1/F-3, c05 F-1/F-3, c06 F-1/F-2/F-3, c07 F-2, c09 F-4, c11 F-1/F-3), that is their evidence, not the coordinator's.
- **F-04 resolution:** Codex's objection was accepted on the exploit narrative (fresh attacker-authored backup ≠ victim address) and rejected on the mechanism; the doctored-own-backup variant meets the brief's calibration for a hostile-backup RPC redirect.
- **F-02(c) resolution:** Codex withdrew the discovery-authwit item as an authorization finding; the coordinator kept it as a disclosure *instance* because the signed authority is real and unrendered, which is F-02's root cause. Rated inside F-02, not separately.
- **F-08 band change:** lowered from Medium to Low on the c06 Codex rebuttal — public-static functions expose public state; the gap is authorization-control, not confidentiality.
- **OWASP mapping** uses the 2021 edition; several Codex reports cite a "2025" edition and external URLs the coordinator did not verify. CWE numbers were checked against the trace, not against a Top-25 list.
- **c11 Codex dismissed the unscoped journal reads as "already recorded in the July report".** Verified: `audit/security/2026-07-06-max/report.md:160` lists "Operation-journal cross-profile reads" as a latent gap with "no current dApp-exposure". F-11 is kept because this run adds what July lacked — a reachable ordinary-navigation sink (`TokensView.vue:49-61,204`) and the controller-bypass consequence of the write methods — so it is a known-latent item made concrete, not a re-report. (The c11 Claude rebuttal's claim that the citation was unlocatable was wrong.)
- **Lines drift:** all `file:line` refer to HEAD `62f3456a`; Phase 4 should re-anchor if the worktree moves.
