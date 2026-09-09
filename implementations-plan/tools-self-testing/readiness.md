# Tools — what stands between this suite and "production-ready"

Written at delivery (2026-09-09), after the stack's CI proof. "Production-ready" here means the
AUTOMATED local tests would let a release ship without a human driving the flows; the manual
extension-over-tools smoke stays a separate, deliberate step.

## 1. What the automated tests still do not prove

| Gap | Why it matters | What closes it |
|---|---|---|
| **Only the `local` target is driven.** | Production runs `testnet`/`mainnet`: real RPCs, the deployed generation (`apps/tools/public/*-bridge.json`), the pinned PrivateFPC, chain-identity mirrors, the CSP for real origins. `verify:deployments` and `verify:build-target` check identity at build time; nothing drives the built bundle. | A nightly (not PR-gated) canary: the `build:testnet` bundle in Chromium against a funded wallet-sdk account on testnet — one public deposit + claim, one exit — asserting the same chain postconditions the local cells do. Minutes of real proving, so nightly only. |
| **No second tab, no second device.** | The journal's provenance rule ("a second tab writing a record mid-send is not this wizard's transfer", `SendWizard.vue` `adoptRunRecord`) is unit-tested, never driven. | One cell with two pages on one context: a send in tab A, a claim in tab B, each stepper adopts only its own record. |
| **Recovery: the dropped and consumed branches** (§ 4). | Two of cell 24's three branches are asserted nowhere. | Both are stageable now, see § 4. |
| **The Permit2 signature's fields.** | The Ethereum wallet fixture signs typed data blind; no cell asserts `spender`, `amount`, `deadline`, `nonce` are the review's. A wrong spender is the classic bridge-drain shape. | Record the typed data in `fixtures/l1-wallet.ts` and assert it in cells 1 and 13. |
| **A hostile token list.** | Cell 34 serves a well-formed fixture. A list entry with a wrong `decimals`, a non-checksummed or non-contract address, or a duplicate symbol is what a poisoned list looks like. | One cell per malformed entry; the expected outcome is a refused or clearly-flagged tile, never a send. |
| **Mid-flow wallet loss.** | `holdNext` proves a claim whose wallet went away; nothing does the same for the Ethereum leg (`eth_sendTransaction` never answering) or a wallet closed between the authwit and the exit. | Two cells using the L1 fixture's hold and the test wallet's `holdNext("sendTx")`. |
| **Viewport is 1440 px only.** | The ActivityDock overlays the wizard below 1100 px; nothing runs there. | The spike's connect + one deposit at 390 px and 1024 px. |
| **The suite is advisory.** | A gate that does not block cannot be production evidence. | The plan's clean week at retry 0, then `required-checks.sh --add tools-e2e-status`. Two product warts (§ 2) should land first or the week will not be clean. |
| **The SDK's discovery probe is origin-only.** | Upstream weakness, worked around by one origin per profile. Any dApp listing two wallets on one origin is bitten. | A one-line patch in `patches/` (`event.source === iframe.contentWindow`) and an upstream issue. |

## 2. Roughness the helpers absorb, and the product fixes behind each

- **`confirmReview` re-reviews on a stand-down (up to four times).** Two product faults sit under it.
  (a) The generic watcher (`SendWizard.vue`, `invalidateReview`) fires on the confirm's OWN re-read
  outputs (`tokenOnlyBlocked`, the intent auto-move, `gasShare.txTarget`) while `preflighting`, so on a
  slow runner the review is stood down with "Something changed" before the preflight can give its
  named verdict ("could not be read just now", "fees moved"). Fix: while `preflighting`, changes to
  those outputs defer to `preflightStandDown`; the account, chain, token, amount and route still stand
  the review down at once. (b) A stand-down returns to step 1, which re-quotes the route; the quote
  clears `routeOutcome` to null and lands a new object, and each transition stands a re-opened review
  down again even when the answer is identical — and for a token-only send the route is not even an
  input of the frozen plan. Fix: watch a value-stable route key and only for intents that carry gas;
  do not re-quote for an unchanged token.
- **`openPickerWith` reopens the picker.** Now a safety net for a frame slower than the probe's 10 s;
  the real fix is upstream (§ 1, last row).
- **`driveToConnected` answers every stop after a reload.** The reconnect can land at the emoji check,
  at `idle`, or at the picker depending on timing. A remembered wallet should resume deterministically
  at the emoji check; the picker should never reappear for it.
- **`settled()` polls a read through the wallet's PXE** because the wallet's view trails the block for
  a few seconds after `sendTx` resolves. This is the SDK's sync latency, not the app's; the app's own
  `claimTokensUntilSynced` retry is the right product answer and stays.

## 3. The fixes I would land before calling it production-ready, in order

1. The preflight-deferred stand-down (§ 2a) with a unit pin in `SendWizard.test.ts`, then the
   value-keyed route watcher and quote dedupe (§ 2b). Both are contained in `SendWizard.vue` and
   `useRouteQuote.ts`.
2. Cells for the dropped and consumed recovery branches (§ 4), the Permit2 field assertions, and the
   two-tab provenance cell.
3. The SDK probe patch in `patches/`, then drop `openPickerWith`'s reopen.
4. The deterministic FPC equality gate in the integration suite (credit equal to the ceiling lands,
   one unit short is refused), where the cap is fixed in-process.
5. The clean week, then promote `tools-e2e-status`; the testnet nightly canary alongside.

## 4. The recovery branches, in plain words

A fueled deposit is two transactions: the Ethereum leg (the deposit, which also bridges the Fee Juice
the claim will pay with) and then the Aztec claim. Cell 24 asks what the app does when the page is
interrupted between them and reloaded. Three things can be true of the claim at that moment:

- **Pending** — never sent. The journal holds a record with a deposit hash and no claim hash; the
  reloaded page offers the claim again or resumes it. **Staged** (cell 24a): the test wallet holds the
  claim's first simulation, the page reloads, the claim lands from the journal alone.
- **Dropped** — sent, hash recorded, never mined (the network dropped it: a nonce/fee edge, a node
  restart). The record carries a claim hash that will never land; the app must notice and let the user
  claim again rather than wait forever. **Not staged**: the local network mines every valid submission
  at once, so nothing outside the wallet could produce a hash that never lands. It is stageable now:
  the test wallet observes the node hand-off (`TestWallet.observeSubmissions`), so a `dropNext("sendTx")`
  fault can return the hash and swallow the transaction.
- **Consumed** — the L1→L2 message was claimed by someone else before the page's claim: a relayer
  claimed on the user's behalf, or another tab did. The page's claim then fails on a nullified message
  and the record must finish as done (the funds arrived) instead of erroring. **Not staged**: the
  harness could not claim the message for the page's account deterministically at the right instant.
  It is stageable now: the sandbox's relayer key can claim the deposit's message right after the
  Ethereum leg (the harness's `claimViaHub` from the relayer), before the page resumes.

Plan row 24b names the consumed branch's expected end state on a plain wallet with no credit — the
`none` stop — which is what that cell would assert once staged.
