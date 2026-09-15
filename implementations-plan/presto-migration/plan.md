---
plan: presto-migration
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
codex_effort: high
recon_budget: 2 agents (batched reuse sweep + CI/e2e mapper), default
status: draft v3 — dual audit folded (v2); fresh-context codex pass r1 on v2 = reject → folded (v3); fresh-context pass r2 pending, then the approval gate
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
2. **Make the wallet know where each proof ran** — a correlated prove-phase event from the offscreen
   document to the service worker, persisted on the operation journal, rendered as the activity
   subtitle ("Proving with Presto ✦" / "Proving in browser…"), plus a remembered "last prove
   outcome" so a Presto denial is visible instead of silent.
3. **Rebuild the onboarding "Speed" step and add Settings → Proving on Presto's states** — the
   owner-approved card banner (Presto's `<presto-banner variant="card">` re-tokened to Nulo) as the
   install pitch, and Nulo's status card for every other state with per-state recovery steps,
   including the Local Network Access (LNA) denial and the encrypted-connection failure the old page
   could not express.

## Owner answers (Phase 0, 2026-09-14/15)

- **Scope**: runtime + CI swap; onboarding rework; a runtime proving-status surface. NOT the
  playground/tools dApps (they never used the accelerator).
- **Banners**: embed `<presto-banner>` as-is (Option B: Nulo tokens via `--pb-*`, `fonts="none"`).
  No banner anywhere in the popup — the owner rejected the dock. The Presto subtitle in the
  activity card is plain secondary text, not green.
- **LNA depth**: the full state machine — distinct copy and recovery per state, Retry with
  `forceRefresh`. (The `permissions.query` probe is the SDK's own — v1 planned a page-side
  duplicate; both audits had it dropped.)
- **`code_review: off`**; codex at `high`; no `/harden` scheduled (fold Presto threats into the
  2026-09-13 audit's remediation via this plan's Security section).
- **Validation layers**: fast layers on every phase; smoke e2e on the UI phases; the network e2e
  canary with the headless Presto server prover-ON; a manual check on the Mac with the real tray
  app (`send-to-mac`).
- **Min-age gate**: temporary first-party excludes, only for the Presto packages still inside the
  7-day window at install time, dated, removed in a follow-up PR after 2026-09-16T14:49Z.

## Scope

**In**

- `@alejoamiras/aztec-accelerator@5.2.0` → `@alejoamiras/presto@5.2.0-revision.2` in
  `packages/aztec-runtime` and `apps/extension`; `@alejoamiras/presto-core@1.0.1` and
  `@alejoamiras/presto-banners@1.0.0` in `apps/extension`.
- `chain-runtime.ts`: `PrestoProver`; production passes `httpsOnly: true` explicitly; plaintext is
  derived from `provingMode === "required"` inside the factory (no separate option exists); the
  preflight names the new unavailable arms; the required-mode `onPhase` guard also throws on
  `secure-connection-unavailable` and `version-mismatch`; a per-runtime observer for the phase
  event, isolated from proving.
- Manifest: `https://127.0.0.1/*` host permission added in the same phase as the HTTPS switch
  (keep `http://127.0.0.1/*`).
- CI: `setup-presto-server` action (tarball + binary pinned, single-member extraction),
  `_extension-network-e2e.yml` start/health/assert/teardown on `presto-server 1.1.1`,
  `VITE_NULO_PRESTO_REQUIRED`, the production negative-grep gains the new stamp, `agent.sh` in
  lockstep.
- Prove-phase correlation: `proveId` through the `proveTx` RPC; `PxeService` typed `provePhase`
  event `{ profileId, chainId, proveId, phase }` validated on receipt; SW-side sender gate that
  understands Firefox's `?instance=` offscreen URL; journal `updateProvingBackend` seam under the
  transition lock + the Zod schema; `stageSubtitle(stage, backend)` rendered ahead of the task
  label; `lastProveOutcome` + a separately held `lastDenial` in SW memory exposed by an
  `ExecutionService` RPC.
- Arc 1 keeps the *old* onboarding page transport-honest until arc 2 replaces it: its composable
  probes through `presto-core`'s client (HTTPS-first, like production) instead of a bare HTTP
  `/health`, and the download link points at Presto. Copy, layout and testids stay; only the truth
  changes.
- `usePrestoStatus` on `presto-core`'s `PrestoClient` (injected, shared per page context),
  `presto-ui-state.ts` wrapping the banner kit's `stateFromStatus`.
- Onboarding page `presto.vue` (route `/onboarding/presto`, testids `onboarding-presto-*`) per the
  approved artboards; `learn.vue` / `fees.vue` links; e2e updated in lockstep.
- Settings → App → Proving row + `settings/proving.vue` per the approved artboards, including the
  denied-approval state from `lastProveOutcome`.
- Docs/skills reworded; `bunfig.toml` excludes; `renovate.json`; residue check; vite alias (if
  still needed after install); a lockstep test pinning `__AZTEC_VERSION__` to the SDK's Aztec pin.

**Out**

- Any Presto-side change (verified-sites entry for the extension ID, headless HTTPS). Surfaced as
  Asks, done in the Presto repo if the owner wants them.
- A persisted "prefer native proving" toggle. Presto is auto-detected; no setting exists today and
  none is added.
- Session-only HTTP consent (`httpsOnly:false` + `allowInsecureDowngrade`) for end users. Presto's
  guidance is to require an informed confirmation and never persist it; the wallet does not offer
  plaintext proving at all — the encrypted-connection recovery is the only path.
- Firefox-specific LNA / optional-permission work beyond the shared state machine (Ask A6).
- Renaming the feature-level `disable_accelerator` input / `NULO_E2E_DISABLE_ACCELERATOR` var
  (Ask A1 decides; the default is to rename since the var is unset).

## Architecture & Implementation

### Shape

```
apps/extension
  src/presto/config.ts                 PRESTO_HOST/PORT/HTTPS_PORT, PRESTO_REQUIRED, PRESTO_REQUIRED_BUILD_STAMP
  src/offscreen/index.ts               provePhaseSink → ProductionPxeFactory({ provingMode, onProvePhase: sink.emit }); createPxeOffscreen({ …, provePhaseSink })
  src/composables/usePrestoStatus.ts   (client = getPrestoClient()) → PrestoUiState; detect({forceRefresh}); bannerStatus
  src/utils/presto-ui-state.ts         pure: wraps banners' stateFromStatus → PrestoUiState + copy + steps (unit-tested)
  src/utils/card-subtitle.ts           stageSubtitle(stage, backend)
  src/onboarding/pages/presto.vue      card banner (offline) | status card (every other state)
  src/popup/pages/settings/proving.vue status card + Details + link rows; reads lastProveOutcome
  src/wallet/services/execution/execution-coordinator.ts   proveId per attempt; Map<proveId, journalId>; provePhase → journal backend + lastProveOutcome/lastDenial
  src/wallet/services/execution/{spec,service,client}.ts    getLastProveOutcome RPC
  src/wallet/services/operation-journal/{service,spec}.ts   updateProvingBackend seam; Zod proving schema gains backend
  src/wallet/services/pxe/client.ts    proveTx(…, proveId) passthrough (the shallow port is untouched — it excludes proving)
  src/onboarding/composables/useAcceleratorStatus.ts   arc-1 shim over PrestoClient (deleted in P7)
packages/aztec-runtime
  src/pxe/chain-runtime.ts             PrestoProver; PrestoEndpoint {host, port, httpsPort?}; per-runtime onPhase → observer({...runtime.activeProve, phase}); ChainRuntime.activeProve
  src/pxe/service.ts                   PxeService<Methods, PxeEvents>: proveTx(network, req, scopes, proveId?) sets runtime.activeProve inside the write lock; subscribes the sink → sendEvent("provePhase")
  src/pxe/client.ts                    PxeServiceClientBase<Methods, PxeEvents>; src/offscreen/entry.ts accepts the sink
  src/pxe/{spec,ipxe}.ts               proveId on the RPC / port
packages/extension-messaging
  src/offscreen/client.ts              event listener gains a sender gate (isTrustedInternalSender + offscreen page path, query ignored)
packages/wallet-core
  src/jobs/types.ts                    JobProgress proving stage: backend?: "presto" | "browser"
.github/actions/setup-presto-server/action.yml
.github/workflows/_extension-network-e2e.yml, _build-extension.yml, pr-/soak/nightly plumbing
```

Two bundles, two clients, one vocabulary, one truth channel:

- The **offscreen document** keeps the heavy SDK (`@alejoamiras/presto` → `PrestoProver`), exactly
  where `AcceleratorProver` lived. Nothing else imports it. It is the only place that knows where a
  proof actually ran, so it reports that — correlated per attempt — to the service worker.
- **Pages** (onboarding, popup) use `@alejoamiras/presto-core`'s `PrestoClient` — a
  dependency-light HTTP client that returns the same `PrestoStatus` the prover sees, including the
  LNA and HTTPS arms. The onboarding bundle stays free of `@aztec/*`.
- A pure mapper `presto-ui-state.ts` wraps the banner kit's `stateFromStatus` (one source for the
  `unconfirmed → offline` rule) and adds Nulo's copy and recovery steps.

### A — runtime swap (`packages/aztec-runtime/src/pxe/chain-runtime.ts`)

```ts
import { PrestoProver, type PrestoPhase } from "@alejoamiras/presto"

export interface PrestoEndpoint { host?: string; port?: number; httpsPort?: number }
export interface ActiveProve { proveId: string; profileId: string; chainId: number }
export interface ProvePhaseEvent extends ActiveProve { phase: PrestoPhase }
export type ProvePhaseObserver = (event: ProvePhaseEvent) => void
export type ProductionPxeFactoryOptions =
	| (PrestoEndpoint & { provingMode?: "default"; onProvePhase?: ProvePhaseObserver })
	| (PrestoEndpoint & { provingMode: "required"; onProvePhase?: ProvePhaseObserver })
	| (PrestoEndpoint & { provingMode: "proverless" })
```

- `default` mode: `new PrestoProver({ simulator, presto: { host, port, httpsPort, httpsOnly: true }, onPhase })`.
  `httpsOnly: true` is passed **explicitly** so neither the SDK's runtime detection nor a stray
  `PRESTO_HTTPS_ONLY` env can widen production to plaintext. The SDK's silent WASM fallback is
  preserved for end users.
