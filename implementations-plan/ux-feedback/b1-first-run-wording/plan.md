---
plan: ux-feedback/b1-first-run-wording
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: artifact
eli5: https://claude.ai/artifact/LNTBQxGqZbXYhUAyELdxjY (source: eli5.html)
program: implementations-plan/ux-feedback/plan.md (batch 1, arc 1 of 6)
arc_branch: feat/ux-1-first-run-wording
design: implementations-plan/ux-feedback/design/spec.md (items 1, 3, 5, 7, 8; round-5 U11, U12, U13)
artifact: https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF
---

# Batch 1 · First run and wording

Items 1, 3, 5, 7 and 8 of the UX program, plus the round-5 states U11, U12 and U13. Arc 1 of the
program's six-PR stack; later arcs build window placement (2), tooltips and the glossary (3),
the snackbar, rows and arrivals (4) and the permission window (5a, 5b) on top of it.

**The design is the artifact**, <https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF>, quoted by
[`../design/spec.md`](../design/spec.md). Every surface below names its shot
(`design/shots.mjs` renders them); a build that does not look like its shot is wrong, whatever
an audit says. Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the program)

Recorded from `implementations-plan/ux-feedback/plan.md` § "Phase 0, answered for every batch";
no clarifying questions were asked.

- **Success**: items 1, 3, 5, 7, 8 built exactly as `design/spec.md` says; U11, U12, U13 built as
  the owner picks on round 5, or as drawn and listed **sign-off pending** until then; parity
  evidence published; every gate below green on Chrome and Firefox.
- **Who and what excellent looks like**: the program's Outcome & Quality Bar, plus this batch's
  line (below).
- **Scope**: this batch's items only. Out: every other item, follow-up 4B, rejected options,
  `apps/tools/**`, `packages/bridge-core/**`, the `@aztec/*` line.
- **Constraints**: pre-production, so no storage migrations (CLAUDE.md); Bun 1.4.2; the account
  freeze untouched; complexity budgets hold with no new acceptance.
- **Quality bar**: production.
- **Validation layers**: typecheck and lint, unit, component, smoke e2e on Chrome and Firefox;
  network e2e on both browsers for the specs this batch edits or whose fixtures it changes;
  Storybook build (a story reaches `PublishStrip`).
- **Surface vs delegate**: UI decisions come from the spec and round 5 (owner); technical
  decisions go to `/codex high` and are logged in `lessons/`.
- **`/code-review`**: off. **`/harden`**: not scheduled.

## Outcome & Quality Bar

For whom: a first-time user in the onboarding tab who has never met the word "profile", and
anyone reading the fee card on a 360px popup or the 400px dApp window.

Excellent means:

