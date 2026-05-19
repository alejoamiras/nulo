# Plan v2 — Land + Canonical Refactor + Manual Validation

> Status: **post-audit, pending user approval**. Two parallel audits done (Codex `xhigh` + Claude general-purpose). Strong convergence on findings; v2 incorporates all high-confidence corrections.

## v1 → v2 delta (what changed and why)

| Area | v1 said | v2 says | Source |
|---|---|---|---|
| Phase 1 conflicts | 3 files | **1 file** (`execute/index.vue`); fixtures are branch-only | Both audits |
| D1 fix | `button, [role="switch"]` | Target inner `<div>` (Toggle's clickable root), or add testid to it | Both audits |
| D3 strategy | valid method + bad args | **Drop or skip-with-architectural-note** (return Zod parse fails on placeholder shapes) | Both audits |
| D4 | rewrite as architectural test | **Remove entirely** | Both audits |
| Phase 2A drop | delete whole `sim-methods.test.ts` | **Keep file, delete only `simulateViews` case** | Codex |
| B1 manifest | `version: "1.0", metadata: { name, url }` | `version: "1.0"` literal + `metadata: { name, version, url? }` (full schema) | Codex |
| Order | 1→2A→2D→2B→2C | **1→2A→2B→2C→2D** | Both audits |
| D2 fix | change selector to `execute-op-from-name` | **Add new testid to `execute/index.vue:548-552`** (neither selector exists today) | Claude |
| Bundles cleanup | not addressed | **Remove `accounts: []` placeholder** from 5 lines in `bundles.ts` | Codex |
| File refs | `App.vue`, `connect-handshake.test.ts`, `authwit-callIntent.test.ts` | **`main.ts`, `connect-dapp.test.ts`, `authwit-variants.test.ts`** | Both audits |
| New: identity | not addressed | Decide whether to align `APP_ID` ↔ `metadata.name`, or document divergence | Codex |
| New: investigation | not addressed | **Add Phase 2F: cap-account-item propagation** (independent root cause for ~3 skipped tests) | Claude |
| New: scope note | not addressed | `session-tabClose/tabNavigate` and `fee-methods.test.ts` flagged as out-of-scope-but-tracked | Claude |

---

## Goal

Take `e2e/network-playground/pr-9` from "31 reliable / 27 skipped / mixed flake" → "all canonical wallet-sdk tests passing, Nulo-custom surface dropped, playground uses canonical capability flow".

User directive: **"stop using Nulo's specific weird things and let's just work on what's canonical"**.

---

## Phase 1 — Land current state on top of new master

**Why now:** 31 reliable tests are real validation we should bank. Branch is 20 commits ahead, 13 behind master. Each day waiting accumulates more potential conflicts.

### Steps

1. **Audit master delta** (`git log fcc13a5..origin/master --name-only`):
   - Files changed on master that ALSO changed on this branch (verified via `comm` of name lists):
     - **`packages/extension/src/popup/windows/execute/index.vue`** — the only real conflict. Master extracted `humanizeOperationKind` to `humanize.ts` (A11.1); branch added testids.
   - Master-side changes that don't conflict: parallel e2e expansion (15→50 smoke), M4 telemetry, profile TTL, passkey rp_id, crypto zeroize. All on different files.
   - **NOT in conflict despite v1's claim:** `fixtures/extension.ts`, `fixtures/helpers.ts`. These are branch-only since `fcc13a5`.

2. **Rebase strategy:**
   - Rebase `e2e/network-playground/pr-9` onto `origin/master`.
   - Resolve `execute/index.vue`: take master's humanize.ts split + branch's testid additions on top.
   - Decision: keep the 20 commits on-branch; squash at merge time, not locally. (Codex Q2: "what squash loses is history granularity, not merge safety". User can squash via GitHub merge UI.)

3. **Validate post-rebase:**
   - `bun run lint && bunx vue-tsc --noEmit` clean
   - `bun run test:e2e` — should pass at master's expected count (smoke suite — verify against actual master CI)
   - `bun run test:e2e:network` — must show 31 active passing / 27 + 7 skipped with TODO

4. **Push:**
   - `git push origin e2e/network-playground/pr-9`
   - User reviews + merges as one PR (squashed at merge time).

### Phase 1 deliverable

Single rebased branch on `origin`, 31/65 active passing, 34 skipped with `TODO(network-playground)` reasons. **~30 min** (revised down from 1 hr — only 1 conflict).

---

## Phase 2 — Canonical refactor

### Phase 2A — Drop Nulo-custom test surface (~30 min)

**Test files to update:**
- **`tests/e2e/network/sim-methods.test.ts`** — delete only the `simulateViews` case (lines 22 + others); KEEP the file for canonical `simulateTx`, `profileTx`, `executeUtility` cases.
- **`tests/e2e/network/tokens-registerToken.test.ts`** — delete entire file (Nulo-custom).
- **`tests/e2e/network/accounts-getCompleteAddress.test.ts`** — delete entire file (Nulo-custom).

**Playground UI to update:**
- `packages/playground/src/sections/contracts.ts:87-93` — remove `pg-btn-registerToken` button.
- `packages/playground/src/sections/meta.ts:58-62` — remove `pg-btn-getCompleteAddress` button.
- `packages/playground/src/sections/simulation.ts:117-124` — remove `pg-btn-simulateViews-multi` button.

**Docs to update:**
- `packages/playground/README.md:41-44` — remove references to dropped methods.

**Plan to update:**
- `implementations-plan/network-playground-testing/plan.md` §3 — mark dropped methods as "out of scope: Nulo-custom, not canonical wallet-sdk".

### Phase 2B — Capability flow canonical refactor (~1.5 hr)

**Highest-impact, biggest-semantic-change.** Audit-confirmed direction.

#### B1. Send canonical manifest

`packages/playground/src/lib/bundles.ts`:

```ts
// BEFORE: { capabilities: [...] }

// AFTER (full canonical shape per AppCapabilitiesSchema):
{
  version: "1.0" as const,                    // literal "1.0", not "1"
  metadata: {
    name: "Nulo Playground",
    version: "0.1.0",                         // required
    url: window.location.origin,              // optional
  },
  capabilities: [...],
}
```

Reference: `wallet-sdk.md:668-686`, `@aztec/aztec.js wallet.ts:487-496` (AppCapabilitiesSchema).

**Also remove `accounts: []` placeholder** from request-time capabilities at `bundles.ts:54, 62, 69, 77, 106` — request-side schema does not include `accounts` (it's a granted-side field only).

#### B2. Use `granted.accounts` as source-of-truth

`packages/playground/src/lib/wallet.ts`:

```ts
// BEFORE: connect() calls wallet.getAccounts() at lines 85-95
// BEFORE: requestCapabilities() ignores granted, calls getAccounts() at lines 109-114

// AFTER:
//   - connect(): does NOT call getAccounts() — accounts arrive via cap grant
//   - requestCapabilities(): parse `result.granted`, find accounts cap,
//     read `accounts: [{ alias, item }]`, set state.accounts + state.selectedAccount
//   - Fallback: only call getAccounts() if cap response missing accounts
```

References:
- Skill: `wallet-sdk.md:760-777`, `783-793`, `1472-1529`
- Dispatcher already returns enriched shape: `dispatcher.ts:493-503`, `524-537`

**Type the `requestCapabilities()` arg + return** with full `AppCapabilities` from wallet-sdk.

#### B3. Decide identity alignment

Two options for `APP_ID` (currently `"nulo-playground"` at `wallet.ts:14`) ↔ `metadata.name` (proposed `"Nulo Playground"`):

- **Option A: align them** — set both to `"nulo-playground"` (slug form). Cleaner.
- **Option B: keep divergent + document** — APP_ID is for discovery/secure channel; metadata.name is human-readable.

**Recommendation: Option A.** Set both to `"nulo-playground"`. The capability popup currently shows `payload.session.dappMetadata` (from discovery, not manifest) at `capabilities/index.vue:143-145`, but aligning them eliminates a divergence we'd otherwise need to track.

#### B4. Re-enable + fix dependent tests

Re-enable and update assertions to read from `result.granted` (where applicable):
- `meta-getAccounts.test.ts` (post-grant variant)
- `cap-request-accounts.test.ts:46-52`
- `authwit-variants.test.ts:27-41` (both `callIntent` + `innerHash` cases — they're parameterized in one file, NOT separate files as v1 said)
- `multi-account-from.test.ts:42-45`

**NOT unblocked by B2 alone (needs separate work):**
- `cap-request-rerequest.test.ts` — popup-readiness/timing issue, addressed by 2C.

### Phase 2C — Per-test popup readiness (~30 min)

Codex's diagnosis: `waitForPopup` waits for target+SW liveness only. Tests reading op rows / fee badges immediately get empty data on slow renders. The execute popup mounts asynchronously at `execute/index.vue:414-760`.

**One new helper, applied to ~7 tests:**

`packages/extension/tests/e2e/fixtures/popups.ts`:
```ts
export async function waitForExecuteContent(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForSelector('[data-testid="execute-op-item"]', { timeout })
}
```

Apply in tx-sendTx-* tests right after `waitForPopup("execute")`.

### Phase 2D — Per-test bug fixes (~1.5-2 hr total)

Run order: D1 → D5 → D2 → D3. (D4 removed entirely.)

#### D1. `session-reconnect`: target Toggle's clickable element

Plan v1's selector `button, [role="switch"]` does NOT match — `Toggle.vue:17-26` renders a `<div @click="toggle">`, not a button or role=switch.

**Correct fix:** target the inner div directly. Two options:
- **Option A (cheapest):** in `popups.ts:65-77`, click `[data-testid="verify-always-trust-toggle"] > div` (firstElementChild = Toggle root div).
- **Option B (cleaner):** add `data-testid="toggle-switch"` to `Toggle.vue:17`'s root `<div>`. Then helper clicks `[data-testid="verify-always-trust-toggle"] [data-testid="toggle-switch"]`.

**Recommendation: Option B.** Adds one line to Toggle.vue, makes test stable across DOM restructures.

#### D2. `multi-account-from`: ADD testid + add second account

Plan v1 said "fix selector". Audit found neither `execute-op-from-address` nor `execute-op-from-name` exists. The "From account" row at `execute/index.vue:548-552` has NO testid today.

**Required fix:**
1. **Modify production code** — add to `execute/index.vue:548-552`:
   ```vue
   <Flex
     data-testid="execute-op-from-account"
     :data-account-name="..."
     :data-account-address="..."
   >
   ```
2. Update `multi-account-from.test.ts:71` to use the new testid.
3. Add second-account creation step before connect (use `createAccount` helper from `fixtures/helpers.ts:148`).

**Caveat: depends on B2** — `opts.from` is derived from `state.selectedAccount` at `transactions.ts:45-56`, which in turn requires B2's granted-accounts source-of-truth.

#### D3. `batch-partial-failure`: skip with architectural note

Plan v1's "valid method + bad args" doesn't work because:
- WalletSchema.batch defines BOTH input and output as discriminated unions over known method names (`@aztec/aztec.js wallet.ts:604-626`)
- Extension wallet parses returned batch result via that schema (`extension_wallet.ts:124-135`)
- Dispatcher's `emptyBatchResult` (`dispatcher.ts:293-303`) returns `null` (or `{result: null}` for utility), which fails Zod parse against method-specific return schemas

**Two paths forward:**
- **Path A (proper fix):** rewrite `emptyBatchResult` per-method to return type-correct empty values matching each `methodSchemas[name].returns(...)`. ~2 hr extension-side change. Risky vs M4 changes.
- **Path B (skip + document):** convert test to `test.skip` with comment: *"batch-partial-failure isn't supportable with current wallet-sdk batch architecture (return-schema discriminated union). Either refactor `emptyBatchResult` per-method or accept this limitation."*

**Recommendation: Path B for now.** Track Path A as a separate bridge-side investigation (Phase 2F). Don't block this branch on architectural rewrite.

#### D4. `elevated-confirmation`: REMOVE entirely

Audit-confirmed: `simulateTx` never goes through `DappInteractionService.execute()`. The test premise is fundamentally invalid. v1's "rewrite as architectural-correctness test" adds noise.

**Action:** delete `tests/e2e/network/elevated-confirmation.test.ts` outright. Don't replace.

#### D5. `wallet-locked-mid-session`: lock-propagation poll

After `lockWallet(popupPage)`, poll `chrome.storage.session` for `nulo:liveness` to disappear before firing the next RPC. Independent of B2/C.

### Phase 2E — Optional diagnostics (DEFER)

Audit-recommended: defer. Worth doing as a separate observability PR after Phase 2A-D ships.

### Phase 2F — Independent investigations (track for later)

These are real root causes audit identified that are NOT addressed by Phase 2A-E. Track separately:

1. **`cap-account-item` propagation issue** — `cap-request-accounts` and `meta-getAccounts` (post-grant) skipped TODOs both point to: "click fires on cap-account-item but `selectedAccounts` state doesn't reach dapp session via `resolveInteraction`". Independent of B2's capability-flow refactor. Needs investigation in extension popup ↔ background service flow.

2. **`session-tabClose` / `session-tabNavigate` premise mismatch** — tests assume transport termination deletes persisted DappSession. It doesn't (per `background.ts:216-244`). Either redesign tests to assert actual auto-approve-on-reconnect behavior, or drop them.

3. **`fee-methods.test.ts` parameterized tests** — 4 entries (2 skip, 2 skipIf). Likely affected by sendTx popup readiness (Phase 2C) but not explicitly verified.

4. **`emptyBatchResult` per-method shapes** — Path A from D3, if we want batch-partial-failure to work canonically.

These are tracked as follow-ups but NOT part of v2 scope.

### Phase 2 expected outcome

Conservative estimate (audit-adjusted):
- 2A: -3 tests dropped, baseline 65 → 62 active
- 2B: unblocks 4-5 (capability-dependent)
- 2C: unblocks 5-7 (popup readiness)
- 2D: unblocks 2-3 (D1, D5 confirmed; D2 conditional on B2; D3 skipped; D4 removed)
- New target: ~45-50 reliable / 5 flake / 8-10 skipped (vs v1's 50/5/5)

---

## Phase 3 — Manual validation checkpoints

User does eyes-on testing at two milestones.

### Checkpoint 1: After Phase 2B (capability refactor)

User runs:
```sh
cd packages/playground
bun run dev  # http://localhost:5174/
```

Then:
1. Click Connect → approve discover → approve verify
2. Click "Request capabilities" with `accounts` bundle → cap popup → select an account → approve
3. **Open the result feed** and find the `requestCapabilities` row
4. **Inspect `data-result-json`** — does it contain `granted: [..., { type: "accounts", accounts: [{ alias, item }] }, ...]`?
5. Click `getAccounts` button — does the result match the granted accounts?
6. Report back the exact JSON.

Validates B2 with eyes-on before finalizing. Direct evidence of where any gap is.

### Checkpoint 2: After Phase 2C (popup readiness)

```sh
cd packages/extension
HEADLESS=0 bun run vitest run --config vitest.e2e.network.config.ts -t "tx-sendTx-default"
```

User watches execute popup render in 3 phases (blank → op-card → fee-card). Reports timing between phases. Tells us if 15s `waitForExecuteContent` is too tight, just right, or too loose.

### Checkpoint 3 (optional): After Phase 2D (D1)

User runs `session-reconnect alwaysTrust=true` headful, watches whether Toggle visibly flips when clicked. Confirms D1's fix works.

---

## Order of execution (audit-aligned)

1. **Phase 1** — rebase + push (~30 min) — only 1 conflict
2. **User reviews + merges Phase 1 PR**
3. **Phase 2A** — drop Nulo-custom (~30 min) — quick prep, also removes selectedAccount dependencies before B2 lands
4. **Phase 2B** — capability refactor (~1.5 hr) — biggest impact
5. **Manual checkpoint 1** — user inspects requestCapabilities JSON
6. **Phase 2C** — popup readiness helper (~30 min)
7. **Phase 2D** — bug fixes (D1, D5, D2, D3-skip) (~1.5-2 hr)
8. **Manual checkpoint 2** — user runs tx-sendTx-default headful
9. **(Optional) Phase 2D-D1 verification** — manual checkpoint 3

**Total agent work:** ~4.5-5.5 hours (revised down from v1's 5-6 hr because of Phase 1 single-conflict + D4 removal).

**Phase 2F** (cap-item propagation, session-tab*, fee-methods, emptyBatchResult) tracked as post-merge follow-ups.

---

## Open questions — RESOLVED

1. **Order**: `1 → 2A → 2B → 2C → 2D` (audit consensus). Within 2D, run independent items (D1, D5) before B-dependent ones (D2).
2. **Phase 1 squash vs stack**: keep 20 commits on-branch, squash at merge time (preserves provenance, audit-recommended).
3. **Phase 2D inter-deps**: D1 indep · D5 indep · D2 depends on B2 + C · D3 redesigned to skip · D4 removed.
4. **Phase 2E worthwhile**: No, defer to separate observability PR.
5. **Risks of dropping Nulo-custom**: zero for currently-passing tests. Caveat: don't delete whole `sim-methods.test.ts` (canonical cases live there too).
6. **B2 ripple effects**: zero for currently-passing tests in connect/meta/cap/handshake set. Visible UI change: header/account list empty until cap grant — acceptable, this is canonical behavior.

---

## Decision points for user approval

Before I implement:

- [ ] **Phase 1 strategy**: rebase on origin/master, keep 20 commits, push, GitHub squash-merge. OK?
- [ ] **Phase 2A scope**: delete `tokens-registerToken.test.ts` + `accounts-getCompleteAddress.test.ts`; delete only `simulateViews` case from `sim-methods.test.ts`; remove 3 playground buttons; update README. OK?
- [ ] **B3 identity choice**: align `APP_ID` ↔ `metadata.name` to `"nulo-playground"` (Option A)? Or keep divergent (Option B)?
- [ ] **D1 fix choice**: add `data-testid="toggle-switch"` to `Toggle.vue` (Option B), or use child-selector hack (Option A)?
- [ ] **D3 strategy**: skip-with-architectural-note (Path B), or invest 2hr to fix `emptyBatchResult` per-method (Path A)?
- [ ] **Manual checkpoints**: 2 (after 2B + after 2C) — or do you want more/fewer?

Once approved, I execute Phase 1 → Phase 2A→B→C→D, pausing at the two checkpoints for your eyes-on validation.

---

**End of plan v2. Awaiting user approval.**
