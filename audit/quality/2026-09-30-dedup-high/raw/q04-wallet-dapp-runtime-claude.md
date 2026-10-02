# q04-wallet-dapp-runtime — claude

Scope read: apps/extension/src/wallet/services/network/{service,spec,client}.ts; auth-registry/service.ts (purge + setRegistryEnabled/revoke regions); dapp-session/service.ts (purge regions); dapp-interaction/materialize.ts; wallet-sdk/{background.ts (discovery regions 860-1070), session-established.ts, queued-journal.ts}; utils/chain-ids.ts; jscpd lead list; prior audits 2026-08-14 / 2026-08-16. Other cluster dirs (offscreen, presto, core, content-script, logger, window-manager, pxe, utils, base, config, constants) were only scanned for duplicate top-level function names; nothing semantic surfaced there.

## q04-wallet-dapp-runtime-C-1: `chainInfoToChainId` copy-pasted, and both copies bypass the existing `walletChainId` formula

- **Smell:** Duplicate Code (Fowler) with a Shotgun Surgery risk.
- **Maintenance impact:** structural; blast radius 4 files; the wallet-SDK files changed 15 times since 2026-06-01. The XOR formula is identity-critical: it keys every storage scope and session.
- **Evidence:** The composite chain id `(l1ChainId ^ rollupVersion) >>> 0` is single-sourced as `walletChainId` in `apps/extension/src/utils/chain-ids.ts:12-14`. It is re-implemented inline in three more places:
  - `wallet/services/wallet-sdk/session-established.ts:16-21`, the exported `chainInfoToChainId`. It includes the `typeof === "string" ? Number(BigInt(..)) : Number(.toBigInt())` parsing, which appears twice within the function.
  - `wallet/services/wallet-sdk/queued-journal.ts:51-56`, a byte-identical private copy. Its comment says it is "inlined to keep this module test-harness-friendly", but `session-established.ts` is already a light module that `queued-journal.ts` could import. `session-established.ts` itself imports the heavy `window-manager` and `verify-admission`, so the claim is not obviously true.
  - `wallet/services/network/service.ts:1010`, inline `(info.l1ChainId ^ info.rollupVersion) >>> 0`. This one does not use `walletChainId` either.
  - Consumers: `background.ts:641,752,1189`, `session-established.ts:71`, `queued-journal.ts:128`.
- **Why it harms future change:** Changing the composite rule means editing 4 copies. A sibling file even carries a comment calling one a "Mirror of background.ts's chainInfoToChainId". The wallet-side and dApp-session-side ids must agree or sessions bind to the wrong network (a silent failure). Any change to string parsing (for example hex vs decimal `Fr` strings) lands in one copy and not the other.
- **Smallest safe refactoring:** Move Function + Replace Inline Code with Function Call. Add `chainInfoToWalletChainId(chainInfo)` to `utils/chain-ids.ts`, implemented through `walletChainId`. Delete both local copies and have `session-established.ts` re-export or import it. Use `walletChainId(...)` in `network/service.ts:1010`.
- **What disappears:** about 12 lines plus one mirrored-comment liability; the 4 implementations become 1.
- **Instances:** `wallet/services/wallet-sdk/session-established.ts:16-21`, `wallet/services/wallet-sdk/queued-journal.ts:45-56`, `wallet/services/network/service.ts:1010`.

## q04-wallet-dapp-runtime-C-2: "network's primary endpoint" lookup hand-rolled 13+ times though `networkInfoFrom` / `primaryEndpointUrl` exist (and `getNetworkInfo` duplicates `networkInfoFrom` body-for-body)

