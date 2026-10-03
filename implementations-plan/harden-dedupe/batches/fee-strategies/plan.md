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

# fee-strategies: one validated-simulation literal, one identity for the fee card

Findings Q-05 (a), the strategy half of Q-05 (b), and Q-24 (a), from `audit/quality/2026-09-30-dedup-high/`. After the plan audit (see Decisions), the arc ships the two parts that move no `await`, event or engine-generated text:

- the validated simulation options, written as a literal seven times across the fee strategies, come from one synchronous helper;
- `FeeSettingsCard`'s `{profileId, networkId, chainId, accountAddress}` identity, compared and keyed in seven places, comes from three small helpers.

It also corrects the fee comments that misstate the multiplier and strips their provenance tags. The task wrapper, the fee composition, the probe fold and the FPC finalize tail stay inline, and § Deferred says why. The reuse half of Q-05 (b), Q-05 (c), Q-10 and B-08 belong to estimate-reuse.

## Outcome & Quality Bar

- **For whom:** the next person who touches a validated simulation or adds a fee-scope field. A validated simulation that picks up a skip flag verifies no witness. A field missed in one card predicate lets one account's balances drive another account's fee settings.
- **Excellent:**
  - Every strategy path's task lifecycle, simulation options, fold choreography, cancel checkpoints and committed fees are pinned by literal values, including the paths no test reaches today. That way, the inline code this arc keeps is also guarded for the follow-ups.
  - Each card guard is pinned per identity field, with a same-values control.
  - The validated options have one definition, the card's identity has three helpers, and every fee comment states only what is true.
- **Good enough:** the four strategy skeletons remain duplicated (§ Deferred).

## Architecture & Implementation

Read on `harden-dedupe` at `7450928c`. Strategy paths are under `apps/extension/src/wallet/services/execution/fee/`; the card is `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue`, whose `<script setup>` is plain JS, so `vue-tsc` does not check it.

### Sites

**Validated simulation options** `{ simulatePublic: true, skipFeeEnforcement: true, scopes: [address] }`:

- the owner, V0 `fee-strategy.ts:170`, is the no-probe branch of `probedFirstSimOpts` (`:157-171`);
- V1 `fee-juice-strategy.ts:54` (fold re-simulation);
- V2 `fee-juice-with-claim-strategy.ts:39`;
- V3 `embedded-strategy.ts:42`;
- V4 `fpc-strategy.ts:172` (fast-path fold);
- V5 `:254` (two-pass init re-simulation);
- V6 `:280` (Pass 2).

V2 and V3 read `account.address` from a destructured `built`; the rest read `built.account.address`.

**Card identity (Q-24 (a)):**

- P1 `:181-186` `scopeIsLiveIdentity`: `Boolean(scope) &&` four `===`, read by the `sendSelection` and `sponsorShort` computeds (`:197`, `:208`).
- P2 `:543-549` `identityDrifted`: `!isMounted ||` four `!==` `|| embeddedHidden()`.
- P3 `:721-729` `recommitStillValid`: if `!props.network || !props.account || embedded`, return `false`; otherwise four `===`.
- S `:608-616` in `runInit`: four `req*` locals, the key `reqKey` (`:615`) and the scope literal (`:616`). `reqAccount` is read again at `:629`.
- K2 `:711`: the key rebuilt from the committed scope in `recommit`.
- K3 `:767`: the live key from props (with `?.`) in the identity watcher.

### Guard set per site (identical after the change)

| site | guards |
|---|---|
| V0–V6 | validated options only: exactly `simulatePublic`, `skipFeeEnforcement`, `scopes`, with no `skipTxValidation` and no `stubAccountAddresses`. The scope is the account of the build the simulation follows (the rebuilt account at V1, V4, V5, V6). The probe branch's options are never spread from it. |
| P1 | scope present, then the four fields in order: profile, network id, chain id, account. Strict equality, short-circuit, each prop read lazily. |
| P2 | `!isMounted`, then the four fields, then `embeddedHidden()` |
| P3 | network and account present and not embedded, then the four fields |
| S, K2, K3 | `profileId\|networkId\|chainId\|accountAddress` from one template literal, so a missing value reads `undefined` |

### What changes

