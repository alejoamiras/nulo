# Plan — Design-system externalization (round 1: ambitious L0–L2 takeover, supervised)

- **Tier:** deep (3 parallel plans + double audit + final pass + a targeted re-validation of the
  takeover). Final shape below folds every adopted finding.
- **Scope (round 1):** L0 tokens **+ the canonical base/theme/font takeover** + L1 core (4) + a
  verified-safe subset of L2 (5) → into the existing `@nulo/design`. **9 components + the base takeover.**
- **HARD INVARIANT:** the extension renders **identically** to today (light AND dark, nav AND
  no-nav, chrome AND firefox). Proven by cheap machine checks + a **human visual sign-off** (§2.0).
- **EXECUTION MODE: SUPERVISED.** Not AFK. The takeover phase (Phase 2) **pauses for the user's
  visual confirmation** before it is marked ✓; component phases are machine-gated and may run
  between sign-offs. This is what makes the ambitious takeover safe without a visual-regression
  harness — the user's eyes are the gate for the global-CSS change.
- **Status:** approved (ambitious, supervised); finalizing seeds → handoff.
- **Inputs:** [`brief.md`](./brief.md) · [`audit-codex.md`](./audit-codex.md) ·
  [`audit-fable.md`](./audit-fable.md) (incl. the takeover-review rejects that shaped this design).

---

## 0. How we got to "ambitious + supervised" (decision trail)

- Gate: A1 → **ambitious**, A3 → **fix look-preservingly**, A4 → **no new screenshot infra**,
  end-goal → **extension looks identical**.
- Targeted re-validation of the ambitious-AFK design: **codex + fresh-Opus both `reject`** — the
  full takeover has **no machine look-same gate that works in this repo** for an unattended run
  (jsdom can't resolve CSS vars; smoke asserts nothing visual; a token baseline is blind to the
  app-wide non-token globals; `_base.scss` can't be dropped while the app depends on it; crxjs font
  path unverified).
- Resolution (user): keep the ambitious takeover but run it **supervised** — the user's eyes replace
  the unbuildable AFK visual gate — AND **relocate-don't-drop** the globals (below), which removes
  the structural regressions the reviewers found. The harness is unnecessary in this model.

---

## 2.0 HARD INVARIANT — extension renders identically (machine checks + human sign-off)

The takeover changes the wallet's global CSS, so its proof is **human + machine**, not machine-only:
- **Machine (cheap, real, in-repo):** (a) byte-pin — regenerate `tokens.ts` from `contract.ts`,
  assert identical; (b) **textual value-equivalence** — the generated package `base.css` reproduces
  the extension's pre-takeover `_base.scss` + `_text.scss` output (token declarations + every
  non-token global rule), checked via postcss/text diff with a CSS-value normalizer (no browser
  needed because it's a faithful port, not a re-derivation); (c) build **chrome AND firefox**; (d) a
  **font-load assertion** against the built artifact (fetch each hashed font URL → 200); (e) the
  existing smoke suite (no crash / testids); (f) component style-snapshots (Phases 3–4, jsdom-fine).
- **Human (the supervised gate, Phase 2):** the user opens the **extension in chrome AND firefox**,
  toggles **light AND dark**, with **and without** the bottom nav, clicks through key screens
  (send/receive/activity/settings), AND opens the **faucet** — confirming both apps look identical.
  Phase 2 is **not** marked ✓ until the user signs off. A final visual confirmation repeats at Phase 5.

The "relocate-don't-drop" design (§2.2) is what makes the machine value-equivalence check possible:
because the package `base.css` is a *faithful port* of the extension's current global CSS, equality
is checkable textually; the human gate covers cascade-order/font/rendering nuances a text diff can't.

---

## 1. Goal & non-goals

**Goal.** Make `@nulo/design` the **single canonical source** for Nulo's tokens (names + values +
themes + fonts) AND the wallet's base stylesheet, plus the framework-/host-agnostic L1/L2
primitives — both apps consume it, the extension renders identically — establishing the foundation
(single-source codegen, the relocated global stylesheet, explicit-import discipline, resolver,
fidelity tests, CI wiring) for round 2+.

