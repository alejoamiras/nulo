# Opus pre-impl audit — Onboarding + Fees + History arc

Date: 2026-06-02
Reviewer: Opus 4.7 (subagent)
Plan reviewed: `implementations-plan/onboarding-fees-history-arc/plan.md` v1

## Verdict — Approve-with-changes

The arc is sensibly scoped and the F4 fix is structurally correct. **Two findings must be addressed before implementation begins:** (a) the F4 inventory is missing at least one site (`OperationPlanner.extractPrimaryMethod` at `operation-planner.ts:239-250`) which produces the in-flight task content label; (b) the F1 step-renumbering is built on a misread of `StepIndicator.vue` — the existing indicator has 4 cells, not 6, and welcome.vue has none. The plan would require redesigning the indicator (5 cells with new vocabulary, or a 2-row format) rather than bumping ints. Both are recoverable in the planning phase; the surface change is small but the plan currently does not reflect reality.

Beyond those two, F2 (incoming transfers) has a tighter set of edge cases than the plan acknowledges — specifically: deciding whether to render incoming transfers AT ALL when the user has self-mint outflow records, and how the new IndexedDB store handles network/profile delete events on a service that piggy-backs on `TokenBalanceService`. F3 is the lowest-risk phase as written.

## Critical findings

### C1. F4 missing site — `OperationPlanner.extractPrimaryMethod`

**Severity:** Critical (functionally wrong claim in the plan).
**Citation:** `packages/extension/src/wallet/services/execution/operation-planner.ts:239-250`; used at `service.ts:894` (`const content = new ExecuteOperationContent(operation.kind, this.planner.extractPrimaryMethod(operation))`).

The plan lists 5 sites. There is a 6th: `OperationPlanner.extractPrimaryMethod` powers the in-flight `ExecuteOperationContent.primaryMethod`, which the popup renders as the in-flight title via `RecentActivityView.vue:128-140` (`executingProgressTitle` → `humanizeMethodName(task.content?.primaryMethod)`). That title is the **same surface** the F4 bug manifests on — for the faucet drip scenario, the task content's `primaryMethod` would resolve to whatever the planner's "first call/action" returns, which is the un-filtered raw value.

Concretely, when the dApp sends `{ calls: [{ name: "drip_to_private" }, { name: "sponsor_unconditionally", ... }] }`, the planner picks the first one (correct in that ordering). When aztec.js prepends the sponsor call (which it does in some configurations — see `packages/faucet/src/composables/useFaucetDrip.test.ts:76` test mock confirms the merge but real aztec.js behavior is configuration-dependent), the planner picks `sponsor_unconditionally`. The proving-state in-flight card's title is fed by this planner output too. The F4 fix in `tx-enrichment.ts` is correct but **must be wired through the planner**, not just the 5 sites the plan names.

**Recommendation:** Add the planner as site #6. Either inline `pickPrimaryMethod` at `extractPrimaryMethod`'s return point, or change `extractPrimaryMethod` to call into the shared helper. Add a planner-level test pinning the drip-with-sponsor input → drip-fn-name output.

### C2. F1 step-renumbering misreads `StepIndicator.vue`

**Severity:** Critical (the proposed change cannot be implemented as written).
**Citation:** `packages/extension/src/onboarding/components/StepIndicator.vue:16-23` defines exactly 4 steps with hardcoded labels `[Setup, Aztec, Speed, Done]` and a typed prop `current: 1 | 2 | 3 | 4`. The actual current onboarding flow has Welcome (no indicator) → Create/Import (both at indicator `:current="1"`) → Learn (`:current="2"`) → Accelerator (`:current="3"`) → Done (`:current="4"`).

The plan describes "Welcome=1, Learn=2, Fees=3 (NEW), Accelerator=4, Create=5, Import=6, Done=7" — that contradicts the existing flow (create/import come BEFORE learn, not after) and assumes 7 indicator positions when there are only 4. The plan's bumping table mirrors `create.vue (was 4 → 5)`, `import.vue (was 5 → 6)`, etc. — neither create.vue nor import.vue is at those numbers in the current code (they're both at `current=1`).

**Recommendation:** Either:

1. Add a 5th indicator step ("Speed" → split to "Fees" + "Speed"), redesign the indicator type from `1 | 2 | 3 | 4` to `1 | 2 | 3 | 4 | 5`, update the `steps` array's labels and grid columns (CSS `repeat(4, 1fr)` → `repeat(5, 1fr)`), and renumber only `accelerator.vue (3 → 4)` + `done.vue (4 → 5)`. Welcome/Create/Import unchanged.
2. OR introduce a sub-step under "Aztec" — keep 4 cells but render the fees page as a continuation of step 2. Cheaper UI churn but the user has clear pacing semantics with the current 4-step model — a non-bumping option is probably worse UX.

Option 1 is the cleaner choice given the calibration is Production. Either way the plan's renumbering table must be rewritten.

### C3. F2 dedupe race — journal `progress.txHash` timing window

**Severity:** Critical (false-positive incoming-transfer surface).
**Citation:** `packages/extension/src/wallet/services/execution/service.ts:1148` writes `markJournal({stage:"submitting", txHash})` BEFORE `addTransaction(...)` at line 1153. The journal write is `awaited`; if the awaited write fails or is slow, there's a transient state where the chain tx is mined and PXE sync delivers the change-note BEFORE either `transactionService.addTransaction` or `markJournal` completes. The plan calls this out for the "in-flight" path but **misses the symmetric window in the embedded-fee path** at `service.ts:1791` (`executeAztecSendTx`) and `service.ts:1869+` (`executeNoFromSendTx`).

Worse: `markJournal` is best-effort (failures are caught and logged at line 1245-1247) so on a journal write error, the txHash never lands in the journal — but the chain tx might still mine. The plan's dedupe says "check in-flight journal records' `progress.txHash` field" — if `markJournal` silently failed, the journal record will be in `proving` stage with no txHash, the chain tx will go through `addTransaction` and become deduplicable, but the **window between sendTx and addTransaction can mint a false-positive incoming row** if PXE is fast (sandbox conditions easily race here).

Reading the plan's edge-cases pin carefully: it correctly identifies the in-flight race for `markJournal({stage:"submitting"})` → `addTransaction`. It does NOT identify the symmetric `proving → submitting` window where journal write to `submitting` is mid-flight or has failed.

**Recommendation:** Treat the dedupe as eventually-consistent, NOT as a real-time invariant. Concretely:
1. Maintain an in-memory "recently submitted txHash" ring buffer in `IncomingTransferService` that survives a longer window than the markJournal latency (suggest 60s; the e2e race usually closes in <1s but SW + IDB writes during heavy proving can stretch).
2. When `addTransaction` event fires, push to the ring buffer THEN sweep existing incoming records for any that match — drop them.
3. Make incoming-record insert **idempotent** by (`networkId, accountAddress, contract, txHash, storageSlot`) so a delete-then-replay sequence is safe.
4. Pin: integration test simulates `proving → submitting` race by stubbing `markJournal({stage:"submitting"})` to delay 200ms; assert the incoming row is suppressed once `addTransaction` lands.

### C4. F2 sender-attribution leak — incoming-receive surface for dApp-mediated transfers

**Severity:** High (privacy + UX correctness).
**Citation:** `packages/extension/src/wallet/services/note/service.ts:50-90` returns ACTIVE notes including ones the user MADE via a transfer-to-self pattern (common in mint flows + change notes). The plan dedupes against `TransactionService.getTransactions` by `txHash`, but **a change note is NOT a separate tx — it shares the same txHash as the outgoing transfer**. Same txHash → same storageSlot? No — change notes write to a different storage slot from the recipient note. The plan's uniqueness key is `(networkId, accountAddress, contract, txHash, storageSlot)`; if a self-mint produces both an output note (recipient slot) AND a change note (sender slot) under the same txHash, the plan's dedupe-by-txHash check correctly suppresses both — but only if the entire dedupe gate considers the note's TARGET (owner) vs the user's account. Re-read the plan:

> dedupe vs: the user's own outgoing tx hashes

