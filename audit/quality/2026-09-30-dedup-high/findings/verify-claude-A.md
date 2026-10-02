# Verify (Claude A): Q-01 to Q-05

Read-only verification against source on `dev`. Each section records the independent conclusion reached from the instance list alone, then the comparison with the finding text.

## Q-01 — confirmed

**Independent conclusion (before reading the description):** One root cause (chain identity derived in many places instead of one owner), appearing as three sub-families. All copies are semantically equal today, so this is shotgun-surgery risk, not live drift.

**Corrected instances**
- (a) Composite formula `(l1ChainId ^ rollupVersion) >>> 0`. Owner: `apps/extension/src/utils/chain-ids.ts:12-14` (`walletChainId`). Copies:
  - `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:101`
  - `packages/aztec-runtime/src/utils/chain-identity.ts:59`
  - `apps/extension/src/wallet/services/network/service.ts:1010` (the file imports `@/utils/chain-ids` at `:24` but not `walletChainId`)
  - `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:16-21` (`chainInfoToChainId`; used by `background.ts:641,752,1189` and `session-established.ts:71`)
  - `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:45-56` (private byte-identical copy, used at `:128`)
  - **Missed by the finding:** `apps/extension/scripts/seed-preflight.ts:22`
- (b) Hand-written `ChainInfo` literal instead of `chainInfoFrom` (`packages/aztec-runtime/src/utils/chain-identity.ts:73-75`). Line numbers are off by 1-3 in the finding, otherwise correct:
  - `execution/authwit-discoverer.ts:119, 174-175, 225-226, 239-240`
  - `execution/discovery-probe.ts:79`
  - `execution/dapp-send-executor.ts:1005` (variable is `nodeInfo2`)
  - `execution/view-executor.ts:213`
  - `execution/fast-path.ts:228-229`
  - `execution/service.ts:1021-1022`
  - `execution/helpers/batched-view-simulation.ts:363-364` (same file uses `chainInfoFrom` at `:204`)
  - That is 10 literals, matching the finding.
- (c) NO_FROM sender normalization, three copies, all real:
  - `packages/wallet-bridge/src/dispatcher.ts:185-193`
  - `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:84-89`
  - `apps/extension/src/wallet/services/execution/utils/fee-detection.ts:18-20`
  - Session address sets: `dispatcher.ts:436-449` (raw plus CAIP, deliberately different) and `:1728-1736` (chain-filtered). `queued-journal.ts:143` builds an unfiltered set.

**Drift evidence:** No behavioral drift in (a) or (c). The copies are kept equal by comments only: `queued-journal.ts:45` ("Mirror of background.ts's chainInfoToChainId. Inlined to keep this module test-harness-friendly"), `dispatcher.ts:181-183` ("Mirrors `execution/utils/fee-detection.ts:18`; inlined here so the dispatcher stays decoupled"), and the `extractSendFrom` comment ("Mirrors the dispatcher's normalization exactly"). The session-address-set variants (`dispatcher.ts:439` versus `queued-journal.ts:143`, chain-filtered versus not) already differ. Note that `queued-journal.ts:45` names `background.ts` as the original, but the function now lives in `session-established.ts`, so that comment is stale.

**Refined fix**
- Put `walletChainId` in `packages/aztec-runtime/src/utils/chain-identity.ts`, next to `chainInfoFrom` and `assertLiveChainIdentity`. Add a `chainIdFromSdkChainInfo` decoder there (it needs `Fr`, which aztec-runtime already imports).
- `apps/extension/src/utils/chain-ids.ts` re-exports `walletChainId`. The extension already imports from `@nulo/aztec-runtime`.
- Replace the 10 literals with `chainInfoFrom(nodeInfo)`. Add a small `liveChainInfo(node, network)` (fetch, `assertLiveChainIdentity`, `chainInfoFrom`) only for the five fetch-and-assert sites.
- Put `NO_FROM` and `requestedSenderOf` in `packages/wallet-bridge/src/account-resolution.ts`, which exists. Both the extension (`fee-detection.ts`, `queued-journal.ts`) and the dispatcher can import it. `wallet-core` cannot host the `Fr`-based pieces, and `wallet-bridge` does not depend on `aztec-runtime`, so the split above follows the layer rules.
- Leave the dispatcher's `sessionAccountsOf` distinct.

