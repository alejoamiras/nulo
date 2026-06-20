# No-fuel claim fee source — pay from public OR private Fee Juice

**Tier:** `/blueprint light` · **Status:** draft (pre-approval; revised after codex round-1 reject) · **Scope:** faucet no-fuel bridge claim (+ its bridge-core fee-payment primitives) · **Network:** testnet only.

## Summary

The private fueled bridge now works: a from-scratch wallet bridges + fuels privately and the claim self-pays on V5 (proven 3× via `fuel-testnet.ts` and once live in the UI). That claim credits the Fee-Juice remainder as a **private** balance held at the Wonderland PrivateFPC (read via `PrivateFPC.balance_of`, shown as "private FJ" in the wallet's GasBalanceCard).

But you can't yet **spend** that earned private gas on a later **no-fuel** bridge (the "arrive with gas" toggle OFF). The faucet's no-fuel path blocks on a **public-FJ-only** pre-flight cold-check (`useDeposit.ts:393` `readPublicFeeJuiceBalance === 0n`) **before the wallet ever opens** — so the user never reaches the wallet's fee picker, which *already* supports paying from private FJ (`FeeSettingsCard.vue` offers "Private Fee Juice"; the wallet's `FpcStrategy.pay_fee` path is exercised by `fee-methods.test.ts:154`).

**The fix (corrected after codex round-1):**
- **Private FJ covers the claim → the faucet deterministically supplies `FPCFeePaymentMethod` + explicit, binding gas settings** (feePayer = FPC → the extension's embedded path; mirrors the existing private fuel claim's fee-settings shape). This is the controllable, self-pay-consistent, private-first path.
- **Else public FJ covers → unblock and defer to the wallet's fee picker** (the extension has **no** dApp-supplied "pay from my public FJ" discriminator — only `"fjwc"|"fpc"`; the wallet's tested picker owns public-FJ / sponsored selection).
- **Else → block**, distinguishing "no balance in either" (clear shortfall message) from "couldn't read a balance" (**fail-closed**: retry message, never a false "no gas").

## Current behavior (the gap)

- `useDeposit.ts:386–405` — no-fuel branch: `fee = undefined`, and the cold-check **stops** the claim iff `readPublicFeeJuiceBalance === 0n`. Private FJ is never read; a private-FJ-only account is wrongly blocked before reaching the wallet.
- `useDeposit.ts:520` — the standalone no-fuel path has the same public-only gate.
- `capabilities.ts buildCombinedManifest` — scopes `PrivateFPC.mint_and_pay_fee` + `FeeJuice.balance_of_public`, but **not** `PrivateFPC.balance_of` (read private FJ) nor `PrivateFPC.pay_fee` (so the wallet can't execute *any* private-FJ payment — faucet-supplied OR user-picked — under the faucet's app grant).

## Goal & success criteria

A no-fuel bridge claim is **not** blocked when the account holds enough Fee Juice in **either** balance, and it pays from that balance on V5:

1. **Private FJ ≥ reserved cost** → the claim is sent with `FPCFeePaymentMethod(privateFpcAddr)` + explicit gas settings the gate computed against (private-first, deterministic, **binding**).
2. **Private insufficient, public FJ ≥ reserved cost** → the claim is **unblocked + wallet-chosen** — i.e. the wallet's fee picker handles payment (user selects Public Fee Juice; the wallet owns the gas settings). This is explicitly **NOT** "guaranteed public self-pay" (codex round-2 condition 2): the extension exposes no dApp-supplied public-FJ method, so the faucet only stops blocking and lets the wallet decide. The default in that picker is Sponsored unless the user picks Public Fee Juice (or has a saved preference).
3. **A required balance read fails** → blocked with a **retry** message (fail-closed), never a false "no gas".
4. **Both known-zero / neither covers** → blocked with a message naming both balances + the shortfall.
5. The source decision is a **pure, unit-tested** function (mirrors `decideFuelClaim`), with explicit `bigint | null` inputs (null = unreadable).
6. **Live proof:** a `fuel-testnet.ts` variant shows earned private FJ paying a subsequent no-fuel claim end-to-end on V5; an automated dApp-supplied-`FPCFeePaymentMethod` e2e (skipIf, suite-consistent) asserts the wiring.

