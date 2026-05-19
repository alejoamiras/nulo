# HTML source additions — chat-generated material (2026-05-12)

This document preserves the content generated in conversation that wasn't
saved to the original research files. It's the source-of-truth feed for
the HTML deliverables in `wallets-architecture-research/{index,nulo-phase-2}.html`
and `wallets-architecture-research/wallets/*.html`.

Originally drafted by Claude in a conversation refresher when the user
asked for an architecture-research review post all the implementation
phases. The ASCII diagrams, star ratings, and Phase 2 target architecture
are calibrated to **master @ post-PR-76** (v0.14.9), not to the May-8
research snapshot.

---

## Per-wallet runtime diagrams

### Rabby

ASCII diagram showing Rabby's popup ↔ SW (semi-persistent MV2-ish) ↔
offscreen relationship, with `persist-store` auto-broadcast + 5s keep-alive
ping (acknowledged hack) + PromiseFlow koa-middleware on rpcFlow:

```
   ┌───────┐    persist-store    ┌────────────────┐
   │ POPUP │ ◄══════════════════►│   SW (MV2-ish, │
   │       │    auto-broadcast   │   semi-persistent)
   └───┬───┘    (Proxy diff)     └────────┬───────┘
       │                                  │
       │  EIP-1193 over content-script    │  PromiseFlow (koa middleware)
       │  ↓                               │  rate-limit per origin
   ┌───────┐                              │
   │ dApp  │                              ▼
   └───────┘                     ┌────────────────┐
                                 │   OFFSCREEN    │ keep-alive ping every 5s
                                 │ (keystone HW)  │ (acknowledged hack)
                                 └────────────────┘
```

**Durable jobs**: `historyDbService` writes "I'm syncing" + progress marker
to IndexedDB BEFORE the loop. On next boot, RESUMES from the marker before
anything else runs.

### MetaMask

ASCII diagram showing MetaMask's `ObjectMultiplex` (3 channels over one
port), SW with `LazyListener` + deferred-init promise, offscreen sandbox
for Snaps + KeystoneHQ, IndexedDB backup of unrecoverable controllers,
numbered migrations:

```
                          ┌─────────────────────────────────┐
                          │  ObjectMultiplex over ONE port  │
                          ├──┬──┬──────────────────────────┤
                          │c │p │ provider                 │
                          │t │s │                          │
                          │r │t │                          │
                          │l │o │                          │
                          │  │r │                          │
                          │  │e │                          │
                          │  │  │                          │
   ┌───────┐  controller  │  │  │  EIP-1193    ┌───────┐  │
   │ POPUP │ ◄───────────►│  │  │ ◄──────────► │ dApp  │  │
   └───────┘  patch-store │  │  │              └───────┘  │
                          └──┴──┴──────────────────────────┘
                                  ▲
                                  │
                          ┌───────┴──────────┐
                          │   SW            │ LazyListener buffers events
                          │   (MV3)         │ during cold start; deferred-init
                          │                 │ promise gates EVERY onConnect
                          └───────┬─────────┘
                                  │
                          ┌───────▼─────────┐
                          │   OFFSCREEN     │ Snaps sandbox, KeystoneHQ HW
                          └─────────────────┘

                          ┌─────────────────────────────────┐
                          │ Storage strategy                │
                          │  chrome.storage.local           │
                          │   + IndexedDB BACKUP for the    │
                          │   three "always-backup" stores  │
                          │   (KeyringController etc.)      │
                          │  + numbered migrations          │
                          │   (failure-tolerant, sequential)│
                          └─────────────────────────────────┘
```

**Durable jobs**: approval state machine — `addRequest(...)` returns a
Promise that resolves on `acceptRequest` / `rejectRequest`. Each request
has a stable ID; UI surfaces are driven from state.

### Grego (extension-wallet)

ASCII diagram showing Grego's popup ↔ SW ↔ offscreen with explicit
`offscreen-ready` handshake + JSON-stringify fallback on `DataCloneError`
+ stub-account simulation overrides in the PXE:

