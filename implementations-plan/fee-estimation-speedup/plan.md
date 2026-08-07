# Plan — fee-estimation-speedup

- **Status**: DRAFT — pending dual audit (codex + fable) + approval gate
- **Tier**: `/blueprint mid` (rubric: blast radius HIGH — every tx's fee sizing; novelty LOW — upstream reference + in-repo precedent for every pattern; irreversibility LOW; migration NONE; external coupling LOW — pinned 5.0.1; security MEDIUM — authwit derivation is an authorization surface)
- **eli5_mode**: artifact
- **Recon**: [recon.md](recon.md) — read it first; every design choice below cites it

## Goal

Cut the number of full ACVM simulations behind every "estimating fee" spinner and every post-confirm dead gap, **without changing what the user sees or how fees are chosen**. Simulations are serialized (PXE write lock + upstream `SerialQueue`), so fewer sims is the only lever.

Committed sim-count targets (default fee method `fpc`, asserted by unit tests):

| Flow | Today | After | Mechanism |
|---|---|---|---|
| Send estimate | 2 sims | **1** | FPC one-pass collapse (Phase 3) |
| dApp op estimate | 3 sims | **2** | collapse + discovery fold (Phases 3–4) |
| dApp confirm (reuse hit) | 3 sims | **0** | estimate→confirm reuse (Phase 5) |
| dApp confirm (reuse miss) | 3 sims | 2 | falls back to the estimate pipeline |
| Every sim/prove | +1 node RPC (`[SYNC-DEBUG]`) | +0 | deletion (Phase 1) |

Non-goals (owner-directed): no UX/product changes; no `getNodeInfo` caching; no approval-window pipeline consolidation; no `/harden` scheduling (owner accepted skip). Out of scope by design: `EmbeddedStrategy`/embedded-FPC cap path, NO_FROM/`default_entrypoint`, `fjwc` reuse eligibility — all keep today's behavior.

## Architecture & Implementation

### Proposed architecture

Three structural moves, all inside `apps/extension/src/wallet/services/execution/` + `packages/aztec-runtime/`, reusing the machinery recon mapped:

1. **`FpcStrategy` collapses to the `fjwc` single-pass shape.** Recon facts 3–4: `buildStandard` already applies `GasSettings.forEstimation()` sizing on every call, and both shipped FPC handlers (`pay_fee`, `sponsor_unconditionally`) take zero args and ignore `maxFee` — Pass 1 exists only to seed Pass 2's gas settings, which `forEstimation` sizing makes redundant. New shape: prepend `fpc.getFeePayload(...)` (inert placeholder `maxFee`) to actions → one `buildStandard(EXTERNAL)` → one sim (`skipFeeEnforcement: true`, as both passes already use) → compute final `maxFee` from measured gas → `finalizeGasLimits` → splice final fee payload + `originalActions` (preserving the audit-pinned mutation discipline verbatim).
2. **Authwit discovery becomes a stage of the strategy pipeline, not a pre-pass.** `AuthwitDiscoverer` splits into (a) a sim runner and (b) a pure extractor `TxSimulationResult → AddPrivateAuthwitAction[]` (same `CallAuthorizationRequest` parse + `computeAuthWitMessageHash` + live-chain-identity assert). On the dApp path the strategy's own pipeline becomes: **sim A** (stubbed + `skipTxValidation` — the stub is the discovery mechanism, recon fact 5 — built with the *real* payment method and FPC payload, unlike today's hardcoded `PREEXISTING_FEE_JUICE` throwaway) → extract effects → if any, splice authwit actions → rebuild → **sim B** (unstubbed, validated — the sizing sim, preserving the in-repo "never size gas off a stub" stance, recon fact 6). No effects ⇒ sim B runs on the identical request. Send path is untouched (it never discovered authwits). Conservative mode is sim-count-neutral for `fj` dApp ops (2→2) and −1 for `fpc` (3→2); its value is one fewer build, a faithful discovery request, and being the enabler for the measurement-gated stretch (see Asks).
3. **`OperationEstimateReuse` generalizes `TransferEstimateReuse`.** Same snapshot fields (`baseFeeFingerprint`, endpoint identity, profile, `pendingHashes`, TTL, single-shot consume), new input fingerprint: a canonical explicit-switch hash over the operation's full `Action[]` graph + fee settings (never `JSON.stringify` — codex-audit-pinned pattern, recon fact 18). `estimateOperationFee` stashes and returns `estimateId` (field already on the wire type, recon fact 9); the execute window records it per op and embeds it in the `Operation[]` payload at approve (the window closes before execution starts — a sibling RPC arg cannot work); `executeAztecSendTx` consumes inside the `runInSlot` scaffold, skipping discovery + `buildAndEstimate` on a hit. Eligibility: `fj`/`fpc`, standard execution mode only — the exact exclusions the existing cache documents.

