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
design below is a consequence of its first section. The alternative shape is in
[`competing-outline.md`](competing-outline.md); round-1 audits and their adjudication are in
[`audit-codex.md`](audit-codex.md), [`audit-fable.md`](audit-fable.md) and
[`decisions.md`](decisions.md). **This is revision 2** — Codex rejected revision 1 over a confirmed
broadcast path outside the guards; the fix is the first item under Architecture.

## Success criterion

1. `nulo.sh/terms` and `nulo.sh/privacy` resolve, are generated from `legal/*.md` at build time, and
   every published version keeps a permalink.
2. A new install cannot create or import a profile without selecting an unchecked-by-default
   "I agree to the Terms of Use" control; the accepted version and a timestamp are recorded on the
   device. (An install that already holds a profile — a preview build — is caught by 3 instead.)
3. When a **material** Terms version ships, or no record exists, the wallet asks, lists what changed,
   and — if the user declines — **broadcasts no transaction and serves no dApp request**, while
   balances, history, recovery-phrase export, account export and full-backup export (password and
   passkey) keep working.
4. Settings → About shows what was accepted and when, and opens the third-party notices.
5. The extension zip contains `THIRD-PARTY-NOTICES.txt` covering every package with a rendered
   module in any emitted chunk plus a reviewed list of vendored code, and the build fails on a
   licence outside the allowlist.
6. All of it is held by tests at the repo's existing bar: unit, component, smoke e2e, landing unit.

## Out of scope

- Filling the nine `«FILL»` placeholders; the Chrome trader-disclosure decision; a Spanish version.
- Tests pinning the privacy policy's factual claims (offered in Phase 0, not selected) → follow-up.
- The Presto MIT relicense itself (another session), and upstream licence metadata for
  `@aztec/sqlite3mc-wasm`. **Arc C is blocked on both** — see Delivery.
- `apps/tools`, `packages/bridge-core` (being removed elsewhere), Firefox
  `data_collection_permissions` (another worktree).
- Storage migrations: pre-production rule applies; the new key joins the launch baseline.

## UI impact — owner sign-off required per surface

Mockups: the design canvas published in this session (boards `Gate`, `ReAccept`, `NotNow`,
`SettingsAbout`). No pending surface is implemented until its sign-off is quoted in this file.