```
   ┌───────┐                  ┌─────────────────┐
   │ POPUP │ ◄──── port ────► │   SW (MV3)      │ explicit `offscreen-ready`
   └───┬───┘                  │                 │  handshake required
       │                      └────────┬────────┘
       │  wallet-sdk                   │ JSON-stringify fallback
       │  capability protocol          │  on DataCloneError
   ┌───────┐                           │
   │ dApp  │                           ▼
   └───────┘                  ┌─────────────────┐
                              │   OFFSCREEN     │ PXE + BB-WASM
                              │                 │ stub-account sim overrides
                              │                 │  (real keys NEVER enter sim)
                              │                 │ single PXE per (chainId, ver)
                              └─────────────────┘
```

**Durable jobs**: NONE. Prove is a synchronous call; popup blocks. If SW
dies mid-prove, the work is lost. Acknowledged limit.

### Nulo today (master @ v0.14.9)

ASCII diagram of current Nulo runtime — 60s ServiceClient timeout, global
ReadWriteGuard on PXE, IPXE.getSyncedBlockHeader (PR 8c), stub-account
overrides (PR 8b), public-static fast path (PR 8c), 10s liveness heartbeat:

```
   ┌───────┐                  ┌─────────────────┐
   │ POPUP │ ◄── 60s timeout ►│   SW (MV3)      │ ServiceClient default 60s
   └───┬───┘   ServiceClient  │                 │  (90s offscreen-side)
       │                      │ ReadWriteGuard  │ GLOBAL serialize on PXE
       │                      │   on PXE        │  (per-(profileId,chainId)
       │                      └────────┬────────┘  scope but one lock)
       │                               │
       │                               │
   ┌───────┐                           ▼
   │ dApp  │              ┌─────────────────────────┐
   └───────┘              │   OFFSCREEN             │ PXE + BB-WASM
                          │                         │ stub-account sim ✅
                          │  IPXE.getSyncedBlock-   │ public-static fast path
                          │    Header (PR 8c)       │  (with mixed-payload v0.14.7)
                          └─────────────────────────┘

   Liveness:  `nulo:liveness` heartbeat (10s) keeps SW alive while
              popup is open.  When popup closes, next dApp message
              cold-boots BB-WASM from scratch (~5-10s).
```

**Durable jobs**: NONE today. ExecutionServiceClient blocks the popup; the
SW doesn't persist mid-prove state. Tx may settle even if the popup says
"failed" (60s wins the race).

---

## 12-dimension star rating table

Calibrated to current main (post-PR-76 / v0.14.9).

| Dimension                                | Rabby   | MetaMask | Grego   | Nulo (now) |
|------------------------------------------|---------|----------|---------|------------|
| Package / layer discipline               | ★★★     | ★★★★     | ★★      | ★★★★★      |
| Cryptography hygiene                     | ★★★     | ★★★★     | ★★★     | ★★★★★      |
| Aztec-specific correctness               | ★       | ★        | ★★★★    | ★★★★★      |
| Browser coverage                         | ★★★★★   | ★★★★     | ★★★★    | ★★★★       |
| MV3 / CSP hygiene                        | ★★★     | ★★★      | ★★★★    | ★★★★       |
| Durable jobs / long-running ops          | ★★★★    | ★★★★★    | ★       | ★          |
| Cold-start handling                      | ★★★     | ★★★★★    | ★★★     | ★★         |
| Storage / migration safety               | ★★      | ★★★★★    | ★★      | ★          |
| dApp ergonomics                          | ★★★★    | ★★★★     | ★★★★    | ★★★        |
| State / store architecture               | ★★★★    | ★★★★★    | ★★★     | ★★★        |
| Cross-service compile-time deps          | ★       | ★★★★★    | ★★      | ★★★        |
| UI maturity (chips, alerts, approval)    | ★★★★    | ★★★★     | ★★★★★   | ★★★        |

