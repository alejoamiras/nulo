---
plan: ux-feedback/b1-first-run-wording
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: artifact
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
absent). U11, U12 and U13A are built as drawn and listed **sign-off pending**; a later pick
replaces the drawn option on this arc, even after the PR opens.

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

Derived states the shots do not draw, built by the smallest rule that follows the spec and
listed **sign-off pending** in the PR body:

- The fee menu's right column while balances load, or when a read failed and the row is still
  enabled: "— FJ", the dash the card's "Available" row already uses for an unknown balance.
- "You pay" while estimating and before simulation: today's skeleton and "Fee estimated after
  simulation" hint, under the new label, for self-pay and sponsored alike.
- The spoken sentence when the price formats below a tenth of a cent: the spec's template with
  the formatter's own string ("about <$0.001").

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
- **The flows own the decision.** A small composable `useProfileNameDefault(nameField)` (in
  `src/composables/`, used by `useProfileCreateFlow` and `useProfileImportFlow`) reads
  `managers.profile.getProfiles()` once at setup and exposes
  `nameFieldState: Ref<"pending" | "hidden" | "shown">`:
  - no profiles → `hidden`; profiles → `shown`; a failed read → `shown` with an empty field
    (today's behaviour, never a guessed name).
  - It writes `defaultProfileName(names)` into `profileName` unless the value moved since the
    last value it wrote itself (the "untouched" test is that comparison, not an input listener).
  - At submit the flows already fetch `existingNames`. When the state is not `shown` (hidden, or
    still pending on a fast Enter), the name is `defaultProfileName(existingNames)` computed then,
    so a profile created in another tab since mount turns this one into "Profile 2" instead of a
    duplicate "Main". When `shown`, the typed name is validated exactly as today.
- **Full backups.** The restore keeps using the trimmed `profileName` as its override
  (`useFullBackupImport.ts:431`). The parsed-name watcher (`useProfileImportFlow.ts:413`) now
  also replaces an untouched default, so a backup's sanitized name wins over "Main" / "Profile N"
  whether the field is shown or hidden; a backup with no usable name keeps the default. The
  hidden field therefore always carries the sanitized value, never the raw embedded one.
- **Pages** (the four named in recon): render the name field `v-if="nameFieldState === 'shown'"`
  and stamp `:data-name-field="nameFieldState"` on the page root, which gains a testid
  (`onboarding-create-page`, `onboarding-import-page`, `register-page`, `import-page`) through the
  root component's attribute fallthrough, as `data-restore-stage` already rides `OnboardingPage`.
  e2e reads the state from that testid; nothing selects by the bare attribute.
- **Onboarding create strings** as in UI impact row 1; the tablist's `aria-label` follows the
  visible label. Initial focus: the password input, focused after mount through its ref. The
  roving-tablist comment ("name → method → password") loses the name.
- **Onboarding import**: hero "Import" / "Wallet"; everything else on the page stays.
- Popup `new.vue` / `import.vue`: only the field's visibility and prefill change.

### Item 3 · Fee wording (V4)

- `FeeMethodSelector.vue`: label "Fee"; the menu's right column prints
  `method.disabled && method.disabledReason ? method.disabledReason : method.spend`.
- `fee-helpers.ts`: `FeeMethodOption` gains `spend?: string` (display only). `buildFeeMethods`
  fills it: public → `${formatGasBalance(publicFeeJuice)} FJ`, private →
  `${formatGasBalance(privateFeeJuice)} FJ`, sponsored → `"free"`; an unknown or not-yet-read
  balance → `"— FJ"`. `subtitle` stays the testid and `data-fee-method` key and is no longer
  shown. Titles: `"Public Fee Juice"`; the unnamed-sponsor fallback `"Sponsored"` (also in
  `fee-privacy.ts:105`); the private fallback stays "Private Fee Juice".
- `wallet/services/fpc/service.ts`: `SPONSORED_FPC_DEFAULT_NAME = "Sponsored"`. Rows already
  seeded keep their stored name (pre-production: devs reinstall; no migration, no display-time
  rename).
- `FeeCostReadout.vue`: label "You pay" in every state; new prop `sponsored: boolean`.
  - estimated, not sponsored: unchanged markup (`~{amount} FJ` + `({usd})`, testid
    `fee-estimate-usd` kept).
  - estimated, sponsored: `Nothing` (mono 12px, weight 600, primary) then, in the 10px secondary
    small, struck through: `~{amount} FJ` plus ` ({usd})` when priced. The visual part is
    `aria-hidden`; a visually hidden sibling carries "You pay nothing. The sponsor covers about
    {usd}." or, unpriced, "…about {amount} FJ.". One line at 360px (asserted in the parity pass).
  - estimating and idle: today's markup under the new label.
  - The visually hidden class is local to the readout's CSS module (the first user; a second one
    extracts it to `@nulo/design`).
