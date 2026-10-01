# Phase 1: reproduce, root-cause, Track A

All runs are `bun run e2e:agent` on Chrome, prover-ON, under the host e2e lock, 2026-10-01.

## Reproduction (local probe, not committed)

The probe drove the playground with `?chainId=11155111&version=1821665230`, the V5 testnet's
chain info, which the V6 wallet derives to chain 1816023401, and logged the raw error behind
the envelope for one run.

- **Unserved chain, unlocked.** The connect window opens and Allow writes a `DappSession` for
  `(origin, 1816023401)`. `requestCapabilities` then fails with "The wallet could not process the
  request." and no window opens. The raw error was `No network configured for chainId 1816023401`,
  thrown by `WalletSdkDispatcher.resolveNetwork`. After a reload the remembered row auto-approves
  (emoji check only), and the next call fails the same way. This is the owner's report.
- **Unserved chain, locked, then unlock.** The same failure, with the window opening at unlock.
- **Served chain (Local Network), locked, then unlock.** The capabilities window opens and the
  grant lands; after a reload, `requestCapabilities` answers with no window.

Conclusion: the chain decides the failure, and the lock only decides when the connect window
appears.

## Track A: the locked connect on a served chain

The coordinator asked to prove that a connect made while locked works once the wallet is unlocked,
by password and by passkey. The proof had to cover requestCapabilities, getAccounts,
executeUtility and simulateTx, then a refresh.

1. **First run: both tests failed at `executeUtility`** with the generic message. Cause: the
   playground's "executeUtility (balance_of_public)" button sends `balance_of_public`, a
   `#[public] #[view]` function, so it fails on every session. `sim-methods.test.ts` already
   accepts ok or error for it. This is not a lock bug. It is filed in `follow-ups.md`.
2. **Second run: green on both.** The utility read became the phase section's
   `balance_of_private` after `registerContract` with the suite token's node instance.
   - Password unlock: 33 s. Passkey unlock: 26 s.
   - Each test covered getAccounts, registerContract, the utility read and simulateTx
     (transfer 0), then a reload, the reconnect, `requestCapabilities` with no window, and the
     same calls again.
   - An unlocked control with the same calls was also green.

**Kept** `connect-locked-queue.test.ts`, extended. It is the only e2e of a locked connect plus an
unlock (password and passkey) followed by real calls and a refresh. The old test stopped at
"connected" with a password, and no other file connects while locked: the passkey canary connects
unlocked, and `wallet-locked-mid-session` locks after connecting.

## The notice's e2e

`connect-unserved-chain.test.ts` and the extended `connect-locked-queue.test.ts` ran together,
prover-ON, before the round-1 audit fixes:
- Chrome: 4/4 green. The notice tests took 15 s and 14 s.
- Firefox (`NULO_E2E_BROWSER=firefox`): 4/4 green. The notice tests took 21 s and 22 s. The
  log's `JavaScript error: resource://gre/...` lines are Firefox's own chrome code, not the
  wallet's.

## Screenshot harness (local, not committed)

The playground was served under a realistic https origin through puppeteer request interception.
- **First attempt timed out waiting for the connect window.** The harness aborted every request
  outside the fake origin, which included the extension's own `chrome-extension://` resources.
- **Fix:** abort only other http(s) hosts and let everything else through.
- **Vite's HMR socket.** It tried the fake host's `wss://` URL and failed with an unexpected 200
  despite a `Network.setBlockedURLs` block on `ws://*` and `wss://*`. It is not established
  whether the interception answered that handshake or the owner's real host did. A harness that
  needs no external contact should serve a production build of the playground, which has no HMR
  client.