Supporting moves: delete the unconditional `[SYNC-DEBUG]` header/blockNumber round-trips (deletion, not flag-gating — `ILogger` has no level predicate, recon fact 12); estimate cancellation via an SW-side `AbortController` registry keyed by a per-estimate token with a new `cancelEstimate` RPC modeled on `cancelJob`'s id-keyed pattern (journal-free — estimates have no journal record, recon fact 11). Cancellation stops the next stage from starting; it cannot kill an in-flight ACVM run — stated honestly in tests and docs.

### Key interfaces / types / schemas

- `packages/wallet-bridge` `Operation` (dApp-send shapes): gains **optional** `estimateId?: string`. Popup-injected only; the SW treats it as an untrusted hint — consume validates the full fingerprint against the operation actually executing, so a forged/stale id degrades to a rebuild, never to executing something else.
- `SimulateTxFn` (`fee/fee-strategy.ts:74-79`) + `ExecutionCoordinator.simulateTxTask`: opts gain `stubAccountAddresses?: string[]` (plumbing below the coordinator already exists end-to-end, recon fact 7).
- `ExecutionService` spec/client: new `cancelEstimate(estimateToken: string): Promise<void>` passthrough; `estimateTransferFee`/`estimateOperationFee` accept an optional caller-minted token.
- `FeeStrategyContext`: gains `discovery?: { extract: (sim: TxSimulationResult) => AddPrivateAuthwitAction[] }` (or equivalent) + `signal?: AbortSignal` for stage-boundary checks.
- `IFpcHandler.getFeePayload(fpc, account, maxFee)` signature is **left unchanged** — the params are unused by both shipped handlers but a future budget-checking FPC (the embedded-cap class exists on-chain today) legitimately needs them; a doc comment records this.

### Data & control flow (target, default `fpc`)

- **Send estimate**: `send.vue` → `useFeeEstimation` (cancel-on-refire) → `estimateTransferFee(token)` → planner → `FpcStrategy`: build(EXTERNAL, payload) → sim (validated, unstubbed) → finalize → stash reuse entry → return `estimateId`. **1 sim.**
- **dApp estimate**: `execute/index.vue` → `useFeeEstimationMap` (cancel-on-refire) → `estimateOperationFee(token)` → strategy pipeline: build(real method + payload) → sim A (stub, `skipTxValidation`) → extract effects → [splice authwits → rebuild] → sim B (validated) → finalize → stash `OperationEstimateReuse` entry → return `estimateId`. **2 sims.**
- **dApp confirm**: `approve()` embeds `estimateId` per op → `approveInteraction` → `executeOperations` → `executeAztecSendTx`: inside slot, `tryConsume(estimateId, op)` — hit ⇒ straight to `proveAndSend` (**0 sims**); miss ⇒ estimate pipeline (2 sims), then `proveAndSend`.

### File-level change map

