# audit-fixes-v2 — slim plan (post-split)

> Tier: `/plan deep` ceremony complete (3 parallel drafts + 2 audit
> rounds + 2 final-pass rounds, all transcripts preserved). After the
> 4th codex Reject revealed the trust-state-machine concurrency work
> needed its own planning slate, scope was SPLIT. This plan is the
> shippable slice: user-QA-flagged bugs + audit findings that are
> independently safe + tactical (good-enough, non-bulletproof) fixes
> for C1/C2.
>
> **Deferred to a separate arc** (e.g. `trust-state-machine-hardening`):
> the full reconcileTrust mutex design, scanContract orphan-sweep,
> setUserAddTrustHandler architecture, cross-profile collision fix,
> rapid-profile-switch cancellation guards. Out of scope here.

## What this PR ships (13 phases)

```
P1   ─ fees.vue copy (A1-A4)                              [copy]      ▒ ✓
P2   ─ method label "Claim Fee Juice" (D1)                [copy]      ▒ ✓
P3   ─ aria-controls conditional + v-show                 [a11y]      ▒ ✓
P4a  ─ C2 popup-reopen failing repro e2e                  [test]      ▒ ✓
P5   ─ onTransactionAdded per-hash + account filter       [bug-fix]   ▒▒ ✓
P6   ─ PopupManager visibility seed + onUnmount cleanup   [bug-fix]   ▒▒ ✓
P7   ─ Tactical C1: NewTokenPopup auto-setTrustAllow      [bug-fix]   ▒▒ ✓
P8   ─ Tactical C2: one-shot replay on triple-ready       [bug-fix]   ▒▒ ✓
P9   ─ B2 categorical label helper                        [util]      ▒ ✓
P10  ─ B1 brutalist restructure of journal/[id].vue       [ui]        ▒▒▒ ✓
P11  ─ E1 identity-scoped consumer rehydration            [bug-fix]   ▒▒▒ ✓
P12  ─ Test pin backfill                                  [test]      ▒ ✓
P13  ─ Manual QA + lessons + PR rollback matrix           [docs]      ▒ ✓
```

Risk: ▒ trivial · ▒▒ moderate · ▒▒▒ substantial

**Rollback units**: every phase is independently revertable. P10
depends on P9 (helper); reverting P9 requires reverting P10 or
stubbing the helper inline.

---

### P1 — fees.vue copy (A1-A4)

**File**: `packages/extension/src/onboarding/pages/fees.vue`.

**Ships**:
- A1. Strip em-dashes. Default: in-place substitution; rewrite the
  sentence only if substitution leaves the cadence broken. *Pending
  user sign-off pre-squash.*
- A2. Private fee juice = separate asset, not "fee juice held privately".
- A3. Fee juice is L2-only; obtained only by burning $AZTEC on L1
  (which transforms to L2 fee juice).
- A4. Note that neither flavor is transferable (currently).

**Tests**: none. The onboarding e2e covers route navigation; copy
assertions would just churn.

**Risk**: trivial.

**Deps**: none.

**Commit**: `fix(onboarding-fees): copy corrections per QA`

### P2 — method label "Claim Fee Juice" (D1)

**Files**:
- `packages/extension/src/utils/tx-enrichment.ts` — add
  `claim_and_end_setup: "Claim Fee Juice"` to `METHOD_LABELS`.
- `packages/extension/src/utils/tx-enrichment.test.ts` — one pin.

**Ships**: one-line allowlist addition. `humanizeMethodName` already
routes through `METHOD_LABELS`; `getMethodLabel` returns `null` for
unknowns so the addition is purely additive.

**Tests**: pin `humanizeMethodName("claim_and_end_setup") === "Claim Fee Juice"`.

**Risk**: trivial. Verified `claim_and_end_setup` is NOT in
`FEE_METHODS` (`primary-method.ts:13`) → surfaces as primary method.

**Deps**: none.

**Commit**: `fix(tx-enrichment): humanize claim_and_end_setup as "Claim Fee Juice"`

### P3 — aria-controls conditional emission + v-show (codex Low)

**Files**:
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue`.
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.test.ts`.

