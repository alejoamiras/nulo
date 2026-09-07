---
plan: chrome-store-launch
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 1 agent · codex high · code-review off
status: draft
---

# Chrome Web Store launch — the repo half

Everything the store submission needs that lives in the repo: the store name, a real icon set, the promo tile and screenshots, the listing copy and permission justifications, a privacy page on nulo.sh, and a working `publish-chrome-store` job. The account side (Google Workspace for `hello@nulo.sh`, the developer account and its $5 fee, 2FA, identity/trader declaration, the first manual unlisted upload, the OAuth client + refresh token) is a separate interactive session with the owner present; this plan produces every input that session consumes and the CI that runs after it.

Owner decisions taken in chat (2026-09-07): store title **Nulo V5** (V6 will be a second listing later); publisher identity is a Google Workspace account `hello@nulo.sh`; first upload is **Unlisted**; the CI publish stays **opt-in** (`publish_marketplaces=true`).

## Scope

**In**
- `apps/extension`: `displayName` → `Nulo V5`; generated icons `src/assets/icons/{16,32,48,128}.png` from the 512×512 source via `Bun.Image`, manifest `icons` map updated; `store/` directory with `listing.md` (title, summary, description, single-purpose statement, per-permission justifications, data-use disclosure answers), `promo-440x280.png`, `screenshot-{1..3}-1280x800.png`; `scripts/store-assets.ts` (icons + promo tile) and `scripts/store-screenshots.ts` (Puppeteer on the e2e fixtures, run locally, outputs committed).
- `apps/landing`: `privacy.html` at `/privacy` (multi-page Vite input), a footer link from the home page, sitemap entry.
- `scripts/release/publish-chrome-store.ts` (+ test) and `publish-chrome-store-run.ts`: token refresh, upload, publish (with `publishTarget` default/trustedTesters), dry-run; `release.yml` `publish-chrome-store` job body replaced; `CI.md` and `CLAUDE.md` § Release runbook updated (the "Known limitations" note and a "Marketplace publish" subsection).
- `apps/extension/README.md` file map for the new dirs.

**Out**
- Firefox/AMO (`gecko.id`, `publish-firefox-amo`): later plan.
- Any dashboard/account action, and the secrets themselves (owner pastes them into the `production` environment).
- The `nulo.sh/help/*` and `nulo.sh/forms/*` links the popup already points at (still 404 on the landing); noted as a follow-up, not a store blocker.

## Architecture & Implementation

