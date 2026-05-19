# Plan v3 — Network E2E via local playground

> **Status**: post-audit-2 revision. Audited 4× total (Claude + Codex `xhigh` × 2 rounds). Both round-2 audits returned **MINOR-REVISE**; their issues are addressed in the v3 patches below. Awaiting user approval before any implementation.

> **🚧 SUPERSEDED IN PARTS — see `canonical-refactor-plan.md`** for the active follow-up plan. After implementing 31/65 reliable tests on this v3 plan, an audit identified that the playground was using Nulo-custom RPCs inherited from the upstream fork (`registerToken`, `getCompleteAddress`, `simulateViews`) that aren't part of the canonical wallet-sdk surface. Tests #17, #22, #26 in §3 are **DROPPED** in the canonical refactor; sections 4 (file annotations) and 6 (PR breakdown) reflect pre-refactor state. The refactor also switches the playground to `requestCapabilities().granted.accounts` as account source-of-truth.

---

## Changelog vs v2 (audit round 2)

- ✓ **Dropped raw-`Fr` authwit variant from test #27** — Audit A found that `createAuthWit(from, IntentInnerHash | CallIntent)` per the wallet-sdk public type signature does NOT accept a raw `Fr`. The dispatcher's `scope-enforcement.ts:285–287` has a fall-through that *would* handle it if reached, but reaching it requires bypassing the SDK type contract — that's a unit-test concern, not an e2e concern. Test #27 is now 2-variant (callIntent + innerHash). Raw-Fr coverage stays in `scope-enforcement.test.ts` (unit).
- ✓ **`setConfirmationLevel` storage path specified** — §5.5 now spells out the EntityStorage key scheme: `nulo:core:dappSessions@<sessionId>` with JSON-stringified `DappSession` value. The fixture mutates via `chrome.storage.local.get(key) → JSON.parse → spread → JSON.stringify → chrome.storage.local.set(key, value)`, then triggers a session reload. This is a re-implementation of EntityStorage's transport contract from outside the SW; documented as such.
- ✓ **`getSessionIdForOrigin` query mechanism specified** — §5.5: scan all `nulo:core:dappSessions@*` keys via `chrome.storage.local.get(null)`, filter values where `dappMetadata.url` startsWith origin.
- ✓ **`execute-op-fee-set-badge` clarified** — §5.6 now explicit that this testid is being **added** to the existing "Fee payment method set by app" banner at `execute/index.vue:510-520` and `:571-581` (it doesn't exist today).
- ✓ **Two-step `feeMethod` override flow documented in `approveExecute`** — §5.4: when `feeMethod` opt is provided, helper first clicks `send-fee-override` (FeeSettingsCard's "Override" button) before clicking the chosen method. This mirrors the actual UX two-step.
- ✓ **Selector convention tightened** — Codex caught that v2 used `data-cap-type` / `data-account-address` instead of the helpers.ts `data-<entity>-id` / `data-<entity>-name` contract. v3 standardizes:
  - `cap-item` with `data-cap-id="<type>"` (the type doubles as id since rows are unique per type) + `data-cap-name="<label>"`.
  - `cap-account-item` with `data-account-id="0x..."` + `data-account-name="..."`.
  - `execute-op-item` with `data-op-id="<index>"` + `data-op-kind="<kind>"` (kind kept as supplementary metadata since multiple ops can have the same kind).
- ✓ **Wall-clock budget: `<15 min` → `<45 min` with per-PR breakdown** — Audit A flagged my budget as unjustified given `tokenReadyExtension` polling. v3 §10 and a new §11 (test runtime budget) provide a per-PR estimate.
- ◐ **`expectNoPopup` via `browser.targets()` snapshot** — Codex flagged still-brittle. Mitigation in v3: combine the targets-count check with a **sentinel beacon** — the playground emits a `data-testid="pg-result"` row immediately on call invocation (status="pending"), then updates to "ok"/"error" on settlement. Tests assert "result reaches terminal state within timeout AND `browser.targets()` count is unchanged from the pre-call snapshot." If a popup DID open, `chrome.windows.create` would create a target observable in `browser.targets()` regardless of whether it's a popup or content script. Documented as still-not-perfect but not just timing-based.

## Changelog vs v1 (audit round 1) — preserved for context

- ✗ **Silent vs popup matrix** — v1 marked ~14 non-`sendTx` rows as "popup path" because I read `isConfirmationNeeded` wrong. Default `confirmationLevel = AccessLevel.Transactions (=5)` and the comparison is strict `>=`, so on a default session **only `sendTx` opens the execute popup**. v2 reclassifies these rows as silent-path and adds an explicit "elevated confirmationLevel" fixture to test the popup path on a small, representative subset.
- ✗ **Popup window inventory** — v1 listed 4 windows. Real inventory is `capabilities, discover, execute, json, logger, passkey, verify` (7 dirs). `json` is a dApp-relevant deep-dive view (reachable via `execute`'s expand icon); `passkey` is for passkey-typed profile unlock and is **outside** the dApp protocol surface; `logger` is a developer overlay. v2 adds `json` to the testid set and explicitly excludes `passkey` and `logger`.
- ✗ **Selector naming** — v1 deviated from the helpers.ts contract (`<area>-<entity>-<verb>`, `data-<entity>-id/name`, `error-text`+`role="alert"`). v2 aligns: `cap-row` → `cap-item` with `data-cap-type`/`data-cap-id`; `execute-op-card` → `execute-op-item`. Reuse existing `send-fee-method-trigger` / `send-fee-method-{kind}` (FeeSettingsCard is shared), don't re-prefix.
- ✗ **`connectDapp` helper is staler than v1 admitted** — points at `#/windows/connect` (which doesn't exist; the route is `#/windows/discover`) and looks for "Connection request" / "Approve" copy that the discover UI doesn't render today. v2's PR 1b deletes and replaces it.
- ✗ **Test-count baseline** — v1 said "11 existing network tests". Codex caught: the network suite has 18 declared, 16 active (2 `test.skip` in fee-methods). v2 corrects.
- ✗ **`sw-resilience.test.ts` does NOT cover discovery-queue persistence across SW restart** — v1 mis-cited it. v2 leaves discovery-queue persistence as a documented out-of-scope gap.
- ✗ **PR 1 was top-heavy** — split into 1a (scaffold + global-setup) + 1b (testids + handshake smoke + helper rewrite).
- ✓ **Added ~12 missing tests**: `cap-request-repeat-no-popup`, `cap-request-partial`, `meta-getAccounts-pregrant`, `batch-partial-failure`, `authwit-rawHash`, `err-scope-data-privateEvents`, `err-scope-simulation-transactions`, `session-explicitDisconnect`, `concurrency-rapid-fire`, `tx-sendTx-multicall-chunked` (>5 calls), `err-authwit-not-permitted`, `multi-account-from-routing`, `wallet-locked-mid-session`.
- ✓ **Merged**: #29+#30 (authwit variants) → one parameterized test; #33–#36 (scope/cap errors) → one parameterized test; #39+#40 (alwaysTrust + reconnect) → one parameterized test.
- ✗ **`localStorage` persistence in playground** — Codex flagged as CI-flake source. Removed.
- ✓ **Result feed monotonic ids** — each row gets `data-result-seq` (counter), tests snapshot `seq` before invocation and wait for `seq+1`.
- ✗ **`expectNoPopup` brittleness** — replaced with deterministic check via `browser.targets()` count snapshot + assertion that no new popup target appears within a polling window AND playground gets the expected result.
- ✓ **Vite HMR mitigation** — playground dev server runs with `--clearScreen=false` and HMR disabled (`server.hmr: false` in `vite.config.ts` when `NODE_ENV=test`) to avoid `chrome.tabs.onUpdated` killing sessions.
- ✓ **Wall-clock budget**: revised `<10 min` → `<15 min` for the full network suite, given `tokenReadyExtension` polling cost.
- ✓ **R18–R26** added to risk register.

---

## 1. Background snapshot (verified facts)

| Fact | File:line |
|---|---|
| Default dApp `confirmationLevel = AccessLevel.Transactions` | `packages/extension/src/wallet/services/wallet-sdk/background.ts:332` |
| `AccessLevel` enum: None=0, AppState=1, PublicData=2, PxeState=3, PrivateData=4, Transactions=5 | `packages/wallet-bridge/src/session-types.ts:17` |
| `isConfirmationNeeded` opens popup iff `accessLevel >= confirmationLevel` OR `sendTx without preset fee` OR profile mismatch | `packages/extension/src/wallet/services/dapp-interaction/service.ts:355–374` |
| `getOperationAccessLevel` mapping | `packages/extension/src/wallet/services/dapp-interaction/service.ts:384–429` |
| `handleSendTx` always picks first session account, overwrites `opts.from` | `packages/wallet-bridge/src/dispatcher.ts:769` |
| `handleBatch` continues on per-leg failure, returns shaped empty result | `packages/wallet-bridge/src/dispatcher.ts:268–303` |
| `handleRequestCapabilities` returns early w/ no popup if delta is empty | `packages/wallet-bridge/src/dispatcher.ts:395–408` |
| `connect-dapp.test.ts` is `test.skip`, fixture goes to `https://adhoc-aztec-wallet-test.pages.dev/`, watches obsolete `#/windows/connect` URL | `tests/e2e/connect-dapp.test.ts:5`, `tests/e2e/fixtures/extension.ts:105–116` |
| Existing network suite: 18 declared / 16 active / 2 skipped | `tests/e2e/network/{transfers,fee-methods,networks,tokens,token-management}.test.ts` |
| Popup windows: capabilities, discover, execute, json, logger, passkey, verify | `packages/extension/src/popup/windows/` |
| Verify popup confirm button reads "OK" (not "Confirm") | `packages/extension/src/popup/windows/verify/index.vue:248` |
| FeeSettingsCard already exposes `send-fee-method-trigger`/`send-fee-method-{kind}` testids — shared with `/windows/execute` | `packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:437` |
| Playground has `@aztec/wallet-sdk@4.2.0-nightly.20260413` only; needs `@aztec/aztec.js` + token contract artifacts added | `packages/playground/package.json:12` |
| Global-setup already auto-spawns Aztec sandbox + manages process lifecycle | `tests/e2e/global-setup.ts:21–104` |
| `accounts.canGet` and `data.addressBook` flags are NOT enforced anywhere — purely UI hints | `packages/wallet-bridge/src/scope-enforcement.ts` (no checker for either) |

**Operation → AccessLevel matrix** (from `getOperationAccessLevel`):

```
| Method                            | AccessLevel    | Default confirmationLevel | Popup on default? |
|-----------------------------------|----------------|---------------------------|-------------------|
| aztec_getChainInfo                | PublicData (2) | Transactions (5)          | NO (silent)       |
| aztec_getContractClassMetadata    | PxeState (3)   | Transactions (5)          | NO                |
| aztec_getContractMetadata         | PxeState (3)   | Transactions (5)          | NO                |
| aztec_registerSender              | PxeState (3)   | Transactions (5)          | NO                |
| aztec_getAddressBook              | AppState (1)   | Transactions (5)          | NO                |
| aztec_registerContract            | PxeState (3)   | Transactions (5)          | NO                |
| aztec_getPrivateEvents            | PrivateData (4)| Transactions (5)          | NO                |
| aztec_simulateTx                  | PrivateData (4)| Transactions (5)          | NO                |
| aztec_executeUtility              | PrivateData (4)| Transactions (5)          | NO                |
| aztec_profileTx                   | PrivateData (4)| Transactions (5)          | NO                |
| aztec_createAuthWit               | PrivateData (4)| Transactions (5)          | NO                |
| aztec_sendTx                      | Transactions(5)| Transactions (5)          | YES (always)      |
| get_complete_address              | PublicData (2) | Transactions (5)          | NO                |
| register_token                    | AppState (1)   | Transactions (5)          | NO                |
| simulate_transaction              | PrivateData (4)| Transactions (5)          | NO                |
| simulate_views                    | PrivateData (4)| Transactions (5)          | NO                |
| send_transaction                  | Transactions(5)| Transactions (5)          | YES (always)      |
```

**Implication**: on a default dApp session, only `sendTx`/`send_transaction` open the execute popup. Every other method goes silent. v2's matrix is built around this reality.

---

## 2. Objective + success criteria

Build a **local-only test playground** (under `packages/playground`) that exposes every wallet-sdk RPC the extension supports, with stable testids + DOM-readable result feed. Wire it into the existing `vitest.e2e.network` suite via `global-setup.ts`. Add the missing data-testids on `/windows/{discover,verify,capabilities,execute,json}`. Replace the `dappConnectedExtension` external-page dependency with the local playground. Add ~36 new network e2e tests.

**Success metric**: an LLM (or human) running `bun run test:e2e:network` gets a green/red signal on whether *any* wallet-sdk surface or approval-popup behavior has regressed, in **<15 minutes** (revised from <10 in v1 — Codex flagged the budget as optimistic given `tokenReadyExtension` polling cost).

**Non-goals (this iteration)**: iframe-provider transport, WalletConnect, real-prover paths, fee-amount accuracy, multi-tab discovery races, anti-phishing UI assertions (kept as unit tests), `accounts.canGet` enforcement (unimplemented in code; tracking-only), `data.addressBook` enforcement (same).

---

## 3. ASCII paths table (v2)

Legend: **PATH = silent** means the playground gets a result without the extension opening any approval popup. **PATH = popup-execute** means an approval window opens at `/windows/execute`. **PATH = popup-cap** means `/windows/capabilities`. **PATH = handshake** means `/windows/discover` → `/windows/verify`.

```
| #  | Path                                                | Method(s)            | Capability      | Default-session path | Test name                              | Status |
|----|-----------------------------------------------------|----------------------|-----------------|----------------------|----------------------------------------|--------|
| 01 | dApp connect — full handshake                       | (discovery+keyEx)    | n/a             | handshake            | connect-handshake.test                 | ADD    |
| 02 | dApp connect — user denies at discover              | (discovery)          | n/a             | discover-deny        | connect-deny.test                      | ADD    |
| 03 | dApp connect — wallet locked → queued → drained     | (discovery)          | n/a             | handshake (delayed)  | connect-locked-queue.test              | ADD    |
| 04 | reconnect — verify popup unless alwaysTrust         | (handshake)          | -               | handshake or silent  | session-reconnect.test (parameterized) | ADD    |
| 05 | requestCapabilities — basic bundle                  | requestCapabilities  | (requested)     | popup-cap            | cap-request-basic.test                 | ADD    |
| 06 | requestCapabilities — accounts selection w/alias    | requestCapabilities  | accounts        | popup-cap            | cap-request-accounts.test              | ADD    |
| 07 | requestCapabilities — re-request after rejection    | requestCapabilities  | data            | popup-cap (×2)       | cap-request-rerequest.test             | ADD    |
| 08 | requestCapabilities — partial grant                 | requestCapabilities  | (mixed)         | popup-cap            | cap-request-partial.test               | ADD    |
| 09 | requestCapabilities — repeat (already granted)      | requestCapabilities  | (any)           | silent (no popup)    | cap-request-repeat-noPopup.test        | ADD    |
| 10 | requestCapabilities — user rejects all              | requestCapabilities  | -               | popup-cap (reject)   | cap-request-reject.test                | ADD    |
| 11 | getAccounts — pre-grant returns []                  | getAccounts          | (exempt)        | silent               | meta-getAccounts-pregrant.test         | ADD    |
| 12 | getAccounts — post-grant                            | getAccounts          | (exempt)        | silent               | meta-getAccounts.test                  | ADD    |
| 13 | getChainInfo                                        | getChainInfo         | (exempt)        | silent               | meta-getChainInfo.test                 | ADD    |
| 14 | batch — meta calls only                             | batch                | (exempt)        | silent               | meta-batch.test                        | ADD    |
| 15 | batch — partial failure preserves shape             | batch                | mixed           | silent               | batch-partial-failure.test             | ADD    |
| 16 | getAddressBook                                      | getAddressBook       | data            | silent               | data-addressBook.test                  | ADD    |
| 17 | ~~getCompleteAddress~~ — DROPPED (Nulo-custom)       | ~~getCompleteAddress~~ | -             | silent               | ~~accounts-getCompleteAddress.test~~   | DROPPED |
| 18 | getContractMetadata                                 | getContractMetadata  | contracts       | silent               | contracts-getMetadata.test             | ADD    |
| 19 | getContractClassMetadata                            | getContractClassMeta | contractClasses | silent               | contracts-getClassMetadata.test        | ADD    |
| 20 | registerSender                                      | registerSender       | data            | silent               | data-registerSender.test               | ADD    |
| 21 | registerContract                                    | registerContract     | contracts       | silent               | contracts-register.test                | ADD    |
| 22 | ~~registerToken~~ — DROPPED (Nulo-custom)            | ~~registerToken~~    | -               | silent               | ~~tokens-registerToken.test~~          | DROPPED |
| 23 | simulateTx                                          | simulateTx           | simulation      | silent               | sim-simulateTx.test                    | ADD    |
| 24 | profileTx                                           | profileTx            | simulation      | silent               | sim-profileTx.test                     | ADD    |
| 25 | executeUtility                                      | executeUtility       | simulation      | silent               | sim-executeUtility.test                | ADD    |
| 26 | ~~simulateViews~~ — DROPPED (Nulo-custom; use simulateUtility / BatchCall.simulate) | ~~simulateViews~~ | - | silent | ~~sim-simulateViews.test~~ | DROPPED |
| 27 | createAuthWit — variants (call-intent + innerHash)  | createAuthWit        | accounts+tx     | silent               | authwit-variants.test (parameterized)  | ADD    |
| 28 | getPrivateEvents                                    | getPrivateEvents     | data            | silent               | data-privateEvents.test                | ADD    |
| 29 | sendTx — default from                               | sendTx               | transaction     | popup-execute        | tx-sendTx-default.test                 | ADD    |
| 30 | sendTx — NoFrom (DefaultEntrypoint)                 | sendTx               | transaction     | popup-execute        | tx-sendTx-noFrom.test                  | ADD    |
| 31 | sendTx — feePayer set                               | sendTx               | transaction     | popup-execute        | tx-sendTx-feePayer.test                | ADD    |
| 32 | sendTx — multi-call ≤5 (BatchCall)                  | sendTx               | transaction     | popup-execute        | tx-sendTx-multicall.test               | ADD    |
| 33 | sendTx — multi-call >5 (chunked authwit path)       | sendTx               | transaction     | popup-execute        | tx-sendTx-multicall-chunked.test       | ADD    |
| 34 | sendTx — user rejects                               | sendTx               | transaction     | popup-execute        | tx-sendTx-reject.test                  | ADD    |
| 35 | sendTx — user picks Sponsored FPC fee               | sendTx               | transaction     | popup-execute        | tx-sendTx-sponsoredFpc.test            | ADD    |
| 36 | batch — mixed (silent reads + sendTx leg)           | batch                | (each)          | popup-execute (sendTx)| batch-mixed.test                       | ADD    |
| 37 | popup-path spot-check (elevated confirmationLevel)  | simulateTx           | simulation      | popup-execute        | elevated-confirmation.test             | ADD    |
| 38 | scope/cap rejection — parameterized                 | (various)            | (various)       | error                | err-scope-and-cap.test (parameterized) | ADD    |
| 39 | multi-account from routing — known-limitation pin   | sendTx               | transaction     | popup-execute        | multi-account-from.test                | ADD    |
| 40 | concurrent rapid-fire — sessionQueue ordering       | (various)            | (various)       | mixed                | concurrency-rapid-fire.test            | ADD    |
| 41 | session — tab close terminates                      | (any after)          | -               | -                    | session-tabClose.test                  | ADD    |
| 42 | session — cross-origin nav terminates               | (any after)          | -               | -                    | session-tabNavigate.test               | ADD    |
| 43 | session — explicit disconnect                       | -                    | -               | -                    | session-explicitDisconnect.test        | ADD    |
| 44 | wallet locked mid-session — method rejects          | sendTx               | transaction     | error                | wallet-locked-mid-session.test         | ADD    |

OUT OF SCOPE (this iteration; tracked as followups F1–F8):
| —  | F1: Iframe wallet provider transport                | (any)                | (any)           | -                    | -                                      | OUT    |
| —  | F2: WalletConnect transport                         | (any)                | (any)           | -                    | -                                      | OUT    |
| —  | F3: Discovery queue persistence across SW restart   | (handshake)          | -               | -                    | -                                      | OUT    |
| —  | F4: Stale discovery rejection (5min wait)           | (handshake)          | -               | -                    | -                                      | OUT    |
| —  | F5: Concurrent discoveries from multiple tabs       | (handshake)          | -               | -                    | -                                      | OUT    |
| —  | F6: Real-prover paths                               | (sendTx, simulateTx) | -               | -                    | -                                      | OUT    |
| —  | F7: L1↔L2 Fee Juice claim (already partial-skip)    | (sendTx)             | transaction     | popup-execute        | -                                      | OUT    |
| —  | F8: accounts.canGet / data.addressBook enforcement  | (multiple)           | (mixed)         | -                    | -                                      | OUT    |
```

**Total**: 44 in-scope, 8 out-of-scope (followup tickets). Of the 44, 9 are popup-path (sendTx variants + 1 elevated-confirmation spot-check + multi-account + locked-mid-session error path), 4 are capability popups, 1 handshake, the rest are silent-path validations + lifecycle.

---

## 4. Playground design (v2)

### 4.1 Form factor

Vanilla TS + Vite. Same rationale as v1: the playground is a test fixture, not a product. Reactivity bugs are not worth the framework cost.

```
packages/playground/
├── index.html
├── package.json          # add @aztec/aztec.js + @defi-wonderland/aztec-standards
├── vite.config.ts        # disable HMR when NODE_ENV=test (R19)
├── src/
│   ├── main.ts           # entry
│   ├── state.ts          # central state + render() (no localStorage in test mode)
│   ├── sections/
│   │   ├── connect.ts        # connect/disconnect, capability bundle picker
│   │   ├── meta.ts           # getChainInfo, getAccounts, getAddressBook, getCompleteAddress
│   │   ├── contracts.ts      # registerContract, registerSender, registerToken, getContractMetadata, getContractClassMetadata
│   │   ├── simulation.ts     # simulateTx, profileTx, executeUtility, simulateViews
│   │   ├── transactions.ts   # sendTx variants (default, NoFrom, feePayer, multicall, multicall-chunked)
│   │   ├── authwit.ts        # createAuthWit (intent + innerHash + raw Fr)
│   │   ├── data.ts           # getPrivateEvents
│   │   ├── batch.ts          # batch combos (meta, mixed, partial-failure)
│   │   └── debug.ts          # protocol log toggle, "elevated confirmationLevel" override
│   ├── lib/
│   │   ├── wallet.ts         # WalletManager wiring
│   │   ├── token.ts          # Token contract ABI + payload builders
│   │   ├── formatters.ts     # JSON-stringify safe (Fr/AztecAddress/bigint → string)
│   │   ├── log.ts            # result feed append (monotonic seq)
│   │   └── env.ts            # NODE_ENV detection (test mode flags)
│   └── styles.css
```

### 4.2 Capability bundles (expanded vs v1)

| Bundle id | Composition |
|---|---|
| `basic` | `[contracts(canRegister, canGetMetadata, *), simulation(transactions:*, utilities:*)]` |
| `basic-noUtilities` | basic minus `simulation.utilities` (negative test for `executeUtility`) |
| `basic-readOnly` | `[contracts(canGetMetadata only, *)]` (negative test for `registerContract`) |
| `accounts` | basic + `accounts(canGet, canCreateAuthWit)` |
| `accounts-noAuthWit` | accounts but `canCreateAuthWit: false` (negative test) |
| `transaction` | accounts + `transaction(*)` |
| `transaction-scoped` | transaction restricted to `[{contract: <token>, function: "transfer_in_public"}]` (positive scope) |
| `data` | basic + `data(addressBook, privateEvents:*)` |
| `data-scopedEvents` | data with `privateEvents.contracts: [<token>]` (per-contract scope) |
| `contractClasses` | basic + `contractClasses(canGetMetadata, *)` |
| `full` | union of all above (no `*-no*` variants) |
| `custom` | textarea + parse-as-JSON button |

Picker rendered as `<select data-testid="pg-bundle-select">` with `<option data-bundle-id="X">` per bundle.

### 4.3 State + DOM contract

```ts
interface PgState {
  status: "idle" | "discovering" | "verifying" | "connected" | "error" | "disconnected"
  wallet: Wallet | null
  accounts: AztecAddress[]
  selectedAccount: AztecAddress | null
  chainId: number | null
  results: Array<{ seq: number; method: string; status: "ok" | "error"; resultJson?: string; errorJson?: string; ts: number }>
  inputs: Record<string, string>  // tokenAddress, recipient, amount, etc — initialized empty, not from localStorage
  protocolLog: Array<{ direction: "send" | "recv"; type: string; ts: number }>
}
```

DOM contract:
- `[data-testid="pg-status"]` with `data-status` attr
- `[data-testid="pg-account-list"]` with `[data-testid="pg-account-item"][data-account-address][data-account-name]`
- `[data-testid="pg-result"]` with `data-result-seq` (monotonic), `data-method`, `data-status`, `data-result-json` (escaped). Ordered chronologically.
- `[data-testid="pg-input-{name}"]` for each input
- `[data-testid="pg-btn-{action}"]` for buttons (e.g. `pg-btn-connect`, `pg-btn-sendTx-default`, `pg-btn-sendTx-noFrom`)
- `[data-testid="pg-protocol-log"]` (debug, no per-row testids)
- `[data-testid="pg-error-text"]` for inline errors (matches helpers.ts convention)

**No localStorage** in test mode. `state.inputs` is empty on every load. (Fix Codex's CI-flake concern; manual debugging users can opt in via a query param `?persist=1`.)

### 4.4 Test-mode hooks (new vs v1)

- `?confirmationLevel=N` query param: playground appends to URL. The dApp's `requestCapabilities` flow already creates the session at `Transactions`; we need a separate path. Test infra mutates the session record directly via `chrome.storage.local` from the test driver after handshake completes. This is an extension-side concern, not playground.
- `?eventMetadata=...` query param: lets `getPrivateEvents` use a real event metadata definition for the deployed Token contract.

---

## 5. Test infrastructure changes (v2)

### 5.1 `global-setup.ts` — spawn playground + manage lifecycle

Mirror the existing `weStartedNode` pattern. New flag `weStartedPlayground`. Auto-detect already-running on port 5174 (so `bun run dev:playground` open during dev iteration doesn't get double-spawned). Wait for HTTP 200 on `/`. Provide `playgroundUrl` via `project.provide()`.

Run playground with **HMR disabled** when invoked from global-setup:

```ts
const playgroundProc = spawn("bun", ["run", "--filter", "@nulo/playground", "dev"], {
  env: { ...process.env, NODE_ENV: "test", VITE_DISABLE_HMR: "1" },
  stdio: "pipe",
  detached: true,
})
```

(`vite.config.ts` reads `VITE_DISABLE_HMR` and sets `server.hmr: false` + `server.watch.ignored: "**"` to prevent file-change reloads.)

### 5.2 `fixtures/extension.ts` — replace `connectDapp`

Delete the old `connectDapp` (uses dead URL fragment, dead copy). New helper `connectPlayground(ctx)` drives `/windows/discover` → `/windows/verify` via testids. Old fixture `dappConnectedExtension` keeps the same name but uses the new helper internally. Add new fixture `playgroundConnectedExtension` (file-scoped, depends on `tokenReadyExtension` for funded account).

### 5.3 `fixtures/playground.ts` (new)

Pure helpers operating on the playground page:

```ts
// Snapshot result feed length, run action, wait for seq+1 to land
async function callAndAwaitResult<T>(page: Page, action: () => Promise<void>, method: string): Promise<{ status: "ok"|"error"; result?: T; error?: string }>

// Deterministic absence check: snapshot browser.targets() count, run action, assert count unchanged AND result lands
async function callExpectingNoPopup<T>(ctx: ExtensionContext, page: Page, action: () => Promise<void>, method: string, timeoutMs = 5_000): Promise<T>

// Standard helpers
clickPgButton(page, name)
setPgInput(page, name, value)
selectBundle(page, id)
getPgStatus(page) → status string
getPgAccounts(page) → { address, name }[]
```

### 5.4 `fixtures/popups.ts` (new)

```ts
waitForPopup(ctx, kind, opts?: { matchQuery?: { requestId?: string } })  // R26: match by requestId
approveDiscover(page) / denyDiscover(page)
approveVerify(page, opts?: { alwaysTrust: boolean })
approveCapabilities(page, opts: { accounts?: string[]; aliases?: Record<string,string>; toggleOff?: string[] })
rejectCapabilities(page)
approveExecute(page, opts?: { feeMethod?: "sponsored" | "fj" | "fpc" })
rejectExecute(page)
getExecuteOps(page) → { kind, fromAddress, payload }[]
```

**Two-step fee override** in `approveExecute({ feeMethod })`: the FeeSettingsCard initially shows the auto-picked default method. To switch, the helper clicks `send-fee-override` first (surfaces the dropdown), then clicks `send-fee-method-{kind}-btn`. Mirrors the UX. When `opts.feeMethod` is omitted, no override; helper goes straight to `execute-confirm-btn`.

### 5.5 `fixtures/dappSession.ts` (new — for confirmationLevel mutation)

dApp sessions are persisted by `EntityStorage` under keys `nulo:core:dappSessions@<sessionId>` in `chrome.storage.local`. Each value is the JSON-stringified `DappSession` record. The fixture mutates this from the test driver (Puppeteer page evaluation) — no debug RPC added to the extension.

```ts
// Mutate the dApp session record. Used by test #37 (elevated confirmationLevel)
// to force the popup path on a non-sendTx op.
async function setConfirmationLevel(ctx: ExtensionContext, sessionId: string, level: AccessLevel): Promise<void> {
  // Use any open extension page (popup or background) to access chrome.storage.local
  const page = await openPopup(ctx)
  await page.evaluate(async ({ key, level }) => {
    const result = await chrome.storage.local.get(key)
    const session = JSON.parse(result[key])
    session.confirmationLevel = level
    await chrome.storage.local.set({ [key]: JSON.stringify(session) })
  }, { key: `nulo:core:dappSessions@${sessionId}`, level })
  await page.close()
  // The next dapp-interaction service call re-reads via `tryGetDappSession` (see service.ts:272),
  // so the mutation is observed without needing a SW restart.
}

// Scan all session keys, return the id whose dappMetadata.url starts with origin
async function getSessionIdForOrigin(ctx: ExtensionContext, origin: string): Promise<string> {
  const page = await openPopup(ctx)
  const id = await page.evaluate(async (originPrefix) => {
    const all = await chrome.storage.local.get(null)
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith("nulo:core:dappSessions@")) continue
      const session = JSON.parse(value as string)
      if (session.dappMetadata?.url?.startsWith(originPrefix)) return key.split("@")[1]
    }
    throw new Error(`No dApp session found for origin ${originPrefix}`)
  }, origin)
  await page.close()
  return id
}
```

**Caveat**: this fixture re-implements EntityStorage's transport contract from outside the SW. If `EntityStorage`'s key scheme or value encoding changes, this fixture must be updated. Documented in the helper file's header comment as a known coupling.

### 5.6 New data-testids on extension popups (v2 — naming aligned)

**`/windows/discover`** (`packages/extension/src/popup/windows/discover/index.vue`):
| testid | element |
|---|---|
| `discover-hostname` | hostname `<span>` |
| `discover-dapp-name` | dapp name `<span>` |
| `discover-allow-btn` | Allow button |
| `discover-deny-btn` | Deny button |
| `error-text` (with `role="alert"`) | inline error |

**`/windows/verify`** (`packages/extension/src/popup/windows/verify/index.vue`):
| testid | element |
|---|---|
| `verify-emoji-grid` | grid container |
| `verify-emoji` (with `data-emoji`) | each emoji cell |
| `verify-always-trust-toggle` | toggle |
| `verify-confirm-btn` | OK button (button copy is "OK" but testid stays `confirm-btn` per convention) |

**`/windows/capabilities`** (`packages/extension/src/popup/windows/capabilities/index.vue`):
| testid | element |
|---|---|
| `cap-item` (with `data-cap-id="<type>"`, `data-cap-name="<label>"`) | each capability card |
| `cap-toggle` | checkbox icon |
| `cap-detail-toggle` | expand chevron |
| `cap-account-item` (with `data-account-id="0x..."`, `data-account-name="..."`) | each available account |
| `cap-account-alias-input` | per-account alias input |
| `cap-rerequested-badge` | "previously denied" badge |
| `cap-approve-btn`, `cap-reject-btn` | footer buttons |
| `error-text` | inline error |

**`/windows/execute`** (`packages/extension/src/popup/windows/execute/index.vue`):
| testid | element |
|---|---|
| `execute-op-item` (with `data-op-id="<index>"`, `data-op-kind="<kind>"`) | each op card |
| `execute-op-from-name`, `execute-op-from-address` | from-account |
| `execute-op-payload-row` (with `data-call-name`, `data-call-to`) | each payload row |
| `execute-op-fee-set-badge` | "set by app" indicator (**newly added** to the existing banner at `execute/index.vue:510-520` and `:571-581`) |
| (reuse `send-fee-method-trigger`/`send-fee-method-{kind}` from FeeSettingsCard) | fee picker — no new testids needed since FeeSettingsCard is shared |
| `execute-confirm-btn`, `execute-reject-btn` | footer buttons |
| `execute-show-json-btn` | expand JSON icon |
| `error-text` | inline error |

**`/windows/json`** (`packages/extension/src/popup/windows/json/index.vue`):
| testid | element |
|---|---|
| `json-content` | `<pre>` content (testable via textContent) |
| `json-close-btn` | close button |

Total ~28 new testids. Naming aligned with helpers.ts contract. No `error-text` collisions because they're scoped per popup window (different page contexts).

---

## 6. PR breakdown (v2 — split PR 1)

| PR | Title | Tests added (count) | Notes |
|----|-------|--------------------|-------|
| **1a** | **Playground scaffold + global-setup wiring** | 0 | Build playground shell (sections + state + result feed). Add deps. Wire global-setup. Disable HMR in test mode. No testids yet, no helper rewrite, no tests. PR succeeds if `bun run dev:playground` works AND `bun run test:e2e` (existing suite) still passes. |
| **1b** | **Discover + verify testids + handshake smoke + connectDapp rewrite** | 1 (#01) | Add testids to `/windows/discover` + `/windows/verify`. Replace `connectDapp` helper. Un-skip `connect-dapp.test.ts` and convert it to use playground. PR succeeds if smoke handshake test passes + existing suite still green. |
| 2 | Connection lifecycle | 4 (#02, #03, #04 parameterized, #43) | Deny, locked queue, reconnect (alwaysTrust true/false), explicit disconnect. |
| 3 | Capability flow + cap testids | 6 (#05–#10) | Add testids to `/windows/capabilities`. Bundles (basic, accounts, partial). |
| 4 | Silent-path methods (read-only meta) | 6 (#11–#14, #16, #17) | getChainInfo, getAccounts × 2, batch-meta, getAddressBook, getCompleteAddress. |
| 5 | Silent-path methods (state-mutating) + execute + json testids | 5 (#18–#22) | getContractMetadata, getContractClassMetadata, registerSender, registerContract, registerToken. Add `/windows/execute` + `/windows/json` testids (used by PR 6+). |
| 6 | Silent-path simulations + authwit | 6 (#23–#27, #28) | simulateTx, profileTx, executeUtility, simulateViews, authwit-variants (parameterized: callIntent/innerHash/rawFr), getPrivateEvents. |
| **6a** | **sendTx variants part 1** | 3 (#29, #30, #31) | default, NoFrom, feePayer. |
| **6b** | **sendTx variants part 2** | 4 (#32, #33, #34, #35) | multi-call ≤5, multi-call >5 chunked, reject, sponsored FPC. |
| 7 | Batch + scope/cap errors | 3 (#15, #36, #38 parameterized) | partial-failure shape, mixed batch, scope/cap-rejection table. |
| 8 | Edge & lifecycle | 4 (#37, #39, #40, #44) | Elevated confirmationLevel spot-check, multi-account from routing, concurrent rapid-fire, wallet-locked-mid-session. |
| 9 | Tab/session lifecycle | 2 (#41, #42) | tab close, cross-origin nav. |

**Total**: 11 PRs, 44 new tests. 1a is pure infra (zero test payoff but zero risk surface for tests breaking). 1b ships the first test as a smoke check. 6 split into 6a/6b because `sendTx` is the highest-touch surface and 7 tests in one PR is too much.

Each PR ends with `bun run test:e2e:network` passing fully. Per the prior series learnings, we run the full suite after each PR to catch regressions.

---

## 7. Risk register (v2)

| # | Risk | Severity | Mitigation |
|---|------|---|------------|
| R1 | aztec.js WASM bundle bloat in playground | M | Lazy-import per-section. Verify dev startup <8s. **Hard PR-1a gate** (Audit A elevated this from "nice to have"). |
| R2 | MV3 SW races between handshake/cap/execute popups | M | Per-test fresh browser fixture for handshake-heavy tests. Reuse fixtures only for read-only chains. |
| R3 | `Promise.race` between `waitForApprovalWindow` and dApp call resolves wrong | M | Always install target listener BEFORE clicking trigger. Match popup target by **requestId query param** (R26). |
| R4 | Encrypted-channel monkey-patch could mask ordering bugs | L | Tests sequence calls with explicit awaits; don't rely on dispatcher serialization for correctness. |
| R5 | Chrome process accumulation flake | L | `pkill -9 chrome` in global-setup setup+teardown. Already in place. |
| R6 | PXE sync delay timing | M | Reuse 30-retry refresh polling pattern. Use `waitForFunction` over fixed sleeps. |
| R7 | `verify` popup emoji-match non-determinism | L | Don't assert emoji content. Click-to-confirm transitions state. |
| R8 | Playground reload between tests loses connection | M | File-scoped browser, fresh Chrome per state-mutating file. |
| R9 | FunctionCall encoding pin between playground + extension | M | Both pin same `@aztec/aztec.js` + `@defi-wonderland/aztec-standards`. Lockfile version must match (R25). |
| R10 | Network "Local Network" name config-driven | L | Tests select by `data-network-id`. |
| R11 | Capability scope variations require multiple bundles | L | v2 expanded bundle list (10 bundles). |
| R12 | global-setup playground spawn complicates lifecycle | L | Mirror `weStartedNode` flag with `weStartedPlayground`. Auto-detect already-running on 5174. |
| R13 | `chrome.tabs.onUpdated` SPA detection | M | Playground does not navigate. Document. |
| R14 | Wallet locked → discovery queued tests need lock+unlock | L | Reuse `lockWallet` + `ensureUnlocked` helpers. |
| R15 | Audit may miss wire-protocol subtleties | L | Pre-flight: PR 1a tests playground's FunctionCall builder against a known good run. |
| R16 | WalletManager discovery races SW boot | L | Reuse `nulo:liveness` heartbeat wait in `launchExtension`. |
| R17 | Cross-test state leakage in network suite | M | Sequential per file; document fixture scope per file. |
| **R18** | **Default `confirmationLevel = Transactions` makes ~14 v1 popup-rows silent** | **H** | **v2 reclassifies; popup-path tested via #37 elevated-confirmation fixture.** |
| **R19** | **Vite HMR fires `chrome.tabs.onUpdated` → kills sessions on save** | **H** | **HMR disabled when `NODE_ENV=test` (vite.config + global-setup env var).** |
| **R20** | **MV3 SW restart loses `pendingVerification`/`pendingDiscoveryPromises`/`sessionQueues`/`decryptQueues`** | **M** | **Document as known gap. Mid-session SW restart = session terminates. F3 followup.** |
| **R21** | **`chrome.tabs.onUpdated` URL parse failures terminate sessions, not just cross-origin nav** | **M** | **Test (#42) covers cross-origin happy path; document the parse-failure edge as known.** |
| **R22** | **`handleSendTx` always picks first session account, ignores dApp's `opts.from`** | **M** | **Test #39 pins this as documented behavior. Open question whether to fix in code (separate PR).** |
| **R23** | **`batch` returns null/`{result:null}` placeholder for failed legs — wallet-sdk consumer contract** | **M** | **Test #15 pins shape. If wallet-sdk version updates the consumer contract, test surfaces it.** |
| **R24** | **`connectDapp` rewrite changes file-scoped fixture's connection state** | **L** | **PR 1b deletes old fixture; verify no other test imports it before merge.** |
| **R25** | **wallet-sdk version skew between playground (`4.2.0-nightly.20260413`) and extension** | **M** | **Lock playground to use the same version as extension via root resolution. Fail PR 1a if diverged.** |
| **R26** | **`chrome.windows.create` opens separate OS windows; on Linux Xvfb in CI, popups can stack and `waitForTarget` URL-substring match grabs an old reincarnation** | **M** | **All popup helpers match by `requestId` query param (already in popup URLs at `dapp-interaction/service.ts:177`).** |
| R27 | `contractClasses` capability missing from prebuilt bundles | L | v2 added `contractClasses` and `full` bundles. |
| R28 | `getPrivateEvents` underspecified — needs real eventMetadata + filter | M | Playground uses the deployed Token contract's transfer event as the canonical fixture. Document. |
| R29 | `accounts.canGet`/`data.addressBook` flags unenforced today | L | F8 followup. Tests treat as no-op. |
| R30 | Result feed query races on stale rows | L | Tests snapshot `data-result-seq` before invocation, wait for `seq+1`. |

---

## 8. Out of scope / followups

- **F1**: iframe wallet provider transport (different transport entirely)
- **F2**: WalletConnect transport (project ID + external services)
- **F3**: Discovery queue persistence across SW restart (mid-session — not currently supported by code)
- **F4**: Stale discovery rejection (5-minute timer — too slow for e2e; unit-test instead)
- **F5**: Concurrent multi-tab discoveries (needs multi-tab driver pattern)
- **F6**: Real-prover paths (sandbox uses `proverEnabled: false`)
- **F7**: L1↔L2 Fee Juice claim end-to-end (already partial-skip in fee-methods)
- **F8**: `accounts.canGet` + `data.addressBook` enforcement (unimplemented today)

---

## 9. Open questions for review (round 2)

1. Should the elevated-confirmationLevel fixture (test #37) lower confirmationLevel to `AppState (1)` (popup on everything ≥ 1) or to a specific intermediate level for variety? **Plan: AppState — exercises the lowest non-zero level for maximum coverage.**
2. Does the playground need to ALSO test the dApp from a non-localhost origin (via `--host` flag + a fake hostname) to verify CAIP-2/origin handling? **Plan: no, localhost is the canonical test origin; cross-origin is sufficiently covered by tab-navigate test.**
3. Should authwit-variants (#27) test all 3 variants in one file or split by scope-enforcement complexity? **Plan: parameterized in one file; reduces browser launches.**
4. Should `multi-account-from-routing` (#39) assert the *current* (buggy?) behavior or the *desired* behavior? **Plan: assert current. If fixed in code separately, test gets updated.** This is a "characterization test" — it pins what we currently do.
5. PR 5 is bundling silent-path state-mutating ops with `/windows/execute` + `/windows/json` testids. Is that justified? **Plan: yes — execute popup testids are needed by PR 6+ but adding them with no test consumer is wasted; PR 5 introduces them with a popup-path consumer (the elevated-confirmation test in PR 8 also needs them).**
6. Should we bundle the playground's contract artifacts (Token, SponsoredFPC) statically or fetch at runtime? **Plan: bundle statically via `@defi-wonderland/aztec-standards` — fetch-at-runtime adds an MITM surface and CSP issues.**

---

## 10. Definition of Done

- Playground at `packages/playground/`, deps installable via root `bun install`. `bun run dev:playground` works. README documents UX and testid contract.
- `bun run test:e2e:network` passes 44/44 new tests + the existing 16 active (transfers + fee-methods + networks + tokens + token-management) for ~60 active network tests, in **<45 minutes** on macOS (per-PR breakdown in §11).
- ~28 new `data-testid`s added to `/windows/{discover,verify,capabilities,execute,json}`, listed in `tests/e2e/fixtures/helpers.ts` selector contract block.
- No skipped tests except the explicit OUT-OF-SCOPE rows (F1–F8) and pre-existing FJ skips in `fee-methods.test.ts`.
- `connect-dapp.test.ts` un-skipped, points at local playground.
- Old `https://adhoc-aztec-wallet-test.pages.dev` dependency fully removed.
- HMR disabled in playground when `NODE_ENV=test`. Verified by the test infra.
- Each PR commit message documents which paths it covers vs the table above.
- Memory entries updated: project-context for the playground design, feedback for the silent/popup matrix correction (so future runs don't re-make the v1 mistake).

---

**End of v3 plan body.** See §11 below for runtime budget breakdown.

---

## 11. Runtime budget breakdown (per PR)

The full network suite must finish in **<45 minutes** on macOS. Worst case driver: `tokenReadyExtension` polling for balance visibility (~30 retries × 5s = up to 150s setup per file). Most fixtures are file-scoped, so setup cost amortizes across tests *within* a file.

| PR | Tests | Fixture | Per-test budget | Setup budget | Subtotal |
|----|-------|---------|------------------|--------------|----------|
| 1a | 0 (existing only) | none | n/a | n/a | 0 |
| 1b | 1 | `playgroundConnectedExtension` (depends on `tokenReadyExtension`) | 30s | 150s | ~3 min |
| 2 | 4 | mostly per-test (state-mutating) | 60s avg | 4×60s setup | ~6 min |
| 3 | 6 | file-scoped | 30s | 150s | ~5 min |
| 4 | 6 | file-scoped (silent reads) | 15s | 150s | ~4 min |
| 5 | 5 | file-scoped | 25s | 150s | ~5 min |
| 6 | 6 | file-scoped (silent sims) | 25s | 150s | ~5 min |
| 6a | 3 | file-scoped (sendTx, network roundtrip) | 60s | 150s | ~6 min |
| 6b | 4 | file-scoped (sendTx) | 60s | 150s | ~7 min |
| 7 | 3 | file-scoped | 45s | 150s | ~5 min |
| 8 | 4 | per-test (state-mutating + locking) | 90s avg | 4×90s setup | ~12 min |
| 9 | 2 | per-test (browser teardown) | 60s | 2×120s setup | ~6 min |
| **Existing** | 16 | mixed (already deployed) | observed ~22 min total | — | ~22 min |

**Total estimate**: ~22 (existing) + ~64 (new) = **~86 minutes worst-case**, ~45–55 min realistic if fixtures within each PR's tests share state. **Mitigation if budget overruns**: split network suite into `vitest.e2e.network.config.ts` (handshake + silent-path, fast) and `vitest.e2e.network-tx.config.ts` (sendTx + state-mutating, slow); CI runs both; local dev iteration runs only the relevant one. Documented as F9 (followup) — not blocking initial implementation.

**Caveat**: this estimate is a planning aid, not a contract. Validated against the existing `transfers.test.ts` (7 tests, ~21 min observed). If round-1 PRs blow the budget, we re-tier.

---

## 12. Memory updates (post-approval)

To prevent regressions on the v1 mistakes:

1. **feedback memory** — "When inspecting Nulo dApp protocol behavior, always check `confirmationLevel` against `getOperationAccessLevel`. Default `confirmationLevel = AccessLevel.Transactions (5)`, so non-`sendTx` operations are silent-path. The comparison is strict `>=`. Pre-checked at `service.ts:355–374`."
2. **project memory** — "Test playground for dApp protocol e2e lives at `packages/playground/`. Built in plan `implementations-plan/network-playground-testing/plan.md`. Wired into `vitest.e2e.network` via `global-setup.ts`. ~28 testids on `/windows/{discover,verify,capabilities,execute,json}`."
3. **reference memory** — "Wallet-bridge dispatcher exposes ~17 RPC methods + 3 special-cased (`requestCapabilities`, `getAccounts`, `batch`, `sendTx`); see `packages/wallet-bridge/src/dispatcher.ts:118–164`."

(These are saved AFTER user approval, not now — saving a memory about a plan that isn't approved would be premature.)

---

**End of v3 plan.** Ready for user approval.