**Definition of done (round 1).**
- ONE base stylesheet + token source: `@nulo/design` owns the contract → generated `tokens.ts` +
  `base.css` (faithful superset of the extension's `_base.scss`+`_text.scss`: dark + light/dark
  themes + `data-has-nav` + all vars + all non-token globals + bundled fonts). Extension imports it
  and deletes its local `_base.scss`/`_text.scss`; faucet inherits the superset.
- `@nulo/design` exports L1 (`Flex`, `Icon`, `Text`, `MaterialIcon`) + 5 L2 (`Badge`,
  `BrutalistTitle`, `Checkbox`, `SectionLabel`, `Toggle`), each explicit-import + self-contained,
  testids unchanged, latent bugs fixed look-preservingly.
- Machine checks (§2.0) green + **the user's visual sign-off recorded** (Phase 2 + Phase 5).
- CI watches `packages/design/**`; `@nulo/design` has a README + internal layer enforcement.

**Non-goals / round-2 backlog.**
- Router/state holdouts: `Button`, `SubPageHeader`, `ToastManager`.
- `Spinner` reconciliation + `Banner`, `LoadingState`.
- Host-coupled: `Tooltip`, `Popover`, `Input`.
- Faucet `AppButton`→`Button` + `Spinner` dedup.
- Eventually *removing* the relocated global utility classes from the package once the WHOLE
  component library is self-contained (many rounds away — round 1 keeps them).
- Any appearance-changing "fix" (§2.7). L3 / L4+ / playground / landing.

---

## 2. Target architecture

### 2.1 Package layout & explicit-import rule
```
packages/design/
  package.json   # exports += "./core", "./core/*", "./ui"
  README.md      # NEW
  fonts/         # NEW: every font the extension uses (woff2 + the Material Symbols + JetBrains/etc.)
  tokens/contract.ts     # SINGLE SOURCE (authored FROM the extension's current tokens)
  scripts/gen-tokens.ts  # contract.ts -> committed src/tokens.ts + the token blocks of src/base.css
  src/
    index.ts · tokens.ts (GEN) · base.css (token blocks GEN + non-token globals ported verbatim)
    tokens.drift.test.ts · base.parity.test.ts   # byte-pin + value-equivalence vs pre-takeover
    test/mount-all.test.ts   # mounts + exercises (events/branches, un-stubbed) every migrated SFC
    core/  Flex Icon Text MaterialIcon (+ .test.ts)
    internal/  icons.json · colorVar.ts
    ui/   existing 5 + Badge BrutalistTitle Checkbox SectionLabel Toggle (+ .test.ts)
    composite/  L3 — unchanged
```
**Every `core/`+`ui/` SFC uses explicit `import { … } from "vue"` + explicit child + helper imports**
(consumers — faucet, package vitest — have no auto-import).

### 2.2 Single source + base/theme/font takeover — RELOCATE, don't drop (Decision D1)

