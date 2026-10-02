# Harden Report: quality

**Repo:** nulo
**Date:** 2026-09-30
**Effort:** high
**Run ID:** 2026-09-30-dedup-high
**Models:** Phase 1 map: Sonnet ×6; Phase 2 scans: Claude Sonnet + Codex GPT-6 Astra xhigh per cluster; Phase 2.5 light cross-rebuttal both directions; Phase 3 coordinator: Opus 5.5; Phase 4 verifiers: Sonnet ×2 + Codex GPT-6 Astra xhigh; writer: Opus 5.5
**Scope:** `apps/extension` plus the 10 tracked `packages/*`. Excluded: `apps/landing`, `apps/playground`, infra, the untracked `apps/tools` and `packages/bridge-core` leftovers, generated and vendored files. Tests were read as evidence only.

## Executive summary

This run looked for code that is written more than once, because every copy has to be changed by hand whenever the rule it encodes changes. It kept 27 findings: 9 High, 16 Medium and 2 Low. Claude and Codex each verified the top ten independently against source; every one held, three with narrowed parts. The measured text duplication in production code is modest: 2.0% of lines. The problem is not volume. Most of the costly duplication is not copy-paste text. It is the same *rule* re-typed in a different shape per call site, which a clone detector cannot see:

- chain identity, 5 formula copies and 10 hand-built `ChainInfo` literals (Q-01)
- the primary-endpoint lookup, 15 copies (Q-04)
- the deletion-fenced write, 7 copies (Q-03)
- the selector-binding security guard, 6 copies (Q-02)
- the password visibility toggle, 8 copies (Q-08)

The strongest evidence is **drift: copies that already disagree**. Five of the High findings contain a copy that was fixed or extended on one side only, and three of those drifts are live bugs confirmed by the concurrent bugs run:

