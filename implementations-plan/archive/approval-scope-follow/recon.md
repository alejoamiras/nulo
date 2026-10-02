# Recon — approval-scope-follow

Two read-only Explore agents against `origin/dev` (worktree base `c543c18d`). Section A is the
repo-wide reuse sweep; section B maps the e2e surface the work has to be proved on.

> Both agents lost their shell partway through (their working directory was the shared checkout
> while this session homed into the worktree) and finished by reading the worktree's files, which
> they spot-checked as byte-identical to `origin/dev`. Everything load-bearing below is re-verified
> in plan.md's Assumptions.

## A. Reuse map

| Capability needed | What already exists | Verdict |
|---|---|---|
| Chain-name resolution honouring a user rename | `network?.name ?? getChainName(chainId)` — the precedence rule inside `capabilities/chain-mismatch.ts`; `getChainName` + `CHAIN_IDS` in `components/ui/utils.ts` → `utils/chain-ids.ts` | **reuse-as-is** (the rule; execute already holds resolved rows so `.name` is direct) |
| A resolver comparing the dApp's scope to the wallet's | `resolveDappChain(sessionChainId: string, networks, activeChainId)` — capabilities-only, takes a raw CAIP string | **build new, colocated** — see "no shared dir" below |
| Per-operation network/account rows | `buildOperationsFromPayload` → `resolveNetworkByChainId`, `accountService.getAccount(profileId, chainId, address)` — already in `execute/index.vue` | **reuse-as-is** |
| Deduped signer lists | `uniqueSignerAccounts` / `uniqueSignerNetworks` — `execute/signers.ts`, already wired as computeds | **reuse-as-is** |
| "More than one signer" vocabulary | `SignerIdentityStrip.vue` — `"{N} accounts"` / `MIXED` / `"No signer"` | **reuse the vocabulary**, don't invent new copy |
| The banner | `@nulo/design/ui/Banner.vue` — `variant`, `direction`, `wide`, one `action: {name, callback, testId}`, `#title` / `#description` slots. Globally auto-registered (no import). Exactly ONE action by design | **reuse-as-is** |
| Switching the active network from a view | `useNetworkActivation({persist, read})` → `activateNetworkGuarded`. Sole caller today: `capabilities/index.vue`'s `switchToDappNetwork` | **reuse-as-is**, identical `requireNetwork()` thunks |
| Persisting the active account | `appStore.selectAccount(acc)` — sets `account.value` **and** writes `nulo:ui:activeAccount`; **not self-guarded**, every call site wraps it in `commitScopeChange(...)` + a toast (2 copies: `AccountsPopup.vue`, `settings/accounts/index.vue`) | **adapt** — we need the pointer write WITHOUT the in-memory move (see plan §Trade-offs) |
| Storage access from popup code | `storageLocalGet`/`storageLocalSet` — `utils/storage.ts` | **reuse-as-is**, mandatory (see ban below) |
| Test template for "new Banner + a side effect on its action" | `capabilities/chain-switch.test.ts` — mocks `useNetworkActivation`, stubs `Banner` exposing `data-state`/`data-variant`/an action `<button>`, `deferActivation()` holds the async open | **reuse the pattern wholesale** |
| Window shell-lifecycle pins | each window's `index.test.ts` is a frozen-oracle characterization suite (connect/disconnect order, `beforeunload` timing, `closeWindow` semantics) | **extend, never rewrite** |
| A post-approval / pre-close side effect anywhere | none — all three windows are `await resolve/approve…` then `closeWindow(true)`, nothing between | **build new** (insertion point is unambiguous) |
| Any other cross-scope hint in the extension | none. Every other scope change re-scopes silently (`holdings.vue` watch, `recent-activity-handlers.ts`, `send-balance-events.ts` use the active scope as a filter predicate only) | the capabilities banner is the only sibling |

### Hard constraints the sweep surfaced

- **There is no `popup/windows/shared/` directory, and the convention forbids inventing one.**
  Helpers used by one window stay colocated beside its `index.vue` (`execute/signers.ts`,
  `execute/operation-validation.ts`, `capabilities/build-items.ts`); genuinely cross-window logic
  lives in `@/composables/` or `@/utils/`. The new resolver is execute-only → it belongs in
  `execute/`. `resolveDappChain` stays where it is; sharing it would mean re-encoding execute's
  already-resolved rows back into a CAIP string.
- **`storage-facade-ban.test.ts` is a static scanner, not a lint rule.** It fails CI if the literal
  `chrome.storage.local` appears on a non-comment line outside its allowlist (`utils/storage.ts`,
  `core/adapters/chrome-browser-api.ts`, most of `wallet/`, the migration barriers, e2e, tests).
  Popup code touching `nulo:ui:activeAccount` must go through the facade.
- **`Banner`'s `action` is singular by design.** The decline toggle goes through it; do not extend
  `Banner.vue` or add a second control beside it.
- **Preserve "a renamed row wins"** in any name shown. Falling back to `getChainName(chainId)` when
  a `Network` row exists would regress a user's rename.

### Collision risks flagged

1. No `useAccountActivation` sibling to `useNetworkActivation`; the guard+toast idiom is already
   duplicated twice. A third inline copy would continue that duplication — decided in plan
   §Trade-offs (we need something different, so neither copy nor extraction applies).
2. The in-flight-send guard runs immediately after an approval that may itself have journalled a
   send — could it refuse the follow it was triggered by? **Resolved as a Fact in plan.md**: the
   guard is scoped to the *currently viewed* account + network, and a mismatch means the new
   operation is by definition outside that scope.