| File | Change |
|---|---|
| `packages/aztec-runtime/src/pxe/service.ts` | delete both `[SYNC-DEBUG]` blocks (proveTx + simulateTx) |
| `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts` | two-pass → single-pass; header comment rewritten to the new invariant |
| `fee/fee-strategy.ts` | `SimulateTxFn` opts + `FeeStrategyContext` extensions |
| `fee/strategies-structural.test.ts`, `fee/fee-structural-parity.test.ts` | deliberate pin updates: call counts, arg order, gas-slot composition (old-vs-new structural pins live here) |
| `authwit-discoverer.ts` (+ test) | split runner/extractor; extractor takes a `TxSimulationResult` |
| `execution-coordinator.ts` | thread stub opts |
| `dapp-send-executor.ts` (+ test) | drop standalone discovery pre-pass in `estimateOperationFee` + `executeAztecSendTx`; consume reuse inside `runInSlot`; NO_FROM path untouched |
| `transfer-estimate-reuse.ts` → generalized (new `operation-estimate-reuse.ts` or parameterized entry) (+ tests) | shared ladder; new action-graph fingerprint fn (+ exhaustive-switch unit tests) |
| `transfer-executor.ts` | unchanged semantics; estimate token + signal wiring |
| `service.ts` | estimate-cancel registry, `cancelEstimate`, reuse carve-out comment updated to the new scope |
| `client.ts` / `spec.ts` | `cancelEstimate` passthrough + token params |
| `packages/wallet-bridge/src/…` (Operation shape) | optional `estimateId` |
| `apps/extension/src/composables/useFeeEstimation.ts` / `useFeeEstimationMap.ts` (+ tests) | mint token, cancel-on-refire/unmount |
| `apps/extension/src/popup/windows/execute/index.vue` | record per-op `estimateId`, embed at approve |

### Algorithms / non-obvious mechanics

- **Action-graph fingerprint**: explicit `switch` over every `Action` kind (`call`, `encoded_call`, `add_capsule`, `add_extra_args`, `add_private_authwit`, `add_public_authwit`) hashing each field deterministically (stable field order, length-prefixed), plus network/account/fee-settings (reusing `fingerprintFeeSettings`). A new `Action` kind must fail the switch at compile time (`never` exhaustiveness) so it can't silently escape the fingerprint.
- **Reuse rejection ladder** (inherited): TTL → fingerprint match → profile → endpoint id+url → base-fee re-fetch compare → pending-tx set. Same-batch drift (op #1 broadcasts between estimate and confirm of op #2) must trip the `pendingHashes` step — covered by a dedicated test.
- **Discovery equivalence**: a test asserts the folded sim A discovers the same authwit set as today's standalone discovery for representative fixtures (recon fact 17: today's discovery builds with a hardcoded wrong payment method; the fold makes the request faithful — the assertion is "superset-faithful, equal on fixtures").

### Trade-offs & alternatives not taken

- **Conservative gas sizing (sim B) over upstream's stub-gas single-sim.** Upstream sizes gas off the stubbed sim + 10% pad; our codebase explicitly refuses ("never for … gas estimation", recon fact 6). We keep our stance — semantics-preserving, zero fee-number drift risk — and collect real stub-vs-real gas deltas in Phase 6 to inform a possible follow-up. Rejected-for-now: adopt upstream parity immediately (would make every dApp estimate 1 sim, but changes gas numbers on an unquantified delta).
- **Payload-embedded `estimateId` over a sibling RPC arg or SW-side correlation.** Forced by the window-closes-before-execution timing (recon fact 9). Rejected: keying by interaction `requestId` (one per window, not per op; discarded before execution).
- **Deletion of `[SYNC-DEBUG]` over flag-gating.** Gating needs an `ILogger.isEnabled` predicate threaded through three packages for a debug line no test reads. Rejected: predicate plumbing (cost > value; can be reintroduced deliberately if wanted).
- **Generalizing the reuse cache over a parallel copy-paste class.** Shared ladder + deps shape, distinct entry/fingerprint types. Rejected: full copy (duplicates the audited validation ladder — rot risk).
- **PR mapping deviation from the pre-recon sketch** (was: collapse isolated last). Recon showed the collapse is near-vestigial-code-removal while the dApp surgery (fold + reuse) is the deep end — so PR B = collapse, PR C = fold + reuse. Surfaced as an Ask.

## Phases

