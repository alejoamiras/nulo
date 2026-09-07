---
plan: chrome-store-launch
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 1 agent · codex high · code-review off
status: codex approved (round 3) — awaiting owner approval
---

# Chrome Web Store launch — the repo half

Everything the store submission needs that lives in the repo: the store name, a real icon set, the promo tile and screenshots, the listing copy with behavioural permission justifications and honest data-use answers, a privacy page on nulo.sh, and a working, Chrome-only `publish-chrome-store` job on the current (v2) Chrome Web Store API. The account side (Google Workspace for `hello@nulo.sh`, the developer account and its $5 fee, 2FA, identity/trader declaration, the first manual unlisted upload, the OAuth client + refresh token, the GitHub environment protections) is a separate interactive session with the owner present; this plan produces every input that session consumes, including a checklist for it.

Owner decisions taken in chat (2026-09-07): store title **Nulo V5** (a "Nulo V6" listing will exist later; see the coexistence caveat); publisher identity is a Google Workspace account `hello@nulo.sh`; first upload is **Unlisted**; the CI publish stays **opt-in**.

## Scope

**In**
- `apps/extension`: `displayName` → `Nulo V5`; generated icons `src/assets/icons/{16,32,48,128}.png` from the 512×512 source with `Bun.Image` (resize + PNG encode verified on Bun 1.4.0), manifest `icons` map updated; `store/listing.md`; `store/promo-440x280.png`; `store/screenshot-{1,2,3}-1280x800.png`; `scripts/store-icons.ts` (+ a `--check` drift test), `scripts/store-art.ts` (Puppeteer renders HTML templates to PNG: the tile, and the screenshot frames around real popup captures), `tests/e2e/store-captures.test.ts` (opt-in, `describe.skipIf(!process.env.STORE_CAPTURES)`, uses the smoke fixtures to capture the popup at 360×600), `scripts/store-listing.test.ts` (listing invariants).
- `apps/landing`: `privacy.html` at `/privacy` (second Vite input, static, no script), a footer link, sitemap entry.
- `scripts/release/publish-chrome-store.ts` (+ test) and `publish-chrome-store-run.ts`; `release.yml`: new `publish_chrome` input, job body replaced, Bun setup, checkout at the release SHA; `CI.md` and `CLAUDE.md` § Release runbook: a "Marketplace publish" subsection with the account-session checklist.
- `apps/extension/README.md` file map.

**Out**
- Firefox/AMO: `publish-firefox-amo` stays stubbed behind its own (still absent) input; `publish_marketplaces` is renamed away so enabling Chrome can never trip Firefox's `exit 1`.
- Any dashboard/account action, and the secrets themselves.
- The `nulo.sh/help/*` and `nulo.sh/forms/*` links the popup points at (404 today): follow-up, not a store blocker.

## Architecture & Implementation