## Scope

**In scope**
- `packages/faucet` — the no-fuel fee-source selection (`useDeposit.ts` both gates), the manifest scope additions (`capabilities.ts`), a fail-closed private-FJ reader, the pure decision function + unit tests.
- `packages/bridge-core` — the fee-payment **primitive** the faucet consumes: a `privateFeeJuicePayment` wrapper (`FPCFeePaymentMethod`) + `PrivateFPCContractArtifact` / `maxGasCostFor` re-exports, beside the existing `privateMintAndPayFee` / `predictedWorstMinFees` / `publicFeeJuicePayment`. **bridge-core already owns every Wonderland fee-payment wrapper — this is the faucet flow's home, not the wallet's general send path.**
- `packages/bridge-core/scripts/fuel-testnet.ts` — a no-fuel-spend variant (live primitive proof).
- `packages/extension/tests/e2e/network/` — ONE `skipIf` test (suite-consistent) asserting a dApp-supplied `FPCFeePaymentMethod` routes through `pay_fee`. (Validation only — no wallet behavior change.)

**Out of scope (explicit)**
- **The extension wallet's general send** paying arbitrary txs from private FJ via a *faucet-style* supplied method — the wallet already has its own picker path; we don't touch it.
- A faucet-supplied **public-FJ** payment method (the extension exposes no such dApp discriminator; public defers to the wallet's picker by design).
- The fuel (gas-follows-token) claim path, `minFuelFj` calibration, the `private-fuel-fee-fix` Phase-1 wallet branch. Untouched.

## Assumptions

### Facts (verified)
1. `FPCFeePaymentMethod(fpcAddress)` (`@wonderland/aztec-fee-payment`, `fee-payment-methods/shared.d.ts`): implements `FeePaymentMethod`, `getFeePayer()` → the FPC, "Deducts max gas cost from the sender's internal balance. **Does not refund unused gas.**"
2. `maxGasCostFor(gasSettings)` (`@wonderland/aztec-fee-payment` utils) = `gasLimits · maxFeesPerGas`, the quantity `pay_fee` asserts against — **but it equals the claim's actual reserved cost ONLY if the same `gasSettings` are committed on send** (see Fact 9; the private branch enforces this by passing them explicitly).
3. `PrivateFPCContractArtifact` is exported from the package index, so bridge-core can build a `balance_of` read.
4. The no-fuel branches gate only on public FJ: `useDeposit.ts:393` + `:520` (`readPublicFeeJuiceBalance === 0n`); `:404` `fee = undefined`.
5. `buildCombinedManifest` (`capabilities.ts:208–290`) scopes `PrivateFPC.mint_and_pay_fee` (`:258`,`:273`) + `FeeJuice.balance_of_public` (`:260`) but **not** `PrivateFPC.balance_of` or `PrivateFPC.pay_fee`.
6. The PrivateFPC stays OUT of manifest `contracts` (auto-registered by the wallet's `fpc/service.ts`); only its *calls* are scoped — the `mint_and_pay_fee` precedent shows a call to the auto-registered FPC works without `contracts` membership.
7. bridge-core's Wonderland coupling lives in `packages/bridge-core/src/private-fuel.ts`; `fuel-testnet.ts:211` `runVariant(isPrivate, nonce, fuelViaPrivateFpc)` parametrizes the private-FPC path; re-prices per attempt (`buildClaimFee()`, `:269`).
8. The wallet's `gas-balance-reader.ts:107` reads private FJ via `PrivateFPC.balance_of`.
9. **(verified, artifact `private_contract-PrivateFPC.json`)** `PrivateFPC.balance_of(account)` is `is_unconstrained: true` / `abi_utility` → `#[external("utility")]` → **`simulation.utilities.scope`** (like the token `balance_of_private` at `capabilities.ts:230–233`). `PrivateFPC.pay_fee(inputs)` is `abi_private` — identical class to the already-dual-scoped `mint_and_pay_fee` → **`simulation.transactions.scope` + `transaction.scope`**.
10. **(verified)** `FPCFeePaymentMethod` emits exactly one private setup call (`pay_fee`); no extra `exec.calls` entry needs scoping (codex confirmed; recursive-subtract is an internal self-call). It crosses the faucet → extension-wallet RPC as an `ExecutionPayload` with `feePayer = FPC`, exactly like the working `PrivateMintAndPayFeePaymentMethod`; the extension classifies "embedded FPC" by `feePayer !== from`.
11. **(verified)** The extension's embedded-FPC cap reuses a **supplied** `maxFeesPerGas` and only falls back to `getCurrentMinFees()` when none is supplied (`embedded-fpc-cap.ts:73`); finalization reuses the committed cap for embedded payments (`fee-strategy.ts:162`). ⇒ supplying explicit gas settings makes the gate binding.
12. **(verified)** The extension's dApp-supplied fee surface has discriminators `"fjwc" | "fpc"` only (`wallet-bridge/src/operation.ts:60`); there is **no** "pay from existing public FJ" dApp method. Public-FJ self-pay is the wallet picker's job (`FeeSettingsCard.vue`), shown for no-`feePayer` dApp sends (`execute/index.vue:230`, gated by `requiresFeeSelection`).

### Inferences (unverified — attack these)
- **I3.** The pre-flight `max_gas_cost` for the private branch, computed as `maxGasCostFor({ gasLimits: from the FPC-attached claim simulate's `gasUsed` (includeMetadata, with `privateFeeJuicePayment` attached — condition 1) + padding, teardownGasLimits: 0, maxFeesPerGas: predictedWorstMinFees(node).mul(1.5) })` and then **committed verbatim on send**, is a true binding bound: a passing gate ⇒ the FPC `pay_fee` assert (`balance ≥ gasLimits·maxFeesPerGas`) holds at inclusion. Validated by the live Phase-3 proof. *(Replaces the rejected `minFuelFj/FUEL_FEE_MARGIN` static reference, which was calibrated for `mint_and_pay_fee` and ignores current state.)*

### Asks (surfaced — none silent)
- **A1 (confirm at gate).** Private-first means **no gas refund**: `FPCFeePaymentMethod` doesn't refund unused gas, so each private-paid no-fuel claim costs the **full reserved `max_gas_cost`** (≈ `1.5 × actual`, the inclusion-safety pad, with no change returned). Public FJ would refund — but the faucet can't deterministically force public self-pay (Fact 12), so the trade is really "deterministic private self-pay (overpay, private)" vs "defer to the wallet picker (you choose, may pick sponsored)". You chose private-first; this confirms the cost. Flip to "always defer to the wallet picker" if you'd rather choose per-claim.

## Security & Adversarial Considerations

- **New spend authority (codex-flagged, accepted + mitigated).** Adding `PrivateFPC.pay_fee` to the faucet's `transaction.scope` grants the faucet origin the ability to spend the user's private FJ. Combined with no-refunds, a compromised/XSS'd faucet frontend could attempt to drain private FJ via reverting embedded-fee txs. **Mitigations:** (a) every claim is an `aztec_sendTx` the user **approves in the wallet** (the execute window shows the tx + fee payer) — no silent spend; (b) the scope is two **named** functions on the **pinned** `PRIVATE_FPC_L2` address, no wildcard; (c) the **binding, fail-closed** pre-flight gate minimizes reverting-tx attempts; (d) **testnet only**. Residual risk documented; acceptable for testnet, re-evaluate before any mainnet exposure (→ `/harden security` candidate then).
- **Least privilege.** `balance_of` is simulation-only (read). `pay_fee` is the minimum needed for the feature. FPC stays out of `contracts`.
- **Input validation / fail-closed.** Balances are `bigint | null` (null = read threw). A failed read never fabricates spendable balance NOR a false "no gas" — it yields a distinct "couldn't verify, retry" stop. Comparison is `>=` on bigints.
- **Privacy.** Paying via the FPC makes the fee payer the FPC, not a public-balance debit — strictly more private. The FPC already knows the user's internal balance (it minted it); no new leak.
- **Smart-contract risks (Aztec).** Replay/reorg of the claim unchanged (leaf-index-bound message consumption); the fee source doesn't alter it. No new front-running surface (user's own tx).
- **Supply chain.** No new deps — all exports of the already-pinned `@wonderland/aztec-fee-payment`.

## Phases

### Phase 1 — bridge-core fee-payment primitive ✓

**Done.** `privateFeeJuicePayment` + `maxGasCostFor` re-export (`fee-juice.ts`) + `PrivateFPCContractArtifact` re-export (isolated `artifacts.ts` entry, code-split) + 2 unit tests (single `pay_fee` call pin; `maxGasCostFor` arg-order pin). Gate green: typecheck clean · bridge-core 116 tests pass · `bun run lint` exit 0 (my files clean). `LESSONS_FILE=implementations-plan/no-fuel-claim-fee-source/lessons/phase-1.md`

In `packages/bridge-core/src/private-fuel.ts` (beside `privateMintAndPayFee`):
- `privateFeeJuicePayment(fpcAddress: AztecAddress): FPCFeePaymentMethod` — wrapper `new FPCFeePaymentMethod(fpcAddress)`; TSDoc states the **no-refund** property.
- Re-export `PrivateFPCContractArtifact` + `maxGasCostFor` so the faucet builds the `balance_of` read + the binding gate without importing `@wonderland/*` directly (coupling stays in bridge-core).

Unit tests (`private-fuel.test.ts`): `privateFeeJuicePayment(addr).getFeePayer()` resolves to `addr`; re-exports defined. (Thin — the heavy proof is Phase 3.)

**Validation gate**
- Commands: `bun run --cwd packages/bridge-core typecheck && bun run --cwd packages/bridge-core test && bun run lint`
- Pass: typecheck exit 0; bridge-core vitest green (incl. new cases); biome exit 0.
- Layers: typecheck · lint · unit.

### Phase 2 — faucet no-fuel fee-source selection

1. **Pure decision function** — `decideNoFuelFeeSource` in `packages/faucet/src/lib/fuel-claim-state.ts`:
   ```
   decideNoFuelFeeSource({ publicFeeJuice, privateFeeJuice, maxGasCost }:
     { publicFeeJuice: bigint | null; privateFeeJuice: bigint | null; maxGasCost: bigint })
     → { source: "private" } | { source: "public" } | { source: "unverifiable" } | { source: "none"; shortfall: bigint }
   ```
   private-first: `privateFeeJuice != null && privateFeeJuice >= maxGasCost` → `private`; else `publicFeeJuice != null && publicFeeJuice >= maxGasCost` → `public`; else if either input is `null` (a read failed and no known balance covers) → `unverifiable` (**fail-closed**); else `none` with `shortfall = maxGasCost - max(publicFeeJuice ?? 0, privateFeeJuice ?? 0)`.
2. **Fail-closed private-FJ reader** — `readPrivateFeeJuiceBalance(aztec, recipient): Promise<bigint>` in `useDeposit.ts` mirroring `readPublicFeeJuiceBalance`, using `PrivateFPCContractArtifact` + `PRIVATE_FPC_ADDRESS` (via bridge-core) + `readBalance` → `balance_of`. The **caller** maps a throw to `null` (not `0n`) so the decision can fail closed; `readPublicFeeJuiceBalance` callers do the same at these sites.
3. **Binding gas estimate (codex round-2 condition 1)** — simulate the **private-candidate** claim **with `privateFeeJuicePayment(fpcAddr)` attached** and `includeMetadata: true` (mirroring the existing private-claim shape at `useDeposit.ts:303–313`), so `gasUsed` includes the **`PrivateFPC.pay_fee` setup-call overhead** — a *bare* claim simulate under-budgets (`fpc-strategy.ts` adds FPC gas overhead explicitly). From that: `gasLimits` = `gasUsed` + padding; `maxFeesPerGas = (await predictedWorstMinFees(node)).mul(1.5)`; `teardownGasLimits = 0` → `gasSettings`; `maxGasCost = maxGasCostFor(gasSettings)`. This single (FPC-attached) estimate is the **binding** bound for the private branch (committed verbatim on send) and a **conservative** gate heuristic for the public branch (the wallet re-estimates there; an over-estimate never under-gates).
4. **Wire both no-fuel branches** (`useDeposit.ts:386–405` and `:520`): read both balances (→ `bigint | null`), compute `maxGasCost`, call `decideNoFuelFeeSource`:
   - `private` → `fee = { paymentMethod: privateFeeJuicePayment(privateFpcAddr), gasSettings }` (the **same** `gasSettings` the gate used → binding per Fact 11).
   - `public` → `fee = undefined` (defer to the wallet picker; Fact 12). Unblock.
   - `unverifiable` → `stop("Couldn't check your Fee Juice balance — please try again.")`.
   - `none` → `stop("No Fee Juice to claim this no-fuel bridge (public <X>, private <Y>; need ~<Z>). Enable 'arrive with gas', or fund your account.")`.
5. **Manifest** (`capabilities.ts buildCombinedManifest`): add `{ contract: PRIVATE_FPC_L2, function: "balance_of" }` to **`simulation.utilities.scope`** (Fact 9) and `{ contract: PRIVATE_FPC_L2, function: "pay_fee" }` to BOTH `simulation.transactions.scope` and `transaction.scope` (Fact 9). Update the scoping comment block. **Add `capabilities.test.ts` assertions** that both entries are present in the correct buckets.

Unit tests (`fuel-claim-state.test.ts`, ≥7): `decideNoFuelFeeSource` — private-only→private; public-only→public; both-cover→private; exact-boundary (`balance === maxGasCost`→covers); neither→none+shortfall; private-read-null + public-covers→public; private-read-null + public-zero→unverifiable; both-null→unverifiable.

**Validation gate**
- Commands: `bun run --cwd packages/faucet typecheck && bun run --cwd packages/faucet test && bun run lint`
- Pass: `vue-tsc --noEmit` exit 0; faucet vitest green incl. the new `decideNoFuelFeeSource` (≥7) + `capabilities.test.ts` manifest cases; biome exit 0.
- Layers: typecheck · lint · unit.

### Phase 3 — live primitive proof + wiring assertion

1. **fuel-testnet variant** (env-gated, e.g. `NOFUEL_SPEND_RUNS`): private-FPC fuel claim → `readPrivateFeeJuiceBalance` asserts `B > 0` → a **no-fuel** claim paid via `new FPCFeePaymentMethod(fpcAddr)` + explicit binding gas settings, re-priced per attempt → asserts settlement + `B` decreased. Proves the primitive (earned private FJ pays a no-fuel claim, with repricing, on real V5).
2. **Automated wiring assertion** — add ONE `test.skipIf(!hasConfig)` test under `packages/extension/tests/e2e/network/` (pattern from `tx-sendTx-feePayer.test.ts`) asserting a **dApp-supplied** `FPCFeePaymentMethod` send routes through `PrivateFPC.pay_fee` and settles. **Not a hard CI gate** — it joins a suite with known-skipped fee clusters (`fee-methods.test.ts` cluster A+B, `network-test-triage`); it documents + checks the wiring without over-committing to a flaky gate. The faucet→wallet path also remains manually validated (the user has already run the private claim live).

**Validation gate**
- Commands: `PRIVATE_KEY=<testnet> NOFUEL_SPEND_RUNS=1 bun run packages/bridge-core/scripts/fuel-testnet.ts` (uses the V5 `AZTEC_NODE_URL` default) — plus the Phase-2 faucet gate green; the new e2e present + green when run with config (skipIf otherwise).
- Pass: the variant prints settlement (✅) for a no-fuel claim paid from private FJ + the FPC `balance_of` decreased; no inclusion-reject.
- Layers: typecheck · lint · unit · **e2e-live-network (testnet)**.

## Open questions

- **A1 (no-refund / private-first).** Confirm at the gate. Implemented private-first-deterministic; the alternative is "always defer to the wallet picker" (per-claim choice, may pick sponsored).
- **I3 (binding estimate).** Resolved in Phase 2 via the simulate-derived gas settings committed verbatim; the live Phase-3 proof is the backstop.

## Decision log (light)

- **Private deterministic (faucet-supplied FPC) + public deferred (wallet picker)** — forced by Fact 12 (no dApp public-FJ method) + codex round-1 (a bare `fee=undefined` is non-binding and auto-defaults to sponsored). Honors private-first; doesn't fake a binding public path. *(Rejected: faucet-supplied public-FJ method — doesn't exist in the extension surface.)*
- **Binding gate via committed gas settings** (codex round-1) over a static calibrated reference — the gate's `maxGasCost` equals what `pay_fee` asserts only because the same settings are sent (Fact 11). *(Rejected: `minFuelFj/FUEL_FEE_MARGIN` — calibrated for the wrong call, state-blind.)*
- **Fail-closed `bigint | null` reads** (codex round-1) over treating errors as `0n` — a transient read error must not silently downgrade or false-"no gas".
- **Primitives in bridge-core** — single-responsibility; bridge-core owns the Wonderland coupling.
- **Phase-3: primitive proof hard + skipIf wiring e2e soft** (partial codex adoption) — an automated dApp-FPC e2e is valuable but lands in a known-flaky suite; assert it, don't hard-gate a `light` fix on it.

