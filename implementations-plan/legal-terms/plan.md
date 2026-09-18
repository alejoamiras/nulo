---
plan: legal-terms
tier: mid            # owner override; rubric read 2 HIGH (blast radius, security sensitivity)
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 2 agents · foreign reviewer /codex high · fable leg on Fable 5.1
---

# legal-terms — publish the Terms, record acceptance, ship the notices

Closes release blockers 1–3 of [`legal/README.md`](../../legal/README.md) and the missing
third-party attribution found while answering blocker 4. Read [`recon.md`](recon.md) first; the
design below is a consequence of its first section. The alternative shape and the fork-by-fork
reasoning are in [`competing-outline.md`](competing-outline.md).

## Success criterion

1. `nulo.sh/terms` and `nulo.sh/privacy` resolve, are generated from `legal/*.md` at build time, and
   every published version keeps a permalink.
2. A new install cannot create or import a profile without an unchecked-by-default "I agree" control
   being checked; the accepted versions and a timestamp are recorded on the device.
3. When a **material** version ships, the wallet asks again, lists what changed, and — if the user
   declines — refuses to send and refuses dApp requests while balances, history, recovery-material
   export and full-backup export keep working. Existing preview installs (no record) take the same
   path.
4. Settings → About shows what was accepted and when, and opens the third-party notices.
5. The extension zip contains `THIRD-PARTY-NOTICES.txt` covering exactly what is bundled, and the
   build fails on a licence outside the allowlist.
6. All of it is held by tests at the repo's existing bar: unit, component, smoke e2e, landing unit.

## Out of scope

- Any edit to the legal *text* beyond adding a machine-readable version line (owner + counsel).
- Filling the nine `«FILL»` placeholders; the Chrome trader-disclosure decision; a Spanish version.
- Tests pinning the privacy policy's factual claims (offered in Phase 0, not selected) → follow-up.
- The Presto MIT relicense itself (another session). **Arc C is blocked on it** — see Delivery.
- `apps/tools`, `packages/bridge-core` (being removed in another worktree), Firefox
  `data_collection_permissions` (another worktree).
- Storage migrations: pre-production rule applies; the new key simply joins the launch baseline.

## UI impact — owner sign-off required per surface

Mockups: the design canvas published in this session (boards `Gate`, `ReAccept`, `NotNow`,
`SettingsAbout`). "Approved" below means the owner approved that board in conversation; the
approval gate at the end of this plan asks for the quote to paste into the PR body.

| # | Surface | Before | After | Sign-off |
|---|---|---|---|---|
| U1 | `onboarding/terms` (new) | — | `Gate` board: "Before you start", four numbered risk points, one unchecked box, Continue disabled until checked, no step indicator | approved board |
| U2 | `onboarding/pages/welcome.vue` footer | "By continuing, you are confirming that you read and agree to…" | sentence removed; both CTAs route through U1 | **pending** — follows from U1 but changes copy |
| U3 | `popup/pages/register.vue` footer | same browsewrap sentence | replaced by plain "Terms of Use · Privacy Policy" links | **pending** |
| U4 | Popup re-acceptance sheet (new) | — | `ReAccept` board: version + effective date, numbered changes, "Read the full Terms ›", checkbox, Accept / Not now | approved board |
| U4b | Same sheet, no prior record (preview installs) | — | same layout; heading "Review the terms", body = the four risk points from U1, no "changed since" line | **pending** — variant not drawn |
| U5 | Declined screen (new) | — | `NotNow` board: "Your keys are still yours", ✓ balances/history, ✓ recovery material, ✓ full backup, ✗ send / approve, buttons Review · Export a backup | approved board |
| U6 | `popup/pages/send.vue` while not accepted | Send enabled | Send disabled + one-line banner "Accept the Terms to send" with a Review button | **pending** — implied by U5, not drawn |
| U7 | Settings → About, Legal group | two rows | `SettingsAbout` board: Terms, Privacy, "You accepted these — Terms v1.0 · Privacy v1.0 — date" + "Kept on this device…"; when not accepted the record row reads "Not accepted — Review" | approved board (+ **pending** for the not-accepted variant) |
| U8 | Settings → About, "Open-source licences" row (new) | — | one `SettingItem` opening the notices file in a tab | **pending** — decided after the mockups |
| U9 | `nulo.sh/terms`, `/privacy` | 404 | landing shell (header, `page.css` type scale), document body, version + effective date, "Previous versions" list; a DRAFT banner + `noindex` while any `«FILL»` survives | **pending** |

