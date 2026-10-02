# harden-dedupe recon: the 2026-09-30 dedup findings re-checked against dev 8cfee502

The audit (`audit/quality/2026-09-30-dedup-high/`) ran at 910a4def. Since then `dev` landed 25 commits, among them #736 (Aztec 6.0.0-rc.1, the `@aztec-labs` / `@aztec-foundation` scopes, the V6 regime), #748 (execute reads standard-token transfers), #751 (V6 testnet token seeds), #752 (dApp unserved-chain notice) and #754 (home keeps three token rows). Four agents re-grepped every instance; their notes are below, unedited apart from heading levels.

## Status at a glance

| id | status | UI surface | drift the copies already have |
|---|---|---|---|
| Q-01 | still valid; the seed-preflight copy is gone | no | two wrong comments only |
| Q-02 | still valid; a third class-id implementation in aztec-runtime | no | intentional (fast path needs a name; per-site error text) |
| Q-03 | still valid (a–d); new restore variant in `network/service.ts:272` | no | `patchAccountField` gate checks 2 of 3 fields; `importAccount` unfenced (B-12) |
| Q-04 | still valid; B-09 live | yes: Add / Edit endpoint popups | B-09 local-kind carve-out; duplicate-URL copy differs; userinfo policy |
| Q-05 | still valid; B-08 live | no | B-08 (operation ladder aborts a send on a transient fee read) |
| Q-06 | still valid; TokensView adds a third scope predicate (#754) | yes: Home recent activity, Activity page | History ignores journal network; History skips incoming profile guard; empty-amount gate |
| Q-07 | still valid; network-unavailable window is a fourth `getRequestId` user | no for (a)–(c) | unguarded `remove(window.id)` in json/logger; error copy per window |
| Q-08 | still valid; fifth new-password pair in onboarding create | yes: login, import, new profile, change password, export | `autocomplete` missing in two forms; shake 0.3 s vs 0.4 s; no reduced-motion |
| Q-09 | still valid | yes: New / Edit contact validation | untrimmed name uniqueness; add/update policies differ |
| Q-10 | still valid | no | none accidental |
| Q-11 | still valid | no | batch ban omits `grantPublicAuthwit` (security, out of scope) |
| Q-12 | changed shape (line shifts from #754) | no for the extraction | BalanceView has no id dedupe on add |
| Q-13 | still valid; 25th site in `send.vue` | no if values are kept | none (`?? 0` vs NaN on a closed key) |
| Q-14 | still valid | yes: onboarding import/create, popup import, new profile | tablist aria-label; Enter shortcuts only in popup import |
| Q-15 | still valid | no | base64 decode strictness per site; record-guard meaning |
| Q-16 | still valid; `wallet-core/utils/sleep.ts` already exists; offscreen queue missed by the audit | logic only | LogsViewer never clears its timer; four queue rejection policies |
| Q-17 | still valid | no (degraded-keys event must keep firing) | none in (a)/(b); (d) stays out per the prior plan |
| Q-18 | still valid | no (incoming events must keep shape and timing) | the note and public arms re-check the epoch at different points |
| Q-19 | still valid | no | `scopeCovers` lacks the empty-name guard (unreachable) |
| Q-20 | changed shape: 24 classes, 22-member union | no | no-arg classes need per-class rebuild |
| Q-21 | still valid | no | blocked-delete policy unnamed; keyval lookup uses the boot snapshot in one copy |
| Q-22 | still valid; new sites `FormPopup.vue` and the network-unavailable footer | yes, every sub-item | `:last-child` vs `:last-of-type`; `overflow-wrap`; reduced-motion; no `:focus-visible` |
| Q-23 | still valid; 28 duplicate dark declarations, 18 hairline sites | yes for light-theme corrections | dark hairlines in light theme; scrim alphas by role |
| Q-24 | still valid; lines shifted (#751) | (a) no, (b) yes | none |
| Q-25 | still valid | no | none |
| Q-26 | still valid; FieldWarning, RowAction and Skeleton are now used, keep them | no (dead code) | none |
| Q-27 | partly fixed: (j) fixed, (g) grew, (a) moved | (c)(d)(f)(g)(h) user-visible logic | `mint_to_commitment` vocabulary; `EditProfilePopup` NFKC check; GBPC unpriced (not dedup) |

## Duplication baseline (dev 8cfee502, 2026-10-02)

- `bun run audit:dup`: **3.89 %** lines (16,467 of 422,834; 1,337 clones). Production 246 clones / 5,225 lines; test↔test 1,085 / 12,521.
- Scoped production figure, `implementations-plan/harden-dedupe/tools/scoped-dup.sh` (extension `src` plus every `packages/*/src`, tests, e2e, stories and generated `.d.ts` excluded, min-tokens 50, jscpd 5.0.16): **1.81 %** (3,993 of 220,917 lines, 225 clones). The audit's 2.0 % (3,745 of 186,580) used an unrecorded ignore set, so the two are not comparable; the program measures before and after with this script only.

## Per-finding notes

### Re-baseline part-1 (Q-01, Q-02, Q-04, Q-05, Q-10, Q-11, Q-19) against dev 8cfee502

Baseline note: since 910a4def the only edits under these files are the `@aztec/*` -> `@aztec-labs/*` import renames, #752's typed `ChainNotSupportedError` in `dispatcher.ts` (`resolveNetwork`; the extra import lines shift everything below :107 by +6, then +2 more after :1752), and the V6 rewrite of `authwit-discoverer.ts`, `view-executor.ts`, `batched-view-simulation.ts`, `fast-path.ts`, `service.ts`, `tx-request-builder.ts` (line shifts only; no dedup was done). None of the seven findings was fixed or restructured. All paths below are repo-relative.

### Q-01 — STILL-VALID (one instance dropped, line numbers shifted)

**Instances (current)**
- (a) Composite chain id `(l1ChainId ^ rollupVersion) >>> 0`. Owner: `apps/extension/src/utils/chain-ids.ts:12-14` (`walletChainId`). Copies:
  - `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:101`
  - `packages/aztec-runtime/src/utils/chain-identity.ts:59` (inside `assertLiveChainIdentity`)
  - `apps/extension/src/wallet/services/network/service.ts:1016` (was :1010; inside `_probeChainIdentity`)
  - `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:16-21` (`chainInfoToChainId`; used by `background.ts:646, 761, 1281`)
  - `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:45-56` (private copy, used at :128)
  - Dropped: `apps/extension/scripts/seed-preflight.ts` no longer computes the formula (`seed-preflight-node.ts` compares raw constants). Non-copy user: `apps/extension/src/core/testing/fake-node-factory.ts:51` already calls `walletChainId`.
- (b) Hand-written `ChainInfo` literals (owner `chainInfoFrom`, `packages/aztec-runtime/src/utils/chain-identity.ts:73-75`), all under `apps/extension/src/wallet/services/execution/`, still 10:
  - `authwit-discoverer.ts:118, 173-174, 222-223, 236-237`
  - `discovery-probe.ts:79`
  - `dapp-send-executor.ts:1005`
  - `view-executor.ts:220`
  - `fast-path.ts:228-229`
  - `service.ts:1027-1028`
  - `helpers/batched-view-simulation.ts:364-365` (same file uses `chainInfoFrom` at :205; `tx-request-builder.ts:303` also does)
  - The unnamed fetch + `assertLiveChainIdentity` clump precedes: `authwit-discoverer.ts:115-117`, `view-executor.ts:218-220`, `fast-path.ts:221-229`, `service.ts:1024-1028`, `batched-view-simulation.ts:361-365`, plus `discovery-probe.ts:77-79` and `dapp-send-executor.ts:1003-1005`.
- (c) NO_FROM sender normalisation, 3 copies + 1 bare literal:
  - `packages/wallet-bridge/src/dispatcher.ts:191-193` (`isNoFromRequest`), `:198-200` (`requestedFromOf`); users at :1118, :1123, :1622
  - `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:84-89` (`extractSendFrom`; inlines the `"NO_FROM"` literal)
  - `apps/extension/src/wallet/services/execution/utils/fee-detection.ts:18-20` (exported `isNoFromRequest`; no non-test consumer left in `src/`, still has its own test)
  - Session address sets (distinct contracts, stay distinct): `dispatcher.ts:445` (`sessionAccountsOf`, raw + CAIP, unfiltered), `dispatcher.ts:1736-1742` (`getSessionAccountAddresses`, chain-filtered), `queued-journal.ts:143` (CAIP-parsed, unfiltered).

**Changes since audit**: pure line shifts (dispatcher +6/+8, `network/service.ts` +6). `seed-preflight.ts` formula copy gone. No new copies of any of the three rules.

**UI surface**: no.

**Drift to align** (no behavioural drift; two comments that are wrong today)
- `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:116` says `assertLiveChainIdentity` "is a noop for local (chainId=0)"; false, the L1/rollup-version checks at `packages/aztec-runtime/src/utils/chain-identity.ts:47-57` run before the local return at :58.
- `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:45` says it mirrors `background.ts`; the function moved to `session-established.ts`.
- Session-set contracts differ by design: `queued-journal.ts:143` is not chain-filtered, `dispatcher.ts:1736` is (reachability disputed in the audit; not part of the refactor).

**Notes for batching**
- `dispatcher.ts` (`requestedFromOf`, :191-200) is shared with Q-11 (inside the planning block Q-11 would move) and Q-19.
- Execution-dir files `authwit-discoverer.ts`, `discovery-probe.ts`, `dapp-send-executor.ts`, `fast-path.ts`, `service.ts`, `view-executor.ts`, `batched-view-simulation.ts` are shared with Q-02 (same decode loop / fetch-and-assert clump): do the `liveChainInfo` hoist and Q-02's `decode-authwit-effects` together.
- `network/service.ts` is shared with Q-04.
- Blast radius: 15 files (aztec-runtime 2, wallet-bridge 1, extension 12).

### Q-02 — STILL-VALID (all instances hold; line numbers shifted in `service.ts`)

**Instances (current)** (under `apps/extension/src/wallet/services/execution/` unless noted)
- (a) Authwit effect decode loop (effects -> live chain identity -> `CallAuthorizationRequest.fromFields` -> `computeAuthWitMessageHash` -> `toDiscoveredAuthwit`, skip malformed): `authwit-discoverer.ts:104-141`, `discovery-probe.ts:62-101`, `dapp-send-executor.ts:1000-1019`.
- (b) Selector/name binding guard, six sites: `tx-request-builder.ts:340-348` and `:587-599` (`validateEncodedCallFn`), `authwit-discoverer.ts:194-205`, `service.ts:1049-1057`, `view-executor.ts:374-380`, `fast-path.ts:131-140` (inside the `catch -> return null` boundary; requires a name). Related non-guard lookup: `helpers/batched-view-simulation.ts:628-629` (`encoded_call` selector lookup with no name check; the view executor binds before batching, so likely not a seventh guard, but confirm when `assertSelectorBinding` is wired).
- (c) Class-id integrity: `service.ts:840-843` and `:987-990` (were :834-837/:981-984). Third implementation: `packages/aztec-runtime/src/pxe/artifact-class-id.ts:52` (`verifyArtifactClassId`, returns `undefined`). Different-purpose computation (catalog memo): `packages/aztec-runtime/src/pxe/artifact-catalog.ts:94`. Instance-to-artifact hops: `fast-path.ts:129-130`, `view-executor.ts:99-101, 372-373`.

**Changes since audit**: line shifts only (`service.ts` +6). V6 added `packages/aztec-runtime/src/pxe/effective-class.ts` (current class := original class shim); it does not change the integrity sites.

**UI surface**: no (error strings reach dApps via RPC only; frozen error text is pinned by tests, `contract-resolver.ts:55-58`).

**Drift to align** (intentional, preserve; no accidental drift)
- Fast path requires a name (`fast-path.ts:138`); the other five allow an absent one.
- Error text differs per site: "authwit call name" at `authwit-discoverer.ts:200`, `service.ts:1055`; "call name" at `tx-request-builder.ts:346, 595`, `view-executor.ts:379`, `fast-path.ts:139`.
- Probe dedupes by message hash (`discovery-probe.ts:89`) and has a single-shot `used` gate; the discoverer and send executor do not.

**Notes for batching**
- Same execution-dir files as Q-01(b) (`authwit-discoverer.ts`, `discovery-probe.ts`, `dapp-send-executor.ts`, `service.ts`): do (a) together with Q-01's `chainInfoFrom` swap.
- `service.ts` and `dapp-send-executor.ts` are also Q-05/Q-10 files.
- `packages/aztec-runtime/src/pxe/artifact-class-id.ts` is the home for a throwing `assertArtifactClassId`.

### Q-04 — STILL-VALID (B-09 drift still live)

**Instances (current)**
- (a) Primary-endpoint lookup, still 15 copies (`find((e) => e.id === <net>.primaryEndpointId)`):
  - `apps/extension/src/wallet/services/network/service.ts:340` (`!`), `:415` (`?? endpoints[0]`, deliberate), `:587`, `:737`, `:753`, `:775`, `:852`
  - `apps/extension/src/wallet/services/network/spec.ts:93` (`networkInfoFrom`, throws), `:107` (`primaryEndpointUrl`, `endpoints?.`)
  - `apps/extension/src/wallet/services/execution/transfer-executor.ts:377`, `dapp-send-executor.ts:470`, `operation-estimate-reuse.ts:141`, `transfer-estimate-reuse.ts:181`
  - `apps/extension/src/wallet/services/incoming-transfer/service.ts:536` (`endpoints?.`, fail-soft null)
  - `apps/extension/src/popup/components/popups/EditNetworkPopup.vue:58`
  - `getNetworkInfo` (`network/service.ts:849-855`) is a verbatim copy of `networkInfoFrom` (`spec.ts:92-96`).
  - Not copies (identity comparisons only): `apps/extension/src/popup/pages/settings/networks/[id].vue:84, 96, 201, 202, 219`.
- (b) `getNodeStatus` (`network/service.ts:732-747`) vs `probeNodeStatus` (`:749-766`): same skeleton, drifted (below).
- (c) Identity guard duplicate: `addEndpoint` `network/service.ts:609-620` and `updateEndpoint` `:656-667`; preamble (peek, probe outside lock, locked re-read) `:598-608` and `:644-655`; `label?.trim() || undefined` at `:629`, `:677`.
- (d) Transport allowlist: `apps/extension/src/wallet/services/network/spec.ts:151-178` (`RpcUrlSchema`) vs `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58-73` (`isAllowedRpcUrl`). No `packages/wallet-core/src/utils/rpc-url.ts` exists yet.
- (e) Popup error ladders: `apps/extension/src/popup/components/popups/NewEndpointPopup.vue:54-63`, `EditEndpointPopup.vue:68-77`.
- Comment-rule violation still present: `network/spec.ts:140` and `:172` ("codex Round 2 B-3").

**Changes since audit**: `network/service.ts` line shifts (V6 edits, 68 lines changed); no structural change; `spec.ts`, the three popups and the adapter logic are unchanged (adapter only renamed imports).

**UI surface**: yes for (e) and the popup leg of (a): `NewEndpointPopup.vue` and `EditEndpointPopup.vue` (Add/Edit endpoint popups, Settings -> Networks -> network detail), `EditNetworkPopup.vue` (default-fill handler only). Service-side (a)-(d) have no UI impact except through node status (B-09).

**Drift to align** (behaviour-alignment items; owner sign-off where marked)
- B-09: `getNodeStatus` calls `this._getChainId(primary.rpcUrl)` with no kind hint (`network/service.ts:740`); `probeNodeStatus` applies the local-kind carve-out (`:757-760`). An edited Local Network endpoint reads `InvalidChain` via `getNodeStatus`. Fixing it changes a visible status: owner sign-off.
- Userinfo: `RpcUrlSchema` rejects `user:pass@host` (`spec.ts:166`); adapter `isAllowedRpcUrl` accepts it (`aztec-node-factory-adapter.ts:58-73`). Policy difference; aligning needs owner sign-off.
- Popup copy: duplicate-URL message differs: "This URL is already an endpoint of this network." (`NewEndpointPopup.vue:59`) vs "Another endpoint of this network uses that URL." (`EditEndpointPopup.vue:73`). Chain-mismatch text differs only by `network.value?.chainId` vs `network.value.chainId` (`NewEndpointPopup.vue:57`, `EditEndpointPopup.vue:71`). A shared `endpointErrorMessage` must take the duplicate copy as a parameter, or the owner picks one string.
- No-primary policies diverge by design: `!` (`service.ts:340`), `?? endpoints[0]` (:415), throw (`spec.ts:93`, `service.ts:852`), `undefined` (`spec.ts:107`), soft reject (`transfer-estimate-reuse.ts:182-184`) vs single reason (`operation-estimate-reuse.ts:143`), `return undefined` (`dapp-send-executor.ts:471`), `return null` (`incoming-transfer/service.ts:537`).

**Notes for batching**
- `network/service.ts` also hosts Q-01(a) (:1016 formula).
- `transfer-executor.ts`, `dapp-send-executor.ts`, `operation-estimate-reuse.ts`, `transfer-estimate-reuse.ts` are Q-05 files; the `findPrimaryEndpoint` swap and Q-05's snapshot-capture helper touch the same producer and ladder lines, so do them in one PR or land Q-04(a) first.
- Blast radius: 11 files + the aztec-runtime adapter (12); `wallet-core/utils` gets a new leaf for the predicate.

### Q-05 — STILL-VALID (line numbers unchanged; only import renames in these files)

**Instances (current)** (under `apps/extension/src/wallet/services/execution/`)
- (a) Task wrapper (`startEstimateTask` already exists at `fee/fee-strategy.ts:350`; the complete/fail wrapper is still hand-rolled): `fee/fee-juice-strategy.ts:25-72`, `fee/fee-juice-with-claim-strategy.ts:25-46`, `fee/embedded-strategy.ts:32-50`, `fee/fpc-strategy.ts:136-199` and `:207-304`.
- Folded probe: `fee/fee-juice-strategy.ts:33-58`, `fee/fpc-strategy.ts:153-176` and `:221-258`. Rebuild predicates differ on purpose (`:164` vs `:237`).
- FPC finalize tail: `fee/fpc-strategy.ts:177-200` and `:259-302`.
- Validated re-sim option literal `{ simulatePublic: true, skipFeeEnforcement: true, scopes: [...] }`: 6 copies at `fee/fee-juice-strategy.ts:54`, `fee/fee-juice-with-claim-strategy.ts:39`, `fee/embedded-strategy.ts:42`, `fee/fpc-strategy.ts:172, 254, 280`; owner is the else-branch of `probedFirstSimOpts`, `fee/fee-strategy.ts:157-170`. One more same-shaped literal: `helpers/batched-view-simulation.ts:543-547` (slow-arm sim); decide at batch time whether it joins `validatedSimOpts`.
- (b) Fee composition `predictedWorstMinFees(node).mul(multiplier)`: `fee/fee-strategy.ts:289-290`, `fee/fpc-strategy.ts:177` and `:261`, `operation-estimate-reuse.ts:161`, `transfer-estimate-reuse.ts:197-204` (re-wraps `GasFees`).
- Priority->multiplier ternary x3: `service.ts:1109` (was :1103; yields `undefined`, the strategy then defaults), `operation-estimate-reuse.ts:160`, `transfer-estimate-reuse.ts:198-200`. `?? DEFAULT_FEE_MULTIPLIER`: `fee/fee-strategy.ts:272`, `fee/fpc-strategy.ts:135, 206`; defined at `fee/fee-strategy.ts:65`.
- (c) Snapshot producers `transfer-executor.ts:370-410` (within :343-430) and `dapp-send-executor.ts:462-505` (within :440-520); validators `transfer-estimate-reuse.ts:148-216`, `operation-estimate-reuse.ts:108-177`; `fingerprintBaseFee` still at `transfer-estimate-reuse.ts:44` (imported by `operation-estimate-reuse.ts:39`, `dapp-send-executor.ts:57`, `transfer-executor.ts:44`); `estimate-reuse-shared.ts` exists (cache + pending-set only). Live-handle re-resolution `transfer-executor.ts:298-316`, `dapp-send-executor.ts:796-819`.

**Changes since audit**: none structural; V6 import renames only. Side note: `estimate-reuse-shared.ts:2` carries a "Q-10:" plan-tag comment that violates the comment rule; fix if the file is touched.

**UI surface**: no.

**Drift to align**
- B-08 (live bug, unchanged): the operation ladder runs `getNode` and `predictedWorstMinFees` outside any `try` (`operation-estimate-reuse.ts:159-161`), so a transient fee read aborts a send whose entry was already consumed; the transfer ladder catches it and rejects softly (`transfer-estimate-reuse.ts:195-209`, "base fee fetch failed"). Not a refactor side effect; separate bug PR. Visible only as failed send vs rebuilt estimate: flag to owner as behaviour alignment.
- Only the transfer ladder re-wraps `GasFees` before `.mul` (`transfer-estimate-reuse.ts:204` vs `operation-estimate-reuse.ts:161`); primary-endpoint rejection reasons differ ("no primary endpoint" + "primary endpoint changed", `transfer-estimate-reuse.ts:182-187`, vs a single "primary endpoint changed", `operation-estimate-reuse.ts:143`).
- Ladder step orders differ and are pinned by tests (keep).

**Notes for batching**
- Shares `transfer-executor.ts`, `dapp-send-executor.ts` and both reuse files with Q-04(a) and Q-10 (`dapp-send-executor.ts:528-541` producer is the same region as the Q-05(c) snapshot capture); `service.ts` with Q-01/Q-02.
- Strategy-side hoists (`withEstimateTask`, `validatedSimOpts`, probe-fold) touch only `fee/*` and can ship independently of the reuse half.
- `packages/aztec-runtime/src/fee-juice.ts:18` is where `committedMaxFees`/`resolveFeeMultiplier` would live.
- Blast radius: 10 files in `execution/` + `aztec-runtime/fee-juice.ts`.

### Q-10 — STILL-VALID

**Instances (current)** (under `apps/extension/src/wallet/services/`)
- Declaration: `transaction/service.ts:155-170` (12 positional params, last four optional).
- Producers: `execution/transfer-executor.ts:182-214`, `execution/dapp-send-executor.ts:528-541` (in `sentTxRecorder`, declared :525) and `:919-932` (NO_FROM, re-spells the recorder).
- Forwarding adapters: `execution/service.ts:356` and `:425` (were :350/:419); indexed type decls `execution/transfer-executor.ts:88-90`, `execution/dapp-send-executor.ts:177-179`.
- `AddTransactionArgs[0|3|5|11]` projections: `execution/dapp-send-executor.ts:125-138`.
- Test callers to migrate: `transaction/service.test.ts:68`, `transaction/service.dropped.test.ts:106`; mock-arg reads `execution/dapp-send-executor.test.ts:246, 285, 562, 932`, `execution/transfer-executor.test.ts:142, 175`.
- Tails (`execution/dapp-send-executor.ts`): `getCalls` thunk `:677-683` vs `:874-880`; `wantOffchainOutput` `:736-739` vs `:914-917`; `NO_WAIT` return `:754` vs `:935`; signal-form `checkCancelled` `:255, 295, 369` and `execution/transfer-executor.ts:350-352` (controller form at `transfer-executor.ts:131` and `dapp-send-executor.ts:250-256` differs).

**Changes since audit**: none (no producer or declaration line moved; import renames only; `execution/service.ts` adapters +6).

**UI surface**: no.

**Drift to align**: none accidental. NO_FROM's zero nonce / external payment / absent authwit write are intentional but undocumented at `dapp-send-executor.ts:919-932`.

**Notes for batching**
- Same files as Q-05(c) (`dapp-send-executor.ts` 440-540, `transfer-executor.ts` 343-430) and Q-04(a) (`:470`, `:377`); `dapp-send-executor.ts` is also in Q-01 and Q-02. Land Q-10 before or with the Q-05(c) snapshot helper so the producer is rewritten once.
- Blast radius: 3 production files + 2 adapters in `execution/service.ts` + about 7 test files.

### Q-11 — STILL-VALID (dispatcher grew 1794 -> 1802 lines; stale batch ban unchanged)

**Instances (current)** (`packages/wallet-bridge/src/dispatcher.ts`; shifted +6/+8)
- Pure capability-planning block: `:191-770` (coverage helpers :210-296, projectors :300-430, `sessionAccountsOf` :445, `computeCapabilityDelta` :506, `mergeGrantsAndRejections` :546, `consentDecision` :592, `collectNewGrants` :659, `isCapabilityCovered` :703, `storedGrantAnswer` :743). `packages/wallet-bridge/src/capability-negotiation.ts` does not exist.
- Routing ladder: `:938-972` (isTokenRegistered / batch / sendTx / registerToken / grantPublicAuthwit / createAuthWit).
- Hard-coded batch ban: `:1078-1096` (`method.name === "sendTx" || "registerToken"`); still omits popup-gated `grantPublicAuthwit`. `packages/wallet-bridge/src/method-descriptors.ts` has no `popupGated` field (only `routing: { via: "handler" }`, prose notes at :194, :214, :283, :287).
- Handlers: `handleSendTx` `:1111-1154`, `handleCreateAuthWit` `:1164-1212`, `handleRegisterToken` `:1234-1258`, `handleGrantPublicAuthwit` `:1269-1311`.
- `unwrapResult`: `:1799-1801` (delegates to exported `unwrapOperationResult`, :169); called at `:859, 1154, 1200, 1212, 1258, 1311`.

**Changes since audit**: #752 added the `ChainNotSupportedError` import and a typed throw in `resolveNetwork` (`:1752-1757`), unrelated to this finding. No extraction, no other change.

**UI surface**: no (the batch-ban message reaches dApps via RPC error only).

**Drift to align**: the batch refusal list omits `grantPublicAuthwit` (`dispatcher.ts:1090`) although the routing ladder gates it through a popup (`:966-968`), so a raw protocol client can currently run it inside a batch. Security-routed in the audit; owner call whether the refusal set widens when derived from the registry.

**Notes for batching**
- Same file as Q-19 (`scopeCovers` :225, `contractsRequestCovered` :210, `privateEventsCovered` :269, `grantsOfType` :692 all live in the block Q-11 would move) and Q-01(c) (`isNoFromRequest`/`requestedFromOf` :191-200 inside the block). Do Q-19 first (leaf `scope-matching.ts`), then Q-11's move; decide where `requestedFromOf` lands (Q-01(c) wants `account-resolution.ts`) before moving.
- Touches `method-descriptors.ts` (and its test) for `popupGated`.
- Blast radius: 2 files + new module; dispatcher has 29 commits, so merge-conflict risk is the main cost.

### Q-19 — STILL-VALID

**Instances (current)** (`packages/wallet-bridge/src/`)
- `scopeCovers` `dispatcher.ts:225-235` vs `matchesPattern` `method-scope-checkers.ts:38-43` (same `contract === "*" || sameFieldAddress` and `function === "*" ||` rule).
- Address-list coverage: `contractsRequestCovered` `dispatcher.ts:210-222` and `privateEventsCovered` `:269-278` vs `inAddressList` `method-scope-checkers.ts:57-60`.
- `grantsOfType`: `dispatcher.ts:692-694` (typed `K extends Capability["type"]`) vs `method-scope-checkers.ts:62-64` (untyped `T`).
- Enforcement-only empty-function-name guard stays separate: `method-scope-checkers.ts:45-54` (`matchesScope`, `fn === ""` refuses).
- No new copies elsewhere (`apps/extension/src/popup/windows/capabilities/details-table.ts:73` is display-only; `method-scope-checkers.ts:407` is a shape check).

**Changes since audit**: dispatcher lines +6 only; `method-scope-checkers.ts` unchanged.

**UI surface**: no.

**Drift to align**: `scopeCovers` (`dispatcher.ts:225-235`) has no empty-function-name guard, while enforcement refuses `fn === ""` against any scope including `"*"` (`method-scope-checkers.ts:45-54`). Currently unreachable: the capability projector rejects `function === ""` as malformed (`dispatcher.ts:335`) before coverage runs. Sharing `matchesPattern` keeps it unreachable; no behaviour change to sign off.

**Notes for batching**
- Same file as Q-11 and Q-01(c); smallest of the three, land first (leaf `scope-matching.ts`, independent of Q-11).
- Blast radius: 2 files + new leaf; tests: `method-scope-checkers.test.ts`, `scope-enforcement.test.ts`, `dispatcher.test.ts`.
### Rebase part-2 (Q-03, Q-17, Q-18, Q-20, Q-21, Q-25) against dev 8cfee502

Method: grep of every cited instance plus `git diff 910a4def HEAD` per file. Across all six findings the only edits since the audit are the `@aztec/*` to `@aztec-labs/*` import renames, plus the network-service and errors.ts changes noted below. None of the six touches a .vue, CSS or user-facing string.

### Q-03 — STILL-VALID (parts a, b, c, d; part e stays dropped)

**Instances (current)** (all under `apps/extension/src/wallet/services/`)
- (a) Fenced commit, 7 sites in 6 files. Every one is `assertCurrent` → write → `isCurrent` re-check → delete → `throw new Error(\`profile ${id} deleted\`)`.
  - `fpc/service.ts:230-238` and `:293-302`
  - `contact/service.ts:116-123`
  - `dapp-session/service.ts:203-210`
  - `network/service.ts:317-322` (`seedOneNetworkLocked`; was `:325-330`) and `:485-491` (`addNetwork`; was `:494-499`)
  - `token/service.ts:412-422`. Its network leg stays local.
  - Related, not an instance: `token/service.ts:459-463` (`assertCurrentBeforeEmit`) throws the same string.
  - No new copy anywhere in `apps/` or `packages/`. A grep for `profile ${…} deleted` finds exactly these 8 throws.
- (b) Purge pipelines.
  - `auth-registry/service.ts:505-535` (`purgeForAccounts`, 512 is the signature), `:541-553` (`purgeForProfile`) and `:557-573` (chain).
  - `token-balance/service.ts:541-561` (`purgeForTokens`) and `:574-601` (`purgeForAccounts`). A different mechanism, as `verified.md` concluded.
  - Scope-key template `${chainId}:${address}`: `auth-registry/service.ts:515, 518, 533, 536` and `token-balance/service.ts:577, 581, 598`.
  - Inline scope tuple type: `auth-registry/service.ts:512` and `token-balance/service.ts:574`. Also `account/service.ts:811, 819, 837, 849` and `account/spec.ts:235` for the purge subscriber and `reconcileImportedAccounts`, which is the natural home for an `AccountScope` type.
- (c) Restore preamble, with the `"restore requires the created profile id"` guard:
  - `token-balance/service.ts:681-685`
  - `auth-registry/service.ts:593-597`
  - `transaction/service.ts:534-538`
  - Variant without the string guard: `network/service.ts:272` (`seedDefaultsForProfile`; it checks that the profile exists instead).
  - Hostile-row casts `(x as { profileId?: unknown } | null)?.profileId` into `captureRestoreEpochs`: `contact/service.ts:287-290`, `account/service.ts:674-677` and `:766-769`, `token/service.ts:858-861`.
  - `config/service.ts:62-84` still hand-rolls the restore loop. It skips non-allowlisted keys with no result row, so it becomes filter-then-`restoreRows`. Low value.
  - Helpers: `restore-fence.ts:19` (`captureRestoreEpochs`) and `restore-rows.ts` (`restoreRows`). No `requireRestoreProfileId` exists yet.
- (d) Row identity gate: `account/service.ts:180`, `:339`, `:409` (was `:408-411`) and `account/imported-keys-repository.ts:28`.
  - **Drifted:** `account/service.ts:322`.
- None of `fencedSet`, `rowMatchesKey`, `requireRestoreProfileId`, `AccountScope` or `accountScopeKey` has been introduced.

**Changes since audit**
- `network/service.ts` gained `seedingProfiles` and `servesChain`, and the seed list lost "Alpha V5". Line numbers moved by a few lines. No fence logic changed.
- `account/service.ts`, `auth-registry/service.ts` and `transaction/service.ts` changed only in imports. No new instances, and none dropped.
- `importAccount` (`account/service.ts:458`) still has no `assertCurrent`. The only one in the file is `:283` (`createAccountInternal`). B-12(a) is still open.

**UI surface:** none. All are background services.

**Drift to align** (behaviour alignment; needs owner sign-off only because it is a security-semantics change, not UI)
- Row identity gate. `patchAccountField` (`account/service.ts:322`) checks profileId and chainId only, and then writes using the row-carried address (`:327`). The gates at `:180, :339, :409` and `imported-keys-repository.ts:28` check all three.
- `importAccount` (`account/service.ts:458`) has no deletion fence. `createAccountInternal` (`:283`) has one.
- Restore preamble. `network/service.ts:272` skips the typeof/empty guard that the other three have. It checks profile existence instead, after capturing the epoch.
- Compensation on a failed write. The fpc, token and network-seed sites check network or chain liveness between `assertCurrent` and `set`. The contact and dapp-session sites do not (they have no parent entity to check).

**Notes for batching**
- `account/service.ts`, `account/spec.ts`, `restore-fence.ts` and the `purge-rows.ts` neighbourhood are shared with the account-regime changes. Do (c) and (d) first. They are the cheap ones and they fix the drift.
- `token-balance/service.ts` and `auth-registry/service.ts` are each touched by (b) and (c), so do those edits in one pass.
- `incoming-transfer/service.ts:406, 438` also type `{profileId, chainId, address}` inline. Candidate users of `AccountScope` if it ships.

### Q-17 — STILL-VALID

**Instances (current)** (`apps/extension/src/wallet/services/profile/service.ts`, 2,797 lines, byte-identical to the audit apart from one import line)
- (a) Six row constructors: `:605-627`, `:761-775`, `:2159-2178`, `:2211-2234`, `:2393-2434`, `:2581-2599`. `computeEnvelopeMacV3` is called at `:610`, `:1168`, `:2163` and `:2413`.
- (b) Degraded-open tail (`openSessionVerified`, then emit `onImportedKeysDegraded` when the DEK is missing): `:702-706`, `:851-855`, `:2726-2730`, `:2787-2791`.
- (c) Pending restore and rewrap contexts: `:124-239` and their consumers.
- (d) Reveal skeleton: `:1195-1242`, `:1685-1732`, `:1816-1898`, `:1919-1955`, `:1965-2003`.

**Changes since audit:** none beyond the import-scope rename. The adjudication in `implementations-plan/profile-service-dedup/plan.md` and the pin at `service.integration.test.ts:3055-3082` still apply to (d).

**UI surface:** none in the code touched. The `onImportedKeysDegraded` event feeds a popup warning that must keep firing, so any unification needs a test that every open path still emits it.

**Drift to align:** none observed among (a) and (b). (d) stays out of scope until the prior plan's verdict is revisited.

**Notes for batching**
- Self-contained in `profile/service.ts` plus a new `profile/profile-row.ts`. It overlaps nothing else in this part.
- It touches MAC inputs, so it should land separately from Q-03.

### Q-18 — STILL-VALID

**Instances (current)** (`apps/extension/src/wallet/services/incoming-transfer/service.ts` unless noted; the file changed only by one import line)
- Trust resolution: `resolveNoteTrust` `:1433-1453` and `resolvePublicTrust` `:2126-2152`.
- Pending-event projection, three times: `:1440-1449`, `:2138-2147` and replay `:1547-1556`.
- Commit: `commitDiscoveredNote` `:1465-1492` and `commitPublicRecord` `:2161-2172`.
- Record builders: `:2346-2376` and `buildPublicRecord` `:2174-2196`.
- Dedupe: `:1383-1415` and `:2113-2121`. Token lookup: `:1391`, `:2083`.
- Note-scheduler teardown: `:447-451` and `:1225-1231`. The public arm has `stopPublicScheduler` at `:1039-1045`.
- `clearProfile` `:702-729` and `clearChain` `:731-757`.
- Five-store purge inventory: `repository.ts:221-231` (`clearProfile`) and `:234-244` (`clearChain`).

**Changes since audit:** none.

**UI surface:** none directly. `onIncomingTransferPending`, `onIncomingTransferAdded` and `onIncomingTrustChanged` drive the incoming-transfer prompt and list, so event payload shape and timing must stay identical. Screens: the incoming-transfer notice and the Activity list.

**Drift to align** (the two arms disagree on epoch re-checks)
- `resolvePublicTrust` re-checks `serviceEpoch` right after `getTrust` and returns `undefined` (`:2133`). `resolveNoteTrust` has no equivalent re-check (`:1433-1453`).
- `commitDiscoveredNote` checks the epoch BEFORE `markBalanceDirty` (`:1472`). `commitPublicRecord` checks it AFTER (`:2166`).
- `commitPublicRecord` re-checks the epoch before the `Added` emit (`:2169`). The note arm does not (`:1486`).
- Unifying forces a choice per point. It is internal, not user-visible, but it is a concurrency semantic and needs an explicit decision.

**Notes for batching:** self-contained in the incoming-transfer folder.

### Q-20 — CHANGED-SHAPE (still valid; one more class)

**Instances (current)** (`packages/extension-messaging/src/errors.ts`, 614 lines)
- 24 `WalletError` subclasses at `:50-480` (was 21). The new one is `ChainNotSupportedError`, `:300-312`, from #752. It is a no-arg class with a constant message.
- `KnownWalletErrorPayload` union `:489-511` (22 members, was 21).
- `walletErrorFromPayload` switch `:518-573`, default `:571`.
- Not in the union or switch: `TooManyPendingError` (pinned omission) and `RpcConnectError` (client-local).
- Fourth place: the `instances` list in `errors.test.ts`, with hard-coded counts in test names ("all 18 subclasses", "the 17 switch-covered codes").

**Changes since audit:** #752 added `ChainNotSupportedError`. The triple edit was done correctly: class, union member, switch case. The test list was edited too, so each new error now costs four edits, including two hand-bumped counts in test names. This is evidence for the finding.

**UI surface:** none. The wire message string is dApp-facing, but the refactor does not touch it.

**Drift to align:** the no-arg classes (`SessionEndedError`, `TermsAcceptanceRequiredError`, `OperationNotRecordedError`, `ChainNotSupportedError`) rebuild by ignoring the payload message. `ScopeViolationError` and `CapabilityNotGrantedError` are irregular too. A registry needs per-class `fromPayload` overrides for these. No behaviour change is needed.

**Notes for batching:** self-contained in `extension-messaging`. A registry must keep `instanceof` identity and the code strings byte-for-byte.

### Q-21 — STILL-VALID

**Instances (current)** (`packages/aztec-runtime/src/pxe/service.ts`; edited only by import renames, and line numbers still match)
- Delete wrappers:
  - `sweepLegacyIndexedDbs` `:285-297`. `onblocked` resolves false (skip).
  - The same method's keyval deletion `:309-320`. `onblocked` resolves (skip).
  - `deleteDb` `:866-884`. `onblocked` waits up to 5 s, then rejects.
- "Delete keyval-store only when no PXE DB remains" guard: `:302-321` (re-lists `databases()`, then reads the `dbs` boot snapshot) and `:780-792` (`clearProfileState`, which re-lists twice).

**Changes since audit:** none.

**UI surface:** none.

**Drift to align**
- The blocked-handling policy differs deliberately. The boot sweep skips (`:289-293`, `:313-317`), while profile erasure rejects after a timeout (`:878-881`). The finding calls this unnamed. It should become a named parameter, with no behaviour change.
- The keyval lookup differs. `:308` uses the boot snapshot `dbs`, while `:788` re-lists. Unifying onto the re-list is strictly safer and is the only behaviour change.

**Notes for batching:** self-contained and independent of the rest of this part. The owner call is whether to retire the rc.2-era sweep outright (about 90 lines).

### Q-25 — STILL-VALID

**Instances (current)** (neither file changed since the audit, so lines are identical)
- `apps/extension/src/composables/useFullBackupImport.ts:165-171` (`restoreAccountsAndFilterOwnedSlices`), `:239-243` (`relinkRestoredTokenBalances`) and `:523-536` (the two `as never` injections at `:528` and `:536`).
- Also `useFullBackupImport.ts:427-431`: five `new …Client() as never` casts in the clients list.
- `apps/extension/src/composables/full-backup-restore.ts:129-133` (`AccountRestoreClient`, which lacks `restore`), `:326-339` (the `never`-typed injected function plus `data as never` and `accountService as never`), `:373-388` (`relinkRestoredTokenBalances: (data: never, newTokens: never, …)`, then `data.token as never`, `data as never` and `newTokens as never`).
- Related `as never` casts, not part of the finding: `:343`, `:522-523`.

**Changes since audit:** none.

**UI surface:** none. This is restore-pipeline wiring.

**Drift to align:** none.

**Notes for batching**
- The module cycle is the stated reason for the injection, so the fix is a new non-reactive support module that both files import.
- `useFullBackupImport.stages.test.ts` and `useFullBackupImport.test.ts` exercise the same seam.
- Separate from Q-03, though both sit in the restore path. Q-03 touches the services, Q-25 the composables.
Paths are under apps/extension/src/ unless noted. Baseline: origin/dev 8cfee502 vs audit 910a4def.
Only TokensView.vue (Q-06, Q-12) and verify/index.vue (Q-07: vendor import rename + footer composes) changed in code since the audit. Everything else cited is byte-identical.

### Q-06 — STILL-VALID

**Instances (current)**
- (a) Row builders:
  - `utils/activity-rows.ts:79-88` (`txRows`) vs `popup/components/modules/general/recent-activity-rows.ts:54-64` (`scopedTxRows`). Bodies identical.
  - `utils/activity-rows.ts:104-121` (`incomingRows`) vs `recent-activity-rows.ts:66-82` (`tokenScopedIncomingRows`). sortKey expression identical; comments differ.
  - Inline profile predicates (truthiness form): `popup/components/modules/general/RecentActivityView.vue:270`, `popup/components/modules/general/TokensView.vue:67` (was :66). Helper: `isForeignProfile`, `utils/activity-rows.ts:73`.
  - Inline network predicate, new in TokensView: `TokensView.vue:69`.
- (b) Card fields: `RecentActivityView.vue:337-395` (+`cardSubtitleFor` :414) vs `utils/journal-state.ts:358-420`. Orphan computeds `RecentActivityView.vue:156-194` read `executingTask`.
- (c) Dispatch ladders: `RecentActivityView.vue:852-865`, `popup/components/modules/activity/TransactionsList.vue:62-75`. `incomingCardProps` (`RecentActivityView.vue:240`, `TransactionsList.vue:44`) and the terminal-props fns (`RecentActivityView.vue:399`, `TransactionsList.vue:49`) are thin delegates, not duplicates.
- (d) CSS `.title_sep` byte-identical x4: `components/composite/activity/TransactionAwaitingCard.vue:132`, `TransactionTerminalCard.vue:87`, `TransactionIncomingCard.vue:77`, `popup/components/modules/activity/TransactionCard.vue:200`. `.chip` x3: Terminal :94, Incoming :84 (green variant, deliberate), TransactionCard :207.

**Changes since audit:** none to the activity files. #754 added the network check at `TokensView.vue:69` (a third scoping copy beside Home's). No new copies of the row builders.

**UI surface:** yes. Home Recent Activity and the Activity page; CSS dedupe touches 4 .vue files (pixel-identical screenshots). The drift fixes below change what History shows.

**Drift to align** (owner sign-off)
1. Journal network scoping: Home drops other-network ops (`RecentActivityView.vue:275`); History fetches by profile only (`popup/pages/activity.vue:78`) and `journalRows` (`utils/activity-rows.ts:91-102`) ignores `networkId`. Aligning removes rows from History.
2. Incoming profile guard: Home applies it (`recent-activity-rows.ts:73`), History does not (`activity-rows.ts:104-121`). Low impact (service already scopes by profile).
3. Empty-amount gate: `cardAmountFor` (`RecentActivityView.vue:367-376`) passes `""` through (renders 0); `transferCardFields` (`utils/journal-state.ts:380`) suppresses it.
4. `arriving` flag differs, likely deliberate: Home `!token && …` (`RecentActivityView.vue:858`), History `isArriving?.(…) ?? false` (`TransactionsList.vue:69`).

**Notes for batching:** `TokensView.vue` shared with Q-12 (the inline predicates :67/:69 are Q-06 scope; keep out of Q-12's PR). New `composables/useScopedTokens.ts` (Home/History token lookup) is not a duplicate but a shared card-field builder should reuse its `tokenById`.

### Q-07 — STILL-VALID

**Instances (current)**
- (a) `popup/windows/verify/index.vue:52-67` (exact copy) vs `composables/useDappHostname.ts:8-27`. Composable used by `discover/index.vue:53`, `capabilities/index.vue:121`, `execute/index.vue:134` and, new, `popup/windows/network-unavailable/index.vue:51`.
- (b) Window close: `verify/index.vue:77-83` (guarded), `composables/useDappApprovalWindow.ts:88-92` (guarded), `popup/windows/json/index.vue:16-21` and `popup/windows/logger/index.vue:12-17` (unguarded).
- (c) Session wait: `verify/index.vue:118-133` vs `composables/useDappApprovalWindow.ts:102-115`.
- (d) Cancellation tails: approve-catch `discover/index.vue:108-117`, `capabilities/index.vue:326-337` (identical), `execute/index.vue:523-534` (different else-branch); init-catch `discover:88-90`, `capabilities:177-179`, `execute:263-265`.
- `getRequestId` lambdas x4: `discover:49`, `capabilities:117`, `execute:130`, new `network-unavailable:47`. Leave (writer's call).

**Changes since audit:** new window `popup/windows/network-unavailable/index.vue` (#752) uses the hook and hostname composable correctly; it has no approve-catch, only an init-catch that logs (no `setError`). `verify/index.vue` hostname copy untouched.

**UI surface:** no for (a)-(c) (behaviour-preserving). (d) only if semantics change (overlay vs error banner).

**Drift to align**
- `json/index.vue:19`, `logger/index.vue:15` call `remove(window.id)` unguarded; verify and the hook guard `window.id`.
- Hostname: no drift today; one-sided risk (composable hardening skips verify, the trust-confirmation screen).
- Execute's approve-catch else-branch says "Processing error." with details vs "Something went wrong" in discover/capabilities. Owner call.
- `network-unavailable` init-catch only logs, no banner, vs `setError("Something went wrong")` in the other three (`discover:90`, `capabilities:179`, `execute:265`).

**Notes for batching:** no overlap with other findings in this part. `composables/useDappApprovalWindow.ts` is the home for `closeCurrentWindow` / `isApprovalCancelled`.

### Q-08 — STILL-VALID

**Instances (current)** (nothing moved)
- (a) Toggle (`tabindex="-1"`, `visibility` icon), 8 sites: `components/composite/import/ImportSecretForm.vue:47-55, 82-91`; `ImportFullBackupForm.vue:117-126, 145-154`; `popup/components/modules/settings/new-profile/NewProfileCredentials.vue:24-42`; `popup/pages/auth.vue:255-276`; `popup/pages/settings/security/change-password.vue:128-145, 170-185`.
- (b) New-password pairs: `ImportSecretForm.vue:66-108`, `ImportFullBackupForm.vue:130-173`, `NewProfileCredentials.vue:18-59`, `change-password.vue:158-202`.
- (c) `@keyframes shakeInput` x7. 0.3s: `components/composite/SecretUnlockSection.vue:65-74`, `popup/pages/auth.vue:439-449`, `popup/pages/settings/security/change-password.vue:288-297`, `popup/pages/settings/security/export/full.vue:723-732`. 0.4s: `onboarding/components/OnboardingProfileNameField.vue:45-55`, `popup/pages/import.vue:352-362`, `popup/pages/profile/new.vue:180-190`. Variant (own `shake`, 0.5s): `popup/components/popups/NewSenderPopup.vue:175-191`.

**Changes since audit:** none.

**UI surface:** yes. Login, Import (secret + full backup), New profile, Change password, Export full, and the name fields of Onboarding/Import/New profile. Screenshots needed.

**Drift to align**
- `autocomplete="new-password"` present in `ImportSecretForm.vue:76,106` and `change-password.vue:168,200`; absent in `ImportFullBackupForm.vue` and `NewProfileCredentials.vue` (autofill risk).
- Shake 0.3s vs 0.4s, no stated reason.
- No `prefers-reduced-motion` on the shake (other components have it, e.g. `TransactionCardLayout.vue:270`).
- `onboarding/pages/create.vue:146-170` is a fifth new-password pair (no toggle, has `autocomplete="new-password"`); not in the finding's counts but a `NewPasswordFields` would gain a fifth consumer.

**Notes for batching:** shares `popup/pages/import.vue` and `popup/pages/profile/new.vue` (shake CSS) with Q-14(c). Land the shake CSS module before or with any name-field extraction. Keyframes go in an extension-local CSS module, not `@nulo/design` base.css (writer's call).

### Q-09 — STILL-VALID

**Instances (current)**
- (a) Reducers: `popup/components/popups/NewContactPopup.vue:36-48`; `EditContactPopup.vue:38-62`; `ImportContactsPopup.vue:35-48` (feeds nothing live); `popup/pages/send.vue:196-209` (contacts; `send.vue:114-117` also splices `tokens`); `NewFpcPopup.vue:89-99`; `EditFpcPopup.vue:136-153`; `SelectProfilePopup.vue:77-91`; `SelectTokenPopup.vue:77-89`; `popup/pages/settings/connected-apps/index.vue:54-73`; `SelectFpcPopup.vue:82-90` (dead, Q-26). Shared impl: `composables/useEntityCrud.ts:104-140`, permanent `dispose` :148-156. No `utils/entity-list.ts` yet.
- (b) Contact rules: name `NewContactPopup.vue:58`, `EditContactPopup.vue:75` (untrimmed `===`); address `NewContactPopup.vue:69`, `EditContactPopup.vue:86` (lowercase compare); writes `NewContactPopup.vue:111`, `EditContactPopup.vue:142,145,151` (trim + lowercase); flag string `"Already exist"` at `NewContactPopup.vue:58,69,81,83`, `EditContactPopup.vue:76,87,103-104`; Map form `ImportContactsPopup.vue:91,114,120`. Same flag idiom (outside scope): `NewFpcPopup.vue:34`, `EditFpcPopup.vue:40`, `NewAccountPopup.vue:37`, `NewTokenPopup.vue:44`.

**Changes since audit:** none to sources (only `SelectTokenPopup.test.ts` fixtures, #751).

**UI surface:** none for the reducers. The trim fix changes a validation outcome in New/Edit contact (warning now appears for trailing-space names): user-visible.

**Drift to align**
- Duplicate adds: composable upserts (`useEntityCrud.ts:111`); contacts/send/FPC/connected-apps push unconditionally (`NewContactPopup.vue:36`, `send.vue:197`, `NewFpcPopup.vue:90`, `EditFpcPopup.vue:137`, `connected-apps/index.vue:55`); `SelectProfilePopup.vue:78-80` upserts; `SelectTokenPopup.vue:79` ignores dupes.
- Unknown updates: composable appends (:127); `NewFpcPopup.vue:94`, `SelectTokenPopup.vue:84-85` ignore; contact copies append.
- Contact name uniqueness compares untrimmed input but saves trimmed ("Alice " passes and saves a second Alice). `ContactService.addContact` has no uniqueness.
- Import popup's two-key rule (name AND address) is deliberate.

**Notes for batching:** `send.vue` shared with Q-13 (`reviewDepth` :303). SelectTokenPopup, SelectProfilePopup, NewContact/EditContact/ImportContacts popups are also Q-13 files (order computed); SelectTokenPopup also Q-12. Contact util and `entity-list.ts` are new files, no overlap.

### Q-12 — CHANGED-SHAPE (still valid; TokensView edges shifted by #754)

**Instances (current)**
- `popup/components/modules/general/TokensView.vue`: `balancesState` :80, `fetchDirty` :196, `inActiveScope` :198, handlers :199-225, connect counter `balanceConnectsSeen` ~:226-237, `scopeGen` :266, `BALANCES_RETRY_MS` :279, fetch+retry ~:285-316, scope watcher :355-392. (Now ~184-316 / 355-392; was 184-305 / 343-388.)
- `popup/components/modules/general/BalanceView.vue` (unchanged): `inActiveScope` :179, `balancesState` :183, `fetchDirty` :185, `markDirty` :186, handlers :235-253, `connectsSeen` :254-258, `BALANCES_RETRY_MS` :262, `fetchGeneration` fetch :267-291, `enterScope` + watcher :294-306, teardown :337-345.
- Lighter copy `popup/components/popups/SelectTokenPopup.vue:70-88`. Variant `popup/pages/send.vue:140-146` + `popup/pages/send-balance-events.ts`.
- No `useScopedTokenBalances` exists. `composables/runFence.ts` exists but neither view uses it.
- Tests still pin the same scenarios twice (`BalanceView.test.ts`, `TokensView.test.ts`; both changed).

**Changes since audit:** #754 reworked TokensView's row model (`home-slots.ts`, `homeLayout`, `retriedDefaults`, `shownSlots`; `retriedDefaults.clear()` added in the scope watcher ~:365). The snapshot state machine itself is unchanged.

**UI surface:** no for the extraction; alignment may be visible.

**Drift to align**
- `BalanceView.vue:235-239` pushes with no id dedupe; `TokensView.vue:199-203` dedupes (and sets `isUpdating`/`isMinting`). A duplicate event can double a balance in the hero aggregate.
- Delete: `BalanceView.vue:247-249` reassigns via filter; `TokensView.vue:215-222` splices.
- Stale-scope fence: TokensView has `scopeGen` plus `fetchGeneration`; BalanceView has `fetchGeneration` only (reset in `enterScope`). Equivalence not traced.

**Notes for batching:** `TokensView.vue` shared with Q-06 (keep predicates :67/:69 out of this PR). `SelectTokenPopup.vue` shared with Q-09 and Q-13. `send.vue` in Q-09/Q-13.

### Q-13 — STILL-VALID (count revised: 25 sites)

**Instances (current)**
- (a) `popupStore.len - popupStore.popups.<key>?.order` in 24 popups under `popup/components/popups/`: NewContact, EditContact, TokenMetadata, NewEndpoint, EditEndpoint, Receive, Accounts, RevokeAuthwits, ChangeAuthwitsRegistry, EditNetwork, ImportContacts, SelectFpc (dead, Q-26), SelectNetworks, Confirm, EditProfile, NewNetwork, ForgotPassword, IncomingTrust, NewAccount, NewSender, EditAccount, SelectProfile, DataViewer, SelectToken (all `*Popup.vue`).
  - New vs the finding's count: `popup/pages/send.vue:301-307` (`reviewOrder`, `reviewDepth = len - order`, and `reviewOrder === popupStore.len - 1`), with `?? 0`.
  - Template re-reads as `:displaceIdx="popupStore.popups.<key>?.order"`: 27 (52 counting all `popups[...]`/`.order` forms), e.g. `NewNetworkPopup.vue:151`, `NewContactPopup.vue:163`, `AccountsPopup.vue:64`.
  - Registry `PopupManager.vue:316-354`.
- (b) Trust queue in `popup/components/popups/PopupManager.vue` (355 lines): `pendingTrustQueue`/`tripleKeyOf` :55-62, `enqueueIfNew` :69-74, `payloadMatchesLiveTriple` :76-78, triple equality :77, :133, :139, :208-210 (audit's :114-116 is now :133-139). Workflow tags still present: `PopupManager.vue:154-155` ("P8 tactical C2 fix"), `:304` ("opus H-6").

**Changes since audit:** none.

**UI surface:** no if `order`/`depth` values are preserved; a wrong value changes popup stacking/z-index (visible).

**Drift to align:** none between copies. Preserve two values (raw `order` for `Popup`, reversed depth for `PopupCard`). `send.vue` guards with `?? 0`; popups compute `len - undefined` (NaN) when the key is closed.

**Notes for batching:** `send.vue` shared with Q-09; many popup files shared with Q-09 (and SelectTokenPopup with Q-12). Skip or delete dead `SelectFpcPopup` under Q-26.

### Q-14 — STILL-VALID

**Instances (current)** (nothing changed)
- (a) `onboarding/pages/import.vue:60-102` (destructure ~35 names), `:136-176` (picker/forms), `:184-256` (CTA ladder; file 293 lines); `popup/pages/import.vue:97-134, 196-237, 246-330` (364 lines); predicates `popup/pages/import-helpers.ts:15-28` (`resolveFullBackupEnterAction`, imported at `popup/pages/import.vue:23`).
- (b) Roving tablist: `onboarding/pages/create.vue:78-88` (key handler), `:115-145` (markup) vs `popup/components/modules/settings/new-profile/NewProfileMethodTabs.vue:13-55` (L4).
- (c) Lead: profile-name field + shake in `onboarding/components/OnboardingProfileNameField.vue`, `popup/pages/import.vue:175-199`, `popup/pages/profile/new.vue:100-`.

**Changes since audit:** none.

**UI surface:** yes. Onboarding Import/Create, popup Import, New profile. Preserve test ids; screenshots required.

**Drift to align**
- Tablists differ only in `aria-label`: "How you'll unlock Nulo" (`create.vue:118`) vs "Authentication method" (`NewProfileMethodTabs.vue:30`). A shared component needs an `ariaLabel` prop or an owner pick.
- Enter-key handling: popup import has `@keydown="onKeydown"` (`popup/pages/import.vue:180`) and `resolveFullBackupEnterAction`; onboarding import has no keydown handler. Unifying would add Enter shortcuts to onboarding (behaviour change).
- Popup keeps a deliberate "Finishing import" branch; `isImporting` destructured only in onboarding (:66, :249-250).

**Notes for batching:** shares `popup/pages/import.vue` and `popup/pages/profile/new.vue` with Q-08 (shake CSS regions :352-362, :180-190). Do Q-08's shake module first, then Q-14(c).
### Rebase of dedup findings, part 4 (Q-15, Q-16, Q-22, Q-23, Q-24, Q-26, Q-27)

Baseline: audit commit 910a4def against origin/dev 8cfee502. Method: `git diff 910a4def HEAD` per file, then re-grep. A file with an empty diff keeps its audit line numbers, so only moved or changed files are re-listed. The `@aztec/*` to `@aztec-labs/*` scope rename (#736) shifted no line counts in the files below unless stated.

### Q-15 — STILL-VALID

**Instances (current)**
- (a) Encoders (all unchanged, same lines):
  - `apps/extension/src/wallet/services/profile/service.ts:1718, 1876-1878, 2063`
  - `packages/wallet-crypto/src/session-secret-box.ts:91-98` (`tokenCopy` at :92)
  - `packages/wallet-crypto/src/wallet-fingerprint.ts:37` (hex)
  - `apps/extension/src/popup/pages/settings/security/export/full.vue:348`
  - `packages/aztec-runtime/src/pxe/client.ts:208` (`btoa(String.fromCharCode(...provision.key))`)
  - `packages/aztec-runtime/src/account/account-export.ts:80` (hex)
  - `apps/extension/src/wallet/utils/passkey-ceremony.ts:139` (hex)
- (b) Decoders (unchanged):
  - `apps/extension/src/wallet/services/profile/service.ts:2072, 2310, 2321, 2341`
  - `apps/extension/src/wallet/services/account/service.ts:439`
  - `apps/extension/src/wallet/services/dapp-session/integrity.ts:59`. The file still encodes with `toBase64` at :52, and the catch at :58-62 is still dead.
  - `packages/wallet-crypto/src/session-secret-box.ts:128-132`
  - `packages/wallet-crypto/src/password-secret-box.ts:219, 226, 234`. The file still imports `toBase64` at :40.
  - `packages/aztec-runtime/src/pxe/service.ts:817` (`Uint8Array.from(atob(...))`)
  - `apps/extension/src/wallet/utils/passkey-ceremony.ts:41` (hex decode)
- (c) Random hex:
  - `apps/extension/src/wallet/services/profile/spec.ts:104-108` (`mintPxeGeneration`)
  - `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:48-53` (`mintNonce`, dead, see Q-26)
  - `packages/wallet-core/src/utils/random.ts:9-14` (`getRandomHex`) is unchanged.
- (d) Byte equality: `packages/aztec-runtime/src/pxe/service.ts:848` (`installed.every((b, i) => b === key[i])`). `array_equals` is at `packages/wallet-core/src/utils/arrays.ts:1`.
- (e) Record guards (no `guards.ts` exists yet in `packages/wallet-core/src/utils/`):
  - Array-excluding:
    - `packages/wallet-bridge/src/dispatcher.ts:313-314`
    - `packages/wallet-bridge/src/method-scope-checkers.ts:395-396`
    - `packages/wallet-bridge/src/method-descriptors.ts:115` (`isPlainRecord`)
    - `apps/extension/src/composables/usePinnedTokens.ts:24`
    - `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:32`
    - `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:14-15` (inline, returns `as Blob`)
  - Permissive:
    - `apps/extension/src/popup/windows/capabilities/details-table.ts:88-89`
    - `apps/extension/src/popup/windows/capabilities/permission-rows.ts:253-254`
    - `packages/wallet-bridge/src/dispatcher.ts:773` (`isObj`, same file as the strict copy)
    - `apps/extension/src/wallet/services/dapp-session/spec.ts:69` (`tolerantRecord`)
    - `apps/extension/src/wallet/services/transaction/spec.ts:168` (`tolerantObject`)
  - Stricter, keep: `packages/legal/src/status.ts:66` (`isPlainObject`, prototype check).
- New since audit (out of scope, same family): `apps/extension/scripts/seed-preflight-metadata.ts:57`, a `Buffer.from(hex…,"hex")` in a script. It is not a runtime copy.

**Changes since audit**
- None of the 20 files changed shape. `mintPxeGeneration` and `mintNonce` are still hand-rolled. No new runtime copies were added. The only new `Buffer` use is the seed-preflight script above.
- `packages/wallet-core/src/utils/` gained nothing relevant. The `Queue` and `sleep` helpers it already had are not the missing guard or encoding helpers.

**UI surface**
- No. `export/full.vue:348` is script-only (the sealed-backup encode). Nothing user-visible changes.

**Drift to align**
- Base64 decode strictness. `Buffer.from(x,"base64")` is lenient and never throws. `atob` at `packages/aztec-runtime/src/pxe/service.ts:817` throws on malformed input. Every other decoder is lenient. `dapp-session/integrity.ts:58-62` has a catch that can never fire. This needs an exception-parity decision per site (strict vs `fromBase64Lenient`) on frozen blob paths.
- Record-guard meaning. `dispatcher.ts:313` rejects arrays and `dispatcher.ts:773` accepts them, in one file. The permissive copies (`details-table.ts:88`, `permission-rows.ts:253`) accept arrays. The two `tolerant*` specs are documented as deliberately tolerant, so keep them local.
- Random hex length. `getRandomHex` handles odd lengths; the two `mint*` copies are fixed at 32 chars. They are equivalent for 32.

**Notes for batching**
- Pair this with Q-16, which adds `raceDeadline`, `createSerialQueue` and a fence to `packages/wallet-core/src/utils/` (index.ts exports). Do both in one wallet-core utils PR for the new files and exports.
- `session-secret-box.ts`, `password-secret-box.ts` and `profile/service.ts` are frozen blob paths. `profile/service.ts` is also Q-17's file (6 row builders). Sequence this after Q-17's row-builder PR, or pick one owner for edits to that file.
- `pxe/client.ts` and `pxe/service.ts` overlap Q-21 and Q-26(c).
- Q-26(b) deletes the `mintNonce` copy, so (c) shrinks to one site if Q-26 lands first.

### Q-16 — STILL-VALID

**Instances (current)**
- (a) Deadline race (all unchanged):
  - `apps/extension/src/stores/balances.store.ts:124-139` (`withTimeout`, exported, auto-imported; clears the timer on both branches). Callers at :495, :506, :546.
  - `apps/extension/src/popup/auth-guard.ts:83-90` (`withinDeadline`, clears in `finally`). The `sleep` copy is at :66.
  - `apps/extension/src/components/Header.vue:34-43` (sentinel, clears in `finally`).
  - `apps/extension/src/components/JsonViewer/LogsViewer.vue:189-200` (never clears its timer).
  - `apps/extension/src/composables/importPreflight.ts:41-47` and `apps/extension/src/composables/importChainSync.ts:111-117`, racing the uncancellable `realSleep` (`importPreflight.ts:31`).
  - `packages/extension-messaging/src/core/base-client.ts:284-301` (`awaitReadyWithinDeadline`, clears in `finally`).
  - `packages/aztec-runtime/src/pxe/opfs-store.ts:124-135` (clear at `:168-170`).
  - `sleep` copies:
    - `apps/extension/src/composables/importPreflight.ts:31` (`realSleep`, auto-imported)
    - `apps/extension/src/popup/auth-guard.ts:66`
    - `apps/extension/src/stores/app.store.ts:648`
    - `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:227`
    - `apps/extension/src/core/adapters/system-clock.ts:14`
    - `packages/wallet-core/src/utils/sleep.ts:1`, which already exists and is the intended owner. `sleep` is the copy that was missed, so Q-16 should reuse it rather than add another.
  - New, not in the audit (the race pattern already existed in `HEAD` before the audit commit):
    - `apps/extension/src/wallet/utils/offscreen.ts:333` (`Promise.race([creating, ready])`)
    - `apps/landing/src/feed-dom.ts:120` (a font-wait race in another app; leave it out).
- (b) Promise-chain serial queues, line numbers unchanged:
  - `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:75-82`
  - `apps/extension/src/utils/guarded-network-activation.ts:18, 44-50`
  - `apps/extension/src/wallet/logger/store.ts:20, 127-132`
  - `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:60, 89, 160, 176`
  - `apps/extension/src/wallet/services/token/seeder.ts:168, 311-318`
  - `apps/extension/src/wallet/services/price/service.ts:104, 229-` (`configTransition`)
  - `apps/extension/src/composables/usePinnedTokens.ts:88-100` (per-key map with idle eviction)
  - New in this re-count, same smell: `apps/extension/src/wallet/utils/offscreen.ts:121-136` (`closeTail`/`trackedClose`, `.catch(() => {})`).
- (c) Latest-wins counters beside `createRunFence` (`apps/extension/src/composables/runFence.ts:12-20`, which still has only `begin()`):
  - Composables:
    - `useEntityCrud.ts:77-100` (`++seq` at :81)
    - `useIncomingTransfers.ts:68-79, 104` (`refreshSeq` + `disposed`)
    - `useLegalAcceptance.ts:16-52` (:19, :28, :52)
    - `useSeedStatus.ts:56-90, 133`
    - `useIncomingSyncHealth.ts:50-99, 116, 134` (two counters: `generation` and `retryGeneration`)
    - `usePrestoStatus.ts:16-30` (:20)
    - `usePinnedTokens.ts:169-202` (:194)
  - Secret pages:
    - `popup/pages/settings/security/export/account.vue:59-213` (`generation++` at :62, :213)
    - `popup/pages/settings/security/export/full.vue:72-416` (:416)
    - `popup/pages/settings/accounts/import.vue:44-168` (:144, :168)
  - Existing `createRunFence` consumers: `useProfileBootstrap.ts:44`, `useScopedTokens.ts:31`, `RecentActivityView.vue:142-143`, `network-switch.ts:45`. `useProfileBootstrap.ts` changed (5 lines, a rename) and is unaffected.
  - Excluded: `app.store.ts:156-280`.
  - Download-handler twins: `export/account.vue:182-198` (`downloadFile` at :187) and `export/full.vue:370-392` (`handleDownloadBackup`).

**Changes since audit**
- No copy added or removed. The `@aztec-labs` rename touched none of these files.
- Corrections to the audit's list: `packages/wallet-core/src/utils/sleep.ts` already exports `sleep`; the offscreen `closeTail` queue and the `offscreen.ts:333` race were missed in the audit (they pre-date it).

**UI surface**
- Logic only. No copy or layout change if done as a pure refactor. `.vue` files touched: `Header.vue`, `LogsViewer.vue`, the two export pages, `accounts/import.vue`. These are the secret-export flows, where a missed `gen` check writes a payload back after scrubbing. They need their existing tests.
- Visible only if the `LogsViewer` fix (clearing its timer) changes retry timing. That is not a screen change.

**Drift to align**
- Timer cleanup:
  - Correct in `balances.store.ts:124`, `auth-guard.ts:83-90`, `Header.vue:34-43` and `base-client.ts:284-301`.
  - `LogsViewer.vue:189-200` never clears.
  - `importPreflight.ts:41-47`, `importChainSync.ts:111-117` and `opfs-store.ts:124-135` race an uncancellable sleep or hold the timer by hand.
- Rejection policy of the queues (four policies):
  - Swallow: `logger/store.ts:129` (`.catch(() => {})`), `offscreen.ts:131`, `usePinnedTokens.ts:92` (op for both outcomes, tail catches).
  - Report: `scan-episodes.ts:176` (`onPersistError`).
  - Propagate: `fee-send-selection.ts:79` (`.then(step, step)`), `guarded-network-activation.ts:44-50`.
  - `seeder.ts:313-314`: chains on resolve only.

**Notes for batching**
- Sequence: wallet-core utils first (`raceDeadline` in `timeout.ts`, `createSerialQueue` in `serial.ts`, `RunFence.current()/invalidate()`), then migrate sites. `raceDeadline` replaces `withTimeout`, which also removes an auto-import (`auto-imports.d.ts` and `.eslintrc-auto-import.json` regenerate).
- Shared files with other findings:
  - Q-15 (wallet-core utils exports).
  - Q-26 (`usePinnedTokens.ts` is also a Q-15 guard site).
  - `fee-send-selection.ts` is in Q-15(e) and Q-16(b).
  - `usePinnedTokens.ts` is in Q-15(e), Q-16(b) and Q-16(c).
  - `FeeSettingsCard.vue` (Q-24) is not touched by Q-16.

### Q-22 — STILL-VALID

**Instances (current).** Every file in this list has an empty diff since the audit except the three noted at the end, so all audit line ranges hold.
- (a) Settings list row:
  - `apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:62-100, 122-148` equals `apps/extension/src/popup/pages/settings/connected-apps/index.vue:176-214, 232-258` (hairline `rgba(74,70,63,.3)` at `ContactRow.vue:92` and `connected-apps/index.vue:206`).
  - Variants: `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:114-198` and `apps/extension/src/components/ui/Settings/SettingItem.vue:156-225`.
  - `apps/extension/src/components/ui/Settings/SettingField.vue:34-75` equals `SettingValue.vue:39-80`. `SettingValue` is dead, see Q-26.
- (b) Record card: `apps/extension/src/popup/components/modules/settings/authwits/AuthwitCard.vue:65-168` against `apps/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:261-392`.
- (c) Toolbar icon button, five copies:
  - `popup/pages/settings/contacts/index.vue:205-222` (`.icon_btn`)
  - `popup/pages/settings/connected-apps/index.vue:298-315`
  - `popup/pages/settings/connected-apps/[id].vue:368-385`
  - `popup/pages/settings/advanced/account-state/authwits/index.vue:207-224`
  - `popup/pages/tokens/[id].vue:299-321`

  No `:focus-visible` in `tokens/[id].vue` or `contacts/index.vue`.
- (d) Detail pages: `popup/pages/tx/[id].vue:358-494` against `popup/pages/received/[id].vue:341-~495`, plus `journal/[id].vue:349-362` (chip) and the script helpers at the audit lines (`tx:91, 105-110, 124-126, 139-142`; `received:121-122, 126-135`; `journal:145, 150, 200-203`). The detail page files were not touched since the audit.
- (e) Empty state: `apps/extension/src/components/composite/ListStatusMessage.vue:29-57` (`overflow-wrap` at :56) against `apps/extension/src/popup/components/modules/general/list-empty.module.css:1-27`.
  - Consumers: `TokensView.vue:564-572` (moved from :475-486/:556-566 by the home-token-rows change #754; it composes `empty_state`, `empty_headline`, `empty_sub`) and `RecentActivityView.vue:948-956` (was :873-876/:947-957; the file has no diff, so this is the original ~947 range).
  - `ListStatusMessage` consumers: `TokenList.vue`, `SelectTokenPopup.vue`, settings tokens/contacts and the account-state pages.
- (f) Shimmer bypassing `packages/design/src/ui/Skeleton.vue:23-52` (reduced-motion at :48):
  - `apps/extension/src/components/composite/send/AmountCard.vue:558-574`
  - `apps/extension/src/popup/components/modules/send/fee-shared.module.css:30-46`
  - `apps/extension/src/popup/pages/received/[id].vue:488-516` (reduced-motion at :512)
  - `Skeleton` is now consumed by 4 places in the extension (new adopters since the audit's run were already present at audit time per the shared-import list).
- (g) Popup body and title: 16 popup files plus `apps/extension/src/components/composite/FormPopup.vue` (a 17th `padding: 0 20px 24px 20px` site in `components/composite/`, not in the audit's list). The 16 are `ForgotPasswordPopup`, `ImportContactsPopup`, `ConfirmPopup`, `AccountsPopup`, `IncomingTrustPopup`, `DataViewerPopup`, `NewSenderPopup`, `ChangeAuthwitsRegistryPopup`, `EditProfilePopup`, `SelectNetworksPopup`, `SelectFpcPopup`, `ReceivePopup`, `SelectTokenPopup`, `SelectProfilePopup`, `TokenMetadataPopup`, `RevokeAuthwitsPopup`. `SelectFpcPopup` is dead (Q-26), so deleting it removes one site.
- (h) Disclosure toggle: `apps/extension/src/popup/windows/execute/CallArguments.vue:107-117, 149-167` (that file grew by about 12 lines for the authwit nonce row, so ranges now sit about +12 below :67, i.e. re-read before editing; the toggle CSS moved to roughly :119-129, :161-179) against `OperationCard.vue:260-269, 582-600` (no diff).
- (i) Snack card: `packages/design/src/ui/ToastManagerBase.vue:131-150` against `:162-184` (unchanged).
- (j) `apps/extension/src/components/composite/SecretCountdownClose.vue:52-119` against `packages/design/src/ui/Button.vue:300-347` (both unchanged).
- Changed files in this set: `CallArguments.vue` (nonce row added, scope renames), `TokensView.vue` (home token rows, see (e)), `connected-apps/[id].vue` (import rename only).
- New window since audit: `apps/extension/src/popup/windows/network-unavailable/index.vue` (169 lines, #752). It has its own `.footer` and `.body` rules, and `window-shell.module.css` gained a `.footer` rule (+8 lines). It reuses `window-shell` rather than adding a toolbar button or shimmer, so it adds no new Q-22 copy, though it is a fresh instance of the "footer with `border-top` and surface" shell that other windows may repeat.

**Changes since audit**
- No instance was fixed or removed. Line numbers moved only in `TokensView.vue` and `CallArguments.vue`. One new instance for (g) (`FormPopup.vue`). One more `.footer` shell appeared (`network-unavailable/index.vue`, `window-shell.module.css`).

**UI surface**
- Yes, every sub-item. Screens: Settings list (Contacts, Connected apps, Account row, Setting rows), Authwits and Notes cards (Advanced > Account state), Contacts / Connected apps / Authwits / Token detail toolbar buttons, Tx / Received / Journal detail pages, Home token list and Recent activity empty states, Send amount and fee cards, Received detail shimmer, 16 popups (body padding and headline), Execute window disclosure toggles, toasts, Secret export countdown close button. The owner UI rule applies: every step must be pixel-identical, with before/after screenshots.

**Drift to align** (each needs owner sign-off if a unification picks a side)
- `:last-child` vs `:last-of-type`: `ContactRow.vue:97`, `connected-apps/index.vue:211`, `AccountSelectRow.vue:145` and `SettingItem.vue:185` use `:last-child`. `SettingField.vue:70` and `SettingValue.vue:75` use `:last-of-type`. (The audit said SettingField and SettingValue differed from each other; they now match each other and differ from the row family.)
- `overflow-wrap: break-word`: only `ListStatusMessage.vue:56`. `list-empty.module.css` has none, so long text wraps differently on Home token and Activity empty states.
- Reduced-motion: handled by `Skeleton.vue:48` and `received/[id].vue:512`, absent in `AmountCard.vue:558-574` and `fee-shared.module.css:30-46`.
- `:focus-visible` is absent on all five toolbar buttons (a unification could add one: user-visible).

**Notes for batching**
- Q-23(b) (hairline literals) edits many of the same files (`ContactRow.vue`, `connected-apps/index.vue`, `AccountSelectRow.vue`, `SettingItem.vue`, `SettingField.vue`, `fee-shared.module.css`, `GasBalanceCard.vue`, `RecentActivityView.vue`). Do the shells first, then the token step, or fold the `--hairline-soft` token into the shared module.
- Q-26 deletes `SettingValue.vue`, `SelectFpcPopup.vue` and the dead `.cta` CSS, which cuts (a), (g) and the `.cta` sites. Do Q-26 first.
- `CallArguments.vue`/`OperationCard.vue` (h) are also dApp-facing approval surfaces: wire-shaped fixtures rule applies.
- `fee-shared.module.css` and `AmountCard.vue` overlap Q-24's send surface.

### Q-23 — STILL-VALID

**Instances (current)**
- (a) `packages/design/src/base.css`: `:root` block at :72-123, `[theme="dark"]` at :194-241 (the audit said :194-245; the block ends at :241, so the line count of the second block was overstated by 4). Counting custom-property declarations, `:root` has 40 and the dark block 38, and 28 are byte-identical across them (matches the audit's 28). The light block (:125-192) is unchanged. The package has no diff since the audit, so `theme-contrast.ts:33-40` is unchanged and no equality assertion exists.
- (b) Hairline `rgba(74,70,63,.2/.3)` literals, 18 sites outside `base.css` (audit said about 19):
  - `components/composite/activity/TransactionCardLayout.vue:198` (.3)
  - `components/composite/activity/TransactionAwaitingCard.vue:150`
  - `components/composite/activity/TransactionTerminalCard.vue:103`
  - `components/composite/activity/TransactionIncomingCard.vue:93`
  - `components/composite/capabilities/DetailsTable.vue:137` (this one is a local `--hairline-soft` with a light/dark pair at :137/:144)
  - `components/composite/capabilities/PermissionRow.vue:81`
  - `components/ui/Settings/SettingField.vue:65`, `SettingValue.vue:70`, `SettingItem.vue:180` (.3)
  - `popup/components/Navigation.vue:61`
  - `popup/components/modules/general/GasBalanceCard.vue:188`
  - `popup/components/modules/general/RecentActivityView.vue:883`
  - `popup/components/modules/send/fee-shared.module.css:4`
  - `popup/components/modules/activity/TransactionCard.vue:213`
  - `popup/components/modules/settings/contacts/ContactRow.vue:92` (.3)
  - `popup/pages/settings/glossary.vue:60`
  - `popup/pages/settings/connected-apps/index.vue:206` (.3)
  - `popup/windows/capabilities/AccountSelectRow.vue:140` (.3)

  All paths are under `apps/extension/src/`. `--hairline-soft` exists only as the `DetailsTable.vue` local, not in `token-contract.ts`/`base.css`.
- Scrims `rgba(10,9,8,α)`, all unchanged: `components/LegalAcceptanceSheet.vue:136` (.82), `components/GlobalLoader.vue:33` (.85), `components/Popup/Popup.vue:148` (.8), `components/composite/BarrierOverlay.vue:31` (.92), `components/composite/DappCancelledOverlay.vue:33` (.8), `components/passkey/PasskeyCeremonyDialog.vue:107` (.85). That is four distinct alphas (.8, .82, .85, .92), not six; the audit's "six alphas" counted shadow uses too (`NotificationManager.vue:111` .3, `LogsViewer.vue:308` .3, `Tooltip.vue:250` .6, `ToastManagerBase.vue:216` .45).
- `rgba(35,31,28,1)`: `components/composite/CollapsingHeroLayout.vue:228`, `popup/pages/send.vue:810`, `popup/pages/settings/security/reset.vue:180`, and `components/passkey/PasskeyCeremonyDialog.vue:124` (as the `var(--nulo-border, …)` fallback, a 4th site).

**Changes since audit**
- None in `packages/design/` or the hairline/scrim sites. Hairline count 18 vs the audit's 19 is a recount, not a removal.

**UI surface**
- Yes for the light-theme hairline and scrim-role corrections (any file above). The first step (one dark block, new `--hairline-soft` tokens with today's exact values) is byte-identical and visual-neutral. Screens affected by corrections: Activity cards, Home gas card, Navigation bar, Settings rows, Glossary, capability windows, overlays.

**Drift to align**
- Hairline in light theme: dark-hued `rgba(74,70,63,…)` at about 15 sites (all above except `DetailsTable.vue:137` with its light twin at :144, `PermissionRow.vue` and `glossary.vue`, which have light overrides per the audit). Aligning means choosing the light value: owner sign-off with screenshots.
- Scrim alphas (.8, .82, .85, .92) differ by role; collapsing them is a product call.
- Fee: `base.css` dark values live in two blocks, so editing one leaves the other stale (`:72-123` vs `:194-241`).

**Notes for batching**
- Same files as Q-22 (see there); do Q-23(a) (base.css only, no consumer edits) independently and first. Q-23(b) after Q-22's shell extraction so each file is edited once.
- `SettingValue.vue:70` disappears when Q-26 deletes it.

### Q-24 — STILL-VALID

**Instances (current)** (`apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue`; the file shrank by 17 lines because #751 removed `allowSponsored` and `CHAIN_IDS`, so audit lines shifted down)
- (a) Identity predicates and keys:
  - `:180-185` (`scopeIsLiveIdentity`, 4 `===`)
  - `:543-549` (`identityDrifted`, 4 `!==` plus `!isMounted` and `embeddedHidden()`)
  - `:722-728` (`recommitStillValid`, 4 `===`)
  - `:616` (scope object literal built from `reqProfileId`, `reqNetworkId`, `reqChainId`, `reqAccount`)
  - `:711` (key string `` `${scope.profileId}|${scope.networkId}|${scope.chainId}|${scope.accountAddress}` ``)
  - audit's `:716, :772` are no longer separate sites in the grep; `:711` and `:616` are the key/construction sites now. Re-read the file before editing.
- (b) `originPrivacy` mode branches: `:62` (prop), `:195`, `:196`, `:207`, `:209`, `:211`, `:217`, `:221`, `:347`, `:361`, `:382`, `:393`, `:427`, `:520`, `:564`, `:577`, `:585`, `:750`, `:824`. About 14 branch points, which is more than the audit's "about ten".
- The same four-field identity (profileId, networkId, accountAddress, and sometimes chainId) is also compared elsewhere, outside this finding's scope: `composables/useArrivals.ts:105`, `composables/useIncomingTransfers.ts:117`, `popup/components/popups/PopupManager.vue:77`. These were judged separate by the audit (dropped q09-C-7), so keep them out.

**Changes since audit**
- #751 removed the `allowSponsored` threading and the mainnet default branch from this card, `fee-helpers.ts` and `fee-privacy.ts`. It removed one mode-like switch (mainnet vs other default) but did not touch the six predicates or `originPrivacy`. The (a) refactor has the same shape as at audit; (b) lost the `allowSponsored` leg of its threading.
- `fee-helpers.ts` still has no `sameFeeScope` or `feeScopeKey` helper.

**UI surface**
- (a): none (pure predicate extraction). (b): yes (Send screen fee card, Settings fee selection). Owner sign-off per audit.

**Drift to align**
- None between the six predicates beyond `identityDrifted` adding `!isMounted` and `embeddedHidden()`, which are not identity. All three equality predicates compare the same four fields.

**Notes for batching**
- Sole owner of this file in this part. Overlaps Q-22(f) (`fee-shared.module.css`, `AmountCard.vue`) only through the send surface; no shared edits.
- #751 shifted line numbers; anyone doing (b) should re-read the file.

### Q-26 — STILL-VALID

**Instances (current)**
- (a) `@nulo/design` exports with no consumer. Unchanged: `packages/design/src/ui/Card.vue`, `ui/Tag.vue`, `ui/Toast.vue`; `composite/AddressDisplay.vue`, `BalanceRow.vue`, `DisclaimerTag.vue` (imports `Tag`), `DripButton.vue`, `EmojiGrid.vue`; barrel `packages/design/src/index.ts:28, 40-41, 48-52`. The resolver set (`apps/extension/scripts/design-resolver.ts:10-31`) still lacks all of them, and no app imports them (`apps/landing` imports only `base.css`).
  - Now consumed since the audit, so they must NOT be listed as dead: `FieldWarning`, `RowAction`, `Skeleton`, `SectionLabel`, `Tooltip`, `ToastManagerBase`. `RowAction` and `Skeleton` are registered in the resolver.
  - Tests for each dead SFC sit beside it (`*.test.ts`), plus `apps/extension/src/components/composite/general/EmojiGrid.test.ts`, which tests the extension-local `EmojiGrid`, which stays.
- (b) Extension:
  - `apps/extension/src/wallet/services/activity-protocol/coordinator.ts` (247 lines), `spec.ts` (70), `coordinator.test.ts` (154). Nothing outside the folder references it, so the audit's 317 + 154 lines was 247 + 70 + 154 = 471 in all. Still owner call (delete or wire).
  - `apps/extension/src/components/ui/Settings/SettingValue.vue` (stories `Settings.stories.ts` and tests `Settings.test.ts` only).
  - `apps/extension/src/components/Divider.vue` (only `types/components.d.ts` mentions it).
  - `apps/extension/src/popup/components/popups/SelectFpcPopup.vue` (228 lines), mounted at `PopupManager.vue:25, 342`; nothing opens `select_fpc`.
  - Test-only exports: `utils/fee-estimation.ts:119-140` (`buildFeeEstimate`, `:126`), `utils/amount.ts:208-216` (`isValidAmount`), `utils/tx-enrichment.ts:127-134` (`getCallCountLabel`), `:147-149` (`formatCallSummary`), `utils/core.ts:131` (`requireTransaction`). Each is referenced only by its own test, a doc comment and the generated `auto-imports.d.ts`.
  - `utils/incoming-dust.ts:46` alias: live (`incoming-transfer/service.ts:21`), inline it.
  - Dead `.cta` / `.cta_red` CSS: `popup/pages/settings/security/change-password.vue:299-337` and `reset.vue:203-243`. The templates use `Button variant="cta"` (change-password:229) and `variant="cta_destructive"` (reset:166), not the local classes.
  - Five font copies `apps/extension/src/assets/fonts/*.woff2` (760 KB), byte-identical to `packages/design/src/fonts` (checked with `cmp` on Inter and Material Symbols; same file names for all five), no reference under `apps/extension`.
- (c) aztec-runtime / wallet-bridge:
  - `packages/aztec-runtime/src/pxe/artifact-registry.ts`: `ArtifactPolicy` at :24, `defaultPolicy` :33, `setPolicy` :98, `getPolicy` :102, `hasKnownClassId` :122, `clear` :130, `_network` param :162. The only consumers of `setPolicy`/`hasKnownClassId` are `apps/extension/src/wallet/services/pxe/artifact-registry.test.ts`.
  - `packages/aztec-runtime/src/pxe/service.ts:221` (subscription) and `:69-74` (`IProfileReader`).
  - `packages/aztec-runtime/src/pxe/index.ts:14` (`defaultPolicy`, `ArtifactPolicy` exports).
  - `packages/wallet-bridge/src/method-descriptors.ts:376` (`RpcRequest`, no other reference in the repo).

**Changes since audit**
- No item fixed. No new dead item found in the diff since the audit; `packages/aztec-runtime/src/pxe/` and `wallet-bridge/src/` changes were import-scope renames and unrelated edits. (The artifact registry and catalog changed only their import lines.)

**UI surface**
- Deleting dead code only. `SelectFpcPopup.vue`, `SettingValue.vue`, `Divider.vue`, the design SFCs and the `.cta` CSS are not reachable by any user, so no visible change. `PopupManager.vue:342` loses one mounted popup. Smoke e2e count rows, so run it.

**Drift to align**
- None (dead code has no behaviour). The only drift is the `AddressDisplay` same-name collision (design vs extension), resolved by deleting the design copy.

**Notes for batching**
- Do this first. It shrinks Q-22 ((a) `SettingValue`, (g) `SelectFpcPopup`, `.cta` CSS), Q-23(b) (`SettingValue.vue:70`), Q-15(c) (`mintNonce`) and Q-27 (`isReceiptAboveDustThreshold` alias).
- Q-21 (`pxe/service.ts`) and Q-26(c) touch the same file but different regions. `ArtifactRegistry` simplification touches `apps/extension/src/wallet/services/pxe/artifact-registry.test.ts`.
- The regenerated `components.d.ts` and `auto-imports.d.ts` are the only shared outputs with other findings (Q-16 also changes auto-imports).

### Q-27 — PARTLY-FIXED (one sub-item fixed, one changed shape, the rest STILL-VALID)

Per sub-item (all paths repo-relative; "unchanged" = empty diff, so audit lines hold):

- **Q-27a — STILL-VALID, lines moved.** `apps/extension/src/wallet/services/wallet-sdk/background.ts`: the admission ladder is now at `:967-975` (`approveAfterPopup`) and `:1041-1049` (`runDiscoveryPopup`), both `admitAsync(...)` plus `rejectThrottled(..., admitted === "expired" ? "expired while queued" : "verify-window queue full")`. The file grew about 130 lines for the unserved-chain notice (#752), adding three more reject-and-log scaffolds (`rejectBehindNotice`, the epoch-switch reject near :790, `runNetworkUnavailableNotice`) that a shared `rejectDiscovery(+log)` helper could also cover. The returning-user branch (`autoApproveExistingSession` call near :803) stays out. UI: no.
- **Q-27b — STILL-VALID, unchanged.** `apps/extension/src/wallet/services/auth-registry/service.ts:281-321, 336-375`. UI: no.
- **Q-27c — STILL-VALID, unchanged.** `apps/extension/src/popup/windows/execute/index.vue:331-348, 349-365`. UI: no (case labels). It is an approval window: wire-shaped fixtures rule.
- **Q-27d — STILL-VALID, unchanged.** `apps/extension/src/popup/pages/settings/appearance.vue:105-162`; `.../settings/advanced/index.vue:108-157`. UI: logic only.
- **Q-27e — STILL-VALID, unchanged.** `apps/extension/src/composables/unlockWait.ts:33-61`; `waitForProfileActive.ts:30-47`. UI: no.
- **Q-27f — STILL-VALID, with a changed shape.**
  - `normalizeProfileName` is inlined as `name.normalize("NFKC").toLocaleLowerCase()` at `popup/components/popups/EditProfilePopup.vue:46, 78, 79, 81, 111` (5 sites), while `utils/profile-name.ts:7` exports the helper and `composables/useProfileNameField.ts:130-131` uses it. Drift: `EditProfilePopup.vue:43` (`isUnchanged`) compares with plain `.toLowerCase()`, no NFKC.
  - Malformed-row predicate: `utils/token-order.ts:41-43` now exports `isUnknownRow(tb)`. The same predicate is still inlined at `utils/token-amount.ts:50` and `utils/token-aggregate.ts:20` (`malformed`). The helper exists and is bypassed. `token-order.ts` changed since the audit (class ranking: `unsynced` and `empty` now tie at rank 4, `unknown` at 3), but the predicate is unchanged. `token-order.ts` imports `token-amount.ts`, so using `isUnknownRow` from `token-amount.ts` needs the predicate to move down a layer.
  - UI: the profile-name check and the token ordering are user-visible logic, but a pure extraction changes nothing visible. Aligning `isUnchanged` (:43) to NFKC would change behaviour for names that differ only by compatibility form.
- **Q-27g — CHANGED-SHAPE (grew).** The mint and transfer vocabulary now has more homes:
  - `utils/token-transfer-vocabulary.ts:71-73` (`MINT_SIGNATURES`: `mint_to_private`, `mint_to_public`)
  - `utils/token-transfer-vocabulary.ts:~96-111` (`VOCABULARY_SELECTORS`: new since the audit, 16 `name/arity` selector entries including both mints)
  - `utils/tx-amount.ts:10` (`STANDARD_MINTS`: three names, includes `mint_to_commitment`) and `:40-45`
  - `utils/tx-enrichment.ts:17-25` (`METHOD_LABELS`: `mint_to_public`, `mint_to_private`) and `:102-108` (`getTxCategory` uses `startsWith("transfer")` / `startsWith("mint_to_")`)
  - `wallet/services/token/functions/descriptors.ts` (`AUTHWIT_NONCE_NAMES`, `TOKEN_FN_DESCRIPTORS`, `FnImpl` lists) has no mint entry (grep for "mint" found none), so the descriptors are not a fifth list.

  Drift: `mint_to_commitment` is in `tx-amount.ts:10` only. `getTxCategory` treats it as a mint (prefix) but `METHOD_LABELS` has no label for it, and `MINT_SIGNATURES` omits it. UI: yes (approval card vocabulary, activity titles). Owner UI call remains; also #748 now reads standard-token transfers as transfer rows, which raises the stakes of a wrong list.
- **Q-27h — STILL-VALID, unchanged.** `utils/fee-estimation.ts:28-39, 90-116`; `wallet/services/price/convert.ts:19-49, 76-113`. UI: yes (fee display, the `<$0.001` hint).
- **Q-27i — STILL-VALID, unchanged.** `packages/wallet-crypto/src/encryption-key.ts:43-56, 68-96`; `imported-account-key-box.ts:45-77`; `imported-keys-dek-box.ts:38-73`. Byte-frozen. UI: no.
- **Q-27j — FIXED.** The default-token addresses now have a single owner, `TESTNET_TOKENS` at `apps/extension/src/wallet/services/token/default-tokens.ts:28-33` (#751). `price/price-map.ts:11-12, 55-59` imports it and keys `TOKEN_ENTRIES` from it. Residual, not drift: GBPC has a seed (`default-tokens.ts:~96-103`) but no price entry (`price-map.ts` maps USDC, USDT, EURC only), so GBPC is unpriced; whether that is intended is an owner question, not a dedup item. UI: no.
- **Q-27k — STILL-VALID, unchanged line counts.** `packages/aztec-runtime/src/pxe/artifact-catalog.ts:35-47, 58-71, 74-87` (only the import scope changed). UI: no.
- **Q-27l — STILL-VALID.** `packages/aztec-runtime/src/pxe/public-events.ts:192-197` (file changed only in imports, one `decodeFromAbi` call and a comment); `apps/extension/src/wallet/services/incoming-transfer/public-event-indexer.ts:50-55` (unchanged). UI: no.
- **Q-27m — STILL-VALID, unchanged.** `apps/extension/src/wallet/services/token-balance/service.ts:136, 185, 202, 211, 241, 256, 332, 552, 588, 659, 672`. UI: no.
- **Q-27n — STILL-VALID, unchanged lines.** `apps/extension/src/wallet/services/account/service.ts:378-400, 425-446` (the file changed only imports and `V5_REGIME` to `V6_REGIME` at :551 and :23). Both unseal-and-wipe copies still at :383 and :431. UI: no.

**Changes since audit (Q-27 as a whole):** Q-27j fixed; Q-27g grew; Q-27a gained scaffolds; the others unchanged.

**Drift to align:** `mint_to_commitment` (Q-27g), `EditProfilePopup.vue:43` NFKC vs lowercase (Q-27f), GBPC pricing (Q-27j, not dedup).

**Notes for batching**
- 27g and 27h are cross-model disagreements and owner UI calls; keep them out of the mechanical pass.
- 27f overlaps Q-26 no files but shares `token-order.ts`/`token-amount.ts`/`token-aggregate.ts` with the home-token-rows work (#754): re-check ordering tests after moving the predicate.
- 27a shares `wallet-sdk/background.ts` with the unserved-chain notice work (#752); do it as one small PR.
- 27n shares `account/service.ts` with Q-15(b) (`:439`); 27e overlaps the wait helpers Q-16 touches (`composables/`), so coordinate with the Q-16 migration.
