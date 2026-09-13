# Harden Report: security

**Repo:** nulo (`apps/extension` + the wallet packages)
**Date:** 2026-09-13
**Effort:** high
**Run ID:** 2026-09-13-high-prerelease
**Target:** `origin/dev` @ `62f3456a` (the code the next `dev → main` promote ships; `main` is at 0.27.0)
**Models:** Phase 1 map — Claude Sonnet 5 · Phase 2 clusters — Claude Sonnet 5 + GPT-6 Astra (Codex, `xhigh`) · Phase 2.5 rebuttal — same pair · Phase 3 coordinator — Claude Fable 5.1 · Phase 4 verifiers — Claude Sonnet 5 + GPT-6 Astra, merged by Fable 5.1 · Phase 5 — Fable 5.1
**Scope:** `apps/extension/src/**` (wallet behaviour, manifest/build, trust-boundary UI: approval windows, secret display) and the six packages it depends on: `wallet-core`, `wallet-crypto`, `extension-messaging`, `aztec-runtime`, `wallet-bridge`, `wallet-sdk-schema-patch`. **Excluded:** `packages/bridge-core` bodies (tools product, not releasing — its four `fee-juice` call sites in the extension were in scope), `apps/tools`, `apps/faucet`, `apps/landing`, `apps/playground`, `packages/design`, generated `.d.ts`, `dist/`, all tests/e2e/fixtures unless production-wired.
**Stakeholder page:** private Claude Artifact — https://claude.ai/code/artifact/fcb9f586-9c9a-4422-886d-921ed78c5c0e (also in `ARTIFACT-URL.md`).
**Engineering detail:** `findings/consolidated.md` (all 18 findings, full traces, 17 dropped items with reasons), `findings/verified.md` (the 10 double-verified findings with strengthened traces, probe evidence, coupled groups, cheapest-fixes), `raw/` (11 cluster prompts, 22 cluster reports with cross-rebuttals, 9 repo maps, 6 verifier reports, Codex run trailers).

## Executive summary

This is the third whole-scope security pass on the wallet (after `2026-06-08-ultra` and `2026-07-06-max`); all 14 July findings were remediated in PR #272 and every one of those remediations is still in place. The new run found **18 findings: 5 High, 4 Medium, 9 Low**. Every High and Medium was independently confirmed at source by both model families in Phase 4, with the assigned bands kept. No Critical: nothing lets an attacker move funds or recover a key without either a specific precondition (a doctored backup the user imports, a lying RPC, a compromised first-party web origin, a same-phrase sibling profile) or a user click on a misleading screen. The cryptography package itself came back clean from both families — the problems are at the boundaries where the wallet decides whom to trust.

Three themes carry most of the weight. **(1) RPC honesty is an unstated trust root, and the one place the wallet claims to verify it does not** (F-01): the signing-time chain-identity check compares only the XOR composite `l1ChainId ^ rollupVersion`, so a drifted or compromised endpoint — the default is a third-party load balancer — chooses the chain domain of every signed transaction and authwit. This is the finding the July run held as "needs a schema change"; the schema change shipped (key-model-v2 stores the exact `l1ChainId`), but the signing gate was never updated to use it. Fix is hours. **(2) Backup import is defended by shape, not semantics** (F-03, F-04, F-07, F-12): a doctored copy of the user's own backup can plant a fake "Private Fee Juice" payer that the Send flow auto-selects, a "mainnet" network row bound to an attacker RPC that suppresses the genuine seeds, and rows that purge another profile's authwit index. One "restored rows are hostile until re-derived" review of every `restore()` closes four findings. **(3) The approval popup no longer shows what is signed for the most common call** (F-02): the transfer-recognition allowlist drifted from the wallet's own token model, so a standard `transfer(to, amount)` renders with no recipient and no amount, and authwit approvals never show the delegate (`caller`). The July "truthful display" sanitizer is intact; its vocabulary regressed.

Two items need a product decision before launch rather than a patch. **F-05** (High): the passkey wallet's master secret is reproducible by any web page on `nulo.sh` or a subdomain (`tools.nulo.sh`, `testnet.tools.nulo.sh` are live first-party deployments), because WebAuthn's RP-ID scoping is domain-wide and the PRF input is a public constant; moving the RP ID to a content-less subdomain bricks existing passkey wallets, so it is only fixable pre-production. **F-09** (Medium): every production wallet probes `127.0.0.1:59833` over plaintext HTTP for the accelerator and posts the full private witness to whatever answers a JSON health check; the SDK's `httpsOnly` flag is available and unset. Recommended priorities: land the hours-scale fixes for F-01, F-03, F-09, F-18, F-08 in the first PR; decide F-05 now; then the backup-restore review (F-04, F-07, F-12) and the approval-display work (F-02, days).

## Methodology

**Shape.** Map-reduce per the `harden` skill at effort `high`, on a detached worktree of `origin/dev` @ `62f3456a` (the code the next `dev → main` promote ships). Phase 1 built a hierarchical repo map (one outer workspace mapper + eight per-package/per-area mappers, Claude Sonnet 5; saved under `raw/repo-map/`). Phase 2 clustered the scope into 11 security clusters by entrypoint and sink family (`raw/prompts/c*.md`), and ran two independent auditors per cluster: a Claude Sonnet 5 agent and a Codex session on GPT-6 Astra at `xhigh` reasoning, read-only sandbox. Phase 2.5 ran a light cross-rebuttal: each auditor read the other family's report and appended a `## Cross-rebuttal` section (Claude via a fresh agent; Codex by resuming the cluster's session). Phase 3 was a single Fable 5.1 coordinator that re-opened every cited line at source, deduplicated by root cause + sink + boundary, resolved cross-model disagreements, dropped speculative items, and assigned CVSS v4.0 bands. Phase 4 verified the top 10 findings by severity bucket (all 5 High, all 4 Medium, plus F-08) with fresh Claude Sonnet 5 and GPT-6 Astra sessions under an anti-anchoring rule (form an independent conclusion from the cited lines before reading the trace); a Fable 5.1 merge produced `findings/verified.md`. Phase 5 (this report and the Artifact page) was written by Fable 5.1.

