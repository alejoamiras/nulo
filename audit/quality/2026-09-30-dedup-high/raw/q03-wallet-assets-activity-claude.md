# q03-wallet-assets-activity — claude

Scope read: apps/extension/src/wallet/services/incoming-transfer/{service.ts (commit/trust/clear/scheduler/outbox regions), arrival-state.ts}, token-balance/{service.ts, balance-identity.ts, balance-projector.ts (grep), reconcile-pairs.ts (grep)}, token/{utils.ts, seeder.ts (decimals bounds), service.ts (grep)}, note/service.ts (decode helpers), activity-protocol/coordinator.ts (helpers), price/convert.ts, operation-journal (grep only), plus cross-boundary reads: auth-registry/service.ts (purge/restore), transaction/service.ts (purge/restore), restore-fence.ts (grep), utils/token-amount.ts. jscpd rows for the cluster checked. Change frequency since 2026-06-01: incoming-transfer/service.ts 22 commits, token-balance/service.ts 19, price/convert.ts 2, utils/token-amount.ts 2.

## q03-wallet-assets-activity-C-1: Note arm and public-event arm of incoming-transfer re-implement one commit pipeline twice (RECURRING, prior: 2026-08-16 Q-01 sub-point)

- **Smell:** Duplicate Code (Fowler), with Shotgun Surgery as the consequence: one workflow, two hand-copied arms.
- **Maintenance impact:** structural. Blast radius: 1 file, about 250 lines across 8 methods. Change frequency: 22 commits since 06-01, the hottest file in the cluster. The 08-16 audit cited this at `:1013-1083` / `:1712-1762`; it is still present at new line numbers.
- **Evidence:** both arms run "resolve token under lock, re-check epoch, skip if existing, dedupe own and in-flight tx hashes, resolve trust (unknown to pending plus emit), mark balance dirty BEFORE the record, upsert, emit Added if trusted and visible".
  - `resolveNoteTrust` (incoming-transfer/service.ts:1433-1453) and `resolvePublicTrust` (service.ts:2133-2158) are the same body. Both read trust, call `setTrust("pending")`, emit `onIncomingTrustChanged`, then emit an identical 8-field `onIncomingTransferPending` payload. The only differences are an extra epoch re-check in the public arm and `amountRaw` from `ev` rather than the note.
  - Dedupe: `commitScannedNote` (1383-1415) inlines `collectOutgoingTxHashes` plus `collectInflightTxHashes` with two `.has` checks. `isDedupedPublicEvent` (2113-2121) packages the same three sources as a method.
  - Commit: `commitDiscoveredNote` (1465-1492) and `commitPublicRecord` (2161-2172) both do `markBalanceDirty`, `buildRecord`, `repo.upsertRecord`, then `if trusted && isVisibilityEnabled -> emit Added`.
  - Record builders: `buildRecord` (2346-2376) and `buildPublicRecord` (2174-2196) set the same 11 shared fields: profileId, networkId, accountAddress, contract, tokenId, amountRaw, txHash, l2BlockNumber, txIndexInBlock, indexInTx, hidden, discoveredAt, blockTimestamp.
  - Token lookup: `tokens.find((t) => t.contract === contract && t.chainId === chainId)` appears at 1391 and 2083.
- **Why it harms future change:** adding a trust state, changing the Pending payload (a new field for the prompt UI), or adding a third dedupe source means editing two arms. The arms have already drifted: the public arm epoch-checks after every await and the note arm does not. A future fix to one arm silently leaves the other wrong.
- **Smallest safe refactoring:** Extract Function within the service. Add `promoteUnknownTrust(ctx, token, amountRaw): Promise<IncomingTrustState>` holding the setTrust/emit/visibility-gated Pending block. Add `emitAddedIfVisible(record, trustState)`. Add `commonRecordFields(...)` returning the shared field set, which each builder spreads. Keep the epoch checks at the call sites, which differ by design. No layer change.
- **What disappears:** about 45 duplicated lines. One trust-transition implementation instead of two, and one place where the Pending payload shape is written.
- **Instances:** incoming-transfer/service.ts:1433-1453, 2133-2158; 1465-1492, 2161-2172; 2346-2376, 2174-2196; 1383-1415, 2113-2121; 1391, 2083.

