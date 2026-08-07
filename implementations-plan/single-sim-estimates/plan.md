# Plan — single-sim-estimates

- **Status**: DRAFT — pending dual audit (codex + fable) + approval gate
- **Tier**: `/blueprint mid` (rubric: security HIGH — authwit auto-sign surface restructuring + a NEW contract-identity safety argument; blast radius MED-HIGH — dApp estimate gas sizing, both fee methods; novelty LOW — charter pre-designed, surface triple-audited last month; irreversibility LOW; migration NONE; external coupling LOW. 1–2 HIGH: `deep` arguable by the letter; `mid` chosen per owner invocation + the pre-audited charter, with the Sponsored contract-identity argument flagged for hostile attention in every audit packet)
- **eli5_mode**: file (the prior arc's Artifact became unwritable after a session re-login; file mode avoids a URL orphan — revisit if the owner wants a fresh Artifact)
- **Recon**: [recon.md](recon.md) · **Binding precedent**: `implementations-plan/fee-estimation-speedup/` charter + audit constraints (fable F-1/F-2, codex C1/C2, post-impl r1–r3)

## Goal

Three workstreams, one stack:

- **A — Discovery fold**: dApp estimates stop paying a separate authwit-discovery simulation. `DiscoveryAwareEstimator` (decorator owned by `dapp-send-executor` — charter-fixed boundary) merges discovery into the strategy pipeline. dApp PrivateFPC estimate **3→2 sims**.
- **B — Stub-gas adoption ("B-lite"), where it can reach**: dApp Sponsored estimate **2→1 sim** (one stubbed, payload-inclusive sim serving discovery + sizing — safety from *contract identity*: eligibility already pins the Noir-verified-inert canonical contract). Gated on **real Testnet measurements** (owner rule: auto-adopt if delta ≪ the 5% pad; else pause and present the number). Send-page paths and PrivateFPC's Pass 2 are **unreachable by design** (recon verdict table) — "everywhere it can reach" honestly = these two dApp paths.
- **C — e2e arming fix**: `account-switch-isolation` local red is a root-caused invocation trap (unarmed proverless build; gate tree-shaken out; silent 3-minute timeout). Fix = fail-fast arming preflight + runner guard + skill lesson; verify green armed.

Sim-count targets (unit-pinned):

| Flow | Today | After | Mechanism |
|---|---|---|---|
| dApp Sponsored estimate | 2 | **1** | folded stubbed sim (B, gated on measurement) |
| dApp PrivateFPC / user-added estimate | 3 | **2** | discovery folds into Pass 1 (A) |
| dApp confirm (reuse hit) | 0 | 0 | unchanged — must not regress |
| Send page (all methods) | 1–2 | unchanged | no discovery to fold; validated sims stay |
| embedded / NO_FROM | — | unchanged | carried exclusion |

Non-goals: send-page restructuring; PrivateFPC Pass-2 stubbing (permanently fenced — user-registered-FPC auto-sign hazard); offscreen job-ack; reuse hit-rate observability; `getNodeInfo` caching. No UX/product change anywhere.

## Architecture & Implementation

### Proposed architecture

**A. `DiscoveryAwareEstimator`** (new file, `apps/extension/src/wallet/services/execution/discovery-aware-estimator.ts`): a decorator over `buildAndEstimate`, owned and invoked ONLY by `dapp-send-executor` (send path provably cannot acquire discovery behavior — the charter's boundary). It replaces the two inline `discoverPrivateAuthwits` call sites (`dapp-send-executor.ts:263-275` estimate, `:577-594` confirm-miss):

- For strategies without a foldable pass (`fj`, `fjwc`): behavior-preserving — run the existing discoverer (stubbed app-only sim), splice, delegate to the strategy. Sim counts unchanged (2).
- For `fpc` two-pass (PrivateFPC/user-added): the decorator passes a discovery capability into the strategy call such that **Pass 1 becomes the discovery sim** — stubbed (`stubAccountAddresses` through the already-wired `SimulateTxFn` opts), `skipTxValidation: true`, app-only (`PREEXISTING_FEE_JUICE`, no payload — F-1 preserved verbatim), offchain effects extracted via the discoverer's existing extraction chain, discovered authwit actions spliced before Pass 2's build. Pass 2 unchanged: real, validated, payload-inclusive — the fail-loud gate for user-added FPCs. 3→2.
- For `fpc` Sponsored fast path: see B.
- **Mechanism**: rather than a `FeeStrategyContext` hook (forbidden), the decorator wraps the strategy Map lookup: `dapp-send-executor` receives a `buildAndEstimateWithDiscovery(op, feeSettings, parentTask, signal)` dep that internally coordinates discovery + strategy. The strategies gain one narrowly-typed optional constructor collaborator (`DiscoveryProbe`: `{extractEffects(sim: TxSimulationResult): Promise<AddPrivateAuthwitAction[]>}`) — pure extraction, no sim-running, injected ONLY into `FpcStrategy` by the decorator path. (Alternative shapes in Trade-offs.)
- **Fingerprint invariant**: `preDiscoveryActions` normalization point (`dapp-send-executor.ts:259`) is untouched — the decorator operates strictly after the snapshot; a dedicated test pins stash/consume symmetry across the refactor.

**B. Stub-gas for the Sponsored fast path** (`fpc-strategy.ts:97-134`): the fast path's single sim becomes stubbed + `skipTxValidation: true` (payload stays IN — it must, to measure the sponsor call). Its result feeds BOTH sizing (`finalizeGasLimits`, unchanged math) AND discovery extraction (dApp path only). 2→1.

- **Safety justification (NEW, explicitly hostile-review-target)**: the F-1 hazard is a malicious FPC's `CallAuthorizationRequest` being auto-signed from a stubbed sim. The fast path's eligibility gate (`isSponsoredFastPathEligible` + the cross-chain row check) pins handler type + `isProtocol` (address equality with the pinned canonical contract, recomputed at read time, never storable) — the payload in this sim is BY CONSTRUCTION the Noir-verified-inert `sponsor_unconditionally` (reads nothing, emits nothing, `end_setup` only). An adversarial-FPC fixture pins the negative: a non-canonical sponsored-shaped FPC must take the two-pass (fold-free payload-exclusive discovery) and fail loudly if its payload demands an authwit.
- **Validation-loss trade (stated honestly)**: the Sponsored dApp estimate loses its estimate-time validated sim; structural/authwit failures surface at post-proof `sendTx` instead. Bounded by: the confirm path's reuse-miss rebuild still validates (miss ⇒ full pipeline), and the canary phase proves inclusion end-to-end. Send-page Sponsored keeps its validated sim (unchanged), so the send flow's early-failure UX is untouched.
- **Network-limit clamp adoption**: alongside stub sizing, `finalizeGasLimits` gains the upstream clamp (`assertGasLimitsWithinNetworkLimits`-equivalent: cap at `MAX_TX_DA_GAS`/`MAX_PROCESSABLE_L2_GAS`, from `@aztec/wallet-sdk` or constants) — Nulo currently has NO clamp; adopting stub gas with a thinner effective margin than either upstream posture without the clamp would be strictly weaker than both references (recon fact 10).

**C. Testnet measurement (gate for B, data for the ledger)**: disposable `packages/bridge-core/scripts/gas-delta-testnet.local.ts` (gitignored pattern), architecture per recon fact 15: ephemeral proverless `EmbeddedWallet` → fresh Nulo-shaped account → SponsoredFPC-registered → dripper-funded (public + private conversion) → measure stub-vs-real `gasUsed` for: (1) public transfer + sponsor payload (replicates the n=1 datum), (2) `transfer_private_to_private`, (3) the authwit grant/consume pair, (4) the PrivateFPC `pay_fee` two-pass shape (P1 app-only stub-vs-real — the envelope-seed question, recon fact 9). Then the **inclusion canary** (owner's real-tx-failure concern, tested directly): recreate prover-ON, size gas from the STUB arm's numbers + 1.05 pad, send one real sponsored tx, assert receipt success. Decision rule (owner-set): every delta < 1% ⇒ proceed; any delta ≥ 1% ⇒ STOP, present numbers + recommendation.

**D. e2e arming fix**: (1) arming-contract preflight in `account-switch-isolation.test.ts` copying the `backup-migration.test.ts:31-42` idiom — assert the proverless build stamp is present in the loaded extension, failing in seconds with the exact remedial command instead of a silent 3-minute poll; (2) `agent.sh` guard: when invoked WITHOUT `NULO_E2E_PROVERLESS=1` but the requested file list contains a proverless-gated test (marker comment scan), print a loud warning naming the flag; (3) durable lesson → `e2e-testing` skill (per the CLAUDE.md routing table); (4) verified-green armed run.

### Key interfaces / types / schemas

- `DiscoveryAwareEstimator` (extension-internal): `estimate(op, feeSettings, parentTask?, signal?): Promise<FeeEstimate & {discoveredActions: AddPrivateAuthwitAction[]}>` — the discovered actions surfaced so `estimateOperationFee`/`executeAztecSendTx` keep their existing splice-into-`actions` bookkeeping.
- `DiscoveryProbe` (narrow, extraction-only): injected into `FpcStrategy` construction for the dApp path; `undefined` on the send path (compile-visible absence).
- `FeeEstimate extends BuiltStandardTx` — **unchanged, byte-for-byte** (stash reads it; recon fact 11).
- `SimulateTxFn` — unchanged (stub opt exists); strategies begin passing `stubAccountAddresses` on folded sims only.
- No wallet-bridge/wire changes anywhere.

### Data & control flow (target)

- **dApp Sponsored estimate**: `estimateOperationFee` → decorator → fast path: build(EXTERNAL+payload) → **1 stubbed sim** → extract effects (expect none for canonical payload; app-call effects spliced + REBUILD if present — see Algorithms) → finalize → stash. 1 sim (no-effects case), 2 (effects case — rebuild+resim to attach authwits validated).
- **dApp PrivateFPC estimate**: decorator → two-pass: P1 build(PREEXISTING, app-only) → **stubbed sim** → extract + splice → P2 build(EXTERNAL+payload, envelope from P1) → validated sim → finalize. 2 sims.
- **Send page**: `transfer-executor` path calls `buildAndEstimate` directly — decorator not in the call chain; zero change.
- **Confirm**: reuse-hit unchanged (0 sims); reuse-miss runs the same decorator pipeline as estimate.

### File-level change map

| File | Change |
|---|---|
| `execution/discovery-aware-estimator.ts` (+test) | NEW — decorator per §A |
| `execution/dapp-send-executor.ts` (+test) | both discovery call sites → decorator; splice bookkeeping via `discoveredActions` |
| `execution/fee/fpc-strategy.ts` (+pins) | P1 stub+skipTxValidation+probe; Sponsored fast path stub+probe; headers rewritten |
| `execution/fee/fee-strategy.ts` | `finalizeGasLimits` network-limit clamp |
| `execution/fee/strategies-structural.test.ts` | deliberate pin rewrite per recon fact 12 + adversarial-FPC fixture |
| `execution/authwit-discoverer.ts` (+test) | extraction chain exposed as the probe (runner retained for `fj`/`fjwc` paths) |
| `tests/e2e/network/account-switch-isolation.test.ts` | arming preflight |
| `apps/extension/scripts/e2e/agent.sh` | proverless-file warning |
| `.claude/skills/e2e-testing/` | arming lesson |
| `packages/bridge-core/scripts/gas-delta-testnet.local.ts` | disposable, never committed |

### Algorithms / non-obvious mechanics

- **Sponsored fold with unexpected effects**: canonical payload emits nothing, but the APP portion of a dApp op may demand authwits. In the folded single sim those surface together. If effects exist: splice authwit actions → rebuild → **validated** re-sim (attaching real authwits) → size from the validated sim. So 1 sim is the no-authwit fast case; authwit-bearing ops cost 2 (same as today) and REGAIN validation. No path sizes from a stub while carrying unverified authwits.
- **PrivateFPC envelope-seed**: P2's envelope derives from stubbed P1 gas — measurement shape (4) exists precisely to bound this; if its delta ≥ 1%, workstream A still lands (fold is sim-count-neutral-or-better and preserves P2's real sizing) but P1's stub flips OFF (validated P1, fold retains the merge of discovery into P1 — discovery's `skipTxValidation` requirement then forces P1 unvalidated-but-unstubbed; see Trade-offs).
- **Adversarial-FPC fixture**: a test FPC whose payload method emits a `CallAuthorizationRequest`; pins (a) it never qualifies for the fast path, (b) the two-pass P2 validated sim fails loudly, (c) nothing auto-signs its request.

### Trade-offs & alternatives not taken

- **Decorator + narrow probe over a `FeeStrategyContext` hook** (forbidden by negotiated audit terms) and over full strategy-external discovery (would need the strategy's internal pass structure exposed — leakier than a one-method probe).
- **P1 stub via measurement-gate, not assumption** — if measurement fails the gate, fallback shape: P1 unstubbed + `skipTxValidation: true` (discovery still requires unvalidated; stub only needed to soften authwit asserts into effects — *open question for audit: can an UNSTUBBED sim discover effects, or do real-account authwit asserts hard-fail first?* If hard-fail, the fallback is discovery-as-today + fold abandoned for PrivateFPC).
- **Sponsored 1-sim via contract identity over blanket app-only** — app-only can't size the sponsor call; identity-pinning is the only route to 1 sim, hence the dedicated fixture + hostile-review flag.
- **Clamp adoption now over later** — sizing-basis change and safety-margin hardening belong in the same diff.
- **e2e fix as preflight over skip-if-unarmed** — a skip hides breakage; a loud fail teaches the flag (owner chose root-cause+robust over skip).

## Security & Adversarial Considerations

- **Threat model**: malicious dApp (op payloads); malicious user-registered FPC (the F-1 principal — ABI-shape validation only); ourselves (gas under-sizing → real user tx fails on-chain — the owner's named BIG-deal risk).
- **Auto-sign surface**: unchanged for every non-canonical FPC (payload-exclusive discovery; P2 validated fail-loud). The ONLY payload ever inside a stubbed sim is the identity-pinned canonical `sponsor_unconditionally`. Pinned by the adversarial-FPC fixture + the existing eligibility tests + `isProtocol` never being storable (recomputed at read).
- **Gas-sizing safety**: measurement-gated adoption (owner's <1% rule); 1.05 pad unchanged; NEW network-limit clamp; inclusion canary proves a stub-sized real tx lands on testnet before any user is exposed; PrivateFPC's user-facing sizing stays real-sim-derived.
- **Validation-loss**: enumerated per-path in §B; authwit-bearing dApp ops always end on a validated sim.
- **Input validation**: no new wire surfaces; script inputs are constants + derived keys, no secrets, no `.env`.
- **Least privilege / supply chain**: no new deps; testnet script uses public RPC + protocol constants only; nothing committed carries addresses beyond the already-committed deployment JSONs.
- **Domain risks**: replay/front-running unchanged (nonce semantics untouched); fee-griefing bounded by pad+clamp; the measurement script sends at most one canary tx from a throwaway account.

## Assumptions

### Facts (verified — recon.md file:line)

1. Stub ⟹ `skipKernels` forced ⟹ practically requires `skipTxValidation` (upstream throw + validator mismatch; every in-repo stub site sets it) — recon fact 6.
2. All estimate sims are already kernel-less; stub-vs-real differs only in account-swap + validation — recon fact 5.
3. Discovery's sim is already stubbed/unvalidated/app-only and its `gasUsed` discarded — recon facts 3, verdict table.
4. Canonical `sponsor_unconditionally` reads nothing, emits nothing (Noir source, verified last arc); eligibility pins it via non-storable `isProtocol` + cross-chain check — recon table.
5. PrivateFPC's P2 envelope-dependency and its user-added reachability — recon facts 1, 9.
6. `stubAccountAddresses` plumbing wired end-to-end, unused by strategies — recon fact 8.
7. Testnet has everything free: canonical Sponsored (salt-derived), canonical PrivateFPC (pinned addr), Dripper+token (deployments.json); `drip-canary-testnet.ts` is the zero-env template — recon facts 13–14.
8. e2e root cause is the unarmed proverless build (dist forensics); CI always arms; `backup-migration.test.ts:31-42` is the preflight idiom — recon facts 18–20.
9. Reuse caches are provenance-agnostic; `FeeEstimate` contract is the one restructuring trap — recon fact 11.
10. Nulo has no network-limit clamp today; upstream helpers exist unused at 5.0.1 — recon fact 10.

### Inferences (attackable)

1. An unstubbed `skipTxValidation` sim may still hard-fail in-circuit on missing authwits (the stub's bytecode swap, not validation, is what converts asserts into effects) — the P1-fallback question flagged in Trade-offs. Confidence: moderate; audit + a quick spike resolve it.
2. Stub-vs-real deltas on private/authwit shapes will match the public-shape datum (0). Confidence: moderate — that's why we measure; nothing ships on this inference.
3. A fresh ephemeral PXE syncs against testnet in seconds-to-low-minutes for a fresh account. Confidence: moderate (recon reasoning, unmeasured); the script's first task validates it.
4. The armed `account-switch-isolation` run is green on this machine (mechanism fully explains the red; last known green documented). Confidence: high; Phase C1 verifies first.

### Asks (approval-gate decisions)

1. **Sponsored 1-sim validation-loss**: accept moving structural failure detection from estimate-time to post-proof for the no-authwit dApp Sponsored case (authwit-bearing ops keep validation), in exchange for 2→1? **Recommendation: accept** — the confirm-miss path still validates, and the canary covers inclusion.
2. **Network-limit clamp**: adopt alongside stub sizing? **Recommendation: yes** (pure hardening).
3. **Canary tx**: one real SponsoredFPC-paid tx from a throwaway account on public testnet (visible on-chain, zero cost). Confirm you're fine with that footprint. **Recommendation: accept.**

## Phases

PR mapping — one `gh stack` of three (owner-chosen): **PR 1** = Phase C (e2e fix, stack base) · **PR 2** = Phases A1–A2 (fold) · **PR 3** = Phases B1–B3 (measurement-gated stub adoption + clamp).

### Phase C1 — e2e verify + arming preflight (PR 1)

Armed run first (`NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts`) to confirm green; then the preflight assert, `agent.sh` warning, skill lesson.

**Gate** — armed run: 2/2 tests pass; unarmed run: fails in <30 s with the remedial message (manual check of the failure text); `bun run lint && bun run typecheck:all && bun run test` exit 0. Layers: lint/typecheck/unit + targeted network e2e.

### Phase A1 — Decorator extraction, behavior-preserving (PR 2)

`DiscoveryAwareEstimator` replaces both inline call sites; all strategies still called exactly as today (discovery separate, counts unchanged). Pin proof: sim/build counts identical, `preDiscoveryActions` symmetry test, reuse consume-hit/miss pins updated to the decorator surface deliberately.

**Gate** — `bun run --cwd apps/extension vitest run src/wallet/services/execution` + full `lint`/`typecheck:all`/`test` exit 0; count pins unchanged in value. Layers: lint/typecheck/unit.

### Phase A2 — PrivateFPC fold: discovery into Pass 1 (PR 2)

P1 becomes stubbed + `skipTxValidation` + probe-extracting (pending Inference 1's spike — if unstubbed discovery is viable and measurement later fails the stub gate, the stub flag is a one-line revert); splice before P2; dApp `fpc` estimate pins 3→2; adversarial-FPC fixture lands here (two-pass path).

**Gate** — updated structural pins (dApp fpc: builds ×2, sims ×2; consume-miss identical); adversarial fixture green; discovery-equivalence test (folded vs standalone discovery on representative fixtures); full unit suite; **milestone e2e**: `bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts`. Layers: lint/typecheck/unit + network e2e.

### Phase B1 — Testnet measurement (PR 3, data-only)

The disposable script; four shapes + inclusion canary per §C. Results table → `lessons/phase-B1.md`. **Decision checkpoint**: all deltas <1% ⇒ proceed; else STOP and present.

**Gate** — measurement table complete (all four shapes, stub AND real arms, plus canary receipt success); script leaves zero committed footprint (`git status` clean of it). Layers: live-testnet validation.

### Phase B2 — Sponsored 1-sim fold + clamp (PR 3)

Fast path stub+probe (payload-inclusive, identity-justified); effects-present path rebuilds validated; `finalizeGasLimits` clamp; adversarial fixture extended (non-canonical sponsored-shape never fast-paths); pins: dApp Sponsored 2→1 (no-authwit), send Sponsored unchanged ×1 validated.

**Gate** — updated pins + fixture + full unit; **milestone e2e**: same dApp pair, prover-ON. Layers: lint/typecheck/unit + network e2e.

### Phase B3 — Full validation (PR 3)

`bun run audit:vue`; armed smoke; **full** `bun run e2e:agent` with `NULO_E2E_PROVERLESS=1`.

**Gate** — all exit 0 (pre-existing triaged skips remain skips). Layers: all.

## Decision ledger

| # | Decision | Chosen | Rejected | Source | Status |
|---|---|---|---|---|---|
| 1 | Fold boundary | decorator in dapp-send-executor + narrow extraction probe | FeeStrategyContext hook (forbidden); full-external discovery | charter (binding) + recon | settled |
| 2 | B-lite reach | dApp Sponsored 2→1, dApp PrivateFPC 3→2 only | "everywhere" incl. send-page (nothing to fold; validation loss for zero gain); P2 stubbing (auto-sign hazard) | recon verdict table | settled — honest narrowing of the owner's "everywhere" answer |
| 3 | Sponsored 1-sim safety basis | contract identity (pinned canonical, Noir-inert) | app-only rule (can't size the payload) | recon | open — flagged for hostile audit |
| 4 | Adoption gate | real Testnet measurement, <1% auto-adopt else pause; inclusion canary | sandbox-only measurement; adopt on n=1 datum | owner | settled |
| 5 | Clamp | adopt network-limit clamp with stub sizing | keep clamp-free | recon fact 10 | open Ask 2 |
| 6 | e2e fix shape | fail-fast preflight + runner warning + skill lesson | skip-if-unarmed; docs-only | owner (root-cause+robust) | settled |
| 7 | PR shape | one gh stack of three (C base → fold → B-lite) | independent PRs; two-PR split | owner | settled |

## Audit verdicts

- Codex (round 1): _pending_
- Fable (round 1): _pending_
- Codex (final fresh-context): _pending_

## Appendix — Competing outline B: "measure-first minimalism"

*The deliberately different angle for the audits.*

**Thesis**: don't restructure anything until the data exists. Phase order inverted: (1) e2e fix; (2) the Testnet measurement script FIRST — including a shape that directly measures what the FOLD needs (can an unstubbed `skipTxValidation` sim discover effects? what's the stub delta on every shape?); (3) then implement ONLY what the data licenses in one shot: if deltas are ~0 across all shapes, skip the conservative intermediate fold entirely and go straight to the end-state (Sponsored 1-sim + PrivateFPC folded P1-stubbed 2-sim) in a single PR — no behavior-preserving decorator interlude, no A1/A2 stepping stones.
**Wins**: no intermediate choreography that exists only to be replaced; the Inference-1 spike becomes a measured fact before any code; fewer pin rewrites (one rewrite instead of two).
**Costs/risks**: a measurement-blocked arc (if testnet is flaky/slow the whole arc stalls, vs outline A landing the fold + e2e fix regardless); the single implementation PR concentrates review; skipping the behavior-preserving extraction step loses the cheap "decorator is provably inert" checkpoint that made last arc's refactors auditable.
**When B beats A**: if the measurement comes back clean in the first day, B ships the same end state with strictly less intermediate code. If measurement stalls or fails the gate, A's structure (fold lands independent of stub adoption) is the better hedge.

## Seeds (DRAFT — finalized post-approval)

### Recommended: `/goal`

```
/goal All phases (C1, A1, A2, B1, B2, B3) marked ✓ in implementations-plan/single-sim-estimates/plan.md (the per-phase headers in the file), each ✓ backed by its validation gate reported passing in the transcript; the B1 measurement table present in lessons with the decision checkpoint outcome stated (proceed vs paused-for-owner — if paused, B2/B3 marked deferred in plan.md counts as complete for this goal); for each completed phase LESSONS_FILE=implementations-plan/single-sim-estimates/lessons/phase-<id>.md printed; the gh stack (PR1 e2e fix → PR2 fold → PR3 measurement+stub) open against dev with required checks green; /code-review max --fix complete with fixes committed separately; codex post-impl audit complete with high/critical findings addressed; bun run test and bun run lint both exit 0 in the transcript.
```

### Alternative: `/loop 15m`

```
/loop 15m Drive implementations-plan/single-sim-estimates forward. Never idle. Each firing: (1) read plan.md + lessons/ (authoritative), git status, git log --oneline -5; PRs → gh pr view --json statusCheckRollup. (2) CI waits are fine if progressing (gh run watch ≤10 min); use waits to prep the next phase. (3) No task? Take the next pending phase; after each meaningful edit run bun run lint + targeted vitest; commit → push. (4) Decisions you'd bring to the owner → /codex xhigh, decide, act, log the consult — EXCEPT the B1 measurement checkpoint: if any delta ≥1%, STOP workstream B, mark B2/B3 deferred in plan.md, surface the numbers, and continue the other workstreams. Hard limits: never merge to main/release branches, never publish/deploy, never stub a payload-inclusive sim for any non-canonical FPC, no scope beyond plan.md. (5) Same step failed 5×? Reassess with codex. (6) Phase green = its plan.md gate passes verbatim → mark ✓, file lessons, print LESSONS_FILE=implementations-plan/single-sim-estimates/lessons/phase-<id>.md. (7) All phases ✓ (or B-deferred)? /code-review max --fix → separate commit → codex post-impl audit → address high/critical → wrap-up report with every contentious call explained ELI5. Keep the ASCII checklist visible.
```

Use exactly ONE per session — they don't compose.