**Where we win**: package/layer discipline, crypto hygiene, Aztec
correctness (after PR 8c).
**Where we tie**: browser coverage, MV3 hygiene, state architecture.
**Where we lose**: durable jobs, cold-start handling, migration safety,
dApp UX, rate-limiting.

### Dimension glossary

- **Package / layer discipline**: are package boundaries lint-enforced;
  does any layer leak chrome.* into a lower one?
- **Cryptography hygiene**: KDF parameters, encryption-at-rest vs in-memory,
  key-zeroization discipline, ENCRYPTION_GUARD-style plaintext probes.
- **Aztec-specific correctness**: simulation overrides, fee-options
  completion, public-static fast path, account-contract adapter.
- **Browser coverage**: Chrome / Firefox / Safari support depth.
- **MV3 / CSP hygiene**: function-bind shim, Buffer/process polyfills,
  no eval / inline.
- **Durable jobs / long-running ops**: SW-death survival, AbortController
  wiring, persisted progress, resumable workflows.
- **Cold-start handling**: LazyListener-style event buffering at SW boot,
  deferred-init port gating, initialization promise discipline.
- **Storage / migration safety**: versioned + idempotent migrations,
  failure-tolerant boots, IndexedDB backup of unrecoverable state.
- **dApp ergonomics**: approval state machine, capability wildcards,
  per-app policy, rate limiting, transparency about NO_FROM / paymasters.
- **State / store architecture**: patch-based diffs, persist + anonymous
  flags per field, sub-channel multiplexing.
- **Cross-service compile-time deps**: compile-time-enforced messenger
  / DI graph; can a service touch something it shouldn't?
