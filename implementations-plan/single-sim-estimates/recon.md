# Recon — single-sim-estimates

Phase 0.4 recon, consolidated from three read-only passes against dev @ `204f2bf` (the merged fee-estimation-speedup stack). Parent plan + binding audit precedent: `implementations-plan/fee-estimation-speedup/` (its charter §"Follow-up charter" is literally this arc; its audit-fixed constraints are BINDING inputs here, not suggestions).

## Workstream A+B facts — fold + stub-gas ("B-lite")

### Post-merge strategy shapes (all file:line in `apps/extension/src/wallet/services/execution/`)

1. `FpcStrategy.buildAndEstimate` dispatches at `fpc-strategy.ts:73-83` via `isSponsoredFastPathEligible` (`:87-95`: `DefaultSponsoredFpc && isProtocol===true && no custom gas limits`). Sponsored fast path (`:97-134`): 1 build(EXTERNAL, payload pre-unshifted) + 1 **validated** sim + `finalizeGasLimits(node, txReq, sim, pad, baseFees)` — multiplier pre-baked, NO customLimits. Cross-chain row mismatch bails to two-pass (pinned: 3 builds/2 sims). Two-pass (`:136-184`): P1 build(PREEXISTING) + validated sim → maxFee → unshift payload → P2 build(EXTERNAL) with **gasSettings seeded from P1's sim** (`:163-168` — load-bearing: PrivateFPC's `pay_fee` reads the tx gas envelope) → validated sim → splice → finalize.
2. `fee-juice-strategy.ts:20-31` (`fj`): 1 build + 1 validated sim + finalize(customLimits, multiplier). `fee-juice-with-claim-strategy.ts:15-44` (`fjwc`): same, claim payload unshifted. `embedded-strategy.ts:19-54`: 1 build + cap + 1 validated sim, multiplier hardcoded 1.
3. Discovery pre-pass: `dapp-send-executor.ts` `estimateOperationFee` `:234-292` (always discovers for send-like ops; `preDiscoveryActions` snapshot at `:259` is the reuse-fingerprint normalization point) and `executeAztecSendTx` `:471-646` (consume-hit skips discovery+build entirely; miss re-discovers at `:577-594`). `AuthwitDiscoverer.discoverPrivateAuthwits` runs its own inline stubbed sim (`authwit-discoverer.ts:90-99`, `skipTxValidation:true`, hardcoded `PREEXISTING_FEE_JUICE` build at `:77`), bypassing `SimulateTxFn` entirely.
4. Dispatch seam: `service.ts` `buildAndEstimateTxRequest` `:864-895` — thin delegator; `gasPadding = op.fee?.gasPadding ?? 1.05` at `:881`; `FeeStrategyContext` `{op, feeSettings, feeMultiplier, gasPadding, parentTask, signal}`. No discovery hook — and the charter FIXES that: decorator owned by `dapp-send-executor`, **never** a `FeeStrategyContext` hook ("strategies stay payment-only").

### Stub mechanics (grounding for B-lite)

5. All sims already run kernel-less (`skipKernels:true` upstream default; Nulo forces it explicitly only when overrides present, `packages/aztec-runtime/src/pxe/service.ts:466-479`). Stub-vs-real differs ONLY in (a) the account contract swap, (b) validation.
6. **A stubbed sim cannot be validated**: upstream throws on `overrides.contracts` + `skipKernels:false` (`pxe.js:757-758`), and `node.isValidTx`'s `ContractInstanceTxValidator` would reject the substituted class — consistent with every stub call site in-repo setting `skipTxValidation:true` unconditionally. B-lite therefore always trades away estimate-time validation wherever it applies.
7. **Validation-loss is a UX cost, not only a security one**: today's validated strategy sim is where a missing/wrong authwit or invalid tx fails LOUDLY during "estimating fee"; stubbing moves that catch to post-proof `sendTx` (user pays a full prove before learning of failure). Must be weighed per-path in the plan's trade-offs.
8. `stubAccountAddresses` plumbing is fully wired end-to-end (`fee-strategy.ts:75-83` opts → `execution-coordinator.ts:92-112` third-arg forwarding → `ipxe.ts:44` → `client.ts:252-258` → `pxe/service.ts:436-486` `SimulationOverrides` from `@aztec/accounts/schnorr/stub`) — and used by ZERO strategies (prep from the prior arc, exactly as planned).

