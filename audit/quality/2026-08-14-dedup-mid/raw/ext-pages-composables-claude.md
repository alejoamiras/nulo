# Quality scan — ext-pages-composables (Claude)

Scope: `apps/extension/src/popup/pages/**`, `apps/extension/src/composables/**`, `apps/extension/src/stores/**`. Focus: duplication (Duplicate Code, Shotgun Surgery, Divergent Change, Dead Code weighted highest).

## Finding 1 — Byte-identical clipboard-scrub logic duplicated across the two secret-reveal export pages

**Smell**: Duplicate Code (Dispensables).

**Impact bucket**: structural. Blast radius: 2 files, but the duplicated logic is security-sensitive (secret-clipboard hygiene) and every future change to the scrub policy (timing, rationale, opt-out) must be made twice or drifts silently. Change frequency: low by commit count (`git log --follow` on these two files shows no touches beyond their creation in the visible history), which is exactly the risk — infrequently-touched security logic is the kind that's easy to update in one copy and forget the other next time it's touched.

**Evidence**:
- `apps/extension/src/popup/pages/settings/security/export/key.vue:76-96` — the full "F-14" comment block, `const CLIPBOARD_CLEAR_MS = 60_000`, `let clipboardClearTimer`, `const isCopied = ref(false)`, and `handleCopy` (`clearTimeout` + scheduled `writeText("")` + 2500ms `isCopied` reset).
- `apps/extension/src/popup/pages/settings/security/export/key.vue:109-120` — `onBeforeUnmount` with the "Intentionally do NOT clear `clipboardClearTimer`…" rationale comment, word-for-word.
- `apps/extension/src/popup/pages/settings/security/export/seed.vue:66-86` — the same F-14 comment, the same `CLIPBOARD_CLEAR_MS = 60_000`, the same timer/isCopied declarations, and a `handleCopy` that is identical except it copies `phrase.value` instead of a keyed private/public value.
- `apps/extension/src/popup/pages/settings/security/export/seed.vue:99-109` — the same `onBeforeUnmount` rationale comment, verbatim.

Only the copied value differs (`key.vue` branches on `"private"`/`"public"`; `seed.vue` always copies `phrase.value`). `full.vue` (`apps/extension/src/popup/pages/settings/security/export/full.vue`) does not implement this pattern (it has no clipboard-copy path), so this is a 2-instance duplicate, not 3.

**Why it harms future change**: this is the wallet's private-key/seed-phrase clipboard-hygiene control. If the scrub window, the "don't clear on unmount" rationale, or the scrub trigger condition ever needs a security fix (e.g. shortening `CLIPBOARD_CLEAR_MS`, or adding a `clipboardRead`-gated equals-check), a reviewer has to know to apply it in both files — miss one and the two secret-export flows silently diverge in their security posture, with no test or type system flagging the gap.

**Smallest safe refactoring**: Extract Function — pull `CLIPBOARD_CLEAR_MS`, the scrub-timer state, and `handleCopy`'s scrub scheduling into a small composable (e.g. `useSecretClipboardCopy(getValue: () => string, toastLabel: string)` in `src/composables/`, colocated `.test.ts`). Both pages call it and pass their own toast label; the F-14 rationale comment and the `onBeforeUnmount` non-clear comment move into the composable's single definition. Removes ~35 duplicated lines (incl. two multi-paragraph comments) down to one canonical implementation.

**Instances**: `key.vue:76-96`, `key.vue:109-120`, `seed.vue:66-86`, `seed.vue:99-109`.

---

## Finding 2 — `useFeeEstimation` and `useFeeEstimationMap` reimplement the identical cancel/debounce/handoff state machine twice, and have already required parallel hand-edits

**Smell**: Duplicate Code, compounded by Shotgun Surgery (a single behavioral change requires editing both files in lockstep — proven by git history, not hypothetical).

**Impact bucket**: architectural. Blast radius: 2 files (`useFeeEstimation.ts`, `useFeeEstimationMap.ts`), but both sit on the fee-estimation hot path consumed by `send.vue` and the dApp-approval execute windows. Change frequency: high — both files were edited in the *same two commits*, six days apart, each shipping one conceptual feature:
- `5f115286` (`feat(execution): cancellable fee estimates, capped admission + sync-debug rpc removal (#347)`) — touched `useFeeEstimation.ts` (+64/-… ) and `useFeeEstimationMap.ts` (+67/-…) to add cancellation, in the same commit.
- `204f2bf4` (`feat(execution): dapp estimate-to-confirm reuse for standard aztec_sendTx (#349)`) — touched both files again (+5 / +35) for the ownership-handoff feature.

This is Shotgun Surgery observed in the wild, not inferred: the same feature required the same state-machine edit applied twice, by hand, twice in a row.

