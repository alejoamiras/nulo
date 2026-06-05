# Audit-fixes arc — plan v1.1

Date: 2026-06-03 (revised post pre-impl audit)
Parent arc: [`../plan.md`](../plan.md) (onboarding + fees + history, 19 commits, gates green, 3 codex audits returned Reject).
Audit trail: [`audit-codex.md`](./audit-codex.md) (v1 verdict: Approve-with-changes), [`audit-opus.md`](./audit-opus.md) (v1 verdict: Approve-with-changes). Both converged on: `stuck_queued` missing from P2 whitelist, P3 double-fetch hazard, P7 dedup-key needs full triple, P4 toggle-replay belongs popup-side, P1 sanitize scope cleanup. All folded inline below.
Branch: continues `feat/onboarding-fees-history-arc` — fixes squash into the same PR.
Quality calibration: **Production**.
Scope discipline: ONE PR (continues the existing arc), 9 phase commits, risk-ascending.

## 0. Audit triage — what's in scope, what's out

Three parallel codex `xhigh` audits (`audit-codex-spawn-{1,2,3}-{f4f1,f3,f2}.md`) returned Reject. This plan addresses every critical + every high they surfaced, EXCEPT the F4 `claim_and_end_setup` finding (FJWC is being deprecated; not worth pinning a fee method we're removing).

### In scope

| # | Source | Finding | Severity | Sub-phase |
|---|---|---|---|---|
| F1 | Audit 2 C1 | `sanitizeJournalSubtitle` gate only on `journal/[id].vue`. Terminal cards + awaiting cards + RecentActivityView still pass raw `op.subtitle`. | Critical | P1 |
| F2 | Audit 2 H1 | sanitize regex `/^[a-z][a-z0-9+.\-]*:\/\//i` too narrow. Misses `mailto:`, `tel:`, `javascript:`, `data:`, `http:evil`. | High | P1 |
| F3 | Audit 2 H2 | `op.error.kind` rendered unconditionally. Typed `string` (not enum-bound) — leaks internal classifiers (`sw_restart_post_prove`, `popup_bound`) to end users. | High | P2 |
| F4 | Audit 3 C1 | `RecentActivityView` registers `IncomingTransferServiceClient` listeners but never explicitly `connect()`s AND never calls `getIncomingTransfers()` on mount. Home widget incoming display is non-functional. | Critical | P3 |
| F5 | Audit 3 C2 | `incomingTransfersVisible` toggle doesn't gate `onIncomingTransferPending` emit OR `replayPendingPrompts`. Toggle-off users still get first-receive popups for hidden records. | Critical | P4 |
| F6 | Audit 3 H1 | `IncomingTransferService` declares `AccountService` as a topo dep but never subscribes to `onAccountAdded` / `onAccountDeleted`. New accounts aren't scanned until SW restart; deleted accounts keep polling. | High | P5 |
| F7 | Audit 3 H2 | `IncomingTrustPopup` shows a 6-4 contract slice with no expand/copy affordance. Insufficient verification surface for the fake-USDC threat model. | High | P6 |
| F8 | Audit 3 H4 | `replayPendingPrompts` + `PopupManager` is last-write-wins, not a real queue. Multiple pending contracts replayed in one pass overwrite each other while popup is open. | High | P7 |
| F9 | Audit 3 H3 | Service-side tests only pin `orderByBlockIndex` + `trustKey`. None of the risky logic (dedupe, late-delete, trust transitions, queue, visibility gating, cleanup wiring) is exercised. | High | P8 |
| F10 | Audit 1 M1 | F1 skip-route e2e missing. The split `learn.vue:goNext` → `goContinue → /fees` + `goSkip → /accelerator` isn't pinned by the existing e2e walk-through. | Medium | P9 |

### Out of scope (explicit deferrals)

| Source | Finding | Why deferred |
|---|---|---|
| Audit 1 C1 | `claim_and_end_setup` missing from `FEE_METHODS` | FJWC strategy is being deprecated — pinning a fee method on a strategy we're removing is anti-investment. Tracked but won't ship in this PR. |
| Audit 1 nit | StepIndicator could be `<ol>/<li>` for richer SR semantics | Low-value polish; the `aria-current="step"` it already has is the load-bearing a11y signal. Tracked separately. |
| Audit 1 nit | `OperationPlanner.extractPrimaryMethod` JSDoc says "first call" (stale post-F4) | Pure doc drift; will fix opportunistically. |
| F2 deferred (parent arc) | `setInterval` → `chrome.alarms` refactor for MV3 SW resilience | Separate PR; documented in parent arc's `lessons/phase-4.md`. |
| F2 deferred (parent arc) | Symbol-collision badge on incoming cards | Separate PR. |
| F2 deferred (parent arc) | 5-minute recent-tx-hash ring buffer | Separate PR; 3-source dedupe + late-delete is sufficient for the common case. |

## 1. Goal + success criteria

Ship 9 fix commits on the existing `feat/onboarding-fees-history-arc` branch addressing every audit-found critical + high (excluding `claim_and_end_setup`).

**Done means:**

- All 9 phases ✓ on the ASCII checklist in the PR description.
- `bun run audit:vue` clean (typecheck → unit + component → lint → build).
- `bun run test:e2e` smoke clean.
- `bun run e2e:agent` network clean — existing wire-up smoke still passes + the new skip-route assertions land cleanly.
- Codex post-impl audit on the fix arc (one more `xhigh` round, scoped to the fix diff) reports Approve / Approve-with-changes with no remaining criticals.
- Per-phase lessons logged in `audit-fixes/lessons/phase-{1..9}.md`.
- Branch pushed, PR opened (existing PR — fixes squash into it).

## 2. Scope per phase

Risk-ascending. Each = one commit.

### P1 (commit 1) — Sanitize-gate widening (F1 + F2)

**Files touched:**

- `packages/extension/src/utils/journal-state.ts` — regex widening:
  - Current: `/^[a-z][a-z0-9+.\-]*:\/\//i` (RFC 3986 scheme + `://` mandatory)
  - Target: `/^[a-z][a-z0-9+.\-]*:/i` (scheme + colon; catches `mailto:`/`tel:`/`javascript:`/`data:`/`http:evil`).
  - Codex + opus both agreed: broader is the right bias for dApp-controlled origin fields. Known-scheme allowlist is the wrong trade (dApps can use arbitrary schemes).
- `packages/extension/src/utils/journal-state.test.ts` — 6 new sanitize cases pinning `mailto:`/`tel:`/`javascript:`/`data:`/`http:evil`/`chrome-extension:abc`. Plus a negative pin for genuine plain-text containing colons (timestamps `12:34`, versions `v1:`, CSS-like `color:red`) — these will FALSE-positive bracket but the dApp-origin-only scope below limits the harm. The negative pin documents the trade-off.
- `packages/extension/src/utils/journal-state.ts:buildJournalTerminalCardProps` — apply `sanitizeJournalSubtitle` to **`originLabel`** only. **Do NOT sanitize `display.subtitle`** — that's wallet-controlled (comes from `failedSubtitleFor`), so sanitizing is scope creep (codex M2 catch). Limit sanitize to dApp-controlled fields.
- `packages/extension/src/popup/components/modules/general/RecentActivityView.vue` — sanitize at every dApp-controlled-label surface (per opus C2):
  - `cardOriginLabelFor` helper (line ~344): `op.subtitle ?? null` → `sanitizeJournalSubtitle(op.subtitle)`.
  - `executingOriginLabel` (line ~148): `executingTask.value.origin?.name ?? null` → `sanitizeJournalSubtitle(executingTask.value.origin?.name)`.
  - Orphan-fallback awaiting cards at lines ~716–724 AND ~770–777 — these render `executingTask.origin?.name` via inline binding. Wrap each.
- Verify `TransactionTerminalCard.vue` + `TransactionAwaitingCard.vue` don't need their own sanitization — they accept already-sanitized props via the helpers/callers above. Defense-in-depth is tempting but adds maintenance burden; opus + codex agreed on apply-at-builder.

**Tests:**

- 6 new sanitize regex cases pinning `mailto:`/`tel:`/`javascript:`/`data:`/`http:evil`/`chrome-extension:abc`.
- Extend `journal-state.test.ts:buildJournalTerminalCardProps` test cases with a malicious subtitle assertion (covers the apply-at-builder fix).

**Risk surface:** Pure-function helper widening + 2-3 call sites. No service / storage changes.

### P2 (commit 2) — `error.kind` humanization (F3)

**Files touched:**

- `packages/extension/src/utils/journal-state.ts` — new `humanizeErrorKind(kind: string): string` helper. Whitelist (verified against `wallet-core/jobs/types.ts` + `journal-state.ts:failedSubtitleFor` + `reaper.ts` + `execution/service.ts:normalizeError` call sites): `network`, `simulation`, `prover`, `popup_bound`, `dapp_execute`, `transfer`, `sw_restart_post_prove`, `stale_on_resume`, `stuck_proving`, `stuck_queued`, `user_rejected`, `unknown`. Unknown kinds → generic `"Error"` (pure mapping; no `console.warn` side effect — codex final-review L: `journal-state.ts` is a pure utility, telemetry surface doesn't belong here).
  - **`stuck_queued` is critical** — both codex H2 + opus C1 caught this. The reaper at `operation-journal/reaper.ts:192` emits it (pinned in `reaper.test.ts:102, :136`). Without it, real reaper events would route to generic "Error" fallback.
  - **Do NOT include token-import-only kinds** (`metadata_fetch`, `network_unreachable`, `contract_invalid`) — `journal/[id].vue` already rejects `token_import` kind earlier (the kind-guard at ACTIVITY_FEED_KINDS), so adding these would be dead code. Codex H2 catch.
- `packages/extension/src/utils/journal-state.test.ts` — pin every whitelisted kind's humanization + the unknown fallback + `stuck_queued` explicit regression pin.
- `packages/extension/src/popup/pages/journal/[id].vue` — replace the unconditional `errorKind` render at the "Reason" row with `humanizeErrorKind(errorKind)`. Keep the data-testid `journal-detail-error-kind-tag` so e2e selectors stay stable.

**Tests:** New unit cases on the humanize helper (one per whitelisted kind + unknown fallback + the `stuck_queued` pin).

**Risk surface:** Single utility + one render site.

**Follow-up (out of scope):** Typed-union refactor at `wallet-core/jobs/types.ts` so the whitelist drift-checks at compile time. Opus H1 suggested it; defer because the whitelist + tests pin the current set, and the upstream type change is a separate concern.

### P3 (commit 3) — RecentActivityView wiring fix (F4)

**Files touched:**

- `packages/extension/src/popup/components/modules/general/RecentActivityView.vue` — line ~637 `onMounted`:
  - Add **ONE** `await incomingTransferService.connect()` call. Position: after `await configService.connect()`, before the journal/task replay.
  - **Single bootstrap path** — codex M1 + opus M caught the double-fetch hazard. The existing `incomingTransferService.onConnected.add(loadIncomingTransfers)` listener (line ~213) fires immediately on `connect()`, so the listener calls `loadIncomingTransfers` for us. Calling it again explicitly would double-fetch.

**Tests:** **Backfill a minimal component test for the wiring** (codex H3 + opus M). Mount RecentActivityView with mocked clients; assert `incomingTransferService.connect` is called in onMounted AND `getIncomingTransfers` fires (via the `onConnected` listener). Without this, another forgotten connect won't be caught by service-side tests alone.

**Risk surface:** One `await` call in an existing `onMounted`, plus one component test. Minimal blast radius. Without this commit, F2's incoming display is **non-functional** on the home widget — this is THE critical user-facing fix.

### P4 (commit 4) — Visibility-toggle gate completeness (F5)

**Files touched (service side):**

- `packages/extension/src/wallet/services/incoming-transfer/service.ts`:
  - `scanContract` (the `onIncomingTransferPending` emit at ~line 391): gate on `await this.isVisibilityEnabled()`. When OFF, set trust to `pending` + insert hidden record but DO NOT emit `onIncomingTransferPending`. Records persist; user toggling back on can resolve via the popup-side replay below.
  - `replayPendingPrompts` (~line 445): early-return when `await this.isVisibilityEnabled()` is false. Prevents the popup from surfacing on reconnect after the user toggled off.

**Files touched (popup side — toggle OFF→ON replay):**

Per codex H1: the service doesn't own the UI-selected `(profile, network, account)` triple — that lives in `appStore`. So the false→true replay must fire from `PopupManager.vue`, not from the service via `ConfigService.onUpdate`. Otherwise the service either guesses the active triple wrong OR fans out prompts too broadly.

- `packages/extension/src/popup/components/popups/PopupManager.vue`:
  - Add a `ConfigServiceClient` subscriber on `onUpdate`. Detect `incomingTransfersVisible` flipping false→true.
  - On flip, call `incomingTransferService.replayPendingPrompts(appStore.profile.id, appStore.network.id, appStore.account.address)` — uses appStore for the active scope.
  - Explicit `await configService.connect()` in `onMounted` (listener won't fire without it — same fix as parent arc's `47e5731` for activity.vue + RecentActivityView).

**Tests:**

- New service test cases: `scanContract` with toggle off doesn't emit Pending; `replayPendingPrompts` with toggle off is a no-op.
- **New popup-level test**: PopupManager subscribes to ConfigService.onUpdate; on false→true flip, calls replayPendingPrompts with the active appStore triple. (Codex H3 + opus C catch — without this test, "another forgotten replay" won't be caught.)

**Risk surface:** Two service guards + one popup-side ConfigServiceClient subscription. Slightly bigger than original plan, but the popup-side replay is the architecturally correct location.

### P5 (commit 5) — AccountService lifecycle (F6)

**Files touched:**

- `packages/extension/src/wallet/services/incoming-transfer/service.ts:init`:
  - Subscribe to `this.accountService.onAccountAdded` → call `hydrateSchedulers()` (rebuild from current profile + accounts + tokens).
  - Subscribe to `this.accountService.onAccountDeleted` → tear down any scheduler whose `accountAddress` matches the deleted account; clear `watchedContracts` for that key.
  - Subscribe to `onAccountUpdated` — likely no-op (address unchanged); skip unless address can change.

**Tests:** New service test cases — `onAccountAdded` event triggers `hydrateSchedulers`; `onAccountDeleted` event clears the scheduler for that account.

**Risk surface:** Two subscription adds + one cleanup branch.

### P6 (commit 6) — IncomingTrustPopup contract verification redesign (F7)

**Files touched:**

- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue`:
  - Replace the single `contractSlice` line with a two-element display: trimmed by default; click-to-expand reveals the full address (mono, wrapped). A separate copy button uses `useToast` for confirmation.
  - **Real `<button>` elements** for both the expand toggle AND copy — keyboard-reachable, focusable. Codex L caught: existing modal traps focus but doesn't assign initial focus; opus M caught: a11y gaps. Use `aria-expanded` on the reveal toggle so screen readers narrate the state.
  - Initial focus on mount goes to the expand toggle (so a keyboard-only user lands on the verification surface first).
  - Add `data-testid="incoming-trust-contract-full"` (the full-address element, only present when expanded).
  - Add `data-testid="incoming-trust-contract-copy"` for the copy button.
  - Add `data-testid="incoming-trust-contract-expand"` for the reveal toggle.
  - Visual styling: keep the brutalist rhythm; the full address is mono font, wrapped.
  - **No block-explorer link in this PR** (codex L caught). The popup payload doesn't carry network/explorer policy; adding it is scope creep. Tracked as a follow-up.

**Tests:** Component test mounting the popup with a known contract address. Assert: trimmed visible by default; click expand → full address visible + `aria-expanded="true"`; click copy → `navigator.clipboard.writeText` called with the contract address (mock); initial focus on expand toggle.

**Risk surface:** Pure UI change in a single component.

### P7 (commit 7) — Real pending-prompts queue (F8)

**Files touched:**

- `packages/extension/src/popup/components/popups/PopupManager.vue`:
  - Add a local `pendingTrustQueue: IncomingTransferPending[]` ref.
  - `onIncomingTransferPending` handler: dedupe by **`(profileId, networkId, contract)` triple** (codex M3 + opus C3/H — bare `contract` is wrong because the same contract address can exist across networks). Dedup check covers BOTH (a) entries already in queue AND (b) the currently-open popup's `cacheStore.incomingTrust` triple — preserving the existing coalesce guard so replay-while-open doesn't enqueue a duplicate (codex final-review L).
  - When no popup open + queue non-empty: dequeue head → populate `cacheStore.incomingTrust` → open popup.
  - The existing `watch(popupStore.isOpened("incoming_trust"))` already detects close. On close, call `dequeueNextPendingTrust()` — pops the next, opens.
  - Keep `replayPendingPrompts` as the reconnect-replay path BUT de-duplicate so it doesn't double-push existing queue entries.
- `packages/extension/src/wallet/services/incoming-transfer/service.ts` — leave `replayPendingPrompts` shape as emit-storm. Dedup happens popup-side via the triple key. (Opus suggested an enumeration API `getPendingPrompts(): Promise<Pending[]>` as a cleaner shape. Trade-off: protocol change is non-trivial; popup-side dedup is sufficient + smaller blast radius. Tracked as a follow-up.)

**Tests:** Component test on PopupManager — fire 3 `onIncomingTransferPending` events across 2 distinct contracts (one repeat); assert popup opens for [0]; close → opens for [1]; close → stays closed (repeat deduped). Plus a network-scope test: 2 events with same contract address on DIFFERENT networks → both surface (deduped by triple, not bare contract).

**Risk surface:** Refactor of the popup-side state machine. Test pins queue order + triple-key dedupe semantics.

### P8 (commit 8) — Real test coverage backfill (F9)

**Files touched:**

- `packages/extension/src/wallet/services/incoming-transfer/service.test.ts` — extend with:
  - 3-source dedupe correctness: prior records skip; outgoing-tx-hash match skip; in-flight journal `progress.txHash` match skip.
  - Late-delete on `onTransactionAdded`: pre-insert a record; fire event; assert deleted + emitted.
  - Trust state transitions: `unknown → pending` on first note; `setTrustAllow` flips queued records visible + emits Added (gated on visibility); `setTrustReject` keeps hidden silent.
  - Visibility gating: full matrix (toggle ON + OFF × emit-Added path + emit-Pending path).
  - Cleanup wiring: `clearProfile` wipes records + trust; `clearChain` scoped to `(profile, network)`.
- `packages/extension/src/wallet/services/incoming-transfer/repository.test.ts` — extend with:
  - Idempotent upsert via siloedNullifier.
  - `listByContract` + `listByTxHash` + `listForAccount` filters.
  - `clearProfile` + `clearChain` deletion semantics.

**Tests:** ~30-50 new test cases. Largest commit by LOC.

**Risk surface:** Test-only commit. No production code change.

### P9 (commit 9) — F1 skip-route e2e (F10)

**Files touched:**

- `packages/extension/tests/e2e/onboarding-tab.test.ts` — extend the happy-path test (or add a new one) to:
  - Drive `onboarding-learn-skip` → assert `waitForHash(page, "#/onboarding/accelerator", 10_000)`.
  - Drive `onboarding-fees-skip` → assert `waitForHash(page, "#/onboarding/accelerator", 10_000)`.

**Tests:** 1-2 new e2e assertions. Confirms the split-handler semantics.

**Risk surface:** Test-only.

## 3. Security & adversarial considerations

### Threat model — sanitize widening (P1)

- **Dapp-controlled subtitle** can be any string. Brackets-on-scheme-prefix is "this looks like a link, treat it skeptically." Widening to `scheme:` (no `//`) catches more shapes but still misses pure-text social engineering (`"verify at evil.com"` with no scheme). That's accepted — out-of-scope for a typography-level defense.
- **Length-bound abuse:** a 10MB subtitle could DOS the popup. Already implicitly bounded by `OperationJournalServiceSpec` storage size — sanity-check that bound is reasonable in P1.

### Threat model — `error.kind` humanization (P2)

- The whitelist is a closed surface. Adding a new `JobError.kind` value upstream WITHOUT updating the humanizer would surface as "Error" — generic but not leaky. Acceptable. Telemetry logs the raw kind for triage.
- Unknown kind via attacker-crafted error: an attacker dApp could trigger an error path that produces a custom `kind` string. The humanizer returns "Error" — no leak.

### Threat model — RecentActivityView wiring (P3)

- Fixing a non-functional path can't introduce a NEW vector — it just exposes the existing IncomingTransferService surface that was meant to be visible. The service's own threat model (first-receive friction, dedupe) applies.

### Threat model — Visibility gate completion (P4)

- The toggle being incomplete was a privacy promise broken. Fix tightens it.
- Edge case: user toggles off → contract hits pending state (record persisted hidden) → user toggles back on. Currently the popup wouldn't auto-prompt because the unknown→pending event already fired. **Fix:** when toggle flips back ON, `PopupManager` calls `replayPendingPrompts(profileId, networkId, accountAddress)` using the active `appStore` triple. See P4 above for the popup-side ConfigService subscriber wiring — that's the architecturally correct location (service doesn't own the UI-selected scope).

### Threat model — AccountService lifecycle (P5)

- New accounts not scanned = data hygiene issue, not privacy issue.
- Deleted accounts keeping polling = wasted PXE calls + potential information leak (PXE keeps querying for an account the user has tried to remove). Fix correct.

### Threat model — IncomingTrustPopup affordance (P6)

- Full-address display + copy is the user's verification surface. Click-to-copy uses standard `navigator.clipboard.writeText` — no privilege escalation.

### Threat model — Pending-prompts queue (P7)

- The current last-write-wins state means a malicious dApp that registers multiple tokens simultaneously could force only-the-last to surface. With a real queue, ALL pending contracts get prompted, in deterministic order. Improvement.

### Cross-cutting

- No new dependencies.
- No new chrome.* permissions.
- No new external API calls.
- New test files; no schema migrations.

## 4. Phase ordering rationale + revert safety

Risk-ascending. Criticals (P3 + P4) at commits 3 + 4 — not strictly "front-loaded" but close enough that they're shippable early in the chain. (Codex L: "rationale text overstates the front-loading" — corrected here.)

1. P1 — sanitize widening (pure helper + test sites; revert clean)
2. P2 — error.kind humanization (pure helper + one render site)
3. P3 — RecentActivityView wiring (1 await + minimal component test; fixes Critical 1)
4. P4 — visibility-toggle gate completion (2 service guards + popup-side ConfigService subscriber for OFF→ON replay; fixes Critical 2)
5. P5 — AccountService lifecycle (subscribe + handler)
6. P6 — IncomingTrustPopup contract redesign (UI + a11y)
7. P7 — pending-prompts queue refactor (state-machine refactor with triple-key dedup)
8. P8 — test coverage backfill (test-only)
9. P9 — F1 skip-route e2e (test-only)

If P7 (queue refactor) lands a regression, partial-revert is clean — earlier commits stand. **One caveat:** if P3 or P4 is reverted alone, the production behavior partially regresses (home widget incoming display OR visibility-toggle gate). Either commits 1-3 or commits 1-4 are the safe revert windows.

## 5. Test plan

Production calibration. Layer-by-layer.

| Layer | What | Where |
|---|---|---|
| Unit | sanitize regex widening (P1) | `utils/journal-state.test.ts` extend |
| Unit | `humanizeErrorKind` whitelist + fallback (P2) | `utils/journal-state.test.ts` extend |
| Unit | IncomingTransferService dedupe + late-delete + trust transitions + visibility gating + cleanup (P8) | `services/incoming-transfer/service.test.ts` extend |
| Unit | IncomingTransferRepository upsert idempotency + filters + cleanup (P8) | `services/incoming-transfer/repository.test.ts` extend |
| Unit | AccountService lifecycle wiring (P5) | `services/incoming-transfer/service.test.ts` extend |
| Component | `buildJournalTerminalCardProps` subtitle sanitization (P1) | `utils/journal-state.test.ts` extend |
| Component | IncomingTrustPopup contract verification surface (P6) | `popups/IncomingTrustPopup.test.ts` (new) |
| Component | PopupManager pending-prompts queue (P7) | `popups/PopupManager.test.ts` (new) |
| E2E smoke | Onboarding skip routes (P9) | `tests/e2e/onboarding-tab.test.ts` extend |
| E2E network | Existing wire-up smoke continues to pass | `tests/e2e/network/incoming-transfers.test.ts` (no change) |

**Selector discipline:** every new interactive element ships with a `data-testid` (CLAUDE.md rule). New testids: `incoming-trust-contract-full`, `incoming-trust-contract-copy`.

## 6. Quality gates

Locally:
- `bun run audit:vue` (typecheck → test → lint → build).
- `bun run test:e2e` smoke.
- `bun run e2e:agent` network.

Per-commit local: each commit's `bun run audit:vue` clean before the next commit lands on top.

## 7. Rollback / risk

- Single arc + squash-merge → revert is one `git revert` of the eventual squash commit.
- Per-phase commits make partial cherry-pick possible.
- No new IndexedDB schema; no migrations; no upgrade choreography.

## 8. Open questions (for the audit pass)

1. **`failedSubtitleFor` fallthrough strings** (P2) — the existing `journalTerminalDisplay` already humanizes via `failedSubtitleFor`. Should `humanizeErrorKind` reuse `failedSubtitleFor` or have its own copy? Plan goes with a separate copy because the contexts differ (the subtitle is a sentence, the kind tag is a label).
2. **Sanitize at card-component level (defense in depth)** — should `TransactionTerminalCard` + `TransactionAwaitingCard` ALSO sanitize their incoming `subtitle` / `originLabel` props, or trust the callers? Plan goes with trust-the-callers (sanitize at the builder) for now; bundle DIDDD if codex pushes back.
3. **`incomingTransfersVisible` false → true symmetry** (P4 addendum) — should toggling back ON automatically re-emit Pending events? Plan says yes (config-change subscription triggers `replayPendingPrompts`). Bundled into P4.
4. **Test backfill scope** (P8) — is the full matrix worth it for a service that's behind the visibility toggle by default? Plan: yes, Production calibration demands it.

## 9. Branch + commits + PR shape

**Branch:** continues `feat/onboarding-fees-history-arc` (no rebase, no force-push).

**Commits (Conventional, in order):**

1. `fix(activity): widen sanitize-subtitle gate to scheme: prefix + apply at every dApp-label surface`
2. `fix(activity): humanize op.error.kind via whitelist on journal detail page`
3. `fix(incoming): wire RecentActivityView's IncomingTransferServiceClient connect + initial load`
4. `fix(incoming): gate onIncomingTransferPending + replayPendingPrompts on visibility toggle`
5. `feat(incoming): subscribe to AccountService.onAccountAdded/Deleted for scheduler lifecycle`
6. `feat(incoming): contract verification redesign in IncomingTrustPopup (full address + copy)`
7. `refactor(incoming): real pending-prompts queue in PopupManager (not last-write-wins)`
8. `test(incoming): backfill service + repository coverage for dedupe / late-delete / trust / visibility / cleanup`
9. `test(onboarding): pin learn-skip + fees-skip routes in e2e`

**PR shape:** Same PR as the parent arc. Squash-merge collapses 28 commits (19 from parent arc + 9 from fixes) into one on `dev`. Reviewers see the full bisect-friendly sequence on the feature branch.

## 10. Implementation discipline

- ASCII checklist at the top of every status update.
- Per-phase lessons at `audit-fixes/lessons/phase-N.md`. Log every meaningful attempt.
- After 3 failures on the same step → stop and reassess.
- Post-impl codex audit on the fix diff (one more `xhigh` round, scoped).
- No milestone/phase tags in committed code.
- Per-commit local `bun run audit:vue` before next commit lands.

## 11. `/goal` and `/loop` seed strings

### `/goal` (primary)

```
/goal All 9 fix phases marked ✓ in the ASCII status checklist (P1 sanitize widening → P2 error.kind humanization → P3 RecentActivityView wiring → P4 visibility gate completion → P5 AccountService lifecycle → P6 IncomingTrustPopup redesign → P7 pending-prompts queue → P8 service test backfill → P9 onboarding skip-route e2e); per-phase lessons logged in implementations-plan/onboarding-fees-history-arc/audit-fixes/lessons/phase-{1..9}.md; codex post-impl audit on the fix diff complete at xhigh with adversarial ask, criticals + highs addressed; `bun run audit:vue` reports exit 0 in the transcript; `bun run test:e2e` smoke reports exit 0; `bun run e2e:agent` network reports exit 0; quality bar from the plan's Scope section is met (Production: full unit + component coverage on the broken paths, e2e for the skip-route regression, polished IncomingTrustPopup contract verification surface, real pending-prompts queue with deterministic order).
```

### `/loop` (fallback — self-paced)

```
/loop Each turn, in priority order:
1. State check: read the ASCII phase checklist; run `git status`; if PR exists, `gh pr checks --watch`.
2. If CI is in flight: stream with `gh run watch`; wait before kicking off more work.
3. If a check failed: triage + fix; call `/codex xhigh` for non-trivial decisions; commit (small, conventional) + push.
4. If the in-flight phase is green (audit:vue + targeted tests + any phase-level audit clean): mark ✓, file lessons at audit-fixes/lessons/phase-N.md, advance to next pending phase.
5. If nothing in flight: pick next pending step from plan.md and execute (edit → lint → test → commit → push → gh pr checks --watch). Order: P1 sanitize → P2 error.kind → P3 RecentActivityView → P4 visibility gate → P5 AccountService → P6 IncomingTrustPopup → P7 queue → P8 tests → P9 e2e.

Discipline: call codex on architecture / scope / security decisions; never merge to main / release branches; never publish or deploy; ASCII checklist at every update; every new interactive element ships with data-testid (no aria-label or text-content selectors); per-commit `bun run audit:vue` MUST be green before next commit lands on top. Continue until all 9 phases ✓ + post-impl codex audit clean + PR merged or blocked on me.
```

### Why both — same as parent arc rationale

`/goal` is the default (all signals transcript-observable). `/loop` is the fallback for long CI babysitting.