- `required` mode (CI): the factory derives `httpsOnly: false` from the mode itself (the headless
  server is HTTP-only) — there is no independent option to set wrongly; the guard throws on `fallback | denied | secure-connection-unavailable |
  version-mismatch` (the last two precede `fallback`; throwing on them is redundant but yields the
  precise reason — the test says so), warns on `downloading`. The preflight `checkPrestoStatus()`
  fails with the arm spelled out: `[presto-required] presto-server unavailable: reason=<reason>
  diagnosis=<diagnosis?>`.
- `proverless`: unchanged.
- **Observer isolation.** `onPhase` runs the required guard first (may throw — that is its job),
  then the observer inside `try/catch` with the error logged: a broken observer can never abort or
  alter a proof. The observer receives `{ ...runtime.activeProve, phase }` and is skipped when
  `activeProve` is unset (a phase outside a correlated attempt is not reportable) — the prover is
  per `ChainRuntime`, so the closure is bound per runtime and cannot mix profiles or chains.
- `ChainRuntime` gains `activeProve: ActiveProve | undefined`, set and cleared only by `PxeService`
  inside the `proveTx` write lock (§F).
- The `[accelerator-required]` prefix becomes `[presto-required]`; the env name inside the error
  text becomes `VITE_NULO_PRESTO_REQUIRED`.

### B — CI headless prover

- `.github/actions/setup-presto-server/action.yml`: inputs `version` (default `"1.1.1"`),
  `expected_tarball_sha256` and `expected_sha256` (both required; the second is the SHA-256 of the
  **extracted** `presto-server` binary, re-verified on every run including cache hits). URL
  `https://github.com/alejoamiras/presto/releases/download/presto-v${VER}/presto-server-${VER}-linux-x86_64.tar.gz`.
  Order: download → verify the tarball against the repo pin (the upstream `.sha256` sidecar is
  downloaded and compared too, but it shares the tarball's origin and only catches transfer
  corruption — the action comment says so) → list the archive and require **exactly one** member
  named `presto-server`, a regular file (`tar -tvf` type `-`; any link, duplicate or extra entry
  fails the step) → extract only that member into the tool dir → verify the binary → `chmod +x`.
  The cache stores that single file; on a cache hit any other restored entry fails the step before
  the directory joins `PATH`. Cache key `${{ runner.os }}-presto-server-${version}-${expected_sha256}`.
- `_extension-network-e2e.yml`: `PRESTO_ALLOW_ALL=1` and `RUST_LOG=info` are set **on the server
  process only** (`env` of the start step's shell line), never at job level; start
  `nohup presto-server > /tmp/presto-server.log`; health poll unchanged
  (`http://127.0.0.1:59833/health`, `.bb_available == true` — headless allow-all serves the
  detailed body); activity greps unchanged (`Received /prove request`, `Proving succeeded` —
  verified identical at the `presto-v1.1.1` tag, `core/src/server/prove.rs:283,475`); teardown
  `pkill -TERM presto-server`; artifact paths renamed. `VITE_NULO_PRESTO_REQUIRED` keeps the exact
  short-circuit expression shape. Never seed `BB_BINARY_PATH` (same rule; re-verify Presto's
  `find_bb` and drop the accelerator issue link).
- `_build-extension.yml` production guard: add `NULO_PRESTO_REQUIRED_BUILD_STAMP` to the marker
  list, so a build carrying the required arm can never ship.
- `agent.sh`: rename the env var and the grep literal; `NULO_E2E_PROVERLESS` and
  `VITE_NULO_PRESTO_REQUIRED` stay mutually exclusive.
- **Gate semantics, stated once.** The soak workflow passes `shard_label: soak-N`, so the
  workflow-level `PROVE_SUCCESS ≥ 1` assertion is *printed* there and enforced only on the PR
  workflow's `canary` shard (aggregator `extension-network-e2e-status`). Therefore the tests
  themselves carry the native assertions: when the build is stamped `VITE_NULO_PRESTO_REQUIRED`,
  `tx-sendTx-default.test.ts` asserts `data-backend="presto"` and the exact subtitle regardless of
  shard label, so a soak dispatch is a real gate for the subtitle and the PR canary remains the
  gate for the log-count. A phase that cites the soak quotes both.

### C — status client + UI state (`usePrestoStatus`, `presto-ui-state.ts`)

```ts
import { stateFromStatus, type BannerState } from "@alejoamiras/presto-banners"
export type PrestoUiState =
	| { kind: "detecting" }
	| { kind: BannerState; diagnosis?: SecureConnectionDiagnosis; info?: PrestoInfo }  // offline | permission-blocked | secure-connection-unavailable | version-mismatch | error | downloading | available
export interface PrestoInfo { appVersion?: string; nativeAztecVersion?: string; protocol?: "http" | "https" }
export function uiStateFromStatus(status: PrestoStatus): PrestoUiState   // kind = stateFromStatus(status); keeps diagnosis + info
export function copyFor(state: PrestoUiState, lastOutcome?: LastProveOutcome): { title: string; detail: string; steps?: string[]; retry?: "Test" | "Retry" | "Re-test" }
```

- `usePrestoStatus(client: PrestoStatusClient = getPrestoClient(), { autoDetect })` — C1 shape: the
  client is injected (tests pass a fake; no `vi.mock`). `getPrestoClient()` is a module-level
  memoized factory (`new PrestoClient({ aztecVersion: __AZTEC_VERSION__ })`), so every consumer in
  one page context (settings index row + proving page) shares the SDK's 10 s cache. Exposes `state`,
  `detect({ forceRefresh })`, `bannerStatus` (the raw `PrestoStatus`, fed to `banner.status`), and
  `dispose()` — which cannot abort a probe (`PrestoClient` has no abort API); it drops a late
  result. Lives in `src/composables/` (auto-imported in both shells).
- **No page-side LNA probe.** The SDK transport already queries `loopback-network` then
  `local-network-access` after a failed request and reports `permission-blocked`; a pre-probe
  short-circuit would diverge from the client's cache and can report blocked while a host-permitted
  request succeeds.
- **Health tiering shapes the copy.** `/health` serves the detailed body only to absent or approved
  origins; an unapproved `chrome-extension://` origin gets the minimal body. Until the user approves
  Nulo at the first prove: `needsDownload` is always `false` (so `downloading` is reachable only
  after approval), `appVersion`/`nativeAztecVersion` are absent (Details rows render `—`), and the
  HTTP diagnostic can only yield `presto-reachable`. Therefore `presto-reachable` is the *primary*
  `secure-connection-unavailable` arm in copy ("Presto is running but the encrypted connection
  isn't reachable"), with `https-disabled` / `tls-or-trust-failure` as the more specific variants
  when the body allows them. "Not installed" is `secure-connection-unavailable` + `unconfirmed`
  (the SDK cannot tell an uninstalled Presto from a dismissed prompt under HTTPS-only — the copy says
  "not detected", never "not installed").
- Copy is Presto's canonical `STRINGS` where a state has one, extended with Nulo's numbered
  recovery steps (approved artboards).

### D — onboarding `presto.vue`

- `offline` → `<presto-banner variant="card" fonts="none" theme="{{ nulo theme }}" href="https://presto.build">`
  inside a wrapper that sets the `--pb-*` overrides and `width: 100%` (host styles beat `:host`).
  `banner.status = bannerStatus` after each detect (the banner renders nothing until set — no flash
  of the pitch for installed users). Events: `presto-banner:retry` → `detect({forceRefresh:true})`;
  `presto-banner:dismiss` → the page's Skip; `presto-banner:cta` left default (anchor,
  `rel="noopener"`). On mount call `clearDismissal("presto:banner:card:offline")` so a dismissal
  persisted in the extension page's localStorage (7 days; `reset.vue` clears `chrome.storage`, not
  localStorage) never hides the pitch from a re-onboarding user. Below it: "Installed it already?
  Test again" and the Skip link.
- Every other state → Nulo's status card (`copyFor`), steps block for the warn states, Retry inside
  the card, Continue only on `available` / `downloading`, Skip otherwise.
- Copy timing: Presto's approval prompt appears at the **first prove**, not during onboarding. The
  `available` card says "Presto will ask you to allow Nulo the first time you send" — the
  onboarding never claims the prompt happens now.
- The Windows note is deleted (Presto ships Windows). The `os` attribute is left to the banner's
  user-agent detection.
- Vue: `vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("presto-") } } })`
  in `vite.config.ts`; `import "@alejoamiras/presto-banners/register"` in the page's script.
- Theme: the banner's `theme` attribute follows the `<html theme>` attribute onboarding already
  sets (`app.vue` `applyTheme`), so light mode gets the light `--pb-*` overrides.

### E — settings `proving.vue` + index row

- `settings/index.vue` App group gains `SettingItem to="/popup/settings/proving" title="Proving"
  materialIcon="speed" data-testid="setting-nav-proving"` with a live description from the same
  composable plus `lastProveOutcome`: `Presto · connected` / `Presto · approval needed` /
  `In browser · Presto not detected` / `Browser blocked local access` / `Presto · encrypted
  connection off` (`autoDetect` on mount, cached 10 s).
- `proving.vue`: `SettingsPageShell title="Proving" backTo="/popup/settings"`; compact status card
  (title, detail, steps, Retry); `ItemsContainer "Details"` (Presto app version, Aztec runtime,
  Connection = `Encrypted` / `Plain HTTP` / `Blocked` / `—`; every row degrades to `—` on the
  minimal health body); a `SettingItem external` "Get Presto" row only when `offline`; the explainer
  line. Route meta `isAuthRequired: true`. The page owns an `ExecutionServiceClient` (L6 may) and
  reads `getLastProveOutcome()` on mount.
- **Denied surface.** When health is `available` but `lastDenial` is set (Presto's per-origin
  prompt declined or auto-denied after 60 s; 30 s cooldown before it re-prompts), the card reads "Presto declined Nulo" with the steps "Open Presto → Sites → allow Nulo, then send
  again". Retry re-checks health only and the detail says so ("approval is confirmed by your next
  transaction").

### F — the proving backend on the activity card (runtime truth, arc 1)

- **Journal.** `wallet-core` `JobProgress`: `{ stage: "proving"; enteredProveAt: number; backend?: "presto" | "browser" }`,
  and the Zod proving schema at `operation-journal/spec.ts:184` gains `backend` (persistence and RPC
  round-trip tests, or parsed records silently drop it). The FSM rejects `proving → proving`, so the
  journal gets one narrow seam: `updateProvingBackend(opId, backend)` runs under `transitionLock`,
  applies only when the op's current stage is `proving`, preserves `enteredProveAt`, and is a no-op
  (logged at debug) otherwise — late events after completion/cancellation cannot resurrect a stage.
