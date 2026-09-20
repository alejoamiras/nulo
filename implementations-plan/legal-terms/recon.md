# Recon — legal-terms

Read-only sweep of the code this arc touches, run before drafting. Two `Explore` agents (a batched
capability reuse sweep and a gating/e2e subsystem map), with every load-bearing claim re-verified
directly. Base: `dev` at `b0ebbb40` plus this worktree's seven `legal/` commits.

## The binding constraint, found first

**The existing "blocked state" precedent cannot be reused for the declined/re-acceptance state.**

`AccountIntegrityCoordinator` (`apps/extension/src/wallet/services/account-integrity/coordinator.ts`)
blocks by **withholding the session** — `verifyBeforeSessionOpen()` is called from inside
`ProfileService`'s facade lock at `openSessionVerified`, and the boot path calls
`lockProfileIfActive()`. Every screen this arc must keep reachable depends on that session being
open:

- all three export pages (`settings/security/export/{seed,full,account}.vue`) declare
  `meta.isAuthRequired: true`, so the route guard bounces them to `/popup/auth` without a session,
  and each then re-prompts the profile password inline;
- balance viewing needs `appStore.isLogined`.

So a session-layer block takes down exactly what the owner said must never be blocked. The gate has
to sit at the **execution and dispatch layer instead**, where — verified — it cannot touch export by
construction: none of the three export pages reference `ExecutionService`,
`DappInteractionService` or the wallet-sdk dispatcher. `full.vue` fans out across ~10 services for
read-only backup slices; none of them are those three.

This single finding is why the arc is shaped the way it is, and it is the first thing the audits
should attack.

## Reuse map

| Capability needed | What exists | Verdict |
|---|---|---|
| Multi-entry Vite build for `/terms` + `/privacy` | `apps/extension/vite.config.ts:311-318` — the only `rollupOptions.input` in the repo (4 HTML entries) | **reuse-as-is** (copy the shape into `apps/landing/vite.config.ts`) |
| Build-time substitution into HTML | `apps/landing/scripts/release-html-plugin.ts` — `enforce: "pre"`, `transformIndexHtml`, whitelisted token names, throws if one of **its own four** tokens survives | **adapt** |
| "prebuild script writes `src/generated/*.json`, plugin reads it in `buildStart`" | `apps/landing/scripts/fetch-latest-release.ts` + `ensure-release-json.ts` + `src/generated/.gitkeep` | **reuse-as-is** — this is where the document-version plumbing belongs |
| Device-local acceptance record | `createOnboardingFlag()`, `apps/extension/src/stores/app.store.ts:116-131` — flat `nulo:onboarding:completed` key, `storageLocalGet`/`storageLocalSet`, "cleared on profile reset" | **reuse-as-is** (same shape, new key) |
| Migration-aware storage facade | `apps/extension/src/utils/storage.ts` — `migrationIdle()`, `storageLocalGet/Set/Remove`; enforced by `storage-facade-ban.test.ts` (ALLOWLIST + service-client DENYLIST) | **reuse-as-is** |
| Generated file into `dist/` | two working precedents: `generateBundle` + `this.emitFile()` (the bb-wasm emitter, `apps/extension/vite.config.ts:185-227`) and `closeBundle` + `writeFileSync` (`apps/tools/vite.config.ts`) | **reuse-as-is** |
| Full-viewport blocking overlay | `BarrierOverlay.vue` rendered through `<Teleport to="body">` by `MigrationBarrier.vue` (mounted in **both** `popup/app.vue:418` and `onboarding/app.vue:89`) and `AccountIntegrityBarrier.vue` (popup only) | **adapt** |
| Open a packaged view in its own window | the Logs viewer, `settings/advanced/index.vue:33-53` — `chrome.runtime.getURL` + `windows.create` + window-id memoization so a second click refocuses | **adapt** |
| Typed refusal to a dApp | `toWalletResponseError()`, `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:35-181` — `instanceof` switch over `WalletError` subclasses → EIP-1193 `{code, message, data.walletErrorCode}`, unknown errors collapse to a constant string | **reuse-as-is** |
| Installed-package `license` drift guard | `apps/extension/src/presto/presto-core-deps.test.ts` — `createRequire` reads an installed `package.json` | **adapt** |
| Read a Settings row's rendered text in e2e | `apps/extension/tests/e2e/profile-rename.test.ts:15-19` — `waitForSelector` by testid, then read *that element's* `textContent` | **reuse-as-is** |
| **Markdown → HTML** | nothing | **build new** |
| **Dependency-licence collection** | nothing | **build new** |

## Integration points, precise

