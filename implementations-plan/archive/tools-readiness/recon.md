# Recon — tools-readiness (Phase 0.4)

One reuse-sweep agent (read-only, `Read` only — the worktree guard refused its shell, so every
absence below is "not found among the files read", with the trail stated), plus the main agent's
addendum for the spots it flagged unswept. Base: `origin/dev` at `94e412a6`; the swept tree was
byte-identical for every path under `apps/` and `packages/`.

## Reuse map

| Capability | Existing code (or absence + trail) | Verdict | Why |
|---|---|---|---|
| Accounts-widening detection (dispatcher) | `packages/wallet-bridge/src/dispatcher.ts:264-266` `accountsCapsEqual`, `:443-448` `isCapabilityCovered` | **build new** | Coverage compares only the `canGet`/`canCreateAuthWit` flags; no membership check anywhere in `computeCapabilityDelta`'s call graph. |
| Capability decision merge (accounts union; a declined widening keeps the older grant) | `apps/extension/src/wallet/services/dapp-session/service.ts:282-334` `applyCapabilityDecision`; `CapabilityDecision` in `packages/wallet-bridge/src/services-contract.ts:96-117` | **reuse-as-is** | Already generic across types; its comment names the "denied widening preserves the narrower grant" invariant. |
| Capability popup shell | `apps/extension/src/popup/windows/capabilities/index.vue` (`init`, lines 136-179), `AccountSelectRow.vue` (`cap-account-item`, `data-account-id`, `data-selected`, `cap-account-alias-input`), `build-items.ts` | **adapt** | Rows need no change; `init()` pre-selects only when exactly one account is available — no "already granted" pre-check exists. |
| Popup wire shape | `packages/wallet-bridge/src/dapp-interaction-protocol.ts:143-156` `CapabilityParams` (`availableAccounts?: {address,name,chainId}[]`), `CapabilityResult` (`selectedAccounts?`) | **adapt** | Add `grantedAccounts?: string[]` so the popup can pre-check and lock them. |
| Extension e2e: capability-popup driving | `apps/extension/tests/e2e/fixtures/popups.ts` (`waitForPopup`, `approveCapabilities` — clicks a row only if not already selected —, `rejectCapabilities`, `getCapItems`, `waitCapabilitiesReady`) | **reuse-as-is** | Drives the exact surface the widening popup keeps. |
| Extension e2e: a second account | `apps/extension/tests/e2e/fixtures/extension.ts` `createAccount(setupPage, name)` (programmatic; `firstTwoAccountsFixture`, `dappConnectedExtensionWithFirstTwoAccountsCap`), smoke `accounts.test.ts` (UI path) | **reuse-as-is** | Both paths exist and are exercised. |
| Extension e2e prior art | `network/cap-request-accounts.test.ts` (#06), `meta-getAccounts(-pregrant).test.ts`, `multi-account-from.test.ts` (#39; its docstring: `from` is always `granted[0]` because the playground has no hook to pick account 2), `session-profileSwitch.test.ts`, `in-flight-send-guard.test.ts`, `account-switch-isolation.test.ts` | **reuse-as-is (models)** | New files copy their shape (`test.skipIf(!hasConfig)`, `grantCapBundle`, `callExpectingNoPopup`). |
| Playground dApp harness | `apps/playground/src/lib/wallet.ts` (accounts sourced from `requestCapabilities().granted.accounts`), testids `pg-btn-requestCapabilities`, `pg-btn-getAccounts`, `pg-bundle-select`, `pg-account-item` | **adapt** | A `from` selector is needed for the second-account send cell (the #39 docstring's known gap). |
| Tools session: re-request on a live session | `apps/tools/src/composables/createAztecWalletSession.ts:734-751` `retryCapabilities` (quiet when connected; no-op while another flow owns the session), `:818-855` `chooseGrantedAccount` (replaces `s.accounts` wholesale from the latest grant), `:984-1004` `parseGrantedAccounts` | **reuse-as-is** | Once the wallet widens, the tools session already forwards the wider grant. |
| Tools "one more scope on a live session" pattern | `apps/tools/src/composables/useTokenGrant.ts` (`enqueuePrompt` single-flight queue, `MID_FLOW_STATUSES`, `session.retryCapabilities()`) | **reuse-as-is (as the model)** | The new "Add accounts…" composable mirrors it; `useTokenGrant` itself is token-scoped. |
| Tools UI: "Add accounts…" | `apps/tools/src/components/AccountSwitcher.vue` `.foot` (lines 192-201, only "Disconnect") | **build new** | Full read: no such action; the `.foot` slot is the patterned insertion point. Needs a new testid (`apps/tools/src/lib/testids.ts`). |
| Tools: account re-read on focus | `App.vue`, `AppShell.vue`, `useShell.ts` read fully — no `focus`/`visibilitychange` listener; the only external-change listener is `useBridgeJournal.ts:298-303` (`storage` event, cross-tab). No `wallet.getAccounts()` call site anywhere in `apps/tools/src` | **build new** | Precedent for "external state moved, re-read" exists in shape only. |
| Extension `getAccounts` semantics | `dispatcher.ts:736-793` `handleGetAccounts` → `projectSessionAccounts` intersects the profile's accounts with `session.accounts` | **reuse-as-is (bound)** | Session-scoped by design: a re-read can never reveal an ungranted account; it refreshes aliases and membership only. |
| Tools browser suite machinery | `apps/tools/tests/browser/fixtures/test.ts` (`family`/`cells`/`l1Index`, pool = cells + 2 spares, `MAX_POOL` 16, egress auto-fixture, heartbeat) | **reuse-as-is** | A new spec file plugs in. Used `l1Index` values: 1 spike, 2 deposit-token + tokens, 3 fee-states + exits, 4 deposit-token-gas + recovery, 5 deposit-gas-only + activity, 6 drip, 7 l1-wallet; `actorKeys` has 12 entries by default (`deploy.ts`), so 8 is free. |
| Tools suite: read/drive the switcher | `pages/connect.ts:168-175` `grantedAccounts`, `:178-182` `switchAccount`, `chooseAccount`, `driveToConnected`, `walletFrame`, `walletCalls` | **reuse-as-is** | Exactly the surface the account cells drive. |
| Test wallet: add an account after connect | `tests/browser/test-wallet/main.ts:124` `window.__nuloTestWallet.addAccount(secret, salt)` — imports a seed into the live PXE at any time | **reuse-as-is** | The lever the widening cell needs. |
| Test wallet: grant policy on re-request | `test-wallet/wallet.ts:72-82` `requestCapabilities` override calls `this.getAccounts()` fresh on every call | **reuse-as-is** | It widens naturally; nothing to change. It cannot stage "the wallet declines the new account" (no control) — that half lives in the extension e2e. |
| Test wallet faults | `main.ts` `holdNext`, `failNext`, `declineNextGrant`, `submitted`; `wallet.ts` `observeSubmissions` (the node hand-off proxy) | **adapt** | A `dropNext("sendTx")` fault that swallows the transaction at the hand-off and returns its hash is a few lines on the existing proxy. |
| L1 wallet fixture | `tests/browser/fixtures/l1-wallet.ts:96-130` serves `eth_sendTransaction`, `eth_signTypedData_v4`, `personal_sign` through a viem `WalletClient`; `signatures` counter, `rejectNext(kind)`, `setAccount`, `setChainId` | **adapt** | No typed-data payload is recorded and there is no hold; both are small additions in the same dispatch table. |
| Egress fence / token-list fixture | `tests/browser/fixtures/egress.ts` answers `tokens.uniswap.org` from `tests/e2e/fixtures/token-list.json` | **adapt** | A second fixture list with malformed entries, selectable per test. |
| Token-list validation | `packages/bridge-core/src/token-list.ts` (`tokenListEntrySchema`, `decimals: int 0..255`, `tokenListCacheKey`) | **reuse-as-is** | The cells assert its behaviour; no change implied. |
| Dropped claim (product) | `apps/tools/src/composables/useBridgeJournal.ts:1238-1275` `advanceReceiptStreaks`: three straight `dropped` receipt polls clear `claimTxHash` and set `attention: "error"`, note "The claim was dropped - claim again from this card. Nothing was lost." | **reuse-as-is** | The dropped cell asserts exactly this and re-claims from the card. |
| Consumed message (product) | `useBridgeJournal.ts:55-64` `isMsgNotReady` / `isMsgConsumed`; `:1296-1330` `recordMessageConsumed` (re-simulates the record's own claim; a nullified message → `completeDeposit`) | **reuse-as-is** | The consumed cell asserts the record ends `done` without a claim of its own. |
| Consumed-branch staging (harness) | `packages/bridge-core/src/hub-l2.ts:325` `claimViaHub(hub, params, send)`; `scripts/sandbox/context.ts:273` `claimInputs` (`submitter: "relayer"` → `s.relayerOpts`), `claimOnce`; `flows.ts:132-145` the relayer path | **adapt** | A helper builds `HubClaimParams` from the page's journal record and claims through the relayer before the page resumes. |
| Permit2 typed data | `packages/bridge-core/src/send-flow.ts:249-256` `bridgeWitnessPermitTypedData({permitted:{token,amount}, spender: router, nonce, deadline}, …)` | **reuse-as-is** | The assertion target for the Permit2 cells. |
| ActivityDock breakpoint | `apps/tools/src/components/ActivityDock.vue:41` `useMediaQuery("(max-width: 1100px)")` | **reuse-as-is** | The viewport cells cross it. |

## Conventions to match

- **Selectors**: `data-testid` only (root `CLAUDE.md`, the suite README); narrowing by `data-*` attributes. Every new control gets a testid before a test names it.
- **Complexity**: cognitive ≤ 15 everywhere, ≤ 80 non-blank lines per production function; never a new suppression. `dispatcher.ts` `isCapabilityCovered` and the popup's `init()` are already dense — new logic goes into small named helpers.
- **Wallet-bridge tests**: colocated `dispatcher.test.ts`; `:543` pins "granted accounts + re-requested SAME shape → no popup (same-shape no-op)" — the widening change refines that pin (same shape AND no ungranted account → no popup; an ungranted account → popup) rather than deleting it.
- **Extension e2e**: `test.skipIf(!hasConfig)`, fixtures from `fixtures/extension.ts`, one file per scenario, `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/<file>` to run one file alone.
- **Tools browser suite**: `test.use({ family, cells, l1Index })`, one actor per cell from the pool, postconditions read from the chain and the journal, `keptFor` for FPC accounting.
- **Two products, one repo**: the extension-side change (wallet-bridge, extension e2e, playground) and the tools-side change never share a PR.

## Collision / dedup risks

- `dispatcher.test.ts:543` (same-shape no-op) and the neighbouring coverage pins (`:647-666`, `:1643-1735`) — update, don't duplicate.
- `useTokenGrant.ts` — the new accounts composable must not fork its queue; extract the queue if both need it, or keep the accounts composable minimal enough not to.
- The tools spike cell already asserts "a whole-pool grant"; the new accounts family must not re-assert it.

## Addendum (main agent) — the unswept spots

- `session-profileSwitch.test.ts`: "switching profiles disconnects the dApp; reconnect under B works". `in-flight-send-guard.test.ts`: "an account switch is refused while a send is in flight, and allowed once it settles". Neither switches the ACTIVE account under a live session while asserting what the dApp sees — that hole stands.
- `flows-matrix.ts` (bridge-core sandbox): `fundPublicFeeJuice`, `mintPrivateGasNote`, `flowFirstTimeFromCredit`, the fee-state flows; the relayer claim path is `flows.ts:132-145` via `claimOnce(…, { submitter: "relayer" })`.
- `useBridgeJournal.ts` beyond line 350: the dropped and consumed handling quoted in the table above; `claimReceiptStatus` is a `JournalEngineDeps` member (`:158`), wired by the app to the node's receipt read.
- Playground: `apps/playground/src/lib/wallet.ts` sources accounts from the grant; a second-account `from` needs a selector the playground does not have (the #39 docstring says so).