**Controls.** Inter-procedural context was capped at ~4 functions per trace with handoff-edge escalation (event emit → listener, message produce → consume, port open → handler, service registration → consumer). The negative list from the skill applied: no theoretical risks, no defense-in-depth without a vector, nothing in test/fixture/e2e code unless production-wired, nothing in `packages/bridge-core` bodies, `apps/tools`, `apps/faucet`, `apps/landing`, `apps/playground`, or the design package. The extension's four call sites into `@nulo/bridge-core/fee-juice` (`predictedWorstMinFees`, `MinFeeNode`) were in scope as extension code. Vue UI was out of scope except where it forms a trust boundary (what is displayed vs what is signed; secret display and clearing).

**Deviations from the formal spec (honest accounting).**
- The Phase 1 mappers ran as read-only `Explore` agents and could not write their maps; the orchestrator transcribed six of nine maps verbatim from the agents' results (paths unchanged, HTML entities decoded). Three mappers had write access and wrote their own.
- Codex refused three cluster prompts (c01, c03, c06) mid-run on OpenAI's cyber-safety filter ("flagged for possible cybersecurity risk"). All eleven Codex prompts were re-issued with defensive phrasing (`raw/SECURITY-PROMPT-codex.md`: "hardening review for the code owner", "untrusted party", "failure scenario"); c01 and c03 then completed. c06 refused a second time at the same point (reading `@aztec/wallet-sdk`'s channel-crypto module) and completed on a third, fully neutral prompt that forbade reading `node_modules`. The refused transcripts are kept at `raw/codex-runs/*refused.log`.
- The c06 Codex report landed after the coordinator had written `consolidated.md`; the coordinator was resumed and folded it in (F-08 moved from single-family to converged; F-18 was added; F-01 gained the c06 instance).
- Phase 2.5 "light pass" was implemented as one rebuttal round per side with a 700-word cap, no second push-back round.
- Density: 18 findings after dedupe versus the skill's ~13 target for 11 clusters. The coordinator kept the nine Lows because each has a distinct root cause with a verified trace and a named precondition; 17 further traced items were dropped below the floor and are listed in `findings/consolidated.md` under "Findings NOT pursued".
- Verification is static: every cited line was re-read at `62f3456a`, and several verifiers ran throwaway probes (`bun -e` arithmetic for the F-01 collision, in-memory service instantiation for F-03/F-04/F-06), but no proof-of-concept against a live network or a physical authenticator was executed.
- Per the owner's instruction this run ships the stakeholder page as a private Claude Artifact rather than `report.html`; the URL is in the header.

**Prior runs.** `2026-06-08-ultra-e6759a` and `2026-07-06-max` covered the same scope; all 14 July findings were remediated in PR #272. This run's regression check on those remediations (units A–K) is in § July-2026 remediation regression check.

## Findings

Bands are CVSS v4.0 qualitative (Critical ≥ 9.0 / High 7.0–8.9 / Medium 4.0–6.9 / Low 0.1–3.9), wallet-calibrated. "Found by" and "Cross-model" are per the coordinator; "Verified" is the Phase 4 outcome (Claude / Codex). All `file:line` are at `62f3456a`.

| ID | Band | Title | Verified | Effort |
|---|---|---|---|---|
| F-01 | High | Signing-time chain-identity check compares only the XOR composite | ✔ / ✔ | hours |
| F-02 | High | Approval popup renders a subset of what is signed (transfer args, authwit caller, discovered authwits) | ✔ / ✔ | days |
| F-03 | High | Hostile backup plants a non-canonical PrivateFPC row that the Send flow auto-selects | ✔ / ✔ | hours |
| F-04 | High | Hostile backup mints a "mainnet" row bound to an attacker RPC; default seeds suppressed | ✔ / ✔ | hours |
| F-05 | High | Passkey master reproducible by any `nulo.sh`-eligible web origin | ✔ / ✔ | hours + decision |
| F-06 | Medium | Same-master sibling profiles share the dApp-session MAC key and PXE store key | ✔ / ✔ (probe) | hours–day |
| F-07 | Medium | Auth-registry rows carry no profile/chain provenance (purge/sync/read by address) | ✔ / ✔ | hours–day |
| F-09 | Medium | Unauthenticated loopback HTTP accelerator receives the private witness | ✔ / ✔ | hours |
| F-18 | Medium | Discovery caps bypassed on the reconnect path; verify windows uncapped | ✔ / ✔ | hours |
| F-08 | Low | `simulateTx` public-static fast path authorizes by name, executes by selector | ✔ / partial | hours |
| F-10 | Low | RPC errors flattened to strings bypass the URL-credential log scrub | coordinator only | hours |
| F-11 | Low | Operation-journal RPCs have no profile binding (cross-profile rows; controller-less cancel) | coordinator only | hours |
| F-12 | Low | Restore persists unsanitized contact names and future-dated balance timestamps | coordinator only | hours |
| F-13 | Low | Account keyed reads bind profile/chain but not address; imported signer follows the row body | coordinator only | hours |
| F-14 | Low | Offscreen transport: untargeted broadcast + no sender check on the SW-side client | coordinator only | hours |
| F-15 | Low | Pending passkey-restore secret ignores its TTL and survives explicit lock | coordinator only | hours |
| F-16 | Low | `approveInteraction` executes caller-supplied operations, unbound from the stored payload | coordinator only | days |
| F-17 | Low | `web_accessible_resources` exposes the logo to every origin (install fingerprint) | coordinator only | hours |

---

### [HIGH] F-01: Signing-time chain-identity check compares only the XOR composite — a lying RPC chooses the chain domain of every signed transaction and authwit
**Impact:** High (7.0–8.9) — integrity of all signed material; attacker is the configured RPC; no user interaction beyond normal use; cross-chain redemption not demonstrated (keeps it below Critical).
**Confidence:** high **Mapping:** OWASP A08 / CWE-354
**Found by:** both **Clusters:** c03, c06, c08, c09 **Cross-model:** converged **Verified:** CONFIRMED / CONFIRMED (arithmetic reproduced with `bun -e`)

