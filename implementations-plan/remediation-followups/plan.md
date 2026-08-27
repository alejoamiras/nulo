# Remediation follow-ups — 2026-08-16-extension-mid (meta-orchestration)

The residue of the [2026-08-16 dual-audit remediation](../../audit/bugs/2026-08-16-extension-mid/remediation.md) (30 bugs + 12 quality, shipped as 9 codex-converged PRs #384–#396 + closure #397). Every item below was a **codex-agreed documented deferral** at the time — recorded in the two `remediation.md` files' "owned follow-ups" sections. This plan is their execution spec.

**This is a meta-plan.** Each arc gets its own `/blueprint` at its tier, its own worktree, its own plan, its own PR.

---

## RECON-FIRST (mandatory, non-negotiable)

Before drafting ANY arc plan, fan out parallel read-only recon agents to verify every anchor against **current dev**. Evidence from the last remediation:

- Line numbers were stale in **every** arc (Arcs 5–8 reshaped the exact files the later arcs targeted).
- **Two findings mis-described their own target**: Q-01's real seam was the duplicated purge-epoch fence, not the `deleteDatabase` teardown it named (that was already half-unified by Arc 5's `deleteDb`); and the `ImportExportCoordinator` it proposed **does not exist** in the PXE service.
- One finding had the **wrong file path** entirely (Q-02's `restoreBackup` is a composable, not `services/backup/`).
- One **over-counted its sites 2×** (Q-07 listed ~10 popups sharing an Enter-guard; only 5 were byte-identical — the other 5 fire on global Enter, so folding them in would have been a regression).

**CURRENT DEV WINS** over any doc, including this one. Recon may REDIRECT or CANCEL an arc; a cancelled arc is a valid codex-agreed outcome, not a failure.

## PROVE-FIRST

- **Bug arcs (1–4):** a RED test reproducing the counter-example BEFORE the fix; it becomes the green regression pin. Can't reach red after honest effort → codex xhigh consult → if codex agrees it's unreachable, mark NOT-REPRODUCED, no code change, move on.
- **Quality arcs (5–8):** characterization pins first, **zero behavior change**.

## ANTI-OVERENGINEERING

Smallest safe change. No NEW abstraction unless ≥3 call sites benefit **AND** codex agrees. **Prefer adopting the primitives already shipped** over extracting new ones. Any item may be rejected as not-worth-it — that is a success state, recorded as a deviation.

---

## Arcs

### 1 · `fix-account-generation-fence` [mid] — correctness
**F-B27 residual.** `appStore.setupActiveAccount()` awaits storage + `commitScopeChange`, then assigns `appStore.account` with **no bootstrap-generation awareness** — a superseded profile activation's in-flight selection can still land after the winner's. Arc 6 fenced the composable (`useProfileBootstrap` single-flight + mutation-level generation fence) and closed the finding's own counter-example; this is the store-level residual.

**Also in this arc (deliberately):** remove `AccountService.serializePerTuple`'s pinned `void next.finally(() => {})`. It emits a latent `unhandledrejection` when the op rejects. Arc 8 PINNED it verbatim (repo bug-pin rule) because removing it inside a zero-delta dedup would have been a smuggled behavior change. It belongs **here**, classified as a behavior fix, with its own pin.

### 2 · `fix-profile-deletion-status` [mid] — correctness
**F-B24.** A failed compensating `deleteProfile` during full-backup-import rollback leaves an orphaned, still-selectable, never-finalized profile. Arc 6 shipped a bounded retry + a distinct "Import incomplete / cleanup pending" error (no false success); the durable half is missing: a **deletion-status field on the profile row** so a later unlock can resume the compensating delete.

⚠️ Persisted-shape change → re-read [`CLAUDE.md` § Persisted-storage shape changes](../../CLAUDE.md) and confirm the **pre-production no-migration rule still holds** before writing a migration.

### 3 · `fix-storage-row-repair` [light] — correctness
**F-B23.** `EntityStorage.decodeRow` now RETAINS malformed rows — correct, B-23 removed a racy read-path delete that could destroy a concurrent valid write — but **nothing ever repairs them**, so a malformed row is immortal. Add a serialized repair path.

Recon first: a **repair-on-next-write** may be strictly better (and far cheaper) than a new sweep subsystem. Reject the arc if neither is worth it.

### 4 · `fix-discovery-restart-durability` [mid] — correctness
**F-B16.** Queued dApp discoveries still vanish on service-worker restart. Arc 4 shipped the SDK-aligned 60s staleness window + rollback-safe approval (`approveOrRollbackDiscoverySession`), not durability. Note the interaction with the anti-lost-tx invariant (below) before touching anything on the `background.ts` message path.

### 5 · `primitive-adoption-closure` [light] — **we recreated Q-07**
Q-07 was literally *"extracted shared helpers exist but adoption stalled partway."* The remediation shipped five new helpers and deliberately left sites unadopted. Close it:

- **F-Q05** — migrate `operation-journal/reaper.ts`, `services/price/service.ts`, `profile/session-manager.ts` onto `AlarmDispatcher`. Each keeps its **own** boot-run + gating (the thin-wrapper contract; `session-manager` is `when`-based, `reaper`'s boot sweep takes different args than its periodic tick, `price` is gated with external dispatch).
- **F-Q07** — `network/service.ts` restore takes `unknown[]` (the helper's `TIn extends object` bare-spread would change non-object-row behavior) and `config/service.ts` restore skips allowlist-misses with **no push** (the helper emits one row per input). These need `restoreRows` to **gain a capability** — design it, or reject them as correctly-deferred. `task/service.ts`'s sync `Map.has` vs `nextRandomId`'s async `contains` is a one-site adapter: probably reject.
- **Sweep** — repo-wide, find any site that should use `KeyedLock` / `SingleShotTtlCache` / `preferOrReallocId` / `isPopupSubmitKey` / `AlarmDispatcher` and doesn't.

### 6 · `row-service-method-families` [mid] — structural
**F-Q09**, the half of Q-09 Arc 8 deferred:
- `token/service.ts` — `getTokenInterface` + `parseTokenInterface` each hand-unroll all 9 `TokenFnKind`s, while the co-located `TOKEN_FN_DESCRIPTORS` header comment explicitly says consumers should **iterate** it. The two methods differ in the second half of each pair (stored `token.*Fn` vs `getDefaultTokenFn`) — parameterize the per-kind "pick source" step.
- `token/service.ts` — `addToken` / `addSeededToken` share a byte-identical 16-field build + journal/lock/emit machine. Extract `persistToken` with a **pluggable metadata source**: do NOT collapse the seed path's deliberate no-refetch TOCTOU fix back into a re-fetch.
- `network/service.ts` — `addEndpoint` / `updateEndpoint`'s ~80% pipeline. Divergences to preserve: push-vs-replace, the self-excluding collision predicate, and update's post-write cache eviction.

### 7 · `restore-stage-2` [mid] — structural
**F-Q02.** The next `restoreBackup()` stages after Arc 9's `validateAndMigrateBackup`.

⚠️ **Hard constraint from the Q-02 verifier:** account-provenance filtering and token relinking share the deliberately-hoisted `importedChainAddress` Set — they must stay together or be threaded explicitly. Naive independent extraction silently drops that cross-check. Stage it; do not attempt the whole closure.

### 8 · `composition-root-pilot` [deep] — **PILOT ONLY**
**Q-04** (`CONFIRMED`, deferred by both audit legs). Pilot the two lowest-risk pieces the verifier named: `buildFeeStrategies` (built from already-set fields at `init()`'s tail — no ordering hazard) and/or `wireTabLifecycle` (closes only over handler/logger).

Then **STOP**, write up what the pilot proved about the 25 `= null!` eager fields (eager non-closure deps like `resolver`/`txBuilder`/`planner` capture a still-`null!` instance if the order changes, and `= null!` disables strict-null-checking so nothing guards it), and report. **Decomposing `initWalletSdkHandler` or the rest of `execution/service.ts` `init()` is OUT OF SCOPE without owner sign-off.**

---

## OWNER-GATED (surface a recommendation; do NOT start)

- **9 · `pxe-service-split` [deep]** — F-Q01 continued: extract the #281-D4 generation/incarnation fence (`profileLifecycles` + `storeKeys` + `assertGenerationCurrent` + `provisionChainStoreKey`). Arc 9 deliberately stopped short: this one adds op-path read-coupling (`storeKeys` is read at every `registry.ensure`) that the epoch-fence extraction avoided entirely.
- **The remaining 4 god-services** (network, profile, token, execution) — architecture strategy, not an autonomous loop.

## REJECTED (stay rejected; re-record as deviations if re-raised)

- **F-Q08a `sessionQueues` → split-release `KeyedLock`** — it is not a plain FIFO: an early-release baton hands off mid-handler at the execution-mutex enqueue, and journal creation happens at message ARRIVAL, deliberately outside the lock. That pairing IS the anti-lost-tx `concurrent-sendtx` invariant — which a previous arc's B-13 fix already regressed once. Value: near zero. Risk: the highest in the codebase.
- **F-Q11 `BlockingBarrierFrame`** — 2 sites, purely visual, no incidental-divergence payoff (unlike Q-10), and the two barriers carry genuinely distinct security-relevant staleness guards (`eventTouched` set-wins vs `refreshGeneration` monotonic counter) that must not be merged. Both audit legs said defer; make it permanent unless a third barrier appears.

---

## Learnings to apply (paid for in the last remediation)

1. **A shared primitive whose adopters had DIFFERENT prior behavior cannot be byte-zero-delta by default.** `KeyedLock`'s three adopters disagreed on the force-release watchdog (`coordinator` had it, the two raw promise-chains didn't) — the fix was an opt-out `maxHoldMs`, not a single default. Audit every adopter's prior semantics before extracting.
2. **Never let a behavior fix ride inside a zero-delta refactor.** If a dedup would incidentally fix a bug, PIN the bug verbatim and file it separately. Codex enforced this twice and was right both times.
3. **When an arc holds ≥2 findings touching the same file/flow, re-run the OTHER findings' pins after EACH fix**, not just at the end. A B-13 fix silently broke B-16's invariant; only CI caught it.
4. **Expect codex and fable to split on microtask/scheduling purism.** Protocol: structurally avoidable → fix it; inherent to the refactor AND provably unobservable AND strictly safe → document + accept at the call site with the safety argument written down. Don't re-litigate per arc.
5. **Verify "N duplicated sites" one by one.** Byte-identical or it is not a site.
6. **`frozen-account-canary`'s post-SW-restart unlock flakes.** Red check = flake → rerun ONCE, real → fix. Never weaken a gate, never `--admin`. Network e2e runs SOLO locally.
7. **Commitlint:** PR title ≤93 chars (squash appends ` (#NN)`, header max 100); commit subject lower-case.
8. **The worktree guard rejects compound bash** with redirects / `cd` to computed paths — write launcher scripts to the scratchpad and run them plainly.

## Process per arc

`/blueprint` at tier (light = single codex audit; mid = dual codex + fable; deep = 3 plans + double audit). Open design questions → codex xhigh via the codex skill scripts (detached `setsid` + Monitor for long runs). 3 fails on one step → codex consult + lesson log. **ONE** codex xhigh pass over the COMPLETE arc diff at the end → fix → resume → converged (bounded: initial + max 2 resumes; a disagreement surviving one pushback → the SIMPLER option wins). PR (conventional title ≤93 chars; body cites item IDs + audit paths) → babysit `gh pr checks` → squash-merge when green.

## Validation

Repo gates (`lint`, `typecheck:all`, affected tests; `audit:vue` when `apps/extension` is touched). Armed smoke: arcs 1, 2, 3, 5, 7. `NULO_E2E_PROVERLESS=1 bun run e2e:agent` **SOLO**: arcs 2, 3, 4, 8.

## Done when

Every arc 1–8 item is merged-fixed or rejected as a codex-agreed documented deviation (including any NOT-REPRODUCED); arc 9 + the remaining god-services are surfaced to the owner as a written recommendation, **not started**; a "Follow-up closure" section is appended to BOTH `remediation.md` files (item → PR → status); `implementations-plan/index.md` is updated; `audit:vue` is green on post-merge dev; and a final owner report lands (PRs, codex consults + verdicts, rejected items with reasoning, anything newly discovered).
