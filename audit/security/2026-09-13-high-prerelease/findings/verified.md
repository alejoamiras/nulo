# Verified findings — 2026-09-13-high-prerelease (Phase 4 merge)

Target: `origin/dev` @ `62f3456a` (worktree HEAD re-confirmed at merge time). Inputs: `findings/consolidated.md` (F-01..F-18) and six verifier reports under `raw/verify/` — `v1-{claude,codex}.md` (F-01..F-04), `v2-{claude,codex}.md` (F-05..F-07), `v3-{claude,codex}.md` (F-09, F-18, F-08). Ten findings were double-verified (the top-10 cap); F-10..F-17 carry their consolidated status.

Method: each verifier recorded an independent read before opening the finding's trace, then re-derived every cited `file:line` and, where feasible, ran an in-memory probe (extracted source + stubbed dependencies; no browser, no chain, no real witness). Where the two families cite different lines for the same step, the coordinator re-opened the file at HEAD and the line quoted below is the one that holds; every coordinator-added `file:line` in the strengthened traces (including the `@aztec/stdlib` / `@aztec/wallet-sdk` / `@alejoamiras/aztec-accelerator` 5.2.0 sources) was re-anchored against the tree at merge time. Confidence rubric: `high` = both families confirmed with reproduced traces; `moderate` = one family partial/unsure on a substantive step; `low` = kept but flagged (would relabel High/Medium as Potential). No verified finding landed at `low`; no band changed.

Bands are CVSS v4.0 qualitative (Critical ≥ 9.0 / High 7.0–8.9 / Medium 4.0–6.9 / Low 0.1–3.9), wallet-calibrated per the coordinator brief.

---

## Verified findings

### [High] F-01: Chain-identity check compares only the XOR composite — a lying RPC chooses the chain domain of every signed transaction and authwit

**Verdict:** CONFIRMED (Claude) / CONFIRMED (Codex)

**Final confidence:** high — the collision arithmetic was reproduced by both families, every call site was enumerated by grep (Claude), and the service method was executed in memory through to the hash function and signer stub (Codex).

**Band:** High — unchanged. Both verifiers: keep High. Neither recommended a change. Below Critical because cross-chain redemption of the wrongly-domained signature was not demonstrated; the evidence establishes construction and signing under an attacker-chosen `(l1ChainId, rollupVersion)`, not acceptance on another rollup. Claude flags the compounding with F-04 (a hostile backup turns the "attacker is the configured RPC" precondition into an attacker-supplied one).

**Strengthened trace:**
1. Source (endpoint-controlled): `apps/extension/src/wallet/services/execution/service.ts:871-872` — `node = await this.networkService.getNode(network.chainId)`; `nodeInfo = await node.getNodeInfo()`.
2. Gap: `packages/aztec-runtime/src/utils/chain-identity.ts:34-36` — `SelectedNetworkChainInfo { chainId: number }` is the whole interface; `:53-61` — `if (network.chainId === 0) return; const liveComposite = (nodeInfo.l1ChainId ^ nodeInfo.rollupVersion) >>> 0; if (network.chainId !== liveComposite) throw`. `network.l1ChainId` is never read — it exists on the real `Network` (`apps/extension/src/wallet/services/network/spec.ts:36-39`) and every caller passes the full object, but structural typing makes the field invisible to the function.
3. Consumption: `execution/service.ts:875` — the assert passes for `(2, 4248422644)` against stored mainnet `4248422646`; `:876-879` — `metadata = { chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }` is built from the raw live pair, not the stored row; `:889-918` validate contract, function identity and arguments but never chain identity.
4. Sink: `:922` (call intent) / `:929` (inner hash) `computeAuthWitMessageHash(intent, metadata)` → `:935` `account.createAuthWit(messageHash)` → `packages/aztec-runtime/src/account/nulo-account.ts:133-134` delegates to the witness provider.
5. Transaction arm (structurally identical): `apps/extension/src/wallet/services/execution/tx-request-builder.ts:220-221` assert → `:286` `chainInfoFrom(nodeInfo)` (`chain-identity.ts:69-71` forwards the raw pair into `ChainInfo`) → `nulo-account.ts:184` `buildTxExecutionRequest`. NO_FROM arm: `tx-request-builder.ts:404-418` (constructs the `TxContext`; Codex: this is context construction, not itself an account-signature bypass).
6. Every other guarded caller uses the same helper and inherits the same gap: `execution/service.ts:227-231` (estimate-reuse identity), `dapp-send-executor.ts:853-864`, `authwit-discoverer.ts:106-122`, `discovery-probe.ts:73-90`, `fast-path.ts:176-183`, `view-executor.ts:207-212`, `helpers/batched-view-simulation.ts:203-205, 357-366, 538-549`. Unguarded (no assert at all): `apps/extension/src/wallet/services/token/service.ts:711-720` → `apps/extension/src/wallet/utils/fn.ts:85-100` (local metadata simulation, read-only — not a signing sink).

**Preconditions:** an unlocked account; the configured endpoint (the default is a third-party load balancer, `network/service.ts:102,111` — or an F-04-planted one) returns a colliding tuple; an ordinary authwit or transaction request that passes the account/artifact/function checks. No user interaction beyond normal use.

**Existing controls and why they don't cover it:** `network/service.ts:565-572` (`addEndpoint`) and `:612-618` (`updateEndpoint`) already require `probed.l1ChainId === network.l1ChainId` with a comment naming this exact collision ("a different (l1ChainId, rollupVersion) pair can XOR to the same value, and l1ChainId feeds key derivation"). That check runs only at enrollment/edit time; an endpoint that changes its answer afterwards is never re-checked (Codex), and the signing-time gate never received the discipline. Local networks (`chainId === 0`) skip by design (`chain-identity.ts:54`) — the loopback URL allowlist is the substitute there and is not implicated. Key-model-v2 fixes which key signs (row-stored `l1ChainId`), not which domain it signs for.

**Recommended fix:** extend `SelectedNetworkChainInfo` to `{ chainId, l1ChainId }`; in `assertLiveChainIdentity` add `if (nodeInfo.l1ChainId !== network.l1ChainId) throw` — mirror `network/service.ts:568-572` verbatim. Callers already pass the full `Network`, so no call-site churn. Codex refinement (accepted): composite equality plus exact `l1ChainId` pins `rollupVersion` only modulo 2^32 (int32 XOR then `>>> 0`), so also enforce canonical ranges (both values integers in `[0, 2^32)`) or compare `nodeInfo.rollupVersion === ((network.chainId ^ network.l1ChainId) >>> 0)` explicitly. Local networks: compare `nodeInfo.l1ChainId === network.l1ChainId` from the stored row rather than a runtime `LOCAL_L1_CHAIN_ID` constant (preserves custom local networks; Codex over the consolidated wording). Route `fn.ts:85-100` through the same assert with the selected network supplied by `token/service.ts:711-720`. Regression risk: low — a legitimate node reports the true `l1ChainId`; only the drift/collision case is newly rejected; the local early-return is unaffected. Add the `(2, 4248422644)` vector to the helper's colocated test.

**Verifier disagreements:** none on verdict or band. Claude cites the interface at `:31-33`; at HEAD it is `:34-36` (Codex/consolidated). Codex's narrowings adopted: the NO_FROM instance is `TxContext` construction, not a signature bypass; `fn.ts` is a local simulation path; the evidence is wrong-domain signing, not cross-chain redemption.

**Probe evidence:**
- Claude: `bun -e 'console.log((1^4248422647)>>>0, (2^4248422644)>>>0, ((1^4248422647)>>>0)===((2^4248422644)>>>0))'` → `4248422646 4248422646 true`.
- Codex: in-memory execution of the extracted guard plus `executeAztecCreateAuthWit` with stubbed crypto/dependencies reached `computeAuthWitMessageHash` with `{ chainId: 2, version: 4248422644 }` and invoked the signer stub.

---

### [High] F-02: Approval popup renders only a subset of what is signed

**Verdict:** CONFIRMED (Claude — instances (a) and (b) reproduced; (c) plausible, not exhausted) / CONFIRMED (Codex — all four instances, (c) traced end to end)

