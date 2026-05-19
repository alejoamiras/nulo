# Plan-agent audit — Pre-A11 UX cleanup

Date: 2026-04-27
Verdict: **Ship after track-by-track refactor.** Multiple BLOCKING factual errors; Track A's "keep window open" reverses the user's stated preference; A11 collision unaddressed.

## BLOCKING

1. **Track A "keep window open" reverses the user's preference.** User wants the window gone faster, not held open. Decision item 1 at `plan-v1.md:262` already lists both readings — promote close-fast + journal-write to the hard plan choice.

2. **Plan factually wrong: dApp txs DO appear in the in-popup activity stream today** (via TaskService — `RecentActivityView.vue:168-188` matches `ContentKind.ExecuteOperation` + `OriginType.DAPP`). What's actually missing is the *durable* journal record (SW-restart-survival). The `dapp_execute` kind is already declared at `operation-journal/spec.ts:19` — Track A point 4 should be "wire `dapp_execute` write into `executeSendTransaction` + `executeAztecSendTx`."

3. **Track B-(a) premise partly wrong**: `executionService.getGasBalances` is already cached 5 min with single-flight dedup (`execution/service.ts:163-170, 907-933`) and invalidated on tx-settlement events (`service.ts:218-226`). The dropdown spinner cause is the `Promise.all` joined under a single `isLoading` ref (`FeeSettingsCard.vue:290-294`) + the `chrome.storage.local.get(FEE_METHOD_LS_KEY)` read at `:299`, not uncached round-trips. The `onGasBalanceUpdated` event in plan-v1.md:105 doesn't exist — only `transactionService.onTransactionUpdated`.

4. **A11 collision unaddressed.** `IdentityStrip` and `DappIdentityBlock` are scheduled extractions at A11.2 / A11.8 (`A11/plan.md:115-127, 313-327`). The proposed `TransactionStatusHeader` lives in the same template region (`execute/index.vue:410-454`). Plan-v1 line 6 promises non-conflict but doesn't name the targets. Choose: (a) land Track A header BEFORE A11 so A11.2 absorbs it, OR (b) defer Track A's dApp-window UI changes to post-A11.7, restricting Track A to script-only state-machine wiring.

5. **Track C threat-model claim is wrong.** Contacts and PXE sender list are distinct trust surfaces. Importing 100 contacts silently registers all 100 as senders on every network the user later switches to. Senders persist forever (no auto-cascade — `account-state/service.ts:78-89` has `deleteSender` but no auto-removal). Conservative default: don't auto-register without consent. Fix: NewContactPopup gains a checkbox "Also register as private-transfer sender on {network.name}" (default checked); Import defaults OFF; drop network-switch backfill entirely.

6. **Track B-c — 30s freshness window is the wrong design.** Validate against `feePayer/gasSettings/globalVariables` proof inputs primary, not a TTL. User can fiddle in form for 45s. Also: `buildAndEstimateTxRequest` mutates `op.actions` post-strategy (`execution/service.ts:1449` clone comment); `precomputedEstimate` must cache *post-strategy* mutated actions, not the input op.

7. **Track D type-detection rebuild is hand-wavy.** Plan-v1.md:221 hand-waves "decode the note via the known ABI." The previous upstream implementation almost certainly read `note.note.items` against the contract's *Note struct ABI* from the artifact, not the function ABI. Verify whether `pxeService.getContractArtifact` returns note-struct schema, OR whether we need a separate registry. Without that, sizing is a guess.

## SHOULD-FIX

1. **`TransactionStatusHeader` is too small.** Three props is fine but the actual differences between the two pages are the FOOTER (Confirm/Reject vs. one Confirm), the body, and the post-submit flow. Either widen Track A to also unify confirm-button copy (`"EXECUTING"` → `"PROVING"`, `"CONFIRMING"` → `"PROVING"`) or narrow the promise to "consistent header copy through lifecycle" and drop the "make them similar" framing.

2. **Track B-d (non-blocking confirm) should ship with B-c, not deferred.** B-c saves 1–3s only when estimate is fresh; without B-d, the gain only triggers when user idles long enough. Coupling them is the whole point of "estimating is non-blocker for confirming."

3. **Track C-(2) backfill ordering.** Plan says trigger in `onActiveNetworkChanged` — fires on every switch. With 100 contacts on single-threaded PXE, network-switch becomes a 30s freeze. Either gate to "first switch this session" via `chrome.storage.local` flag, run as low-priority background queue, or drop entirely.

4. **`EditContactPopup` "don't deregister old"** + Track C-(2) backfill = changed addresses leave permanent ghost senders. Propose: when address changes, prompt user "Old sender registration kept on the network. Remove it?" (default keep, visible).

5. **Default fee method (auto-selected sponsored FPC) populates synchronously** at plan-v1.md:107 requires FPC list cached. Today `fpcService.getFpcs()` hits once on mount. Add: cache FPC results at app mount with `onFpcAdded/Deleted` invalidation.

6. **Track A operation-journal parity for non-active accounts.** When `executeSendTransaction` writes a `dapp_execute` journal record, `RecentActivityView` filters by `accountAddress` (`:113-120`). dApp ops to a non-active account would be invisible. Multi-account dApp case (`signerAccounts` at `execute/index.vue:322-333`) needs handling.

## NITS

