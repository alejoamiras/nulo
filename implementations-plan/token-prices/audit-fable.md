# Fable audit — token-prices plan (Round 1, dual audit)

**Auditor:** fable-role Plan subagent (fresh context) · **Date:** 2026-07-21
**Input:** plan.md draft (incl. competing Outline B appendix)
**Verdict:** `conditional approve` — conditions 1–4 below. All adopted in the plan revision (see plan.md → Decision ledger).

---

## (a) Verdict

**Conditional approve** — with conditions:

1. **Fix the stale Testnet chainId (Critical, blocking as written).** The plan hardcodes Testnet chainId **4138294185** in both the Locked-decisions seed set and Fact 3. The actual code says **4229590296** (`packages/extension/src/wallet/services/network/service.ts:78`, comment "V5 testnet rollup version"). Git shows 4138294185 was the *pre-hard-fork* value, replaced in the "upgrade aztec to 5.0.0-rc.1 (protocol hard fork)" commit. As written, cUSD would silently never seed on Testnet and the price map would never match — with every validation gate green.
2. **Re-verify the cUSD seed address on live networks and add it to a validation gate.** The v8 migration doc block (`packages/extension/src/wallet/storage/migrate.ts`) states the hard fork *changed contract address derivation*. The seed decision shows every sign of being captured pre-fork. Phase 2's gate is unit-tests-with-mocks only — a wrong address ships 100% broken with all gates passing. Require a documented live check that `parseTokenInterface` succeeds at that address on real Testnet + Mainnet.
3. **Close the C3 mid-edit TOCTOU** — specify that submit sends the *displayed* derived token amount and the conversion quote is frozen while the input is focused.
4. **Surface the always-on fetch cadence and the host_permissions necessity as user Asks** before implementation.

## (b) Findings (ranked)

### Critical

- **C-1 · Stale Testnet chainId** (Locked decisions "Seed set"; Assumptions Fact 3). Plan: 4138294185. Code: 4229590296 (`network/service.ts:78`). Failure mode is *silent*: the seed entry keys to a chainId no network row will ever have, `findToken`/price-map lookups no-op, seeding retries forever, and nothing in any phase gate catches it. Also poisons the price map for Testnet cUSD.

### High

- **H-1 · Seed address likely pre-fork / unverifiable; Phase 2 has zero live verification.** The address appears nowhere in the repo; ARCHITECTURE §5 + `migrate.ts` v8 notes say address derivation changed in the same fork that rotated the chainId the plan got wrong. "Deterministic deployment → same address on both networks" is asserted, never verified.
- **H-2 · C3 quote-movement TOCTOU.** The staleness guard covers a *stale* quote, not a *moving* one. If a 3-min refresh lands mid-edit and the derived token amount silently re-derives, the number the user "visually confirms" can change between glance and click. Required spec: freeze the conversion quote per editing session; submit sends exactly the displayed token units; a mid-edit refresh updates only the secondary line. Also: the plan names `tokenAmountToUsd` but never the *inverse* (`usdToTokenAmount`) C3 actually needs — the precision-sensitive one (bigint, clamp to decimals) — unspecified.
- **H-3 · Seeding trusts the current RPC endpoint as a token-trust root.** `parseTokenInterface` pulls instance + artifact from the PXE/node (`token/service.ts:385-401`), and the default Mainnet RPC is third-party. A malicious/compromised endpoint controls the artifact, `FnImpl`s, and name/symbol/decimals — and unlike manual add or dApp `register_token` (preview popup), seeding is **silent, zero-interaction**. Mitigation: pin expected `currentContractClassId` (+ symbol/decimals) in `default-tokens.ts`; refuse to persist on mismatch.

### Medium

