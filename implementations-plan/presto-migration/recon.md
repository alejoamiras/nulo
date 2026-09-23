# presto-migration — Phase 0.4 recon

Base: `origin/dev @ 323380f6` (the worktree's base). Two read-only agents (batched reuse sweep;
CI/e2e mapper) plus a driver pass over the Presto repo at `presto-v1.1.1` / SDK
`5.2.0-revision.2` / `presto-core 1.0.1` / `presto-banners 1.0.0`.

## Reuse map

| Capability needed | Existing code | Verdict | Note |
|---|---|---|---|
| Native prover in the PXE | `packages/aztec-runtime/src/pxe/chain-runtime.ts` (`ProductionPxeFactory`, `provingMode` union, `onPhase` guard, required-mode preflight) | **adapt** | Rename `AcceleratorProver`→`PrestoProver`, `checkAcceleratorStatus`→`checkPrestoStatus`, option `accelerator`→`presto`. New: `httpsOnly:false` in required mode (CI, HTTP-only headless); explicit handling of the two new unavailable arms in the preflight. |
| Prover mock in runtime tests | `chain-runtime.test.ts` (`vi.mock("@alejoamiras/aztec-accelerator")` capturing ctor args) | **adapt** | Rename module + class + method; add cases for `httpsOnly` and the new arms. |
| Build-time "required" switch + tree-shake stamp | `apps/extension/src/accelerator/config.ts`, `offscreen/index.ts:73-76`, `scripts/e2e/agent.sh:142-157` | **adapt** | `VITE_NULO_ACCELERATOR_REQUIRED`→`VITE_NULO_PRESTO_REQUIRED`, stamp→`NULO_PRESTO_REQUIRED_BUILD_STAMP`, dir `src/accelerator/`→`src/presto/`. Every literal moves in lockstep (list in §Lockstep). |
| Status probe for UI (onboarding, settings) | `onboarding/composables/useAcceleratorStatus.ts` (hand-rolled `fetch(/health)`, 2 s timeout, 5 states) | **adapt → rebuild on `@alejoamiras/presto-core`** | The hand-rolled fetch cannot produce `permission-blocked` / `secure-connection-unavailable{diagnosis}`; only the SDK client can. `presto-core` depends on `@logtape/logtape` + `ms` only (no `@aztec/*`), so `PrestoClient({aztecVersion}).checkStatus()` is cheap enough for the onboarding bundle, which today imports no Aztec code at all. The full `@alejoamiras/presto` SDK (drags `@aztec/bb-prover`, `stdlib`, …) stays offscreen-only. |
| Install pitch UI | none (the accelerator page had a plain download `Button`) | **build new: `<presto-banner variant="card">`** | Owner-approved design (Option B): the banner's `--pb-*` tokens overridden to Nulo's, `fonts="none"`, host-width override. Needs `isCustomElement: tag => tag.startsWith("presto-")` in the Vue compiler options (`vite.config.ts` `vue()` has no options today; zero custom-element infra in the repo). |
| Onboarding page shell | `OnboardingPage`, `StepIndicator` (step 4 already labeled "Speed"), `BrutalistTitle`, `OnboardingSkipLink`, the status card CSS in `accelerator.vue` | **reuse-as-is** | Page renamed; status card kept and extended with the recovery-steps block. |
| Settings page shell | `SettingsPageShell`, `SettingItem` (`external` prop tested), `ItemsContainer`, `settings/index.vue` groups | **reuse-as-is** | New `settings/proving.vue` follows `advanced/index.vue`'s shape; no settings page probes a local service today (searched `fetch(`/`127.0.0.1`/`localhost` under `popup/pages/settings/`). |
| Activity subtitle during proving | `@/utils/card-subtitle.ts` `stageSubtitle()`, `JobProgress` `{stage:"proving"; enteredProveAt}` (documented as extensible), `execution-coordinator.ts:196` marks `proving` | **adapt** | Add `backend?: "presto" \| "browser"` to the proving progress; subtitle branches on it. |
| Offscreen → SW notification | `chrome.runtime.sendMessage(OFFSCREEN_READY_MESSAGE)` / `OFFSCREEN_PONG` (`apps/extension/src/offscreen/index.ts`) | **adapt (same pattern)** | `PxeService` has no event emitter; a `nulo:prover-phase` message from the offscreen following the READY/PONG shape is the smallest channel. |
| CI headless prover install | `.github/actions/setup-accelerator-server/action.yml` (version + SHA-256 of the **extracted binary**, cache keyed on both, verified on every run) | **adapt → `setup-presto-server`** | URL `releases/download/presto-v${VER}/presto-server-${VER}-linux-x86_64.tar.gz`; binary `presto-server`. Presto ships a `.sha256` sidecar; the repo keeps its own extracted-binary pin (SECURITY.md posture). |
| CI headless prover start/health/assert/teardown | `_extension-network-e2e.yml:171-333` | **adapt** | `ACCEL_ALLOW_ALL=1`→`PRESTO_ALLOW_ALL=1`; `pkill presto-server`; log path rename. The activity greps `Received /prove request` / `Proving succeeded` are **unchanged** in Presto (`packages/presto/core/src/server/prove.rs:283,475`). Health stays `http://127.0.0.1:59833/health` with `.bb_available`. |
| CI build stamp env | `_extension-network-e2e.yml:122` (deliberate GHA short-circuit shape) | **adapt** | Rename only; keep the expression shape (codex finding #1 in the original plan). |
| Production negative bundle-grep | `_build-extension.yml:94-112` marker list | **adapt (add)** | `NULO_PRESTO_REQUIRED_BUILD_STAMP` is NOT in the list today; adding it makes "required + httpsOnly:false never ships" machine-checked. |
| Min-age gate exemption | `bunfig.toml` `minimumReleaseAgeExcludes` (dated convention; the accelerator entry expired 2026-09-02 and is still present) | **adapt** | New dated entries for `@alejoamiras/presto`, `presto-core`, `presto-banners`; drop the stale accelerator entry. Provenance check before exempting (npm attestation, as done for 5.2.0). |
| Aztec-line residue check | `scripts/aztec-hold-residue-check.ts` `SINGLE_GENERATION_ROOTS` | **adapt** | Rename the root literal; logic is name-agnostic. |
| Renovate + vite alias | `renovate.json:63-69`, `vite.config.ts:40-41` | **adapt** | Rename. |
| Manifest permissions | `apps/extension/manifest/manifest.config.ts:18` `host_permissions: ["https://nulo.sh/", "http://127.0.0.1/*"]`, no `connect-src` in CSP | **adapt** | Add `https://127.0.0.1/*` (Presto's HTTPS port 59834 is the browser default path). Keep `http://127.0.0.1/*` (witness-free HTTP diagnostic + CI). Shared by chrome + firefox manifests. |
| Fonts inside the banner's shadow DOM | `@nulo/design/base.css` `@font-face` (document-level, applies in shadow trees) | **reuse-as-is** | `--pb-font-*` set to Space Grotesk / Inter; nothing new to bundle. |
| Persisted config | `wallet/config/config.ts` `ConfigSchema` — no accelerator field; status is in-memory | **N/A** | No storage key, no migration (pre-production rule). |
| Docs/skills | `CLAUDE.md`, `CI.md`, `SECURITY.md`, `UPDATE.md`, `.github/README.md`, `aztec-update` + `e2e-testing` skills, `tests/e2e/README.md`, `architecture/codex-notes/{05,10}` | **adapt (reword)** | File-by-file list in the sweep report. `codex-notes/05` already cites a stale `packages/extension/...` path (independent drift). |

## Presto facts verified in the Presto repo (driver pass)

- SDK rename table: `packages/sdk/MIGRATION.md`. No deprecated aliases. `setForceLocal` survives on `PrestoProver` (`presto-prover.ts:138`), so the `_lint-and-typecheck.yml` guard stays valid.
- `PrestoPhase` = `detect | secure-connection-unavailable | serialize | transmit | proving | proved | receive | fallback | downloading | denied | version-mismatch` (`sdk-core/src/lib/types.ts:10-24`). `secure-connection-unavailable` and `version-mismatch` are emitted immediately before `fallback` (`presto-client.ts:327-346`).
- `PrestoStatus` unavailable arms: `offline`, `permission-blocked`, `secure-connection-unavailable {diagnosis: https-disabled | tls-or-trust-failure | presto-reachable | unconfirmed}`, `version-mismatch`, `error`. Uninstalled under HTTPS-only = `secure-connection-unavailable` + `unconfirmed` (`banners/src/status.ts`).
- `httpsOnly`: explicit option > `PRESTO_HTTPS_ONLY` env > runtime default (`true` when `window` or a Worker scope exists — the offscreen document counts). `false` = dual-transport probe, HTTPS preferred (`config.ts:32-70`, `presto-client.ts:139`).
- `presto-core` `PrestoClient({aztecVersion, presto, onPhase}).checkStatus({forceRefresh})` (`presto-client.ts:88-136`); 10 s status cache; single-flight.
- Headless server: HTTP only, `127.0.0.1:59833`; deny-by-default origin gating unless `ALLOWED_ORIGINS` or `PRESTO_ALLOW_ALL=1`; `BB_BINARY_PATH`, `PRESTO_HOME`, `--port` (needs `PRESTO_HOME`). Downloads `bb` on first prove (`packages/presto/README.md:158-226`). Release assets: `presto-server-1.1.1-{linux,macos}-{x86_64,arm64}.tar.gz` + `.sha256`.
- Desktop app canonicalizes `chrome-extension://<32-char id>` origins and shows the MetaMask-style approval popup (`core/src/authorization.rs:53-77`). Its verified-sites registry lists `nulo.sh` / `faucet.nulo.sh` but no extension ID (`src-tauri/src/verified_sites.rs`).
- Banner: `<presto-banner variant state theme href persist-key fonts os dismiss-days>`; `banner.status = prestoStatus` runs `stateFromStatus`; events `presto-banner:{cta,retry,dismiss,collapsed}`; `fonts="none"` skips the Google Fonts link; `:host([variant="card"]) { width: 300px }` is overridable from the host page; radii are not.
- LNA: Chrome 142 prompts public origins for loopback; 145 splits `local-network` / `loopback-network`. A Chromium engineer on the extensions list: extensions with the correct host permissions are not impacted (bug fixed in 144.0.7512+). Firefox 153 enables LNA by default; no extension-exemption statement found (searched developer.chrome.com, chromium-extensions group, MDN).

## Lockstep literals (a partial rename passes silently)

- `VITE_NULO_ACCELERATOR_REQUIRED`: `_extension-network-e2e.yml:122`, `accelerator/config.ts:26`, `agent.sh:79-80,150`, `chain-runtime.ts:34,214` (the 214 string ships in a runtime error), docs.
- `NULO_ACCELERATOR_REQUIRED_BUILD_STAMP`: `config.ts:41-43`, `offscreen/index.ts:73-75`, `agent.sh:151` (grep literal).
- `pkill -TERM accelerator-server` (`_extension-network-e2e.yml:333`) — a stale name is a silent no-op.
- `/tmp/accelerator-server.log` / `/tmp/accelerator-health.json` — write/read pairs inside one workflow.
- `ONBOARDING_HEALTH_URL = "http://127.0.0.1:59833/health"` in `tests/e2e/onboarding-tab.test.ts:5` (Puppeteer interception; the SDK will now probe `https://127.0.0.1:59834/health` first).
- `disable_accelerator` input / `NULO_E2E_DISABLE_ACCELERATOR` var: feature-named; the var is not set in the repo (`gh variable list`).

## Search trail (absence claims)

- No Presto references anywhere: `grep -rni presto` over `*.ts *.vue *.md *.json *.yml *.toml` excluding `bun.lock`, `CHANGELOG.md`, `**/target/**`, `**/artifacts/**` → 0.
- No custom-element infra: `grep -rn "isCustomElement|customElement|defineCustomElement" apps/extension/` → 0.
- No settings page probing a local service: `grep -rln "fetch(" apps/extension/src/popup/pages/settings/` (1 unrelated hit), `grep -rn "127.0.0.1|localhost"` there and under `wallet/` (RPC-URL validation + fixtures only).
- No accelerator persisted key: read `wallet/config/config.ts` `ConfigSchema`, `services/config/spec.ts` `RESTORABLE_CONFIG_KEYS`.
- No local-dev instructions for the headless binary: `apps/extension/README.md` (0 hits), e2e README + skills point at the desktop app.
- HTTPS port unused today: `grep -rn 59834` repo-wide → 0.
- `scripts/ci-cd/` has no accelerator literal; `behavior-gating.test.ts` derives the paths-filter from `package.json`.
- Offscreen→SW push channel: `grep -rn "emit|EventEmitter|Signal" packages/aztec-runtime/src/pxe/service.ts` → none; only READY/PONG via `chrome.runtime.sendMessage`.
