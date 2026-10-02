# Consolidated findings: harden quality, effort high, owner emphasis deduplication

Run: `audit/quality/2026-09-30-dedup-high`. Tree: `dev` at `910a4def`. Inputs: 26 raw cluster reports (13 clusters, one Claude and one Codex report each, each with cross-rebuttals), the repo maps, `raw/jscpd-production.md`, and the prior runs `2026-08-16-extension-mid` and `2026-08-14-dedup-mid`. Contested claims were settled against source. The coordinator re-verified these directly:

- chain-id formula sites
- `chainInfoFrom` bypass literals
- primary-endpoint lookups (15)
- `displaceIdx` computed (24 popups)
- shake keyframes (8 files)
- visibility toggles (5 files, 8 sites)
- record-guard definitions
- incoming-row profile-guard drift
- the dead `select_fpc` popup
- the unreferenced extension font copies
- the activity-protocol consumers
- the `@nulo/design` consumers in landing and playground
- `base.css` being hand-written rather than generated
- the complexity manifest having no `profile/service.ts` or `FeeSettingsCard.vue` acceptances
- the corrected `dapp-send-executor.ts` line numbers

## Scoring

Priority = scope × blast × frequency.

| Factor | Values |
|---|---|
| Scope | architectural 4, structural 3, local 2, cosmetic 1 |
| Blast (files holding instances) | 1–2 files = 1, 3–6 = 2, ≥7 = 3 |
| Frequency (upper-median commits since 2026-06-01 over those files) | ≤5 = 1, 6–15 = 2, ≥16 = 3 |

Frequency counts come from `git log --since=2026-06-01 --format=%h -- <file> \| wc -l`. The median is used rather than the max, so one hot file does not dominate. The max is shown for reference.

Priority buckets: **High** is ≥18, **Medium** is 8–17 and **Low** is ≤7. Within a bucket, findings are ordered by demonstrated drift on a security, privacy or identity invariant, then by cross-model agreement. Confidence is the coordinator's after rebuttal and source checks.

## Summary

| ID | Title | Priority | Scope | Blast (files) | Change-freq (median / max) | Found by | Confidence |
|---|---|---|---|---|---|---|---|
| Q-01 | Identity derivations (composite chain id, `ChainInfo`, SDK chain info, NO_FROM sender) re-implemented per layer | High (18) | structural | 15 | 7 / 31 | both | high |
| Q-02 | Execution entry points each re-implement security guards (authwit decode ×3, selector binding ×6) | High (18) | structural | 7 | 7 / 30 | both | high |
| Q-03 | Row-service lifecycle protocols (fenced write, scoped purge, restore preamble, row identity) composed by hand per service | High (18) | structural | 14 | 14 / 31 | both | high (parts d–e moderate) |
| Q-04 | Network endpoint rules (primary selection, identity guard, status probe, URL policy) re-derived outside the network module | High (18) | structural | 11 | 9 / 31 | both | high |
| Q-05 | Fee-estimation pipeline: strategy stages, fee composition and reuse validation copied | High (18) | structural | 10 | 9 / 27 | both (part c partly disputed) | high (a–b), moderate (c) |
| Q-06 | Activity feed: Home and History duplicate row building and card presentation (already drifted on the profile guard) | High (18) | structural | 9 | 6 / 20 | both | high |
| Q-07 | dApp approval windows re-implement hook-owned logic; verify bypasses the anti-phishing hostname helper | High (18) | structural | 8 | 6 / 19 | both | high (a–c), moderate (d) |
| Q-08 | Credential inputs: visibility toggle ×8, new-password pair ×4, shake keyframes ×8 | High (18) | structural | 11 | 6 / 17 | both | high |
| Q-09 | Keyed list reducers hand-rolled beside `useEntityCrud`; contact rules re-encoded | High (18) | structural | 10 | 6 / 19 | both | high |
| Q-10 | Transaction recording: 12-positional `addTransaction` plus duplicated dApp-send tails | Medium (12) | local | 3 | 17 / 27 | both | high |
| Q-11 | `dispatcher.ts` accretion: capability planning, popup-handler scaffold and routing facts outside the registry | Medium (12) | architectural | 2 | 29 / 29 | both | high |
| Q-12 | Balance snapshot state machine copied between TokensView and BalanceView (and partly SelectTokenPopup) | Medium (12) | structural | 3 | 12 / 17 | both | high |
| Q-13 | Popup key and stack-order arithmetic repeated in 24 popups; trust queue embedded in PopupManager | Medium (12) | local | 25 | 6 / 10 | claude (codex partial) | moderate |
| Q-14 | Onboarding and popup shells duplicate the import flow and the method tablist | Medium (12) | structural | 5 | 9 / 12 | both | high |
| Q-15 | Low-level primitives (base64/hex codecs, random hex, record guards) re-implemented instead of `@nulo/wallet-core/utils` | Medium (9) | structural | 20 | 4 / 29 | both (record-guard part disputed) | high (encoders), moderate (decoders, guards) |
| Q-16 | Async-coordination primitives hand-rolled: deadline race ×8, serial queue ×7, latest-wins counters ×10 | Medium (9) | structural | 23 | 3 / 17 | both | high (a), moderate (b–c) |
| Q-17 | ProfileService Large Class hosting duplicated credential-row and open scaffolds | Medium (9) | structural | 1 | 25 / 25 | both (part d disputed) | high (a–b), moderate (c), low (d) |
| Q-18 | incoming-transfer note and public arms duplicate the trust/commit pipeline and clear scaffolds | Medium (9) | structural | 2 | 22 / 22 | both | high |
| Q-19 | Grant matching duplicated between consent coverage and enforcement in wallet-bridge | Medium (9) | structural | 2 | 29 / 29 | both | high |
| Q-20 | `WalletError` reconstruction encoded in three parallel structures | Medium (9) | structural | 1 | 20 / 20 | claude (codex partial) | moderate |
| Q-21 | PXE legacy IndexedDB deletion wrapped ×3; keyval-store guard written twice | Medium (9) | structural | 1 | 25 / 25 | claude (codex partial) | moderate |
| Q-22 | Shared visual shells copied as CSS (rows, cards, toolbar button, detail pages, empty state, skeleton, popup body, disclosure, snack card, CTA) | Medium (9) | structural | 24 | 4 / 11 | both | high |
| Q-23 | Design-token layer: dark palette declared twice; hairline and scrim values hard-coded | Medium (9) | structural | 10 | 4 / 20 | both | high (a), moderate (b) |
| Q-24 | FeeSettingsCard: fee-scope identity predicates ×6 and a mode flag threading two selection models | Medium (9) | structural | 1 | 20 / 20 | claude (codex partial) | high (a), low (b) |
| Q-25 | Full-backup restore stages depend on UI-owned transforms through `never` casts | Medium (9) | structural | 2 | 31 / 31 | codex (claude agreed on facts) | high |
| Q-26 | Dead and speculative code left behind (design exports, activity-protocol, SettingValue, Divider, SelectFpcPopup, test-only utils, ArtifactRegistry policy, dead CSS, font copies) | Low (6) | local | 16+ | 4 / 11 | both (fonts disputed) | high |
| Q-27 | Low-priority residue: 14 valid local duplicates not promoted | Low | local | — | — | mixed | see table |

Totals: 9 High, 16 Medium, 2 Low. There are 27 numbered findings; Q-27 bundles 14 small items.

---

## High

### Q-01: Identity derivations re-implemented per layer (composite chain id, `ChainInfo`, SDK chain info, NO_FROM sender)

- **Smell:** Duplicate Code with Shotgun Surgery. There are also Misplaced Function problems: the named helper lives in the extension, while `aztec-runtime` needs it too.
- **Priority/scope/blast/frequency:** High (3×3×2 = 18). Structural. 15 files across aztec-runtime, wallet-bridge and the extension. Median 7, max 31 (`network/service.ts`), 30 (`execution/service.ts`), 29 (`dispatcher.ts`).
- **Found by:** both. `chainInfoToChainId` was found by both; the `chainInfoFrom` bypass, the formula in aztec-runtime and the sender normalization were Claude's, and Codex agreed or partially agreed in rebuttal. **Confidence:** high.
- **RECURRING?** No.
- **Instances:**
  - (a) Composite chain id `(l1ChainId ^ rollupVersion) >>> 0`. It is defined at `apps/extension/src/utils/chain-ids.ts:12-14` and re-inlined at:
    - `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:101`
    - `packages/aztec-runtime/src/utils/chain-identity.ts:59`
    - `apps/extension/src/wallet/services/network/service.ts:1010` (the file already imports `@/utils/chain-ids` and does not use it)
    - `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:16-21` (`chainInfoToChainId`, string or `Fr` decode)
    - `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:45-56`, a byte-identical private copy whose comment says it mirrors the other
  - (b) `ChainInfo` literal hand-written instead of `chainInfoFrom` (`packages/aztec-runtime/src/utils/chain-identity.ts:73-75`). All under `apps/extension/src/wallet/services/execution/`:
    - `authwit-discoverer.ts:119, 174-177, 224-227, 238-241`
    - `discovery-probe.ts:79`
    - `dapp-send-executor.ts:1005`
    - `view-executor.ts:213`
    - `fast-path.ts:227-230`
    - `service.ts:1020-1023`
    - `helpers/batched-view-simulation.ts:362-365` (the same file uses `chainInfoFrom` at `:204`)

    Five of these sit after the same unnamed `getNodeInfo()` + `assertLiveChainIdentity` clump: `authwit-discoverer.ts:115-118`, `view-executor.ts:207-213`, `fast-path.ts:217-230`, `service.ts:1017-1023`, `batched-view-simulation.ts:358-365`.
  - (c) NO_FROM sender normalization, three copies:
    - `packages/wallet-bridge/src/dispatcher.ts:185-193` (`requestedFromOf` and a private `isNoFromRequest`)
    - `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:84-89` (`extractSendFrom`, with the comment "Mirrors the dispatcher's normalization exactly")
    - `apps/extension/src/wallet/services/execution/utils/fee-detection.ts:18-20` (exported `isNoFromRequest`, with its own test)

    Session address sets: `dispatcher.ts:439-449` and `:1730-1736`, and `queued-journal.ts:143` (not chain-filtered; reachability disputed, see the incidental bugs).
- **Description:** Chain identity is the wallet's scoping and anti-drift anchor. The formula and the `ChainInfo` projection each have a named owner, yet 15 files re-derive them. Three comments ("mirrors", "inlined to keep test-harness-friendly") admit copies kept equal only by convention.
- **Why it harms change:** A change to the composite id (wider id, salt) or to `Fr`/string decoding must reach the probe (what gets stored), `assertLiveChainIdentity` (what gets compared), session establishment and journal admission together. A missed copy makes signing refuse every request, or binds a session or journal record to the wrong network. A new NO_FROM-like sentinel needs three edits across two packages.
- **Refactoring:** Move Function.
  - Put `walletChainId` and a `chainIdFromSdkChainInfo(chainInfo)` decoder in `packages/aztec-runtime/src/utils/chain-identity.ts`, exported via `@nulo/aztec-runtime/utils`. `apps/extension/src/utils/chain-ids.ts` re-exports it.
  - Extract `liveChainInfo(node, network)` there (fetch, assert, then `chainInfoFrom`) for the five fetch-and-assert sites. Use `chainInfoFrom(nodeInfo)` where `nodeInfo` is passed in (`authwit-discoverer.ts:174-241`).
  - Move `NO_FROM`, `requestedSenderOf(opts)` and a chain-filtered `sessionAddressesOf` into `packages/wallet-bridge/src/account-resolution.ts`, which already owns the resolution rule; the extension already depends on wallet-bridge.
  - Keep the dispatcher's raw+CAIP `sessionAccountsOf` distinct, as Codex asked.
  - The dependency direction is unchanged: the extension imports downward.
- **What disappears:** 5 formula copies become 1; 10 `ChainInfo` literals; 2 sender normalizers and one duplicate test; 3 "mirror" comments.
- **Effort:** about 1 day.
- **Source raw ids:** q01-C-2, q04-C-1, q04-X-5, q11-C-5, q11-C-2.

### Q-02: Execution entry points each re-implement security guards

- **Smell:** Duplicate Code leading to Shotgun Surgery; a security rule is maintained by convention across entry points.
- **Priority/scope/blast/frequency:** High (3×3×2 = 18). Structural. 7 files in `apps/extension/src/wallet/services/execution/`. Median 7, max 30 (`service.ts`), 27 (`dapp-send-executor.ts`).
- **Found by:** both. (a) was found by both. (b) was Codex's, and Claude agreed after re-reading all six sites. (c) is Claude-only and was not cross-checked by Codex. **Confidence:** high for (a–b), moderate for (c).
- **RECURRING?** No.
- **Instances** (under `apps/extension/src/wallet/services/execution/`):
  - (a) Offchain effects → live chain identity → `CallAuthorizationRequest.fromFields` → `computeAuthWitMessageHash` → record, skipping malformed effects:
    - `authwit-discoverer.ts:110-141`
    - `discovery-probe.ts:66-101` (header says it "byte-mirrors" the discoverer)
    - `dapp-send-executor.ts:1000-1019`
  - (b) The selector/name binding guard (missing ABI function, and `name !== fn.name` raising "Scope violation") at six sites:
    - `tx-request-builder.ts:340-348` and `:587-599`
    - `authwit-discoverer.ts:197-205`
    - `service.ts:1043-1051`
    - `view-executor.ts:367-373`
    - `fast-path.ts:135-140`, which requires the name and whose lookup sits in a `catch → fallback`
  - (c) The contract-class integrity guard (`getContractClassFromArtifact` compared against `currentContractClassId`) appears twice in `service.ts:834-837` and `:981-984`. The instance-to-artifact hop appears at `fast-path.ts:129-130` and `view-executor.ts:93-94, 365-366`.
- **Description:** Each execution path (standard, NO_FROM, view, fast path, create-authwit RPC, discovery probe) re-derives the same chain-bound decode loop and the same scope-binding rule. The shared helpers (`findFunctionBySelector`, `toDiscoveredAuthwit`) stop one step short.
- **Why it harms change:** An upstream change to authorization-effect encoding, a changed name-presence policy, or a cap on the dApp-controlled effect loop must land in 3 or 6 places. A missed path silently loses a guard. Because the surrounding code differs, text-clone search does not find the full set.
- **Refactoring:**
  - Extract Function `decode-authwit-effects.ts` in `execution/`, returning ordered `{ record, messageHash }` pairs with the injectable crypto seam. Probe deduplication and first-use state stay in the caller, as Codex asked.
  - Extract a synchronous `assertSelectorBinding(fn, { name, to, context, requireName })` into `execution/contract-resolver.ts`. The lookup awaits and the fast-path `catch` stay local, so lookup failures still fall back and binding failures still escape.
  - Extract `assertArtifactMatchesInstance` and `resolveArtifactForAddress` into the same resolver.
