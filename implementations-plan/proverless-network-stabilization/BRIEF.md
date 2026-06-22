# Proverless Network E2E Stabilization — Shared Planning Brief

> This brief is shared by all three independent planners (main agent, codex, fable
> subagent). It gives you the **facts and the observed failures**, not a prescribed
> solution. Where a design fork is open (esp. the "Approach" question below), reason
> about it **independently** and defend your answer. Challenge the main agent's leanings.

## CORRECTIONS (verified against source after drafting — supersede the facts below)

The opus planner caught factual errors in the original brief; all three are now verified against source. Auditors + the consolidated plan must use THESE, not the stale text further down.

1. **`protocolTimeout` IS set to `300_000`** at `packages/extension/tests/e2e/fixtures/extension.ts:52` (default is 180_000; bumped for argon2 KDF + bb.js wasm boot under memory pressure). The brief's "protocolTimeout is NOT set" is **FALSE**. Consequence: Mode 2's ~21.5-min hang means the 300s timeout already FIRED (×`retry:2` ≈ 21 min). **Raising `protocolTimeout` cannot fix Mode 2** — it's a true browser freeze (resource starvation, leading hypothesis). The "protocolTimeout will fix Mode 2" inference is dead.
2. **The journal-records concurrency-assertion pattern already EXISTS** at `packages/extension/tests/e2e/network/concurrent-sendtx.test.ts:109-132` (reads `nulo:journal@<id>`, parses, filters `kind === "dapp_execute"`, asserts `{stage, sessionId}`). So Mode 1's fix = apply this proven pattern, not novel design. Caveat: that file ALSO keeps a 10s `tx-awaiting-card` DOM cross-check (`:140-143`, a milder latent race than Mode 1's instant read) AND its shard-3 failure was at the final `waitForPgResult` settle (Mode 3), not the journal-read. Even the "good" sibling isn't fully clean.
3. **The proof-gate is ALREADY a typed injected collaborator** — `ProofGate` interface + `NOOP_PROOF_GATE` prod default at `packages/extension/src/e2e/proof-gate.ts:25-33`, injected into `ExecutionCoordinator`, awaited before `pxe.proveTx`. The user's "typed seam, not inline hack" bar is met on the SEAM side; the only inline-hack debt is the TEST-side journal read (copy-pasted), which a shared typed fixture helper fixes.

## Mission

Get the network e2e suite **reliably green on every PR (zero flakiness)**, then make
`Network e2e / Status` a **required** check on `dev`. The end state: a network-touching
PR cannot merge to `dev` with a red (or flaky-red) network suite, and the suite does not
produce false reds.

## Confirmed scope decisions (from the user — do NOT relitigate these)

- **Scope = BOTH classes.** (A) test-assertion timing races under proverless; (B)
  infra/resource degradation (long hangs). Full stabilization, not just A.
- **CI gating = broaden the paths-filter + flip Status to required on `dev`.**
- **Sequencing = fix-in-place.** No quarantine / no `.skip` of flaky tests. The suite
  stays advisory until it is genuinely robust under repeated runs, then we flip to
  required in one well-validated PR. The user will only merge "when extra-sure".
- **Iterate locally** via `bun run e2e:agent` before ever pushing.

## OPEN fork — the "Approach" question (reason independently)

The user explicitly handed us this and asked "what's the most professional solution?":

> "I'm wondering if the proverless-stub shouldn't have been more broad to be able to time
> the simulating, proving, submitting for our tests. But maybe it's too much and it breaks
> the idea of e2es. Not sure what's the most professional solution here."

**Main agent's current lean (ATTACK IT — do not just agree):** three assertion patterns,
each matched to what the test asserts:
1. **Outcome** ("tx succeeds / balance changes") → poll the **persistent journal terminal
   state**; never observe transient stages.
2. **In-flight / concurrency** ("two txs active at once") → park deterministically at the
   **single existing proof-gate barrier** (`holdProofGate`), then assert against the
   **journal records** (not the rendered DOM cards).
3. **Ordered-sequence** ("simulating→proving→submitting happened in order") → read the
   **recorded journal history** after completion, rather than catching each stage live.

Main's claim: stop at the **one** proof-gate seam. Holding `simulating`/`submitting`
individually would require injecting controllable seams into real subsystems (kernel
simulator, node client) that aren't faked — that *would* break the e2e. The single
proof-gate is enough because (a) proving is the longest real stage in production anyway,
(b) ordered-sequence assertions can read journal history post-hoc, (c) two-in-flight
assertions only need ONE tx parked to be deterministic.

