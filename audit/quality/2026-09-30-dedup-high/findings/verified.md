# Verified findings: harden quality, effort high, 2026-09-30

Run: `audit/quality/2026-09-30-dedup-high`. Tree: `dev` at `910a4def`. Inputs: `findings/consolidated.md` (27 findings) and three independent verifications of the top 10 (`verify-claude-A.md` for Q-01 to Q-05, `verify-claude-B.md` for Q-06 to Q-10, `verify-codex.md` for all ten). Every point where the two families disagreed was re-opened in source by the writer; the call and its evidence are recorded under each finding.

Bug cross-references use the bugs run's own ids from `audit/bugs/2026-09-30-ext-high/findings/consolidated.md` (B-NN, D-NN) and its addendum. The quality consolidation's incidental list also numbered its leads `B-01`…`B-39`; the bugs addendum renames those `QB-NN`, and this file follows that convention.

## Verdict summary

| ID | Final verdict | Final priority | Claude verifier | Codex verifier | Confidence | Drift already present | Bug it explains |
|---|---|---|---|---|---|---|---|
| Q-01 | Confirmed with corrections | High (18) | confirmed | confirmed | high | stale "mirror" comments; session-address sets already differ | none (routed to security) |
| Q-02 | Confirmed with corrections | High (18) | confirmed | confirmed | high (a, b), moderate (c) | none accidental | none |
| Q-03 | Confirmed with corrections; part (e) dropped | High (18) | partially confirmed | confirmed | high (a, c, d), moderate (b) | `patchAccountField` identity gate | B-12, bugs security routing #1 |
| Q-04 | Confirmed with corrections | High (18) | confirmed | confirmed | high | `getNodeStatus` local-kind carve-out; userinfo rule schema-only | B-09 |
| Q-05 | Confirmed with corrections | High (18) | confirmed | confirmed | high; moderate for the probe-fold hoist | reuse ladders' fee-fetch error policy | B-08 |
| Q-06 | Confirmed with corrections, one new drift added | High (18) | confirmed | partially confirmed | high | incoming profile guard; **journal network scoping (new)**; empty-amount gate | bugs D-14 (dropped as hardening); journal-network drift is a new lead |
| Q-07 | Partially confirmed; part (d) narrowed | High (18) | partially confirmed | partially confirmed | high (a–c), moderate (d) | unguarded window close in json/logger | adjacent to B-07 |
| Q-08 | Confirmed with corrections | High (18) | confirmed | confirmed | high | `autocomplete="new-password"` missing on 2 of 4 pairs; 0.3s/0.4s shake | none |
| Q-09 | Confirmed with corrections | High (18) | confirmed | partially confirmed | high | duplicate-add handling; untrimmed contact-name check | none (new minor lead) |
| Q-10 | Confirmed | Medium (12) | confirmed | confirmed | high | none accidental | none |

No top-10 finding is low confidence, so none is relabelled "Potential …". Totals are unchanged from consolidation: **9 High, 16 Medium, 2 Low** (27 findings; Q-27 bundles 14 small items).

---

## Q-01: Chain identity derived per layer (composite chain id, `ChainInfo`, SDK chain info, NO_FROM sender)

- **Final verdict:** Confirmed with corrections. **Priority:** High (structural 3 × blast 3 × frequency 2 = 18). **Confidence:** high. **Effort:** about 1 day.
- **Corrected instances:**
  - (a) Formula `(l1ChainId ^ rollupVersion) >>> 0`. The owner is `apps/extension/src/utils/chain-ids.ts:12-14` (`walletChainId`). Copies:
    - `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:101`
    - `packages/aztec-runtime/src/utils/chain-identity.ts:59`, inside `assertLiveChainIdentity`
    - `apps/extension/src/wallet/services/network/service.ts:1010`. Correction: `:24` imports constants from `@/utils/chain-ids` and uses them; it just does not import `walletChainId`.
    - `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:16-21` (`chainInfoToChainId`, used by `background.ts:641, 752, 1189`)
    - `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:45-56`, a private copy used at `:128`
    - **Added (Claude A, writer confirmed):** `apps/extension/scripts/seed-preflight.ts:22`, a dev script. Low priority, but it belongs to the same rule.
  - (b) Ten hand-written `ChainInfo` literals instead of `chainInfoFrom` (`packages/aztec-runtime/src/utils/chain-identity.ts:73-75`), all under `apps/extension/src/wallet/services/execution/`: `authwit-discoverer.ts:119, 174-175, 225-226, 239-240`; `discovery-probe.ts:79`; `dapp-send-executor.ts:1005`; `view-executor.ts:213`; `fast-path.ts:228-229`; `service.ts:1021-1022`; `helpers/batched-view-simulation.ts:363-364` (the same file uses `chainInfoFrom` at `:204`). Line numbers were off by 1–3 in consolidation.
  - (c) NO_FROM normalization: `packages/wallet-bridge/src/dispatcher.ts:185-193`, `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:84-89`, `apps/extension/src/wallet/services/execution/utils/fee-detection.ts:18-20`. The three session-address sets (`dispatcher.ts:439` raw plus CAIP, `:1730` chain-filtered, `queued-journal.ts:143` unfiltered) have different contracts and stay distinct.
