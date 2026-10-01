# M4 — Final user decisions + reshaped scope

Date: 2026-04-26
Decision owner: project maintainer

This document captures the user's decisions on each M4.x audit-diff plus follow-up reshaping. Supersedes individual `audit-diff.md` "Status" sections.

## Production quality bar (applies to all shipping plans)

User's explicit constraint: **"make all the implementations unit testable and modularized up to the best production standards."** Every shipping plan must honor:

1. **Pure functions where possible** — core logic in `@nulo/wallet-core` / `@nulo/wallet-crypto` with zero `chrome.*` references.
2. **Dependency injection for ports** — `AlarmsPort`, `BrowserApi`, `ILogger`, registry fetchers, all injected. Tests use `FakeBrowserApi` from `@nulo/wallet-core/testing` — no `vi.mock` for chrome APIs.
3. **Single responsibility per module** — extract helpers (e.g. `verifyArtifactClassId`, `zeroize`, `pxeDataDir`) as standalone files with their own tests.
4. **No singletons** — only at composition root. Construct + inject explicitly.
5. **Test seams at every boundary** — every async crossing has a way to drive it from a test (clock, alarms, storage, network factory).
6. **No untyped `any`** — `unknown` + zod at boundaries; explicit casts only with `// biome-ignore` + reason.

Plans that don't honor these get rejected at review time. Per-plan section below calls out the seams.

## Per-PR decisions (final)

### M4.1 — Content-script scope ✱ RESHAPED → light hardening only

**User context**: "We're a web extension wallet, we want to be able to inject into any app that wants to talk with us. But unsure how the wallet-sdk works."

**Investigation result** (verified at `(Aztec packages source tree)/yarn-project/wallet-sdk/src/extension/handlers/content_script_connection_handler.ts`):
- The discovery protocol is **page-initiated**: dApp calls `ExtensionProvider.discoverWallets(...)` which posts `WalletMessageType.DISCOVERY` via `window.postMessage(..., '*')`.
- Without a content script already listening on `window.addEventListener('message', ...)`, the discovery is silently dropped.
- There is no alternative protocol (no `chrome.runtime.connect()` from page, no sentinel meta tag, no extension-API on the page side).
- The upstream `ContentScriptConnectionHandler` (~80 LOC) is already clean: filters `event.source !== window`, JSON.parse with try-catch, no `eval`, no DOM writes, no page-state access. **Defense-in-depth is already in place.**
- **Conclusion**: broad injection is REQUIRED. Designs 1.5 (allowlist) and 2 (dynamic registration) would break the ecosystem.

**Final scope** (much smaller than original memo):
1. **Document the threat model** in SECURITY.md: "wallet content script runs on every page; this is a protocol requirement of `@aztec/wallet-sdk` discovery." Make it explicit so future contributors don't try to "fix" it without the context.
2. **Audit + minimize the local content script** (`packages/extension/src/content-script/content.ts`): currently 22 lines, just a relay. Verify nothing else creeps in over time (add a lint rule capping its size?).
3. **Tighten message envelope validation** at the SW seam (zod schema for incoming `ContentScriptMessage` shapes). Already partially done; verify it covers all `InternalMessageType` cases.
4. **No manifest changes**. No dynamic registration.

**Defer**:
- The "audit upstream `ContentScriptConnectionHandler` for hidden behavior" prework — already done above; clean.
- Hostile-frame envelope rejection tests — wrong invariant since upstream already filters `event.source !== window`. Not pursuing.

**Testability**: the SW-side message validator should be a pure zod schema parser in its own file, unit-testable without chrome APIs.

**Status**: ready for execution after a short v1 plan revision (drop Design 2 + Design 1.5 narratives).

---

### M4.2 — Harden session secret ✱ RESHAPED → opt-in "Strict Security Mode"

**User context**: "Would that mean introducing the password each time? Sounds like an annoying trade-off."