- **UI maturity**: how clearly the UI surfaces signals the user needs
  (chips, alerts, approval state, what's happening during long ops).

---

## "What Nulo took / left" buckets

### ✅ Took from Grego (Aztec parity)

- Stub-account sim overrides (PR 8b)
- Public-static fast path + mixed-payload variant (PR 8c)
- `completeFeeOptions({forEstimation: true})` shared translator (PR 9)
- JSON-stringify fallback on DataCloneError (PR 5)
- Firefox offscreen fallback (hidden minimized window) (PR 7)
- `function-bind` CJS stub for MV3 CSP (PR 4)
- Per-(origin, chainId) dApp sessions (PR 10)
- NO_FROM + paymaster UX chips (briefly, then reverted per user feedback)

### 🔁 Left for Phase 2 — the biggest single hole, deliberately scoped out

- AbortController plumbed through prove path
- Resumable jobs with persisted progress (Rabby R7)
- LazyListener for SW boot event buffering (MetaMask M3)
- unlockPromise pattern (Rabby R6)
- Per-(profileId, chainId) PXE concurrency (currently global ReadWriteGuard)
- `chrome.alarms` wake-up for incoming dApp messages

### ⏭ Left for "when we have real users"

- MetaMask-style numbered migrations (M6)
- IndexedDB backup for unrecoverable controllers (M7)
- Error reporting / telemetry
- Rabby-style rate-limit per origin (R5)

### ⏭ Left as future option (wider refactors, not now)

- PromiseFlow koa-style middleware (Rabby R3)
- PatchStore Immer-diffs (MetaMask M2)
- ObjectMultiplex N-channels-over-one-port (MetaMask M5)
- `@metamask/messenger` compile-time service deps (M1)
- Proxy-based persistent stores (Rabby R2)

---

## Nulo Phase 2 — durable-jobs target architecture

ASCII diagram of the proposed Phase 2 runtime — JobRegistry with persisted
state, AbortController per jobId, chrome.alarms wake-up to resume on cold
boot, LazyListener for boot-event buffering, PXEConcurrencyManager
per-(profileId, chainId):

```
   ┌─────────────────┐
   │   POPUP         │      submitJob(intent) → jobId
   │                 │    ◄──────────────────────────────┐
   │                 │    subscribeJob(jobId) → state  ◄─┤
   │                 │      ▲                            │
   └────────┬────────┘      │ never blocks. popup can   │
            │               │ close, re-open, observe.   │
            │               │                            │
            │               │                            │
   ┌────────▼─────────────────┴───────────────────────────┴────────────┐
   │   SW (MV3)                                                        │
   │                                                                   │
   │   ┌──────────────────┐    ┌────────────────────────────────┐     │
   │   │ JobRegistry      │    │ chrome.alarms                  │     │
   │   │                  │    │  (re-arm on cold boot to       │     │
   │   │  Map<jobId,      │◄───┤   resume pending jobs)         │     │
   │   │   Job state>     │    └────────────────────────────────┘     │
   │   │                  │                                            │
   │   │   pending        │    ┌────────────────────────────────┐     │
   │   │   simulating     │    │ LazyListener (boot buffer)     │     │
   │   │   awaiting-user  │◄───┤  events that fire pre-init     │     │
   │   │   proving        │    │  replay when ready             │     │
   │   │   submitting     │    └────────────────────────────────┘     │
   │   │   succeeded      │                                            │
   │   │   failed         │    ┌────────────────────────────────┐     │
   │   │   cancelled      │◄───┤ AbortController per jobId      │     │
   │   │                  │    │  popup.cancelJob → signal      │     │
   │   │  Each transition │    │  propagates into PXE prove     │     │
   │   │  persisted to    │    └────────────────────────────────┘     │
   │   │  storage.local   │                                            │
   │   │   + IDB backup   │    ┌────────────────────────────────┐     │
   │   │                  │◄───┤ PXEConcurrencyManager          │     │
   │   └──────────────────┘    │  per-(profileId, chainId)      │     │
   │                           │  lock — reads parallel,        │     │
   │                           │  writes serialized within scope│     │
   │                           │  (today: ONE global lock)      │     │
   │                           └────────────────────────────────┘     │
   └───────────────────────────────────────────┬───────────────────────┘
                                               │
                                               │  job tasks dispatch
                                               ▼
                                  ┌─────────────────────────────┐
                                  │   OFFSCREEN                 │
                                  │   PXE + BB-WASM             │
                                  │                             │
                                  │  proveTx({ jobId, signal }) │
                                  │  simulateTx(...)            │
                                  │  per-job tracing            │
                                  └─────────────────────────────┘
```

### Lifecycle walkthrough — "send a tx" as state machine

```
  dApp / popup
       │
       │  submitJob({ kind:"aztec_sendTx", payload, opts })
       ▼
  SW JobRegistry.create()
       │  status=PENDING; persist; return jobId
       ▼
  ┌────────────────────────────────────────────────┐
  │ status=SIMULATING                              │
  │  → simulate (with abort signal)                │
  │  → write result fields to job state            │
  └────────┬───────────────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────────────┐
  │ status=AWAITING_USER                           │
  │  → SW opens execute window with jobId          │
  │  → user can: approve / reject / close window   │
  │  → popup closing does NOT cancel; just stops   │
  │    observing                                    │
  └────────┬───────────────────────────────────────┘
           │  user clicks Approve
           ▼
  ┌────────────────────────────────────────────────┐
  │ status=PROVING                                 │
  │  → offscreen.proveTx({jobId, signal})          │
  │  → popup can close; SW keeps working           │
  │  → if SW dies: chrome.alarms wakes it back up; │
  │    JobRegistry sees status=PROVING; calls      │
  │    resumeProve()                               │
  └────────┬───────────────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────────────┐
  │ status=SUBMITTING → SUCCEEDED                   │
  │ or                                              │
  │ status=FAILED (with reason) / CANCELLED         │
  └────────────────────────────────────────────────┘

  Popup observes via subscribeJob(jobId). Renders status from registry.
  Closing popup mid-prove no longer aborts the work.
```

### Shopping list

| # | Item                                              | Estimate    | Depends on |
|---|---------------------------------------------------|-------------|------------|
| 1 | JobRegistry primitive (state machine + persist)   | ~1 week     | none       |
| 2 | AbortController plumbed through prove / sim       | ~2-3 days   | (1)        |
| 3 | Execute window: subscribe-by-jobId pattern        | ~1 week     | (1)        |
| 4 | `chrome.alarms` wake-up + resume policy           | ~3-4 days   | (1)        |
| 5 | LazyListener for SW boot event buffering          | ~2-3 days   | none       |
| 6 | PXEConcurrencyManager per-(profileId, chainId)    | ~3-4 days   | (1)        |
| 7 | IDB backup for unrecoverable state                | ~3 days     | none       |
| 8 | Versioned migrations framework                    | ~1 week     | (7)        |

Total realistic estimate: **3-6 focused weeks**.

### Borrowed-from-whom mapping

| Component                    | Origin reference                          |
|------------------------------|-------------------------------------------|
| JobRegistry + state machine  | MetaMask's approval state machine (M8)    |
| Persisted progress markers   | Rabby's `historyDbService` (R7)           |
| `unlockPromise` await pattern| Rabby's `perpsService` (R6)               |
| LazyListener boot buffering  | MetaMask M3                               |
| Deferred-init port gating    | MetaMask M4                               |
| Migrations framework         | MetaMask M6                               |
| IDB backup                   | MetaMask M7                               |
| Capability wildcards (later) | Grego's `authorization-manager.ts` (A11)  |
| Rate-limit per origin (later)| Rabby's notification service (R5)         |

### Non-goals (Phase 2 explicitly stays away from these)

- Re-doing the package/layer model — it's already production-quality.
- Cryptography churn — PasswordSecretBox + M2.6 vectors stay as-is.
- Aztec correctness rework — PR 8c shipped; no more sim-pipeline changes.
- Storybook / visual regression / e2e infra — separate track (M6 + parallel-e2e-isolation plan).
- Frontend / UI redesign — Phase 4 territory.
- LavaMoat / Snaps — explicitly Phase 4+.

### The single most valuable single PR

```
JobRegistry + AbortController + subscribe-by-jobId in execute window.
Items 1-3 above.

Unblocks every other production concern. Even without 4-8, SW death
recovery improves immediately because state is persisted.
```

---

## Calibration metadata

| Field             | Value                                    |
|-------------------|------------------------------------------|
| Source date       | 2026-05-08 (initial research)            |
| Calibration       | 2026-05-12 (post-PR-76 / v0.14.9)        |
| Repo HEAD         | `master` (squash-merged through PR #76)  |
| Aztec pin         | `4.2.0`                                  |
| Browsers built    | Chrome MV3 + Firefox MV3                 |

---

# Phase 2+ — durable jobs done right (post-merge addition)

Source: consolidated from chat reasoning (claude) + an independent codex review (session `019e1cfc-9b6a-7003-a903-3807d7c047b8`, 2026-05-12).

The original 8-item Phase 2 reaches ~4/5 on the durable-jobs dimension, not 5/5. The full version requires six properties Phase 2 leaves on the table (fairness, idempotency, retry, tombstones, sweeper, attach/detach), plus chaos discipline in CI, plus narrow formal methods on the critical state machines.

## Six properties Phase 2 leaves on the table

1. **Fairness** — priority queues (user-blocking jobs jump ahead of background work); per-(origin, profileId) caps so a noisy dApp can't starve the rest.
2. **Idempotency** — every job carries a key derived from `(origin, intent-hash, nonce, salt)`; resubmitting the same intent resolves to the same `jobId`.
3. **Retry policy** — distinguish retryable from terminal errors; exponential backoff with a cap and budget for retryables; terminals skip retry.
4. **Tombstones** — terminated jobs are marked, not deleted; a late `chrome.alarms` wake-up that finds `status=PROVING` for a tombstoned job does nothing.
5. **Sweeper** — periodic scan moves stuck jobs (e.g. `PROVING` > 10min with no heartbeat) into a DLQ surfaced to the user.
6. **Attach / detach** — a freshly-opened popup can subscribe to in-flight `jobId` at any time; multiple observers allowed (popup re-opened on a different tab, future side-panel surface, etc.) without coupling the job's lifecycle to any of them.

## Considered, not pursued — product decisions

Two ideas surfaced during the design conversation that are technically tractable but were ruled out as **product** decisions. Recorded here so the thinking isn't lost; not part of Phase 2+ scope.

- **Dedicated progress window** — a detached `chrome.windows.create({type:"popup"})` owning long-running prove UI, with the main popup as an observer. Adds a second long-running UI surface to design, maintain, and explain. The popup stays as Nulo's single user-visible surface; subscribe-by-jobId via the attach map already covers close-and-rejoin without a separate window.
- **Desktop proving companion** — an optional Tauri-style native daemon hosting PXE + BB-WASM long-running, sidestepping MV3's SW-death entirely via WebSocket. Introduces a parallel native distribution channel — separate install/update story, code signing, platform builds. The wallet stays browser-only; in-extension durability is what Phase 2+ delivers.

## Chaos discipline (first-class)

- SW-kill chaos in CI; verify recovery via alarms + tombstones
- Approval-spam drills; verify per-origin rate limit + fairness
- Malicious-dApp suite (replay, double-submit, invalid sigs, permission escalation)
- Cold-boot fuzzing; verify LazyListener captures all messages during the first 500ms

(Storage-corruption drills move with the rest of the storage-safety work to Maximalist persistence-spine.)

## Delta from Phase 2

| Phase 2 item | Phase 2+ addition |
|---|---|
| 1. JobRegistry FSM | + scheduler with priority queues; + idempotency map; + tombstone table; + attach map |
| 2. AbortController | + heartbeat from prove → sweeper detects stale |
| 3. Execute window subscribe | (unchanged — subscribe-by-jobId + attach map covers it) |
| 4. chrome.alarms wake-up | + sweeper alarm for stuck-job detection → DLQ |
| 5. LazyListener | (unchanged) |
| 6. PXEConcurrencyManager | + fairness caps per-(origin, profile) |
| 7. IDB backup | (unchanged in Phase 2+; invariant validator on every read + corruption quarantine move to Maximalist persistence-spine) |
| 8. Migrations | (unchanged in Phase 2+; rollback drills + migration test harness move to Maximalist persistence-spine) |
| — | **NEW:** retry policy (retryable vs terminal) |
| — | **NEW:** chaos discipline in CI (SW-kill, approval-spam, malicious-dApp, cold-boot fuzzing — storage-corruption drills move to Maximalist persistence-spine) |
| — | **NEW:** narrow formal methods (job FSM + permission matcher) |

Rough scope: Phase 2+ is ~1.5-2× Phase 2 (~5-8 weeks for the six properties + chaos + narrow formal methods), all on the same single browser-extension surface.

---

# Maximalist Nulo — 5/5 across the board (post-merge addition)

Source: consolidated from chat reasoning (claude) + the same codex review.

## The single biggest reframe

The 5/5 wallet is **not** bigger features on top of a fragile runtime. It's a **runtime-reliability program** (Phase 2+) at the spine, with everything else hanging off it — Aztec depth, dApp ergonomics, supply-chain hardening, network privacy, cross-browser parity. Wallet stays browser-only; the design discipline is "make the extension impossible to kill, not bigger."

## Per-dimension 5/5 (only dimensions currently below 5/5 listed)

| Dimension | Today | 5/5 means | Steal from |
|---|---|---|---|
| Cryptography | 4/5 | Strict mode default; authenticated export; no bearer-equivalent `passhash` persistence; passkey-first unlock; Argon2id auto-tuned + floor; encrypted-at-rest for ALL PII; KAT vectors for every crypto op; anti-rollback monotonic counter; compromise-recovery flow | Broader appsec; Grego's Argon2id posture |
| Aztec correctness | 4/5 | Account contract registry; first-class key rotation via Aztec `KeyRegistry`; L1↔L2 + outbox proofs; replay-safety across re-orgs; differential conformance suite vs upstream (nightly); race-correct multi-pending nonce | Grego's upstream fluency; broader L2 ecosystem |
| Browser coverage | 2/5 | Chrome/Brave/Edge parity; Firefox MV3 from one source tree; Safari Web Extensions as separate target | Grego's Firefox offscreen fallback; Rabby's shims |
| MV3 hygiene | 3/5 | Top-level listener registration; LazyListener; init gating; no keepalive dependence; deterministic offscreen lifecycle; chaos-tested SW death; `chrome.storage.session` for ephemeral state | MetaMask LazyListener; Grego ready-gate |
| Durable jobs | 1/5 | Full job system (see Phase 2+) | MetaMask ApprovalController shape; Rabby persisted-progress |
| Cold-start | 1-2/5 | Zero lost events; bounded boot budget; queued requests during init; PXE prewarm; resume-on-alarm; no "wallet not ready" to dApps | MetaMask init gating; Grego singleton-per-chain |
| Storage / migration | 2/5 | Numbered migrations + snapshots + checksums + corruption quarantine + IDB backup + invariant validator + export/import + migration test harness + rollback drills; runtime schemas at every boundary | MetaMask persistence-manager |
| dApp ergonomics | 3/5 | Batch approvals; capability wildcards; remembered grants; per-origin rate limits; WC v2; EIP-6963; SIWE-equiv; rich tx preview (humanized intent + state diff + warnings) | Rabby's `unlockPromise`; Grego capability wildcards |
| State architecture | 3-4/5 | Single owner per domain; runtime schemas at IPC boundaries; no raw storage in popup; thin UI; replayable job/event logs. Keep typed `Service<Methods,Events>`; add Grego-style runtime validation. NOT `@metamask/messenger`/ObjectMultiplex/PatchStore | Keep Nulo's boundary; add Grego validation |
| UI maturity | 2/5 | In-popup job-queue visibility (in-flight + stuck); resume/cancel/retry UX; humanized warnings; Storybook/Histoire; Lost Pixel; WCAG AA + axe-core in CI; i18n; theming; perf budgets; keyboard shortcuts + command palette + JSON-RPC console | Grego's Aztec-specific chips |

## New dimensions worth adding (NOT in the original 12)

1. **Network-layer privacy** — RPC routing discipline; metadata minimization; Tor/VPN-friendly endpoints; polling-rate ceilings; sender-address rotation; private note discovery
2. **Supply chain & release integrity** — Reproducible builds; provenance attestations; dependency allowlists; signed releases; deterministic bundles; SBOM in CI. Not full LavaMoat on day one
3. **Observability + incident response** — Privacy-preserving structured traces; local redaction-first logs; user-exportable encrypted debug bundles; opt-in aggregate metrics
4. **Threat modeling + chaos discipline** — Documented threat model per release; regular red-team; SW-kill chaos; corrupted-storage drills; malicious-dApp suite
5. **Narrow formal methods** — Model-check the critical state machines. In Phase 2+: job state machine + permission wildcard matcher. In Maximalist persistence-spine: migration invariants. TLA+ or Alloy. NOT broad formal verification

## The five tracks

- **Runtime-reliability program** (months 1-3, gating) — Phase 2+ in full
- **Persistence spine** (months 1-4, parallel)
- **dApp + UX** (months 3-6) — depends on runtime spine
- **Surface** (months 5-8) — Firefox MV3 parity from one source tree; Safari Web Extensions as a later target
- **Hardening + assurance** (months 6-12) — supply chain, network privacy, telemetry, threat modeling, chaos, narrow formal methods

## Deliberately NOT in scope

- **Dedicated progress window** — adds a second long-running UI surface; popup + subscribe-by-jobId already covers close-and-rejoin. *Product decision.*
- **Desktop proving companion** — parallel native distribution channel out of scope; wallet stays browser-only. *Product decision.*
- **Mobile (RN / native)** — Aztec proofs are long; mobile makes them longer. *Product decision.*
- Account abstraction features (social recovery, session keys, M-of-N) — product bets, not quality dimensions. Adopt upstream Aztec when canonical
- LavaMoat on day one — supply-chain track lands after architecture stabilizes
- Replace typed `Service<Methods,Events>` with `@metamask/messenger`/ObjectMultiplex/PatchStore — Nulo's boundary is already 5/5
- Broad formal verification of the wallet — narrow scope is the point

## Where the comparative study undershoots

- Treats durable jobs as 4/5-ceiling with the 8-item Phase 2. 5/5 needs fairness, idempotency, retry, tombstones, sweeper, attach/detach, chaos (codex)
- Underweights network privacy — for a privacy wallet, metadata leakage is as architectural as encryption (codex)
- Overweights MetaMask-style framework mass — Nulo does not need `@metamask/messenger`/ObjectMultiplex/PatchStore (codex)
- Treats AA features as plausible quality expansion — they're product bets until upstream canonizes (codex)
- Doesn't surface missing dimensions (supply chain, observability, network privacy, threat modeling, formal methods) as star columns (chat)
- Implies sequential phases when the reality is mostly-parallel tracks with one gating piece (chat)

---

# Carries from Phase 2 → Phase 2+ (post-merge addition)

Source: chat reasoning answering "could we implement Phase 2 and then Phase 2+?".

Phase 2 and Phase 2+ are designed to be implementable as separate lifts. Splitting works because Phase 2+ is mostly additive on top of Phase 2 — but only if Phase 2 makes five forward-looking design choices ("carries") so it doesn't paint itself into a corner. None of these are extra work; they're each a few lines.

1. **Tag every job with `(origin, profileId, kind)` at create-time** — Phase 2 doesn't use the metadata, but Phase 2+ needs it for fairness and per-origin rate limiting. Adding later touches every callsite.
2. **Don't delete terminal jobs; keep them with a flag or long TTL** — Phase 2+ tombstones and idempotency dedup both resolve to an existing terminal jobId. Deleting them means Phase 2+ needs a schema migration.
3. **Subscribe path uses `Map<jobId, Observer[]>` from day one** — even with single-observer runtime in Phase 2. Refactoring single-to-list later touches the whole subscribe API.
4. **Progress-event payloads are extensible — `{ stage, ...rest }`** — Phase 2+ adds heartbeat fields the sweeper reads. Positional args = breaking change in Phase 2+.
5. **Don't collapse error categories at the prove boundary** — preserve the raw error shape from PXE. Phase 2+ retry policy needs to classify retryable-vs-terminal; if Phase 2 maps everything to "Simulation failed", classification is dead on arrival.

## What's additive (free to bolt on with no carries needed)

- Sweeper (new alarm registration)
- Retry policy (new classification layer)
- Chaos discipline (test/CI only)
- Narrow formal methods (verification only, no runtime change)

## What's NOT compatible with the split

Nothing structural. Phase 2+'s reframe ("a state machine is not a job system") doesn't break Phase 2's FSM — it wraps it.

## Why the split is probably the right call

Half of Phase 2+ is hardening for production-scale edge cases that Phase 2 traffic might never reveal. Fairness matters under queue contention. Idempotency dedup matters under retry storms. Sweepers matter when stuck jobs are a measurable percentage. With single-digit-user traffic, you might never hit any of those. Ship Phase 2 with the 5 carries; let real failure modes (or their absence) tell you which Phase 2+ items are load-bearing.
