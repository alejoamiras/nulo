# Phase 3 — Quoter facade, real `swap` block, the seam-level cells

## What was done

- `contracts/bridge/evm/src/mocks/MockV4Quoter.sol` (`is IV4Quoter`): `quoteExactInputSingle` answers by normal return, `token→WETH` 1:1 and `native→FeeJuice` at `MockSwapTarget`'s live rate; pool keys outside the allow-list revert like a missing pool. `test/MockV4Quoter.t.sol` (9 cases: composition == settlement for dust and half-cap, both currency orderings, a rate change, the allow-list revert). `src/quoter-abi.test.ts` pins `QUOTER_ABI` to the compiled `IV4Quoter` artifact; the CI ABI-pins step runs it.
- `manifest.ts` writes the `swap` block (`poolManager` = the facade, `weth` = the sandbox's WETH stand-in, the sandbox tiers, the calibrated `fjPerTx`/`fjRegister`), explicit `rollupVersion`, and `permissionless-mint` token sources.
- `flows-matrix.ts`: the "I" cells the original battery never drove — held-public-FJ claim (5), fueled claim with credit held (14), private fuel on a registered and a first-time token (15/16), `minFuelFj` floor binding (17), gas-only private / swapped / WETH single hop (19–21), a send that consumes a DISCOVERED route (23), the Outbox refusing an unproven consume (32). `deploy.ts` marks every fixture token routable on the facade; the smoke runs all ten as "(i)" steps.

## Gate

- `forge test --no-match-contract Fork`: 149/149 (`forge-phase3.log`).
- `bun run --cwd packages/bridge-core test -- quoter-abi`: pass (with `out/` present).
- `bun run --cwd packages/bridge-core sandbox:smoke`: green on the eighth run — `✅ sandbox deploy + smoke OK (14.0m)`, exit 0, all 28 steps including the ten "(i)" cells — after five real defects in the new cells, each fixed on its own evidence (runs 6 and 7 were the Outbox cell's retry version and a half-applied edit):

| Step | Duration |
|---|---|
| (a) public deposit → claim_public | 20.7 s |
| (b) private deposit → claim_private | 22.2 s |
| (b) relayed private claim + wrong-recipient rejection | 23.3 s |
| (c) token+gas, self-paying claim | 21.0 s |
| (d) gas-only with the fee asset | 20.7 s |
| (d) private gas → one PrivateFPC credit note | 30.8 s |
| (e) public exit → L1 withdraw | 14.3 s |
| (e) private exit paid from one credit note → L1 withdraw | 12.3 s |
| (d) private gas → two more notes, none covering a ceiling | 51.7 s |
| (e) private exit paid across three credit notes → L1 withdraw | 12.3 s |
| (f1) relayer registers before the depositor claims | 29.7 s |
| (f2) two concurrent first-time deposits | 31.3 s |
| (f3) portal-only token registers on its first claim | 25.7 s |
| (f4) routeless token refused before signing | 0.0 s |
| (g) rejected registration × sponsored / fee-juice-with-claim / private FPC | 22.4 / 25.7 / 26.4 s |
| (h) guardian pause blocks exits, not claims | 37.0 s |
| (i) token-only claim paid from held public Fee Juice | 41.5 s |
| (i) discovered route → send → self-paying claim | 24.5 s |
| (i) fueled public claim leaves private credit untouched | 50.9 s |
| (i) token+gas private, registered token | 30.5 s |
| (i) token+gas private, first-time token | 32.4 s |
| (i) floor above the venue's output refused | 0.0 s |
| (i) gas only, private credit | 30.6 s |
| (i) gas only, swapped token | 24.7 s |
| (i) gas only, WETH single hop | 24.8 s |
| (i) outbox refuses an unproven exit, then consumes | 42.5 s |
| boot + deploy | ≈2 min |

The defects, in the order they surfaced:

| Run | Failing cell | Cause | Fix |
|---|---|---|---|
| 1 | (i) token+gas private, first-time | `balance_of_private` read on a token whose instance is deployed BY the registration ("Not initialized"); the private first claim is two transactions (`register,claim`), not `register+claim` | read the balance only on a registered token; pass `registeredClaimFee` (the app's split: the registration spends the fuel through `mint_and_pay_fee`, the claim pays from the credit it left); expect `register,claim` |
| 2 | (i) gas only, WETH single hop | the venue sells one UNIT of anything for `MOCK_RATE_NUM` FJ-wei, decimals ignored — 2 WETH quoted 2e30 FJ-wei, more than the venue holds (`ERC20InsufficientBalance`, selector `0xe450d38c`) | size the 18-decimal input in units (2e6 wei → 2 FJ) |
| 3 | (i) outbox refuses an unproven exit | `computeL2ToL1MembershipWitness` computes the witness from the node's checkpoint data and returns one BEFORE the Outbox holds the epoch's root — a witness is not a proof-status oracle | the negative is the portal `withdraw` simulation reverting (the call `consumeWithdrawal` makes) |
| 5–7 | (i) outbox refuses an unproven exit | the automine local network proves a block the moment it is proposed: in every run the exit read `proven` at the first receipt read, three exits in a row included — there is no unproven window to observe | the flow asserts the refusal whenever an exit IS caught unproven, always asserts not-consumed-before and the consume after finalization, and reports which case it hit; whether a conditional negative is acceptable is put to the arc-2 codex review |
| 4 | boot (parallel with the integration suite) | the Node scripting wallet's PXE store lives in the cwd-relative `aztec-wallet-data/`, keyed by `l1ChainId + rollupAddress` — IDENTICAL for every fresh local network — so two sandboxes at once (and every run after a previous one) shared one LMDB store: "Block hash mismatch … Pruning data after block 4 due to reorg", then "Reference block not found" | `createL2Wallet({ ephemeral: true })` for the sandbox: the store is per process and gone with it (`script-bootstrap.ts`, `l2.ts`) |

## Findings worth keeping

- `aztec start --local-network` spawns an internal anvil on 8545 even when `--l1-rpc-urls` names another; with 8545 taken it logs `Address already in use` and carries on with the configured L1. Harmless, but a second sandbox on one host always logs it.
- The hub's private first claim is `register,claim` — two transactions — and `sendOpts.registeredClaimFee` is what stops the claim from re-spending the fuel message. The harness `ClaimPlan` now carries it.
- A negative Outbox check must use the L1 contract's own judgement; the SDK's witness helper is optimistic by design.
