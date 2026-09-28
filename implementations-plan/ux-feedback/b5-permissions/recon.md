# Batch 5 · Permissions: recon

Read-only survey of the tree at `feat/ux-1-first-run-wording` (batch 1 built; batches 2 to 4 planned,
not built), 2026-09-24. Two raw reports seeded it (a repo-wide reuse sweep and an authwit-path
mapper); every claim below was re-checked against the code, and the claims that were wrong are
listed under [Corrections](#corrections-to-the-raw-reports). The plan audit's round 1 (codex and
fable) found further errors in this file; they are corrected in place and listed under
[Plan-audit corrections](#plan-audit-corrections). Paths are repo-relative.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Window shell: load, cancel, lock, profile change, reject on unload | `apps/extension/src/composables/useDappApprovalWindow.ts`, wired at `popup/windows/capabilities/index.vue:113-136` | reuse as-is |
| Status strip | `components/composite/DappStatusStrip.vue`, mounted `index.vue:325-329` | reuse as-is (spec: "as today") |
| Identity block, action line | `components/composite/DappIdentityBlock.vue:26` (`actionLabel`), `:57` | reuse as-is; the caller's string changes (`index.vue:336`) |
| Network banners (U3) | `Banner` in `index.vue:340-359` | reuse; one word changes (`:357`) |
| Footer, error tooltip, cancelled overlay (U10) | `DappApprovalFooter.vue` (`index.vue:429-441`), `DappCancelledOverlay.vue` (`:443-447`) | reuse as-is; confirm label changes (`:436`) |
| Group label with count | `packages/design/src/ui/SectionLabel.vue:132-157`; its CSS equals the mock's `.n-seclabel` (`mocks/src/nulo.css:130-131`) | reuse as-is |
| Bordered row container | `components/ui/Settings/ItemsContainer.vue:191-195`; equals `.n-items` (`nulo.css:132`) | reuse as-is |
| Switch | `packages/design/src/ui/Toggle.vue:22-113`; equals `.n-switch` (`nulo.css:443-446`) except the focus ring (`nulo.css:447`; `Toggle.vue:61-63` removes the outline) | reuse; the ring is added by the row's own style, not in `Toggle.vue` |
| Row icons | `packages/design/src/core/MaterialIcon.vue` over the bundled `packages/design/src/fonts/MaterialSymbolsOutlined.woff2` | reuse as-is. Verified by parsing the font's GSUB table (4,229 ligatures): `signature`, `play_circle`, `task_alt`, `mail_lock`, `code_blocks`, `visibility`, `add_circle`, `contacts`, `help`, `content_copy`, `check`, `chevron_right`, `info` all resolve |
| SVG icons the mock uses (`#i-check-circle`, `#i-circle`, `#i-warning`, `#i-globe`) | `packages/design/src/internal/icons.json` has `check-circle`, `circle`, `warning`, `globe` | reuse as-is (`Icon`) |
| Account row (select, lock, alias input) | `popup/windows/capabilities/AccountSelectRow.vue:34-99` | adapt: the Alias label and ⓘ (`:80-90`) become the rename link (U5) |
| Dotted term with a glossary definition | none in the tree; batch 3 adds `components/composite/DottedTerm.vue` and `utils/glossary.ts` (b3 plan § Dotted term, keys `authorization`, `name-for-this-app`) | reuse batch 3's; adapt with a button variant for "Rename for this app" (the mock's `.n-linkbtn.n-term`, `nulo.css:465-466`, is a control, not `cursor: help`) |
| Per-app value stored on the session, with a Settings toggle | `trustedVerification`: type `dapp-session/spec.ts:56`, schema `:87`, setter `service.ts:247-251`, RPC list `service.ts:31-45`, client `client.ts:25-39`, UI `DappSessionVerification.vue:27-33`, page `[id].vue:68,143-146` | copy the setter's plumbing; the stored value is an object `{ broad }`, not a boolean (fact 7) |
| Atomic capability decision write | `CapabilityDecision` (`packages/wallet-bridge/src/services-contract.ts:109-127`), `DappSessionService.applyCapabilityDecision` (`dapp-session/service.ts:301-341`) | adapt: one optional field |
| Popup answer → decision merge | `mergeGrantsAndRejections` (`dispatcher.ts:402-432`), `collectNewGrants` (`:487-512`) | adapt: carry the flag; grants engine unchanged |
| Silent-vs-window fork for `createAuthWit` | `handleCreateAuthWit` (`dispatcher.ts:979-1020`), fork at `:990` | adapt: add the flag to the silent condition |
| Confirmation window for an authorization (U6) | execute window, `OperationCard.vue:476-518` (the `aztec_createAuthWit` branch), title at `:322` | reuse; the title becomes a local override |
| Capability wire strings sanitizer | `sanitizeWireString`, `stripWireControl` (`dapp-session/capability-meta.ts:170-181`) | reuse as-is |
| Click-to-copy an address, sanitized | `copyWithToast(addr, openToast, "Address is copied", { sanitize: true })` (`components/ScopeAddress.vue:53`) | reuse the helper call; not the component (see Corrections 2) |
| Short address `0x0c1e…5a7f` | `trimAddress(a, 6, 4, "…")` (`utils/string.ts:11-14`) | reuse as-is |
| Contract names Nulo vouches for | none as one lookup. Searched `getContractArtifact`, `TokenInfo`, `FpcType`, `isProtocol`, `ProtocolContractAddress`, `default-tokens` under `apps/extension/src/wallet/services/**`. Candidates: protocol FPCs (seeded names `fpc/service.ts:28-29`, addresses `getOrComputeProtocolAddresses`, `:90-101`, over `fpc/protocol-fpcs.ts:19-27` since #690), the token seeder (`token/seeder.ts`), the protocol contract addresses | build new: `wallet/services/dapp-interaction/known-contracts.ts`. The only existing name sources a dApp or a social-engineering attack cannot set are the protocol ones |
| Details table (contract × simulate/add/transact, expandable) | none. Searched `n-dt`, `details`, `grid-template-columns` under `apps/extension/src/popup/windows/**`; `CapabilityDetailPanel.vue` is a per-capability accordion (`:48-137`) | build new, under `components/composite/capabilities/` beside `CapabilityDetailPanel`: Storybook only builds `src/components/**` stories (fact 26); `CapabilityDetailPanel` stays for Settings |
| Row target and in-row action | batch 4's `RowTarget.vue` (stretched `<button>`/`<a>`) and `RowAction.vue` (24×24 sibling button, `@click.stop`) | reuse for the Details rows and their copy action |
| "Any contract" test | inline everywhere: `scope === "*"` (`ScopePatternList.vue:9-13`), `matchesPattern` (`method-scope-checkers.ts:38-40`), `inAddressList` (`:54-57`) | build new: one exported predicate in `@nulo/wallet-bridge`, used by the popup defaults and the dispatcher |
| Grant builder (what Connect grants) | `buildGrantedCaps` (`index.vue:215-226`), `buildGrantedAccountsCap` (`build-items.ts:113-117`) | adapt: one `buildGrant` in `build-items.ts` replaces both (they strip `canCreateAuthWit` on an unticked rider, which Off = ask removes). It is not a security boundary: the dispatcher stores raw dApp objects on two paths the popup never touches (fact 10), so field projection belongs in the background |
| Capability field projection | none. Upstream `CapabilitySchema` (`@aztec/aztec.js` `wallet.js:154-164,220`) exists, but its request-side accounts variant has no `accounts` field (the granted variant adds it), so a parse drops the explicit list `checkCreateAuthWit` enforces (`method-scope-checkers.ts:279-292`), and it parses addresses into objects the MAC canonicalizer would see differently (`dapp-session/integrity.ts:34`); the dispatcher also avoids `WalletSchema` by design (`dispatcher.ts:570-571`) | build new: a local per-type field allowlist in the dispatcher, wire-shaped |
| Permission row model and defaults | `buildCapabilityItems` (`build-items.ts:33-103`), unknown default-Off at `:75-81` | adapt: same file, row model instead of cards; the unknown invariant and its tests stay |
| Settings → Connected apps → app | `popup/pages/settings/connected-apps/[id].vue:176-297`; `GrantedCapabilitiesList.vue` | adapt: one group above "Granted permissions" (`[id].vue:283-287`) |
| e2e capability driver | `approveCapabilities`, `getCapItems`, `waitCapabilitiesReady` (`tests/e2e/fixtures/popups.ts:189-240,407-423`) | adapt: switch rows by key, rename before alias |
| e2e "no window opened" probe | `callExpectingNoPopup` (`tests/e2e/fixtures/playground.ts:242-269`) | reuse as-is |
| Playground authorizations | `apps/playground/src/sections/authwit.ts:78-124` (`pg-btn-createAuthWit-callIntent`, `-innerHash`), bundles `apps/playground/src/lib/bundles.ts:49-123` | reuse as-is; no dApp change |

## Facts the plan relies on

### The enforcement path

1. `dispatch()` reads the session once, at entry, anchored to the session's profile
   (`dispatcher.ts:650`), and threads that snapshot through every handler.
2. Before any handler runs, `enforceMethodAndScope` (`dispatcher.ts:673-725`) runs the arg schema,
   `assertAuthRelevantArgShape` (`:575-615`), `enforceCapability`, then the scope checkers. For
   `createAuthWit`, `checkCreateAuthWit` (`method-scope-checkers.ts:276-332`) rejects: no
   `canCreateAuthWit` or an account outside an explicit list (`:279-292`); a call intent outside a
   held transaction/simulation scope (`:298-309`); an inner hash whose consumer no scope covers
   (`:312-324`); a raw message hash, always (`:327-331`). No window opens for any of these.
3. `handleCreateAuthWit` (`dispatcher.ts:979-1020`) is reached only after those. It signs silently
   iff `isCreateAuthWitCoveredByTxOrSimulationScope` (`:990`; `method-scope-checkers.ts:270-274`),
   which is false for every inner hash and for a call intent when the dApp holds no transaction or
   `simulation.transactions` scope (`:226-243`, `hasTxCaps=false → permitted=false`). Otherwise it
   builds an `AztecCreateAuthWitRequest` and calls `dappInteractionService.execute` (`:1010-1019`).
4. That window always opens: `aztec_createAuthWit` is `AccessLevel.Transactions`
   (`dapp-interaction/service.ts:88`), and every wallet-sdk session is created with
   `confirmationLevel = AccessLevel.Transactions` (`wallet-sdk/background.ts:1034-1040`), so
   `isConfirmationNeeded` returns true at `service.ts:664`.
5. Batch legs re-enter `dispatch()` (`dispatcher.ts:754-763`), so a `createAuthWit` inside a batch
   takes the same gate.
6. Only three `account.createAuthWit(` call sites exist: `execution/service.ts` (this path),
   `execution/tx-request-builder.ts:166` and `execution/dapp-send-executor.ts:1018` (both inside an
   approved send). Discovered private authwits and `grantPublicAuthwit` never reach the gate and are
   already confirmed by their send's own window.
7. Messages on one wallet-sdk session run one at a time: `onWalletMessage` chains each on the
   session's baton (`wallet-sdk/background.ts:453-505`), and a `createAuthWit` gets no
   `onExecutionEnqueued` hook, so the next message waits for its window to settle. The baton is
   keyed by the **wallet-sdk** session id (`:453-455`), while the `DappSession` row is found by
   `(origin, chainId, profileId)` (`dapp-session/service.ts:132-134`): two tabs of one origin are
   two wallet-sdk sessions with separate batons on **one** row, so two capability windows for that
   row can be open at once and their decisions can land in either order. A stored consent must
   therefore record what it was given against, not rely on serialization.
8. A closed window settles the handle as a user close (`window-manager.ts:119-125`); an
   interaction times out after 10 minutes (`dapp-interaction/service.ts:59,444`). Both reject the
   dApp's call when they happen before the service accepts the approval; an accepted approval
   detaches its window before it runs (`dapp-interaction/service.ts:199-215`), and
   `resolveInteraction` stores the popup's result without validating it.
9. Only trusted same-extension contexts reach `resolveInteraction` and the session setters (not
   only this popup): service ports refuse any sender that is not a same-extension page
   (`packages/extension-messaging/src/core/sender-auth.ts:17-23`, checked on connect in
   `background/service.ts:38-48`).

### Grants and storage

10. The popup's `granted[]` echo is what gets stored for an approved type: `collectNewGrants` takes
    the last echoed entry that differs from the stored grant, else the delta's requested shape
    (`dispatcher.ts:493-508`). Today's accounts echo spreads the dApp's own object
    (`build-items.ts:113-117`), so any extra field a dApp puts in its request is persisted. Two
    paths store the dApp's raw object without the popup at all: the `?? plan.delta.find(...)`
    fallback (`:508`) and `ensureAccountsGrant` pushing the delta's accounts cap (`:466-478`). A
    manifest naming one known type twice passes the delta unchanged (`:366-377`), and
    `replacementFor` stores the last differing entry (`:493-499`).
11. `DappSessionSchema` is a plain `z.object` (`dapp-session/spec.ts:74-95`): a field it does not
    list is stripped on every read. Every other key of the row is covered by the row MAC
    (`dapp-session/integrity.ts:29-32`, `mac-storage.ts:22-45`), and a row failing it is dropped
    (`mac-storage.ts:85-103`); a schema-invalid row is kept but hidden (`mac-storage.ts:64-66`).
    Either way the dispatcher finds no session and the dApp's call is refused: fail closed, but
    as a refusal, not as "ask".
12. `IDappSessionRef` (`packages/wallet-bridge/src/session-types.ts:58-67`) is what the dispatcher
    sees; it does not expose `trustedVerification` today.
13. Sessions are per `(origin, chainId, profileId)` (`spec.ts:43-48`); the dispatcher's lookup is
    anchored to `ctx.profileId` (`dispatcher.ts:648-650`). A profile switch cannot reach another
    profile's row.
14. dApp sessions are not a backup slice: the registry (`backup/backup-migration-registry.ts:196-215`)
    lists profile, account, imported keys, token, token balance, contact, transaction, auth
    registry, config and account state only.

### The window today

15. The popup builds `granted` from ticked new cards plus every existing card, and pushes the
    accounts cap through `buildGrantedAccountsCap`, which strips `canCreateAuthWit` when the rider
    card is unticked (`index.vue:215-226`, `build-items.ts:113-117`).
16. Unknown types render "Unknown permission" and default unticked (`build-items.ts:63-84`,
    `capability-meta.ts:194-215`); the dispatcher lets them through untouched
    (`dispatcher.ts:268-285`).
17. Strings today: action `is requesting permissions on <chain>` (`index.vue:336`); accounts label
    `Select accounts to share` / `Add accounts to share` (`:363`); sections `New permissions
    requested` / `Already granted` (`:383`, `:407`); banner `Approve as is` (`:357`); footer
    `Approve` (`:436`); rider card `Act on your behalf` (`capability-meta.ts:41-47`); badges
    `unrecognized`, `previously denied` (`CapabilityCard.vue:101-106`); Alias label and ⓘ
    (`AccountSelectRow.vue:80-90`).
18. The capability payload carries the whole stored session, re-read when the window opens
    (`dapp-interaction/service.ts:411-416`), not the dispatch snapshot. The window must take the
    consent and the held grants from `CapabilityParams`, which the dispatcher fills from its
    snapshot.
19. The execute window renders `humanizeOperationKind(op.kind)` as every non-send card's title
    (`OperationCard.vue:322`), `"Create authwit"` for this kind (`humanize.ts:17`, pinned by
    `humanize.test.ts:13`). Body labels already match U6 (`OperationCard.vue:325-330,476-518`);
    shell strings `wants to execute the following`, `Requested operations`, `Confirm`
    (`execute/index.vue:629,648,688`).
20. The Settings app page shows, in order: identity, Shared accounts, Session allowances,
    Confirmation policy, Granted permissions, Connection verification (`[id].vue:195-295`), and
    updates from `onDappSessionUpdated` (`:149-156`).

### Playground and e2e

21. The `transaction` bundle requests `accounts` with `canCreateAuthWit`, `transaction` scope `"*"`
    and `simulation` scopes `"*"` (`bundles.ts:75-80`); `transaction-scoped` lists one transaction
    pattern but keeps `simulation.transactions: "*"` (`:90-95`); `data` requests
    `privateEvents: { contracts: "*" }` (`:96-100`). Every bundle that requests authorizations
    (`accounts`, `transaction`, `transaction-contracts`, `transaction-scoped`, `full`,
    `:64-119`) lists `simulation.transactions: "*"`, so none can start On and none renders S1's
    shape; the other bundles request no authorizations.
22. The call-intent button signs `transfer_public_to_public` on the typed consumer with
    `args: []` (`authwit.ts:78-104`); today's spec accepts `ok` or `error` for it
    (`authwit-variants.test.ts:59-63`), so whether signing succeeds is unverified.
23. The connected-apps list navigates by `handleOpenSession` (`connected-apps/index.vue:67-69`); its
    row has no testid (only `session-disconnect`, `:160`). Batch 4 turns the row into a
    `RowTarget` button, which is where a row testid belongs.

### Found by the plan audit

24. `dataRequestCovered` (`dispatcher.ts:252-261`) returns `existing.length > 0` when the request
    lists no private-event contracts, and never checks `addressBook`: after a grant with private
    events but no address book, an address-book re-request counts as covered and opens no window.
    `addressBook` itself is enforced at call time (`method-scope-checkers.ts:377-378`).
25. `enrichGrantedCapabilities` answers with the requested cap for every type but accounts
    (`dispatcher.ts:1319-1320`), so a `data` grant narrowed by the popup is reported to the dApp
    as requested.
26. Storybook's globs are `src/components/**`, `src/design/**` and the design package
    (`apps/extension/.storybook/main.ts:23-27`); a story under `src/popup/**` is never built.
27. The existing refusal errors in `checkCreateAuthWit` interpolate the account, the contract and
    the dApp's function name (`method-scope-checkers.ts:290,306,321`). The background logs the
    error at Error level (`wallet-sdk/background.ts:1178-1183`), and the logger keeps its
    URL-scrubbed, length-capped message (`wallet/logger/utils.ts:169-175`).
28. `OperationCard.createAuthwit.test.ts:13-18` builds fields as `0x` + 64 repeated hex digits
    (`a`, `d`, `c`, `e`, `f`), all above the BN254 modulus; the installed `@aztec/foundation`
    field constructor throws on them (`curves/bn254/field.js:39-40`).
29. An empty alias field saves the account's wallet name as the alias
    (`popup/windows/capabilities/index.vue:229-237`, `accountAliases[caip] || acc.name`).
30. The `cap-widening` e2e is the accounts-membership flow on the `accounts` bundle
    (`cap-widening.test.ts:64-81`); it cannot exercise a scope widening.
31. A disabled `Toggle` renders a lock glyph instead of the knob (`packages/design/src/ui/Toggle.vue:37-42`).
32. `CapabilityCard`'s `cap-toggle` is a click-only `Flex` (`CapabilityCard.vue:85-93`);
    `AccountSelectRow`'s root handles Enter and Space for selection (`AccountSelectRow.vue:41-46`),
    so a control inside it must stop propagation, as the alias block does (`:77-78`).
33. The capabilities banner's "Approve as is" is part of the description sentence; its button is
    "Switch wallet to X" (`index.vue:340-359`).

### Found by the plan audit, round 2

34. `computeCapabilityDelta` builds `existingCaps` without any type that has a stored rejection
    (`dispatcher.ts:379`), and that is what the popup receives as `existingGrants`
    (`:1180`); a declined widening keeps the type's older grant in force
    (`dapp-session/service.ts:320-327`), and the answer to the dApp is built from the stored
    grants (`dispatcher.ts:1197-1202`). A retained grant is therefore enforced and reported but
    invisible to the window.
35. `argsRequestCapabilities` is a crash guard, not a validator (`method-descriptors.ts:117-135`):
    nested scopes, flags and addresses pass unchecked. `checkCreateAuthWit` reads
    `canCreateAuthWit` by truthiness (`method-scope-checkers.ts:287`), and a scope that is a
    string other than `"*"` would throw inside `matchesScope`'s `scope.some` (`:51`).
36. With a transaction or `simulation.transactions` scope held, a call intent outside it is
    refused by `checkCreateAuthWit` (`method-scope-checkers.ts:301-308`) before the handler; a
    call intent reaches `handleCreateAuthWit` uncovered only when no such scope is held
    (`:226-243`).
37. `setCapabilityGrants` (`dapp-session/service.ts:259-263`) is called only when a new session
    is seeded with `[]` (`wallet-sdk/background.ts:1044`); it stays a trusted RPC method
    (`service.ts:41`, `client.ts:34`).
38. A re-request narrower than a held scope is covered (`scopeCovers`, `dispatcher.ts:217-232`),
    so it opens no window and stores nothing.
39. `AccountSelectRow`'s root is a `role="button"` with key handlers (`:34-46`) that already
    holds the alias `<input>` (`:71-98`): interactive content nested in a button role.
40. `data-privateEvents.test.ts` says in its header that an `ok` result needs the real `Token`
    `Transfer` event metadata and a transfer (`:14-20`); the playground sends a stub. The `data`
    bundle requests `addressBook: true` with `privateEvents: { contracts: "*" }` (`bundles.ts:96-100`),
    so with private events Off its grant keeps the address book and the call is refused as a
    scope violation (`method-scope-checkers.ts:205-212`).
41. `text.json`'s `06-row-list-U4` entry holds the U4 list one row per line, cells separated by
    tabs; S2's and S3's entries still carry round 3's authorizations row, and the broad
    on-line "For any call, on any contract." is a hidden switch state found only in
    `gen_i6r4.py:91`.
42. The U4 list marks three rows "· Any contract" (`gen_r5.py:158,160,166`); S3 draws the chip
    with the flagged icon on its simulation row (`gen_i6.py:248`).

### Found by the plan audit, round 3

43. The scoped bundles (`transaction-scoped`, `data-scopedEvents`) take their address only from
    the page URL's `?tokenAddress=`, falling back to `"0x0"` (`apps/playground/src/lib/bundles.ts:44-47`).
    `openPlayground` opens `?test=1` alone (`tests/e2e/fixtures/playground.ts:32`), and the
    specs that need the token fill `pg-input-tokenAddress` after the grant, which the bundle
    never reads. The manifest is built when `requestCapabilities` is clicked
    (`apps/playground/src/sections/connect.ts:48-53`); the playground's other sections read the
    input through `getInput` (`state.ts:69`). No e2e spec selects a scoped bundle today.
44. An approved `data` decision replaces the whole stored `data` record
    (`dispatcher.ts:408,422`; `dapp-session/service.ts:320-327`); a rejected one keeps it. A
    result of `{ addressBook: true }` against a held
    `{ addressBook: true, privateEvents: { contracts: [A] } }` therefore drops private events
    for A, while rejecting `data` keeps both.
45. On a membership-only accounts widening, the rider card renders as already granted
    (`build-items.ts:52`, `CapabilityParams.accountsMembershipOnly`,
    `dapp-interaction-protocol.ts:153-155`) and the decision keeps the stored accounts grant
    (`dispatcher.ts:409-414`).
46. `Toggle.vue:61-63` sets `.wrapper:focus { outline: none }`, the specificity of a one-class
    `:focus-visible` rule from a parent's module; today's locked or disabled account row is
    `tabindex="-1"` (`AccountSelectRow.vue:42`).
47. The local capability types declare `contracts.contracts`, `contractClasses.classes` and
    `transaction.scope` required (`packages/wallet-bridge/src/capabilities.ts:23-46`); coverage
    dereferences `requested.contracts.every` (`dispatcher.ts:206`) and enforcement
    `scope.some` (`method-scope-checkers.ts:51`). `@aztec/foundation`'s field constructor throws
    at or above `Fr.MODULUS` (`curves/bn254/field.js:39-40,158`), and `wallet-bridge` already
    depends on `@aztec/foundation`.

### Found by the plan audit, round 4 (tree rebased onto dev `9f11de70`)

48. A rejected type always joins the delta (`packages/wallet-bridge/src/dispatcher.ts:368`) and
    `reRequested` (`:378`), whatever the held grant covers; `existingCaps` drops it (`:379`)
    while its older grant stays in force. So after a declined `data` widening, the identical
    request folds the held field's row and badges only the new one under per-row newness, and a
    request for exactly the held record would open a window whose every row folds.
    `dataRequestCovered` (`:252-261`) is private. `contractClasses` is the exception to a
    field-aware fix (fact 52).
49. `checkCreateAuthWit` checks an inner hash with `callWithinTxOrSimulationScope(consumer, "*")`
    (`method-scope-checkers.ts:317-323`); `matchesPattern` (`:38-40`) passes a pattern for
    function `"*"` only when the pattern's own function is `"*"`. An inner hash is therefore
    refused before any window under `transaction-listed`'s one named-function pattern and
    reaches the window under `transaction` (scope `"*"`).
50. `@nulo/wallet-bridge` exports only its root (`package.json` `exports["."]`), and
    `src/index.ts:10-32` does not re-export `method-scope-checkers.ts`; the popup already imports
    the package root (`capabilities/index.vue`, `CapabilityCard.vue`, `build-items.ts`).
51. Base drift: the protocol FPC derivation moved into
    `apps/extension/src/wallet/services/fpc/protocol-fpcs.ts:19-27` (#690), which
    `FpcService.getOrComputeProtocolAddresses` (`fpc/service.ts:90-101`) calls; the seeded names
    are `service.ts:28-29`, written at `:227`, renamable through `updateFpc` (`:308`). The new
    `packages/aztec-runtime/src/fee-juice.ts` predicts min fees and names no contract. The tools
    app and the bridge packages left the repo (#691); only untracked `node_modules` remain.

### Found by the plan audit, round 5 (HEAD `8f0d79c2`)

52. `isCapabilityCovered` checks `contractClasses` by type alone (`dispatcher.ts:547-548`),
    unlike the other five known types. A grant and a rejection of one type coexist when two
    windows of one row resolve approve-then-decline: the approval replaces the grant and clears
    the rejection, the later decline adds a rejection and keeps the grant
    (`dapp-session/service.ts:323-335`). A covered request is answered by echoing the
    requested cap (`dispatcher.ts:1154-1159,1286-1321`), so a class-B request beside a class-A
    grant is answered as granted today when no rejection is stored, and enforcement refuses
    class B (`method-scope-checkers.ts:95-104`). With the rejection stored it reopens the window
    (`:368`), which fact 48's rule must keep for this type.
53. `BrowserDriver` (`apps/extension/tests/e2e/fixtures/browser/index.ts:48-140`) has no
    media-feature method and FIREFOX.md names none. Puppeteer 25.8.0's BiDi page sends
    `emulateMediaFeatures` through its CDP emulation manager, which throws
    `UnsupportedOperation` without CDP, as on Firefox. In-file Firefox skips follow
    `sw-resilience.test.ts:64-65` (`test.skipIf(isFirefox)` with a one-line reason).
54. The interim window's "Already granted" section renders `params.existingGrants`
    (`capabilities/index.vue:166-171,406-424`), which the dispatcher fills with
    `plan.existingCaps` (`dispatcher.ts:1180`), rejection-filtered (`:379`). `DataCapability`
    leaves `addressBook` and `privateEvents` optional (`capabilities.ts:47-51`), so
    `{ type: "data" }` passes today's code and joins the delta when nothing is held
    (`dispatcher.ts:543-546`). Existing dispatcher tests send it, and `{ type: "contracts" }`,
    as manifests and popup echoes (`dispatcher.test.ts:153,188,203,252,264,1528`); stored-grant
    fixtures elsewhere (`scope-enforcement.test.ts:79`, `queued-journal.test.ts:107`) never
    pass the request validator.

## Test impact

| Test | Where | What happens | Action |
|---|---|---|---|
| `createAuthWit keeps signing as args[0]`, `(covered) forwards the session fence`, `(covered) is refused without the session's own fence` | `packages/wallet-bridge/src/dispatcher.test.ts:1094-1116`, fixture `:1023-1041` | with the flag absent they route to the window (`interaction.execute` returns `[]`) and fail | the fixture's session sets the flag On; the three names gain "(On)" |
| requestCapabilities decision tests | `dispatcher.test.ts:142`, `:553-640`, `:1650`, `:1772`, `:2386` | unchanged unless they assert the decision object's exact keys | re-run; any exact-key assertion gains the new optional key |
| bare-shape manifests and echoes | `dispatcher.test.ts:153,188,203,252,264,1528` (`{ type: "data" }`, `{ type: "contracts" }`) | refused by the new validation (C-19) | moved to valid wire shapes, each keeping its assertion (fact 54) |
| `build-items.test.ts` (rider cases, `buildGrantedAccountsCap`) | `popup/windows/capabilities/build-items.test.ts:40-141` | the rider no longer strips; `buildGrantedAccountsCap` is removed | rider cases rewritten onto the row table (`permission-rows.test.ts`); strip cases replaced by `buildGrant`'s table tests in the same commit |
| unknown default-Off cases | `build-items.test.ts:15-33` | the invariant stays | kept, moved onto the row model |
| `CapabilityCard.test.ts` | `popup/windows/capabilities/CapabilityCard.test.ts` | arc 5a: the toggle exists only on switch rows and becomes a keyboard switch control (fact 32); arc 5b: the component is deleted | 5a adjusts; 5b deletes it with `PermissionRow.test.ts` as the named replacement |
| `AccountSelectRow.test.ts` "alias block visible when selected", default/prop reads | `AccountSelectRow.test.ts:58-71` | the field appears only after "Rename for this app" | rewritten to press the link first |
| `chain-switch.test.ts` banner and action strings | `chain-switch.test.ts:176`, `:179` | `Approve as is` → `Connect as is`; `is requesting permissions on Local Network` → `wants to connect on Local Network` | new spec values |
| `index.test.ts`, `chain-switch.test.ts` stubs | `index.test.ts:222-223`, `chain-switch.test.ts:119` | stub `CapabilityCard`, which 5b deletes | stubs renamed to the new components |
| `humanize.test.ts:13` | execute window | unchanged: the override is local to `OperationCard` | none |
| `OperationCard.createAuthwit.test.ts` | execute window | title assertion, if any, changes; its field values are above the modulus (fact 28), so it is not wire-shaped | gains the "Authorization" title case; fixture values move below the modulus |
| `capability-meta.test.ts` | dapp-session | unchanged strings; `AUTHWIT_RIDER_INFO` is not pinned there | none |
| `dapp-session/service.test.ts`, `mac-storage.test.ts` | dapp-session | unchanged | new cases for the flag (below) |
| `authwit-variants.test.ts` | `tests/e2e/network/authwit-variants.test.ts:20-76` | the `transaction` bundle lists any contract, so the call intent now opens the window (its `callExpectingNoPopup` fails); default On needs a listed bundle (fact 21) | rewritten (plan P4) over a new `transaction-listed` bundle |
| `cap-request-partial.test.ts` | `:19-47` | unticks `simulation`, which gets no switch; it is `toggleOff`'s only caller (`:35`) | rewritten onto the data rows (P4, then P9); `toggleOff` deleted |
| `data-privateEvents.test.ts` | `:22-50` | private events on any contract now start Off; the test tolerates `error` (`:49`), so it would pass on the scope-violation path and stop testing what it names; `ok` needs real event metadata (fact 40) | approve with the private-events switch On; assert `ok`, or the stored grant and answer carrying the private events plus the exact status the base run logged, with an Off control that is refused (plan P4) |
| `cap-request-rerequest.test.ts` | `:48-50` | reads `cap-rerequested-badge` on the `data` row | passes if the badge survives (owner ask A-4) |
| `cap-request-basic.test.ts` | `:34-36` | reads `cap-item` ids `contracts`, `simulation` | passes if rows keep `cap-item` + `data-cap-id` |
| `cap-request-accounts`, `cap-widening` | `approveCapabilities({ aliases })` | the alias input exists only after the rename link; `cap-widening` is a membership flow and cannot prove a scope widening (fact 30) | the fixture presses the link first; the scope widening gets its own e2e |
| `dapp-interaction/service.test.ts` | dapp-interaction | no case drives a `createAuthWit` interaction through close, timeout or a late approval | new cases, or the existing ones cited |
| every spec granting through `approveCapabilities` or the `dappConnectedExtension*` fixtures (`fixtures/extension.ts:432-437`) | 21 network specs open the permission window (`grep '"capabilities"'`) | Connect grants defaults instead of every ticked card | whole network suite at each arc gate |
| `Tooltip` count | batch 3 counts 34 source tags after it | the Alias ⓘ `<Tooltip>` goes | recount in P8 |

Gaps: nothing tests the connected-app page (`find … -iname "*.test.ts"` under
`popup/pages/settings/connected-apps` and `modules/settings/connected-apps` → none; no e2e
navigates there). Nothing renders the permission window from a wire-shaped request.

## Corrections to the raw reports

1. **Icons are not a blocker.** The sweep said `signature`, `play_circle`, `task_alt`, `mail_lock`
   have "no equivalent at all" and need new assets. It checked `icons.json` (the SVG sprite). The
   mocks draw these with Material Symbols (`.ms`, `nulo.css:88-94`), and the extension already has
   `MaterialIcon` over the bundled Material Symbols font, which carries every one of them (GSUB
   parse above).
2. **`ScopeAddress.vue` is not the "Nulo doesn't know" cell.** Its contract is the opposite of the
   table's: raw address primary with a contact name as annotation, 12px `--nulo-secondary`
   (`ScopeAddress.vue:6-11,91-95`). The mock's cell is 11px mono `--txt-primary` with a
   `content_copy` glyph (`nulo.css:545-546`). Only its sanitized copy call is reused. Its security
   note (`:6-11`) also rules contact names out as a "Nulo knows" source.
3. **The three covered `createAuthWit` dispatcher tests are not "verified safe".** They pass only if
   an absent flag means On. The plan makes absent mean ask (fail closed), so their fixture sets the
   flag.
4. **The flag cannot ride inside the accounts capability.** The sweep proposed it "with zero wire
   changes". The stored grant is the popup's echo of the dApp's own object (fact 10), so a dApp
   could pre-set it. It lives on the session row, written only from the popup's answer and the
   Settings setter, as `{ broad }` so it records what it was given against (fact 7).
5. **"No schema migration" needs one condition.** The field must be added to `DappSessionSchema`,
   or zod strips it before the MAC layer (fact 11). The mapper had this right; the sweep did not.
6. **`data-privateEvents` is affected**, which neither report listed (table above).
7. **Default "absent = On"** (mapper § 4) is rejected: pre-production, no users, and the safe
   reading of a missing flag is "ask".
8. **Window flooding** (mapper § 6 C) is bounded per wallet-sdk session by the baton (fact 7):
   one open window each. Across several sessions of one origin there is no bound: the
   connect-time admission caps (`wallet-sdk/verify-admission.ts:20-24`) count verification
   windows only and release a slot when its window closes (`:105-120`), so they do not bound
   established sessions' authorization windows. Plan Ask C-8.
9. The sweep's "Status strip uses a slash in the mock" note is moot: the spec keeps the strip as
   today and the window uses `DappStatusStrip`, not the mock's markup.

## Plan-audit corrections

Round 1 of the plan audit (codex and fable) found these errors in this file; each is corrected
in place above.

1. Fact 7 treated the baton as per app. It is per wallet-sdk session; several sessions share one
   `DappSession` row (codex 1, fable 1).
2. Correction 8 bounded cross-session windows by the admission caps; those count verification
   windows only and release on close (codex 10).
3. Fact 9 said "only the popup"; it is any trusted same-extension context (codex 10).
4. Fact 11 implied a bad row means "ask"; a dropped or hidden row means the call is refused
   (codex 10).
5. Fact 10 omitted the two raw-object storage paths and the duplicate-type selection (codex 2,
   fable 2); the reuse map's grant-builder row read as a security boundary.
6. The reuse map proposed no placement for the Details table that Storybook builds (fable 3,
   fact 26).
7. Fact 21 did not say that no bundle can start authorizations On (codex 6, fable 4).
8. The test-impact table missed the invalid authwit fixture values (fact 28), the membership-only
   scope of `cap-widening` (fact 30) and the interaction-path close and timeout cases.
9. The icon list did not include `info`; it resolves (fontTools GSUB parse, 4,229 ligatures).
10. Facts 24–33 record what the audit found that recon had not surveyed.

Round 2 (codex and fable) found:

11. Fact 18 said the payload lets the popup read the stored flag; it is a re-read, not the
    dispatch snapshot (codex security note).
12. Facts 34–42 record what round 2 found that recon had not surveyed: the rejection-filtered
    `existingCaps` (codex 2, fable 6), unvalidated values (codex 3), the uncovered call intent
    refused before the handler (codex 9), `setCapabilityGrants`' reach (codex 1), the covered
    narrowing (rejecting fable 13), the nested account row (codex 8), the private-events test's
    limit (fable 10), the per-row text source (fable 7) and the three chips (codex 7, fable 1).

Round 3 (codex and fable) found:

13. Fact 21 described the scoped bundles' scopes but not where their address comes from; fact 43
    records it (fable 1).
14. Facts 44–47 record the whole-record `data` replacement (codex 1), the membership-only rider
    (fable 3), the focus and locked-row facts (fable 4, 5) and the required fields and modulus
    (codex 2).

Round 4 (codex and fable, plus the driver's re-verification after the rebase) found:

15. Fact 44 wrote the held record's private events as `[A]`; the wire shape is
    `{ contracts: [A] }` (codex 2). Corrected in place.
16. The reuse map's FPC row cited `fpc/service.ts` lines that the #690 move shifted; corrected in
    place, and fact 51 records the drift.
17. Facts 48–50 record the rejected-type delta (fable 2), the inner-hash match (fable 1) and the
    package-root export gap (driver).