- **What disappears:** 2 decode loops (about 40 lines); 5 of 6 guard pairs, reduced to one validator with two name policies; 1 duplicated class-id guard.
- **Effort:** 1–2 days.
- **Source raw ids:** q01-C-1, q01-X-1, q01-X-3; q01 Claude "both missed" (class-id guard, artifact hop).

### Q-03: Row-service lifecycle protocols composed by hand per service

- **Smell:** Duplicate Code and Shotgun Surgery on security invariants (deletion fence, scope matching, restore epoch), plus incomplete adoption of `purge-rows.ts`, `restore-rows.ts`, `restore-fence.ts` and `require-owned-row.ts`.
- **Priority/scope/blast/frequency:** High (3×3×2 = 18). Structural; Claude argued architectural. 14 files under `apps/extension/src/wallet/services/`. Median 14, max 31.
- **Found by:** both.
  - (a) Claude; Codex agreed and rated it structural.
  - (b) Both.
  - (c) Config: both. The preamble: Claude, with Codex partial.
  - (d) Claude; Codex agreed narrowly.
  - (e) Claude; Codex accepted only a narrow scan helper. **Cross-model disagreement** on (e).
- **Confidence:** high for (a–c), moderate for (d–e).
- **RECURRING?** Yes: 2026-08-16 Q-07 (restore loops, adoption stalled; the config instance remains) and Q-09 (N-way row-service method families).
- **Instances** (under `apps/extension/src/wallet/services/`):
  - (a) Fenced commit: `assertCurrent` → write → `isCurrent` re-check → compensate → throw `` `profile ${id} deleted` ``.
    - `fpc/service.ts:230-238` and `:293-302`
    - `contact/service.ts:116-123`
    - `dapp-session/service.ts:203-210`
    - `network/service.ts:325-330` and `:494-499`
    - `token/service.ts:413-422`. Its post-write network leg and final authority check at `:428-432` stay local.
  - (b) Scoped purge pipelines.
    - `auth-registry/service.ts` has three: `:505-535` (accounts), `:538-553` (profile) and `:557-573` (chain). Each repeats a typed → raw → status predicate triple.
    - `token-balance/service.ts:546-561` (`purgeForTokens`) and `:574-601` (`purgeForAccounts`) repeat the locked typed sweep, the identity-gated delete event and the malformed-row sweep.
    - The scope key `` `${chainId}:${address}` `` is templated inline at `token-balance/service.ts:577, 581, 598` and `auth-registry/service.ts:515, 518, 533, 536`.
    - The scope tuple is typed inline at `token-balance/service.ts:147, 574` and `auth-registry/service.ts:107, 512`.
    - Excluded: `transaction/service.ts:301-316` has different `soleOwner` semantics.
  - (c) Restore preamble.
    - The profile-id guard plus `captureRestoreEpochs` is repeated at `token-balance/service.ts:676-685`, `auth-registry/service.ts:589-597` and `transaction/service.ts:529-538`.
    - A hostile-row cast is repeated at `contact/service.ts:287-290`, `account/service.ts:674-677, 766-769` and `token/service.ts:858-861`.
    - `config/service.ts:62-84` still hand-rolls the `restoreRows` loop (`restore-rows.ts:22-34`).
  - (d) Row identity gate ("row body matches key on profileId, chainId and address"):
    - `account/service.ts:180`, `:339-341` and `:408-411`
    - `account/imported-keys-repository.ts:29-30`
    - **Drifted:** `account/service.ts:322`, where `patchAccountField` checks only profileId and chainId.
  - (e) Raw fail-closed marker stores:
    - `profile/tombstone-repository.ts:38-93` (enumeration at `:72-91`)
    - `profile/restore-pending-repository.ts:44-93` (`:77-91`)
    - `account-integrity/blocked-repository.ts:19-70`
- **Description:** The row-service helper layer extracts single steps (`purgeRows`, `purgeMalformedRows`, `restoreRows`, `captureRestoreEpochs`). The composed protocols around those steps are still re-typed per service, including their security comments ("a bare-address match would destroy a sibling profile's rows").
- **Why it harms change:** Consider a typed `ProfileDeletedError`, a network-id scope dimension, or a new store in a purge. Each touches 5–9 sites. The easy-to-forget raw-row predicate or post-write re-check reintroduces the orphaned-row or cross-profile deletion bugs this code exists to prevent. (d) has already drifted into a latent overwrite bug.
- **Refactoring** (next to `purge-rows.ts`, `restore-rows.ts` and `restore-fence.ts` in `apps/extension/src/wallet/services/`):
  - `fencedSet(storage, deletion, fence, id, row, { networkLive? })` throwing one typed error. Start with the two `fpc` sites.
  - A private `purgeMatchingLocked({ typed, raw, status })` per service. Keep the three predicates separate, as Codex asked, because the raw one has `typeof` guards.
  - An `AccountScope` type and `accountScopeKey()` exported from the account contract.
  - `requireRestoreProfileId()` and `captureRestoreEpochsForRows()` in `restore-fence.ts`.
  - `config.restore` becomes `restoreRows(allowlisted, …)`.
  - `rowMatchesKey()` in `account/spec.ts`.
  - Optionally, a `scanRawMarkers(storage, root, schema)` helper beside `apps/extension/src/wallet/utils/raw-row.ts`.
- **What disappears:** 7 fence sequences and a scattered error literal; 3 purge pipelines to 1 per service; about 9 scope templates; 3 guard blocks and 4 casts; the last hand-rolled restore loop; the `patchAccountField` drift.
- **Effort:** 2–3 days, as one PR per owning service.
- **Source raw ids:** q01-C-6, q02-C-4, q02-C-5 (identity half), q02-C-6, q02-X-2, q03-C-2, q03-X-3, q03 Claude "both missed" (`AccountScope`), q04-C-4, q04-X-4.

### Q-04: Network endpoint rules re-derived outside the network module

- **Smell:** Duplicate Code and Feature Envy. Callers reach into `Network.endpoints`/`primaryEndpointId`, and the no-primary handling diverges: `!`, `?? endpoints[0]`, a throw, `?.`, or a silent skip.
- **Priority/scope/blast/frequency:** High (3×3×2 = 18). Structural. 11 files, including 2 popups and 1 aztec-runtime adapter. Median 9, max 31.
- **Found by:** both.
  - (c) Both.
  - (a–b) Claude; Codex partial, keeping the deliberate fallback at `:423`.
  - (d) Codex; Claude agreed.
  - (e) Codex; Claude agreed.
- **Confidence:** high.
- **RECURRING?** Yes, for part (c): 2026-08-16 Q-09.
- **Instances:**
  - (a) Primary-endpoint lookup, 15 copies:
    - `apps/extension/src/wallet/services/network/service.ts:348` (`!`), `:423` (`?? endpoints[0]`, deliberate), `:581`, `:731`, `:747`, `:769`, `:846`
    - `apps/extension/src/wallet/services/network/spec.ts:93`, `:107`
    - `apps/extension/src/wallet/services/execution/transfer-executor.ts:377`
    - `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:470`
    - `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:141`
    - `apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:181`
    - `apps/extension/src/wallet/services/incoming-transfer/service.ts:536`
    - `apps/extension/src/popup/components/popups/EditNetworkPopup.vue:58`

    `getNetworkInfo` (`network/service.ts:844-851`) has the same body as `networkInfoFrom` (`network/spec.ts:92-96`); this is jscpd's 31-line row.
  - (b) `getNodeStatus` (`network/service.ts:728-742`) and `probeNodeStatus` (`:744-760`) share one skeleton. They have **already drifted**: `:734` omits the local-kind override that `:753` applies (see the incidental bugs).
  - (c) `addEndpoint`/`updateEndpoint` duplicate the identity guard (`network/service.ts:603-615` and `:650-661`, jscpd 22 lines), plus the peek, probe-outside-lock and locked re-read preamble (`:592-629`, `:632-682`), `normalizeRpcUrl` and the `label?.trim()` handling.
  - (d) The RPC transport allowlist (https, http only for loopback) has two owners: `apps/extension/src/wallet/services/network/spec.ts:151-178` and `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58-73`. Only the schema rejects userinfo (`spec.ts:166`).
  - (e) The popup error classifier for the same service errors is written twice: `apps/extension/src/popup/components/popups/NewEndpointPopup.vue:54-63` and `EditEndpointPopup.vue:69-78`.
- **Description:** The network module owns endpoint identity and selection, but its rules are restated by consumers across execution, incoming-transfer, popups and aztec-runtime.
- **Why it harms change:** A primary-selection rule such as failover needs about 15 edits, and the `!`-asserting copies throw on shapes the lenient ones tolerate. The L1-equality guard protects key derivation; a fix can land in one mutation path only. A transport-policy change (a new loopback form) must be copied across a package boundary. The status-probe drift is a live defect already.
- **Refactoring:**
  - `findPrimaryEndpoint(network)` and `requirePrimaryEndpoint(network)` in `network/spec.ts`. Callers keep their explicit missing-primary policy. `getNetworkInfo` returns `networkInfoFrom(network)`.
  - `private statusFor(network, probe)` so both status paths apply the local-kind carve-out.
  - `assertSameChainIdentity(probed, network)` plus an unlocked probe helper; keep the lock boundaries and error order.
  - `isAllowedRpcTransport(url)` in `packages/wallet-core/src/utils/rpc-url.ts`, used by both. Userinfo rejection stays schema-only, or is added to the adapter with owner sign-off.
  - `endpointErrorMessage(err, chainId, duplicateCopy)` in `popup/components/popups/endpoint-error.ts`.
  - Delete the audit-round tag comment at `network/spec.ts:~166` ("Codex Round 2 B-3"), which CLAUDE.md bans.
- **What disappears:** about 13 lookups, 1 duplicated function body, 1 status skeleton and its drift, 1 identity-guard copy and its comment, 1 transport decision tree, and 1 popup ladder.
- **Effort:** 1–2 days.
- **Source raw ids:** q04-C-2, q04-C-3, q04-X-1, q04-X-2, q04 Claude "both missed" (status-method drift), q06-X-3.

### Q-05: Fee-estimation pipeline: strategy stages, fee composition and reuse validation copied

- **Smell:** Duplicate Code and a missing Form Template Method in the strategies. Data Clumps and Shotgun Surgery between the estimate producers and the reuse validators.
- **Priority/scope/blast/frequency:** High (3×3×2 = 18). Structural. 10 files in `apps/extension/src/wallet/services/execution/`. Median 9, max 27.
- **Found by:** both.
  - (a) Both.
  - (b) Claude; Codex partial ("extract only the shared default composition").
  - (c) Claude. Codex rejected the TTL premise and rejected folding the fee-fetch `try/catch` into a shared helper, because that changes operation-ladder behaviour. It accepted shared handle resolution. **Cross-model disagreement** on the scope of (c).
- **Confidence:** high for (a–b), moderate for (c).
- **RECURRING?** Yes: 2026-08-16 Q-10 (estimate-reuse ladders). The cache and pending-set half was fixed; the validation half was not.
- **Instances** (under `apps/extension/src/wallet/services/execution/`):
  - (a) Strategy stages:
    - The task start/complete/fail wrapper, five times: `fee/fee-juice-strategy.ts:25-74`, `fee/fee-juice-with-claim-strategy.ts:79-102`, `fee/embedded-strategy.ts:32-51`, `fee/fpc-strategy.ts:136-201` and `:207-306`.
    - The folded-probe discovery and re-simulation, three times: `fee/fee-juice-strategy.ts:33-58`, `fee/fpc-strategy.ts:153-176` and `:221-258`. The rebuild predicate deliberately differs.
    - The FPC finalize tail, twice: `fee/fpc-strategy.ts:177-200` and `:283-302` (jscpd 25 lines).
    - The validated re-simulation option literal, seven times: `fee-juice-strategy.ts:54`, `fee-juice-with-claim-strategy.ts:93`, `embedded-strategy.ts:42`, `fpc-strategy.ts:172, 254, 280`, and `fee/fee-strategy.ts:170`.
  - (b) Fee composition `predictedWorstMinFees(node).mul(multiplier)`:
    - `fee/fee-strategy.ts:286-290`, `fee/fpc-strategy.ts:177` and `:261`, `operation-estimate-reuse.ts:160-161`, `transfer-estimate-reuse.ts:195-202` (re-wraps `GasFees` and says it must "reproduce the exact product").
    - The multiplier ternary: `operation-estimate-reuse.ts:160`, `transfer-estimate-reuse.ts:198-200`.
    - Default multiplier: `service.ts:1103`, `fee/fpc-strategy.ts:135, 206`.
  - (c) Reuse producer and validator:
    - Snapshot producers: `transfer-executor.ts:343-430` and `dapp-send-executor.ts:440-520` (endpoint find, base-fee fingerprint, pending hashes, profile id).
    - Validators: `transfer-estimate-reuse.ts:148-216` and `operation-estimate-reuse.ts:108-175`.
    - `fingerprintBaseFee` lives in `transfer-estimate-reuse.ts:44` and is imported by the operation ladder and `dapp-send-executor.ts:57`; that is the wrong home.
    - Live-handle re-resolution: `transfer-executor.ts:298-316` and `dapp-send-executor.ts:796-819`.
    - **Divergence:** the operation ladder lets a fee-fetch error escape (`operation-estimate-reuse.ts:169-175`), while the transfer ladder rejects softly (`transfer-estimate-reuse.ts:205-208`).
- **Description:** Fee estimation is polymorphic (`FeeStrategy`), but the shared skeleton was not hoisted. The builders and the two reuse ladders each recompute the fee basis they later compare by fingerprint.
- **Why it harms change:** A new fold rule, abort checkpoint or payment kind means editing three strategy blocks kept in "byte parity" by comment. A change to the fee basis or rounding must be applied identically to the builder and both drift checks. A mismatch does not fail loudly: it permanently rejects reuse as "base fee drift". Adding a sixth snapshot fact means editing two producers and two validators.
- **Refactoring:**
  - In `fee/fee-strategy.ts`: `withEstimateTask`, which preserves the fast path completing before the two-pass fallback (Codex); `foldProbedSim(ctx, built, simulated, { rebuildWhen })`; `validatedSimOpts(built)`; and a private `commitFpcEstimate` in `FpcStrategy`.
  - `committedMaxFees(node, multiplier)` in `packages/aztec-runtime/src/fee-juice.ts` beside `predictedWorstMinFees`, and `resolveFeeMultiplier(priority?)` beside `DEFAULT_FEE_MULTIPLIER`.
  - Move `fingerprintBaseFee` and a `captureReuseSnapshot` into `estimate-reuse-shared.ts`.
  - `resolveLiveHandles` beside `fenceChecks` in `execution-coordinator.ts`.
  - Each ladder keeps its own step order and error policy. Whether the operation ladder should reject softly is a bugs-run decision, not a refactor side effect.