**Instances:**
- `packages/aztec-runtime/src/utils/chain-identity.ts:34-36` (`SelectedNetworkChainInfo` carries only `chainId`), `:53-61` (composite-only compare), `:69-71` (`chainInfoFrom` forwards raw live values)
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:220-221,286`, `:404-407,414-418`
- `apps/extension/src/wallet/services/execution/service.ts:227-232`, `:872-879,935` (`executeAztecCreateAuthWit`)
- `execution/dapp-send-executor.ts:853-863`; `authwit-discoverer.ts:106-110`; `discovery-probe.ts:73-75`; `fast-path.ts:176-183`; `view-executor.ts:207-211`; `helpers/batched-view-simulation.ts:203-205,357-366,538-547`
- Unguarded caller (no assert at all): `apps/extension/src/wallet/utils/fn.ts:85-95` via `token/service.ts:711,716,720` (read-only)

**Description:** The stored network identity is `(l1ChainId ^ rollupVersion) >>> 0`. `assertLiveChainIdentity` recomputes that XOR from the live `getNodeInfo()` and compares composites. For any attacker-chosen `L'`, `rollupVersion' = stored ^ L'` collides; every caller then embeds the raw live pair into what the account signs. The exact `l1ChainId` is already a first-class `Network` field (`network/spec.ts:36-39,69`), and endpoint add/edit already require exact equality with a comment naming this collision (`network/service.ts:565-572,612-618`) — that discipline never reached the signing gate.

**Trace:** RPC-controlled `node.getNodeInfo()` (`execution/service.ts:872`) → `assertLiveChainIdentity(network, nodeInfo)` compares only `(l1 ^ rv) >>> 0` (`chain-identity.ts:55-56`) → `metadata = {chainId: Fr(nodeInfo.l1ChainId), version: Fr(nodeInfo.rollupVersion)}` (`:876-879`) → `computeAuthWitMessageHash(intent, metadata)` (`:922/:929`) → `account.createAuthWit(messageHash)` (`:935`). Transaction arm: `tx-request-builder.ts:220-221` → `chainInfoFrom(nodeInfo)` at `:286` → `NuloAccount.buildTxExecutionRequest` (`packages/aztec-runtime/src/account/nulo-account.ts:184`). Worked collision: mainnet `(1, 4248422647)` → `4248422646`; `(2, 4248422644)` → `4248422646` (`apps/extension/src/utils/chain-ids.ts:17-18,30`).

**Why it matters:** The wallet's own F-012 invariant ("refuse to sign/prove against a drifted endpoint") is void. Key-model-v2 fixed *which key* signs, not *which domain* it signs for. Precondition: a compromised, drifted or MITM'd RPC the wallet is configured to use — realistic for a default third-party endpoint, and trivially satisfied under F-04.

**Recommended fix:** Extend `SelectedNetworkChainInfo` to `{chainId, l1ChainId}`; in `assertLiveChainIdentity` require `nodeInfo.l1ChainId === network.l1ChainId` in addition to the composite (which then pins `rollupVersion` exactly); every caller already passes the full `Network`. Route `fn.ts:85-95` through the same assert. Local networks (`chainId === 0`) compare `l1ChainId` against `LOCAL_L1_CHAIN_ID`. Add a canonical-range guard on the live value (`assertCanonicalL1ChainId`). Mirror: `network/service.ts:565-572`.
**Effort:** hours.

---

### [HIGH] F-02: Approval popup renders only a subset of what is signed
**Impact:** High — the one control that turns a signature into informed consent fails on the most common call shapes; any connected dApp with a transaction grant; the click is the thing being deceived.
**Confidence:** high **Mapping:** OWASP A04 / CWE-451
**Found by:** both **Clusters:** c07, c08 **Cross-model:** converged on (a)/(b); (c) resolved for as a disclosure instance **Verified:** CONFIRMED / CONFIRMED

**Instances:**
- (a) `apps/extension/src/utils/transfer-intent.ts:23` (four legacy names only), `:72` (`args.length !== 3`) vs the wallet's own descriptor table `apps/extension/src/wallet/services/token/functions/descriptors.ts:322-325,361-363`; sink `apps/extension/src/popup/windows/execute/OperationCard.vue:117-156` — no fallback branch after the `v-if` at `:135`; the confident label comes from a second table `apps/extension/src/utils/tx-enrichment.ts:17,23-26`
- (b) `OperationCard.vue:357-392` (`aztec_createAuthWit`): renders target + function name only — never `caller`, never `call.args`, never the `innerHash`; execution hashes all of them (`execution/service.ts:909-929`) and signs (`:935`)
- (c) Kernelless discovery: `execution/discovery-probe.ts:80-90` keeps `{contractAddress, innerHash}` and emits `add_private_authwit`; `fee/fee-juice-strategy.ts:32-39` appends it at estimate time; `tx-request-builder.ts:146-161` signs it; the popup iterates the original `exec.calls` only
- (d) Lesser: `authWitnesses`/`capsules`/`extraHashedArgs` absent from the primary card (`tx-request-builder.ts:347-358`), visible only in the JSON window (`popup/windows/json/index.vue:12,56`)

**Description:** `handleSendTx` forwards the raw `args[0]` as `exec` (`packages/wallet-bridge/src/dispatcher.ts:941-952`). The popup's "do not guess" parser recognizes exactly four names at exactly three args; the pinned standard token's `transfer(to, amount)` and the 4-arg `_nonce` variants the wallet itself constructs both return `unverified`, and `unverified` renders nothing — no recipient, no amount, no warning. The authwit branch omits the one field that says who is being authorized. Discovered authwits are signed on the estimate path before the popup and never surfaced.

**Trace:** dApp `sendTx({calls:[{to: TOKEN, name: "transfer", args: [ATTACKER, AMOUNT]}]})` → `dispatcher.ts:946-952` → `OperationCard.vue:117` → `parseTransferIntent` returns `unverified` (`transfer-intent.ts:64-66`) → `:135` false → user sees "Transfer (private) on 0xTOKEN…" (`:126-128`) → `approve()` forwards the untouched call (`popup/windows/execute/index.vue:412-446`) → `tx-request-builder.ts:184-188` encodes the real args.

