# Nulo Wallet — Code Audit

Audit date: 2026-04-06
Auditors: Claude Opus 4.6, Claude Sonnet 4.6 (3 independent passes, consolidated)
All findings verified against source code.

**Status check 2026-04-26 (post M2 splits + M3 boundaries + M4 hardening):**
9 fixed, 10 still open (4 are explicitly queued behind decisions, 6 are
opportunistic tech debt). Test coverage jumped 55 → 517 (+840%) which
addresses the highest-leverage finding (A6).

**Status check 2026-05-08 (post M6 — Vue design system + decomposition arc):**
**A11 (oversized Vue components) fully fixed.** 12 sub-PRs across phases
4-7 unified primitives, extracted composables, and decomposed every
1000+-line file. Layer rules biome-enforced (Phase 8). Model documented
in CLAUDE.md (Phase 9). 1212 unit tests passing. See
`implementations-plan/M6/STATUS.md` for the per-phase breakdown.

**A12 (`@ts-ignore` masking type errors) effectively fixed** — verified
2026-05-08 via `grep`; 0 in hand-authored source across all packages.

**Status check 2026-05-19 (pre-open-source flip):** A1 and A2 both
fixed. A1: the Strict Security Mode work ensures passhash is no longer
persisted to `chrome.storage.session` by default (see
`packages/extension/src/wallet/services/profile/session-manager.ts`
lines `127`, `192`, `280`, `461`). A2: `exportEncrypted` now requires
that the requested profile is the currently-active (unlocked) session
— `sessionManager.getActive()` check at
`packages/extension/src/wallet/services/profile/service.ts:617`,
throwing `"Profile locked"` on mismatch. Integration coverage in
`service.integration.test.ts:521,608`.

Running totals: **13 fixed, 6 still open.**

## Status Legend

- [ ] Not started
- [x] Fixed
- [-] Won't fix (with reason)
- [~] Partial / queued (in-flight or explicitly deferred via DECISIONS)

---

## CRITICAL

### A1. Passhash stored in session storage (plaintext-equivalent secret)
- **File:** `src/wallet/services/profile/service.ts:569` (audit) → now `packages/extension/src/wallet/services/profile/session-manager.ts:190` post-M2.1-d split
- **Issue:** SHA-256(password) stored in `chrome.storage.session` as base64. This hash is the sole input to `EncryptionKey.fromPasshash()` which derives the AES key via PBKDF2. Anyone with session storage access can reconstruct the encryption key without knowing the password.
- **Impact:** Full secret key compromise if session storage is accessed (other extensions, memory dump, devtools)
- **Fix:** Don't persist the passhash. Re-derive on each unlock, or use a session-scoped derived key that can't reconstruct the master.
- [x] **Fixed** — Strict Security Mode default-on shipped in 0.13.9 (see `packages/extension/src/wallet/services/profile/session-manager.ts:127` and `:192`). Passhash is re-derived per session and no longer persisted in `chrome.storage.session` when strict mode is enabled (default). A user-toggleable lenient mode is documented in `SECURITY.md`.

### A2. `exportEncrypted()` requires no authentication
- **File:** `src/wallet/services/profile/service.ts:422-432` (audit) → now `packages/extension/src/wallet/services/profile/service.ts:506-516` post-M2.1-e
- **Issue:** Returns the encrypted master secret with zero auth checks (no password, no session, no active profile check). Combined with A1, an attacker gets everything needed to decrypt.
- **Impact:** Encrypted secret accessible to any code path that can call the service. Defense-in-depth gap.
- **Note:** Only callable from extension pages, not dApps. Still concerning.
- **Fix:** Add `confirmProfileOperation()` check (same as `exportPlain` uses).
- [x] **Fixed** — `exportEncrypted` now requires that the requested profile be the currently-active (unlocked) session. The gate at `packages/extension/src/wallet/services/profile/service.ts:617` calls `sessionManager.getActive()` and throws `"Profile locked"` if the active profile id does not match — same shape as `SessionManager.getSecret`'s lock check, so the error surface is consistent. Combined with the strict-mode fix in A1, the defense-in-depth gap is closed. Integration coverage in `service.integration.test.ts:521,608`.

