# Accelerator-server CI integration — Opus independent draft

**Verdict:** 3 PRs, 4 phases, ~8–10 hours engineering + 2–3 CI iterations to converge. **Lower** than a naive 1-PR estimate because the hard-fail invariant + per-shard port allocation + per-shard `BB_BINARY_PATH` cache pre-warm have to land coherently or the suite will either silently mask regressions (a fallback masking source — exactly what motivates this work) or 5× hammer Aztec's GitHub releases for `bb` on a cold runner.

I disagree with one piece of framing — see [§9 Argue-back](#9-argue-back-with-the-user-framing).

---

## 0. Open questions, ranked by load-bearing-ness

| # | Question | Status | Mitigation in this plan |
|---|---|---|---|
| Q1 | Does the headless server bind a configurable port? | **NO** — `accelerator/README.md` line 116: "The server itself currently does **not** honor this env var — it always binds `127.0.0.1:59833`. If you need to change the port on both sides, that requires a code change to `server.rs`." | Per-shard accelerator instances on default 59833 collide → run **one accelerator per runner** (not per shard); each runner host is its own GitHub Actions VM so cross-runner collision is impossible. Detailed in §7. |
| Q2 | Does the server bundle `bb` or download on first prove? | **Downloads on first prove**, cached in `~/.aztec-accelerator/versions/<aztec-version>/`. `BB_BINARY_PATH` env overrides. | Pre-stage `bb` from Aztec CLI cache (which `setup-aztec` already warms) → set `BB_BINARY_PATH` to the cached binary → zero network for the first prove. Detailed in §4 Phase 2. |
| Q3 | Origin auth model in headless? | `ALLOWED_ORIGINS` env var = comma-separated allow-list for **browser-driven** callers (i.e. requests with an `Origin` header). README explicitly warns: "Non-browser callers (curl, another process on the same host) can omit the header and bypass the check." | The wallet runs in an MV3 offscreen page; `fetch` from offscreen sends an `Origin` header of `chrome-extension://<id>`. Need to pre-populate `ALLOWED_ORIGINS` with the dev extension ID (deterministic when `key` is set in manifest). Detailed in §4 Phase 1. |
| Q4 | Startup time / readiness signal? | Undocumented but the binary is **1.7 MB tarball, single static binary**. The accelerator's own release pipeline (per its README) post-build smokes via `/health` poll. | Same pattern: spawn → poll `/health` with 500ms interval, 30s budget, fail loud. Detailed in §4 Phase 1. |
| Q5 | Log format? | `RUST_LOG=info` (tracing-subscriber default — colon-separated text, not JSON). | Capture to `/tmp/accelerator-server.log` per existing anvil/aztec log convention; surface in `network-e2e-logs-*` artifact bundle. Detailed in §4 Phase 1. |
| Q6 | Shutdown signal handling? | Undocumented. Assume `SIGTERM` clean, `SIGKILL` after grace. | Reuse existing `killProcessGroup` helper in `global-setup.ts`. |
| Q7 | What does the wallet's `Origin` header actually look like from an MV3 offscreen `fetch`? | Unverified. Chrome MV3 typically sends `Origin: chrome-extension://<id>` for cross-origin fetches; could also be `null` for opaque-origin requests. | **Open** — verify in Phase 1 by running the agent with `ALLOWED_ORIGINS` unset (which allows all browser origins per README), capturing the actual `Origin` header from accelerator logs, then locking it down. |
| Q8 | Multi-shard runners — do all 5 shards land on the **same** GitHub Actions runner or get **fresh** runners? | **Fresh runners.** GitHub Actions matrix → each matrix entry is a new `ubuntu-latest` VM. So port collision across shards is a non-issue **once** we accept that each shard installs + starts its own accelerator-server. | Single-port default 59833 is fine per-runner. The cost is 5× the install+startup overhead (~10s each). Acceptable. |
| Q9 | What's the actual wall-time win vs WASM? | Unmeasured in our suite. Accelerator README claims native `bb` is the whole point; SDK author put 1.0.1 out specifically for CI proving. **Moderate confidence** the win is meaningful (>30% on prove-heavy tests like `fee-methods`), but Phase 4 measurement is the truth-teller. | §10 Measurement plan instruments before/after. |
| Q10 | AGPL-3.0 implications? | The release notes don't state a license. Need to check the `accelerator-server` source license — the README links to `packages/accelerator/src-tauri` which is in the same repo as the SDK. The SDK is MIT. The server may be different. | §6 Security — flag for legal review. If AGPL, we're **distributing the binary in CI** which doesn't trigger AGPL (no network deployment to users); CI invocation is internal use. Low-confidence: get a real answer before shipping to main. |

---

## 1. Plan-summary

**Goal:** Replace in-browser WASM proving with a native `bb`-backed accelerator-server for `network-e2e` CI runs, with a hard-fail contract: any silent WASM fallback during a test execution fails the workflow.

**Out of scope (locked):** SDK bump, quarantine changes, local dev integration, self-hosted runners, spike-first.

**Phases / PRs:**

| Phase | PR | Scope | Wall-time |
|---|---|---|---|
| 1 | PR 1 | Wire `accelerator-server` install + spawn + `/health` probe + `ALLOWED_ORIGINS` lockdown into `setup-aztec` + `global-setup.ts`. Land with accelerator **opt-in** via env flag (so we can ship without breaking the suite). | ~3h |
| 2 | PR 1 | Pre-warm `BB_BINARY_PATH` from Aztec CLI's cached binary (no first-prove download tax). | ~1h (folded into PR 1) |
| 3 | PR 2 | Hard-fail instrumentation: wire `setOnPhase` to count `"fallback"` invocations during a test; per-test assertion in the CRX fixture. Flip accelerator from opt-in → default-on. | ~3h |
| 4 | PR 3 | Measurement + rollback ergonomics: instrument `x-prove-duration-ms` capture; document `NULO_E2E_DISABLE_ACCELERATOR=1` kill-switch; comparison report. | ~2h |

Sequential PR landings (not parallel) — each phase depends on the prior being green on `dev`'s network-e2e matrix.

---

## 2. Phase-by-phase plan

### Phase 1 — Install + spawn + probe (PR 1, part a)

**Goal:** `accelerator-server` runs alongside anvil/aztec; `/health` returns 200; wallet doesn't yet route through it (opt-in flag off).

**Files touched:**

- `.github/actions/setup-aztec/action.yml` — extend to also install `accelerator-server` from GitHub Releases (sha256-verified), cache the tarball + extracted binary keyed on `${ACCELERATOR_VERSION}-${runner.os}`. New input: `accelerator_version` (default the version we lock — initially `1.0.1`).
- `packages/extension/scripts/e2e/agent.sh` — read new env `NULO_E2E_ACCELERATOR=1` (Phase 1: opt-in). When set: spawn `accelerator-server` with `ALLOWED_ORIGINS` (Phase 1: leave unset to allow all, capture observed `Origin` in logs to lock down in Phase 3 follow-up); poll `/health` with 30s budget; abort if probe fails; write the spawned PID to lockfile.
- `packages/extension/tests/e2e/lockfile.ts` — add `accelerator?: number` PID slot + ports `acceleratorPort?: number` (always 59833 in v1 but typed so we can flip later if Q1 changes).
- `packages/extension/tests/e2e/global-setup.ts` — symmetric reaper for orphan `accelerator-server` PIDs; `killOrphan` call in the same block as anvil/aztec; healthcheck against `/health` in the reuse path (line 188 area).
- **NEW** `packages/extension/scripts/e2e/probes/accelerator-health.sh` — extracted from agent.sh for unit-testability + reuse from `global-setup.ts`. Curls `127.0.0.1:59833/health`, exits 0 with the JSON body if healthy and `bb_available=true`.
- `.github/workflows/_network-e2e.yml` — add `NULO_E2E_ACCELERATOR: "1"` env at the workflow level (Phase 1 lands as opt-in but **on** in CI). Also expose a log upload entry for `/tmp/accelerator-server.log` in the `actions/upload-artifact@v7` `path:` block (line 153).

**Acceptance:**

- A green network-e2e run on a feature branch with `NULO_E2E_ACCELERATOR=1` exported. Suite still runs against WASM (wallet wiring not yet flipped) — accelerator's role here is purely shadow-running.
- `/tmp/accelerator-server.log` is uploaded as artifact on failure; contains the observed `Origin` header from any shadow probe (use a `curl /health` smoke at end of agent.sh that hits `/prove` with an `Origin: chrome-extension://<id>` to capture).

**Why opt-in for Phase 1?** Decouples "the binary works in our CI" from "the wallet routes through it." If install/spawn is the bug, we know in PR 1 and don't have a fix-then-fix-the-flag round trip.

### Phase 2 — `BB_BINARY_PATH` pre-warm (PR 1, part b)

**Goal:** First `/prove` call doesn't trigger a `bb` download from Aztec's GitHub releases (which would add network IO to the first proving test + reduce hard-fail signal clarity).

**Files touched:**

- `.github/actions/setup-aztec/action.yml` — after installing Aztec CLI, locate the cached `bb` binary. Aztec CLI installs to `~/.aztec/versions/<version>/`; per upstream layout the `bb` binary lives at `~/.aztec/versions/<version>/bin/bb` (verify in Phase 2 PR 1 by `find ~/.aztec/current -name bb -type f`). Expose `BB_BINARY_PATH` via `>> "$GITHUB_ENV"`.
- `packages/extension/scripts/e2e/agent.sh` — propagate `BB_BINARY_PATH` into the accelerator-server spawn env.
- **Verify in PR 1:** `curl /health` returns `"bb_available": true` (per accelerator README §"Verifying it's running").

**Acceptance:**

- `/health` reports `bb_available: true` immediately after spawn — no first-prove download wait.
- Accelerator log shows the resolved binary path matches the Aztec CLI cache.

### Phase 3 — Wire wallet to accelerator + hard-fail (PR 2)

**Goal:** Wallet routes through accelerator; any silent fallback during a test fails the test loudly.

**Files touched:**

- `packages/aztec-runtime/src/pxe/chain-runtime.ts` (lines 90–92) — extend `AcceleratorProver` construction to accept an `onPhase` callback that increments a per-PXE-instance counter on `"fallback"` / `"denied"` / `"downloading"`. Wire counter into a getter so tests can read it. Construct under an env-gated branch:
  ```ts
  const prover = new AcceleratorProver({ simulator, onPhase })
  ```
  The constructor already reads `AZTEC_ACCELERATOR_PORT` from `process.env`, so no port plumbing needed (Q1: stays default 59833). **However** — `process.env` is undefined in MV3 offscreen. The wallet build needs to bake the port via `import.meta.env` if we ever need to override, BUT for v1 the default suffices.
- **NEW** `packages/aztec-runtime/src/pxe/prover-telemetry.ts` — small module exporting a module-level `Map<chainId, FallbackCounter>` + `getFallbackCount(chainId): number`. Pure ESM, no side effects beyond the map. Counter increments on `"fallback"` and `"denied"` phases.
- `packages/extension/src/offscreen/<existing entry>` — surface `getFallbackCount` via the existing offscreen<->test messaging surface. **OPEN:** the test fixture already speaks to the offscreen via the wallet-bridge; need a new RPC method `__internal_acceleratorFallbackCount` exposed only under a Vite-time gate (`VITE_E2E_PROBE === "1"`-style) so it never ships to production. Mirror the probe-stripping convention already enforced in `_network-e2e.yml` lines 127–140.
- `packages/extension/tests/e2e/fixtures/extension.ts` — add a `assertNoAcceleratorFallback(page)` helper. Per-test `afterEach` hook in `vitest.e2e.network.config.ts` setupFiles invokes this; throws if count > 0 with the per-phase log included.
- `packages/extension/vitest.e2e.network.config.ts` — register the new afterEach hook.
- `.github/workflows/_network-e2e.yml` — `NULO_E2E_ACCELERATOR=1` is now the default behavior (env entry stays); also add a post-test step that greps the accelerator log for `"fallback"` text as a backstop in case the in-extension counter misses something (defense in depth).

**Acceptance:**

- Per-test `afterEach` fails loud when any prove path went WASM.
- Stop the accelerator mid-suite (locally) → every subsequent test that proves fails with `accelerator fallback observed in test X`.
- Network-e2e matrix green on `dev` branch with accelerator default-on.

### Phase 4 — Measurement + rollback (PR 3)

**Goal:** Numbers to justify keeping accelerator on; one-flag escape hatch.

**Files touched:**

- `packages/aztec-runtime/src/pxe/prover-telemetry.ts` (extend) — also capture `proveDurationMs` from the `"proved"` phase data into a per-test ring buffer.
- `packages/extension/tests/e2e/fixtures/<new>` — `dumpProverTimings()` writes per-test prove durations to `/tmp/nulo-prover-timings-<pid>.jsonl` for the artifact upload.
- `.github/workflows/_network-e2e.yml` — add `/tmp/nulo-prover-timings-*.jsonl` to artifact upload paths.
- `.github/workflows/_network-e2e.yml` — add a post-suite step that emits a sorted summary to `$GITHUB_STEP_SUMMARY` (top-10 slowest proves; total accelerator-vs-baseline delta if both runs exist).
- `CLAUDE.md` — document `NULO_E2E_DISABLE_ACCELERATOR=1` rollback path: agent.sh should check it BEFORE the `NULO_E2E_ACCELERATOR=1` enablement, allowing operators to disable accelerator-server in CI by setting one repo-level env var without a code change.
- `.github/workflows/_network-e2e.yml` — surface `NULO_E2E_DISABLE_ACCELERATOR` from a workflow input (default empty); document in the action description.

**Acceptance:**

- Setting `NULO_E2E_DISABLE_ACCELERATOR=1` via workflow_dispatch input → suite runs WASM-only, no hard-fail.
- Step summary shows per-test proving times.

---

## 3. File catalog

| File | Phase | Lines added/changed | Purpose |
|---|---|---|---|
| `.github/actions/setup-aztec/action.yml` | 1+2 | +~40 | Install accelerator-server tarball, sha256-verify, cache, expose `BB_BINARY_PATH` |
| `.github/workflows/_network-e2e.yml` | 1+3+4 | +~25 | Set `NULO_E2E_ACCELERATOR=1` default-on; surface `NULO_E2E_DISABLE_ACCELERATOR` input; expand artifact paths to include `/tmp/accelerator-server.log` and timing JSONL; add log-grep backstop step; step summary |
| `packages/extension/scripts/e2e/agent.sh` | 1+2+4 | +~50 | Spawn/teardown accelerator-server; propagate `BB_BINARY_PATH` and `ALLOWED_ORIGINS`; honor `NULO_E2E_DISABLE_ACCELERATOR` |
| `packages/extension/scripts/e2e/probes/accelerator-health.sh` | 1 | NEW ~30 | Standalone health probe used by agent.sh + global-setup.ts |
| `packages/extension/tests/e2e/global-setup.ts` | 1 | +~30 | Orphan reaper for accelerator-server PIDs; health re-check on reuse path |
| `packages/extension/tests/e2e/lockfile.ts` | 1 | +~5 | Add `accelerator` PID + `acceleratorPort` to `OwnedState` |
| `packages/aztec-runtime/src/pxe/chain-runtime.ts` | 3 | +~10 | Wire `onPhase` callback into `AcceleratorProver` constructor; pass to telemetry module |
| `packages/aztec-runtime/src/pxe/prover-telemetry.ts` | 3+4 | NEW ~60 | Per-instance fallback counter + prove-duration ring buffer |
| `packages/aztec-runtime/src/pxe/prover-telemetry.test.ts` | 3 | NEW ~80 | Unit tests for telemetry (≥10 cases) |
| `packages/extension/src/offscreen/<entry surface>` | 3 | +~15 | Expose `getFallbackCount` via E2E-only RPC (Vite-time gated) |
| `packages/extension/tests/e2e/fixtures/extension.ts` | 3 | +~20 | `assertNoAcceleratorFallback(page)` helper |
| `packages/extension/vitest.e2e.network.config.ts` | 3+4 | +~10 | Global afterEach hook for hard-fail assertion |
| `packages/extension/manifest/manifest.config.ts` (line 20) | — | none | Already permits `http://127.0.0.1/*` — no change. |
| `CLAUDE.md` | 4 | +~10 lines | Document `NULO_E2E_DISABLE_ACCELERATOR=1` kill-switch |

---

## 4. Test plan (smallest set that proves it)

### Unit tests

- `prover-telemetry.test.ts` (≥10 cases) — covers:
  1. Counter starts at 0
  2. Increments on `"fallback"` phase
  3. Increments on `"denied"` phase
  4. Does NOT increment on `"proving"` / `"proved"` / `"serialize"` / `"transmit"` / `"receive"` / `"detect"` / `"downloading"`
  5. Reset per chainId is independent
  6. Concurrent increments from two PXE instances don't race
  7. Ring buffer caps at N entries (drops oldest)
  8. `proveDurationMs` capture preserves order
  9. Returns 0 / empty for unknown chainId
  10. `dispose(chainId)` clears entries

### Integration tests

- **Reuse the existing network-e2e suite as the primary integration.** The fallback hard-fail assertion runs as `afterEach` on every test → 50+ tests become 50+ accelerator-route assertions. No new test files needed for this.
- **One new positive control:** `packages/extension/tests/e2e/network/_accelerator-routing.test.ts` (5 cases):
  1. Single send: prove call observed at accelerator log (positive)
  2. Fallback counter is 0 after a successful prove
  3. With `NULO_E2E_DISABLE_ACCELERATOR=1` env, accelerator log shows no `/prove` calls AND fallback assertion is skipped
  4. With bad `ALLOWED_ORIGINS` (set to a bogus origin), test fails with `accelerator fallback observed`
  5. `/health` returns `bb_available: true` (sanity ping)

### Shell tests

- `accelerator-health.sh` is short enough that no unit shellcheck. Existing `actionlint` + `shellcheck` lints cover it.

### What we explicitly do NOT add

- No tests for `setup-aztec` action changes — green CI on the feature branch is the test.
- No tests for the Vite-time RPC gating — the `_network-e2e.yml` bundle-grep guard at line 127–140 already catches probe leakage. We extend the pattern to catch the new gating string.

---

## 5. Security & Adversarial Considerations

### Supply chain — binary provenance

| Concern | Mitigation |
|---|---|
| Binary not signed (only SHA-256 sidecar per release notes) | Pin `ACCELERATOR_VERSION="1.0.1"` exactly in `setup-aztec/action.yml`; pin the expected SHA-256 in the action AND verify via `shasum -a 256 -c`. Bump is a deliberate PR like any dep bump. |
| GitHub Releases compromise | The 7-day npm `minimumReleaseAge` policy in this repo doesn't apply to GitHub-Releases-distributed binaries. **Mitigation:** wait at least 7 days from the accelerator release before pinning to a new version in CI. Document in `SECURITY.md` (small addendum). |
| Upstream owner takeover (single-maintainer repo) | This is the unavoidable trust model. The accelerator-server is functionally a `bb` driver; compromise = ability to return bogus proofs to our CI suite (which then **fail** because the proofs don't verify). The damage surface is limited to CI flake, not real funds. **Acceptable risk for CI-only.** |
| AGPL license of the binary? | Need verification. Even if AGPL, "running in CI" is internal use, not a network deployment to users — no source-disclosure obligation triggered. Document the analysis in `SECURITY.md`. |

### Least privilege

| Surface | Constraint |
|---|---|
| Network binding | Default `127.0.0.1`; the server doesn't bind 0.0.0.0. Verify in Phase 1 with `ss -tlnp` capture. |
| GitHub Actions runner egress | Accelerator downloads `bb` from `github.com/AztecProtocol/aztec-packages/releases` on first prove. With `BB_BINARY_PATH` pre-warmed (Phase 2), the network call is **avoided entirely**, reducing the egress surface to "the install step's curl to alejoamiras/aztec-accelerator". Runner egress is unrestricted on GitHub-hosted Linux runners — this isn't tightened by us, just noted. |
| File system | Accelerator writes to `~/.aztec-accelerator/` and the cache. CI runner's $HOME is ephemeral. No data persists. |
| GITHUB_TOKEN scope in setup-aztec | No scope expansion required — the curl to GitHub Releases is anonymous (releases are public). |

### Origin auth

The README's caveat — "Non-browser callers (curl, another process on the same host) can omit the `Origin` header and bypass the check" — is **not a vulnerability in our CI threat model.** GitHub-hosted runners are single-tenant. Any process on the runner is either ours or part of the runner's standard image (none of which proves Aztec txs). The check exists to defend against a malicious tab on a developer's laptop, not against a CI runner's own processes.

**Phase 1 must capture the actual `Origin` header** emitted by the offscreen wallet so we can lock down `ALLOWED_ORIGINS` in Phase 3 — defense in depth. If we ship with `ALLOWED_ORIGINS` unset, a malicious test (e.g. a PR from a fork running in our CI) could route a proof through our accelerator, but the CI runner is destroyed after the run, so the worst case is "they consumed our `bb` proving cycles." Low impact.

### Input validation

The accelerator-server receives msgpack-serialized execution steps from the wallet. The server-side parser is theirs, not ours. **We are trusting the accelerator-server's msgpack parser to be sound** (panic-safe Rust → process death → CI fail-loud, which is actually OK). Not actionable on our side.

### Silent fallback as a masking source

This is the **central threat we're paying $work to fix.** The SDK's `AcceleratorProver` already silently falls back to WASM in three cases:

1. `/health` probe fails (`available: false`) → `onPhase("fallback")` fires, no exception (lines 332–343 of `accelerator-prover.ts`).
2. `/prove` returns 403 (origin denied) → `onPhase("denied")` + `onPhase("fallback")` fires, no exception (lines 374–393).
3. `setForceLocal(true)` → bypasses entirely, no telemetry.

The Phase 3 hard-fail mechanism (`afterEach` checks `fallbackCount === 0`) **must** observe all three. Implementation note: we do NOT call `setForceLocal(true)` anywhere; if someone adds it, the fallback counter won't fire because the entire accelerator path is bypassed. Add a defensive linter via biome `noRestrictedSyntax` (or a grep in CI lint step) forbidding `setForceLocal` in `packages/aztec-runtime/src/` and `packages/extension/src/`.

---

## 6. Hard-fail enforcement — design + trade-offs

**Decision tree:**

```
Option A: Pre-test probe in agent.sh (curl /health before vitest starts)
  → catches "accelerator never came up" cleanly
  → MISSES "accelerator came up then died mid-suite"
  → MISSES per-test fallbacks

Option B: Post-test log scrape (grep accelerator log for "/prove" requests)
  → catches "no /prove calls observed at all" (very weak signal)
  → MISSES per-test mapping (which test had the silent fallback?)
  → MISSES denial events (a 403 is logged but not visible per-test)
  → cheap, no code change

Option C: Per-test prover-RPC-count assertion via onPhase counter
  → catches all 3 silent-fallback paths from the SDK
  → maps fallback to the specific test that triggered it (clean signal)
  → REQUIRES new offscreen RPC + new helper + new afterEach
  → requires Vite-time probe gating to keep RPC out of prod bundle

Option D: A + B + C combined (defense in depth)
```

**My recommendation: Option D, layered:**

1. **A (pre-test probe)** in agent.sh — fail-fast on "accelerator dead before suite even started." Implementation: `curl http://127.0.0.1:59833/health | jq -e '.status == "ok" and .bb_available == true'`. Cheap, runs once.
2. **C (per-test counter assertion)** in `afterEach` — the primary mechanism. Catches the three silent-fallback paths and pinpoints which test triggered them.
3. **B (log scrape)** as a backstop step in `_network-e2e.yml` post-test — runs even if vitest crashed before afterEach got a chance. Greps `/tmp/accelerator-server.log` for any line containing "fallback" or `403`. Step fails if matches found.

The three layers don't catch the same things:
- A fails when accelerator was never up.
- C fails when fallback was observed during a specific test.
- B catches the case where C couldn't run (vitest hard crash, infra failure mid-suite).

**Trade-off accepted:** C requires an offscreen RPC, which is per-extension-build coupling. We already have the bundle-grep guard for `VITE_E2E_PROBE` strings — we extend that to `__internal_acceleratorFallbackCount` so the RPC literally cannot ship to a production bundle.

---

## 7. Parallel-safe port allocation

**Verified from `_network-e2e.yml` line 91–122 + GitHub Actions matrix semantics:** each shard (`matrix.shard.id`) maps to a separate `ubuntu-latest` runner instance. Five concurrent shards = five separate VMs.

**Therefore:** port collision across shards is **not a real issue**. Each runner's `127.0.0.1` is isolated. Default port 59833 is fine.

**What WAS a concern, now mitigated:** the dedicated heavy job (`network-e2e-heavy`, line 134) is a sixth runner. Same isolation.

**Forward-compat note:** if we ever switch to a self-hosted-runner-pool model where multiple shards land on one box, we'd need to:
1. Patch the accelerator-server to honor a port env var (PR to alejoamiras/aztec-accelerator), OR
2. Run one shared accelerator on the box and reuse across shards.

This is **not in scope** per the locked constraints. Add a comment in `agent.sh` calling out the assumption so a future maintainer doesn't accidentally break it.

**One pitfall:** local dev (`bun run e2e:agent`) on a machine where the developer is **also** running the desktop accelerator → port collision. Detect this in agent.sh:
```sh
if curl -sf http://127.0.0.1:59833/health > /dev/null 2>&1; then
  echo "[e2e:agent] port 59833 already in use — assuming external accelerator"
  # OPTION 1: refuse to spawn (skip the CI-only accelerator wiring entirely)
  # OPTION 2: error out (force user to stop their desktop app)
  # Default: skip + log, because local dev is opt-out (Phase 4 kill-switch).
fi
```

Since accelerator-server in CI is gated on `NULO_E2E_ACCELERATOR=1`, the local dev case is naturally excluded — the flag is set only in the CI workflow file. **Local dev keeps using their existing macOS desktop app or WASM** (per the locked constraints).

---

## 8. Rollback path

**Single env var:** `NULO_E2E_DISABLE_ACCELERATOR=1`.

- Set as repo-level secret or workflow input → agent.sh skips accelerator spawn entirely.
- afterEach hard-fail check no-ops when accelerator wasn't routed (i.e. when wallet's `AcceleratorProver` constructor was passed `setForceLocal(true)` OR when the env var is set and we don't spawn at all).
- **Workflow input** added to `_network-e2e.yml` so re-running a failed PR with accelerator disabled is a one-click `workflow_dispatch`.
- **Code revert is also a single-file change** — restore `chain-runtime.ts:91` to its current form. Phase 3 PR is intentionally small to keep this revert clean.

Document in CLAUDE.md the §"Quality gates" or §"In CI" section: a short paragraph noting the kill switch + the conditions under which to use it.

---

## 9. Measurement plan

**Before (baseline) — measure WASM proving on current `dev`:**
- Run `_network-e2e.yml` workflow_dispatch with `NULO_E2E_DISABLE_ACCELERATOR=1` (after PR 3 lands, the kill switch path).
- Capture the per-test prove durations from the new timings JSONL artifact.
- Total wall-time per shard.

**After (accelerator on):**
- Same workflow, default-on.
- Same captures.

**Instrumentation:**
1. `x-prove-duration-ms` from the accelerator response → captured by `prover-telemetry.ts` (already in scope).
2. Per-shard total wall-time → from GitHub Actions job duration metadata.
3. `fee-methods.test.ts` (the heavy file) — single-test wall-time delta.

**Acceptance for keeping accelerator default-on:**
- Total network-e2e wall-time decrease ≥20% (sum across all 6 jobs).
- `fee-methods.test.ts` wall-time decrease ≥30% (it's the prove-heaviest file).
- No silent fallbacks (`fallbackCount === 0` across all tests).

**If acceptance fails:** revert via the kill switch + investigate. Don't keep complexity for no measurable win.

**Step summary report in `_network-e2e.yml`:** a small shell step parses the JSONL timing artifact and emits a markdown table to `$GITHUB_STEP_SUMMARY`. Format: `| Test file | Avg prove ms | Max prove ms |`. Top 10 slowest. Gives reviewers a one-click view of where proving time goes.

---

## 9. Argue-back with the user framing

The framing says "**Hard fail.** If accelerator-server is down / unhealthy / wallet falls back to WASM during a test → CI must fail loud."

**I agree on the hard-fail principle** but want to flag one nuance:

The SDK's `"downloading"` phase is NOT a fallback — it's the accelerator going to fetch `bb` from Aztec's GitHub releases on first prove. With Phase 2 pre-warm, this should never happen, but if it does happen (e.g. CI runner already had a different `bb` cached and the version mismatches), the suite should NOT fail. It should warn loudly and continue, because the proof still succeeds — just with a 10s download tax.

**Therefore:** the `afterEach` hard-fail should observe `"fallback"` and `"denied"` only. `"downloading"` is a log-warn, not a fail. Document this explicitly in the helper's TSDoc. The Phase 2 pre-warm + `BB_BINARY_PATH` make `"downloading"` a should-never-happen, but we don't want the suite to red-line on a pre-warm misfire.

If the user disagrees and wants `"downloading"` to also hard-fail, swap one line in `prover-telemetry.ts`. Trivial revert. **Default: warn-not-fail on `"downloading"`.**

---

## 10. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| **A1.** Patch `accelerator-prover.ts` (SDK) to throw on fallback instead of silently falling back | Locked: no SDK changes. Also: the SDK's silent-fallback semantics are correct for production wallets (a user shouldn't see "your TX failed because you don't have an accelerator installed"). Our use case is CI-only — we don't want to bend the SDK to it. |
| **A2.** Use AppImage or .deb instead of the tarball | The headless tarball is 1.7 MB single binary; AppImage is 92 MB and pulls in GUI deps we don't need. The .deb is 21 MB and would require `sudo apt install` + dpkg. Tarball wins on size, speed, and zero-deps. |
| **A3.** Spawn one accelerator per matrix shard via a docker container per shard | GitHub Actions matrix entries already get separate VMs. Docker adds 10s-per-shard pull overhead for zero isolation benefit. |
| **A4.** Run accelerator-server as a GitHub Actions service container (`services:` block) | Service containers must come from a Docker registry. Tarball is faster to install and we don't need the service-container plumbing (auto-network, port-mapping). |
| **A5.** Hold accelerator-server's port via `resolve-ports.ts` and pass to the wallet via `import.meta.env.VITE_ACCELERATOR_PORT` | Q1: server doesn't honor a port env var. Even if it did, the wallet bake doesn't need it — default works because each runner is isolated. Premature flexibility. |
| **A6.** Skip Phase 2 (BB_BINARY_PATH pre-warm) and let the accelerator download bb on first prove | Adds 10–30s to the first proving test per shard + bakes in a GitHub releases dependency for every CI run. The cache already has `bb` from `setup-aztec`. Free win. |
| **A7.** Pre-test probe only (Option A, no per-test counter) | Doesn't catch the 403-denial-mid-suite case. Cheap but blind. |
| **A8.** Per-test counter only (Option C, no log scrape backstop) | Vitest hard-crash (segfault in offscreen) bypasses `afterEach` entirely. Log scrape catches it. |
| **A9.** Make Phase 1 a pure "shadow" run with no hard-fail at all, then a separate PR to flip on hard-fail | Adds a PR + a window where the suite runs with accelerator but silently masks fallbacks. The intermediate state is worse than just shipping the wired-up version (Phase 3) directly. Phase 1 ships opt-in but **off** in CI; Phase 3 flips it on AND adds hard-fail in the same PR. |
| **A10.** Bump SDK to `@alejoamiras/aztec-accelerator@4.2.1+` for any reason | Locked. |

---

## 11. Risk register (concise)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Accelerator-server crashes mid-suite (panic in Rust) | Low | Suite fails with `fallback observed` — clear signal | Log scrape backstop step uploads accelerator log artifact |
| R2 | `BB_BINARY_PATH` mismatch with the version accelerator expects (e.g. Aztec CLI bumps independently) | Low | First prove triggers download (10–30s), `"downloading"` phase fires (warn-not-fail per §9) | Phase 4 measurement will show the warn; bump aztec-runtime's `@aztec/*` versions and the accelerator version together in coordinated PRs |
| R3 | Offscreen `Origin` header is `null` or differs from `chrome-extension://<id>` | Medium | If `ALLOWED_ORIGINS` is locked down before this is known, every prove 403s and silently falls back → hard-fail catches it on first PR run | Phase 1 ships with `ALLOWED_ORIGINS` unset (allow-all browser origins per README); Phase 3 locks down only after Phase 1's log capture confirms the actual header value |
| R4 | Per-test counter race condition (concurrent PXEs increment same chainId counter) | Low | Test fails false-positively on a benign concurrent fallback from a parallel test | Vitest is single-test-at-a-time per file; cross-file is fine because tests don't share PXE state. Test case 6 in §4 pins this. |
| R5 | Accelerator install fails on a specific runner (network blip) | Medium | One shard fails on install step → easy retry | `actions/cache@v5` caches the tarball + sha256 across runs; first failure is a single-shard retry |
| R6 | Step-summary parser breaks on a malformed timing JSONL line | Low | Step summary missing, run still passes | Wrap the parser in `|| true`; advisory only |

---

## 12. Sequencing summary

```
PR 1  →  Land install + spawn + probe + BB_BINARY_PATH pre-warm
        (NULO_E2E_ACCELERATOR=1 enabled in workflow, but wallet still WASM)
        Acceptance: green shadow run + accelerator log uploaded as artifact

PR 2  →  Wire wallet through accelerator + hard-fail counter
        + per-test afterEach + log scrape backstop step
        Acceptance: green network-e2e on dev w/ accelerator default-on
                    fallbackCount === 0 across all tests

PR 3  →  Measurement (timings JSONL + step summary) + kill switch docs
        Acceptance: step summary populated; toggling kill switch works
```

3 PRs, sequential. Total: ~6 working hours + 2–3 CI iterations.

---

## 13. Concrete success criteria (revisited)

- `bun run e2e:agent` on a workstation (with `NULO_E2E_ACCELERATOR=1`) routes proving through `accelerator-server` and the per-test assertion observes no fallback.
- `_network-e2e.yml` runs default-on; PRs that introduce silent fallback fail with clear test-level signal.
- A single `workflow_dispatch` flag (`NULO_E2E_DISABLE_ACCELERATOR=1`) disables accelerator for a re-run without code change.
- Total network-e2e wall-time decreases ≥20% in the measurement PR's step summary.
- Accelerator's binary version, sha256, and source URL are pinned in `setup-aztec/action.yml`.
