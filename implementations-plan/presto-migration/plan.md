---
plan: presto-migration
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
codex_effort: high
recon_budget: 2 agents (batched reuse sweep + CI/e2e mapper), default
status: draft v1 — awaiting dual audit
worktree: .claude/worktrees/presto-migration (branch worktree-presto-migration, from origin/dev @ 323380f6)
ux_approval: https://claude.ai/artifact/JEc6b2wZ5GyfM7itVYFiDi (owner approved 2026-09-15: Option B card, no popup banner, plain secondary subtitle)
---

# presto-migration — Presto replaces Aztec Accelerator; the wallet tells the truth about where a proof runs

Nulo proves transactions natively through a menu-bar app when one is present, otherwise in the
browser. Today that app is Aztec Accelerator and the wallet talks to it through
`@alejoamiras/aztec-accelerator`. Presto (`presto.build`) is its successor: same wire protocol,
same author, a renamed SDK, an HTTPS-first browser policy, a proper unavailable-state vocabulary
(`permission-blocked`, `secure-connection-unavailable` with a diagnosis), and an install-banner kit.

This plan does three things:

1. **Swap the SDK and the CI prover** — `@alejoamiras/presto` in the PXE factory, `presto-server` on
   the network-e2e runners, every lockstep literal renamed, docs rewritten.
