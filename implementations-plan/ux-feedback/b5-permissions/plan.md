---
plan: ux-feedback/b5-permissions
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: fable Plan subagent (model fable, fallback opus)
eli5_mode: artifact
eli5: https://claude.ai/artifact/2K6hp9Swji7esujdxtBBWy
program: implementations-plan/ux-feedback/plan.md (batch 5, arcs 5 and 6 of 6)
arc_branches:
  - feat/ux-5a-authorization-confirm (on feat/ux-4-snackbar-rows-arrivals)
  - feat/ux-5b-permission-window (on feat/ux-5a-authorization-confirm)
design: implementations-plan/ux-feedback/design/spec.md (item 6, item 9's two permission-window terms, the tooltip map's Alias row, undrawn states U1–U7 and U10)
artifact: https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF
parity_5a: https://claude.ai/artifact/6NjcZ54XTdEYtUgzGzQhxC
---

# Batch 5 · Permissions

The last two arcs of the UX program's six-PR stack, on top of batch 4 (snackbar, rows, arrivals).

- **Arc 5a, `feat/ux-5a-authorization-confirm`**, is behaviour first:
  - one stored consent per app, where Off means ask: each authorization the app requests opens
    the existing confirmation window;
  - the defaults (Off when the list is "any contract"; unknown permissions Off);
  - a grant model with no per-card unticking, enforced in the background;
  - the confirmation window's title (U6) and the Settings switch (U7).
- **Arc 5b, `feat/ux-5b-permission-window`**, is the redesigned permission window: S1, S2, S3, the
  Details table, and round 5's U1–U5 and U10.
  - It also adds the window's two dotted terms and removes the Alias ⓘ. Both use batch 3's
    `DottedTerm` and glossary keys.

**The design is the artifact**, <https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF>. The spec
[`../design/spec.md`](../design/spec.md) quotes it in § Item 6, § Item 9, § Tooltip map and
§ Undrawn states.

- Shots: `06-window-S1`, `06-window-S2`, `06-window-S3`, `06-auth-row-B`, `06-off-means-ask`,
  `06-auth-window-U6`, `06-settings-U7`, `06-more-U1`, `06-accounts-U2`, `06-banners-U3`,
  `06-rows-U4`, `06-row-list-U4`, `06-rename-U5`, `tips-map`.
- Generators: `design/mocks/gen_i6.py`, `gen_i6r4.py`, `gen_r5.py`; styles
  `design/mocks/src/nulo.css`.
- Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the program)

Recorded from `implementations-plan/ux-feedback/plan.md` § "Phase 0, answered for every batch".
No clarifying questions were asked.

- **Success**: item 6 and U1–U7 and U10 are built as the spec and the drawings say. The two
  permission-window dotted terms ship, and the Alias ⓘ goes. Parity evidence is published per
  arc, and every gate below is green on Chrome and Firefox.
- **Who, and what excellent looks like**: the program's Outcome & Quality Bar, plus this batch's
  bar (below).