**Two execution entry points, not one.** `ExecutionService` exposes both as `public async`:
`executeTransfer()` (`apps/extension/src/wallet/services/execution/service.ts:455`, wallet-UI sends
→ `TransferExecutor`) and `executeOperations()` (:628, everything dApp-routed → `dispatchOperation`'s
per-kind switch). A gate on "sending" needs both call sites, or one shared guard both enter.

**One dApp ingress.** `WalletSdkDispatcher.dispatch()`
(`packages/wallet-bridge/src/dispatcher.ts:641-668`) is reached from exactly one place —
`apps/extension/src/wallet/services/wallet-sdk/background.ts:1082` — and already runs a fixed guard
ladder (`enforceMethodAndScope`, :673-725: `assertKnownMethod` → arg schema →
`assertAuthRelevantArgShape` → `enforceCapability` → `enforceScope`). A pre-handler check belongs at
the head of that ladder.

**Only one approval window can execute.** Under `apps/extension/src/popup/windows/` the dApp windows
are `execute/`, `discover/`, `capabilities/`, `verify/` — there is no `connect/` or `sign/` dir.
`discover` and `capabilities` approve via `interactionService.resolveInteraction(...)` (a consent
write); only `execute/index.vue`'s `approve()` (:480-538) reaches `executeOperations`. An uncovered
`aztec_createAuthWit` is routed through that same execute window
(`packages/wallet-bridge/src/dispatcher.ts:979-1020`).

**Onboarding has no step abstraction.** Order is
`welcome → {create | import} → learn → fees → presto → done`; routing is file-based via
`vite-plugin-pages` (`apps/extension/vite.config.ts:126-128`). Each page hardcodes its successor's
`router.push("/onboarding/<next>")`, and `StepIndicator.vue` holds a hardcoded 5-entry label array
with each page passing `:current="N"` as a literal (`learn`/`fees` pass `:step` through
`OnboardingExplainer`). Inserting a screen means editing the predecessor's push target and
renumbering every literal downstream — invisible to typecheck.

**`appStore.setOnboardingCompleted(true)` is called in exactly one place**:
`apps/extension/src/onboarding/pages/done.vue:23-26`.

**The three browsewrap sites** — `onboarding/pages/welcome.vue:55-60`,
`popup/pages/register.vue:71-77`, `popup/pages/settings/about.vue:92-95` — each carry an
independently duplicated `handleOpen` calling
`chrome.windows.create({ type: "popup", url: "https://nulo.sh/<target>" })`. Both URLs 404 today.
`popup/pages/profile/new.vue` — the create-profile form both `register.vue` and the lock-screen "add
profile" flow route into — has **no** terms text at all.

**The landing's own constraints.** `apps/landing/public/_headers` sets
`script-src 'self'` (no inline script) and `style-src 'self' 'unsafe-inline'`; `/*.html` is
`max-age=60, must-revalidate`. `public/sitemap.xml` and `public/robots.txt` exist, so new pages must
be added to the sitemap or they are uncrawlable. The landing already runs vitest
(`apps/landing/vitest.config.ts`) with three specs (`headers.test.ts`, `feed.test.ts`,
`release-resolver.test.ts`), so a landing unit test has a home.

**`legal/terms.md` has no machine-readable version.** The version is prose on line 3
(`**Version 1.0 — effective …**`) plus a `## Version history` table. Comparing a stored accepted
version against the current one needs new plumbing.

## What a new mandatory screen breaks

`launchExtension()` (`apps/extension/tests/e2e/fixtures/extension.ts`, ~:200) closes the first-run
onboarding tab and unconditionally seeds `chrome.storage.local["nulo:onboarding:completed"] = true`,
which is why almost the whole suite never sees the onboarding tab. Consequences:

| Helper | File | Drives | Breaks if… |
|---|---|---|---|
| `launchExtension()` | `tests/e2e/fixtures/extension.ts` ~:200 | storage-seeds past onboarding | never breaks — it is also the one line that can seed acceptance for the whole tree |
| `registerProfile()` | `tests/e2e/fixtures/extension.ts:277-314` | popup `register.vue` → `profile/new.vue` | the popup create path gains a terms step. 7 direct callers plus every composed fixture (`registeredExtension`, `localNetworkExtension`, `tokenReadyExtension`, `feeJuiceReadyExtension`, `feeJuiceImportedExtension`, all six `dappConnected*`, `setupConnectedPlayground()`) |
| `createAndActivateProfile()` | `tests/e2e/fixtures/helpers.ts:337-350` | lock-screen picker → `profile/new.vue` | acceptance is scoped **per profile** rather than per install |
| `openOnboarding()` | `tests/e2e/fixtures/extension.ts:213-272`, 8 call sites all in `onboarding-tab.test.ts` | the onboarding tab, welcome only | **always** — the new screen lands directly in its `click(onboarding-welcome-create)` → `waitForHash("#/onboarding/create")` pair |
| `gotoOnboardingImport()` | `tests/e2e/helpers/import-drivers.ts:167-173`, 1 caller (`onboarding-import.test.ts:24`) | the onboarding tab, welcome → import | **always** — same reason |

