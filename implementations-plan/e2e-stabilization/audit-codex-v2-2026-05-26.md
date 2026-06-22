# Codex Tier-A Plan: Stabilize Network E2E

## 1. Executive Summary

I would **not** start with wallet-service changes, more timeout bumps, file renames, or runner tricks.

The shortest path to stable `5/5` shards is:

1. Close the **remaining popup readiness bug** in the discover window.
2. Restructure `register-token.test.ts` so it no longer owns **two cold interaction flows** in one spec.
3. Re-measure cold-shard locally.
4. Only if rotation remains, add a **one-time per-shard warm-up tap** in test code that exercises and rejects a capabilities request before the first real cap-driven test.

That path stays inside the user’s scope: `#58`, `#59`, and cold-shard only. It also avoids touching `src/wallet/services/**` unless the UI/test-side fixes fail.

## 2. Current State, Independently Re-Read

### 2.1 What is actually still broken

- The current network config still runs with `retry: 2`, `pool: "forks"`, and `isolate: true` at `packages/extension/vitest.e2e.network.config.ts:14-35`.
- CI still runs a 5-shard matrix at `.github/workflows/pr-network-e2e.yml:91-123`, and each shard is a fresh VM with its own anvil + Aztec + playground + Chrome stack. The reusable workflow sets `NULO_E2E_SKIP_DEFERRED_SLOW=1` at `.github/workflows/_network-e2e.yml:56-63`.
- The README already documents the cold-shard limitation and local shard reproduction at `packages/extension/tests/e2e/README.md:75-100`.

### 2.2 Issue #58 is narrower than the stale audit wording suggests

On current code:

- `capabilities/index.vue` is already hardened with `initComplete` at `packages/extension/src/popup/windows/capabilities/index.vue:59-66`, `:disabled="... || !initComplete"` at `:382-390`, and a defensive throw in `approve()` at `:171-178`.
- `verify/index.vue` is already gated on `!session` at `packages/extension/src/popup/windows/verify/index.vue:238-240`.
- The authwits keyboard-bypass bugs appear already fixed:
  - `ChangeAuthwitsRegistryPopup.vue:66-72`, `:110-115`, `:151-158`
  - `RevokeAuthwitsPopup.vue:87-92`, `:163-168`, `:269-276`

The **live** readiness race I still see is `discover/index.vue`:

- `useDappInteractionPayload.load()` sets `requestId` **before** payload/dapp metadata land at `packages/extension/src/composables/useDappInteractionPayload.ts:82-94`.
- `discover/index.vue` only awaits `profileService.getActiveProfile()` and `loadInteractionPayload()` inside `init()` at `packages/extension/src/popup/windows/discover/index.vue:63-67`.
- But the Allow button is enabled on `!requestId` rather than “identity is fully loaded” at `discover/index.vue:198-205`.
- `approve()` still silently returns if `!requestId.value` at `discover/index.vue:79-91`.

That is the same structural class as the old capabilities/execute bug, except here the risk is worse: the user can approve before the trust anchor is fully rendered.

### 2.3 Issue #59 is not a wallet bug first; it is a test-shape bug first

`register-token.test.ts` currently stacks:

1. A cold `requestCapabilities("basic")` flow with popup open + account hydration.
2. Then a cold `registerToken` execute flow with metadata prefetch.

That is visible directly in `packages/extension/tests/e2e/network/register-token.test.ts:36-118`.

This spec is also redundant in one important way: the correctness of the `basic` bundle grant is already covered by `cap-request-basic.test.ts` at `packages/extension/tests/e2e/network/cap-request-basic.test.ts:10-42`. The register-token spec should validate the `registerToken` path, not re-own capability-grant cold start.

### 2.4 Cold-shard is real and the repo already tells us where it lives

The test runner path is:

