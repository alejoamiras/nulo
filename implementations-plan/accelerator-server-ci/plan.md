# accelerator-server CI integration

**Consolidated plan** — merges the strongest pieces of three independent Tier-A drafts. The two non-author drafts remain on disk for reference; my own draft was overwritten by this consolidation:

- [`plan-opus-draft.md`](./plan-opus-draft.md) — opus subagent (3-PR shadow-deploy, per-test counter via offscreen RPC, warn-not-fail on `"downloading"`)
- [`plan-codex-draft.md`](./plan-codex-draft.md) — codex (`accelerator/config.ts` module, repo-pinned SHA256, runtime onPhase throw, `ALLOWED_ORIGINS` README-snippet trap)

This consolidated `plan.md` is what goes through the final codex audit + approval gate. Provenance of each non-obvious decision is called out inline ("codex catch" / "opus catch" / "verified locally").

---

**Verdict (1 line):** 1 PR, 4 logical phases, ~8 hours implementation + 1–2 CI iterations to converge. Single PR with a layered kill switch (repo Actions variable + workflow_dispatch input) — multi-PR staged rollout is an option (codex argued for it) but rejected for this scope; see [§14](#14-pr-shape-decision-1-pr-vs-3-prs).

**Codex final-pass verdict (audit transcript at [`audit-codex.md`](./audit-codex.md)):** `approve-with-fixes`. All 6 findings addressed in this revision:
- (high #1) §4.3 plumbing corrected — `PxeOffscreenDeps` extended to accept `factory`; aztec-runtime stays decoupled from extension alias.
- (high #2) Rollback path now uses `vars.NULO_E2E_DISABLE_ACCELERATOR` repo variable (effective for PR runs) + retained `workflow_dispatch` input for one-off manual reruns.
- (medium #3) `BB_BINARY_PATH` pinned to per-arch native ELF; Layer 1 probe relaxed to `bb_available == true` only.
- (medium #4) Layer 3 demoted from gating to advisory `::notice::` + `$GITHUB_STEP_SUMMARY` row. Measurement shifted to wallet-side `onPhase("proved", { durationMs })` callback.
- (medium #5) `setForceLocal` defense moved from biome to CI grep; reframed as review-defense, not security boundary.
- (low #6) AGPL claim softened from "No license-trigger" to "No obvious §13 trigger; not legal advice."

## 1. Goal

Wire `@alejoamiras/aztec-accelerator` v1.0.1's headless `accelerator-server` binary into the `network-e2e` GitHub workflow so wallet proving uses native `bb` on the runner instead of in-browser WASM. The wallet already constructs `AcceleratorProver` unconditionally at [`packages/aztec-runtime/src/pxe/chain-runtime.ts:91`](../../packages/aztec-runtime/src/pxe/chain-runtime.ts) — it auto-detects `127.0.0.1:59833/health` and silently falls back to WASM when none is present. Installing the server on the runner + enforcing native-required at runtime turns this into a tight contract.

## 2. Locked-in scoping decisions

| | |
|---|---|
| Success target | Land + ship. Quarantine (`NULO_E2E_SKIP_DEFERRED_SLOW=1`) NOT touched here; un-quarantining is a separate measurement-driven follow-up. |
| Scope | CI `network-e2e` only. Local dev unchanged. |
| SDK bump | No. Pin stays at `@alejoamiras/aztec-accelerator@4.2.0`. accelerator-server 1.0.1 is compatible. |
| Fallback behavior | Hard fail. WASM fallback in CI is a regression. |

## 3. Open questions / unknowns

| # | Question | Status / verification path | Risk if wrong |
|---|---|---|---|
| Q1 | Does accelerator-server accept `Origin: chrome-extension://<id>` headers when `ALLOWED_ORIGINS` is unset? | **Verified-by-spec**: README says "If unset, all browser origins are auto-approved on the headless server." Will leave unset in this PR and capture the actual Origin from `/tmp/accelerator-server.log` for documentation. | Low — if rejected, runtime hard-fail catches it on first CI run. |
| Q2 | Where exactly does `bb` live after `setup-aztec`? | **Verified by local probe**: `~/.aztec/current/node_modules/.bin/bb` (symlink). Per-arch concrete at `~/.aztec/versions/<v>/node_modules/@aztec/bb.js/build/amd64-linux/bb` on Linux. Codex claimed it doesn't exist; codex was wrong. | Low — if symlink layout shifts on Linux runners, fall back to per-arch explicit path. |
| Q3 | Is `accelerator-server` a static binary or does it need glibc ≥ X? | **Spike during Phase 4.1** — `ldd accelerator-server` on a fresh ubuntu-latest. Per opus's research the tarball is "1.7MB single static binary." | If glibc mismatch → install fails loud → workflow red. No silent failure mode. |
| Q4 | Does server exit cleanly on SIGTERM? | Undocumented. Workflow includes `pkill -TERM accelerator-server` as belt-and-suspenders cleanup. | Low — runner VM is destroyed after the job. |
| Q5 | Does the wallet's MV3 offscreen `fetch()` to `http://127.0.0.1:59833/prove` work with Chrome's CORS for `chrome-extension://` origins? | **Verified-by-precedent**: the existing onboarding probe (`useAcceleratorStatus.ts:28`) already does cross-origin fetch to the same host:port from the same MV3 surface. | Low. |
| Q6 | accelerator-server log format — can we count `/prove` requests reliably? | **Spike during Phase 4.1** — set `RUST_LOG=info` and grep for the prove request pattern. If log doesn't carry it, we lean entirely on runtime onPhase throw (Layer 2 below). | Low — Layer 2 is the primary enforcement; log scrape is a backstop. |
| Q7 | What is the upstream SHA-256 for `accelerator-server-1.0.1-linux-x86_64.tar.gz`? | **Must verify and pin in repo** (per codex's supply-chain catch) before PR can merge. Compute hash, commit alongside version pin. | High if blindly trusting the sidecar (sidecar can be replaced with the tarball in a release-origin compromise). |

## 4. Phase-by-phase implementation (single PR, 4 logical phases)

### Phase 4.1 — Composite action `setup-accelerator-server`

**File:** `.github/actions/setup-accelerator-server/action.yml` (new)

```yaml
name: Setup accelerator-server
description: Install the headless aztec-accelerator server for CI proving. Verifies repo-pinned SHA-256 (not just the upstream sidecar). Cached by version+sha.

inputs:
  version:
    description: accelerator-server release tag (without the leading "accelerator-v" prefix).
    required: false
    default: "1.0.1"
  expected_sha256:
    description: Repo-pinned SHA-256 of the linux-x86_64 tarball. Must be set in the workflow caller; not defaulted here so a mismatch is loud.
    required: true

runs:
  using: composite
  steps:
    - name: Compute install dir
      id: paths
      shell: bash
      run: |
        echo "bin_dir=$RUNNER_TEMP/accelerator-bin" >> "$GITHUB_OUTPUT"

    - name: Cache accelerator-server binary
      id: cache
      uses: actions/cache@v5
      with:
        path: ${{ steps.paths.outputs.bin_dir }}
        key: ${{ runner.os }}-accelerator-server-${{ inputs.version }}-${{ inputs.expected_sha256 }}

    - name: Download + verify + install
      if: steps.cache.outputs.cache-hit != 'true'
      shell: bash
      env:
        VER: ${{ inputs.version }}
        EXPECTED_SHA: ${{ inputs.expected_sha256 }}
        BIN_DIR: ${{ steps.paths.outputs.bin_dir }}
      run: |
        set -euo pipefail
        BASE="https://github.com/alejoamiras/aztec-accelerator/releases/download/accelerator-v${VER}"
        TARBALL="accelerator-server-${VER}-linux-x86_64.tar.gz"
        TMP=$(mktemp -d)
        cd "$TMP"
        curl -sSfL "${BASE}/${TARBALL}" -o "${TARBALL}"

        # Verify against REPO-PINNED hash, NOT the upstream sidecar.
        # A release-origin compromise would replace both tarball + sidecar;
        # only the in-repo pin breaks that attack.
        ACTUAL=$(shasum -a 256 "${TARBALL}" | awk '{print $1}')
        if [ "${ACTUAL}" != "${EXPECTED_SHA}" ]; then
          echo "::error::accelerator-server SHA-256 mismatch."
          echo "  expected: ${EXPECTED_SHA}"
          echo "  actual:   ${ACTUAL}"
          echo "  url:      ${BASE}/${TARBALL}"
          exit 1
        fi

        tar -xzf "${TARBALL}"
        mkdir -p "${BIN_DIR}"
        mv accelerator-server "${BIN_DIR}/accelerator-server"
        chmod +x "${BIN_DIR}/accelerator-server"

    - name: Add to PATH
      shell: bash
      run: echo "${{ steps.paths.outputs.bin_dir }}" >> "$GITHUB_PATH"

    - name: Verify executable
      shell: bash
      run: |
        which accelerator-server
        ldd "$(which accelerator-server)" || true   # surface glibc constraints in the log
```

**Why no sudo / `/usr/local/bin`?** (Codex catch.) Workflow steps don't need `sudo` for binaries they only call themselves; a per-job `$RUNNER_TEMP/accelerator-bin` on PATH is cleaner, requires no privilege escalation, and is automatically cleaned up when the runner VM is recycled.

**Why expected_sha256 required, not defaulted?** (Codex catch.) Forcing the caller to pass it makes accidental version bumps loud — a copy-paste of the action with a new version but old SHA would 100%-fail the verify step instead of silently installing a different binary.

### Phase 4.2 — Workflow integration in `_network-e2e.yml`

**File:** `.github/workflows/_network-e2e.yml` (modify)

Add new `workflow_call` input:

```yaml
disable_accelerator:
  description: |
    When true, skip the accelerator-server install + start + hard-fail
    enforcement. Wallet falls back to WASM proving. Provided as a rollback
    flag — under normal operation accelerator is required.
  required: false
  type: boolean
  default: false
```

Replace the existing `NULO_E2E_SKIP_DEFERRED_SLOW` env block with one that also exports the accelerator-required flag (env-driven, so wallet code reads it via `import.meta.env`):

```yaml
env:
  AZTEC_NODE_URL: ${{ inputs.aztec_node_url }}
  SPONSORED_FPC_SALT: ${{ !contains(inputs.aztec_node_url, 'localhost') && secrets.SPONSORED_FPC_SALT || '' }}
  NULO_E2E_SKIP_DEFERRED_SLOW: "1"
  # Tells the wallet build to construct AcceleratorProver in required-mode.
  # On = throw on fallback/denied phase, eager checkAcceleratorStatus preflight.
  # Off (rollback) = silent fallback, wallet routes via WASM if accelerator down.
  VITE_NULO_ACCELERATOR_REQUIRED: ${{ inputs.disable_accelerator != true && '1' || '' }}
```

Add new steps between `setup-puppeteer` and `Run network e2e via agent`:

```yaml
- uses: ./.github/actions/setup-accelerator-server
  if: inputs.disable_accelerator != true
  with:
    version: "1.0.1"
    # Pin updated whenever we bump version. See SECURITY.md "Binary
    # dependencies" for the bump procedure.
    expected_sha256: "TODO_FILL_IN_BEFORE_MERGE"

- name: Start accelerator-server
  if: inputs.disable_accelerator != true
  shell: bash
  env:
    # Point at the concrete per-arch native ELF, not the Node-wrapped
    # .bin/bb shim. (Codex catch: .bin/bb on the current Aztec CLI install
    # is a Node wrapper script; while it may work, accelerator-server's
    # bb-detection contract expects a native binary path. The per-arch
    # path is unambiguous.) On Linux x86_64 runners this is the only valid
    # match. If setup-aztec ever changes the path layout we'll get an
    # `if [ ! -x ... ]` hard fail (below) before the server starts.
    BB_BINARY_PATH: $HOME/.aztec/current/node_modules/@aztec/bb.js/build/amd64-linux/bb
    # ALLOWED_ORIGINS unset on purpose:
    # 1. Upstream README defaults to "all browser origins approved" when unset.
    # 2. The README's example value `ALLOWED_ORIGINS=http://localhost:5173`
    #    is wrong for our architecture — the proof traffic originates from
    #    the extension offscreen page (chrome-extension://<id>), not the
    #    playground. Copying that snippet blindly would 403 every /prove
    #    request → silent fallback to WASM (which we'd then catch via the
    #    runtime hard-fail, but it's a poor first impression). Lock down
    #    in a follow-up after we observe the actual Origin in production logs.
  run: |
    set -euo pipefail
    if [ ! -x "$BB_BINARY_PATH" ]; then
      echo "::error::BB_BINARY_PATH=$BB_BINARY_PATH not executable. setup-aztec layout may have shifted."
      ls -la "$HOME/.aztec/" || true
      ls -la "$HOME/.aztec/current/" 2>/dev/null || true
      exit 1
    fi
    nohup accelerator-server > /tmp/accelerator-server.log 2>&1 &
    echo "ACCELERATOR_PID=$!" >> "$GITHUB_ENV"

- name: Wait for accelerator-server ready (preflight Layer 1)
  if: inputs.disable_accelerator != true
  shell: bash
  run: |
    set -euo pipefail
    for i in $(seq 1 30); do
      if curl -sSfL http://127.0.0.1:59833/health > /tmp/accelerator-health.json 2>/dev/null; then
        # Layer 1 gates on bb_available only. (Codex catch: gating on
        # `available_versions includes "4.2.0"` was too strict — if
        # BB_BINARY_PATH provides the right binary, the server may
        # not advertise the version-cache list at all. Layer 2's
        # eager checkAcceleratorStatus in chain-runtime.ts catches
        # the version-mismatch case at PXE creation time with a
        # better error message anyway.)
        if jq -e '.bb_available == true' /tmp/accelerator-health.json > /dev/null; then
          echo "Accelerator ready: $(cat /tmp/accelerator-health.json)"
          exit 0
        fi
        echo "::error::accelerator-server alive but bb_available != true"
        cat /tmp/accelerator-health.json
        tail -30 /tmp/accelerator-server.log || true
        exit 1
      fi
      sleep 1
    done
    echo "::error::accelerator-server failed to come up in 30s"
    tail -50 /tmp/accelerator-server.log || true
    exit 1
```

After the `Run network e2e via agent` step, add post-test backstop:

```yaml
- name: Surface accelerator activity (advisory; demoted from gating)
  if: always() && inputs.disable_accelerator != true
  shell: bash
  run: |
    set -euo pipefail
    if [ ! -f /tmp/accelerator-server.log ]; then
      echo "::warning::accelerator-server log missing — possible startup failure"
      exit 0
    fi
    # ADVISORY only — does NOT exit non-zero. (Codex catch: the log
    # format is undocumented + grep patterns are unverified; gating on
    # this could false-fail. Also "zero /prove requests" doesn't
    # necessarily mean fallback — some shards may legitimately have no
    # proving paths. Layer 2 runtime throw in chain-runtime.ts is the
    # authoritative hard-fail signal. This step exists to surface the
    # numbers in the run summary for measurement / debugging.)
    PROVE_COUNT=$(grep -cE 'POST /prove|prove request|prove_request' /tmp/accelerator-server.log || true)
    echo "::notice::accelerator-server log shows ${PROVE_COUNT} /prove-pattern hits this run"
    {
      echo "### accelerator-server activity"
      echo "- /prove-pattern hits: ${PROVE_COUNT}"
      echo "- log size: $(wc -c < /tmp/accelerator-server.log) bytes"
      echo "- last 5 lines:"
      echo '```'
      tail -5 /tmp/accelerator-server.log
      echo '```'
    } >> "$GITHUB_STEP_SUMMARY"

- name: Shut down accelerator-server
  if: always() && inputs.disable_accelerator != true
  shell: bash
  run: |
    if [ -n "${ACCELERATOR_PID:-}" ]; then
      kill -TERM "${ACCELERATOR_PID}" 2>/dev/null || true
      wait "${ACCELERATOR_PID}" 2>/dev/null || true
    fi
    pkill -TERM accelerator-server 2>/dev/null || true
```

Extend the failure-upload step:

```yaml
- name: Upload network e2e logs on failure
  if: failure()
  uses: actions/upload-artifact@v7
  with:
    name: network-e2e-logs-${{ inputs.shard_label || 'full' }}
    path: |
      packages/extension/.e2e-state
      /tmp/aztec-*.log
      /tmp/anvil-*.log
      /tmp/nulo-probes-*.jsonl
      /tmp/accelerator-server.log    # NEW
      /tmp/accelerator-health.json   # NEW
    if-no-files-found: ignore
    retention-days: 7
```

### Phase 4.3 — Runtime hard-fail (Layer 2: wallet-side throw)

**File:** `packages/extension/src/accelerator/config.ts` (new, ~30 lines)

Centralizes accelerator configuration. (Codex catch — replaces scattered hardcoded `59833` in `useAcceleratorStatus.ts` + the implicit defaults in `chain-runtime.ts`.)

```ts
/**
 * Centralized accelerator-server config used by both the runtime prover
 * construction AND the onboarding probe.
 *
 * `required` mode is CI-only — set via `VITE_NULO_ACCELERATOR_REQUIRED=1`
 * in the network-e2e workflow. In `required` mode:
 *   - `ProductionPxeFactory.createChainRuntime` performs an eager
 *     `checkAcceleratorStatus()` and throws if unavailable.
 *   - The `onPhase` callback on `AcceleratorProver` throws synchronously
 *     when phase === "fallback" or "denied", surfacing the regression at
 *     the exact prove call that triggered it.
 *
 * In default (production) mode the SDK's silent fallback behavior is
 * preserved — end-users without Aztec Accelerator (the desktop app) get WASM proving,
 * just slower.
 */
export const ACCELERATOR_HOST = "127.0.0.1"
export const ACCELERATOR_PORT = 59833
export const ACCELERATOR_HEALTH_URL =
  `http://${ACCELERATOR_HOST}:${ACCELERATOR_PORT}/health` as const
export const ACCELERATOR_REQUIRED =
  (import.meta.env.VITE_NULO_ACCELERATOR_REQUIRED ?? "") === "1"
```

**File:** `packages/extension/src/onboarding/composables/useAcceleratorStatus.ts` (modify, ~3 lines)

Replace `const HEALTH_URL = "http://127.0.0.1:59833/health"` with `import { ACCELERATOR_HEALTH_URL } from "@/accelerator/config"`. No behavior change; just kills the duplicated literal.

**File:** `packages/aztec-runtime/src/pxe/chain-runtime.ts` (modify, ~25 lines)

The wallet currently constructs `AcceleratorProver` without any `onPhase` hook or required-mode preflight. Extend `ProductionPxeFactory.createChainRuntime`:

```ts
public async createChainRuntime(network: NetworkInfo): Promise<ChainRuntime> {
  const node = this.nodeFactory.createNode(network.rpcUrl)
  const config = {
    ...getPXEConfig(),
    dataDirectory: `pxe/${network.profileId}/${network.chainId}`,
    proverEnabled: true,
  } as PXEConfig

  const simulator = new WASMSimulator()

  // onPhase: throws synchronously on fallback/denied in required-mode.
  // "downloading" is intentionally a warn — the proof still succeeds, just
  // with a cold-start tax. Hard-failing on "downloading" would be a
  // false positive (opus catch).
  const onPhase = this.required
    ? (phase: AcceleratorPhase) => {
        if (phase === "fallback" || phase === "denied") {
          throw new Error(
            `[accelerator-required] SDK emitted phase="${phase}" — proving was about to ` +
              `fall back to WASM. This is forbidden in required-mode (VITE_NULO_ACCELERATOR_REQUIRED=1).`,
          )
        }
        if (phase === "downloading") {
          // eslint-disable-next-line no-console
          console.warn(
            "[accelerator-required] SDK emitted phase=\"downloading\" — first prove " +
              "will pay the bb-download tax. Pre-warm BB_BINARY_PATH to avoid this.",
          )
        }
      }
    : undefined

  const prover = new AcceleratorProver({ simulator, onPhase })

  // Required-mode preflight: fail at PXE-creation time rather than at
  // first prove. Cleaner stack trace and a single failure site.
  if (this.required) {
    const status = await prover.checkAcceleratorStatus()
    if (!status.available) {
      throw new Error(
        `[accelerator-required] accelerator-server unavailable at ${ACCELERATOR_HEALTH_URL}. ` +
          `Status: ${JSON.stringify(status)}`,
      )
    }
    if (status.needsDownload) {
      // eslint-disable-next-line no-console
      console.warn(
        `[accelerator-required] accelerator-server reports needsDownload=true for ` +
          `aztec_version=${status.sdkAztecVersion}. First prove will be slow.`,
      )
    }
  }

  const pxe = await createPXE(node, config, { proverOrOptions: prover, simulator })
  return new ChainRuntime(network.chainId, node, pxe, network.rpcUrl)
}
```

Constructor extension:

```ts
export class ProductionPxeFactory implements PxeFactory {
  private readonly nodeFactory: NodeFactory
  private readonly required: boolean

  public constructor(nodeFactory?: NodeFactory, required: boolean = false) {
    this.nodeFactory = nodeFactory ?? new AztecNodeFactoryAdapter()
    this.required = required
  }
  // ...
}
```

**File:** `packages/aztec-runtime/src/offscreen/entry.ts` (modify, ~5 lines)

`createPxeOffscreen` today takes only `{ profiles, logger }` and constructs `PxeService` internally with a default `ProductionPxeFactory`. To thread accelerator-required through without coupling `chain-runtime.ts` to the extension's `@/` alias (codex catch — `chain-runtime.ts:10` is deliberately decoupled), accept an optional pre-built factory in `PxeOffscreenDeps`:

```ts
import { type PxeFactory } from "../pxe/chain-runtime"

export interface PxeOffscreenDeps {
  profiles: IProfileReader
  logger: ILogger
  factory?: PxeFactory   // NEW — optional; defaults to new ProductionPxeFactory()
}

export async function createPxeOffscreen(deps: PxeOffscreenDeps): Promise<void> {
  const services = new ServiceCollection()
  services.add(new PxeService(deps.profiles, deps.logger, deps.factory))   // pass through
  await services.start()
}
```

`PxeService`'s constructor already accepts an optional `factory?: PxeFactory` (`packages/aztec-runtime/src/pxe/service.ts:93`) — no change needed there.

**File:** `packages/extension/src/offscreen/index.ts` (modify, ~5 lines)

The extension shell — which IS allowed to import `@/accelerator/config` — constructs the factory with required-mode pre-baked:

```ts
import { ACCELERATOR_REQUIRED, ACCELERATOR_HOST, ACCELERATOR_PORT } from "@/accelerator/config"
import { ProductionPxeFactory } from "@nulo/aztec-runtime/pxe/chain-runtime"

await createPxeOffscreen({
  profiles: new ProfileServiceClient(),
  logger: new LoggerServiceClient(),
  factory: new ProductionPxeFactory(undefined, {
    required: ACCELERATOR_REQUIRED,
    host: ACCELERATOR_HOST,
    port: ACCELERATOR_PORT,
  }),
})
```

`ProductionPxeFactory`'s constructor (modified in §4.3 above) takes the options bag as primitives — no shared config import inside aztec-runtime.

**Defensive guard (NOT a security boundary):** add a CI grep step in `lint:actions` (or its own composite action) that fails when the token `setForceLocal` appears anywhere outside `**/__tests__/**`, `**/*.test.ts`, `**/*.spec.ts`:

```bash
# .github/workflows/_quality.yml — add a step
- name: Forbid setForceLocal in non-test code
  shell: bash
  run: |
    HITS=$(grep -RnE 'setForceLocal\b' \
      --include='*.ts' --include='*.vue' \
      --exclude-dir='node_modules' --exclude-dir='dist' \
      packages/ \
      | grep -vE '(__tests__|\.test\.ts|\.spec\.ts)' \
      || true)
    if [ -n "$HITS" ]; then
      echo "::error::setForceLocal called outside test files — would bypass accelerator-required enforcement"
      echo "$HITS"
      exit 1
    fi
```

**Why grep, not biome?** (Codex catch.) Biome's surface today is `noRestrictedGlobals` / `noRestrictedImports` / `noRestrictedTypes` — no general AST-call matcher (`noRestrictedSyntax` doesn't exist in our biome version). A grep is honest about what it is: a reviewer's safety net, not a security boundary. Bracket access like `prover["setForceLocal"](true)` or aliasing bypasses both, so we treat this as code-review defense, not a hard constraint. The biome route would have been a worse alternative — it would suggest soundness it doesn't have.

### Phase 4.4 — PR-workflow input + repo-variable kill switch + documentation

**File:** `.github/workflows/pr-network-e2e.yml` (modify, ~10 lines)

The rollback flag must work for **automatic PR runs**, not just manual `workflow_dispatch`. (Codex catch — using only `workflow_dispatch.inputs.disable_accelerator` was a critical hole: it would change only manual reruns and would not affect the required-check that fires on every PR push.) Two layered controls:

1. **Repo Actions variable `NULO_E2E_DISABLE_ACCELERATOR`** (set via Settings → Secrets and variables → Actions → Variables, `vars.*` context). Effective for every PR run regardless of trigger. This is the actual kill switch.
2. **Workflow dispatch input `disable_accelerator: true`** for one-off manual reruns without flipping the global variable.

```yaml
on:
  workflow_dispatch:
    inputs:
      disable_accelerator:
        description: "Skip accelerator-server for this manual run (per-dispatch override)"
        required: false
        type: boolean
        default: false
  # pull_request unchanged

jobs:
  # ...
  network-e2e:
    # ...
    uses: ./.github/workflows/_network-e2e.yml
    with:
      ref: ${{ github.event.pull_request.head.sha || github.ref }}
      shard: ${{ matrix.shard.id }}
      shard_label: ${{ matrix.shard.label }}
      exclude_files: "tests/e2e/network/fee-methods.test.ts"
      # Two ways to disable: (a) global repo variable (affects all PR runs),
      # (b) per-dispatch input (affects only this manual run). Either truthy → disabled.
      disable_accelerator: >-
        ${{ github.event.inputs.disable_accelerator == 'true' || vars.NULO_E2E_DISABLE_ACCELERATOR == '1' }}
    secrets:
      SPONSORED_FPC_SALT: ${{ secrets.SPONSORED_FPC_SALT }}

  network-e2e-heavy:
    # ... (same disable_accelerator passthrough) ...
```

Add the new action path to `dorny/paths-filter` `extension-network` filter so changes to it trigger the gate:

```yaml
- '.github/actions/setup-accelerator-server/**'
```

**Documentation updates:**

1. `CI.md` (root) — new "Accelerator in CI" subsection explaining the hard-fail contract, rollback flag, where to look in failure logs, how to bump the version + SHA.
2. `.github/README.md` — catalog the new composite action under "Reusable composite actions".
3. `CLAUDE.md` — under "Quality gates / In CI", note that `Network e2e / Status` includes accelerator-server enforcement, and the rollback flag.
4. `packages/extension/tests/e2e/README.md` — note that local `bun run e2e:agent` does NOT route through accelerator-server (uses desktop app or WASM); only CI gates on it. Document the parallel-safe local caveat: if a developer runs `e2e:agent` while their desktop accelerator is also running, both compete on 59833; the wallet's `AcceleratorProver` will route to whichever is up first, which is fine for local dev but worth noting.
5. `SECURITY.md` — add a short subsection on the new binary dependency: pinning procedure (compute SHA, commit alongside version), bump procedure (sha changes → action input changes → CI verifies), AGPL note (CI-internal use, no shipping to users, no AGPL §13 trigger).

## 5. File catalog

| File | Change | Why |
|---|---|---|
| `.github/actions/setup-accelerator-server/action.yml` | New, ~50 lines | Composite action: download + verify SHA-256 against REPO-PINNED hash + install to `$RUNNER_TEMP/accelerator-bin` + add to PATH. |
| `.github/workflows/_network-e2e.yml` | +~80 lines | Workflow_call input + 4 new steps (install, start, wait-ready-Layer-1, post-test-Layer-3-backstop) + env exports + log upload extension + shutdown. |
| `.github/workflows/pr-network-e2e.yml` | +~7 lines | Threads `disable_accelerator` through; extends paths-filter for the new action. |
| `packages/extension/src/accelerator/config.ts` | New, ~30 lines | Centralized host/port/health-URL + `ACCELERATOR_REQUIRED` flag from build-time env. |
| `packages/extension/src/accelerator/config.test.ts` | New, ~20 lines | Unit: env parsing, default behavior, URL construction. ~5 cases (small enough not to need 10). |
| `packages/extension/src/onboarding/composables/useAcceleratorStatus.ts` | Modify, ~3 lines | Import URL from shared config instead of hardcoded literal. |
| `packages/aztec-runtime/src/offscreen/entry.ts` | Modify, ~5 lines | Accept optional `factory: PxeFactory` in `PxeOffscreenDeps`; thread to `PxeService`. Keeps aztec-runtime decoupled from extension's `@/` alias (codex catch). |
| `packages/extension/src/offscreen/index.ts` | Modify, ~5 lines | Construct `ProductionPxeFactory` with `{ required, host, port }` from `@/accelerator/config` and pass via `factory:` field. |
| `packages/aztec-runtime/src/pxe/chain-runtime.ts` | Modify, ~30 lines | `ProductionPxeFactory` accepts `{ required, host, port }` options bag (primitives — no extension imports). Required-mode preflight (`checkAcceleratorStatus`) + `onPhase` throw on `fallback`/`denied`, warn on `downloading`. |
| `packages/aztec-runtime/src/pxe/chain-runtime.test.ts` | New or extend, ~10 cases | Unit: required-mode preflight throws, onPhase throws on fallback/denied/not-on-others, warn-on-downloading. |
| `.github/workflows/_quality.yml` (or equivalent existing lint workflow) | +~12 lines | CI grep step: forbid `setForceLocal` token outside test files. Review-defense, NOT a security boundary (codex catch — Biome has no AST-call matcher in our version; bracket access bypasses any token rule regardless). |
| `CI.md` | +~30 lines | New "Accelerator in CI" subsection. |
| `.github/README.md` | +~3 lines | Catalog the composite action. |
| `CLAUDE.md` | +~3 lines | Reference the hard-fail enforcement. |
| `packages/extension/tests/e2e/README.md` | +~10 lines | Local-vs-CI accelerator difference. |
| `SECURITY.md` | +~15 lines | Binary dependency pinning + bump procedure. |

**NOT modified:**
- `packages/extension/scripts/e2e/agent.sh` — stays CI-agnostic. All enforcement is workflow + runtime side.
- `packages/extension/scripts/e2e/resolve-ports.ts` — accelerator port is hardcoded server-side, no per-shard allocation needed (each shard is its own VM).
- Test files in `tests/e2e/network/` — no per-test changes; the runtime throw IS the per-test assertion.
- Any `package.json` dependency block.

## 6. Test plan

Per testing philosophy: smallest set that proves the work AND catches the right failure modes.

| Layer | Test | Why this minimum |
|---|---|---|
| Lint | `bun run lint:actions` over the modified workflow YAML | Catches typos / missing inputs / shell syntax errors before burning CI cycles |
| Unit | `packages/extension/src/accelerator/config.test.ts` — ~5 cases | URL construction, env parsing on/off, default fall-through. Small enough below 10-case minimum (config is trivial). |
| Unit | `packages/aztec-runtime/src/pxe/chain-runtime.test.ts` — ≥10 cases | (1) required-mode preflight: throws when status.available=false. (2) preflight: doesn't throw when available. (3) preflight: warns (not throws) when needsDownload=true. (4-7) onPhase: throws on "fallback", throws on "denied", does NOT throw on "proving"/"proved"/"serialize"/"transmit"/"receive"/"detect". (8) onPhase: warns (not throws) on "downloading". (9) non-required mode: no onPhase wired, no preflight. (10) required false + non-undefined onPhase: respects user-provided callback. |
| Smoke | Workflow_dispatch on PR branch with the disable_accelerator flag flipped both ways | Proves rollback flag works AND proves enforcement actually gates. |
| Integration | Full 5-shard + heavy matrix runs 3× on the PR branch | Confirms accelerator integration is stable; establishes baseline numbers. |
| Negative | Deliberate-mismatch run: stop the accelerator mid-suite via a `workflow_dispatch` that kills it after Phase 4.2's start step | Validates Layer 2 (runtime throw) actually fires per-test. |
| Negative | Cache-poisoning negative: temporarily commit a deliberately-wrong `expected_sha256` value, push, observe install step failing loud, revert | Validates the SHA-256 mismatch fail loud. (Codex catch: `expected_sha256` is an action input, NOT a workflow_dispatch input — can't be flipped at runtime. The negative test must be a one-commit-and-revert.) |

No new tests added to `tests/e2e/network/` — the runtime throw is the assertion mechanism for every existing test.

## 7. Security & Adversarial Considerations

### Threat model

The accelerator-server is a **remote proving oracle** receiving msgpack-serialized private execution steps over loopback and returning ZK proofs.

- **Trust boundary**: extension offscreen MV3 doc ↔ `127.0.0.1:59833` ↔ accelerator-server process ↔ bb binary. All within one GitHub-hosted runner VM, single-tenant.
- **Adversary in CI**: PR-author-supplied code running in `pull_request` event context. Possible attacks: (1) modify accelerator-server's startup args via the workflow YAML diff — visible in PR diff, **mitigated by code review**. (2) replace the binary with a malicious one — mitigated by SHA-256 pinned in repo (not from sidecar). (3) extract proving witnesses — witnesses are test fixtures with no real secrets, so no impact. (4) bypass enforcement by setting `setForceLocal(true)` in the wallet — mitigated by biome lint rule.
- **No production trust extension**: CI proofs are test fixtures; a compromised accelerator returning garbage proofs surfaces as test failures, not silent corruption.

### Supply chain

- **Repo-pinned SHA-256** (codex catch). Sidecar from the same release origin is NOT an independent anchor — a release-origin compromise would replace both. Pin the hash in workflow caller; cache key includes the SHA so any drift invalidates the cache.
- **Version + SHA bump procedure** (documented in `SECURITY.md`): bumping version requires PR with both the version input change and a fresh SHA computed locally; CI verifies the SHA on first install.
- **Cache poisoning**: `actions/cache` keyed on `runner.os + version + SHA`. An attacker can't poison a key without matching SHA.
- **AGPL-3.0**: no obvious AGPL §13 (network-access disclosure) trigger in this CI-internal use — accelerator-server runs only in CI, never serves end users, never reaches a public network endpoint. CI-internal use looks equivalent to a build-tool invocation. **This is not legal advice**; if the integration scope ever expands (e.g. exposing accelerator-server in a deployed Nulo service), redo the analysis. Document the current posture in `SECURITY.md` so future contributors don't re-litigate it without cause. Codex final-pass softening of the original "No license-trigger" wording adopted here.

### Least-privilege

- accelerator-server binds 127.0.0.1 only. No flag exposes it; hardcoded server-side.
- `ALLOWED_ORIGINS` left unset (allow-all browser origins). Safe because single-tenant runner + the README's example `http://localhost:5173` is wrong for our `chrome-extension://` origin (codex catch). Locking down to the actual observed Origin is a follow-up after Phase 4.1's first run captures it from the log.
- `BB_BINARY_PATH` points to a path under `$HOME/.aztec/current/node_modules/.bin/bb` written by `setup-aztec`. Not user-controlled.
- No `sudo` used; install lives in `$RUNNER_TEMP/accelerator-bin`.
- Workflow permissions remain `contents: read, pull-requests: read`.

### Input validation

- Server receives msgpack from the wallet — same shape the desktop app validates. We don't introduce any new HTTP endpoint, file path, or env var derived from PR-author-controlled input.

### Silent fallback as a masking source (the primary threat we're paying to fix)

Three SDK paths emit silent WASM fallback:
1. `/health` probe fails → `onPhase("fallback")` + WASM (`accelerator-prover.ts:332-343`).
2. `/prove` returns 403 (origin denied) → `onPhase("denied")` + `onPhase("fallback")` + WASM (`:374-393`).
3. `setForceLocal(true)` → bypasses telemetry entirely.

Defenses (defense in depth):
- **Layer 1 — Pre-test probe** (`Wait for accelerator-server ready` step): gates on `bb_available && available_versions.includes("4.2.0")`. Catches "never came up" / "version mismatch."
- **Layer 2 — Runtime throw** (`chain-runtime.ts` onPhase): catches paths 1+2 at the exact prove call. Primary enforcement. Maps fallback to the specific test that triggered it.
- **Layer 3 — Post-test log scrape** (`Verify accelerator received proof requests`): backstop in case vitest hard-crashed before Layer 2 surfaced. Counts `/prove` requests in server log.
- **Defense vs path 3** (`setForceLocal`): biome `noRestrictedSyntax` rule forbids it outside test files.

### Adversarial code-review questions for PR review

1. Can a PR author quietly bypass accelerator? — Only by editing workflow YAML, biome.json, or chain-runtime.ts. All visible in diff.
2. Can a PR change the binary URL or SHA? — Visible in workflow + composite-action diff. Reviewer must treat any such change as security-relevant.
3. Could a malicious PR add `setForceLocal(true)` to a test fixture? — `tests/` is excluded from the lint rule (production code only). A test that bypasses accelerator wouldn't gain access to anything sensitive; this is an acceptable carve-out.

## 8. Hard-fail enforcement (consolidated design)

Three layers, each catching different failure modes:

```
Layer 1 — Pre-test probe in `Wait for accelerator-server ready`
  - Runs BEFORE tests start.
  - jq -e '.bb_available == true and (.available_versions | index("4.2.0"))'
  - Catches: server didn't install, crashed on startup, version mismatch, bb not ready.
  - Misses: mid-test crash, per-test fallback events.

Layer 2 — Runtime throw in `chain-runtime.ts`
  - Fires DURING tests, at the exact prove call.
  - onPhase callback throws on phase ∈ {"fallback", "denied"}.
  - Eager `checkAcceleratorStatus()` preflight at PXE creation throws if unavailable.
  - Catches: all three SDK silent-fallback paths (modulo setForceLocal, defended via lint).
  - Misses: nothing in the normal flow.

Layer 3 — Post-test log scrape in `Verify accelerator received proof requests`
  - Runs AFTER tests, BEFORE shutdown.
  - greps accelerator log for /prove requests.
  - Catches: case where vitest hard-crashed (segfault, OOM) before Layer 2 surfaced; CORS mismatch where /prove requests never reached the server at all.
  - Misses: partial coverage (server up, some tests proved, some fell back).
```

The three layers don't catch the same things. Layer 2 is the primary; Layers 1+3 are defense in depth.

This is honest hard-fail: any silent WASM fallback in CI either throws at the prove site (Layer 2) or fails the workflow at install (Layer 1) / post-test (Layer 3). The only remaining gap is "server up, returned a proof, but it was somehow wrong" — that's a different threat (faulty bb) caught by the test assertions themselves (proofs that don't verify fail their own tests).

## 9. Parallel-safe port allocation

**CI**: Each shard runs on its own `ubuntu-latest` runner VM (verified — `runs-on: ubuntu-latest` per matrix entry). Port 59833 binding is local-per-VM. **No collision in CI.**

**accelerator-server has no port-override env var server-side** (codex catch — opus and main both confirmed via README). Even if the SDK supports `AZTEC_ACCELERATOR_PORT`, the server itself only binds 59833. So routing the SDK to a different port wouldn't help without an upstream patch — out of scope.

**Local dev**: developer running `bun run e2e:agent` while ALSO running the desktop accelerator → both compete on 59833. Today's behavior: the SDK probes `/health`, finds whichever responded first, sends `/prove` there. Routed differently but no crash. Acceptable for local dev (which is out of this PR's scope per locked decisions). Documented in `packages/extension/tests/e2e/README.md`.

**Forward-compat note**: if we ever consolidate matrix shards onto a single runner pool, we'd need an upstream patch to accelerator-server. Flagged in lessons doc if the need arises.

## 10. Rollback path

**Two layered controls**, both gated by repo write access (per branch-protection rules; PR authors cannot toggle either):

| Mechanism | Scope | How to enable | When to use |
|---|---|---|---|
| Repo Actions variable `vars.NULO_E2E_DISABLE_ACCELERATOR=1` | All PR + dispatch runs until cleared | Settings → Secrets and variables → Actions → Variables → set to `1` | Real emergency: accelerator regression we can't fix in <1h; need green CI on `dev` while we sort upstream |
| Workflow dispatch input `disable_accelerator: true` | One specific manual rerun | `gh workflow run pr-network-e2e.yml -f disable_accelerator=true` | Investigation: re-run a failed PR with accelerator off to isolate whether the failure is accelerator-related |

When either is truthy:
- Composite action skipped (no install).
- Server start skipped (no process).
- Layer 1 preflight skipped.
- Advisory Layer 3 step skipped.
- `VITE_NULO_ACCELERATOR_REQUIRED` env empty → wallet config `ACCELERATOR_REQUIRED=false` → `chain-runtime.ts` no preflight, no onPhase throw.
- Wallet's `AcceleratorProver` finds no server at `/health` → silent WASM fallback → tests run via WASM (pre-PR baseline).

**Why the repo variable AND the dispatch input?** (Codex catch.) The dispatch input alone would only change manual reruns; the PR-triggered required check fires on every push and would still demand accelerator. The repo variable is what actually unbinds the gate. The dispatch input is the surgical option for investigation runs.

**Why a repo variable, not a secret?** This isn't sensitive. Variables are visible to anyone with read access (helpful for transparency: "why is accelerator off right now?"). Secrets would gate visibility without adding any security value.

## 11. Measurement

Primary measurement source is **wallet-side** SDK phase events (durable, well-typed, already emitted), not the accelerator log (codex catch: server-side log format is unverified; the SDK only guarantees the `x-prove-duration-ms` header reaches the client, where `onPhase("proved", { durationMs })` fires).

| Metric | How we capture it | Baseline (today) | Target post-merge |
|---|---|---|---|
| Total network-e2e wall-clock per shard | Actions billing data | ~20m worst-case (30m budget) | Hopefully 8–12m |
| Per-prove `durationMs` | `onPhase("proved", { durationMs })` callback in `chain-runtime.ts` → logged via existing `LoggerServiceClient` → grepped from `.e2e-state/` logs post-test | Unknown (no instrumentation today) | Baseline + delta vs WASM |
| Wallet stage timing for un-quarantine target tests | (Follow-up PR — codex's measurement recommendation): instrument `proveTx` start/end, popup approve time, dApp promise settle time, cancel-request vs cancel-ack timestamps in the existing journal/log stream. This tells us *where* the remaining slowness sits (proving / submission / cancellation drain) when we evaluate `tx-sendTx-default` + `cancel-mid-prove` un-quarantine readiness. | Not instrumented | Specific stage deltas |
| Quarantined-test signal | `workflow_dispatch` with `NULO_E2E_SKIP_DEFERRED_SLOW=0` AND accelerator enabled | `tx-sendTx-default` was >180s on slow runners | If <30s consistently → ready for un-quarantine in follow-up |
| Cancel-mid-prove headroom | Same dispatch with 30s waits restored locally | Failed on slow runners | If 30s passes → ready to revert the 90s bumps |

**Workflow step summary**: the advisory Layer 3 step (§4.2) writes prove-pattern counts + log tail to `$GITHUB_STEP_SUMMARY`. Wallet-side `durationMs` numbers land in the `.e2e-state/` log artifact uploaded on failure; a small parser script (deferred to follow-up) can aggregate them.

**Not in this PR**: stage-level instrumentation (proveTx start/end, popup approve, etc.). Codex argued this is the highest-payback telemetry for the un-quarantine follow-up; it's a wallet code change of its own and belongs in the un-quarantine PR, not this infra one.

## 12. Rejected alternatives

| Alternative | Rejected because |
|---|---|
| **SDK change to force-fail on fallback** | Locked — no SDK changes. Also: SDK's silent-fallback is correct for production wallets; bending the SDK for CI-only enforcement is wrong-layer. |
| **Per-test `onPhase` counter via offscreen RPC + afterEach** (opus's approach) | Layer 2 runtime throw is simpler and equally rigorous — throws at the exact prove call, no offscreen-RPC plumbing needed. |
| **Pre-test probe only** | Misses mid-test 403-denial. Layer 2+3 cover the gap. |
| **Run accelerator-server as workflow `services:` container** | Not packaged as docker image (tarballs only). Rolling our own Dockerfile adds maintenance + registry cost for zero benefit. |
| **Use `act` for local CI parity** | `act` diverges on `actions/cache` and binary install paths. Not worth setup cost. |
| **Self-hosted runners with accelerator pre-baked** | Locked — GitHub-hosted only. Also: self-hosted introduces ops cost. |
| **Pin accelerator-server in `package.json`** | Not an npm dependency. Pin via composite action's `version` input. |
| **Vendor binary in repo** | Bloats history; doesn't avoid trust issue (someone has to verify the hash at vendor time anyway). Codex correctly flagged this. |
| **Spike-first then ship** | Locked — user picked land+ship over spike. |
| **3 sequential PRs (codex/opus default)** | See §14. |
| **Use README's example `ALLOWED_ORIGINS=http://localhost:5173`** | Wrong origin — wallet runs from `chrome-extension://`, not the playground. Would 403 every prove → silent fallback (caught by Layer 2 but bad first impression). Codex catch. |
| **`/usr/local/bin` install with sudo** | Cleaner to use `$RUNNER_TEMP/accelerator-bin` on PATH — no privilege escalation, auto-cleaned with VM. Codex catch. |
| **Trust `.sha256` sidecar from release origin only** | Sidecar can be replaced in the same compromise. Pin SHA in repo. Codex catch. |

## 13. Specific asks for the final codex review (Phase 7 of protocol)

(a) **Factual accuracy** of §4 — verify the workflow YAML compiles under actionlint, composite action shape matches actions/cache@v5 + actions/upload-artifact@v7 semantics, jq filter syntax is correct.

(b) **chain-runtime.ts changes in §4.3** — is the eager preflight + onPhase throw design correct? Any edge cases (concurrent createChainRuntime, dispose-during-init, status cache TTL interaction)?

(c) **§7 security section** — gaps in the threat model? Specifically the lint rule for `setForceLocal` — is biome's `noRestrictedSyntax` the right enforcement tool, or should we use a custom AST rule?

(d) **§10 rollback** — is the workflow_dispatch flag sufficient, or should there also be a repo-secret-backed kill switch for an emergency?

(e) **§11 measurement** — any other dimensions to instrument that pay back during the un-quarantine follow-up?

(f) **§14 PR-shape** — is 1-PR vs 3-PR the right framing? Anything I'm missing about the operational cost?

## 14. PR-shape decision: 1 PR vs 3 PRs

Both codex and opus argued for **3 sequential PRs** (install/spawn → wallet wire-up → measurement+flip-on). I'm consolidating to **1 PR** for these reasons:

1. **The wallet already constructs `AcceleratorProver` unconditionally.** Spawning accelerator-server on the runner WILL change wallet behavior whether we "wire it up" or not — there's no shadow mode separable from a wired mode. Opus's Phase 1 ("spawn but wallet still WASM") isn't possible without an SDK change, which is locked out.
2. **Code change is small** (~80 LOC across runtime + config + offscreen). Splitting into 3 PRs means 3 review cycles for a contained surface.
3. **The workflow_dispatch kill switch (§10) IS the rollback granularity** that the 3-PR rollout would provide. If accelerator integration is broken, flip the flag → instantly back to WASM.
4. **Calendar cost**: 3 PRs = ~3× review-and-merge calendar time. User's stated success criterion is "land + ship."

**Trade-off the user should know:** the bigger blast radius of 1 PR. If something subtle breaks (e.g. Q1 — chrome-extension Origin rejected by accelerator-server), all `network-e2e` shards on `dev` go red simultaneously. Mitigation: the kill switch flips us back instantly; we'd then file a follow-up.

**Offer at approval gate**: if the user prefers 3 PRs (per codex/opus), I'll happily restructure as: (PR-A) composite action + workflow install/spawn/probe with `disable_accelerator: true` defaulted in the workflow; (PR-B) runtime preflight + onPhase throw + flip default; (PR-C) measurement + docs. ~2× calendar time, cleaner blast radius.