## B. e2e surface

### B1. Which suite

Network suite (`vitest.e2e.network.config.ts`, `tests/e2e/network/**`), driven by
`bun run e2e:agent [file]`. Not smoke (no chain to submit against) and explicitly not a composition
test — `COMPOSITION-TESTS.md` bars anything needing a real `sendTx` to be internally consistent
(D2) or touching bb WASM (D6). A real transaction landing in the Activity feed is both.

### B2. THE CONSTRAINT: the harness boots one chain

`global-setup.ts` spawns exactly one anvil + one `aztec start`. That single sandbox is the
**Local Network** preset (chain id 0). `Testnet` and `Alpha V5` are built-in preset rows pointing at
real remote RPC endpoints the harness never starts and never funds; `networks.test.ts` pins that a
fresh profile has exactly those three rows.

Consequences:

- A real, minable, fee-payable transaction can only run against **Local Network**, whatever the
  banner names as the other side of the mismatch.
- A chain mismatch comes for free from where the wallet points: the e2e build stamps
  `VITE_NULO_E2E_DEFAULT_NET=testnet` (`scripts/e2e/agent.sh`), so a fresh profile is active on
  Testnet while the playground's default `chainInfo` resolves to chain id 0.
  `cap-chain-mismatch.test.ts` leans on exactly this by *not* calling `switchToLocalNetwork`.
- **But** that naive recipe leaves the dApp holding an on-demand-provisioned Local Network account
  with no funds — fine for a capability grant, not for a transaction. Our recipe instead: connect
  through a fixture that DOES switch (funded, granted), then `switchToNetwork(page, "Testnet")`, and
  only then drive the transaction. Mismatch present, account funded.

### B3. Closest existing tests

| File | What it gives us |
|---|---|
| `network/cap-chain-mismatch.test.ts` | The banner analogue: waits on `[data-testid="cap-chain-banner"][data-state="mismatch"]`, asserts banner text, exercises the switch, reads the strip via `[data-testid="identity-network"]`. Its switch is manual and pre-approval — the opposite interaction model. |
| `network/tx-sendTx-default.test.ts` | dApp `sendTx` end to end: `waitForPopup(ctx,"execute")` → `waitForExecuteContent` → `approveExecute` → `waitForPgResult(page,"sendTx",…)` returning a txHash. Asserts the journal, never the Activity DOM. |
| `network/transfers.test.ts` | The Activity read: `clickNavTab(page,"activity")` → wait `[data-testid="tx-card"]`. Its transactions come from the wallet's own send popup. |
| `network/multi-account-from.test.ts` | Sending `from` a named second account via the playground's `pg-input-from`, proving on-chain only that account moved. |
| `network/account-switch-live-session.test.ts` | **Best structural template.** Two accounts on one live session; the wallet's active account switches in its own UI while the session stays connected; proves the `sendTx` executes as the session's account regardless. Exactly our precondition. |

No existing test stitches "dApp execute popup" to "Activity feed" — ours is the first.

### B4. Fixtures to reuse

- `dappConnectedExtensionWithTransactionCap` (one funded, granted account on Local Network) and
  `dappConnectedExtensionWithFirstTwoAccountsCap` (adds a second account, exposes
  `accountAddresses: string[]`).
- `fixtures/popups.ts`: `waitForPopup(ctx,"execute")`, `waitForExecuteContent`,
  `waitForExecuteApprovable` (the authoritative approvable gate), `approveExecute(page,{feeMethod})`,
  `rejectExecute`, `getExecuteOps`.
- `fixtures/helpers.ts`: `switchToNetwork(page,name)`, `switchAccountByAddress` (stable across runs
  — prefer over by-name), `createSecondAccount`, `getAccountAddress` (reads `nulo:ui:activeAccount`),
  `clickNavTab`, `waitForTxConfirmation`.
- `fixtures/playground.ts`: `snapshotResultSeq`, `waitForPgResult`, `setPgInput`,
  `callExpectingNoPopup`.
- Mandated drivers (normative in the e2e README): `clickByTestId`, `typeIntoInput`,
  `replaceInputValue`, `withTimeoutMessage` — never raw `.click()` / `.type()`.

### B5. Selectors that exist vs must be added

Exist — execute: `execute-op-item` (`data-op-id`, `data-op-kind`), `execute-op-from-account`
(`data-account-name`, `data-account-address`), `execute-confirm-btn`, `execute-reject-btn`,
`send-fee-method-*`, the shared `identity-network` strip. Activity: `tx-card`
(`data-tx-amount-display`, `data-tx-transfer-type`, `data-tx-status`, `data-tx-hash`),
`tx-awaiting-card` (in-flight projection), `nav-activity`. Scope: `network-button`,
`account-selector` / `account-item` (`data-account-address`).

To add: `execute-scope-banner` (with `data-state`), `execute-scope-action-btn`, and a hash-keyed
Activity waiter. `waitForTxConfirmation` keys on `(amount, transferType)` and its own comment warns
it is not a safe generic primitive; a dApp-arbitrary `aztec_sendTx` is not transfer-shaped, while
`tx-card` already carries `data-tx-hash` and `waitForPgResult` hands us that hash.

### B6. Runner

`bun run e2e:agent tests/e2e/network/<file>.test.ts` runs one file (args pass through to vitest).
Ports are ephemeral per run, the Aztec data dir is per-run on real disk, orphan cleanup is
path-scoped — two worktrees can run concurrently. `--shard=N/5` reproduces a CI shard. Full suite
~35–45 min unsharded, ~10–15 per shard.