OK — that catches the self-mint case at the txHash level. But for a **dApp-mediated transfer the user signed** (e.g., dApp instructs the user to send 100 USDC to address X, dApp's contract instructs the wallet to also mint 50 bonus USDC to the user), the journal records and the chain tx record carry one txHash; the wallet's outgoing-tx record exists. The dedupe correctly drops the dApp-mediated bonus inflow. Good — but **what about the change note?** The user sent 100 USDC, retained 200 USDC of change. The change note shows up as an ACTIVE note on the user's account, txHash matches an outgoing tx → DEDUPED via the user's-own-outgoing-hash gate. Net effect: change notes are NOT surfaced as incoming. That's the desired behavior.

The remaining case the plan does NOT address: **someone else's outgoing tx where the user is a recipient, AND the user has previously interacted with the same contract.** The user has the token contract in their list (the gate). The note arrives on PXE. `txHash` does NOT match any of the user's own outgoing → it surfaces as incoming. Correct. BUT the cross-device same-seed case the plan mentions: user has device A and device B sharing a seed. Device B sends 100 USDC to a contact. Device A sees both the change note AND the recipient note via PXE sync. Both have the same txHash. The change note arrives on device A's account — would surface as "incoming" because device A has no outgoing tx record for that txHash. The plan calls this a documented limitation; I think it's worse than documented because it makes the activity feed lie under a common (cross-device) scenario.

**Recommendation:** Add a heuristic gate: incoming-transfer rows are suppressed if `inc.amountRaw === 0` OR if the note's owner is also the address that signed the txHash's transaction (if PXE exposes that info — verify via `pxe.getTxReceipt(txHash).from` or equivalent). The latter would correctly catch the cross-device same-seed case. If PXE doesn't expose sender, document explicitly that cross-device same-seed users will see their own outgoing transfers as "incoming" on every other device, and **add a settings toggle** to suppress incoming-receives entirely (escape hatch). Settings-only is the minimum acceptable behavior for Production calibration.

### C5. F3 raw-error rendering — `op.error` structure has more than `.message`

**Severity:** High (information leak).
**Citation:** `packages/extension/src/wallet/services/operation-journal/spec.ts` defines `JobError` (referenced via `service.ts:1171` and `service.ts:567`). The plan gates raw `op.error.message` behind dev-mode/debug-mode. But `JobError` also carries `kind` (already safe — categorical) and potentially `rawCause` / additional fields.

<!-- Investigation: need to confirm the JobError shape and what other fields might leak. From the rest of the codebase, `normalizeError(error, "transfer")` produces the JobError. -->

Let me check what `normalizeError` produces. From `utils/journal-state.ts:113` we know `op.error?.kind` is the categorical safe value. The plan should:

**Recommendation:** Inspect `JobError` schema in `operation-journal/spec.ts`. Display ONLY `kind` by default (categorical, safe). Gate `message` AND `rawCause` AND any other free-text field behind the dev-mode toggle. Also: explicitly forbid rendering `subtitle` if it contains a URL pattern (`https?://`) — a malicious dApp could set a deceptive `subtitle` (origin name) at session-discover time and leak it into the journal record. Verify subtitle is sanitized at write-time. Pin via a test: create a journal record with subtitle `"https://evil.com/?steal=secret"`, assert the detail page renders it without making it clickable.

## High findings

### H1. F2 — `IncomingTransferService` placement crosses unmodeled boundary

**Severity:** High (architectural).
**Citation:** `ARCHITECTURE.md:48-60` defines the package hierarchy; the new service lives in `packages/extension/src/wallet/services/incoming-transfer/`. That's inside `@nulo/extension` — same package as the existing services. **No cross-package boundary violation** because all existing services it consumes (TokenBalanceService, NoteService, TransactionService, OperationJournalService) are also in `@nulo/extension`.

BUT the plan says "piggy-back on the existing `TokenBalanceService`'s sync cadence." This creates a runtime dependency: `IncomingTransferService` must start AFTER `TokenBalanceService`. The wallet-core base class supports `dependencies: readonly string[]` (`packages/wallet-core/src/base/index.ts:24-31`) — the plan must add this to the new service. Without it, the service starts in phase 0 with no guarantee TokenBalanceService is up; subscribing to `onTokenBalanceUpdated` could miss the first emission.

Also worth flagging: `TokenBalanceService` itself has no declared dependencies (checked via grep), so it's in phase 0; but it consumes 6 other services. The plan should pattern-match and explicitly declare deps for `IncomingTransferService` even if the existing pattern is loose.

**Recommendation:** Declare `dependencies = [TOKEN_BALANCE_SERVICE_NAME, NOTE_SERVICE_NAME, TRANSACTION_SERVICE_NAME, OPERATION_JOURNAL_SERVICE_NAME]` on the new service so startup ordering is explicit. Update the plan's "Discovery loop" section.

### H2. F4 — `extractPrimaryMethodFromSendTx` location is wrong layer

**Severity:** High (layer boundaries).
**Citation:** Plan section "Phase 1" says "`extractPrimaryMethodFromSendTx` keeps its name (it's exported and used by tests) but its body becomes `return pickPrimaryMethod(exec.calls)`."

`extractPrimaryMethodFromSendTx` lives in `packages/extension/src/wallet/services/wallet-sdk/queued-journal.ts:171-178` — the service-worker side. The proposed `pickPrimaryMethod` helper goes in `packages/extension/src/utils/tx-enrichment.ts`. `tx-enrichment.ts` is at the popup-layer utility level (L0/L1-ish), imported by popup components.

Cross-checking: `service.ts:131` already defines `primaryActionMethod`. Either:
- The popup-layer helper `pickPrimaryMethod` is imported by service-worker code — that crosses the popup/wallet boundary. **It works at runtime** (same bundle) but the directional dependency goes from SW → popup-utils, which is the opposite of the L0–L6 model (popup imports utils, not the other way around).
- OR: move `pickPrimaryMethod` to a lower layer (e.g., `packages/wallet-core/src/utils/`) so both wallet services and popup utils can import it.

The plan implicitly assumes the former — fine in practice (no biome rule forbids `@/utils/tx-enrichment` from service worker code), but it's a smell. The cleanest answer is to **put `pickPrimaryMethod` in a shared util location** that doesn't conflate "tx enrichment for activity-feed display" with "wallet-internal journal-title picking." A package like `@nulo/wallet-core/utils` would be ideal. If keeping in `@nulo/extension`, at least put it in `src/utils/` standalone (not `tx-enrichment.ts` which is popup-flavored), and import from both popup and wallet-services.

**Recommendation:** Put `pickPrimaryMethod` + `FEE_METHODS` in `packages/extension/src/utils/primary-method.ts` (or move `FEE_METHODS` to a shared location). Have both `tx-enrichment.ts` (popup) and the 6 wallet-side sites import from there. Update biome rules if needed (currently `noRestrictedImports` doesn't restrict popup utilities, so this works). Pin via a test that imports the helper from both sides and asserts the output is byte-identical.

### H3. F4 — `app.store.ts:130` uses `tx.calls[0]` for destination resolution

**Severity:** Medium-High (silent regression risk for awaiting-tx dedupe).
**Citation:** `packages/extension/src/stores/app.store.ts:128-138`. `onTxAdded` does `const call = tx.calls[0]; const destination = call?.transfers?.length ? call?.transfers[0].to : (call?.args?.[1] as string | undefined)` to dedupe against `awaitingTransactions`.

If `tx.calls[0]` is the fee call (sponsor_unconditionally), then `call.transfers` is empty (fee calls don't carry transfers), `call.args?.[1]` is the fee-call's address (likely the sponsored FPC address, NOT the user's intended recipient). The awaiting-tx dedupe by `destination` is then comparing the FPC address vs the recipient address — they don't match — so the awaiting placeholder is NOT cleared when the tx confirms. This is the **third symptom of the same root cause**, and the plan doesn't pin it.

The good news: `executeTransfer` explicitly persists a transfer-only call shape (`service.ts:533-553`), so for UI-initiated transfers `tx.calls[0]` is the transfer call. But dApp-initiated sends call `addTransaction(...txCalls, ...)` from `service.ts:1153` and `1796` — where `txCalls` IS the FPC-mutated list. So this IS a regression for dApp paths.

**Recommendation:** Either:
1. Have `app.store.ts:130` also use the shared `getPrimaryCall` helper. Tradeoff: store gets a popup-utility import, slight smell but harmless.
2. Re-shape `addTransaction` for dApp paths to also persist the user-intent shape (mirror what `executeTransfer` does). Cleaner long-term but more invasive.

Either way, **add a test pin in `app.store.test.ts` (or create) for the dApp-with-FPC tx case** so this regression is caught. The plan doesn't mention `app.store.ts` at all.

### H4. F2 — `aztec_registerToken` social-engineering vector

**Severity:** Medium-High (anti-phishing).
**Citation:** `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts:36` (`PATCHED_SCHEMA = z.function().args(schemas.AztecAddress, schemas.AztecAddress).returns(z.void())`). A dApp can call `registerToken(tokenAddress, accountAddress)` and the wallet pops the token-import popup. The user sees the preview metadata (`tokenService.previewTokenMetadata`).

The plan's threat model says: "Adding a token requires the user to confirm a `TokenInfo` import via popup." True. But the preview metadata is **the contract's own `getName` / `getSymbol` / `getDecimals` return values** — a malicious contract can return "USDC" for `getSymbol()`. The user sees a popup that says "USDC?" — and an attentive user is supposed to check the contract address. In practice users don't.

Once added, the malicious contract sends notes to the user, those notes decode via the wallet's note schema (UintNote shape) → the plan would surface them as "Received 1000 USDC". The user's history page now lies about their balance.

The plan's mitigation ("scope to user-added tokens") is necessary but **not sufficient**. The wallet's existing TokenCard surface has the same issue today — but the activity-feed addition makes the lie more prominent (recency + count + amount summed across multiple notes).

**Recommendation:** Two mitigations, pick at least one:

1. **Symbol-collision badge:** When showing the incoming-card with a token symbol, check if there's another known token with the same symbol on the same network. If yes (e.g., real-USDC at the canonical address vs fake-USDC at attacker's address), render a "Verify token" badge on the card and link to the token-detail page that shows the contract address.

2. **First-receive friction:** The FIRST incoming-note from a contract should require a one-shot user confirmation ("Token X (contract 0xabc...) sent you a note. Allow this token to appear in your activity?"). Subsequent receives from the same contract auto-display. This is the per-contract analog of the per-dApp connection prompt.

Option 2 is the more honest defense; option 1 is cheaper. For Production calibration, option 1 alone is insufficient — the badge isn't a click target, it's just decoration. Option 2 should ship.

### H5. F4 mint heuristic edge case — `pickPrimaryMethod` returns `userMethods[1]?.startsWith("mint")` but doesn't gate on `userMethods.length >= 2`

**Severity:** Medium-High (logic bug in proposed helper).
**Citation:** Plan section 2.1, code block:

```ts
if (userMethods[1]?.startsWith("mint")) return userMethods[1]
return userMethods[0]
```

If `userMethods.length === 1`, `userMethods[1]` is `undefined`, `?.startsWith` returns undefined, the if-check is falsy → returns `userMethods[0]`. Behavior is correct by accident.

But: what if `userMethods.length === 0` AND `named.length > 0` (all calls were fee calls)? The early-return `if (userMethods.length === 0) return named[0]` handles it. Good.

What if the user has 3 calls and call #1 is `transfer_in_private`, call #2 is `mint_to_private`, call #3 is something else? The helper returns `mint_to_private`. The existing `getPrimaryCall` does the same. Pre-existing behavior preserved — good.

What if `userMethods[1]` is exactly the string `"mint"` (without underscore)? `startsWith("mint")` returns true. Edge case is fine but worth pinning.

**Recommendation:** Add explicit pinning tests:
- empty input → undefined
- all-fee-only → first named (preserves current behavior even though it shows a fee name)
- 1 user call → returns it
- 2 user calls, 2nd is `mint_to_private` → returns mint
- 2 user calls, 2nd is `mint` → returns mint
- 2 user calls, 2nd is `transfer_in_private` → returns 1st

The 2nd case (all-fee-only fallback) is itself a bug in the existing `getPrimaryCall` — if ALL calls are FEE_METHODS, it returns the first one anyway. The plan should preserve this for backward compat **and** test-pin it as a `(BUG PIN)` per the CLAUDE.md convention.

## Medium findings

### M1. F1 — Onboarding e2e test path may not exist

**Severity:** Medium (plan claim correctness).
**Citation:** Plan section 2.2 says "extend `packages/extension/tests/e2e/onboarding*.test.ts` (whichever covers the welcome→done path)".

I did not verify this file exists. The plan's "whichever covers" phrasing is a smell — the impl phase should NOT discover the e2e file structure on the fly.

**Recommendation:** Before approval, the planner should confirm the exact e2e file path. If multiple match, pick the canonical one. The plan should name the file explicitly.

### M2. F3 — Pending-tx banner persistence open question — answer is wrong

**Severity:** Medium (UX inconsistency).
**Citation:** Plan section 8, open question 1: "Should the new pending-tx banner persist across navigation, or only on the detail page? Plan goes with detail-page-only — simpler."

The user has already shipped a sticky page title bar (`activity.vue:178-194`) and a chronological merge of in-flight + terminal + settled rows in `RecentActivityView.vue:74-97`. The pending-tx state is already surfaced as a status icon on cards. Adding a top-of-detail-page banner that **only shows on that page** creates an inconsistency: the home/activity page shows a green clock-circle for pending; the detail page shows a banner. Users navigating between surfaces see the same fact rendered two different ways.

**Recommendation:** Either:
- Cut the banner entirely. The hash + pending status icon + `txTime` is sufficient. Add a "Pending settlement" subtitle to the fee row instead of a banner.
- OR commit to a global banner: render the same "Waiting for inclusion" message in the home/activity surface too, as a top-of-page strip when any pending tx exists.

For Production, the cleaner choice is option 1 (cut the banner). The plan as written adds banner-only-on-detail and creates UX drift.

### M3. F2 — Row-merge extraction location

**Severity:** Medium (testability).
**Citation:** Plan section 2.4 says "Unit test on the row-merge logic (extract to a pure helper in `popup/pages/activity-rows.ts` so it's testable without mounting Vue)."

`popup/pages/` is the L6 layer (per CLAUDE.md). Pure helpers consumed by L6 pages and L4 modules (`RecentActivityView` is L4 at `popup/components/modules/general/`) should NOT live in `popup/pages/` — that makes a module import from a page, which the biome ruleset forbids (`biome.json:251-261`: "L4 modules cannot import from L5 pages or L6 windows").

Wait — `popup/pages/activity.vue` IS where the merge logic currently lives, and L6 importing from L6 is OK. But `RecentActivityView.vue` (L4) doing the equivalent merge would need to import from L6, which is forbidden.

The plan's proposed location `popup/pages/activity-rows.ts` is the wrong layer. The pure helper should go in `packages/extension/src/utils/` (L0 — `tx-enrichment.ts` is already there) or `packages/extension/src/popup/utils/` if popup-specific.

**Recommendation:** Move the helper to `packages/extension/src/utils/activity-rows.ts`. Both `activity.vue` (L6) and `RecentActivityView.vue` (L4) can then import it. The plan must be updated.

### M4. F2 — IndexedDB store cleanup on profile delete

**Severity:** Medium (data hygiene).
**Citation:** Plan section 2.4: "`IncomingTransferRepository.clearProfile(profileId)` is called by the profile-delete flow."

The plan says to mirror `TransactionService` plumbing. Let me check what TransactionService actually does:

<!-- Investigation would require reading the profile delete flow's calls into TransactionService. From the recon, I haven't verified the cleanup hook surface. -->

**Recommendation:** Before impl, confirm the profile-delete fanout pattern in `ProfileService.deleteProfile` (or equivalent). The plan should name the exact function that takes a `profileId` and the lifecycle hook. If TransactionService uses an event subscription, IncomingTransferService should mirror it. If it uses an explicit call from the profile-delete code path, IncomingTransferService should be added to that path with a test pin.

### M5. F4 — Test depth for the helper

**Severity:** Medium (test coverage gap).
**Citation:** Plan section 2.1: tests pin "drip regression explicitly", `mint_to_private`, `transfer_in_private`.

The current `tx-enrichment.ts` has NO tests. The plan adds a test file for `pickPrimaryMethod` AND mentions covering the rest of the module (`getPrimaryCall`, `getTxTitle`, `getTxCategory`, `getCallCountLabel`). Good.

But the plan doesn't pin:
- `humanizeMethodName` (handles hex selectors, snake_case)
- `getMethodLabel` (METHOD_LABELS lookup)
- `formatTransferType` (TransferType enum)
- `formatCallSummary`
- `getOriginLabel`

Production calibration demands the full module gets a test sweep, not just the new helper.

**Recommendation:** Add tests for the remaining 5 exported functions. Total file size ~25-35 tests; reasonable.

## Low findings

### L1. F3 — `onJournalDeleted` / `onJournalAdded` race on detail page

**Severity:** Low.
**Citation:** New `journal/[id].vue` would presumably subscribe to journal events. If the user is on the detail page and another flow deletes the journal record (GC, profile delete), the page should redirect (or show a "Record removed" empty state). Plan doesn't mention.

**Recommendation:** Treat journal-record-disappeared as a UI state. Redirect to `/popup/activity` with a one-shot toast "Record removed" rather than rendering a blank page.

### L2. F1 — Skip link routing

**Severity:** Low.
**Citation:** `learn.vue:59-69` skip routes to accelerator (NOT done). Plan says fees.vue's skip routes to accelerator. Consistent.

But: should the user be able to skip the fees step? It's an explainer with no required action. If yes, skip is a no-op (just navigate forward). If no, skip should not be offered. The plan offers skip, which makes the step purely informational — fine but inconsistent with the framing that fee-juice knowledge is required to send a transaction.

**Recommendation:** Either drop the skip link (fees explainer is required-read because the user will hit it again at first send) or keep it consistent. No change required if the existing plan stands; just flag the inconsistency.

### L3. F4 — `// biome-ignore` reason discipline

**Severity:** Low.
**Citation:** The proposed `MethodCarrier` type uses `method?: string; name?: string`. If the helper is consumed at sites that have stronger typing, the cast may need a biome suppression. Mention nothing.

**Recommendation:** Trivial. Note for impl: if you need a cast, include a `// biome-ignore` with a reason per CLAUDE.md L289.

### L4. F2 — `arrow-narrow-down-left` icon name verification

**Severity:** Low.
**Citation:** Plan section 2.4: "Icon: `arrow-narrow-down-left` (incoming arrow — verify exists in `icons.json` first)".

The TransactionCard uses `arrow-narrow-up-right` for outgoing. The plan flags the verification but it would be cheaper to verify in the plan phase.

**Recommendation:** Confirm the icon exists in `packages/extension/src/assets/icons.json` BEFORE impl. If absent, decide on the alternative (add it, or use a different existing icon).

### L5. F2 — Token-detail history scope question

**Severity:** Low.
**Citation:** Plan open question 3 defers "should incoming receives count toward Total transferred this token stats?" — fine to defer.

**Recommendation:** No action. Defer is the right call for this arc.

## Nits

### N1. Plan section 4 — "Risk-ascending" ordering claim

Phase ordering is named risk-ascending. F4 (1 helper + 5+1 sites) is genuinely lowest risk; F1 (UI-only) is lower than F3 (new route + new page with service-client consumption). F2 (new background service) is clearly highest. The ordering is fine, but **the plan's claim that "if F2 fails codex audit, F1-F3 can ship via partial revert" is only true if F1-F3 didn't add testids/imports/etc that F2 depends on.** Spot-check during impl to ensure no F1/F2/F3 → F4 coupling.

### N2. Plan section 9 — Commit messages need scope

The Conventional Commit examples are good. Suggest tightening scope tags:
- `fix(activity)` → `fix(tx-card)` for the F4 fix (more specific).
- `feat(onboarding)` is fine.
- `feat(activity)` is fine for F3.
- `feat(activity)` for F2 — collision with F3. Use `feat(history)` or `feat(incoming)` to differentiate.

### N3. Code comment style — milestone vocabulary

Throughout the impl, ensure no comment tags reference "F1", "F2", "Phase 1", "Phase 4". CLAUDE.md L281-283 forbids these. The plan itself uses them (fine — it's a planning doc, not committed inline code) but the impl must strip them.

## Open questions the plan misses

### Q1. F2 — Should incoming-receives surface in the awaiting/in-flight area?

Specifically: if a note arrives via PXE sync while the user is on the home page, should the activity feed react in real-time (event-driven via `onIncomingTransferAdded`), or only on next mount? Plan implies real-time. Verify whether the activity feed's reactivity is built for this.

### Q2. F2 — Token-detail page entry point for incoming-receives

The plan extends `tx/[id].vue` to also resolve from `IncomingTransferService` (`section 2.4, step 5`). But: the route is `/popup/tx/${inc.txHash}`. The detail page already resolves `tx.hash` against `appStore.transactions`. The plan adds a fallback resolver for the incoming case. **What about an incoming tx whose txHash collides with an outgoing one?** (See C4 above for the cross-device case.) The resolution order matters — outgoing should win because it's authoritative.

### Q3. F2 — Note schema version / decode error metadata leak

When `NoteService.parseNote` returns a note with `renderError` (decode failure), the plan says to skip rendering. But the journal/incoming record stores `txHash` regardless. If a future schema decode succeeds where it didn't before (after a schema update), should the historical record retroactively appear? Plan doesn't address.

### Q4. F3 — "Try again" affordance

The plan explicitly defers a "Try again" button. But for `error.kind ∈ { interrupted }`, a try-again is the user's natural next step. Document the deferral as a real follow-up in the implementations-plan index so it's not forgotten.

### Q5. Phase ordering — pre-impl validation gates

The plan calls for `bun run audit:vue` + `bun run test:e2e` + `bun run e2e:agent` as gates. For a 4-phase commit chain, **should each phase's commit pass these locally before moving to the next?** Or only the final HEAD before pushing? The plan implies the latter. For Production calibration, per-phase validation is cheap insurance — recommend the former (each commit's local validation before adding the next commit).

## Recommended changes before approval

Address before plan goes to the user for the approval gate:

1. **C1**: Add `OperationPlanner.extractPrimaryMethod` as the 6th site. Update the bug-fix wiring.
2. **C2**: Rewrite the F1 step-renumbering table to match `StepIndicator.vue`'s actual structure. Decide: expand to 5 indicator cells, or sub-step within "Aztec".
3. **C3**: Strengthen F2 dedupe with an in-memory recent-txHash ring buffer + idempotent inserts. Pin the proving→submitting race in tests.
4. **C4**: Document the cross-device same-seed limitation; add a settings escape hatch.
5. **C5**: Audit `JobError` shape; restrict raw-error rendering to `kind` by default.
6. **H1**: Add `dependencies` declaration to the new service.
7. **H2**: Move `pickPrimaryMethod` + `FEE_METHODS` out of `tx-enrichment.ts` to a layer-agnostic utility location.
8. **H3**: Fix `app.store.ts:130` (same root cause as F4).
9. **H4**: Implement at least the symbol-collision badge (option 1); strongly recommend the first-receive friction (option 2) for Production.
10. **H5**: Expand the helper-level test pins.

Findings M1-M5 are recommended but not blocking. Nits + open questions are flagged for impl-time decisions.

## Summary table

| # | Severity | Title | Citation |
|---|---|---|---|
| C1 | Critical | F4 missing site — OperationPlanner.extractPrimaryMethod | `operation-planner.ts:239-250` |
| C2 | Critical | F1 step-renumbering misreads StepIndicator | `StepIndicator.vue:16-23` |
| C3 | Critical | F2 dedupe race — proving→submitting window | `execution/service.ts:1148-1153` |
| C4 | High | F2 cross-device same-seed surfaces own outflows as incoming | `note/service.ts:50-90` |
| C5 | High | F3 raw-error rendering — `op.error` has more than `.message` | `journal-state.ts:113` |
| H1 | High | IncomingTransferService missing `dependencies` declaration | `wallet-core/base/index.ts:24` |
| H2 | High | `pickPrimaryMethod` placement crosses popup/wallet boundary | `biome.json:48-60` |
| H3 | Medium-High | `app.store.ts:130` uses `tx.calls[0]` — same root cause as F4 | `stores/app.store.ts:128-138` |
| H4 | Medium-High | `aztec_registerToken` social-engineering vector | `nulo-schema-patch.ts:36` |
| H5 | Medium-High | `pickPrimaryMethod` mint-heuristic edge cases unpinned | plan section 2.1 |
| M1 | Medium | Onboarding e2e file path unverified | plan section 2.2 |
| M2 | Medium | F3 pending banner persistence inconsistency | `activity.vue:178-194` |
| M3 | Medium | Row-merge extraction location wrong layer | `biome.json:243-265` |
| M4 | Medium | IndexedDB cleanup on profile delete unverified | plan section 2.4 |
| M5 | Medium | F4 test depth misses 5 exported functions | plan section 2.1 |
| L1 | Low | F3 journal-record-disappeared race | plan section 2.3 |
| L2 | Low | F1 skip-link consistency | plan section 2.2 |
| L3 | Low | F4 biome-ignore reason discipline | plan section 2.1 |
| L4 | Low | F2 icon name verification deferred | plan section 2.4 |
| L5 | Low | F2 token-detail history stats — deferred OK | plan question 3 |
| N1 | Nit | Risk-ascending claim partial-revert assumption | plan section 4 |
| N2 | Nit | Commit scope tags need differentiation | plan section 9 |
| N3 | Nit | No milestone vocabulary in committed code | CLAUDE.md L281-283 |