2. **Rebuild the onboarding "Speed" step on Presto's states** — the owner-approved card banner
   (Presto's `<presto-banner variant="card">` re-tokened to Nulo) as the install pitch, and Nulo's
   status card for every other state with per-state recovery steps, including the Local Network
   Access (LNA) denial and the encrypted-connection failure the old page could not express.
3. **Surface the prover at runtime** — a Settings → Proving page (status, details, recovery, retry)
   and an honest activity subtitle ("Proving with Presto ✦" / "Proving in browser…").

## Owner answers (Phase 0, 2026-09-14/15)

- **Scope**: runtime + CI swap; onboarding rework; a runtime proving-status surface. NOT the
  playground/tools dApps (they never used the accelerator).
- **Banners**: embed `<presto-banner>` as-is (Option B: Nulo tokens via `--pb-*`, `fonts="none"`).
  No banner anywhere in the popup — the owner rejected the dock. The Presto subtitle in the
  activity card is plain secondary text, not green.
- **LNA depth**: the full state machine — distinct copy and recovery per state, Retry with
  `forceRefresh`, a `permissions.query` probe where the browser exposes one.
- **`code_review: off`**; codex at `high`; no `/harden` scheduled (fold Presto threats into the
  2026-09-13 audit's remediation via this plan's Security section).
- **Validation layers**: fast layers on every phase; smoke e2e on the UI phases; the network e2e
  canary with the headless Presto server prover-ON; a manual check on the Mac with the real tray
  app (`send-to-mac`).
- **Min-age gate**: temporary first-party excludes for the three Presto packages, dated, removed in
  a follow-up PR after 2026-09-16T14:49Z.

## Scope

**In**

- `@alejoamiras/aztec-accelerator@5.2.0` → `@alejoamiras/presto@5.2.0-revision.2` in
  `packages/aztec-runtime` and `apps/extension`; `@alejoamiras/presto-core@1.0.1` and
  `@alejoamiras/presto-banners@1.0.0` in `apps/extension`.
- `chain-runtime.ts`: `PrestoProver`; `httpsOnly:false` only in required mode; the preflight names
  the new unavailable arms; the required-mode `onPhase` guard also throws on
  `secure-connection-unavailable` and `version-mismatch` (both precede `fallback`).
- CI: `setup-presto-server` action, `_extension-network-e2e.yml` start/health/assert/teardown on
  `presto-server 1.1.1`, `VITE_NULO_PRESTO_REQUIRED`, the production negative-grep gains the new
  stamp, `agent.sh` in lockstep.
- Manifest: `https://127.0.0.1/*` host permission added (keep `http://127.0.0.1/*`).
- `usePrestoStatus` on `presto-core`'s `PrestoClient` (replaces `useAcceleratorStatus`), shared by
  onboarding and the popup.
- Onboarding page `presto.vue` (route `/onboarding/presto`, testids `onboarding-presto-*`) per the
  approved artboards; `learn.vue` / `fees.vue` links; e2e updated in lockstep.
- Settings → App → Proving row + `settings/proving.vue` per the approved artboards.
- `JobProgress` proving stage gains `backend`; offscreen reports the Presto phase to the SW; the
  activity subtitle reads it.
- Docs/skills reworded; `bunfig.toml` excludes; `renovate.json`; residue check; vite alias.

**Out**

- Any Presto-side change (verified-sites entry for the extension ID, headless HTTPS). Surfaced as
  Asks, done in the Presto repo if the owner wants them.
- A persisted "prefer native proving" toggle. Presto is auto-detected; no setting exists today and
  none is added.
- Session-only HTTP consent (`httpsOnly:false` + `allowInsecureDowngrade`) for end users. Presto's
  guidance is to require an informed confirmation and never persist it; the wallet does not offer
  plaintext proving at all — the encrypted-connection recovery is the only path.
- Firefox-specific LNA work beyond the shared state machine.
- Renaming the feature-level `disable_accelerator` input / `NULO_E2E_DISABLE_ACCELERATOR` var
  (Ask A1 below decides; the default is to rename since the var is unset).

## Architecture & Implementation

### Shape

```
apps/extension
  src/presto/config.ts            PRESTO_HOST/PORT/HTTPS_PORT, PRESTO_REQUIRED, PRESTO_REQUIRED_BUILD_STAMP
  src/composables/usePrestoStatus.ts   PrestoClient(presto-core) → PrestoUiState; detect({forceRefresh})
  src/onboarding/pages/presto.vue      card banner (offline) | status card (every other state)
  src/popup/pages/settings/proving.vue status card + Details + link rows
  src/utils/presto-ui-state.ts         pure: PrestoStatus → PrestoUiState + copy + steps (unit-tested)
  src/utils/card-subtitle.ts           stageSubtitle(stage, backend)
  src/offscreen/index.ts               ProductionPxeFactory(required? {httpsOnly:false}) + prover-phase message
  src/wallet/services/execution/execution-coordinator.ts   receives prover-phase → journal {stage:"proving", backend}
packages/aztec-runtime
  src/pxe/chain-runtime.ts             PrestoProver; PrestoEndpoint {host, port, httpsPort?, httpsOnly?}; onProvePhase observer
packages/wallet-core
  src/jobs/types.ts                    JobProgress proving stage: backend?: "presto" | "browser"
.github/actions/setup-presto-server/action.yml
.github/workflows/_extension-network-e2e.yml, _build-extension.yml, pr-/soak/nightly plumbing
```

Two bundles, two clients, one vocabulary:

- The **offscreen document** keeps the heavy SDK (`@alejoamiras/presto` → `PrestoProver`), exactly
  where `AcceleratorProver` lived. Nothing else imports it.
- **Pages** (onboarding, popup) use `@alejoamiras/presto-core`'s `PrestoClient` — a
  dependency-light HTTP client that returns the same `PrestoStatus` the prover sees, including the
  LNA and HTTPS arms. The onboarding bundle stays free of `@aztec/*`.
- A pure mapper `presto-ui-state.ts` turns `PrestoStatus` into the UI state machine both pages
  render, with the copy and recovery steps the owner approved.

### A — runtime swap (`packages/aztec-runtime/src/pxe/chain-runtime.ts`)

```ts
import { PrestoProver, type PrestoPhase } from "@alejoamiras/presto"

export interface PrestoEndpoint {
	host?: string
	port?: number
	httpsPort?: number
	/** CI-only: the headless server is HTTP-only. Never set in production builds. */
	httpsOnly?: boolean
}
export type ProductionPxeFactoryOptions =
	| (PrestoEndpoint & { provingMode?: "default"; onProvePhase?: ProvePhaseObserver })
	| (PrestoEndpoint & { provingMode: "required"; onProvePhase?: ProvePhaseObserver })
	| (PrestoEndpoint & { provingMode: "proverless" })
export type ProvePhaseObserver = (phase: PrestoPhase) => void
```

- `default` mode: `new PrestoProver({ simulator, presto, onPhase })` where `onPhase` only forwards
  to `onProvePhase` (observation, never throws). The SDK's silent WASM fallback is preserved for
  end users. `presto` carries host/port only — `httpsOnly` is left to the SDK's browser default
  (`true`), so production proving stays HTTPS-only.
- `required` mode (CI): `presto: { host, port, httpsPort, httpsOnly: false }`; the guard throws on
  `fallback | denied | secure-connection-unavailable | version-mismatch`; warns on `downloading`.
  The preflight `checkPrestoStatus()` fails with the arm spelled out:
  `[presto-required] presto-server unavailable: reason=<reason> diagnosis=<diagnosis?>`.
- `proverless`: unchanged.
- The `[accelerator-required]` prefix becomes `[presto-required]`; the env name inside the error
  text becomes `VITE_NULO_PRESTO_REQUIRED`.

### B — CI headless prover

- `.github/actions/setup-presto-server/action.yml`: inputs `version` (default `"1.1.1"`),
  `expected_sha256` (required; SHA-256 of the **extracted** `presto-server` binary, same posture as
  today). URL `https://github.com/alejoamiras/presto/releases/download/presto-v${VER}/presto-server-${VER}-linux-x86_64.tar.gz`.
  Install step also downloads the `.sha256` sidecar and checks the tarball against it before
  extraction (defense in depth; the extracted-binary pin remains the gate on every run). Cache key
  `${{ runner.os }}-presto-server-${version}-${expected_sha256}`.
- `_extension-network-e2e.yml`: env `PRESTO_ALLOW_ALL: "1"` (the extension origin is
  `chrome-extension://…`, non-localhost, denied by default), `RUST_LOG: info`; start
  `nohup presto-server > /tmp/presto-server.log`; health poll unchanged
  (`http://127.0.0.1:59833/health`, `.bb_available == true`); activity greps unchanged
  (`Received /prove request`, `Proving succeeded` — verified identical in Presto's
  `core/src/server/prove.rs:283,475`; re-verify at the `presto-v1.1.1` tag during P3);
  teardown `pkill -TERM presto-server`; artifact paths renamed. `VITE_NULO_PRESTO_REQUIRED` keeps the
  exact short-circuit expression shape. Never seed `BB_BINARY_PATH` (same rule; re-verify the Presto
  `find_bb` behaviour and drop the accelerator issue link).
- `_build-extension.yml` production guard: add `NULO_PRESTO_REQUIRED_BUILD_STAMP` to the marker
  list, so a build carrying `httpsOnly:false` can never ship.
- `agent.sh`: rename the env var and the grep literal.
- Pre-PR network gate: the soak workflow in `mode=files` on the canary files with
  `proverless=false`, one iteration (see P3's gate).

### C — status client + UI state (`usePrestoStatus`, `presto-ui-state.ts`)

```ts
export type PrestoUiState =
	| { kind: "detecting" }
	| { kind: "offline" }                                   // install pitch (card banner)
	| { kind: "permission-blocked" }                        // LNA denial → site-permission steps
	| { kind: "secure-connection-unavailable"; diagnosis: SecureConnectionDiagnosis } // tray steps
	| { kind: "version-mismatch" }
	| { kind: "error" }
	| { kind: "downloading"; info: PrestoInfo }             // available + needsDownload
	| { kind: "available"; info: PrestoInfo }
export interface PrestoInfo { appVersion?: string; nativeAztecVersion?: string; protocol?: "http" | "https" }
export function uiStateFromStatus(status: PrestoStatus): PrestoUiState   // mirrors banners' stateFromStatus, keeps diagnosis
export function copyFor(state: PrestoUiState): { title: string; detail: string; steps?: string[]; retry?: "Test" | "Retry" | "Re-test" }
```

- `usePrestoStatus({ autoDetect })` owns one `PrestoClient({ aztecVersion: __AZTEC_VERSION__ })`,
  exposes `state`, `detect({ forceRefresh })`, and `bannerStatus` (the raw `PrestoStatus`, fed to
  `banner.status`). Lives in `src/composables/` (auto-imported in both shells).
- LNA probe: before the first `detect`, if `navigator.permissions?.query` accepts
  `{ name: "local-network-access" }` (Chrome 142–144) or `"loopback-network"` (145+), a `denied`
  result short-circuits to `permission-blocked` without waiting for the SDK's 10 s probe; anything
  else defers to the SDK. Wrapped in try/catch — unknown permission names throw.
- Copy is Presto's canonical `STRINGS` where a state has one, extended with Nulo's numbered
  recovery steps (approved artboards). "Not installed" is `secure-connection-unavailable` +
  `unconfirmed` (the SDK cannot tell an uninstalled Presto from a dismissed prompt under HTTPS-only).

### D — onboarding `presto.vue`

- `offline` → `<presto-banner variant="card" fonts="none" theme="{{ nulo theme }}" href="https://presto.build">`
  inside a wrapper that sets the `--pb-*` overrides and `width: 100%` (host styles beat `:host`).
  `banner.status = bannerStatus` after each detect (the banner renders nothing until set — no flash
  of the pitch for installed users). Listen to `presto-banner:retry` → `detect({forceRefresh:true})`;
  leave `presto-banner:cta` default (anchor with `rel="noopener"`). Below it: "Installed it
  already? Test again" and the Skip link.
- Every other state → Nulo's status card (`copyFor`), steps block for the warn states, Retry inside
  the card, Continue only on `available` / `downloading`, Skip otherwise.
- The Windows note is deleted (Presto ships Windows). The `os` attribute is left to the banner's
  user-agent detection.
- Vue: `vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("presto-") } } })`
  in `vite.config.ts`; `import "@alejoamiras/presto-banners/register"` in the page's script.
- Theme: the banner's `theme` attribute follows the `<html theme>` attribute onboarding already
  sets (`app.vue` `applyTheme`), so light mode gets the light `--pb-*` overrides.

### E — settings `proving.vue` + index row

- `settings/index.vue` App group gains `SettingItem to="/popup/settings/proving" title="Proving"
  materialIcon="speed" data-testid="setting-nav-proving"` with a live description
  (`Presto · connected` / `In browser · Presto not detected` / `Browser blocked local access` /
  `Presto · encrypted connection off`) from the same composable (`autoDetect` on mount, cached 10 s).
- `proving.vue`: `SettingsPageShell title="Proving" backTo="/popup/settings"`; compact status card
  (title, detail, steps, Retry); `ItemsContainer "Details"` (Presto app version, Aztec runtime,
  Connection = `Encrypted` / `Plain HTTP` / `Blocked` / `—`); a `SettingItem external` "Get Presto"
  row only when `offline`; the explainer line. Route meta `isAuthRequired: true`.

### F — the proving backend on the activity card

- `wallet-core` `JobProgress`: `{ stage: "proving"; enteredProveAt: number; backend?: "presto" | "browser" }`.
- Offscreen: `ProductionPxeFactory({ onProvePhase })` where the observer sends
  `chrome.runtime.sendMessage({ type: "nulo:prover-phase", phase })` for `transmit` (→ `presto`),
  `fallback` (→ `browser`), and `proved`. Same primitive as `OFFSCREEN_READY_MESSAGE`.
- SW `execution-coordinator.ts`: while a journal op is in `proving`, the first `prover-phase`
  message re-marks `{ stage: "proving", enteredProveAt, backend }`. The FSM allows a same-stage
  progress update (verify in P8; if `transitionOperation` rejects same-stage writes, add a
  `updateProgress` that only widens the payload).
- `stageSubtitle(stage, backend)`: `proving` → `"Proving with Presto ✦"` / `"Proving in browser…"`
  / `"Generating proof..."` when unknown. `card-subtitle.test.ts` exhaustiveness pin extended.
- Concurrency: the offscreen holds one PXE write-lock per chain (`withPxeWrite`), so at most one
  prove runs per chain; the message carries no job id and the coordinator applies it to the op
  currently in `proving` for that chain. If two chains prove at once the phase is attributed by
  `chainId` (included in the message).

### Data & control flow (critical paths)

1. **Prove (production)**: SW `execution-coordinator` marks `proving` → offscreen `PxeService.proveTx`
   → `PrestoProver.proveTx` → `detect` (HTTPS probe `https://127.0.0.1:59834/health`; on failure one
   witness-free HTTP `GET /health` for diagnosis) → `transmit`/`proving`/`proved` OR
   `secure-connection-unavailable`/`fallback` → WASM. `onProvePhase` → `nulo:prover-phase` → journal
   `backend` → subtitle.
2. **Prove (CI required)**: same, with `httpsOnly:false` → dual probe prefers HTTPS, uses HTTP
   `59833`; the guard throws on any fallback-class phase; the workflow asserts `Proving succeeded`
   count > 0 on the canary lane.
3. **Onboarding detect**: mount → LNA `permissions.query` short-circuit → `PrestoClient.checkStatus`
   → `uiStateFromStatus` → card banner or status card. Retry → `checkStatus({forceRefresh:true})`.
4. **Settings detect**: identical composable; Details rows read `info`.

### Interfaces (new / changed)

- `@nulo/aztec-runtime`: `PrestoEndpoint`, `ProvePhaseObserver`, `ProductionPxeFactoryOptions`
  (above). `AcceleratorEndpoint` removed (no deprecated alias — one consumer).
- `@nulo/wallet-core/jobs`: `JobProgress` proving arm gains `backend?`.
- `apps/extension`: `PrestoUiState`, `PrestoInfo`, `uiStateFromStatus`, `copyFor`,
  `usePrestoStatus`, the `nulo:prover-phase` message `{ type; chainId; phase }`.

### File-level change map

Added: `src/presto/config.ts` (renamed from `src/accelerator/config.ts`),
`src/composables/usePrestoStatus.ts` (+test), `src/utils/presto-ui-state.ts` (+test),
`src/onboarding/pages/presto.vue`, `src/popup/pages/settings/proving.vue`,
`.github/actions/setup-presto-server/action.yml`, `tests/e2e/settings-proving.test.ts` (smoke).

Modified: `packages/aztec-runtime/{package.json, src/pxe/chain-runtime.ts, chain-runtime.test.ts, src/offscreen/entry.ts}`,
`packages/wallet-core/src/jobs/types.ts` (+fsm test), `apps/extension/{package.json, vite.config.ts, manifest/manifest.config.ts, scripts/e2e/agent.sh}`,
`src/offscreen/index.ts`, `src/wallet/services/execution/execution-coordinator.ts`,
`src/utils/card-subtitle.ts` (+test), `src/popup/components/modules/general/RecentActivityView.vue`,
`src/popup/pages/settings/index.vue`, `src/onboarding/pages/{learn,fees}.vue`,
`src/stores/app.store.ts` (comment), `src/popup/pages/settings/security/reset.vue` (comment),
`tests/e2e/onboarding-tab.test.ts`, `.github/workflows/{_extension-network-e2e,_build-extension,pr-extension-network-e2e,extension-network-e2e-soak,nightly,_lint-and-typecheck}.yml`,
`.github/README.md`, `bunfig.toml`, `renovate.json`, `scripts/aztec-hold-residue-check.ts`,
`CLAUDE.md`, `CI.md`, `SECURITY.md`, `UPDATE.md`, `.claude/skills/{aztec-update,e2e-testing}/SKILL.md`,
`apps/extension/tests/e2e/README.md`, `architecture/codex-notes/{05-pxe-integration,10-build-and-manifest}.md`.

Deleted: `src/accelerator/`, `src/onboarding/composables/useAcceleratorStatus.{ts,test.ts}`,
`src/onboarding/pages/accelerator.vue`, `.github/actions/setup-accelerator-server/`.

### Algorithms / non-obvious mechanics

- **Uninstalled ≠ offline under HTTPS-only.** Both probes fail; the SDK reports
  `secure-connection-unavailable` + `unconfirmed`. The mapper treats exactly that pair as the
  install pitch; every other diagnosis means Presto is present and HTTPS needs fixing. A reason the
  mapper does not know maps to `error`, never to the pitch (same rule as the banner kit).
- **LNA in an extension.** Chrome does not prompt extension pages that hold host permissions for the
  target; the manifest gains `https://127.0.0.1/*` so the HTTPS probe is covered too. The
  `permission-blocked` state still exists for the Chrome 142–143 window, Firefox 153+, and managed
  policies. The recovery steps say "site permissions beside the address bar" because that is the
  only user-operable fix; an extension page shows them under the extension's origin.
- **Presto approval popup.** The desktop app prompts once per origin; the wallet's origin is an
  opaque `chrome-extension://<id>`. A user denial surfaces as phase `denied` → WASM (production) and
  as `denied` → throw (CI). The onboarding copy tells the user to approve Nulo in Presto's prompt.
- **Required-mode HTTP.** `httpsOnly:false` is passed only from `offscreen/index.ts` under
  `PRESTO_REQUIRED`, which only the CI build stamps; the production negative-grep makes that
  machine-checked.

### Trade-offs & alternatives not taken

- **Status via the offscreen's prover (one client, one cache) vs a page-side `PrestoClient`.**
  Page-side wins: onboarding runs before any profile or PXE exists, `presto-core` is light, and the
  popup page must not depend on the offscreen being alive to render Settings. Cost: two probes'
  worth of `/health` traffic per session (10 s cache each).
- **Vue re-skin of the banner vs the custom element.** The element wins (owner decision, one source
  of copy/state/morph). Cost: an `isCustomElement` predicate and localStorage dismissals under the
  extension origin.
- **Rename `disable_accelerator` → `disable_presto`.** Recommended (the variable is unset, nothing to
  migrate; leaving "accelerator" in the workflow surface invites the exact stale-grep drift recon
  found). Ask A1.
- **Keep `http://127.0.0.1/*`.** Yes: the witness-free HTTP diagnostic and CI need it; dropping it
  would turn every diagnosis into `unconfirmed`.

## Competing outline — "thin swap first, UX later, status through the offscreen"

One arc, no new UI surfaces. Rename the SDK and the CI binary; keep `useAcceleratorStatus` as a
plain `/health` fetch against `https://127.0.0.1:59834` (accept that it cannot distinguish LNA from
"not installed"); keep `accelerator.vue` with the copy swapped and the download button pointing at
`presto.build`; no settings page; no subtitle change; the banner kit unused. Later plans add the
status surface by routing `checkPrestoStatus` through the offscreen (`PxeService` RPC) so the
wallet holds exactly one Presto client.

Why it loses: the owner asked for the LNA/HTTPS state machine now, and a bare `/health` fetch
under HTTPS-only cannot produce it — an HTTPS failure is indistinguishable from absence without the
SDK's diagnostic. Routing status through the offscreen also makes onboarding depend on a PXE that
does not exist yet. Where it wins: half the diff, no custom-element plumbing, no new bundle
dependency for pages. The audits should say whether arc 2's surface earns its size.

## Security & Adversarial Considerations

**Threat model.** The wallet hands private witness data to a loopback HTTP(S) service that is
shape-matched, not authenticated (Presto's documented trust boundary). Attackers: a local process
squatting the Presto ports while Presto is not running; a malicious page trying to reach the
prover through the extension; a supply-chain compromise of the Presto npm packages or the headless
binary; a CI runner where `PRESTO_ALLOW_ALL` widens the origin gate.

- **Port squatting.** HTTPS-only in production is the mitigation the migration adds: a squatter
  without Presto's name-constrained local CA fails TLS and the SDK falls back to WASM instead of
  transmitting the witness. The wallet never offers the session-only HTTP downgrade. Required-mode
  HTTP exists only in CI builds, proven absent from production bundles by the negative-grep.
- **Extension ↔ prover authorization.** Presto's desktop app gates `/prove` per origin with a user
  prompt; the wallet's origin is opaque, so the onboarding copy names Nulo in that prompt.
  Recommend (Ask A3) listing Nulo's store extension ID in Presto's verified-sites registry so the
  prompt shows a recognition badge — a UX aid, not a boundary.
- **CI origin gate.** `PRESTO_ALLOW_ALL=1` only on the ephemeral GitHub-hosted runner (single-tenant,
  torn down after the job), mirroring today's `ACCEL_ALLOW_ALL=1`. Never on self-hosted runners.
- **Supply chain.** npm: three first-party packages exempted from the 7-day gate for ≤ 2 days with
  provenance verified before exempting (`npm audit signatures` + the GitHub attestation for each
  tarball, as done for accelerator 5.2.0), dated removal. Binary: the repo pins the SHA-256 of the
  extracted `presto-server` and re-verifies on every run (cache hits included); the upstream
  `.sha256` sidecar is an extra pre-extraction check, not the boundary. Lockfile committed;
  `bun install --frozen-lockfile` in CI. AGPL-3.0 posture unchanged from the accelerator (same
  author, same license) — re-confirm in `SECURITY.md`.
- **Least privilege.** `https://127.0.0.1/*` is the only permission added. No new GitHub token
  scopes; the action remains sudo-free.
- **Input validation.** `PrestoStatus` is untrusted JSON from a local service: the mapper reads only
  the discriminants it knows and defaults unknown reasons to `error`; `info` strings are rendered
  as text, never HTML. The banner escapes `href`; the wallet passes a constant.
- **Frontend.** No new `innerHTML`; the banner runs in a closed shadow tree with its own CSS; the
  wallet only sets attributes/properties. Dismissals persist in the extension page's localStorage —
  no sensitive data. External links keep `rel="noopener noreferrer"`.
- **Prompt injection / LLM flows.** None touched.
- **Message channel.** `nulo:prover-phase` is a `chrome.runtime.sendMessage` from the extension's
  own offscreen document; the SW handler checks `sender.id === chrome.runtime.id` and ignores
  unknown phases, same as the READY handshake.
- **Secrets.** None created or moved.

## Assumptions

### Facts (verified)

- F1 — Migration is a rename: `AcceleratorProver`→`PrestoProver`, `checkAcceleratorStatus`→`checkPrestoStatus`, option `accelerator`→`presto`, `AcceleratorPhase`→`PrestoPhase`; no deprecated aliases (`presto/packages/sdk/MIGRATION.md`).
- F2 — `presto-core` depends only on `@logtape/logtape` and `ms`; `PrestoClient({aztecVersion, presto, onPhase}).checkStatus({forceRefresh})` (`sdk-core/package.json`, `presto-client.ts:88-136`).
- F3 — `httpsOnly` resolves explicit option > `PRESTO_HTTPS_ONLY` > `true` in browser/Worker runtimes (`sdk-core/src/lib/config.ts:32-70`); `false` selects the dual probe (`presto-client.ts:139`).
- F4 — `PrestoPhase` includes `secure-connection-unavailable` and `version-mismatch`, emitted before `fallback` (`sdk-core/src/lib/types.ts:10-24`, `presto-client.ts:327-346`).
- F5 — Headless `presto-server` is HTTP-only on `127.0.0.1:59833`, deny-by-default origins unless `ALLOWED_ORIGINS`/`PRESTO_ALLOW_ALL=1`; release `presto-v1.1.1` ships `presto-server-1.1.1-linux-x86_64.tar.gz` + `.sha256` (`packages/presto/README.md:158-226`; `gh release view presto-v1.1.1`).
- F6 — Presto logs `Received /prove request` and `Proving succeeded` (`packages/presto/core/src/server/prove.rs:283,475` at `6051b11`).
- F7 — `setForceLocal` exists on `PrestoProver` (`presto-prover.ts:138`), so the lint guard stays.
- F8 — The banner kit: attributes, events, `fonts="none"`, `stateFromStatus` rules, host-overridable `--pb-*` and `:host([variant="card"])` width (`banners/README.md`, `styles.ts`, `status.ts`, `fonts.ts`).
- F9 — Nulo manifest: `host_permissions: ["https://nulo.sh/", "http://127.0.0.1/*"]`, no `connect-src`, shared by both browsers (`apps/extension/manifest/manifest.config.ts:18`).
- F10 — No custom-element config exists (`grep isCustomElement` → 0); `vue()` is called with no options (`apps/extension/vite.config.ts`).
- F11 — `JobProgress` proving arm is `{ stage: "proving"; enteredProveAt }`, documented as extensible without a schema bump (`packages/wallet-core/src/jobs/types.ts:49-53`); `execution-coordinator.ts:196` marks it.
- F12 — `stageSubtitle` is a pure helper with an exhaustiveness pin (`apps/extension/src/utils/card-subtitle.ts`).
- F13 — The only offscreen→SW push primitive is `chrome.runtime.sendMessage` (READY/PONG) (`apps/extension/src/offscreen/index.ts:20,122`).
- F14 — Lockstep literals and their lines: recon.md §Lockstep. `NULO_ACCELERATOR_REQUIRED_BUILD_STAMP` is not in `_build-extension.yml`'s production guard today.
- F15 — Chromium: extensions with host permissions for the target are not subject to the LNA prompt (Chromium engineer, chromium-extensions list; related bug fixed in 144.0.7512). Chrome 145 splits `local-network` / `loopback-network`.
- F16 — Min-age: `presto@5.2.0-revision.2` published 2026-09-08T22:58Z, `presto-core@1.0.1` 2026-09-08T22:29Z, `presto-banners@1.0.0` 2026-09-09T14:48Z (`npm view`); the gate is 7 days; the accelerator exclude in `bunfig.toml` expired 2026-09-02 and is still present.
- F17 — `NULO_E2E_DISABLE_ACCELERATOR` is not set in the repo (`gh variable list`).
- F18 — The soak workflow accepts `mode=files`, `test_files`, `repeats`, `proverless`, `disable_accelerator`, `retry` and calls `_extension-network-e2e.yml` (`extension-network-e2e-soak.yml:15-44,75-91`).

### Inferences (unverified — attack these)

- I1 — `permissions.query({ name: "local-network-access" | "loopback-network" })` is queryable from an extension page in Chrome 142+; if it throws, the composable falls through to the SDK (no regression either way).
- I2 — The published `@alejoamiras/presto` tarball resolves `dist/index.js` the way the accelerator did, so the vite alias is a rename. Verify after install (P1).
- I3 — The journal FSM accepts a same-stage `proving` progress rewrite (or a small `updateProgress` seam is acceptable). Verify in P8 against `packages/wallet-core/src/jobs/fsm.ts`.
- I4 — Firefox 153's LNA applies to `moz-extension://` pages; no exemption statement found. The state machine covers it; nothing Firefox-specific is planned.
- I5 — Presto's HTTPS probe from the offscreen document succeeds once the user completed Presto's certificate setup (Presto installs its CA into the user NSS DB on Linux and the login keychain on macOS). If Chrome's cert store on some platform is not covered, users see `tls-or-trust-failure` with the tray steps — handled, not silent.
- I6 — The `Received /prove request` / `Proving succeeded` literals are unchanged at the `presto-v1.1.1` tag (verified at repo HEAD `6051b11`; P3 re-checks the tag).
- I7 — A `chrome.runtime.sendMessage` from the offscreen reaches the SW while a prove is in flight (the READY handshake proves the channel; the SW may be mid-await on the same prove — `sendMessage` is fire-and-forget so there is no deadlock).

### Asks (owner decisions — resolved at approval)

- A1 — Rename the workflow input `disable_accelerator` → `disable_presto` and the repo var `NULO_E2E_DISABLE_ACCELERATOR` → `NULO_E2E_DISABLE_PRESTO`? **Recommended: yes** (var unset; docs/rollback runbook updated).
- A2 — Route + testids: `/onboarding/accelerator` → `/onboarding/presto`, `onboarding-accelerator-*` → `onboarding-presto-*`? **Recommended: yes** (the page is rebuilt; e2e updated in the same phase).
- A3 — Add Nulo's store extension ID to Presto's `verified-sites.json` (Presto repo, out of scope)? **Recommended: yes, after the ID is known** (no manifest `key` today, so dev builds have unstable IDs).
- A4 — Bundle check: the onboarding bundle grows by `presto-core` (+ `@logtape/logtape`, `ms`). Accept? **Recommended: yes** (small; measured in P5's gate, reported in lessons).

## Phases

Legend: ✓ = validation gate passed and logged in `lessons/phase-N.md`. Every gate includes the fast
layers; commands run from the worktree root unless a `cd` is shown (the tool shell's cwd drifts —
always prefix).

### Arc 1 — runtime + CI swap (`worktree-presto-migration`)

#### P1 — dependencies, gate exemptions, aliases

- Replace the accelerator pin in `packages/aztec-runtime/package.json` and `apps/extension/package.json` with `@alejoamiras/presto@5.2.0-revision.2`; add `@alejoamiras/presto-core@1.0.1` and `@alejoamiras/presto-banners@1.0.0` to `apps/extension`.
- `bunfig.toml`: replace the expired accelerator exclude with three dated entries (`remove on/after 2026-09-16T14:49Z`); record the provenance verification in `lessons/phase-1.md` before installing.
- `bun install` (lockfile regenerates for the new packages only; diff reviewed).
- `vite.config.ts` alias; `renovate.json`; `scripts/aztec-hold-residue-check.ts` root literal.
- **Validation gate**: `bun install --frozen-lockfile` exit 0 after the install; `bun run typecheck:all` exit 0 (expected red on the renamed imports is fixed in P2 — so P1's gate is `bun install --frozen-lockfile` + `bun scripts/aztec-hold-residue-check.ts` exit 0 + `bun run lint` exit 0). Layers: lint, install, residue check.

#### P2 — runtime swap

- `chain-runtime.ts` per §A (types, prover, guard, preflight, `onProvePhase`, error prefix).
- `src/accelerator/` → `src/presto/config.ts` (`PRESTO_HOST`, `PRESTO_PORT`, `PRESTO_HTTPS_PORT`, `PRESTO_REQUIRED`, `PRESTO_REQUIRED_BUILD_STAMP`); `offscreen/index.ts` passes `httpsOnly:false` only under `PRESTO_REQUIRED`; `entry.ts` comments.
- `chain-runtime.test.ts`: renamed mock; new cases — required mode passes `presto.httpsOnly === false`; default mode leaves `httpsOnly` undefined; preflight error names `reason`/`diagnosis` for `permission-blocked` and `secure-connection-unavailable`; guard throws on `secure-connection-unavailable` and `version-mismatch`; `onProvePhase` receives every phase in default mode and never throws.
- **Validation gate**: `bun run --cwd packages/aztec-runtime test` green; `bun run typecheck:all`; `bun run lint`; `bun run test` (extension unit) green; `grep -rn "aztec-accelerator\|AcceleratorProver\|ACCELERATOR_" packages apps --include=*.ts --include=*.vue --include=*.mts` → 0 hits. Layers: unit, typecheck, lint.

#### P3 — CI headless Presto

- `setup-presto-server` action (delete the old one); compute `expected_sha256` by downloading the 1.1.1 tarball, checking the sidecar, extracting, `sha256sum presto-server`; record both hashes in lessons.
- `_extension-network-e2e.yml`, `pr-extension-network-e2e.yml` (paths-filter), `extension-network-e2e-soak.yml`, `nightly.yml`, `_lint-and-typecheck.yml` (comment), `_build-extension.yml` (marker), `agent.sh`; A1 rename if approved.
- Re-verify F6 at the `presto-v1.1.1` tag (`git -C ~/Projects/presto show presto-v1.1.1:packages/presto/core/src/server/prove.rs | grep -n "Received /prove request\|Proving succeeded"`).
- **Validation gate**: `bun run lint:actions` exit 0; `bun run test:ci-gating` green; push the branch, then
  `gh workflow run extension-network-e2e-soak.yml --ref worktree-presto-migration -f mode=files -f test_files="tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/frozen-account-canary.test.ts" -f repeats=1 -f proverless=false` → run green, its log shows `bundle contains NULO_PRESTO_REQUIRED_BUILD_STAMP ✓`, `presto-server` health `bb_available: true`, and the activity step prints `PROVE_SUCCESS` ≥ 1. Layers: actions lint, ci-gating unit, network e2e prover-ON.

#### P4 — docs, skills, residue

- Reword every file in recon.md's docs list; `CI.md` "Presto in CI"; `SECURITY.md` binary-dependency section (license re-confirmed); `UPDATE.md`; both skills; e2e README; codex-notes (fix the stale `packages/extension` path in `05` while there).
- **Validation gate**: `bun run lint` exit 0; `bash scripts/check-no-brand.sh` exit 0; `git grep -in "aztec-accelerator\|accelerator-server" -- . ':!CHANGELOG.md' ':!implementations-plan' ':!audit' ':!bun.lock'` → 0 hits (the word "accelerator" alone may survive only in the A1-rejected case). Layers: lint, grep.

**Arc 1 boundary**: the codex fix loop (Post-implementation §) on arc 1's diff, then `gh stack add presto-migration/ux`.

### Arc 2 — onboarding, settings, subtitle (`presto-migration/ux`)

#### P5 — status client, UI-state mapper, manifest, custom element

- `src/utils/presto-ui-state.ts` (+ ≥ 10-case test: each arm, the `unconfirmed` pitch rule, unknown reason → `error`, `needsDownload`, copy/steps per state).
- `src/composables/usePrestoStatus.ts` (+ ≥ 10-case test with `@alejoamiras/presto-core` mocked: idle → detecting → each state; `forceRefresh` passthrough; LNA short-circuit when `permissions.query` resolves `denied`; throwing `permissions.query` ignored; `dispose` cancels an in-flight probe; `bannerStatus` mirrors the raw status). Delete `useAcceleratorStatus.*`.
- `manifest.config.ts`: add `https://127.0.0.1/*`. `vite.config.ts`: `isCustomElement`.
- **Validation gate**: `bun run test` green (new tests included); `bun run typecheck:all`; `bun run lint`; `bun run build` exit 0 and `ls -la apps/extension/dist/chrome/assets | grep -i onboarding` size recorded in lessons (A4). Layers: unit, typecheck, lint, build.

#### P6 — onboarding `presto.vue`

- Page per §D and the approved artboards; `learn.vue`/`fees.vue` routes; `app.store.ts` + `reset.vue` comments; delete `accelerator.vue`.
- `tests/e2e/onboarding-tab.test.ts`: intercept both `https://127.0.0.1:59834/health` and `http://127.0.0.1:59833/health`; cases: available → Continue; both refused → card banner + Skip; HTTPS refused + HTTP ok with a Presto body → the encrypted-connection card with steps.
- **Validation gate**: `bun run lint` + `bun run typecheck:all`; `cd apps/extension && bun run test:e2e -- tests/e2e/onboarding-tab.test.ts` green; then the full smoke `cd apps/extension && bun run test:e2e` green; manual: `bun run build && send-to-mac apps/extension/dist/chrome`, load unpacked, walk the four states with the real tray app (Encrypted Connection on/off, Presto quit) — screenshots in lessons. Layers: lint, typecheck, smoke e2e, manual.

#### P7 — settings Proving page + index row

- Per §E and the artboards; `data-testid="setting-nav-proving"`, `settings-proving-status`, `settings-proving-retry`, `settings-proving-get`.
- New smoke e2e `tests/e2e/settings-proving.test.ts`: navigate from settings, mocked health for `available` and `offline`, assert the status testid's `data-status` and the Get Presto row visibility.
- **Validation gate**: `bun run lint` + `bun run typecheck:all` + `bun run test`; `cd apps/extension && bun run test:e2e -- tests/e2e/settings-proving.test.ts` green; full smoke green. Layers: lint, typecheck, unit, smoke e2e.

#### P8 — proving backend on the activity card

- `wallet-core` `JobProgress` + fsm test for the widened payload; offscreen `onProvePhase` → `nulo:prover-phase`; coordinator handler; `stageSubtitle(stage, backend)` + test; `RecentActivityView` passes `op.progress?.backend`.
- **Validation gate**: `bun run --cwd packages/wallet-core test` + `bun run test` green; `bun run typecheck:all` + `bun run lint`; network e2e: `cd apps/extension && bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts` (local, proverless or WASM — asserts the awaiting card reaches `data-stage="proving"` and, new, `data-backend` present when known); CI: the P3 soak dispatch repeated on the arc-2 branch with `proverless=false` → green with `PROVE_SUCCESS` ≥ 1. Layers: unit, typecheck, lint, network e2e.

**Arc 2 boundary**: the codex fix loop on arc 2's diff; then the final cross-arc pass.

## Post-implementation (self-contained; executed by the implementing session)

`code_review` is `off`: do NOT run `/code-review`. The codex fix loop is the review.

1. **Per arc, at the boundary** (arc 1 after P4 ✓, arc 2 after P8 ✓), while the arc is the stack
   tip: `/codex high` with — the arc's diff (`git diff <arc-base>..HEAD`), this plan.md and the
   decision ledger, the arc map ("arc 1 of 2: runtime + CI; arc 2 builds the UI on `usePrestoStatus`
   and `onProvePhase`" — so the observer seam and the `presto-core` dependency are not flagged as
   dead), the adversarial/security ask ("What could go wrong? What would an attacker target? What
   are we trusting that we shouldn't? Where are the supply-chain / crypto / least-privilege
   weaknesses?"), and both rules below verbatim.
2. **Iterative fix loop**: verify each codex claim against the repo first; apply accepted fixes;
   commit; log the round (consult + verdict) in `lessons/post-impl-arc-N.md`; RESUME the same codex
   session with the fix diff for a re-review. Repeat until a round yields no new material findings.
   Still material after 3 rounds → stop and surface to the owner (scope smell).
3. **Final cross-arc pass** after both arcs looped: a FRESH `/codex high` session over the net diff
   from `origin/dev @ 323380f6`, asking for cross-arc issues (seams between arcs, duplication across
   arcs, drift from this plan), same loop until clean.
4. **Delivery** per the Delivery section — the first time any PR is opened.

**The no-over-engineering rule** (verbatim in every post-impl codex prompt): *"Report bugs and
small, targeted improvements only. Do not propose speculative abstractions, extra configuration
surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works
and is clear, leave it alone."*

**The comment-quality rule** (verbatim in every post-impl codex prompt): *"Audit the comments for
value per character. Flag any comment that narrates what the code visibly does, restates its line,
references implementation plans / phases / reviews, or spends a paragraph where a sentence works —
and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have.
Comments are permanent context every future reader, human or LLM, pays to re-read: they must be
few, dense, and exact."*

## Delivery

Two arcs, two stacked PRs into `dev` via `gh stack` (`gh extension list` confirms; install
`github/gh-stack` if missing):

| Arc | Phases | Branch | Stacks on | code_review |
|---|---|---|---|---|
| 1 — runtime + CI swap | P1–P4 | `worktree-presto-migration` (`gh stack init --adopt worktree-presto-migration --base dev`) | `dev` | off |
| 2 — onboarding, settings, subtitle | P5–P8 | `presto-migration/ux` (`gh stack add presto-migration/ux` after arc 1's loop) | arc 1 | off |

- Push branches for checkpointing (`gh stack push`); no PR before the loops converge.
- Publish: `gh stack sync` if `dev` moved, `gh stack submit --auto`, then `gh pr edit` each PR with a
  body (title ≤ 93 chars, Conventional Commits: `feat(proving): migrate to presto …`,
  `feat(onboarding): presto states, settings proving page …`), `gh pr checks --watch`.
- Arc 1's PR touches `bun.lock` and workflow files → smoke + network e2e run on it; that is the
  intended gate. Arc 2 touches the smoke surface.
- A follow-up PR after 2026-09-16T14:49Z removes the three `minimumReleaseAgeExcludes` entries.
- `gh stack merge` is the owner's call. Then `implementations-plan/index.md` gets the completed
  marker and `agent-worktree done presto-migration` is suggested.

## Autonomy

AFK rules per AGENTS.md: commit eagerly (signing stays on — homelab's key is passphrase-less), push
feature branches only after the arc's gate passes, consult `/codex high` on any fork, never merge,
never publish, never widen scope past this file. A red `presto-server` health in CI is investigated
(download URL, sidecar, `bb` download on first prove), never neutralized.

## Audit verdicts

_(filled during the dual audit and the final pass)_

### Decision ledger

_(filled after the dual audit: chosen outline, rejected alternatives with reasons, open disputes)_

## Seeds

DRAFT until the approval gate; finalized post-approval and mirrored in the ELI5 Artifact.

```
/goal All eight phases marked ✓ in implementations-plan/presto-migration/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript, including the P3 and P8 soak dispatches green with PROVE_SUCCESS ≥ 1; for each phase the agent has printed `LESSONS_FILE=implementations-plan/presto-migration/lessons/phase-N.md`; `/code-review` was NOT run (code_review is off); the codex fix loop converged for arc 1 at its boundary, for arc 2 at its boundary, and for the final cross-arc pass — each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the two stacked PRs exist on GitHub, created only after all loops converged (`gh stack view` output in the transcript); `bun run audit:vue` and `bun run lint:actions` both report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/presto-migration forward. Never idle waiting for my input. Each firing:
1. **Reality check**: read implementations-plan/presto-migration/plan.md and lessons/ (authoritative state — not the chat); native task list empty (fresh session)? rebuild it from plan.md, one task per remaining phase and loop; run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup` (no --watch; `gh stack view` for the stack). Without a PR, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **Waiting on CI is fine** — confirm it's progressing (`gh run watch <run-id>` up to 10 minutes; stuck past that → inspect logs, log it as blocked in lessons). Use the wait productively: review the diff, prep the next phase, strengthen tests. Don't start work that would conflict with the in-flight change.
3. **No task in hand?** Pick the next pending phase from plan.md and start it. After each meaningful edit run `bun run lint` + `bun run typecheck:all` + the touched package's `test` — catch mistakes in-step. Then commit → `gh stack push` (`gh stack sync` if dev or arc 1 moved).
4. **Stuck, or facing a decision you'd normally bring to me?** Don't wait. Call `/codex high` with full context and go back and forth until you two reach a defensible decision, then act on it. Log every consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge to dev/main, never publish or deploy, never change anything in the Presto repo, never expand scope beyond plan.md; if a decision requires crossing one, surface it and hold.
5. **Same step failed 5 times?** Stop retrying; reassess with codex, then continue down the agreed path.
6. **Phase green?** "Green" means THE PHASE'S VALIDATION GATE as written in plan.md passes (commands + pass criteria). Run the full gate, paste the result, mark ✓ in plan.md, file the lessons entry, print `LESSONS_FILE=implementations-plan/presto-migration/lessons/phase-N.md`, `agent-worktree status presto-migration "phase N green: <next>"`, advance. Arc boundary crossed (after P4, after P8)? Run the arc's codex loop FIRST (code_review is off — no /code-review): `/codex high` with the arc diff, the arc map, plan.md + ledger, the adversarial ask and the plan's no-over-engineering + comment-quality rules, resume until a round yields nothing material — THEN `gh stack add presto-migration/ux` (after arc 1) or proceed to step 7 (after arc 2).
7. **All phases ✓?** Final cross-arc pass: FRESH `/codex high` over the net diff from origin/dev @ 323380f6 + cross-arc ask + both rules, loop until clean. Then Delivery per plan.md — the FIRST time any PR is opened: `gh stack sync`, `gh stack submit --auto`, `gh pr edit` bodies, `gh pr checks --watch`. Then the wrap-up report: what shipped, every contentious decision codex and I debated with ELI5 context, open items (the min-age exclude removal PR after 2026-09-16T14:49Z; Ask A3 in the Presto repo). Surface and stop.

Keep the native task list current (`TaskUpdate` as steps start/finish; plan.md stays the source of truth).
```
