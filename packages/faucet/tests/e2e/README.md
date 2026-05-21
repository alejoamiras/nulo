# packages/faucet/tests/e2e

Smoke e2e tests for the faucet. Run via:

```bash
bun run --cwd packages/faucet test:e2e
```

## What this covers

The smoke mounts the full `App.vue` in jsdom and exercises the page
against a **mock wallet provider** that intercepts `aztec-wallet-discovery`
postMessage and emits canned RPC replies. No browser, no real wallet,
no Aztec network.

The mock implements every wallet-sdk RPC the faucet uses:

1. discovery handshake (`aztec-wallet-discovery` postMessage)
2. `establishSecureChannel` → returns deterministic `verificationHash`
3. `confirm` → returns the Wallet handle
4. `requestCapabilities` → returns canned `granted.accounts`
5. `registerContract` → returns void
6. `executeUtility` → returns canned `0n` for balance reads
7. `sendTx` → returns deterministic fake `txHash`

The 7-RPC list comes from the codex audit (audit-codex.md R2). v1's mock
list missed `registerContract`; v2 fixed it.

## What this does NOT cover

- **Real alpha-testnet behavior** — no live RPC. The maintainer manually
  smoke-tests after a real deploy.
- **Cross-browser** — jsdom is the only environment.
- **bb.js wasm** — the mock intercepts before any wasm runs.

These gaps are intentional; a network e2e would consume drips and flake
when alpha-testnet stutters (plan-v2 §7 rationale).

## Failure modes worth noticing

If a smoke fails after a wallet-sdk dep bump:
- The mock probably needs a new RPC handler.
- Check `src/composables/useWalletConnection.ts` for new SDK calls.
- Add the handler in `helpers/mockWalletProvider.ts`.

If a smoke fails after a `@defi-wonderland/aztec-standards` bump:
- The artifact import paths may have changed. Re-check
  `dist/src/artifacts/{Token,Dripper}.js` and update the mocked
  re-exports if needed.