**Decision**: don't ship Design B as default. Instead, ship **opt-in "Strict Security Mode"** — a config flag that flips the wallet from "passhash bearer" (default, current) to Design B (re-auth on SW restart). Default off; advanced users (or compliance contexts) can enable.

This honors:
- **No UX regression for existing users** — default behavior unchanged.
- **Security path available** for users who want it — opt-in flag is real, tested, with M2.6 vector pinning the design.
- **Documents the threat model** in SECURITY.md alongside the toggle.

**Reshape**:
1. New config flag: `strictSecurityMode: boolean` (default `false`). Lives in privacy/external-services settings UI.
2. When false: today's `passhash` bearer behavior. No change.
3. When true: Design B — `passhash` field is NOT persisted. SW restart → wallet locks. Popup shows lock screen on next interaction.
4. M2.6 vector: pin the wrap/unwrap round-trip behavior of the strict-mode SessionToken (when implemented).
5. UI copy: "Require password on every SW restart. More secure but you'll re-enter your password more often."

**Testability**:
- `SessionManager` is already a class with DI-able `BrowserApi`. Strict mode is a behavior switch — clean.
- Unit tests cover both modes via `FakeBrowserApi`.
- M2.6 vectors run before/after.

**Status**: planning ready, but **awaiting user approval of opt-in approach before transitioning to execution plan**. Lower priority than the always-on improvements.

---

### M4.3 — Registry trust ✓ SHIPS

**Decision**: ship as-is, applying audit-diff fixes:
- Move `verifyArtifactClassId` call into `ArtifactRegistry.resolve` (not the fetcher).
- Drop redundant recompute on "known" branch (already class-id-keyed at load time).
- Cache verified class-ids in `Set<string>`.
- Fix imports.

**Testability**:
- `verifyArtifactClassId` is a pure helper in its own file with unit tests.
- `ArtifactRegistry` already has DI seams (`RegistryFetcher`, `KnownArtifactsLoader`); tests construct fakes.
- Test the seam: `resolve(classId)` with a mocked fetcher returning a tampered artifact rejects.

---

### M4.4 — Offscreen recoverability (Option A) ✓ SHIPS

**Decision**: Option A only — observability + send-failure cleanup. **Defer Option B** (durable pending state) as future improvement if telemetry shows real recovery need.

**Telemetry data policy** (user-flagged: very sensitive):

ALLOWED in `RequestTelemetry` payloads:
- **Method name** (string, e.g. `"getGasBalances"`) — already exposed as a service method
- **Request ID** (number) — internal correlation only
- **Timing** (`startedAtMs`, `endedAtMs` epoch ms)
- **Terminal status enum** (`success` | `rejected` | `timeout` | `disconnected` | `send_failed`)
- **Detail field**: ONLY the structured error code/category. NO untyped error messages, NO request params, NO response data.

DISALLOWED:
- Request params (could contain addresses, amounts, encrypted blobs).
- Response data (could contain secrets, balances, contract artifacts).
- Stack traces (could leak file paths or internal state).
- User identifiers.

The plan must add a **`sanitizeTelemetry(t: RequestTelemetry): RequestTelemetry`** helper that strips untrusted fields. Audit-time invariant: `LoggingTelemetrySink` only ever calls `sanitizeTelemetry()` before logging.

**Reshape (in-place)**:
- Drop `orphaned` terminal + alarm reap (codex BLOCKING — was unreachable behind 90s timeout).
- Add `send_failed` terminal + try/catch around `sendMessage(...)` with synchronous cleanup.
- `pendingMeta` stays in-memory (recovery is descoped per Option A).
- Idempotency catalog: **document only** (not enforced) — annotation comment per `PxeServiceClient` method classifying safe-to-retry / unsafe / compensating. Useful prereq for Option B if it ever ships.

