# Recon · copy-polish

Drafted at `48a97f4a` (the head of #718), revised at `85c4d20f` (`dev` after #719), and re-read in
full for the final revision at `0f37ab78`, the top of stack #729, which is what `dev` becomes when
the stack lands. Every line below was read in the file it cites at `0f37ab78`. The em dash
inventory was taken with a read-only AST pass over every non-test, non-story `.ts`, `.js` and
`.vue` file under `apps/extension/src`, `packages/design/src` and
`packages/extension-messaging/src`, plus `packages/aztec-runtime/src/pxe/opfs-store.ts`
(TypeScript's parser for scripts, `@vue/compiler-sfc` for templates: string literals, template
literals, template text, static attributes, interpolations and bound expressions), recording each
hit's enclosing callee. It found 150 literals or text nodes holding "—" in the three original
roots (148 in the first two, 2 in `packages/extension-messaging/src`), the count codex's final pass
re-derived, and 3 in `opfs-store.ts`: 153 in the guard's roots. A first-wave line scanner (local,
not committed) counted 135 at the draft; it reads lines, so it counted comments that continue a
string's line and missed multi-line template text. No test was run for this revision:
`DetailsTable.test.ts` gave 13 passed, 1 todo at `85c4d20f`, and neither it nor `DetailsTable.vue`
changed since (`git diff --stat 85c4d20f 0f37ab78`).

## The 153 hits, by class

| Class | Count | Verdict |
|---|---|---|
| User-visible copy joining two clauses | 43 in `apps/extension/src`, plus `RecoveryModeError.MESSAGE` (`packages/extension-messaging/src/errors.ts:459`) and the PXE store's two errors (`packages/aztec-runtime/src/pxe/opfs-store.ts:58`, `:222`) | change (plan § The string table, E1 to E46) |
| The empty-value glyph, alone or with a unit (`"—"`, `"— FJ"`) | 24 (`SendReviewSheet.vue:53` arrived with the stack) | leave |
| Arguments of a log call (`console.*`, `this.log*`, `logger.log`, `deps.logDebug`, `log.warn`) | 38: 37 in the original roots, and `opfs-store.ts:221` | leave |
| Thrown developer text: an invariant failure, a concurrent deletion, or a failure a screen shows only as constant copy | 24 | leave |
| Text only the developer-mode journal box shows | 6 | leave |
| dApp-facing | `error-envelope.ts:236`, and `DuplicateInitializationError`'s default (`packages/extension-messaging/src/errors.ts:233`) | leave (out of scope) |
| Unreachable today, or reached only by a hostile backup | 4 | leave (Decision ledger) |
| Label joiners, not clauses (`— spender` in `OperationActionRow.vue`) | 4 | leave |
| Generated file headers (`packages/design/src/internal/render-css.ts:20`, `render-tokens.ts:10`) | 2 | leave |
| Log reasons passed to `terminateWith` (`session-established.ts:91`, `:99`, `:107`) | 3 | leave |