- **What disappears:** about 100 strategy lines, 5 try/catch wrappers, 7 option literals, 5 fee compositions, 3 multiplier ternaries, 1 wrong-home export, and the duplicated snapshot producer.
- **Effort:** 2–3 days.
- **Source raw ids:** q01-C-3, q01-X-2, q01-C-5, q01-C-4 (snapshot half), q11-C-6.

### Q-06: Activity feed: Home and History duplicate row building and card presentation

- **Smell:** Duplicate Code with Shotgun Surgery; Switch Statements expressed as Vue branch ladders. **Drift already present on a privacy guard.**
- **Priority/scope/blast/frequency:** High (3×3×2 = 18). Structural. 9 files. Median 6, max 20 (`RecentActivityView.vue`).
- **Found by:** both.
  - (a) Both.
  - (b) Claude; Codex partial.
  - (c) Codex; Claude partial. Claude prefers a route helper over an `ActivityRow` component: **cross-model disagreement** on the fix only.
  - (d) Codex; Claude agreed.
- **Confidence:** high.
- **RECURRING?** Partly. `journal-state.ts:310-316` records that the terminal-card fields were merged once already, and the duplication has regrown.
- **Instances:**
  - (a) Row builders:
    - `txRows` at `apps/extension/src/utils/activity-rows.ts:79-88` against `scopedTxRows` at `apps/extension/src/popup/components/modules/general/recent-activity-rows.ts:54-64`.
    - `incomingRows` at `activity-rows.ts:104-121` against `tokenScopedIncomingRows` at `recent-activity-rows.ts:66-82`, including the same 6-line `blockTimestamp` sort-key comment.
    - **Drift:** only Home applies `isForeignProfile` to incoming rows (`recent-activity-rows.ts:73`, verified). The inline copy of that predicate also appears at `apps/extension/src/popup/components/modules/general/TokensView.vue:66` and `RecentActivityView.vue:270`.
  - (b) In-flight card fields:
    - `RecentActivityView.vue:337-395` (`cardTitleFor`, `cardIconFor`, `cardAmountFor`, …) and the orphan computeds `:156-194`, against `transferCardFields`/`dappCardFields` in `apps/extension/src/utils/journal-state.ts:358-420`.
    - The two gate the amount differently (`""` raw renders `0` versus nothing). Symbol independence is deliberate: `RecentActivityView.vue:378-381` against `journal-state.ts:380-382`.
  - (c) Row dispatch ladder:
    - `RecentActivityView.vue:852-865`, plus route strings at `:240-242` and `:394-403`.
    - `apps/extension/src/popup/components/modules/activity/TransactionsList.vue:62-75`, plus `:44-51`.
  - (d) Title separator and chip CSS, four copies:
    - `apps/extension/src/components/composite/activity/TransactionAwaitingCard.vue:130-152`
    - `TransactionTerminalCard.vue:84-105`
    - `TransactionIncomingCard.vue:77-95`
    - `apps/extension/src/popup/components/modules/activity/TransactionCard.vue:198-215`
- **Description:** Two surfaces show the same records. Each owns a copy of the scope rules, the card-field projection, the dispatch/route mapping and the chip styling.
- **Why it harms change:** A new scope dimension, sort rule, card field or route lands on one surface and the other disagrees silently. For the profile guard that has already happened on incoming rows.
- **Refactoring:**
  - Export `txInScope`, `incomingInScope` (with the profile guard), `incomingSortKey` and the tx row builder from `apps/extension/src/utils/activity-rows.ts`. Home keeps its token filter and journal prefiltering.
  - Export `buildJournalCardFields(op, ctx)` from `journal-state.ts`, with an explicit symbol policy.
  - Add a route helper at minimum; optionally an L4 `ActivityRow.vue` in `popup/components/modules/activity/`.
  - Add `activity-chip.module.css` in `components/composite/activity/`.
  - This must be pixel-identical, with a screenshot, per the owner UI rule.
- **What disappears:** about 30 builder lines and a comment block; 6 `cardXFor` functions; 1 dispatch ladder; about 45 CSS lines; the profile-guard drift.
- **Effort:** 1–2 days.
- **Source raw ids:** q05-C-2, q05-C-3, q05-X-2, q09-C-2, q09-X-2, q08-X-3, q05 Claude "both missed" (inline profile predicate).

### Q-07: dApp approval windows re-implement hook-owned logic; verify bypasses the anti-phishing hostname helper

- **Smell:** Duplicate Code (a shared helper exists and the outlier bypasses it). Shotgun Surgery on failure semantics.
- **Priority/scope/blast/frequency:** High (3×3×2 = 18). Structural. 8 files. Median 6, max 19 (`execute/index.vue`).
- **Found by:** both.
  - (a) Found by three reports: q06 Claude, q06 Codex and q09 Codex.
  - (b–c) Claude; Codex agreed these are "reasonable small extractions".
  - (d) Claude; Codex partial (extract classification only).
- **Confidence:** high for (a–c), moderate for (d).
- **RECURRING?** No.
- **Instances:**
  - (a) Hostname and IDN/punycode detector: `apps/extension/src/popup/windows/verify/index.vue:52-67` against `apps/extension/src/composables/useDappHostname.ts:8-27`. The other windows use the composable: `discover/index.vue:53`, `capabilities/index.vue:121`, `execute/index.vue:134`.
  - (b) `chrome.windows.getCurrent → remove` appears four times:
    - `verify/index.vue:77-83`
    - `apps/extension/src/popup/windows/json/index.vue:16-21`
    - `apps/extension/src/popup/windows/logger/index.vue:12-17`
    - `apps/extension/src/composables/useDappApprovalWindow.ts:88-92`
  - (c) Wait for `isSessionChecked`: `verify/index.vue:118-133` against `useDappApprovalWindow.ts:102-115`.
  - (d) Approve-catch, reject and init-catch tails (`JobCancelledError` → cancelled overlay, else "Something went wrong"):
    - `apps/extension/src/popup/windows/discover/index.vue:88-90, 108-117, 121-125`
    - `capabilities/index.vue:~180, 326-337, 344-348`
    - `execute/index.vue:~290, 523-534, 539-548`

    The `getRequestId` router lambda is at `discover:47`, `capabilities:115` and `execute:128` (jscpd 22 and 20 lines).
- **Description:** The approval-window hook took over the lifecycle, but the verify window and the failure and cancel semantics stayed outside it.
- **Why it harms change:** Hardening the hostname check (mixed-script or confusables) reaches three windows and skips the trust-confirmation screen. A new terminal state (for example, session expired) needs three edits, and a missed one shows an error banner instead of the cancelled overlay. A Firefox window-API quirk needs four fixes.
- **Refactoring:**
  - Call `useDappHostname(dapp)` in verify, keeping the local aliases.
  - `closeCurrentWindow()` in `apps/extension/src/utils/`.
  - `whenSessionChecked(appStore)` as a C0 helper.
  - Export `classifyApprovalFailure(err)` from `useDappApprovalWindow`. Do **not** add a generic runner: discover stays loading after success, and execute re-arms estimates before classifying (Codex).
  - Make `getRequestId` a default in `useDappInteractionPayload`.
- **What disappears:** 1 security-predicate copy (about 15 lines), 3 close blocks, 1 wait, 3 classification ladders, and 3 router lambdas.
- **Effort:** 0.5–1 day.
- **Source raw ids:** q06-C-4, q06-C-5, q06-X-2, q09-X-3.

### Q-08: Credential inputs: visibility toggle ×8, new-password pair ×4, shake keyframes ×8

- **Smell:** Duplicate Code; missing Extract Component. Shotgun Surgery on an owner-accepted a11y policy.
- **Priority/scope/blast/frequency:** High (3×3×2 = 18). Structural. 11 files. Median 6, max 17.
- **Found by:** both. Codex first dismissed the shake keyframes, then conceded seven identical copies. The new-password pair is Codex's; Claude agreed. **Confidence:** high.
- **RECURRING?** No.
- **Instances:**
  - (a) Visibility toggle: a `<button tabindex="-1" :aria-label="…Show/Hide…">` with a `visibility`/`visibility_off` icon, 8 sites in 5 files. The CSS is in the same 5 files.
    - `apps/extension/src/components/composite/import/ImportSecretForm.vue:41-55, 77-91` (CSS `:145-153`)
    - `apps/extension/src/components/composite/import/ImportFullBackupForm.vue:112-126, 140-154` (CSS `:189-197`)
    - `apps/extension/src/popup/components/modules/settings/new-profile/NewProfileCredentials.vue:24-42` (CSS `:80`)
    - `apps/extension/src/popup/pages/auth.vue:255-276` (CSS `:392-402`)
    - `apps/extension/src/popup/pages/settings/security/change-password.vue:128-145, 170-185` (CSS `:266-274`)
  - (b) New-password plus confirmation pair: `ImportSecretForm.vue:66-108`, `ImportFullBackupForm.vue:130-173`, `NewProfileCredentials.vue:18-59` and `change-password.vue:158-202`.
  - (c) `@keyframes shakeInput` and `.shake`:
    - `apps/extension/src/components/composite/SecretUnlockSection.vue:65-72`
    - `apps/extension/src/onboarding/components/OnboardingProfileNameField.vue:45-52`
    - `apps/extension/src/popup/pages/auth.vue:439`
    - `apps/extension/src/popup/pages/import.vue:352`
    - `apps/extension/src/popup/pages/profile/new.vue:180`
    - `apps/extension/src/popup/pages/settings/security/change-password.vue:288`
    - `apps/extension/src/popup/pages/settings/security/export/full.vue:723`
    - A variant with different steps: `apps/extension/src/popup/components/popups/NewSenderPopup.vue:175-191`.

    The duration is 0.3s in 4 files and 0.4s in 3.
- **Description:** The most security-sensitive screens hand-roll the same credential control. CLAUDE.md records `tabindex="-1"` on the toggle as a deliberate owner-accepted WCAG trade-off; today that policy is "enforced" only by eight copies agreeing.
- **Why it harms change:** Revisiting that trade-off, adding `aria-pressed`, or adding `prefers-reduced-motion` to the shake means 8–11 edits on wallet-critical screens.
- **Refactoring:**
  - L3 `PasswordVisibilityToggle.vue` in `components/composite/`, with a controllable `v-model:visible`, because `NewProfileCredentials` and change-password share visibility across fields (Codex).
  - Then `NewPasswordFields.vue` for the pair.
  - Move the shake keyframes into `@nulo/design` `base.css` with a reduced-motion guard. `base.css` is hand-written; `utilities.css` is generated and drift-pinned, so not there.
  - No visual change is intended; attach a screenshot.
- **What disappears:** 7 toggle refs and markup blocks, 5 CSS rules, 3 extra field pairs, and 7 keyframe blocks: about 200 lines.
- **Effort:** about 1 day.
- **Source raw ids:** q07-C-4, q08-C-3, q08-C-4, q08-X-1.

### Q-09: Keyed list reducers hand-rolled beside `useEntityCrud`; contact rules re-encoded

- **Smell:** Duplicate Code (incomplete adoption of an existing extraction). The contact uniqueness rule is a Shotgun Surgery candidate, with a magic string used as a flag.
- **Priority/scope/blast/frequency:** High (3×3×2 = 18). Structural. 10 files. Median 6, max 19 (`send.vue`).
- **Found by:** both. (a) Both, in three reports. (b) Claude; Codex partial: Import has different acceptance semantics and the Send instance is unsupported. **Confidence:** high.
- **RECURRING?** Yes: 2026-08-16 Q-07, the UI list-update half. The Enter-key half is fixed.
- **Instances:**
  - (a) Add / upsert / remove reducers:
    - `apps/extension/src/popup/components/popups/NewContactPopup.vue:29-51`
    - `apps/extension/src/popup/components/popups/EditContactPopup.vue:29-62` (jscpd 35 lines against NewContact; 27 against `send.vue`)
    - `apps/extension/src/popup/components/popups/ImportContactsPopup.vue:30-49`
    - `apps/extension/src/popup/pages/send.vue:192-212`
    - `apps/extension/src/popup/components/popups/NewFpcPopup.vue:89-99` (+ `:106-108`)
    - `apps/extension/src/popup/components/popups/EditFpcPopup.vue:136-153`
    - `apps/extension/src/popup/components/popups/SelectProfilePopup.vue:77-91`
    - `apps/extension/src/popup/components/popups/SelectTokenPopup.vue:77-89`
    - `apps/extension/src/popup/pages/settings/connected-apps/index.vue:54-73`
    - (`SelectFpcPopup.vue:81-91` too, but that popup is dead; see Q-26)

    Shared implementation: `apps/extension/src/composables/useEntityCrud.ts:104-140`. **Divergence:** the composable deduplicates repeated adds, while the copies append unconditionally.
  - (b) Contact uniqueness, lowercasing and submit gate:
    - `NewContactPopup.vue:53-99` and `EditContactPopup.vue:66-126`, differing only by `excludeId`. The `"Already exist"` string is used as a flag at `New:94-99` and `Edit:121-126`.
    - The Map form in `ImportContactsPopup.vue:94-117` deliberately deselects only when both name and address collide (`:128`).
    - Canonical lowercase writes: `EditContactPopup.vue:144, 153`.
- **Description:** Ten owners reconcile service events into lists by hand. The contact identity rule lives in three differently shaped implementations.
- **Why it harms change:** Changing replay or identity handling touches ten files, and the helper's dedup fix never reached the copies. Normalizing addresses differently (for example 0x-stripped or checksummed) takes three edits, one of which (the Map form) cannot be found by grepping the other two.
- **Refactoring:**
  - Extract `apps/extension/src/utils/entity-list.ts` (`upsertById`, `replaceById`, `removeById`) and consume it from `useEntityCrud` and the consumers, with explicit append, upsert and replace-only policies. Both models endorse this over adopting `useEntityCrud` wholesale: its `dispose()` is permanent (`useEntityCrud.ts:148-153`), so show/hide popups cannot use it.
  - Add `findConflictingContact(contacts, { name, address }, excludeId)` and `canonicalContactAddress()` in `apps/extension/src/utils/`; each form keeps its own acceptance rule. Replace the string flag with a typed result.
- **What disappears:** about 40–50 reducer lines across ten files; about 60 validator lines; the magic string.
- **Effort:** about 1 day.
- **Source raw ids:** q06-C-1, q06-C-2, q06-X-1, q07-C-7, q07-X-1.

---

## Medium

### Q-10: Transaction recording: 12-positional `addTransaction` plus duplicated dApp-send tails

