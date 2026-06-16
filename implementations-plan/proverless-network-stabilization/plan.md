# Proverless Network E2E Stabilization

> **Status:** APPROVED — ready to implement (`/blueprint deep` complete: 3 plans → consolidation →
> contradiction-check → double audit [codex *reject* + fresh-opus *conditional*] → final
> fresh-context codex pass [*conditional approve*]; every blocking finding + all 3 final
> conditions folded in). User decisions at the gate: D7 broaden-allowlist (gaps closed), D9
> retry:1 live, `/harden` deferred to pre-release. Implementation is user-triggered (paste a seed).
> **Outcome:** one well-validated PR to `dev` (opened only after the real-runner soak is green),
> then a separate user-gated admin step to flip `Network e2e / Status` to required.

## Mission

The network e2e suite must be **reliably green on every PR (zero *observed* flakiness)**, then
become a **required** check on `dev`. A network-touching PR must not be mergeable with a
red/flaky network suite, and the suite must not produce false reds. This is a **stabilization
project, not a single bug** — PR #93 fixed one failure family; the suite is still flaky across
≥4 distinct modes.

## Corrected facts (verified against source this session)

- **`protocolTimeout` is already `300_000`** (`tests/e2e/fixtures/extension.ts:52`, for argon2/bb.js cold-boot). Mode 2's ~21.5-min hang means it *fired* → **raising it cannot fix Mode 2.**
- **Runner = `ubuntu-latest` (4 vCPU / 16 GB)**, not 2-core (`_network-e2e.yml:89`; `docker-ci-like.sh` calibrates to "4 vCPU, 16GB").
- **`docker-ci-like.sh` already accepts a file arg** (`:127` `if [[ "$SHARD" == *.test.ts ]]`) — no extension needed; just use it.
- **The proof-gate is already a typed injected collaborator** (`ProofGate` + `NOOP_PROOF_GATE`, `src/e2e/proof-gate.ts:25-33`). Only the **test-side** journal read is copy-pasted debt.
- **The journal stores only current `progress.stage`, no history, and no per-request correlation key** (`operation-journal/service.ts`, `spec.ts`). Concurrent same-session txs share `sessionId` → **per-record scoping is not possible without new identity plumbing** (and is not needed — see Approach).
- **`waitForSendTxActiveStage` is unscoped + allowlists `succeeded`** (`popups.ts:407`). **6 real call sites** across 6 network test files (multi-account-from, concurrent-sendtx-approve, tx-sendTx-feePayer/-sponsoredFpc/-default/-multicall). `aztec.ts` + concurrent-sendtx-confirm + the unit test only *mention* it in comments — NOT callers.
- **The journal-read concurrency pattern already exists + works** (`concurrent-sendtx.test.ts:109-132`, exposes `{id, stage, sessionId}`).
- **`SPONSORED_FPC_SALT` is dead plumbing in the localhost PR gate** (`_network-e2e.yml:96` → `''`; fixtures/runtime hardcode `0n`).
- **The filter is an allowlist that misses shared deps**: the extension depends on `@nulo/wallet-core`, `@nulo/wallet-crypto`, `@nulo/extension-messaging` (`packages/extension/package.json`), and patched deps live at `patches/**` (root `package.json`) — none are in the current filter.
- **Trusted pre-gate jobs use float-pinned actions** (`actions/checkout@v6`, `dorny/paths-filter@v4`) and `setup-aztec` does `curl … | bash` from install.aztec.network (`setup-aztec/action.yml:40`).
- **README still calls the suite "advisory on dev"** (`tests/e2e/README.md`).

## The Approach (the OPEN fork the user handed us) — consolidated + audit-corrected

All three planners rejected both extremes; the audits then corrected the helper design.

- **Reject the broad stub** (hold `simulating`/`submitting`): faking real subsystems (kernel sim, node client) breaks the e2e contract + expands the proverless catastrophe surface. The user's instinct is right.
- **Reject "request-scoped to the exact record"** (codex blocking finding): impossible today — concurrent same-session txs share `sessionId` and there's no per-request key.

**The implementable answer = ONE principle + ONE seam + the RIGHT helper shape:**