**Store assets (`apps/extension/scripts/store-assets.ts`).** `Bun.Image` decodes `src/assets/logo.png` (512×512) and writes 16/32/48/128 PNGs into `src/assets/icons/`; it composes the 440×280 promo tile (bone ring mark centred on charcoal `#0a0908`, wordmark rendered by drawing the landing's ring + "NULO" text is not possible without a font rasteriser, so the tile is the mark alone on charcoal at 2× and downscaled — matching the favicon language). Idempotent; a `--check` flag fails when the committed files differ from a regeneration, run inside `apps/extension`'s `test` via a small vitest case so drift is caught.

**Screenshots (`apps/extension/scripts/store-screenshots.ts`).** Boots the built Chrome extension with `launchExtension` + `registerProfile` from `tests/e2e/fixtures/extension.ts`, opens the popup route, sets a 1280×800 viewport on a page that embeds the popup at 360×600 centred on the landing's charcoal with the section caption ("Private by default", "Send privately", "Apps have to ask"), and saves three PNGs. Local-only (needs a display-less Chrome, which the smoke fixtures already handle); not run in CI.

**Listing copy (`apps/extension/store/listing.md`).** Sections mirror the dashboard form so the interactive session is copy-paste: Title (`Nulo V5`, 45-char max), Summary (≤ 132 chars), Description, Category (Productivity → Developer Tools, or Finance), Language, Single purpose, Permission justifications (`storage`/`unlimitedStorage`: local wallet state; `offscreen`: runs the Aztec private execution environment off the popup; `alarms`: lock timer and balance refresh; `sidePanel`: the wallet as a side panel; `downloads`: user-initiated backup export; content script on `*://*/*`: the Aztec wallet-sdk discovery relay, no page DOM access; host `https://nulo.sh/`: WebAuthn passkey RP ID; `http://127.0.0.1/*`: local sandbox RPC), Remote code: No, Data use: collects no user data, the CoinGecko price query is a fixed id set (no user-specific data), privacy policy URL `https://nulo.sh/privacy`.

**Privacy page (`apps/landing/privacy.html`).** Same shell as the home page (bar, plates, footer; no feed), plain language, effective date, sections: what stays on your device, what leaves it (your chosen RPC node; the CoinGecko price query and how to turn it off), what we never collect, backups you export, passkeys, contact `hello@nulo.sh`, changes. Vite: `build.rollupOptions.input = { main: "index.html", privacy: "privacy.html" }`; the release plugin's token guard passes on a token-free page; `sitemap.xml` gains `/privacy`.

**Publish script.** `publish-chrome-store.ts` is pure: `buildRequests({clientId, clientSecret, refreshToken, extensionId, zipBytes, publishTarget})` returns the three requests (POST `oauth2.googleapis.com/token`, PUT `www.googleapis.com/upload/chromewebstore/v1.1/items/{id}`, POST `.../items/{id}/publish?publishTarget=`) and `interpret(uploadJson, publishJson)` maps `uploadState`/`status[]` to pass/fail (`SUCCESS`; `ITEM_PENDING_REVIEW` counts as success; anything else fails with the `itemError` text). `-run.ts` reads env (`CWS_*`, `VERSION`, `DRY_RUN`, `PUBLISH_TARGET`), fails loudly when any secret is empty, does the fetches, prints one summary line. Injectable `fetch` for the tests (token exchange, upload failure, in-review, dry-run makes no network call).

**Workflow.** `publish-chrome-store` keeps its gate and environment; the step becomes `bun scripts/release/publish-chrome-store-run.ts` with `env` from `secrets.CWS_*`, `VERSION` and `DRY_RUN` from `resolve`. `publishTarget` defaults to `trustedTesters` until the listing is public (a `workflow_dispatch` input `cws_target` with default `trustedTesters`).

**File-level change map.**

| Action | Path |
|---|---|
| modify | `apps/extension/package.json` (`displayName`), `manifest/manifest.config.ts` (icons map), `README.md` |
| add | `apps/extension/src/assets/icons/{16,32,48,128}.png`, `apps/extension/scripts/store-assets.ts`, `scripts/store-assets.test.ts`, `scripts/store-screenshots.ts`, `store/listing.md`, `store/promo-440x280.png`, `store/screenshot-{1,2,3}-1280x800.png` |
| add | `apps/landing/privacy.html`, `src/styles/privacy.css` (if the page needs more than `page.css`) |
| modify | `apps/landing/index.html` (footer link), `vite.config.ts` (inputs), `public/sitemap.xml`, `README.md` |
| add | `scripts/release/publish-chrome-store.ts`, `publish-chrome-store.test.ts`, `publish-chrome-store-run.ts` |
| modify | `.github/workflows/release.yml` (job body + `cws_target` input), `CI.md`, `CLAUDE.md` (Release runbook: marketplace subsection) |

**Trade-offs.** `chrome-webstore-upload-cli` would be ~10 lines of YAML but adds a third-party package holding the publish credential and hits the 7-day age gate; the REST surface is three calls and the repo already has the tested-runner pattern. Screenshots could be hand-made in a design tool; a script makes them reproducible when the popup changes. The promo tile is the bare mark rather than a wordmark because there is no font rasteriser in the toolchain; it matches the favicon and the store shows the title beside it.

## Phases

### Phase 1 — Icons, store name, promo tile
- `displayName: "Nulo V5"`; `store-assets.ts` generating icons + promo tile; manifest icons map; the `--check` vitest case.
- Assumptions: `Bun.Image` resize + PNG encode on Bun 1.4.0 (verified present as a function; the gate proves the API).

**Validation gate**
- Commands: `bun run --cwd apps/extension check:rp-id && bun run --cwd apps/extension typecheck && bun run --cwd apps/extension test -- scripts/store-assets && bun run lint && bun run --cwd apps/extension build:chrome`
- Pass: exit 0; `dist/chrome/manifest.json` `name` is `Nulo V5` and `icons` lists four distinct files; `file` reports the four PNGs at their sizes; `bun run --cwd apps/extension test:e2e` (smoke) green (the manifest name appears in e2e fixtures? verified by the run).
- Layers: typecheck · lint · unit · build · smoke e2e.

### Phase 2 — Listing copy + screenshots
- `store/listing.md`; `store-screenshots.ts`; three committed PNGs.
- Assumptions: the smoke fixtures boot headless Chrome on this host (they do for `test:e2e`).

**Validation gate**
- Commands: `bun run --cwd apps/extension build:chrome && bun apps/extension/scripts/store-screenshots.ts && bun run lint`
- Pass: exit 0; three 1280×800 PNGs (checked with `file`); every permission in `dist/chrome/manifest.json` has a justification paragraph in `listing.md` (a vitest case `store/listing.test.ts` asserts the set equality); summary ≤ 132 chars, title ≤ 45 (same test).
- Layers: lint · unit · build · manual look at the PNGs.

### Phase 3 — Privacy page
- `privacy.html`, footer link, Vite inputs, sitemap; copy from `SECURITY.md` facts in plain language.

**Validation gate**
- Commands: `bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint && bun run --cwd apps/landing build && ! grep -q '{{' apps/landing/dist/privacy.html && ! grep -q '{{' apps/landing/dist/index.html`
- Pass: exit 0; `dist/privacy.html` exists; `bun run --cwd apps/landing preview` + a Playwright load of `/privacy` under the real CSP with 0 console errors and the home footer link resolving; sitemap lists both URLs.
- Layers: typecheck · lint · unit · build · manual browser.

### Phase 4 — Publish script + workflow + docs
- `publish-chrome-store{,.test,-run}.ts`; `release.yml` job body + `cws_target` input; `CI.md` and `CLAUDE.md` runbook; `apps/extension/README.md`.

**Validation gate**
- Commands: `bun run test:release && bun run lint && bun run lint:actions && DRY_RUN=true CWS_CLIENT_ID=x CWS_CLIENT_SECRET=x CWS_REFRESH_TOKEN=x CWS_EXTENSION_ID=x VERSION=0.0.0 bun scripts/release/publish-chrome-store-run.ts`
- Pass: exit 0; the dry run prints the planned upload without a network call; a run with an empty secret exits 1 with `::error::`; actionlint clean.
- Layers: unit · lint · actionlint · dry-run.

## Security & Adversarial Considerations

- **The publish credential is the crown jewel.** `CWS_REFRESH_TOKEN` + client id/secret can push any code to every user. Kept in the `production` GitHub environment (reviewer-gated), consumed by one in-repo script with no third-party dependency, never printed (the runner logs status only), and the job stays opt-in per dispatch. Rotation: revoke the OAuth client in Cloud Console; the runner fails loudly on 401.
- **What gets published is the same zip attached to the GitHub Release** (`release-<v>` artifact), so the SHASUMS on the release are the checksums of what the store received.
- **Store review honesty.** Permission justifications match the manifest exactly (the listing test enforces set equality); "no remote code" is true (CSP `script-src 'self' 'wasm-unsafe-eval'`); the data-use answers match `SECURITY.md`; the privacy page discloses the CoinGecko query and the user-chosen RPC.
- **Privacy page** is static, same CSP, no forms, no scripts beyond the shared bundle.
- **Screenshots and fixtures** use the e2e fixture accounts, not real keys; the script runs locally only.
- **Supply chain**: no new packages. `Bun.Image` and `fetch` are runtime built-ins.
- **Renaming the extension** (`Nulo (V5)` → `Nulo V5`) changes no id, key, or storage; unpacked dev installs simply show the new name.

## Assumptions

**Facts**
1. `apps/extension/package.json#displayName` is `Nulo (V5)`; `manifest.config.ts` sets `name: displayName || name`, `version` from semver → 4 ints, `host_permissions: ["https://nulo.sh/", "http://127.0.0.1/*"]`, `permissions: [alarms, offscreen, storage, sidePanel, unlimitedStorage, downloads]`, content script on `*://*/*`.
2. `https://nulo.sh/` is the passkey RP ID; `scripts/check-rp-id.ts` fails the build if the manifest drops it (`SECURITY.md:24-40`; `build:chrome` runs `check:rp-id` first).
3. `src/assets/logo.png` is 512×512 RGB; the manifest points all four icon sizes at it.
4. `release.yml` `attach-assets` uploads `nulo-chrome-<v>.zip` as artifact `release-<v>`; `publish-chrome-store` (504–523) downloads it, is gated on `publish_marketplaces == 'true'`, uses `environment: production`, and its body is `exit 1`.
5. `Bun.Image` is a function on the pinned Bun 1.4.0; the `my-stack` skill lists it as the sharp/jimp replacement.
6. `apps/landing/vite.config.ts` has no `rollupOptions.input`; `release-html-plugin` runs on every HTML entry and only throws on the four known tokens.
7. `SECURITY.md` § External price feed: CoinGecko fixed-id query every ~3 min while unlocked and `showFiatValues` on (default, toggle in Settings → Appearance); § Storage privacy: master secret and guard AES-GCM encrypted, metadata plaintext in `chrome.storage.local`.
8. `tests/e2e/fixtures/extension.ts` exports `launchExtension`, `registerProfile`, `openPopup`; Puppeteer is a devDependency.
9. `bunfig.toml` `minimumReleaseAge = 604800`; CI installs `--frozen-lockfile`.

**Inferences**
- The Chrome Web Store API v1.1 endpoints and the `uploadState`/`status` shapes are as documented today (token: `https://oauth2.googleapis.com/token`; upload: PUT `https://www.googleapis.com/upload/chromewebstore/v1.1/items/{id}`; publish: POST `https://www.googleapis.com/chromewebstore/v1.1/items/{id}/publish`). The first real dispatch is the proof; the dry-run only proves the plumbing.
- The store accepts the release zip as-is (the folder is zipped at its root: `manifest.json` at top level; verified by `attach-assets`'s `cd dist/release/chrome && zip -r ../… .`).
- The listing category: "Productivity" is where most wallets sit; the owner can change it in the form.

**Asks** (defaults unless the owner objects at the gate)
1. Rename to `Nulo V5` now (before the first upload the name is free to change; after, the store shows whatever the uploaded manifest says). Default: yes.
2. Promo tile as the bare ring mark on charcoal (no wordmark). Default: yes.
3. First CI publish target `trustedTesters` until the listing is public. Default: yes.
4. `hello@nulo.sh` as the privacy page's contact. Default: yes.

## Post-implementation hardening

Not scheduled by this plan. Note for the release calendar: `/harden security` before the listing goes public (the store makes the wallet reachable by strangers; the README's "not audited" warning stays on the listing until then).

## Post-implementation

Executed by the implementing session from this file. `code_review` is `off`.

1. **Codex audit** (`/codex high`): net diff from `b47b9bf4`, this plan, `recon.md`, `audit-codex.md`; asks: adversarial review with the publish credential as the target (leak paths in logs, the dry-run, the workflow env), honesty of the listing and privacy copy against the code, the script's error handling; plus the two rules below.
2. **Iterative fix loop**: verify claims against the repo; fix; commit; log in `lessons/`; resume the same session; repeat until no material findings, stop and surface after 3 rounds.
3. **Delivery** below.

**No-over-engineering rule** (verbatim in every codex prompt): "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."

**Comment-quality rule** (verbatim in every codex prompt): "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."

## Delivery

Single arc, one PR `worktree-chrome-store-launch` → `dev`: `feat(store): chrome web store listing assets, privacy page, and publish job`. Touches `apps/extension/**` and `.github/workflows/**`, so smoke + network e2e and actionlint run. Diagnose reds before re-running. Merge is the owner's call. After merge, the interactive session: Workspace → developer account → manual unlisted upload of the next release zip (with the new name and icons) → OAuth client + refresh token → four secrets into `production` → first `workflow_dispatch` with `publish_marketplaces=true`, `cws_target=trustedTesters`.

## Audit — codex

_Pending._

## Seeds

Recommended: `/goal`.

```
/goal All four phases marked ✓ in implementations-plan/chrome-store-launch/plan.md, each ✓ backed by its validation gate reported passing in the transcript; `LESSONS_FILE=implementations-plan/chrome-store-launch/lessons/phase-N.md` printed for each phase; `/code-review` NOT run (code_review is off); the codex fix loop converged on the net diff, evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; one PR from worktree-chrome-store-launch to dev exists (`gh pr view` in the transcript), created only after the loop converged; `gh pr checks` reports every required check green in the transcript; `bun run test` and `bun run lint` both report exit 0 in the transcript.
```

Fallback: `/loop 15m` with the standard blueprint driver prompt, `<lint>` = `bun run lint`, `<test>` = `bun run test`.