## q03-wallet-assets-activity-C-2: Account-scope purge and restore preamble hand-copied across row services (RECURRING, prior: 2026-08-16 Q-07 partial)

- **Smell:** Duplicate Code, with Shotgun Surgery as the consequence. The deletion-fence and scope-key semantics are a security-relevant invariant stated in prose and repeated in code.
- **Maintenance impact:** structural. Blast radius: 3 services (token-balance, auth-registry, transaction) plus their tests. Change frequency: token-balance/service.ts 19 commits since 06-01. jscpd flags this: rows 91 and 140 pair `auth-registry/service.ts:505-516` with `token-balance/service.ts:566-579` (12 lines) and `:589-597` with `:676-685` (9 lines).
- **Evidence:**
  - `purgeForAccounts(scopes, profileId)` exists in two services with the same head. Both do `ensureInitialized`, `if (scopes.length === 0) return`, and `keys = new Set(scopes.map((s) => \`${s.chainId}:${s.address}\`))`. Both then take `lock.withLock` and filter rows by `row.profileId === profileId && keys.has(\`${row.chainId}:${row.account}\`)`. The JSDoc is also copied nearly verbatim ("a bare-address match would destroy a sibling profile's rows ... ANOTHER chain"). Locations: token-balance/service.ts:574-600 and auth-registry/service.ts:512-535. `transaction/service.ts:301` is a third variant using `addresses` only.
  - The `restore` preamble is identical in three services: `ensureInitialized`, then `if (typeof profileId !== "string" || profileId.length === 0) throw new Error("restore requires the created profile id")`, then `getDeletionState()`, then `captureRestoreEpochs(deletion, [profileId])`. Locations: token-balance/service.ts:677-686, auth-registry/service.ts:589-597, transaction/service.ts:528-538. `restore-fence.ts` already extracted the epoch half, but the profile-id guard and the capture call are still pasted.
  - The scope key `${chainId}:${address}` is built inline in at least 5 places: token-balance/service.ts 580, 585, 600 (raw pass) and 345, plus auth-registry 515 and 520.
- **Why it harms future change:** adding a field to the scope tuple (for example networkId, once two networks share a chainId) must be changed in N services and N key-builder sites. Missing one reintroduces the exact "destroy a sibling profile's rows" bug the comments warn about.
- **Smallest safe refactoring:** Extract Function into `wallet/services/restore-fence.ts`, which already owns this concern. Add `requireRestoreProfileId(profileId)` returning the id, `scopeKey(chainId, address)`, and `makeScopeMatcher(scopes, profileId)` returning a row predicate. Optionally add `captureRestoreFence(profileService, profileId)` that does guard plus capture. Dependency direction is unchanged: services import a sibling helper.
- **What disappears:** about 30 lines of duplicated guard and filter code, and 5 inline key templates collapsed to 1.
- **Instances:** token-balance/service.ts:574-600, 677-686; auth-registry/service.ts:512-535, 589-597; transaction/service.ts:528-538; scope-key templates listed above.

## q03-wallet-assets-activity-C-3: "Row must match its live token" lookup+identity filter repeated 12 times in TokenBalanceService

- **Smell:** Duplicate Code, with Feature Envy as the secondary smell. Each site reaches into `this.tokens` and the row to re-ask one question the service should answer with a method.
- **Maintenance impact:** local, but high frequency: 19 commits since 06-01 on the file. Blast radius: token-balance/service.ts plus balance-projector.ts and reconcile-pairs.ts. The jscpd rows `service.ts:181-187 ~ 209-213` and `547-558 ~ 582-594` are this cluster.
- **Evidence:** the idiom `const token = this.tokens.get(row.token); token !== undefined && rowMatchesToken(row, token)` appears at token-balance/service.ts:134-137 (`isRowEmittable`), 183-188 (`getTokenBalance`), 199-204 (`getTokenBalances`), 209-214 (`refreshTokenBalance`), 238-243, 255-257 (`refreshAccountBalances`), 330-333 (inside `.find`), 552 and 588 (`live && rowMatchesToken(tb, live)` followed by `emit(..., getTokenBalanceInfo(tb))`, byte-identical in `purgeForTokens` and `purgeForAccounts`), 659, and 671-674 (export, via a different map). The same shape also occurs in balance-projector.ts:80, 185 and reconcile-pairs.ts:133, 138. The two "unknown token balance id" throw blocks at 183-188 and 209-214 are copies.
- **Why it harms future change:** the identity invariant (dead incarnation, foreign profile) is a fail-closed privacy and safety rule. Extending `rowMatchesToken` with a new identity field is safe, but changing the lookup source (for example `this.tokens` to a per-profile map) needs 12+ edits. A missed site leaks a foreign row into a list.
- **Smallest safe refactoring:** Extract Function (private methods on the service). Add `liveTokenFor(row): Token | undefined`, returning the token iff identity matches, and `isLiveRow(row)`. Add `requireLiveBalance(id)` for the two throw blocks, and `emitDeletedIfLive(tb)` for the two purge sites. No layer change.
- **What disappears:** about 40 lines, and 8 of the 12 `rowMatchesToken` call-site conditionals.
- **Instances:** token-balance/service.ts:134, 185, 200, 211, 240, 256, 332, 552, 588, 659, 672; balance-projector.ts:80, 185; reconcile-pairs.ts:133, 138.