- **Correlation.** `ProveAndSendContext` gains `journalId` (the executors already hold the
  `queuedJournalId` they bind into `markJournal`; `execution-lane.ts` passes it through when it
  builds the context). `execution-coordinator.proveTxTask` mints `proveId = crypto.randomUUID()` per
  attempt, records `proveId → journalId` in a coordinator-owned `Map` **before** dispatch, calls
  `pxe.proveTx(txRequest, scopes, proveId)` (new optional trailing param on `IPXE`,
  `PxeServiceClientBase`, and the `spec.ts` method; the shallow port is untouched because it
  excludes proving by design), and deletes the entry in `finally`. Locks are per
  `(profileId, chainId)` and the SW marks `proving` before the offscreen lock, so two ops can be
  `proving` on one chain — only the mapped `proveId` attributes an event, never the chain.
- **Offscreen wiring.** `offscreen/index.ts` creates a two-function sink
  (`{ emit, subscribe }`), passes `onProvePhase: sink.emit` to the factory and `provePhaseSink` to
  `createPxeOffscreen` (new dep; `entry.ts` hands it to `PxeService`). `PxeService` declares
  `PxeEvents = { provePhase: ProvePhaseEvent }`, subscribes the sink and forwards each event with
  `sendEvent`. Inside the `proveTx` write lock it sets `runtime.activeProve = { proveId, profileId,
  chainId }` (all three known there: the lock key is the profile/chain pair) before `pxe.proveTx`
  and clears it in `finally`; the runtime's observer (§A) reads that record, so the event already
  carries its coordinates. `sendEvent` swallows a dead-SW rejection; the observer is wrapped per §A.
- **SW receiving gate.** `packages/extension-messaging/src/offscreen/client.ts` today filters events
  by `message.from === this.service` and never reads `sender`. The listener gains the `sender`
  argument and drops any event failing `isTrustedInternalSender(sender)` or whose `sender.url`,
  parsed, does not have the origin and pathname of `chrome.runtime.getURL("src/offscreen/index.html")`
  — the query is ignored because Firefox opens the page as `…/index.html?instance=<token>`
  (`wallet/utils/offscreen.ts:279`); a stale Firefox instance is already excluded by the
  `from`/service handshake and is not this gate's job. The content script (`*://*/*`, all frames)
  shares `sender.id` and must not be able to spoof a phase. The coordinator validates the payload
  with a Zod schema (`proveId` uuid, `profileId` string, `chainId` number, `phase` enum) before
  use — TypeScript types validate nothing at runtime. Unit tests: content-script-shaped sender
  dropped; Chrome URL accepted; Firefox URL with `?instance=` accepted; malformed payload dropped.
- **Coordinator handler.** `PxeServiceClient.on("provePhase")` → `Map` lookup by `proveId`
  (unknown or deleted → ignore) → apply **across the whole attempt**, not first-wins: `transmit →
  backend: "presto"`; `fallback | denied → backend: "browser"`; `proved` changes nothing about
  the backend (it neither identifies it nor ends the op). Two memory records: `lastProveOutcome =
  { at, phase, backend? }` updated on every phase (a hint), and `lastDenial: { at } | null` set on
  `denied` and cleared **only** when a `proved` arrives for an attempt whose backend is `presto`
  (native success proves the approval) — the SDK's post-denial sequence is `denied → fallback →
  proving → proved → receive`, so an every-phase record would erase the denial within a second.
  Journal updates are serialised by the seam's `transitionLock`; an event that arrives after the RPC
  returned is a no-op by stage. Event loss is tolerated by design: the subtitle stays generic and
  nothing else depends on the channel. Tests: `transmit → fallback` ends as `browser`; a late
  `transmit` after the op left `proving` is a no-op; a deleted attempt's events are ignored; two
  profiles proving on one chain attribute independently; a throwing observer does not fail the
  prove; `denied → fallback → proving → proved → receive` leaves `lastDenial` set; `transmit →
  proving → proved` clears it; an event delivered after `proveTx` resolved is harmless.
- **Subtitle.** `stageSubtitle(stage, backend)`: `proving` → `"Proving with Presto ✦"` /
  `"Proving in browser…"` / `"Generating proof..."` when unknown. In `RecentActivityView`'s
  `cardSubtitleFor`, a `proving` stage with a known backend is returned **before** the executing
  task's label (today the task label "Generating proof..." wins whenever the task matches, which
  is the ordinary single-op case); the card stamps `data-backend`. `card-subtitle.test.ts`
  exhaustiveness pin extended; a component test pins the priority.
- **`getLastProveOutcome()`** RPC on `ExecutionService` (spec + service + client) returns
  `{ outcome, denial }` from SW memory (both reset on SW restart — acceptable; they are hints, the
  journal is the record).

### Data & control flow (critical paths)

1. **Prove (production)**: SW `execution-coordinator` marks `proving`, mints `proveId`, maps it to
   the journal id → offscreen `PxeService.proveTx(…, proveId)` sets `activeProve` inside the write lock →
   `PrestoProver.proveTx` → `detect` (HTTPS probe `https://127.0.0.1:59834/health`; on failure one
   witness-free HTTP `GET /health` for diagnosis) → `transmit`/`proving`/`proved` OR
   `denied`/`secure-connection-unavailable`/`fallback` → WASM. Each phase → observer → `provePhase`
   event → SW gate + payload schema → map → `updateProvingBackend` + `lastProveOutcome`/`lastDenial` → subtitle.
2. **Prove (CI required)**: same, with `httpsOnly:false` → dual probe prefers HTTPS, uses HTTP
   `59833`; the guard throws on any fallback-class phase; the workflow asserts `Proving succeeded`
   count > 0 on the canary lane.
3. **Onboarding detect**: mount → `clearDismissal` → `client.checkStatus()` → `uiStateFromStatus` →
   card banner or status card. Retry → `checkStatus({forceRefresh:true})`.
4. **Settings detect**: identical composable (shared client) + `getLastProveOutcome()`; Details rows
   read `info`.

### Interfaces (new / changed)

- `@nulo/aztec-runtime`: `PrestoEndpoint`, `ActiveProve`, `ProvePhaseEvent`, `ProvePhaseObserver`,
  `ProductionPxeFactoryOptions` (above); `ChainRuntime.activeProve`; `PxeService<Methods, PxeEvents>`
  and `PxeServiceClientBase<Methods, PxeEvents>` with `provePhase`; `createPxeOffscreen(deps)` takes
  `provePhaseSink`; `proveTx(network, txRequest, scopes, proveId?)` on the spec, `IPXE`, the client
  base. `AcceleratorEndpoint` removed (no deprecated alias — one consumer).
- `@nulo/extension-messaging`: `OffscreenClient` event sender gate (behavioural, no signature change).
- `@nulo/wallet-core/jobs`: `JobProgress` proving arm gains `backend?`.
- `apps/extension`: `PrestoUiState`, `PrestoInfo`, `uiStateFromStatus`, `copyFor`, `usePrestoStatus`,
  `getPrestoClient`; journal `updateProvingBackend`; `ProveAndSendContext.journalId`;
  `ExecutionService.getLastProveOutcome`.

### File-level change map

Added: `src/presto/config.ts` (renamed from `src/accelerator/config.ts`),
`src/composables/usePrestoStatus.ts` (+test), `src/utils/presto-ui-state.ts` (+test),
`src/onboarding/pages/presto.vue`, `src/popup/pages/settings/proving.vue`,
`.github/actions/setup-presto-server/action.yml`, `tests/e2e/settings-proving.test.ts` (smoke),
`packages/aztec-runtime/src/pxe/presto-version-lockstep.test.ts`,
`packages/aztec-runtime/src/pxe/presto-policy.test.ts` (production policy: no HTTP `/prove`, ever).

Modified: `packages/aztec-runtime/{package.json, src/pxe/chain-runtime.ts (+test), service.ts (+test), spec.ts, ipxe.ts, client.ts, src/offscreen/entry.ts}`,
`packages/extension-messaging/src/offscreen/client.ts` (+test),
`packages/wallet-core/src/jobs/types.ts` (+fsm test), `apps/extension/{package.json, vite.config.ts, manifest/manifest.config.ts, scripts/e2e/agent.sh}`,
`src/offscreen/index.ts`, `src/wallet/services/execution/{execution-coordinator.ts, execution-lane.ts, spec.ts, service.ts, client.ts}` (+tests),
`src/wallet/services/operation-journal/{service.ts, spec.ts}` (+tests), `src/wallet/services/pxe/client.ts`,
`src/utils/card-subtitle.ts` (+test), `src/popup/components/modules/general/RecentActivityView.vue`,
`src/popup/pages/settings/index.vue`, `src/onboarding/pages/{learn,fees}.vue`,
`src/onboarding/composables/useAcceleratorStatus.ts` + `src/onboarding/pages/accelerator.vue` (arc-1 shim in P2: probe via `PrestoClient`, Presto link + copy, testids kept; both deleted in P7),
`src/stores/app.store.ts` (comment), `src/popup/pages/settings/security/reset.vue` (comment),
`tests/e2e/onboarding-tab.test.ts`, `tests/e2e/network/tx-sendTx-default.test.ts` (backend assert),
`.github/workflows/{_extension-network-e2e,_build-extension,pr-extension-network-e2e,extension-network-e2e-soak,nightly,_lint-and-typecheck}.yml`,
`.github/README.md`, `bunfig.toml`, `renovate.json`, `scripts/aztec-hold-residue-check.ts`,
`CLAUDE.md`, `CI.md`, `SECURITY.md`, `UPDATE.md`, `ARCHITECTURE.md` (prove-phase event, one paragraph),
`.claude/skills/{aztec-update,e2e-testing}/SKILL.md`, `apps/extension/tests/e2e/README.md`,
`architecture/codex-notes/{05-pxe-integration,10-build-and-manifest}.md`.

Deleted: `src/accelerator/`, `src/onboarding/composables/useAcceleratorStatus.{ts,test.ts}`,
`src/onboarding/pages/accelerator.vue`, `.github/actions/setup-accelerator-server/`.

### Algorithms / non-obvious mechanics