- **Drift evidence:** no behavioural drift in the formula or the sender rule. The copies are held equal by comments, and two of those comments are already wrong:
  - `queued-journal.ts:45` says it mirrors `background.ts`, but the function moved to `session-established.ts`.
  - `authwit-discoverer.ts:116-117` says `assertLiveChainIdentity` "is a noop for local (chainId=0)". It is not: the L1 and rollup-version checks at `chain-identity.ts:47-57` run before the local return at `:58` (Codex, writer confirmed).
- **Refined fix:**
  - Move `walletChainId` into `packages/aztec-runtime/src/utils/chain-identity.ts` and re-export it from `apps/extension/src/utils/chain-ids.ts`. Add `chainIdFromSdkChainInfo` (the `Fr`/string decoder) beside it.
  - Replace the ten literals with `chainInfoFrom(nodeInfo)`. Add `liveChainInfo(node, network)` (fetch, assert, project) only for the five fetch-and-assert sites.
  - Move `NO_FROM` and `requestedSenderOf` into the existing `packages/wallet-bridge/src/account-resolution.ts`, beside `resolveAuthorizedSessionAccount`.
  - Fix the two stale comments in the same PR.
- **Disagreement record:**
  - *Home for `walletChainId`.* Claude A: aztec-runtime `chain-identity.ts`. Codex: `wallet-core/utils`, with only the `Fr` decoder in aztec-runtime.
  - **Writer's call: aztec-runtime.** Nothing below aztec-runtime computes the composite: `git grep ">>> 0"` in wallet-bridge and wallet-core finds only a test. `assertLiveChainIdentity` already contains the formula, so one module then owns the whole chain-identity rule. Move it lower only when a lower package needs it.
  - *Effort.* Claude 1 day, Codex 1–2 days. Called at about 1 day, because every step is a mechanical substitution.

## Q-02: Execution entry points each re-implement security guards

- **Final verdict:** Confirmed with corrections. **Priority:** High (18). **Confidence:** high for (a, b), moderate for (c). **Effort:** 1–2 days.
- **Corrected instances** (under `apps/extension/src/wallet/services/execution/`):
  - (a) Authwit effect decode loop: `authwit-discoverer.ts:110-141`, `discovery-probe.ts:66-101`, `dapp-send-executor.ts:1000-1019`.
  - (b) Selector/name binding guard, six sites: `tx-request-builder.ts:340-348, 587-599`, `authwit-discoverer.ts:197-205`, `service.ts:1043-1051`, `view-executor.ts:367-373`, `fast-path.ts:135-140`.
  - (c) Class-id integrity check: `service.ts:834-837, 981-984`. **A third implementation already exists:** `packages/aztec-runtime/src/pxe/artifact-class-id.ts:52` (`verifyArtifactClassId`, which returns `undefined` rather than throwing). Codex found it; the writer confirmed it. The instance-to-artifact hops (`fast-path.ts:129-130`, `view-executor.ts:93-94, 365-366`) are lookup sequences, not integrity checks (Codex).
- **Drift evidence:** none accidental. These differences are documented and must be preserved:
  - The fast path requires a name (`fast-path.ts:138`); the others allow an absent one.
  - The probe dedupes by message hash (`discovery-probe.ts:89`).
  - The error text differs per site ("authwit call name" against "call name"). `contract-resolver.ts:55-58` says callers own their frozen error text.