- `FeeSettingsCard.vue` passes `:sponsored="effectiveMethod?.type === 'fpc'"` (only
  `DefaultSponsoredFpc` rows become `fpc` options, `fee-helpers.ts:168`), and the locked row reads
  "Public Fee Juice · set by the app" (the lock is only ever `fj`, `OperationCard.vue:100`).
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

- New L3 `components/composite/send/PublishMark.vue`, props `visibility: Visibility` and
  `reserve?: boolean`: `hidden` → `<Icon name="lock" size="10">`, `public` / `exposed` →
  `<Icon name="globe" size="10">`, `unknown` → nothing, or a 10px spacer when `reserve`. No
  colour of its own: the parent's visibility class (`publish-mark.module.css`) sets the ink and
  the icon draws in `currentColor`. It stamps `data-mark="lock|globe|none"` for component tests.
- Consumers: `PublishStrip.vue` cells (no `reserve`), `SendReviewSheet.vue` rows (`reserve`,
  keeps its `row_mark` offset, re-tuned to the 10px glyph), `FeeMethodSelector.vue`'s tag
  (`exposed`). `.mark` / `.filled` leave `publish-mark.module.css`; its header comment is
  rewritten for glyphs.
- Words, sentences, `stripAriaLabel` and every testid and `data-*` attribute stay.

### e2e contract

- Shared helpers, not per-spec copies: `FIRST_ACCOUNT_NAME = "Account 1"` next to
  `exportAccountBody` (its 12 callers stop passing the literal `"Account"`), and
  `waitForNameField(page, pageTestId): Promise<"hidden" | "shown">`.
