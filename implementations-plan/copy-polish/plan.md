---
plan: copy-polish
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: artifact
eli5: https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk (one page for the wave's ten plans)
branch: chore/copy-polish
worktree: a harness-created agent worktree (lessons/phase-0.md records it)
base: dev @ 94ef1b11 (stack #729 landed; the same tree as `0f37ab78`, where the Facts were read)
---

# Copy polish

Four owner-decision follow-ups about what the popup says and shows, from
`implementations-plan/follow-ups.md` § ux-feedback: owner decisions, as one PR off `dev`:

- **E** · 46 user-visible strings join two clauses with an em dash. Each loses its dash: 35 split
  into two sentences, 11 reworded where the owner let the driver do so. A unit test keeps new
  ones out.
- **G** · The glossary's `where` for "authorization" names an approval window where the term is
  not dotted, and leaves out Settings → Connected apps, where it is.
- **T** · The popup's Terms sheet (z-index 9000) hides every snack (2000) raised while it is open,
  its own "Could not record your acceptance" message included.
- **A-27** · A screen reader hears an unknown contract's Details row as its truncated address
  alone, with nothing saying the wallet does not know it. `DetailsTable.test.ts` holds it as a
  `test.todo`.

Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner, 2026-09-28: "Can you ultracode 1 to 5 + security
and privacy + test rliability + trivial? Assigning blueprinting level to each of those and just
needing me to answer the open questons that it may come." The owner, 2026-09-29: "Feel free to
leverage the gh cli to merge away the branches that you understand are ready and feel confident
on their implementation. Continue then with ultracodeing the follow-ups." The owner, 2026-09-28:
"FYI: use opus5.5 instead of fable please."

- **Scope**: E, G, T and A-27 above. The records: for E, the owner, 2026-09-25: "separate
  follow-up for those 45 older strings", and the copy rule from the owner's message of the same
  exchange, "But please, drop the usage of "em dashes"", which the ux-feedback plan records as
  "no em dash joins two clauses in user-visible text … the empty-value glyph "—" stays"
  (`implementations-plan/ux-feedback/plan.md:306-323`); E25 to E28 also close the backup-import
  plan's F-7 (`implementations-plan/follow-ups.md:81`). For G,
  `implementations-plan/ux-feedback/b5-permissions/lessons/phase-3.md:63-64`. For T,
  `implementations-plan/ux-feedback/plan.md:482-484`. For A-27,
  `implementations-plan/ux-feedback/b5-permissions/lessons/phase-6.md:64-67`.
- **Out**: `legal/*.md` and `@nulo/legal`'s consent strings (pinned to the Terms); the landing
  (`apps/landing`); anything the dApp sees (the error envelope's messages, `DuplicateInitializationError`'s
  default text); log lines; thrown developer text no screen shows, the rest of
  `packages/aztec-runtime` included (Decision ledger); Storybook stories and test fixtures that are
  not a changed string's pin or input copy; any rewording beyond the split, except the eleven
  strings the owner's O1 answer let the driver reword; `packages/design`'s stacking.
- **Constraints**: pre-production, no migrations; complexity budgets hold with no new acceptance;
  no new dependency; existing testids verbatim; the logging policy; e2e select only by testid.
- **Tier**: `light`, under the owner's standing cap "never blueprint more than mid, to keep our
  credits safe" (§ Phase 0.5).
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Validation layers**: lint, typecheck, unit and component, CI-gating scripts, build, Storybook
  build; smoke e2e on Chrome and Firefox (toasts, the Terms sheet, the barriers and one new
  browser case change); the network specs whose surfaces change (`network/snack-placement.test.ts`,
  `network/cap-window.test.ts`) on both browsers; a flake bar for the changed e2e file.
- **Decisions**: UI and product asks go to the owner; technical asks are decided with
  `/codex high`. Every Ask carries a recommendation and a confidence, labelled `owner` or `codex`.
- **Delivery**: single arc, one PR off `dev` on `chore/copy-polish`, plain `gh pr create` after
  the codex loop converges. Merged by the driver under the owner's standing authorization above,
  once the blanket sign-off is quoted, every required check is green on the head, and the codex
  loop has converged.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 1 | Hand edits and pin updates; the guard follows `log-payload-ban.test.ts`; the sheet reuses the snack's sheet registry |
| Blast radius | 1 | 31 source files, but only literals change, plus one host class, one directive pair, one string builder and one e2e driver method |
| Irreversibility | 0 | Copy and tests only |
| Migration cost | 0 | Nothing persisted changes |
| External coupling | 0 | Every dApp-facing string is out of scope |
| Security sensitivity | 1 | The integrity barrier's recovery-phrase warning and the consent sheet change wording or layer, never behaviour |

`light`: the work is wide but shallow, every item has a known pattern, and the one design fork
(the snack over the sheet) is one host class and a directive pair.

## Outcome & Quality Bar

For whom: anyone reading a snack, a barrier, a banner, a History row, Add token's error line or
the import's error log; a person reviewing the Terms while something happens underneath; a
screen-reader user on the permission window.

Excellent means:

1. **No clause-joining em dash stays on a screen, and none comes back unseen.** Each of the 46
   strings is split at the dash into two sentences, the second capitalised and nothing else
   changed, except eleven the owner let the driver reword (§ The string table). A unit test that
   fails on the branch base listing exactly those 46 strings passes after, and fails on any new
   source string or text node with a clause dash outside a log call and off its reviewed list.
2. **A snack raised while the Terms sheet is open is seen, and never covers Continue or "Not
   now".** A failed Accept shows its message over the sheet; an arrival snack on Send shows too;
   the loader and the barriers still draw over the snack; the snack's host returns to its ordinary
   layer once the sheet goes; a browser case on both engines proves it by hit-testing.

Good enough: thrown developer text, log lines, the developer-mode journal box and dApp-facing
messages keep their dashes (§ The string table, Leave); Add token still shows the PXE store's two
errors in their developer wording, split only (Follow-ups); the guard reads source strings, not
what a screen renders, and cannot see the forms its header lists; the glossary's other `where`
lines are not audited.

## UI impact

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | The 46 strings of § The string table: 13 snacks, 15 field, card, dialog and error-log lines, 3 History and journal lines, 15 screen texts | split at the dash ("Profile imported — unlock to continue" → "Profile imported. Unlock to continue"), eleven reworded ("Couldn't estimate fee — retry." → "Couldn't estimate fee. Try again.") | O1 answered 2026-09-30: "Reword some (tell me which)", note: "Please, evaluate yourself, just don't over-use them. feel free to ask gpt sol". Blanket sign-off pending (P6) |
| 2 | Settings → Glossary, Apps, "Authorization" | where-line "Permission window · approval window" → "Permission window · Connected apps" | O4 answered 2026-09-30: "Connected apps (Recommended)". Blanket sign-off pending (P6) |
| 3 | The Terms sheet, while a snack is raised | the snack is drawn under the sheet's backdrop and is never seen → it shows over the sheet, 12 px above Continue's row at the end of the scroll; while shown it can cover the consent box's row | O2 answered 2026-09-30: "Show it over the sheet (Recommended)". Blanket sign-off pending (P6) |
| 4 | The permission window's Details rows, unknown contracts, for a screen reader | "0x0c1e…5a7f: simulate, add, transact" → "Unknown contract 0x0c1e…5a7f: simulate, add, transact". Nothing drawn changes | O3 answered 2026-09-30: "Unknown contract + address (Recommended)". Blanket sign-off pending (P6) |

Nothing else a user sees changes.

### UI asks for the owner (answered 2026-09-30)

The owner answered in chat (AskUserQuestion), before the builds, from text mocks with the exact
copy. Each answer is the option label picked, verbatim, with any note typed. The blanket sign-off
stays open until the PR's screenshots (P6).

- **O1 · The clause-joining em dashes (46 on the stacked tree: the 44 plus two PXE store errors the
  Add token screen can show)** → "Reword some (tell me which)", note: "Please, evaluate yourself,
  just don't over-use them. feel free to ask gpt sol". The driver reworded eleven strings where the
  bare split reads clipped or wrong, with GPT-5.6 Sol's agreement (Decision ledger); the other 35
  are the bare split (§ The string table).
- **O2 · A snack while the Terms sheet is open** → "Show it over the sheet (Recommended)": § T as
  written.
- **O3 · A-27, the unknown contract's spoken Details row** → "Unknown contract + address
  (Recommended)": "Unknown contract 0x0c1e…5a7f: simulate, add, transact", § A-27 as written.
- **O4 · The glossary's `where` for Authorization** → "Connected apps (Recommended)": "Permission
  window · Connected apps", § G as written.

## Architecture & Implementation

### E · The string table

Each new string is today's text split at the dash, the second sentence capitalised, nothing else
changed; a string with no final full stop keeps none, and a string that starts lower-case keeps
its first letter. The exceptions are the eleven strings the owner let the driver reword (O1), each
for one reason:

- E1 to E3: a one-word "Retry." reads as a button these snacks do not have; "Try again." is what
  E8 and E17 say.
- E24: "Stopped. Wallet was locked" reads as two clipped fragments in a History row; one phrase
  says it.
- E25 to E28: "Skipped." alone is a fragment; a colon keeps the verdict and its reason on one
  error-log line.
- E31: the split reads as two commands beside a button that is itself named "Retry update"; one
  sentence says what the tap does.
- E39: the split opens a sentence on "But"; a comma keeps it one sentence.
- E44: "the orphan taxonomy" is internal wording; "so it was not restored" says what happens to
  the row, which is never written.

E45 and E46 are the bare split. Lines are at `0f37ab78`, paths under `apps/extension/src/` unless
given in full. A pin is a test whose expected text changes with the string; a prefix or substring
match that still holds needs no change and is listed so a reader can check it; an input copy is a
fixture that feeds the old text in, and changes with the string so no test feeds a record the
wallet no longer writes.

**Snacks**

| # | Where | Today | New | Pin |
|---|---|---|---|---|
| E1 | `popup/windows/execute/index.vue:154` | Couldn't estimate fee — retry. | Couldn't estimate fee. Try again. | prefix: `tests/e2e/network/snack-placement.test.ts:253` |
| E2 | `popup/pages/send.vue:369` | Couldn't estimate fee — retry. | Couldn't estimate fee. Try again. | prefix: `snack-placement.test.ts:174` |
| E3 | `popup/windows/execute/index.vue:177` | Couldn't preview authorizations — retry. | Couldn't preview authorizations. Try again. | none |
| E4 | `popup/app.vue:231` | Wallet keys need recovery — export a backup and restore it | Wallet keys need recovery. Export a backup and restore it | prefix: `tests/e2e/imported-account-lifecycle.test.ts:141` |
| E5 | `packages/extension-messaging/src/errors.ts:459` (`RecoveryModeError.MESSAGE`) | Wallet keys need recovery — export a backup and restore it | Wallet keys need recovery. Export a backup and restore it | `packages/extension-messaging/src/errors.test.ts:89`; `wallet/services/pxe/client.test.ts:57` |
| E6 | `popup/pages/import.vue:80` | Profile imported — unlock to continue | Profile imported. Unlock to continue | none |
| E7 | `popup/pages/auth.vue:134` | Unlock timed out — please try again | Unlock timed out. Please try again | none |
| E8 | `popup/pages/settings/security/reset.vue:71` | Couldn't delete profile — try again | Couldn't delete profile. Try again | none |
| E9 | `popup/pages/settings/networks/[id].vue:113` | Last endpoint — delete the chain instead. | Last endpoint. Delete the chain instead. | none |
| E10 | `popup/components/popups/NewTokenPopup.vue:243` | Token added — balance will appear in a moment | Token added. Balance will appear in a moment | prefix: `tests/e2e/fixtures/helpers.ts:947`; substring: `NewTokenPopup.test.ts:382`, whose case-sensitive "balance will appear" becomes "Balance will appear" (found in the build) |
| E11 | `NewTokenPopup.vue:247` | Token added. Couldn't load balance — we'll retry automatically. | Token added. Couldn't load balance. We'll retry automatically. | substring: `NewTokenPopup.test.ts:356` |
| E12 | `popup/components/popups/NewNetworkPopup.vue:124` | Network added, but the switch didn't confirm — reopen the popup to verify | Network added, but the switch didn't confirm. Reopen the popup to verify | `NewNetworkPopup.pins.test.ts:122` |
| E13 | `composables/useNetworkActivation.ts:32` | Couldn't confirm the network switch — reopen the popup to verify | Couldn't confirm the network switch. Reopen the popup to verify | none |

E5 is `RecoveryModeError`'s text, kept whole for screens (`errors.ts:450-462`); E4 repeats it as
a literal.

**Field, card, dialog and error-log lines**

| # | Where | Today | New | Pin |
|---|---|---|---|---|
| E14 | `popup/components/popups/NewEndpointPopup.vue:56` | Wrong chain — this network is chain ${…}. | Wrong chain. This network is chain ${…}. | none |
| E15 | `popup/components/popups/EditEndpointPopup.vue:71` | Wrong chain — this network is chain ${…}. | Wrong chain. This network is chain ${…}. | none |
| E16 | `popup/components/modules/send/FeeSettingsCard.vue:420` | Couldn't load fee data — retrying in the background. | Couldn't load fee data. Retrying in the background. | `FeeSettingsCard.test.ts:1639` |
| E17 | `popup/utils/transfer-failure-copy.ts:4` | Couldn't start this transaction. Nothing was sent — try again. | Couldn't start this transaction. Nothing was sent. Try again. | `transfer-failure-copy.test.ts:35` |
| E18 | `popup/windows/execute/scope-mismatch.ts:83` | This still executes — you just won't see it in your balances or activity. | This still executes. You just won't see it in your balances or activity. | `scope-mismatch.test.ts:120`, `:131`, `:144`; `scope-follow.test.ts:251` |
| E19 | `wallet/services/profile/service.ts:76` | Imported-keys key unrecoverable — imported keys and local chain state are lost. Export a full backup (or the recovery phrase) and restore it to repair. | Imported-keys key unrecoverable. Imported keys and local chain state are lost. Export a full backup (or the recovery phrase) and restore it to repair. | none |
| E20 | `wallet/services/profile/service.ts:1087` | Profile integrity check failed — export a full backup and restore it before changing the password | Profile integrity check failed. Export a full backup and restore it before changing the password | prefix: `service.integration.test.ts:2964`, `tests/e2e/imported-account-lifecycle.test.ts:152` |
| E21 | `wallet/services/account/service.ts:470` | Imported keys unavailable — unlock again | Imported keys unavailable. Unlock again | none |
| E25 | `composables/full-backup-restore.ts:285` | Skipped — its network is not one of the built-in networks | Skipped: its network is not one of the built-in networks | `useFullBackupImport.test.ts:1020`, `:1032` |
| E26 | `wallet/services/account-state/normalize.ts:39` (`ACCOUNT_STATE_SKIP_UNREACHABLE`) | Skipped — couldn't reach the network | Skipped: couldn't reach the network | `utils/full-backup-helpers.test.ts:603`, `:606`; `account-state/service.test.ts:343-344` |
| E27 | `normalize.ts:40` (`ACCOUNT_STATE_SKIP_WRONG_NETWORK`) | Skipped — this endpoint serves a different network | Skipped: this endpoint serves a different network | none |
| E28 | `normalize.ts:41` (`ACCOUNT_STATE_SKIP_DEADLINE`) | Skipped — ran out of time reaching the network | Skipped: ran out of time reaching the network | `full-backup-helpers.test.ts:615` (its `toContain` at `:620` holds); `restore-surface.pins.test.ts:130`; input copies: `onboarding/pages/import.test.ts:150`, `:186` |
| E44 | `wallet/services/account/service.ts:783` | no rewrap context for imported key — dropped to the orphan taxonomy | no rewrap context for imported key, so it was not restored | none |
| E45 | `packages/aztec-runtime/src/pxe/opfs-store.ts:58` (`ChainStoreWedgedError`) | …Refusing to start a second worker — restart the offscreen document to recover. | …Refusing to start a second worker. Restart the offscreen document to recover. | none: the tests assert the class (`opfs-store-open.test.ts:57`, `:60`, `:111`) |
| E46 | `opfs-store.ts:222` (`PxeStoreVersionMismatch`) | PXE store version mismatch — refusing to open (preserving data): ${…} | PXE store version mismatch. Refusing to open (preserving data): ${…} | none: the tests assert the class (`opfs-store.test.ts:68`, `:76`, `:82`) |

E19 and E20 are thrown at Change password and shown there (`profile/service.ts:1087-1091`,
`popup/pages/settings/security/change-password.vue:76`); E21 is thrown by `importAccount` and
shown on Settings → Accounts → Import (`account/service.ts:458-470`,
`popup/pages/settings/accounts/import.vue:133`). E25 to E28 and E44 reach the import's "View
Errors" viewer (`utils/full-backup-helpers.ts:322-329`): E44 is thrown inside `restoreRows`, whose
catch records it as the row's `restoreError` (`wallet/services/restore-rows.ts:28-31`,
`composables/full-backup-restore.ts:343`), once per imported key of a restored passkey profile
whose sealed key would not open (`wallet/services/profile/service.ts:2504-2512`). E26 to E28 are
exported constants, and everything that writes or compares them reads the constant
(`composables/importChainSync.ts:101-116`, its `startsWith` at `:129` and `===` at `:135`;
`wallet/services/account-state/service.ts:369`, `:395`, `:441`; `importChainSync.test.ts`,
`normalize.test.ts:153-157`, `useFullBackupImport.test.ts:1036`, `:1180`, and the Chrome-only
`tests/e2e/network/backup-import-stalled-network.test.ts:102`), so those follow the change; the
import's retry warning reads the retry context, not the text (`composables/useFullBackupImport.ts:819-823`).
Only the Pin column's literals change by hand. E45 and E46 show under Add token's Submit (Fact 24).

**History and the journal**

| # | Where | Today | New | Pin |
|---|---|---|---|---|
| E22 | `utils/journal-state.ts:263` | The wallet restarted before confirming this. Transaction may still be on-chain — check the explorer. | The wallet restarted before confirming this. Transaction may still be on-chain. Check the explorer. | substring: `journal-state.test.ts:627`, whose case-sensitive "check the explorer" becomes "Check the explorer" |
| E23 | `utils/journal-state.ts:295` | Account already initialized — retry after sync | Account already initialized. Retry after sync | `journal-state.test.ts:146` |
| E24 | `utils/journal-state.ts:297` | Stopped — wallet was locked | Stopped when the wallet locked | `journal-state.test.ts:149` (its title), `:153`, `:453`; no e2e reads it |

**Screens**

| # | Where | Today | New | Pin |
|---|---|---|---|---|
| E29 | `components/AccountIntegrityBarrier.vue:76-77` | …in response to this message — no legitimate screen will ask for it. | …in response to this message. No legitimate screen will ask for it. | new exact pin: `components/AccountIntegrityBarrier.test.ts:61` asserts the whole `account-integrity-blocked-copy` text |
| E30 | `components/MigrationBarrier.vue:26` | Your funds are safe — your secret phrase still recovers your accounts. Reinstall the extension to start clean. | Your funds are safe. Your secret phrase still recovers your accounts. Reinstall the extension to start clean. | substring: `MigrationBarrier.test.ts:40` |
| E31 | `MigrationBarrier.vue:30` | Your funds are safe. Tap Retry update — the wallet restarts and retries. | Your funds are safe. Tap Retry update to restart the wallet and try again. | substring: `MigrationBarrier.test.ts:49` ("Retry update", holds) |
| E32 | `MigrationBarrier.vue:145` | Part of the last update didn't apply — some data may look outdated. | Part of the last update didn't apply. Some data may look outdated. | none |
| E33 | `components/passkey/PasskeyCeremonyDialog.vue:91` | Don't navigate away — press Escape to cancel. | Don't navigate away. Press Escape to cancel. | none |
| E34 | `popup/pages/auth.vue:290` | This profile's import didn't finish — delete it below and re-import your backup. | This profile's import didn't finish. Delete it below and re-import your backup. | none |
| E35 | `popup/pages/settings/security/reset.vue:163` | Waiting for an in-flight operation to finish — this can take up to ~30 minutes while a transaction is proving. Keep this window open. | Waiting for an in-flight operation to finish. This can take up to ~30 minutes while a transaction is proving. Keep this window open. | none |
| E36 | `popup/pages/settings/security/export/full.vue:513` | Sealing the file with your password — only you can open it. | Sealing the file with your password. Only you can open it. | none |
| E37 | `full.vue:544` | …After the restore, register them again — until then their private notes stay undiscovered, since a network sync cannot rebuild that material. | …After the restore, register them again. Until then their private notes stay undiscovered, since a network sync cannot rebuild that material. | none |
| E38 | `popup/pages/profile/new.vue:135` | …sign in securely and effortlessly — no memorizing, no typing, just one tap. | …sign in securely and effortlessly. No memorizing, no typing, just one tap. | none |
| E39 | `popup/components/popups/RevokeAuthwitsPopup.vue:156` | You don’t need to spend gas or send a transaction to revoke them — but you can still do it if you want. | You don’t need to spend gas or send a transaction to revoke them, but you can still do it if you want. | none |
| E40 | `RevokeAuthwitsPopup.vue:164` | Alternatively, you may disable Authwits Registry instead — this will block execution of all current authwits until the registry is enabled again. | Alternatively, you may disable Authwits Registry instead. This will block execution of all current authwits until the registry is enabled again. | none |
| E41 | `popup/components/popups/ImportContactsPopup.vue:178` | No active network — sender registrations will be skipped. | No active network. Sender registrations will be skipped. | `ImportContactsPopup.test.ts:121` |
| E42 | `popup/components/modules/settings/connected-apps/DappSessionVerification.vue:25` | Emojis from the most recent connection — they should have matched what the app showed then | Emojis from the most recent connection. They should have matched what the app showed then | none |
| E43 | `popup/windows/execute/OperationCard.vue:516` | Opaque authorization — the wallet cannot show what this hash authorizes | Opaque authorization. The wallet cannot show what this hash authorizes | substring: `OperationCard.createAuthwit.test.ts:124` |

E39's apostrophe is the typographic one in the source, and stays. E29's pin moves from the
generic `BarrierOverlay.test.ts` fixture (a sample parent template, left as it is) to the real
barrier, whose existing assertions stay.

**Leave** (every other hit of the scan, by class; the 38 log-call arguments and the 24
empty-value glyphs are counted in `recon.md`, not listed). Each thrown leave was traced to its
consumers: a failure inside a send or an execution reaches the person only as constant copy
(`popup/utils/transfer-failure-copy.ts`, the journal's `utils/journal-state.ts` contexts, the
execute window's two fee toasts, the dApp envelope's unclassified text at
`wallet/services/wallet-sdk/error-envelope.ts:197`), and a raw message only in the developer box.

- *Label joiners, not clauses*: `popup/windows/execute/OperationActionRow.vue:23`, `:37`, `:45`,
  `:49` (" — spender", " — consumer", " — message hash" between a title and an address).
- *Thrown developer text* (an invariant failure, a concurrent deletion, or a failure that a
  screen shows only as constant copy): `wallet/services/restore-fence.ts:37`, `:41`;
  `wallet/services/transaction/service.ts:185`; `wallet/services/profile/profile-deletion-state.ts:70`;
  `wallet/services/profile/service.ts:927`, `:1371`, `:1482`, `:1759`;
  `wallet/services/operation-journal/service.ts:271`, `:282`, `:292`, `:671`;
  `wallet/services/execution/fee/fee-strategy.ts:300`; `wallet/services/dapp-interaction/materialize.ts:105`;
  `wallet/services/backup/row-map-migration.ts:182`, `:205`, `:283`, `:285`, `:289`;
  `wallet/services/account/service.ts:376`; `utils/background-liveness.ts:62`;
  `composables/useEntityCrud.ts:65`; `popup/windows/discover/index.vue:98`;
  `popup/windows/capabilities/index.vue:300`.
- *Only the developer-mode journal box shows it* (`popup/pages/journal/[id].vue:291`, gated at
  `:203`): `wallet/services/execution/preview-snapshots.ts:62-64`;
  `wallet/services/operation-journal/reaper.ts:190`; `wallet/services/wallet-sdk/background.ts:1183`;
  `wallet/services/transaction/service.ts:261` (a task step's failure, which no activity surface
  renders).
- *dApp-facing*: `wallet/services/wallet-sdk/error-envelope.ts:236`;
  `packages/extension-messaging/src/errors.ts:233`.
- *Unreachable today* (Decision ledger): `composables/full-backup-restore.ts:189`;
  `wallet/services/backup/backup-migrator.ts:168`, `:189`;
  `wallet/services/account-state/normalize.ts:182`.
- *Generated file headers*: `packages/design/src/internal/render-css.ts:20`, `render-tokens.ts:10`.
- *Log reasons*: `wallet/services/wallet-sdk/session-established.ts:91`, `:99`, `:107`
  (`terminateWith`; `:91` now reads "…on an abandoned or stale approval — terminating").
- *Outside the guard's roots*: the rest of `packages/aztec-runtime/src`, 18 literals (Decision
  ledger).