**Effort:** about 1 day. **Final confidence:** high.

**ELI5:** The rule for "which network am I on" is copy-pasted in many places, so changing it means finding every copy, and missing one makes signing refuse or files things under the wrong network.

## Q-02 — confirmed

**Independent conclusion:** Real duplication in three families. The authwit decode loop is three near-copies with one intentional difference. The selector/name binding guard is six copies, and one (fast-path) is deliberately stricter. The class-id guard is two identical copies.

**Corrected instances**
- (a) Decode loop (offchain effects, live chain identity, `CallAuthorizationRequest.fromFields`, `computeAuthWitMessageHash`, `toDiscoveredAuthwit`, skip malformed):
  - `authwit-discoverer.ts:110-141`
  - `discovery-probe.ts:66-101`
  - `dapp-send-executor.ts:1000-1019`
  - Correct. All three also carry the hand-written `chainInfo` from Q-01(b).
- (b) Selector/name binding guard, six sites, line numbers verified within 1-2 lines:
  - `tx-request-builder.ts:340-348` and `:587-599` (`validateEncodedCallFn`, which also mutates `action.type` and `isStatic`)
  - `authwit-discoverer.ts:197-205`
  - `service.ts:1043-1051`
  - `view-executor.ts:367-373`
  - `fast-path.ts:135-140`
- (c) Class-id guard: `service.ts:834-837` and `:981-984` (identical). Artifact hop: `fast-path.ts:129-130`, `view-executor.ts:93-94` and `:365-366`. All correct.

**Drift evidence**
- Name policy: `fast-path.ts:138` uses `call.name !== fn.name`, so a missing name fails. The other five use `name !== undefined && name !== fn.name`. The fast-path docstring (`fast-path.ts:~118`) says the name is what scope enforcement authorized, so this is documented and intentional.
- Error text differs across sites: `authwit call name "..."` (discoverer, `service.ts`) versus `call name "..."` (the others).
- `discovery-probe.ts` dedupes by message hash (`seen` set); the discoverer and dapp-send copies do not. The probe also takes an injected `crypto` seam. Both differences are intentional.
- `contract-resolver.ts:55-58` states that callers own their frozen error text. A shared guard must therefore take the message context as a parameter, not hardcode it.

**Refined fix**
- Add a sync `assertSelectorBinding(fn, { name, to, label, requireName })` to `execution/contract-resolver.ts`, beside the existing `findFunctionBySelector`. It is a pure function, so it stays inside the execution layer.
- Extract `decode-authwit-effects.ts` next to `discovered-authwit.ts` (which already owns `toDiscoveredAuthwit`). It returns ordered `{record, messageHash}` pairs, takes the crypto seam, and leaves the probe's dedupe in the caller.
- Add `assertArtifactMatchesInstance` to `contract-resolver.ts`.
- The `fast-path` lookup `try/catch` (lookup error falls back, binding error escapes) stays local.
- Tests that pin the exact error strings must keep passing unchanged.

**Effort:** 1-2 days. **Final confidence:** high for (a) and (b), moderate for (c) (it is only two lines, low value on its own).

**ELI5:** Every path that runs a dApp's request re-checks "is this really the function you approved" by hand, so a new rule has to be added in six places and forgetting one silently drops a safety check.

## Q-03 — partially confirmed

**Independent conclusion:** Five separate smells bundled under one title, not one root cause. (a) and (d) are real, tight duplicates. (b) and (c) are real but smaller than claimed because single-step helpers already exist. (e) I did not open in depth.

**Corrected instances**
- (a) Fenced commit (`assertCurrent`, write, `isCurrent` re-check, compensating delete, throw `profile ${id} deleted`): 7 sites in 6 files, all confirmed.
  - `fpc/service.ts:230-238` and `:293-302`
  - `contact/service.ts:116-123`
  - `dapp-session/service.ts:203-210`
  - `network/service.ts:325-330` and `:494-499`
  - `token/service.ts:413-422` (plus a network-liveness leg that stays local)
  - Not an instance: `operation-journal/service.ts:281` (check-only, no compensating write, different message).
