# E2E Stabilization Plan (2026-05-26) — Issues #58 + #59 + cold-shard

Consolidated Tier-A plan. Draws from:

- `audit-codex-v2-2026-05-26.md` — codex's independent plan (session `019e5b9c`)
- `audit-opus-v2-2026-05-26.md` — opus subagent's independent plan
- Prior plan (pre-open-source import, not landed): `plan-final.md`, `plan-consolidated.md`, `audit-codex.md` — reference only

> **Scope from user (verbatim)**: "Issues #58 + #59 + cold-shard rotation only". NOT a full e2e overhaul (no smoke suite changes, no generic test-infra rewrites).
>
> **Success criteria (verbatim)**: "5/5 shards green on 3/4/5 consecutive runs on CI."
>
> **Local-first (verbatim)**: "DON'T FORGET TO PLAN RUNNING LOCALLY THE TESTS, BECAUSE LOCALLY IS MUCH FASTER THAN CI. CI is the last gate. You can not run them in CI and expect green if we don't have greens locally."
>
> **Constraints**: test restructure / new fixtures OK. Wallet/Vue code touches require codex review for regressions.

## 1. TL;DR

Three problems, three phases, three PRs, ~20 person-hours, 2-3 calendar days.

1. **Phase 1** — fix discover popup identity-load race (+ verify Authwits Enter gates actually mirror button predicates). Pure UI-layer fix, no wallet-service changes. ~5h.
2. **Phase 2** — restructure `register-token.test.ts` from "stacks two cold flows in one spec" into "one spec per flow, sharing a pre-grant fixture". Drop the quarantine. ~6h.
3. **Phase 3** — solve cold-shard rotation via a per-shard warm-up tap. Empirical 1h probe FIRST to determine whether the tap lives in `global-setup.ts` (preferred) or as a per-test fixture (fallback). ~7h including probe.
4. **Phase 4** — CI acceptance: 5/5 shards green on N of 5 consecutive runs without code re-pushes. Promote Network e2e to required-check on hitting 5/5 on 5/5.

Each phase iterates LOCALLY first; CI is the final gate only. Specific local repro commands per phase in §5.

## 2. State as of 2026-05-26 (commit `6b2075e` on dev)

What landed in PR #46:

- 5-shard CI matrix (`.github/workflows/pr-network-e2e.yml:91-123`)
- `retry: 2`, `pool: "forks"`, `isolate: true` (`packages/extension/vitest.e2e.network.config.ts:14-35`)
- Popup `:disabled` race fixed for `capabilities`, `execute`, `verify` (the latter via `!session`)
- `ChangeAuthwitsRegistryPopup` + `RevokeAuthwitsPopup` `.value` derefs fixed
- 3 tests quarantined under `NULO_E2E_SKIP_DEFERRED_SLOW=1`: `multi-account-from`, `tx-sendTx-multicall`, `register-token`
- Cold-shard limitation documented in `packages/extension/tests/e2e/README.md`

What's still live (the targets of this plan):

- **Discover popup identity-load race** (`packages/extension/src/popup/windows/discover/index.vue:198-205`) — Allow gates on `!requestId` but `dapp.value` / hostname / logo may still be loading. Phishing surface.
- **Authwits Enter gates** — codex verified the `.value` fix is in (`ChangeAuthwitsRegistryPopup.vue:66-72`, `:110-115`, `:151-158`; `RevokeAuthwitsPopup.vue:87-92`, `:163-168`, `:269-276`). But opus's audit recommends the Enter predicate mirror the FULL `:disabled` (`isLoading`, `isErrorOccurred`). Phase 1B verifies + tightens if missing.
- **register-token quarantined** (`packages/extension/tests/e2e/network/register-token.test.ts:16`) — fix is Issue #59 restructure.
- **Cold-shard rotation** — `register-token` quarantine just exposed `batch-mixed` as the new shard-1 victim. Whack-a-mole until we mitigate at the right layer.