**Counter-arguments to weigh:** Is a single barrier point really sufficient for every
concurrency assertion? Does reading journal history lose meaningful coverage vs. live
observation? Is the chrome.storage.session-key signalling mechanism of the current gate
robust, or should the seam be a properly injected typed collaborator (the user's standing
quality bar: "a typed injected collaborator, mirror the AcceleratorProver seam, not an
inline hack")? Could a broader stub actually be *simpler* than three patterns?

## System facts (verified, with repo-relative paths)

- **proverless is a TEST-ONLY mode.** `NULO_E2E_PROVERLESS=1` builds a wallet that skips
  BB-SNARK generation; **kernel simulation + on-chain submission stay real**. Real users
  always get real proving (with a natural, observable proving window). Arming is
  double-opt-in (`VITE_NULO_E2E_PROVERLESS=1` + `..._CONFIRM=1`), enabled in
  `packages/extension/src/e2e/config.ts`. Bundle is stamped (`NULO_E2E_PROVERLESS_BUILD_STAMP`)
  and `packages/extension/scripts/e2e/agent.sh` hard-fails if the stamp is absent.
- **The proof-gate seam already exists.** `packages/extension/tests/e2e/fixtures/proof-gate.ts`
  (`holdProofGate`/`releaseProofGate`) writes `PROOF_GATE_KEY` into `chrome.storage.session`;
  the offscreen `ChromeStorageProofGate` watches it and holds inside the SW
  `ExecutionCoordinator.proveTxTask`, **after** journaling `proving`, **before** `pxe.proveTx`.
  So a held gate = the tx is deterministically parked at `proving`.
- **The journal** is the persistent source of truth: records under `nulo:journal` in
  `chrome.storage.local` (EntityStorage), `progress.stage ∈ {pending, simulating, proving,
  submitting, succeeded, failed, cancelled}`. `RecentActivityView.vue:310` filters terminal
  ops out of the active-card view → the rendered `tx-awaiting-card` unmounts on `succeeded`.
- **The #93 fix** (`waitForSendTxActiveStage` in `tests/e2e/fixtures/popups.ts`) now polls the
  journal record for an active-or-succeeded stage instead of the DOM card. Correct for the
  helper — but see Mode 1 below for the race it shifted.
- **CI workflow** `.github/workflows/pr-network-e2e.yml`:
  - Triggers: `workflow_dispatch` + `pull_request` [main, dev] (opened/reopened/synchronize/
    labeled/unlabeled). **No `push:` trigger.**
  - `changes` job: `dorny/paths-filter@v4`, `extension-network` filter — **already broad**
    (includes `execution/**`, `wallet-bridge/**`, `aztec-runtime/**`, `playground/**`,
    `tests/e2e/**`, configs, lockfile). #85 touched execution + wallet-bridge → the filter
    DID fire on #85.
  - `decide` job: run=true iff `workflow_dispatch` OR base=main OR label `e2e:network` OR
    (base=dev AND filter-hit).
  - Matrix: 5 shards (proverless, accelerator OFF) + 3 dedicated heavy/canary jobs
    (`network-e2e-heavy` = fee-methods; `network-e2e-heavy-concurrent` = concurrent-confirm;
    `network-e2e-canary` = transfers + tx-sendTx-default with REAL proving + accelerator ON).
  - `status` job: `if: always()`, aggregates the jobs; emits **pass-when-skipped**. Currently
    advisory on dev (only `Quality / Status` is required).
- **Each shard is its OWN ubuntu-latest runner** (matrix → separate hosts), and
  `vitest.e2e.network.config.ts` sets `fileParallelism:false`, `pool:forks`, `isolate:true`,
  `testTimeout:30_000`, `hookTimeout:300_000`, `retry:2` (3 attempts). So the failures below
  **survived 3 attempts**, and the load is **within-runner** (anvil + aztec sandbox +
  playground + chrome + real WASM kernel-sim on 2 cores), NOT cross-shard contention.
- **`protocolTimeout` is NOT set** in the puppeteer launch (Mode 2's error names it).
- **Local runner = CI runner.** `agent.sh` runs the identical vitest config + proverless
  build. Caveat: the dev's Mac is far beefier than a 2-core CI runner, so **Class B
  starvation modes may not reproduce locally** — a key iteration-cycle problem to solve.

## OBSERVED failure modes (PR #93 run 27570686950 @ a7cf969, post-#93, after retry:2)

Green: shard 2, shard 5 (#93 fixed the `waitForSendTxActiveStage` family here), heavy/fee-methods, canary/real-proving.

- **Mode 1 — in-flight state read races the DOM render (Class A).**
  `concurrent-sendtx-approve.test.ts:119` → `AssertionError: expected 0 to be >= 2`.
  Root cause (traced): the test holds the proof gate (T1 parked at `proving`) AND calls the
  #93 `waitForSendTxActiveStage` (journal-poll, passes fast), THEN at line 108 reads
  `tx-awaiting-card` **DOM** elements from a popup opened one line earlier (106). The fresh
  popup's Vue app hasn't rendered the cards yet → 0 cards. The journal is active but the DOM
  hasn't painted. **The #93 journal-poll returns before the UI paints, shifting the race into
  every test that reads cards after the helper.** Fix direction: assert the two-in-flight
  state from the **journal records** (T1 active + T2 queued), not from rendered cards.
- **Mode 2 — CDP / browser freeze (Class B).** shard 1 `authwit-lifecycle`, ~21.5 min wall:
  `ProtocolError: Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting`.
  The browser itself is unresponsive — `page.evaluate`/`waitForFunction` can't even run. This
  is runner/browser health (resource starvation), not test logic. `protocolTimeout` unset.
- **Mode 3 — settle timeout (Class A/B mix).** shard 3 `authwit-consume-smoke:75,103` +
  `concurrent-sendtx`, ~17 min: `waitForPgResult TimeoutError: 120000/240000ms exceeded`. The
  dApp's sendTx promise never settled in budget — degraded sandbox/PXE (B) or a real
  non-settling flow (A). Needs per-occurrence triage.
- **Mode 4 — tx error under heavy load (Class A/B mix).** `concurrent-sendtx-confirm:111,113`,
  ~14.5 min heavy job: `AssertionError: expected 'error' to be 'ok'` + 300s `waitForPgResult`.
  A tx returned `error` (likely gas-envelope / prover-queue pressure under load — note the
  `VITE_NULO_FEE_MULTIPLIER` widening lever referenced in `agent.sh`).

## Retro to include (the user asked: "how did we fuck up?")

- **#86** (`feat(e2e): proverless network-e2e split with controllable barrier`) converted the
  bulk suite to proverless. proverless collapses the proving window to ~0 → every assertion
  that *observed* a transient stage by racing real time became latent-flaky.
- **#85** (`feat(authwit): public-authwit lifecycle testability`) added/extended tests and a
  2-account fixture; its timing shift tipped the already-racy assertions over, AND it **merged
  with a red network e2e** because the gate was advisory on dev.
- **Process failure:** advisory gate + no human checking the (red) network result let the
  breakage land on dev invisibly. The make-required decision is the systemic fix for THIS.
- **Our own debugging failure (lesson to bake in):** we theorized + bisected blindly for ~10
  runs, mis-attributed to a 2-account fixture (red herring), and only root-caused once we
  **instrumented the journal record directly**. Bake "observe/instrument first" into the
  iteration cycle.

## Constraints / hard limits

- Never merge to `dev`/`main` without explicit user approval; never publish/deploy.
- The required-check flip is a **GitHub ruleset/branch-protection change** (gh api / repo
  settings, admin) — a discrete step, not a code change. Call it out explicitly.
- No data migrations (no prod users) — wipe/reseed is fine.
- Do NOT run codex concurrently with a local e2e run (it perturbs timing → flakes).
- No personal absolute paths in any committed artifact (repo-relative only).

## What each planner must produce

A full `plan.md` draft with:
1. **Phased structure**, every phase ending in a concrete **Validation gate** (real commands
   from package.json scripts / workflow steps + pass criteria + which layers it exercises).
2. The **retro** above, sharpened.
3. The **iteration-cycle design**: local `agent.sh` loops (per-file, repeated-N-times to
   surface flake) AND an answer to "how do we validate Class B modes that may only reproduce
   on weak CI runners?" (e.g. CPU-throttled local runs, a `workflow_dispatch` CI loop, larger
   runners, a soak job).
4. **Security & Adversarial Considerations** section.
5. **Assumptions** section (Facts / Inferences / Asks).
6. Your **independent answer to the Approach fork**.

## Mandatory audit asks (answer these in your plan)

- **Adversarial / security:** This suite is about to become a REQUIRED merge gate. What's the
  attack surface? Consider: the SHA-pinned `accelerator-server` binary download from a GitHub
  release, the `SPONSORED_FPC_SALT` secret, workflow token scopes (`contents:read` default),
  and the **pass-when-skipped** Status — could a malicious/clever PR neuter the gate by
  dodging the paths-filter while still changing network behavior? What are we trusting that we
  shouldn't?
- **Assumption-attack:** Which **Facts** here are misstated? Which **Inferences** are unsafe —
  especially "Class B is within-runner starvation", "`protocolTimeout` will fix Mode 2",
  "proverless is purely test-only", "Mode 1 is a DOM-render race"? Which **Asks** need
  surfacing to the user instead of being silently assumed?
- **Make-required risk:** If we flip to required and the suite is still even ~1% flaky, we
  block ALL network-touching dev PRs. Is "zero flakiness" achievable, or do we need a defined
  retry budget / soak threshold / escape hatch? The user said no quarantine — but a required
  gate with no escape hatch is itself a risk. Surface it; don't silently assume.