No pending surface is implemented until its sign-off is quoted in this file.

## Architecture

```
legal/*.md ──┐
             ├─► packages/legal (@nulo/legal)  manifest · status() · risk points · changes
legal/archive┘        │                │
                      ▼                ▼
        apps/landing prebuild      apps/extension
        Bun.markdown → HTML        UI: gate page · sheet · declined screen · About
        /terms /privacy            SW: assertLegalAcceptanceCurrent()
        /terms/v1.0/ …                  ├─ ExecutionService.executeTransfer
                                        ├─ ExecutionService.executeOperations
                                        └─ head of WalletSdkDispatcher guard ladder (injected)
```

**`@nulo/legal`** (new workspace package, no runtime deps, no `chrome.*`):
`manifest.ts` — hand-authored `{ terms, privacy }`, each a list of `{ version, effective, material,
changes: string[] }`, plus `RISK_POINTS` (the four lines of U1). `status.ts` —
`acceptanceStatus(record, manifest): "current" | "stale" | "missing"`; a record is current iff, for
both documents, its accepted `major.minor` ≥ the newest **material** version's `major.minor`; any
unparsable record is `missing`. `pendingChanges(record)` returns the `changes` of every material
version newer than the accepted one. `permalink(doc, version)`.

**Record.** `chrome.storage.local["nulo:legal:accepted"]` =
`{ termsVersion, privacyVersion, acceptedAt, surface: "onboarding" | "popup", history: [...] }`
(`history` append-only, capped at 20). Device-local, survives profile reset exactly like
`nulo:onboarding:completed`, never in a backup. UI writes through `@/utils/storage` via one helper,
`@/utils/legal-acceptance.ts`; the store exposes it the way `createOnboardingFlag()` does and listens
to `chrome.storage.onChanged` so the popup notices an acceptance made in the onboarding tab.

**Enforcement (service worker).** `wallet/services/legal/guard.ts` exports
`assertLegalAcceptanceCurrent()`: reads the key raw (SW context, allowlisted), no cache, and throws
`TermsAcceptanceRequiredError` (new, `@nulo/extension-messaging/errors`) unless status is `current`.
**Fail direction:** storage read error or corrupt record ⇒ throws ⇒ sending refused. It is called
first thing in `executeTransfer` and `executeOperations`, and is injected into `WalletSdkDispatcher`
as an optional `preDispatch` port invoked at the head of `enforceMethodAndScope` — `wallet-bridge`
learns nothing about storage or legal. While not accepted, **every** dispatcher method is refused;
`toWalletResponseError` maps the error to code `4100`, `walletErrorCode:
"TERMS_ACCEPTANCE_REQUIRED"`, message "Open Nulo and accept the Terms to continue."

**Why export cannot break:** the guard is reachable only from those three call sites; the session,
the router's auth gate and every export service are untouched. A structural test pins it (Phase 3).

**Links.** The extension opens the **versioned permalink** of the version compiled into it
(`nulo.sh/terms/v1.0/`), never bare `/terms` — otherwise a site updated ahead of the extension shows
text the user is not being asked to accept. One `openLegalDocument(doc)` helper replaces the three
duplicated `handleOpen` copies.

**Landing.** `scripts/build-legal.ts` (prebuild + predev, Bun runtime) reads `legal/*.md` and
`legal/archive/<doc>-<version>.md`, renders with the built-in `Bun.markdown.html` (verified on the
pinned 1.4 line: GFM tables render; raw HTML passes through, so the script **rejects any `<` tag in
source**), wraps in a shared template, and writes `terms.html`, `privacy.html`,
`terms/v<version>/index.html`, … as gitignored generated entries. `vite.config.ts` gains
`rollupOptions.input` computed from the manifest. `sitemap.xml` gains the two canonical URLs.
No inline script (CSP is `script-src 'self'`).