## 3. Root-cause map (consolidated)

### 3.1 Issue #58 — discover identity-load race

**Mechanism** (codex + opus agree):

- `requestId` becomes truthy as soon as `useDappInteractionPayload.load()` runs `requestId.value = id` (`composables/useDappInteractionPayload.ts:84`).
- That happens BEFORE `interactionService.getInteractionPayload(id)` resolves with dApp metadata.
- The Allow button gates on `!requestId` — so it's clickable while `dapp.value` / `dappHostname` / logo are still null.
- `approve()` has a silent `if (!requestId.value) return` (`discover/index.vue:79-91`) — same anti-pattern as the original 19-iteration bug.

**Smallest fix** (both audits aligned):

- Add `const isReady = ref(false)` to `discover/index.vue`.
- Flip `isReady.value = true` at end of `init()` only after `loadInteractionPayload()` resolves AND `profile.value` is set.
- Change Allow `:disabled` from `!requestId` → `!isReady`.
- Deny stays gated on `!requestId` (fast bail-out is fine; early reject is not a trust bug).
- Change `approve()` silent guard to `throw new Error("discover approve() called before init() completed")`.

**Why no wallet-service touch needed**: bug is entirely in the popup UI contract. (Codex explicit.)

### 3.2 Issue #58 part B — Authwits Enter gates (verify + tighten)

Codex's read of HEAD says Authwits Enter handlers were already fixed in our last cleanup; opus says verify they mirror the FULL button gate. Action: re-read both files in Phase 1B and apply opus's tightening if not in:

- `ChangeAuthwitsRegistryPopup.vue:114` → `e.key === "Enter" && isAllowedToExecute.value && !isLoading.value`
- `RevokeAuthwitsPopup.vue:167` → `e.key === "Enter" && isAllowedToExecute.value && !isErrorOccurred.value && !isLoading.value`

### 3.3 Issue #59 — register-token cold-flow overload

**Mechanism**: spec stacks two cold interaction flows (cap popup + execute popup) in ONE test, with 60s `{ timeout }`. Inner-wait math: ~210s potential against 60s budget × 3 retries (codex math from `audit-codex-register-token.md`).

**Capability requirement** (codex final-pass correction): `registerToken` requires the **`accounts` cap, NOT `basic`** (`packages/wallet-bridge/src/capability-map.ts:20`, `dispatcher.test.ts:683`, `wallet-bridge/README.md:221`). The playground's `basic` bundle does NOT include accounts; the `accounts` bundle does (`packages/playground/src/lib/bundles.ts:51,63`). The current `register-token.test.ts:42` comment is wrong on this point — that's a misread we should fix during Phase 2.

**Existing coverage** (codex final-pass): `cap-request-accounts.test.ts:10` already covers the accounts-grant path directly. So splitting register-token into a `*-cap-grant.test.ts` companion would add a REDUNDANT cap-popup file to the shard set without adding coverage.

**Resolution divergence**:
- Codex prefers: **file-local pre-grant fixture/helper** + keep one spec (smaller surface).
- Opus prefers: **split into 2 specs** + new file-scoped fixture (more reusable).

**Decision (codex final-pass)**: take **codex's smaller shape** — file-local pre-grant fixture/helper, keep `register-token.test.ts` as the only register-token spec. Don't add `register-token-cap-grant.test.ts` because `cap-request-accounts.test.ts` already covers the account-grant path independently. Opus's "split for reusability" is rejected on the coverage-redundancy grounds.

**Concrete shape**:
- New fixture `dappConnectedExtensionWithAccountsCap` in `fixtures/extension.ts`. Extends `dappConnectedExtension` by driving the **`accounts`** cap-popup → approve flow ONCE per file. Returns the connected page + the selected account address.
- `register-token.test.ts` (retargeted): drops the cap-grant section (lines 36-69 in current HEAD), uses the new fixture, ONLY exercises the execute-popup flow. Budget stays at `{ timeout: 60_000 }`. Drops `skipDeferredSlow`.
- **NO `register-token-cap-grant.test.ts`** — `cap-request-accounts.test.ts` already provides that coverage.