**Ships**:
- Switch `v-if="expanded"` on the full-address row to `v-show`.
- Only emit `aria-controls="incoming-trust-contract-full"` when
  `expanded === true` (template binding to `undefined` when collapsed).
- Two-prong fix per opus H-5 / APG note: satisfies ARIA 1.2 (no
  dangling controls reference) AND WCAG SC 4.1.2 (no focused-on-hidden
  element).

**Tests**: update default-state + collapse cases. Use `isVisible()`
instead of `exists() === false`. Pin that `aria-controls` is absent
when collapsed + resolves when expanded.

**Risk**: trivial.

**Deps**: none.

**Commit**: `fix(incoming-trust): conditional aria-controls + v-show on full address`

### P4a — C2 popup-reopen failing repro e2e

**File**: `packages/extension/tests/e2e/network/incoming-transfers.test.ts`
(new test case).

**Ships**:
1. Register profile + pre-seed a contract in `pending` trust state via
   a test helper that writes the repo directly (deterministic; avoids
   the network-seeded-note flakiness opus M-3 flagged).
2. Open popup → assert trust prompt fires.
3. Close popup window (via `chrome.action.openPopup` toggle).
4. Re-open popup → **assert trust prompt re-fires within 3 seconds**.

**Why this lands as its own phase BEFORE P8**: codex H-1 (earlier
round) — if we ship P8 before capturing the failing test, P8 could
mask the bug without us noticing. The test stays as the regression
pin AFTER P8 lands.

**Diagnostic logging**: `logDebug` at each guard return in
PopupManager.vue + IncomingTransferService.replayPendingPrompts so
the failing test reveals which guard short-circuited.

**Tests**: the test IS the deliverable. This test FAILS on current
`dev`; P8 makes it pass.

**Risk**: low. Test-only.

**Deps**: none.

**Commit**: `test(e2e): repro C2 popup-reopen trust-prompt loss (expected to fail)`

### P5 — onTransactionAdded per-hash + account filter (codex Med #2)