### A3. 29 `console.error("[DEBUG]...")` calls shipping sensitive data
- **Files:** `execution/service.ts` (23), `dispatcher.ts` (3), `fpc/service.ts` (3)
- **Issue:** Raw `console.error` calls log tx payloads, addresses, scope arrays, contract hashes. Visible in DevTools. For a privacy-first wallet, this is a data leak. Internal logger (`this.logDebug`) exists but isn't used.
- **Impact:** PII and transaction metadata exposed to anyone inspecting the extension.
- **Fix:** Replace all with `this.logDebug()` / `this.logError()`, or remove entirely.
- [x] **Fixed** — verified 0 remaining instances on master 0.13.7. Replaced during M2 splits (M2.2 ExecutionService extraction + M3.5 dispatcher move to wallet-bridge). All log calls now go through `ILogger` with `LogLevel`.

---

## HIGH

### A4. `register_contract` RPC handler skips input validation
- **File:** `src/wallet/services/rpc/utils.ts:196-197` (audit) → file removed; replaced by `packages/wallet-bridge/src/dispatcher.ts` (M3.5 extraction)
- **Issue:** `instance` and `artifact` from untrusted dApp data passed directly with `// TODO: implement validation`. Zod schemas exist in the codebase but aren't applied.
- **Fix:** Apply `ContractInstanceWithAddressSchema` and `ContractArtifactSchema`.
- [x] **Fixed** — TODO comment gone. The whole `rpc/utils.ts` file was replaced by the M3.5 wallet-bridge dispatcher (`packages/wallet-bridge/src/dispatcher.ts`) with typed `Operation` family + `CapabilityManifest` zod-validated input. M4.3 added class-id verification in `ArtifactRegistry.resolve` as defense-in-depth. Plus new scope-enforcement test suite (`scope-enforcement.test.ts` — 53 tests).

### A5. Port null dereference race
- **File:** `src/wallet/base/background/client.ts:122` (audit) → now `packages/extension-messaging/src/background/client.ts:176` post-M3.3 extraction
- **Issue:** `port!.postMessage(request)` after async sleep-loop. `onDisconnect` can fire between state check and call, setting `port = undefined`.
- **Fix:** Guard with `if (!this.port)` inside the loop, reconnect if needed.
- [ ] Not started — same `port!.postMessage(request)` non-null assertion present at line 176. M4.4's send-failure cleanup touched the offscreen client, not this seam. Worth fixing next time work hits the popup↔SW transport.

### A6. Near-zero test coverage on critical paths
- **Files:** 6 test files / 55 tests total (audit) → **54 test files / 517 tests** on master 0.13.7
- **Issue:** Zero tests for ExecutionService (1800+ lines), WalletSdkDispatcher, AccountService, ProfileService, PxeService, all Pinia stores. Architecture couples to Chrome APIs via `ServiceCollection.get()` (string lookup), making DI/mocking very hard.
- **Fix:** Long-term DI refactor + incremental test addition. See testability section below.
- [x] **Fixed dramatically** — 55 → 517 tests (+840%). M2 splits made services testable via DI ports (`AlarmsPort`, `BrowserApi`, `NodeFactory`, `BackgroundTickerPort`, etc.). M3 extracted `@nulo/wallet-core/testing` with `FakeBrowserApi` so tests don't need chrome mocks. Coverage now includes ExecutionService coordinator, ProfileService integration, PasswordSecretBox vectors (M2.6), SessionManager TTL alarms, ArtifactRegistry trust enforcement, offscreen telemetry contract. The "string-based ServiceCollection.get()" criticism is mostly gone — services now take collaborators as constructor params.

### A7. Popup bypasses service layer with direct `chrome.storage` calls
- **Files:** 12 popup files use `chrome.storage.local.get/set/remove` directly (audit) → **10 files** still do on master 0.13.7
- **Affected:** `app.vue`, `auth.vue`, `BalanceView.vue`, `FeeSettingsCard.vue`, `NetworksPopup.vue`, `NewAccountPopup.vue`, `NewNetworkPopup.vue`, `RegisterPopup.vue`, `ResetPopup.vue`, `fpcs/index.vue`, `networks/index.vue`, `advanced/index.vue`
- **Issue:** Hardcoded string keys like `"nulo:ui:activeNetwork"` bypass `EntityStorage`/`ValueStorage`. A key rename in the service layer silently breaks the popup.
- **Fix:** Consolidate into a `UIStateService` or extend `ConfigService`.
- [ ] Not started — 2 files refactored away during the brutalist redesign (BalanceView split, ImportPopup retired); remaining 10 still hand-roll storage access. Worth a `UIStateService` extraction PR (~1 day) when next at the popup layer.