1. **`fee/fee-strategy.ts`** exports `validatedSimOpts(scope: AztecAddress)`, which is synchronous and returns a fresh `{ simulatePublic: true, skipFeeEnforcement: true, scopes: [scope] }`.
   - `probedFirstSimOpts` keeps its first line, `const address = built.account.address`, then `if (!probe) return validatedSimOpts(address)`, followed by its stub branch unchanged.
   - Each site passes the access expression it had, at the moment it had it. V2 and V3 keep their destructure of `account` before `suggestGasLimits` (and, at V3, before the cap's await) and pass `account.address`; V1 and V4–V6 pass `built.account.address`.
   - So every read of `account` runs in today's order, and an engine's text for a missing `account` names today's expression.
2. **`send/fee-helpers.ts`** gains three typed exports, and the card imports them through its existing `./fee-helpers` block:
   - `liveFeeScope(live)` projects `{ profile, network, account }` into `{ profileId, networkId, chainId, accountAddress }`, reading with `?.` in that order and in that key order;
   - `feeScopeKey(scope)` is the pipe-joined template literal, not `.join`;
   - `isLiveFeeScope(live, scope)` is the four `===` comparisons, reading `live.*` lazily in today's order, with no destructure of `live`.

   Each site's edit:
   - P1: `Boolean(scope) && isLiveFeeScope(props, scope)`.
   - P2: `!isMounted || !isLiveFeeScope(props, scope) || embeddedHidden()`.
   - P3: keeps its presence-and-embedded line, then `return isLiveFeeScope(props, scope)`.
   - S: `const scope = liveFeeScope(props)`, `const reqKey = feeScopeKey(scope)`, then `readSavedSelections(scope.accountAddress)`. The guard at `:595` has already proved `profile`, `network` and `account` truthy, so `?.` reads what `.` read, in the same order.
   - K2: `feeScopeKey(scope)`.
   - K3: `feeScopeKey(liveFeeScope(props))`. Today's template literal also reads all four props, in the same order.
3. **Comments.** Each is fixed in place, and the substantive invariants stay:
   - **The inert multiplier.** On the embedded path `finalizeGasLimits` reuses the committed cap (Fact 4), so the embedded `1` is inert. `fee-strategy.ts:12-13`, `:37` and `:247-248` and `embedded-strategy.ts:45` claim the `1` keeps the cost within the dApp's budget; each now says the committed cap does.
   - **Provenance tags removed:** "B1" at `fee-strategy.ts:155` and `:177`; at `fpc-strategy.ts:47`, `:54`, `:64` and `:68`, the B1/F-4/audit provenance; `// first approach` at `fpc-strategy.ts:210`; and the `Q-04 pilot:` finding tag at `build-fee-strategies.ts:9`.
   - **The un-awaited hand-off:** one sentence above `fpc-strategy.ts:151` says why the two-pass promise is returned un-awaited. Its rejection must skip this `catch`, because this path's task is already complete, and failing a finished task throws over the real error.

### What stays

Every task lifecycle, every fee composition and `?? DEFAULT_FEE_MULTIPLIER` line, the three probe folds, the two FPC finalize tails, the fast path's `try`/`catch` and its un-awaited hand-off, `service.ts`, and both reuse ladders. In the card: `committedScope`, `committedKey`, P3's first line (left as is rather than swapped for `embeddedHidden()`), and the template and style blocks, byte for byte. No existing test file changes after Phase 1, except that `fee-helpers.test.ts` gains rows in Phase 3 and the review rounds add pins (logged in the arc's lessons).

### Alternatives not taken

- *The card reusing `activityScopeKey` / `scopesEqual`* (`packages/wallet-core/src/activity/scope.ts:45-58`). They lower-case the address and throw on an invalid scope, which are two behaviour changes.
- *`isLiveFeeScope` as `sameFeeScope(liveFeeScope(props), scope)`.* That reads all four props eagerly. Inside `sendSelection`, a computed that returns a fresh object each run, the extra reactive dependencies mean re-runs at new times.
- *The options literal at `helpers/batched-view-simulation.ts:543-547` joining the helper.* It is a view simulation that calls `pxe.simulateTx` directly, has no fee semantics, and sits in a file execution-guards edits.

### Complexity

No touched function is in `scripts/complexity-baseline/manifest.json`. Its one accepted anchor in `FeeSettingsCard.test.ts` stays untouched. The identity matrix is a flat `test.each`, with every function at cognitive complexity 15 or less; a new acceptance would park the arc.

### Coupling with neighbouring arcs

- **estimate-reuse (arc 11).** It owns the reuse half of (b), `service.ts:1109`, `fingerprintBaseFee`'s move, the snapshot producers, Q-10 and B-08. This arc exports nothing it needs. It must preserve Drift 1, not absorb it.
- **Arcs 6–9:** none of their diffs touches `fee/*`, `fee-helpers.ts` or `FeeSettingsCard.vue`. Arc 4 edits only `fee-shared.module.css` in this module.

## Security & Adversarial Considerations

- **Who reaches the strategies:** the background, for popup sends and for dApp `simulateTx` / `sendTx` estimates. On a dApp path the dApp controls `op.actions`, `op.fee` and, through its calls, which authwit effects the probe discovers. The selected endpoint controls the min-fee replies.
- **`validatedSimOpts` is a security boundary.** A validated simulation carrying `skipTxValidation` or a stubbed account verifies nothing. Phase 1 pins V0–V6 with `toStrictEqual` and pins the scope's identity per build, so a stale account fails as well.
- **The card's guards are the cross-account fence.** Dropping a field, loosening `===` or losing a site's extras would let account A's balances or pick derive settings for account B. The identity matrix pins each field at each guard. The lazy reads keep each computed's reactive dependencies exactly as they are today.
- **Engine-generated text.** The fee compositions stay inline because their text is reachable. `safe_json_rpc_client.js:173-182` (foundation 6.0.0-rc.1) returns `undefined` for a null-like result before any schema parse, so a malformed min-fee reply makes `predictedWorstMinFees` resolve `undefined`. Each site then throws its own Bun text (`maxFeesPerGas.mul …`, or an expression naming `built.node`), which `WrappedTask.fail` exposes. The moved expressions here are not reachable that way:
  - each simulation site passes its own access expression for the account address, read when it was read before;
  - the card's `scope` is never nullish at P1–P3, and the helper's parameter is still `scope`;
  - `props` is never nullish.
- **Preserved, not fixed:** see § Drift.
- **Layering, npm, logging:** no new cross-layer import, no published package, no log line.
- **Account-address freeze:** untouched.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `7450928c`):

1. The sites and line numbers are as listed above.
2. `return this.buildAndEstimateTwoPass(ctx, fpc)` (`fpc-strategy.ts:151`) sits inside the `try` without `await`. `TaskService.completeTask` and `failTask` throw on a finished task (`task/service.ts:105-108`, `:127-152`).
3. Task completion snapshots and broadcasts synchronously (`task/service.ts:135`, `core/base-service.ts:129`, `background/service.ts:85`).
4. On the embedded path `ctx.op.fee.embeddedFeePayment` is set (guard `embedded-strategy.ts:25`), so `finalizeGasLimits` takes the custom-fee or cap-reuse branch (`fee-strategy.ts:274-282`) and never reaches its refetch.
5. `FeeSettingsCard.vue`'s `<script setup>` has no `lang="ts"`. Its props are `profile { id }`, `network { id, chainId }` and `account { id, address }`.
6. Existing pins cover the FPC two-pass choreography, the fast path's eligibility and its fallback build count, the FJ and FPC fold cases, the finalize slot projection, and the card's account, account-plus-network, chain-id, recommit and same-profile-object identity cases. Nothing pins the task lifecycle, the strategies' abort checkpoints, an explicit multiplier on the FPC paths, or the per-field matrix.

**Inferences:** none load-bearing. The shipped edits are synchronous and keep every read in its order.

**Asks:** none open. The panel answered both (see Decisions).

## Phases

### Phase 1: pin today's behaviour (test only)

Expected values are literals in the tests, never derived from production code. Existing cases count toward each table.

**New `fee/strategies-lifecycle.test.ts`.** It is bb-free. Wherever task state is asserted it uses a real `TaskService` with a `DummyLogger`, and its fakes are shaped like `strategies-structural.test.ts`'s, with a distinct account object per build.

- **Lifecycle, over the five paths** (fj, fjwc, embedded, fpc two-pass, fpc fast):
  - On success: one "Estimating fee" task, a subtask under `parentTask` when one is given and a root otherwise, `Completed` when the promise settles.
  - A rejection at build, at simulation, or at finalize's admission-cap refusal (`fee-strategy.ts:297-301`) leaves the task `Failed` with that message and rejects with the same object.
  - The pre-task guards (fjwc kind, embedded `embeddedFeePayment`, fpc kind, `getFpcImpl` rejecting) reject with their exact messages and create no task.
  - **The fast-path fallback:** the first task is `Completed` before the second starts. When the two-pass then rejects, the call rejects with the two-pass's own error object, the first task stays `Completed` and the second is `Failed`.
- **Simulation options:** every call at V0–V6 is `toStrictEqual` to its literal, and `scopes[0]` is `toBe` the account address of the build that call follows.
- **Fold matrix:** F1 (fj), F2 (fast path) and F3 (two-pass), each × {no effects, effects, init-wrapped, both}. Each row pins:
  - the builds and their methods in order, and the simulations with their option kind;
  - `extractEffects` called once, with the first simulation and the first build's `node` and `network`;
  - the final `ctx.op.actions` order.

  Abort rows: a signal aborted during the stubbed simulation throws `JobCancelledSentinel` before the second build in each re-simulating cell. In F3's effects-only cell the fold passes, and the throw comes at the pre-Pass-2 checkpoint, after exactly one `getCurrentMinFees` call.
- **Composition:**
  - With `ctx.feeMultiplier: 3`, fj and fjwc finalize at `1665n` / `1998n`.
  - The FPC two-pass and fast path commit those fees: Pass 2's `maxFeesPerGas` equals them, and the payload's `maxFee` in the final splice is the gas × padding priced at them.
  - Embedded with `ctx.feeMultiplier: 3` stays at the node minimum (`555n` / `666n`).

**`send/FeeSettingsCard.test.ts`: the identity matrix, a flat `test.each`.**

- **Four switches:** profile id; network id with the same chain id; chain id with the same network id; account address. Each is applied:
  - (P2) mid-init, with the gas read deferred: the stale run is discarded;
  - (P3) during a recovery recommit's storage read: the late commit is discarded;
  - (P1, K3) on Send: on the switch's tick, no settings derive from the old snapshot and the sponsor verdict is forgotten.
- **Controls:** replaced `profile`, `network` and `account` objects carrying the same values discard no run, close no gate and keep the verdict. This runs after a first init (K1 against K3) and after a recovery recommit (K2 against K3).

The phase is green on the unchanged code and lands in its own commit.

### Phase 2: `validatedSimOpts`

Item 1, in one commit.

### Phase 3: the card and the comments

Items 2 and 3. `fee-helpers.test.ts` gains three rows:

- `feeScopeKey` for chain id `0` (`"p1|n1|0|0xabc"`);
- `feeScopeKey(liveFeeScope({}))`, which yields the literal `"undefined|undefined|undefined|undefined"`;
- `isLiveFeeScope` on a recording object: it stops at the first mismatched field.

### Validation gate (after each phase)

- **Commands:**
  - the focused extension run over `src/wallet/services/execution`, `src/popup/components/modules`, `src/popup/windows/execute`, `src/popup/components/popups` and `src/popup/pages`;
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`;
  - at the head, `bun run build`, with the generated declaration files unchanged.
- **Pass criteria:**
  - every command exits 0;
  - between the Phase 1 commit and the Phase 3 head, `git diff -- '*.test.ts'` lists only `fee-helpers.test.ts`, with additions only (review-round pins come after);
  - the `.vue` diff stays inside `<script setup>`.
- **Mutation check.** Each mutant is applied alone to a scratch copy and restored from that copy, never with git. A kill means a test case that ran and failed.
  - `validatedSimOpts` returning the stub shape; V5 or V6 reading the first build's account.
  - In `isLiveFeeScope`: each field dropped (four mutants), and `===` swapped for `==` on chain id.
  - `embeddedHidden()` dropped from P2; P3's presence line dropped.
  - `feeScopeKey` with another separator at K3 only; `.join("|")` in place of the template literal.
  - An eager `liveFeeScope(props)` inside P1. Killed if a test fails; otherwise logged as a survivor, with the reason.
  - `return await` at the fast-path hand-off.
  - The fold's abort check deleted at each site; the two-pass composition moved below `:266`.
- **Screenshots** (§ UI impact): immediate parent against head, zero pixel diff, on Chrome and Firefox, dark and light, plus `--stability`.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix it, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its stack parent, then add both e2e labels. When the program gates are green, with the shards that ran recorded in the lessons log, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/10-fee-strategies`, stacked on `harden-dedupe` in readiness order. Code review: off.

## UI impact

**None intended, but this is not a logic-only arc.** `FeeSettingsCard.vue` changes inside `<script setup>` only. Every host is captured through the harness, never by proxy. Fee data is made deterministic by stubbing the balances store's `execution` and `fpc` legs, installed before the store's clients connect.

| host | states |
|---|---|
| Send (`popup/pages/send.vue`) | saved-pick preview (pending); settled with the sponsor; settled self-pay with a balance; Fee Juice at zero (the needs-fee-juice takeover); sponsor short; degraded (`fee-init-degraded`); private and public variants wherever the presentation differs |
| execute window (`OperationCard`) | loading; selectable sponsor; requested self-pay lock; degraded; embedded/custom method |
| `RevokeAuthwitsPopup`, `ChangeAuthwitsRegistryPopup` | loading (gas leg unanswered, spinner declared busy); settled with the sponsor; settled self-pay; degraded |

If a host cannot be staged, the card extraction is deferred whole. No pixel, copy or emitted-settings change is allowed.

**Result:** every host and state above was staged on the real builds, 28 surfaces in all. Base `7450928c` against head `53e9dfce`: 112 of 112 shots identical on Chrome and Firefox, dark and light; `--stability` 112 of 112 identical. How the fee data was fixed, and why a preload could not do it on Firefox, is in the arc's lessons log.

## Deferred (program follow-ups)

1. **`withEstimateTask`, the task wrapper (Q-05 (a)).** `await body(task)` adds a microtask before `complete()`, and completion broadcasts synchronously (Fact 3). A concurrent sibling task's completion would then reorder from `estimate → sibling` to `sibling → estimate`.
2. **`committedMaxFees` and the three `?? DEFAULT` lines (Q-05 (b), strategy half).** A malformed min-fee reply reaches the composition (§ Security), and a helper would change the engine text that `fail` exposes.
3. **The probe fold and the FPC finalize tail (Q-05 (a)).** An awaited fold helper adds a suspension even on the no-probe path, and an async tail adds another. Rebuilding today's ordering would need a more elaborate abstraction than the duplication costs.

## Drift left for the alignment arc

1. **An unknown `priorityLevel` (a bug lead).** It is reachable through malformed internal popup RPC input: neither `applyFeeSelection` nor `assertExecutableOperation` validates priority, and the reuse fingerprint keeps the string. A fresh build falls back to the default (`service.ts:1109` passes `undefined`). Reuse throws `.mul(undefined)`'s "Not an integer". It is not dApp-reachable. estimate-reuse must preserve it, not absorb it.
2. **The fast-path fallback shows two "Estimating fee" steps**: the first completed, the second live. Pinned and kept.
3. **The card compares addresses case-sensitively**, while the balances store keys them case-insensitively. A case-only change re-initialises the card; addresses arrive lower-case. Kept.
4. **Embedded's inert multiplier `1`.** The comments are corrected; the argument stays.

## Decisions (delegated)

### Plan audit (Codex GPT-6 Astra xhigh: REVISE, three blockers, high confidence; Opus: APPROVE with conditions)

The program's behaviour rule counts event ordering and engine-generated text as behaviour, and Codex brought probe evidence for both, so the arc shrank.

- **Blocker 1: the task wrapper reorders task events.** *Adopted, dropped (Deferred 1).*
  - Codex probed it in memory. The extra `await` before `complete()` lets a concurrent sibling's synchronous completion broadcast first.
  - Opus argued port traffic is macrotask, so the hops are unobservable. Codex's evidence on the synchronous broadcast decides it.
  - The fast path's hand-off gains its one-sentence invariant comment.
- **Blocker 2: the `committedMaxFees` reachability claim was false.** *Adopted, dropped (Deferred 2).* Fact 4 and § Security were corrected: `safe_json_rpc_client.js:173-182` returns `undefined` for a null-like result before schema parsing.
- **Blocker 3 and Ask 1: the probe fold and the FPC tail.** Codex said keep them inline; Opus said ship them. *Kept inline (Deferred 3)*: each helper adds a suspension, and restoring today's ordering would need a heavier abstraction.
- **Kept, both legs agreeing:**
  - `validatedSimOpts`: synchronous, exactly three keys, the rebuilt account at V5/V6, probe options never spread. Keep the distinct-account-per-build pins.
  - The card helpers, under four conditions: lazy reads, P3's guard kept, the template-literal key, and a `liveFeeScope({})` row pinning `"undefined"`.
- **Ask 2: screenshots.** Both legs rejected the Send-only proxy fallback, and it was deleted.
  - The harness reaches every host: its port stub, a `windows-*` route through a stubbed `dapp-interaction` port (as in visual-shells-b), and seeded authwit rows that open both popups (as in visual-shells-a).
  - The state list in § UI impact is theirs.
- **Should-fix: comments.** *Adopted:* every inert-multiplier claim, the provenance tags, `// first approach`, and the `Q-04 pilot:` tag, which sits at `build-fee-strategies.ts:9`.
- **Should-fix: Drift 1 is reachable.** *Adopted* as a bug lead. Codex showed the path; Opus places it inside the trust boundary. Both agree no dApp can reach it.
- **Nits.** *Adopted:*
  - the false "Firefox was not probed (no binary)" line was dropped;
  - the mislabelled `getCurrentMinFees` lifecycle row became the admission-cap refusal;
  - the identity matrix is a flat `test.each` under the complexity budget.
- **Rejected:** none.