- **Smell:** Long Parameter List and Data Clumps. The positional order leaks into indexed types. Duplicate Code inside one 1,107-line executor.
- **Priority/scope/blast/frequency:** Medium (2×2×3 = 12). Local. 3 files. Median 17, max 27.
- **Found by:** both. Codex split the Long Parameter List out of Claude's broader item. **Confidence:** high.
- **RECURRING?** No.
- **Instances:**
  - The declaration: `apps/extension/src/wallet/services/transaction/service.ts:155-170`.
  - Producers: `apps/extension/src/wallet/services/execution/transfer-executor.ts:182-214` and `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:528-541` and `:919-932`. The NO_FROM producer re-spells `sentTxRecorder`, differing only in the nonce, the payment method and the authwit write.
  - `AddTransactionArgs[0|3|5|11]` projections: `dapp-send-executor.ts:125-138`.
  - Tails:
    - The `getCalls` thunk: `dapp-send-executor.ts:677-683` against `:874-880`.
    - `wantOffchainOutput`: `:736-739` against `:914-917`.
    - The `NO_WAIT` return tail: `:754` against `:935` (jscpd 22 and 23 lines).
    - `checkCancelled` closures: `:255, :295, :369` and `transfer-executor.ts:350-352`.

    Claude's original line numbers were wrong; these are verified.
- **Description:** One recording request travels as 12 positional arguments, several of them same-typed strings. The two dApp-send pipelines repeat their output and return tails.
- **Why it harms change:** Reordering same-typed fields still type-checks. A new `SendReturn` field or recording field means synchronized edits in three producers and the indexed types.
- **Refactoring:**
  - Introduce Parameter Object in `transaction/spec.ts`, with `Pick`-based `SentTx`.
  - A `sentTxRecorder` variant `{ nonce, feePaymentMethod, recordAuthwits }` for NO_FROM.
  - Module-level `primaryMethodCalls`, `extractOffchainOutputFrom` and `sendReturnTail` in `dapp-send-executor.ts`.
  - `throwIfAborted(signal)` in `execution/rpc-cancel.ts`.
- **What disappears:** the 12-position contract, 4 numeric projections, about 40 lines of tails, and 4 closures.
- **Effort:** 0.5–1 day.
- **Source raw ids:** q01-X-4, q01-C-4 (pipeline half).

### Q-11: `dispatcher.ts` accretion: capability planning, popup-handler scaffold and routing facts outside the registry

- **Smell:** Divergent Change and Large module. Duplicate Code in the popup handlers. Switch Statements: a routing if-ladder next to a registry. Middle Man: `unwrapResult`.
- **Priority/scope/blast/frequency:** Medium (4×1×3 = 12). Architectural: it is the single dApp RPC ingress. 2 files. 29 commits since June; 1,794 lines, up 31% from 1,368 at 2026-08-16.
- **Found by:** both. The module split was found by both. The handler scaffold is Claude's; Codex partial (extract narrowly). **Confidence:** high.
- **RECURRING?** Yes: 2026-08-16 Q-01 (dispatcher bullet; `CapabilityConsentCoordinator` never extracted) and its "popup routing paths repeating a 5-step scaffold" sub-point.
- **Instances** (`packages/wallet-bridge/src/dispatcher.ts` unless noted):
  - The pure capability-planning block: `:185-760` (coverage, projectors, `computeCapabilityDelta`, `mergeGrantsAndRejections`, `consentDecision`, …).
  - Routing ladder: `:915-975`.
  - The hard-coded batch ban: `:1072-1090`. It is **stale**: it omits the popup-gated `grantPublicAuthwit` (see Routed to security).
  - Handlers: `handleSendTx` `:1105-1148`, `handleCreateAuthWit` popup leg `:1158-1206`, `handleRegisterToken` `:1228-1252`, `handleGrantPublicAuthwit` `:1263-1305`.
  - `unwrapResult`: `:1790-1792`.
  - Registry prose notes in `packages/wallet-bridge/src/method-descriptors.ts` duplicate the routing facts.
- **Description:** Permission policy and execution orchestration share one hotspot. Which methods are popup-gated is stated in three places.
- **Why it harms change:** Every consent or widening fix, which is most of the file's log, lands in the same review and merge surface as routing and handler edits. A new popup method adds a fifth scaffold plus ladder and ban-list edits; the ban list is already out of date.
- **Refactoring:**
  - Move Function: put the pure block in `packages/wallet-bridge/src/capability-negotiation.ts` (no behaviour change).
  - `popupGated` (and optionally `handler`) on `MethodDescriptor`, so `handleBatch` derives its refusal set from `METHOD_REGISTRY`.
  - A narrow `runPopupOperation` covering session → account → CAIP → execute → unwrap. It must preserve the sendTx admission hooks and createAuthWit's silent fenced path (Codex).
  - Inline `unwrapResult`.
- **What disappears:** about 575 lines leave `dispatcher.ts`; about 60 scaffold lines; 1 hard-coded list; 1 wrapper.
- **Effort:** 1–2 days.
- **Source raw ids:** q11-C-3, q11-C-8, q11-X-4.

### Q-12: Balance snapshot state machine copied between TokensView and BalanceView

- **Smell:** Duplicate Code leading to Shotgun Surgery; a composable-extraction opportunity.
- **Priority/scope/blast/frequency:** Medium (3×2×2 = 12). Structural. 3 files. Median 12, max 17.
- **Found by:** both. **Confidence:** high.
- **RECURRING?** No.
- **Instances:**
  - `apps/extension/src/popup/components/modules/general/TokensView.vue:184-305, 343-388`
  - `apps/extension/src/popup/components/modules/general/BalanceView.vue:177-309, 334-345`

    Both hold `inActiveScope`, `fetchDirty`, the event triplet, first-connect suppression, `BALANCES_RETRY_MS = 2_000`, the generation counter and the `loading/unavailable/loaded` state. Their tests pin the same scenarios twice (`BalanceView.test.ts:324-380`, `TokensView.test.ts:497-545`).
  - A lighter copy with show/hide fencing and no retry: `apps/extension/src/popup/components/popups/SelectTokenPopup.vue:70-137`.
  - A variant: `apps/extension/src/popup/pages/send.vue:140-146` and `send-balance-events.ts`.
  - **Drift:** `BalanceView.vue:235-239` pushes without the id dedupe that `TokensView.vue:197` has (see the incidental bugs); delete splices in one and reassigns in the other.
- **Description:** A race-fencing protocol exists in two full copies and one partial copy.
- **Why it harms change:** Retry, reconnect or precedence fixes must be made two or three times, or the hero aggregate and the holdings list disagree for one account.
- **Refactoring:**
  - Extract Composable (C1) `useScopedTokenBalances({ client, scope, mapRow? })` in `apps/extension/src/composables/`. It receives the parent-owned client, uses `createRunFence`, and exposes `dispose()`.
  - Task flags, pinned ordering, seed placeholders and hero timing stay local.
  - Adopt it in SelectTokenPopup only if its show/hide contract is preserved.
- **What disappears:** about 100 lines net and 2 of the 3 reconnect counters.
- **Effort:** about 1 day.
- **Source raw ids:** q05-C-1, q05-X-1.

### Q-13: Popup key and stack-order arithmetic repeated in 24 popups; trust queue embedded in PopupManager

- **Smell:** Shotgun Surgery and Primitive Obsession (a stringly typed key re-read per popup). Large Class and Divergent Change in PopupManager.
- **Priority/scope/blast/frequency:** Medium (2×3×2 = 12). Local per site. 25 files. Median 6, max 10.
- **Found by:** Claude; Codex partially agreed. Codex's corrections: two values must be preserved (raw order for `Popup` z-index and reverse depth for `PopupCard`); renaming one key touches three or four places, not 25; only three sites compare triple equality, and a C1 hook must not own a connection. **Confidence:** moderate.
- **RECURRING?** No.
- **Instances:**
  - (a) `popupStore.len - popupStore.popups.<key>?.order` is computed in 24 files under `apps/extension/src/popup/components/popups/` (verified), for example `ConfirmPopup.vue:30`, `NewContactPopup.vue:23` and `SelectFpcPopup.vue:27`. Template re-reads include `ConfirmPopup.vue:87-88` and `SelectFpcPopup.vue:104`. The registry is `PopupManager.vue:316-354`.
  - (b) The trust queue, replay scheduler and visibility state machine live in `apps/extension/src/popup/components/popups/PopupManager.vue:55-150, 172-186, 190-215, 222-250`. Triple equality appears at `:76-78, :114-116, :208-210`. Workflow tags in comments ("P8 tactical C2 fix", "opus H-6") are banned by CLAUDE.md.
- **Description:** The manager knows each key, yet every popup recomputes its own stack depth. A registry component also hosts an event queue.
- **Why it harms change:** Changing the stacking rule (the gap-free order invariant, `popup.store.ts:27`) takes 24 edits. A typo'd key silently stacks wrong through optional chaining. Changing the trust scope touches a file whose job is the registry.
- **Refactoring:**
  - PopupManager passes `order` and `depth` props, or add `popupStore.stackOf(key)` returning both.
  - Extract Composable `useIncomingTrustPrompts(client)` receiving a connected client (the parent disposes, per the CLAUDE.md C1 rule), with one `isLiveTriple`.
  - Strip the phase tags.
- **What disappears:** 24 computeds, about 48 key-literal reads, and about 200 lines moved out of PopupManager.
- **Effort:** about 1 day.
- **Source raw ids:** q06-C-3, q06-C-6.

### Q-14: Onboarding and popup shells duplicate the import flow and the method tablist

- **Smell:** Duplicate Code, Data Clumps (a 35-name destructure) and Switch Statements (action predicates).
- **Priority/scope/blast/frequency:** Medium (3×2×2 = 12). Structural. 5 files. Median 9, max 12.
- **Found by:** both. **Confidence:** high.
- **RECURRING?** No.
- **Instances:**
  - (a) The import page:
    - `apps/extension/src/onboarding/pages/import.vue:65-102` (destructure), `:136-176` (picker and forms wiring), `:184-256` (CTA ladder)
    - `apps/extension/src/popup/pages/import.vue:97-134, 196-237, 246-330`
    - Keyboard action predicates: `apps/extension/src/popup/pages/import-helpers.ts:20-28`

    The popup's "Finishing import" branch is deliberate (Codex), and the destructures differ slightly (`isImporting`).
  - (b) The Password/Passkey roving tablist:
    - `apps/extension/src/onboarding/pages/create.vue:79-88, 115-145`
    - `apps/extension/src/popup/components/modules/settings/new-profile/NewProfileMethodTabs.vue:13-55`, which is L4 and cannot be imported by onboarding. That layer rule is why the copy exists.
  - (c) Lead, low confidence: the profile-name field appears three times: `apps/extension/src/onboarding/components/OnboardingProfileNameField.vue`, `apps/extension/src/popup/pages/import.vue:175-199` and `apps/extension/src/popup/pages/profile/new.vue:100-`.
- **Description:** `useProfileImportFlow` and `useProfileCreateFlow` shared the logic. The wiring, the action predicates and a CLAUDE.md-mandated keyboard pattern are still copied per shell.
- **Why it harms change:** A new `restoreStatus` or form prop needs identical edits in two templates plus the Enter-key path. A keyboard-rule fix (Home/End keys, a third method) must land twice.
- **Refactoring:**
  - Put shared action predicates in `apps/extension/src/utils/full-backup-actions.ts`, exposed via `useProfileImportFlow`. Keep "visible" and "executable" distinct.
  - Optionally an L3 `ImportFlowBody.vue` taking the flow object, with test ids preserved through props.
  - An L3 `AuthMethodTabs.vue` in `components/composite/`, or `useRovingToggle`.
- **What disappears:** about 70 lines of CTA predicates, about 40 template lines per page, and one tablist implementation.
- **Effort:** about 1 day.
- **Source raw ids:** q08-C-1, q08-C-2, q08-X-2.

### Q-15: Low-level primitives re-implemented instead of `@nulo/wallet-core/utils`

- **Smell:** Duplicate Code, a bypassed shared abstraction. Duplicate Code with drifted meaning for the record guards.
- **Priority/scope/blast/frequency:** Medium (3×3×1 = 9). Structural. 20 files in 4 workspaces. Median 4, max 29.
- **Found by:** both.
  - Encoders, random hex and the PXE pair: both.
  - Decoders: Claude, with both models agreeing that a mechanical swap changes behaviour.
  - Record guards: Claude, with Codex split. q11 Codex agreed on 7 identical copies; q13 Codex dismissed them as "tiny". **Cross-model disagreement** on (e).
- **Confidence:** high for (a, c, d), moderate for (b, e).
- **RECURRING?** No. It follows the "helper exists, hand-rolled" pattern of 2026-08-14 Q-06 and Q-09.
- **Instances:**
  - (a) Encoders, a safe swap:
    - `apps/extension/src/wallet/services/profile/service.ts:1718, 1876-1878, 2063`
    - `packages/wallet-crypto/src/session-secret-box.ts:91-102`. `tokenCopy` exists only because `Buffer.from` copies the bearer.
    - `packages/wallet-crypto/src/wallet-fingerprint.ts:36-37` (hex)
    - `apps/extension/src/popup/pages/settings/security/export/full.vue:348`
    - `packages/aztec-runtime/src/pxe/client.ts:208`, `btoa(String.fromCharCode(...key))`, the spread idiom `encoding.ts` warns against
    - `packages/aztec-runtime/src/account/account-export.ts:80` (hex)
    - `apps/extension/src/wallet/utils/passkey-ceremony.ts:139` (hex)
  - (b) Decoders. These are **a behaviour change**: `Buffer` is lenient where `atob` is strict.
    - `apps/extension/src/wallet/services/profile/service.ts:2072, 2310, 2321, 2341`
    - `apps/extension/src/wallet/services/account/service.ts:439`
    - `apps/extension/src/wallet/services/dapp-session/integrity.ts:59`. The same file encodes with `toBase64` at `:52`, and its catch at `:58-62` is dead.
    - `packages/wallet-crypto/src/session-secret-box.ts:128-132`
    - `packages/wallet-crypto/src/password-secret-box.ts:219, 226, 234` (the file imports `toBase64` at `:40`)
    - `packages/aztec-runtime/src/pxe/service.ts:817`, a hand copy of `fromBase64`
    - `apps/extension/src/wallet/utils/passkey-ceremony.ts:41` (hex decode; wallet-core has no `fromHex`)

    Seven `as Uint8Array<ArrayBuffer>` casts would disappear.
  - (c) Random hex: `apps/extension/src/wallet/services/profile/spec.ts:104-108` (`mintPxeGeneration`) and `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:48-53` (dead, see Q-26). Both equal `getRandomHex(32)` (`packages/wallet-core/src/utils/random.ts:9-14`).
  - (d) Byte equality: `packages/aztec-runtime/src/pxe/service.ts:848` against `array_equals`.
  - (e) Record guards:
    - Array-excluding: `packages/wallet-bridge/src/dispatcher.ts:307`, `packages/wallet-bridge/src/method-scope-checkers.ts:395`, `packages/wallet-bridge/src/method-descriptors.ts:115`, `apps/extension/src/composables/usePinnedTokens.ts:24`, `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:32`, `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:14-15`.
    - Permissive: `apps/extension/src/popup/windows/capabilities/details-table.ts:88`, `apps/extension/src/popup/windows/capabilities/permission-rows.ts:253`, `packages/wallet-bridge/src/dispatcher.ts:767` (`isObj`, in the same file as the strict copy), and `apps/extension/src/wallet/services/dapp-session/spec.ts:69` and `apps/extension/src/wallet/services/transaction/spec.ts:168`, which are documented as deliberately tolerant.
    - Stricter, keep: `packages/legal/src/status.ts:66`.