**Files**:
- `packages/extension/src/wallet/services/incoming-transfer/service.ts`.
- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`.

**Ships** (TWO changes):
1. **Per-hash reentrancy guard**:
   ```ts
   private readonly txDeleteInflight = new Set<string>()
   private onTransactionAdded = async (tx: Tx): Promise<void> => {
     const key = `${tx.account}|${tx.hash}`
     if (this.txDeleteInflight.has(key)) return
     this.txDeleteInflight.add(key)
     try {
       // ... existing logic, with the account filter from #2 ...
     } finally {
       this.txDeleteInflight.delete(key)
     }
   }
   ```
2. **Account filter on the delete loop**:
   ```ts
   const matches = await this.repo.listByTxHash(profile.id, network.id, tx.hash)
   for (const record of matches) {
     if (record.accountAddress !== tx.account) continue  // NEW
     await this.repo.deleteRecord(record.siloedNullifier)
     this.emit("onIncomingTransferDeleted", record)
   }
   ```

**Why**: codex Med #2 (the prior arc's post-impl audit) +
codex/opus C-3 from this arc's first round. Two same-hash invocations
both observing the same `listByTxHash` result before either delete
completes → double Deleted emit. Account filter prevents deleting
B's records when only A's tx came in (rare, but possible under
split-fee/sponsored flows).

**Tests**:
- Fire two same-hash events → exactly one Delete emit.
- Different hashes → both fire normally.
- Account A's record + account B's record with same txHash; fire
  `onTransactionAdded` with `tx.account = A` → only A's record
  deleted; B's untouched.

**Risk**: moderate.

**Deps**: none.

**Commit**: `fix(incoming): per-hash reentrancy + account-filter on onTransactionAdded`

### P6 — PopupManager visibility seed-before-listen + onUnmount deregister (codex Med #1)

**Files**:
- `packages/extension/src/popup/components/popups/PopupManager.vue`.
- `packages/extension/src/popup/components/popups/PopupManager.test.ts`.

**Ships** (THREE changes per the v2 + v3 audit findings combined):
1. Move `configService.onUpdate.add(onConfigUpdate)` from module-top
   into `onMounted` AFTER both `connect()` and
   `getValue("incomingTransfersVisible")` complete.
2. Add a `let initialized = false` belt-and-suspenders gate; the
   handler ignores events while `!initialized`.
3. **Explicit deregistration** in `onBeforeUnmount`:
   `configService.onUpdate.remove(onConfigUpdate)`. Prevents listener
   accumulation across popup mount/unmount cycles (opus H-6).

**Tests**:
- Fire OFF→ON event AFTER mount init completes → `replayPendingPrompts`
  called once with active triple.
- Same event during init (before seed `getValue` resolves) → NOT
  called (gate works).
- Mount → unmount → mount, fire OFF→ON → `replayPendingPrompts`
  called exactly once (no listener leak).

**Risk**: moderate.

**Deps**: none.

**Commit**: `fix(popup-manager): seed visibility before subscribing + deregister on unmount`

### P7 — Tactical C1: NewTokenPopup auto-setTrustAllow after addToken

**Files**:
- `packages/extension/src/popup/components/popups/NewTokenPopup.vue`.
- `packages/extension/src/popup/components/popups/NewTokenPopup.test.ts`.

**Ships**: After the successful `tokenService.addToken(...)` call at
line 201 (and verifying chain match), invoke
`incomingTransferService.setTrustAllow(submittingProfileId,
submittingNetworkId, parsingResult.contract)`. Catch errors locally
— don't fail the add if trust setting fails.

**Why tactical (vs the full setUserAddTrustHandler architecture from
v3)**: the full architecture had startup-ordering holes (codex H-4 in
v3 audit). The tactical fix lives in the popup itself and races the
scheduler's immediate-poll. Race window: ~30 seconds (poll interval).
For a user who manually added a token, the `setTrustAllow` call
typically completes in &lt;100ms — well inside the 30s window.

**Race exposure** (documented limitation):
- If `addToken` triggers an `onTokenAdded` emit that synchronously
  fires the scheduler's immediate poll AND that poll discovers a note
  AND processes the trust state read BEFORE the popup's
  `setTrustAllow` completes, the user could see a Pending prompt for
  a token they just added.
- In practice this is extremely unlikely: the scheduler's poll
  initiates an async chain (PXE call, note decoding) that takes
  &gt;100ms; the popup's setTrustAllow is a sub-100ms repo write +
  emit.
- **The full fix is in the deferred trust-state-machine arc**. This
  tactical is good-enough for the user's reported QA scenario.

**Security**: `setTrustAllow` here ONLY fires from the popup. dApp-
driven `register_token` flows through a different code path
(`execution/service.ts:1090`) with `origin: "dapp"`. No bypass.

**Tests**:
- Success: addToken succeeds → setTrustAllow called once with the
  right triple → toast "Token added".
- Trust-set failure: addToken succeeds, setTrustAllow throws →
  popup still closes with "Token added" toast (best-effort).
- Negative: addToken throws → setTrustAllow NOT called.
- Adversarial: simulate dApp register_token → setTrustAllow NOT
  called (because it lives in NewTokenPopup, not in addToken).

**Risk**: moderate. Tactical with documented race.

**Deps**: none.

**Commit**: `fix(new-token-popup): auto-trust user-added contracts via setTrustAllow`

### P8 — Tactical C2: one-shot replay on triple-ready (closes P4a)

**Files**:
- `packages/extension/src/popup/components/popups/PopupManager.vue`.
- `packages/extension/src/popup/components/popups/PopupManager.test.ts`.

**Ships**: a watcher on the granular appStore triple
(`appStore.profile?.id, appStore.network?.id, appStore.account?.address`)
that fires `replayPendingPrompts` ONCE when the triple becomes
truthy after mount.

```ts
let replayedForKey: string | null = null
async function tryReplay(): Promise<void> {
  const pid = appStore.profile?.id
  const nid = appStore.network?.id
  const addr = appStore.account?.address
  if (!pid || !nid || !addr) return
  const key = `${pid}|${nid}|${addr}`
  if (replayedForKey === key) return  // idempotency
  replayedForKey = key
  try {
    await incomingTransferService.replayPendingPrompts(pid, nid, addr)
  } catch {
    replayedForKey = null  // allow retry on transient error
  }
}

