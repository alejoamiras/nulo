# Plan — single-sim-estimates

- **Status**: REVISION 3 (post dual audit + final codex pass) — pending codex re-verdict + approval gate
- **Tier**: `/blueprint mid` (rubric: security HIGH — authwit auto-sign surface + contract-identity argument; blast radius MED-HIGH — dApp estimate gas sizing; novelty LOW; irreversibility LOW; migration NONE; external coupling LOW. `deep` arguable; `mid` per owner invocation, hazard surfaces flagged hostile in every packet)
- **eli5_mode**: file
- **Recon**: [recon.md](recon.md) (incl. audit erratum) · **Audits**: [audit-codex.md](audit-codex.md) (r1 `reject` — both blockers verified, adopted) · [audit-fable.md](audit-fable.md) (r1 `conditional approve` — all 4 conditions adopted; advisories F-5–F-10 adopted) · **Binding precedent**: `implementations-plan/fee-estimation-speedup/` charter + ledger

## Revision 2 — what the audits changed

1. **Measure-first resequencing (both auditors, blocking).** The r1 draft shipped the stubbed PrivateFPC fold (A2) in PR 2 *before* the PR-3 measurement gating stub adoption — violating the plan's own ledger and the owner's rule. New order: **C1 → A1 (inert) → B1 (measurement) → gate → A2 → B2 → B3**; nothing stub-influenced lands before its measurement.
2. **Inference 1 is now a verified FACT (both, from source): unstubbed discovery is impossible.** `UtilityExecutionOracle.getAuthWitness` throws on a missing witness before any result exists (`utility_execution_oracle.js:266-271`, reached via the account's `verify_private_authwit` oracle call); `skipTxValidation` only gates the post-execution `node.isValidTx`. The r1 "unstubbed P1 fallback" is deleted; **if B1 fails the gate, the PrivateFPC fold is abandoned (A2 reverted), not tweaked**.
3. **dApp `fj` fold added (codex H1)**: `FeeJuiceStrategy`'s sim is app-only and payload-free — with measured stub gas, no-effects dApp `fj` folds **2→1** more safely than Sponsored (no payload in the stub at all). The r1 narrowing was incomplete.
4. **`DiscoveryProbe` respecified (both — the ledger-#11 trap, again).** Extraction is chain-bound: the probe is `extractEffects(sim, {node, network}): Promise<AddPrivateAuthwitAction[]>`, preserving the lazy `getNodeInfo`-only-if-effects ordering AND the `assertLiveChainIdentity` guard (F-012/A-01 — dropping it would weaken hash derivation against a drifted RPC). **Constructor-injected** (the "into the strategy call" wording is dead — that reading is the forbidden context-hook): the service keeps its probe-free strategy map for the send path; the decorator owns a second, probe-bearing `FpcStrategy`/`FeeJuiceStrategy` instance pair. A structural pin asserts the send-path instances carry no probe. Owned trade, stated plainly: `FpcStrategy` DOES grow dApp-only branching (extract/splice/conditional-rebuild) — accepted as strictly better than exporting the pass structure.
5. **Intent-hash authwit corner closed (fable F-4, from Noir source).** Call-shaped authwit consumption emits its `CallAuthorizationRequest` effect UNCONDITIONALLY (even with a valid witness attached) — so call-authwit ops always surface effects under a stub and re-validate via the rebuild. But standalone intent-hash authwits emit NOTHING: an op pre-carrying `add_private_authwit` actions could size from a stub with unverified witnesses. **Rule: any op whose pre-discovery actions already contain `add_private_authwit` takes the validated path (no 1-sim fold)**; extraction runs on the FIRST sim only (re-sims re-emit — double-splice hazard); discovered hashes dedup against pre-attached ones. The safety sentence, restated precisely: call-shaped authwits re-validate by unconditional emission; intent-shaped are excluded by rule; nothing sizes from a stub carrying unverified witnesses.
6. **Ask 1 rewritten honestly (codex H2 + fable F-5).** There is NO validation backstop on the happy path: reuse-miss runs this same pipeline, and a reuse-HIT runs zero sims — so post-B2 the no-authwit dApp Sponsored/fj flow has no pre-proof `isValidTx` anywhere (losses: node-side double-spend/nullifier, instance validity, gas admission, expiry — failure moves to post-proof `sendTx`; the node still rejects, no on-chain safety loss). Counterweights: −1 node RPC per estimate (validation's own round-trip), and the inclusion canary. The owner accepts THIS, or B2 shrinks.
7. **Clamp respecified (both).** Full upstream semantics: cap auto-derived limits at min(node-advertised `txsLimits.gas`, protocol maxima) and **throw when simulated usage already exceeds admission**; dApp `customLimits` are validated (assert-and-throw), not silently capped — an explicit behavior line-item since it touches fj/fjwc custom-limit ops beyond B's scope. Lands as its own commit with per-path pins.
8. **Measurement hardened (both)**: arms must hold the build shape constant (Nulo-shaped entrypoints — EXTERNAL+payload / PREEXISTING app-only — not aztec.js defaults), differ ONLY in `{stub, skipTxValidation}`; ≥2 interleaved repeats per arm with the noise floor reported; one shape cross-checked through Nulo's own pipeline (the prior datum's higher-fidelity method); shapes now include a real delegated-private-call (`CallAuthorizationRequest`-emitting) transfer, an undeployed-account shape, per-dimension (DA vs L2) deltas, and the **PrivateFPC P2-envelope comparison** (P2 simmed under stub-P1-derived vs real-P1-derived envelopes). The **funded PrivateFPC inclusion canary** needs L1 fee-juice (Sepolia key — `fuel-testnet.ts` route); surfaced as Ask 4 with a stated fallback.
9. **Smaller adoptions**: cross-chain-row bail re-enters the FOLDED two-pass (fable F-8; B2 gate test); C1 preflight is a file-level hard abort, not a sibling test (F-10); the runner guard scans a formal marker, not prose (codex Low); recon fact-10 erratum recorded (upstream ships stub-sized+clamped — strengthens this plan's direction); adversarial fixture must include the user-mintable sponsored-TYPED non-canonical row (fable §1a).

## Goal

| Flow | Today | After | Mechanism / gate |
|---|---|---|---|
| dApp Sponsored estimate (no-authwit) | 2 | **1** | folded stubbed payload-inclusive sim; contract-identity pin (audited airtight); B1-gated |
| dApp `fj` estimate (no-effects) | 2 | **1** | folded stubbed app-only sim (payload-free); B1-gated |
| dApp PrivateFPC / user-added estimate | 3 | **2** — CONDITIONAL on Ask 4(a) | discovery folds into stubbed P1; P2 real+validated forever; gated on the FUNDED measurement (no key ⇒ stays 3, A2 deferred) |
| dApp any-method, authwit-bearing / intent-carrying | 2–3 | 2 | forced validated path (F-4 rule) — validation REGAINED relative to r1 |
| Send page / confirm-reuse / embedded / NO_FROM | — | unchanged | out of reach or fenced |

Workstream C (e2e arming fix) unchanged from r1. Non-goals unchanged.

## Architecture & Implementation

### Components

**`DiscoveryAwareEstimator`** (`execution/discovery-aware-estimator.ts`, owned + invoked only by `dapp-send-executor`): replaces both inline discovery call sites. Holds its OWN probe-bearing strategy instances (constructed once with `DiscoveryProbe`); the service's map stays probe-free for the send path. **Dependency separation (final-pass H2)**: `DappSendExecutorDeps` splits into two DISTINCTLY-TYPED deps — `buildAndEstimateValidated` (probe-free; used by `executeSendTransaction`, embedded, and every non-fold path) and `estimateWithDiscovery` (the decorator; used ONLY by the `aztec_sendTx` estimate + confirm-miss sites) — so the probe-forbidden routes cannot reach probed instances by construction. Zero-probe/zero-stub tests pin Transfer, `executeSendTransaction`, embedded, and NO_FROM; the A1 gate pins **sim OPTIONS** (`stubAccountAddresses` absent + validation enabled) on every unchanged path, not merely call counts. Pipeline per estimate/confirm-miss:

1. Snapshot check: pre-discovery actions containing `add_private_authwit` ⇒ **validated path** (today's choreography: standalone discovery + validated strategy sims) — the F-4 rule.
2. Else dispatch to the probed strategy: the strategy's first sim runs stubbed (`stubAccountAddresses` via the wired opts) + `skipTxValidation`; the strategy calls `probe.extractEffects(sim, {node, network})` — first sim only.
3. No effects ⇒ (fj/Sponsored) that sim is also the sizing sim (1 total) / (PrivateFPC) proceed to validated P2 (2 total).
4. Effects ⇒ dedup vs pre-attached → splice → rebuild → **validated** re-sim → size from the validated sim (2 total; validation regained).
5. Cross-chain-row bail (fpc fast path) re-enters the FOLDED two-pass, not the legacy one.

**`DiscoveryProbe`** (chain-bound, ledger-#11-compliant): `extractEffects(sim: TxSimulationResult, ctx: {node: AztecNode; network: Network}): Promise<AddPrivateAuthwitAction[]>` — wraps `AuthwitDiscoverer`'s existing extraction chain verbatim: `collectOffchainEffects` → parse → lazy `node.getNodeInfo()` ONLY if effects → `assertLiveChainIdentity(network, nodeInfo)` → `computeAuthWitMessageHash`. The standalone discoverer remains for the validated path.

**`finalizeGasLimits` clamp** (own commit): auto-derived limits capped at min(retained `txsLimits`, protocol maxima), throw-on-exceed for measured usage; `customLimits` assert-and-throw per **Ask 2**. Per-path pins for **every** served path: fj/fjwc/fpc/send/**embedded/NO_FROM** (ledger #14).

**Measurement script** (`packages/bridge-core/scripts/gas-delta-testnet.local.ts`, disposable): shapes = (1) public transfer + sponsor payload [Nulo-pipeline cross-check shape], (2) `transfer_private_to_private`, (3) delegated private call consuming a call-shaped authwit, (4) undeployed-account, (5) PrivateFPC P1 app-only, (6) PrivateFPC P2-envelope comparison. Arm-fidelity invariant + ≥2 interleaved repeats + DA/L2 split. Sponsored inclusion canary (free); PrivateFPC inclusion canary per Ask 4.

**e2e fix**: preflight as file-level `beforeAll` hard abort (stamp check, remedial message); `agent.sh` scans a formal `// @requires-proverless` marker; skill lesson.

### Interfaces, flow, files — deltas from r1 only

- `FeeStrategyContext` untouched (no hook). `FeeEstimate extends BuiltStandardTx` untouched. Wire types untouched. `preDiscoveryActions` normalization point untouched (symmetry test).
- File map r1 + `fee/fee-juice-strategy.ts` (probe variant), minus the impossible fallback branch.

### Trade-offs (post-audit)

- **A-with-resequencing over outline B**: fable's stall-hedge argument decides it (a flaky-testnet week must not block C + the inert fold), with B's one structural insight (measure before stub) absorbed. A1's inert interlude retained — last arc proved inert checkpoints make this surface auditable.
- **Stub-or-abandon over stub-or-flag** for A2: the fallback is now known-impossible; a flag would be dead-code theater.
- **F-4 exclusion rule over intent-hash effect synthesis**: synthesizing effects for intent authwits would mean re-implementing account semantics wallet-side; exclusion is honest and cheap (intent-carrying dApp ops are rare and keep today's exact behavior).

## Security & Adversarial Considerations

r1 model plus the audit outcomes: the Sponsored identity pin is **verified airtight** (storage laundering, type-spoofed rows, cold cache, resets — every failure direction denies the fast path); the adversarial fixture must include the sponsored-typed non-canonical row; the F-4 rule guarantees nothing sizes from a stub with unverified witnesses (call-shaped: by unconditional protocol emission; intent-shaped: by exclusion); validation-loss is enumerated honestly in Ask 1 (no pre-proof `isValidTx` on the no-authwit happy path — node still rejects post-proof); measurement + canary gate all sizing changes; the `assertLiveChainIdentity` guard is pinned as preserved through the probe.

## Assumptions

### Facts (verified; recon.md + erratum)

r1 facts 1–10 stand, with fact 10 corrected (upstream ships stub-sized + clamped + padded sends). NEW: 11. Unstubbed discovery hard-fails pre-result (oracle throw; source refs in erratum) — both auditors, independently. 12. Call-shaped authwit consumption emits effects unconditionally; standalone intent-hash emits nothing (aztec-nr v5.0.1 Noir source — fable). 13. Estimate-time validation costs one `node.isValidTx` RPC (`pxe.js:796-806`). 14. No bridge-core `.env` exists on this machine (PrivateFPC canary funding not currently available).

### Inferences (attackable)

1. Stub-vs-real deltas on the new shapes match the 0 datum. Moderate; nothing ships on it (B1 gates).
2. Fresh ephemeral PXE syncs against testnet in acceptable time. Moderate; B1's first task validates.
3. Armed `account-switch-isolation` is green locally. High; C1 verifies first.

### Asks (approval-gate decisions)

1. **Validation-loss, stated fully**: post-B2, the no-authwit dApp Sponsored/fj estimate has NO pre-proof node validation anywhere on the reuse-hit happy path (enumerated losses above; failure surfaces post-proof; ops with PRE-ATTACHED authwits keep validation). **Plus one undetectable-at-estimate class (final-pass H1)**: an app contract requiring a standalone inner-hash authwit the user never attached emits NO effect under the stub — the folded sim reports "no effects," sizes from the stub, and the failure surfaces as a **loud pre-submit proving error** (missing-witness oracle throw; wasted prove, nothing on-chain, funds safe). Today that same op fails loudly at estimate time instead. An adversarial fixture pins this failure mode explicitly. Accept the full trade for 2→1? **Recommendation: accept — the class is rare (inner-hash-requiring contracts without attached witnesses), the failure is pre-submit and loud, and the win applies to every normal dApp op.**
2. **Clamp adoption — full blast radius (final-pass M1)**: shared `finalizeGasLimits` also serves **Embedded and NO_FROM** — the clamp touches every path, enumerated with per-path pins (fj/fjwc/fpc/send/embedded/NO_FROM; gas vs teardown custom-limit semantics each pinned). RPC posture: the builder already fetches `getNodeInfo` — `BuiltStandardTx` retains the node-advertised `txsLimits` alongside `chainIdentity`, so the clamp adds ZERO extra RPCs (preserving the −1 net win). **Recommendation: yes, with the enumeration.**
3. **Sponsored canary tx** on public testnet (free, throwaway account). **Recommendation: accept.**
4. **PrivateFPC measurement is key-conditional — the r2 "free fallback" was WRONG** (final-pass Critical): P2 simulation itself requires private-fee-juice notes (`pay_fee` asserts balance in-circuit; `skipFeeEnforcement` does not bypass Noir asserts), and funding private FJ IS the L1 route (`fuel-testnet.ts` — Sepolia key + deposit). There is no unfunded path to shapes 5b/6 OR the canary. Real options: **(a)** provision the Sepolia key → full funded PrivateFPC measurement incl. a **fragmented-note inclusion canary** (round-1 requirement, restored) → A2 eligible under the <1% rule; **(b)** no key → **A2 (the PrivateFPC 3→2 fold) is DEFERRED from this arc** — B2's Sponsored+fj folds proceed independently (their shapes are SponsoredFPC-paid, genuinely free). **Recommendation: (a) if the key is at hand (the bridge-core `.env` convention already exists for it); otherwise (b) and A2 waits.**

## Phases

PR mapping (one `gh stack`): **PR 1** = C1 · **PR 2** = A1 + B1 (lessons/data only) — **PR 2 merges only after B1's B2/free checkpoint passes** · **PR 3** = A2 + B2 + B3.

### Phase C1 — e2e verify + arming preflight (PR 1)

As r1, plus: preflight = file-level hard abort; runner scans formal marker.
**Gate** — armed run 2/2 green; unarmed run aborts <30 s with remedial text; `lint`/`typecheck:all`/`test` exit 0.

### Phase A1 — Inert decorator extraction (PR 2)

Behavior-preserving: decorator + probe-bearing instances constructed but the probed path NOT yet enabled (probe wired, fold flags off — all sims validated, counts unchanged). Assertion-surface migration for the discovery pins done here deliberately.
**Gate** — all count pins unchanged in value; **sim-OPTION pins on every unchanged route** (Transfer, `executeSendTransaction`, embedded, NO_FROM, all send-page strategies: `stubAccountAddresses` absent AND `skipTxValidation` not set — inertness proven at the options level, not counts alone); send-path-no-probe structural pin; `preDiscoveryActions` symmetry test; full unit suite exit 0.

### Phase B1 — Testnet measurement + decision checkpoint (PR 2 data)

Free shapes (1–4: public+sponsor, private transfer, delegated call-authwit, undeployed account) + Sponsored inclusion canary always run. **PrivateFPC shapes (5: P1 app-only; 6: P2-envelope comparison) and the fragmented-note PrivateFPC inclusion canary run ONLY under Ask 4(a)** — they require funded private fee juice (no unfunded path exists; final-pass Critical). Arm-fidelity invariant, interleaved repeats, noise floor, DA/L2 split, Nulo-pipeline cross-check. Table → `lessons/phase-B1.md`.
**Checkpoint (owner rule, SPLIT per workstream)**: **B2 gate** = free shapes 1–4 + Sponsored inclusion canary — every delta <1% ⇒ B2 proceeds; any ≥1% ⇒ B2 deferred, numbers presented. **A2 gate** = funded shapes 5–6 + fragmented-note PrivateFPC canary — requires Ask 4(a); ran AND every delta <1% ⇒ A2 proceeds; not run (no key) OR any ≥1% ⇒ A2 deferred. The gates are independent — a no-key arc can still ship B2.
**Gate** — table complete per spec; zero committed script footprint.

### Phase A2 — PrivateFPC fold (PR 3; B1-gated AND Ask-4(a)-conditional)

**Runs only if the Sepolia key was provisioned and the funded PrivateFPC measurement (incl. fragmented-note inclusion canary) passed the <1% rule; otherwise marked DEFERRED and PR 3 ships B2 alone.** P1 stubbed + probe; F-4 rule + first-sim-only + dedup; folded bail; adversarial fixtures (sponsored-typed non-canonical row + the standalone inner-hash class from Ask 1). dApp `fpc` 3→2 pins.
**Gate** — pins + fixtures + discovery-equivalence; full unit; milestone e2e: `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts`.

### Phase B2 — Sponsored + fj 1-sim folds + clamp (PR 3; B1-gated)

Fast-path and fj probed folds (no-effects 1-sim; effects ⇒ validated rebuild); clamp commit with per-path pins; fixture extension.
**Gate** — updated pins (dApp Sponsored/fj 2→1 no-authwit; authwit-bearing ⇒ validated 2); full unit; same milestone e2e pair prover-ON.

### Phase B3 — Full validation (PR 3)

**Gate** — `bun run audit:vue`; armed smoke; full `NULO_E2E_PROVERLESS=1 bun run e2e:agent` — all exit 0.

## Decision ledger

| # | Decision | Chosen | Rejected | Source | Status |
|---|---|---|---|---|---|
| 1 | Fold boundary | decorator + constructor-injected chain-bound probe; two-instance ownership; send-path structural pin | ctx-hook (forbidden); one-arg pure extractor (ledger-#11 trap, re-caught) | charter + both audits | settled |
| 2 | Reach | dApp Sponsored 2→1, fj 2→1 (B2, free-gated); PrivateFPC 3→2 (A2, **Ask-4(a)-conditional** per #11); authwit/intent-bearing ⇒ validated | r1's fj omission (codex: "lazy"); send-page; P2 stubbing (permanent fence) | codex H1 + recon + final pass | settled |
| 3 | Sponsored 1-sim safety | contract identity — audited airtight; fixture incl. type-spoofed row | app-only rule | fable §1a | settled |
| 4 | Sequencing | measure-first: B1 before any stub adoption; PR2 merge-gated on the B2/free checkpoint | r1's A2-before-B1 (violated own gate) | both (blocking) | settled |
| 5 | A2 fallback | stub-or-abandon (unstubbed discovery proven impossible) | r1's unstubbed-P1 fallback; flag | both, from source | settled |
| 6 | Intent-hash authwits | excluded from folds (forced validated path) | effect synthesis | fable F-4 | settled |
| 7 | Ask-1 framing | full honesty: no pre-proof validation on happy path | r1's false reuse-miss backstop | codex H2 + fable F-5 | open Ask 1 |
| 8 | Clamp | full upstream semantics + customLimits assert-throw line-item, own commit | constants-only cap | both | open Ask 2 |
| 9 | PrivateFPC canary (r2 framing) | SUPERSEDED by #11 — the r2 "proceed-without" option was non-executable | — | codex C2 → final-pass Critical | superseded |
| 10 | Outline B | rejected; measure-first insight absorbed | adopt B (stall risk; spike moot — resolved from source) | both | settled |
| 11 | PrivateFPC measurement/A2 | key-conditional: funded full measurement + fragmented-note canary, else A2 DEFERRED | r2's "free envelope-sim fallback" (non-executable — P2 needs funded private FJ) | final-pass Critical | open Ask 4 |
| 12 | Inner-hash silent class | named in Ask 1 + adversarial fixture (loud pre-submit prove failure; estimate-time catch lost) | r2's claim of full coverage via pre-attached rule | final-pass H1 | open Ask 1 |
| 13 | Probe route isolation | split typed deps (validated vs discovery-aware) + zero-probe/zero-stub OPTION pins on Transfer/send_transaction/embedded/NO_FROM | two-instance ownership alone (route through shared dep unpinned) | final-pass H2 | settled |
| 14 | Clamp RPC + blast radius | retain `txsLimits` on `BuiltStandardTx` (zero new RPCs); per-path enumeration incl. embedded/NO_FROM | live re-fetch (negates −1 RPC win); partial enumeration | final-pass M1 | settled |

## Audit verdicts

- **Codex (r1, fresh, xhigh)**: `reject` — 2 blockers (sequencing, measurement gaps incl. PrivateFPC funding) + H1 fj fold + H2 Ask-1 backstop + H3 probe — ALL adopted. [audit-codex.md](audit-codex.md)
- **Fable (r1, fresh)**: `conditional approve` — 4 conditions (probe respec, Inference-1 fact + resequencing, injection story, F-4 rule) + advisories F-5–F-10 — ALL adopted. Sponsored pin verified airtight. [audit-fable.md](audit-fable.md)
- **Codex (final fresh-context pass on rev 2)**: `reject` — Critical (Ask-4(b) fallback non-executable: P2 sims need funded private FJ, no unfunded path; fragmented-note canary requirement silently dropped), H1 (standalone inner-hash authwit class undetectable at estimate — Ask 1 must name it + fixture), H2 (probe route unpinned through the shared `buildAndEstimate` dep — split typed deps + options-pins), M1 (clamp blast radius incl. embedded/NO_FROM + RPC posture via retained `txsLimits`). ALL adopted into rev 3 (ledger #11–14). [audit-codex.md](audit-codex.md)
- **Codex (re-verdict on rev 3, resumed session)**: _pending_

## Seeds (DRAFT — finalized post-approval)

### Recommended: `/goal`

```
/goal All phases (C1, A1, B1, A2, B2, B3) marked ✓ OR DEFERRED in implementations-plan/single-sim-estimates/plan.md, each ✓ backed by its validation gate passing in the transcript; B1's measurement table in lessons with BOTH split checkpoint outcomes stated (B2 gate: free shapes; A2 gate: funded shapes — A2 marked DEFERRED counts as complete when the key wasn't provisioned OR any funded delta ≥1%; B2 marked DEFERRED counts as complete when any free delta ≥1%); LESSONS_FILE=implementations-plan/single-sim-estimates/lessons/phase-<id>.md printed per completed phase; the gh stack (PR1 e2e → PR2 inert decorator + measurement, merge-gated on the B2 checkpoint → PR3 remaining folds + clamp) open against dev with required checks green; /code-review max --fix applied + committed separately; codex post-impl audit complete with high/critical addressed; bun run test and bun run lint exit 0 in the transcript.
```

### Alternative: `/loop 15m`

```
/loop 15m Drive implementations-plan/single-sim-estimates forward. Never idle. Each firing: (1) read plan.md + lessons/ (authoritative), git status/log; PRs → gh pr view --json statusCheckRollup. (2) CI waits fine if progressing; prep next phase meanwhile. (3) No task? Next pending phase; fast layers after each edit; commit → push. (4) Owner-grade decisions → /codex xhigh, decide, act, log — EXCEPT: the SPLIT B1 checkpoints (free shapes ≥1% ⇒ defer B2 only; funded shapes ≥1% OR no key ⇒ defer A2 only; each independently — surface numbers, continue everything not deferred) and Ask 4 (never touch L1 keys/funding without explicit owner provision). Hard limits: never merge main/release, never publish, never stub a payload-inclusive sim for any non-canonical FPC, never let an intent-authwit-carrying op take a 1-sim fold, no scope beyond plan.md. (5) 5× failed step ⇒ reassess with codex. (6) Phase green = plan.md gate verbatim ⇒ ✓ + lessons + LESSONS_FILE line. (7) All ✓ (or A2/B2 DEFERRED)? /code-review max --fix → separate commit → codex post-impl audit → address high/critical → wrap-up with contentious calls ELI5'd. ASCII checklist visible.
```

Use exactly ONE per session — they don't compose.