**Notices.** A Vite plugin in the shared extension config, `generateBundle` hook: map every module
id Rollup actually bundled to its owning `package.json` (walk up from the resolved file), add an
explicit `EXTRA_PACKAGES` list for assets emitted outside the module graph (the bb wasm, the
sqlite3mc wasm), collect `{ name, version, license, licence text, NOTICE text }`, emit
`THIRD-PARTY-NOTICES.txt` via `this.emitFile({ fileName })`. Build **fails** on a licence outside
`ALLOWED` (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0, Unlicense,
BlueOak-1.0.0, MPL-2.0) or on a package with neither a licence file nor an SPDX id we hold a
template for. Pure core in `scripts/third-party-notices/` with its own tests; the plugin is a shell.

## Phases

Each phase ends green on its gates before the next starts. `G-base` = `bun run lint` +
`bun run typecheck:all`.

### Arc A — source of truth + published pages

**P1 · `@nulo/legal`.** Create the package; add `version:`/`effective:` front-matter lines to
`legal/terms.md` and `legal/privacy.md` (the only text edit); create `legal/archive/` with a README.
Tests: status truth table (current / patch-newer / minor-newer / major-newer / missing / garbage /
one doc stale); `pendingChanges` accumulates across skipped versions; **manifest ↔ markdown pin** —
front-matter version equals the manifest head, every manifest version has a row in the doc's
`## Version history` table, every non-head version has an archive file, every material version has
≥ 1 change. Add `"license": "Apache-2.0"` to every workspace `package.json`.
Gates: `G-base`, `bun run --cwd packages/legal test`.

**P2 · landing pages.** `build-legal.ts`, template, multi-entry config, sitemap, `.gitignore`.
Tests (`apps/landing/scripts/build-legal.test.ts`): headings get stable anchor ids; tables survive;
source containing a raw tag is rejected; `«FILL»` ⇒ DRAFT banner + `noindex`, none ⇒ neither; one
output per manifest version; canonical link per page; output contains no `<script`. 
Gates: `G-base`, `bun run --cwd apps/landing test`, `bun run --cwd apps/landing build` then assert
`dist/terms.html`, `dist/privacy.html`, `dist/terms/v1.0/index.html` exist. Manual: `vite preview`,
confirm the CSP header and that `/terms/v1.0/` resolves (a dotted path segment is the one thing
to eyeball on a Cloudflare preview deploy before merge).

### Arc B — acceptance in the extension

**P3 · record + enforcement (no UI).** `legal-acceptance.ts` helper + store wiring; `guard.ts`;
the error class + envelope mapping; the three call sites; dispatcher `preDispatch` port.
Tests: helper writes the compiled versions and appends history; guard — current passes, stale /
missing / corrupt / storage-throws all refuse; envelope maps to `4100` + code and leaks nothing else;
dispatcher — `preDispatch` runs before `assertKnownMethod`, a refusal reaches no handler, absence of
the port changes nothing (existing `dispatcher.test.ts` stays green untouched); `ExecutionService` —
both entry points refuse before `captureFence()`. **Structural pin:** a test that greps
`settings/security/export/*.vue` and the backup service graph for `legal/guard` and
`TermsAcceptanceRequiredError` and expects zero hits.
Gates: `G-base`, `bun run test`.

**P4 · onboarding gate (U1, U2).** `onboarding/components/LegalConsent.vue` — the four points,
checkbox, links; emits `accept`. It is a component, not page logic, because onboarding *pages* carry
no tests here and components do. `onboarding/pages/terms.vue` is a thin shell:
`?next=create|import`, writes the record, `router.push`. `welcome.vue` CTAs route to it. An
onboarding `router.beforeEach` sends `create`/`import` to `terms` when status ≠ current, so editing
the hash does not skip it. No `StepIndicator` on the gate ⇒ **no renumbering**.
Component tests (≥ 10): unchecked by default; Continue disabled then enabled; `accept` not emitted
while unchecked (click and Enter); Space/Enter toggle the box; `tabindex="0"`, never positive; links
call the open handler with the permalink and do not toggle the box; four points render from
`RISK_POINTS`; testids present.
Gates: `G-base`, `bun run test:components`, `bun run test`.

