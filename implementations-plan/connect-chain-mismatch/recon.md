# connect-chain-mismatch — recon (Phase 0.4)

Base: `origin/dev` @ `91074a74`. One batched Explore sweep (sonnet) + parent verification of every
claim the plan leans on. Read-only.

## Reuse map

| Capability | Existing code | Verdict | Note |
|---|---|---|---|
| Derive a chain's default account | `apps/extension/src/wallet/services/account/service.ts:196` `ensureDefaultAccount(profileId, chainId, type, name)` | **reuse-as-is** | Idempotent, per-tuple serialized, needs the unlocked profile secret; seeded chains derive with no I/O, custom chains probe the user's endpoint (`network/service.ts:366` `resolveVerifiedL1ChainId`). Called today only from the popup (`popup/network-switch.ts:71`, `composables/useProfileBootstrap.ts:105`) but it is a plain method on the background-resident service. |
| Dispatcher ↔ account contract | `packages/wallet-bridge/src/services-contract.ts:40` `IAccountReader { getAccounts }` | **adapt** | No create path. The extension wires the CONCRETE `AccountService` structurally (`wallet-sdk/background.ts:164-189`); a 2-arg `ensureDefaultAccount(profileId, chainId)` on the contract needs a wiring-site adapter (the enum `AccountType` and the default name are extension-local). 21 typed fakes in `dispatcher.test.ts` + 2 in `account-order.characterization.test.ts`. |
| The popup knows the dApp's chain | `payload.session.chainId` (DappSession row, `dapp-session/spec.ts:45-49`, string composite) | **reuse-as-is** | Already in `CapabilityPayload` (`dapp-interaction/spec.ts:88`). No wire change needed. |
| The popup knows the dApp chain's NAME + row | `appStore.networks` (`stores/app.store.ts:52`, filled by `useProfileBootstrap.ts:63` in every popup realm incl. `windows-*` routes) | **reuse-as-is** | Find the row by `chainId`; `Network.name` honours user renames. `getChainName` (`components/ui/utils.ts:33`) is the fallback for an unknown id. |
| Switch the active network from a popup view | `apps/extension/src/utils/guarded-network-activation.ts` `activateNetworkGuarded` + `managers.network.setActiveNetwork/getActiveNetwork` | **reuse-as-is** | Sole caller today: `pages/settings/networks/[id].vue:48-89` (`handleSetActive`) — inline in-flight guard + result ladder with 3 toasts. dApp windows are `windows-*` routes under `popup/app.vue`, so its network watcher (`app.vue:107` → `createNetworkSwitchHandler`) reloads accounts in the window realm after the switch. |
| Shared "switch network with feedback" | — | **build new** (thin) | No composable packages the `[id].vue` ladder. Searched `src/composables/*` for `network|activat`, `activateNetworkGuarded` callers (1). Extracting `useNetworkActivation` keeps the in-flight guard + toast copy in ONE place for both callers. |
| Neutral banner with an action | `packages/design/src/ui/Banner.vue` (`variant` default `info`, `direction="vertical"`, `action: { name, callback }`, `#title`/`#description` slots) | **adapt** | Idiom exists (`pages/tx/[id].vue:219-228` is the vertical + slots shape). The action `<button>` carries NO `data-testid` → add an optional `testId` to the `action` object (e2e selects by testid only). 7 tests in `Banner.test.ts`. |
| dApp identity line | `components/composite/DappIdentityBlock.vue` `actionLabel` (plain string) | **reuse-as-is** | `"is requesting permissions on <name>"`. No test/e2e pins the current string (grep `is requesting permissions` outside index.vue: 0). |
| Complexity headroom | `dispatcher.ts` `handleRequestCapabilities` 78 raw lines; `capabilities/index.vue` `init()` 50 lines with nested ifs | n/a | New logic goes in helpers: dispatcher `loadAvailableAccountsForPopup` (already separate), popup pure helper `chain-mismatch.ts`. |
| Unit tests | `windows/capabilities/index.test.ts` = shell-lifecycle pins ONLY (header lines 16-18 defer the business pins); `dispatcher.test.ts` builds fakes inline; no test anywhere asserts the empty-`availableAccounts` branch or "No accounts on this chain" | **build new** | Grep `No accounts on this chain` → only `index.vue:148`; `noAccountsAvailable` → index.vue + one header comment. |
| E2E | `tests/e2e/network/cap-request-accounts.test.ts` (happy path); fixtures `dappConnectedExtension*` call `switchToLocalNetwork` FIRST precisely because of this bug (`fixtures/extension.ts:514-518` comment). The playground accepts `?chainId=N&version=M` (`apps/playground/src/lib/wallet.ts:33-42`); default `Fr.ZERO/Fr.ZERO` = chain 0 = Local Network. E2E builds seed Testnet as the active network (`network/service.ts:96-98`). | **build new** | A network-suite test that does NOT switch first reproduces the bug 1:1: wallet on Testnet, dApp on Local Network. Both chains are seeded rows; deriving the Local Network default account needs no I/O; switching to Local Network stays inside the e2e sandbox. |

## Facts the plan leans on (parent-verified)

- Dispatch of any dApp message requires an ACTIVE (unlocked) profile — `background.ts:880` `requireActiveProfile(..., "Wallet is locked")` — so `ensureDefaultAccount`'s `getProfileSecret` precondition holds at `requestCapabilities` time.
- `resolveNetwork` (`dispatcher.ts:1416`) throws `No network configured for chainId N` BEFORE any popup when the dApp's chain has no row; this stays the unknown-chain error.
- `AccountService.getAccounts(profileId, chainId)` returns VISIBLE rows only (`service.ts:168`); `ensureDefaultAccount` returns the lowest-index non-imported row even if hidden — so "all accounts hidden" still yields an empty list after derivation (the hard error remains for it).
- `activateNetworkGuarded` admits the in-memory scope change through `commitScopeChange` BEFORE persisting; results `activated | blocked | unconfirmed | stale`.
- `CapabilityParams` is a plain TS type re-exported by `dapp-interaction/spec.ts:26`; no zod gate on the popup payload path.
- `Banner` is auto-imported in the extension (`src/types/components.d.ts`).

## Collision / dedup risks

- A THIRD `ensureDefaultAccount(…, AccountType.Nulo_v1, "Account")` call site (the wiring adapter) — introduce `DEFAULT_ACCOUNT_NAME` in `account/spec.ts` and use it at all three.
- A second copy of `[id].vue`'s activation ladder in the capabilities window — the composable above.
- The e2e fixture comment at `fixtures/extension.ts:514-518` describes the bug this plan removes; refresh it (the switch stays — the tests need Local Network accounts, not the derived default).