**Evidence**: both files implement the identical algorithm — debounce-then-fire, a monotonically increasing counter to invalidate stale in-flight promises, an `inflight`/`completed` token pair, a `cancelRemote` fire-and-forget call for tokens that actually started, a `handedOff` set to disarm cancellation on submit, and `dispose`/`onScopeDispose` — once scalar (`useFeeEstimation.ts`) and once re-keyed by `Map<TKey, …>` (`useFeeEstimationMap.ts`):
- `apps/extension/src/composables/useFeeEstimation.ts:70-75` (`clearTimer`) ↔ `apps/extension/src/composables/useFeeEstimationMap.ts:73-79` (`clearTimerFor`) — same logic, Map-indexed.
- `useFeeEstimation.ts:78-85` (`cancelOwnedRemote`) ↔ `useFeeEstimationMap.ts:82-90` (`cancelOwnedRemoteFor`) — same token-collection-and-cancel logic.
- `useFeeEstimation.ts:87-94` (`cancel`) ↔ `useFeeEstimationMap.ts:92-99` (`cancel(key)`) — same body.
- `useFeeEstimation.ts:96-129` (`schedule`) ↔ `useFeeEstimationMap.ts:106-141` (`schedule(key, params)`) — same try/catch/finally shape, same stale-counter guard, same `cancelRemote` call on transport failure.
- `useFeeEstimation.ts:131-135` (`handoff`) ↔ `useFeeEstimationMap.ts:143-150` (`handoffAll`) — same disarm-and-return-token logic.
- `useFeeEstimationMap.ts:128-129` contains an explicit code comment cross-referencing the other file — `"// See useFeeEstimation: a transport failure must not orphan the SW-side runner + its stash."` — the duplication is not accidental, it is a known, hand-maintained invariant that has to be kept in sync by the author reading the comment.

**Why it harms future change**: every future change to the estimate lifecycle (cancellation semantics, new failure mode, a new field on the handoff token) has now twice required identical logic to be written once per file, verified by two real commits. The next such change carries the same risk: a fix applied to the scalar version and forgotten in the Map version (or vice versa) ships a behavioral split between `send.vue`'s single estimate and the multi-op execute window's per-op estimates with no compiler or test forcing parity.

**Smallest safe refactoring**: the Map-keyed version already generalizes over the scalar case (a single-slot estimator is a map with exactly one key). Extract Function/Inline: keep `useFeeEstimationMap` as the one canonical state-machine implementation, and reimplement `useFeeEstimation` as a thin wrapper that calls `useFeeEstimationMap` with one fixed sentinel key and unwraps the `Record` accessors (`results.value[SENTINEL]` → `result`, etc.). This deletes the entire duplicate ~90-line state machine from `useFeeEstimation.ts`, leaving exactly one place where the cancel/debounce/handoff logic lives.

**Instances**: `useFeeEstimation.ts:70-148` (whole state machine) duplicated against `useFeeEstimationMap.ts:73-169` (whole state machine); co-change evidence at commits `5f115286` and `204f2bf4`.

---

## Finding 3 — Two of the four account-state subpages hand-roll the fetch/loading/error lifecycle that `useEntityCrud` already exists to provide, and both sibling pairs duplicate the same watch/mount/unmount triad

**Smell**: Duplicate Code, with a Divergent Change angle — the same conceptual "fetch this account-scoped list" behavior is implemented two different ways in the same directory, so a future change to that behavior (e.g. add retry-on-network-change, or add an `added`/`deleted` live-update path) has to be reasoned about and applied differently depending on which of the four files you're touching.

**Impact bucket**: structural. Blast radius: 4 files, all siblings under `settings/advanced/account-state/`. Change frequency: `git log` shows 3 commits touching this directory in the last 90 days — moderate, active enough that the inconsistency will keep being copy-pasted forward rather than converging.

**Evidence** — the composable-adoption split:
- `apps/extension/src/popup/pages/settings/advanced/account-state/authwits/index.vue:40-53` uses `useEntityCrud({ fetch, added, deleted, identity })` from `apps/extension/src/composables/useEntityCrud.ts`.
- `apps/extension/src/popup/pages/settings/advanced/account-state/senders/index.vue:34-44` also uses `useEntityCrud({ fetch, added, deleted, identity })`.
- `apps/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:51,55-56,111-131` hand-rolls the identical shape by hand instead: `const notes = ref([])`, `const isFetchingNotes = ref(false)`, `const error = ref()`, and an async `fetchNotes` with a manual try/catch/finally that sets `isFetchingNotes`/`error`/`notes` — this is `useEntityCrud`'s `refresh()` body, reimplemented, minus the `added`/`deleted` event wiring.
- `apps/extension/src/popup/pages/settings/advanced/account-state/contracts/index.vue:24,29-43` does the same: `const contracts = ref([])`, `const isFetchingContracts = ref(false)`, `const error = ref()`, and an async `fetchContracts` with the same manual try/catch/finally shape.