- **Description:** `encoding.ts` states its goal is to replace the per-site `Buffer` and loop idioms, and about 30 sites still bypass it. There is no shared record guard, and one file uses both meanings.
- **Why it harms change:** Dropping the `Buffer` polyfill stays blocked. The encode and decode for one secret cannot be audited in one dialect. A wire-validation site can silently pick the wrong object guard.
- **Refactoring:**
  - PR 1: encoders, `getRandomHex(32)` and `pxe/client`/`pxe/service` (no on-disk change).
  - PR 2: decoders site by site, each with an exception-parity test, or add `fromBase64Lenient`. This is on frozen blob paths.
  - Add `isRecord` (non-null, non-array) and `isObjectLike` (non-null) to `packages/wallet-core/src/utils/guards.ts`, the lowest package all consumers import. Keep legal's stricter guard.
- **What disappears:** about 30 idioms, 7 casts, 2 mint functions, the encoding-only `tokenCopy`, and about 8 guard definitions.
- **Effort:** about 1 day, plus a separate decoder PR.
- **Source raw ids:** q10-C-2, q10-X-4, q13-C-1, q13-C-5, q13-C-6, q13-X-2, q11-C-9; q10 Claude "both missed" (PXE byte equality).

### Q-16: Async-coordination primitives hand-rolled: deadline race ×8, serial queue ×7, latest-wins counters ×10

- **Smell:** Duplicate Code, with Parallel Implementations of `Lock` and `createRunFence`. Misplaced Function: the only exported `withTimeout` lives in a Pinia store and is auto-imported app-wide.
- **Priority/scope/blast/frequency:** Medium (3×3×1 = 9). Structural. 23 files across 3 workspaces. Median 3, max 17.
- **Found by:** both.
  - (a) Found by 6 of 6 reports.
  - (b) Claude; Codex conceded ("real duplication my first pass missed").
  - (c) Claude, in q09 and q07; Codex partial (`app.store` has a different contract; some sites lack `disposed`).
- **Confidence:** high for (a), moderate for (b–c).
- **RECURRING?** It is a pattern recurrence. 2026-08-16 Q-08 found the keyed promise-chain FIFO ×3 (those sites are fixed via `KeyedLock`); these are new sites of the same smell.
- **Instances:**
  - (a) Deadline race:
    - `apps/extension/src/stores/balances.store.ts:124-139` (`withTimeout`)
    - `apps/extension/src/popup/auth-guard.ts:83-90` (`withinDeadline`)
    - `apps/extension/src/components/Header.vue:34-43` (sentinel)
    - `apps/extension/src/components/JsonViewer/LogsViewer.vue:189-200` (never clears its timer)
    - `apps/extension/src/composables/importPreflight.ts:41-47` and `apps/extension/src/composables/importChainSync.ts:111-117` (race an uncancellable `realSleep`)
    - `packages/extension-messaging/src/core/base-client.ts:284-301`
    - `packages/aztec-runtime/src/pxe/opfs-store.ts:124-135, 168-170`; its quarantine stays local
    - `sleep` copies: `apps/extension/src/composables/importPreflight.ts:31`, `apps/extension/src/popup/auth-guard.ts:66`, `apps/extension/src/stores/app.store.ts:648`, `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:227`
  - (b) Promise-chain serial queues:
    - `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:75-82`
    - `apps/extension/src/utils/guarded-network-activation.ts:18, 46-50`
    - `apps/extension/src/wallet/logger/store.ts:20, 127-132`
    - `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:60, 176`
    - `apps/extension/src/wallet/services/token/seeder.ts:168, 311-318`
    - `apps/extension/src/wallet/services/price/service.ts:104, 231-`
    - `apps/extension/src/composables/usePinnedTokens.ts:88-100` (idle-entry eviction that `KeyedLock` lacks)

    They use four different rejection policies.
  - (c) Latest-wins counters beside `createRunFence` (`apps/extension/src/composables/runFence.ts:12-20`):
    - Composables in `apps/extension/src/composables/`: `useEntityCrud.ts:77-100`, `useIncomingTransfers.ts:76-79, 104`, `useLegalAcceptance.ts:16-52`, `useSeedStatus.ts:56-90, 133`, `useIncomingSyncHealth.ts:50-99, 134`, `usePrestoStatus.ts:16-30`, `usePinnedTokens.ts:169-202`.
    - Secret pages: `apps/extension/src/popup/pages/settings/security/export/account.vue:59-213`, `apps/extension/src/popup/pages/settings/security/export/full.vue:72-416`, `apps/extension/src/popup/pages/settings/accounts/import.vue:44-168`.
    - Excluded: `app.store.ts:156-280`, which has a different contract.
    - Download-handler twins: `export/account.vue:182-198` and `export/full.vue:369-392`.
- **Description:** Three async primitives are each re-derived per site, and each copy decides timer cleanup, loser observation and rejection policy for itself.
- **Why it harms change:** Deadline cleanup is correct in some copies and missing in others. A queue-policy fix (for example a timeout) needs seven hunts. A fence variant such as invalidate-on-profile-switch lives in several shapes, and a missed `gen` check after a new `await` in an export flow writes a payload back after scrubbing.
- **Refactoring:**
  - `raceDeadline(work, ms, onTimeout)` in `packages/wallet-core/src/utils/timeout.ts`. It clears the timer in `finally` and does not imply cancellation. The store's `withTimeout` becomes a wrapper or is deleted.
  - `createSerialQueue()` in `packages/wallet-core/src/utils/serial.ts`, returning each op's own result. Callers keep their rejection policy.
  - Extend `createRunFence` with `current()` and `invalidate()`; the per-await checks remain (Codex).
  - `useDownloadAction` for the two export pages.
- **What disappears:** 7 timer-race implementations, 4 `sleep` copies, 7 chain-plumbing blocks, about 10 counters, and about 18 download lines.
- **Effort:** 1–2 days.
- **Source raw ids:** q09-C-1, q09-X-1, q09 Claude "new 1" (`withTimeout` in a store), q10-C-4, q10-X-1, q13-C-2, q13-C-3, q13-X-1, q07-C-5.

### Q-17: ProfileService Large Class hosting duplicated credential-row and open scaffolds

- **Smell:** Large Class and Divergent Change, containing Duplicate Code.
- **Priority/scope/blast/frequency:** Medium (3×1×3 = 9). Structural. 1 file (2,797 lines). 25 commits since June.
- **Found by:** both.
  - (a–b) Both.
  - (c) Codex; Claude partial.
  - (d) Claude; Codex **disagreed**: the differences were adjudicated in `implementations-plan/profile-service-dedup/plan.md:29-39` and are test-pinned at `service.integration.test.ts:3055-3082`.
- **Confidence:** high for (a–b), moderate for (c), low for (d).
- **RECURRING?** Yes: 2026-08-16 Q-01 (ProfileService). Claude assumed complexity acceptances cover it; the coordinator verified `scripts/complexity-baseline/manifest.json` has none for this file.
- **Instances** (`apps/extension/src/wallet/services/profile/service.ts`):
  - (a) Six row constructors: `:605-627`, `:761-775`, `:2159-2178`, `:2211-2234`, `:2393-2434`, `:2581-2599` (jscpd 34 lines). Commit `152b1083` edited all six literals and `d56d6a85` edited three MAC calls.
  - (b) The degraded-open tail (open the session, then warn when the DEK is missing), four times: `:702-706`, `:851-855`, `:2726-2730`, `:2787-2791`.
  - (c) Pending restore and rewrap contexts: `:124-239` and their consumers.
  - (d) Password reveal skeleton, five times: `:1195-1242`, `:1685-1732`, `:1816-1898`, `:1919-1955`, `:1965-2003`.
- **Description:** The persisted row contract and the "degraded open must warn" rule are restated per path inside a class whose independent policies (credentials, sessions, deletion, export, restore) change for unrelated reasons.
- **Why it harms change:** A new MAC input or row field means six edits, and a miss surfaces only at first unlock. A fifth open path can skip the warning.
- **Refactoring:**
  - Password and passkey row builders in `profile/profile-row.ts`, grouped inputs, with the MAC computed after the id is final. Keep the caller-owned locking and buffers (Codex).
  - `openAndWarnIfDegradedHoldingLock`.
  - Extract Class `PendingRestoreContexts`; it must not take the facade lock.
  - Do not build (d) without first revisiting the prior plan's verdict.
- **What disappears:** 6 literals become 2; 4 tails become 1; two maps and their lifecycle move out.
- **Effort:** 1–2 days.
- **Source raw ids:** q02-C-1, q02-C-2, q02-C-3 (tail half), q02-X-1, q02-X-3.

### Q-18: incoming-transfer note and public arms duplicate the trust/commit pipeline and clear scaffolds

- **Smell:** Duplicate Code and Shotgun Surgery inside a 2,464-line service.
- **Priority/scope/blast/frequency:** Medium (3×1×3 = 9). Structural. 2 files. `service.ts` has 22 commits since June.
- **Found by:** both. **Confidence:** high.
- **RECURRING?** Yes: 2026-08-16 Q-01 (incoming-transfer sub-point) at new line numbers.
- **Instances** (`apps/extension/src/wallet/services/incoming-transfer/service.ts` unless noted):
  - Trust resolution: `resolveNoteTrust` `:1433-1453` and `resolvePublicTrust` `:2126-2158`.
  - The pending-event projection, three times: in those two and in replay at `:1547-1556`.
  - Commit: `:1465-1492` and `:2161-2172`.
  - Record builders: `:2346-2376` and `:2174-2196`.
  - Dedupe: `:1383-1415` and `:2113-2121`.
  - Token lookup: `:1391`, `:2083`.
  - Note-scheduler teardown: `:447-451` and `:1225-1231`, where the public arm has `stopPublicScheduler` at `:1039-1045`.
  - `clearProfile`/`clearChain`: `:702-729` and `:731-757`.
  - The five-store purge inventory, twice: `apps/extension/src/wallet/services/incoming-transfer/repository.ts:221-231` and `:234-244`.
- **Description:** Two receipt sources run one workflow in two hand-copied arms. Scope clears repeat an ordering-sensitive scaffold and a store inventory.
- **Why it harms change:** A new trust state, prompt field or dedupe source means editing both arms, and they have already diverged in their epoch re-checks. A sixth store needs two inventory edits.
- **Refactoring:**
  - `promoteUnknownTrust` and a synchronous `buildPendingEvent`, reusing `_setTrustStateLocked` at `:605-615`.
  - `commonRecordFields`, `emitAddedIfVisible`, `stopNoteScheduler`, and `clearScoped(prefix, evict, repoOp)`.
  - A repository `clearScopePrefix`, keeping key-based deletion. The epoch checks stay at their call sites.
- **What disappears:** about 45 pipeline lines, 2 event constructions, 2 teardown copies, and about 20 scaffold lines plus one inventory.
- **Effort:** about 1 day.
- **Source raw ids:** q03-C-1, q03-C-4, q03-X-1, q03-X-2.

### Q-19: Grant matching duplicated between consent coverage and enforcement

- **Smell:** Duplicate Code and Shotgun Surgery on an authorization rule.
- **Priority/scope/blast/frequency:** Medium (3×1×3 = 9). Structural and security-adjacent. 2 files. `dispatcher.ts` has 29 commits, `method-scope-checkers.ts` 8.
- **Found by:** both. **Confidence:** high.
- **RECURRING?** No.
- **Instances:**
  - `scopeCovers` at `packages/wallet-bridge/src/dispatcher.ts:219-230` against `matchesPattern` at `packages/wallet-bridge/src/method-scope-checkers.ts:38-43`.
  - Address-list coverage at `dispatcher.ts:204-217` and `:263-271` against `inAddressList` at `method-scope-checkers.ts:57-60`.
  - `grantsOfType` at `dispatcher.ts:686-688` and `method-scope-checkers.ts:62-64`.
  - Enforcement's empty-function-name guard (`method-scope-checkers.ts:45-54`) stays separate.
- **Description:** "Does this grant reach that call" is written once for "do we re-prompt?" and once for "do we allow?". The `scopeCovers` comment says it "deliberately mirrors enforcement".
- **Why it harms change:** A new wildcard form or scope dimension changed only in enforcement makes the wallet skip a re-prompt for grants it will then refuse, or approve a widening silently.
- **Refactoring:** Extract a leaf `packages/wallet-bridge/src/scope-matching.ts` with `matchesPattern`, `inAddressList` and `grantsOfType<K>`. Coverage and enforcement keep their own iteration semantics. This is independent of, and composes with, Q-11.
- **What disappears:** about 30 lines and 2 parallel spellings of the wildcard rule.
- **Effort:** 0.5 day.
- **Source raw ids:** q11-C-1, q11-X-1.

### Q-20: `WalletError` reconstruction encoded in three parallel structures

- **Smell:** Shotgun Surgery and Switch Statements.
- **Priority/scope/blast/frequency:** Medium (3×1×3 = 9). Structural. It is the wire-error contract for every service. `errors.ts` has 20 commits since June.
- **Found by:** Claude; Codex partial. Codex notes existing coverage: a loop over 16 classes (`errors.test.ts:245-253`), a pinned `TooManyPendingError` omission (`:256-266`), and client-local errors (`errors.ts:77-81`). **Confidence:** moderate.
- **RECURRING?** No. The 2026-08-14 Q-07 and Q-14 halves were fixed.
- **Instances** (`packages/extension-messaging/src/errors.ts`): 21 classes at `:50-463`; the `KnownWalletErrorPayload` union at `:472-493`; the `walletErrorFromPayload` switch at `:503-558`.
- **Description:** "Code X reconstructs as class X" is stated three times, and a missing case compiles, falling back to a bare `WalletError`.
- **Why it harms change:** Each new wire error needs three edits. An omission surfaces later as a silently failing `instanceof` in UI retry paths.
- **Refactoring:**
  - A registry array keyed by `CODE`, with `static fromPayload` overrides for the four irregular classes.
  - Derive the union from the array.
  - A test enumerating the module's exported `WalletError` subclasses: each must be registered or explicitly client-local.
- **What disappears:** a 22-line union and about 55 switch lines.
- **Effort:** 0.5 day.
- **Source raw ids:** q10-C-1.

### Q-21: PXE legacy IndexedDB deletion wrapped ×3; keyval-store guard written twice