1. **Principle:** the **journal record is the source of truth for every stage assertion**; the DOM
   (`tx-awaiting-card`) is asserted only when a test's purpose is rendering, and only after the card paints.
2. **Seam:** keep the **single** proof-gate barrier at `proveTxTask` (already a clean typed collaborator).
3. **Helper shape — session-scoped COUNTING, not per-record scoping:** the concurrency assertions
   need *counts* ("≥1 record active AND ≥1 queued within this dApp session"), not "is *this* tx
   active." So the new helper is `countInFlight(page, {sessionId})` / `waitForInFlight(page, predicate)`,
   plus an explicit split between **active** (excludes terminal — fixes the `succeeded`-conflation bug)
   and **settled/outcome**. Single-tx tests scope to the session (one record); concurrency tests use
   the count. If a future test ever needs to assert a *specific* one of two same-session txs, THEN add
   a correlation key to the journal — not now.

**Narrowed claim (audit correction):** journal-truth fixes the stage-*timing* race (Mode 1 family). It
does **not** fix Mode 2 (a frozen CDP channel breaks the in-`page.evaluate` journal read too) or Mode 3
(the `waitForPgResult` settle timeout). Those are Class B / settle problems handled in Phases 3-4.

---

## Phases (reordered per both audits: safety → known Class-A fix → instrument → Class B → triage → soak → ship → require)

Layer legend: **TC**=typecheck · **L**=lint · **U**=unit · **EP**=e2e-proverless(local Mac) · **EPc**=e2e-proverless(CI-container) · **EPr**=e2e-proverless(real-runner soak) · **ER**=e2e-real-proving-canary.

### Phase 0 ✓ — Lock the proverless prod-safety invariants (first; we're about to touch proverless-adjacent surfaces)

- Add/confirm a **unit test** that the double-opt-in fails closed: default build (no env) → proverless OFF (`src/e2e/config.ts`); extend `chrome-storage-proof-gate.test.ts` if uncovered.
- Confirm the **production negative-grep** (`_build-extension.yml:72`: `PROOF_GATE_KEY`/`NULO_E2E_PROVERLESS_BUILD_STAMP` ABSENT from prod builds) is wired on the release path. Read-only verify; add a test if a guard is missing.

**Validation gate:** `bun run lint && bun run typecheck && bun run --filter @nulo/extension test` exit 0; the "proverless armed only with both flags" invariant has passing unit coverage. Layers: **TC · L · U**.

### Phase 1 — Class A root fix: session-scoped journal counting + helper-contract fix

- Add `tests/e2e/fixtures/journal.ts`: `readDappExecuteRecords(page): {id,stage,sessionId}[]` (typed shared read — kills the `concurrent-sendtx.test.ts` copy-paste); `countInFlight(page, {sessionId?}): {active, queued, total}` (active EXCLUDES terminal); `waitForInFlight(page, predicate, opts)`.
- **Split the helper contract**: one helper means "journal reached a stage" (active, terminal-excluded), a separate one means "the UI rendered N cards." Neither may imply the other. **Deprecate the unscoped `waitForSendTxActiveStage`** and migrate its **6 callers** (multi-account-from, concurrent-sendtx-approve, tx-sendTx-feePayer/-sponsoredFpc/-default/-multicall). Single-tx tests → session-scoped single-record wait; the `succeeded` allowlist is removed from "active" (single-tx tests that want "reached active OR settled" say so explicitly).
- **Migrate Mode 1** (`concurrent-sendtx-approve.ts:106-122`): keep `holdProofGate`; replace the popup-card read with `countInFlight` (≥1 active + ≥1 queued in the session). Delete the popup-card dependency at the assertion.
- **Migrate the sibling card-checks** (`concurrent-sendtx-confirm` `data-stage` wait; `concurrent-sendtx.ts:140-143` 10s card wait) to counts. Keep at most ONE explicit, robust card-render assertion (wait journal-active first, THEN card with a generous budget) if UI coverage is wanted — never as the primary oracle.