## Audit verdicts (codex, session 019ee70a)

- **Round 1: `reject`** — 3 blockers, all verified against the code: (1) `fee = undefined` auto-defaults to Sponsored, not public self-pay; (2) the gate was non-binding (only `paymentMethod` set, not committed gas settings); (3) read-failure-as-`0n` silently downgrades / false "no gas". Plus: no-refund must be surfaced (not a footnote), manifest needs `capabilities.test.ts` coverage, Phase-3 should add an automated wiring proof.
- **Round 2 (resumed, on the revised plan): `conditional approve`** — conditions, both folded in:
  1. **Gas estimate must simulate WITH the tentative `FPCFeePaymentMethod` attached** (not a bare claim) so `gasUsed` includes the `pay_fee` setup overhead → folded into Phase 2 step 3 + I3.
  2. **Criterion 2 must read "public = unblocked + wallet-chosen," not "guaranteed public self-pay"** → folded into success criterion 2 + the decision log + the ELI5 copy.
  - Codex confirmed: the private-deterministic / public-deferred split resolves blocker 1; the binding gate holds (no wallet override of supplied `gasLimits`/`maxFeesPerGas` for embedded payments — `embedded-fpc-cap.ts` + `fee-strategy.ts`); the Phase-3 `skipIf`-not-hard-gate pushback is defensible for a `light` fix; no new blockers beyond condition 1.

## Seeds

See `eli5.html` for the recommended `/goal` and `/loop` seeds (finalized after approval).