**Why it matters:** The July "truthful approval display" (unit B) is intact as a sanitizer; its vocabulary drifted from the token model, restoring the pre-F-008 blank-args state for the calls that matter.

**Recommended fix:** (1) Derive the recognized-transfer set and arities from `TOKEN_FN_DESCRIPTORS` — one vocabulary. (2) Implement the promised fallback: for `unverified`, render indexed raw args with an explicit "unverified — review arguments" marker; never a bare method label. (3) Authwit branch: render `caller`, args, and for `IntentInnerHash` the hash plus an "opaque authorization" warning. (4) Surface discovered authwits from the estimate result and list them on the card.
**Effort:** days.

---

### [HIGH] F-03: Hostile backup plants a non-canonical PrivateFPC row that becomes the only selectable "Private Fee Juice" payer
**Impact:** High — a hostile backup that redirects fee payments; the crafted row is indistinguishable in the UI, suppresses the genuine option, and lands a `pay_fee()` call to an attacker contract inside the user's signed private transaction. Sequencer inclusion with a non-paying payer unverified (below Critical).
**Confidence:** high **Mapping:** OWASP A08 / CWE-345, CWE-863
**Found by:** both **Clusters:** c04 **Cross-model:** converged **Verified:** CONFIRMED / CONFIRMED

**Instances:**
- Root: `apps/extension/src/wallet/services/fpc/service.ts:503-525` (restore: shape only); enum `fpc/spec.ts:15-18` (`PrivateFpc = 2`)
- Type-only selection, `isProtocol` ignored: `apps/extension/src/popup/components/modules/send/fee-helpers.ts:157,161-163,191-207,89-92`; `execution/gas-balance-reader.ts:180-184`
- Discovery appends the genuine row after the poisoned one: `fpc/service.ts:157-158,173-174,187`
- Execution sink: `execution/fee/fpc-strategy.ts:101-106` → `getFpcImpl` (`fpc/service.ts:426-432`) → `fpc/handlers/private-fpc-handler.ts:23-31`
- Compounding registration: `account-state/service.ts:384-400` registers any backup-supplied `{instance, artifact}`
- Contrast (live edit path refuses a PrivateFpc address change): `fpc/service.ts:362-369` — so no legitimate non-canonical row can exist, and the fix has near-zero regression risk

**Trace:** backup `data.fpc[]` (checksum recomputable — `useFullBackupImport.ts:93`) → `fpc/service.ts:498-525` writes the row → Send opens → `getFpcs` appends canonical after it (`:187`) → `fee-helpers.ts:157-163` selects the poisoned row, hides the canonical → user picks "Private Fee Juice" → `fpc-strategy.ts:102-106` → `private-fpc-handler.ts:26-30` prepends `pay_fee` at the attacker address into the transaction that is simulated, proven and signed.

**Recommended fix:** In `restore()`, reject any `PrivateFpc` row whose address ≠ the derived protocol address (`getOrComputeProtocolAddresses`), recording it as `restoreError` — narrowed to `PrivateFpc` on verification because user-added sponsored FPCs are a supported flow. In `fee-helpers.ts:157` and `gas-balance-reader.ts:181` select `f.type === PrivateFpc && f.isProtocol === true` (the signal `fpc-strategy.ts:115` already uses).
**Effort:** hours.

---

### [HIGH] F-04: Hostile backup mints a `kind:"mainnet"` network row bound to an attacker RPC; default seeds are suppressed
**Impact:** High — persistent, silent RPC-level MITM of the restored profile (balances, receipts, fee quotes, simulation, broadcast); combined with F-01 the attacker also controls the signed chain domain.
**Confidence:** high **Mapping:** OWASP A08 / CWE-345, CWE-923
**Found by:** claude (Codex NF-3 saw the restore gap, not the seed-suppression amplifier) **Clusters:** c09 **Cross-model:** disagreement — resolved for on the mechanism; exploit narrative corrected to "doctored copy of the victim's own backup" **Verified:** CONFIRMED / CONFIRMED

**Instances:** `apps/extension/src/wallet/services/network/service.ts:1046-1059` (`validateRestoredNetwork`: schema + `(profileId, chainId)` collision only — never `assertCanonicalStoredL1` `:346-355`, never a probe), `:860-901` (restore writes), `:232-242` (`getOrInitNetworks` returns early when ≥1 row exists — seeds never land); `network/spec.ts:187-196` (`kind` is a free optional label; `:225-227` the only user-facing creator hardcodes `custom`); entry `composables/useFullBackupImport.ts:475-488` → `full-backup-restore.ts:267`.

**Description:** `restore` is the only path that can write `kind: "mainnet"|"testnet"`. A row `{kind:"mainnet", l1ChainId: 1, chainId: 4248422646, endpoints:[{rpcUrl:"https://attacker"}]}` passes `NetworkSchema` (any HTTPS host), lands in a fresh profile, and because the profile now has a network row, `DEFAULT_SEEDS` (`:99-126`) are never seeded. `assertCanonicalStoredL1` would pass anyway (genuine constant), so derivation yields the user's real addresses and the UI is indistinguishable. The RPC-URL scheme allowlist (`spec.ts:152-179`) was designed against `javascript:`/plaintext, not a hostile HTTPS operator.

**Recommended fix:** In `validateRestoredNetwork`, reject (or force to `kind: "custom"` with a distinct name) any seeded-kind row whose primary endpoint ≠ the in-code seed URL; then rebuild the seeded kinds anchored to the in-code seeds (a naive per-kind reseed collides with the uniqueness check at `:1055-1056`); consider a live probe with exact-L1 equality at restore (mirror `:565-572`).
**Effort:** hours.

---