| # | Surface | Before | After | Sign-off |
|---|---|---|---|---|
| U1 | `onboarding/terms` (new) | — | `Gate` board, with **one copy change forced by the Terms themselves**: the checkbox reads "I understand the four points above, and **I agree to the Terms of Use**." with a separate line "The Privacy Policy explains what leaves your device." The board's "…and the Privacy Policy" contradicts Terms § 23 (acceptance is not processing consent) and § 3's literal label | **re-opened** |
| U2 | `onboarding/pages/welcome.vue` footer | browsewrap sentence | removed; both CTAs route through U1 | **pending** |
| U3 | `popup/pages/register.vue` footer | same sentence | plain "Terms of Use · Privacy Policy" links | **pending** |
| U4 | Popup re-acceptance sheet (new) | — | `ReAccept` board; primary button reads **Continue** (Terms § 3's label), not "Accept and continue" | approved board + **pending** label change |
| U4b | Same sheet, no prior record | — | heading "Review the terms", body = the four risk points, same checkbox | **pending** |
| U5 | Declined screen (new) | — | `NotNow` board | approved board |
| U6 | `popup/pages/send.vue` while not accepted | — | one-line banner "Accept the Terms to send" + Review button; fee estimation paused | **pending** |
| U7 | Settings → About, Legal group | two rows | `SettingsAbout` board, reworded to match the mechanism: "You accepted the Terms — v1.0 — date"; Privacy shown as "Privacy Policy v1.0"; not-accepted variant "Not accepted — Review"; a non-blocking "Privacy Policy updated" notice on a privacy-only change | approved board + **pending** rewording/variants |
| U8 | Settings → About, "Open-source licences" row (new) | — | one `SettingItem` opening the notices file in a tab | **pending** |
| U9 | `nulo.sh/terms`, `/privacy` | 404 | landing shell, document body, version + effective date, "Previous versions"; DRAFT banner + `noindex` while any `«FILL»` survives | **pending** |

## Architecture

```
legal/*.md ──┐
             ├─► packages/legal (@nulo/legal)  manifest · status() · risk points · changes
legal/archive┘        │                │
                      ▼                ▼
        apps/landing prebuild      apps/extension
        Bun.markdown → HTML        UI ──client──► LegalAcceptanceService (SW, sole writer)
        /terms /privacy                                  │ assertCurrent()
        /terms/v1.0/ …                                   ▼
                          THE WALL   ExecutionCoordinator.sendTxTask   (only node.sendTx in src/wallet)
                          early      executeTransfer · executeOperations · executeSendTransaction
                          dApp       background.ts before dispatcher.dispatch · pending-discovery handler
```

**The wall is at broadcast.** Revision 1 guarded the entry points it had found; Codex found a third
(`AuthRegistryService` → `executeSendTransaction`, `auth-registry/service.ts:283, :337`). Every path
— wallet send, dApp send, authwit revoke, registry toggle — converges on
`ExecutionCoordinator.sendTxTask` (`execution/execution-coordinator.ts:281-292`), the only
`node.sendTx` under `src/wallet`. The guard is awaited there **before** `assertLive()`: that
method's documented invariant forbids any await between the liveness check and the send. Guards at
the three `ExecutionService` entry points remain as *early refusals* so nobody proves for minutes and
then gets refused; they are not what makes the property true. A test pins that `node.sendTx(` occurs
exactly once under `src/wallet` and that, inside `sendTxTask`, the guard call precedes `assertLive()`
which precedes the send — ordering, not mere presence.

**`@nulo/legal`** (new leaf package; no runtime deps, no `chrome.*`). `manifest.ts` — hand-authored
per document: `{ version, effective: string | null, material, changes: string[] }[]`, plus
`RISK_POINTS`. Invariants, all tested: versions strictly increase; a **material version always bumps
minor or major** (so `major.minor` comparison can never swallow a material patch); every material
version has ≥ 1 change. `status.ts` — `acceptanceStatus(record): "current" | "stale" | "missing"`
from **the Terms only** (Terms § 20 promises re-acceptance for the Terms; § 23 says acceptance is not
privacy consent). An accepted version *newer* than the manifest (extension downgrade) is `current`.
Unparsable ⇒ `missing`. `pendingChanges(record)` accumulates across skipped versions.
`permalink(doc, version)`. The current version is **parsed from line 3 of each markdown file** by the
package's tests and the landing build — no front matter, no plumbing edit to the legal text.

**Record.** `chrome.storage.local["nulo:legal:accepted"]` = `{ termsVersion, privacyVersionShown,
acceptedAt, surface, history }`; `history` is the last 20 entries. Device-local, survives profile
reset, never in a backup. `acceptedAt` is informational: nothing orders or expires by it.

**`LegalAcceptanceService`** (service worker, `wallet/services/legal/`): the **sole writer**.
`accept(surface)` runs under the service lock, stamps versions from its own compiled manifest, never
replaces a newer accepted version with an older one, awaits the storage write before resolving, and
emits `onAcceptanceChanged`. `getStatus()`, `assertCurrent()` (throws `TermsAcceptanceRequiredError`,
new in `@nulo/extension-messaging/errors`; storage failure or corrupt record ⇒ throws). No cache.
The UI holds a client through one C1 composable, `useLegalAcceptance(client)`: it **subscribes
before it reads**, stamps each read with a sequence number and drops a read that resolves after a
newer event (the ordering `MigrationBarrier.vue:59` already documents), re-reads on client
reconnect, and exposes `dispose()` for the parent. Status starts `"loading"`, so neither the sheet
nor the banner flashes. Nothing is added to `app.store`
(its shape is pinned by `stores/app.store.shape.pins.test.ts`).

**dApp side.** `await legal.assertCurrent()` inside the existing `try`, immediately before
`dispatcher.dispatch(...)` at `wallet-sdk/background.ts:1082` — one read per top-level request, the
existing catch maps it through `toWalletResponseError` (code `4100`, `walletErrorCode:
"TERMS_ACCEPTANCE_REQUIRED"`, "Open Nulo and accept the Terms to continue."), and
`packages/wallet-bridge` is untouched. **New** discovery sessions are refused at the
pending-discovery handler; an *existing* session keeps transport-level discovery, which moves
nothing and is what lets the dApp receive the typed error. Refusals log `{ operation, status }` at
`debug`.

**Sheet placement.** `LegalAcceptanceSheet` mounts in `popup/app.vue`, z-index below
`GlobalLoader`'s 9999 so both barriers win. It renders only when status ∈ {stale, missing}, the user
is logged in, and the route is **not** `windows-*` (each dApp/passkey window is its own app
instance, and navigating one away abandons its request), `popup-auth`, `popup-register`,
`/popup/legal/*`, or `/popup/settings/security/export/*`. "Not now" writes
`chrome.storage.session["nulo:legal:dismissed"] = <termsVersion>` — once per browser session — then
routes to the declined screen. The export pages therefore cannot be covered by construction, which
matters most for passkey full backup: its WebAuthn ceremony runs **in-page** (`full.vue:147`).

**Links.** The extension opens the **versioned permalink** of the version compiled into it, never
bare `/terms`. One `openLegalDocument(doc)` helper replaces the three duplicated `handleOpen` copies.

**Landing.** `scripts/build-legal.ts`, chained into the existing single `prebuild` / `predev` slots
with `&&`. It asserts `typeof Bun.markdown?.html === "function"` (Cloudflare's Bun is pinned by a
dashboard variable, not by the repo), rejects any raw tag in source, renders with
`{ headings: { ids: true } }`, rewrites `](terms.md)` / `](privacy.md)` to site paths, and writes
gitignored `terms.html`, `privacy.html`, `terms/v<version>/index.html`, …; `vite.config.ts` gains a
computed `rollupOptions.input`; `sitemap.xml` gains the two canonical URLs; the landing tsconfig
gains Bun types. **The landing has never been built in CI** — `quality-status` gains a landing
test + build job so the first real build is not production.

**Notices** (`packages/third-party-notices`, a workspace package so `test:all` runs its tests; the
Vite plugin is a thin shell registered for the main build **and** worker builds). Input is the
**rendered** module set of each emitted chunk (`chunk.modules`), not every loaded module. Each module
maps to its owning `package.json`; a reviewed `VENDORED` list covers what no module walk can see —
third-party code embedded inside a package (the Buffer shim carries `base64-js` and `ieee754`) and
assets emitted outside the graph (the bb and sqlite3mc wasm) — each with a source URL. SPDX
expressions are evaluated properly (`OR`: any branch allowed; `AND`: every branch allowed).
`ALLOWED` = MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0, Unlicense,
BlueOak-1.0.0, MPL-2.0, **Zlib** (`pako` is `(MIT AND Zlib)`). A package with no licence metadata
needs a hand-verified `OVERRIDES` entry with provenance; the generator never synthesises a copyright
line. Output is byte-stable. Build fails on anything disallowed, missing, or unreviewed.

## Phases

`G-base` = `bun run lint` + `bun run typecheck:all`. `bun run test` is the extension's full unit +
component run (`test:components` filters `src/components` only and would miss onboarding).

### Arc A — source of truth + published pages

**P1 · `@nulo/legal`.** Package, manifest, status, `legal/archive/` + README, `"license":
"Apache-2.0"` on every workspace `package.json` this arc may touch (not `apps/tools` or
`packages/bridge-core` — out of bounds for wallet work and being removed), CI path filters gain `packages/legal/**` and
`legal/**`. Tests: status truth table (current / patch-newer / minor-newer / major-newer / accepted
newer than manifest / missing / garbage); manifest invariants above; **manifest ↔ markdown pin** —
line-3 version equals the manifest head, every version has a `## Version history` row, every non-head
version has an archive file; **label pin** — the literal strings "I agree to the Terms of Use" and
"Continue" exported by the package appear verbatim in `legal/terms.md` § 3.
Gates: `G-base`, `bun run --cwd packages/legal test`, `bun run test:ci-gating`.

**P2 · landing pages + CI.** Tests (`apps/landing/scripts/build-legal.test.ts`): heading ids stable;
tables survive; raw tag rejected; `.md` links rewritten (no `href` ending `.md` in output);
`«FILL»` ⇒ DRAFT + `noindex`, and a null `effective` renders as "not yet effective"; one output per
manifest version; canonical per page; no `<script`.
Gates: `G-base`, `bun run --cwd apps/landing test`, `bun run --cwd apps/landing build` + assert the
three outputs exist, `bun run lint:actions`. Manual before merge: a Cloudflare preview deploy
resolves `/terms/v1.0/` (documented to work for folder indexes; fallback `v1-0`).

### Arc B — acceptance in the extension

**P3 · service, wall, fixtures (no UI).** `LegalAcceptanceService` + client; the error + envelope
mapping; the guard at `sendTxTask`, the three early refusals, `background.ts`, the discovery handler.
**Fixtures land here**, because this is the commit that first breaks every existing caller:
`launchExtension({ legal = "current" })` seeds a record built from `@nulo/legal` (never a literal),
accepts `"missing" | "stale" | "corrupt"`, and honours the choice across relaunch; unit/composition
harnesses get a current record by default.
Tests: service — sole-writer serialisation (two concurrent `accept()` ⇒ two history entries); never
downgrades; resolves only after the write; `assertCurrent` refuses on stale / missing / corrupt /
storage-throws. Wall — a legal fake that **admits at the entry points and refuses only at broadcast**
(otherwise the early refusals mask the wall): `node.sendTx` is never called, the task and journal
settle as failed, the controller/slot is released and no transaction record is written, for each of
transfer, dApp send, **authwit revoke and registry toggle**. Liveness — hold the legal read, end the
session, resolve the read as current: `assertLive()` still prevents the send. Separately, early
refusals reach no executor. Envelope — `4100` + code, nothing else leaks. Background — a refused request never
reaches `dispatch`; a batch costs one read. **Structural pins:** `node.sendTx(` occurs once under
`src/wallet`; the set of files referencing `assertCurrent` equals the intended list exactly.
Gates: `G-base`, `bun run test`, `bun run test:e2e` (proves the seed keeps the suite green).

**P4 · onboarding gate (U1, U2).** `components/composite/LegalConsent.vue` — L3, props-only: points,
label, link handler; emits `accept`. `onboarding/pages/terms.vue` is a thin shell (`next` validated
as `"create" | "import"`), awaits `legal.accept("onboarding")` before `router.push`. Onboarding
`beforeEach` is an **allowlist**: `welcome` and `terms` are open, every other route needs a current
record — which also closes the `hydrateKnownProfile()` → `/learn` path. No `StepIndicator` on the
gate ⇒ no renumbering. Update `openOnboarding()` callers that click past Welcome,
`gotoOnboardingImport()`, add `acceptOnboardingTerms(page)`.
Component tests (≥ 10, written once, serving U1 and U4b): unchecked by default and never restored;
Continue disabled → enabled; no `accept` while unchecked (click and Enter); Space/Enter toggle;
`tabindex="0"`; links call the handler with the permalink and do not toggle; points render from
props; label equals the package constant; `legal-*` testids.
Gates: `G-base`, `bun run test`, `bun run test:e2e`.

**P5 · popup sheet, declined screen, send (U3–U6).** `components/LegalAcceptanceSheet.vue`
(store/route-bound, beside the barriers; 4 tests: variant choice, events, route suppression list,
nothing while `"loading"`); `composables/useLegalAcceptance.ts` with its ≥ 10 cases (loading →
resolved, subscribe-before-read, stale read dropped, event after read, reconnect refresh, accept
resolves after write, accept failure surfaces, dispose unsubscribes, double dispose, error ⇒ not
current); `popup/pages/legal/declined.vue`; `send.vue` banner + estimation pause;
`register.vue` footer. Gates: `G-base`, `bun run test`, `bun run test:e2e`.

**P6 · Settings → About (U7).** Gates: `G-base`, `bun run test`.

**P7 · e2e.** New smoke spec `tests/e2e/legal-acceptance.test.ts`, testid-only; **lock-out proofs
use hit-tested pointer clicks** (`page.mouse` at the element's centre), because `clickByTestId`
dispatches `target.click()` and would click through a covering sheet. Extract the seed-export flow
inlined at `import-paths.test.ts:59-82` into a helper; full backup via `helpers/backup-export.ts`.
1. fresh onboarding — `legal-consent-continue` disabled; check; continue; lands on create; stored
   record carries the manifest's Terms version;
2. hash-jump to `#/onboarding/create` and to `#/onboarding/learn` without a record ⇒ `#/onboarding/terms`;
3. About row text (the `profile-rename.test.ts` idiom) contains the accepted version;
4. `legal: "missing"` + existing profile ⇒ sheet (U4b) ⇒ Not now ⇒ declined screen;
   `send-legal-banner` present; `legal-sheet` absent on the export routes; **seed export reveals the
   phrase, account export and full backup produce files**; balances render; relaunch ⇒ still declined;
5. the export block of 4 repeated under `legal: "corrupt"` and `legal: "stale"` — one parametrised
   body, three record states; the fail-closed direction must still leave export working;
6. passkey profile (virtual authenticator, as `passkey-backup.test.ts`), `legal: "stale"`, declined:
   full backup completes its in-page ceremony and produces a file;
7. from 4: Review ⇒ Continue ⇒ `send-legal-banner` absent; history has one entry.
Only the *wording* of a change list is left to component tests (it needs a second manifest version,
which a smoke run cannot inject without a production seam); stale **reachability** is proven above. One network-suite test, proverless pool:
connected playground, `legal: "stale"`, a dApp call rejects with `TERMS_ACCEPTANCE_REQUIRED` and a
wallet-UI send is refused; accept; both succeed.
Gates: `G-base`, new smoke spec green twice consecutively at `retry: 0`, `bun run test:e2e`,
`NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/<new spec>` (the runner rejects a
proverless-marked spec without it), `bun run audit:vue`.

### Arc C — third-party notices (blocked)

Blocked until (a) the Presto MIT versions are in `bun.lock` and (b) `@aztec/sqlite3mc-wasm`'s
provenance is established well enough to write an honest `OVERRIDES` entry. Neither the policy nor
the allowlist is softened to unblock it.

**P8 · generator + policy.** Tests: rendered-module extraction from a fixture bundle (a tree-shaken
module is excluded); owning-package resolution; dedupe; licence-file discovery; SPDX `OR` / `AND` /
nested; disallowed, missing and un-overridden all throw naming the package; `VENDORED` entries
require a source URL; byte-stable output.
**P9 · wire-up + About row (U8).** Plugin in main and worker builds; `packages/third-party-notices/**`
added to the extension and Firefox build path filters in `pr-quick.yml`, so a generator-only change
still runs the zip-content assertions; extend
`presto-core-deps.test.ts` to assert `license === "MIT"` for the three Presto packages;
`_build-extension.yml` asserts both zips contain the file and that its package set is a superset of a
checked-in expected-minimum list (a two-name canary proves almost nothing).
Gates: `G-base`, `bun run test:all`, `bun run build:chrome`, `bun run build:firefox`,
`bun run lint:actions`, `bun run test:ci-gating`.

## Security & adversarial considerations

- **What this gate is.** A consent record, not an access control against the device owner. The
  threats are (1) **lock-out caused by us** and (2) **a broadcast that escapes**. (1) is answered by
  never touching the session and by structurally excluding the sheet from export routes; (2) by
  putting the wall on the single broadcast line and pinning that it stays single.
- **Fail direction is asymmetric.** Corrupt / missing / unreadable ⇒ no broadcast, no dApp service;
  view, export and *accepting* always work — `accept()` calls no guarded path.
- **In-flight work across an update.** An interaction approved under v1.0 that reaches broadcast after
  a material update is refused at the wall. That is the case only a service-side wall catches.
- **dApp-facing oracle.** `TERMS_ACCEPTANCE_REQUIRED` leaks one bit about the install, before any
  method or capability validation. Accepted: it is what lets a dApp tell the user what to do.
- **Hostile input.** The record is shape- and regex-checked; anything else is `missing`. Only version
  strings and a date are rendered, via text interpolation.
- **Landing.** First-party markdown, raw tags rejected, no inline script, CSP unchanged.
  **No new dependency anywhere in this plan.**
- **Logging.** `{ operation, status }` at `debug`; never the record, never a URL.
- **Consent hygiene.** Never pre-checked, never restored; labels pinned to the Terms' own wording.
- **Evidence honesty.** The record proves a click on this device at a time the device reported. The
  documents must say so and no more — see the first Ask.

## Assumptions and asks

- **Ask (text):** add to Terms § 3 one sentence — acceptance is recorded on your device with the
  version and time — and to privacy § 3 one storage-table row for that record. Without them the
  product does something the documents do not describe.
- **Ask (UI):** U1's checkbox copy, U2, U3, U4's button label, U4b, U6, U7's rewording and variants,
  U8, U9.
- **Ask:** while declined, **every** broadcast is refused, including protective ones (revoking an
  authwit, disabling the auth registry). One rule that cannot be got wrong; the user is never trapped
  because export always works. Alternative: allowlist those two operations at the wall.
- **Ask:** every dispatcher method is refused while declined, reads included.
- **Ask:** `/harden security` before the 1.0 store submission — recommended, not scheduled here.
- Assumed: "the checkbox for delta on license" = the re-acceptance checkbox on the terms-changed
  sheet (U4).
- Follow-ups, not done here: privacy-claim pin tests; a Spanish Terms; a release-workflow check that
  refuses a stable publish while `«FILL»` survives; a rendered licences window; opening the wallet
  automatically when a dApp is refused.

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
U5, U7. C opens only once both of its blockers clear. PR titles ≤ 93 chars. Merging is always the owner's call.

## Post-implementation

Per arc, before opening its PR: local gates green → `/codex high` adversarial review of the arc's
diff (brief: find a path where a user cannot export, a broadcast that escapes the wall, a test
that passes for the wrong reason) → fix → repeat until clean, hard stop at 3 rounds (a 4th means the
scope is wrong; surface it). `/code-review` is **off** for this plan. Lessons go to
`implementations-plan/legal-terms/lessons/phase-N.md`; after three failures on one step, stop and
reassess. Update `CLAUDE.md` (the new package in the shared-code list; the e2e fixture seed),
`apps/extension/tests/e2e/README.md`, `legal/README.md` (blockers 1–3 closed) and
`implementations-plan/index.md` in the same PRs.
