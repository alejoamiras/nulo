# Pre-A11 UX cleanup arc — plan v2

Date: 2026-04-27
Supersedes: `plan-v1.md` (kept for diff context)
Audits: `audit-codex.md`, `audit-agent.md`
Approval status: pending user review

---

## Why v2 exists (consolidated audit findings)

Both audits independently flagged the same load-bearing errors in v1. Plan-v2 corrects them:

1. **Track A misframed the unification target.** `pages/send.vue:235-278` fire-and-forgets `executeTransfer()` and immediately navigates back; it cannot host a phaseful header. The shared lifecycle UI lives in `RecentActivityView` (the durable awaiting card), not in Send/Execute pages. v2 retargets accordingly.
2. **Track A "keep window open" reverses the user's preference.** v2 closes the execute window as today and writes a `dapp_execute` journal record so `RecentActivityView` surfaces dApp txs across SW restart.
3. **Track A v1 also assumed execute window can observe `submitted`/`failed`.** It can't: `dapp-interaction/service.ts:82-87` deletes the interaction record on approval. Adding that observability is a large effort and is **deferred to post-A11** (A11.2 will already restructure the popup mount points).
4. **Track A's `TransactionStatusHeader.vue` would collide with A11.2 `IdentityStrip` + A11.8 `DappIdentityBlock` extractions.** v2 ships only data wiring; visual extraction lands inside A11.
5. **Track B-1 relied on a non-existent event (`onGasBalanceUpdated`).** Existing cache is already 5-min single-flight invalidated on `onTransactionUpdated`; v2's job is to remove the `isLoading`-driven spinner and render synchronously off the existing cache, plus add `onFpcAdded/Deleted/Updated` invalidation.
6. **Track B-2's "30s + same params" reuse is unsafe.** `buildAndEstimateTxRequest()` is impure: `finalizeGasLimits()` reads `node.getCurrentMinFees()`; FpcStrategy recomputes from live base fees. v2 reuses only within the same in-memory submit path, validates against captured fee/base-fee snapshot, and caches the *post-strategy* tx request (not just the input op).
7. **Track C "threat model unchanged" is materially wrong.** Sender registration broadens what dApps with `aztec_getPrivateEvents` can read (`dapp-interaction/service.ts:290`, `execution/service.ts:1059`). v2 ships **opt-in** with an explicit checkbox — default-checked on `NewContactPopup`, default-OFF on `ImportContactsPopup`, no network-switch backfill.
8. **Track D's parser restoration is medium not light.** Git history shows the richer `parseNote` was removed wholesale during the upstream Schnorr migration. v2 sizes 1.5–3d and details slot-disambiguation for tokens with multiple Note types (`Balance`, `Nonce`, `PartialNote`).

---

## Plan-v2 tracks

### Track B — Fee estimation (now first; lowest risk, isolates noise)

#### Sub-track B-1: synchronous fee dropdown

- Remove `isLoading`-driven spinner on the fee-method trigger in `FeeSettingsCard.vue:450`. Render synchronously off:
  - Existing background-owned 5-min gas cache (`execution/service.ts:163-170, 907-933`) — no plumbing change needed; just stop blocking the dropdown on its hydration.
  - Existing FPC list — add `onFpcAdded`/`onFpcDeleted`/`onFpcUpdated` event subscriptions in `FpcService` (events already exist in spec) and a popup-side cache that listens.
  - Saved fee-method preference from `chrome.storage.local[FEE_METHOD_LS_KEY]` (`FeeSettingsCard.vue:299`) — read synchronously at mount; auto-pick sponsored FPC on cache-cold.
- The first popup mount of a fresh session still pays the cache-warm cost, but the dropdown trigger renders the saved-or-default method immediately; spinner appears only on the *amount*, not the dropdown.
- **Audit-correction**: cache stays popup-side for the popup-internal flow. The execute window is a separate document — that window pays its own warm cost. Cross-window sharing is out of scope.

#### Sub-track B-2: estimate reuse on confirm

