# Audit of `implementation-plan-p1-p3.md`

## Bottom line

**Verdict: needs work.**

Top issues, in severity order:

- The plan’s core blocking assumption is wrong. It says 4.2.0 cannot be verified locally and likely lacks stub-account and `base-wallet` helpers (`wallets-architecture-research/synthesis/implementation-plan-p1-p3.md:11-29`). Local Bun cache inspection shows 4.2 already exports `@aztec/accounts/stub/*`, `createStubSchnorrAccount`, and `@aztec/wallet-sdk/base-wallet`; only the exact `forEstimation: true` API shape is different (`~/.bun/install/cache/@aztec/accounts@4.2.0-205b1fc419e5581b@@@1_patch_hash=59dcc6b31ffc393d/package.json:7-21`, `~/.bun/install/cache/@aztec/accounts@4.2.0-205b1fc419e5581b@@@1_patch_hash=59dcc6b31ffc393d/src/stub/schnorr/index.ts:10-29`, `~/.bun/install/cache/@aztec/wallet-sdk@4.2.0-2b6ecea65106ddd2@@@1/package.json:6-15`, `~/.bun/install/cache/@aztec/wallet-sdk@4.2.0-2b6ecea65106ddd2@@@1/src/base-wallet/utils.ts:42-54`, `~/.bun/install/cache/@aztec/wallet-sdk@4.2.0-2b6ecea65106ddd2@@@1/src/base-wallet/base_wallet.ts:354-397`).
- PR 8b is aimed at the wrong layer and over-replaces working behavior. Nulo already has a stub-account override hook in PXE and already uses it for authwit discovery (`packages/aztec-runtime/src/pxe/spec.ts:36-41`, `packages/aztec-runtime/src/pxe/service.ts:233-255`, `packages/extension/src/wallet/services/execution/authwit-discoverer.ts:71-102`). Moving `buildAccountOverrides` into `nulo-account.ts` and replacing the real second simulation with stub simulation risks breaking Nulo-specific account semantics and removes a useful validation step (`packages/aztec-runtime/src/account/nulo-account.ts:120-203`, `packages/extension/src/wallet/services/execution/service.ts:1763-1802`).
- PR 10 is under-scoped and probably uses the wrong data model. The plan proposes adding a scalar `chainId` to session metadata and wiping sessions (`wallets-architecture-research/synthesis/implementation-plan-p1-p3.md:494-510`), but chain authorization already lives in `permissions`, and the real blast radius includes service contracts, dispatcher lookups, wallet-sdk discovery, and origin-keyed pending maps (`packages/extension/src/wallet/services/dapp-session/spec.ts:34-47`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:69-77`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:133-145`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:294-357`, `packages/wallet-bridge/src/services-contract.ts:50-62`, `packages/wallet-bridge/src/dispatcher.ts:231-253`, `packages/wallet-bridge/src/dispatcher.ts:314-356`, `packages/wallet-bridge/src/dispatcher.ts:367-381`, `packages/wallet-bridge/src/dispatcher.ts:569-584`, `packages/wallet-bridge/src/dispatcher.ts:775-794`).
- PR 5 is not a real prerequisite for PR 8b and may be mostly redundant. Nulo already `jsonSanitize`s request params, responses, and event payloads before transport (`packages/wallet-core/src/utils/serialization.ts:23-60`, `packages/extension-messaging/src/background/service.ts:74-100`, `packages/extension-messaging/src/offscreen/service.ts:71-99`).
- PR 1 is understated. It is not “pure auth-add, low risk” in practice; it changes the RPC contract, popup flow, and an existing e2e import/export path (`wallets-architecture-research/synthesis/implementation-plan-p1-p3.md:73-107`, `packages/extension/src/wallet/services/profile/client.ts:83-85`, `packages/extension/src/wallet/services/profile/spec.ts:168-179`, `packages/extension/src/popup/pages/settings/security/export/key.vue:52-58`, `packages/extension/tests/e2e/import-paths.test.ts:394-425`).

## 1. Verify factual claims

The plan’s direct file references are mostly accurate. I checked more than five:

- PR 1 points to `exportEncrypted`, and that exact method is at `packages/extension/src/wallet/services/profile/service.ts:507-517`.
- PR 2 points to the `port!.postMessage` race, and the racy sequence is exactly at `packages/extension-messaging/src/background/client.ts:127-181`, with the dereference at `:176`.
- PR 3’s verification note is right: default config is already `strictSecurityMode: true` at `packages/extension/src/wallet/config/config.ts:13`, and `SessionManager.open` already suppresses passhash persistence under strict mode at `packages/extension/src/wallet/services/profile/session-manager.ts:193-205`.
- PR 7 targets the correct file. `packages/extension/src/wallet/utils/offscreen.ts:45-140` unconditionally uses `chrome.runtime.getContexts` and `chrome.offscreen.*`.
- PR 8b’s NO_FROM target is correct: `executeNoFromSendTx` is `packages/extension/src/wallet/services/execution/service.ts:1706-1825`.
- PR 10’s lookup target is correct: `tryGetDappSessionByOrigin` is `packages/extension/src/wallet/services/dapp-session/service.ts:78-90`.

The Grego citations are also real:

- The CSP-safe `function-bind` stub exists exactly as described at `(Grego source tree)/extension-wallet/src/shared/function-bind-stub.cjs:1-22`.
- The Firefox fallback is real at `(Grego source tree)/extension-wallet/src/background/offscreen-lifecycle.ts:67-85`.
- The JSON retry pattern is real at `(Grego source tree)/extension-wallet/src/ipc/port-server.ts:45-88`.
- Grego’s stub-account override + stub-entrypoint simulation lives where you said it does at `(Grego source tree)/shared/src/wallet/core/demo-wallet.ts:139-226`.
- Grego’s simulate → authwit extraction → send pipeline is real at `(Grego source tree)/shared/src/wallet/core/internal-wallet.ts:162-216`.

Where the plan goes off the rails is not “bad citations”; it is “wrong inference from the citations.”

- PR 1 fits the existing code mechanically, but the plan understates the fallout. `exportEncrypted` currently has no password and the popup watcher calls it with only `id` (`packages/extension/src/popup/pages/settings/security/export/key.vue:52-58`). The client/spec also expose the passwordless signature (`packages/extension/src/wallet/services/profile/client.ts:83-85`, `packages/extension/src/wallet/services/profile/spec.ts:168-179`). There is already an e2e that assumes encrypted export is immediate and passwordless (`packages/extension/tests/e2e/import-paths.test.ts:394-425`).
- PR 2 fits well. The race is real. But if you add `RpcDisconnectedError`, it should be a `WalletError` subclass, not an ad hoc class, because the error system is already structured around `WalletError` / `RpcTimeoutError` (`packages/extension-messaging/src/errors.ts:23-55`).
- PR 4 partially fits. The `function-bind` alias is fine. The `process` addition is riskier than the plan admits because the existing config already has a specific `detect-node` shim to counteract process-based Node detection (`packages/extension/vite.config.ts:57-62`, `packages/extension/vite.config.ts:217-223`, `packages/extension/vite.config.ts:245-256`).
- PR 5 fits less well than claimed because the transport is already sanitized before send. You are not starting from Grego’s unsanitized wire; you are starting from a different transport baseline (`packages/wallet-core/src/utils/serialization.ts:23-60`, `packages/extension-messaging/src/background/service.ts:74-100`).
- PR 8b is the worst fit. Nulo already has the “stub account contract override” primitive in PXE and already uses it during authwit discovery (`packages/aztec-runtime/src/pxe/service.ts:235-246`, `packages/extension/src/wallet/services/execution/authwit-discoverer.ts:82-102`). Re-implementing Grego’s database-driven `buildAccountOverrides` in `nulo-account.ts` is forcing the pattern into the wrong abstraction.

## 2. Missing items, hidden dependencies, and migration gaps

Relative to the selected subset, you did not miss Phase 1 items from the roadmap. The README’s Phase 1 list is exactly auth gate, race fix, strict-mode verification, UX chips, JSON fallback, function-bind stub, and node polyfills (`wallets-architecture-research/README.md:549-558`), and your plan covers those (`wallets-architecture-research/synthesis/implementation-plan-p1-p3.md:34-43`).

For Phase 3, you intentionally omitted A11 capability manifests/wildcards. That is consistent with your own scope statement, but it is still a material omission from the roadmap and should be called out more explicitly as a conscious defer, not just left in the out-of-scope section (`wallets-architecture-research/README.md:572-580`, `wallets-architecture-research/synthesis/implementation-plan-p1-p3.md:61`, `:565-571`).

The bigger issue is missing dependencies:

- PR 1 must include `profile/spec.ts`, `profile/client.ts`, the export popup, and the import/export e2e. The plan mentions “find callers” but still labels the risk low. That is too casual (`packages/extension/src/wallet/services/profile/spec.ts:168-179`, `packages/extension/src/wallet/services/profile/client.ts:83-85`, `packages/extension/src/popup/pages/settings/security/export/key.vue:52-58`).
- PR 7 is not only `offscreen.ts`. Firefox manifest handling is incomplete today. The Firefox manifest only filters out `"background"` permission; it still inherits `"offscreen"` and `"sidePanel"` from the base manifest (`packages/extension/manifest/manifest.config.ts:18-34`, `packages/extension/manifest/manifest.firefox.config.ts:12-18`). That is a compatibility risk the plan does not surface.
- PR 8b likely needs `tx-request-builder.ts` and/or `execution-coordinator.ts`, not just `nulo-account.ts` plus `execution/service.ts`. The current coordinator surface has no way to pass stub addresses into `simulateTxTask` (`packages/extension/src/wallet/services/execution/execution-coordinator.ts:49-67`).
- PR 10 is not just “session service + callers.” The origin-only contract is codified in `wallet-bridge` service interfaces and is assumed by the wallet-sdk background’s pending state maps (`packages/wallet-bridge/src/services-contract.ts:50-62`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:69-77`, `:306-328`).