1. **First run asks only how to unlock.** No name field on the first profile anywhere it can be
   created (onboarding create, onboarding import, the popup's new-profile and import pages); the
   profile is "Main" (or a full backup's own name); focus lands on the password field.
2. **The fee reads the same in every state and says what you pay.** "Fee", "Sponsored", "Public
   Fee Juice", "You pay", always one line, the struck-through amount when sponsored, and a screen
   reader hears the spoken sentence instead of a strikethrough it cannot see.
3. **It looks like the shots.** Each changed surface matches its shot at 1× (component order,
   icon, words, case), proven by string tests and a side-by-side parity artifact.

Good enough: surfaces the spec does not list stay as they are, including the tx detail and
receipt fee rows, the popup pages' heroes and CTAs, and the fee card's "Available" and priority
rows (apart from the unit).

## Round-5 picks

Read from the artifact's `picks` store on 2026-09-24: no round-5 pick yet (`i5b`, `i8b`, `i8c`
absent). U11, U12 and U13A are built as drawn and listed **sign-off pending**; so are U14, U15
and U16, drawn before P1 (below). A later pick replaces the drawn option on this arc, even after
the PR opens. The picks are re-read before P2 and before P5.

## UI impact

Every user-visible change in this batch. "Sign-off" is the owner's pick quoted in the program's
[sign-off record](../plan.md#owner-sign-off-record); a codex verdict is never one.

| # | Surface | Before → after | Shot | Sign-off |
|---|---|---|---|---|
| 1 | Onboarding create (`onboarding/pages/create.vue`) | hero "Create / Profile" → "Create / Wallet"; "Profile name" field → none on a first profile; "Authentication method" → "How you'll unlock Nulo" (label and tablist name); CTA "Create profile" → "Create wallet" ("Create with passkey" unchanged); focus starts on the password field | `05-onboarding` | i5 A |
| 2 | Onboarding import (`onboarding/pages/import.vue`) | hero "Import / Profile" → "Import / Wallet"; name field → none on a first profile; the profile is "Main" or the backup's own name | `05-import-U11` | **sign-off pending** (U11) |
| 3 | Popup new profile and import (`popup/pages/profile/new.vue`, `popup/pages/import.vue`) | a first profile: no name field, "Main"; a later profile: the field shows, prefilled "Profile N" (N = profiles + 1); heroes and CTAs unchanged | spec item 5 rule (no shot) | i5 A |
| 4 | Account names (every network's first account; New Account popup) | "Account" → "Account 1" (initials "A1"); New Account continues "Account 2" | `01-account-names` | i1 A |
| 5 | Fee card and menu (popup send, dApp execute window) | "Fee Source" → "Fee"; "Sponsored Fee Juice" → "Sponsored"; "Fee Juice" → "Public Fee Juice"; "Estimated Network Fee" → "You pay" with the V4 line and its spoken text; the menu's right column shows the spend ("1.2 FJ", "free") instead of "public"/"private"/"sponsored"; the locked row "Fee Juice · set by the app" → "Public Fee Juice · set by the app"; "Available … Fee Juice" → "… FJ" | `03-fee-matrix` (V4 column), `03-fee-round1` (card and menu) | i3 V4 |
| 6 | Home gas card (`GasBalanceCard.vue`) | "Public Juice" → "Public Fee Juice" | `07-lock-chip` (the card under the header) | i3 V4 |
| 7 | Header lock (`components/Header.vue`) | icon-only padlock → bordered chip: padlock + "Lock", matching the network chip | `07-lock-chip` | i7 A1 |
| 8 | Send strip (`PublishStrip.vue`) | squares → padlock (hidden) and globe (public, fee payer) | `08-privacy-strip` | i8 B |
| 9 | Review sheet rows, fee "names your address" tag | squares → the same padlock and globe | `08-review-U12` | **sign-off pending** (U12) |
| 10 | Strip and review sheet when the payer is unknown | faint square → no mark; the review row keeps the mark's space | `08-unknown-U13` (U13A) | **sign-off pending** (U13) |
| 11 | Wherever the seeded sponsor's name shows (fee menu, Settings → fee contracts) | "Sponsored Fee Juice" → "Sponsored" on fresh installs | spec item 3 surfaces | i3 V4 |
| 12 | Fee menu with an unknown balance | not known yet "— FJ"; one balance unreadable "couldn't check balance" on either row | `03-menu-unknown-U14` | **sign-off pending** (U14) |
| 13 | Screen-reader sentence under a tenth of a cent | "…covers less than $0.001." | `03-spoken-U15` | **sign-off pending** (U15) |
| 14 | A fee contract added by hand | menu "—" (not "free"); "You pay" "—" (not "Nothing") | `03-handadded-U16` | **sign-off pending** (U16) |

Three states the shots do not draw went to the owner as round-5 additions before P1
(the plan audit's findings 10 and 6), drawn with a picker each; the build uses the recommended
option and lists it **sign-off pending**, per the program's round-5 rule:

| # | Surface | State | Recommended |
|---|---|---|---|
| U14 | Fee menu, right column | A balance not known yet (loading, or retrying after the whole read failed), or a read that came back without one balance | Not known yet: "— FJ", the dash the card's "Available" row already uses; the rows stay selectable, as today, while the card shows its retry notice. One balance unreadable: that row disabled with "couldn't check balance", public and private alike (today private says "no balance" there, which is false) |
| U15 | "You pay", spoken text | The sponsored fee prices below a tenth of a cent (`<$0.001`) | "You pay nothing. The sponsor covers less than $0.001." |
| U16 | Fee menu and "You pay" | The sponsor is a fee contract added by hand (plan audit, round 3) | "free" and "Nothing" only for Nulo's own sponsor (`isProtocol`); a hand-added one shows "—" in the menu and on the line, spoken "Nulo can't tell what this fee contract charges you." |

"You pay" while estimating and before simulation is not a new state: the spec renames the label
everywhere and changes only the estimated line, so the skeleton and the "Fee estimated after
simulation" hint stay as they are under the new label.

`03-fee-round1` still draws the round-1 sponsored line ("Nothing · the sponsor covers…", green);
V4 replaces that line, and "Nothing" is not green (owner note on i3). The card and menu around it
are what that shot decides.

## Architecture & Implementation

### Item 1 · Account names

- `DEFAULT_ACCOUNT_NAME` (`wallet/services/account/spec.ts:6`) becomes `"Account 1"`. Its three
  callers (`account/service.ts` `provisionDefaultAccount`, `composables/useProfileBootstrap.ts`,
  `popup/network-switch.ts`) pass it bare, so every network's first account is "Account 1".
- The New Account popup's loop (`NewAccountPopup.vue:101-109`, smallest free `Account ${n}`)
  moves unchanged into a pure `nextAccountName(names: readonly string[]): string` in
  `src/utils/account-name.ts`, with a test that pins `nextAccountName([]) === DEFAULT_ACCOUNT_NAME`
  so the two cannot drift. The popup calls it with `appStore.accounts`' names.
- `getInitials` (`utils/string.ts:21`) already yields "A1"; nothing else changes.

### Item 5 + U11 · First run without a name field

- **Naming rule, one pure module** `src/utils/profile-name.ts`:
  - `normalizeProfileName(name)`: NFKC + locale lower-case, moved out of `useProfileNameField`'s
    private `isDuplicate` so the validator and the default share one comparison.
  - `defaultProfileName(existing: readonly string[]): string`: `"Main"` when `existing` is empty;
    otherwise `Profile ${n}` from n = `existing.length + 1`, bumped while it collides under
    `normalizeProfileName`. Always 1–32 characters and unique, so it always passes validation.
- **The flows own the decision.** A small C1 composable `useProfileNameDefault` (in
  `src/composables/`, used by `useProfileCreateFlow` and `useProfileImportFlow`) receives the
  name field and a `listNames: () => Promise<string[]>` getter from the flow (the flow keeps
  calling `managers.profile`; the composable connects nothing and owns no lifecycle hook). It
  reads once at setup and exposes `nameFieldState: Ref<"pending" | "hidden" | "shown">`:
  - no profiles → `hidden`; profiles → `shown`; a failed read → `shown` with an empty field
    (today's behaviour, never a guessed name). It always leaves `pending`.
  - **Automatic vs typed.** One tracked `lastAuto` value covers every automatic writer (the
    default and a backup's name). The field is "untouched" while its value equals `lastAuto`;
    anything else is the user's and is never overwritten.
  - **The submitted name is resolved at submit, inside the flow's latch, from a fresh read**:
    `resolveName(freshNames, backupCandidate?)` = the typed name (validated exactly as today), else
    the current backup's usable name, else `defaultProfileName(freshNames)`. So a profile added or
    deleted elsewhere since mount turns an untouched "Profile 2" into "Profile 3" or "Main", and a
    submit while still `pending` is correct. The resolved string is computed once and reused by the
    duplicate-confirm retry. A late setup read never writes after submission started (fenced).
  - The page does not re-classify live (no subscription to profile events): the field never
    appears or vanishes under the user's cursor; the submit-time resolution carries correctness.
- **The create flow's read moves inside its error handling** (`useProfileCreateFlow.ts:79` sets
  the latch and awaits `getProfiles()` outside the `try`, so a rejected read, such as a service
  worker restart, strands "Creating…"). A failed read releases the latch and uses the existing
  failure notification.
- **Full backups resolve the same way.** `useFullBackupImport`'s restore step stops reading the
  raw `profileName` ref; it asks the flow's resolver for the name inside its latch, after the
  backup is validated and before `restore`, with the candidate taken from the CURRENT selection.
  `sanitizedBackupName` trims its result and treats an empty one as no name, so a name of spaces
  around a control character can no longer fall through to the raw embedded string. Every
  selection and decrypt recomputes the candidate (a nameless replacement clears the previous
  backup's name); the prefill watcher writes it into an untouched field.
- Automatic defaults are unique under `normalizeProfileName`; a backup's own name keeps today's
  handling, the service's exact-string suffix in `restore` (a name that differs from an existing
  one only by case or NFKC form is restored as is, as today).
- **Pages** (the four named in recon): render the name field `v-if="nameFieldState === 'shown'"`
  and stamp `:data-name-field="nameFieldState"` on the page root, which gains a testid
  (`onboarding-create-page`, `onboarding-import-page`, `register-page`, `import-page`) through the
  root component's attribute fallthrough, as `data-restore-stage` already rides `OnboardingPage`.
  e2e reads the state from that testid; nothing selects by the bare attribute.
- **Onboarding create strings** as in UI impact row 1; the tablist's `aria-label` follows the
  visible label. Initial focus: the password input's existing `autofocus` prop (`Input` focuses
  in `onMounted`). The roving-tablist comment ("name → method → password") loses the name.
- **Onboarding import**: hero "Import" / "Wallet"; everything else on the page stays.
- Popup `new.vue` / `import.vue`: only the field's visibility and prefill change.

### Item 3 · Fee wording (V4)

- `FeeMethodSelector.vue`: label "Fee"; the menu's right column prints
  `method.disabled && method.disabledReason ? method.disabledReason : method.spend`.
- `fee-helpers.ts`: `FeeMethodOption` gains `spend?: string` (display only). `buildFeeMethods`
  fills it: public → `${formatGasBalance(publicFeeJuice)} FJ`, private →
  `${formatGasBalance(privateFeeJuice)} FJ`, Nulo's own sponsor (`fpc.isProtocol === true`) →
  `"free"`, a sponsor added by hand → `"—"` (U16); balances not known yet
  (`gasBalances` undefined: loading, or a whole read that failed and is being retried, which the
  card already reports with its degraded notice and deliberately leaves ungated) → `"— FJ"`
  (null and undefined are guarded before `formatGasBalance`, which would print them as zero).
  `privateFeeJuiceOption` stops grouping an unreadable leg (`null`) with a confirmed `"0"`: that
  leg disables the row with "couldn't check balance", as the public row already does (U14); a
  confirmed zero keeps "no balance"; a missing PrivateFPC keeps "not available". Gating is
  otherwise unchanged.
  `subtitle` stays the testid and `data-fee-method` key and is no longer shown. Titles:
  `"Public Fee Juice"`; the unnamed-sponsor fallback `"Sponsored"` (also in
  `fee-privacy.ts:105`); the private fallback stays "Private Fee Juice".
- `wallet/services/fpc/service.ts`: `SPONSORED_FPC_DEFAULT_NAME = "Sponsored"`. Rows already
  seeded keep their stored name (pre-production: devs reinstall; no migration, no display-time
  rename).
- `FeeCostReadout.vue`: label "You pay" in every state; new prop
  `payer: "self" | "sponsor" | "unvouched"` (default `"self"`).
  - estimated, self: unchanged markup (`~{amount} FJ` + `({usd})`, testid `fee-estimate-usd`
    kept).
  - estimated, unvouched (a sponsor added by hand, U16): `—`, with the visible dash
    `aria-hidden` and the spoken "Nulo can't tell what this fee contract charges you."
  - estimated, sponsored: `Nothing` (mono 12px, weight 600, primary) then, in the 10px secondary
    small, struck through: `~{amount} FJ` plus ` ({usd})` when priced, the USD part keeping its
    `fee-estimate-usd` testid. The visual part is `aria-hidden`; a visually hidden sibling carries
    "You pay nothing. The sponsor covers about {usd}.", unpriced "…about {amount} FJ.", and
    below a tenth of a cent "…covers less than $0.001." (U15). One line at 360px (asserted in the
    parity pass).
  - estimating and idle: today's markup under the new label.
  - The visually hidden class is local to the readout's CSS module (the first user; a second one
    extracts it to `@nulo/design`).
- `FeeSettingsCard.vue` passes `payer`: `"sponsor"` when the effective method is an `fpc` row
  whose `fpc.isProtocol === true`, `"unvouched"` for any other `fpc` row (only
  `DefaultSponsoredFpc` rows become `fpc` options, `fee-helpers.ts:168`), else `"self"`; the
  locked row reads "Public Fee Juice · set by the app" (the lock is only ever `fj`,
  `OperationCard.vue:100`). `FeeMethodOption.fpc` gains `isProtocol?: boolean` in its type (the
  row already carries it at runtime).
  Why the split (plan audit, round 3): on the FPC path the account never pays the network fee
  (`AccountFeePaymentMethodOptions.EXTERNAL`, `fpc-strategy.ts`), but a contract added by hand
  can refuse to run unless the account calls it and then spend a token authorization the account
  granted earlier, so only the sponsor Nulo ships is promised "free".
- `FeeMethodRow.vue`: the public "Available" amount's unit "Fee Juice" → "FJ".
- `GasBalanceCard.vue`: "Public Juice" → "Public Fee Juice".
- Amounts, rounding and the USD formatter are untouched.

### Item 7 · Lock chip

`Header.vue`: the `header-lock` button becomes a chip, `MaterialIcon lock` at 15px (primary) plus a
"Lock" label, styled from the mock's `.n-lockchip` (height 26px, padding `0 9px 0 7px`, gap 5px,
1px `--nulo-border`, hover `--nulo-surface-low`; label mono 10px, weight 500, 0.08em, uppercase,
secondary), which matches the network chip beside it. Testid and `aria-label="Lock wallet"`
unchanged (the accessible name contains the visible word).

### Item 8 + U12 + U13 · One mark vocabulary

- One pure mapping in `publish-facts.ts`: `publishGlyph(v: Visibility): "lock" | "globe" | null`
  (`hidden` → lock; `public` and `exposed` → globe; `unknown` → null).
- The three consumers render it inline, no new component (an L3 composite may not import
  another L3): `<Icon v-if="glyph" :name="glyph" size="10" aria-hidden="true" />` (`Icon`
  renders `role="img"`, so `aria-hidden` is required). No colour of its own: the parent's
  visibility class (`publish-mark.module.css`) sets the ink and the icon draws in
  `currentColor`.
  - `PublishStrip.vue` cells: no glyph when unknown (the cell's gap collapses).
  - `SendReviewSheet.vue` rows: a 10px spacer when unknown, so the row's words align; its
    `row_mark` offset is re-tuned to the 10px glyph (mock: `margin-top: 2px`).
  - `FeeMethodSelector.vue`'s tag: always `exposed`, so the globe.
- `.mark` / `.filled` leave `publish-mark.module.css`; its header comment is rewritten for
  glyphs. Words, sentences, `stripAriaLabel` and every testid and `data-*` attribute stay.

### e2e contract

- Shared helpers, not per-spec copies: `FIRST_ACCOUNT_NAME = "Account 1"` next to
  `exportAccountBody` (its 12 callers stop passing the literal `"Account"`), and
  `waitForNameField(page, pageTestId): Promise<"hidden" | "shown">`.
- First profiles are created along several independent paths, not one: `registerProfile`
  (popup), `fixtures/passkey.ts`, the onboarding specs, and `feeJuiceImportedExtension`
  (`fixtures/extension.ts:953`, a popup seed import that fills `import-name-input` by hand).
  Each goes through the shared helpers below; the last one calls `importSeed`.
- A first profile (`registerProfile`, `fixtures/passkey.ts`, `registration.test.ts`,
  `passkey-backup.test.ts`, `onboarding-tab.test.ts`, `legal-acceptance.test.ts`,
  `feeJuiceImportedExtension`, first-run `importSeed`): wait for the terminal state, assert
  `hidden` and that the field is absent, type no name, and read "Main" back where the spec cares
  (`select-profile-row` / the reset page's `data-profile-name`).
- A later profile (`createAndActivateProfile`, `duplicate-phrase-import.test.ts`, populated
  `importSeed`): wait for `shown`, assert the field's prefill `Profile N`, then replace it only
  when the test needs its own name.
- `importSeed(…, { profileName? })`: a name is typed only when given, and giving one on a first
  profile fails loudly instead of silently skipping. `passkey-paths.test.ts:170` and
  `scripts/check-derivation-parity.ts` are classified per call site.
- New smoke coverage (program minimum): first run through the onboarding tab creates "Main" with
  no field; the next profile from the popup opens prefilled "Profile 2".
- A wire-shaped execute-window component test (`aztec_sendTx` arguments as `0x` + 64-hex fields,
  real-length addresses): a self-paying op shows the locked "Public Fee Juice · set by the app"
  and a self-pay "You pay" line; an op sponsored by Nulo's sponsor shows "Nothing" with the struck
  amount; one sponsored by a hand-added contract shows "—".

## Security & Adversarial Considerations

- **Hostile backup names.** A crafted full backup controls `data.profile.name`. Today the raw
  string reaches `restore` whenever the override is empty after trimming, which a name of spaces
  around a control character achieves on its own (the sanitizer strips the control character,
  keeps the spaces, and the trimmed override is empty). After this batch the restore name always
  comes from the resolver: the typed name, the trimmed sanitized backup name, or a default, never
  the raw string. Tests cover whitespace-only and control-only names in plain and encrypted
  backups.
- **Duplicate names.** `defaultProfileName` and the validator share `normalizeProfileName`, so a
  default can never be a case/NFKC variant of an existing profile. Two tabs creating first
  profiles at the same instant could both pick "Main": the same race exists today with typed
  names (the check is UI-side); the service's restore auto-suffix is unchanged.
- **The fee line must not lie.** "Nothing" shows only when the method that will be submitted is a
  sponsored FPC (`effectiveMethod`, the same value `derivedSettings` submits); a pending preview
  never renders the readout. Tests pin both. "Free" and "Nothing" are promised only for the
  sponsor Nulo ships (`isProtocol`): a contract added by hand pays the network fee or fails the
  transaction, but it can gate its sponsor call on the account being the caller and then spend a
  token authorization the account granted earlier, so choosing it can trigger a charge (plan
  audit, rounds 2–3). It shows "—" (U16), as the strip already does for its privacy.
- **Unknown is never "none".** A failed private balance read stops reading "no balance".
- **Privacy glyphs must not over-claim.** `unknown` never renders the padlock, `exposed` is never
  the padlock; tests assert each visibility's glyph.
- **Screen-reader text** duplicates nothing: the visual sponsored line is `aria-hidden`, the
  sentence is the only spoken copy. No secret, balance or address is added to any accessible name.
- **e2e fixtures get stricter, not looser**: every first-profile path now asserts the field is
  absent and the name is "Main"; no assertion is deleted.
- No storage shape changes, no new permissions, no new dependency, no log lines.

## Assumptions

### Facts (verified in recon or by reading the file)

1. `DEFAULT_ACCOUNT_NAME = "Account"` (`account/spec.ts:6`) is passed bare by three callers; the
   New Account popup picks the smallest free `Account ${n}` (`NewAccountPopup.vue:101-109`).
2. Four pages render a profile-name field. The seed and passkey paths (`useProfileImportFlow`)
   and the create path (`useProfileCreateFlow`) validate it at submit after a fresh
   `getProfiles()`; the full-backup path does not validate or re-read at all; and the create
   path awaits that read outside its `try`, so a rejection strands the latch.
3. The full-backup restore uses the trimmed field as its override, else the backup's raw name
   (`useFullBackupImport.ts:431`); the prefill watcher writes the sanitized name only into an
   empty field (`useProfileImportFlow.ts:413`); `sanitizedBackupName` can return spaces only;
   `restore` suffixes collisions by exact string.
4. `registerProfile` (`tests/e2e/fixtures/extension.ts:272`) creates most suites' first profile
   through `popup/pages/profile/new.vue`, typing "Test Profile"; the onboarding specs,
   `fixtures/passkey.ts` and `feeJuiceImportedExtension` (`fixtures/extension.ts:953`) create
   theirs along their own paths.
5. `FeeMethodOption.subtitle` is also the menu testid key and `data-fee-method`
   (`FeeMethodSelector.vue`), so display text cannot reuse it.
6. The dApp lock (`lockedMethod`) is only ever `"fj"` (`OperationCard.vue:100`).
7. `publish-mark.module.css` is shared by the strip, the review rows and the fee tag; the payer
   has four visibilities (`publish-facts.ts:4`).
8. No visually-hidden utility exists in `apps/extension/src` or `packages/design/src`.
9. The mocks' glyphs are `icons.json`'s `lock` and `globe` at 10px (`design/mocks/build.py`
   builds its sprite from `packages/design/src/internal/icons.json`), the same `Icon` renders.
10. The only e2e assertion on a changed fee string is `fee-methods.test.ts:53,60`
    (`includes("Sponsored")`), still true.
11. The FPC path builds the account payload with `AccountFeePaymentMethodOptions.EXTERNAL`
    (`fpc-strategy.ts:130`; `@aztec/entrypoints`: "some other contract is in charge of paying
    the fee"); a sponsored FPC's payload is one argument-free `sponsor_unconditionally` call
    (`default-sponsored-fpc-handler.ts:19`).
12. `privateFeeJuiceOption` groups a failed read (`null`) with a confirmed `"0"` as "no balance"
    (`fee-helpers.ts:195`); the public row already says "couldn't check balance".

### Inferences

- The popup pages keep their heroes and CTAs: the spec changes only the onboarding create page's
  words, and U11 the onboarding import hero.
- A later profile created from the onboarding shell (profiles exist, onboarding reopened) follows
  the same rule and shows the field prefilled.

### Asks → codex (decided in the plan audit; ledger in [`audit-codex.md`](audit-codex.md))

1. Submit-time name: **amended** — resolved at submit for every path, full backup included, from
   a fresh read, with late setup reads fenced and deletion handled.
2. Page-root testids plus `data-name-field`: **approved** — wait for the terminal state, then
   assert the field's actual presence and prefill.
3. "Untouched": **amended** — one tracked value for every automatic writer; each backup
   selection recomputes its candidate.
4. Visually hidden class local to `FeeCostReadout`: **approved**.
5. "Nothing" for hand-added sponsored-type contracts: **restricted** after three rounds. Fact 11
   holds for the network fee, but codex's caller-gated reimbursement shows choosing such a
   contract can trigger a charge; "free"/"Nothing" only for `isProtocol` sponsors, a dash for
   the rest, drawn as U16 for the owner.
6. `spend` in `buildFeeMethods`: **approved with a correction** — split a failed private read
   from zero (U14).
7. Marks: **inline icons**, no L3 → L3 import.
8. No display-time rename of persisted "Sponsored Fee Juice": **approved**.
9. e2e contract: **approved with additions** — `feeJuiceImportedExtension`, terminal state before
   typing.
10. Focus: **`Input`'s existing `autofocus`**.
11. Parity captures from an isolated network run with deterministic priced and unpriced setups;
    temporary capture code never replaces a committed assertion: **approved**.

UI asks: U14, U15 and U16 (above), drawn into round 5 for the owner before P1; built as
recommended and **sign-off pending** until picked.

## Approval

Passed under the program's standing approval (program plan § Standing approval), 2026-09-24:

1. Phase 0 is the program's pre-answers.
2. Codex, round 4 of session `01a0d3d9-af15-7b92-a759-f080761204f6`: **approve**, confidence
   high: "No new material findings." Rounds 1–3 were conditional; every condition is applied
   ([`audit-codex.md`](audit-codex.md)).
3. Light tier: no fable leg.
4. No open Ask: 1–11 decided with codex; the UI asks are U11–U16, sign-off pending.
5. UI impact lists spec surfaces and round-5 recommendations (U11–U16) only.
6. Scope: items 1, 3, 5, 7, 8 and U11–U16.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/ux-feedback/b1-first-run-wording/lessons/phase-N.md`.

### Before P1 · Round-5 additions ✓

Draw U14 (the fee menu before its balances arrive, and with one unreadable), U15 (the spoken
sentence below a tenth of a cent, as text) and U16 (a sponsor added by hand) into the artifact's
round 5 in the item-3 block, with pickers `i3d`, `i3e`, `i3f`, targets `03-menu-unknown-U14`,
`03-spoken-U15`, `03-handadded-U16`; rebuild; page check (no console errors, no horizontal scroll
at 1400px and 400px, every picker renders); republish at the artifact's URL; notify the owner.
Done: Version 8, 40/40 shots ([`lessons/phase-0.md`](lessons/phase-0.md)).

Gate: `build.py` and `shots.mjs` exit 0, the check reports clean, the publish result printed.

### P1 · Account names ✓

1. `DEFAULT_ACCOUNT_NAME = "Account 1"`; `nextAccountName` extracted with its test; the popup
   uses it.
2. Update `account/service.test.ts:524`, `popup/network-switch.test.ts:69,188`,
   `useProfileBootstrap.test.ts:68`; `FIRST_ACCOUNT_NAME` in the e2e helpers and the 12
   `exportAccountBody` callers.

Gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.

### P2 · First run (item 5, U11) ✓

1. `utils/profile-name.ts` (+ test: "Main", "Profile 2", a collision bump past a case/NFKC
   variant, 32-char bound); `useProfileNameField` uses `normalizeProfileName`.
2. `useProfileNameDefault` (+ test: hidden / shown / failed read settles `shown`; untouched vs
   typed; the backup candidate over an untouched default, named → nameless → named; submit-time
   resolution when pending, after another profile was added, and after the last one was deleted;
   a late setup read after submit writes nothing); wired into both flows.
3. The create flow's read inside its error handling (+ test: a rejected read releases the latch,
   notifies, and a retry succeeds).
4. Full backup: the restore asks the resolver inside its latch; `sanitizedBackupName` trims (+
   tests: whitespace-only and control-only names never reach `restore` raw, plain and encrypted;
   the resolved name survives the duplicate-confirm retry).
5. The four pages; onboarding create strings and focus; onboarding import hero.
6. Component tests: onboarding create (no field on first profile, strings, focus, tablist name),
   onboarding import (no field, hero), popup new (prefill "Profile 2"). Wire-shaped fixtures do
   not apply (no dApp data).
7. e2e: the helpers and every call site in the e2e contract (`feeJuiceImportedExtension`
   included); the new smoke coverage.

Gate: lint, `typecheck:all`, `test:all`, `bun run build`; the smoke build, then the full Chrome
smoke (`registerProfile` reaches every spec) exit 0.

### P3 · Fee wording (item 3) ☐

1. Strings in `FeeMethodSelector`, `fee-helpers`, `fee-privacy`, `fpc/service`, `FeeMethodRow`,
   `GasBalanceCard`, the locked row.
2. `spend` in `buildFeeMethods` and the menu (+ one table-driven `fee-helpers.test.ts` case:
   not known yet, one leg unreadable, zero, positive balance, missing PrivateFPC, Nulo's sponsor
   "free", a hand-added sponsor "—"; the disabled reason wins; + a `FeeSettingsCard` case that a
   whole read failing keeps the rows selectable with "— FJ" beside the degraded notice).
3. `FeeCostReadout` states and spoken text (+ tests: self priced/unpriced, sponsor
   priced/unpriced/below a tenth of a cent, unvouched, each sentence, the `aria-hidden` visual,
   `fee-estimate-usd` on priced output, estimating/idle labels); `FeeSettingsCard` passes `payer`
   (+ a test that it follows the effective method, protocol vs hand-added, and the locked row's
   words).
4. The wire-shaped execute-window test (e2e contract, last bullet).
5. Update `FeeCostReadout.test.ts:21,27`, `FeeMethodSelector.test.ts:25,45,74,92`,
   `FeeMethodRow.test.ts`, `fee-privacy.test.ts:219`, `FeeSettingsCard.test.ts` title fixtures.

Gate: lint, `typecheck:all`, `test:all` exit 0.

### P4 · Lock chip and marks (items 7, 8, U12, U13) ☐

1. `Header.vue` chip (+ `Header.test.ts`: word, icon, testid, accessible name).
2. `publishGlyph` (+ test: every visibility, `unknown` → none, `exposed` → never the lock); the
   three consumers render it inline; `publish-mark.module.css` trimmed; update
   `PublishStrip.test.ts`, `SendReviewSheet.test.ts` (the unknown row keeps its spacer),
   `FeeMethodSelector.test.ts` mark assertions.
3. `PublishStrip.stories.ts` still builds.

Gate: lint, `typecheck:all`, `test:all`, `bun run --cwd apps/extension build-storybook` exit 0.

### P5 · Arc gate ☐

1. Every row of the program's [Local gates](../plan.md#local-gates): lint, `typecheck:all`,
   `test:all`, `test:ci-gating`, `build`; full smoke on Chrome and on Firefox.
2. Network e2e on Chrome and on Firefox for the specs this batch edits or whose first-profile
   fixture it changes: `imported-account-execution`, `account-balance-orphans`,
   `profile-reimport-matrix`, `backup-migration-roundtrip`, `backup-restore-integrity`,
   `backup-restore-sw-restart`, `profile-switch-sweeps-transfer`, `session-profileSwitch`,
   `fee-methods`, `send-picker`, `price-fixture` (consumes `feeJuiceImportedExtension`), and the
   execute window's `tx-sendTx-selfPay` and `tx-sendTx-sponsoredFpc`.
3. Flake bar: every new or changed e2e file, smoke and network, three consecutive retry-0 runs on
   each browser (`NULO_E2E_RETRY=0` for network; smoke's config pins `retry: 2`, so its three
   runs go through a scratch config that spreads it with `retry: 0`).
4. Parity: rebuild the mocks and shots; capture every UI-impact row at 360×600 (the execute
   window's fee card at 400×800) on the built extension; publish one private Artifact with each
   capture beside its shot; list every visible difference; fix or escalate each.
5. `bun run e2e:reap`.

Gate: all of the above exit 0 and the parity Artifact URL printed.

## Arc boundary

1. The codex fix loop (below) until a round has nothing material, three rounds at most.
2. Parity evidence re-captured if the loop changed a surface.
3. `gh stack push`, then `gh stack add feat/ux-2-window-placement`.

## Post-implementation (read by the implementing session)

The review loop is `/codex high` (GPT-6 Astra) on the arc diff (`origin/dev`...HEAD), resumed
until a round reports nothing material, three rounds at most; `/code-review` is off. Every codex
prompt, initial and resumed, carries:

- *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
  extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
  problem. If code works and is clear, leave it alone."*
- *"Audit the comments for value per character. Flag any comment that narrates what the code
  visibly does, restates its line, references implementation plans / phases / reviews, or spends
  a paragraph where a sentence works — and flag places where a non-obvious invariant or
  constraint deserves a comment it doesn't have. Comments are permanent context every future
  reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
- The arc map: "this is arc 1 of 6; later arcs build window placement, tooltips and the glossary
  (which turns Home's fee labels into dotted terms), the snackbar, rows and arrivals, and the
  permission window on top of it", so seams reserved for later arcs are not flagged as dead code.
- The adversarial ask and the parity rule: "flag any UI that differs from the spec or invents a
  state it does not draw".

Each finding is fixed in its own commit or rejected with a reason in `lessons/phase-5.md`. Codex
is advisory: it cannot override the spec, the owner's picks, CLAUDE.md or this scope.

## Delivery

- Arc 1 of 6 on `feat/ux-1-first-run-wording` (trunk `dev`), stacked with `gh stack`.
- Commits: conventional, lower-case, signed; one per phase at least, fixes separate.
- `gh stack push` as checkpoints; no PR until the program's final pass (program Delivery).
- PR body (at submit): summary, the UI impact table, the owner's quotes (i1 A, i3 V4, i5 A,
  i7 A1, i8 B), the sign-off-pending list (U11, U12, U13A, U14, U15, U16, unless picked by
  then), the parity Artifact link, test evidence.

## Seeds

The program's `/goal` drives this batch. To resume this batch alone:

```
/goal Deliver implementations-plan/ux-feedback/b1-first-run-wording/plan.md. Done when the transcript shows every phase ✓ with its gate reported passing and LESSONS_FILE printed per phase, a quoted codex re-review with no new material findings, the parity Artifact URL, and gh stack view with feat/ux-2-window-placement on top. Never merge; UI questions the spec and round 5 do not answer go to the owner.
```

```
/loop 15m Drive implementations-plan/ux-feedback/b1-first-run-wording/plan.md forward: read it and its lessons, git status, gh stack view; take the next unchecked step; run its gate; commit; on a decision use the spec, then round 5, else /codex high for technical asks; hard limits stay hard.
```