## q03-wallet-assets-activity-C-4: Scheduler teardown and clear-scaffold still inlined in incoming-transfer (RECURRING, prior: 2026-08-16 Q-01 sub-point)

- **Smell:** Duplicate Code, with Shotgun Surgery (partly remediated).
- **Maintenance impact:** local. Blast radius: 1 file. The start side is already unified by `startPollScheduler` (service.ts:1018-1022), so this is a leftover, not a missed extraction.
- **Evidence:**
  - Note-scheduler teardown (`clearInterval` + `schedulers.delete` + `watchedContracts.delete`) is written inline at service.ts:447-451 and again at :1225-1231 (`detachTokenSchedulersLocked`). The public arm has the named `stopPublicScheduler` (1039-1045) doing the same thing.
  - `clearProfile` (702-729) and `clearChain` (731-757) share one scaffold: `withServiceLock`, `bumpServiceEpoch` first, `dropEpisodes`, evict the fee cache, `repo.clearX`, `hydrateSchedulers`, then re-evict in `finally`. The comments are paraphrased copies ("see clearProfile for the full rationale"). Only the repo call and the eviction predicate differ.
- **Why it harms future change:** the epoch-bump-first and evict-twice ordering is a subtle invariant. A third clear scope (for example clearAccount) is currently a copy-paste of a 25-line block with comments.
- **Smallest safe refactoring:** Extract Function `stopNoteScheduler(key)` mirroring `stopPublicScheduler`. Extract `clearScoped(dropPrefix, evictFee, repoOp)` as a private helper for the shared lock/epoch/hydrate/finally scaffold.
- **What disappears:** 2 inline teardown copies and about 20 lines of scaffold and comment.
- **Instances:** incoming-transfer/service.ts:447-451, 1225-1231, 1039-1045; 702-729, 731-757.

## q03-wallet-assets-activity-C-5: Amount primitives re-derived per service: numeric-string decode, decimals bounds, rate snapping

- **Smell:** Duplicate Code plus Config sprawl (a named analog: the same validation knob defined in N files with different values).
- **Maintenance impact:** local to structural. Blast radius: about 6 files across 3 layers (services, `utils/`, price). Change frequency is low (2 commits since 06-01 on `convert.ts` and `token-amount.ts`), so moderate weight overall.
- **Evidence:**
  - Decimals bound defined twice with different values. `utils/token-amount.ts:9,14` has `MAX_DECIMALS = 77` and `isValidDecimals`, which the UI, `incoming-dust.ts`, and `token-aggregate`/`token-order` all use. `wallet/services/token/seeder.ts:34,577` has a private `DECIMALS_MAX = 18` and re-inlines the check `Number.isInteger(d) && d >= 0 && d <= DECIMALS_MAX`. The seeder's stricter bound may be deliberate, but the integer/range predicate is a copy, and nothing ties the two constants together.
  - Canonical BigInt-string decode, each with its own try/catch:
    - `note/service.ts:23` (`BigInt(raw).toString()` in `decodeField`)
    - `incoming-transfer/service.ts:2445-2453` (`parseNoteAmount`: try `BigInt(value).toString()`, else null)
    - `incoming-transfer/arrival-state.ts:56-62` (`isPositiveAmount`: try `BigInt > 0n`, else false)
    - `utils/token-amount.ts:30-33` (`parseSide`, a regex-gated `BigInt`).
    - The service-side sites accept forms the UI-side `parseSide` rejects (hex `0x..`, negatives), so the same raw amount string can be "valid" at scan time and "malformed" at render.
  - `price/convert.ts:24-35` (`rateToMicroUsd`) and `38-49` (`rateToMicroUsdCeil`) are identical 10-line functions except `Math.round` vs `Math.ceil`.
