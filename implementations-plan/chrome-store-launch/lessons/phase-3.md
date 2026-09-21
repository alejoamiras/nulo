# Phase 3 — Chrome publish job

## What changed

- `scripts/release/publish-chrome-store.ts` (pure: requests, integer-tuple store versions, preflight / upload / async-poll / publish interpreters, the two warning envelopes, `apiError`) + `publish-chrome-store.test.ts`.
- `scripts/release/publish-chrome-store-run.ts` (the I/O runner: `MODE` `publish` | `check` with no default, strict `DRY_RUN`, zip validation through `unzip -p` behind an injectable reader, `::add-mask::`, 15 s per request, 3-minute upload deadline on an injectable clock, one-line summaries) + `publish-chrome-store-run.test.ts`.
- `.github/workflows/release.yml`: `publish_marketplaces` → `publish_chrome` + `publish_firefox`; `resolve` emits `on_main` (`git merge-base --is-ancestor "$SHA" origin/main`, true/false) and writes tag / sha / prerelease / on-main to the job summary; `publish-chrome-store` rewritten keyless (`environment: chrome-web-store`, `id-token: write`, `google-github-actions/auth@7c6bc770…` v3.0.0 with `token_format: access_token` and the `chromewebstore` scope, ids from environment variables, no secret); `publish-firefox-amo` moved to `publish_firefox` with the full guard, a loud stub and **no** `environment:` key; the skipped-ancestor comment shrunk; both jobs still in `status`'s needs.
- `.github/workflows/store-check.yml`: `workflow_dispatch`, input `store` (choice: `chrome`), one job in the store's environment running the same runner with `MODE=check`.
- `CI.md`, `CLAUDE.md` (runbook steps 6 for stable and prerelease), `.github/README.md`.

## Findings

- `google-github-actions/auth` `v3` and `v3.0.0` are the same lightweight tag at `7c6bc770dae815cd3e89ee6cdf493a5fab2cc093`; pinned by SHA.
- Bun's `expect(x).toMatchObject({ reason: expect.stringContaining(…) })` then `JSON.stringify(x)` showed `reason: {}` — the asymmetric matcher appears to be written back into the received object. Assert on the narrowed string instead.
- `execFileSync("unzip", ["-p", zip, "manifest.json"])` reads a 41 MB release zip in well under a second; no need for a zip library (`Bun.Archive` is tar-only).
- The real `nulo-firefox-0.27.0.zip` is refused by the Chrome runner on `browser_specific_settings` (verified); the real Chrome zip passes the dry run with `manifest version 0.27.0.0 (version_name 0.27.0)`.

## Validation gate

| Layer | Command | Result |
|---|---|---|
| unit | `bun run test:release` | 116 passed across 10 files (29 new) |
| lint | `bun run lint` | exit 0 |
| actionlint | `bun run lint:actions` | clean |
| dry run | `MODE=publish DRY_RUN=true CWS_PUBLISHER_ID=x CWS_ITEM_ID=x CWS_PUBLISH_TYPE=STAGED_PUBLISH VERSION=0.27.0 ZIP_PATH=<v0.27.0 Chrome zip> bun scripts/release/publish-chrome-store-run.ts` | exit 0, zero requests, plan printed |
| negative | same with the v0.27.0 Firefox zip | exit 1, "that is the Firefox build" |

Tests cover every item the plan lists: dry run makes zero fetch calls with an injected fetch that throws and no token; `DRY_RUN=maybe` and an unknown `CWS_PUBLISH_TYPE` exit 1; a Firefox zip is refused; `TOKEN-A1B2` reaches the output only as the mask directive, which precedes every request-derived line; preflight refuses a wrong `itemId`, `takenDown`, a pending review, a not-lower version in any channel (`0.10.0.0` vs `0.9.0.0` included) and a revision with an unknown state, and accepts absent revisions; unset `MODE` exits 1; `MODE=check` needs no zip, makes one GET, passes a pending review at an equal version and fails a foreign `itemId`; `SUCCEEDED` publishes without polling with no `lastAsyncUploadState`; `IN_PROGRESS` → `SUCCEEDED` and `UPLOAD_IN_PROGRESS` → `SUCCEEDED`; `crxVersion` mismatch; `FAILED`, `NOT_FOUND`, unspecified; deadline exhausted with no publish; `PENDING_REVIEW`, `STAGED`, `PUBLISHED` distinct and `REJECTED`; warnings in `warningInfo.warnings` and in a 4xx `error.details`; non-JSON 502; per-request timeout. `release.yml` has no `publish_marketplaces`; both publish `if`s start with `always() && !cancelled()`.

Phase 3 gate: **pass**.
