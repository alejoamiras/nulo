# Fable audit — legal-terms plan (round 1)

Fable 5.1 `Plan` subagent, read-only, weighted toward UI/reactivity, onboarding flow, layer rules,
test quality, landing generation and Terms-vs-mechanism consistency. Condensed from the hand-back;
every claim marked ✔ was re-verified by the driver before adjudication.

**Verdict: conditional-approve.** Shape A holds; two planned tests cannot fail, two claims about the
Terms are false, and the sheet and dispatcher mechanics are under-specified.

## H1 — The plan misstates the Terms and treats the Privacy Policy as accepted ✔
- "§ 3 already says 'recorded on your device'" — it does not. `legal/terms.md:83-85` only describes
  the control; the file's only "recorded" (`:144`) is about on-chain records.
- `legal/privacy.md` § 3 lists no acceptance record; the plan forbade text edits.
- `legal/terms.md:533-535`: accepting the Terms is not consent to processing. The plan still stores
  `privacyVersion` as accepted and blocks sending on a privacy bump. § 20 promises re-acceptance for
  the Terms only.
- § 3 names the literal labels "I agree to the Terms of Use" and "Continue"; the sheet says "Accept".
- Change: status from the Terms only; privacy stored as "shown"; pin both labels against `terms.md`;
  surface a privacy § 3 row and a "recorded on your device" clause to the owner.

## H2 — Smoke scenarios 4–5 pass for the wrong reason ✔
- `send.vue:232-239`: `isAllowedToSend` is already false on an empty form, and "Send enabled" needs a
  funded token the smoke suite lacks. Assert a `send-legal-banner` testid instead.
- `clickByTestId` clicks via `page.evaluate` → `target.click()`, so a covering sheet would not fail
  the export scenario. Assert the sheet is absent before driving export.
- Seed export is drivable (inlined at `tests/e2e/import-paths.test.ts:59-82` — extract it); full
  backup via `tests/e2e/helpers/backup-export.ts`. Do not reuse `agree-continue-btn`
  (`seed.vue:177`); prefix new testids `legal-`.

## H3 — The `preDispatch` port is mis-specified ✔
- `enforceMethodAndScope` is synchronous (`packages/wallet-bridge/src/dispatcher.ts:673`); batch legs
  re-enter `dispatch()`, so N+1 reads; an optional port passes every test when forgotten.
- Change: drop the port; `await` the guard inside the `try` just before
  `wallet-sdk/background.ts:1082`. Same envelope, same cleanup, wallet-bridge untouched.
- Discovery and verify run outside the dispatcher, so "every method refused" is not the whole dApp
  surface. Say so.

## H4 — The sheet appears inside dApp windows; "once per popup session" is undefined ✔
- The barriers mount in `popup/app.vue:418-419`, which hosts every `windows-*` route. "Not now" →
  `router.push` unmounts an approval window mid-request. Each window is a new app instance, so an
  in-memory flag means "every open".
- Change: suppress on `windows-*` (precedent `app.vue:381`); persist dismissal in
  `chrome.storage.session` keyed by Terms version; add a loading state; copy `MigrationBarrier`'s
  `eventTouched` ordering guard; z-index below `GlobalLoader`'s 9999.

## M5 — Onboarding gate hole
`onboarding/app.vue:59-63` routes an existing-profile user to `/onboarding/learn`; a guard on only
`create`/`import` lets them reach `done.vue` with no record. Guard by allowlist (`welcome`, `terms`
open); validate `next` as an enum. The "popup notices onboarding-tab acceptance" rationale is
unreachable (the popup closes itself with no profile); the real multi-instance case is two popups.

## M6 — Layer placement and store pins ✔
`components/legal/` is not a layer. One pure L3 `components/composite/LegalConsent.vue` (≥ 10 tests,
shared by the gate and the no-record sheet); store-bound `components/LegalAcceptanceSheet.vue` beside
the barriers (3–4 tests); `popup/pages/legal/declined.vue`; thin `onboarding/pages/terms.vue`.
Growing `app.store` breaks `stores/app.store.shape.pins.test.ts` — use a composable or list the pin
update.

## M7 — Landing generation ✔
`---` front matter renders as `<hr/><h2>` — parse line 3 instead (also removes the only text edit).
Heading ids need `{ headings: { ids: true } }`. `](privacy.md)` ×3 and `](terms.md)` ×2 are emitted
verbatim and 404 — rewrite. `prebuild`/`predev` are single slots — chain with `&&`. `Bun.markdown`
fails typecheck without Bun types. CI does not build the landing; assert `typeof Bun.markdown?.html`
and add a landing build to CI.

## M8 — The structural grep pin proves nothing
Invert it: assert the set of files referencing the guard equals exactly the intended call sites.

## L9 — Trimming
Fold scenario 6 into 4; assert "no executor reached" rather than "before `captureFence()`"; handle a
null `effective` date while `«FILL»` survives; refused dApp polls will log at `Error`
(`background.ts:~1095`) — downgrade.

## Checked and fine
Profile reset leaves the key (nothing calls `storage.local.clear()`); the fixture seed location;
`OnboardingBackLink`; router-before-Pinia with an async `beforeEach`; `extension-messaging`
importability; `_headers` + CSP; the `profile-rename.test.ts` idiom.