- `executeSendTransaction()` and `executeAztecSendTx()` accept an optional `precomputedTxRequest?: TxRequest` parameter (post-strategy mutated, not the input op).
- The popup, after a successful estimate, holds the `TxRequest` returned by `buildAndEstimateTxRequest()` plus a snapshot of the validation context: `{ baseFee, gasSettings, feeMethod, priority, opActionsHash }`.
- On Confirm:
  - Re-fetch `node.getCurrentMinFees()` (cheap, single round-trip) and compare against the captured baseFee.
  - Verify `feeMethod`/`priority`/`opActions` unchanged.
  - If all match → submit the precomputed `TxRequest` directly (skip the second `buildAndEstimateTxRequest()`).
  - If any diverged → fall back to the current path (rebuild + estimate fresh).
- **Audit-correction**: this is NOT a TTL-based cross-popup cache. It's a single-popup-session reuse with semantic validation.

#### Sub-track B-3: non-blocking confirm

- Bundle with B-2 (audit-flag: deferring B-3 makes B-2's gain only trigger when user idles long enough for estimate to finish before clicking Confirm).
- Allow Confirm while `isEstimating` is true. The Confirm path will:
  - Wait for the in-flight estimate to resolve (or trigger fresh if missing).
  - Then validate context and submit.
- UI: button label flips `Confirm` → `Estimating fee…` → `Proving…` → `Submitting…` based on phase.
- Hard-stop: button stays disabled if a fee error is showing.

**Sizing**: B-1 (1d), B-2 + B-3 (3.5d).

**Test plan additions**:
- Unit: cache invalidation on `onTransactionUpdated`, `onFpcAdded`, `onFpcDeleted`. Two `FeeSettingsCard` instances in one document don't double-fetch.
- Integration: estimate → hold 30s → Confirm — `buildAndEstimateTxRequest` NOT called twice. Adversarial: estimate → change recipient → Confirm fast — re-estimation IS triggered.
- E2e: green-state run of `network/fee-methods.test.ts` once before merge (flaky-but-passing per `M4/DECISIONS.md`).

---

### Track D — Notes parser restoration

#### Step 1 — User confirmation (0.5d)

Ask user: "When you open Notes, do you see (a) zero rows / 'NO NOTES YET' OR (b) cards with 'Custom Note' header and unlabeled hex strings as content?"

- (a) zero-rows = different bug, not this one. Investigate via console-log instrumentation.
- (b) raw-fallback = confirms the parser-removal hypothesis; ship Step 2.

#### Step 2 — Restore type-aware decoding (1.5–3d)

Re-implement `parseNote` (`note/service.ts:63-70`) to populate `type`, `location`, `content`. Approach:

1. **Per-contract artifact lookup**: at parse time, fetch `pxeService.getContractArtifact(note.contractAddress)`.
2. **Note-struct schema discovery**: artifacts expose `notes` metadata (per `@aztec/noir-contracts.js` patterns). For each known note struct (`Balance`, `Nonce`, `PartialNote`, etc.), match by storage-slot and item-array length.
3. **Slot-aware decoding**: token contracts have multiple Note types at different slots. Maintain a `(contract, slot) → struct` registry derived from artifact metadata. Disambiguate before decoding.
4. **Type label**: derive `type` (e.g. "Token Balance") from the matched struct name.
5. **Content fields**: decode `note.note.items` according to the struct's field types into a `Record<string, string>`.
6. **Fallback**: when no struct matches, leave `type`/`content` undefined; raw rendering kicks in as today.

**Audit-correction**: this is medium effort, NOT lightweight. The parser is being rebuilt, not patched.

**Risks**:
- Artifact may not expose note-struct metadata in all cases. Need a fallback registry for the most common token contracts.
- Future Aztec stdlib changes can shift struct shapes; pin known-good test vectors per token.

**Sizing**: 1.5–3d depending on whether artifact metadata covers the common cases (1.5d) or we need a hand-maintained registry (3d).

**Test plan additions**:
- Unit: pin a known token's note-decode result against a golden vector.
- Page test: raw fallback when contract metadata is unavailable (no regression vs today).

---

### Track C — Sender registration ↔ contacts (opt-in)

#### Plan (consolidated)

**(1) NewContactPopup**: add a checkbox "Also register as private-transfer sender" (default **checked**). Tooltip: "Required to receive private tokens from this address." On submit:
- `addContact()` always runs.
- If checkbox checked: `addSender(activeNetworkId, address)` runs after, non-fatal failure (toast: "Contact saved · sender registration failed; retry from Senders").

**(2) EditContactPopup**: show registration status inline. Read once on popup-mount from a popup-scoped sender-cache (single `getSenders(networkId)` call, cached for the popup session). Three states:
- "Registered as sender on {network.name}" + checkmark — read-only.
- "Not registered" + "Register now" CTA.
- (loading) skeleton.
- On address change: prompt "Old sender registration kept on the network. Remove it?" (default keep, visible).

**(3) ImportContactsPopup**: add a checkbox "Also register imported contacts as senders" (default **OFF**). Audit rationale: bulk import is the highest-leak case. If checked:
- Run sender registrations **serially** (concurrency 1 — PXE is effectively single-threaded per `FeeSettingsCard.vue:253` doc note).
- Run as a background batch with progress; popup remains interactive.

**(4) Token detail page hint** (audit-correction: scope tightly):
- Show a one-line banner ONLY when private balance is 0 AND token is non-trivial (has been added by user, not a system token):
  - "Expected a private transfer that didn't arrive? Make sure the sender is registered → Settings."
- Three-dot menu: add "Manage senders" link to `/popup/settings/advanced/account-state/senders`.
- Banner is dismissable per (token, account); state in `chrome.storage.local`.

**(5) No backfill on network switch.** Drop entirely. If the user wants their existing contacts auto-registered on a new network, they can re-edit individually or import-with-checkbox. Reason: bulk auto-register on every network switch broadens the privacy surface unilaterally and risks 30s freezes on import-heavy contact books.

#### Threat-model rewrite

Senders ARE a privacy surface beyond contacts:
- A dApp granted `aztec_getPrivateEvents` can observe events filtered by sender (`dapp-interaction/service.ts:290`, `execution/service.ts:1059`).
- A future PXE state migration / export / RPC sync exposes the sender list.

Therefore:
- Auto-registering is a deliberate user action surface — the checkbox is the consent.
- Default-on for individual NewContact (where user is intentionally adding one address).
- Default-off for Import (where the operation is bulk and harder to mentally audit).
- No silent backfill.

#### Sizing & test plan

**Sizing**: 1.5d (no backfill keeps it bounded).

**Test plan additions**:
- Unit: `addContact()` failure does NOT skip `addSender()` and vice versa.
- Unit: sender-cache invalidation on `onSenderAdded` / `onSenderDeleted` / network change.
- E2e: NewContact → check default-checked → submit → verify sender appears on Senders page.
- E2e: Import → leave checkbox off → submit → verify NO senders added.
- E2e: EditContact with address change → "Remove old?" prompt appears.

---

### Track A — dApp tx journal continuity (reshaped)

#### What v2 ships

1. **Write `dapp_execute` journal records.** When `executeSendTransaction()` and `executeAztecSendTx()` resolve, write an `OperationJournal` entry with `kind: "dapp_execute"` (already declared at `operation-journal/spec.ts:19` — no schema migration). Include: dApp hostname, originating account, op summary, txHash on submit.
2. **`RecentActivityView` already accommodates dApp tasks.** It filters by account at `:113-120`; verify multi-account dApp ops (`signerAccounts` in `execute/index.vue:322-333`) write the journal entry under the *signing* account.
3. **In-window subtitle change for the brief pre-close moment.** Today the user clicks Confirm and the button shows "EXECUTING" until the window closes (~200-500ms typical). Add subtitle text under the dApp title that progresses through `proving → submitting → submitted` for the moment the window stays open. After submission the window closes as today.
4. **Drop `TransactionStatusHeader.vue` extraction** from this track. A11.2 (`IdentityStrip`) and A11.8 (`DappIdentityBlock`) will absorb the visual extraction. v2 ships only the data wiring: the new `phase` ref + journal write.
5. **Multi-op approval scope**: v2 supports the single-op happy path. Multi-op gets a degraded experience (single window-level subtitle reflects the *current* op being processed; failed/skipped ops display in the activity view post-close). Per-op post-confirm status rows are deferred to post-A11.

#### What v2 explicitly does NOT do (deferred)

- Hold execute window open through proving/submission. **Reason**: needs a new correlation surface — `approveInteraction()` deletes the interaction record + detaches the window. Adding progress observability is a multi-day refactor. Defer to a post-A11 follow-up.
- Per-operation post-confirm status rows in the execute window.
- Token-page parity for dApp activity (audit-flagged: token-scoped views intentionally suppress dApp tasks per `RecentActivityView.vue:176`).

#### Sizing

**2d.** Most work is the journal-write integration and verifying the activity-view rendering for `kind: "dapp_execute"` entries.

#### Test plan additions

- Unit: `executeSendTransaction` writes a journal entry with the right account on success.
- Unit: failure path writes a `failed` journal entry (so post-close activity reflects the failure).
- E2e: dApp approval success → window closes → activity view shows dApp tx with journal-driven subtitle.
- E2e: dApp approval rejection (existing) — verify journal remains unchanged.

---

## Sequencing (revised per audit)

| # | Track | Why this order | Size |
|---|---|---|---|
| 1 | **B-1 (sync dropdown)** | Lowest risk, isolates fee-card noise, prerequisite to clean QA on later tracks | 1d |
| 2 | **D (notes parser)** | Asks user a 1-line question first; can park if "(a) zero rows" comes back | 2-3.5d |
| 3 | **C (sender opt-in)** | Self-contained, additive, drops backfill so bounded | 1.5d |
| 4 | **B-2 + B-3 (estimate reuse + non-blocking confirm)** | Pipeline change; bundled per audit | 3.5d |
| 5 | **A (dApp journal write + subtitle)** | Builds on top of cleaner fee/B work; lowest user-visible churn | 2d |

**Total: ~10-12 days** focused work.

---

## Verification per PR

- `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:e2e` smoke.
- Track B-2 + Track A: full network e2e (fee-methods + dapp approval) for tx-pipeline regression coverage.
- Track D: golden-vector unit tests for note parser.
- Track C: e2e for the checkbox flows.
- Manual QA on Chrome unpacked at every PR.

---

## Out of scope / explicit non-goals

- A11 Vue decomposition (own arc). Track A's `TransactionStatusHeader.vue` extraction lands inside A11.2.
- Hold-execute-window-open UX (Track A "deferred" item).
- Per-op post-confirm status rows in execute window.
- Network-switch backfill of contact senders.
- Cross-window fee-source cache (popup ↔ execute window separate documents).
- Token-page parity for dApp activity.
- Page-promotion of remaining popups (Receive, etc.).
- Replacing Puppeteer with Playwright (M5.4).

---

## Decisions to confirm with user before implementation

1. **Track D first question**: when you open Notes, do you see (a) zero rows OR (b) cards with "Custom Note" + raw hex content? — needed to size Step 2.
2. **Track C-(4) banner copy**: the proposed banner text. User can rewrite.
3. **Track A scope**: confirm OK to defer `TransactionStatusHeader.vue` extraction to A11.2 and ship only data wiring + subtitle in this arc.
4. **Track B-1 fallback for cold cache**: when a profile is freshly unlocked and the gas cache is empty, the dropdown still has to wait once for hydration. Show a subtle one-line skeleton over the Send page (not over the dropdown trigger), or tolerate a one-time spinner on first popup mount of a session?

---

## Risk register (v2)

1. `buildAndEstimateTxRequest` actions-array mutation: B-2 must cache post-strategy actions, not input op.
2. A11.3 `useFeeEstimation` composable on a separate branch touches the same state. **Pin order: this arc lands before A11.3 begins** (A11.3 hasn't started per memory).
3. Sender registration on cold offscreen: import bulk run is multi-second. UX must keep popup interactive (background batch).
4. Notes parser regression risk: future Aztec stdlib changes can break decoding. Pin golden vectors per known token.
5. Track A multi-op degraded UX: if user reports it as a problem, fast-follow PR adds per-op status rows.
6. Track B-2 race: if user clicks Confirm DURING an in-flight estimate, the validation logic must serialize correctly. Test adversarial path.
7. Cross-window cache divergence: popup gas cache and execute window gas cache are independent. Acceptable today (each is per-document); flag if telemetry shows contention.