- **Scope**: this batch's items only. Out of scope:
  - the one connect window with Allow and the emoji (deferred follow-up, its own blueprint);
  - reworking the execute window beyond U6's title;
  - Settings → Connected apps' other groups (U7A keeps them as today);
  - the existing refusal errors' log content (Disputed D-2: out of scope unless the owner
    answers option (b), which amends this plan before P1);
  - the tools app and the bridge packages (no longer in this repo, #691), the `@aztec/*` line;
  - storage migrations (pre-production).
- **Constraints**:
  - pre-production, so no migrations: `DappSession` gains an optional field that fresh installs
    simply start with;
  - Bun 1.4.2; the account freeze untouched;
  - complexity budgets hold with no new acceptance;
  - no new dependency; `base.css` untouched (hash-pinned);
  - the logging policy.
- **Quality bar**: production.
- **Validation layers**: typecheck and lint; unit; component; smoke e2e on both browsers; the
  whole network suite on both browsers, each in its gate mode (program § Local gates: Chrome
  prover on with `@requires-proverless` files run separately, Firefox proverless), since every
  connect goes through the changed window; the prover-on canaries (Chrome locally; Firefox only
  from CI's canary job on the exact head, program § Local gates); the Storybook build.
- **Surface vs delegate**: UI decisions come from the spec, the owner's picks and round 5.
  Technical decisions go to `/codex high` and are logged. Codex never decides UI.
- **`/code-review`**: off. **`/harden security`**: recommended before v1.0; the owner's call. It
  is not scheduled here.

## Outcome & Quality Bar

For whom: someone connecting an app to Nulo who wants to know what they are allowing, and to
choose the one thing worth choosing.

Excellent means:

1. **Off really means ask.** With the switch Off, each authorization the app asks for opens
   Nulo's confirmation window. None is ever signed on the spot. A reject, a close or a timeout
   before approval returns an error to the app, never a silent signature.
2. **A consent never outlives what it was given for.** On signs silently only inside the app's
   listed scope, as the spec defines it ("On keeps today's silent signing inside the app's
   listed scope"). A consent given while the scopes were listed asks again once they are
   widened to any contract, from any path or any tab. A widening to more listed contracts or
   functions goes through the window, where the person allows the new list, and the consent
   carries over to it (§ The consent, "What a consent covers"; stated in the PR body).
3. **The safe default wins when in doubt.**
   - A missing consent means ask; a malformed one hides the session, so the app's calls are
     refused until it reconnects.
   - A request listing "any contract" starts Off.
   - An unknown permission starts Off and is never granted unless switched on.
4. **Connect grants exactly what the window shows**, nothing more. The background validates
   every known capability's values and projects it to its known fields before the window shows
   it, and again before it is stored, so a malformed known value is refused before any window,
   a field the app invents is neither shown nor stored, and nothing the app sends can turn the
   switch on.
5. **The window reads in three groups**: what the app can do without asking, what it can do only
   if you allow it, and what always asks you. Every switch lives in the middle group. Details
   show every contract the app would hold, once. A name appears only where Nulo itself can vouch
   for it.
6. **One place to change your mind.** The Settings switch changes the next request; the page
   shows it only for an app that can ask for authorizations.
7. **Keyboard and screen reader get the same.** Every switch, disclosure, table row and rename
   link is reachable by Tab in visual order and operable by Enter and Space. Each has a name; the
   dotted terms announce their definitions. The Details copy buttons are pointer and
   screen-reader controls outside the Tab order (A-23, CLAUDE.md § Keyboard & focus order).

Good enough: Settings → Connected apps keeps today's permission names below the new switch
(U7A).

## Round-5 picks

Read 2026-09-24 from the artifact's `picks` store: no pick had been made for U1 (`i6e`), U2
(`i6f`), U3 (`i6g`), U4 (`i6h`), U5 (`i6i`), U6 (`i6j`) or U7 (`i6k`).

- **Signed off by the owner in chat, 2026-09-25: "Regarding 6: Recommended."** That is the
  recommended option of U1–U7 as drawn and of every ask A-1 to A-32, the P0 addendum's
  included. The picks store is unreadable from this account, so the chat answer is the record
  (lessons/phase-4.md).
- Each is built as drawn. What no drawing defines stays **sign-off pending** (§ Delivery).
- U10 has no picker: it is "Unchanged".
- A later pick that differs from a drawing replaces the matching step before that step starts.

## UI impact

| # | Surface | Before → after | Shot | Sign-off |
|---|---|---|---|---|
| 1 | Permission window, arc 5a (interim) | Every card has a tick, with a rider card "Act on your behalf" (`capability-meta.ts:41-47`) → today's window and cards, with a tick only on the authorizations, address-book, private-events and unknown cards. The authorizations card and the two data cards take their titles and lines from the U4 row list. Other cards have no tick and are granted as requested. Full list in A-1 | none (interim) | Ask A-1, signed off 2026-09-25 (§ Round-5 picks) |
| 2 | Permission window, first connect (S1) | "is requesting permissions on X", "New permissions requested" cards, "Approve" → "wants to connect on X" and four groups: "Account to share", "Without asking, it can", "If you allow, it can", "Always asks you first". Then "Details · N contracts" (the table) and footer "Reject" / "Connect" | `06-window-S1`, `06-auth-row-B` | i6 "6 => B, Off = ask, unknown Off. That's freaking awesome." (owner) |
| 3 | Permission window, nothing recognized (S2) | → the S1 layout, plus the note "Nulo doesn't recognize any of its contracts." above Details (`gen_i6.py:226`) | `06-window-S2` | i6 (owner) |
| 4 | Permission window, broad request (S3) | → flagged rows and the "Any contract" chip on the simulation row. The authorizations row is flagged (orange icon, no chip), Off, with "You confirm each authorization first. Off because it listed any contract." (`gen_i6r4.py:88-94`). "Every transaction, on any contract". "Details · any contract" | `06-window-S3`, `06-off-means-ask` | i6 (owner). S3's round-3 authorizations row is rebuilt with B per the spec (§ Item 6, "S2 and S3 predate round 4") |
| 5 | Permission window, asking for more (U1) | "New permissions requested" / "Already granted" → the new rows only, a folded "Already allowed · N" row, "wants more permissions on X", button "Allow" (`gen_r5.py:100-127`) | `06-more-U1` | round 5 U1A as drawn, signed off 2026-09-25 (§ Round-5 picks) |
| 6 | Several accounts (U2) | "Add/Select accounts to share" → "Accounts to share" with a count. The first "Without asking" row reads "See the addresses of the accounts you share" (`gen_r5.py:130-138`) | `06-accounts-U2` | round 5 U2, signed off 2026-09-25 (§ Round-5 picks); the label when the app already holds accounts ("Add accounts to share" today) is Ask A-31, signed off with it |
| 7 | Network banners (U3) | the description's "Approve as is" → "Connect as is". The button "Switch wallet to X" and the rest are unchanged, in today's place (`gen_r5.py:141-150`) | `06-banners-U3` | round 5 U3, signed off 2026-09-25 (§ Round-5 picks) |
| 8 | Private events, contract classes (U4) | one "data" card → an address-book row and a private-events row, each with its own switch. Contract classes → "Look up contract code on X" in "Without asking". The three "any contract" rows the list marks carry the "Any contract" chip (`gen_r5.py:158,160,166`). Full row list at `gen_r5.py:154-170` | `06-rows-U4`, `06-row-list-U4` | round 5 U4, signed off 2026-09-25 (§ Round-5 picks); the two new rows' flag state is Ask A-29; a data row left Off keeps what the app already held for it, Ask A-30; a re-request after a declined widening, Ask A-32; the three signed off with it |
| 9 | Account row alias (U5) | "Alias" label, ⓘ tooltip, and the field always shown on a selected row → the dotted button "Rename for this app". Pressing it swaps in today's field, labelled "Name for this app", prefilled and focused (`gen_r5.py:60-72,194-200`) | `06-rename-U5`, `tips-map` | round 5 U5, signed off 2026-09-25 (§ Round-5 picks); tips "All of it" (owner) for the dotted terms |
| 10 | Cancelled and error overlays (U10) | unchanged | none | spec U10 "Unchanged" |
| 11 | Authorization confirmation window (U6) | card title "Create authwit" → "Authorization". Everything else is as today (`gen_r5.py:203-224`) | `06-auth-window-U6` | round 5 U6, signed off 2026-09-25 (§ Round-5 picks); i9c "Authorizations" (owner) for the word |
| 12 | Settings → Connected apps → app (U7) | new group "If you allow, it can" holding the authorizations row with its switch, directly above "Granted permissions" (`gen_r5.py:227-253`). Only for an app granted authorizations | `06-settings-U7` | round 5 U7A, signed off 2026-09-25 (§ Round-5 picks) |
| 13 | Settings → Connected apps list | no visible change (a testid on each row's target) | none | none needed |

Keyboard changes:

- Arc 5a: each remaining tick becomes a switch control (Tab stop, Enter and Space); ticks on rows
  that no longer switch go.
- Arc 5b: the window gains Tab stops for the Details disclosure, each Details row, the U1 fold,
  the rename links and the dotted terms. Each account's Tab stop moves from the row onto its
  selection target, followed by its rename link. The Details copy buttons are not Tab stops
  (A-23).
- Settings gains one Tab stop, the switch, and its dotted term.

Visible consequences of technical choices (stated in the PR body, program § Open asks):

- a request naming one known permission type twice, missing a required field of a known
  permission, carrying a malformed value in one (an address that is not a field element
  included), or asking for a `data` permission with neither the address book nor private events
  (private events from an empty list of contracts count as none), is refused before any window
  opens;
- a consent given on a listed scope stops signing silently once the app's scopes are widened to
  any contract, so its next authorization opens the window;
- a consent carries over when the app widens its list to more listed contracts or functions,
  which the person allows in the window;
- a declined widening keeps the grant the app already held (today's behaviour); the window's
  "Already allowed" fold and the app's answer both show it (Ask A-30). This holds per data row:
  leaving one new data row Off keeps what the app already held for that row, whatever the other
  row's switch says (A-30's table);
- after a declined widening, a request the held grant already covers opens no window and is
  answered from the held grant; today it reopens the window for the declined type (Ask A-32).
  Contract classes keep today's behaviour, since their coverage checks only the type;
- a `contracts` permission with neither `canRegister` nor `canGetMetadata` grants nothing, so it
  is answered as asked with no window, and a request made only of such permissions opens none.

### UI asks for the owner (built as recommended, signed off 2026-09-25)

Each ask names what the drawings settle. **Drawn** means the built value is read off a round 3,
4 or 5 drawing. **Undrawn** means no round drew it: spec § How to use it says such a surface
stops for the owner, so P0 draws each one into the artifact as a round-5 addendum, with this
plan's recommendation drawn and a picker, before any phase builds it. The drawn recommendation
is built. The owner signed off the recommended option of every ask on 2026-09-25 ("Regarding
6: Recommended.", § Round-5 picks). A state no drawing defines stays **sign-off pending**
(§ Delivery). Asks with no visible form (A-23's Tab behaviour, A-27's spoken names) are drawn
as annotated options.

- **A-1 · The arc 5a interim window** (undrawn). Arc 5a changes behaviour before arc 5b redraws
  the window, and the stack's PRs may land one at a time.
  - Recommended and built: today's window (`index.vue`, `CapabilityCard.vue`) with these
    changes only, every word from the U4 row list (`gen_r5.py:154-170`):
    - the rider card becomes the authorizations card: title "Act for you in transactions you
      approve"; line "Nulo signs its authorizations without asking." when on, "You confirm each
      authorization first." when off; for a broad request, "For any call, on any contract." /
      "You confirm each authorization first. Off because it listed any contract."
      (`gen_i6r4.py:91-92`). The word "authorization(s)" is plain text until 5b;
    - `data` becomes two cards: "See your address book" ("Every name and address you saved." /
      "Not shared. The app may ask again later.") and "See private events from its contracts"
      ("Private messages its contracts sent to your accounts, like a transfer you received." /
      the same off line), or "See private events from any contract" for `contracts: "*"`. Each
      card's detail panel shows only its half of the capability. A card whose field the app
      already holds sits in today's "Already granted" section with no switch (A-30);
    - the "Already granted" data cards come from the held `data` record in
      `params.heldGrants`, one card per field it gives that the request does not newly ask for
      (`dataFieldsCovered`), so a record whose widening was declined still shows its held half
      (A-32). A `data` entry in `params.existingGrants` draws no card of its own, so a held
      record is never drawn twice; every other type's "Already granted" card still comes from
      `existingGrants`, as today (`index.vue:166-171,406-424`). Undrawn, drawn in P0 with A-1's
      crops. Alternative: today's source alone, where a declined `data` type's held half shows
      nowhere in 5a (`dispatcher.ts:379`);
    - the tick stays today's glyph (`check-circle` / `circle`) and becomes a switch control on
      those three cards and the unknown card, named as the drawings name the switches
      ("Authorizations without asking", "Share address book", "Share private events", "Unknown
      permission", `gen_i6.py:145,261,267`, `gen_r5.py:13,103,181`);
    - every other card keeps its title, description, risk tag and detail panel, with no tick;
    - on a membership-only accounts widening the authorizations card stays today's existing,
      non-new card with no switch (`build-items.ts:52`, A-31);
    - action, section titles, banner and footer strings unchanged.
  - Alternatives: the drawn groups land in 5a (outline B's arc split; rejected in the ledger
    because the program assigns the groups to 5b, `plan.md:89-94`); or the owner merges 5a and
    5b together.
- **A-2 · Authorizations with no transaction or simulation scope** (undrawn). Nothing can be
  signed without asking then: `callWithinTxOrSimulationScope` reports no coverage
  (`method-scope-checkers.ts:226-243`), so every authorization opens the window and a switch
  would do nothing.
  - Recommended and built: the row "Act for you in transactions you approve" sits in "Always asks
    you first", with no switch and the line "You confirm each authorization first."
    (`gen_r5.py:14`, the B off line).
- **A-3 · The broad row switched On** (drawn): "For any call, on any contract."
  (`gen_i6r4.py:91`). Turning it On records a broad consent (§ The consent).
- **A-4 · "Previously denied" in 5b** (undrawn). Today's re-request badge
  (`CapabilityCard.vue:104-106`) is not drawn in any round. 5a keeps it as today.
  - Recommended and built in 5b: kept on the row's title line, styled as `.n-flag` without the
    warning icon, in `--txt-secondary`. On a `data` re-request, each new data row carries it; a
    data row the held grant already gives folds without it (A-32). e2e reads it
    (`cap-request-rerequest.test.ts:48-50`).
  - Alternative: drop it.
- **A-5 · Widening to "any contract" later** (undrawn). When a connected app with a narrow
  consent re-asks with a scope that makes authorizations broad, its consent stops signing
  silently (§ The consent). The window shows the authorizations row among U1's new rows, flagged,
  Off, with the S3 off line.
  - A widening to more listed contracts or functions keeps the consent (Quality bar 2), and the
    row stays in the "Already allowed" fold as U1A draws it. Alternative: surface the row among
    the new rows, with its current line, whenever the transaction or simulation scope widens.
- **A-6 · Flags on the address-book and unknown rows** (drawn, conflicting drawings). S3 flags
  both (`gen_i6.py:257,263`); U1A and the U4 list do not (`gen_r5.py:102-104,164,168`).
  - The spec says of S3 "nothing else in them changes". Built accordingly: both flagged only in a
    broad request, unflagged otherwise.
  - Alternative: never flagged, per the later drawings.
- **A-7 · "Details · any contract" opened, and mixed requests** (undrawn). Recommended and built:
  - every scope is kept as sent: a listed contract appears as its own row; a scope that is "any
    contract" adds one row "Any contract", marked in each column that scope feeds;
  - the label reads "Details · any contract" whenever an "Any contract" row exists (for example
    `transaction-scoped`: one listed transaction contract plus any-contract simulation), else
    "Details · N contracts";
  - expanded rows list the functions as the app sent them ("Any function" for `"*"`, A-8).
- **A-8 · A scope listing every function** (undrawn). Recommended and built: the function line
  reads "Any function".
- **A-9 · What feeds the columns** (drawn by S1's data, `gen_i6.py:12-26`):
  - Simulate = `simulation.transactions` and `simulation.utilities`;
  - Add = `contracts.canRegister` over its listed contracts;
  - Transact = `transaction.scope`;
  - a contract appears once, under the first sub-header that applies: "Nulo knows" before "Nulo
    doesn't know";
  - the input is the grant set the app would hold after Allow (stored grants minus the types
    this request replaces, plus the request), so U1 still shows every contract the app holds
    (`gen_r5.py:108`, "Details · 12 contracts" on an address-book-only request).
- **A-10 · Counts and plurals** (undrawn beyond the drawn values):
  - "Details · 1 contract" / "· N contracts";
  - "Use N permissions Nulo doesn't recognize": every unknown type is one row with one switch
    (`gen_i6.py:263`), granted all or none;
  - "Already allowed · N" counts rows, not capabilities.
- **A-11 · Whose address** (drawn for one and for several; the switching is undrawn). "See
  Account 1's address" names the single selected account by its wallet name, never the alias
  being typed. With two or more selected it reads U2's sentence. It updates as the selection
  changes.
- **A-12 · The U1 fold's contents when opened** (undrawn). Recommended and built: every grant
  the app holds (the snapshot's stored grants, including one whose later widening was declined),
  in their groups, read-only: no switch (a disabled `Toggle` draws a lock, `Toggle.vue:37-42`,
  which no drawing has), and each switch row shows the line of its stored state. Opening it
  sends nothing. A data row whose field the app already holds is one of these rows (A-30), and
  so is the authorizations row on a membership-only accounts widening (A-31).
- **A-13 · U1 and the network banner** (undrawn). Recommended and built: the banner's sentence
  reads "Allow as is, or switch to see X balances." when the footer reads "Allow". The button
  stays "Switch wallet to X".
- **A-14 · Unknown chain** (undrawn). Today's chain-name fallback (`index.vue:67-69,336`) stays.
  The action becomes "wants to connect on this network" when no name resolves.
- **A-15 · Settings for a broad app** (undrawn). Recommended and built:
  - the row keeps the flag and the S3 lines;
  - it stays editable (the owner can knowingly turn it On, which records a broad consent);
  - it is absent without `canCreateAuthWit`;
  - with `canCreateAuthWit` but no transaction or `simulation.transactions` scope it mirrors
    A-2: no switch, the off line "You confirm each authorization first."
- **A-16 · U4's words: the spec vs the drawing.** The spec's U4 line says "See your private
  events" / "Messages and events sent to your accounts." The drawing's list says "See private
  events from its contracts" / "Private messages its contracts sent to your accounts, like a
  transfer you received." (`gen_r5.py:165,179-182`). Built per the drawing, since it is what the
  owner is shown.
  - The same list settles `canRegister` vs `canGetMetadata`. A request with both shows only "Add
    contracts to your wallet".
- **A-17 · Icons for the new rows** (undrawn). U4 draws only `mail_lock` and `code_blocks`.
  Recommended and built:
  - `add_circle` for "Add any contract…";
  - `info` for "See details of contracts…";
  - `mail_lock` for private events on any contract.
  - All resolve in the bundled `MaterialSymbolsOutlined.woff2` (fontTools GSUB parse, 4,229
    ligatures).
- **A-18 · Dotted-term count** (drawn). The tooltip map allows two dotted terms per screen; U2
  draws one rename link per account. Built as drawn: one link per shared account. The rule is
  read as "two distinct terms"; needs the owner's confirmation.
- **A-19 · Switch focus ring** (drawn): the mock's 1px `--txt-primary` ring at a 2px offset
  (`nulo.css:447`), where `Toggle.vue:61-63` removes the outline. Built on the permission rows
  and the Settings row only, locally, with a two-class selector (`.row .switch:focus-visible`)
  so it outranks `.wrapper:focus` whatever the stylesheet order. The primitive and its other
  uses are untouched.
- **A-20 · Rename, then nothing typed** (today's behaviour). The field stays open. An empty field
  saves the account's wallet name as the alias, as today (`index.vue:229-237`).
- **A-21 · Apps connected before this build.** Their sessions have no consent, so they show Off
  and ask. Pre-production, so no one is affected.
- **A-22 · Known names** (drawn). "Nulo knows" lists only names the wallet vouches for by
  construction: the drawn role names "Fee Juice", "Sponsored fee payer", "Private fee payer",
  "Auth registry" (`gen_i6.py:13-16`) for the protocol and Nulo fee-payer addresses, and the
  default token list's names. A local or testnet run therefore shows fewer known rows than the
  drawing's sample (`gen_i6.py:12-26`).
- **A-23 · Copy buttons in Details rows** (undrawn behaviour). The drawing shows the glyph inside
  the address, `aria-hidden`, not a Tab stop (`gen_i6.py:52`). Recommended and built, per the
  drawing and CLAUDE.md § Keyboard & focus order (an inline copy stays out of the Tab path):
  - batch 4's `RowAction` (24×24, `@click.stop`, sibling of the row's target) with
    `tabindex="-1"` and `aria-label="Copy address"`; it never toggles the row;
  - the snackbar "Address is copied", through batch 4's clipboard helper.
  - Alternative: a Tab stop after its row, as `RowAction` is elsewhere in batch 4.
- **A-24 · Simulation "any contract" when only utilities are** (undrawn). Recommended and built:
  either sub-scope being "any contract" gives "Run simulations on any contract" with its chip;
  the authorizations default follows transactions and `simulation.transactions` only, since
  utilities never authorize a call intent.
- **A-25 · Several accounts, none selected** (undrawn). Recommended and built: U2's sentence "See
  the addresses of the accounts you share".
- **A-26 · Locked (SHARED) account rows** (undrawn). Recommended and built: no rename link, as
  today's rows hide the alias field for them.
- **A-27 · Spoken Details rows** (undrawn). The head is `aria-hidden` as drawn, so each row's
  target is named for screen readers: "{name or address}: {columns it is in}", for example "Fee
  Juice: simulate, transact". Recommended and built.
- **A-28 · A failed Settings write** (undrawn). Recommended and built: the switch reverts and the
  error snackbar reads "Couldn't save this setting", through batch 4's `kind: "error"` toast.
- **A-29 · The two new "any contract" rows** (chip drawn, flag state undrawn). The U4 list marks
  "Add any contract to your wallet" and "See private events from any contract" with the
  "Any contract" chip (`gen_r5.py:160,166`), the notation S3 uses for its simulation row
  (`gen_i6.py:248`). Built with the chip. Recommended and built: flagged too (orange icon), as
  S3's simulation row is. Alternative: the chip alone.
- **A-30 · A declined widening of a permission the app holds** (undrawn). Declining keeps the
  older grant (`service.ts:320-327`, today's behaviour). Example: the app holds the address book
  and private events from contract A, asks for private events from any contract, and the person
  leaves the new row Off. Recommended and built: the new row shows its drawn off line ("Not
  shared. The app may ask again later.", which is true of what was asked); the retained grant
  shows in the "Already allowed" fold (A-12) and in Details; the answer to the app reports the
  retained grant. Alternative: Off revokes the held access too, which changes today's
  behaviour and needs its own line.
  - `data` is one stored record that an approval replaces whole (`service.ts:320-327`), so the
    retention is decided per row, not per type. A data row is new only when the held grant does
    not already give what it asks (U1A's rule, "only what's new", `gen_r5.py:118`); a held row
    folds (A-12). The popup's `data` result keeps, for each row left Off, the held value of that
    field, and takes the requested value for each row switched On. When every new data row is
    Off, the type is rejected, which keeps the whole held record. Against a held
    `{ addressBook: true, privateEvents: { contracts: [A] } }`:

    | Request | Address-book row | Private-events row | Stored after Allow |
    |---|---|---|---|
    | `{ addressBook: true, privateEvents: { contracts: "*" } }` | folded (held) | new, Off | unchanged (type rejected) |
    | same | folded (held) | new, On | `{ addressBook: true, privateEvents: { contracts: "*" } }` |

    Against a held `{ privateEvents: { contracts: [A] } }` (address book off), with a request for
    `{ addressBook: true, privateEvents: { contracts: [A, B] } }`, both rows new:

    | Address-book row | Private-events row | Stored after Allow |
    |---|---|---|
    | On | Off | `{ addressBook: true, privateEvents: { contracts: [A] } }` |
    | Off | On | `{ privateEvents: { contracts: [A, B] } }` |
    | Off | Off | unchanged (type rejected) |
    | On | On | `{ addressBook: true, privateEvents: { contracts: [A, B] } }` |

    Every cell is the wire shape (`capabilities.ts:47-51`), read directly by
    `checkGetPrivateEvents` (`method-scope-checkers.ts:206`), so each row runs through the
    decision as written.

    The fold, Details and the answer to the app read the same stored record. Drawn in P0 with
    the mixed states; the alternative above ("Off revokes") would change every "unchanged" cell.
- **A-31 · Adding accounts to an app that holds authorizations** (undrawn). A request that
  differs from the stored accounts grant only by membership keeps the stored grant
  (`dispatcher.ts:409-414`), and today's window shows the authorizations card as already
  granted (`build-items.ts:52`, `CapabilityParams.accountsMembershipOnly`). Recommended and
  built, as today: the authorizations row folds into "Already allowed" (A-12) with its stored
  line, only the accounts rows are new, and the window sends no `authorizationsWithoutAsking`,
  so the consent is left as it is. In 5a the card stays today's existing card with no switch
  (A-1). Alternative: show the row among the new rows with its switch.
  - The accounts section's label here is undrawn too: today it reads "Add accounts to share"
    whenever the session holds accounts (`index.vue:362-365`), and U2 draws only a first connect.
    Recommended and built in 5b: U2's "Accounts to share" (`gen_r5.py:132`), "Account to share"
    with one row (`gen_i6.py:94`), with today's count (`availableAccounts.length`). 5a keeps
    today's label. Alternative: keep "Add accounts to share" on a widening.
- **A-32 · A `data` re-request after a declined widening** (undrawn). A rejected type always
  joins the delta and `reRequested` (`dispatcher.ts:368,378`), whatever the held grant covers.
  Held `{ addressBook: true, privateEvents: { contracts: [A] } }` with the widening to
  `{ contracts: "*" }` declined (A-30's first table, row 1): the identical second request
  would fold the address-book row (A-30's per-row rule) while A-4's old text badged both rows,
  and a request for exactly what is held would fold every row and open a window with empty
  groups, where "every new data row Off" rejects nothing new. Recommended and built:
  - newness stays per row (U1A, "only what's new", `gen_r5.py:118`), and the "previously
    denied" badge sits on the new rows only (A-4);
  - a rejected known type whose request the held grant covers counts as covered: `:368` also
    tests `isCapabilityCovered` over the stored grants, so no window with empty groups opens and
    the app is answered from the held grant. This holds for the types whose coverage reads their
    fields (`accounts`, `contracts`, `transaction`, `simulation`, `data`), so a `contracts` or
    `transaction` request inside a held grant whose widening was declined also opens no window,
    where today it reopens the window for that type (stated in the PR body);
  - `contractClasses` keeps today's rejected-type rule: its coverage checks only the type
    (`dispatcher.ts:547-548`), and a grant for class A can sit beside a rejection (two tabs:
    one window approves A, a second declines B, `service.ts:323-335`). Treating B as covered
    would skip the window and answer B as granted while enforcement refuses it
    (`method-scope-checkers.ts:95-104`). Unknown types keep it too;
  - `reRequested` lists only the delta types with a stored rejection, after the accounts
    widening is planned, so a type that left the delta carries no badge;
  - the stored rejection stays, so a later widening of that type is badged again.
  - Alternative: a rejected type's rows are all new with the badge, and a covered re-request
    still opens the window (today's behaviour).
  - Drawn in P0 (the identical re-request, and the covered one as "no window"); pinned in
    `index.test.ts` and `dispatcher.test.ts`.

## Architecture & Implementation

### The consent (arc 5a)

- **Shape and place.** `DappSession.authorizationsWithoutAsking?: { broad: boolean }`: type in
  `apps/extension/src/wallet/services/dapp-session/spec.ts:42-64`, schema
  `z.object({ broad: z.boolean() }).strict().optional()` in `:74-95`, mirrored as
  `authorizationsWithoutAsking?: unknown` on `IDappSessionRef`
  (`packages/wallet-bridge/src/session-types.ts:58-67`).
  - It is on the session row, never inside a capability: the stored grant is built from the
    popup's echo of the dApp's own object (recon fact 10). This is the one comment at the field.
  - `broad` records whether the grants the person saw were "any contract" when they turned it
    On.
  - The row MAC covers it (recon fact 11). A value the schema refuses hides the row, so the app's
    calls are refused until it reconnects.
- **Predicates**, new exports in `packages/wallet-bridge/src/method-scope-checkers.ts`:
  - `isAnyContractScope(scope)`: true for `"*"`, for a pattern whose contract is `"*"`, and for a
    malformed scope (fail-safe);
  - `coversAnyContract(caps)`: true when the transaction or `simulation.transactions` scope is
    any contract (utilities never authorize a call intent, `:226-243`);
  - `readConsent(v)`: exactly `{ broad: boolean }`, else `undefined`;
  - `authorizationsEffective(consent, caps)`: true iff `readConsent(consent)` is defined and
    (`broad` or not `coversAnyContract(caps)`);
  - `effectiveGrants(existing, delta)`: existing caps minus the types `delta` replaces, plus
    `delta`, the replacement semantics of `applyCapabilityDecision` (`service.ts:323-327`). Its
    `existing` is always every stored grant, never the rejection-filtered `existingCaps`.
  - The dispatcher, the popup's defaults and Settings all call these, so what the window and
    Settings show is what the dispatcher does.
  - `packages/wallet-bridge/src/index.ts` re-exports the five by name. The package exports only
    its root (`package.json` `exports["."]`) and does not re-export `method-scope-checkers.ts`
    today (`index.ts:10-32`), so without this the popup and Settings could not import them. The
    checkers themselves stay unexported.
- **Enforcement**, `handleCreateAuthWit` (`dispatcher.ts:979-1020`). The silent branch at `:990`
  becomes
  `isCreateAuthWitCoveredByTxOrSimulationScope(intent, grants) && authorizationsEffective(dappSession.authorizationsWithoutAsking, grants.map((g) => g.capability))`.
  - Both read the dispatch-entry snapshot (`dispatcher.ts:650`), so flag and scope cannot
    disagree within one message. A Settings change takes effect from the next message; one
    already past dispatch entry keeps the value it entered with, as a revoked grant does today
    (Ask C-15). One sentence at the condition says so, since a reader would otherwise assume a
    Settings Off stops an admitted request.
  - Everything else is unchanged: the fence check, the popup request, the checkers that run
    first. One `&&` costs 1 point of cognitive complexity; the function stays under 15.
  - Batch legs re-enter `dispatch()`, so they take the same gate (recon fact 5).
  - The doc block at `:972-977` is rewritten to state the gate.
- **Writing it from the window.**
  - `CapabilityResult` (`dapp-interaction-protocol.ts:159-163`) gains
    `authorizationsWithoutAsking?: boolean`, sent only when the authorizations row was shown
    with a switch.
  - `handleRequestCapabilities` reads it as `=== true` / `=== false`; anything else is ignored
    (`resolveInteraction` stores the popup's result unvalidated,
    `dapp-interaction/service.ts:199-215`).
  - `true` becomes
    `{ broad: coversAnyContract(effectiveGrants(plan.existingGrants.map((g) => g.capability), approvedDelta)) }`,
    computed from the dispatch snapshot the window was opened against, never from the latest
    row and never from the popup. `plan.existingGrants` is every stored grant; `plan.existingCaps`
    drops a type with a stored rejection (`dispatcher.ts:379`) although its older grant stays in
    force (`service.ts:320-327`), so it is never the input here. `false` becomes `null`.
- **What the window reads.** The capability payload re-reads the session when the window opens
  (`dapp-interaction/service.ts:411-416`), after the dispatch snapshot. So `CapabilityParams`
  gains `heldGrants` (every stored grant's capability, projected) and `authorizationsWithoutAsking`
  (the consent), both from the snapshot, and the window's defaults, the U1 fold and Details read
  only those, never `payload.session`'s grants or consent. `existingGrants` keeps today's
  rejection-filtered meaning for the echo.
- **What a consent covers** (decided; Quality bar 2). `broad` separates the one case the spec
  singles out: On while the scopes reach any contract. A listed-to-listed widening, or a listed
  pattern widened to every function of a listed contract, keeps a narrow consent effective: the
  spec defines On as "silent signing inside the app's listed scope", and the new list is one the
  person allowed in the window. Tracking an exact scope basis was rejected: it stores a copy of
  the scopes on the row for a case the spec does not treat as a new consent. Tests pin both
  outcomes; the visible consequence is in the PR body.
  - It rides `CapabilityDecision.authorizations?: { broad: boolean } | null`
    (`services-contract.ts:109-127`). When `accounts` is not in the delta (A-5's widening), the
    decision adds `requiresGrant: ["accounts"]`.
- **Applying it**, `DappSessionService.applyCapabilityDecision` (`service.ts:301-341`), under the
  same lock as the grants: an object sets it, `null` deletes it, `undefined` leaves it; then it
  is deleted when the resulting accounts grant lacks `canCreateAuthWit`, so a later re-grant
  starts from the default.
  - `setCapabilityGrants` (`service.ts:259-263`) applies the same deletion after it writes. Its
    only caller today seeds a new session with `[]` (`wallet-sdk/background.ts:1044`), but it is
    a trusted RPC writer, so a revoke through it followed by a re-grant cannot revive a consent.
    One private helper holds the rule for both writers.
  - Why this closes the race both audits found: two tabs of one origin are two wallet-sdk
    sessions with separate batons (`wallet-sdk/background.ts:453-455`) on one `DappSession` row
    (`service.ts:132-134`). If a narrow On from tab A lands after tab B's broad widening, A's
    consent says `broad: false` and the read-time rule asks. No write needs to know about the
    other window, and `setCapabilityGrants` (`service.ts:259`) cannot widen past a consent
    either.
  - An unrelated decision carrying no value keeps an explicitly broad On.
- **Writing it from Settings.** `setAuthorizationsWithoutAsking(sessionId, on: boolean, shownBroad: boolean)`,
  where `shownBroad` is the breadth the row showed when the person switched it:
  - on the service next to `setTrustedVerification` (`service.ts:247-251`), in `rpcMethods`
    (`:31-45`), `spec.ts` Methods (`:97-118`) and the client passthrough (`client.ts:25-39`);
  - under the lock: `on === true` requires `canCreateAuthWit` and stores
    `{ broad: shownBroad && coversAnyContract(current grants) }`, so a broad widening that commits
    before the write leaves a narrow On narrow, which asks (A-15's broad row in Settings);
    `false` deletes; a non-boolean is refused;
  - it fires `onDappSessionUpdated`.
  - Service ports admit only trusted same-extension contexts (recon fact 9), so no dApp reaches
    it.
- **Order of writes.** A window decision and a Settings write take the same lock; the later one
  wins. Both orders are tested.

### The grant boundary (arc 5a)

- **Validation and projection in the background.** `projectKnownCapability(cap)` in
  `packages/wallet-bridge/src/dispatcher.ts` validates each known type's fields and copies only
  those, with values kept wire-shaped (strings and arrays, never parsed objects, so the MAC
  canonicalizer sees what it signs, `integrity.ts:34`). The request guard is a crash guard, not
  a validator (`method-descriptors.ts:117-135`), and enforcement reads `canCreateAuthWit` by
  truthiness (`method-scope-checkers.ts:287`), so a value the window and the predicates would
  read differently from the checkers must never reach either.
  - Required per type, since the local types declare them required and the coverage and
    enforcement code dereferences them (`capabilities.ts:23-46`; `requested.contracts.every`,
    `dispatcher.ts:206`; `scope.some`, `method-scope-checkers.ts:51`): `contracts.contracts`,
    `contractClasses.classes`, `transaction.scope`. A present `simulation.transactions` or
    `simulation.utilities` must be a plain object holding `scope`, and a present
    `data.privateEvents` a plain object holding `contracts`. A `data` capability must carry
    `addressBook: true` or `privateEvents` naming at least one contract (or `"*"`): one asking
    for neither would open a window with no data row and record a rejection nobody chose
    (`capabilities.ts:47-51` leaves both optional; `dispatcher.ts:543-546` puts it in the
    delta). An empty `privateEvents.contracts` counts as no private events, since coverage marks
    an empty list covered and the window draws no row for it. `accounts.accounts` stays optional
    (request-side manifests omit it, `bundles.ts:13-14`).
  - A known field, when present, must be:
    - a flag (`canGet`, `canCreateAuthWit`, `canRegister`, `canGetMetadata`, `addressBook`):
      `true` or `false`;
    - a scope (`transaction.scope`, `simulation.transactions.scope`,
      `simulation.utilities.scope`): `"*"` or an array of `{ contract, function }` whose
      `contract` is `"*"` or an address and whose `function` is a non-empty string;
    - an address list (`contracts.contracts`, `contractClasses.classes`,
      `data.privateEvents.contracts`): `"*"` or an array of addresses;
    - `accounts.accounts`: an array of objects whose `item` is a string;
    - an address: `0x` and 64 hex digits whose value is below the BN254 field modulus
      (`Fr.MODULUS` from `@aztec/foundation`, already a `wallet-bridge` dependency; the installed
      `AztecAddress` builds an `Fr`, which throws at or above it, `field.js:39-40`), kept in the
      case sent (coverage compares strings, `method-scope-checkers.ts:38-40`).
  - Anything else, a missing required field included, refuses the whole request with the one
    typed error before any window opens; a failure inside the validator (a thrown access on a
    hostile value) is caught and becomes the same error. Its message names only the capability
    type, never a request value (the logging policy).
  - The fields copied per type:
    - `accounts`: `canGet`, `canCreateAuthWit`, and `accounts` when it is an array (the checker
      enforces an explicit list, `method-scope-checkers.ts:279-292`);
    - `contracts`: `contracts`, `canRegister`, `canGetMetadata`;
    - `contractClasses`: `classes`, `canGetMetadata`;
    - `simulation`: `transactions.scope`, `utilities.scope`;
    - `transaction`: `scope`;
    - `data`: `addressBook`, `privateEvents.contracts`.
  - Unknown types pass untouched, as `KNOWN_CAPABILITY_TYPES` requires (`:268-285`).
  - It runs on the manifest at the start of `handleRequestCapabilities`, so the plan, the window
    and the grant see the same data, and again in `collectNewGrants` and `ensureAccountsGrant`
    (`:466-512`), the two paths that store a raw object.
  - The upstream `CapabilitySchema` is not used: its request variant has no `accounts` field and
    would drop an enforced restriction, and it parses addresses into objects.
- **Duplicates.** A manifest naming one known type twice is refused with a typed error (fixed
  text, as above) before any window: `replacementFor` (`:493-499`) would store the last
  differing entry, so what the window shows and what is granted could differ. The playground
  sends one entry per type (`bundles.ts:49-123`); the tools app, which did too, has left this
  repo (#691).
- **A `contracts` permission that grants nothing** (arc 5b; decided by codex high, session
  `01a0d965-2e77-7b52-8c4b-9d23b3e094de`, 2026-09-25, confidence moderate). After validation, a
  `contracts` capability with neither `canRegister` nor `canGetMetadata` true (omitted or `false`)
  is left out of negotiation: it joins no delta, draws no row (`contractsRow` has none for it),
  is never stored, and `enrichGrantedCapabilities` returns its projection in the answer as asked.
  A request made only of such permissions opens no window and writes nothing; a mixed request
  negotiates the rest, and held grants and rejections stay as they are. wallet-sdk requires
  neither flag (`ContractsCapabilitySchema`), so refusing it would break a valid request. Unknown
  types are not treated this way. Malformed and duplicate `contracts` entries are still refused
  first, with the fixed text.
- **The data split's coverage.** `dataRequestCovered` (`dispatcher.ts:252-261`) returns true for
  any existing data grant when the request lists no private-event contracts, so after "private
  events on, address book off" an address-book re-request never opens the window. It checks
  `addressBook === true` against the grants before the private-event scope.
  - The per-field check is one exported function in `dispatcher.ts` (reachable through the
    package's `export * from "./dispatcher"`):
    `dataFieldsCovered(held: DataCapability[], requested: DataCapability) → { addressBook: boolean; privateEvents: boolean }`.
    `dataRequestCovered` is both fields; the popup's per-row newness (§ Arc 5b window, U1) and
    `buildGrant` read the same result, so the fold and the delta cannot disagree.
- **A declined type asked again** (A-32, recommended as drawn in P0). `computeCapabilityDelta`'s
  rejected-type branch (`dispatcher.ts:368`) keeps a known type out of the delta when
  `isCapabilityCovered` holds over the stored grants, and `reRequested` (`:378`) is computed over
  the final delta, after `planAccountsWidening`. Unknown types and `contractClasses`, whose
  coverage is type-only (`:547-548`), still join the delta whenever rejected.
- **The answer to the dApp.** `enrichGrantedCapabilities` (`:1276-1323`) echoes the requested
  `data` cap unchanged. It answers from the stored grant instead: `addressBook` is
  `stored.addressBook === true`, and `privateEvents` is the stored value or absent, so a field the
  person switched off is removed from the answer, not left from the request. A retained grant
  after a declined widening is answered as held (A-30). The template comment at `:1283` is
  rewritten, since the requested caps are projected by then. The consent is on the row, so it
  never appears in the answer.

### Rows, defaults and the popup's grant (arc 5a, extended in 5b)

- **Row table.** `apps/extension/src/popup/windows/capabilities/permission-rows.ts` (new, pure)
  transcribes the U4 row list (`gen_r5.py:154-170`): per key its group, default, icon, title, sub
  on/off and flag rule. A `sub` is a list of segments, `{ text } | { term }`, so the dotted
  "authorization(s)" renders through `DottedTerm` where the consumer allows it.
  - Keys: `account-address`, `simulation`, `contracts`, `contract-details`, `contract-classes`,
    `authorizations`, `address-book`, `private-events`, `unknown`, `transaction`.
  - The authorizations row is derived from the accounts cap's `canCreateAuthWit`, never looked up
    by a dApp-sent `type`: a pseudo-type would let a dApp render a fake recognized row
    (`capability-meta.ts:34-40`'s invariant, kept).
  - `permission-rows.test.ts` pins each row, key by key, against its own cells in
    `design/mocks/dist/shots/text.json`: the `06-row-list-U4` entry's tab-separated line for that
    row (group, title, on and off lines), `06-auth-row-B` for the B lines, and the broad on-line
    "For any call, on any contract." against `gen_i6r4.py:91` (a hidden switch state, so not in
    `text.json`). A match anywhere in the file does not count: S2 and S3 still carry round 3's
    row.
- **Defaults** (spec § Item 6, "Defaults"; U4 list):
  - authorizations: on a re-request, `authorizationsEffective` of the snapshot's consent
    (`params.authorizationsWithoutAsking`) over the resulting grants; on first grant On, except
    Off when `coversAnyContract` of the resulting grants; A-5 applies;
  - address book On;
  - private events On for listed contracts, Off for any contract;
  - unknown Off (the invariant and its tests move over, `build-items.test.ts:15-33`).
- **The popup's grant**, `buildGrant(rows, delta)` in `build-items.ts`, replacing
  `buildGrantedCaps` (`index.vue:215-226`) and `buildGrantedAccountsCap`
  (`build-items.ts:113-117`):
  - rows with no switch are granted as requested;
  - `canCreateAuthWit` is granted as requested; Off means ask, not remove;
  - `data` is rebuilt field by field against the held `data` grant (`params.heldGrants`): a new
    row (per `dataFieldsCovered`) switched On takes the requested field, a new row left Off and a
    folded row keep the held field (absent if not held); with every new data row Off, the type
    is rejected (A-30's table);
  - on `accountsMembershipOnly` the authorizations row is not new and sends no
    `authorizationsWithoutAsking` (A-31);
  - the unknown row's one switch grants every unknown type or none;
  - it returns `{ granted, rejected, authorizationsWithoutAsking }`.
  - The security property lives in the background (§ The grant boundary); this builder only
    decides which rows the person left on.

### Arc 5a window (interim, A-1)

- `CapabilityCard.vue` stays for one arc with the A-1 changes. Its `cap-toggle` becomes a switch
  control: `role="switch"`, `aria-checked`, `aria-label` from the row, `tabindex="0"`, Enter and
  Space (`@keydown.enter.prevent`, `@keydown.space.prevent`), today's glyphs. Cards without a
  switch render no `cap-toggle`.
- `AUTHWIT_RIDER_INFO` (`capability-meta.ts:41-47`), its doc (`:34-40`), the `authwitRider`
  field and its doc (`build-items.ts:23-30`) and the rider comment (`index.vue:212-214`) go.
- `data` renders two cards from the row table; each passes only its half of the capability to
  `CapabilityDetailPanel` (`CapabilityCard.vue:159`).
- The "Already granted" data cards are built from the held `data` record in `params.heldGrants`
  (the fields `dataFieldsCovered` reports held and not newly asked for); `buildCapabilityItems`
  skips a `data` entry of `params.existingGrants`, which is rejection-filtered
  (`dispatcher.ts:379`) and would otherwise draw the held record a second time (A-1).
- Every card gains `data-cap-row` (the row key), which the P4 fixtures select by.

### Arc 5b window (S1–S3, U1–U5, U10)

- **Components.**
  - `apps/extension/src/components/composite/capabilities/PermissionRow.vue` (L3, built in P3
    for Settings, adopted by the window in P6).
    - Grid `16px 1fr auto`, gap 10, padding `9px 12px`, a `--hairline-soft` top border between
      rows (`nulo.css:349-350`).
    - Icon: `MaterialIcon` 16px, `--nulo-secondary`, margin-top 1 (`:351`); flagged turns it
      `--orange` (`:449`).
    - Title 13px/600/1.35 (`:352`); sub 11.5px/1.4 `--nulo-secondary`, margin-top 2 (`:353`).
    - The chip, only on the rows the U4 list marks "· Any contract" (`gen_r5.py:158,160,166`:
      simulation, adding contracts and private events on any contract; A-29): `.n-flag`,
      headline 10px 700, 0.1em uppercase, `--orange`, margin-top 3, gap 4, with the 11px warning
      icon (`:450-451`).
    - Switch: `Toggle`, margin-top 1 (`:448`), `data-testid="cap-toggle"` and its `aria-label`
      from the row passed to `Toggle` itself as attributes (the testid table), the local focus
      ring (A-19, `.row .switch:focus-visible`, which outranks `Toggle.vue:61-63`'s
      `.wrapper:focus` by specificity), `aria-describedby` on the row's current line, which
      carries `cap-row-sub` (Ask C-13).
    - Props of its own, so the L3 row imports nothing from the L5 window: `icon`, `title`,
      `subOn`, `subOff`, `switchLabel` (no switch when absent), `flagged`, `chip`,
      `modelValue`; slot `sub` (default: the current line's text). Event `update:modelValue`. No
      hover and no row click: only the switch acts (batch 4's row rules). The window and
      Settings map a `permission-rows.ts` entry onto these props.
    - It imports no other L3 component (CLAUDE.md § Extension component model). The window (L5)
      and the Settings page (L6) fill the `sub` slot, with `DottedTerm` for a `{ term }` segment
      (static `term="authorization"`, as batch 3's scan requires).
  - `components/composite/capabilities/DetailsTable.vue` (L3, presentational), over a pure
    `popup/windows/capabilities/details-table.ts`:
    `(effectiveGrants, knownContracts) → { known: Row[], unknown: Row[], anyContract: Row | null, label }`,
    where `effectiveGrants` is `effectiveGrants(params.heldGrants, delta)`, so a retained grant
    (A-30) is listed.
    It emits `copy(address)`; the window copies. Placed under `components/` so Storybook builds
    its story (`.storybook/main.ts:23-27` globs `src/components/**`, not `src/popup/**`).
- **Layout** (S1, `gen_i6.py:172-183`):
  - `DappStatusStrip` as today;
  - `DappIdentityBlock` with "wants to connect on X" (U1: "wants more permissions on X");
  - the banner (U3);
  - "Account to share" (`SectionLabel` with a count, `ItemsContainer`, `AccountSelectRow`);
  - the three groups; the S2 note; Details;
  - `DappApprovalFooter` "Reject" / "Connect" (U1: "Allow").
  - Sections gap 20 and padding 16; group gap 10 (`nulo.css:128-129`).
  - A group with no rows is not rendered.
  - The S2 note: padding `10px 12px`, `--nulo-border`, `--nulo-surface-low`, 11.5px/1.45
    `--nulo-secondary` (`nulo.css:454`).
- **Details** (`nulo.css:358-362,535-556`; `gen_i6.py:35-73`, check marks per round 4
  `gen_i6r4.py:85`):
  - The disclosure: a `<button>` (batch 4's `RowTarget` pattern), `aria-expanded`, padding
    `11px 12px`, `--nulo-border`, headline 11px/700, 0.1em uppercase, `--nulo-secondary`; hover
    `--nulo-surface-low` and `--txt-primary` (`:358-359`). Label "Details" with the count in
    `.n-tag-quiet` (mono 10px/600, 0.08em uppercase, `--nulo-secondary`, `:165`). Material
    `chevron_right` 16px, rotating 90° over `0.2s var(--bezier)` when open (`:360-361`).
  - The panel: padding 12, gap 10, `--nulo-border` with no top border (`:362`).
  - Head and rows: columns `minmax(0,1fr) 54px 34px 54px 14px`, `column-gap: 4px` (`:536`).
    Head 8.5px mono 600, 0.08em uppercase, `--nulo-outline`, padding-bottom 6, centred from the
    second column, `aria-hidden` (`:537-538`).
  - Sub-headers "Nulo knows" / "Nulo doesn't know": padding `10px 0 5px`, a `--hairline-soft`
    bottom border, headline 10px/700, 0.1em uppercase, `--nulo-secondary` (`:539`).
  - Rows: min-height 30, `--hairline-soft` bottom border (`:540`); the row's target is a
    `RowTarget` button with `aria-expanded` and the A-27 name; hover `--nulo-surface-low`;
    focus outline 1px `--txt-primary` at -1px (`:541-543`).
  - Names 12px/600 `--txt-primary`, ellipsis (`:544`). Addresses 11px mono `--txt-primary`, gap
    6, via `trimAddress(sanitizeWireString(addr, 128), 6, 4, "…")`, with the 12px
    `--nulo-outline` `content_copy` glyph in the A-23 `RowAction` (`:545-546`). Known addresses
    are matched lower-cased.
  - Marks: `check` 15px `--nulo-secondary` (`:556`); a dash is 8×1 `--nulo-outline` (`:548`).
  - The row chevron: `chevron_right` 14px `--nulo-outline`, rotating 90° (`:549-550`).
  - An expanded row: padding `7px 0 10px`, gap 5, bottom border (`:551`); "Simulate" /
    "Transact" in a `58px minmax(0,1fr)` grid, gap 8, mono 10px/1.5; the label 8.5px/600
    uppercase `--nulo-outline`; the functions `--txt-tertiary`, wrapping anywhere (`:552-554`),
    joined by " · " (`gen_i6.py:60-64`), each through `sanitizeWireString`.
  - Footnote 11px/1.45 `--txt-tertiary`, margin-top 10 (`:555`): "Function names come from the
    app. Anything it didn't list is refused instantly; you won't be asked." (`gen_i6.py:70`).
  - Under `prefers-reduced-motion` the chevrons do not animate (precedent `TokensView.vue:520`,
    a media query; program Quality bar 4). jsdom applies no media query, so P9 proves it in
    Chrome, not `DetailsTable.test.ts`; Firefox's driver cannot emulate it (P9).
- **Known contracts.** `wallet/services/dapp-interaction/known-contracts.ts` (new):
  `knownContracts(chainId, protocolFpcAddresses)` is pure over fixed inputs: the protocol Fee
  Juice and Auth registry addresses, the protocol FPC addresses (`FpcService`'s
  `getOrComputeProtocolAddresses`, `fpc/service.ts:90-101`, over `deriveSponsoredFpc` and
  `derivePrivateFpc`, `fpc/protocol-fpcs.ts:19-27`), and `token/default-tokens.ts`. Names come
  from a fixed role table (A-22) and the default token list, never from stored rows: the stored
  FPC rows are seeded with names (`fpc/service.ts:28-29`, written at `:227`) in user-writable
  storage (`updateFpc`, `:308`), and the token store holds dApp-registered rows.
  - `DappInteractionService` receives the derived addresses and fills
    `CapabilityParams.knownContracts: { address, name }[]` when it builds the payload
    (`dapp-interaction/service.ts:411-416`). The popup renders the name as text; no `v-html`.
- **U1.** Rows of `params.heldGrants` fold into `.n-details` "Already allowed · N"
  (`gen_r5.py:101`); opened, it shows them read-only (A-12). Only the new rows fill the groups.
  The folded authorizations row reads `authorizationsEffective` of the snapshot's consent.
  - Newness is per row: a data row is new only when `dataFieldsCovered(held, requested)` says
    the held `data` grant does not already give its field (A-30), and the authorizations row is
    never new on `accountsMembershipOnly` (A-31). The re-request badge sits on new rows only
    (A-4, A-32).
- **Accounts (U2, U5).**
  - `AccountSelectRow.vue:80-90` loses the Alias label and ⓘ `<Tooltip>`; its header
    (`:2-9`) is rewritten for the rename link.
  - The row stops being a `role="button"` that holds controls (`:34-46`; today it already holds
    the alias input). Its selection target is batch 4's `RowTarget` in button mode, stretched
    over the row, with `aria-pressed` for the selection, and `aria-disabled` plus
    `tabindex="-1"` on locked or disabled rows (today's `:tabindex="inert ? -1 : 0"`,
    `AccountSelectRow.vue:42`; CLAUDE.md § Keyboard & focus order); the rename link and the
    alias field are siblings above it, as `RowAction`
    is. The root keeps `cap-account-item` and its `data-*` attributes and loses `role`,
    `tabindex` and the key handlers; the alias block keeps its `@click.stop` (`:77`). Tab order:
    the selection target, then its rename link.
  - A selected, not-locked row shows "Rename for this app": `DottedTerm` key
    `name-for-this-app`, `action` variant, with `@click.stop` so a click never reaches the
    root's selection listener. It sits at the right end of the address line, as drawn
    (`gen_r5.py:69-71`): `.n-arow-line` is a flex row with `justify-content: space-between`,
    `align-items: center`, gap 8 (`nulo.css:140`); today's row has the address alone
    (`AccountSelectRow.vue:65-67`).
  - Pressing it swaps in the existing input (`cap-account-alias-input`, `:92`) under the label
    "Name for this app" (`.n-alias`, `nulo.css:144-147`), prefilled with the account name and
    focused.
  - "SHARED" on locked rows stays (`:62`); they show no link (A-26).
- **`DottedTerm` `action` variant** (batch 3's component).
  - Renders a `<button type="button">` styled as `.n-linkbtn.n-term`: `.n-linkbtn` is headline
    10px/700, 0.1em, uppercase, `--nulo-accent`, `align-self: flex-start`, `cursor: pointer`
    (`nulo.css:149`); `.n-term` adds the dotted underline in the accent at 35% transparency,
    full accent on hover (`:465-466`), and the 1px `--txt-primary` focus ring at a 2px offset
    (`:464`). Its hit area is at least 24px.
  - It emits `click` and keeps the tooltip and the `aria-describedby` target.
  - Batch 3's span variant is unchanged. Its tooltip handler cancels no key's default, so the
    native button's Space activation stands; P8 tests it with the real `Tooltip`.
- **Strings.**
  - `index.vue:336` action;
  - `:357` "Connect as is" (A-13: "Allow as is");
  - `:363` "Account to share" / "Accounts to share" (`gen_i6.py:94`, `gen_r5.py:132`), on a
    widening too (A-31), replacing both "Select…" and "Add accounts to share";
  - `:436` "Connect" / "Allow".
  - The cancelled overlay's message stays (U10).
- **Deleted in 5b**: `CapabilityCard.vue` and its test (replaced by `PermissionRow.test.ts`,
  named in the same commit); the "New permissions requested" / "Already granted" sections.

### U6 and U7 (arc 5a)

- **U6.** `OperationCard.vue:322` renders `"Authorization"` for `aztec_createAuthWit` through a
  local title override. `humanize.ts` is untouched, since other surfaces use it. The unused
  `humanize` import at `execute/index.vue:17` goes. That `Text` gains
  `data-testid="execute-op-title"` (no visible change), so e2e reads the title alone rather than
  the whole card's text.
- **U7.** `popup/pages/settings/connected-apps/[id].vue` gains, directly above "Granted
  permissions" (`:283-287`):
  - a `SectionLabel` "If you allow, it can";
  - `ItemsContainer`;
  - `PermissionRow` fed the authorizations entry of `permission-rows.ts`, its `sub` slot holding
    the dotted term.
  - It is bound to `setAuthorizationsWithoutAsking` and shows `authorizationsEffective`. It
    renders only when the session's accounts grant has `canCreateAuthWit`, and refreshes on
    `onDappSessionUpdated` (`:149-156`). Without a transaction or `simulation.transactions`
    scope it renders switchless with the off line (A-15, as A-2).
  - A failed write reverts the switch and shows A-28's snackbar.

### Testids

| Testid | Where | Status |
|---|---|---|
| `cap-item` + `data-cap-id` (type) + `data-cap-row` (row key) | each permission row | kept; `data-cap-row` new. The unknown aggregate row has `data-cap-row="unknown"` and no `data-cap-id` |
| `cap-toggle` | the row's switch | kept, now only on switch rows. In 5b it is passed to `Toggle` as an attribute, so it replaces the root's `toggle-switch` (`Toggle.vue:24`) on the element whose `@click` toggles (`:29`); never on a wrapper, which `HTMLElement.click()` from P4's fixture would not reach |
| `cap-row-sub` | the row's current line (the switch's `aria-describedby` target) | new |
| `cap-detail-toggle` | the Details disclosure | moved |
| `cap-rerequested-badge` | "previously denied" (A-4) | kept; on each new row of a re-requested type, never on a folded one (A-32) |
| `execute-op-title` | the execute window's operation title (`OperationCard.vue:322`, inside `execute-op-item`, `:314`) | new; P4.3 reads the U6 title by it |
| `cap-unrecognized-badge` | the unknown row's title | kept (CLAUDE.md, testid preservation) |
| `cap-account-item`, `cap-account-alias-input` | account row, alias field | kept |
| `cap-account-rename-btn` | "Rename for this app" | new |
| `cap-auth-term` | the dotted "authorization(s)" | new |
| `cap-details-row`, `cap-details-copy`, `cap-details-fns` | Details table | new |
| `cap-already-allowed` | U1 fold | new |
| `cap-unknown-contracts-note` | S2 note | new |
| `connected-app-authorizations`, `connected-app-authorizations-toggle` | Settings row, switch | new |
| `connected-app-row` | the connected-apps list row's target (batch 4's `RowTarget`) | new |

### Comments in touched files

- Workflow references rewritten as the invariant or deleted: `index.vue:78-84,245-248`
  ("Codex audit-final-merge HIGH #1"); `capability-meta.ts:136-138,189-192`;
  `dispatcher.ts:642-647` ("F-006 / audit cross-cutting #1 / Phase 0.5", kept as the one
  sentence on why the session is read once); `build-items.ts:77-81` ("codex flagged").
- Detached doc blocks deleted or moved onto their declaration: `capability-meta.ts:28-33`;
  `dispatcher.ts:193-199` (an `accountsCapsEqual` doc above `contractsRequestCovered`);
  `dispatcher.ts:286-288` (a `grantsOfType` doc above `sessionAccountsOf`).
- The rider's docs go with the rider (§ Arc 5a window), and two mentions elsewhere are rewritten
  in 5a to the folded authorizations row: `CapabilityParams.accountsMembershipOnly`'s doc
  (`dapp-interaction-protocol.ts:153-155`, "the authwit rider renders as already granted") and
  `accountsWidening`'s doc (`dispatcher.ts:320-322`, "could otherwise drop the authwit rider").
- Rewritten to the current contract: `handleCreateAuthWit` (`dispatcher.ts:972-977`) and
  `isCreateAuthWitCoveredByTxOrSimulationScope` (`method-scope-checkers.ts:264-269`), which both
  claim coverage alone signs silently; `callWithinTxOrSimulationScope`
  (`method-scope-checkers.ts:215-224`), whose "returns true … if there are no
  transaction/simulation grants" is false (`:234`); `applyCapabilityDecision`
  (`service.ts:283-299`), whose "two popups … simultaneously is not a real flow" is false for two
  tabs; `computeCapabilityDelta`'s "contracts APPENDS a grant" (`dispatcher.ts:369-374`), false
  since approved types replace; `enrichGrantedCapabilities`' template line (`:1283`);
  `CapabilityCard.vue:2-21` ("toggleable via the leading checkbox; head is fully clickable") in
  5a, since that PR may land alone; `build-items.ts:1-10`, which describes
  `buildCapabilityItems`; `AccountSelectRow.vue:2-9` in 5b.
- e2e and playground headers rewritten to the new contract in the commit that changes the
  behaviour: `authwit-variants.test.ts:10-19` ("a `callIntent` covered by the granted
  transaction scope signs SILENTLY", false once Off means ask; the `AUDIT (F-01)` marker stays);
  `data-privateEvents.test.ts:10-21` (a `data` grant now starts private events on any contract
  Off); `bundles.ts:8-9` (the address comes from `?tokenAddress=` or the `tokenAddress` input,
  P4.1).
- New comments, one sentence each: the consent's field (never inside a capability);
  `readConsent`'s strictness, stated as its reason (the value crosses `IDappSessionRef` as
  `unknown`, and a tolerant read would let a truthy junk row sign); `effectiveGrants` (the same
  replacement the writer applies, over every stored grant); the dispatch-entry timing at the
  silent-signing condition; `CapabilityParams.heldGrants` against `existingGrants` (every stored
  grant, for the defaults, the fold and Details, where `existingGrants` drops a rejected type for
  the echo); the covered-rejection rule at `dispatcher.ts:368` (a declined widening left the
  held grant in force, so a request inside it needs no window; not for `contractClasses`, whose
  coverage is type-only).

## Security & Adversarial Considerations

Attackers: a malicious or compromised dApp, including one running in several tabs; a page that
frames or floods; an attacker who can write the extension's storage. Every point names its proof.

- **The consent cannot be set by the app.**
  - It lives on the session row, not in any capability, and the dApp's answer never carries it.
  - It is written only from `CapabilityResult` (trusted same-extension contexts, recon fact 9)
    and the Settings setter; `broad` is computed in the background.
  - Proofs (`dispatcher.test.ts`): "a request carrying `authorizationsWithoutAsking` inside
    accounts stores no consent"; "the consent never appears in the `requestCapabilities`
    answer".
- **A narrow consent cannot authorize a scope widened to any contract** (the decided coverage,
  § The consent, "What a consent covers").
  - Proofs (`service.test.ts` and `method-scope-checkers.test.ts`): "a narrow On applied after a
    concurrent broad widening asks", in both completion orders; "a widening to any contract
    through `setCapabilityGrants` asks"; "a revoke through `setCapabilityGrants` deletes the
    consent, and a re-grant starts from ask"; "an explicit broad On survives an unrelated
    decision"; the `authorizationsEffective` truth table (absent, malformed, narrow, narrow then
    widened to any contract → ask, narrow then widened to more listed contracts → On, narrow
    then a listed pattern widened to every function → On, broad).
- **The window decides on the snapshot it was opened against.** Defaults, the fold, Details and
  `broad` come from the dispatch snapshot (`params.heldGrants`,
  `params.authorizationsWithoutAsking`), not from the payload's re-read session. Proof
  (`dispatcher.test.ts`): a Settings write landing between dispatch entry and the window's
  answer changes neither the params the window received nor the decision's `broad`; the later
  write wins on the row.
- **Fail closed.**
  - An absent or malformed consent never signs silently. A row whose consent the schema refuses,
    or that fails its MAC, is hidden or dropped, so the call is refused (no session) rather than
    asked.
  - Proofs: dispatcher "absent asks"; `service.test.ts` "a tampered consent drops the row" via
    the existing MAC harness.
- **No silent fallback.** A close or timeout before the service accepts the approval rejects the
  app's call and never signs. An accepted approval detaches its window before it runs
  (`dapp-interaction/service.ts:199-215`). Proofs (`dapp-interaction/service.test.ts`, through
  the interaction path, not a mocked promise): closed before approval, timed out, and a late
  approval after close, each rejecting with no execution; two concurrent windows for one row, one
  resolved, the other still pending (Ask C-8). Existing cases are cited instead of duplicated.
- **Scope still binds.** The consent adds a condition; it removes none. `checkCreateAuthWit`
  rejects, before any window: an account outside the grant, a call intent outside a held scope,
  an inner hash whose consumer no held scope covers, and every raw hash
  (`method-scope-checkers.ts:276-331`). An in-scope inner hash (its consumer covered by a held
  scope of `"*"` or a pattern whose function is `"*"`, since the checker matches it as function
  `"*"`, `:317-323`, `:38-40`) passes the checker and always opens the window; a call intent reaches the window uncovered only when the app holds no
  transaction or `simulation.transactions` scope (`:226-243`). Proofs: dispatcher "On, inner
  hash still opens the window"; "On, a call intent outside a held scope is refused with no
  window"; "On, no transaction or simulation scope, a call intent opens the window"; the
  existing checker tests untouched; the existing profile-fence tests
  (`dispatcher.test.ts:1094-1116`), now with a consent.
- **Broad requests start Off.** The authorizations and private-events switches start Off on "any
  contract"; the switchless transaction and simulation rows are granted as requested, as the spec
  says (`spec.md:157-161`). Proofs: `permission-rows.test.ts` "any contract defaults Off".
- **Grants equal the window.** The background validation and projection, the duplicate refusal
  and the data coverage fix. Proofs (`dispatcher.test.ts`): an invented field in the manifest,
  in the popup's echo, in the `collectNewGrants` fallback and in `ensureAccountsGrant` is never
  stored; an explicit `accounts` list survives; a duplicate known type is refused; each
  malformed known value is refused before any window: a non-boolean flag (`"yes"`, `1`), a
  scope entry that is not `{ contract, function }`, an empty function name, a scope string
  other than `"*"`, an address that is not `0x` and 64 hex digits, an `accounts` entry without
  a string `item`; each missing required field (`{ type: "contracts", canRegister: true }`,
  `{ type: "transaction" }`, `{ type: "contractClasses" }`, `{ type: "data" }` and
  `{ type: "data", addressBook: false }`); each malformed container
  (`simulation.transactions: "*"`, `simulation.utilities: {}`, `data.privateEvents: []`); the
  modulus boundary (`Fr.MODULUS - 1` as 64 hex digits passes, `Fr.MODULUS` and `0x` + 64 `f`
  refuse, in a scope contract and in an address list); every one of these refusals is the
  same typed error with the same fixed text; valid wire strings pass unchanged; reordered
  capabilities store the same grant; a persisted projected grant verifies its MAC after a
  round-trip; "address book off, then an address-book re-request opens the window"; the `data`
  answer drops a field the person switched off; after a declined data widening, the answer,
  the next window's `heldGrants` and Details still carry the retained grant (A-30); each row of
  A-30's two tables, through the decision, stores what the table says; a type rejected earlier
  whose grant survives appears in `heldGrants` though the app no longer requests it; after a
  declined widening, a request inside the held grant opens no window, is answered from the held
  grant and keeps the rejection, while the identical widening opens the window with that type in
  `reRequested` (A-32); with a class-A `contractClasses` grant beside a `contractClasses`
  rejection, a request for class B still opens the window with `contractClasses` in
  `reRequested`.
- **Batch smuggling.** Batch legs re-enter `dispatch()`. Proof: dispatcher "a createAuthWit
  batch leg with the consent absent opens the window".
- **Window flooding.** Each wallet-sdk session runs one message at a time (its baton), and each
  window rejects on close and times out at 10 minutes. Several sessions of one origin can each
  hold a window: the connect-time admission caps bound verification windows only and release on
  close (`verify-admission.ts:105-120`), so no cross-session bound is claimed. A dApp can already
  open these windows today with in-scope inner hashes, so there is no new class. No cap is added
  (Ask C-8).
- **Blind signing.** The confirmation window is today's parsed card. Proof: an
  `OperationCard.createAuthwit.test.ts` case with a wire-shaped call intent, every field below
  the BN254 modulus (`field(n)`); today's `0xaa…`/`0xff…` fixture values exceed it and throw in
  the installed schemas (`@aztec/foundation` `field.js:39-40`).
- **Names that lie.**
  - "Nulo knows" names come only from constants (A-22).
  - Function names are the app's, marked as such by the footnote and passed through
    `sanitizeWireString`; addresses are sanitized before trimming.
  - Unknown contracts show their address. Nothing renders through `v-html`. Copy is sanitized.
  - Proofs: `dapp-interaction/service.test.ts`, through `requestCapabilities`' payload
    construction with a renamed stored FPC row, a dApp-registered token and a contact present in
    their stores: `params.knownContracts` carries only the constant names (a test of the pure
    helper alone could not see a caller passing stored names); `DetailsTable.test.ts` "bidi and
    control characters in a function name and an address are stripped".
- **Unknown permissions** are granted only when switched on. Proof: `build-items.test.ts`.
- **Clickjacking.** The window keeps today's framing and focus behaviour. No new control
  auto-focuses; the rename field takes focus only after the user presses rename.
- **Profiles and backups.** Sessions are per profile (recon fact 13) and never backed up
  (fact 14; neither the import registry nor the export list, `export/full.vue:94-114`, includes
  them), so the consent never crosses a profile or leaves the device.
- **Legal guard.** Unaffected: authorizations do not broadcast, and `sendTxTask` is untouched.
- **Logging.** No log line is added. The two refusals this batch adds (a duplicate known type, a
  malformed known value) carry fixed text naming only the capability type. Proof
  (`dispatcher.test.ts`): a sentinel string placed in every field of a malformed manifest
  appears nowhere in the thrown error (its message and its own enumerable fields), which is
  the object the background logs (`wallet-sdk/background.ts:1178-1183`). Existing refusal
  errors in `checkCreateAuthWit` interpolate the account, the contract and the dApp's function
  name (`method-scope-checkers.ts:290,306,321`) and reach the Error-level log as the projected
  error message (`wallet-sdk/background.ts:1178-1183`, `logger/utils.ts:169-175`). This batch
  does not change them; that is the owner's D-2 decision, and the plan is not approved until it
  is made (§ Approval).
- **Storage**: one optional object on an existing row. **Dependencies**: none. **Permissions**:
  none.

## Assumptions

### Facts (verified in recon, by both audits, or by reading the file)

1. Every `createAuthWit` passes `checkCreateAuthWit` before the handler, and every non-silent one
   opens the execute window, since every wallet-sdk session confirms at `Transactions`
   (recon facts 2–4).
2. The stored grant is built from the popup's echo, with two fallbacks that store the dApp's raw
   object (recon fact 10).
3. `DappSessionSchema` strips unlisted fields and hides a schema-invalid row; the MAC covers
   every other key and a failing row is dropped (fact 11).
4. Sessions are not a backup slice (fact 14).
5. Only trusted same-extension contexts reach session setters and `resolveInteraction` (fact 9).
6. Messages on one wallet-sdk session run one at a time; several sessions can share one
   `DappSession` row (fact 7).
7. The bundled Material Symbols font has every icon this batch uses (recon, Reuse map).
8. Every playground bundle that requests authorizations (`accounts`, `transaction`,
   `transaction-contracts`, `transaction-scoped`, `full`) lists `simulation.transactions: "*"`
   (`bundles.ts:64-119`). Under the new default they all start Off; P4 adds `transaction-listed`
   for default On.
9. The connected-app page has no tests and no e2e path today (recon, Test impact gaps).
10. `dataRequestCovered` ignores `addressBook` (`dispatcher.ts:252-261`), and
    `enrichGrantedCapabilities` echoes the requested `data` cap (`:1319-1320`).
11. Storybook builds stories under `src/components/**`, `src/design/**` and the design package
    only (`.storybook/main.ts:23-27`).
12. `plan.existingCaps` drops every type with a stored rejection (`dispatcher.ts:379`), while a
    declined widening keeps that type's older grant in force (`service.ts:320-327`) (recon
    fact 34).
13. The capability payload re-reads the session when the window opens
    (`dapp-interaction/service.ts:411-416`), after the dispatch snapshot (recon fact 18).
14. The request guard does not validate capability values (`method-descriptors.ts:117-135`);
    enforcement reads `canCreateAuthWit` by truthiness (`method-scope-checkers.ts:287`) (recon
    fact 35).
15. With a transaction or `simulation.transactions` scope held, an uncovered call intent is
    refused before the handler (`method-scope-checkers.ts:301-308`) (recon fact 36).
16. A re-request narrower than a held scope is covered (`scopeCovers`, `dispatcher.ts:217-232`)
    and opens no window, so the stored scope stays as it was (recon fact 38).
17. The playground's scoped bundles take their address from `?tokenAddress=` and fall back to
    `"0x0"` (`bundles.ts:44-47`); `openPlayground` opens `?test=1` only (`playground.ts:32`),
    and specs fill `pg-input-tokenAddress` after the grant, which the bundle never reads. The
    manifest is built at the click (`sections/connect.ts:48-53`) (recon fact 43).
18. An approved `data` decision replaces the whole stored `data` record
    (`dispatcher.ts:408,422`; `service.ts:320-327`), so a data result built from the two
    switches alone drops a held field the person left Off (recon fact 44).
19. On a membership-only accounts widening the rider renders as already granted
    (`build-items.ts:52`) and the decision keeps the stored accounts grant
    (`dispatcher.ts:409-414`) (recon fact 45).
20. `Toggle.vue:61-63`'s `.wrapper:focus { outline: none }` has the specificity of a one-class
    `:focus-visible` rule; today's locked account row is `tabindex="-1"`
    (`AccountSelectRow.vue:42`) (recon fact 46).
21. A rejected type always joins the delta and `reRequested`, whatever the held grant covers
    (`dispatcher.ts:368,378`) (recon fact 48).
22. `checkCreateAuthWit` matches an inner hash's consumer as function `"*"`, so only a held
    scope of `"*"` or a pattern whose function is `"*"` lets it reach the window
    (`method-scope-checkers.ts:317-323`, `:38-40`) (recon fact 49).
23. `wallet-bridge` exports only its root, which does not re-export `method-scope-checkers.ts`
    (`package.json` `exports`, `index.ts:10-32`) (recon fact 50).
24. `contractClasses` coverage checks only the type (`dispatcher.ts:547-548`), and a grant can
    sit beside a rejection of its type when two windows of one row resolve approve-then-decline
    (`service.ts:323-335`) (recon fact 52).
25. `BrowserDriver` has no media-feature method, and Puppeteer's BiDi `emulateMediaFeatures`
    needs CDP, which Firefox's session lacks (recon fact 53).
26. The interim window's "Already granted" section reads `params.existingGrants`, which is
    `plan.existingCaps` (`dispatcher.ts:1180`, `index.vue:166-171,406-424`); a `data` request
    asking for nothing passes today's code and joins the delta (`dispatcher.ts:543-546`)
    (recon fact 54).

### Asks → codex (decided in the plan audit)

1. **C-1 · Consent storage and default.** **Amended** (codex approved a session boolean; both legs'
   finding on stale consent, and codex's own table ranking B's breadth-aware consent stronger):
   on the session row, as `{ broad }`, absent asks, a malformed row is hidden so calls are
   refused. Codex round 2 keeps the object shape (its review of structural choices 2–3) and
   narrows only the claim made for it (C-18).
2. **C-2 · Transport and atomicity.** **Amended** (codex, fable): the atomic chain
   `CapabilityResult` → `CapabilityDecision` → `applyCapabilityDecision`, with `broad` computed
   from the dispatch snapshot the window saw, applied even when `accounts` is not in the delta
   (`requiresGrant: ["accounts"]`). A separate setter call is rejected.
3. **C-3 · The any-contract predicate.** **Approved** (both): a malformed scope counts as broad
   and never defaults On; utilities are excluded from `coversAnyContract`. The predicate does not
   replace input validation, which C-19 adds.
4. **C-4 · The belt.** **Rejected as written** (codex; fable amended the same way): no written
   belt. The read-time rule `broad || !coversAnyContract` resets only on a widening to any
   contract, keeps an explicit broad On, and holds for every grant writer; both writers delete
   the consent when `canCreateAuthWit` goes (round 2). The concurrent-window test in both
   orders is its acceptance criterion; C-18 records what it deliberately does not reset on.
5. **C-5 · Projection.** **Amended** (codex; fable proposed dropping it): the background projects
   known types at the manifest and at both raw fallbacks, keeping every field a checker reads,
   including an explicit `accounts` list, wire-shaped. The popup projection and its test are
   gone.
6. **C-6 · Known contracts.** **Amended** (codex approved background computation from fixed,
   chain-bound sources; fable added purity): a pure `knownContracts` over constants and
   `FpcService`'s derived addresses, never stored names.
7. **C-7 · The testid mapping.** **Amended** (codex): `cap-unrecognized-badge` is kept; static
   testids on the new term controls; `connected-app-row` on the row's target; fable's two notes
   (both data rows carry the re-request badge; the aggregate unknown row's attributes) applied.
   The badge note is superseded in round 4: new rows only (A-32, an owner ask).
8. **C-8 · No flood cap.** **Amended** (codex, fable): no new cap; the cross-session bound is
   withdrawn; concurrent-window isolation is tested.
9. **C-9 · e2e reaching On.** **Amended** (both): a `transaction-listed` playground bundle for
   default On, plus explicit On-through-the-switch and broad-On coverage.
10. **C-10 · Module placement.** **Rejected** (codex; fable approved on the Biome override):
    CLAUDE.md allows imports only from lower layers, so `PermissionRow` (L3) imports no other L3
    component; the consumers fill its slot with `DottedTerm`. `AuthorizationsRow` is dropped;
    `DetailsTable` moves to `components/composite/capabilities/` (L3, presentational).
11. **C-11 · The 5a/5b split.** **Amended** (codex; fable preferred the drawn groups in 5a): the
    program's arc split stays; 5a's interim is fully specified in drawn words (A-1), keyboard
    operable, and `PermissionRow` is built before its first consumer (Settings, P3).
12. **C-12 · `DottedTerm`'s `action` variant.** **Approved with qualification** (both), amended
    in round 2: jsdom cannot synthesize a click from a key on a button, so the component test
    asserts the real `Tooltip` leaves the key's default alone and propagation stops; native
    activation is proven in the browser (P9, both browsers).
13. **C-13 · Switch semantics.** **Approved** (both): the switch's `aria-describedby` points at
    the row's current line.
14. **C-14 · The Settings setter guard.** **Approved** (both): refuse On without
    `canCreateAuthWit`, refuse a non-boolean, emit the update.
15. **C-15 · Snapshot timing.** **Approved** (both): dispatch-entry semantics, one decision on one
    snapshot; the guarantee is qualified above. Round 2 names the tests: an in-flight silent
    signing held open while Settings turns Off completes, and the next call asks (P1); a
    Settings write between dispatch entry and the window's answer changes neither the window's
    params nor `broad` (C-20).
16. **C-16 · Duplicate known types** (raised by codex). **Decided** (codex): refuse, since the
    shipped dApps send one per type.
17. **C-17 · Parallel execution** (outline B row 11). **Rejected** (codex; fable approved):
    phases run serially; parallel agents add no correctness.
18. **C-18 · What a consent covers** (round 2, codex 1, fable 3). **Decided** (driver, the
    weaker of codex's two offered fixes, as fable proposed; round 3 confirms): a narrow consent
    carries over to more listed contracts or functions and resets only on a widening to any
    contract, since the spec defines On as silent signing "inside the app's listed scope". The
    guarantee text says so; tests pin both outcomes; the visible consequence is in the PR body,
    and A-5 offers the owner the alternative of surfacing the row on every widening.
19. **C-19 · Value validation at the projection** (round 2, codex 3). **Decided**: flags strictly
    boolean, scopes and address lists in wire shape, addresses `0x` and 64 hex digits kept as
    sent, refusal before any window with fixed text. **Amended in round 3** (codex 2): required
    fields and present nested containers are checked, addresses must be below the BN254
    modulus, and every validation failure, a thrown one included, becomes the one typed error.
    **Amended in round 5** (fable 3): a `data` capability must ask for the address book
    (`addressBook: true`) or private events.
20. **C-20 · What the window reads** (round 2, codex security note). **Decided**: the snapshot's
    held grants and consent travel in `CapabilityParams`; the window never reads the re-read
    session's grants or consent.
21. **C-21 · The `data` result, field by field** (round 3, codex 1). **Decided** (technical
    half): the popup builds `data` against the held record so the whole-record replacement
    cannot drop a held field left Off; all new rows Off rejects the type. The visible meaning
    (keep vs revoke) stays the owner's, A-30.

### Plan audit ledger

Round 1 ran in parallel, both legs seeing the plan, outline B and the recon.

- `/codex high` (GPT-6 Astra, session `01a0d4dc-1f83-7c01-9803-9ae152ba4354`): **conditional
  approve, confidence high**. Conditions: its findings 1–12.
- Fable (same-family leg): **conditional approve, confidence high**. Conditions: its findings
  1–6.

Structural points (outline B's table):

| # | Point | Adopted | Why | Rejected alternative |
|---|---|---|---|---|
| 1 | Where the consent lives | Main: the session row | Codex: fewer record-replacement consequences; fable found both sound | B's sibling on the accounts grant record |
| 2 | Its shape | B: `{ broad }` | Both legs' stale-consent finding needs the consent basis; codex ranked it stronger | A bare boolean with a written belt |
| 3 | The widening rule | B: derived at read | Survives two tabs and every grant writer; keeps an explicit broad On | Main's belt (fails the interleaving) |
| 4 | Enforcement seam | Main: one `&&` in the dispatcher, over B's exported predicate | Codex: no routing helper; fable's truth table is kept on `authorizationsEffective` | `signsAuthWitSilently` as a second helper |
| 5 | Transport | Main's atomic chain plus B's delta-less write | Both | A separate setter |
| 6 | Projection | B's place (background), neither's method | Main's popup projection misses two raw paths; the upstream schema drops `accounts` and objectifies addresses | Dropping it (fable): Quality bar 4 promises it |
| 7 | Arc split | Main (codex) | The program assigns the groups to 5b; fable's own fallback (every interim string listed) is applied | B's groups in 5a (fable) |
| 8 | Known names | B | Constants are vouchable by construction | Stored FPC and token names |
| 9 | Components | B, amended | One `PermissionRow` plus the row table; slots keep L3 flat | `AuthorizationsRow` |
| 10 | e2e bundle | B | Default On is the spec's main case | Reaching On only through the switch |
| 11 | Parallel phases | Main (codex) | No correctness benefit | Two parallel agents |

Disputed (held for the owner or the driver):

- **D-1 · Undrawn states shipped as sign-off pending.** Codex (round 1 finding 7, round 2
  finding 4): the standing exception covers drawn round-5 recommendations only. **Resolved in
  round 2 by the program's own texts**: spec § How to use it ("a state has no shot, the batch
  stops for that surface and asks the owner") and the program's `/loop` seed ("a UI question
  none of those answers → hold and notify me"). P0 draws every undrawn ask into the artifact as
  a round-5 addendum with its recommendation and a picker, publishes it and notifies the owner
  before any phase builds one; with no pick, the drawn recommendation is built sign-off pending
  (program § Round 5). No audit approves an undrawn string, layout or state.
- **D-2 · Request data in refusal logs.** Codex (finding 11): log a fixed category at the
  authorization refusal sinks and add a sentinel regression. The leak is real and pre-existing,
  and the sinks (`wallet-sdk/background.ts`, `execution/service.ts`,
  `dapp-interaction/service.ts`) are outside this batch's items, so the fix is held as a
  follow-up for `implementations-plan/follow-ups.md`; the Security section states the fact.
  Round 2 (codex finding 5) rejects the deferral. Still held: codex is advisory and cannot
  widen the batch's scope (program § Open asks, § Hard limits), so the conflict goes to the
  owner. What is in scope is done: the two refusals this batch adds carry fixed text, with a
  sentinel test (§ Security, "Logging").
  Round 3 (codex finding 3) asks that D-2 block approval until the owner disposes of it. Held
  as it stands: the batch adds no line that logs request data, and widening it to the existing
  sinks is a scope decision that only the owner makes. It goes to the owner as an explicit ask,
  with two options: (a) the follow-up (recommended: it is pre-existing and its sinks are outside
  this batch), or (b) in scope for 5a: codex's limited fix, a fixed category logged at the
  authorization refusal sinks in place of the message that carries
  `method-scope-checkers.ts:290,306,321`'s values, plus a sentinel regression.
  Round 4 (codex finding 1, its approval condition 1): recording D-2 as open is not a
  disposition. Accepted: § Approval now requires the owner's explicit answer, either (a)
  accepting the documented deferral or (b) authorizing the limited sink fix; an unanswered ask,
  silence or an open PR-body item is not acceptance, and the plan stays held on D-2 until the
  answer arrives. The ask stays two options, (a) recommended. The sink fix is not planned here:
  on (b) the owner's authorization amends this plan with its phase and test, re-audited, before
  P1. The leak is re-verified on the rebased tree: the checker errors still interpolate request
  values (`method-scope-checkers.ts:290,306,321`) and the background still logs them at Error
  (`wallet-sdk/background.ts:1178-1183`).
  Round 5 (codex finding 1): the plan's condition is met; the owner's disposition is not. No
  answer is recorded as of 2026-09-24. § Approval states the rule unchanged: approval needs the
  owner's explicit (a) or (b); the plan stays held on D-2 until it arrives. Nothing here plans
  the sink fix.
  **Answered 2026-09-24, (a).** The owner, in chat: "Yes. Defer to afterwards." The sink fix is
  the follow-up in `implementations-plan/follow-ups.md`, written in 5a's delivery (§ Delivery);
  this batch's own two refusals keep their fixed text and sentinel test.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex, fable | major | Two tabs of one origin share a session row with separate batons; a narrow On can land after a broad widening, and the belt never fires because a value was sent; the belt also clears an explicit broad On | Confirmed (`background.ts:453-455`, `service.ts:132-134,301-341`). Consent `{ broad }` from the window's snapshot, read-time rule; tests in both orders, a `setCapabilityGrants` widening, an unrelated decision (§ The consent) |
| 2 | codex, fable | major | The popup projection misses `ensureAccountsGrant` and the `collectNewGrants` fallback; B's upstream schema drops the enforced `accounts` list and parses addresses; duplicate types pick the last differing entry | Confirmed (`dispatcher.ts:466-512`, `method-scope-checkers.ts:279-292`). Background projection at the manifest and both fallbacks, wire-shaped; duplicates refused; MAC round-trip, reorder and fallback tests (§ The grant boundary) |
| 3 | codex | major | `dataRequestCovered` ignores `addressBook`, so the split lets an address-book re-request skip the window | Confirmed (`dispatcher.ts:252-261`). Fixed with a regression test |
| 4 | codex, fable | major | Details from the manifest alone cannot show U1's held contracts or a mixed broad/narrow request | Confirmed (`gen_r5.py:108`). `effectiveGrants` feeds Details; A-7 amended for mixed requests (owner ask) |
| 5 | codex | major | `AuthorizationsRow` (P3) wraps `PermissionRow` (P6); L3 importing L3 breaks CLAUDE.md | Confirmed. `PermissionRow` built in P3; no L3 nesting; slots (Ask C-10) |
| 6 | codex, fable | major | Tests that pass while wrong: P4's "assert the error class" escape; "Connect sends the builder's output"; `transaction-scoped` cannot show default On or S1; `cap-widening` is a membership flow; the authwit fixture's field values are invalid | Confirmed (`bundles.ts:90-95`, `cap-widening.test.ts:64-81`, `field.js:39-40`). Positive paths assert `ok`; literal expected results; `transaction-listed`; a scope-widening e2e; valid fields; interaction-path close, timeout and late-approval tests |
| 7 | codex | major | Sign-off pending stretched over undrawn states; the broad authorizations row has no chip in the drawing; a disabled `Toggle` draws a lock; the banner's "Approve as is" is a sentence, not the button | Chip removed (`gen_i6r4.py:88-94`); A-12 without switches; A-13 corrected (`index.vue:340-359`); asks split drawn/undrawn; the rest is D-1 |
| 8 | codex, fable | major | Keyboard: the 5a tick is click-only; rename must not reach the row's Enter/Space; a Details row is a button holding a copy button; the head hides the columns; P9's Tab sequence misses selection and terms; copy Tab stops conflict with CLAUDE.md | Confirmed (`CapabilityCard.vue:85-93`, `AccountSelectRow.vue:41-46`, `gen_i6.py:52`). Switch control in 5a; `@click.stop`/`@keydown.stop`; batch 4's `RowTarget` + `RowAction` siblings; A-27 names; copy out of Tab order (A-23, owner ask); P9 sequence corrected |
| 9 | codex, fable | minor | Dropping `cap-unrecognized-badge` breaks testid preservation; batch 3's in-sentence measurement is owed here; S2 must fit too; batch 4's toast and copy APIs; the viewport must be set | Testid kept; P9 measures the inline term and asserts fit at an explicit 400×800 for the S2 shape, which bounds S1; batch 4 helpers named |
| 10 | codex | minor | Facts: admission caps do not bound established sessions; malformed or MAC-failed rows reject, not ask; inner hashes conflated; "only the popup"; A-20 is false; fact 8 overstated | All corrected here and in recon.md |
| 11 | codex | major | Refusal errors carry request data into logs | Pre-existing, outside scope: Security states it; D-2 |
| 12 | codex, fable | minor | Stale comments on the changed path (dispatcher header, the scope helper's return claim, "not a real flow", the account-row header, the rider docs) | All listed in § Comments in touched files |
| 13 | fable | major | The `DetailsTable` story sits outside Storybook's globs | Confirmed (`.storybook/main.ts:23-27`). Moved to `components/composite/capabilities/` |
| 14 | fable | minor | A-6 omits the unknown row, which S3 flags | Confirmed (`gen_i6.py:263`). A-6 covers both rows |
| 15 | fable | minor | The `data` answer tells the dApp it has what the split dropped | Confirmed (`dispatcher.ts:1319-1320`). Stored fields spread; `cap-request-partial` asserts them |
| 16 | fable | minor | A-5 has no e2e | A narrow-to-broad widening flow in `cap-window.test.ts` |
| 17 | fable | minor | `info` may be missing from the font | Rejected: present (fontTools, 4,229 ligatures). Stays an owner ask (A-17) |
| 18 | fable | minor | Parity values not quoted for Details, the note, the chip, the switch | Quoted with file:line in § Arc 5b window |
| 19 | fable | minor | Undefined: utilities-only "any contract", zero accounts selected, locked rows' rename | A-24, A-25, A-26 (owner asks) |
| 20 | fable | minor | Addresses are dApp-controlled; the popup's result is unvalidated | `sanitizeWireString` before `trimAddress`; strict `=== true`/`=== false` read |
| 21 | fable | minor | `components/composite/capabilities/` already exists; the unknown row aggregates with a count | Both placed there; A-10 and the testid table state the aggregate |
| 22 | fable | info | Batch 4 changes the copy helper and toasts; batch 3's counts reconcile to 36 | A-23 and A-28 go through batch 4's helpers; P8 recounts |

Round 2 ran in parallel on this consolidated plan and the round-1 ledger.

- `/codex high` (GPT-6 Astra, session `01a0d4fb-bce0-7121-9f10-1f6013ae3a01`): **reject,
  confidence high**. Findings 1–10 plus its security notes.
- Fable (same-family leg): **conditional approve, confidence high**. Conditions: its findings
  1–3; minors 4–14 and the comment list.

Round 2:

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex, fable | major | The consent's lifetime claim is too strong: a listed-to-listed or function widening keeps a narrow consent; `setCapabilityGrants` can revoke without clearing it | Confirmed (`service.ts:259-263`; the predicate reads only breadth). Guarantee narrowed explicitly (Quality bar 2, visible consequences, truth table "widened to any contract"), decided as C-18 on the spec's "inside the app's listed scope"; tests pin both outcomes; both writers delete the consent when `canCreateAuthWit` goes, with a revoke/re-grant test; the other reading is offered to the owner in A-5. An exact scope basis on the row is rejected |
| 2 | codex, fable | major | A declined widening keeps its older grant, which the window's "Not shared" and the rejection-filtered `existingCaps` hide from the fold, Details and `broad` | Confirmed (`dispatcher.ts:379`, `service.ts:320-327`). `CapabilityParams.heldGrants` from the snapshot feeds defaults, `broad`, the fold and Details; the `data` answer is built from the stored fields; A-30 asks the owner; tests for both retained-grant cases |
| 3 | codex | major | Projection is not validation: nested scopes, flags and addresses pass unchecked, and enforcement reads `canCreateAuthWit` by truthiness | Confirmed (`method-descriptors.ts:117-135`, `method-scope-checkers.ts:287`). Wire-shape validation at the projection, refusal before any window (C-19), one test per malformed shape |
| 4 | codex | major | D-1 recorded, not resolved: undrawn states built on the driver's judgement | Confirmed by spec § How to use it and the program's `/loop` seed. P0 draws them as a round-5 addendum before any phase builds one; D-1 closed |
| 5 | codex | major | Request data still reaches refusal logs | Partly accepted: the batch's two new refusals carry fixed text with a sentinel test. The pre-existing sinks stay D-2, held for the owner (codex cannot widen scope) |
| 6 | codex | major | The Firefox canaries cannot run locally; the gate says they must | Confirmed (program `plan.md:126-146`). P5 and P10 split Chrome's local gate from Firefox's CI evidence on the exact head, row kept open until it exists; every e2e gate names its browser's mode |
| 7 | codex, fable | minor | Two drawn "Any contract" chips omitted; the tooltip recount misses the Settings term | Confirmed (`gen_r5.py:158,160,166`). Chips on all three rows, their flag state A-29; P8 recounts every `DottedTerm` site including U7's and surfaces a mismatch to the owner |
| 8 | codex | minor | The rename button sits inside the account row's `role="button"` | Confirmed (`AccountSelectRow.vue:34-46`; the alias input already does). Batch 4's `RowTarget` becomes the selection target, the link and field its siblings |
| 9 | codex, fable | minor | Tests that cannot prove their claim: a fit fixture shorter than S2; native Enter/Space in jsdom; "uncovered opens the window" contradicts the checker; the in-flight Settings test is promised, not specified | Confirmed (`gen_i6.py:178,222`; `method-scope-checkers.ts:301-308`). `transaction-listed` gains a listed `contracts` cap and the fit test asserts S2's rows; rename pressed with Enter and Space in P9 on both browsers, C-12 amended; the dispatcher case split into refused and window; in-flight and intervening-write tests named (C-15, C-20) |
| 10 | codex, fable | minor | Comments missed: detached docs, stale "contracts APPENDS", workflow provenance, the coverage-alone doc, the template line, the card and builder headers | Confirmed (`dispatcher.ts:193,286,373,642,1283`, `build-items.ts:1-10,77`, `method-scope-checkers.ts:264`, `CapabilityCard.vue:2-21`). All listed in § Comments; one timing sentence added at the gate |
| 11 | codex | security | The payload re-reads the session, so the window is not on the dispatch snapshot | Confirmed (`dapp-interaction/service.ts:411-416`). C-20; a test with a Settings write in between |
| 12 | codex | security | The known-name exclusion test must go through payload construction | Accepted: moved to `dapp-interaction/service.test.ts` over real stores |
| 13 | codex | minor | Round-1 row 15: spreading only present keys leaves a switched-off field in the answer | Accepted: the `data` answer is built from the stored grant, absent fields removed |
| 14 | fable | minor | `PermissionRow` (L3) typed by the L5 row table | Confirmed (CLAUDE.md L0–L6; `biome.json:362-396` does not catch it). Own primitive props |
| 15 | fable | minor | Settings shows a useless switch for an app with no transaction or simulation scope | Accepted as an owner ask (A-15, mirrors A-2); an `[id].test.ts` case |
| 16 | fable | minor | `permission-rows.test.ts` pins against the whole file | Confirmed (`06-row-list-U4` is tab-separated per row). Per-row cell pins, B lines from `06-auth-row-B`, the hidden broad on-line from `gen_i6r4.py:91` |
| 17 | fable | minor | The inline-term measurement has no testid for the sub-line | Accepted: `cap-row-sub` |
| 18 | fable | minor | `data-privateEvents` asserting `ok` may fail on stub event metadata | Partly accepted: its own header says `ok` needs real `Transfer` metadata and a transfer (`data-privateEvents.test.ts:14-20`). P4 probes the base; `ok` if the base reaches it, else "no scope refusal" with an Off control that is refused, logged. Real metadata in the playground rejected as scope growth |
| 19 | fable | minor | The rename link's type and place are not quoted | Accepted (`nulo.css:140,149,464-466`, `gen_r5.py:69-71`) |
| 20 | fable | minor | `toggleOff` kept with no caller | Accepted: deleted with its only caller's rewrite |
| 21 | fable | minor | A narrowing re-request while the consent is Off folds the row and keeps asking | Rejected: a narrower request is covered (`scopeCovers`, `dispatcher.ts:217-232`), opens no window and stores nothing, so no fold appears; the stored broad scope and its Off stand, and Settings is the way to turn it On |
| 22 | fable | minor | `DetailsTable.test.ts` lists nine cases; L3 needs ten | Accepted: at least 10 stated |
| 23 | fable | minor | Round-1 slips: A-1's switch-label citation, "four" cards | Confirmed (`gen_i6.py:145,261,267`, `gen_r5.py:13,103,181`). Fixed |

Round 3 ran in parallel on the revised plan and the round-2 ledger.

- `/codex high` (GPT-6 Astra, session `01a0d4fb-bce0-7121-9f10-1f6013ae3a01`): **reject,
  confidence high**. Round-2 findings 2, 3 and 5 unmet; findings 1–4.
- Fable (same-family leg): **conditional approve, confidence high**. Condition: its finding 1;
  minors 2–7 and one comment adjustment.

Round 3:

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | fable | major | `transaction-listed` requests `"0x0"`: the bundle reads the address only from `?tokenAddress=`, which no spec sets, so C-19 refuses it and every P4/P9 flow fails at `requestCapabilities` | Confirmed (`bundles.ts:44-47`, `playground.ts:32`; specs fill the input after the grant). `getTokenAddress()` falls back to the `tokenAddress` input (`state.ts:69`); P4 fixtures set it before `requestCapabilities`; "the request is answered, not refused" is the first assertion (P4.2, P4.3, P9); fact 17, recon fact 43 |
| 2 | codex | major | A-30's retention is broken by the builder: address book On with private events Off yields `{ addressBook: true }`, which replaces the whole `data` record and drops held private events; both Off keeps both | Confirmed (`dispatcher.ts:408,422`, `service.ts:320-327`). The `data` result is built field by field against the held record, per-row newness follows U1A's rule, all new rows Off rejects the type; A-30 gains the mixed-state tables for the owner; C-21; builder, dispatcher and component tests per table row |
| 3 | codex | major | The validator admits missing required fields and addresses at or above the field modulus | Confirmed (`capabilities.ts:23-46`, `dispatcher.ts:206`, `method-scope-checkers.ts:51`, `field.js:39-40`). Required fields and present containers checked, modulus bound via `Fr.MODULUS`, every failure the one typed error; missing-field, container and modulus-boundary cases (C-19 amended) |
| 4 | codex | major | D-2 must block approval, not stay held | Disputed and held: the batch logs no request data; widening to the existing sinks is the owner's scope call. Sent to the owner as an explicit two-option ask; § Approval records the answer or D-2 open in the PR body (D-2, round 3) |
| 5 | codex | minor | P4.5's fallback passes when On grants nothing (a dropped `data` grant fails with `CapabilityNotGrantedError`, not a scope refusal) | Confirmed (`dispatcher.ts:1364`, `method-scope-checkers.ts:205`). P4.5 asserts the stored grant and the answer carry the private events, and accepts only `ok` or the exact failure the base run logged; the Off control stays |
| 6 | fable | minor | Membership-only widening: the derived authorizations row would count as new, send a value and rewrite `broad` | Confirmed (`build-items.ts:52`, `dispatcher.ts:409-414`). A-31 (owner ask, recommended as today): folded, no value sent; A-1's interim keeps today's card; `index.test.ts` and `build-items.test.ts` cases |
| 7 | fable | minor | P9's fixture unnamed; the file-scoped one lets flows contaminate each other | Confirmed (`fixtures/extension.ts:643-669`). `cap-window.test.ts` uses `dappConnectedExtensionPerTest` |
| 8 | fable | minor | A locked account's target stays a Tab stop under `aria-disabled` alone | Confirmed (`AccountSelectRow.vue:42`). `tabindex="-1"` on locked or disabled targets, asserted in P8 |
| 9 | fable | minor | A-19's ring ties `.wrapper:focus` on specificity | Confirmed (`Toggle.vue:61-63`). `.row .switch:focus-visible`; P9 reads the focused switch's computed `outline-style` after Tab |
| 10 | fable | minor | The rename link's 24px hit area is never measured | Accepted: P9 asserts `cap-account-rename-btn`'s rect is at least 24px tall and wide |
| 11 | fable | minor | e2e and playground headers describe the old contract | Confirmed (`authwit-variants.test.ts:10-19`, `data-privateEvents.test.ts:10-21`, `bundles.ts:8-9`). Added to § Comments |
| 12 | fable | comment | `readConsent`'s comment should state its reason | Accepted (§ Comments) |

Round 4 ran in parallel on the revised plan and the round-3 ledger, after the stack was rebased
onto dev `9f11de70`.

- `/codex high` (GPT-6 Astra, session `01a0d4fb-bce0-7121-9f10-1f6013ae3a01`): **conditional
  approve, confidence high**. Round-3 findings 1, 2 and 4 met; conditions: its findings 1 (D-2)
  and 2 (A-30's wire shapes).
- Fable (same-family leg): **conditional approve, confidence high**. Every round-3 item met;
  conditions: its findings 1 and 2; minors 3–8 and the comments (9).

Round 4:

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | D-2 still passes approval by being "recorded as open" in the PR body; that establishes no acceptance | Accepted (the leak re-verified: `method-scope-checkers.ts:290,306,321`, `wallet-sdk/background.ts:1178-1183`). § Approval requires the owner's explicit (a) or (b); an unanswered ask or an open PR-body item is not acceptance; the plan stays held on D-2. The ask stays two options, (a) recommended; the sink fix is not planned here, and (b) amends the plan before P1. Delivery and § Scope follow |
| 2 | codex | minor | A-30's tables write `privateEvents: "*"` and `[A, B]`; the wire shape is `{ contracts: … }` | Confirmed (`capabilities.ts:47-51`, `method-scope-checkers.ts:206`). Every request and stored cell corrected, the retention unchanged; recon fact 44 corrected too |
| 3 | fable | minor (condition 1) | P4.3's inner-hash flow names no bundle; on `transaction-listed` the checker refuses it before any window | Confirmed (`method-scope-checkers.ts:317-323` matches the consumer as function `"*"`; `matchesPattern`, `:38-40`, passes only a pattern whose function is `"*"`; the bundle's pattern is `transfer_public_to_public`). P4.3's flow runs on `transaction` (scope `"*"`, as `authwit-variants.test.ts:29` does today) and never accepts `error`; § Security says what "in-scope inner hash" means; recon fact 49 |
| 4 | fable | minor (condition 2) | A `data` re-request after a declined widening is unstated, and A-4 ("both data rows") contradicts A-30's per-row fold; a request for exactly what is held opens a window with empty groups | Confirmed (`dispatcher.ts:368,378`). A UI state, so an owner ask: A-32, recommended per-row newness with the badge on new rows only and a covered rejected type treated as covered (no window); alternative, all rows new with the badge. A-4 reconciled; drawn in P0; `index.test.ts` and `dispatcher.test.ts` cases; recon fact 48 |
| 5 | fable | minor | The accounts label on a widening ("Add accounts to share", `index.vue:363`) is undrawn and unstated | Confirmed (`index.vue:362-365`; U2 draws a first connect, `gen_r5.py:132`). Added to A-31 as an owner ask, recommended U2's label with today's count; drawn in P0 |
| 6 | fable | minor | P4.4 names no bundle; with `data` the private-events row already starts Off, so switching it off proves only the default | Confirmed (`bundles.ts:52-56,101-105`, `cap-request-partial.test.ts:27`). P4.4 uses `data-scopedEvents` with the token address, switches private events Off and asserts `addressBook: true` and no `privateEvents` in the stored grant and the answer |
| 7 | fable | minor | P7.2's reduced-motion case cannot fail in jsdom | Confirmed (a media query, `TokensView.vue:520`). Dropped from `DetailsTable.test.ts` (ten cases remain); P9 emulates `prefers-reduced-motion: reduce` and reads the chevron's computed `transition-duration` |
| 8 | fable | minor | The execute window's title has no testid | Confirmed (`OperationCard.vue:322` is a bare `Text` in `execute-op-item`, `:314`). `execute-op-title` added (no visible change); P4.3 asserts it equals "Authorization" |
| 9 | fable | minor | The popup's data newness re-implements the private `dataRequestCovered` | Confirmed (`dispatcher.ts:252-261`). One exported `dataFieldsCovered` in `dispatcher.ts` (per-field result) serves the dispatcher's coverage, the popup's newness and `buildGrant` |
| 10 | fable | minor | `cap-toggle` must land on the `Toggle` root | Confirmed (`Toggle.vue:24,29`). Passed to `Toggle` as an attribute, stated in the testid table and § Components |
| 11 | fable | comment | Two stale rider mentions; `heldGrants` needs its distinction from `existingGrants` stated | Confirmed (`dapp-interaction-protocol.ts:153-155`, `dispatcher.ts:320-322`). Both rewritten in 5a; the `heldGrants` sentence and the covered-rejection sentence added to § Comments |
| 12 | driver | minor | The five predicates live in `method-scope-checkers.ts`, which the package root does not re-export, so the popup and Settings cannot import them | Confirmed (`packages/wallet-bridge/src/index.ts:10-32`; `package.json` exports only `"."`). Named re-exports in `index.ts` (§ The consent, "Predicates"); recon fact 50 |
| 13 | driver | minor | Base drift: the FPC derivation moved (#690) and the tools app left the repo (#691) | Re-verified: known contracts cite `fpc/service.ts:90-101` over `fpc/protocol-fpcs.ts:19-27`, seeded names `service.ts:28-29,227`; the duplicates claim, A-22 and P10 no longer cite `apps/tools`; § Scope updated; the U1A quote is `gen_r5.py:118`. Recon row and fact 51 updated. `packages/aztec-runtime/src/fee-juice.ts` (min-fee prediction) touches nothing here |

Round 5 ran in parallel on the revised plan and the round-4 ledger.

- `/codex high` (GPT-6 Astra, session `01a0d4fb-bce0-7121-9f10-1f6013ae3a01`): **conditional
  approve, confidence high**. Round-4 finding 2 met, finding 1's plan text met; conditions:
  its finding 1 (the owner's D-2 answer) and finding 3 (A-32's `contractClasses` exception and
  its regression).
- Fable (same-family leg): **conditional approve, confidence high**. Every round-4 item met;
  conditions: its findings 1 and 2; minor 3.

Round 5:

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | D-2: the plan's approval rule is fixed, but no owner answer is recorded, and the leak stands (`method-scope-checkers.ts:306`, `wallet-sdk/background.ts:1178`) | Re-verified (`method-scope-checkers.ts:290,306,321`, `background.ts:1178-1183`). The owner's scope decision, not the plan's: § Approval requires the owner's explicit (a) accepting the deferral or (b) authorizing the limited sink fix; an unanswered ask or an open PR-body item is not acceptance. The ask stays two options, (a) recommended; the sink fix is not planned. Held on D-2 |
| 2 | codex | minor | Round-4 A-30 wire shapes | Met; no change |
| 3 | codex | minor | A-32 treats every known type as field-aware, but `contractClasses` coverage is type-only: with class A granted and B declined in two windows, re-requesting B would skip the window and answer B as granted while enforcement refuses it | Confirmed (`dispatcher.ts:547-548`; approve-then-decline leaves grant and rejection, `service.ts:323-335`; the answer echoes a covered type, `dispatcher.ts:1154-1159,1286-1321`; enforcement `method-scope-checkers.ts:95-104`). Fable's "cannot exist" missed the two-window order. `contractClasses` and unknown types keep today's rejected-type rule (A-32, § The grant boundary, visible consequences, § Comments); a P1 and § Security regression with a retained class grant, a rejection and an uncovered class; recon fact 52. It narrows the owner ask back toward today's behaviour, so A-32 stays sign-off pending with the note drawn in P0 |
| 4 | fable | minor (condition 1) | P9's Firefox reduced-motion proof names a `BrowserDriver` mechanism that does not exist; BiDi `emulateMediaFeatures` throws on Firefox | Confirmed (`fixtures/browser/index.ts:48-140` has no media method; FIREFOX.md names none; Puppeteer 25.8.0's BiDi page routes it through the CDP emulation manager). Chrome only, stated: its own `test.skipIf(isFirefox)` case with the reason, as `sw-resilience.test.ts:64-65` does, the counterfactual kept; the P9 gate says the case skips by name on Firefox. The `chromeScript` pref method is rejected (unproven live re-evaluation, new driver surface for one assertion); recon fact 53 |
| 5 | fable | minor (condition 2) | 5a's "Already granted" data cards have no stated source: `existingGrants` drops a rejected `data` type, so P2.4's address-book card cannot come from it, and reading `heldGrants` beside an un-rejected `data` cap in `existingGrants` draws the record twice | Confirmed (`dispatcher.ts:379,1180`; `index.vue:166-171,406-424`). Which cards the section shows is a UI state, so an owner ask inside A-1, recommended and built: the data cards come from `params.heldGrants`, and a `data` entry of `existingGrants` draws none; alternative, today's source alone. Drawn in P0 with A-1's crops, sign-off pending; § Arc 5a window states the builder rule; a P2.4 case asserts exactly one card per held field; recon fact 54 |
| 6 | fable | minor | A `data` request asking for nothing passes C-19, opens a window with no data row and records a rejection | Confirmed (`capabilities.ts:47-51`, `dispatcher.ts:543-546`). C-19 amended: `addressBook: true` or `privateEvents` required; two malformed-manifest cases; the refusal joins the visible consequences |
| 7 | driver | minor | C-19 refuses the bare shapes existing dispatcher tests send (`{ type: "data" }`, `{ type: "contracts" }` as manifests and popup echoes) | Confirmed (`dispatcher.test.ts:153,188,203,252,264,1528`). P1.3 moves them to valid wire shapes, each keeping its assertion; recon's test-impact table gains the row. Stored-grant fixtures elsewhere never pass the validator and stay |
| 8 | driver | minor | Base drift on cited lines | Every file:line in rows 1-7 and the round-4 ledger re-read on `8f0d79c2`. Corrected: `setTrustedVerification` is `service.ts:247-251`; A-14's chain-name fallback is `index.vue:67-69,336` |

Round 6: codex **conditional approve, confidence high**, its one condition D-2's owner answer
(A-32's `contractClasses` exception confirmed met, no new material finding); fable **approve,
confidence high**. The owner answered D-2 on 2026-09-24 (§ Asks, D-2), which is that condition.

Round 7: codex **approve, confidence high** (session `01a0d4fb-bce0-7121-9f10-1f6013ae3a01`):
"D-2 condition met. … No new material findings or comment issues in the changed lines. The
existing P0 publication gate remains applicable."

## Approval

D-2 is answered: **(a)**, the owner in chat on 2026-09-24, "Yes. Defer to afterwards." The rule
it answered, kept for the record: approval required the owner's explicit answer to D-2, one of:

- **(a)**, recommended: the owner accepts the documented deferral, the follow-up in
  `implementations-plan/follow-ups.md`;
- **(b)**: the owner authorizes the limited sink fix, which then amends this plan with its phase
  and test before P1 and is re-audited. This plan does not plan that fix.

An unanswered ask, silence, or D-2 recorded as open in a PR body is not acceptance. The answer
is quoted here with its date. Approval is then recorded under the program's standing approval
only when also:

1. round 7 confirms this revision (done: codex approve, high; fable approved round 6);
2. P0's addendum is published, A-1's "Already granted" data cards, A-31's label and A-32
   included.

Until then no phase after P0 starts. P0 only draws the owner asks, and its notification carries
the D-2 ask too.

## Phases

Each phase ends with its gate. Its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/ux-feedback/b5-permissions/lessons/phase-N.md`. Test names below
are the cases, not a volume target.

### Arc 5a · `feat/ux-5a-authorization-confirm`

#### P0 · Round-5 addendum: the undrawn asks ✓

Spec § How to use it: a state with no shot stops for the owner. So before any phase builds one:

1. `design/mocks/gen_r5.py` gains the batch's undrawn asks in the round-5 style, each with this
   plan's recommendation drawn and marked Recommended, the alternatives named in its ask, and a
   picker in the `picks` store: A-1 (the interim window, one crop per changed card, and the
   "Already granted" data cards after a declined `data` widening), A-2, A-4,
   A-5 (both widenings), A-6, A-7, A-8, A-10, A-11's switching, A-12, A-13, A-14, A-15 (with the
   A-2 case), A-17, A-18, A-23, A-24, A-25, A-26, A-27, A-28, A-29, A-30 (with its mixed-state
   tables), A-31 (with the widening's accounts label), A-32 (the identical re-request with the
   badge on the new row only, the covered one as "no window", and the note that contract
   classes still reopen the window). A-23 and A-27 are drawn as
   annotated crops (the Tab path, the spoken name).
   Only this plan's quoted strings and the drawn CSS are used.
2. Rebuild (`python3 implementations-plan/ux-feedback/design/mocks/build.py`), render the shots
   (`node implementations-plan/ux-feedback/design/shots.mjs`), check the page (no console
   errors, no horizontal scroll at 1400px and 400px, every new picker renders), republish the
   artifact at its URL, and send the owner a PushNotification naming the new pickers and the
   D-2 ask (options (a) and (b), § Approval), unless D-2 is already answered (it is: (a)).
3. `design/spec.md` § Undrawn states gains one line per ask pointing at its drawing.
4. Record in `lessons/phase-0.md` the artifact publish result and which asks are drawn.

Gate: both commands exit 0, the publish result is in the transcript, and every ask above has a
drawing and a picker. Each later phase re-reads the picks for the asks it builds.

#### P1 · The consent and the grant boundary ✓

1. `session-types.ts`, `services-contract.ts`, `dapp-interaction-protocol.ts`: the optional
   fields.
2. `method-scope-checkers.ts`: the five predicates, re-exported by name from `index.ts`; the
   stale doc at `:215-224` rewritten.
   `method-scope-checkers.test.ts` tables: `isAnyContractScope` (`"*"`, a pattern with contract
   `"*"`, a listed pattern, malformed); `coversAnyContract` (utilities-only is narrow);
   `readConsent`; `authorizationsEffective` (absent, malformed, narrow, narrow then widened to
   any contract → ask, narrow then widened to more listed contracts → On, a listed pattern
   widened to every function → On, broad); `effectiveGrants` (replace, append, unknown types,
   a retained rejected type kept).
3. `dispatcher.ts`: the gate, the decision carriage, `heldGrants` and the consent in
   `CapabilityParams`, the validation and projection, the duplicate refusal, the
   `dataRequestCovered` fix, the `data` answer, the comments of § Comments.
   `dispatcher.test.ts`:
   - consent absent: a covered call intent opens the window;
   - effective consent + covered signs silently; + a call intent outside a held scope is refused
     with no window; + no transaction or simulation scope held, a call intent opens the window;
     + in-scope inner hash opens the window;
   - an in-flight silent signing, held open while Settings turns Off, completes; the next call
     intent opens the window (C-15);
   - a Settings write between dispatch entry and the window's answer changes neither the params
     the window received nor the decision's `broad` (C-20);
   - a rejected confirmation never signs;
   - a batch leg with the consent absent opens the window;
   - the result's `true` reaches the decision as `{ broad }` from the snapshot, `false` as
     `null`, anything else as nothing;
   - a request-side `authorizationsWithoutAsking` inside accounts stores nothing; the consent
     never appears in the answer;
   - the grant boundary cases of § Security ("Grants equal the window"), the missing-field,
     container and modulus cases included, and A-30's table rows through the decision;
   - `dataFieldsCovered`: each field covered, uncovered and absent, over one and several held
     records; `dataRequestCovered` equals both fields;
   - A-32: after a declined `data` widening, the identical request opens the window with `data`
     in `reRequested`; a request for exactly the held record opens no window, answers the held
     record and keeps the rejection; the same for a `contracts` subset of a held grant whose
     widening was declined; a declined membership-only accounts widening with accounts left to
     add still opens the picker with `accounts` in `reRequested`; a class-A `contractClasses`
     grant plus a `contractClasses` rejection (two windows, A approved then B declined), then a
     request for class B, opens the window with `contractClasses` in `reRequested` (the existing
     coverage test holds no rejection, so it cannot see this);
   - existing cases whose manifest or popup echo is a bare shape the validator now refuses
     (`{ type: "data" }`, `{ type: "contracts" }`, for example `dispatcher.test.ts:153,188,203,252,264,1528`)
     move to valid wire shapes, each keeping its assertion;
   - the fixture at `:1023-1041` carries an effective consent for the three covered tests
     (`:1094-1116`), names gaining "(On)".
4. `dapp-session/spec.ts`, `service.ts`, `client.ts`: the schema field, `applyCapabilityDecision`,
   `setAuthorizationsWithoutAsking`, the comment at `:283-299`. `service.test.ts`:
   - the consent round-trips; `null` deletes; `undefined` keeps;
   - deleted when the resulting grant lacks `canCreateAuthWit`;
   - a narrow On after a concurrent broad widening reads as ask, in both orders;
   - an explicit broad On survives an unrelated decision;
   - a delta-less consent with the accounts grant revoked meanwhile is refused;
   - a revoke through `setCapabilityGrants` deletes the consent; a later re-grant starts from
     ask;
   - the setter refuses On without the grant and a non-boolean; Off always succeeds; it emits
     `onDappSessionUpdated`; a Settings write and a decision in both orders leave the later one;
   - a tampered consent fails the MAC.
5. `dapp-interaction/service.test.ts`: close before approval, timeout, late approval, two
   concurrent windows (§ Security, "No silent fallback").

Gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.

#### P2 · The row table, the popup's grant, the interim window ✓

Re-read the `picks` store for `i6h` first.

1. `permission-rows.ts` + `permission-rows.test.ts`: every U4 row with group, default, icon,
   title, lines and flag rule, each pinned against its own `06-row-list-U4` cells (§ Rows);
   authorizations Off on any contract; A-2's always-asks row; data split into two rows; unknown
   Off (moved); a re-request starting from the snapshot's effective consent; A-5.
2. `build-items.ts`: `buildGrant` + table tests: no-switch rows as requested; `canCreateAuthWit`
   kept with the switch Off; `data` field by field against the held record, one case per row
   of A-30's two tables, and a first grant (nothing held) with both off rejected; the unknown
   switch all or none; the flag emitted only when the row was shown, and never on
   `accountsMembershipOnly` (A-31).
3. `index.vue` and `CapabilityCard.vue`: the A-1 interim, `data-cap-row`, the switch control,
   the rider removed, the comments of § Comments.
4. Component: `index.test.ts` renders from wire-shaped manifests (addresses `0x` + 64 hex below
   the modulus) and asserts literal expected `CapabilityResult` objects, written out in the test:
   - `transaction` shows authorizations Off with the broad line;
   - `transaction-listed`'s shape shows On;
   - the data cards and their halves;
   - a membership-only accounts widening: the authorizations card is today's existing card with
     no `cap-toggle`, and the result carries no `authorizationsWithoutAsking` (A-31);
   - a Settings change after dispatch: the window's defaults follow `params`, not
     `payload.session`;
   - a `data` re-request after a declined widening (A-32): the private-events card is new, Off
     and carries `cap-rerequested-badge`; the address-book card sits in "Already granted" with
     no badge; the result rejects `data`;
   - a transaction widening with an un-rejected `data` record held (so `existingGrants` lists
     it): "Already granted" holds exactly one address-book card and one private-events card,
     from `heldGrants` (A-1);
   - `CapabilityCard.test.ts`: the switch control's role, name, Enter and Space; no control on a
     switchless card. `chain-switch.test.ts` unchanged in 5a.

Gate: lint, `typecheck:all`, `test:all` exit 0.

#### P3 · U6 title, `PermissionRow`, U7 Settings row ✓

Re-read the `picks` store for `i6j`, `i6k` first.

1. `OperationCard.vue`: the "Authorization" title. `OperationCard.createAuthwit.test.ts` gains the
   title case with a wire-shaped call intent; its fixture's field values move below the modulus.
2. `components/composite/capabilities/PermissionRow.vue` + `PermissionRow.test.ts` (L3, at least
   10 cases): title and default sub; on/off sub swap; the `sub` slot; the chip only when given;
   the flagged icon class; no `switchLabel` → no switch and no Tab stop; the switch `aria-label`
   and its `aria-describedby` on `cap-row-sub`; `update:modelValue`; Space and Enter toggle; the
   focus-ring class (whether it wins the cascade is P9's computed-style check); no hover class;
   `data-cap-row` passthrough.
3. `[id].vue`: the group with `PermissionRow` and the dotted term, bound to the setter; absent
   without `canCreateAuthWit`; switchless with the off line when no transaction or simulation
   scope is held (A-15); shows the effective state after a widening; a failed write reverts with
   A-28's snackbar. A new `[id].test.ts` (the page had none) covers those five.
   `connected-app-row` on `connected-apps/index.vue`'s row target.

Gate: lint, `typecheck:all`, `test:all`, Storybook build (`PermissionRow.stories.ts`) exit 0.

#### P4 · e2e for the consent ✓

1. `apps/playground/src/lib/bundles.ts`: `transaction-listed`, accounts with `canCreateAuthWit`,
   the transaction pattern `{ contract: tokenAddress, function: "transfer_public_to_public" }`
   (the call-intent button's target, `sections/authwit.ts:85-93`), the same pattern as
   `simulation.transactions`, and
   `{ type: "contracts", contracts: [tokenAddress], canRegister: true, canGetMetadata: true }`,
   so its window has S2's rows, "Add contracts to your wallet" included (`gen_i6.py:222`), and
   Details reads "· 1 contract". Its `<option>` joins the select (`sections/connect.ts:14-28`)
   and `PgBundle` (`fixtures/playground.ts:43`).
   - `getTokenAddress()` reads `?tokenAddress=`, else the `tokenAddress` input
     (`getInput`, `state.ts:69`), else `"0x0"`. The manifest is built at the click
     (`sections/connect.ts:48-53`), so an input set before `requestCapabilities` reaches it; a
     scoped bundle with no address stays `"0x0"` and is now refused (C-19), which no existing
     spec relies on (fact 17).
2. Fixtures (`tests/e2e/fixtures/playground.ts`, `tests/e2e/fixtures/popups.ts`):
   - `requestPgBundle(page, bundle, { tokenAddress })`: selects the bundle, sets
     `pg-input-tokenAddress` with `setPgInput` (`playground.ts:56-58`) when given, clicks
     `requestCapabilities`. P4 and P9 pass `aztecConfig.tokenAddress` for `transaction-listed`;
   - `approveCapabilities({ switches: { [rowKey]: boolean } })`, selecting
     `[data-testid="cap-item"][data-cap-row=…] [data-testid="cap-toggle"]`;
   - `toggleOff` deleted: its only caller (`cap-request-partial.test.ts:35`) is rewritten below;
   - `setConnectedAppAuthorizations(page, host, on)` for Settings.
3. `tests/e2e/network/authwit-variants.test.ts` rewritten, results asserted exactly:
   - default On on `transaction-listed`: first, the `requestCapabilities` result is `ok` (the
     request was not refused before the window); then the call intent opens no window
     (`callExpectingNoPopup`), `ok`;
   - `transaction` (Off by default): the call intent opens the execute window, whose
     `execute-op-title` reads "Authorization"; reject → `error`; a second call, confirmed → `ok`;
   - On through the switch on `transaction` (broad On): no window, `ok`;
   - Settings Off, then the next call intent opens the window;
   - on `transaction` (scope `"*"`, which covers any consumer, as today's spec does,
     `authwit-variants.test.ts:29`), with the switch On, the inner hash still opens the window,
     confirmed → `ok`. Never on `transaction-listed`: its one pattern names a function, and the
     checker matches an inner hash's consumer as function `"*"`, so it is refused before any
     window (`method-scope-checkers.ts:317-323`, `:38-40`).
   - If `args: []` cannot sign, the playground's call-intent button gets valid arguments in this
     phase, logged in `lessons/phase-4.md`; a positive path never accepts `error`.
4. `cap-request-partial.test.ts`: request `data-scopedEvents` through `requestPgBundle` with
   `aztecConfig.tokenAddress` (both data rows start On: address book On, private events on a
   listed contract On), switch the private-events row Off, and assert the answer is `ok` and
   that the stored `data` grant and the answer's `data` entry are `addressBook: true` with no
   `privateEvents`. Today's `basic` bundle has no `data` (`bundles.ts:52-56`), and `data` starts
   its private-events row Off, so neither can prove the switch.
5. `data-privateEvents.test.ts`: first run it on the arc's base and log the status the stub
   event metadata reaches (its header says `ok` needs real `Transfer` metadata and a transfer,
   `:14-20`). Then approve with the private-events switch On: if the base reached `ok`, assert
   `ok`. Otherwise assert, in order: the stored `data` grant and the `requestCapabilities`
   answer carry `privateEvents: { contracts: "*" }`; the call's result is the exact status and
   error text the base run logged (never "any non-scope error": a dropped grant fails with
   `CapabilityNotGrantedError`, `dispatcher.ts:1364-1375`); and the control that the same call after
   connecting with the switch Off is refused as a scope violation
   (`method-scope-checkers.ts:205-212`). Logged in `lessons/phase-4.md`.

Gate: lint, and those three files on Chrome (prover on) and on Firefox (proverless), retry-0,
exit 0.

#### P5 · Parity and arc 5a gate ✓

1. Parity: rebuild the mocks. Capture at 400×800, the viewport set explicitly:
   - the interim window for `transaction` and `data` (no shot: compared with the U4 list's and
     `06-auth-row-B`'s words);
   - the confirmation window for a call intent (`06-auth-window-U6`);
   - Settings → Connected apps → app at 360×600 (`06-settings-U7`).
   - Publish one private Artifact placing each capture beside its shot. The driver and the fable
     leg list every difference.
2. Every row of the program's [Local gates](../plan.md#local-gates): lint, `typecheck:all`,
   `test:all`, `test:ci-gating`, `build`, Storybook; full smoke on Chrome and on Firefox.
3. The whole network suite, `NULO_E2E_RETRY=0`, in each browser's gate mode (program § Local
   gates): Chrome prover on, with the `@requires-proverless` files run separately under
   `NULO_E2E_PROVERLESS=1`; Firefox proverless. It includes `authwit-variants` and every spec
   that connects through the changed window.
4. The execution canaries prover on, on Chrome locally:
   `tests/e2e/network/frozen-account-canary.test.ts tests/e2e/network/passkey-execution-canary.test.ts`.
   Firefox's canaries cannot run locally (program § Local gates); their row stays open until
   CI's `Firefox / Run / canary / real-proving` job on the PR's exact head shows the
   substantive tests passed, retry 0, Presto enforced and native proofs in the server log.
   That evidence comes after the PRs open (Delivery) and never blocks opening them.
5. Flake bar: `authwit-variants`, `cap-request-partial` and `data-privateEvents`, three
   consecutive retry-0 runs each, per browser, in its gate mode.
6. `bun run e2e:reap`.

Gate: items 1–3, 5 and 6 and Chrome's canaries exit 0, the parity Artifact URL printed, and
the Firefox canary row recorded as open in `lessons/phase-5.md`.

### Arc boundary 5a → 5b

1. The codex fix loop (below) on `feat/ux-4-snackbar-rows-arrivals...HEAD`, until a round has
   nothing material, three rounds at most.
2. Parity re-captured if the loop changed a surface.
3. `gh stack push`, then `gh stack add feat/ux-5b-permission-window`.

### Arc 5b · `feat/ux-5b-permission-window`

#### P6 · Groups, flags, known contracts ✓

Re-read the `picks` store for `i6e`–`i6i` first.

1. `permission-rows.ts`: the 5b fields (the chip on the three "any contract" rows, A-6, A-10,
   A-11, A-16, A-17, A-24, A-25, A-29); tests extended per row key.
2. `known-contracts.ts` + test (the sources); `CapabilityParams.knownContracts` filled in
   `dapp-interaction/service.ts`, and the exclusions of § Security ("Names that lie") tested
   there, through the payload.
3. `index.vue`: the groups over `PermissionRow`, identity action, footer label, banner sentence,
   S2 note, "Account(s) to share". `CapabilityCard` and its test deleted, `PermissionRow.test.ts`
   named as the replacement. `index.test.ts` and `chain-switch.test.ts` get the new strings and
   stubs. Component renders from wire-shaped requests: S1-shaped (scoped, mixed known/unknown),
   S2 (nothing known), S3 (every broad flag), each asserting the rows and strings of its shot.

Gate: lint, `typecheck:all`, `test:all` exit 0.

#### P7 · Details table and the U1 fold ✓

1. `details-table.ts` + table tests: column membership per A-9 over
   `effectiveGrants(params.heldGrants, delta)`; one entry per contract; known first; "Any
   contract" with listed rows kept (A-7); "Any function" (A-8); the label and counts (A-10); a
   U1 address-book-only re-request still listing the held contracts; a retained rejected type's
   contracts still listed (A-30).
2. `DetailsTable.vue` + test (L3, at least 10 cases): the disclosure's `aria-expanded`; the
   label with its count; rows open with Enter and Space; the A-27 names; the known and unknown
   sub-headers; the check and dash marks; copy emits the sanitized full address, does not toggle
   its row and is not a Tab stop; bidi and control characters in a function name and an address
   are stripped; the footnote text. (Reduced motion is a media query jsdom never applies; P9
   proves it on Chrome.)
3. U1: the "Already allowed · N" fold (read-only rows from `params.heldGrants`, A-12), "Allow",
   "Allow as is". Component renders from a re-request with a stored session, one for A-5
   (narrow consent, broad re-request), one for A-30 (a declined data widening: the held
   address-book row folded, the new private-events row Off, the result rejecting `data`), one
   for A-32 (the same request again after that rejection: `cap-rerequested-badge` on the new
   private-events row, none on the folded address-book row), and one for A-31 (a membership-only accounts widening: the authorizations row folded with its
   stored line, no `authorizationsWithoutAsking` in the result).
4. `DetailsTable.stories.ts`: the S1 table from `gen_i6.py:12-26`'s rows, the parity source for
   S1's exact data.

Gate: lint, `typecheck:all`, `test:all`, Storybook build exit 0.

#### P8 · Accounts, rename, the Alias ⓘ ☐

1. `DottedTerm.vue`: the `action` variant. `DottedTerm.test.ts` cases: renders a `button`; emits
   `click`; keeps `aria-describedby`; a hit area of at least 24px (class assertion; the size is a
   browser check in P9); inside the real `Tooltip`, an Enter and a Space keydown on it are not
   `defaultPrevented` (jsdom cannot synthesize the click; P9 proves activation); the span
   variant unchanged.
2. `AccountSelectRow.vue`: the Alias label and ⓘ go; the `RowTarget` selection target with
   `aria-pressed`, the rename link and field as its siblings (§ Accounts); "Rename for this
   app" at the end of the address line swaps in the prefilled, focused field labelled "Name for
   this app"; the link's click never toggles the row; locked rows show no link.
   `AccountSelectRow.test.ts` is rewritten: selection through the target (click, Enter, Space,
   `aria-pressed`), no interactive descendant of another control, the link pressed before the
   field appears, a click on the link leaving the selection unchanged, and a locked or disabled
   row's target at `tabindex="-1"` with `aria-disabled="true"`.
3. The tooltip count: the Alias `<Tooltip>` goes (−1 source tag); `DottedTerm` renders at three
   sites, the window's "authorization(s)", the rename link, and the Settings row's term (P3).
   Recount every rendered tooltip against batch 3's 35 and the spec's 36, recorded in
   `lessons/phase-8.md`; a mismatch goes to the owner, nothing is removed or added to fix it.
   The glossary scan passes with keys `authorization` and `name-for-this-app`.

Gate: lint, `typecheck:all`, `test:all` exit 0.

#### P9 · e2e for the window ☐

1. Fixtures: `approveCapabilities({ aliases })` presses `cap-account-rename-btn` before typing.
   `getCapItems` reads `data-cap-row`, and still reads `cap-rerequested-badge`.
2. `cap-request-basic`, `cap-request-rerequest`, `cap-request-accounts`, `cap-widening`: updated
   where they read cards. `cap-widening` stays the accounts-membership flow.
3. New `tests/e2e/network/cap-window.test.ts` on `dappConnectedExtensionPerTest`
   (`fixtures/extension.ts:661-669`), one connect per flow, so no flow's grant turns another's
   first request into a re-request. Testids only, `page.setViewport({ width: 400, height: 800 })`
   first (Chrome's e2e window is 800×600 otherwise). Each flow requests through
   `requestPgBundle` with `aztecConfig.tokenAddress`:
   - **Keyboard and Details**: Tab from the window's start reaches, in order, the account's
     selection target, the rename link, each dotted term and switch in row order, then the
     Details disclosure. A switch reached by Tab has a computed `outline-style` of `solid`
     (A-19; the cascade, not a class). `cap-account-rename-btn`'s rect is at least 24px tall
     and wide. Enter on the rename link shows `cap-account-alias-input`; so does Space on a
     fresh window. Enter opens Details; Tab reaches its first row; Enter opens it and shows
     `cap-details-fns`. `cap-details-copy` is skipped by Tab, and a click on it copies without
     toggling the row; its rect is at least 24×24.
   - **Reduced motion, Chrome only**: its own `test.skipIf(isFirefox)` case, with a one-line
     reason above it as `sw-resilience.test.ts:64-65` has ("Chrome's alone: Firefox's BiDi
     session cannot emulate media features"). Without emulation the Details chevron's computed
     `transition-duration` is `0.2s` (the failing counterfactual); after
     `page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }])` it is
     `0s`. Firefox cannot run it: `BrowserDriver` has no media-feature method
     (`fixtures/browser/index.ts:48-140`), and Puppeteer 25.8.0's BiDi page routes
     `emulateMediaFeatures` through a CDP session that Firefox lacks, which throws
     `UnsupportedOperation`. The rule is one CSS media query both browsers read, and batch 4
     draws the same line for its arrival animation. A driver method that flips Firefox's
     `ui.prefersReducedMotion` pref through `chromeScript` (`firefox.ts:651-666`'s pattern) is
     rejected: no run has shown a live pref change re-evaluating the query in an open page, and
     it adds driver surface for one assertion.
   - **Fits and the inline term**: the `requestCapabilities` call is not refused (the window
     opens); with `transaction-listed` the window first asserts it renders
     exactly S2's rows (`data-cap-row` keys `account-address`, `simulation`, `contracts`,
     `authorizations`, `transaction`, and the `cap-unknown-contracts-note`, `gen_i6.py:218-228`);
     S1 differs only by having no note, so S2's fit bounds S1's. The scroll container then does
     not scroll (`scrollHeight <= clientHeight`) with Details closed. The dotted `cap-auth-term`
     lies inside its line: its client rects sit within `cap-row-sub`'s and its baseline is within
     1px of the adjacent text's (batch 3's owed in-sentence measurement).
   - **Widening (A-5)**: connect `transaction-listed` with the default On, its answer `ok`;
     re-request with `transaction` scope `"*"`; the authorizations row shows among the new rows,
     Off and flagged; Allow; the next call intent opens the window.

Gate: lint, and the changed and new files on Chrome (prover on) and on Firefox (proverless),
retry-0, exit 0; on Firefox the reduced-motion case reports skipped by its name, and nothing
else skips.

#### P10 · Parity and arc 5b gate ☐

1. Parity: rebuild the mocks. Capture at 400×800, the viewport set explicitly, from the real
   window over the playground:
   - S2-like and S1-like (`transaction-listed`), S3 (`full`);
   - Details open with a row expanded;
   - U1 (re-request);
   - U2 (two accounts);
   - U3 (chain mismatch);
   - U4 (`data`, `contractClasses`);
   - U5 (rename pressed);
   - the Alias area in the `tips-map` view.
   - S1's exact data (the drawing's sample, `gen_i6.py:12-26`) comes from
     `DetailsTable.stories.ts`, recorded as an exception: the extension e2e drives only the
     playground, and the tools app has left this repo (#691).
   - Publish one private Artifact placing each capture beside its shot. The driver and the fable
     leg list every difference, including the playground's contract set against the drawing's
     sample.
2. Every Local gates row, as in P5.
3. The whole network suite, retry-0, in each browser's gate mode as in P5, including
   `authwit-variants`.
4. The execution canaries prover on, on Chrome locally; Firefox's row stays open for CI's
   canary job on the stack top's exact head, as in P5.
5. Flake bar: `cap-window` and every e2e file changed in P9, three consecutive retry-0 runs each,
   per browser, in its gate mode.
6. `bun run e2e:reap`.

Gate: items 1–3, 5 and 6 and Chrome's canaries exit 0, the parity Artifact URL printed, and
the Firefox canary row recorded as open in `lessons/phase-10.md`.

### Arc boundary 5b (stack top)

1. The codex fix loop on `feat/ux-5a-authorization-confirm...HEAD`, three rounds at most.
2. Parity re-captured if the loop changed a surface.
3. `gh stack push`. 5b is the top of the stack; nothing is added above it.

## Post-implementation (read by the implementing session)

The review loop is `/codex high` (GPT-6 Astra) on each arc's diff, resumed until a round reports
nothing material, three rounds at most. `/code-review` is off. Every codex prompt, initial and
resumed, carries:

- *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
  extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
  problem. If code works and is clear, leave it alone."*
- *"Audit the comments for value per character. Flag any comment that narrates what the code
  visibly does, restates its line, references implementation plans / phases / reviews, or spends
  a paragraph where a sentence works — and flag places where a non-obvious invariant or
  constraint deserves a comment it doesn't have. Comments are permanent context every future
  reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
- The arc map: "arc 5a is arc 5 of 6 (arcs 1-4 below: first run and wording, window placement,
  tooltips and glossary, snackbar rows and arrivals; arc 6, the redesigned permission window,
  builds on it); arc 5b is arc 6 of 6, the stack top — so seams reserved for later arcs are not
  flagged as dead code".
- The adversarial ask: "attack the authorization path: find any way an authorization is signed
  without a window while the consent is absent, or narrow while the grants reach any contract,
  from any tab or grant writer; any way a dApp can set the consent, smuggle a field or a
  malformed value into a stored grant; any grant record built outside `collectNewGrants` and
  `ensureAccountsGrant`'s projection; any window state read from the re-read session instead of
  the dispatch snapshot; and any UI that differs from the spec or the P0 addendum or invents a
  state neither draws".

Each finding is fixed in its own commit or rejected with a reason in that arc's last
`lessons/phase-N.md`. Codex is advisory: it cannot override the spec, the owner's picks, CLAUDE.md
or this scope. A UI finding goes to the owner as an ask, never decided by codex.

## Delivery

- Arcs 5 and 6 of 6: `feat/ux-5a-authorization-confirm` on `feat/ux-4-snackbar-rows-arrivals`, and
  `feat/ux-5b-permission-window` on 5a.
- Commits are conventional, lower-case and signed: at least one per phase, fixes separate.
- `gh stack push` as checkpoints. No PR until the program's final pass (program Delivery). Never
  merge: `gh pr merge` and `gh stack merge` are always the owner's call.
- PR bodies (at submit): summary, the UI impact table, the visible consequences of technical
  choices, the owner's quotes (i6 both rounds, i9c, tips, and round 5's "Regarding 6:
  Recommended." of 2026-09-25, which signs off A-1 to A-32 and U1–U7 as drawn), the
  **sign-off pending** list below, the owner's D-2 answer quoted (§ Approval; there is no
  "open" status to report), the parity Artifact link, screenshots of every changed popup
  surface, test evidence.
  - **Signed off after the plan:** two or more unknown types in one request share one "Unknown
    permission" card with one switch, in the singular words of `06-interim-unknown-A1` (codex
    round 1, finding 5). Owner, 2026-09-25: "for branch 5a: (a)".
  - **Sign-off pending**, as no drawing defines it (each built as the plan recommends):
    - A-2 in 5a: the authorizations card among the new cards, with no switch and the line "You
      confirm each authorization first." A-2 draws only 5b's row;
    - A-5 in 5a: on a widening to any contract, the authorizations card first among the new
      cards, Off, with the broad off line. A-5 draws only 5b's rows;
    - the data cards' detail panels, opened: each lists its card's part of today's one "Private
      data" panel, "Read address book" or "Read private events from" and the contracts, and both
      list "Register senders". The A-1 drawing leaves them closed;
    - the 5a switches' keyboard focus: the browser's default 1px outline around the switch's hit
      area, which is as tall as the card's head. A-19 draws its ring only on 5b's rows and the
      Settings row;
    - two word checks from the parity page. 5a's "Already granted" leaves out two held grants,
      kept as they are since arc 5b's fold shows both: the private-events grant held after a
      data widening (as `06-interim-held-A1` draws it) and a type's held grant after a declined
      widening (today's rule). Private events from any contract, switched On, reads U4's "Same
      lines", "Private messages its contracts sent to your accounts, like a transfer you
      received.", kept. The page asks the owner to sign the four undrawn states above off
      together.
    - a held account the wallet no longer names: U2's sentence (codex high on the held accounts,
      lessons/phase-6.md). One member with no wallet name, or two members of which the wallet
      names one, read "See the addresses of the accounts you share";
    - the address-book and unknown rows' flag (A-6) is read over the grants the app would hold
      after Allow, so an app that already holds an any-contract scope has its later address-book
      or unknown request flagged, although that request lists no contract;
    - the S2 note beside an "Any contract" row: the note shows whenever Nulo knows none of the
      listed contracts and at least one is listed, so a request with one unknown listed contract
      and a scope on any contract shows it. No drawing has the note and the any-contract row
      together;
    - the 5b switches stay operable while the footer shows an error or a submit runs. 5a disabled
      its ticks then; a disabled `Toggle` draws a lock no drawing has (A-12), and the footer's
      button already holds the decision.
    - Details with no contract: no fold. The window shows no 'Details' when the grants it would
      hold reach no contract (an accounts-only connect, U4's data plus contractClasses, data
      alone). A-10's count rule defines the words, not a zero row.
    - an app whose session holds no row reads as a first connect: "wants to connect on X",
      "Connect", and no "Already allowed" fold. U1 draws an app that holds five;
    - the S2 note on a re-request sits after the "Already allowed" fold, before Details. No
      drawing has the note and the fold together;
    - the keyboard focus of the Details and "Already allowed" buttons: batch 4's row ring, 2px
      `--nulo-accent` inside the edge, with the hover's colours. The drawings give them none.
- The Firefox canary evidence (P5, P10) is read from CI's `Firefox / Run / canary /
  real-proving` job on each PR's exact head after the PRs open, and repeated on the stack top;
  the row stays open until it exists, and CI success is never reported as a local pass.
- D-2 was answered (a). Its follow-up is in the program plan's § Follow-ups, since this repo
  has no `implementations-plan/follow-ups.md` yet; the program's close moves it there.

## Seeds

The program's `/goal` drives this batch. To resume this batch alone:

```
/goal Deliver implementations-plan/ux-feedback/b5-permissions/plan.md once its § Approval is recorded (D-2 answered by the owner). Done when the transcript shows every phase ✓ with its gate reported passing and LESSONS_FILE printed per phase, a quoted codex re-review with no new material findings for each arc, both parity Artifact URLs, and gh stack view with feat/ux-5b-permission-window on top above feat/ux-5a-authorization-confirm. Never merge; UI questions the spec does not answer go to the owner.
```

```
/loop 15m Drive implementations-plan/ux-feedback/b5-permissions/plan.md forward: read it and its lessons, git status, gh stack view; take the next unchecked step; run its gate; commit; on a decision use the spec, else /codex high for technical asks; UI asks go to the owner; hard limits stay hard.
```