### E · The guard

`apps/extension/src/utils/copy-dash-ban.test.ts`, a static test beside `log-payload-ban.test.ts`
and in its style (Ask C2):

- **What it reads**: every `.ts`, `.js` and `.vue` file under `apps/extension/src`,
  `packages/design/src` and `packages/extension-messaging/src` (where E5 lives), and the one file
  `packages/aztec-runtime/src/pxe/opfs-store.ts` (E45, E46); tests, stories and `.d.ts` excluded.
  Scripts are parsed with `typescript`; `.vue` files with `@vue/compiler-sfc`, whose template
  text, static attributes and bound expressions (parsed again as TypeScript) are read too. Both are
  already declared by `apps/extension/package.json`.
- **A hit**: a string literal, a template literal's cooked text (each `${}` read as one word), a
  template text node or a static attribute value matching `/\S\s*—\s*\S/`: a dash with text on
  both sides. The empty-value glyph ("—", "— FJ") and a label joiner that starts its own text node
  do not match.
- **Exempt by position**: the arguments of a log call only, judged by the callee's spelling: a
  callee `console.<method>`; a function or method named `log`, `logDebug`, `logInfo`, `logWarn` or
  `logError` (`logger.log`, `this.logWarn`, `deps.logDebug`); or a method of an object named `log`
  (`log.warn`, `this.log.error`). In the four roots the first two forms exempt the same 37
  arguments as before and the third exactly one call, `opfs-store.ts:221`, which no other call
  matches (recon). A `throw` or an `Error` constructor is not exempt: a thrown message can reach a
  screen (E20, E21, E44 to E46).