PR mapping (GitHub stacked PRs, official `gh-stack` extension — compatibility with `dev`'s squash ruleset verified in Phase 0; classic chained PRs as fallback):
**PR A** = Phases 0–2 · **PR B** = Phase 3 · **PR C** = Phases 4–6.

### Phase 0 — Preflight: gh-stack + baseline

Install `gh extension install github/gh-stack`; verify a trivial stack against this repo's `dev` ruleset (squash for feature PRs, required checks on mid-stack PRs) on a scratch branch pair; record the workflow (or fall back to classic chained PRs) in `lessons/phase-0.md`. Capture baseline sim counts by running the existing structural tests and noting today's pinned call counts.

**Validation gate** — Commands: `gh stack --help` (or documented fallback decision); `bun run lint && bun run typecheck:all && bun run test`. Pass: exit 0 everywhere; stack-vs-fallback decision recorded. Layers: typecheck/lint/unit.

### Phase 1 — Delete the `[SYNC-DEBUG]` round-trips (PR A)

Remove both blocks in `packages/aztec-runtime/src/pxe/service.ts` (proveTx ~415-424, simulateTx ~452-459). No replacement logging that costs an RPC.

**Validation gate** — Commands: `grep -rn "SYNC-DEBUG" packages/ apps/ | wc -l` → `0`; `bun run lint && bun run typecheck:all && bun run test`. Pass: zero matches, exit 0. Layers: typecheck/lint/unit.

### Phase 2 — Estimate cancellation (PR A)

SW-side: per-token `AbortController` registry in `ExecutionService`; `cancelEstimate(token)` RPC (id-keyed, journal-free, `rpc-cancel.ts` boundary translation reused); stage-boundary `checkCancelled` in the estimate pipelines (before each build / sim / finalize — never mid-sim, stated honestly). A cancelled estimate must NOT stash a reuse entry. Popup-side: `useFeeEstimation`/`useFeeEstimationMap` mint the token, fire `cancelEstimate` on debounce re-fire and unmount. Registry entries removed on completion/cancel (bounded).

**Validation gate** — Commands: `bun run --cwd apps/extension vitest run src/wallet/services/execution src/composables/useFeeEstimation.test.ts src/composables/useFeeEstimationMap.test.ts` then `bun run lint && bun run typecheck:all && bun run test`. Pass: new cancel tests green (cancel-before-pipeline idiom from `transfer-executor.test.ts:170-186`; no-stash-on-cancel; registry cleanup), full suite exit 0. Layers: typecheck/lint/unit.

### Phase 3 — FPC one-pass collapse (PR B)

Rewrite `FpcStrategy.buildAndEstimate` to the single-pass shape (architecture §1). Preserve the `originalActions` capture/splice discipline verbatim. Update `strategies-structural.test.ts` pins deliberately: `buildStandard` ×1 with `EXTERNAL`, `simulateTxTask` ×1, and add the **old-vs-new structural pin**: final `txRequest.txContext.gasSettings` composition (totalGas/teardown/baseFee slots via the sentinel idiom) and final action ordering (fee payload first, then `originalActions`) match the two-pass output shape. Send-page estimate sim count drops 2→1 (asserted).

**Validation gate** — Commands: `bun run --cwd apps/extension vitest run src/wallet/services/execution/fee` then `bun run lint && bun run typecheck:all && bun run test`; **milestone e2e**: `bun run e2e:agent tests/e2e/network/transfers.test.ts` and `bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts` (Sponsored-FPC-paid transfer confirmed on-chain + dApp execute with real proof). Pass: all exit 0. Layers: typecheck/lint/unit + network e2e.

### Phase 4 — Discovery fold (PR C)

Split `AuthwitDiscoverer` into runner + pure extractor; thread `stubAccountAddresses` through `SimulateTxFn`/coordinator; make the dApp-path strategy pipeline run sim A (stub + `skipTxValidation`, real method + payload) → extract → conditional splice/rebuild → sim B (validated, sizing). Remove the standalone pre-pass from `estimateOperationFee` and `executeAztecSendTx`. NO_FROM and `EmbeddedStrategy` opt-outs untouched. Discovery-equivalence test (architecture §Algorithms).

**Validation gate** — Commands: `bun run --cwd apps/extension vitest run src/wallet/services/execution` then `bun run lint && bun run typecheck:all && bun run test`. Pass: updated structural pins green (dApp `fpc` estimate: builds ×2, sims ×2; `fj`: ×2/×2), extractor + equivalence tests green, full suite exit 0. Layers: typecheck/lint/unit.

### Phase 5 — dApp estimate→confirm reuse (PR C)

Generalized reuse cache + action-graph fingerprint (+ exhaustive-switch compile guard); `estimateOperationFee` stashes + returns `estimateId`; `execute/index.vue` embeds per-op `estimateId` at approve; `executeAztecSendTx` consumes inside `runInSlot`; eligibility `fj`/`fpc` standard mode; cancelled estimates never stash (ties to Phase 2). Update the `service.ts` carve-out comment to the new scope.

**Validation gate** — Commands: `bun run --cwd apps/extension vitest run src/wallet/services/execution src/popup/windows/execute` then `bun run lint && bun run typecheck:all && bun run test`. Pass: full rejection-ladder tests (every exit, incl. same-batch `pendingHashes` drift), consume-path pin (discovery + `buildAndEstimate` NOT called on hit — `transfer-executor.test.ts:121` idiom), forged/stale-id degrades-to-rebuild test, full suite exit 0. Layers: typecheck/lint/unit.

### Phase 6 — End-to-end validation + stub-gas measurement (PR C)

Full gates: `bun run audit:vue`; `bun run test:e2e` (smoke — execute window + composables were touched); **full** `bun run e2e:agent` (network suite; includes the canary pair and the dApp sendTx files). Then the measurement task: a throwaway instrumented run (local only, not committed) logging sim A (stub) vs sim B (real) `gasUsed` for representative ops; record the deltas in `lessons/phase-6.md` — this is the data for the deferred stub-gas stretch decision, not an implementation.

**Validation gate** — Commands: `bun run audit:vue && bun run test:e2e && bun run e2e:agent`. Pass: all exit 0 (known-skipped network cases per `network-test-triage` remain skipped, not newly red); measurement table present in lessons. Layers: typecheck/lint/unit + smoke e2e + full network e2e.

## Security & Adversarial Considerations

- **Threat model**: a malicious dApp (hostile `Operation` payloads via the RPC bridge), a compromised popup renderer is out of scope (it already holds approval power), and ourselves (fee-sizing bugs costing users money or stranding txs).
- **Authwit surface (the sharp edge)**: discovered authwits become real signatures via `account.createAuthWit` at build time. The fold must not widen what gets auto-signed: the extractor keeps the exact `CallAuthorizationRequest.fromFields` parse + `computeAuthWitMessageHash` + live-chain-identity assertion (the F-012/A-01 V-01 pattern) — pinned by the discovery-equivalence test. Sim A runs with the *real* fee payload, so a hostile payload can't cause authwits to be derived for calls that aren't in the tx being signed.
- **Reuse-cache integrity**: `estimateId` is SW-minted (`crypto.randomUUID`), single-shot, TTL-bounded; the consume path re-validates the full action-graph fingerprint against the operation actually executing plus profile/endpoint/base-fee/pending-tx drift. A dApp-forged or replayed id can only cause a cache miss → full rebuild. The fingerprint's exhaustive switch fails compilation on new `Action` kinds — no silent field escapes. `ExecutionFence` stays confirm-time-captured, never cached.
- **No stub output ever reaches proving**: stub sims produce only `AddPrivateAuthwitAction` hashes; gas is sized exclusively from validated unstubbed sims; the reused `txRequest` at confirm is the validated build. Test-pinned.
- **Cancellation**: id-keyed, profile-scoped like `cancelJob`; cancelling an estimate can't touch journalled executions; registry is bounded and cleaned up.
- **Input validation**: all popup/dApp-supplied fields crossing to the SW (`estimateId`, token) are treated as untrusted strings — length-capped, used only as map keys.
- **Least privilege / supply chain / crypto**: no new dependencies, no workflow changes, no crypto code — all hashing via existing in-repo fingerprint utilities and `@aztec/*` 5.0.1 primitives already pinned. Lockfile untouched except nothing.
- **Domain risks**: front-running/replay unaffected (nonce semantics unchanged — reuse carries the estimate-time `Fr.random()` nonce exactly as the shipped Send reuse does); fee-griefing bounded by unchanged `gasPadding` 1.05 and `predictedWorstMinFees` basis; censorship/reorg posture unchanged.

## Assumptions

### Facts (verified — see recon.md for file:line)

1. Both shipped FPC handlers ignore `account`/`maxFee` and take no args (`pay_fee`, `sponsor_unconditionally`) — recon fact 4.
2. `buildStandard` unconditionally applies `forEstimation` gas sizing via `NuloAccount.buildTxExecutionRequest` → `completeFeeOptions({forEstimation: true})` — recon fact 3.
3. All Nulo sims already run kernel-less (`skipKernels: true` upstream default, never overridden) — recon fact 1.
4. `TxSimulationResult` exposes `offchainEffects` + `gasUsed` off one object at 5.0.1 — recon fact 2.
5. `stubAccountAddresses` plumbing exists end-to-end below the coordinator; the coordinator drops it — recon fact 7.
6. `TransferFeeEstimate.estimateId` exists on the wire type, unpopulated on the dApp path; no per-op identity survives approve (window closes, fire-and-forget) — recon fact 9.
7. `cancelJob` is journal-gated and no-ops for estimates; no `AbortSignal` crosses the messaging layer — recon fact 11.
8. `ILogger` has no level predicate; the `[SYNC-DEBUG]` RPCs fire before any filtering; no test reads those lines — recon fact 12.
9. Composition tests cannot cover fee estimation (shallow-PXE ∧ bb-free ∧ no-simulate rules); the unit idiom for call-count pins already exists in `strategies-structural.test.ts` — recon facts 13–14.
10. GitHub stacked PRs are in public preview with the official `github/gh-stack` extension — recon §Environment.

### Inferences (attackable)

1. `skipTxValidation: true` does not change `gasUsed` for a tx that needs no authwits (sim B exists precisely so this only matters for the no-effects fast-path equivalence; if wrong, sim B still corrects it). Confidence: moderate.
2. The FPC fee-payload calls never require caller authwits (empirical: today's validated, unstubbed Pass-2 sims succeed with no discovery over the payload). Confidence: high.
3. Sim A with the real payment method + payload discovers a superset-faithful (equal on our fixtures) authwit set vs today's `PREEXISTING_FEE_JUICE` throwaway build. Confidence: high; test-pinned in Phase 4.
4. Collapsing FPC to one pass leaves the final `gasSettings`/`maxFee` within normal estimate variance (both passes already ran `skipFeeEnforcement`; `finalizeGasLimits` recomputes from measured gas either way). Displayed fee numbers may shift marginally — surfaced as Ask 3. Confidence: high for correctness, certain for "numbers may shift".
5. `gh-stack` works under `dev`'s ruleset (squash-for-feature-PRs + required checks). Confidence: low — that's why Phase 0 verifies before anything lands; fallback is classic chained PRs.

### Asks (approval-gate decisions)

1. **Stub-gas stretch**: defer the upstream-parity single-sim mode (size gas off the stubbed sim + pad) to a possible follow-up, decided on Phase 6's measured deltas? **Recommendation: defer + measure.**
2. **PR mapping deviation**: PR B = FPC collapse, PR C = fold + reuse (recon inverted the risk ranking vs the pre-recon sketch you approved). **Recommendation: accept.**
3. **Marginal fee-number drift**: the collapse computes `maxFee` from one sim instead of two — displayed estimates may differ by small amounts (same padding, same fee basis). Confirm this counts as "backend-only" under your no-UX-changes constraint. **Recommendation: accept.**

## Decision ledger

| # | Decision | Chosen | Rejected | Source | Status |
|---|---|---|---|---|---|
| 1 | Gas sizing basis | validated unstubbed sim (in-repo stance) | upstream stub-gas + pad (now) | recon facts 5–6 | open Ask 1 (defer+measure) |
| 2 | estimateId transport | embedded in `Operation[]` payload | sibling RPC arg; requestId correlation | recon fact 9 | settled |
| 3 | SYNC-DEBUG | delete | flag-gate via new `ILogger` predicate | recon fact 12 | settled |
| 4 | Reuse cache shape | generalize ladder, new entry+fingerprint | parallel copy | recon fact 18 | settled |
| 5 | PR ordering | A=quick wins, B=collapse, C=fold+reuse | collapse-last (pre-recon sketch) | recon facts 3–4 | open Ask 2 |
| 6 | `IFpcHandler` signature | keep unused params + doc | drop params | recon fact 4 (embedded-cap contrast) | settled |
| 7 | Sim-count test layer | unit (`strategies-structural` idiom) | composition | recon facts 13–14 | settled |

(Audit outcomes appended below as they land.)

## Audit verdicts

- Codex (round 1): _pending_
- Fable (round 1): _pending_
- Codex (final fresh-context): _pending_

## Appendix — Competing outline B: upstream-parity rewrite

*The deliberately different angle, per protocol. Goes to both auditors alongside the main draft.*

**Thesis**: stop maintaining a divergent estimation pipeline; adopt the upstream `EmbeddedWallet.sendTx` shape wholesale. ONE stubbed, kernel-less, `skipTxValidation` sim per estimate — for every strategy, both flows — whose result yields authwits (offchain effects) AND gas (accept stub-derived `gasUsed`, raise `gasPadding` 1.05 → 1.10 to match upstream's margin). All four strategies share one pipeline (`build(real method + payload) → stub sim → splice authwits → rebuild`) differing only in payload preparation. Estimate→confirm reuse identical to outline A. Land as one PR (the strategies stop being independently shaped, so slicing fights the diff).

**Wins**: every estimate (send AND dApp, all kinds) = **1 sim**; dApp confirm = 0/1; ~40% less strategy code; maximal upstream alignment (future 5.x bumps track `EmbeddedWallet` semantics directly).
**Costs/risks**: sizes gas off stub sims against the explicit in-repo prohibition (unquantified delta — if stub gas under-measures beyond the pad, txs fail at proving/inclusion); changes displayed fee numbers more than outline A (padding bump); one big PR concentrates review risk; touches `fj`/`fjwc`/`embedded` semantics that outline A leaves untouched, widening the e2e surface that must re-prove.
**When B beats A**: if Phase-6-style measurement shows stub-vs-real deltas are consistently ≪ 5%, outline A's sim B is pure waste and B's shape is where this should converge — A is then the safe first step of B, not a competitor.

## Seeds (DRAFT — finalized post-approval)

### Recommended: `/goal`

```
/goal All phases 0–6 marked ✓ in implementations-plan/fee-estimation-speedup/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/fee-estimation-speedup/lessons/phase-N.md in the transcript; the three stacked PRs (A: phases 0-2, B: phase 3, C: phases 4-6) opened against dev with required checks green; /code-review max --fix complete with findings applied and committed; codex post-impl audit complete with high/critical findings addressed; bun run test and bun run lint both report exit 0 in the transcript.
```

### Alternative: `/loop 15m`

```
/loop 15m Drive implementations-plan/fee-estimation-speedup forward. Never idle waiting for my input. Each firing: (1) Reality check: read plan.md + lessons/ (authoritative state), git status, git log --oneline -5; if PRs exist, gh pr view --json statusCheckRollup (no --watch). (2) Waiting on CI is fine — confirm it progresses (gh run watch <id> ≤10 min); use waits to review the diff or prep the next phase. (3) No task in hand? Pick the next pending phase from plan.md and start it; after each meaningful edit run bun run lint + targeted vitest for touched packages; commit → push. (4) Stuck or facing a decision you'd bring to the owner? Call /codex xhigh, reach a defensible decision, act, log the consult in lessons/phase-N.md. Hard limits: never merge to main/release branches, never publish/deploy, never expand scope beyond plan.md. (5) Same step failed 5 times? Stop retrying, reassess with codex. (6) Phase green = its validation gate in plan.md passes verbatim — run it, paste the result, mark ✓ in plan.md, file lessons, print LESSONS_FILE=implementations-plan/fee-estimation-speedup/lessons/phase-N.md, advance. (7) All phases ✓? Run /code-review max --fix → commit fixes separately → codex post-impl audit (net diff + code-review summary + adversarial ask) → address high/critical → wrap-up report. Keep the ASCII checklist visible each firing.
```

Use exactly ONE per session — they don't compose.