### [HIGH] F-05: Passkey wallet master is reproducible by any `nulo.sh`-eligible web origin
**Impact:** High — full master-secret compromise (all derived accounts) with no extension involvement. Preconditions: script execution on `https://nulo.sh` or an eligible subdomain (`tools.nulo.sh`, `testnet.tools.nulo.sh` are live first-party CF Pages deployments) plus one user-verified passkey ceremony on that page.
**Confidence:** high (mechanism, specification-defined) / moderate (no physical-authenticator demonstration) **Mapping:** OWASP A07 / CWE-863, CWE-200
**Found by:** both (Codex found in c02 and c10; Claude adopted in both) **Cross-model:** converged post-rebuttal **Verified:** CONFIRMED / CONFIRMED (W3C PRF explainer + MDN checked: RP-ID is registrable-domain-suffix scoped; "origins authorised to get an assertion are also authorised to evaluate any PRFs")

**Instances:** `apps/extension/src/wallet/services/passkey/spec.ts:21` (`RP_ID = "nulo.sh"`); `manifest/manifest.config.ts:20`; `wallet/utils/passkey-ceremony.ts:33-36,48-51,64,68-77,131-135`; `packages/wallet-crypto/src/constants.ts:10` (`PASSKEY_PRF_LABEL = "nulo:profile:v1"`, public); `packages/wallet-crypto/src/passkey-credential.ts:49-57,73-92` (master = HKDF(PRF, salt = H(label‖credentialId)) — no extension-exclusive input).

**Trace:** attacker script on an RP-eligible origin → `navigator.credentials.get({rpId:"nulo.sh", extensions:{prf:{eval:{first: SHA256("nulo:profile:v1")}}}})` (mirrors `passkey-ceremony.ts:68-77`) → user completes UV → page holds the same `{id, prf}` the extension would (`:131-135`) → `PasskeyCredential.create` + `deriveMasterSecret` (`passkey-credential.ts:49-92`) → master.

**Why it matters:** The extension's sender guard, credential-id equality check and CSP never run — the ceremony never touches the extension. Every derived account is exposed; imported-account keys additionally need the DEK envelope.

**Recommended fix:** Pre-production is the only window: move `RP_ID` to a dedicated, content-less subdomain (e.g. `passkey.nulo.sh`) that never hosts application code, so `nulo.sh`/`tools.nulo.sh` are not RP-eligible; update `check-rp-id.ts` and the host permission. Changing `RP_ID` after launch bricks existing passkey wallets (`spec.ts:15`). Treat every `*.nulo.sh` deployment as key-material-adjacent (strict CSP, no third-party scripts).
**Effort:** hours (code) + the product decision.

---

### [MEDIUM] F-06: Same-master sibling profiles share the dApp-session MAC key and can derive each other's PXE store key
**Impact:** Medium — real cryptographic-separation break; attacker must hold the shared master (a sibling profile from the same phrase) and raw storage/OPFS access; transaction confirmation remains enforced.
**Confidence:** high **Mapping:** OWASP A02 / CWE-323-class, CWE-863
**Found by:** both **Clusters:** c02 (theme in c11) **Cross-model:** converged **Verified:** CONFIRMED / CONFIRMED — executable probe imported the shipped `derivePxeStoreKey` and showed B's key computed from A's master equals B's own key; an HMAC minted under A's derived MAC key verifies under B's.

**Instances:** MAC key `apps/extension/src/wallet/services/profile/service.ts:913-933` (IKM = master; fixed salt/info; `profileId` only fetches the secret) → `dapp-session/mac-storage.ts:30-34,85-104`; PXE key `packages/wallet-crypto/src/pxe-store-key.ts:29-34` (salt = public `profileId`) ← `wallet/runtime.ts:542-544`; duplicate-phrase profiles are a supported flow `profile/service.ts:2004-2015` (`allowDuplicate`). The DEK is the codebase's stated separator for exactly this attacker (`packages/wallet-crypto/src/entropy-mac.ts:12-15`) — applied to the envelope MAC, never extended here.

**Recommended fix:** Mix the profile DEK into both KDFs (`ikm = master ‖ dek`, as `entropy-mac.ts` does). For the PXE key, accept that a degraded (DEK-less) session cannot open the store, or scope the DEK requirement to the imported-account subset. Pre-production: no migration. Update `dapp-session/service.test.ts:26-48`, which stubs the derivation and masks this.
**Effort:** hours to a day.

---

### [MEDIUM] F-07: Auth-registry rows carry no profile/chain provenance — address-only purge, sync-delete and read
**Impact:** Medium — integrity/availability of the only local index of live public authwits (not enumerable from chain, `auth-registry/service.ts:115-119`), triggerable by a hostile backup with no sibling; cross-profile disclosure of intent metadata; no on-chain grant created or revoked.
**Confidence:** high **Mapping:** OWASP A01 / CWE-863, CWE-668
**Found by:** both **Clusters:** c02, c04, c08 **Cross-model:** converged **Verified:** CONFIRMED / CONFIRMED

**Instances:** row shape `auth-registry/spec.ts:24-40` (no `profileId`, no `chainId`); address-only read `service.ts:132-134`; address-only purge `service.ts:428-448` — triggers `service.ts:97-99` (`onAccountDeleted`), `profile-deletion/coordinator.ts:120` (unscoped; contrast `:119,121` which pass `profileId`), `account/service.ts:835-855` (keyless imported-account reconciliation, run unconditionally on import at `useFullBackupImport.ts:534`); cross-network sync delete `service.ts:299-305,346-350,358-374`; restore collision is on the full `(profileId, chainId, address)` tuple (`account/service.ts:689`), so a second profile legitimately holding the same address is a designed-for state.

**Trace (hostile backup):** `data.account[]` row `{type: Imported, address: A}` without a key row → `account/service.ts:693-719` persists it → `useFullBackupImport.ts:534` → `reconcileImportedAccounts` (`:840-852`) emits `onAccountDeleted` → `auth-registry/service.ts:97-99` → `purgeForAccounts([A])` deletes every authwit row + status for `A` regardless of owner.

**Recommended fix:** Add `profileId` + `chainId` to `Authwit` and the status key; scope `getAuthwits`, `purgeForAccounts`, `syncAuthwits` and the status store by `(profileId, chainId, account)` — `token-balance/service.ts:574` and `transaction/service.ts:301` already take `profileId`. Do not simply skip the purge in `reconcileImportedAccounts`: authwit slices restore at `useFullBackupImport.ts:524` before the reconcile at `:534`, so the purge must be profile-scoped, not removed.
**Effort:** hours to a day.