- (b) Purge pipelines:
  - `auth-registry/service.ts:505-573` has three methods. They differ only in their typed and raw predicates, and they already call the shared `purgeRows` and `purgeMalformedRows` from `purge-rows.ts`. The remaining duplication is the lock, the two passes and the status purge.
  - `token-balance/service.ts:546-561` and `:574-601` use a different mechanism (`repo.getAll`, `invalidateAndDelete`, emit only when the live token matches, `repo.purgeMalformed`). These are not the same pipeline as auth-registry. Sharing them is weaker than the finding says.
  - Scope key template `` `${chainId}:${address}` ``: `auth-registry/service.ts:515,518,533,536`; `token-balance/service.ts:577,581,598`. Correct.
  - **Correction:** the inline scope tuple type is at `token-balance/service.ts:574` and `auth-registry/service.ts:512`. The finding's `:147` and `:107` are wrong (those are subscriber registrations).
- (c) Restore preamble (profile-id guard plus `captureRestoreEpochs`): `token-balance/service.ts:676-685`, `auth-registry/service.ts:589-597`, `transaction/service.ts:529-538`. Correct, identical text `restore requires the created profile id`. `network/service.ts:280` captures epochs in a different shape and is not an instance.
  - Hostile-row cast before `captureRestoreEpochs`: `contact/service.ts:287-290`, `account/service.ts:674-677` and `:766-769`, `token/service.ts:858-861`. Correct.
  - `config/service.ts:62-84` is not a clean `restoreRows` fit: the loop skips non-allowlisted keys without emitting a result row. A `filter` plus `restoreRows` would work, but it is low value.
- (d) Row identity gate: `account/service.ts:180`, `:339-341`, `:408-411`, `account/imported-keys-repository.ts:29-30`. Correct.

**Drift evidence:** `account/service.ts:322` (`patchAccountField`) checks only `profileId` and `chainId`; the three other account gates and the imported-keys repository also check `address`. That is real drift of exactly the kind the refactor prevents. It is latent, since the row is fetched by a key that embeds the address, but the gate's own comments explain that transplanted rows are the threat it exists for.

**Refined fix**
- Highest value, smallest: `rowMatchesKey(row, profileId, chainId, address)` in `account/spec.ts`, used by the five sites. Fixes the drift.
- `requireRestoreProfileId(profileId)` added to the existing `restore-fence.ts`, next to `captureRestoreEpochs` and `assertRestoreEpoch`.
- A `fencedSet` helper for (a), as one PR starting with the two fpc sites. Keep `token/service.ts`'s extra network leg local.
- `accountScopeKey()` plus an `AccountScope` type.
- A local `purgeMatchingLocked({typed, raw, status})` inside auth-registry only. Do not force token-balance onto it.
- Skip the `config.restore` and raw-marker-store (e) work unless touched for other reasons.

**Effort:** 2-3 days as stated, but the worthwhile subset (a, c, d) is about 1-1.5 days. **Final confidence:** moderate (high for (a), (c), (d); low for the token-balance half of (b)).

**ELI5:** The "don't leave a half-saved row if the profile was deleted mid-save" routine is pasted into seven places, so a change to it has to be made seven times and one account check has already been missed.

## Q-04 — confirmed

**Independent conclusion:** One real root cause (the primary endpoint is looked up by hand everywhere) plus three real secondary issues. One of them is a live behavioral bug.