- **Uninstalled ≠ offline under HTTPS-only.** Both probes fail; the SDK reports
  `secure-connection-unavailable` + `unconfirmed`. `stateFromStatus` maps exactly that pair to
  `offline` (the install pitch); every other diagnosis means Presto is present and HTTPS needs
  fixing. A reason the kit does not know maps to `error`, never to the pitch.
- **LNA in an extension.** Chrome does not prompt extension pages that hold host permissions for the
  target; the manifest gains `https://127.0.0.1/*` in the same phase production switches to HTTPS,
  so the offscreen probe (which has no UI to answer a prompt) is covered. `permission-blocked`
  still exists for the Chrome 142–143 window, Firefox 153+, and managed policies; the recovery
  steps say "site permissions beside the address bar" because that is the only user-operable fix.
- **Presto approval popup.** The desktop app prompts once per origin on `/prove`; the wallet's
  origin is an opaque `chrome-extension://<id>`. Denial surfaces as phase `denied` → WASM
  (production, remembered as `lastProveOutcome` and shown in Settings) and `denied` → throw (CI).
- **Coexistence.** Accelerator and Presto are separate installs sharing the wire protocol: a
  still-running Accelerator answers a Presto client and the wallet cannot tell. Docs say "quit or
  uninstall Aztec Accelerator before installing Presto"; nothing in code guesses.
- **Required-mode HTTP.** `httpsOnly:false` is representable only on the `required` arm, passed only
  from `offscreen/index.ts` under `PRESTO_REQUIRED`, which only the CI build stamps; the production
  negative-grep makes the absence machine-checked.

### Trade-offs & alternatives not taken

- **Status via the offscreen's prover (one client, one cache) vs a page-side `PrestoClient`.**
  Page-side wins: onboarding runs before any profile or PXE exists, `presto-core` is light, and the
  popup page must not depend on the offscreen being alive to render Settings. Cost: two probes'
  worth of `/health` traffic per session (10 s cache each). Both audits agree.
- **Journal seam vs `proveTxTask`'s `StepContent` label for the subtitle.** The label route needs no
  schema or FSM change, but it is a task-level string rendered only when the task matches the card
  unambiguously and it vanishes with the task; the journal is what the card renders from after a
  popup reopen and it is the persisted record. Seam chosen; the label stays "Generating proof".
- **Two arcs with an arc-1 onboarding shim vs one arc.** Arc 1 alone would ship an onboarding page
  whose HTTP `/health` probe says "active" while production proves HTTPS-only — an honest-looking
  lie. The shim (composable body over `PrestoClient`, link, copy) is ~40 lines and is deleted in
  P7; one arc would avoid it at the cost of a single very large PR. Shim chosen.
- **Typed `PxeService` event vs a raw `chrome.runtime.sendMessage` string.** The typed channel
  exists (`sendEvent`), routes through the same client the coordinator already holds, and is where a
  sender gate belongs. Raw string rejected.
- **Vue re-skin of the banner vs the custom element.** The element wins (owner decision, one source
  of copy/state/morph). Cost: an `isCustomElement` predicate and localStorage dismissals under the
  extension origin (neutralised on mount).
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

Why it loses (both audits concur): the owner asked for the LNA/HTTPS state machine now, and a bare
`/health` fetch under HTTPS-only cannot produce it; routing status through the offscreen makes
onboarding depend on a PXE that does not exist yet; and neither a page-side nor an offscreen status
probe can see a `/prove` denial — only the prove-phase event can, which is why v2 moves it into
arc 1. Where it wins: half the diff, no custom-element plumbing, no new page dependency.

## Security & Adversarial Considerations