- **Why it harms future change:** changing what a legal raw amount is (for example rejecting negatives or capping digits) needs 4 edits in 3 layers. Raising the seeder's 18-decimals cap requires knowing the other constant exists.
- **Smallest safe refactoring:** Move Function plus Parameterize Function. Put `parseRawAmount(s): bigint | undefined` (the regex-gated form) in a package-level util that both `utils/` and services may import. `@nulo/wallet-core` is the lowest common layer, or a new `wallet/services/amount.ts` if extension-only is enough. Have the seeder import `isValidDecimals` with its own extra `<= 18` clamp. Replace the two rate functions with one `snapRate(usd, round: (n: number) => number)`.
- **What disappears:** about 12 lines directly, and the drift risk between the scan-time and render-time definitions of a valid amount.
- **Instances:** token/seeder.ts:34,577; utils/token-amount.ts:9,14,30-33; note/service.ts:23; incoming-transfer/service.ts:2445-2453; incoming-transfer/arrival-state.ts:56-62; price/convert.ts:24-35,38-49.

## Non-findings considered

- `token/functions/descriptors.ts` and `token/service.ts` `getTokenInterface`/`parseTokenInterface`: the prior unrolled 9-way blocks (08-16 Q-09) are fixed (descriptor-driven), so skipped. `addToken`/`addSeededToken` now share `addTokenWithFence`.
- `token/utils.ts` `getTokenInfo` and `isTokenComplete`: each is a single flat list over the 9 fn kinds, and `getTokenInfo` is the only consumer of `hasX` mapping. A `TOKEN_FN_DESCRIPTORS`-driven version would be marginal. Not worth a finding.
- `price/service.ts` alarm handling and `operation-journal/{reaper,gc}.ts`: the alarm/periodic-task duplication is the prior Q-05, and it is outside the ask for new dedup. Not re-read in depth (only grep) and left to the prior report.
- `activity-protocol/coordinator.ts` `increment` (`BigInt(counter)+1n`): a one-liner over a different string domain (generation counters), not amount handling. Not merged into C-5.
- Service spec/client/service triad (`incoming-transfer`, `token-balance`, `note`, `price`, `operation-journal`): documented as deliberate in CLAUDE.md.
- Complex functions carrying accepted complexity directives: not re-flagged for complexity.
- jscpd css clones in `components/composite/activity/*` and `popup/pages/.../notes`: outside this cluster (UI), not audited here.
- `incoming-transfer/service.ts` size (2,464 LOC): prior Q-01 Large Class covers it. Its duplicated inner logic is captured in C-1 and C-4 instead.
- `utils/token-amount|aggregate|fold|order|search` vs services: the utils are pure UI-side display helpers and services do not re-implement sorting or aggregation. The only overlap is C-5.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/wallet/services/incoming-transfer/service.ts:1383-1415` (`commitScannedNote`) — after `collectOutgoingTxHashes` and `collectInflightTxHashes` (PXE-free but awaited), there is no epoch re-check before `resolveNoteTrust`. Only `commitDiscoveredNote` re-checks, after the `blockTimestampFor` await. The public arm checks the epoch after each read (2085-2109). Counter-example: a `clearProfile` epoch bump that lands between the trust read and `setTrust("pending")` can write a trust row and emit `onIncomingTrustChanged` for a wiped profile. Likely benign under the service lock, but unverified.
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:2445-2453` vs `apps/extension/src/utils/token-amount.ts:30-33` — `parseNoteAmount` accepts `BigInt("-5")` or `"0x10"` and stores them as `amountRaw`, whereas `parseRawBalance`'s regex rejects them. A negative or hex `content.value` would be persisted as a record and rendered as malformed. Very unlikely from a real UintNote (u128), so this is low-severity and possibly unreachable.