- A first profile (`registerProfile`, `fixtures/passkey.ts`, `registration.test.ts`,
  `passkey-backup.test.ts`, `onboarding-tab.test.ts`, `legal-acceptance.test.ts`, first-run
  `importSeed`): assert `hidden`, type no name, and read "Main" back where the spec cares
  (`select-profile-row` / the reset page's `data-profile-name`).
- A later profile (`createAndActivateProfile`, `duplicate-phrase-import.test.ts`, populated
  `importSeed`): assert `shown`, read the prefill `Profile N`, then replace it only when the test
  needs its own name.
- `importSeed(…, { profileName? })`: a name is typed only when given, and giving one on a first
  profile fails loudly instead of silently skipping. `passkey-paths.test.ts:170` and
  `scripts/check-derivation-parity.ts` are classified per call site.
- New smoke coverage (program minimum): first run through the onboarding tab creates "Main" with
  no field; the next profile from the popup opens prefilled "Profile 2".

## Security & Adversarial Considerations

- **Hostile backup names.** A crafted full backup controls `data.profile.name`. Today the field
  normally holds the sanitized name (`sanitizedBackupName`, 32 chars), and the raw one reaches
  `restore` only if the user empties the field. The new flow never leaves the override empty on
  submit: the hidden field carries "Main", "Profile N" or the sanitized backup name. The
  pre-existing raw path (a user clearing a shown field) is not widened; hardening it is out of
  scope and logged as a follow-up if codex rates it real.
- **Duplicate names.** `defaultProfileName` and the validator share `normalizeProfileName`, so a
  default can never be a case/NFKC variant of an existing profile. Two tabs creating first
  profiles at the same instant could both pick "Main": the same race exists today with typed
  names (the check is UI-side); the service's restore auto-suffix is unchanged.
- **The fee line must not lie.** "Nothing" shows only when the method that will be submitted is a
  sponsored FPC (`effectiveMethod`, the same value `derivedSettings` submits); a pending preview
  never renders the readout. Tests pin both. A hand-added sponsored-type contract is labelled by
  its interface, exactly as the menu's "sponsored" does today (see Asks).
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
2. Four pages render a profile-name field; `useProfileCreateFlow` and `useProfileImportFlow`
   validate it at submit after a fresh `getProfiles()` inside their in-flight latch.
3. The full-backup restore uses the trimmed field as its override, else the backup's raw name
   (`useFullBackupImport.ts:431`); the prefill watcher writes the sanitized name only into an
   empty field (`useProfileImportFlow.ts:413`); `restore` auto-suffixes collisions.
4. `registerProfile` (`tests/e2e/fixtures/extension.ts:272`) creates every suite's first profile
   through `popup/pages/profile/new.vue`, typing "Test Profile".
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

### Inferences

- The popup pages keep their heroes and CTAs: the spec changes only the onboarding create page's
  words, and U11 the onboarding import hero.
- A later profile created from the onboarding shell (profiles exist, onboarding reopened) follows
  the same rule and shows the field prefilled.

### Asks → codex (technical; decided in the audit, logged in `lessons/`)

1. The pending state and the submit-time name: compute at submit, never reveal the field on a
   race. Sound?
2. Page-root testids plus `data-name-field` for e2e determinism, versus a different sync point.
3. "Untouched" = equal to the last value the composable wrote. Edge cases?
4. The visually hidden class local to `FeeCostReadout` (base.css is hash-pinned) versus a design
   utility now.
5. `sponsored` from `effectiveMethod.type === "fpc"`: can a hand-added `DefaultSponsoredFpc`-typed
   contract make the user pay, which would make "Nothing" false?
6. `spend` built in `buildFeeMethods` with `formatGasBalance` (4 dp, as the card's Available row)
   and `disabledReason` precedence.
7. `PublishMark` as a component with `reserve`, versus inline icons in three consumers.
8. No display-time rename of rows already persisted as "Sponsored Fee Juice".
9. The e2e contract above, including `importSeed`'s loud failure.
10. Focus on mount through the input's ref (Chrome and Firefox), versus `autofocus`.
11. Parity captures: the smoke build cannot estimate a fee; capture the fee states from a network
    run (`e2e:agent`) with a temporary uncommitted spec.

UI asks: none open. Every surface comes from the spec or a round-5 drawing; the three derived
states above ship as **sign-off pending**.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/ux-feedback/b1-first-run-wording/lessons/phase-N.md`.

### P1 · Account names ☐

1. `DEFAULT_ACCOUNT_NAME = "Account 1"`; `nextAccountName` extracted with its test; the popup
   uses it.
2. Update `account/service.test.ts:524`, `popup/network-switch.test.ts:69,188`,
   `useProfileBootstrap.test.ts:68`; `FIRST_ACCOUNT_NAME` in the e2e helpers and the 12
   `exportAccountBody` callers.

Gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.

### P2 · First run (item 5, U11) ☐

1. `utils/profile-name.ts` (+ test: "Main", "Profile 2", a collision bump past a case/NFKC
   variant, 32-char bound); `useProfileNameField` uses `normalizeProfileName`.
2. `useProfileNameDefault` (+ test: hidden/shown/failed read, untouched vs typed, backup name over
   an untouched default, submit-time name when pending or raced); wired into both flows.
3. The four pages; onboarding create strings and focus; onboarding import hero.
4. Component tests: onboarding create (no field on first profile, strings, focus, tablist name),
   onboarding import (no field, hero), popup new (prefill "Profile 2"). Wire-shaped fixtures do
   not apply (no dApp data).
5. e2e: the helpers and every call site in the e2e contract; the new smoke coverage.

Gate: lint, `typecheck:all`, `test:all`, `bun run build`; the smoke build, then the full Chrome
smoke (`registerProfile` reaches every spec) exit 0.

### P3 · Fee wording (item 3) ☐

1. Strings in `FeeMethodSelector`, `fee-helpers`, `fee-privacy`, `fpc/service`, `FeeMethodRow`,
   `GasBalanceCard`, the locked row.
2. `spend` in `buildFeeMethods` and the menu (+ `fee-helpers.test.ts`: each row's spend, unknown
   "— FJ", sponsored "free", disabled reason wins).
3. `FeeCostReadout` states and spoken text (+ tests: self priced/unpriced, sponsored
   priced/unpriced, the sentence, `aria-hidden` visual, estimating/idle labels);
   `FeeSettingsCard` passes `sponsored` (+ a test that the prop follows the effective method and
   the locked row's words).
4. Update `FeeCostReadout.test.ts:21,27`, `FeeMethodSelector.test.ts:25,45,74,92`,
   `FeeMethodRow.test.ts`, `fee-privacy.test.ts:219`, `FeeSettingsCard.test.ts` title fixtures.

Gate: lint, `typecheck:all`, `test:all` exit 0.

### P4 · Lock chip and marks (items 7, 8, U12, U13) ☐

1. `Header.vue` chip (+ `Header.test.ts`: word, icon, testid, accessible name).
2. `PublishMark.vue` (+ test: every visibility's glyph, `reserve`); the three consumers;
   `publish-mark.module.css` trimmed; update `PublishStrip.test.ts`, `SendReviewSheet.test.ts`,
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
   `fee-methods`, `send-picker`.
3. Flake bar: each new or changed smoke file three consecutive retry-0 runs on each browser.
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
  i7 A1, i8 B), the sign-off-pending list (U11, U12, U13A and the three derived states), the
  parity Artifact link, test evidence.

## Seeds

The program's `/goal` drives this batch. To resume this batch alone:

```
/goal Deliver implementations-plan/ux-feedback/b1-first-run-wording/plan.md. Done when the transcript shows every phase ✓ with its gate reported passing and LESSONS_FILE printed per phase, a quoted codex re-review with no new material findings, the parity Artifact URL, and gh stack view with feat/ux-2-window-placement on top. Never merge; UI questions the spec and round 5 do not answer go to the owner.
```

```
/loop 15m Drive implementations-plan/ux-feedback/b1-first-run-wording/plan.md forward: read it and its lessons, git status, gh stack view; take the next unchecked step; run its gate; commit; on a decision use the spec, then round 5, else /codex high for technical asks; hard limits stay hard.
```