- `getNodeStatus` lacks the local-network carve-out that its twin `probeNodeStatus` has, so an edited Local Network reads as the wrong chain and is left out of backups (Q-04, bugs B-09).
- One estimate-reuse ladder lets a transient fee-read error abort a send, while its twin rejects softly and rebuilds (Q-05, bugs B-08).
- `patchAccountField` is the one account gate that skips the address check, and it also sits outside the deletion fence its siblings use (Q-03, bugs B-12 and the bugs run's security routing #1).
- Verification also surfaced drifts nobody had filed:
  - History shows cancelled operations from other networks, which Home filters (Q-06).
  - Two of the four new-password forms lack `autocomplete="new-password"` (Q-08).
  - The contact-name uniqueness check compares untrimmed input but saves trimmed input, so "Alice " slips past as a duplicate (Q-09).

The common root cause, behind 14 of the 27 findings, is that a named helper exists and was bypassed or only partly adopted. Examples are `chainInfoFrom`, `networkInfoFrom`, `useDappHostname`, `useEntityCrud`, `restoreRows`, `probedFirstSimOpts`, and `sleep` in wallet-core.

**Recommended priorities:**

1. Take the High findings with live drift first, each as a single-owner PR that fixes the drift and removes the copies together: Q-04 (`statusFor` fixes B-09 in an hour), Q-03 (`rowMatchesKey` plus `fencedSet`), Q-05 (mechanical option and multiplier steps first, the frozen two-pass shape last) and Q-06.
2. Do the sub-day wins next:
   - Q-07: the trust-confirmation window uses the shared hostname helper, under 30 minutes.
   - Q-26: delete about 1,300 dead lines.
   - Q-19, Q-20, Q-21, Q-24(a) and Q-25: half a day each.
3. Stop regrowth. Add a grep ratchet test for the six bypass idioms listed under Cross-cutting observations. Re-baseline the repo's duplication trend: its documented 4.84% predates the removal of the tools app, so today's 3.90% is not a dedup win.
4. Anything that changes a screen (Q-06 journal network rule, Q-08 autocomplete and shake timing, Q-22, Q-23) needs the owner's sign-off with screenshots, per CLAUDE.md.

Stakeholder report: https://claude.ai/artifact/9XX4h4nrhZRAR2tSKvEZ4J (source: `report.html` in this directory; the same page covers both the quality and bugs runs)

## Methodology

The run followed the harden map-reduce shape.

- **Phase 1 map.** Hierarchical repo maps, under `raw/repo-map/`.
- **Phase 2 scans.** Each cluster was scanned blind by one Claude and one Codex agent.
- **Phase 2.5 cross-rebuttal.** Each model read the other's report for the same cluster and confirmed, refuted or narrowed each item.
- **Phase 3 consolidation.** A coordinator deduplicated by root cause, smell and boundary, scored priority, and re-verified the contested claims in source.
- **Phase 4 verification.** Two Claude verifiers and one Codex verifier each re-derived a conclusion for the top ten from the instance list before reading the finding. The writer settled every disagreement in source (`findings/verified.md`).

**Clusters (13).**

| Cluster | Focus |
|---|---|
| q01 | wallet execution |
| q02 | wallet profile and state |
| q03 | wallet assets and activity |
| q04 | wallet dApp runtime |
| q05 | popup modules |
| q06 | popup popups and windows |
| q07 | popup pages |
| q08 | extension components and onboarding |
| q09 | extension composables, stores and utils |
| q10 | low packages |
| q11 | high packages |
| q12 | `@nulo/design` |
| q13 | cross-cutting primitives |

**Trace discipline.** Scan prompts carried a 4-function inter-procedural context cap. A scanner that reached the cap at a package or service handoff edge had to escalate the edge as a lead rather than keep tracing.

**Negative list, not reported as quality findings:**

- generated and vendored files (`src/types/*.d.ts`, `utilities.css`, the frozen account artifact)
- deliberate data mirrors owned by the `aztec-update` skill
- complexity acceptances already pinned in `scripts/complexity-baseline/manifest.json`
- test-only duplication
- style preferences with no change obligation

**Scoring.** Priority is scope × blast radius × change frequency:

- **Scope:** architectural 4, structural 3, local 2, cosmetic 1.
- **Blast:** files holding instances. 1–2 files score 1, 3–6 score 2, 7 or more score 3.
- **Frequency:** the upper-median `git log --since=2026-06-01` commit count across those files. 5 or fewer scores 1, 6–15 scores 2, 16 or more scores 3.

The buckets are High ≥18, Medium 8–17 and Low ≤7. Within a bucket, findings are ordered by demonstrated drift on a security, privacy or identity invariant, then by cross-model agreement. The High bucket was re-ordered after verification added drift evidence.

**Deviations, stated honestly:**

1. **Hierarchical map grouped by area.** Six area mappers ran (extension wallet, popup, shared UI, packages-high, packages-low, plus an outer map), rather than one mapper per package.
2. **13 clusters, not 12.** Twelve were cut by package and similarity. A thirteenth cross-cutting primitives cluster (q13) was added after the outer map surfaced shared-utility duplication that no package cluster owned.
3. **jscpd as a lead list.** It was run scoped to production `src` (extension and packages; tests, e2e and stories excluded; min-tokens 50). It served as a lead list for scanners, not as a finding source (`raw/jscpd-production.md`).
4. **Phase 2.5 ran light.** It used a resumed Codex session and a fresh Sonnet agent per cluster, one rebuttal round each way.
5. **Concurrent bugs run.** The bugs run (`audit/bugs/2026-09-30-ext-high/`) ran at the same time, reusing this run's map. Incidental bugs and security-flavoured items this run surfaced were handed to it; see that directory for their disposition.
6. **Verifier coverage is the top ten only.** Q-11 to Q-27 carry coordinator confidence, not independent verification.

## Findings

Sorted by computed priority. The bugs run's ids (B-NN, D-NN) refer to `audit/bugs/2026-09-30-ext-high/findings/consolidated.md`.

### High

#### Q-03: Row-service lifecycle protocols composed by hand per service

- **Verified:** confirmed with corrections (Claude: partially confirmed; Codex: confirmed; writer: confirmed, part (e) dropped).
- **Impact:** High (structural 3 × blast 3 × frequency 2 = 18). 14 files under `apps/extension/src/wallet/services/`; median 14 commits since June, max 31.
- **Confidence:** high for (a, c, d), moderate for (b).
- **Mapping:** Duplicate Code with Shotgun Surgery on security invariants (deletion fence, scope match, restore epoch); incomplete adoption of `purge-rows.ts`, `restore-rows.ts` and `restore-fence.ts`.
- **Found by:** Claude + Codex.
- **Instances** (under `apps/extension/src/wallet/services/`):
  - (a) Fenced commit ×7: `fpc/service.ts:230-238, 293-302`; `contact/service.ts:116-123`; `dapp-session/service.ts:203-210`; `network/service.ts:325-330, 493-499`; `token/service.ts:412-422`.
  - (b) Purge pipelines: `auth-registry/service.ts:505-573` (×3); `token-balance/service.ts:546-601` (a different mechanism, kept per service). Scope-key templates: `auth-registry/service.ts:515, 518, 533, 536`; `token-balance/service.ts:577, 581, 598`. Inline scope types: `token-balance/service.ts:574`, `auth-registry/service.ts:512`.
  - (c) Restore preamble: `token-balance/service.ts:676-685`, `auth-registry/service.ts:589-597`, `transaction/service.ts:529-538`. Hostile-row casts: `contact/service.ts:287-290`, `account/service.ts:674-677, 766-769`, `token/service.ts:858-861`.
  - (d) Row identity gate: `account/service.ts:180, 339-341, 408-411`; `account/imported-keys-repository.ts:28-30`. **Drifted:** `account/service.ts:322`.
- **Description:** The row-service helper layer extracted single steps. The protocols composed from those steps are re-typed per service: assert current, write, re-check, compensate, throw. They carry their own security comments ("a bare-address match would destroy a sibling profile's rows").
- **Trace:**
  - `patchAccountField` (`account/service.ts:322`) checks `profileId` and `chainId` only, then writes to the address carried in the row body (`:327`). `getAccountContract` (`:339`) checks all three.
  - B-12(b): the same writer resurrects an imported account after a chain purge, because it sits outside the deletion fence and row lock.
  - B-12(a): `importAccount` lacks the fence that `createAccountInternal` has.
- **Why it matters:** Each protocol change touches 5–9 sites: a typed `ProfileDeletedError`, a network-id scope dimension, a new store in a purge. The easy-to-forget leg (the raw-row predicate, the post-write re-check, the address check) is exactly the one that has already been dropped once.
- **Recommended fix:**
  - `rowMatchesKey(row, profileId, chainId, address)` in `account/spec.ts` beside `accountRowId`, used at all five gates (this fixes the drift).
  - `requireRestoreProfileId()` in `restore-fence.ts`.
  - `fencedSet` beside `purge-rows.ts`, starting with the fpc pair and keeping locks and network legs explicit.
  - `AccountScope` plus `accountScopeKey()`.
  - A private `purgeMatchingLocked` in auth-registry only.
  - Part (e), the raw marker stores, is dropped.
- **Effort estimate:** 2–3 days as one PR per owning service; the (a, c, d) subset is about 1–1.5 days.

#### Q-04: Network endpoint rules re-derived outside the network module

- **Verified:** confirmed with corrections (Claude and Codex both confirmed).
- **Impact:** High (3 × 3 × 2 = 18). 11 files, including 2 popups and 1 aztec-runtime adapter; median 9, max 31.
- **Confidence:** high.
- **Mapping:** Duplicate Code and Feature Envy on `Network.endpoints`/`primaryEndpointId`; no-primary handling diverges (`!`, `?? endpoints[0]`, throw, `?.`, silent skip).
- **Found by:** Claude + Codex.
- **Instances:**
  - Primary lookup ×15:
    - `apps/extension/src/wallet/services/network/service.ts:348, 423, 581, 731, 747, 769, 846`
    - `network/spec.ts:93, 107`
    - `execution/transfer-executor.ts:377`, `execution/dapp-send-executor.ts:470`, `execution/operation-estimate-reuse.ts:141`, `execution/transfer-estimate-reuse.ts:181`
    - `incoming-transfer/service.ts:536`
    - `apps/extension/src/popup/components/popups/EditNetworkPopup.vue:58`
  - `getNetworkInfo` (`network/service.ts:844-851`) is `networkInfoFrom` (`spec.ts:92-96`).
  - Status twins: `network/service.ts:728-742, 744-760`.
  - Identity guard ×2: `:603-615, 650-661`.
  - Transport allowlist ×2: `network/spec.ts:151-178` and `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58-73`.
  - Popup error ladders: `NewEndpointPopup.vue:54-63`, `EditEndpointPopup.vue:69-78`.
- **Description:** The network module owns endpoint identity and selection, yet execution, incoming-transfer, popups and aztec-runtime restate its rules.
- **Trace:**
  - `getNodeStatus` calls `_getChainId(primary.rpcUrl)` without `network.kind` (`network/service.ts:734`); `probeNodeStatus` passes it (`:753`). This is **B-09**: an edited local endpoint reads `InvalidChain`, and `account-state/service.ts:221` then omits that chain's contracts from full backups.
  - The userinfo rejection exists only in the schema (`spec.ts:166`).
- **Why it matters:** A failover rule needs about 15 edits, and the `!` copies throw on shapes the lenient ones tolerate. The status drift is already a shipped bug. A transport-policy change must cross a package boundary by hand.
- **Recommended fix:**
  - `findPrimaryEndpoint` in `network/spec.ts`, deriving the existing `primaryEndpointUrl` and `networkInfoFrom`.
  - A private `statusFor(network, probe)`, which fixes B-09.
  - `assertSameChainIdentity`.
  - A pure `isAllowedRpcTransport` leaf in `packages/wallet-core/src/utils/`, called by the schema and by the adapter's `isAllowedRpcUrl`. The adapter module is not exported and imports the node client, so a wallet-core leaf keeps it out of the popup import graph. Userinfo rejection stays schema-only unless the owner signs off.
  - A popup-local `endpointErrorMessage`.
  - Delete the "Codex Round 2 B-3" tag at `spec.ts:172`.
- **Effort estimate:** 1–2 days.

#### Q-06: Activity feed: Home and History duplicate row scoping and card presentation

- **Verified:** confirmed with corrections (Claude: confirmed; Codex: partially confirmed; writer: confirmed, with Codex's removals and Claude's new drift).
- **Impact:** High (3 × 3 × 2 = 18). 9 files; median 6, max 20 (`RecentActivityView.vue`).
- **Confidence:** high.
- **Mapping:** Duplicate Code with Shotgun Surgery; Switch Statements as Vue branch ladders; drift on privacy scoping.
- **Found by:** Claude + Codex.
- **Instances** (under `apps/extension/src/`):
  - Row builders: `utils/activity-rows.ts:79-88, 104-121` against `popup/components/modules/general/recent-activity-rows.ts:54-64, 66-82`.
  - Inline `isForeignProfile` copies: `TokensView.vue:66`, `RecentActivityView.vue:270`.
  - Card fields: `RecentActivityView.vue:337-395` against `utils/journal-state.ts:358-420`.
  - Dispatch ladders: `RecentActivityView.vue:852-865`, `popup/components/modules/activity/TransactionsList.vue:62-75`.
  - Chip and separator CSS: `components/composite/activity/TransactionAwaitingCard.vue:130-152`, `TransactionTerminalCard.vue:84-105`, `TransactionIncomingCard.vue:77-95`, `popup/components/modules/activity/TransactionCard.vue:198-215`.
- **Description:** Home and History show the same records. Each owns a copy of the scope rules, the card-field projection, the route mapping and the chip styling.
- **Trace:**
  - **Journal network drift (new):** Home drops other-network journal ops (`RecentActivityView.vue:264-278`). History fetches by profile only (`popup/pages/activity.vue:78`), and `journalRows` (`utils/activity-rows.ts:91-102`) ignores the `networkId` it receives. An account present on two networks therefore sees network A's cancelled or failed operations in History while network B is selected.
  - The incoming profile guard exists only on Home (`recent-activity-rows.ts:73`; the bugs run dropped it as hardening, D-14).
  - `cardAmountFor` renders `""` as `0` (`utils/amount.ts:103`), where `journal-state.ts:380` shows nothing.
- **Why it matters:** A new scope dimension, sort rule, card field or route lands on one surface, and the other disagrees silently. That has already happened twice on scoping.
- **Recommended fix:**
  - Export `txInScope`, `incomingInScope` and `incomingSortKey` from `utils/activity-rows.ts`. Give `journalRows` the network rule (user-visible; owner sign-off).
  - `buildJournalCardFields` in `journal-state.ts`.
  - A pure `activityRowRoute(row)`; any shared row component sits at L4.
  - Chip CSS via `composes`, keeping the green incoming variant. Take screenshots.
- **Effort estimate:** 1–2 days.

#### Q-08: Credential inputs: visibility toggle ×8, new-password pair ×4, shake keyframes ×7

- **Verified:** confirmed with corrections (Claude and Codex both confirmed).
- **Impact:** High (3 × 3 × 2 = 18). 11 files; median 6, max 17.
- **Confidence:** high.
- **Mapping:** Duplicate Code, a missing Extract Component; Shotgun Surgery on an owner-accepted accessibility policy.
- **Found by:** Claude + Codex.
- **Instances:**
  - Toggle: `apps/extension/src/components/composite/import/ImportSecretForm.vue:41-55, 77-91`, `ImportFullBackupForm.vue:112-126, 140-154`, `apps/extension/src/popup/components/modules/settings/new-profile/NewProfileCredentials.vue:24-42`, `apps/extension/src/popup/pages/auth.vue:255-276`, `apps/extension/src/popup/pages/settings/security/change-password.vue:128-145, 170-185`. The `.visibility_btn` CSS lives in the same five files.
  - Pairs: `ImportSecretForm.vue:66-108`, `ImportFullBackupForm.vue:130-173`, `NewProfileCredentials.vue:18-59`, `change-password.vue:158-202`.
  - `@keyframes shakeInput`: `SecretUnlockSection.vue:65`, `OnboardingProfileNameField.vue:45`, `auth.vue:439`, `popup/pages/import.vue:352`, `profile/new.vue:180`, `change-password.vue:288`, `export/full.vue:723`. `NewSenderPopup.vue:175-191` is a distinct variant.
- **Description:** The most sensitive screens hand-roll the same credential control. CLAUDE.md records the toggle's `tabindex="-1"` as a deliberate owner-accepted WCAG trade-off; today it holds only because eight copies agree.
- **Trace:**
  - `autocomplete="new-password"` is present at `ImportSecretForm.vue:76, 106` and `change-password.vue:168, 200`. It is absent from the new-password fields in `ImportFullBackupForm.vue` and `NewProfileCredentials.vue`, where a browser may autofill a saved password.
  - Shake duration is 0.3s in four files and 0.4s in three.
- **Why it matters:** Revisiting the accessibility trade-off, adding `aria-pressed`, or adding reduced-motion means 8–11 edits on wallet-critical screens. The autocomplete gap shows the copies are already drifting on a security-relevant attribute.
- **Recommended fix:**
  - L3 `PasswordVisibilityToggle.vue` (`v-model:visible`, `tabindex="-1"` inside).
  - `NewPasswordFields.vue` with `autocomplete="new-password"` on both fields, reusing `newPasswordHint` and `isNewPasswordValid`.
  - `.shake` and its keyframes in an extension CSS module consumed via `composes`, not in `base.css`: all seven are `<style module>` blocks, and `base.css` is hash-pinned and shared with the landing.
  - Duration unification and reduced-motion need owner sign-off.
- **Effort estimate:** about 1 day.

#### Q-05: Fee-estimation pipeline: strategy stages, fee composition and reuse validation copied

- **Verified:** confirmed with corrections (Claude and Codex both confirmed).
- **Impact:** High (3 × 3 × 2 = 18). 10 files in `apps/extension/src/wallet/services/execution/`; median 9, max 27.
- **Confidence:** high; moderate for the probe-fold hoist.
- **Mapping:** Duplicate Code, a missing Form Template Method; Data Clumps and Shotgun Surgery between estimate producers and reuse validators.
- **Found by:** Claude + Codex.
- **Instances** (under `apps/extension/src/wallet/services/execution/`):
  - Task wrapper ×5: `fee/fee-juice-strategy.ts:25-74`, `fee/fee-juice-with-claim-strategy.ts:25-48`, `fee/embedded-strategy.ts:32-51`, `fee/fpc-strategy.ts:136-201, 207-306`.
  - Probe fold ×3: `fee-juice-strategy.ts:33-58`, `fpc-strategy.ts:153-176, 221-258`.
  - FPC tail ×2: `fpc-strategy.ts:177-200, 283-302`.
  - Validated-options literal ×6: `fee-juice-strategy.ts:54`, `fee-juice-with-claim-strategy.ts:39`, `embedded-strategy.ts:42`, `fpc-strategy.ts:172, 254, 280`. The owner is `fee/fee-strategy.ts:170`.
  - Fee composition ×5: `fee-strategy.ts:286-290`, `fpc-strategy.ts:177, 261`, `operation-estimate-reuse.ts:160-161`, `transfer-estimate-reuse.ts:195-202`.
  - Multiplier ternary ×3: `service.ts:1103`, `operation-estimate-reuse.ts:160`, `transfer-estimate-reuse.ts:198-200`.
  - Reuse producers: `transfer-executor.ts:343-430`, `dapp-send-executor.ts:440-520`. Validators: `transfer-estimate-reuse.ts:148-216`, `operation-estimate-reuse.ts:108-175`.
  - `fingerprintBaseFee` in the wrong home: `transfer-estimate-reuse.ts:44`.
- **Description:** `FeeStrategy` is polymorphic, but the shared skeleton was never hoisted. The builders and both reuse ladders each recompute the fee basis they later compare by fingerprint.
- **Trace:** `operation-estimate-reuse.ts:159-162` calls `getNode`/`predictedWorstMinFees` outside any `try`, so a transient error aborts a send whose entry was already consumed. `transfer-estimate-reuse.ts:205-208` catches it and rejects softly. This is **B-08**.
- **Why it matters:** A new fold rule, abort checkpoint or payment kind means editing three blocks held in "byte parity" by comment. A fee-basis change applied to the builder but not to a ladder fails silently, as permanent "base fee drift".
- **Recommended fix,** in risk order, running `fee/fee-structural-parity.test.ts` and `fee/strategies-structural.test.ts` at each step:
  1. Export `probedFirstSimOpts`'s else-branch as `validatedSimOpts(built)` and use it at the six sites.
  2. `resolveFeeMultiplier` and `committedMaxFees` beside `predictedWorstMinFees` in `packages/aztec-runtime/src/fee-juice.ts`.
  3. Move `fingerprintBaseFee` to `estimate-reuse-shared.ts`.
  4. `withEstimateTask`.
  5. The probe-fold hoist.

  B-08's catch is a separate bug PR.
- **Effort estimate:** 2–3 days.

#### Q-09: Keyed list reducers hand-rolled beside `useEntityCrud`; contact rules re-encoded

- **Verified:** confirmed with corrections (Claude: confirmed; Codex: partially confirmed; writer: confirmed, with Codex's correction to the drift statement).
- **Impact:** High (3 × 3 × 2 = 18). 10 files; median 6, max 19 (`send.vue`).
- **Confidence:** high.
- **Mapping:** Duplicate Code (incomplete adoption of an existing extraction); a magic string used as a flag.
- **Found by:** Claude + Codex.
- **Instances** (under `apps/extension/src/popup/`):
  - `components/popups/NewContactPopup.vue:29-51`, `EditContactPopup.vue:29-62`, `ImportContactsPopup.vue:30-49`, `pages/send.vue:192-212`.
  - `NewFpcPopup.vue:89-99`, `EditFpcPopup.vue:136-153`, `SelectProfilePopup.vue:77-91`, `SelectTokenPopup.vue:77-89`.
  - `pages/settings/connected-apps/index.vue:54-73`.
  - Shared implementation: `apps/extension/src/composables/useEntityCrud.ts:104-140`.
  - Contact validators: `NewContactPopup.vue:53-99`, `EditContactPopup.vue:66-126`; Map form at `ImportContactsPopup.vue:94-128`.
- **Description:** Ten owners reconcile service events into lists by hand, and the contact identity rule lives in three shapes.
- **Trace:**
  - The composable treats a repeated add as an update (`useEntityCrud.ts:111`). The four contact copies append, `SelectProfilePopup` upserts, and `SelectTokenPopup` ignores duplicates.
  - `NewContactPopup.vue:58` and `EditContactPopup.vue:75` compare the untrimmed name, but save `trim()` (`:111`, `:142, 151`), and `ContactService.addContact` enforces no uniqueness. So "Alice " is saved as a second "Alice".
- **Why it matters:** A replay or identity change touches ten files, and the composable's dedup fix never reached the copies. The contact rule's bug exists twice and has to be fixed twice.
- **Recommended fix:**
  - Pure `utils/entity-list.ts` (`upsertById`, `replaceById`, `removeById`) used inside `useEntityCrud` and by the consumers, with explicit policies.
  - `findConflictingContact` (which trims) and `canonicalContactAddress` returning a typed result instead of `"Already exist"`.
- **Effort estimate:** about 1 day for the contact copies and the helper; the remaining reducers follow.

#### Q-07: dApp approval windows: the verify window re-implements the hostname check and window lifecycle the hook owns

- **Verified:** partially confirmed (both verifiers); (d) narrowed to the cancellation predicate.
- **Impact:** High (3 × 3 × 2 = 18). 8 files; median 6, max 19.
- **Confidence:** high for (a–c), moderate for (d).
- **Mapping:** Duplicate Code (a shared helper exists and one window re-implements it); Shotgun Surgery on window lifecycle.
- **Found by:** Claude + Codex.
- **Instances** (under `apps/extension/src/`):
  - (a) `popup/windows/verify/index.vue:52-67` against `composables/useDappHostname.ts:8-27`.
  - (b) Window close ×4: `verify/index.vue:77-83`, `popup/windows/json/index.vue:16-21`, `popup/windows/logger/index.vue:12-17`, `composables/useDappApprovalWindow.ts:88-92`.
  - (c) Session wait: `verify/index.vue:118-133` against `useDappApprovalWindow.ts:102-115`.
  - (d) Cancelled-branch classification: `discover/index.vue:110-117`, `capabilities/index.vue:328-335`, `execute/index.vue:525-533`.
- **Description:** The approval-window hook took over the lifecycle, but the trust-confirmation window kept private copies.
- **Trace:**
  - The hostname copies agree today. A hardening edit to `useDappHostname` (confusables, mixed script) would reach three windows and skip `verify`.
  - `json` and `logger` call `remove(window.id)` without the id guard the other two have.
  - Adjacent: B-07 (a close before the `beforeunload` hook reaches the dApp unclassified) lives in the same lifecycle.
- **Why it matters:** The one screen that asks the user to trust a site would miss the next anti-phishing fix.
- **Recommended fix:**
  - `useDappHostname(dapp)` in verify (under 30 minutes).
  - A guarded `closeCurrentWindow()` in `utils/`.
  - `whenSessionChecked(getter)` (C0).
  - Export only `isApprovalCancelled(err)`.
  - Keep `useDappInteractionPayload` router-free: leave the three `getRequestId` lambdas.
- **Effort estimate:** about 0.5 day.

#### Q-01: Chain identity derived per layer (composite chain id, `ChainInfo`, SDK chain info, NO_FROM sender)

- **Verified:** confirmed with corrections (Claude and Codex both confirmed).
- **Impact:** High (3 × 3 × 2 = 18). 15 files across aztec-runtime, wallet-bridge and the extension; median 7, max 31.
- **Confidence:** high.
- **Mapping:** Duplicate Code with Shotgun Surgery; Misplaced Function (`walletChainId` lives in the extension while aztec-runtime needs it).
- **Found by:** Claude + Codex.
- **Instances:**
  - (a) Formula `(l1ChainId ^ rollupVersion) >>> 0`. The owner is `apps/extension/src/utils/chain-ids.ts:12-14`. Copies:
    - `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:101`
    - `packages/aztec-runtime/src/utils/chain-identity.ts:59`
    - `apps/extension/src/wallet/services/network/service.ts:1010`
    - `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:16-21`
    - `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:45-56`
    - `apps/extension/scripts/seed-preflight.ts:22`
  - (b) Ten `ChainInfo` literals instead of `chainInfoFrom`: `execution/authwit-discoverer.ts:119, 174-175, 225-226, 239-240`, `discovery-probe.ts:79`, `dapp-send-executor.ts:1005`, `view-executor.ts:213`, `fast-path.ts:228-229`, `service.ts:1021-1022`, `helpers/batched-view-simulation.ts:363-364`.
  - (c) NO_FROM normalization ×3: `packages/wallet-bridge/src/dispatcher.ts:185-193`, `queued-journal.ts:84-89`, `execution/utils/fee-detection.ts:18-20`.
- **Description:** Chain identity is the wallet's storage-scoping and anti-drift anchor. The formula and the `ChainInfo` projection each have a named owner, and 15 files re-derive them.
- **Trace:**
  - No behavioural drift yet. The copies are held equal by "mirror" comments, and two of those are already stale:
    - `queued-journal.ts:45` names `background.ts` as the original; the function now lives in `session-established.ts`.
    - `authwit-discoverer.ts:116-117` calls the assertion a no-op for local networks, although `chain-identity.ts:47-57` still checks L1 and rollup version there.
  - The three session-address sets (`dispatcher.ts:439, 1730`, `queued-journal.ts:143`) already differ by contract.
- **Why it matters:** Several consumers must change together whenever the composite id or the `Fr` decoding changes: the probe (what is stored), `assertLiveChainIdentity` (what is compared), session establishment and journal admission. A missed copy makes signing refuse every request, or binds records to the wrong network.
- **Recommended fix:**
  - Move `walletChainId` into aztec-runtime `chain-identity.ts`, re-exported by the extension. Nothing below aztec-runtime needs it, and the assertion there already holds the formula.
  - Add `chainIdFromSdkChainInfo` there.
  - Use `chainInfoFrom` at the ten literals, plus `liveChainInfo(node, network)` for the five fetch-and-assert sites.
  - Move `NO_FROM` and `requestedSenderOf` into `packages/wallet-bridge/src/account-resolution.ts`.
  - Keep the session sets distinct and fix both stale comments.
- **Effort estimate:** about 1 day.

#### Q-02: Execution entry points each re-implement security guards

- **Verified:** confirmed with corrections (Claude and Codex both confirmed).
- **Impact:** High (3 × 3 × 2 = 18). 7 files in `apps/extension/src/wallet/services/execution/`; median 7, max 30.
- **Confidence:** high for (a, b), moderate for (c).
- **Mapping:** Duplicate Code leading to Shotgun Surgery; a security rule maintained by convention across entry points.
- **Found by:** Claude + Codex.
- **Instances** (under `apps/extension/src/wallet/services/execution/`):
  - (a) Authwit effect decode ×3: `authwit-discoverer.ts:110-141`, `discovery-probe.ts:66-101`, `dapp-send-executor.ts:1000-1019`.
  - (b) Selector/name binding ×6: `tx-request-builder.ts:340-348, 587-599`, `authwit-discoverer.ts:197-205`, `service.ts:1043-1051`, `view-executor.ts:367-373`, `fast-path.ts:135-140`.
  - (c) Class-id integrity ×3: `service.ts:834-837, 981-984`, plus the existing `packages/aztec-runtime/src/pxe/artifact-class-id.ts:52` (`verifyArtifactClassId`).
- **Description:** Each execution path re-derives the same chain-bound decode loop and the same scope-binding rule. The shared helpers (`findFunctionBySelector`, `toDiscoveredAuthwit`) stop one step short.
- **Trace:** No accidental drift. These differences are intentional and documented, and must survive the refactor:
  - The fast path requires a name (`fast-path.ts:138`).
  - The probe dedupes (`discovery-probe.ts:89`).
  - Error text is caller-owned (`contract-resolver.ts:55-58`).
- **Why it matters:** An upstream encoding change, a name-presence policy change, or a cap on the dApp-controlled effect loop must land in three or six places. Text-clone search does not find the full set.
- **Recommended fix:**
  - A synchronous `assertSelectorBinding(fn, { name, to, label, requireName })` in `contract-resolver.ts`.
  - `decode-authwit-effects.ts` beside `discovered-authwit.ts`, with probe dedupe kept in the caller.
  - A throwing `assertArtifactClassId` beside `verifyArtifactClassId` in aztec-runtime.
  - Pinned error strings stay unchanged.
- **Effort estimate:** 1–2 days.

### Medium

Q-10 was independently verified. Q-11 to Q-25 carry coordinator confidence only.

#### Q-11: `dispatcher.ts` accretion: capability planning, popup-handler scaffold and routing facts outside the registry

- **Impact:** Medium (architectural 4 × blast 1 × frequency 3 = 12). 2 files; `dispatcher.ts` has 29 commits since June and 1,794 lines, up 31% since 2026-08-16.
- **Confidence:** high (not independently verified).
- **Mapping:** Divergent Change and Large module; Duplicate Code in popup handlers; a routing if-ladder beside a registry; Middle Man (`unwrapResult`).
- **Found by:** Claude + Codex.
- **Instances** (`packages/wallet-bridge/src/dispatcher.ts`):
  - capability planning `:185-760`; routing ladder `:915-975`; hard-coded batch ban `:1072-1090`
  - handlers `:1105-1148, 1158-1206, 1228-1252, 1263-1305`; `unwrapResult` `:1790-1792`
  - prose notes in `packages/wallet-bridge/src/method-descriptors.ts`
- **Description:** Permission policy and execution orchestration share one hotspot. Which methods are popup-gated is stated in three places.
- **Trace:** The batch ban omits the popup-gated `grantPublicAuthwit`. The bugs run dropped this as a bug because the popup still gates it (D-16); it was routed to security.
- **Why it matters:** Every consent fix lands in the same review surface as routing and handler edits. A new popup method adds a fifth scaffold and must remember the ban list.
- **Recommended fix:**
  - Move the pure block to `packages/wallet-bridge/src/capability-negotiation.ts`.
  - Add `popupGated` to `MethodDescriptor` and derive the batch refusal set from `METHOD_REGISTRY`.
  - A narrow `runPopupOperation` preserving the sendTx admission hooks and createAuthWit's silent fenced path.
  - Inline `unwrapResult`.
- **Effort estimate:** 1–2 days. **Recurring:** 2026-08-16 Q-01.

#### Q-12: Balance snapshot state machine copied between TokensView and BalanceView

- **Impact:** Medium (3 × 2 × 2 = 12). 3 files; median 12, max 17.
- **Confidence:** high (not independently verified).
- **Mapping:** Duplicate Code with Shotgun Surgery; Extract Composable.
- **Found by:** Claude + Codex.
- **Instances:** `apps/extension/src/popup/components/modules/general/TokensView.vue:184-305, 343-388`; `BalanceView.vue:177-309, 334-345`; a lighter copy in `apps/extension/src/popup/components/popups/SelectTokenPopup.vue:70-137`. Their tests pin the same scenarios twice.
- **Description:** A race-fencing protocol exists in two full copies and one partial copy.
- **Trace:** `BalanceView.vue:235-239` pushes without the id dedupe at `TokensView.vue:197`. The bugs run dropped the consequence as unreachable, because the Added emitter sends zero balances (D-09).
- **Why it matters:** Retry, reconnect or precedence fixes must be made two or three times, or the hero total and the holdings list disagree.
- **Recommended fix:** A C1 `useScopedTokenBalances({ client, scope, mapRow? })` taking the parent-owned client, using `createRunFence` and exposing `dispose()`. Adopt it in SelectTokenPopup only if its show/hide contract is kept.
- **Effort estimate:** about 1 day.

#### Q-10: Transaction recording: 12-positional `addTransaction` plus duplicated dApp-send tails

- **Verified:** confirmed (Claude and Codex both confirmed).
- **Impact:** Medium (local 2 × 2 × 3 = 12). 3 files; median 17, max 27.
- **Confidence:** high.
- **Mapping:** Long Parameter List and Data Clumps; Duplicate Code in the dApp-send executor.
- **Found by:** Claude + Codex.
- **Instances** (under `apps/extension/src/wallet/services/`):
  - Declaration: `transaction/service.ts:155-170`.
  - Producers: `execution/transfer-executor.ts:182-214`, `execution/dapp-send-executor.ts:528-541, 919-932`.
  - Forwarders: `execution/service.ts:350, 419`.
  - Index projections: `dapp-send-executor.ts:125-138`.
  - Tails: `:677-683/874-880`, `:736-739/914-917`, `:754/935`.
  - Signal checkpoints: `:255, 295, 369` and `transfer-executor.ts:350-352`.
- **Description:** One recording request travels as 12 positional arguments, several of them same-typed strings.
- **Trace:** No accidental drift. NO_FROM's zero nonce, external payment and missing authwit write are intentional but undocumented at the call site.
- **Why it matters:** Reordering same-typed fields still type-checks. A new field means synchronized edits in three producers, two forwarders and the index types.
- **Recommended fix:**
  - A parameter object in `transaction/spec.ts`, with `SentTx` as a `Pick` of it.
  - Extend `sentTxRecorder` for NO_FROM.
  - Local tail helpers reusing `pickPrimaryMethod`/`extractOffchainOutput`.
  - A lazy checkpoint helper in `execution/rpc-cancel.ts`.
- **Effort estimate:** about 1 day.

#### Q-14: Onboarding and popup shells duplicate the import flow and the method tablist

- **Impact:** Medium (3 × 2 × 2 = 12). 5 files; median 9, max 12.
- **Confidence:** high (not independently verified).
- **Mapping:** Duplicate Code, Data Clumps (a 35-name destructure), and Switch Statements in the action predicates.
- **Found by:** Claude + Codex.
- **Instances:**
  - `apps/extension/src/onboarding/pages/import.vue:65-102, 136-176, 184-256` against `apps/extension/src/popup/pages/import.vue:97-134, 196-237, 246-330`, plus `popup/pages/import-helpers.ts:20-28`.
  - Tablist: `apps/extension/src/onboarding/pages/create.vue:79-88, 115-145` against `apps/extension/src/popup/components/modules/settings/new-profile/NewProfileMethodTabs.vue:13-55`. That component is L4, so onboarding cannot import it.
- **Description:** The flow composables are shared, but the wiring, the CTA predicates and a CLAUDE.md-mandated keyboard pattern are copied per shell.
- **Trace:** The popup's "Finishing import" branch is deliberate. The copy exists because of the L4 layer rule.
- **Why it matters:** A new `restoreStatus` or keyboard-rule fix must land twice.
- **Recommended fix:**
  - Shared predicates in `apps/extension/src/utils/full-backup-actions.ts`, exposed via `useProfileImportFlow`.
  - An L3 `AuthMethodTabs.vue` in `components/composite/`.
  - Optionally, an L3 `ImportFlowBody.vue`.
- **Effort estimate:** about 1 day.

#### Q-13: Popup key and stack-order arithmetic repeated in 24 popups; trust queue embedded in PopupManager

- **Impact:** Medium (local 2 × 3 × 2 = 12). 25 files; median 6, max 10.
- **Confidence:** moderate (not independently verified).
- **Mapping:** Shotgun Surgery and Primitive Obsession (a stringly key re-read per popup); Large Class and Divergent Change in PopupManager.
- **Found by:** Claude (Codex partial).
- **Instances:**
  - `popupStore.len - popupStore.popups.<key>?.order` in 24 files under `apps/extension/src/popup/components/popups/` (for example `ConfirmPopup.vue:30`); registry at `PopupManager.vue:316-354`.
  - Trust queue at `PopupManager.vue:55-250`.
- **Description:** The manager knows every key, yet each popup recomputes its own stack depth, and a registry component also hosts an event queue.
- **Trace:** Two values must be preserved: raw order for `Popup` z-index and reverse depth for `PopupCard` (Codex). Triple equality appears at `:76-78, 114-116, 208-210`. Workflow tags ("P8 tactical C2 fix", `:154-155`; "opus H-6", `:304`) break the CLAUDE.md comment rule.
- **Why it matters:** A stacking-rule change takes 24 edits, and a mistyped key silently stacks wrong through optional chaining.
- **Recommended fix:**
  - `popupStore.stackOf(key)` or `order`/`depth` props from the manager.
  - A C1 `useIncomingTrustPrompts(client)` taking a connected client.
  - Strip the tags.
- **Effort estimate:** about 1 day.

#### Q-15: Low-level primitives re-implemented instead of `@nulo/wallet-core/utils`

- **Impact:** Medium (3 × 3 × 1 = 9). 20 files in 4 workspaces; median 4, max 29.
- **Confidence:** high for encoders, moderate for decoders and guards (not independently verified).
- **Mapping:** Duplicate Code (a bypassed shared abstraction); drifted meaning for the record guards.
- **Found by:** Claude + Codex (the record-guard part is disputed).
- **Instances:**
  - Encoders: `apps/extension/src/wallet/services/profile/service.ts:1718, 1876-1878, 2063`; `packages/wallet-crypto/src/session-secret-box.ts:91-102`; `packages/wallet-crypto/src/wallet-fingerprint.ts:36-37`; `packages/aztec-runtime/src/pxe/client.ts:208`; `packages/aztec-runtime/src/account/account-export.ts:80`; `apps/extension/src/wallet/utils/passkey-ceremony.ts:139`; `apps/extension/src/popup/pages/settings/security/export/full.vue:348`.
  - Lenient `Buffer` decoders on sealed-secret paths: `profile/service.ts:2072, 2310, 2321, 2341`, `packages/wallet-crypto/src/password-secret-box.ts:219, 226, 234`, and others.
  - Random hex ×2 duplicating `getRandomHex(32)`.
  - Record guards: 6 array-excluding and 5 permissive definitions, including both meanings in `packages/wallet-bridge/src/dispatcher.ts:307, 767`.
- **Description:** `encoding.ts` states its purpose is to replace the per-site `Buffer` and loop idioms, and about 30 sites still bypass it.
- **Trace:** `dapp-session/integrity.ts:58-62` has a dead catch, because `Buffer.from(…,"base64")` never throws (bugs D-20, fails closed).
- **Why it matters:** Dropping the `Buffer` polyfill stays blocked. A wire-validation site can pick the wrong object guard.
- **Recommended fix:**
  - PR 1: encoders, `getRandomHex`, PXE byte equality.
  - PR 2: decoders site by site, each with an exception-parity test.
  - `isRecord`/`isObjectLike` in `packages/wallet-core/src/utils/guards.ts`.
- **Effort estimate:** about 1 day, plus a separate decoder PR.

#### Q-16: Async-coordination primitives hand-rolled: deadline race ×8, serial queue ×7, latest-wins counters ×10

- **Impact:** Medium (3 × 3 × 1 = 9). 23 files; median 3, max 17.
- **Confidence:** high for (a), moderate for (b–c) (not independently verified).
- **Mapping:** Duplicate Code with parallel implementations of `Lock`/`createRunFence`; Misplaced Function (`withTimeout` in a Pinia store).
- **Found by:** Claude + Codex.
- **Instances:**
  - Deadline race: `apps/extension/src/stores/balances.store.ts:124-139`, `apps/extension/src/popup/auth-guard.ts:83-90`, `apps/extension/src/components/Header.vue:34-43`, `apps/extension/src/components/JsonViewer/LogsViewer.vue:189-200`, `apps/extension/src/composables/importPreflight.ts:41-47`, `importChainSync.ts:111-117`, `packages/extension-messaging/src/core/base-client.ts:284-301`, `packages/aztec-runtime/src/pxe/opfs-store.ts:124-135`.
  - `sleep` copies at `importPreflight.ts:31`, `auth-guard.ts:66`, `app.store.ts:648` and `gas-balance-reader.ts:227`, **although `packages/wallet-core/src/utils/sleep.ts` already exports `sleep`** (writer spot-check).
  - Serial queues ×7.
  - Latest-wins counters beside `apps/extension/src/composables/runFence.ts:12-20`.
- **Description:** Each copy decides timer cleanup, loser observation and rejection policy for itself.
- **Trace:** B-21 in the bugs run is this family. Popup profile creation spins on `while (!appStore.isLogined) await sleep(100)` (`popup/pages/profile/new-profile-helpers.ts:25-27`) with no exit, while the bounded, failure-aware `awaitProfileActivation` (`composables/unlockWait.ts:32-60`) sits unused beside it.
- **Why it matters:** Deadline cleanup is correct in some copies and missing in others. A missed `gen` check after a new `await` in an export flow writes a payload back after scrubbing.
- **Recommended fix:**
  - `raceDeadline` in `packages/wallet-core/src/utils/timeout.ts`.
  - `createSerialQueue` in `packages/wallet-core/src/utils/serial.ts`.
  - Replace the `sleep` copies with the wallet-core `sleep`.
  - Extend `createRunFence` with `current()` and `invalidate()`.
  - `useDownloadAction` for the two export pages.
- **Effort estimate:** 1–2 days.

#### Q-17: ProfileService Large Class hosting duplicated credential-row and open scaffolds

- **Impact:** Medium (3 × 1 × 3 = 9). 1 file (2,797 lines), 25 commits since June.
- **Confidence:** high for (a–b), moderate for (c), low for (d) (not independently verified).
- **Mapping:** Large Class and Divergent Change containing Duplicate Code.
- **Found by:** Claude + Codex (part (d) disputed).
- **Instances** (`apps/extension/src/wallet/services/profile/service.ts`):
  - Six row constructors at `:605-627, 761-775, 2159-2178, 2211-2234, 2393-2434, 2581-2599`.
  - Degraded-open tail ×4 at `:702-706, 851-855, 2726-2730, 2787-2791`.
  - Pending-restore contexts at `:124-239`.
- **Description:** The persisted row contract and the "degraded open must warn" rule are restated per path.
- **Trace:** Commit `152b1083` edited all six literals, and `d56d6a85` edited three MAC calls. `scripts/complexity-baseline/manifest.json` has no acceptance for this file.
- **Why it matters:** A new MAC input means six edits, and a miss surfaces only at first unlock.
- **Recommended fix:**
  - Row builders in `profile/profile-row.ts`.
  - `openAndWarnIfDegradedHoldingLock`.
  - Extract Class `PendingRestoreContexts`.
  - Do not build (d) without revisiting `implementations-plan/profile-service-dedup/plan.md`.
- **Effort estimate:** 1–2 days. **Recurring:** 2026-08-16 Q-01.

#### Q-18: incoming-transfer note and public arms duplicate the trust/commit pipeline and clear scaffolds

- **Impact:** Medium (3 × 1 × 3 = 9). 2 files; `service.ts` has 22 commits.
- **Confidence:** high (not independently verified).
- **Mapping:** Duplicate Code and Shotgun Surgery inside a 2,464-line service.
- **Found by:** Claude + Codex.
- **Instances** (`apps/extension/src/wallet/services/incoming-transfer/service.ts`):
  - Trust `:1433-1453` / `:2126-2158`; commit `:1465-1492` / `:2161-2172`.
  - Record builders `:2346-2376` / `:2174-2196`; dedupe `:1383-1415` / `:2113-2121`.
  - Clears `:702-757`; the note-scheduler teardown ×2.
  - Store inventory ×2 at `repository.ts:221-244`.
- **Description:** Two receipt sources run one workflow in two hand-copied arms.
- **Trace:** The arms already differ in their epoch re-checks. The bugs run judged the note arm's gap benign under the service lock (D-06).
- **Why it matters:** A new trust state or dedupe source means editing both arms, and a sixth store needs two inventory edits.
- **Recommended fix:** `promoteUnknownTrust`, `buildPendingEvent`, `commonRecordFields`, `stopNoteScheduler`, `clearScoped`, and a repository `clearScopePrefix`.
- **Effort estimate:** about 1 day. **Recurring:** 2026-08-16 Q-01.

#### Q-19: Grant matching duplicated between consent coverage and enforcement

- **Impact:** Medium (3 × 1 × 3 = 9). 2 files.
- **Confidence:** high (not independently verified).
- **Mapping:** Duplicate Code and Shotgun Surgery on an authorization rule.
- **Found by:** Claude + Codex.
- **Instances:** `scopeCovers` at `packages/wallet-bridge/src/dispatcher.ts:219-230` against `matchesPattern` at `packages/wallet-bridge/src/method-scope-checkers.ts:38-43`; address-list coverage at `dispatcher.ts:204-217, 263-271` against `method-scope-checkers.ts:57-60`; `grantsOfType` ×2.
- **Description:** "Does this grant reach that call" is written once for re-prompting and once for enforcement. The comment says it "deliberately mirrors enforcement".
- **Trace:** The empty-function-name guard exists only in enforcement (`method-scope-checkers.ts:45-54`).
- **Why it matters:** A wildcard change made only in enforcement makes the wallet skip a re-prompt for grants it will then refuse, or silently approve a widening.
- **Recommended fix:** A leaf `packages/wallet-bridge/src/scope-matching.ts`. Each side keeps its own iteration.
- **Effort estimate:** 0.5 day.

#### Q-20: `WalletError` reconstruction encoded in three parallel structures

- **Impact:** Medium (3 × 1 × 3 = 9). 1 file, 20 commits.
- **Confidence:** moderate (not independently verified).
- **Mapping:** Shotgun Surgery and Switch Statements.
- **Found by:** Claude (Codex partial).
- **Instances** (`packages/extension-messaging/src/errors.ts`): 21 classes at `:50-463`; union at `:472-493`; switch at `:503-558`.
- **Description:** "Code X reconstructs as class X" is stated three times, and a missing case compiles and falls back to a bare `WalletError`.
- **Trace:** `errors.test.ts:245-253` loops over 16 classes, and `:256-266` pins the `TooManyPendingError` omission.
- **Why it matters:** Each new wire error needs three edits, and a missed one surfaces as a silently failing `instanceof`.
- **Recommended fix:**
  - A registry keyed by `CODE`, with `static fromPayload` for the four irregular classes, and the union derived from it.
  - A test that every exported subclass is registered or explicitly client-local.
- **Effort estimate:** 0.5 day.

#### Q-21: PXE legacy IndexedDB deletion wrapped ×3; keyval-store guard written twice

- **Impact:** Medium (3 × 1 × 3 = 9). 1 file, 25 commits.
- **Confidence:** moderate (not independently verified).
- **Mapping:** Duplicate Code with unnamed per-site policies.
- **Found by:** Claude (Codex partial).
- **Instances** (`packages/aztec-runtime/src/pxe/service.ts`): delete wrappers `:285-297, 309-320, 866-884`; keyval guard `:302-321, 780-792`.
- **Description:** A data-protecting rule (keep a surviving profile's PXE) is implemented twice, each with its own `databases()` re-list.
- **Trace:** The blocked-handling policies differ with reasons: boot skips, erasure waits.
- **Why it matters:** Tightening the guard for a new profile-scoped database must hit both copies, or a surviving profile's data is corrupted.
- **Recommended fix:** `pxe/legacy-idb.ts` with `deleteIdb(name, { onBlocked })` and `deleteSharedKeyvalIfNoPxeDbs`. Alternatively, retire the rc.2-era sweep (owner call).
- **Effort estimate:** 0.5 day. **Recurring:** 2026-08-16 Q-01.

#### Q-22: Shared visual shells copied as CSS

- **Impact:** Medium (3 × 3 × 1 = 9). 24 files; median 4, max 11.
- **Confidence:** high (not independently verified).
- **Mapping:** Duplicate Code encoding a shared visual component; incomplete adoption of `detail-page.module.css`, `popup-shared.module.css`, `ListStatusMessage`, `Skeleton` and `Button cta_outline`.
- **Found by:** Claude + Codex.
- **Instances:**
  - Settings row: `apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:62-148` equals `apps/extension/src/popup/pages/settings/connected-apps/index.vue:176-258` (jscpd's top clone).
  - Record card: `AuthwitCard.vue:65-168` against `advanced/account-state/notes/index.vue:261-392`.
  - Toolbar icon button ×5, none with `:focus-visible`.
  - `tx/[id].vue` against `received/[id].vue` (about 115 duplicated CSS lines).
  - Empty state, shimmer, popup body ×16, disclosure, snack card, CTA.
- **Description:** L0–L2 moved to `@nulo/design`, but the L3 visual shells stayed as per-screen CSS copies.
- **Trace:** Already drifted: `:last-of-type` against `:last-child`; `overflow-wrap` only in `ListStatusMessage`; reduced-motion only on the received page.
- **Why it matters:** An owner-approved restyle must be found and applied in 2–16 files.
- **Recommended fix:** `composes` modules (`settings-row`, `record-card`), an L2 `ToolbarIconButton`, `Skeleton` with custom properties, and `popup-shared` `.wrapper`/`.title`. Each step pixel-identical, with screenshots.
- **Effort estimate:** 2–3 days as small PRs.

#### Q-23: Design-token layer: dark palette declared twice; hairline and scrim values hard-coded

- **Impact:** Medium (3 × 3 × 1 = 9). 10 or more files.
- **Confidence:** high for (a), moderate for (b) (not independently verified).
- **Mapping:** Duplicate Code; magic literals where tokens belong.
- **Found by:** Claude + Codex.
- **Instances:**
  - `packages/design/src/base.css:72-123` against `:194-245`: 28 identical declarations.
  - `rgba(74,70,63,.2/.3)` hairlines at about 19 sites, 3 with light twins.
  - Scrims with six alphas.
- **Description:** A colour edit in one dark block silently leaves the other stale; `theme-contrast.ts:33-40` merges the blocks, so no test can see a mismatch.
- **Trace:** About 16 hairlines render dark-hued in the light theme. The bugs run routed this back here as a visual item (D-19).
- **Why it matters:** A restyle is a 20–35-file edit, and nothing blocks new literals.
- **Recommended fix:**
  - One `:root, [theme="dark"]` block plus an equality assertion.
  - `--hairline-soft`/`-strong` at today's exact values first (byte-identical).
  - Light-theme corrections with owner sign-off.
- **Effort estimate:** about 1 day.

#### Q-24: FeeSettingsCard fee-scope identity predicates ×6 and a mode flag threading two selection models

- **Impact:** Medium (3 × 1 × 3 = 9). 1 file (982 lines), 20 commits.
- **Confidence:** high for (a), low for (b) (not independently verified).
- **Mapping:** Data Clumps and Duplicate Code; Switch Statements on `originPrivacy === null`.
- **Found by:** Claude (Codex agreed on (a) only).
- **Instances** (`apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue`): (a) `:184-189, 548-554, 726-734, 620, 716, 772`; (b) `:198-222, 364-400, 525, 569, 582, 590, 755`.
- **Description:** The `{profileId, networkId, chainId, accountAddress}` identity is compared and keyed six ways.
- **Trace:** The complexity manifest lists only the test file, not this component.
- **Why it matters:** A new identity field needs six edits.
- **Recommended fix:** (a) `sameFeeScope`/`feeScopeKey` in `fee-helpers.ts`, which is mechanical. (b) only as an owner-visible plan.
- **Effort estimate:** 0.5 day for (a).

#### Q-25: Full-backup restore stages depend on UI-owned transforms through `never` casts

- **Impact:** Medium (3 × 1 × 3 = 9). 2 files; `useFullBackupImport.ts` has 31 commits.
- **Confidence:** high (not independently verified).
- **Mapping:** Inappropriate Intimacy; type-safety erosion as a cycle workaround.
- **Found by:** Codex (Claude agreed on the facts).
- **Instances:** `apps/extension/src/composables/useFullBackupImport.ts:165-171, 239-243, 523-536`; `apps/extension/src/composables/full-backup-restore.ts:129-133, 326-339, 373-388`.
- **Description:** The stage interface declares an `AccountRestoreClient` without `restore`, then calls a UI transform through `data: never, accountService: never`.
- **Trace:** A change to a transform's inputs does not type-error at the handoff.
- **Why it matters:** This is the data-recovery path, and its type check is switched off at exactly the seam most likely to change.
- **Recommended fix:** Move account filtering and token relinking into a non-reactive restore-support module with a minimal client type that includes `restore`.
- **Effort estimate:** 0.5 day.

### Low

#### Q-26: Dead and speculative code left behind

- **Impact:** Low (local 2 × 3 × 1 = 6). 16 or more files.
- **Confidence:** high (not independently verified).
- **Mapping:** Dead Code and Speculative Generality.
- **Found by:** Claude + Codex (fonts disputed).
- **Instances:**
  - Eight `@nulo/design` components with no consumer since the tools app left: `ui/Card.vue`, `ui/Tag.vue`, `ui/Toast.vue`, `composite/AddressDisplay.vue`, `BalanceRow.vue`, `DisclaimerTag.vue`, `DripButton.vue`, `EmojiGrid.vue`, plus their barrel lines.
  - `apps/extension/src/wallet/services/activity-protocol/` (317 lines, never registered; owner call).
  - `SettingValue.vue`, `Divider.vue`, and `SelectFpcPopup.vue` (mounted, never opened).
  - Test-only utils; dead `.cta` CSS in `change-password.vue:299-337` and `reset.vue:203-243`.
  - Five unreferenced font copies in `apps/extension/src/assets/fonts/`.
  - The ArtifactRegistry policy surface and a no-op PXE subscription.
- **Description:** These are leftovers from the tools/bridge move, the design externalization and never-wired scaffolding. `mount-all.test.ts` keeps them looking alive.
- **Trace:** The bugs run dropped three bug leads because they sit in this dead code (D-18, QB-13, QB-35).
- **Why it matters:** Readers reason about unreachable policy, and autocomplete offers the wrong `AddressDisplay`.
- **Recommended fix:** Remove the code with its tests, stories and barrel lines. Keep the extension-local `AddressDisplay`/`EmojiGrid`. Verify the font removal with a build and the notices generator.
- **Effort estimate:** 0.5–1 day, removing about 1,300 source lines, about 700 test lines and 756 KB of binaries. **Recurring:** 2026-08-16 Q-01, 2026-08-14 Q-11.

#### Q-27: Low-priority residue (14 valid local duplicates, fix when touched)

- **Impact:** Low (local; each two-site or dormant).
- **Confidence:** see the table (not independently verified).
- **Mapping:** Duplicate Code, local.
- **Found by:** mixed.
- **Instances:**

| Sub-id | Item | Where | Note |
|---|---|---|---|
| Q-27a | Discovery admission ladder ×2 | `apps/extension/src/wallet/services/wallet-sdk/background.ts:939-949, 1021-1031` | Security throttle path. |
| Q-27b | Auth-registry settlement workflow ×2 | `apps/extension/src/wallet/services/auth-registry/service.ts:281-321, 336-375` | Must consume the captured fence. |
| Q-27c | Identical `aztec_sendTx`/`send_transaction` cases | `apps/extension/src/popup/windows/execute/index.vue:331-365` | Stack the labels. |
| Q-27d | Config-toggle binding ×2 | `apps/extension/src/popup/pages/settings/appearance.vue:105-162`; `advanced/index.vue:108-157` | The bugs run's B-14(b) (Developer Mode cascade) lives in this code. |
| Q-27e | Profile-activation waiters ×2 | `apps/extension/src/composables/unlockWait.ts:33-61`; `waitForProfileActive.ts:30-47` | B-21's unbounded third waiter belongs to this family. |
| Q-27f | `normalizeProfileName` inlined ×5; malformed-row predicate ×3 | `EditProfilePopup.vue`; `utils/token-order.ts`, `token-amount.ts`, `token-aggregate.ts` | Trivial. |
| Q-27g | Mint/transfer vocabulary in 3–4 lists | `apps/extension/src/utils/token-transfer-vocabulary.ts`, `tx-amount.ts`, `tx-enrichment.ts` | Disputed; approval-card vocabulary is an owner UI call. |
| Q-27h | USD conversion ×2; rate-snap twins | `apps/extension/src/utils/fee-estimation.ts` against `wallet/services/price/convert.ts` | Disputed; `feeToUsd` keeps `<$0.001`. |
| Q-27i | AES-GCM frame ×3 | `packages/wallet-crypto/src/encryption-key.ts`, `imported-account-key-box.ts`, `imported-keys-dek-box.ts` | Byte-frozen. |
| Q-27j | Default-token addresses, two owners | `apps/extension/src/wallet/services/token/default-tokens.ts` against `price/price-map.ts` | Co-changed in `1d63ca40`. |
| Q-27k | Artifact catalog keys ×3 | `packages/aztec-runtime/src/pxe/artifact-catalog.ts:35-87` | Derive from the accessor table. |
| Q-27l | Public-event cursor comparator across packages | `packages/aztec-runtime/src/pxe/public-events.ts:192-197`; `incoming-transfer/public-event-indexer.ts:50-55` | Leaf module. |
| Q-27m | "Row matches live token" ×11 | `apps/extension/src/wallet/services/token-balance/service.ts` | Private `liveTokenFor(row)`. |
| Q-27n | Imported signing-key unseal and wipe ×2 | `apps/extension/src/wallet/services/account/service.ts:378-400, 425-446` | Helper owns the wipes. |

- **Description:** Each item is a real duplicate below the density bar.
- **Trace:** See the table.
- **Why it matters:** Individually small. Q-27d and Q-27e each host a bug the bugs run confirmed (B-14, B-21).
- **Recommended fix:** Fix opportunistically when the file is touched. Q-27d and Q-27e are worth doing alongside their bug fixes.
- **Effort estimate:** hours each.

## Findings NOT pursued (with reasoning)

- **Q-03(e), raw fail-closed marker stores:** both verifiers found the three instances do not justify a shared abstraction.
- **Q-07, `getRequestId` default in `useDappInteractionPayload`:** it would add a router dependency to a router-free composable to remove three one-line lambdas.
- **Q-07, generic approval runner:** discover stays loading after success, execute re-arms estimates, and the else-branch copy differs. Only the cancellation predicate is shared.
- **Q-08, keyframes in `@nulo/design` `base.css`:** the call sites are `<style module>` blocks (localized names), and `base.css` is hash-pinned and ships to the landing.
- **Q-17(d), password reveal skeleton ×5:** already adjudicated in `implementations-plan/profile-service-dedup/plan.md:29-39` and test-pinned.
- **Q-24(b), FeeSettingsCard mode split:** low confidence; only as an owner-visible plan.
- **q05-C-7, price client quartet per consumer:** the parent-owned client lifecycle is the documented convention. The cited "dispose before disconnect" rule is reversed in CLAUDE.md.
- **q09-C-7, scope-key stringifiers ×5:** the dimensions differ and nothing obliges them to change together.
- **q13-C-7, `0x`+64-hex regex ×6:** refuted. `usePinnedTokens.ts:38-39` lowercases first, and the set mixes different field kinds.
- **q11-C-10, init-nullifier check ×2:** cosmetic, 2 sites, frozen account surface.
- **q10-X-3, mnemonic/passkey master reduction tail ×2:** vector-frozen and dormant.
- **q02-C-3 (guard half), "live row" guard ×11:** the sites have different contracts (Codex). Only the degraded-open tail is kept (Q-17).
- **q02 id allocation / `getProfileInfo` against `toInfo`:** below threshold; the allocation semantics differ.
- **q03-C-5 (decimals and decode half):** deliberately different contracts; the hex counterexample is refuted.
- **q06 `prepareFpc` mirror:** unverified by its own author.
- **q08 Popover dead:** refuted; `apps/extension/src/components/JsonViewer/LogsToolbar.vue:36` uses it.
- **q08 AddressDisplay divergent change:** different responsibilities do not by themselves establish Divergent Change.
- **q05 mount connect choreography:** a bug lead, not a quality finding.
- **q01-C-1 "already drifted" sub-claim:** probe dedup deliberately includes attached hashes.
- **q12-C-2, DetailsTable and PermissionRow wrong in light theme:** refuted; both have light overrides.
- **q06-C-6 "five triple sites":** narrowed to three.
- **q08-C-8 CTA hover drift:** refuted; the later outline rule overrides it.
- **q11-C-2, journal cross-chain bug as a quality driver:** reachability unproven; kept as a bug lead (bugs D-17).

## Cross-cutting observations

1. **Drift is the argument for deduplication, and this run has the receipts.** Every place below is a duplicate that was fixed or extended on one side only. The bugs run reached the same conclusion from the other direction: its "sibling asymmetry" table lists six bugs where the guard exists on one twin and not the other. When a fix lands, grep for its twin.

   | Quality finding | Copy that drifted | Bugs-run outcome |
   |---|---|---|
   | Q-04 | `getNodeStatus` lacks `probeNodeStatus`'s local carve-out | **B-09** (Minor, kept) |
   | Q-05 | operation reuse ladder throws where the transfer ladder rejects | **B-08** (Minor, kept) |
   | Q-03 | `patchAccountField` skips the address check; `importAccount` skips the fence | **B-12** + security routing #1 |
   | Q-16 / Q-27e | profile creation spins on `isLogined` instead of `awaitProfileActivation` | **B-21** (Minor, kept) |
   | Q-27d | Developer Mode cascade in the duplicated toggle binding | **B-14(b)** (Minor, kept) |
   | Q-06 | History's `journalRows` ignores `networkId`; incoming profile guard only on Home | new lead; profile half dropped as hardening (D-14) |
   | Q-08 | `autocomplete="new-password"` missing on 2 of 4 forms | new lead |
   | Q-09 | contact-name check untrimmed, save trimmed | new lead |
   | Q-11 | batch ban omits `grantPublicAuthwit` | dropped as a bug (D-16), routed to security |
   | Q-12 | BalanceView lacks TokensView's add-dedupe | dropped, unreachable today (D-09) |

2. **Shared primitives exist, but adoption stalls.** This is the dominant root cause, behind 14 of the 27 findings. The bypassed helpers include:
   - `chainInfoFrom`, `walletChainId`, `networkInfoFrom`, `primaryEndpointUrl`
   - `probedFirstSimOpts`, `verifyArtifactClassId`
   - `toBase64`/`fromBase64`/`getRandomHex`, `sleep`
   - `createRunFence`, `Lock`/`KeyedLock`
   - `useEntityCrud`, `useDappHostname`, `awaitProfileActivation`, `restoreRows`
   - `ListStatusMessage`, `Skeleton`, `popup-shared.module.css`, `Button cta_outline`

   A grep-ratchet test in the style of `log-payload-ban.test.ts` would stop regrowth. Candidates:
   - `Buffer.from(…,"base64")`
   - `new Fr(nodeInfo.l1ChainId`
   - `^ … >>> 0`
   - `popupStore.len - popupStore.popups`
   - `@keyframes shakeInput`
   - `find((e) => e.id === …primaryEndpointId)`

3. **The duplication number is the wrong instrument, and the repo's baseline is stale.**
   - In production scope (extension and packages `src`, no tests or stories, min-tokens 50), jscpd reports **2.0%** duplicated lines: 3,745 of 186,580, in 203 clones. About half of the listed clone lines are CSS.
   - The repo-wide `bun run audit:dup` measured today reports **3.90%** of lines (16,321 of 418,821). About three-quarters of that (12,426 lines) is test-to-test duplication. The production share is inflated further by licence texts under `third-party-notices/texts/` (925 lines) and the html template tokenizer that CLAUDE.md already calls noise (1,558 lines).
   - The untracked `apps/tools` and `packages/bridge-core` directories now hold only `node_modules`, which the scan ignores, so they do not inflate it.
   - The baseline CLAUDE.md records (4.84%, 2026-09-01) predates the removal of the tools app and bridge packages on 2026-09-24 (#691). The fall to 3.90% is mostly that removal, not deduplication. Re-baseline before reading the trend.
   - The scan also ignores `**/*.css`, so duplication in standalone CSS modules (for example `list-empty.module.css` against `ListStatusMessage.vue`) is invisible to it.
   - Most important: jscpd cannot see this run's costliest items at all. Q-01, Q-02, Q-03, Q-04 and Q-16 are sub-50-token rules re-typed in different shapes.

4. **"Mirror" comments mark missing lowest-layer homes, and they rot.** Examples: `queued-journal.ts` ("Mirror of background.ts's chainInfoToChainId", now stale), `dispatcher.ts:181-183`, `discovery-probe.ts` ("byte-mirrors"), `scopeCovers` ("deliberately mirrors enforcement"), `transfer-estimate-reuse.ts` ("must reproduce the exact product"). `git grep -n -i mirror` is a productive next query: every hit in this run became a finding.

5. **Wrong-layer homes force duplication.** Examples: `withTimeout` in a Pinia store; `walletChainId` in extension `utils/`; `fingerprintBaseFee` in the transfer ladder; `NewProfileMethodTabs` at L4, where onboarding cannot import it. Most fixes above are Move Function to the lowest legal layer, not new abstractions.

6. **The design-system seam is half done.** L0–L2 moved to `@nulo/design`. The L3 shells (rows, cards, toolbar button, password field, empty state) and two token roles (hairline, scrim) did not, while the package carries eight dead components from the departed tools app. An "every barrel export has a production consumer" check would be the inverse of `boundary.test.ts`.

7. **God files concentrate the duplication and keep growing.**

   | File | Lines |
   |---|---|
   | `profile/service.ts` | 2,797 |
   | `incoming-transfer/service.ts` | 2,464 |
   | `dispatcher.ts` | 1,794 (+31% since 2026-08-16) |
   | `dapp-send-executor.ts` | 1,107 |
   | `FeeSettingsCard.vue` | 982 |

   Four of the five were named in 2026-08-16 Q-01. Extracting the duplicated scaffolds shrinks them more safely than a class split.

8. **Duplicated logic breeds duplicated tests.** BalanceView and TokensView pin the same scenarios, and each deadline copy has its own tests. Consolidation should move the scenario to the shared unit so it is proven once.

9. **Comment-rule violations surfaced incidentally.** CLAUDE.md bans milestone, phase and audit-round tags; these are not the permitted `AUDIT [A-Z]\d+` form:
   - `PopupManager.vue:154-155` ("P8 tactical C2 fix") and `:304` ("opus H-6")
   - `network/spec.ts:172` ("Codex Round 2 B-3")
   - `authwit-discoverer.ts:116` ("F-012 / A-01 V-01")
   - `aztec-node-factory-adapter.ts:12` ("F-011 / Phase 5")