**Validation gate:** `bun run lint && bun run typecheck` exit 0; `bun run --cwd packages/extension vitest run src/wallet/services/operation-journal/service.test.ts` green; `for i in $(seq 1 10); do NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/<file> || break; done` → **10/10** for concurrent-sendtx-approve, -confirm, -sendtx, and a spot-check of 2 migrated single-tx callers (Class A MUST fix on the Mac); grep proves no helper conflates journal-state with card-render. Layers: **TC · L · U · EP**.

### Phase 2 — Instrument-first: failure classification (needed for the UNKNOWN Class B / Modes 3-4)

- Add a journal-snapshot diagnostic + **failure-classifier** to the e2e fixtures (test-only, no bundle): on any `waitForFunction`/`waitForPgResult` timeout, capture (failure-only) journal records, playground result-seq + pending method, Chrome target list, and sandbox/anvil/accelerator health — enough to distinguish CDP-freeze vs sandbox-hang vs real non-settlement without a bisect.
- Make **retry consumption visible** in the reporter (groundwork for the enforceable rule).
- **Build the soak/repeat workflow HERE, not in Phase 5** (final-codex condition 1 — Phase 3's gate needs it). Add `network-e2e-soak.yml` (`workflow_dispatch`): a repeat-in-one-run loop over the EXISTING `_network-e2e.yml` inputs (`test_files`/`shard`/`proverless`/`disable_accelerator` already exist) + `repeats`/`mode`, with per-iteration green/red bookkeeping and the enforceable zero-retry rule. This makes a targetable real-runner soak available to Phases 3, 4 AND 5.
- **Front-load a FRESH failing run** — do NOT depend on run-27570686950 surviving 7-day retention. Trigger a fresh `workflow_dispatch`, `gh run download` the artifacts for Modes 3/4's real `errorJson` + sandbox tails. (`docker-ci-like.sh` already takes a file arg — use it; no script change.)

**Validation gate:** `bun run lint && bun run typecheck && bun run --filter @nulo/extension test` exit 0; `git diff --stat -- packages/extension/src` shows zero `src/` changes (diagnostic is test-only); `lessons/phase-2-triage.md` classifies all 4 modes from real artifacts. Layers: **TC · L · U**.

### Phase 3 — Class B: load reduction + Node-side wall-clock watchdog; **real-runner soak is the gate**

- **Reproduce + name the cause first.** Run `docker-ci-like.sh` (cpus=4/mem=12g) AND a real-runner soak on `authwit-lifecycle`. Using Phase 2's classifier, CONFIRM the hypothesis: browser frozen *while sandbox/anvil stay healthy* + actual memory/CPU-pressure evidence. If the evidence says it's NOT starvation (deadlock, cold-start, noisy-neighbor), re-plan the fix — do not apply a load fix to the wrong cause.
- **Node-side PROGRESS-BASED stall-watchdog (out-of-band of the CDP channel)** (final-codex condition 2). A timer in the vitest/Node process (NOT a `page.evaluate` liveness ping — that hangs when the channel is dead) that fires on **no-progress** (no journal-stage advance / no completed CDP round-trip for a tuned stall window), NOT on a fixed total wall-clock. A fixed ~300s guard would false-red legitimately-long tests: `authwit-lifecycle` runs to `timeout: 1_200_000` with multiple `360_000` waits (`authwit-lifecycle.test.ts:34,81`), and `hookTimeout: 300_000` is fixture-setup only. On a stall it dumps the Phase-2 diagnostics + fails fast with a labeled error — converting a 21-min dead-air hang into a labeled failure without lowering any CDP timeout. (Acceptable alternative form: derive the guard from each test's declared `timeout`.)
- **Cap per-fork memory** (`vitest.e2e.network.config.ts` `poolOptions.forks.execArgv: ['--max-old-space-size=<tuned>']`), tuned against the repro.
- **Sharding sanity:** if the SHA-1 sharder co-locates the two heaviest authwit files, apply the proven dedicated-job lever.
- **Larger runner = diagnostic only**, never the default fix.

**Validation gate (hardened — real-runner soak REQUIRED, container alone is necessary-not-sufficient):**
- Root cause named + evidenced in `lessons/phase-3.md` (browser-frozen-while-sandbox-healthy + memory/CPU pressure, or the corrected cause).
- A real-runner `workflow_dispatch` soak (`network-e2e-soak.yml` — built in Phase 2, ≥10× on `ubuntu-latest`) shows the freeze GONE; a **before/after** memory-cap pair supports causality (supporting evidence — the soak's repeated green is the actual proof, not the before/after alone).
- Watchdog fires a fast labeled failure on a manually-frozen page (unit-level proof of the Node-side timer is acceptable for the mechanism).
- `bun run lint && bun run typecheck` exit 0.
- Layers: **TC · L · EPc · EPr**. **Hard rule:** a `protocolTimeout` bump is NOT an acceptable fix; container-green alone does NOT pass this gate.

### Phase 4 — Modes 3 & 4: triage-then-fix (from Phase 2 artifacts, not a pre-written fix)

- **Mode 4** (`concurrent-sendtx-confirm` `error` vs `ok`): read `errorJson`. fee/gas-envelope → the `VITE_NULO_FEE_MULTIPLIER` (already 10×) knob only if proven insufficient; **serialization/mutex error → a real concurrency bug**, fix in execution not the test; queue/timeout → Phase-3 load fix.
- **Mode 3** (`waitForPgResult` 120/240s): degraded sandbox → Phase-3 load fix; healthy sandbox + never-settling promise → a real `dapp-send-executor`/plumbing bug, fix at source.
- Write the fix only after the cause is **named in the commit**.

**Validation gate:** root cause documented in the commit; `for i in $(seq 1 8); …` 8/8 for concurrent-sendtx-confirm + authwit-consume-smoke (in-container for the Class-B portion); real-runner soak green for these files. Layers: **TC · L · EP/EPc/EPr** (+ **ER** if Mode 4 needs real proving).

### Phase 5 — Soak with an ENFORCEABLE zero-retry rule

- **Use** `network-e2e-soak.yml` (already built in Phase 2) in `mode=full` for the whole-matrix repeats; finalize the **enforceable zero-retry rule** here: parse vitest's retry reporting; the soak FAILS if any test consumes a retry (a retry-passed test is still flaky). This is what makes "zero retries consumed" a *gate*, not a phrase.

**Acceptance threshold (the bar for the required flip):** former Class-A offenders 10/10 local; former Class-B offenders ≥10/10 real-runner soak; **full matrix 5 consecutive greens with ZERO retries consumed**; real-proving canary green every full run.

**Validation gate:** `bun run audit:vue` exit 0; local full proverless 5/5; canary 3/3; `gh workflow run network-e2e-soak.yml -f mode=full -f repeats=5` meets the threshold with the zero-retry rule enforcing (recorded in `lessons/phase-5-soak.md`). Layers: **TC · L · U · EP · EPr · ER**.

### Phase 6 — Ship: TRUE fail-closed filter + SHA-pin + secret removal + retry config + docs (one PR to `dev`)

- **Broaden the allowlist (D7 — user's call over the auditors' fail-closed rec).** Keep the allowlist shape, but extend it to close the specific bypasses the audit found: add the **upstream workspace deps** `packages/wallet-core/**`, `packages/wallet-crypto/**`, `packages/extension-messaging/**` (aztec-runtime/wallet-bridge/playground already present), **`patches/**`**, root `package.json`/`bun.lock`/`bunfig.toml`, plus the missed extension paths `packages/extension/src/e2e/**`, `.../wallet/services/operation-journal/**`, `.../wallet/runtime.ts`, `packages/extension/package.json`, and `.github/actions/setup-puppeteer/**` + `.github/workflows/_build-extension.yml`. Keep pass-when-skipped for docs-only PRs. **Accepted residual (user's tradeoff vs the auditors' inversion):** a future new top-level package/dir is NOT auto-covered — adding one requires a filter update, enforced by the protected-review on `.github/workflows/**` (Phase 7).
- **SHA-pin** `actions/checkout`, `dorny/paths-filter`, and the other third-party actions in `pr-network-e2e.yml` + `_network-e2e.yml` (they run in trusted pre-gate jobs). Document `setup-aztec`'s `curl|bash` as a known residual trust surface (SECURITY.md).
- **Remove the dead `SPONSORED_FPC_SALT` plumbing** from the four `pr-network-e2e.yml` job calls (keep the reusable workflow's optional decl).
- **Implement the live retry config** per D9 (recommended `retry:1` as a transient-absorber; the value is the one remaining Ask).
- Ensure the required path can never run with `probe=1` (it disables the bundle-probe guard).
- Docs: CLAUDE.md, CI.md, `.github/README.md`, `tests/e2e/README.md` (stop calling it advisory).
- Open the PR; gate merge on the soak. **User merges when extra-sure** (no autonomous merge).

**Validation gate:** `bun run audit:vue` exit 0; `bun run lint:actions` (actionlint) clean; the PR's own `Network e2e / Status` GREEN; a PR touching a shared dep (`wallet-core`) or `patches/**` *triggers* the suite; a docs-only PR *skips + passes*; `grep -rn SPONSORED_FPC_SALT .github/workflows/pr-network-e2e.yml` → no matches; the workflow actions are SHA-pinned (no `@v` floats). Layers: **TC · L · U · EP · ER** + workflow-lint + live-PR.

### Phase 7 — Make required (post-merge, admin, user-gated)

- **Before the flip (final-codex condition 3): protect the gate's own code.** Add required review (CODEOWNERS or a ruleset) on `.github/workflows/**` + `.github/actions/**` so a PR cannot silently modify the workflow/composite-actions that gate it. SHA-pinning third-party actions (Phase 6) does NOT cover first-party gate code changed in the same PR — without protected review the required check trusts code the PR is editing.
- Flip `Network e2e / Status` to required on `dev` via GitHub ruleset/branch-protection. **Not code** — `gh api`/Settings, **user-executed/approved**. Confirm classic-branch-protection vs rulesets first (`gh api repos/{owner}/{repo}/rulesets`).
- Define the **escape hatch**: admin override for a demonstrated CI/platform incident (NOT test quarantine).
- Note the residual: a `vars.NULO_E2E_DISABLE_ACCELERATOR` flip silently drops the canary to WASM — once required, treat that var as a security-relevant control (alert/guard).

**Validation gate:** `gh api` shows `Network e2e / Status` required on `dev`; a deliberately-red network PR is blocked; a docs-only PR merges. Layers: process / CI-config.

---

## Iteration-cycle design

1. `bun run lint` → `bun run typecheck` → targeted `vitest run` for unit/service seams.
2. **Class A — local, fast:** `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/<file>.test.ts`, looped 5–10×. Reproduces on the Mac. **Instrument before theorizing** (dump the journal at the failing assertion).
3. **Class B — local, in-container:** `docker-ci-like.sh tests/e2e/network/<file>` (cpus=4/mem=12g, real runner shape; file-arg already supported). Container is necessary-not-sufficient.
4. **Class B — authoritative:** the real-runner `workflow_dispatch` soak. The professional answer to the 25-min round-trip is "build a cheaper environment that preserves the failure class" (the container) AND "prove on the real machine" (the soak) — not "hope PR CI repros it."
5. Full matrix only when the single-file loop is green.
- **Never run `codex` concurrently with a local e2e run** (perturbs timing → false flake). Log consults in `lessons/phase-N.md`.

## Retro — how we got here

1. **#86 changed semantics, not just speed** — proverless collapsed the proving dwell to ~0, so every assertion that observed a transient stage by racing wall-clock became structurally flaky.
2. **#85 was the trigger** — shifted timing enough to expose the latent races, then **merged red because the gate was advisory on `dev`** and nobody read the red.
3. **Systemic failure: trusting an advisory red gate.** A red that blocks nothing and nobody reads equals no test.
4. **Our debugging compounded it** — blind theorizing/bisecting, a 2-account-fixture red herring; root cause fell out only once we **instrumented the journal**.

**Prevention:** Phase 7 (required) makes factor 3 structurally impossible; Phase 1 (journal-truth) immunizes against factor 1's *timing-race* recurrence (NOT freeze/settle — see narrowed claim); Phase 2 (instrument-first) kills the blind-bisect habit. Until the flip lands: no PR that trips `Network e2e` merges to `dev` without explicit human sign-off on the red.

## Security & Adversarial Considerations

- **pass-when-skipped is the soft underbelly.** The current allowlist misses `src/e2e/**`, `operation-journal/**`, `runtime.ts`, **shared workspace deps** (`wallet-core`/`wallet-crypto`/`extension-messaging`), and **`patches/**`** — all real green-skip dodge paths. Per D7 (user's call) we close these specific paths in the broadened allowlist rather than the fail-closed inversion both auditors recommended. **Documented residual:** a future new top-level path isn't auto-covered — a known, accepted tradeoff, mitigated by required review on `.github/**` (Phase 7) so a filter-evading change can't land unreviewed.
- **Float-pinned actions in trusted pre-gate jobs.** `actions/checkout@v6`, `dorny/paths-filter@v4` decide whether the gate runs; a compromised tag could force a green-skip. SHA-pin them (Phase 6). `setup-aztec`'s `curl|bash` is a deeper residual trust surface — document in SECURITY.md; SHA-pin the GH actions at minimum.
- **The gate's own code is mutable in the PR under review** (final-codex). SHA-pinning third-party actions does NOT stop a PR editing `.github/workflows/**` / `.github/actions/**` to weaken the very check reviewing it. Require protected review (CODEOWNERS/ruleset) on those paths before the required flip (Phase 7).
- **`SPONSORED_FPC_SALT`** — dead plumbing in the PR gate (verified). Remove it (Phase 6).
- **accelerator-server binary** — SHA-256-pinned on the extracted binary (right anchor); canary-only; least-priv token; required = fail-closed. A hash bump is a security-relevant diff. `vars.NULO_E2E_DISABLE_ACCELERATOR` can silently neuter the canary once required — treat as a controlled var (Phase 7).
- **`probe=1`** disables the bundle-probe guard — must never run on the required path (Phase 6).
- **proverless must never ship** — triple-guarded (double-opt-in + bundle stamp + prod negative-grep). Phase 0 pins it; the fail-closed filter ensures `src/e2e/**` changes run the suite + the guard. HIGH — the one irreversible-in-prod failure.
- **Token scopes** least-priv (`contents: read`, `pull-requests: read`); do NOT widen for soak/summary.
- **Supply chain:** 7-day npm min-age, frozen lockfile, `bun audit` in place; no new runtime deps.

## Assumptions

### Facts (verified this session)
- `protocolTimeout: 300_000` (`extension.ts:52`); runner = `ubuntu-latest` 4 vCPU/16 GB; `docker-ci-like.sh` exists + takes a file arg (`:127`); ProofGate is a typed injected seam (`proof-gate.ts:25`); journal stores current stage only, no history, no per-request key; concurrent same-session txs share `sessionId`; `waitForSendTxActiveStage` unscoped + allowlists `succeeded`, **6 real callers**; journal-read concurrency pattern exists (`concurrent-sendtx.test.ts:109`); `SPONSORED_FPC_SALT` unused by localhost PR e2e; filter misses shared deps + `patches/**`; actions float-pinned; README says advisory; `retry:2`/`fileParallelism:false`/`pool:forks` (`vitest.e2e.network.config.ts`).

### Inferences (attack — verify before relying)
- **"Class B is within-runner starvation"** — UNPROVEN. Phase 3 must confirm: browser frozen *while sandbox/anvil healthy* + memory/CPU-pressure evidence + the failure is constraint-dependent (healthy headroom → no repro). If not, re-plan the fix.
- **"Journal-truth removes Class A"** — only the stage-*timing* race (Mode 1). NOT Mode 2 (frozen channel breaks the `page.evaluate` read) nor Mode 3 (settle timeout). Phase 1's 10× loop must clear Mode 1 on the Mac without reintroducing a settle dependency.
- **"`docker --cpus=4` reproduces the hosted runner"** — approximate (virtualized; imperfect swap). The real-runner soak is the arbiter (Phase 3 gate).
- **"Modes 3/4 are timing/load"** — UNSAFE; Mode 4 may be a real serialization bug. Triage-first (Phase 4).

### Asks — ALL RESOLVED at the approval gate
1. **Filter shape (D7) — RESOLVED (user):** broaden the allowlist (NOT the auditors' fail-closed inversion); close the audit-found gaps (shared deps + `patches/**` + missed paths) within it. Residual (new top-level dirs need a filter update) accepted, mitigated by `.github/**` protected review.
2. **Live retry value (D9) — RESOLVED (user):** `retry:1` live; the acceptance soak still enforces zero-retry-consumed.
3. **Escape hatch — RESOLVED:** admin override for demonstrated CI/platform incidents (≠ test quarantine).
4. **Required flip is user-executed** (admin/gh-api), not autonomous — confirmed (hard constraint).
5. **Post-impl `/harden` — RESOLVED (user):** defer a `/harden security` pass to **pre-release**, not now. (Recorded as the Post-implementation hardening decision.)

## Make-required risk (stated honestly)

"Zero flakiness" is the right target but is **not a theorem** for real browser+network CI. A "100% green, no hatch" policy blocks every network PR on the first environmental blip and trains "re-run until green" (the #85 culture). Reconciliation with "no quarantine": "no quarantine" governs *tests* (never `.skip` — root-cause, as Phases 1-4 do); it's separable from the *gate's tolerance*. Flip required only after the soak is green with **zero retries consumed**; keep `retry:1` live as a transient-absorber (a test that *needs* retries is a stop-the-line bug); keep an **admin override for true platform incidents**. Honors "no quarantine" without pretending zero-flake is provable from one run.

---

## Decision ledger

| # | Decision | Chosen | Source | Rejected (why) | Status |
|---|---|---|---|---|---|
| D1 | Approach | One principle (journal=truth) + one seam + right helper shape | convergent | Broad stub (breaks fidelity); "three patterns" (no journal history) | Decided |
| D2 | Mode 1 fix | Session-scoped **counting** + split active/settled; deprecate unscoped helper | codex+opus audit | Per-record scoping (impossible — shared sessionId, no key) | Decided |
| D3 | Mode 2 fix | Load reduction + Node-side **progress-based** stall-watchdog | opus + final-codex | Raise protocolTimeout (already 300s); CDP liveness ping (hangs on dead channel); fixed ~300s wall-clock (false-reds the legit 20-min authwit-lifecycle) | Decided |
| D15 | Soak workflow timing | Build `network-e2e-soak.yml` in Phase 2 (not 5) | final-codex | Introduce it in Phase 5 (Phase 3's gate would reference a not-yet-built workflow) | Decided |
| D16 | Gate-code protection | Required review on `.github/workflows/**` + `.github/actions/**` before the flip | final-codex | SHA-pin third-party actions only (misses first-party gate code edited in the same PR) | Decided |
| D4 | Modes 3/4 | Triage-from-artifacts then fix | opus+codex | Pre-committed gas bump (could mask serialization bug) | Decided |
| D5 | Class B repro | Reuse `docker-ci-like.sh` (file-arg already exists) | codex/opus | Build a harness (duplicates; the task was dead work) | Decided |
| D6 | Runner shape | 4 vCPU/16 GB | verified | "2-core" (brief error) | Corrected |
| D7 | Filter | **Broaden the allowlist** + explicitly close the audit-found gaps (shared deps + `patches/**` + missed extension paths); keep pass-when-skipped | **user** (over both audits' fail-closed rec) | Fail-closed inversion (auditors' rec; user chose allowlist for lower CI churn — residual: new top-level dirs need a filter update, mitigated by `.github/**` protected review) | **Decided (user)** |
| D8 | `SPONSORED_FPC_SALT` | Remove dead plumbing | codex, verified | Leave it (needless attack surface) | Decided |
| D9 | Make-required tolerance | Enforceable zero-retry soak + **retry:1 live** + admin-override hatch | codex+opus + **user** | retry:0 strict (blocks every PR on one blip); "100% green, no hatch" | **Decided (user: retry:1 live)** |
| D10 | Proverless safety | Pin guards first (Phase 0) | opus | Later (a green proverless suite could mask a guard weakening) | Decided |
| D11 | Phase order | safety → Class A → instrument → Class B → triage → soak → ship → require | both audits | instrument-first-of-all (gates the known Class A fix behind harness work) | Decided |
| D12 | Helper identity | Session-scoped counting now; correlation key only if a future test needs per-record | codex blocking | Build per-request key now (unneeded plumbing) | Decided |
| D13 | Action pinning | SHA-pin checkout + paths-filter + 3rd-party actions in the gate | both audits | Float tags in trusted pre-gate jobs | Decided |
| D14 | Phase 3 gate | **Real-runner soak required** (container necessary-not-sufficient) | both audits | "container 10× OR soak" (can rubber-stamp an unfixed freeze) | Decided |

**All decisions resolved.** D7 (broaden allowlist + close audit gaps) and D9 (retry:1 live) settled by the user at the gate; `/harden` deferred to pre-release. No open Asks remain.

## Audit verdicts
- Plan A/B/C drafts → consolidated.
- **Contradiction-check + double audit:** codex (resumed) = **reject** (3 blocking: impossible request-scoped helper; filter bypass via shared pkgs + patches; retry policy unenforced) — **all addressed** (D2/D12, D7+shared-deps, D9+enforceable rule). Fresh opus = **conditional approve** (6 conditions) — **all addressed** (D14 real-runner gate, D3 Node-side watchdog, D7 fail-closed default, D13 SHA-pin, D5 drop dead work + 6-caller scope, Phase 2 fresh-run).
- **Final fresh-context codex pass** (session `019ecd1d-0072-71c0-8ec1-d0cd11c895cc`): **`conditional approve`** — 3 conditions, **all folded in**: (1) build the soak workflow in Phase 2 not 5 → D15; (2) make the watchdog progress-based, not fixed ~300s → D3; (3) protected review on `.github/workflows/**` + `.github/actions/**` before the flip → D16. It explicitly CONFIRMED the contested fixes sound: session-counting suffices (fixtures are per-test fresh; the approval-boundary test creates no prior `dapp_execute` traffic), the fail-closed inversion closes the shared-dep/`patches/**` bypasses, and D7/D8/D13 are sound. Residual notes folded into Security (mutable gate-code) + Assumptions (before/after is supporting-not-proof; session-counting isn't a blanket future identity substitute).

---

## Seeds

### /goal (recommended — completion is transcript-observable via plan.md ✓ + real-runner soak)
```
/goal All phases 0-7 marked ✓ in implementations-plan/proverless-network-stabilization/plan.md, each ✓ backed by its phase's Validation gate reported passing in the transcript; the Phase 5 soak recorded full-matrix 5/5 with ZERO retries consumed in lessons/phase-5-soak.md, and Phase 3's real-runner soak named + evidenced the Class B root cause; for each phase the agent printed `LESSONS_FILE=implementations-plan/proverless-network-stabilization/lessons/phase-N.md`; `/code-review max --fix` complete with findings applied + committed; codex post-impl audit complete with high/critical findings addressed; `bun run audit:vue` reports exit 0. STOP before merging to dev (Phase 6) and before flipping the required check (Phase 7) — both are user-gated.
```

### /loop (fallback — fixed cadence)
```
/loop 20m Drive implementations-plan/proverless-network-stabilization forward. Never idle. Each firing: read plan.md + lessons/ (authoritative), git status/log; PR? gh pr view --json statusCheckRollup (no --watch); CI in flight → gh run watch up to 10 min. No task in hand? take the next pending phase step (edit → bun run lint + typecheck → the phase's flake-loop / docker-ci-like / real-runner-soak gate exactly as written in plan.md). NEVER run codex concurrently with a local e2e run. Phase gate green (as written in plan.md — Phase 3 needs the REAL-RUNNER soak, not container-only)? mark ✓, file lessons, print LESSONS_FILE=..., advance. Stuck or non-trivial fork? /codex xhigh, log consult+verdict. Same step failing 5×? stop+reassess. Hard limits: never merge to dev/main, never flip the required check, never publish — surface + stop there. All phases 0-5 ✓? /code-review max --fix → commit → codex post-impl audit → address high/critical → wrap-up with contentious decisions ELI5'd → STOP (Phase 6 PR + Phase 7 required-flip are user-gated).
```
