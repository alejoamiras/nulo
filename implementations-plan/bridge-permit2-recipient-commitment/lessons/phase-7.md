# Phase 7 — candidate canaries → (held) promotion

Status: ◑ IN PROGRESS. Public + private canaries PASSED live on the candidate. Promotion HELD on the
user gate. Fuel/swap/relayer canaries pending a decision (real dust money + FJ each).

## Candidate under test (Phase 6 deploy)

Portal `0xbd07…bd8b`, L2 proxy `0x2da8…62dd` / token `0x2dcb…b31c` / bridge `0x0f13…e98e`, reusing live
AZLO `0x457f…d389`. Manifest: `apps/faucet/public/testnet-bridge.candidate.json` (`privateClaimMode: salt-v2`).

## Canary results (live testnet, real proofs, dust AZLO)

| # | Canary | Command | Result |
|---|---|---|---|
| 1 | public bridge → `claim_public` | `smoke-existing-testnet.ts --config <candidate>` | ✅ PASS (2.9m, 100 AZLO, `balance_of_public` verified) |
| 2 | **PRIVATE bridge → `claim_private`** (strand-risk gate) | `… --config <candidate> --private` | ✅ PASS (4.4m, `balance_of_private` verified — recipient-commitment works LIVE) |
| 3 | **redirect-proof** (wrong recipient can't consume) | `… --config <candidate> --redirect-proof` | ✅ PASS (binding held — see below) |
| 4 | fueled bridge (Permit2 `bridgeWithFuel` + self-paying claim) | `smoke-swap-existing-testnet.ts --config <candidate>` | ✅ PASS (3.5m, token 9.75 AZLO + FJ 331 — new portal + reused router) |
| 5 | fuel-testnet: PUBLIC + 3× PRIVATE FPC-fuel legs | `fuel-testnet.ts --config <candidate>` | ✅ PASS (14.2m, all SETTLED; the `tokenClaimSalt` fix let the private leg past the F2 guard) |
| 6 | fuel-only (`router.bridge` → FeeJuicePortal) | — | ⏭ COVERED, not scripted (see below) |

### Canary 5 note
`MIN_FUEL_FJ` calibration emitted `10.67 FJ` (4× worst `getFeeLimit`). The candidate carries `minFuelFj =
29.58 FJ` from the reused live config — conservatively HIGHER than needed, so safe (not blocking). Tune
down at leisure post-promotion if desired.

### Canary 6 (fuel-only) — treated as COVERED, deliberately not scripted
Fuel-only (part b) is `router.bridge(SimpleBridgeParams, PermitParams)` → FeeJuicePortal, `isPrivate`
always false (`useFuel.ts:154-159`). It runs entirely through the **reused router `0x4c3f…4068` + the
unchanged FeeJuicePortal** — neither touched by the candidate deploy. It is already fork-tested on REAL
Sepolia (`test_fuelOnly_realFeeJuicePortal`, 12/12 green: approve Permit2 → `router.bridge` → asserts FJ
pulled + no router residue) and will be exercised in the post-promotion UI canaries (step 8). Per the
project's testing philosophy (smallest set that proves it works, no redundant tests), a scripted live
fuel-only canary would only re-validate fork-tested + unchanged infra, so it was intentionally skipped.

## Candidate validation verdict

The recipient-commitment CORE (the actual change) is proven LIVE on the deployed candidate: public claim,
private claim (strand-risk gate), and redirect-proof (wrong recipient can't consume a synced message).
The fueled paths (parts a/b via the router + Permit2) are proven live (canary 4/5) or fork-tested
(fuel-only). **Candidate READY for promotion — held on the explicit user gate.**

### Canary 3 — the redirect-proof + a PXE gotcha

Design: deposit A + a sync SENTINEL B (both to R). Claim B → the network has synced past both (B is a
later leaf), so a wrong-recipient claim on the earlier A that reverts does so for the BINDING reason,
not because A isn't synced. Live evidence (leafA 7555072 < leafB 7556097): `sentinel B claimed → network
synced` then `wrong-recipient claim threw (expected)` — the binding held on a SYNCED message. Redirect
impossible on the deployed candidate.

**Gotcha (fixed):** the first version added a redundant "correct re-claim of A" as an authoritative
check. It WEDGED — re-simulating the SAME leaf in the SAME PXE session after a failed consume attempt
loops forever (repeated `claim_private` simulates, never completing; a local-PXE limitation, NOT
on-chain state — A was never consumed). Killed the run (the two signals above already prove the binding)
and removed the re-claim: a reverted `consume_l1_to_l2_message` never nullifies the message (protocol
invariant), so A stays claimable, and canary 2 already proves a correct private claim settles. **Lesson:
don't re-claim the same leaf in the same PXE session after a deliberately-failing claim on it.**

Canary 1 also confirmed the shared SponsoredFPC has FJ (post user top-up) + the candidate wiring is
sound. Canary 2 is the load-bearing one: the recipient-committed `claim_private` (deposit commits to
`H(deriveTokenClaimSecret(salt, recipient))`, circuit re-derives) settles + mints to the recipient on
the DEPLOYED candidate — not just the sandbox. The circuit artifact is byte-identical to Phase 2/4
(keystone-pinned), so the redirect-proof + relayer behavior is guaranteed identical; canary 2 proves the
deployment + live network handle it.

## Remaining canaries (pending)

- **3 — relayer redirect-proof** (`relay-claim-testnet.ts --wrong-recipient`, mode coded): submits
  `claim_private(WRONG, salt)` directly → MUST revert. Needs a descriptor-emitting private deposit
  (deposit + skip self-claim) to leave a message for the relayer. Security-critical but circuit-proven
  in Phase 4 (byte-identical artifact).
- **4-6 — swap public / fuel private / fuel-only**: exercise parts (a)/(b) — the fueled-bridge + fuel-only
  Permit2 paths (`smoke-swap-existing-testnet.ts`, `fuel-testnet.ts` private leg, fuel-only canaries).
  Separate from the recipient-commitment core.

## Promotion gotcha — `biome format` the manifest before committing

The deploy script writes the candidate manifest with `JSON.stringify(…, "\t")`, which **fails `biome
format`** — NOT over tabs (those match biome's `indentStyle: tab`) but because `JSON.stringify` always
multi-lines arrays while biome **inlines short ones** (e.g. `"constructorArgs": ["Aztec Nulo", "AZLO",
18, "0x…"]`). So a raw `cp candidate → testnet-bridge.json` + commit would **red the promotion's lint /
`audit:faucet` gate**. Promotion MUST run `bunx biome format --write apps/faucet/public/testnet-bridge.json`
after the `cp` (whitespace-only — the faucet parses the JSON identically). Surfaced by the 2026-07-06
classics audit. NOT worth changing `deploy-manifest.ts`: matching biome's array-inlining would mean
shelling `biome` into the crash-safe atomic-write path — the post-cp format step is the clean fix.

## Promotion — HELD

Per the standing user gate + the WIPE plan: promotion = `cp candidate → testnet-bridge.json` (carrying
`privateClaimMode: salt-v2`) + `audit:faucet` + ship faucet+code as ONE release. NOT run without an
explicit second go.