incomingTransferService.onConnected.add(tryReplay)
const unwatchTriple = watch(
  () => [appStore.profile?.id, appStore.network?.id, appStore.account?.address] as const,
  () => tryReplay(),
  { immediate: false },
)

onBeforeUnmount(() => {
  unwatchTriple()
  // ... existing cleanup ...
})
```

**Why tactical**: the v3 design added cancellation guards (AbortController,
sequence counters) to handle rapid profile switching. v3 was rejected
because the guard left races on rapid-switch. This tactical version
keys idempotency on the triple itself — a profile switch IS a new
triple, so replay fires for it. Stale resolves can still happen if
the user switches profiles WHILE a replay is in flight; the popup
queue's existing triple-dedup absorbs the worst case (replays for the
old profile would enqueue stale payloads that get spliced when the
trust state moves).

**Race exposure** (documented):
- If user rapidly switches profile A → B → A, a stale replay from B's
  call could resolve after we're back on A. The PopupManager's
  `pendingTrustQueue` is triple-keyed, so B's payloads would be
  enqueued but never opened (no popup for B's triple while on A).
  Eventual cleanup happens on the next A-trigger.
- **The full fix (AbortController + sequence counter) is deferred**.
- This tactical closes the user's reported QA scenario (close popup →
  reopen → prompt re-fires).

**Tests** (P4a passes after this):
- Mount with appStore triple unset → fire `onConnected` →
  `replayPendingPrompts` NOT called.
- Then populate the triple → called once.
- Two consecutive triple updates with same key → called once (not
  twice).
- Profile switch (new triple) → called again for the new triple.
- Unmount before triple resolves → watcher deregistered (no replay
  fires after unmount).

**Risk**: moderate. Tactical with documented race.

**Deps**: P4a (the failing repro test) + P6 (visibility race already
fixed; eliminates that as a cofactor).

**Commit**: `fix(popup-manager): replay pending prompts on appStore triple-ready`

### P9 — B2 categorical label helper

**Files**:
- `packages/extension/src/utils/journal-state.ts`.
- `packages/extension/src/utils/journal-state.test.ts`.

**Ships**: a pure helper `categoricalLabel(op: OperationRecord):
{ label: string; context: string }` consuming ONLY wallet-controlled
fields (`op.kind`, `op.error?.kind`, `op.progress.stage`,
`op.progress.txHash`). NEVER reads `op.subtitle` (dApp-controlled).

**Categorization** (proposed; user sign-off pre-squash):

| Condition | Label | Context |
|---|---|---|
| `error.kind === "user_rejected"` | "You rejected" | "You stopped this transaction." |
| `error.kind === "popup_bound"` (terminal-reachable, verify) | "Popup closed early" | "The popup closed before this transaction could finish." |
| `error.kind ∈ {"simulation","prover","stuck_proving","stuck_queued"}` | "Stopped before broadcast" | "Your wallet caught this before reaching the network. Often balance, fees, or invalid call." |
| `error.kind ∈ {"sw_restart_post_prove","stale_on_resume"}` | "Interrupted mid-flight" | "The wallet restarted before confirming this. Transaction may still be on-chain — check the explorer." |
| `error.kind === "network"` | "Network error" | "Couldn't reach the network. The transaction may not have been submitted." |
| `error.kind ∈ {"transfer","dapp_execute"}` | "Reported by app" | "The connected app reported an error." |
| anything else / `"unknown"` | "Error" | "Something went wrong with this transaction." |

**Tests**:
- Exhaustive pins per kind + fallback case.
- **Sanitize-invariance pin**: `categoricalLabel(op with subtitle = "http://evil")`
  returns strings that NEVER contain "evil" — proves the helper
  doesn't accidentally pull from `op.subtitle`.

**Risk**: trivial. Pure helper.

**Deps**: P10 consumes.

**Commit**: `feat(journal-state): categorical failure label helper`

### P10 — B1 brutalist restructure of journal/[id].vue

**Files**:
- `packages/extension/src/popup/pages/journal/[id].vue` (full template +
  style module restructure).
- `packages/extension/src/popup/pages/journal/[id].test.ts` (new).

**Ships**: mirror `tx/[id].vue`'s information hierarchy. **DO NOT
touch `tx/[id].vue`** (user said it looks great).

Structure:
```
SubPageHeader (existing)
└ hero_meta row (timestamps; NO explorer/copy-hash branch — journal
                  records have no chain hash)
