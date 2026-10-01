# Recon: unserved-chain-connect

One batched reuse sweep (read-only, 2026-10-01) against `origin/dev` at `c09c4972`, plus the
driver's own reads. Paths are repo-relative.

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| "Does profile P serve chain C" | `NetworkService.isChainLive(profileId, chainId)` (`apps/extension/src/wallet/services/network/service.ts`): false when no row exists or the row is mid-deletion, lock-free. `getNetworksRaw(profileId, chainId)` is the same read without the deletion reservation. | reuse-as-is (`isChainLive`) |
| A typed error for a chain with no network | None. The closest templates are `UnsupportedMethodError` (dApp-actionable, once a bare `Error` flattened to the constant) and the constant-message family (`SessionEndedError`, `TermsAcceptanceRequiredError`). Searched every `class … extends (WalletError\|Error)` in `apps/*/src` and `packages/*/src`, and grepped `No network\|unsupported chain\|ChainNotSupported\|not (served\|supported\|configured)`. | build new: `ChainNotSupportedError` |
| Registering a typed error | `packages/extension-messaging/src/errors.ts` (class, `KnownWalletErrorPayload`, `walletErrorFromPayload`), `errors.test.ts` (the `instances` sweep), `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts` (the `instanceof` ladder) and its test, and `isExpectedRefusal` in `background.ts` for the log level. | adapt |
| The dApp-facing throw site | `WalletSdkDispatcher.resolveNetwork` (`packages/wallet-bridge/src/dispatcher.ts`) is the one place a session's chain is resolved for every chain-bound method (getAccounts, requestCapabilities with accounts, the simulate, utility, send and authwit paths, registerContract and the other network-only kinds). Pinned today by `dispatcher.test.ts` (`/No network configured/`). The same text in `caip.ts`, `network/service.ts` (`getNode`) and the FPC service is internal and runs after this gate. | adapt (throw the typed error) |
| The discovery decision | `handleDiscovery` (`apps/extension/src/wallet/services/wallet-sdk/background.ts`), module-private, reached through `initWalletSdkHandler`'s `onPendingDiscovery` and the unlock drain. Existing-session auto-approve, the Terms gate, `(origin, chainId)` dedupe via `pendingDiscoveryPromises`, `checkDiscoveryPopupCaps`, then `runDiscoveryPopup`. No-yield invariant between the session lookup and the dedupe registration. | adapt |
| A wallet window that only informs | `DappInteractionService.interaction()` opens `#/windows/<type>?requestId=…` through `WindowManager.openAndAwait`; `rejectInteraction` settles it. Windows: `popup/windows/discover` (layout to reuse: `DappStatusStrip`, `DappIdentityBlock`, the shell CSS), `popup/windows/verify` (single-button footer). `useDappApprovalWindow`, `useDappInteractionPayload`, `useDappHostname`. | adapt: a new interaction type and window, no new components |
| Unit harness for discovery | `wallet-sdk/test-services.ts` `fakeSdkServices` (its `network` stub is hard-wired to one row) and the mocked-handler pattern in `background.admission.test.ts` (the Terms-gate tests are the template). `background.discovery-race.pins.test.ts` and `background.init-order.pins.test.ts` pass `network: {}`. | adapt |
| E2E pieces | `openPlayground`, `waitForPopup`, `approveConnect`, `approveVerify`, `grantCapBundle`, `callExpectingNoPopup`; `fixtures/dappSession.ts` reads session rows (`nulo:core:dappSessions@`). The playground takes `?chainId=&version=` (decimal), and a refused discovery is silent to it for its 60 s timeout. | reuse, plus a small row counter |

## Facts the plan rests on

- Wallet chain id = `(l1ChainId ^ rollupVersion) >>> 0` (`chainInfoToChainId`, `wallet-sdk/session-established.ts`). V5 testnet: `11155111 ^ 1821665230` = 1816023401. V6 testnet: 2904119610. Local Network: 0.
- `DappSessionService.addDappSession` never checks the chain; `persistAndApprove` writes the row after the user's Allow.
- `tryGetDappSessionByOriginAndChain` keys on `(profile, origin, chainId)`; the auto-approve trusts any row it finds.
- Network deletion does not purge dApp sessions: no chain-purge subscriber covers them.
- `rejectDiscovery` (the SDK's background handler) only drops the pending entry: the dApp hears nothing until its own timeout.
- Prior art: `archive/connect-chain-mismatch` kept "No network configured" as the unknown-chain error and noted the chain-enumeration oracle it creates.
