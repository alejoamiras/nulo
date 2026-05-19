# @nulo/playground

Test dApp used by the network e2e suite. Exposes a known testid catalog, deploys a token contract on boot, and renders deterministic operations the suite drives end-to-end.

A wallet must already be installed in the dev browser for the page to be useful — typically the Nulo extension built via `bun run build`.

## Run standalone

```sh
bun run dev:playground   # http://localhost:5174
```

## Test mode

E2E tests append `?test=1` to the URL and run the Vite dev server with `VITE_DISABLE_HMR=1` so file saves don't fire `chrome.tabs.onUpdated` and terminate dApp sessions mid-test. Test mode also disables localStorage persistence and the protocol log to keep the DOM minimal for testid queries.

## Testid contract

- `pg-status` (with `data-status="idle|discovering|verifying|connected|error|disconnected"`)
- `pg-account-list` containing `pg-account-item[data-account-id][data-account-name]`
- `pg-btn-{action}` for every button (e.g. `pg-btn-connect`, `pg-btn-sendTx-default`)
- `pg-input-{name}` for every input (e.g. `pg-input-recipient`, `pg-input-amount`)
- `pg-bundle-select` with `<option data-bundle-id="X">` per capability bundle
- `pg-result` rows with `data-result-seq` (monotonic), `data-method`, `data-status="pending|ok|error"`, `data-result-json` (JSON-escaped). Tests snapshot the seq before invocation and wait for the matching row.
- `pg-error-text` (with `role="alert"`) for inline errors
- `pg-protocol-log` (debug only)

Testid stability is a hard contract with the e2e suite. Adding new testids is fine; renaming existing ones requires updating every test that selects them.

## Capability bundles

The playground groups capabilities into pre-baked **bundles** the test suite can grant in one approval gesture:

- `meta` — read-only data RPCs (`getAccounts`, `getChainInfo`, `getAddressBook`).
- `contracts` — `registerContract`, `registerSender`, metadata reads.
- `sendTx` — full transaction surface for a single account.
- `multi-account` — bundles for tests that need >1 account context.
- (others as needed; see `src/lib/bundles.ts`)

Bundles are a playground-only convenience: the wallet itself models capabilities individually via `requestCapabilities`. The bundle picker just chooses which capability set to ask for.

## Sections

| Section | Methods |
|---|---|
| Connect | `connect`, `disconnect`, `requestCapabilities` (with bundle picker) |
| Meta | `getChainInfo`, `getAccounts`, `getAddressBook` |
| Contracts | `registerContract`, `registerSender`, `getContractMetadata`, `getContractClassMetadata` |
| Simulation | `simulateTx`, `profileTx`, `executeUtility` |
| Transactions | `sendTx` (default / NoFrom / feePayer / multicall / chunked) |
| AuthWit | `createAuthWit` (callIntent / innerHash) |
| Data | `getPrivateEvents` |
| Batch | meta-only / mixed / partial-failure |

`registerToken`, `getCompleteAddress`, and `simulateViews` (Nulo-custom RPCs inherited from the fork) were removed in the canonical refactor. Use `wallet.registerContract()`, the granted capability response, and `simulateUtility` / `BatchCall.simulate()` respectively.

## Stack

- `@aztec/wallet-sdk` — discovery + secure-channel client.
- `@aztec/aztec.js` — types (`FunctionCall`, `Fr`, `AztecAddress`, `ExecutionPayload`).
- `@defi-wonderland/aztec-standards` — Token contract artifact for `sendTx` tests.
- Vite — dev server / build.
- No UI framework — plain DOM updates keyed off `pg-result` seq.

## Design notes

The playground's state is a single `PgState` object; each mutation calls `render()` which paints the whole DOM via `innerHTML`. No diff library — at most ~50 buttons and ~100 result rows; performance is irrelevant. Reactive frameworks (Vue, Svelte) introduce subtle reactivity-bug flake sources this harness explicitly avoids.

## Where to read next

- [`../extension/tests/e2e/README.md`](../extension/tests/e2e/README.md) — how the network e2e suite drives this dApp end-to-end, port allocation, parallel-safe agent runner.
