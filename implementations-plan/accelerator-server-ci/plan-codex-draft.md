3 PRs, ~4-6 days. Critical caveat: the upstream CI snippet’s `ALLOWED_ORIGINS=http://localhost:5173` is wrong for this architecture; Nulo’s proof traffic originates from the extension offscreen `chrome-extension://…` context, so copying that setting would likely produce `403 -> denied -> fallback -> WASM`.

**Map**
- CI entrypoint is [`.github/workflows/_network-e2e.yml`](/Users/alejoamiras/Projects/nulo/nulo-2/.github/workflows/_network-e2e.yml:68) calling [`packages/extension/scripts/e2e/agent.sh`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/scripts/e2e/agent.sh:18), while sandbox/bootstrap ownership lives in [`packages/extension/tests/e2e/global-setup.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/tests/e2e/global-setup.ts:27).
- The prove path is extension offscreen boot in [`packages/extension/src/offscreen/index.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/offscreen/index.ts:47) -> `createPxeOffscreen` in [`packages/aztec-runtime/src/offscreen/entry.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/aztec-runtime/src/offscreen/entry.ts:25) -> `PxeService` in [`packages/aztec-runtime/src/pxe/service.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/aztec-runtime/src/pxe/service.ts:93) -> `ProductionPxeFactory` in [`packages/aztec-runtime/src/pxe/chain-runtime.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/aztec-runtime/src/pxe/chain-runtime.ts:68).
- The onboarding probe is separate UI code in [`packages/extension/src/onboarding/composables/useAcceleratorStatus.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/onboarding/composables/useAcceleratorStatus.ts:28); it is not the proving control plane.