`import-paths.test.ts` drives the *popup* import shell and never visits `/onboarding/welcome`, so it
is unaffected. `security-reset.test.ts` pins that `onboardingCompleted` survives a profile reset —
so `register.vue` is reachable in production with onboarding permanently marked complete, which the
acceptance scoping must account for.

Smoke suite: `apps/extension/vitest.e2e.config.ts` — `include: tests/e2e/*.test.ts`,
`exclude: tests/e2e/network/**`, `pool: forks`, `fileParallelism: false`, `retry: 2`; 32 spec files.
Selectors are `data-testid` only; `clickByTestId` filters for enabled + visible + non-zero-size and
clicks via `page.evaluate`. `waitForToast` is the one text-as-selector exception and probes
`document.body.textContent` unscoped.

## Absence claims, with search trails

- **No markdown parser or renderer anywhere.** No `markdown-it`/`remark`/`marked`/`showdown`/
  `micromark`/`mdast`/`unified` in any `package.json`; one incidental `bun.lock` hit
  (`ts-command-line-args`'s own `write-markdown` bin name); no directory matching `*markdown*`; the
  ~18 source hits for `\.md` patterns are all prose comments naming a doc file, plus
  `scripts/dup-trend/report.ts:23`'s jscpd `--ignore` glob. A first-ever markdown dependency is
  subject to the 7-day `minimumReleaseAge` gate.
- **No licence tooling of any kind.** No `license-checker`/`licensee`/`spdx`/`oss-attribution`/
  `license-report`/`third-party-notice`/`NOTICE` in any `package.json`; the only `LICENSE*` file at
  depth ≤3 is the repo's own Apache-2.0.
- **No workspace `package.json` declares a `license` field** — root included — despite the repo
  being Apache-2.0. Worth fixing in this arc.
- **No precedent for opening a bare non-HTML packaged asset.** All 8 `chrome.runtime.getURL` call
  sites target a hash-routed page inside one of the four extension HTML bundles, or the offscreen
  document. `SettingItem`'s `to`/`external` pair renders `router-link` or `<a target=_blank>`; no
  `to=` value anywhere resolves to a packaged asset.
- **No third "interstitial route" convention.** The router's `lateDecision`
  (`apps/extension/src/popup/route-guard.ts:34-60`) already gates on `meta.isAuthRequired`, a
  missing active profile, and `meta.requirePasswordProfile` — but the two barriers are *not* router
  features at all; they are always-mounted overlay components reacting to raw storage.
- **No onboarding *page* has a colocated test.** All six onboarding tests are on
  `onboarding/components/*` (`OnboardingPage`, `OnboardingExplainer`, `OnboardingBackLink`,
  `OnboardingProfileNameField`, `OnboardingSkipLink`, `StepIndicator`), matching the documented
  L4–L6 carve-out. None use `createTestingPinia`; `popup/pages/auth.test.ts` is the nearest
  store-mounting example.
- **`vite-plugin-static-copy` is declared but dead** (`apps/extension/package.json:113`; zero source
  references, not pulled in transitively by `@crxjs/vite-plugin`). Do not assume it is the
  file-copy mechanism.

## Corrections to the sweep's own claims

- The sweep flagged that `releaseHtmlPlugin`'s `transformIndexHtml` would run against new legal
  entries "unfiltered." It does run against them, but the throw is scoped to its own four token
  names and its header explicitly disclaims ownership of `{{…}}` as a syntax. Not a hazard.
- The sweep listed `scripts/dup-trend/report.ts` as a dependency-graph walker. It is not; it only
  enumerates jscpd scan roots.

## Design forks this leaves open

Carried into the competing outline rather than settled here:

1. **Where the first-run gate lives** — a new onboarding page, a `meta.*` entry in the router's
   `lateDecision` ladder, or service-side.
2. **How acceptance is keyed** — one device-local key (matching `nulo:onboarding:completed`, and
   surviving profile reset) versus per-profile rows.
3. **How the material-change delta is authored** — hand-written per version, or derived from the
   `## Version history` table.
4. **Where the licence notices are rendered** — a bare packaged text file opened in a tab (no
   precedent in this repo) versus a hash-routed window in the popup bundle (the Logs-viewer shape).
5. **Whether the re-acceptance state blocks via an always-mounted overlay** (the `MigrationBarrier`
   shape) **or via per-action refusal** at the two execution entry points, or both.