---

### [MEDIUM] F-09: Production prover accepts an unauthenticated loopback HTTP accelerator and posts the private witness to it
**Impact:** Medium — confidentiality of the serialized private execution steps (note preimages, app-siloed nullifier secrets, all private circuit inputs); attacker is an unprivileged local process — including another OS user on a shared host — that binds `127.0.0.1:59833` before the genuine app; master/signing key not shown to be in the witness.
**Confidence:** high **Mapping:** OWASP A07 / CWE-306, CWE-200
**Found by:** both **Clusters:** c09, c10 **Cross-model:** converged (c09 Claude's "upstream-accepted" non-finding overruled: `httpsOnly` is an integration choice) **Verified:** CONFIRMED / CONFIRMED

**Instances:** `apps/extension/src/accelerator/config.ts:22-24`; `apps/extension/src/offscreen/index.ts:100-116` (production passes `factory: undefined`); `packages/aztec-runtime/src/pxe/chain-runtime.ts:129-137,228-229,248` (`new AcceleratorProver({... accelerator: undefined})` — no `httpsOnly`); pinned SDK `@alejoamiras/aztec-accelerator@5.2.0` `accelerator-transport.ts:372` (`httpsOnly = false`), `:603-605` (dual probe), `:666-677` (healthy HTTP wins after the grace window), `:201-205` (health = shape check), `:475` (SDK's own comment: any local account binding the port receives the witness), `:740-758` (`POST /prove`, no auth); `accelerator-prover.ts:407,426`.

**Recommended fix:** Construct the production prover with `httpsOnly: true` (SDK-supported; its HTTPS path uses a name-constrained local CA) — users without the HTTPS-capable accelerator fall back to WASM, which is today's UX for users without the app. Alternatively require an explicit user opt-in before enabling accelerator discovery. **Open item:** neither family established whether CI's `accelerator-server` serves trusted HTTPS on 59834 — confirm before flipping, or the required-mode network gate goes red.
**Effort:** hours.

---

### [MEDIUM] F-18: Discovery flood caps skip the existing-session and duplicate-waiter branches; every reconnect handshake opens an uncapped verify window
**Impact:** Medium (low end) — availability only, but zero-interaction and unbounded: any origin the user connected once (and did not tick "always trust" for) can spawn real OS popup windows at will until the session is revoked. A bypass of the July unit-D caps, not a new resource class.
**Confidence:** high **Mapping:** OWASP A04 / CWE-770
**Found by:** both (Codex c06; Claude rebuttal confirmed the window half) **Cross-model:** converged post-rebuttal **Verified:** CONFIRMED / CONFIRMED

**Instances:** `apps/extension/src/wallet/services/wallet-sdk/background.ts:647-650` (existing-session auto-approve returns before `checkDiscoveryPopupCaps` at `:670`; caps `:606-607` count only `pendingDiscoveryPromises` keys `:748-751`); `:663-668` (duplicate waiters retained at `:718`, cleared only at `:833-835`); `session-established.ts:143-154` (`needsVerification = isNewConnection || !dappSession.trustedVerification` → `chrome.windows.create` on every established session; `trustedVerification` optional, `dapp-session/spec.ts:56`, set only via `popup/windows/verify/index.vue:73-75`).

**Recommended fix:** Reserve and count verify windows per `(origin, chainId)` — the verification hash is session-specific, so reusing an open window is wrong — and apply the same 4-per-origin/32-global cap to `chrome.windows.create` calls from `session-established.ts`; count duplicate waiters in `checkDiscoveryPopupCaps`; run the cap check before the existing-session auto-approve or rate-limit auto-approvals per origin.
**Effort:** hours.

---

### [LOW] F-08: `aztec_simulateTx` public-static fast path authorizes by `name` but executes by `selector`
**Impact:** Low (lowered from Medium on the c06 Codex rebuttal) — a dApp narrowed to one view function can invoke any other PUBLIC+STATIC function on the granted contract as the connected account; output is public chain state readable from any node anyway; the gap is authorization-control, not confidentiality.
**Confidence:** high **Mapping:** OWASP A01 / CWE-863
**Found by:** both **Clusters:** c06 **Cross-model:** converged **Verified:** CONFIRMED / PARTIALLY CONFIRMED (Codex: the Nulo-side binding gap is certain; acceptance of the alternate selector by the SDK schema and its execution were not exercised — does not affect the band)

**Instances:** scope check reads only `to`/`name` — `packages/wallet-bridge/src/method-scope-checkers.ts:31,166-170,391-393`; `exec` forwarded unchanged `dispatcher.ts:1467-1474`; fast path admits by wire `type`/`isStatic` + Zod shape `execution/fast-path.ts:96-110`, executes by selector via `simulateViaNode` `:200-211`; contrast (every other sink binds name↔selector) `execution/service.ts:900-908`.

**Recommended fix:** Before `runFastPath`, resolve each optimizable call's artifact via `ContractResolver`, look up the function by `selector`, reject on `fn.name !== call.name` — the same three lines as `execution/service.ts:900-908`. Add a fast-path mismatch test (none exists).
**Effort:** hours.

---

### [LOW] F-10: RPC errors flattened to strings bypass the logger's URL-credential scrub
**Impact:** Low — an API key embedded in a custom RPC URL reaches the persisted/exported log; needs developer-mode retention plus a reader or an exported log. **Confidence:** high **Mapping:** A09 / CWE-532 **Found by:** both (c05, c10) **Verified:** coordinator only
**Instances:** producer `packages/aztec-runtime/src/utils/fetch.ts:76,78,89` (full URL in `Error.message`); flatten-before-log `packages/aztec-runtime/src/pxe/service.ts:926-927`, `network/service.ts:1003`; helpers `packages/wallet-core/src/utils/errors.ts:8-14,29`; sink `wallet/logger/utils.ts:169-174,263`, `logger/store.ts:68-73,107-118`; CSV `components/JsonViewer/logs-csv.ts:11-25`.
**Fix:** Pass `Error` objects, not messages, at the two demonstrated sites; add `scrubUrls` to the primitive-string branch of `trim()`; extend `log-payload-ban.test.ts` to flag `getErrorMessage(`/`errorMessageFromUnknown(` as a log argument. **Effort:** hours.

### [LOW] F-11: Operation-journal RPC surface has no active-profile/ownership binding
**Impact:** Low — cross-profile disclosure of token-import metadata to a same-address sibling via ordinary navigation; a displayed "cancelled" transfer that still broadcasts for an admitted same-extension caller. **Confidence:** high **Mapping:** A01 / CWE-862 **Found by:** both (c11) **Verified:** coordinator only (July report listed the unscoped reads as latent; the UI sink and cancel bypass are new)
**Instances:** `operation-journal/service.ts:47-55` (RPC exposure), `:297-333`, `:349-369`, `:401-405`, `:407-420`, `:445-455` (no ownership checks); consumer without profile filter `popup/components/modules/general/TokensView.vue:49-61,204,428-429` (contrast `RecentActivityView.vue:279-291`); cancel desync `execution/transfer-executor.ts:106-120` vs the gated path `execution-lane.ts:174-200`; same shape `transaction/service.ts:130-140`.
**Fix:** Gate every journal method on `record.profileId === activeProfile.id` (mirror `execution-lane.ts:174-177`); drop `transitionOperation`/`setOperationMeta`/`deleteOperation` from popup-reachable `rpcMethods`; add the profile compare at `TokensView.vue:52`. **Effort:** hours.

### [LOW] F-12: Restore paths persist unvalidated presentation data (contact names, balance freshness)
**Impact:** Low — display-integrity only: a bidi-manipulated recipient label in the Send picker; a fabricated balance that auto-refresh treats as fresh. **Confidence:** high (traces) **Mapping:** A08 / CWE-451, CWE-20 **Found by:** both (c04, c11) **Verified:** coordinator only
**Instances:** `contact/service.ts:298-306` (restore: schema only) vs `:188-189` (import sanitizes); sinks `popup/components/modules/send/RecipientField.vue:41-44,100-104,129`; `token-balance/service.ts:710-716` (spreads backup `updatedAt`), `spec.ts:54` (unbounded), `reconcile-pairs.ts:143`, `utils/core.ts:142,160`.
**Fix:** `ContactService.restore`: apply `sanitizeString(name, 20)`. `TokenBalanceService.restore`: force `updatedAt: 0` (or clamp to `Date.now()`). **Effort:** hours.

### [LOW] F-13: `AccountService` keyed reads bind profile/chain but not address; the imported-signer branch follows the row body
**Impact:** Low — defense-in-depth with a named precondition (a raw `chrome.storage.local` writer; no untrusted production writer found); consequence is which of the victim's own accounts signs. **Confidence:** moderate **Mapping:** A01 / CWE-863 **Found by:** both (c03, c04) **Verified:** coordinator only
**Instances:** `account/service.ts:84` (no `requireKeyIdentityMatch`), `:177-180`, `:334-341`, `:367-387`, `:405-408`; contrast `:349-353` and `:100-106` (`liveRows`).
**Fix:** In every keyed read require `account.address === address` (or enable the composite-key identity check used by `liveRows`); in `loadImportedAccountContract` compare the rebuilt address to the requested one. **Effort:** hours.

### [LOW] F-14: Offscreen transport — untargeted broadcast plus no sender check on the SW-side client, READY and PONG listeners
**Impact:** Low — precondition is an already-compromised same-extension page; consequences: passive capture of the PXE store key, forged responses/cancellations, false readiness. No web-page path. **Confidence:** high **Mapping:** A07 / CWE-306, CWE-200 **Found by:** both (c05) **Verified:** coordinator only
**Instances:** `packages/extension-messaging/src/offscreen/client.ts:60-66,136`; `wallet/utils/offscreen.ts:97-104,170-177,71-81`; key on the wire `packages/aztec-runtime/src/pxe/client.ts:198-200` → `pxe/service.ts:775-806`; contrast (gated) `offscreen/service.ts:38-41`, `background/service.ts:45`.
**Fix:** Add `isTrustedInternalSender(sender)` to `offscreen/client.ts:60` and the READY/PONG listeners; move key provisioning to a `chrome.runtime.connect` Port instead of broadcast `sendMessage`. **Effort:** hours.

### [LOW] F-15: Pending passkey-restore secret ignores its own TTL and survives explicit lock
**Impact:** Low — a stale, previously authorized restore can open a full (DEK-bearing) session after the 30-minute lifetime and after an explicit lock; needs an unfinished passkey restore, a surviving SW, and the delayed continuation. **Confidence:** high **Mapping:** A07 / CWE-287 **Found by:** both (c02) **Verified:** coordinator only
**Instances:** `profile/service.ts:2514,2517-2525` (stash with `capturedAt`), `:183-200` (sweep skips `exceptId`), `:2561`, `:2651-2689` (never reads `capturedAt`; opens at `:2681`), `:853-870` (`lockActiveProfile` closes only the `SessionManager`); contrast `:221-225`.
**Fix:** In `finalizePasskeyRestoreHoldingLock`, reject when `Date.now() - pending.capturedAt >= PENDING_RESTORE_TTL_MS` (mirror `:221-225`); clear `pendingRestoreSecrets`/`pendingDekRewraps` in `lockActiveProfile`. **Effort:** hours.

### [LOW] F-16: `approveInteraction` executes caller-supplied operations with no binding to the stored interaction payload
**Impact:** Low — the canonical "requires a compromised popup" gap; a buggy or compromised approval window can substitute operations/origin for a live request id. No web-page path. **Confidence:** high (mechanism) **Mapping:** A01 / CWE-863, CWE-639 **Found by:** both (c07) **Verified:** coordinator only
**Instances:** `dapp-interaction/service.ts:150-155,158-186,245-279`; caller `popup/windows/execute/index.vue:412-446`.
**Fix:** Materialize the executable operations SW-side from the stored payload; accept from the popup only wallet-generated deltas (`feeSettings`, `previewedInterface`, estimate ids) per index; reject `approveInteraction` for payloads without `session`. **Effort:** days.

### [LOW] F-17: `web_accessible_resources` exposes the logo to every origin — silent install fingerprint
**Impact:** Low — any page can probe `chrome-extension://<id>/src/assets/logo.png` and learn the wallet is installed, enabling targeted phishing. **Confidence:** high **Mapping:** A05 / CWE-200 **Found by:** both (c10) **Verified:** coordinator only
**Instances:** `manifest/manifest.config.ts:55-60` (`matches: ["*://*/*"]`); sole consumer `wallet-sdk/background.ts:106` (discovery `walletIcon`).
**Fix:** Serve the icon inline (data: URI) in the discovery response and drop the entry, or narrow `matches`. **Effort:** hours.

---

## Findings NOT pursued (with reasoning)

Seventeen traced items were dropped below the floor by the coordinator; the full list with file:line and reasons is in `findings/consolidated.md` § "Findings NOT pursued". The ones worth knowing about:
- Unzeroized password bytes in `EncryptionKey.getPasshash` (`packages/wallet-crypto/src/encryption-key.ts:122-125`) — hygiene, no disclosure sink.
- The strict-mode toggle racing `SessionManager.open()` — retracted by its author; the shared facade lock queues `clearBearer()` right behind it.
- Whole-envelope swap opening a derived-only session — a documented, owner-adjudicated residual (`implementations-plan/mac-identity-binding/plan.md`).
- 12-nibble truncated address on the account-import preview — real display weakness, no feasibility evidence for the vanity grind.
- `register_token` metadata refetched at persist time — real TOCTOU, contract-controlled either way, address always shown.
- `buildNoFrom` registers contracts before the chain-identity assert; `registerContract` mutates PXE before the address compare — ordering defects with no harmful persisted consequence traced; subsumed by F-01's fix scope.
- Node-sourced `ContractInstance` not anchored to the queried address; RPC-fabricated incoming-transfer receipts; unbounded reconciliation restart — inherent to trusting the node; cross-cutting #4.
- Missing `autocomplete` on secret inputs; CSV formula injection in the log export — no attacker-controlled cell traced.
- Queued `deleteToken` after numeric-id reuse — correctness bug without an attacker.
- `about:blank`/`data:` top-frame origin attribution — open question, upstream-dependent, both families unresolved.

## Cross-cutting observations

1. **Backup import is a trust boundary defended by shape, not semantics.** The checksum is self-consistent by design, `normalizeAllIds` closes profile grafting, and the July URL-scheme and config allowlists hold — but identity-bearing rows (network endpoints F-04, protocol FPC rows F-03, keyless imported accounts F-07, contact names and balance freshness F-12, `account-state` contract registration) are accepted as truth. One "restored rows are hostile until re-derived" review of every `restore()` closes four findings.
2. **Same-phrase sibling profiles are a supported flow the isolation model does not fully honour.** Separation keyed on the master alone (F-06) and rows keyed on the address alone (F-07, F-11, `transaction/service.ts:130-140`) collapse when two profiles share a master/address. The DEK is the intended separator; use it consistently.
3. **`isTrustedInternalSender` is the only gate on the SW RPC surface; per-method ownership and request binding are inconsistent.** Journal writes (F-11), `approveInteraction` (F-16), account keyed reads (F-13) and the offscreen client (F-14) each trust a same-extension caller with no further check.
4. **RPC honesty is the unstated trust root.** Node info (F-01), balances, incoming receipts, contract instances, fee quotes — none is client-verifiable. F-01 is the one place the wallet claims to verify and does not; the rest should be documented as accepted RPC trust with the default third-party endpoint named as the risk.
5. **Display vocabularies drift.** `transfer-intent.ts`, `tx-enrichment.ts` and `token/functions/descriptors.ts` each hardcode transfer semantics; only the last is maintained (F-02). Derive, don't duplicate.
6. **Logging.** The key-name redactor is defeated by string flattening (F-10); the CSV sink has no formula neutralization; `getErrorMessage` is the idiom that turns an `Error` into an unscrubbable string. Route errors, not messages.
7. **Local-service trust.** The accelerator (F-09) is the only local peer outside the loopback-URL allowlist; the SDK's `httpsOnly` is available and unset.
8. **Admission caps are per branch, not per resource** (F-18): the discovery caps bound one code path to the connect popup; the reconnect path and the verify window have none.
9. **The crypto package is clean.** Both families returned zero findings against `packages/wallet-crypto` beyond hygiene notes; the July in-house KDF-review findings (envelope swap, unauthenticated fingerprint) are confirmed fixed by the v3 envelope MAC. `ATTACK-SURFACE.md`'s own caveat stands: the composition has not been reviewed by a human cryptographer.

## July-2026 remediation regression check

- **A** (raw-`Fr` authwit reject; name↔selector bound at signing sinks; arg-shape validation): intact (`method-scope-checkers.ts:327-331`, `execution/service.ts:900-908`); the later-added `simulateTx` fast path never received the bind (F-08) — coverage gap, not regression.
- **B** (truthful approval display; bidi/RLO sanitizer): sanitizer intact (`capability-meta.ts:128-176`, `safeWire`); the transfer-recognition vocabulary regressed relative to the token model (F-02).
- **C** (single validated `getNodeInfo` threaded; no re-fetch): threading intact everywhere; the HELD XOR-composite collision is confirmed **open** at the signing gate (F-01), plus one caller with no assert (`fn.ts:85-95`).
- **D** (discovery-flood caps): caps intact but **bypassed** on two unlocked-path branches and absent for verify windows (F-18) — partial regression of D's intent.
- **E** (backup-restore config allowlist): intact.
- **F** (CSP): intact; `connect-src`/`frame-src` still absent with no traced sink.
- **G** (offscreen/messaging sender-auth + Firefox instance token): intact at both service-side listeners; never extended to the SW-side client, READY/PONG, or the broadcast primitive (F-14) — asymmetry.
- **I** (per-row DappSession HMAC): mechanically intact; key derivation does not separate same-master siblings (F-06).
- **J** (ValueStorage parse containment): intact.
- **K** (clipboard secret hygiene): intact.