- **Smell:** Duplicate Code with implicit, unnamed per-site policies.
- **Priority/scope/blast/frequency:** Medium (3×1×3 = 9). Structural. 1 file. `pxe/service.ts` has 25 commits since June.
- **Found by:** Claude; Codex partial. The keyval rule is concrete; the blocked-handling policies have reasons (boot skips rather than hangs; erasure must complete). **Confidence:** moderate.
- **RECURRING?** Yes: 2026-08-16 Q-01, the `pxe/service.ts` bullet, unchanged.
- **Instances** (`packages/aztec-runtime/src/pxe/service.ts`): delete wrappers at `:285-297`, `:309-320` and `:866-884`; the "delete keyval-store only when no PXE DB remains" rule at `:302-321` and `:780-792`.
- **Description:** A data-protecting rule (keep a surviving profile's PXE) is implemented twice, each with its own `databases()` re-list.
- **Why it harms change:** Tightening the guard for a new profile-scoped DB must hit both copies, or a surviving profile's data is corrupted.
- **Refactoring:** `pxe/legacy-idb.ts` exporting `deleteIdb(name, { onBlocked: "skip" | { waitMs } })` and `deleteSharedKeyvalIfNoPxeDbs`. Name each site's policy. Alternatively, retire the rc.2-era sweep if no install can still hold pre-OPFS data (owner call).
- **What disappears:** about 35 lines, or about 90 if retired.
- **Effort:** 0.5 day.
- **Source raw ids:** q11-C-4.

### Q-22: Shared visual shells copied as CSS

- **Smell:** Duplicate Code encoding a shared visual component, leading to Shotgun Surgery on restyle. Also incomplete adoption of existing shared modules (`detail-page.module.css`, `popup-shared.module.css`, `ListStatusMessage`, `Skeleton`, `Button cta_outline`).
- **Priority/scope/blast/frequency:** Medium (3×3×1 = 9). Structural. 24 files. Median 4, max 11. Low churn, but these are owner-signed-off UI surfaces.
- **Found by:** both.
  - Rows (a): both.
  - Cards (b): both.
  - Toolbar button (c): both.
  - Detail pages (d): both (Codex CSS-only).
  - Empty state (e): both.
  - Skeleton (f): Codex.
  - Popup body (g): Claude; Codex partial (3, not 4, titles).
  - Disclosure (h): Codex.
  - Snack card (i): Codex.
  - CTA (j): Claude; Codex refuted the hover-drift claim.
- **Confidence:** high.
- **RECURRING?** It is a pattern recurrence: 2026-08-16 Q-11 (overlay shells, fixed) and 2026-08-14 Q-12 (CTA typography, fixed in Button, bypassed in `SecretCountdownClose`).
- **Instances:**
  - (a) Settings list row:
    - `apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:62-100, 122-148` equals `apps/extension/src/popup/pages/settings/connected-apps/index.vue:176-214, 232-258`. This is the byte-identical top jscpd hit (41 plus 21 lines).
    - Variants: `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:114-198` and `apps/extension/src/components/ui/Settings/SettingItem.vue:156-225`.
    - `apps/extension/src/components/ui/Settings/SettingField.vue:34-75` equals `SettingValue.vue:39-80` (jscpd 42 lines; `SettingValue` is dead, see Q-26). `:last-of-type` and `:last-child` already differ.
  - (b) Record card: `apps/extension/src/popup/components/modules/settings/authwits/AuthwitCard.vue:65-168` against `apps/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:261-392` (jscpd 33 and 26 lines).
  - (c) Toolbar icon button, five copies:
    - `apps/extension/src/popup/pages/settings/contacts/index.vue:205-222`
    - `apps/extension/src/popup/pages/settings/connected-apps/index.vue:298-315`
    - `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:368-385`
    - `apps/extension/src/popup/pages/settings/advanced/account-state/authwits/index.vue:207-224`
    - `apps/extension/src/popup/pages/tokens/[id].vue:299-321` (used at `:210-218` and `:227`)

    None has `:focus-visible`.
  - (d) Detail pages:
    - `apps/extension/src/popup/pages/tx/[id].vue:358-494` against `apps/extension/src/popup/pages/received/[id].vue:341-~495`: `hero_link` `387-416`/`366-392`, chip `446-459`/`406-419`/`journal/[id].vue:349-362`, address card `461-484`/`421-452`.
    - Script: explorer link at `tx:124-126` and `received:126-130`; fee at spot at `tx:105-110` and `received:133-135`; the date format at `tx:91`, `received:121-122` and `journal:145, 150`; the debug flag at `tx:139-142` and `journal:200-203`.
  - (e) Empty state: `apps/extension/src/components/composite/ListStatusMessage.vue:29-57` against `apps/extension/src/popup/components/modules/general/list-empty.module.css:1-27`. The latter is consumed by `TokensView.vue:475-486, 556-566` and `RecentActivityView.vue:873-876, 947-957`. They have drifted: `overflow-wrap` is only in the component.
  - (f) Shimmer bypassing `packages/design/src/ui/Skeleton.vue:23-52`:
    - `apps/extension/src/components/composite/send/AmountCard.vue:558-574`
    - `apps/extension/src/popup/components/modules/send/fee-shared.module.css:30-46`
    - `apps/extension/src/popup/pages/received/[id].vue:488-516`
  - (g) Popup body and title despite `popup-shared.module.css`. `.wrapper { padding: 0 20px 24px 20px }` is declared in 16 files under `apps/extension/src/popup/components/popups/`:
    - `ForgotPasswordPopup:68`, `ImportContactsPopup:257`, `ConfirmPopup:166`, `AccountsPopup:127`
    - `IncomingTrustPopup:222`, `DataViewerPopup:47`, `NewSenderPopup:172`, `ChangeAuthwitsRegistryPopup:151`
    - `EditProfilePopup:184`, `SelectNetworksPopup:97`, `SelectFpcPopup:192`, `ReceivePopup:87`
    - `SelectTokenPopup:206`, `SelectProfilePopup:158`, `TokenMetadataPopup:164`, `RevokeAuthwitsPopup:278`

    The headline `.title` repeats at `ConfirmPopup:189`, `IncomingTrustPopup:231` and `SelectProfilePopup:167`.
  - (h) Disclosure toggle: `apps/extension/src/popup/windows/execute/CallArguments.vue:107-117, 149-167` against `OperationCard.vue:260-269, 582-600`.
  - (i) Snack card: `packages/design/src/ui/ToastManagerBase.vue:131-150` against `:162-184`.
  - (j) `apps/extension/src/components/composite/SecretCountdownClose.vue:52-119` re-implements `Button` `cta_outline` (`packages/design/src/ui/Button.vue:300-347`).
- **Description:** L0–L2 were externalized, but the L3 visual shells stayed as per-screen CSS copies. Several shared owners exist and are bypassed.
- **Why it harms change:** An owner-approved restyle (focus ring, divider, density, hover token, empty card, shimmer motion) must be found and applied in 2–16 files. Drift is already visible (`:last-of-type` against `:last-child`, `overflow-wrap`, reduced-motion only on the received page).
- **Refactoring:** Use `composes` style modules, the established pattern:
  - `settings-row.module.css` and `record-card.module.css` in `apps/extension/src/components/composite/`.
  - A `ToolbarIconButton` (L2 in `packages/design/src/ui/`, not `RowAction`, which is 24×24 with a different contract).
  - Move the remaining detail-page blocks into `apps/extension/src/popup/pages/detail-page.module.css`, plus `formatDetailTimestamp` and `useExplorerLink`.
  - A `#sub` slot on `ListStatusMessage`, or a shared empty-state module.
  - `Skeleton` with CSS custom properties.
  - `popup-shared` `.wrapper`/`.title`.
  - L3 `DisclosureToggle.vue`, an internal `ToastCard.vue`, and `Button cta_outline` with a progress slot.
  - Every step must be pixel-identical, with screenshots per the owner UI rule.
- **What disappears:** roughly 500–600 CSS lines plus a few script helpers.
- **Effort:** 2–3 days, as many small PRs.
- **Source raw ids:** q05-C-4, q05-C-5, q05-X-3, q05-X-4, q06-C-7, q06-X-5, q06-X-6, q07-C-1, q07-C-2, q07-C-3, q07-X-3, q07-X-4, q07-X-5, q07-X-6, q08-C-5 (row half), q08-C-6, q08-C-8 (live half), q08-X-4, q12-C-4, q12-C-5, q12-X-1, q12-X-3.

### Q-23: Design-token layer: dark palette declared twice; hairline and scrim values hard-coded

- **Smell:** Duplicate Code (in `base.css`) and Config sprawl: magic literals where tokens belong, with a theme-divergence defect.
- **Priority/scope/blast/frequency:** Medium (3×3×1 = 9). Structural. 10 or more files. Median 4, max 20.
- **Found by:** both.
  - (a) Claude; Codex agreed, with a cascade-preservation constraint.
  - (b) Both. Codex's version is narrower (3 exact sites), and it notes the scrim alphas differ by role, so collapsing them is a product decision.
- **Confidence:** high for (a), moderate for (b).
- **RECURRING?** No.
- **Instances:**
  - (a) `packages/design/src/base.css:72-123` (`:root`) against `:194-245` (`[theme="dark"]`): 28 identical declarations. The light block repeats the palette at `:166-177`. `theme-contrast.ts:33-40` merges the blocks, so no test can see a mismatch.

    The repo map's exclusion list calls `base.css` generated. **It is not**: its header says it is hand-relocated. `gen-tokens.ts` emits `utilities.css`.
  - (b) `rgba(74,70,63,.2/.3)` hairlines at about 19 sites. Only three have a light-theme twin:
    - `apps/extension/src/components/composite/capabilities/DetailsTable.vue:135-145`
    - `apps/extension/src/components/composite/capabilities/PermissionRow.vue:80-86`
    - `apps/extension/src/popup/pages/settings/glossary.vue:54-65`

    Others include `TransactionTerminalCard.vue:103`, `TransactionIncomingCard.vue:93`, `TransactionAwaitingCard.vue:150`, `TransactionCardLayout.vue:198`, `SettingField.vue:65`, `SettingItem.vue:180`, `Navigation.vue:61`, `TransactionCard.vue:213`, `GasBalanceCard.vue:188`, `RecentActivityView.vue:883`, `fee-shared.module.css:4`, `ContactRow.vue:92, 170-171`, `connected-apps/index.vue:206` and `AccountSelectRow.vue:140`.

    Scrims `rgba(10,9,8,α)` use six alphas: `Popup/Popup.vue:148`, `DappCancelledOverlay.vue:33`, `LegalAcceptanceSheet.vue:136`, `GlobalLoader.vue:33`, `PasskeyCeremonyDialog.vue:107`, `BarrierOverlay.vue:31`. `rgba(35,31,28,1)` appears three times: `CollapsingHeroLayout.vue:228`, `send.vue:810`, `reset.vue:180`.
- **Description:** A colour edit in one dark block silently leaves the other stale. Hairlines render dark-hued in light theme at about 16 sites.
- **Why it harms change:** A restyle or light-theme fix is a 20–35 file edit, and nothing blocks new literals.
- **Refactoring:**
  - Serve dark values from one `:root, [theme="dark"]` block, hoist theme-invariant values, and add an equality assertion in `theme-contrast.test.ts`.
  - Introduce `--hairline-soft` (and `-strong`) in `token-contract.ts` and `base.css` with today's exact values: a byte-identical first step that needs no sign-off.
  - Correcting light-theme hairlines and scrim roles is user-visible and needs owner sign-off with screenshots.
- **What disappears:** about 50 declarations, about 35 literals, and 3 per-file light overrides.
- **Effort:** about 1 day.
- **Source raw ids:** q12-C-2, q12-C-3, q12-X-2.

### Q-24: FeeSettingsCard fee-scope identity predicates ×6 and a mode flag threading two selection models

- **Smell:** Data Clumps and Duplicate Code (the identity predicates). Switch Statements on `originPrivacy === null`, across about ten branch points.
- **Priority/scope/blast/frequency:** Medium (3×1×3 = 9). Structural. 1 file (982 lines), 20 commits since June.
- **Found by:** Claude; Codex agreed on (a) only. The mode split (b) is a **cross-model disagreement**. Claude's claim of two accepted complexity directives is wrong: the manifest lists only the test file. **Confidence:** high for (a), low for (b).
- **RECURRING?** No.
- **Instances** (`apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue`):
  - (a) Identity predicates and keys: `:184-189`, `:548-554`, `:726-734`, `:620`, `:716`, `:772`.
  - (b) Mode branches: `:198-222`, `:364-400`, `:525`, `:569`, `:582`, `:590`, `:755`.
- **Description:** The `{profileId, networkId, chainId, accountAddress}` identity is compared and keyed six ways, and two selection models share one component.
- **Why it harms change:** A new identity field needs six edits, and a new fee behaviour must consider both models in every handler.
- **Refactoring:**
  - (a) `sameFeeScope` and `feeScopeKey` in `fee-helpers.ts`. This is mechanical.
  - (b) Only as an owner-visible plan: `useSendFeeSelection` and `useSavedFeeSelection` behind one interface.
- **What disappears:** about 25 lines for (a), and 10 conditionals for (b).
- **Effort:** 0.5 day for (a); 2–3 days for (b).
- **Source raw ids:** q05-C-6.

### Q-25: Full-backup restore stages depend on UI-owned transforms through `never` casts

- **Smell:** Inappropriate Intimacy; type-safety erosion used as a cycle workaround.
- **Priority/scope/blast/frequency:** Medium (3×1×3 = 9). Structural. 2 files. `useFullBackupImport.ts` has 31 commits since June.
- **Found by:** Codex. Claude agreed on the facts and disputed only whether it belongs in a dedup run. **Confidence:** high.
- **RECURRING?** It relates to 2026-08-16 Q-02 (the restore decomposition), a new residue.
- **Instances:**
  - `apps/extension/src/composables/useFullBackupImport.ts:165-171, 239-243, 523-536`
  - `apps/extension/src/composables/full-backup-restore.ts:129-133, 326-339, 373-388`
- **Description:** The stage interface declares an `AccountRestoreClient` without `restore`, then calls a UI-owned transform through `data: never, accountService: never`.
- **Why it harms change:** A change to a transform's inputs does not type-error at the handoff.
- **Refactoring:** Move Function. Put account filtering and token relinking in a non-reactive restore-support module beside the stages, with a minimal client type that includes `restore`.
- **What disappears:** 2 injected parameters and 4 casts.
- **Effort:** 0.5 day.
- **Source raw ids:** q09-X-5.

---

## Low

### Q-26: Dead and speculative code left behind

- **Smell:** Dead Code and Speculative Generality.
- **Priority/scope/blast/frequency:** Low (2×3×1 = 6). Local. 16 or more files. Median 4, max 11. This is a cheap, high-confidence quick win: about 1,300 lines plus tests.
- **Found by:** both.
  - Design exports: both.
  - activity-protocol: Codex; Claude agreed.
  - `SettingValue`, `Divider`: Claude; Codex agreed.
  - `SelectFpcPopup`: Claude, in rebuttal; the coordinator verified there is no opener.
  - Test-only utils: Claude; Codex agreed, except the alias is live.
  - ArtifactRegistry: both.
  - Dead `.cta` CSS: both.
  - Fonts: Claude; Codex **disagreed** because the repo map excludes both font directories.
- **Confidence:** high.
- **RECURRING?** Yes: the ArtifactRegistry policy and the no-op subscription are 2026-08-16 Q-01, and the dead `.cta` CSS is 2026-08-14 Q-11.
- **Instances:**
  - (a) `@nulo/design` exports with no consumer. The tools app, their only consumer, left the repo. `apps/landing` imports only `base.css`, and `apps/playground` does not use the package (verified). None is registered in `apps/extension/scripts/design-resolver.ts:10-31`.
    - `packages/design/src/ui/Card.vue`, `ui/Tag.vue`, `ui/Toast.vue`
    - `packages/design/src/composite/AddressDisplay.vue` (a same-name collision with the live extension component), `composite/BalanceRow.vue`, `composite/DisclaimerTag.vue`, `composite/DripButton.vue`, `composite/EmojiGrid.vue`
    - Barrel entries: `packages/design/src/index.ts:28, 40-41, 48-52`
  - (b) Extension:
    - `apps/extension/src/wallet/services/activity-protocol/coordinator.ts` and `spec.ts`: 317 lines plus a 154-line test, never registered in `apps/extension/src/wallet/runtime.ts:469-543`. **Owner call**: delete it, or wire it for the planned activity feed.
    - `apps/extension/src/components/ui/Settings/SettingValue.vue` (stories and tests only).
    - `apps/extension/src/components/Divider.vue`.
    - `apps/extension/src/popup/components/popups/SelectFpcPopup.vue`, still mounted at `PopupManager.vue:342` although nothing opens `select_fpc`.
    - Test-only exports: `apps/extension/src/utils/fee-estimation.ts:119-140` (`buildFeeEstimate`, which re-inlines `computeMaxFee`), `utils/amount.ts:208-216` (`isValidAmount`), `utils/tx-enrichment.ts:127-134, 147-149`, `utils/core.ts:131` (`requireTransaction`).
    - The alias `utils/incoming-dust.ts:46` is live; inline it rather than delete it.
    - Dead `.cta`/`.cta_red` CSS: `apps/extension/src/popup/pages/settings/security/change-password.vue:299-337` and `reset.vue:203-243` (jscpd 37 lines).
    - Five font copies in `apps/extension/src/assets/fonts/*.woff2`: byte-identical to `packages/design/src/fonts`, with zero references (verified).
  - (c) aztec-runtime and wallet-bridge speculative surface:
    - `packages/aztec-runtime/src/pxe/artifact-registry.ts:13-35, 96-104, 122-125, 134-139, 157-166` (policy types and accessors, the unread `_network`, `hasKnownClassId`, `clear`).
    - `packages/aztec-runtime/src/pxe/service.ts:221`, a subscription to a no-op handler at `:1022-1030`; the `IProfileReader` events at `:69-74`.
    - `packages/aztec-runtime/src/pxe/index.ts:14`.
    - `packages/wallet-bridge/src/method-descriptors.ts:376-379` (`RpcRequest`, Claude-only).
- **Description:** These are leftovers from the tools/bridge move, the design externalization and never-wired scaffolding. `mount-all.test.ts` and the dedicated tests keep them looking alive.
- **Why it harms change:** Readers reason about unreachable policy spaces and a subsystem that looks authoritative (activity-protocol). Barrel autocomplete offers the wrong `AddressDisplay`. Tests are maintained for no user.
- **Refactoring:** Remove Dead Code together with its tests, stories and barrel lines, and let `components.d.ts` regenerate. Keep the extension-local `AddressDisplay` and `EmojiGrid`. Verify the fonts removal with a build and the notices generator.
- **What disappears:** about 1,300 source lines, about 700 test lines, and 756 KB of binaries.
- **Effort:** 0.5–1 day.
- **Source raw ids:** q03-X-5, q06 Claude "both missed" (`select_fpc`), q08-C-5 (dead half), q08-C-7, q08-C-8 (dead half), q09-C-5, q11-C-7, q11-X-5, q12-C-1, q12-X-4, q13-C-4.

### Q-27: Low-priority residue (valid, local, not promoted)

Each item below is a real duplicate. All are local, two-site or dormant, below the density bar. Fix them opportunistically when the file is touched.

| Sub-id | Item | Instances | Found by | Note |
|---|---|---|---|---|
| Q-27a | Discovery admission ladder ×2 (security throttle path) | `apps/extension/src/wallet/services/wallet-sdk/background.ts:939-949, 1021-1031` | both | Keep the returning-user branch (`:875-887`) out of it. |
| Q-27b | Auth-registry tx settlement workflow ×2 | `apps/extension/src/wallet/services/auth-registry/service.ts:281-321, 336-375` | codex (claude borderline) | The runner must consume the already-captured fence. |
| Q-27c | Identical `aztec_sendTx`/`send_transaction` case bodies | `apps/extension/src/popup/windows/execute/index.vue:331-348, 349-365` | both | Stack the case labels; about 17 lines. |
| Q-27d | Appearance and Advanced config-toggle binding | `apps/extension/src/popup/pages/settings/appearance.vue:105-162`; `apps/extension/src/popup/pages/settings/advanced/index.vue:108-157` | both | `useConfigSettings`; hydration must not fire side effects. |
| Q-27e | Profile-activation waiters | `apps/extension/src/composables/unlockWait.ts:33-61`; `apps/extension/src/composables/waitForProfileActive.ts:30-47` | both (3 reports) | Share the watcher and timer only; keep each wrapper's failure policy. |
| Q-27f | `normalizeProfileName` inlined ×5; malformed-row predicate ×3 | `apps/extension/src/popup/components/popups/EditProfilePopup.vue:46, 78-81, 111`; `apps/extension/src/utils/token-order.ts:39-41`, `token-amount.ts:50`, `token-aggregate.ts:20-23` | both | Two separate root causes, both trivial. |
| Q-27g | Mint/transfer method vocabulary in 3–4 lists | `apps/extension/src/utils/token-transfer-vocabulary.ts:71-77`; `utils/tx-amount.ts:10, 40-45`; `utils/tx-enrichment.ts:17-25, 102-108` | claude | **Cross-model disagreement**: Codex says the contracts differ. Changing approval-card vocabulary is an owner UI call. |
| Q-27h | USD conversion implemented twice; rate-snap twins | `apps/extension/src/utils/fee-estimation.ts:28-39, 90-116` against `apps/extension/src/wallet/services/price/convert.ts:19-49, 76-113`; `convert.ts:24-35` against `:38-49` | claude (codex: rate helper only) | **Cross-model disagreement** on merging `feeToUsd`: it would lose the `<$0.001` hint. |
| Q-27i | AES-GCM `version‖iv‖ct` frame ×3 | `packages/wallet-crypto/src/encryption-key.ts:43-56, 68-96`; `imported-account-key-box.ts:45-77`; `imported-keys-dek-box.ts:38-73` | both | Byte-frozen; keep per-caller errors; `session-secret-box` is excluded. |
| Q-27j | Default-token addresses have two owners | `apps/extension/src/wallet/services/token/default-tokens.ts:44, 59, 71` against `apps/extension/src/wallet/services/price/price-map.ts:36, 39, 42` | codex (claude agreed) | Co-changed in `1d63ca40`. The repo map excluded `default-tokens.ts` as a data mirror, but this finding is about the second owner. |
| Q-27k | Artifact catalog keys listed three times | `packages/aztec-runtime/src/pxe/artifact-catalog.ts:35-47, 58-71, 74-87` | codex (claude partial) | Derive from the accessor table and keep insertion order. |
| Q-27l | Public-event cursor comparator across the package boundary | `packages/aztec-runtime/src/pxe/public-events.ts:192-197`; `apps/extension/src/wallet/services/incoming-transfer/public-event-indexer.ts:50-55` | codex (claude agreed) | Use a leaf `public-event-cursor.ts`. |
| Q-27m | Token-balance "row matches live token" idiom ×11 | `apps/extension/src/wallet/services/token-balance/service.ts:136, 185, 202, 211, 241, 256, 332, 552, 588, 659, 672` | claude (codex partial) | A private `liveTokenFor(row)`. Creation, backup and projector keep their own sources. |
| Q-27n | Imported signing-key unseal and wipe ×2 | `apps/extension/src/wallet/services/account/service.ts:378-400, 425-446` | claude (codex agreed narrowly) | A helper owning the scalar wipes; the caller keeps the DEK. |

- **Source raw ids:** q04-C-5, q04-X-3, q06-C-8, q06-X-4, q07-C-6, q07-X-2, q09-C-6, q09-X-4, q13-X-3, q09-C-8, q09-C-3, q09-C-4, q03-C-5 (rate half), q10-C-3, q10-X-2, q03-X-4, q11-X-2, q11-X-3, q03-C-3, q02-C-5 (unseal half).

---

## Dropped (with reason)

| Raw id | Reason |
|---|---|
| q05-C-7 | Price client quartet per consumer. The parent-owned client lifecycle is the documented convention. The claimed "dispose-before-disconnect" CLAUDE.md rule is reversed: CLAUDE.md orders `service.disconnect()` before `dispose()`. The subscription count is a performance argument. Codex disagreed and Claude conceded it was weaker. |
| q09-C-7 | Scope-key stringifiers ×5. Codex disagreed: the scopes have different dimensions and no shared change obligation, and the separator collision is hypothetical. |
| q13-C-7 | `0x`+64-hex regex ×6. Refuted: `usePinnedTokens.ts:38-39` lowercases before validating, so uppercase pins are not dropped. The set mixes tx hashes, modulus-bounded addresses and variable-length fields. |
| q11-C-10 | Init-nullifier check ×2 in `nulo-account.ts:172-174, 192-195`. Cosmetic, 2 sites, frozen account surface. |
| q10-X-3 | Mnemonic/passkey master reduction tail ×2. 2 sites, vector-frozen, dormant (1 and 5 commits); the win is marginal. |
| q02-C-3 (guard half) | "Live row" guard ×11. Codex showed the sites have different contracts (`getProfileDek` reads session state; `getPxeGeneration` returns `undefined`). Only the degraded-open tail is kept, in Q-17. |
| q02 Claude "both missed" (id allocation; `getProfileInfo` vs `toInfo`) | Below threshold. The reserved-aware allocation semantics differ. |
| q03-C-5 (decimals and decode half) | The seeder's 18-decimals bound and the decode helpers have deliberately different contracts (Codex). The hex counterexample is refuted: it is canonicalized. Only the rate-snap twins are kept, in Q-27h. |
| q06 Claude "both missed" (`prepareFpc` mirror) | Unverified by its own author. |
| q08 Claude "both missed" (Popover dead) | Refuted: `apps/extension/src/components/JsonViewer/LogsToolbar.vue:36` uses it. |
| q08 Claude "both missed" (AddressDisplay divergent change) | Different responsibilities do not by themselves establish Divergent Change. The design twin is dead (Q-26). |
| q05 Claude "both missed" (mount connect choreography) | A bug lead only (see the incidental bugs), not a quality finding. |
| q04 Claude "both missed" (workflow-tag comment) | A comment-rule violation. It is folded into the Q-04 refactoring note and the cross-cutting observations, not a finding. |
| q01-C-1 "already drifted" sub-claim | Narrowed: probe dedup deliberately includes already-attached hashes (Codex). The duplication finding stands in Q-02. |
| q12-C-2 incidental claim that DetailsTable and PermissionRow render wrong in light theme | Refuted: both have light overrides. The claim holds for about 16 other sites (Q-23). |
| q06-C-6 "five triple sites" | Narrowed to three equality sites; the other two are availability checks (Q-13). |
| q08-C-8 hover-drift sub-claim | Refuted: the later outline rule overrides it and matches `Button` (Codex). The duplication stands in Q-22. |
| q11-C-2 journal cross-chain bug as a quality driver | The reachability of mixed-chain session rows is unproven (lookup already specifies the chain). It is kept only as a bug lead; the sender-normalization duplication stands in Q-01. |

---

## Cross-cutting observations

1. **Shared primitives exist but adoption stalls, the dominant root cause of this run.** Of 27 findings, 14 are "a named helper exists and is bypassed":
   - `chainInfoFrom`, `walletChainId`, `networkInfoFrom`
   - `toBase64`/`fromBase64`/`getRandomHex`
   - `createRunFence`, `Lock`/`KeyedLock`
   - `useEntityCrud`, `useDappHostname`, `restoreRows`
   - `ListStatusMessage`, `Skeleton`, `detail-page.module.css`, `popup-shared.module.css`, `Button cta_outline`

   This is the same shape as 2026-08-16 Q-07, one level wider. A cheap guard like `log-payload-ban.test.ts` would stop regrowth: a grep ratchet test for the top idioms. Candidates:
   - `Buffer.from(…,"base64")`
   - `new Fr(nodeInfo.l1ChainId`
   - `^ … >>> 0`
   - `popupStore.len - popupStore.popups`
   - `@keyframes shakeInput`
   - `find((e) => e.id === …primaryEndpointId)`
2. **"Mirror" comments mark missing lowest-layer homes.** Examples:
   - `queued-journal.ts`: "inlined to keep test-harness-friendly", "Mirrors the dispatcher's normalization exactly"
   - `discovery-probe.ts`: "byte-mirrors"
   - `scopeCovers`: "deliberately mirrors enforcement"
   - `received/[id].vue`: "mirrors tx/[id].vue"
   - `export/full.vue`: "account.vue idiom"
   - `transfer-estimate-reuse.ts`: "must reproduce the exact product"

   `git grep -n -i "mirror"` is a productive next-dedup query. Every hit here became a finding.
3. **Wrong-layer homes force duplication.** Examples:
   - `withTimeout` in a Pinia store (packages cannot import it)
   - `walletChainId` in extension `utils/` while `aztec-runtime` needs it
   - `fingerprintBaseFee` in the transfer ladder
   - `NewProfileMethodTabs` at L4, which onboarding cannot import
   - `AuthwitCard` at L4 against the notes card at L6

   Several refactorings above are Move Function to the lowest legal layer (wallet-core utils, aztec-runtime utils, wallet-bridge `account-resolution`, extension L3 composites) rather than new abstractions.
4. **The design-system seam is half-done.** L0–L2 moved to `@nulo/design`; the L3 visual shells (rows, cards, toolbar button, password field, empty state) and two token roles (hairline, scrim) did not, while the package carries eight dead components from the departed tools app. `mount-all.test.ts` plus per-component tests keep dead exports looking live. Add an "every barrel export has a production consumer" check, the inverse of `boundary.test.ts`.
5. **Dead code left behind by moves:**
   - The tools/bridge move: 8 design components.
   - The design externalization: the extension font copies, the `EmojiGrid` twin, `SettingValue`.
   - Never-wired scaffolding: activity-protocol, the ArtifactRegistry policy, the no-op profile subscription, `SelectFpcPopup`.

   The repo-map exclusion list was partly wrong: `base.css` is hand-written. Its exclusion of the font directories hid a real dead copy.
6. **Drift already exists in security, privacy and identity paths.** Line count is the weaker signal; drift is the stronger one. Cases:
   - `incomingRows` lacks the profile guard (Q-06)
   - `patchAccountField` lacks the address check (Q-03)
   - `getNodeStatus` lacks the local override (Q-04)
   - the operation reuse ladder throws where the transfer ladder rejects (Q-05)
   - the batch ban omits `grantPublicAuthwit` (Q-11)
   - the transport allowlist's userinfo rule is schema-only (Q-04)
   - BalanceView lacks the add-dedupe (Q-12)

   Each is a duplicate that was fixed or extended on one side only.
7. **God files concentrate the duplication and keep growing.** Examples: `profile/service.ts` (2,797 lines, no complexity acceptance), `incoming-transfer/service.ts` (2,464), `dispatcher.ts` (1,794, +31% since 2026-08-16), `dapp-send-executor.ts` (1,107), `FeeSettingsCard.vue` (982). Four of the five were already named in 2026-08-16 Q-01. Extracting the duplicated scaffolds above shrinks them more safely than a class split.
8. **Duplicated logic breeds duplicated tests.** BalanceView and TokensView pin the same event and reconnect scenarios. Each deadline copy has its own tests. `errors.test.ts` hand-lists round-trips. Consolidation should move the tests to the shared unit, so the scenario is proven once.
9. **Comment-rule violations surfaced incidentally:** workflow and audit tags in `PopupManager.vue` ("P8 tactical C2 fix", "opus H-6") and in `network/spec.ts` ("Codex Round 2 B-3"), which CLAUDE.md bans.

---

## Incidental bugs (for the bugs run)

Deduplicated from all 26 raw files. Each entry is not judged deeply; the confidence shown is the reporter's.

| # | Location | Counter-example | Raw source |
|---|---|---|---|
| B-01 | `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:169-175` | Approve an `aztec_sendTx` with a valid `estimateId` while `getPredictedMinFees` throws transiently. `tryConsume` has no catch, so the already-consumed entry's send aborts with the raw node error instead of rebuilding. The transfer ladder catches the same call (`transfer-estimate-reuse.ts:205-208`). | q01-claude |
| B-02 | `apps/extension/src/wallet/services/fpc/service.ts:330, 375-377` | Pause `updateFpcAddress` at its PXE lookup and complete `updateFpc(id,"new")`. The resumed locked write spreads the stale `existing` and restores the old name. | q01-codex |
| B-03 | `apps/extension/src/wallet/services/account/service.ts:322-330` | `patchAccountField` validates profileId and chainId only. A transplanted row (key P,C,A with body address B) passes, and the write lands on `key(P,C,B)`, overwriting B's row. Low severity: it needs storage-writer access. | q02-claude (codex agreed) |
| B-04 | `apps/extension/src/wallet/services/profile/service.ts:1965-1985` | `exportMnemonic` throws the legacy string `"Invalid profile old password"`, not `InvalidPasswordError`. A lead only: it is pinned intentionally, and no failing caller has been shown. | q02-claude (codex disputed) |
| B-05 | `apps/extension/src/wallet/services/profile/service.ts:1010` | After a crash leaves a row plus a tombstone, `changeProfileName` writes the row and emits an update for a profile that reads hide. Already pinned by a BUG PIN at `service.integration.test.ts:3097`. | q02-codex |
| B-06 | `apps/extension/src/wallet/services/incoming-transfer/service.ts:1383-1415` | The note arm has no epoch re-check between the outgoing/in-flight reads and `resolveNoteTrust`, so a `clearProfile` bump in that window can write trust for a wiped profile. A lead, likely benign under the service lock. | q03-claude |
| B-07 | `apps/extension/src/wallet/services/incoming-transfer/service.ts:2445-2453` | `parseNoteAmount` accepts a negative `BigInt`, which the UI-side `parseRawBalance` regex rejects. The hex half is refuted (canonicalized). Very unlikely for a u128 note. | q03-claude (codex partial) |
| B-08 | `apps/extension/src/wallet/services/network/service.ts:734` | `getNodeStatus` omits `network.kind`. A local network (chainId 0) edited to `http://localhost:18080` against a node reporting 31337/1 returns `InvalidChain`; `probeNodeStatus` (`:753`) applies the override. High confidence. | q04-codex |
| B-09 | `apps/extension/src/wallet/services/network/service.ts:575-590` | `setActiveNetwork` on a row whose `primaryEndpointId` matches no endpoint writes the pointer and emits, then `getNode` throws later. `activateSeededLocked` (`:348`) asserts instead. Low confidence it is reachable. | q04-claude |
| B-10 | `apps/extension/src/popup/components/modules/general/BalanceView.vue:235-239` | A stale `Added` event arriving after the snapshot landed pushes a duplicate row, and `aggregateFiat` counts that holding twice until the next refetch. TokensView dedupes (`:197`). | q05-claude |
| B-11 | `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:740-780` | Unmount while `scopedTokens.reload()` is pending: the resumed mount calls `configService.connect()` and `incomingTransferService.connect()` (`:749, :754`) after cleanup, leaking ports. | q05-codex (claude agreed) |
| B-12 | `apps/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue:60` | `chunkAuthwits` initializes `feeSetting: null` (singular) while readers use `feeSettings` (`:66, :103, :211`). Latent typo. | q06-claude |
| B-13 | `apps/extension/src/popup/components/popups/SelectFpcPopup.vue:51` | Show, hide, show creates a second connected `FpcServiceClient` without disconnecting the first, so adds append twice. Unreachable today because the popup has no opener (Q-26). | q06-codex |
| B-14 | `apps/extension/src/popup/windows/json/index.vue:42`; `apps/extension/src/popup/windows/logger/index.vue:41` | Hash-router navigation unmounts without unload; `onClose` is never called, so the profile connection and logger subscription stay alive. | q06-codex |
| B-15 | `apps/extension/src/popup/pages/settings/advanced/index.vue:120-137` | Turning Developer Mode off calls `updateSetting("debugMode", false)` un-awaited. If that write rejects, the row is hidden while `debugMode` stays true, so debug logging continues invisibly. | q07-claude |
| B-16 | `apps/extension/src/popup/pages/settings/security/export/full.vue:375` | `name.replace(" ", "_")` replaces only the first space and keeps `/`, so a profile named `a/b c` yields `NuloBackup_a/b_c_<ts>.json`. `account.vue:174` already sanitizes with a regex. | q07-claude |
| B-17 | `apps/extension/src/popup/pages/settings/security/export/full.vue:316` | A passkey user who clicks Encrypt with an empty password sees the recommendation hidden and gets no toast or feedback. | q07-claude |
| B-18 | `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:113-144, 209-211` | `fetchAccounts` opens network and account clients that are never disconnected (unmount disconnects only the dApp-session client), so repeated visits leak ports. | q07-codex (claude partially confirmed) |
| B-19 | `apps/extension/src/popup/pages/profile/new-profile-helpers.ts:25-27` | `while (!appStore.isLogined) await sleep(100)` has no exit on `bootstrapFailure` or timeout, so creation stays pending forever and `useProfileCreateFlow.ts:103-104` keeps `isCreating` true. | q07-codex (claude confirmed) |
| B-20 | `apps/extension/src/components/composite/SecretUnlockSection.vue:26` | It relies on global classes defined only in `CollapsingHeroLayout.vue:235-250`, so it loses its layout outside that wrapper. Coupling risk; no broken page yet. | q08-claude |
| B-21 | `apps/extension/src/components/AddressDisplay.vue:68` | Changing the `address` prop on a mounted instance keeps showing the old address and contact name; both are populated only in `onMounted`. | q08-codex |
| B-22 | `apps/extension/src/components/JsonViewer/LogsViewer.vue:56` | With a 1,000-entry limit, arrival 1,101 trims to 1,001 before the pruning condition reads `filteredLogs`, so stale editor entries accumulate. | q08-codex |
| B-23 | `apps/extension/src/components/JsonViewer/LogsViewer.vue:158` | If `clearLogs()` rejects, the removed `onLogAdded` subscription is never restored and live logs stop. | q08-codex |
| B-24 | `apps/extension/src/components/JsonViewer/LogsViewer.vue:233` (cleanup `:252-257`) | Document selection listeners survive unmount and can restart the component timeout. | q08-codex |
| B-25 | `apps/extension/src/components/JsonViewer/LogsViewer.vue:189-200` | The fetch-vs-500 ms race never clears its timer and rejects with a bare string. On timeout the late real result is dropped. | q13-claude, q10-claude (overlaps Q-16) |
| B-26 | `apps/extension/src/onboarding/app.vue:23` | With a saved light preference and a dark OS, onboarding applies the default `"system"` without reading config, overriding the saved theme and its paint hint. | q08-codex |
| B-27 | `apps/extension/src/utils/activity-rows.ts:104-121` | `incomingRows` never calls `isForeignProfile`, unlike Home (`recent-activity-rows.ts:73`), so History could list a foreign-profile incoming record. A lead: `useIncomingTransfers.ts:115-117` filters live events by profile. | q09-claude (codex disputed reachability) |
| B-28 | `apps/extension/src/utils/tx-enrichment.ts:102-108` | `getTxCategory` titles `mint_to_commitment` "Mint" while `parseTransferIntent` treats it as `unverified`. A lead; possibly intended. | q09-claude |
| B-29 | `apps/extension/src/composables/useDappApprovalWindow.ts:123-129` | Unmount and dispose during a pending `init()`: when init settles, `start()` re-adds the `beforeunload` listener, holding the disposed window's reject closure. | q09-codex |
| B-30 | `packages/wallet-core/src/utils/event-handler.ts:40-48` | Register listeners A then B; A removes itself during `invoke()`. Splicing the live array skips B. Reproduced in memory, high confidence. | q10-codex (claude confirmed) |
| B-31 | `packages/wallet-bridge/src/dispatcher.ts:1072-1090` | `handleBatch` refuses only `sendTx` and `registerToken`. A raw client batching `grantPublicAuthwit` opens a popup inside the batch leg, the case the ban exists to close. Low severity: the popup still gates. | q11-claude |
| B-32 | `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:143` | The session address set is not chain-filtered, unlike `dispatcher.ts:1730-1736`, so a mixed-chain session row could file a journal record under an account the dispatcher rejects. Low confidence; rows are keyed per origin and chain. | q11-claude (codex disputed) |
| B-33 | `packages/third-party-notices/src/plugin.ts:65-71, 102-104` | On a watch rebuild after removing a stylesheet, its collector entry persists and `generateBundle` still emits the removed CSS dependency. | q11-codex |
| B-34 | `packages/design/src/ui/Popover.vue:76-85` | Unmount while open leaves the document scroll and keydown listeners attached. | q12-codex |
| B-35 | `packages/design/src/composite/AddressDisplay.vue:19-28` | The `copied` reset timer is never cleared, and a second click cuts the first short. Dead component (Q-26). | q12-claude |
| B-36 | About 16 hairline sites listed in Q-23(b) | In `[theme="light"]` the divider stays dark-hued `rgba(74,70,63,.2)` on white. Visual, not a crash. | q12-claude (codex refuted 2 of the sites) |
| B-37 | `apps/extension/src/wallet/services/dapp-session/integrity.ts:58-62` | `Buffer.from(mac,"base64")` never throws, so the catch is dead. A malformed MAC decodes to garbage and is rejected only by the length or verify checks (fail-closed). | q13-claude |
| B-38 | `apps/extension/src/wallet/services/account/spec.ts:68`; `apps/extension/src/wallet/services/transaction/spec.ts:223` | `ImportedAccountUnusableError` and `TxConfirmationTimeoutError` extend plain `Error` although they are documented as surfaced to the UI. After the RPC boundary they flatten to `Error`, so `instanceof` can never match. | q13-claude |
| B-39 | `apps/extension/src/utils/console-sniffer.ts:12-18` | An early `console.warn` is buffered without its method and replays through the next `info` hook, losing its level. Reproduced. | q13-codex (claude confirmed) |

## Routed to security

Items any agent flagged as security-flavoured, for the security run:

- **Non-constant-time comparison of secret-derived bytes:** `array_equals` at `packages/wallet-crypto/src/password-secret-box.ts:223` (guard compare on a public constant) and `apps/extension/src/wallet/services/profile/service.ts:2015, 2330` (re-derived against stored master). Source: q10-claude.
- **Batch ban omits the popup-gated `grantPublicAuthwit`:** `packages/wallet-bridge/src/dispatcher.ts:1072-1090` (B-31, Q-11).
- **Consent coverage and enforcement grant matching can diverge:** `packages/wallet-bridge/src/dispatcher.ts:204-271` against `method-scope-checkers.ts:38-64` (Q-19). The empty-function-name guard exists only in enforcement.
- **Selector/name "scope violation" guard implemented six times:** one of them (fast path) sits inside a `catch → fallback` boundary (Q-02).
- **Authwit message-hash derivation (the chain-binding guard) implemented three times** (Q-02a).
- **Anti-phishing hostname/IDN detector duplicated in the verify (trust confirmation) window:** `apps/extension/src/popup/windows/verify/index.vue:52-67` (Q-07a).
- **RPC transport allowlist has two owners, and only the schema rejects userinfo:** `apps/extension/src/wallet/services/network/spec.ts:151-178` against `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58-73` (Q-04d).
- **Composite chain identity and `ChainInfo` derivation duplicated across layers:** the storage-scoping and drifted-RPC anchor (Q-01).
- **Deletion-fence commit sequence and scoped-purge predicates hand-copied:** cross-profile deletion and orphaned rows (Q-03a–b). The row identity gate has drifted (`patchAccountField`, B-03).
- **Lenient `Buffer` base64 decoding on sealed-secret and MAC paths:** decode-policy choice per site (Q-15b). The dead catch is in `dapp-session/integrity.ts:58-62` (B-37).
- **`SessionSecretBox.wrapPair` makes a second live `Buffer` copy of the bearer token** only for encoding: `packages/wallet-crypto/src/session-secret-box.ts:91-102` (Q-15a).
- **Secret-page generation fences hand-rolled:** a missed check after a new `await` can write a payload back after scrubbing (Q-16c).
- **Estimate reuse "sign a cached request" validators duplicated with divergent error handling** (Q-05c, B-01).
- **Error identity lost across the RPC boundary** for UI-actionable errors (B-38).
