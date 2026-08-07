# Plan — fee-estimation-speedup

- **Status**: REVISION 2 (post dual audit) — pending final fresh-context codex pass + approval gate
- **Tier**: `/blueprint mid` (rubric: blast radius HIGH — every tx's fee sizing; novelty LOW; irreversibility LOW; migration NONE; external coupling LOW — pinned 5.0.1; security MEDIUM — authwit derivation is an authorization surface)
- **eli5_mode**: artifact
- **Recon**: [recon.md](recon.md) · **Audits**: [audit-codex.md](audit-codex.md) (r1: reject — both blockers verified and folded in) · [audit-fable.md](audit-fable.md) (r1: conditional approve — all 4 conditions folded in)

## Revision 2 — what changed and why

The dual audit invalidated two pillars of the r1 draft; both auditors' findings were re-verified against source before adoption:

1. **The FPC one-pass collapse is now canonical-Sponsored-only** (codex, blocking). PrivateFPC's Noir contract reads the tx's gas-settings envelope (`get_max_gas_cost` in `@alejoamiras/private-fee-juice`) inside `pay_fee` — Pass 1's real job is installing a *bounded* envelope before the FPC call simulates, not seeding gas numbers. PrivateFPC and user-added FPCs keep the two-pass. Canonical `SponsoredFPC.sponsor_unconditionally` is envelope-independent (verified in Noir source: sets fee payer + `end_setup()`, reads nothing) — the collapse ships for it alone.
2. **The discovery fold does not ship in this plan** (fable F-1 + F-2, codex Critical 2 — convergent). As drafted it widened the auto-sign surface (a malicious *user-registered* FPC's `CallAuthorizationRequest`s would be auto-signed where today's app-only discovery structurally denies them), and in conservative mode it saves **zero** simulations (the collapse alone already delivers dApp 3→2). Only its mechanical prep lands now; the fold itself moves to a measurement-gated follow-up charter (below) with the F-1 resolution (app-only sim A) as its entry condition.

## Goal

Cut the number of full ACVM simulations behind every "estimating fee" spinner and every post-confirm dead gap, **without changing what the user sees or how fees are chosen**. Simulations are serialized (PXE write lock + upstream `SerialQueue`), so fewer sims is the only lever.

Committed sim-count targets (unit-test-asserted; `fpc` kind = both Sponsored and PrivateFPC):

| Flow | Today | After | Mechanism |
|---|---|---|---|
| Send estimate — canonical Sponsored FPC (default everywhere except mainnet) | 2 sims | **1** | Sponsored-only collapse (Phase 3) |
| Send estimate — PrivateFPC (mainnet default) | 2 sims | 2 | unchanged **by design** (envelope-dependent two-pass is load-bearing) |
| dApp op estimate — canonical Sponsored | 3 sims | **2** | collapse (Phase 3) |
| dApp op estimate — PrivateFPC / user-added | 3 sims | 3 | follow-up target: 2 (charter below) |
| dApp confirm — `fj`/`fpc` standard mode, reuse hit | 3 sims | **0** | estimate→confirm reuse (Phase 4) |
| dApp confirm — reuse miss | 3 sims | = estimate cost | fingerprint/drift ladder fail-closed |
| Every sim/prove | +1 node RPC (`[SYNC-DEBUG]`) | +0 | deletion (Phase 1) — also shortens the exclusive-lock hold (both blocks sit inside `withPxeWrite`) |

Non-goals (owner-directed): no UX/product changes; no `getNodeInfo` caching; no approval-window pipeline consolidation; no `/harden` scheduling. Out of scope by design: `EmbeddedStrategy`/embedded-FPC cap path, NO_FROM/`default_entrypoint`, `fjwc` reuse eligibility, and — this revision — the discovery-fold pipeline change.

## Architecture & Implementation

### Proposed architecture

1. **`FpcStrategy` grows a canonical-Sponsored fast path; the two-pass stays for everything else.** Branch condition (checked against `FpcService`-provided info, never dApp input): handler type `DefaultSponsoredFpc` AND address equal to the chain's canonical protocol Sponsored-FPC address. Fast path: prepend `fpc.getFeePayload(...)` → one `buildStandard(EXTERNAL)` → one sim (`skipFeeEnforcement: true`) → `finalizeGasLimits`. Two constraints from the audits, pinned in the new header comment: (a) **finalize args are FPC's own, not fjwc's** — `finalizeGasLimits(node, txReq, sim, padding, baseFees)` with the multiplier pre-baked into `baseFees` and NO `customLimits`/`feeMultiplier` params (copying fjwc's arg list would double-apply the multiplier and newly honor `op.fee.gasLimits` — a behavior change); keep Pass 1's `suggestGasLimits(txRequest, ctx.op.fee)` pre-sim call in the fast path for parity. (b) The header records the fable-verified status-quo fact that the shipped two-pass **never rebuilt after the final splice** — built bytes never carried a post-sim `maxFee` — which is what makes the placeholder-`maxFee` fast path byte-honest, and notes the limit-context shift (a budget-asserting `fpc`-kind contract fails estimation loudly under `forEstimation` limits; fail-loud is the accepted posture).
2. **`OperationEstimateReuse` generalizes `TransferEstimateReuse`** — the audited rejection ladder + deps-injection shape reused, with these audit-hardened specifics:
   - **Entry field list (exact, pinned here per fable F-3 / codex F3)**: inputs-fingerprint fields (below) + `profileId`, `baseFeeFingerprint`, `primaryEndpointId`, `primaryEndpointUrl`, `pendingHashes`, `builtAt`, **chain-identity snapshot (`l1ChainId`, `rollupVersion`)** (codex A2 — reuse bypasses `buildStandard`'s live-chain assert; consume re-fetches and fails closed) + built state `txRequest`, `nonce`, `feePaymentMethod`, **`txCalls`, `pendingPublicAuthwits`** (post-send bookkeeping: a reuse-hit tx granting a public authwit MUST still produce its auth-registry row — dedicated test). **Never cached**: `pxe`/`node`/`account`/`network` handles — consume re-resolves all four (the cross-profile fail-closed property depends on it).
   - **Fingerprint scope (pinned per fable F-4 / codex F2)**: the **post-planner, pre-discovery, pre-payload** `Action[]` set (stash and consume fingerprint the same normalization point — stated invariant), canonically encoded via an explicit exhaustive switch over action kinds with a **strict value-type allowlist** for nested `args` (reject-unsupported, never best-effort), plus `networkId`, `accountAddress`, **`executionMode`**, **`opts.from`**, wallet `FeeSettings` (existing `fingerprintFeeSettings`) **and normalized `op.fee` FeeOptions** (`gasLimits`, `maxFeesPerGas`, `gasPadding`, `embeddedFeePayment`).
   - **Consume order**: ownership/eligibility checks precede the single-shot delete where cheap, and a forged id can at worst evict-nothing/miss — never execute a mismatched op.
3. **`estimateId` never touches `packages/wallet-bridge`** (fable F-5 + codex boundary critique — adopted, strengthened from r1). `estimateOperationFee` returns it on the (already-existing) `TransferFeeEstimate.estimateId` field; the popup holds it per op and passes it at approve via a **popup-privileged envelope on the `approveInteraction` RPC** (extension-local spec): `estimateIds?: (string | undefined)[]` aligned with the executable ops array. dApp-facing request types never see the field; nothing needs stripping because the shared `Operation` shape is untouched.
4. **Estimate cancellation with a real resource contract** (fable F-6 / codex A3): SW-side registry keyed by caller-minted token, entries tagged with `profileId` at registration; `cancelEstimate(token)` no-ops silently on unknown/foreign tokens (existence non-disclosure, `cancelJob` parity); duplicate-token registration rejected; opportunistic TTL sweep (reuse-cache idiom) so a hung RPC can't leak controllers past SW restart; **cancel = abort-if-running AND evict-if-stashed** (cancel racing completion must not leave a signed `txRequest` cached). Stage-boundary `checkCancelled` before each build/sim/finalize; honest limitation stated: an in-flight ACVM run (or one queued inside `withPxeWrite`) cannot be killed — cancellation stops the *next* stage and prevents stashing.
5. **Reuse-entry lifecycle beyond TTL** (fable F-10): interaction reject / execute-window close evicts that interaction's stashed entries. Retention posture (signed `txRequest` cached ≤5 min TTL in SW memory, matching the shipped Send-page precedent) is surfaced as Ask 4.
6. **Mechanical prep for the follow-up, shipping now because it's a pure refactor**: split `AuthwitDiscoverer` into a sim-runner and a pure extractor (`TxSimulationResult → AddPrivateAuthwitAction[]`, unchanged parse + `computeAuthWitMessageHash` + live-chain assert), and thread `stubAccountAddresses` through `SimulateTxFn`/`ExecutionCoordinator.simulateTxTask` (opts-bag; plumbing below already exists end-to-end). Zero behavior change; call-sites keep today's choreography. The *pipeline fold itself* is deferred — see the follow-up charter.

### Key interfaces / types / schemas

- `approveInteraction` (extension-local dApp-interaction spec): + optional `estimateIds` envelope (popup-privileged; index-aligned).
- `ExecutionService` spec/client: + `cancelEstimate(token)`; `estimateTransferFee`/`estimateOperationFee` + optional caller token.
- `SimulateTxFn` opts: + `stubAccountAddresses?: string[]` (prep; unused by strategies this plan).
- `packages/wallet-bridge`: **no changes** (r1's `Operation.estimateId` dropped per audits).
- `IFpcHandler.getFeePayload(fpc, account, maxFee)`: unchanged; doc comment records both the future budget-checking-FPC rationale AND the never-rebuilt-final-splice status-quo fact (fable F-11).

### Data & control flow (target)

- **Send estimate, canonical Sponsored**: `send.vue` → `useFeeEstimation` (token; cancel-on-refire) → `estimateTransferFee` → `FpcStrategy` fast path: build(EXTERNAL + payload) → sim (validated, unstubbed) → finalize → stash → return `estimateId`. **1 sim.**
- **Send estimate, PrivateFPC**: unchanged two-pass. **2 sims.**
- **dApp estimate**: `execute/index.vue` → `useFeeEstimationMap` (token; cancel-on-refire) → `estimateOperationFee` → discovery sim (app-only, stubbed — **unchanged**) → strategy (fast path or two-pass) → stash → return `estimateId`. **2 sims (Sponsored) / 3 (PrivateFPC).**
- **dApp confirm**: `approve()` → `approveInteraction(requestId, executable, {estimateIds})` → `executeOperations` → `executeAztecSendTx`: inside `runInSlot`, `tryConsume(estimateId, op)` — hit ⇒ `proveAndSend` directly **with the full post-send tail intact** (`addTransaction(txCalls, …)` + `recordPendingAuthwits(pendingPublicAuthwits, hash)`); miss ⇒ estimate pipeline then `proveAndSend`. **0 sims on hit.**

### File-level change map

| File | Change |
|---|---|
| `packages/aztec-runtime/src/pxe/service.ts` | delete both `[SYNC-DEBUG]` blocks |
| `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts` | canonical-Sponsored fast path + rewritten invariant header; two-pass retained |
| `fee/fee-strategy.ts`, `execution-coordinator.ts` | `SimulateTxFn` stub-opt threading (prep); `signal` stage-boundary support |
| `fee/strategies-structural.test.ts` | pins updated: Sponsored fast path ×1/×1 + EXTERNAL arg; PrivateFPC two-pass pins RETAINED verbatim; finalize-arg fidelity pins |
| `authwit-discoverer.ts` (+ test) | runner/extractor split (pure refactor; call-sites unchanged) |
| `dapp-send-executor.ts` (+ test) | consume inside `runInSlot`; post-send tail on reuse hit; discovery choreography unchanged |
| `transfer-estimate-reuse.ts` → + `operation-estimate-reuse.ts` (+ tests) | generalized ladder, entry + fingerprint per §2 |
| `service.ts` | cancel registry + `cancelEstimate`; estimate stash wiring; carve-out comment updated |
| `client.ts` / `spec.ts` | `cancelEstimate` + token params |
| dApp-interaction `service.ts`/spec | `estimateIds` envelope; reject/close eviction hook |
| `apps/extension/src/composables/useFeeEstimation.ts` / `useFeeEstimationMap.ts` (+ tests) | token mint, cancel-on-refire/unmount |
| `apps/extension/src/popup/windows/execute/index.vue` | hold per-op `estimateId`, pass envelope at approve |

### Algorithms / non-obvious mechanics

- Fingerprint: exhaustive-switch canonical encoding (compile-time `never` guard on new `Action` kinds; strict nested-value allowlist, reject-unsupported), over the pinned normalization point (§2).
- Ladder additions: chain-identity re-fetch compare (fail closed) alongside the inherited TTL/profile/endpoint/base-fee/pending-tx steps; same-batch drift covered because `recordTransaction` is awaited inside `proveAndSend` before `executeOperations` advances — pinned by a dedicated test.
- Sponsored-canonical check: type + protocol-address equality from wallet-side FPC info; never trusts dApp/user input for the branch.

### Trade-offs & alternatives not taken

- **Per-handler collapse over uniform collapse** (r1's uniform version was invalid for PrivateFPC — codex). PrivateFPC 2→1 is *not* achievable by this technique at all; its envelope dependency is contract-side.
- **Fold deferral over fold-now** (fable's zero-benefit proof + auto-sign widening; codex independently proposed the safe app-only fold shape). Disagreement recorded in the ledger: codex's revised order included the app-only fold now; fable argued defer-entirely. Deferred — the follow-up charter adopts codex's app-only shape as the entry design, fable's conditions as its gate.
- **Conservative sizing over upstream stub-gas parity** (unchanged from r1; both auditors endorsed; upstream disagrees with itself on the margin — wallets pad 10%, aztec-kit 0 — which is an argument for measuring first).
- **`approveInteraction` envelope over `Operation.estimateId`** (both auditors; keeps the shared wire type clean and the field structurally unreachable from dApps).
- **Deletion of `[SYNC-DEBUG]` over flag-gating**; **generalized ladder over copy-paste cache**; **outline B rejected** (see audits — repeats the PrivateFPC bug, unproven pad, one-PR risk concentration) and re-positioned as the possible measurement-gated convergence target.

## Follow-up charter (NOT in this plan): discovery fold + single-sim estimates

Entry conditions: Phase 6 measurement shows stub-vs-real gas deltas comfortably inside padding; owner accepts. Design constraints fixed by this plan's audits: sim A is **app-only** (no fee payload — preserves the fail-loud denial for FPC-originated authwit requests; fable F-1 option (a), codex's "fold onto the app-only first pass"); implemented as a `DiscoveryAwareEstimator` decorator owned by `dapp-send-executor`, NOT a `FeeStrategyContext` hook (strategies stay payment-only); adversarial-FPC test fixture required (an FPC whose payload emits `CallAuthorizationRequest` must fail estimation loudly, never get auto-signed); its own network-e2e milestone (`tx-sendTx-default.test.ts` at minimum). Prize: dApp PrivateFPC estimate 3→2 (merge discovery into pass 1), and — if stub gas is accepted — estimates converge toward 1 sim (outline B-lite).

## Phases

PR mapping (stacked; Phase 0 verifies `gh-stack` — note the codex-vs-changelog public/private-preview dispute — fallback: classic chained PRs):
**PR A** = Phases 0–2 · **PR B** = Phase 3 · **PR C** = Phases 4–6.

### Phase 0 — Preflight: gh-stack + baseline

`gh extension install github/gh-stack`; verify stacking against `dev`'s ruleset on a scratch branch pair (enablement may be required if codex's private-preview claim is right); record stack-vs-fallback in `lessons/phase-0.md`. Note baseline structural-test call counts.

**Gate** — `gh stack --help` (or recorded fallback decision); `bun run lint && bun run typecheck:all && bun run test` → all exit 0. Layers: typecheck/lint/unit.

### Phase 1 — Delete the `[SYNC-DEBUG]` round-trips (PR A)

Both blocks in `packages/aztec-runtime/src/pxe/service.ts`. No replacement logging that costs an RPC.

**Gate** — `grep -rn "SYNC-DEBUG" packages/ apps/ | wc -l` → 0; `bun run lint && bun run typecheck:all && bun run test` → exit 0. Layers: typecheck/lint/unit.

### Phase 2 — Estimate cancellation (PR A)

Per architecture §4 (profile-tagged registry, duplicate rejection, TTL sweep, abort-and-evict, silent no-op on foreign tokens, stage-boundary checks, no-stash-on-cancel). Popup: token mint + cancel on refire/unmount.

**Gate** — `bun run --cwd apps/extension vitest run src/wallet/services/execution src/composables` then `bun run lint && bun run typecheck:all && bun run test`. Pass: cancel-before-pipeline, no-stash-on-cancel, foreign-token no-op, duplicate-rejection, evict-on-cancel-race tests green; full suite exit 0. Layers: typecheck/lint/unit.

### Phase 3 — Canonical-Sponsored FPC fast path (PR B)

Per architecture §1. Structural pins: fast path `buildStandard` ×1 (EXTERNAL) + `simulateTxTask` ×1; **PrivateFPC/user-added pins retained verbatim** (two-pass unchanged); finalize-arg fidelity (no `customLimits`, no double multiplier); old-vs-new gas-slot sentinel pin for the fast path.

**Gate** — `bun run --cwd apps/extension vitest run src/wallet/services/execution/fee` then `bun run lint && bun run typecheck:all && bun run test`; **milestone e2e**: `bun run e2e:agent tests/e2e/network/transfers.test.ts` and `bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts` (both Sponsored-FPC-paid, prover-ON canary pair). Pass: all exit 0. Layers: typecheck/lint/unit + network e2e.

### Phase 4 — dApp estimate→confirm reuse (PR C)

Per architecture §2–3, §5. Tests pin: every ladder exit incl. chain-identity drift + same-batch `pendingHashes`; consume-hit skips discovery + `buildAndEstimate` AND still runs `addTransaction` + `recordPendingAuthwits` (the auth-registry row must exist — fable F-3's silent-break scenario); forged/foreign `estimateId` ⇒ miss/no-evict; reject/window-close eviction; fingerprint normalization-point invariant (stash and consume hash the same set).

**Gate** — `bun run --cwd apps/extension vitest run src/wallet/services/execution src/popup/windows/execute` then `bun run lint && bun run typecheck:all && bun run test`; **milestone e2e**: `bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts` and `bun run e2e:agent tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts`. Pass: all exit 0. Layers: typecheck/lint/unit + network e2e.

### Phase 5 — Mechanical prep: discoverer split + stub-opt threading (PR C)

Per architecture §6. Pure refactor: identical choreography, identical sim options, call-sites updated mechanically; extractor unit-tested standalone on recorded `TxSimulationResult` fixtures.

**Gate** — `bun run --cwd apps/extension vitest run src/wallet/services/execution` then `bun run lint && bun run typecheck:all && bun run test`. Pass: zero pin changes needed in `strategies-structural.test.ts` (proof of no behavior change); full suite exit 0. Layers: typecheck/lint/unit.

### Phase 6 — End-to-end validation + stub-gas measurement (PR C)

`bun run audit:vue`; `bun run test:e2e` (smoke — popup surfaces touched); **full** `bun run e2e:agent`. Measurement task (throwaway, uncommitted): log stubbed-discovery vs validated-strategy `gasUsed` per dApp op across representative flows; record the delta table in `lessons/phase-6.md` — the data for the follow-up charter's entry condition.

**Gate** — `bun run audit:vue && bun run test:e2e && bun run e2e:agent` → all exit 0 (pre-existing triaged skips remain skips); measurement table present. Layers: all.

## Security & Adversarial Considerations

- **Threat model principals**: a malicious dApp (hostile `Operation` payloads); a **malicious user-registered FPC** (arbitrary contract behind an ABI-shape check — added per fable F-1/codex C2); ourselves (fee-sizing bugs).
- **Authwit surface: unchanged by this plan.** Discovery keeps today's app-only, fee-payload-excluded build — an FPC-originated `CallAuthorizationRequest` still produces a loud validated-sim failure, never an auto-signed authwit. The extractor split preserves the exact parse + message-hash + live-chain assertion. The fold that would touch this surface is deferred with its safety design fixed in the charter.
- **Reuse-cache integrity**: SW-minted UUID tokens; single-shot; TTL + reject/close eviction; consume re-validates fingerprint (pinned normalization point, strict value allowlist) + profile + endpoint + chain identity (fail-closed re-fetch) + base fee + pending set; entries carry no live handles; `ExecutionFence` stays confirm-time. Forged ids: miss or no-op — the `estimateIds` envelope is popup-privileged and never dApp-reachable (no shared-type field at all).
- **Bookkeeping integrity on reuse hits**: `txCalls` + `pendingPublicAuthwits` ride the entry so activity records and the auth registry are written identically to the non-reuse path (dedicated test — a missing auth-registry row was the identified silent break).
- **Fee correctness**: PrivateFPC's envelope-dependent path untouched; Sponsored fast path is envelope-independent by verified contract source; padding (1.05) and `predictedWorstMinFees` basis unchanged; no stub output ever feeds sizing or proving in this plan.
- **Cancellation**: profile-gated, existence-nondisclosing, duplicate-rejecting, TTL-swept, bounded.
- **Least privilege / supply chain / crypto**: no new dependencies, no workflow/token changes, no crypto code; `@aztec/*` stays exact-pinned 5.0.1.

## Assumptions

### Facts (verified — recon.md + audit verifications)

1. PrivateFPC computes `max_gas_cost` from the tx gas-settings envelope in-contract (`@alejoamiras/private-fee-juice`; codex C1, main-agent verified). Canonical `SponsoredFPC.sponsor_unconditionally` reads nothing from it (Noir source verified).
2. `buildStandard` unconditionally applies `forEstimation` sizing (`nulo-account.ts:133-137`).
3. All sims run kernel-less by upstream default; `TxSimulationResult` exposes `offchainEffects` + `gasUsed` at 5.0.1.
4. Users can register arbitrary FPC addresses (`FpcService.addFpc`, ABI-shape validation only) — the F-1 principal.
5. Today's discovery build is app-only (`PREEXISTING_FEE_JUICE`, no payload) and stubbed; the shipped two-pass never rebuilds after the final splice (built bytes never carried a post-sim `maxFee`) — fable-verified.
6. Reuse-hit confirms must still run `addTransaction` + `recordPendingAuthwits` (`dapp-send-executor.ts:453-470`); `recordTransaction` is awaited inside `proveAndSend`, making same-batch pending-hash visibility sequential.
7. `estimateId` exists on `TransferFeeEstimate`; the execute window closes before execution starts (fire-and-forget `approveInteraction`).
8. `cancelJob` is journal+profile-gated and no-ops for estimates; no `AbortSignal` crosses the messaging layer.
9. `ILogger` has no level predicate; the `[SYNC-DEBUG]` RPCs fire before filtering, inside the exclusive write lock; no test reads those lines.
10. Sim-count pins live at the unit layer (`strategies-structural.test.ts` idiom); composition tests are prohibited for this surface.

### Inferences (attackable)

1. The Sponsored fast path's single sim yields `gasUsed`/`maxFee` within normal estimate variance of the two-pass (envelope-independence verified at the contract; `finalizeGasLimits` recomputes from measured gas either way). Confidence: high. Displayed numbers may shift marginally — Ask 3.
2. `gh-stack` works under `dev`'s ruleset (public-vs-private preview disputed between the GitHub changelog and codex's doc read). Confidence: low; Phase 0 verifies, fallback exists.
3. The canonical-address check (type + protocol address) is a stable discriminator across network resets (protocol addresses are chain-derived, re-verified per `aztec-update` runbook on resets). Confidence: moderate.

### Asks (approval-gate decisions)

1. **Stub-gas / discovery-fold follow-up**: defer per the charter, decided later on Phase-6 data? **Recommendation: defer** (both auditors concur).
2. **PR mapping**: A = quick wins, B = Sponsored collapse, C = reuse + prep + validation. **Recommendation: accept.**
3. **Marginal fee-number drift** on the Sponsored fast path (mainnet PrivateFPC now fully unchanged). **Recommendation: accept.**
4. **Signed-artifact retention posture**: dApp reuse entries hold a fully-signed `txRequest` in SW memory ≤5-min TTL (Send-page precedent), now with reject/close eviction. **Recommendation: accept as stated.**

## Decision ledger

| # | Decision | Chosen | Rejected | Source | Status |
|---|---|---|---|---|---|
| 1 | Gas sizing basis | validated unstubbed sims only | upstream stub-gas + pad (now) | recon 5–6; both audits endorse | settled (measure in Ph. 6) |
| 2 | FPC collapse scope | canonical Sponsored only | uniform collapse (r1 — invalid for PrivateFPC) | codex C1 (verified) | settled |
| 3 | Discovery fold timing | **defer to charter** (prep only now) | fold-now conservative (r1); codex's app-only-fold-now | fable F-1/F-2; codex C2 | settled; **residual disagreement recorded**: codex would fold (app-only) now, fable defers — deferral chosen (zero sim benefit now, one less risk surface); codex's shape becomes the charter design |
| 4 | estimateId transport | `approveInteraction` popup-privileged envelope | `Operation.estimateId` (r1); sibling RPC; requestId correlation | fable F-5; codex boundary | settled |
| 5 | SYNC-DEBUG | delete | flag-gate | recon 12 | settled |
| 6 | Reuse cache shape | generalized ladder; entry list + fingerprint scope pinned in-plan | parallel copy; r1's underspecified "same fields" | fable F-3/F-4; codex F2/F3/A2 | settled |
| 7 | PR ordering | A=quick wins, B=collapse, C=reuse+prep | r1 mapping (fold in C); pre-recon sketch | fable | open Ask 2 |
| 8 | `IFpcHandler` signature | keep + dual-fact doc comment | drop params | fable F-11; codex | settled |
| 9 | Sim-count test layer | unit | composition | recon 13–14 | settled |
| 10 | Outline B | rejected now; charter convergence target | adopt B | both audits | settled |

## Audit verdicts

- **Codex (round 1, fresh, xhigh)**: `reject` — 2 blocking findings, both main-agent-verified and adopted (Sponsored-only collapse; fold deferred/safety-fixed). [audit-codex.md](audit-codex.md)
- **Fable (round 1, fresh Plan agent)**: `conditional approve` — all 4 conditions adopted (F-1 via deferral+charter; F-2 table corrected + decoupled; F-3/F-4 pinned in-plan; F-5 via envelope). Advisories F-6–F-11 adopted. [audit-fable.md](audit-fable.md)
- **Codex (final fresh-context pass on rev 2 + ledger)**: _pending_

## Seeds (DRAFT — finalized post-approval)

### Recommended: `/goal`

```
/goal All phases 0–6 marked ✓ in implementations-plan/fee-estimation-speedup/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/fee-estimation-speedup/lessons/phase-N.md in the transcript; the three stacked PRs (A: phases 0-2, B: phase 3, C: phases 4-6) opened against dev with required checks green; /code-review max --fix complete with findings applied and committed; codex post-impl audit complete with high/critical findings addressed; bun run test and bun run lint both report exit 0 in the transcript.
```

### Alternative: `/loop 15m`

```
/loop 15m Drive implementations-plan/fee-estimation-speedup forward. Never idle waiting for my input. Each firing: (1) Reality check: read plan.md + lessons/ (authoritative state), git status, git log --oneline -5; if PRs exist, gh pr view --json statusCheckRollup (no --watch). (2) Waiting on CI is fine — confirm it progresses (gh run watch <id> ≤10 min); use waits to review the diff or prep the next phase. (3) No task in hand? Pick the next pending phase from plan.md and start it; after each meaningful edit run bun run lint + targeted vitest for touched packages; commit → push. (4) Stuck or facing a decision you'd bring to the owner? Call /codex xhigh, reach a defensible decision, act, log the consult in lessons/phase-N.md. Hard limits: never merge to main/release branches, never publish/deploy, never expand scope beyond plan.md (the discovery fold is OUT of scope — charter only). (5) Same step failed 5 times? Stop retrying, reassess with codex. (6) Phase green = its validation gate in plan.md passes verbatim — run it, paste the result, mark ✓ in plan.md, file lessons, print LESSONS_FILE=implementations-plan/fee-estimation-speedup/lessons/phase-N.md, advance. (7) All phases ✓? Run /code-review max --fix → commit fixes separately → codex post-impl audit (net diff + code-review summary + adversarial ask) → address high/critical → wrap-up report. Keep the ASCII checklist visible each firing.
```

Use exactly ONE per session — they don't compose.