- **Smell:** Duplicate Code plus Feature Envy (callers dig into `Network.endpoints` and `primaryEndpointId` instead of asking a method on the type).
- **Maintenance impact:** structural; blast radius 9 files across service, execution and popup (`network/service.ts` 31 commits since 2026-06-01, the highest churn in the cluster). The no-primary handling already diverges between copies: `?? endpoints[0]`, `!` assertion, throw, silent skip, `?.`.
- **Evidence:** `find((e) => e.id === network.primaryEndpointId)` appears at `network/service.ts:348, 423, 581, 731, 747, 769, 846`, `network/spec.ts:93, 107`, `execution/transfer-executor.ts:377`, `execution/dapp-send-executor.ts:470`, `execution/operation-estimate-reuse.ts:141`, `execution/transfer-estimate-reuse.ts:181`, `incoming-transfer/service.ts:536`, and `popup/components/popups/EditNetworkPopup.vue:58`. Specific overlaps:
  - `network/service.ts:844-851` (`getNetworkInfo`) has a body identical to `networkInfoFrom` at `spec.ts:92-96`, including the identical error string.
  - `service.ts:769-771` (`getNode`) is the same lookup plus the same throw message.
  - `service.ts:731-733` and `747-749` (`getNodeStatus` / `probeNodeStatus`) share the same lookup and the "no primary → Inactive, try → probe → compare chain → Active/InvalidChain/Inactive" skeleton. They differ only in the probe call and the local-network carve-out.
- **Why it harms future change:** Adding a primary-selection rule (failover, health-ordered primary) needs 14 edits, and the `!`-asserting copies (`service.ts:348`) would throw on a shape the lenient copies tolerate.
- **Smallest safe refactoring:** Extract Function, Move Function. Add `requirePrimaryEndpoint(network)` (throws) and `findPrimaryEndpoint(network)` (optional) to `network/spec.ts` next to the existing helpers. Make `getNetworkInfo` return `networkInfoFrom(network)`. Collapse the two status methods onto one `private _statusFor(network, probe: (url) => Promise<number>)`. The execution and incoming-transfer call sites import from `wallet/services/network/spec` and need no new edges.
- **What disappears:** about 40 lines, plus 1 duplicated function body (`getNetworkInfo`).
- **Instances:** listed above.

## q04-wallet-dapp-runtime-C-3: `addEndpoint` / `updateEndpoint` share a pasted chain-identity guard and probe-peek preamble (`RECURRING (prior: 2026-08-16-extension-mid Q-09)`)

- **Smell:** Duplicate Code, Fowler "Form Template Method" shape.
- **Maintenance impact:** local to `network/service.ts`; 31 commits since 2026-06-01. The jscpd lead `service.ts:595-616` vs `641-662` (22 lines) confirms it is still present.
- **Evidence:**
  - The two-check block `probed.chainId !== network.chainId` → `ERR_ENDPOINT_CHAIN_MISMATCH` and `probed.l1ChainId !== network.l1ChainId` → `ERR_ENDPOINT_CHAIN_MISMATCH` is pasted verbatim at `service.ts:594-607` and `641-654`, including the XOR-collision comment, which is paraphrased in the second copy as "see addEndpoint".
  - The preamble is also duplicated: `validateParams`, `ensureInitialized`, `requireActiveProfile`, peek row, `_probeChainIdentity(rpcUrl, peek.kind)`, then `lock.withLock` with re-read.
  - `label?.trim() || undefined` and `normalizeRpcUrl` are duplicated too.
- **Why it harms future change:** This guard protects key derivation (per its own comment). A third mutation, such as "replace endpoint set" or a restore-path check, must either paste a third copy or remember to call the right one. A fix to the L1 equality rule can land in one copy only.
- **Smallest safe refactoring:** Extract Function `assertSameChainIdentity(probed, network)`, a module-level function in `network/service.ts` or `network/spec.ts`, plus an optional `withProbedEndpoint(networkId, rpcUrl, mutate)` wrapper for the preamble (Parameterize Function). Do not merge the two public methods; their bodies legitimately diverge.
- **What disappears:** about 25 lines and one duplicated comment block.
- **Instances:** `network/service.ts:594-607`, `641-654` (guard); `575-593`, `620-640` (preamble).

## q04-wallet-dapp-runtime-C-4: auth-registry's three `purgeFor*` methods repeat one 3-step purge; scope-matching is written twice per method