**Threat model.** The wallet hands private witness data to a loopback HTTP(S) service that is
shape-matched, not authenticated (Presto's documented trust boundary). Attackers: a local process
squatting the Presto ports while Presto is not running; a malicious page or the extension's own
content script trying to reach the prover or spoof its phases; a supply-chain compromise of the
Presto npm packages or the headless binary; a CI runner where `PRESTO_ALLOW_ALL` widens the origin
gate.

- **Port squatting — a bounded guarantee.** HTTPS-only in production defeats a squatter that lacks a
  browser-trusted certificate for `127.0.0.1`/`localhost`: TLS fails, the SDK falls back to WASM,
  no witness leaves the browser, and the HTTP diagnostic never POSTs. It does **not** authenticate
  the Presto application: the browser trusts any certificate its store trusts (no CA pinning), and
  Presto persists its leaf key on disk under an owner-only directory (the CA key stays in memory),
  so same-user malware that can read that key, or a compromised trust store, can impersonate the
  server. Those are residual risks of the loopback model, stated in `SECURITY.md`, not solved here.
  The wallet never offers the session-only HTTP downgrade; required-mode HTTP is derived from the
  CI proving mode inside the factory and exists only in CI builds (negative-grep), and
  `presto-policy.test.ts` drives the real `presto-core` client with a stubbed `fetch` to prove that
  a production configuration never issues an HTTP `/prove` after an HTTPS failure — including when
  HTTPS succeeded earlier in the same session.
- **Extension ↔ prover authorization.** Presto's desktop app gates `/prove` per origin with a user
  prompt; the wallet's origin is opaque, so the first-send copy names Nulo. Recommend (Ask A3)
  listing Nulo's store extension ID in Presto's verified-sites registry so the prompt shows a
  recognition badge — a UX aid, not a boundary, and not a launch prerequisite.
- **Phase channel.** Events are typed `PxeService` events; the SW client drops any event whose
  sender fails `isTrustedInternalSender` or whose URL is not the offscreen page's origin + path
  (query ignored for Firefox's instance token; the content script shares the extension id and runs
  in every frame of every site); the payload is schema-validated; an event is applied only when its
  `proveId` matches a mapped, in-flight attempt and the op is still `proving`. Worst case of a
  bypass is a wrong subtitle; it still cannot move a stage or touch a proof.
- **CI origin gate.** `PRESTO_ALLOW_ALL=1` is scoped to the `presto-server` process on the ephemeral
  GitHub-hosted runner (single-tenant, torn down after the job), mirroring today's
  `ACCEL_ALLOW_ALL=1`. Never on self-hosted runners, never at job level. It bypasses the production
  authorization path by design; that path is exercised by the manual Mac check (approve, deny,
  recover), not by CI.
- **Supply chain.** npm: only the Presto packages still inside the 7-day window at install time are
  exempted, for ≤ 2 days, with **npm provenance** verified before exempting: Presto publishes with
  `npm publish --provenance` (not GitHub artifact attestations), so verification is `npm audit
  signatures` in an isolated fixture directory (a scratch `package.json` pinning the exact
  versions + `npm install --package-lock-only --ignore-scripts`), reading the SLSA statement to bind
  each tarball digest to the `alejoamiras/presto` repository, its release workflow and the tagged
  commit — the same mechanism as Presto's own `scripts/verify-sdk-package-signatures.ts`; recorded
  in lessons with the digests. A dated removal PR is a named deliverable in Delivery. Binary: the
  repo pins both the tarball and the extracted `presto-server` SHA-256, requires exactly one regular
  `presto-server` member (no links, duplicates or extras), extracts only it, and re-verifies the
  binary on every run (cache hits included); the upstream sidecar is same-origin and only detects
  transfer corruption. Both pins are established once from the release assets and are a pin, not
  independent provenance — the plan says so rather than claiming more. Lockfile committed; `bun install --frozen-lockfile` in CI.
  AGPL-3.0 posture unchanged from the accelerator (same author, same license) — re-confirm in
  `SECURITY.md`.
- **Least privilege.** `https://127.0.0.1/*` is the only permission added. No new GitHub token
  scopes; the action remains sudo-free.
- **Input validation.** `PrestoStatus` is untrusted JSON from a local service: the mapper reads only
  the discriminants it knows and defaults unknown reasons to `error`; `info` strings are rendered
  as text, never HTML. The banner escapes `href`; the wallet passes a constant.
- **Frontend.** The banner is privileged extension-page code, not a sandbox: it renders static
  templates via `innerHTML` into an **open** shadow root, escapes `href`, loads no images or fonts
  with `fonts="none"` (COEP-safe), and its anchors carry `rel="noopener"` (no `noreferrer`; the
  target is a constant first-party URL). The wallet only sets attributes/properties on it.
  Dismissals persist in the extension page's localStorage — no sensitive data; cleared on mount.
- **Prompt injection / LLM flows.** None touched.
- **Secrets.** None created or moved.

## Assumptions

### Facts (verified)

- F1 — Migration is a rename: `AcceleratorProver`→`PrestoProver`, `checkAcceleratorStatus`→`checkPrestoStatus`, option `accelerator`→`presto`, `AcceleratorPhase`→`PrestoPhase`; no deprecated aliases. The desktop apps are separate installs (renewed approvals, new certificate setup) sharing a compatible wire protocol, so a running Accelerator answers a Presto client (`presto/packages/sdk/MIGRATION.md`).
- F2 — `presto-core` depends only on `@logtape/logtape` and `ms`; `PrestoClient({aztecVersion, presto, onPhase}).checkStatus({forceRefresh})`; no abort/dispose API (`sdk-core/package.json`, `presto-client.ts:88-136`).
- F3 — `httpsOnly` resolves explicit option > `PRESTO_HTTPS_ONLY` > `true` in browser/Worker runtimes (`sdk-core/src/lib/config.ts:32-70`); `false` selects the dual probe (`presto-client.ts:139`).
- F4 — `PrestoPhase` includes `secure-connection-unavailable` and `version-mismatch`, emitted before `fallback` on the paths that detect them (`sdk-core/src/lib/types.ts:10-24`, `presto-client.ts:344,528`); a legacy health-version mismatch reaches the generic unavailable fallback without that phase, so the required guard's precise message covers only the emitting paths; `createChonkProof` has no try/catch around `client.prove`, so an `onPhase` throw propagates (`presto-prover.ts:170-186`); `#fallbackToWasm` always emits `fallback` afterwards (`presto-prover.ts:206`).
- F5 — Headless `presto-server` is HTTP-only on `127.0.0.1:59833`, deny-by-default origins unless `ALLOWED_ORIGINS`/`PRESTO_ALLOW_ALL=1`; release `presto-v1.1.1` ships `presto-server-1.1.1-linux-x86_64.tar.gz` + `.sha256` (`packages/presto/README.md:158-226`; `gh release view presto-v1.1.1`).
- F6 — Presto logs `Received /prove request` and `Proving succeeded` (`packages/presto/core/src/server/prove.rs:283,475`, verified at the `presto-v1.1.1` tag).
- F7 — `setForceLocal` exists on `PrestoProver` (`presto-prover.ts:138`), so the lint guard stays.
- F8 — The banner kit (`packages/banners/src/{element,render,status,persistence,fonts}.ts` at `6051b11`; line numbers omitted, several drifted): attributes, events, `fonts="none"` skips the Google Fonts link, exported `stateFromStatus` + `clearDismissal`, host-overridable `--pb-*` and `:host([variant="card"])` width; the card renders a close button and dismissal persists 7 days in `localStorage["presto:banner:card:offline"]`; open shadow root, `innerHTML` of static templates with `escapeHtml(href)`, anchors `rel="noopener"`.
- F9 — Nulo manifest: `host_permissions: ["https://nulo.sh/", "http://127.0.0.1/*"]`, no `connect-src`, shared by both browsers (`apps/extension/manifest/manifest.config.ts:20`); content script matches `*://*/*`, `all_frames` (`:31-37`).
- F10 — No custom-element config exists (`grep isCustomElement` → 0); `vue()` is called with no options (`apps/extension/vite.config.ts`).
- F11 — `JobProgress` proving arm is `{ stage: "proving"; enteredProveAt }` (`packages/wallet-core/src/jobs/types.ts:49-53`) **and** a separate Zod proving schema exists at `operation-journal/spec.ts:184` without `backend`; `execution-coordinator.ts:196` marks `proving` before the offscreen lock.
- F12 — `stageSubtitle` is a pure helper with an exhaustiveness pin (`apps/extension/src/utils/card-subtitle.ts`); `RecentActivityView.vue:444` calls it with the stage only.
- F13 — The offscreen `Service` base has a typed push primitive `sendEvent()` that swallows a dead-SW rejection (`packages/extension-messaging/src/offscreen/service.ts:64-69`); `PxeService extends Service<Methods>` with the default empty events map (`packages/aztec-runtime/src/pxe/service.ts:73`). The SW-side `OffscreenClient` accepts events by `message.from === this.service` and never inspects `sender` (`offscreen/client.ts:60-83`). `isTrustedInternalSender` lives in `core/sender-auth.ts:17-23`.
- F14 — Lockstep literals and their lines: recon.md §Lockstep. `NULO_ACCELERATOR_REQUIRED_BUILD_STAMP` is not in `_build-extension.yml`'s production guard today. `e2e:agent` is a root script only (`package.json:22`).
- F15 — Chromium: extensions with host permissions for the target are not subject to the LNA prompt (Chromium engineer, chromium-extensions list; related bug fixed in 144.0.7512). Chrome 145 splits `local-network` / `loopback-network`. The SDK transport queries `loopback-network` then `local-network-access` after a failed request (`presto-transport.ts:176-197,774`).
- F16 — Min-age (snapshot from `npm view` on 2026-09-14; P1 re-reads it): `presto@5.2.0-revision.2` published 2026-09-08T22:58Z, `presto-core@1.0.1` 2026-09-08T22:29Z, `presto-banners@1.0.0` 2026-09-09T14:48Z; the gate is 7 days, so presto-core clears it 2026-09-15T22:29Z, presto 2026-09-15T22:58Z, banners 2026-09-16T14:48Z; the accelerator exclude in `bunfig.toml` expired 2026-09-02 and is still present.
- F17 — `NULO_E2E_DISABLE_ACCELERATOR` was not set in the repo (`gh variable list`, 2026-09-14 snapshot; P3 re-checks).
- F18 — The soak workflow accepts `mode=files`, `test_files`, `repeats`, `proverless`, `disable_accelerator`, `retry`, passes `shard_label: soak-N`, and `_extension-network-e2e.yml` enforces the `PROVE_SUCCESS` assert only for `shard_label == canary` (`extension-network-e2e-soak.yml:15-44,75-91`).
- F19 — `/health` is origin-tiered: detailed body for an absent or approved `Origin`, minimal body otherwise (`presto/core/src/server.rs:415-445`) — what the browser actually sends as `Origin` on the extension's GET and POST is confirmed on the Mac check, not inferred from server code; the SDK's `isDetailedHealthBody` requires `version`, `aztec_version`, `available_versions[]`, `bb_available`, and treats `https_port` absence as meaningful (`presto-transport.ts:326-342`).
- F20 — Presto prompts per origin on `/prove`; 60 s auto-deny, 30 s deny cooldown (`presto/core/src/authorization.rs:228,239`); `chrome-extension://` ids are canonicalized.
- F21 — Presto desktop ships `https_enabled: false` on a clean install; the wizard enables it (`packages/presto/core/src/config.rs:96-101,134`); the leaf TLS key is persisted on disk in an owner-only directory, the CA key stays in memory (`packages/presto/src-tauri/src/certs.rs`).
- F22 — The journal FSM has no `proving → proving` edge (`packages/wallet-core/src/jobs/fsm.ts:46`) and `_transitionLocked` asserts every transition (`operation-journal/service.ts:316`); locks are per `(profileId, chainId)` (`execution-mutex.ts`).
- F23 — `cardSubtitleFor` returns the executing task's label (`"Generating proof..."`) before consulting `stageSubtitle` whenever the task matches one card (`RecentActivityView.vue:429-444`); `proveTxTask` has one call site (`proveAndSend`, `execution-coordinator.ts:197`) and `ProveAndSendContext` carries a `markJournal` closure but no journal id (`:57-72`; the lane holds `queuedJournalId`); `createPxeOffscreen` returns `Promise<void>` (`aztec-runtime/src/offscreen/entry.ts:43`); Firefox opens the offscreen page as `<getURL(path)>?instance=<token>` (`wallet/utils/offscreen.ts:279`).
- F24 — SDK phase sequences: native `detect → serialize → transmit → proving → proved → receive`; after denial `denied → fallback → proving → proved → receive` (`presto-prover.ts:186-215`, `presto-client.ts:321-538`).
- F25 — Presto publishes its npm packages with `npm publish --provenance` and verifies them with `npm audit signatures` over the SLSA statement (`presto/.github/workflows/_publish-npm.yml:282`, `scripts/verify-sdk-package-signatures.ts`); no GitHub artifact attestation is published.

### Inferences (unverified — attack these)

- I2 — The published `@alejoamiras/presto` tarball resolves `dist/index.js` the way the accelerator did, so the vite alias is a rename — or unnecessary. Verify after install (P1) and drop the alias if exports resolve cleanly.
- I4 — Firefox 153's LNA applies to `moz-extension://` pages; no exemption statement found. The state machine covers it; nothing Firefox-specific is planned (Ask A6).
- I5 — Presto's HTTPS probe from the offscreen document succeeds once the user completed Presto's certificate setup (Presto installs its CA into the user NSS DB on Linux and the login keychain on macOS). Users who declined the wizard step land in `https-disabled` (after approval) or `presto-reachable` (before) — handled, not silent. The Mac check does not establish Linux trust-store coverage; that stays an accepted acceptance risk.
- I7 — A `provePhase` event emitted mid-prove reaches the SW while it awaits the same prove (`sendEvent` is fire-and-forget; READY proves reachability only). Delivery and ordering are NOT assumed: attribution and lifetime come from the map + seam, journal writes are serialised by `transitionLock`, loss degrades to the generic subtitle, and P4 tests an event delivered after the RPC resolved.
- I8 — Adding a trailing optional `proveId` to `proveTx` on the spec/client is wire-compatible with the existing RPC codec (positional args). `service.pxe-seam.test.ts` only checks construction, so P4 adds a real codec round-trip test for the new argument.
- I9 — Puppeteer request interception answers `https://127.0.0.1:59834/health` before any TLS handshake, so the smoke e2e can stub both probes without a certificate. Resolved in **P6** by a ten-line probe in the existing onboarding harness before P7 promises its gate; if it fails, P7's HTTPS-failure cases move to a page-level `window.__nuloPrestoHealthBase` override that only the smoke build sets (same negative-grep discipline as the other e2e stamps), never to "unit tests only".

### Asks (owner decisions — resolved at approval)

- A1 — Rename the workflow input `disable_accelerator` → `disable_presto` and the repo var `NULO_E2E_DISABLE_ACCELERATOR` → `NULO_E2E_DISABLE_PRESTO`? **Recommended: yes** (var unset; docs/rollback runbook updated).
- A2 — Route + testids: `/onboarding/accelerator` → `/onboarding/presto`, `onboarding-accelerator-*` → `onboarding-presto-*`? **Recommended: yes** (the page is rebuilt; e2e updated in the same phase).
- A3 — Add Nulo's store extension ID to Presto's `verified-sites.json` (Presto repo, out of scope)? **Recommended: yes, after the ID is known** — recognition UX only, not a launch prerequisite; verify the actual `Origin` header and prompt display during the Mac check.
- A4 — Bundle budget for the page-side client: the onboarding entry chunk plus any new shared chunk it imports grows by **≤ 60 kB gzip**, and no onboarding-reachable chunk contains an `@aztec/` marker (`grep -l "@aztec/" apps/extension/dist/chrome/assets/onboarding*.js` → none). Measured before/after in P6's gate. **Recommended: accept the budget.**
- A5 — Add a manifest `key` (Chrome only) so unpacked/dev builds get one stable extension ID? Unpacked IDs are derived from the load path, so they are stable per checkout but differ per worktree and per machine — each is a separate origin for Presto (its own prompt) and none can be filed for A3. **Recommended: yes, dev-only via the existing manifest config branch, in P2 with its build assertion; the store ID is already stable.**
- A6 — Firefox: since Firefox 127 MV3 host permissions requested in the manifest are granted at install, but users can revoke them and permissions added on update are not auto-granted; a revoked permission surfaces as `unconfirmed` or `permission-blocked` depending on how the request fails. Add a `permissions.request` "Grant access" step to `presto.vue` on Firefox, or stay best-effort? **Recommended: best-effort now, follow-up plan** — the copy for those states says "check the extension's permissions" without promising which state Firefox produces; the request step needs a user gesture and its own e2e.
- A7 — `__AZTEC_VERSION__` (from `@aztec/pxe`) is what the page-side client sends; the offscreen prover sends the SDK's own `@aztec/*` pin. Pin equality with `presto-version-lockstep.test.ts` (reads `@alejoamiras/presto`'s dependency pin and the workspace's `@aztec/pxe`)? **Recommended: yes; the `aztec-update` skill gains the drift line.**

## Phases

Legend: ✓ = validation gate passed and logged in `lessons/phase-N.md`. Every gate includes the fast
layers; commands run from the worktree root unless a `cd` is shown (the tool shell's cwd drifts —
always prefix). Sequencing rule: nothing is deleted before its last consumer is replaced, so every
phase's typecheck is green on its own.

### Arc 1 — runtime truth: SDK, manifest, CI, prove-phase event (`worktree-presto-migration`)

#### P1 — dependencies, gate exemptions, aliases, version lockstep

- **Add** `@alejoamiras/presto@5.2.0-revision.2` next to the existing accelerator pin in `packages/aztec-runtime/package.json` and `apps/extension/package.json` (the accelerator pin is removed in P2 together with its imports, so every phase typechecks); add `@alejoamiras/presto-core@1.0.1` and `@alejoamiras/presto-banners@1.0.0` to `apps/extension`.
- `bunfig.toml`: delete the expired accelerator exclude; re-read publish times (`npm view … time`); add a dated exclude (`remove on/after 2026-09-16T14:49Z`) **only** for each Presto package still inside the 7-day window at install time (F16 — likely just `presto-banners`); verify npm provenance first (the isolated `npm audit signatures` fixture from the Security section) and record the output + tarball digests in `lessons/phase-1.md`.
- `bun install` (lockfile regenerates for the new packages only; diff reviewed).
- `vite.config.ts` alias only if the published exports do not resolve (I2); `renovate.json`; `scripts/aztec-hold-residue-check.ts` root literal.
- `packages/aztec-runtime/src/pxe/presto-version-lockstep.test.ts` (A7).
- **Validation gate**: `bun install --frozen-lockfile` exit 0; `bun scripts/aztec-hold-residue-check.ts` exit 0; `bun run lint` + `bun run typecheck:all` exit 0; `bun run --cwd packages/aztec-runtime test presto-version-lockstep` green. Layers: install, residue check, lint, typecheck, unit.

#### P2 — runtime swap, config, manifest

- `chain-runtime.ts` per §A (types, prover, guard, preflight, per-runtime observer with isolation, `activeProve`, mode-derived plaintext, error prefix); remove the accelerator dependency from both `package.json`s and the lockfile.
- `src/accelerator/config.ts` → `src/presto/config.ts` (`PRESTO_HOST`, `PRESTO_PORT`, `PRESTO_HTTPS_PORT`, `PRESTO_REQUIRED`, `PRESTO_REQUIRED_BUILD_STAMP`); `offscreen/index.ts` selects the mode only; `entry.ts` comments.
- **Arc-1 onboarding shim** (deleted in P7): `useAcceleratorStatus.ts` keeps its name and its `active | no-bb | not-installed | checking` contract but implements it over `getPrestoClient().checkStatus()` (`available` → `active`, `available && needsDownload` → `no-bb`, anything else → `not-installed`) — HTTPS-first like production, so the page can no longer say "active" over plain HTTP while proofs fall back; `accelerator.vue` download link → `https://presto.build`, the words "Aztec Accelerator" → "Presto", testids unchanged; `tests/e2e/onboarding-tab.test.ts` intercepts the HTTPS probe (and the HTTP diagnostic) instead of the HTTP health URL.
- `manifest.config.ts`: add `https://127.0.0.1/*` (the HTTPS switch and its permission land together); A5 dev `key` if approved.
- `chain-runtime.test.ts`: renamed mock; new cases — default mode passes `presto.httpsOnly === true`; required mode passes `false` with no option involved; preflight error names `reason`/`diagnosis` for `permission-blocked` and `secure-connection-unavailable`; guard throws on `fallback`, `denied`, `secure-connection-unavailable`, `version-mismatch` (the last two documented as redundant-but-precise, and F4's uncovered legacy path noted); a throwing observer does not propagate in default mode; every phase reaches the observer carrying the runtime's `activeProve` and none reaches it when unset.
- `presto-policy.test.ts`: the real `presto-core` client with a stubbed `fetch`, production options — HTTPS refused → the only HTTP request is the witness-free `GET /health`, never a `/prove`; HTTPS succeeded earlier, then refused → same.
- **Validation gate**: `bun run --cwd packages/aztec-runtime test` green; `bun run typecheck:all`; `bun run lint`; `bun run test` (extension unit) green; `bun run build` exit 0 and `jq '.host_permissions' apps/extension/dist/chrome/manifest.json` lists both `127.0.0.1` schemes (and `.key` when A5 is on, dev build only); `cd apps/extension && bun run test:e2e -- tests/e2e/onboarding-tab.test.ts` green on the shim; `grep -rn "aztec-accelerator\|AcceleratorProver\|ACCELERATOR_" packages apps --include=*.ts --include=*.vue --include=*.mts` → 0 hits (the shim keeps only the composable/page/testid *names*, which P7 removes). Layers: unit, typecheck, lint, build, smoke e2e.

#### P3 — CI headless Presto + CI docs

- `setup-presto-server` action per §B (delete the old one); compute both pins by downloading the 1.1.1 tarball, checking the sidecar, `sha256sum` of the tarball, listing members, extracting only `presto-server`, `sha256sum presto-server`; record all three hashes in lessons.
- `_extension-network-e2e.yml`, `pr-extension-network-e2e.yml` (paths-filter), `extension-network-e2e-soak.yml`, `nightly.yml`, `_lint-and-typecheck.yml` (comment), `_build-extension.yml` (marker), `agent.sh`; A1 rename if approved.
- CI-facing docs in the same phase: `CI.md` "Presto in CI" (rollback, allow-all scope, gate semantics), `SECURITY.md` binary-dependency section (license re-confirmed; bounded squatting guarantee), `.github/README.md`, `apps/extension/tests/e2e/README.md`, the `e2e-testing` and `aztec-update` skills' accelerator lines.
- **Validation gate**: `bun run lint:actions` exit 0; `bun run test:ci-gating` green (its aggregator-name pin reads `extension-network-e2e-status`); push the branch, then
  `gh workflow run extension-network-e2e-soak.yml --ref worktree-presto-migration -f mode=files -f test_files="tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/frozen-account-canary.test.ts" -f repeats=1 -f proverless=false` → run green, its log shows `bundle contains NULO_PRESTO_REQUIRED_BUILD_STAMP ✓`, `presto-server` health `bb_available: true`, and the activity step prints `PROVE_SUCCESS=<n>` with n ≥ 1 (observable on the soak; enforced on the PR's `canary` shard — §B). Layers: actions lint, ci-gating unit, network e2e prover-ON.

#### P4 — prove-phase event, journal seam, subtitle, last outcome

- `wallet-core` `JobProgress` + fsm test; `operation-journal/spec.ts` Zod `backend` + round-trip test; `updateProvingBackend` seam (+ tests: applies in `proving`, no-op in any other stage, preserves `enteredProveAt`, serialised under `transitionLock`).
- `proveId` on `spec.ts`/`ipxe.ts`/`client.ts` (+ a codec round-trip test for the new argument — I8); `PxeService<Methods, PxeEvents>` + `activeProve` set/cleared inside the write lock + sink subscription; `createPxeOffscreen` takes `provePhaseSink`; `offscreen/index.ts` sink + factory wiring.
- `extension-messaging` `OffscreenClient` sender gate (+ tests: content-script-shaped sender dropped; Chrome offscreen URL accepted; Firefox `moz-extension://…/index.html?instance=<token>` accepted; other extension pages dropped).
- Coordinator: `ProveAndSendContext.journalId` (+ `execution-lane.ts` passes it), `proveTxTask` mint/map/delete, the Zod event schema, the `provePhase` handler with the across-the-attempt rules, `lastProveOutcome` + `lastDenial` (+ every test listed in §F, including the post-denial sequence and the delivered-after-RPC case); `ExecutionService.getLastProveOutcome` spec/service/client.
- `stageSubtitle(stage, backend)` + test; `RecentActivityView` returns the backend subtitle ahead of the task label (+ component test pinning the priority), stamps `data-backend`.
- `ARCHITECTURE.md` one paragraph on the event; `UPDATE.md`; codex-notes `05` (fix the stale `packages/extension` path while there) and `10`.
- **Validation gate**: `bun run --cwd packages/wallet-core test`, `bun run --cwd packages/extension-messaging test`, `bun run --cwd packages/aztec-runtime test`, `bun run test` all green; `bun run typecheck:all` + `bun run lint`; local network e2e from the root, WASM build (Presto absent → `fallback`): `bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts` green with the awaiting card reaching `data-stage="proving"` and **`data-backend="browser"`** with the exact subtitle `Proving in browser…` asserted; CI: the P3 soak dispatch repeated → green with `PROVE_SUCCESS ≥ 1` and, in the canary lane's console capture, `data-backend="presto"` / `Proving with Presto ✦` (assert added to `tx-sendTx-default.test.ts`, keyed on `VITE_NULO_PRESTO_REQUIRED`). Layers: unit, typecheck, lint, network e2e (local + CI).

#### P5 — arc-1 docs + residue

- `CLAUDE.md` (Network e2e paragraph, dependency policy line), remaining doc/skill lines from recon.md's list not already covered in P3/P4.
- **Validation gate**: `bun run lint` exit 0; `bash scripts/check-no-brand.sh` exit 0; `git grep -n "aztec-accelerator\|accelerator-server\|ACCELERATOR_" -- . ':!CHANGELOG.md' ':!implementations-plan' ':!audit' ':!bun.lock'` → 0 hits (package, binary and env *identifiers*; the product name "Aztec Accelerator" is allowed to survive in the coexistence note in `CI.md`/`SECURITY.md` and in the arc-1 shim's file names until P7 — listed as the two intentional exceptions). Layers: lint, grep.

**Arc 1 boundary**: the codex fix loop (Post-implementation §) on arc 1's diff, then `gh stack add presto-migration/ux`.

### Arc 2 — the surfaces: status client, onboarding, settings (`presto-migration/ux`)

#### P6 — status client, UI-state mapper, custom element

- `src/utils/presto-ui-state.ts` (+ ≥ 10-case test: each `BannerState` via `stateFromStatus`, the `unconfirmed` pitch rule, unknown reason → `error`, `needsDownload`, minimal-body degradation (`info` empty, `presto-reachable`), copy/steps per state, the denied overlay from `lastProveOutcome`).
- `src/composables/usePrestoStatus.ts` + `getPrestoClient()` (+ ≥ 10-case test with an injected fake client: idle → detecting → each state; `forceRefresh` passthrough; a late result after `dispose` is dropped; `bannerStatus` mirrors the raw status; two composables share one injected client).
- `vite.config.ts`: `isCustomElement`.
- **I9 probe**: a ten-line smoke case in the existing onboarding harness that intercepts `https://127.0.0.1:59834/health` with `request.respond(...)` and asserts the page received the stubbed body — decides P7's mechanism before P7 promises it.
- **Validation gate**: `bun run test` green (new tests included); `bun run typecheck:all`; `bun run lint`; `bun run build` exit 0; the I9 probe green (or the override fallback chosen and recorded in lessons). Layers: unit, typecheck, lint, build, smoke e2e. (A4 is measured in P7, once the code is actually reachable.)

#### P7 — onboarding `presto.vue`

- Page per §D and the approved artboards; `learn.vue`/`fees.vue` routes; `app.store.ts` + `reset.vue` comments; delete `accelerator.vue` and `useAcceleratorStatus.*` (last consumer replaced here).
- `tests/e2e/onboarding-tab.test.ts`: intercept both `https://127.0.0.1:59834/health` and `http://127.0.0.1:59833/health`; bodies satisfy `isDetailedHealthBody` where a specific diagnosis is expected; cases: available → Continue; both refused → card banner + Skip; HTTPS refused + detailed HTTP body without `https_port` → the encrypted-connection card with the `https-disabled` steps; HTTPS refused + minimal HTTP body → the `presto-reachable` copy.
- **Validation gate**: `bun run lint` + `bun run typecheck:all`; `cd apps/extension && bun run test:e2e -- tests/e2e/onboarding-tab.test.ts` green; then the full smoke `cd apps/extension && bun run test:e2e` green; zero-residue: `grep -rn "aztec-accelerator\|AcceleratorProver\|ACCELERATOR_\|useAcceleratorStatus\|onboarding-accelerator" packages apps --include=*.ts --include=*.vue --include=*.mts` → 0 hits; **A4 measured here** (the consumers now exist): one measurement build with `build.sourcemap: true`, walk the onboarding entry's import closure from Vite's build manifest, sum gzip sizes before (arc-1 tip) and after → delta ≤ 60 kB, and every `.map` in that closure has no `sources` entry under `@aztec/` (module-level evidence, not a string grep) — recorded in lessons; manual: `bun run build && send-to-mac apps/extension/dist/chrome`, load unpacked, walk the onboarding states with the real tray app (Presto quit → pitch; Encrypted Connection off; on; approval prompt approved at first send) — screenshots + the observed `Origin` header (Presto's log) in lessons. Layers: lint, typecheck, smoke e2e, grep, build measurement, manual.

#### P8 — settings Proving page + index row

- Per §E and the artboards; `data-testid="setting-nav-proving"`, `settings-proving-status`, `settings-proving-retry`, `settings-proving-get`.
- New smoke e2e `tests/e2e/settings-proving.test.ts`: navigate from settings, mocked health for `available` and `offline`, assert the status testid's `data-status` and the Get Presto row visibility; a unit test covers the denied overlay (no automated e2e can drive a real denial — the Mac check does).
- **Validation gate**: `bun run lint` + `bun run typecheck:all` + `bun run test`; `cd apps/extension && bun run test:e2e -- tests/e2e/settings-proving.test.ts` green; full smoke green; `bun run audit:vue` exit 0; manual on the Mac: deny Presto's prompt at a send → Settings → Proving shows "Presto declined Nulo"; allow it in Presto → Sites, send again → the denial clears — screenshots in lessons. Layers: lint, typecheck, unit, smoke e2e, manual.

**Arc 2 boundary**: the codex fix loop on arc 2's diff; then the final cross-arc pass.

## Post-implementation (self-contained; executed by the implementing session)

`code_review` is `off`: do NOT run `/code-review`. The codex fix loop is the review.

1. **Per arc, at the boundary** (arc 1 after P5 ✓, arc 2 after P8 ✓), while the arc is the stack
   tip: `/codex high` with — the arc's diff (`git diff <arc-base>..HEAD`), this plan.md and the
   decision ledger, the arc map ("arc 1 of 2: SDK, manifest, CI, prove-phase event; arc 2 builds the
   onboarding and settings surfaces on `usePrestoStatus` and `getLastProveOutcome`" — so the
   `presto-core`/`presto-banners` dependencies and the RPC are not flagged as dead), the
   adversarial/security ask ("What could go wrong? What would an attacker target? What are we
   trusting that we shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses?"),
   and both rules below verbatim.
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
`github/gh-stack` if missing). Each arc builds, typechecks and passes its gates on its own.

| Arc | Phases | Branch | Stacks on | code_review |
|---|---|---|---|---|
| 1 — runtime truth (SDK, manifest, CI, prove-phase event) | P1–P5 | `worktree-presto-migration` (`gh stack init --adopt worktree-presto-migration --base dev`) | `dev` | off |
| 2 — surfaces (status client, onboarding, settings) | P6–P8 | `presto-migration/ux` (`gh stack add presto-migration/ux` after arc 1's loop) | arc 1 | off |

- Push branches for checkpointing (`gh stack push`); no PR before the loops converge.
- Publish: `gh stack sync` if `dev` moved, `gh stack submit --auto`, then `gh pr edit` each PR with a
  body (title ≤ 93 chars, Conventional Commits: `feat(proving): migrate to presto, report the proving backend`,
  `feat(onboarding): presto states, settings proving page`), `gh pr checks --watch`.
- Arc 1's PR touches `bun.lock`, the manifest and workflow files → smoke + network e2e run on it;
  the canary lane is the enforced prover-ON gate. Arc 2 touches the smoke surface.
- **Deliverable, dated:** a follow-up PR after 2026-09-16T14:49Z removes every
  `minimumReleaseAgeExcludes` entry added in P1 (named in the wrap-up report as an open item until
  merged).
- `gh stack merge` is the owner's call. Then `implementations-plan/index.md` gets the completed
  marker and `agent-worktree done presto-migration` is suggested.

## Autonomy

AFK rules per AGENTS.md: commit eagerly (signing stays on — homelab's key is passphrase-less), push
feature branches only after the arc's gate passes, consult `/codex high` on any fork, never merge,
never publish, never widen scope past this file, never touch the Presto repo. A red `presto-server`
health in CI is investigated (download URL, pins, `bb` download on first prove), never neutralized.

## Audit verdicts

| Leg | Verdict on v1 | Blocking / conditions | Disposition in v2 |
|---|---|---|---|
| Codex (GPT-6 Astra, high) — `audit-codex.md` | **reject** | uncorrelated proving events; journal Zod schema; overstated transport guarantees; gates unpassable as sequenced | all four resolved: `proveId` registry + across-the-attempt rules (§F); Zod `backend` + round-trip (P4); explicit `httpsOnly:true`, required-arm-only type, bounded squatting guarantee (§A, Security); phases resequenced with per-phase typecheck green, root `e2e:agent`, exact subtitles (P2/P4/P7) |
| Fable 5.1 (Plan subagent) — `audit-fable.md` | **conditional approve** | manifest in arc 1; journal seam; per-prove id; drop LNA short-circuit; `httpsOnly` on required arm; banner dismissal; `denied` surface; health-tier copy | all eight met: P2 manifest; `updateProvingBackend`; `proveId`; §C no probe; §A type; §D `clearDismissal` + dismiss→Skip; §E/§F `lastProveOutcome`; §C/§E tiering copy |
| Codex fresh-context pass r1 (on v2 + ledger) — `audit-codex.md` §2 | **reject** | denial overwritten by later phases; subtitle hidden behind the task label; Firefox events fail the URL gate; correlation plumbing incomplete (no journal id in the context, sink wiring, client generic); P1 red typecheck; arc 1 not honestly shippable (old onboarding probes HTTP) | all folded in v3: `lastDenial` (D17′); subtitle priority (D3′); path-only URL gate + payload schema (D5′); `journalId` on the context, sink, `PxeServiceClientBase<…, PxeEvents>`, `createPxeOffscreen` dep (D6′); P1 adds before P2 removes; arc-1 onboarding shim (D2′); plus the Medium security items (archive member rules, npm provenance mechanism, production-policy test), F4/F8/F16/F19/F21 corrections, I7/I8/I9 rewrites, A5/A6 rewording, P3 aggregator name + in-test native assertion, P5 residue exceptions, A4 measured in P7 by sourcemap closure, denial manual check moved to P8, registry → `Map`, plaintext derived from mode, shallow port untouched |
| Codex fresh-context pass r2 (on v3) | _pending_ | | |

### Decision ledger

**Chosen outline.** The plan's two-arc shape with the runtime truth moved into arc 1 (Fable's
edit), which is also the condition under which Codex called two arcs defensible ("only after moving
permissions and compatibility fixes into arc 1 so each independently builds"). Both legs rejected
the competing outline for the same reason (a `/health` fetch cannot produce the diagnosis; onboarding
must not depend on a PXE).

**Decisions and their sources**

| # | Decision | Alternative rejected | Why | Source |
|---|---|---|---|---|
| D1 | Page-side `PrestoClient` for status | status routed through the offscreen PXE | onboarding precedes any PXE; popup must render Settings without the offscreen | both |
| D2′ | Two arcs; arc 1 = SDK + manifest + CI + prove-phase event + journal seam + subtitle **+ a transport-honest shim on the old onboarding page**; arc 2 = the new onboarding + settings | one arc (Codex's preference twice) / v2's arc 1 that left the old page probing HTTP | arc 1 must be shippable alone without an onboarding page that says "active" over HTTP while production proves HTTPS-only; the shim is ~40 lines and dies in P7 | Codex final r1; driver |
| D3′ | Journal `updateProvingBackend` seam under `transitionLock`, **rendered ahead of the task label** in `cardSubtitleFor` | `proveTxTask` `StepContent` label / v2's helper-only change (which the task label would have hidden in the ordinary case) | the card renders from the persisted journal after a popup reopen; the label is task-scoped and ambiguous under concurrency; the priority fix is what makes the subtitle visible at all | Fable offered both; Codex final r1 caught the priority; driver |
| D4 | Typed `PxeService` `provePhase` event via `sendEvent` | raw `chrome.runtime.sendMessage` string | the typed channel exists and routes through the client the coordinator already holds | Fable |
| D5′ | SW-side sender gate on `OffscreenClient`: `isTrustedInternalSender` + the offscreen page's **origin + pathname** (query ignored) + a Zod payload schema | v2's exact-URL equality (rejects Firefox's `?instance=` token); assuming the existing gate covers events (Fable's F13 claim) | the client filters by `message.from` only — verified; the content script shares `sender.id`; Firefox appends an instance token; types validate nothing at runtime | Codex r1 + final r1; driver correction of Fable |
| D6′ | `proveId` minted in `proveTxTask`, mapped to the `journalId` the context now carries, set on the runtime as `activeProve` (with profile + chain) inside the write lock, cleared in `finally`; sink-based wiring through `createPxeOffscreen`; the client base gains the events generic | attribute by `chainId` (v1); v2's under-specified handoff (no journal id in the context, forwarder without coordinates, `void` bootstrap) | locks are per profile+chain and the SW marks `proving` before the lock; the plumbing must exist end to end or the rest is fiction | both; Codex final r1 for the gaps |
| D7 | Backend applied across the attempt (`transmit → presto`, `fallback/denied → browser`, `proved` no-op) | first message wins (v1) | `transmit` can be followed by `fallback`; `proved` identifies nothing | Codex |
| D8 | `httpsOnly: true` passed explicitly in default mode; `httpsOnly: false` only on the `required` arm's type | shared optional `httpsOnly?` on `PrestoEndpoint` (v1) | the SDK honours `PRESTO_HTTPS_ONLY`; the type, not the grep, is the first line | Codex + Fable |
| D9 | No page-side LNA `permissions.query` short-circuit | v1's pre-probe short-circuit | the SDK transport already queries and caches; a page probe diverges | both |
| D10 | Keep throwing on `secure-connection-unavailable`/`version-mismatch` in required mode | throw only on `fallback`/`denied` | redundant (fallback follows) but yields the precise reason; test documents it | Fable (Medium), Codex agrees valid |
| D11 | `uiStateFromStatus` wraps the kit's `stateFromStatus` | a Nulo re-implementation (v1) | one source of the `unconfirmed → offline` rule | Fable |
| D12 | Injected client; module-level memoized `getPrestoClient()` per page context | composable owns its client (v1) / per-instance clients | C1 contract; two consumers share the 10 s cache; tests need no `vi.mock`; dispose only drops late results | Codex + Fable |
| D13′ | Pin tarball **and** binary; require exactly one regular `presto-server` member (no links/duplicates/extras) before extraction; cache only that file and reject other restored entries; sidecar demoted to transfer-integrity; pins acknowledged as pins, not provenance | binary pin + sidecar (v1); v2's "no other regular file" rule (blind to links and duplicates) | the archive can carry hostile extras or a link named like the binary; sidecar is same-origin | Codex + Fable; Codex final r1 |
| D14 | `PRESTO_ALLOW_ALL=1` scoped to the server process; production authorization exercised by the Mac check | job-level env | least privilege; CI cannot exercise the prompt | Codex |
| D15 | Min-age excludes only for packages still gated at install; removal PR is a dated deliverable | three excludes (v1) | presto/presto-core clear the gate on 2026-09-15; comments never expire an exclude | Fable + Codex |
| D16 | `clearDismissal` on mount; `presto-banner:dismiss` → Skip | ignore the close button (v1) | a 7-day localStorage dismissal survives a wallet reset | Fable |
| D17′ | `lastDenial` held separately from `lastProveOutcome`: set on `denied`, cleared only by a native `proved`; one RPC returns both; Settings shows "Presto declined Nulo" | denial invisible (v1); v2's every-phase record (erased within a second by `fallback → proving → proved → receive`) | Presto prompts on `/prove`, health stays green; Retry cannot confirm approval; the SDK's post-denial sequence overwrites a single slot | Fable + Codex ask; Codex final r1 |
| D18 | `presto-reachable` is the primary encrypted-connection arm; Details degrade to `—`; `downloading` only after approval | v1 copy assumed the detailed body | `/health` is origin-tiered | Fable (new fact), Codex ("state semantics") |
| D19′ | A4 measured in **P7** (after the consumers exist) over the onboarding entry's import closure from the build manifest, gzip delta ≤ 60 kB, and `@aztec/` absence proven from sourcemap `sources` | "small; recorded" (v1); v2's P6 measurement (unused modules → zero delta) and string grep | unmeasurable is unauditable; a measurement before the code is reachable measures nothing | Codex r1 + final r1 |
| D20 | Bounded squatting guarantee stated; residuals named | "HTTPS-only is the mitigation" (v1) | no CA pinning; leaf key on disk | Codex |
| D21 | Plaintext derived from `provingMode === "required"` inside the factory; no `httpsOnly` option at all | v2's `httpsOnly: false` literal on the required arm | one fewer thing to set wrongly; the mode is the policy | Codex final r1 |
| D22 | Coordinator-owned `Map<proveId, journalId>` | a `ProveAttemptRegistry` class (v2) | no behaviour beyond set/get/delete | Codex final r1 |
| D23 | npm provenance verified with `npm audit signatures` in an isolated fixture, bound to repo/workflow/commit | `gh attestation verify` (v2 — wrong mechanism: Presto publishes npm provenance, not GitHub artifact attestations) | verify what is actually published | Codex final r1 |
| D24 | `presto-policy.test.ts` drives the real `presto-core` client with a stubbed `fetch` | constructor-argument assertions only (v2) | the round-1 ask was "no HTTP `/prove` after an HTTPS failure", which only a client-level test shows | Codex r1 + final r1 |

**Disputes and how they were resolved**

- *One arc vs two.* Codex preferred one; Fable two with moves. Resolved as D2 — Codex's own text
  makes two arcs acceptable once the moves are made, and the moves are made. No live dispute.
- *Fable's F13 (events already sender-gated).* Wrong on inspection; corrected as D5. Fable's carrier
  recommendation stands.
- *Journal seam vs task label.* Fable asked to weigh; resolved D3 for persistence reasons. Codex did
  not object to the journal route once correlated.
- *A3 verified-sites.* Codex: optional, not a prerequisite; Fable: needs a stable dev ID first. Both
  folded — A3 stays a non-blocking Ask, A5 (manifest `key`) added and, per the final pass, reworded
  (unpacked IDs are path-derived, so the value is one ID across worktrees/machines) and given a
  phase.
- *"All resolved" was premature (final pass r1).* The v2 ledger claimed every round-1 finding
  resolved; the fresh pass showed seven decisions resolved by assertion (D2, D3, D5, D6, D13, D17,
  D19). Each is re-decided above with a prime mark and the concrete mechanism; the r2 pass judges
  v3 on those.

**Open for the owner at the gate:** A1–A7 above (recommendations given for each).

## Seeds

DRAFT until the approval gate; finalized post-approval and mirrored in the ELI5 Artifact.

```
/goal All eight phases marked ✓ in implementations-plan/presto-migration/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript, including the P3 and P4 soak dispatches green with the printed PROVE_SUCCESS ≥ 1 and the in-test native assertions, the P4 local network e2e asserting data-backend="browser" with the exact subtitle, the P7 A4 measurement recorded, and the P8 Mac denial check recorded; for each phase the agent has printed `LESSONS_FILE=implementations-plan/presto-migration/lessons/phase-N.md`; `/code-review` was NOT run (code_review is off); the codex fix loop converged for arc 1 at its boundary (after P5), for arc 2 at its boundary (after P8), and for the final cross-arc pass — each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the two stacked PRs exist on GitHub, created only after all loops converged (`gh stack view` output in the transcript); `bun run audit:vue` and `bun run lint:actions` both report exit 0 in the transcript; the wrap-up report names the min-age exclude removal PR (after 2026-09-16T14:49Z) and Asks A3/A5/A6 as open items.
```

```
/loop 15m Drive implementations-plan/presto-migration forward. Never idle waiting for my input. Each firing:
1. **Reality check**: read implementations-plan/presto-migration/plan.md and lessons/ (authoritative state — not the chat); native task list empty (fresh session)? rebuild it from plan.md, one task per remaining phase and loop; run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup` (no --watch; `gh stack view` for the stack). Without a PR, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **Waiting on CI is fine** — confirm it's progressing (`gh run watch <run-id>` up to 10 minutes; stuck past that → inspect logs, log it as blocked in lessons). Use the wait productively: review the diff, prep the next phase, strengthen tests. Don't start work that would conflict with the in-flight change.
3. **No task in hand?** Pick the next pending phase from plan.md and start it. After each meaningful edit run `bun run lint` + `bun run typecheck:all` + the touched package's `test` — catch mistakes in-step. Then commit → `gh stack push` (`gh stack sync` if dev or arc 1 moved).
4. **Stuck, or facing a decision you'd normally bring to me?** Don't wait. Call `/codex high` with full context and go back and forth until you two reach a defensible decision, then act on it. Log every consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge to dev/main, never publish or deploy, never change anything in the Presto repo, never expand scope beyond plan.md; if a decision requires crossing one, surface it and hold.
5. **Same step failed 5 times?** Stop retrying; reassess with codex, then continue down the agreed path.
6. **Phase green?** "Green" means THE PHASE'S VALIDATION GATE as written in plan.md passes (commands + pass criteria). Run the full gate, paste the result, mark ✓ in plan.md, file the lessons entry, print `LESSONS_FILE=implementations-plan/presto-migration/lessons/phase-N.md`, `agent-worktree status presto-migration "phase N green: <next>"`, advance. Arc boundary crossed (after P5, after P8)? Run the arc's codex loop FIRST (code_review is off — no /code-review): `/codex high` with the arc diff, the arc map, plan.md + ledger, the adversarial ask and the plan's no-over-engineering + comment-quality rules, resume until a round yields nothing material — THEN `gh stack add presto-migration/ux` (after arc 1) or proceed to step 7 (after arc 2).
7. **All phases ✓?** Final cross-arc pass: FRESH `/codex high` over the net diff from origin/dev @ 323380f6 + cross-arc ask + both rules, loop until clean. Then Delivery per plan.md — the FIRST time any PR is opened: `gh stack sync`, `gh stack submit --auto`, `gh pr edit` bodies, `gh pr checks --watch`. Then the wrap-up report: what shipped, every contentious decision codex and I debated with ELI5 context, open items (the min-age exclude removal PR after 2026-09-16T14:49Z; Asks A3/A5/A6). Surface and stop.

Keep the native task list current (`TaskUpdate` as steps start/finish; plan.md stays the source of truth).
```