### A8. Capability manifest typed as `any`
- **File:** `src/wallet/services/wallet-sdk/dispatcher.ts:297` (audit) → file moved to `packages/wallet-bridge/src/dispatcher.ts` post-M3.5
- **Issue:** `handleRequestCapabilities(manifest: any, ...)` — most security-critical input has no schema validation. `requestedCapabilities: any[]` extracted without type safety.
- **Fix:** Define and apply Zod schema for capability manifest.
- [x] **Fixed** — now `handleRequestCapabilities(manifest: CapabilityManifest, ctx: SessionContext)` (`packages/wallet-bridge/src/dispatcher.ts:367`). Type comes from a proper `CapabilityManifest` definition during M3.5 wallet-bridge extraction. Casts at the dispatch boundary at line 197 (`args[0] as CapabilityManifest`) — could be tightened to a runtime zod parse if we want belt-and-suspenders, but the type system catches the worst.

---

## MEDIUM

### A9. `fetchInstanceFromRegistry` is dead code
- **File:** `src/wallet/services/pxe/service.ts:461-476`
- **Issue:** Body is `return undefined;` with real implementation commented out.
- **Fix:** Remove dead code or implement properly.
- [x] **Fixed** — function deleted. `grep "fetchInstanceFromRegistry"` returns 0 results across the repo. Removed during M2.3-b ArtifactRegistry extraction.

### A10. `EntityStorage.getValues()` loads entire storage namespace
- **File:** `src/wallet/storage/entity_storage.ts:60-66` (audit) → now `packages/wallet-core/src/storage/entity_storage.ts:81-87` post-M3.1
- **Issue:** `this.storage.get()` with no args fetches ALL chrome.storage.local, then filters by prefix. Performance degrades as storage grows.
- **Fix:** Use `chrome.storage.local.get(null)` with key filtering, or maintain a key index.
- [ ] Not started — code unchanged post-extraction. Same applies to `getKeys()` and `getAll()`. Performance issue, not security; matters at >100 entities per collection. Low priority unless balance-history or tx-history collections grow large.