- **Smell:** Duplicate Code, with Switch-Statement-like parallel predicates (the typed predicate and the raw predicate must always agree).
- **Maintenance impact:** local; `auth-registry/service.ts` has 14 commits since 2026-06-01. Jscpd leads: `:519-530` vs `544-552` vs `564-572`.
- **Evidence:** `purgeForAccounts` (`service.ts:505-535`), `purgeForProfile` (`:538-553`) and `purgeChain` (`:557-573`) each run lock → `getValues().filter(P)` → `purgeRows(...)` → `purgeMalformedRows(raw => P')` → `purgeStatuses(s => P'')`. Each method therefore spells the same scope predicate three times (typed authwit, raw row, status key), in three different shapes (`a.profileId === ...`, `raw.profileId === ...` with `typeof` guards, `s.profileId === ...`). `DappSessionService.purgeForProfile` (`dapp-session/service.ts:427-447`) and `purgeChain` in other services use the same lock → purgeRows → emit skeleton.
- **Why it harms future change:** Adding a scope field (for example a network-id dimension) means editing 9 predicates in this file. The raw-row variant is the easy one to forget, and a validation-failed row then survives a purge ("revives on re-import", as the comments warn).
- **Smallest safe refactoring:** Extract Function `purgeScope(matches: ScopeMatcher)` taking one `{profileId, chainId?, accountKeys?}` descriptor. A single `matchesScope(x, scope)` over the shared field names `profileId, chainId, account` would serve all three row shapes, because the typed, raw and status-key forms all carry those fields.
- **What disappears:** about 35 lines; 9 predicates become 1.
- **Instances:** `auth-registry/service.ts:505-535, 538-553, 557-573`.

## q04-wallet-dapp-runtime-C-5: discovery admission ladder pasted in two branches of `background.ts`

- **Smell:** Duplicate Code (Consolidate Duplicate Conditional Fragments).
- **Maintenance impact:** local; `background.ts` 23 commits since 2026-06-01. Security-relevant throttle path (F-04), which raises the cost of divergence.
- **Evidence:** `background.ts:939-949` (duplicate of a settled popup) and `1021-1031` (fresh connection after Allow) both contain:
  - `admitAsync(deps.admission, { id, origin, deadline: discoveryDeadline(discovery), needsWindow: true, consumesToken: false })`;
  - the `admitted === "rejected" || admitted === "expired"` check;
  - `rejectThrottled(discovery, deps, admitted === "expired" ? "expired while queued" : "verify-window queue full")`.
  Only the preceding comment and the post-admission action differ.
- **Why it harms future change:** Changing the verify-window admission policy (the reason strings, `consumesToken`, or a new outcome such as "deferred") is a two-site edit. The window-slot requirement is also restated a third time in `autoApproveExistingSession` (`:877+`) with different flags.
- **Smallest safe refactoring:** Extract Function `admitVerifyWindow(discovery, deps): Promise<WindowReservation | undefined | "stop">` or `Promise<{ok:false}|{ok:true, reservation}>`, local to `background.ts`.
- **What disappears:** about 18 lines; 2 copies of the reason-string ternary.
- **Instances:** `wallet/services/wallet-sdk/background.ts:939-949`, `1021-1031`.

## Non-findings considered

- `dapp-interaction/materialize.ts:68-88` (jscpd 12-line clone, `send_transaction` vs `aztec_sendTx` arms): both arms are a two-line resolve + spread, with a per-kind `as DraftOperation` cast. Extracting them would remove the explicit switch that type-checks each kind, and the cost is under 15 lines.
- `network/service.ts:846-876` vs `spec.ts:93-106`: folded into C-2 (only the primary-lookup and `getNetworkInfo` part is real; the rest of the jscpd span is unrelated text).
- `network/service.ts:301-330` (seed) vs `492-505` (`addNetwork`) deletion-fenced write-then-compensate (`assertCurrent` → `storage.set` → `isCurrent` → `delete` → throw): about 6 lines, two sites, and already factored as `seedOneNetworkLocked`. Below the threshold.
- `purgeRows` usage across 9 services: already the shared primitive; the remaining duplication is predicate shape (covered in C-4 for auth-registry only).
- `DappSession*` and `logger` spec/client/service triads: documented-deliberate convention.
- `window-manager`, `pxe`, `offscreen`, `presto`, `core`, `content-script`: only duplicated top-level names were test harness helpers (`makeService`, `makeHarness`, `boot`), out of scope.
- `auth-registry/service.ts:295-311` vs `351-365` (`revokeAuthwits` vs `setRegistryEnabled`): about 17 shared lines (executeSendTransaction → waitForTx → nodeFor → waitForTxProven → sync → complete/fail-with-rethrow). It is a real shape repeat, but only 2 sites in one file. Noted as borderline and not raised; it becomes a finding if a third registry tx method appears.
- `execution/dapp-send-executor.ts` internal clones (jscpd rows) belong to another cluster.

