# Phase 2 · Send's result, K-1 and the lock

Built:

- `stores/app.store.ts`: `scopeEpoch` (a plain ref, returned after `bootstrapFailure`);
  `app.store.shape.pins.test.ts` pins it in `STATE_KEYS` and `RETURN_ORDER`.
- `popup/scope-epoch.ts`: `createScopeEpochHandlers({ bumpEpoch, toast, closeToast })` →
  `onScopeChanged` (bump; close a snack that carries an action, keep one without) and `onLocked`
  (bump; close any snack). `scope-epoch.test.ts`: 6 cases (the keep, the close, a lock over an
  action / none / nothing open, A → B → A and lock → unlock ending under a new epoch).
- `popup/app.vue`: the handlers over `appStore.scopeEpoch++` and the shared toast;
  `enterLockedState` calls `onLocked()` right after `popupStore.closeAll()`; a `flush: "sync"`
  multi-source watch on `profile?.id`, `network?.id`, `account?.address` calls `onScopeChanged`
  (a multi-source watch fires only when one of the three ids changes, so an account object
  replaced with the same address, as `updateAccount` does, moves nothing).
- `utils/snack-amount.ts`: `formatSnackAmount(amount, decimals)`, the S-10 rule: the row's
  8-character form when its whole part is the full amount's (the `<0.000001` hint counts as
  keeping its one digit), otherwise the full amount. `snack-amount.test.ts`: 7 cases including
  a whole u128 in full and "1,234,567.890123", whose 8-character form "1,234,56" cuts a whole
  digit.
- `popup/pages/send-submit.ts`: `TransferSnapshot` gains `symbol`, `decimals`, `epoch`;
  `executeTransfer` is `Promise<string>`; `SubmitDeps` gains `isCurrent(epoch)` and
  `viewTransaction(hash)`. Success: "Transaction submitted", sub `{amount} {symbol} to
  {trimAddress(dest, 6, 4, "…")}` with `sanitizeWireString(symbol, 32)`, View only when the hash
  matches `/^0x[0-9a-f]{64}$/i`. Failure: "Send failed", sub `transferFailureCopy(err)`; the log
  line is written before the gate, the snack only when `isCurrent(snap.epoch)`. A cancel stays
  silent. `send-submit.test.ts`: 11 cases with a wire destination (`0x8c02…41fa`), a wire hash
  and 1.5 × 10¹⁸ at 18 decimals; the 9-digit whole amount with a bidi-marked 40-character symbol;
  the malformed hash; lock/scope refusals on success and failure; the A → B → A and
  lock → unlock round trips driven through the real `createScopeEpochHandlers` over a fake store.
- `send.vue`: the snapshot reads `activeToken.value.symbol`/`.decimals` and `appStore.scopeEpoch`;
  `submitDeps.isCurrent = (epoch) => appStore.isLogined && appStore.scopeEpoch === epoch`,
  `viewTransaction = (hash) => router.push(\`/popup/tx/${hash}\`)`. `send.test.ts`: the router
  mock gains `push`; the resolved case asserts the full snack and that View pushes the route; two
  new cases (a lock, a scope change) mid-flight open nothing and still close the port.
- `components/Popup/Popup.vue`: `createFocusTrap([wrapper, #toast], …)` when the anchor exists,
  the wrapper alone otherwise (`trapContainers`); the `aria-hidden` "focus trap dummy" button and
  its comment are gone; the wrapper carries `tabindex="-1"` so the existing `fallbackFocus` is
  focusable. `Popup.test.ts` (mocked trap) asserts both container shapes.
- `Popup.snackbar.test.ts` (real focus-trap, only `@/utils/core` mocked): 6 cases — the whole
  cycle first → second → `snackbar-close` → first and Shift+Tab back to ×; two stacked popups
  cycle only the top one's controls and the snack; × by keyboard closes the snack, keeps the popup
  and returns focus to `second`; Escape on × closes the popup, leaves the snack and returns focus
  to the opener; a popup with no tabbable control focuses its wrapper; without `#toast` the cycle
  is the popup's controls alone.
- `AccountsPopup.vue`: the copy icon gets `data-testid="account-item-copy"`.
- `tests/e2e/snackbar.test.ts`: a fifth case — the accounts popup, the clipboard stubbed to reject,
  the copy icon pressed, "Couldn't copy" as an error; Tab from outside the trap walks the popup's
  controls (never leaving the popup, `focusInPopupOf`) until `snackbar-close`; Enter closes the
  snack, the popup is still there and focus is back inside it.

P2.2, checked by reading (no codex): `ExecutionCoordinator.sendTxTask` awaits
`ctx.recordTransaction(txHash)` before it returns the hash (`execution-coordinator.ts:345`), the
popup subscribes `appStore.onTxAdded` through `initTransactionService` (`useProfileBootstrap.ts:133`,
`auth.vue:188`, `new-profile-helpers.ts:37`), and `tx/[id].vue:62` reads
`appStore.transactions.find(t => t.hash === route.params.id)`, so the record is in the scoped slice
before the snack that links to it can open.