## Cross-rebuttal (claude on codex)

**Line-number corrections to my own report (re-read at HEAD):**
- C-2: `restore` preamble is token-balance/service.ts:676-685 (guard throw at 682, `captureRestoreEpochs` at 685), auth-registry/service.ts:589-597 (throw 594), transaction/service.ts:529-538 (throw 535). The scope-key template is at token-balance/service.ts:577, 581, 598 and auth-registry/service.ts:515, 518, 533, 536, so "5 places" is really 7. My earlier 580/585/600/345 were wrong; there is no key template at token-balance:345.
- C-3: the `rowMatchesToken` call sites are token-balance/service.ts:136, 185, 202, 211, 241, 256, 332, 552, 588, 659, 672 (plus 509, 529, which are repo-row filters against a raw token and do not belong to the idiom). balance-projector.ts:80, 185 and reconcile-pairs.ts:133, 138 were right. The count holds at about 11 in service.ts.
- C-5: `seeder.ts:34,577` and `token-amount.ts:9,14,27-30` are right (`parseSide` is at 27, not 30-33). `arrival-state.ts:59`, `note/service.ts:23` and `incoming-transfer/service.ts:2449` are confirmed.

**1. Codex findings**
- X-1 (trust policy x3): agree. It is the same code as my C-1 trust half, and its third copy (the replay pending-event construction at service.ts:1547) is one I missed. Codex is narrower: it skips the commit/record-builder/dedupe copies in C-1.
- X-2 (incoming clearProfile/clearChain plus repository five-store inventory): agree, and it extends my C-4. Verified repository.ts:221-244 lists the same five tables twice. I had only the service scaffold. The key-prefix-not-value-predicate constraint (repository.ts:223-226) is correct and must survive the refactor.
- X-3 (token-balance purgeForTokens/purgeForAccounts): agree. It is the same code as the 552/588 part of my C-3. Low-risk Extract Function.
- X-4 (default-token addresses in default-tokens.ts vs price-map.ts): agree. Verified the three literals match (default-tokens.ts:44/59/71, price-map.ts:36/39/42). The price-map testnet constant is named `UNLEASHED_USDC_TESTNET`, so the pair is coupled. I missed this entirely.
- X-5 (activity-protocol has no production consumers): agree, high confidence. A grep of extension src and packages/*/src finds `ActivityProtocolCoordinator` only in coordinator.ts and coordinator.test.ts. `ACTIVITY_PROTOCOL_SERVICE_NAME` appears only in spec.ts, and keyed-lock.ts:25 only mentions it in a comment. I wrongly treated `coordinator.ts` as live code and only grepped its helper. One caveat: the subsystem may be scaffolding for a planned activity feed. That is a product call for the owner, not a pure delete.
- Codex's non-finding on amounts/decimals ("differ deliberately") is only partly right. The seeder's 18 cap is plausibly deliberate, and I said so. But the scan-time vs render-time divergence on negative/hex strings (incoming-transfer/service.ts:2449 vs token-amount.ts:27-30) is a real drift risk.

**2. What Codex missed that I still stand by**
- C-1: commit/record-builder/dedupe duplication beyond trust (service.ts:1465-1492 vs 2161-2172, builders 2346-2376 vs 2174-2196).
- C-2: restore-preamble and purge-scope duplication across three services, which jscpd flags (rows 91 and 140).
- C-3: the repeated "row matches live token" idiom (about 11 sites).
- C-5: rate-snapping twins `rateToMicroUsd` and `rateToMicroUsdCeil` (convert.ts:24, 38), and the BigInt-string decode drift. Lower weight.

**3. What both missed**
- Duplicate Code / Shotgun Surgery: the `{ chainId, address }` scope tuple is typed inline as `ReadonlyArray<{ chainId: number; address: string }>` in token-balance/service.ts:574 and auth-registry/service.ts:512, and the same shape feeds `registerAccountPurgeSubscriber` at token-balance:147 and auth-registry:107. A named `AccountScope` type, exported from the account service contract, would give the subscriber signature and both purges one definition. It is small, but it is the precondition for C-2's `makeScopeMatcher`.
- Nothing else with file:line evidence.
