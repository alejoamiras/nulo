# Phase 3 lessons — F3 canceled-tx details + pending-tx polish

## Outcome

`feat(activity): make canceled-tx cards openable; pending-tx page polish` —
typecheck clean, 2020/2027 vitest passing (+6 new `sanitizeJournalSubtitle`
cases). New `popup/pages/journal/[id].vue` route + page; terminal journal
rows on both the History page and the Recent Activity widget now navigate to
`/popup/journal/:id` on click; the tx-detail page hides its explorer-link
surfaces when the transaction hasn't mined yet.

## Files changed

- `utils/journal-state.ts` — added `sanitizeJournalSubtitle(raw)` helper.
  Brackets URL-shaped subtitle values so the UI can never render them as
  links by accident. Defense against a malicious dApp setting its origin
  to something like `"https://evil.com/?steal=secret"` at session-discover
  time.
- `utils/journal-state.test.ts` — added 6 pin cases for the sanitize helper
  (null / plain / https / http / case-insensitive / non-prefix-URL).
- `popup/pages/journal/[id].vue` — NEW. Detail page for terminal journal
  records that ended without producing an on-chain tx. Renders:
    - SubPageHeader with title (humanized method for `dapp_execute`, token
      symbol for `transfer`).
    - Terminal-state badge from `journalTerminalDisplay(op)` (cancelled /
      interrupted / failed) with the canonical icon + color + subtitle.
    - Amount block for `transfer` kind.
    - Sanitized origin chip for `dapp_execute` kind.
    - Categorical `op.error.kind` row (always safe — string enum value).
    - Created + ended timestamps via Luxon.
    - Developer-mode-gated raw error block: BOTH `op.error.message` AND
      `op.error.normalizedRaw` only render when `debugMode || developerMode`
      is on. Same gate the existing `tx/[id].vue:127–133` debug panel uses.
  Subscribes to `journalService.onOperationDeleted`; on a match for the
  current id, redirects to `/popup/activity` with a toast — handles the
  GC / profile-delete race the user can hit by sitting on the detail page.
- `popup/components/modules/activity/TransactionsList.vue` — `handleSelectTx`
  renamed to `handleSelectRow`; routes `journal` rows to
  `/popup/journal/${row.op.id}`. Terminal-card template gets a matching
  `@click` binding.
- `popup/components/modules/general/RecentActivityView.vue` — added
  `handleSelectTerminal(op)` next to the existing `handleSelectTx`. Both
  template renders of `TransactionTerminalCard` (lines 646 + 691 region)
  get `@click="handleSelectTerminal(row.op)"`.
- `popup/pages/tx/[id].vue` — imports `TxStatus`; new `isMined` computed
  mirrors `TransactionCard.vue:63–66`. The hero "View on explorer" link
  and the tx-hash detail-row link are gated on `explorerUrl && isMined`.
  When pending, both fall back to their "Copy hash" v-else branches
  (added a `data-testid="tx-detail-pending-copy-hash"` so future e2e can
  assert the pending fallback surface).

## What I did NOT do (and why)

- **Pending-tx banner**: dropped per plan v2.1 (A15). The existing pending
  status icon on the activity-feed card + the new copy-hash fallback (no
  explorer link until mined) already convey "waiting for inclusion." A
  banner-only-on-the-detail-page would have created surface inconsistency
  vs. activity / RecentActivityView. The standard `TxFeeRow estimated`
  label remains the user-facing "this is the estimate, not the final fee"
  signal.
- **Page-level component test for `journal/[id].vue`**: deferred. The
  pure-function `sanitizeJournalSubtitle` is the load-bearing security
  pin and is fully covered. Visual-state mapping is covered by
  `journalTerminalDisplay` tests. Mounting the full page requires
  stubbing 6+ auto-registered children (SubPageHeader, Icon, Flex,
  service clients via mocks) — fragility outweighs coverage. CLAUDE.md
  L5/L6 component tests are explicitly optional; the e2e smoke is the
  canonical integration coverage.
- **E2E smoke for cancel→detail-page navigation**: not added in this
  commit. Existing cancel flow runs in `tests/e2e/...`; extending it
  to click the terminal card + assert URL is a small follow-up that
  doesn't gate this phase. Logged as TODO.

## What broke during impl (and the fix)

### 1. Accidental edit on the wrong line in `journal-state.test.ts`

Tried to anchor the sanitize-test append by finding the last
`describe` block. First Edit attempt targeted a line in the middle of an
existing test (line ~218 `const props = buildJournalTerminalCardProps(...)`)
and rewrote it as a noop pattern (`const props_unused = ...; const props =
props_unused`). Caught immediately by reading the file diff in the next
turn; reverted.

**Generalisation:** when appending to an existing file, anchor on a
unique end-of-file string (`expect(props).toBeNull()\n\t})\n})` for this
test file), NOT on a frequent-pattern line that may collide with other
tests. Or read the file's tail explicitly first.

## What confirmed working at the end

- `vue-tsc --noEmit` clean.
- 2020/2027 vitest cases pass (was 2014 pre-F3; +6 new `sanitizeJournalSubtitle` cases). 7 todos, no fails.
- The new route loads through the existing `popup/pages/` file-based
  routing convention. `journal/[id].vue` matches the `tx/[id].vue` shape.
- Terminal-card click handlers wired in BOTH the History page and the
  Recent Activity widget. Click hits the right journal id; the page reads
  the record from `OperationJournalServiceClient.getOperation(id)` and
  branches by kind.
- URL-sanitization pin via `sanitizeJournalSubtitle` — `"https://evil.com"`
  bracketed; plain `"uniswap.example"` passes through verbatim.

## Open items for downstream phases

- E2E smoke for cancel→detail page navigation (low priority, doesn't gate F2).
- Try-again affordance on `interrupted` records (plan §8 Q7 — explicit deferral).
