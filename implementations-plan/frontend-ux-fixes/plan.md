# Extension frontend UX fixes — batch 1 (`/blueprint mid`)

**Status:** AUDITED — dual audit (`reject`×2) + final fresh-context codex pass (`reject`, caught real
errors the first revision introduced) all folded; P3 verification resolved by the user's informed
decision (masked + optional reveal). Pending approval gate, then implement.
**Tier:** `mid`. Phase 0.5 rubric ~1 HIGH-ish / 2 MED: security-sensitivity (P3 = recipient-address
verification in Send) + blast radius (P5a edits shared `Toggle`/`DropdownItem` focus behavior → affects
every screen carrying them; P4 adds an address-input affordance). Contained to `@nulo/extension`
(P5a touches `@nulo/design`'s `Toggle` + the extension-owned `Dropdown` focus model — `DropdownItem`
and `DropdownRoot` live in `@nulo/extension`, NOT the design package), low novelty/irreversibility.
**Scope:** six reported UX fixes, re-sequenced low-risk → broad after the audit.
**Validation:** component tests (one-shot `vitest run`, NOT `test:components` — that's scoped to
`src/components` and misses every `src/popup/**` target) + smoke e2e + human visual/keyboard sign-off (no
network e2e — clarifying answer).

> **Gate-command note (audit CRITICAL):** `test:components` = `vitest run src/components` and matches
> NONE of the `src/popup/**` files this plan edits. Per-phase gates below use
> `bun run --cwd packages/extension test -- run <path-filters>` (explicit one-shot) and the cumulative
> `bun run audit:vue` (`typecheck:all && test && lint && build`; the `test` step one-shots in CI/non-TTY).