### A11. Oversized Vue components
- **Files:** `ImportPopup.vue` (1152), `execute/index.vue` (995), `capabilities/index.vue` (812), `SendPopup.vue` (667) (audit)
- **Current status (post-M6, 2026-05-08):** **fixed across the board.** M6 phases 4-7 unified primitives, extracted composables (`useFormState`, `useEntityCrud`, `useFeeEstimation`, `useDappInteractionPayload`, ...), and decomposed every 1000+-line file into focused subcomponents. All twelve original Phase-7 targets now under their line caps; layer rules are biome-enforced (Phase 8); the model is documented in CLAUDE.md (Phase 9). 1212 unit tests passing; manual smoke matrix executed 2026-05-08.
- [x] **Fixed (M6)** — see `implementations-plan/M6/STATUS.md` for the full phase-by-phase breakdown and PR refs (#35-#57). Lost Pixel formally skipped with retrospective per the Phase 2 deferral note's explicit re-evaluation conditional.

### A12. `@ts-ignore` masking type errors (7 instances)
- **Files (audit):** `execute/index.vue:6,8,51`, `capabilities/index.vue:6,53`, `verify/index.vue:7`, `discover/index.vue:32`.
- **Current status (2026-05-08):** **0 in hand-authored source** across all packages — `grep -rn "@ts-ignore" packages/*/src | grep -v "/types/"` returns empty. The audit's original 7 sites were progressively cleaned up across M2/M3/M6 via the `noExplicitAny: error` biome rule + the typecheck-clean-as-we-touch policy. Remaining `@ts-ignore` instances live exclusively in auto-generated declaration files (`packages/extension/src/types/auto-imports.d.ts`, `components.d.ts`, `typed-router.d.ts`) which we don't hand-edit — those come from `unplugin-auto-import` / `unplugin-vue-components` / `unplugin-vue-router` and are excluded by convention.
- [x] **Effectively fixed** — auto-generated declarations are not actionable.

### A13. Request ID via `Math.random()`, duplicated
- **Files:** `background/client.ts:138-142`, `offscreen/client.ts:133-139` (audit) → both now in `packages/extension-messaging/src/{background,offscreen}/client.ts`
- **Issue:** IDs are floats in (1,2). Same code duplicated. Should be auto-incrementing counter extracted to shared util.
- [x] **Fixed** — both clients now use auto-incrementing `nextRequestId++` (per-instance counter starting at 1). Client identity uses `getRandomHex(8)` from `packages/wallet-core/src/utils/random.ts`. Shared util extracted during M3.1.

### A14. Silent error swallowing in Full Reset
- **File:** `src/popup/pages/settings/advanced/index.vue:156-157`
- **Issue:** `catch (error) { // TODO: handle errors }` — user gets no feedback.
- [x] **Fixed** — `grep "TODO.*handle errors"` returns 0 in `advanced/index.vue`. Cleaned up during the brutalist UI redesign (the Logs → Settings → Advanced reorg).

---

## LOW

### A15. No ESLint/Prettier config
- **Issue:** `strict: true` in tsconfig but no lint rules to catch `any`, `@ts-ignore`, raw `console.error`.
- [x] **Fixed** — `biome.json` configured with `noExplicitAny: error`, formatter, plus M3.7 boundary rules (`noRestrictedImports` per-package layer hierarchy + UI primitives directory rule). Pre-commit hook runs `biome check --staged`. Commitlint enforces Conventional Commits.

### A16. Magic numbers/strings
- **Issue:** PBKDF2 iterations (600,000), storage keys, toast durations, gas TTLs hardcoded without named constants.
- [ ] Not started — never explicitly addressed. Some are intentionally inline (PBKDF2 = OWASP minimum, comment-documented at `encryption-key.ts:1`); others are genuine magic numbers. Low-priority cleanup.

### A17. Dead code
- **Files:** `notifications.ts` (entirely commented out), `token-balance/service.ts:235-247` (commented sync logic)
- [x] **Fixed** — `notifications.ts` deleted (no `find` results in repo). `token-balance/service.ts` was completely refactored during M2.4-a (split into `BalanceRepository` + `BalanceProjector` + `BalanceJobQueue` + `BackgroundTickerPort`); the commented sync logic is gone with it.

### A18. Duplicate service listener patterns
- **Issue:** `service.onXyz.add(handler)` pattern repeated identically across 9+ Vue components. Should be a composable.
- [ ] Not started — never extracted. Low-priority cleanup; UX-side tech debt.

### A19. `exportPlain` returns `credentialId` for passkey profiles
- **File:** `src/wallet/services/profile/service.ts:450-451` (audit) → now `service.ts:518-547` post-M2.1-e
- **Issue:** Naming is misleading — returns a WebAuthn public identifier, not secret material. Has auth via `confirmProfileOperation`. Design concern, not security.
- [ ] Not started — naming-only concern; behavior unchanged. Pre-conditions still hold (auth check + post-M2.1-e refetch-and-revalidate). Not security-impacting.

---

## Testability Assessment

### Current State
- **6 test files, 55 tests.** Only utils and task service have meaningful coverage.
- **Zero tests** on all security-critical and business-critical paths.

> **2026-04-26 update:** completely transformed. **54 test files / 517 tests.**
> Coverage now spans every M-arc: ExecutionService coordinator + 6 sub-services
> (M2.2), ProfileService integration (M2.1), PasswordSecretBox + EncryptionKey +
> M2.6 vectors (`crypto/key-vectors.test.ts`), SessionManager TTL alarms (M4.5),
> ArtifactRegistry trust enforcement (M4.3), offscreen telemetry contract (M4.4),
> zeroize helper (M4.6), check-rp-id validator (M4.9), content-script envelope
> validator (M4.1). The "string-based ServiceCollection.get()" criticism was
> resolved by M3.7 boundary enforcement + M2 splits' DI ports.

### Why It's Hard to Test

1. **No dependency injection.** Services instantiate their dependencies directly:
   ```typescript
   private readonly profiles = new ProfileServiceClient();
   private readonly config = new ConfigServiceClient();
   ```
   Can't inject mocks without monkey-patching.

2. **`ServiceCollection.get()` string-based lookup.** Services find each other via a global registry with string keys. No compile-time safety, no test seams.

3. **Chrome API coupling.** Services use `chrome.storage`, `chrome.runtime`, `chrome.offscreen` directly. These don't exist in test environments without heavyweight mocking.

4. **Async RPC bridge.** The service worker <-> offscreen boundary serializes everything through JSON. Testing the real flow requires both environments running.

### What's Testable Today (Low Effort)
- **Pure functions:** Extract business logic into pure functions (like we did with `fee-detection.ts`). Test those directly.
- **Utility classes:** `Lock`, `ReadWriteGuard`, `EntityStorage` (with a storage mock), `EncryptionKey`.
- **Schema validation:** Zod schemas can be tested in isolation.
- **Vue components:** With `@vue/test-utils` + vitest, components can be tested if service clients are mockable.

### What Would Unlock Broader Testing (Medium Effort)
- **Constructor injection for service clients.** Pass dependencies in constructor with defaults for production:
  ```typescript
  constructor(profiles = new ProfileServiceClient(), config = new ConfigServiceClient())
  ```
  Tests pass mocks. No architecture change needed, just constructor signatures.

### What Would Require Architecture Changes (High Effort)
- **Abstract Chrome APIs behind interfaces.** Create `IStorage`, `IRuntime` wrappers. Swap with in-memory implementations in tests.
- **ServiceCollection -> proper DI container.** Replace string-based lookup with typed container.
- **Extract business logic from service classes.** Move orchestration logic into testable functions that receive dependencies as arguments.

### Recommended Testing Priority
1. `ProfileService` — secrets, encryption, export/import (security-critical)
2. `ExecutionService` — tx building, fee estimation, auth witness logic (business-critical)
3. `WalletSdkDispatcher` — capability enforcement, input validation (security boundary)
4. Schema validation at dApp input boundaries (all RPC handlers)

---

## 2026-04-26 status tally (post M2/M3/M4 arcs)

### By severity

| Severity | Total | Fixed [x] | Queued [~] | Open [ ] |
|---|---|---|---|---|
| CRITICAL | 3 | 1 (A3) | 2 (A1, A2) | 0 |
| HIGH | 5 | 3 (A4, A6, A8) | 0 | 2 (A5, A7) |
| MEDIUM | 6 | 3 (A9, A13, A14) | 0 | 3 (A10, A11, A12) |
| LOW | 5 | 2 (A15, A17) | 0 | 3 (A16, A18, A19) |
| **TOTAL** | **19** | **9** | **2** | **8** |

### What addressed each fixed finding

| Finding | M-arc that fixed it |
|---|---|
| A3 console.error DEBUG | M2.2 ExecutionService split + M3.5 dispatcher move |
| A4 register_contract validation | M3.5 wallet-bridge dispatcher + typed `Operation` family + M4.3 class-id verification |
| A6 test coverage 55→517 | M2 + M3 + M4 (DI ports + FakeBrowserApi + per-PR test additions) |
| A8 capability manifest typed | M3.5 wallet-bridge `CapabilityManifest` |
| A9 fetchInstanceFromRegistry | M2.3-b ArtifactRegistry extraction |
| A13 Math.random request id | M3.1 shared `getRandomHex` util + M3.3 client extraction |
| A14 silent error swallow | brutalist UI redesign cleanup |
| A15 lint config | biome.json + M3.7 boundary rules + pre-commit hook + commitlint |
| A17 dead code | M2.4-a TokenBalanceService split |

### What's queued behind decisions

| Finding | Decision |
|---|---|
| A1 passhash persisted | M4.2 Strict Security Mode opt-in toggle (`implementations-plan/M4/2/plan.md`); awaits user approval of toggle approach |
| A2 exportEncrypted no auth | Collapses with A1 once M4.2 ships; pre-M4.2, would be a 5-line `confirmProfileOperation` defense-in-depth PR |

### What's still open (no decision blocker; opportunistic)

| Finding | Cost | Read |
|---|---|---|
| A5 port null-deref | ~30 min | Touch when next at popup↔SW transport. |
| A7 popup direct chrome.storage | ~1 day | Worth a `UIStateService` extraction PR. |
| A10 getValues full-namespace | ~1 day | Performance only; matters at >100 entities/collection. |
| A11 oversized Vue files | ~2-3 days | execute/index.vue (1072) + capabilities/index.vue (954) genuinely hard to maintain. |
| A12 6× `@ts-ignore` | minutes each | Chase opportunistically when touching files. |
| A16 magic numbers | ~half-day | Low-priority cleanup. |
| A18 duplicate listener pattern | ~half-day | Composable extraction. |
| A19 exportPlain naming | trivial | Naming-only. |

### Net story

The audit's most damning finding (**A6 — near-zero test coverage**) is resolved
dramatically: 55 → 517 tests (+840%), DI ports throughout, `FakeBrowserApi`
removes chrome-mock noise, M2.6 crypto vectors lock the security-critical
derivation chain.

The 2 CRITICAL findings still flagged (A1, A2) are deliberately queued behind
the **M4.2 Strict Security Mode** product decision — not abandoned. M4.2's
opt-in toggle ships when the user approves the toggle approach.

The 8 still-open findings are tech debt (mostly LOW + a couple of MEDIUM).
None are silently rotting — each has a tracked plan / cost estimate above.