The draft counted `account/service.ts:783` as thrown developer text; codex's round-1 audit traced
it to the import's "View Errors" viewer (`restore-rows.ts:28-31` records it,
`full-backup-restore.ts:343` collects it, `full-backup-helpers.ts:322-329` shows it), so it is E44.
The round-1 revision then traced every other thrown leave: a failure inside a send or an execution
reaches the person only through constant copy (`transfer-failure-copy.ts`, the journal contexts in
`journal-state.ts`, the execute window's two fee toasts at `execute/index.vue:154`, `:177`, and the
dApp envelope's unclassified text at `error-envelope.ts:197`); the full export shows only generic
toasts (`export/full.vue:170`, `:268`, `:363`); a profile delete shows E8; the restore fence
(`restore-fence.ts:37`, `:41`) reaches "View Errors" only on a row without a profile id or a profile
deleted mid-restore (Decision ledger). Codex's final pass traced the PXE store's two errors to Add
token (`token/service.ts:657-659`, `:710`; `NewTokenPopup.vue:255`, `:334`), so they are E45 and
E46. The guard matches 86 of the non-log hits: the 46 changes and 40 reviewed leaves
(`materialize.ts:105` splits its dash across a concatenation).

**The log exemption's callee rule, checked over every call in the four roots**: the forms
`console.<method>` and a function or method named `log`, `logDebug`, `logInfo`, `logWarn` or
`logError` exempt the same 37 dash-bearing arguments as before; a method of an object named `log`
matches one call, `opfs-store.ts:221`, and no other; no call has a nested `.log` object
(`this.log.warn`), so the rule's textual and identifier readings classify the same.

**The rest of `packages/aztec-runtime/src`** holds 18 more dash-bearing literals, outside the
guard's roots: 5 log arguments; the node factory's four URL refusals
(`adapters/aztec-node-factory-adapter.ts:79`, `:87`, `:95`, `:107`), unreachable because
`RpcUrlSchema` refuses the same URLs first at every add, update, storage and snapshot boundary
(`apps/extension/src/wallet/services/network/spec.ts:145-177`); profile-generation and purge fences
(`pxe/service.ts:760`, `:840-852`, `:919`; `pxe/lifecycle-coordinator.ts:42`); a dispose failure
(`pxe/chain-runtime.ts:402`); and the CI-only required-mode guard (`:282`,
`apps/extension/src/offscreen/index.ts:89-95`).

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Walk every source file that compiles into the extension | `SCAN_ROOTS` and the file walk in `apps/extension/src/utils/log-payload-ban.test.ts:35-50`, `:458` | **adapt**: the same walk over `apps/extension/src`, `packages/design/src`, `packages/extension-messaging/src` and the one file `packages/aztec-runtime/src/pxe/opfs-store.ts` |
| Parse scripts and templates to find string literals and template text | `typescript` and `@vue/compiler-sfc`, both declared by `apps/extension/package.json` (`:108`, `:96`) | **reuse-as-is**: no new dependency |
| A static source guard with its known false negatives stated in its header | `log-payload-ban.test.ts:8-22`, `storage-facade-ban.test.ts` | **reuse-as-is** (the pattern and its tone) |
| A shrink-only list of accepted exceptions that fails on a stale entry | `scripts/complexity-baseline/manifest.json` and `check.ts` | **adapt** (the idea only): an inline reviewed list in the guard test, with a stale-entry case; no generator, no manifest file |
| Place the snack above a sheet's own footers while the sheet is on top | `vSnackSheet`, `vSnackFooter`, `topSheet`, `useSnackInset` (`apps/extension/src/composables/snackInset.ts:22-58`, `:62-71`, `:125`); `Popup.vue:110` uses `v-snack-sheet`; Continue's row in `components/composite/LegalConsent.vue:92` already carries `v-snack-footer` | **reuse-as-is**: the Terms sheet registers itself and its "Not now" footer |
| Test the inset against a footer's geometry in jsdom | `apps/extension/src/components/ui/ToastManager.test.ts:91-103` (stubbed `clientHeight` and `getBoundingClientRect`) | **reuse-as-is** (the pattern) |
| The snack's layer | `ToastManagerBase.vue:192-199` (`.wrap`, `z-index: 2000`, no pointer events; the card takes them, `:218`), teleported into `#toast` (`apps/extension/src/popup/app.vue:490`), wrapped by `apps/extension/src/components/ui/ToastManager.vue:22-24` | **adapt**: `#toast` takes a raised class while the Terms sheet is visible; the package is untouched |
| The popup's stacking scale | `LegalAcceptanceSheet.vue:114-118` (9000, "Below GlobalLoader (9999) and the barriers (10000)"), mounted in the shell without a teleport (`app.vue:466`); `GlobalLoader.vue:34` and `NotificationManager.vue:106` (9999, each teleported to `body`); `MigrationBarrier.vue:165` and `BarrierOverlay.vue:32` (10000, teleported to `body` by `MigrationBarrier.vue:121` and `AccountIntegrityBarrier.vue:68`); `PasskeyCeremonyDialog.vue:101` (10000, no teleport, mounted only on routes the sheet never covers); `Popup.vue:102`, `:113` (`(displaceIdx + 1) × 400` and `× 500`); `DropdownRoot.vue:312`, `:317` (2000, 2001); `packages/design/src/ui/Popover.vue:114`, `:120` (2010, 2005); `Tooltip.vue:242` (50000); `.wrapper` in `app.vue:495-505` (`position: relative`, `overflow: clip`, no z-index, so no stacking context) | read, to place the raised host at 9500 |
| When the sheet appears with no tap | `useLegalAcceptance.ts:22` (re-reads on reconnection), `:30-36` (a failed read sets "missing") | read, for codex round-1 finding 2 |
| A failed Accept's message | `openToast({ kind: "error", label: "Could not record your acceptance. Try again." })` (`LegalAcceptanceSheet.vue:50`); an error card stays until closed (`packages/design/src/composables/toast.ts:58-63`) | **reuse-as-is**: its text is already dash-free; only its layer changes |
| What opens the sheet over a page that announces arrivals | Send's banner "Review" clears the dismissal (`apps/extension/src/popup/pages/send.vue:249-253`); arrivals snack on every signed-in route but Home, History, the auth entry routes and `windows-*` (`apps/extension/src/composables/useArrivals.ts:106-108`, `:357-367`), and View opens the receipt (`app.vue:90`) | read, for the realistic trigger |
| Refuse the acceptance write in a real browser | Firefox: `evaluateInBackgroundPage` (`apps/extension/tests/e2e/fixtures/browser/firefox.ts:372`); Chrome: the service-worker target (`chrome.ts:101`); `ChromeStorageAreaAdapter` holds `chrome.storage.local` and calls its `set` at call time (`src/core/adapters/chrome-browser-api.ts:41`, `:52`, `:73`) | **adapt**: one `BrowserDriver` method, `evaluateInBackground` |
| Show the loader over the sheet in a real browser | `stopBackground` on Chrome; Firefox will not end its event page under an open page (`fixtures/browser/index.ts:183`) | **reuse-as-is**, Chrome only |
| Prove the snack host goes back down | the existing "Not now" case S4 (`tests/e2e/legal-acceptance.test.ts:151`, through `declineFromSheet` at `:104-110`) | **adapt**: two computed `z-index` reads around its first decline |
| A screen-reader name for a Details row | `spokenName` and the hidden `labelledby` span (`apps/extension/src/components/composite/capabilities/DetailsTable.vue:59-64`, `:83-90`); `shownAddress` (`:49`) through `trimAddress(…, 6, 4, "…")` (`apps/extension/src/utils/string.ts:11-14`) | **adapt**: the unknown branch of `spokenName` |
| Wire-shaped fixtures for the Details rows | `TOKEN`, `DRIP`, `FEE_JUICE` (`DetailsTable.test.ts:6-9`) | **reuse-as-is** |
| Capturing an accessible name in a real browser | `page.accessibility.snapshot` on Chrome (`apps/extension/tests/e2e/tooltips-glossary.test.ts:147-157`), which reads a description there | **adapt**, for the owner page's capture only: the snapshot's `name` |
| The glossary's one source and its two pins | `GLOSSARY.authorization.where` (`apps/extension/src/utils/glossary.ts:43-47`), rendered at `popup/pages/settings/glossary.vue:26`; pinned by `utils/glossary.test.ts:18-24` and `popup/pages/settings/glossary.test.ts:40` | **adapt**: one string, two pins |
| Where "authorization" is dotted | `PermissionGroup.vue:47` (the permission window), `popup/pages/settings/connected-apps/[id].vue:336` (Settings → Connected apps); the approval window's "Authorization" title is not dotted | read |
| e2e helpers that match toast text | `waitForToast` matches a case-insensitive substring of title plus sub (`apps/extension/tests/e2e/fixtures/helpers.ts:1378-1390`) | read: every e2e toast wait uses a prefix before the dash, so none changes |
| A helper that splits a string at its dash | none (`rg "split\(\" — \"\)"` finds nothing) | **not built**: hand edits read better in review than a transform, and a helper would run on every render |

## Conventions to match

- Toast labels keep their own final punctuation: a label with no full stop today gets none after
  the split ("Profile imported. Unlock to continue"); a label that ends in one keeps it.
- A string that starts lower-case keeps its first letter (E44); only the second sentence is
  capitalised.
- Journal subtitles carry no final full stop (`journal-state.ts:295`, `:297`), and neither the
  split nor E24's rewording adds one.
- Pinning tests change with their string, in the same commit, and so do input copies. A
  `.pins.test.ts` is a characterisation pin, and its expected text moves with the copy
  (`NewNetworkPopup.pins.test.ts:122`, `restore-surface.pins.test.ts:130`). A case-sensitive
  substring of the text after the dash changes too: `journal-state.test.ts:627` reads "check the
  explorer".
- The `ACCOUNT_STATE_SKIP_*` constants are compared by constant, never by literal, in shipped code
  (`composables/importChainSync.ts:129`, `:135`); only test literals copy them.
- Generic components' sample text stays: `BarrierOverlay.test.ts:74-94` and
  `packages/design`'s `FieldWarning.test.ts:50-51` pin no shipped string. The integrity barrier's
  real copy is pinned in `AccountIntegrityBarrier.test.ts:61`, whose existing assertions stay.
- New copy follows CLAUDE.md § Code-comment style for any comment the guard, the host class or
  `spokenName` needs: one sentence, no plan or review reference.

## Collision and dedup risks

- **The one open overlap**: the `amount-honesty` plan, on the same base, edits
  `popup/pages/send.vue` (its amount field's wiring, not E2's `:369`) and no other file here. The
  other wave-2 plans are in the base (stack #729).
- **`popup/app.vue`** gains one class on `#toast` beside E4's literal; **`tests/e2e/fixtures/browser/`**
  gains one driver method. Any plan that edits the shell or the driver sequences with this one.
- **Shared plan files**: this plan and `amount-honesty` both edit `implementations-plan/index.md`,
  `follow-ups.md` and `lessons.md`; delivery reconciles them by reading them against `dev`.
- **Two copies of one toast.** "Couldn't estimate fee — retry." is written twice
  (`send.vue:369`, `popup/windows/execute/index.vue:154`); both change, and the pair stays two
  literals (two sites, under the three-copies rule).
- **`app.vue:231` repeats `RecoveryModeError.MESSAGE` as a literal.** Both change together; the
  plan does not make the toast import the constant, which would be a refactor beyond the copy.