**Corrected instances**
- (a) `network.endpoints.find((e) => e.id === network.primaryEndpointId)`, 15 copies, all confirmed: `network/service.ts:348(!),423,581,731,747,769,846`; `network/spec.ts:93,107`; `execution/transfer-executor.ts:377`; `execution/dapp-send-executor.ts:470`; `execution/operation-estimate-reuse.ts:141`; `execution/transfer-estimate-reuse.ts:181`; `incoming-transfer/service.ts:536`; `popup/components/popups/EditNetworkPopup.vue:58`. `getNetworkInfo` (`network/service.ts:844-851`) duplicates `networkInfoFrom` (`spec.ts:92-96`). Existing helpers already in `spec.ts`: `networkInfoFrom` and `primaryEndpointUrl`. Additional related use (not a lookup copy): `popup/components/popups/EditEndpointPopup.vue:27` finds a non-primary endpoint by id.
- (b) `getNodeStatus` (`network/service.ts:728-742`) and `probeNodeStatus` (`:744-760`): confirmed.
- (c) `addEndpoint` and `updateEndpoint` (`:603-615` and `:650-661`): the identity guard is textually the same. Confirmed.
- (d) Transport allowlist: `network/spec.ts:151-178` and `aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58-73`. Confirmed.
- (e) Popup error ladders: `NewEndpointPopup.vue:54-63` and `EditEndpointPopup.vue:69-78`. Confirmed, with different "duplicate" copy in the two.

**Drift evidence (strongest case in this batch)**
- (b): `getNodeStatus` calls `_getChainId(primary.rpcUrl)` with no `kindHint` (`service.ts:734`), so the `kind === "local"` carve-out in `_probeChainIdentity` (`:1008`) is skipped. `probeNodeStatus` applies it (`:753`). A local-kind network on a non-default loopback URL reports `InvalidChain` from one method and `Active` from the other.
- (d): `RpcUrlSchema` rejects userinfo (`spec.ts:166`); `isAllowedRpcUrl` in the adapter does not, so `https://user:pass@host` passes the adapter.
- Also, `network/spec.ts` carries a comment citing an audit round ("Codex Round 2 B-3"), which CLAUDE.md bans.

**Refined fix**
- Add `findPrimaryEndpoint(network)` in `network/spec.ts`. Derive `networkInfoFrom` and `primaryEndpointUrl` from it. Callers keep their own missing-primary policy (the `!`, `?? endpoints[0]` and soft-fail behaviors differ deliberately). Popups already import `@/wallet/services/*/spec` (for example `task/spec` in `RecentActivityView.vue:18`), so `EditNetworkPopup.vue` may use it.
- `getNetworkInfo` becomes `networkInfoFrom(await this.getNetwork(id))`.
- A private `statusFor(network, probe)` so both status paths share the carve-out.
- For (d), export `isAllowedRpcUrl` from aztec-runtime (it already exists and is exported) and have `RpcUrlSchema` call it; add the userinfo rejection inside `isAllowedRpcUrl` itself. That is a security-posture tightening of the adapter, so it needs owner sign-off; otherwise keep userinfo schema-only. The finding's suggested new `wallet-core/src/utils/rpc-url.ts` is unnecessary since the extension already depends on aztec-runtime.
- `assertSameChainIdentity(probed, network)` for (c), keeping lock boundaries and error order.
- Shared `endpointErrorMessage` for (e), in a popup-local module.

**Effort:** 1-2 days. **Final confidence:** high.

**ELI5:** "Which server is this network using" is worked out by hand in 15 places, and two status checks already disagree about local networks.

## Q-05 — confirmed, with one stale range

**Independent conclusion:** Real, high-cost duplication in the strategy builders, plus a genuine producer/validator pairing problem in the reuse ladders. The fee basis is recomputed in five places. The two reuse ladders already disagree on error policy.

**Corrected instances**
- (a) Task wrapper (`startEstimateTask` ... `task.complete()` / `task.fail(error); throw`), five copies:
  - `fee/fee-juice-strategy.ts:25-74`
  - `fee/embedded-strategy.ts:32-51`
  - `fee/fpc-strategy.ts:136-201` and `:207-306`
  - **Stale:** `fee/fee-juice-with-claim-strategy.ts:79-102` does not exist (the file is 50 lines). The copy is at `:25-48`.