Canonical: `tokens/contract.ts`, authored **from the extension's current `_base.scss` + `tokens.ts`
as the source of truth** (per-theme values, `data-has-nav` state, all ext vars incl. `--purple`;
preserves `cssVar`'s `(name, fallback?)` signature). The package `base.css` =
**a faithful port of the extension's ENTIRE base stylesheet**:
- **Token declarations** (`:root` dark + `[theme="light"]`/`[theme="dark"]` + `:root[data-has-nav]`)
  → generated from the contract.
- **Non-token globals carried VERBATIM** from `_base.scss` + `_text.scss`: the reset
  (`*{box-sizing}`), `*::-webkit-scrollbar`, `body` defaults (incl. `user-select:none`), `a`/`button`
  focus rules, **all 7 transition/keyframe families** (slide/slideopacity/fade/toast/opacity/
  navigation/dropdown), the `.material-symbols-outlined` class, and the `.fz--/.fw--/.lh--/.ta--/
  .color--/.fill--` utility classes. These stay because the un-migrated app depends on them
  app-wide — they are RELOCATED into the package, not removed.
- **Fonts bundled**: copy every font the extension uses into `packages/design/fonts/`; emit
  `@font-face` with **package-relative URLs**. ClashDisplay is confirmed dead (only its `@font-face`
  references it) → drop it. **Verify the crxjs path** (chrome + firefox MV3): the font-load assertion
  (§2.0 d) + the human gate confirm no production-only 404/FOUT.

**Consumption.** Extension imports `@nulo/design/base.css` at **`popup/index.ts` + `onboarding/index.ts`**
(NOT `setup/index.ts` — it imports no base today; leaving it untouched) and **deletes its
`_base.scss` + `_text.scss`**. Extension `@/design/tokens` → `export * from "@nulo/design"`. Faucet
keeps importing `@nulo/design/base.css` (now the superset; dark subset value-identical; the human
gate confirms the faucet too).

**Drift/parity guard:** `tokens.drift.test.ts` (byte-pin regen of `tokens.ts`) + `base.parity.test.ts`
(the package `base.css` reproduces the extension's pre-takeover `_base.scss`+`_text.scss` output —
token values AND non-token rules — via postcss + a CSS-value normalizer). A regen mismatch or a
ported-rule divergence fails CI.

### 2.3 Styling — self-contained, fidelity-pinned (Decision D4)
Migrated components stop using the (now-package-relocated) globals and become self-contained
(`<style scoped>` + `var(--token)`), incrementally:
- **`Text.vue`** → inline/scoped from token scales; **faithfully no-op** off-scale/named `size=`
  (~88 sites inherit) + literal-prop color bleeds; test matrix from grep'd real call sites.
- **`Icon.vue`** → `colorVar` instead of global `.fill--*`; **FIX `Icon.vue:72`** (`path.opacity` on
  undefined) + a test exercising that branch.
- **`Flex.vue`** → enums to scoped/inline; **pin `defineExpose({ wrapper })`**.
- **`MaterialIcon.vue`** → scoped `font-family` + the bundled font + per-instance variation axes +
  `colorVar`; no reliance on the global class (which still exists in the package base for the rest).
- **Proof:** component style-snapshots (jsdom-fine) + the branch-aware mount gate (§2.4) + smoke e2e.

### 2.4 Migration mechanic — resolver + explicit imports + branch-aware proof (D5, D3)
Resolver (app **+ `.storybook/main.ts`**) maps `@nulo/design` names → package (templates untouched,
testids preserved). Producer-side explicit imports. **`mount-all.test.ts`** mounts each migrated SFC
**un-stubbed children + exercises handlers + every `v-if`/`v-show` branch**, Vue resolve-warnings →
failures. Per-layer atomic flip + `components.d.ts` regen + template-tag audit. Rejected:
copy-then-delete; wrapper shims (break `defineExpose`).

### 2.5 Layer + boundary enforcement (D6)
Separate `core/**` ⊄ `../ui/*` + `ui/**`→`core`/tokens biome rules; keep the `src/**` floor
(no `@nulo/*`, no `chrome`) + chrome-indirection audit test + biome-floor meta-test.

### 2.6 CI wiring (D11)
Patch `pr-quick.yml:56`, `pr-smoke-e2e.yml:41` (watches only the OLD `extension/src/design/**`),
`pr-network-e2e.yml:40` to include `packages/design/**`.

### 2.7 Bug-fix policy (D4b)
**Fix:** `Icon.vue:72` (latent crash, look-preserving). **Ghost cleanup ONLY inside component
phases** where style-snapshots exist (NOT in Phase 2) — and NOT for `--nulo-error` (it has live CSS
fallback use in `TransactionTerminalCard.vue:94`; not globally dead). **Defer** any fix that would
change a snapshot or the human-verified appearance.

---

## 3. Phases

> Cheap layers EVERY phase: `typecheck:all` + `lint` + tests. Build at milestones. Smoke
> (light+dark) on move phases. Network e2e once (Phase 5).

### Phase 1 ✓ — Seam + single-source contract + drift + CI · MILESTONE (machine-only; AFK-fine)
Add dep + `./core`/`./ui` exports; author `contract.ts` (from the extension's current surface) +
`gen-tokens.ts`; generate `tokens.ts`; repoint extension tokens to re-export; add `tokens.drift.test.ts`;
biome rules + chrome-indirection + floor meta-test; patch the 3 CI workflows; README. No base switch,
no moves.
**Gate:** typecheck:all + lint + tests (byte-pin) + `build` + `build:faucet`.
**✓ COMPLETE** (branch `feat/design-system-p1-tokens`): typecheck:all green (12 pkgs) · lint exit 0 ·
tests green (design 69 · faucet 336 · extension 2398) · `build` + `build:faucet` green. Implemented
as `src/token-contract.ts` (+ `src/internal/render-tokens.ts`) per the package's `src/**`-only
tsconfig — see `lessons/phase-1.md`.

### Phase 2 ✓ — Base/theme/font takeover (RELOCATE) · MILESTONE · **SUPERVISED** — machine gate ✓, VISUAL SIGN-OFF ✓ (user, 2026-06-18: "no deltas") · PR #103
Port the extension's full `_base.scss`+`_text.scss` into the package `base.css` (tokens generated;
non-token globals verbatim); bundle fonts (package-relative, drop ClashDisplay); switch
`popup/index.ts` + `onboarding/index.ts` to import `@nulo/design/base.css`; delete extension
`_base.scss`+`_text.scss`. Leave `setup/index.ts` alone.
**Gate (machine):** typecheck:all + lint + `base.parity.test.ts` green + build **chrome + firefox** +
**font-load assertion** (each font 200) + smoke (no crash, light+dark).
**Gate (human — blocking):** user confirms extension (chrome+firefox, light+dark, nav+no-nav, key
screens) **and** faucet look identical. **Do NOT mark ✓ or proceed without this sign-off.**

### Phase 3 ✓ — L1 core (`Flex`, `Icon`, `Text`, `MaterialIcon`) · MILESTONE (machine-gated, done)
**✓ COMPLETE** (branch `feat/design-system-p3-core`): resolver migration validated (zero template
churn; `components.d.ts` → `@nulo/design`); typecheck:all + lint + design 101 + extension 2398 +
build chrome/firefox/faucet green; smoke isolated-clean (pre-existing FPC flake only). `build-storybook`
pre-broken (storybook+rolldown alias, identical on p2 — not a regression). See `lessons/phase-3.md`.
Co-migrate `icons.json` + `colorVar.ts`; rewrite self-contained + explicit imports + fidelity pins +
`Icon.vue:72` fix; mount-all gate; resolver (app+storybook) + atomic delete + d.ts regen +
template-tag audit; style-snapshots.
**Gate:** typecheck:all + lint + unit (mount-all + snapshots) + build + storybook + smoke (light+dark).

### Phase 4 ✓ — Pure L2 (`Badge`, `BrutalistTitle`, `Checkbox`, `SectionLabel`, `Toggle`) · MILESTONE (machine-gated, done)
**✓ COMPLETE** (branch `feat/design-system-p4-l2`): 5 components + tests moved via the resolver
(explicit child imports; orphaned stories repointed to `@nulo/design`); typecheck:all + lint + design
136 + extension 2398 + build chrome/firefox/faucet green; smoke 66/67 (pre-existing FPC flake only).
See `lessons/phase-4.md`.
Same mechanic. Ghost cleanup allowed here (snapshot-gated; not `--nulo-error`).
**Gate:** typecheck:all + lint + unit + build + build:faucet + storybook + smoke.

### Phase 5 ✓ — Cleanup, docs, round-2 backlog · MILESTONE · machine ✓, visual sign-off ✓ (2 + 5, user 2026-06-18) · network e2e → CI
**Machine ✓** (branch `feat/design-system-p5-cleanup`): CLAUDE.md L0–L6 split documented +
`round-2-backlog.md` + `bun run audit:vue` green (ext 2368 + design 138 · lint 0 · build 0). Visual
sign-off ✓ (user, 2026-06-18 — both apps, "no deltas"). Codex post-impl audit ✓ (no blocking; 2
Mediums folded in: Checkbox disabled-gating + base.css pin). Network e2e deferred to the
`pr-network-e2e` CI gate (watches `packages/design/**`). `/code-review max --fix` + final gates pending.
See `lessons/phase-5.md`.
Finalize resolver; update `ARCHITECTURE.md` + CLAUDE.md L0–L6 + README; write the round-2 backlog.
**Gate (machine):** `audit:vue` + build:faucet + smoke + `e2e:agent` (network ~25 min) + storybook.
**Gate (human):** final visual confirmation of both apps.

**PR strategy:** ~5 squash-merged PRs into `dev`. Phase 2's PR is the one that waits on visual sign-off.

---

## 4. Security & Adversarial Considerations
`@nulo/design` becomes load-bearing AND owns the wallet's entire base stylesheet + fonts → a hostile
`base.css`/`@font-face`/`url()` could exfiltrate or alter contrast. Guards: byte-pin + `base.parity`
(a hand-edit fails CI), package-relative font URLs only (no remote), biome floor + meta-test + chrome
indirection audit, no new runtime deps (assert per PR), the §2.6 CI patch (no silent-green for
design-only changes), and the human visual gate (contrast/legibility can't silently change). Auto-import
bypasses biome → template-tag audit + explicit imports + mount gate. No new tokens/secrets/privileges.

## 5. Assumptions
### Facts (verified) — as in prior revision, plus:
- `_base.scss` owns app-wide non-token globals (Material class `:226`, resets `:242`, transitions
  `:286`, utilities `:364` via `_text.scss`) consumed across `MaterialIcon/Popup/DropdownRoot/
  ToastManager/popup.app/ReceivePopup/FeeJuiceCard` → must be RELOCATED, not dropped.
- `--nav-clearance` varies under `:root[data-has-nav="true"]` (`_base.scss:10`) → contract + parity
  must include that state; human gate checks nav/no-nav.
- Build is crxjs chrome (`vite.chrome.config.mts`) + firefox → font path verified per-browser.
- `setup/index.ts:5` imports no base today → leave untouched.
- `--nulo-error` is NOT globally dead (`TransactionTerminalCard.vue:94`) → not a ghost to remove.
- jsdom can't resolve CSS-var cascade → the look-same proof is the human gate + textual parity, NOT
  a jsdom computed-style baseline.
### Inferences (attack)
- A faithful verbatim port makes `base.parity` a tractable text check + the human gate covers
  cascade/font nuance. *(Phase-2 human sign-off is the backstop.)*
- crxjs traces + emits package-relative fonts for both browsers. *(Font-load assertion + human gate.)*
### Asks — RESOLVED
- A1 → ambitious **supervised**; A3 → fix look-preservingly (component phases only); A4 → no harness;
  end-goal → human visual gate (§2.0); MaterialIcon → in scope; execution → supervised w/ Phase-2 pause.

## 6. Decision ledger (final)
| # | Decision | Chosen | Rejected/deferred | Source |
|---|----------|--------|-------------------|--------|
| D0 | Home | grow `@nulo/design` | split / new pkg | locked |
| D1 | Token+base | **single-source contract + base/theme/font takeover by RELOCATING the full `_base.scss`+`_text.scss` into the package (verbatim non-token globals + generated tokens + bundled fonts); extension imports + deletes its copies** | conservative defer (user chose ambitious); "shrink to near-empty" (breaks app-wide globals); AFK takeover (no working machine gate) | user (A1) + both takeover-review rejects |
| D2 | Scope | L1 Flex/Icon/Text/MaterialIcon + L2 Badge/BrutalistTitle/Checkbox/SectionLabel/Toggle (9) + the takeover | holdouts; Spinner+deps; host-coupled; faucet dedup | codex/Opus |
| D3 | Producer imports + proof | explicit imports + branch-aware un-stubbed mount gate | auto-import reliance; plain mount | both |
| D4 | Styling | self-contained + fidelity-pinned | "as-is"; inline `${size}px` | both |
| D4b | Bug-fix | fix `Icon.vue:72`; ghost cleanup only in component phases; NOT `--nulo-error` | bug-pin all; cleanup in Phase 2 | user (A3) + codex |
| D5 | Mechanic | resolver (app+storybook) + atomic per-layer flip | copy-delete; shims; batched | all 3 |
| D6 | Boundary | separate core/ui rules + chrome-indirection + floor meta-test | one rule; trust biome | both |
| D7 | Look-same gate | **machine (byte-pin + base.parity + chrome/firefox build + font-load + smoke + snapshots) + HUMAN visual sign-off (Phase 2 + 5)** | visual-regression harness (overkill; avoidable via supervision); jsdom token baseline (unimplementable) | user (supervised) + both rejects |
| D8 | Storybook | single extension host; stories move; glob + resolver mirrored | 2nd Storybook | both |
| D9 | Faucet | inherits the superset base; human gate confirms | assume identical | both |
| D10 | Sequencing | 5 phases; takeover Phase 2 (relocate makes early order safe); supervised pause there | AFK takeover | rejects |
| D11 | CI | explicit 3-workflow path-filter patch | "verify" | final pass |
| D12 | Execution | **SUPERVISED** (Phase 2 + 5 human gates); other phases machine-gated | AFK ambitious (unsafe) | user |

## 7. Audit verdicts
- Deep ceremony (conservative shape): codex `approve`, fresh-Opus `conditional approve` (adopted).
- Targeted re-validation of the ambitious-**AFK** takeover: codex `reject` + fresh-Opus `reject` —
  **resolved by the supervised model + relocate-don't-drop design** (D1/D7/D12): the rejects' core
  gap (no machine look-same gate for an unattended global-CSS rewrite) is closed by the human gate;
  the structural regressions (dropped globals, MaterialIcon, utilities) are closed by relocate-don't-drop;
  fonts + setup + `--nulo-error` findings folded. A re-audit of the supervised plan is **optional**
  (offered) — the human visual gate is the dominant safety control.

## 8. Seeds (finalized — supervised execution; Phase 2 + 5 pause for the user's visual sign-off)

**Recommended — `/goal`** (the human sign-off is a natural "condition not yet met" state; survives `--resume`):
```
/goal Round 1 of implementations-plan/design-system-externalization is complete: all 5 phases marked ✓ in plan.md (the per-phase headers in the file, not just chat), each ✓ backed by its phase's Validation gate reported passing in the transcript; for each phase the agent printed `LESSONS_FILE=implementations-plan/design-system-externalization/lessons/phase-N.md`. SUPERVISED: Phase 2 (base/theme/font takeover) and Phase 5 are NOT self-certifiable — after the MACHINE gate passes, STOP and explicitly request my visual sign-off (extension in chrome+firefox, light+dark, nav+no-nav, key screens + the faucet) and only mark those phases ✓ after I confirm in-session; machine-gated phases (1,3,4) proceed autonomously. The branch-aware un-stubbed mount-all gate + tokens.drift + base.parity + the font-load assertion are green; `/code-review max --fix` complete with findings applied and committed; codex post-impl audit complete with high/critical findings addressed; final `bun run audit:vue` AND `bun run test:e2e` AND `bun run e2e:agent` all report exit 0 in the transcript.
```

**Alternative — `/loop 15m`** (drives on an interval; same Phase 2/5 pause):
```
/loop 15m Drive implementations-plan/design-system-externalization (round 1, SUPERVISED). Never idle on machine-gated work. Each firing: (1) read plan.md + lessons/ (authoritative), `git status` + `git log --oneline -5`; PR? `gh pr view --json statusCheckRollup`. (2) CI in flight → confirm progress (`gh run watch` ≤10 min), use the wait to prep the next phase. (3) No task? take the next pending plan.md step; after each edit run `bun run lint` + touched-package tests; commit → push. (4) Stuck/decision? `/codex xhigh`, reach a defensible call, log in lessons; never merge to main, publish, or expand scope. (5) Same step failed 5× → stop, reassess with codex. (6) Phase green = its plan.md Validation gate passes — run it, paste output, mark ✓, file lessons, print `LESSONS_FILE=...`, advance. (7) Phase 2 (takeover) and Phase 5: after the MACHINE gate passes, STOP and request my visual sign-off (extension chrome+firefox, light+dark, nav+no-nav, key screens + faucet); do NOT mark ✓ or proceed until I confirm. (8) All phases ✓ → `/code-review max --fix` → commit → codex post-impl audit → address high/critical → wrap-up + round-2 backlog → stop. Keep an ASCII checklist visible.
```
