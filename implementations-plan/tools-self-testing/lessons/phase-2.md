# Phase 2 — Extract the harness; vendor canonical bytecode; make flows stateless; measure

## What was done

- `packages/bridge-core/scripts/sandbox/`: `constants`, `l1`, `l2` (actors: Nulo-shape Schnorr, sponsor-deployed, `newActor`-style secrets), `manifest`, `handle` (JSON-only + zod + `openSandbox`), `context` (per-actor `SmokeContext` carrying fee samples, the `CreditInventory`, exit-gas samples), `flows` (the 17 flows as pure functions; `optionalFlow` removed — the PrivateFPC-paid registration is a normal step), `smoke` (the battery, timed), `deploy`, `forge` (builds `out/` on demand with the toolchain's forge), `cli` (`run | up | smoke`), `index`. `deploy-sandbox.ts` is a two-line alias. Exposed as `@nulo/bridge-core/sandbox`.
- `bytecode/{permit2,multicall3}.json` vendored; `refresh-canonical-bytecode.ts` pins by keccak across ≥2 agreeing providers per chain. **Permit2's runtime code differs per chain** (immutables bake the chain id + EIP-712 domain separator; it recomputes when `block.chainid` differs), so only Multicall3 gets the cross-chain equality check; Permit2 is pinned to the Sepolia deployment the sandbox always used.
- `local-network.ts`: `--disable-admin-api-key` dropped (nothing in the harness uses the admin port); listening sockets logged at ready. The node listens on `*:` for its RPC and P2P ports (no host option in 5.2.0); anvil on `127.0.0.1` only. Recorded in the plan's Security section.
- `tsconfig.scripts.json` includes `test/**`; the unit `vitest.config.ts` excludes `test/integration/**`.

## Gate

- `bun run --cwd packages/bridge-core typecheck` → clean; `biome check` → clean; `bun run --cwd packages/bridge-core test` → 436 pass (46 files), later 444 with the quoter pin.
- `bun run --cwd packages/bridge-core sandbox:smoke` → `✅ sandbox deploy + smoke OK (9.1m)`, no `SEPOLIA_RPC_URL` fetch (both singletons installed from the vendored code), listeners logged:
  `local network ready — listening on 127.0.0.1:<anvil> *:<p2p> *:<node>`.

## Durations (the first measurement; boot + generation + tokens ≈ 1.2 min, then the flows)

```
(a) public deposit → claim_public                                 20.6 s
(b) private deposit → claim_private                               22.0 s
(b) relayed private claim + wrong-recipient rejection             22.3 s
(c) token+gas, self-paying claim                                  20.6 s
(d) gas-only with the fee asset                                   20.6 s
(d) private gas → one PrivateFPC credit note                      30.7 s
(e) public exit → L1 withdraw                                     13.9 s
(e) private exit paid from one credit note → L1 withdraw          11.8 s
(d) private gas → two more notes, none covering a ceiling         50.9 s
(e) private exit paid across three credit notes → L1 withdraw     12.1 s
(f1) relayer registers before the depositor claims                29.2 s
(f2) two concurrent first-time deposits                           26.5 s
(f3) portal-only token registers on its first claim               22.5 s
(f4) routeless token refused before signing                        0.0 s
(g) rejected registration, sponsored FPC                          36.4 s
(g) rejected registration, fee-juice-with-claim                   30.2 s
(g) rejected registration, private FPC                            27.7 s
(h) guardian pause blocks exits, not claims                       33.5 s
```

Calibration this run printed: `fjPerTx=18…`/`fjRegister` from 3 paid claims; private exit billed l2Gas 826,543 (one note) / 888,143 (three notes). A fresh actor (sponsor-deployed Schnorr account) costs ~10 s; the integration suite budgets one per test.

## Findings

- The mint cap on `MintableERC20` (`maxWholePerTx`) also bounds fixture minting; the forge test for the facade constructs its tokens with a 1e15 cap.
- `vitest`'s `provide()` needs JSON: the handle carries hex strings only; `openSandbox` rebuilds clients.