**Evidence** — the watch/mount/unmount triad repeated across all four (independent of which fetch strategy each uses):
- `authwits/index.vue:103-109` (`watch(() => appStore.account, …)`), `:111-115` (`onMounted` guard `if (appStore.account && appStore.isLogined)`), `:117-121` (`onBeforeUnmount` disconnect).
- `senders/index.vue:72-77` (`watch(() => appStore.network, …)`), `:78-80` (`onBeforeUnmount` disconnect — no mount guard, since senders fetch unconditionally via `useEntityCrud`'s own initial `refresh()`).
- `notes/index.vue:184-189` (`watch(() => appStore.account, …)`), `:191-193` (`onMounted` guard), `:195-197` (`onBeforeUnmount` disconnect).
- `contracts/index.vue:45-50` (`watch(() => appStore.account, …)`), `:52-54` (`onMounted` guard), `:56-58` (`onBeforeUnmount` disconnect).

**Why it harms future change**: a developer fixing a bug in "how account-state lists refetch on account/network change" (e.g. the notes/contracts pages don't have an `added`/`deleted` live-update path that authwits/senders get for free from `useEntityCrud`) has to notice that two of the four siblings are on a different, hand-rolled implementation before they can even scope the fix. The two hand-rolled copies (`notes`, `contracts`) also silently lack the live add/delete event handling that the two `useEntityCrud`-based siblings get, which is a correctness/consistency gap likely invisible until someone diffs the four files side by side, as this audit did.

**Smallest safe refactoring**: Inline the duplicate — migrate `notes/index.vue` and `contracts/index.vue` onto the already-existing, already-proven `useEntityCrud` composable (no new abstraction needed; `authwits/index.vue` and `senders/index.vue` are the reference implementation). This deletes the hand-rolled `ref([])`/`ref(false)`/`ref()`/try-catch-finally block from both files and, as a side effect, gives them the same live-update behavior their siblings already have.

**Instances**: `authwits/index.vue:40-53,103-121`; `senders/index.vue:34-44,72-80`; `notes/index.vue:51,55-56,111-131,184-197`; `contracts/index.vue:24,29-43,45-58`.

---

## Finding 4 — Multi-service-client connect/disconnect wiring is hand-written per page, with an identical 3-client subset duplicated verbatim between two detail pages

**Smell**: Duplicate Code, analog to config sprawl / temporal coupling (the `new XServiceClient()` call and its matching `.disconnect()` are declared far apart in the same file with nothing enforcing that every instantiation has a matching teardown line).

**Impact bucket**: structural. Blast radius: at least 5 pages carry this pattern with 3+ clients each (`activity.vue`, `send.vue`, `received/[id].vue`, `journal/[id].vue`, `tx/[id].vue`), all of them among the largest/most-frequently-touched pages in the cluster (300-700+ LOC each). Change frequency: high — `git log` shows 11 commits touching this file set in the last 90 days.

**Evidence** — the exact same 3-client subset (`tokenService`, `configService`, `priceService`), same names, same order, in both instantiation and teardown:
- `apps/extension/src/popup/pages/tx/[id].vue:52-53,116` (instantiation) and `:159-162` (`onBeforeUnmount` disconnect, same order).
- `apps/extension/src/popup/pages/journal/[id].vue:67-70` (instantiation, plus `journalService`) and `:237-241` (`onBeforeUnmount` disconnect, same order).

**Evidence** — the same pattern scaled up on the other pages (distinct client sets, identical shape: N `new XServiceClient()` declarations, then an `onBeforeUnmount` block that calls `.disconnect()` on each by hand):
- `apps/extension/src/popup/pages/activity.vue:35,39,42,56-58` (6 clients: `transactionService`, `journalService`, `tokenService`, `incomingTransferService`, `configService`, `incomingPriceService`) → `:163-169` (6 manual disconnects).
- `apps/extension/src/popup/pages/send.vue:73,101,158,207,252` (5 clients) → `:493-501` (4 of the 5 disconnected together in `onBeforeUnmount`; `executionService.disconnect()` is called separately at `:361`, inside a different code path, not co-located with the others).
- `apps/extension/src/popup/pages/received/[id].vue:74-78` (5 clients) → `:188-193` (5 manual disconnects).

No shared helper exists for this (`grep` across `src/` for `disconnectAll`/`useServiceClients`/`useClients` returns nothing) despite the pattern recurring identically 5+ times.

**Why it harms future change**: adding a new service client to one of these pages requires two edits that live hundreds of lines apart in a 300-700 LOC file (the `new XServiceClient()` declaration near the top, the `.disconnect()` call in `onBeforeUnmount` near the bottom) with nothing — no lint rule, no type, no test — forcing the second edit to happen. `send.vue` already shows the failure mode in miniature: `executionService`'s disconnect call is not co-located with the other four, so a future page that copies the visible `onBeforeUnmount` block as a template will only pick up 4 of the 5 clients actually in use. This is exactly the resource-leak-by-omission risk class CLAUDE.md's `onBeforeUnmount` ordering rule already warns about for composables — here it recurs at the page level, unfixed.

**Smallest safe refactoring**: Extract Function — a small helper (e.g. `useServiceClients({ token: TokenServiceClient, config: ConfigServiceClient, ... })` or simply `registerForDisconnect(...clients)` called once per `new XServiceClient()` site, backed by `onScopeDispose`) that owns the group and disconnects everything it was given automatically. Removes the N-line manual `onBeforeUnmount` disconnect block from each page and eliminates the class of bug where a newly added client's teardown line is forgotten.

**Instances**: `activity.vue:35,39,42,56-58,163-169`; `send.vue:73,101,158,207,252,361,493-501`; `received/[id].vue:74-78,188-193`; `journal/[id].vue:67-70,237-241`; `tx/[id].vue:52-53,116,159-162`.

---

## Non-findings

- **Repo-map candidate A (settings-page shell duplication, `SubPageHeader` + `:backTo="'/popup/settings'"` + wrapper `Flex`)** — verified the 11 cited pages, but refuted as a *measurable* duplication: the wrapper's `gap` prop already varies across the cited pages (`about.vue` uses `gap="24"`, `tokens/index.vue` uses `gap="16"`, `fpcs/index.vue` uses `gap="20"`), so the pages are not byte-identical and a shared `SettingsSubPage` component would need a `gap` prop from day one — the actual duplicated surface is two lines (`<SubPageHeader title="…" :backTo="'/popup/settings'" />` + an opening `<Flex>` tag), which is boilerplate at or below what the existing `SubPageHeader` convention already requires, not exceeding it.
- **Repo-map candidate B (copy-to-clipboard + toast handler duplicated 8x)** — confirmed real (`about.vue:19-22`, `accounts/index.vue:60-63`, `contacts/index.vue:121-124`, `fpcs/index.vue:70-73`, `connected-apps/[id].vue:131-134`, `tokens/[id].vue:101-104`, `tx/[id].vue:106-109`, `senders/index.vue:46-55`), all doing `window.navigator.clipboard.writeText(x); openToast({ label, icon: "copy" })`. Not written up as a top finding: each instance is a 2-line, no-branching snippet with no shared state or security sensitivity (unlike Finding 1's clipboard-scrub logic), so the future-change cost is low relative to the other four findings — deprioritized per "few findings that matter," not rejected as invalid.
- **Repo-map candidate F (`formatFeeJuice(BigInt(x))` null-guard duplicated in `received/[id].vue` and `tx/[id].vue`)** — confirmed real, and `received/[id].vue:133` even comments "mirrors tx/[id].vue's fee valuation," but the duplicated surface is a single-line null-guard around an already-shared pure helper (`formatFeeJuice` itself lives once in `@/utils/fee-estimation`) — blast radius 2 files, cosmetic impact, not worth its own refactor slot given Findings 1-4.
- **`fullscreenPopupSetting.ts` instantiating + disconnecting its own `ConfigServiceClient`, and `useProfileBootstrap.ts` replacing `managers.network`/`managers.account` internally** — both deviate from the documented C1 rule ("parent owns connect/disconnect"), but each is a single, isolated instance with no duplicate sibling implementing the same deviation elsewhere, and `useProfileBootstrap.ts`'s header comment documents the scope as a deliberate, audited decision ("Codex v2 critique" narrowing). A convention deviation without a second instance to compare against isn't a duplication finding.
- **`useFullBackupImport.ts` at 774 LOC (largest composable by far)** — a plausible Large Class/Long Method candidate, but reading it shows it orchestrates a genuinely large, non-repeating sequence (11 distinct service-client backup calls, checksum, encryption, download) rather than duplicating logic found elsewhere in the cluster; a bloat finding without a duplication angle is out of scope for this run's declared focus.
- **`balances.store.ts` (637 LOC)** — the repo map notes its own doc states it replaced duplicated logic previously split across `FeeSettingsCard`/`GasBalanceCard`. Checked: this is already-remediated duplication, not a live finding.
- **Store-to-store duplication (`app.store.ts`, `activity.store.ts`, `cache.store.ts`, `notification.store.ts`, `popup.store.ts`)** — reviewed for cross-store overlap; each owns a distinct, non-overlapping concern (identity, tx-activity slices, ephemeral cross-page payloads, notification queue, popup UI open-state) with no duplicated state-shape or logic found between them.