**P5 · popup sheet, declined screen, send (U3–U6).** `components/legal/LegalAcceptanceSheet.vue`
(cross-shell location per the layer rules), mounted in `popup/app.vue` beside the two barriers but
**dismissible**, shown once per popup session when status ≠ current and the user is logged in, never
on `popup-auth` / `popup-register` / passkey windows. "Not now" → `/popup/legal/declined` (U5).
`send.vue`: `isAllowedToSend` gains the status term; banner + Review button. `register.vue` footer.
Component tests (≥ 10 for the sheet): both variants (changes list vs risk points); cumulative
changes; Accept disabled until checked; `accept` / `dismiss` events; not rendered when current;
declined screen's two buttons route correctly.
Gates: `G-base`, `bun run test:components`, `bun run test`, `bun run test:e2e` (must still be green
— this is where the fixture seed below lands).

**P6 · Settings → About (U7).** Record row, not-accepted variant, links via `openLegalDocument`.
Gates: `G-base`, `bun run test`.

**P7 · e2e.** Fixtures first: `launchExtension()` seeds a current record built from `@nulo/legal`
(never a literal — it must not go stale at the next version); `openOnboarding()` clears it alongside
`onboardingCompleted`; new `acceptOnboardingTerms(page)`; update the `onboarding-tab.test.ts` call
sites that click past Welcome and `gotoOnboardingImport()`.
New smoke spec `tests/e2e/legal-acceptance.test.ts`, testid-only:
1. fresh onboarding — `onboarding-terms-continue` disabled; check; continue; lands on create; the
   stored record carries the manifest's versions and a timestamp within the test window;
2. hash-jump to `#/onboarding/create` without acceptance lands on `#/onboarding/terms`;
3. About row text (the `profile-rename.test.ts` idiom) contains both versions;
4. seeded stale record → sheet appears → Not now → declined screen; Send is disabled; **seed export
   reveals the phrase** and **full-backup export produces a file**; balances render;
5. from 4, Review → accept → Send enabled; record's history has two entries;
6. no record + existing profile (the preview-install path) → the U4b variant → accept.
One network-suite test (proverless pool): connected playground, record made stale, a dApp call
rejects with `TERMS_ACCEPTANCE_REQUIRED`, accept, the same call succeeds. The smoke suite has no
dApp (verified: no playground in `global-setup-smoke.ts`), so this is the only end-to-end proof of
the dApp leg; dispatcher + envelope unit tests carry it otherwise.
Gates: `G-base`, `bun run test:e2e` ×2 consecutive green at `retry: 0` for the new spec,
`bun run e2e:agent tests/e2e/network/<new spec>`, `bun run audit:vue`.

### Arc C — third-party notices (blocked until the Presto MIT versions are in `bun.lock`)

**P8 · generator + policy.** Pure core + tests: owning-package resolution; dedupe by
`name@version`; licence-file discovery (`LICENSE*`, `LICENCE*`, `COPYING*`, `NOTICE*`); SPDX
expression handling (`(MIT OR Apache-2.0)` passes when any branch is allowed); disallowed and
missing both throw with the package named; deterministic ordering (byte-stable output).
**P9 · wire-up + About row (U8).** Plugin in the shared config; extend
`presto-core-deps.test.ts` to assert `license === "MIT"` for the three Presto packages; a build
assertion in `_build-extension.yml` that both zips contain the file and that it names
`@aztec/bb.js` and `vue` (a canary that the graph walk is not empty).
Gates: `G-base`, `bun run test`, `bun run build:chrome`, `bun run build:firefox`, `bun run
lint:actions`, `bun run test:ci-gating`.
If the lockfile still resolves AGPL Presto versions when Arc C is reached, the arc **waits**. The
policy check is not softened and no exception list is added: a notice file declaring AGPL for code
that is meant to be MIT would be a false statement inside the product.

## Security & adversarial considerations

- **What this gate is and is not.** It is a consent record, not an access control against the device
  owner: anyone who can write `chrome.storage.local` already owns the wallet. The threat is not
  bypass by the user; it is **lock-out caused by us**. Hence: enforcement touches three call sites
  and nothing session- or route-shaped; every failure mode of the guard blocks *sending only*.