- Folded-probe rebuild: `fee-juice-strategy.ts:33-58`, `fpc-strategy.ts:153-176` and `:221-258`. Correct. The rebuild predicate differs on purpose (`discovered.length || isInitWrapped(built)` in fj and the sponsored fast path, `isInitWrapped(built)` alone in two-pass).
- FPC finalize tail: `fpc-strategy.ts:177-200` and `:283-302`. Correct.
- Validated re-simulation option literal `{ simulatePublic: true, skipFeeEnforcement: true, scopes: [...] }`: `fee-juice-strategy.ts:54`, `fee-juice-with-claim-strategy.ts:39` (finding says `:93`), `embedded-strategy.ts:42`, `fpc-strategy.ts:172,254,280`, `fee-strategy.ts:170`. That is 7. **Also** `dapp-send-executor.ts:895` (an 8th).
- (b) Fee composition `predictedWorstMinFees(node).mul(multiplier)`: `fee-strategy.ts:286-290`, `fpc-strategy.ts:177` and `:261`, `operation-estimate-reuse.ts:160-161`, `transfer-estimate-reuse.ts:195-202`. Correct. The priority-to-multiplier ternary: `operation-estimate-reuse.ts:160`, `transfer-estimate-reuse.ts:198-200`, and the facade at `service.ts:1103` (the finding lists `:1103` under "default multiplier", but it is actually the ternary). The default `?? DEFAULT_FEE_MULTIPLIER` is at `fpc-strategy.ts:135,206` and `fee-strategy.ts:272`.
- (c) Producers `transfer-executor.ts:343-430` and `dapp-send-executor.ts:440-520`; validators `transfer-estimate-reuse.ts:148-216` and `operation-estimate-reuse.ts:108-175`; `fingerprintBaseFee` at `transfer-estimate-reuse.ts:44`, imported by the operation ladder and `dapp-send-executor.ts:57` (wrong home). Confirmed.

**Drift evidence**
- Operation ladder (`operation-estimate-reuse.ts:159-162`): `getNode` and `predictedWorstMinFees` run outside any `try`, so a fee-fetch error escapes `tryConsume`. Transfer ladder (`transfer-estimate-reuse.ts:195-208`): wrapped in `try/catch`, rejects softly with `base fee fetch failed`.
- Only the transfer ladder re-wraps `new GasFees(basis.feePerDaGas, basis.feePerL2Gas)` before `.mul` (defensive, for minimal nodes); the operation ladder calls `.mul` directly on the result.
- The transfer ladder has two "primary endpoint" rejection reasons; the operation ladder has one.
- A mismatch between the builder's fee basis and either ladder does not fail loudly: it permanently rejects reuse as base-fee drift.

**Refined fix**
- `fee/fee-strategy.ts` already owns `startEstimateTask`, `probedFirstSimOpts`, `isInitWrapped`, `finalizeGasLimits` and `DEFAULT_FEE_MULTIPLIER`. Add there: `withEstimateTask(deps.tasks, ctx.parentTask, run)`, `validatedSimOpts(built)` (this alone removes 8 literals), and `resolveFeeMultiplier(priorityLevel?)`.
- `committedMaxFees(node, multiplier)` in `packages/aztec-runtime/src/fee-juice.ts`, next to `predictedWorstMinFees`.
- A private `commitFpcEstimate` inside the FPC strategy for the finalize tail.
- Move `fingerprintBaseFee` into a shared `execution/estimate-reuse-shared.ts`.
- Each ladder keeps its own step order and error policy. Whether the operation ladder should reject softly is a bug decision, not a side effect of the refactor.
- Risk: the two-pass shape is frozen by a byte-parity comment and pinned by `fee/fee-structural-parity.test.ts` and `fee/strategies-structural.test.ts`. Do the option-literal and multiplier extractions first (mechanical), the task wrapper second, and the probe-fold hoist last, running those parity tests at each step.

**Effort:** 2-3 days. **Final confidence:** high for (a) literals, (b) and the drift; moderate for the probe-fold hoist (the two rebuild predicates differ and the frozen shape makes it the riskiest step).

**ELI5:** The "estimate the fee" recipe and the "is the saved estimate still valid" check each recompute the same price by hand, so changing how fees are priced must be done in five places, and a mismatch just quietly stops reusing saved estimates.