### Per-path B-lite reach verdicts (the scope-defining table)

| Path | Today | Achievable | Mechanism / blocker |
|---|---|---|---|
| Send `fj` | 1 | **no change** | Only+final sim; no discovery exists on the send path to fold; stubbing trades validation for nothing |
| Send Sponsored fast path | 1 | **no change** | Same; also payload-inclusive |
| Send PrivateFPC two-pass | 2 | **no change** | P1 seeds P2's envelope (contract-mandated); no discovery to fold; parent plan pinned "unchanged by design" |
| dApp discovery pre-pass | 1 of N | — | Already stubbed+unvalidated+app-only; its `gasUsed` is currently discarded (`dapp-send-executor.ts:549-570` stance comment) — this sim IS the fold source |
| dApp Sponsored | 2 | **1** | Fold discovery INTO the fast path's sim: one stubbed, `skipTxValidation`, payload-INCLUSIVE sim serving discovery + sizing. Safety justification is **contract identity**, not app-only: eligibility already pins the Noir-verified-inert canonical contract (`sponsor_unconditionally` reads nothing, emits nothing), so the F-1 malicious-FPC hazard cannot arise from this payload. NEW argument — needs hostile audit |
| dApp PrivateFPC / user-added | 3 | **2** | Fold discovery into P1 (both are app-only/`PREEXISTING_FEE_JUICE`-shaped; P1 becomes stubbed + `skipTxValidation` + effect-extracting, then seeds P2's envelope from stub gas — measurement-relevant!). **P2 stays real+validated+payload-inclusive forever**: reachable by arbitrary user-registered FPCs (`FpcService.addFpc`, ABI-shape check only) — stubbing it reopens the exact auto-sign hazard fable F-1/codex C2 blocked |
| embedded / NO_FROM | — | out of scope | Parent plan exclusion carries over; NO_FROM keeps its own inline discovery + unstubbed sizing sim (`dapp-send-executor.ts:730-771`) |

9. **PrivateFPC envelope-seed subtlety**: after the fold, P2's gas envelope is seeded from a STUBBED P1's `gasUsed`. If stub gas under-measures the app portion, `pay_fee`'s in-contract `max_gas_cost` derives from an under-sized envelope. This is precisely what the Testnet measurement must quantify on a private-transfer + authwit shape (existing datum: delta = 0, but n=1, public transfer + sponsor call only — `implementations-plan/fee-estimation-speedup/lessons/phase-6.md`).

### Gas-sizing helpers

10. Nulo's `finalizeGasLimits` (`fee-strategy.ts:158-203`): multiplicative pad (`gasUsed.totalGas.mul(gasPadding)`, default 1.05), **no network-limit clamp**. Upstream `getGasLimits`/`assertGasLimitsWithinNetworkLimits` (`@aztec/wallet-sdk/base-wallet/get_gas_limits`) — additive 0.1 pad + clamps to `MAX_TX_DA_GAS`/`MAX_PROCESSABLE_L2_GAS` — **confirmed unused anywhere in-repo**. Upstream `EmbeddedWallet` sizes from an UNSTUBBED `forEstimation` sim (its account is the real signer) — Nulo's B-lite additionally stubs, an extra fidelity gap upstream doesn't carry. Adopting stub gas without the clamp = thinner margin than either upstream posture; the plan should consider adopting the clamp alongside.
11. Reuse caches are **transparent to B-lite** (entries/fingerprints/ladders reference price + identity, never gas provenance — `operation-estimate-reuse.ts:52-77,117-178`). One trap: `stashOperationEstimate` reads fields off `FeeEstimate extends BuiltStandardTx` — any strategy restructuring must preserve that contract exactly or the stash breaks on a field rename.

### Pin churn (deliberate updates, never incidental)

12. `strategies-structural.test.ts` — every FPC describe block (`:161-341`) count/arg pins; new fixtures for folded sims. `dapp-send-executor.test.ts` — discovery-skip pin (`:296-312`), reuse block (`:560-657`, consume-hit/miss assert `discoverPrivateAuthwits` call counts directly — a decorator moves that assertion surface). `fee-structural-parity.test.ts` — only if `finalizeGasLimits` gains a stub-aware branch. Reuse tests — untouched unless the fold shifts the pre-discovery fingerprint normalization point (it must NOT).

## Workstream B facts — Testnet measurement

13. Canonical script pattern: `packages/bridge-core/scripts/*-testnet.ts` (14 files; run `bun scripts/<name>.ts`, no registration, no build). Default RPC `https://v5.testnet.rpc.aztec-labs.com` (`AZTEC_NODE_URL` overridable). Closest template: `drip-canary-testnet.ts` — fresh account → SponsoredFPC-paid deploy → dripper-funded tokens → real sponsored tx, **zero env/keys needed**.
14. **Everything needed is free on testnet**: canonical SponsoredFPC registered from `SPONSORED_FPC_SALT` (protocol constant, never deployed by us); **PrivateFPC also canonically deployed** (`PRIVATE_FPC_ADDRESS` pinned in `packages/bridge-core/src/private-fuel.ts:48`); faucet Dripper + NULO token live (`apps/faucet/src/contracts/deployments.json`, rebuild-and-assert pattern `drip-canary-testnet.ts:96-140`); `deriveNuloAccountKeys(Fr.random())` for Nulo-shaped identities.
15. Script architecture (proven pieces only): `EmbeddedWallet.create(NODE_URL, {ephemeral: true, pxeConfig: {proverEnabled: false}})` for simulate-only arms (fresh account ⇒ seconds of sync, zero disk, zero run-isolation surface); stub arm via `ContractFunctionInteraction.simulate({from, skipTxValidation, overrides: new SimulationOverrides({...StubSchnorrAccountContractArtifact...})})`; real arm plain `.simulate({from})` — **the real (validated) arm needs actual funded balance** (circuit balance asserts). Optional inclusion canary: recreate with `proverEnabled: true`, size `gasSettings` from stub gas, `.send()` sponsored, poll receipt (~minutes of real proving; retry-on-revert loops per `smoke-existing-testnet.ts:182-192`).
16. Representative shapes: private transfer `transfer_private_to_private` (call shape `tests/e2e/fixtures/aztec.ts:232-259` — sandbox file, call signature identical on testnet; do NOT import the fixture itself, it's sandbox-only); authwit grant/consume pair (`apps/playground/src/sections/authwit.ts:79-177` — the registry `grantPublicAuthwit` path is what `AuthwitDiscoverer` exercises); funding conversion `transfer_public_to_private` (`aztec.ts:316-338` shape).
17. Disposability: `*.local.ts` already gitignored; `ephemeral: true` leaves no disk footprint; outbound-HTTPS only (no ports/pkill concerns). Prior-arc convention: measurement instrumentation never committed.

## Workstream C facts — account-switch-isolation e2e (ROOT CAUSE FOUND during recon)

18. **Confirmed by dist forensics, not inference**: the local red is an UNARMED BUILD, not timing. The test hard-requires a proverless build — `IncomingPollGate` is compiled in only when BOTH `VITE_NULO_E2E_PROVERLESS=1` AND `VITE_NULO_E2E_PROVERLESS_CONFIRM=1` are set at build time (`apps/extension/src/e2e/config.ts:29-40`); `runtime.ts:240` injects the gate only under `E2E_PROVERLESS`. A bare `bun run e2e:agent <file>` takes `agent.sh`'s else-branch (`:73-84`), explicitly unsets the vars, builds an unarmed dist where `"discovery-held"` doesn't exist in the bundle (verified: grep of `dist/chrome` — no gate strings, no proverless stamp, migration-fixture stamp present proving the build ran through agent.sh unarmed). Gate hook = `undefined` → `waitIfArmed` no-ops → the scan commits immediately → the test's 40×(refresh+15×300ms) loop can never observe `discovery-held`. Deterministic on any machine; CI always sets `proverless: true` for the sharded job (`pr-network-e2e.yml:150-163` → `NULO_E2E_PROVERLESS: '1'`) AND `agent.sh:127-134` positively asserts the stamp — but ONLY when the flag was requested. Unrequested ⇒ silent unarmed build ⇒ silent 3-minute timeout.
19. The correct local invocation is `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts`; the test's own docstring (`:24-29`) says so, but `CLAUDE.md`'s generic e2e guidance doesn't, and nothing fails fast. Same silent-mismatch class as the backup-migration arming lesson (`implementations-plan/account-switch-isolation/lessons/phase-1.md:78-86`) — hit twice now.
20. The fix surface: a fail-fast arming preflight in the test (read a build stamp from the loaded extension, `expect` with a loud remedial message — the backup-migration `fixture-arming contract` test at `tests/e2e/backup-migration.test.ts:31-42` is the exact in-repo idiom to copy), + route the durable lesson to the `e2e-testing` skill per the CLAUDE.md skill-routing table, + optionally have `agent.sh` warn when running a file whose docstring demands proverless without the flag.

## Reuse-as-is

- `AuthwitDiscoverer`'s extraction chain (`collectOffchainEffects` → `CallAuthorizationRequest` → `computeAuthWitMessageHash` + live-chain assert) — verbatim, fed by whichever sim the decorator runs.
- `finalizeGasLimits`/`suggestGasLimits` (sizing-basis-agnostic); the full `stubAccountAddresses` plumbing; reuse caches + ladders (transparent); `strategies-structural`/`fee-structural-parity` pin idioms; `drip-canary-testnet.ts` + `SPONSORED_FPC_SALT` idiom + `deployments.json` rebuild-and-assert; `backup-migration.test.ts:31-42` arming-contract idiom.

## Adapt-with-changes

- `dapp-send-executor.ts`: extract both inline discovery call sites into `DiscoveryAwareEstimator` (owned here — charter-fixed boundary); preserve `preDiscoveryActions` as the fingerprint normalization point.
- `FpcStrategy` two-pass P1: becomes the folded sim (stub + `skipTxValidation` + effect extraction), still seeding P2's envelope; P2 untouched.
- `FpcStrategy` Sponsored fast path: fold to one stubbed payload-inclusive sim — **requires its own explicit safety justification** (contract identity), separate from the app-only rule.
- `SimulateTxFn` consumers: strategies start passing `stubAccountAddresses` where folded.
- `account-switch-isolation.test.ts` + `agent.sh`: arming preflight + guard.

## Collision risks

- **The single highest-severity risk**: any stub application reaching a payload-inclusive sim for a NON-canonical FPC reopens the audited auto-sign hazard. The Sponsored fold is safe only because eligibility pins the canonical contract — the plan must make that dependency explicit and test-pin it (adversarial-FPC fixture is a charter requirement).
- **Unmeasured generalization**: n=1 measured datum; extending to private/authwit shapes without the Testnet measurement repeats the exact "unproven pad" objection that killed outline B last arc. Owner's decision rule: auto-adopt if delta ≪ pad, else pause; measurements must be REAL against testnet.
- **Decorator boundary**: threading discovery through `FeeStrategyContext` would contradict negotiated audit terms.
- **Fingerprint normalization point must not move** (stash and consume hash the same pre-discovery set) — else every reuse consume silently misses.
- **`FeeEstimate extends BuiltStandardTx` field contract** must survive strategy restructuring byte-for-byte (stash reads it).
- Prior-arc residuals still open and NOT this arc's scope (unless trivially adjacent): offscreen job-ack, reuse hit-rate observability, transfer-cache chain-assert parity.

## Validation commands (per-phase gates draw from these)

`bun run lint` · `bun run typecheck:all` · `bun run test` · single file `bun run --cwd apps/extension vitest run <path>` · smoke `bun run test:e2e` (needs armed build for migration tests: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build && NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`) · network `bun run e2e:agent [file]` (proverless-gated files need `NULO_E2E_PROVERLESS=1`) · prover-ON canary pair `transfers.test.ts` + `tx-sendTx-default.test.ts` · `bun run audit:vue`.