- Lifecycle table at plan-v1.md:35-44 lists `signing` but the operation is "proving + submitting." Rename or note simplification.
- `TransactionAwaitingCard` IS already used by both `executingTask` and `inFlightJournalOps` paths (`RecentActivityView.vue:262-305`). Plan can drop the "I haven't read it" risk; just verify dApp `journalTitle` derivation handles `kind: "dapp_execute"` (line 131-136 falls through to `op.title`).
- Track A name "lifecycle UI unify" is misleading when only the header is shared. Rename to "shared transaction-status header."

## RISKS NOT FLAGGED

1. **`buildAndEstimateTxRequest` actions-array mutation contract.** `execution/service.ts:1445-1471` clones actions before strategy delegation; each strategy mutates *its* clone. Track B-c must cache post-strategy actions, not input op. Otherwise drops fee-prepend silently.

2. **A11.3 `useFeeEstimation` composable** is in flight on a separate branch and touches the same `estimatingOps`/`feeEstimates`/`estimateTimers` triplet. Pin order: A11.3 first, OR block A11.3 until pre-A11 ships.

3. **Sender registration not synchronous on cold offscreen.** Adding 100 sequential senders during ImportContactsPopup on cold offscreen is several-second freeze. Need "popup stays interactive, registration runs in background" UX.

4. **Track B-c — "Estimating fee…" UX label is owned by `TaskService` subtask labels** (`RecentActivityView.vue:85-88`). If `executeSendTransaction` skips buildAndEstimate, subtask sequence shrinks. UI loses 2-3 progress phases. Document.

5. **Multi-operation approval window.** Per-operation phase is the only honest model. Either restrict Track A to single-op or design per-op phase array.

6. **Track D parser type-detection** doesn't consider that `note.note.items` is a Field array — different note structs have different lengths. Need slot-aware decoding (a token has `Balance`, `Nonce`, `PartialNote` at different slots).

## TEST GAPS

1. Track A — e2e for "tx submitted, window closes after journal write." `connect-dapp.test.ts` is currently skipped per `A11/plan.md:38`.
2. Track B-(a) — unit test: dropdown opens without `getGasBalances` call when cache is fresh.
3. Track B-(c) — integration: estimate, hold 30s, click Confirm, assert `buildAndEstimateTxRequest` NOT called twice. Adversarial: estimate, change recipient, click Confirm fast, assert re-estimation IS triggered.
4. Track C-(1) — `addContact` failure doesn't break `addSender` (and vice versa).
5. Track C-(2) — backfill idempotent across consecutive `onActiveNetworkChanged`.
6. Track D — pin a known token's note-decode result.
7. Cross-cutting — fee-methods.test.ts is flaky-but-passing per `M4/DECISIONS.md:312`. Track B touches the fee path; run fee-methods e2e in green-state once before merge.

## SEQUENCING / SIZING

Realistic sizing — **8–12 days** (not 6–9):

| # | Track | Revised size | Why |
|---|---|---|---|
| 1 | D — diagnose | 0.5d | Unchanged. |
| 2 | D — fix (2b) | 1.5–3d | Slot disambiguation + per-token-standard testing. |
| 3 | C — auto-register on add | 1d | Drop network-switch backfill. |
| 4 | C — discovery hints | 0.5d | Trivial. |
| 5 | B-(a) + (b) — pre-warm + single-spinner | 1d | Smaller because most caching exists. |
| 6 | B-(c) — proof-input estimate reuse | 2.5d | Strategy-mutation handling. |
| 7 | B-(d) — non-blocking confirm | 1d | Should ship with B-(c). |
| 8 | A — shared header + journal entry | 2d | Drops close-deferral; net work is half. |

**Reorder**: B-(a/b) FIRST (lowest risk, isolates fee-card mount latency for the rest of the audit), then D, then C, then B-c+d, then A.

## REWRITE SUGGESTIONS

**Track A — simplified:**
- Drop close-deferral entirely.
- Add `dapp_execute` journal write inside `executeSendTransaction` + `executeAztecSendTx`.
- Ship in-flight subtitle change for the brief moment before window closes — small, defensible, no A11 collision.
- Move `TransactionStatusHeader.vue` extraction to AFTER A11; pre-A11 ships only data wiring.

**Track C — opt-in:**
- NewContactPopup gains checkbox (default checked).
- EditContactPopup shows registration status inline + explicit Register / Remove CTA.
- ImportContactsPopup: opt-in checkbox at import time, defaulted OFF.
- Drop network-switch backfill entirely.

**Track B — single PR, four sub-steps:**
1. Remove `isLoading`-driven dropdown spinner; render synchronously off cached state.
2. Single-spinner UX.
3. Cache *post-strategy* tx request from estimate; validate with proof-input check at confirm time.
4. Allow Confirm during estimate.

## CONFIRMATIONS

- Track D analysis at plan-v1.md:194-211 is correct. Keep verbatim.
- Track C `addSender`/`getSenders` API at `account-state/service.ts:64-89` is correctly identified.
- Track B identification of `runInit()` at `FeeSettingsCard.vue:285-323` is accurate.
- "TaskService for ephemeral, journal for durable" framing per `architecture/plan/03-final-plan-v3.md:97-105` is the right abstraction.
- `OperationKind = "transfer" | "dapp_execute"` already declared — Track A can write entries without schema migration.
- "Ship before A11" framing at plan-v1.md:6 is correct because A11.2 onwards rewrites template islands.
- Decision item 4 at plan-v1.md:267 ("zero rows or raw rows?") is the right diagnostic.
- Track C-(5) "keep page at Settings → Advanced" is right — don't merge contacts and senders surfaces.