- **Fail direction is asymmetric on purpose.** Corrupt/missing record ⇒ cannot send, can always
  view/export/re-accept. There is no state in which the guard can prevent acceptance itself: the
  sheet and the gate write the record without calling any guarded path.
- **dApp-facing oracle.** `TERMS_ACCEPTANCE_REQUIRED` tells any page that probes the wallet that the
  user has not accepted. That is one bit about the install, not about an account, and it is what
  makes the dApp able to tell the user what to do. Accepted; the refusal happens before method
  validation, so it discloses nothing about capabilities or accounts.
- **In-flight interactions across an update.** An interaction approved under v1.0 whose execution
  lands after a material v1.1 update is refused at `executeOperations`. Correct, and the reason the
  guard is in the service and not only in the UI.
- **Hostile input.** The record is parsed as untrusted (it can arrive via a tampered profile dir):
  shape-checked, versions regex-checked, anything else is `missing`. Nothing from it is rendered as
  HTML; the About row renders two version strings and a date through text interpolation.
- **Landing XSS / supply chain.** First-party markdown only; raw tags rejected at build; no inline
  script; CSP unchanged. No new dependency anywhere in the arc (`Bun.markdown` is built in; the
  notices generator is ours) — nothing to age-gate, nothing new to audit.
- **Logging.** The guard logs `{ operation, status }` at `debug`; never the record, never a URL.
- **Clickjacking / pre-checked consent.** The box is never pre-checked, never restored from state,
  and the component test pins it; `frame-ancestors 'none'` already covers the landing.
- **Evidence honesty.** The record proves a click on this device at a time the device reported. The
  Terms must not claim more; § 3 already says "recorded on your device."

## Assumptions and asks

- **Ask (UI):** sign-off for U2, U3, U4b, U6, U7's not-accepted variant, U8, U9.
- **Ask:** refusing **all** dApp methods while not accepted (not only approval-requiring ones). It
  is the smallest rule and the hardest to get wrong; the cost is that a connected dApp's read calls
  fail too until the user accepts.
- **Ask:** `/harden security` before the 1.0 store submission — recommended, not scheduled here.
- Assumed: I read "the checkbox for delta on license" as the re-acceptance checkbox on the
  terms-changed sheet (U4), not something on the third-party licence file.
- Assumed: Cloudflare serves `terms/v1.0/index.html` at `/terms/v1.0/`. Verified on a preview deploy
  in P2 before merge; fallback is `v1-0`.
- Follow-ups recorded, not done: privacy-claim pin tests; a Spanish Terms; a release-workflow check
  that refuses a stable publish while `«FILL»` survives; a rendered licences window.

## Deviation from the blueprint skill

Phase 0.75's plan-folder hygiene (gitignoring `audit-*.md`, `plan-*.md`, `eli5.html`; creating
`lessons.md` / `follow-ups.md` / `archive/`) is **not applied**. This repo commits those artifacts
by documented convention (`implementations-plan/README.md`), with several hundred tracked instances;
the project rule wins.

## Delivery

Three PRs into `dev`, stacked with `gh stack`: **A** `feat(landing): publish the terms and privacy
pages from legal/` → **B** `feat(legal): record terms acceptance and gate sending on it` → **C**
`feat(build): ship third-party notices in the extension`. A is independently mergeable and fixes
the three 404s on its own. B's PR body carries the quoted UI sign-offs and screenshots of U1, U4,
U5, U7. C opens only once unblocked. PR titles ≤ 93 chars. Merging is always the owner's call.

## Post-implementation

Per arc, before opening its PR: local gates green → `/codex high` adversarial review of the arc's
diff (brief: find a path where a user cannot export, a path where a send escapes the guard, a test
that passes for the wrong reason) → fix → repeat until clean, hard stop at 3 rounds (a 4th means the
scope is wrong; surface it). `/code-review` is **off** for this plan. Lessons go to
`implementations-plan/legal-terms/lessons/phase-N.md`; after three failures on one step, stop and
reassess. Update `CLAUDE.md` (the new package in the shared-code list; the e2e fixture seed),
`apps/extension/tests/e2e/README.md`, `legal/README.md` (blockers 1–3 closed) and
`implementations-plan/index.md` in the same PRs.