**Final confidence:** high — (a)/(b) reproduced from source by both families and the parser executed directly by Codex; (c) traced line by line by Codex (`discovery-aware-estimator.ts` → `fee-juice-strategy.ts` → `tx-request-builder.ts`) and found architecturally consistent by Claude; (d) is a prominence gap, not a hidden field.

**Band:** High — unchanged. Both verifiers: keep High. Neither recommended a change. Below Critical because a user click remains required — the click is what is being deceived.

**Strengthened trace:**
- (a) Transfer arguments hidden. dApp `sendTx({ calls: [{ to: TOKEN, name: "transfer", selector: <real transfer selector>, args: [ATTACKER, AMOUNT] }] })` → `packages/wallet-bridge/src/dispatcher.ts:933-957` resolves the authorized account and forwards `exec` raw (`:946-952`) → popup `apps/extension/src/popup/windows/execute/OperationCard.vue:117` iterates `op.exec.calls` → `:126` label `humanizeMethodName(safeWire(call.name …))` = "Transfer (private)" from `apps/extension/src/utils/tx-enrichment.ts:17` (`METHOD_LABELS` maps both `transfer` and `transfer_private_to_private`, `:17,22-26`) → `:135` `v-if="parseTransferIntent(call).kind !== 'unverified'"` is false: `apps/extension/src/utils/transfer-intent.ts:23` `KNOWN_TRANSFER_METHODS = {transfer_in_private, transfer_in_public, transfer_to_private, transfer_to_public}`; `:59-66` returns `unverified` for `transfer`; `:72` `args.length !== 3` returns `unverified` for the 4-arg `_nonce` variants → no `v-else`, nothing rendered, contradicting the comment at `:113-116` ("we render the indexed-args fallback with an explicit marker") → user approves → `apps/extension/src/popup/windows/execute/index.vue:412-449` forwards the untouched operation → `apps/extension/src/wallet/services/execution/operation-planner.ts:206-218` converts each call to an `encoded_call` action preserving `args` → `tx-request-builder.ts:188-195` (`case "encoded_call"`) → `validateEncodedCallFn :569-582` → `newEncodedCallFunctionCall :584-597` builds the `FunctionCall` with `action.args` → `:275-286` into the account transaction request. The wallet's own descriptor table treats the omitted names as canonical: `apps/extension/src/wallet/services/token/functions/descriptors.ts:322-325` (2- and 4-arg variants), `:349-363` (scores `transfer_private_to_private` 102 and `transfer` 101 above `transfer_in_private` 100).
- (b) Authwit delegate hidden. `dispatcher.ts:1002-1010` → `OperationCard.vue:357-392` renders target + function name (call intent) or consumer (inner hash) — `caller`, `call.args`, `innerHash` are read nowhere in the block → `execution/service.ts:909-922` hashes `caller` + the full call including args; `:925-929` hashes `consumer` + `innerHash` → `:935` signs.
- (c) Discovered authwits never shown. `apps/extension/src/wallet/services/execution/discovery-aware-estimator.ts:99-109` creates the probe → `discovery-probe.ts:80-90` keeps `{contractAddress, innerHash}` and emits `add_private_authwit` → `fee/fee-juice-strategy.ts:32-39` appends to `ctx.op.actions` and rebuilds → `tx-request-builder.ts:146-162` creates the witnesses → the estimate response `dapp-send-executor.ts:293-305` carries fee fields and an id, no authorization details → the popup iterates only `op.exec.calls` (`OperationCard.vue:117`). Discovery runs before approval, including for estimates the popup itself initiates (Codex: "before the popup" is too broad).
- (d) `authWitnesses`/`capsules`/`extraHashedArgs` enter via `operation-planner.ts:175-203` or the NO_FROM parser `tx-request-builder.ts:347-358`; visible in the JSON window (`apps/extension/src/popup/windows/json/index.vue:12,56`). Discovered actions from (c) are NOT part of that original request and so are absent there too.

**Preconditions:** a connected dApp holding a transactions (or authwit) grant; the user clicks approve on a card that shows a confident label and no recipient/amount/delegate.

**Existing controls and why they don't cover it:** `validateEncodedCallFn` (`tx-request-builder.ts:576-578`) and `execution/service.ts:900-908` bind `name` to `selector`, so the label names the function that really runs — the deception is in the omitted arguments, not a mislabeled function. `safeWire`/`sanitizeWireString` neutralize bidi in strings. Session/account checks are unaffected. The JSON window is a secondary surface and does not carry discovered actions.

**Recommended fix:** (1) Smallest immediate change — implement the promised fallback after `OperationCard.vue:135`: for `unverified`, render indexed raw args with an explicit "unverified — review arguments" marker; mirror the spender/argument presentation in `apps/extension/src/popup/windows/execute/OperationActionRow.vue:20-31` so full values stay inspectable. (2) Derive the recognized-name/arity set from `TOKEN_FN_DESCRIPTORS` through a lightweight shared module — do not import the wallet token service into the popup (L5 layer rule); name + arity must not imply verified token semantics (Codex). Keep the explicit `from` rendering (`OperationCard.vue:130-134` comment) for every recognized variant. (3) Authwit branch: render `caller`, args, and for `IntentInnerHash` the hash plus an "opaque authorization" warning. (4) Thread the discovered `{consumer, innerHash}` list out of the estimate result (`dapp-send-executor.ts:293-305`) and list it on the card, bound to the execution being approved — including rebuilds when an estimate cannot be reused (Codex). Effort: days, dominated by (4); (1)–(3) are additive template changes with low regression risk.

**Verifier disagreements:** (c) confidence — Claude moderate (did not exhaust `op.actions` vs `exec.calls` reconciliation), Codex high (full trace). Decisive: Codex's path is line-complete and matches the coordinator's source read; kept as a disclosure instance at high. Encode-site citation — Claude's `tx-request-builder.ts:181-184` (the `case "call"` arm, `:180-187` at HEAD) is the wallet-internal `{contract, method, args}` arm; the dApp path is the `encoded_call` arm at `:188-195` → `:584-597` (Codex; verified at HEAD). Consolidated's `:184-188` straddled both.

**Probe evidence:**
- Codex: executed `parseTransferIntent` directly — `unverified` for the 2-arg `transfer` and the 4-arg `transfer_in_private`; the 3-arg legacy control was recognized. Rendering established by template inspection only (no mounted browser).
- Claude: source read only; independently found the `METHOD_LABELS` vs `KNOWN_TRANSFER_METHODS` divergence.

---

### [High] F-03: Hostile backup plants a non-canonical `PrivateFpc` row that becomes the only selectable "Private Fee Juice" payer

**Verdict:** CONFIRMED (Claude) / CONFIRMED (Codex)

**Final confidence:** high — Codex ran the real fee helpers and reproduced the single poisoned option; Claude reproduced every step from source and independently found the product invariant that makes the fix regression-free.

**Band:** High — unchanged. Both verifiers: keep High. Neither recommended a change. Codex limits the proven impact to substitution of the payer contract included in the user's signed private transaction; loss of funds held in the canonical PrivateFPC and sequencer acceptance of a non-paying payer remain unverified (already the consolidated's reason for not going Critical).

**Strengthened trace:**
1. Source: backup `data.fpc[]`; the checksum is self-consistent, not authenticated (`apps/extension/src/composables/useFullBackupImport.ts:85-94`); service slices restored at `apps/extension/src/composables/full-backup-restore.ts:425-429`.
2. Gap: `apps/extension/src/wallet/services/fpc/service.ts:503-505` rejects only unsupported enum values; `:512-524` persists `{ type: 2, address: X, name }` after `StoredFpcSchema.parse` (`fpc/spec.ts:35-41` — string address + enum); no comparison against `getOrComputeProtocolAddresses`. Enum: `fpc/spec.ts:15-18` (`DefaultSponsoredFpc = 1`, `PrivateFpc = 2`).
3. Selection: `getFpcs` `:155-158` finds no row at `protocols.private` → discovery → `:187` `result.push(await this.registerAndStoreProtocolFpc(...))` appends the genuine row AFTER the poisoned one; `decorate` correctly marks the poisoned row `isProtocol: false`. `apps/extension/src/popup/components/modules/send/fee-helpers.ts:157` `registeredFpcs.find((f) => f.type === FpcType.PrivateFpc)` returns the poisoned row; `:161-163` `continue` skips the canonical one — it is unselectable through the UI.
4. Balance and settings: `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:180-187` reads `balance_of` at that first row's address; non-zero enables the option (`fee-helpers.ts:191-207`); `:89-92` writes its `fpcId` into settings.
5. Sink: `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:101-102` `getFpcImpl(fpcId)` (`fpc/service.ts:426-432`, ownership only) → `:241-248` prepends the fee payload and rebuilds → `fpc/fpc.ts:17-18` → `fpc/handlers/private-fpc-handler.ts:23-31` `{ kind: "call", contract: fpc.address, method: "pay_fee", args: [] }` inside the transaction that is simulated, proven and signed.
6. Compounding registration: `apps/extension/src/wallet/services/account-state/service.ts:384-400` registers backup-supplied `{instance, artifact}`; `precheckContractAddress :444-456` special-cases only addresses 0–6; `packages/aztec-runtime/src/pxe/service.ts:444-452` parses both and checks the address derives from the instance — self-consistency, not authenticity (an attacker-authored contract passes); `private-fpc-handler.ts:8-19` `validateArtifact` requires only a 0-arg/0-return `pay_fee` and a `balance_of`.

