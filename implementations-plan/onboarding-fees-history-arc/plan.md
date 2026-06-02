# Onboarding + Fees + History arc — plan v2

Date: 2026-06-02 (revised post-audit)
Supersedes: plan v1 (same path; rewritten in place).
Audit trail: [`audit-codex.md`](./audit-codex.md) (v1 verdict: Reject), [`audit-opus.md`](./audit-opus.md) (v1 verdict: Approve-with-changes), [`audit-codex-followup-v2.md`](./audit-codex-followup-v2.md) (v2 verdict: Approve-with-changes — concerns folded into v2.1 inline below).
Branch: `feat/onboarding-fees-history-arc` (off `dev`, squash-merged back as one PR with multiple commits)
Quality calibration: **Production** (full unit + component coverage, smoke e2e where user flows touch new UI, network e2e for the incoming-history happy path, polished onboarding copy)
Scope discipline: ONE PR, 4 phase commits. Phases are risk-ascending so a partial revert is still safe.

## 0. Audit triage

Both audits ran in parallel against plan v1. Codex returned **Reject** with 3 criticals + 4 highs; opus returned **Approve-with-changes** with 3 criticals + 5 highs. Verifying each citation against the actual code surfaced no false claims — every cited fact held up. v2 below adopts all 3 of codex's criticals + opus's overlapping criticals + all but two of the highs. Rejection rationale documented inline below.

### Adopted