- **Refined fix:**
  - A synchronous `assertSelectorBinding(fn, { name, to, label, requireName })` in `execution/contract-resolver.ts`, beside `findFunctionBySelector`. The message label is a parameter.
  - `decode-authwit-effects.ts` next to `discovered-authwit.ts`, returning ordered `{ record, messageHash }` pairs and taking the crypto seam. Dedupe stays in the probe.
  - For (c), add a throwing `assertArtifactClassId` beside `verifyArtifactClassId` in aztec-runtime, sharing its computation, and call it from both `service.ts` sites.
  - Tests that pin exact error strings must pass unchanged.
- **Disagreement record:** confidence on (c). Claude A rated it moderate ("two lines, low value"). Codex raised it by finding the third copy. **Writer's call:** keep (c) moderate as a standalone item. Include it because a single class-id rule in aztec-runtime is the correct owner, not because of the line count.

## Q-03: Row-service lifecycle protocols composed by hand per service

- **Final verdict:** Confirmed with corrections. Part (e) is dropped, and part (b) is narrowed. **Priority:** High (18). **Confidence:** high for (a, c, d), moderate for (b). **Effort:** 2–3 days in total; the high-value subset (a, c, d) is about 1–1.5 days.
- **Corrected instances** (under `apps/extension/src/wallet/services/`):
  - (a) Fenced commit, 7 sites in 6 files: `fpc/service.ts:230-238, 293-302`; `contact/service.ts:116-123`; `dapp-session/service.ts:203-210`; `network/service.ts:325-330, 493-499`; `token/service.ts:412-422`. The token network-authority leg stays local. `operation-journal/service.ts:281` is check-only and not an instance.
  - (b) Purge pipelines: the three `auth-registry/service.ts` methods (`:505-573`) already call `purgeRows`/`purgeMalformedRows` and differ only in their predicates. The `token-balance/service.ts` pair (`:546-561`, `:574-601`) uses a different mechanism (`invalidateAndDelete`, emit-if-live, `repo.purgeMalformed`) and is **not** the same pipeline. Scope-key templates: `auth-registry/service.ts:515, 518, 533, 536` and `token-balance/service.ts:577, 581, 598`. **Correction:** the inline scope tuple types are at `token-balance/service.ts:574` and `auth-registry/service.ts:512`. The cited `:147` and `:107` are subscriber registrations (both verifiers).
  - (c) Restore preamble: `token-balance/service.ts:676-685`, `auth-registry/service.ts:589-597`, `transaction/service.ts:529-538`. Hostile-row casts: `contact/service.ts:287-290`, `account/service.ts:674-677, 766-769`, `token/service.ts:858-861`. `config/service.ts:62-84` skips non-allowlisted keys without a result row, so it becomes filter-then-`restoreRows`. That is low value.
  - (d) Row identity gate: `account/service.ts:180, 339-341, 408-411`; `account/imported-keys-repository.ts:28-30`. **Drifted:** `account/service.ts:322`.
  - (e) Raw marker stores: **dropped.** Both verifiers found the three instances do not substantiate a shared abstraction.
- **Drift evidence (the strongest argument for this refactor):**
  - `patchAccountField` (`account/service.ts:322`) checks profileId and chainId but not address. The updater then writes using the row-carried address (`:327`). The other four gates check all three. The bugs run routed this as security item #1.
  - The same writer is also **B-12(b)**: it writes a row back after a chain purge because it sits outside the fence and row lock.
  - **B-12(a)** (`importAccount` has no deletion fence) is the fenced-commit protocol (a) missing on a sibling writer. `createAccountInternal` has it; `importAccount` does not.
  - A shared `fencedSet` and `rowMatchesKey` would have made both omissions visible at review.
- **Refined fix:**
  - `rowMatchesKey(row, profileId, chainId, address)` in `account/spec.ts`, beside `accountRowId`/`accountRowIdOf`, used by all five sites. This fixes the drift.
  - `requireRestoreProfileId()` in the existing `restore-fence.ts`.
  - `fencedSet` beside `purge-rows.ts`, starting with the two fpc sites. Locks, network checks and event timing stay explicit at the call site.
  - `AccountScope` plus `accountScopeKey()` in the account contract.
  - A private `purgeMatchingLocked` inside auth-registry only; token-balance is not forced onto it.