**Testability**:
- `TelemetrySink` interface: `Noop` + `Logging` + `MemorySink` (test-only, captures terminal events).
- `sanitizeTelemetry` is pure — unit tested with adversarial inputs.
- Send-failure path tested via `FakeBrowserApi` runtime port that rejects sendMessage.

---

### M4.5 — Proactive TTL ✓ SHIPS

**Decision**: ship as-is, applying audit-diff fixes:
- `scheduledTime` gate on alarm handler (ignore stale deliveries).
- Sync `EventHandler.add` callback with `void (async () => { ... })()` async helper.
- Lock immediately if `since + newTtl <= Date.now()` on config TTL shrink.
- Rewrite startup-fence claim (services register listeners in ctors before `services.start()`; `ensureInitialized()` is the actual fence).

**Testability**:
- All alarm orchestration goes through `AlarmsPort` (already DI'd via `BrowserApi`).
- `FakeBrowserApi` already supports `trigger(name)` for fake alarm firing.
- 9+ test cases per plan; each tests a distinct invariant.

---

### M4.6 — Best-effort zeroization ✓ SHIPS (already user-approved as M4-first)

**Decision**: ship, applying audit-diff fixes:
- Add 5 missed zeroize sites (`confirmProfileOperation`, `exportPlain` password branch, `exportMnemonic`, `restore` password branch, passkey `restore` branch).
- Promote caller-vs-callee responsibility from "checklist" to **explicit JSDoc edits** on `sealWithPasshash`, `unsealWithPasshash`, `SessionManager.open`.
- Fr self-test covers BOTH `Fr.fromBuffer(Buffer.from(...))` AND `Fr.fromBufferReduce(Buffer.from(...))` patterns.

**Testability**:
- `zeroize` is a pure free function in `@nulo/wallet-crypto/src/zeroize.ts`. Single-file unit tests.
- Caller-side wiring tested via existing `PasswordSecretBox` / `SessionManager` test suites — extended to assert the `try/finally` runs (e.g. throw mid-body, assert `zeroize` was called via spy).

---

### M4.7 — Per-collection schema migrations ✱ SUPERSEDED (2026-07-01)

> **Superseded by [`storage-migration-framework`](../storage-migration-framework/plan.md)**: a data-preserving versioned migrator shipped BEFORE production (user decision — the transform machinery, not a wipe, is the product). The re-opened design resolved this entry's 3 blockers differently than sketched: a single global version with backend-aware, footprint-declaring migrations (per-collection version vectors were evaluated against MetaMask/Rabby and rejected); the "shared lock" became boot-position single-flight + a statically-enforced UI storage facade; the wipe model is deleted outright (launch shape = schema v1, fresh installs stamp max). The original deferral text is preserved below for the record.

**User context**: "Not entirely sure what you mean 'per-collection' but maybe I just trust you? Still no user has this app so upgrade path for storage is not needed... once we do have users, I'll appreciate this task."

**Decision**: **Defer until users exist.** Pre-launch, the wipe-everything-on-storage-version-bump is fine — there's nothing to preserve. Once we ship + have users, M4.7 becomes critical (no user wants their wallet wiped on upgrade).

**Implication for M4.10**: M4.10 was scoped to depend on M4.7 for IndexedDB rename. Per user decision below, M4.10 also defers — no conflict.

**Re-open trigger**: when the wallet has paying users / production deployment, schedule a planning revision pass (the audit found 3 BLOCKING design errors that need reshape — backend-aware migrator, shared lock registry, etc. — those need to land in the v1 plan).

**Status**: plan + audits archived. Re-open when production-launch is on the horizon.

---

### M4.8 — Passkey session symmetry ✱ FOLLOWS M4.2

**User context**: "same question as M4.2 — the trade off is bad, or maybe this can be an 'advanced' option for security."

**Decision**: roll into M4.2's "Strict Security Mode" toggle. When the user enables strict mode:
- Password profiles re-auth on SW restart (M4.2 Design B).
- Passkey profiles re-PRF on next popup interaction (M4.8 Design X — happens to already be the default).

Default mode (strict OFF):
- Password profiles silently restore (today's behavior).
- Passkey profiles re-PRF (today's behavior — already asymmetric).

So strict-mode ON converges both flows. Strict-mode OFF preserves today's asymmetry but documented + acknowledged.

**Reshape**: M4.8 plan revises to:
1. Remove the "decision-memo" framing.
2. Specify Design X as the always-on behavior (matches today).
3. SECURITY.md update: clarify the asymmetry vs. strict-mode equivalence.
4. No `nulo:passkey:pending` storage. No Design Y.

**Testability**: passkey flow already covered by E2E + crypto vectors. Strict-mode unit tests share with M4.2.

**Status**: rolls into M4.2 strict-mode opt-in. Plan rolls forward when M4.2 ships.

---

### M4.9 — RP ID build-time contract ✓ SHIPS

**Decision**: ship as-is, applying audit-diff fixes:
- Patch BOTH `rp.id` (`popup/windows/passkey/index.vue:40`, the create flow) AND `rpId` (`:88`, the get flow). Plan v0 missed the create flow.
- Read **source manifest configs** (`manifest.config.ts`, `manifest.{chrome,firefox}.config.ts`) directly. Don't read built `dist/*/manifest.json` — they don't exist or are stale at pre-build time.
- Move script + tests into `packages/extension/src/wallet/passkey/` (under `src/`) so existing Vitest/TS configs pick them up.
- Use TS AST walk (ts-morph) for drift detection, not raw grep.
- Update existing `SECURITY.md:7-29` "Passkey RP ID" subsection (don't create a new one).

**Testability**:
- `check-rp-id.ts` is a pure function: `(manifestModule, rpIdConstant) => ValidationResult`. Unit-tested with synthetic manifest fixtures.
- AST scanner is pure: `(sourceFile, expectedConstant) => DriftFindings[]`.

---

### M4.10 — Per-RPC PXE isolation ✱ DEFERRED + flagged for network-model rework

**User context**: "I think this is a deeper problem that we are assuming each RPC is another network internally, right? When we shouldn't — an RPC is how we connect to a network. What do you think about deferring and actually improving how this works after?"

**Decision**: **Defer M4.10. User's intuition is correct — the model is wrong.**

The current `Network` entity carries `chainId` AND `rpcUrl` together. That conflates "logical chain" with "endpoint." The right model is:

```
Network              { chainId, name, /* metadata */ }
NetworkEndpoint      { networkId, rpcUrl, label?, healthStatus? }  // 1:N to Network
ActiveEndpoint       { networkId, currentEndpointId }              // user's active pick
```

PXE state belongs at the `Network` level (per `chainId` + `profileId`), not per endpoint. Switching endpoints within the same network should reuse PXE state — that's the actual user intent.

**M4.10 is replaced by a follow-up effort**: "Network-model rework — split networks from endpoints." Sized: planning + audit + execution. Likely 3-5 days execution after planning.

**Re-open trigger**: when this becomes a real user pain (e.g. a user can't switch between testnet RPCs without losing state). The current "single-RPC-per-Network" model works for now.

**Status**: plan + audits archived. Re-open with the network-model rework pre-work.

---

### M4.11 — Encrypted metadata at rest ✱ DEFERRED (unchanged)

**User context**: "keep deferred."

Unchanged from earlier deferral.

## Final M4 ship list (4 PRs)

In recommended execution order:

1. **M4.6** — zeroization (hours, user-approved as M4-first).
2. **M4.9** — RP ID build-time gate (1-2d).
3. **M4.5** — proactive TTL (1-2d).
4. **M4.4** — offscreen Option A: telemetry + send-failure cleanup (3-5d).
5. **M4.3** — registry trust + class-id validation (2-4d).
6. **M4.1** — content-script light hardening + threat-model docs (1-2d).

Total: ~10-15d execution wall-time.

## Deferred (5 PRs)

- **M4.2** — opt-in Strict Security Mode (planning ready, ships when user approves the toggle approach).
- **M4.7** — per-collection migrations (re-open when users exist).
- **M4.8** — folds into M4.2 when M4.2 ships.
- **M4.10** — replaced by network-model rework (separate effort).
- **M4.11** — encrypted metadata at rest (unchanged deferral).

## Branch state

`planning/m4` branch has:
- 11 plan files (M4.1–10 + M4.11 stub).
- 30 audit files (10 codex + 10 agent + 10 audit-diff).
- 2 master files (README + AUDITS-SUMMARY).
- 1 decisions file (this).

Total: 44 files.

## Next steps

1. Update each affected `plan.md` with a "Pre-execution revision" header pointing to this DECISIONS.md.
2. Mark deferred plans (`M4.2/7/8/10/11`) with explicit DEFERRED status banner.
3. Squash-merge `planning/m4` to master.
4. Begin M4.6 execution.

---

## Post-M4 follow-up: M4.10 network-model rework (EXECUTED 2026-04-27)

The "split networks from endpoints" rework flagged above ran as its own arc.
Plan + audits live under `implementations-plan/M4/10-network-rework/`
(`plan-v1.md` → `plan-v4.md` after dual audit). The original `M4/10/plan.md`
(per-RPC PXE isolation) is preserved as **SUPERSEDED**.

### Final shape (replaces the conflated `Network`)

```ts
Network          { id, profileId, chainId, name, primaryEndpointId, endpoints: NetworkEndpoint[], kind? }
NetworkEndpoint  { id, rpcUrl, label? }
```

`primaryEndpointId` is the resolved endpoint for `getNode(chainId)`. Switching
endpoints within the same chain reuses PXE state — that was the user's
original intent. Pending txs pin to the URL they were submitted on
(`Tx.submittedEndpointUrl` + URL-keyed `AztecNode` cache + 3-strike eviction).

### Storage version + cascade

- **Storage version 3** (no per-collection migrator). `migrate.ts` wipes and
  reseeds via `getOrInitNetworks()`. **No migration tests** —
  see `memory/feedback_no_migrations_pre_launch.md`.
- **`purgeChain(profileId, chainId)`** is the single cascade coordinator.
  Awaited, deterministic order, PXE last via SW→offscreen RPC. Used by
  `deleteNetwork` and `deleteProfile`.

### Ship status

| PR | Branch | Notes |
|---|---|---|
| PR-1 | `m4.10/01-core` | Core entity rewrite, cascade, polling pin, URL-keyed cache. 0.13.10 → 0.13.12. Manually QA'd. |
| PR-2 | `m4.10/01-core` (continued) | Per-Network detail page + endpoint CRUD popups. 0.13.13. E2E verified — zero regressions tied to PR-2 (3 pre-existing infra fails on `fee-methods.test.ts`, plus 3 known timing flakes). |
| PR-2 polish | `m4.10/01-core` (continued) | Chevron on networks list rows. 0.13.14. |
| PR-3 | `m4.10/03-e2e-docs` | E2E expansion (`endpoints.test.ts`, `sw-restart-network.test.ts`) + docs (this entry, `M4/10/plan.md` SUPERSEDED, `M4/README.md`, `SECURITY.md` endpoint-as-input). |

### Decisions consolidated during execution

1. **No migrations.** Pre-launch wallet, no users to migrate. Storage version
   bumps wipe + reseed. Plan-v4 dropped all migration scaffolding from PR-3.
2. **Submitted-endpoint UX**: dropped the "Submitted via X" tooltip on
   pending txs (user reject — UX noise). The polling pin is internal-only.
3. **Networks list affordance**: chevron lives in the `#right` slot
   alongside `NetworkBadge` (filling `#right` overrides `SettingItem`'s
   fallback chevron, so the prop alone wasn't sufficient).