### 3.4 Cold-shard rotation

**Mechanism**: each shard starts with fresh anvil + aztec + playground + Chrome. The first cap-popup-driven test in the shard pays SW + bb.js + PXE cold-boot cost. Quarantining the offender promotes the next file.

**Both audits agree**: warm-up tap is the right approach. They disagree on WHERE.

- **Codex**: fixture layer (e2e helper). Runs once per shard, rejects the request, stores a shard-local sentinel in `.e2e-state`.
- **Opus**: `global-setup.ts` in a throwaway browser. Runs ONCE per shard before any test body. Concern about state-mutation is sidestepped by spawning a disposable browser.

**Decision (opus, with codex's safety gate)**: `global-setup.ts`. Cleaner separation (no test-runner state leaks into fixture scope), and the throwaway-browser pattern resolves the state-mutation concern. **BUT** opus's empirical-validation Phase 3A is essential: we must verify SW state (specifically bb.js wasm + PXE warmth) survives `browser.close()` before committing the impl. If state DOESN'T survive → fall back to codex's fixture-layer approach.

The warm-up MUST reject the cap request (security: not silently grant). Phase 3 design + safety in §6.

## 4. Decision provenance

Where the consolidated plan differs from individual audits:

| Decision | Choice | Source | Why |
|---|---|---|---|
| Discover `isReady` mechanism | matches both | codex + opus (identical mechanism) | Both audits independently arrived at the same pattern; matches the proven capabilities/execute fix |
| Discover button-level gate scope | Allow gated on `!isReady`; Deny stays fast on `!requestId` | codex | Early reject is harmless / not a trust bug; opus wanted both gated; codex's split is the chosen behavior (per final-pass §2 — provenance fix) |
| Throw-not-return in `approve()` | yes | opus (explicit) + codex (defensive throw) | "Investigation-journey.md lesson #1" — silent guards cost 19 iterations |
| Register-token shape | file-local pre-grant fixture, single spec | codex (final-pass) | `registerToken` needs `accounts` cap (NOT `basic` as both initial audits assumed); `cap-request-accounts.test.ts` already covers that grant path; a split companion file would be redundant |
| Cold-shard warm-up location | `global-setup.ts` throwaway browser | opus (after Phase 3A probe) | Cleaner isolation than fixture layer; rejected-request resolves codex's state-mutation concern |
| Phase 3A SW-survival probe BEFORE impl | yes | opus | Risk-reduction; ~1h spike vs days of misallocated work if we guess wrong |
| Phase ordering | popups → register-token → cold-shard | codex | Land smallest popup fix first to reduce ambiguity in shard failures |
| Merge order (independent PRs) | also popups → register-token → cold-shard | codex | Opus suggested 2 → 1 → 3 for "smallest blast first" but Phase 1 has the production-bug urgency |
| 3/4/5 acceptance tiers | 3 of 5 minimum / 4 of 5 comfortable / 5 of 5 promote-to-required | opus | Maps directly to user's "3/4/5 consecutive" criterion |
| Don't touch wallet services | yes | both (explicit) | User's stated constraint; all 3 problems can be fixed at UI / test layer |

Rejected options (with reason):

- **File-rename to land a warm test first on shard 1** (codex audit-shard-vs-serial said brittle; opus seconded): rejected. SHA-1 sharder changes on any file rename.
- **`pool: "threads"` or `fileParallelism: true`**: rejected. Cold cost is per-shard sandbox, not lack of JS worker sharing.
- **HTTP/process prewarm in `agent.sh`**: rejected. Warms Vite + HTTP listeners but not the extension popup path.
- **Self-hosted runner**: out of scope per user. Tracked as future v2.
- **Bumping `register-token` timeout to 180s**: rejected as the plan; kept as Phase 2 fallback if split slips.
- **Force-quarantine more rotating-flake tests**: rejected. Whack-a-mole.

## 5. Local-first verification plan

User's emphatic constraint: "Locally is much faster than CI". Every fix must pass locally before any CI push.

### 5.1 Per-shard local repro (matches CI's distribution)

> Run from **repo root**. `e2e:agent` is a root-level script (`package.json:21`), not a packages/extension/ script — running `cd packages/extension && bun run e2e:agent` fails. (Codex final-pass §3.)

```bash
# Repo root — not inside packages/extension/

# Match the 5 CI shards locally:
for s in 1 2 3 4 5; do
  NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=$s/5 2>&1 \
    | tee /tmp/nulo-shard-$s.log
done

# One shard repeated 3x to gauge per-shard flake rate:
for i in 1 2 3; do
  NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=1/5 \
    2>&1 | tee /tmp/nulo-shard1-run$i.log
done
```

### 5.2 Hot rerun on the same sandbox (skip cold boot)

After one `e2e:agent` run, reuse the still-alive sandbox (matches the prior plan's "Single-worktree fast iteration" path):

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

Use hot loop for rapid iteration on a single fix. Use cold `e2e:agent --shard=N/5` to prove shard stability.

### 5.3 Per-phase local proof gates (BEFORE pushing)

**Phase 1A (discover `isReady`)**:
- New component test in `src/popup/windows/discover/index.test.ts` — ≥10 cases per CLAUDE.md L1/L2 minimum:
  - Allow disabled while load pending
  - Allow disabled while profile null
  - Allow enabled only after both resolve
  - `approve()` throws if called before `isReady`
  - Cancel flag during init doesn't leak
  - Error path stays disabled
  - requestId-vs-payload-vs-profile ordering combinations (3-4 cases)
  - Unmount during init
  - `clickByTestId` polling resolves only after `isReady`
  - Existing behavior preserved
- `bun run vitest run src/popup/windows/discover` → 10/10 green
- `bun run e2e:agent tests/e2e/network/connect-dapp.test.ts` → 3/3 cold runs

**Phase 1B (Authwits Enter)**: component tests ≥5 each:
- Enter while not-ready → no-op
- Enter while isLoading → no-op
- Enter while isErrorOccurred (Revoke only) → no-op
- Enter while ready → fires once
- Rapid double-Enter while loading → fires only once

```bash
bun run vitest run src/popup/components/popups/ChangeAuthwitsRegistryPopup
bun run vitest run src/popup/components/popups/RevokeAuthwitsPopup
```

**Phase 2 (register-token split)**:
```bash
bun run e2e:agent tests/e2e/network/register-token-cap-grant.test.ts
bun run e2e:agent tests/e2e/network/register-token.test.ts
# File-scoped fixture stability across multiple files:
for i in 1 2 3; do
  bun run e2e:agent tests/e2e/network/register-token.test.ts \
    tests/e2e/network/register-token-cap-grant.test.ts
done
```
Drop `skipDeferredSlow` from `register-token.test.ts:16` AFTER 5/5 local cold runs.

**Phase 3 (cold-shard warm-up)**:
- 3A: **probe the actual decision** (codex final-pass §4): does a throwaway-browser warm-up in browser A materially reduce first cap-popup + first `cap-account-item` latency in a SECOND fresh browser on the same shard host? Generic SW-survival is too indirect — we need direct measurement of the path we care about.
  - 1h spike — standalone script `scripts/e2e/probes/warmup-effect.ts`: launch browser A, drive cap-popup-and-reject, close A, launch browser B (fresh), measure `waitForPopup("capabilities")` + `waitForSelector("cap-account-item")` timings. Repeat 5× each, with and without browser-A warm-up. Print mean ± stdev.
  - Decision criterion: if browser B's first-cap-popup latency drops ≥30% with warm-up, choose `global-setup.ts` path. If not, fall back to per-test fixture-layer warm-up (codex's original recommendation).
- 3B: implement warm-up per probe result.
- Best local cold-cliff proxy (run from repo root):
```bash
rm -rf packages/extension/dist
NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=1/5 2>&1 \
  | tee /tmp/nulo-cold-shard1.log
grep "cap-request\|register-token" /tmp/nulo-cold-shard1.log
```
With-vs-without warm-up: first cap test wall-time should drop ≥30%.

### 5.4 Local pre-push gate (every phase)

> Run from **repo root**. Both `audit:vue` (root `package.json:30`) and `e2e:agent` (root `package.json:21`) are root-level scripts. Codex final-pass §3.

```bash
# Repo root
bun run audit:vue                                                 # ~3min — lint/typecheck/units/build
NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=1/5       # ~10min — cold shard 1
git push origin HEAD
gh pr checks --watch
```

## 6. Phase ordering + merge order

```
Phase 1 — popup races (PR #1, low blast radius, production fix)
   ├─ 1A: discover isReady + ≥10 component tests
   ├─ 1B: Authwits Enter predicates (verify in HEAD; tighten if missing)
   └─ Codex review pass on the 3 Vue files
       │
       ▼
Phase 2 — register-token restructure (PR #2, independent of Phase 1)
   ├─ 2A: new dappConnectedExtensionWithAccountsCap fixture
   ├─ 2B: register-token-cap-grant.test.ts extraction
   └─ 2C: un-quarantine register-token.test.ts (after local 5/5)
       │
       ▼
Phase 3 — cold-shard warm-up (PR #3, depends on Phase 2 for clean baseline)
   ├─ 3A: SW-survives-close probe (1h spike) — DECIDES design
   ├─ 3B: warm-up impl (in global-setup.ts OR fixture-layer per probe)
   └─ 3C: README cold-shard section update
       │
       ▼
Phase 4 — acceptance gate (no code; 5 back-to-back workflow_dispatch runs on same SHA)
```

Phase 1 + Phase 2 are independent → can ship in either order. Merge order: 1 → 2 → 3. Why:
- Phase 1 fixes a production bug (phishing surface) — highest urgency
- Phase 2 reduces ambiguity in remaining shard failures
- Phase 3 wants Phase 2 done first to measure warm-up gain against a clean baseline

## 7. Cold-shard mitigation options (ranked)

For Phase 3, ranked by stability gain ÷ implementation cost:

1. **Warm-up tap in `global-setup.ts` (RECOMMENDED, pending Phase 3A probe)**. ~30-60s ONE TIME per shard before any test, inside `hookTimeout: 300_000` budget. Throwaway browser → resolves state-mutation concern. Risk: SW-state survival unverified → Phase 3A.
2. **Warm-up tap in fixture layer** (codex's primary). Subset of #1; runs after browser+ext are live. Fallback if Phase 3A reveals SW state doesn't survive `browser.close()`.
3. **Per-file pre-grant cap fixture for the first cap-driven file in shard**. Subset of either above; only helps cap tests.
4. **`agent.sh` pre-build SW activation**. Proves SW boots but doesn't warm bb.js wasm. Codex critique accepted. SKIP.
5. **`fileParallelism: true`** or **`pool: "threads"`**. Wrong direction — compounds per-shard cold cost. SKIP.
6. **Self-hosted runner with persistent SW**. Highest gain, highest cost, out of scope.
7. **Force-fast-file-first via SHA-1 hack** or **filename trickery**. Brittle. SKIP.

## 8. Security & Adversarial Considerations

Per CLAUDE.md plan-protocol requirement. Both audits independently flagged these.

### 8.1 Discover identity race is a real trust bug (HIGH)

If a slow logo fetch + auto-focused Allow + scripted Enter keydown can fire BEFORE the user sees the dApp hostname/logo/name, the wallet is asking for consent without showing the trust anchor. **The `isReady` fix is a phishing defense, not just a test fix.** Throw-not-return on pre-init `approve()` makes the attempt observable via `consoleErrors` (production telemetry signal).

### 8.2 Authwits Enter bypass — local privilege (MEDIUM)

Bypass lets the user fire `setRegistryEnabled` / `revokeAuthwits` with stale `feeSettings` → real-fund cost + wrong on-chain state. Limited blast radius (local-driven, not dApp-driven) but the Enter gate must mirror the full `:disabled` predicate.

### 8.3 Warm-up tap — supply-chain surface (Phase 3)

Warm-up must:

- ONLY hit the locally-spawned anvil + aztec + playground sandbox. Verify via `grep -E "(testnet|mainnet|prod)" packages/extension/tests/e2e/global-setup.ts` after Phase 3 → must return 0 matches.
- REJECT the cap request, not approve. Approving silently grants a session and changes state under test.
- Be wrapped in try/catch with `[warmup] skipped: <reason>` log to stderr. Do NOT throw — warm-up is a perf optimization, not a hard dependency.

### 8.4 Pre-grant fixture — test isolation (Phase 2)

`dappConnectedExtensionWithAccountsCap` mutates file-scoped cap state. Only `register-token.test.ts` opts in; sibling tests stay on `dappConnectedExtension`. Fixture must be tightly scoped: ONLY the `accounts` cap, ONLY for the playground origin already under test.

### 8.5 Silent no-op handlers — durable convention

The 19-iteration bug class. Convention to ENFORCE on every async-init popup approval surface:

- Explicit `isReady` (or equivalent) computed
- Template `:disabled` tied to it
- Handler THROWS if called pre-ready

Document this as a convention in `packages/extension/tests/e2e/README.md` (or `CLAUDE.md`'s extension component-model section).

### 8.6 Advisory CI gate as attack window

Network e2e is currently advisory on `dev` (only `Quality / Status` is required). A red-but-ignored gate trains contributors to dismiss the signal; real network regressions ship under the noise. Phase 4's "5/5 on 5 of 5" is the bar for promoting Network e2e to required.

### 8.7 Least-privilege

Warm-up uses same `chrome.*` surface as existing tests. No new permissions, no new secrets, no env beyond what `agent.sh` already sets. Crypto / dep-policy / input-validation surface untouched.

## 9. Acceptance criteria (operational)

Maps to user's "5/5 shards green on 3/4/5 consecutive runs."

**Hard gates** (mandatory before declaring done):

- 5/5 green on **3 of 5** consecutive `pr-network-e2e.yml` runs after Phase 3 merges. Measure stability, not flake-via-churn — same HEAD SHA across all 5 dispatches. Per codex final-pass §5, the operational form is:
  - Create a temporary measurement branch pinned to the target commit:
    ```bash
    git checkout -b e2e/acceptance-2026-MM-DD <target-sha>
    git push origin e2e/acceptance-2026-MM-DD
    for i in 1 2 3 4 5; do
      gh workflow run pr-network-e2e.yml --ref e2e/acceptance-2026-MM-DD
      sleep 30   # avoid concurrency-cancel collisions
    done
    ```
  - `--ref dev` is rejected as the acceptance ref because dev advances during the measurement window (per CLAUDE.md's promote-PR cadence).
  - After acceptance, delete the temp branch.

**Comfort gate**:

- 5/5 green on **4 of 5** consecutive runs → confidence to remove the cold-shard limitation note from the README and close the known-limitation language.

**Celebrate gate**:

- 5/5 green on **5 of 5** consecutive runs → promote `Network e2e / Status` to required-check on dev branch protection. Coordinate with the user before flipping.

**Soft gates** (informational, not blocking):

- First-in-shard cap test wall-time decreases ≥30% post-warm-up
- `register-token.test.ts` runs at `{ timeout: 60_000 }` cleanly without `skipDeferredSlow`
- Component test count ≥ 30 across the 3 touched Vue files (discover + 2 authwits)

**Negative gates** (must NOT regress):

- Smoke suite stays green
- `bun run audit:vue` stays green
- No new `consoleErrors` / `pageErrors`
- Renovate weekly run stays green

**Documentation gates**:

- `packages/extension/tests/e2e/README.md` cold-shard section updated; if warm-up doesn't fully resolve, document residual + retry strategy
- `implementations-plan/network-followups/slow-tests-hypotheses.md` Issue #59 row moves "Quarantined" → "Closed by Phase 2"
- `CLAUDE.md` Quality gates section updated if Phase 4 hits 5/5 (Network e2e promoted to required)

## 10. Wallet/Vue code touch list (for codex regression review per user constraint)

User constraint: "If you touch the wallet code, you'll have to ask Codex a review to not introduce any regressions."

**Phase 1A — `packages/extension/src/popup/windows/discover/index.vue` (~12 lines)**:

- Add `const isReady = ref(false)`
- Flip `isReady.value = true` at end of `init()` after `loadInteractionPayload()` succeeds AND `profile.value` is set
- Change `:disabled` on `discover-allow-btn` → `processingError?.type === 'error' || !isReady`
- Reject button keeps `:disabled="isLoading || !requestId"` (fast bail-out)
- Change `approve()` silent guard → `throw new Error("discover approve() called before init() completed")`
- Reset `isReady.value = false` in error-catch branch

**Phase 1B — 2 one-liners (verify already in HEAD; tighten if not)**:

- `ChangeAuthwitsRegistryPopup.vue:114` → `e.key === "Enter" && isAllowedToExecute.value && !isLoading.value`
- `RevokeAuthwitsPopup.vue:167` → `e.key === "Enter" && isAllowedToExecute.value && !isErrorOccurred.value && !isLoading.value`

**Phase 2 — test files only, NO production code**:

- `fixtures/extension.ts`: new `dappConnectedExtensionWithAccountsCap` fixture (drives the **`accounts`** cap-popup, not `basic` — codex final-pass §1)
- `network/register-token.test.ts`: drop cap-grant section (lines 36-69), use new fixture, drop `skipDeferredSlow`, fix the misleading line 42 comment ("basic" → "accounts")
- **No `register-token-cap-grant.test.ts`** — `cap-request-accounts.test.ts:10` already covers that grant path; adding a redundant cap-popup file would add a cold-shard victim without coverage gain (codex final-pass §1)

**Phase 3 — global-setup + workflow, NO production code (with extraction risk)**:

- `tests/e2e/global-setup.ts`: warm-up tap (gated on env `NULO_E2E_WARMUP=1`)
- **Helper extraction (codex final-pass §4)**: current `launchExtension()` at `fixtures/extension.ts:16` depends on `inject("extensionPath")` which only works inside vitest. Calling from `global-setup.ts` (which runs IN vitest's global-setup hook so `inject` IS available there, but the path resolution lives elsewhere) needs either:
  - extracting `launchExtensionWithPath(extensionPath)` as a non-vitest helper that both `launchExtension()` and `global-setup.ts` call, OR
  - duplicating the launch/bootstrap logic in `global-setup.ts` and preserving the onboarding bypass (`fixtures/extension.ts:82`) + playground `?test=1` mode (`playground.ts:23`)
  - **Recommendation**: extract the helper (cleaner; no duplication-rot risk). Adds ~2-3h to Phase 3B estimate.
- `.github/workflows/_network-e2e.yml`: set `NULO_E2E_WARMUP: "1"` in env
- `tests/e2e/README.md`: cold-shard section update

**Codex review prompt for Phase 1 (verbatim, to paste at review time)**:

> Review the diff for Phase 1 discover popup race fix. Verify:
>
> 1. Does `isReady` flip ONLY after every state `approve()` reads is committed (`requestId`, `payload`, `dapp`, `profile`)?
> 2. Is the throw-in-handler defensive enough that an injected Enter keydown can't slip through?
> 3. Are there OTHER async-init popups with the same shape we missed?
> 4. Adversarial: what could an attacker do with slow-network + auto-focused button + scripted Enter? Is the hostname rendered BEFORE `isReady` flips? (If yes, user sees trust anchor before they can click — that's the actual phishing fix.)

## 11. Estimate

| Phase | Code | Test | Codex | CI | Total |
|---|---|---|---|---|---|
| 1A discover isReady | 0.5h | 1.5h | 0.5h | 0.5h | **3h** |
| 1B authwits Enter | 0.25h | 1h | 0.25h | 0.5h | **2h** |
| 2A fixture | 1.5h | 0.5h | 0.5h | 0.5h | **3h** |
| 2B test split | 1h | 0.5h | 0.25h | 0.5h | **2.25h** |
| 2C un-quarantine | 0.1h | 0.1h | 0h | 1h | **1.2h** |
| 3A SW-survival probe | 1h | 0.25h | 0h | 0.25h | **1.5h** |
| 3B warm-up impl | 2h | 1h | 1h | 1h | **5h** |
| 3C docs | 0.5h | 0h | 0h | 0h | **0.5h** |
| 4 acceptance | 0h | 0h | 0h | 2.5h | **2.5h** |
| **Total** | | | | | **~20h** |

Calendar: 2-3 working days, single engineer, clean CI capacity.

**Total range** (codex final-pass §estimate):
- **~20h realistic** if Phase 2 stays small (no extra spec) and Phase 3 lands cleanly in `global-setup.ts`
- **~24h** if Phase 3 chooses `global-setup.ts` AND needs the `launchExtensionWithPath()` helper extraction (~half day add)

Add +1 day if Phase 1 codex review surfaces a regression needing Phase 1.5. Add +1 day if Phase 3A probe shows browser-A warm-up doesn't reduce browser-B latency and we switch to fixture-layer warm-up.

## 12. Open questions (resolve before Phase 3B)

1. **Phase 3A probe outcome.** Does Chrome extension SW state (specifically bb.js wasm + PXE block-sync warmth) survive `browser.close()` within the same Chrome installation? NO → fixture-layer warm-up. YES → `global-setup.ts` warm-up. 1h spike before committing Phase 3 design.
2. **Fixture naming.** `dappConnectedExtensionWithAccountsCap` is accurate but long. Confirm naming with codex against existing 11 fixtures at `extension.ts:240-269`.
3. **Warm-up always-on vs opt-in?** Opt-in via `NULO_E2E_WARMUP=1` lets us A/B compare cold-shard rate on same CI infra. Always-on adds ~30-60s to local dev. **Recommend: opt-in for 2 weeks of stability data, then flip to always-on after Phase 4 hits the comfort gate.**
4. **Authwits component test scope.** Both popups need ≥5 component tests per CLAUDE.md L3 composite minimum. Confirm test patterns with the existing `AccountSelectRow.test.ts` (capabilities popup's row component test).

## 13. Deliberately out of scope

- The other 2 quarantined slow tests (`multi-account-from`, `tx-sendTx-multicall`) — different root causes (bb.js cold start, PXE block sync). Future PR.
- Self-hosted runners.
- `clickByTestId` loud-failure assertion (from `investigation-journey.md` lesson #3). Worth doing eventually; `isReady` + throw covers most of the safety for these 3 popups.
- Promoting Network e2e to required-check — only AFTER Phase 4 hits 5/5 on 5/5 (acceptance celebrate gate).
- Bumping `register-token.test.ts` to 180s + retry 1 — Phase 2 fallback only if split slips.
- Touching `src/wallet/services/**` or `src/wallet/runtime.ts` — codex audit-v2 explicit: no service-layer changes needed for any of #58, #59, cold-shard.

---

**Next step**: per CLAUDE.md Tier-A protocol § 3, this consolidated plan goes back to codex for one final critical pass before approval gate. Then ELI5 HTML companion. Then approval gate.