└ amount block (existing; only when transfer kind)
└ category chip ("Stopped before broadcast" etc — from P9)
└ origin chip (existing; sanitized via sanitizeJournalSubtitle)
└ details box (NEW — mirrors tx/[id].vue's pattern)
     ├ row: Reason  (existing humanizeErrorKind from prior arc P2)
     ├ row: Times
     └ row: Context (NEW one-line context from categoricalLabel)
└ dev panel (existing; gated by developerMode || debugMode — preserve
              verbatim per user feedback)
```

**Brutalist tokens**:
- Mono labels with 0.12em letter-spacing + uppercase.
- 1px borders with `--nulo-border`.
- `--nulo-surface-low` for elevated sections.
- No rounded corners.
- Match `appearance.vue` + `tx/[id].vue`'s tokens.

**Security guard** (P1 sanitize widening from prior arc must not
regress): the new category chip + context come from the wallet-
controlled `categoricalLabel`. The origin chip stays sanitized via
existing `sanitizeJournalSubtitle`. No new render path for `op.subtitle`.

**Tests** (new file):
- Mount with fixture OperationRecord per error.kind → assert correct
  category chip renders.
- Dev panel renders only with developer/debug mode on.
- Origin chip wraps schemeful subtitles in brackets (existing P1
  behavior preserved).

**Risk**: substantial. 200-300 LoC change. Manual visual review
pre-squash.

**Deps**: P9 (helper).

**Commit**: `feat(journal-detail): brutalist restructure mirroring tx/[id] + categorical failure label`

### P11 — E1 identity-scoped consumer rehydration

**Files**:
- `packages/extension/src/composables/useIdentityScopedFetch.ts` (new).
- 12 consumer files (see table below).
- Component tests per consumer.

**Ships**: a new composable that re-fetches data on identity-triple
change. Includes a sequence-counter guard against stale-response
races (v3 audit found this).

```ts
// composables/useIdentityScopedFetch.ts
import { ref, watch, type Ref } from "vue"
import { useAppStore } from "@/stores/app.store"

export function useIdentityScopedFetch<T>(
  fetch: (profileId: string, networkId: string, address: string) => Promise<T>,
  initial: T,
): { value: Ref<T>; refetch: () => Promise<void> } {
  const appStore = useAppStore()
  const value = ref(initial) as Ref<T>
  let seq = 0
  const refetch = async () => {
    const mySeq = ++seq
    if (!appStore.profile?.id || !appStore.network?.id || !appStore.account?.address) {
      if (mySeq === seq) value.value = initial
      return
    }
    const result = await fetch(appStore.profile.id, appStore.network.id, appStore.account.address)
    if (mySeq === seq) value.value = result  // ignore stale resolves
  }
  watch(
    () => [appStore.profile?.id, appStore.network?.id, appStore.account?.address],
    () => refetch(),
    { immediate: true },
  )
  return { value, refetch }
}
```

The sequence counter ensures only the LATEST fetch's resolve writes
to `value`. Older fetches that resolve after a profile switch are
dropped.

**Consumer inventory + disposition** (per codex H-7, expanded with the
v3-audit-found additions):

| Consumer | Snapshots | Disposition |
|---|---|---|
| `popup/pages/send.vue:350` | tokens, tokenBalances, contacts | Use composable for all three |
| `popup/pages/activity.vue:147` | tokens | Use composable |
| `popup/pages/tx/[id].vue:137` | tokens | Use composable |
| `popup/pages/journal/[id].vue:140` | tokens | Use composable |
| `popup/components/modules/general/RecentActivityView.vue:126` | tokens | Use composable |
| `popup/pages/tokens/[id].vue:116` | tokens, balance | Use composable |
| `popup/components/modules/general/BalanceView.vue:267` | tokens, balances | Use composable |
| `popup/components/modules/general/TokensView.vue:236` | tokens | Use composable |
| `popup/components/popups/SelectBalanceTypePopup.vue:78` | tokens, balances | Use composable |
| `popup/pages/settings/tokens/index.vue:32` | tokens | Use composable |
| `popup/components/popups/NewTokenPopup.vue` | tokens (in show watcher) | Verify; add only if needed |
| `popup/components/popups/SelectTokenPopup.vue` | tokens | Verify; add only if needed |

**Tests**:
- Composable unit tests: sequence counter ignores stale resolves.
- Per-consumer component test: mount → swap profile → assert refetch
  called with new profile's id.
- e2e: unlock profile A → tokens visible. Log out, log into B → tokens
  AND balances visible on Send page (NO token-detail-click required).

**Risk**: substantial. Touches 10+ files. Each consumer must be
audited for what it actually snapshots (verified consumers above; the
"Verify" rows in the table need a quick code check during
implementation).

**Deps**: none. Lands late so any consumer added in P10 also gets
the watcher.

**Commit**: `fix(identity-scoped): refetch token/balance/contact state on profile/network/account change`

### P12 — Test pin backfill

**Files**:
- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`.
- `packages/extension/src/popup/components/modules/general/RecentActivityView.test.ts` (new).
- e2e regression tests as needed.

**Ships**: closes the three test pins codex Low #2 flagged from the
prior arc as "not benign defers" (one already covered by P6).

- **`onAccountAdded → hydrateSchedulers`** pin in service.scenarios.test.ts.
- **`RecentActivityView.connect()` on mount** pin (new test file).
- OFF→ON config replay path — covered by P6's test additions.

Plus phase-local pins from P5, P7, P8 (already noted in their parent
phases) consolidate here for the backfill commit.

**Risk**: trivial (test-only).

**Deps**: P5, P6 (the parent phases for the deferred pins).

**Commit**: `test(arc-v2): pin onAccountAdded + RecentActivityView.connect glue`

### P13 — Manual QA + lessons + PR rollback matrix

**Files**: lessons + PR description.

**Manual QA matrix** (every row pre-squash):

| QA area | Verify |
|---|---|
| F1 onboarding | StepIndicator widths, fees.vue copy, /learn-skip /fees-skip both → /accelerator |
| F2 incoming | First-receive popup, multi-contract queue, USDC-twin (cross-network), C1 auto-trust on add (P7), C2 popup reopen recovery (P8) |
| F3 cancelled detail | Brutalist match, dev mode raw error preserved, every category chip variant from P9 table |
| F4 tx-card name | "Claim Fee Juice" displays correctly |
| Settings toggle | Visibility OFF → no popup; toggle ON → no event leak (P6 fix) |
| Profile switch | A → B → Send shows tokens AND balances AND contacts immediately. Same for Activity, History, RecentActivityView, BalanceView, TokensView, SelectBalanceTypePopup, settings/tokens, tokens/[id]. |
| Profile delete | Records + trust wiped; other profile unaffected |
| Account add/delete | Scheduler hydrates / tears down (P12 pin) |

**Residual risks documented** (PR description):
- **C1 race**: scheduler poll could beat the popup's `setTrustAllow`
  (very unlikely; ~100ms vs 30s polling).
- **C2 rapid-switch race**: replay for an old profile could enqueue
  payloads after profile switch (absorbed by queue triple-dedup).
- **Full trust-state-machine concurrency** (mutex, scanContract race,
  cross-profile isolation, journal hook): deferred to a separate arc.
- **Multi-window popup duplicate**: out of scope.

**User sign-off required pre-squash**:
- A1 em-dash strategy (in-place substitute vs sentence rewrite).
- P9 categorical copy table.
- P10 brutalist visual review (screenshot).

**Risk**: none.

**Deps**: all phases complete.

**Commit**: `chore(audit-fixes-v2): per-phase lessons + PR rollback matrix + QA report`

---

## Security & Adversarial Considerations

### What this arc fixes
- **Account filter on delete paths** (P5): prevents cross-account
  record deletion under same-hash collisions.
- **Visibility race** (P6): closes the OFF→ON replay-suppression hole.
- **Listener leak** (P6): no listener accumulation across popup
  mount/unmount cycles.
- **C1 popup-add prompt** (P7): manual token-add no longer prompts
  for trust on first receive (tactical).
- **C2 popup-reopen recovery** (P8): pending prompts re-surface
  after close + reopen (tactical).
- **B1/B2 sanitize boundary** (P9/P10): new categorical chip uses
  only wallet-controlled fields; explicit pin.
- **Profile-switch token list** (P11): stale-response race closed via
  sequence counter in composable.

### What this arc does NOT fix (deferred)
- **Self-note PXE race** (codex High from prior arc post-impl): user
  can still receive a Pending prompt for their own outgoing note if
  PXE delivers before journal/tx-added events fire. Documented
  residual.
- **Concurrent setTrustAllow vs reconcile race**: no mutex; first-write
  wins. Acceptable for current UX (user click is a single event).
- **scanContract trustState cache race**: same as above. The 30s
  polling interval limits exposure.
- **Cross-profile address collision via mnemonic-import**: documented
  residual.
- **Rapid profile-switch popup replay**: tactical idempotency-key in
  P8 absorbs the worst case (stale enqueues) but does not cancel.

These get a focused planning session in a separate arc.

## Assumptions (final)

### Facts (verified)
- All facts from prior audit rounds verified at source. See
  `audit-codex.md`, `audit-opus.md`, `audit-codex-final.md`,
  `audit-codex-final-v3.md` for citations.

### Asks (open decisions)
- A1 em-dash strategy: substitute in place (default) or rewrite
  sentences?
- P9 categorical copy: user sign-off pre-squash on the proposed table.
- P10 brutalist visual review: screenshot before squash.
- Trust-state-machine deferred work: confirm scoping to a separate arc.

## Seeds

### /goal (primary)

```
/goal All 13 phases marked ✓ in implementations-plan/onboarding-fees-history-arc/audit-fixes-v2/plan.md; per phase the agent has printed `LESSONS_FILE=implementations-plan/onboarding-fees-history-arc/audit-fixes-v2/lessons/phase-N.md` in the transcript; `/code-review max --fix` complete with findings applied and committed; codex post-impl audit complete with high/critical findings addressed (re-audit if Reject); `bun run typecheck`, `bun run lint`, and `bunx vitest run` (run from packages/extension) all report exit 0 in the transcript.
```

### /loop (fallback)

```
/loop Each turn, in priority order:
1. **Inspect**: read implementations-plan/onboarding-fees-history-arc/audit-fixes-v2/plan.md and lessons/ as source-of-truth for phase status; run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup`. If pushed without PR but CI is configured, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **CI in flight on HEAD SHA?** Stream with `gh run watch <run-id>` for up to 10 minutes. Skip if no CI.
3. **Failed check?** Triage and fix; call `/codex xhigh` for non-trivial decisions. Commit (small, conventional) and push. After 5 failures on the same step, stop and reassess.
4. **In-flight phase green?** Mark ✓ in plan.md, file lessons log, print `LESSONS_FILE=implementations-plan/onboarding-fees-history-arc/audit-fixes-v2/lessons/phase-N.md`, advance to next pending phase.
5. **Nothing in flight?** Pick the next pending phase from plan.md and execute (edit → `bun run lint` → `bunx vitest run` → commit → push).
6. **All phases ✓?** `/code-review max --fix` → skim → commit → `/codex xhigh` post-impl audit with adversarial / security ask → address high/critical → if Reject again, diff against prior audit + surface to user. Stop.

Discipline: repo artifacts (plan.md, lessons/, git) authoritative. Call codex on architecture / scope / risk decisions. Never merge to main or release branches; never publish or deploy. Stop when all phases ✓, /code-review max --fix applied and committed, codex post-impl audit clean (or findings addressed). If merge or release is the next step, surface and stop.
```