**Preconditions:** the victim imports a crafted or tampered backup; the poisoned row precedes the canonical one (guaranteed by the append order); for an enabled option and an executable transaction, a compatible contract at `X` must be registered (the same backup's `account-state` slice, or a real deployment) and its `balance_of` must return a positive value.

**Existing controls and why they don't cover it:** `updateFpcAddress` (`fpc/service.ts:362-369`) permanently forbids changing a `PrivateFpc` address — "we cannot validate an arbitrary address as a PrivateFPC" — so the product invariant is that every legitimate `PrivateFpc` row is canonical; restore lacks the same backstop. `isProtocol` is computed and already used for eligibility at `fpc-strategy.ts:111-115`, but only for the sponsored fast path, never for PrivateFpc selection. `contract-resolver.ts:127-155` fails execution when the contract/artifact is missing, so a bare row without registration is unavailability, not execution.

**Recommended fix:** (1) In `restore()`, reject any `type === PrivateFpc` row whose address ≠ `protocols.private` (recorded as `restoreError`), reusing canonical derivation/decoration at `fpc/service.ts:109-131`; mirror the permanent rejection at `:362-369`. (2) In `fee-helpers.ts:157` and `gas-balance-reader.ts:181` select `f.type === PrivateFpc && f.isProtocol === true` — mirror `fpc-strategy.ts:111-115`. (3) Enforce the same predicate in `getFpcImpl` (`:426-432`) so a pre-existing row cannot bypass the UI fix (Codex). Do NOT blanket-reject non-canonical `DefaultSponsoredFpc` rows: the enum has a single sponsored type and custom sponsored FPCs are supported (`fpc/service.ts:276-305`, `:373-405`) — the consolidated `{DefaultSponsoredFpc, PrivateFpc}` set is narrowed to `PrivateFpc`. Regression risk: effectively zero for real users (no legitimate non-canonical PrivateFpc row can exist). Tests: restore-reject, and `buildFeeMethods` with a poisoned row first.

**Verifier disagreements:** scope of the restore rejection — Codex's objection to rejecting non-canonical sponsored rows is decisive (verified: `FpcType` has two members; user-added sponsored FPCs share `DefaultSponsoredFpc`). Codex's qualification of "registers any instance/artifact" accepted: `pxe/service.ts:444-452` checks derived-address consistency, which an attacker-authored contract satisfies.

**Probe evidence:**
- Codex: in-memory run of the real `buildFeeMethods` and `settingsForMethod` — exactly one `private_fpc` option, carrying the non-canonical address and `isProtocol: false`; `settingsForMethod` selected its id.
- Claude: source only; independently derived the "no legitimate non-canonical PrivateFpc" invariant from `:362-369`.

---

### [High] F-04: Hostile backup mints a `kind:"mainnet"` network row bound to an attacker RPC; default seeds are suppressed

**Verdict:** CONFIRMED (Claude — with the precondition correction independently re-derived) / CONFIRMED (Codex — for persistent endpoint substitution and seed suppression)

**Final confidence:** high on the mechanism (both families; Codex executed the real `getOrInitNetworks()` against stubbed storage). The exploit precondition is the narrower "doctored copy of the victim's own backup" variant, which both families derived from `useFullBackupImport.ts` and the consolidated report already adopted.

**Band:** High — unchanged, on the corrected precondition. Both verifiers: keep High. Neither recommended a change. Wrong-domain signing additionally depends on F-01.

**Strengthened trace:**
1. Precondition: the victim imports an otherwise valid backup. `useFullBackupImport.ts:462,470,475` derive the new profile from the backup's own `restoreSecret` (master key read at `:462`, `buildRestoreSecret` at `:470`, `restoreProfileStep` at `:475`), so an attacker-authored-from-scratch backup restores the attacker's keys, not the victim's — the "indistinguishable UI, real addresses" framing holds only for a doctored copy of the victim's own backup (or a backup the victim is induced to import and then fund).
2. Entry: `apps/extension/src/composables/useFullBackupImport.ts:475-488` creates the profile, `:485` `normalizeAllIds(data, "profileId", newProfile.id)`, `:487-488` restores networks → `full-backup-restore.ts:267-268`.
3. Gap: `apps/extension/src/wallet/services/network/service.ts:885` → `validateRestoredNetwork :1046-1059` — legacy-shape gate, `NetworkSchema.safeParse`, `(profileId, chainId)` collision; never `assertCanonicalStoredL1` (`:346-355` — would pass anyway, the attacker uses the genuine constant), never a probe. `network/spec.ts:187-196` `NetworkSchema` — `kind: ChainKindSchema.optional()` at `:195` (an enum, not free text); `RpcUrlSchema :152-179` accepts any `https:` host (`:167-169`). `:889` `storage.set(id, stored)`.
4. Seeding suppression: activation is deliberately deferred until restore finishes (`useFullBackupImport.ts:540-546`); `getOrInitNetworks :241-242` `if (existing.length) return existing` — `DEFAULT_SEEDS` (`:99-126`, the genuine `{ kind: "mainnet", rpcUrl: "https://lb.drpc.live/...", l1ChainId: MAINNET_L1_CHAIN_ID }`) never land.
5. Selection and sink: `:415` recognizes the row by the primary seed's composite; `:724-728` `getNode` builds the client from the row's primary endpoint; `network/spec.ts:92-96` `networkInfoFrom(network).rpcUrl` feeds PXE.
6. Presentation: `apps/extension/src/popup/windows/execute/SignerIdentityStrip.vue:25-35` shows the stored network name — the ordinary mainnet label survives.

**Preconditions:** import of a doctored copy of the victim's own backup into a fresh profile (no collision); every subsequent balance read, fee quote, simulation and broadcast for that profile's mainnet goes to the attacker.

**Existing controls and why they don't cover it:** `normalizeAllIds`, the collision check, deletion fences and `RpcUrlSchema` each hold for their purpose — the URL policy was designed against `javascript:`/plaintext, not a hostile HTTPS operator. `assertCanonicalStoredL1` checks the L1 constant only. The endpoint-enrollment probe (`:560-572`) checks self-reported identity, which cannot establish operator trust (Codex), and never runs on restore.

**Recommended fix:** the consolidated proposal needs refinement — both verifiers flagged it from opposite angles: forcing the row to `custom` and then seeding by missing kind creates two rows with the same `(profileId, chainId)`, violating uniqueness at `:1055-1056` (Codex; Claude: same collision risk with a legitimately added custom network), and literal seed-URL rejection breaks intentionally customized mainnet/testnet backups that the endpoint-edit API supports at `:589-628` (Codex). Decision — one canonical row per seeded chain: on restore of a row whose `kind` is a seeded kind (or whose `chainId` matches a seed), rebuild the row from `DEFAULT_SEEDS` via seed construction `:267-283` with the seed URL as primary, append the imported endpoints as non-primary entries flagged for explicit review before activation, and never suppress seeding. Mirror the `kind → seed` lookup shape of `assertCanonicalStoredL1 :346-355`; if a live probe is added, use the exact-identity check at `:560-572`. Regression risk: a user with a customized primary endpoint gets the seed primary back after restore (one click to switch); test "restore one hostile mainnet row into an empty profile → seeds intact, imported endpoint present but non-primary".

**Verifier disagreements:** none on verdict or band. Codex corrections accepted: `kind` is an enum, and the normal seed path also writes seeded kinds — the endpoint, not `kind`, is the restore-only signal. Claude's precondition narrowing matches the consolidated resolution. The two families' fix objections are merged above.

**Probe evidence:**
- Codex: in-memory execution of the actual `getOrInitNetworks()` with the supplied row in stubbed storage returned only that row and never reached seeding; restore acceptance verified against the source schema and guards, not run end to end.
- Claude: source only; re-checked `restore()` at `:860-900` and the `useFullBackupImport.ts:475` secret derivation.

---

### [High] F-05: Passkey wallet master is reproducible by any `nulo.sh`-eligible web origin

**Verdict:** CONFIRMED (Claude) / CONFIRMED (Codex)

**Final confidence:** high on the mechanism — the derivation chain was re-read end to end by both families, the WebAuthn RP-ID and PRF semantics were checked against external spec text (both), and the option builders were executed (Codex). Neither family demonstrated it with a physical authenticator (the consolidated's "moderate real-world" caveat stands as a demonstration gap, not a doubt about the mechanism). Not relabeled Potential High.

**Band:** High — unchanged. Both verifiers: keep High. Neither recommended a change. Full derived-account master compromise; imported-account keys additionally need the DEK envelope.

**Strengthened trace:**
1. `apps/extension/src/wallet/services/passkey/spec.ts:21` — `RP_ID = "nulo.sh"`. `apps/extension/manifest/manifest.config.ts:20` — the `https://nulo.sh/` host permission is what lets the *extension* use a website RP ID; it has no bearing on which *web origins* are eligible.
2. `packages/wallet-crypto/src/constants.ts:10` — `PASSKEY_PRF_LABEL = "nulo:profile:v1"` (public); `apps/extension/src/wallet/utils/passkey-ceremony.ts:33-36` — PRF input = SHA-256(label), a constant.
3. `passkey-ceremony.ts:68-77` — `buildGetOptions()`: `rpId: RP_ID`, `userVerification: "required"`, `extensions: { prf: { eval: { first: prfInput } } }`; no allow-list when `credentialId` is omitted (`:78-86`), so credential discovery is permitted.
4. Platform gap: WebAuthn RP-ID scoping — any HTTPS origin whose effective domain is `nulo.sh` or a registrable-domain suffix match (any subdomain) may assert with `rpId: "nulo.sh"`; the PRF output is credential-scoped and deterministic for a given `eval` input, and "origins that are authorised to get an assertion from a credential are also authorised to evaluate any PRFs" (W3C PRF explainer, fetched by Claude; Codex cites webauthn-3 § Relying Party Identifier and § prf extension).
5. `passkey-ceremony.ts:121-135` returns `{ id, prf }`; `packages/wallet-crypto/src/passkey-credential.ts:49-57` imports the PRF output into HKDF with `salt = SHA-256("nulo:kdf:v1" ‖ credentialId)`; `:73-92` expands with `"nulo:master:v1"` and reduces via `Fr.fromBufferReduce` → master. No origin, extension id, profile id or install-bound value enters the derivation.
6. Live eligible hosts (Claude, grepped fresh): `nulo.sh` (landing — `apps/landing/README.md:3,39`), `tools.nulo.sh` (`apps/extension/src/popup/components/modules/send/fee-helpers.ts:215`, `apps/tools/src/lib/network-targets.ts:103`), `testnet.tools.nulo.sh` (`network-targets.ts:88`) — the three Cloudflare Pages projects `nulo`, `nulo-tools-mainnet`, `nulo-tools-testnet` named in `CLAUDE.md`. `passkey.nulo.sh` does not exist anywhere in the tree.

**Preconditions:** script execution on one of those origins (XSS, supply-chain, hostile deploy, subdomain takeover) plus one user-verified ceremony on that page with the wallet's credential (plausibly framed as "verify your Nulo wallet"); a PRF-capable authenticator.

**Existing controls and why they don't cover it:** the extension's sender guard, credential-id equality check and CSP never run — the ceremony never touches the extension. User verification and the random challenge protect assertion freshness, not derivation secrecy. `check-rp-id.ts` guards against literal drift of the RP string, not against eligibility of sibling origins.

**Recommended fix:** move `RP_ID` to a dedicated, content-less subdomain (e.g. `passkey.nulo.sh`) so the apex and application subdomains are no longer eligible; update the host permission in the same change. The validators consume the configured RP dynamically (`apps/extension/scripts/check-rp-id.ts:34`, `apps/extension/src/wallet/services/passkey/check-rp-id.ts:27-44`) and need no logic change (Codex); extend the AST scanner to assert the new subdomain never appears as a `content_scripts` match or a Pages project target (Claude). Limits: this narrows eligible origins; it does not create extension-exclusive cryptographic isolation — any future content served from the RP subdomain reopens it (Codex). One-way decision: changing `RP_ID` after launch bricks every passkey wallet (`spec.ts:6-15`); pre-production means no recovery transition is needed today. Additionally treat every `*.nulo.sh` deployment as key-material-adjacent (strict CSP, no third-party scripts). Effort: hours of code plus the product/infra decision.

**Verifier disagreements:** none. Claude notes there is no in-repo idiom to mirror (an infra decision); Codex notes the extension's host-permission use of a website RP is Chrome-sanctioned behaviour, not a bug.

**Probe evidence:**
- Codex: executed the extracted option builders — identical PRF inputs across different random challenges, `rpId: "nulo.sh"`, verification required, no credential allow-list when the id is omitted.
- Claude: external corroboration (MDN `rp` documentation; W3C PRF-extension explainer access-control sentence) plus the host-inventory grep.

---

### [Medium] F-06: Same-master sibling profiles share the dApp-session MAC key and can derive each other's PXE store key

**Verdict:** CONFIRMED (Claude) / CONFIRMED (Codex)

**Final confidence:** high — both families ran executable reproductions (Claude imported the shipped `derivePxeStoreKey` and reconstructed the private MAC derivation line for line; Codex extracted both and additionally showed the negative cases).

**Band:** Medium — unchanged. Both verifiers: keep Medium. Neither recommended a change. Claude's nuance: the PXE-key half, taken alone, is offline decryption of another profile's local privacy-key material with no confirmation gate — the more serious half — but it shares the same precondition ceiling.

**Strengthened trace:**
- Precondition: profiles A and B share a master — a supported, warned flow (`apps/extension/src/wallet/services/profile/service.ts:2004-2015` `allowDuplicate`; same-phrase derivation `:1616-1620`). The attacker holds that master and has extension-storage write (MAC branch) or OPFS read (PXE branch).
- (a) MAC: `profile/service.ts:913-933` `deriveDappSessionMacKey(profileId)` — `profileId` only selects the secret (`:914`); HKDF `salt = "nulo:dappsession-mac:salt:v1"` (`:922`) and `info = "nulo:dappsession-mac:v1"` (`:923`) are fixed → identical masters produce an identical HMAC key. Attacker crafts `SignableDappSession{ profileId: B, dappMetadata.url: <attacker>, accounts, capabilityGrants, chainId, unexpired }`, canonicalizes and signs it (`apps/extension/src/wallet/services/dapp-session/integrity.ts:30-65`, sign at `:50-52`) with the shared key → when B is unlocked, `dapp-session/mac-storage.ts:85-104` (`:94-100`) calls `keyFor("B")`, gets the same key, verifies → `dapp-session/service.ts:128-137` matches B/origin/chain → `apps/extension/src/wallet/services/wallet-sdk/background.ts:647-650` auto-approves discovery without a popup → `packages/wallet-bridge/src/dispatcher.ts:650-655`, `:1354-1369` consume the forged grants. Transaction confirmation stays enforced: `dapp-session/spec.ts:84` (enum max `Transactions = 5`), `dapp-interaction/service.ts:586-589`.
- (b) PXE: `packages/wallet-crypto/src/pxe-store-key.ts:29-34` `derivePxeStoreKey(master, profileId)` — `salt = "nulo:pxe-store-salt:" + profileId` (public), `ikm = master`; its own doc (`:15-16`) concedes "profiles also have distinct masters today". Legitimate provisioning: `apps/extension/src/wallet/runtime.ts:542-544`; the key reaches the encrypted store via `packages/aztec-runtime/src/pxe/chain-runtime.ts:158-163` and `pxe/opfs-store.ts:102-120`; imported-account privacy keys reach PXE via `apps/extension/src/wallet/services/account/service.ts:378-383` → `packages/aztec-runtime/src/account/nulo-account.ts:77-79,102-106` → `packages/aztec-runtime/src/pxe/service.ts:386-398`. Extraction from a real OPFS database was not exercised by either family.

**Preconditions:** shared master (a sibling profile on a shared machine, or a storage/OPFS reader who obtained any sibling's master) plus storage write (a) or OPFS read (b).

**Existing controls and why they don't cover it:** `profile/session-manager.ts:214-219` prevents requesting B's secret through A's active session — irrelevant to offline derivation by a master holder. Full-row MAC coverage (including `profileId`) stops edits without re-signing but not re-signing with the shared key. `packages/wallet-crypto/src/entropy-mac.ts:12-15` already keys the envelope MAC by `HKDF(master ‖ dek)` "because the threat model's attacker HOLDS the shared master" — that separator was never extended to these two derivations.

**Recommended fix:** mix the profile DEK into both KDFs — mirror `entropy-mac.ts:61-82` `macKeyV3` exactly (fixed 32+32 concatenation with a length assert, a separate HKDF domain/info, zeroization of the IKM copy). Adding `profileId` alone would not stop a shared-master holder (Codex). Lifecycle consequences to decide up front: a DEK-less (degraded) session cannot derive either key — refuse to open the PXE store / verify sessions without the DEK, or scope the DEK requirement to the imported-account subset (which needs storage separation — the current store covers the whole profile/chain, Codex); DEK regeneration at `profile/service.ts:1027-1029` invalidates existing session tags and PXE keys, so regeneration must re-key. Tests: `dapp-session/service.test.ts:26-48` stubs the derivation and masks this — add a real-derivation cross-verify case; the key-vector pin V11 (`key-vectors.test.ts`) changes deliberately. Pre-production: no migration. Effort: hours to a day plus the lifecycle decision.

**Verifier disagreements:** wording only — Codex narrows "same master ⇒ same key" for the PXE half to "keys differ per profile but are mutually derivable" (adopted). None on band.

**Probe evidence:**
- Claude (scratch script, `bun run`): imported the shipped `derivePxeStoreKey` — B's key computed from A's master equals B's own (`true`); an unrelated master differs (`true`, negative control); reconstructed `deriveDappSessionMacKey` from `:917-930` — a MAC computed with A's derived key verifies under B's (`true`).
- Codex (extracted functions): A's MAC verifies with B's same-master key; editing `profileId` without re-signing fails; re-signing the B row with A's key succeeds; A's and B's PXE keys differ while A's master reproduces B's exact key.

---

### [Medium] F-07: Auth-registry rows carry no profile/chain provenance — address-only purge, sync-delete and read

**Verdict:** CONFIRMED (Claude) / CONFIRMED (Codex)

**Final confidence:** high — Codex executed the extracted reconciliation → event → purge chain and the sync-delete; Claude reproduced every cited line including the `coordinator.ts:119/120/121` asymmetry and independently found the tuple-scoped collision that makes same-address-in-another-profile a designed-for state.

**Band:** Medium — unchanged. Both verifiers: keep Medium. Neither recommended a change. Claude's sequencing note: the hostile-backup instance is the cheapest to trigger (no sibling, no multi-network) and should be remediated first.

**Strengthened trace (hostile backup — lowest precondition):**
1. Precondition: profile P1 holds authwit rows for address `A`. The victim imports an otherwise valid backup into a new profile P2 containing `Account{ type: Imported, address: A }` with no paired `imported-account-keys` row. No P1 secret and no shared phrase are needed.
2. `apps/extension/src/composables/useFullBackupImport.ts:485` remaps child `profileId`s to P2 → account restore `apps/extension/src/wallet/services/account/service.ts:680-720`: the collision check is on the full `(profileId, chainId, address)` tuple (`:689-690`), so a fresh profile never collides — the row is persisted. A missing key row does not reject the stage (`full-backup-restore.ts:352-356`).
3. `useFullBackupImport.ts:524` restores the service slices (authwit slices included) → `:534` `accountService.reconcileImportedAccounts(newProfile.id)` runs unconditionally.
4. `account/service.ts:835-855`: the keyless row is detected (`:840`); the profile-scoped `accountPurgeSubscribers` are awaited (`:844-846`); the row is deleted (`:850`); `this.emit("onAccountDeleted", account)` (`:851`) — a global, un-profile-scoped event.
5. `packages/extension-messaging/src/core/base-service.ts:129-131` dispatches → `apps/extension/src/wallet/services/auth-registry/service.ts:97-99` `void this.purgeForAccounts([account.address])` — fire-and-forget, so the deletion is eventual (Codex).
6. `auth-registry/service.ts:428-448` deletes every row in the single flat root where `account === A` (`:432`), sweeps malformed rows (`:440-444`) and the status flag (`:445-447`) — P1's rows included.

Other instances, each re-traced by both families: profile deletion — `apps/extension/src/wallet/services/profile-deletion/coordinator.ts:120` `auth.purgeForAccounts(s.addresses)` unscoped while `:119` (`txs`) and `:121` (`balances`) pass `profileId`; cross-network sync — `service.ts:299-309` resolves the caller-selected network's node → `:346-350` loads every row for `A` across all chains → `:365-376` deletes any confirmed row that node reports non-consumable (node read `apps/extension/src/wallet/utils/auth-registry.ts:51-57`; pending rows preserved); cross-profile read — `:132-134` `getAuthwits(account)` ← `apps/extension/src/popup/pages/settings/advanced/account-state/authwits/index.vue:47,55` (address-only fetch and filter). Row shape: `auth-registry/spec.ts:24-40` has neither `profileId` nor `chainId`; `service.ts:71-82` creates global stores.

**Preconditions:** (1) import of a crafted backup naming a public address; (2)/(3) ordinary multi-profile or multi-network use — the codebase tolerates the same address as a live account in another profile by design (`:689` tuple scope).

**Existing controls and why they don't cover it:** schema validation, tuple collision, `normalizeAllIds`, restore epochs and deletion fences each hold for their boundary; none carries ownership into the purge. The stated policy "NEVER auto-evicted — eviction would destroy the only local revocation index" (`spec.ts:19-22`; hashes not enumerable from chain, `service.ts:115-119`) is bypassed silently by all three paths. The profile-scoped `accountPurgeSubscribers` hook (`account/service.ts:844-846`, `subscriber(profileId, scopes)`) exists — the auth registry is not on it; it listens to the address-only event instead.

**Recommended fix:** add `profileId` + `chainId` to `Authwit` and the status key; scope `getAuthwits`, `purgeForAccounts`, `syncAuthwits`, the status store, deduplication and backup handling by `(profileId, chainId, account)`. Mirrors: the awaited, scoped purge in `apps/extension/src/wallet/services/token-balance/service.ts:147,574-598` and `transaction/service.ts:301`; the composite identity in `account/spec.ts:25-31`; pass `profileId` at `coordinator.ts:120`; register the registry as an `accountPurgeSubscriber` (`account/service.ts:844-846`; the token-balance service already does at `token-balance/service.ts:147`) instead of the address-only event. Do NOT blanket-skip auth cleanup for keyless accounts (the consolidated/Claude suggestion): authwit slices may already have been restored at `useFullBackupImport.ts:524` before reconciliation at `:534`, so the new profile can legitimately hold rows to clean up — correct scoping removes the cross-profile deletion without that assumption (Codex). Pre-production: no migration; legacy rows lack provenance and cannot be reassigned automatically. Effort: hours to a day.

**Verifier disagreements:** fix shape — Codex's objection to "skip the purge" is decisive (the `:524` → `:534` ordering is verified at HEAD). Codex: the purge is asynchronous (fire-and-forget at `:98`), so "deletes" means "eventually deletes". None on band.

**Probe evidence:**
- Codex: extracted reconciliation, event and purge code — deleted P1's authwit and status while preserving P1's account row and unrelated-address rows; a separate check showed sync deleting a confirmed row on a false consumability response and preserving a pending row.
- Claude: source only; independently added the `account/service.ts:689` tuple-scope observation.

---

### [Low] F-08: `aztec_simulateTx` public-static fast path authorizes by `name` but executes by `selector`

**Verdict:** CONFIRMED (Claude) / PARTIALLY CONFIRMED (Codex)

**Final confidence:** high. Rubric note: Codex's PARTIAL is a read-scope limitation, not a substantive doubt — its rules excluded `node_modules`, so it could not inspect `FunctionCall.schema` or `simulateViaNode`, and it states "no local step refuted the finding". Both of those steps were read directly by Claude and re-confirmed by the coordinator at HEAD: `@aztec/stdlib` `dest/abi/function_call.d.ts:8-24` declares `name: string` and `selector: FunctionSelector` as independent fields with no cross-validation, and `@aztec/wallet-sdk` `dest/base-wallet/utils.js:46` builds calldata from `call.selector.toField()` without referencing `name`. Taken together the two families leave nothing unverified.

**Band:** Low — unchanged (the consolidated already lowered it from Medium on the c06 Codex rebuttal). Claude: keep Low, do not raise. Codex: keep Low provisionally. The two steps Codex left open concern whether the alternate function actually executes; even with them confirmed, the reachable surface is public+static functions whose results any node exposes, so the band is unaffected.

**Strengthened trace:**
1. Grant scoped to function `A` on contract `C`. dApp `simulateTx({ calls: [{ to: C, name: "A", selector: <selector of B>, type: "public", isStatic: true, args: <B's args> }] })`, `B` another public static function on `C`.
2. `packages/wallet-bridge/src/dispatcher.ts:650-651, 673-724` `enforceMethodAndScope` → `:707` `assertAuthRelevantArgShape` (shape only) → `:711-722` `enforceScopeWithSession` → `checkSimulateTx` (registered at `method-descriptors.ts:262-265`; `method-scope-checkers.ts:391-393`) → `checkSimulationTransactions :151-175` → `:169` `matchesScope(String(call.to), call.name, scope)` — `selector` is never read (`WireCall :31`).
3. `dispatcher.ts:1467-1474` forwards `exec` unchanged → `apps/extension/src/wallet/services/execution/service.ts:635-637` → `view-executor.ts:223-246` `executeAztecSimulateTx` → `:242-246` `rehydrateOptimizablePrefix` (`fast-path.ts:96-101` admits on wire `type === PUBLIC && isStatic === true`; `:109` `FunctionCall.schema.parse(c)` — a shape parse).
4. `FunctionCall` (`@aztec/stdlib` `dest/abi/function_call.d.ts:8-24`): `name` and `selector` independent; the Zod schema does not cross-validate them.
5. `view-executor.ts:275-289` → `runFastPath` (`fast-path.ts:175-179` chain assert) → `:200-211` `simulateViaNode(node, optimizableCalls, fromAddr, chainInfo, gasSettings, …)` → `@aztec/wallet-sdk` `dest/base-wallet/utils.js:46` `call.selector.toField()` — `B` executes with `msg_sender = fromAddr`; its return flows back via `buildMergedSimulationResult` (`fast-path.ts:229`) as the `TxSimulationResult`. A pure public-static payload avoids the mixed-payload fallback at `view-executor.ts:252-269` (Codex).

**Preconditions:** a valid `simulation.transactions` grant and an authorized, unlocked account; `B` public + static on the same contract; a reachable node. No artifact is needed on the fast path — that is the point of the path.

**Existing controls and why they don't cover it:** account/from, active-profile and live-chain checks (`view-executor.ts:224-225,248-250`, `fast-path.ts:175-179`) still apply; the name↔selector bind exists at `execution/service.ts:900-908` (authwit), `tx-request-builder.ts:569-582` `validateEncodedCallFn` (sendTx) and `view-executor.ts:361-381` (utility) — the July unit-A bind was never applied to this later-added optimization.

**Recommended fix:** before `runFastPath`, for each optimizable call resolve instance and artifact via `ContractResolver` (already a `ViewExecutor` dependency, `view-executor.ts:32`), `findFunctionBySelector`, throw on `call.name !== fn.name`, and derive `type`/`isStatic` from the ABI rather than the wire flags — mirror `view-executor.ts:361-381` (the closest pattern, Codex) / `tx-request-builder.ts:569-596`. Add a `fast-path` test for the mismatch case (none exists). Regression risk: one artifact resolution per optimizable call in a path that exists to avoid PXE-side resolution — confirm the resolver hits an in-memory cache after `registerContract` (Claude); calls previously simulated without a locally available artifact will now be rejected or routed to the standard arm — keep binding failures outside the infrastructure-fallback handling so a scope violation is never masked as "fall back to standard" (Codex). Effort: hours, plus a possible re-benchmark.

**Verifier disagreements:** verdict wording only, explained above. Codex confidence: moderate overall, high for the local missing binding. No band effect.

**Probe evidence:**
- Codex: the real scope checker accepted the same allowed `name` with two distinct selectors and rejected a different `name`; the real fast-path orchestration forwarded the supplied calls unchanged to a mocked `simulateViaNode` without invoking the standard arm. SDK parser and contract execution deliberately not exercised.
- Claude: direct SDK source reads (no execution).

---

### [Medium] F-09: Production prover accepts an unauthenticated loopback HTTP accelerator and posts the private witness to it

**Verdict:** CONFIRMED (Claude) / CONFIRMED (Codex)

**Final confidence:** high — Codex ran the actual `AcceleratorTransport` against a mocked `fetch` and observed HTTP selection and an unauthenticated POST; Claude read every link of the chain including the vendored SDK.

**Band:** Medium — unchanged. Both verifiers: keep Medium. Neither recommended a change. Confidentiality of the serialized private execution steps; a co-resident unprivileged process; zero user interaction; no remote reach; master/signing key not shown in the witness.

**Strengthened trace:**
1. `apps/extension/src/offscreen/index.ts:107-115` — production passes `factory: undefined` (the `ACCELERATOR_REQUIRED` branch passes `host`/`port` only, still no `httpsOnly`) → `packages/aztec-runtime/src/pxe/service.ts:166` `new ProductionPxeFactory()`.
2. `packages/aztec-runtime/src/pxe/chain-runtime.ts:22-25` — `AcceleratorEndpoint { host?, port? }` has no `httpsOnly` field; `:129-138` host/port `undefined`; `:228-229` `accelerator: undefined`, `new AcceleratorProver({ simulator, onPhase, accelerator })`; installed via `createPXE(..., { proverOrOptions })` at `:248`.
3. SDK `@alejoamiras/aztec-accelerator@5.2.0` `src/lib/accelerator-prover.ts:68-70,109-148` — defaults loopback `59833`/`59834`; `httpsOnly` resolves false absent an option or env flag (`apps/extension/vite.config.ts:334-337` statically defines `process.env` as `{ LOG_LEVEL, BB_WASM_PATH }`, so `AZTEC_ACCELERATOR_HTTPS_ONLY` can never be present in the offscreen document).
4. `src/lib/accelerator-transport.ts:368-380` — constructor `httpsOnly = false` (`:372`); `#effectiveHttpsOnly :455-457` = `httpsOnly || !allowsHttpDowngrade`; `allowsHttpDowngrade :477-480` true until HTTPS has ever been healthy; `probeHealth :582-606` fires HTTP and HTTPS probes (`:603-605`); `isRecognizedHealthBody :201-205` is a JSON-shape check (`status: "ok"`, `api_version: 1`); `#probePreferHttps :632-690` — a healthy HTTP wins after `HTTPS_GRACE_MS`, or immediately if HTTPS never answers (`:663-677`).
5. `accelerator-prover.ts:243-246,302-329` accepts the versionless health body and pins the protocol; `:392,407` serializes `PrivateExecutionStep[]`; `:426` `postProve` → `accelerator-transport.ts:740-758` `POST http://127.0.0.1:59833/prove` with `content-type: application/octet-stream` and an optional `x-aztec-version` — no authorization header, no shared secret, no mTLS.

**Preconditions:** an unprivileged local process (including another OS user on a shared host) binds `127.0.0.1:59833` and serves the two-field health JSON; no genuine HTTPS accelerator has been healthy earlier in this transport instance; the unlocked wallet proves a transaction.

**Existing controls and why they don't cover it:** `assertLoopbackHost` restricts location, not process identity; `redirect: "error"` (`:750-752`) stops forwarding the witness elsewhere; once HTTPS has been healthy, plaintext is refused under the default policy (`:455-480, 519-539`) — protecting only later proofs of the same instance (Codex). The SDK's own comment at `:475` states the exposure. Fallback: network-layer failures degrade to WASM (`accelerator-prover.ts:516-524`); HTTP non-2xx responses are classified and may propagate (`:525-530`) — the consolidated "any error falls back" is too broad (Codex).

**Recommended fix:** add `httpsOnly?: boolean` to `AcceleratorEndpoint` (`chain-runtime.ts:22-25`) and build the accelerator object at `:228` whenever any field is set (`{ host, port, httpsOnly: true }` — the current ternary yields `undefined` when host/port are unset), consumed by the SDK at `accelerator-prover.ts:113`. Mirror the SDK's own knob (`accelerator-transport.ts:372`; env equivalent `AZTEC_ACCELERATOR_HTTPS_ONLY`, `accelerator-prover.ts:122-123,137-138`) — a missing pass-through, not a new pattern. Alternative: explicit user opt-in before discovery. Regression risk: HTTP-only or untrusted-CA accelerator installs fall back to WASM (`accelerator-prover.ts:351-355`) — the same UX as no app. Open item both verifiers flag from different sides: CI installs and starts `accelerator-server` (`.github/workflows/_extension-network-e2e.yml:155-172`) with `VITE_NULO_ACCELERATOR_REQUIRED=1` (`:122`) → `provingMode: "required"`; whether that binary serves HTTPS on 59834 with a CA the CI Chrome trusts was not established by either family (the workflow shows no TLS/CA setup) — confirm before flipping, or the required-mode preflight reds the network gate. `apps/extension/manifest/manifest.config.ts:20` grants HTTP loopback and should be reviewed after the flip. CA provisioning not inspected. Effort: hours of code, gated on the CI confirmation.

**Verifier disagreements:** none on verdict or band. Codex's narrowings adopted (HTTP is not freely available after a healthy HTTPS; error fallback is not blanket; witness contents were not independently serialized). Claude: the fix is not a one-line edit because the field is missing from `AcceleratorEndpoint`.

**Probe evidence:**
- Codex: the actual transport with mocked `fetch` — HTTPS refused and HTTP `200 {"status":"ok","api_version":1}` → HTTP selected; `postProve` sent an unchanged synthetic byte array with only `content-type` and `x-aztec-version`; explicit `httpsOnly: true` and a previously healthy HTTPS each produced zero HTTP requests. Real witness serialization not exercised.
- Claude: source reads including the SDK defaults and dual-probe logic (no execution).

---

### [Medium] F-18: Discovery flood caps skip the existing-session and duplicate-waiter branches; every reconnect handshake opens an uncapped verify window

**Verdict:** CONFIRMED (Claude — window half at high, waiter half mechanism-only) / CONFIRMED (Codex — both halves reproduced with counts)

**Final confidence:** high for the window half (the band-bearing half — Codex's harness counted 33 windows for 33 handshakes; Claude showed the cap call is syntactically unreachable on the branch); the waiter half is reproduced by Codex (65 pending) and confirmed mechanically by Claude, and stays bounded by one popup's lifetime.

**Band:** Medium (low end) — unchanged. Both verifiers: keep. Neither recommended a change. Claude flags a modest aggravator: a flood of real `chrome.windows.create` calls is also phishing camouflage (burying a genuine malicious approval among decoy verify windows), not enough to raise the band since no trace defeats the emoji-verification content itself.

**Strengthened trace (windows):**
1. A page at a previously connected origin repeats the SDK discovery handshake with a fresh `requestId` → `apps/extension/src/wallet/services/wallet-sdk/background.ts:334-338` (registration) → `handleDiscovery` (`:619`).
2. `:627-650`: unlocked profile; `:647` `tryGetDappSessionByOriginAndChain` (`dapp-session/service.ts:128-137` enforces profile, origin, chain, expiry) finds the remembered session → `:648-650` `autoApproveExistingSession(...)` then `return` — `checkDiscoveryPopupCaps` at `:670` is never reached; the caps themselves (`:606-607`, 32 global / 4 per origin; `:748-761`) count only `pendingDiscoveryPromises` keys, which this branch never touches. `autoApproveExistingSession :701-709` calls `approveDiscovery` (`:701-703`) and sets no `pendingVerification` marker.
3. SDK key exchange completes → callback `:340-355` → `handleSessionEstablished` (`session-established.ts:61`): `:89-137` row found and transport live; `:141` `stampSessionProfile`; no marker → `isNewConnection = false` (`:72`).
4. `:143` `needsVerification = isNewConnection || !dappSession.trustedVerification` — `trustedVerification?` is optional (`dapp-session/spec.ts:56,87`) and becomes `true` only via the "always trust" checkbox (`apps/extension/src/popup/windows/verify/index.vue:71-76`).
5. `:145-153` `chrome.windows.create({ type: "popup", url: …/windows/verify?sessionId=…&verificationHash=… })` — no count, no coalescing, no per-origin limit. Repeat from 1.

**Trace (duplicate waiters):** no stored session and one pending connect popup for the tuple → `:663-668` `pendingDiscoveryPromises.get(dedupeKey)` → `awaitPendingPopupDedupe` → `return` before `:670`; each fresh request waits at `:718`; the map holds one key regardless of waiter count; cleared only at `:833-835` when the single popup resolves.

**Preconditions:** one prior approval of the origin; unlocked profile; non-expired session; the "always trust" checkbox unticked (the default); a page able to re-run SDK discovery/connect with fresh ids. "Zero interaction" applies after the initial approval while unlocked (Codex).

**Existing controls and why they don't cover it:** the unit-D caps (`:606-607`, `:748-761`) bound connect popups on the fresh-connection branch only; the locked `DiscoveryQueue` (`packages/wallet-bridge/src/discovery-queue.ts:68-81`) and the content-relay cap are separate per-branch budgets; freshness, profile binding, revocation and transport liveness (`:687-703`, `session-established.ts:89-137`) remain enforced but count neither reconnects nor windows. The in-code `B-06` invariant: the verify URL carries `session.verificationHash` (`session-established.ts:49-51,148`), deliberately session-specific — which is why windows cannot simply be reused across sessions (see fix item 3).

**Recommended fix (refined against the consolidated three items):** (1) Reserve capacity for pending/open verify windows before the asynchronous `chrome.windows.create` — per origin and global — reject or terminate excess unverified sessions, release the reservation on creation failure and on window close; mirror the reservation/timeout/cleanup in `apps/extension/src/wallet/services/window-manager/window-manager.ts:79-138` and the reject-new admission in `discovery-queue.ts:68-81`. Size the verify cap independently of the connect-popup constants — multi-tab reconnect bursts are legitimate (Claude). (2) Bound same-tuple waiters before `awaitPendingPopupDedupe` (`:663-668`). (3) Do NOT "reuse/focus an open verify window" for a different transport session — its hash is session-specific (`:49-51,148`); consolidated item (1) is reworded to reservation, not reuse. (4) Consolidated item (3), "run `checkDiscoveryPopupCaps` before the auto-approve", is insufficient alone — remembered-session requests never increase the map it counts (Codex); a per-origin reconnect rate limit replaces it. Regression risk: legitimate concurrent connections; preserve profile separation and each session's verification hash. Effort: a day with the reservation design (the consolidated "hours" is optimistic).

**Verifier disagreements:** waiter-half confidence — Claude moderate-to-low (did not re-run the count), Codex reproduced 65; decisive: Codex's harness, and the half stays memory-only and lifetime-bounded, so no band effect. Fix design — Codex rejected two of the consolidated's three items (adopted above).

**Probe evidence:**
- Codex: the actual local handlers with mocked SDK/browser boundaries processed 33 discoveries and established-session callbacks → 33 approvals and 33 `windows.create` calls while the connect-popup map stayed empty; a trusted reconnect created no window; 65 duplicate requests stayed pending behind one popup promise and settled when it resolved.
- Claude: source only; confirmed the `:833-835` `finally` cleanup and the unreachability of `:670` on both branches.

---

## Not verified in Phase 4 (below the top-10 cap)

- **F-10** — Low; confidence high; carried from consolidated.md; coordinator-verified at source, not double-verified.
- **F-11** — Low; confidence high; carried from consolidated.md; coordinator-verified at source, not double-verified.
- **F-12** — Low; confidence high (traces) / moderate (deception yield); carried from consolidated.md; coordinator-verified at source, not double-verified.
- **F-13** — Low; confidence moderate (defect certain, reachability undemonstrated); carried from consolidated.md; coordinator-verified at source, not double-verified.
- **F-14** — Low; confidence high; carried from consolidated.md; coordinator-verified at source, not double-verified.
- **F-15** — Low; confidence high (mechanism); carried from consolidated.md; coordinator-verified at source, not double-verified.
- **F-16** — Low; confidence high (mechanism); carried from consolidated.md; coordinator-verified at source, not double-verified.
- **F-17** — Low; confidence high; carried from consolidated.md; coordinator-verified at source, not double-verified.

## Verification summary table

| ID | Band | Final confidence | Claude verdict | Codex verdict | Band change? |
|---|---|---|---|---|---|
| F-01 | High | high | CONFIRMED | CONFIRMED | no |
| F-02 | High | high | CONFIRMED ((a),(b); (c) plausible, unexhausted) | CONFIRMED (all instances) | no |
| F-03 | High | high | CONFIRMED | CONFIRMED | no |
| F-04 | High | high | CONFIRMED (precondition corrected) | CONFIRMED | no |
| F-05 | High | high (mechanism; no authenticator demo) | CONFIRMED | CONFIRMED | no |
| F-06 | Medium | high | CONFIRMED | CONFIRMED | no |
| F-07 | Medium | high | CONFIRMED | CONFIRMED | no |
| F-08 | Low | high (Codex partial = read-scope only; SDK steps closed by Claude + coordinator) | CONFIRMED | PARTIALLY CONFIRMED | no |
| F-09 | Medium | high | CONFIRMED | CONFIRMED | no |
| F-18 | Medium (low end) | high (window half); waiter half reproduced by Codex only | CONFIRMED | CONFIRMED | no |
| F-10 | Low | high (consolidated) | — | — | no |
| F-11 | Low | high (consolidated) | — | — | no |
| F-12 | Low | high / moderate (consolidated) | — | — | no |
| F-13 | Low | moderate (consolidated) | — | — | no |
| F-14 | Low | high (consolidated) | — | — | no |
| F-15 | Low | high (consolidated) | — | — | no |
| F-16 | Low | high (consolidated) | — | — | no |
| F-17 | Low | high (consolidated) | — | — | no |

No finding was refuted; no band moved; no verified finding is relabeled Potential.

## Coupled findings

Groups that should ship together because they share a precondition, a fixture, or a mechanism — fixing one member without the others leaves the same vector open.

1. **Backup-restore trust review — F-03 + F-04 + F-07 + F-12 (+ F-13's note that restore keys rows from their own body, `account/service.ts:714-718`).** One "restored rows are hostile until re-derived" pass over every `restore()`: `fpc` (canonical-address reject), `network` (seed-anchored rebuild), `account`/`auth-registry` (scoped purge), `contact` (`sanitizeString`), `token-balance` (`updatedAt` clamp), `account-state` (self-consistent ≠ authentic). Shared hostile-backup fixture; one PR or one stacked arc. This group closes four of the five High/Medium findings that need only a crafted file.
2. **RPC trust — F-01 + F-04.** F-04 supplies the hostile RPC that F-01 needs; F-01 alone leaves the default third-party endpoint (`network/service.ts:102,111`) as the F-01 attacker; F-04 alone leaves any drifted/MITM'd endpoint free to pick the signing domain. Land F-01 first (self-contained, hours); F-04 rides in group 1.
3. **Same-phrase sibling isolation — F-06 + F-07 + F-11.** Master-only key derivation (F-06) and address-only row identity (F-07 auth registry, F-11 operation journal, and `transaction/service.ts:130-140` by the same shape) all collapse when two profiles share a master/address — a supported, warned flow. The DEK is the intended cryptographic separator; `(profileId, chainId, address)` is the intended row identity. F-07 belongs to both this group and group 1; sequence it once.
4. **Approval binding — F-02 + F-16.** What is shown vs what is signed (F-02) and what is approved vs what is executed (F-16). F-16's fix — materialize the executable operations SW-side from the stored payload and accept only wallet-generated deltas — is the same mechanism F-02(4) needs to surface discovered authwits bound to the execution being approved. Both are "days"; design them together, ship as one arc.
5. **Same-extension-caller trust tier — F-11 + F-13 + F-14 + F-16.** `isTrustedInternalSender` is the only gate; per-method ownership and request binding are inconsistent (consolidated cross-cutting 3). Not one PR — but one review lens; F-16 sits in group 4, the rest are independent hour-scale fixes.
6. **F-09 alone** — local-service trust; coupled only to the CI HTTPS confirmation noted in its fix.
7. **F-05 alone** — pre-launch-only window; a product/infra decision (`RP_ID` subdomain) that must land before the first real passkey wallet is created; after launch it is a new-major-class change.
8. **F-18 alone** (partial regression of July unit-D's intent), **F-08 alone** (unit-A coverage gap on the later-added fast path), **F-10**, **F-15**, **F-17** each alone.

## Cheapest fixes first

Hour-scale fixes that land in one PR each, ordered by band then regression risk. Effort is the verifiers' assessment, not the consolidated's, where they differ.

1. **F-01** (High, hours) — one function edit in `chain-identity.ts` (add `l1ChainId` to the interface, exact-equality check, canonical-range guard) + route `fn.ts:85-100` through it + one test vector. Mirror `network/service.ts:568-572`. Low regression.
2. **F-03** (High, hours) — `restore()` rejects non-canonical `PrivateFpc`; `fee-helpers.ts:157` / `gas-balance-reader.ts:181` / `getFpcImpl` select on `isProtocol === true`. Mirror `fpc/service.ts:362-369` and `fpc-strategy.ts:111-115`. Zero regression for real users. (Also a member of the backup-restore group; can land alone first.)
3. **F-15** (Low, under an hour) — TTL check in `finalizePasskeyRestoreHoldingLock` mirroring `profile/service.ts:221-225`; clear `pendingRestoreSecrets`/`pendingDekRewraps` in `lockActiveProfile`.
4. **F-12** (Low, hours) — `sanitizeString(name, 20)` in `ContactService.restore` (mirror `:188-189`); force/clamp `updatedAt` in `TokenBalanceService.restore`. Best folded into the backup-restore PR; trivial standalone.
5. **F-10** (Low, hours) — pass `Error` objects at `pxe/service.ts:926-927` and `network/service.ts:1003`; `scrubUrls` on the primitive-string branch of `trim()`; extend `log-payload-ban.test.ts` to flag `getErrorMessage(`/`errorMessageFromUnknown(` as log arguments.
6. **F-08** (Low, hours) — name↔selector bind before `runFastPath`, mirror `view-executor.ts:361-381`; add the missing mismatch test. Watch the fast-path resolver cost; keep binding failures out of the fallback handler.
7. **F-17** (Low, hours) — inline the discovery icon (data URI) or narrow `web_accessible_resources` `matches`; single consumer at `wallet-sdk/background.ts:106`.
8. **F-11** (Low, hours) — `record.profileId === activeProfile.id` on every journal method (mirror `execution-lane.ts:174-177`); drop the three write methods from popup-reachable `rpcMethods`; add the profile filter at `TokensView.vue:52`.
9. **F-09** (Medium, hours of code — gated) — thread `httpsOnly: true` through `AcceleratorEndpoint`. Do the CI HTTPS/CA confirmation first; without it the required-mode network gate may red.
10. **F-18** (Medium, about a day, not hours) — verify-window reservation + waiter bound + reconnect rate limit; the reservation design (Codex) is what moves it past "hours". Still one PR.

Not in this list, by design: **F-04** (hours of code, but the seed-anchored rebuild is a design decision — fold into the backup-restore arc), **F-05** (hours of code plus a product/infra decision and a one-way domain move), **F-06** (hours to a day plus the DEK-less-session lifecycle decision), **F-07** (hours to a day, eight surfaces to scope), **F-02** and **F-16** (days each, one arc), **F-13** (hours, but lowest priority — no untrusted writer found), **F-14** (hours for the sender check; the Port migration is more).