The migration story in PR 10 is also weak.

- You do not obviously need a migration at all, because session chain authorization already exists inside `permissions` (`packages/extension/src/wallet/services/dapp-session/spec.ts:34-47`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:340-346`).
- More importantly, adding a single `chainId` field to `DappMetadata` or `DappSession` is probably the wrong model. The persisted session model already supports multi-chain permissions via `DappPermissions[]`; a scalar `chainId` either duplicates that information or collapses a potentially multi-chain session into a single-chain slot (`packages/extension/src/wallet/services/dapp-session/spec.ts:34-47`, `packages/extension/src/wallet/services/dapp-interaction/service.ts:334-344`).
- If the real bug is “auto-approval ignores requested chain,” the cheapest correct fix is likely: keep the schema, change lookup to filter sessions by `origin` plus `permissions.some(chain match)`. That is a lookup bug, not necessarily a storage-shape bug.

## 3. Aztec version question

This is the part of the plan I trust least.

The plan says it cannot verify helper availability without `bun install` and therefore assumes 4.3.x (`wallets-architecture-research/synthesis/implementation-plan-p1-p3.md:11-29`). That is false. With filesystem access, local Bun cache is enough to answer the question:

- `@aztec/accounts` 4.2 exports `./stub/schnorr` and `./stub/ecdsa` (`~/.bun/install/cache/@aztec/accounts@4.2.0-205b1fc419e5581b@@@1_patch_hash=59dcc6b31ffc393d/package.json:7-21`).
- `createStubSchnorrAccount` and `StubSchnorrAccountContractArtifact` exist in 4.2 (`~/.bun/install/cache/@aztec/accounts@4.2.0-205b1fc419e5581b@@@1_patch_hash=59dcc6b31ffc393d/src/stub/schnorr/index.ts:10-29`).
- `@aztec/wallet-sdk` 4.2 exports `./base-wallet` (`~/.bun/install/cache/@aztec/wallet-sdk@4.2.0-2b6ecea65106ddd2@@@1/package.json:6-15`).
- `extractOptimizablePublicStaticCalls`, `simulateViaNode`, and `buildMergedSimulationResult` exist in 4.2 (`~/.bun/install/cache/@aztec/wallet-sdk@4.2.0-2b6ecea65106ddd2@@@1/src/base-wallet/utils.ts:42-54`, `:170-203`, `:215-238`).
- What does **not** exist is the exact `forEstimation: true` flag. In 4.2, the equivalent behavior is split between `completeFeeOptionsForEstimation(...)` and `opts.fee?.estimateGas` (`~/.bun/install/cache/@aztec/wallet-sdk@4.2.0-2b6ecea65106ddd2@@@1/src/base-wallet/base_wallet.ts:262-283`, `:354-357`).

So the cheapest path is not “bump to 4.3 or skip the catch-up.” The cheapest path is:

- Stay on current Aztec versions.
- Reuse the existing PXE stub-override hook for discovery-path work.
- Import or adapt the public-static helpers from 4.2’s `base-wallet`.
- Translate the fee-estimation idea into 4.2 semantics instead of chasing the exact 4.3 API name.

One nuance: your pinned “4.2.0” packages are already prerelease-flavored under the hood in cache (`4.2.0-nightly.20260413` and `4.2.0-aztecnr-rc.2`). That does not rescue the plan’s claim, but it does mean “4.2 stable vs 4.3 risky nightly” is not the real distinction here.

## 4. Design challenges

The PR order is not ideal.

- PR 5 is not required before PR 8b. It is independent at best, and low-value relative to the current transport design.
- PR 8a should not be the gate. The evidence does not support it as a prerequisite. A short “prove what 4.2 can do in-tree” spike should come before any dependency bump.
- PR 10 is labeled independent, but it touches an authorization boundary and a connection-reuse boundary. It deserves earlier design clarification, not late placement.

PR 8b is the main design problem.

- For NO_FROM, the current two-step flow has a real invariant: first simulation uses stub override to discover required authwits, then the second “real” simulation verifies the assembled authwits against the real account contract before prove (`packages/extension/src/wallet/services/execution/service.ts:1763-1802`). Replacing that second simulation with stub-account simulation removes that check.
- For FROM_ACCOUNT, Grego’s “rebuild txRequest with stub account” is not obviously safe to port verbatim because Nulo’s account wrapper is not a thin upstream adapter. `NuloAccount.buildTxExecutionRequest` does call chunking and undeployed-account initialization that Grego’s demo wallet does not own (`packages/aztec-runtime/src/account/nulo-account.ts:120-203`). A stub-generated txRequest for simulation can diverge from the real txRequest that will later be proved.
- You also cannot simply port Grego’s `DefaultEntrypoint` sketch into Nulo’s service worker path because Nulo already documents that importing `@aztec/entrypoints/default` there is not safe (`packages/extension/src/wallet/services/execution/tx-request-builder.ts:415-417`).

PR 8c’s sketch is also imprecise. The plan shows `extractOptimizablePublicStaticCalls(txRequest)` and a simple two-result merge (`wallets-architecture-research/synthesis/implementation-plan-p1-p3.md:455-462`), but the actual helper works on `ExecutionPayload`, batches optimized calls, and merges `optimizedResults[]` with an optional normal result (`~/.bun/install/cache/@aztec/wallet-sdk@4.2.0-2b6ecea65106ddd2@@@1/src/base-wallet/utils.ts:42-54`, `:170-203`, `:215-238`). The concept is still valid; the sketch is not.

PR 11 also has a logic bug. The plan says the multi-tab proof queue test “currently FAILS because PXE is global-locked” but then says the expected behavior is “tx2 blocks behind tx1; both eventually succeed” (`wallets-architecture-research/synthesis/implementation-plan-p1-p3.md:518-524`). Those are not the same thing. The global write lock should serialize, not inherently fail (`packages/aztec-runtime/src/pxe/service.ts:330-345`). The cold-SW-mid-proof case is the genuine expected failure before Phase 2; the multi-tab case should be an assertion about serialization and latency, not `test.fails`.

## 5. Risks you did not name

- Adding `globals.process` can reopen exactly the class of “browser bundle misdetected as Node” failures that your `detect-node` alias is already compensating for (`packages/extension/vite.config.ts:57-62`, `:217-223`, `:245-256`).
- The `function-bind` alias itself is low risk, but the real test risk is config divergence: if Vitest does not share the Vite alias resolution in the same way as extension builds, the stub may protect production but not test bundles. I did not find any repo-local mocks of `function-bind`, which lowers the “mock breakage” risk specifically.
- A new `RpcDisconnectedError` should preserve the existing `"Client disconnected"` semantics or you will churn tests and benign-console filters (`packages/extension/src/wallet/base/background/client.test.ts:285-326`, `packages/extension/tests/e2e/security.test.ts:8-13`).
- Firefox minimized-window fallback can duplicate windows across service-worker restarts. An in-memory `firefoxOffscreenWindowId` dies with the worker; unless you re-discover an existing window by URL, you can leak hidden windows.
- PR 6’s paymaster chip detection is muddier than the plan admits. Today `paymentMethod.kind === "embedded"` can mean “app supplied embedded fee path” or “user selected the embedded option in the wallet UI” (`packages/extension/src/popup/windows/execute/index.vue:169-179`, `packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:50`, `:82-86`). If you want a true “the app is paying” chip, you need a more precise signal than “embedded”.

## 6. What I would do differently

- I would delete PR 8a as the default path and replace it with a short verification PR or design note proving what current 4.2 already exposes.
- I would shrink PR 8b dramatically. First, factor the existing NO_FROM discovery simulation into a reusable helper around the already-supported `stubAccountAddresses` path. Second, leave the real second simulation intact. Third, do not touch FROM_ACCOUNT until you have parity tests for undeployed accounts and `APP_MAX_CALLS` chunking.
- I would rewrite PR 10 as a lookup fix before a schema change: make auto-approval require `origin` plus permitted chain membership; only add storage fields if you later prove you need indexing or session splitting.
- I would keep PR 6 local to `OperationCard.vue` styling instead of introducing a generic chip primitive unless you already want a design-system chip. The repo already has local chip styling patterns (`packages/extension/src/popup/components/modules/activity/TransactionCard.vue:147-185`).
- I would split PR 1 and PR 2. PR 2 is an internal correctness fix; PR 1 changes user-visible security UX and test fixtures.

## Explicit questions you should answer before implementation

- For PR 8b, what exact invariant do you want from the second simulation: “gas estimate only” or “real-account validation before prove”? Your current plan silently changes that.
- For FROM_ACCOUNT simulation, how will you preserve `NuloAccount`’s chunking and undeployed-account initialization behavior if you rebuild tx requests through a stub account?
- For PR 10, do you want one dApp session per origin-per-chain, or one multi-chain session whose auto-approval is filtered by requested chain? Your proposed scalar `chainId` field dodges that choice.
- If Firefox fallback uses minimized windows, how will you rediscover and deduplicate the hidden host window after a service-worker restart?
- Do you actually have a reproducible `DataCloneError` on Nulo’s current wire after `jsonSanitize`, or is PR 5 being cargo-culted from Grego’s pre-sanitized transport?
- For the export-encrypted auth gate, what is the intended UX for password profiles versus passkey profiles? Today encrypted export is effectively the “easy path” in settings; requiring password changes that interaction contract.