- **Disagreement record:**
  - *Verdict and confidence.* Claude A: "partially confirmed", moderate, arguing five bundled smells and weaker (b). Codex: "confirmed", high, 2–4 days.
  - **Writer's call:** confirmed with corrections. The root cause (a composed protocol re-typed per service around single-step helpers) is shared by (a) through (d). Claude A's narrowing of (b) and both verifiers' drop of (e) are adopted. Confidence is split per part rather than averaged.

## Q-04: Network endpoint rules re-derived outside the network module

- **Final verdict:** Confirmed with corrections. **Priority:** High (18). **Confidence:** high. **Effort:** 1–2 days.
- **Corrected instances:** the 15 primary-endpoint lookups in consolidation all hold:
  - `network/service.ts:348, 423, 581, 731, 747, 769, 846`
  - `network/spec.ts:93, 107`
  - `transfer-executor.ts:377`, `dapp-send-executor.ts:470`, `operation-estimate-reuse.ts:141`, `transfer-estimate-reuse.ts:181`
  - `incoming-transfer/service.ts:536`
  - `EditNetworkPopup.vue:58`

  `getNetworkInfo` (`network/service.ts:844-851`) duplicates `networkInfoFrom` (`spec.ts:92-96`). The other parts hold: status methods `:728-742` and `:744-760`; identity guard `:603-615` and `:650-661`; transport allowlist `network/spec.ts:151-178` against `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58-73`; popup error ladders `NewEndpointPopup.vue:54-63` and `EditEndpointPopup.vue:69-78`.
- **Drift evidence (a live bug):**
  - `getNodeStatus` calls `_getChainId(primary.rpcUrl)` without the kind hint (`:734`); `probeNodeStatus` passes it (`:753`). This is **B-09** in the bugs run: an edited Local Network endpoint reads `InvalidChain`, and its contracts and senders are left out of full backups (`account-state/service.ts:221`).
  - The userinfo rejection lives only in the schema (`spec.ts:166`). The adapter accepts `https://user:pass@host`. Both verifiers read this as a policy difference; aligning it needs owner sign-off.
- **Refined fix:**
  - `findPrimaryEndpoint(network)` in `network/spec.ts`; derive the existing `primaryEndpointUrl` and `networkInfoFrom` from it. Callers keep their missing-primary policy.
  - `getNetworkInfo` returns `networkInfoFrom(...)`.
  - A private `statusFor(network, probe)` so both status paths pass `network.kind`. This fixes B-09.
  - `assertSameChainIdentity(probed, network)`, keeping the lock boundaries.
  - A pure `isAllowedRpcTransport(url)` in `packages/wallet-core/src/utils/`, called by `RpcUrlSchema` and by the adapter's `isAllowedRpcUrl`.
  - A popup-local `endpointErrorMessage`.
  - Delete the "Codex Round 2 B-3" tag at `spec.ts:~172`.
- **Disagreement record:**
  - *Home for the transport predicate.* Claude A: have `RpcUrlSchema` call aztec-runtime's existing `isAllowedRpcUrl`, "already exported". Codex: a leaf in `wallet-core/utils`.
  - **Writer's call: Codex.** `isAllowedRpcUrl` is not exported through the package's `./adapters` entry, whose `index.ts` exports only the class. Its module imports `createAztecNodeClient`. And `network/spec.ts` is imported by popup code. A wallet-core leaf keeps the node client out of the UI's import graph and is legal for both callers.

## Q-05: Fee-estimation pipeline: strategy stages, fee composition and reuse validation copied

