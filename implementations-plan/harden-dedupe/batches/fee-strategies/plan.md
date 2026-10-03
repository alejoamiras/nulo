---
plan: harden-dedupe / fee-strategies (arc 10 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/10-fee-strategies, stacked on harden-dedupe
---

# fee-strategies: one skeleton for the fee strategies, one identity for the fee card

Findings Q-05 (a), the strategy half of Q-05 (b), and Q-24 (a), from `audit/quality/2026-09-30-dedup-high/`. The four `FeeStrategy` classes each hand-roll the same task wrapper, validated simulation options, probe fold and fee composition, and the FPC strategy writes its finalize tail twice. `FeeSettingsCard` compares and keys its `{profileId, networkId, chainId, accountAddress}` identity in seven places. This batch states each of those once. No build, simulation, fee, task, refusal or card state changes. The reuse half of Q-05 (b), Q-05 (c), Q-10 and B-08 belong to estimate-reuse; § Coupling says where the seam is.

## Outcome & Quality Bar

- **For whom:** the next person who adds a payment kind, an abort checkpoint, a fold rule or a fee-scope field. Today the fold rule lives in three blocks kept in "byte parity" by comment, the validated options in six literals, and the card's identity in seven expressions. A field missed in one card predicate lets one account's balances drive another account's fee settings.
- **Excellent:**
  - Each strategy path's task lifecycle, simulation options, fold choreography, cancel checkpoints and committed fees are pinned by literal values before the refactor, including the paths no test reaches today.
  - Each card guard is pinned per identity field, with a same-values control, before the refactor.
  - After it, the validated options, the fee basis, the task wrapper, the fold and the FPC tail each have one definition, and the card's identity has three small helpers.
- **Good enough:** the FPC sponsored fast path keeps its own `try`/`catch`, because it completes its task early and hands off (§ What stays). The first build-and-simulate triplets stay inline.

## Architecture & Implementation

Read on `harden-dedupe` at `7450928c`. Strategy paths are under `apps/extension/src/wallet/services/execution/fee/`; the card is `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue`, whose `<script setup>` is plain JS, so `vue-tsc` does not check it.

### Sites today

**Task wrapper** (`startEstimateTask` → `try { … task.complete(); return } catch (e) { task.fail(e); throw e }`):

| site | lines | before the task starts | special case |
|---|---|---|---|
| T1 fj | `fee-juice-strategy.ts:25-74` | nothing | |
| T2 fjwc | `fee-juice-with-claim-strategy.ts:25-48` | kind guard `:21-23`, claim fields `:24` | claim payload unshifted inside the `try` (`:27`) |
| T3 embedded | `embedded-strategy.ts:32-52` | `embeddedFeePayment` guard `:25-27`, method `:28-31` | |
| T4 fpc fast path | `fpc-strategy.ts:136-201` | kind guard `:110-112`, `getFpcImpl` `:114`, eligibility `:115`, `originalActions` `:134`, multiplier `:135` | cross-chain fallback `:148-152`: `task.complete()`, then `return` of the un-awaited two-pass promise |
| T5 fpc two-pass | `fpc-strategy.ts:207-306` | `originalActions` `:205`, multiplier `:206` | |

**Validated simulation options** `{ simulatePublic: true, skipFeeEnforcement: true, scopes: [address] }`: owner V0 `fee-strategy.ts:170` (the no-probe branch of `probedFirstSimOpts`, `:157-171`); V1 `fee-juice-strategy.ts:54`; V2 `fee-juice-with-claim-strategy.ts:39`; V3 `embedded-strategy.ts:42`; V4 `fpc-strategy.ts:172`; V5 `:254`; V6 `:280` (Pass 2). V2 and V3 read `account.address` from a destructured `built`, the rest `built.account.address`.

**Probe fold**, each after a first simulation run with `probedFirstSimOpts`:

| site | lines | re-simulate when | rebuild method |
|---|---|---|---|
| F1 fj | `fee-juice-strategy.ts:35-58` | effects found OR init-wrapped | `PREEXISTING_FEE_JUICE` |
| F2 fpc fast path | `fpc-strategy.ts:161-176` | effects found OR init-wrapped | `EXTERNAL` |
| F3 fpc two-pass | `fpc-strategy.ts:231-258` | init-wrapped only | `PREEXISTING_FEE_JUICE` |

All three: `extractEffects(simulatedTx, { node: built.node, network: built.network })` on the first build; discovered actions pushed onto `ctx.op.actions` exactly when non-empty (inside the `if` at F1 and F2, before it at F3, which is the same condition); then, when re-simulating, `if (ctx.signal?.aborted) throw new JobCancelledSentinel("")`, `buildStandard(ctx.op, ctx.fence, method, task)`, `suggestGasLimits`, and a validated simulation.

**FPC finalize tail:** E1 `fpc-strategy.ts:178-197`, E2 `:283-302`. Both compute `maxFee` from the final simulation's gas × padding at `baseFees`, splice `[payload(maxFee), ...originalActions, ...discovered]`, call `finalizeGasLimits(…, baseFees, undefined, undefined, built.txsLimits)`, and return `{ ...built, feePaymentMethod: EXTERNAL, ...sponsorOf(fpc, simulatedTx) }`.

**Fee composition** `predictedWorstMinFees(node) × (feeMultiplier ?? DEFAULT_FEE_MULTIPLIER)`: C1 `fee-strategy.ts:289-290` (multiplier resolved at `:272`, inside `finalizeGasLimits`'s refetch branch); C2 `fpc-strategy.ts:177` (`:135`); C3 `:261` (`:206`). Not touched: `service.ts:1109` (the producer of the optional `ctx.feeMultiplier`), and the two reuse ladders (estimate-reuse).

**Card identity (Q-24 (a)):**

- P1 `:181-186` `scopeIsLiveIdentity`: `Boolean(scope) &&` four `===`, read by the `sendSelection` and `sponsorShort` computeds (`:197`, `:208`).
- P2 `:543-549` `identityDrifted`: `!isMounted ||` four `!==` `|| embeddedHidden()`.
- P3 `:721-729` `recommitStillValid`: `!props.network || !props.account || embedded` → `false`, then four `===`.
- S `:608-616` in `runInit`: four `req*` locals, the key `reqKey` (`:615`) and the scope literal (`:616`); `reqAccount` is read again at `:629`.
- K2 `:711`, the key rebuilt from the committed scope in `recommit`.
- K3 `:767`, the live key from props (with `?.`) in the identity watcher.

### Guard set per site (identical after the change)

| site | guards, in order |
|---|---|
| T1–T5 | each path's pre-task guards above stay before `startEstimateTask`; inside the task: builds and simulations, the checkpoints below, `complete()` inside the `try`; on any throw `fail(error)` and rethrow of the same object |
| F1, F2 | abort check, then rebuild, only when effects OR init-wrapped |
| F3 | abort check, then rebuild, only when init-wrapped; T5's pre-Pass-2 check (`:266`) stays after composition (`:261`) and the payload unshift (`:263`) |
| V0–V6 | validated options only: no `skipTxValidation`, no `stubAccountAddresses`; the scope is the account of the build the simulation follows |
| C1–C3 | the multiplier is `ctx.feeMultiplier` or the default; embedded never reaches C1 (Fact 6) |
| P1 | scope present, then the four fields in order profile, network id, chain id, account; strict equality, short-circuit |
| P2 | `!isMounted`, then the four fields, then `embeddedHidden()` |
| P3 | network and account present and not embedded, then the four fields |
| S, K2, K3 | `profileId|networkId|chainId|accountAddress`, each segment rendered by the template literal, so a missing value reads `undefined` |

### What changes

1. **`fee/fee-strategy.ts`** gains four exports next to `startEstimateTask`. Parameters keep the call sites' names (`built`, `simulatedTx`, `ctx`, `task`, `node`, `scope`), so any engine-generated text stays the same where one exists (§ Security).
   - `validatedSimOpts(built)` returns a fresh `{ simulatePublic: true, skipFeeEnforcement: true, scopes: [built.account.address] }`. `probedFirstSimOpts` becomes `if (!probe) return validatedSimOpts(built)` followed by its stub branch, unchanged.
   - `committedMaxFees(node: MinFeeNode, feeMultiplier?: number)` returns `(await predictedWorstMinFees(node)).mul(feeMultiplier ?? DEFAULT_FEE_MULTIPLIER)`, with one TSDoc sentence: it is the `maxFeesPerGas` a fresh build commits, and the reuse validators must reproduce it.
   - `withEstimateTask(tasks, parentTask, body)`: `const task = startEstimateTask(tasks, parentTask)`, then `try { const estimate = await body(task); task.complete(); return estimate } catch (error) { task.fail(error); throw error }`.
   - `foldProbedDiscovery(deps, ctx, task, method, first, resimWhen)` with two exported policies, `resimOnEffectsOrInit` and `resimOnInitWrap`. It returns `first` with `discovered: []` when `ctx.probe` is absent; otherwise it does the steps listed under § Sites in the same order and returns `{ built, simulatedTx, discovered }`. One comment carries the reason for both policies: effects need a validated re-simulation to verify fresh witnesses, and stub gas cannot be trusted for an init-wrapped build.
   - `finalizeGasLimits` uses `committedMaxFees(node, feeMultiplier)` at C1 and loses `:272`. Header `:34-35` names `PRIORITY_MULTIPLIERS` in `models/fee.ts`; it lives in `@nulo/wallet-bridge`'s `fee.ts`, which the line now says.
2. **T1–T3** become `return withEstimateTask(this.deps.tasks, ctx.parentTask, async (task) => { … })` around today's body, pre-task guards first. V1–V3 become `validatedSimOpts(built)`. F1 becomes one `foldProbedDiscovery(…, resimOnEffectsOrInit)` call; T1 keeps its `built` and `simulatedTx` bindings, reassigned from the result, so its finalize call is unchanged. `embedded-strategy.ts:45` claims the `1` keeps the cost within the dApp's budget; the cap reuse in `finalizeGasLimits` (`fee-strategy.ts:276-282`) does that and the `1` is inert (Fact 6), which the comment now says in one sentence. The `1` stays.
3. **`fee/fpc-strategy.ts`:**
   - A module-private `finishFpcEstimate(ctx, fpc, originalActions, baseFees, run)` holds E1/E2 verbatim.
   - The fast path keeps its `try`/`catch` and its fallback (`:148-152`) as they are; F2 becomes a fold call with `resimOnEffectsOrInit` and `EXTERNAL`, C2 `await committedMaxFees(built.node, ctx.feeMultiplier)`, and the tail `const estimate = await finishFpcEstimate(…); task.complete(); return estimate`.
   - The two-pass becomes a `withEstimateTask` body: F3 a fold call with `resimOnInitWrap`, C3 `committedMaxFees`, V5 is absorbed by the fold, V6 `validatedSimOpts(built)`, E2 the tail. The two `multiplier` locals go.
   - The folded comment blocks at `:155-160` and `:224-230` give way to the helper's comment. Their milestone tags ("B1", "F-4") do not travel.
4. **`send/fee-helpers.ts`** gains three typed exports: `liveFeeScope(live)`, which projects `{ profile, network, account }` into `{ profileId, networkId, chainId, accountAddress }` with `?.` reads in that order and key order; `feeScopeKey(scope)`, the pipe-joined template literal; and `isLiveFeeScope(live, scope)`, the four `===` comparisons reading `live.*` lazily in today's order. The card imports them through its existing `./fee-helpers` import block:
   - P1 `Boolean(scope) && isLiveFeeScope(props, scope)`;
   - P2 `!isMounted || !isLiveFeeScope(props, scope) || embeddedHidden()`;
   - P3 keeps its first line, then `return isLiveFeeScope(props, scope)`;
   - S `const scope = liveFeeScope(props)`, `const reqKey = feeScopeKey(scope)`, and `readSavedSelections(scope.accountAddress)`. The guard at `:595` has already proved `profile`, `network` and `account` truthy, so `?.` reads what `.` read;
   - K2 `feeScopeKey(scope)`; K3 `feeScopeKey(liveFeeScope(props))`.

### What stays

- **The fast path's own `try`/`catch`.** At `:151` it completes its task and returns the two-pass promise without `await`, so a two-pass rejection skips its `catch` (Fact 2). Inside `withEstimateTask`, the wrapper would then finish that task a second time, and `TaskService` refuses ("Cannot finish already finished task"), replacing the real error. Phase 1 pins this path.
- `startEstimateTask`, `probedFirstSimOpts`' stub branch, `isInitWrapped`, `finalizeGasLimits`' signature and clamp logic, `assertCustomGasLimitsWithinCap`, every pre-task guard and its message, the first build-suggest-simulate triplets, the FPC header comments, `sponsorOf`, `buildFeeStrategies`, `service.ts`, and both reuse ladders.
- In the card: `committedScope`, `committedKey`, every comment around S, P3's first line (not swapped for `embeddedHidden()`, which is a separate dedup), and the template and style blocks, byte for byte.
- No existing test file changes after Phase 1.

### Alternatives not taken

- *`committedMaxFees` and `resolveFeeMultiplier` in `packages/aztec-runtime/src/fee-juice.ts`*, the audit's home. The default multiplier is the extension's (a `VITE_` override at `fee-strategy.ts:63-66`), and `PRIORITY_MULTIPLIERS` lives in `wallet-bridge`, which sits above aztec-runtime. The reuse ladders already import the default from `fee/fee-strategy.ts`.
- *The card reusing `activityScopeKey` / `scopesEqual` from `@nulo/wallet-core/activity`.* They lower-case the address and throw on an invalid scope (`packages/wallet-core/src/activity/scope.ts:45-58`): two behaviour changes.
- *`isLiveFeeScope` as `sameFeeScope(liveFeeScope(props), scope)`.* That reads all four props eagerly, and inside the `sendSelection` computed, which returns a fresh object each run, extra reactive dependencies mean extra re-evaluations and possibly extra emissions.
- *The `batched-view-simulation.ts:543-547` literal joining `validatedSimOpts`.* It is a view simulation calling `pxe.simulateTx` directly, with no fee semantics, and execution-guards edits that file.

### Complexity

No touched function is in `scripts/complexity-baseline/manifest.json` (it lists only `FeeSettingsCard.test.ts` and `fee-strategy-clamp-properties.test.ts` from these trees). Every strategy body shrinks. `foldProbedDiscovery` scores about 5, and the other helpers are flat.

### Coupling with neighbouring arcs

- **estimate-reuse (arc 11), the seam.** It owns the reuse half of (b): the composition and the multiplier ternary at `operation-estimate-reuse.ts:160-161` (where B-08's missing `try` is) and `transfer-estimate-reuse.ts:197-204` (which re-wraps `GasFees` before `.mul`, so it is not a drop-in), plus `service.ts:1109`, `fingerprintBaseFee`'s move, the snapshot producers and Q-10. It can call `committedMaxFees(node, multiplier)`: the helper takes `MinFeeNode`, the type both ladders already use, and lives in the module they already import. Its `?? DEFAULT` changes one hostile-only case for the ladders (Drift 1). That call belongs to estimate-reuse.
- **Arcs 6–9:** none of their diffs touches `fee/*`, `fee-helpers.ts` or `FeeSettingsCard.vue`. Arc 8 edits `service.ts` and `batched-view-simulation.ts`, both outside this arc. Arc 4 edits only `fee-shared.module.css` in this module. The arc can stack wherever it is ready.

## Security & Adversarial Considerations

- **Who reaches the strategies:** the background, for popup sends (fee settings chosen in the popup) and for dApp `simulateTx` / `sendTx` estimates. On the dApp path the dApp controls `op.actions`, `op.fee` (gas limits, `maxFeesPerGas`, `gasPadding`, `embeddedFeePayment`) and, through its calls, which authwit effects the probe discovers. A hostile endpoint controls the min fees, which the node client parses into `GasFees` (Fact 4). FPC rows are user-added and persisted.
- **What a consolidation could widen, and the pin for each:**
  - *Stubbed options at a validated site.* A stubbed simulation verifies no witness, so `toStrictEqual` pins V0–V6 with no extra keys.
  - *A fold that skips the re-simulation on effects at F1/F2.* Unverified witnesses would leave in the estimate. *One that drops the abort check* lets a cancelled estimate run another full simulation. *A rebuild under the wrong method, or from the stale build.* The fold matrix pins all three per site.
  - *A wrong multiplier.* It changes the committed `maxFeesPerGas`, the most the user can be charged. The composition rows pin the default and an explicit multiplier, and that embedded never applies one.
  - *A task wrapper that loses error identity.* `JobCancelledSentinel` and the wallet errors are classified by `instanceof` upstream, so the lifecycle rows pin `rejects.toBe(error)`; the pre-task guards must still throw before any task exists.
  - *A card predicate that drops a field, loosens `===` or loses its site's extras.* Account A's balances or pick would derive settings for account B: the cross-account leak these guards exist for. The identity matrix pins each field at each guard.
- **Engine-generated text.** A Bun probe of the moved fee expression gives three different texts already: `maxFeesPerGas.mul is not a function. (In 'maxFeesPerGas.mul(2)', …)` at C1, `(await p(built.node)).mul …` at C2/C3, and the helper's `(await p(node)).mul …`. V8 says `(intermediate value).mul is not a function` for both inline forms. Equivalence therefore rests on reachability, not text: `.mul` is missing only if `predictedWorstMinFees` resolves a non-`GasFees`, and the only node client parses both min-fee replies through `GasFees.schema` (Fact 4). The other moved expressions read builder, PXE or constructor-injected values, never dApp data at the moved access: `ctx.op.fee` and `ctx.gasPadding` reach only `suggestGasLimits` and `Gas.mul`, whose code does not move. The card's `scope` is never nullish at P1–P3, and the helper's parameter is still named `scope`. Firefox was not probed (no binary on this machine); under unreachability it does not matter.
- **Preserved, not fixed:** see § Drift.
- **Layering, npm, logging:** no new cross-layer import (`fee-strategy.ts` already imports `predictedWorstMinFees` and the task types; `fee-helpers.ts` imports nothing new). No published package is touched. No log line changes.
- **Account-address freeze:** untouched; no derivation input moves.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `7450928c`):

1. The sites and line numbers are as listed above. The fee files are unchanged since recon apart from line shifts; Q-24's lines match recon's re-read.
2. `return this.buildAndEstimateTwoPass(ctx, fpc)` (`fpc-strategy.ts:151`) sits inside the `try` without `await`. `WrappedTask.complete` and `fail` call `TaskService.completeTask` / `failTask`, which throw on a finished task (`task/service.ts:105-108`, `:127-152`).
3. `ctx.feeMultiplier` is written only by its producer (`git grep "feeMultiplier\s*="` finds `service.ts:1109` alone), so reading it at composition time instead of at path entry reads the same value.
4. `AztecNodeApiSchema` parses `getCurrentMinFees` into `GasFees.schema` and `getPredictedMinFees` into an array of it (stdlib 6.0.0-rc.1, `interfaces/aztec-node.js:207-216`). `aztec-node-factory-adapter.ts:6` declares itself the only `createAztecNodeClient` call site, and `tx-request-builder.ts:225,392` take `built.node` from the network service.
5. The probe texts quoted under § Security come from Bun 1.4.2 and Node (scratch probe, deleted).
6. On the embedded path `ctx.op.fee.embeddedFeePayment` is set (guard `embedded-strategy.ts:25`), so `finalizeGasLimits` takes the custom-fee or cap-reuse branch (`fee-strategy.ts:274-282`) and never reaches C1. The embedded cap reads `node.getCurrentMinFees()` itself (`embedded-fpc-cap.ts:72-74`); that line is untouched.
7. `FeeSettingsCard.vue`'s `<script setup>` has no `lang="ts"`. Its `profile`, `network` and `account` props carry `id`; `{ id, chainId }`; and `{ id, address }`.
8. Existing pins cover the FPC two-pass choreography, the fast path's eligibility and fallback build count, the FJ and FPC fold cases in `strategies-structural.test.ts`, the finalize slot projection in `fee-structural-parity.test.ts`, and the card's account, account-plus-network, chain-id, recommit and same-profile-object identity cases in `FeeSettingsCard.test.ts`. Nothing pins task lifecycle, the strategies' abort checkpoints, an explicit multiplier on the FPC paths, or the per-field matrix.

**Inferences:**

- The wrapper adds a few microtask hops between a strategy's last `await` and `complete()`, and before the caller resumes. This is unobservable: the task still completes before the caller resumes, cancels arrive as port messages (macrotasks), and nothing polls a task on microtasks. No span here has to finish in one tick, unlike the case in the lessons.
- The return object is now built before `complete()` instead of after. `{ ...built }` and `sponsorOf` neither throw (`sameFieldAddress` returns `false` on a non-string) nor depend on task state.

**Asks** (for the panel):

1. **Ship the probe-fold hoist (Phase 2b), or keep the three folds inline?** The audit rates it moderate confidence. Recommendation: ship it as its own commit, so a REVISE can drop it without touching Phase 2a.
2. **Screenshot reach.** If the harness cannot reach the execute window and the two authwit popups without a sandbox or port stub, is Send-page coverage enough for a script-only change? Recommendation: yes, with `git diff` proving the `.vue` hunks sit inside `<script setup>` alone; capture the others if a port stub reaches them.

## Phases

### Phase 1: pin today's behaviour (test only)

Expected values are literals in the tests, never derived from production helpers. Existing cases count toward each table; only missing rows are added.

**New `fee/strategies-lifecycle.test.ts`** (bb-free; real `TaskService` with a `DummyLogger` wherever task state is asserted; fakes shaped like `strategies-structural.test.ts`'s, with a distinct account object per build):

- **Lifecycle, over the five paths:**
  - On success, one "Estimating fee" task, a subtask under `parentTask` when given and a root otherwise, `Completed` when the promise settles.
  - A rejection at build, at simulation and at finalize (`getCurrentMinFees` rejecting) leaves the task `Failed` with that message and rejects with the same object.
  - The pre-task guards (fjwc kind, embedded `embeddedFeePayment`, fpc kind, `getFpcImpl` rejecting) reject with their exact messages and create no task.
  - A fake task whose `complete()` throws once has `fail` called with that error, and the call rejects with it.
  - **The fast-path fallback:** the first task is `Completed` before the second starts. When the two-pass then rejects, the call rejects with the two-pass's own error object, the first task stays `Completed`, and the second is `Failed`.
- **Simulation options:** every call at V0–V6 is `toStrictEqual` to the validated literal, and `scopes[0]` is `toBe` the account address of the build that call follows.
- **Fold matrix:** F1, F2 and F3 × {no effects, effects, init-wrapped, both}, each row pinning:
  - builds and their methods in order, simulations and their option kind;
  - `extractEffects` called once with the first simulation and the first build's `node` and `network`;
  - the final `ctx.op.actions` order.

  Abort rows: a signal aborted during the stubbed simulation throws `JobCancelledSentinel` before the second build in each re-simulating cell. In F3's effects-only cell, the fold passes and the throw comes at the pre-Pass-2 checkpoint, after exactly one `getCurrentMinFees` call.
- **Composition:**
  - `getCurrentMinFees` is called once on each path.
  - With `ctx.feeMultiplier: 3`, fj and fjwc finalize at `1665n` / `1998n`; the FPC two-pass and fast path commit those fees, Pass 2's `maxFeesPerGas` equals them, and the payload's `maxFee` in the final splice is the gas × padding priced at them.
  - Embedded with `ctx.feeMultiplier: 3` stays at the node minimum (`555n` / `666n`).

**`send/FeeSettingsCard.test.ts`, the identity matrix:**

- **Four switches:** profile id; network id with the same chain id; chain id with the same network id; account address. Each is applied:
  - (P2) mid-init with the gas read deferred: the stale run is discarded;
  - (P3) during a recovery recommit's storage read: the late commit is discarded;
  - (P1, K3) on Send: on the switch's tick no settings derive from the old snapshot and the sponsor verdict is forgotten.
- **Controls:** replaced `profile`, `network` and `account` objects carrying the same values discard no run, close no gate and keep the verdict. Run them once after a first init (K1 against K3) and once after a recovery recommit (K2 against K3).

The phase is green on the unchanged code and lands in its own commit, so both files are frozen from here on.

### Phase 2a: options, composition, task wrapper

`validatedSimOpts`, `committedMaxFees` and `withEstimateTask`, applied at V0–V6, C1–C3 and T1–T3 plus T5 (§ What changes, items 1 to 3, without the fold and the tail), and the two comment fixes. One commit.

### Phase 2b: the fold and the FPC tail

`foldProbedDiscovery` with its two policies at F1–F3, and `finishFpcEstimate` at E1/E2. One commit, droppable (Ask 1).

### Phase 3: the card

The `fee-helpers.ts` exports and the seven card edits (item 4). `fee-helpers.test.ts` gains three rows:

- `feeScopeKey` for chain id `0` (`"p1|n1|0|0xabc"`);
- `feeScopeKey(liveFeeScope({}))` (`"undefined|undefined|undefined|undefined"`);
- `isLiveFeeScope` on a recording object, stopping at the first mismatched field.

**Validation gate (after each phase):**

- **Commands:**
  - `bun run --cwd apps/extension test -- src/wallet/services/execution src/popup/components/modules src/popup/windows/execute src/popup/components/popups src/popup/pages`;
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`;
  - at the final head, `bun run build`, then confirm the generated declaration files did not change.
- **Pass criteria:**
  - Everything exits 0.
  - Between the Phase 1 commit and the head, `git diff -- '*.test.ts'` lists only `fee-helpers.test.ts`, with additions only.
  - The `.vue` diff stays inside `<script setup>`.
- **Mutation check** (scratch copies after Phase 3, each mutant applied alone, restored from a copy, never with git; a kill means a test case that ran and failed):
  - `validatedSimOpts` returning the stub shape; reading the first build's account at V5 or V6;
  - `resimOnEffectsOrInit` swapped for `resimOnInitWrap` at F1 and at F2; the reverse at F3; the fold's abort check deleted; the fold rebuilding with the other method;
  - `committedMaxFees` ignoring its multiplier; C3 moved below the `:266` checkpoint;
  - `complete()` moved out of the wrapper's `try`; `fail` dropped; a wrapped rethrow; `return await` added at the fast-path fallback;
  - in `isLiveFeeScope`, each field dropped (four mutants) and `===` swapped for `==` on chain id; `embeddedHidden()` dropped from P2; P3's presence line dropped;
  - `feeScopeKey` with another separator at K3 only.
- **Screenshots** (the arc touches a `.vue` file; § UI impact): parent against head, zero pixel diff, Chrome and Firefox, dark and light.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its stack parent, then add both e2e labels. When the program gates are green, with the shards that ran recorded in the lessons log, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/10-fee-strategies`, stacked on `harden-dedupe` in readiness order (its files are disjoint from arcs 6–9). Code review: off.

## UI impact

**None intended, but this is not a logic-only arc.** `FeeSettingsCard.vue` changes inside `<script setup>`; its template and style do not. The program table's "logic only" is corrected to a touched-screens capture of the card's four hosts:

- the Send page (`popup/pages/send.vue`);
- the dApp execute window (`popup/windows/execute/OperationCard.vue`);
- `RevokeAuthwitsPopup`;
- `ChangeAuthwitsRegistryPopup`.

The states are pending (Send's preview), settled with a sponsor and with Fee Juice, and the degraded notice (`fee-init-degraded`). Each is captured on Chrome and Firefox, in dark and light. Coverage of the last three hosts follows Ask 2. No pixel, copy or emitted-settings change is allowed.

## Drift left for the alignment arc

1. **An unknown `priorityLevel`.** The strategies get `undefined` from `service.ts:1109` and fall back to the default; the reuse ladders call `.mul(undefined)`. Only the popup supplies the level. estimate-reuse decides whether its ladders adopt `committedMaxFees`, whose default would align them.
2. **The fast-path fallback shows two "Estimating fee" steps**: the first completed, the second live. Pinned and kept.
3. **The card's identity compares addresses case-sensitively**, while the balances store keys them case-insensitively. A case-only change re-initialises the card; addresses arrive lower-case. Kept.
4. **Embedded's inert multiplier `1`.** The comment is corrected; the argument stays.
5. **Outside this diff, for follow-ups:** `fee/build-fee-strategies.ts:317` opens with a `Q-04 pilot:` finding tag, which the comment style bans; `helpers/batched-view-simulation.ts:543-547` keeps its own options literal.

## Decisions (delegated)