| # | Source | Finding | Citation | v2 change |
|---|---|---|---|---|
| A1 | **codex C1**, opus C1 | F4 missed 6th site — `OperationPlanner.extractPrimaryMethod` | `operation-planner.ts:239–250` → `service.ts:894` → `RecentActivityView.vue:128–140` | Phase 1 now routes the planner through the shared helper too; planner-level test pin added. |
| A2 | **codex C2**, opus C2 | F1 step renumbering is fiction | `StepIndicator.vue:16` (`current: 1 \| 2 \| 3 \| 4`) — 4 hardcoded cells `[Setup/Aztec/Speed/Done]`, welcome has no indicator | Phase 2 redesigned: expand indicator to **5 cells** `[Setup/Aztec/Fees/Speed/Done]`. Only `accelerator.vue` (3→4) and `done.vue` (4→5) get bumped. Welcome/create/import/learn unchanged. |
| A3 | **codex C3**, opus C3 (different framing) | F2 dedupe race + discovery gap | `token-balance/service.ts:70`, `balance-job-queue.ts:62` (ticker drains queue but doesn't poll); `journal-state.ts:113` | Phase 4 redesigned: don't piggy-back on `TokenBalanceService`'s queue. Add explicit discovery trigger (NoteService watch loop); keep journal `progress.txHash` dedupe + add in-memory recent-tx-hash ring buffer; scan on every watch-loop poll tick (not gated on balance-increase). |
| A4 | **codex C2** (note model) | Plan's incoming-note key model uses APIs that don't exist | PXE has no `getTxReceipt`; raw `NoteDao` carries `siloedNullifier`/`noteHash`/`l2BlockNumber`/`txIndexInBlock`/`noteIndexInTx`; `NoteService` strips them | Phase 4 redesigned: extend `NoteService` with a raw-note method exposing those fields; key the new repo by `siloedNullifier`; order by `(l2BlockNumber, txIndexInBlock, noteIndexInTx)` tuple. |
| A5 | **opus C4** (high) | Cross-device same-seed surfaces own outflows as incoming | `note/service.ts:50–90` | Phase 4: add settings toggle "Show incoming transfers" (default on); doc the limitation in the journal-state neighbour comment. |
| A6 | **opus C5**, codex M3 | F3 raw-error rendering needs `op.error.kind` only by default; gate `message` AND `normalizedRaw` | `journal-state.ts:113`; `@nulo/wallet-core/jobs` carries `normalizedRaw` per codex | Phase 3 revised: default to `kind` + friendly subtitle from `journalTerminalDisplay`; gate `message` AND `normalizedRaw` behind `developerMode \|\| debugMode`. Subtitle URL-sanitization test pin. |
| A7 | **opus H1** | `IncomingTransferService` missing `dependencies` declaration | wallet-core base pattern | Phase 4: declare `dependencies = [TOKEN_BALANCE_SERVICE_NAME, NOTE_SERVICE_NAME, TRANSACTION_SERVICE_NAME, OPERATION_JOURNAL_SERVICE_NAME]`. |
| A8 | **opus H2** | `pickPrimaryMethod` placement in `tx-enrichment.ts` crosses popup→wallet boundary | `tx-enrichment.ts` is popup-flavored; wallet-side sites import "up" | Phase 1: helper + `FEE_METHODS` move to **new file** `packages/extension/src/utils/primary-method.ts`. `tx-enrichment.ts` re-exports for backward compat. |
| A9 | **opus H3** | `app.store.ts:130` uses `tx.calls[0]` for awaiting-tx destination — same root cause as F4 | `stores/app.store.ts:128–138` | Phase 1: 7th site — route through shared helper. Test pin in `app.store.test.ts` for the dApp+FPC case. |
| A10 | **opus H4** | "Known tokens only" is UX trust, not anti-pollution; symbol-collision/first-receive friction needed | `nulo-schema-patch.ts:36`; `dapp-interaction/service.ts:425` | Phase 4: implement **first-receive friction** — first note from a contract (per profile, per network) requires user confirmation popup; subsequent receives auto-display. Symbol-collision badge as a follow-up. |
| A11 | **opus H5** | `pickPrimaryMethod` mint heuristic edge cases unpinned | plan v1 §2.1 | Phase 1: explicit test pins for empty input / all-fee-only / 1-call / 2nd-is-mint / 2nd-is-`mint` / 2nd-is-transfer. Pin the all-fee-only fallback as `(BUG PIN)` per the CLAUDE.md convention. |
| A12 | **codex H** route paths | Existing convention is `tokens/[id].vue`; new journal page should follow `pages/journal/[id].vue` | `pages/tokens/[id].vue` exists; v1 plan said `popup/journal/[id].vue` | Phase 3: corrected route path; Phase 4: corrected token-detail page path. |
| A13 | **codex M** scan trigger | "Scan only when private balance increases" misses receives netted against spends | `token-balance/service.ts` refresh shape | Phase 4: scan on every NoteService watch-loop poll tick. Dedupe at the note-record level via `siloedNullifier`. |
| A14 | **codex M** cleanup | Cleanup is underplanned — follow chain-purge AND profile-delete patterns | `pxe/spec.ts:50` (`clearChainState`) | Phase 4: `IncomingTransferRepository` wires into BOTH profile-delete and chain-purge. Tests pin both. |
| A15 | **opus M2** | Pending-tx banner inconsistency across detail-page vs activity-page surfaces | `activity.vue:178–194` | Phase 3: cut the banner. Reuse the existing pending status icon + "Pending settlement" subtitle on the fee row. Cleaner across surfaces. |
| A16 | **opus M3** | Row-merge helper placement (`popup/pages/`) is wrong layer | `biome.json:243–265` (L4 cannot import L6) | Phase 4: row-merge helper at `packages/extension/src/utils/activity-rows.ts` (L0). |
| A17 | **opus M5** | Test depth — the rest of `tx-enrichment.ts` is also untested | plan v1 §2.1 | Phase 1: extend test sweep to cover `humanizeMethodName`, `getMethodLabel`, `formatTransferType`, `formatCallSummary`, `getOriginLabel`, `getCallCountLabel`. |
| A18 | **opus M1** | Onboarding e2e file path is "whichever" — unverified | plan v1 §2.2 | Phase 2: confirm exact e2e file path **before commit lands**. Plan now flags this as a pre-commit gate, not impl-time discovery. |
| A19 | **opus M4** | IndexedDB cleanup on profile delete — confirm exact hook | plan v1 §2.4 | Phase 4 plan now names the exact lifecycle hooks to mirror (chain-purge: `clearChainState(profileId, chainId)`; profile-delete: TBD per ProfileService API; verify pre-commit). |
| A20 | **opus L1** | Journal-record-disappeared race on detail page | new `journal/[id].vue` | Phase 3: subscribe to `onOperationDeleted`; redirect to `/popup/activity` with a one-shot toast. |
| A21 | **opus L4** | Icon name verification deferred | plan v1 §2.4 | Phase 4: confirm `arrow-narrow-down-left` exists in `icons.json` **before commit lands**. |
| A22 | **codex N3** (and CLAUDE.md L281) | No milestone/phase tags in committed code | CLAUDE.md L281–283 | Implementation guard: every commit's diff scanned for `F\d`/`Phase \d`/`v\d` tags before push. |
| A23 | **codex v2-followup H** | Trust-state model under-specified for bursty first receives | plan v2 §2.4f | Replace split state (Token boolean + blocked set + hidden records) with ONE persisted enum per `(profileId, networkId, contract)`: `IncomingTrustState = unknown \| pending \| trusted \| blocked`. Queue notes while pending; deterministic Allow/Reject transition. Backup/restore + profile-delete pinned. |
| A24 | **codex v2-followup M** | Discovery-trigger language inconsistent across §0 / §2.4a | plan v2 §0 A3, §0 A13, §2.4a | Collapse to one model — the NoteService watch loop. "Scan on every refresh" rewritten as "Scan on every watch-loop poll tick." |
| A25 | **codex v2-followup M** | One poll handle per (account, contract) → SW timer fan-out under many watched tokens | plan v2 §2.4a | Coalesce into ONE singleflight scheduler per `(networkId, accountAddress)`. `watchNotes` takes a `contracts: AztecAddress[]` list; the single poll loop iterates the list once per tick. |
| A26 | **codex v2-followup L** | 60s ring buffer sizing rationale | plan v2 §2.4d | Documented as opportunistic / best-effort. Bounded at 256 entries OR 5-minute window (whichever comes first). Correctness anchored on the other three dedupe sources. |

### Rejected (with reasoning)

| # | Source | Finding | Reason rejected |
|---|---|---|---|
| R1 | opus L2 | F1 skip-link "is fees explainer required-read?" — drop the skip link or keep it consistent | Consistency wins. Keep the skip link on `fees.vue`; both Continue and Skip route to `/onboarding/accelerator` (Skip = "move along, I don't need the explainer"). Documented inline. |
| R2 | codex L (attacker dapp name spoof) | "Hardening the filter with more context than bare method strings" | Out of scope. The capability popup at consent time renders the full payload (`OperationCard.vue:103`); card title is a summary. Defensive measures here would force a wider rewrite of `getPrimaryCall`'s shape contract. Tracked as a follow-up if real abuse surfaces. |
| R3 | opus N1 | "Risk-ascending claim assumes F1–F3 don't add F4-dependent code" | True but trivially enforced — the plan now spells out per-phase exit criteria; F1–F3 don't touch incoming-history surfaces. No code change needed; addressed via §5 ordering audit. |
| R4 | codex H (pollution mitigation rewrite scope) | "Require a stronger trust bit than 'user once approved a dapp token import'" | The first-receive friction (adopted as A10) IS that stronger trust bit at the incoming-surface level. Rewriting the `aztec_registerToken` consent flow would expand scope to wallet-bridge dispatcher changes — out of arc. Tracked as follow-up. |

### Open questions added (codex Q4 + impl-blockers)

- Discovery loop architecture (codex's "hidden 6th open question"): `NoteService` watch loop vs PXE block-sync vs TokenBalance refresh-piggyback. Plan picks the watch-loop default; final decision deferred to F2 impl phase 4a.
- First-receive friction copy + UX placement (popup vs banner vs inline-on-card).
- Settings toggle wording for "Show incoming transfers".
- Per-phase local validation gates (codex Q5) — `bun run audit:vue` per commit, or only HEAD before push?

## 1. Goal + success criteria

Ship 4 user-visible improvements as a single arc:

1. **F4 (commit 1) — fix tx-card name "first vs second call" bug.** Six sites (v1 said five; A1) build a journal-record title from a call-list without filtering wallet-injected fee methods. Unify via shared `pickPrimaryMethod` helper in a layer-agnostic util module (`packages/extension/src/utils/primary-method.ts`; A8). Also fix awaiting-tx destination resolution at `app.store.ts:130` (A9 — 7th site, same root cause). All sites end up agreeing with `getPrimaryCall`'s filter + mint heuristic.
2. **F1 (commit 2) — onboarding fee-juice + private-fee-juice step.** Redesign `StepIndicator.vue` from 4 cells to 5 (`[Setup/Aztec/Fees/Speed/Done]`; A2). Add new page `pages/fees.vue`. Split `learn.vue`'s shared `goNext` into two handlers (`continue → /fees`, `skip → /accelerator`) per codex C3.
3. **F3 (commit 3) — open canceled-tx details + polish pending-tx page.** New route `pages/journal/[id].vue` (A12). Detail page renders `op.error.kind` + the friendly subtitle from `journalTerminalDisplay`; raw `message`/`normalizedRaw` gated behind `developerMode || debugMode` (A6). Subscribe to `onOperationDeleted` (A20). For pending chain tx: drop the banner (A15); reuse pending icon + "Pending settlement" subtitle on the fee row.
4. **F2 (commit 4) — incoming fungible-token receives in history.** New background `IncomingTransferService` + `IncomingTransferRepository` (A7 declares deps). Explicit discovery trigger (A3 — discuss in §2.4 Phase 4; default to `NoteService` watch loop). Extends `NoteService` with a raw-note method (A4 — current `Note` strips load-bearing fields). Repo keyed by `siloedNullifier` (A4); ordered by `(l2BlockNumber, txIndexInBlock, noteIndexInTx)`. Dedupe = siloedNullifier prior records + user's outgoing tx hashes + in-flight journal `progress.txHash` + recent-tx-hash ring buffer (A3). First-receive friction prompt for pollution defense (A10). Settings toggle for cross-device same-seed users (A5). Scans on every refresh, not only on balance-increase (A13). Cleanup hooked into both chain-purge and profile-delete (A14, A19).

**Done means:**

- All 4 phases ✓ on the ASCII checklist in PR description.
- `bun run audit:vue` clean (typecheck → unit + component tests → lint → build).
- `bun run test:e2e` smoke clean.
- `bun run e2e:agent` network clean (incoming-receive happy path + drip-name regression covered).
- Codex post-impl audit complete; high/critical findings addressed; lessons logged.
- PR title is the squash-merge subject; uses Conventional Commits.

## 2. Scope — files and surface per phase

### Phase 1 (commit 1) — F4 tx-card name bug fix + the 7th site

**The 7 sites (verified post-opus + post-codex):**

| # | File:line | Site | What it powers |
|---|---|---|---|
| 1 | `wallet/services/execution/service.ts:131–138` | `primaryActionMethod(actions)` — `executeSendTransaction` at line 1114 | `dapp_execute` journal title (popup-built path) |
| 2 | `wallet/services/execution/service.ts:1193` | `beginDappExecuteJournal` — `calls.find((c) => c?.method)?.method` | same record, same title |
| 3 | `wallet/services/execution/service.ts:1724` | `executeAztecSendTx` — `op.exec?.calls.find((c) => c?.name)?.name` | `dapp_execute` journal title (standard dapp send) |
| 4 | `wallet/services/execution/service.ts:1848` | `executeNoFromSendTx` — same shape as #3 | `dapp_execute` journal title (NO_FROM path) |
| 5 | `wallet/services/wallet-sdk/queued-journal.ts:171–178` | `extractPrimaryMethodFromSendTx(message)` | queued-record visibility |
| 6 | `wallet/services/execution/operation-planner.ts:239–250` | `OperationPlanner.extractPrimaryMethod(operation)` — `service.ts:894` | in-flight TaskService content; `RecentActivityView.vue:128–140` `executingProgressTitle` |
| 7 | `stores/app.store.ts:128–138` | `onTxAdded` — `tx.calls[0]` for awaiting-tx destination | awaiting-tx dedupe (clearing the in-flight placeholder when the chain tx confirms) |

Site #6 is the **biggest visible symptom** — that's the path that fed the faucet drip's "Sponsored unconditionally" while-proving label. Site #7 is the silent regression for dApp+FPC paths (awaiting placeholder doesn't clear after confirm).

**The shared helper — new file** `packages/extension/src/utils/primary-method.ts` (A8):

```ts
/**
 * Wallet-injected fee/entrypoint methods. NOT the user's intent.
 * Mirrored verbatim into tx-enrichment.ts's named re-export.
 */
export const FEE_METHODS: ReadonlySet<string> = new Set([
  "sponsor_unconditionally",
  "fee_entrypoint_private",
  "fee_entrypoint_public",
  "pay_fee",
  "set_authorized",
])

type MethodCarrier = { method?: string; name?: string }

const methodOf = (c: MethodCarrier | undefined): string | undefined =>
  c?.method ?? c?.name

/**
 * Pick the user-facing primary method from a heterogeneous list of
 * "call-like" items (TxCall, Action, encoded_call alias entries, or
 * sendTx wallet-message call entries). Mirrors `getPrimaryCall`'s
 * filter + mint heuristic but works on the looser shape we have at
 * journal-creation time.
 *
 * Returns undefined ONLY when no item carries a method/name string at all.
 * If every named item is a FEE_METHOD, returns the first named item
 * verbatim — preserves pre-existing all-fee-only display behavior.
 */
export function pickPrimaryMethod(
  items: ReadonlyArray<MethodCarrier> | undefined,
): string | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined
  const named = items
    .map(methodOf)
    .filter((m): m is string => typeof m === "string" && m.length > 0)
  if (named.length === 0) return undefined
  const userMethods = named.filter((m) => !FEE_METHODS.has(m))
  if (userMethods.length === 0) return named[0]
  if (userMethods[1]?.startsWith("mint")) return userMethods[1]
  return userMethods[0]
}
```

`tx-enrichment.ts` re-exports `pickPrimaryMethod` + `FEE_METHODS` from the new file for backward compat. The existing `getPrimaryCall` keeps its current TxCall-typed signature but its body becomes a thin wrapper calling `pickPrimaryMethod` (it returns the full TxCall, not just the method string — so the wrapper does a re-find by method name).

**Replace at all 7 sites:**

- `execution/service.ts:131–138`: `primaryActionMethod` deleted; sites that used it call `pickPrimaryMethod(actions)` directly.
- `execution/service.ts:1193`: `pickPrimaryMethod(calls)`.
- `execution/service.ts:1724` and `:1848`: `pickPrimaryMethod(op.exec?.calls)`.
- `queued-journal.ts:171–178`: body becomes `return pickPrimaryMethod(exec.calls)`.
- `operation-planner.ts:239–250`: rewrite as

  ```ts
  public extractPrimaryMethod(operation: Operation): string | undefined {
    if ("actions" in operation) return pickPrimaryMethod(operation.actions)
    if ("exec" in operation && (operation as AztecSendTxOperation).exec?.calls?.length) {
      return pickPrimaryMethod((operation as AztecSendTxOperation).exec.calls)
    }
    return undefined
  }
  ```

  Preserves the same return surface (`string | undefined`).
- `app.store.ts:128–138`: replace `tx.calls[0]` with the result of `getPrimaryCall(tx.calls)` (which uses `pickPrimaryMethod` under the hood). Destination resolution becomes `call?.transfers?.length ? call.transfers[0].to : (call?.args?.[1] as string | undefined) ?? ""` where `call` is the result of `getPrimaryCall`.

**Tests (new files):**

- `packages/extension/src/utils/primary-method.test.ts` — full coverage of `pickPrimaryMethod`:
  - empty input → undefined
  - all-fee-only → `named[0]` (BUG PIN — opus H5)
  - 1 user call → returns it
  - 2 user calls, 2nd `mint_to_private` → returns mint
  - 2 user calls, 2nd `"mint"` → returns mint
  - 2 user calls, 2nd `transfer_in_private` → returns 1st
  - mixed name/method shapes — TxCall vs Action vs sendTx-message
  - drip regression: `[{name:"sponsor_unconditionally"}, {name:"drip_to_private"}]` → `"drip_to_private"`
- `packages/extension/src/utils/tx-enrichment.test.ts` (new) — covers the remaining exports per A17: `humanizeMethodName` (hex truncation, snake_case title case), `getMethodLabel` (METHOD_LABELS lookup), `getPrimaryCall` (delegates to pickPrimaryMethod), `getTxCategory`, `getTxTitle`, `getCallCountLabel`, `getOriginLabel`, `formatTransferType`, `formatCallSummary`.
- `packages/extension/src/wallet/services/execution/operation-planner.test.ts` — planner-level pin for the 6th site (A1): `extractPrimaryMethod({actions: [sponsor, drip]})` → `"drip"`-flavored value.
- `packages/extension/src/stores/app.store.test.ts` — pin for the 7th site (A9): dApp+FPC tx with sponsor call as `tx.calls[0]` clears the awaiting-tx placeholder via the corrected destination resolution.
- Network e2e: `packages/extension/tests/e2e/network/faucet-drip.test.ts` — assert `[data-tx-name]` text on the in-flight card equals the same text on the settled card.

**Risk surface:** 7 line-level changes + 1 new helper file + 1 helper rewrite (planner). Lockfile / boundary-safe — new file is at L0 (`utils/`). Single-purpose; trivial revert.

### Phase 2 (commit 2) — F1 onboarding fee-juice + step-indicator redesign

**Insertion point:** Between `learn.vue` ("Meet Aztec") and `accelerator.vue`. Flow becomes `welcome → create OR import → learn → fees (new) → accelerator → done`.

**`StepIndicator.vue` redesign (A2):**

- Type signature: `defineProps<{ current: 1 | 2 | 3 | 4 | 5 }>()` (was `1 | 2 | 3 | 4`).
- Steps array: `[{num:"01",label:"Setup"}, {num:"02",label:"Aztec"}, {num:"03",label:"Fees"}, {num:"04",label:"Speed"}, {num:"05",label:"Done"}]` (was 4 entries).
- CSS grid: `grid-template-columns: repeat(5, 1fr)` (was `repeat(4, 1fr)`).
- The 24-line comment header at the top of the file gets updated to reflect 5 cells.
- Welcome still has no indicator (unchanged).

**Per-page `:current` updates:**

- `welcome.vue` — unchanged (no indicator).
- `create.vue:166` `<StepIndicator :current="1" />` — unchanged (Setup).
- `import.vue:320` `<StepIndicator :current="1" />` — unchanged (Setup).
- `learn.vue:33` `<StepIndicator :current="2" />` — unchanged (Aztec).
- **`fees.vue` (new) — `<StepIndicator :current="3" />` (Fees).**
- `accelerator.vue:71` `<StepIndicator :current="3" />` → `:current="4"` (Speed).
- `done.vue:72` `<StepIndicator :current="4" />` → `:current="5"` (Done).

**`learn.vue` flow split (codex C3 + Nit):**

Currently `learn.vue:26-28` defines a single `goNext()` used by BOTH "Continue" and "Skip intro". Replace with two handlers:

```ts
function goContinue() {
  router.push("/onboarding/fees")
}
function goSkip() {
  // "Skip intro" intentionally bypasses fee-juice copy AND lands at /accelerator
  // (the accelerator gate still applies — same constraint as v1).
  router.push("/onboarding/accelerator")
}
```

Wire `<Button @click="goContinue">Continue</Button>` and `<button @click="goSkip">Skip intro</button>`.

**`fees.vue` (new file at `packages/extension/src/onboarding/pages/fees.vue`):**

Mirrors `learn.vue` structure 1:1 for visual rhythm. `<OnboardingPage :gap="40">`, `<StepIndicator :current="3" />`, `<BrutalistTitle main="Fees on" sub="Aztec" />`, 3-card brutalist grid, `<Button variant="cta">Continue</Button>` + `Skip intro` link. Both Continue and Skip route to `/onboarding/accelerator` (Skip = "I get it, move along"; consistency rationale documented in R1 above).

**Copy (draft, finalized during impl against Aztec official docs):**

| # | Title | Body |
|---|---|---|
| 01 | Fee juice | Every Aztec transaction pays a fee in fee juice — the network's native asset, like gas on Ethereum. You'll need some before you can send. |
| 02 | Private fee juice | Hold your fee juice in your private balance and the fees you pay stay private too. Your account, your amount, your transaction — only you see them. |
| 03 | Sponsored fees | Apps can pay your fees for you, or accept other tokens as payment. The wallet's fee settings handles all three modes. |

**`StepIndicator.test.ts` updates (existing file may need creating):**

- Render with each `current` value 1..5; assert correct cell active.
- Type-level test: `:current="0"` and `:current="6"` should fail type check (TS strict will catch at consumer sites).

**Tests added:**

- `packages/extension/src/onboarding/pages/fees.test.ts` — mounts, asserts 3 cards, Continue navigates to `/onboarding/accelerator`, Skip navigates to `/onboarding/accelerator`. Snapshot the card titles.
- `packages/extension/src/onboarding/pages/learn.test.ts` — split-handler regression: Continue navigates to `/onboarding/fees`, Skip navigates to `/onboarding/accelerator`. If a learn.test.ts already exists, extend it; else create.
- `packages/extension/src/onboarding/components/StepIndicator.test.ts` — update for 5 cells.
- E2E smoke: extend the existing onboarding click-through. **Pre-commit gate (A18):** confirm exact e2e file path before commit lands (`rg -l "onboarding" packages/extension/tests/e2e/`).

**Risk surface:** Pure UI. No service clients. The indicator-type widening (`1|2|3|4` → `1|2|3|4|5`) is a TS-strict change; if any consumer hardcodes the old union it'll fail at typecheck — that's caught by `bun run typecheck`.

### Phase 3 (commit 3) — F3 open canceled-tx details + polish pending-tx page

**The plan:**

1. **New route + page** at `packages/extension/src/popup/pages/journal/[id].vue` (A12 — was `popup/journal/[id].vue` in v1; corrected to file-routed convention). URL: `/popup/journal/:id`.
2. **Page content:**
   - `<SubPageHeader :title="..." :backTo="'/popup/activity'" />` — title from `humanizeMethodName(op.title)` for `dapp_execute`, or token symbol for `transfer`.
   - Terminal-state badge from `journalTerminalDisplay(op)` (Cancelled / Interrupted / Failed). Uses existing helper.
   - Origin chip (dApp identity from `op.subtitle`) for `dapp_execute`.
   - Token + amount block for `transfer`.
   - **Error block (A6):** by default render ONLY the user-facing `subtitle` from `journalTerminalDisplay` (categorical, safe) plus the categorical `error.kind`. The raw `error.message` AND `error.normalizedRaw` (per `@nulo/wallet-core/jobs` shape — codex M3 confirmed `normalizedRaw` exists) are gated behind `developerMode || debugMode` via `configService.getProps()`, mirroring `tx/[id].vue:127–133`.
   - **Subtitle URL-sanitization (A6):** if `op.subtitle` matches `/^https?:\/\//`, render as non-clickable plain text (not a link). Test pin: subtitle `"https://evil.com/?steal=secret"` renders as text.
   - Created/updated timestamps via `DateTime.fromMillis(op.terminalAt ?? op.createdAt)`.
   - No explorer link (no chain tx). The `tx/[id].vue` page handles chain-tx details; this page is journal-only.
3. **Wire it up:**
   - `TransactionsList.vue:51-55` and the equivalent click handler in `RecentActivityView.vue` route `journal` rows to `/popup/journal/${row.op.id}`.
   - **Journal-record-disappeared race (A20):** the new page subscribes to `journalService.onOperationDeleted`; on match for the current id, redirect to `/popup/activity` with a `useToast` "Record removed".
4. **Polish pending-tx page** (`tx/[id].vue` revisions — A15 cuts the banner):
   - Hide the explorer link when `!isMined` (mirror `TransactionCard.vue:63–66`).
   - Fee row: show `formattedFee` when present; else show `formattedEstFee` with a "Pending settlement" subtitle in the fee row.
   - **No standalone banner** (A15 drops it). The existing pending status icon + the hash slice + the new fee-row subtitle already carry the "waiting for inclusion" signal; a banner duplicates UI across surfaces.

**Tests added:**

- `packages/extension/src/popup/pages/journal/[id].test.ts` (new) — three visual states: cancelled `dapp_execute`, failed `transfer` with `error.kind === "prover"`, interrupted (`sw_restart_post_prove`). Asserts visual state, subtitle, origin chip, optional amount block. Subtitle-URL-sanitization pin (A6).
- Extend `tx/[id].test.ts` — pending status renders fee-row subtitle "Pending settlement"; explorer link absent.
- E2E smoke: extend the cancel-flow test so after cancel, clicking the terminal card lands on the detail page. Selector: `[data-testid="journal-detail-page"]` and `[data-testid="journal-detail-error-kind"]`.

**Risk surface:** New route + new page. Reuses existing `journal-state.ts` helpers. No background service change.

### Phase 4 (commit 4) — F2 incoming fungible-token receives in history

This phase is the largest and the only one with foundational redesign post-audit. Sub-numbered for clarity.

#### 4a. Discovery trigger (A3 — addresses codex C1)

Codex correctly flagged that `TokenBalanceService`'s ticker doesn't passively poll — it drains an explicit queue. **The plan picks the `NoteService` watch loop** as the default (cleanest separation of concerns; no piggy-backing on a service that doesn't own this concern):

- `NoteService` gets a new method `watchNotes(networkId, accountAddress, contracts: AztecAddress[]): NoteWatchHandle`. The handle exposes `onNotesAdded(contract: AztecAddress, notes: NoteDao[])`.
- **Singleflight scheduler (A25):** ONE poll loop per `(networkId, accountAddress)` — NOT one per contract. Avoids the SW timer fan-out problem under many watched tokens. The single tick (every N seconds, start with 30s and tune during impl) iterates the registered contract list and calls `pxe.getNotes({ contractAddress, status: ACTIVE, scopes: [accountAddress] })` per contract. Compare to last-seen `siloedNullifier` set per contract; emit `onNotesAdded` for new entries.
- `IncomingTransferService` registers one contract per token the user has added; the scheduler owns the timer. Lifecycle: register on `tokenService.onTokenAdded`; unregister on `onTokenDeleted`. Unregistering the last contract stops the scheduler for that `(networkId, accountAddress)` pair.
- **Scan on every poll tick** (A13, A24) — don't gate on balance-increase. Dedupe at the record level via `siloedNullifier`.

Alternative architectures considered (left open for impl-time decision):

- **PXE block-sync hook:** poll `pxe.getSyncedBlockHeader(network)` to detect new blocks; fetch notes per new block range. More efficient but adds a header-poll loop.
- **Augment `TokenBalanceService`'s queue:** add a periodic re-enqueue for watched balances; piggy-back. Cheaper change but couples two concerns.

Plan defaults to NoteService watch loop. Open question 4 (§9).

#### 4b. Raw-note exposure (A4 — addresses codex C2)

`NoteService` currently strips `siloedNullifier`, `noteHash`, `l2BlockNumber`, `l2BlockHash`, `txIndexInBlock`, `noteIndexInTx` from the `NoteDao` (per `pxe/schemas.ts:11–24`). The current `Note` shape (`note/spec.ts:3-28`) only exposes `contract`, `storageSlot`, `txHash`, `rawContent`, `type`, `contractName`, `location`, `content`, `renderError`.

**Extension:** Add a parallel raw-note method (NOT change the existing `Note` shape — popup callers don't need the new fields):

```ts
// note/spec.ts additions
export type RawNote = Note & {
  siloedNullifier: string
  noteHash: string
  l2BlockNumber: number
  txIndexInBlock: number
  noteIndexInTx: number
}

export type Methods = {
  getNotes(networkId: string, account: string, contract?: string): Note[]
  /** Same as getNotes but exposes the raw-NoteDao fields needed for
   *  unique-key + ordering at the incoming-transfer record layer. */
  getNotesRaw(networkId: string, account: string, contract?: string): RawNote[]
}
```

`getNotesRaw` populates the new fields directly from `NoteDao` without stripping. `getNotes` keeps the original Note shape via a projection from RawNote (or both implementations call a shared internal).

#### 4c. New service + repository

- `packages/extension/src/wallet/services/incoming-transfer/service.ts` — new background service.
  - `dependencies = [TOKEN_BALANCE_SERVICE_NAME, NOTE_SERVICE_NAME, TRANSACTION_SERVICE_NAME, OPERATION_JOURNAL_SERVICE_NAME]` (A7).
  - Subscribes to `tokenService.onTokenAdded` / `onTokenDeleted` to wire/unwire watch handles per token.
  - Subscribes to `transactionService.onTransactionAdded` to push to the recent-tx-hash ring buffer (A3).
  - Exposes `getIncomingTransfers(profileId, networkId, accountAddress, tokenId?)`. Emits `onIncomingTransferAdded` / `onIncomingTransferUpdated` / `onIncomingTransferDeleted`.
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts` — IndexedDB-backed repo.
  - Unique key: **`siloedNullifier`** (A4 — cryptographically unique per note).
  - Stored fields: `id (autoincrement), profileId, networkId, accountAddress, contract, tokenId, owner, amountRaw, type ("UintNote"), siloedNullifier, noteHash, txHash, l2BlockNumber, txIndexInBlock, noteIndexInTx, discoveredAt`.
  - Inserts are **idempotent** by `siloedNullifier` (A3).
- `packages/extension/src/wallet/services/incoming-transfer/spec.ts` — service-name constant + Methods/Events.
- `packages/extension/src/wallet/services/incoming-transfer/client.ts` — popup client surface.

#### 4d. Dedupe (A3 belt-and-suspenders)

A newly-discovered note becomes an incoming-transfer record only if ALL of:

1. The note's `siloedNullifier` is NOT in the existing IncomingTransferRepository (idempotent insert).
2. The note's `txHash` is NOT in `TransactionService.getTransactions(...)` for the same account (user's own outgoing).
3. The note's `txHash` is NOT on any in-flight journal record at stage `submitting` or later with a `progress.txHash` match.
4. The note's `txHash` is NOT in an in-memory recent-tx-hash ring buffer maintained by `IncomingTransferService` (**opportunistic / best-effort layer** — bounded at 256 entries OR 5-minute window, whichever comes first; pushed on `onTransactionAdded`). Correctness is anchored on the other three dedupe sources above; this layer covers the proving→submitting race window cheaply. SW restart drops the buffer; the late-delete on `onTransactionAdded` (below) covers residual incoming records inserted between SW restarts.

If a chain tx is later added (`onTransactionAdded` fires) AND its txHash matches an already-inserted incoming record, **delete that record** and emit `onIncomingTransferDeleted` — corrects the case where PXE saw the note before `addTransaction` landed.

#### 4e. UI integration

- `activity.vue:81-98`'s `activityRows` extended with the `"incoming"` discriminator:
  ```ts
  type ActivityRow =
    | { type: "tx";       key: string; sortKey: number; tx: Transaction }
    | { type: "journal";  key: string; sortKey: number; op: OperationRecord }
    | { type: "incoming"; key: string; sortKey: number; inc: IncomingTransferRecord }
  ```
- `RecentActivityView.vue`'s analogous merge gets the same branch.
- Row-merge extracted to **`packages/extension/src/utils/activity-rows.ts`** (A16 — was `popup/pages/activity-rows.ts` in v1; L0 utility location so both L6 page and L4 module can import).
- `TransactionsList.vue` adds `v-else-if="row.type === 'incoming'"` branch rendering a new `TransactionIncomingCard.vue` (L3 composite).
- `TransactionIncomingCard.vue`:
  - Icon: `arrow-narrow-down-left` (A21 — verify exists in `icons.json` pre-commit; fall back to `arrow-narrow-up-right` rotated via CSS if absent).
  - Title: token symbol.
  - Amount: `balanceFormatted(inc.amountRaw, token.decimals, 8)` with `+` prefix.
  - Title-trailing chip: "Received".
  - No origin chip.
  - Clickable → `/popup/tokens/${inc.tokenId}` (A12 — corrected from v1's `token/`; the token-detail page is the natural detail surface for an incoming receive). Codex's nit on `tx/[id].vue` reuse is heeded: do NOT extend that page to handle incoming records. It stays tx-only.
- Per-token history (`popup/pages/tokens/[id].vue`) extended with the same `"incoming"` discriminator scoped by `inc.tokenId === route.params.id`.

#### 4f. First-receive friction via unified trust-state enum (A10 — pollution defense; A23 — codex v2-followup)

One persisted enum per `(profileId, networkId, contract)` tracks the contract's incoming-trust state. Replaces v1/v2's split state (Token boolean + blocked Set + hidden flag), which left bursty-during-pending behavior under-specified.

```ts
type IncomingTrustState = "unknown" | "pending" | "trusted" | "blocked"
```

**State machine** (deterministic; every transition pinned by tests):

- **`unknown`** (default) — no notes from this contract yet.
- On first note arrival: transition `unknown → pending`. Insert the incoming record with `hidden: true`. Emit `onIncomingTransferPending` so the popup can prompt.
- **`pending`** — all subsequent notes from the same contract while pending are queued: each is recorded with `hidden: true` and linked to the pending state. The popup persists ONE confirmation card showing the contract + the count of notes arrived so far.
- User **Allow** → `pending → trusted`. Flip every queued record to `hidden: false`; emit `onIncomingTransferAdded` for each so the activity feed updates atomically.
- User **Reject** → `pending → blocked`. Queued records stay `hidden: true` permanently. No toast on subsequent arrivals.
- **`trusted`** — subsequent receives auto-insert with `hidden: false`.
- **`blocked`** — subsequent receives are silently recorded with `hidden: true` (never shown). Promotion `blocked → trusted` lives on a future settings page (defer to follow-up).

**Storage:** new `IncomingTrustRepository` table keyed by `(profileId, networkId, contract)`. Backup/restore + profile-delete + chain-purge semantics pinned by tests.

**Why one enum and not three booleans:** codex's v2 follow-up correctly flagged that v2's split state had under-specified semantics for the bursty case (many notes arriving from the same new contract before the user confirms) and for the previously-blocked-now-allowed case. One enum + a clear transition table closes both gaps and makes the model testable.

Cheap to implement; closes the symbol-collision attack (the user must confirm a specific contract address the first time anything from it shows up) AND the burst-during-pending race.

#### 4g. Settings escape hatch (A5 — cross-device same-seed)

New setting `incomingTransfersVisible` (default `true`) at `wallet/config/config.ts`. When `false`, `IncomingTransferService` STILL records receives (so toggling back on shows history retroactively) but `IncomingTransferRepository.getIncomingTransfers` returns `[]` for the active profile. Settings UI exposes it under "Activity" or "Privacy" (TBD by impl — depends on existing settings page layout).

#### 4h. Cleanup (A14, A19)

- **Chain-purge:** When `NetworkService.purgeChain(profileId, chainId)` fires, also call `IncomingTransferRepository.clearChain(profileId, chainId)`. Mirror the pattern at `pxe/spec.ts:50–54` (`clearChainState`).
- **Profile-delete:** When `ProfileService.deleteProfile(profileId)` fires (or whatever the actual hook is — confirm pre-commit), call `IncomingTransferRepository.clearProfile(profileId)`.
- Both pinned by tests.

**Edge cases pinned in tests:**

- **Self-mint (drip from faucet):** user calls drip → outgoing tx with `mint_to_private` → note created. `txHash` matches an outgoing tx → DEDUPED. Pin.
- **Cross-device same-seed:** documented + setting `incomingTransfersVisible=false` suppresses.
- **In-flight outgoing race (codex M):** simulate `proving → submitting` race by stubbing `markJournal({stage:"submitting"})` to delay 200ms; assert the recent-tx-hash ring buffer suppresses the incoming row. If the note was recorded before the ring buffer got the hash, the subsequent `onTransactionAdded` deletes the record.
- **PXE failure:** `pxe.getNotes` throws → log, retain existing records, don't insert false rows. Pin.
- **Schema decode failure:** UintNote can't be decoded → skip the row (don't show "Received 0 X"). Pin.
- **Token removed:** stored records still reference `tokenId`; renderer hides the row. Pin.
- **Profile delete / chain purge:** records wiped. Pin both.
- **First-receive friction:** first note from a new contract gates on user Allow/Reject; Allow shows the record, Reject hides; subsequent receives from a trusted token auto-display. Pin all three paths.

**Tests added:**

- Unit: `incoming-transfer/service.test.ts`, `incoming-transfer/repository.test.ts` (covers all dedupe scenarios + lifecycle hooks).
- Unit: `note/service.test.ts` extended for `getNotesRaw`.
- Unit: `utils/activity-rows.test.ts` (row-merge logic).
- Component: `TransactionIncomingCard.test.ts` (≥10 cases).
- Component: extended `TransactionsList.test.ts` (3-branch render).
- Component: first-receive friction popup card.
- E2E network: `packages/extension/tests/e2e/network/incoming-transfer.test.ts` (new) — flow: two accounts on the same PXE/sandbox; A sends to B; B's history shows the "Received" card with the right amount/token within the bounded poll window. Variant: drip-from-faucet → NOT shown as incoming (self-mint dedupe).

**Risk surface:** Largest commit by far. New background service, new IndexedDB store, NoteService extension, new card, modified row-merge in 2 surfaces + per-token history, 2 lifecycle hook integrations. Flag for review focus. If the post-impl codex audit finds a critical issue here, F1–F3 stand and F4 can be re-spun.

## 3. Security & adversarial considerations

### Phase 1 — Tx-card name bug fix

- Attacker dapp names a call `sponsor_unconditionally` to hide from the card title → already covered by R2 above. The consent popup at `OperationCard.vue:103` shows the full payload; card title is a summary surface. Hardening would force a `getPrimaryCall` shape rewrite — tracked as a follow-up if real abuse surfaces.
- Layer move (helper to `utils/primary-method.ts`) is a strict improvement: removes a popup→wallet directional smell.

### Phase 2 — Onboarding fee-juice step

- Static Vue template + interpolated strings. No `v-html`. XSS-safe.
- Copy correctness reviewed inline; cross-checked against Aztec official docs during impl. No external CMS dependency.
- StepIndicator type widening is a TS-safety improvement (forces typecheck across all 5 consumer pages).

### Phase 3 — Journal detail page

- **Error-message leak (A6):** raw `op.error.message` AND `op.error.normalizedRaw` gated behind `developerMode || debugMode`. Default render is `op.error.kind` (categorical) + friendly subtitle.
- **Subtitle URL-injection (A6):** subtitle is dapp-controlled (set at session discover time). If it looks like a URL, render as plain text — never as a link. Pin via test.
- Re-trigger risk: page is read-only. No "Try again" affordance ships in this arc (Q4 in §9).

### Phase 4 — Incoming fungible-token receives

- **Pollution attack (A10):** `aztec_registerToken` consent is UX trust (user can be socially-engineered into adding a fake-USDC). First-receive friction (§2.4f) raises the bar: even after token-add, the FIRST incoming note requires a second user confirmation showing the contract address. Subsequent receives from a trusted-incoming token auto-display.
- **Symbol-collision** follow-up (separate PR): when rendering an incoming card whose token shares a symbol with another known token on the same network, add a "Verify token" badge linking to the contract address.
- **Self-attribution (A5):** cross-device same-seed users will see their own outflows as incoming on every other device. Documented limitation + settings toggle `incomingTransfersVisible` (default on) to disable entirely.
- **Self-mint dedupe (A3):** belt-and-suspenders — siloedNullifier-keyed idempotent insert + 4 dedupe sources (existing records, outgoing tx hashes, in-flight journal `progress.txHash`, in-memory ring buffer). Late-arriving `onTransactionAdded` deletes a previously-inserted incoming record.
- **PXE failure / decode failure:** catch + log + bail. No false rows. Existing records preserved.
- **Privacy:** display reveals notes PXE has already decrypted locally. No new privacy surface vs. existing balance display. The setting toggle gives the user opt-out for the cross-device leak.
- **Sender attribution:** none. Aztec UintNote carries `value`, `owner`, `randomness` only. Card just says "Received".
- **Storage cleanup (A14):** wired into BOTH chain-purge and profile-delete. Pinned by tests.

### Cross-cutting

- **Supply chain:** no new dependencies.
- **Least privilege:** no new chrome.* permissions. New service operates within existing PXE + storage access.
- **OIDC / secrets:** N/A.
- **Crypto:** N/A — uses PXE's decrypted notes.
- **Branch protection:** PR targets `dev`. Existing `Quality / Status` + `Smoke e2e / Status` + `Network e2e / Status` gates apply.

## 4. Phase ordering rationale + revert safety

Risk-ascending. v2 enforces no F1–F3 → F4 coupling (codex N1 / opus N1):

1. **F4 (name bug)** — 7 line-level changes + 1 new helper file. Lowest-risk revert.
2. **F1 (onboarding)** — UI-only + StepIndicator type widening. The type widening is the only "cross-cutting" change but is TS-strict-caught.
3. **F3 (canceled details)** — new route + page; reuses existing helpers.
4. **F2 (incoming)** — new background service + new IndexedDB store + NoteService extension + UI integration in 3 surfaces. Largest blast radius.

If codex's post-impl audit raises a critical on F2, commits 1–3 stand; commit 4 partial-revert is clean. F2's new route paths (`/popup/tokens/...`, the row-merge `incoming` branch) are added in commit 4 only — no earlier commit references them.

## 5. Test plan

Production calibration. Layer-by-layer per CLAUDE.md.

| Layer | What | Where |
|---|---|---|
| Unit | `pickPrimaryMethod` (new helper) | `packages/extension/src/utils/primary-method.test.ts` (new) |
| Unit | Remaining `tx-enrichment.ts` exports (A17) | `packages/extension/src/utils/tx-enrichment.test.ts` (new) |
| Unit | `OperationPlanner.extractPrimaryMethod` (A1) | `packages/extension/src/wallet/services/execution/operation-planner.test.ts` (new) |
| Unit | `app.store.ts` awaiting-tx dedupe with FPC sponsor (A9) | `packages/extension/src/stores/app.store.test.ts` (new or extend) |
| Unit | `IncomingTransferService` + dedupe + first-receive friction | `packages/extension/src/wallet/services/incoming-transfer/service.test.ts` (new) |
| Unit | `IncomingTransferRepository` + chain-purge + profile-delete | `packages/extension/src/wallet/services/incoming-transfer/repository.test.ts` (new) |
| Unit | `NoteService.getNotesRaw` | extend `packages/extension/src/wallet/services/note/service.test.ts` |
| Unit | Activity-rows merge helper | `packages/extension/src/utils/activity-rows.test.ts` (new) |
| Component | `TransactionIncomingCard.vue` (≥10 cases) | colocated |
| Component | `fees.vue` onboarding step | colocated |
| Component | `learn.vue` split-handler regression | colocated (new or extend) |
| Component | `StepIndicator.vue` updated for 5 cells | colocated |
| Component | `journal/[id].vue` (3 visual states + subtitle URL-sanitization) | colocated |
| Component | `TransactionsList.vue` 3-branch render | colocated |
| Component | `tx/[id].vue` pending fee-row subtitle, explorer-link gating | colocated |
| Component | First-receive friction popup card | colocated |
| E2E smoke | Onboarding click-through covers new step | extend existing smoke (path confirmed pre-commit) |
| E2E smoke | Cancel a tx → click terminal card → land on journal detail page | extend existing cancel-flow smoke |
| E2E network | Faucet drip name regression — in-flight title == settled title | `packages/extension/tests/e2e/network/faucet-drip.test.ts` (extend or new) |
| E2E network | Two-account same-PXE → incoming receive shows on recipient + drip-self-mint NOT shown | `packages/extension/tests/e2e/network/incoming-transfer.test.ts` (new) |

**Selector discipline:** all e2e selectors are `data-testid` (CLAUDE.md). Every new interactive element ships with a testid:

- `data-testid="tx-incoming-card"`, `data-testid="incoming-first-receive-allow"` / `data-testid="incoming-first-receive-reject"`.
- `data-testid="onboarding-fees-continue"`, `data-testid="onboarding-fees-skip"`.
- `data-testid="onboarding-learn-continue"` (existing) and `data-testid="onboarding-learn-skip"` (existing) — split handlers preserved; selectors unchanged so existing tests don't drift.
- `data-testid="journal-detail-page"`, `data-testid="journal-detail-error-kind"`.
- `data-testid="tx-detail-pending-fee-subtitle"` on the new fee-row subtitle.

## 6. Quality gates

Locally, gate the PR with:

```bash
bun run typecheck    # all packages
bun run lint         # biome lint + layer-import rules
bun run test         # unit + component
bun run audit:vue    # typecheck → test → lint → build (one-shot pre-PR)
bun run test:e2e     # smoke (no network)
bun run e2e:agent    # network (parallel-safe via my-stack pattern)
bun run lint:actions # actionlint on any workflow changes (none expected this PR)
```

**Per-commit local validation gate (codex Q5):** every commit passes `bun run audit:vue` AND `bun run test:e2e` locally before the next commit is added on top. Cheap insurance for a 4-commit chain. `bun run e2e:agent` runs once at HEAD before push.

CI (server-side, on PR-to-`dev`):

- `Quality / Status` — required.
- `Smoke e2e / Status` — runs via diff hitting smoke-surface (will, for UI changes). Advisory on `dev`.
- `Network e2e / Status` — apply `e2e:network` label manually. Required on `main`; want green before merge to `dev`.

## 7. Rollback / risk

- Single PR, squash-merged → revert is one `git revert`.
- Per-phase commits make partial cherry-pick possible. Phase 4 contains all incoming-history surfaces; reverting just commit 4 leaves F1–F3 functional.
- New IndexedDB store ships empty on first run and self-heals from PXE on the next poll cycle. Wipe-and-reseed is the documented recovery — matches `[memory: no-data-migrations]`.
- No schema migrations to existing stores.
- No protocol changes; no upgrade choreography.
- StepIndicator type widening: if a consumer hardcodes `current: 1|2|3|4` somewhere I missed, typecheck will catch it. No runtime risk.

## 8. Open questions (post-audit)

1. (Resolved) Banner persistence → cut the banner (A15).
2. (Resolved) "Received from <contract>" label → no, blank.
3. (Deferred) Per-token "Total transferred" stats — out of arc.
4. **Discovery loop architecture** (codex's "hidden 6th"): NoteService watch loop (default) vs PXE block-sync vs TokenBalanceService extension. Final pick decided during F2 impl phase 4a. Plan defaults to NoteService watch loop.
5. **First-receive friction UX placement:** popup card (mirrors token-import) vs banner in History page vs inline-on-card "Allow this token?" CTA. Plan defaults to popup card.
6. **Settings toggle wording:** "Show incoming transfers" vs "Show incoming token receives" vs "Show transfers received from others". Plan defaults to "Show incoming transfers"; finalize during impl.
7. (Deferred) "Try again" affordance on interrupted journal records (opus Q4). Tracked as a separate follow-up.

## 9. Branch + commits + PR shape

**Branch:** `feat/onboarding-fees-history-arc` off `dev`.

**Commits (Conventional, in order; scope tags differentiated per opus N2):**

1. `fix(tx-card): unify primary-method picker across 7 sites`
2. `feat(onboarding): add fee-juice + private-fee-juice step; expand indicator to 5 cells`
3. `feat(activity): make canceled-tx cards openable; pending-tx page polish`
4. `feat(incoming): surface incoming fungible-token receives in history`

**PR title:** `feat(activity): onboarding fee-juice step, incoming receives, canceled-tx details, name-bug fix`

**Squash subject on `dev`:** same as PR title. Body should call out the four phase commits as a checklist for reviewers + reference the audit transcripts.

## 10. Implementation discipline

- ASCII checklist visible at the top of every status update.
- Per-phase lessons log at `implementations-plan/onboarding-fees-history-arc/lessons/phase-N.md`. Log every meaningful attempt — failed approach, surprise from PXE, layer-import lint catch, e2e flake.
- After 3 failures on the same step → stop and reassess (universal-workflow rule 3b).
- Update `implementations-plan/README.md` (the planning archive index) with one line referencing this arc.
- Post-impl codex audit at `xhigh` with explicit adversarial ask — wired into the protocol's step 6.
- **No milestone/phase tags in committed code (A22).** Per-commit diff scanned for `F\d|Phase \d|v\d` before push.

## 11. `/goal` and `/loop` seed strings

Two alternatives for the autonomous implementation session. Pick one — they don't compose. Default to `/goal` (transcript-observable completion condition; survives `claude --resume`). Fall back to `/loop` for self-paced cadence if signals aren't transcript-visible.

### `/goal` (primary)

```
/goal All 4 phases marked ✓ in the ASCII status checklist (F4 name-bug fix → F1 onboarding fee-juice + indicator-redesign → F3 canceled-tx details + pending polish → F2 incoming fungible-token receives); per-phase lessons logged in implementations-plan/onboarding-fees-history-arc/lessons/phase-{1..4}.md; codex post-impl audit complete at xhigh with adversarial ask, high/critical findings addressed (including layer-boundary, pollution-attack, dedupe-race, error-leak concerns); `bun run audit:vue` reports exit 0 in the transcript; `bun run test:e2e` smoke reports exit 0; `bun run e2e:agent` network reports exit 0 with the new faucet-drip name regression + incoming-receive happy path + self-mint dedupe all passing; quality bar from the plan's Scope section is met (Production: full unit + component coverage, smoke + network e2e where user flows touch new UI, polished onboarding copy, first-receive friction implemented, settings escape hatch for cross-device same-seed users wired into settings UI).
```

### `/loop` (fallback — self-paced)

```
/loop Each turn, in priority order:
1. State check: read the ASCII phase checklist from the latest update, run `git status`, and (if a PR exists) `gh pr checks --watch` to confirm what's actually in flight.
2. If CI is in flight: stream it with `gh run watch` and wait before kicking off more work.
3. If a check or local run failed: triage and fix; call `/codex xhigh` if the fix isn't obvious or the decision is non-trivial (architecture fork, security ambiguity, race-correctness, layer-boundary call); commit (small, conventional) and push.
4. If the in-flight phase is green (`bun run audit:vue` clean + per-phase test suite clean + any phase-level audit clean): mark it ✓ on the checklist, file the lessons log entry at implementations-plan/onboarding-fees-history-arc/lessons/phase-N.md, then advance to the next pending phase.
5. If nothing is in flight: pick the next pending step from plan.md and execute it (edit → lint → test → commit → push → gh pr checks --watch). Phase order (risk-ascending): F4 name-bug + 7th site → F1 onboarding + indicator-redesign → F3 canceled-tx details + pending polish → F2 incoming receives.

Discipline: call codex on any architecture / scope / race-correctness / security / layer-boundary decision; never merge to main or release branches; never publish or deploy; keep the ASCII checklist at the top of every update; every new interactive element ships with a data-testid (no aria-label or text-content selectors); incoming-history dedupe race must be pinned by integration test BEFORE the F2 commit lands; first-receive friction must ship with F2 (not deferred); settings escape hatch must ship with F2. Per-commit local validation: `bun run audit:vue` AND `bun run test:e2e` MUST be green locally before adding the next commit on top. Continue until all 4 phases ✓, `bun run audit:vue` + `bun run test:e2e` + `bun run e2e:agent` all green, codex post-impl audit clean, and the PR is merged or blocked on me.
```

### Why both, and when to switch

- **`/goal` is the default.** All five completion signals (4 phase ✓, audit:vue 0, test:e2e 0, e2e:agent 0 with new tests passing, codex post-impl clean) are observable in the transcript — the evaluator can verify them turn-by-turn without external state.
- **Switch to `/loop` only if** the autonomous session needs to babysit a long-running external state the evaluator can't see (e.g. an in-flight CI run that takes 25 min). The `/loop` template handles cadence inline.