- **Final verdict:** Confirmed with corrections. **Priority:** High (18). **Confidence:** high; moderate for the probe-fold hoist. **Effort:** 2–3 days.
- **Corrected instances** (under `apps/extension/src/wallet/services/execution/`):
  - Task wrapper ×5: `fee/fee-juice-strategy.ts:25-74`; **`fee/fee-juice-with-claim-strategy.ts:25-48`** (consolidation's `:79-102` does not exist, as the file has 50 lines; both verifiers); `fee/embedded-strategy.ts:32-51`; `fee/fpc-strategy.ts:136-201, 207-306`.
  - Folded probe ×3: `fee-juice-strategy.ts:33-58`, `fpc-strategy.ts:153-176, 221-258`. The rebuild predicates differ on purpose (`:164` against `:237`).
  - FPC finalize tail ×2: `fpc-strategy.ts:177-200, 283-302`.
  - Validated re-simulation option literal: **6 copies**, at `fee-juice-strategy.ts:54`, `fee-juice-with-claim-strategy.ts:39`, `embedded-strategy.ts:42` and `fpc-strategy.ts:172, 254, 280`.
    - `fee/fee-strategy.ts:170` is **the owner**, the else-branch of `probedFirstSimOpts`, not a copy. The writer verified `probedFirstSimOpts(undefined, built)` returns exactly this literal.
    - `dapp-send-executor.ts:895` (Claude A's "8th") uses `scopesWithAccount` and is a variant, not a copy.
  - Fee composition ×5: `fee-strategy.ts:286-290`, `fpc-strategy.ts:177, 261`, `operation-estimate-reuse.ts:160-161`, `transfer-estimate-reuse.ts:195-202`.
  - Priority-to-multiplier ternary ×3: `service.ts:1103`, `operation-estimate-reuse.ts:160`, `transfer-estimate-reuse.ts:198-200`. Consolidation filed `:1103` under "default multiplier". Default `?? DEFAULT_FEE_MULTIPLIER` appears at `fpc-strategy.ts:135, 206` and `fee-strategy.ts:272`.
  - Reuse: producers `transfer-executor.ts:343-430` and `dapp-send-executor.ts:440-520`; validators `transfer-estimate-reuse.ts:148-216` and `operation-estimate-reuse.ts:108-175`; `fingerprintBaseFee` in the wrong home at `transfer-estimate-reuse.ts:44`; live-handle re-resolution at `transfer-executor.ts:298-316` and `dapp-send-executor.ts:796-819`.
- **Drift evidence (a live bug):**
  - The operation ladder runs `getNode` and `predictedWorstMinFees` outside any `try` (`operation-estimate-reuse.ts:159-162`), so a transient fee-read error aborts a send whose entry was already consumed. The transfer ladder catches the same call and rejects softly (`transfer-estimate-reuse.ts:205-208`). This is **B-08**.
  - Also: only the transfer ladder re-wraps `GasFees`, and the ladders have a different number of primary-endpoint rejection reasons.
  - A fee-basis mismatch between builder and ladder fails silently, as permanent "base fee drift" rejections.
- **Refined fix:**
  - Order the work by risk, running `fee/fee-structural-parity.test.ts` and `fee/strategies-structural.test.ts` at each step:
    1. Export the else-branch of `probedFirstSimOpts` as `validatedSimOpts(built)`, and have `probedFirstSimOpts` and the six sites call it.
    2. `resolveFeeMultiplier(priority?)` and `committedMaxFees(node, multiplier)` beside `predictedWorstMinFees` in `packages/aztec-runtime/src/fee-juice.ts`.
    3. Move `fingerprintBaseFee` into the existing `estimate-reuse-shared.ts`.
    4. `withEstimateTask`.
    5. The probe-fold hoist, last.
  - `commitFpcEstimate` stays private to `FpcStrategy`.
  - Each ladder keeps its own step order. B-08's fix (catch and reject) is a separate bug PR.
- **Disagreement record:**
  - *New helper or existing.* Claude A proposed a new `validatedSimOpts`; Codex said reuse `probedFirstSimOpts(undefined, built)`.
  - **Writer's call:** both. Name the existing branch `validatedSimOpts` so call sites do not pass a bare `undefined`, and route `probedFirstSimOpts` through it. That adds no new logic, only a name.
  - The instance count is settled at 6 copies plus the owner, not 7 or 8.

## Q-06: Activity feed: Home and History duplicate row scoping and card presentation

- **Final verdict:** Confirmed with corrections, plus one new drift. **Priority:** High (18). **Confidence:** high. **Effort:** 1–2 days (row scoping and route helper about 3 hours; card fields about 3 hours; CSS with screenshot about 2 hours).
- **Corrected instances** (under `apps/extension/src/`):
  - (a) `utils/activity-rows.ts:79-88` against `popup/components/modules/general/recent-activity-rows.ts:54-64` (bodies identical). `activity-rows.ts:104-121` against `recent-activity-rows.ts:66-82`: the sort-key expression is identical, but **the comments are not** (Codex; writer confirmed). Inline copies of `isForeignProfile` are at `TokensView.vue:66` and `RecentActivityView.vue:270`; these use truthiness, unlike the helper's explicit `undefined` checks.
  - (b) `RecentActivityView.vue:337-395` (six `cardXFor`) against `utils/journal-state.ts:358-420`. The orphan computeds `:156-194` read `executingTask`, a different record.
  - (c) Dispatch ladders: `RecentActivityView.vue:852-865` and `popup/components/modules/activity/TransactionsList.vue:62-75`. **Removed:** `RecentActivityView.vue:240-242, 394-403` and `TransactionsList.vue:44-51`. They already delegate to `buildIncomingCardProps`/`buildJournalTerminalCardProps` (Codex; writer confirmed).
  - (d) CSS: `.title_sep` is byte-identical in `TransactionAwaitingCard.vue:130-152`, `TransactionTerminalCard.vue:84-105`, `TransactionIncomingCard.vue:77-95` and `TransactionCard.vue:198-215`. `.chip` is identical ×3; the incoming card's green chip is a deliberate variant.
- **Drift evidence:**
  1. **Journal network scoping (new; Claude B, writer confirmed).**
     - Home drops journal ops from another network (`RecentActivityView.vue:264-278`, `op.networkId !== appStore.network.id`).
     - History fetches terminal journal ops by profile only (`popup/pages/activity.vue:78`), and `journalRows` (`utils/activity-rows.ts:91-102`) filters on account and profile but ignores the `networkId` it is given.
     - An account present on two networks therefore shows network A's cancelled or failed operations in History while network B is selected.
     - This is not in the bugs run. It is a realistic Minor display lead.
  2. Incoming profile guard: only Home applies `isForeignProfile` to incoming rows (`recent-activity-rows.ts:73`). The bugs run dropped this as consistency hardening (D-14), because the service already scopes by profile.
  3. Empty-amount gate: `cardAmountFor` passes `""` through to the formatter, which renders `0` (`utils/amount.ts:103`). `transferCardFields` suppresses it (`journal-state.ts:380`).
- **Refined fix:**
  - Export `txInScope`, `incomingInScope` (with the profile guard) and `incomingSortKey` from `utils/activity-rows.ts`. Give `journalRows` the `networkId` rule; that is a user-visible behaviour fix and belongs in the PR description. Replace the two inline profile predicates with `isForeignProfile`.
  - `buildJournalCardFields(op, ctx)` in `journal-state.ts` with an explicit amount and symbol policy.
  - A pure `activityRowRoute(row)`. An optional shared row component belongs at **L4** in `popup/components/modules/activity/`, because it renders the service-bound `TransactionCard`.
  - Shared chip CSS via `composes`, keeping the green variant. Take screenshots per the owner UI rule.
- **Disagreement record:**
  - *Verdict.* Claude B: confirmed. Codex: partially confirmed, removing the delegated sites and the "identical comment" claim.
  - **Writer's call:** confirmed, with Codex's removals applied. The row, card and dispatch duplication and the drift remain, and Claude B's journal-network drift strengthens the finding.
  - *Fix shape.* A route helper versus an `ActivityRow` component: both verifiers accept the pure route helper first, with any component at L4.

## Q-07: dApp approval windows: the verify window re-implements the hostname check and window lifecycle the hook owns

- **Final verdict:** Partially confirmed, with (d) narrowed. Title reworded: verify **re-implements** the check rather than "bypasses" it, because the two copies agree today. **Priority:** High (18). **Confidence:** high for (a–c), moderate for (d). **Effort:** about 0.5 day.
- **Corrected instances** (under `apps/extension/src/`):
  - (a) `popup/windows/verify/index.vue:52-67` against `composables/useDappHostname.ts:8-27`. They are identical today.
  - (b) Window close ×4: `verify/index.vue:77-83`, `popup/windows/json/index.vue:16-21`, `popup/windows/logger/index.vue:12-17`, `composables/useDappApprovalWindow.ts:88-92`.
  - (c) Session wait: `verify/index.vue:118-133` against `useDappApprovalWindow.ts:102-115`.
  - (d) The `getRequestId` lambdas are at `discover:49`, `capabilities:117` and `execute:130` (consolidation was off by 2). The init catches are at `discover:88-90`, `capabilities:177-179` and `execute:263-265`, not `~290`. The approve-catch cancelled branch is identical in discover and capabilities, but execute's else-branch shows "Processing error." with details. The reject handlers differ materially and are not instances.
- **Drift evidence:**
  - `json` and `logger` call `remove(window.id)` with no id guard; `verify` and the hook guard it.
  - The hostname copy has not drifted. The risk is one-sided: a hardening edit to the composable (confusables, mixed script) would skip the trust-confirmation screen.
- **Refined fix:**
  - `useDappHostname(dapp)` in verify, with local aliases. This is the security-relevant change, under 30 minutes.
  - `closeCurrentWindow()` (guarded) in `utils/`.
  - `whenSessionChecked(getter)` as a C0 helper taking a reactive getter.
  - Export only the cancellation test (`isApprovalCancelled(err)`) from `useDappApprovalWindow`. Each window keeps its own else-branch copy; whether execute's different title is drift is an owner question.
  - Leave the `getRequestId` lambdas.
- **Disagreement record:**
  - *`getRequestId` default.* Claude B: make it a default in `useDappInteractionPayload`. Codex: keep that composable router-independent.
  - **Writer's call: Codex.** `useDappInteractionPayload.ts` imports only `vue` and types today. Adding a router dependency to remove three one-line lambdas is a net loss.
  - *Failure classification.* Claude B: skip unless the owner calls the title difference drift. Codex: share only the cancellation classification.
  - **Writer's call:** share the one-line cancellation predicate only. Both positions accept that, and it changes no copy.

## Q-08: Credential inputs: visibility toggle ×8, new-password pair ×4, shake keyframes ×7 (+1 variant)

- **Final verdict:** Confirmed with corrections. **Priority:** High (18). **Confidence:** high. **Effort:** about 1 day.
- **Corrected instances:** all consolidation sites hold.
  - The toggle's 8 sites in 5 files and its CSS in the same 5.
  - The pairs at `ImportSecretForm.vue:66-108`, `ImportFullBackupForm.vue:130-173`, `NewProfileCredentials.vue:18-59` and `change-password.vue:158-202`.
  - `@keyframes shakeInput`, byte-identical ×7, with `NewSenderPopup.vue:175-191` a distinct 0.5s variant.
  - A related but different pair at `onboarding/pages/create.vue:146` (Codex) is not an instance.
- **Drift evidence (both verifiers, writer confirmed):**
  - `autocomplete="new-password"` is set on both new-password fields in `ImportSecretForm.vue:76, 106` and `change-password.vue:168, 200`.
  - It is **absent** in `ImportFullBackupForm.vue` and `NewProfileCredentials.vue`, so browsers may autofill a saved password into a new-password field on those two screens.
  - Shake duration is 0.3s in four files and 0.4s in three, with no stated reason.
- **Refined fix:**
  - L3 `components/composite/PasswordVisibilityToggle.vue` with `v-model:visible`, and `tabindex="-1"` hard-coded inside it. That makes the owner-accepted WCAG trade-off one line.
  - Then `NewPasswordFields.vue`, applying `autocomplete="new-password"` to both fields. That is a behaviour fix; call it out in the PR. Reuse `Input`, `newPasswordHint` and `isNewPasswordValid` from `utils/password.ts`.
  - Put `.shake` and its keyframes in an **extension-local CSS module** consumed via `composes`, next to `components/composite/import/import-shared.module.css`.
  - Unifying the duration and adding `prefers-reduced-motion` are visible changes and need owner sign-off.
- **Disagreement record:**
  - *Where the keyframes live.* Consolidation said `@nulo/design` `base.css`. Codex: share through `@nulo/design`. Claude B: not `base.css`.
  - **Writer's call: Claude B.** All seven sites are `<style module>` blocks, where `animation: shakeInput` is localized, so a global keyframe in `base.css` would not be matched without `:global`. `base.css` is also sha256-pinned by `packages/design/src/base.css.test.ts:22` and ships to the landing. An extension CSS module is the smaller, correct home.

## Q-09: Keyed list reducers hand-rolled beside `useEntityCrud`; contact rules re-encoded

- **Final verdict:** Confirmed with corrections. **Priority:** High (18). **Confidence:** high. **Effort:** about 1 day for `entity-list.ts` and the four contact copies; the others follow separately.
- **Corrected instances:**
  - All nine active consumers hold.
  - `SelectFpcPopup.vue:81` is dead (Q-26).
  - The `ImportContactsPopup.vue` handlers feed nothing, because its maps are built once in the `props.show` watcher (`:94-117`) (Claude B).
  - Codex's grep found further reducer kernels (`Header.vue:101, 106`; `useIncomingTransfers.ts:123, 128`; `RecentActivityView.vue:544-643`; `TokensView.vue:193-232`; `BalanceView.vue:235`; `pages/activity.vue:82-91`; `stores/app.store.ts:308`). These are follow-ups, not part of this finding's first PR.
- **Drift evidence:**
  - *Duplicate adds.* `useEntityCrud.ts:111` treats a repeated add as an update. `NewContactPopup.vue:36`, `EditContactPopup.vue`, `ImportContactsPopup.vue` and `send.vue:196` push unconditionally. `SelectProfilePopup.vue:77` upserts, and `SelectTokenPopup.vue:79` ignores duplicates.
  - *Unknown updates.* The composable appends them (`:127`); `NewFpcPopup.vue:94` and `SelectTokenPopup.vue:84` ignore them.
  - *Contact name uniqueness (Claude B; writer confirmed).* `NewContactPopup.vue:58` and `EditContactPopup.vue:75` compare the untrimmed input (`c.name === v`), but save `nameTerm.value.trim()` (`:111`, `:142, 151`). `ContactService.addContact` enforces no uniqueness. "Alice" followed by a trailing space passes the check and is saved as a second "Alice". Both copies carry the same bug, which a single `findConflictingContact` fixes once.
- **Refined fix:**
  - `apps/extension/src/utils/entity-list.ts` (`upsertById`, `replaceById`, `removeById`, pure), used inside `useEntityCrud.ts:104-140` and by the consumers, with explicit append, upsert and replace-only policies. `useEntityCrud` is not adopted wholesale, because its `dispose()` is permanent.
  - `findConflictingContact(contacts, { name, address }, excludeId)`, which trims the name, and `canonicalContactAddress()` in `utils/`. It returns a typed result instead of `"Already exist"`. The import popup keeps its two-key rule.
- **Disagreement record:**
  - *Verdict.* Claude B: confirmed. Codex: partially confirmed, because consolidation's "the copies append unconditionally" is false for SelectProfile and SelectToken.
  - **Writer's call:** confirmed, with Codex's correction applied to the drift statement.
  - *Effort.* Claude B about 1 day, Codex 1–2 days. Called at about 1 day for the scoped first PR.

## Q-10: Transaction recording: 12-positional `addTransaction` plus duplicated dApp-send tails

- **Final verdict:** Confirmed. **Priority:** Medium (local 2 × blast 2 × frequency 3 = 12). **Confidence:** high. **Effort:** about 1 day.
- **Corrected instances** (under `apps/extension/src/wallet/services/`):
  - Declaration: `transaction/service.ts:155-170`.
  - Producers: `execution/transfer-executor.ts:182-214`, `execution/dapp-send-executor.ts:528-541, 919-932`.
  - Index projections: `dapp-send-executor.ts:125-138`.
  - **Added (Codex):** forwarding adapters at `execution/service.ts:350, 419`, and test callers at `transaction/service.test.ts:68` and `service.dropped.test.ts:106`. These must migrate in the same PR.
  - Tails: `:677-683`/`:874-880`, `:736-739`/`:914-917`, `:754`/`:935`.
  - Signal-form `checkCancelled` at `:255, 295, 369` and `transfer-executor.ts:350-352`. The `:250-256` controller form differs.
- **Drift evidence:** none accidental. NO_FROM's zero nonce, external payment, submitted endpoint and absent authwit write are intentional but undocumented at the site.
- **Refined fix:**
  - A parameter object in `transaction/spec.ts`, with `SentTx` as a `Pick` of it.
  - Extend the existing `sentTxRecorder` with `{ nonce?, feePaymentMethod?, recordAuthwits }` for NO_FROM.
  - Local helpers reusing `pickPrimaryMethod`/`extractOffchainOutput`.
  - A checkpoint helper in `execution/rpc-cancel.ts` that reads current values when invoked. The transfer closure reads variables assigned later, so it must not capture them eagerly (Codex).
- **Disagreement record:** effort only (Claude 0.5–1 day, Codex about 1 day). Called at about 1 day, including the forwarders and test callers Codex found.

---

## Findings outside the top 10

These are **not independently verified**. They carry coordinator confidence only, as recorded in `consolidated.md`:

- Q-11 through Q-25 (Medium)
- Q-26 (Low)
- Q-27a–n (Low)

One writer spot-check changes a fix:

- **Q-16.** `packages/wallet-core/src/utils/sleep.ts` already exports `sleep`, so the four `sleep` copies bypass an existing helper rather than lacking one.
