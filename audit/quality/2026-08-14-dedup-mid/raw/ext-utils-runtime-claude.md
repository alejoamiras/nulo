# Quality scan — `ext-utils-runtime` (claude)

Scope audited: `apps/extension/src/utils/**`, `apps/extension/src/wallet/**` (excl. `wallet/services/`), `apps/extension/src/e2e/**`, per the cluster repo map. `*.test.ts` read as evidence only, not finding-eligible. Focus: duplication (Duplicate Code, Shotgun Surgery, Divergent Change, Dead Code weighted highest).

---

## Finding 1 — `comma()` reimplements `formatBaseUnits()`'s job with a different (rounding, not truncating) contract

**Smell**: Duplicate Code (two implementations of "format a token amount for display" coexisting in the same file).

**Impact bucket**: structural. Blast radius: 1 in-scope file (`utils/amount.ts`) + 2 out-of-scope consumers (`AmountCard.vue`, `SelectBalanceTypePopup.vue`), 4 call sites, all on the send/balance display path. Change frequency: low/unknown — `amount.ts` has 2 commits since the `apps/` restructure (#186); pre-restructure history isn't separately trackable.

**Evidence**:
- `apps/extension/src/utils/amount.ts:11-39` — `comma(target, symbol=",", fixed=2)`: `Number.parseFloat(target).toFixed(fixed)` (float-based) then manual trailing-zero trim + regex thousands-insertion.
- `apps/extension/src/utils/amount.ts:198-277` — `FormatBaseUnitsOpts` + `formatBaseUnits()`: pure-bigint, explicitly documented **TRUNCATE-only** rounding contract ("never rounds up... showing a rounded-up value can mislead the user into thinking they hold more than they actually do", lines 223-227).
- `apps/extension/src/components/composite/send/AmountCard.vue` imports **both** in the same file (`import { purgeNumber, normalizeAmount, clampDecimals, comma, formatBaseUnits } from "@/utils/amount"`, line 3) and uses each for adjacent jobs: line 107 `model.value = comma(model.value, ",", fixed)`, line 155 `` comma(props.tokenBalanceByType, ",", 8) `` for the balance preview, but line 162 uses `formatBaseUnits(modelRaw.value, tokenDecimals.value, {...})` for the USD-equivalent line one row below.
- `apps/extension/src/popup/components/popups/SelectBalanceTypePopup.vue:109,199` — `comma(option.token.balance)` for a balance list, the exact job `balanceFormatted()`/`formatBaseUnits()` (also in `amount.ts`) already cover.

**Why it harms future change**: a single component (`AmountCard.vue`) displays token amounts through two different numeric-formatting engines with **opposite rounding directions** in the same view. A future fix to one ("stop rounding up the max-send preview") silently leaves the other's contract untouched, because nothing signals they're supposed to agree. A dev adding a fifth call site has a coin-flip choice between the two with no compiler or lint signal steering them to the canonical one.

**Smallest safe refactoring**: Inline `comma()` at its 4 call sites — replace with `balanceFormatted(...).value` (already handles the `,`/locale-separator + bigint truncation), matching the pattern `AmountCard.vue:162` already uses one property lower. Delete `comma()` (Dead Code removal) once the last call site is gone. `getDecimalSeparator`/`getThousandSeparator` stay — they're consumed by `formatBaseUnits` itself.

**Instances**:
- `apps/extension/src/utils/amount.ts:11-39` (the duplicate implementation)
- `apps/extension/src/utils/amount.ts:198-277` (the canonical implementation it duplicates)
- `apps/extension/src/components/composite/send/AmountCard.vue:107`
- `apps/extension/src/components/composite/send/AmountCard.vue:155`
- `apps/extension/src/popup/components/popups/SelectBalanceTypePopup.vue:109`
- `apps/extension/src/popup/components/popups/SelectBalanceTypePopup.vue:199`

---

## Finding 2 — `trimAddress()` exists and is well-adopted (20+ call sites), yet is independently hand-rolled at 9 sites with 4 mutually-inconsistent separator styles

**Smell**: Duplicate Code, with a Shotgun Surgery consequence (a single conceptual change — "how do we truncate an address for display" — requires touching 9+ files instead of the one canonical helper).

**Impact bucket**: structural. Blast radius: 1 in-scope canonical file (`utils/string.ts`) + 9 out-of-scope consumer files. Change frequency: `string.ts` shows only the #186 restructure commit in `git log` — low/unknown, but the canonical helper is actively used in 20+ other call sites (`AddressDisplay.vue`, `ScopeAddress.vue`, `tx/[id].vue`, `received/[id].vue`, `TxDebugPanel.vue`, etc.), so this is a live, actively-touched area of the codebase, not a cold path.

**Evidence** — canonical: `apps/extension/src/utils/string.ts:6-9`, `trimAddress(address, start=8, end=4)` → `` `${address.substring(0,start)}..${address.substring(address.length-end)}` `` (note: **two** dots).

Independently reimplemented, each with a *different* separator/style than the canonical AND than each other:
- `apps/extension/src/popup/windows/verify/index.vue:44` — `` `${addr.slice(0,6)}...${addr.slice(-4)}` `` (three dots)
- `apps/extension/src/popup/components/popups/AccountsPopup.vue:76` — same three-dot pattern
- `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:51` — same three-dot pattern
- `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:231` — same three-dot pattern, embedded in a larger template string
- `apps/extension/src/popup/pages/settings/accounts/index.vue:79` — same three-dot pattern
- `apps/extension/src/components/Header.vue:250` — same three-dot pattern
- `apps/extension/src/popup/components/modules/general/TokenImportRow.vue:27` — `` `${a.slice(0,6)}…${a.slice(-4)}` `` (single Unicode ellipsis `…`, a **4th** distinct character from both the canonical `..` and the 3-dot sites)
- `apps/extension/src/popup/pages/journal/[id].vue:125` — same single-ellipsis-character pattern
- `apps/extension/src/popup/components/popups/ReceivePopup.vue:64-66` — a 5th style: two separate `{{ account.address.slice(0,6) }}` / `{{ account.address.slice(-4) }}` template interpolations with a literal `•••` (bullet) separator rendered as its own styled `<Text>` node in between.

All 9 sites reimplement `start=6, end=4` — a width `trimAddress` supports (`trimAddress(addr, 6, 4)`, already the convention used by the in-scope consumer `tx-enrichment.ts:154`) but none of the 9 call it.

**Why it harms future change**: the codebase already visibly disagrees with itself on what a truncated address should look like (`..` vs `...` vs `…` vs a bulleted two-span layout) — proof that hand-rolling this pattern drifts. A rebrand of the truncation affordance (e.g. switching to a copy-icon-adjacent style, or changing the separator for a11y reasons) requires grepping for the pattern across the whole `popup/` and `components/` trees instead of editing one function.

**Smallest safe refactoring**: at each of the 9 sites, replace the inline `slice`/template expression with `trimAddress(address, 6, 4)` (matching the width already implied by every site). This is a plain call-site substitution against an already-exported, already-tested function — no new abstraction needed.

**Instances**:
- `apps/extension/src/utils/string.ts:6-9` (canonical, underused)
- `apps/extension/src/popup/windows/verify/index.vue:44`
- `apps/extension/src/popup/components/popups/AccountsPopup.vue:76`
- `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:51`
- `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:231`
- `apps/extension/src/popup/pages/settings/accounts/index.vue:79`
- `apps/extension/src/components/Header.vue:250`
- `apps/extension/src/popup/components/modules/general/TokenImportRow.vue:27`
- `apps/extension/src/popup/pages/journal/[id].vue:125`
- `apps/extension/src/popup/components/popups/ReceivePopup.vue:63-66`

---

## Finding 3 — `LoggerStore.log()` and `.logWithContext()` duplicate their entire body

**Smell**: Duplicate Code.

**Impact bucket**: local. Blast radius: 1 file (`wallet/logger/store.ts`), 2 methods. `log()` has ~90 call sites repo-wide (background services, runtime boot, popup/onboarding entrypoints); `logWithContext()` has exactly 1 (`wallet/services/logger/service.ts:23`). Change frequency: low (1 commit since #186).

**Evidence**: `apps/extension/src/wallet/logger/store.ts`:
- `log()` (lines 27-43): level-check → build `Log{ id, timestamp, source, level, context: "sw", data: trim(data) }` → `this.logs.add(log)` → `scheduleFlush()` → `onLog.invoke(log)` → `print(log)`.
- `logWithContext()` (lines 46-62): **identical** sequence, byte-for-byte, except `context` is a parameter with `?? "sw"` fallback instead of the hardcoded literal `"sw"`.

Calling `logWithContext(undefined, source, level, ...data)` produces the exact same `Log` object `log(source, level, ...data)` would (the `?? "sw"` fallback collapses to the same default) — the two methods are provably equivalent modulo that one parameter.

**Why it harms future change**: any change to log-record construction (a new field, a different flush trigger, altered id/timestamp logic) must be applied to both bodies by hand. There's no compiler or test signal tying them together — `card-subtitle.test.ts`-style exhaustiveness pinning doesn't apply here; a future editor could patch one and forget the other, and the two would silently diverge (e.g. `logWithContext` not incrementing something `log` does, or vice versa).

**Smallest safe refactoring**: Inline — make `log()` a one-line delegate: `public log(source: string, level: LogLevel, ...data: unknown[]): void { this.logWithContext(undefined, source, level, ...data) }`. Deletes the duplicated 12-line body; `logWithContext` becomes the sole owner of record construction.

**Instances**:
- `apps/extension/src/wallet/logger/store.ts:27-43` (`log`)
- `apps/extension/src/wallet/logger/store.ts:46-62` (`logWithContext`)

---

## Finding 4 — Three independently-maintained switch statements map the same `JobErrorKind` taxonomy to different display text in `journal-state.ts`

**Smell**: Shotgun Surgery / Divergent Change (a single conceptual change — "give this error kind a proper user-facing treatment" — requires visiting up to 3 switch statements in one file, with no shared source of truth for the kind→copy mapping itself).

**Impact bucket**: local (contained to one file, 3 functions, within the trace cap), but flagged because the taxonomy it maps over (`JobErrorKind`) is deliberately **open-ended** (`KnownJobErrorKind | (string & {})`, `packages/wallet-core/src/jobs/types.ts:95`) specifically so new producers can add kinds without a type-level edit — meaning this file is the one place new-kind UX completeness has to be hand-verified, and only 2 of the 3 switches have a taxonomy-loop test. Change frequency: this exact file/domain was already the subject of a prior quality pass — commit `578861be` (PR #197, "Q-07: dedup + de-stringly-type the error taxonomies") added the `KNOWN_JOB_ERROR_KIND_TABLE` completeness guard in `wallet-core` but did **not** touch the display-mapping duplication below it — this is an unaddressed continuation of that same domain, not a re-litigation of settled work.

**Evidence** (`apps/extension/src/utils/journal-state.ts`):
- `humanizeErrorKind()` (lines 165-194) — 12-case switch, `kind → short label` ("Network", "Simulation", "Proof generation", …), default `"Error"`. Covered by a `KNOWN_JOB_ERROR_KINDS` taxonomy-loop test (`journal-state.test.ts:509-514`).
- `categoricalLabel()` (lines 218-256) — a *different* switch over mostly the same kinds, grouping several into shared `{label, context}` pairs ("Stopped before broadcast" groups `simulation`/`prover`/`stuck_proving`/`stuck_queued`). Also covered by a taxonomy-loop test (`journal-state.test.ts:516-520`).
- `failedSubtitleFor()` (lines 259-274) — a **third** switch, only 3 explicit cases (`network`, `simulation`, `prover`) with everything else — including `stuck_queued`, which the other two switches treat specially — falling to the generic `"Transaction failed"`. **Not** covered by the `KNOWN_JOB_ERROR_KINDS` loop the other two get (verified: `grep` for `failedSubtitleFor` in the test file finds only individual example-based tests, e.g. lines 120-164, no loop over `KNOWN_JOB_ERROR_KINDS`).
- The file's own comment at `journal-state.test.ts:389-394` names the sync surface as spanning 4 places ("verified against `wallet-core/jobs/types.ts` documented values + `failedSubtitleFor` switch in this file + reaper.ts emissions + execution/service.ts normalizeError call sites") — i.e. the duplication cost is already something a maintainer has to reason about by hand, not something the toolchain enforces for all 3.

**Why it harms future change**: adding a new `JobErrorKind` producer (the type explicitly permits it without a compile error) only gets a coherent UI treatment across all 3 surfaces (journal-detail "Reason" row, categorical chip, terminal-card subtitle) if the author remembers to touch all 3 switches. `failedSubtitleFor`'s narrower explicit-case list (vs. the other two) is itself evidence this has already partially drifted — e.g. `stuck_queued` gets a dedicated, useful label in `humanizeErrorKind` ("Stuck queued") and `categoricalLabel` ("Stopped before broadcast" + explanatory context), but only the generic "Transaction failed" in the terminal-card subtitle, with no test guarding that gap.

**Smallest safe refactoring**: Replace Conditional with Lookup Table (a data-driven analog of Replace Conditional with Polymorphism) — introduce one `Record<KnownJobErrorKind | "default", { shortLabel, categoricalLabel, categoricalContext, terminalSubtitle }>` and derive `humanizeErrorKind`, `categoricalLabel`, and `failedSubtitleFor` as field projections over it. A single missing-kind check (already partially present via `KNOWN_JOB_ERROR_KINDS`) then guarantees all 3 surfaces get a deliberate value for every kind, not just the 2 that happen to have a loop test today.

**Instances**:
- `apps/extension/src/utils/journal-state.ts:165-194` (`humanizeErrorKind`)
- `apps/extension/src/utils/journal-state.ts:218-256` (`categoricalLabel`)
- `apps/extension/src/utils/journal-state.ts:259-274` (`failedSubtitleFor`)

---

## Finding 5 — The canonical `isTerminal`/`TERMINAL_STAGES` stage classifier is reimplemented via two independent hand-rolled enumerations instead of being reused

**Smell**: Duplicate Code (the "which `JobStage` values are non-terminal / in-flight" classification is defined 3 times: once canonically, twice as an inverted re-enumeration).

**Impact bucket**: structural. Blast radius: 2 in-scope files (`utils/in-flight-send.ts`, `utils/card-subtitle.ts`) + 1 canonical file one layer down (`packages/wallet-core/src/jobs/types.ts`), which 5 other in-scope-adjacent files (`operation-journal/{spec,service,reaper,gc}.ts`, `incoming-transfer/service.ts`) already import correctly. Change frequency: `in-flight-send.ts` was touched as recently as PR #325 (`feat(activity): silo wallet activity by profile, network, chain and account`); `card-subtitle.ts` only shows the #186 restructure commit.

**Evidence**:
- Canonical: `packages/wallet-core/src/jobs/types.ts:27` — `JobStage = "queued"|"pending"|"simulating"|"proving"|"submitting"|"succeeded"|"failed"|"cancelled"` (closed union, 8 literals); `:34` — `TERMINAL_STAGES: ReadonlySet<JobStage> = new Set([...succeeded, failed, cancelled])`; `:37-39` — `isTerminal(stage)`. Already imported by 5 files under `wallet/services/operation-journal/*` and `wallet/services/incoming-transfer/service.ts` (confirmed via grep; none of those 5 are `in-flight-send.ts` or `card-subtitle.ts`).
- `apps/extension/src/utils/in-flight-send.ts:18` — `IN_FLIGHT_STAGES: ReadonlySet<string> = new Set(["queued","pending","simulating","proving","submitting"])`, used at line 25 (`SENDING_KINDS.has(op.kind) && IN_FLIGHT_STAGES.has(op.progress?.stage)`) — this is exactly the complement of `TERMINAL_STAGES`, re-typed as a bare `string` set (loses the `JobStage` type link entirely) and re-enumerated by hand instead of `!isTerminal(stage)`.
- `apps/extension/src/utils/card-subtitle.ts:14-33` — `stageSubtitle()`'s switch has explicit cases for the same 5 non-terminal stages (`queued`/`pending`/`simulating`/`proving`/`submitting`, lines 16-28), with the `default` arm's own comment acknowledging it's standing in for the terminal set ("Terminal stages (succeeded/failed/cancelled) shouldn't render the in-flight card at all... Defensive fallback", lines 30-33) — i.e. the file already knows conceptually it's classifying terminal-vs-not, but re-derives the classification instead of consulting `isTerminal`.

**Why it harms future change**: `JobStage` is described as a "7-stage FSM shared across kinds" (types.ts:7) that's already stable, so the immediate risk is low — but this is precisely the kind of shadow copy that breaks silently: if the FSM ever gains a stage (the same docstring notes stage-specific progress payloads can be extended "without bumping the schema"), `TERMINAL_STAGES` is the single place that would need updating, yet 2 further files elsewhere have their own opinion about which stages are "in-flight" that nothing forces back into agreement with it.

**Smallest safe refactoring**: Inline — in `in-flight-send.ts`, replace `IN_FLIGHT_STAGES.has(op.progress?.stage)` with `op.progress?.stage !== undefined && !isTerminal(op.progress.stage)` (import `isTerminal` from `@nulo/wallet-core/jobs`), then delete `IN_FLIGHT_STAGES`. In `card-subtitle.ts`, no structural change is required to the switch itself (it still needs per-stage *copy*, which `isTerminal` can't provide) — but its default-arm comment claiming to guard terminal stages can be made real by having the caller (or the function itself) assert `!isTerminal(stage)` before switching, rather than relying on the switch's silent `"Processing..."` fallback to paper over a terminal stage reaching this function unexpectedly.

**Instances**:
- `packages/wallet-core/src/jobs/types.ts:27,34,37-39` (canonical, underused by these 2 sites)
- `apps/extension/src/utils/in-flight-send.ts:18` (re-enumeration)
- `apps/extension/src/utils/card-subtitle.ts:14-33` (re-enumeration via switch cases)

---

## Non-findings

- **`utils/files.ts` as a "grab-bag" of download/picker + gzip + MIME concerns** (flagged as a candidate by the repo map). Rejected: `downloadFile`/`pickFile` directly call `compressData`/`decompressData` and `resolveMime`/`getExtension` in the same file for the same backup-export/import feature — this is cohesive by actual data flow, not an incidental grouping under a generic name. No duplication or coupling cost found.
- **`utils/general.ts`'s theme-hint + `debounce` pairing** (flagged as minor by the repo map). Rejected: 30 LOC, no shared state, no duplication elsewhere of either export — too small for a "could be split" observation to have real future-change cost.
- **`utils/index.ts` partial barrel (re-exports only `files.ts` + `string.ts`)**. Considered as a possible Middle Man / inconsistent-convention smell. Rejected as a finding: it doesn't duplicate logic or add coupling — it's an inconsistent import-style convention (`@/utils` barrel vs. direct path), which the audit's DO-NOT-FLAG list excludes ("consistent repo conventions" / naming-only observations without duplication cost).
- **The repo map's broad candidate C — 5 files (`journal-state.ts`, `card-subtitle.ts`, `primary-method.ts`, `tx-enrichment.ts`, `activity-rows.ts`) as one duplicated "activity display" domain.** Read all 5 in full: each has a distinct, non-overlapping sub-problem (terminal-state display / in-flight stage copy / fee-call filtering / method-name + tx-category labeling / cross-source feed merge), each carries an explicit "why separate" doc comment, and `activity-rows.ts` + `tx-enrichment.ts`'s docstrings cite prior anti-duplication extractions (codex/opus audit M3, backward-compat re-export). This is legitimate modularization, not duplication — narrowed down to the concrete, real duplication that *is* present inside `journal-state.ts` (Finding 4) and between `card-subtitle.ts`/`in-flight-send.ts` and wallet-core (Finding 5) instead of flagging the file-level grouping itself.
- **`e2e/*` gate pairs** (`proof-gate.ts`/`chrome-storage-proof-gate.ts`, `incoming-poll-gate.ts`/`chrome-storage-incoming-poll-gate.ts`). Confirmed non-duplicative: deliberate port/adapter split, each side has genuinely distinct content (pure interface vs. `chrome.storage.session`-backed implementation).
- **`wallet/utils/index.ts`, `wallet/base/index.ts`, `wallet/logger/index.ts`, `wallet/storage/index.ts` re-export shims over `@nulo/wallet-core/*`**. Confirmed non-duplicative: thin re-exports, evidence of prior dedup (the packages were extracted from these locations), not new duplication.
- **`utils/storage.ts` vs. `wallet/storage/index.ts`**. Confirmed non-overlapping: the former is the sole `chrome.storage.local` migration-aware facade; the latter re-exports the distinct `EntityStorage`/`ValueStorage` primitives. No wrapper duplication.
- **`ConfigStore` vs. `LoggerStore` structural similarity** (both wrap a storage layer + `EventHandler` + level/validation logic). Considered and rejected: they persist through deliberately different layers for deliberately different reasons (`ConfigStore` → durable `ValueStorage`/`chrome.storage.local` via the migration-aware facade; `LoggerStore` → raw `chrome.storage.session`, explicitly out of migration scope per project convention for ephemeral data) — not a duplicate pattern, an appropriately different one.
- **`guarded-network-activation.ts` vs. `in-flight-send.ts`** (both are "guard" utilities gating an action). Read both in full: one is an async serialization queue (activation admits/commits/reconciles through a promise tail), the other is a synchronous predicate over journal records. Different shapes solving different problems; no shared logic to extract.
- **`wallet/utils/fn.ts`'s `Fn`/`ViewFn` wrapper classes** vs. any other call-wrapper in scope. No second implementation found in scope; not a duplicate.