## User decisions (clarifying + post-audit)
- **Account indicator (was #4 "emoji identicon"):** **initials avatar** — a disc with the account's
  initials, background color *deterministically hashed from the address* (a plain string-hash → palette
  index; NOT `hashToEmoji`, NOT crypto). Single-emoji was rejected by both auditors (8 bits, grindable;
  `hashToEmoji` can't parse a raw `0x…` address anyway). The avatar is decoration beside the
  name+address — it carries no security weight.
- **Send recipient (#3):** **masked card + on-screen reveal** — name + `0x` first-8 `***` last-8, with a
  tap-to-reveal full address + copy, *on the send screen before submit* (see Security: `send.vue` has no
  later confirm surface, so the card's reveal IS the verification surface).

## Phases (sequenced low → high risk)

### P1 — Copy + border quick fixes (#1, #6) ✓
1. **#1 Settings "Identity" row label.** `settings/index.vue:55` renders the row title as
   `:title="appStore.profile.name"`. Change to a static `title="Profile"`. The profile name still shows
   on the profile detail page the row links to — intended per the user (the name leaving this row is the
   ask). Pure copy.
2. **#6 Contact form double border.** In `EditContactPopup.vue` (~`.sender_row` `border-top` at ~:474)
   and `NewContactPopup.vue` (~:297), the address `Input`'s bottom border stacks under the "Register as a
   sender" row's top border → a double line. Remove the row's `border-top` (keep the Input's bottom).
   Verify the exact `.sender_row` rule in each popup's `<style module>` before editing.

**Validation gate** — `bun run typecheck:all` · `bun run lint` ·
`bun run --cwd packages/extension test -- run src/popup/components/popups/EditContactPopup src/popup/components/popups/NewContactPopup src/popup/pages/settings/index`
· `bun run build`. Pass: all exit 0. Layers: typecheck · lint · component · build.

### P2 — Account indicator: retire `vault` → initials avatar (#4, non-Send) ✓
`vault` is removed everywhere (4 sites; census confirmed by both auditors). The two NON-Send sites are
account-row indicators → replace with an **initials avatar** (the Send sites `RecipientField.vue:89,131`
are owned by P3). Reuse the existing contact-initials chip pattern already in the recipient suggestion
list (`c.abbr`) — extend it to take `{ name, address }` and render initials + an address-hashed disc
color, so contacts and accounts share one avatar component.
1. New presentational `AccountAvatar` (L3 composite, `src/components/composite/`): props `name`/`address`
   (+ `size`), computes initials from the name and a deterministic background color from a cheap string
   hash of the address (palette index — no `hashToEmoji`, no crypto). Pure; ≥10 component tests
   (initials derivation, color determinism for a given address, size, empty-name fallback).
2. `settings/accounts/index.vue:147` (`icon="vault"`) → `<AccountAvatar>`.
3. `EditAccountPopup.vue:99` (`icon="vault"`) → `<AccountAvatar>`.
4. **Note:** `SettingItem` exposes a `#icon` slot — the avatar goes through the slot, NOT the `icon`
   string prop (which only resolves an `<Icon name>` SVG and can't render an avatar). Verify per site.
5. The first-draft `--txt-undefined` theory is DROPPED — codex found no reproducing `vault` color prop;
   not bundling an unreproduced bug into this phase.

**Validation gate** — `bun run typecheck:all` · `bun run lint` ·
`bun run --cwd packages/extension test -- run src/components/composite src/popup/pages/settings/accounts src/popup/components/popups/EditAccountPopup`
(avatar renders; no `vault`) · `! grep -rn 'name="vault"\|icon="vault"' packages/extension/src` (must be
empty AFTER P3) · `bun run build`. Layers: typecheck · lint · component · build.

### P3 — Send recipient card (#3) + remove Send `vault` (#4 Send) ✓
`RecipientField.vue:9-13` shows a selected contact/account as `<Icon vault> + <Text name>`. Replace with
a **card**:
1. New presentational `RecipientCard` (L3 composite): the `AccountAvatar` (from P2) + the recipient
   **name** + the address as **`slice(0,8)` `***` `slice(-8)`** (the user's "first 8 / last 8"). Preserve
   every `data-testid`.
2. **Reveal/copy — OPTIONAL, user's informed decision.** A prominent tap/expand on the card reveals the
   **full** address (mono, selectable) + copy, inline before submit. The reveal is the verification path
   for users who want 100% certainty; it is NOT a forced gate on Send (the user explicitly accepted the
   masked-by-default model after the security tradeoff was surfaced — see Security & the decision ledger).
   Make the reveal affordance obvious and one tap away, so verification is *easy*, even though it's opt-in.
3. **Raw-typed / pasted address (no contact match):** show the same masked form + reveal for the raw
   address alone (no name) — so a typed/pasted destination is presented consistently, not bypassed.
4. The suggestion-list `vault` avatar (`RecipientField.vue:131`) → `AccountAvatar` for accounts; contacts
   keep their initials chip (now the same component).
5. **Tests must be REWRITTEN, not just selector-preserved:** `RecipientField.test.ts:39,49,44` assert the
   `[data-name="vault"]` fallback directly — those assertions pin the thing being deleted. Replace with
   avatar + masked-address + reveal (selected contact AND raw-address) assertions.

**Validation gate** — `bun run typecheck:all` · `bun run lint` ·
`bun run --cwd packages/extension test -- run src/popup/components/modules/send`
(RecipientField: selected card shows name + avatar + 8…8 masked address; reveal exposes the full address;
no `vault`) · `bun run test:e2e` (send smoke selects a recipient; no NEW smoke failures) · `bun run build`.
Layers: typecheck · lint · component · smoke · build.

### P4 — Address-input read affordance (#2) ✓
A long address in the shared native `<input>` scrolls (cursor-following) so at rest the `0x…` prefix is
hidden and "jumps" on focus. **Do NOT change `@nulo/design/Input`'s value or add wallet semantics to the
package core** (audit: layering + paste/selection/a11y risk). Fix extension-side:
1. New extension `AddressInput` wrapper (`src/components/composite/`) composing the shared `Input`: the
   native `<input>` STAYS MOUNTED at all times (an `:opacity`/overlay swap, NOT a `v-if` DOM swap) — the
   truncated read view (`0x3333…7a9c`, mono) is an overlay shown when **blurred** and hidden on **focus**.
   This (a) preserves the e2e selector `[data-testid="send-destination-field"] input` that the smoke helper
   targets (`tests/e2e/fixtures/helpers.ts:639,654` — final-pass MEDIUM), and (b) never rewrites the bound
   model value, so paste, selection, the `c.address === searchTerm` equality in `RecipientField.vue:30,43`,
   and screen readers are untouched. ≥10 tests (blur shows overlay, focus reveals editable input, paste
   round-trips, the inner `input` testid stays queryable in both states, value identity preserved).
2. Apply only where addresses are TYPED: contact address (`EditContactPopup`/`NewContactPopup`), the send
   raw-address field, the sender field. Not every input.

**Validation gate** — `bun run typecheck:all` · `bun run lint` ·
`bun run --cwd packages/extension test -- run src/components/composite src/popup/components/modules/send src/popup/components/popups`
(wrapper blur/focus behavior; value identity preserved) · `bun run test:e2e` (paste an address in a
contact/send field; the value submits intact) · `bun run build`. Layers: typecheck · lint · component ·
smoke · build.

### P5a — Shared focus primitives + the create/profile-new seam (the convention anchor) ✓
Root cause (CORRECTED TWICE — the first draft's "DOM order" was wrong; the second draft's "remove the
tabindex" was ALSO wrong because the nodes are `<div>`s. Final-pass HIGH). Three real causes:
- **Positive tabindex on non-focusable elements:** `Toggle.vue:27` (a `<div>`, `@click` only) and
  `DropdownItem.vue:8` (a `<div>`) both set `tabindex="1"`. A positive tabindex pulls the WHOLE document
  into two-pass order. **But these are `<div>`s** — `tabindex` is what makes them focusable AT ALL, so it
  must be CHANGED to `0`, NOT removed (removing drops focus + breaks keyboard reachability entirely).
- **`DropdownRoot` arrow-nav is coupled to the literal value:** `DropdownRoot.vue:197,208` does
  `querySelectorAll('[tabindex = "1"]')` to find navigable items. Changing `DropdownItem` to `tabindex="0"`
  WITHOUT updating this selector silently breaks arrow-key navigation. The two MUST change together.
- **In-field secondary `<button>` between logical fields:** the show/hide-password `<button>` at
  `NewProfileCredentials.vue:31` sits between the password (`:22`) and confirm (`:51`) inputs with no
  `tabindex="-1"`. (CORRECTION: `Input.vue:296`'s `clear_btn` is an `<Icon>` SVG with `@click`, NOT a
  `<button>` — it is NOT in the Tab path and is NOT a cause. Dropped from the story.)

Steps:
1. **`tabindex="1"` → `tabindex="0"`** (explicit, NOT removal) on `Toggle.vue:27` + `DropdownItem.vue:8`.
2. **Keep `Toggle` keyboard-operable:** it's a `<div>` with `@click` only — add `@keydown.enter.prevent`
   + space activation so a focused toggle can actually be toggled by keyboard (it currently can't).
3. **Update `DropdownRoot.vue:197,208`** to match the new value (`[tabindex = "0"]`) — or switch both
   `DropdownItem` + the selector to a stable `data-` attribute so the nav isn't coupled to a tabindex
   literal. Update `DropdownRoot`'s tests for the new selector/model.
4. **Keyboard model for create/profile-new (pick ONE honestly — final-pass HIGH flagged the prior
   self-contradiction):** the auth-method tab buttons (`NewProfileMethodTabs` / `create.vue:138-155`) sit
   between name and password, so "Tab name→password→confirm" is impossible if they remain plain serial tab
   stops. MODEL: give the auth-method tabs **roving tabindex** (one Tab stop for the group, ←/→ to switch
   method — the standard tablist pattern), and set the show/hide-password `<button>` to `tabindex="-1"`.
   Net, honestly achievable: Tab flows name → [tablist: one stop] → password → confirm. (The user's "name
   → password" complaint is satisfied by the tablist collapsing to a single, skippable stop.)
5. Verify `Popup.vue`'s `focus-trap` (`:29`, sentinel `:62`) only traps within an open popup.
6. **Convention** → document in `CLAUDE.md`: no positive `tabindex` (use `0`); focusable custom widgets
   (`<div role>`) need keyboard activation; secondary in-field controls are `tabindex="-1"`; grouped
   choices use roving tabindex; nav code must not key on a tabindex literal.
7. **Regression pin:** component/e2e assertion that Tab reaches confirm-password on BOTH onboarding
   `create.vue` and `profile/new.vue`, AND that `DropdownRoot` arrow-nav still selects items.

**Validation gate** — `bun run typecheck:all` · `bun run lint` ·
`bun run --cwd packages/extension test -- run src/onboarding src/popup/pages/profile src/popup/components/modules/settings/new-profile src/components/ui/Dropdown`
(create/profile-new Tab pin + Dropdown arrow-nav pin both green) +
`bun run --cwd packages/design test -- run src/ui/Toggle` (Toggle pins + new keyboard-activation pass) ·
`bun run test:e2e` (Tab name→password→confirm on create-account) · `bun run build`. Pass: all exit 0; the
create-account Tab pin AND the Dropdown arrow-nav pin are green. Layers: typecheck · lint · component ·
smoke · build.

### P5b — Long-tail per-screen tab-order sweep (#5) — human-gated ✓
With the primitives + convention fixed in P5a, sweep the remaining screens for residual tab-order issues:
onboarding (import/fees), profile (change-password/export), send, contacts (edit/new/import), settings
forms, the edit popups (account/network/token/fpc/endpoint), confirm/receive. Fix per-screen against the
P5a convention; record a per-screen checklist in `lessons/phase-5b.md`. No new shared-primitive changes
here (those are P5a) — this is application of the convention.

**Validation gate** — `bun run audit:vue` · `bun run test:e2e` · **human keyboard sign-off** (tab through
onboarding, send, contacts, settings, the edit popups). Pass: `audit:vue` exit 0; no NEW smoke failures;
human confirms tab order on the swept screens. **Do NOT mark ✓ without the keyboard sign-off.** Layers:
full (minus network e2e) + human.

## Competing outline (alternative — by SURFACE, considered + rejected)
Group by surface instead of change-type: **A. Send** (#3 card + #4 Send-vault + #2 send-input + #5 send
tab-order, one pass) · **B. Account-indicator** (#4 → avatar) · **C. Global** (#2 Input everywhere, #5
all screens, #1/#6). **Resolution (post-audit):** PARTIALLY ADOPTED. The by-type spine is kept because
#2 (typed-address affordance) and #5a (shared `Toggle`/`DropdownItem` focus) are inherently cross-surface
— forcing them under "Send" would split each across phases and risk divergent treatments. BUT the
auditors' core objection ("don't ship a half-done Send") is honored: **P3 now delivers a COMPLETE,
verifiable Send recipient card** (avatar + name + masked address + on-screen full-address reveal), so the
Send recipient flow is verifiable in one phase rather than scattered. P4 then refines the *typing* input
(a different element from P3's display card). This is the synthesis the audit pushed for.

## Security & Adversarial Considerations
Presentational changes in the extension popup; no new trust boundary, network call, secret, or crypto.
- **Recipient-address verification (P3) — INFORMED RISK-ACCEPTANCE.** Masking a *send recipient* (first 8
  … last 8) weakens full-destination verification; an attacker grinding a vanity address matching the
  visible 8+8 could pass a glance check (address-substitution / poisoning). `send.vue:237 handleSend`
  submits off `searchTerm.value` and navigates away — there is no later confirm screen (all three audit
  passes flagged this). **The tradeoff was surfaced to the user with three options (full-always,
  mandatory-reveal, masked+optional-reveal); the user explicitly chose masked + OPTIONAL reveal** ("the
  user should reveal if they want 100% certainty"). This is a deliberate product/risk decision the wallet
  owner made, not an oversight. **Implementation duty:** make the reveal prominent + one tap away (easy to
  verify), and apply the same masked+reveal to raw typed/pasted destinations so none bypass the surface.
  The residual risk (a user sends after a glance at only 8+8) is accepted by the user.
- **Account avatar is decoration, not identity (P2).** The initials avatar's color is an address-hashed
  *display aid* with intentional collisions — it sits beside the name+address and is never the sole
  disambiguator. (This is why single-emoji was rejected: it was being treated as an indicator.)
- **XSS:** card/avatar render text + a CSS-colored disc (no HTML string, no `v-html`); `Input` stays a
  native input; P4's wrapper swaps display, not markup. `@nulo/design` boundary tripwires still apply.
- **Layering (P4/P5a):** P4 stays extension-side (no wallet semantics in `@nulo/design` core). P5a's
  `@nulo/design` edit is `Toggle` (`tabindex="1"→"0"` + keyboard activation, pinned by `Toggle.test.ts`);
  `DropdownItem` + `DropdownRoot` are `@nulo/extension`, and their `tabindex` + arrow-nav selector change
  together (else arrow-nav regresses — final-pass HIGH).
- **Least privilege / supply chain / crypto:** N/A (no deps, credentials, or crypto touched).

## Assumptions
**Facts (verified against code this session):**
- #1: `settings/index.vue:55` row title is `:title="appStore.profile.name"` (both auditors: misleading).
- #6: `.sender_row` `border-top` stacks under the Input's bottom border in `EditContactPopup.vue` (~:474)
  + `NewContactPopup.vue` (~:297). Both auditors "looks right."
- #4 census: `vault` used at EXACTLY 4 sites — `RecipientField.vue:89,131`, `EditAccountPopup.vue:99`,
  `settings/accounts/index.vue:147`. Confirmed both auditors.
- #3: `send.vue:237 handleSend` reads `searchTerm.value` → `executeTransfer(...)` then navigates away; NO
  confirm step re-showing the recipient (verified this session).
- #3 masking pattern precedent exists but differs: `TokenMetadataPopup.vue` masks `slice(0,6)/slice(-4)`;
  `trimAddress` defaults `8/4`. The user's "8/8" is honored verbatim (not claimed as "the existing pattern").
- #2: `Input` (`@nulo/design`) is a native `<input>` (`Input.vue:277`); its `clear_btn` (`:296`) is an
  `<Icon>` SVG with `@click.stop` — NOT a `<button>`, so it is NOT in the Tab path (final-pass: the prior
  draft wrongly called it a tab-order cause). `text-overflow: ellipsis` (`:381`) is a no-op while focused.
- #5 root cause (verified, final-pass corrected): `Toggle.vue:27` (a `<div>`) + `DropdownItem.vue:8` (a
  `<div>`) both set `tabindex="1"` — must become `"0"`, NOT removed (divs need it for focus). `Toggle` has
  `@click` only (no keyboard activation). `DropdownRoot.vue:197,208` keys arrow-nav on the literal
  `[tabindex = "1"]` (must change with `DropdownItem`). The real in-field interrupter is the show/hide
  `<button>` at `NewProfileCredentials.vue:31` (used by `profile/new.vue`, NOT onboarding); `create.vue`
  inlines its own password inputs (`:162-178`) + auth-method tab buttons (`:138-155`); `Popup.vue:29` is a
  real `focus-trap`. `DropdownItem`/`DropdownRoot` are `@nulo/extension`, only `Toggle` is `@nulo/design`.
  (Facts corrected across drafts: `Input` "no tabindex/focus-trap"; `NewProfileCredentials` as the
  onboarding file; `hashToEmoji` as an account indicator; "remove tabindex / natural 0" on divs; `clear_btn`
  tabbable.)

**Inferences (unverified — attack these):**
- The initials avatar (address-hashed color) is a satisfactory `vault` replacement at 12px/28px — visual
  sign-off confirms.
- P4's blur→truncated / focus→full wrapper resolves the "address jumps/hidden at rest" complaint without
  breaking paste/selection — component tests + smoke confirm.
- The roving-tablist model (auth-method tabs = one Tab stop, ←/→ to switch) + show/hide `<button>` at
  `tabindex="-1"` yields the user's "name → password → confirm" expectation — keyboard sign-off confirms.

**Asks:**
- ~~P3 verification model~~ → **masked + OPTIONAL reveal (user's informed decision).** The fork was
  surfaced (full-always / mandatory-reveal / masked+optional); the user chose optional and accepts the
  residual risk. Raw typed/pasted destinations get the same masked+reveal treatment (no bypass).
- ~~P2 indicator shape~~ → initials avatar (user decision).
- ~~P4 approach~~ → extension-side overlay wrapper, native `<input>` stays mounted (preserves e2e selector;
  no `@nulo/design` value mutation).
- ~~P5 one phase vs split~~ → split into P5a (primitives + convention + seam) and P5b (long-tail, human-gated).

## Decision ledger
- **Dual audit verdict: both `reject`** (codex `019eebb9-…`, opus substitute for the offline Fable 5).
  Transcripts: `audit-codex.md`, `audit-opus.md`. Convergent blocking findings, all adopted:
  1. P3 masking had no verification surface → P3 now mandates on-screen full-address reveal before submit.
  2. P5 root cause was wrong (claimed DOM-order) → corrected to positive-`tabindex` + in-field buttons;
     P5 split into P5a (primitives/convention/seam) + P5b (long-tail, human-gated).
  3. Single-emoji/`hashToEmoji` indicator unsafe (8 bits; can't parse `0x…`) → replaced with initials
     avatar (user decision); emoji path dropped entirely.
  4. Validation gates ran `test:components` (misses `src/popup/**`) → all gates now use
     `bun run --cwd packages/extension test -- run <paths>` + cumulative `audit:vue`.
  5. False "verified Facts" (`Input` no-tabindex; `NewProfileCredentials` onboarding path; `EmojiGrid`
     reuse; `--txt-undefined` theory) corrected/dropped in Assumptions.
- **By-type vs by-surface:** by-type spine KEPT (shared #2/#5a fixes stay atomic) but P3 expanded to a
  complete verifiable Send card — the synthesis the audit demanded over a fully scattered Send.
- **P4 placement:** extension-side wrapper, NOT a `@nulo/design/Input` change (layering + audit LOW).
- **Final fresh-context codex pass (session `019eebcb-…`): also `reject`** — caught real errors the first
  revision introduced. All adopted:
  1. **P3 verification** (optional reveal doesn't guarantee; raw addresses bypass the card) → surfaced the
     full fork to the user, who made an **informed choice: masked + optional reveal**, accepting the
     residual risk (their wallet, their call). Folded: raw typed/pasted destinations now get the same
     masked+reveal (no bypass); the reveal must be prominent + one tap away. The codex "blocking" was a
     risk, not a code defect — risk-acceptance by the owner is a valid resolution.
  2. **P5a `<div>` regression** — "remove tabindex" drops focus on the `<div>` Toggle/DropdownItem, and
     `DropdownRoot.vue:197,208` keys arrow-nav on the literal `[tabindex="1"]` → P5a now CHANGES to `"0"`
     (not remove), adds `Toggle` keyboard activation, updates the `DropdownRoot` selector + tests together.
  3. **P5 keyboard model was self-contradictory** (tabs can't both stay serial AND yield name→pwd→confirm)
     and miscast the non-tabbable `clear_btn` (an SVG) → resolved with a roving-tablist model; `clear_btn`
     dropped from the cause.
  4. **Misstated layering** (`DropdownItem` is `@nulo/extension`, not `@nulo/design`) + **P4 e2e selector
     risk** (`[data-testid="send-destination-field"] input` must survive the blur overlay) → both corrected.
  - **Confirmed CLOSED by the final pass:** P2 (initials avatar via `#icon` slot, no XSS), the gate-command
    passthrough (`-- run` → `vitest run`), and the original false-Facts corrections.

## Seeds
*(Finalized after approval.)*
**`/goal`** (recommended — transcript-observable via plan.md ✓ + gates):
```
/goal All 6 phases (P1, P2, P3, P4, P5a, P5b) marked ✓ in implementations-plan/frontend-ux-fixes/plan.md, each ✓ backed by its Validation gate reported passing in the transcript; for each phase the agent printed `LESSONS_FILE=implementations-plan/frontend-ux-fixes/lessons/phase-N.md`; no `name="vault"`/`icon="vault"` remains in packages/extension/src; P3's on-screen full-address reveal implemented (recipient verification); `/code-review max --fix` complete + committed separately; codex post-impl audit (`/codex xhigh`) complete with high/critical addressed; `bun run audit:vue` and `bun run lint` exit 0 in the transcript. P5b + the visual/keyboard sign-off recorded in lessons (tab order + the Send card + the initials avatars confirmed on the swept screens).
```
**`/loop`** (fallback — fixed interval):
```
/loop 15m Drive implementations-plan/frontend-ux-fixes forward. Never idle. Each firing: read plan.md + lessons/ (authoritative); git status + log; take the next pending step; after each edit run `bun run lint` + `bun run --cwd packages/extension test -- run <touched paths>`; commit → push. Stuck/deciding? `/codex xhigh`, log it. Phase green = its plan.md gate passes; mark ✓, file lessons, print LESSONS_FILE, advance. Never merge to main/release, never publish, never expand scope. All 6 ✓? `/code-review max --fix` → commit → codex post-impl → address high/critical → wrap-up + stop. P3 reveal, P5b + the visual/keyboard sign-off are human-gated — surface and hold.
```