- **Exempt by name**: an inline reviewed list of `{ file, text, why }`, one entry per non-visible
  hit: the 40 of § Leave that the pattern matches (23 thrown, 6 journal box, 2 dApp-facing, 4
  unreachable, 2 generated headers, 3 log reasons; `materialize.ts:105` splits its dash across a
  concatenation and does not match). `why` is one short phrase ("invariant failure", "dApp
  envelope"). A second case fails on an entry that matches nothing, so the list only shrinks.
- **Scanner cases**: the scan is one function over `(file, source)`, and one `test.each` feeds it
  snippets: a template literal with a substitution, template text, a static attribute and a bound
  expression each hit; `console.warn`, `this.logWarn` and `log.warn` arguments are exempt, a
  `dialog.warn` argument hits; "—", "— FJ" and " — spender" as their own text node do not hit.
- **Its failure message** lists `file:line  text` per hit and names the rule: split at the dash
  into two sentences, or add a reviewed entry if no screen shows it.
- **Header**: why it exists, in two sentences, and its limits: it reads source strings and text
  nodes, not what a screen renders, so each reviewed entry is a person's judgement of where that
  text goes; it cannot see a dash built by concatenation or a computed fragment, text returned by
  a helper outside its roots, text split across elements, or a runtime substitution; of
  `packages/aztec-runtime` it reads only `src/pxe/opfs-store.ts`, whose two errors Add token shows;
  and the log exemption trusts the callee's spelling.
- **CLAUDE.md** gets one bullet in § UI changes need explicit owner sign-off: no em dash joins two
  clauses in user-facing copy, a full stop does, and the empty-value "—" stays;
  `copy-dash-ban.test.ts` fails on the forms it can read and its header lists the ones it cannot
  (Ask C4).

### G · The glossary

`utils/glossary.ts:46`: `where: "Permission window · approval window"` →
`"Permission window · Connected apps"`, as O4 (a). The two pins change with it
(`utils/glossary.test.ts:18-24`, `popup/pages/settings/glossary.test.ts:40`). The glossary page
renders the line (`popup/pages/settings/glossary.vue:26`).

### T · The Terms sheet and the snack

- **When a snack fires under the sheet** (realistic): the sheet's own failed Accept
  (`components/LegalAcceptanceSheet.vue:50`, a background restart or a refused storage write
  mid-tap); after Send's "Review" banner reopens the sheet over Send (`popup/pages/send.vue:249-253`),
  an arrival snack (`composables/useArrivals.ts:106-108`, `:357-367`), Send's own fee-estimate
  failure (E2) or a failed send's snack; and whatever snack is open when the sheet appears without
  a tap, since the status re-reads on every reconnection and a failed read counts as "missing"
  (`composables/useLegalAcceptance.ts:22`, `:30-36`). A success card times out unseen; an error
  card stays under the backdrop until something closes it (`packages/design/src/composables/toast.ts:58-63`).
- **The change** (O2 (a), mechanism per Ask C1): the sheet keeps its 9000. While it is visible,
  the app shell raises the snack's host: `popup/app.vue:490`'s `<div id="toast" />` takes a class
  `position: relative; z-index: 9500`, which makes it a stacking context above the sheet and below
  the loader and the notification layer (9999) and the barriers (10000), each teleported to
  `body`; the passkey dialog (10000) mounts only on routes the sheet never covers (Fact 14). The
  sheet emits `visibility` (true while shown), and the shell binds the class to it. One comment on
  the class, one sentence: while the Terms sheet is open the snack draws over it, still under the
  loader and the barriers. `ToastManagerBase`, its 2000 and every other layer stay as they are, so
  no menu or popover order changes.
- **Where the card sits**: the backdrop takes `v-snack-sheet` with `Number.MAX_SAFE_INTEGER`, an
  order no Popup reaches, and the "Not now" footer takes `v-snack-footer`; Continue's row already
  carries one (`components/composite/LegalConsent.vue:92`). While the sheet is on top only its
  footers place the card, from a base of 12 px, so the card sits 12 px above Continue's row where
  that row stops at the end of the scroll (`composables/snackInset.ts:22-71`, `:85-95`, `:139`).
  The card's row lets taps through outside the card (`ToastManagerBase.vue:198`, `:218`), so the
  sheet keeps every tap the card does not cover.
- **Pressing a card's action** closes the card and runs it (`ToastManagerBase.vue:102-107`): an
  arrival's View opens its receipt (`popup/app.vue:90`) under the sheet, and a failed send's
  Details its journal page; both routes need auth, so the sheet stays over them.
- **Unchanged**: `packages/design`, the toast composable, the sheet's visibility rules
  (`utils/legal-sheet.ts:25-31`), the failed Accept's text.

### A-27 · The spoken name of an unknown row

`components/composite/capabilities/DetailsTable.vue:61-64`: the unknown branch of `spokenName`
reads `Unknown contract ${shownAddress(address)}`, as O3 (b). `shownAddress` keeps its
sanitisation and truncation (`:49`). The comment above it (`:59-60`) keeps its reason and gains
one clause: a row's target reads "{name}: {columns}" since the head is hidden from screen
readers, and an unknown row's name says so since a Tab to it skips its sub-header.

### File-level change map

- **E**: the 31 files of the string table (`popup/windows/execute/index.vue`, `popup/pages/send.vue`,
  `popup/app.vue`, `popup/pages/import.vue`, `popup/pages/auth.vue`,
  `popup/pages/settings/security/reset.vue`, `popup/pages/settings/networks/[id].vue`,
  `NewTokenPopup.vue`, `NewNetworkPopup.vue`, `NewEndpointPopup.vue`, `EditEndpointPopup.vue`,
  `RevokeAuthwitsPopup.vue`, `ImportContactsPopup.vue`, `composables/useNetworkActivation.ts`,
  `composables/full-backup-restore.ts`, `FeeSettingsCard.vue`, `popup/utils/transfer-failure-copy.ts`,
  `popup/windows/execute/scope-mismatch.ts`, `wallet/services/profile/service.ts`,
  `wallet/services/account/service.ts`, `wallet/services/account-state/normalize.ts`,
  `utils/journal-state.ts`, `components/AccountIntegrityBarrier.vue`,
  `components/MigrationBarrier.vue`, `components/passkey/PasskeyCeremonyDialog.vue`,
  `popup/pages/settings/security/export/full.vue`, `popup/pages/profile/new.vue`,
  `DappSessionVerification.vue`, `popup/windows/execute/OperationCard.vue`,
  `packages/extension-messaging/src/errors.ts`, `packages/aztec-runtime/src/pxe/opfs-store.ts`);
  the 16 test files whose pins or input copies change (`errors.test.ts`, `pxe/client.test.ts`,
  `NewNetworkPopup.pins.test.ts`, `NewTokenPopup.test.ts`, `FeeSettingsCard.test.ts`,
  `transfer-failure-copy.test.ts`, `scope-mismatch.test.ts`, `scope-follow.test.ts`, `journal-state.test.ts`,
  `useFullBackupImport.test.ts`, `full-backup-helpers.test.ts`, `account-state/service.test.ts`,
  `restore-surface.pins.test.ts`, `onboarding/pages/import.test.ts`, `AccountIntegrityBarrier.test.ts`
  in place of `BarrierOverlay.test.ts`, `ImportContactsPopup.test.ts`); new
  `utils/copy-dash-ban.test.ts`; `CLAUDE.md`.
- **G**: `utils/glossary.ts`, its two tests.
- **T**: `components/LegalAcceptanceSheet.vue`, `components/LegalAcceptanceSheet.test.ts`,
  `popup/app.vue` (the host class), `tests/e2e/legal-acceptance.test.ts` (one case, and two
  assertions in S4), `tests/e2e/fixtures/browser/index.ts`, `chrome.ts`, `firefox.ts` (one driver
  method, § P5), and one line in `tests/e2e/FIREFOX.md`, whose table lists the driver's methods.
- **A-27**: `components/composite/capabilities/DetailsTable.vue`, `DetailsTable.test.ts`.
- **Plan**: `implementations-plan/copy-polish/`, one line in `implementations-plan/index.md`.

### Trade-offs and alternatives not taken

- **A regex line scanner as the guard** (the first wave's): cheaper to write, but it counts
  comments that share a string's line and misses multi-line template text (recon: 135 lines against
  147 literals). The AST reads every literal and text node; where each goes is still the reviewed
  list's judgement.
- **Blanket exemption for thrown text**: a shorter list, but it hid E20, E21, E44, E45 and E46,
  which screens show.
- **The whole `packages/aztec-runtime/src` in the guard's roots**: 18 more literals to review for
  no visible string (Decision ledger); the one file whose errors Add token shows is read instead.
- **No guard, CLAUDE.md alone**: these strings came through reviews that approved each one; a
  rule nobody runs did not stop them.
- **Lower the sheet to 1999, under the snack** (the draft's choice): one number, but the sheet can
  appear with no tap (a reconnection, a failed read), and a dropdown or popover teleported beside
  it (`DropdownRoot.vue:312`, `:317`; `packages/design/src/ui/Popover.vue:114`, `:120`) would then
  draw over the consent.
- **Raise `ToastManagerBase`'s layer**: one number in the package, but every snack then draws over
  every open menu and popover in both apps, at all times.
- **Hold snacks while the sheet is open** (O2 (b)): the toast composable has one slot and one hold
  flag, which hover already drives (`ToastManagerBase.vue:46`, `holdToast`), and a failed Accept's
  message would need its own inline text.
- **A helper that splits strings at runtime**: it would run on every render and hide the copy
  from review.

## Security & Adversarial Considerations

- **Threat model.** No new input, storage, message or permission. The wording of two
  security-bearing texts changes: the integrity barrier's "Never enter your recovery phrase
  anywhere…" (E29) and the migration barrier (E30, E31). E29's and E30's words are kept, E31 is
  reworded under O1 with no new claim, and the real barrier's test pins E29's whole text. E45 and
  E46 keep their substitutions (a store path, a version detail) as today; only the dash changes.
- **The consent sheet.** Declining stays one tap away: the card sits above Continue's row, never on
  Continue or "Not now" (CLAUDE.md § Terms acceptance). While shown, a card can cover the consent
  box's row; a tap on it reaches the card, whose only controls are Close and an action (an
  arrival's View, a failed send's Details), each of which closes the card and navigates, and
  nothing on a card accepts anything. An arrival card carries a sender-chosen token symbol,
  sanitised and capped at 32 characters (`useArrivals.ts:363`); on the sheet it can say only
  "Received 5 <symbol>". The loader, the notification layer and the barriers still draw over both
  the sheet and the card, the passkey dialog never shares a route with the sheet (Fact 14), and a
  browser case checks the loader on Chrome. Once the sheet goes, the host drops back to its
  ordinary layer, so no snack outlives the sheet above a menu or popover (P5).
- **A-27.** The spoken name reads the same sanitised, truncated address as the visible row
  (`DetailsTable.vue:49`), so no new dApp data enters the accessible name; an unknown row has no
  dApp-given name to read.
- **The guard** reads source files at test time; nothing ships. No dependency is added.
- **The e2e driver method** runs only in the e2e harness against a test profile; it adds nothing to
  the extension's bundle.
- **Supply chain, cryptography, least privilege, CI tokens**: unchanged (no dependency, workflow
  or permission change).

## Assumptions

### Facts (verified at `0f37ab78` by reading the file)

1. An AST pass over the non-test sources finds 150 literals or text nodes holding "—" in the three
   original roots (148 in `apps/extension/src` and `packages/design/src`, 2 in
   `packages/extension-messaging/src`, `errors.ts:233`, `:459`): 44 copy, 24 glyphs
   (`SendReviewSheet.vue:53` is the new one), 37 log arguments, 45 other. `opfs-store.ts` adds 3
   (2 copy, 1 log argument), so the guard's roots hold 153; classified in `recon.md`.
2. The owner's copy rule is recorded at `implementations-plan/ux-feedback/plan.md:306-323`, the
   four follow-ups at `implementations-plan/follow-ups.md:85-88`, and the backup-import entry that
   E25 to E28 close at `:81`.
3. `waitForToast` matches a case-insensitive substring of a snack's title plus sub
   (`apps/extension/tests/e2e/fixtures/helpers.ts:1378-1390`), and every e2e toast wait on a
   changed string, and the page-text match at `imported-account-lifecycle.test.ts:152`, uses the
   words before its dash (`snack-placement.test.ts:174`, `:253`; `helpers.ts:947`;
   `imported-account-lifecycle.test.ts:141`). No e2e reads E3, E24, E31, E39 or E44 to E46; the
   one that reads E28 imports its constant (`network/backup-import-stalled-network.test.ts:102`).
4. A snack's title is upper-cased by style (`packages/design/src/ui/ToastManagerBase.vue:238-243`).
5. Change password shows a thrown message (`popup/pages/settings/security/change-password.vue:76`),
   and E19 and E20 are thrown there (`wallet/services/profile/service.ts:1087-1091`).
6. Settings → Accounts → Import shows a thrown message
   (`popup/pages/settings/accounts/import.vue:133`), and E21 is thrown by `importAccount`
   (`wallet/services/account/service.ts:458-470`).
7. The journal page shows a raw error message only in its developer box, behind debug or
   developer mode (`popup/pages/journal/[id].vue:118`, `:203`, `:291`).
8. A restore record's `restoreError` reaches the import's "View Errors" viewer
   (`utils/full-backup-helpers.ts:322-329`); `restoreRows` records a thrown write's message as it
   (`wallet/services/restore-rows.ts:28-31`, through `utils/restore-error.ts:15-16`), and E44 is
   thrown inside it when a restored imported key has no rewrap context
   (`wallet/services/account/service.ts:779-783`, recorded at `composables/full-backup-restore.ts:343`),
   the path a passkey profile with an unopenable sealed key takes (`profile/service.ts:2504-2512`).
9. `RecoveryModeError.MESSAGE` is kept whole for screens and never sent to dApps
   (`packages/extension-messaging/src/errors.ts:450-462`); `DuplicateInitializationError`'s default
   text reaches the dApp (`errors.ts:233`, `wallet/services/wallet-sdk/error-envelope.test.ts:263`).
10. The Terms sheet's backdrop is at z-index 9000 (`components/LegalAcceptanceSheet.vue:114-118`),
    and a failed Accept opens an error snack (`:45-53`); the snack's layer is 2000
    (`ToastManagerBase.vue:192-199`).
11. The sheet shows on signed-in routes other than `windows-*`, `/popup/legal/` and the export
    routes, while the Terms are missing or stale and not dismissed for that version
    (`utils/legal-sheet.ts:25-31`); Send's "Review" banner clears the dismissal
    (`popup/pages/send.vue:249-253`); the status re-reads on every reconnection and a failed read
    sets "missing" (`composables/useLegalAcceptance.ts:22`, `:30-36`).
12. Arrival snacks open on every signed-in route but Home, History, the auth entry routes and
    `windows-*` (`composables/useArrivals.ts:106-108`, `:357-367`); their View opens the receipt
    (`popup/app.vue:90`), a route that needs auth (`popup/pages/received/[id].vue:2`).
13. `vSnackSheet` registers a sheet with an order, `topSheet` picks the highest, and while one is
    on top only its footers place the card, from a base of 12 px (`composables/snackInset.ts:22-71`,
    `:139`); Continue's row in `components/composite/LegalConsent.vue:92` carries `v-snack-footer`.
14. Popups stack at `(displaceIdx + 1) × 400` and `× 500` (`components/Popup/Popup.vue:102`,
    `:113`); `DropdownRoot` at 2000 and 2001 (`components/ui/Dropdown/DropdownRoot.vue:312`,
    `:317`); `Popover` at 2010 and 2005 (`packages/design/src/ui/Popover.vue:114`, `:120`); the
    loader and the notification layer at 9999, each teleported to `body` (`GlobalLoader.vue:12`,
    `:34`; `NotificationManager.vue:45`, `:106`); the barriers at 10000, teleported to `body`
    (`MigrationBarrier.vue:121`, `:165`; `AccountIntegrityBarrier.vue:68` through
    `composite/BarrierOverlay.vue:32`); the passkey dialog at 10000 without a teleport
    (`passkey/PasskeyCeremonyDialog.vue:101`), mounted only on routes the sheet never covers
    (`popup/pages/profile/new.vue`, `import.vue` and `auth.vue` are not auth-required, `:4`; the
    export route is never covered); `Tooltip` at 50000 (`packages/design/src/ui/Tooltip.vue:242`).
    The loader shows while the background is disconnected (`GlobalLoader.vue:13`).
15. `GLOSSARY.authorization.where` is "Permission window · approval window"
    (`utils/glossary.ts:43-47`), rendered at `popup/pages/settings/glossary.vue:26`, pinned by
    `utils/glossary.test.ts:18-24` and `popup/pages/settings/glossary.test.ts:40`; the term is
    dotted at `popup/windows/capabilities/PermissionGroup.vue:47` and
    `popup/pages/settings/connected-apps/[id].vue:336` only.
16. An unknown Details row is named `${shownAddress(address)}: ${columns}`, the address through
    `trimAddress(…, 6, 4, "…")` (`components/composite/capabilities/DetailsTable.vue:49`, `:59-64`;
    `utils/string.ts:11-14`); the column head is `aria-hidden` (`:70`) and the "Nulo doesn't know"
    sub-header is a plain `div` outside the row's name (`:79`, `:83-90`).
17. `DetailsTable.test.ts` pins the unknown rows by `/^0x\S+: …$/` and holds A-27 as a
    `test.todo` (`:86`, `:92`); its fixture `TOKEN` shows as "0x0c1e…5a7f" (`:7`). Run from
    `apps/extension` at `85c4d20f`,
    `bun --bun vitest run src/components/composite/capabilities/DetailsTable.test.ts`: 13 passed,
    1 todo; neither it nor `DetailsTable.vue` changed since (`git diff --stat 85c4d20f 0f37ab78`).
18. `typescript` and `@vue/compiler-sfc` are declared by `apps/extension/package.json` (`:108`,
    `:96`).
19. The e2e suite reads an accessible description, not a name, on both browsers: Chrome through
    `page.accessibility.snapshot`'s `description`, Firefox through the `aria-describedby` target's
    text (`apps/extension/tests/e2e/tooltips-glossary.test.ts:147-157`). A-27's capture adapts it:
    the snapshot's `name` on Chrome.
20. The one open overlap is the `amount-honesty` plan, built on the same base: its change map
    edits `popup/pages/send.vue` (the amount field's `v-model:rested` and `v-model:pasted`
    wiring), not E2's line (`:369`), and no other file of this plan. Both close into
    `implementations-plan/index.md`, `follow-ups.md` and `lessons.md`. The other wave-2 plans are
    in the base (stack #729).
21. A success snack times out and an error snack stays until closed
    (`packages/design/src/composables/toast.ts:58-63`); a card's action closes it, then runs
    (`ToastManagerBase.vue:102-107`); Send's failed-send snack carries a "Details" action only for
    a verified journal record (`popup/pages/send-submit.ts:97`).
22. `#toast` is a plain `div` in the app shell (`popup/app.vue:490`) inside `.wrapper`, which is
    `position: relative` and `overflow: clip` with no z-index (`:495-505`), so it forms no stacking
    context; the sheet mounts in the same shell without a teleport (`:466`); the card's row takes
    no pointer events and the card does (`ToastManagerBase.vue:198`, `:218`).
23. The Firefox driver evaluates a function body in the background page
    (`tests/e2e/fixtures/browser/firefox.ts:372`); the Chrome driver finds the extension's
    service-worker target (`chrome.ts:101`); `ToastManager.test.ts:91-103` stubs a footer's
    geometry to test the inset.
24. Add token shows the PXE store's errors verbatim: the popup calls `parseTokenInterface`
    (`popup/components/popups/NewTokenPopup.vue:191`), which gets the chain's PXE and calls it
    (`wallet/services/token/service.ts:657-659`) and rethrows (`:710`); the offscreen opens the
    chain's store on first use (`packages/aztec-runtime/src/pxe/chain-runtime.ts:190`), where
    `ChainStoreWedgedError` (`opfs-store.ts:54-61`) and `PxeStoreVersionMismatch` (`:190-192`,
    thrown at `:222`) are plain errors, which each RPC hop carries as their message
    (`packages/extension-messaging/src/core/error-response.ts:26-29`); the popup sets `error` from
    `errorMessageFromUnknown(err)` (`NewTokenPopup.vue:255`) and renders it under Submit
    (`:330-337`, the text at `:334`).

### Inferences (unverified; audits attack these)

1. A screen reader speaks "…" as "ellipsis", "dot dot dot" or nothing, by reader; the accessible
   name is exact, its pronunciation is not. The page shows the name and says so.
2. Overriding `chrome.storage.local.set` in the background refuses the acceptance write, since
   `ChromeStorageAreaAdapter` holds the `chrome.storage.local` object and calls its `set` at call
   time (`core/adapters/chrome-browser-api.ts:41`, `:52`, `:73`). P5's red run proves or refutes it.
3. `z-index: 9500` on a `position: relative` `#toast` puts the snack over the sheet in both
   engines, since neither element sits inside another stacking context. The browser case proves it
   by hit-testing, not by numbers.

### Asks

**Owner**: answered 2026-09-30, verbatim in § UI asks: O1 "Reword some (tell me which)", note:
"Please, evaluate yourself, just don't over-use them. feel free to ask gpt sol"; O2 "Show it over
the sheet (Recommended)"; O3 "Unknown contract + address (Recommended)"; O4 "Connected apps
(Recommended)". **The blanket sign-off** over the built result (the table as built, the barrier
copy, O2 to O4 as built, and the sheet's unchanged layer against menus and popovers) stays open
until the PR's screenshots (P6).

**Codex** (round 1, then the final fresh pass)

- **C1 · How the snack gets above the sheet.** Round 1: amend. Keep the sheet at 9000 and raise
  the extension's snack host while the sheet is visible, below the 9999 and 10000 layers, with the
  package untouched. Final: approve, with the restoration check of condition 3. **Applied** (§ T,
  P5).
- **C2 · The guard's shape.** Round 1: amend. Narrow its claims, replace the blanket throw and
  `Error` exemptions with reviewed entries, include the package copy, add scanner cases. Final:
  amend, to include the additional package source. **Applied** (§ E · The guard: `opfs-store.ts`
  joins the roots, and the callee rule covers `log.warn`).
- **C3 · The leave classification.** Round 1: amend. Add the restore error (E44); change
  `RecoveryModeError.MESSAGE`, leave `DuplicateInitializationError`'s dApp-facing default. Final:
  amend, per condition 1. **Applied** (E45, E46).
- **C4 · The CLAUDE.md bullet.** Approve in both passes, without claiming exhaustive coverage.
  **Applied**.

### Plan audit ledger

- `/codex high` (GPT-6 Astra, session `01a0edd9-9de9-7162-88b1-9b73ad4e1e25`), round 1:
  **conditional approve**, confidence high; conditions: findings 1 to 6, resolved in the round-1
  revision.
- `/codex high` (GPT-6 Astra, session `01a0f294-7b5a-70b0-97ff-cc7398b186e0`), final fresh pass at
  `0f37ab78`: **conditional approve**, confidence high; conditions 1 to 3 (rows 7 to 9), applied in
  this revision. It re-derived the inventory, found the round-1 resolutions and the realism lines
  hold, approved C1 and C4, and amended C2 and C3.

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex | major | The restore error at `account/service.ts:783` reaches "View Errors" on a supported recovery path; the inventory has at least 44 strings, and the blanket thrown-text leave is false | accepted: E44 added to the table and O1 (flagged); every thrown leave traced to its consumers and none other reaches a screen (§ Leave, recon); the old Inference 1 is gone |
| 2 | codex | major | Lowering the sheet to 1999 lets teleported dropdowns (2000, 2001) and popovers (2005, 2010) draw over it, since the sheet can appear on reconnection or a failed read with no tap | accepted with codex's alternative: the sheet stays at 9000 and the app shell raises `#toast` to 9500 while the sheet is visible; the package is untouched; the old Inference 2 is gone and the 1999 choice moves to Trade-offs |
| 3 | codex | major | The jsdom inset test passes without `v-snack-footer`, the static z-index test proves numbers not stacking, and no browser test combines the sheet with a snack | amended: the component test stubs the footer's geometry so dropping either directive fails; a new browser case on both engines forces a failed Accept and hit-tests the card, Continue, "Not now" and the card's uncovered row; the loader-over-card step runs on Chrome only, since Firefox will not end its event page under an open page (`fixtures/browser/index.ts:183`), and Firefox rests on Fact 22's stacking argument; the static z-index test is dropped |
| 4 | codex | minor | E29's pin tests `BarrierOverlay.test.ts`'s sample template, not the real barrier; the new DetailsTable comment drops the `aria-hidden` reason | accepted: the exact pin moves to `AccountIntegrityBarrier.test.ts:61`, the generic fixture stays; the comment keeps its reason and gains one clause |
| 5 | codex | minor | The guard promises more than it can ("the AST reads exactly what renders"), and blanket throw exemptions miss E20, E21 and E44 | accepted: position exemption for log calls only, a reviewed list of 40 entries, `packages/extension-messaging/src` in its roots, scanner cases, and a header stating its limits |
| 6 | codex | minor | Fact corrections (1, 2, 12, 17, 19, 20), "every hidden snack times out", the Send "Details" action, and the Storybook build | accepted: Facts 1, 2, 12, 17, 19, 20 corrected (17 re-run), Facts 21 to 23 added; § T and Security say an error card stays and name Details; P5 runs `build-storybook`; Delivery reconciles the three shared plan files |
| 7 | codex final | major | Two PXE store errors (`opfs-store.ts:58`, `:222`) reach Add token's error line (`NewTokenPopup.vue:255`, `:334`) and sit outside the guard's roots | accepted: E45 and E46 join the table with the bare split and Fact 24 traces the path; the guard's roots gain `packages/aztec-runtime/src/pxe/opfs-store.ts` alone, since the rest of the package holds 18 literals no realistic path shows; the callee rule covers `log.warn`, so `:221` stays exempt, and it matches no other call; one follow-up for user copy; the count is 46 throughout |
| 8 | codex final | minor | Base, citations and pins describe older trees and pending branches; the backup skip-copy follow-up at `follow-ups.md:81` should close with the plan | accepted: base `0f37ab78`, every Fact, row, pin and leave re-read there, and each of codex's moves holds; Fact 1 re-derived; Fact 20 is now the `amount-honesty` overlap; closure removes `:81` with `:85-88`. Found in this revision beyond codex's list: E22's case-sensitive pin (`journal-state.test.ts:627`), E28's input copies (`onboarding/pages/import.test.ts:150`, `:186`), E11's substring (`NewTokenPopup.test.ts:356`), the E26 to E28 constant consumers, `full-backup-restore.ts:189` (was `:186`), `firefox.ts:372` (`:381` was wrong on both trees), `.wrapper` at `app.vue:495-505`, and the passkey dialog's routes (Fact 14) |
| 9 | codex final | minor | P5 proves the raised host, not its return to the ordinary layer; the sheet's false `visibility` emission does not test the shell's binding | accepted: the new browser case presses Continue again after the failure and expects `#toast`'s computed `z-index` `auto` once the sheet closes; S4 expects `9500` while its sheet shows and `auto` after "Not now"; both browsers |

### Decision ledger

- **Outline**: one outline (a light plan drafts one).
- **Rejected alternatives**: the sheet lowered to 1999 (codex finding 2); the package's snack
  layer raised globally; snacks held while the sheet is open (O2 (b), not picked); a line-regex
  guard; a runtime split helper; blanket throw exemptions (codex finding 5); the whole
  `packages/aztec-runtime/src` in the guard's roots (row 7).
- **O1's wording**, under the owner's delegation ("Please, evaluate yourself, just don't over-use
  them. feel free to ask gpt sol"): the driver reworded only the strings whose bare split reads
  clipped or wrong, and asked GPT-5.6 Sol (session `01a0f2c4-5211-7053-84d4-b795f9ff8a11`, high),
  which agreed with each, chose the colons for E25 to E28, and judged the set "restrained enough".
  E45 and E46 stay the bare split; mapping them to user copy is its own owner decision
  (Follow-ups).
- **Disputed**: none.

Realism (the owner, 2026-09-29: "let's cover realistic scenarios lol"); each line is decided, with
no fix, test or question unless it says otherwise:

- *"Lock did not persist"* (`profile/service.ts:927`) needs `chrome.storage.session` to refuse a
  delete: left as developer text.
- *The restore fence* (`restore-fence.ts:37`, `:41`) reaches "View Errors" only for a row with no
  profile id, which the import's id normalisation never leaves, or a profile deleted during its own
  restore: left as developer text.
- *"Passkey ceremony not wired"* (`full-backup-restore.ts:189`) needs a caller that omits the
  ceremony; its one caller passes one (`composables/useFullBackupImport.ts:492`, fed by
  `composables/useProfileImportFlow.ts:397-404`).
- *The backup migrator's reasons* (`backup-migrator.ts:168`, `:189`) need a real migration that is
  not backup-safe; pre-production has none.
- *The account-state network cap* (`normalize.ts:182`) is reached only by a hand-built backup over
  the cap.
- *A hostile token symbol in an arrival card over the sheet* can say only "Received 5 <symbol>",
  capped and sanitised, and approves nothing (§ Security).
- *`FieldWarning.test.ts:50-51`* in `packages/design` and `BarrierOverlay.test.ts:74-94` use "—"
  in sample text for generic components; they pin no shipped string and stay.
- *The PXE store's two errors* (E45, E46) are realistic: a retry after a stalled store open, or a
  store reopened after a network reset, needs no fabricated backup (codex's final pass). They join
  the table.
- *The node factory's four URL refusals* (`packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:79`,
  `:87`, `:95`, `:107`) are unreachable: `RpcUrlSchema` refuses the same URLs first, with its own
  dash-free message, at every add, update, storage and snapshot boundary
  (`apps/extension/src/wallet/services/network/spec.ts:145-177`).
- *The rest of `packages/aztec-runtime/src`*: its profile-generation and purge fences
  (`pxe/service.ts:760`, `:840-852`, `:919`; `pxe/lifecycle-coordinator.ts:42`) need a profile or
  chain deleted mid-operation; `pxe/chain-runtime.ts:282` throws only in CI's required mode
  (`apps/extension/src/offscreen/index.ts:89-95`); `:402` is a dispose failure. They stay outside
  the guard's roots, and its header says so.

Realistic, and covered: the corrupt passkey-key restore (E44), the PXE store's errors on Add token
(E45, E46), and a snack over the sheet from a background restart (the browser case).

### Follow-ups

- **Add token shows the PXE store's developer errors verbatim** (`packages/aztec-runtime/src/pxe/opfs-store.ts:58`,
  `:222`, through `apps/extension/src/popup/components/popups/NewTokenPopup.vue:334`); mapping
  them to user copy is an owner copy decision. Moved to `implementations-plan/follow-ups.md` when
  the plan closes.

## Approval

The final fresh codex pass conditionally approved (confidence high); its three conditions are
applied in this revision. The owner answered O1 to O4 on 2026-09-30 (§ UI asks). Cleared to build.
The delivery boundary (the same rule in P6 and Delivery): the PR opens and CI runs before the
blanket sign-off; it merges once the blanket sign-off is quoted in this plan, every required check
is green on the head, and the codex loop has converged.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/copy-polish/lessons/phase-N.md`. Unit and component commands
run from the workspace named. Every phase writes its failing test first and records the red run
in its lessons file before the fix.

### P0 · Plan in the tree ✓

1. First commit: `implementations-plan/copy-polish/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`.

Assumptions: none beyond Fact 2.
Gate: `bun run lint`, `bun scripts/ci-cd/plans/check.ts` exit 0.
Layers: lint, CI-gating.

### P1 · The 46 strings, and the guard (E)

1. Write `apps/extension/src/utils/copy-dash-ban.test.ts` (§ E · The guard) with its 40 reviewed
   entries and its scanner cases. Red on the branch base: it lists exactly the 46 strings of the
   table and no other hit, and the stale-entry case is green. Record the run, and the arguments its
   position exemption skipped: 38, recon's 37 and `opfs-store.ts:221`. A hit outside the table and
   the list means `dev` moved since `0f37ab78`: classify it; a string a screen shows joins the
   table with the bare split and is named in the PR body for the blanket sign-off.
2. Edit the 46 strings exactly as the table's New column, with their pins and input copies, one
   commit per group (snacks, lines, journal, screens), and move E29's exact pin to
   `AccountIntegrityBarrier.test.ts:61`.
3. The CLAUDE.md bullet (Ask C4).

Assumptions: Facts 1, 3 to 9, 18, 24.
Gate, from `apps/extension`: `bun --bun vitest run src/utils/copy-dash-ban.test.ts` green, and
each pin file of the table green; from the root: `bun run lint`, `bun run typecheck:all`,
`bun run test:all` (which runs `packages/extension-messaging` and `packages/aztec-runtime` too),
`bun run test:ci-gating` exit 0.
Layers: lint, typecheck, unit, component, CI-gating.

### P2 · The glossary's `where` (G)

1. Red: `utils/glossary.test.ts` and `popup/pages/settings/glossary.test.ts` expect the new line.
2. `utils/glossary.ts:46`.

Assumptions: Fact 15.
Gate, from `apps/extension`: `bun --bun vitest run src/utils/glossary.test.ts src/popup/pages/settings/glossary.test.ts`
green; `bun run lint` exit 0.
Layers: lint, unit, component.

### P3 · The snack over the Terms sheet (T)

1. Red, in `components/LegalAcceptanceSheet.test.ts`:
   - with the sheet visible on a route whose meta shows the nav, a mounted `ToastManager`, the
     viewport stubbed at 600 px and the "Not now" footer's box at top 560, height 40 (the pattern
     of `ToastManager.test.ts:91-103`): the inset is 52 px. Without `v-snack-footer` it would be
     12; without `v-snack-sheet`, 76; today it is 76;
   - the sheet emits `visibility` true when it shows and false once an accept lands;
   - a rejected `accept` opens the error snack while the sheet stays visible (green today; it
     holds the path the layer change is for).
2. `LegalAcceptanceSheet.vue` per § T (the two directives, the emit), and `popup/app.vue`'s host
   class bound to it.

Assumptions: Facts 10 to 14, 22.
Gate, from `apps/extension`: `bun --bun vitest run src/components/LegalAcceptanceSheet.test.ts src/composables/snackInset.test.ts src/components/ui/ToastManager.test.ts`
green; `bun run lint` exit 0.
Layers: lint, unit, component.

### P4 · A-27's spoken name (A-27)

1. Red: the `test.todo` at `DetailsTable.test.ts:92` becomes a case expecting
   "Unknown contract 0x0c1e…5a7f: simulate, add, transact" and "Unknown contract 0x0643…15fd: add,
   transact" for the wire-shaped fixtures; the regex case above it (`:86-90`) goes, since the new
   case is exact.
2. `DetailsTable.vue:59-64`.

Assumptions: Facts 16, 17.
Gate, from `apps/extension`: `bun --bun vitest run src/components/composite/capabilities/DetailsTable.test.ts`
green, 0 todo; `bun run lint` exit 0.
Layers: lint, component.

### P5 · Browser proof and the arc gate

1. **The driver method**: `evaluateInBackground(owner, body)` on `BrowserDriver`
   (`tests/e2e/fixtures/browser/index.ts`), Chrome through the service-worker target's worker,
   Firefox through `evaluateInBackgroundPage` (`firefox.ts:372`). A browser difference lives on
   the driver (`tests/e2e/FIREFOX.md`).
2. **The browser case**, in `tests/e2e/legal-acceptance.test.ts`, red before P3's change on both
   engines: with the sheet showing and the consent box ticked, the background's
   `chrome.storage.local.set` is made to refuse the acceptance key once (Inference 2), and
   Continue is pressed. Then: the sheet is still visible; `elementFromPoint` at the card's centre
   lands in `snackbar`; the card's bottom is 12 px (±1) above Continue's row; `elementFromPoint`
   at Continue's centre and at "Not now"'s centre land on those buttons; a point in the card's row
   beside the card lands in `legal-sheet`. Then, on Chrome only, with the sheet and the card still
   up, the background is stopped and `elementFromPoint` at the card's centre lands in
   `global-loader` (the reason key `backgroundKillUnderPage`, `fixtures/browser/index.ts:183`),
   and the case waits for the loader to clear. Last, on both, Continue is pressed again (the
   refusal was one-shot, and a restarted background holds none): the acceptance lands, the sheet
   closes, and `#toast`'s computed `z-index` is `auto`.
3. **S4 gains two assertions** around its first decline (`declineFromSheet`): while the sheet
   shows, `#toast`'s computed `z-index` is `9500`; once the declined screen shows, `auto`. The
   existing cases keep proving that "Not now" takes a real pointer click.
4. Every row of the local gates: `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
   `bun run test:ci-gating`, `bun run build`, `bun run --cwd apps/extension build-storybook`.
5. Smoke e2e on Chrome and Firefox: per browser,
   `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`,
   then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`. It carries
   `legal-acceptance.test.ts` (the new case, S4's two assertions, and the sheet still covering the
   page with "Not now" taking real pointer input) and `imported-account-lifecycle.test.ts` (E4,
   E20).
6. Network e2e, retry 0, `NODE_OPTIONS=--dns-result-order=ipv4first`:
   `tests/e2e/network/snack-placement.test.ts` (E1, E2) and `tests/e2e/network/cap-window.test.ts`
   (the Details rows) on Chrome (prover on) and Firefox (`NULO_E2E_PROVERLESS=1`).
7. Flake bar: `legal-acceptance.test.ts`, three consecutive retry-0 runs per browser.
8. `bun run e2e:reap`.

Assumptions: the gates of P1 to P4; Facts 21 to 23; Inferences 2, 3.
Gate: all of the above exit 0; each run's summary in `lessons/phase-5.md` with executed, passed
and skipped counts. A skipped network spec is not a pass; the one Chrome-only step is reported as
such on Firefox.
Layers: typecheck, lint, unit, component, CI-gating, build, Storybook build, e2e,
e2e-live-network.

### P6 · The blanket sign-off

No alternative is built: O1 to O4 are answered (§ UI asks). This phase captures the built result
for the blanket sign-off.

1. Captures at the popup's real size (360 × 600), states forced in a capture-only build that is
   never committed; Chrome, dark, unless a row says otherwise:

   | What | State | Browser | Theme |
   |---|---|---|---|
   | The full table | today and new side by side, a faithful HTML table in the real font, the eleven reworded strings marked | n/a | dark |
   | E1 | the fee-estimate snack on the approval window | Chrome | dark |
   | E24 | a History row stopped by a lock | Chrome | dark |
   | E31 | the migration barrier, update interrupted | Chrome | dark |
   | E25 to E28, E44 | the import's "View Errors" viewer holding each record | Chrome | dark |
   | E45 | Add token's error under Submit (a capture-only build may force it) | Chrome | dark |
   | O2 (a) | the sheet after a failed Accept, the error card above Continue's row | Chrome, Firefox | dark, light |
   | O3 (b) | the unknown row's accessible name and role, as text from Chrome's accessibility tree: "Unknown contract 0x0c1e…5a7f: simulate, add, transact", "button, collapsed" | Chrome | n/a |
   | O4 (a) | Settings → Glossary, the Apps section | Chrome | dark |

2. One page for the owner: the captures, the count (46) and the eleven reworded strings, and the
   blanket sign-off.
3. Record the blanket sign-off here, quoted.

Blanket sign-off: pending.

Gate: the delivery boundary (§ Approval): the PR may open before this gate; it does not merge until
the blanket sign-off is quoted in this plan.

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P5 is green and before any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't?"), and these
   two rules, verbatim in the first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting; apply the accepted ones,
   commit each fix separately, log the round (consult and verdict) in `lessons/phase-5.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope. It never
   rewords copy; a wording finding goes to the owner.
4. **Delivery** (below), the first time a PR is opened.

## Delivery

- Single arc, one branch `chore/copy-polish`, one PR off `dev`, plain `gh pr create` after the
  loop converges; then `gh pr checks --watch`.
- Title: `fix(copy): no clause em dashes, a snack over the terms sheet, a-27 row names`
  (76 characters).
- Commits: conventional, lower-case, signed; at least one per phase, fixes separate.
- PR body: summary, the UI impact table, O1 to O4 with the owner's quoted answers, the blanket
  sign-off (pending until P6's captures, then quoted), the guard's red run, the string table's
  count, test evidence with e2e counts, and the files below for sequencing.
- **Overlap.** The one open plan that shares a file is `amount-honesty`, on `popup/pages/send.vue`
  (its amount wiring, not E2's line, Fact 20); `popup/app.vue` and the e2e browser fixtures
  sequence with any plan that edits the shell or the driver. New copy anywhere in the guard's
  roots is held to it once this lands. Merge `dev` in before the final gate if another plan lands
  first.
- **Shared plan files.** Immediately before delivery, reconcile `implementations-plan/index.md`,
  `follow-ups.md` and `lessons.md` against `dev` by reading what other branches added, not by
  trusting a clean merge; no three-dot diff across squash ancestry stands in for that read.
- **Merge boundary** (§ Approval): by the driver under the owner's standing authorization, once
  the blanket sign-off is quoted here, every required check is green on the head, and the codex
  loop has converged.
- Closing the plan, in the same PR: the `## Outcome` block, lessons promoted, the five entries it
  takes removed from `implementations-plan/follow-ups.md` (`:81`, `:85-88`), and its one open
  follow-up moved there.

## Seeds

Cleared to build (§ Approval). Use exactly one per session.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/copy-polish/plan.md. Done when the transcript shows every phase ✓ in plan.md with its validation gate reported passing, the red run recorded before each fix (the guard listing exactly the table's 46 strings on the branch base, with 38 log arguments exempt by position; the Terms browser case red on both browsers before P3), LESSONS_FILE=implementations-plan/copy-polish/lessons/phase-N.md printed per phase, P5's smoke and network e2e counts on Chrome and Firefox recorded with no skipped network spec, the legal-acceptance flake bar three of three per browser, bun run --cwd apps/extension build-storybook exiting 0, a resumed /codex high pass quoted with no new material findings, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 in the transcript. /code-review is off and was not run. Merge only once the blanket sign-off is quoted in plan.md, every required check is green on the head, and the codex loop has converged. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/copy-polish/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; take the next unchecked step; write its failing test first and record the red run; after each edit run bun run lint and the phase's vitest command; commit and push the branch. A technical decision: /codex high, logged in lessons/. A UI or wording question: hold it for the owner. Phase gate green: paste it, mark ✓, print LESSONS_FILE. A skipped network spec is not a pass. All phases ✓: the Post-implementation loop, then gh pr create and gh pr checks --watch, then report and stop. Merge only once the blanket sign-off is quoted, every required check is green on the head and the codex loop has converged; hard limits stay hard.
```