**Open Questions**
- Verify the actual `Origin` header emitted by the offscreen document on `/prove` and whether `ALLOWED_ORIGINS=chrome-extension://<extension-id>` is accepted. Until proven, leave `ALLOWED_ORIGINS` unset in CI.
- Verify whether `/health` on Ubuntu immediately reports the SDK version as available, or whether first-use `bb` download only happens on the first `/prove`. That decides whether `needsDownload` is a hard preflight failure.
- Pin the Linux x86_64 tarball digest in-repo. Downloading the `.sha256` sidecar from the same release is not a meaningful trust anchor on its own.
- Reconcile the quarantine docs mismatch: workflow comments/README mention `tx-sendTx-multicall` and `multi-account-from`, but [`tx-sendTx-default.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/tests/e2e/network/tx-sendTx-default.test.ts:23) also gates on `NULO_E2E_SKIP_DEFERRED_SLOW=1`.
- Confirm whether accelerator-server logs are rich enough to count proves. If not, extension-side phase logs become the measurement source.

**Phases**
1. PR1: CI bootstrap, but still default `off`.
- Add [`.github/actions/setup-accelerator/action.yml`](/Users/alejoamiras/Projects/nulo/nulo-2/.github/actions/setup-accelerator/action.yml) to install `accelerator-server` 1.0.1 from GitHub Releases, verify against a repo-pinned SHA256, cache by `version+sha`, and add a temp bin dir to `PATH`. Do not use `sudo` or `/usr/local/bin`.
- Update [`.github/workflows/_network-e2e.yml`](/Users/alejoamiras/Projects/nulo/nulo-2/.github/workflows/_network-e2e.yml:76) to introduce one gate env, `NULO_E2E_ACCELERATOR_MODE`, default `off` in this PR; when enabled later it will install, start, poll `/health`, persist `packages/extension/.e2e-state/accelerator-health-pre.json`, and upload `accelerator-server.log` on failure.
- Update [`.github/workflows/pr-network-e2e.yml`](/Users/alejoamiras/Projects/nulo/nulo-2/.github/workflows/pr-network-e2e.yml:34) so changes to `.github/actions/setup-accelerator/**` trigger the gate.
- Add [`packages/extension/scripts/e2e/check-accelerator-health.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/scripts/e2e/check-accelerator-health.ts) and call it from [`agent.sh`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/scripts/e2e/agent.sh:32) when mode is enabled later. This validator should fail on bad JSON, non-`ok` status, or `bb_available !== true`.
2. PR2: runtime-native-required policy, still default `off`.
- Add [`packages/extension/src/accelerator/config.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/accelerator/config.ts) to centralize host/port/health URL and the CI-only `native_required` mode.
- Update [`packages/extension/src/offscreen/index.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/offscreen/index.ts:51) to pass accelerator policy into aztec-runtime. Update [`packages/extension/src/onboarding/composables/useAcceleratorStatus.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/onboarding/composables/useAcceleratorStatus.ts:28) to consume the shared health URL.
- Update [`packages/aztec-runtime/src/offscreen/entry.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/aztec-runtime/src/offscreen/entry.ts:14), [`packages/aztec-runtime/src/pxe/service.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/aztec-runtime/src/pxe/service.ts:93), and [`packages/aztec-runtime/src/pxe/chain-runtime.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/aztec-runtime/src/pxe/chain-runtime.ts:68) so `ProductionPxeFactory` gets `{ host, port, required, logger }`.
- In `createChainRuntime`, when `required`, do an eager `checkAcceleratorStatus()` and throw before `createPXE` if the accelerator is unavailable. Also wire `onPhase` so `fallback` and `denied` throw immediately, while `proved` logs `durationMs` for measurement.
3. PR3: observability, tests, docs, and flip default `on`.
- Expand [`packages/extension/src/onboarding/composables/useAcceleratorStatus.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/onboarding/composables/useAcceleratorStatus.test.ts:14) to 10+ cases.
- Extend [`packages/extension/src/wallet/services/pxe/chain-runtime.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/wallet/services/pxe/chain-runtime.test.ts:56) for required-mode failures and phase handling. Add [`packages/extension/src/accelerator/config.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/accelerator/config.test.ts).
- Add [`packages/extension/tests/e2e/fixtures/accelerator.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/tests/e2e/fixtures/accelerator.ts) to pull `nulo:logs` from `chrome.storage.session`, filter `source === "pxe"`, and write `.e2e-state/accelerator-metrics.jsonl`.
- Update one non-quarantined proving spec, preferably [`packages/extension/tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts:15), to assert at least one native prove log and zero fallback/denied logs.
- Flip `NULO_E2E_ACCELERATOR_MODE` to `native_required` in [`.github/workflows/_network-e2e.yml`](/Users/alejoamiras/Projects/nulo/nulo-2/.github/workflows/_network-e2e.yml:76).

**File Catalog**
- [`.github/actions/setup-accelerator/action.yml`](/Users/alejoamiras/Projects/nulo/nulo-2/.github/actions/setup-accelerator/action.yml): install/cache/verify the binary.
- [`.github/workflows/_network-e2e.yml`](/Users/alejoamiras/Projects/nulo/nulo-2/.github/workflows/_network-e2e.yml): gate env, start/poll accelerator, artifact upload, final enable flip.
- [`.github/workflows/pr-network-e2e.yml`](/Users/alejoamiras/Projects/nulo/nulo-2/.github/workflows/pr-network-e2e.yml): include the new action path in change detection.
- [`packages/extension/scripts/e2e/agent.sh`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/scripts/e2e/agent.sh): export build flags and run preflight in accelerator mode.
- [`packages/extension/scripts/e2e/check-accelerator-health.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/scripts/e2e/check-accelerator-health.ts): strict `/health` validator.
- [`packages/extension/src/accelerator/config.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/accelerator/config.ts): shared host/port/mode resolver.
- [`packages/extension/src/offscreen/index.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/offscreen/index.ts): pass policy into aztec-runtime.
- [`packages/extension/src/onboarding/composables/useAcceleratorStatus.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/onboarding/composables/useAcceleratorStatus.ts): stop hardcoding the health URL.
- [`packages/aztec-runtime/src/offscreen/entry.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/aztec-runtime/src/offscreen/entry.ts): accept runtime options.
- [`packages/aztec-runtime/src/pxe/service.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/aztec-runtime/src/pxe/service.ts): thread options into the factory.
- [`packages/aztec-runtime/src/pxe/chain-runtime.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/aztec-runtime/src/pxe/chain-runtime.ts): enforce required-mode behavior and phase logging.
- [`packages/extension/src/onboarding/composables/useAcceleratorStatus.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/onboarding/composables/useAcceleratorStatus.test.ts): 10+ composable cases.
- [`packages/extension/src/accelerator/config.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/accelerator/config.test.ts): env parsing tests.
- [`packages/extension/src/wallet/services/pxe/chain-runtime.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/wallet/services/pxe/chain-runtime.test.ts): required-mode unit coverage.
- [`packages/extension/tests/e2e/fixtures/accelerator.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/tests/e2e/fixtures/accelerator.ts): log extraction helper.
- [`packages/extension/tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts): representative native-prove assertion.
- [`packages/extension/tests/e2e/README.md`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/tests/e2e/README.md): CI mode, fixed-port trade-off, rollback, artifact notes.

**Test Plan**
- Unit: `check-accelerator-health.ts`, `config.ts`, and `chain-runtime` required-mode logic.
- Composable: `useAcceleratorStatus` to at least 10 cases, including malformed JSON, timeout/rejection, stale-info clearing, auto-detect on mount, and correct URL/signal usage.
- E2E: one representative non-quarantined proving test asserts native phase logs; rely on the existing network suite for the rest.
- CI acceptance: one manual `workflow_dispatch`, then two PR runs touching the gate paths to compare shard stability and runtime.

**Security & Adversarial Considerations**
- Supply chain: pin exact version and a repo-committed SHA256; do not trust a checksum fetched from the same release origin; do not vendor the tarball into the repo.
- License: the installed SDK is `AGPL-3.0-only` in `node_modules`. CI-only ephemeral execution is a smaller delta than shipping the server to users, but do not check in or redistribute the binary without a deliberate compliance review.
- Least privilege: keep the server on `127.0.0.1`; do not widen manifest permissions beyond existing [`manifest.config.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/manifest/manifest.config.ts:20); avoid `sudo` install paths.
- Origin auth: leave `ALLOWED_ORIGINS` unset initially. Explicitly setting the wrong origin is worse than permissive loopback on a single-tenant runner because it causes silent fallback.
- Input validation: the msgpack boundary is vendor-owned. Nulo should not add clever retries or alternative encodings here; treat any 4xx/5xx except the SDK’s existing 403 path as hard failure.
- Silent fallback: this is the main adversarial failure mode; solve it in the runtime, not just in shell scripts.

**Hard-Fail Strategy**
- Pre-test probe in `agent.sh`: keep it, but only as early diagnosis.
- Post-test log scrape only: reject; it fails too late and still lets tests burn minutes in WASM.
- Per-test prove-RPC counts from server logs: reject as the primary gate; brittle, depends on log format, and some files legitimately do not prove.
- Chosen design: eager `checkAcceleratorStatus()` at PXE runtime creation plus `onPhase` throw on `fallback` and `denied`. This fails at the exact regression point and does not depend on artifact parsing.

**Port Strategy**
- Keep accelerator on fixed `59833` in CI. Each shard is its own `ubuntu-latest` VM, so there is no same-host collision.
- Do not thread accelerator through [`resolve-ports.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/scripts/e2e/resolve-ports.ts:41); the server cannot bind another port, so that would be fake configurability.
- Document that `native_required` mode is not parallel-safe for multiple local agents on one machine. I would document this, not build a client-side port hook that the server cannot honor.

**Rollback**
- One switch: `NULO_E2E_ACCELERATOR_MODE=off` in [`.github/workflows/_network-e2e.yml`](/Users/alejoamiras/Projects/nulo/nulo-2/.github/workflows/_network-e2e.yml).
- That single flag should gate install, startup, build-time runtime policy, and native-required assertions.

**Measurement**
- Capture shard wall time and heavy-job wall time from Actions before/after the flip.
- Persist startup `/health` JSON and `accelerator-server.log` as failure artifacts.
- Log every accelerator phase from offscreen; persist filtered `proved` events with `durationMs` into `.e2e-state/accelerator-metrics.jsonl`.
- Compare `durationMs` distributions for representative proving tests, and keep the existing wrapper timings like [`tx-sendTx-default.test.ts`](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/tests/e2e/network/tx-sendTx-default.test.ts:102) for coarse end-to-end timing.

**Rejected Alternatives**
- Copying the README `ALLOWED_ORIGINS=http://localhost:5173` snippet.
- Treating `/health` success as sufficient proof that no WASM fallback occurred.
- Adding a fake accelerator port allocation path to `resolve-ports.ts`.
- Vendoring the binary in the repo or installing it with `sudo` into `/usr/local/bin`.
- Pointing `BB_BINARY_PATH` at the current `setup-aztec` install; the local `~/.aztec/current` tree does not expose a `bb` binary.
- Making this depend on a self-hosted runner or an SDK bump.

AGPL references used for the license note: GNU FAQ on internal use and AGPL network interaction, and the GNU AGPL materials: https://www.gnu.org/licenses/gpl-faq.en.html and https://www.gnu.org/licenses/ ។