- **M-1 · `host_permissions` entry may be unnecessary — with an update cost.** CoinGecko serves `Access-Control-Allow-Origin: *` (verified live), so a CORS-mode SW fetch works with **no** manifest change. A new host on an installed extension can trigger a permission-warning upgrade (extension disabled pending re-approval). Try without; add only if actually blocked.
- **M-2 · Always-on price beacon.** 3-min alarms forever while the browser runs — even locked — is a persistent "this machine runs Nulo" beacon. Fix inside Outline A: alarm only while unlocked and/or popup-connect refresh + executor-time on-demand. Surface as an Ask.
- **M-3 · `popup/pages/tx/[id].vue:117-119` listed as a `feeToUsd` consumer in Fact 1 but missing from Phase 5 deliverables.** Removing `FEE_JUICE_USD_RATE` ripples there. Semantic wrinkle: pricing a *historical* fee at today's spot.
- **M-4 · Journal `origin` extension understated.** `OperationContext` is a closed zod'd union with origin-dependent invariants (`operation-journal/spec.ts`); `addToken` hardcodes the non-dapp subtitle. "Reuse with an origin distinguishing seed" is a type + schema + invariant change, not a label.
- **M-5 · Seeding preconditions unstated.** `addToken` → `fetchTokenMetadata` → account-contract derivation throws for unknown addresses; secret derivation throws when locked. Specify: first account on `(profileId, chainId)`, skip-not-fail when none.
- **M-6 · Seed-marker vs `purgeChain` interplay.** Delete + re-add a network → defaults permanently gone; profile deletion orphans the marker. Clear markers on chain purge + profile deletion.
- **M-7 · Cache validated only at fetch time; staleness needs a reactive clock.** (a) `chrome.storage.local` is writable from every extension context — validate at *read* time. (b) "older than 15 min" computed against `Date.now()` is not reactive in Vue — without `useTicker`, a stale fiat line stays rendered.
- **M-8 · "Sane magnitude cap" undefined and toothless for a $0.0147 token.** Define per-id sanity bands in `price-map.ts`.

### Low

- **L-1 · Use the `BrowserApi.alarms` port, not raw `chrome.alarms`** (repo pattern: `runtime.ts:147-160`, `chrome-browser-api.ts:185-195`).
- **L-2 · Partial "Account Value" aggregate** understates holdings when any token is unpriced — needs an affordance or it half-violates no-fake-numbers.
- **L-3 · CI-injected `VITE_COINGECKO_API_KEY` is baked into build artifacts** — "no key ships in releases" needs an enforcement note.

## (c) Assumption attack

**Facts:** 1,2,4,5,6,8,9 correct (4 incomplete: `addToken` account/unlock preconditions). **Fact 3 PARTIALLY FALSE** — Testnet chainId wrong (the plan's worst error; also baked into the user-locked seed set). Fact 7 nuance: `EntityStorage` drops invalid JSON per-row; `nulo:core:networks@` IS wiped on bumps while tokens survive — orphaned token rows across chain rotations are a pre-existing condition seeding adds to.

**Inferences:** CoinGecko `aztec` id — verified TRUE live (`{"aztec":{"usd":0.01469},"usd-coin":{"usd":0.999954}}`). `usd-coin` proxy acceptable for display; under C3 a depeg drifts typed-USD conversion — note in `≈` semantics. Rate limits plausible. **cUSD-address inference UNSAFE — promote to a hard verification gate.** Seeding-hook inference plausible but underspecified (that's where H-3/M-5/M-6 bugs get improvised). SW-side direct reads TRUE, with read-time validation.

**Asks:** Ask 1 acceptable only WITH the live preflight (reframe with the invisible-failure risk stated). Ask 2 fine. Ask 3 fine with `~`/`≈` signaling. **Missing Asks:** always-on beacon vs gated refresh (privacy posture — user's call); whether to add host_permissions at all; pin-and-verify vs trust-RPC for seeds.

## (d) Outline choice

**A, decisively — with two ideas stolen from B.** B's fatal flaw is D2 (popup-driven refresh guarantees stale fee quotes exactly during dApp flows). B's static `FnImpl` fixtures are empirically refuted by this repo's own V5-fork history. B's version bump + token wipe is gratuitous. Steal from B: the popup/unlock-gated traffic pattern, and keep-the-surface-small (add a dispatcher-absence test — the wallet-sdk background handler wires services explicitly, so not-exposed is the default).

Service shape (extension-layer `Service<Methods, Events>` + client + C1 `usePrices` composable) matches ARCHITECTURE §2/§3 and CLAUDE.md exactly. Lazy chain-metadata seeding right vs static records. Phase ordering sound; gates are real commands; the one structural hole is live-chain verification of seed constants.

### Critical files for implementation

- `packages/extension/src/wallet/services/network/service.ts` (authoritative chainIds)
- `packages/extension/src/wallet/services/token/service.ts` (seeding path: `addToken` preconditions, `parseTokenInterface` trust boundary, purge interplay)
- `packages/extension/src/utils/fee-estimation.ts` (D2: `FEE_JUICE_USD_RATE` removal ripple)
- `packages/extension/src/wallet/runtime.ts` (PriceService registration + alarms-port pattern)
- `packages/extension/src/components/composite/send/AmountCard.vue` (C3: quote-freeze + bigint inverse)