- `scripts/e2e/agent.sh` allocates ports, builds the wallet, then invokes Vitest at `packages/extension/scripts/e2e/agent.sh:18-64`.
- `global-setup.ts` starts fresh anvil, fresh Aztec, and fresh playground per shard at `packages/extension/tests/e2e/global-setup.ts:235-482`.
- `launchExtension()` creates a fresh browser and waits for SW liveness at `packages/extension/tests/e2e/fixtures/extension.ts:16-95`.
- `connectPlayground()` opens a fresh dapp page and drives discover -> verify at `extension.ts:189-235`.

The important constraint: **there is no shared browser warmth across files**. What is shared across the shard is the sandbox state started in `global-setup.ts`, not the test browser itself. That is why I do **not** believe `pool: "threads"` or similar worker tweaks are the right lever.

## 3. Root-Cause Map and Smallest Fix Per Problem

### 3.1 Issue #58: Discover identity-load race

**Mechanism**

- `requestId` becomes truthy before `payload`/`dapp` are fully loaded.
- The Allow button becomes clickable before the identity block is guaranteed ready.
- The handler can still no-op silently on early timing.

**Smallest fix**

- Add `initComplete` (or `identityReady`) to `packages/extension/src/popup/windows/discover/index.vue`.
- Set it only after `init()` completes successfully.
- Change Allow to `:disabled="processingError?.type === 'error' || !initComplete"`.
- Change `approve()` to throw loudly if invoked before `initComplete`.
- Keep Deny fast if desired: `:disabled="isLoading || !requestId"` is fine because early reject is not a trust bug.

**Why I would not touch wallet code here**

- The bug is entirely in the popup UI contract, not in `DappInteractionService`, `DappSessionService`, or the wallet SDK path.

### 3.2 Issue #59: register-token cold-flow overload

**Mechanism**

- One spec owns two expensive user journeys in sequence.
- The outer test budget becomes the effective bottleneck even when inner waits are valid.
- The first journey (“grant basic”) is already tested elsewhere.

**Smallest fix**

- Remove the capability-grant journey from the main register-token assertion path.
- Implement a **targeted pre-grant fixture/helper** for this file only:
  - start from `dappConnectedExtension`
  - request the `basic` bundle once
  - select the first account
  - wait for `requestCapabilities` success
  - return the connected page plus the chosen account address
- Then keep `register-token.test.ts` focused on:
  - execute popup opens
  - metadata renders
  - approve persists token / dapp result settles

I prefer a **file-local targeted fixture** over splitting into two order-dependent tests. Using test order as setup is brittle. Using a small fixture keeps the spec single-purpose and still avoids generic infra.

### 3.3 Cold-shard rotation

**Mechanism**

- Each shard gets a fresh sandbox from `global-setup.ts`.
- The first real capabilities-driven file in the shard pays sandbox-side warm-up cost:
  - popup creation
  - `loadInteractionPayload()`
  - capability/account resolution
- Quarantining one heavy first victim only rotates the burden to the next file.

**Smallest likely fix**

- Add a **one-time per-shard warm-up tap** in test code, not wallet code.
- The warm-up should:
  - run exactly once per shard
  - exercise the same capabilities popup path that later tests need
  - **reject** the request so it does not persist grants
  - mark a shard-local sentinel in `.e2e-state`

I would implement this in the e2e fixture layer, not in `agent.sh`, because the failing path begins after the browser and extension are already live.

## 4. Phase Ordering

### Phase 0: Freeze scope and baseline locally

Goal: stop solving stale problems.

- Confirm `#58` issue body matches current code. On current `dev`, authwits appears already fixed; discover is the live popup race.
- Keep `#59` quarantined while restructuring it.
- Baseline local shard repro:
  - `NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=1/5`
  - `NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=3/5`
  - `NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=5/5`

### Phase 1: Land #58 without touching wallet services

- Fix `packages/extension/src/popup/windows/discover/index.vue`.
- Add one focused regression check that asserts discover Allow is not clickable until identity init is complete.

Why first:

- It is the smallest production-facing bug.
- It is independent of cold-shard and register-token.
- It reduces ambiguity in later shard failures.

### Phase 2: Restructure #59 and unquarantine it locally

- Add a targeted pre-grant helper/fixture for register-token.
- Keep the test file responsible only for registerToken behavior.
- Remove the quarantine only after local cold-shard runs are green.

Why second:

- As long as register-token stacks two cold flows, it is a noisy benchmark for cold-shard work.
- Fixing #59 first tells us whether the remaining rotation is truly a general shard problem.

### Phase 3: Only then attack cold-shard

- Re-run historical offender shards locally from cold state.
- If the next first-capability victim still rotates, add the one-time per-shard warm-up tap.
- Re-measure locally before any CI push.

### Phase 4: CI proof

- Push only after local shard loops are green.
- Use CI as the last gate, not the diagnosis loop.

## 5. Local-First Verification Plan

## 5.1 Fast local loop

Cold runs:

```bash
NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=1/5
```

Focused file runs:

```bash
bun run e2e:agent tests/e2e/network/cap-request-basic.test.ts
bun run e2e:agent tests/e2e/network/register-token.test.ts
```

Hot rerun on the same sandbox (skip full cold boot) after one `e2e:agent` run:

```bash
cd packages/extension
PORTS=.e2e-state/ports.json
E2E_REQUIRE_SETUP=1 \
ANVIL_URL="$(jq -r .anvilUrl "$PORTS")" \
ANVIL_PORT="$(jq -r .anvil "$PORTS")" \
AZTEC_NODE_URL="$(jq -r .aztecUrl "$PORTS")" \
AZTEC_PORT="$(jq -r .aztec "$PORTS")" \
AZTEC_ADMIN_PORT="$(jq -r .aztecAdmin "$PORTS")" \
AZTEC_P2P_PORT="$(jq -r .aztecP2P "$PORTS")" \
PLAYGROUND_URL="$(jq -r .playgroundUrl "$PORTS")" \
PLAYGROUND_PORT="$(jq -r .playground "$PORTS")" \
FAUCET_DEV_PORT="$(jq -r .faucet "$PORTS")" \
bun run vitest run --config vitest.e2e.network.config.ts tests/e2e/network/register-token.test.ts
```

Use the hot loop for rapid refinement. Use cold `e2e:agent --shard=N/5` loops to prove shard stability.

## 5.2 Proof required before pushing

For `#58`:

- Focused discover regression check passes `10/10` locally.
- `cap-request-basic.test.ts` passes `3` cold runs in a row.

For `#59`:

- `register-token.test.ts` passes `5` local runs in a row unquarantined.
- At least `2` of those runs must be cold `e2e:agent` runs, not just hot reruns.

For cold-shard:

- `NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=1/5` passes `3` consecutive cold runs.
- Repeat once each for historically noisy shards `3/5` and `5/5`.

I would not push before those local gates pass.

## 6. Cold-Shard Mitigation Options, Ranked

### 1. One-time per-shard warm-up tap in the fixture layer

Best option if Phase 3 is needed.

- Exercise the real capabilities popup path once.
- Reject it so no grant persists.
- Store a shard-local sentinel in `.e2e-state`.

Why first:

- Fixes the exact path that flakes.
- Runs once per shard, not once per file.
- No wallet-service change.

### 2. Temporary-browser prewarm inside `global-setup.ts`

Effective but more invasive.

- After anvil/Aztec/playground boot, launch a temporary browser, register, connect, request/reject a capability, close.

Why second:

- Also hits the right path.
- But duplicates fixture logic or forces refactoring shared helpers out of Vitest-bound code.

### 3. HTTP/process prewarm in `agent.sh` or `global-setup.ts`

Low-confidence partial fix.

- Pre-hit playground HTTP routes.
- Maybe pre-probe Aztec endpoints.

Why third:

- It can warm Vite and node HTTP listeners.
- It cannot warm the extension popup path by itself.

### 4. Custom sequencing / file ordering / filename hacks

Do not make this the plan.

- It hides the problem by choosing a sacrificial first file.
- It is brittle against any future file-set change.

### 5. Self-hosted runner / persistent CI state

Operational workaround only.

- Useful for speed.
- Not a correctness fix.

## 7. Security & Adversarial Considerations

### 7.1 Discover race is a real trust bug

If a dapp can get the user to click Allow before hostname/name/logo are stable, the wallet is effectively asking for trust before showing the trust anchor. That is not just “test flake”; it is a denial-of-trust surface.

The fix must therefore gate **Allow** on complete identity readiness, not merely on `requestId`.

### 7.2 Warm-up logic must not silently grant capabilities

If we add a warm-up tap, it must reject the request. A warm-up that approves `basic` for the playground origin changes the state under test and can mask real permission bugs.

### 7.3 Pre-grant fixture for register-token must be tightly scoped

The fixture should grant only the bundle actually needed by registerToken, and only for the playground origin already under test. Otherwise we risk normalizing over-permissive session state.

### 7.4 Do not normalize silent no-op handlers

The old class of bug was “button clickable, handler silently returns.” The secure pattern is:

- explicit readiness boolean
- disabled UI tied to readiness
- handler throws if called before readiness

That should remain the convention for popup approval surfaces.

## 8. Acceptance Criteria

“Consecutive” should mean **consecutive full workflow executions on the same HEAD SHA**, not cherry-picked green shards and not different commits.

I would use:

### Local done

- `#58` focused regression check: `10/10` local
- `register-token.test.ts` unquarantined: `5/5` local
- shard `1/5`: `3/3` consecutive cold local runs green

### CI done

- Same HEAD SHA:
  - `3` consecutive full `Network e2e` workflow runs green = minimum confidence
  - `5` consecutive full runs green = close the known-limitation note or downgrade it sharply

Each run must be the full 5-shard workflow, not “rerun only failed jobs”.

## 9. Wallet-Code Touch List

Primary plan touches **no wallet services**.

Proposed code changes:

- `packages/extension/src/popup/windows/discover/index.vue`
  - add `initComplete`
  - gate Allow on readiness
  - throw on pre-init approve
- `packages/extension/tests/e2e/network/register-token.test.ts`
  - restructure around pre-granted capability state
- Possibly one new targeted helper/fixture in:
  - `packages/extension/tests/e2e/fixtures/extension.ts`, or
  - `packages/extension/tests/e2e/fixtures/popups.ts`
- If cold-shard mitigation is still needed:
  - `packages/extension/tests/e2e/fixtures/extension.ts`
  - optionally `packages/extension/tests/e2e/README.md`

Not in primary path:

- `packages/extension/src/wallet/services/**`
- `packages/extension/src/wallet/runtime.ts`
- upstream wallet-sdk patches

If someone proposes touching wallet services anyway, I would require a separate regression review.

## 10. Estimate

- Phase 0 baseline + issue rescope: **1–2 hours**
- Phase 1 discover fix + focused regression test: **2–4 hours**
- Phase 2 register-token restructure + unquarantine + local proof: **4–6 hours**
- Phase 3 cold-shard warm-up tap, only if still needed: **4–8 hours**
- Phase 4 CI proving + log review: **2–4 active hours** plus waiting

Total realistic engineering effort: **13–24 hours**. In calendar terms, that is **roughly 2–3 careful days**, mostly because the real gating factor is repeated cold local shard proof and CI confirmation, not typing the code.

## 11. Final Recommendation

Do **not** treat this as a wallet performance project first.

Treat it as:

1. one remaining popup trust/readiness bug,
2. one over-scoped slow test,
3. one shard-level cold-start tax that should be handled in the test layer.

That is a smaller, safer, and more mergeable plan than another round of service instrumentation or infrastructure churn.