**Icons (`apps/extension/scripts/store-icons.ts`).** `Bun.Image` decodes `src/assets/logo.png` and writes 16/32/48/128 PNGs into `src/assets/icons/`. `--check` regenerates in memory and fails on a byte difference; `scripts/store-icons.test.ts` runs that check (the extension's vitest config includes `scripts/**/*.test.ts`). Deterministic on the pinned Bun.

**Promo tile and screenshot frames (`apps/extension/scripts/store-art.ts`).** Puppeteer (already a devDependency) renders two HTML templates under `store/templates/` to PNG: the 440×280 tile (ring mark + "NULO V5" wordmark in Space Grotesk from `@nulo/design`'s font files, charcoal ground) and a 1280×800 frame that embeds a popup capture as a data URI beside a one-line caption. Local-only; outputs are committed.

**Popup captures (`apps/extension/tests/e2e/store-captures.test.ts`).** An opt-in vitest file in the smoke suite (so `inject("extensionPath")` and the fixtures work as designed): `registerProfile`, then `page.setViewport({width: 360, height: 600})` and screenshots of Home (`#/popup/general`), Send (`#/popup/send`) and Settings → Security (`#/popup/settings/security`) into `store/captures/`. No funded account or dApp session is needed for these three; the captions carry the claims.

**Listing copy (`apps/extension/store/listing.md`).** Sections mirror the dashboard form. Justifications are behavioural: `storage`/`unlimitedStorage` (wallet state and the local Aztec database, which can exceed the default quota); `offscreen` (the private execution environment runs in an offscreen document because the service worker cannot host it); `alarms` (auto-lock and balance refresh timers); `sidePanel` (the wallet as a side panel); `downloads` (user-initiated backup and key exports only); content script on `*://*/*` with `all_frames` (the Aztec wallet-sdk discovery relay; dApps may run inside iframes; the script relays messages and does not read page contents); host `https://nulo.sh/` (the origin bound to the passkey RP ID `nulo.sh`); `http://127.0.0.1/*` (a local sandbox node; HTTP is accepted for loopback only, HTTPS everywhere else). Data-use answers are drafted from the data flows (Ask 3 below): the extension handles authentication data (keys, passwords: local, encrypted) and financial data (balances, history: local, plaintext in `chrome.storage.local`); it transmits transactions and balance queries to the RPC node (dRPC defaults with Alpha mainnet active on first run, or the user's own) and one fixed-id price query to CoinGecko while unlocked (toggle in Settings → Appearance); the developer operates no server and collects nothing; not sold, not used for unrelated purposes. `scripts/store-listing.test.ts` asserts: every manifest permission and host permission has a justification heading, title ≤ 45 chars, summary ≤ 132 chars, the privacy URL is present.

**Privacy page (`apps/landing/privacy.html`).** Static HTML with its own tiny entry `src/privacy.ts` that imports the same three stylesheets in the same order as the home page (`@nulo/design/base.css`, `overrides.css`, `page.css`) and nothing else (no feed), same bar/plates/footer, effective date, sections: what stays on your device (and that metadata is plaintext on disk), what leaves it (RPC node incl. the defaults; CoinGecko and its toggle), what we never collect, backups you export (yours; we never see them), passkeys, deleting your data (profile reset; uninstall), contact `hello@nulo.sh`, changes. Vite: `build.rollupOptions.input = { main: "index.html", privacy: "privacy.html" }`; the release plugin's token guard passes on a token-free page; `sitemap.xml` gains `/privacy`.

**Publish script (v2 API).** `publish-chrome-store.ts` is pure and credential-free: `tokenRequest(clientId, clientSecret, refreshToken)` builds the POST to `https://oauth2.googleapis.com/token`; `uploadRequest(publisherId, itemId, token, zip)` the `POST https://chromewebstore.googleapis.com/upload/v2/publishers/{p}/items/{i}:upload` (media); `statusRequest` the `GET …:fetchStatus`; `publishRequest` the `POST …:publish` with `{ publishType: "DEFAULT_PUBLISH" }`; `interpretUpload(json)` → `SUCCEEDED | IN_PROGRESS | FAILED`; `interpretPublish(json)` → `state`, where `PENDING_REVIEW` and `STAGED` mean **submitted** (the job's success), `PUBLISHED`/`PUBLISHED_TO_TESTERS` mean live, anything else fails with the bounded `reason`/`description` list. `-run.ts` reads `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, `CWS_ITEM_ID`, `ZIP_PATH`, `VERSION`, `DRY_RUN`; parses `DRY_RUN` strictly (`true`/`false` only, anything else exits 1); with `DRY_RUN=true` it validates inputs, checks the zip's `manifest.json` `version_name` equals `VERSION` and prints the plan with **zero network calls**; otherwise: token → `::add-mask::` on the access token → upload → poll `fetchStatus` until `SUCCEEDED` or `FAILED`, every request under `AbortSignal.timeout(15_000)` and the whole loop under a 3-minute deadline (injectable clock); `NOT_FOUND`, `UPLOAD_STATE_UNSPECIFIED`, a missing field or an exhausted deadline all fail closed and never reach publish → publish → print one summary line with the **actual** `state` and its next action (`PENDING_REVIEW`: submitted, wait for review; `STAGED`: approved, publish from the dashboard; `PUBLISHED`/`PUBLISHED_TO_TESTERS`: live), plus item id and crxVersion. Logging contract: never a request object, header, token response or raw exception; errors are sanitized to the API's `reason`/`description` strings truncated to 200 chars; non-JSON bodies are reported by status code only. Tests: fake secrets like `SECRET-A1B2` are asserted absent from captured output on every error path; dry-run makes no fetch call; upload `IN_PROGRESS` then `SUCCEEDED`; `FAILED`; `NOT_FOUND`; a deadline exhausted with `IN_PROGRESS` forever (publish never called); publish `PENDING_REVIEW` and `STAGED` (success, distinct summaries) and `REJECTED` (failure); non-JSON 502; a per-request timeout.

**Workflow.** `workflow_dispatch` input `publish_chrome` (boolean, default false; description: "Upload the release zip to the Chrome Web Store and submit it for review"); the old `publish_marketplaces` is removed (Firefox's stub gets `if: false` with a comment until AMO is wired). The job: `needs: [resolve, attach-assets]`, `if: always() && !cancelled() && github.event.inputs.publish_chrome == 'true' && needs.resolve.result == 'success' && needs.attach-assets.result == 'success'` (the `always()` form the file already documents at line 184: a skipped `release-please` ancestor otherwise skips the whole chain on `workflow_dispatch`), **`environment: chrome-web-store`** (a new, dedicated environment holding only the `CWS_*` secrets, so its reviewer and ref rules never touch the `production` environment that `attach-assets` and `refresh-landing` use on `push: main`), `actions/checkout@v7` with `ref: ${{ needs.resolve.outputs.sha }}` (the publisher script runs from the release commit, not the dispatch ref), `oven-sh/setup-bun` pinned by SHA with `bun-version: 1.4.0` and **no `bun install`** (the repo's `setup-bun` composite always installs the workspace; this script has no dependencies), download artifact `release-${VERSION}`, `sha256sum -c SHASUMS256.txt --ignore-missing` on the Chrome zip, then `bun scripts/release/publish-chrome-store-run.ts` with `ZIP_PATH=dist/release/nulo-chrome-${VERSION}.zip` and `DRY_RUN: ${{ github.event.inputs.dry_run || 'false' }}`. Secrets are set only on that step's `env`. The publish is always dispatched as `gh workflow run release.yml --ref main -f tag=vX.Y.Z -f publish_chrome=true` (`--ref` is the workflow ref the environment rules see; `tag` selects the artifact), and the dry run's acceptance check is that the `publish-chrome-store` job **ran** (its log shows the dry-run plan), not merely that the workflow was green.

**File-level change map.**

| Action | Path |
|---|---|
| modify | `apps/extension/package.json` (`displayName`), `manifest/manifest.config.ts` (icons map), `README.md`, `vitest.e2e.config.ts` (include the opt-in capture file if its glob does not already) |
| add | `apps/extension/src/assets/icons/{16,32,48,128}.png`, `scripts/store-icons.ts`, `scripts/store-icons.test.ts`, `scripts/store-art.ts`, `scripts/store-listing.test.ts`, `tests/e2e/store-captures.test.ts`, `store/listing.md`, `store/templates/{tile,frame}.html`, `store/captures/*.png`, `store/promo-440x280.png`, `store/screenshot-{1,2,3}-1280x800.png` |
| add | `apps/landing/privacy.html` |
| modify | `apps/landing/index.html` (footer link), `vite.config.ts` (inputs), `public/sitemap.xml`, `README.md` |
| add | `scripts/release/publish-chrome-store.ts`, `publish-chrome-store.test.ts`, `publish-chrome-store-run.ts` |
| modify | `.github/workflows/release.yml` (input rename, job body with the `always()` guard, `environment: chrome-web-store`, pinned `oven-sh/setup-bun`, Firefox `if: false`), `CI.md`, `CLAUDE.md` (Release runbook: marketplace subsection + account-session checklist) |
| add | `apps/extension/store/remote-code.md`, `apps/landing/src/privacy.ts` |

**Trade-offs.** v2 over v1: v1 support ends 2026-10-15, and its status vocabulary is different (`OK`, `ITEM_PENDING_REVIEW` as an error). A fetch script over `chrome-webstore-upload-cli`: no third-party code holds the credential and no 7-day age gate. Committed icons with a drift check over build-time generation: four static files, reviewable. Puppeteer-rendered art over `Bun.Image` compositing: `Bun.Image` has no draw/compose; Chromium is already in the toolchain. Screenshot capture inside vitest over a standalone script: the fixtures require vitest's `inject`.

## Phases

### Phase 1 — Icons and store name
- `displayName: "Nulo V5"`; `store-icons.ts` + test; manifest icons map.

**Validation gate**
- Commands: `bun run --cwd apps/extension typecheck && bun run --cwd apps/extension test -- scripts/store-icons && bun run lint && bun run --cwd apps/extension build:chrome && bun run --cwd apps/extension test:e2e`
- Pass: exit 0 (build runs `check:rp-id` first); `dist/chrome/manifest.json` has `name: "Nulo V5"` and four distinct icon paths; `file` reports 16/32/48/128; the smoke suite is green on the renamed build.
- Layers: typecheck · lint · unit · build · smoke e2e.

### Phase 2 — Captures, art, listing
- `store-captures.test.ts` run with `STORE_CAPTURES=1` against the Phase 1 build; `store-art.ts`; `listing.md`; `store-listing.test.ts`; `store/remote-code.md` (the cited bytecode/oracle boundary description for Ask 4).

**Validation gate**
- Commands: `STORE_CAPTURES=1 bun run --cwd apps/extension test:e2e -- tests/e2e/store-captures.test.ts && bun apps/extension/scripts/store-art.ts && bun run --cwd apps/extension test -- scripts/store-listing && bun run lint`
- Pass: exit 0; `file` reports three 360×600 captures, one 440×280 tile, three 1280×800 frames; the listing test is green (permission set equality, length caps, privacy URL).
- Layers: unit · smoke e2e (opt-in file) · lint · manual look at the PNGs.

### Phase 3 — Privacy page
- `privacy.html`, footer link, Vite inputs, sitemap.

**Validation gate**
- Commands: `bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint && bun run --cwd apps/landing build && ! grep -q '{{' apps/landing/dist/privacy.html && ! grep -q '{{' apps/landing/dist/index.html && grep -q '/privacy' apps/landing/dist/sitemap.xml`
- Pass: exit 0; then `bun run --cwd apps/landing preview` and a Playwright load of `/privacy` and of the home footer link, with the CSP header present and 0 console errors, recorded in `lessons/phase-3.md`.
- Layers: typecheck · lint · unit · build · browser.

### Phase 4 — Publish script, workflow, docs
- `publish-chrome-store{,.test,-run}.ts`; `release.yml`; `CI.md`; `CLAUDE.md`; `apps/extension/README.md`.

**Validation gate**
- Commands: `bun run test:release && bun run lint && bun run lint:actions && DRY_RUN=true CWS_CLIENT_ID=x CWS_CLIENT_SECRET=x CWS_REFRESH_TOKEN=x CWS_PUBLISHER_ID=x CWS_ITEM_ID=x VERSION=<v> ZIP_PATH=<a local release zip> bun scripts/release/publish-chrome-store-run.ts`
- Pass: exit 0; the dry run prints the plan and makes no network call (the test suite proves it with an injected fetch that throws); `DRY_RUN=maybe` exits 1; an empty secret exits 1 with `::error::`; actionlint clean; `release.yml` has no remaining `publish_marketplaces` reference and the Chrome job's `if` starts with `always() && !cancelled()`.
- Layers: unit · lint · actionlint · dry-run.

## Security & Adversarial Considerations

- **The publish credential can push code to every user.** Mitigations in this plan: one in-repo, dependency-free script; secrets on a single step's `env`; the access token masked; a logging contract with tests; the script checked out at the release SHA so a dispatch against another branch cannot substitute the publisher; the zip verified against the release's SHASUMS and its `version_name` against the tag before upload. **What this plan cannot do**: the `production` environment currently has no required reviewers, no deployment-branch/tag policy, and admins can bypass (read from the GitHub API on 2026-09-07). Any repository writer can dispatch `release.yml`. Ask 2 puts a dedicated, reviewer-gated `chrome-web-store` environment on the account-session checklist (a tag-only or reviewer rule on the shared `production` environment would block or stall the automatic `push: main` releases); until it exists, the input stays off.
- **Provenance**: the published bytes are the `attach-assets` artifact, the same zip on the GitHub Release with its SHASUMS; nothing is rebuilt in the credential-bearing job.
- **Honesty surface**: the data-use answers are written from the data flows, not from a slogan; the remote-code answer is an explicit owner decision (Ask 4) with a drafted reviewer explanation; permission justifications are behavioural and tested for coverage.
- **V6 coexistence**: Google's spam policy rejects duplicate functionality. V6 will need a stated, distinct purpose (a different Aztec protocol regime with a different address derivation, not interoperable) in its listing; a version suffix alone is not a guarantee. Not a V5 blocker.
- **Privacy page**: static, same CSP, no forms.
- **Screenshots** use fixture profiles only.
- **Supply chain**: no new packages.

## Assumptions

**Facts**
1. `apps/extension/package.json#displayName` is `Nulo (V5)`; `manifest.config.ts` uses it as `name`; `permissions: [alarms, offscreen, storage, sidePanel, unlimitedStorage, downloads]`; `host_permissions: ["https://nulo.sh/", "http://127.0.0.1/*"]`; content script `*://*/*`, `all_frames: true`, relay only (`content.ts:1-9`); CSP `script-src 'self' 'wasm-unsafe-eval'`.
2. The passkey RP ID is `nulo.sh`; `https://nulo.sh/` is the host permission that binds it; `scripts/check-rp-id.ts` runs in `build:chrome` (`SECURITY.md:24-40`, `package.json:11`).
3. `src/assets/logo.png` is 512×512 RGB. `Bun.Image` on Bun 1.4.0 decodes it, resizes and encodes PNG (probed); its prototype has `resize/png/flip/rotate/modulate` and no compose/draw.
4. `release.yml`: `resolve` outputs `tag`, `version`, `sha`, `is_prerelease` only; `attach-assets` reads `DRY_RUN` from `github.event.inputs.dry_run || 'false'` and uploads `release-<v>` (both zips + SHASUMS); `publish-chrome-store` and `publish-firefox-amo` are both gated on `publish_marketplaces` and both `exit 1`; the `status` aggregator fails on either; the Chrome job has no Bun setup and checks out the dispatch ref.
5. The `production` environment: no reviewers, no wait timer, no branch policy, `can_admins_bypass: true`; it is used by `attach-assets` and `refresh-landing` on the automatic `push: main` path (`release.yml:11`, `:266`, `:368`). The `setup-bun` composite always runs `bun install --frozen-lockfile` (`action.yml:28`). `release.yml:184` documents that a job below a skipped ancestor needs `if: always() && …`.
6. `tests/e2e/fixtures/extension.ts` calls vitest's `inject("extensionPath")`; the module cannot be imported outside a vitest run. `apps/extension/vitest.config.ts` includes `scripts/**/*.test.ts`; the smoke config runs `tests/e2e/*.test.ts`.
7. `package.json` has `test:release` (`bun test scripts/release/`), run in CI by `_unit-tests.yml`; `lint:actions` is actionlint.
8. Chrome Web Store API v1 "will only be supported until 15th October 2026". v2: upload `POST https://chromewebstore.googleapis.com/upload/v2/publishers/{p}/items/{i}:upload`, `fetchStatus` `GET …:fetchStatus` (`lastAsyncUploadState`, `submittedItemRevisionStatus.state`), publish `POST …:publish` (`publishType`), `UploadState` ∈ {SUCCEEDED, IN_PROGRESS, FAILED, NOT_FOUND}, `ItemState` ∈ {PENDING_REVIEW, STAGED, PUBLISHED, PUBLISHED_TO_TESTERS, REJECTED, CANCELLED}; scope `https://www.googleapis.com/auth/chromewebstore`; the API publishes with the item's existing visibility.
9. `SECURITY.md`: metadata (accounts, contacts, dApp sessions, balances, history) plaintext in `chrome.storage.local`; master secret AES-GCM; CoinGecko fixed-id query every ~3 min while unlocked, toggle `showFiatValues`; default networks are dRPC endpoints with Alpha mainnet active (`network/service.ts:97-105`); the wallet accepts dApp-supplied contract artifacts and executes them in the bundled PXE simulator.
10. `apps/landing/vite.config.ts` has no `rollupOptions.input`; `release-html-plugin` runs on every HTML entry; the home page's styles are three files imported in order by `src/main.ts` (`page.css` depends on tokens from the other two).
11. dApp execution: `dapp-interaction/service.ts:313` takes `silentInteraction` when `isConfirmationNeeded` is false (session confirmation threshold, `:558`); `aztec_simulateTx`/`aztec_executeUtility` are `PrivateData` access level (`:627`); the PXE runs in the offscreen document, which calls `chrome.runtime.sendMessage` (`offscreen/index.ts:122`).

**Inferences**
- The v2 media upload accepts the zip as the request body with `Content-Type: application/zip` (the reference documents an empty JSON body plus media); the first real dispatch confirms it, the dry run does not.
- `registerProfile` alone yields a Home, Send and Settings screen presentable enough for screenshots (empty balances read as "0"); if not, captions and a seeded token list cover it.
- Category "Productivity" is acceptable; changeable in the form.

**Asks**
1. **Rename to `Nulo V5`** (decided in chat; recorded, not re-asked).
2. **A dedicated `chrome-web-store` GitHub environment before the first real publish**: holds the `CWS_*` secrets; required reviewer (the owner); deployment branch policy `main` only (the workflow ref used by the publish dispatch); admin bypass off. `production` is left as it is (it serves the automatic `push: main` release path and must stay non-interactive). Owner action in the account session. Default: required before `publish_chrome` is ever set.
3. **Data-use disclosure**: the drafted answers say the extension handles authentication and financial data locally, transmits to the RPC node and CoinGecko, and the developer collects nothing. Confirm this framing (the earlier "collects no user data" is withdrawn as inaccurate).
4. **Remote-code classification is unresolved; it is a fact-finding task plus a policy call, not a wording choice.** What the code does: dApps supply contract artifacts that the wallet registers with the PXE and executes (simulate, utility calls, proving) in the bundled Aztec simulator running in an offscreen document; that document uses `chrome.runtime` messaging (`offscreen/index.ts:100-122`); execution needs a granted capability, and calls under the session's confirmation threshold take the silent path with no per-request window (`dapp-interaction/service.ts:313`, `:558`). Phase 2 adds `store/remote-code.md`: a cited description of the bytecode/oracle boundary (which instructions the simulator interprets, which oracle callbacks the extension's own code serves, what the bytecode cannot reach) written from `packages/aztec-runtime` and the `@aztec` simulator, with no claims about other wallets. Owner decision: (a) submit with "No remote code" and that note, or (b) obtain a policy read (Chrome Web Store developer support) before the first submission. Default: (b), because a rejection here delays the listing by a review cycle.
5. **Distribution stays Unlisted**; the API preserves the dashboard's visibility. No trusted-testers default (withdrawn).

## Post-implementation hardening

`/harden security` before the listing goes public; the "not audited" statement stays on the listing until then.

## Post-implementation

Executed by the implementing session from this file. `code_review` is `off`.

1. **Codex audit** (`/codex high`): net diff from `b47b9bf4`, this plan, `recon.md`, `audit-codex.md`; asks: the publish credential as the target (log leaks, dry-run, workflow env, checkout ref), honesty of listing and privacy copy against the code, script error handling and the polling bound; plus the two rules below.
2. **Iterative fix loop**: verify claims against the repo; fix; commit; log in `lessons/`; resume the same session; repeat until no material findings; stop and surface after 3 rounds.
3. **Delivery** below.

**No-over-engineering rule** (verbatim in every codex prompt): "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."

**Comment-quality rule** (verbatim in every codex prompt): "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."

## Delivery

Single arc, one PR `worktree-chrome-store-launch` → `dev`: `feat(store): chrome web store listing, privacy page, and v2 publish job`. Touches `apps/extension/**` and `.github/workflows/**`, so smoke + network e2e and actionlint run; diagnose reds before re-running. Merge is the owner's call.

**Account-session checklist (after merge, owner present)**: Workspace + `hello@nulo.sh` → developer account, fee, 2FA, identity/trader → dashboard: new item from the next release's `nulo-chrome-<v>.zip`, listing from `store/listing.md`, art from `store/`, privacy URL, Unlisted, submit → note Publisher ID and Item ID → Cloud Console: enable the Chrome Web Store API, OAuth client, refresh token via OAuth Playground with scope `chromewebstore` → GitHub: create environment `chrome-web-store` (reviewer = owner, branches: `main`, bypass off) with secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, `CWS_ITEM_ID` → `gh workflow run release.yml --ref main -f tag=<latest> -f dry_run=true -f publish_chrome=true` and confirm the `publish-chrome-store` job ran (dry-run plan in its log), then for real on the next release (its manifest version must exceed the manually uploaded one).

## Audit — codex

**Round 1 (GPT-6 Astra, high): reject.** Blocking findings, all verified and adopted: v1 API deprecated (support ends 2026-10-15) and its status vocabulary misread → v2 with `fetchStatus` polling and `PENDING_REVIEW`/`STAGED` as "submitted"; `DRY_RUN` was read from `resolve`, which has no such output → from the dispatch input with strict parsing and a zero-network test; the `production` environment has no protections and the job checked out the dispatch ref → checkout at the release SHA, secrets on one step, protections on the account checklist (Ask 2); enabling `publish_marketplaces` would also fire Firefox's `exit 1` → `publish_chrome` input, Firefox `if: false`; no Bun setup in the job → the `setup-bun` composite; "collects no user data" inaccurate → data-flow disclosures (Ask 3); CSP does not answer the remote-code question given dApp-supplied contract bytecode → Ask 4 with a drafted explanation; `trustedTesters` contradicted the owner's Unlisted choice → withdrawn (Ask 5); RP ID misstated → `nulo.sh`; fixtures need vitest → opt-in test file; `Bun.Image` cannot compose → Puppeteer-rendered art; listing test outside vitest's include → moved to `scripts/`; Phase 2 never ran its tests → fixed; the runner's comment style must not copy the verbose history comments; V6 coexistence not guaranteed by a suffix → noted. Nothing rejected. Transcript: `audit-codex.md`.

**Round 2: reject.** Verified and adopted: a tag-only/reviewer rule on the shared `production` environment would block or stall `push: main` releases → a dedicated `chrome-web-store` environment, dispatch documented as `--ref main`; the Chrome job lacked the `always() && !cancelled()` guard the file documents at line 184 → added, and the dry-run acceptance is "the job ran"; the `setup-bun` composite always installs → pinned `oven-sh/setup-bun`, no install; polling had no time bound and no fail-closed states → per-request timeouts, a 3-minute deadline, `NOT_FOUND`/unspecified fail closed, exhausted polling never publishes (tested); the summary always said "submitted" → prints the actual state; `page.css` alone cannot style the privacy page → its own entry importing the same three stylesheets; the remote-code explanation asserted per-request confirmation (false: the silent path) and isolation (unproven) → Ask 4 rewritten as a fact-finding task (`store/remote-code.md`) plus an owner policy call with "get a policy read first" as the default. Nothing rejected.

**Round 3: approve.** "No remaining material findings in the revised implementation plan. Confidence: high. Approval covers repo implementation; the documented account and policy prerequisites still apply before submission."

## Seeds

ELI5 companion: the Artifact at `https://claude.ai/code/artifact/82028d03-b774-4cf1-a053-13afc884167a`, published from `implementations-plan/chrome-store-launch/eli5.html` (redeploy the same file to update it).

Recommended: `/goal`.

```
/goal All four phases marked ✓ in implementations-plan/chrome-store-launch/plan.md, each ✓ backed by its validation gate reported passing in the transcript; `LESSONS_FILE=implementations-plan/chrome-store-launch/lessons/phase-N.md` printed for each phase; `/code-review` NOT run (code_review is off); the codex fix loop converged on the net diff, evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; one PR from worktree-chrome-store-launch to dev exists (`gh pr view` in the transcript), created only after the loop converged; `gh pr checks` reports every required check green in the transcript; `bun run test` and `bun run lint` both report exit 0 in the transcript.
```

Fallback: `/loop 15m` with the standard blueprint driver prompt, `<lint>` = `bun run lint`, `<test>` = `bun run test`.
