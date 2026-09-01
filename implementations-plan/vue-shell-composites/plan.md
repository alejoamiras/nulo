# vue-shell-composites — arc 5 of the complexity/duplication burn-down (assess-then-implement)

**Status: assessment complete — decision recorded below.** This arc was commissioned as
"assess-then-implement": rerun the duplication scan, adjudicate each clone family with an
independent dual-position review (Claude and codex each form a position before seeing the
other's), and either extract the agreed subset or record "extract nothing" with justification.

## The scan (jscpd 5.0.16, production files, post-arc-4 dev)

Trend headline: **5.06% duplicated lines** (production split 424 clones / 8,830 lines).
Top production pairs by reported size, with exact spans:

| lines | format | pair |
|--:|--|--|
| 284 | html | `windows/capabilities/index.vue:1-284 ↔ windows/discover/index.vue:1-155` |
| 247 | html | `pages/journal/[id].vue:1-247 ↔ pages/settings/about.vue:1-41` (about.vue is 115 lines TOTAL) |
| 247×3 | html | `journal/[id] ↔ send / profile-index / account-state-index` (same shape) |
| 177 | html | `pages/activity.vue:4-180 ↔ pages/settings/index.vue:4-40` |
| 76 | css | `pages/import.vue:341-416 ↔ settings/security/change-password.vue:267-342` |
| 65 | html | `popups/EditContactPopup.vue:217-281 ↔ popups/NewContactPopup.vue:166-230` |
| 61 | css | faucet `BridgeForm.vue:612-672 ↔ FuelForm.vue:272-332` |
| 56 | css | faucet `BridgeWalletPanel.vue:119-174 ↔ WalletPanel.vue:170-224` |
| 39–47 | css | account-state list pages; import↔profile/new; change-password↔reset |

## Finding 1 — the headline html families are tokenizer noise, not duplication

Every large html pair has wildly unequal spans (`1-247 ↔ 1-41`; `1-284 ↔ 1-155`): jscpd's
html format tokenizes Vue templates so aggressively that two pages sharing only component
VOCABULARY (`Flex`/`Text`/`SettingItem`/`ItemsContainer` with entirely different content)
count as one whole-template clone. `settings/about.vue` (a static links list) "shares 247
lines" with the bridge-journal detail page while being 115 lines long. There is no
contiguous extractable region; a PageShell extraction would churn every page and its
e2e testids for near-zero real dedup.

`capabilities ↔ discover` is the same effect on top of a dedup that ALREADY happened:
both approval windows render the shared `DappStatusStrip` + `DappIdentityBlock` modules;
the residual match is scaffolding vocabulary.

## Finding 2 — the real (equal-span, byte-level) duplication

- **Auth/seed-form CSS family**: `import.vue`, `profile/new.vue`,
  `settings/security/change-password.vue`, `settings/security/reset.vue` share 39–76-line
  `<style module>` blocks (page scaffold, collapsing label, form layout).
- **Faucet CSS twins**: `BridgeForm↔FuelForm` (61L), `BridgeWalletPanel↔WalletPanel` (56L).
- **Account-state list CSS**: authwits↔notes↔contracts (~44L), senders↔tokens (40L),
  ContactRow↔connected-apps (40L).
- **`EditContactPopup ↔ NewContactPopup`**: 65-line template body, 63/65 byte-identical —
  the only diff is the ORDER of a `sanitize` attribute (live cosmetic drift on a twin form).

## Dual-position adjudication

### Claude's independent position (recorded before codex's reply)

- Whole-page/template shells: **extract nothing** — the signal is noise (Finding 1).
- CSS families: **leave, recorded** — `<style module>` colocation is the repo idiom; a
  shared stylesheet crosses it and churns security-adjacent onboarding pages
  (import/reset/change-password) for an advisory, non-gated metric.
- Contact popups: the one defensible extraction (shared L3 form-fields composite or a
  mode-prop merge), testids verbatim — lean extract, accept leave-with-watch.
- Instrument caveat: the nightly dup-trend's top-pairs table is dominated by html-format
  false positives and should say so (or filter).

### Codex's independent position

More extraction-minded: leave the page shells (agreed noise), but EXTRACT five things — a
slotted `DappApprovalLayout` for the three approval windows; generalize the existing
`SecretExportLayout` across the auth/seed family; merge the faucet wallet panels into one
`AztecWalletPanel` ("same singleton connection, state machine, handlers, markup, CSS");
an L3 `ListStatusMessage` for the repeated empty/no-results presentation; an L4 contact
form-fields component (template shared, scripts stay per-popup — "the apparent script
symmetry hides important differences"). Plus: the dup-trend instrument tweak is in-scope
for a duplication-debt arc — per-format production split, demote html-format clones from
the actionable ranking, keep the raw headline, no gate.

### Reconciliation (verified against the repo, one round to convergence)

- **Adopted from codex** (its evidence held under verification):
  - `SecretExportLayout` exists (`src/components/composite/`, "purely visual chrome" per
    its own docs) and all four auth pages hand-roll its EXACT pattern — own `heroVisible`
    + scrollTop<40 listener + collapsing-label `SubPageHeader` + the same CSS block. Same
    code at 5+ sites incl. a tested composite: **extract (migrate onto the composite)**.
  - `empty_headline`/`empty_sub` presentation verified in ELEVEN files: **extract**
    (`ListStatusMessage`), with codex's constraint — migrate only sites whose rendered
    contract truly matches; never grow the component API to force a site in.
  - Contact popups: **extract the shared fields component**; service listeners, validation
    ownership, submit timing stay in each popup.
  - Instrument tweak: **in-scope**.
- **Codex withdrew** (measurement contradicted its claims):
  - `DappApprovalLayout`: direct template diffs measure 0.33–0.39 similarity and the
    largest shared block (13 lines) IS the already-shared `DappStatusStrip`+`DappIdentityBlock`
    opening. Residual structure too small for a four-slot abstraction. **Leave.**
  - Wallet-panel merge: templates 0.61 / 53 differing non-blank lines, DIVERGENT testid
    sets (`bridgeL2*` vs plain), WalletPanel-exclusive states (no-wallet CTA,
    setting-up/capability testids). A merged component's config surface ≈ the duplication
    removed. **Leave.**

## Decision

Four items, one PR, behavior-preserving, testids verbatim, tests inline:

1. Migrate `import.vue`, `profile/new.vue`, `settings/security/change-password.vue`,
   `settings/security/reset.vue` onto `SecretExportLayout` (generalized as needed); page
   content stays in slots; composite tests extended.
2. New L3 `ListStatusMessage`; migrate the matching empty/no-results sites.
3. New L4 shared contact form-fields component consumed by both contact popups
   (template only; scripts untouched).
4. `scripts/dup-trend/report.ts`: production per-format split; html-format clones demoted
   out of the actionable top-pairs table; raw headline unchanged for trend continuity.

**Recorded LEAVE** (with the evidence above): whole-page template shells; approval
windows; `BridgeForm↔FuelForm`; the faucet wallet panels; the remaining 39–47L two-site
CSS pairs.