Decisions the plan left open:

1. **The epoch's owner.** The store holds the number; the shell bumps it, since only the shell
   sees the lock (`enterLockedState`) and the scope watch already lives there. The helper is a
   plain factory in `popup/`, like `network-switch.ts`, so app.vue keeps the `watch` and the
   helper stays a unit.
2. **Which watch.** A multi-source `watch([id, id, address])` rather than a getter returning an
   array: Vue compares the sources one by one, so only an id change fires it; a getter returning a
   fresh array fires on any dependency write, including a same-address account object.
3. **The `<0.000001` hint.** S-10 says the 8-character text "when it keeps every whole-number
   digit"; the hint keeps the one it has, so dust reads as the row does rather than as twenty
   characters of zeros.
4. **The failure is logged before the epoch gate**, so a send that fails after a lock still leaves
   its line in the log buffer; only the snack is withheld.
5. **`decimals` is not re-validated on the send path**: the amount was integerised against the
   same token's decimals by `validateSendAmount`, so the formatter cannot throw here; the
   `isValidDecimals` checks the plan names are the coordinator's, the chip's and the incoming
   row's (P4).
6. **"× by keyboard" in jsdom is a focused `.click()`**: jsdom synthesises no click from Enter, and
   a button's Enter activation is a click; the browser half is the smoke case's real Enter.

Failing first:

- `bun run lint` red on the first pass: a comma operator in a `test.each` arrow (rewritten as a
  block) and the new spec's formatting (`biome check --write`).
- `typecheck:all` red once: the real-trap spec imported `useToast` from
  `@nulo/design/composables/toast`, which the extension's TS cannot resolve (the shim's `.d.ts`
  does the same under `skipLibCheck`); it now imports the shim `@/composables/toast`, as
  `ToastManager.test.ts` does.
- The first `test:all` run: P1's own `toast-call-sites.test.ts` refused
  `deps.openToast(submittedSnack(…))` — the scan wants an object literal with a literal kind at
  every call. The call is now the literal, with `sub: submittedSub(snap)` and
  `action: viewAction(deps, hash)` (undefined when the hash is not 32-byte hex); the malformed-hash
  case asserts `action` undefined rather than absent.
- The first full Chrome smoke: 1 failed (`exit=1`, 945 s), the new accounts-popup case.
  `clickByTestId("account-item-copy")` timed out: the copy glyph is an `<Icon>`, an `<svg>`, and
  `SVGElement` has no `.click()`, so the in-page click the helper performs threw inside
  `waitForFunction` and never resolved. The case now presses it with `pointerClick` (a real pointer
  at the centre, which also proves nothing covers it). The targeted rerun passed 5/5; the full rerun
  is the green row below.

Held for the owner (not decided here): nothing new; P1's two items stand.

Traps:

- focus-trap 8.2.2 handles Tab only at a group's edges (`findNextNavNode` returns null in the
  middle of a group and "lets the browser take care of tab"), and jsdom moves no focus on a key.
  A real-trap test therefore supplies the browser's default itself: when the dispatched keydown is
  not `defaultPrevented`, focus the next tabbable in DOM order. Edges (last of the popup → ×, × →
  first of the popup, Shift+Tab from the first) are the trap's and come back `defaultPrevented`.
- tabbable's display check reads `getClientRects().length` on attached nodes; a prototype stub
  returning one rect for connected elements is enough, restored in `afterEach`.
- `Popup.tooltip.test.ts`'s `settle()` (tick, flush, `setTimeout 0`, flush) covers focus-trap's
  delayed activation and its delayed return focus.

Gate:

| command | exit | duration |
|---|---|---|
| `bun run lint` | 0 (second run; the first is above) | 0.5 s (29 warnings, 3 infos, none in changed files) |
| `bun run typecheck:all` | 0 (second run; the first is above) | ~4 min |
| `bun run test:all` | 0 (second run; the first is above) | ~6 min (extension 576 files / 7,241 tests; design 386; extension-messaging 229; landing 40; third-party-notices 66; wallet-bridge 279; wallet-crypto 120; aztec-runtime 249 + 2 skipped) |
| `bun run test:ci-gating` | 0 | 24.4 s (138 pass, 2 skip) |
| `bun run --cwd apps/extension build-storybook` | 0 | ~1 min |
| Chrome: build with the gate's flags, then `NULO_E2E_BROWSER=chrome NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` | 0 (second full run; the first is above) | 961 s (37 files + 3 skipped; 148 passed, 7 skipped) |
| Firefox: the same build and run with `NULO_E2E_BROWSER=firefox` | 0 | 1,137 s (38 files + 2 skipped; 144 passed, 11 skipped) |
