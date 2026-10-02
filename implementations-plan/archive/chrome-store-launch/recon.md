# Recon — chrome-store-launch

Base `b47b9bf4` (origin/dev, includes the On Camera landing). One explorer over seven capabilities plus targeted reads by the driver; the explorer had no shell, so its absence claims are path reads, and the driver re-checked the two that matter (`Bun.Image` exists on Bun 1.4.0; `logo.png` is 512×512 RGB).

## Reuse map

| Capability | Found | Verdict | Notes |
|---|---|---|---|
| Store name / description / version | `apps/extension/package.json` (`displayName: "Nulo (V5)"`, `description`), `manifest/manifest.config.ts` (semver → 4-int `version`, `version_name`) | **adapt** | The store item name IS the manifest `name`. Rename `displayName` to `Nulo V5` (owner's chosen title). |
| Icons | `icons` map points every size at `src/assets/logo.png` (512×512); ring-mark SVGs in `src/assets/logo.svg`, `public/logo.svg`, `apps/landing/public/favicon.svg` | **adapt** | Generate 16/32/48/128 PNGs with `Bun.Image` from the 512 source; point the map at them. Store also needs a 128×128 icon file, a 440×280 promo tile, 1280×800 screenshots — none exist. |
| Release zip | `release.yml` `attach-assets`: `nulo-chrome-<v>.zip` from `dist/release/chrome`, uploaded as artifact `release-<v>` and to the GitHub Release | **reuse-as-is** | The publish job already downloads this artifact. |
| Chrome Web Store publish | `release.yml` lines 504–523: `publish-chrome-store` job, `environment: production`, `if: publish_marketplaces == 'true'`, secret names `CWS_CLIENT_ID/SECRET/REFRESH_TOKEN/EXTENSION_ID`, body is `exit 1` stub | **adapt** | Replace the stub body; keep the gate, environment and names. |
| Upload tooling | none; `scripts/release/*-run.ts` pattern (`verify-live-run.ts`, `open-sync-pr-run.ts`) with unit-tested pure module + thin runner | **build new** (`scripts/release/publish-chrome-store{,-run}.ts`) | The CWS API is three calls (token refresh, PUT upload, POST publish). A fetch-based script avoids `chrome-webstore-upload-cli` (7-day `minimumReleaseAge`, lockfile diff, third-party code holding the publish credential). |
| Privacy facts | `SECURITY.md` § Storage privacy, § External price feed (CoinGecko fixed-id query every ~3 min while unlocked, off via Settings → Appearance), § RPC endpoint as user input; no analytics/telemetry SDK referenced | **reuse (facts)** | The policy states: keys/notes local, encrypted secret, plaintext metadata in `chrome.storage.local`, one user-chosen RPC, CoinGecko price query, no accounts, no tracking. |
| Store copy | none (grep for "Chrome Web Store", "single purpose", `CWS_` hits only the stub) | **build new** | `apps/extension/store/listing.md`. |
| Landing `/privacy` | `apps/landing/vite.config.ts` has no `rollupOptions.input`; `release-html-plugin` runs `transformIndexHtml` on every HTML entry (token-free page passes); `_headers` `/*` and `/*.html` rules apply automatically; `sitemap.xml` lists only `/` | **adapt** | Add `privacy.html` + `build.rollupOptions.input`; add the sitemap entry. |
| Screenshots | `apps/extension/tests/e2e/fixtures/extension.ts`: `launchExtension`, `registerProfile`, `openPopup`, `page.setViewport`; Puppeteer already a devDependency | **adapt** | A one-off `apps/extension/scripts/store-screenshots.ts` on those fixtures, output committed under `apps/extension/store/`. |
| Host permission `https://nulo.sh/` | `SECURITY.md:24-40`: the passkey RP ID binding, build-gated by `scripts/check-rp-id.ts` | **constraint** | Must stay; justified as WebAuthn RP ID. |
| Secrets convention | `refresh-landing` job: `environment: production`, fail-loud on an unset secret | **reuse-as-is** | |
| Firefox / AMO | `gecko.id: "{}"` placeholder, `publish-firefox-amo` stub | **out of scope** | Noted for a later plan. |

## Absence trail

- No store copy, privacy page, promo assets, screenshot script, or image tooling: explorer read `README.md`, `SECURITY.md`, `CI.md`, `.github/README.md`, `apps/extension/README.md`, the three `package.json`s, `bunfig.toml`; driver confirmed `Bun.Image` is a function on Bun 1.4.0.
- `bunx` in workflows: only `_lint-and-typecheck.yml` (renovate validator); release workflows call `bun scripts/…`.
