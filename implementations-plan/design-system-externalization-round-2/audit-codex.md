# Codex audit transcript — design-system-externalization round 2

Codex (cross-family, xhigh) authored one of the three independent plans, then ran the
contradiction-check + adversarial audit on the consolidated plan. Paths rewritten repo-relative.

## Round 0 — codex as an independent planner (corrections it surfaced)

Codex was the most repo-accurate of the three planners. Verified corrections it contributed:

- Faucet surface is **10 live `<AppButton>` tags / 6 files**, not 25 (brief) or 26 (Opus planner).
- Spinner is a **primitive-wide swap: 11 `<Spinner>` sites / 10 files** + faucet ×2 (not just
  Banner/LoadingState). Named the non-obvious consumers (GlobalLoader, OperationCard, TokenCard,
  TokenImportRow, SettingItem, TransactionAwaitingCard).
- `sanitizeString` has **service-layer callers** (`useContactImportExport`, `useFullBackupImport`,
  `wallet/services/contact/service`) → must NOT move into a UI package; package gets an internal copy.
- `SubPageHeader` has **3 explicit page importers** (`journal/[id]`, `tx/[id]`, `tokens/[id]`) → a
  pure resolver move would miss them; the local wrapper handles it.
- Both shells also declare `#dropdown` (5 teleport roots total).
- `DripButton` (package composite) imports `AppButton` → keep AppButton as a compat alias.

Codex's governing contribution: **"only add a name to the resolver when its extension-local file is
deleted; wrapper-backed names stay local"** — adopted as D-SEAM.

## Round 1 — contradiction-check + adversarial audit of the consolidated plan

**Verdict: `reject`** (blocking: Button base/wrapper contract internally inconsistent; "dead link" /
storybook cause treated as facts; boundary tripwire too weak as the main XSS control).

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C-1 | Critical | Button decision contradicts itself: a plain-`<button>`-only base cannot render the live `link`/anchor path while the wrapper stays "thin"; `link` is still public (`Button.stories.ts:76`, `Button.test.ts:59-66`). | **ADOPTED** → D-F1: base gets a CLOSED `tag:"button"\|"a"` anchor mode (+ href/rel), no arbitrary component; wrapper keeps `link`→href. |
| C-2 | High | Story relocation over-generalized — wrapper-backed primitives (Button `link`, SubPageHeader router, ToastManager shell) have wrapper-only behavior; moving their stories drops it. | **ADOPTED** → D-F8: SPLIT — base/presentational stories→package, wrapper/integration stories stay in extension. |
| C-3 | High | "link is DEAD" + storybook root cause asserted as facts (literal grep misses spread-bound; cause unproven pre-reproduction). | **ADOPTED** → demoted to Inferences; base anchor mode moots link-dead for correctness; storybook = reproduce-then-diagnose. |
| C-4 | Medium | `boundary.test.ts` regex ban is mostly theatre as the MAIN XSS control (misses render-fn sinks, helper indirection, JSX domProps). | **ADOPTED** → D-SEC: reframed as belt-and-suspenders; primary control = API design (no HTML-string props) + review. |
| C-5 | Medium | The `micro`-listed-twice Button bug-pin is STALE — `Button.vue:64` lists `micro` once. | **ADOPTED + VERIFIED** → bug-pin REMOVED (Opus planner had hallucinated it; I'd propagated it). |
| C-6 | Medium | `useToast` count + `export *` surfacing are shaky; use explicit named re-exports day one. | **ADOPTED** → D-F4 mandates explicit named re-exports (and the hostile audit then corrected the whole consumer model — see audit-fable.md C1). |
| C-7 | Low | Resolver integrity: typecheck catches missing exports, not a malicious valid remap. | **ADOPTED** → D-SEAM resolver-inventory test (exact mappings + wrapper exclusion). |

Codex confirmed solid: D-F6 (Spinner superset), D-F5 (sanitizeString internal + extension util
stays), D-F9 (rule-presence parity guard).

## Round 2 — final fresh-context pass (NEW session)

**Verdict: `conditional approve`** — conditions: resolve the `AppButton`/`DripButton` contradiction;
redefine the resolver-inventory test around deleted-local-SFC names (not package exports); preserve
legacy `Button.link` RouterLink semantics in the wrapper rather than degrading to a plain `href`.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| F-1 | High | P4 is incoherent on AppButton: keeps it as a compat alias because DripButton depends on it, yet P4 also says "Update DripButton off AppButton." DripButton relies on `variant="outline"` + `data-loading` (pinned `DripButton.test.ts:48,53`), live in faucet `TokenCard.vue:196`. | **ADOPTED + VERIFIED** → D-APPBTN: DripButton stays on AppButton; AppButton stays LIVE; only the faucet's 10 direct tags migrate; "update DripButton off AppButton" removed from P4; round-3 retires both. |
| F-2 | High | D-F1 leaves `link` underspecified: mapping `link`→plain `href` is NOT equivalent to the current `RouterLink`+`to` (SPA) contract; "dead by grep" doesn't make degrading it safe. | **ADOPTED** → D-F1: wrapper preserves RouterLink semantics (RouterLink custom → `tag="a"` + `@click=navigate`); plain `href` only for explicit non-router anchors; call-site audit = confirmation only. |
| F-3 | Medium | Resolver-inventory test too broad: `NULO_DESIGN_COMPONENTS` ≠ "package exports without a local wrapper" — the package also exports names the extension keeps LOCAL + service-bound (`AddressDisplay`, `EmojiGrid`). | **ADOPTED + VERIFIED** → D-SEAM: invariant = exactly the component names whose extension-local SFC was deleted and must now resolve via `@nulo/design` (maintained migration set). |

**Confirmed solid by final codex:** D-F4 (`.js` file-path shims match the generated type surface;
named re-exports correct; deleting `toast.d.ts` safe — `ToastOptions` unreferenced), D-F8 (alias-
normalization hypothesis matches; P1/P6-only `build-storybook` gate acceptable as a tooling-only gap
provided P6 keeps it mandatory), and the 6-PR sequence is independently shippable without stranding the
other app between merges.

All three conditions folded into `plan.md` → effective verdict: **approved (conditions met)**.