## Incidental bugs noticed (for the bugs run)

- `wallet/services/network/service.ts:575-590` (`setActiveNetwork`): if the network has no primary endpoint, the write to the active pointer happens and `onActiveNetworkChanged` is emitted, but no node is cached. `activateSeededLocked` (`:348`) uses a non-null assertion on the same lookup and throws instead. Counter-example: a row whose `primaryEndpointId` does not match any endpoint (a legacy lax-codec row, since `NetworkRowSchema` does not require `min(1)` or the match). `setActiveNetwork` succeeds and the next `getNode` throws "has no primary endpoint". The behavior diverges rather than fails fast; low confidence that it is reachable.

## Cross-rebuttal (claude on codex)

### 1. Codex's findings

- **X-1 (addEndpoint/updateEndpoint identity guard): agree.** Same as my C-3; `service.ts:603-615` and `650-661` are the pasted guard. Codex omits `label?.trim()` and `normalizeRpcUrl` duplication, which I kept.
- **X-2 (RPC transport allowlist in two places): agree, and it is a real miss on my side.** `spec.ts:151-178` and `aztec-node-factory-adapter.ts:58-73` hold the same scheme/loopback decision tree with the same three-host list. The userinfo check exists only in the schema, so the two already differ. The proposed `wallet-core` home fits the layer order (`wallet-core` sits below `aztec-runtime`). The refactor must keep userinfo rejection schema-only, or add it to the adapter as a deliberate hardening with owner sign-off.
- **X-3 (auth-registry tx settlement workflow): partially.** The shape repeat is real (`service.ts:281-321` vs `336-375`, about 17 shared lines). I listed it as borderline and did not raise it because there are only two sites in one file. Codex rates it "high confidence", which is fine, but the impact is local and low; I would not promote it above C-4.
- **X-4 (three purge paths): agree.** Same as my C-4. Codex's `purgeMatchingAuthwitsLocked` taking three separate predicates is safer than my single `matchesScope(x, scope)`. The raw-row predicate has `typeof` guards, so the three row shapes do not share one matcher trivially. Adopt Codex's form.
- **X-5 (chain-info decode in two files): agree, but incomplete.** Codex found 2 copies. There is a third inline `(info.l1ChainId ^ info.rollupVersion) >>> 0` at `network/service.ts:1010`, and `walletChainId` already exists at `utils/chain-ids.ts:12-14`. The right target is that util, not a new `wallet-sdk/chain-info.ts` leaf. That would create a second owner of the formula.

### 2. What Codex missed that I still stand by

- **C-2:** the primary-endpoint lookup is repeated 13+ times (`service.ts:348, 423, 581, 731, 747, 769, 846`, `spec.ts:93, 107`, plus execution, incoming-transfer and `EditNetworkPopup.vue`). The no-primary handling diverges between copies. Codex mentions only the `getNetworkInfo` clone, as a non-finding.
- **C-5:** the admission ladder is pasted at `background.ts:939-949` and `1021-1031`. It sits on a security throttle path. Codex's scope read covered `wallet-sdk`, yet it neither reports nor dismisses this.

### 3. What both missed

- **Duplicate Code (near-twin methods):** `getNodeStatus` (`network/service.ts:728-742`) and `probeNodeStatus` (`:744-760`) repeat a five-line skeleton. The copies have already drifted: Codex's incidental bug (`_getChainId` without `network.kind` at `:734`) is the direct symptom of the two copies not sharing the local-network carve-out that `:753` applies. I flagged the skeleton in C-2, but Codex's bug shows the drift has already caused a behavioral defect. It should be promoted to a standalone finding: extract `effectiveChainId(network, primary, probed)` so both paths apply the carve-out. This reinforces C-2 and corrects its "local" severity to "already diverging".
- **Comment-debt smell, workflow reference:** `spec.ts:~166` carries "Codex Round 2 B-3 verified empirically". That is an audit-round tag, which CLAUDE.md's comment rules ban (milestone/plan/review tags). Delete it in the same PR as the X-2 extraction.
